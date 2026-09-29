import { loadBoardShell } from "./dashboard/board-shell.js";
import { wirePlanLock } from "./dashboard/plan-lock.js";
import { ensureDialog, showConfirmModal } from "./dashboard/utils.js";
import { connectKickChat } from "./chat-entry.js";
import { renderBracket as bracketViewHtml, layoutBracket } from "./tournament-bracket-view.js";
import {
  buildViewModel,
  workspaceHtml,
  emptyStateHtml,
  createDialogHtml,
  selectDialogHtml,
  selectListHtml,
  fullBracketDialogHtml,
  deleteDialogHtml,
  removedEntriesHtml,
  entriesEmptyHtml,
  entryRowsHtml,
} from "./tournament-view.js";

const $ = (id) => document.getElementById(id);
const csrf = () => document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] || "";

// Mirrors the server: tournaments.bracket_size CHECK and SUPPORTED_BRACKET_SIZES.
export const SUPPORTED_BRACKET_SIZES = [4, 8, 16, 32];

let siteId = "";
let board = {};
// Bumped on every enter/leave; async work compares against its own copy so a
// stale boot can never mutate state or the DOM after a navigation.
let lifecycleToken = 0;
let tournament = null;
let entries = [];
// Server-computed entry counts from /entries — eligibility is authoritative
// server-side (people_review_allow makes flagged free entries eligible), so
// the UI never approximates it from status/alt_flag.
let entryCounts = { active: 0, eligible: 0, waitlist: 0, removed: 0, blocked: 0, inactive: 0 };
let matches = [];
let tournaments = [];
let selectedId = "";
let tournamentState = null;
let activeTab = "entries";
let chatConnection = null;
let chatRegistration = null;
let tournamentsEnabled = true;
let entriesPollTimer = null;
let entriesRefreshTimer = null;
let entriesRefreshRunning = false;
let entriesRefreshQueued = false;
let releaseCreateTrap = null;
let releaseSelectTrap = null;
let releaseBracketTrap = null;
let releaseDeleteTrap = null;
// The bracket layouts own ResizeObservers; dispose before every re-render and
// on leave() so they never accumulate.
let disposeEmbeddedLayout = () => {};
let disposeExpandedLayout = () => {};
let settingsBaseline = "";
let settingsSavedTimer = null;
let settingsReadonly = false;
let duplicateProtectionInFlight = false;
let duplicateProtectionPending = null;
let lastSettingsBody = null;
let settingsFix = null;
const advanceMatchRequests = new Set();

function apiPath(path) {
  return siteId ? `${path}${path.includes("?") ? "&" : "?"}siteId=${encodeURIComponent(siteId)}` : path;
}

