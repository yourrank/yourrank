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
      body: "Name the leaderboard so visitors know what they are following.",
      label: "Name leaderboard",
      href: "/dashboard/leaderboard/setup",
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
