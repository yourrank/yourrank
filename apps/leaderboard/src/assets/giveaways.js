import "./dashboard/command-palette.js";
import { loadBoardShell, sitePath } from "./dashboard/board-shell.js";
import { withDashboardTimeout, loginRedirectPath } from "./dashboard/request.js";
import { clearSession } from "./dashboard/session.js";
import { inlineStateHtml, renderInlineState } from "./dashboard/states.js";
import { showConfirmModal, paginate, wirePager } from "./dashboard/utils.js";

// Client-side script for the Engage hub: server-backed Chat Giveaways
// (entries arrive via Kick chat webhooks and are polled from the API),
// plus Raffles and Predictions (Code Drops are owned by Activities).

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2394a3b8'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";

// Lifecycle bridge: the IIFE below assigns its enter/leave functions here so
// the module can export them for the persistent-shell dynamic-section loader.
let _giveawaysEnter = null;
let _giveawaysLeave = null;
export function enter() { _giveawaysEnter?.(); }
export function leave() { _giveawaysLeave?.(); }

// Cross-tab sign-out: when another tab logs out, this standalone page must
// leave the dashboard too. The persistent SPA shell installs the same listener
// in dashboard.js; guard with !window.__yrSpaShell to avoid duplicate redirects.
if (!window.__yrSpaShell) {
  window.addEventListener("storage", (event) => {
    if (event.key === "yr:logout") {
      clearSession();
      location.href = loginRedirectPath(location);
    }
  });
}

