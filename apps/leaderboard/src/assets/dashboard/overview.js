// Dashboard Home: community header, needs attention, live now, coming next,
// community pulse, recent activity, quick actions, setup progress.
import { $, esc, currentPlayers, getCsrf, logError, showToast } from "./utils.js";
import { state, boardStatus } from "./state.js";
import { renderEmpty, setMetricLoading, setMetricValue } from "./states.js";
import {
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
import { fetchDashboardJson } from "./request.js";

// Each dynamic Home section loads on its own: one failing request shows a
// compact retry in that section and leaves the rest of Home usable.
const HOME_SECTIONS = {
  activities: {
    request: (params) => `/api/activities?${params}`,
    project: (body) => ({ automation: automationHomeState(body?.automation), activities: activityHomeState(body?.activities) }),
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
let home = { siteId: null, sections: Object.fromEntries(Object.keys(HOME_SECTIONS).map((key) => [key, idleSection()])) };
let loadToken = 0;

const section = (key) => home.sections[key] || idleSection();

function formatOverviewDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const ACTIVITY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
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

const SKELETON_ROW = '<div class="ov-live-row ov-live-row--skeleton" aria-hidden="true"><div><span class="skeleton v3-skel-line"></span><span class="skeleton v3-skel-line v3-skel-line--short"></span></div></div>';

function sectionErrorHtml(key, message) {
  return `<div class="ov-section-error" role="alert"><span>${esc(message || "Couldn't load this section.")}</span><button type="button" class="btn btn--sm btn--ghost" data-home-retry="${key}">Retry</button></div>`;
}

function wireRetry(root) {
  if (!root || root._homeRetryWired) return;
  root._homeRetryWired = true;
  root.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-home-retry]");
    if (!button) return;
    event.preventDefault();
    loadHomeSection(button.dataset.homeRetry, state.ACTIVE_SITE_ID, loadToken);
  });
}

function relativeTime(iso) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
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

function wireBrandAction(link) {
  if (!link || link._brandWired) return;
  link._brandWired = true;
  link.addEventListener("click", (event) => {
    if (link.dataset.brandAction !== "true") return;
    event.preventDefault();
    openBrandModal();
  });
}

// The brand checklist step completes where it is: the name is the only field
// the launch checklist needs, so naming the site never requires a page trip.
export function openBrandModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "brandNameTitle");
  overlay.innerHTML = `<div class="modal-card" role="document">
    <h3 id="brandNameTitle">Name your site</h3>
    <p>This is the name visitors see on your public page.</p>
    <div class="field"><label for="brandNameInput">Site name</label><input id="brandNameInput" maxlength="80" autocomplete="off" placeholder="Summer Race 2026" /></div>
    <div class="modal-actions"><button class="btn btn--sm btn--ghost" data-brand="cancel" type="button">Cancel</button><button class="btn btn--sm btn--accent" data-brand="save" type="button">Save name</button></div>
    <p class="status" id="brandNameErr" role="alert" aria-live="assertive"></p>
  </div>`;
  document.body.appendChild(overlay);
  document.documentElement.classList.add("yr-modal-open");
  const release = window.YRDialog ? window.YRDialog.trap(overlay, close) : null;
  const input = overlay.querySelector("#brandNameInput");
  const err = overlay.querySelector("#brandNameErr");
  const save = overlay.querySelector('[data-brand="save"]');
  input.value = $("f_name")?.value.trim() || "";
  function close() {
    release?.();
    overlay.remove();
    document.documentElement.classList.remove("yr-modal-open");
  }
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-brand="cancel"]').addEventListener("click", close);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save.click(); } });
  save.addEventListener("click", async () => {
    const name = input.value.trim();
    if (!name) { err.textContent = "Enter a site name."; input.focus(); return; }
    err.textContent = "Saving…";
    save.disabled = true;
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
        close();
        showToast("Site named.", "success");
        renderOverviewSummary();
      } else {
        err.textContent = body?.error || "Couldn't save the name.";
        save.disabled = false;
      }
    } catch (e) {
      logError("brand-modal-save", e);
      err.textContent = e?.message || "Couldn't save the name.";
      save.disabled = false;
    }
  });
  setTimeout(() => input.focus(), 30);
}

