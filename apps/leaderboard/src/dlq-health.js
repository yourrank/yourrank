import { one } from "@yourrank/shared/db";
import { errMessage } from "@yourrank/shared/errors";

const DLQ_HEALTH_LIMIT = 1000;

const DLQ_HEALTH_SQL = `SELECT count(*)::int AS pending,
       min(received_at) AS oldest_received_at
FROM (
  SELECT received_at FROM queue_dlq_events WHERE replayed_at IS NULL ORDER BY received_at ASC LIMIT $1
) t`;

export async function readDlqHealth(
  queryImpl = one,
  threshold = 100,
  limit = DLQ_HEALTH_LIMIT,
  maxAgeSeconds = 86400,
) {
  try {
    const row = await queryImpl(DLQ_HEALTH_SQL, [limit]);
    const pending = Number(row?.pending || 0);
    const oldestPendingAt = row?.oldest_received_at ?? null;
    const oldestPendingMs = oldestPendingAt instanceof Date
      ? oldestPendingAt.getTime()
      : oldestPendingAt
        ? Date.parse(oldestPendingAt)
        : NaN;
    const oldestPendingAgeSeconds = Number.isFinite(oldestPendingMs)
      ? Math.max(0, Math.floor((Date.now() - oldestPendingMs) / 1000))
      : null;
    const countDegraded = pending >= threshold;
    const ageDegraded = pending > 0
      && oldestPendingAgeSeconds !== null
      && oldestPendingAgeSeconds >= maxAgeSeconds;
    return {
      pending,
      oldest_pending_at: oldestPendingAt,
      oldest_pending_age_seconds: oldestPendingAgeSeconds,
      pending_capped: pending >= limit,
      degraded: countDegraded || ageDegraded,
      degraded_reasons: [countDegraded ? "count_threshold" : null, ageDegraded ? "oldest_pending_age" : null].filter(Boolean),
      error: null,
    };
  } catch (err) {
    console.error(JSON.stringify({
      level: "error",
      ctx: "dlq-health",
      outcome: "probe_failed",
      error: errMessage(err),
    }));
    return {
      pending: null,
      oldest_pending_at: null,
      oldest_pending_age_seconds: null,
      pending_capped: false,
      degraded: true,
      degraded_reasons: ["probe_failed"],
      error: "probe_failed",
    };
  }
}

export { DLQ_HEALTH_LIMIT, DLQ_HEALTH_SQL };
