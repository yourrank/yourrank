// Dashboard Home: community header, needs attention, live now, coming next,
// community pulse, recent activity, quick actions, setup progress.
import { $, currentPlayers, getCsrf, logError, showToast } from "./utils.js";
import { state, boardStatus } from "./state.js";
import {
  HOME_LIVE_LIMIT,
  HOME_PULSE_DAYS,
  SETUP_STEPS,
  activityHomeState,
  attentionItems,
  automationHomeState,
  comingNextItems,
  communityStatus,
  giveawayHomeState,
  liveNowItems,
  pulseMetrics,
  quickActions,
  recentActivityItems,
  setupProgress,
  setupStepHref,
} from "./overview-state.js";
import { effectiveBoardRole } from "./role-preview.js";
import { buildDashboardPath } from "@yourrank/shared/dashboard-routes";
import { fetchDashboardJson, retryTransient } from "./request.js";

// Each dynamic Home section loads on its own: one failing request shows a
// compact retry in that section and leaves the rest of Home usable.
const HOME_SECTIONS = {
  activities: {
    request: (params) => `/api/activities?${params}&state=open&limit=${HOME_LIVE_LIMIT}`,
    project: (body) => ({
      automation: automationHomeState(body?.automation),
      activities: activityHomeState(body?.activities, { total: body?.total }),
    }),
  },
  giveaway: {
    request: (params) => `/api/giveaways/chat?${params}`,
    project: (body) => giveawayHomeState(body),
  },
  insights: {
    request: (params) => `/api/insights?${params}&days=${HOME_PULSE_DAYS}`,
    project: (body) => body || null,
  },
  recent: {
    request: (params) => `/api/home/activity?${params}`,
    project: (body) => recentActivityItems(body?.events),
  },
};

const idleSection = () => ({ status: "idle", data: null, error: null });
let home = {
  siteId: null,
  sections: Object.fromEntries(Object.keys(HOME_SECTIONS).map((key) => [key, idleSection()])),
};
let loadToken = 0;
let unloading = false;
let overviewBundle = null;
let overviewBundlePromise = null;

const section = (key, sections) => sections[key] || idleSection();

function formatOverviewDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function relativeTime(iso, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

// Core setup only: brand, players, publish. Kick, rewards, Telegram and
// giveaways are optional products and never gate "setup complete".
function computeSetupSteps() {
  const o = state.ONBOARDING || {};
  const name = $("f_name")?.value.trim();
  const brand = Boolean(o.brand || name);
  const players = !state.SAMPLE_PLAYERS && (currentPlayers().length > 0 || o.players);
  const publish = boardStatus().published;
  return { brand, players, publish };
}

function sectionError(key, message) {
  return { key, message: message || "Couldn't load this section." };
}

function idleState(sourceState) {
  return !sourceState?.ME && !sourceState?.ACTIVE_SITE_ID && !sourceState?.BOARDS?.length;
}

function buildActions() {
  return {
    retry(key) {
      loadHomeSection(key, state.ACTIVE_SITE_ID, loadToken);
    },
    publish() {
      $("publishAction")?.click();
    },
    saveBrandName(name) {
      return saveBrandName(name);
    },
  };
}

export function buildHomeViewModel(inputs = {}) {
  const sourceState = inputs.state || {};
  const status = inputs.status || { live: false, published: false, emailVerified: true };
  const siteId = inputs.siteId ?? sourceState.ACTIVE_SITE_ID ?? "";
  const activeBoard = inputs.activeBoard
    || (sourceState.BOARDS || []).find((board) => board.id === siteId)
    || null;
  const siteNameInput = inputs.siteName;
  const siteName = siteNameInput || activeBoard?.name || sourceState.SLUG || "Selected community";
  const isModerator = inputs.isModerator ?? activeBoard?.userRole === "moderator";
  const ownerName = inputs.ownerName || activeBoard?.ownerName || "the community owner";
  const sourceSections = inputs.sections || Object.fromEntries(Object.keys(HOME_SECTIONS).map((key) => [key, idleSection()]));
  const steps = inputs.steps || { brand: false, players: false, publish: false };
  const number = (value) => value == null ? "—" : Number(value).toLocaleString("en-US");
  const idle = inputs.idle ?? idleState(sourceState);
  const headline = idle ? { state: "checking", label: "Checking…" } : communityStatus(status);
  const liveStatus = idle ? false : headline.state === "live";
  const logoSrc = inputs.logoSrc ?? "";

  const activities = section("activities", sourceSections);
  const automation = activities.data?.automation || { upcoming: [], needsAttention: [] };
  const attention = attentionItems({
    status,
    steps,
    pendingClaims: sourceState.CREDITS?.usage?.pendingRedemptions,
    connection: sourceState.CREDITS?.channel || null,
    automationAttention: automation.needsAttention,
    siteId,
    siteName,
  });

  const giveaway = section("giveaway", sourceSections);
  const liveLoading = activities.status === "loading" || giveaway.status === "loading";
  const liveError = activities.status === "error"
    ? sectionError("activities", "Couldn't check what’s live.")
    : giveaway.status === "error" ? sectionError("giveaway", "Couldn't check what’s live.") : null;
  const live = liveNowItems({
    activities: activities.data?.activities || { open: [], totalOpen: 0 },
    giveaway: giveaway.data || { active: null },
    siteId,
  });
  const liveItems = live.items.map((item) => ({
    ...item,
    meta: `${item.meta}${item.endsAt ? ` · Ends ${formatOverviewDate(item.endsAt)}` : ""}`,
  }));

  const upcoming = comingNextItems({
    upcoming: automation.upcoming,
    leaderboardEndsAt: inputs.leaderboardEndsAt ?? null,
    siteId,
    now: inputs.now ?? 0,
  }).map((item) => ({ ...item, formattedAt: formatOverviewDate(item.at) }));
  const upcomingLoading = activities.status === "loading";
  const upcomingError = activities.status === "error" ? sectionError("activities", "Couldn't load the schedule.") : null;

  const insights = section("insights", sourceSections);
  const pulse = pulseMetrics(insights.status === "ready" ? insights.data : null);
  const placeholders = [
    { key: "newMembers", label: "New members" },
    { key: "participants", label: "Activity participants" },
    { key: "claimsCompleted", label: "Claims completed" },
  ];
  const pulseMetricsList = pulse.metrics.length ? pulse.metrics : placeholders;
  const pulseStatus = insights.status === "ready"
    ? "ready"
    : insights.status === "error" ? "error" : insights.status;

  const recent = section("recent", sourceSections);
  const recentEvents = recent.status === "ready" ? recent.data || [] : [];
  const recentEmpty = recent.status === "ready" && recentEvents.length === 0
    ? { title: "Nothing yet", body: "New members, reward claims and Activity results will show up here." }
    : null;
  const recentError = recent.status === "error" ? sectionError("recent", "Couldn't load recent activity.") : null;

  const progress = setupProgress(steps);
  const readyToPublish = steps.brand && steps.players;
  const pendingVerification = status.published && !status.emailVerified;
  const needsVerification = !status.emailVerified;
  const firstIncomplete = progress.next;
  const firstActionableIncomplete = SETUP_STEPS.find((step) => !steps[step.key] && !(isModerator && step.key === "brand"));
  const showSetup = !progress.done || pendingVerification;
  const verificationIsNext = pendingVerification || (readyToPublish && needsVerification);
  const actionStep = isModerator && firstIncomplete?.key === "brand" ? firstActionableIncomplete : firstIncomplete;
  const publicationIsNext = !verificationIsNext && actionStep?.key === "publish";
  const brandIsNext = !verificationIsNext && actionStep?.key === "brand";
  const setupAction = {
    hidden: !showSetup || (!verificationIsNext && !actionStep),
    href: verificationIsNext
      ? "/verify-email"
      : actionStep
        ? setupStepHref(actionStep, { siteId, emailVerified: status.emailVerified })
        : buildDashboardPath("home", { board: siteId }),
    label: verificationIsNext ? "Confirm email" : actionStep?.action || "Continue setup",
    publicationAction: publicationIsNext,
    brandAction: brandIsNext,
  };
  const nextKey = isModerator && firstIncomplete?.key === "brand" ? firstActionableIncomplete?.key : firstIncomplete?.key;
  const setupSteps = SETUP_STEPS.map((step) => {
    const complete = Boolean(steps[step.key]);
    const ownerOnly = isModerator && step.key === "brand";
    const next = !complete && !ownerOnly && step.key === nextKey;
    const stateLabel = complete ? "Done" : ownerOnly ? "Owner action required" : next ? "Next" : "Not started";
    const stateKey = complete ? "done" : ownerOnly ? "owner-action" : next ? "next" : "not-started";
    const description = ownerOnly && !complete
      ? `${ownerName} manages the community name and public identity.`
      : step.description;
    return {
      key: step.key,
      label: step.label,
      description,
      complete,
      ownerOnly,
      next,
      stateLabel,
      stateKey,
      rowClass: `ov-setup-row${complete ? " is-done" : ""}${next ? " is-next" : ""}${ownerOnly ? " is-owner-action" : ""}`,
      href: setupStepHref(step, { siteId, emailVerified: status.emailVerified }),
      publicationAction: step.key === "publish" && !needsVerification,
      brandAction: step.key === "brand",
    };
  });

  return {
    header: {
      siteName: idle ? "Checking…" : siteName,
      initial: idle ? "Y" : [...siteName][0]?.toUpperCase() || "Y",
      logoSrc: logoSrc || null,
      operatorHidden: !isModerator,
      operatorText: isModerator ? ` · Moderator for ${ownerName}` : "",
      headSub: attention.length
        ? "Here’s what needs you."
        : liveStatus ? "Your community is running. Here’s the latest." : "Your community at a glance.",
      statusState: headline.state,
      statusLabel: headline.label,
      publicHidden: !status.live || !sourceState.SLUG,
      publicHref: sourceState.SLUG ? `/${sourceState.SLUG}` : "/",
    },
    attention: {
      hidden: attention.length === 0,
      countText: `${number(attention.length)} ${attention.length === 1 ? "item" : "items"}`,
      items: attention,
    },
    live: {
      hidden: !liveLoading && !liveError && live.items.length === 0,
      busy: liveLoading,
      summary: live.items.length
        ? `${number(live.items.length + live.more)} running right now${live.more ? ` · showing ${number(live.items.length)}` : ""}.`
        : "Engagement running on this community right now.",
      items: liveItems,
      loading: liveLoading && live.items.length === 0,
      error: live.items.length ? null : liveError,
    },
    upcoming: {
      hidden: !upcomingLoading && !upcomingError && upcoming.length === 0,
      busy: upcomingLoading,
      items: upcoming,
      loading: upcomingLoading && upcoming.length === 0,
      error: upcoming.length ? null : upcomingError,
    },
    pulse: {
      hidden: insights.status === "forbidden",
      busy: insights.status === "loading",
      rangeLabel: pulse.rangeLabel,
      status: pulseStatus,
      metrics: pulseMetricsList.map((metric) => ({
        key: metric.key,
        label: metric.label,
        value: insights.status === "ready" ? number(metric.value) : null,
      })),
      error: insights.status === "error" ? sectionError("insights", "Couldn't load the last 30 days.") : null,
    },
    recent: {
      hidden: recent.status === "forbidden",
      busy: recent.status === "loading",
      allHref: buildDashboardPath("audience.activity", { siteId }),
      events: recentEvents.map((event) => ({
        ...event,
        relative: relativeTime(event.at, inputs.now ?? 0),
        formattedAt: formatOverviewDate(event.at),
      })),
      loading: recent.status === "loading" || recent.status === "idle",
      empty: recentEmpty,
      error: recentError,
    },
    quickActions: quickActions({ siteId }),
    setup: {
      hidden: !showSetup,
      attention: pendingVerification,
      title: needsVerification && (readyToPublish || pendingVerification)
        ? "Confirm your email to go live"
        : readyToPublish ? "Your community is ready to publish" : "Setup progress",
      message: needsVerification && (readyToPublish || pendingVerification)
        ? "Confirm your email to make this community available to visitors. Your setup is saved."
        : firstIncomplete?.key === "brand" && isModerator
          ? `Ask ${ownerName} to name the community. You can complete the remaining setup in the meantime.`
          : firstIncomplete?.key === "brand"
            ? "Your community ranks the players you add and gives you one link to share."
            : firstIncomplete?.key === "players"
              ? "Add the players you want to rank."
              : firstIncomplete?.key === "publish"
                ? "The essentials are done. Publish when you’re ready."
                : "The essentials are done.",
      action: setupAction,
      countText: `${progress.completed} of ${progress.total} done`,
      steps: setupSteps,
    },
  };
}

function publish(vm, loadBundle) {
  const root = document.querySelector('[data-page="home"] #ov-app');
  if (!root) return;
  const actions = buildActions();
  if (overviewBundle) {
    overviewBundle.renderHome(root, vm, actions);
    return;
  }
  if (!overviewBundlePromise) {
    overviewBundlePromise = (loadBundle ? loadBundle() : import("../react/overview.js"))
      .then((bundle) => {
        overviewBundle = bundle;
        const latestRoot = document.querySelector('[data-page="home"] #ov-app');
        const latestViewModel = pendingViewModel;
        pendingViewModel = null;
        if (latestRoot && latestViewModel) bundle.renderHome(latestRoot, latestViewModel, buildActions());
        return bundle;
      })
      .catch((error) => {
        logError("overview/react", error);
        overviewBundlePromise = null;
        return null;
      });
  }
  pendingViewModel = vm;
}

let pendingViewModel = null;

async function saveBrandName(name) {
  try {
    const { body } = await fetchDashboardJson("/api/site", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
      body: JSON.stringify({ siteId: state.ACTIVE_SITE_ID || undefined, name }),
    });
    if (body?.ok) {
      const nameField = $("f_name");
      if (nameField) nameField.value = name;
      state.ONBOARDING = { ...(state.ONBOARDING || {}), brand: true };
      showToast("Site named.", "success");
      renderOverviewSummary();
      return { ok: true };
    }
    return { ok: false, error: body?.error || "Couldn't save the name." };
  } catch (error) {
    logError("brand-modal-save", error);
    return { ok: false, error: error?.message || "Couldn't save the name." };
  }
}

