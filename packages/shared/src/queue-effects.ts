// Idempotent application of queue side effects, shared by the queue consumer
// and by producers' direct-execution fallback so both paths dedupe on the same
// logical event id.
import { one, query } from "./db.js";
import { logMinimizedClick } from "./clicks.js";
import { bumpStatTx } from "./stats.js";
import { dispatchNotifyEvent } from "./notifications.js";
import {
  runOnceInTransaction,
  runOnceWithLease,
  type LedgerIdentity,
  type LedgerOutcome,
} from "./queue-ledger.js";
import type { BumpEvent, ClickEvent, NotifyEvent, ParsedQueueMessage, QueueEnvelope, QueueEvent } from "./queue-producer.js";

/**
 * Resolve the ledger identity for a delivery. Envelopes carry the producer's
 * eventId. Legacy flat events have no logical identity; the only stable handle
 * is the Cloudflare message id, which dedupes retries of that one delivery but
 * cannot detect producer-side duplicates or replays — the identity source is
 * recorded so the limitation stays explicit. Without a message id (legacy event
 * executed via fallback) there is nothing to dedupe on.
 */
export function ledgerIdentityFor(parsed: ParsedQueueMessage, messageId?: string | null): LedgerIdentity | null {
  if (!parsed.legacy) {
    return {
      eventId: parsed.envelope.eventId,
      eventType: parsed.envelope.eventType,
      correlationId: parsed.envelope.correlationId ?? null,
      identitySource: "envelope",
    };
  }
  if (messageId) {
    return {
      eventId: `legacy-msg:${messageId}`,
      eventType: parsed.event.type,
      correlationId: null,
      identitySource: "cloudflare_message_id",
    };
  }
  return null;
}

export function envelopeIdentity(envelope: QueueEnvelope): LedgerIdentity {
  return {
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    correlationId: envelope.correlationId ?? null,
    identitySource: "envelope",
  };
}

type RunOnceInTransaction = typeof runOnceInTransaction;
type RunOnceWithLease = typeof runOnceWithLease;

export async function applyBumpOnce(
  identity: LedgerIdentity,
  event: BumpEvent,
  { runOnceInTransactionImpl = runOnceInTransaction, bumpStatTxImpl = bumpStatTx }: {
    runOnceInTransactionImpl?: RunOnceInTransaction;
    bumpStatTxImpl?: typeof bumpStatTx;
  } = {},
): Promise<LedgerOutcome> {
  return runOnceInTransactionImpl(identity, (tx) =>
    bumpStatTxImpl(tx, event.siteId, event.field, event.referer ?? null, event.visitorHash ?? null));
}

export async function applyClickOnce(
  identity: LedgerIdentity,
  event: ClickEvent,
  { runOnceInTransactionImpl = runOnceInTransaction, logMinimizedClickImpl = logMinimizedClick }: {
    runOnceInTransactionImpl?: RunOnceInTransaction;
    logMinimizedClickImpl?: typeof logMinimizedClick;
  } = {},
): Promise<LedgerOutcome> {
  return runOnceInTransactionImpl(identity, (tx) =>
    logMinimizedClickImpl(event.shortLinkId, event.ipHash, event.tgUserId ?? null, event.clickRef, {
      withTransactionImpl: async (fn) => fn(tx),
    }));
}

/**
 * Producer direct-execution fallback for analytics/click/notify events. Uses
 * the envelope minted before the enqueue attempt, so an enqueue that actually
 * landed but surfaced an error is collapsed by the ledger with the consumer's
 * later processing of the same eventId.
 */
export async function directQueueFallback(event: QueueEvent, env: unknown, envelope: QueueEnvelope): Promise<void> {
  const identity = envelopeIdentity(envelope);
  switch (event.type) {
    case "bump":
      await applyBumpOnce(identity, event);
      return;
    case "click":
      await applyClickOnce(identity, event);
      return;
    case "notify":
      await deliverNotifyOnce(identity, event, env);
      return;
    default:
      throw new Error(`no direct fallback for queue event type ${event.type}`);
  }
}

export async function deliverNotifyOnce(
  identity: LedgerIdentity,
  event: NotifyEvent,
  env: unknown,
  tokenCache: Map<string, string> = new Map(),
  { runOnceWithLeaseImpl = runOnceWithLease, dispatchImpl = dispatchNotifyEvent }: {
    runOnceWithLeaseImpl?: RunOnceWithLease;
    dispatchImpl?: typeof dispatchNotifyEvent;
  } = {},
): Promise<LedgerOutcome> {
  return runOnceWithLeaseImpl(identity, () => dispatchImpl({ one, query }, env, event, tokenCache));
}
