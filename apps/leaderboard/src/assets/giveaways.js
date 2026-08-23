import { loadBoardShell, sitePath } from "./dashboard/board-shell.js";
import { withDashboardTimeout, loginRedirectPath } from "./dashboard/request.js";
import { clearSession } from "./dashboard/session.js";
import { inlineStateHtml, renderInlineState } from "./dashboard/states.js";
import { showConfirmModal } from "./dashboard/utils.js";
import { computeTrustScore, connectKickChat } from "./chat-entry.js";

// Client-side script for Live Chat Keyword Listener & Giveaways
// Connects to Kick's Pusher WebSocket network in real-time

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
  // State
  let ws = null;
  let isListening = false;
  let chatroomId = null;
  let channelName = "";
  let targetKeyword = "!win";
  let entrants = []; // Array of { id, username, avatar, message, time, timestamp, trustScore, sybilFlag }
  let entrantIds = new Set();
  let messagesCount = 0;
  let verifiedCount = 0;
  let flaggedCount = 0;
  let sessionStartTime = null;
  let timerInterval = null;
  let currentWinner = null;
  let claimTimerInterval = null;
  let claimSecondsRemaining = 60;
  let winnerClaimed = false;
  let siteId = "";

  // Anti-Alt & Sybil Tracking
  const chatHistory = new Map(); // username -> message count
  const recentEntryTimestamps = []; // timestamps of recent entrants for burst detection
  let pastWinners = new Set();

  function pastWinnersKey() {
    return `yr_past_winners:${siteId || new URLSearchParams(location.search).get("siteId") || "default"}`;
  }

  function channelKey() {
    return `yr_gw_channel:${siteId || new URLSearchParams(location.search).get("siteId") || "default"}`;
  }

  function loadPastWinners() {
    try {
      const savedWinners = JSON.parse(localStorage.getItem(pastWinnersKey()) || "[]");
      pastWinners = new Set(savedWinners.map((w) => String(w).toLowerCase()));
    } catch {}
  }
  loadPastWinners();

  // DOM Elements
  const $ = (id) => document.getElementById(id);

  function init() {
    // Wire the giveaway UI first so a failing shell request can never leave the
    // page unresponsive.
    wireEvents();
    loadBoardShell().then((shell) => {
      siteId = shell.activeSiteId || "";
      autoFillChannel();
      window.__yrBoot?.signal();
    }).catch((error) => {
      window.__yrBoot?.fail(error?.message || "The dashboard shell could not be loaded.");
    });
    window.addEventListener("beforeunload", (event) => {
      if (isListening || entrants.length > 0 || currentWinner) {
        const message = "A giveaway is in progress. Refreshing will clear all entrants and the current winner.";
        event.preventDefault();
        event.returnValue = message;
        return message;
      }
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

  function showEngageError(message, fallbackId = "gw-status-text") {
    const fallback = $(fallbackId);
    if (fallback) {
      fallback.textContent = message;
      fallback.closest("[aria-live]")?.setAttribute("role", "alert");
    }
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
    "cd-drawer": ["cd-code", "cd-points", "cd-max", "cd-expire"],
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

  async function autoFillChannel() {
    // Check if channel is saved in localStorage or from site API
    const saved = localStorage.getItem(channelKey());
    if (saved) {
      $("gw-channel-input").value = saved;
    } else {
      try {
        const res = await dashboardFetch(sitePath("/api/credits/status"), { headers: { "Accept": "application/json" } });
        if (res.ok) {
          const data = await res.json();
          if (data.channel?.name) {
            $("gw-channel-input").value = data.channel.name;
          }
        }
      } catch {
        // ignore
      }
    }
  }

  function wireEvents() {
    document.addEventListener("keydown", trapEventDrawerFocus);
    $("gw-setup-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      toggleListening();
    });

    $("gw-btn-roll")?.addEventListener("click", () => rollWinner());
    $("gw-btn-reroll")?.addEventListener("click", () => rollWinner());
    $("gw-btn-copy-winner")?.addEventListener("click", (e) => copyWinnerDetails(e.currentTarget));
    $("gw-btn-export")?.addEventListener("click", () => exportCSV());
    $("gw-btn-reset")?.addEventListener("click", () => clearEntrants());

    $("gw-search-entrants")?.addEventListener("input", (e) => {
      filterEntrantsTable(e.target.value);
    });

    $("gw-opt-antialt")?.addEventListener("change", (e) => {
      const badge = $("gw-shield-status");
      const summary = $("gw-shield-summary");
      if (badge) {
        badge.textContent = e.target.checked ? "Active" : "Disabled";
        badge.className = e.target.checked ? "pill pill--good" : "pill pill--mute";
      }
      if (summary) summary.textContent = e.target.checked ? "Fair play active" : "Fair play off";
    });

    const closeModal = () => {
      const m = $("gw-winner-modal");
      if (m) m.hidden = true;
    };
    $("gw-modal-close")?.addEventListener("click", closeModal);
    $("gw-modal-done")?.addEventListener("click", closeModal);
    $("gw-modal-reroll")?.addEventListener("click", () => {
      closeModal();
      rollWinner();
    });
    $("gw-modal-copy")?.addEventListener("click", (e) => copyWinnerDetails(e.currentTarget));
  }

  function setStatus(state, text) {
    const badge = $("gw-status-badge");
    const statusText = $("gw-status-text");
    badge.className = `gw-status-pill gw-status--${state}`;
    statusText.textContent = text;
  }

  async function toggleListening() {
    if (isListening) {
      stopListening();
    } else {
      await startListening();
    }
  }

  async function startListening() {
    const inputChan = $("gw-channel-input").value.trim();
    const keyword = $("gw-keyword-input").value.trim();

    if (!inputChan) {
      $("gw-status-text").textContent = "Please enter a Kick channel name.";
      return;
    }
    if (!keyword) {
      $("gw-status-text").textContent = "Please enter a target keyword.";
      return;
    }

    targetKeyword = keyword;
    channelName = inputChan.toLowerCase().replace(/^@/, "");
    localStorage.setItem(channelKey(), channelName);

    $("gw-status-text").textContent = "Resolving Kick chatroom…";
    setStatus("connecting", "Connecting…");

    try {
      const res = await dashboardFetch(`/api/giveaways/chatroom?channel=${encodeURIComponent(channelName)}`);
      const data = await res.json();

      if (!data.ok || !data.chatroomId) {
        $("gw-status-text").textContent = data.error || "Could not resolve channel chatroom.";
        setStatus("error", "Error");
        return;
      }

      chatroomId = data.chatroomId;
      $("gw-status-text").textContent = `Connected to ${data.user || channelName}'s chatroom (ID: ${chatroomId})`;

      connectWebSocket();
    } catch (err) {
      $("gw-status-text").textContent = "Couldn't reach Kick. Check the channel name.";
      setStatus("error", "Error");
    }
  }

  function connectWebSocket() {
    if (ws) {
      try { ws.close(); } catch {}
    }

    ws = connectKickChat({
      chatroomId,
      onOpen: () => {
      isListening = true;
      setStatus("live", "Live & Listening");
      setListeningButtonState(true);

      // Start timer
      sessionStartTime = Date.now();
      clearInterval(timerInterval);
      timerInterval = setInterval(updateTimer, 1000);

      appendChatSystemMessage(`Connected to Kick chatroom (${channelName}). Listening for "${targetKeyword}" with Anti-Alt Shield…`);
      },
      onMessage: handleIncomingChatMessage,
      onError: (error) => {
        console.error("[giveaway] websocket error:", error);
        setStatus("error", "WS Error");
      },
      onClose: () => {
      if (isListening) {
        stopListening();
        appendChatSystemMessage("Disconnected from Kick chatroom.");
      }
      },
    });
  }

  function stopListening() {
    isListening = false;
    if (ws) {
      try { ws.close(); } catch {}
      ws = null;
    }
    clearInterval(timerInterval);
    clearInterval(claimTimerInterval);
    setStatus("idle", "Disconnected");
    setListeningButtonState(false);
  }

  function setListeningButtonState(listening) {
    const label = $("gw-listen-btn-label");
    const button = $("gw-btn-listen");
    if (label) label.textContent = listening ? "Stop Listening" : "Connect & Start Listening";
    if (button) {
      button.classList.toggle("btn--accent", !listening);
      button.classList.toggle("btn--danger", listening);
    }
  }

  function handleIncomingChatMessage(chatData) {
    if (!chatData || !chatData.content || !chatData.sender) return;

    messagesCount++;
    const feedCounter = $("gw-feed-counter");
    if (feedCounter) feedCounter.textContent = `${messagesCount.toLocaleString()} msgs`;

    const sender = chatData.sender;
    const username = sender.username || sender.slug || "Anonymous";
    const userId = String(sender.id || username);
    const content = String(chatData.content || "");
    const avatar = sender.profile_thumb || sender.profile_pic || null;
    const now = Date.now();

    // Track chat history count (bounded to 2000 entries)
    const unameLower = username.toLowerCase();
    if (chatHistory.size > 2000) {
      const oldestKey = chatHistory.keys().next().value;
      if (oldestKey) chatHistory.delete(oldestKey);
    }
    chatHistory.set(unameLower, (chatHistory.get(unameLower) || 0) + 1);

    // Live claim check and dedicated winner chat feed routing
    if (currentWinner && unameLower === currentWinner.username.toLowerCase()) {
      const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      appendWinnerChatMessage(username, content, timeStr);
      if (!winnerClaimed) {
        confirmWinnerLiveClaim(content);
      }
    }

    // Check keyword matching
    const optCase = $("gw-opt-case").checked;
    const optExact = $("gw-opt-exact").checked;
    const optUnique = $("gw-opt-unique").checked;

    let isMatch = false;
    if (optCase) {
      isMatch = optExact ? content.trim() === targetKeyword : content.includes(targetKeyword);
    } else {
      const lowerContent = content.trim().toLowerCase();
      const lowerKeyword = targetKeyword.toLowerCase();
      isMatch = optExact ? lowerContent === lowerKeyword : lowerContent.includes(lowerKeyword);
    }

    // Append to live chat ticker
    appendChatFeedMessage(username, content, isMatch);

    if (isMatch) {
      if (optUnique && entrantIds.has(userId.toLowerCase())) {
        return; // Already entered
      }

      recentEntryTimestamps.push(now);
      if (recentEntryTimestamps.length > 50) recentEntryTimestamps.shift();

      const { trustScore, sybilFlag } = computeTrustScore(username, content, now, {
        chatHistory,
        recentEntryTimestamps,
        pastWinners,
      });

      const badges = sender.identity?.badges || sender.badges || [];
      const isSub = badges.some((b) => b.type === "subscriber" || b.type === "founder" || b.type === "sub_gifter");
      const isVip = badges.some((b) => b.type === "vip" || b.type === "moderator" || b.type === "broadcaster");

      const entrant = {
        id: userId.toLowerCase(),
        username: username,
        avatar: avatar,
        message: content,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        timestamp: now,
        trustScore: trustScore,
        sybilFlag: sybilFlag,
        isSub: isSub,
        isVip: isVip,
        badges: badges,
      };

      entrantIds.add(entrant.id);
      entrants.push(entrant);

      if (trustScore >= 70) verifiedCount++;
      else if (trustScore < 50) flaggedCount++;

      renderEntrantRow(entrant, entrants.length);
      updateEntrantsCount();
    }
  }

  function confirmWinnerLiveClaim(messageText) {
    winnerClaimed = true;
    clearInterval(claimTimerInterval);

    const updateElem = (statusId, dotId, fillId, countId) => {
      const status = $(statusId);
      const dot = $(dotId);
      const fill = $(fillId);
      const countdown = $(countId);

      if (status) {
        status.textContent = `Confirmed active. Responded: "${messageText}"`;
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

    updateElem("gw-claim-status", "gw-claim-dot", "gw-claim-fill", "gw-claim-countdown");
    updateElem("gw-modal-claim-status", "gw-modal-claim-dot", "gw-modal-claim-fill", "gw-modal-claim-countdown");
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

  function appendChatFeedMessage(username, content, isMatch) {
    const feed = $("gw-chat-feed");
    const empty = $("gw-feed-empty");
    if (empty) empty.remove();

    const row = document.createElement("div");
    row.className = `gw-chat-msg ${isMatch ? "gw-chat-msg--match" : ""}`;

    const userSpan = document.createElement("span");
    userSpan.className = "gw-chat-user";
    userSpan.textContent = username + ":";

    const textSpan = document.createElement("span");
    textSpan.className = "gw-chat-text";

    if (isMatch) {
      const mark = document.createElement("mark");
      mark.textContent = content;
      textSpan.replaceChildren(mark);
    } else {
      textSpan.textContent = ` ${content}`;
    }

    row.appendChild(userSpan);
    row.appendChild(textSpan);
    feed.appendChild(row);

    // Keep at most 80 messages in feed
    while (feed.children.length > 80) {
      feed.removeChild(feed.firstChild);
    }

    feed.scrollTop = feed.scrollHeight;
  }

  function appendChatSystemMessage(text) {
    const feed = $("gw-chat-feed");
    const empty = $("gw-feed-empty");
    if (empty) empty.remove();

    const row = document.createElement("div");
    row.className = "gw-chat-msg gw-chat-msg--system";
    row.textContent = text;
    feed.appendChild(row);
    feed.scrollTop = feed.scrollHeight;
  }

  function renderEntrantRow(entrant, index) {
    const tbody = $("gw-entrants-list");
    const empty = $("gw-entrants-empty");
    if (empty) empty.hidden = true;

    const tr = document.createElement("tr");
    tr.id = `entrant-${entrant.id}`;
    tr.dataset.username = entrant.username.toLowerCase();

    const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2394a3b8'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";

    const numberCell = document.createElement("td");
    numberCell.className = "ta-c gw-number-cell";
    numberCell.textContent = String(index);

    const userCell = document.createElement("td");
    const userWrap = document.createElement("div");
    userWrap.className = "gw-entrant-user";
    const avatar = document.createElement("img");
    avatar.className = "gw-entrant-avatar";
    avatar.src = safeAvatarUrl(entrant.avatar, defaultAvatar);
    avatar.alt = "";
    avatar.addEventListener("error", () => {
      avatar.src = defaultAvatar;
    }, { once: true });
    const userLink = document.createElement("a");
    userLink.className = "gw-entrant-name";
    userLink.href = safeKickProfileUrl(entrant.username);
    userLink.target = "_blank";
    userLink.rel = "noopener";
    userLink.textContent = entrant.username;
    userWrap.append(avatar, userLink);

    if (entrant.isSub) {
      const subBadge = document.createElement("span");
      subBadge.className = "gw-sub-badge";
      subBadge.textContent = "Subscriber";
      userWrap.append(subBadge);
    } else if (entrant.isVip) {
      const vipBadge = document.createElement("span");
      vipBadge.className = "gw-vip-badge";
      vipBadge.textContent = "VIP";
      userWrap.append(vipBadge);
    }

    userCell.append(userWrap);

    // Status Badge Column
    const trustCell = document.createElement("td");
    const trustBadge = document.createElement("span");
    const score = entrant.trustScore || 75;
    if (score >= 70) {
      trustBadge.className = "gw-trust-badge gw-trust-badge--high";
      trustBadge.textContent = "Verified";
    } else if (score >= 50) {
      trustBadge.className = "gw-trust-badge gw-trust-badge--med";
      trustBadge.textContent = "Regular";
    } else {
      trustBadge.className = "gw-trust-badge gw-trust-badge--low";
      trustBadge.textContent = "Suspected alt";
    }
    trustCell.append(trustBadge);

    const messageCell = document.createElement("td");
    const message = document.createElement("span");
    message.className = "gw-entrant-msg";
    message.textContent = entrant.message;
    messageCell.append(message);

    const timeCell = document.createElement("td");
    timeCell.className = "gw-time-cell";
    timeCell.textContent = entrant.time;

    const actionCell = document.createElement("td");
    actionCell.className = "ta-r";
    const removeButton = document.createElement("button");
    removeButton.className = "btn btn--sm btn--ghost btn--danger-text";
    removeButton.type = "button";
    removeButton.dataset.removeId = String(entrant.id);
    removeButton.title = "Remove entrant";
    removeButton.textContent = "✕";
    actionCell.append(removeButton);

    tr.append(numberCell, userCell, trustCell, messageCell, timeCell, actionCell);
    removeButton.addEventListener("click", () => {
      removeEntrant(entrant.id);
    });

    tbody.appendChild(tr);
  }

  function removeEntrant(id) {
    const entrant = entrants.find((e) => e.id === id);
    if (entrant) {
      if (entrant.trustScore >= 70) verifiedCount = Math.max(0, verifiedCount - 1);
      else if (entrant.trustScore < 50) flaggedCount = Math.max(0, flaggedCount - 1);
    }
    entrantIds.delete(id);
    entrants = entrants.filter((e) => e.id !== id);
    const tr = $(`entrant-${id}`);
    if (tr) tr.remove();
    updateEntrantsCount();
    reindexTable();
  }

  function reindexTable() {
    const rows = $("gw-entrants-list")?.querySelectorAll("tr") || [];
    rows.forEach((row, idx) => {
      const firstCol = row.querySelector("td");
      if (firstCol) firstCol.textContent = idx + 1;
    });
  }

  function updateEntrantsCount() {
    const count = entrants.length;
    $("gw-stat-entrants").textContent = count.toLocaleString();
    $("gw-count-header").textContent = count.toLocaleString();
    if ($("gw-stat-verified")) $("gw-stat-verified").textContent = verifiedCount.toLocaleString();
    if ($("gw-stat-flagged")) $("gw-stat-flagged").textContent = flaggedCount.toLocaleString();

    const rollBtn = $("gw-btn-roll");
    const exportBtn = $("gw-btn-export");
    const clearBtn = $("gw-btn-reset");
    const emptyState = $("gw-entrants-empty");

    if (count > 0) {
      rollBtn?.removeAttribute("disabled");
      exportBtn?.removeAttribute("disabled");
      clearBtn?.removeAttribute("disabled");
      if (emptyState) emptyState.hidden = true;
    } else {
      rollBtn?.setAttribute("disabled", "true");
      exportBtn?.setAttribute("disabled", "true");
      clearBtn?.setAttribute("disabled", "true");
      if (emptyState) emptyState.hidden = false;
    }
  }

  async function clearEntrants() {
    if (!await showConfirmModal("Clear giveaway entrants", "Remove all current entrants from this giveaway?", "Clear entrants", true)) return;
    entrants = [];
    entrantIds.clear();
    verifiedCount = 0;
    flaggedCount = 0;
    $("gw-entrants-list").innerHTML = "";
    updateEntrantsCount();
    $("gw-winner-stage").hidden = true;
    $("gw-stage-idle").hidden = false;
    clearInterval(claimTimerInterval);
  }

  function filterEntrantsTable(query) {
    const term = query.toLowerCase().trim();
    const rows = $("gw-entrants-list")?.querySelectorAll("tr") || [];
    rows.forEach((row) => {
      const username = row.dataset.username || "";
      row.hidden = term ? !username.includes(term) : false;
    });
  }

  function getEligibleEntrantsPool() {
    if (entrants.length === 0) return [];

    const optAntiAlt = $("gw-opt-antialt")?.checked;
    const minTrust = parseInt($("gw-trust-min")?.value || "0", 10);
    const optExcludePrev = $("gw-opt-skip-past")?.checked;

    // Advanced requirement controls
    const subsPerk = $("gw-opt-subs-perk")?.value || "all";
    const minMsgs = parseInt($("gw-opt-min-msgs")?.value || "0", 10);

    let pool = entrants;

    // Filter out previous winners if enabled
    loadPastWinners();
    if (optExcludePrev) {
      const filtered = pool.filter((e) => !pastWinners.has(e.username.toLowerCase()));
      if (filtered.length > 0) pool = filtered;
    }

    // Filter by minimum trust score if enabled
    if (optAntiAlt && minTrust > 0) {
      const filtered = pool.filter((e) => (e.trustScore || 75) >= minTrust);
      if (filtered.length > 0) pool = filtered;
    }

    // Advanced: Subscribers & VIPs only
    if (subsPerk === "subs_only") {
      const filtered = pool.filter((e) => e.isSub || e.isVip);
      if (filtered.length > 0) {
        pool = filtered;
      } else {
        showEngageError("No subscribers or VIPs found in the entrants pool yet. Try 'Open to All Viewers' or wait for subscribers to enter.");
        return [];
      }
    }

    // Advanced: Minimum chat messages in stream
    if (minMsgs > 0) {
      const filtered = pool.filter((e) => (chatHistory.get(e.username.toLowerCase()) || 0) >= minMsgs);
      if (filtered.length > 0) pool = filtered;
    }

    // Advanced: Subscribers Luck Multiplier (Double/Triple tickets in draw)
    let mult = 1;
    if (subsPerk === "subs_2x") mult = 2;
    else if (subsPerk === "subs_3x") mult = 3;
    else if (subsPerk === "subs_5x") mult = 5;

    if (mult > 1) {
      const weighted = [];
      pool.forEach((e) => {
        const times = (e.isSub || e.isVip) ? mult : 1;
        for (let i = 0; i < times; i++) {
          weighted.push(e);
        }
      });
      pool = weighted;
    }

    return pool;
  }

  function rollWinner() {
    const pool = getEligibleEntrantsPool();
    if (pool.length === 0) {
      if (entrants.length === 0) return;
      showEngageError("No entrants meet your active giveaway rules. Try changing your rules or clearing entrants.");
      return;
    }

    const rollBtn = $("gw-btn-roll");
    const roller = $("gw-stage-idle");
    const track = $("gw-roller-track");
    const showcase = $("gw-winner-stage");

    rollBtn.setAttribute("disabled", "true");
    showcase.hidden = true;
    roller.hidden = false;
    track?.classList.add("gw-roller-track--spinning");
    clearInterval(claimTimerInterval);

    // Fast-cycle suspense names for 2.2 seconds
    let count = 0;
    const interval = setInterval(() => {
      const randomCandidate = pool[Math.floor(Math.random() * pool.length)];
      if (track) track.textContent = randomCandidate.username;
      count++;
    }, 80);

    setTimeout(() => {
      clearInterval(interval);
      track?.classList.remove("gw-roller-track--spinning");
      roller.hidden = true;
      rollBtn.removeAttribute("disabled");

      // Cryptographically secure winner selection from the verified pool
      const array = new Uint32Array(1);
      crypto.getRandomValues(array);
      const winnerIndex = array[0] % pool.length;
      const winner = pool[winnerIndex];
      currentWinner = winner;

      // Save winner to past winners registry
      pastWinners.add(winner.username.toLowerCase());
      try {
        localStorage.setItem(pastWinnersKey(), JSON.stringify(Array.from(pastWinners)));
      } catch {}

      displayWinner(winner);
      playWinnerSound();

      // Start live 60s claim proof timer if enabled
      if ($("gw-opt-claim-req")?.checked) {
        startClaimTimer(winner);
      } else {
        $("gw-claim-box").hidden = true;
      }
    }, 2200);
  }

  function startClaimTimer(winner) {
    const totalSecs = parseInt($("gw-opt-claim-duration")?.value || "60", 10);
    winnerClaimed = false;
    claimSecondsRemaining = totalSecs;

    const setInitial = (boxId, statusId, dotId, countId, fillId) => {
      const box = $(boxId);
      const status = $(statusId);
      const count = $(countId);
      const fill = $(fillId);
      const dot = $(dotId);

      if (box) box.hidden = false;
      if (status) {
        status.textContent = `Waiting for @${winner.username} to chat...`;
        status.classList.remove("gw-claim-status--confirmed", "gw-claim-status--expired");
        status.classList.add("gw-claim-status--waiting");
      }
      if (dot) dot.className = "gw-claim-dot gw-claim-dot--waiting";
      if (count) count.textContent = `${totalSecs}s`;
      if (fill) {
        fill.style.width = "100%";
        fill.classList.remove("gw-claim-bar-fill--confirmed", "gw-claim-bar-fill--warning", "gw-claim-bar-fill--expired");
      }
    };

    setInitial("gw-claim-box", "gw-claim-status", "gw-claim-dot", "gw-claim-countdown", "gw-claim-fill");
    setInitial("gw-modal-claim-box", "gw-modal-claim-status", "gw-modal-claim-dot", "gw-modal-claim-countdown", "gw-modal-claim-fill");

    clearInterval(claimTimerInterval);
    claimTimerInterval = setInterval(() => {
      claimSecondsRemaining--;

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

        if (claimSecondsRemaining <= 0) {
          if (!winnerClaimed) {
            if (status) {
              status.textContent = `@${winner.username} did not respond within ${totalSecs}s (AFK / suspected alt).`;
              status.classList.remove("gw-claim-status--waiting", "gw-claim-status--confirmed");
              status.classList.add("gw-claim-status--expired");
            }
            if (dot) dot.className = "gw-claim-dot gw-claim-dot--expired";
            if (fill) {
              fill.classList.remove("gw-claim-bar-fill--confirmed", "gw-claim-bar-fill--warning");
              fill.classList.add("gw-claim-bar-fill--expired");
            }
          }
        }
      };

      updateTick("gw-claim-countdown", "gw-claim-fill", "gw-claim-status", "gw-claim-dot");
      updateTick("gw-modal-claim-countdown", "gw-modal-claim-fill", "gw-modal-claim-status", "gw-modal-claim-dot");

      if (claimSecondsRemaining <= 0) {
        clearInterval(claimTimerInterval);
      }
    }, 1000);
  }

  function displayWinner(winner) {
    const showcase = $("gw-winner-stage");
    const modal = $("gw-winner-modal");
    const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2394a3b8'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";

    const customRule = $("gw-custom-rule-text")?.value?.trim();
    const msgText = customRule ? `"${winner.message}" — Requirement: ${customRule}` : `"${winner.message}"`;

    // Populate inline showcase
    $("gw-winner-name").textContent = winner.username;
    $("gw-winner-message").textContent = msgText;
    $("gw-winner-avatar").src = safeAvatarUrl(winner.avatar, defaultAvatar);

    // Populate Celebration Modal
    $("gw-modal-name").textContent = winner.username;
    $("gw-modal-msg").textContent = msgText;
    $("gw-modal-avatar").src = safeAvatarUrl(winner.avatar, defaultAvatar);

    const score = winner.trustScore || 75;
    let badgeClass = "gw-trust-badge gw-trust-badge--high";
    let badgeLabel = "Verified Viewer";
    if (score < 50) {
      badgeClass = "gw-trust-badge gw-trust-badge--low";
      badgeLabel = "Suspected Alt";
    } else if (score < 70) {
      badgeClass = "gw-trust-badge gw-trust-badge--med";
      badgeLabel = "Regular Viewer";
    }

    const trustBadge = $("gw-winner-trust");
    if (trustBadge) {
      trustBadge.textContent = badgeLabel;
      trustBadge.className = badgeClass;
    }

    const modalTrustBadge = $("gw-modal-trust-badge");
    if (modalTrustBadge) {
      modalTrustBadge.textContent = badgeLabel;
      modalTrustBadge.className = badgeClass;
    }

    // Reset and seed dedicated winner chat log with their entry message
    const winnerFeed = $("gw-winner-chat-feed");
    if (winnerFeed) {
      winnerFeed.innerHTML = "";
      appendWinnerChatMessage(winner.username, winner.message, winner.time);
    }

    if ($("gw-stage-idle")) $("gw-stage-idle").hidden = true;
    if (showcase) showcase.hidden = false;
    if (modal) modal.hidden = false;
    if (showcase) showcase.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
    const score = currentWinner.trustScore || 75;
    const status = score >= 70 ? "Verified Viewer" : score >= 50 ? "Regular Viewer" : "Suspected Alt";
    const text = `Giveaway Winner: ${currentWinner.username}\nStatus: ${status}\nMessage: "${currentWinner.message}"\nTime: ${currentWinner.time}\nKick Profile: https://kick.com/${currentWinner.username}`;
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

    let csv = "Index,Kick Username,Trust Score,Chat Message,Entered At,Kick Profile URL\n";
    entrants.forEach((e, idx) => {
      const cleanName = sanitizeCsvField(e.username);
      const cleanMsg = sanitizeCsvField(e.message);
      const cleanUrl = sanitizeCsvField(`https://kick.com/${e.username}`);
      csv += `${idx + 1},${cleanName},${e.trustScore || 75}%,${cleanMsg},${e.time},${cleanUrl}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kick-giveaway-entrants-${channelName || "stream"}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function updateTimer() {
    if (!sessionStartTime) return;
    const elapsedSec = Math.floor((Date.now() - sessionStartTime) / 1000);
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
  // COMMUNITY EVENTS HUB: RAFFLES & FLASH CODE DROPS
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
    if (activeTab === "drops") loadCodeDrops();
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
      const activeTab = document.querySelector(".gw-tab-btn.is-active")?.dataset.tab;
      if (activeTab === "drops") {
        openEventDrawer("cd-drawer", event.currentTarget);
      } else if (activeTab === "preds") {
        openEventDrawer("pred-drawer", event.currentTarget);
      } else {
        openEventDrawer("rf-drawer", event.currentTarget);
      }
    });
    $("btn-create-raffle")?.addEventListener("click", (event) => openEventDrawer("rf-drawer", event.currentTarget));
    $("rf-drawer-close")?.addEventListener("click", () => closeEventDrawer("rf-drawer"));
    $("rf-cancel")?.addEventListener("click", () => closeEventDrawer("rf-drawer", { clear: true }));

    $("btn-create-drop")?.addEventListener("click", (event) => openEventDrawer("cd-drawer", event.currentTarget));
    $("cd-drawer-close")?.addEventListener("click", () => closeEventDrawer("cd-drawer"));
    $("cd-cancel")?.addEventListener("click", () => closeEventDrawer("cd-drawer", { clear: true }));

    $("btn-create-pred")?.addEventListener("click", (event) => openEventDrawer("pred-drawer", event.currentTarget));
    $("pred-drawer-close")?.addEventListener("click", () => closeEventDrawer("pred-drawer"));
    $("pred-cancel")?.addEventListener("click", () => closeEventDrawer("pred-drawer", { clear: true }));

    $("settle-drawer-close")?.addEventListener("click", () => closeEventDrawer("settle-drawer"));
    $("settle-btn-confirm")?.addEventListener("click", () => settlePrediction());
    $("settle-btn-cancel-pred")?.addEventListener("click", () => cancelPrediction());

    // Random code generator
    $("cd-btn-random")?.addEventListener("click", () => {
      const prefixes = ["WIN", "BOOST", "DROP", "LUCK", "RACE", "KICK", "PRO"];
      const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
      const num = Math.floor(100 + Math.random() * 900);
      const input = $("cd-code");
      if (input) input.value = `${prefix}${num}`;
    });

    // Forms
    $("rf-form")?.addEventListener("submit", handleCreateRaffleSubmit);
    $("cd-form")?.addEventListener("submit", handleCreateDropSubmit);
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
        ${inlineStateHtml({ kind: "empty", title: "No active raffles", body: "Create a raffle to let viewers buy tickets with Credits." })}`;
    } else {
      activeList.innerHTML = active.map((r) => `
        <div class="gw-raffle-card" data-raffle-id="${esc(r.id)}">
          <div class="gw-raffle-header">
            <div>
              <span class="pill pill--good">Active Raffle</span>
              <h3 class="gw-raffle-title">${esc(r.title)}</h3>
              ${r.description ? `<p class="gw-raffle-desc">${esc(r.description)}</p>` : ""}
            </div>
            <div class="gw-raffle-badge">
              <strong>${r.ticket_cost === 0 ? "FREE" : `${r.ticket_cost} Credits`}</strong>
              <small>per ticket</small>
            </div>
          </div>
          <div class="gw-raffle-stats-row">
            <div><strong>${r.total_tickets || 0}</strong><span>Tickets Sold</span></div>
            <div><strong>${r.participant_count || 0}</strong><span>Participants</span></div>
            <div><strong>${r.max_tickets_per_viewer || 10}</strong><span>Max / Viewer</span></div>
          </div>
          <div class="gw-raffle-footer">
            <button class="btn btn--accent btn--draw-raffle" data-id="${esc(r.id)}" type="button">
              Draw Random Winner
            </button>
          </div>
        </div>
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
          <td><strong>${esc(r.title)}</strong></td>
          <td>${r.ticket_cost === 0 ? "Free" : `${r.ticket_cost} Credits`}</td>
          <td>${r.total_tickets || 0} tickets</td>
          <td>
            ${r.winner_name ? `<strong>${esc(r.winner_name)}</strong> <small>(Ticket #${r.winner_ticket_number})</small>` : "<em>No winner</em>"}
          </td>
          <td>${r.drawn_at ? new Date(r.drawn_at).toLocaleString() : "—"}</td>
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

      // Show winner celebration modal
      const modal = $("gw-winner-modal");
      if (modal) {
        $("gw-modal-name").textContent = data.winnerName || "No winner";
        $("gw-modal-msg").textContent = data.winnerTicketNumber ? `Winning Ticket #${data.winnerTicketNumber} (out of ${data.totalTickets} tickets)` : "No tickets were sold.";
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

  async function loadCodeDrops() {
    const activeList = $("cd-active-list");
    try {
      const res = await dashboardFetch("/api/events/drops");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (activeList) {
          renderInlineState(activeList, { kind: "error", title: "Couldn't load drops", body: data.error || "Something went wrong. Try again.", actions: [{ label: "Retry", onClick: loadCodeDrops }] });
        }
        return;
      }
      const data = await res.json();
      renderCodeDrops(data.drops || []);
    } catch (err) {
      if (activeList) {
        renderInlineState(activeList, { kind: "error", title: "Couldn't load drops", body: "Network error. Check your connection and try again.", actions: [{ label: "Retry", onClick: loadCodeDrops }] });
      }
    }
  }

  function renderCodeDrops(drops) {
    const activeList = $("cd-active-list");
    const pastList = $("cd-past-list");
    if (!activeList || !pastList) return;

    const active = drops.filter((d) => d.status === "active");
    const past = drops.filter((d) => d.status !== "active");

    if (active.length === 0) {
      activeList.innerHTML = `
        ${inlineStateHtml({ kind: "empty", title: "No active flash drops", body: "Launch a flash drop code to reward active stream viewers in real time." })}`;
    } else {
      activeList.innerHTML = active.map((d) => {
        const pct = Math.min(100, Math.round(((d.claimed_count || 0) / (d.max_claims || 1)) * 100));
        return `
          <div class="gw-drop-card">
            <div class="gw-drop-header">
              <div class="d-flex items-center gap-8">
                <code class="gw-drop-code-badge">${esc(d.code)}</code>
                <button class="btn btn--sm btn--ghost btn--copy-drop" data-code="${esc(d.code)}" type="button" aria-label="Copy code ${esc(d.code)}">Copy</button>
              </div>
              <span class="pill pill--good">+${d.points_reward} Credits</span>
            </div>
            <div class="gw-drop-progress-box">
              <div class="d-flex justify-between font-12 mb-4">
                <span>Claims Progress</span>
                <strong>${d.claimed_count || 0} / ${d.max_claims} claimed (${pct}%)</strong>
              </div>
              <div class="gw-drop-bar-bg"><div class="gw-drop-bar-fill" style="width: ${pct}%;"></div></div>
            </div>
            <div class="font-12 font-muted mt-8">
              ${d.expires_at ? `Expires: ${new Date(d.expires_at).toLocaleTimeString()}` : "No time limit"}
            </div>
          </div>
        `;
      }).join("");

      activeList.querySelectorAll(".btn--copy-drop").forEach((btn) => {
        btn.addEventListener("click", () => {
          navigator.clipboard?.writeText(btn.dataset.code);
          flashButtonLabel(btn, "Copied", 1500);
        });
      });
    }

    if (past.length === 0) {
      pastList.innerHTML = `<tr><td colspan="5">${inlineStateHtml({ kind: "empty", title: "No drops created yet", body: "Create a drop to reward active viewers with a limited-claim code." })}</td></tr>`;
    } else {
      pastList.innerHTML = past.map((d) => `
        <tr>
          <td><code>${esc(d.code)}</code></td>
          <td>+${d.points_reward} Credits</td>
          <td>${d.claimed_count || 0} / ${d.max_claims}</td>
          <td><span class="pill pill--mute">${esc(d.status)}</span></td>
          <td>${new Date(d.created_at).toLocaleString()}</td>
        </tr>
      `).join("");
    }
  }

  async function handleCreateDropSubmit(e) {
    e.preventDefault();
    setInlineStatus("cd-status", "");
    if (!validateDrawer("cd-form", [
      { id: "cd-code", message: "Enter a drop code.", valid: (value) => Boolean(value.trim()) },
      { id: "cd-points", message: "Enter a reward of at least 1 Credit.", valid: (value) => /^\d+$/.test(value) && Number(value) >= 1 },
      { id: "cd-max", message: "Enter at least 1 claim.", valid: (value) => /^\d+$/.test(value) && Number(value) >= 1 },
    ])) return;
    const code = $("cd-code")?.value?.trim();

    const points = parseInt($("cd-points")?.value, 10) || 100;
    const maxClaims = parseInt($("cd-max")?.value, 10) || 50;
    const expireMinutes = parseInt($("cd-expire")?.value, 10) || 0;

    const submit = $("cd-submit");
    const original = submit?.innerHTML;
    if (submit) { submit.disabled = true; submit.textContent = "Launching…"; }
    try {
      const res = await dashboardFetch("/api/events/drops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, pointsReward: points, maxClaims, expireMinutes }),
      });
      const data = await responseData(res);
      if (!res.ok) {
        setInlineStatus("cd-status", data.error || "Failed to launch drop", true);
        return;
      }
      clearDraft("cd-drawer");
      closeEventDrawer("cd-drawer");
      $("cd-code").value = "";
      loadCodeDrops();
    } catch {
      setInlineStatus("cd-status", "Network error launching drop.", true);
    } finally {
      if (submit) { submit.disabled = false; submit.innerHTML = original; }
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
        const rawOpts = typeof p.options === "string" ? JSON.parse(p.options) : (p.options || []);
        const totalPool = p.total_pool || 0;
        return `
          <div class="gw-pred-card" data-pred-id="${esc(p.id)}">
            <div class="gw-pred-header">
              <div>
                <span class="pill ${p.status === "open" ? "pill--good" : "pill--info"}">
                  ${p.status === "open" ? "Betting Open" : "Betting Locked"}
                </span>
                <h3 class="gw-pred-title">${esc(p.title)}</h3>
              </div>
              <div class="gw-pred-pool-badge">
              <strong>${totalPool} Credits</strong>
                <small>Total Pool</small>
              </div>
            </div>

            <!-- Options & Odds Bar -->
            <div class="gw-pred-options-grid">
              ${rawOpts.map((opt) => {
                const optPts = opt.total_points || 0;
                const pct = totalPool > 0 ? Math.round((optPts / totalPool) * 100) : 50;
                return `
                  <div class="gw-pred-opt-box">
                    <div class="d-flex justify-between font-13 font-bold mb-4">
                      <span>${esc(opt.label)}</span>
                      <span>${optPts} Credits (${pct}%)</span>
                    </div>
                    <div class="gw-drop-bar-bg">
                      <div class="gw-drop-bar-fill" style="width: ${pct}%;"></div>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>

            <div class="gw-pred-stats-row">
              <div><strong>${p.participant_count || 0}</strong><span>Bettors</span></div>
              <div><strong>${p.min_bet} - ${p.max_bet}</strong><span>Bet Limits</span></div>
              <div><strong>${p.lock_at ? new Date(p.lock_at).toLocaleTimeString() : "Manual"}</strong><span>Lock Time</span></div>
            </div>

            <div class="gw-pred-footer">
              ${p.status === "open" ? `
                <button class="btn btn--sm btn--ghost btn--lock-pred" data-id="${esc(p.id)}" type="button">
                  Lock Betting
                </button>
              ` : ""}
              <button class="btn btn--sm btn--accent btn--open-settle" data-id="${esc(p.id)}" type="button">
                Settle Outcome &amp; Payout
              </button>
              <button class="btn btn--sm btn--danger btn--cancel-pred" data-id="${esc(p.id)}" type="button">
                Cancel &amp; refund all bets
              </button>
            </div>
          </div>
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
              ${p.winning_option_id ? `<span class="pill pill--good">${esc(p.winning_option_id.toUpperCase())}</span>` : "—"}
            </td>
            <td><span class="pill pill--mute">${esc(p.status)}</span></td>
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

    const rawOpts = typeof pred.options === "string" ? JSON.parse(pred.options) : (pred.options || []);
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
  // injected fragment DOM. leave() tears down the WebSocket, all intervals,
  // and removes the document-level keydown listener so nothing leaks.
  function giveawaysEnter() {
    // Reset live-chat state so a stale session doesn't carry over.
    if (ws) { try { ws.close(); } catch {} ws = null; }
    isListening = false;
    clearInterval(timerInterval); timerInterval = null;
    clearInterval(claimTimerInterval); claimTimerInterval = null;
    entrants = []; entrantIds = new Set();
    messagesCount = 0; verifiedCount = 0; flaggedCount = 0;
    sessionStartTime = null; currentWinner = null;
    init();
    initEventsHub();
  }

  function giveawaysLeave() {
    // Close the Kick chat WebSocket.
    if (ws) { try { ws.close(); } catch {} ws = null; }
    isListening = false;
    // Clear all polling/timer intervals.
    clearInterval(timerInterval); timerInterval = null;
    clearInterval(claimTimerInterval); claimTimerInterval = null;
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
