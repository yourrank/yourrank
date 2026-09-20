// Pure projections for Dashboard Home. Every function takes already-fetched
// data for the selected site and returns what the page renders, so the order,
// bounds and routing of each Home section are testable without a DOM.
import { buildDashboardPath } from "@yourrank/shared/dashboard-routes";

export const HOME_LIVE_LIMIT = 4;
export const HOME_UPCOMING_LIMIT = 4;
export const HOME_RECENT_LIMIT = 8;
export const HOME_PULSE_DAYS = 30;

// Community header: one status word derived from existing publish state.
export function communityStatus(status = {}) {
  if (status.live) return { state: "live", label: "Live" };
  if (status.published) return { state: "attention", label: "Needs attention" };
  return { state: "draft", label: "Draft" };
}

// Automation schedules that Home may speak about: safe code-drop schedules only.
export function automationHomeState(automation = {}) {
  const schedules = Array.isArray(automation.schedules) ? automation.schedules : [];
  const seen = new Set();
  const unique = schedules.filter((schedule) => {
    if (!schedule?.id || seen.has(schedule.id)) return false;
    seen.add(schedule.id);
    return schedule.kind === "safe_code_drop";
  });
  return {
    upcoming: unique.filter((schedule) => schedule.status === "scheduled" && schedule.nextRunAt),
    needsAttention: unique.filter((schedule) => ["paused", "failed"].includes(schedule.status)).slice(0, 5),
  };
}

// Home needs enough information to operate an open Activity without exposing
// the claim code embedded in the Activity title. Keep this as a deliberately
// smaller projection than the Activities page and accept only the proven safe
// code-drop adapter.
export function activityHomeState(activities = [], { total = null } = {}) {
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
  // `total` is the server's count of genuinely open drops for the site; the
  // rows themselves are one bounded page of it.
  const serverTotal = Number(total);
  const totalOpen = Number.isFinite(serverTotal) && serverTotal >= open.length ? serverTotal : open.length;
  return { open: open.slice(0, HOME_LIVE_LIMIT), totalOpen };
}

// /api/giveaways/chat returns the site's single current session; only an
// `active` one is live.
export function giveawayHomeState(body = {}) {
  const session = body?.session;
  if (!session?.id || session.status !== "active") return { active: null };
  return {
    active: {
      id: session.id,
      keyword: session.keyword || "",
      entries: Array.isArray(body.entries) ? body.entries.length : 0,
      startedAt: session.started_at || session.startedAt || null,
    },
  };
}

// Live now: only engagement that is running right now, each with the canonical
// place to manage it.
export function liveNowItems({ activities = { open: [], totalOpen: 0 }, giveaway = { active: null }, siteId = "" } = {}) {
  const items = [];
  const totalOpen = Math.max(Number(activities.totalOpen) || 0, (activities.open || []).length);
  const totalLive = totalOpen + (giveaway.active ? 1 : 0);
  // The single active giveaway always keeps its slot; drops fill the rest.
  const dropSlots = HOME_LIVE_LIMIT - (giveaway.active ? 1 : 0);
  for (const drop of (activities.open || []).slice(0, dropSlots)) {
    const progress = drop.capacity > 0 ? `${drop.claimed.toLocaleString("en-US")} of ${drop.capacity.toLocaleString("en-US")} claims` : `${drop.claimed.toLocaleString("en-US")} claims`;
    items.push({
      key: drop.id,
      kind: "code_drop",
      name: drop.typeLabel,
      status: drop.stateLabel,
      meta: drop.creditsPerClaim > 0 ? `${progress} · ${drop.creditsPerClaim.toLocaleString("en-US")} credits each` : progress,
      endsAt: drop.endsAt,
      href: buildDashboardPath("activities.overview", { siteId }),
      action: "Manage",
    });
  }
  if (giveaway.active) {
    const entries = giveaway.active.entries;
    items.push({
      key: `giveaway:${giveaway.active.id}`,
      kind: "chat_giveaway",
      name: "Chat giveaway",
      status: "Collecting entries",
      meta: `${entries.toLocaleString("en-US")} ${entries === 1 ? "entry" : "entries"}${giveaway.active.keyword ? ` · keyword “${giveaway.active.keyword}”` : ""}`,
      endsAt: null,
      href: buildDashboardPath("giveaways.chat", { siteId }),
      action: "Manage",
    });
  }
  return { items, more: Math.max(0, totalLive - items.length) };
}

// Coming next: real future events from the existing model — scheduled safe
// Activities and the leaderboard period end — sorted by time.
export function comingNextItems({ upcoming = [], leaderboardEndsAt = null, siteId = "", now = Date.now() } = {}) {
  const nowMs = typeof now === "number" ? now : new Date(now).getTime();
  const future = (value) => {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) && ms > nowMs ? ms : null;
  };
  const items = [];
  for (const schedule of upcoming) {
    const at = future(schedule.nextRunAt);
    if (!at) continue;
    const recurrence = schedule.recurrence === "daily" ? "Repeats daily" : schedule.recurrence === "weekly" ? "Repeats weekly" : "One time";
    items.push({
      key: `schedule:${schedule.id}`,
      kind: "scheduled_activity",
      name: schedule.templateName || "Scheduled Activity",
      meta: recurrence,
      at: new Date(at).toISOString(),
      href: buildDashboardPath("activities.overview", { siteId }),
      action: "Open Activities",
    });
  }
  const periodEnd = future(leaderboardEndsAt);
  if (periodEnd) {
    items.push({
      key: "leaderboard:period-end",
      kind: "leaderboard_period_end",
      name: "Leaderboard period ends",
      meta: "Final standings freeze and automated score updates stop",
      at: new Date(periodEnd).toISOString(),
      href: buildDashboardPath("board.setup", { board: siteId }),
      action: "Open Leaderboard",
    });
  }
  return items.sort((a, b) => new Date(a.at) - new Date(b.at)).slice(0, HOME_UPCOMING_LIMIT);
}