async function api(path, options = {}) {
  const response = await fetch(apiPath(path), {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      "x-csrf-token": csrf(),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Something went wrong.");
    error.data = data;
    throw error;
  }
  return data;
}

function currentLifecycle() {
  return tournamentState?.lifecycle ?? tournament?.lifecycle ?? "setup";
}

function viewModel() {
  return buildViewModel({
    tournament,
    entries,
    entryCounts,
    matches,
    tournamentState,
    lifecycle: currentLifecycle(),
    tournaments,
    selectedId,
    duplicateProtectionInFlight,
    pendingAntiAltEnabled: duplicateProtectionPending,
    chatRegistration,
    board,
    activeTab,
    tournamentsEnabled,
  });
}

function setMessage(text = "", error = false) {
  const message = $("tournament-message");
  if (!message) return;
  message.textContent = text;
  message.hidden = !text;
  message.className = `tn-message${error ? " is-error" : ""}`;
}

function stopChat() {
  chatConnection?.close();
  chatConnection = null;
}

// Kick chat entries arrive through the webhook; poll so they appear without the socket.
function updateEntriesPolling(lifecycle) {
  if (lifecycle === "setup" && tournament?.signup_state === "open") {
    if (!entriesPollTimer) {
      entriesPollTimer = setInterval(() => { refreshEntriesSoon(); }, 15000);
    }
  } else if (entriesPollTimer) {
    clearInterval(entriesPollTimer);
    entriesPollTimer = null;
  }
}

// ---- Render --------------------------------------------------------------
//
// One render path: the view module turns state into markup for #tournament-root
// and the controller wires behavior through the delegated listeners below.
// #tournament-dialogs is a sibling host so an open dialog survives re-renders.

function render() {
  const root = $("tournament-root");
  if (!root) return;
  const lifecycle = currentLifecycle();
  updateEntriesPolling(lifecycle);
  const vm = viewModel();
  disposeEmbeddedLayout();
  disposeEmbeddedLayout = () => {};
  if (!tournament) {
    root.innerHTML = emptyStateHtml({ locked: !tournamentsEnabled });
    if (!tournamentsEnabled) wirePlanLock(root.querySelector("[data-plan-lock='tournaments']"), "tournaments");
    return;
  }
  root.innerHTML = workspaceHtml(
    vm,
    vm.hasMatches ? bracketViewHtml({ tournament, matches, lifecycle, mode: "embedded" }) : ""
  );
  const bracket = $("tournament-bracket");
  disposeEmbeddedLayout = bracket && !bracket.hidden ? layoutBracket(bracket) : () => {};
  syncAdvanceButtons(root);
  settingsReadonly = vm.finished;
  settingsBaseline = settingsSnapshot();
  updateDirty();
}

function syncEntryLists(vm) {
  const active = vm.entriesVm.filter((entry) => !entry.inactive);
  const list = $("tournament-entry-list");
  if (list) list.innerHTML = entryRowsHtml(vm, active);
  const activeSection = $("tournament-entries");
  if (activeSection) activeSection.hidden = active.length === 0;

  const emptyMarkup = entriesEmptyHtml(vm);
  const empty = $("tournament-entries-empty");
  if (emptyMarkup && empty) empty.outerHTML = emptyMarkup;
  else if (emptyMarkup && activeSection) activeSection.insertAdjacentHTML("beforebegin", emptyMarkup);
  else if (!emptyMarkup) empty?.remove();

  const removedMarkup = removedEntriesHtml(vm);
  const removed = $("tournament-removed");
  if (!removedMarkup) {
    removed?.remove();
  } else if (removed) {
    $("tournament-removed-summary").textContent = `Removed (${vm.inactiveCount})`;
    $("tournament-removed-list").innerHTML = entryRowsHtml(vm, vm.entriesVm.filter((entry) => entry.inactive));
  } else {
    activeSection?.insertAdjacentHTML("afterend", removedMarkup);
  }
}

function switchTab(name) {
  activeTab = name;
  for (const tab of document.querySelectorAll("[data-tournament-tab]")) {
    const on = tab.dataset.tournamentTab === name;
    tab.classList.toggle("is-active", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
    const panel = $(`tournament-panel-${tab.dataset.tournamentTab}`);
    if (panel) panel.hidden = !on;
  }
}

// refreshOnly marks the poll/chat/entry-action path: full reloads (initial
// load, settings saves, lifecycle ops) always re-render.
async function loadEntries({ refreshOnly = true } = {}) {
  if (!tournament) return;
  let bracketUnavailable = false;
  const [entryData, bracketData] = await Promise.all([
    api(`/api/tournaments/${encodeURIComponent(tournament.id)}/entries`),
    api(`/api/tournaments/${encodeURIComponent(tournament.id)}/bracket`).catch(() => {
      bracketUnavailable = true;
      return { matches: [] };
    }),
  ]);
  entries = entryData.entries || [];
  entryCounts = entryData.counts || { active: 0, eligible: 0, waitlist: 0, removed: 0, blocked: 0, inactive: 0 };
  tournamentState = entryData.state || null;
  matches = bracketData.matches || [];
  if (bracketData.tournament?.winner_name) tournament.winner_name = bracketData.tournament.winner_name;
  if (bracketData.tournament?.status) tournament.status = bracketData.tournament.status;
  if (bracketData.tournament?.created_at) tournament.created_at = bracketData.tournament.created_at;
  // Entries refresh (poll/chat/action): a visible settings form that is
  // focused or dirty must survive the refresh — rebuilding it would steal
  // focus and wipe edits. Update the data parts and leave the form alone.
  const form = $("tournament-settings-form");
  const settingsBusy = refreshOnly && form && !form.closest("[hidden]")
    && (form.contains(document.activeElement) || settingsSnapshot() !== settingsBaseline);
  const updateBracketStatus = () => {
    const message = $("tournament-message");
    const bracketError = "Could not load the tournament bracket. Try again.";
    if (bracketUnavailable) setMessage(bracketError, true);
    else if (message?.textContent === bracketError) setMessage("");
  };
  if (settingsBusy) {
    const vm = viewModel();
    syncEntryLists(vm);
    const count = $("tournament-count");
    if (count) count.textContent = vm.stats[0].value;
    const entriesTab = $("tournament-tab-entries");
    if (entriesTab) entriesTab.textContent = vm.entriesTabLabel;
    updateBracketStatus();
    return;
  }
  render();
  updateBracketStatus();
}

async function loadTournament() {
  const data = await api("/api/tournaments");
  chatRegistration = data.chatRegistration || null;
  tournamentsEnabled = data.entitlement?.enabled !== false;
  tournaments = data.tournaments || [];
  const storageKey = `yr:tournament:${siteId}`;
  const savedId = selectedId || window.sessionStorage.getItem(storageKey);
  tournament = tournaments.find((item) => item.id === savedId)
    || tournaments.find((item) => item.id === data.current_id)
    || tournaments[0]
    || null;
  selectedId = tournament?.id || "";
  if (selectedId) window.sessionStorage.setItem(storageKey, selectedId);
  tournamentState = null;
  entries = [];
  entryCounts = { active: 0, eligible: 0, waitlist: 0, removed: 0, blocked: 0, inactive: 0 };
  matches = [];
  if (tournament) await loadEntries({ refreshOnly: false });
  else render();
}

async function switchTournament(id) {
  const selected = tournaments.find((item) => item.id === id);
  if (!selected || selected.id === tournament?.id) return;
  stopChat();
  selectedId = selected.id;
  window.sessionStorage.setItem(`yr:tournament:${siteId}`, selectedId);
  tournament = selected;
  tournamentState = null;
  entries = [];
  matches = [];
  entryCounts = { active: 0, eligible: 0, waitlist: 0, removed: 0, blocked: 0, inactive: 0 };
  activeTab = "entries";
  await loadEntries({ refreshOnly: false });
  if (tournament.signup_state === "open") await startChat();
}

// ---- Dialogs -------------------------------------------------------------
//
// Dialog markup is rendered on demand into #tournament-dialogs (a persistent
// host inside #tournament-app) and removed on close; each open gets a fresh
// trap via ensureDialog(). close*() also unlocks the page scroll.

function mountDialog(html) {
  const host = $("tournament-dialogs");
  if (!host) return null;
  host.insertAdjacentHTML("beforeend", html);
  return host.lastElementChild;
}

function unmountDialog(modal) {
  if (!modal || !modal.isConnected) return;
  modal.remove();
  if (!document.querySelector("#tournament-dialogs .tn-dialog")) {
    document.documentElement.classList.remove("yr-modal-open");
  }
}

// ---- Create dialog --------------------------------------------------------

function setCreateError(text = "") {
  const el = $("tournament-create-error");
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
}

async function openCreateModal() {
  if (!tournamentsEnabled) {
    setMessage("Tournaments is available on Starter and higher plans.", true);
    return;
  }
  if ($("tournament-create-modal")) return;
  const modal = mountDialog(createDialogHtml({
    chatChannel: tournament?.chat_channel,
    siteChannel: board.kickChannelName,
    chatRegistration,
  }));
  if (!modal) return;
  setCreateError("");
  document.documentElement.classList.add("yr-modal-open");
  const dialog = await ensureDialog().catch(() => null);
  if (!modal.isConnected) return;
  releaseCreateTrap = dialog ? dialog.trap(modal, closeCreateModal) : null;
  $("tc-title")?.focus();
  $("tc-title")?.select();
}

function closeCreateModal() {
  const modal = $("tournament-create-modal");
  if (!modal) return;
  unmountDialog(modal);
  if (releaseCreateTrap) releaseCreateTrap();
  releaseCreateTrap = null;
}

async function openDeleteModal() {
  if (!tournament || $("tournament-delete-modal")) return;
  const modal = mountDialog(deleteDialogHtml({
    title: tournament.title,
    warning: tournamentState?.delete_warning || "",
  }));
  if (!modal) return;
  $("tournament-delete-error").hidden = true;
  document.documentElement.classList.add("yr-modal-open");
  const dialog = await ensureDialog().catch(() => null);
  if (!modal.isConnected) return;
  releaseDeleteTrap = dialog ? dialog.trap(modal, closeDeleteModal) : null;
  $("td-confirm")?.focus();
}

function closeDeleteModal() {
  const modal = $("tournament-delete-modal");
  if (!modal) return;
  unmountDialog(modal);
  releaseDeleteTrap?.();
  releaseDeleteTrap = null;
}

function updateDeleteSubmit({ clearError = true } = {}) {
  const input = $("td-confirm");
  const submit = $("tournament-delete-submit");
  if (!input || !submit) return;
  submit.disabled = input.value.trim() !== String(tournament?.title || "").trim();
  const error = $("tournament-delete-error");
  if (error && clearError) {
    error.textContent = "";
    error.hidden = true;
  }
}

async function submitDelete(event) {
  event.preventDefault();
  if (!tournament) return;
  const submit = $("tournament-delete-submit");
  const confirmTitle = $("td-confirm")?.value || "";
  submit.disabled = true;
  try {
    const data = await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/delete`, {
      method: "POST",
      body: JSON.stringify({ confirmTitle }),
    });
    closeDeleteModal();
    stopChat();
    selectedId = "";
    window.sessionStorage.removeItem(`yr:tournament:${siteId}`);
    activeTab = "entries";
    await loadTournament();
    setMessage(data.message);
  } catch (error) {
    const message = $("tournament-delete-error");
    if (message) {
      message.textContent = error.data?.error || error.message;
      message.hidden = false;
    }
  } finally {
    if ($("tournament-delete-submit")) updateDeleteSubmit({ clearError: false });
  }
}

export function readCreateForm() {
  const bracketSize = parseInt($("tc-bracket-size").value, 10);
  if (!SUPPORTED_BRACKET_SIZES.includes(bracketSize)) {
    return { error: `Bracket size must be one of ${SUPPORTED_BRACKET_SIZES.join(", ")}.` };
  }
  const capMode = $("tc-entry-cap").value;
  let entryCap = capMode;
  if (capMode === "custom") {
    entryCap = parseInt($("tc-entry-cap-custom").value, 10);
    if (!Number.isInteger(entryCap) || entryCap < 1) return { error: "Enter a signup limit of at least 1, or choose Unlimited." };
  }
  return {
    body: {
      siteId,
      title: $("tc-title").value.trim(),
      gameName: $("tc-game").value.trim(),
      bracketSize,
      entryCap,
      chatChannel: $("tc-chat-channel").value.trim(),
      entryKeyword: $("tc-keyword").value.trim() || "!join",
    },
  };
}

async function submitCreate(event) {
  event.preventDefault();
  const parsed = readCreateForm();
  if (parsed.error) {
    setCreateError(parsed.error);
    return;
  }
  const submit = $("tournament-create-submit");
  submit.disabled = true;
  try {
    const data = await api("/api/tournaments", { method: "POST", body: JSON.stringify(parsed.body) });
    stopChat();
    selectedId = data.tournament.id;
    window.sessionStorage.setItem(`yr:tournament:${siteId}`, selectedId);
    activeTab = "entries";
    closeCreateModal();
    setMessage("");
    await loadTournament();
  } catch (error) {
    setCreateError(error.message || "Could not create the tournament.");
  } finally {
    submit.disabled = false;
  }
}

async function submitAddEntry(event) {
  event.preventDefault();
  const input = $("tournament-add-entry-name");
  const submit = $("tournament-add-entry-submit");
  const displayName = String(input?.value || "").trim();
  if (!displayName) {
    setMessage("Enter a player name.", true);
    input?.focus();
    return;
  }
  if (!tournament) return;
  submit.disabled = true;
  try {
    await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/entries`, {
      method: "POST",
      body: JSON.stringify({ displayName }),
    });
    await loadEntries();
    setMessage("");
  } catch (error) {
    setMessage(error.message || "Could not add player.", true);
  } finally {
    if (submit.isConnected) submit.disabled = false;
  }
}

// ---- Live entries refresh -----------------------------------------------
//
// The socket below is a low-latency hint to refetch chat entries, and the
// 15s poll above is the fallback when the socket is unavailable.

async function refreshEntriesSoon() {
  entriesRefreshQueued = true;
  clearTimeout(entriesRefreshTimer);
  entriesRefreshTimer = setTimeout(async () => {
    entriesRefreshTimer = null;
    if (entriesRefreshRunning || !entriesRefreshQueued) return;
    entriesRefreshQueued = false;
    entriesRefreshRunning = true;
    try {
      await loadEntries();
    } catch (error) {
      setMessage(error.message || "Could not refresh entries.", true);
    } finally {
      entriesRefreshRunning = false;
      if (entriesRefreshQueued) refreshEntriesSoon();
    }
  }, 180);
}

function reportChatFailure(error) {
  console.error("[tournaments] live Kick chat connection failed:", error?.message || error);
  setMessage("Live chat updates are unavailable. Chat entries are still saved; they appear when the entry list refreshes.", true);
}

async function startChat() {
  if (!tournament || tournament.signup_state !== "open" || chatConnection) return;
  const channel = String(tournament.chat_channel || "").trim();
  if (!channel) return;
  try {
    const response = await fetch(`/api/giveaways/chatroom?channel=${encodeURIComponent(channel)}`);
    const data = await response.json();
    if (!response.ok || !data.chatroomId) throw new Error(data.error || "Could not find that Kick channel.");
    chatConnection = connectKickChat({
      chatroomId: data.chatroomId,
      onError: (error) => {
        chatConnection = null;
        reportChatFailure(error);
      },
      onClose: () => { chatConnection = null; },
      onMessage: handleChatMessage,
    });
  } catch (error) {
    chatConnection = null;
    reportChatFailure(error);
  }
}

function handleChatMessage(chatData) {
  const content = String(chatData?.content || "").trim();
  if (!content) return;
  const keyword = String(tournament?.entry_keyword || "!join").toLowerCase();
  if (content.split(/\s+/)[0].toLowerCase() === keyword) refreshEntriesSoon();
}

// ---- Lifecycle actions ---------------------------------------------------

function requireChatChannel() {
  if (String(tournament?.chat_channel || "").trim()) return true;
  setMessage("Add your Kick channel in Settings before opening signups.", true);
  switchTab("settings");
  $("tournament-chat-channel")?.focus();
  return false;
}

function currentSeeding() {
  return document.querySelector('input[name="tournament-seeding"]:checked')?.value === "shuffle"
    ? "shuffle"
    : "signup";
}

async function toggleChatSignup(input) {
  if (!tournament || !input) return;
  const opening = input.checked;
  if (opening && !requireChatChannel()) {
    input.checked = false;
    return;
  }
  input.disabled = true;
  let data;
  try {
    data = await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/signups/${opening ? "open" : "lock"}`, {
      method: "POST",
      body: "{}",
    });
  } catch (error) {
    input.checked = !opening;
    setMessage(error.message || `Could not ${opening ? "open" : "close"} signups.`, true);
    return;
  } finally {
    input.disabled = false;
  }
  stopChat();
  await loadTournament();
  if (opening) await startChat();
  setMessage(data.message);
}

async function handlePrimary() {
  if (!tournament) return openCreateModal();
  const start = tournamentState?.start;
  if (!start?.allowed) return;
  if (start.needs_selection) return openSelectModal();
  if (start.confirm && !await showConfirmModal("Start tournament", start.confirm, "Start tournament", true)) return;
  try {
    await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/entries/select`, {
      method: "POST",
      body: JSON.stringify({ mode: "all", seeding: currentSeeding() }),
    });
  } catch (error) {
    setMessage(error.message || "Could not start the tournament.", true);
    return;
  }
  stopChat();
  activeTab = "bracket";
  await loadEntries({ refreshOnly: false });
}

