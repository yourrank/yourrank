// @ts-nocheck
// Only data the backend can actually produce is rendered: balances and history
// come from the viewer's ledger, standings from the streamer's board, rewards
// from shop_items. Nothing here claims watch time, tiers or percentiles, and
// sponsor cash is kept visually distinct from free credits.
import {
  logoSrcSet,
  renderLegalSidebar,
  esc,
  safeUrl,
  formatWaitSeconds,
} from "./public-render-helpers.js";
import { gamesIslandHead, gamesIslandMount } from "./games-embed.js";
import { viewerNavigation, viewerIcon, viewerHelpHref, viewerAccountHref, VIEWER_DESIGN_CONTRACT } from "./viewer-shell.js";
import { resolveViewerTemplate } from "./viewer-templates.js";
import { guestGateHref, rewardDetailHref, viewerIntentCopy, viewerIntentReturnTo } from "./viewer-intent.js";
import { viewerDisplayName, type ViewerIdentityRow } from "./viewer-identity.js";
import { publicRewardDetail, rewardAvailabilityText } from "./reward-detail.js";
import { hasCreatorContactMethod } from "./creator-contact.js";

// C-02: SECTION_TITLES was an exact duplicate of SECTION_LABELS — removed.
const SECTION_LABELS = {
  home: "Home",
  leaderboard: "Leaderboard",
  shop: "Rewards",
  games: "Games",
  me: "My Activity",
};

// C-10: Widened to accept 3-, 6-, and 8-digit hex values.
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const PUBLIC_ACCENT_DEFAULT = {
  value: "var(--yr-color-board-accent)",
  ink: "#000000",
};
const CREDITS_DISCLAIMER = "Credits are community reward points earned through participation. They stay within each community and can be used to claim available rewards.";
const REWARD_CLAIM_FINE = "Credits cannot be bought, transferred between communities, or cashed out. The creator fulfills each reward.";

// B-01: Build font URL dynamically from the board's active font choice so that
// boards using Oswald, Playfair Display, Rajdhani or Bebas Neue actually load.
const FONT_GF_PARAMS = {
  Inter:              "family=Inter:wght@400;500;600;700",
  Oswald:             "family=Oswald:wght@400;500;600;700",
  "Playfair Display": "family=Playfair+Display:wght@400;500;600;700",
  Rajdhani:           "family=Rajdhani:wght@400;500;600;700",
  "Bebas Neue":       "family=Bebas+Neue",
};
// Public links are opened from chat on phones: request the one text family the
// board actually uses plus the one mono family the numerals use. Inter and IBM
// Plex Mono stay in the CSS stacks as local fallbacks instead of downloads.
const DEFAULT_SANS_PARAMS = "family=Fira+Sans:wght@300;400;500;600;700";
const MONO_PARAMS = "family=Fira+Code:wght@400;500;600;700";

function buildFontsHref(font) {
  const families = [DEFAULT_SANS_PARAMS];
  if (font && FONT_GF_PARAMS[font] && FONT_GF_PARAMS[font] !== DEFAULT_SANS_PARAMS) families.push(FONT_GF_PARAMS[font]);
  families.push(MONO_PARAMS);
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}

/**
 * The creator's text style, from wherever the caller shaped the board. `Inter`
 * is the dashboard's "Default" option rather than a chosen family, so it keeps
 * the site's own type stack instead of overriding it.
 */
function resolveFont(data) {
  const font = data.theme?.font || data.branding?.font;
  if (!font || font === "Inter") return null;
  return Object.prototype.hasOwnProperty.call(FONT_GF_PARAMS, font) ? font : null;
}

/* ── tiny inline icon set (replaces the mockup's Font Awesome) ────────── */
const S = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
const ICONS = {
  home: `<svg ${S}><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>`,
  leaderboard: `<svg ${S}><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3"/><path d="M7 5H4v2a3 3 0 0 0 3 3"/></svg>`,
  shop: `<svg ${S}><path d="M3 9h18l-1.5 11H4.5z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/></svg>`,
  games: `<svg ${S}><rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 12h3M8.5 10.5v3M15.5 11h.01M17.5 13.5h.01"/></svg>`,
  me: `<svg ${S}><ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v11c0 1.7 3.1 3 7 3s7-1.3 7-3v-11"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>`,
  book: `<svg ${S}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 18.5V5.5"/></svg>`,
  kick: `<svg ${S}><path d="M6 4v16"/><path d="M18 4l-7 8 7 8"/></svg>`,
  search: `<svg ${S}><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/></svg>`,
  account: `<svg ${S}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
  bars: `<svg ${S}><path d="M3 6h18M3 12h18M3 18h18"/></svg>`,
  close: `<svg ${S}><path d="m6 6 12 12M18 6 6 18"/></svg>`,
  chart: `<svg ${S}><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>`,
  trophy: `<svg ${S}><path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/></svg>`,
  hourglass: `<svg ${S}><path d="M7 3h10M7 21h10"/><path d="M8 3c0 4 4 5 4 9s-4 5-4 9"/><path d="M16 3c0 4-4 5-4 9s4 5 4 9"/></svg>`,
  arrow: `<svg ${S}><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  crown: `<svg ${S}><path d="M4 18h16"/><path d="M4 18 3 7l5 4 4-6 4 6 5-4-1 11"/></svg>`,
  medal: `<svg ${S}><circle cx="12" cy="15" r="5"/><path d="M8 4h8l-2.5 6h-3z"/></svg>`,
  
  gift: `<svg ${S}><rect x="3" y="8" width="18" height="12" rx="1"/><path d="M12 8v12M3 13h18"/><path d="M12 8S10.5 4 8.5 4a2 2 0 0 0 0 4z"/><path d="M12 8s1.5-4 3.5-4a2 2 0 0 1 0 4z"/></svg>`,
};

/** Public path segment per section id where the two differ; `me` stays the internal id. */
export const SITE_SECTION_PATHS = Object.freeze({ me: "activity" });

export function siteSectionPath(section) {
  return SITE_SECTION_PATHS[section] || section;
}

/** The section id a public path segment resolves to, or the segment itself when it is not renamed. */
export function siteSectionFromPath(segment) {
  const found = Object.entries(SITE_SECTION_PATHS).find(([, path]) => path === segment);
  return found ? found[0] : segment;
}

export function siteSectionHref(section, slug, isCustomDomain) {
  const s = encodeURIComponent(slug || "");
  const path = siteSectionPath(section);
  if (isCustomDomain) return section === "home" ? "/" : `/${path}`;
  return section === "home" ? `/${s}` : `/${s}/${path}`;
}

