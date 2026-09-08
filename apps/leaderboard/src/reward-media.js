// Keys are server-generated and site-scoped. The bucket stays private; all
// reads pass through the site's publication/password and item availability gate.
export function isRewardImageKey(key, siteId) {
  return typeof key === 'string' && key.startsWith(`reward-images/${siteId}/`) && /^[a-f0-9-]{36}\.webp$/.test(key.slice(`reward-images/${siteId}/`.length));
}

export async function removeRewardImage(env, key, siteId) {
  if (!isRewardImageKey(key, siteId)) return;
  try {
    if (!env.REWARD_IMAGES) throw new Error('Reward image storage unavailable');
    await env.REWARD_IMAGES.delete(key);
  } catch {
    // The database mutation already committed. Report cleanup failure without
    // pretending the user's save failed or undoing a successfully saved reward.
    console.error('reward-image-cleanup-failed', { siteId, key });
  }
}