// ---- Select participants dialog -------------------------------------------

// Manual picks survive search filtering, which re-renders the checkbox list.
const manualSelection = new Set();

function setSelectError(text = "") {
  const el = $("tournament-select-error");
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
}

function selectedIds() {
  return [...manualSelection];
}

function toggleManualSelection(box) {
  if (box.checked) manualSelection.add(box.value);
  else manualSelection.delete(box.value);
  updateSelectCounter();
}

function updateSelectCounter() {
  const cap = tournament?.bracket_size || 0;
  const count = selectedIds().length;
  $("ts-counter").textContent = `Selected ${count} / ${cap}`;
  $("tournament-select-submit").disabled =
    $("ts-mode-manual").checked && count !== cap;
}

function renderSelectList() {
  $("ts-entry-list").innerHTML = selectListHtml(entries, manualSelection, $("ts-search").value);
}

function selectFirstEligible() {
  const cap = Number(tournament?.bracket_size) || 0;
  manualSelection.clear();
  for (const entry of entries) {
    if (entry.eligible === true && Number(entry.eligible_rank) > 0 && Number(entry.eligible_rank) <= cap) {
      manualSelection.add(entry.id);
    }
  }
  renderSelectList();
  updateSelectCounter();
}

function syncSelectMode() {
  const manual = $("ts-mode-manual").checked;
  $("ts-pane-random").hidden = manual;
  $("ts-pane-manual").hidden = !manual;
  updateSelectCounter();
}

