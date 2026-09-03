// Queue producer for YourRank (Phase 6.1)
// Enqueues click, conversion, and analytics events to Cloudflare Queues
// instead of writing to Postgres inline.

import { z } from "zod";
import { currentCorrelationId } from "./request-id.js";

const id = z.string().min(1).max(128);
const label = z.string().max(256);
const timestamp = z.number().int().nonnegative();

const clickEventSchema = z.object({
  type: z.literal("click"),
  shortLinkId: id,
  ipHash: z.string().regex(/^[a-f0-9]{64}$/),
  tgUserId: z.number().int().positive().safe().nullable(),
  clickRef: z.string().min(1).max(128),
  timestamp,
}).strict();

const conversionEventSchema = z.object({
  type: z.literal("conversion"),
  ownerId: id,
  query: z.record(z.union([z.string(), z.array(z.string())])),
  timestamp,
}).strict();

const bumpEventSchema = z.object({
  type: z.literal("bump"),
  siteId: id,
  field: z.enum(["views", "copies", "clicks"]),
  referer: z.string().max(2_048).nullable(),
  visitorHash: z.string().max(128).nullable().optional(),
  timestamp,
}).strict();

const top3NotifyEventSchema = z.object({
  type: z.literal("notify"),
  kind: z.literal("top3"),
  siteId: id,
  siteName: label,
  changes: z.array(z.object({
    name: label,
    rank: z.number().int().positive(),
    wagered: z.number().finite(),
  }).strict()).max(3),
}).strict();

const resetNotifyEventSchema = z.object({
  type: z.literal("notify"),
  kind: z.literal("reset"),
  siteId: id,
  siteName: label,
  players: z.array(z.object({
    name: label,
    wagered: z.number().finite(),
    prize: z.number().finite().optional(),
  }).strict()).max(10_000),
  period: z.string().max(64),
}).strict();

const playerRankNotifyEventSchema = z.object({
  type: z.literal("notify"),
  kind: z.literal("player-rank"),
  siteId: id,
  siteName: label,
  playerName: label,
  oldRank: z.number().int().positive().nullable(),
  newRank: z.number().int().positive(),
  botId: id,
  tgUserId: z.number().int().positive().safe(),
}).strict();

const kickRewardRedemptionEventSchema = z.object({
  type: z.literal("kick-redemption"),
  messageId: id,
  eventType: z.string().max(128),
  payload: z.record(z.unknown()),
}).strict();

const accountExportEventSchema = z.object({
  type: z.literal("account-export"),
  exportId: id,
  userId: id,
}).strict();

const viewerExportEventSchema = z.object({
  type: z.literal("viewer-export"),
  exportId: id,
  viewerId: id,
}).strict();

export const queueEventSchema = z.union([
  clickEventSchema,
  conversionEventSchema,
  bumpEventSchema,
  top3NotifyEventSchema,
  resetNotifyEventSchema,
  playerRankNotifyEventSchema,
  kickRewardRedemptionEventSchema,
  accountExportEventSchema,
  viewerExportEventSchema,
]);

export type QueueEvent = z.infer<typeof queueEventSchema>;
export type ClickEvent = z.infer<typeof clickEventSchema>;
export type ConversionEvent = z.infer<typeof conversionEventSchema>;
export type BumpEvent = z.infer<typeof bumpEventSchema>;
export type NotifyEvent =
  | z.infer<typeof top3NotifyEventSchema>
  | z.infer<typeof resetNotifyEventSchema>
  | z.infer<typeof playerRankNotifyEventSchema>;
export type KickRewardRedemptionEvent = z.infer<typeof kickRewardRedemptionEventSchema>;
export type AccountExportEvent = z.infer<typeof accountExportEventSchema>;
export type ViewerExportEvent = z.infer<typeof viewerExportEventSchema>;

export function parseQueueEvent(input: unknown): QueueEvent {
  return queueEventSchema.parse(input);
}

// ---------------------------------------------------------------------------
// Canonical envelope
//
// `eventId` is the identity of the logical side effect. It is minted once by
// the producer and preserved verbatim across queue retries, DLQ persistence,
// replay and consumer processing; consumers never regenerate it. Legacy flat
// events (no envelope) remain accepted while the queues drain.
// ---------------------------------------------------------------------------

export const QUEUE_ENVELOPE_VERSION = 1;

const envelopeId = z.string().min(8).max(160);

export const queueEnvelopeSchema = z.object({
  v: z.literal(QUEUE_ENVELOPE_VERSION),
  eventId: envelopeId,
  eventType: z.string().min(1).max(64),
  createdAt: z.string().datetime(),
  causationId: envelopeId.optional(),
  correlationId: z.string().min(1).max(160).optional(),
  payload: queueEventSchema,
}).strict().refine((env) => env.eventType === env.payload.type, {
  message: "envelope eventType must match payload.type",
});

export type QueueEnvelope = z.infer<typeof queueEnvelopeSchema>;

export type ParsedQueueMessage =
  | { legacy: false; envelope: QueueEnvelope; event: QueueEvent; eventId: string }
  | { legacy: true; envelope: null; event: QueueEvent; eventId: null };

export function isQueueEnvelope(input: unknown): boolean {
  return typeof input === "object" && input !== null && "payload" in input && "eventId" in input;
}

