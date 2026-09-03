// DLQ inspection and replay.
//
// Replay is an exclusive-lease state machine on queue_dlq_events:
//
//   pending ──claim (FOR UPDATE SKIP LOCKED)──▶ replaying ──send ok──▶ replayed
//      ▲                                          │  │
//      └──────── send failed, attempts left ──────┘  ├── body invalid ──▶ invalid (terminal)
//                                                    └── attempts exhausted ─▶ failed (terminal)
//
// A lease that expires while `replaying` (caller crashed between enqueue and
// completion) is reclaimable by the next caller; the message body — and with it
// the original eventId/correlationId of an envelope — is re-sent verbatim, so
// downstream idempotency collapses the duplicate. Legacy flat bodies carry no
// producer identity, so a reclaimed legacy replay may be applied twice; that
// limitation is reported rather than papered over.
import { exec, query } from "@yourrank/shared/db";
import { parseQueueMessage } from "@yourrank/shared/queue-producer";
import { errMessage } from "./errors.js";

export const DLQ_REPLAY_LEASE_SECONDS = 120;

const DLQ_SUMMARY_SQL = `SELECT event_type,
       count(*)::int AS pending,
       count(*) FILTER (WHERE replay_state IN ('failed', 'invalid'))::int AS terminal,
       min(received_at) AS oldest_received_at,
       max(replay_attempts)::int AS max_attempts
FROM queue_dlq_events
WHERE replayed_at IS NULL
GROUP BY event_type
ORDER BY pending DESC`;

const DLQ_PAGE_SQL = `SELECT message_id, queue_name, event_type, event_id, correlation_id, received_at,
       replay_attempts, replay_state, replay_lease_expires_at, last_replay_error
FROM queue_dlq_events
WHERE replayed_at IS NULL
ORDER BY received_at ASC
LIMIT $1`;

const DLQ_PAGE_BODY_SQL = `SELECT message_id, body
FROM queue_dlq_events
WHERE message_id = ANY($1::text[])`;

// Rows still marked replaying whose lease expired after the attempt budget was
// spent can never be claimed again; make that terminal and visible.
const DLQ_EXPIRE_EXHAUSTED_SQL = `UPDATE queue_dlq_events
SET replay_state = 'failed',
    replay_lease_token = NULL,
    replay_lease_expires_at = NULL,
    replay_state_changed_at = now(),
    last_replay_error = coalesce(last_replay_error, 'replay lease expired after max attempts')
WHERE replayed_at IS NULL
  AND replay_state = 'replaying'
  AND replay_lease_expires_at < now()
  AND replay_attempts >= $1
RETURNING message_id`;

function claimSql(byIds: boolean): string {
  return `WITH candidate AS (
  SELECT message_id, replay_state AS prior_state
  FROM queue_dlq_events
  WHERE replayed_at IS NULL
    AND replay_attempts < $1
    AND (COALESCE(replay_state, 'pending') = 'pending'
         OR (replay_state = 'replaying' AND replay_lease_expires_at < now()))
    ${byIds ? "AND message_id = ANY($4::text[])" : ""}
  ORDER BY received_at ASC
  LIMIT $2
  FOR UPDATE SKIP LOCKED
)
UPDATE queue_dlq_events q
SET replay_state = 'replaying',
    replay_attempts = q.replay_attempts + 1,
    replay_lease_token = $3,
    replay_lease_expires_at = now() + (${DLQ_REPLAY_LEASE_SECONDS} * interval '1 second'),
    replay_state_changed_at = now()
FROM candidate
WHERE q.message_id = candidate.message_id
RETURNING q.message_id, q.queue_name, q.event_type, q.body, q.replay_attempts, q.event_id, q.correlation_id,
          (candidate.prior_state = 'replaying') AS reclaimed`;
}

const DLQ_CLAIM_BY_IDS_SQL = claimSql(true);
const DLQ_CLAIM_OLDEST_SQL = claimSql(false);

