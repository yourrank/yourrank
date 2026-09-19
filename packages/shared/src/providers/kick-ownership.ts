/**
 * Kick-specific channel ownership rule: a Kick channel is identified by its
 * broadcaster's user id, so the authenticated creator owns the channel exactly
 * when the ids are equal. This is the only place that equality may be assumed;
 * generic binding/routing code records the verifying creator connection instead.
 */
export function kickCreatorOwnsChannel(kickUserId: string | null | undefined, kickChannelId: string | null | undefined): boolean {
  const userId = String(kickUserId || "");
  const channelId = String(kickChannelId || "");
  return Boolean(userId && channelId && userId === channelId);
}