export function openBrandModal() {
  const root = document.querySelector('[data-page="home"] #ov-app');
  root?._openOverviewBrandDialog?.();
}

globalThis.addEventListener?.("pagehide", () => { unloading = true; });

async function loadHomeSection(key, siteId, token, loadBundle) {
  const spec = HOME_SECTIONS[key];
  if (!spec || !siteId) return;
  home.sections[key] = { status: "loading", data: null, error: null };
  renderOverviewSummary({ loadBundle });
  const params = new URLSearchParams({ siteId }).toString();
  try {
    const { body } = await retryTransient(
      () => fetchDashboardJson(spec.request(params), { credentials: "same-origin" }),
      {
        shouldContinue: () => !unloading && token === loadToken && home.siteId === siteId,
        onRetry: (error, attempt) => logError(`overview/${key}`, error, { attempt, willRetry: true }),
      },
    );
    if (token !== loadToken || home.siteId !== siteId) return;
    home.sections[key] = { status: "ready", data: spec.project(body), error: null };
  } catch (error) {
    if (unloading || token !== loadToken || home.siteId !== siteId) return;
    if (error?.status === 403) home.sections[key] = { status: "forbidden", data: null, error: null };
    else {
      logError(`overview/${key}`, error);
      home.sections[key] = { status: "error", data: null, error: error?.message || "" };
    }
  }
  renderOverviewSummary({ loadBundle });
}

