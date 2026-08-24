import { loadBoardShell } from "./dashboard/board-shell.js";
import { renderEmpty } from "./dashboard/states.js";
import { showConfirmModal } from "./dashboard/utils.js";
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

let siteId = "";
let board = {};
let tournament = null;
let entries = [];
let chatConnection = null;
let chatHistory = new Map();
let recentEntryTimestamps = [];
let entriesRefreshTimer = null;
let entriesRefreshRunning = false;
let entriesRefreshQueued = false;

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

function renderEntries() {
  const empty = $("tournament-entries-empty");
  const list = $("tournament-entry-list");
  if (!empty || !list) return;
  if (!entries.length) {
    list.hidden = true;
    empty.hidden = false;
    renderEmpty(empty, {
      compactHeading: true,
      title: tournament?.signup_state === "open" ? "Waiting for viewers" : "No entries yet",
      body: tournament?.signup_state === "open"
        ? `Ask viewers to type ${tournament.entry_keyword || "!join"} in chat.`
        : "Open signups when you are ready to collect names.",
      actions: [{ id: "tournament-empty-action", label: tournament?.signup_state === "open" ? "Show chat command" : "Open signups" }],
    });
    return;
  }

  empty.hidden = true;
  list.hidden = false;
  list.innerHTML = entries.map((entry) => {
    const flagged = tournament?.anti_alt_enabled && entry.alt_flag;
    const status = STATUS_LABELS[entry.status] || "Waiting";
    const name = esc(entry.display_name);
    const action = ["removed", "blocked"].includes(entry.status)
      ? `<button class="tournament-row-action" type="button" data-entry-action="restore" data-entry-id="${esc(entry.id)}" aria-label="Restore ${name}">Restore</button>`
      : `<button class="tournament-row-action" type="button" data-entry-action="remove" data-entry-id="${esc(entry.id)}" aria-label="Remove ${name}">Remove</button>
         <button class="tournament-row-action tournament-row-action--quiet" type="button" data-entry-action="block" data-entry-id="${esc(entry.id)}" aria-label="Block ${name}">Block</button>`;
    return `
      <li class="tournament-entry-row${flagged ? " is-flagged" : ""}" data-entry-id="${esc(entry.id)}">
        <div class="tournament-entry-main">
          <strong>${esc(entry.display_name)}</strong>
          <span>${esc(SOURCE_LABELS[entry.source] || entry.source)} · ${esc(status)}</span>
          ${flagged ? `<div class="tournament-entry-flag"><b>Review flag</b><span>— ${esc(entry.alt_reason || "Possible duplicate account.")}</span></div>` : ""}
        </div>
        <div class="tournament-entry-actions">${action}</div>
      </li>`;
  }).join("");
}

function renderTitle() {
  const titleEl = $("tournament-title-display");
  const gameEl = $("tournament-game-display");
  if (!titleEl || !gameEl) return;
  if (!tournament) {
    titleEl.hidden = true;
    gameEl.hidden = true;
    return;
  }
  titleEl.hidden = false;
  gameEl.hidden = false;
  titleEl.textContent = tournament.title || "Community tournament";
  gameEl.textContent = tournament.game_name || "Game";
}

