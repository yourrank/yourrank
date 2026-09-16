import { expect, it } from 'bun:test';
import { handleEventLeaderboards } from '../handlers/event-leaderboards.js';
import { renderSite } from '@yourrank/shared/site-render';
import { resolvePublicEvent } from '../site.js';

const id = '11111111-1111-4111-8111-111111111111';
const stamp = '2026-09-08T00:00:00.000Z';
function harness({ existing = null, count = 0, denied = false } = {}) {
  const writes = [];
  const deps = {
    requireUser: async () => ({ user: { id: 'owner', plan: 'pro' } }),
    getBoardById: async (_env, _user, siteId) => siteId === 'site-a' ? { id: siteId, user_id: 'owner' } : null,
    requireSiteCapability: async () => denied ? { res: new Response(null, { status: 403 }) } : {},
    rateLimit: async () => ({ ok: true }),
    query: async (_sql, params) => { expect(params).toEqual(['site-a']); return []; },
    withTransaction: async fn => fn({
      one: async (sql, params) => { expect(params).toContain('site-a'); return sql.includes('count(') ? { count } : existing; },
      unsafe: async (sql, params) => { writes.push({ sql, params }); return []; },
    }),
  };
  const call = (body, method = 'POST', site = 'site-a') => handleEventLeaderboards(new Request(`https://example.com/api/site/events?siteId=${site}`, { method, ...(method === 'GET' ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }), {}, deps);
  return { call, writes };
}
it('saves a published event with separate site-scoped players', async () => {
  const { call, writes } = harness();
  expect((await call({ name: 'Event A', players: [{ name: 'Alex', score: 10 }], published: true })).status).toBe(200);
  expect(writes[1].sql).toContain('INSERT INTO app_private.site_event_leaderboards');
  expect(writes[1].params.slice(1)).toEqual(['site-a', 'Event A', [{ name: 'Alex', score: 10 }], true]);
});
it('rejects foreign sites, roles, stale saves, and event limits', async () => {
  const body = { name: 'A', players: [] };
  expect((await harness().call(body, 'POST', 'site-b')).status).toBe(404);
  expect((await harness({ denied: true }).call(body)).status).toBe(403);
  expect((await harness({ count: 20 }).call(body)).status).toBe(400);
  expect((await harness().call({ ...body, id })).status).toBe(404);
  expect((await harness({ existing: { id, updated_at: stamp } }).call({ ...body, id, updatedAt: '2026-01-01' })).status).toBe(409);
  expect((await harness().call({}, 'DELETE')).status).toBe(400);
});
it('deletes only a selected event at the expected version', async () => {
  const { call, writes } = harness({ existing: { id, updated_at: stamp } });
  expect((await call({ id, updatedAt: stamp }, 'DELETE')).status).toBe(200);
  expect(writes[1]).toEqual({ sql: 'DELETE FROM app_private.site_event_leaderboards WHERE id=$1 AND site_id=$2', params: [id, 'site-a'] });
});
it('renders selected event identity, switcher and channels without linking to main-player profiles', async () => {
  const data = { brand: { name: 'Northstar' }, rankBy: 'score', players: [{ name: 'Event player', rank: 1, score: 8 }], eventId: id, eventName: 'Event A', eventBoards: [{ id, name: 'Event A' }], socials: [{ name: 'Kick', url: 'https://kick.com/northstar', enabled: true }], branding: { template: 'spotlight' } };
  const html = await renderSite({ r: { slug: 'northstar', plan: 'pro', data }, section: 'leaderboard', opts: { slug: 'northstar', homeUrl: 'https://example.com', nonce: 'n' } });
  expect(html).toContain(`data-event-id="${id}"`);
  expect(html).toContain('Event A');
  expect(html).toContain('Main leaderboard');
  expect(html).toContain('https://kick.com/northstar');
  expect(html).not.toContain('/player/Event%20player');
  expect(html).toContain('class="viewer-top-community" href="/northstar"');
  expect(html.indexOf('<h1')).toBeLessThan(html.indexOf('class="viewer-board-switcher"'));
});

it('recovers unavailable event documents without mixing events into paginated results', async () => {
  for (const eventId of ['invalid', id]) {
    const readEvent = async (sql, params) => {
      expect(sql).toContain('site_id=$2 AND published=true');
      expect(params).toEqual([id, 'site-a']);
      return null;
    };
    for (const path of ['/northstar/leaderboard', '/leaderboard']) {
      expect(await resolvePublicEvent(new URL(`https://test.com${path}?event=${eventId}`), 'site-a', readEvent)).toEqual({ event: null, unavailable: true, notFound: false });
    }
    expect((await resolvePublicEvent(new URL(`https://test.com/api/public/northstar/players?event=${eventId}`), 'site-a', readEvent)).notFound).toBe(true);
  }
  const html = await renderSite({ r: { slug: 'northstar', plan: 'pro', data: { brand: { name: 'Northstar' }, eventUnavailable: true, players: [{ name: 'Main player', score: 10 }] } }, section: 'leaderboard', opts: { slug: 'northstar', homeUrl: 'https://test.com', nonce: 'n' } });
  expect(html).toContain('Showing the main leaderboard.');
  expect(html).toContain('Main player');
  expect(html).not.toContain('data-event-id=');
});
