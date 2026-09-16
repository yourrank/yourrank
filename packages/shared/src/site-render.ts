// @ts-nocheck
// Multi-section, branded streamer site shell (Home, Activities, Leaderboard,
// Rewards, Games, My Activity).
//
// The chrome is a creator destination, not a workspace: a dark creator rail
// carries identity and the community destinations, a quiet top bar carries
// context and the viewer's own controls, and the page renders on a light canvas
// of white modules. It ships as a single stylesheet (/assets/site-shell.css
// for record primitives + /assets/viewer-shell.css for the viewer system) plus
// a small progressive-enhancement script — no CDN, no runtime CSS framework.
//
// Only data the backend can actually produce is rendered: balances and history
// come from the viewer's ledger, standings from the streamer's board, rewards
// from shop_items, quests from the daily-quests API. Nothing here claims watch
// time, tiers or percentiles, and sponsor cash is kept visually distinct from
// free credits.
import {
  logoSrcSet,
  renderLegalSidebar,
  esc,
  safeUrl,
  formatWaitSeconds,
} from "./public-render-helpers.js";
import { gamesIslandHead, gamesIslandMount } from "./games-embed.js";
import {
  viewerCommunityChrome,
  viewerIcon,
  viewerHelpHref,
  VIEWER_DESIGN_CONTRACT,
} from "./viewer-shell.js";

const SECTION_LABELS = {
  home: "Home",
  activities: "Activities",
  leaderboard: "Leaderboard",
  shop: "Rewards",
  games: "Games",
  me: "My Activity",
};
const SECTION_ICONS = {
  home: "home",
  activities: "activities",
  leaderboard: "leaderboard",
  shop: "gift",
  games: "games",
  me: "me",
};

// C-10: Widened to accept 3-, 6-, and 8-digit hex values.
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const PUBLIC_ACCENT_DEFAULT = {
  value: "var(--yr-color-board-accent)",
  ink: "#000000",
};
const CREDITS_DISCLAIMER = "Credits are free loyalty points earned from channel-point rewards. No purchase, no cash value, no cashout.";

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
const DEFAULT_SANS_PARAMS = "family=Fira+Sans:wght@400;500;600;700;800";
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

