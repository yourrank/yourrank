// Site settings → Sections: which pages and blocks the public site shows.
//
// These toggles used to live on the Games page, so a creator who wanted to
// hide the Shop had to discover the control inside an unrelated feature. The
// public page architecture belongs to the selected site, so it is managed
// here. The API (/api/site/sections, keyed by siteId) is unchanged.
import { $, getCsrf, guardAuth, logError, showToast } from "./utils.js";
import { state } from "./state.js";
import { DEFAULT_SECTIONS, isPro } from "./site.js";

const SECTION_ROWS = [
  ["shop", "Shop", "Let members browse and redeem your shop items.", "Turning off removes Shop from navigation and disables the /shop URL."],
  ["credits", "Rewards", "Let members see their balance and order history.", "Turning off removes Rewards from navigation and disables the /credits URL."],
  ["games", "Games", "Let members play credit-based games on your site.", "Turning off removes Games from navigation and disables the /games URL."],
];

const BLOCK_ROWS = [
  ["hero", "Hero banner"],
  ["top3", "Top 3 podium"],
  ["search", "Search & Filter"],
  ["rules", "Rules marquee"],
  ["socials", "Social widgets"],
  ["share", "Share button"],
  ["countdown", "Countdown timer"],
  ["cta", "Button"],
];

/** Current public-section flags for the active site (shop/credits/games). */
export function siteSections() {
  const incoming = state.EXTRA?.siteSections || {};
  return {
    shop: incoming.shop !== false,
    credits: incoming.me !== false,
    games: incoming.games === true,
  };
}

function renderPageBlocks() {
  const list = $("leaderboardBlockRows");
  const note = $("leaderboardBlockNote");
  if (!list) return;
  const current = { ...DEFAULT_SECTIONS, ...(state.EXTRA?.sections || {}) };
  list.innerHTML = BLOCK_ROWS.map(([key, label]) => `<div class="v3-block-status"><span>${label}</span><strong>${current[key] !== false ? "Shown" : "Hidden"}</strong></div>`).join("");
  if (note) note.textContent = isPro()
    ? "Page block visibility is included with Pro plans."
    : "Page block visibility is available on Pro plans.";
}

function renderSections() {
  const list = $("siteSectionRows");
  if (!list) return;
  const current = siteSections();
  list.innerHTML = `
    <div class="v3-setting-row">
      <div><strong>Home &amp; Leaderboard</strong><span>Core experience. Always visible.</span></div>
      <span class="v3-chip v3-chip--always">ALWAYS ON</span>
    </div>
    ${SECTION_ROWS.map(([key, title, description, note]) => `
      <label class="v3-setting-row" data-site-section-row="${key}">
        <span><strong>${title}</strong><span>${description} ${note}</span><small class="v3-inline-save" data-section-status="${key}" role="status" aria-live="polite"></small></span>
        <input class="v3-toggle" type="checkbox" data-site-section="${key}" ${current[key] ? "checked" : ""} aria-label="Enable ${title}">
      </label>
    `).join("")}`;
  list.querySelectorAll("[data-site-section]").forEach((input) => {
    input.addEventListener("input", (event) => event.stopPropagation());
    input.addEventListener("change", (event) => {
      event.stopPropagation();
      saveSection(input);
    });
  });
}

function setInlineSave(input, message, isError = false) {
  const status = input.closest("[data-site-section-row]")?.querySelector("[data-section-status]");
  if (!status) return;
  status.textContent = message;
  status.dataset.state = isError ? "error" : message === "Saving…" ? "saving" : "saved";
}

async function saveSection(input) {
  const previous = !input.checked;
  const next = { ...siteSections(), [input.dataset.siteSection]: input.checked };
  input.disabled = true;
  setInlineSave(input, "Saving…");
  try {
    const res = await fetch("/api/site/sections", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
      body: JSON.stringify({ siteId: state.ACTIVE_SITE_ID, siteSections: next }),
    }).then(guardAuth);
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error(body.error || "Could not save viewer pages.");
    state.EXTRA.siteSections = { ...state.EXTRA.siteSections, shop: next.shop, games: next.games, me: next.credits };
    setInlineSave(input, "Saved");
    showToast("Public page sections saved.", "success");
  } catch (err) {
    input.checked = previous;
    setInlineSave(input, "Couldn't save", true);
    logError("save-site-sections", err);
    showToast(err.message || "Could not save viewer pages.");
  } finally {
    input.disabled = false;
  }
}

/**
 * Render the Sections tab of Site settings. Runs at shell boot (the sections
 * read shell state that is already loaded) and re-renders cheaply on every
 * visit to the tab.
 */
export function initSiteSections() {
  renderSections();
  renderPageBlocks();
}
