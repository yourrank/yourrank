// Overview page summary tiles / top players / setup checklist.
import { $, esc, currentPlayers } from "./utils.js";
import { state, setState, boardStatus } from "./state.js";
import { renderEmpty, setMetricLoading, setMetricUnknown, setMetricValue } from "./states.js";
import { nextStepAction, visitsMetricState } from "./overview-state.js";

// Home already owns some state in dedicated surfaces: the setup checklist
// renders brand/players/publish/verification, and the pending-orders banner
// renders orders. Repeating those as a "Next step" card would show
// the same instruction three times, so the card only speaks for the steps no
// other surface on the page claims.
const NEXT_STEP_OWNED_ELSEWHERE = new Set(["verifyEmail", "brand", "players", "publish", "pendingOrders"]);

const ACTIVITY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
const SETUP_STEPS = [
  { key: "brand", required: true, label: "Name your site", description: "Give your public page a clear name.", href: "/dashboard/leaderboard/setup", action: "Name your site" },
  { key: "players", required: true, label: "Add players", description: "Add the names and scores you want to rank.", href: "/dashboard/leaderboard/players", action: "Add players" },
  { key: "publish", required: true, label: "Publish your site", description: "Open the standings to visitors and get your live link.", href: "#publish", action: "Publish site" },
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
  try {
    const [raffles, drops, predictions] = await Promise.all([
      fetchOverviewJson("/api/events/raffles"),
      fetchOverviewJson("/api/events/drops"),
      fetchOverviewJson("/api/predictions"),
    ]);
    setState({
      GIVEAWAYS: {
        raffles: raffles.raffles || [],
        drops: drops.drops || [],
        predictions: predictions.predictions || [],
      },
      GIVEAWAYS_STATUS: "ready",
    });
  } catch {
    setState({ GIVEAWAYS_STATUS: "error" });
  }
  renderOverviewSummary();
}

