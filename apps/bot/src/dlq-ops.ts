// DLQ inspection and replay.
//
// Replay is an exclusive-lease state machine on queue_dlq_events:
//
//   pending ──claim (FOR UPDATE SKIP LOCKED)──▶ replaying ──send ok──▶ replayed
//      ▲                                          │  │
//      └──────── send failed, attempts left ──────┘  ├── body invalid ──▶ invalid (terminal)
//                                                    └── attempts exhausted ─▶ failed (terminal)
//
// Operators can also dispose of an actionable row directly:
//   pending ──acknowledge (operator, bounded reason)──▶ acknowledged (terminal)
//
// Every terminal transition also stamps `resolution` + `resolved_at`
// ('replayed' | 'invalid' | 'exhausted' | 'acknowledged'). Actionable rows are
// `resolved_at IS NULL`; `replayed_at` remains the pure delivery marker and
// is never written by failure paths.
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
       count(*) FILTER (WHERE resolved_at IS NULL)::int AS pending,
       count(*) FILTER (WHERE resolution = 'invalid')::int AS invalid,
       count(*) FILTER (WHERE resolution = 'exhausted')::int AS exhausted,
       count(*) FILTER (WHERE resolution = 'acknowledged')::int AS acknowledged,
       min(received_at) FILTER (WHERE resolved_at IS NULL) AS oldest_received_at,
       max(replay_attempts)::int AS max_attempts
FROM queue_dlq_events
WHERE resolution IS DISTINCT FROM 'replayed'
GROUP BY event_type
ORDER BY pending DESC`;

const pageSql = (includeTerminal: boolean) => `SELECT message_id, queue_name, event_type, event_id, correlation_id, received_at,
       replay_attempts, replay_state, replay_lease_expires_at, last_replay_error,
       resolved_at, resolution, ack_reason
FROM queue_dlq_events
WHERE ${includeTerminal ? "resolution IS DISTINCT FROM 'replayed'" : "resolved_at IS NULL"}
ORDER BY received_at ASC
LIMIT $1`;

const DLQ_PAGE_SQL = pageSql(false);
const DLQ_PAGE_TERMINAL_SQL = pageSql(true);

const DLQ_PAGE_BODY_SQL = `SELECT message_id, body
FROM queue_dlq_events
WHERE message_id = ANY($1::text[])`;

export type DlqPageOptions = { includeBody?: boolean; includeTerminal?: boolean };

// Rows still marked replaying whose lease expired after the attempt budget was
// spent can never be claimed again; make that terminal and visible.
const DLQ_EXPIRE_EXHAUSTED_SQL = `UPDATE queue_dlq_events
SET replay_state = 'failed',
    resolved_at = now(),
    resolution = 'exhausted',
    replay_lease_token = NULL,
    replay_lease_expires_at = NULL,
    replay_state_changed_at = now(),
    last_replay_error = coalesce(last_replay_error, 'replay lease expired after max attempts')
WHERE resolved_at IS NULL
  AND replay_state = 'replaying'
  AND replay_lease_expires_at < now()
  AND replay_attempts >= $1
