// Cloudflare Queue consumer for YourRank.
//
// Processes click, conversion, analytics (bump), and notification events durably
// off the request thread. Failed messages are retried and routed to the DLQ.
//
// Every delivery is parsed as a canonical envelope (stable producer-minted
// eventId + optional correlationId) or, during rollout, as a legacy flat event.
// Side effects that are not naturally idempotent go through the durable queue
// event ledger keyed by that eventId, so retries, producer fallback duplicates
// and DLQ replays collapse into one logical effect.
import { one, exec } from "@yourrank/shared/db";
import { recordConversion } from "@yourrank/shared/conversions";
import { parseQueueMessage } from "@yourrank/shared/queue-producer";
import {
  applyBumpOnce,
  applyClickOnce,
  deliverNotifyOnce,
  ledgerIdentityFor,
} from "@yourrank/shared/queue-effects";
import { processKickRewardRedemption } from "@yourrank/shared/kick-credits";
import { RateLimiter } from "@yourrank/shared/rate-limiter-do";
import { mapWithConcurrency, SHARED_WORK_CONCURRENCY_LIMIT } from "@yourrank/shared/work-concurrency";
import { processAccountExport } from "./account-export.js";
import { processViewerExport } from "./viewer-export.js";

export const DLQ_QUEUE_NAMES = new Set(["yourrank-events-dlq", "yourrank-events-staging-dlq"]);

// Delivery attempts (1 + retries) the DLQ consumer gets before a message that
// could not be persisted is gone for good. Must match `max_retries` of the DLQ
// consumer in wrangler.toml; the DLQ consumer has no further dead-letter queue,
// so there is no DLQ-to-DLQ loop.
export const DLQ_PERSIST_MAX_ATTEMPTS = 4;

// Scheduled heartbeat cadence is */5; anything older than this without a cron
// tick means the consumer is not executing, regardless of queue traffic.
export const SCHEDULED_HEARTBEAT_STALE_SECONDS = 900;

function setProcessEnv(env) {
  const dbUrl = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (dbUrl) process.env.DATABASE_URL = dbUrl;
  if (env.PUBLIC_BASE_URL) process.env.PUBLIC_BASE_URL = env.PUBLIC_BASE_URL;
}

/** Envelope identity fields for logs, never the payload itself. */
export function describeMessage(msg) {
  const body = msg?.body;
  const isEnvelope = body && typeof body === "object" && "payload" in body && "eventId" in body;
  return {
    message_id: msg?.id ?? null,
    attempts: typeof msg?.attempts === "number" ? msg.attempts : null,
    event_id: isEnvelope ? String(body.eventId) : null,
    correlation_id: isEnvelope && body.correlationId ? String(body.correlationId) : null,
    event_type: isEnvelope ? String(body.eventType ?? body.payload?.type ?? "unknown") : String(body?.type ?? "unknown"),
    legacy: !isEnvelope,
  };
}

async function alertDiscord(webhook, batch, terminal = []) {
  if (!webhook) return;
  const fields = batch.messages.map((msg) => {
    const d = describeMessage(msg);
    return {
      name: `ID ${String(msg.id).slice(0, 12)}`,
      value: `type: ${d.event_type} · event: ${d.event_id ?? "legacy"}${terminal.includes(msg.id) ? " · PERSISTENCE EXHAUSTED" : ""}`,
      inline: false,
    };
  });
  const embed = {
    title: terminal.length ? "🔴 YourRank DLQ record LOST after persistence retries" : "⚠️ YourRank events moved to DLQ",
    description: `${batch.messages.length} queue message(s) exhausted retries and reached the dead-letter queue.${terminal.length ? ` ${terminal.length} could not be persisted and will not be retried again.` : ""}`,
    color: terminal.length ? 0xff4444 : 0xff9900,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: "YourRank Consumer" },
  };
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "YourRank DLQ", embeds: [embed] }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    // Swallow — alerting must not block acking DLQ messages.
  }
}

/**
 * Persist dead-lettered messages. Persistence failures are retried through the
 * DLQ consumer's own retry budget; the final attempt logs a terminal,
 * high-signal record (identity only) and acks, so the loss is observable and
 * nothing loops forever.
 */
export async function handleDlq(
  batch,
  env,
  ctx,
  { execImpl = exec, alertImpl = alertDiscord, maxAttempts = DLQ_PERSIST_MAX_ATTEMPTS } = {},
) {
  const terminal = [];
  for (const msg of batch.messages) {
    const desc = describeMessage(msg);
    console.error(JSON.stringify({ event: "queue_dlq_received", queue: batch.queue, ...desc, ts: new Date().toISOString() }));
    try {
      await execImpl(
        `INSERT INTO queue_dlq_events (message_id, queue_name, event_type, body, event_id, correlation_id)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT (message_id) DO NOTHING`,
        [msg.id, batch.queue, desc.event_type, msg.body ?? null, desc.event_id, desc.correlation_id]
      );
      msg.ack();
    } catch (err) {
      const attempt = typeof msg.attempts === "number" && msg.attempts > 0 ? msg.attempts : 1;
      const error = err instanceof Error ? err.message : String(err);
      if (attempt >= maxAttempts) {
        terminal.push(msg.id);
        console.error(JSON.stringify({
          event: "queue_dlq_persist_terminal",
          severity: "critical",
          queue: batch.queue,
          ...desc,
          attempt,
          max_attempts: maxAttempts,
          error,
          ts: new Date().toISOString(),
        }));
        msg.ack();
      } else {
        console.error(JSON.stringify({
          event: "queue_dlq_persist_retry",
          queue: batch.queue,
          ...desc,
          attempt,
          max_attempts: maxAttempts,
          error,
          ts: new Date().toISOString(),
        }));
        msg.retry({ delaySeconds: Math.min(60 * attempt, 300) });
      }
    }
  }
  ctx?.waitUntil(alertImpl(env.DISCORD_MONITORING_WEBHOOK, batch, terminal));
  return { terminal };
}

