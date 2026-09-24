import { one, query, withTransaction } from "@yourrank/shared/db";
import { decryptToken } from "@yourrank/shared/crypto";
import { effectivePlan, getPlanLimit } from "@yourrank/shared/plans";
import { reserveUsage, releaseUsage, currentPeriodStartSql } from "@yourrank/shared/usage-meters";
import { parseSegment, buildSegmentWhere } from "./broadcast-segment.js";

/** Escape user content for Telegram HTML parse_mode */
const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? "")
  );

// ------------------------------------------------------------------
// Broadcast worker — rate-limited mass sender.
//
// Designed for Cloudflare Cron Triggers: each tick processes ONE
// batch (default 300 messages at ~28 msg/s ≈ 11s of work) and saves
// a cursor, so a broadcast of any size finishes across ticks without
// ever exceeding Workers CPU limits. On Node you can just loop it.
//
// C13/F12: batch ownership is a durable lease (processing_lease_token +
// processing_lease_expires_at), not the FOR UPDATE row lock that ended
// the moment the claim UPDATE committed. While a batch is in flight the
// row is unclaimable and every write is ownership-checked, so a worker
// whose lease expired (or was reclaimed by another tick) cannot advance,
// complete, or fail a broadcast it no longer owns. The lease is RELEASED
// by the same ownership-checked write that ends the batch, so the next
// tick continues immediately; a worker that dies mid-batch self-heals
// after PROCESSING_LEASE_SECONDS.
//
// C14/F13: the cursor only advances past subscribers actually processed
// (sent/failed/blocked). A 429 on the FIRST recipient of a batch leaves
// the cursor untouched — and merely hands the lease back — so the next
// tick retries that recipient instead of skipping them forever.
// ------------------------------------------------------------------

const MSG_INTERVAL_MS = 36; // ~28 msg/s, under Telegram's 30/s cap

// Must comfortably cover one batch's sends (300 × ~36ms pacing + network +
// up to 30s of 429 backoff) but stay short enough that a dead worker's
// broadcast is reclaimed on the tick after expiry.
const PROCESSING_LEASE_SECONDS = 10 * 60;

async function renewBroadcastLease(broadcastId: string, leaseToken: string): Promise<boolean> {
  const renewed = await query<{ id: string }>(
    `UPDATE broadcasts
        SET processing_lease_expires_at = now() + ($3::int * interval '1 second')
      WHERE id = $1
        AND processing_lease_token = $2
        AND processing_lease_expires_at >= now()
      RETURNING id`,
    [broadcastId, leaseToken, PROCESSING_LEASE_SECONDS]
  );
  return renewed.length === 1;
}