// Every transition out of `replaying` is a compare-and-set on the lease token,
// so a stale holder can never overwrite a newer lease's outcome.
const DLQ_MARK_REPLAYED_SQL = `UPDATE queue_dlq_events
SET replay_state = 'replayed', replayed_at = now(),
    replay_lease_token = NULL, replay_lease_expires_at = NULL, replay_state_changed_at = now()
WHERE message_id = $1 AND replay_state = 'replaying' AND replay_lease_token = $2
RETURNING message_id`;

const DLQ_MARK_INVALID_SQL = `UPDATE queue_dlq_events
SET replay_state = 'invalid', last_replay_error = left($3, 500),
    replay_lease_token = NULL, replay_lease_expires_at = NULL, replay_state_changed_at = now()
WHERE message_id = $1 AND replay_state = 'replaying' AND replay_lease_token = $2
RETURNING message_id`;

const DLQ_MARK_SEND_FAILED_SQL = `UPDATE queue_dlq_events
SET replay_state = CASE WHEN replay_attempts >= $4 THEN 'failed' ELSE 'pending' END,
    last_replay_error = left($3, 500),
    replay_lease_token = NULL, replay_lease_expires_at = NULL, replay_state_changed_at = now()
WHERE message_id = $1 AND replay_state = 'replaying' AND replay_lease_token = $2
RETURNING replay_state`;

type QueryImpl = (text: string, params?: unknown[]) => Promise<any[]>;
type ExecImpl = (text: string, params?: unknown[]) => Promise<any[]>;

export type DlqDb = {
  queryImpl?: QueryImpl;
  execImpl?: ExecImpl;
};

export type DlqReplayRow = {
  message_id: string;
  queue_name: string;
  event_type: string;
  body: unknown;
  replay_attempts: number;
  event_id: string | null;
  correlation_id: string | null;
  reclaimed: boolean;
};

export type DlqReplaySend = (body: unknown, row: DlqReplayRow) => Promise<void>;

function boundedLimit(value: unknown, fallback: number, cap: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(Math.floor(parsed), cap) : fallback;
}

export async function getDlqPage(
  limit = 50,
  includeBody = false,
  { queryImpl = query }: DlqDb = {},
): Promise<{ summary: unknown[]; rows: unknown[] }> {
  const pageLimit = boundedLimit(limit, 50, 200);
  const [summary, rows] = await Promise.all([
    queryImpl(DLQ_SUMMARY_SQL),
    queryImpl(DLQ_PAGE_SQL, [pageLimit]),
  ]);

  if (!includeBody || rows.length === 0) return { summary, rows };

  const bodies = await queryImpl(DLQ_PAGE_BODY_SQL, [rows.map((row) => row.message_id)]);
  const bodyById = new Map(bodies.map((row) => [row.message_id, row.body]));
  return {
    summary,
    rows: rows.map((row) => ({ ...row, body: bodyById.get(row.message_id) })),
  };
}

type DlqReplayIds = {
  replayed: string[];
  invalid: string[];
  skipped: string[];
  failed: string[];
  reclaimed: string[];
  exhausted: string[];
};

export type DlqReplayResult = {
  replayed: { count: number; ids: string[] };
  invalid: { count: number; ids: string[] };
  skipped: { count: number; ids: string[] };
  failed: { count: number; ids: string[] };
  reclaimed: { count: number; ids: string[] };
  exhausted: { count: number; ids: string[] };
};

function summarizeReplay(ids: DlqReplayIds): DlqReplayResult {
  return {
    replayed: { count: ids.replayed.length, ids: ids.replayed },
    invalid: { count: ids.invalid.length, ids: ids.invalid },
    skipped: { count: ids.skipped.length, ids: ids.skipped },
    failed: { count: ids.failed.length, ids: ids.failed },
    reclaimed: { count: ids.reclaimed.length, ids: ids.reclaimed },
    exhausted: { count: ids.exhausted.length, ids: ids.exhausted },
  };
}

