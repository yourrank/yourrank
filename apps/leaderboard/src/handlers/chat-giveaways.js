// Chat Giveaways dashboard API: server-backed sessions and entrants fed by the
// verified connected Kick channel's chat webhooks (see shared/chat-giveaways).
import { requireUser as defaultRequireUser, ok, bad, readJson, json, requireSiteFeature } from "../auth.js";
import { getByUser as defaultGetByUser, getBoardById as defaultGetBoardById } from "../site.js";
import { requireSiteCapability as defaultRequireSiteCapability } from "../site-authorization.js";
import { one as defaultOne, query as defaultQuery, exec as defaultExec } from "@yourrank/shared/db";
import {
  loadChatGiveawayConnection as defaultLoadChatGiveawayConnection,
  normalizeGiveawayKeyword,
} from "@yourrank/shared/chat-giveaways";
import {
  giveawayRules,
  giveawayRulesSchema,
  evaluateGiveawayEligibility,
  giveawayParticipantFacts,
  GIVEAWAY_CAPABILITIES,
} from "@yourrank/shared/giveaway-eligibility";
import { SESSION_COLUMNS, ENTRY_COLUMNS, giveawayTransaction, drawGiveaway } from "../chat-giveaway-service.js";

const CAPABILITY = "canRoleManageRewards";
const MANUAL_RULES_ERROR = "Manual giveaways can't use Kick-only rules (members, verified entry, subscriber/VIP only, winner chat response).";

// Rules that stay free; everything else is an advanced_giveaways feature.
function usesAdvancedGiveawayRules(rules) {
  return (
    rules.entryMode === "verified" ||
    rules.onePerIp === true ||
    rules.vipOnly === true ||
    rules.winnerMustRespond === true ||
    rules.responseTimeout !== 60 ||
    rules.autoReroll === true
  );
}

export function manualEntryRulesError(rules) {
  if (
    rules?.entryMode !== "chat" ||
    rules.subscriberOnly ||
    rules.vipOnly ||
    rules.winnerMustRespond ||
    rules.onePerIp ||
    rules.autoReroll
  ) {
    return MANUAL_RULES_ERROR;
  }
  return null;
}

const MANUAL_ADD_RULES_ERROR = "Manual entrants can't meet this giveaway's Kick entry rules (members, verified entry, subscriber/VIP only, one account per IP).";

// Streamer-added viewers enter Kick sessions too. Only entry-side rules block
// them (a typed name can't satisfy Kick identity gates); draw-phase rules like
// winnerMustRespond/autoReroll are fine — a manually-added winner simply has
// no chat response to wait for (see drawGiveaway).
export function manualAddRulesError(rules) {
  if (
    rules?.entryMode !== "chat" ||
    rules.subscriberOnly ||
    rules.vipOnly ||
    rules.onePerIp
  ) {
    return MANUAL_ADD_RULES_ERROR;
  }
  return null;
}

async function resolveSite(request, env, deps) {
  const { requireUser, getByUser, getBoardById, requireSiteCapability, siteIdOverride } = deps;
  const { user, res } = await requireUser(request, env);
  if (res) return { res };
  const url = new URL(request.url);
  const siteId = siteIdOverride || url.searchParams.get("siteId");
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  if (!site) return { res: bad("Site not found", 404) };
  const authorization = await requireSiteCapability(user, site, CAPABILITY);
  if (authorization.res) return { res: authorization.res };
  return { user, site };
}

function withDefaults(deps) {
  return {
    requireUser: defaultRequireUser,
    getByUser: defaultGetByUser,
    getBoardById: defaultGetBoardById,
    requireSiteCapability: defaultRequireSiteCapability,
    one: defaultOne,
    query: defaultQuery,
    exec: defaultExec,
    loadChatGiveawayConnection: defaultLoadChatGiveawayConnection,
    transaction: giveawayTransaction,
    ...deps,
  };
}

