// @ts-nocheck
// Multi-section, branded streamer site shell (Home, Leaderboard, Rewards, Games,
// Credits).
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
import { generateAvatarSvg } from "@yourrank/shared/avatar";

// C-02: SECTION_TITLES was an exact duplicate of SECTION_LABELS — removed.
const SECTION_LABELS = {
  home: "Home",
  leaderboard: "Leaderboard",
  shop: "Rewards",
  games: "Games",
  // "My credits" is always this site only; the global account surface at /me is
  // "Your sites & account". Keeping the two names distinct is what stops the
  // two scopes reading as one destination.
  me: "My credits",
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
  const sans = (font && FONT_GF_PARAMS[font]) || DEFAULT_SANS_PARAMS;
  return `https://fonts.googleapis.com/css2?${sans}&${MONO_PARAMS}&display=swap`;
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
  return ["home", "leaderboard", "shop", "games", "me"].filter((s) => sections[s] !== false);
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

function countdownText(endsAt) {
  const end = endsAt ? new Date(endsAt).getTime() : NaN;
  if (Number.isNaN(end)) return null;
  const left = Math.max(0, end - Date.now());
  const d = Math.floor(left / 86400000);
  const h = Math.floor((left % 86400000) / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  return { ms: end, text: d > 0 ? `${d}d ${h}h` : `${h}h ${m}m` };
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

/** The creator's mark: real configured logo only, never a placeholder block. */
function creatorMark(logoUrl, cls, px) {
  if (!logoUrl) return "";
  return `<img class="${cls}" src="${esc(logoUrl)}" srcset="${logoSrcSet(logoUrl)}" sizes="${px}px" width="${px}" height="${px}" alt="" />`;
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
  // The account row only exists where the streamer kept the credits section on;
  // otherwise there is nothing on this site for a viewer to hold.
  const foot = siteSections.me === false
    ? ""
    : viewer
      ? `<a class="yr-user" href="${boardCreditsHref}"><span class="yr-user-l"><span class="yr-ava">${avatarHtml(viewer)}</span><span><span class="yr-user-name">${esc(viewerName(viewer))}</span><span class="yr-user-sub">${formatNumber(balance)} credits here</span></span></span><span class="yr-user-go" aria-hidden="true">${ICONS.arrow}</span></a>`
      : `<a class="yr-user" href="${boardCreditsHref}"><span class="yr-user-l"><span class="yr-ava">?</span><span><span class="yr-user-name">My credits</span><span class="yr-user-sub">Sign in for credits</span></span></span><span class="yr-user-go" aria-hidden="true">${ICONS.arrow}</span></a>`;

  return `<div class="yr-drawer" id="yr-side" aria-label="${name} menu" tabindex="-1">
<div class="yr-drawer-head"><a class="yr-drawer-id" href="${homeUrl}${siteSectionHref("home", slug, isCustomDomain)}">${creatorMark(logoUrl, "yr-drawer-logo", 32)}${name}</a><button class="yr-side-close" id="yr-side-close" type="button" aria-label="Close menu">${ICONS.close}</button></div>
<nav class="yr-nav yr-noscroll" aria-label="Sections">${items}</nav>
${foot ? `<div class="yr-drawer-foot">${foot}</div>` : ""}
</div>
<button class="yr-scrim" id="yr-scrim" type="button" aria-label="Close menu" hidden></button>`;
}

function viewerName(viewer) {
  return viewer?.kick_username || viewer?.discord_username || "Member";
}

function avatarHtml(viewer) {
  return viewer?.avatar_url
    ? `<img src="${esc(viewer.avatar_url)}" alt="" />`
    : generateAvatarSvg(viewerName(viewer), 26);
}

/**
 * One public chrome: the creator on the left, their sections in the middle,
 * the viewer's own controls on the right. No workspace rail, no search field —
 * player search belongs to the leaderboard it filters.
 */
function topbar({ r, b, viewer, balance, returnTo, section, siteSections, homeUrl, slug, isCustomDomain, logoUrl }) {
  const name = esc(b.name || slug);
  const tagline = b.tagline ? esc(b.tagline) : "";
  const nav = sectionList(siteSections).map((s) => {
    const href = `${homeUrl}${siteSectionHref(s, slug, isCustomDomain)}`;
    const active = s === section ? ' aria-current="page"' : "";
    return `<a class="yr-tab${s === section ? " is-on" : ""}" href="${href}"${active}><span>${esc(SECTION_LABELS[s])}</span></a>`;
  }).join("");

  const right = viewer
    ? `<a class="yr-bal" href="${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}" aria-label="My credits on this site: ${formatNumber(balance)}"><span class="yr-bal-num">${formatNumber(balance)}</span><span class="yr-bal-unit">credits</span></a>
<a class="yr-account-link" href="/me" aria-label="Your sites and account"><span class="yr-ava">${avatarHtml(viewer)}</span><span class="yr-account-txt">Your sites</span></a>`
    : signInLink(r, returnTo, "yr-btn yr-btn--ghost");

  return `<header class="yr-top">
<div class="yr-top-in">
<a class="yr-id" href="${homeUrl}${siteSectionHref("home", slug, isCustomDomain)}">${creatorMark(logoUrl, "yr-id-logo", 36)}<span class="yr-id-txt"><span class="yr-id-name">${name}</span>${tagline ? `<span class="yr-id-sub">${tagline}</span>` : ""}</span></a>
<nav class="yr-tabs" aria-label="Sections">${nav}</nav>
<div class="yr-top-r">${right}<button class="yr-menu" id="yr-menu" type="button" aria-label="Open menu" aria-controls="yr-side" aria-expanded="false">${ICONS.bars}</button></div>
</div>
</header>`;
}

function signInLink(r, returnTo, cls = "yr-btn") {
  if (r.viewerKickAuthEnabled) {
    return `<a class="${cls} yr-btn--sm" href="/api/viewer/auth/kick?returnTo=${encodeURIComponent(returnTo)}">Sign in with Kick</a>`;
  }
  if (r.viewerDiscordAuthEnabled) {
    return `<a class="${cls} yr-btn--sm" href="/api/viewer/auth/discord?returnTo=${encodeURIComponent(returnTo)}">Sign in with Discord</a>`;
  }
  return `<a class="${cls} yr-btn--sm" href="/me">Sign in</a>`;
}

function signInButton(r, returnTo) {
  if (r.viewerKickAuthEnabled) {
    return `<a class="yr-btn" href="/api/viewer/auth/kick?returnTo=${encodeURIComponent(returnTo)}">Sign in with Kick</a>`;
  }
  if (r.viewerDiscordAuthEnabled) {
    return `<a class="yr-btn" href="/api/viewer/auth/discord?returnTo=${encodeURIComponent(returnTo)}">Sign in with Discord</a>`;
  }
  return `<a class="yr-btn" href="/me">Sign in</a>`;
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

function kpi(label, iconKey, value, sub, { accent = false } = {}) {
  return `<div class="yr-card yr-lb">
<div class="yr-card-top"><span class="yr-label">${esc(label)}</span>${ICONS[iconKey] || ""}</div>
<p class="yr-num">${esc(String(value))}</p>
<p class="yr-sub${accent ? " is-accent" : ""}">${esc(sub)}</p>
</div>`;
}

function panel({ title, meta = "", body, foot = "", pad = false }) {
  return `<div class="yr-panel yr-lb">
<div class="yr-panel-head"><h2 class="yr-panel-title">${esc(title)}</h2>${meta ? `<span class="yr-panel-meta">${meta}</span>` : ""}</div>
${pad ? `<div class="yr-panel-pad">${body}</div>` : body}
${foot ? `<div class="yr-panel-foot">${foot}</div>` : ""}
</div>`;
}

function sectionHead(title, right = "") {
  return `<div class="yr-sec-head"><h2 class="yr-sec-title">${esc(title)}</h2>${right}</div>`;
}

/** Last 7 calendar days of positive ledger movement. */
function dailyEarned(ledger) {
  const days = [];
  const now = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 86400000);
    days.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(), value: 0 });
  }
  const index = new Map(days.map((d) => [d.key, d]));
  for (const row of ledger) {
    const amount = Number(row.amount) || 0;
    if (amount <= 0) continue;
    const key = String(row.created_at || "").slice(0, 10);
    const bucket = index.get(key);
    if (bucket) bucket.value += amount;
  }
  return days;
}

