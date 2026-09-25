import { loadBoardShell } from "./dashboard/board-shell.js";
import { ensureDialog, showConfirmModal } from "./dashboard/utils.js";
import { computeTrustScore, connectKickChat } from "./chat-entry.js";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[char]));
const csrf = () => document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] || "";

// Mirrors the server: tournaments.bracket_size CHECK and SUPPORTED_BRACKET_SIZES.
export const SUPPORTED_BRACKET_SIZES = [4, 8, 16, 32];
const SOURCE_LABELS = {
  chat: "Chat",
  page: "Signup page",
  manual: "Added by you",
  leaderboard: "Leaderboard",
};
const STATUS_LABELS = {
  pending: "Waiting",
  confirmed: "Ready",
  selected: "Picked",
  waitlist: "Waiting for a spot",
  removed: "Removed",
  blocked: "Blocked",
};
const LIFECYCLE_LABELS = {
  draft: "Draft",
  signups_open: "Signups open",
  signups_locked: "Signups locked",
  bracket: "Bracket live",
  completed: "Completed",
  cancelled: "Cancelled",
};
const ELIGIBLE = ["pending", "confirmed"];
const isEligible = (entry, tourn) => ELIGIBLE.includes(entry.status)
  && !(Number(tourn.entry_fee) === 0 && entry.alt_flag);
const ACTIVE = ["pending", "confirmed", "selected"];

let siteId = "";
let board = {};
let tournament = null;
let entries = [];
let matches = [];
let activeTab = "entries";
let chatConnection = null;
let chatHistory = new Map();
let recentEntryTimestamps = [];
let entriesRefreshTimer = null;
let entriesRefreshRunning = false;
let entriesRefreshQueued = false;
let releaseCreateTrap = null;
let settingsBaseline = "";
let settingsSavedTimer = null;

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

function setChatStatus(text, live = false) {
  const status = $("tournament-chat-status");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("is-live", live);
}

function setMessage(text = "", error = false) {
  const message = $("tournament-message");
  if (!message) return;
  message.textContent = text;
  message.hidden = !text;
  message.className = `tournament-message${error ? " is-error" : ""}`;
}