async function loadSessionView(d, siteId, sessionId = null) {
  const session = sessionId
    ? await d.one(`SELECT ${SESSION_COLUMNS} FROM chat_giveaway_sessions WHERE id = $1 AND site_id = $2`, [sessionId, siteId])
    : await d.one(
      `SELECT ${SESSION_COLUMNS} FROM chat_giveaway_sessions
        WHERE site_id = $1 AND status <> 'cancelled'
        ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1`,
      [siteId],
    );
  if (!session) return { session: null, entries: [], winner: null, draws: [] };
  const entries = await d.query(
    `SELECT ${ENTRY_COLUMNS} FROM chat_giveaway_entries WHERE giveaway_session_id = $1 ORDER BY entered_at ASC`,
    [session.id],
  );
  const winner = session.winner_entry_id ? entries.find((e) => e.id === session.winner_entry_id) || null : null;
  const draws = await d.query(
    `SELECT d.id, d.entry_id, d.reason, d.drawn_at, d.replaced_entry_id,
            e.username, re.username AS replaced_username
       FROM chat_giveaway_draws d
       LEFT JOIN chat_giveaway_entries e ON e.id = d.entry_id
       LEFT JOIN chat_giveaway_entries re ON re.id = d.replaced_entry_id
      WHERE d.giveaway_session_id = $1
      ORDER BY d.drawn_at, d.id`,
    [session.id],
  );
  return { session, entries, winner, draws };
}

/** GET /api/giveaways/chat — connection readiness + current session + entrants. */
export async function handleChatGiveawayState(request, env, deps = {}) {
  const d = withDefaults(deps);
  const { res, site } = await resolveSite(request, env, d);
  if (res) return res;
  const url = new URL(request.url);
  const connection = await d.loadChatGiveawayConnection(d.query, site.id, "kick");
  const view = await loadSessionView(d, site.id, url.searchParams.get("sessionId"));
  return ok({ connection, capabilities: GIVEAWAY_CAPABILITIES, ...view });
}

/** POST /api/giveaways/chat/start — create the site's single active session. */
export async function handleChatGiveawayStart(request, env, deps = {}) {
  const d = withDefaults(deps);
  const body = (await readJson(request)) || {};
  const { res, site, user } = await resolveSite(request, env, { ...d, siteIdOverride: body.siteId });
  if (res) return res;

  const manual = body.mode === "manual";
  const parsedRules = giveawayRulesSchema.safeParse(body.rules ?? {});
  if (!parsedRules.success) return bad(parsedRules.error.issues[0]?.message || "Invalid giveaway rules.", 400);
  if (manual) {
    const rulesError = manualEntryRulesError(parsedRules.data);
    if (rulesError) return bad(rulesError, 400);
  }
  // Basic giveaways are free: keyword, entryMode chat|members, subscriberOnly,
  // winnerRepeat, excludePreviousWinners. Advanced fields require the
  // advanced_giveaways feature (site owner's plan decides).
  if (usesAdvancedGiveawayRules(parsedRules.data)) {
    const gateRes = await requireSiteFeature(site, "advanced_giveaways", { actorId: user.id, request, oneImpl: d.one });
    if (gateRes) return gateRes;
  }
  const keyword = manual ? "manual" : normalizeGiveawayKeyword(body.keyword);
  if (!manual && !keyword) return bad("Enter the keyword viewers should type.", 400);
  if (!manual && /\s/.test(keyword)) return bad("Use a single word or command (no spaces) as the keyword.", 400);

  let connection;
  if (!manual) {
    connection = await d.loadChatGiveawayConnection(d.query, site.id, "kick");
    if (!connection.connected) return bad("Chat giveaways require a connected Kick channel.", 409);
    if (!connection.chatReady) {
      return bad("Kick chat events are not subscribed for this channel yet. Reconnect Kick in Settings → Connections.", 409);
    }
  }

  try {
    const session = manual
      ? await d.one(
        `INSERT INTO chat_giveaway_sessions (site_id, provider, keyword, status, created_by, rules)
         VALUES ($1, 'manual', 'manual', 'active', $2, $3::jsonb)
         RETURNING ${SESSION_COLUMNS}`,
        [site.id, user.id, parsedRules.data],
      )
      : await d.one(
        `INSERT INTO chat_giveaway_sessions (site_id, provider, keyword, status, created_by, rules)
         VALUES ($1, 'kick', $2, 'active', $3, $4::jsonb)
         RETURNING ${SESSION_COLUMNS}`,
        [site.id, keyword, user.id, parsedRules.data],
      );
    return ok({ ...(connection ? { connection } : {}), session, entries: [], winner: null });
  } catch (err) {
    if (err?.code === "23505" || err?.code === "23P01") return bad("A giveaway is already collecting entries. Stop it before starting another.", 409);
    throw err;
  }
}