const LEDGER_KIND = {
  earn: "EARNED_CREDITS",
  spend: "ORDER",
  refund: "REFUND_ISSUED",
  adjust: "MANUAL_ADJUSTMENT",
  game_bet: "GAME_ROUND",
  game_win: "GAME_ROUND",
};

/* ── reward cards ─────────────────────────────────────────────────────── */

function rewardCard({ item, viewer, balance, blocked, signIn }) {
  const cost = Number(item.cost) || 0;
  const inStock = item.stock === null || item.stock === undefined || item.stock > 0;
  const short = viewer ? Math.max(0, cost - balance) : 0;
  const affordable = viewer && !blocked && inStock && short === 0;
  const off = !affordable;

  let flag = "";
  if (!inStock) flag = `<span class="yr-flag yr-flag--ghost">Out of stock</span>`;
  else if (item.stock !== null && item.stock !== undefined && item.stock <= 3) flag = `<span class="yr-flag">${formatNumber(item.stock)} left</span>`;

  let action;
  if (!viewer) action = `<a class="yr-act" href="${signIn}">Sign in</a>`;
  else if (blocked) action = `<span class="yr-act yr-act--off">Unavailable</span>`;
  else if (!inStock) action = `<span class="yr-act yr-act--off">Out of stock</span>`;
  else if (short > 0) action = `<span class="yr-act yr-act--off">${formatNumber(short)} short</span>`;
  else action = `<button class="yr-act" type="button" data-redeem="${esc(item.id)}" data-reward-name="${esc(item.name)}" data-reward-cost="${cost}">Order</button>`;

  // A-08: was aria-hidden="true" with no alternative; replaced with a proper progressbar.
  const fill = viewer && inStock && short > 0 && cost > 0
    ? Math.min(100, Math.round((balance / cost) * 20) * 5)
    : null;
  const meter = fill !== null
    ? `<div class="yr-meter" role="progressbar" aria-valuenow="${fill}" aria-valuemin="0" aria-valuemax="100" aria-label="Reward progress: ${fill}%"><i data-fill="${fill}"></i></div>`
    : "";
  const image = item.image_url || item.image || item.imageUrl;
  const art = image
    ? `<div class="yr-item-art yr-gridbg"><img src="${esc(image)}" alt="" /><span class="yr-shade"></span>${flag}</div>`
    : "";
  const inlineFlag = !image && flag
    ? flag.replace('class="yr-flag', 'class="yr-flag yr-flag--inline')
    : "";

  return `<article class="yr-item${off ? " yr-item--off" : ""}">
${art}
<div class="yr-item-body">
${inlineFlag}
<h4 class="yr-item-h">${esc(item.name)}</h4>
<p class="yr-item-p">${esc(item.description || "Fulfilled by the streamer.")}</p>
${meter}
<div class="yr-item-foot"><span class="yr-cost">${formatNumber(cost)} <i>CR</i></span>${action}</div>
</div>
</article>`;
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

  const sectionUrl = `${homeUrl}${siteSectionHref(section || "home", slug, isCustomDomain)}`;
  const canonicalUrl = esc(sectionUrl);
  const returnTo = sectionUrl;

  const rawTitleBase = String(b.name || slug || "YourRank");
  const titleBase = esc(rawTitleBase);
  const sectionTitle = esc(SECTION_LABELS[section] || section || "");
  const title = opts.pageTitle || (section === "home"
    ? `${titleBase} — ${esc(b.tagline || "Leaderboard & Rewards")}`
    : `${sectionTitle} · ${titleBase}`);
  const rawDesc = opts.pageDescription || (section === "home"
    ? `${rawTitleBase}'s public site — ${b.tagline || "compete on the leaderboard, earn free credits and order rewards."}`
    : `${SECTION_LABELS[section] || section} for ${rawTitleBase}'s public site.`);
  const desc = esc(rawDesc);
  const ogImageUrl = logoUrl ? esc(logoUrl) : `${homeUrl}/og.png`;

  const ctx = {
    r, data, b, br, section, siteSections, slug, isCustomDomain, homeUrl, logoUrl,
    viewer, viewerData, viewerOnSite, balance, casino, pool, period, ctaHref, hasCta,
    returnTo, nonce, watermark, isDemo: !!opts.isDemo,
  };

  const mainInner = section == null && typeof opts.contentHtml === "string" ? opts.contentHtml : (section === "home" ? homeMain(ctx)
    : section === "leaderboard" ? boardMain(ctx)
    : section === "shop" ? shopMain(ctx)
    : section === "games" ? gamesMain(ctx)
    : section === "me" ? meMain(ctx)
    : `<div class="yr-empty">Section not found</div>`);

  const footer = siteFooter({ data, b, siteSections, slug, isCustomDomain, homeUrl, watermark, viewer, casino, ctaHref, hasCta, kickUrl: kickUrl ? safeUrl(kickUrl) : null });

  // B-01: Dynamic font URL based on board's active font.
  const fontsHref = buildFontsHref(data.theme?.font);
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
<style nonce="${nonce}" data-theme-tokens>.yr-site{--yr-accent:${accent};--yr-accent-ink:${accentInkValue}}${section === "games" ? `#gx-root{--gx-accent:${accent};--gx-accent-ink:${accentInkValue}}` : ""}</style>
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
    viewer ? `<a href="/me">Your sites &amp; account</a>` : "",
    `<button type="button" data-feedback-open>Send feedback</button>`,
  ].filter(Boolean).join("");
  return `<footer class="yr-foot">
<p class="yr-fine">${CREDITS_DISCLAIMER}</p>
<div class="yr-foot-links">${enabled.map((s) => `<a href="${homeUrl}${siteSectionHref(s, slug, isCustomDomain)}">${esc(SECTION_LABELS[s])}</a>`).join("")}${legalLinks}</div>
<div class="yr-foot-links yr-foot-links--more">${secondary}</div>
<p class="yr-fine">&copy; ${new Date().getFullYear()} ${esc(b.name || slug)}.${watermark ? ` Powered by <a href="${esc(homeUrl || "/")}" target="_blank" rel="noopener">YourRank</a>.` : ""}</p>
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
  const { r, data, b, slug, isCustomDomain, homeUrl, logoUrl, viewer, viewerData, balance, period, pool, returnTo, siteSections } = ctx;
  const shopHref = `${homeUrl}${siteSectionHref("shop", slug, isCustomDomain)}`;
  const boardHref = `${homeUrl}${siteSectionHref("leaderboard", slug, isCustomDomain)}`;
  const meHref = `${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}`;
  const name = esc(b.name || slug);
  const currency = prizeCurrency(data);
  const cd = countdownText(data.scheduled ? data.startsAt : data.endsAt);
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

  const intro = `<section class="yr-intro">
