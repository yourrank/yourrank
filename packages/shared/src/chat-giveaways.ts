// Server-backed Chat Giveaways: sessions and entrants persisted per site,
// fed by official Kick `chat.message.sent` webhooks routed through the verified
// community channel binding. No browser listener is involved.
import { giveawayRules, evaluateGiveawayEligibility, giveawayParticipantFacts } from "./giveaway-eligibility.js";
import type { ProviderId } from "./providers/types.js";
import type { SqlRunner } from "./viewer-identity.js";

export const KICK_CHAT_MESSAGE_EVENT = "chat.message.sent";
export const KICK_REWARD_REDEMPTION_EVENT = "channel.reward.redemption.updated";
/** Every webhook event a connected Kick creator channel must be subscribed to. */
export const KICK_CREATOR_WEBHOOK_EVENTS = [KICK_REWARD_REDEMPTION_EVENT, KICK_CHAT_MESSAGE_EVENT];

export type ChatGiveawayStatus = "active" | "stopped" | "completed" | "cancelled";

export interface ChatGiveawaySession {
  id: string;
  site_id: string;
  provider: string;
  keyword: string;
  rules?: unknown;
  status: ChatGiveawayStatus;
  started_at: string;
  stopped_at: string | null;
  winner_entry_id: string | null;
  drawn_at: string | null;
  winner_confirmed_at: string | null;
  winner_confirmation_message: string | null;
  winner_finalized_at: string | null;
  winner_finalized_by: string | null;
  winner_response_required: boolean | null;
  winner_response_timeout_seconds: number | null;
  created_at: string;
}

export interface ChatGiveawayEntry {
  id: string;
  giveaway_session_id: string;
  provider: string;
  provider_user_id: string;
  username: string;
  avatar_url: string | null;
  message: string;
  badges: unknown[];
  entered_at: string;
}

export interface KickChatBadge {
  type?: string;
  text?: string;
  count?: number;
}

/** Shape of Kick's `chat.message.sent` webhook payload (fields we rely on). */
export interface KickChatMessagePayload {
  message_id?: string;
  broadcaster?: { user_id?: number | string; username?: string; channel_slug?: string };
  sender?: {
    user_id?: number | string;
    username?: string;
    channel_slug?: string;
    profile_picture?: string | null;
    identity?: { badges?: KickChatBadge[] } | null;
  };
  content?: string;
  created_at?: string;
}

export function normalizeGiveawayKeyword(raw: unknown): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ").toLowerCase().slice(0, 64);
}

/**
 * Exact token match, case-insensitive: the keyword must appear as a whole
 * whitespace-delimited token. `!win` matches "!win" and "!WIN please" but not
 * "!winner".
 */
