// Giveaway doctor — a pure, read-only diagnostic for the "viewers type the
// keyword but nothing shows up" class of failure.
//
// A chat giveaway can collect zero entries for a dozen unrelated reasons, and
// every one of them looks identical from the dashboard: an empty list. The
// historical approach was to walk the ingest path by hand (route -> webhook
// handler -> ingest -> insert) and check each gate one at a time, which took an
// evening and produced a wrong first answer twice.
//
// This module runs the same gates the ingest path runs, in order, against the
// site's real data, and stops at the first one that fails. Each check carries
// the exact operator action that clears it. Nothing here writes.
//
// Invariant this preserves: entries are created exclusively server-side by
// webhook delivery. A healthy verdict means "if a chat.message.sent webhook
// arrived right now carrying the keyword, a row would be inserted" — it can
// never mean "we created an entry".

/** Per-event webhook subscription stamps, as stored on community_channels. */
export const SUBSCRIPTION_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const CHECK = {
  CHANNEL_CONNECTED: "channel_connected",
  DELIVERY_STAMPED: "delivery_stamped",
  CHANNEL_ROUTABLE: "channel_routable",
  SESSION_ACTIVE: "session_active",
  KEYWORD_VALID: "keyword_valid",
  WEBHOOK_ENDPOINT: "webhook_endpoint",
};

const OPERATOR_ACTIONS = {
  [CHECK.CHANNEL_CONNECTED]: "Connect Kick for this site in Settings → Connections.",
  [CHECK.DELIVERY_STAMPED]: "Reconnect Kick in Settings → Connections, then check kick.com/settings/developer — the app webhook URL must be https://yourrank.site/webhooks/kick with webhooks enabled.",
  [CHECK.CHANNEL_ROUTABLE]: "Reconnect Kick in Settings → Connections so the channel binding is verified again against the site owner's connection.",
  [CHECK.SESSION_ACTIVE]: "Start a new giveaway. A giveaway started before the last deploy has no path to self-heal.",
  [CHECK.KEYWORD_VALID]: "Set a single-word keyword with no spaces.",
  [CHECK.WEBHOOK_ENDPOINT]: "The deployed webhook endpoint is not answering. Check the Cloudflare worker health for yourrank-site before anything else.",
};

function check(name, ok, detail) {
  return { name, ok, detail, action: ok ? null : OPERATOR_ACTIONS[name] || null };
}

/**
 * Keyword rule mirrored from chatMessageMatchesKeyword: exact, whole-token,
 * case-insensitive, after collapsing whitespace and lowercasing. A keyword
 * containing a space can never match, because the matcher splits the message
 * on whitespace and compares single tokens.
 */
export function keywordVerdict(keyword) {
  const normalized = String(keyword ?? "").trim().replace(/\s+/g, " ").toLowerCase().slice(0, 64);
  if (!normalized) return { ok: false, normalized, reason: "No keyword is set for this giveaway." };
  if (/\s/.test(normalized)) {
    return { ok: false, normalized, reason: "The keyword contains a space, and messages are matched token by token, so it can never match." };
  }
  return { ok: true, normalized, reason: null };
}

/** Age of a timestamp in ms, or null when it is missing/unparseable. */
export function stampAgeMs(stamp, now = Date.now()) {
  if (!stamp) return null;
  const at = Date.parse(stamp);
  if (Number.isNaN(at)) return null;
  return now - at;
}

/**
 * Build the report. Every input is already-fetched state, so this function is
 * pure and testable without a database.
 *
 * @param {object} input
 * @param {object|null} input.connection     loadChatGiveawayConnection result
 * @param {object|null} input.delivery       loadChannelEventDelivery result
 * @param {object|null} input.session        active session row, if any
 * @param {string|null} input.endpointStatus 'ok' | 'unreachable' | null (not probed)
 * @param {number}      [input.now]
 */
export function buildGiveawayDoctorReport(input) {
  const now = input.now ?? Date.now();
  const checks = [];

  const connection = input.connection || null;
  checks.push(check(
    CHECK.CHANNEL_CONNECTED,
    Boolean(connection?.connected),
    connection?.connected
      ? `Kick channel ${connection.channelName || connection.externalChannelId} is bound and verified.`
      : "No verified Kick channel is bound to this site.",
  ));

  const delivery = input.delivery || null;
  const chatAge = stampAgeMs(delivery?.chatEventsSubscribedAt, now);
  const deliveryOk = chatAge !== null && chatAge <= SUBSCRIPTION_STALE_AFTER_MS;
  checks.push(check(
    CHECK.DELIVERY_STAMPED,
    deliveryOk,
    chatAge === null
      ? "No chat webhook event has ever been observed for this channel, so no chat.message.sent delivery has arrived."
      : `The last observed chat webhook event was ${Math.round(chatAge / 3600000)}h ago.`,
  ));

  checks.push(check(
    CHECK.CHANNEL_ROUTABLE,
    Boolean(connection?.connected && connection?.routable !== false),
    connection?.connected
      ? "The channel binding is active, verified, and owned by the site owner's connection."
      : "The channel binding is missing or no longer verified.",
  ));

  const session = input.session || null;
  checks.push(check(
    CHECK.SESSION_ACTIVE,
    session?.status === "active",
    session
      ? `The current giveaway is ${session.status}.`
      : "This site has no giveaway session at all.",
  ));

  const verdict = keywordVerdict(session?.keyword);
  checks.push(check(CHECK.KEYWORD_VALID, verdict.ok, verdict.ok ? `Keyword "${verdict.normalized}" matches as a whole token.` : verdict.reason));

  if (input.endpointStatus) {
    checks.push(check(
      CHECK.WEBHOOK_ENDPOINT,
      input.endpointStatus === "ok",
      input.endpointStatus === "ok"
        ? "The deployed webhook endpoint answered."
        : "The deployed webhook endpoint did not answer.",
    ));
  }

  const firstFailure = checks.find((c) => !c.ok) || null;
  return {
    healthy: !firstFailure,
    verdict: firstFailure
      ? `Giveaway cannot collect entries: ${firstFailure.detail}`
      : "Every gate the ingest path runs is open — an arriving chat webhook carrying the keyword would insert an entry.",
    firstFailure: firstFailure?.name || null,
    action: firstFailure?.action || null,
    checks,
  };
}
