import { loadBoardShell } from "./dashboard/board-shell.js";
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
let entryCounts = { active: 0, eligible: 0, waitlist: 0, removed: 0, blocked: 0 };
let matches = [];
let activeTab = "entries";
let chatConnection = null;
let chatRegistration = null;
let entriesPollTimer = null;
let entriesRefreshTimer = null;
let entriesRefreshRunning = false;
let entriesRefreshQueued = false;
let releaseCreateTrap = null;
let releaseSelectTrap = null;
let releaseBracketTrap = null;
// The bracket layouts own ResizeObservers; dispose before every re-render and
// on leave() so they never accumulate.
let disposeEmbeddedLayout = () => {};
let disposeExpandedLayout = () => {};
let settingsBaseline = "";
let settingsSavedTimer = null;
let settingsReadonly = false;
// Match id whose completed card is being re-scored via PATCH; null = off.
let correctingMatchId = null;

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
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

// The lifecycle is derived from the fields the server already stores; nothing
// here is persisted separately.
export function lifecycleOf(tourn, matchCount = 0) {
  if (!tourn) return "none";
  if (tourn.status === "completed") return "completed";
  if (tourn.status === "cancelled") return "cancelled";
  if (matchCount > 0) return "bracket";
  if (tourn.signup_state === "open") return "signups_open";
  if (tourn.signup_state === "locked") return "signups_locked";
  return "draft";
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

// Entries are created by the webhook; poll so they appear without the socket.
function updateEntriesPolling(lifecycle) {
  if (lifecycle === "signups_open") {
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
  const lifecycle = lifecycleOf(tournament, matches.length);
  updateEntriesPolling(lifecycle);
  const vm = buildViewModel({ tournament, entries, entryCounts, matches, lifecycle, chatRegistration, board, activeTab });
  disposeEmbeddedLayout();
  disposeEmbeddedLayout = () => {};
  if (!tournament) {
    root.innerHTML = emptyStateHtml();
    return;
  }
  root.innerHTML = workspaceHtml(
    vm,
    vm.hasMatches ? bracketViewHtml({ tournament, matches, lifecycle, mode: "embedded", correctingId: correctingMatchId }) : ""
  );
  const bracket = $("tournament-bracket");
  disposeEmbeddedLayout = bracket && !bracket.hidden ? layoutBracket(bracket) : () => {};
  settingsReadonly = vm.finished;
  settingsBaseline = settingsSnapshot();
  updateDirty();
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
  entryCounts = entryData.counts || { active: 0, eligible: 0, waitlist: 0, removed: 0, blocked: 0 };
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
    const vm = buildViewModel({ tournament, entries, entryCounts, matches, lifecycle: lifecycleOf(tournament, matches.length), chatRegistration, board, activeTab });
    const list = $("tournament-entry-list");
    if (list) list.innerHTML = entryRowsHtml(vm);
    const count = $("tournament-count");
    if (count) count.textContent = vm.stats[0].value;
    const entriesTab = $("tournament-tab-entries");
    if (entriesTab) entriesTab.textContent = `Entries (${vm.activeCount})`;
    updateBracketStatus();
    return;
  }
  render();
  updateBracketStatus();
}

async function loadTournament() {
  const data = await api("/api/tournaments");
  chatRegistration = data.chatRegistration || null;
  const tournaments = data.tournaments || [];
  // Prefer an unfinished tournament, but keep a completed/cancelled one visible
  // so the bracket and champion survive reload/back navigation.
  const current = tournaments.find((item) => !["completed", "cancelled"].includes(item.status));
  tournament = current || tournaments[0] || null;
  entries = [];
  matches = [];
  if (tournament) await loadEntries({ refreshOnly: false });
  else render();
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
  if ($("tournament-create-modal")) return;
  const modal = mountDialog(createDialogHtml({ chatChannel: tournament?.chat_channel, siteChannel: board.kickChannelName }));
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

export function readCreateForm() {
  const bracketSize = parseInt($("tc-bracket-size").value, 10);
  if (!SUPPORTED_BRACKET_SIZES.includes(bracketSize)) {
    return { error: `Bracket size must be one of ${SUPPORTED_BRACKET_SIZES.join(", ")}.` };
  }
  let entryCap = null;
  if ($("tc-entry-cap").value === "custom") {
    entryCap = parseInt($("tc-entry-cap-custom").value, 10);
    if (!Number.isInteger(entryCap) || entryCap < 1) return { error: "Enter a signup limit of at least 1, or choose Unlimited." };
  }
  return {
    body: {
      siteId,
      title: $("tc-title").value.trim() || "Community Tournament",
      gameName: $("tc-game").value.trim() || "Game",
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
    tournament = data.tournament;
    entries = [];
    entryCounts = { active: 0, eligible: 0, waitlist: 0, removed: 0, blocked: 0 };
    matches = [];
    activeTab = "entries";
    closeCreateModal();
    setMessage("");
    render();
    await loadEntries();
  } catch (error) {
    setCreateError(error.message || "Could not create the tournament.");
  } finally {
    submit.disabled = false;
  }
}

// ---- Live entries refresh -----------------------------------------------
//
// Entries are created server-side by the Kick chat webhook; the socket below
// is only a low-latency hint to refetch, and the 15s poll above is the
// fallback when the socket is unavailable.

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
      onError: () => { chatConnection = null; },
      onClose: () => { chatConnection = null; },
      onMessage: handleChatMessage,
    });
  } catch {
    chatConnection = null;
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

async function openSignups() {
  if (!tournament || !requireChatChannel()) return;
  try {
    await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/signups/open`, { method: "POST", body: "{}" });
  } catch (error) {
    setMessage(error.message || "Could not open signups.", true);
    return;
  }
  setMessage("");
  await loadTournament();
  return startChat();
}

async function handlePrimary() {
  if (!tournament) return openCreateModal();
  const action = $("tournament-primary").dataset.action;
  if (action === "add-channel") {
    switchTab("settings");
    $("tournament-chat-channel")?.focus();
    return;
  }
  if (action === "use-site-channel") {
    await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/settings`, {
      method: "POST",
      body: JSON.stringify({ chatChannel: board.kickChannelName }),
    });
    setMessage("");
    await loadTournament();
    return;
  }
  if (action === "open") return openSignups();
  if (action === "lock") {
    await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/signups/lock`, { method: "POST", body: "{}" });
    stopChat();
    return loadTournament();
  }
  if (action === "create-bracket") {
    const eligible = entryCounts.eligible || 0;
    if (!await showConfirmModal(
      "Create bracket",
      `Create the bracket with ${eligible} players? Players will be randomly placed in the bracket. This cannot be undone.`,
      "Create bracket",
      true
    )) return;
    await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/entries/select`, {
      method: "POST",
      body: JSON.stringify({ mode: "random" }),
    });
    activeTab = "bracket";
    await loadEntries();
  }
  if (action === "select-participants") return openSelectModal();
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
  const body = $("ts-mode-manual").checked
    ? { mode: "manual", entryIds: selectedIds() }
    : { mode: "random" };
  submit.disabled = true;
  setSelectError("");
  try {
    await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/entries/select`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    closeSelectModal();
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
  full.innerHTML = bracketViewHtml({ tournament, matches, lifecycle: lifecycleOf(tournament, matches.length), mode: "expanded", correctingId: correctingMatchId });
  disposeExpandedLayout = layoutBracket(full);
}

function startScoreCorrection(matchId) {
  correctingMatchId = matchId;
  render();
  renderExpandedBracket();
}

function cancelScoreCorrection() {
  correctingMatchId = null;
  render();
  renderExpandedBracket();
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
  correctingMatchId = null;
  if (correcting) await loadEntries();
  else await loadTournament();
  setMessage(data?.message || "");
}

// ---- Settings ------------------------------------------------------------

function setFieldError(inputId, message = "") {
  const el = $(`${inputId}-error`);
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
  el.closest(".field")?.classList.toggle("has-error", Boolean(message));
}

function clearFieldErrors() {
  const form = $("tournament-settings-form");
  if (!form) return;
  for (const el of form.querySelectorAll(".field-error")) {
    el.textContent = "";
    el.hidden = true;
    el.closest(".field")?.classList.remove("has-error");
  }
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
    antiAlt: el("tournament-anti-alt").checked,
    bracketSize: el("tournament-bracket-size").value,
  });
}

function updateDirty() {
  const bar = $("tournament-settings-bar");
  if (bar) bar.hidden = settingsReadonly || settingsSnapshot() === settingsBaseline;
}

async function saveSettings(event) {
  event.preventDefault();
  if (settingsReadonly) return;
  clearFieldErrors();
  const capMode = $("tournament-entry-cap-mode").value;
  let entryCap = null;
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
    antiAltEnabled: $("tournament-anti-alt").checked,
    chatChannel: $("tournament-chat-channel").value.trim(),
  };
  // Locked fields are disabled in the form and never sent, so the server
  // never has to refuse a change the UI already explained.
  if (!$("tournament-bracket-size").disabled) body.bracketSize = parseInt($("tournament-bracket-size").value, 10);
  try {
    await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/settings`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (error) {
    const m = error.message || "";
    if (/bracket size/i.test(m)) setFieldError("tournament-bracket-size", m);
    else if (/signup limit|entry cap|entryCap/i.test(m)) setFieldError("tournament-entry-cap", m);
    else setMessage(m || "Could not save settings.", true);
    return;
  }
  const wasOpen = tournament.signup_state === "open";
  await loadTournament();
  if (wasOpen && tournament.signup_state === "open") {
    stopChat();
    await startChat();
  }
  const saved = $("tournament-settings-saved");
  if (saved) {
    saved.hidden = false;
    clearTimeout(settingsSavedTimer);
    settingsSavedTimer = setTimeout(() => { saved.hidden = true; }, 2500);
  }
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
  } catch (error) {
    if (token !== lifecycleToken) return;
    render();
    setMessage(error.message || "Tournament unavailable. Try again in a moment.", true);
  }
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
  correctingMatchId = null;
  closeCreateModal();
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
  if (releaseCreateTrap || releaseSelectTrap || releaseBracketTrap) {
    releaseCreateTrap?.();
    releaseSelectTrap?.();
    releaseBracketTrap?.();
    releaseCreateTrap = null;
    releaseSelectTrap = null;
    releaseBracketTrap = null;
  }
  document.documentElement.classList.remove("yr-modal-open");
  tournament = null;
  entries = [];
  matches = [];
  entryCounts = { active: 0, eligible: 0, waitlist: 0, removed: 0, blocked: 0 };
  chatRegistration = null;
  activeTab = "entries";
  board = {};
  siteId = "";
  settingsBaseline = "";
  settingsReadonly = false;
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
}