/* ── tiny inline icon set for the legacy (games) chrome ────────────── */
const S = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
const ICONS = {
  home: `<svg ${S}><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>`,
  leaderboard: `<svg ${S}><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3"/><path d="M7 5H4v2a3 3 0 0 0 3 3"/></svg>`,
  shop: `<svg ${S}><path d="M3 9h18l-1.5 11H4.5z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/></svg>`,
  games: `<svg ${S}><rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 12h3M8.5 10.5v3M15.5 11h.01M17.5 13.5h.01"/></svg>`,
  me: `<svg ${S}><ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v11c0 1.7 3.1 3 7 3s7-1.3 7-3v-11"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>`,
  activities: `<svg ${S}><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8"/></svg>`,
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

export function siteSectionHref(section, slug, isCustomDomain) {
  const s = encodeURIComponent(slug || "");
  if (isCustomDomain) return section === "home" ? "/" : `/${section}`;
  return section === "home" ? `/${s}` : `/${s}/${section}`;
}

const GLOBAL_VIEWER_ACCOUNT_URL = "https://yourrank.site/me";
function globalViewerAccountHref(isCustomDomain) {
  return isCustomDomain ? GLOBAL_VIEWER_ACCOUNT_URL : "/me";
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

/** Today / Yesterday / date grouping for the activity feed. */
function ledgerDay(d, today, yesterday) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "Earlier";
  const key = dt.toISOString().slice(0, 10);
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return dt.toLocaleString("en-US", { month: "long", day: "numeric" });
}

function formatTime(d) {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "" : dt.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatShortDate(d) {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "" : dt.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function sectionList(sections) {
  return ["home", "activities", "leaderboard", "shop", "games", "me"].filter((s) => sections[s] !== false);
}

/** Community destinations: the five viewer pages; Games stays a rail link. */
function communityNavKeys(sections) {
  return ["home", "activities", "leaderboard", "shop", "me"].filter((s) => sections[s] !== false);
}

/** Streamer accent, falling back to the public viewer's violet action cue. */
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

function timingHtml(timing, { scheduled = false } = {}) {
  if (!timing || timing.kind === "invalid" || timing.kind === "expired") return "";
  const label = scheduled ? "Starts" : "Ends";
  if (timing.kind === "calendar") {
    return `<span data-countdown-mode="calendar">${label} <time datetime="${esc(timing.iso)}">${esc(timing.text)}</time></span>`;
  }
  return `<span data-countdown-mode="relative" data-countdown-complete="${scheduled ? "Started" : "Ended"}">${label} in <b data-ends-at="${esc(timing.iso)}">${esc(timing.text)}</b></span>`;
}

/* ── shared pieces ─────────────────────────────────────────────────── */

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
 * second navigation surface. (Restricted legacy Games keeps this chrome.)
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
  const accountHref = globalViewerAccountHref(isCustomDomain);
  const acct = viewer ? `<a class="yr-sec-link yr-drawer-acct" href="${accountHref}">All communities ${ICONS.arrow}</a>` : "";
  const userRow = siteSections.me === false
    ? ""
    : viewer
      ? `<a class="yr-user" href="${boardCreditsHref}"><span class="yr-user-l"><span class="yr-ava">${avatarHtml(viewer)}</span><span><span class="yr-user-name">${esc(viewerName(viewer))}</span><span class="yr-user-sub">${isMember ? `${formatNumber(balance)} credits in this community` : "Not joined yet"}</span></span></span><span class="yr-user-go" aria-hidden="true">${ICONS.arrow}</span></a>`
      : `<a class="yr-user" href="${boardCreditsHref}"><span class="yr-user-l"><span class="yr-ava">?</span><span><span class="yr-user-name">My activity</span><span class="yr-user-sub">Sign in to join</span></span></span><span class="yr-user-go" aria-hidden="true">${ICONS.arrow}</span></a>`;
  const foot = `${userRow}${acct}`;

  return `<div class="yr-drawer" id="yr-side" aria-label="${name} menu" tabindex="-1">
<div class="yr-drawer-head"><a class="yr-drawer-id" href="${homeUrl}${siteSectionHref("home", slug, isCustomDomain)}">${creatorMark(logoUrl, "yr-drawer-logo", 32, monogram(b.name || slug, "yr-mark yr-mark--sm"))}${name}</a><button class="yr-side-close" id="yr-side-close" type="button" aria-label="Close menu">${ICONS.close}</button></div>
<nav class="yr-nav yr-noscroll" aria-label="Sections">${items}</nav>
${foot ? `<div class="yr-drawer-foot">${foot}</div>` : ""}
</div>
<div class="yr-scrim" id="yr-scrim" aria-hidden="true" hidden></div>`;
}

function viewerName(viewer) {
  return viewer?.kick_username || viewer?.discord_username || "Member";
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
 * The legacy top bar for the restricted Games island only. Every supported
 * viewer destination renders the creator rail instead.
 */
function topbar({ r, b, viewer, balance, returnTo, section, siteSections, homeUrl, slug, isCustomDomain, logoUrl, isMember }) {
  const name = esc(b.name || slug);
  const tagline = b.tagline ? esc(b.tagline) : "";
  const accountHref = globalViewerAccountHref(isCustomDomain);
  const nav = sectionList(siteSections).map((s) => {
    const href = `${homeUrl}${siteSectionHref(s, slug, isCustomDomain)}`;
    const active = s === section ? ' aria-current="page"' : "";
    return `<a class="yr-tab${s === section ? " is-on" : ""}" href="${href}"${active}><span>${esc(SECTION_LABELS[s])}</span></a>`;
  }).join("");

  const localAccount = isMember
    ? `<a class="yr-bal" href="${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}" data-credit-balance="${Number(balance) || 0}" data-credit-balance-label="Credits in this community" aria-label="Credits in this community: ${formatNumber(balance)}"><span class="yr-bal-num" data-credit-balance-num>${formatNumber(balance)}</span><span class="yr-bal-unit">credits</span></a>`
    : `<a class="yr-bal" href="${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}">My activity</a>`;
  const right = viewer
    ? `${localAccount}
<a class="yr-account-link" href="${accountHref}" aria-label="My communities and Viewer Account"><span class="yr-ava">${avatarHtml(viewer)}</span><span class="yr-account-txt">My communities</span></a>`
    : signInLink(r, returnTo, "yr-btn yr-btn--ghost", accountHref);

  return `<header class="yr-top">
<div class="yr-top-in">
<a class="yr-id" href="${homeUrl}${siteSectionHref("home", slug, isCustomDomain)}">${creatorMark(logoUrl, "yr-id-logo", 36, monogram(b.name || slug, "yr-mark"))}<span class="yr-id-txt"><span class="yr-id-name">${name}</span>${tagline ? `<span class="yr-id-sub">${tagline}</span>` : ""}</span></a>
<nav class="yr-tabs" aria-label="Sections">${nav}</nav>
<div class="yr-top-r">${right}<button class="yr-menu" id="yr-menu" type="button" hidden aria-label="Open sections" aria-controls="yr-side" aria-expanded="false">${ICONS.bars}</button></div>
</div>
</header>`;
}

function signInLink(r, returnTo, cls = "yr-btn", accountHref = "/me") {
  if (r.viewerKickAuthEnabled) {
    return `<a class="${cls}" href="/api/viewer/auth/kick?returnTo=${encodeURIComponent(returnTo)}">Sign in with Kick</a>`;
  }
  if (r.viewerDiscordAuthEnabled) {
    return `<a class="${cls}" href="/api/viewer/auth/discord?returnTo=${encodeURIComponent(returnTo)}">Sign in with Discord</a>`;
  }
  return `<a class="${cls}" href="${accountHref}">Sign in</a>`;
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
  refund: "Refund",
  adjust: "Adjustment by the streamer",
  game_bet: "Game round",
  game_win: "Game round",
};

const CLAIM_STATUS_NOTE = "Needs fulfillment means the creator still needs to complete your reward claim. Completed means it is complete. Cancelled means the credits went back to your balance.";

const LEDGER_ICON = {
  earn: "coins",
  spend: "gift",
  refund: "coins",
  adjust: "coins",
  game_bet: "games",
  game_win: "games",
};

/* ── viewer card primitives ─────────────────────────────────────────── */

function card({ title = "", icon = "", meta = "", body, cls = "", attrs = "", foot = "" }) {
  return `<section class="viewer-card ${cls}"${attrs}>${title ? `<header class="viewer-card-head"><h2 class="viewer-card-title">${icon ? `<span class="viewer-card-ico" aria-hidden="true">${viewerIcon(icon)}</span>` : ""}${esc(title)}</h2>${meta ? `<span class="viewer-card-meta">${meta}</span>` : ""}</header>` : ""}${body}${foot ? `<footer class="viewer-card-foot">${foot}</footer>` : ""}</section>`;
}

function progressTrack(pct, label) {
  return `<div class="viewer-progress" role="img" aria-label="${esc(label || `${pct}%`)}"><span style="width:${Math.min(100, Math.max(0, pct))}%"></span></div>`;
}

/**
 * One claim-state computation shared by reward cards and rows — the same
 * answer never depends on which shape rendered it.
 */
function rewardAction({ item, viewer, member, balance, blocked, unavailable = false, signIn, membershipHref = "" }) {
  const cost = Number(item.cost) || 0;
  const stock = item.stock === null || item.stock === undefined ? null : Number(item.stock);
  const inStock = stock === null || stock > 0;
  const short = viewer ? Math.max(0, cost - balance) : 0;
  const cooldownRemaining = Math.max(0, Math.ceil(Number(item.cooldownRemaining) || 0));

  let state = "";
  let action;
  if (!viewer) {
    action = `<a class="yr-btn yr-btn--sm" href="${signIn}">Sign in to claim</a>`;
  } else if (unavailable) {
    state = "Membership could not load";
    action = `<span class="yr-act yr-act--off" role="note">Unavailable</span>`;
  } else if (!member) {
    state = "Join this community first";
    action = `<a class="yr-btn yr-btn--sm" href="${membershipHref}">Join to claim</a>`;
  } else if (blocked) {
    state = "Claiming disabled on this site";
    action = `<span class="yr-act yr-act--off" role="note">Unavailable</span>`;
  } else if (cooldownRemaining > 0) {
    state = `Ready in ${formatWaitSeconds(cooldownRemaining)}`;
    action = `<span class="yr-act yr-act--off" role="note">On cooldown</span>`;
  } else if (!inStock) {
    action = `<span class="yr-act yr-act--off" role="note">Out of stock</span>`;
  } else if (short > 0) {
    state = `${formatNumber(short)} more needed`;
    action = `<span class="yr-act yr-act--off" role="note">Not enough credits</span>`;
  } else {
    if (stock !== null && stock <= 3) state = `${formatNumber(stock)} left`;
    action = `<button class="yr-btn yr-btn--sm" type="button" data-redeem="${esc(item.id)}" data-reward-name="${esc(item.name)}" data-reward-cost="${cost}">Redeem</button>`;
  }
  return { state, action, cost, stock, inStock, short };
}

function rewardImage(item, slug, cls = "viewer-reward-img") {
  const image = item.has_image ? `/api/public/${encodeURIComponent(slug)}/reward-images/${encodeURIComponent(item.id)}` : item.image_url || item.image || item.imageUrl;
  return image
    ? `<img class="${cls}" src="${esc(image)}" alt="" width="480" height="320" loading="lazy" decoding="async" />`
    : `<div class="${cls} viewer-reward-art" aria-hidden="true">${viewerIcon("gift")}</div>`;
}

function rewardRow({ item, viewer, member = !!viewer, balance, blocked, unavailable = false, signIn, membershipHref = "", slug = "" }) {
  const { state, action, cost } = rewardAction({ item, viewer, member, balance, blocked, unavailable, signIn, membershipHref });
  return `<li class="yr-rwd">
${rewardImage(item, slug, "yr-rwd-img")}
<div class="yr-rwd-main">
<h3 class="yr-rwd-n">${esc(item.name)}</h3>
${item.description ? `<p class="yr-rwd-p">${esc(item.description)}</p>` : ""}
</div>
<div class="yr-rwd-side">
<p class="yr-rwd-c">${formatNumber(cost)} credits</p>
${state ? `<p class="yr-rwd-state">${esc(state)}</p>` : ""}
${action}
</div>
</li>`;
}

/** The larger featured card — same reward contract, more room for the image. */
function rewardCard({ item, viewer, member, balance, blocked, unavailable, signIn, membershipHref, slug }) {
  const { state, action, cost } = rewardAction({ item, viewer, member, balance, blocked, unavailable, signIn, membershipHref });
  return `<article class="viewer-reward-card">
${rewardImage(item, slug, "viewer-reward-img")}
<div class="viewer-reward-main">
<h3 class="viewer-reward-name">${esc(item.name)}</h3>
${item.description ? `<p class="viewer-reward-desc">${esc(item.description)}</p>` : ""}
<div class="viewer-reward-foot"><span class="viewer-cost">${viewerIcon("coins")}${formatNumber(cost)}</span>${state ? `<span class="viewer-reward-state">${esc(state)}</span>` : ""}${action}</div>
</div>
</article>`;
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

/* ── shared viewer blocks ───────────────────────────────────────────── */

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

/** The viewer's standing on this site: balance, claims, streak — side rail. */
function viewerStatusCard(ctx) {
  const { b, slug, viewer, viewerData, isMember, membershipStatus, balance, isCustomDomain, siteSections } = ctx;
  const name = esc(b.name || slug);
  const claims = viewerData?.claims || [];
  const meOn = siteSections.me !== false;
  const meHref = siteSectionHref("me", slug, isCustomDomain);
  const streak = viewerData?.streak;
  if (viewer && membershipStatus === 'unavailable') {
    return card({
      cls: "viewer-status",
      title: "Your status",
      body: `<p class="viewer-muted">Your membership could not load. Reload this page to try again.</p>`,
    });
  }
  if (!viewer || !isMember) {
    const join = viewer ? "" : joinAuthButton(ctx.r, ctx.returnTo, slug);
    return card({
      cls: "viewer-status",
      title: "Your status",
      body: `<p class="viewer-muted">${viewer ? "Join this community to keep your rewards and credits here." : "Sign in to see your credits, claims and daily quests."}</p>`,
      foot: viewer ? (meOn ? `<a class="yr-btn yr-btn--sm" href="${meHref}">Join in My Activity</a>` : "") : (join || signInLink(ctx.r, ctx.returnTo, "yr-btn yr-btn--sm", meOn ? meHref : globalViewerAccountHref(isCustomDomain))),
    });
  }
  return card({
    cls: "viewer-status",
    title: "Your Status",
    icon: "crown",
    meta: meOn ? `<a class="viewer-card-link" href="${meHref}">View profile</a>` : "",
    body: `<div class="viewer-status-stats">
<div class="viewer-status-stat" data-credit-balance="${Number(balance) || 0}"><b data-credit-balance-num>${formatNumber(balance)}</b><span>Credits</span></div>
<div class="viewer-status-stat"><b>${formatNumber(claims.length)}${viewerData?.claimsTruncated ? "+" : ""}</b><span>Claims</span></div>
<div class="viewer-status-stat"><b>${streak ? formatNumber(streak.current) : "—"}</b><span>${viewerIcon("flame")} Streak</span></div>
</div>
${ctx.b?.tagline ? `<p class="viewer-status-quote">“${esc(ctx.b.tagline)}”<span>— ${name}</span></p>` : ""}`,
  });
}

/** Shop right-rail balance card: big credit total + earn shortcut. */
function balanceCard(ctx) {
  const { b, slug, viewer, isMember, balance, isCustomDomain, siteSections } = ctx;
  const name = esc(b.name || slug);
  if (!viewer || !isMember) {
    return card({
      cls: "viewer-balance",
      title: "Your Balance",
      icon: "coins",
      body: `<p class="viewer-muted">${viewer ? `Join ${name}'s community to earn and spend credits here.` : "Sign in to see your credit balance."}</p>`,
      foot: viewer ? "" : signInLink(ctx.r, ctx.returnTo, "yr-btn yr-btn--sm", globalViewerAccountHref(isCustomDomain)),
    });
  }
  return `<section class="viewer-card viewer-balance">
<header class="viewer-card-head"><h2 class="viewer-card-title"><span class="viewer-card-ico" aria-hidden="true">${viewerIcon("coins")}</span>Your Balance</h2></header>
<div class="viewer-balance-row"><span class="viewer-balance-ico" aria-hidden="true">${viewerIcon("coins")}</span><div><b class="viewer-balance-num" data-credit-balance="${Number(balance) || 0}" data-credit-balance-num>${formatNumber(balance)}</b><p class="viewer-balance-sub">credits</p></div></div>
${siteSections.activities !== false ? `<a class="yr-btn viewer-balance-cta" href="${siteSectionHref("activities", slug, isCustomDomain)}">Earn More Credits ${viewerIcon("arrow")}</a>` : ""}
</section>`;
}

/** Progress toward the next reward the member cannot yet afford (or the cheapest one). */
function nextRewardCard(ctx) {
  const { b, slug, viewer, viewerData, data, isMember, balance, isCustomDomain, siteSections } = ctx;
  if (siteSections.shop === false) return "";
  const blocked = !!viewerData?.viewerOnSite?.blocked;
  const shopHref = siteSectionHref("shop", slug, isCustomDomain);
  const available = (viewerData?.shopItems || data.shopItems || [])
    .filter(item => item.active !== false && (item.stock == null || Number(item.stock) > 0) && !Number(item.cooldownRemaining))
    .sort((a, z) => Number(a.cost) - Number(z.cost));
  const nextReward = available.find(item => Number(item.cost) > balance) || available[0];
  const progress = nextReward ? Math.min(100, Math.max(0, Math.floor(balance / Math.max(1, Number(nextReward.cost)) * 100))) : 0;
  const body = blocked
    ? '<p class="viewer-muted">Claiming is unavailable for this membership. Contact the creator for help.</p>'
    : !isMember
      ? `<p class="viewer-muted">${viewer ? "Join this community to start collecting credits for rewards." : "Sign in to see your reward progress."}</p>`
      : nextReward
        ? `<div class="viewer-next-top"><strong>${esc(nextReward.name)}</strong><span>${formatNumber(balance)} / ${formatNumber(nextReward.cost)} Credits</span></div>${progressTrack(progress, `Progress toward ${nextReward.name}`)}<p class="viewer-muted">${balance >= Number(nextReward.cost) ? "You have enough credits for this reward." : `${formatNumber(Number(nextReward.cost) - balance)} more Credits needed.`}</p>`
        : '<p class="viewer-muted">No rewards are available right now. Check back after the creator adds more.</p>';
  return card({
    cls: "viewer-progress-card",
    title: "Your next reward",
    meta: isMember ? `<a class="viewer-card-link" href="${shopHref}">Browse rewards</a>` : "",
    body,
  });
}

/** Real leaderboard events, when the creator configured any. */
function eventsCard(ctx) {
  const { data, slug, isCustomDomain, siteSections } = ctx;
  const events = Array.isArray(data.eventBoards) ? data.eventBoards : [];
  if (!events.length || siteSections.leaderboard === false) return "";
  const boardHref = siteSectionHref("leaderboard", slug, isCustomDomain);
  return card({
    cls: "viewer-events",
    title: "Upcoming events",
    icon: "clock",
    meta: `<a class="viewer-card-link" href="${boardHref}">View all</a>`,
    body: `<ul class="viewer-event-list">${events.map((event) => `<li><a class="viewer-event" href="${boardHref}?event=${esc(event.id)}"><span class="viewer-event-ico">${viewerIcon("calendar")}</span><span>${esc(event.name)}</span>${viewerIcon("arrow")}</a></li>`).join("")}</ul>`,
  });
}

/** The creator's channel card: platform, live state, one action. */
function channelCard(ctx) {
  const { b, slug } = ctx;
  const channel = streamerChannel(ctx);
  if (!channel) return "";
  const name = esc(b.name || slug);
  return `<section class="viewer-card viewer-channel">
<a class="viewer-channel-art" href="${esc(channel.href)}" target="_blank" rel="noopener noreferrer" aria-label="Watch ${name} on ${esc(channel.label)} (opens in a new tab)">
${channel.kick ? `<span class="viewer-live viewer-live--card" data-live-badge hidden><span class="viewer-live-dot"></span>LIVE</span>` : ""}
<span class="viewer-channel-play">${viewerIcon("play")}</span>
</a>
<div class="viewer-channel-body">
<p class="viewer-channel-name">Watch ${name}</p>
<p class="viewer-channel-sub" data-stream-status-plain>${channel.kick ? "Live status on Kick" : `Streams on ${channel.label}`}</p>
<a class="yr-btn" href="${esc(channel.href)}" target="_blank" rel="noopener noreferrer">Watch on ${esc(channel.label)} ${viewerIcon("external")}</a>
</div>
</section>`;
}

/** Compact standings widget for Home: top three and a link to the board. */
function leaderboardWidget(ctx) {
  const { data, slug, isCustomDomain, siteSections } = ctx;
  if (siteSections.leaderboard === false) return "";
  const players = (Array.isArray(data.players) ? data.players : [])
    .slice().sort((a, z) => (a.rank || 0) - (z.rank || 0)).slice(0, 3);
  const boardHref = siteSectionHref("leaderboard", slug, isCustomDomain);
  const rankBy = data.rankBy === "wagered" ? "wagered" : "score";
  const value = (p) => rankBy === "score" ? `${formatNumber(p.score || 0)} pts` : formatMoney(prizeCurrency(data), p.wagered);
  return card({
    cls: "viewer-board-widget",
    title: "Leaderboard",
    icon: "trophy",
    meta: `<a class="viewer-card-link" href="${boardHref}">View all</a>`,
    body: players.length
      ? `${ctx.period ? `<p class="viewer-board-period">${esc(ctx.period)}</p>` : ""}<ol class="viewer-board-list">${players.map((player, i) => `<li class="viewer-board-row"><span class="viewer-board-rank viewer-board-rank--${i + 1}">${i + 1}</span><span class="viewer-ava">${esc(Array.from(String(player.name || "?")).slice(0, 2).join("").toUpperCase())}</span><span class="viewer-board-name">${esc(player.name)}</span><span class="viewer-board-val">${esc(value(player))}</span></li>`).join("")}</ol>`
      : `<p class="viewer-muted">No standings yet. The creator publishes leaderboard scores.</p>`,
  });
}

/** Real featured reward for Home: the cheapest claimable item. */
function featuredRewardCard(ctx) {
  const { b, slug, viewer, viewerData, data, isMember, balance, isCustomDomain, siteSections } = ctx;
  if (siteSections.shop === false) return "";
  const items = (viewerData?.shopItems || data.shopItems || [])
    .filter(item => item.active !== false)
    .sort((a, z) => Number(a.cost) - Number(z.cost));
  const item = items[0];
  const shopHref = siteSectionHref("shop", slug, isCustomDomain);
  const blocked = !!viewerData?.viewerOnSite?.blocked;
  const unavailable = viewer && ctx.membershipStatus === "unavailable";
  const signIn = signInHref(ctx);
  const meHref = siteSectionHref("me", slug, isCustomDomain);
  return card({
    cls: "viewer-featured-reward",
    title: "Featured reward",
    icon: "gift",
    meta: `<a class="viewer-card-link" href="${shopHref}">View all</a>`,
    body: item
      ? rewardCard({ item, viewer, member: isMember, balance, blocked, unavailable, signIn, membershipHref: meHref, slug })
      : `<p class="viewer-muted">No rewards yet. ${esc(b.name || slug)} will publish them here.</p>`,
  });
}

function signInHref(ctx) {
  const { r, returnTo } = ctx;
  return r.viewerKickAuthEnabled
    ? `/api/viewer/auth/kick?returnTo=${encodeURIComponent(returnTo)}`
    : (r.viewerDiscordAuthEnabled ? `/api/viewer/auth/discord?returnTo=${encodeURIComponent(returnTo)}` : "/me");
}

/** Day-grouped credit activity feed — the mockup's "Recent activity". */
function activityFeed(ctx, rows, { empty = "No credit activity yet. Redeem a code shared by the creator or use their channel-point rewards to get started." } = {}) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  if (!rows.length) return `<p class="viewer-muted">${esc(empty)}</p>`;
  const groups = [];
  for (const row of rows) {
    const day = ledgerDay(row.created_at, today, yesterday);
    const date = formatShortDate(row.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else groups.push({ day, date, rows: [row] });
  }
  return groups.map((group) => `<div class="viewer-feed-day"><p class="viewer-feed-label"><b>${esc(group.day)}</b><span>${esc(group.date)}</span></p><ul class="viewer-feed">${group.rows.map((row) => {
    const amount = Number(row.amount) || 0;
    return `<li class="viewer-feed-row"><span class="viewer-feed-icon viewer-feed-icon--${amount >= 0 ? "earn" : "spend"}">${viewerIcon(LEDGER_ICON[row.type] || "coins")}</span><span class="viewer-feed-main"><b>${esc(LEDGER_KIND[row.type] || String(row.type || "Activity"))}</b>${row.description ? `<small>${esc(row.description)}</small>` : ""}</span><small class="viewer-feed-time">${esc(formatTime(row.created_at))}</small><strong class="viewer-feed-amt${amount >= 0 ? " is-pos" : ""}">${viewerIcon("coins")}${amount >= 0 ? "+" : "−"}${formatNumber(Math.abs(amount))}</strong><span class="viewer-feed-arrow" aria-hidden="true">${viewerIcon("chevron")}</span></li>`;
  }).join("")}</ul></div>`).join("");
}

/** One canonical viewer Claim: what it was, when it was submitted, and its audited outcome. */
function claimRow(row) {
  const status = String(row.status || "submitted");
  const label = String(row.statusLabel || "Needs fulfillment");
  const tagCls = status === "submitted" ? "yr-tag yr-tag--pending" : status === "completed" ? "yr-tag yr-tag--done" : "yr-tag";
  const terminalAt = status === "completed" ? row.completedAt : status === "cancelled" ? row.cancelledAt : null;
  const terminalLabel = status === "completed" ? "Completed" : status === "cancelled" ? "Cancelled" : "";
  return `<li class="yr-ord">
<div class="yr-ord-main">
<p class="yr-ord-n">${esc(row.reward?.name || "Reward claim")}</p>
<p class="yr-ord-p">${formatNumber(row.reward?.cost)} credits · Submitted ${esc(formatDate(row.submittedAt))}${terminalAt ? ` · ${terminalLabel} ${esc(formatDate(terminalAt))}` : ""}</p>
</div>
<span class="${tagCls}">${esc(label)}</span>
</li>`;
}

/** The rail shell for one community page: rail + body open, topbar, footer close. */
function communityChrome(ctx, mainInner) {
  const { b, data, slug, viewer, isMember, balance, siteSections, isCustomDomain, homeUrl, logoUrl, section, socialLinks, r } = ctx;
  const name = b.name || slug;
  const channel = streamerChannel(ctx);
  const channels = socialLinks.map((link) => ({ label: link.label, href: link.href, icon: "external" }));
  if (siteSections.games !== false) {
    channels.push({ label: "Games", href: `${homeUrl}${siteSectionHref("games", slug, isCustomDomain)}`, icon: "games" });
  }
  const accountBase = globalViewerAccountHref(isCustomDomain);
  const searchHref = siteSections.leaderboard !== false
    ? `${homeUrl}${siteSectionHref("leaderboard", slug, isCustomDomain)}`
    : siteSections.shop !== false ? `${homeUrl}${siteSectionHref("shop", slug, isCustomDomain)}` : "";
  const chrome = viewerCommunityChrome({
    name,
    mark: creatorMark(logoUrl, "viewer-mark-img", 40, ""),
    tagline: b.tagline || "",
    homeHref: siteSectionHref("home", slug, isCustomDomain),
    accountHref: accountBase,
    searchHref,
    bellHref: `${accountBase}/notifications`,
    links: communityNavKeys(siteSections).map((key) => ({
      label: SECTION_LABELS[key],
      href: `${homeUrl}${siteSectionHref(key, slug, isCustomDomain)}`,
      active: key === section,
      icon: SECTION_ICONS[key],
    })),
    channels,
    watchHref: channel ? channel.href : "",
    watchLabel: channel ? `Watch on ${channel.label}` : "",
    kickChannel: channel?.kick || "",
    signedIn: !!viewer,
    viewerName: viewer ? viewerName(viewer) : "",
    viewerAvatarUrl: viewer?.avatar_url || "",
    balance,
    member: isMember,
    signInHtml: signInLink(r, ctx.returnTo, "viewer-signin", globalViewerAccountHref(isCustomDomain)),
    dark: section === "leaderboard" || section === "shop" || section === "me",
  });
  return `<div class="viewer-layout" data-viewer-shell="community">
${chrome.rail}
<div class="viewer-body">
${chrome.topbar}
<main class="viewer-main" id="main-content">
${mainInner}
</main>
<div class="viewer-site-footer">${ctx.footer}</div>
</div>
</div>`;
}

/* ── page renderer ────────────────────────────────────────────────────── */

export async function renderSite({ r, section, viewer, viewerData, opts }) {
  const data = r.data || {};
  const b = data.brand || {};
  const br = data.branding || {};
  const siteSections = data.siteSections || { home: true, activities: true, leaderboard: true, shop: true, games: false, me: true };
  const nonce = opts.nonce;
  const slug = opts.slug || "";
  const isCustomDomain = !!opts.isCustomDomain;
  const homeUrl = String(opts.homeUrl || "https://yourrank.site").replace(/\/$/, "");
  const logoUrl = opts.logoUrl || null;
  const watermark = data.sections?.poweredBy !== undefined ? !!data.sections?.poweredBy : r.plan === "free";
  // Only the restricted legacy surface retains its old chrome. All supported
  // viewer destinations share one navigation and material owner.
  const viewerShell = section !== "games";

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
  const sectionUrl = `${homeUrl}${opts.canonicalPath || siteSectionHref(section || "home", slug, isCustomDomain)}`;
  const canonicalUrl = esc(sectionUrl);
  const returnTo = sectionUrl;

  const rawTitleBase = String(b.name || slug || "YourRank");
  const titleBase = esc(rawTitleBase);
  const sectionTitle = esc(SECTION_LABELS[section] || section || "");
  const title = opts.pageTitle || (section === "home"
    ? `${titleBase} — ${esc(b.tagline || "Leaderboard & Rewards")}`
    : `${sectionTitle} · ${titleBase}`);
  const rawDesc = opts.pageDescription || (section === "home"
    ? `${rawTitleBase}'s public site — ${b.tagline || "compete on the leaderboard, earn free credits and claim rewards."}`
    : `${SECTION_LABELS[section] || section} for ${rawTitleBase}'s public site.`);
  const desc = esc(rawDesc);
  const ogImageUrl = logoUrl ? esc(logoUrl) : `${homeUrl}/og.png`;

  const ctx = {
    r, data, b, br, section, siteSections, slug, isCustomDomain, homeUrl, logoUrl,
    viewer, viewerData, viewerOnSite, membershipStatus, isMember, balance, casino, pool, period, ctaHref, hasCta, socialLinks,
    returnTo, nonce, watermark, isDemo: !!opts.isDemo,
    viewerAuthError: typeof opts.viewerAuthError === "string" ? opts.viewerAuthError : "",
    footer: "",
  };

  const mainInner = section == null && typeof opts.contentHtml === "string" ? opts.contentHtml : (section === "home" ? homeMain(ctx)
    : section === "activities" ? activitiesMain(ctx)
    : section === "leaderboard" ? boardMain(ctx)
    : section === "shop" ? shopMain(ctx)
    : section === "games" ? gamesMain(ctx)
    : section === "me" ? meMain(ctx)
    : `<div class="yr-empty">Section not found</div>`);

  const footer = siteFooter({ data, b, siteSections, slug, isCustomDomain, homeUrl, watermark, viewer, casino, ctaHref, hasCta, kickUrl: kickUrl ? safeUrl(kickUrl) : null });

  // B-01: Dynamic font URL based on board's active font.
  const font = resolveFont(data);
  const fontsHref = buildFontsHref(font);
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
<link href="${fontsHref}" rel="stylesheet" media="print" data-async />
<script nonce="${nonce}">document.querySelector('link[data-async]').onload=function(){this.media='all'};</script>
<noscript><link href="${fontsHref}" rel="stylesheet" /></noscript>
<link rel="stylesheet" href="/assets/site-shell.css" />
<link rel="stylesheet" href="/assets/${viewerShell ? "viewer-shell" : "devin-system"}.css" />
${section === "games" ? gamesIslandHead() : ""}
<style nonce="${nonce}" data-theme-tokens>.yr-site{--yr-accent:${accent};--yr-accent-ink:${accentInkValue}${font ? `;--yr-display-font:"${font}", "Fira Sans", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif` : ""}}${section === "games" ? `#gx-root{--gx-accent:${accent};--gx-accent-ink:${accentInkValue}}` : ""}</style>
${opts.csrfToken ? `<meta name="csrf-token" content="${esc(opts.csrfToken)}" />` : ""}
</head>`;

  const template = data.theme?.template || data.brand?.template || "cyber_arcade";

  let bodyInner;
  if (viewerShell) {
    ctx.footer = footer;
    bodyInner = communityChrome(ctx, mainInner);
  } else {
    bodyInner = `${topbar({ r, b, viewer, balance, returnTo, section, siteSections, homeUrl, slug, isCustomDomain, logoUrl, isMember })}
<main class="yr-main" id="main-content">
${mainInner}
${footer}
</main>
${drawer({ b, slug, section, siteSections, homeUrl, isCustomDomain, logoUrl, viewer, balance, isMember })}`;
  }

  const body = `<body class="yr-site${viewerShell ? " viewer-shell" : ""}"${viewerShell ? ' data-viewer-shell="community"' : ` data-template="${esc(template)}"`} data-section="${esc(section)}"${data.eventId ? ` data-event-id="${esc(data.eventId)}"` : ""} data-slug="${esc(slug)}" data-custom-domain="${isCustomDomain ? "true" : "false"}" data-currency="${esc(prizeCurrency(data))}" data-rank-by="${data.rankBy === "wagered" ? "wagered" : "score"}">
${viewerShell ? VIEWER_DESIGN_CONTRACT : ""}
<a class="yr-sr" href="#main-content">Skip to content</a>
${bodyInner}
${feedbackModal({ slug })}
<script src="/assets/cookie-consent.js" nonce="${nonce}" defer></script>
<script src="/assets/${viewerShell ? 'viewer-app' : 'site-shell'}.js" nonce="${nonce}" defer></script>
</body></html>`;

  return head + body;
}

function feedbackModal({ slug }) {
  return `<dialog id="yr-feedback" class="yr-modal" aria-labelledby="yr-feedback-title">
<form class="yr-modal-in" method="dialog">
<h2 id="yr-feedback-title">Send feedback</h2>
<p class="yr-note">Send a suggestion to this site's owner. There is no personal reply here. If you need a response, use the creator's contact channels.</p>
<textarea name="message" rows="5" minlength="10" maxlength="2000" placeholder="What's working? What's not?" required aria-label="Your feedback"></textarea>
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
 * used to hold, so the rail stays a narrow-width disclosure of the top bar.
 */
function siteFooter({ data, b, siteSections, slug, isCustomDomain, homeUrl, watermark, viewer, casino, ctaHref, hasCta, kickUrl }) {
  const enabled = sectionList(siteSections);
  const legalHref = (page) => `${homeUrl}${siteSectionHref(page, slug, isCustomDomain)}`;
  const legalLinks = renderLegalSidebar(data, legalHref).split("\n").filter(Boolean).join("");
  const secondary = [
    kickUrl && kickUrl !== "#" ? `<a href="${kickUrl}" target="_blank" rel="noopener noreferrer">Watch on Kick<span class="yr-sr"> (opens in a new tab)</span></a>` : "",
    hasCta && casino ? `<a href="${ctaHref}" target="_blank" rel="noopener noreferrer">Join ${esc(casino)}<span class="yr-sr"> (opens in a new tab)</span></a>` : "",
    viewer ? `<a href="${globalViewerAccountHref(isCustomDomain)}">My communities</a>` : "",
  ].filter(Boolean).join("");
  // The section map is the fallback for a browser that never ran the shell
  // script; it is always server-rendered and the stylesheet hides it only once
  // the script reports ready, because from then on the rail owns navigation.
  return `<footer class="yr-foot">
<p class="yr-fine">${CREDITS_DISCLAIMER}</p>
<div class="yr-foot-bar">
<p class="yr-foot-c">&copy; ${new Date().getFullYear()} ${esc(b.name || slug)}.${watermark ? ` Powered by <a href="${esc(homeUrl || "/")}" target="_blank" rel="noopener">YourRank</a>.` : ""}</p>
<div class="yr-foot-links">${legalLinks}<button type="button" data-feedback-open>Send feedback</button></div>
</div>
<nav class="yr-foot-links yr-foot-nav" aria-label="All sections">${enabled.map((s) => `<a href="${homeUrl}${siteSectionHref(s, slug, isCustomDomain)}">${esc(SECTION_LABELS[s])}</a>`).join("")}${secondary}</nav>
</footer>`;
}

/* ── Home ─────────────────────────────────────────────────────────────── */

/**
 * Home is the creator's landing page: who this is, what the board is doing,
 * what the signed-in viewer has here, and where else to find the creator.
 */
function homeMain(ctx) {
  const { b, slug, viewer, viewerData, siteSections, isCustomDomain, isMember } = ctx;
  const name = b.name || slug;
  const meHref = siteSectionHref("me", slug, isCustomDomain);
  const channel = streamerChannel(ctx);
  const recent = (viewerData?.ledger || []).slice(0, 8);

  // Hero action: the real path for this viewer — channel link, join, or sign-in.
  const joinCta = !viewer
    ? joinAuthButton(ctx.r, ctx.returnTo, slug) || signInLink(ctx.r, ctx.returnTo, "yr-btn yr-btn--dark", meHref)
    : !isMember && siteSections.me !== false
      ? `<button class="yr-btn yr-btn--dark" type="button" data-membership-join data-site-slug="${esc(slug)}">Join community</button><p id="yr-membership-join-status" class="viewer-inline-status viewer-inline-status--hero" role="status" aria-live="polite" tabindex="-1"></p>`
      : "";
  const heroActions = [
    channel ? `<a class="yr-btn" href="${esc(channel.href)}" target="_blank" rel="noopener noreferrer">${viewerIcon("play")}Watch Live</a>` : "",
    joinCta,
  ].filter(Boolean).join("");

  const statusChips = [
    ctx.period ? `<span class="viewer-chip">${viewerIcon("calendar")}${esc(ctx.period)} leaderboard</span>` : "",
    siteSections.me !== false ? `<span class="viewer-chip">${viewerIcon("coins")}Credits &amp; rewards</span>` : "",
    isMember ? `<span class="viewer-chip viewer-chip--member">${viewerIcon("check")}Community member</span>` : "",
  ].filter(Boolean).join("");

  const heroMeta = [channel?.kick ? `@${channel.kick}` : "", b.tagline || "Creator community on YourRank"].filter(Boolean).join(" · ");

  const hero = `<section class="viewer-hero">
<div class="viewer-hero-inner">
<span class="viewer-hero-mark">${creatorMark(ctx.logoUrl, "viewer-hero-logo", 64, `<span class="viewer-hero-mono">${esc(Array.from(String(name))[0] || "Y").toUpperCase()}</span>`)}</span>
<div class="viewer-hero-copy">
<h1 class="viewer-hero-name" data-preview-field="f_name">${esc(name)}${channel?.kick ? ` <span class="viewer-live viewer-live--hero" data-live-badge hidden><span class="viewer-live-dot"></span>LIVE</span>` : ""}</h1>
<p class="viewer-hero-tag" data-preview-field="f_tagline">${esc(heroMeta)}</p>
${heroActions ? `<div class="viewer-hero-actions">${heroActions}</div>` : ""}
</div>
</div>
</section>`;

  const questsTeaser = siteSections.activities !== false ? `<section class="viewer-card viewer-quest-card">
<div class="viewer-quest-art" aria-hidden="true">${viewerIcon("crown")}</div>
<div class="viewer-quest-main">
<span class="viewer-quest-tag">Activities ${viewerIcon("clock")}Today</span>
<h2 class="viewer-quest-title">Daily quests</h2>
<p class="viewer-quest-desc">Complete today's quests to earn free credits and grow your streak in ${esc(name)}'s community.</p>
</div>
<div class="viewer-quest-side"><span class="viewer-quest-credits">${viewerIcon("coins")}Free credits</span><a class="yr-btn" href="${siteSectionHref("activities", slug, isCustomDomain)}">Continue</a></div>
</section>` : "";

  const events = eventsCard(ctx);

  const liveCard = channelCard(ctx);
  const communityCard = `<section class="viewer-card viewer-community-card">
<header class="viewer-card-head"><h2 class="viewer-card-title">Community</h2></header>
<h3 class="viewer-community-title">${b.tagline ? esc(b.tagline) : `Welcome to ${esc(name)}'s community`}</h3>
<p class="viewer-community-sub">${isMember ? "You're a member — climb the leaderboard and claim rewards." : "Watch, earn credits, and climb the leaderboard."}</p>
<div class="viewer-hero-tags">${statusChips}</div>
${channel ? `<footer class="viewer-card-foot"><a class="yr-btn" href="${esc(channel.href)}" target="_blank" rel="noopener noreferrer">Watch on ${esc(channel.label)} ${viewerIcon("external")}</a></footer>` : ""}
</section>`;

  const activityCard = card({
    cls: "viewer-activity-card",
    title: "Recent activity",
    icon: "clock",
    meta: isMember ? `<a class="viewer-card-link" href="${meHref}">View all</a>` : "",
    body: isMember
      ? activityFeed(ctx, recent, { empty: "No credit activity yet. Redeem a code shared by the creator or use their channel-point rewards to get started." })
      : `<p class="viewer-muted">${viewer ? "Join the community to keep your activity here." : "Sign in to see your credit activity in this community."}</p>`,
  });

  return `${hero}
<div class="viewer-duo viewer-duo--hero">
${liveCard || communityCard}
${viewerStatusCard(ctx)}
</div>
${questsTeaser || events ? `<div class="viewer-duo">${questsTeaser}${events}</div>` : ""}
<div class="viewer-trio">
${leaderboardWidget(ctx)}
${featuredRewardCard(ctx)}
${activityCard}
</div>`;
}

/* ── Activities (daily quests) ─────────────────────────────────────────── */

/**
 * Activities renders the daily-quest frame; the quests themselves load through
 * the canonical /api/quests/daily contract (which also creates today's rows),
 * so nothing here fabricates a quest the API does not own.
 */
function activitiesMain(ctx) {
  const { b, slug, viewer, isMember, balance } = ctx;
  const name = esc(b.name || slug);
  const channel = streamerChannel(ctx);
  return `<header class="viewer-page-head">
<div class="viewer-page-copy"><h1 class="viewer-h1">Activities</h1><p class="viewer-sub">Complete daily quests to earn free credits in ${name}.</p></div>
<div class="viewer-head-chips">
<span class="viewer-chip" data-quest-active hidden>${viewerIcon("activities")}<b data-quest-active-num>0</b> active</span>
<span class="viewer-chip" data-quest-done hidden>${viewerIcon("check")}<b data-quest-done-num>0</b> completed</span>
<span class="viewer-chip" data-quest-streak hidden>${viewerIcon("flame")}<b data-quest-streak-num>0</b>-day streak</span>
${channel ? `<a class="yr-btn yr-btn--sm" href="${esc(channel.href)}" target="_blank" rel="noopener noreferrer">${viewerIcon("play")}Watch Live</a>` : ""}
</div>
</header>
<section class="viewer-card viewer-quests" data-quests-root data-site-slug="${esc(slug)}" data-signed-in="${viewer ? "true" : "false"}" data-member="${isMember ? "true" : "false"}">
<div class="viewer-quests-loading" data-quests-loading><span class="viewer-spinner" aria-hidden="true"></span><p>Loading today's quests…</p></div>
</section>
<noscript><p class="yr-note">Activities need JavaScript: quests load from your account. <a href="${esc(globalViewerAccountHref(ctx.isCustomDomain))}">My communities</a></p></noscript>`;
}

/* ── Leaderboard ───────────────────────────────────────────────────────── */

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
  const showPrizes = data.sections?.payouts !== false && !hidePrizes && (hasConfiguredPrizePool(pool) || players.some((player) => Number(player.prize) > 0));
  const playerHref = (name) => isCustomDomain ? `/player/${encodeURIComponent(name)}` : `/${encodeURIComponent(slug)}/player/${encodeURIComponent(name)}`;

  const stateLabel = ended ? "Ended" : scheduled ? "Not started" : "Live";
  const stateClass = ended ? "is-ended" : scheduled ? "is-soon" : "is-live";
  const metaItems = [
    `<span class="viewer-state ${stateClass}">${stateLabel}</span>`,
    `<span class="viewer-chip">${esc(period)} leaderboard</span>`,
    !ended && data.sections?.countdown !== false ? timingHtml(cd, { scheduled }) : "",
    data.sections?.payouts !== false && hasConfiguredPrizePool(pool) && !hidePrizes ? `<span class="viewer-chip">${esc(pool)} ${poolLabel.toLowerCase()}</span>` : "",
  ].filter(Boolean).join("");

  const events = Array.isArray(data.eventBoards) ? data.eventBoards : [];
  const switcher = events.length ? `<form class="viewer-board-switcher" action="${siteSectionHref('leaderboard', slug, isCustomDomain)}" method="get"><label for="viewer-event">Leaderboard</label><select id="viewer-event" name="event"><option value="">Main leaderboard</option>${events.map(event => `<option value="${esc(event.id)}"${event.id === data.eventId ? ' selected' : ''}>${esc(event.name)}</option>`).join('')}</select><button class="yr-btn yr-btn--sm" type="submit">View</button></form>` : '';

  const introHtml = `<header class="viewer-page-head">
<div class="viewer-page-copy"><h1 class="viewer-h1">${data.eventName ? esc(data.eventName) : ended ? "Final leaderboard" : scheduled ? "Leaderboard opens soon" : "Leaderboard"}</h1><p class="viewer-sub">${scheduled ? `Pre-start standings are visible; scores update once the round begins. Ranked by ${wagerLabel.toLowerCase()}, and tied players share a rank.` : `Ranked by ${wagerLabel.toLowerCase()}. Tied players share a rank.`}</p></div>
<div class="viewer-head-chips">${metaItems}${switcher}</div>
</header>`;

  // The podium is the canonical top-three presentation — only when the board
  // really has three distinct leaders. Ties keep equal rows instead.
  const podium = players.length >= 3 && players.every((p, i) =>
    i < 3 ? Number(p.rank) === i + 1 : Number(p.rank) > 3);

  const podiumHtml = podium ? `<div class="viewer-podium" data-podium="3">
${[players[1], players[0], players[2]].map((p) => {
    const rank = Number(p.rank);
    return `<div class="viewer-podium-card viewer-podium-card--${rank}" data-podium-slot="${rank}">
<span class="viewer-podium-crown" aria-hidden="true">${viewerIcon("crown")}</span>
<span class="viewer-podium-ava">${esc(Array.from(String(p.name || "?")).slice(0, 2).join("").toUpperCase())}</span>
<b class="viewer-podium-name">${esc(p.name)}</b>
<span class="viewer-podium-val">${esc(rankValue(p))}</span>
<span class="viewer-podium-rank">#${rank}</span>
</div>`;
  }).join("")}
</div>` : "";

  const rows = players.map((p, i) => {
    const rank = Number(p.rank) || i + 1;
    const prize = showPrizes && p.prize ? esc(formatMoney(currency, p.prize)) : "";
    const nameTag = data.eventId ? 'span' : 'a';
    return `<li class="yr-srow${rank === 1 ? " yr-srow--first" : rank <= 3 ? " yr-srow--top" : ""}" data-player-name="${esc(String(p.name || "").toLowerCase())}" data-position="${rank}">
<span class="yr-srow-rank"><span class="yr-sr">Rank </span>${rank}</span>
<${nameTag} class="yr-srow-name"${data.eventId ? '' : ` href="${playerHref(p.name)}"`}><span class="yr-player-mark" aria-hidden="true">${esc(Array.from(String(p.name || "?")).slice(0, 2).join("").toUpperCase())}</span><span class="yr-player-name">${esc(p.name)}</span></${nameTag}>
<span class="yr-srow-val"><span class="yr-sr">${wagerLabel}: </span>${esc(rankValue(p))}</span>
${prize ? `<span class="yr-srow-prize"><span class="yr-sr">${prizeLabel}: </span>${prize}</span>` : ""}
</li>`;
  }).join("");

  const columns = `<div class="yr-stand-head" aria-hidden="true" data-hide-prizes="${showPrizes ? "false" : "true"}"><span>#</span><span>Player</span><span class="yr-r">${wagerLabel}</span>${showPrizes ? `<span class="yr-r">${prizeLabel}</span>` : ""}</div>`;

  const standings = players.length
    ? `${columns}
<ol class="yr-stand" data-rows aria-label="Standings for ${esc(b.name || slug)}" data-value-label="${wagerLabel}" data-prize-label="${prizeLabel}" data-hide-prizes="${showPrizes ? "false" : "true"}">${rows}</ol>
<p class="yr-nomatch" id="yr-no-match" hidden>No players match that search.</p>
<p class="yr-search-status" id="yr-search-status" role="status" aria-live="polite"></p>
${playerCount > players.length ? `<div class="yr-pagination"><button class="yr-btn yr-btn--sm" type="button" data-load-more>Load more players</button><p class="yr-page-status" data-load-more-status role="status" aria-live="polite" tabindex="-1"></p></div>` : ""}`
    : emptyState(ICONS.trophy, "No players yet", scheduled ? "Standings fill in once the round starts. Ask the creator how to participate." : `Ask ${esc(b.name || slug)} how to earn points on this leaderboard. Your first published score puts you on the board. Leaderboard points are separate from Credits.`);

  const notes = [
    data.resetNote ? `<p class="yr-note">${esc(data.resetNote)}</p>` : "",
    data.sections?.payouts !== false && hasConfiguredPrizePool(pool) && !hidePrizes ? `<p class="yr-note yr-note--w">Paid in cash by the sponsor to the top ${wagerLabel.toLowerCase()} players. Separate from credits — credits can't be won here and cash can't be bought with credits.</p>` : "",
  ].filter(Boolean).join("");

  const standingsCard = card({
    cls: "viewer-standings",
    attrs: "data-player-board",
    title: "Standings",
    meta: `<span data-player-count-badge>${formatNumber(playerCount)} ${playerCount === 1 ? "player" : "players"}</span>`,
    body: `${players.length ? `<div class="yr-search-row"><label class="yr-sr" for="yr-search">Search players</label><input class="yr-search" id="yr-search" type="search" placeholder="Search players by name" autocomplete="off" enterkeyhint="search" /></div>` : ""}${standings}`,
    foot: notes,
  });

  const timingCard = !ended && cd.kind !== "invalid" && data.sections?.countdown !== false
    ? `<section class="viewer-card viewer-card--dark viewer-countdown"><header class="viewer-card-head"><h2 class="viewer-card-title">${scheduled ? "Starts in" : "Season ends in"}</h2></header>${cd.kind === "calendar" ? `<p class="viewer-countdown-num"><time datetime="${esc(cd.iso)}">${esc(cd.text)}</time></p>` : `<div class="viewer-countdown-boxes" data-countdown-mode="relative" data-countdown-complete="${scheduled ? "Started" : "Ended"}" data-ends-at="${esc(cd.iso)}"><span class="viewer-cd-box"><b data-cd-days>00</b><i>Days</i></span><span class="viewer-cd-box"><b data-cd-hours>00</b><i>Hours</i></span><span class="viewer-cd-box"><b data-cd-minutes>00</b><i>Min</i></span><span class="viewer-cd-box"><b data-cd-seconds>00</b><i>Sec</i></span><span class="yr-sr" data-ends-at="${esc(cd.iso)}">${esc(cd.text)}</span></div>`}<p class="viewer-countdown-sub">Climb the board before time runs out.</p></section>`
    : "";

  return `${introHtml}
${data.eventUnavailable ? '<p role="status" class="yr-note">This event is no longer available. Showing the main leaderboard.</p>' : ""}
<div class="viewer-grid">
<div class="viewer-col">
${podiumHtml}
${standingsCard}
</div>
<aside class="viewer-side">
${timingCard}
${viewerStatusCard(ctx)}
${nextRewardCard(ctx)}
</aside>
</div>`;
}

/* ── Rewards ──────────────────────────────────────────────────────────── */

function shopMain(ctx) {
  const { b, data, viewer, viewerData, viewerOnSite, isMember, balance, slug, homeUrl, isCustomDomain, siteSections } = ctx;
  const items = (viewerData?.shopItems || data.shopItems || []).filter((i) => i.active !== false).slice().sort((x, z) => Number(x.cost) - Number(z.cost));
  const blocked = !!viewerOnSite?.blocked;
  const signIn = signInHref(ctx);
  const creditsHref = `${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}`;
  const unavailable = viewer && ctx.membershipStatus === 'unavailable';
  const name = esc(b.name || slug);

  const head = `<header class="viewer-page-head">
<div class="viewer-page-copy"><h1 class="viewer-h1">Rewards</h1><p class="viewer-sub">Rewards from ${name}, claimed with community Credits.</p></div>
<div class="viewer-head-chips">
${viewer && isMember ? `<span class="viewer-chip viewer-chip--credits" data-credit-balance="${Number(balance) || 0}">${viewerIcon("coins")}<b data-credit-balance-num>${formatNumber(balance)}</b> Credits</span>` : ""}
${items.length ? `<span class="viewer-search viewer-search--rewards"><label class="yr-sr" for="yr-reward-search">Search rewards</label>${viewerIcon("search")}<input id="yr-reward-search" class="viewer-search-input" type="search" placeholder="Search rewards" autocomplete="off" data-reward-search /></span>` : ""}
</div>
</header>
<section class="viewer-shop-hero"><div><h2 class="viewer-shop-hero-title">Exclusive rewards for real supporters</h2><p class="viewer-shop-hero-sub">Earn free Credits by watching ${name} and completing quests — then claim what you want.</p></div>${viewer && isMember ? `<a class="yr-btn yr-btn--light" href="${siteSectionHref("activities", slug, isCustomDomain)}">Earn more</a>` : ""}</section>${!viewer || !isMember ? `<p class="yr-note">${unavailable ? 'Your membership could not load. Reload this page before claiming a reward.' : viewer ? 'Join this community before claiming a reward.' : 'Sign in to use your community credits.'}</p>` : ""}`;

  const blockedNote = viewer && blocked
    ? `<p class="yr-note yr-note--w">Claiming is currently unavailable for this membership.</p>`
    : "";

  const featured = items.slice(0, 4);
  const rest = items.slice(4);
  const featuredHtml = featured.length
    ? `<h2 class="viewer-section-title">Featured Rewards${rest.length ? `<a class="viewer-card-link" href="#yr-all-rewards">See All ${viewerIcon("arrow")}</a>` : ""}</h2><div class="viewer-reward-grid" data-reward-featured>${featured.map((item) => rewardCard({ item, viewer, member: isMember, balance, blocked, unavailable, signIn, membershipHref: creditsHref, slug })).join("")}</div>`
    : "";
  const restHtml = rest.length
    ? card({
      cls: "viewer-rewards-list",
      attrs: ' id="yr-all-rewards"',
      title: featured.length ? "All rewards" : "Rewards",
      body: `<ul class="yr-rwds" role="list">${rest.map((item) => rewardRow({ item, viewer, member: isMember, balance, blocked, unavailable, signIn, membershipHref: creditsHref, slug })).join("")}</ul><p class="yr-nomatch" id="yr-reward-nomatch" hidden>No rewards match that search.</p>`,
    })
    : featured.length ? `<p class="yr-nomatch" id="yr-reward-nomatch" hidden>No rewards match that search.</p>` : "";
  const emptyHtml = items.length
    ? ""
    : card({ cls: "viewer-rewards-list", body: emptyState(ICONS.gift, "No rewards yet", `Rewards will appear here when ${name} adds them.`) });

  const canOrder = viewer && isMember && !blocked && items.some((item) => (item.stock === null || item.stock === undefined || Number(item.stock) > 0) && Number(item.cost || 0) <= balance);

  const earnCard = card({
    cls: "viewer-earn",
    title: "How to earn credits",
    body: `<ul class="viewer-earn-list">
<li>${viewerIcon("activities")}<span><b>Daily quests</b><small>Complete today's quests on the Activities page.</small></span></li>
<li>${viewerIcon("code")}<span><b>Community codes</b><small>Redeem codes the creator shares in My Activity.</small></span></li>
<li>${viewerIcon("coins")}<span><b>Channel-point rewards</b><small>Earn through ${name}'s channel rewards while watching.</small></span></li>
</ul>`,
    foot: siteSections.activities !== false ? `<a class="yr-btn yr-btn--sm" href="${siteSectionHref("activities", slug, isCustomDomain)}">View today's quests</a>` : "",
  });

  const sectionList = [featuredHtml, restHtml, emptyHtml].filter(Boolean).join("");
  return `${head}
${blockedNote}
<p class="yr-redeem-status" id="yr-redeem-status" role="status" aria-live="polite" tabindex="-1"></p>
<div class="viewer-grid">
<div class="viewer-col">
${sectionList}
<p class="yr-fine">Credits cannot be bought, transferred between communities, or cashed out. The creator fulfills each reward.</p>
</div>
<aside class="viewer-side">
${balanceCard(ctx)}
${nextRewardCard(ctx)}
${earnCard}
${siteSections.activities !== false ? `<section class="viewer-card viewer-card--dark viewer-promo"><h2 class="viewer-promo-title">More rewards coming soon</h2><p class="viewer-promo-sub">Quests reset every day — new ways to earn land daily.</p><a class="yr-btn yr-btn--light" href="${siteSectionHref("activities", slug, isCustomDomain)}">Today's quests</a></section>` : ""}
</aside>
</div>
${canOrder ? orderConfirmDialog() : ""}`;
}

/* ── Games (restricted legacy surface) ──────────────────────────────── */

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
    signInUrl: `/api/viewer/auth/kick?returnTo=${encodeURIComponent(returnTo)}`,
    header: false,
  });

  if (!viewer && !ctx.isDemo) {
    return `${heroHtml}
<div class="yr-gate"><h2>Sign in to play originals</h2><p>Rounds are tied to your account and settled on the server. They cost credits only — no money in, no money out.</p>${signInButton(r, returnTo)}</div>`;
  }

  return `${heroHtml}
<section class="yr-sec-head"><h2 class="yr-sec-title">Available games</h2><span class="yr-panel-meta">Server decided · provably fair</span></section>
${mount}`;
}

/* ── My Activity ───────────────────────────────────────────────────────── */

function meMain(ctx) {
  const { r, b, slug, viewer, viewerData, membershipStatus, balance, returnTo, isCustomDomain, siteSections, viewerAuthError } = ctx;
  const creator = esc(b.name || slug);
  const accountHref = globalViewerAccountHref(isCustomDomain);
  const shopHref = siteSectionHref("shop", slug, isCustomDomain);
  const authMessages = {
    access_denied: "Sign-in was cancelled. Try again when you're ready.",
    missing_oauth_params: "The sign-in provider did not return the information needed. Try again.",
    oauth_state_expired: "That sign-in took too long. Try again.",
    kick_auth_failed: "We couldn't complete Kick sign-in. Try again.",
    discord_auth_failed: "We couldn't complete Discord sign-in. Try again.",
    join_unavailable: "This community isn't available to join right now.",
    join_failed: "We couldn't join this community. Try again.",
    rate_limited: "Too many sign-in attempts. Wait a moment, then try again.",
  };
  const authError = viewerAuthError ? `<p class="yr-note yr-note--w" role="alert">${esc(authMessages[viewerAuthError] || "We couldn't complete sign-in. Try again.")}</p>` : "";
  const member = membershipStatus === "member" && !!viewerData?.viewerOnSite;
  const heading = `<header class="viewer-page-head">
<div class="viewer-page-copy"><h1 class="viewer-h1">My Activity</h1><p class="viewer-sub">${viewer ? `Signed in as <b>${esc(viewerName(viewer))}</b> — your credits and history in ${creator}.` : `Your claims and credit history in ${creator}.`}</p></div>
<div class="viewer-head-chips"><span class="viewer-chip">${viewerIcon("calendar")}All Time</span></div>
</header>`;

  if (!viewer) {
    const join = joinAuthButton(r, returnTo, slug);
    return `${heading}${authError}<section class="viewer-card viewer-gate"><div class="viewer-gate-copy"><h2>Your place in ${creator}'s community</h2><p>Sign in to join, follow your reward claims and see your community activity. Your credits stay with this community.</p></div><div class="viewer-gate-actions">${join || '<p role="status">Sign-in is not available for this community right now.</p>'}<a class="viewer-text-link" href="${accountHref}">Back to my communities</a></div></section>`;
  }
  if (membershipStatus === "absent") {
    return `${heading}${authError}<section class="viewer-card viewer-gate"><div class="viewer-gate-copy"><h2>You haven't joined this community yet.</h2><p>Join to keep your rewards, free credits and claims together here.</p></div><div class="viewer-gate-actions"><button class="yr-btn" id="yr-membership-join" type="button" data-membership-join data-site-slug="${esc(slug)}">Join community</button></div><p id="yr-membership-join-status" role="status" aria-live="polite" tabindex="-1"></p></section>${codeDropClaimSection({slug,creator,joinsMembership:true})}`;
  }
  if (!member) {
    return `${heading}${authError}<section class="viewer-card viewer-gate"><div class="viewer-gate-copy"><h2>Your membership couldn't load</h2><p>Your account is signed in, but this community's information is unavailable. Try reloading or return to your communities.</p></div><div class="viewer-gate-actions"><a class="yr-btn" href="${siteSectionHref("me",slug,isCustomDomain)}">Reload membership</a><a class="viewer-text-link" href="${accountHref}">All communities</a></div></section>`;
  }

  const ledger = viewerData.ledger || [];
  const participation = viewerData.participation || [];
  const claims = viewerData.claims || [];
  const blocked = viewerData.viewerOnSite.blocked;
  const streak = viewerData.streak;
  const totalEarned = Number(viewerData.viewerOnSite.total_earned || 0);
  const totalSpent = Number(viewerData.viewerOnSite.total_spent || 0);

  const stats = `<div class="viewer-stat-grid">
<div class="viewer-stat"><span class="viewer-stat-icon viewer-stat-icon--earn">${viewerIcon("coins")}</span><div><p class="viewer-stat-num">${formatNumber(totalEarned)}</p><p class="viewer-stat-label">Total credits earned</p></div></div>
<div class="viewer-stat"><span class="viewer-stat-icon viewer-stat-icon--done">${viewerIcon("check")}</span><div><p class="viewer-stat-num">${formatNumber(participation.length)}${viewerData.participationTruncated ? "+" : ""}</p><p class="viewer-stat-label">Activities completed</p></div></div>
<div class="viewer-stat"><span class="viewer-stat-icon viewer-stat-icon--streak">${viewerIcon("flame")}</span><div><p class="viewer-stat-num">${streak ? formatNumber(streak.current) : "—"}</p><p class="viewer-stat-label">Day streak</p></div></div>
<div class="viewer-stat"><span class="viewer-stat-icon viewer-stat-icon--credits">${viewerIcon("bars")}</span><div><p class="viewer-stat-num" data-credit-balance="${Number(balance) || 0}"><b data-credit-balance-num>${formatNumber(balance)}</b></p><p class="viewer-stat-label">Credits balance</p></div></div>
</div>`;

  const claimsInProgress = claims.filter((row) => String(row.status || "submitted") === "submitted");
  const claimsCompleted = claims.filter((row) => String(row.status) === "completed");
  const claimsList = (rows) => rows.length
    ? `<ul class="yr-ords" role="list">${rows.map(claimRow).join("")}</ul>`
    : `<p class="viewer-muted">Nothing here yet.</p>`;
  const claimsNote = claims.length ? `<p class="yr-fine">${esc(CLAIM_STATUS_NOTE)}</p>${viewerData.claimsTruncated ? `<p class="yr-fine">Showing the ${formatNumber(viewerData.claimsLimit || claims.length)} most recent claims.</p>` : ""}` : "";
  const participationList = participation.length
    ? `<ul class="yr-parts" role="list">${participation.map(row => `<li class="yr-part"><div class="yr-part-main"><p class="yr-part-n">${esc(row.title || "Community participation")}</p><p class="yr-part-p">${esc(formatDate(row.participatedAt))}</p></div><span class="yr-tag yr-tag--done">${esc(row.statusLabel || "Claimed")}</span></li>`).join("")}</ul>${viewerData.participationTruncated ? `<p class="yr-fine">Showing the ${formatNumber(viewerData.participationLimit || participation.length)} most recent participation records.</p>` : ""}`
    : "";

  const activityCard = `<section class="viewer-card viewer-activity-card" id="membership-claims">
<header class="viewer-card-head"><h2 class="viewer-card-title">Activity history</h2></header>
<div class="viewer-tabs viewer-tabs--line" role="tablist" aria-label="Activity filter">
<button class="viewer-tab is-on" type="button" role="tab" aria-selected="true" data-me-tab="feed">Activity History</button>
<button class="viewer-tab" type="button" role="tab" aria-selected="false" data-me-tab="done">Completed</button>
<button class="viewer-tab" type="button" role="tab" aria-selected="false" data-me-tab="progress">In Progress</button>
<button class="viewer-tab" type="button" role="tab" aria-selected="false" data-me-tab="claimed">Rewards Claimed</button>
</div>
<div class="viewer-me-pane" data-me-pane="feed">${ledger.length ? activityFeed(ctx, ledger, { empty: "" }) : `<p class="viewer-muted">No credit activity yet. Use ${creator}'s channel-point rewards to earn credits.</p>`}</div>
<div class="viewer-me-pane" data-me-pane="progress" hidden>${claimsList(claimsInProgress)}</div>
<div class="viewer-me-pane" data-me-pane="done" hidden>${claimsCompleted.length || participation.length ? `${claimsList(claimsCompleted)}${participationList}` : `<p class="viewer-muted">No completed claims or activities yet.</p>`}</div>
<div class="viewer-me-pane" data-me-pane="claimed" hidden>${claims.length ? claimsList(claims) : `<div class="member-empty"><div><h3>No claims yet</h3><p>${blocked ? 'Claiming is unavailable for this membership.' : `Choose a reward in <a href="${shopHref}">Rewards</a>. Its status will appear here after you claim it.`}</p></div></div>`}</div>
${claimsNote}
</section>`;

  const streakCard = streak || claims.length ? card({
    cls: "viewer-streak",
    title: "Your Streak",
    body: streak
      ? `<div class="viewer-streak-head"><span class="viewer-streak-ico">${viewerIcon("flame")}</span><div><p class="viewer-streak-big">${formatNumber(streak.current)} ${streak.current === 1 ? "day" : "days"}</p><p class="viewer-streak-sub">Keep it going!</p></div></div><p class="viewer-muted">Longest streak: ${formatNumber(streak.longest)} ${streak.longest === 1 ? "day" : "days"}. Active days grow your quest multiplier.</p>`
      : `<p class="viewer-muted">Complete a daily quest to start a streak.</p>`,
    foot: siteSections.activities !== false ? `<a class="yr-btn yr-btn--sm" href="${siteSectionHref("activities", slug, isCustomDomain)}">Today's quests</a>` : "",
  }) : "";

  /* The mockup's right rail opens with the dark art card; the real equivalent
     is the creator's tagline card. */
  const railArt = ctx.b?.tagline ? `<section class="viewer-card viewer-card--dark viewer-promo viewer-rail-art" aria-label="Community tagline"><p class="viewer-rail-art-quote">“${esc(ctx.b.tagline)}”</p><p class="viewer-rail-art-by">— ${creator}</p></section>` : "";

  const recentClaims = claims.length ? card({
    cls: "viewer-recent-claims",
    title: "Recent rewards",
    body: `<ul class="yr-ords yr-ords--mini" role="list">${claims.slice(0, 3).map(claimRow).join("")}</ul>`,
  }) : "";

  const promo = siteSections.activities !== false ? `<section class="viewer-card viewer-promo viewer-promo--light"><h2 class="viewer-promo-title">Keep being active!</h2><p class="viewer-promo-sub">Complete more activities, watch streams, and participate in chat to earn more credits and climb the ranks.</p><a class="yr-btn" href="${siteSectionHref("activities", slug, isCustomDomain)}">Browse Activities ${viewerIcon("arrow")}</a></section>` : "";

  return `${heading}${authError}
${blocked ? '<p class="yr-note yr-note--w" role="status">Claiming is currently unavailable for this membership.</p>' : ""}
${stats}
<div class="viewer-grid">
<div class="viewer-col">
${activityCard}
${blocked ? "" : codeDropClaimSection({slug,creator})}
</div>
<aside class="viewer-side">
${railArt}
${streakCard}
${recentClaims}
${promo}
</aside>
</div>`;
}

function codeDropClaimSection({ slug, creator, joinsMembership = false }) {
  const membershipNote = joinsMembership
    ? " A successful claim joins this community and records the participation on your membership."
    : " A successful claim appears in Participation on this membership.";
  return `<section class="viewer-card yr-code-drop" id="membership-code" aria-label="Redeem a community code">
<header class="viewer-card-head"><h2 class="viewer-card-title">Have a community code?</h2></header>
<p class="yr-note" id="yr-code-drop-help">Enter a code shared by ${creator}.${membershipNote} Each code can be claimed once while it is active.</p>
<form class="yr-code-drop-form" data-code-drop-claim data-site-slug="${esc(slug)}">
<label class="yr-code-drop-label" for="yr-code-drop-code">Community code</label>
<div class="yr-code-drop-controls">
<input class="yr-code-drop-input" id="yr-code-drop-code" name="code" type="text" minlength="3" maxlength="32" pattern="[A-Za-z0-9_-]+" placeholder="COMMUNITY100" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="yr-code-drop-help" required />
<button class="yr-btn yr-btn--sm" type="submit" data-code-drop-submit>Redeem code</button>
</div>
<p class="yr-code-drop-status" id="yr-code-drop-status" role="status" aria-live="polite" tabindex="-1"></p>
</form>
</section>`;
}

function joinAuthButton(r, returnTo, slug) {
  const query = `returnTo=${encodeURIComponent(returnTo)}&intent=join&site=${encodeURIComponent(slug)}`;
  if (r.viewerKickAuthEnabled) return `<a class="yr-btn" href="/api/viewer/auth/kick?${query}">Join community</a>`;
  if (r.viewerDiscordAuthEnabled) return `<a class="yr-btn" href="/api/viewer/auth/discord?${query}">Join community</a>`;
  return "";
}