export async function loadOverviewLiveData({ loadBundle } = {}) {
  const siteId = state.ACTIVE_SITE_ID || null;
  const token = ++loadToken;
  home = {
    siteId,
    sections: Object.fromEntries(Object.keys(HOME_SECTIONS).map((key) => [key, idleSection()])),
  };
  if (!siteId) {
    renderOverviewSummary({ loadBundle });
    if (overviewBundlePromise) await overviewBundlePromise;
    return;
  }
  await Promise.all(Object.keys(HOME_SECTIONS).map((key) => loadHomeSection(key, siteId, token, loadBundle)));
  if (overviewBundlePromise) await overviewBundlePromise;
}

export function renderOverviewSummary({ loadBundle } = {}) {
  const page = document.querySelector('[data-page="home"]');
  if (!page) return;
  const siteId = state.ACTIVE_SITE_ID || "";
  const board = (state.BOARDS || []).find((item) => item.id === siteId);
  const activeBoard = board
    ? { id: board.id, name: board.name, ownerName: board.ownerName, userRole: board.userRole }
    : null;
  const credits = state.CREDITS;
  const logo = $("logoPreview");
  publish(buildHomeViewModel({
    state: {
      ACTIVE_SITE_ID: siteId,
      SLUG: state.SLUG,
      BOARDS: activeBoard ? [activeBoard] : [],
      ME: state.ME ? { emailVerified: state.ME.emailVerified } : null,
      CREDITS: {
        usage: { pendingRedemptions: credits?.usage?.pendingRedemptions },
        channel: credits?.channel ? {
          homeAttention: credits.channel.homeAttention,
          connected: credits.channel.connected,
          canManage: credits.channel.canManage,
          detail: credits.channel.detail,
          name: credits.channel.name,
        } : null,
      },
    },
    status: boardStatus(),
    siteId,
    activeBoard,
    siteName: $("f_name")?.value.trim() || activeBoard?.name || state.SLUG || "Selected community",
    isModerator: effectiveBoardRole(board) === "moderator",
    ownerName: activeBoard?.ownerName || "the community owner",
    sections: home.sections,
    steps: computeSetupSteps(),
    idle: idleState(state),
    logoSrc: logo && !logo.hidden ? logo.src : "",
    leaderboardEndsAt: $("f_ends")?.value || null,
    now: Date.now(),
  }), loadBundle);
}
