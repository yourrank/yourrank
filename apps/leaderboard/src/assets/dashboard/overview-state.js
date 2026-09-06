export function visitsMetricState({ published, statsStatus, stats } = {}) {
  if (!published) return { kind: "unpublished", value: "Not published" };
  if (statsStatus === "loading") return { kind: "loading" };
  if (statsStatus === "ready") {
    const days = Array.isArray(stats?.days) ? stats.days : [];
    // "Visits this week" — the series is longer than a week, so slice it.
    const views = days.slice(-7).reduce((total, day) => total + Number(day?.views || 0), 0);
    return { kind: "ready", value: views };
  }
  return { kind: "unavailable", value: "Unavailable" };
}

export function activityEmptyAction(published) {
  return published
    ? { label: "Share your site", href: "/dashboard/leaderboard/share" }
    : { label: "Publish your site", href: "/dashboard/leaderboard/setup" };
}

export function automationHomeState(automation = {}) {
  const schedules = Array.isArray(automation.schedules) ? automation.schedules : [];
  const seen = new Set();
  const unique = schedules.filter((schedule) => {
    if (!schedule?.id || seen.has(schedule.id)) return false;
    seen.add(schedule.id);
    return schedule.kind === "safe_code_drop";
  });
  return {
    comingNext: unique.find((schedule) => schedule.status === "scheduled") || null,
    needsAttention: unique.filter((schedule) => ["paused", "failed"].includes(schedule.status)).slice(0, 5),
  };
}

// Home needs enough information to operate an open Activity without exposing
// the claim code embedded in the Activity title. Keep this as a deliberately
// smaller projection than the Activities page and accept only the proven safe
// code-drop adapter.
export function activityHomeState(activities = []) {
  const seen = new Set();
  const open = (Array.isArray(activities) ? activities : []).flatMap((activity) => {
    if (
      !activity?.id ||
      seen.has(activity.id) ||
      activity.source?.kind !== "code_drop" ||
      activity.type !== "drop" ||
      activity.state !== "open"
    ) return [];
    seen.add(activity.id);
    return [{
      id: activity.id,
      typeLabel: "Code drop",
      stateLabel: "Open",
      endsAt: activity.endsAt || null,
      claimed: Number(activity.progress?.claimed) || 0,
      capacity: Number(activity.progress?.capacity) || 0,
      creditsPerClaim: Number(activity.reward?.creditsPerClaim) || 0,
    }];
  });
  return { open: open.slice(0, 3), totalOpen: open.length };
}

export function nextStepAction({
  status,
  steps,
  pendingOrders = 0,
  creditsEnabled = false,
  creditsStatus = "loading",
  creditsConnected = false,
  rewardMappings = null,
  shopItems = null,
  hasActivity = false,
  visits = null,
} = {}) {
  const setup = steps || {};
  const published = Boolean(status?.published);
  const emailVerified = status?.emailVerified !== false;

  if (!emailVerified && (published || (setup.brand && setup.players))) {
    return {
      key: "verifyEmail",
      title: "Confirm your email",
      body: "Your site is ready, but visitors cannot open it until your email is confirmed.",
      label: "Confirm email",
      href: "/verify-email",
    };
  }
  if (!setup.brand) {
    return {
      key: "brand",
      title: "Finish setting up your site",
      body: "Give the public site a clear name so visitors know where they are.",
      label: "Name site",
      href: "/dashboard/site",
    };
  }
  if (!setup.players) {
    return {
      key: "players",
      title: "Add your first players",
      body: "Add names and scores or amounts so the standings have something real to rank.",
      label: "Add players",
      href: "/dashboard/leaderboard/players",
    };
  }
  if (!published) {
    return {
      key: "publish",
      title: "Publish your site",
      body: "The essentials are ready. Publish when you want visitors to open the standings.",
      label: "Publish site",
      href: "#publish",
      publicationAction: true,
    };
  }
  if (Number(pendingOrders) > 0) {
    return {
      key: "pendingOrders",
      title: "Review pending claims",
      body: "Members are waiting on reward claims for this site.",
      label: Number(pendingOrders) === 1 ? "Review claim" : "Review claims",
      href: "/dashboard/rewards/redemptions",
    };
  }
  if (creditsEnabled && creditsStatus === "ready" && !creditsConnected) {
    return {
      key: "connectKick",
      title: "Connect Kick",
      body: "Connect your channel before members can earn credits from Kick rewards.",
      label: "Connect Kick",
      href: "/dashboard/site/connections",
    };
  }
  if (creditsEnabled && creditsStatus === "ready" && creditsConnected && rewardMappings === 0) {
    return {
      key: "addReward",
      title: "Create your first way to earn",
      body: "Create a Kick reward so members can earn credits before they can claim shop items.",
      label: "Create way to earn",
      href: "/dashboard/rewards/rules#cr-reward-create-form",
    };
  }
  if (creditsEnabled && creditsStatus === "ready" && creditsConnected && rewardMappings > 0 && shopItems === 0) {
    return {
      key: "addShopItem",
      title: "Add your first shop item",
      body: "Create the item members can claim with the credits they earn.",
      label: "Create shop item",
      href: "/dashboard/rewards/shop",
    };
  }
  if (published && !hasActivity && visits === 0) {
    return {
      key: "shareSite",
      title: "Share your site",
      body: "Copy the live link and put it where your viewers will see it.",
      label: "Share site",
      href: "/dashboard/leaderboard/share",
    };
  }
  return null;
}