async function loadHomeSection(key, siteId, token) {
  const spec = HOME_SECTIONS[key];
  if (!spec || !siteId) return;
  home.sections[key] = { status: "loading", data: null, error: null };
  renderOverviewSummary();
  const params = new URLSearchParams({ siteId }).toString();
  try {
    const { body } = await fetchDashboardJson(spec.request(params), { credentials: "same-origin" });
    if (token !== loadToken || home.siteId !== siteId) return;
    home.sections[key] = { status: "ready", data: spec.project(body), error: null };
  } catch (err) {
    if (token !== loadToken || home.siteId !== siteId) return;
    // A viewer without this capability simply does not get the section; it is
    // not an error worth a retry button.
    if (err?.status === 403) home.sections[key] = { status: "forbidden", data: null, error: null };
    else {
      logError(`overview/${key}`, err);
      home.sections[key] = { status: "error", data: null, error: err?.message || "" };
    }
  }
  renderOverviewSummary();
}

// Selected-site switch: drop every section from the previous site before any
// new request starts so no stale data survives the swap.
export async function loadOverviewLiveData() {
  const siteId = state.ACTIVE_SITE_ID || null;
  const token = ++loadToken;
  home = { siteId, sections: Object.fromEntries(Object.keys(HOME_SECTIONS).map((key) => [key, idleSection()])) };
  if (!siteId) {
    renderOverviewSummary();
    return;
  }
  await Promise.all(Object.keys(HOME_SECTIONS).map((key) => loadHomeSection(key, siteId, token)));
}

