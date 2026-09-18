import { buildKickAuthorizeURL, buildKickViewerAuthorizeURL } from "../kick-oauth.js";
import {
  verifyKickWebhookSignature,
  isCreditableKickStatus,
  isReversibleKickStatus,
  type KickRewardPayload,
} from "../kick-credits.js";
import type { NormalizedEvent, ProviderAdapter, WebhookRequest } from "./types.js";

export const KICK_REWARD_EVENT = "channel.reward.redemption.updated";

interface KickWebhookEnv {
  KICK_WEBHOOK_PUBLIC_KEY?: string;
}

function kickHeaders(headers: Headers) {
  return {
    messageId: headers.get("Kick-Event-Message-Id"),
    timestamp: headers.get("Kick-Event-Message-Timestamp"),
    signature: headers.get("Kick-Event-Signature"),
    eventType: headers.get("Kick-Event-Type"),
  };
}

export function normalizeKickRewardEvent(
  messageId: string,
  eventType: string,
  payload: KickRewardPayload
): NormalizedEvent | null {
  if (eventType !== KICK_REWARD_EVENT) return null;
  const status = String(payload.status || "");
  if (!isCreditableKickStatus(status) && !isReversibleKickStatus(status)) return null;
  return {
    provider: "kick",
    externalEventId: messageId,
    eventType: "reward_redemption",
    payloadType: eventType,
    externalChannelId: payload.broadcaster?.user_id != null ? String(payload.broadcaster.user_id) : null,
    externalActorId: payload.redeemer?.user_id != null ? String(payload.redeemer.user_id) : null,
    status,
    payload: payload as unknown as Record<string, unknown>,
    occurredAt: payload.created_at || null,
  };
}

export const kickProvider: ProviderAdapter = {
  id: "kick",
  label: "Kick",
  viewerAuth: {
    buildAuthorizeURL(env, state, redirectUri, codeChallenge) {
      return buildKickViewerAuthorizeURL(env, state, codeChallenge || "", "user:read", redirectUri);
    },
  },
  creatorAuth: {
    buildAuthorizeURL(env, state, codeChallenge) {
      return buildKickAuthorizeURL(env, state, codeChallenge);
    },
  },
  webhooks: {
    async verify(env, request: WebhookRequest) {
      const pem = (env as KickWebhookEnv | undefined)?.KICK_WEBHOOK_PUBLIC_KEY;
      const { messageId, timestamp, signature } = kickHeaders(request.headers);
      if (!pem || !messageId || !timestamp || !signature) return false;
      return verifyKickWebhookSignature(pem, `${messageId}.${timestamp}.${request.rawBody}`, signature);
    },
    normalize(request, payload) {
      const { messageId, eventType } = kickHeaders(request.headers);
      if (!messageId || !eventType) return null;
      return normalizeKickRewardEvent(messageId, eventType, (payload || {}) as KickRewardPayload);
    },
  },
  channels: true,
  rewards: true,
};
