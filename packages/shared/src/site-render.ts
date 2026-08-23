// @ts-nocheck
// Multi-section, branded streamer site shell (Home, Leaderboard, Rewards, Games,
// Credits).
//
// The chrome is a live-production credential system: a fixed navigation rail,
// an operational header, asphalt panels, cobalt actions and a board-specific
// accent cue. It ships as a single stylesheet (/assets/site-shell.css) plus a small
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
  me: "Credits",
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
const FIRA_PARAMS = "family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700";

function buildFontsHref(font) {
  const custom = font && font !== "Fira Sans" ? FONT_GF_PARAMS[font] : null;
  const params = custom ? `${FIRA_PARAMS}&${custom}` : FIRA_PARAMS;
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
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

/** "02H_AGO" / "3D_AGO" — the mockup's mono log timestamps. */
function agoStamp(d) {
  const t = d ? new Date(d).getTime() : NaN;
  if (Number.isNaN(t)) return "—";
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 60) return `${String(mins).padStart(2, "0")}M_AGO`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${String(hours).padStart(2, "0")}H_AGO`;
  return `${Math.floor(hours / 24)}D_AGO`;
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

function sidebar({ b, slug, section, siteSections, homeUrl, isCustomDomain, logoUrl, viewer, balance, ctaHref, hasCta, casino, kickUrl }) {
  const enabled = sectionList(siteSections);
  const items = enabled.map((s) => navItem({
    key: s,
    label: SECTION_LABELS[s],
    href: `${homeUrl}${siteSectionHref(s, slug, isCustomDomain)}`,
    active: s === section,
    badge: s === "me" && viewer ? compact(balance) : null,
  })).join("");

  const resources = [
    kickUrl && kickUrl !== "#" ? `<a class="yr-nav-a" href="${kickUrl}" target="_blank" rel="noopener">${ICONS.kick} Watch on Kick</a>` : "",
    hasCta && casino ? `<a class="yr-nav-a" href="${ctaHref}" target="_blank" rel="noopener">${ICONS.gift} Join ${esc(casino)}</a>` : "",
    viewer ? `<a class="yr-nav-a" href="/me">${ICONS.account} All sites &amp; account</a>` : "",
    `<button class="yr-nav-a" type="button" data-feedback-open>${ICONS.book} Send feedback</button>`,
  ].filter(Boolean).join("");

  const mark = logoUrl
    ? `<img class="yr-brand-logo" src="${esc(logoUrl)}" srcset="${logoSrcSet(logoUrl)}" sizes="28px" alt="" />`
    : "";
  const name = esc(b.name || slug);

  const boardCreditsHref = `${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}`;
  const foot = viewer
    ? `<a class="yr-user" href="${boardCreditsHref}"><span class="yr-user-l"><span class="yr-ava">${avatarHtml(viewer)}</span><span><span class="yr-user-name">${esc(viewerName(viewer))}</span><span class="yr-user-sub">Credits on this site</span></span></span><span class="yr-user-go" aria-hidden="true">${ICONS.arrow}</span></a>`
    : `<a class="yr-user" href="${boardCreditsHref}"><span class="yr-user-l"><span class="yr-ava">?</span><span><span class="yr-user-name">Credits</span><span class="yr-user-sub">Sign in for credits</span></span></span><span class="yr-user-go" aria-hidden="true">${ICONS.arrow}</span></a>`;

  return `<aside class="yr-side" id="yr-side" aria-label="Site sections" tabindex="-1">
<div class="yr-side-head"><div class="yr-board-id"><a class="yr-brand" href="${homeUrl}${siteSectionHref("home", slug, isCustomDomain)}">${mark}${name}</a><span class="yr-board-kind">Public site</span></div><button class="yr-side-close" id="yr-side-close" type="button" aria-label="Close sections">${ICONS.close}</button></div>
<nav class="yr-nav yr-noscroll" aria-label="Sections">
${items}
<div class="yr-nav-group">Resources</div>
${resources}
</nav>
<div class="yr-side-foot">${foot}</div>
</aside>
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

function header({ r, viewer, balance, returnTo, searchable, section, homeUrl, slug, isCustomDomain }) {
  // U-02 / 1.14: The non-searchable state was an <a> that looked like an <input>.
  // Now it is an unambiguous labelled link, clearly distinct from the real input.
  // L-03 / 1.13: Removed the floating bare ${ICONS.search} SVG between the menu
  // button and the search input — it had no wrapper and produced a stray flex item.
  const search = searchable
    ? `<label class="yr-search-label yr-sr" for="yr-search">Search players</label><input class="yr-search" id="yr-search" type="search" placeholder="Search players…" aria-label="Search players" autocomplete="off" />`
    : `<a class="yr-search-link" href="${homeUrl}${siteSectionHref("leaderboard", slug, isCustomDomain)}" aria-label="Go to leaderboard">${ICONS.search}<span>${esc(SECTION_LABELS[section] || "Leaderboard")}</span></a>`;

  const right = viewer
    ? `<a class="yr-account-link" href="/me" aria-label="All sites and account">${ICONS.account}<span>All sites</span></a>
<span class="yr-vr"></span>
<a class="yr-bal" href="${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}" aria-label="Credits on this site: ${formatNumber(balance)}"><span class="yr-bal-txt"><span class="yr-bal-num">${formatNumber(balance)}</span><span class="yr-bal-unit">credits</span></span><span class="yr-ava">${avatarHtml(viewer)}</span></a>`
    : signInLink(r, returnTo, "yr-btn yr-btn--ghost");

  return `<header class="yr-header">
<div class="yr-header-l">
<button class="yr-menu" id="yr-menu" type="button" aria-label="Open sections" aria-controls="yr-side" aria-expanded="false">${ICONS.bars}</button>
${search}
</div>
<div class="yr-header-r">${right}</div>
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

/** Inline 7-day line chart. No chart library: one path, one average line. */
function creditsChart(series) {
  const CHART_GRID_COLOR = "#2b2b30";
  const CHART_AVG_COLOR  = "#3d3d45";

  const w = 800;
  const h = 320;
  const padL = 8;
  const padB = 28;
  const values = series.map((p) => p.value);
  const max = Math.max(1, ...values);
  const avg = values.reduce((a, v) => a + v, 0) / (values.length || 1);
  const step = (w - padL * 2) / Math.max(1, values.length - 1);
  const y = (v) => (h - padB) - (v / max) * (h - padB - 16);
  const pts = values.map((v, i) => `${(padL + i * step).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join("L")}`;
  const grid = [0.25, 0.5, 0.75, 1].map((f) => {
    const gy = (y(max * f)).toFixed(1);
    return `<line x1="${padL}" x2="${w - padL}" y1="${gy}" y2="${gy}" stroke="${CHART_GRID_COLOR}" stroke-width="1" vector-effect="non-scaling-stroke" />`;
  }).join("");
  const labels = series.map((p) => `<span>${esc(p.label)}</span>`).join("");
  return `<div class="yr-chart">
<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Credits earned per day, last 7 days">
${grid}
<path d="${line}" fill="none" stroke="var(--yr-accent-readable)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
<line x1="${padL}" x2="${w - padL}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}" stroke="${CHART_AVG_COLOR}" stroke-width="1" stroke-dasharray="4 4" vector-effect="non-scaling-stroke" />
</svg>
<div class="yr-legend yr-legend--x">${labels}</div>
</div>`;
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

function activityFeed(ledger) {
  if (!ledger.length) return `<div class="yr-empty">No credit activity yet</div>`;
  return `<div class="yr-feed yr-noscroll">${ledger.slice(0, 20).map((row) => {
    const amount = Number(row.amount) || 0;
    const kind = LEDGER_KIND[row.type] || String(row.type || "CREDIT_ACTIVITY").toUpperCase();
    const sign = amount >= 0 ? `<span class="yr-pos">+${formatNumber(amount)}</span>` : `<span class="yr-neg">${formatNumber(amount)}</span>`;
    const text = row.description ? `${esc(row.description)} · ${sign} credits` : `${sign} credits`;
    return `<div class="yr-feed-item">
<div class="yr-feed-top"><span class="yr-feed-kind">${esc(kind)}</span><span class="yr-feed-time">${esc(agoStamp(row.created_at))}</span></div>
<p class="yr-feed-txt">${text}</p>
</div>`;
  }).join("")}</div>`;
}

function demoActivityFeed(rows) {
  if (!rows.length) return `<div class="yr-empty">No demo activity yet</div>`;
  return `<div class="yr-feed yr-noscroll">${rows.slice(0, 8).map((row) => `<div class="yr-feed-item">
<div class="yr-feed-top"><span class="yr-feed-kind">${esc(row.kind || "ACTIVITY")}</span><span class="yr-feed-time">${esc(row.when || "RECENTLY")}</span></div>
<p class="yr-feed-txt">${esc(row.text || "")}</p>
</div>`).join("")}</div>`;
}

function demoGiveawayCard(giveaway) {
  if (!giveaway) return "";
  return `<div class="yr-card yr-lb">
<div class="yr-card-top"><span class="yr-label is-accent">LIVE GIVEAWAY</span>${ICONS.gift}</div>
<p class="yr-card-name">${esc(giveaway.name || "Demo giveaway")}</p>
<p class="yr-num yr-gold">${esc(giveaway.prize || "Prize")}</p>
<p class="yr-sub">${esc(giveaway.entries || "Entries open")} · ${esc(giveaway.ends || "Running now")}</p>
</div>`;
}

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

  const footer = siteFooter({ data, b, siteSections, slug, isCustomDomain, homeUrl, watermark });

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
THESIS: A production cue sheet for following one board, not a generic gaming dashboard.
OWN-WORLD: Asphalt surfaces, fog-white type, cobalt actions, board-accent credentials, orange warnings, mint success, 6–10px geometry.
STORY: Identify the board, follow standings, use board credits, and reach the account without losing scope.
FIRST VIEWPORT: Board credential rail, operational header, then one bordered briefing field with the current page task and action.
FORM: Brief-pinned live-production credential system; no concept roll.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->
<a class="yr-sr" href="#main-content">Skip to content</a>
${sidebar({ b, slug, section, siteSections, homeUrl, isCustomDomain, logoUrl, viewer, balance, ctaHref, hasCta, casino, kickUrl: kickUrl ? safeUrl(kickUrl) : null })}
<div class="yr-region">
<div class="yr-gridbg" aria-hidden="true"></div>
${header({ r, viewer, balance, returnTo, searchable: section === "leaderboard", section, homeUrl, slug, isCustomDomain })}
<main class="yr-main" id="main-content">
${mainInner}
${footer}
</main>
</div>
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

function siteFooter({ data, b, siteSections, slug, isCustomDomain, homeUrl, watermark }) {
  const enabled = sectionList(siteSections);
  const legalHref = (page) => `${homeUrl}${siteSectionHref(page, slug, isCustomDomain)}`;
  const legalLinks = renderLegalSidebar(data, legalHref).split("\n").filter(Boolean).join("");
  return `<footer class="yr-foot">
<p class="yr-fine">${CREDITS_DISCLAIMER}</p>
<div class="yr-foot-links">${enabled.map((s) => `<a href="${homeUrl}${siteSectionHref(s, slug, isCustomDomain)}">${esc(SECTION_LABELS[s])}</a>`).join("")}${legalLinks}</div>
<p class="yr-fine">&copy; ${new Date().getFullYear()} ${esc(b.name || slug)}.${watermark ? ` Powered by <a href="${esc(homeUrl || "/")}" target="_blank" rel="noopener">YourRank</a>.` : ""}</p>
</footer>`;
}

/* ── Home ─────────────────────────────────────────────────────────────── */

function homeMain(ctx) {
  const { r, data, b, slug, isCustomDomain, homeUrl, viewer, viewerData, balance, viewerOnSite, period, pool, returnTo, siteSections } = ctx;
  const shopHref = `${homeUrl}${siteSectionHref("shop", slug, isCustomDomain)}`;
  const boardHref = `${homeUrl}${siteSectionHref("leaderboard", slug, isCustomDomain)}`;
  const meHref = `${homeUrl}${siteSectionHref("me", slug, isCustomDomain)}`;
  const cd = countdownText(data.scheduled ? data.startsAt : data.endsAt);
  const players = Array.isArray(data.players) ? data.players : [];
  const rankBy = data.rankBy === "score" ? "score" : "wagered";
  const rankValue = (player) => rankBy === "score" ? `${formatNumber(player.score || 0)} pts` : formatMoney(currency, player.wagered);
  const items = (viewerData?.shopItems || data.shopItems || []).filter((i) => i.active !== false);
  const demoActivity = Array.isArray(data.demoActivity) ? data.demoActivity : [];
  const demoGiveaway = data.demoGiveaway || null;
  const currency = prizeCurrency(data);
  const ledger = viewerData?.ledger || [];
  const redemptions = viewerData?.redemptions || [];
  const pending = redemptions.filter((x) => x.status === "pending").length;
  const shopEnabled = siteSections.shop !== false;
  const emptyBoard = players.length === 0 && items.length === 0;

  const timing = data.ended ? "ROUND ENDED" : cd ? `${data.scheduled ? "STARTS" : "ENDS"} IN ${cd.text.toUpperCase()}` : "";
  const eyebrow = [period.toUpperCase(), timing].filter(Boolean).join(" · ");

  // "N more credits unlocks X" — the closest reward the viewer cannot afford yet.
  const nextReward = viewer
    ? items.filter((i) => Number(i.cost) > balance).sort((x, z) => Number(x.cost) - Number(z.cost))[0]
    : null;

  const heroRight = viewer
    ? `<div class="yr-hero-r">${heroStat("Loyalty credits", formatNumber(balance))}${shopEnabled ? `<a class="yr-btn" href="${shopHref}">Spend credits</a>` : ""}</div>`
    : emptyBoard
      ? `<div class="yr-hero-r">${signInButton(r, returnTo)}</div>`
      : `<div class="yr-hero-r">${heroStat(pool ? "Prize pool" : "Players", pool ? esc(pool) : formatNumber(players.length))}${signInButton(r, returnTo)}</div>`;

  const lede = viewer
    ? `Use a channel-point reward on Kick and credits land here automatically.${nextReward ? ` <b>${formatNumber(Number(nextReward.cost) - balance)}</b> more credits unlocks ${esc(nextReward.name)}.` : ""}`
    : esc(b.tagline || `Compete on the ${period.toLowerCase()} leaderboard and turn free channel-point credits into real rewards.`);

  const heroHtml = hero({
    eyebrow,
    title: viewer ? `Welcome back, ${viewerName(viewer)}` : (b.name || slug),
    lede,
    right: heroRight,
  });

  const kpiItems = viewer
    ? [
        kpi("Credits / 7d", "chart", `+${formatNumber(dailyEarned(ledger).reduce((a, d) => a + d.value, 0))}`, `${ledger.length} recent entries`, { accent: true }),
        kpi("Earned all time", "trophy", formatNumber(viewerOnSite?.total_earned || 0), `${formatNumber(viewerOnSite?.total_spent || 0)} spent so far`),
        kpi("Pending orders", "hourglass", formatNumber(pending), pending ? `${esc(b.name || slug)} fulfils by hand` : "Nothing waiting"),
      ]
    : [
        pool ? null : kpi("Leaderboard", "trophy", period, `${period} leaderboard`),
        kpi("Players", "chart", formatNumber(players.length), "On the current leaderboard"),
        kpi(data.ended ? "Round" : data.scheduled ? "Starts in" : "Ends in", "hourglass", data.ended ? "Ended" : (cd ? cd.text : "—"), data.ended ? "Final standings" : data.scheduled ? "Until score updates open" : (cd ? "Until final standings" : "No end date set")),
      ].filter(Boolean);
  const kpis = kpiItems.join("");
  const kpiGridClass = kpiItems.length === 2 ? "yr-g3 yr-g3--pair" : "yr-g3";

  const series = dailyEarned(ledger);
  const chartOrHow = viewer
    ? `<div class="yr-c8 yr-panel yr-lb yr-chart-panel">
<div class="yr-chart-head"><h3 class="yr-panel-title">Credits earned</h3><div class="yr-legend"><span><i></i>Credits</span><span><i class="is-avg"></i>7-day average</span></div></div>
${creditsChart(series)}
</div>`
    : `<div class="yr-c8">${panel({
        title: "How credits work",
        meta: "Free · no purchase",
        pad: true,
        body: `<ol class="yr-lede yr-steps">
<li>Watch on Kick and use one of the channel-point rewards.</li>
<li>Credits land on this site automatically — nothing to type in, no codes.</li>
<li>Spend them on rewards. The streamer fulfils every order by hand, and cancelled orders are refunded in full.</li>
</ol>`,
      })}</div>`;

  const rightCol = viewer
    ? `<div class="yr-c4">${panel({
        title: "Log activity",
        meta: `<a class="yr-sec-link" href="${meHref}">All</a>`,
        body: activityFeed(ledger),
      })}</div>`
    : `<div class="yr-c4">${panel({
        title: demoActivity.length ? "Recent activity" : "Top of the leaderboard",
        meta: `<a class="yr-sec-link" href="${boardHref}">All</a>`,
        body: demoActivity.length
          ? demoActivityFeed(demoActivity)
          : players.length
          ? `<div class="yr-feed yr-noscroll">${players.slice(0, 8).map((p, i) => `<div class="yr-feed-item"><div class="yr-feed-top"><span class="yr-feed-kind">${String(Number(p.rank) || i + 1).padStart(2, "0")} · ${esc(p.name)}</span><span class="yr-feed-time yr-prize-value">${esc(rankValue(p))}</span></div></div>`).join("")}</div>`
          : `<div class="yr-empty">No players yet</div>`,
      })}</div>`;

  const featured = shopEnabled && items.length
    ? `<div>${sectionHead("Featured rewards", `<a class="yr-sec-link" href="${shopHref}">Go to rewards ${ICONS.arrow}</a>`)}
<div class="yr-g4">${items.slice().sort((x, z) => Number(x.cost) - Number(z.cost)).slice(0, 4).map((item) => rewardCard({
        item, viewer, balance, blocked: viewerOnSite?.blocked, signIn: `/api/viewer/auth/kick?returnTo=${encodeURIComponent(returnTo)}`,
      })).join("")}</div></div>`
    : "";

  if (emptyBoard) {
    return `${heroHtml}
<div class="yr-empty">This site has no players or rewards yet</div>`;
  }

return `${heroHtml}
${kpis ? `<div class="${kpiGridClass}">${kpis}</div>` : ""}
<div class="yr-g12">${chartOrHow}${rightCol}</div>
${demoGiveaway ? `<div class="yr-g12">${demoGiveawayCard(demoGiveaway)}</div>` : ""}
${featured}`;
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
${panel({ title: "Standings", meta: `<span data-player-count-badge>${formatNumber(playerCount)} players</span>`, body: table, foot: note })}</div>`;
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
    demoAllowed: true,
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
    return `${hero({ eyebrow: "THIS SITE ONLY", title: "Credits", lede: "Sign in to see the balance, credit history and orders tied to this site.", right: `<div class="yr-hero-r">${signInButton(r, returnTo)}</div>` })}
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
    title: "Credits",
    lede: `Signed in as <b>${esc(viewerName(viewer))}</b>. Every credit here came from ${esc(b.name || slug)}'s Kick channel-point rewards. <a class="yr-inline-link" href="/me">View all sites and your account</a>. ${esc(CREDITS_DISCLAIMER)}`,
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