export function renderOverviewSummary() {
  if (!$("ovFigures")) return;
  const players = currentPlayers();
  const status = boardStatus();
  const steps = computeSetupSteps();
  const activeBoard = state.BOARDS.find((board) => board.id === state.ACTIVE_SITE_ID);
  const siteName = $("f_name")?.value.trim() || activeBoard?.name || state.SLUG || "Selected site";
  if ($("ovSiteName")) $("ovSiteName").textContent = siteName;
  const done = isBoardSetup();
  const readyToPublish = steps.brand && steps.players;
  const firstIncomplete = SETUP_STEPS.find((step) => step.required && !steps[step.key]);
  const pendingVerification = status.published && !status.emailVerified;
  const needsVerification = !status.emailVerified;
  const headSub = $("ovHeadSub");
  if (headSub) headSub.textContent = pendingVerification ? "Confirm your email so visitors can open this site." : readyToPublish && needsVerification ? "Confirm your email, then publish this site." : readyToPublish && !status.published ? "Publish when you want visitors to see the standings." : status.live ? "Nothing needs your attention right now." : "Finish the steps below to open this site.";
  const showSetup = !done || pendingVerification;
  const setupSection = $("ovSetup");
  if (setupSection) setupSection.hidden = !showSetup;
  setupSection?.classList.toggle("is-attention", pendingVerification);
  // The site state is a fact, so it is stated once, next to the page title.
  const statusEl = $("ovStatus");
  if (statusEl) statusEl.dataset.state = status.live ? "live" : status.published ? "attention" : "draft";
  const stepOrder = SETUP_STEPS.map(({ key }) => key);
  const completed = stepOrder.filter((key) => steps[key]).length;
  const countEl = $("ovSetupCount");
  if (countEl) countEl.textContent = `${completed} of ${stepOrder.length} done`;
  const setupMessage = $("ovSetupMessage");
  const setupAction = $("ovSetupAction");
  if (setupMessage) {
    setupMessage.textContent = pendingVerification
      ? "Your site is published, but email confirmation is still required."
      : firstIncomplete?.key === "brand"
        ? "Your site ranks the players you add and gives you one link to share."
        : firstIncomplete?.key === "players"
          ? "Add the players you want to rank."
          : firstIncomplete?.key === "publish"
            ? "The essentials are done. Publish when you’re ready."
            : "The essentials are done.";
  }
  // One primary action: the next launch step while setup is open, the public
  // site once there is nothing left to do.
  if (setupAction) {
    const verificationIsNext = pendingVerification || (readyToPublish && needsVerification);
    const publicationIsNext = !verificationIsNext && firstIncomplete?.key === "publish";
    setupAction.hidden = !showSetup;
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
  const number = (value) => value == null ? "—" : Number(value).toLocaleString("en-US");
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
  let activeGiveawayCount = null;
  if (state.GIVEAWAYS_STATUS === "loading") {
    setMetricLoading($("ovActiveGiveaway"));
  } else if (state.GIVEAWAYS_STATUS === "ready") {
    const activeGiveaways = [
      ...(state.GIVEAWAYS?.raffles || []).filter((item) => item.status === "active"),
      ...(state.GIVEAWAYS?.drops || []).filter((item) => item.status === "active"),
      ...(state.GIVEAWAYS?.predictions || []).filter((item) => item.status === "open" || item.status === "locked"),
    ];
    activeGiveawayCount = activeGiveaways.length;
    setMetricValue($("ovActiveGiveaway"), number(activeGiveaways.length));
  } else {
    setMetricUnknown($("ovActiveGiveaway"));
  }
  const creditsEnabled = state.CREDITS_PRODUCT_ENABLED === true;
  const pendingOrders = Number(state.CREDITS?.usage?.pendingRedemptions || 0);
  const pendingAlert = $("ovPendingOrdersAlert");
  if (pendingAlert) pendingAlert.hidden = pendingOrders <= 0;
  const pendingAlertCount = $("ovPendingOrdersAlertCount");
  if (pendingAlertCount) pendingAlertCount.textContent = number(pendingOrders);
  const pendingAlertLabel = $("ovPendingOrdersAlertLabel");
  if (pendingAlertLabel) pendingAlertLabel.textContent = pendingOrders === 1 ? "pending claim needs review." : "pending claims need review.";
  const pendingOrdersAction = $("ovPendingOrdersAlertAction");
  if (pendingOrdersAction) pendingOrdersAction.textContent = pendingOrders === 1 ? "Review claim" : "Review claims";
  const relative = (iso) => {
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    return minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
  };
  const activity = [
    ...(state.CREDITS?.redemptions || []).map((item) => ({ at: item.created_at, title: item.kick_username || "Member", sub: `${item.item_name || "Shop item"} claimed` })),
    ...(state.CREDITS?.viewers || []).map((item) => ({ at: item.created_at, title: item.kick_username || "Member", sub: "Joined via Kick sign-in" })),
    ...(state.PUBLISHED_AT ? [{ at: state.PUBLISHED_AT, title: "YourRank", sub: "Site published" }] : []),
    ...(state.SITE_UPDATED_AT ? [{ at: state.SITE_UPDATED_AT, title: "YourRank", sub: "Site updated" }] : []),
  ].filter((item) => item.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 5);
  $("ovActivityList").innerHTML = activity.map((item) => `<div class="ov-activity-row"><span class="ov-activity-icon">${ACTIVITY_ICON}</span><span class="ov-activity-copy"><b>${esc(item.title)}</b><span>${esc(item.sub)}</span></span><time>${relative(item.at)}</time></div>`).join("");
  if (activity.length) $("ovActivityEmpty").hidden = true;
  else renderEmpty($("ovActivityEmpty"), { kind: "empty", title: "No activity yet", body: "Visits, updates and reward claims will appear here.", compactHeading: true });
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
  else renderEmpty($("ov_topEmpty"), { kind: "empty", title: "No players yet", body: "Add players from the setup checklist above.", compactHeading: true });
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
      shopItems: state.CREDITS?.usage?.shopItems ?? null,
      giveawayStatus: state.GIVEAWAYS_STATUS,
      activeGiveaways: activeGiveawayCount,
      hasActivity: activity.length > 0,
      visits: typeof visits.value === "number" ? visits.value : null,
    });
    // A healthy live site already has one clear action in the page head. Keep
    // optional product suggestions off Home so "Nothing needs attention" is
    // not immediately contradicted by another prominent instruction.
    const show = Boolean(next) && !status.live && !NEXT_STEP_OWNED_ELSEWHERE.has(next.key);
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