function globalViewerAccountHref(isCustomDomain, slug) {
  return viewerAccountHref(slug, isCustomDomain ? "https://yourrank.site" : "");
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function hasConfiguredPrizePool(value) {
  const text = String(value || "").trim();
  return !!text && !/^\D*0(?:\.0+)?\D*$/.test(text);
}

function compact(n) {
  const v = Math.abs(Number(n) || 0);
  const sign = Number(n) < 0 ? "-" : "";
  if (v >= 1e6) return `${sign}${(v / 1e6).toFixed(1)}m`;
  if (v >= 1e4) return `${sign}${Math.round(v / 1e3)}k`;
  if (v >= 1e3) return `${sign}${(v / 1e3).toFixed(1)}k`;
  return `${sign}${v}`;
}

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The one canonical read of which sections exist on the public site.
 *
 * `home` is always available. `leaderboard` derives from the creator's
 * Appearance → "Show Leaderboard" toggle (`data.sections.leaderboard`,
 * normalized with default-on semantics): that toggle is the single source of
 * truth for whether the public leaderboard exists, so a legacy or stale
 * `data.siteSections.leaderboard` value is deliberately not consulted.
 * `shop`, `games` and `me` keep their own toggles in `data.siteSections`.
 *
 * Every public navigation surface (top bar, drawer, footer, viewer rail) and
 * the public route guard must read sections through this helper rather than
 * re-deriving flags locally.
 */
export function effectivePublicSections(data) {
  const raw = (data && typeof data === "object" ? data.siteSections : null) || {};
  const sections = (data && typeof data === "object" ? data.sections : null) || {};
  return {
    home: true,
    leaderboard: sections.leaderboard !== false,
    shop: raw.shop !== false,
    games: raw.games === true,
    me: raw.me !== false,
  };
}

export const PUBLIC_BOARD_IDS = ["main", "loyalty"] as const;
export type PublicBoardId = (typeof PUBLIC_BOARD_IDS)[number];

/**
 * Fixed public leaderboards of a site. Main is always present (it is the
 * Leaderboard section itself); Loyalty exists only when the creator turned
 * `sections.loyaltyLeaderboard` on. "Show Leaderboard" stays the master switch:
 * callers check `effectivePublicSections(data).leaderboard` before any of this.
 */
export function publicLeaderboardBoards(data): PublicBoardId[] {
  const sections = (data && typeof data === "object" ? data.sections : null) || {};
  return sections.loyaltyLeaderboard === true ? ["main", "loyalty"] : ["main"];
}

/** `?board=` value → board id; anything unknown or absent is Main. */
export function parsePublicBoard(value): PublicBoardId {
  return value === "loyalty" ? "loyalty" : "main";
}

export function publicBoardHref(board: PublicBoardId, slug, isCustomDomain) {
  const base = siteSectionHref("leaderboard", slug, isCustomDomain);
  return board === "main" ? base : `${base}?board=${board}`;
}

/** One-off predicate form of effectivePublicSections(). */
export function isPublicSectionEnabled(data, section) {
  return effectivePublicSections(data)[section] === true;
}

function sectionList(sections) {
  return ["home", "leaderboard", "shop", "me"].filter((s) => sections[s] !== false);
}

/** Streamer accent, falling back to the public viewer's cobalt board cue. */
function accentColor(br, options) {
  const candidates = [br?.accentA, options?.accent];
  for (const c of candidates) {
    if (HEX.test(String(c || ""))) return String(c).toLowerCase();
  }
  return PUBLIC_ACCENT_DEFAULT.value;
}

/** Compute ink for a concrete hex accent; CSS-var defaults cannot be measured. */
function accentInk(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#000000" : "#ffffff";
}

function accentInkFor(accent) {
  return accent === PUBLIC_ACCENT_DEFAULT.value ? PUBLIC_ACCENT_DEFAULT.ink : accentInk(accent);
}

export function formatMoney(currency, n) {
  const cur = String(currency || "$").slice(0, 6);
  return `${cur}${formatNumber(Math.round(Number(n) || 0))}`;
}

export function prizeCurrency(data) {
  return String(data?.prizes?.currency || data?.brand?.currency || "$").trim().slice(0, 6) || "$";
}

const MAX_RELATIVE_COUNTDOWN_MS = 366 * 86400000;

/**
 * Public leaderboard timing is deliberately bounded. Ordinary nearby dates use
 * a relative countdown; stale dates become an ended state, and implausibly far
 * dates become a calm UTC calendar date instead of a four-digit day counter.
 */
export function formatLeaderboardTiming(value, { now = Date.now() } = {}) {
  const end = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(end)) return { kind: "invalid", text: "", iso: "" };
  const iso = new Date(end).toISOString();
  const left = end - Number(now);
  if (left <= 0) return { kind: "expired", text: "Ended", iso };
  if (left > MAX_RELATIVE_COUNTDOWN_MS) {
    const text = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(end));
    return { kind: "calendar", text, iso };
  }
  const d = Math.floor(left / 86400000);
  const h = Math.floor((left % 86400000) / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m` : "Less than 1m";
  return { kind: "relative", text, iso };
}

/** Absolute wall-clock rendering of a leaderboard boundary, always in UTC. */
export function formatAbsoluteUtc(iso) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return "";
  const text = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: false, timeZone: "UTC",
  }).format(new Date(t));
  return `${text} UTC`;
}

function absoluteTimeHtml(iso) {
  const text = formatAbsoluteUtc(iso);
  return text ? `<time class="yr-lbh-abs" datetime="${esc(iso)}">${esc(text)}</time>` : "";
}

function timingHtml(timing, { scheduled = false } = {}) {
  if (!timing || timing.kind === "invalid") return "";
  const label = scheduled ? "Starts" : "Ends";
  if (timing.kind === "expired") return `<span class="yr-lbh-timing">Ended ${absoluteTimeHtml(timing.iso)}</span>`;
  if (timing.kind === "calendar") {
    return `<span class="yr-lbh-timing"><span data-countdown-mode="calendar">${label} <time datetime="${esc(timing.iso)}">${esc(timing.text)}</time></span> ${absoluteTimeHtml(timing.iso)}</span>`;
  }
  return `<span class="yr-lbh-timing"><span data-countdown-mode="relative" data-countdown-complete="${scheduled ? "Started" : "Ended"}">${label} in <b data-ends-at="${esc(timing.iso)}">${esc(timing.text)}</b></span> ${absoluteTimeHtml(timing.iso)}</span>`;
}

/* ── shell pieces ─────────────────────────────────────────────────────── */

function navItem({ key, label, href, active, badge }) {
  const icon = ICONS[key] || ICONS.home;
  const cls = `yr-nav-a${active ? " is-on" : ""}${badge ? " yr-nav-a--split" : ""}`;
  const aria = active ? ' aria-current="page"' : "";
  if (badge) {
    return `<a class="${cls}" href="${href}"${aria}><span>${icon} ${esc(label)}</span><span class="yr-nav-badge">${esc(badge)}</span></a>`;
  }
  return `<a class="${cls}" href="${href}"${aria}>${icon} ${esc(label)}</a>`;
}

/**
 * The creator's mark: their real configured logo, or a monogram cut from the
 * name they chose. A monogram is still their own data, so identity never falls
 * back to an invented avatar or an empty slot in the bar.
 */
function creatorMark(logoUrl, cls, px, fallback = "") {
  if (!logoUrl) return fallback;
  const srcset = logoSrcSet(logoUrl);
  const responsive = srcset ? ` srcset="${srcset}" sizes="${px}px"` : "";
  return `<img class="${cls}" src="${esc(logoUrl)}"${responsive} width="${px}" height="${px}" alt="" />`;
}

/** First character of a name, as a quiet typographic mark. */
function monogram(name, cls) {
  const first = Array.from(String(name || "").trim())[0] || "Y";
  return `<span class="${cls}" aria-hidden="true">${esc(first.toUpperCase())}</span>`;
}

/**
 * The top bar's sections, disclosed at narrow widths and modal while open.
 * It carries nothing the bar and footer do not already own, so it is never a
 * second navigation surface.
 */
function drawer({ b, slug, section, siteSections, homeUrl, isCustomDomain, logoUrl, viewer, balance, isMember }) {
  const enabled = sectionList(siteSections);
  const items = enabled.map((s) => navItem({
    key: s,
    label: SECTION_LABELS[s],
    href: `${homeUrl}${siteSectionHref(s, slug, isCustomDomain)}`,
    active: s === section,
    badge: s === "me" && viewer && isMember ? compact(balance) : null,
  })).join("");

  const name = esc(b.name || slug);
  const boardCreditsHref = `${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}`;
  const accountHref = globalViewerAccountHref(isCustomDomain, slug);
  // The membership row only exists where the streamer kept My activity on;
  // otherwise there is no local viewer destination on this site.
  // The bar's account shortcut is desktop-only, so the drawer carries the
  // viewer's global account destination at narrow widths as well as their
  // balance on this site.
  const acct = viewer ? `<a class="yr-sec-link yr-drawer-acct" href="${accountHref}">All communities ${ICONS.arrow}</a>` : "";
  const userRow = siteSections.me === false
    ? ""
    : viewer
      ? `<a class="yr-user" href="${boardCreditsHref}"><span class="yr-user-l"><span class="yr-ava">${avatarHtml(viewer)}</span><span><span class="yr-user-name">${esc(viewerName(viewer))}</span><span class="yr-user-sub">${isMember ? `${formatNumber(balance)} credits in this community` : "Not joined yet"}</span></span></span><span class="yr-user-go" aria-hidden="true">${ICONS.arrow}</span></a>`
      : `<a class="yr-user" href="${boardCreditsHref}"><span class="yr-user-l"><span class="yr-ava">?</span><span><span class="yr-user-name">My Activity</span><span class="yr-user-sub">Sign in to join</span></span></span><span class="yr-user-go" aria-hidden="true">${ICONS.arrow}</span></a>`;
  const foot = `${userRow}${acct}`;

  return `<div class="yr-drawer" id="yr-side" aria-label="${name} menu" tabindex="-1">
<div class="yr-drawer-head"><a class="yr-drawer-id" href="${homeUrl}${siteSectionHref("home", slug, isCustomDomain)}">${creatorMark(logoUrl, "yr-drawer-logo", 32, monogram(b.name || slug, "yr-mark yr-mark--sm"))}${name}</a><button class="yr-side-close" id="yr-side-close" type="button" aria-label="Close menu">${ICONS.close}</button></div>
<nav class="yr-nav yr-noscroll" aria-label="Sections">${items}</nav>
${foot ? `<div class="yr-drawer-foot">${foot}</div>` : ""}
</div>
<div class="yr-scrim" id="yr-scrim" aria-hidden="true" hidden></div>`;
}

function viewerName(viewer: ViewerIdentityRow | null | undefined) {
  return viewerDisplayName(viewer);
}

/**
 * The viewer's own mark. Their connected avatar when they have one, otherwise a
 * monogram of the name they signed in with — a quiet consumer treatment, and
 * one that emits no gradient or filter ids, so the bar and the drawer can both
 * show it without colliding on document-unique ids.
 */
function avatarHtml(viewer) {
  return viewer?.avatar_url
    ? `<img src="${esc(viewer.avatar_url)}" alt="" />`
    : monogram(viewerName(viewer), "yr-ava-mono");
}

/**
 * One public chrome: the creator on the left, their sections in the middle,
 * the viewer's own controls on the right. No workspace rail, no search field —
 * player search belongs to the leaderboard it filters.
 */
function topbar({ r, b, viewer, balance, returnTo, section, siteSections, homeUrl, slug, isCustomDomain, logoUrl, isMember }) {
  const name = esc(b.name || slug);
  const tagline = b.tagline ? esc(b.tagline) : "";
  const accountHref = globalViewerAccountHref(isCustomDomain, slug);
  const nav = sectionList(siteSections).map((s) => {
    const href = `${homeUrl}${siteSectionHref(s, slug, isCustomDomain)}`;
    const active = s === section ? ' aria-current="page"' : "";
    return `<a class="yr-tab${s === section ? " is-on" : ""}" href="${href}"${active}><span>${esc(SECTION_LABELS[s])}</span></a>`;
  }).join("");

  // The account shortcut is the desktop treatment only: below the drawer
  // breakpoint the viewer's own avatar next to the creator's mark reads as a
  // second unlabelled identity, so the stylesheet hides it there and the
  // drawer's account row — the same destination — carries it instead.
  const localAccount = isMember
    ? `<a class="yr-bal" href="${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}" data-credit-balance="${Number(balance) || 0}" data-credit-balance-label="Reward credits in this community" aria-label="Reward credits in this community: ${formatNumber(balance)}"><span class="yr-bal-num" data-credit-balance-num>${formatNumber(balance)}</span><span class="yr-bal-unit">credits</span></a>`
    : `<a class="yr-bal" href="${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}">My Activity</a>`;
  const right = viewer
    ? `${localAccount}
<a class="yr-account-link" href="${accountHref}" aria-label="My communities and Viewer Account"><span class="yr-ava">${avatarHtml(viewer)}</span><span class="yr-account-txt">My communities</span></a>`
    : `<a class="yr-btn yr-btn--ghost yr-btn--sm" href="${guestGate({ siteSections, slug, isCustomDomain }, "signin")}">Sign in</a>`;

  return `<header class="yr-top">
<div class="yr-top-in">
<a class="yr-id" href="${homeUrl}${siteSectionHref("home", slug, isCustomDomain)}">${creatorMark(logoUrl, "yr-id-logo", 36, monogram(b.name || slug, "yr-mark"))}<span class="yr-id-txt"><span class="yr-id-name">${name}</span>${tagline ? `<span class="yr-id-sub">${tagline}</span>` : ""}</span></a>
<nav class="yr-tabs" aria-label="Sections">${nav}</nav>
<div class="yr-top-r">${right}<button class="yr-menu" id="yr-menu" type="button" hidden aria-label="Open sections" aria-controls="yr-side" aria-expanded="false">${ICONS.bars}</button></div>
</div>
</header>`;
}

function viewerSignInHref(r, returnTo) {
  if (r.viewerKickAuthEnabled) return `/api/viewer/auth/kick?returnTo=${encodeURIComponent(returnTo)}`;
  if (r.viewerDiscordAuthEnabled) return `/api/viewer/auth/discord?returnTo=${encodeURIComponent(returnTo)}`;
  return "/me";
}

/** The one place a guest CTA on a community page sends people: the community's
 *  My Activity gate, which names the intent and offers every provider. When the
 *  creator has hidden that section the global Viewer Account page stands in. */
function guestGate({ siteSections, slug, isCustomDomain }, intent, rewardId = "") {
  const meHref = siteSections?.me === false
    ? globalViewerAccountHref(isCustomDomain, slug)
    : siteSectionHref("me", slug, isCustomDomain);
  return guestGateHref(meHref, intent, rewardId);
}

function providerButtons(r, query, action, cls = "yr-btn") {
  const buttons = [];
  if (r.viewerKickAuthEnabled) buttons.push(`<a class="${cls}" href="/api/viewer/auth/kick?${query}">${action} Kick</a>`);
  if (r.viewerDiscordAuthEnabled) buttons.push(`<a class="${cls}${buttons.length ? " yr-btn--ghost" : ""}" href="/api/viewer/auth/discord?${query}">${action} Discord</a>`);
  return buttons.join("");
}

// `cls` exists so a page that already has one primary action can keep signing
// in as the quieter second choice instead of showing two filled buttons.
function signInButton(r, returnTo, cls = "yr-btn") {
  if (r.viewerKickAuthEnabled) {
    return `<a class="${cls}" href="/api/viewer/auth/kick?returnTo=${encodeURIComponent(returnTo)}">Sign in with Kick</a>`;
  }
  if (r.viewerDiscordAuthEnabled) {
    return `<a class="${cls}" href="/api/viewer/auth/discord?returnTo=${encodeURIComponent(returnTo)}">Sign in with Discord</a>`;
  }
  return `<a class="${cls}" href="/me">Sign in</a>`;
}

function hero({ eyebrow, title, lede, right }) {
  return `<section class="yr-hero">
<div class="yr-hero-l">
<h1 class="yr-h1">${esc(title)}</h1>
${eyebrow ? `<p class="yr-cue">${esc(eyebrow)}</p>` : ""}
${lede ? `<p class="yr-lede">${lede}</p>` : ""}
</div>
${right || ""}
</section>`;
}

function heroStat(label, value, { cd = null } = {}) {
  const attr = cd ? ` data-ends-at="${cd}"` : "";
  return `<div><p class="yr-label">${esc(label)}</p><p class="yr-big"${attr}>${value}</p></div>`;
}

// `titleHidden` is for the case where the page heading already said it: the
// heading stays in the outline for assistive technology, but a sighted reader
// is not told "Standings" twice in eighty pixels.
function panel({ title, meta = "", body, foot = "", pad = false, titleHidden = false }) {
  return `<div class="yr-panel yr-lb">
<div class="yr-panel-head${titleHidden ? " yr-panel-head--quiet" : ""}"><h2 class="${titleHidden ? "yr-sr" : "yr-panel-title"}">${esc(title)}</h2>${meta ? `<span class="yr-panel-meta">${meta}</span>` : ""}</div>
${pad ? `<div class="yr-panel-pad">${body}</div>` : body}
${foot ? `<div class="yr-panel-foot">${foot}</div>` : ""}
</div>`;
}

function sectionHead(title, right = "") {
  return `<div class="yr-sec-head"><h2 class="yr-sec-title">${esc(title)}</h2>${right}</div>`;
}

/**
 * One empty state everywhere: a quiet mark, what is empty, and one sentence
 * saying when it fills. Modest height on purpose — an empty list is not an
 * event worth half a viewport.
 */
function emptyState(icon, title, note = "", extra = "") {
  return `<div class="yr-empty yr-empty--compact">${icon ? `<span class="yr-empty-ico" aria-hidden="true">${icon}</span>` : ""}<div class="yr-empty-copy"><p class="yr-empty-t">${esc(title)}</p>${note ? `<p class="yr-empty-p">${note}</p>` : ""}${extra}</div></div>`;
}

const LEDGER_KIND = {
  earn: "Credits earned",
  spend: "Claim",
  refund: "Credits reversed",
  revoke: "Claim refund",
  adjust: "Adjustment by the streamer",
  game_bet: "Game round",
  game_win: "Game round",
};

function ledgerDelta(row) {
  const amount = Number(row.amount) || 0;
  return row.type === "spend" || row.type === "refund" ? -Math.abs(amount) : amount;
}

const CLAIM_STATUS_NOTE = "Needs fulfillment means the creator still needs to complete your reward claim. Completed means it is complete. Cancelled means the credits went back to your balance.";


function rewardImage(item, slug, { eager = false } = {}) {
  const image = item.has_image ? `/api/public/${encodeURIComponent(slug)}/reward-images/${encodeURIComponent(item.id)}` : item.image_url || item.image || item.imageUrl;
  return image ? `<img class="yr-rwd-img" src="${esc(image)}" alt="" width="480" height="240"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async" />` : `<div class="yr-rwd-art" aria-hidden="true">${viewerIcon('gift')}</div>`;
}

/** The one claim decision shared by catalog cards and the detail page. The
 *  control never deducts anything: Redeem opens the review dialog, and the
 *  server re-checks membership, balance, stock and cooldown on submit. */
function rewardAction({ item, viewer, member, balance, blocked, unavailable, membershipHref }) {
  const cost = Number(item.cost) || 0;
  const stock = item.stock === null || item.stock === undefined ? null : Number(item.stock);
  const inStock = stock === null || stock > 0;
  const short = viewer ? Math.max(0, cost - balance) : 0;
  // Server-computed snapshot of this member's per-item cooldown (seconds).
  const cooldownRemaining = Math.max(0, Math.ceil(Number(item.cooldownRemaining) || 0));

  let state = "";
  let action;
  if (item.active === false) {
    action = `<span class="yr-act yr-act--off" role="note">No longer offered</span>`;
  } else if (!viewer) {
    action = `<a class="yr-act" href="${guestGateHref(membershipHref, "reward", String(item.id))}">Sign in to claim</a>`;
  } else if (unavailable) {
    state = "Membership could not load";
    action = `<span class="yr-act yr-act--off" role="note">Unavailable</span>`;
  } else if (!member) {
    state = "Join this community first";
    action = `<a class="yr-act" href="${membershipHref}">Join to claim</a>`;
  } else if (blocked) {
    state = "Claiming disabled on this site";
    action = `<span class="yr-act yr-act--off" role="note">Unavailable</span>`;
  } else if (cooldownRemaining > 0) {
    // Stated in words with the actual wait, so the greyed control explains itself.
    state = `Ready in ${formatWaitSeconds(cooldownRemaining)}`;
    action = `<span class="yr-act yr-act--off" role="note">On cooldown</span>`;
  } else if (!inStock) {
    // The control already says it in words, so the row does not say it twice.
    action = `<span class="yr-act yr-act--off" role="note">Out of stock</span>`;
  } else if (short > 0) {
    state = `${formatNumber(short)} more needed`;
    action = `<span class="yr-act yr-act--off" role="note">Not enough credits</span>`;
  } else {
    if (stock !== null && stock <= 3) state = `${formatNumber(stock)} left`;
    action = `<button class="yr-act" type="button" data-redeem="${esc(item.id)}" data-reward-name="${esc(item.name)}" data-reward-cost="${cost}">Redeem</button>`;
  }
  return { state, action, cost };
}