/** POST /api/giveaways/chat/entries/add — add one streamer-entered viewer. */
export async function handleChatGiveawayAddEntry(request, env, deps = {}) {
  const d = withDefaults(deps);
  const body = (await readJson(request)) || {};
  const { res, site } = await resolveSite(request, env, { ...d, siteIdOverride: body.siteId });
  if (res) return res;

  let username = String(body.username ?? "").trim();
  if (username.startsWith("@")) username = username.slice(1).trim();
  if (!username || username.length > 40) return bad("Enter a viewer name (up to 40 characters).", 400);

  const session = body.sessionId
    ? await d.one(
      `SELECT ${SESSION_COLUMNS} FROM chat_giveaway_sessions
        WHERE id = $1 AND site_id = $2 AND status = 'active'`,
      [body.sessionId, site.id],
    )
    : null;
  if (!session) return bad("Start a giveaway before adding entrants.", 409);

  const rules = giveawayRules(session.rules);
  if (session.provider === "kick") {
    const rulesError = manualAddRulesError(rules);
    if (rulesError) return bad(rulesError, 409);
  }

  const duplicate = await d.one(
    `SELECT id FROM chat_giveaway_entries
      WHERE giveaway_session_id = $1 AND lower(username) = lower($2)
      LIMIT 1`,
    [session.id, username],
  );
  if (duplicate) return bad(`${username} is already entered.`, 409);

  const providerUserId = `manual:${username.toLowerCase()}`;
  const facts = await giveawayParticipantFacts(d.query, site.id, providerUserId);
  const eligibility = evaluateGiveawayEligibility({ badges: [], previousWinner: facts.previousWinner }, rules);
  const entry = await d.one(
    `INSERT INTO chat_giveaway_entries
       (giveaway_session_id, provider, provider_user_id, username, message, badges, eligibility_status, eligibility_reason)
     VALUES ($1, 'manual', $2, $3, '', '[]'::jsonb, $4, $5)
     ON CONFLICT DO NOTHING
     RETURNING ${ENTRY_COLUMNS}`,
    [session.id, providerUserId, username, eligibility.status, eligibility.reason],
  );
  if (!entry) return bad(`${username} is already entered.`, 409);

  return ok(await loadSessionView(d, site.id, session.id));
}

/** POST /api/giveaways/chat/response-rules — winner verification is a
 * draw-phase rule: it stays editable on a live Kick giveaway until the winner
 * is confirmed, while entry-side rules stay locked. Applies to the next draw
 * or re-roll; the current draw's persisted window is not rewritten. */
