// Chat Giveaways dashboard API: server-backed sessions and entrants fed by the
// verified connected Kick channel's chat webhooks (see shared/chat-giveaways).
import { requireUser as defaultRequireUser, ok, bad, readJson, json } from "../auth.js";
import { getByUser as defaultGetByUser, getBoardById as defaultGetBoardById } from "../site.js";
import { requireSiteCapability as defaultRequireSiteCapability } from "../site-authorization.js";
import { one as defaultOne, query as defaultQuery, exec as defaultExec } from "@yourrank/shared/db";
import {
  loadChatGiveawayConnection as defaultLoadChatGiveawayConnection,
  normalizeGiveawayKeyword,
} from "@yourrank/shared/chat-giveaways";

const CAPABILITY = "canRoleManageRewards";
import { giveawayRulesSchema, GIVEAWAY_CAPABILITIES } from "@yourrank/shared/giveaway-eligibility";
import { SESSION_COLUMNS, ENTRY_COLUMNS, giveawayTransaction, drawGiveaway } from "../chat-giveaway-service.js";

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
  if (!session) return { session: null, entries: [], winner: null };
  const entries = await d.query(
    `SELECT ${ENTRY_COLUMNS} FROM chat_giveaway_entries WHERE giveaway_session_id = $1 ORDER BY entered_at ASC`,
    [session.id],
  );
  const winner = session.winner_entry_id ? entries.find((e) => e.id === session.winner_entry_id) || null : null;
  return { session, entries, winner };
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

  const parsedRules = giveawayRulesSchema.safeParse(body.rules ?? {});
  if (!parsedRules.success) return bad(parsedRules.error.issues[0]?.message || "Invalid giveaway rules.", 400);
  const keyword = normalizeGiveawayKeyword(body.keyword);
  if (!keyword) return bad("Enter the keyword viewers should type.", 400);
  if (/\s/.test(keyword)) return bad("Use a single word or command (no spaces) as the keyword.", 400);

  const connection = await d.loadChatGiveawayConnection(d.query, site.id, "kick");
  if (!connection.connected) return bad("Chat giveaways require a connected Kick channel.", 409);
  if (!connection.chatReady) {
    return bad("Kick chat events are not subscribed for this channel yet. Reconnect Kick in Settings → Connections.", 409);
  }

  try {
    const session = await d.one(
      `INSERT INTO chat_giveaway_sessions (site_id, provider, keyword, status, created_by, rules)
       VALUES ($1, 'kick', $2, 'active', $3, $4::jsonb)
       RETURNING ${SESSION_COLUMNS}`,
      [site.id, keyword, user.id, parsedRules.data],
    );
    return ok({ connection, session, entries: [], winner: null });
  } catch (err) {
    if (err?.code === "23505" || err?.code === "23P01") return bad("A giveaway is already collecting entries. Stop it before starting another.", 409);
    throw err;
  }
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
  if (result.conflict) {
    const view = await loadSessionView(d, site.id, body.sessionId);
    return json({ ok: false, error: result.error, ...view }, 409);
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