function renderTournament() {
  const empty = $("tournament-empty");
  const listCard = $("tournament-list-card");
  const settings = $("tournament-settings");
  const primary = $("tournament-primary");
  const pickWrap = $("tournament-pick-count-wrap");
  const channelField = $("tournament-chat-channel")?.closest(".tournament-channel-field");
  const bracketCard = $("tournament-bracket-card");
  if (!tournament) {
    listCard.hidden = true;
    settings.hidden = true;
    primary.hidden = true;
    $("tournament-new").hidden = true;
    if (channelField) channelField.hidden = true;
    if (bracketCard) bracketCard.hidden = true;
    renderEmpty(empty, {
      compactHeading: true,
      title: "Start a tournament",
      body: "Create a simple entry list and let viewers join from chat.",
      actions: [{ id: "tournament-create-empty", label: "Create tournament", accent: true }],
    });
    empty.hidden = false;
    renderTitle();
    return;
  }
  const isFinished = tournament.status === "completed" || tournament.status === "cancelled";
  empty.hidden = true;
  listCard.hidden = isFinished;
  settings.hidden = isFinished;
  if (channelField) channelField.hidden = isFinished;
  if (isFinished) {
    $("tournament-step-label").textContent = tournament.status === "completed"
      ? `Champion: ${tournament.winner_name || "—"}`
      : "Tournament cancelled";
    $("tournament-count").textContent = "";
    primary.hidden = true;
    pickWrap.hidden = true;
    $("tournament-reopen").hidden = true;
    $("tournament-new").hidden = false;
  } else {
    const activeCount = entries.filter((entry) => ["pending", "confirmed", "selected"].includes(entry.status)).length;
    const eligibleCount = entries.filter((entry) => ["pending", "confirmed"].includes(entry.status)).length;
    $("tournament-count").textContent = `${activeCount}${tournament.entry_cap ? ` of ${tournament.entry_cap}` : ""} entries`;
    $("tournament-step-label").textContent = tournament.signup_state === "open"
      ? `Viewers can join with ${tournament.entry_keyword || "!join"}`
      : tournament.signup_state === "locked" ? "Signups are locked" : "Signups are closed";
    const picking = tournament.signup_state === "locked" || eligibleCount > 0 && tournament.signup_state !== "open";
    pickWrap.hidden = !picking;
    primary.textContent = tournament.signup_state === "open" ? "Lock signups" : eligibleCount ? "Pick participants" : "Open signups";
    if (tournament.signup_state === "open") primary.dataset.action = "lock";
    else if (eligibleCount) primary.dataset.action = "pick";
    else primary.dataset.action = "open";
    primary.hidden = primary.dataset.action === "open" && entries.length === 0;
    $("tournament-reopen").hidden = tournament.signup_state === "open" || eligibleCount === 0;
    $("tournament-new").hidden = entries.length === 0 && tournament.signup_state !== "locked";

    $("tournament-title").value = tournament.title || "";
    $("tournament-game").value = tournament.game_name || "";
    $("tournament-format").value = tournament.format || "bracket";
    $("tournament-entry-cap").value = tournament.entry_cap || "";
    $("tournament-keyword").value = tournament.entry_keyword || "!join";
    $("tournament-anti-alt").checked = tournament.anti_alt_enabled === true;
    $("tournament-chat-channel").value = tournament.chat_channel || board.kickChannelName || "";
  }
  renderTitle();
  renderEntries();
  loadBracket();
}

async function loadEntries() {
  if (!tournament) return;
  const data = await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/entries`);
  entries = data.entries || [];
  renderTournament();
}

async function loadTournament() {
  const data = await api("/api/tournaments");
  const tournaments = data.tournaments || [];
  // Prefer an active tournament, but keep a completed/cancelled one visible
  // so the bracket and champion survive reload/back navigation.
  const active = tournaments.find((item) => !["completed", "cancelled"].includes(item.status));
  tournament = active || tournaments[0] || null;
  entries = [];
  if (tournament) await loadEntries();
  else renderTournament();
}

async function createTournament() {
  const data = await api("/api/tournaments", {
    method: "POST",
    body: JSON.stringify({
      siteId,
      title: "Community tournament",
      gameName: "Game",
      bracketSize: 8,
      format: "bracket",
      participants: [],
    }),
  });
  tournament = data.tournament;
  await loadEntries();
}

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
  const channel = $("tournament-chat-channel")?.value.trim() || "";
  if (!channel) {
    setMessage("Add your Kick channel before opening signups.", true);
    $("tournament-chat-channel")?.focus();
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

async function handlePrimary() {
  if (!tournament) return createTournament();
  const action = $("tournament-primary").dataset.action;
  if (action === "open") {
    if (!await persistChatChannel()) return;
    await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/signups/open`, { method: "POST", body: "{}" });
    await loadTournament();
    return startChat();
  }
  if (action === "lock") {
    await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/signups/lock`, { method: "POST", body: "{}" });
    stopChat();
    return loadTournament();
  }
  if (action === "pick") {
    const count = Math.max(1, parseInt($("tournament-pick-count").value, 10) || 1);
    if (!await showConfirmModal("Pick participants", `Randomly pick ${count} entries and seed the bracket? This cannot be undone.`, "Pick and seed", true)) return;
    await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/entries/random-pick`, {
      method: "POST",
      body: JSON.stringify({ count }),
    });
    await loadEntries();
    await loadBracket();
    return;
  }
}

// The server refuses to open signups without a stored channel, so persist what
// the streamer typed before asking it to open them.
async function persistChatChannel() {
  const channel = $("tournament-chat-channel")?.value.trim() || "";
  if (!channel) {
    setMessage("Add your Kick channel before opening signups.", true);
    $("tournament-chat-channel")?.focus();
    return false;
  }
  if (channel === (tournament.chat_channel || "")) return true;
  await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/settings`, {
    method: "POST",
    body: JSON.stringify({ chatChannel: channel }),
  });
  tournament.chat_channel = channel;
  return true;
}

async function reopenSignups() {
  if (!tournament) return;
  if (!await persistChatChannel()) return;
  await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/signups/open`, {
    method: "POST",
    body: "{}",
  });
  await loadTournament();
  return startChat();
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

