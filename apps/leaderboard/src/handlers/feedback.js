// Public viewer feedback handler.
// Submits feedback tied to the current site and (optionally) signed-in viewer.
import { bad, json, readJson, rateLimit, clientIp, rateLimitHeaders, requireUser } from "../auth.js";
import { exec, query, one } from "@yourrank/shared/db";
import { getBySlug, getBoardById } from "../site.js";
import { requireSiteCapability } from "../site-authorization.js";
import { resolveViewer } from "@yourrank/shared/viewer-session";

const MIN_LEN = 10;
const MAX_LEN = 2000;
const LIMIT = 5;
const WINDOW_SEC = 900;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const inboxDefaults = { requireUser, getBoardById, requireSiteCapability, query, one };

// Feedback belongs to the site's owner settings, independently of YourRank support.
export async function handleSiteFeedback(request, env, deps = inboxDefaults) {
  const { user, res } = await deps.requireUser(request, env);
  if (res) return res;
  const params = new URL(request.url).searchParams;
  const siteId = params.get('siteId');
  if (!UUID.test(siteId || '')) return bad('Choose a valid site.', 400);
  const site = await deps.getBoardById(env, user.id, siteId);
  const access = await deps.requireSiteCapability(user, site, 'canRoleManageSiteSettings');
  if (access.res) return access.res;
  if (request.method === 'PATCH') {
    const body = await readJson(request);
    if (!UUID.test(body?.id || '') || typeof body?.read !== 'boolean') return bad('Choose a message and its read state.', 400);
    const item = await deps.one(
      'UPDATE viewer_feedback SET read=$1 WHERE id=$2 AND site_id=$3 RETURNING id, read',
      [body.read, body.id, site.id],
    );
    return item ? json({ ok: true, item }) : bad('Feedback not found.', 404);
  }
  const filter = params.get('filter') || 'all';
  if (!['all', 'unread'].includes(filter)) return bad('Choose All or Unread.', 400);
  const cursor = params.get('cursor');
  const values = [site.id];
  let cursorClause = '';
  if (cursor) {
    if (!UUID.test(cursor)) return bad('Invalid feedback cursor. Refresh the list.', 400);
    values.push(cursor);
    cursorClause = ' AND (created_at, id) < (SELECT created_at, id FROM viewer_feedback WHERE site_id=$1 AND id=$2)';
  }
  // Compare stored timestamps in SQL: JS/driver date serialization loses microseconds.
  const items = await deps.query(
    `SELECT id, message, kick_username, read, created_at::text AS created_at FROM viewer_feedback
     WHERE site_id=$1${filter === 'unread' ? ' AND read = false' : ''}${cursorClause}
     ORDER BY viewer_feedback.created_at DESC, id DESC LIMIT 26`, values,
  );
  const count = await deps.one('SELECT count(*)::int AS count FROM viewer_feedback WHERE site_id=$1 AND read=false', [site.id]);
  const page = items.slice(0, 25);
  const last = page.at(-1);
  return json({ ok: true, siteName: site.name, items: page, unreadCount: count.count,
    nextCursor: items.length > 25 ? last.id : null });
}

async function hashIp(ip) {
  const enc = new TextEncoder().encode(ip || "");
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleFeedback(request, env) {
  const ip = clientIp(request);
  const rl = await rateLimit(env, `feedback:${ip}`, LIMIT, WINDOW_SEC);
  if (!rl.ok) return bad("Too many messages. Please wait before submitting again.", 429, rateLimitHeaders(rl));

  const body = await readJson(request);
  if (!body) return bad("Invalid JSON.", 400);

  const slug = String(body?.slug || "").trim().toLowerCase();
  const message = String(body?.message || "").trim();

  if (!slug) return bad("Site slug is required.", 400);
  if (!message || message.length < MIN_LEN || message.length > MAX_LEN) {
    return bad(`Feedback must be between ${MIN_LEN} and ${MAX_LEN} characters.`, 400);
  }

  const site = await getBySlug(env, slug);
  if (!site || !site.published || site.suspended) return bad("Site not found.", 404);

  const { viewer } = await resolveViewer(request, env);
  let siteViewerId = null;
  if (viewer) {
    const siteViewer = await exec(
      `SELECT id FROM site_viewers WHERE site_id=$1 AND viewer_id=$2`,
      [site.id, viewer.id]
    );
    if (siteViewer?.length) siteViewerId = siteViewer[0].id;
  }

  await exec(
    `INSERT INTO viewer_feedback (site_id, site_viewer_id, viewer_id, kick_username, message, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [site.id, siteViewerId, viewer?.id || null, viewer?.kick_username || null, message, await hashIp(ip)]
  );

  return json({ ok: true }, 200, rateLimitHeaders(rl));
}
