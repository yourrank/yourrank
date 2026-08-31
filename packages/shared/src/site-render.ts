// @ts-nocheck
// Multi-section, branded streamer site shell (Home, Leaderboard, Rewards, Games,
// My Community).
//
// The chrome is a creator destination, not a workspace: one compact top bar
// carrying creator identity, the section links and the viewer's own controls,
// then the page. Narrow widths disclose the same links in a modal drawer. It
// ships as a single stylesheet (/assets/site-shell.css) plus a small
// progressive-enhancement script (/assets/site-shell.js) — no CDN, no runtime
// CSS framework, no chart library.
//
// Only data the backend can actually produce is rendered: balances and history
// come from the viewer's ledger, standings from the streamer's board, rewards
// from shop_items. Nothing here claims watch time, tiers or percentiles, and
// sponsor cash is kept visually distinct from free credits.
import {
  logoSrcSet,
  renderLegalSidebar,
  esc,
  safeUrl,
} from "./public-render-helpers.js";
import { gamesIslandHead, gamesIslandMount } from "./games-embed.js";

// C-02: SECTION_TITLES was an exact duplicate of SECTION_LABELS — removed.
const SECTION_LABELS = {
  home: "Home",
  leaderboard: "Leaderboard",
  shop: "Rewards",
  games: "Games",
  me: "My Community",
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

function timingHtml(timing, { scheduled = false } = {}) {
  if (!timing || timing.kind === "invalid" || timing.kind === "expired") return "";
  const label = scheduled ? "Starts" : "Ends";
  if (timing.kind === "calendar") {
    return `<span data-countdown-mode="calendar">${label} <time datetime="${esc(timing.iso)}">${esc(timing.text)}</time></span>`;
  }
  return `<span data-countdown-mode="relative" data-countdown-complete="${scheduled ? "Started" : "Ended"}">${label} in <b data-ends-at="${esc(timing.iso)}">${esc(timing.text)}</b></span>`;
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
function drawer({ b, slug, section, siteSections, homeUrl, isCustomDomain, logoUrl, viewer, balance }) {
  const enabled = sectionList(siteSections);
  const items = enabled.map((s) => navItem({
    key: s,
    label: SECTION_LABELS[s],
    href: `${homeUrl}${siteSectionHref(s, slug, isCustomDomain)}`,
    active: s === section,
    badge: s === "me" && viewer ? compact(balance) : null,
  })).join("");

  const name = esc(b.name || slug);
  const boardCreditsHref = `${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}`;
  const accountHref = globalViewerAccountHref(isCustomDomain);
  // The membership row only exists where the streamer kept My Community on;
  // otherwise there is no local viewer destination on this site.
  // The bar's account shortcut is desktop-only, so the drawer carries the
  // viewer's global account destination at narrow widths as well as their
  // balance on this site.
  const acct = viewer ? `<a class="yr-sec-link yr-drawer-acct" href="${accountHref}">All communities ${ICONS.arrow}</a>` : "";
  const userRow = siteSections.me === false
    ? ""
    : viewer
      ? `<a class="yr-user" href="${boardCreditsHref}"><span class="yr-user-l"><span class="yr-ava">${avatarHtml(viewer)}</span><span><span class="yr-user-name">${esc(viewerName(viewer))}</span><span class="yr-user-sub">${formatNumber(balance)} credits in this community</span></span></span><span class="yr-user-go" aria-hidden="true">${ICONS.arrow}</span></a>`
      : `<a class="yr-user" href="${boardCreditsHref}"><span class="yr-user-l"><span class="yr-ava">?</span><span><span class="yr-user-name">My Community</span><span class="yr-user-sub">Sign in to join</span></span></span><span class="yr-user-go" aria-hidden="true">${ICONS.arrow}</span></a>`;
  const foot = `${userRow}${acct}`;

  return `<div class="yr-drawer" id="yr-side" aria-label="${name} menu" tabindex="-1">
<div class="yr-drawer-head"><a class="yr-drawer-id" href="${homeUrl}${siteSectionHref("home", slug, isCustomDomain)}">${creatorMark(logoUrl, "yr-drawer-logo", 32, monogram(b.name || slug, "yr-mark yr-mark--sm"))}${name}</a><button class="yr-side-close" id="yr-side-close" type="button" aria-label="Close menu">${ICONS.close}</button></div>
<nav class="yr-nav yr-noscroll" aria-label="Sections">${items}</nav>
${foot ? `<div class="yr-drawer-foot">${foot}</div>` : ""}
</div>
<button class="yr-scrim" id="yr-scrim" type="button" aria-label="Close menu" hidden></button>`;
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
 * One public chrome: the creator on the left, their sections in the middle,
 * the viewer's own controls on the right. No workspace rail, no search field —
 * player search belongs to the leaderboard it filters.
 */
function topbar({ r, b, viewer, balance, returnTo, section, siteSections, homeUrl, slug, isCustomDomain, logoUrl }) {
  const name = esc(b.name || slug);
  const tagline = b.tagline ? esc(b.tagline) : "";
  const accountHref = globalViewerAccountHref(isCustomDomain);
  const nav = sectionList(siteSections).map((s) => {
    const href = `${homeUrl}${siteSectionHref(s, slug, isCustomDomain)}`;
    const active = s === section ? ' aria-current="page"' : "";
    return `<a class="yr-tab${s === section ? " is-on" : ""}" href="${href}"${active}><span>${esc(SECTION_LABELS[s])}</span></a>`;
  }).join("");

  // The account shortcut is the desktop treatment only: below the drawer
  // breakpoint the viewer's own avatar next to the creator's mark reads as a
  // second unlabelled identity, so the stylesheet hides it there and the
  // drawer's account row — the same destination — carries it instead.
  const right = viewer
    ? `<a class="yr-bal" href="${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}" data-credit-balance="${Number(balance) || 0}" data-credit-balance-label="Credits in this community" aria-label="Credits in this community: ${formatNumber(balance)}"><span class="yr-bal-num" data-credit-balance-num>${formatNumber(balance)}</span><span class="yr-bal-unit">credits</span></a>
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
    return `<a class="${cls} yr-btn--sm" href="/api/viewer/auth/kick?returnTo=${encodeURIComponent(returnTo)}">Sign in with Kick</a>`;
  }
  if (r.viewerDiscordAuthEnabled) {
    return `<a class="${cls} yr-btn--sm" href="/api/viewer/auth/discord?returnTo=${encodeURIComponent(returnTo)}">Sign in with Discord</a>`;
  }
  return `<a class="${cls} yr-btn--sm" href="${accountHref}">Sign in</a>`;
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
  refund: "Refund",
  adjust: "Adjustment by the streamer",
  game_bet: "Game round",
  game_win: "Game round",
};

const ORDER_STATUS_LABEL = {
  pending: "Pending",
  fulfilled: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

const ORDER_STATUS_NOTE = "Pending means the creator still needs to complete your reward claim. Completed means it is complete. Cancelled means the credits went back to your balance.";

/**
 * The one page opening every viewer surface uses: what the page is, what it is
 * for, the fine print, and the viewer's own balance stated once in plain text.
 */
function viewerHead({ title, lede, balance = null, actions = "", disclaimer = true }) {
  // The balance and the way onward travel together beside the explanation
  // instead of spreading down the page, so the head reads as one module.
  const aside = balance === null && !actions
    ? ""
    : `<div class="yr-vhead-aside">${balance === null ? "" : `<p class="yr-vbal${Number(balance) === 0 ? " is-zero" : ""}" data-credit-balance="${Number(balance) || 0}"><span class="yr-vbal-num" data-credit-balance-num>${formatNumber(balance)}</span> <span class="yr-vbal-unit">free credits</span></p>`}${actions ? `<div class="yr-vhead-acts">${actions}</div>` : ""}</div>`;
  return `<section class="yr-vhead${aside ? " yr-vhead--split" : ""}">
<div class="yr-vhead-txt">
<h1 class="yr-h1">${esc(title)}</h1>
<p class="yr-vhead-lede">${lede}</p>
${disclaimer ? `<p class="yr-vhead-fine">${esc(CREDITS_DISCLAIMER)}</p>` : ""}
</div>
${aside}
</section>`;
}

/* ── reward rows ──────────────────────────────────────────────────────── */

/**
 * One reward as a row in a plain list: name and description on the left, cost,
 * state and the single Claim action on the right. Every state is stated in
 * words — a greyed-out button is not an explanation — and the cost is ordinary
 * text rather than a headline, because free credits are not a price tag.
 */
function rewardRow({ item, viewer, balance, blocked, signIn }) {
  const cost = Number(item.cost) || 0;
  const stock = item.stock === null || item.stock === undefined ? null : Number(item.stock);
  const inStock = stock === null || stock > 0;
  const short = viewer ? Math.max(0, cost - balance) : 0;

  let state = "";
  let action;
  if (!viewer) {
    action = `<a class="yr-act" href="${signIn}">Sign in to claim</a>`;
  } else if (blocked) {
    state = "Claiming disabled on this site";
    action = `<span class="yr-act yr-act--off" role="note">Unavailable</span>`;
  } else if (!inStock) {
    // The control already says it in words, so the row does not say it twice.
    action = `<span class="yr-act yr-act--off" role="note">Out of stock</span>`;
  } else if (short > 0) {
    state = `${formatNumber(short)} more needed`;
    action = `<span class="yr-act yr-act--off" role="note">Not enough credits</span>`;
  } else {
    if (stock !== null && stock <= 3) state = `${formatNumber(stock)} left`;
    action = `<button class="yr-act" type="button" data-redeem="${esc(item.id)}" data-reward-name="${esc(item.name)}" data-reward-cost="${cost}">Claim</button>`;
  }

  // A configured reward image belongs to the creator, so it still shows — as a
  // small thumbnail in the row, not a 160px art panel per reward.
  const image = item.image_url || item.image || item.imageUrl;

  return `<li class="yr-rwd">
${image ? `<img class="yr-rwd-img" src="${esc(image)}" alt="" width="48" height="48" loading="lazy" />` : ""}
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
  const siteSections = data.siteSections || { home: true, leaderboard: true, shop: true, games: false, me: true };
  const nonce = opts.nonce;
  const slug = opts.slug || "";
  const isCustomDomain = !!opts.isCustomDomain;
  const homeUrl = String(opts.homeUrl || "https://yourrank.site").replace(/\/$/, "");
  const logoUrl = opts.logoUrl || null;
  const watermark = r.plan === "free";

  const casino = String(b.casino || "").trim();
  const pool = String(b.prizePool || "").trim();
  const period = String(b.period || "Monthly");
  const ctaDest = b.ctaUrl;
  const ctaHref = slug ? esc(`/go/${slug}`) : safeUrl(ctaDest);
  const hasCta = !!(ctaDest || casino);
  const accent = accentColor(br, br.options);

  const viewerOnSite = viewerData?.viewerOnSite || null;
  const balance = Number(viewerOnSite?.balance || 0);
  const kickUrl = (Array.isArray(data.socials) ? data.socials : []).find((s) => /kick/i.test(s?.type || s?.name || ""))?.url;

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
    viewer, viewerData, viewerOnSite, balance, casino, pool, period, ctaHref, hasCta,
    returnTo, nonce, watermark, isDemo: !!opts.isDemo,
    viewerAuthError: typeof opts.viewerAuthError === "string" ? opts.viewerAuthError : "",
  };

  const mainInner = section == null && typeof opts.contentHtml === "string" ? opts.contentHtml : (section === "home" ? homeMain(ctx)
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
<link rel="stylesheet" href="/assets/devin-system.css" />
${section === "games" ? gamesIslandHead() : ""}
<style nonce="${nonce}" data-theme-tokens>.yr-site{--yr-accent:${accent};--yr-accent-ink:${accentInkValue}${font ? `;--yr-display-font:"${font}", "Fira Sans", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif` : ""}}${section === "games" ? `#gx-root{--gx-accent:${accent};--gx-accent-ink:${accentInkValue}}` : ""}</style>
${opts.csrfToken ? `<meta name="csrf-token" content="${esc(opts.csrfToken)}" />` : ""}
</head>`;

  const template = data.theme?.template || data.brand?.template || "cyber_arcade";

  const body = `<body class="yr-site" data-template="${esc(template)}" data-section="${esc(section)}" data-slug="${esc(slug)}" data-custom-domain="${isCustomDomain ? "true" : "false"}" data-currency="${esc(prizeCurrency(data))}" data-rank-by="${data.rankBy === "score" ? "score" : "wagered"}">
<!-- PUBLIC-VIEWER-DIRECTION
THESIS: A creator's own destination for one board, not a workspace and not a gaming dashboard.
OWN-WORLD: Deep asphalt surfaces, fog-white type, one creator accent, orange warnings, mint success, 6–10px geometry, one shared foundation for every template.
STORY: Whose site this is, what the board is doing, what this viewer has here, what they can get, where else to find the creator.
FIRST VIEWPORT: Creator identity and sections in one compact bar, then the creator's own introduction and the live board.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->
<a class="yr-sr" href="#main-content">Skip to content</a>
${topbar({ r, b, viewer, balance, returnTo, section, siteSections, homeUrl, slug, isCustomDomain, logoUrl })}
<main class="yr-main" id="main-content">
${mainInner}
${footer}
</main>
${drawer({ b, slug, section, siteSections, homeUrl, isCustomDomain, logoUrl, viewer, balance })}
${feedbackModal({ slug })}
<script src="/assets/cookie-consent.js" nonce="${nonce}" defer></script>
<script src="/assets/site-shell.js" nonce="${nonce}" defer></script>
</body></html>`;

  return head + body;
}

function feedbackModal({ slug }) {
  // A-07: dialog now uses aria-labelledby to bind the heading correctly.
  return `<dialog id="yr-feedback" class="yr-modal" aria-labelledby="yr-feedback-title">
<form class="yr-modal-in" method="dialog">
<h2 id="yr-feedback-title">Send feedback</h2>
<p class="yr-note">Tell us what works and what doesn't. No contact details needed.</p>
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
 * used to hold, so the drawer stays a narrow-width disclosure of the top bar.
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
  // What a viewer normally reads at the bottom is the creator's sign-off: the
  // fine print, their copyright, the legal pages and one way to reach us. The
  // section map below it is the fallback for a browser that never ran the shell
  // script; it is always server-rendered and the stylesheet hides it only once
  // the script reports ready, because from then on the bar and the drawer own
  // navigation and a second copy of it is noise.
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
 * Home is the creator's landing page, not a report: who this is, what the
 * board is doing, what the signed-in viewer has here, what they can get, and
 * where else to find the creator. Nothing is rendered from data the streamer
 * has not configured.
 */
function homeMain(ctx) {
  const { data, b, slug, isCustomDomain, homeUrl, viewer, viewerData, balance, period, pool, siteSections } = ctx;
  const shopHref = `${homeUrl}${siteSectionHref("shop", slug, isCustomDomain)}`;
  const boardHref = `${homeUrl}${siteSectionHref("leaderboard", slug, isCustomDomain)}`;
  const meHref = `${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}`;
  const name = esc(b.name || slug);
  const currency = prizeCurrency(data);
  const cd = formatLeaderboardTiming(data.scheduled ? data.startsAt : data.endsAt);
  const scheduled = !!data.scheduled && cd.kind !== "expired";
  const ended = !!data.ended || (!data.scheduled && cd.kind === "expired");
  const players = Array.isArray(data.players) ? data.players : [];
  const playerCount = Number(data.playerCount) || players.length;
  const rankBy = data.rankBy === "score" ? "score" : "wagered";
  const hidePrizes = !!data.brand?.hidePrizeAmounts;
  const rankValue = (player) => rankBy === "score" ? `${formatNumber(player.score || 0)} pts` : formatMoney(currency, player.wagered);
  const playerHref = (player) => isCustomDomain ? `/player/${encodeURIComponent(player)}` : `/${encodeURIComponent(slug)}/player/${encodeURIComponent(player)}`;
  const items = (viewerData?.shopItems || data.shopItems || []).filter((i) => i.active !== false);
  const shopEnabled = siteSections.shop !== false;
  const boardEnabled = siteSections.leaderboard !== false;
  const meEnabled = siteSections.me !== false;
  const socials = (Array.isArray(data.socials) ? data.socials : [])
    .filter((s) => s && s.enabled !== false && s.url)
    .map((s) => ({ label: s.name || s.brand || s.type || "Channel", href: safeUrl(s.url) }))
    .filter((s) => s.href !== "#");
  const kickLink = socials.find((s) => /kick/i.test(s.label));

  // The bar already carries the creator's mark, name and line, so Home does not
  // repeat that composition: it states what this page is, in the creator's own
  // name, keeps their line, and offers the one thing a visitor came to do. A
  // signed-in viewer gets their balance module beside it, not a second button.
  // Signing in belongs to the bar on every page, so these are the creator's own
  // actions only: a visitor never reads the same sign-in twice in one viewport.
  const introActs = [
    !viewer && shopEnabled && items.length ? `<a class="yr-btn" href="${shopHref}">View rewards</a>` : "",
    kickLink ? `<a class="yr-btn yr-btn--ghost" href="${kickLink.href}" target="_blank" rel="noopener noreferrer">Watch on ${esc(kickLink.label)}<span class="yr-sr"> (opens in a new tab)</span></a>` : "",
  ].filter(Boolean).join("");

  const intro = `<section class="yr-intro">
<div class="yr-intro-txt"><h1 class="yr-intro-name">Welcome to ${name}'s channel</h1>${b.tagline ? `<p class="yr-intro-sub">${esc(b.tagline)}</p>` : `<p class="yr-intro-sub">Leaderboard and free-credit rewards.</p>`}</div>
${introActs ? `<div class="yr-intro-acts">${introActs}</div>` : ""}
</section>`;

  const timing = ended
    ? "Round ended"
    : timingHtml(cd, { scheduled }) || (scheduled ? "Not started yet" : "");
  const boardMeta = [
    `${esc(period)} leaderboard`,
    timing,
    playerCount ? `${formatNumber(playerCount)} ${playerCount === 1 ? "player" : "players"}` : "",
    pool && !hidePrizes ? `${esc(pool)} prize pool` : "",
  ].filter(Boolean).join(" · ");

  const leaders = players.slice(0, 5).map((p, i) => `<li class="yr-lead">
<span class="yr-lead-rank">${String(Number(p.rank) || i + 1).padStart(2, "0")}</span>
<a class="yr-lead-name" href="${playerHref(p.name)}">${esc(p.name)}</a>
<span class="yr-lead-val yr-mono">${esc(rankValue(p))}</span>
</li>`).join("");

  const boardSection = boardEnabled
    ? `<section class="yr-sec">
${sectionHead("Leaderboard", `<a class="yr-sec-link" href="${boardHref}">View leaderboard ${ICONS.arrow}</a>`)}
<p class="yr-sec-meta">${boardMeta}</p>
${leaders ? `<ol class="yr-leads">${leaders}</ol>` : emptyState(ICONS.trophy, "No players on the board yet", "The first scores show up here once the board opens.")}
</section>`
    : "";

  const viewerNote = viewer
    ? `<section class="yr-vnote${balance === 0 ? " is-zero" : ""}">
<p class="yr-vnote-bal"><span class="yr-vnote-num">${formatNumber(balance)}</span> <span class="yr-vnote-unit">credits on this site</span></p>
<p class="yr-vnote-p">Free credits from ${name}'s channel-point rewards. No purchase, no cash value.</p>
<div class="yr-vnote-acts">${shopEnabled && items.length ? `<a class="yr-btn yr-btn--sm" href="${shopHref}">${balance > 0 ? "Spend credits" : "View rewards"}</a>` : ""}${meEnabled ? `<a class="yr-sec-link" href="${meHref}">My Community ${ICONS.arrow}</a>` : ""}</div>
</section>`
    : "";

  const preview = items.slice().sort((x, z) => Number(x.cost) - Number(z.cost)).slice(0, 3);
  const rewardsSection = shopEnabled
    ? `<section class="yr-sec">
${sectionHead("Rewards", preview.length ? `<a class="yr-sec-link" href="${shopHref}">View rewards ${ICONS.arrow}</a>` : "")}
${preview.length
      ? `<ul class="yr-preview">${preview.map((item) => `<li class="yr-preview-row"><span class="yr-preview-n">${esc(item.name)}</span><span class="yr-preview-c">${formatNumber(Number(item.cost) || 0)} credits</span></li>`).join("")}</ul>`
      : emptyState(ICONS.gift, "No rewards yet", "Rewards will appear here once there are some to claim.")}
</section>`
    : "";

  const linksSection = socials.length
    ? `<section class="yr-sec">
${sectionHead(`Find ${b.name || slug}`)}
<div class="yr-chips">${socials.map((s) => `<a class="yr-chip" href="${s.href}" target="_blank" rel="noopener noreferrer">${esc(s.label)}<span class="yr-sr"> (opens in a new tab)</span></a>`).join("")}</div>
</section>`
    : "";

  // The previews carry their own empty states, so a page-level "nothing yet"
  // line only earns its place when neither preview is on the page at all.
  const nothingYet = !boardSection && !rewardsSection
    ? `<p class="yr-sec-note">${name} hasn't added players or rewards yet. Check back soon.</p>`
    : "";

  // Two balanced previews on a wide viewport, one stack on a phone: the creator
  // and their balance first, then the board, then the rewards.
  return `<div class="yr-home-top${viewerNote ? "" : " yr-home-top--solo"}">${intro}${viewerNote}</div>
${boardSection || rewardsSection ? `<div class="yr-home-cols">${boardSection}${rewardsSection}</div>` : ""}
${nothingYet}
${linksSection}`;
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
  const rankBy = data.rankBy === "score" ? "score" : "wagered";
  const wagerLabel = esc(rankBy === "score" ? "Points" : (data.prizes?.wagerLabel || "Amount"));
  const rankValue = (player) => rankBy === "score" ? `${formatNumber(player.score || 0)} pts` : formatMoney(currency, player.wagered);
  const prizeLabel = esc(data.prizes?.prizeLabel || "Prize");
  const poolLabel = esc(data.prizes?.prizePoolLabel || b.prizePoolLabel || "Prize pool");
  const playerHref = (name) => isCustomDomain ? `/player/${encodeURIComponent(name)}` : `/${encodeURIComponent(slug)}/player/${encodeURIComponent(name)}`;

  // Compact intro: the title, one state line built only from board data that is
  // already public, then the ranking rule. No KPI strip, no promoted amounts.
  const stateLabel = ended ? "Ended" : scheduled ? "Not started" : "Live";
  const stateClass = ended ? "is-ended" : scheduled ? "is-soon" : "is-live";
  const metaItems = [
    `<span class="yr-lbh-state ${stateClass}">${stateLabel}</span>`,
    `<span>${esc(period)} leaderboard</span>`,

    !ended ? timingHtml(cd, { scheduled }) : "",
    pool && !hidePrizes ? `<span>${esc(pool)} ${poolLabel.toLowerCase()}</span>` : "",
  ].filter(Boolean).join("");

  const introHtml = `<section class="yr-lbh">
<h1 class="yr-h1 yr-lbh-title">${ended ? "Final standings" : scheduled ? "Standings open soon" : "Standings"}</h1>
<p class="yr-lbh-meta">${metaItems}</p>
<p class="yr-lbh-note">${scheduled ? `Pre-start standings are visible; scores update once the round begins. Ranked by ${wagerLabel.toLowerCase()}, and tied players share a rank.` : `Ranked by ${wagerLabel.toLowerCase()}. Tied players share a rank.`}</p>
</section>`;

  // One row per player: the top of the board is expressed through rank
  // typography instead of a second, duplicate representation of the top three.
  const rows = players.map((p, i) => {
    const rank = Number(p.rank) || i + 1;
    const prize = !hidePrizes && p.prize ? esc(formatMoney(currency, p.prize)) : "";
    return `<li class="yr-srow${rank === 1 ? " yr-srow--first" : rank <= 3 ? " yr-srow--top" : ""}" data-player-name="${esc(String(p.name || "").toLowerCase())}" data-position="${rank}">
<span class="yr-srow-rank"><span class="yr-sr">Rank </span>${rank}</span>
<a class="yr-srow-name" href="${playerHref(p.name)}">${esc(p.name)}</a>
<span class="yr-srow-val"><span class="yr-sr">${wagerLabel}: </span>${esc(rankValue(p))}</span>
${prize ? `<span class="yr-srow-prize"><span class="yr-sr">${prizeLabel}: </span>${prize}</span>` : ""}
</li>`;
  }).join("");

  // Column labels are a wide-viewport reading aid only: every cell already
  // carries its own screen-reader label, so announcing them twice is noise.
  const columns = `<div class="yr-stand-head" aria-hidden="true" data-hide-prizes="${hidePrizes ? "true" : "false"}"><span>#</span><span>Player</span><span class="yr-r">${wagerLabel}</span>${hidePrizes ? "" : `<span class="yr-r">${prizeLabel}</span>`}</div>`;

  const standings = players.length
    ? `${columns}
<ol class="yr-stand" data-rows aria-label="Standings for ${esc(b.name || slug)}" data-value-label="${wagerLabel}" data-prize-label="${prizeLabel}" data-hide-prizes="${hidePrizes ? "true" : "false"}">${rows}</ol>
<p class="yr-nomatch" id="yr-no-match" hidden>No players match that search.</p>
<p class="yr-search-status" id="yr-search-status" role="status" aria-live="polite"></p>
${playerCount > players.length ? `<div class="yr-pagination"><button class="yr-btn yr-btn--sm" type="button" data-load-more>Load more players</button><p class="yr-page-status" data-load-more-status role="status" aria-live="polite" tabindex="-1"></p></div>` : ""}`
    : emptyState(ICONS.trophy, "No players yet", scheduled ? "Standings fill in once the round starts." : `The board fills in when ${esc(b.name || slug)} publishes the first scores.`);

  const notes = [
    data.resetNote ? `<p class="yr-note">${esc(data.resetNote)}</p>` : "",
    pool && !hidePrizes ? `<p class="yr-note yr-note--w">Paid in cash by the sponsor to the top ${wagerLabel.toLowerCase()} players. Separate from credits — credits can't be won here and cash can't be bought with credits.</p>` : "",
  ].filter(Boolean).join("");

  return `${introHtml}
<div data-player-board>
${panel({
    title: "Standings",
    titleHidden: true,
    meta: `<span data-player-count-badge>${formatNumber(playerCount)} ${playerCount === 1 ? "player" : "players"}</span>`,
    // Player search filters this list, so it lives with the list rather than
    // in shared chrome every other section has to carry.
    body: `${players.length ? `<div class="yr-search-row"><label class="yr-sr" for="yr-search">Search players</label><input class="yr-search" id="yr-search" type="search" placeholder="Search players by name" autocomplete="off" enterkeyhint="search" /></div>` : ""}${standings}`,
    foot: notes,
  })}</div>`;
}

/* ── Rewards ──────────────────────────────────────────────────────────── */

function shopMain(ctx) {
  const { r, b, data, viewer, viewerData, viewerOnSite, balance, returnTo, slug, homeUrl, isCustomDomain, siteSections } = ctx;
  const items = (viewerData?.shopItems || data.shopItems || []).filter((i) => i.active !== false).slice().sort((x, z) => Number(x.cost) - Number(z.cost));
  const redemptions = viewerData?.redemptions || [];
  const blocked = !!viewerOnSite?.blocked;
  const signIn = r.viewerKickAuthEnabled
    ? `/api/viewer/auth/kick?returnTo=${encodeURIComponent(returnTo)}`
    : (r.viewerDiscordAuthEnabled ? `/api/viewer/auth/discord?returnTo=${encodeURIComponent(returnTo)}` : "/me");
  const creditsHref = `${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}`;

  const head = viewerHead({
    title: "Rewards",
    lede: viewer
      ? `Use your free credits from ${esc(b.name || slug)}'s channel-point rewards. ${esc(b.name || slug)} hands each reward over personally.`
      : `Browse rewards from ${esc(b.name || slug)}. Sign in from the header to use your credits.`,
    balance: viewer ? balance : null,
    actions: viewer
      ? (siteSections.me !== false ? `<a class="yr-sec-link" href="${creditsHref}">My Community ${ICONS.arrow}</a>` : "")
      : "",
  });

  const blockedNote = viewer && blocked
    ? `<p class="yr-note yr-note--w">Claiming is currently unavailable for this membership.</p>`
    : "";

  const list = items.length
    ? `<section class="yr-vsec">${sectionHead("All rewards", `<span class="yr-panel-meta">Cheapest first</span>`)}
<ul class="yr-rwds" role="list">${items.map((item) => rewardRow({ item, viewer, balance, blocked, signIn })).join("")}</ul></section>`
    : `<section class="yr-vsec yr-vsec--empty${viewer ? "" : " yr-vsec--narrow"}">${sectionHead("All rewards")}${emptyState(ICONS.gift, "No rewards yet", `Rewards will appear here when ${esc(b.name || slug)} adds them.`)}</section>`;

  const history = viewer
    ? `<section class="yr-vsec${redemptions.length ? "" : " yr-vsec--empty"}">${sectionHead("Recent claims")}
${redemptions.length
      ? `<ul class="yr-ords" role="list">${redemptions.slice(0, 5).map(orderRow).join("")}</ul><p class="yr-fine">${esc(ORDER_STATUS_NOTE)}</p>`
      : emptyState(ICONS.book, "No claims yet", "Rewards you claim show up here with their status.")}</section>`
    : "";

  const canOrder = viewer && !blocked && items.some((item) => (item.stock === null || item.stock === undefined || Number(item.stock) > 0) && Number(item.cost || 0) <= balance);

  return `${head}
${blockedNote}
<p class="yr-redeem-status" id="yr-redeem-status" role="status" aria-live="polite" tabindex="-1"></p>
${list}
${history}
${canOrder ? orderConfirmDialog() : ""}`;
}

/** One reward claim: what it was, what it cost, when, and where it stands. */
function orderRow(row) {
  const status = String(row.status || "pending");
  const label = ORDER_STATUS_LABEL[status] || status;
  const tagCls = status === "pending" ? "yr-tag yr-tag--pending" : status === "fulfilled" ? "yr-tag yr-tag--done" : "yr-tag";
  return `<li class="yr-ord">
<div class="yr-ord-main">
<p class="yr-ord-n">${esc(row.item_name || "Reward claim")}</p>
<p class="yr-ord-p">${formatNumber(row.cost)} credits · ${esc(formatDate(row.created_at))}</p>
</div>
<span class="${tagCls}">${esc(label)}</span>
</li>`;
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
    signInUrl: `/api/viewer/auth/kick?returnTo=${encodeURIComponent(returnTo)}`,
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

/* ── My Community ───────────────────────────────────────────────── */

function meMain(ctx) {
  const { b, slug, viewer, viewerData, balance, homeUrl, isCustomDomain, siteSections, viewerAuthError } = ctx;
  const creator = esc(b.name || slug);
  const authErrorMessages = {
    oauth_state_expired: "That sign-in took too long. Try again.",
    access_denied: "Sign-in was cancelled.",
    missing_oauth_params: "We couldn't complete sign-in. Try again.",
    kick_auth_failed: "We couldn't complete Kick sign-in. Try again.",
    discord_auth_failed: "We couldn't complete Discord sign-in. Try again.",
    rate_limited: "Too many sign-in attempts. Wait a moment, then try again.",
  };
  const authErrorMessage = authErrorMessages[viewerAuthError] || (viewerAuthError ? "We couldn't complete sign-in. Try again." : "");
  const authError = authErrorMessage
    ? `<p class="yr-note yr-note--w" role="alert">${esc(authErrorMessage)}</p>`
    : "";
  if (!viewer) {
    const guide = `<section class="yr-vsec yr-vsec--narrow yr-credit-guide">
${sectionHead("After you sign in")}
<dl class="yr-credit-guide-list">
<div class="yr-credit-guide-row"><dt>Community membership</dt><dd>Keep one persistent relationship with ${creator} through your Viewer Account.</dd></div>
<div class="yr-credit-guide-row"><dt>Rewards and credits</dt><dd>See free credits earned from ${creator}'s channel-point rewards.</dd></div>
<div class="yr-credit-guide-row"><dt>Claims</dt><dd>Follow the current status of rewards you claim in this community.</dd></div>
</dl>
</section>`;
    return `${viewerHead({
      title: "My Community",
      lede: `Sign in from the header to join ${creator}'s community with your Viewer Account.`,
    })}
${authError}
${guide}`;
  }

  const accountHref = globalViewerAccountHref(isCustomDomain);
  if (!viewerData?.viewerOnSite) {
    return `${viewerHead({
      title: "My Community",
      lede: `Signed in as <b>${esc(viewerName(viewer))}</b>.`,
      actions: `<a class="yr-sec-link" href="${accountHref}">All communities ${ICONS.arrow}</a>`,
    })}
${authError}
<p class="yr-note yr-note--w" role="status">We couldn't load your community membership right now. Reload this page to try again.</p>`;
  }

  const ledger = viewerData?.ledger || [];
  const redemptions = viewerData?.redemptions || [];
  const shopHref = `${homeUrl}${siteSectionHref("shop", slug, isCustomDomain)}`;

  const head = viewerHead({
    title: "My Community",
    lede: `Your membership in ${creator}. Signed in as <b>${esc(viewerName(viewer))}</b>${viewerData.viewerOnSite.created_at ? ` · Member since ${esc(formatDate(viewerData.viewerOnSite.created_at))}` : ""}.`,
    balance,
    actions: `${siteSections.shop !== false ? `<a class="yr-btn yr-btn--sm" href="${shopHref}">View rewards</a>` : ""}<a class="yr-sec-link" href="${accountHref}">All communities ${ICONS.arrow}</a>`,
  });

  // Activity reads as rows rather than a four-column table: on a phone a table
  // this wide either scrolls sideways or shreds the detail column. Sign is
  // spelled out with + and − so it never depends on the colour of the number.
  const historyRows = ledger.map((row) => {
    const amount = Number(row.amount) || 0;
    return `<li class="yr-hist">
<div class="yr-hist-main">
<p class="yr-hist-n">${esc(LEDGER_KIND[row.type] || String(row.type || "Activity"))}</p>
${row.description ? `<p class="yr-hist-p">${esc(row.description)}</p>` : ""}
</div>
<div class="yr-hist-side">
<p class="yr-hist-amt${amount >= 0 ? " yr-pos" : ""}">${amount >= 0 ? "+" : "−"}${formatNumber(Math.abs(amount))}<span class="yr-sr"> credits</span></p>
<p class="yr-hist-d">${esc(formatDate(row.created_at))}</p>
</div>
</li>`;
  }).join("");

  const history = `<section class="yr-vsec${ledger.length ? "" : " yr-vsec--empty"}">${sectionHead("Credits", ledger.length ? `<span class="yr-panel-meta">${formatNumber(ledger.length)} ${ledger.length === 1 ? "entry" : "entries"}</span>` : "")}
${historyRows ? `<ul class="yr-hists" role="list">${historyRows}</ul>` : emptyState(ICONS.me, "No credit activity yet", `Use ${creator}'s channel-point rewards to earn credits.`)}</section>`;

  const orders = `<section class="yr-vsec${redemptions.length ? "" : " yr-vsec--empty"}">${sectionHead("Claims")}
${redemptions.length
    ? `<ul class="yr-ords" role="list">${redemptions.map(orderRow).join("")}</ul><p class="yr-fine">${esc(ORDER_STATUS_NOTE)}</p>`
    : emptyState(ICONS.book, "No claims yet", "Rewards you claim show up here with their status.", siteSections.shop !== false ? `<a class="yr-sec-link" href="${shopHref}">View rewards ${ICONS.arrow}</a>` : "")}</section>`;

  // Two columns of the viewer's own record on a wide viewport, one stack on a
  // phone: history and claims are peers, not a page each.
  return `${head}
${authError}
<div class="yr-vcols${!ledger.length && !redemptions.length ? " yr-vcols--empty" : ""}">${history}${orders}</div>`;
}
