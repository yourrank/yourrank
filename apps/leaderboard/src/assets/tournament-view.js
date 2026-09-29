// Tournament workspace view: pure state → HTML. No DOM access, no fetching —
// tournaments.js (the controller) builds the view-model, renders this markup
// into #tournament-root / #tournament-dialogs, and owns every behavior. The
// ids and data-* attributes emitted here are the behavior contract the
// controller's delegated listeners and tests rely on; classes are all tn-*.
import { BYE, CROWN_ICON } from "./tournament-bracket-view.js";
import { planLockMarkup } from "./dashboard/plan-lock.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[char]));

const SOURCE_LABELS = {
  chat: "Chat",
  page: "Signup page",
  manual: "Manual",
  leaderboard: "Leaderboard",
};
const LINKED_REASON_LABELS = {
  same_device: "Same device",
  same_identity: "Same account",
  same_ip_24h: "Same IP",
  same_time_claims: "Same-time claims",
};
// One sentence of guidance per lifecycle for the Settings status card.
const LIFECYCLE_STATUS_COPY = {
  setup: "Collect entries, then start the tournament to create the bracket.",
  live: "The bracket is live. Enter scores to advance winners.",
  finished: "This tournament has finished. No new signups are being accepted.",
  cancelled: "This tournament was cancelled.",
};
// Compact inline SVG icons (lucide-style strokes) — no emoji in the UI.
const icon = (path) => `<svg class="tn-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const ICONS = {
  trophy: icon('<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M6 2h12v7a6 6 0 0 1-12 0V2z"/><path d="M12 15v4"/><path d="M8 21h8"/><path d="M10 19h4"/>'),
  entries: icon('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  spots: icon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  command: icon('<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>'),
  limit: icon('<path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z"/>'),
  expand: icon('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>'),
  calendar: icon('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>'),
  game: icon('<path d="M6 12h4"/><path d="M8 10v4"/><path d="m15 13 .5-1"/><path d="m18 15 .5-1"/><path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.59c-.04.36-.7 4.91-.7 5.41a3 3 0 0 0 5.12 2.12L9 14h6l1.88 2.12A3 3 0 0 0 22 14c0-.5-.66-5.05-.7-5.41A4 4 0 0 0 17.32 5Z"/>'),
  bracket: icon('<path d="M4 4h4v16H4z" fill="currentColor" stroke="none" opacity="0"/><path d="M8 6h4"/><path d="M8 12h4"/><path d="M8 18h4"/><circle cx="8" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="8" cy="18" r="2"/><path d="M14 6h2v6h-2z"/><circle cx="15" cy="6" r="1.6"/><path d="M14 15h2v3h-2z"/><circle cx="15" cy="18" r="1.6"/>'),
  played: icon('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
  status: icon('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  plus: icon('<path d="M12 5v14"/><path d="M5 12h14"/>'),
};

export function formatCreated(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

// ---- View model ----------------------------------------------------------

// Derived once per render so every panel agrees on labels, counts and which
// controls exist. `board` only feeds the Kick-channel fallback for draft
// primaries; `chatRegistration` drives the registration-status text.
export function buildViewModel({
  tournament,
  entries,
  entryCounts,
  matches,
  tournamentState,
  lifecycle: lifecycleFallback,
  tournaments,
  selectedId,
  duplicateProtectionInFlight = false,
  pendingAntiAltEnabled = null,
  chatRegistration,
  board,
  activeTab,
  tournamentsEnabled = true,
}) {
  const lifecycle = tournamentState?.lifecycle ?? lifecycleFallback ?? tournament?.lifecycle ?? "setup";
  const finished = lifecycle === "finished" || lifecycle === "cancelled";
  const activeCount = entryCounts?.active || 0;
  const keyword = tournament?.entry_keyword || "!join";
  const channel = String(tournament?.chat_channel || "").trim();
  const siteChannel = String(chatRegistration?.channelName || board?.kickChannelName || "").trim();
  const played = (matches || []).filter((m) => m.status === "completed" && m.player1_name !== BYE && m.player2_name !== BYE).length;
  const cap = tournament?.entry_cap ?? null;
  const signupsOpen = tournament?.signup_state === "open";
  const waitlistCount = entryCounts?.waitlist || 0;
  const start = tournamentState?.start;
  const addEntry = tournamentState?.add_entry || { visible: false, enabled: false };
  const antiAltEnabled = pendingAntiAltEnabled ?? (tournament?.anti_alt_enabled === true);

  // Chat-registration state is the single source for the form hint and the
  // read-only Settings row — they can never disagree.
  const regChannel = String(chatRegistration?.channelName || "").trim().toLowerCase();
  const chatReg = signupsOpen
    && chatRegistration?.connected && chatRegistration.chatReady
    && channel && channel.toLowerCase() === regChannel ? "Active"
    : signupsOpen ? "Unavailable" : "Off";

  // Primary action + step guidance per lifecycle.
  let primary = null;
  let stepHtml = "";
  let setupControls = null;
  if (lifecycle === "setup") {
    primary = start
      ? { action: "start", label: "Start tournament", disabledReason: start.reason }
      : null;
    stepHtml = tournamentState?.chat_signup_text
      ? esc(tournamentState.chat_signup_text)
      : "Add players below, or turn on chat signup to collect entries from Kick chat.";
    setupControls = {
      hasChannel: Boolean(channel),
      siteChannel,
      open: signupsOpen,
      stateText: tournamentState?.chat_signup_text || null,
    };
  } else if (lifecycle === "live") {
    stepHtml = "Click the winner's name in the Bracket tab to advance them, or enter scores.";
  } else if (lifecycle === "finished") {
    stepHtml = `${CROWN_ICON}<span>Champion: ${esc(tournament?.winner_name || "—")}</span>`;
  } else if (lifecycle === "cancelled") {
    stepHtml = "Tournament cancelled.";
  }

  const meta = tournament
    ? [
        ...(String(tournament.game_name || "").trim() ? [tournament.game_name] : []),
        `${tournament.bracket_size}-player bracket`,
      ].join(" · ")
    : "";

  return {
    tournament,
    lifecycle,
    finished,
    statusLabel: tournamentState?.status_label || tournament?.status_label || lifecycle,
    statusCopy: LIFECYCLE_STATUS_COPY[lifecycle] || "",
    meta,
    keyword,
    chatReg,
    activeCount,
    activeTab: activeTab || "entries",
    primary,
    setupControls,
    waitlistCount,
    cap,
    addEntry,
    inactiveCount: entryCounts?.inactive || 0,
    antiAltEnabled,
    duplicateProtectionBusy: duplicateProtectionInFlight,
    entriesTabLabel: waitlistCount > 0
      ? `Entries (${activeCount}) · Waitlist ${waitlistCount}`
      : `Entries (${activeCount})`,
    tournamentsEnabled,
    tournaments: tournaments || [],
    selectedId: selectedId || tournament?.id || "",
    stepHtml,
    hasMatches: Boolean(matches?.length) || Boolean(tournament?.winner_name),
    playedMatches: played,
    stats: [
      { icon: ICONS.entries, value: cap ? `${activeCount} of ${cap}` : String(activeCount), label: "Entries", id: "tournament-count" },
      { icon: ICONS.spots, value: String(tournament?.bracket_size ?? "—"), label: "Bracket spots", id: "tournament-fact-spots" },
      { icon: ICONS.command, value: keyword, label: "Join command", id: "tournament-fact-keyword" },
      { icon: ICONS.limit, value: cap ? String(cap) : "Unlimited", label: "Signup limit", id: "tournament-fact-cap" },
    ].filter((stat) => stat.id !== "tournament-fact-keyword" || signupsOpen),
    entriesVm: (entries || []).map((entry) => ({
      id: entry.id,
      name: entry.display_name || "?",
      initial: String(entry.display_name || "?").trim().charAt(0).toUpperCase() || "?",
      flagged: Boolean(antiAltEnabled && (entry.flagged || entry.alt_flag || entry.linked_to)),
      flagReason: entry.linked_to
        ? `Linked to ${entry.linked_to} · ${(entry.linked_reasons || []).map((code) => LINKED_REASON_LABELS[code] || code).join(" · ")}`
        : entry.alt_reason || "Possible duplicate account.",
      linked: !!entry.linked_to,
      sourceLabel: SOURCE_LABELS[entry.source] || entry.source || "—",
      status: entry.status,
      statusLabel: entry.status_label,
      statusTone: entry.status_tone,
      actions: entry.actions,
      inactive: entry.inactive === true,
      eligibleRank: entry.eligible_rank,
    })),
    siteChannel,
    // Bracket summary aside — metadata rows after the stats list + champion.
    summaryRows: tournament ? [
      ...(String(tournament.game_name || "").trim() ? [{ icon: ICONS.game, label: "Game", value: tournament.game_name.trim() }] : []),
      { icon: ICONS.calendar, label: "Created", value: formatCreated(tournament.created_at) },
    ] : [],
    // Settings "Details" card — General already covers Game/Bracket type/size.
    settingsDetailRows: tournament ? [
      { icon: ICONS.calendar, label: "Created", value: formatCreated(tournament.created_at) },
      { icon: ICONS.entries, label: "Entries", value: String(entryCounts?.active || 0) },
      { icon: ICONS.played, label: "Matches played", value: String(played) },
    ] : [],
  };
}

// ---- Building blocks -----------------------------------------------------

const kv = (label, value, { mono = false, title = "" } = {}) =>
  `<div class="tn-kv"><dt>${esc(label)}</dt><dd${mono ? ' class="tn-mono"' : ""}${title ? ` title="${esc(title)}"` : ""}>${value}</dd></div>`;

const statusPill = (lifecycle, label) =>
  `<span class="tn-pill tn-pill--${esc(lifecycle)}">${esc(label)}</span>`;

function headerHtml(vm) {
  const t = vm.tournament;
  const primaryBtn = vm.primary
    ? `<button class="btn btn--accent" id="tournament-primary" type="button" data-action="${esc(vm.primary.action)}"${vm.primary.disabledReason ? ` disabled aria-describedby="tournament-primary-reason"` : ""}>${esc(vm.primary.label)}</button>`
    : `<button class="btn btn--accent" id="tournament-primary" type="button" hidden></button>`;
  const primaryReason = vm.primary?.disabledReason
    ? `<p class="tn-primary-reason" id="tournament-primary-reason">${esc(vm.primary.disabledReason)}</p>`
    : "";
  const actions = [
    `<span class="tn-primary-wrap">${primaryBtn}${primaryReason}</span>`,
    `<button class="btn btn--ghost" id="tournament-new" type="button"${vm.tournamentsEnabled ? "" : " hidden"}>${ICONS.plus} New tournament</button>`,
  ].join("");
  const controls = vm.setupControls
    ? `<div class="tn-setup-controls">
        <div class="tn-seeding" role="radiogroup" aria-label="Seeding">
          <span class="tn-seeding-label">Seeding:</span>
          <label class="tn-seeding-opt"><input type="radio" name="tournament-seeding" value="signup" checked /> Signup order (default)</label>
          <label class="tn-seeding-opt"><input type="radio" name="tournament-seeding" value="shuffle" /> Shuffle</label>
        </div>
        <div class="tn-chat-signup">
          ${vm.setupControls.hasChannel
            ? `<label class="tn-switch-line"><span class="switch"><input type="checkbox" id="tournament-chat-signup" role="switch" aria-label="Chat signup"${vm.setupControls.open ? " checked" : ""} /><span class="switch-track"></span></span><span>Chat signup (${esc(vm.keyword)})</span></label>
               <span class="tn-chat-signup-state" id="tournament-chat-signup-state">${vm.setupControls.stateText}</span>`
            : `<label class="tn-switch-line"><span class="switch"><input type="checkbox" id="tournament-chat-signup" role="switch" aria-label="Chat signup" disabled /><span class="switch-track"></span></span><span>Chat signup (${esc(vm.keyword)})</span></label>
               <span class="tn-chat-signup-state" id="tournament-chat-signup-state">${vm.setupControls.siteChannel
                 ? `<b>Kick channel required.</b> Use your connected Kick channel to open signups. <button class="btn btn--sm btn--ghost" id="tournament-use-channel" type="button" data-channel="${esc(vm.setupControls.siteChannel)}">Use ${esc(vm.setupControls.siteChannel)}</button>`
                 : `<b>Kick channel required.</b> Add your Kick channel before opening signups. <button class="btn btn--sm btn--ghost" id="tournament-use-channel" type="button">Add Kick channel</button>`}</span>`}
        </div>
      </div>`
    : "";
  return `<header class="tn-head">
    <div class="tn-head-main">
      <span class="tn-head-mark" aria-hidden="true">${ICONS.trophy}</span>
      <div class="tn-head-text">
        <div class="tn-head-title-row">
          <h1 id="tournament-title-display">${esc(t.title || "")}</h1>
          ${statusPill(vm.lifecycle, vm.statusLabel)}
          ${tournamentSwitcherHtml(vm)}
        </div>
        <p class="tn-meta" id="tournament-meta">${esc(vm.meta)}</p>
        <p class="tn-step" id="tournament-step-label">${vm.stepHtml}</p>
        ${controls}
      </div>
      <div class="tn-head-actions">${actions}</div>
    </div>
    <dl class="tn-stats tn-stats--${vm.stats.length}">${vm.stats.map((s) => `
      <div class="tn-stat">
        <dt><span class="tn-stat-ic" aria-hidden="true">${s.icon}</span>${esc(s.label)}</dt>
        <dd id="${s.id}"${s.id === "tournament-count" ? ' aria-live="polite"' : ""}>${esc(s.value)}</dd>
      </div>`).join("")}
    </dl>
    <span class="tn-status-anchor" id="tournament-status" data-lifecycle="${esc(vm.lifecycle)}" hidden>${esc(vm.statusLabel)}</span>
  </header>`;
}

function tournamentSwitcherHtml(vm) {
  if (!vm.tournaments.length) return "";
  return `<details class="tn-switcher" id="tournament-switcher">
    <summary>All tournaments (${vm.tournaments.length})</summary>
    <div class="tn-switcher-list" role="menu">
      ${vm.tournaments.map((item) => {
    const current = item.id === vm.selectedId;
    const lifecycle = current ? vm.lifecycle : item.lifecycle;
    const label = current ? vm.statusLabel : item.status_label;
    return `<button type="button" role="menuitem" data-tournament-switch="${esc(item.id)}"${current ? ' aria-current="true"' : ""}>
      <span class="tn-switcher-title">${esc(item.title || "")}</span>
      ${statusPill(lifecycle, label)}
    </button>`;
  }).join("")}
    </div>
  </details>`;
}

function tabsHtml(vm) {
  const tabs = [
    ["entries", vm.entriesTabLabel],
    ["bracket", "Bracket"],
    ["settings", "Settings"],
  ];
  return `<nav class="tn-tabs" role="tablist" aria-label="Tournament sections">
    ${tabs.map(([name, label]) => `<button class="tn-tab${vm.activeTab === name ? " is-active" : ""}" id="tournament-tab-${name}" type="button" role="tab" aria-selected="${vm.activeTab === name}" aria-controls="tournament-panel-${name}" data-tournament-tab="${name}">${esc(label)}</button>`).join("")}
  </nav>`;
}

// ---- Entries panel -------------------------------------------------------

// Rows only — also used by the controller to refresh the list in place
// while a dirty settings form must not be rebuilt.
export function entryRowsHtml(vm, entries = vm.entriesVm) {
  return entries.map((entry) => {
    const flag = entry.flagged
      ? `<span class="tn-entry-flag"><span class="tn-pill tn-pill--duplicate">Possible duplicate</span> <span class="tn-entry-flag-reason">${esc(entry.flagReason)}${entry.linked ? ' · <a href="/dashboard/audience/linked">Review</a>' : ""}</span>`
      : "";
    const menu = entry.actions.length
      ? `<details class="tn-menu"><summary class="tn-menu-btn" aria-label="Actions for ${esc(entry.name)}">•••</summary>
      <div class="tn-menu-list" role="menu">
            ${entry.actions.map((action) => `<button type="button" role="menuitem" data-entry-action="${esc(action)}" data-entry-id="${esc(entry.id)}">${action === "remove" ? "Remove" : action === "block" ? "Block" : "Restore"}</button>`).join("")}
          </div>
        </details>`
      : "";
    return `<div class="tn-entry${entry.flagged ? " is-flagged" : ""}" data-entry-id="${esc(entry.id)}">
      <div class="tn-entry-player">
        <span class="tn-avatar" aria-hidden="true">${esc(entry.initial)}</span>
        <span class="tn-entry-name"><strong>${esc(entry.name)}</strong>${flag}</span>
      </div>
      <div class="tn-entry-source">${esc(entry.sourceLabel)}</div>
      <div class="tn-entry-status"><span class="tn-pill tn-pill--${esc(entry.statusTone)}">${esc(entry.statusLabel)}</span></div>
      <div class="tn-entry-actions">${menu}</div>
    </div>`;
  }).join("");
}

export function removedEntriesHtml(vm) {
  if (!vm.inactiveCount) return "";
  return `<details class="tn-removed" id="tournament-removed">
    <summary id="tournament-removed-summary">Removed (${vm.inactiveCount})</summary>
    <div class="tn-entries" id="tournament-removed-list">${entryRowsHtml(vm, vm.entriesVm.filter((entry) => entry.inactive))}</div>
  </details>`;
}

export function entriesEmptyHtml(vm) {
  if (vm.entriesVm.some((entry) => !entry.inactive)) return "";
  const copy = vm.lifecycle === "setup" && vm.setupControls?.open
    ? ["Waiting for viewers.", `Ask viewers to type ${vm.keyword} in chat.`]
    : vm.lifecycle === "setup"
      ? ["No entries yet.", "Add players below, or turn on chat signup to collect them from Kick chat."]
      : ["No entries.", "This tournament collected no entries."];
  return `<div class="tn-empty" id="tournament-entries-empty"><b>${esc(copy[0])}</b><span>${esc(copy[1])}</span></div>`;
}

function entriesPanelHtml(vm) {
  const activeEntries = vm.entriesVm.filter((entry) => !entry.inactive);
  const rows = entryRowsHtml(vm, activeEntries);
  const addEntry = vm.addEntry;
  const addDisabled = !addEntry.enabled;
  const empty = entriesEmptyHtml(vm);
  const addForm = addEntry.visible
    ? `<form class="tn-add-entry" id="tournament-add-entry-form" novalidate>
      <label for="tournament-add-entry-name">Add player</label>
      <div class="tn-add-entry-row">
        <input id="tournament-add-entry-name" name="displayName" type="text" maxlength="80" autocomplete="off" required class="tn-input"${addDisabled ? " disabled" : ""} />
        <button class="btn btn--accent" id="tournament-add-entry-submit" type="submit"${addDisabled ? " disabled" : ""}>${esc(addEntry.label)}</button>
      </div>
      ${addEntry.note ? `<p class="tn-add-entry-note">${esc(addEntry.note)}</p>` : ""}
    </form>`
    : "";
  const removedSection = removedEntriesHtml(vm);
  return `<section class="tn-panel${vm.activeTab === "entries" ? "" : ""}" id="tournament-panel-entries" role="tabpanel" aria-labelledby="tournament-tab-entries"${vm.activeTab === "entries" ? "" : " hidden"}>
    <div class="tn-panel-head">
      <h2 id="tournament-list-heading">Entries</h2>
      <p class="tn-sub" id="tournament-list-sub">Review tournament entries and their status.</p>
      <details class="tn-advanced" id="tournament-advanced">
        <summary>Advanced</summary>
        <div class="tn-dup-protection">
          <label class="tn-switch-line"><span class="switch"><input type="checkbox" id="tournament-dup-protection" role="switch"${vm.antiAltEnabled ? " checked" : ""}${vm.duplicateProtectionBusy ? " disabled" : ""} /><span class="switch-track"></span></span><span>Duplicate protection</span></label>
          <p class="hint">Flags lookalike accounts; flagged entries in free tournaments stay out of the bracket until allowed in People → Reviews.</p>
        </div>
      </details>
    </div>
    ${addForm}
    ${empty}
    <div class="tn-entries" id="tournament-entries"${activeEntries.length ? "" : " hidden"}>
      <div class="tn-entry tn-entry--head" role="row">
        <span>Player</span><span>Source</span><span>Status</span><span class="tn-col-actions">Actions</span>
      </div>
      <div id="tournament-entry-list" aria-label="Tournament entries">${rows}</div>
      <table id="tournament-entry-table" hidden><tbody></tbody></table>
    </div>
    ${removedSection}
  </section>`;
}

// ---- Bracket panel --------------------------------------------------------

function bracketPanelHtml(vm, bracketHtml) {
  const sub = `${vm.tournament.bracket_size}-player bracket`;
  const empty = `<div class="tn-empty" id="tournament-bracket-empty"><b>Bracket not created yet.</b><span>Start the tournament from the Entries tab to generate the bracket.</span></div>`;
  return `<section id="tournament-panel-bracket" role="tabpanel" aria-labelledby="tournament-tab-bracket"${vm.activeTab === "bracket" ? "" : " hidden"}>
    <div class="tn-layout">
      <div class="tn-panel tn-bracket-main">
        <div class="tn-panel-head tn-panel-head--row">
          <div>
            <h2 id="tournament-bracket-heading">Tournament bracket</h2>
            <p class="tn-sub" id="tournament-bracket-sub">${esc(sub)}</p>
          </div>
          <button class="btn btn--ghost btn--sm" id="tournament-bracket-expand" type="button">Open stream view</button>
        </div>
        ${vm.hasMatches
          ? `<div id="tournament-bracket" class="tn-bracket-host">${bracketHtml}</div>`
          : `${empty}<div id="tournament-bracket" class="tn-bracket-host" hidden></div>`}
      </div>
      ${summaryAsideHtml(vm)}
      <p class="tn-champion-sr" id="tournament-champion" hidden>${vm.tournament.winner_name ? `Champion: ${esc(vm.tournament.winner_name)}` : ""}</p>
    </div>
  </section>`;
}

// The bracket aside: compact summary + metadata (same row set as Settings
// Details, plus status and the champion block).
function summaryAsideHtml(vm) {
  const t = vm.tournament;
  const rows = [
    { icon: ICONS.entries, label: "Entries", value: String(vm.activeCount) },
    { icon: ICONS.spots, label: "Bracket size", value: String(t.bracket_size) },
    { icon: ICONS.played, label: "Matches played", value: String(vm.playedMatches) },
    { icon: ICONS.status, label: "Status", value: statusPill(vm.lifecycle, vm.statusLabel), raw: true },
  ];
  const champ = t.winner_name
    ? `<div class="tn-champ"><span>Champion</span><strong>${CROWN_ICON}${esc(t.winner_name)}</strong></div>`
    : "";
  return `<aside class="tn-aside" id="tournament-summary">
    <section class="tn-card">
      <h3>Tournament summary</h3>
      <dl class="tn-kv-list">${rows.map((r) => kvWithIcon(r)).join("")}</dl>
      ${champ}
      <dl class="tn-kv-list">${vm.summaryRows.map((r) => kvWithIcon(r)).join("")}</dl>
    </section>
  </aside>`;
}

const kvWithIcon = (r) =>
  `<div class="tn-kv"><dt>${r.icon ? `<span class="tn-kv-ic" aria-hidden="true">${r.icon}</span>` : ""}${esc(r.label)}</dt><dd${r.mono ? ' class="tn-mono"' : ""}${r.title ? ` title="${esc(r.title)}"` : ""}>${r.raw ? r.value : esc(r.value)}</dd></div>`;

// ---- Settings panel ------------------------------------------------------

// Finished tournaments get a definition-list view (no disabled inputs);
// editable lifecycles get the real form. The aside is always the same pair.
function settingsPanelHtml(vm) {
  const t = vm.tournament;
  const aside = `<aside class="tn-aside" id="tournament-settings-aside">
    <section class="tn-card">
      <h3>Tournament status</h3>
      <p class="tn-status-line">${statusPill(vm.lifecycle, vm.statusLabel)}</p>
      <p class="tn-sub">${esc(vm.statusCopy)}</p>
    </section>
    <section class="tn-card">
      <h3>Details</h3>
      <dl class="tn-kv-list">${vm.settingsDetailRows.map((r) => kvWithIcon(r)).join("")}</dl>
    </section>
    <section class="tn-card tn-card--danger">
      <h3>Delete tournament</h3>
      <p class="tn-sub">Permanently delete this tournament.</p>
      <button class="btn btn--ghost tn-danger" id="tournament-delete" type="button">Delete tournament</button>
    </section>
  </aside>`;

  const view = `<div id="tournament-settings-view"${vm.finished ? "" : " hidden"}>
    <div class="tn-panel-head">
      <h2>Tournament settings</h2>
      <p class="tn-sub">This tournament has finished; its settings are read-only.</p>
    </div>
    <h3 class="tn-group">General</h3>
    <dl class="tn-kv-list">
      ${kv("Tournament name", esc(t.title || "—"))}
      ${kv("Game", esc(t.game_name || "Not specified"))}
      ${kv("Bracket size", `${esc(String(t.bracket_size))} players`)}
    </dl>
    <h3 class="tn-group">Registration</h3>
    <dl class="tn-kv-list">
      ${kv("Kick channel", esc(t.chat_channel || "—"))}
      ${kv("Join command", esc(vm.keyword))}
      ${kv("Signup limit", esc(t.entry_cap ? String(t.entry_cap) : "Unlimited"))}
      ${kv("Chat registration", esc(vm.chatReg))}
    </dl>
  </div>`;

  const form = `<form id="tournament-settings-form" class="tn-form" novalidate${vm.finished ? " hidden" : ""}>
    <h3 class="tn-group">General</h3>
    <div class="tn-form-grid">
      <div class="field">
        <label for="tournament-title">Tournament name</label>
        <input id="tournament-title" name="title" type="text" value="${esc(t.title || "")}" placeholder="e.g. Friday Night Cup" maxlength="120" class="tn-input" />
        <span class="field-error" id="tournament-title-error" role="alert" hidden></span>
      </div>
      <div class="field">
        <label for="tournament-game">Game</label>
        <input id="tournament-game" name="gameName" type="text" value="${esc(t.game_name || "")}" placeholder="Game" maxlength="120" class="tn-input" />
      </div>
      <div class="field">
        <label for="tournament-bracket-size">Bracket size</label>
        <select id="tournament-bracket-size" name="bracketSize" class="v3-select tn-input"${vm.lifecycle === "live" || vm.finished ? " disabled" : ""}>
          ${[4, 8, 16, 32].map((n) => `<option value="${n}"${n === Number(t.bracket_size) ? " selected" : ""}>${n} players</option>`).join("")}
        </select>
        <span class="hint" id="tournament-bracket-size-hint"${vm.lifecycle === "live" || vm.finished ? "" : " hidden"}>Bracket size is locked: the bracket has already been created.</span>
        <span class="field-error" id="tournament-bracket-size-error" role="alert" hidden></span>
      </div>
    </div>
    <h3 class="tn-group">Registration</h3>
    <div class="tn-form-grid">
      <div class="field">
        <label for="tournament-chat-channel">Kick channel</label>
        <div class="gw-input-row">
          <span class="gw-input-prefix">kick.com/</span>
          <input id="tournament-chat-channel" name="chatChannel" type="text" value="${esc(t.chat_channel || "")}" placeholder="${esc(vm.siteChannel || "channelname")}" autocomplete="off" class="tn-input" />
        </div>
        <span class="field-error" id="tournament-chat-channel-error" role="alert" hidden></span>
        <span class="hint">Chat registration: <span class="tn-live${vm.chatReg === "Active" ? " is-live" : ""}" id="tournament-chat-status">Chat registration ${esc(vm.chatReg.toLowerCase())}</span></span>
      </div>
      <div class="field">
        <label for="tournament-keyword">Chat command</label>
        <input id="tournament-keyword" name="entryKeyword" type="text" value="${esc(vm.keyword)}" maxlength="40" class="tn-input" />
      </div>
      <div class="field">
        <label for="tournament-entry-cap-mode">Signup limit</label>
        <select id="tournament-entry-cap-mode" name="entryCapMode" class="v3-select tn-input">
          <option value="bracket"${Number(t.entry_cap) === Number(t.bracket_size) ? " selected" : ""}>Same as bracket size (${esc(t.bracket_size)})</option>
          <option value="unlimited"${t.entry_cap === null || t.entry_cap === undefined ? " selected" : ""}>Unlimited</option>
          <option value="custom"${t.entry_cap && Number(t.entry_cap) !== Number(t.bracket_size) ? " selected" : ""}>Custom…</option>
        </select>
        <input id="tournament-entry-cap" name="entryCap" type="number" min="1" inputmode="numeric" class="tn-input" aria-label="Custom signup limit" placeholder="e.g. 40" value="${esc(t.entry_cap || "")}"${t.entry_cap && Number(t.entry_cap) !== Number(t.bracket_size) ? "" : " hidden"} />
        <span class="hint">Defaults to the bracket size.</span>
        <span class="field-error" id="tournament-entry-cap-error" role="alert" hidden></span>
      </div>
    </div>
    <details class="tn-advanced tn-settings-advanced">
      <summary>Advanced</summary>
      <div class="tn-form-grid">
        <div class="field tn-check">
          <label for="tournament-waitlist"><input id="tournament-waitlist" name="waitlistEnabled" type="checkbox"${t.waitlist_enabled === true ? " checked" : ""} /> Allow waitlist</label>
          <span class="hint">When the limit is reached, new signups join a waitlist and move up automatically when a spot opens.</span>
        </div>
      </div>
    </details>
    <div class="tn-form-bar" id="tournament-settings-bar" hidden>
      <span class="hint">Unsaved changes</span>
      <span class="tn-form-bar-actions">
        <button class="btn btn--sm btn--ghost" type="button" id="tournament-settings-discard">Discard</button>
        <button class="btn btn--sm btn--accent" type="submit" id="tournament-settings-save">Save settings</button>
      </span>
    </div>
    <p class="tn-saved" id="tournament-settings-saved" role="status" hidden>Settings saved.</p>
  </form>`;

  return `<section id="tournament-panel-settings" role="tabpanel" aria-labelledby="tournament-tab-settings"${vm.activeTab === "settings" ? "" : " hidden"}>
    <div class="tn-layout">
      <div class="tn-panel tn-settings-main">${view}${form}</div>
      ${aside}
    </div>
  </section>`;
}

// ---- Top level -----------------------------------------------------------

export function workspaceHtml(vm, bracketHtml = "") {
  // #tournament-empty stays in the DOM (hidden) so tests and the shell can
  // always tell which state the app is in.
  return `<section id="tournament-empty" hidden></section>
  <div id="tournament-workspace">
    ${headerHtml(vm)}
    ${tabsHtml(vm)}
    ${entriesPanelHtml(vm)}
    ${bracketPanelHtml(vm, bracketHtml)}
    ${settingsPanelHtml(vm)}
  </div>
  <p class="tn-message" id="tournament-message" role="status" aria-live="polite" hidden></p>`;
}

// No tournament yet: the empty card carries the page heading + create button;
// #tournament-workspace stays in the DOM (hidden) like its counterpart above.
export function emptyStateHtml({ locked = false } = {}) {
  return `<section class="tn-empty-card" id="tournament-empty" aria-labelledby="tournament-empty-heading">
    <span class="tn-empty-mark" aria-hidden="true">${ICONS.trophy}</span>
    <h1 id="tournament-empty-heading">Tournaments</h1>
    <p>Run a tournament for your community. Collect entries from your audience, select participants, then manage the bracket here.</p>
    <button class="btn btn--accent" id="tournament-create" type="button"${locked ? ' disabled aria-describedby="tournament-plan-lock"' : ""}>Create tournament</button>
    ${locked ? planLockMarkup("tournaments", { id: "tournament-plan-lock" }) : ""}
  </section>
  <div id="tournament-workspace" hidden></div>
  <p class="tn-message" id="tournament-message" role="status" aria-live="polite" hidden></p>`;
}

// ---- Dialogs (rendered into #tournament-dialogs on demand) ---------------

const dialogShell = (id, labelledBy, inner, extraClass = "") =>
  `<div class="tn-dialog${extraClass}" id="${id}" role="dialog" aria-modal="true" aria-labelledby="${labelledBy}">${inner}</div>`;

export function createDialogHtml({ chatChannel = "", siteChannel = "", chatRegistration = null } = {}) {
  const connectedChannel = chatRegistration?.connected ? String(chatRegistration.channelName || "").trim() : "";
  const channelValue = connectedChannel || chatChannel || siteChannel || "";
  const channelHint = connectedChannel
    ? `<span class="hint">Your connected Kick channel. Signups are collected here.</span>`
    : `<span class="hint">Connect Kick in <a href="/dashboard/settings/connections">Settings → Connections</a> before opening signups.</span>`;
  return dialogShell("tournament-create-modal", "tournament-create-heading", `
    <form class="tn-dialog-card" id="tournament-create-form" novalidate>
      <h3 id="tournament-create-heading">Create tournament</h3>
      <div class="tn-form-grid tn-form-grid--two">
        <div class="field">
          <label for="tc-title">Tournament name</label>
          <input id="tc-title" name="title" type="text" placeholder="e.g. Friday Night Cup" maxlength="120" required class="tn-input" />
        </div>
        <div class="field">
          <label for="tc-bracket-size">Bracket size</label>
          <select id="tc-bracket-size" name="bracketSize" class="v3-select tn-input">
            <option value="4">4 players</option>
            <option value="8" selected>8 players</option>
            <option value="16">16 players</option>
            <option value="32">32 players</option>
          </select>
          <span class="hint">How many participants play in the bracket.</span>
        </div>
      </div>
      <details class="tn-more">
        <summary>More options</summary>
        <div class="tn-form-grid tn-form-grid--two">
          <div class="field">
            <label for="tc-game">Game</label>
            <input id="tc-game" name="gameName" type="text" placeholder="e.g. Fortnite" maxlength="120" class="tn-input" />
          </div>
          <div class="field">
            <label for="tc-entry-cap">Signup limit</label>
            <select id="tc-entry-cap" name="entryCapMode" class="v3-select tn-input">
              <option value="bracket" data-bracket-label selected>Same as bracket size (8)</option>
              <option value="unlimited">Unlimited</option>
              <option value="custom">Custom…</option>
            </select>
            <input id="tc-entry-cap-custom" name="entryCap" type="number" min="1" placeholder="e.g. 40" inputmode="numeric" aria-label="Custom signup limit" class="tn-input" hidden />
            <span class="hint">Defaults to the bracket size.</span>
          </div>
          <div class="field">
            <label for="tc-chat-channel">Kick channel</label>
            <div class="gw-input-row">
              <span class="gw-input-prefix">kick.com/</span>
              <input id="tc-chat-channel" name="chatChannel" type="text" value="${esc(channelValue)}" placeholder="channelname" autocomplete="off" class="tn-input"${connectedChannel ? " readonly" : ""} />
            </div>
            ${channelHint}
          </div>
          <div class="field">
            <label for="tc-keyword">Chat command</label>
            <input id="tc-keyword" name="entryKeyword" type="text" value="!join" maxlength="40" class="tn-input" />
          </div>
        </div>
      </details>
      <p class="tn-message is-error" id="tournament-create-error" role="alert" hidden></p>
      <div class="tn-dialog-actions">
        <button class="btn btn--sm btn--ghost" type="button" id="tournament-create-cancel">Cancel</button>
        <button class="btn btn--sm btn--accent" type="submit" id="tournament-create-submit">Create tournament</button>
      </div>
    </form>`);
}

export function selectDialogHtml({ cap = 0, eligible = 0 } = {}) {
  return dialogShell("tournament-select-modal", "tournament-select-heading", `
    <div class="tn-dialog-card" id="tournament-select-card">
      <h3 id="tournament-select-heading">Select participants</h3>
      <div class="tn-select-modes" role="radiogroup" aria-label="Selection mode">
        <label class="tn-select-mode">
          <input type="radio" name="tournament-select-mode" id="ts-mode-random" value="random" checked />
          <span>Random</span>
        </label>
        <label class="tn-select-mode">
          <input type="radio" name="tournament-select-mode" id="ts-mode-manual" value="manual" />
          <span>Manual</span>
        </label>
      </div>
      <div id="ts-pane-random">
        <p id="ts-random-text">Randomly select ${esc(cap)} of ${esc(eligible)} eligible players.</p>
        <p class="hint">Players will be randomly placed in the bracket.</p>
      </div>
      <div id="ts-pane-manual" hidden>
        <button class="btn btn--sm btn--ghost" id="ts-select-first" type="button">Select first ${esc(cap)}</button>
        <input id="ts-search" type="search" placeholder="Search entries" aria-label="Search entries" autocomplete="off" class="tn-input" />
        <ul id="ts-entry-list" class="tn-select-list"></ul>
        <p class="tn-select-counter" id="ts-counter" aria-live="polite">Selected 0 / ${esc(cap)}</p>
        <p class="hint">Players will be randomly placed in the bracket.</p>
      </div>
      <p class="tn-message is-error" id="tournament-select-error" role="alert" hidden></p>
      <div class="tn-dialog-actions">
        <button class="btn btn--sm btn--ghost" type="button" id="tournament-select-cancel">Cancel</button>
        <button class="btn btn--sm btn--accent" type="button" id="tournament-select-submit">Create bracket</button>
      </div>
    </div>`);
}

export function deleteDialogHtml({ title = "", warning = "" } = {}) {
  return dialogShell("tournament-delete-modal", "tournament-delete-heading", `
    <form class="tn-dialog-card" id="tournament-delete-form" novalidate>
      <h3 id="tournament-delete-heading">Delete tournament</h3>
      <p class="tn-sub">${esc(warning)}</p>
      <div class="field">
        <label for="td-confirm">Type “${esc(title)}” to confirm</label>
        <input id="td-confirm" name="confirmTitle" type="text" autocomplete="off" class="tn-input" />
      </div>
      <p class="tn-message is-error" id="tournament-delete-error" role="alert" hidden></p>
      <div class="tn-dialog-actions">
        <button class="btn btn--sm btn--ghost" type="button" id="tournament-delete-cancel">Cancel</button>
        <button class="btn btn--sm btn--ghost tn-danger" type="submit" id="tournament-delete-submit" disabled>Delete tournament</button>
      </div>
    </form>`);
}

// Checkbox row for the manual select list — re-rendered on search input.
export function selectListHtml(entries, manualSelection, filter = "") {
  const needle = String(filter || "").trim().toLowerCase();
  const eligible = (entries || []).filter((entry) => entry.eligible === true);
  const visible = needle
    ? eligible.filter((entry) => String(entry.display_name || "").toLowerCase().includes(needle))
    : eligible;
  return visible.map((entry) => `
    <li class="tn-select-row">
      <label>
        <input type="checkbox" value="${esc(entry.id)}"${manualSelection.has(entry.id) ? " checked" : ""} />
        <span>${esc(entry.display_name)}</span>
      </label>
    </li>`).join("");
}

export function fullBracketDialogHtml() {
  return dialogShell("tournament-bracket-modal", "tournament-bracket-modal-heading", `
    <div class="tn-dialog-card tn-dialog-card--bracket">
      <div class="tn-dialog-head">
        <div>
          <h3 id="tournament-bracket-modal-heading">Stream view</h3>
          <p class="tn-sub">Read-only, sized for screen sharing. Enter scores in the Bracket tab.</p>
        </div>
        <button class="btn btn--sm btn--ghost" id="tournament-bracket-close" type="button" aria-label="Close stream view">✕</button>
      </div>
      <div id="tournament-bracket-full" class="tn-dialog-scroll"></div>
    </div>`, " tn-dialog--bracket");
}