RETURNING message_id`;

function claimSql(byIds: boolean): string {
  return `WITH candidate AS (
  SELECT message_id, replay_state AS prior_state
  FROM queue_dlq_events
  WHERE resolved_at IS NULL
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
    resolved_at = now(), resolution = 'replayed',
    replay_lease_token = NULL, replay_lease_expires_at = NULL, replay_state_changed_at = now()
WHERE message_id = $1 AND replay_state = 'replaying' AND replay_lease_token = $2
RETURNING message_id`;

const DLQ_MARK_INVALID_SQL = `UPDATE queue_dlq_events
SET replay_state = 'invalid', last_replay_error = left($3, 500),
    resolved_at = now(), resolution = 'invalid',
    replay_lease_token = NULL, replay_lease_expires_at = NULL, replay_state_changed_at = now()
WHERE message_id = $1 AND replay_state = 'replaying' AND replay_lease_token = $2
RETURNING message_id`;

const DLQ_MARK_SEND_FAILED_SQL = `UPDATE queue_dlq_events
SET replay_state = CASE WHEN replay_attempts >= $4 THEN 'failed' ELSE 'pending' END,
    resolved_at = CASE WHEN replay_attempts >= $4 THEN now() END,
    resolution = CASE WHEN replay_attempts >= $4 THEN 'exhausted' END,
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
  { includeBody = false, includeTerminal = false }: DlqPageOptions = {},
  { queryImpl = query }: DlqDb = {},
): Promise<{ summary: unknown[]; rows: unknown[] }> {
  const pageLimit = boundedLimit(limit, 50, 200);
  const [summary, rows] = await Promise.all([
    queryImpl(DLQ_SUMMARY_SQL),
    queryImpl(includeTerminal ? DLQ_PAGE_TERMINAL_SQL : DLQ_PAGE_SQL, [pageLimit]),
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

export const DLQ_ACK_MAX_IDS = 200;
export const DLQ_ACK_REASON_MAX = 200;

export class DlqAcknowledgeInputError extends Error {}

// Operator acknowledgement: a single atomic statement so a row can never be
// half-disposed. Already-resolved rows (replayed/invalid/exhausted) and rows
// still under a live replay lease are never touched; `replay_state`,
// `replayed_at`, body, `last_replay_error`, and `replay_attempts` are left
// untouched so the acknowledge disposition stays a pure audit overlay.
const DLQ_ACKNOWLEDGE_SQL = `WITH requested AS (
  SELECT message_id, resolution FROM queue_dlq_events WHERE message_id = ANY($1::text[])
), updated AS (
  UPDATE queue_dlq_events q
  SET resolution = 'acknowledged', resolved_at = now(), replay_state_changed_at = now(),
      replay_lease_token = NULL, replay_lease_expires_at = NULL, ack_reason = left($2, ${DLQ_ACK_REASON_MAX})
  WHERE q.message_id = ANY($1::text[]) AND q.resolved_at IS NULL
    AND (q.replay_state IS DISTINCT FROM 'replaying' OR q.replay_lease_expires_at < now())
  RETURNING q.message_id
)
SELECT (SELECT count(*)::int FROM updated) AS acknowledged,
       (SELECT count(*)::int FROM requested WHERE resolution = 'acknowledged') AS already_acknowledged,
       (SELECT count(*)::int FROM requested WHERE resolution IS NOT NULL AND resolution <> 'acknowledged') AS skipped_resolved,
       (SELECT count(*)::int FROM requested WHERE resolution IS NULL) - (SELECT count(*)::int FROM updated) AS skipped_leased,
       $3::int - (SELECT count(*)::int FROM requested) AS unknown`;

export type DlqAcknowledgeResult = {
  requested: number;
  acknowledged: number;
  already_acknowledged: number;
  skipped_resolved: number;
  skipped_leased: number;
  unknown: number;
};

export async function acknowledgeDlq(
  { messageIds, reason }: { messageIds: string[]; reason: string },
  { queryImpl = query }: DlqDb = {},
): Promise<DlqAcknowledgeResult> {
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    throw new DlqAcknowledgeInputError("messageIds must be a non-empty array");
  }
  const ids = [...new Set(messageIds)].filter(
    (id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id),
  );
  if (ids.length !== messageIds.length) {
    throw new DlqAcknowledgeInputError("messageIds must be non-empty bounded identifier strings");
  }
  if (ids.length > DLQ_ACK_MAX_IDS) {
    throw new DlqAcknowledgeInputError(`messageIds must not exceed ${DLQ_ACK_MAX_IDS} entries`);
  }
  if (typeof reason !== "string" || !/^[a-z0-9_.:-]{1,200}$/.test(reason)) {
    throw new DlqAcknowledgeInputError(`reason must match ^[a-z0-9_.:-]{1,${DLQ_ACK_REASON_MAX}}$`);
  }
  const [counts] = await queryImpl(DLQ_ACKNOWLEDGE_SQL, [ids, reason, ids.length]);
  const result = { requested: ids.length, ...(counts as Omit<DlqAcknowledgeResult, "requested">) };
  console.log(JSON.stringify({ event: "dlq_acknowledge", ...result }));
  return result;
}

export const dlqSql = {
  summary: DLQ_SUMMARY_SQL,
  page: DLQ_PAGE_SQL,
  pageTerminal: DLQ_PAGE_TERMINAL_SQL,
  expireExhausted: DLQ_EXPIRE_EXHAUSTED_SQL,
  claimByIds: DLQ_CLAIM_BY_IDS_SQL,
  claimOldest: DLQ_CLAIM_OLDEST_SQL,
  markReplayed: DLQ_MARK_REPLAYED_SQL,
  markInvalid: DLQ_MARK_INVALID_SQL,
  markSendFailed: DLQ_MARK_SEND_FAILED_SQL,
  acknowledge: DLQ_ACKNOWLEDGE_SQL,
};
