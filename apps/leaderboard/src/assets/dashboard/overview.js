// Overview page summary tiles / top players / setup checklist.
import { $, esc, currentPlayers } from "./utils.js";
import { state, setState, boardStatus } from "./state.js";
import { renderEmpty, setMetricLoading, setMetricUnknown, setMetricValue } from "./states.js";
import { activityEmptyAction, giveawayAction, nextStepAction, visitsMetricState } from "./overview-state.js";

// Home already owns some state in dedicated surfaces: the setup checklist
// renders brand/players/publish/verification, and the pending-orders banner
// renders reward requests. Repeating those as a "Next step" card would show
// the same instruction three times, so the card only speaks for the steps no
// other surface on the page claims.
const NEXT_STEP_OWNED_ELSEWHERE = new Set(["verifyEmail", "brand", "players", "publish", "pendingOrders"]);

const ACTIVITY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
const SETUP_STEPS = [
  { key: "brand", required: true, label: "Name your leaderboard", description: "Give your public page a clear name.", href: "/dashboard/leaderboard/setup", action: "Name leaderboard" },
  { key: "players", required: true, label: "Add players", description: "Add names and the values that decide rank.", href: "/dashboard/leaderboard/players", action: "Add players" },
  { key: "configure", required: false, label: "Customize appearance (optional)", description: "The default design is ready; personalize it whenever you want.", href: "/dashboard/leaderboard/design", action: "Customize appearance" },
  { key: "publish", required: true, label: "Publish your leaderboard", description: "Open the standings to visitors and copy the live link.", href: "#publish", action: "Publish leaderboard" },
];

function isBoardSetup() {
  const steps = computeSetupSteps();
  return SETUP_STEPS.every(({ key, required }) => !required || steps[key]);
}

function computeSetupSteps() {
  const o = state.ONBOARDING || {};
  const name = $("f_name")?.value.trim();
  const brand = Boolean(o.brand || name);
  const players = !state.SAMPLE_PLAYERS && (currentPlayers().length > 0 || o.players);
  const kick = Boolean(state.CREDITS?.channel?.externalId);
  const configure = true;
  const status = boardStatus();
  const publish = status.published;
  return { brand, players, kick, configure, publish };
}

function wirePublicationLink(link) {
  if (!link || link._publicationWired) return;
  link._publicationWired = true;
  link.addEventListener("click", (event) => {
    if (link.dataset.publicationAction !== "true") return;
    event.preventDefault();
    $("publishAction")?.click();
  });
}

function siteScopedPath(path) {
  if (!state.ACTIVE_SITE_ID) return path;
  const url = new URL(path, location.origin);
  url.searchParams.set("siteId", state.ACTIVE_SITE_ID);
  return `${url.pathname}${url.search}${url.hash}`;
}

async function fetchOverviewJson(path) {
  const response = await fetch(siteScopedPath(path), { credentials: "same-origin" });
  const data = await response.json();
  if (!response.ok || !data?.ok) throw new Error(data?.error || `overview request failed (${response.status})`);
  return data;
}

export async function loadOverviewLiveData() {
  const [giveawayResult, creditsResult] = await Promise.allSettled([
    Promise.all([
      fetchOverviewJson("/api/events/raffles"),
      fetchOverviewJson("/api/events/drops"),
      fetchOverviewJson("/api/predictions"),
    ]),
    fetchOverviewJson("/api/credits/analytics"),
  ]);
  if (giveawayResult.status === "fulfilled") {
    const [raffles, drops, predictions] = giveawayResult.value;
    setState({
      GIVEAWAYS: {
        raffles: raffles.raffles || [],
        drops: drops.drops || [],
        predictions: predictions.predictions || [],
      },
      GIVEAWAYS_STATUS: "ready",
    });
  } else {
    setState({ GIVEAWAYS_STATUS: "error" });
  }
  if (creditsResult.status === "fulfilled") {
    setState({ CREDITS_ANALYTICS: creditsResult.value, CREDITS_ANALYTICS_STATUS: "ready" });
  } else {
    setState({ CREDITS_ANALYTICS_STATUS: "error" });
  }
  renderOverviewSummary();
}

