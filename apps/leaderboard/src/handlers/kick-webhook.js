// Kick webhook handler for channel-point reward redemptions and chat messages.
// Keeps the request thread thin: verify the signature, filter the event, then
// drop redemptions onto the shared events queue (the consumer durably grants
// credits) and turn chat messages into chat-giveaway entries inline.
import { json, bad, rateLimit as defaultRateLimit } from "../auth.js";
import { query, one, withTransaction } from "@yourrank/shared/db";
import {
  KICK_CHAT_MESSAGE_EVENT,
  ingestChatGiveawayMessage,
  kickChatMessageToIngestInput,
  markChannelEventObserved,
} from "@yourrank/shared/chat-giveaways";
import { createQueueProducer } from "@yourrank/shared/queue-producer";
import { ingestTournamentChatMessageTx } from "./tournaments.js";
import {
  verifyKickWebhookSignature,
  isCreditableKickStatus,
  isReversibleKickStatus,
  processKickRewardRedemption,
} from "@yourrank/shared/kick-credits";
import { joinConfirmationText, sendTournamentChatMessage } from "../lib/tournament-chat.js";

const KICK_REWARD_EVENT = "channel.reward.redemption.updated";
const KICK_WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

// If the queue binding is missing, process the event inline so local/dev
// tests still work, but always prefer the queue for scale.
async function processFallback(event, env) {
  const result = await processKickRewardRedemption(event, env);
  console.log("[kick-webhook] fallback processed:", result);
  return result;
}

async function ingestKickChatMessage(payload, env, run = (sql, params) => query(sql, params)) {
  return ingestChatGiveawayMessage(run, kickChatMessageToIngestInput(payload));
}

const JOIN_ACK_KEY = (tournamentId) => `tournament-join-ack:${tournamentId}`;
const JOIN_ACK_TTL_SECONDS = 6 * 60 * 60;
const ACTIVE_ENTRY_STATUSES = "('pending', 'confirmed', 'selected')";

const kvGetDefault = async (env, key) => (env?.SESSIONS ? env.SESSIONS.get(key) : null);
const kvPutDefault = async (env, key, value, ttl) => {
  if (env?.SESSIONS) await env.SESSIONS.put(key, value, { expirationTtl: ttl });
};

// Builds the join confirmation. Replies share a budget of 3 per 30s per
// tournament; joins that arrive while that budget is spent are not answered
// individually, so the next confirmation that does go out names them too.
// `tournament-join-ack:<id>` holds the DB time of the last confirmation, and
// every chat entry created after it (other than the sender) rides along.
async function joinConfirmationContent(tournament, env, { dbOne, dbQuery, kvGet }) {
  const tournamentId = tournament.tournamentId;
  const since = await kvGet(env, JOIN_ACK_KEY(tournamentId));
  const counts = await dbOne(
    `SELECT now() AS at, count(*) FILTER (WHERE status IN ${ACTIVE_ENTRY_STATUSES})::integer AS players
       FROM tournament_entries WHERE tournament_id=$1`,
    [tournamentId]
  );
  const others = await dbQuery(
    `SELECT display_name, count(*) OVER ()::integer AS total
       FROM tournament_entries
      WHERE tournament_id=$1 AND source='chat' AND status IN ${ACTIVE_ENTRY_STATUSES}
        AND created_at > COALESCE($2::timestamptz, now() - interval '30 seconds')
        AND lower(display_name) <> lower($3)
      ORDER BY created_at ASC
      LIMIT 3`,
    [tournamentId, since || null, String(tournament.senderUsername || "")]
  );
  const rows = Array.isArray(others) ? others : [];
  return {
    at: counts?.at ? new Date(counts.at).toISOString() : null,
    content: joinConfirmationText({
      senderUsername: tournament.senderUsername,
      title: tournament.tournamentTitle || "",
      others: rows.map((row) => String(row.display_name)),
      othersTotal: Number(rows[0]?.total) || 0,
      playerCount: Number(counts?.players) || 0,
    }),
  };
}

// Answers a !join in chat: a confirmation for a new entry, or the full /
// waitlist notice. Runs strictly after the ingest transaction commits and
// never feeds back into the webhook response.
async function replyTournamentChatOutcome(tournament, env, {
  rateLimit = defaultRateLimit,
  dbOne = one,
  dbQuery = (sql, params) => query(sql, params),
  kvGet = kvGetDefault,
  kvPut = kvPutDefault,
  ...sendDeps
} = {}) {
  const tournamentId = tournament.tournamentId;
  const rl = await rateLimit(env, `tournament-chat-reply:${tournamentId}`, 3, 30);
  if (!rl.ok) {
    console.info(JSON.stringify({ event: "tournament_chat_reply_throttled", tournamentId }));
    return;
  }
  const confirming = tournament.entered && !tournament.waitlisted;
  let content;
  let ackAt = null;
  if (confirming) {
    const confirmation = await joinConfirmationContent(tournament, env, { dbOne, dbQuery, kvGet });
    content = confirmation.content;
    ackAt = confirmation.at;
  } else {
    content = tournament.waitlisted
      ? `@${tournament.senderUsername} Signups are full — you're on the waitlist (#${tournament.waitlistPosition}).`
      : `@${tournament.senderUsername} Signups are full.`;
  }
  const sent = await sendTournamentChatMessage(env, {
    tournamentId,
    ownerUserId: tournament.ownerUserId,
    broadcasterUserId: tournament.broadcasterUserId,
    content,
    replyToMessageId: tournament.messageId,
  }, { dbOne, ...sendDeps });
  if (sent && confirming && ackAt) await kvPut(env, JOIN_ACK_KEY(tournamentId), ackAt, JOIN_ACK_TTL_SECONDS);
}

