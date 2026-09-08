// Exercise the real handlers against local workerd/R2. Database collaborators
// are fixtures; no production bucket or database is contacted.
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { handleCreditsSaveShopItem, handleCreditsDeleteShopItem } from '../apps/leaderboard/src/handlers/credits.js';
import { handleRewardImage } from '../apps/leaderboard/src/handlers/reward-images.js';
import { attachRouteContext } from '../apps/leaderboard/src/middleware/handler.js';

const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', compatibilityDate: '2025-01-01', r2Buckets: ['REWARD_IMAGES'] });
try {
  const env = { REWARD_IMAGES: await mf.getR2Bucket('REWARD_IMAGES') };
  const id = '11111111-1111-4111-8111-111111111111';
  const site = { id: 'site-a', user_id: 'owner', data: {} };
  let item = { id, active: true, image_key: null };
  const deps = {
    requireUser: async () => ({ user: { id: 'owner', plan: 'pro' } }), getBoardById: async () => site,
    requireSiteCapability: async () => ({}), rateLimit: async () => ({ ok: true }), one: async () => item,
    withTransaction: async fn => fn({
      one: async sql => sql.includes('count(') ? { count: 0 } : item,
      unsafe: async (sql, params) => {
        if (sql.startsWith('UPDATE shop_items')) item = { ...item, image_key: params[7] ? params[8] : item.image_key };
        return [item];
      },
    }),
    exec: async () => { item = { ...item, active: false, deleted_at: new Date() }; return [item]; },
  };
  const imageData = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
  const save = async image => handleCreditsSaveShopItem(new Request('https://test.com/api/credits/shop?siteId=site-a', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, name: 'Test reward', cost: 10, imageData: image }),
  }), env, deps);
  const imageRequest = () => attachRouteContext(new Request(`https://test.com/api/public/creator/reward-images/${id}`), { slug: 'creator', id });
  const readDeps = { getPublicSite: async () => site, one: async () => item.active && !item.deleted_at ? item : null };
  assert.equal((await save(imageData)).status, 200);
  const firstKey = item.image_key;
  const response = await handleRewardImage(imageRequest(), env, readDeps);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(imageData.slice(23), 'base64'));
  const cached = imageRequest(); cached.headers.set('if-none-match', response.headers.get('etag'));
  assert.equal((await handleRewardImage(cached, env, readDeps)).status, 304);
  assert.equal((await handleRewardImage(cached, env, { ...readDeps, getPublicSite: async () => ({ requiresPassword: true }) })).status, 404);
  assert.equal((await save(imageData)).status, 200);
  assert.notEqual(item.image_key, firstKey);
  assert.equal(await env.REWARD_IMAGES.get(firstKey), null);
  const secondKey = item.image_key;
  assert.equal((await save(null)).status, 200);
  assert.equal(item.image_key, null);
  assert.equal(await env.REWARD_IMAGES.get(secondKey), null);
  assert.equal((await save(imageData)).status, 200);
  const lastKey = item.image_key;
  assert.equal((await handleCreditsDeleteShopItem(new Request(`https://test.com/api/credits/shop/${id}?siteId=site-a`, { method: 'DELETE' }), env, deps)).status, 200);
  assert.equal(await env.REWARD_IMAGES.get(lastKey), null);
  assert.equal((await handleRewardImage(imageRequest(), env, readDeps)).status, 404);
  console.log('PASSED: real local R2 upload/read/ETag, password revalidation, replacement/removal/delete cleanup; fixture database retained claim row.');
} finally { await mf.dispose(); }