function onSubmit(event) {
  if (!$("tournament-app")) return;
  if (event.target.id === "tournament-create-form") {
    submitCreate(event).catch((error) => setCreateError(error.message || "Could not create the tournament."));
  } else if (event.target.id === "tournament-settings-form") {
    event.preventDefault();
    saveSettings(event).catch((error) => setMessage(error.message || "Could not save settings.", true));
  }
}

function onChange(event) {
  if (event.target.name === "tournament-select-mode") return syncSelectMode();
  if (event.target.closest?.("#ts-entry-list")) return toggleManualSelection(event.target);
  if (event.target.id === "tc-entry-cap") {
    const custom = $("tc-entry-cap-custom");
    custom.hidden = event.target.value !== "custom";
    if (!custom.hidden) custom.focus();
  }
  if (event.target.id === "tournament-entry-cap-mode") {
    const cap = $("tournament-entry-cap");
    cap.hidden = event.target.value !== "custom";
    if (!cap.hidden) cap.focus();
  }
  if (event.target.closest?.("#tournament-settings-form")) updateDirty();
}

function onInput(event) {
  if (event.target.id === "ts-search") return renderSelectList();
  if (event.target.closest?.("#tournament-settings-form")) updateDirty();
}

async function onClick(event) {
  if ($("tournament-app") && !event.target.closest?.("details.tn-menu")) {
    (event.target.ownerDocument || document).querySelectorAll("#tournament-app details.tn-menu[open]").forEach((menu) => { menu.open = false; });
  }
  const target = event.target.closest?.(
    "#tournament-primary, #tournament-reopen, #tournament-new, #tournament-create, #tournament-create-cancel, #tournament-create-modal, #tournament-settings-discard, #tournament-select-modal, #tournament-select-cancel, #tournament-select-submit, #tournament-bracket-expand, #tournament-bracket-close, #tournament-bracket-modal, [data-tournament-tab], [data-entry-action], button[data-score-match], [data-score-edit], [data-score-cancel]"
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
  event.preventDefault();
  try {
    if (target.matches("[data-tournament-tab]")) return switchTab(target.dataset.tournamentTab);
    if (target.matches("[data-entry-action]")) {
      target.closest("details.tn-menu")?.removeAttribute("open");
      return await handleEntryAction(target);
    }
    if (target.matches("[data-score-edit]")) return startScoreCorrection(target.dataset.scoreEdit);
    if (target.matches("[data-score-cancel]")) return cancelScoreCorrection();
    if (target.matches("button[data-score-match]")) return await submitScore(target.dataset.scoreMatch, target);
    if (target.id === "tournament-reopen") return await openSignups();
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
