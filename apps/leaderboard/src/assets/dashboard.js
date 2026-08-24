// Dashboard entry point. Coordinates data loading and initial render across modules.
import { $, esc, fromLocalInput, getViewerTimeZone, logError, timeZoneLabel, toLocalInput } from "./dashboard/utils.js";
import { markDirty, setState, state, subscribe } from "./dashboard/state.js";
import { currentRoute, navTo, registerSectionMounter, setupShell } from "./dashboard/shell.js";
import { renderBoardSwitcher, renderBoardSelect, renderBoardsPage } from "./dashboard/boards.js";
import { clearSession } from "./dashboard/session.js";
import { renderPlayers } from "./dashboard/players.js";
import { fitDesignPreview, loadCreditsStatus, loadStats, refreshDesignPreview, renderArchives, renderBranding, renderDomain, renderDomainStatus, renderBoardStatus, renderEditorTimestamps, renderEmbedShare, renderLegal, renderNotifications, renderPrizes, renderSections, renderSocials, wirePublishAction } from "./dashboard/site.js";
import { loadOverviewLiveData, renderOverviewSummary } from "./dashboard/overview.js";
import { initPerformance } from "./dashboard/performance.js";
import { setupSettingsScreen } from "./dashboard/account.js";
import { initGames } from "./dashboard/games.js";
import { updateProfileMenu } from "./dashboard/profile-menu.js";
import {
  DashboardRequestError,
  fetchDashboardJson,
  loginRedirectPath,
} from "./dashboard/request.js";
import "./dashboard/help-drawer.js";
import "./dashboard/command-palette.js";

// AUDIT-B4: signing out in one tab signs out the rest. Logout handlers stamp
// localStorage; the storage event fires only in *other* tabs, which then
// leave the dashboard instead of sitting on a stale authenticated view.
window.addEventListener("storage", (event) => {
  if (event.key === "yr:logout") { clearSession(); location.href = loginRedirectPath(location); }
});

// Mark that the persistent SPA shell is active. The dynamic-section boot
// modules (credits.js, giveaways.js, account.js) check this flag to skip
// their auto-init when imported as fragments — the shell calls enter()
// explicitly instead. On a standalone document load (direct URL / refresh)
// this flag is absent, so auto-init runs normally.
window.__yrSpaShell = true;

const LOADING_MESSAGES = [
  "Loading your workspace…",
  "Preparing rank insights…",
  "Setting up your dashboard…",
];
let loadingMessageTimer;

function startLoadingCopy() {
  clearInterval(loadingMessageTimer);
  let index = 0;
  const label = $("loadingStatus");
  if (!label) return;
  label.textContent = LOADING_MESSAGES[index];
  loadingMessageTimer = setInterval(() => {
    index = (index + 1) % LOADING_MESSAGES.length;
    label.textContent = LOADING_MESSAGES[index];
  }, 1200);
}

function stopLoadingCopy() {
  clearInterval(loadingMessageTimer);
  loadingMessageTimer = undefined;
}

let initialLoadingMarkup = "";

function renderDashboardLoadState(mode, {
  title = "Couldn't load your dashboard.",
  detail = "The dashboard service returned an unexpected response.",
} = {}) {
  const loading = $("loading");
  if (!loading) return;
  if (!initialLoadingMarkup) initialLoadingMarkup = loading.innerHTML;
  if (mode === "loader") {
    loading.classList.remove("is-error");
    loading.setAttribute("aria-busy", "true");
    loading.hidden = false;
    loading.innerHTML = initialLoadingMarkup || '<span class="sr-only">Loading your dashboard…</span><p id="loadingStatus">Loading your workspace…</p>';
    return;
  }
  stopLoadingCopy();
  loading.classList.add("is-error");
  loading.hidden = false;
  loading.setAttribute("aria-busy", "false");
  loading.innerHTML = `<div class="error-state" role="alert"><span class="error-icon" aria-hidden="true">!</span><p>${esc(title)}</p><p class="hint">${esc(detail)}</p><button class="btn btn--sm" id="retryBtn" type="button">Retry</button><a class="btn btn--sm btn--ghost" href="/dashboard">Open dashboard</a></div>`;
  $("retryBtn")?.addEventListener("click", () => init());
}

