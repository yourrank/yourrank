// One evidence-based connection state model shared by Settings, Rewards, and
// Home. It deliberately describes only facts persisted by YourRank; provider
// delivery success is not inferred from configuration alone.
//
// Authorization (OAuth grant + verified channel) and delivery (webhook
// subscriptions for the events the site's features need) are separate facts:
// a failed subscription never reads as a disconnected authorization.

const EVENT_LABELS = Object.freeze({
  rewardEvents: "reward redemption events",
  chatEvents: "chat message events",
});

function eventState(subscribedAt, checkedAt) {
  if (!checkedAt) return "unverified";
  return subscribedAt ? "subscribed" : "missing";
}

/**
 * Reduce stored subscription facts to per-event states plus the list of events
 * the site's enabled features depend on. Reward events matter once enabled
 * reward mappings exist; chat events once the site uses Chat Giveaways.
 */
export function deriveKickDeliveryHealth({
  rewardEventsSubscribedAt = null,
  chatEventsSubscribedAt = null,
  checkedAt = null,
  requiresRewardEvents = false,
  requiresChatEvents = false,
} = {}) {
  const events = {
    rewardEvents: eventState(rewardEventsSubscribedAt, checkedAt),
    chatEvents: eventState(chatEventsSubscribedAt, checkedAt),
  };
  const required = [
    ...(requiresRewardEvents ? ["rewardEvents"] : []),
    ...(requiresChatEvents ? ["chatEvents"] : []),
  ];
  const missing = required.filter((event) => events[event] === "missing");
  return {
    verifiedAt: checkedAt || null,
    events,
    required,
    missing,
    missingLabels: missing.map((event) => EVENT_LABELS[event]),
  };
}

export function deriveKickConnectionHealth({
  channelLinked = false,
  requireChannel = true,
  accountLinked = false,
  hasAccessToken = false,
  hasRefreshToken = false,
  tokenExpiresAt = null,
  activeRewardMappings = 0,
  operationEnabled = true,
  usesChatGiveaways = false,
  delivery: deliveryFacts = null,
  now = Date.now(),
} = {}) {
  const linked = !requireChannel || Boolean(channelLinked);
  const activeDependency = Boolean(operationEnabled) && Number(activeRewardMappings) > 0;
  const delivery = deliveryFacts
    ? deriveKickDeliveryHealth({
      ...deliveryFacts,
      requiresRewardEvents: activeDependency,
      requiresChatEvents: Boolean(usesChatGiveaways),
    })
    : null;
  const withDelivery = (health) => (delivery ? { ...health, delivery } : health);
  if (!linked) {
    return withDelivery({
      status: activeDependency ? "needs_attention" : "not_connected",
      label: activeDependency ? "Needs attention" : "Not connected",
      detail: activeDependency
        ? "Connect a Kick channel to restore active reward grants."
        : "Connect a Kick channel when you want Kick rewards to grant credits.",
      needsAttention: activeDependency,
      homeAttention: activeDependency,
      reason: activeDependency ? "channel_missing" : null,
    });
  }

  const expiresAt = tokenExpiresAt ? new Date(tokenExpiresAt).getTime() : null;
  const missingAuthorization = !accountLinked || !hasAccessToken;
  if (missingAuthorization) {
    return withDelivery({
      status: "needs_attention",
      label: "Reconnect required",
      detail: "Kick revoked or invalidated the saved authorization. Reconnect Kick to keep active reward grants working.",
      needsAttention: true,
      homeAttention: activeDependency,
      reason: "authorization_missing",
    });
  }

  if (!Number.isFinite(expiresAt)) {
    return withDelivery({
      status: "needs_verification",
      label: "Needs verification",
      detail: "Authorization is saved, but its current validity has not been verified.",
      needsAttention: false,
      homeAttention: false,
      reason: "authorization_unverified",
    });
  }

  if (expiresAt <= now && !hasRefreshToken) {
    return withDelivery({
      status: "needs_attention",
      label: "Authorization expired",
      detail: "The saved Kick authorization expired and no refresh credential is stored. Reconnect Kick to keep active reward grants working.",
      needsAttention: true,
      homeAttention: activeDependency,
      reason: "authorization_expired",
    });
  }

  // Authorization is usable from here on. A required webhook subscription
  // that the last reconciliation could not establish is a delivery fault the
  // creator can repair without re-authorizing.
  if (delivery && delivery.missing.length > 0) {
    return withDelivery({
      status: "delivery_failed",
      label: "Delivery setup failed",
      detail: `Kick is authorized, but YourRank is not subscribed to ${delivery.missingLabels.join(" and ")} for this channel. Repair delivery to restore it.`,
      needsAttention: true,
      homeAttention: delivery.missing.includes("rewardEvents"),
      reason: delivery.missing.includes("rewardEvents") ? "reward_events_missing" : "chat_events_missing",
      canRepair: true,
    });
  }

  if (expiresAt <= now) {
    // Self-healing: the access token expired but the refresh credential is
    // saved, so the next Kick operation renews it transparently. This is a
    // normal OAuth lifecycle state, not something the owner must act on —
    // the label reads like a plain connection.
    return withDelivery({
      status: "refresh_required",
      label: "Connected",
      detail: "Kick access renews itself automatically.",
      needsAttention: false,
      homeAttention: false,
      reason: "refresh_required",
    });
  }

  const verifiedDelivery = delivery?.verifiedAt && delivery.required.length > 0;
  return withDelivery({
    status: verifiedDelivery ? "ready" : "authorized",
    label: verifiedDelivery ? "Ready" : "Authorized",
    detail: verifiedDelivery
      ? "OAuth authorization, the selected-site channel, and the event subscriptions your features need are all in place."
      : "OAuth authorization and the selected-site channel are saved. Provider delivery is not independently verified.",
    needsAttention: false,
    homeAttention: false,
    reason: null,
  });
}
