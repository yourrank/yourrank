// One evidence-based connection state model shared by Settings, Rewards, and
// Home. It deliberately describes only facts persisted by YourRank; provider
// delivery success is not inferred from configuration alone.

export function deriveKickConnectionHealth({
  channelLinked = false,
  accountLinked = false,
  hasAccessToken = false,
  hasRefreshToken = false,
  tokenExpiresAt = null,
  activeRewardMappings = 0,
  operationEnabled = true,
  now = Date.now(),
} = {}) {
  const linked = Boolean(channelLinked);
  const activeDependency = Boolean(operationEnabled) && Number(activeRewardMappings) > 0;
  if (!linked) {
    return {
      status: activeDependency ? "needs_attention" : "not_connected",
      label: activeDependency ? "Needs attention" : "Not connected",
      detail: activeDependency
        ? "Connect a Kick channel to restore active reward grants."
        : "Connect a Kick channel when you want Kick rewards to grant credits.",
      needsAttention: activeDependency,
      homeAttention: activeDependency,
      reason: activeDependency ? "channel_missing" : null,
    };
  }

  const expiresAt = tokenExpiresAt ? new Date(tokenExpiresAt).getTime() : null;
  const expired = Number.isFinite(expiresAt) && expiresAt <= now;
  const missingAuthorization = !accountLinked || !hasAccessToken;
  const cannotRefresh = expired && !hasRefreshToken;
  const needsAttention = missingAuthorization || cannotRefresh;
  const reason = missingAuthorization ? "authorization_missing" : cannotRefresh ? "authorization_expired" : null;

  return {
    status: needsAttention ? "needs_attention" : "authorized",
    label: needsAttention ? "Needs attention" : "Authorized",
    detail: needsAttention
      ? "Reconnect Kick to keep active reward grants working."
      : "OAuth authorization and the selected-site channel are saved. Provider delivery is not independently verified.",
    needsAttention,
    homeAttention: needsAttention && activeDependency,
    reason,
  };
}