export function renderOverviewSummary() {
    if (!$("ovActiveBento")) return;
    const players = currentPlayers();
    const status = boardStatus();
    const steps = computeSetupSteps();
    const done = isBoardSetup();
    const readyToPublish = steps.brand && steps.players;
    const firstIncomplete = SETUP_STEPS.find((step) => step.required && !steps[step.key]);
    const pendingVerification = status.published && !status.emailVerified;
    const needsVerification = !status.emailVerified;
    const headSub = $("ovHeadSub");
    if (headSub) headSub.textContent = status.live ? "Your site is live. Here’s how it’s doing." : pendingVerification ? "Confirm your email so people can open the published site." : readyToPublish && needsVerification ? "Your essentials are ready. Confirm your email before publishing." : readyToPublish ? "Your essentials are ready. Publish when you want to open the site." : "See the next required step and keep moving toward launch.";
    const onboardBento = $("ovOnboardingBento");
    const activeBento = $("ovActiveBento");
    const commandGrid = $("ovCommandGrid");
    const showSetup = !done || pendingVerification;
    const firstRun = $("ovFirstRun");
    if (firstRun) firstRun.hidden = status.published || players.length > 0;
    if (onboardBento) onboardBento.hidden = !showSetup;
    const setupCard = onboardBento?.querySelector(".ov-setup");
    setupCard?.classList.toggle("is-attention", pendingVerification);
    if (activeBento) activeBento.hidden = false;
    if (commandGrid) commandGrid.hidden = !showSetup;
    commandGrid?.classList.toggle("is-setup-complete", done);
    const siteState = $("ovSiteState");
    if (siteState) siteState.textContent = pendingVerification ? "Confirm your email before launch" : "Finish setup";
    // Setup progress
    const stepOrder = SETUP_STEPS.map(({ key }) => key);
    const completed = stepOrder.filter((key) => steps[key]).length;
    const countEl = $("ovSetupCount");
    const fillEl = $("ovSetupFill");
    const barEl = $("ovSetupBar");
    if (countEl) countEl.textContent = `${completed} of ${stepOrder.length} done`;
    if (fillEl) fillEl.style.transform = `scaleX(${completed / stepOrder.length})`;
    if (barEl) barEl.setAttribute("aria-valuenow", String(completed));
    const setupMessage = $("ovSetupMessage");
    const setupAction = $("ovSetupAction");
    if (setupMessage) {
      const setupCopy = pendingVerification
        ? "Your site is published, but email confirmation is still required."
        : firstIncomplete?.key === "brand"
        ? "Name your leaderboard to get started."
        : firstIncomplete?.key === "players"
          ? "Add players to your leaderboard."
          : firstIncomplete?.key === "publish"
              ? "Your essentials are ready. Publish when you’re ready."
              : "Your essentials are ready.";
      setupMessage.textContent = setupCopy;
    }
    if (setupAction) {
      const verificationIsNext = pendingVerification || (readyToPublish && needsVerification);
      const publicationIsNext = !verificationIsNext && firstIncomplete?.key === "publish";
      setupAction.href = verificationIsNext ? "/verify-email" : publicationIsNext ? "#publish" : firstIncomplete?.href || "/dashboard/leaderboard/setup";
      setupAction.textContent = verificationIsNext ? "Confirm email" : firstIncomplete?.action || "Edit site";
      setupAction.dataset.publicationAction = publicationIsNext ? "true" : "false";
      if (publicationIsNext) wirePublicationLink(setupAction);
    }
    const setupList = $("ovSetupList");
    if (setupList) {
      const nextKey = firstIncomplete?.key;
      setupList.innerHTML = SETUP_STEPS.map((step) => {
        const complete = Boolean(steps[step.key]);
        const next = !complete && step.key === nextKey;
        const stateLabel = complete ? "Done" : next ? "Next" : "Not started";
        const rowClass = `ov-setup-row${complete ? " is-done" : ""}${next ? " is-next" : ""}`;
        const href = step.key === "publish" ? "#publish" : step.href;
        const publicationAttribute = step.key === "publish" ? ' data-publication-action="true"' : "";
        return `<li><a class="${rowClass}" href="${href}" data-setup-step="${step.key}" data-setup-state="${complete ? "done" : next ? "next" : "not-started"}"${publicationAttribute}><span class="ov-step-icon${complete ? " is-done" : ""}" aria-hidden="true">${complete ? "✓" : ""}</span><span class="ov-step-body"><b>${step.label}</b><span class="hint">${step.description}</span></span><span class="ov-step-status${complete ? " is-done" : ""}" aria-hidden="true">${stateLabel}</span><span class="sr-only">${stateLabel}</span></a></li>`;
      }).join("");
      setupList.querySelectorAll("[data-publication-action='true']").forEach(wirePublicationLink);
    }
    const statsReady = state.STATS_STATUS === "ready" && state.STATS;
    const days = statsReady ? state.STATS?.days || [] : [];
    const sum = (field, list = days) => list.reduce((total, day) => total + Number(day[field] || 0), 0);
    const number = (value) => value == null ? "—" : Number(value).toLocaleString("en-US");
    const delta = (field) => {
      const previous = sum(field, days.slice(-14, -7));
      const recent = sum(field, days.slice(-7));
      return previous ? ((recent - previous) / previous) * 100 : (recent ? 100 : 0);
    };
    setMetricValue($("ovPlayersCount"), number(players.length));
    const visits = visitsMetricState({
      published: status.published,
      statsStatus: state.STATS_STATUS,
      stats: state.STATS,
    });
    if (visits.kind === "loading") {
      setMetricLoading($("ovViews14"));
    } else {
      setMetricValue($("ovViews14"), typeof visits.value === "number" ? number(visits.value) : visits.value);
    }
    const giveawayActionEl = $("ovGiveawayAction");
    let activeGiveawayCount = null;
    if (state.GIVEAWAYS_STATUS === "loading") {
      setMetricLoading($("ovActiveGiveaway"));
      if (giveawayActionEl) giveawayActionEl.hidden = true;
    } else if (state.GIVEAWAYS_STATUS === "ready") {
      const activeGiveaways = [
        ...(state.GIVEAWAYS?.raffles || []).filter((item) => item.status === "active"),
        ...(state.GIVEAWAYS?.drops || []).filter((item) => item.status === "active"),
        ...(state.GIVEAWAYS?.predictions || []).filter((item) => item.status === "open" || item.status === "locked"),
      ];
      activeGiveawayCount = activeGiveaways.length;
      setMetricValue($("ovActiveGiveaway"), number(activeGiveaways.length));
      const action = giveawayAction(activeGiveaways.length);
      if (giveawayActionEl) {
        giveawayActionEl.hidden = false;
        giveawayActionEl.href = action.href;
        giveawayActionEl.textContent = action.label;
      }
    } else {
      setMetricUnknown($("ovActiveGiveaway"));
      if (giveawayActionEl) giveawayActionEl.hidden = true;
    }
    const creditsEnabled = state.CREDITS_PRODUCT_ENABLED === true;
    const creditsCard = $("ovCreditsCard");
    const pendingOrdersCard = $("ovPendingOrdersCard");
    const pendingOrders = Number(state.CREDITS?.usage?.pendingRedemptions || 0);
    const publicAction = $("ovPublicSiteAction");
    if (publicAction) {
      publicAction.href = state.SLUG ? `${location.origin}/${encodeURIComponent(state.SLUG)}` : "#";
      publicAction.hidden = !state.SLUG;
    }
    const pendingAlert = $("ovPendingOrdersAlert");
    if (pendingAlert) pendingAlert.hidden = pendingOrders <= 0;
    const pendingAlertCount = $("ovPendingOrdersAlertCount");
    if (pendingAlertCount) pendingAlertCount.textContent = number(pendingOrders);
    const pendingAlertLabel = $("ovPendingOrdersAlertLabel");
    if (pendingAlertLabel) pendingAlertLabel.textContent = pendingOrders === 1 ? "pending order needs review." : "pending orders need review.";
    const kpiRow = $("ovKpiRow");
    if (creditsCard) creditsCard.hidden = !creditsEnabled;
    if (pendingOrdersCard) pendingOrdersCard.hidden = pendingOrders <= 0;
    setMetricValue($("ovPendingOrders"), number(pendingOrders));
    for (const id of ["ovPendingOrdersAction", "ovPendingOrdersAlertAction"]) {
      const pendingOrdersAction = $(id);
      if (pendingOrdersAction) pendingOrdersAction.textContent = pendingOrders === 1 ? "Review order" : "Review orders";
    }
    kpiRow?.classList.toggle("has-credits", creditsEnabled);
    if (state.CREDITS_ANALYTICS_STATUS === "loading" && creditsEnabled) {
      setMetricLoading($("ovCreditsUsed"));
    } else if (state.CREDITS_ANALYTICS_STATUS === "ready" && creditsEnabled) {
      setMetricValue($("ovCreditsUsed"), number(state.CREDITS_ANALYTICS?.summary?.allTimeSpent));
    } else if (creditsEnabled) {
      setMetricUnknown($("ovCreditsUsed"));
    }
    const deltaMarkup = (value, previous, recent) => previous === 0 && recent === 0 ? "" : previous === 0 ? `<span class="v3-delta" title="vs previous 7 days">new</span>` : `<span class="v3-delta${value < 0 ? " v3-delta--down" : ""}" title="vs previous 7 days">${value >= 0 ? "+" : ""}${value.toFixed(1)}%</span>`;
    const viewPrevious = sum("views", days.slice(0, 7));
    const viewRecent = sum("views", days.slice(-7));
    $("ovViewsDelta").innerHTML = deltaMarkup(delta("views"), viewPrevious, viewRecent);
    const relative = (iso) => {
      const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
      return minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
    };
    const activity = [
      ...(state.CREDITS?.redemptions || []).map((item) => ({ at: item.created_at, title: item.kick_username || "Viewer", sub: `${item.item_name || "Shop item"} ordered` })),
      ...(state.CREDITS?.viewers || []).map((item) => ({ at: item.created_at, title: item.kick_username || "Viewer", sub: "Joined via Kick sign-in" })),
      ...(state.PUBLISHED_AT ? [{ at: state.PUBLISHED_AT, title: "YourRank", sub: "Site published" }] : []),
      ...(state.SITE_UPDATED_AT ? [{ at: state.SITE_UPDATED_AT, title: "YourRank", sub: "Site updated" }] : []),
    ].filter((item) => item.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 5);
    $("ovActivityList").innerHTML = activity.map((item) => `<div class="ov-activity-row"><span class="ov-activity-icon">${ACTIVITY_ICON}</span><span class="ov-activity-copy"><b>${esc(item.title)}</b><span>${esc(item.sub)}</span></span><time>${relative(item.at)}</time></div>`).join("");
    if (activity.length) $("ovActivityEmpty").hidden = true;
    else renderEmpty($("ovActivityEmpty"), { kind: "empty", title: "No activity yet", body: "Visits, updates and reward requests will appear here.", compactHeading: true, actions: [activityEmptyAction(status.published)] });
    const sampleNotice = state.SAMPLE_PLAYERS
      ? `<div class="v3-alert v3-alert--warning ov-sample-players" role="status"><strong>Sample players are shown.</strong><span>Replace or clear them before publishing your real roster.</span><a class="btn btn--sm btn--ghost" href="/dashboard/leaderboard/players">Manage players</a></div>`
      : "";
    const rankBy = state.RANK_BY === "score" ? "score" : "wagered";
    const top = [...players].sort((a, b) => Number(b[rankBy] || 0) - Number(a[rankBy] || 0) || String(a.name).localeCompare(String(b.name))).slice(0, 5);
    const topPlayers = $("ovTopPlayers");
    if (topPlayers) topPlayers.innerHTML = sampleNotice + top.map((player, i) => `
      <div class="ov-player-row" data-name="${esc(player.name)}">
        <span class="ov-player-rank">#${i + 1}</span>
        <b class="ov-player-name" title="${esc(player.name)}">${esc(player.name)}</b>
        <span class="ov-player-wager">${rankBy === "score" ? Number(player.score || 0).toLocaleString("en-US") + " pts" : "$" + Number(player.wagered || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </div>
    `).join("");

    if (top.length) $("ov_topEmpty").hidden = true;
    else renderEmpty($("ov_topEmpty"), { kind: "empty", title: "No players yet", body: "Add the first player to start your leaderboard.", compactHeading: true, actions: [{ label: "Add players", href: "/dashboard/leaderboard/players" }] });
    $("ovPublishedStatus").textContent = status.live ? "Live" : status.published ? "Verification needed" : "Not live";

    // Contextual next step. Rendered last so it can read the activity and
    // giveaway state computed above rather than re-deriving it.
    const nextStepEl = $("ovNextStep");
    if (nextStepEl) {
      const next = nextStepAction({
        status,
        steps,
        pendingOrders,
        creditsEnabled,
        creditsStatus: state.CREDITS_STATUS,
        creditsConnected: Boolean(state.CREDITS?.channel?.externalId),
        rewardMappings: state.CREDITS?.usage?.rewardMappings ?? null,
        giveawayStatus: state.GIVEAWAYS_STATUS,
        activeGiveaways: activeGiveawayCount,
        hasActivity: activity.length > 0,
        visits: typeof visits.value === "number" ? visits.value : null,
      });
      const show = Boolean(next) && !NEXT_STEP_OWNED_ELSEWHERE.has(next.key);
      nextStepEl.hidden = !show;
      if (show) {
        $("ovNextStepTitle").textContent = next.title;
        $("ovNextStepBody").textContent = next.body;
        const nextAction = $("ovNextStepAction");
        if (nextAction) {
          nextAction.href = next.href;
          nextAction.textContent = next.label;
          nextAction.dataset.publicationAction = next.publicationAction ? "true" : "false";
          if (next.publicationAction) wirePublicationLink(nextAction);
        }
      }
    }
  }