function rewardRow({ item, viewer, member = !!viewer, balance, blocked, unavailable = false, membershipHref = "", slug = "", isCustomDomain = false }) {
  const { state, action, cost } = rewardAction({ item, viewer, member, balance, blocked, unavailable, membershipHref });
  const detailHref = rewardDetailHref(siteSectionHref("shop", slug, isCustomDomain), String(item.id));

  return `<li class="yr-rwd" id="reward-${esc(item.id)}" tabindex="-1" data-reward-filter="${esc(String(item.name || '').toLowerCase())}" data-reward-sort-cost="${cost}">
${rewardImage(item, slug)}
<div class="yr-rwd-main">
<h3 class="yr-rwd-n"><a class="yr-rwd-link" href="${detailHref}">${esc(item.name)}</a></h3>
${item.description ? `<p class="yr-rwd-p">${esc(item.description)}</p>` : ""}
</div>
<div class="yr-rwd-side">
<p class="yr-rwd-c">${viewerIcon('coins')}${formatNumber(cost)} credits</p>
${state ? `<p class="yr-rwd-state">${esc(state)}</p>` : ""}
${action}
</div>
</li>`;
}

/** The viewer's own confirmation step for a claim. Native <dialog> so the
 *  focus trap, Escape and background inertness are the platform's, not ours. */
function orderConfirmDialog() {
  return `<dialog class="yr-modal" id="yr-order-confirm" aria-labelledby="yr-order-confirm-t" aria-describedby="yr-order-confirm-d">
<div class="yr-modal-in">
<h2 id="yr-order-confirm-t">Confirm claim</h2>
<p class="yr-fine" id="yr-order-confirm-d" data-order-detail></p>
<p class="yr-note">Credits have no cash value.</p>
<div class="yr-modal-acts">
<button class="yr-btn yr-btn--ghost yr-btn--sm" type="button" data-order-cancel>Cancel</button>
<button class="yr-btn yr-btn--sm" type="button" data-order-confirm>Claim</button>
</div>
</div>
</dialog>`;
}

/* ── page renderer ────────────────────────────────────────────────────── */