async function init() {
  renderDashboardLoadState("loader");
  startLoadingCopy();
  let me;
  try {
    ({ body: me } = await fetchDashboardJson("/api/auth/me", { credentials: "same-origin" }));
    if (!me?.ok || !me.user) {
      throw new DashboardRequestError("The authentication response was invalid.", { code: "INVALID_RESPONSE" });
    }
  } catch (err) {
    if (err?.code === "AUTH") {
      location.href = loginRedirectPath(location);
      return;
    }
    logError("auth/me", err);
    renderDashboardLoadState("error", {
      title: "Couldn't start your dashboard.",
      detail: err?.message || "Network error while checking your session.",
    });
    window.__yrBoot?.signal();
    return;
  }
  state.ME = me.user;
  const emailEl = $("userEmail"); if (emailEl) emailEl.textContent = state.ME.email;
  updateProfileMenu(state.ME);

  // Each route serves only its own sections now, so a screen's setup only runs
  // when that screen is in the document.
  const hasSection = (name) => !!document.querySelector(`section[data-page="${name}"]`);
  const hasEditor = hasSection("board");
  const hasBoardSettings = hasSection("site");

  const urlParams = new URLSearchParams(location.search);
  // Plan and billing live in the account settings document; a `?plan=` on the
  // dashboard is an old checkout link.
  const planParam = urlParams.get("plan");
  if (planParam) {
    location.href = planParam.toLowerCase() === "agency"
      ? "/help/support?area=billing"
      : `/dashboard/settings/billing?plan=${encodeURIComponent(planParam)}`;
    return;
  }
  const requestedSiteId = urlParams.get("board") || null;
  const apiUrl = requestedSiteId ? `/api/site?siteId=${encodeURIComponent(requestedSiteId)}` : "/api/site";
  const renderSiteLoadError = (message) => {
    const detail = message || "The board service returned an unexpected response.";
    renderDashboardLoadState("error", { title: "Couldn't load your board.", detail });
    const status = $("status");
    if (status) {
      status.textContent = `Couldn't load your board: ${detail}`;
      status.setAttribute("role", "alert");
      status.setAttribute("aria-live", "assertive");
      status.hidden = false;
    }
  };
  let p;
  try {
    ({ body: p } = await fetchDashboardJson(apiUrl, { credentials: "same-origin" }));
    if (!p?.ok) throw new DashboardRequestError(p?.error || "The board service returned an unexpected response.", { code: "REQUEST_FAILED" });
  } catch (err) {
    logError("site", err);
    if (state.ME.isAdmin && (err?.status === 404 || err?.message?.includes("HTTP 404"))) { location.href = "/admin"; return; }
    renderSiteLoadError(err?.message || "Network error while loading the board.");
    window.__yrBoot?.signal();
    return;
  }
  state.SLUG = p.slug;
  state.ACTIVE_SITE_ID = p.siteId || null;
  state.BOARDS = p.boards || [];
  state.SITE_UPDATED_AT = p.updatedAt || null;
  state.PUBLISHED_AT = p.publishedAt || null;
  state.PUBLISHED = !!p.published;
  state.IS_DRAFT = !!p.isDraft;
  state.RANK_BY = p.data?.rankBy === "score" ? "score" : "wagered";
  state.ONBOARDING = p.onboarding || {};
  state.SAMPLE_PLAYERS = Boolean(p.data?.samplePlayers);

  if (hasEditor) renderEditorTimestamps();
  renderBoardSwitcher();
  renderBoardSelect();
  if (hasSection("boards")) renderBoardsPage();
  const d = p.data || {};
  const b = d.brand || {};
  state.EXTRA = { chips: d.partner?.chips, whyStats: d.whyStats, rules: d.rules, socials: p.socials || d.socials || [], sections: d.sections, siteSections: d.siteSections || {}, playerFields: d.playerFields || {}, text: (d.branding && d.branding.text) || {}, legal: d.legal || {} };
  state.CURRENT_BRANDING = d.branding || state.CURRENT_BRANDING;
  state.PLAYERS = Array.isArray(d.players) ? d.players : [];
  state.SAVED_PLAYERS = state.PLAYERS.map((player) => ({ ...player }));
  document.querySelectorAll("a[href]").forEach((link) => {
    if (!state.ACTIVE_SITE_ID) return;
    const target = new URL(link.getAttribute("href"), location.origin);
    const creditsPath = target.pathname.startsWith("/dashboard/rewards/") || target.pathname === "/dashboard/site/connections";
    const sitePath = target.pathname === "/dashboard" || target.pathname === "/dashboard/leaderboards" || target.pathname === "/dashboard/leaderboard" || target.pathname === "/dashboard/games" || target.pathname === "/dashboard/site" || target.pathname.startsWith("/dashboard/leaderboard/") || target.pathname.startsWith("/dashboard/analytics/");
    if (creditsPath) {
      target.searchParams.set("siteId", state.ACTIVE_SITE_ID);
    } else if (sitePath) {
      target.searchParams.set("board", state.ACTIVE_SITE_ID);
    } else {
      return;
    }
    link.href = `${target.pathname}${target.search}${target.hash}`;
  });
  if (hasEditor) {
    $("f_name").value = b.name || "";
    $("f_tagline").value = b.tagline || "";
    $("f_casino").value = b.casino || "";
    $("f_code").value = b.code || "";
    $("f_cta").value = b.ctaUrl || "";
    $("f_pool").value = b.prizePool || "";
    $("f_period").value = b.period || "Monthly";
    $("f_rank_by").value = state.RANK_BY;
    if ($("playerSort")) $("playerSort").value = state.RANK_BY;
    $("f_rank_by").addEventListener("change", () => {
      setState({ RANK_BY: $("f_rank_by").value === "score" ? "score" : "wagered" });
      if ($("playerSort")) {
        $("playerSort").value = state.RANK_BY;
        $("playerSort").dispatchEvent(new Event("change"));
      }
    });
    $("f_starts").value = toLocalInput(d.startsAt);
    $("f_ends").value = toLocalInput(d.endsAt);
    const renderScheduleHints = () => {
      const zone = getViewerTimeZone();
      for (const [inputId, hintId, prefix] of [
        ["f_starts", "f_starts_hint", "Optional start time"],
        ["f_ends", "f_ends_hint", "Final standings begin and automated score updates stop"],
      ]) {
        const input = $(inputId);
        const hint = $(hintId);
        if (!hint) continue;
        const instant = input?.value ? fromLocalInput(input.value, zone) : new Date().toISOString();
        const label = zone ? timeZoneLabel(instant, zone) : "your browser's timezone";
        hint.textContent = `${prefix}, shown in ${label}.`;
      }
    };
    renderScheduleHints();
    $("f_starts")?.addEventListener("change", renderScheduleHints);
    $("f_ends")?.addEventListener("change", renderScheduleHints);
    $("f_blurb").value = d.partner?.blurb || "";
    renderPlayers(d.players || [], { restoreDraft: true });
    renderBranding(d.branding || {});
    renderPrizes(d.prizes || d.branding?.prizes || {});
    renderArchives(p.archives || []);
    renderSocials();
    renderSections();
    renderEmbedShare();
    const iframe = $("designPreview");
    if (iframe) iframe.addEventListener("load", fitDesignPreview);
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fitDesignPreview, 150);
    });
    const arToggle = $("f_auto_reset");
    const arClear = $("f_auto_reset_clear");
    if (arToggle) {
      arToggle.checked = !!(p.autoReset && p.autoReset.enabled);
      if (arClear) {
        arClear.value = (p.autoReset && p.autoReset.clear) || "wagers";
        arClear.disabled = !arToggle.checked;
      }
      arToggle.addEventListener("change", () => { if (arClear) arClear.disabled = !arToggle.checked; });
    }
    const pwEnabled = $("f_password_enabled");
    const pwInput = $("f_password");
    if (pwEnabled) {
      pwEnabled.checked = !!p.passwordProtected;
      if (pwInput) pwInput.disabled = !pwEnabled.checked;
      pwEnabled.addEventListener("change", () => { if (pwInput) pwInput.disabled = !pwEnabled.checked; });
    }
    $("a_label").placeholder = new Date().toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  }

  if (hasBoardSettings) {
    renderDomain();
    renderNotifications(p.notify || {});
    renderLegal();
    if (p.customDomain !== undefined) $("f_domain").value = p.customDomain || "";
    if (p.domainStatus) renderDomainStatus(p.domainStatus, "");
  }

  const pubToggle = $("pubToggle");
  if (pubToggle) pubToggle.checked = state.PUBLISHED;
  wirePublishAction();
  const liveUrl = "/" + state.SLUG;
  const liveLink = $("liveLink");
  if (liveLink) { liveLink.href = liveUrl; liveLink.title = location.host + liveUrl; }
  renderBoardStatus();
  const previewLiveLink = $("previewLiveLink");
  if (previewLiveLink) { previewLiveLink.href = liveUrl; previewLiveLink.title = location.host + liveUrl; }
  stopLoadingCopy();
  $("loading").setAttribute("aria-busy", "false");
  $("loading").hidden = true;
  $("dash").hidden = false;
  window.__yrBoot?.signal();
  setupShell();
  // All sections live in this one document, so section-specific data loads the
  // first time a section is shown instead of at boot — and never re-initializes
  // the workspace when you move between sections.
  registerSectionMounter((page) => {
    if (page === "games") initGames();
    if (page === "performance") initPerformance();
  });
  // Keep every feature visible. Manage sites is useful even with one site because
  // it is also where the operator creates the next one.
  // The URL says which section this document is: `/dashboard` is Home,
  // not "whichever screen we guess you need".
  const route = currentRoute();
  const hash = route.tab || location.hash.replace("#", "");
  navTo(route.page, hash);
  if (hasEditor) {
    // The iframe starts empty: render the preview once so the editor never
    // opens on a blank frame. No-ops while the editor section is hidden.
    refreshDesignPreview();
    wireStreamerHud();
  }
  // Games/Analytics/Home data loads happen in navTo (directly or through the
  // section mounter above), so boot only pays for the section being shown.
  if (hasSection("home") || hasBoardSettings) loadCreditsStatus();
  if (hasSection("home")) {
    loadOverviewLiveData().catch((err) => {
      logError("overview/live", err);
      try {
        renderOverviewSummary();
      } catch (renderErr) {
        logError("overview/render", renderErr);
      }
    });
  }
  if (hasBoardSettings) {
    setupSettingsScreen(p, urlParams.get("tab") || "access");
  }

  // The save bar, unload guard and preview react to the same notification in
  // dashboard/site.js; this only adds the debounced overview refresh.
  if (hasSection("home")) {
    let dirtyTimer;
    subscribe((keys) => {
      if (!keys.includes("draft")) return;
      clearTimeout(dirtyTimer);
      dirtyTimer = setTimeout(renderOverviewSummary, 150);
    });
  }

  if (hasEditor) window.addEventListener("message", (e) => {
    if (e.data?.type === "yr_edit_request") {
      const { key, value, extra } = e.data;
      if (value !== undefined) {
        // Brand fields: update the form input directly
        const el = document.getElementById(key);
        if (el) {
          el.value = value;
          el.dispatchEvent(new Event("input"));
        } else if (key === "player_name" && extra) {
          // Find the player row by name and update
          const rows = [...$("rows").children];
          const row = rows.find(tr => tr.querySelector(".p-name")?.value.trim() === extra);
          if (row) { row.querySelector(".p-name").value = value; markDirty(); }
        } else if (key === "player_wager" && extra) {
          // Find the player row by name and update wager
          const rows = [...$("rows").children];
          const row = rows.find(tr => tr.querySelector(".p-name")?.value.trim() === extra);
          if (row) { row.querySelector(".p-wager").value = value.replace(/[^0-9.]/g, ""); markDirty(); }
        }
      } else {
        // Fallback: scroll to and focus the relevant field in the settings panel
        const el = document.getElementById(key);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.focus();
          el.select?.();
        }
      }
    }
  });
  $("dash").addEventListener("input", markDirty);
  $("dash").addEventListener("change", markDirty);

  // Keyboard shortcut system (Hook at dashboard mount)
  document.addEventListener("keydown", (e) => {
    // Ctrl+S / Cmd+S: Save
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      const saveBtn = document.getElementById("save");
      if (saveBtn && !saveBtn.disabled && !saveBtn.hidden) saveBtn.click();
    }
  });

  if (urlParams.get("upgraded")) {
    $("status").textContent = "Payment received — Pro activates once the network confirms (usually minutes).";
  }
}

function wireStreamerHud() {
  window.addEventListener("message", (e) => {
    if (e.data?.type === "yr_click_player") {
      const name = e.data.name;
      const rows = document.getElementById("rows")?.querySelectorAll("tr");
      if (!rows) return;
      for (const row of rows) {
        const input = row.querySelector(".p-name");
        if (input && input.value.trim() === name) {
          // Found it. Highlight and focus.
          row.style.animation = "none";
          // Trigger a quick highlight flash
          setTimeout(() => {
            row.style.animation = "bg-flash 1s ease-out";
            const wagerInput = row.querySelector(".p-wager");
            if (wagerInput) {
              wagerInput.focus();
              wagerInput.select();
            } else {
              input.focus();
            }
          }, 10);
          row.scrollIntoView({ behavior: "smooth", block: "center" });
          break;
        }
      }
    }
  });
}

init();