export async function handleKickWebhook(
  request,
  env,
  {
    ingestChatMessage = ingestKickChatMessage,
    ingestTournamentMessage = (payload, env, tx) => ingestTournamentChatMessageTx(tx, payload),
    withTransaction: withTransactionImpl = withTransaction,
    markEventObserved = markChannelEventObserved,
    replyDeps,
  } = {},
) {
  const rawBody = await request.text();
  const messageId = request.headers.get("Kick-Event-Message-Id");
  const timestamp = request.headers.get("Kick-Event-Message-Timestamp");
  const signature = request.headers.get("Kick-Event-Signature");
  const eventType = request.headers.get("Kick-Event-Type");

  if (!messageId || !timestamp || !signature || !eventType) {
    return bad("Missing Kick webhook headers", 400);
  }

  const publicKeyPem = env.KICK_WEBHOOK_PUBLIC_KEY;
  if (!publicKeyPem) {
    console.error("[kick-webhook] KICK_WEBHOOK_PUBLIC_KEY is not configured");
    return bad("Webhook public key not configured", 500);
  }

  const signedMessage = `${messageId}.${timestamp}.${rawBody}`;
  const isValid = await verifyKickWebhookSignature(publicKeyPem, signedMessage, signature);
  if (!isValid) {
    return bad("Invalid webhook signature", 401);
  }

  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return bad("Invalid webhook timestamp", 400);
  }
  const now = Date.now();
  if (now - timestampMs > KICK_WEBHOOK_MAX_AGE_MS || timestampMs > now + 60_000) {
    return bad("Webhook event timestamp outside accepted window", 400);
  }

  // Acknowledge any event we don't care about so Kick doesn't retry.
  if (eventType !== KICK_REWARD_EVENT && eventType !== KICK_CHAT_MESSAGE_EVENT) {
    return json({ ok: true, ignored: eventType });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return bad("Invalid JSON body", 400);
  }

  if (eventType === KICK_CHAT_MESSAGE_EVENT) {
    try {
      // The receipt row commits with the side effects or not at all: a failed
      // transaction rolls it back so a Kick retry processes normally, and a
      // concurrent duplicate blocks on the PK then sees the conflict.
      const outcome = await withTransactionImpl(async (tx) => {
        const run = (sql, params) => tx.unsafe(sql, params);
        const claimed = await tx.one(
          `INSERT INTO provider_webhook_receipts (provider, message_id, event_type)
           VALUES ('kick', $1, $2) ON CONFLICT (provider, message_id) DO NOTHING
           RETURNING message_id`,
          [messageId, eventType]
        );
        if (!claimed) return { duplicate: true };
        // A received event is proof the subscription exists: stamp it so the
        // dashboard's delivery state reflects traffic, not just reconciliations.
        await markEventObserved(run, "kick", String(payload.broadcaster?.user_id ?? ""), "chatEvents");
        const chat = await ingestChatMessage(payload, env, run);
        const tournament = await ingestTournamentMessage(payload, env, tx);
        return { duplicate: false, chat, tournament };
      });
      // Chat replies go out only after the entry write committed, and a reply
      // failure must never turn into a webhook failure (Kick would retry).
      if (outcome.tournament?.entered || outcome.tournament?.full || outcome.tournament?.waitlisted) {
        try {
          await replyTournamentChatOutcome(outcome.tournament, env, replyDeps);
        } catch (err) {
          console.error(JSON.stringify({
            event: "tournament_chat_reply_failed",
            tournamentId: outcome.tournament.tournamentId,
            status: null,
            reason: String(err?.message || err).slice(0, 200),
          }));
        }
      }
      return json({ ok: true, ...outcome });
    } catch (err) {
      console.error("[kick-webhook] chat ingest failed:", err?.message || err);
      return bad("Chat event processing failed", 500);
    }
  }

  // Receiving a reward event proves the subscription exists regardless of
  // whether the status ends up queued; never let the stamp fail the webhook.
  try {
    await markEventObserved((sql, p) => query(sql, p), "kick", String(payload.broadcaster?.user_id ?? ""), "rewardEvents");
  } catch (err) {
    console.error("[kick-webhook] marking reward event observed failed:", err?.message || err);
  }

  // Queue creditable completions and reversible cancellations/refunds.
  if (!isCreditableKickStatus(payload.status) && !isReversibleKickStatus(payload.status)) {
    return json({ ok: true, skipped: payload.status });
  }

  const producer = createQueueProducer(env.EVENTS_QUEUE, processFallback, env);

  try {
    await producer.send({
      type: "kick-redemption",
      messageId,
      eventType,
      payload,
    });
    return json({ ok: true, queued: true });
  } catch (err) {
    console.error("[kick-webhook] enqueue/fallback failed:", err?.message || err);
    return bad("Failed to queue redemption", 500);
  }
}