async function openSelectModal() {
  if (!tournament || $("tournament-select-modal")) return;
  const modal = mountDialog(selectDialogHtml({ cap: tournament.bracket_size || 0, eligible: entryCounts.eligible || 0 }));
  if (!modal) return;
  manualSelection.clear();
  renderSelectList();
  syncSelectMode();
  setSelectError("");
  document.documentElement.classList.add("yr-modal-open");
  const dialog = await ensureDialog().catch(() => null);
  if (!modal.isConnected) return;
  releaseSelectTrap = dialog ? dialog.trap(modal, closeSelectModal) : null;
  $("ts-mode-random")?.focus();
}

function closeSelectModal() {
  const modal = $("tournament-select-modal");
  if (!modal) return;
  unmountDialog(modal);
  if (releaseSelectTrap) releaseSelectTrap();
  releaseSelectTrap = null;
}

async function submitSelect() {
  const submit = $("tournament-select-submit");
  const seeding = currentSeeding();
  const body = $("ts-mode-manual").checked
    ? { mode: "manual", entryIds: selectedIds(), seeding }
    : { mode: "random", seeding };
  submit.disabled = true;
  setSelectError("");
  try {
    await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/entries/select`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    closeSelectModal();
    stopChat();
    activeTab = "bracket";
    await loadEntries();
  } catch (error) {
    setSelectError(error.message || "Could not create the bracket.");
  } finally {
    submit.disabled = false;
  }
}

async function handleEntryAction(button) {
  const action = button.dataset.entryAction;
  const entryId = encodeURIComponent(button.dataset.entryId || "");
  if (!action || !entryId) return;
  await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/entries/${entryId}/${action}`, {
    method: "POST",
    body: "{}",
  });
  await loadEntries();
  setMessage("");
}