function groupBy(array, key) {
  return array.reduce((acc, item) => {
    const group = item[key] ?? "";
    (acc[group] = acc[group] || []).push(item);
    return acc;
  }, {});
}

async function loadBracket() {
  if (!tournament) return;
  const bracketCard = $("tournament-bracket-card");
  if (!bracketCard) return;
  try {
    const data = await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/bracket`);
    renderBracket(data);
  } catch (error) {
    bracketCard.hidden = true;
  }
}

function renderBracket(data) {
  const bracketCard = $("tournament-bracket-card");
  const bracket = $("tournament-bracket");
  const champion = $("tournament-champion");
  if (!bracketCard || !bracket || !champion) return;
  const matches = data.matches || [];
  const tourn = data.tournament || tournament || {};
  if (!matches.length && !tourn.winner_name) {
    bracketCard.hidden = true;
    return;
  }
  bracketCard.hidden = false;
  if (tourn.winner_name) {
    champion.hidden = false;
    champion.textContent = `Champion: ${esc(tourn.winner_name)}`;
  } else {
    champion.hidden = true;
  }
  const byRound = groupBy(matches, "round_number");
  const rounds = Object.keys(byRound).sort((a, b) => Number(a) - Number(b));
  bracket.innerHTML = rounds.map((round) => {
    const roundMatches = byRound[round].sort((a, b) => a.match_index - b.match_index);
    return `<div class="tournament-round"><h3>Round ${esc(round)}</h3>${roundMatches.map((match) => renderMatch(match)).join("")}</div>`;
  }).join("");
}

function renderMatch(match) {
  const p1 = match.player1_name || "TBD";
  const p2 = match.player2_name || "TBD";
  const isComplete = match.status === "completed";
  const p1Winner = isComplete && match.winner_name === p1;
  const p2Winner = isComplete && match.winner_name === p2;
  const canScore = !isComplete && p1 !== "TBD" && p2 !== "TBD";
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
  const matchEl = target.closest('.tournament-match');
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
  await loadBracket();
}

async function saveSettings(event) {
  event.preventDefault();
  const body = {
    title: $("tournament-title").value.trim(),
    gameName: $("tournament-game").value.trim(),
    format: $("tournament-format").value,
    entryCap: $("tournament-entry-cap").value,
    entryKeyword: $("tournament-keyword").value.trim() || "!join",
    antiAltEnabled: $("tournament-anti-alt").checked,
    chatChannel: $("tournament-chat-channel").value.trim(),
  };
  await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/settings`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  await loadTournament();
  if (tournament.signup_state === "open") {
    stopChat();
    await startChat();
  }
  setMessage("");
}

async function init() {
  if (!$("tournament-app")) return;
  try {
    const shell = await loadBoardShell();
    siteId = shell.activeSiteId || "";
    board = shell.board || {};
    $("tournament-settings-form")?.addEventListener("submit", (event) => {
      saveSettings(event).catch((error) => setMessage(error.message || "Could not save settings.", true));
    });
    await loadTournament();
    await startChat();
  } catch (error) {
    renderEmpty($("tournament-empty"), {
      compactHeading: true,
      title: "Tournament unavailable",
      body: error.message || "Try again in a moment.",
      actions: [{ id: "tournament-retry", label: "Try again" }],
    });
    $("tournament-empty").hidden = false;
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest?.("#tournament-primary, #tournament-reopen, #tournament-new, #tournament-create-empty, #tournament-empty-action, #tournament-retry, [data-entry-action], [data-score-match]");
  if (!target || !$("tournament-app")) return;
  event.preventDefault();
  try {
    if (target.id === "tournament-retry") return init();
    if (target.matches("[data-entry-action]")) return await handleEntryAction(target);
    if (target.matches("[data-score-match]")) return await submitScore(target.dataset.scoreMatch, target);
    if (target.id === "tournament-reopen") return await reopenSignups();
    if (target.id === "tournament-create-empty") return await createTournament();
    if (target.id === "tournament-new") return await createTournament();
    if (target.id === "tournament-empty-action" && tournament?.signup_state === "open") {
      return $("tournament-chat-channel")?.focus();
    }
    if (target.id === "tournament-empty-action") return await handlePrimary();
    if (target.id === "tournament-primary") return await handlePrimary();
  } catch (error) {
    setMessage(error.message || "Action failed.", true);
  }
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
