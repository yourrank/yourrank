import { describe, it, expect, mock } from 'bun:test';
import { handleSiteFeedback } from '../handlers/feedback.js';
import { requireSiteCapability } from '../site-authorization.js';

const siteId = '376f8224-0deb-4901-a3a0-e003b1b1364b';
const id = '00000000-0000-4000-8000-000000000001';
const site = { id: siteId, user_id: 'owner', name: 'Atlas' };
function req(params = '', body) {
  return new Request(`http://localhost/api/site/feedback?siteId=${siteId}${params}`, body ? {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  } : {});
}
function deps(overrides = {}) {
  return {
    requireUser: async () => ({ user: { id: 'owner' } }),
    getBoardById: async () => site,
    requireSiteCapability,
    query: mock(async () => []),
    one: mock(async () => ({ count: 2 })),
    ...overrides,
  };
}
describe('site feedback ownership and reading', () => {
  it('requires authentication before reading any site', async () => {
    const d = deps({ requireUser: async () => ({ res: new Response('', { status: 401 }) }) });
    expect((await handleSiteFeedback(req(), {}, d)).status).toBe(401);
    expect(d.query).not.toHaveBeenCalled();
  });
  it('does not reveal another site or permit a moderator to read owner settings', async () => {
    const missing = deps({ getBoardById: async () => null });
    expect((await handleSiteFeedback(req(), {}, missing)).status).toBe(404);
    const moderator = deps({ requireUser: async () => ({ user: { id: 'mod' } }),
      requireSiteCapability: (u, s, c) => requireSiteCapability(u, s, c, { getSiteRole: async () => 'moderator' }) });
    expect((await handleSiteFeedback(req(), {}, moderator)).status).toBe(403);
    expect(moderator.query).not.toHaveBeenCalled();
  });
  it('paginates deterministically and returns only display fields', async () => {
    const rows = Array.from({ length: 26 }, (_, n) => ({ id: n ? `00000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}` : id,
      message: '<script>text</script>', kick_username: null, read: false, created_at: '2026-09-10 10:00:00.123456+00' }));
    const d = deps({ query: mock(async () => rows) });
    const body = await (await handleSiteFeedback(req('&filter=unread'), {}, d)).json();
    expect(body.items).toHaveLength(25);
    expect(body.nextCursor).toBe(rows[24].id);
    expect(body.unreadCount).toBe(2);
    expect(d.query.mock.calls[0][1][0]).toBe(siteId);
    expect(d.query.mock.calls[0][0]).toContain('read = false');
    expect(d.query.mock.calls[0][0]).not.toMatch(/ip_hash|viewer_id|SELECT \*/);
    await handleSiteFeedback(req(`&cursor=${encodeURIComponent(body.nextCursor)}`), {}, d);
    expect(d.query.mock.calls[1][0]).toContain('(created_at, id) <');
  });
  it('rejects malformed cursor and read state without querying messages', async () => {
    const d = deps();
    expect((await handleSiteFeedback(req('&cursor=bad'), {}, d)).status).toBe(400);
    expect((await handleSiteFeedback(req('', { id, read: 'false' }), {}, d)).status).toBe(400);
    expect(d.query).not.toHaveBeenCalled();
  });
  it('scopes an idempotent read update by both site and message', async () => {
    const d = deps({ one: mock(async () => ({ id, read: true })) });
    expect((await handleSiteFeedback(req('', { id, read: true }), {}, d)).status).toBe(200);
    expect(d.one.mock.calls[0][1]).toEqual([true, id, siteId]);
    expect(d.one.mock.calls[0][0]).toContain('id=$2 AND site_id=$3');
    const absent = deps({ one: async () => null });
    expect((await handleSiteFeedback(req('', { id, read: true }), {}, absent)).status).toBe(404);
  });
});
