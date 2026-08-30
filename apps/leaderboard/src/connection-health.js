// One evidence-based connection state model shared by Settings, Rewards, and
// Home. It deliberately describes only facts persisted by YourRank; provider
// delivery success is not inferred from configuration alone.

export function deriveKickConnectionHealth({
  channelLinked = false,
  requireChannel = true,
  accountLinked = false,
  hasAccessToken = false,
  hasRefreshToken = false,
  tokenExpiresAt = null,
  activeRewardMappings = 0,
  operationEnabled = true,
  now = Date.now(),
} = {}) {
  const linked = !requireChannel || Boolean(channelLinked);
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
  const missingAuthorization = !accountLinked || !hasAccessToken;
  if (missingAuthorization) {
    return {
      status: "needs_attention",
      label: "Needs attention",
      detail: "Reconnect Kick to keep active reward grants working.",
      needsAttention: true,
      homeAttention: activeDependency,
      reason: "authorization_missing",
    };
  }

  if (!Number.isFinite(expiresAt)) {
    return {
      status: "needs_verification",
      label: "Needs verification",
      detail: "Authorization is saved, but its current validity has not been verified.",
      needsAttention: false,
      homeAttention: false,
      reason: "authorization_unverified",
    };
  }

  if (expiresAt <= now) {
    if (hasRefreshToken) {
      return {
        status: "refresh_required",
        label: "Refresh required",
        detail: "The saved access token has expired. YourRank will try the saved refresh authorization when the next Kick operation runs.",
        needsAttention: false,
        homeAttention: false,
        reason: "refresh_required",
      };
    }
    return {
      status: "needs_attention",
      label: "Needs attention",
      detail: "Reconnect Kick to keep active reward grants working.",
      needsAttention: true,
      homeAttention: activeDependency,
      reason: "authorization_expired",
    };
  }

  return {
    status: "authorized",
    label: "Authorized",
    detail: "OAuth authorization and the selected-site channel are saved. Provider delivery is not independently verified.",
    needsAttention: false,
    homeAttention: false,
    reason: null,
  };
}