<div class="yr-intro-id">${creatorMark(logoUrl, "yr-intro-logo", 64)}<div class="yr-intro-txt"><h1 class="yr-intro-name">${name}</h1>${b.tagline ? `<p class="yr-intro-sub">${esc(b.tagline)}</p>` : `<p class="yr-intro-sub">Leaderboard and free-credit rewards.</p>`}</div></div>
<div class="yr-intro-acts">${kickLink ? `<a class="yr-btn yr-btn--ghost" href="${kickLink.href}" target="_blank" rel="noopener noreferrer">Watch on ${esc(kickLink.label)}<span class="yr-sr"> (opens in a new tab)</span></a>` : ""}${viewer ? "" : signInButton(r, returnTo)}</div>
</section>`;

  const timing = data.ended
    ? "Round ended"
    : cd
      ? `${data.scheduled ? "Starts in" : "Ends in"} ${cd.text}`
      : data.scheduled ? "Not started yet" : "";
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
${leaders ? `<ol class="yr-leads">${leaders}</ol>` : `<p class="yr-sec-note">No players on the board yet — the first scores show up here.</p>`}
</section>`
    : "";

  const viewerNote = viewer
    ? `<section class="yr-vnote">
<p class="yr-vnote-bal"><span class="yr-vnote-num">${formatNumber(balance)}</span> <span class="yr-vnote-unit">credits on this site</span></p>
<p class="yr-vnote-p">Free credits from ${name}'s channel-point rewards. No purchase, no cash value.</p>
<div class="yr-vnote-acts">${shopEnabled ? `<a class="yr-btn yr-btn--sm" href="${shopHref}">Spend credits</a>` : ""}${meEnabled ? `<a class="yr-sec-link" href="${meHref}">My credits ${ICONS.arrow}</a>` : ""}</div>
</section>`
    : "";

  const preview = items.slice().sort((x, z) => Number(x.cost) - Number(z.cost)).slice(0, 3);
  const rewardsSection = shopEnabled && preview.length
    ? `<section class="yr-sec">
${sectionHead("Rewards", `<a class="yr-sec-link" href="${shopHref}">View rewards ${ICONS.arrow}</a>`)}
<ul class="yr-preview">${preview.map((item) => `<li class="yr-preview-row"><span class="yr-preview-n">${esc(item.name)}</span><span class="yr-preview-c">${formatNumber(Number(item.cost) || 0)} credits</span></li>`).join("")}</ul>
</section>`
    : "";

  const linksSection = socials.length
    ? `<section class="yr-sec">
${sectionHead(`Find ${b.name || slug}`)}
<div class="yr-chips">${socials.map((s) => `<a class="yr-chip" href="${s.href}" target="_blank" rel="noopener noreferrer">${esc(s.label)}<span class="yr-sr"> (opens in a new tab)</span></a>`).join("")}</div>
</section>`
    : "";

  const nothingYet = !leaders && !preview.length
    ? `<p class="yr-sec-note">${name} hasn't added players or rewards yet. Check back soon.</p>`
    : "";

  return `${intro}
${viewerNote}
${boardSection}
${rewardsSection}
${nothingYet}
${linksSection}`;
}