interface ActiveBroadcast {
  id: string;
  bot_id: string;
  body: string;
  media_url: string | null;
  buttons: unknown;
  segment: string | null;
  cursor_tg_user_id: number | string;
  sent_count: number;
  fail_count: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function broadcastAtStart(cursor: number | string | null | undefined): boolean {
  return Number(cursor) === 0;
}

export function buildBroadcastTotalCountUpdate(
  segment: ReturnType<typeof parseSegment>,
  botId: string,
  broadcastId: string,
): { text: string; params: unknown[] } {
  const { clause, values } = buildSegmentWhere(segment, 1);
  const broadcastIdParam = values.length + 2;
  return {
    text: `UPDATE broadcasts SET total_count = (
         SELECT count(*) FROM bot_subscribers bs
          WHERE bs.bot_id = $1 AND NOT bs.is_blocked${clause ? ` AND ${clause}` : ""}
       ) WHERE id = $${broadcastIdParam}`,
    params: [botId, ...values, broadcastId],
  };
}

/**
 * Process one batch of the oldest due broadcast.
 * Returns true if there is (possibly) more work to do.
 */
export async function processBroadcastBatch(batchSize = 300, deps: BroadcastWorkerDeps = {}): Promise<boolean> {
  const sendFn = deps.sendTelegram ?? sendTelegram;
  // Auto-resume broadcasts whose monthly-quota pause predates the current
  // UTC month. One statement per tick; quota-blocked rows never re-claim in
  // the same period because paused broadcasts are not claimable.
  await query(
    `UPDATE broadcasts
        SET status = 'scheduled', stop_reason = NULL, paused_period_start = NULL
      WHERE status = 'paused'
        AND stop_reason = 'monthly_quota'
        AND paused_period_start < ${currentPeriodStartSql()}`
  );

  // Claim one due broadcast through a durable lease. SKIP LOCKED keeps
  // concurrent ticks from fighting over the same row at claim time; the
  // lease window then keeps them apart for the whole batch, which the old
  // FOR UPDATE lock (released at claim-commit) could not.
  const leaseToken = crypto.randomUUID();
  const bc = await one<ActiveBroadcast>(
    `UPDATE broadcasts SET status = 'sending',
            processing_lease_token = $1,
            processing_lease_expires_at = now() + ($2::int * interval '1 second')
      WHERE id = (
        SELECT id FROM broadcasts
         WHERE status IN ('scheduled', 'sending')
           AND (scheduled_at IS NULL OR scheduled_at <= now())
           AND (processing_lease_expires_at IS NULL
                OR processing_lease_expires_at < now())
         ORDER BY created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, bot_id, body, media_url, buttons, segment, cursor_tg_user_id, sent_count, fail_count`,
    [leaseToken, PROCESSING_LEASE_SECONDS]
  );
  if (!bc) return false;

  const bot = await one<{ token_encrypted: Buffer; status: string; owner_id: string }>(
    `SELECT token_encrypted, status, owner_id FROM bots WHERE id = $1`,
    [bc.bot_id]
  );
  if (!bot || bot.status !== "active") {
    // Ownership-checked: a worker whose lease was stolen must not fail the
    // broadcast another worker is actively sending. The lease columns are
    // cleared so a terminal row never holds a stale token.
    await query(
      `UPDATE broadcasts SET status = 'failed',
              processing_lease_token = NULL,
              processing_lease_expires_at = NULL
        WHERE id = $1 AND processing_lease_token = $2`,
      [bc.id, leaseToken]
    );
    return true;
  }
  const token = await decryptToken(Buffer.from(bot.token_encrypted));
  const segment = parseSegment(bc.segment);

  // Monthly delivery quota (commercial metering): reserve up to
  // `batchSize` attempts atomically BEFORE any outbound work. The meter
  // row lock serializes same-account reservations, so concurrent workers
  // can never oversubscribe. Unused units are released at every exit —
  // including workers that lose their lease, which release the whole
  // grant so a stale worker never consumes quota.
  const owner = await one<{ plan: string; plan_expires_at: string | null; status: string }>(
    `SELECT plan, plan_expires_at, status FROM users WHERE id = $1`,
    [bot.owner_id]
  );
  const deliveryAllowance = getPlanLimit(effectivePlan(owner), "broadcast_deliveries_per_month");
  const reservation = await withTransaction(async (tx) =>
    reserveUsage({ one: (sql, params) => tx.one(sql, params) }, bot.owner_id, "broadcast_deliveries", batchSize, deliveryAllowance)
  );
  if (reservation.granted === 0) {
    await query(
      `UPDATE broadcasts
          SET status = 'paused', stop_reason = 'monthly_quota',
              paused_period_start = ${currentPeriodStartSql()},
              processing_lease_token = NULL,
              processing_lease_expires_at = NULL
        WHERE id = $1 AND processing_lease_token = $2`,
      [bc.id, leaseToken]
    );
    return true;
  }

  // Set total on first batch. Ownership-checked through the same lease.
  if (broadcastAtStart(bc.cursor_tg_user_id)) {
    const totalCountUpdate = buildBroadcastTotalCountUpdate(segment, bc.bot_id, bc.id);
    const totalParams = totalCountUpdate.params.length; // broadcast id is last
    await query(
      totalCountUpdate.text.replace(
        `WHERE id = $${totalParams}`,
        `WHERE id = $${totalParams} AND processing_lease_token = $${totalParams + 1}`
      ),
      [...totalCountUpdate.params, leaseToken]
    );
  }

  // Broadcasts respect the segment filter (language, last_seen window, etc.).
  const { clause: subClause, values: subValues } = buildSegmentWhere(segment, 3);
  const subs = await query<{ tg_user_id: number; first_name: string | null; tg_username: string | null }>(
    `SELECT bs.tg_user_id, bs.first_name, bs.tg_username FROM bot_subscribers bs
      WHERE bs.bot_id = $1 AND NOT bs.is_blocked AND bs.tg_user_id > $2
           ${subClause ? `AND ${subClause}` : ""}
      ORDER BY bs.tg_user_id
      LIMIT $3`,
    [bc.bot_id, bc.cursor_tg_user_id, reservation.granted, ...subValues]
  );

  if (subs.length === 0) {
    await query(
      `UPDATE broadcasts SET status = 'sent', sent_at = now(),
              processing_lease_token = NULL,
              processing_lease_expires_at = NULL
        WHERE id = $1 AND processing_lease_token = $2`,
      [bc.id, leaseToken]
    );
    return true;
  }

  let sent = 0;
  let failed = 0;
  // C14/F13: start BELOW the first fetched subscriber. If the very first
  // send hits a 429 the loop breaks before anything is processed and the
  // cursor stays where it was, so that subscriber is retried next tick
  // instead of being skipped.
  const claimCursor = Number(bc.cursor_tg_user_id);
  let lastProcessedId = claimCursor - 1;
  for (const sub of subs) {
    // Renew and prove ownership immediately before every irreversible external
    // send. A stale worker may finish the one provider call that was already
    // in flight when its lease was lost, but it must not start another one.
    // Requiring the current lease to still be unexpired also prevents a worker
    // from reviving its own expired token while a reclaim races it.
    if (!(await renewBroadcastLease(bc.id, leaseToken))) break;

    const firstName = sub.first_name || sub.tg_username || "there";
    const personalized = esc(bc.body).replace(/\{name\}/g, esc(firstName));
    const hasMedia = !!bc.media_url;
    const payload: Record<string, unknown> = hasMedia
      ? {
          chat_id: sub.tg_user_id,
          photo: bc.media_url,
          caption: personalized,
          parse_mode: "HTML",
        }
      : {
          chat_id: sub.tg_user_id,
          text: personalized,
          parse_mode: "HTML",
        };
    if (bc.buttons) payload.reply_markup = { inline_keyboard: bc.buttons };

    const method = hasMedia ? "sendPhoto" : "sendMessage";
    try {
      const res = await sendFn(token, method, payload);
      if (res.ok) {
        sent++;
      } else if (res.status === 403) {
        // User blocked the bot — remember it, never retry.
        failed++;
        await query(
          `UPDATE bot_subscribers SET is_blocked = true
            WHERE bot_id = $1 AND tg_user_id = $2`,
          [bc.bot_id, sub.tg_user_id]
        );
      } else if (res.status === 429) {
        // Rate limited — back off and stop this batch early.
        // DON'T advance cursor past unprocessed subscribers.
        const retry = Number((await res.json().catch(() => ({})) as any)?.parameters?.retry_after ?? 3);
        await sleep(Math.min(retry, 30) * 1000);
        break;
      } else {
        failed++;
      }
    } catch (err) {
      failed++; console.error("[broadcast]: sendMessage failed", err);
    }
    lastProcessedId = sub.tg_user_id; // Advance only after processing
    await sleep(MSG_INTERVAL_MS);
  }

  // Final write: cursor/counters/lease release AND the release of unused
  // reserved units happen in one transaction. A worker that lost its lease
  // mid-batch matches 0 rows and releases the whole grant instead of the
  // used remainder, so a stale worker never consumes quota. The 429 break
  // is not an attempt. A thrown statement unwinds via the outer finally,
  // which releases the full grant since nothing was committed.
  let grantSettled = false;
  try {
    if (lastProcessedId >= claimCursor) {
      const attempts = sent + failed;
      const usedAfter = await withTransaction(async (tx) => {
        const updated = await tx.unsafe(
          `UPDATE broadcasts
              SET cursor_tg_user_id = $1,
                  sent_count = sent_count + $2,
                  fail_count = fail_count + $3,
                  processing_lease_token = NULL,
                  processing_lease_expires_at = NULL
            WHERE id = $4 AND processing_lease_token = $5
            RETURNING id`,
          [lastProcessedId, sent, failed, bc.id, leaseToken]
        );
        const meterDb = { one: (sql: string, params?: unknown[]) => tx.one(sql, params) };
        if (!updated.length) {
          // Lease lost before the batch write — release the whole grant.
          await releaseUsage(meterDb, bot.owner_id, "broadcast_deliveries", reservation.granted, reservation.periodStart);
          return null;
        }
        const unused = reservation.granted - attempts;
        if (unused > 0) {
          await releaseUsage(meterDb, bot.owner_id, "broadcast_deliveries", unused, reservation.periodStart);
        }
        return reservation.used - unused;
      });
      grantSettled = true;
      if (usedAfter != null && usedAfter >= deliveryAllowance && subs.length === reservation.granted) {
        // Quota is now exhausted and more subscribers may remain — pause
        // eagerly instead of letting the next tick re-claim and instantly pause.
        await query(
        `UPDATE broadcasts
            SET status = 'paused', stop_reason = 'monthly_quota',
                paused_period_start = ${currentPeriodStartSql()}
          WHERE id = $1 AND status = 'sending'
            AND (SELECT COUNT(*) FROM bot_subscribers bs
                  WHERE bs.bot_id = $2 AND NOT bs.is_blocked AND bs.tg_user_id > $3) > 0`,
          [bc.id, bc.bot_id, lastProcessedId]
        );
      }
    } else {
      // Nothing was processed (the first recipient hit a rate limit): leave
      // cursor and counters untouched, hand the lease back, and release the
      // whole grant — the next tick retries that recipient and re-reserves.
      await withTransaction(async (tx) => {
        await tx.unsafe(
          `UPDATE broadcasts
              SET processing_lease_token = NULL,
                  processing_lease_expires_at = NULL
            WHERE id = $1 AND processing_lease_token = $2`,
          [bc.id, leaseToken]
        );
        await releaseUsage({ one: (sql, params) => tx.one(sql, params) }, bot.owner_id, "broadcast_deliveries", reservation.granted, reservation.periodStart);
      });
      grantSettled = true;
    }
  } finally {
    // Any exit that left the grant unsettled (thrown error before the final
    // write, or a lease-loss path that could not settle inside a tx) returns
    // whatever remains — GREATEST(0, …) makes a double release harmless.
    if (!grantSettled) {
      await releaseUsage({ one }, bot.owner_id, "broadcast_deliveries", reservation.granted, reservation.periodStart);
    }
  }
  return true;
}

type SendTelegram = (token: string, method: string, payload: Record<string, unknown>) => Promise<Response>;

const sendTelegram: SendTelegram = (token, method, payload) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });

export interface BroadcastWorkerDeps {
  sendTelegram?: SendTelegram;
}
