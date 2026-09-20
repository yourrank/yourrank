// Chat Giveaways dashboard API: server-backed sessions and entrants fed by the
// verified connected Kick channel's chat webhooks (see shared/chat-giveaways).
import { requireUser as defaultRequireUser, ok, bad, readJson } from "../auth.js";
import { getByUser as defaultGetByUser, getBoardById as defaultGetBoardById } from "../site.js";
import { requireSiteCapability as defaultRequireSiteCapability } from "../site-authorization.js";
import { one as defaultOne, query as defaultQuery, exec as defaultExec } from "@yourrank/shared/db";
import {
  loadChatGiveawayConnection as defaultLoadChatGiveawayConnection,
  normalizeGiveawayKeyword,
} from "@yourrank/shared/chat-giveaways";

const CAPABILITY = "canRoleManageRewards";
const SESSION_COLUMNS = `id, site_id, provider, keyword, status, started_at, stopped_at,
  winner_entry_id, drawn_at, winner_confirmed_at, winner_confirmation_message, created_at`;
const ENTRY_COLUMNS = `id, giveaway_session_id, provider, provider_user_id, username, avatar_url, message, badges, entered_at`;

function randomIndex(max) {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] % max;
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
  return ok({ connection, ...view });
}

/** POST /api/giveaways/chat/start — create the site's single active session. */
export async function handleChatGiveawayStart(request, env, deps = {}) {
  const d = withDefaults(deps);
  const body = (await readJson(request)) || {};
  const { res, site, user } = await resolveSite(request, env, { ...d, siteIdOverride: body.siteId });
  if (res) return res;

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
      `INSERT INTO chat_giveaway_sessions (site_id, provider, keyword, status, created_by)
       VALUES ($1, 'kick', $2, 'active', $3)
       RETURNING ${SESSION_COLUMNS}`,
      [site.id, keyword, user.id],
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

  const session = await d.one(
    `SELECT ${SESSION_COLUMNS} FROM chat_giveaway_sessions WHERE id = $1 AND site_id = $2`,
    [body.sessionId, site.id],
  );
  if (!session) return bad("Giveaway not found", 404);
  if (session.status === "cancelled") return bad("This giveaway was cancelled.", 409);

  const entries = await d.query(
    `SELECT ${ENTRY_COLUMNS} FROM chat_giveaway_entries WHERE giveaway_session_id = $1 ORDER BY entered_at ASC`,
    [session.id],
  );
  // Optional client-side eligibility filter (e.g. skip recent winners); the
  // server only ever draws from persisted entries of this session.
  const allowed = Array.isArray(body.entryIds) ? new Set(body.entryIds.map(String)) : null;
  const pool = allowed ? entries.filter((e) => allowed.has(e.id)) : entries;
  if (pool.length === 0) return bad("No eligible entrants to draw from.", 409);

  const winner = pool[randomIndex(pool.length)];
  const updated = await d.one(
    `UPDATE chat_giveaway_sessions
        SET winner_entry_id = $2, drawn_at = now(), winner_confirmed_at = NULL, winner_confirmation_message = NULL,
            status = 'completed', stopped_at = COALESCE(stopped_at, now())
      WHERE id = $1 AND site_id = $3
      RETURNING ${SESSION_COLUMNS}`,
    [session.id, winner.id, site.id],
  );
  return ok({ session: updated, entries, winner });
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