// ---- Full-bracket dialog ---------------------------------------------------

async function openBracketModal() {
  if (!tournament || $("tournament-bracket-modal")) return;
  const modal = mountDialog(fullBracketDialogHtml());
  const full = $("tournament-bracket-full");
  if (!modal || !full) return;
  renderExpandedBracket(full);
  document.documentElement.classList.add("yr-modal-open");
  const dialog = await ensureDialog().catch(() => null);
  // The dialog script can resolve after leave() or a manual close: never
  // install a trap on a dialog that is already gone.
  if (!modal.isConnected || $("tournament-bracket-modal") !== modal) return;
  releaseBracketTrap = dialog ? dialog.trap(modal, closeBracketModal) : null;
  $("tournament-bracket-close")?.focus();
}

function renderExpandedBracket(full = $("tournament-bracket-full")) {
  if (!full || !$("tournament-bracket-modal")) return;
  disposeExpandedLayout();
  full.innerHTML = bracketViewHtml({ tournament, matches, lifecycle: currentLifecycle(), mode: "expanded" });
  disposeExpandedLayout = layoutBracket(full);
}

function closeBracketModal() {
  const modal = $("tournament-bracket-modal");
  if (!modal) return;
  unmountDialog(modal);
  if (releaseBracketTrap) releaseBracketTrap();
  releaseBracketTrap = null;
  disposeExpandedLayout();
  disposeExpandedLayout = () => {};
}

async function submitScore(matchId, target) {
  const matchEl = target.closest(".tn-match");
  if (!matchEl) return;
  const p1Input = matchEl.querySelector('[data-score-player="1"]');
  const p2Input = matchEl.querySelector('[data-score-player="2"]');
  const player1Score = parseInt(p1Input?.value, 10) || 0;
  const player2Score = parseInt(p2Input?.value, 10) || 0;
  if (player1Score === player2Score) {
    setMessage("A match cannot end in a tie. Enter different scores.", true);
    return;
  }
  const correcting = matchEl.dataset.scoreMode === "correct";
  const data = await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/score`, {
    method: correcting ? "PATCH" : "POST",
    body: JSON.stringify({ matchId, player1Score, player2Score }),
  });
  if (correcting) await loadEntries();
  else await loadTournament();
  setMessage(data?.message || "");
}

async function advanceMatch(button) {
  const matchId = button.dataset.advanceMatch;
  const requestKey = `${tournament.id}:${matchId}`;
  if (advanceMatchRequests.has(requestKey)) return;
  advanceMatchRequests.add(requestKey);
  syncAdvanceButtons();
  try {
    const data = await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/score`, {
      method: "POST",
      body: JSON.stringify({
        matchId,
        winnerSlot: Number(button.dataset.winnerSlot),
      }),
    });
    await loadTournament();
    setMessage(data.message);
  } finally {
    advanceMatchRequests.delete(requestKey);
    syncAdvanceButtons();
  }
}

function syncAdvanceButtons(root = $("tournament-root")) {
  root?.querySelectorAll("button[data-advance-match]").forEach((button) => {
    button.disabled = advanceMatchRequests.has(`${tournament?.id}:${button.dataset.advanceMatch}`);
  });
}

// ---- Settings ------------------------------------------------------------

function setFieldError(inputId, message = "", fix = null) {
  const el = $(`${inputId}-error`);
  if (!el) return;
  el.replaceChildren();
  el.append(document.createTextNode(message));
  if (fix) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = "tournament-settings-fix";
    button.className = "btn btn--sm btn--ghost tn-settings-fix";
    button.textContent = fix.label;
    el.append(document.createTextNode(" "), button);
    settingsFix = fix;
  }
  el.hidden = !message;
  el.closest(".field")?.classList.toggle("has-error", Boolean(message));
}