/**
 * Parse either a canonical envelope or a legacy flat event. Legacy events carry
 * no producer-assigned identity; callers must not invent one (they may only use
 * the delivery's Cloudflare message id, which is stable across retries of that
 * one delivery but not across producer-side duplicates or replays).
 */
export function parseQueueMessage(input: unknown): ParsedQueueMessage {
  if (isQueueEnvelope(input)) {
    const envelope = queueEnvelopeSchema.parse(input);
    return { legacy: false, envelope, event: envelope.payload, eventId: envelope.eventId };
  }
  return { legacy: true, envelope: null, event: queueEventSchema.parse(input), eventId: null };
}

export function newQueueEventId(): string {
  return crypto.randomUUID();
}

export interface EnvelopeOptions {
  eventId?: string;
  correlationId?: string | null;
  causationId?: string | null;
}

export function buildQueueEnvelope(event: QueueEvent, options: EnvelopeOptions = {}): QueueEnvelope {
  const envelope: QueueEnvelope = {
    v: QUEUE_ENVELOPE_VERSION,
    eventId: options.eventId || newQueueEventId(),
    eventType: event.type,
    createdAt: new Date().toISOString(),
    payload: event,
  };
  const correlationId = options.correlationId === undefined ? currentCorrelationId() : options.correlationId;
  if (correlationId) envelope.correlationId = String(correlationId).slice(0, 160);
  if (options.causationId) envelope.causationId = options.causationId;
  return envelope;
}

export type QueueFallback = (event: QueueEvent, env: any, envelope: QueueEnvelope) => Promise<void>;

interface QueueProducer {
  send(message: QueueEvent, options?: EnvelopeOptions): Promise<QueueEnvelope>;
  sendBatch(messages: QueueEvent[], options?: EnvelopeOptions): Promise<QueueEnvelope[]>;
}

// Cloudflare Queues accepts at most 100 messages in one sendBatch request.
const QUEUE_BATCH_SIZE = 100;

export class QueueBindingRequiredError extends Error {
  constructor() {
    super("EVENTS_QUEUE binding is required (QUEUE_REQUIRED=true) but is not configured; refusing to downgrade to direct execution");
    this.name = "QueueBindingRequiredError";
  }
}

export function queueBindingRequired(env: unknown): boolean {
  const value = (env as { QUEUE_REQUIRED?: unknown } | undefined)?.QUEUE_REQUIRED;
  return String(value ?? "").toLowerCase() === "true";
}

/**
 * Create a queue producer that sends canonical envelopes to a Cloudflare Queue.
 *
 * The envelope (and therefore the eventId) is built BEFORE the send attempt, so
 * when a send throws after the broker actually accepted the message and the
 * fallback executes the side effect directly, both paths carry the same eventId
 * and the durable event ledger collapses them into one logical effect.
 *
 * When `env.QUEUE_REQUIRED === "true"` a missing binding is a configuration
 * error: direct execution is refused instead of silently replacing durable
 * async processing.
 */
export function createQueueProducer(
  queue: {
    send: (message: unknown) => Promise<void>;
    sendBatch?: (messages: Iterable<{ body: unknown }>) => Promise<unknown>;
  } | undefined,
  fallbackFn: QueueFallback,
  env?: any
): QueueProducer {
  if (!queue && queueBindingRequired(env)) throw new QueueBindingRequiredError();

  const fallbackBatch = async (envelopes: QueueEnvelope[]): Promise<void> => {
    const results = await Promise.allSettled(envelopes.map((envelope) => fallbackFn(envelope.payload, env, envelope)));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) throw failure.reason;
  };

  if (!queue) {
    return {
      async send(event, options) {
        const envelope = buildQueueEnvelope(event, options);
        await fallbackFn(event, env, envelope);
        return envelope;
      },
      async sendBatch(events, options) {
        const envelopes = events.map((event) => buildQueueEnvelope(event, options));
        await fallbackBatch(envelopes);
        return envelopes;
      },
    };
  }

  return {
    async send(event, options) {
      const envelope = buildQueueEnvelope(event, options);
      try {
        await queue.send(envelope);
      } catch (err) {
        console.error(JSON.stringify({
          event: "queue_enqueue_failed_fallback",
          event_id: envelope.eventId,
          event_type: envelope.eventType,
          correlation_id: envelope.correlationId ?? null,
          error: String(err),
        }));
        await fallbackFn(event, env, envelope);
      }
      return envelope;
    },
    async sendBatch(events, options) {
      const envelopes = events.map((event) => buildQueueEnvelope(event, options));
      if (!queue.sendBatch) {
        await fallbackBatch(envelopes);
        return envelopes;
      }
      let firstFailure: unknown;
      for (let i = 0; i < envelopes.length; i += QUEUE_BATCH_SIZE) {
        const chunk = envelopes.slice(i, i + QUEUE_BATCH_SIZE);
        try {
          await queue.sendBatch(chunk.map((body) => ({ body })));
        } catch (err) {
          console.error(JSON.stringify({
            event: "queue_batch_enqueue_failed_fallback",
            event_ids: chunk.map((e) => e.eventId),
            correlation_id: chunk[0]?.correlationId ?? null,
            error: String(err),
          }));
          try {
            await fallbackBatch(chunk);
          } catch (fallbackError) {
            firstFailure ??= fallbackError;
          }
        }
      }
      if (firstFailure) throw firstFailure;
      return envelopes;
    },
  };
}
