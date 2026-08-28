// Global Command Palette (Ctrl+K / ⌘K) for Tier-1 Developer Experience
import { $, copyToClipboard, showToast } from "./utils.js";
import { state } from "./state.js";
import { requestDashboardRoute } from "./shell.js";

const PALETTE_ICONS = {
  overview: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
  leaderboard: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  details: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="9" x2="15" y1="8" y2="8"/><line x1="1" x2="7" y1="14" y2="14"/><line x1="17" x2="23" y1="16" y2="16"/></svg>`,
  design: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`,
  games: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><path d="M6 12h4"/><path d="M8 10v4"/><path d="M15 13h.01"/><path d="M17 11h.01"/></svg>`,
  analytics: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m7 12 4-4 4 4 5-5"/></svg>`,
  rewards: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 12 20 22 4 22 4 12"/><rect width="20" height="5" x="2" y="7"/><line x1="12" x2="12" y1="22" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`,
  bot: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 10l-4 4l6 6l4-16l-18 7l4 2l2 6l3-4"/></svg>`,
  settings: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  share: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/></svg>`,
  publish: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/><path d="M12 9v12"/><path d="M5 3h14"/></svg>`,
  copy: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
  external: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>`,
  help: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>`,
  refresh: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>`
};

const COMMANDS = [
  { id: "act-save", title: "Save & publish standings", group: "Actions", icon: PALETTE_ICONS.publish, action: () => $("save")?.click() },
  { id: "act-publish", title: "Toggle public site live / offline", group: "Actions", icon: PALETTE_ICONS.publish, action: () => $("publishAction")?.click() },
  { id: "act-obs-pred", title: "Copy OBS live prediction HUD overlay URL", group: "OBS overlays", icon: PALETTE_ICONS.copy, action: async () => {
    const url = location.origin + "/overlay/prediction?site=" + (state.SLUG || "");
    await copyToClipboard(url);
    showToast("OBS live prediction HUD URL copied!", "info");
  }},
  { id: "act-obs-alerts", title: "Copy OBS stream alerts & sound chime URL", group: "OBS overlays", icon: PALETTE_ICONS.copy, action: async () => {
    const url = location.origin + "/overlay/alerts?site=" + (state.SLUG || "");
    await copyToClipboard(url);
    showToast("OBS stream alerts URL copied!", "info");
  }},
  { id: "act-obs-card", title: "Copy OBS podium overlay URL", group: "OBS overlays", icon: PALETTE_ICONS.copy, action: async () => {
    const url = location.origin + "/" + (state.SLUG || "") + "/overlay";
    await copyToClipboard(url);
    showToast("OBS podium URL copied!", "info");
  }},
  { id: "act-obs-ticker", title: "Copy OBS horizontal ticker URL", group: "OBS overlays", icon: PALETTE_ICONS.copy, action: async () => {
    const url = location.origin + "/" + (state.SLUG || "") + "/overlay?layout=ticker";
    await copyToClipboard(url);
    showToast("OBS ticker URL copied!", "info");
  }},
  { id: "act-export-winners", title: "Download raffle winners CSV report", group: "Reports", icon: PALETTE_ICONS.share, action: () => {
    window.open("/api/export/raffle-winners.csv?siteId=" + (state.SITE_ID || ""), "_blank");
  }},
  { id: "act-export-drops", title: "Download drop claims CSV report", group: "Reports", icon: PALETTE_ICONS.share, action: () => {
    window.open("/api/export/drop-claims.csv?siteId=" + (state.SITE_ID || ""), "_blank");
  }},
  { id: "act-public", title: "Open live public site", group: "Actions", icon: PALETTE_ICONS.external, action: () => {
    window.open("/" + (state.SLUG || ""), "_blank");
  }},
  { id: "act-reload-games-preview", title: "Reload mini-games preview", group: "Actions", icon: PALETTE_ICONS.refresh, action: () => {
    $("gamesReloadPreview")?.click();
  }},
  { id: "nav-home", title: "Home", group: "Navigation", icon: PALETTE_ICONS.overview, keywords: "overview run-sheet", action: () => requestDashboardRoute("home") },
  { id: "nav-board", title: "Leaderboard", group: "Navigation", icon: PALETTE_ICONS.leaderboard, keywords: "leaderboard standings", action: () => requestDashboardRoute("board", "players") },
  { id: "nav-setup", title: "Setup", group: "Navigation", icon: PALETTE_ICONS.details, keywords: "site details schedule", action: () => requestDashboardRoute("board", "setup") },
  { id: "nav-players", title: "Players", group: "Navigation", icon: PALETTE_ICONS.leaderboard, keywords: "leaderboard standings", action: () => requestDashboardRoute("board", "players") },
  { id: "nav-design", title: "Appearance", group: "Navigation", icon: PALETTE_ICONS.design, keywords: "theme styling live preview", action: () => requestDashboardRoute("board", "design") },
  { id: "nav-share", title: "Share", group: "Navigation", icon: PALETTE_ICONS.share, action: () => requestDashboardRoute("board", "share") },
  { id: "nav-history", title: "History", group: "Navigation", icon: PALETTE_ICONS.leaderboard, keywords: "history", action: () => requestDashboardRoute("board", "history") },
  { id: "nav-games", title: "Games", group: "Navigation", icon: PALETTE_ICONS.games, keywords: "interactive simulator games", action: () => requestDashboardRoute("games", "", { query: "" }) },
  { id: "nav-giveaways", title: "Giveaways", group: "Navigation", icon: PALETTE_ICONS.rewards, keywords: "engage chat", action: () => requestDashboardRoute("giveaways", "chat", { query: "" }) },
  { id: "nav-raffles", title: "Raffles", group: "Navigation", icon: PALETTE_ICONS.rewards, keywords: "engage giveaways", action: () => requestDashboardRoute("giveaways", "raffles", { query: "" }) },
  { id: "nav-drops", title: "Drops", group: "Navigation", icon: PALETTE_ICONS.rewards, keywords: "engage giveaways", action: () => requestDashboardRoute("giveaways", "drops", { query: "" }) },
  { id: "nav-predictions", title: "Predictions", group: "Navigation", icon: PALETTE_ICONS.rewards, keywords: "engage betting", action: () => requestDashboardRoute("giveaways", "preds", { query: "" }) },
  { id: "nav-tournaments", title: "Tournaments", group: "Navigation", icon: PALETTE_ICONS.rewards, keywords: "engage competitions", action: () => requestDashboardRoute("giveaways", "tournaments", { query: "" }) },
  { id: "nav-analytics", title: "Insights", group: "Navigation", icon: PALETTE_ICONS.analytics, keywords: "insights traffic analytics visitors referrals events", action: () => requestDashboardRoute("performance", "activity", { query: "" }) },
  { id: "nav-rewards", title: "Rewards", group: "Navigation", icon: PALETTE_ICONS.rewards, keywords: "rewards shop orders ways to earn credits", action: () => requestDashboardRoute("rewards", "overview", { query: "" }) },
  { id: "nav-members", title: "People", group: "Navigation", icon: PALETTE_ICONS.leaderboard, keywords: "people audience members viewers balances tip", action: () => requestDashboardRoute("audience", "viewers", { query: "" }) },
  // Telegram lives on the bot Worker: the entry point resolves it through the
  // manifest and decides the required full document navigation.
  { id: "nav-telegram", title: "Telegram", group: "Navigation", icon: PALETTE_ICONS.bot, keywords: "bot console", action: () => requestDashboardRoute("telegram", "", { query: "" }) },
  { id: "nav-boards", title: "Sites", group: "Navigation", icon: PALETTE_ICONS.overview, keywords: "sites boards", action: () => requestDashboardRoute("boards", "", { query: "" }) },
  { id: "nav-settings", title: "Settings", group: "Navigation", icon: PALETTE_ICONS.settings, keywords: "settings account team billing connections data", action: () => requestDashboardRoute("settings", "account", { query: "" }) },
  { id: "nav-site-settings", title: "Site settings", group: "Navigation", icon: PALETTE_ICONS.settings, keywords: "site settings domain", action: () => requestDashboardRoute("site", "", { query: "" }) },
  { id: "nav-kick-connection", title: "Kick connection", group: "Navigation", icon: PALETTE_ICONS.settings, keywords: "kick channel connection site settings connect", action: () => requestDashboardRoute("siteConnections", "channel", { query: "" }) },
  { id: "nav-plan", title: "Billing", group: "Navigation", icon: PALETTE_ICONS.settings, keywords: "plans billing", action: () => requestDashboardRoute("settings", "plan", { query: "" }) },
  { id: "act-support", title: "Help & support drawer", group: "Support", icon: PALETTE_ICONS.help, action: () => $("openHelpDrawerBtn")?.click() }
];

let paletteEl = null;
let backdropEl = null;
let searchInput = null;
let resultsList = null;
let activeIndex = 0;
let filteredCommands = [...COMMANDS];

function buildPalette() {
  if (paletteEl) return;

  backdropEl = document.createElement("div");
  backdropEl.className = "yr-palette-backdrop";
  backdropEl.id = "yrPaletteBackdrop";

  paletteEl = document.createElement("div");
  paletteEl.className = "yr-palette-modal";
  paletteEl.id = "yrPaletteModal";
  paletteEl.setAttribute("role", "dialog");
  paletteEl.setAttribute("aria-modal", "true");
  paletteEl.setAttribute("aria-label", "Command Palette");

  paletteEl.innerHTML = `
    <div class="yr-palette-search-wrap">
      <svg class="yr-palette-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      <input type="text" id="yrPaletteInput" class="yr-palette-input" placeholder="Type a command or search..." autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="yrPaletteResults" aria-autocomplete="list" />
      <span class="yr-palette-esc">ESC</span>
    </div>
    <div class="yr-palette-body">
      <div class="yr-palette-results" id="yrPaletteResults" role="listbox" aria-label="Available commands"></div>
    </div>
    <div class="yr-palette-footer">
      <span><b>↑↓</b> to navigate</span>
      <span><b>↵</b> to select</span>
      <span><b>esc</b> to close</span>
      <span><b>⌘K / Ctrl+K</b></span>
    </div>
  `;

  document.body.appendChild(backdropEl);
  document.body.appendChild(paletteEl);

  searchInput = $("yrPaletteInput");
  resultsList = $("yrPaletteResults");

  backdropEl.addEventListener("click", closePalette);
  searchInput.addEventListener("input", onSearchInput);
  searchInput.addEventListener("keydown", onSearchKeydown);
}

function openPalette() {
  buildPalette();
  filteredCommands = [...COMMANDS];
  activeIndex = 0;
  if (searchInput) searchInput.value = "";
  renderResults();
  backdropEl?.classList.add("is-open");
  paletteEl?.classList.add("is-open");
  setTimeout(() => searchInput?.focus(), 50);
}

function closePalette() {
  backdropEl?.classList.remove("is-open");
  paletteEl?.classList.remove("is-open");
}

function onSearchInput() {
  const query = (searchInput?.value || "").trim().toLowerCase();
  if (!query) {
    filteredCommands = [...COMMANDS];
  } else {
    filteredCommands = COMMANDS.filter((cmd) =>
      cmd.title.toLowerCase().includes(query) ||
      cmd.group.toLowerCase().includes(query) ||
      (cmd.keywords || "").toLowerCase().includes(query)
    );
  }
  activeIndex = 0;
  renderResults();
}

function onSearchKeydown(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    closePalette();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (filteredCommands.length > 0) {
      activeIndex = (activeIndex + 1) % filteredCommands.length;
      renderResults();
    }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (filteredCommands.length > 0) {
      activeIndex = (activeIndex - 1 + filteredCommands.length) % filteredCommands.length;
      renderResults();
    }
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (filteredCommands[activeIndex]) {
      const cmd = filteredCommands[activeIndex];
      closePalette();
      cmd.action();
    }
  }
}

function renderResults() {
  if (!resultsList) return;
  if (filteredCommands.length === 0) {
    resultsList.innerHTML = `<div class="yr-palette-empty">No matching commands found.</div>`;
    searchInput?.removeAttribute("aria-activedescendant");
    return;
  }

  let currentGroup = "";
  let html = "";

  filteredCommands.forEach((cmd, i) => {
    if (cmd.group !== currentGroup) {
      currentGroup = cmd.group;
      html += `<div class="yr-palette-group-title" role="presentation">${currentGroup}</div>`;
    }
    const isSelected = i === activeIndex;
    const itemId = `yr-cmd-${cmd.id}`;
    html += `
      <div class="yr-palette-item ${isSelected ? "is-selected" : ""}" id="${itemId}" role="option" aria-selected="${isSelected ? "true" : "false"}" data-index="${i}">
        <span class="yr-palette-item-icon">${cmd.icon}</span>
        <span class="yr-palette-item-title">${cmd.title}</span>
        <span class="yr-palette-item-action">Jump →</span>
      </div>
    `;
  });

  resultsList.innerHTML = html;

  if (filteredCommands[activeIndex]) {
    searchInput?.setAttribute("aria-activedescendant", `yr-cmd-${filteredCommands[activeIndex].id}`);
  }

  resultsList.querySelectorAll(".yr-palette-item").forEach((item) => {
    item.addEventListener("click", () => {
      const idx = Number(item.dataset.index);
      if (filteredCommands[idx]) {
        closePalette();
        filteredCommands[idx].action();
      }
    });
    item.addEventListener("mouseenter", () => {
      activeIndex = Number(item.dataset.index);
      resultsList.querySelectorAll(".yr-palette-item").forEach((it, j) => {
        const sel = j === activeIndex;
        it.classList.toggle("is-selected", sel);
        it.setAttribute("aria-selected", String(sel));
      });
    });
  });

  // Scroll active into view
  const selectedEl = resultsList.querySelector(".yr-palette-item.is-selected");
  selectedEl?.scrollIntoView({ block: "nearest" });
}

// Global hotkeys listener
window.addEventListener("keydown", (e) => {
  // Ctrl+K / ⌘K -> Open Command Palette
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (paletteEl?.classList.contains("is-open")) closePalette();
    else openPalette();
  }
  // Ctrl+S / ⌘S -> Save changes
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    const saveBtn = $("save");
    if (saveBtn && !saveBtn.disabled) {
      saveBtn.click();
    }
  }
});

// Wire topbar trigger button
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("topbarCmdTrigger")?.addEventListener("click", openPalette);
  });
} else {
  document.getElementById("topbarCmdTrigger")?.addEventListener("click", openPalette);
}

// Export trigger for UI buttons
export { openPalette, closePalette };