function clearFieldErrors() {
  const form = $("tournament-settings-form");
  if (!form) return;
  for (const el of form.querySelectorAll(".field-error")) {
    el.replaceChildren();
    el.hidden = true;
    el.closest(".field")?.classList.remove("has-error");
  }
  settingsFix = null;
}

function settingsSnapshot() {
  const el = (id) => $(id);
  if (!el("tournament-title")) return "";
  return JSON.stringify({
    title: el("tournament-title").value,
    game: el("tournament-game").value,
    keyword: el("tournament-keyword").value,
    capMode: el("tournament-entry-cap-mode").value,
    cap: el("tournament-entry-cap").value,
    channel: el("tournament-chat-channel").value,
    waitlist: el("tournament-waitlist").checked,
    bracketSize: el("tournament-bracket-size").value,
  });
}

function updateDirty() {
  const bar = $("tournament-settings-bar");
  if (bar) bar.hidden = settingsReadonly || settingsSnapshot() === settingsBaseline;
}

async function saveSettingsBody(body) {
  if (settingsReadonly) return;
  clearFieldErrors();
  lastSettingsBody = { ...body };
  try {
    await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/settings`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (error) {
    const data = error.data || {};
    const inputByField = {
      title: "tournament-title",
      bracketSize: "tournament-bracket-size",
      entryCap: "tournament-entry-cap",
      chatChannel: "tournament-chat-channel",
    };
    const inputId = inputByField[data.field];
    if (inputId) setFieldError(inputId, data.error || error.message, data.fix || null);
    else setMessage(data.error || error.message || "Could not save settings.", true);
    return;
  }
  const wasOpen = tournament.signup_state === "open";
  stopChat();
  await loadTournament();
  if (wasOpen && tournament.signup_state === "open") await startChat();
  const saved = $("tournament-settings-saved");
  if (saved) {
    saved.hidden = false;
    clearTimeout(settingsSavedTimer);
    settingsSavedTimer = setTimeout(() => { saved.hidden = true; }, 2500);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  if (settingsReadonly) return;
  clearFieldErrors();
  const capMode = $("tournament-entry-cap-mode").value;
  let entryCap = capMode;
  if (capMode === "custom") {
    entryCap = parseInt($("tournament-entry-cap").value, 10);
    if (!Number.isInteger(entryCap) || entryCap < 1) {
      setFieldError("tournament-entry-cap", "Enter a signup limit of at least 1, or choose Unlimited.");
      return;
    }
  }
  const body = {
    title: $("tournament-title").value.trim(),
    gameName: $("tournament-game").value.trim(),
    entryCap,
    entryKeyword: $("tournament-keyword").value.trim() || "!join",
    waitlistEnabled: $("tournament-waitlist").checked,
    chatChannel: $("tournament-chat-channel").value.trim(),
  };
  if (!$("tournament-bracket-size").disabled) body.bracketSize = parseInt($("tournament-bracket-size").value, 10);
  await saveSettingsBody(body);
}

async function retrySettingsFix() {
  if (!settingsFix || !lastSettingsBody) return;
  const body = { ...lastSettingsBody, ...settingsFix.settings };
  await saveSettingsBody(body);
}

// ---- Boot ----------------------------------------------------------------

export async function boot(token = lifecycleToken) {
  if (!$("tournament-app")) return;
  ensureDocListeners();
  // A re-enter starts clean: drop any timers/chat left by a previous visit.
  resetTransientState();
  try {
    const shell = await loadBoardShell();
    if (token !== lifecycleToken) return;
    siteId = shell.activeSiteId || "";
    board = shell.board || {};
    await loadTournament();
    if (token !== lifecycleToken) return;
    await startChat();
    if (consumeNewQuery()) await openCreateModal();
  } catch (error) {
    if (token !== lifecycleToken) return;
    render();
    setMessage(error.message || "Tournament unavailable. Try again in a moment.", true);
  }
}

function consumeNewQuery() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("new") !== "1") return false;
  url.searchParams.delete("new");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  return true;
}

// Drop timers, sockets, dialogs and cached data so leave() fully detaches the
// workspace and a later enter() rebuilds it from scratch.
function resetTransientState() {
  stopChat();
  if (entriesPollTimer) { clearInterval(entriesPollTimer); entriesPollTimer = null; }
  if (entriesRefreshTimer) { clearTimeout(entriesRefreshTimer); entriesRefreshTimer = null; }
  if (settingsSavedTimer) { clearTimeout(settingsSavedTimer); settingsSavedTimer = null; }
  entriesRefreshRunning = false;
  entriesRefreshQueued = false;
  closeCreateModal();
  closeDeleteModal();
  closeSelectModal();
  closeBracketModal();
  disposeEmbeddedLayout();
  disposeExpandedLayout();
  disposeEmbeddedLayout = () => {};
  disposeExpandedLayout = () => {};
  document.querySelectorAll("details.tn-menu[open]").forEach((menu) => { menu.open = false; });
  const host = $("tournament-dialogs");
  if (host) host.innerHTML = "";
  // The dialog markup may already be gone when a leave races a fragment swap;
  // release any lingering focus traps and unlock the page scroll regardless.
  if (releaseCreateTrap || releaseDeleteTrap || releaseSelectTrap || releaseBracketTrap) {
    releaseCreateTrap?.();
    releaseDeleteTrap?.();
    releaseSelectTrap?.();
    releaseBracketTrap?.();
    releaseCreateTrap = null;
    releaseDeleteTrap = null;
    releaseSelectTrap = null;
    releaseBracketTrap = null;
  }
  document.documentElement.classList.remove("yr-modal-open");
  tournament = null;
  tournaments = [];
  selectedId = "";
  tournamentState = null;
  entries = [];
  matches = [];
  entryCounts = { active: 0, eligible: 0, waitlist: 0, removed: 0, blocked: 0, inactive: 0 };
  chatRegistration = null;
  tournamentsEnabled = true;
  activeTab = "entries";
  board = {};
  siteId = "";
  settingsBaseline = "";
  settingsReadonly = false;
  duplicateProtectionInFlight = false;
  duplicateProtectionPending = null;
  lastSettingsBody = null;
  settingsFix = null;
}

export function enter() {
  const token = ++lifecycleToken;
  return boot(token);
}

export function leave() {
  lifecycleToken += 1;
  resetTransientState();
}

// Delegated listeners attach to the document that actually hosts
// #tournament-app, not the module-eval-time global: a host (or test) may
// evaluate this module while another document is current, and a listener
// bound to the wrong document never fires. One binding per document.
const listenerDocs = new WeakSet();
function ensureDocListeners() {
  const doc = $("tournament-app")?.ownerDocument;
  if (!doc || listenerDocs.has(doc)) return;
  listenerDocs.add(doc);
  doc.addEventListener("submit", onSubmit);
  doc.addEventListener("change", onChange);
  doc.addEventListener("input", onInput);
  doc.addEventListener("click", onClick);
  doc.addEventListener("yr:quick-new", onQuickNew);
}

function onSubmit(event) {
  if (!$("tournament-app")) return;
  if (event.target.id === "tournament-create-form") {
    submitCreate(event).catch((error) => setCreateError(error.message || "Could not create the tournament."));
  } else if (event.target.id === "tournament-delete-form") {
    submitDelete(event).catch((error) => {
      const message = $("tournament-delete-error");
      if (message) {
        message.textContent = error.message || "Could not delete the tournament.";
        message.hidden = false;
      }
    });
  } else if (event.target.id === "tournament-add-entry-form") {
    submitAddEntry(event).catch((error) => setMessage(error.message || "Could not add player.", true));
  } else if (event.target.id === "tournament-settings-form") {
    event.preventDefault();
    saveSettings(event).catch((error) => setMessage(error.message || "Could not save settings.", true));
  }
}

function onQuickNew(event) {
  if (!$("tournament-app")) return;
  const kind = event.detail?.kind;
  if (kind === "tournament") {
    event.preventDefault();
    openCreateModal().catch((error) => setMessage(error.message || "Could not open the tournament form.", true));
    return;
  }
  if (kind !== "player") return;
  event.preventDefault();
  if (!tournament) {
    openCreateModal().catch((error) => setMessage(error.message || "Could not open the tournament form.", true));
    return;
  }
  const addEntry = tournamentState?.add_entry;
  if (addEntry?.enabled) {
    switchTab("entries");
    $("tournament-add-entry-name")?.focus();
  } else {
    setMessage(addEntry?.note || addEntry?.unavailable_reason || "", true);
  }
}

function onChange(event) {
  if (event.target.name === "tournament-select-mode") return syncSelectMode();
  if (event.target.closest?.("#ts-entry-list")) return toggleManualSelection(event.target);
  if (event.target.id === "tournament-chat-signup") {
    toggleChatSignup(event.target).catch((error) => setMessage(error.message || "Could not update signups.", true));
    return;
  }
  if (event.target.id === "tournament-dup-protection") {
    if (duplicateProtectionInFlight) {
      event.target.checked = duplicateProtectionPending ?? (tournament?.anti_alt_enabled === true);
      event.target.disabled = true;
      return;
    }
    toggleDuplicateProtection(event.target).catch((error) => setMessage(error.message || "Could not update duplicate protection.", true));
    return;
  }
  if (event.target.id === "tc-entry-cap") {
    const custom = $("tc-entry-cap-custom");
    custom.hidden = event.target.value !== "custom";
    if (!custom.hidden) custom.focus();
  }
  if (event.target.id === "tc-bracket-size") {
    const opt = $("tc-entry-cap")?.querySelector('option[value="bracket"]');
    if (opt) opt.textContent = `Same as bracket size (${event.target.value})`;
  }
  if (event.target.id === "tournament-entry-cap-mode") {
    const cap = $("tournament-entry-cap");
    cap.hidden = event.target.value !== "custom";
    if (!cap.hidden) cap.focus();
  }
  if (event.target.id === "tournament-bracket-size") {
    const opt = $("tournament-entry-cap-mode")?.querySelector('option[value="bracket"]');
    if (opt) opt.textContent = `Same as bracket size (${event.target.value})`;
  }
  if (event.target.closest?.("#tournament-settings-form")) updateDirty();
}

// Duplicate protection saves immediately — it lives in the Entries header, not
// in the deferred-save Settings form.
async function toggleDuplicateProtection(input) {
  if (!tournament || !input || duplicateProtectionInFlight) return;
  const previous = tournament.anti_alt_enabled === true;
  const enabled = input.checked;
  duplicateProtectionInFlight = true;
  duplicateProtectionPending = enabled;
  input.disabled = true;
  let persisted = false;
  try {
    const data = await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/settings`, {
      method: "POST",
      body: JSON.stringify({ antiAltEnabled: enabled }),
    });
    tournament.anti_alt_enabled = data.tournament.anti_alt_enabled;
    persisted = true;
    await loadEntries();
    setMessage(data.message);
  } catch (error) {
    if (!persisted) tournament.anti_alt_enabled = previous;
    const currentInput = $("tournament-dup-protection");
    if (currentInput) {
      currentInput.checked = persisted ? tournament.anti_alt_enabled === true : previous;
      currentInput.disabled = false;
    }
    setMessage(error.data?.error || error.message || "Could not update duplicate protection.", true);
  } finally {
    duplicateProtectionPending = null;
    duplicateProtectionInFlight = false;
    const currentInput = $("tournament-dup-protection");
    if (currentInput) {
      currentInput.checked = tournament?.anti_alt_enabled === true;
      currentInput.disabled = false;
    }
  }
}