/**
 * Apply one delivery. `messageId` is the Cloudflare delivery id, used only as a
 * retry-scoped identity for legacy events (explicitly recorded as such).
 */
export async function handleEvent(
  input,
  tokenCache,
  env,
  {
    messageId = null,
    applyBumpOnceImpl = applyBumpOnce,
    applyClickOnceImpl = applyClickOnce,
    deliverNotifyOnceImpl = deliverNotifyOnce,
    recordConversionImpl = recordConversion,
  } = {},
) {
  const parsed = parseQueueMessage(input);
  const body = parsed.event;
  const identity = ledgerIdentityFor(parsed, messageId);

  switch (body.type) {
    case "click": {
      if (identity) return applyClickOnceImpl(identity, body);
      // Legacy click without a delivery id: no identity exists to dedupe on.
      await applyClickOnceImpl(
        { eventId: `unidentified:${crypto.randomUUID()}`, eventType: "click", correlationId: null, identitySource: "cloudflare_message_id" },
        body,
      );
      return { outcome: "applied" };
    }
    case "conversion": {
      // conversions_idempotency_idx (owner_id, click_ref, event, amount) is the
      // authoritative dedupe for conversions.
      await recordConversionImpl(body.ownerId, body.query);
      return { outcome: "applied" };
    }
    case "bump": {
      if (!identity) throw new Error("bump event without any stable identity cannot be applied safely");
      return applyBumpOnceImpl(identity, body);
    }
    case "notify": {
      if (!identity) throw new Error("notify event without any stable identity cannot be delivered safely");
      return deliverNotifyOnceImpl(identity, body, env, tokenCache);
    }
    case "kick-redemption": {
      // kick_reward_events(event_id) already dedupes on the provider message id.
      await processKickRewardRedemption({
        messageId: body.messageId,
        eventType: body.eventType,
        payload: body.payload,
      }, env);
      return { outcome: "applied" };
    }
    case "account-export": {
      await processAccountExport(body, env);
      return { outcome: "applied" };
    }
    case "viewer-export": {
      await processViewerExport(body, env);
      return { outcome: "applied" };
    }
    default: {
      throw new Error(`unsupported queue event: ${/** @type {{ type?: string }} */ (body).type}`);
    }
  }
}

export async function processQueueMessages(messages, handler) {
  let processed = 0;
  let failed = 0;
  await mapWithConcurrency(
    messages,
    SHARED_WORK_CONCURRENCY_LIMIT,
    async (msg) => {
      try {
        await handler(msg);
        msg.ack();
        processed++;
      } catch (err) {
        failed++;
        msg.retry();
      }
    }
  );
  return { processed, failed };
}

export const SCHEDULED_HEARTBEAT_NAME = "consumer_scheduled";

/**
 * Cron-driven heartbeat: proves the Worker executes even with zero traffic.
 * Written to its own row so queue traffic (which updates `consumer`) can never
 * stand in for it; `consumer.last_seen` is also touched for older readers.
 */
export async function refreshConsumerHeartbeat(execImpl = exec) {
  try {
    await execImpl(
      `INSERT INTO consumer_heartbeat (name, last_seen, processed_count, failed_count)
       VALUES ($1, now(), 0, 0), ('consumer', now(), 0, 0)
       ON CONFLICT (name) DO UPDATE SET last_seen = now()`,
      [SCHEDULED_HEARTBEAT_NAME]
    );
  } catch (hbErr) {
    console.error(JSON.stringify({
      event: "consumer_heartbeat_refresh_failed",
      error: hbErr instanceof Error ? hbErr.message : String(hbErr),
      ts: new Date().toISOString(),
    }));
  }
}

export function scheduledHeartbeatPolicy(env) {
  const raw = String(env?.CONSUMER_SCHEDULED_HEARTBEAT ?? "required").toLowerCase();
  if (raw === "disabled") return "disabled";
  return "required";
}

/**
 * Readiness: DB reachable, queue binding present, scheduled heartbeat fresh.
 * Read-only — it must never refresh the heartbeat it is verifying.
 */