export function renderOverviewSummary() {
  const page = document.querySelector('[data-page="home"]');
  if (!page || !$("ovFigures")) return;
  wireRetry(page);
  const status = boardStatus();
  const steps = computeSetupSteps();
  const siteId = state.ACTIVE_SITE_ID || "";
  const activeBoard = state.BOARDS.find((board) => board.id === siteId);
  const siteName = $("f_name")?.value.trim() || activeBoard?.name || state.SLUG || "Selected community";
  const isModerator = effectiveBoardRole(activeBoard) === "moderator";
  const ownerName = activeBoard?.ownerName || "the community owner";
  const number = (value) => value == null ? "—" : Number(value).toLocaleString("en-US");

  // 1. Community header
  if ($("ovSiteName")) $("ovSiteName").textContent = siteName;
  const siteInitial = $("ovSiteInitial");
  const siteLogo = $("ovSiteLogo");
  const editorLogo = $("logoPreview");
  if (siteInitial) siteInitial.textContent = [...siteName][0]?.toUpperCase() || "Y";
  if (siteLogo) {
    const source = editorLogo && !editorLogo.hidden ? editorLogo.src : "";
    siteLogo.hidden = !source;
    if (siteInitial) siteInitial.hidden = !!source;
    if (source && siteLogo.src !== source) siteLogo.src = source;
    if (!siteLogo._fallbackWired) {
      siteLogo._fallbackWired = true;
      siteLogo.addEventListener("error", () => {
        siteLogo.hidden = true;
        if (siteInitial) siteInitial.hidden = false;
      });
    }
  }
  const operatorContext = $("ovOperatorContext");
  if (operatorContext) {
    operatorContext.hidden = !isModerator;
    operatorContext.textContent = isModerator ? ` · Moderator for ${ownerName}` : "";
  }
  const headline = communityStatus(status);
  const statusEl = $("ovStatus");
  if (statusEl) statusEl.dataset.state = headline.state;
  if ($("ovPublishedStatus")) $("ovPublishedStatus").textContent = headline.label;
  const publicLink = $("ovPublicLink");
  if (publicLink) {
    publicLink.hidden = !status.live || !state.SLUG;
    publicLink.href = state.SLUG ? `/${state.SLUG}` : "/";
  }

  // 2. Needs attention
  const activities = section("activities");
  const automation = activities.data?.automation || { upcoming: [], needsAttention: [] };
  const attention = attentionItems({
    status,
    steps,
    pendingClaims: state.CREDITS?.usage?.pendingRedemptions,
    connection: state.CREDITS?.channel || null,
    automationAttention: automation.needsAttention,
    siteId,
    siteName,
  });
  const headSub = $("ovHeadSub");
  if (headSub) headSub.textContent = attention.length ? "Here’s what needs you." : status.live ? "Your community is running. Here’s the latest." : "Your community at a glance.";
  const attentionSection = $("ovAttention");
  if (attentionSection) attentionSection.hidden = attention.length === 0;
  if ($("ovAttentionCount")) $("ovAttentionCount").textContent = `${number(attention.length)} ${attention.length === 1 ? "item" : "items"}`;
  const attentionList = $("ovAttentionList");
  if (attentionList) {
    attentionList.innerHTML = attention.map((item) => `<div class="v3-alert v3-alert--warning ov-attention-row" data-attention="${esc(item.key)}" data-scope="${esc(item.scope)}"><span><b>${esc(item.title)}</b> <span>${esc(item.why)}</span></span><a class="btn btn--sm btn--ghost" href="${esc(item.href)}">${esc(item.action)}</a></div>`).join("");
  }

  // 3. Live now
  const giveaway = section("giveaway");
  const liveLoading = activities.status === "loading" || giveaway.status === "loading";
  const liveError = activities.status === "error" ? activities.error : giveaway.status === "error" ? giveaway.error : null;
  const live = liveNowItems({
    activities: activities.data?.activities || { open: [], totalOpen: 0 },
    giveaway: giveaway.data || { active: null },
    siteId,
  });
  const liveSection = $("ovLiveNow");
  const liveList = $("ovLiveNowList");
  if (liveSection && liveList) {
    liveSection.hidden = !liveLoading && !liveError && live.items.length === 0;
    liveSection.setAttribute("aria-busy", liveLoading ? "true" : "false");
    if ($("ovLiveNowSummary")) {
      $("ovLiveNowSummary").textContent = live.items.length
        ? `${number(live.items.length + live.more)} running right now${live.more ? ` · showing ${number(live.items.length)}` : ""}.`
        : "Engagement running on this community right now.";
    }
    liveList.innerHTML = live.items.map((item) => {
      const ending = item.endsAt ? ` · Ends ${formatOverviewDate(item.endsAt)}` : "";
      return `<div class="ov-live-row" data-live="${esc(item.kind)}"><div><strong>${esc(item.name)}</strong><span>${esc(item.meta + ending)}</span></div><span class="ov-live-state">${esc(item.status)}</span><a class="btn btn--sm" href="${esc(item.href)}">${esc(item.action)}</a></div>`;
    }).join("")
      + (liveLoading && !live.items.length ? SKELETON_ROW : "")
      + (liveError && !live.items.length ? sectionErrorHtml(activities.status === "error" ? "activities" : "giveaway", "Couldn't check what’s live.") : "");
  }

  // 4. Coming next
  const upcoming = comingNextItems({
    upcoming: automation.upcoming,
    leaderboardEndsAt: $("f_ends")?.value || null,
    siteId,
  });
  const upcomingSection = $("ovComingNext");
  const upcomingList = $("ovComingNextList");
  if (upcomingSection && upcomingList) {
    const loading = activities.status === "loading";
    const error = activities.status === "error";
    upcomingSection.hidden = !loading && !error && upcoming.length === 0;
    upcomingSection.setAttribute("aria-busy", loading ? "true" : "false");
    upcomingList.innerHTML = upcoming.map((item) => `<div class="ov-live-row" data-upcoming="${esc(item.kind)}"><div><strong>${esc(item.name)}</strong><span>${esc(item.meta)}</span></div><time datetime="${esc(item.at)}">${esc(formatOverviewDate(item.at))}</time><a class="btn btn--sm" href="${esc(item.href)}">${esc(item.action)}</a></div>`).join("")
      + (loading && !upcoming.length ? SKELETON_ROW : "")
      + (error && !upcoming.length ? sectionErrorHtml("activities", "Couldn't load the schedule.") : "");
  }

  // 5. Community pulse
  const insights = section("insights");
  const pulseSection = $("ovPulse");
  const figures = $("ovFigures");
  const pulseState = $("ovPulseState");
  if (pulseSection && figures) {
    const pulse = pulseMetrics(insights.status === "ready" ? insights.data : null);
    pulseSection.hidden = insights.status === "forbidden";
    pulseSection.setAttribute("aria-busy", insights.status === "loading" ? "true" : "false");
    if ($("ovPulseRange")) $("ovPulseRange").textContent = pulse.rangeLabel;
    const placeholders = [
      { key: "newMembers", label: "New members" },
      { key: "participants", label: "Activity participants" },
      { key: "claimsCompleted", label: "Claims completed" },
    ];
    const cells = pulse.metrics.length ? pulse.metrics : placeholders;
    figures.innerHTML = cells.map((metric) => `<div class="ov-figure" data-metric="${esc(metric.key)}"><span class="ov-figure-lbl" id="ovLbl_${esc(metric.key)}">${esc(metric.label)}</span><span class="ov-figure-val" id="ovVal_${esc(metric.key)}" aria-labelledby="ovLbl_${esc(metric.key)}"></span></div>`).join("");
    for (const metric of cells) {
      const el = $(`ovVal_${metric.key}`);
      if (insights.status === "ready") setMetricValue(el, number(metric.value));
      else if (insights.status === "loading" || insights.status === "idle") setMetricLoading(el);
      else setMetricValue(el, "—");
    }
    if (pulseState) {
      const failed = insights.status === "error";
      pulseState.hidden = !failed;
      pulseState.innerHTML = failed ? sectionErrorHtml("insights", "Couldn't load the last 30 days.") : "";
    }
  }

  // 6. Recent activity
  const recent = section("recent");
  const recentSection = $("ovRecent");
  const activityList = $("ovActivityList");
  const activityEmpty = $("ovActivityEmpty");
  if (recentSection && activityList) {
    recentSection.hidden = recent.status === "forbidden";
    recentSection.setAttribute("aria-busy", recent.status === "loading" ? "true" : "false");
    if ($("ovActivityAllLink")) $("ovActivityAllLink").href = buildDashboardPath("audience.activity", { siteId });
    const events = recent.status === "ready" ? recent.data || [] : [];
    activityList.innerHTML = events.map((event) => `<div class="ov-activity-row" data-event="${esc(event.kind)}"><span class="ov-activity-icon">${ACTIVITY_ICON}</span><span class="ov-activity-copy"><b>${esc(event.title)}</b><span>${esc(event.detail || "")}</span></span><time datetime="${esc(event.at)}" title="${esc(formatOverviewDate(event.at))}">${relativeTime(event.at)}</time></div>`).join("")
      + (recent.status === "loading" || recent.status === "idle" ? SKELETON_ROW + SKELETON_ROW : "");
    if (activityEmpty) {
      if (recent.status === "error") {
        activityEmpty.hidden = false;
        activityEmpty.innerHTML = sectionErrorHtml("recent", "Couldn't load recent activity.");
      } else if (recent.status === "ready" && events.length === 0) {
        renderEmpty(activityEmpty, { kind: "empty", title: "Nothing yet", body: "New members, reward claims and Activity results will show up here.", compactHeading: true });
      } else {
        activityEmpty.hidden = true;
        activityEmpty.innerHTML = "";
      }
    }
  }

  // 7. Quick actions
  const quickList = $("ovQuickActionsList");
  if (quickList) {
    quickList.innerHTML = quickActions({ siteId }).map((action) => `<a class="ov-quick-action" data-quick="${esc(action.key)}" href="${esc(action.href)}">${esc(action.label)}</a>`).join("");
  }

  // 8. Setup progress — only while core setup is incomplete (or publish is
  // blocked on email verification).
  const progress = setupProgress(steps);
  const readyToPublish = steps.brand && steps.players;
  const pendingVerification = status.published && !status.emailVerified;
  const needsVerification = !status.emailVerified;
  const firstIncomplete = progress.next;
  const firstActionableIncomplete = SETUP_STEPS.find((step) => !steps[step.key] && !(isModerator && step.key === "brand"));
  const showSetup = !progress.done || pendingVerification;
  const setupSection = $("ovSetup");
  if (setupSection) setupSection.hidden = !showSetup;
  setupSection?.classList.toggle("is-attention", pendingVerification);
  const countEl = $("ovSetupCount");
  if (countEl) countEl.textContent = `${progress.completed} of ${progress.total} done`;
  const setupMessage = $("ovSetupMessage");
  const setupAction = $("ovSetupAction");
  if (setupMessage) {
    setupMessage.textContent = needsVerification && (readyToPublish || pendingVerification)
      ? "Confirm your email to make this community available to visitors. Your setup is saved."
      : firstIncomplete?.key === "brand" && isModerator
        ? `Ask ${ownerName} to name the community. You can complete the remaining setup in the meantime.`
        : firstIncomplete?.key === "brand"
          ? "Your community ranks the players you add and gives you one link to share."
          : firstIncomplete?.key === "players"
            ? "Add the players you want to rank."
            : firstIncomplete?.key === "publish"
              ? "The essentials are done. Publish when you’re ready."
              : "The essentials are done.";
  }
  const setupTitle = $("ovSetupTitle");
  if (setupTitle) setupTitle.textContent = needsVerification && (readyToPublish || pendingVerification)
    ? "Confirm your email to go live"
    : readyToPublish ? "Your community is ready to publish" : "Setup progress";
  if (setupAction) {
    const verificationIsNext = pendingVerification || (readyToPublish && needsVerification);
    const actionStep = isModerator && firstIncomplete?.key === "brand" ? firstActionableIncomplete : firstIncomplete;
    const publicationIsNext = !verificationIsNext && actionStep?.key === "publish";
    setupAction.hidden = !showSetup || (!verificationIsNext && !actionStep);
    setupAction.href = verificationIsNext ? "/verify-email" : actionStep ? setupStepHref(actionStep, { siteId, emailVerified: status.emailVerified }) : buildDashboardPath("home", { board: siteId });
    setupAction.textContent = verificationIsNext ? "Confirm email" : actionStep?.action || "Continue setup";
    setupAction.dataset.publicationAction = publicationIsNext ? "true" : "false";
    if (publicationIsNext) wirePublicationLink(setupAction);
    const brandIsNext = !verificationIsNext && actionStep?.key === "brand";
    setupAction.dataset.brandAction = brandIsNext ? "true" : "false";
    if (brandIsNext) wireBrandAction(setupAction);
  }
  const setupList = $("ovSetupList");
  if (setupList) {
    const nextKey = isModerator && firstIncomplete?.key === "brand" ? firstActionableIncomplete?.key : firstIncomplete?.key;
    setupList.innerHTML = SETUP_STEPS.map((step) => {
      const complete = Boolean(steps[step.key]);
      const ownerOnly = isModerator && step.key === "brand";
      const next = !complete && !ownerOnly && step.key === nextKey;
      const stateLabel = complete ? "Done" : ownerOnly ? "Owner action required" : next ? "Next" : "Not started";
      const stateKey = complete ? "done" : ownerOnly ? "owner-action" : next ? "next" : "not-started";
      const rowClass = `ov-setup-row${complete ? " is-done" : ""}${next ? " is-next" : ""}${ownerOnly ? " is-owner-action" : ""}`;
      const description = ownerOnly && !complete ? `${ownerName} manages the community name and public identity.` : step.description;
      const content = `<span class="ov-step-icon${complete ? " is-done" : ""}" aria-hidden="true">${complete ? "✓" : ""}</span><span class="ov-step-body"><b>${step.label}</b><span class="hint">${esc(description)}</span></span><span class="ov-step-status${complete ? " is-done" : ""}" aria-hidden="true">${stateLabel}</span><span class="sr-only">${stateLabel}</span>`;
      if (ownerOnly) return `<li><span class="${rowClass}" data-setup-step="${step.key}" data-setup-state="${stateKey}">${content}</span></li>`;
      if (step.key === "brand") {
        return `<li><button type="button" class="${rowClass}" data-setup-step="${step.key}" data-setup-state="${stateKey}" data-brand-action="true">${content}</button></li>`;
      }
      const href = setupStepHref(step, { siteId, emailVerified: status.emailVerified });
      const publicationAttribute = step.key === "publish" && !needsVerification ? ' data-publication-action="true"' : "";
      return `<li><a class="${rowClass}" href="${href}" data-setup-step="${step.key}" data-setup-state="${stateKey}"${publicationAttribute}>${content}</a></li>`;
    }).join("");
    setupList.querySelectorAll("[data-publication-action='true']").forEach(wirePublicationLink);
    setupList.querySelectorAll("[data-brand-action='true']").forEach((btn) => {
      if (!btn._brandWired) { btn._brandWired = true; btn.addEventListener("click", openBrandModal); }
    });
  }
}