/* ── Leaderboard / Ranks ──────────────────────────────────────────────── */

function boardMain(ctx) {
  const { data, b, slug, isCustomDomain, period, pool } = ctx;
  const currency = prizeCurrency(data);
  const hidePrizes = !!data.brand?.hidePrizeAmounts;
  const cd = countdownText(data.scheduled ? data.startsAt : data.endsAt);
  const players = (Array.isArray(data.players) ? data.players : []).slice().sort((x, z) => (x.rank || 0) - (z.rank || 0) || String(x.name || "").localeCompare(String(z.name || "")));
  const playerCount = Number(data.playerCount) || players.length;
  const rankBy = data.rankBy === "score" ? "score" : "wagered";
  const wagerLabel = esc(rankBy === "score" ? "Points" : (data.prizes?.wagerLabel || "Amount"));
  const rankValue = (player) => rankBy === "score" ? `${formatNumber(player.score || 0)} pts` : formatMoney(currency, player.wagered);
  const prizeLabel = esc(data.prizes?.prizeLabel || "Prize");
  const poolLabel = esc(data.prizes?.prizePoolLabel || b.prizePoolLabel || "Prize pool");
  const playerHref = (name) => isCustomDomain ? `/player/${encodeURIComponent(name)}` : `/${encodeURIComponent(slug)}/player/${encodeURIComponent(name)}`;

  const heroHtml = hero({
    eyebrow: [pool ? `${esc(pool)} ${poolLabel.toUpperCase()}` : "", `${period.toUpperCase()} LEADERBOARD`].filter(Boolean).join(" · "),
    title: data.ended ? "Final standings" : data.scheduled ? "Standings open soon" : "Standings",
    lede: data.ended
      ? `This round has ended. These final results are ranked by ${wagerLabel.toLowerCase()}; tied players share a rank.`
      : data.scheduled
        ? `This round has not started yet. Pre-start standings are visible, and score updates open when the round begins.`
        : `Ranked by ${wagerLabel.toLowerCase()} on ${esc(b.name || slug)}'s leaderboard. Players with the same value share a rank.`,
    right: cd && !data.ended
      ? `<div class="yr-hero-r yr-hero-r--stack">${heroStat(data.scheduled ? "Starts in" : "Ends in", cd.text, { cd: cd.ms })}</div>`
      : (data.ended ? `<div class="yr-hero-r yr-hero-r--stack">${heroStat("Round", "Ended")}</div>` : (pool ? `<div class="yr-hero-r yr-hero-r--stack">${heroStat(poolLabel, esc(pool))}</div>` : "")),
  });

  const podium = players.slice(0, 3).map((p, i) => {
    const rank = Number(p.rank) || i + 1;
    const first = rank === 1;
    return `<div class="yr-card yr-lb${first ? " yr-card--on" : ""}" data-player-name="${esc(String(p.name || "").toLowerCase())}">
<div class="yr-card-top"><span class="yr-label${first ? " is-accent" : ""}">#${rank}</span>${first ? ICONS.crown : ICONS.medal}</div>
<p class="yr-card-name"><a href="${playerHref(p.name)}">${esc(p.name)}</a></p>
<p class="yr-num">${esc(rankValue(p))}</p>
<p class="yr-sub">${wagerLabel}${!hidePrizes && p.prize ? ` · <span class="yr-gold">${esc(formatMoney(currency, p.prize))}</span>` : ""}</p>
</div>`;
  }).join("");

  const rows = players.map((p, i) => `<tr data-player-name="${esc(String(p.name || "").toLowerCase())}" data-position="${Number(p.rank) || i + 1}">
<td class="yr-idx">${Number(p.rank) || i + 1}</td>
<td><a href="${playerHref(p.name)}">${esc(p.name)}</a></td>
<td class="yr-mono yr-r">${esc(rankValue(p))}</td>
<td class="yr-mono yr-r${!hidePrizes && p.prize ? " yr-gold" : ""}">${hidePrizes ? "—" : (p.prize ? esc(formatMoney(currency, p.prize)) : "—")}</td>
</tr>`).join("");

  const table = players.length
    ? `<div class="yr-table-wrap" data-table-wrap><table class="yr-table"><caption class="yr-sr">Public standings for ${esc(b.name || slug)}</caption><thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col" class="yr-r">${wagerLabel}</th><th scope="col" class="yr-r">${prizeLabel}</th></tr></thead>
<tbody data-rows>${rows}<tr class="yr-nomatch" id="yr-no-match" hidden><td colspan="4">No player matches that search.</td></tr></tbody></table></div>
<p class="yr-search-status" id="yr-search-status" role="status" aria-live="polite"></p>
${playerCount > players.length ? `<div class="yr-pagination"><button class="yr-btn yr-btn--sm" type="button" data-load-more>Load more</button><span data-load-more-status role="status" aria-live="polite"></span></div>` : ""}`
    : `<div class="yr-empty">No players on the leaderboard yet</div>`;

  const poolPanel = pool && !hidePrizes
    ? `<div class="yr-card yr-lb yr-split">
<div><p class="yr-label">${poolLabel}</p><p class="yr-num yr-gold">${esc(pool)}</p></div>
<p class="yr-note yr-note--w">Paid in cash by the sponsor to the top ${wagerLabel.toLowerCase()} players. Separate from credits — credits can't be won here and cash can't be bought with credits.</p>
</div>`
    : "";

  const note = data.resetNote ? `<p class="yr-note">${esc(data.resetNote)}</p>` : "";

  return `${heroHtml}
<div data-player-board>
${poolPanel}
${podium ? `<div class="yr-g3">${podium}</div>` : ""}
${panel({
    title: "Standings",
    meta: `<span data-player-count-badge>${formatNumber(playerCount)} players</span>`,
    // Player search filters this table, so it lives with the table rather than
    // in shared chrome every other section has to carry.
    body: `${players.length ? `<div class="yr-search-row"><label class="yr-sr" for="yr-search">Search players</label><input class="yr-search" id="yr-search" type="search" placeholder="Search players…" autocomplete="off" /></div>` : ""}${table}`,
    foot: note,
  })}</div>`;
}