export async function renderSite({ r, section, viewer, viewerData, opts }) {
  const data = r.data || {};
  const b = data.brand || {};
  const br = data.branding || {};
  const siteSections = effectivePublicSections(data);
  const nonce = opts.nonce;
  const slug = opts.slug || "";
  const isCustomDomain = !!opts.isCustomDomain;
  const homeUrl = String(opts.homeUrl || "https://yourrank.site").replace(/\/$/, "");
  const logoUrl = opts.logoUrl || null;
  const watermark = data.sections?.poweredBy !== undefined ? !!data.sections?.poweredBy : r.plan === "free";
  // Only the restricted legacy surface retains its old chrome. All supported
  // viewer destinations share one navigation and material owner.
  const viewerShell = section !== "games";
  // Article pages (policies, contact) are read, not operated: they keep the
  // shared navigation but drop the personal overview rail, the credits
  // footer strip and the share controls.
  const articleLayout = viewerShell && section == null && opts.layout === "article";
  const viewerTemplate = resolveViewerTemplate(viewerShell && r.plan !== "free" ? br.template : undefined);

  const casino = String(b.casino || "").trim();
  const pool = String(b.prizePool || "").trim();
  const period = String(b.period || "Monthly");
  const ctaDest = b.ctaUrl;
  const ctaHref = slug ? esc(`/go/${slug}`) : safeUrl(ctaDest);
  const hasCta = !!(ctaDest || casino);
  const accent = accentColor(br, br.options);

  const viewerOnSite = viewerData?.viewerOnSite || null;
  const membershipStatus = viewerData?.membershipStatus || (viewerOnSite ? "member" : "unavailable");
  const isMember = membershipStatus === "member" && !!viewerOnSite;
  const balance = Number(viewerOnSite?.balance || 0);
  const kickUrl = (Array.isArray(data.socials) ? data.socials : []).find((s) => /kick/i.test(s?.type || s?.name || ""))?.url;
  const socialLinks = data.sections?.socials === false ? [] : (Array.isArray(data.socials) ? data.socials : [])
    .filter(s => s && s.enabled !== false && /^https?:\/\//i.test(String(s.url || "")))
    .map(s => ({ label: s.name || s.brand || s.type || "Channel", href: String(s.url).trim() }));

  // Pages rendered through contentHtml (player, legal, archive, profile) own their
  // own URL, so they pass it in rather than canonicalising to the creator home.
  const detailRewardId = section === "shop" && typeof opts.rewardId === "string" ? opts.rewardId : "";
  const detailReward = detailRewardId && opts.reward && typeof opts.reward === "object" ? publicRewardDetail(opts.reward) : null;
  const sectionUrl = `${homeUrl}${opts.canonicalPath || (detailRewardId ? `${siteSectionHref("shop", slug, isCustomDomain)}/${encodeURIComponent(detailRewardId)}` : siteSectionHref(section || "home", slug, isCustomDomain))}`;
  const canonicalUrl = esc(sectionUrl);
  const returnTo = sectionUrl;

  const rawTitleBase = String(b.name || slug || "YourRank");
  const titleBase = esc(rawTitleBase);
  const sectionTitle = esc(SECTION_LABELS[section] || section || "");
  const title = opts.pageTitle || (detailRewardId
    ? `${detailReward ? esc(detailReward.name) : "Reward not available"} · ${sectionTitle} · ${titleBase}`
    : section === "home"
      ? `${titleBase} — ${esc(b.tagline || "Leaderboard & Rewards")}`
      : `${sectionTitle} · ${titleBase}`);
  const rawDesc = opts.pageDescription || (detailReward
    ? `${detailReward.name} — ${detailReward.cost.toLocaleString("en-US")} credits in ${rawTitleBase}'s community rewards.${detailReward.description ? ` ${detailReward.description}` : ""}`
    : section === "home"
      ? `${rawTitleBase}'s public site — ${b.tagline || "compete on the leaderboard, earn free credits and claim rewards."}`
      : `${SECTION_LABELS[section] || section} for ${rawTitleBase}'s public site.`);
  const desc = esc(rawDesc);
  const ogImageUrl = logoUrl ? esc(logoUrl) : `${homeUrl}/og.png`;

  const ctx = {
    r, data, b, br, section, siteSections, slug, isCustomDomain, homeUrl, logoUrl,
    viewer, viewerData, viewerOnSite, membershipStatus, isMember, balance, casino, pool, period, ctaHref, hasCta, socialLinks,
    returnTo, nonce, watermark, isDemo: !!opts.isDemo,
    viewerAuthError: typeof opts.viewerAuthError === "string" ? opts.viewerAuthError : "",
    viewerIntent: opts.viewerIntent && typeof opts.viewerIntent === "object" ? opts.viewerIntent : { intent: "signin", rewardId: "" },
    rewardId: typeof opts.rewardId === "string" ? opts.rewardId : "",
    reward: opts.reward && typeof opts.reward === "object" ? opts.reward : null,
    board: parsePublicBoard(opts.board),
    publicBoards: publicLeaderboardBoards(data),
    loyalty: Array.isArray(opts.loyalty) ? opts.loyalty : [],
  };

  const mainInner = section == null && typeof opts.contentHtml === "string" ? opts.contentHtml : (section === "home" ? homeMain(ctx)
    : section === "leaderboard" ? (ctx.board === "loyalty" ? loyaltyMain(ctx) : boardMain(ctx))
    : section === "shop" ? (ctx.rewardId ? rewardDetailMain(ctx) : shopMain(ctx))
    : section === "games" ? gamesMain(ctx)
    : section === "me" ? meMain(ctx)
    : `<div class="yr-empty">Section not found</div>`);

  const darkShell = viewerShell && (section === "home" || section === "leaderboard" || section === "me" || section === "shop");
  const footerLead = darkShell ? `<p class="yr-foot-lead">${viewerIcon('shield')}<span>Your credits and claims stay with this community.</span> <a href="${esc(viewerHelpHref(siteSectionHref(section || 'home',slug,false),isCustomDomain ? 'https://yourrank.site' : '','help'))}">How YourRank works ${viewerIcon('arrow')}</a></p>` : "";
  const footer = siteFooter({ data, b, siteSections, slug, isCustomDomain, homeUrl, watermark, viewer, casino, ctaHref, hasCta, kickUrl: kickUrl ? safeUrl(kickUrl) : null, shareUrl: articleLayout ? null : sectionUrl, shareTitle: rawTitleBase, lead: footerLead });

  // B-01: Dynamic font URL based on board's active font.
  const font = resolveFont(data);
  const fontsHref = viewerShell ? `https://fonts.googleapis.com/css2?${FONT_GF_PARAMS.Inter}${font ? `&${FONT_GF_PARAMS[font]}` : ''}&display=swap` : buildFontsHref(font);
  // U-01: Compute ink once and share between .yr-site and #gx-root.
  const accentInkValue = accentInkFor(accent);

  const head = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title><meta name="description" content="${desc}" />
<meta property="og:title" content="${titleBase}" /><meta property="og:description" content="${desc}" /><meta property="og:type" content="website" />
<link rel="canonical" href="${canonicalUrl}" /><meta property="og:url" content="${canonicalUrl}" />
<meta name="twitter:card" content="${logoUrl ? "summary_large_image" : "summary"}" /><meta name="twitter:title" content="${titleBase}" /><meta name="twitter:description" content="${desc}" /><meta property="og:image" content="${ogImageUrl}" /><meta name="twitter:image" content="${ogImageUrl}" />
<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="${fontsHref}" rel="stylesheet" media="print" data-async${viewerShell ? " data-viewer-fonts" : ""} />
<script nonce="${nonce}">document.querySelector('link[data-async]').onload=function(){this.media='all'};</script>
<noscript><link href="${fontsHref}" rel="stylesheet" /></noscript>
<link rel="stylesheet" href="/assets/site-shell.css" />
<link rel="stylesheet" href="/assets/${viewerShell ? "viewer-shell" : "devin-system"}.css" />
${section === "games" ? gamesIslandHead() : ""}
${viewerShell ? `<meta name="viewer-accent" content="${esc(accent)}" /><meta name="viewer-accent-ink" content="${esc(accentInkValue)}" />${font ? `<meta name="viewer-display-font" content="${esc(`"${font}", "Fira Sans", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif`)}" />` : ""}` : `<style nonce="${nonce}" data-theme-tokens>.yr-site{--yr-accent:${accent};--yr-accent-ink:${accentInkValue}${font ? `;--yr-display-font:"${font}", "Fira Sans", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif` : ""}}${section === "games" ? `#gx-root{--gx-accent:${accent};--gx-accent-ink:${accentInkValue}}` : ""}</style>`}
${opts.csrfToken ? `<meta name="csrf-token" content="${esc(opts.csrfToken)}" />` : ""}
</head>`;

  const template = data.theme?.template || data.brand?.template || "cyber_arcade";

  const channel = streamerChannel(ctx);
  const navigation = viewerShell ? viewerNavigation({
    name: rawTitleBase, socialLinks,
    creatorMark: creatorMark(logoUrl, "yr-id-logo", 60),
    viewerName: viewer ? viewerName(viewer) : '',
    viewerMark: viewer ? avatarHtml(viewer) : '',
    balance: isMember ? balance : undefined,
    tagline: b.tagline || '',
    watchHref: channel?.href || '', watchLabel: channel?.label || '',
    communityStatus: channel?.label || 'Creator community', signedIn: !!viewer,
    sessionControl: !viewer && section !== "me" ? `<a class="yr-btn yr-btn--sm" href="${guestGate({ siteSections, slug, isCustomDomain }, "signin")}">Sign in</a>` : "",
    signInHref: viewer ? "" : guestGate({ siteSections, slug, isCustomDomain }, "signin"),
    homeHref: siteSectionHref("home", slug, isCustomDomain),
    accountHref: globalViewerAccountHref(isCustomDomain, slug),
    helpHref: viewerHelpHref(siteSectionHref(section || "home", slug, false), isCustomDomain ? "https://yourrank.site" : ""),
    title: section === "me" ? SECTION_LABELS.me : "",
    links: sectionList(siteSections).filter(key => key !== "me" || viewer).map(key => ({ label: SECTION_LABELS[key], href: siteSectionHref(key, slug, isCustomDomain), active: key === section })),
  }) : '';
  const body = `<body class="yr-site${viewerShell ? " viewer-shell" : ""}${articleLayout ? " viewer-article-page" : ""}"${viewerTemplate.value === "spotlight" ? ' data-viewer-template="spotlight"' : ""}${viewerShell ? "" : ` data-template="${esc(template)}"`} data-section="${esc(section)}"${detailRewardId ? " data-reward-detail" : ""}${data.eventId ? ` data-event-id="${esc(data.eventId)}"` : ""} data-slug="${esc(slug)}" data-custom-domain="${isCustomDomain ? "true" : "false"}" data-creator-contact="${hasCreatorContactMethod(data) ? "true" : "false"}" data-currency="${esc(prizeCurrency(data))}" data-rank-by="${data.rankBy === "wagered" ? "wagered" : "score"}">
${viewerShell ? VIEWER_DESIGN_CONTRACT : ""}
<a class="yr-sr" href="#main-content">Skip to content</a>
${viewerShell ? `<div class="viewer-layout">${navigation}${section === 'home' ? viewerCommunityHeading(ctx) : ''}` : topbar({ r, b, viewer, balance, returnTo, section, siteSections, homeUrl, slug, isCustomDomain, logoUrl, isMember })}
<main class="${viewerShell ? "viewer-main" : "yr-main"}" id="main-content">
${mainInner}
${articleLayout || darkShell ? "" : viewerShell ? `<footer class="viewer-panel-footer"><span>${viewerIcon('shield')}Your credits and claims stay with this community.</span><a href="${esc(viewerHelpHref(siteSectionHref(section || 'home',slug,false),isCustomDomain ? 'https://yourrank.site' : '','help'))}">How YourRank works ${viewerIcon('arrow')}</a></footer>` : footer}
</main>
${viewerShell ? `${articleLayout ? "" : viewerCommunityOverview(ctx)}${section === "home" ? `${isMember ? `<div class="viewer-home-strip">${rewardProgressCard(ctx)}${recentCreditCard(ctx)}</div>` : ''}${homePromo(ctx)}` : ""}<div class="viewer-site-footer">${footer}</div></div>` : drawer({ b, slug, section, siteSections, homeUrl, isCustomDomain, logoUrl, viewer, balance, isMember })}
${feedbackModal({ slug, isCustomDomain })}
<script src="/assets/cookie-consent.js" nonce="${nonce}" defer></script>
<script src="/assets/${viewerShell ? 'viewer-app' : 'site-shell'}.js" nonce="${nonce}" defer></script>
</body></html>`;

  return head + body;
}

function feedbackModal({ slug, isCustomDomain }) {
  // A-07: dialog now uses aria-labelledby to bind the heading correctly.
  return `<dialog id="yr-feedback" class="yr-modal" aria-labelledby="yr-feedback-title">
<form class="yr-modal-in" method="dialog">
<h2 id="yr-feedback-title">Feedback for this creator</h2>
<p class="yr-note">Goes to this community's creator, not to YourRank. There is no personal reply here; if you need a response, use the creator's <a href="${esc(isCustomDomain ? "/contact" : `/${encodeURIComponent(slug)}/contact`)}">Contact page</a>.</p>
<textarea name="message" rows="5" minlength="10" maxlength="2000" placeholder="What's working? What's not?" required aria-label="Your feedback for the creator" aria-describedby="yr-feedback-hint"></textarea>
<p class="yr-note yr-feedback-hint" id="yr-feedback-hint">10 to 2000 characters, not counting spaces at the start or end. <span id="yr-feedback-count">0 / 2000</span></p>
<p class="yr-modal-status" id="yr-feedback-status" role="status" aria-live="polite"></p>
<div class="yr-modal-acts">
<button class="yr-btn yr-btn--ghost yr-btn--sm" type="button" id="yr-feedback-close">Cancel</button>
<button class="yr-btn yr-btn--sm" type="submit">Send</button>
</div>
<input type="hidden" name="slug" value="${esc(slug)}" />
</form>
</dialog>`;
}

/**
 * The footer owns the site map and the secondary links the old workspace rail
 * used to hold, so the drawer stays a narrow-width disclosure of the top bar.
 */
/**
 * Share controls for the page being viewed: a copy-link button (wired by the
 * shell script) and an X intent link. Rendered only while the creator keeps the
 * `share` block on; the URL is the page's own canonical address, never a guess.
 */
function shareBlock({ data, shareUrl, shareTitle }) {
  if (data.sections?.share === false || !shareUrl) return "";
  const intent = `https://x.com/intent/post?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareTitle)}`;
  return `<div class="yr-share" data-share-block><span>Share</span><button type="button" class="yr-btn yr-btn--sm yr-btn--ghost" data-share-copy data-share-url="${esc(shareUrl)}" data-share-title="${esc(shareTitle)}">Share link</button><a class="yr-btn yr-btn--sm yr-btn--ghost" href="${esc(intent)}" target="_blank" rel="noopener noreferrer">Share on X<span class="yr-sr"> (opens in a new tab)</span></a><span class="yr-share-status" data-share-status role="status" aria-live="polite"></span></div>`;
}

/** The creator's rules list; only string entries are shown, and only while the `rules` block is on.
 *  `payoutNote` (already-escaped HTML) is the prize-pool explanation, shown as a quiet lead inside the disclosure. */
function rulesBlock(data, payoutNote = "") {
  if (data.sections?.rules === false) return "";
  const rules = (Array.isArray(data.rules) ? data.rules : []).filter((rule) => typeof rule === "string" && rule.trim());
  if (!rules.length) return "";
  return `<details class="viewer-card viewer-rules" aria-labelledby="viewer-rules-title"><summary class="viewer-card-head"><h2 id="viewer-rules-title">${viewerIcon('shield')}Rules</h2><span class="viewer-fine">${rules.length} ${rules.length === 1 ? "rule" : "rules"}</span></summary>${payoutNote ? `<p class="viewer-rules-payout">${payoutNote}</p>` : ""}<ol class="viewer-rules-list">${rules.map((rule) => `<li>${esc(rule)}</li>`).join("")}</ol></details>`;
}

function siteFooter({ data, b, siteSections, slug, isCustomDomain, homeUrl, watermark, viewer, casino, ctaHref, hasCta, kickUrl, shareUrl, shareTitle, lead = "" }) {
  const enabled = sectionList(siteSections);
  const legalHref = (page) => `${homeUrl}${siteSectionHref(page, slug, isCustomDomain)}`;
  const legalItems = renderLegalSidebar(data, legalHref).split("\n").filter(Boolean);
  const contactLinks = legalItems.filter((x) => x.includes(">Contact Us<")).join("");
  const legalLinks = legalItems.filter((x) => !x.includes(">Contact Us<")).join("");
  const secondary = [
    kickUrl && kickUrl !== "#" ? `<a href="${kickUrl}" target="_blank" rel="noopener noreferrer">Watch on Kick<span class="yr-sr"> (opens in a new tab)</span></a>` : "",
    hasCta && casino ? `<a href="${ctaHref}" target="_blank" rel="noopener noreferrer">Join ${esc(casino)}<span class="yr-sr"> (opens in a new tab)</span></a>` : "",
    viewer ? `<a href="${globalViewerAccountHref(isCustomDomain, slug)}">My communities</a>` : "",
  ].filter(Boolean).join("");
  // What a viewer normally reads at the bottom is the creator's sign-off in
  // three quiet zones: the fine print with their copyright, the legal pages,
  // and the ways to reach us or share the page. The section map below it is
  // the fallback for a browser that never ran the shell script; it is always
  // server-rendered and the stylesheet hides it only once the script reports
  // ready, because from then on the bar and the drawer own navigation and a
  // second copy of it is noise.
  return `<footer class="yr-foot">
<div class="yr-foot-bar">
<div class="yr-foot-zone yr-foot-zone--brand">
${lead}<p class="yr-fine">${CREDITS_DISCLAIMER}</p>
<p class="yr-foot-c">&copy; ${new Date().getFullYear()} ${esc(b.name || slug)}.${watermark ? ` Powered by <a href="${esc(homeUrl || "/")}" target="_blank" rel="noopener">YourRank</a>.` : ""}</p>
</div>
<div class="yr-foot-links yr-foot-zone yr-foot-zone--legal"><p class="yr-foot-h">Legal</p>${legalLinks}<button type="button" data-cookie-preferences>Cookie preferences</button></div>
<div class="yr-foot-links yr-foot-zone yr-foot-zone--reach"><p class="yr-foot-h">Get in touch &amp; share</p>${contactLinks}<button type="button" data-feedback-open>Feedback for this creator</button>${shareBlock({ data, shareUrl, shareTitle })}</div>
</div>
<nav class="yr-foot-links yr-foot-nav" aria-label="All sections">${enabled.filter((s) => s !== "me" || viewer).map((s) => `<a href="${homeUrl}${siteSectionHref(s, slug, isCustomDomain)}">${esc(SECTION_LABELS[s])}</a>`).join("")}${secondary}</nav>
</footer>`;
}

/* ── Home ─────────────────────────────────────────────────────────────── */

/**
 * Home is the creator's landing page, not a report: who this is, what the
 * board is doing, what the signed-in viewer has here, what they can get, and
 * where else to find the creator. Nothing is rendered from data the streamer
 * has not configured.
 */
function viewerCommunityHeading(ctx) {
  const { b, slug, viewer, isMember, membershipStatus, siteSections, isCustomDomain, logoUrl } = ctx;
  const name = b.name || slug;
  const channel = streamerChannel(ctx);
  // The only identity block on Home: one H1, kept out of <main> so the layout
  // grid can span it, but not a <header> so the topbar stays the single banner.
  // Stream state is filled in only once the existing Kick lookup returns a
  // boolean; until then the chip stays hidden rather than claiming anything.
  const live = channel?.kick ? `<span class="viewer-live" data-kick-channel="${esc(channel.kick)}" role="status" hidden></span>` : '';
  const memberHref = siteSections.me !== false ? (viewer ? siteSectionHref('me', slug, isCustomDomain) : guestGateHref(siteSectionHref('me', slug, isCustomDomain), 'join')) : '';
  const memberLabel = isMember ? 'My Activity' : viewer && membershipStatus === 'unavailable' ? 'Reload membership' : 'Join community';
  const helpHref = viewerHelpHref(siteSectionHref('home', slug, false), isCustomDomain ? 'https://yourrank.site' : '', 'help');
  const otherLinks = (ctx.socialLinks || []).filter(link => link.href !== channel?.href).slice(0, 3);
  // The right-hand note only repeats configured facts: the creator's other
  // channels when they exist, otherwise how credits and rewards work here.
  const note = otherLinks.length
    ? `<aside class="viewer-hero-note" aria-label="${esc(name)} elsewhere"><p class="viewer-hero-note-title">Find ${esc(name)} on</p><ul class="viewer-hero-links">${otherLinks.map(link => `<li><a href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${viewerIcon('link')}<span>${esc(link.label)}</span>${viewerIcon('external')}</a></li>`).join('')}</ul></aside>`
    : `<aside class="viewer-hero-note"><span class="viewer-hero-note-icon">${viewerIcon('coins')}</span><p>Free credits, earned here, unlock ${esc(name)}'s rewards.</p></aside>`;
  // No banner field exists on the brand, so the scene is a branded abstract
  // composition: the creator's mark softened into the canvas, lit orbs, a
  // ruled grid and the YourRank crown as a line drawing. Nothing in it is data.
  const scene = `<div class="viewer-hero-scene" aria-hidden="true">${creatorMark(logoUrl, 'viewer-hero-backdrop', 640)}<span class="viewer-hero-orb viewer-hero-orb--a"></span><span class="viewer-hero-orb viewer-hero-orb--b"></span><span class="viewer-hero-ring"></span><span class="viewer-hero-crown">${viewerIcon('crown')}</span></div>`;
  return `<section class="viewer-home-banner" aria-labelledby="viewer-home-title">${scene}<div class="viewer-hero-identity"><div class="viewer-hero-avatar">${creatorMark(logoUrl, 'yr-id-logo', 104, `<span class="viewer-avatar">${esc(Array.from(name)[0] || 'Y')}</span>`)}${live}</div><div><p class="viewer-hero-kicker"><span>${isMember ? 'Community member' : 'Creator community'}</span></p><h1 class="viewer-context-name" id="viewer-home-title" data-preview-field="f_name">${esc(name)}</h1>${b.tagline ? `<p class="viewer-context-sub" data-preview-field="f_tagline">${esc(b.tagline)}</p>` : ''}<p class="viewer-hero-lede">Earn free credits here, climb the standings and claim rewards.</p><div class="viewer-banner-actions">${memberHref ? `<a class="yr-btn${isMember ? ' yr-btn--ghost' : ''}" href="${memberHref}">${viewerIcon(isMember ? 'check' : 'user')}${memberLabel}</a>` : ''}${channel ? `<a class="yr-btn${isMember || !memberHref ? '' : ' yr-btn--ghost'}" href="${esc(channel.href)}" target="_blank" rel="noopener noreferrer">${viewerIcon('chat')}Watch on ${esc(channel.label)}</a>` : `<a class="yr-btn yr-btn--ghost" href="${esc(helpHref)}">How it works ${viewerIcon('chevron')}</a>`}</div></div></div>${note}</section>`;
}

function streamerChannel(ctx) {
  return (ctx.socialLinks || []).map(link => {
    try {
      const url = new URL(link.href);
      const host = url.hostname.replace(/^www\./, '');
      const label = ({ 'kick.com': 'Kick', 'twitch.tv': 'Twitch', 'youtube.com': 'YouTube' })[host];
      return label ? { ...link, label, kick: host === 'kick.com' && /^[a-z0-9_-]*[a-z][a-z0-9_-]*$/i.test(url.pathname.slice(1)) ? url.pathname.slice(1) : '' } : null;
    } catch { return null; }
  }).find(Boolean);
}

function viewerCommunityOverview(ctx) {
  const { b, slug, section, viewer, viewerData, isMember, membershipStatus, balance, siteSections, isCustomDomain } = ctx;
  const name = b.name || slug;
  const claims = viewerData?.claims || [];
  const pending = claims.filter(claim => claim.status === 'submitted');
  const latest = pending[0] || claims[0];
  const meHref = siteSectionHref('me', slug, isCustomDomain);
  if (!isMember) {
    return `<aside class="viewer-overview" aria-label="Selected community overview">${section === 'me' ? '' : guestPrompt(ctx, meHref)}
${section === 'home' || section === 'leaderboard' || section === 'shop' ? '' : leaderboardPreview(ctx)}
<div class="viewer-scope-help">${viewerIcon('shield')}<p><strong>Your membership, your history.</strong>Credits and claims are kept separate for every community you join.</p></div></aside>`;
  }
  return `<aside class="viewer-overview" aria-label="Selected community overview"><section class="viewer-rail-panel viewer-credit-panel"><div class="viewer-rail-head"><h2>${section === 'home' ? 'Your status' : section === 'leaderboard' ? 'Your standing' : 'Reward credits'}</h2>${(section === 'home' || section === 'leaderboard') && siteSections.me !== false ? `<a href="${meHref}">View activity ${viewerIcon('arrow')}</a>` : ''}</div>${section === 'home' || section === 'leaderboard' ? `<div class="viewer-status-who"><span class="viewer-avatar">${avatarHtml(viewer)}</span><div><strong>${esc(viewerName(viewer))}</strong><span>Member of ${esc(name)}</span></div></div>` : ''}<div class="viewer-credit-amount" data-credit-balance="${Number(balance) || 0}">${viewerIcon('coins')}<div><strong data-credit-balance-num>${formatNumber(balance)}</strong><p>credits</p></div></div><p>Only in ${esc(name)}</p>${section === 'home' || section === 'leaderboard' ? homeStatusFacts(ctx) : ''}${viewerData?.viewerOnSite?.blocked ? '<p role="status">Claiming is unavailable for this membership. Contact the creator for help.</p>' : ''}${siteSections.me !== false && !viewerData?.viewerOnSite?.blocked ? `<a class="yr-btn" href="${meHref}#membership-code">Earn reward credits ${viewerIcon('arrow')}</a>` : ''}${rewardClaimFine(section)}</section>
${section === 'home' || (section === 'shop' && ctx.rewardId) ? '' : rewardProgressCard(ctx)}
${section !== 'shop' && section !== 'home' && siteSections.me !== false && latest ? `<section class="viewer-rail-panel"><div class="viewer-rail-head"><h3>Latest claim</h3><span class="viewer-fine" data-viewer-claim-summary>${pending.length ? `${pending.length}${viewerData?.claimsTruncated ? '+' : ''} pending` : 'Recent activity'}</span></div><ul class="viewer-claim-preview">${claimRow(latest)}</ul></section>` : ''}
${section === 'home' || section === 'leaderboard' || section === 'shop' ? '' : leaderboardPreview(ctx)}
${section === 'shop' ? `<section class="viewer-rail-panel"><div class="viewer-rail-head"><h2>How to earn reward credits</h2></div><p>${viewerIcon('code')} Redeem community codes shared by ${esc(name)}.</p><p>Use the creator's channel-point rewards when available. Credits are recorded in My Activity.</p></section>` : ''}
<div class="viewer-scope-help">${viewerIcon('shield')}<p><strong>Your membership, your history.</strong>Credits and claims are kept separate for every community you join.</p></div></aside>`;
}

/** The single rail prompt a non-member sees; the page's own content carries everything else. */
function guestPrompt(ctx, meHref) {
  const { b, slug, section, viewer, membershipStatus, siteSections } = ctx;
  if (siteSections.me === false) return '';
  const name = esc(b.name || slug);
  if (viewer && membershipStatus === 'unavailable') {
    return `<section class="viewer-rail-panel viewer-guest-prompt"><div class="viewer-rail-head"><h2>Your membership</h2></div><p role="status">Your community credits could not load. Reload this page to try again.</p></section>`;
  }
  if (viewer) {
    return `<section class="viewer-rail-panel viewer-guest-prompt"><div class="viewer-rail-head"><h2>Join ${name}</h2></div><p>${section === 'shop' ? `Join to claim ${name}'s rewards with free credits earned here.` : `Join to keep your credits, claims and activity in ${name}.`}</p><a class="yr-btn" href="${meHref}">Join community ${viewerIcon('arrow')}</a>${rewardClaimFine(section)}</section>`;
  }
  const copy = section === 'shop'
    ? { h: 'Claim rewards', p: `Sign in to check your balance and claim ${name}'s rewards. Credits are free and earned in this community.`, intent: 'signin' }
    : section === 'leaderboard'
      ? { h: 'Your standing', p: `Sign in to see your credits and claims alongside ${name}'s leaderboard.`, intent: 'signin' }
      : { h: 'Your status', p: `Sign in to see your credits, claims and recent activity in ${name}.`, intent: 'activity' };
  if (section === 'home' || section === 'leaderboard') {
    return `<section class="viewer-rail-panel viewer-guest-prompt"><div class="viewer-rail-head"><h2>${copy.h}</h2></div><div class="viewer-status-who"><span class="viewer-avatar viewer-avatar--anon" aria-hidden="true">${viewerIcon('user')}</span><div><strong>Not signed in</strong><span>${copy.p}</span></div></div><a class="yr-btn" href="${guestGateHref(meHref, copy.intent)}">Sign in ${viewerIcon('arrow')}</a>${homeStatusFacts(ctx)}</section>`;
  }
  return `<section class="viewer-rail-panel viewer-guest-prompt"><div class="viewer-rail-head"><h2>${copy.h}</h2></div><p>${copy.p}</p><a class="yr-btn" href="${guestGateHref(meHref, copy.intent)}">Sign in ${viewerIcon('arrow')}</a>${rewardClaimFine(section)}</section>`;
}

/** The credits/claim restrictions, shown once on Rewards inside the rail's claim panel. */
function rewardClaimFine(section) {
  return section === 'shop' ? `<p class="yr-fine viewer-rail-fine">${REWARD_CLAIM_FINE}</p>` : '';
}

/**
 * Rank, credits and latest claim as one status list. Members get their real
 * values; anyone else sees an explicit dash, never a placeholder number. Rank
 * comes from the published standings only when the viewer's own name is on
 * them.
 */
function homeStatusFacts(ctx) {
  const { data, viewer, isMember, balance, viewerData, siteSections } = ctx;
  const own = isMember ? viewerName(viewer).toLowerCase() : '';
  const standing = own && siteSections.leaderboard !== false ? (data.players || []).find(player => String(player.name || '').toLowerCase() === own) : null;
  const claims = isMember ? viewerData?.claims || [] : [];
  const latest = claims.find(claim => claim.status === 'submitted') || claims[0];
  const dash = (why) => `<dd>—<span class="yr-sr"> ${why}</span></dd>`;
  return `<dl class="viewer-status-facts"><div><dt>${viewerIcon('crown')}Your rank</dt>${standing ? `<dd>#${esc(String(standing.rank || ''))}</dd>` : dash(isMember ? 'not on the current standings' : 'sign in to see it')}</div>${isMember ? '' : `<div><dt>${viewerIcon('coins')}Credits</dt>${dash('sign in to see them')}</div>`}<div><dt>${viewerIcon('gift')}Latest claim</dt>${latest ? `<dd>${esc(latest.reward?.name || latest.statusLabel || 'Claimed')}</dd>` : dash(isMember ? 'no claims yet' : 'sign in to see it')}</div></dl>`;
}

function leaderboardPreview(ctx) {
  const { data, b, slug, siteSections, isCustomDomain, section } = ctx;
  // siteSections.leaderboard already derives from the "Show Leaderboard"
  // toggle via effectivePublicSections(); this is the only check needed.
  if (siteSections.leaderboard === false) return '';
  const home = section === 'home';
  const players = (data.players || []).slice().sort((a,b) => (a.rank || 0) - (b.rank || 0)).slice(0, home ? 10 : 3);
  const podium = home && players.length >= 3;
  const rows = players.map((player, i) => `<div class="viewer-board-row"${podium && i < 3 ? ` data-home-slot="${i + 1}"` : ''}><span class="viewer-rank">${player.rank || i + 1}</span><span class="viewer-avatar">${esc(Array.from(String(player.name || '?')).slice(0,2).join('').toUpperCase())}</span><span class="viewer-player-name">${esc(player.name)}</span><span class="viewer-board-score">${esc(data.rankBy === 'wagered' ? formatMoney(prizeCurrency(data), player.wagered) : formatNumber(player.score || 0))}</span></div>`).join('');
  const homeEmpty = `<div class="viewer-home-empty viewer-home-empty--podium"><div>${viewerIcon('leaderboard')}<p><strong>No standings yet.</strong> The creator publishes leaderboard scores; the first three places take the podium here.</p></div></div>`;
  return `<section class="viewer-card${home ? ' viewer-home-board' : ''}"><div class="viewer-card-head"><h2>${viewerIcon(home ? 'crown' : 'leaderboard')}${home ? `${esc(b.period || 'Current')} leaderboard` : 'Leaderboard'}</h2><a href="${siteSectionHref('leaderboard', slug, isCustomDomain)}">View all ${viewerIcon('arrow')}</a></div><p${home ? ' class="yr-sr"' : ''}>${esc(b.period || 'Current')} standings</p><div class="viewer-board-list"${podium ? ' data-home-podium="3"' : ''}>${rows || (home ? homeEmpty : '<p>No standings yet. The creator publishes leaderboard scores.</p>')}</div></section>`;
}

function rewardProgressCard(ctx) {
  const { b, slug, viewerData, data, siteSections, isCustomDomain, isMember, balance } = ctx;
  if (siteSections.shop === false || !isMember) return '';
  const shopHref = siteSectionHref('shop', slug, isCustomDomain);
  const blocked = !!viewerData?.viewerOnSite?.blocked;
  const available = (viewerData?.shopItems || data.shopItems || []).filter(item => item.active !== false && (item.stock == null || Number(item.stock) > 0) && !Number(item.cooldownRemaining)).sort((a,b) => Number(a.cost) - Number(b.cost));
  const nextReward = available.find(item => Number(item.cost) > balance) || available[0];
  const progress = nextReward ? Math.min(100, Math.max(0, Math.floor(balance / Math.max(1, Number(nextReward.cost)) * 100))) : 0;
  return `<section class="viewer-card viewer-next-reward"><div class="viewer-card-head"><h2>Your next reward</h2>${viewerIcon('gift')}</div>${blocked ? '<p>Claiming is unavailable for this membership. Contact the creator for help.</p>' : nextReward ? `<div class="viewer-reward-progress"><strong>${esc(nextReward.name)}</strong><span>${formatNumber(balance)} / ${formatNumber(nextReward.cost)} credits</span></div><progress max="100" value="${progress}" aria-label="Progress toward ${esc(nextReward.name)}">${progress}%</progress><p>${balance >= Number(nextReward.cost) ? 'You have enough credits for this reward.' : `${formatNumber(Number(nextReward.cost) - balance)} more credits needed. Use ${esc(b.name || slug)}'s channel-point rewards or redeem a community code to earn credits.`}</p><a class="yr-btn" href="${balance >= Number(nextReward.cost) ? rewardDetailHref(shopHref, String(nextReward.id)) : shopHref}">${balance >= Number(nextReward.cost) ? 'Choose a reward' : 'Explore rewards'} ${viewerIcon('arrow')}</a>` : '<p>No rewards are available right now. Check back after the creator adds more.</p>'}</section>`;
}

function recentCreditCard(ctx) {
  const { viewerData, isMember, slug, isCustomDomain, siteSections } = ctx;
  if (siteSections.me === false || !isMember) return '';
  const recent = (viewerData?.ledger || []).slice(0,3);
  return `<section class="viewer-card viewer-recent-activity"><div class="viewer-card-head"><h2>${viewerIcon('activity')}Recent activity</h2><a href="${siteSectionHref('me', slug, isCustomDomain)}">View all ${viewerIcon('arrow')}</a></div>${recent.length ? `<ul>${recent.map(row => {
    const amount = ledgerDelta(row);
    return `<li><span>${esc(LEDGER_KIND[row.type] || 'Credit activity')}<small>${esc(formatDate(row.created_at))}</small></span><strong${amount < 0 ? ' class="is-negative"' : ''}>${amount >= 0 ? '+' : '−'}${formatNumber(Math.abs(amount))} credits</strong></li>`;
  }).join('')}</ul>` : '<p>No credit activity yet. Redeem a code shared by the creator or use their channel-point rewards to get started.</p>'}</section>`;
}

function homePromo(ctx) {
  const { slug, siteSections, isCustomDomain } = ctx;
  if (siteSections.shop === false) return '';
  const name = esc(ctx.b.name || slug);
  const shopHref = siteSectionHref('shop', slug, isCustomDomain);
  return `<section class="viewer-home-promo" aria-labelledby="viewer-home-promo-title"><div class="viewer-home-promo-copy"><h2 id="viewer-home-promo-title">More than <em>just rewards</em></h2><p>Earn credits in ${name}, climb the standings and claim what you want.</p></div><div class="viewer-home-promo-art" aria-hidden="true"><span>${viewerIcon('leaderboard')}</span><span>${viewerIcon('coins')}</span><span>${viewerIcon('gift')}</span></div><div class="viewer-home-promo-cta"><p>Free credits.<br />Real rewards.</p><a class="yr-btn" href="${shopHref}">Explore rewards ${viewerIcon('arrow')}</a></div></section>`;
}

function homeMain(ctx) {
  const { slug, viewerData, data, siteSections, isCustomDomain } = ctx;
  const shopHref = siteSectionHref('shop', slug, isCustomDomain);
  // Up to four configured rewards, presented as products the viewer can want.
  const items = (viewerData?.shopItems || data.shopItems || []).filter(item => item.active !== false).slice(0, 4);
  const name = esc(ctx.b.name || slug);
  const rewardCards = items.map(item => `<li class="yr-rwd">${rewardImage(item, slug)}<div class="yr-rwd-main"><h3 class="yr-rwd-n">${esc(item.name)}</h3>${item.description ? `<p class="yr-rwd-p">${esc(item.description)}</p>` : ''}</div><div class="yr-rwd-side"><p class="yr-rwd-c">${viewerIcon('coins')}${formatNumber(item.cost)} credits</p><a class="yr-act" href="${rewardDetailHref(shopHref, String(item.id))}" aria-label="View ${esc(item.name)}">View reward ${viewerIcon('arrow')}</a></div></li>`).join('');
  // Empty shelves keep the product grid's shape so the page reads the same
  // before the creator publishes anything; nothing on them is for sale.
  const emptyRewards = `<div class="viewer-home-empty viewer-home-empty--shelf"><div class="viewer-shelf-ghost" aria-hidden="true"><span></span><span></span><span></span><span></span></div><div>${viewerIcon('gift')}<p><strong>No rewards yet.</strong> The creator will publish them here; credits you earn in ${name} stay ready for them.</p></div></div>`;
  return `<div class="viewer-home-columns">${leaderboardPreview(ctx)}${siteSections.shop !== false ? `<section class="viewer-card viewer-home-rewards"><div class="viewer-card-head"><h2>${viewerIcon('gift')}Community rewards</h2><a href="${shopHref}">View all ${viewerIcon('arrow')}</a></div>${items.length ? `<ul class="yr-rwds" data-count="${Math.min(items.length, 3)}">${rewardCards}</ul>` : emptyRewards}</section>` : ''}</div>`;
}

/* ── Leaderboard / Ranks ──────────────────────────────────────────────── */

function boardMain(ctx) {
  const { data, b, slug, isCustomDomain, period, pool } = ctx;
  const currency = prizeCurrency(data);
  const hidePrizes = !!data.brand?.hidePrizeAmounts;
  const cd = formatLeaderboardTiming(data.scheduled ? data.startsAt : data.endsAt);
  const scheduled = !!data.scheduled && cd.kind !== "expired";
  const ended = !!data.ended || (!data.scheduled && cd.kind === "expired");
  const players = (Array.isArray(data.players) ? data.players : []).slice().sort((x, z) => (x.rank || 0) - (z.rank || 0) || String(x.name || "").localeCompare(String(z.name || "")));
  const playerCount = Number(data.playerCount) || players.length;
  const rankBy = data.rankBy === "wagered" ? "wagered" : "score";
  const wagerLabel = esc(rankBy === "score" ? "Points" : (data.prizes?.wagerLabel || "Amount"));
  const rankValue = (player) => rankBy === "score" ? `${formatNumber(player.score || 0)} pts` : formatMoney(currency, player.wagered);
  const prizeLabel = esc(data.prizes?.prizeLabel || "Prize");
  const poolLabel = esc(data.prizes?.prizePoolLabel || b.prizePoolLabel || "Prize pool");
  const showPool = data.sections?.payouts !== false && hasConfiguredPrizePool(pool) && !hidePrizes;
  const showPrizes = data.sections?.payouts !== false && !hidePrizes && (hasConfiguredPrizePool(pool) || players.some((player) => Number(player.prize) > 0));
  const sponsor = String(b.casino || "").trim();
  const hasRules = data.sections?.rules !== false && (Array.isArray(data.rules) ? data.rules : []).some((rule) => typeof rule === "string" && rule.trim());
  const playerHref = (name) => isCustomDomain ? `/player/${encodeURIComponent(name)}` : `/${encodeURIComponent(slug)}/player/${encodeURIComponent(name)}`;

  const stateLabel = ended ? "Ended" : scheduled ? "Not started" : "Live";
  const stateClass = ended ? "is-ended" : scheduled ? "is-soon" : "is-live";
  const metaItems = [
    `<span class="yr-lbh-state ${stateClass}">${stateLabel}</span>`,
    `<span>${esc(period)} leaderboard</span>`,

    data.sections?.countdown !== false ? (ended ? timingHtml(formatLeaderboardTiming(data.endsAt)) : timingHtml(cd, { scheduled })) : "",
    showPool ? `<span>${esc(pool)} ${poolLabel.toLowerCase()}</span>` : "",
  ].filter(Boolean).join("");

  // The hero carries the board's identity and its real metadata: state,
  // period, timing and pool. The player count stays with the list. The scene on the
  // right is drawn, not data.
  const introHtml = `<section class="yr-lbh viewer-board-hero">
<div class="viewer-board-hero-copy">
<p class="viewer-hero-kicker">${esc(b.name || slug)} · Creator community</p>
<h1 class="yr-h1 yr-lbh-title">${data.eventName ? esc(data.eventName) : ended ? "Final leaderboard" : scheduled ? "Leaderboard opens soon" : "Leaderboard"}</h1>
<p class="yr-lbh-note">${scheduled ? `Pre-start standings are visible; scores update once the round begins. Ranked by ${wagerLabel.toLowerCase()}, and tied players share a rank.` : `Ranked by ${wagerLabel.toLowerCase()}. Tied players share a rank.`}</p>
<p class="yr-lbh-meta">${metaItems}</p>
</div>
<div class="viewer-board-hero-scene" aria-hidden="true"><span class="viewer-board-orb viewer-board-orb--a"></span><span class="viewer-board-orb viewer-board-orb--b"></span><span class="viewer-board-hero-trophy">${ICONS.trophy}</span></div>
</section>`;

  // A podium is a presentation of the original rows, never a second player
  // list. Tied top ranks keep equal rows rather than arbitrarily choosing a winner.
  const podium = players.length >= 3 && players.every((p, i) =>
    i < 3 ? Number(p.rank) === i + 1 : Number(p.rank) > 3);
  const rows = players.map((p, i) => {
    const rank = Number(p.rank) || i + 1;
    const prize = showPrizes && p.prize ? esc(formatMoney(currency, p.prize)) : "";
    const podiumSlot = podium && i < 3 ? ` data-podium-slot="${rank}"` : "";
    const mark = `<span class="yr-player-mark" aria-hidden="true">${esc(Array.from(String(p.name || "?")).slice(0, 2).join("").toUpperCase())}</span>`;
    const nameTag = data.eventId ? 'span' : 'a';
    return `<li class="yr-srow${rank === 1 ? " yr-srow--first" : rank <= 3 ? " yr-srow--top" : ""}" data-player-name="${esc(String(p.name || "").toLowerCase())}" data-position="${rank}"${podiumSlot}>
<span class="yr-srow-rank"><span class="yr-sr">Rank </span>${rank}</span>
<${nameTag} class="yr-srow-name"${data.eventId ? '' : ` href="${playerHref(p.name)}"`}>${mark}<span class="yr-player-name">${esc(p.name)}</span></${nameTag}>
<span class="yr-srow-val"><span class="yr-sr">${wagerLabel}: </span>${esc(rankValue(p))}</span>
${prize ? `<span class="yr-srow-prize"><span class="yr-sr">${prizeLabel}: </span>${prize}</span>` : ""}
</li>`;
  }).join("");

  // Column labels are a wide-viewport reading aid only: every cell already
  // carries its own screen-reader label, so announcing them twice is noise.
  const columns = `<div class="yr-stand-head" aria-hidden="true" data-hide-prizes="${showPrizes ? "false" : "true"}"><span>#</span><span>Player</span><span class="yr-r">${wagerLabel}</span>${showPrizes ? `<span class="yr-r">${prizeLabel}</span>` : ""}</div>`;

  const standings = players.length
    ? `${columns}
<ol class="yr-stand" data-rows aria-label="Standings for ${esc(b.name || slug)}" data-value-label="${wagerLabel}" data-prize-label="${prizeLabel}" data-hide-prizes="${showPrizes ? "false" : "true"}">${rows}</ol>
<p class="yr-nomatch" id="yr-no-match" hidden>No players match that search.</p>
<p class="yr-search-status" id="yr-search-status" role="status" aria-live="polite"></p>
${playerCount > players.length ? `<div class="yr-pagination"><button class="yr-btn yr-btn--sm" type="button" data-load-more>Load more players</button><p class="yr-page-status" data-load-more-status role="status" aria-live="polite" tabindex="-1"></p></div>` : ""}`
    : emptyState(ICONS.trophy, "No leaderboard entries yet.", scheduled ? "Standings fill in once the round starts. Ask the creator how to participate." : `Ask ${esc(b.name || slug)} how ${wagerLabel.toLowerCase()} ${rankBy === "score" ? "are" : "is"} counted on this leaderboard. Your first published ${rankBy === "score" ? "score" : "entry"} puts you on the board. Leaderboard ${wagerLabel.toLowerCase()} ${rankBy === "score" ? "are" : "is"} separate from Credits.`);

  const customPayoutNote = String(data.prizes?.payoutNote || "").trim();
  const payoutNote = !showPool ? ""
    : customPayoutNote ? esc(customPayoutNote)
    : `${esc(pool)} ${poolLabel.toLowerCase()}, awarded by ${esc(sponsor || b.name || slug)} to the top-ranked players${hasRules ? " under these rules" : ""}. Prizes are separate from credits — credits can't be won here.`;
  const notes = [
    data.resetNote ? `<p class="yr-note">${esc(data.resetNote)}</p>` : "",
    payoutNote && !hasRules ? `<p class="yr-note yr-note--w">${payoutNote}</p>` : "",
  ].filter(Boolean).join("");
  const rulesHtml = rulesBlock(data, payoutNote);

  const events = Array.isArray(data.eventBoards) ? data.eventBoards : [];
  const switcher = boardTabs(ctx) + (events.length ? `<form class="viewer-board-switcher" action="${siteSectionHref('leaderboard', slug, isCustomDomain)}" method="get"><label for="viewer-event">Leaderboard</label><select id="viewer-event" name="event"><option value="">Main leaderboard</option>${events.map(event => `<option value="${esc(event.id)}"${event.id === data.eventId ? ' selected' : ''}>${esc(event.name)}</option>`).join('')}</select><button class="yr-btn yr-btn--sm" type="submit">View leaderboard</button></form>` : '');
  if (data.sections?.leaderboard === false) {
    return `${introHtml}${data.eventUnavailable ? '<p role="status">This event is no longer available. Showing the main leaderboard.</p>' : ''}${switcher}
${panel({ title: "Standings", titleHidden: true, meta: "", body: emptyState(ICONS.trophy, "Standings are hidden", `${esc(b.name || slug)} is not showing the standings right now. Check back later.`), foot: notes })}
${rulesHtml}`;
  }

  return `${introHtml}${data.eventUnavailable ? '<p role="status">This event is no longer available. Showing the main leaderboard.</p>' : ''}${switcher}
<div data-player-board${podium ? ` data-podium="${Math.min(players.length, 3)}"` : ""}>
${panel({
    title: "Standings",
    titleHidden: true,
    meta: `<span data-player-count-badge>${formatNumber(playerCount)} ${playerCount === 1 ? "player" : "players"}</span>`,
    // Player search filters this list, so it lives with the list rather than
    // in shared chrome every other section has to carry.
    body: `${players.length ? `<div class="yr-search-row"><label class="yr-sr" for="yr-search">Search players</label><input class="yr-search" id="yr-search" type="search" placeholder="Search players by name" autocomplete="off" enterkeyhint="search" /></div>` : ""}${standings}`,
    foot: notes,
  })}</div>
${rulesHtml}`;
}

const BOARD_TAB_LABELS: Record<PublicBoardId, string> = { main: "Main", loyalty: "Loyalty" };

/**
 * Main/Loyalty pills under the Leaderboard title. Rendered only when the site
 * has more than one public board, so a Main-only site looks exactly as before.
 * Plain links: the board is URL state (`?board=`), shareable and cache-safe.
 */
function boardTabs(ctx) {
  const { publicBoards: boards, board, slug, isCustomDomain } = ctx;
  if (!Array.isArray(boards) || boards.length < 2) return "";
  return `<nav class="viewer-board-tabs" aria-label="Leaderboard type">${boards.map((id) =>
    `<a class="viewer-board-tab" href="${publicBoardHref(id, slug, isCustomDomain)}" data-board="${id}"${id === board ? ' aria-current="page"' : ""}>${BOARD_TAB_LABELS[id]}</a>`).join("")}</nav>`;
}

/* ── Loyalty leaderboard ───────────────────────────────────────────────────── */

/**
 * Viewers of this community ranked by lifetime credits earned. Rows are site
 * memberships, not leaderboard players: a viewer never becomes a Main player
 * by sharing a name, and spending credits never moves anyone down.
 */
function loyaltyMain(ctx) {
  const { b, slug } = ctx;
  const rows = (Array.isArray(ctx.loyalty) ? ctx.loyalty : []).slice().sort((x, z) => (x.rank || 0) - (z.rank || 0) || String(x.name || "").localeCompare(String(z.name || "")));
  const metric = "Credits earned";

  const introHtml = `<section class="yr-lbh viewer-board-hero">
<div class="viewer-board-hero-copy">
<p class="viewer-hero-kicker">${esc(b.name || slug)} · Creator community</p>
<h1 class="yr-h1 yr-lbh-title">Leaderboard</h1>
<p class="yr-lbh-note">See who's leading this community. Ranked by lifetime credits earned; spending credits never lowers a rank.</p>
<p class="yr-lbh-meta"><span class="yr-lbh-state is-live">Live</span><span>Loyalty leaderboard</span></p>
</div>
<div class="viewer-board-hero-scene" aria-hidden="true"><span class="viewer-board-orb viewer-board-orb--a"></span><span class="viewer-board-orb viewer-board-orb--b"></span><span class="viewer-board-hero-trophy">${ICONS.medal}</span></div>
</section>`;

  const items = rows.map((v, i) => {
    const rank = Number(v.rank) || i + 1;
    const initials = esc(Array.from(String(v.name || "?")).slice(0, 2).join("").toUpperCase());
    const avatar = v.avatarUrl ? safeUrl(v.avatarUrl) : "#";
    const mark = avatar !== "#"
      ? `<img class="yr-player-mark yr-player-avatar" src="${avatar}" alt="" loading="lazy" width="32" height="32" />`
      : `<span class="yr-player-mark" aria-hidden="true">${initials}</span>`;
    return `<li class="yr-srow${rank === 1 ? " yr-srow--first" : rank <= 3 ? " yr-srow--top" : ""}" data-position="${rank}">
<span class="yr-srow-rank"><span class="yr-sr">Rank </span>${rank}</span>
<span class="yr-srow-name">${mark}<span class="yr-player-name">${esc(v.name)}</span></span>
<span class="yr-srow-val"><span class="yr-sr">${metric}: </span>${formatNumber(v.earned || 0)}</span>
</li>`;
  }).join("");

  const columns = `<div class="yr-stand-head" aria-hidden="true" data-hide-prizes="true"><span>#</span><span>Viewer</span><span class="yr-r">${metric}</span></div>`;
  const standings = rows.length
    ? `${columns}
<ol class="yr-stand" data-loyalty-rows aria-label="Loyalty standings for ${esc(b.name || slug)}" data-value-label="${metric}" data-hide-prizes="true">${items}</ol>`
    : emptyState(ICONS.medal, "No loyalty activity yet.", "Viewers will appear here after earning credits.");

  return `${introHtml}${boardTabs(ctx)}
<div data-loyalty-board>
${panel({
    title: "Loyalty standings",
    titleHidden: true,
    meta: `<span>${formatNumber(rows.length)} ${rows.length === 1 ? "viewer" : "viewers"}</span>`,
    body: standings,
    foot: `<p class="yr-note">Lifetime credits earned in this community. Credits you spend on rewards still count here.</p>`,
  })}</div>`;
}

/* ── Rewards ──────────────────────────────────────────────────────────── */

function shopMain(ctx) {
  const { r, b, data, viewer, viewerData, viewerOnSite, isMember, balance, returnTo, slug, homeUrl, isCustomDomain } = ctx;
  const items = (viewerData?.shopItems || data.shopItems || []).filter((i) => i.active !== false).slice().sort((x, z) => Number(x.cost) - Number(z.cost));
  const blocked = !!viewerOnSite?.blocked;
  const creditsHref = `${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}`;

  const unavailable = viewer && ctx.membershipStatus === 'unavailable';
  // The hero carries the creator's identity the same way Home and Leaderboard do;
  // the search and sort controls sit at the top of the catalog itself.
  const head = `<header class="yr-lbh viewer-board-hero viewer-shop-hero"><div class="viewer-board-hero-copy"><p class="viewer-hero-kicker">${esc(b.name || slug)} · Creator community</p><h1 class="yr-h1 yr-lbh-title">Rewards</h1><p class="yr-lbh-note">Redeem your credits for ${esc(b.name || slug)}'s community rewards.</p></div><div class="viewer-board-hero-scene" aria-hidden="true"><span class="viewer-board-orb viewer-board-orb--a"></span><span class="viewer-board-orb viewer-board-orb--b"></span><span class="viewer-board-hero-trophy viewer-shop-hero-gift">${ICONS.gift}</span></div><div class="viewer-shop-hero-aside">${viewerIcon('coins')}<p><strong>Earn, then claim.</strong>Credits are free, earned in this community, and spent only here.</p></div></header>${!viewer || isMember ? '' : `<p class="yr-note">${unavailable ? 'Your membership could not load. Reload this page before claiming a reward.' : 'Join this community before claiming a reward.'}</p>`}`;

  const blockedNote = viewer && blocked
    ? `<p class="yr-note yr-note--w">Claiming is currently unavailable for this membership.</p>`
    : "";

  const list = items.length
    ? `<section aria-label="All rewards"><div class="viewer-shop-tools"><h2 class="yr-sr">All rewards</h2><div class="viewer-reward-tools" hidden><label class="yr-sr" for="viewer-reward-search">Search rewards</label><input id="viewer-reward-search" type="search" placeholder="Search rewards…" aria-controls="viewer-rewards" autocomplete="off" /></div><div class="viewer-reward-tools" hidden><label for="viewer-reward-sort">Sort by</label><select id="viewer-reward-sort" aria-controls="viewer-rewards"><option value="cost">Credits: low to high</option><option value="name">Name</option></select></div></div><ul class="yr-rwds" id="viewer-rewards" role="list" data-count="${Math.min(items.length, 3)}">${items.map((item) => rewardRow({ item, viewer, member: isMember, balance, blocked, unavailable, membershipHref: creditsHref, slug, isCustomDomain })).join("")}</ul><p class="yr-search-status" id="viewer-reward-status" role="status" aria-live="polite"></p><p id="viewer-reward-empty" class="yr-note" hidden>No rewards match your search.</p></section>`
    : `<section class="yr-vsec yr-vsec--empty${viewer ? "" : " yr-vsec--narrow"}">${sectionHead("All rewards")}${emptyState(ICONS.gift, "No rewards yet", `Rewards will appear here when ${esc(b.name || slug)} adds them.`)}</section>`;

  const canOrder = viewer && isMember && !blocked && items.some((item) => (item.stock === null || item.stock === undefined || Number(item.stock) > 0) && Number(item.cost || 0) <= balance);

  return `${head}
${blockedNote}
<p class="yr-redeem-status" id="yr-redeem-status" role="status" aria-live="polite" tabindex="-1"></p>
${list}
${canOrder ? orderConfirmDialog() : ""}`;
}

/* ── Reward detail (/shop/<rewardId>) ─────────────────────────────────── */

/**
 * One reward, described before sign-in: cost, availability, fulfillment and
 * where to ask the creator. The action is the same reviewed claim as the
 * catalog — never a direct deduction — and a missing or withdrawn reward gets
 * a plain recovery state with the way back to Rewards.
 */
function rewardDetailMain(ctx) {
  const { data, b, slug, viewer, viewerData, isMember, balance, homeUrl, isCustomDomain, membershipStatus, viewerOnSite, rewardId, reward: raw } = ctx;
  const creator = b.name || slug;
  const shopHref = siteSectionHref("shop", slug, isCustomDomain);
  const canContact = hasCreatorContactMethod(data);
  const contactHref = isCustomDomain ? "/contact" : `/${encodeURIComponent(slug)}/contact`;
  const back = `<a class="yr-sec-link viewer-reward-back" href="${shopHref}">${viewerIcon('arrow')}Back to Rewards</a>`;

  if (!raw) {
    return `<header class="viewer-page-intro"><div><h1>This reward isn't available</h1><p>There is no reward with this link in ${esc(creator)}'s community. It may have been removed, or the link may be for another community.</p></div></header><section class="viewer-card viewer-reward-missing" aria-label="Reward not found"><p>Everything ${esc(creator)} currently offers is listed on the Rewards page.</p><div class="member-actions"><a class="yr-btn" href="${shopHref}">See all rewards</a>${canContact ? `<a class="yr-sec-link" href="${esc(contactHref)}">Contact the creator</a>` : ''}</div></section>`;
  }

  const reward = publicRewardDetail(raw);
  // Membership-specific state (cooldown) comes from the viewer's own catalog snapshot.
  const snapshot = (viewerData?.shopItems || []).find((item) => String(item.id) === reward.id);
  const item = { ...raw, cooldownRemaining: snapshot?.cooldownRemaining };
  const blocked = !!viewerOnSite?.blocked;
  const unavailable = !!viewer && membershipStatus === 'unavailable';
  const creditsHref = `${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}`;
  const { state, action } = rewardAction({ item, viewer, member: isMember, balance, blocked, unavailable, membershipHref: creditsHref });

  const eligibility = !viewer
    ? `Members of ${esc(creator)}'s community can claim this with ${formatNumber(reward.cost)} credits. Sign in to see your balance.`
    : !isMember
      ? (unavailable ? 'Your membership could not load. Reload this page before claiming.' : `Join ${esc(creator)}'s community, then claim it with ${formatNumber(reward.cost)} credits.`)
      : balance >= reward.cost
        ? `You have ${formatNumber(balance)} credits — enough to claim this.`
        : `You have ${formatNumber(balance)} of the ${formatNumber(reward.cost)} credits needed.`;

  const fact = (icon, label, value) => `<div><dt>${viewerIcon(icon)}<span>${label}</span></dt><dd>${value}</dd></div>`;
  const cooldown = reward.cooldownSeconds > 0
    ? fact('activity', 'Claim limit', `Once every ${esc(formatWaitSeconds(reward.cooldownSeconds))} per member.`)
    : '';
  // The balance sits beside the claim control so the member sees at once whether it is enough.
  const balanceLine = viewer && isMember && !blocked && !unavailable && reward.availability === 'available'
    ? `<p class="viewer-reward-balance" data-credit-balance="${balance}" data-enough="${balance >= reward.cost}">${viewerIcon('coins')}<span>Your balance: <strong data-credit-balance-num>${formatNumber(balance)}</strong> credits</span>${balance >= reward.cost ? '<em>· Enough to claim</em>' : ''}</p>`
    : '';
  const withdrawn = reward.availability === 'inactive'
    ? `<p class="yr-note yr-note--w" role="status">${esc(creator)} no longer offers this reward. It stays here so old links still explain what it was.</p>`
    : '';

  return `<header class="viewer-page-intro viewer-reward-intro"><div>${back}<h1>${esc(reward.name)}</h1><p class="yr-rwd-c">${viewerIcon('coins')}${formatNumber(reward.cost)} credits</p></div></header>
${withdrawn}
<p class="yr-redeem-status" id="yr-redeem-status" role="status" aria-live="polite" tabindex="-1"></p>
<article class="viewer-reward-detail" id="reward-${esc(reward.id)}" aria-labelledby="viewer-reward-title">
<figure class="viewer-reward-media">${rewardImage(raw, slug, { eager: true })}</figure>
<div class="viewer-reward-body">
<h2 id="viewer-reward-title">About this reward</h2>
<p class="viewer-reward-desc${reward.description ? '' : ' is-missing'}">${reward.description ? esc(reward.description) : `${esc(creator)} hasn't added a description yet. Ask them what it includes before you claim.`}</p>
<dl class="viewer-reward-facts">
${fact('coins', 'Cost', `${formatNumber(reward.cost)} credits`)}
${fact('gift', 'Availability', esc(rewardAvailabilityText(reward)))}
${cooldown}
${fact('user', 'Eligibility', eligibility)}
${fact('check', 'Fulfillment', esc(reward.fulfillment))}
${fact('chat', 'Questions', canContact ? `<a href="${esc(contactHref)}">Contact ${esc(creator)}</a> about this reward.` : `<span class="viewer-fine">${esc(creator)} hasn't provided a contact method.</span>`)}
</dl>
<div class="viewer-reward-claim">${state ? `<p class="yr-rwd-state">${esc(state)}</p>` : ''}${action}${balanceLine}<p class="yr-fine">Claiming opens a review step first; nothing is deducted until you confirm, and the creator then completes it.</p></div>
</div>
</article>
${viewer && isMember && !blocked && action.includes('data-redeem=') ? orderConfirmDialog() : ''}`;
}

/** One canonical viewer Claim: what it was, when it was submitted, and its audited outcome. */
function claimRow(row) {
  const status = String(row.status || "submitted");
  const label = String(row.statusLabel || "Needs fulfillment");
  const tagCls = status === "submitted" ? "yr-tag yr-tag--pending" : status === "completed" ? "yr-tag yr-tag--done" : "yr-tag";
  const terminalAt = status === "completed" ? row.completedAt : status === "cancelled" ? row.cancelledAt : null;
  const terminalLabel = status === "completed" ? "Completed" : status === "cancelled" ? "Cancelled" : "";
  const support = row.support && (row.support.status === "open" || row.support.status === "resolved") ? row.support : null;
  const supportTag = support ? `<span class="yr-tag${support.status === "open" ? " yr-tag--pending" : ""}" data-support-tag>${support.status === "open" ? "Support open" : "Support resolved"}</span>` : "";
  const supportAction = `<button class="yr-sec-link yr-ord-help" type="button" data-claim-support="${esc(String(row.id || ""))}" data-claim-name="${esc(row.reward?.name || "Reward claim")}" data-claim-status="${esc(label)}">${support ? "View support conversation" : "Need help with this claim?"}</button>`;
  return `<li class="yr-ord" data-claim-id="${esc(String(row.id || ""))}">
<div class="yr-ord-main">
<p class="yr-ord-n">${esc(row.reward?.name || "Reward claim")}</p>
<p class="yr-ord-p">${formatNumber(row.reward?.cost)} credits · Submitted ${esc(formatDate(row.submittedAt))}${terminalAt ? ` · ${terminalLabel} ${esc(formatDate(terminalAt))}` : ""}</p>
${supportAction}
</div>
<span class="yr-ord-tags"><span class="${tagCls}">${esc(label)}</span>${supportTag}</span>
</li>`;
}

/** Claim support: a creator <-> viewer thread attached to one claim. Same
 *  native <dialog> as the claim confirmation; the shell script fills it. */
function claimSupportDialog(creator) {
  return `<dialog class="yr-modal yr-claim-support" id="yr-claim-support" aria-labelledby="yr-claim-support-t">
<div class="yr-modal-in">
<h2 id="yr-claim-support-t">Get help with this claim</h2>
<p class="yr-ord-n" data-claim-support-reward></p>
<p class="yr-fine"><span data-claim-support-claim-status></span><span data-claim-support-state></span></p>
<form class="yr-claim-support-new" data-claim-support-new hidden>
<fieldset class="yr-claim-support-issues"><legend class="yr-sec-sub">What's the issue?</legend>
<label><input type="radio" name="issueType" value="reward_not_received" required /><span>Reward not received</span></label>
<label><input type="radio" name="issueType" value="wrong_or_invalid_reward" /><span>Wrong / invalid reward</span></label>
<label><input type="radio" name="issueType" value="taking_too_long" /><span>Taking too long</span></label>
<label><input type="radio" name="issueType" value="other" /><span>Other</span></label>
</fieldset>
<label class="yr-sec-sub" for="yr-claim-support-message">Tell the creator more</label>
<textarea id="yr-claim-support-message" name="message" rows="4" maxlength="2000" placeholder="What happened?" required aria-describedby="yr-claim-support-hint"></textarea>
<p class="yr-note" id="yr-claim-support-hint">This message goes to ${creator}, not YourRank support.</p>
<p class="yr-modal-status" data-claim-support-status role="status" aria-live="polite"></p>
<div class="yr-modal-acts">
<button class="yr-btn yr-btn--ghost yr-btn--sm" type="button" data-claim-support-close>Cancel</button>
<button class="yr-btn yr-btn--sm" type="submit">Send to creator</button>
</div>
</form>
<div class="yr-claim-support-thread-wrap" data-claim-support-thread-wrap hidden>
<ol class="yr-claim-support-thread" data-claim-support-thread role="list" aria-live="polite"></ol>
<form class="yr-claim-support-reply" data-claim-support-reply>
<label class="yr-claim-support-sr" for="yr-claim-support-reply-message">Your reply</label>
<textarea id="yr-claim-support-reply-message" name="message" rows="3" maxlength="2000" placeholder="Write a reply…" required></textarea>
<p class="yr-modal-status" data-claim-support-status role="status" aria-live="polite"></p>
<div class="yr-modal-acts">
<button class="yr-btn yr-btn--ghost yr-btn--sm" type="button" data-claim-support-close>Close</button>
<button class="yr-btn yr-btn--sm" type="submit">Reply</button>
</div>
</form>
<p class="yr-note" data-claim-support-resolved hidden>This request is resolved. The conversation stays here, but new replies are closed.</p>
<div class="yr-modal-acts" data-claim-support-resolved-acts hidden><button class="yr-btn yr-btn--ghost yr-btn--sm" type="button" data-claim-support-close>Close</button></div>
</div>
</div>
</dialog>`;
}

/* ── Games ────────────────────────────────────────────────────────────── */

function gamesMain(ctx) {
  const { r, b, slug, viewer, balance, returnTo, nonce, logoUrl, homeUrl, isCustomDomain } = ctx;
  const heroHtml = hero({
    eyebrow: "PLAY WITH CREDITS",
    title: "Games",
    lede: "Credits only. Nothing here can be bought with money and nothing pays out money — every round is decided on the server.",
    right: viewer
      ? `<div class="yr-hero-r yr-hero-r--stack">${heroStat("Playable balance", formatNumber(balance))}</div>`
      : `<div class="yr-hero-r">${signInButton(r, returnTo)}</div>`,
  });

  const mount = gamesIslandMount({
    slug,
    nonce,
    siteName: b.name || slug,
    logoUrl: logoUrl || null,
    creditsUrl: `${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}`,
    signInUrl: viewerSignInHref(r, returnTo),
    header: false,
  });

  if (!viewer && !ctx.isDemo) {
    return `${heroHtml}
<div class="yr-gate"><h2>Sign in to play originals</h2><p>Rounds are tied to your account and settled on the server. They cost credits only — no money in, no money out.</p>${signInButton(r, returnTo)}</div>`;
  }

  return `${heroHtml}
${sectionHead("Available games", `<span class="yr-panel-meta">Server decided · provably fair</span>`)}
${mount}`;
}

/* ── My activity ───────────────────────────────────────────────── */

function meMain(ctx) {
  const { r, b, data, slug, viewer, viewerData, membershipStatus, balance, homeUrl, isCustomDomain, siteSections, viewerAuthError, viewerIntent } = ctx;
  const creator = esc(b.name || slug);
  const homeHref = siteSectionHref("home", slug, isCustomDomain);
  const meHref = siteSectionHref("me", slug, isCustomDomain);
  const accountHref = globalViewerAccountHref(isCustomDomain, slug);
  const shopHref = siteSectionHref("shop", slug, isCustomDomain);
  const authMessages = {
    access_denied: "Sign-in was cancelled. Try again when you're ready.",
    missing_oauth_params: "The sign-in provider did not return the information needed. Try again.",
    oauth_state_expired: "That sign-in took too long. Try again.",
    kick_auth_failed: "We couldn't complete Kick sign-in. Try again.",
    discord_auth_failed: "We couldn't complete Discord sign-in. Try again.",
    kick_signin_unavailable: "Kick sign-in isn't available right now. Try again later.",
    discord_signin_unavailable: "Discord sign-in isn't available right now. Try again later.",
    kick_oauth_callback_mismatch: "Kick returned to an unexpected callback. Try again.",
    discord_oauth_callback_mismatch: "Discord returned to an unexpected callback. Try again.",
    kick_oauth_browser_mismatch: "Kick sign-in must finish in the browser where it started.",
    discord_oauth_browser_mismatch: "Discord sign-in must finish in the browser where it started.",
    join_unavailable: "This community isn't available to join right now.",
    join_failed: "We couldn't join this community. Try again.",
    rate_limited: "Too many sign-in attempts. Wait a moment, then try again.",
  };
  const authError = viewerAuthError ? `<p class="yr-note yr-note--w" role="alert">${esc(authMessages[viewerAuthError] || "We couldn't complete sign-in. Try again.")}</p>` : "";
  const member = membershipStatus === "member" && !!viewerData?.viewerOnSite;
  // Same hero grammar as Home, Leaderboard and Rewards: the creator's identity,
  // the page, one sentence, a drawn scene. Personal numbers come only from the
  // viewer's real ledger, claims and the published standings.
  const own = member ? viewerName(viewer).toLowerCase() : "";
  const standing = own && siteSections.leaderboard !== false ? (data.players || []).find((player) => String(player.name || "").toLowerCase() === own) : null;
  const heading = `<header class="yr-lbh viewer-board-hero viewer-me-hero"><div class="viewer-board-hero-copy"><p class="viewer-hero-kicker">${creator} · ${member ? "Community member" : "Creator community"}</p><h1 class="yr-h1 yr-lbh-title">My Activity</h1><p class="yr-lbh-note">Your credits, claims and activity in ${creator}.</p></div><div class="viewer-board-hero-scene" aria-hidden="true"><span class="viewer-board-orb viewer-board-orb--a"></span><span class="viewer-board-orb viewer-board-orb--b"></span><span class="viewer-me-hero-clock">${viewerIcon('activity')}</span></div>${member ? `<aside class="viewer-shop-hero-aside viewer-me-hero-aside">${viewerIcon('coins')}<p><strong>Earn here, claim here.</strong>Credits you earn in ${creator} are redeemed for rewards here.</p></aside>` : ""}</header>${member ? `<dl class="viewer-stats viewer-me-stats"><div>${viewerIcon('coins')}<div><dt>Your credits</dt><dd data-credit-balance="${Number(balance) || 0}"><span data-credit-balance-num>${formatNumber(balance)}</span></dd><p>Only in ${creator}</p></div></div><div>${viewerIcon('gift')}<div><dt>Claims</dt><dd>${formatNumber((viewerData.claims || []).length)}${viewerData.claimsTruncated ? '+' : ''}</dd><p>Rewards you've claimed</p></div></div><div>${viewerIcon('activity')}<div><dt>Credit activity</dt><dd>${formatNumber((viewerData.ledger || []).length)}${viewerData.ledgerTruncated ? '+' : ''}</dd><p>Recent credit changes</p></div></div>${standing ? `<div>${viewerIcon('crown')}<div><dt>Current rank</dt><dd>#${esc(String(standing.rank || ""))}</dd><p>On the ${esc((b.period || "current").toLowerCase())} leaderboard</p></div></div>` : ""}</dl>` : ''}`;
  if (!viewer) {
    const reward = viewerIntent.intent === "reward"
      ? (viewerData?.shopItems || data.shopItems || []).find((item) => String(item.id) === viewerIntent.rewardId)
      : null;
    const intent = viewerIntent;
    const copy = viewerIntentCopy(intent, b.name || slug, reward?.name || "");
    const returnTo = `${homeUrl}${viewerIntentReturnTo(intent, { homeHref, meHref, shopHref })}`;
    const query = `returnTo=${encodeURIComponent(returnTo)}${intent.intent === "join" ? `&intent=join&site=${encodeURIComponent(slug)}` : ""}`;
    const providers = providerButtons(r, query, copy.action);
    const joinOffer = intent.intent === "join" || !providers
      ? ""
      : `<p class="yr-note">Not a member yet? <a href="${guestGateHref(meHref, "join")}">Join ${creator}</a> instead.</p>`;
    return `${heading}${authError}<section class="member-gate" data-viewer-intent="${esc(intent.intent)}"><span class="member-gate-ico" aria-hidden="true">${viewerIcon('user')}</span><div><h2>${esc(copy.heading)}</h2><p>${esc(copy.body)}</p><div class="member-actions">${providers || '<p role="status">Sign-in is not available for this community right now.</p>'}<a class="yr-sec-link" href="${homeHref}">Back to ${creator}</a><a class="yr-sec-link" href="${accountHref}">My communities</a></div>${joinOffer}</div></section>`;
  }
  if (membershipStatus === "absent") {
    return `${heading}${authError}<section class="member-gate"><span class="member-gate-ico" aria-hidden="true">${viewerIcon('user')}</span><div><h2>You haven't joined this community yet.</h2><p>Join to keep your Rewards, free credits and Claims together here.</p><div class="member-actions"><button class="yr-btn" id="yr-membership-join" type="button" data-membership-join data-site-slug="${esc(slug)}">Join community</button></div><p id="yr-membership-join-status" role="status" aria-live="polite" tabindex="-1"></p></div></section>${codeDropClaimSection({slug,creator,joinsMembership:true})}`;
  }
  if (!member) {
    return `${heading}${authError}<section class="member-gate"><span class="member-gate-ico" aria-hidden="true">${viewerIcon('user')}</span><div><h2>Your membership couldn't load</h2><p>Your account is signed in, but this community's information is unavailable. Try reloading or return to your communities.</p><div class="member-actions"><a class="yr-btn" href="${siteSectionHref("me",slug,isCustomDomain)}">Reload membership</a><a class="yr-sec-link" href="${accountHref}">All communities</a></div></div></section>`;
  }
  const ledger = viewerData.ledger || [];
  const participation = viewerData.participation || [];
  const claims = viewerData.claims || [];
  const blocked = viewerData.viewerOnSite.blocked;
  const historyRows = ledger.map(row => {
    const amount = ledgerDelta(row);
    return `<li class="yr-hist"><span class="viewer-history-icon${amount < 0 ? " is-spend" : ""}">${viewerIcon(amount < 0 ? 'gift' : 'coins')}</span><div class="yr-hist-main"><p class="yr-hist-n">${esc(LEDGER_KIND[row.type] || String(row.type || "Activity"))}</p>${row.description ? `<p class="yr-hist-p">${esc(row.description)}</p>` : ""}</div><div class="yr-hist-side"><p class="yr-hist-amt${amount >= 0 ? " yr-pos" : " yr-neg"}">${amount >= 0 ? "+" : "−"}${formatNumber(Math.abs(amount))}<span class="yr-hist-unit"> credits</span></p><p class="yr-hist-d">${esc(formatDate(row.created_at))}</p></div></li>`;
  }).join("");
  const participationRows = participation.map(row => `<li class="yr-part"><div class="yr-part-main"><p class="yr-part-n">${esc(row.title || "Community participation")}</p><p class="yr-part-p">${esc(formatDate(row.participatedAt))}</p></div><span class="yr-tag yr-tag--done">${esc(row.statusLabel || "Claimed")}</span></li>`).join("");
  return `${heading}${authError}
${blocked ? '<p class="yr-note yr-note--w" role="status">Claiming is currently unavailable for this membership.</p>' : ""}
<div class="viewer-tabs" role="tablist" aria-label="Activity sections">${membershipTab("history", "Credit activity", true)}${membershipTab("claims", "Claims")}${membershipTab("participation", "Participation")}${blocked ? '' : membershipTab("code", "Redeem code")}</div>
<section class="member-section" id="membership-history" role="tabpanel" aria-labelledby="membership-tab-history" tabindex="0"><div class="member-section-head"><h2 id="member-history-title">Credit activity</h2><p>${formatNumber(ledger.length)} recent</p></div>${historyRows ? `<ul class="yr-hists" role="list">${historyRows}</ul>` : `<div class="member-empty"><div><h3>No credit activity yet</h3><p>Credits you earn in ${creator} and spend on rewards will show up here.</p></div></div>`}</section>
<section class="member-section" id="membership-claims" role="tabpanel" aria-labelledby="membership-tab-claims" tabindex="0">
<div class="member-section-head"><h2 id="member-claims-title">Your claims</h2><p>${claims.length ? `${formatNumber(claims.length)} recent` : "Reward status, in one place"}</p></div>
${claims.length
  ? `<ul class="yr-ords" role="list">${claims.map(claimRow).join("")}</ul><p class="yr-fine">${esc(CLAIM_STATUS_NOTE)}</p>${viewerData.claimsTruncated ? `<p class="yr-fine">Showing the ${formatNumber(viewerData.claimsLimit || claims.length)} most recent Claims.</p>` : ""}${claimSupportDialog(creator)}`
  : `<div class="member-empty"><div><h3>No claims yet</h3><p>${blocked ? 'Claiming is unavailable for this membership.' : 'Choose a reward in the Reward shop. Its status will appear here after you claim it.'}</p></div></div>`}
</section>
<section class="member-section" id="membership-participation" role="tabpanel" aria-labelledby="membership-tab-participation" tabindex="0"><div class="member-section-head"><h2 id="member-participation-title">Participation</h2><p>${formatNumber(participation.length)} recent</p></div>${participationRows ? `<ul class="yr-parts" role="list">${participationRows}</ul>${viewerData.participationTruncated ? `<p class="yr-fine">Showing the ${formatNumber(viewerData.participationLimit || participation.length)} most recent participation records.</p>` : ""}` : '<div class="member-empty"><p>No participation history yet. Successful free code-drop claims will appear here.</p></div>'}</section>
${blocked ? "" : codeDropClaimSection({slug,creator,asTabPanel:true})}
`;
}

/** One My Activity tab; the href keeps the panel reachable as a plain anchor when the shell script is unavailable. */
function membershipTab(key, label, selected = false) {
  return `<a role="tab" id="membership-tab-${key}" href="#membership-${key}" aria-controls="membership-${key}" aria-selected="${selected ? "true" : "false"}">${label}</a>`;
}

function codeDropClaimSection({ slug, creator, joinsMembership = false, asTabPanel = false }) {
  const membershipNote = joinsMembership
    ? " A successful claim joins this community and records the participation on your Membership."
    : " A successful claim appears in Participation on this Membership.";
  const panelAttrs = asTabPanel ? ' role="tabpanel" aria-labelledby="membership-tab-code" tabindex="0"' : ' aria-label="Redeem a community code"';
  return `<section class="member-code yr-code-drop" id="membership-code"${panelAttrs}>
<h2>Have a community code?</h2>
<p class="yr-note" id="yr-code-drop-help">Enter a code shared by ${creator}.${membershipNote} Each code can be claimed once while it is active.</p>
<form class="yr-code-drop-form" data-code-drop-claim data-site-slug="${esc(slug)}">
<label class="yr-code-drop-label" for="yr-code-drop-code">Community code</label>
<div class="yr-code-drop-controls">
<input class="yr-code-drop-input" id="yr-code-drop-code" name="code" type="text" minlength="3" maxlength="32" pattern="[A-Za-z0-9_\\-]+" placeholder="COMMUNITY100" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="yr-code-drop-help" required />
<button class="yr-btn yr-btn--sm" type="submit" data-code-drop-submit>Redeem code</button>
</div>
<p class="yr-code-drop-status" id="yr-code-drop-status" role="status" aria-live="polite" tabindex="-1"></p>
</form>
</section>`;
}