export async function evaluateReadiness(env, { oneImpl = one, now = Date.now(), staleSeconds = SCHEDULED_HEARTBEAT_STALE_SECONDS } = {}) {
  const checks = { db: false, queue_binding: false, scheduled_heartbeat: "unknown" };
  const failures = [];

  if (env?.EVENTS_QUEUE && typeof env.EVENTS_QUEUE.send === "function") checks.queue_binding = true;
  else failures.push("queue_binding_missing");

  let heartbeat = null;
  try {
    heartbeat = await oneImpl(
      "SELECT EXTRACT(EPOCH FROM (now() - last_seen))::int AS seconds_ago FROM consumer_heartbeat WHERE name = $1",
      [SCHEDULED_HEARTBEAT_NAME]
    );
    checks.db = true;
  } catch (err) {
    failures.push("db_unreachable");
    checks.scheduled_heartbeat = "unknown";
    console.error(JSON.stringify({
      event: "consumer_readiness_failed",
      reasons: failures,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date(now).toISOString(),
    }));
    return { ready: false, checks, failures };
  }

  const policy = scheduledHeartbeatPolicy(env);
  if (policy === "disabled") {
    checks.scheduled_heartbeat = "disabled";
  } else if (!heartbeat) {
    checks.scheduled_heartbeat = "missing";
    failures.push("scheduled_heartbeat_missing");
  } else {
    const secondsAgo = Number(heartbeat.seconds_ago);
    checks.scheduled_heartbeat_seconds_ago = secondsAgo;
    if (Number.isFinite(secondsAgo) && secondsAgo < staleSeconds) {
      checks.scheduled_heartbeat = "fresh";
    } else {
      checks.scheduled_heartbeat = "stale";
      failures.push("scheduled_heartbeat_stale");
    }
  }

  const ready = failures.length === 0;
  if (!ready) {
    console.error(JSON.stringify({ event: "consumer_readiness_failed", reasons: failures, ts: new Date(now).toISOString() }));
  }
  return { ready, checks, failures };
}

export async function handleFetch(request, env, { evaluateReadinessImpl = evaluateReadiness } = {}) {
  const url = new URL(request.url);
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (url.pathname === "/consumer/live" || url.pathname === "/live") {
    return new Response(JSON.stringify({ ok: true, live: true }), { headers });
  }
  if (["/health", "/consumer/health", "/ready", "/consumer/ready"].includes(url.pathname)) {
    const readiness = await evaluateReadinessImpl(env);
    return new Response(JSON.stringify({ ok: readiness.ready, ready: readiness.ready, checks: readiness.checks, failures: readiness.failures }), {
      status: readiness.ready ? 200 : 503,
      headers,
    });
  }
  return new Response("consumer ok", { status: 200 });
}

export default {
  async scheduled(_event, env) {
    setProcessEnv(env);
    await refreshConsumerHeartbeat();
  },

  async queue(batch, env, ctx) {
    setProcessEnv(env);

    if (DLQ_QUEUE_NAMES.has(batch.queue)) {
      await handleDlq(batch, env, ctx);
      return;
    }

    const tokenCache = new Map();
    const { processed, failed } = await processQueueMessages(
      batch.messages,
      async (msg) => {
        const startedAt = Date.now();
        const desc = describeMessage(msg);
        try {
          const result = await handleEvent(msg.body, tokenCache, env, { messageId: msg.id });
          console.log(JSON.stringify({
            event: "queue_message_processed",
            ...desc,
            outcome: result?.outcome ?? "applied",
            duration_ms: Date.now() - startedAt,
          }));
        } catch (err) {
          console.error(JSON.stringify({
            event: "queue_message_failed",
            ...desc,
            duration_ms: Date.now() - startedAt,
            error: err instanceof Error ? err.message : String(err),
          }));
          throw err;
        }
      }
    );

    // Record that the consumer is alive and how much work it did in this batch.
    // This lets the monitor detect a silent outage instead of waiting for stale analytics.
    try {
      await exec(
        `INSERT INTO consumer_heartbeat
           (name, last_seen, processed_count, failed_count, last_failure_at, last_success_at)
         VALUES ('consumer', now(), $1::bigint, $2::bigint,
                 CASE WHEN $2::bigint > 0 THEN now() ELSE NULL END,
                 CASE WHEN $1::bigint > 0 THEN now() ELSE NULL END)
         ON CONFLICT (name) DO UPDATE
         SET last_seen = now(),
             processed_count = consumer_heartbeat.processed_count + EXCLUDED.processed_count,
             failed_count = consumer_heartbeat.failed_count + EXCLUDED.failed_count,
             last_failure_at = CASE WHEN EXCLUDED.failed_count > 0 THEN now() ELSE consumer_heartbeat.last_failure_at END,
             last_success_at = CASE WHEN EXCLUDED.processed_count > 0 THEN now() ELSE consumer_heartbeat.last_success_at END`,
        [processed, failed]
      );
    } catch (hbErr) {
      console.error(JSON.stringify({
        event: "consumer_heartbeat_failed",
        error: hbErr instanceof Error ? hbErr.message : String(hbErr),
        ts: new Date().toISOString(),
      }));
    }
  },

  async fetch(request, env) {
    setProcessEnv(env);
    return handleFetch(request, env);
  },
};

// Durable Object class must be exported from the main module for bindings to resolve.
export { RateLimiter };