/* ── Rewards ──────────────────────────────────────────────────────────── */

function shopMain(ctx) {
  const { r, b, data, viewer, viewerData, viewerOnSite, balance, returnTo, slug } = ctx;
  const items = (viewerData?.shopItems || data.shopItems || []).filter((i) => i.active !== false).slice().sort((x, z) => Number(x.cost) - Number(z.cost));
  const redemptions = viewerData?.redemptions || [];
  const pending = redemptions.filter((x) => x.status === "pending").length;
  const signIn = r.viewerKickAuthEnabled
    ? `/api/viewer/auth/kick?returnTo=${encodeURIComponent(returnTo)}`
    : (r.viewerDiscordAuthEnabled ? `/api/viewer/auth/discord?returnTo=${encodeURIComponent(returnTo)}` : "/me");

  const heroHtml = hero({
    eyebrow: items.length ? `${formatNumber(items.length)} REWARDS${viewer && pending ? ` · ${pending} PENDING` : ""}` : "REWARDS",
    title: "Rewards",
    lede: items.length
      ? `${esc(b.name || slug)} hands every one of these over personally. Credits are deducted when you place an order and returned in full if it's cancelled.`
      : "Rewards will appear here when the streamer adds them.",
    right: viewer
      ? `<div class="yr-hero-r yr-hero-r--stack">${heroStat("Loyalty credits", formatNumber(balance))}</div>`
      : `<div class="yr-hero-r">${signInButton(r, returnTo)}</div>`,
  });

  const blockedNote = items.length && viewerOnSite?.blocked
    ? `<div class="yr-card yr-lb"><p class="yr-label">Ordering disabled</p><p class="yr-note">${esc(viewerOnSite.block_reason || "The streamer has paused orders for your account.")}</p></div>`
    : "";

  const grid = items.length
    ? `<div>${sectionHead("All rewards", `<span class="yr-panel-meta">Sorted by cost</span>`)}
<div class="yr-g4">${items.map((item) => rewardCard({ item, viewer, balance, blocked: viewerOnSite?.blocked, signIn })).join("")}</div></div>`
    : `<div class="yr-empty">No rewards available right now</div>`;

  const history = viewer
    ? panel({
        title: "Your orders",
        meta: "Fulfilled by hand",
        body: redemptions.length
          ? `<div class="yr-list">${redemptions.slice(0, 10).map(redemptionRow).join("")}</div>`
          : `<div class="yr-empty">No orders yet</div>`,
      })
    : "";

  return `${heroHtml}
${blockedNote}
<p class="yr-redeem-status" id="yr-redeem-status" role="status" aria-live="polite"></p>
${grid}
${history}`;
}

