import { expect, it } from 'bun:test';
import { handleRewardImage } from '../handlers/reward-images.js';
import { handleCreditsDeleteShopItem, handleCreditsSaveShopItem } from '../handlers/credits.js';
import { attachRouteContext } from '../middleware/handler.js';
import { isCustomViewerApiPath } from '../index.js';
import { handlerSchemas } from '@yourrank/shared/validation';

const id = '11111111-1111-4111-8111-111111111111';
const site = { id: 'site-a', user_id: 'owner', data: {} };
const imageKey = `reward-images/site-a/${id}.webp`;
const imageData = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
it('admits image edits through the real request body contract', () => {
  expect(handlerSchemas.handleCreditsSaveShopItem.safeParse({ name: 'Song', cost: 100, imageData: null }).success).toBe(true);
  expect(handlerSchemas.handleCreditsSaveShopItem.safeParse({ name: 'Song', cost: 100, imageData: 'x'.repeat(245793) }).success).toBe(false);
});
const request = (publicImage = true) => attachRouteContext(new Request(`https://test.com${publicImage ? '/api/public/northstar/reward-images/' + id : '/api/credits/shop/' + id + '/image?siteId=site-a'}`), { slug: publicImage ? 'northstar' : id, id });
it('gates public images on site access and active scoped item', async () => {
  for (const blocked of [null, { requiresPassword: true }, { suspended: true }, { data: { siteSections: { shop: false } } }]) {
    expect((await handleRewardImage(request(), {}, { getPublicSite: async () => blocked, one: () => { throw new Error('must not read image'); } })).status).toBe(404);
  }
  const response = await handleRewardImage(request(), { REWARD_IMAGES: { get: async key => { expect(key).toBe(imageKey); return { body: 'abc', size: 3, httpEtag: '"image-1"' }; } } }, { getPublicSite: async () => site, one: async (sql, params) => { expect(sql).toContain('active=true'); expect(params).toEqual([id, 'site-a']); return { image_key: imageKey }; } });
  expect(response.headers.get('content-type')).toBe('image/webp');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('cache-control')).toBe('private, no-cache');
  expect(await response.text()).toBe('abc');
});

it('handles corrupt keys, missing objects and storage failures without decoding database text', async () => {
  for (const key of [null, 'data:image/webp;base64,???', imageKey.replace('site-a', 'site-b')]) {
    const response = await handleRewardImage(request(), { REWARD_IMAGES: { get: () => { throw new Error('must not read'); } } }, { getPublicSite: async () => site, one: async () => ({ image_key: key }) });
    expect(response.status).toBe(404);
  }
  const deps = { getPublicSite: async () => site, one: async () => ({ image_key: imageKey }) };
  expect((await handleRewardImage(request(), {}, deps)).status).toBe(503);
  expect((await handleRewardImage(request(), { REWARD_IMAGES: { get: async () => null } }, deps)).status).toBe(404);
  expect((await handleRewardImage(request(), { REWARD_IMAGES: { get: async () => { throw new Error('offline'); } } }, deps)).status).toBe(503);
});

it('persists only an object key, and leaves rewards unchanged when storage is unavailable', async () => {
  const save = () => new Request('https://test.com/api/credits/shop?siteId=site-a', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, name: 'Song', cost: 100, imageData }) });
  const writes = [];
  expect((await handleCreditsSaveShopItem(save(), {}, shopDeps(writes))).status).toBe(503);
  expect(writes).toHaveLength(0);
  let storedKey;
  const env = { REWARD_IMAGES: { put: async (key, bytes, options) => { storedKey = key; expect(bytes).toBeInstanceOf(Uint8Array); expect(options.httpMetadata.contentType).toBe('image/webp'); return {}; } } };
  expect((await handleCreditsSaveShopItem(save(), env, shopDeps(writes))).status).toBe(200);
  expect(writes[1].params[8]).toBe(storedKey);
  expect(writes[1].params).not.toContain(imageData);
  expect(storedKey).toStartWith('reward-images/site-a/');
});
it('uses creator capabilities for previews and restricts custom hosts to their own slug', async () => {
  const response = await handleRewardImage(request(false), {}, { requireUser: async () => ({ user: { id: 'owner' } }), getBoardById: async () => site, requireSiteCapability: async () => ({ res: new Response(null, { status: 403 }) }) });
  expect(response.status).toBe(403);
  expect(isCustomViewerApiPath('GET', `/api/public/northstar/reward-images/${id}`, 'northstar')).toBe(true);
  expect(isCustomViewerApiPath('GET', '/api/public/northstar/players', 'other')).toBe(false);
});
function shopDeps(writes) {
  return { requireUser: async () => ({ user: { id: 'owner', plan: 'pro' } }), getBoardById: async () => site, requireSiteCapability: async () => ({}), rateLimit: async () => ({ ok: true }), one: async () => ({ active: true }), exec: async (sql, params) => { writes.push({ sql, params }); return [{ id }]; }, withTransaction: async fn => fn({ one: async () => ({ count: 0 }), unsafe: async (sql, params) => { writes.push({ sql, params }); return [{ id }]; } }) };
}
it('deletion removes the reward from the shop while retaining the row for claims', async () => {
  const writes = [];
  const response = await handleCreditsDeleteShopItem(new Request(`https://test.com/api/credits/shop/${id}?siteId=site-a`, { method: 'DELETE' }), {}, shopDeps(writes));
  expect(response.status).toBe(200);
  expect(writes[0].sql).toContain('deleted_at=COALESCE');
  expect(writes[0].sql).toContain('active=false');
  expect(writes[0].params).toEqual([id, 'site-a']);
  expect(writes[0].sql).not.toContain('DELETE FROM');
});
it('ordinary edits preserve pictures; explicit removal clears them and deleted items cannot be revived', async () => {
  for (const imageData of [undefined, null]) {
    const writes = [];
    const response = await handleCreditsSaveShopItem(new Request('https://test.com/api/credits/shop?siteId=site-a', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, name: 'Song', cost: 100, imageData }) }), {}, shopDeps(writes));
    expect(response.status).toBe(200);
    expect(writes[1].params.slice(7)).toEqual([imageData !== undefined, null]);
    expect(writes[1].sql).toContain('deleted_at IS NULL');
  }
});