function replayLog(outcome: string, row: DlqReplayRow, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    level: outcome === "replayed" || outcome === "lease_acquired" ? "info" : "error",
    ctx: "dlq-replay",
    outcome,
    message_id: row.message_id,
    event_id: row.event_id ?? null,
    correlation_id: row.correlation_id ?? null,
    event_type: row.event_type,
    replay_attempts: row.replay_attempts,
    reclaimed: row.reclaimed === true,
    ...extra,
  });
  if (outcome === "replayed" || outcome === "lease_acquired") console.log(line);
  else console.error(line);
}

export async function replayDlq(
  options: {
    messageIds?: string[];
    limit?: number;
    maxAttempts?: number;
    sendImpl: DlqReplaySend;
    leaseToken?: string;
  },
  { execImpl = exec }: DlqDb = {},
): Promise<DlqReplayResult> {
  const maxAttempts = boundedLimit(options.maxAttempts, 3, 1000);
  const limit = boundedLimit(options.limit, 10, 100);
  const leaseToken = options.leaseToken || crypto.randomUUID();
  const ids = Array.isArray(options.messageIds)
    ? options.messageIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const result: DlqReplayIds = { replayed: [], invalid: [], skipped: [], failed: [], reclaimed: [], exhausted: [] };

  const exhausted = await execImpl(DLQ_EXPIRE_EXHAUSTED_SQL, [maxAttempts]);
  for (const row of exhausted) {
    result.exhausted.push(row.message_id);
    console.error(JSON.stringify({ level: "error", ctx: "dlq-replay", outcome: "terminal_failed", message_id: row.message_id, reason: "lease expired after max attempts" }));
  }

  const rows = ids.length > 0
    ? await execImpl(DLQ_CLAIM_BY_IDS_SQL, [maxAttempts, Math.min(ids.length, 100), leaseToken, ids])
    : await execImpl(DLQ_CLAIM_OLDEST_SQL, [maxAttempts, limit, leaseToken]);

  const claimedIds = new Set((rows as DlqReplayRow[]).map((row) => row.message_id));
  for (const id of ids) if (!claimedIds.has(id)) result.skipped.push(id);

  for (const row of rows as DlqReplayRow[]) {
    replayLog("lease_acquired", row, { lease_token: leaseToken });
    if (row.reclaimed) {
      result.reclaimed.push(row.message_id);
      replayLog("lease_reclaimed", row);
    }

    let body: unknown;
    try {
      const parsed = parseQueueMessage(row.body);
      body = parsed.legacy ? parsed.event : parsed.envelope;
    } catch (err) {
      await execImpl(DLQ_MARK_INVALID_SQL, [row.message_id, leaseToken, errMessage(err)]);
      result.invalid.push(row.message_id);
      replayLog("terminal_invalid", row, { error: errMessage(err) });
      continue;
    }

    try {
      await options.sendImpl(body, row);
    } catch (err) {
      const [state] = await execImpl(DLQ_MARK_SEND_FAILED_SQL, [row.message_id, leaseToken, errMessage(err), maxAttempts]);
      result.failed.push(row.message_id);
      replayLog(state?.replay_state === "failed" ? "terminal_failed" : "failed", row, { error: errMessage(err) });
      continue;
    }

    const done = await execImpl(DLQ_MARK_REPLAYED_SQL, [row.message_id, leaseToken]);
    if (done.length === 0) {
      // Lease was lost (expired and reclaimed) between send and completion; the
      // reclaimer re-sent the same body, downstream dedupes on eventId.
      result.skipped.push(row.message_id);
      replayLog("lease_lost_after_send", row);
      continue;
    }
    result.replayed.push(row.message_id);
    replayLog("replayed", row);
  }

  return summarizeReplay(result);
}

export const dlqSql = {
  summary: DLQ_SUMMARY_SQL,
  page: DLQ_PAGE_SQL,
  expireExhausted: DLQ_EXPIRE_EXHAUSTED_SQL,
  claimByIds: DLQ_CLAIM_BY_IDS_SQL,
  claimOldest: DLQ_CLAIM_OLDEST_SQL,
  markReplayed: DLQ_MARK_REPLAYED_SQL,
  markInvalid: DLQ_MARK_INVALID_SQL,
  markSendFailed: DLQ_MARK_SEND_FAILED_SQL,
};