function redemptionRow(row) {
  const status = String(row.status || "pending");
  const tagCls = status === "pending" ? "yr-tag yr-tag--pending" : status === "fulfilled" ? "yr-tag yr-tag--done" : "yr-tag";
  const detail = status === "refunded"
    ? `${formatDate(row.created_at)} · ${formatNumber(row.cost)} credits refunded in full`
    : status === "cancelled"
      ? `${formatDate(row.created_at)} · cancelled, ${formatNumber(row.cost)} credits returned`
      : `${formatDate(row.created_at)} · ${formatNumber(row.cost)} credits deducted`;
  return `<div class="yr-list-item">
<div><p class="yr-list-h">${esc(row.item_name || "Order")}</p><p class="yr-list-p">${esc(detail)}</p></div>
<span class="${tagCls}">${esc(status)}</span>
</div>`;
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

/* ── Credits ────────────────────────────────────────────────────── */

function meMain(ctx) {
  const { r, b, slug, viewer, viewerData, viewerOnSite, balance, returnTo, homeUrl, isCustomDomain, siteSections } = ctx;
  if (!viewer) {
    return `${hero({ eyebrow: "THIS SITE ONLY", title: "My credits", lede: "Sign in to see the balance, credit history and orders tied to this site.", right: `<div class="yr-hero-r">${signInButton(r, returnTo)}</div>` })}
<div class="yr-gate"><h2>Sign in to see credits</h2><p>${esc(CREDITS_DISCLAIMER)}</p>${signInButton(r, returnTo)}</div>`;
  }

  const ledger = viewerData?.ledger || [];
  const redemptions = viewerData?.redemptions || [];
  const emptyCredits = ledger.length === 0 && redemptions.length === 0 && Number(balance || 0) === 0;
  const earned7 = dailyEarned(ledger).reduce((a, d) => a + d.value, 0);
  const shopHref = `${homeUrl}${siteSectionHref("shop", slug, isCustomDomain)}`;

  const gamerCard = `
<div class="yr-card yr-gamer-card mb-16">
  <div class="yr-gamer-card-head">
    <div class="yr-gamer-id">
      <span class="yr-gamer-ava">${avatarHtml(viewer)}</span>
      <div>
        <h2 class="yr-gamer-name">${esc(viewerName(viewer))}</h2>
      </div>
    </div>
  </div>
  <div class="yr-gamer-stats-grid">
    <div class="yr-gstat-item">
      <span class="yr-gstat-lbl">Balance</span>
      <strong class="yr-gstat-val yr-pos">${formatNumber(balance)} CR</strong>
    </div>
    <div class="yr-gstat-item">
      <span class="yr-gstat-lbl">Lifetime Earned</span>
      <strong class="yr-gstat-val">${formatNumber(viewerOnSite?.total_earned || 0)} CR</strong>
    </div>
    <div class="yr-gstat-item">
      <span class="yr-gstat-lbl">Lifetime Spent</span>
      <strong class="yr-gstat-val">${formatNumber(viewerOnSite?.total_spent || 0)} CR</strong>
    </div>
    <div class="yr-gstat-item">
      <span class="yr-gstat-lbl">Orders</span>
      <strong class="yr-gstat-val">${formatNumber(redemptions.length)} orders</strong>
    </div>
  </div>
</div>`;

  const heroHtml = hero({
    eyebrow: "THIS SITE ONLY",
    title: "My credits",
    lede: `Signed in as <b>${esc(viewerName(viewer))}</b>. Every credit here came from ${esc(b.name || slug)}'s Kick channel-point rewards. <a class="yr-inline-link" href="/me">Your sites &amp; account</a>. ${esc(CREDITS_DISCLAIMER)}`,
    right: `<div class="yr-hero-r">${heroStat("Balance on this site", formatNumber(balance))}${siteSections.shop !== false ? `<a class="yr-btn" href="${shopHref}">Spend credits</a>` : ""}</div>`,
  });

  if (emptyCredits) {
    return `${heroHtml}
<div class="yr-empty">No credit activity or orders yet</div>`;
  }

  const kpis = [
    kpi("Credits / 7d", "chart", `+${formatNumber(earned7)}`, `${ledger.length} recent entries`, { accent: true }),
    kpi("Earned all time", "trophy", formatNumber(viewerOnSite?.total_earned || 0), `${formatNumber(viewerOnSite?.total_spent || 0)} spent so far`),
    kpi("Pending orders", "hourglass", formatNumber(redemptions.filter((x) => x.status === "pending").length), `${esc(b.name || slug)} fulfils by hand`),
  ].join("");

  const ledgerRows = ledger.length
    ? ledger.map((row) => {
        const amount = Number(row.amount) || 0;
        return `<tr>
<td class="yr-mono">${esc(formatDate(row.created_at))}</td>
<td>${esc(LEDGER_KIND[row.type] || String(row.type || "").toUpperCase())}</td>
<td class="yr-mono yr-r"><span class="${amount >= 0 ? "yr-pos" : ""}">${amount >= 0 ? "+" : ""}${formatNumber(amount)}</span></td>
<td class="yr-mono yr-r">${esc(row.description || "—")}</td>
</tr>`;
      }).join("")
    : "";

  const historyPanel = panel({
    title: "Credit history",
    meta: `${formatNumber(ledger.length)} entries`,
    body: ledgerRows
      ? `<div class="yr-table-wrap" data-table-wrap><table class="yr-table"><caption class="yr-sr">Credit history</caption><thead><tr><th scope="col" class="yr-w-auto">Date</th><th scope="col">Activity</th><th scope="col" class="yr-r">Amount</th><th scope="col" class="yr-r">Detail</th></tr></thead><tbody>${ledgerRows}</tbody></table></div>`
      : `<div class="yr-empty">No credit history yet</div>`,
  });

  const redemptionsPanel = panel({
    title: "Orders",
    meta: "Fulfilled by hand",
    body: redemptions.length
      ? `<div class="yr-list">${redemptions.map(redemptionRow).join("")}</div>`
      : `<div class="yr-empty">No orders yet</div>`,
  });

  return `${heroHtml}
${gamerCard}
<div class="yr-g3">${kpis}</div>
${historyPanel}
${redemptionsPanel}`;
}