export function chatMessageMatchesKeyword(message: unknown, keyword: string): boolean {
  const target = normalizeGiveawayKeyword(keyword);
  if (!target) return false;
  const tokens = String(message ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.includes(target);
}

// Routable binding: active + verified channel whose verifying creator
// connection is still active and still belongs to the site owner. Mirrors the
// rule in provider-connections.ts; nothing here trusts payload site ids.
const ROUTABLE_CHANNEL_SQL = `
       FROM community_channels ch
       JOIN sites s ON s.id = ch.site_id
       JOIN creator_connections cc ON cc.id = ch.creator_connection_id
      WHERE ch.provider = $1
        AND ch.external_channel_id = $2
        AND ch.status = 'active' AND ch.verified_at IS NOT NULL
        AND cc.provider = ch.provider AND cc.user_id = s.user_id
        AND cc.status = 'active' AND cc.linked_at IS NOT NULL`;

interface RoutedSessionRow {
  id: string;
  site_id: string;
  keyword: string;
  rules?: unknown;
  status: ChatGiveawayStatus;
  winner_entry_id: string | null;
  winner_confirmed_at: string | null;
  winner_provider_user_id: string | null;
}

/**
 * Sessions a provider channel's chat currently feeds: the active session (for
 * entries) and the most recent completed one still awaiting winner
 * confirmation (for the claim flow). A completed session only routes while a
 * required winner response is still possible — the draw-time rule and window,
 * plus a 5-minute routing grace so a late-delivered webhook carrying an
 * on-time provider timestamp can still land; the UPDATE below enforces the
 * real deadline against `drawn_at`. Empty when the channel is not routable.
 */
async function routedSessionsForChannel(
  run: SqlRunner, provider: ProviderId, externalChannelId: string,
): Promise<RoutedSessionRow[]> {
  const rows = (await run(
    `SELECT gs.id, gs.site_id, gs.keyword, gs.rules, gs.status, gs.winner_entry_id, gs.winner_confirmed_at,
            we.provider_user_id AS winner_provider_user_id
       FROM chat_giveaway_sessions gs
       LEFT JOIN chat_giveaway_entries we ON we.id = gs.winner_entry_id
      WHERE gs.site_id IN (SELECT s.id${ROUTABLE_CHANNEL_SQL})
        AND (
          gs.status = 'active'
          OR (gs.status = 'completed' AND gs.winner_entry_id IS NOT NULL
              AND gs.winner_response_required = true
              AND gs.winner_confirmed_at IS NULL AND gs.winner_finalized_at IS NULL
              AND gs.drawn_at IS NOT NULL
              AND gs.drawn_at + make_interval(secs => COALESCE(gs.winner_response_timeout_seconds, 60)) > now() - interval '5 minutes')
        )
      ORDER BY gs.created_at DESC
      LIMIT 2`,
    [provider, externalChannelId],
  )) as RoutedSessionRow[];
  return rows;
}

export interface ChatGiveawayIngestOutcome {
  routed: boolean;
  entered: boolean;
  duplicate: boolean;
  matched: boolean;
  winnerConfirmed: boolean;
  sessionId: string | null;
}

/**
 * Handle one provider chat message: route the channel to its site through the
 * verified binding, match the active giveaway keyword, insert a unique entrant
 * (stable provider user id), and confirm a drawn winner's reply.
 */
export async function ingestChatGiveawayMessage(
  run: SqlRunner,
  input: {
    provider: ProviderId;
    externalChannelId: string;
    senderUserId: string;
    senderUsername: string;
    senderAvatarUrl: string | null;
    badges: unknown[];
    content: string;
    occurredAt?: string | null;
  },
): Promise<ChatGiveawayIngestOutcome> {
  const outcome: ChatGiveawayIngestOutcome = {
    routed: false, entered: false, duplicate: false, matched: false, winnerConfirmed: false, sessionId: null,
  };
  if (!input.externalChannelId || !input.senderUserId) return outcome;
  const sessions = await routedSessionsForChannel(run, input.provider, input.externalChannelId);
  if (sessions.length === 0) return outcome;
  outcome.routed = true;

  for (const session of sessions) {
    if (session.status === "active") {
      outcome.sessionId = session.id;
      if (!chatMessageMatchesKeyword(input.content, session.keyword)) continue;
      outcome.matched = true;
      const rules = giveawayRules(session.rules);
      const facts = rules.entryMode !== "chat" || rules.excludePreviousWinners
        ? await giveawayParticipantFacts(run, session.site_id, input.senderUserId) : {};
      const eligibility = evaluateGiveawayEligibility({ ...facts, badges: input.badges }, rules);
      const inserted = (await run(
        `INSERT INTO chat_giveaway_entries
           (giveaway_session_id, provider, provider_user_id, username, avatar_url, message, badges, entered_at,
            eligibility_status, eligibility_reason)
         SELECT $1, $2, $3, $4, $5, $6, $7::jsonb, COALESCE($8::timestamptz, now()), $9, $10
           FROM chat_giveaway_sessions gs
          WHERE gs.id = $1 AND gs.status = 'active'
          FOR SHARE OF gs
         ON CONFLICT (giveaway_session_id, provider_user_id) DO NOTHING
         RETURNING id`,
        [
          session.id, input.provider, input.senderUserId, input.senderUsername.slice(0, 120),
          input.senderAvatarUrl, input.content.slice(0, 500), input.badges ?? [],
          input.occurredAt || null, eligibility.status, eligibility.reason,
        ],
      )) as { id: string }[];
      if (inserted.length > 0) outcome.entered = true;
      else outcome.duplicate = true;
    } else if (session.winner_provider_user_id && session.winner_provider_user_id === input.senderUserId) {
      // The winner's reply counts only while its provider timestamp sits
      // inside the draw's response window [drawn_at, drawn_at + timeout].
      const at = resolveChatEventTime(input.occurredAt).toISOString();
      const confirmed = (await run(
        `UPDATE chat_giveaway_sessions
            SET winner_confirmed_at = $3::timestamptz, winner_confirmation_message = $2
          WHERE id = $1
            AND status = 'completed'
            AND winner_response_required = true
            AND winner_confirmed_at IS NULL
            AND winner_finalized_at IS NULL
            AND EXISTS (
              SELECT 1 FROM chat_giveaway_entries winner
              WHERE winner.id = chat_giveaway_sessions.winner_entry_id
                AND winner.provider = $4 AND winner.provider_user_id = $5
            )
            AND drawn_at IS NOT NULL
            AND $3::timestamptz >= drawn_at
            AND $3::timestamptz <= drawn_at + make_interval(secs => COALESCE(winner_response_timeout_seconds, 60))
          RETURNING id`,
        [session.id, input.content.slice(0, 500), at, input.provider, input.senderUserId],
      )) as { id: string }[];
      outcome.winnerConfirmed = confirmed.length > 0;
    }
  }
  return outcome;
}

/** Provider event time if valid and not in the future (60s skew); otherwise the processing time. */
export function resolveChatEventTime(occurredAt: string | null | undefined, now = new Date()): Date {
  const t = occurredAt ? Date.parse(occurredAt) : NaN;
  if (!Number.isFinite(t) || t > now.getTime() + 60_000) return now;
  return new Date(t);
}

/** Extract the routing/identity fields from a Kick chat webhook payload. */
export function kickChatMessageToIngestInput(payload: KickChatMessagePayload) {
  const broadcasterId = payload.broadcaster?.user_id;
  const sender = payload.sender || {};
  const senderId = sender.user_id;
  return {
    provider: "kick" as ProviderId,
    externalChannelId: broadcasterId != null ? String(broadcasterId) : "",
    senderUserId: senderId != null ? String(senderId) : "",
    senderUsername: String(sender.username || sender.channel_slug || "").trim() || "viewer",
    senderAvatarUrl: sender.profile_picture ? String(sender.profile_picture) : null,
    badges: Array.isArray(sender.identity?.badges) ? sender.identity.badges : [],
    content: String(payload.content ?? ""),
    occurredAt: payload.created_at || null,
  };
}

export interface ChatGiveawayConnection {
  connected: boolean;
  chatReady: boolean;
  channelName: string | null;
  externalChannelId: string | null;
}

/**
 * Connection readiness for a site's chat giveaways: `connected` when the
 * channel is routable (same rule the webhook uses), `chatReady` when the chat
 * event subscription was also recorded.
 */
export async function loadChatGiveawayConnection(
  run: SqlRunner, siteId: string, provider: ProviderId = "kick",
): Promise<ChatGiveawayConnection> {
  const rows = (await run(
    `SELECT ch.external_channel_id, ch.external_channel_name, ch.chat_events_subscribed_at,
            (cc.id IS NOT NULL) AS routable
       FROM community_channels ch
       JOIN sites s ON s.id = ch.site_id
       LEFT JOIN creator_connections cc
         ON cc.id = ch.creator_connection_id AND cc.provider = ch.provider
        AND cc.user_id = s.user_id AND cc.status = 'active' AND cc.linked_at IS NOT NULL
      WHERE ch.site_id = $1 AND ch.provider = $2 AND ch.status = 'active' AND ch.verified_at IS NOT NULL
      LIMIT 1`,
    [siteId, provider],
  )) as Array<{ external_channel_id: string; external_channel_name: string | null; chat_events_subscribed_at: string | null; routable: boolean }>;
  const row = rows[0];
  if (!row || !row.routable) {
    return { connected: false, chatReady: false, channelName: null, externalChannelId: null };
  }
  return {
    connected: true,
    chatReady: row.chat_events_subscribed_at != null,
    channelName: row.external_channel_name,
    externalChannelId: row.external_channel_id,
  };
}

/** Disconnecting the channel: nothing can collect anymore, keep history. */
export async function stopActiveChatGiveaways(run: SqlRunner, siteId: string): Promise<void> {
  await run(
    `UPDATE chat_giveaway_sessions
        SET status = 'stopped', stopped_at = now()
      WHERE site_id = $1 AND status = 'active'`,
    [siteId],
  );
}

export interface ChannelEventSubscriptions {
  rewardEvents: boolean;
  chatEvents: boolean;
}

export interface ChannelEventDelivery {
  rewardEventsSubscribedAt: string | null;
  chatEventsSubscribedAt: string | null;
  checkedAt: string | null;
}

/** Which creator webhook events an `ensureKickWebhookSubscriptions` result confirmed. */
export function subscriptionsFromEvents(subscribed: readonly string[]): ChannelEventSubscriptions {
  return {
    rewardEvents: subscribed.includes(KICK_REWARD_REDEMPTION_EVENT),
    chatEvents: subscribed.includes(KICK_CHAT_MESSAGE_EVENT),
  };
}

/**
 * Record the outcome of a webhook subscription reconciliation on the site's
 * channel. Each event is stored on its own so readers can tell exactly which
 * delivery path is missing; `event_subscriptions_checked_at` marks that a
 * check actually happened (NULL = never verified).
 */
export async function markChannelEventSubscriptions(
  run: SqlRunner, siteId: string, provider: ProviderId, subscriptions: ChannelEventSubscriptions,
): Promise<void> {
  await run(
    `UPDATE community_channels
        SET reward_events_subscribed_at = CASE WHEN $3 THEN now() END,
            chat_events_subscribed_at = CASE WHEN $4 THEN now() END,
            event_subscriptions_checked_at = now(),
            updated_at = now()
      WHERE site_id = $1 AND provider = $2`,
    [siteId, provider, Boolean(subscriptions.rewardEvents), Boolean(subscriptions.chatEvents)],
  );
}

/** Stored delivery facts for the site's active channel (all NULL when none). */
export async function loadChannelEventDelivery(
  run: SqlRunner, siteId: string, provider: ProviderId = "kick",
): Promise<ChannelEventDelivery> {
  const rows = (await run(
    `SELECT reward_events_subscribed_at, chat_events_subscribed_at, event_subscriptions_checked_at
       FROM community_channels
      WHERE site_id = $1 AND provider = $2 AND status = 'active'
      LIMIT 1`,
    [siteId, provider],
  )) as Array<{ reward_events_subscribed_at: string | null; chat_events_subscribed_at: string | null; event_subscriptions_checked_at: string | null }>;
  const row = rows[0];
  return {
    rewardEventsSubscribedAt: row?.reward_events_subscribed_at ?? null,
    chatEventsSubscribedAt: row?.chat_events_subscribed_at ?? null,
    checkedAt: row?.event_subscriptions_checked_at ?? null,
  };
}