(function () {
  // ---- Chat giveaway state (server is the source of truth) ----
  // Entries are collected by the Worker from Kick chat webhooks; this page only
  // polls /api/giveaways/chat while open, so closing or refreshing it never
  // stops collection or loses entrants.
  const POLL_MS = 4000;
  let siteId = "";
  let connection = { connected: false, chatReady: false, channelName: null };
  let session = null;      // current chat_giveaway_sessions row (or null)
  let entrants = [];       // persisted chat_giveaway_entries for `session`
  let currentWinner = null;
  let pollTimer = null;
  let pollInFlight = false;
  let timerInterval = null;
  let claimTimerInterval = null;
  let claimSecondsRemaining = 60;
  let winnerClaimed = false;
  let isRolling = false;
  let settingsSessionId = null;
  let autoRerollInFlight = false;
  let modalOpenTimer = null;
  // Per-draw claim state is derived from the session row the server persists
  // at draw time (winner_response_required / winner_response_timeout_seconds),
  // so a reload or another device renders the same rule. `claimExpired` mirrors
  // the derived window state; final acceptance is server truth only
  // (session.winner_finalized_at).
  let claimExpired = false;

  function drawRules() {
    const required = Boolean(session?.winner_response_required);
    const timeoutSecs = Number(session?.winner_response_timeout_seconds) || 60;
    const drawnAt = session?.drawn_at ? Date.parse(session.drawn_at) : NaN;
    const elapsed = Number.isFinite(drawnAt) ? Math.max(0, Math.floor((Date.now() - drawnAt) / 1000)) : 0;
    return { required, timeoutSecs, remainingSecs: Math.max(0, timeoutSecs - elapsed) };
  }

  // DOM Elements
  const $ = (id) => document.getElementById(id);

  function init() {
    // Wire the giveaway UI first so a failing shell request can never leave the
    // page unresponsive.
    wireEvents();
    loadBoardShell().then((shell) => {
      siteId = shell.activeSiteId || "";
      refreshChatGiveaway().finally(() => startPolling());
      window.__yrBoot?.signal();
    }).catch((error) => {
      window.__yrBoot?.fail(error?.message || "The dashboard shell could not be loaded.");
    });
  }

  function dashboardFetch(input, init = {}) {
    const method = String(init.method || "GET").toUpperCase();
    const headers = new Headers(init.headers || {});
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      const csrf = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] || "";
      headers.set("x-csrf-token", csrf);
    }
    return withDashboardTimeout((signal) => fetch(input, {
      ...init,
      credentials: "same-origin",
      headers,
      signal,
    }));
  }

  async function responseData(response) {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { error: text.slice(0, 240) }; }
  }

  function setInlineStatus(id, message, isError = false) {
    const status = $(id);
    if (!status) return;
    status.textContent = message || "";
    status.hidden = !message;
    status.className = `status${isError ? " status--error" : " status--success"}`;
    status.setAttribute("role", isError ? "alert" : "status");
  }

  // Engage refusals are reported in the page-level alert region, which sits above
  // the tab panes so the message is visible whichever tab the action came from.
  function showEngageError(message) {
    const alert = $("gw-page-alert");
    if (!alert) return;
    alert.textContent = message;
    alert.hidden = false;
    alert.scrollIntoView({ block: "nearest" });
  }

  function clearEngageError() {
    const alert = $("gw-page-alert");
    if (!alert) return;
    alert.textContent = "";
    alert.hidden = true;
  }

  const draftSiteKey = () => {
    const siteId = new URLSearchParams(location.search).get("siteId") || "default";
    return `yr-engage-draft:${siteId}`;
  };
  function draftKey(formId) { return `${draftSiteKey()}:${formId}`; }
  function saveDraft(formId, ids) {
    try {
      const values = {};
      ids.forEach((id) => { const el = $(id); if (el) values[id] = el.value; });
      sessionStorage.setItem(draftKey(formId), JSON.stringify(values));
    } catch {}
  }
  function restoreDraft(formId, ids) {
    try {
      const values = JSON.parse(sessionStorage.getItem(draftKey(formId)) || "{}");
      ids.forEach((id) => { const el = $(id); if (el && values[id] != null) el.value = values[id]; });
    } catch {}
  }
  function clearDraft(formId) {
    try { sessionStorage.removeItem(draftKey(formId)); } catch {}
  }
  const drawerFields = {
    "rf-drawer": ["rf-title", "rf-desc", "rf-cost", "rf-max"],
    "pred-drawer": ["pred-title", "pred-opt-1", "pred-opt-2", "pred-min-bet", "pred-max-bet", "pred-lock-min"],
  };
  let activeDrawer = null;
  let drawerTrigger = null;
  let inertedElements = [];
  function focusableIn(panel) {
    return [...panel.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.hidden && el.offsetParent !== null);
  }
  function openEventDrawer(id, trigger) {
    const drawer = $(id);
    if (!drawer) return;
    activeDrawer = id;
    drawerTrigger = trigger || document.activeElement;
    restoreDraft(id, drawerFields[id] || []);
    drawer.hidden = false;
    inertedElements = [...document.body.querySelectorAll("*")].filter(
      (el) => el !== drawer && !drawer.contains(el) && !el.contains(drawer) && !el.hasAttribute("data-keep-interactive"),
    );
    inertedElements.forEach((el) => { el.inert = true; });
    const first = focusableIn(drawer.querySelector(".gw-drawer-panel"))[0];
    first?.focus();
  }
  function closeEventDrawer(id, { clear = false } = {}) {
    const drawer = $(id);
    if (!drawer) return;
    if (clear) clearDraft(id);
    drawer.hidden = true;
    drawer.querySelector(".gw-drawer-panel")?.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    inertedElements.forEach((el) => { el.inert = false; });
    inertedElements = [];
    const trigger = drawerTrigger;
    activeDrawer = null;
    drawerTrigger = null;
    if (trigger && document.contains(trigger)) trigger.focus();
  }
  function trapEventDrawerFocus(event) {
    if (event.key === "Escape" && activeDrawer) {
      event.preventDefault();
      closeEventDrawer(activeDrawer);
      return;
    }
    if (event.key !== "Tab" || !activeDrawer) return;
    const panel = $(activeDrawer)?.querySelector(".gw-drawer-panel");
    const items = panel && focusableIn(panel);
    if (!items?.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function validateDrawer(formId, fields) {
    let first;
    fields.forEach(({ id, message, valid }) => {
      const input = $(id);
      const error = document.querySelector(`[data-field-error="${id}"]`);
      if (!input || !error) return;
      const ok = valid(input.value);
      input.toggleAttribute("aria-invalid", !ok);
      error.textContent = ok ? "" : message;
      if (!ok && !first) first = input;
    });
    first?.focus();
    return !first;
  }


  function readRules() {
    return {
      entryMode: document.querySelector('input[name="gw-entry-mode"]:checked')?.value || "chat",
      subscriberOnly: !!$("gw-opt-subscriber")?.checked,
      vipOnly: !!$("gw-opt-vip")?.checked,
      excludePreviousWinners: !!$("gw-opt-skip-past")?.checked,
      onePerIp: !!$("gw-opt-ip")?.checked,
      winnerMustRespond: !!$("gw-opt-claim-req")?.checked,
      responseTimeout: Number($("gw-opt-claim-duration")?.value || 60),
      autoReroll: !!$("gw-opt-auto-reroll")?.checked,
    };
  }

  function renderRuleAvailability() {
    const verified = readRules().entryMode === "verified";
    if ($("gw-opt-ip")) {
      $("gw-opt-ip").disabled = !verified;
      if (!verified) $("gw-opt-ip").checked = false;
    }
    if ($("gw-ip-requirement")) $("gw-ip-requirement").textContent = verified ? "Shared connections may exclude people living together." : "Locked — Requires Verified Entry";
    if ($("gw-vpn-requirement")) $("gw-vpn-requirement").textContent = verified ? "Unavailable — Detection provider required" : "Locked — Requires Verified Entry and a detection provider";
    if ($("gw-device-requirement")) $("gw-device-requirement").textContent = verified ? "Unavailable — No supported device check" : "Locked — Requires Verified Entry and a supported device check";
    if ($("gw-enable-verified")) $("gw-enable-verified").hidden = verified;
    const mustRespond = readRules().winnerMustRespond;
    if ($("gw-opt-claim-duration")) $("gw-opt-claim-duration").disabled = !mustRespond;
    if ($("gw-opt-auto-reroll")) {
      $("gw-opt-auto-reroll").disabled = !mustRespond;
      if (!mustRespond) $("gw-opt-auto-reroll").checked = false;
    }
  }

  function renderRules() {
    if (!session && settingsSessionId) {
      settingsSessionId = null;
      document.querySelector('input[name="gw-entry-mode"][value="chat"]')?.click();
      for (const id of ["gw-opt-subscriber", "gw-opt-vip", "gw-opt-skip-past", "gw-opt-ip", "gw-opt-claim-req", "gw-opt-auto-reroll"]) if ($(id)) $(id).checked = false;
    }
    if (session && settingsSessionId !== session.id) {
      settingsSessionId = session.id;
      const r = session.rules || {};
      document.querySelector(`input[name="gw-entry-mode"][value="${["chat", "members", "verified"].includes(r.entryMode) ? r.entryMode : "chat"}"]`)?.click();
      for (const [id, key] of [["gw-opt-subscriber", "subscriberOnly"], ["gw-opt-vip", "vipOnly"], ["gw-opt-skip-past", "excludePreviousWinners"], ["gw-opt-ip", "onePerIp"], ["gw-opt-claim-req", "winnerMustRespond"], ["gw-opt-auto-reroll", "autoReroll"]]) {
        if ($(id)) $(id).checked = !!r[key];
      }
      if ($("gw-opt-claim-duration")) $("gw-opt-claim-duration").value = String(r.responseTimeout || 60);
    }
    renderRuleAvailability();
    if ($("gw-settings")) $("gw-settings").disabled = isActive();
    if ($("gw-settings-note")) $("gw-settings-note").textContent = isActive() ? "These rules are saved and locked for the current giveaway." : "Settings are saved when you start a giveaway. Changes apply to the next giveaway.";
    const verification = session?.rules?.entryMode === "verified";
    if ($("gw-verification-link-wrap")) $("gw-verification-link-wrap").hidden = !verification;
    if (verification && $("gw-verification-link")) $("gw-verification-link").href = `/giveaways/verify?sessionId=${encodeURIComponent(session.id)}`;
  }

  async function checkAutoReroll() {
    if (autoRerollInFlight || isRolling || !session?.rules?.autoReroll || session.winner_confirmed_at || session.winner_finalized_at
      || !session.winner_response_deadline || Date.parse(session.winner_response_deadline) > Date.now()) return;
    autoRerollInFlight = true;
    try {
      const response = await chatApi("/draw", {
        sessionId: session.id, siteId: siteId || undefined, automatic: true,
        expectedWinnerEntryId: session.winner_entry_id, expectedDrawnAt: session.drawn_at,
      });
      const data = await responseData(response);
      if (response.ok) applyState({ connection, ...data });
      else showEngageError(data.error || "Auto re-roll failed.");
    } catch { showEngageError("Network error during auto re-roll."); }
    finally { autoRerollInFlight = false; }
  }

  function wireEvents() {
    $("gw-settings")?.addEventListener("change", renderRuleAvailability);
    $("gw-enable-verified")?.addEventListener("click", () => {
      document.querySelector('input[name="gw-entry-mode"][value="verified"]')?.click();
      renderRuleAvailability();
    });
    document.addEventListener("keydown", trapEventDrawerFocus);
    $("gw-setup-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      toggleGiveaway();
    });

    $("gw-btn-roll")?.addEventListener("click", () => rollWinner());
    $("gw-btn-reroll")?.addEventListener("click", () => rollWinner({ excludeIds: currentWinner ? [currentWinner.id] : [] }));
    $("gw-btn-copy-winner")?.addEventListener("click", (e) => copyWinnerDetails(e.currentTarget));
    $("gw-btn-confirm")?.addEventListener("click", () => confirmWinner());
    $("gw-btn-export")?.addEventListener("click", () => exportCSV());

    $("gw-search-entrants")?.addEventListener("input", (e) => {
      filterEntrantsTable(e.target.value);
    });

    const closeModal = () => {
      clearTimeout(modalOpenTimer);
      const m = $("gw-winner-modal");
      if (m) m.hidden = true;
    };
    $("gw-modal-close")?.addEventListener("click", closeModal);
    $("gw-modal-reroll")?.addEventListener("click", () => {
      const exclude = currentWinner ? [currentWinner.id] : [];
      closeModal();
      rollWinner({ excludeIds: exclude });
    });
    $("gw-modal-copy")?.addEventListener("click", (e) => copyWinnerDetails(e.currentTarget));
    $("gw-modal-confirm")?.addEventListener("click", () => confirmWinner());

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && pollTimer) refreshChatGiveaway();
    });
  }

  function setStatus(state, text) {
    const badge = $("gw-status-badge");
    const statusText = $("gw-status-text");
    if (badge) badge.className = `gw-status-pill gw-status--${state}`;
    if (statusText) statusText.textContent = text;
  }

  function chatApi(path, body) {
    return dashboardFetch(sitePath(`/api/giveaways/chat${path}`), body === undefined ? {} : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      refreshChatGiveaway();
    }, POLL_MS);
  }

  async function refreshChatGiveaway() {
    if (pollInFlight || !$("gw-setup-form")) return;
    pollInFlight = true;
    try {
      const res = await chatApi("");
      const data = await responseData(res);
      if (!res.ok) {
        if (res.status === 401) { clearInterval(pollTimer); pollTimer = null; }
        return;
      }
      applyState(data);
      await checkAutoReroll();
    } catch {
      // transient; next poll retries
    } finally {
      pollInFlight = false;
    }
  }

  function applyState(data) {
    connection = data.connection || { connected: false, chatReady: false, channelName: null };
    session = data.session || null;
    entrants = Array.isArray(data.entries) ? data.entries : [];
    const previousWinnerId = currentWinner?.id || null;
    currentWinner = data.winner || null;

    renderConnection();
    renderRules();
    renderSessionControls();
    renderEntrants();
    renderWinner(previousWinnerId);
  }

  function isActive() { return session?.status === "active"; }

  function renderConnection() {
    const nameEl = $("gw-channel-name");
    const connectedBlock = $("gw-channel-connected");
    const disconnectedBlock = $("gw-channel-disconnected");
    const notice = $("gw-chat-events-notice");
    if (nameEl) nameEl.textContent = connection.channelName ? connection.channelName : "";
    if (connectedBlock) connectedBlock.hidden = !connection.connected;
    if (disconnectedBlock) disconnectedBlock.hidden = connection.connected;
    if (notice) notice.hidden = !(connection.connected && !connection.chatReady);
    const connectLink = $("gw-btn-connect-kick");
    if (connectLink) connectLink.href = sitePath("/dashboard/settings/connections");
  }

  function renderSessionControls() {
    const startBtn = $("gw-btn-listen");
    const label = $("gw-listen-btn-label");
    const keywordInput = $("gw-keyword-input");
    const keywordStat = $("gw-stat-keyword");
    const active = isActive();

    if (active) {
      setStatus("live", "LIVE");
      if (label) label.textContent = "Stop entries";
      if (keywordInput) { keywordInput.value = session.keyword; keywordInput.readOnly = true; }
    } else {
      const ready = connection.connected && connection.chatReady;
      setStatus(ready ? "idle" : "error", !connection.connected ? "Kick not connected"
        : !connection.chatReady ? "Chat events unavailable"
        : session?.status === "stopped" ? "Entries closed"
        : session?.status === "completed" ? "Winner drawn" : "Ready");
      if (label) label.textContent = "Start giveaway";
      if (keywordInput) keywordInput.readOnly = false;
    }
    if (startBtn) {
      startBtn.classList.toggle("btn--accent", !active);
      startBtn.classList.toggle("btn--danger", active);
      startBtn.disabled = !active && !(connection.connected && connection.chatReady);
    }
    if (keywordStat) keywordStat.textContent = session ? session.keyword : "—";

    clearInterval(timerInterval);
    timerInterval = null;
    if (session) {
      updateTimer();
      if (active) timerInterval = setInterval(updateTimer, 1000);
    } else if ($("gw-stat-time")) {
      $("gw-stat-time").textContent = "00:00";
    }
  }

  async function toggleGiveaway() {
    clearEngageError();
    if (isActive()) {
      await stopEntries();
    } else {
      await startGiveaway();
    }
  }

  async function startGiveaway() {
    const keyword = $("gw-keyword-input")?.value.trim() || "";
    if (!keyword) {
      showEngageError("Enter the keyword viewers should type.");
      return;
    }
    if (!connection.connected) {
      showEngageError("Chat giveaways require a connected Kick channel.");
      return;
    }
    const button = $("gw-btn-listen");
    if (button) button.disabled = true;
    try {
      const res = await chatApi("/start", { keyword, rules: readRules(), siteId: siteId || undefined });
      const data = await responseData(res);
      if (!res.ok) {
        showEngageError(data.error || "Could not start the giveaway.");
        return;
      }
      applyState(data);
    } catch {
      showEngageError("Network error starting the giveaway.");
    } finally {
      if (button) button.disabled = false;
      renderSessionControls();
    }
  }

  async function stopEntries() {
    const button = $("gw-btn-listen");
    if (button) button.disabled = true;
    try {
      const res = await chatApi("/stop", { sessionId: session?.id, siteId: siteId || undefined });
      const data = await responseData(res);
      if (!res.ok) {
        showEngageError(data.error || "Could not stop entries.");
        return;
      }
      applyState({ connection, ...data });
    } catch {
      showEngageError("Network error stopping entries.");
    } finally {
      if (button) button.disabled = false;
      renderSessionControls();
    }
  }

  function entrantBadges(entrant) {
    const badges = Array.isArray(entrant.badges) ? entrant.badges : [];
    const isSub = badges.some((b) => b?.type === "subscriber");
    const isVip = badges.some((b) => b?.type === "vip");
    return { isSub, isVip };
  }

  function formatEnteredAt(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function renderEntrants() {
    const tbody = $("gw-entrants-list");
    if (!tbody) return;
    tbody.replaceChildren();
    entrants.forEach((entrant, idx) => renderEntrantRow(tbody, entrant, idx + 1));
    updateEntrantsCount();
    filterEntrantsTable($("gw-search-entrants")?.value || "");
  }

  function renderEntrantRow(tbody, entrant, index) {
    const tr = document.createElement("tr");
    tr.id = `entrant-${entrant.id}`;
    tr.dataset.username = String(entrant.username || "").toLowerCase();

    const numberCell = document.createElement("td");
    numberCell.className = "ta-c gw-number-cell";
    numberCell.dataset.label = "#";
    numberCell.textContent = String(index);

    const userCell = document.createElement("td");
    userCell.dataset.label = "Viewer";
    const userWrap = document.createElement("div");
    userWrap.className = "gw-entrant-user";
    const avatar = document.createElement("img");
    avatar.className = "gw-entrant-avatar";
    avatar.src = safeAvatarUrl(entrant.avatar_url, DEFAULT_AVATAR);
    avatar.alt = "";
    avatar.addEventListener("error", () => {
      avatar.src = DEFAULT_AVATAR;
    }, { once: true });
    const userLink = document.createElement("a");
    userLink.className = "gw-entrant-name";
    userLink.href = safeKickProfileUrl(entrant.username);
    userLink.target = "_blank";
    userLink.rel = "noopener";
    userLink.textContent = entrant.username;
    userWrap.append(avatar, userLink);
    userCell.append(userWrap);

    const { isSub, isVip } = entrantBadges(entrant);
    const statusCell = document.createElement("td");
    statusCell.dataset.label = "Status";
    const statusBadge = document.createElement("span");
    if (isSub) {
      statusBadge.className = "gw-sub-badge";
      statusBadge.textContent = "Subscriber";
    } else if (isVip) {
      statusBadge.className = "gw-vip-badge";
      statusBadge.textContent = "VIP";
    } else {
      statusBadge.className = "gw-trust-badge gw-trust-badge--high";
      statusBadge.textContent = "Entered";
    }
    if (entrant.eligibility_status === "pending_verification") statusBadge.textContent = "Pending verification";
    if (entrant.eligibility_status === "rejected") statusBadge.textContent = `Rejected: ${String(entrant.eligibility_reason || "ineligible").replaceAll("_", " ")}`;
    statusCell.append(statusBadge);

    const messageCell = document.createElement("td");
    messageCell.dataset.label = "Chat message";
    const message = document.createElement("span");
    message.className = "gw-entrant-msg";
    message.textContent = entrant.message;
    messageCell.append(message);

    const timeCell = document.createElement("td");
    timeCell.className = "gw-time-cell";
    timeCell.dataset.label = "Entered";
    timeCell.textContent = formatEnteredAt(entrant.entered_at);

    const actionCell = document.createElement("td");
    actionCell.className = "ta-r";
    actionCell.dataset.label = "Action";
    const removeButton = document.createElement("button");
    removeButton.className = "btn btn--sm btn--ghost btn--danger-text";
    removeButton.type = "button";
    removeButton.dataset.removeId = String(entrant.id);
    removeButton.title = "Remove entrant";
    removeButton.textContent = "✕";
    removeButton.addEventListener("click", () => removeEntrant(entrant.id));
    actionCell.append(removeButton);

    tr.append(numberCell, userCell, statusCell, messageCell, timeCell, actionCell);
    tbody.appendChild(tr);
  }

  async function removeEntrant(id) {
    clearEngageError();
    try {
      const res = await chatApi("/entries/remove", { entryId: id, sessionId: session?.id, siteId: siteId || undefined });
      const data = await responseData(res);
      if (!res.ok) {
        showEngageError(data.error || "Could not remove entrant.");
        return;
      }
      applyState({ connection, ...data });
    } catch {
      showEngageError("Network error removing entrant.");
    }
  }

  function updateEntrantsCount() {
    const count = entrants.length;
    if ($("gw-stat-entrants")) $("gw-stat-entrants").textContent = count.toLocaleString();
    if ($("gw-count-header")) $("gw-count-header").textContent = count.toLocaleString();
    if ($("gw-idle-entrant-count")) $("gw-idle-entrant-count").textContent = count.toLocaleString();

    const rollBtn = $("gw-btn-roll");
    const exportBtn = $("gw-btn-export");
    const emptyState = $("gw-entrants-empty");

    if (getEligibleEntrantsPool().length > 0 && !isRolling) {
      rollBtn?.removeAttribute("disabled");
    } else {
      rollBtn?.setAttribute("disabled", "true");
    }
    if (count > 0) exportBtn?.removeAttribute("disabled");
    else exportBtn?.setAttribute("disabled", "true");
    if (emptyState) emptyState.hidden = count > 0;
  }

  function filterEntrantsTable(query) {
    const term = String(query || "").toLowerCase().trim();
    const rows = $("gw-entrants-list")?.querySelectorAll("tr") || [];
    rows.forEach((row) => {
      const username = row.dataset.username || "";
      row.hidden = term ? !username.includes(term) : false;
    });
  }

  // Animation uses eligible entries only; the server independently selects the pool.
  function getEligibleEntrantsPool() {
    return entrants.filter((entry) => entry.eligibility_status === "eligible");
  }

  // Vertical roulette: usernames scroll through a fixed center selection line,
  // fast at first, then easing down, then one final step onto the real winner.
  // The animation NEVER picks the winner — it only lands on the server's pick.
  const ROULETTE_ITEM_H = 46;

  function buildRouletteSequence(pool, winner) {
    const names = [...new Set(pool.map((e) => e.username))];
    const pick = () => names[Math.floor(Math.random() * names.length)];
    const seq = [];
    let prev = null;
    for (let i = 0; i < 22; i++) {
      let n = pick();
      while (names.length > 1 && n === prev) n = pick();
      seq.push(n);
      prev = n;
    }
    let decoy = pick();
    while (names.length > 1 && decoy === winner.username) decoy = pick();
    seq.push(decoy, winner.username);
    return seq;
  }

  function runRoulette(track, pool, winner) {
    return new Promise((resolve) => {
      if (!track) return resolve();
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const seq = buildRouletteSequence(pool, winner);
      track.innerHTML = "";
      for (const name of seq) {
        const item = document.createElement("div");
        item.className = "gw-roulette-item";
        item.textContent = `@${name}`;
        track.appendChild(item);
      }
      if (reduced) {
        track.style.transform = `translateY(${(1 - (seq.length - 1)) * ROULETTE_ITEM_H}px)`;
        setTimeout(resolve, 500);
        return;
      }

      const lastIdx = seq.length - 1;      // winner
      const decoyIdx = seq.length - 2;     // near-miss before the winner
      const MAIN_MS = 2600;                // fast then gradually slowing
      const PAUSE_MS = 380;                // "almost stops" on the decoy
      const FINAL_MS = 620;                // one more step onto the winner
      const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
      const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

      const setPos = (p) => {
        track.style.transform = `translateY(${(1 - p) * ROULETTE_ITEM_H}px)`;
      };
      setPos(0);

      const animate = (from, to, ms, ease) => new Promise((done) => {
        const t0 = performance.now();
        let lastT = t0;
        let lastP = from;
        const step = (now) => {
          const t = Math.min(1, (now - t0) / ms);
          const p = from + (to - from) * ease(t);
          // motion blur while the track moves fast
          const vel = Math.abs(p - lastP) / Math.max(1, now - lastT) * 1000; // items/sec
          track.classList.toggle("gw-roulette-track--blur", vel > 6);
          lastT = now;
          lastP = p;
          setPos(p);
          if (t < 1) requestAnimationFrame(step);
          else { track.classList.remove("gw-roulette-track--blur"); done(); }
        };
        requestAnimationFrame(step);
      });

      (async () => {
        await animate(0, decoyIdx, MAIN_MS, easeOutQuint);
        await new Promise((r) => setTimeout(r, PAUSE_MS));
        await animate(decoyIdx, lastIdx, FINAL_MS, easeOutCubic);
        setPos(lastIdx);
        setTimeout(resolve, 260);
      })();
    });
  }

  function launchConfetti() {
    const box = $("gw-confetti");
    if (!box) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    box.innerHTML = "";
    const colors = ["var(--ws-accent)", "#8b5cf6", "#c4b5fd", "#e2e8f0"];
    for (let i = 0; i < 24; i++) {
      const piece = document.createElement("span");
      piece.className = "gw-confetti-piece";
      piece.style.setProperty("--gw-cx", `${(Math.random() * 2 - 1) * 150}px`);
      piece.style.setProperty("--gw-cy", `${-(50 + Math.random() * 150)}px`);
      piece.style.setProperty("--gw-cr", `${Math.random() * 420 - 210}deg`);
      piece.style.setProperty("--gw-cd", `${0.9 + Math.random() * 0.7}s`);
      piece.style.setProperty("--gw-cc", colors[i % colors.length]);
      box.appendChild(piece);
    }
    setTimeout(() => { box.innerHTML = ""; }, 2400);
  }

  // Single renderer for the draw actions: derives everything from state so
  // live draws, polls, and reloads all land on the same button treatment.
  function updateWinnerActions() {
    const finalized = Boolean(session?.winner_finalized_at);
    const rules = drawRules();
    if (rules.required && !winnerClaimed && rules.remainingSecs <= 0) claimExpired = true;
    const awaitingResponse = !finalized && rules.required && !winnerClaimed;
    for (const id of ["gw-btn-confirm", "gw-modal-confirm"]) {
      const b = $(id);
      if (!b) continue;
      b.classList.remove("btn--accent", "btn--ghost", "gw-btn-confirmed");
      b.removeAttribute("title");
      if (finalized) {
        b.setAttribute("disabled", "true");
        b.classList.add("gw-btn-confirmed");
      } else if (awaitingResponse) {
        // No override path: confirm never bypasses a required chat response.
        b.setAttribute("disabled", "true");
        b.classList.add("btn--ghost");
        b.title = claimExpired
          ? "The winner did not respond — re-roll to pick another winner"
          : "Waiting for the winner to respond in chat";
      } else {
        b.removeAttribute("disabled");
        b.classList.add("btn--accent");
      }
    }
    for (const id of ["gw-btn-reroll", "gw-modal-reroll"]) {
      const b = $(id);
      if (!b) continue;
      b.classList.remove("btn--accent", "btn--ghost");
      b.classList.add(awaitingResponse && claimExpired ? "btn--accent" : "btn--ghost");
    }
    const stage = $("gw-winner-stage");
    if (stage) stage.classList.toggle("gw-winner-stage--confirmed", finalized);
    const chip = $("gw-modal-verify-chip");
    if (chip) chip.hidden = !winnerClaimed;
    if (finalized) {
      clearTimeout(modalOpenTimer);
      clearInterval(claimTimerInterval);
      const modal = $("gw-winner-modal");
      if (modal) modal.hidden = true;
    }
  }

  async function confirmWinner() {
    if (!currentWinner || session?.winner_finalized_at) return;
    // A required chat response can never be bypassed by the confirm button.
    if (drawRules().required && !winnerClaimed) return;
    clearEngageError();
    try {
      const res = await chatApi("/finalize", {
        sessionId: session.id,
        winnerEntryId: session.winner_entry_id,
        drawnAt: session.drawn_at,
        siteId: siteId || undefined,
      });
      const data = await responseData(res);
      if (!res.ok) {
        // The draw may have changed underneath us; resync before showing why.
        if (data.session) await refreshChatGiveaway();
        showEngageError(data.error || "Could not confirm the winner.");
        return;
      }
      applyState({ connection, ...data });
      updateWinnerActions();
    } catch {
      showEngageError("Network error confirming the winner.");
    }
    const modal = $("gw-winner-modal");
    if (modal) modal.hidden = true;
  }

  async function rollWinner(opts = {}) {
    clearEngageError();
    if (!session || isRolling) return;
    let pool = getEligibleEntrantsPool();
    if (Array.isArray(opts.excludeIds) && opts.excludeIds.length) {
      const excluded = new Set(opts.excludeIds.map(String));
      const filtered = pool.filter((e) => !excluded.has(String(e.id)));
      if (filtered.length > 0) pool = filtered;
    }
    if (pool.length === 0) {
      if (entrants.length === 0) return;
      showEngageError("No eligible entries. Pending viewers must verify before the draw.");
      return;
    }

    const rollBtn = $("gw-btn-roll");
    const idle = $("gw-stage-idle");
    const roulette = $("gw-roulette");
    const track = $("gw-roller-track");
    const showcase = $("gw-winner-stage");

    claimExpired = false;
    isRolling = true;
    rollBtn?.setAttribute("disabled", "true");
    if (showcase) showcase.hidden = true;
    if (idle) idle.hidden = true;
    if (roulette) roulette.hidden = false;
    clearInterval(claimTimerInterval);
    clearTimeout(modalOpenTimer);

    // The server draws the winner immediately; the roulette only visualizes it.
    const drawPromise = (async () => {
      const res = await chatApi("/draw", {
        sessionId: session.id,
        expectedWinnerEntryId: session.winner_entry_id ?? null,
        expectedDrawnAt: session.drawn_at ?? null,
        siteId: siteId || undefined,
      });
      const data = await responseData(res);
      return { res, data };
    })();
    const minSpin = new Promise((resolve) => setTimeout(resolve, 600));

    try {
      const [{ res, data }] = await Promise.all([drawPromise, minSpin]);
      if (!res.ok || !data.winner) {
        // A 409 means another draw won the race; resync instead of revealing.
        // isRolling must clear first or the resynced winner won't re-render.
        isRolling = false;
        if (data.session) await refreshChatGiveaway();
        showEngageError(data.error || "Could not draw a winner.");
        return;
      }
      const winner = data.winner;
      await runRoulette(track, pool, winner);
      applyState({ connection, ...data });
      displayWinner(winner);
      playWinnerSound();
      const rules = drawRules();
      if (rules.required) {
        // The roulette consumed part of the window: the countdown derives from
        // drawn_at, the same clock a reload uses.
        startClaimTimer(winner, { totalSecs: rules.timeoutSecs, remainingSecs: rules.remainingSecs });
      } else if ($("gw-claim-box")) {
        $("gw-claim-box").hidden = true;
      }
    } catch {
      showEngageError("Network error drawing a winner.");
    } finally {
      isRolling = false;
      if (roulette) roulette.hidden = true;
      if (!currentWinner && idle) idle.hidden = false;
      updateEntrantsCount();
    }
  }

  // Poll results carry the winner and their webhook-confirmed reply; keep the
  // stage in sync without re-triggering the celebration.
  function renderWinner(previousWinnerId) {
    const showcase = $("gw-winner-stage");
    const idle = $("gw-stage-idle");
    const roulette = $("gw-roulette");
    if (!currentWinner) {
      if (showcase) showcase.hidden = true;
      if (idle && !isRolling) idle.hidden = false;
      return;
    }
    if (idle) idle.hidden = true;
    if (roulette && !isRolling) roulette.hidden = true;
    if (currentWinner.id !== previousWinnerId && !isRolling) {
      // A reloaded winner derives its claim state from the session row:
      // confirmed -> verified boxes; a required-but-unanswered draw resumes
      // the countdown from drawn_at; anything else has no claim UI.
      fillWinnerViews(currentWinner);
      if (showcase) showcase.hidden = false;
      const rules = drawRules();
      claimExpired = rules.required && !winnerClaimed && rules.remainingSecs <= 0;
      if (session?.winner_confirmed_at) {
        if ($("gw-claim-box")) $("gw-claim-box").hidden = false;
        if ($("gw-modal-claim-box")) $("gw-modal-claim-box").hidden = false;
      } else if (rules.required) {
        startClaimTimer(currentWinner, { totalSecs: rules.timeoutSecs, remainingSecs: rules.remainingSecs });
      } else {
        if ($("gw-claim-box")) $("gw-claim-box").hidden = true;
        if ($("gw-modal-claim-box")) $("gw-modal-claim-box").hidden = true;
      }
    }
    if (session?.winner_confirmed_at && !winnerClaimed) {
      confirmWinnerLiveClaim(session.winner_confirmation_message || "");
    }
    if (currentWinner) updateWinnerActions();
  }

  function winnerBadgeLabel(winner) {
    const b = entrantBadges(winner);
    return b.isSub ? "Subscriber" : b.isVip ? "VIP" : "Viewer";
  }

  function fillWinnerViews(winner) {
    const customRule = $("gw-custom-rule-text")?.value?.trim();
    const msgText = customRule ? `"${winner.message}" — Requirement: ${customRule}` : `"${winner.message}"`;

    if ($("gw-winner-name")) $("gw-winner-name").textContent = winner.username;
    if ($("gw-winner-avatar")) $("gw-winner-avatar").src = safeAvatarUrl(winner.avatar_url, DEFAULT_AVATAR);

    if ($("gw-modal-name")) $("gw-modal-name").textContent = winner.username;
    if ($("gw-modal-msg")) $("gw-modal-msg").textContent = msgText;
    if ($("gw-modal-avatar")) $("gw-modal-avatar").src = safeAvatarUrl(winner.avatar_url, DEFAULT_AVATAR);

    const label = winnerBadgeLabel(winner);
    for (const id of ["gw-winner-trust", "gw-modal-trust-badge"]) {
      const badge = $(id);
      if (badge) { badge.textContent = label; badge.className = "gw-trust-badge gw-trust-badge--high"; badge.hidden = false; }
    }

    const winnerFeed = $("gw-winner-chat-feed");
    if (winnerFeed) {
      winnerFeed.innerHTML = "";
      appendWinnerChatMessage(winner.username, winner.message, formatEnteredAt(winner.entered_at));
    }
  }

  function displayWinner(winner) {
    winnerClaimed = false;
    claimExpired = false;
    fillWinnerViews(winner);
    const required = drawRules().required;
    if ($("gw-claim-box")) $("gw-claim-box").hidden = !required;
    setModalClaimVisible(required);
    updateWinnerActions();
    if ($("gw-stage-idle")) $("gw-stage-idle").hidden = true;
    if ($("gw-roulette")) $("gw-roulette").hidden = true;
    const showcase = $("gw-winner-stage");
    if (showcase) {
      showcase.hidden = false;
      showcase.classList.remove("gw-winner-stage--reveal");
      void showcase.offsetWidth; // restart the reveal animation
      showcase.classList.add("gw-winner-stage--reveal");
      showcase.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    launchConfetti();
    // Let the reveal land before the verification modal opens over it.
    clearTimeout(modalOpenTimer);
    modalOpenTimer = setTimeout(() => {
      const modal = $("gw-winner-modal");
      if (modal && currentWinner && !session?.winner_finalized_at) modal.hidden = false;
    }, 950);
  }

  function confirmWinnerLiveClaim(messageText) {
    winnerClaimed = true;
    clearInterval(claimTimerInterval);

    const updateElem = (boxId, statusId, dotId, fillId, countId) => {
      const box = $(boxId);
      const status = $(statusId);
      const dot = $(dotId);
      const fill = $(fillId);
      const countdown = $(countId);

      if (box) box.hidden = false;
      if (status) {
        status.textContent = messageText ? `Responded: "${messageText}"` : "Responded in chat";
        status.classList.remove("gw-claim-status--waiting", "gw-claim-status--expired");
        status.classList.add("gw-claim-status--confirmed");
      }
      if (dot) dot.className = "gw-claim-dot gw-claim-dot--confirmed";
      if (fill) {
        fill.classList.remove("gw-claim-bar-fill--warning", "gw-claim-bar-fill--expired");
        fill.classList.add("gw-claim-bar-fill--confirmed");
        fill.style.width = "100%";
      }
      if (countdown) countdown.textContent = "Verified";
    };

    updateElem("gw-claim-box", "gw-claim-status", "gw-claim-dot", "gw-claim-fill", "gw-claim-countdown");
    updateElem("gw-modal-claim-box", "gw-modal-claim-status", "gw-modal-claim-dot", "gw-modal-claim-fill", "gw-modal-claim-countdown");
    const hint = $("gw-modal-claim-hint");
    if (hint) hint.textContent = "The winner responded within the response window.";
    updateWinnerActions();
    if (currentWinner && messageText) {
      appendWinnerChatMessage(currentWinner.username, messageText, formatEnteredAt(session?.winner_confirmed_at));
    }
  }

  function appendWinnerChatMessage(username, text, time) {
    const feed = $("gw-winner-chat-feed");
    const empty = $("gw-winner-chat-empty");
    if (empty) empty.remove();
    if (!feed) return;

    const row = document.createElement("div");
    row.className = "gw-winner-chat-item";

    const timeSpan = document.createElement("span");
    timeSpan.className = "gw-winner-chat-time";
    timeSpan.textContent = `[${time || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}]`;

    const userSpan = document.createElement("span");
    userSpan.className = "gw-winner-chat-user";
    userSpan.textContent = `@${username}:`;

    const textSpan = document.createElement("span");
    textSpan.className = "gw-winner-chat-text";
    textSpan.textContent = ` ${text}`;

    row.append(timeSpan, userSpan, textSpan);
    feed.appendChild(row);
    feed.scrollTop = feed.scrollHeight;
  }

  // The modal's chat-claim countdown only makes sense for the chat giveaway;
  // a raffle ticket draw has nothing to claim in chat.
  function setModalClaimVisible(visible) {
    const box = $("gw-modal-claim-box");
    if (box) box.hidden = !visible;
  }

  function startClaimTimer(winner, options = {}) {
    const totalSecs = Number(options.totalSecs) || parseInt($("gw-opt-claim-duration")?.value || "60", 10);
    const remaining = options.remainingSecs === undefined ? totalSecs : Math.max(0, Number(options.remainingSecs) || 0);
    winnerClaimed = false;
    claimSecondsRemaining = remaining;

    const setInitial = (boxId, statusId, dotId, countId, fillId) => {
      const box = $(boxId);
      const status = $(statusId);
      const count = $(countId);
      const fill = $(fillId);
      const dot = $(dotId);

      if (box) box.hidden = false;
      if (status) {
        status.textContent = "Waiting for winner response…";
        status.classList.remove("gw-claim-status--confirmed", "gw-claim-status--expired");
        status.classList.add("gw-claim-status--waiting");
      }
      if (dot) dot.className = "gw-claim-dot gw-claim-dot--waiting";
      if (count) count.textContent = `${remaining}s`;
      if (fill) {
        fill.style.width = `${Math.max(0, (remaining / totalSecs) * 100)}%`;
        fill.classList.remove("gw-claim-bar-fill--confirmed", "gw-claim-bar-fill--warning", "gw-claim-bar-fill--expired");
      }
    };

    setInitial("gw-claim-box", "gw-claim-status", "gw-claim-dot", "gw-claim-countdown", "gw-claim-fill");
    setInitial("gw-modal-claim-box", "gw-modal-claim-status", "gw-modal-claim-dot", "gw-modal-claim-countdown", "gw-modal-claim-fill");

    // The window may already be over (e.g. reloaded long after the draw):
    // render the expired state immediately instead of running a timer.
    if (remaining <= 0) {
      for (const [statusId, dotId, fillId] of [
        ["gw-claim-status", "gw-claim-dot", "gw-claim-fill"],
        ["gw-modal-claim-status", "gw-modal-claim-dot", "gw-modal-claim-fill"],
      ]) {
        const status = $(statusId);
        const dot = $(dotId);
        const fill = $(fillId);
        if (status) {
          status.textContent = `Winner did not respond within ${totalSecs} seconds`;
          status.classList.remove("gw-claim-status--waiting", "gw-claim-status--confirmed");
          status.classList.add("gw-claim-status--expired");
        }
        if (dot) dot.className = "gw-claim-dot gw-claim-dot--expired";
        if (fill) {
          fill.style.width = "0%";
          fill.classList.remove("gw-claim-bar-fill--confirmed", "gw-claim-bar-fill--warning");
          fill.classList.add("gw-claim-bar-fill--expired");
        }
      }
      claimExpired = true;
      clearInterval(claimTimerInterval);
      updateWinnerActions();
      return;
    }

    clearInterval(claimTimerInterval);
    claimTimerInterval = setInterval(() => {
      claimSecondsRemaining = drawRules().remainingSecs;

      const updateTick = (countId, fillId, statusId, dotId) => {
        const count = $(countId);
        const fill = $(fillId);
        const status = $(statusId);
        const dot = $(dotId);

        if (count) count.textContent = `${claimSecondsRemaining}s`;
        const pct = Math.max(0, (claimSecondsRemaining / totalSecs) * 100);
        if (fill) {
          fill.style.width = `${pct}%`;
          if (claimSecondsRemaining <= 15) {
            fill.classList.remove("gw-claim-bar-fill--confirmed", "gw-claim-bar-fill--expired");
            fill.classList.add("gw-claim-bar-fill--warning");
          }
        }

        if (claimSecondsRemaining <= 0 && !winnerClaimed) {
          if (status) {
            status.textContent = `Winner did not respond within ${totalSecs} seconds`;
            status.classList.remove("gw-claim-status--waiting", "gw-claim-status--confirmed");
            status.classList.add("gw-claim-status--expired");
          }
          if (dot) dot.className = "gw-claim-dot gw-claim-dot--expired";
          if (fill) {
            fill.classList.remove("gw-claim-bar-fill--confirmed", "gw-claim-bar-fill--warning");
            fill.classList.add("gw-claim-bar-fill--expired");
          }
          claimExpired = true;
          updateWinnerActions();
        }
      };

      updateTick("gw-claim-countdown", "gw-claim-fill", "gw-claim-status", "gw-claim-dot");
      updateTick("gw-modal-claim-countdown", "gw-modal-claim-fill", "gw-modal-claim-status", "gw-modal-claim-dot");

      if (claimSecondsRemaining <= 0) {
        clearInterval(claimTimerInterval);
        checkAutoReroll();
      }
    }, 1000);
  }

  function flashButtonLabel(button, label, duration = 2000) {
    if (!button) return;
    const labelNode = [...button.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    if (!labelNode) return;
    const original = labelNode.nodeValue;
    labelNode.nodeValue = ` ${label}`;
    setTimeout(() => { labelNode.nodeValue = original; }, duration);
  }

  function copyWinnerDetails(button = $("gw-btn-copy-winner")) {
    if (!currentWinner) return;
    const text = `Giveaway Winner: ${currentWinner.username}\nStatus: ${winnerBadgeLabel(currentWinner)}\nMessage: "${currentWinner.message}"\nTime: ${formatEnteredAt(currentWinner.entered_at)}\nKick Profile: https://kick.com/${currentWinner.username}`;
    navigator.clipboard.writeText(text).then(() => {
      flashButtonLabel(button, "Copied!");
    });
  }

  function sanitizeCsvField(val) {
    let str = String(val ?? "");
    // Neutralize spreadsheet formula injection characters (=, +, -, @, tab, cr)
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }
    return `"${str.replace(/"/g, '""')}"`;
  }

  function exportCSV() {
    if (entrants.length === 0) return;

    let csv = "Index,Kick Username,Status,Chat Message,Entered At,Kick Profile URL\n";
    entrants.forEach((e, idx) => {
      const cleanName = sanitizeCsvField(e.username);
      const cleanMsg = sanitizeCsvField(e.message);
      const cleanUrl = sanitizeCsvField(`https://kick.com/${e.username}`);
      csv += `${idx + 1},${cleanName},${winnerBadgeLabel(e)},${cleanMsg},${sanitizeCsvField(e.entered_at)},${cleanUrl}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kick-giveaway-entrants-${connection.channelName || "stream"}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function updateTimer() {
    if (!session) return;
    const start = Date.parse(session.started_at);
    const end = session.status === "active" ? Date.now() : Date.parse(session.stopped_at || session.started_at);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    const elapsedSec = Math.max(0, Math.floor((end - start) / 1000));
    const mins = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
    const secs = String(elapsedSec % 60).padStart(2, "0");
    if ($("gw-stat-time")) $("gw-stat-time").textContent = `${mins}:${secs}`;
  }

  function playWinnerSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 triumphant chord
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.6);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.1);
        osc.stop(ctx.currentTime + i * 0.1 + 0.6);
      });
    } catch {}
  }

  function safeAvatarUrl(value, fallback) {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      if (url.protocol === "https:" && url.hostname === "files.kick.com") return url.href;
    } catch {}
    return fallback;
  }

  function safeKickProfileUrl(username) {
    const value = String(username || "").trim();
    return `https://kick.com/${encodeURIComponent(value)}`;
  }

  // =========================================================================
  // COMMUNITY EVENTS HUB: RAFFLES
  // =========================================================================

  function initEventsHub() {
    // The server renders the active tab and its pane. Tab links own navigation
    // so deep links and browser history remain the source of truth.
    const activeTab = document.querySelector(".gw-tab-btn.is-active")?.dataset.tab || "chat";
    const tabs = document.querySelector(".gw-nav-tabs");
    const activeTabLink = tabs?.querySelector(".gw-tab-btn.is-active");
    if (tabs && activeTabLink) {
      const targetLeft = activeTabLink.offsetLeft - (tabs.clientWidth - activeTabLink.offsetWidth) / 2;
      tabs.scrollTo({ left: Math.max(0, targetLeft), behavior: "auto" });
    }
    if (activeTab === "raffles") loadRaffles();
    if (activeTab === "preds") loadPredictions();

    // Preset chips (custom-first: updates the target input without locking it)
    document.querySelectorAll(".gw-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const targetId = chip.dataset.target;
        const val = chip.dataset.val;
        const input = $(targetId);
        if (input) {
          input.value = val;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
    });

    // Drawers
    $("btn-open-event-drawer")?.addEventListener("click", (event) => {
      openEventDrawer("pred-drawer", event.currentTarget);
    });
    $("btn-create-raffle")?.addEventListener("click", (event) => openEventDrawer("rf-drawer", event.currentTarget));
    $("rf-drawer-close")?.addEventListener("click", () => closeEventDrawer("rf-drawer"));
    $("rf-cancel")?.addEventListener("click", () => closeEventDrawer("rf-drawer", { clear: true }));

    $("btn-create-pred")?.addEventListener("click", (event) => openEventDrawer("pred-drawer", event.currentTarget));
    $("pred-drawer-close")?.addEventListener("click", () => closeEventDrawer("pred-drawer"));
    $("pred-cancel")?.addEventListener("click", () => closeEventDrawer("pred-drawer", { clear: true }));

    $("settle-drawer-close")?.addEventListener("click", () => closeEventDrawer("settle-drawer"));
    $("settle-btn-confirm")?.addEventListener("click", () => settlePrediction());
    $("settle-btn-cancel-pred")?.addEventListener("click", () => cancelPrediction());

    // Forms
    $("rf-form")?.addEventListener("submit", handleCreateRaffleSubmit);
    $("pred-form")?.addEventListener("submit", handleCreatePredSubmit);
    Object.entries(drawerFields).forEach(([formId, ids]) => {
      ids.forEach((id) => $(id)?.addEventListener("input", () => saveDraft(formId, ids)));
    });
    document.querySelectorAll(".gw-drawer-backdrop").forEach((drawer) => {
      drawer.addEventListener("click", (event) => {
        if (event.target === drawer) closeEventDrawer(drawer.id);
      });
    });
    Object.entries(drawerFields).forEach(([id, ids]) => restoreDraft(id, ids));
  }

  async function loadRaffles() {
    const activeList = $("rf-active-list");
    try {
      const res = await dashboardFetch("/api/events/raffles");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (activeList) {
          renderInlineState(activeList, { kind: "error", title: "Couldn't load raffles", body: data.error || "Something went wrong. Try again.", actions: [{ label: "Retry", onClick: loadRaffles }] });
        }
        return;
      }
      const data = await res.json();
      renderRaffles(data.raffles || []);
    } catch (err) {
      if (activeList) {
        renderInlineState(activeList, { kind: "error", title: "Couldn't load raffles", body: "Network error. Check your connection and try again.", actions: [{ label: "Retry", onClick: loadRaffles }] });
      }
    }
  }

  function renderRaffles(raffles) {
    const activeList = $("rf-active-list");
    const pastList = $("rf-past-list");
    if (!activeList || !pastList) return;

    const active = raffles.filter((r) => r.status === "active");
    const past = raffles.filter((r) => r.status !== "active");

    if (active.length === 0) {
      activeList.innerHTML = `
        ${inlineStateHtml({ kind: "empty", title: "No active raffles", body: "Create a raffle so viewers can buy tickets with Credits." })}`;
    } else {
      activeList.innerHTML = active.map((r) => `
        <article class="gw-event-row" data-raffle-id="${esc(r.id)}">
          <div class="gw-event-row-main">
            <span class="gw-event-badge gw-event-badge--live">Selling tickets</span>
            <h3 class="gw-event-title">${esc(r.title)}</h3>
            ${r.description ? `<p class="gw-event-sub">${esc(r.description)}</p>` : ""}
          </div>
          <dl class="gw-event-row-details">
            <div><dt>Ticket</dt><dd>${r.ticket_cost === 0 ? "Free" : `${r.ticket_cost} Credits`}</dd></div>
            <div><dt>Sold</dt><dd>${r.total_tickets || 0}</dd></div>
            <div><dt>Viewers</dt><dd>${r.participant_count || 0}</dd></div>
            <div><dt>Limit</dt><dd>${r.max_tickets_per_viewer || 10} each</dd></div>
          </dl>
          <div class="gw-event-row-action">
            <span>${(r.total_tickets || 0) > 0 ? "Ready to draw" : "Waiting for tickets"}</span>
            <button class="btn btn--sm btn--accent btn--draw-raffle" data-id="${esc(r.id)}" type="button">
              Draw winner
            </button>
          </div>
        </article>
      `).join("");

      activeList.querySelectorAll(".btn--draw-raffle").forEach((btn) => {
        btn.addEventListener("click", () => drawRaffle(btn.dataset.id, btn));
      });
    }

    if (past.length === 0) {
      pastList.innerHTML = `<tr><td colspan="5">${inlineStateHtml({ kind: "empty", title: "No past raffles yet", body: "Completed raffles will appear here." })}</td></tr>`;
    } else {
      pastList.innerHTML = past.map((r) => `
        <tr>
          <td data-label="Prize"><strong>${esc(r.title)}</strong></td>
          <td data-label="Ticket cost">${r.ticket_cost === 0 ? "Free" : `${r.ticket_cost} Credits`}</td>
          <td data-label="Tickets">${r.total_tickets || 0} tickets</td>
          <td data-label="Winner" class="gw-history-winner">
            <div>${r.winner_name ? `<strong>${esc(r.winner_name)}</strong><span>Ticket #${r.winner_ticket_number}</span>` : "<span>No winner drawn</span>"}</div>
          </td>
          <td data-label="Drawn">${r.drawn_at ? new Date(r.drawn_at).toLocaleString() : "—"}</td>
        </tr>
      `).join("");
    }
  }

  async function handleCreateRaffleSubmit(e) {
    e.preventDefault();
    setInlineStatus("rf-status", "");
    if (!validateDrawer("rf-form", [
      { id: "rf-title", message: "Enter a prize title.", valid: (value) => Boolean(value.trim()) },
      { id: "rf-cost", message: "Enter a ticket cost of 0 or more.", valid: (value) => /^\d+$/.test(value) && Number(value) >= 0 },
      { id: "rf-max", message: "Enter at least 1 ticket.", valid: (value) => /^\d+$/.test(value) && Number(value) >= 1 },
    ])) return;
    const title = $("rf-title")?.value?.trim();

    const cost = parseInt($("rf-cost")?.value, 10) || 0;
    const maxTickets = parseInt($("rf-max")?.value, 10) || 10;
    const desc = $("rf-desc")?.value?.trim() || "";

    const submit = $("rf-submit");
    const original = submit?.innerHTML;
    if (submit) { submit.disabled = true; submit.textContent = "Creating…"; }
    try {
      const res = await dashboardFetch("/api/events/raffles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description: desc, ticketCost: cost, maxTickets }),
      });
      const data = await responseData(res);
      if (!res.ok) {
        setInlineStatus("rf-status", data.error || "Failed to create raffle", true);
        return;
      }
      clearDraft("rf-drawer");
      closeEventDrawer("rf-drawer");
      $("rf-title").value = "";
      $("rf-desc").value = "";
      loadRaffles();
    } catch {
      setInlineStatus("rf-status", "Network error creating raffle.", true);
    } finally {
      if (submit) { submit.disabled = false; submit.innerHTML = original; }
    }
  }

  async function drawRaffle(raffleId, trigger) {
    clearEngageError();
    if (!await showConfirmModal("Draw raffle winner", "Are you ready to draw the random winning ticket on stream?", "Draw winner", true)) return;

    const original = trigger?.innerHTML;
    if (trigger) { trigger.disabled = true; trigger.textContent = "Drawing…"; }
    try {
      const res = await dashboardFetch("/api/events/raffles/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raffleId }),
      });
      const data = await responseData(res);
      if (!res.ok) {
        showEngageError(data.error || "Failed to draw winner");
        return;
      }

      // Celebrate only a real winner; the modal's badges and claim countdown
      // are meaningless without one.
      const modal = $("gw-winner-modal");
      if (!data.winnerName) {
        showEngageError("No winner was drawn — no tickets were sold.");
      } else if (modal) {
        $("gw-modal-name").textContent = data.winnerName;
        $("gw-modal-msg").textContent = `Winning Ticket #${data.winnerTicketNumber} (out of ${data.totalTickets} tickets)`;
        $("gw-modal-avatar").src = DEFAULT_AVATAR;
        if ($("gw-modal-trust-badge")) $("gw-modal-trust-badge").hidden = true;
        setModalClaimVisible(false);
        modal.hidden = false;
        playWinnerSound();
      }
      loadRaffles();
    } catch {
      showEngageError("Network error drawing raffle.");
    } finally {
      if (trigger) { trigger.disabled = false; trigger.innerHTML = original; }
    }
  }

  // =========================================================================
  // PREDICTIONS & BETTING LOGIC
  // =========================================================================

  let activePredictionsList = [];

  async function loadPredictions() {
    const activeList = $("pred-active-list");
    try {
      const res = await dashboardFetch("/api/predictions");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (activeList) {
          renderInlineState(activeList, { kind: "error", title: "Couldn't load predictions", body: data.error || "Something went wrong. Try again.", actions: [{ label: "Retry", onClick: loadPredictions }] });
        }
        return;
      }
      const data = await res.json();
      activePredictionsList = data.predictions || [];
      renderPredictions(activePredictionsList);
    } catch (err) {
      if (activeList) {
        renderInlineState(activeList, { kind: "error", title: "Couldn't load predictions", body: "Network error. Check your connection and try again.", actions: [{ label: "Retry", onClick: loadPredictions }] });
      }
    }
  }

  function renderPredictions(predictions) {
    const activeList = $("pred-active-list");
    const pastList = $("pred-past-list");
    if (!activeList || !pastList) return;

    const active = predictions.filter((p) => p.status === "open" || p.status === "locked");
    const past = predictions.filter((p) => p.status === "settled" || p.status === "cancelled");

    if (active.length === 0) {
      activeList.innerHTML = `
        ${inlineStateHtml({ kind: "empty", title: "No active predictions", body: "Launch a live prediction to let viewers wager their Credits on your stream match outcomes." })}`;
    } else {
      activeList.innerHTML = active.map((p) => {
        const rawOpts = p.options || [];
        const totalPool = p.total_pool || 0;
        return `
          <article class="gw-event-card" data-pred-id="${esc(p.id)}">
            <div class="gw-event-card-head">
              <div class="gw-event-card-ident">
                <span class="gw-event-badge ${p.status === "open" ? "gw-event-badge--live" : "gw-event-badge--locked"}">
                  ${p.status === "open" ? "Betting open" : "Betting locked"}
                </span>
                <h3 class="gw-event-title">${esc(p.title)}</h3>
              </div>
              <p class="gw-event-figure">
                <strong>${totalPool} Credits</strong>
                <span>in the pool</span>
              </p>
            </div>

            <div class="gw-event-body">
              <div class="gw-event-options">
                ${rawOpts.map((opt) => {
                  const optPts = opt.total_points || 0;
                  const pct = totalPool > 0 ? Math.round((optPts / totalPool) * 100) : 0;
                  const leading = totalPool > 0 && optPts === Math.max(...rawOpts.map((o) => o.total_points || 0));
                  return `
                    <div class="gw-event-option${leading ? " is-leading" : ""}">
                      <div class="gw-event-option-head">
                        <span class="gw-event-option-label">${esc(opt.label)}</span>
                        <span class="gw-event-option-value"><b>${pct}%</b> · ${optPts} Credits</span>
                      </div>
                      <div class="gw-event-meter">
                        <div class="gw-event-meter-fill" style="width: ${pct}%;"></div>
                      </div>
                    </div>
                  `;
                }).join("")}
              </div>
            </div>

            <div class="gw-event-stats">
              <div class="gw-event-stat"><strong>${p.participant_count || 0}</strong><span>Bettors</span></div>
              <div class="gw-event-stat"><strong>${p.min_bet}–${p.max_bet}</strong><span>Bet limits</span></div>
              <div class="gw-event-stat"><strong>${p.lock_at ? new Date(p.lock_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Manual"}</strong><span>Locks at</span></div>
            </div>

            <div class="gw-event-card-foot">
              <button class="btn btn--sm btn--ghost font-danger btn--cancel-pred" data-id="${esc(p.id)}" type="button">
                Cancel &amp; refund
              </button>
              <div class="gw-event-foot-actions">
                ${p.status === "open" ? `
                  <button class="btn btn--sm btn--ghost btn--lock-pred" data-id="${esc(p.id)}" type="button">
                    Lock betting
                  </button>
                ` : ""}
                <button class="btn btn--sm btn--accent btn--open-settle" data-id="${esc(p.id)}" type="button">
                  Settle &amp; pay out
                </button>
              </div>
            </div>
          </article>
        `;
      }).join("");

      activeList.querySelectorAll(".btn--lock-pred").forEach((btn) => {
        btn.addEventListener("click", () => lockPrediction(btn.dataset.id));
      });

      activeList.querySelectorAll(".btn--open-settle").forEach((btn) => {
        btn.addEventListener("click", () => {
          const pred = activePredictionsList.find((p) => p.id === btn.dataset.id);
          if (pred) openSettleDrawer(pred, btn);
        });
      });

      activeList.querySelectorAll(".btn--cancel-pred").forEach((btn) => {
        btn.addEventListener("click", () => cancelPredictionById(btn.dataset.id, btn));
      });
    }

    if (past.length === 0) {
      pastList.innerHTML = `<tr><td colspan="6">${inlineStateHtml({ kind: "empty", title: "No predictions created yet", body: "Completed predictions will appear here." })}</td></tr>`;
    } else {
      pastList.innerHTML = past.map((p) => {
        return `
          <tr>
            <td><strong>${esc(p.title)}</strong></td>
            <td><strong>${p.total_pool || 0} Credits</strong></td>
            <td>${p.participant_count || 0} bettors</td>
            <td>
              ${p.winning_option_id ? `<span class="gw-event-badge gw-event-badge--live">${esc(p.winning_option_id)}</span>` : "—"}
            </td>
            <td><span class="gw-event-badge">${esc(p.status)}</span></td>
            <td>${new Date(p.created_at).toLocaleString()}</td>
          </tr>
        `;
      }).join("");
    }
  }

  async function handleCreatePredSubmit(e) {
    e.preventDefault();
    setInlineStatus("pred-status", "");
    if (!validateDrawer("pred-form", [
      { id: "pred-title", message: "Enter a prediction question.", valid: (value) => Boolean(value.trim()) },
      { id: "pred-opt-1", message: "Enter option A.", valid: (value) => Boolean(value.trim()) },
      { id: "pred-opt-2", message: "Enter option B.", valid: (value) => Boolean(value.trim()) },
      { id: "pred-min-bet", message: "Enter a minimum bet of at least 1 Credit.", valid: (value) => /^\d+$/.test(value) && Number(value) >= 1 },
      { id: "pred-max-bet", message: "Enter a maximum bet of at least 1 Credit.", valid: (value) => /^\d+$/.test(value) && Number(value) >= 1 },
      { id: "pred-opt-2", message: "Options must be different from each other.", valid: (value) => value.trim().toLowerCase() !== ($("pred-opt-1")?.value || "").trim().toLowerCase() },
      { id: "pred-max-bet", message: "Max bet must be at least the minimum bet.", valid: (value) => !/^\d+$/.test(value) || Number(value) >= Number($("pred-min-bet")?.value || 0) },
    ])) return;
    const title = $("pred-title")?.value?.trim();

    const opt1 = $("pred-opt-1")?.value?.trim() || "Yes";
    const opt2 = $("pred-opt-2")?.value?.trim() || "No";
    const minBet = parseInt($("pred-min-bet")?.value, 10) || 10;
    const maxBet = parseInt($("pred-max-bet")?.value, 10) || 500;
    const lockMinutes = parseInt($("pred-lock-min")?.value, 10) || 5;

    const options = [
      { id: "yes", label: opt1 },
      { id: "no", label: opt2 },
    ];

    const submit = $("pred-submit");
    const original = submit?.innerHTML;
    if (submit) { submit.disabled = true; submit.textContent = "Launching…"; }
    try {
      const res = await dashboardFetch("/api/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, options, minBet, maxBet, lockMinutes }),
      });
      const data = await responseData(res);
      if (!res.ok) {
        setInlineStatus("pred-status", data.error || "Failed to create prediction", true);
        return;
      }
      clearDraft("pred-drawer");
      closeEventDrawer("pred-drawer");
      $("pred-title").value = "";
      loadPredictions();
    } catch {
      setInlineStatus("pred-status", "Network error creating prediction.", true);
    } finally {
      if (submit) { submit.disabled = false; submit.innerHTML = original; }
    }
  }

  async function lockPrediction(predictionId) {
    clearEngageError();
    try {
      const res = await dashboardFetch(`/api/predictions/${predictionId}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ predictionId }),
      });
      const data = await responseData(res);
      if (!res.ok) {
        showEngageError(data.error || "Failed to lock prediction");
        return;
      }
      loadPredictions();
    } catch {
      showEngageError("Network error locking prediction.");
    }
  }

  function openSettleDrawer(pred, trigger) {
    const drawer = $("settle-drawer");
    if (!drawer) return;

    $("settle-pred-id").value = pred.id;
    $("settle-pred-title").textContent = `Question: "${pred.title}" — Total Pool: ${pred.total_pool || 0} Credits`;

    const rawOpts = pred.options || [];
    const container = $("settle-options-container");
    if (container) {
      container.innerHTML = rawOpts.map((opt, i) => `
        <label class="gw-settle-opt-label">
          <input type="radio" name="settle_opt" value="${esc(opt.id)}" ${i === 0 ? "checked" : ""} />
          <div>
            <strong>${esc(opt.label)}</strong>
            <span class="font-muted font-12">(${opt.total_points || 0} Credits wagered)</span>
          </div>
        </label>
      `).join("");
    }

    openEventDrawer("settle-drawer", trigger);
  }

  async function settlePrediction() {
    const predId = $("settle-pred-id")?.value;
    const winningOpt = document.querySelector('input[name="settle_opt"]:checked')?.value;
    if (!predId || !winningOpt) return;

    if (!await showConfirmModal("Settle prediction", `Declare "${winningOpt.toUpperCase()}" as the winning outcome? Points will be distributed immediately.`, "Settle and pay", true)) return;

    const submit = $("settle-btn-confirm");
    const original = submit?.innerHTML;
    if (submit) { submit.disabled = true; submit.textContent = "Settling…"; }
    setInlineStatus("settle-status", "");
    try {
      const res = await dashboardFetch(`/api/predictions/${predId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ predictionId: predId, winningOptionId: winningOpt }),
      });
      const data = await responseData(res);
      if (!res.ok) {
        setInlineStatus("settle-status", data.error || "Failed to settle prediction", true);
        return;
      }
      closeEventDrawer("settle-drawer");
      loadPredictions();
    } catch {
      setInlineStatus("settle-status", "Network error settling prediction.", true);
    } finally {
      if (submit) { submit.disabled = false; submit.innerHTML = original; }
    }
  }

  async function cancelPredictionById(predictionId, trigger) {
    clearEngageError();
    if (!predictionId) return;
    if (!await showConfirmModal("Cancel prediction", "Cancel this prediction? All bets will be fully refunded to viewers.", "Cancel prediction", true)) return;

    const original = trigger?.innerHTML;
    if (trigger) { trigger.disabled = true; trigger.textContent = "Cancelling…"; }
    try {
      const res = await dashboardFetch(`/api/predictions/${predictionId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ predictionId }),
      });
      const data = await responseData(res);
      if (!res.ok) {
        showEngageError(data.error || "Failed to cancel prediction");
        return;
      }
      closeEventDrawer("settle-drawer");
      loadPredictions();
    } catch {
      showEngageError("Network error cancelling prediction.");
    } finally {
      if (trigger) { trigger.disabled = false; trigger.innerHTML = original; }
    }
  }

  async function cancelPrediction() {
    const predId = $("settle-pred-id")?.value;
    if (!predId) return;
    await cancelPredictionById(predId, $("settle-btn-cancel-pred"));
  }

  function esc(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }


  // ---- Persistent-shell lifecycle ----
  // enter() resets module state and re-initializes against the freshly
  // injected fragment DOM. leave() stops the poll and timers and removes the
  // document-level keydown listener so nothing leaks. Entry collection itself
  // happens server-side, so leaving the page never affects the giveaway.
  function giveawaysEnter() {
    clearInterval(pollTimer); pollTimer = null;
    clearInterval(timerInterval); timerInterval = null;
    clearInterval(claimTimerInterval); claimTimerInterval = null;
    session = null; entrants = []; currentWinner = null; isRolling = false; winnerClaimed = false;
    claimExpired = false; settingsSessionId = null; autoRerollInFlight = false;
    init();
    initEventsHub();
  }

  function giveawaysLeave() {
    clearInterval(pollTimer); pollTimer = null;
    clearInterval(timerInterval); timerInterval = null;
    clearInterval(claimTimerInterval); claimTimerInterval = null;
    clearTimeout(modalOpenTimer); modalOpenTimer = null;
    claimExpired = false;
    // Remove the document-level drawer focus trap (added in wireEvents).
    document.removeEventListener("keydown", trapEventDrawerFocus);
  }

  // Expose lifecycle hooks to the module scope for the dynamic-section loader.
  _giveawaysEnter = giveawaysEnter;
  _giveawaysLeave = giveawaysLeave;

  // Auto-init only on a standalone document load (direct URL / refresh).
  // When the persistent SPA shell is active, enter() is called explicitly.
  if (!window.__yrSpaShell) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        init();
        initEventsHub();
      });
    } else {
      init();
      initEventsHub();
    }
  }
})();
