// Provider integration boundary. Loyalty, rewards and membership code must only
// depend on these types, never on a concrete provider's payloads or columns.
// See docs/PROVIDER_PORTABILITY_PLAN.md.

export type ProviderId = "kick" | "discord" | "twitch" | "youtube" | "patreon" | "shopify";

export const PROVIDER_IDS: readonly ProviderId[] = Object.freeze([
  "kick",
  "discord",
  "twitch",
  "youtube",
  "patreon",
  "shopify",
]);

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

export type ProviderCapability =
  | "viewerAuth"
  | "creatorAuth"
  | "channels"
  | "webhooks"
  | "rewards"
  | "roles"
  | "entitlements";

export type NormalizedEventType =
  | "follow"
  | "subscription"
  | "subscription_gift"
  | "reward_redemption"
  | "chat_activity"
  | "raid"
  | "membership_join"
  | "purchase"
  | "manual_award"
  | "quest_completed";

/** Row shape of `integration_events` before it is persisted. */
export interface NormalizedEvent {
  provider: ProviderId;
  externalEventId: string;
  eventType: NormalizedEventType;
  /** Raw provider event name, e.g. `channel.reward.redemption.updated`. */
  payloadType: string | null;
  externalChannelId: string | null;
  externalActorId: string | null;
  status: string | null;
  payload: Record<string, unknown>;
  occurredAt: string | null;
}

export interface ExternalUser {
  externalUserId: string;
  username: string | null;
  avatarUrl: string | null;
}

export interface ExternalChannel {
  externalChannelId: string;
  name: string | null;
}

export interface WebhookRequest {
  headers: Headers;
  rawBody: string;
}

export interface ViewerAuthCapability {
  buildAuthorizeURL(env: unknown, state: string, redirectUri?: string, codeChallenge?: string): string;
}

export interface CreatorAuthCapability {
  buildAuthorizeURL(env: unknown, state: string, codeChallenge: string): string;
}

export interface WebhookCapability {
  verify(env: unknown, request: WebhookRequest): Promise<boolean>;
  /** Returns null for events this provider does not translate. */
  normalize(request: WebhookRequest, payload: unknown): NormalizedEvent | null;
}

/**
 * Every capability is optional: callers check `hasCapability(adapter, name)`
 * instead of branching on `provider === "kick"`.
 */
export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  viewerAuth?: ViewerAuthCapability;
  creatorAuth?: CreatorAuthCapability;
  webhooks?: WebhookCapability;
  /** Marker capabilities with no shared operations yet. */
  channels?: true;
  rewards?: true;
  roles?: true;
  entitlements?: true;
}

export function hasCapability(adapter: ProviderAdapter | undefined, capability: ProviderCapability): boolean {
  return Boolean(adapter && adapter[capability]);
}
