import { requireUser, bad } from '../auth.js';
import { getBoardById, getPublicSite } from '../site.js';
import { requireSiteCapability } from '../site-authorization.js';
import { one } from '@yourrank/shared/db';
import { routeContext } from '../middleware/handler.js';
import { isRewardImageKey } from '../reward-media.js';

export async function handleRewardImage(request, env, deps = {}) {
  const db = deps.one || one;
  const context = routeContext(request);
  const slug = new URL(request.url).pathname.startsWith('/api/public/') ? context.slug : null;
  const id = context.id;
  if (!id || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) return bad('Image not found', 404);
  let site;
  if (slug) {
    site = await (deps.getPublicSite || getPublicSite)(env, slug, request);
    if (!site || site.requiresPassword || site.suspended || site.pendingVerification || site.data?.siteSections?.shop === false) return bad('Image not found', 404);
  } else {
    const { user, res } = await (deps.requireUser || requireUser)(request, env);
    if (res) return res;
    site = await (deps.getBoardById || getBoardById)(env, user.id, new URL(request.url).searchParams.get('siteId'));
    if (!site) return bad('Image not found', 404);
    const access = await (deps.requireSiteCapability || requireSiteCapability)(user, site, 'canRoleManageRewards');
    if (access.res) return access.res;
  }
  const item = await db(`SELECT image_key FROM shop_items WHERE id=$1 AND site_id=$2 AND deleted_at IS NULL${slug ? ' AND active=true' : ''}`, [id, site.id]);
  if (!isRewardImageKey(item?.image_key, site.id)) return bad('Image not found', 404);
  if (!env.REWARD_IMAGES) return bad('Image storage unavailable', 503);
  let object;
  try { object = await env.REWARD_IMAGES.get(item.image_key); }
  catch { return bad('Image temporarily unavailable', 503); }
  if (!object) return bad('Image not found', 404);
  // A public URL may still require a password cookie or become unpublished.
  // Revalidate browser copies after authorization; never serve a shared CDN hit
  // before those gates. R2 supplies the bytes, without decoding database text.
  const headers = { 'content-type': 'image/webp', 'cache-control': 'private, no-cache', 'etag': object.httpEtag, 'x-content-type-options': 'nosniff' };
  if (request.headers.get('if-none-match') === object.httpEtag) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers: { ...headers, 'content-length': String(object.size) } });
}