function onInput(event) {
  if (event.target.id === "ts-search") return renderSelectList();
  if (event.target.id === "td-confirm") return updateDeleteSubmit();
  // A correction card's Save + note stay inert until a score differs from the
  // saved values recorded on the card.
  const scoreInput = event.target.closest?.(".tn-match-input");
  if (scoreInput) {
    const card = scoreInput.closest(".tn-match");
    if (card?.dataset.scoreMode === "correct") {
      const saved = (card.dataset.saved || "").split(",");
      const differs = card.querySelector('[data-score-player="1"]')?.value !== saved[0]
        || card.querySelector('[data-score-player="2"]')?.value !== saved[1];
      const save = card.querySelector(".tn-match-save");
      if (save) save.disabled = !differs;
      const note = card.querySelector(".tn-match-note");
      if (note) note.hidden = !differs;
    }
  }
  if (event.target.closest?.("#tournament-settings-form")) updateDirty();
}

async function onClick(event) {
  if ($("tournament-app")) {
    const doc = event.target.ownerDocument || document;
    if (!event.target.closest?.("details.tn-menu")) {
      doc.querySelectorAll("#tournament-app details.tn-menu[open]").forEach((menu) => { menu.open = false; });
    }
    if (!event.target.closest?.("details.tn-switcher")) {
      doc.querySelectorAll("#tournament-app details.tn-switcher[open]").forEach((menu) => { menu.open = false; });
    }
  }
  const target = event.target.closest?.(
    "#tournament-primary, #tournament-new, #tournament-create, #tournament-create-cancel, #tournament-create-modal, #tournament-settings-discard, #tournament-settings-fix, #tournament-select-modal, #tournament-select-cancel, #tournament-select-submit, #ts-select-first, #tournament-bracket-expand, #tournament-bracket-close, #tournament-bracket-modal, #tournament-delete, #tournament-delete-cancel, #tournament-delete-modal, #tournament-use-channel, [data-tournament-tab], [data-tournament-switch], [data-entry-action], button[data-advance-match], button[data-score-match]"
  );
  if (!target || !$("tournament-app")) return;
  if (target.id === "tournament-create-modal") {
    if (event.target === target) closeCreateModal();
    return;
  }
  if (target.id === "tournament-select-modal") {
    if (event.target === target) closeSelectModal();
    return;
  }
  if (target.id === "tournament-bracket-modal") {
    if (event.target === target) closeBracketModal();
    return;
  }
  if (target.id === "tournament-delete-modal") {
    if (event.target === target) closeDeleteModal();
    return;
  }
  event.preventDefault();
  try {
    if (target.matches("[data-tournament-tab]")) return switchTab(target.dataset.tournamentTab);
    if (target.matches("[data-tournament-switch]")) return await switchTournament(target.dataset.tournamentSwitch);
    if (target.matches("[data-entry-action]")) {
      target.closest("details.tn-menu")?.removeAttribute("open");
      return await handleEntryAction(target);
    }
    if (target.matches("button[data-advance-match]")) return await advanceMatch(target);
    if (target.matches("button[data-score-match]")) return await submitScore(target.dataset.scoreMatch, target);
    if (target.id === "ts-select-first") return selectFirstEligible();
    if (target.id === "tournament-delete") return await openDeleteModal();
    if (target.id === "tournament-delete-cancel") return closeDeleteModal();
    if (target.id === "tournament-settings-fix") return await retrySettingsFix();
    if (target.id === "tournament-use-channel") {
      const channelName = target.dataset.channel;
      if (channelName) {
        await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/settings`, {
          method: "POST",
          body: JSON.stringify({ chatChannel: channelName }),
        });
        setMessage("");
        return await loadTournament();
      }
      switchTab("settings");
      return $("tournament-chat-channel")?.focus();
    }
    if (target.id === "tournament-create" || target.id === "tournament-new") return await openCreateModal();
    if (target.id === "tournament-create-cancel") return closeCreateModal();
    if (target.id === "tournament-select-cancel") return closeSelectModal();
    if (target.id === "tournament-select-submit") return await submitSelect();
    if (target.id === "tournament-bracket-expand") return await openBracketModal();
    if (target.id === "tournament-bracket-close") return closeBracketModal();
    if (target.id === "tournament-settings-discard") {
      render();
      return clearFieldErrors();
    }
    if (target.id === "tournament-primary") return await handlePrimary();
  } catch (error) {
    setMessage(error.message || "Action failed.", true);
  }
}

if (!window.__yrSpaShell) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => enter(), { once: true });
  else enter();
}