export async function handleChatGiveawayUpdateResponseRules(request, env, deps = {}) {
  const d = withDefaults(deps);
  const body = (await readJson(request)) || {};
  const { res, site, user } = await resolveSite(request, env, { ...d, siteIdOverride: body.siteId });
  if (res) return res;
  if (!body.sessionId) return bad("Missing sessionId", 400);

  const session = await d.one(
    `SELECT ${SESSION_COLUMNS} FROM chat_giveaway_sessions WHERE id = $1 AND site_id = $2`,
    [body.sessionId, site.id],
  );
  if (!session) return bad("Giveaway not found", 404);

  // Only the three response rules come from the request; entry rules merge in
  // unchanged from the persisted session.
  const merged = {
    ...giveawayRules(session.rules),
    winnerMustRespond: body.winnerMustRespond,
    responseTimeout: body.responseTimeout,
    autoReroll: body.autoReroll,
  };
  const parsedRules = giveawayRulesSchema.safeParse(merged);
  if (!parsedRules.success) return bad(parsedRules.error.issues[0]?.message || "Invalid giveaway rules.", 400);
  if (usesAdvancedGiveawayRules(parsedRules.data)) {
    const gateRes = await requireSiteFeature(site, "advanced_giveaways", { actorId: user.id, request, oneImpl: d.one });
    if (gateRes) return gateRes;
  }

  const updated = await d.one(
    `UPDATE chat_giveaway_sessions SET rules = $3::jsonb
      WHERE id = $1 AND site_id = $2 AND provider = 'kick' AND status <> 'cancelled'
        AND winner_finalized_at IS NULL
      RETURNING ${SESSION_COLUMNS}`,
    [body.sessionId, site.id, parsedRules.data],
  );
  if (!updated) {
    return bad("Winner verification can't change after the winner is confirmed or the giveaway ends.", 409);
  }
  const connection = await d.loadChatGiveawayConnection(d.query, site.id, "kick");
  return ok({ connection, ...await loadSessionView(d, site.id, body.sessionId) });
}

/** POST /api/giveaways/chat/stop — stop collecting; entrants are kept. */
export async function handleChatGiveawayStop(request, env, deps = {}) {
  const d = withDefaults(deps);
  const body = (await readJson(request)) || {};
  const { res, site } = await resolveSite(request, env, { ...d, siteIdOverride: body.siteId });
  if (res) return res;
  const session = await d.one(
    `UPDATE chat_giveaway_sessions SET status = 'stopped', stopped_at = now()
      WHERE site_id = $1 AND status = 'active' ${body.sessionId ? "AND id = $2" : ""}
      RETURNING ${SESSION_COLUMNS}`,
    body.sessionId ? [site.id, body.sessionId] : [site.id],
  );
  if (!session) return bad("No active giveaway to stop.", 404);
  const view = await loadSessionView(d, site.id, session.id);
  return ok(view);
}

/** POST /api/giveaways/chat/draw — pick a winner from persisted entrants. */
export async function handleChatGiveawayDraw(request, env, deps = {}) {
  const d = withDefaults(deps);
  const body = (await readJson(request)) || {};
  const { res, site } = await resolveSite(request, env, { ...d, siteIdOverride: body.siteId });
  if (res) return res;
  if (!body.sessionId) return bad("Missing sessionId", 400);

  // The row lock plus the compare-and-swap inside drawGiveaway make the server
  // the arbiter: only the draw identity the client saw (no winner yet, or the
  // exact winner + drawn_at for a re-roll) can be replaced, so concurrent tabs
  // and devices cannot overwrite a winner the client never saw.
  const reroll = body.expectedWinnerEntryId != null;
  if (reroll && !Number.isFinite(Date.parse(body.expectedDrawnAt))) return bad("Invalid expectedDrawnAt", 400);

  const result = await d.transaction(async (run) => {
    const [session] = await run(
      `SELECT ${SESSION_COLUMNS} FROM chat_giveaway_sessions WHERE id = $1 AND site_id = $2 FOR UPDATE`,
      [body.sessionId, site.id],
    );
    if (!session) return { error: "Giveaway not found", status: 404 };
    return drawGiveaway(run, session, {
      automatic: body.automatic === true,
      expectedWinnerEntryId: reroll ? String(body.expectedWinnerEntryId) : null,
      expectedDrawnAt: reroll ? body.expectedDrawnAt : null,
    });
  });
  if (result.conflict || result.exhausted) {
    const view = await loadSessionView(d, site.id, body.sessionId);
    return json({ ok: false, error: result.error, exhausted: result.exhausted === true || undefined, ...view }, 409);
  }
  if (result.error) return bad(result.error, result.status || 409);
  return ok(await loadSessionView(d, site.id, body.sessionId));
}