// Needs attention: only problems with a fix, each routed to its owner.
export function attentionItems({
  status = {},
  steps = {},
  pendingClaims = 0,
  connection = null,
  automationAttention = [],
  siteId = "",
  siteName = "",
} = {}) {
  const items = [];
  const readyToPublish = Boolean(steps.brand && steps.players);
  if (status.emailVerified === false && (status.published || readyToPublish)) {
    items.push({
      key: "verifyEmail",
      scope: "account",
      title: "Confirm your email to publish",
      why: status.published
        ? "This community is marked published, but visitors cannot open it until your account email is confirmed."
        : "Setup is ready. Publishing is blocked until your account email is confirmed.",
      action: "Confirm email",
      href: "/verify-email",
    });
  }
  if (connection?.homeAttention === true) {
    const canManage = connection.canManage !== false;
    items.push({
      key: "kickDelivery",
      scope: "site",
      title: connection.statusLabel ? `Kick: ${connection.statusLabel}` : "Kick connection needs repair",
      why: `${siteName ? `${siteName}: ` : ""}${connection.detail || "Reward grants and chat giveaways stop working until the connection is repaired."}`,
      action: canManage ? "Open Connections" : "View connection",
      href: canManage
        ? buildDashboardPath("settings.connections", { board: siteId })
        : buildDashboardPath("siteConnections.channel", { siteId }),
    });
  }
  const pending = Number(pendingClaims) || 0;
  if (pending > 0) {
    items.push({
      key: "pendingClaims",
      scope: "site",
      title: `${pending.toLocaleString("en-US")} ${pending === 1 ? "claim is" : "claims are"} waiting for you`,
      why: "Members have spent credits and are waiting for their reward.",
      action: pending === 1 ? "Review claim" : "Review claims",
      href: buildDashboardPath("rewards.redemptions", { siteId }),
    });
  }
  if (automationAttention.length) {
    const first = automationAttention[0];
    const count = automationAttention.length;
    items.push({
      key: "automation",
      scope: "site",
      title: count > 1 ? `${count} scheduled Activities need attention` : first.status === "paused" ? "Scheduled Activity is paused" : "Scheduled Activity failed",
      why: `${first.templateName || "Schedule"}: ${first.attentionMessage || "Review the schedule before choosing a new future time."}${count > 1 ? ` ${count - 1} more ${count - 1 === 1 ? "schedule needs" : "schedules need"} review.` : ""}`,
      action: "Review schedule",
      href: buildDashboardPath("activities.overview", { siteId }),
    });
  }
  return items;
}

// Community pulse: a few time-bounded figures from the Insights window; never
// lifetime totals dressed up as recent ones.
export function pulseMetrics(insights = null) {
  if (!insights) return { rangeLabel: `Last ${HOME_PULSE_DAYS} days`, metrics: [] };
  const days = Number(insights.window?.effectiveDays) || HOME_PULSE_DAYS;
  const rangeLabel = `Last ${days} days`;
  const metrics = [];
  if (insights.community) metrics.push({ key: "newMembers", label: "New members", value: Number(insights.community.newMembers) || 0 });
  if (insights.participation) metrics.push({ key: "participants", label: "Activity participants", value: Number(insights.participation.participants) || 0 });
  if (insights.rewards) metrics.push({ key: "claimsCompleted", label: "Claims completed", value: Number(insights.rewards.claimsCompleted) || 0 });
  return { rangeLabel, metrics };
}

// Recent activity: bounded, newest first, already normalized by the Worker.
export function recentActivityItems(events = [], { limit = HOME_RECENT_LIMIT } = {}) {
  const seen = new Set();
  return (Array.isArray(events) ? events : [])
    .filter((event) => {
      if (!event?.at || !event.title || Number.isNaN(new Date(event.at).getTime())) return false;
      const key = `${event.kind}|${event.at}|${event.title}|${event.detail || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, limit);
}

// Quick actions: the four most common creator tasks, each on its canonical
// destination with the selected site carried along.
export function quickActions({ siteId = "" } = {}) {
  return [
    { key: "editCommunity", label: "Edit community", href: buildDashboardPath("site", { board: siteId }) },
    { key: "addPlayer", label: "Add leaderboard player", href: buildDashboardPath("board.players", { board: siteId }) },
    { key: "startActivity", label: "Start activity", href: buildDashboardPath("activities.overview", { siteId }) },
    { key: "createReward", label: "Create reward", href: buildDashboardPath("rewards.shop", { siteId }) },
  ];
}

// Setup progress: core milestones only. Optional products never block completion.
export const SETUP_STEPS = [
  { key: "brand", routeId: "site", label: "Name your community", description: "Give your public page a clear name.", action: "Name community" },
  { key: "players", routeId: "board.players", label: "Add players", description: "Add the names and scores you want to rank.", action: "Add players" },
  { key: "publish", routeId: null, label: "Publish your community", description: "Open the standings to visitors and get your live link.", action: "Publish community" },
];

export function setupStepHref(step, { siteId = "", emailVerified = true } = {}) {
  if (step.key === "publish") return emailVerified ? "#publish" : "/verify-email";
  return buildDashboardPath(step.routeId, { board: siteId });
}

export function setupProgress(steps = {}) {
  const completed = SETUP_STEPS.filter((step) => steps[step.key]).length;
  return {
    completed,
    total: SETUP_STEPS.length,
    done: completed === SETUP_STEPS.length,
    next: SETUP_STEPS.find((step) => !steps[step.key]) || null,
  };
}
