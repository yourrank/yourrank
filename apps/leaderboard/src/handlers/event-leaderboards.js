import { requireUser, readJson, bad, ok, rateLimit } from '../auth.js';
import { getBoardById } from '../site.js';
import { requireSiteCapability } from '../site-authorization.js';
import { one, query, withTransaction } from '@yourrank/shared/db';
import { effectivePlan, PLAN_LIMITS } from '@yourrank/shared/plans';
import { validateEventPlayers } from '@yourrank/shared/event-leaderboards';

const defaults = { requireUser, getBoardById, requireSiteCapability, one, query, withTransaction, rateLimit };
export async function handleEventLeaderboards(request, env, deps = defaults) {
  const { user, res } = await deps.requireUser(request, env);
  if (res) return res;
  const siteId = new URL(request.url).searchParams.get('siteId');
  const site = await deps.getBoardById(env, user.id, siteId);
  if (!site) return bad('Site not found', 404);
  const access = await deps.requireSiteCapability(user, site, 'canRoleManageBoard');
  if (access.res) return access.res;
  if (request.method === 'GET') return ok({ events: await deps.query('SELECT id, name, players, published, updated_at FROM app_private.site_event_leaderboards WHERE site_id=$1 ORDER BY created_at, id', [site.id]) });
  if (!(await deps.rateLimit(env, `event-boards:${user.id}`, 30, 60)).ok) return bad('Too many changes. Try again shortly.', 429);
  const body = await readJson(request);
  if (!body) return bad('Invalid request');
  if (request.method === 'DELETE' && !body.id) return bad('Choose an event to delete.');
  const id = String(body.id || crypto.randomUUID());
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) return bad('Invalid event id');
  const name = String(body.name || '').trim();
  let players = [];
  if (request.method !== 'DELETE') {
    if (!name || name.length > 80) return bad('Enter an event name of at most 80 characters.');
    const owner = site.user_id === user.id ? user : await deps.one('SELECT plan, plan_expires_at, status FROM users WHERE id=$1', [site.user_id]);
    try { players = validateEventPlayers(body.players, PLAN_LIMITS[effectivePlan(owner)]); } catch (err) { return bad(err.message); }
  }
  const result = await deps.withTransaction(async tx => {
    await tx.unsafe('SELECT id FROM sites WHERE id=$1 FOR UPDATE', [site.id]);
    const existing = await tx.one('SELECT id, updated_at FROM app_private.site_event_leaderboards WHERE id=$1 AND site_id=$2', [id, site.id]);
    if (body.id && !existing) return { error: 'Event not found', status: 404 };
    if (existing && (!body.updatedAt || new Date(existing.updated_at).getTime() !== new Date(body.updatedAt).getTime())) return { error: 'This event changed in another window. Reload it before saving.', status: 409 };
    if (request.method === 'DELETE') {
      await tx.unsafe('DELETE FROM app_private.site_event_leaderboards WHERE id=$1 AND site_id=$2', [id, site.id]);
    } else if (existing) {
      await tx.unsafe('UPDATE app_private.site_event_leaderboards SET name=$1, players=$2::jsonb, published=$3, updated_at=now() WHERE id=$4 AND site_id=$5', [name, players, body.published === true, id, site.id]);
    } else {
      const count = await tx.one('SELECT count(*)::int AS count FROM app_private.site_event_leaderboards WHERE site_id=$1', [site.id]);
      if (count.count >= 20) return { error: 'This site can have up to 20 event leaderboards.', status: 400 };
      await tx.unsafe('INSERT INTO app_private.site_event_leaderboards(id, site_id, name, players, published) VALUES($1,$2,$3,$4::jsonb,$5)', [id, site.id, name, players, body.published === true]);
    }
    return { id };
  });
  return result.error ? bad(result.error, result.status) : ok(result);
}
