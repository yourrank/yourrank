import { loadBoardShell } from "./dashboard/board-shell.js";
import { ensureDialog, showConfirmModal } from "./dashboard/utils.js";
import { connectKickChat } from "./chat-entry.js";

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
  manual: "Manual",
  leaderboard: "Leaderboard",
};
// Lucide crown, inline so the winner mark needs no emoji or external asset.
const CROWN_ICON = '<svg class="tourn-crown" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M5 16 3 7l5.5 4L12 4l3.5 7L21 7l-2 9H5zm0 2h14v2H5z"/></svg>';
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
// Sentinel for BYE slots — must match BYE in lib/tournament-bracket.js.
// BYE_LABEL is what the UI renders for it; a player named "BYE" stays normal.
const BYE = "__YOURRANK_INTERNAL_BYE__";
const BYE_LABEL = "BYE";
const ACTIVE = ["pending", "confirmed", "selected"];

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
let settingsBaseline = "";
let settingsSavedTimer = null;
let settingsReadonly = false;

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
}

// Chat registration is server-side (the Kick webhook), so the status reflects
// the stored channel/connection state — never the browser socket.
function updateChatStatus(lifecycle) {
  const channel = String(tournament?.chat_channel || "").trim().toLowerCase();
  const siteChannel = String(chatRegistration?.channelName || "").trim().toLowerCase();
  if (lifecycle === "signups_open"
      && chatRegistration?.connected && chatRegistration.chatReady && channel && channel === siteChannel) {
    setChatStatus("Chat registration active", true);
  } else if (lifecycle === "signups_open") {
    setChatStatus("Chat registration unavailable");
  } else {
    setChatStatus("Chat registration off");
  }
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
  const table = $("tournament-entry-table");
  if (!empty || !list) return;
  if (!entries.length) {
    list.hidden = true;
    if (table) table.hidden = true;
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
  if (table) table.hidden = false;
  const finished = lifecycle === "completed" || lifecycle === "cancelled";
  list.innerHTML = entries.map((entry) => {
    const flagged = tournament?.anti_alt_enabled && entry.alt_flag;
    const status = STATUS_LABELS[entry.status] || "Waiting";
    const name = esc(entry.display_name);
    const initial = esc(String(entry.display_name || "?").trim().charAt(0).toUpperCase() || "?");
    const menu = finished
      ? ""
      : `<details class="tourn-menu"><summary class="tourn-menu-toggle" aria-label="Actions for ${name}">•••</summary>
          <div class="tourn-menu-list" role="menu">
            ${["removed", "blocked"].includes(entry.status)
              ? `<button type="button" role="menuitem" data-entry-action="restore" data-entry-id="${esc(entry.id)}">Restore</button>`
              : `<button type="button" role="menuitem" data-entry-action="remove" data-entry-id="${esc(entry.id)}">Remove</button>
                 <button type="button" role="menuitem" data-entry-action="block" data-entry-id="${esc(entry.id)}">Block</button>`}
          </div>
        </details>`;
    return `
      <tr class="tournament-entry-row${flagged ? " is-flagged" : ""}" data-entry-id="${esc(entry.id)}">
        <td data-label="Player">
          <span class="tourn-avatar" aria-hidden="true">${initial}</span>
          <span class="tourn-player">
            <strong>${name}</strong>
            ${flagged ? `<span class="tournament-entry-flag"><b>Review flag</b> — ${esc(entry.alt_reason || "Possible duplicate account.")}</span>` : ""}
          </span>
        </td>
        <td data-label="Source" class="tourn-col-source">${esc(SOURCE_LABELS[entry.source] || entry.source)}</td>
        <td data-label="Status"><span class="tourn-pill tourn-pill--${esc(entry.status)}">${esc(status)}</span></td>
        <td class="tourn-col-actions">${menu}</td>
      </tr>`;
  }).join("");
}

function renderSummary(lifecycle, activeCount) {
  $("tournament-title-display").textContent = tournament.title || "Community Tournament";
  const chip = $("tournament-status");
  chip.textContent = LIFECYCLE_LABELS[lifecycle] || lifecycle;
  chip.dataset.lifecycle = lifecycle;
  const bits = [
    ...(String(tournament.game_name || "").trim() ? [tournament.game_name] : []),
    `${tournament.bracket_size}-player bracket`,
    "Single elimination",
  ];
  $("tournament-meta").textContent = bits.join(" · ");
  $("tournament-fact-keyword").textContent = tournament.entry_keyword || "!join";
  $("tournament-fact-cap").textContent = tournament.entry_cap ? String(tournament.entry_cap) : "Unlimited";
  $("tournament-fact-spots").textContent = String(tournament.bracket_size);
  $("tournament-count").textContent = tournament.entry_cap ? `${activeCount} of ${tournament.entry_cap}` : String(activeCount);
  const entriesTab = $("tournament-tab-entries");
  if (entriesTab) entriesTab.textContent = `Entries (${activeCount})`;
}

function renderSettingsForm(lifecycle) {
  $("tournament-title").value = tournament.title || "";
  $("tournament-game").value = tournament.game_name || "";
  $("tournament-keyword").value = tournament.entry_keyword || "!join";
  $("tournament-entry-cap-mode").value = tournament.entry_cap ? "custom" : "";
  const cap = $("tournament-entry-cap");
  cap.value = tournament.entry_cap || "";
  cap.hidden = !tournament.entry_cap;
  const channel = $("tournament-chat-channel");
  channel.value = tournament.chat_channel || "";
  channel.placeholder = tournament.chat_channel || !String(board.kickChannelName || "").trim()
    ? "channelname"
    : board.kickChannelName;
  $("tournament-anti-alt").checked = tournament.anti_alt_enabled === true;

  const size = $("tournament-bracket-size");
  const sizeHint = $("tournament-bracket-size-hint");
  size.value = String(tournament.bracket_size);
  const sizeLocked = lifecycle === "bracket" || lifecycle === "completed" || lifecycle === "cancelled";
  size.disabled = sizeLocked;
  sizeHint.hidden = !sizeLocked;
  sizeHint.textContent = sizeLocked ? "Bracket size is locked: the bracket has already been created." : "";

  const finished = lifecycle === "completed" || lifecycle === "cancelled";
  settingsReadonly = finished;
  $("tournament-settings-form").dataset.readonly = finished ? "true" : "";
  for (const el of $("tournament-settings-form").querySelectorAll("input, select, button")) {
    if (el.id === "tournament-bracket-size") continue;
    el.disabled = finished;
  }

  settingsBaseline = settingsSnapshot();
  updateDirty();
}

// One sentence of guidance per lifecycle for the Settings aside card.
const LIFECYCLE_STATUS_COPY = {
  draft: "Signups haven't opened yet.",
  signups_open: "Viewers can join by typing your join command in chat.",
  signups_locked: "Signups are locked. Pick participants to create the bracket.",
  bracket: "The bracket is live. Enter scores to advance winners.",
  completed: "This tournament has finished. No new signups are being accepted.",
  cancelled: "This tournament was cancelled.",
};

// Settings panel: finished tournaments get a read-only summary, editable
// ones keep the real form. The aside always carries status + details.
function renderSettingsPanel(lifecycle) {
  const view = $("tournament-settings-view");
  const form = $("tournament-settings-form");
  const aside = $("tournament-settings-aside");
  if (!view || !form) return;
  const finished = lifecycle === "completed" || lifecycle === "cancelled";
  form.hidden = finished;
  view.hidden = !finished;
  if (finished) {
    view.innerHTML = `
      <div class="tourn-panel-head">
        <h2>Tournament settings</h2>
        <p class="tournament-muted">This tournament has finished; its settings are read-only.</p>
      </div>
      <h3 class="tourn-kv-group">General</h3>
      <dl class="tourn-kv">
        ${tournKvRow("Tournament name", esc(tournament.title || "—"))}
        ${tournKvRow("Game", esc(tournament.game_name || "Not specified"))}
        ${tournKvRow("Bracket type", "Single elimination")}
        ${tournKvRow("Bracket size", `${esc(String(tournament.bracket_size))} players`)}
      </dl>
      <h3 class="tourn-kv-group">Registration</h3>
      <dl class="tourn-kv">
        ${tournKvRow("Kick channel", esc(tournament.chat_channel || "—"))}
        ${tournKvRow("Join command", esc(tournament.entry_keyword || "!join"))}
        ${tournKvRow("Signup limit", esc(tournament.entry_cap ? String(tournament.entry_cap) : "Unlimited"))}
        ${tournKvRow("Chat registration", esc(chatRegistrationLabel(lifecycle)))}
      </dl>`;
  }
  if (aside) {
    aside.innerHTML = `
      <section class="tourn-card">
        <h3>Tournament status</h3>
        <p class="tourn-aside-status"><span class="tourn-pill tourn-pill--${esc(lifecycle)}">${esc(LIFECYCLE_LABELS[lifecycle] || lifecycle)}</span></p>
        <p class="tournament-muted">${esc(LIFECYCLE_STATUS_COPY[lifecycle] || "")}</p>
      </section>
      <section class="tourn-card">
        <h3>Details</h3>
        <dl class="tourn-kv">
          ${tournKvRow("Created", esc(formatCreated(tournament.created_at)))}
          ${tournKvRow("Tournament ID", esc(tournament.id))}
          ${tournKvRow("Entries", esc(String(entryCounts.active || 0)))}
          ${tournKvRow("Bracket size", esc(String(tournament.bracket_size)))}
          ${tournKvRow("Matches played", esc(String(playedMatchCount())))}
          ${tournKvRow("Game", esc(tournament.game_name || "Not specified"))}
          ${tournKvRow("Bracket type", "Single elimination")}
        </dl>
      </section>`;
  }
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
      const siteChannel = String(board.kickChannelName || "").trim();
      if (siteChannel) {
        primary.textContent = `Use ${siteChannel}`;
        primary.dataset.action = "use-site-channel";
        step.innerHTML = "<b>Kick channel required.</b> Use your connected Kick channel to open signups.";
      } else {
        primary.textContent = "Add Kick channel";
        primary.dataset.action = "add-channel";
        step.innerHTML = "<b>Kick channel required.</b> Add your Kick channel before opening signups.";
      }
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
    const cap = tournament.bracket_size;
    reopen.hidden = false;
    if (eligibleCount < 2) {
      step.textContent = "Need at least 2 eligible players to start.";
    } else if (eligibleCount <= cap) {
      primary.hidden = false;
      primary.textContent = `Create bracket with ${eligibleCount} players`;
      primary.dataset.action = "create-bracket";
      step.textContent = `${eligibleCount} eligible players for up to ${cap} bracket spots. Players will be randomly placed in the bracket.`;
    } else {
      primary.hidden = false;
      primary.textContent = "Select participants";
      primary.dataset.action = "select-participants";
      step.textContent = `${eligibleCount} eligible players for ${cap} bracket spots. Select the participants who will compete.`;
    }
  } else if (lifecycle === "bracket") {
    step.textContent = "Enter match results in the Bracket tab to advance winners.";
  } else if (lifecycle === "completed") {
    fresh.hidden = false;
    step.innerHTML = `${CROWN_ICON}<span>Champion: ${esc(tournament.winner_name || "—")}</span>`;
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
  updateChatStatus(lifecycle);
  updateEntriesPolling(lifecycle);
  const activeCount = entries.filter((entry) => ACTIVE.includes(entry.status)).length;
  renderSummary(lifecycle, activeCount);
  renderPrimary(lifecycle, entryCounts.eligible || 0);
  renderEntries(lifecycle);
  renderBracket(lifecycle);
  renderTournamentSummary(lifecycle);
  renderSettingsForm(lifecycle);
  renderSettingsPanel(lifecycle);
  switchTab(activeTab);
}

// Matches that actually happened: completed, and neither side a BYE.
function playedMatchCount() {
  return matches.filter((m) => m.status === "completed" && m.player1_name !== BYE && m.player2_name !== BYE).length;
}

function formatCreated(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function chatRegistrationLabel(lifecycle) {
  const channel = String(tournament?.chat_channel || "").trim().toLowerCase();
  const siteChannel = String(chatRegistration?.channelName || "").trim().toLowerCase();
  if (lifecycle === "signups_open"
      && chatRegistration?.connected && chatRegistration.chatReady && channel && channel === siteChannel) return "Active";
  if (lifecycle === "signups_open") return "Unavailable";
  return "Off";
}

const tournKvRow = (label, value) => `<div class="tourn-kv-row"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;

// The bracket aside: compact summary + metadata, shared shape with the
// Settings "Details" card.
function renderTournamentSummary(lifecycle) {
  const aside = $("tournament-summary");
  if (!aside || !tournament) return;
  aside.innerHTML = `
    <section class="tourn-card">
      <h3>Tournament summary</h3>
      <dl class="tourn-kv">
        ${tournKvRow("Entries", esc(String(entryCounts.active || 0)))}
        ${tournKvRow("Bracket size", esc(String(tournament.bracket_size)))}
        ${tournKvRow("Matches played", esc(String(playedMatchCount())))}
        ${tournKvRow("Status", `<span class="tourn-pill tourn-pill--${esc(lifecycle)}">${esc(LIFECYCLE_LABELS[lifecycle] || lifecycle)}</span>`)}
      </dl>
      ${tournament.winner_name ? `<div class="tourn-champ"><span class="tourn-kv-dim">Champion</span><strong>${CROWN_ICON}${esc(tournament.winner_name)}</strong></div>` : ""}
      <dl class="tourn-kv">
        ${tournKvRow("Game", esc(tournament.game_name || "Not specified"))}
        ${tournKvRow("Bracket type", "Single elimination")}
        ${tournKvRow("Created", esc(formatCreated(tournament.created_at)))}
        ${tournKvRow("Tournament ID", esc(tournament.id))}
      </dl>
    </section>`;
}

async function loadEntries() {
  if (!tournament) return;
  const [entryData, bracketData] = await Promise.all([
    api(`/api/tournaments/${encodeURIComponent(tournament.id)}/entries`),
    api(`/api/tournaments/${encodeURIComponent(tournament.id)}/bracket`).catch(() => ({ matches: [] })),
  ]);
  entries = entryData.entries || [];
  entryCounts = entryData.counts || { active: 0, eligible: 0, waitlist: 0, removed: 0, blocked: 0 };
  matches = bracketData.matches || [];
  if (bracketData.tournament?.winner_name) tournament.winner_name = bracketData.tournament.winner_name;
  if (bracketData.tournament?.status) tournament.status = bracketData.tournament.status;
  if (bracketData.tournament?.created_at) tournament.created_at = bracketData.tournament.created_at;
  renderTournament();
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
    entryCounts = { active: 0, eligible: 0, waitlist: 0, removed: 0, blocked: 0 };
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

// ---- Select participants modal -------------------------------------------

let releaseSelectTrap = null;
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
  const filter = String($("ts-search").value || "").trim().toLowerCase();
  const eligible = entries.filter((entry) => entry.eligible === true);
  const visible = filter
    ? eligible.filter((entry) => String(entry.display_name || "").toLowerCase().includes(filter))
    : eligible;
  $("ts-entry-list").innerHTML = visible.map((entry) => `
    <li class="tournament-select-row">
      <label>
        <input type="checkbox" value="${esc(entry.id)}"${manualSelection.has(entry.id) ? " checked" : ""} />
        <span>${esc(entry.display_name)}</span>
      </label>
    </li>`).join("");
}

function syncSelectMode() {
  const manual = $("ts-mode-manual").checked;
  $("ts-pane-random").hidden = manual;
  $("ts-pane-manual").hidden = !manual;
  updateSelectCounter();
}

async function openSelectModal() {
  const modal = $("tournament-select-modal");
  if (!modal) return;
  const eligible = entryCounts.eligible || 0;
  const cap = tournament?.bracket_size || 0;
  $("ts-random-text").textContent = `Randomly select ${cap} of ${eligible} eligible players.`;
  $("ts-mode-random").checked = true;
  $("ts-mode-manual").checked = false;
  $("ts-search").value = "";
  manualSelection.clear();
  renderSelectList();
  syncSelectMode();
  setSelectError("");
  modal.hidden = false;
  document.documentElement.classList.add("yr-modal-open");
  const dialog = await ensureDialog().catch(() => null);
  releaseSelectTrap = dialog ? dialog.trap(modal, closeSelectModal) : null;
  $("ts-mode-random").focus();
}

function closeSelectModal() {
  const modal = $("tournament-select-modal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.documentElement.classList.remove("yr-modal-open");
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

// ---- Bracket -------------------------------------------------------------

function groupBy(array, key) {
  return array.reduce((acc, item) => {
    const group = item[key] ?? "";
    (acc[group] = acc[group] || []).push(item);
    return acc;
  }, {});
}

// Round labels read back from the final: last is Final, then Semifinals,
// Quarterfinals, and everything before that is a numbered round.
function roundLabel(index, total) {
  if (index === total - 1) return "Final";
  if (index === total - 2) return "Semifinals";
  if (index === total - 3 && total >= 4) return "Quarterfinals";
  return `Round ${index + 1}`;
}

// One source of bracket markup so the inline panel and the full-bracket
// modal always agree.
function bracketHtml(lifecycle) {
  const finished = lifecycle === "completed" || lifecycle === "cancelled";
  const byRound = groupBy(matches, "round_number");
  const rounds = Object.keys(byRound).sort((a, b) => Number(a) - Number(b));
  const lastRound = Number(rounds[rounds.length - 1]);
  const championMatch = (match) =>
    finished && tournament?.winner_name && match.winner_name === tournament.winner_name && Number(match.round_number) === lastRound;
  return rounds.map((round, index) => {
    const roundMatches = byRound[round].sort((a, b) => a.match_index - b.match_index);
    const count = `${roundMatches.length} ${roundMatches.length === 1 ? "match" : "matches"}`;
    return `<div class="tournament-round">
      <div class="tournament-round-head"><h3>${esc(roundLabel(index, rounds.length))}</h3><span>${esc(count)}</span></div>
      <div class="tournament-round-matches">${roundMatches.map((match) => renderMatch(match, finished, championMatch(match))).join("")}</div>
    </div>`;
  }).join("");
}

function renderBracket(lifecycle) {
  const bracket = $("tournament-bracket");
  const empty = $("tournament-bracket-empty");
  const champion = $("tournament-champion");
  if (!bracket || !empty || !champion) return;
  const sub = $("tournament-bracket-sub");
  if (sub) sub.textContent = `Single elimination · ${tournament.bracket_size}-player bracket`;
  if (!matches.length && !tournament.winner_name) {
    empty.hidden = false;
    bracket.innerHTML = "";
    bracket.hidden = true;
    champion.hidden = true;
    return;
  }
  empty.hidden = true;
  bracket.hidden = false;
  // Kept populated but hidden: tests read the champion from this element;
  // the visible champion treatment lives in the header and final match.
  if (tournament.winner_name) champion.textContent = `Champion: ${tournament.winner_name}`;
  champion.hidden = true;
  bracket.innerHTML = bracketHtml(lifecycle);
}

function renderMatch(match, finished, championMatch = false) {
  const p1 = match.player1_name || "TBD";
  const p2 = match.player2_name || "TBD";
  const isComplete = match.status === "completed";
  const bye1 = p1 === BYE;
  const bye2 = p2 === BYE;
  const row = (name, bye, winner, score) => {
    const label = bye ? BYE_LABEL : (name === "TBD" ? "—" : name);
    const scoreHtml = bye || name === "TBD" ? "" : `<span class="tournament-match-score">${isComplete ? (score ?? 0) : ""}</span>`;
    return `<div class="tournament-match-row${bye ? " is-bye" : ""}${winner ? " is-winner" : ""}${winner && championMatch ? " is-champion" : ""}">
      <span class="tournament-match-name">${winner ? CROWN_ICON : ""}${esc(label)}</span>${scoreHtml}
    </div>`;
  };
  if (bye1 && bye2) {
    return `<div class="tournament-match is-bye" data-match-id="${esc(match.id)}">${row(p1, true, false)}${row(p2, true, false)}</div>`;
  }
  const p1Winner = isComplete && match.winner_name === p1;
  const p2Winner = isComplete && match.winner_name === p2;
  const canScore = !finished && !isComplete && !bye1 && !bye2 && p1 !== "TBD" && p2 !== "TBD";
  const actions = bye1 || bye2
    ? `<div class="tournament-match-actions"><span class="tournament-match-note">${esc(bye1 ? p2 : p1)} advances automatically</span></div>`
    : canScore
      ? `<div class="tournament-match-actions">
           <input type="number" min="0" class="tournament-match-score-input" data-score-match="${esc(match.id)}" data-score-player="1" value="0" aria-label="${esc(p1)} score" />
           <span class="tournament-match-divider">–</span>
           <input type="number" min="0" class="tournament-match-score-input" data-score-match="${esc(match.id)}" data-score-player="2" value="0" aria-label="${esc(p2)} score" />
           <button class="btn btn--sm btn--accent" type="button" data-score-match="${esc(match.id)}">Submit score</button>
         </div>`
      : "";
  return `<div class="tournament-match" data-match-id="${esc(match.id)}">${row(p1, bye1, p1Winner, match.player1_score)}${row(p2, bye2, p2Winner, match.player2_score)}${actions}</div>`;
}

// ---- Full-bracket modal --------------------------------------------------

let releaseBracketTrap = null;

async function openBracketModal() {
  const modal = $("tournament-bracket-modal");
  const full = $("tournament-bracket-full");
  if (!modal || !full || !tournament) return;
  full.innerHTML = bracketHtml(lifecycleOf(tournament, matches.length));
  modal.hidden = false;
  document.documentElement.classList.add("yr-modal-open");
  const dialog = await ensureDialog().catch(() => null);
  releaseBracketTrap = dialog ? dialog.trap(modal, closeBracketModal) : null;
  $("tournament-bracket-close")?.focus();
}

function closeBracketModal() {
  const modal = $("tournament-bracket-modal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.documentElement.classList.remove("yr-modal-open");
  if (releaseBracketTrap) releaseBracketTrap();
  releaseBracketTrap = null;
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
    setMessage(error.message || "Tournament unavailable. Try again in a moment.", true);
    const empty = $("tournament-empty");
    if (empty) empty.hidden = false;
  }
}

// Drop timers, sockets, modal state and cached data so leave() fully
// detaches the workspace and a later enter() rebuilds it from scratch.
function resetTransientState() {
  stopChat();
  if (entriesPollTimer) { clearInterval(entriesPollTimer); entriesPollTimer = null; }
  if (entriesRefreshTimer) { clearTimeout(entriesRefreshTimer); entriesRefreshTimer = null; }
  if (settingsSavedTimer) { clearTimeout(settingsSavedTimer); settingsSavedTimer = null; }
  entriesRefreshRunning = false;
  entriesRefreshQueued = false;
  closeCreateModal();
  closeSelectModal();
  closeBracketModal();
  document.querySelectorAll("details.tourn-menu[open]").forEach((menu) => { menu.open = false; });
  // The modal markup may already be gone when a leave races a fragment swap;
  // release any lingering focus traps and unlock the page scroll regardless.
  if (releaseCreateTrap || releaseSelectTrap || releaseBracketTrap) {
    releaseCreateTrap?.();
    releaseSelectTrap?.();
    releaseBracketTrap?.();
    releaseCreateTrap = null;
    releaseSelectTrap = null;
    releaseBracketTrap = null;
    document.documentElement.classList.remove("yr-modal-open");
  }
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
});

document.addEventListener("input", (event) => {
  if (event.target.id === "ts-search") return renderSelectList();
  if (event.target.closest?.("#tournament-settings-form")) updateDirty();
});

document.addEventListener("click", async (event) => {
  if ($("tournament-app") && !event.target.closest?.("details.tourn-menu")) {
    document.querySelectorAll("#tournament-app details.tourn-menu[open]").forEach((menu) => { menu.open = false; });
  }
  const target = event.target.closest?.(
    "#tournament-primary, #tournament-reopen, #tournament-new, #tournament-create, #tournament-create-cancel, #tournament-create-modal, #tournament-settings-discard, #tournament-select-modal, #tournament-select-cancel, #tournament-select-submit, #tournament-bracket-expand, #tournament-bracket-close, #tournament-bracket-modal, [data-tournament-tab], [data-entry-action], [data-score-match]"
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
      target.closest("details.tourn-menu")?.removeAttribute("open");
      return await handleEntryAction(target);
    }
    if (target.matches("[data-score-match]")) return await submitScore(target.dataset.scoreMatch, target);
    if (target.id === "tournament-reopen") return await openSignups();
    if (target.id === "tournament-create" || target.id === "tournament-new") return await openCreateModal();
    if (target.id === "tournament-create-cancel") return closeCreateModal();
    if (target.id === "tournament-select-cancel") return closeSelectModal();
    if (target.id === "tournament-select-submit") return await submitSelect();
    if (target.id === "tournament-bracket-expand") return await openBracketModal();
    if (target.id === "tournament-bracket-close") return closeBracketModal();
    if (target.id === "tournament-settings-discard") {
      renderSettingsForm(lifecycleOf(tournament, matches.length));
      return clearFieldErrors();
    }
    if (target.id === "tournament-primary") return await handlePrimary();
  } catch (error) {
    setMessage(error.message || "Action failed.", true);
  }
});

if (!window.__yrSpaShell) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => enter(), { once: true });
  else enter();
}
