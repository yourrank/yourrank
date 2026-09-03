// Durable processing ledger for queue side effects.
//
// One row per logical event id (see queue-producer.ts envelope). Two modes:
//
//  * runOnceInTransaction — for database-only side effects (analytics bumps,
//    click rows). The ledger claim and the side effect share ONE transaction,
//    so a duplicate delivery either blocks on the unique key until the first
//    commit and then sees `completed`, or runs after a rollback and applies
//    exactly once.
//
//  * runOnceWithLease — for external side effects (Telegram/Discord). The claim
//    commits first, the provider is called, then the row is completed. Neither
//    provider offers idempotency keys, so exactly-once is NOT enforceable:
//    a transport failure without a response, or a lease that expired while a
//    delivery may have been in flight, becomes a durable `ambiguous` row that
//    is never blindly retried. Clear provider rejections become `failed` and
//    stay retryable through the queue's normal retry budget.
import { exec, withTransaction, type Tx } from "./db.js";

export type LedgerState = "processing" | "completed" | "failed" | "ambiguous";

export type LedgerIdentitySource = "envelope" | "cloudflare_message_id";

export interface LedgerIdentity {
  eventId: string;
  eventType: string;
  correlationId?: string | null;
  identitySource: LedgerIdentitySource;
}

export type LedgerOutcome =
  | { outcome: "applied" }
  | { outcome: "duplicate"; state: LedgerState | "unknown" }
  | { outcome: "ambiguous"; reason: "lease_expired" | "provider_no_response" };

const DEFAULT_LEASE_SECONDS = 120;

const CLAIM_SQL = `INSERT INTO queue_event_ledger
    (event_id, event_type, correlation_id, identity_source, state, attempts, lease_expires_at, first_seen_at, last_error)
  VALUES ($1, $2, $3, $4, 'processing', 1, now() + ($5::int * interval '1 second'), now(), NULL)
  ON CONFLICT (event_id) DO UPDATE
    SET state = 'processing',
        attempts = queue_event_ledger.attempts + 1,
        lease_expires_at = now() + ($5::int * interval '1 second'),
        last_error = NULL
    WHERE queue_event_ledger.state = 'failed'
       OR (queue_event_ledger.state = 'processing'
           AND queue_event_ledger.lease_expires_at < now()
           AND $6::boolean)
  RETURNING attempts`;

const STATE_SQL = `SELECT state, lease_expires_at < now() AS lease_expired FROM queue_event_ledger WHERE event_id = $1`;

const COMPLETE_SQL = `UPDATE queue_event_ledger
  SET state = 'completed', completed_at = now(), lease_expires_at = NULL
  WHERE event_id = $1 AND state = 'processing'`;

const FAIL_SQL = `UPDATE queue_event_ledger
  SET state = 'failed', last_error = left($2, 500), lease_expires_at = NULL
  WHERE event_id = $1 AND state = 'processing'`;

const AMBIGUOUS_SQL = `UPDATE queue_event_ledger
  SET state = 'ambiguous', last_error = left($2, 500), lease_expires_at = NULL
  WHERE event_id = $1 AND state = 'processing'`;

function logLedger(event: string, identity: LedgerIdentity, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({
    event,
    event_id: identity.eventId,
    event_type: identity.eventType,
    correlation_id: identity.correlationId ?? null,
    identity_source: identity.identitySource,
    ...extra,
    ts: new Date().toISOString(),
  }));
}

/**
 * Apply a database-only side effect exactly once per event id. The handler
 * receives the transaction the ledger claim was made in and MUST perform all
 * writes through it.
 */
export async function runOnceInTransaction(
  identity: LedgerIdentity,
  handler: (tx: Tx) => Promise<void>,
  { withTransactionImpl = withTransaction, leaseSeconds = DEFAULT_LEASE_SECONDS }: {
    withTransactionImpl?: typeof withTransaction;
    leaseSeconds?: number;
  } = {},
): Promise<LedgerOutcome> {
  return withTransactionImpl(async (tx) => {
    const claimed = await tx.query<{ attempts: number }>(CLAIM_SQL, [
      identity.eventId,
      identity.eventType,
      identity.correlationId ?? null,
      identity.identitySource,
      leaseSeconds,
      true,
    ]);
    if (claimed.length === 0) {
      const existing = await tx.one<{ state: LedgerState }>(STATE_SQL, [identity.eventId]);
      const state = existing?.state ?? "unknown";
      logLedger("queue_duplicate_event_suppressed", identity, { state });
      return { outcome: "duplicate", state };
    }
    await handler(tx);
    await tx.query(COMPLETE_SQL, [identity.eventId]);
    return { outcome: "applied" };
  });
}

/**
 * Perform an external side effect at most once per event id.
 *
 * Handler errors flagged `ambiguous === true` (no provider response) and
 * expired leases are persisted as `ambiguous` and swallowed: the queue must not
 * blindly redeliver something that may already have reached the user. Any other
 * error is persisted as `failed` and rethrown so the queue's retry policy applies.
 */
export async function runOnceWithLease(
  identity: LedgerIdentity,
  handler: () => Promise<void>,
  { execImpl = exec, leaseSeconds = DEFAULT_LEASE_SECONDS }: {
    execImpl?: typeof exec;
    leaseSeconds?: number;
  } = {},
): Promise<LedgerOutcome> {
  const claimed = await execImpl(CLAIM_SQL, [
    identity.eventId,
    identity.eventType,
    identity.correlationId ?? null,
    identity.identitySource,
    leaseSeconds,
    false,
  ]);
  if (claimed.length === 0) {
    const [existing] = await execImpl(STATE_SQL, [identity.eventId]) as Array<{ state: LedgerState; lease_expired: boolean }>;
    if (existing?.state === "processing" && existing.lease_expired) {
      await execImpl(AMBIGUOUS_SQL, [identity.eventId, "lease expired while delivery may have been in flight"]);
      logLedger("queue_delivery_ambiguous", identity, { reason: "lease_expired" });
      return { outcome: "ambiguous", reason: "lease_expired" };
    }
    const state = existing?.state ?? "unknown";
    logLedger("queue_duplicate_event_suppressed", identity, { state });
    return { outcome: "duplicate", state };
  }

  try {
    await handler();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (typeof err === "object" && err !== null && (err as { ambiguous?: unknown }).ambiguous === true) {
      await execImpl(AMBIGUOUS_SQL, [identity.eventId, message]);
      logLedger("queue_delivery_ambiguous", identity, { reason: "provider_no_response" });
      return { outcome: "ambiguous", reason: "provider_no_response" };
    }
    await execImpl(FAIL_SQL, [identity.eventId, message]);
    throw err;
  }
  await execImpl(COMPLETE_SQL, [identity.eventId]);
  return { outcome: "applied" };
}

export const ledgerSql = {
  claim: CLAIM_SQL,
  state: STATE_SQL,
  complete: COMPLETE_SQL,
  fail: FAIL_SQL,
  ambiguous: AMBIGUOUS_SQL,
};