function stopChat() {
  chatConnection?.close();
  chatConnection = null;
  setChatStatus("Chat off");
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

function panelEmptyHtml(title, body) {
  return `<b>${esc(title)}</b><span>${esc(body)}</span>`;
}

function renderEntries(lifecycle) {
  const empty = $("tournament-entries-empty");
  const list = $("tournament-entry-list");
  if (!empty || !list) return;
  if (!entries.length) {
    list.hidden = true;
    empty.hidden = false;
    if (lifecycle === "signups_open") {
      empty.innerHTML = panelEmptyHtml("Waiting for viewers.", `Ask viewers to type ${tournament.entry_keyword || "!join"} in chat.`);
    } else if (lifecycle === "signups_locked") {
      empty.innerHTML = panelEmptyHtml("No entries.", "Reopen signups to collect entries from your audience.");
    } else {
      empty.innerHTML = panelEmptyHtml("No entries yet.", "Open signups when you're ready for viewers to join.");
    }
    return;
  }

  empty.hidden = true;
  list.hidden = false;
  const finished = lifecycle === "completed" || lifecycle === "cancelled";
  list.innerHTML = entries.map((entry) => {
    const flagged = tournament?.anti_alt_enabled && entry.alt_flag;
    const status = STATUS_LABELS[entry.status] || "Waiting";
    const name = esc(entry.display_name);
    const action = finished
      ? ""
      : ["removed", "blocked"].includes(entry.status)
        ? `<button class="tournament-row-action" type="button" data-entry-action="restore" data-entry-id="${esc(entry.id)}" aria-label="Restore ${name}">Restore</button>`
        : `<button class="tournament-row-action" type="button" data-entry-action="remove" data-entry-id="${esc(entry.id)}" aria-label="Remove ${name}">Remove</button>
           <button class="tournament-row-action tournament-row-action--quiet" type="button" data-entry-action="block" data-entry-id="${esc(entry.id)}" aria-label="Block ${name}">Block</button>`;
    return `
      <li class="tournament-entry-row${flagged ? " is-flagged" : ""}" data-entry-id="${esc(entry.id)}">
        <div class="tournament-entry-main">
          <strong>${name}</strong>
          <span>${esc(SOURCE_LABELS[entry.source] || entry.source)} · ${esc(status)}</span>
          ${flagged ? `<div class="tournament-entry-flag"><b>Review flag</b><span>— ${esc(entry.alt_reason || "Possible duplicate account.")}</span></div>` : ""}
        </div>
        <div class="tournament-entry-actions">${action}</div>
      </li>`;
  }).join("");
}

function renderSummary(lifecycle, activeCount) {
  $("tournament-title-display").textContent = tournament.title || "Community Tournament";
  const chip = $("tournament-status");
  chip.textContent = LIFECYCLE_LABELS[lifecycle] || lifecycle;
  chip.dataset.lifecycle = lifecycle;
  const bits = [tournament.game_name || "Game", `${tournament.bracket_size}-player bracket`];
  $("tournament-meta").textContent = bits.join(" · ");
  $("tournament-fact-channel").textContent = tournament.chat_channel || "—";
  $("tournament-fact-keyword").textContent = tournament.entry_keyword || "!join";
  $("tournament-fact-cap").textContent = tournament.entry_cap ? String(tournament.entry_cap) : "Unlimited";
  $("tournament-fact-spots").textContent = String(tournament.bracket_size);
  $("tournament-count").textContent = tournament.entry_cap ? `${activeCount} of ${tournament.entry_cap}` : String(activeCount);
}

function renderSettingsForm(lifecycle) {
  $("tournament-title").value = tournament.title || "";
  $("tournament-game").value = tournament.game_name || "";
  $("tournament-keyword").value = tournament.entry_keyword || "!join";
  $("tournament-entry-cap-mode").value = tournament.entry_cap ? "custom" : "";
  const cap = $("tournament-entry-cap");
  cap.value = tournament.entry_cap || "";
  cap.hidden = !tournament.entry_cap;
  $("tournament-chat-channel").value = tournament.chat_channel || board.kickChannelName || "";
  $("tournament-anti-alt").checked = tournament.anti_alt_enabled === true;

  const size = $("tournament-bracket-size");
  const sizeHint = $("tournament-bracket-size-hint");
  size.value = String(tournament.bracket_size);
  const sizeLocked = lifecycle === "bracket" || lifecycle === "completed" || lifecycle === "cancelled";
  size.disabled = sizeLocked;
  sizeHint.hidden = !sizeLocked;
  sizeHint.textContent = sizeLocked ? "Bracket size is locked: the bracket has already been created." : "";

  const finished = lifecycle === "completed" || lifecycle === "cancelled";
  for (const el of $("tournament-settings-form").querySelectorAll("input, button")) {
    if (el.id === "tournament-bracket-size") continue;
    el.disabled = finished;
  }

  settingsBaseline = settingsSnapshot();
  updateDirty();
}

function renderPrimary(lifecycle, eligibleCount) {
  const primary = $("tournament-primary");
  const reopen = $("tournament-reopen");
  const fresh = $("tournament-new");
  const step = $("tournament-step-label");
  primary.hidden = true;
  primary.disabled = false;
  reopen.hidden = true;
  fresh.hidden = true;
  step.textContent = "";
  delete primary.dataset.action;

  if (lifecycle === "draft") {
    primary.hidden = false;
    if (!String(tournament.chat_channel || "").trim()) {
      primary.textContent = "Add Kick channel";
      primary.dataset.action = "add-channel";
      step.innerHTML = "<b>Kick channel required.</b> Add your Kick channel before opening signups.";
    } else {
      primary.textContent = "Open signups";
      primary.dataset.action = "open";
      step.textContent = "Open signups when you're ready for viewers to join.";
    }
  } else if (lifecycle === "signups_open") {
    primary.hidden = false;
    primary.textContent = "Lock signups";
    primary.dataset.action = "lock";
    step.textContent = `Viewers join by typing ${tournament.entry_keyword || "!join"} in chat.`;
  } else if (lifecycle === "signups_locked") {
    const missing = tournament.bracket_size - eligibleCount;
    primary.hidden = false;
    primary.textContent = "Pick participants";
    primary.dataset.action = "pick";
    primary.disabled = missing > 0;
    reopen.hidden = false;
    step.textContent = missing > 0
      ? `Need ${missing} more eligible ${missing === 1 ? "player" : "players"}.`
      : `${eligibleCount} eligible entries for ${tournament.bracket_size} bracket spots. Picking is random.`;
  } else if (lifecycle === "bracket") {
    step.textContent = "Enter match results in the Bracket tab to advance winners.";
  } else if (lifecycle === "completed") {
    fresh.hidden = false;
    step.textContent = `Champion: ${tournament.winner_name || "—"}`;
  } else if (lifecycle === "cancelled") {
    fresh.hidden = false;
    step.textContent = "Tournament cancelled.";
  }
}

function renderTournament() {
  const empty = $("tournament-empty");
  const workspace = $("tournament-workspace");
  if (!empty || !workspace) return;
  if (!tournament) {
    workspace.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  workspace.hidden = false;
  const lifecycle = lifecycleOf(tournament, matches.length);
  const activeCount = entries.filter((entry) => ACTIVE.includes(entry.status)).length;
  const eligibleCount = entries.filter((entry) => isEligible(entry, tournament)).length;
  renderSummary(lifecycle, activeCount);
  renderPrimary(lifecycle, eligibleCount);
  renderEntries(lifecycle);
  renderBracket(lifecycle);
  renderSettingsForm(lifecycle);
  switchTab(activeTab);
}

async function loadEntries() {
  if (!tournament) return;
  const [entryData, bracketData] = await Promise.all([
    api(`/api/tournaments/${encodeURIComponent(tournament.id)}/entries`),
    api(`/api/tournaments/${encodeURIComponent(tournament.id)}/bracket`).catch(() => ({ matches: [] })),
  ]);
  entries = entryData.entries || [];
  matches = bracketData.matches || [];
  if (bracketData.tournament?.winner_name) tournament.winner_name = bracketData.tournament.winner_name;
  if (bracketData.tournament?.status) tournament.status = bracketData.tournament.status;
  renderTournament();
}

async function loadTournament() {
  const data = await api("/api/tournaments");
  const tournaments = data.tournaments || [];
  // Prefer an unfinished tournament, but keep a completed/cancelled one visible
  // so the bracket and champion survive reload/back navigation.
  const current = tournaments.find((item) => !["completed", "cancelled"].includes(item.status));
  tournament = current || tournaments[0] || null;
  entries = [];
  matches = [];
  if (tournament) await loadEntries();
  else renderTournament();
}

// ---- Create modal --------------------------------------------------------

function setCreateError(text = "") {
  const el = $("tournament-create-error");
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
}

async function openCreateModal() {
  const modal = $("tournament-create-modal");
  const form = $("tournament-create-form");
  if (!modal || !form) return;
  form.reset();
  $("tc-chat-channel").value = tournament?.chat_channel || board.kickChannelName || "";
  $("tc-entry-cap-custom").hidden = true;
  setCreateError("");
  modal.hidden = false;
  document.documentElement.classList.add("yr-modal-open");
  const dialog = await ensureDialog().catch(() => null);
  releaseCreateTrap = dialog ? dialog.trap(modal, closeCreateModal) : null;
  $("tc-title").focus();
  $("tc-title").select();
}

function closeCreateModal() {
  const modal = $("tournament-create-modal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.documentElement.classList.remove("yr-modal-open");
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
    matches = [];
    activeTab = "entries";
    closeCreateModal();
    setMessage("");
    renderTournament();
    await loadEntries();
  } catch (error) {
    setCreateError(error.message || "Could not create the tournament.");
  } finally {
    submit.disabled = false;
  }
}

// ---- Chat ingestion (unchanged behaviour) --------------------------------

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
  if (!channel) {
    setMessage("Add your Kick channel before opening signups.", true);
    return;
  }
  setChatStatus("Connecting…");
  try {
    const response = await fetch(`/api/giveaways/chatroom?channel=${encodeURIComponent(channel)}`);
    const data = await response.json();
    if (!response.ok || !data.chatroomId) throw new Error(data.error || "Could not find that Kick channel.");
    chatConnection = connectKickChat({
      chatroomId: data.chatroomId,
      onOpen: () => setChatStatus("Chat listening", true),
      onError: () => setChatStatus("Chat connection error"),
      onClose: () => {
        chatConnection = null;
        setChatStatus("Chat off");
      },
      onMessage: handleChatMessage,
    });
  } catch {
    setChatStatus("Chat unavailable");
  }
}

async function handleChatMessage(chatData) {
  const sender = chatData?.sender;
  const content = String(chatData?.content || "").trim();
  if (!sender || !content) return;
  const username = String(sender.username || sender.slug || "Anonymous").trim();
  const keyword = String(tournament?.entry_keyword || "!join").toLowerCase();
  if (content.split(/\s+/)[0].toLowerCase() !== keyword) return;
  const now = Date.now();
  const nameKey = username.toLowerCase();
  chatHistory.set(nameKey, (chatHistory.get(nameKey) || 0) + 1);
  recentEntryTimestamps.push(now);
  if (recentEntryTimestamps.length > 50) recentEntryTimestamps.shift();
  const score = computeTrustScore(username, content, now, {
    chatHistory,
    recentEntryTimestamps,
  });
  try {
    await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/entries`, {
      method: "POST",
      body: JSON.stringify({
        displayName: username,
        source: "chat",
        trustScore: score.trustScore,
        altFlag: tournament.anti_alt_enabled ? score.sybilFlag : false,
        altReason: score.altReason,
      }),
    });
    refreshEntriesSoon();
  } catch (error) {
    if (!String(error.message).toLowerCase().includes("blocked")) {
      setMessage(error.message || "Could not add that entry.", true);
    }
  }
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
  await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/signups/open`, { method: "POST", body: "{}" });
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
  if (action === "open") return openSignups();
  if (action === "lock") {
    await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/signups/lock`, { method: "POST", body: "{}" });
    stopChat();
    return loadTournament();
  }
  if (action === "pick") {
    const count = tournament.bracket_size;
    if (!await showConfirmModal("Pick participants", `Randomly pick ${count} entries and create the bracket? This cannot be undone.`, "Pick and create bracket", true)) return;
    await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/entries/random-pick`, {
      method: "POST",
      body: JSON.stringify({ count }),
    });
    activeTab = "bracket";
    await loadEntries();
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

// ---- Bracket -------------------------------------------------------------

function groupBy(array, key) {
  return array.reduce((acc, item) => {
    const group = item[key] ?? "";
    (acc[group] = acc[group] || []).push(item);
    return acc;
  }, {});
}

function renderBracket(lifecycle) {
  const bracket = $("tournament-bracket");
  const empty = $("tournament-bracket-empty");
  const champion = $("tournament-champion");
  if (!bracket || !empty || !champion) return;
  if (!matches.length && !tournament.winner_name) {
    empty.hidden = false;
    bracket.innerHTML = "";
    bracket.hidden = true;
    champion.hidden = true;
    return;
  }
  empty.hidden = true;
  bracket.hidden = false;
  if (tournament.winner_name) {
    champion.hidden = false;
    champion.textContent = `Champion: ${tournament.winner_name}`;
  } else {
    champion.hidden = true;
  }
  const finished = lifecycle === "completed" || lifecycle === "cancelled";
  const byRound = groupBy(matches, "round_number");
  const rounds = Object.keys(byRound).sort((a, b) => Number(a) - Number(b));
  bracket.innerHTML = rounds.map((round) => {
    const roundMatches = byRound[round].sort((a, b) => a.match_index - b.match_index);
    return `<div class="tournament-round"><h3>Round ${esc(round)}</h3>${roundMatches.map((match) => renderMatch(match, finished)).join("")}</div>`;
  }).join("");
}

function renderMatch(match, finished) {
  const p1 = match.player1_name || "TBD";
  const p2 = match.player2_name || "TBD";
  const isComplete = match.status === "completed";
  const p1Winner = isComplete && match.winner_name === p1;
  const p2Winner = isComplete && match.winner_name === p2;
  const canScore = !finished && !isComplete && p1 !== "TBD" && p2 !== "TBD";
  const scores = isComplete
    ? `<span class="tournament-match-score">${match.player1_score ?? 0} - ${match.player2_score ?? 0}</span>`
    : canScore
      ? `<input type="number" min="0" class="tournament-match-score-input" data-score-match="${esc(match.id)}" data-score-player="1" value="0" aria-label="${esc(p1)} score" />
         <span class="tournament-match-divider">–</span>
         <input type="number" min="0" class="tournament-match-score-input" data-score-match="${esc(match.id)}" data-score-player="2" value="0" aria-label="${esc(p2)} score" />
         <button class="btn btn--sm btn--accent" type="button" data-score-match="${esc(match.id)}">Submit score</button>`
      : `<span class="tournament-match-tbd">Waiting for both players</span>`;
  return `
    <div class="tournament-match" data-match-id="${esc(match.id)}">
      <div class="tournament-match-players">
        <span class="tournament-match-player${p1Winner ? " winner" : ""}">${esc(p1)}${p1Winner ? " 👑" : ""}</span>
      </div>
      <div class="tournament-match-players">
        <span class="tournament-match-player${p2Winner ? " winner" : ""}">${esc(p2)}${p2Winner ? " 👑" : ""}</span>
      </div>
      <div class="tournament-match-actions">${scores}</div>
    </div>
  `;
}

async function submitScore(matchId, target) {
  const matchEl = target.closest(".tournament-match");
  if (!matchEl) return;
  const p1Input = matchEl.querySelector('[data-score-player="1"]');
  const p2Input = matchEl.querySelector('[data-score-player="2"]');
  const player1Score = parseInt(p1Input?.value, 10) || 0;
  const player2Score = parseInt(p2Input?.value, 10) || 0;
  if (player1Score === player2Score) {
    setMessage("A match cannot end in a tie. Enter different scores.", true);
    return;
  }
  await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/score`, {
    method: "POST",
    body: JSON.stringify({ matchId, player1Score, player2Score }),
  });
  setMessage("");
  await loadTournament();
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
  return JSON.stringify({
    title: $("tournament-title").value,
    game: $("tournament-game").value,
    keyword: $("tournament-keyword").value,
    capMode: $("tournament-entry-cap-mode").value,
    cap: $("tournament-entry-cap").value,
    channel: $("tournament-chat-channel").value,
    antiAlt: $("tournament-anti-alt").checked,
    bracketSize: $("tournament-bracket-size").value,
  });
}

function updateDirty() {
  const bar = $("tournament-settings-bar");
  if (bar) bar.hidden = settingsSnapshot() === settingsBaseline;
}

async function saveSettings(event) {
  event.preventDefault();
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

export async function boot() {
  if (!$("tournament-app")) return;
  activeTab = "entries";
  stopChat();
  try {
    const shell = await loadBoardShell();
    siteId = shell.activeSiteId || "";
    board = shell.board || {};
    await loadTournament();
    await startChat();
  } catch (error) {
    setMessage(error.message || "Tournament unavailable. Try again in a moment.", true);
    $("tournament-empty").hidden = false;
  }
}

document.addEventListener("submit", (event) => {
  if (!$("tournament-app")) return;
  if (event.target.id === "tournament-create-form") {
    submitCreate(event).catch((error) => setCreateError(error.message || "Could not create the tournament."));
  } else if (event.target.id === "tournament-settings-form") {
    event.preventDefault();
    saveSettings(event).catch((error) => setMessage(error.message || "Could not save settings.", true));
  }
});

document.addEventListener("change", (event) => {
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
});

document.addEventListener("input", (event) => {
  if (event.target.closest?.("#tournament-settings-form")) updateDirty();
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest?.(
    "#tournament-primary, #tournament-reopen, #tournament-new, #tournament-create, #tournament-create-cancel, #tournament-create-modal, #tournament-settings-discard, [data-tournament-tab], [data-entry-action], [data-score-match]"
  );
  if (!target || !$("tournament-app")) return;
  if (target.id === "tournament-create-modal") {
    if (event.target === target) closeCreateModal();
    return;
  }
  event.preventDefault();
  try {
    if (target.matches("[data-tournament-tab]")) return switchTab(target.dataset.tournamentTab);
    if (target.matches("[data-entry-action]")) return await handleEntryAction(target);
    if (target.matches("[data-score-match]")) return await submitScore(target.dataset.scoreMatch, target);
    if (target.id === "tournament-reopen") return await openSignups();
    if (target.id === "tournament-create" || target.id === "tournament-new") return await openCreateModal();
    if (target.id === "tournament-create-cancel") return closeCreateModal();
    if (target.id === "tournament-settings-discard") {
      renderSettingsForm(lifecycleOf(tournament, matches.length));
      return clearFieldErrors();
    }
    if (target.id === "tournament-primary") return await handlePrimary();
  } catch (error) {
    setMessage(error.message || "Action failed.", true);
  }
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