/** POST /api/giveaways/chat/finalize — the streamer's manual "Confirm Winner".
 * Distinct from winner_confirmed_at, which is set by the winner's Kick chat
 * reply: this stamps who confirmed and when, and is idempotent. */
export async function handleChatGiveawayFinalize(request, env, deps = {}) {
  const d = withDefaults(deps);
  const body = (await readJson(request)) || {};
  const { res, site, user } = await resolveSite(request, env, { ...d, siteIdOverride: body.siteId });
  if (res) return res;
  if (!body.sessionId) return bad("Missing sessionId", 400);
  if (!body.winnerEntryId) return bad("Missing winnerEntryId", 400);
  if (body.drawnAt == null) return bad("Missing drawnAt", 400);
  const drawnAtMs = Date.parse(body.drawnAt);
  if (!Number.isFinite(drawnAtMs)) return bad("Invalid drawnAt", 400);

  // One conditional UPDATE: it only lands on the exact draw the client saw
  // (same winner_entry_id and drawn_at at millisecond precision, since the
  // timestamp round-trips through JSON), so a re-roll between the client's
  // load and this click cannot be confirmed blindly.
  const updated = await d.one(
    `UPDATE chat_giveaway_sessions
        SET winner_finalized_at = now(), winner_finalized_by = $3
      WHERE id = $1 AND site_id = $2
        AND winner_entry_id = $4
        AND date_trunc('milliseconds', drawn_at) = date_trunc('milliseconds', $5::timestamptz)
        AND winner_finalized_at IS NULL
        AND (winner_response_required IS NOT TRUE OR winner_confirmed_at IS NOT NULL)
      RETURNING ${SESSION_COLUMNS}`,
    [body.sessionId, site.id, user.id, String(body.winnerEntryId), body.drawnAt],
  );

  const connection = await d.loadChatGiveawayConnection(d.query, site.id, "kick");
  if (updated) {
    const view = await loadSessionView(d, site.id, updated.id);
    return ok({ connection, ...view, session: view.session || updated });
  }

  // The UPDATE found no matching draw: re-read and explain why.
  const session = await d.one(
    `SELECT ${SESSION_COLUMNS} FROM chat_giveaway_sessions WHERE id = $1 AND site_id = $2`,
    [body.sessionId, site.id],
  );
  const conflict = (error) => json({ ok: false, error, session }, 409);
  if (!session) return bad("Giveaway not found", 404);
  if (!session.winner_entry_id) return conflict("Draw a winner before confirming.");
  const storedDrawnAt = session.drawn_at ? new Date(session.drawn_at).getTime() : null;
  if (session.winner_entry_id !== String(body.winnerEntryId) || storedDrawnAt !== drawnAtMs) {
    return conflict("The giveaway winner changed. Refresh the current draw before confirming.");
  }
  if (session.winner_finalized_at) {
    const view = await loadSessionView(d, site.id, session.id);
    return ok({ connection, ...view, session: view.session || session });
  }
  if (session.winner_response_required && !session.winner_confirmed_at) {
    return conflict("The winner must respond in chat before you can confirm.");
  }
  return conflict("Could not confirm the winner. Refresh and try again.");
}

/** POST /api/giveaways/chat/entries/remove — remove one entrant from a session. */
export async function handleChatGiveawayRemoveEntry(request, env, deps = {}) {
  const d = withDefaults(deps);
  const body = (await readJson(request)) || {};
  const { res, site } = await resolveSite(request, env, { ...d, siteIdOverride: body.siteId });
  if (res) return res;
  if (!body.entryId) return bad("Missing entryId", 400);
  await d.exec(
    `DELETE FROM chat_giveaway_entries e USING chat_giveaway_sessions gs
      WHERE e.id = $1 AND gs.id = e.giveaway_session_id AND gs.site_id = $2`,
    [body.entryId, site.id],
  );
  const view = await loadSessionView(d, site.id, body.sessionId || null);
  return ok(view);
}
