// ============================================================================
//  YourRank — shared viewer chrome
//
//  One visual system for every viewer-facing surface: creator communities and
//  the global Viewer Account. A dark rail carries identity and destinations; a
//  quiet top bar carries context and the viewer's own controls; content renders
//  on a light canvas of white modules.
//
//  Community pages keep the creator's brand; account pages keep the YourRank
//  brand. The two never mix — a viewer's communities are theirs, a creator's
//  site is the creator's.
// ============================================================================

import { esc } from "./public-render-helpers.js";
import { brandMarkSvg } from "./brand-assets.js";

export const VIEWER_DESIGN_CONTRACT = `<!--
THESIS: A dark creator rail beside a bright work surface makes the community feel like a place, not a page.
OWN-WORLD: Near-black indigo rail, violet destinations, white modules, gold credits, and a live cue that only speaks when the stream is actually live.
STORY: A viewer lands, sees the creator, their own credits, the next reward and the board — then moves between community and account without losing either identity.
FIRST VIEWPORT: Creator identity, the five community destinations, one visible live signal and the viewer's own chip appear before any supporting detail.
FORM: Dark rail + white modules, seeded from the approved viewer mockups; Fira Sans interface, Fira Code data, real records only.
FINISH: Every shipped surface is reviewed at desktop and mobile, documented in DESIGN.md, and held to the shared accessibility and responsive floor.
-->`;

/* ── icons (single 24px stroke set) ─────────────────────────────────── */

const I = 'class="viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
const ICON_PATHS: Record<string, string> = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  activities: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8"/>',
  leaderboard: '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3"/><path d="M7 5H4v2a3 3 0 0 0 3 3"/>',
  gift: '<rect x="3" y="8" width="18" height="12" rx="1.5"/><path d="M12 8v12M3 13h18"/><path d="M12 8s-1.5-4-3.5-4a2 2 0 0 0 0 4z"/><path d="M12 8s1.5-4 3.5-4a2 2 0 0 1 0 4z"/>',
  me: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  games: '<rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 12h3M8.5 10.5v3M15.5 11h.01M17.5 13.5h.01"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16.5 4.7a3.5 3.5 0 0 1 0 6.6M18 14.6c2 .8 3.5 2.9 3.5 5.4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  link: '<path d="M10 14a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 10a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/>',
  bell: '<path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z"/><path d="m9.5 12 2 2 3.5-4"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7" ry="3"/><path d="M5 5.5v13c0 1.7 3.1 3 7 3s7-1.3 7-3v-13"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  logout: '<path d="M9 21H5.5A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3H9"/><path d="M15 16.5 19.5 12 15 7.5M19.5 12H9"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9.4a2.7 2.7 0 0 1 5.3.8c0 1.8-2.7 2.2-2.7 3.8"/><path d="M12 17.6h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  flame: '<path d="M12 3s5.5 4.6 5.5 10a5.5 5.5 0 0 1-11 0c0-2 1-4.3 2-5.5 0 0 .8 2 2 2 0-2.5 1-5 1.5-6.5z"/>',
  coins: '<circle cx="9" cy="9" r="6"/><path d="M15.2 5.4A6 6 0 1 1 5.4 15.2"/><path d="M9 6.5v5M6.5 9h5"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5.5A1.5 1.5 0 0 1 16.5 21h-11A1.5 1.5 0 0 1 4 19.5v-11A1.5 1.5 0 0 1 5.5 7H11"/>',
  play: '<path d="M7 4.5v15l13-7.5z"/>',
  live: '<circle cx="12" cy="12" r="2.4"/><path d="M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8"/><path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  inbox: '<path d="M3 13.5 5.5 5h13L21 13.5V19H3z"/><path d="M3 13.5h5.5a3.5 3.5 0 0 0 7 0H21"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5A1.5 1.5 0 0 1 11 3h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l1 13h9l1-13"/>',
  kick: '<path d="M7 4v16"/><path d="M17 4l-6.5 8L17 20"/>',
  crown: '<path d="m3 8 4 4 5-6 5 6 4-4v9H3z"/><path d="M3 20h18"/>',
  bars: '<path d="M6 20V10"/><path d="M12 20V4"/><path d="M18 20v-8"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
};

export function viewerIcon(name: string) {
  const path = ICON_PATHS[name] || ICON_PATHS.home;
  return `<svg ${I}>${path}</svg>`;
}

/* ── shared pieces ──────────────────────────────────────────────────── */

function avatarMark(name: string, imageUrl = "", cls = "viewer-chip-mark") {
  if (imageUrl) return `<img class="${cls}" src="${esc(imageUrl)}" alt="" width="34" height="34" />`;
  const first = Array.from(String(name || "Y").trim())[0] || "Y";
  return `<span class="${cls}" aria-hidden="true">${esc(first.toUpperCase())}</span>`;
}

function navLinks(links: Array<{ label: string; href: string; active?: boolean; icon?: string }>, cls = "viewer-destinations") {
  return links
    .map((link) => `<a class="viewer-nav-link${link.active ? " is-on" : ""}" href="${esc(link.href)}"${link.active ? ' aria-current="page"' : ""}>${viewerIcon(link.icon || "home")}<span>${esc(link.label)}</span></a>`)
    .join("");
}

/** The viewer's own chip in the top bar: avatar, name, credits on this site. */
function viewerChip({ signedIn, viewerName, viewerAvatarUrl, accountHref, balance, member, creditLabel, signInHtml }: {
  signedIn: boolean; viewerName: string; viewerAvatarUrl?: string; accountHref: string;
  balance?: number | null; member?: boolean; creditLabel?: string; signInHtml?: string;
}) {
  if (!signedIn) return signInHtml || `<a class="viewer-signin" href="${esc(accountHref)}">${viewerIcon("user")}Sign in</a>`;
  const credits = member && typeof balance === "number"
    ? `<span class="viewer-chip-credits" data-credit-balance="${Number(balance) || 0}"><b data-credit-balance-num>${Number(balance || 0).toLocaleString("en-US")}</b> credits<span class="viewer-sr"> ${esc(creditLabel || "on this site")}</span></span>`
    : "";
  return `<a class="viewer-user" href="${esc(accountHref)}">${avatarMark(viewerName, viewerAvatarUrl || "", "viewer-chip-mark")}<span class="viewer-chip-txt"><b data-viewer-chip-name>${esc(viewerName || "Viewer")}</b>${credits}</span>${viewerIcon("down")}</a>`;
}

/* ── community chrome ───────────────────────────────────────────────── */

export function viewerCommunityChrome({
  name = "Community",
  mark = "",
  tagline = "",
  homeHref = "/",
  accountHref = "/me",
  links = [],
  channels = [],
  watchHref = "",
  watchLabel = "",
  kickChannel = "",
  searchHref = "",
  bellHref = "/me/notifications",
  signedIn = false,
  viewerName = "",
  viewerAvatarUrl = "",
  balance = null,
  member = false,
  signInHtml = "",
  dark = false,
}: {
  name?: string; mark?: string; tagline?: string; homeHref?: string; accountHref?: string;
  links?: Array<{ label: string; href: string; active?: boolean; icon?: string }>;
  channels?: Array<{ label: string; href: string; icon?: string }>;
  watchHref?: string; watchLabel?: string; kickChannel?: string;
  searchHref?: string; bellHref?: string;
  signedIn?: boolean; viewerName?: string; viewerAvatarUrl?: string;
  balance?: number | null; member?: boolean; signInHtml?: string;
  dark?: boolean;
}) {
  const statusNote = `<span class="viewer-top-status">${tagline ? esc(tagline) : "Creator community"}</span>${kickChannel ? `<span data-stream-status data-kick-channel="${esc(kickChannel)}" hidden></span>` : ""}`;

  const channelNav = channels.length
    ? `<p class="viewer-rail-caption">Community</p><nav class="viewer-channels" aria-label="Creator channels">${channels
        .map((link) => `<a class="viewer-channel-link" href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${viewerIcon(link.icon || "external")}<span>${esc(link.label)}</span>${viewerIcon("external")}</a>`)
        .join("")}</nav>`
    : "";

  const rail = `<aside class="viewer-rail">
<div class="viewer-rail-top"><a class="viewer-rail-brand" href="${esc(homeHref)}"><span class="viewer-rail-mark">${mark || avatarMark(name)}</span><span class="viewer-rail-name" data-preview-field="f_name">${esc(name)}</span><span class="viewer-live" data-live-badge hidden><span class="viewer-live-dot"></span>LIVE</span></a><button class="viewer-rail-close" type="button" data-nav-close aria-label="Close menu">${viewerIcon("close")}</button></div>
<nav class="viewer-destinations" aria-label="Community">${navLinks(links)}</nav>
${channelNav}
<div class="viewer-rail-foot">
${tagline ? `<p class="viewer-rail-quote">“${esc(tagline)}”<span>— ${esc(name)}</span></p>` : ""}
</div>
</aside>
<div class="viewer-scrim" data-nav-scrim hidden></div>`;

  const topbar = `<header class="viewer-topbar${dark ? " viewer-topbar--dark" : ""}">
<button class="viewer-menu" type="button" data-nav-menu aria-label="Open menu" aria-expanded="false">${viewerIcon("menu")}</button>
<a class="viewer-top-context" href="${esc(homeHref)}"><span class="viewer-top-mark">${mark || avatarMark(name)}</span><span class="viewer-top-txt"><b>${esc(name)}<span class="viewer-top-check">${viewerIcon("check")}</span>${kickChannel ? ` <span class="viewer-live viewer-live--top" data-live-badge hidden><span class="viewer-live-dot"></span>LIVE</span>` : ""}</b>${statusNote}</span></a>
<div class="viewer-top-actions">
${watchHref ? `<a class="viewer-watch" href="${esc(watchHref)}" target="_blank" rel="noopener noreferrer">${viewerIcon("play")}${esc(watchLabel || "Watch Live")}</a>` : ""}
${searchHref ? `<a class="viewer-icon-btn" href="${esc(searchHref)}" aria-label="Search">${viewerIcon("search")}</a>` : ""}
<a class="viewer-icon-btn" href="${esc(bellHref)}" aria-label="Notifications">${viewerIcon("bell")}</a>
${viewerChip({ signedIn, viewerName, viewerAvatarUrl, accountHref, balance, member, creditLabel: `credits in ${name}`, signInHtml })}
</div>
</header>`;

  return { rail, topbar };
}

/* ── global account chrome ──────────────────────────────────────────── */

export const VIEWER_ACCOUNT_NAV = [
  { key: "communities", label: "My communities", href: "/me", icon: "users" },
  { key: "profile", label: "Profile", href: "/me/profile", icon: "user" },
  { key: "connections", label: "Connected accounts", href: "/me/connections", icon: "link" },
  { key: "notifications", label: "Notifications", href: "/me/notifications", icon: "bell" },
  { key: "privacy", label: "Privacy & security", href: "/me/privacy", icon: "shield" },
  { key: "data", label: "Data & account", href: "/me/data", icon: "database" },
];

export function viewerAccountHref(key: string) {
  return (VIEWER_ACCOUNT_NAV.find((item) => item.key === key) || VIEWER_ACCOUNT_NAV[0]).href;
}

export function viewerAccountChrome({
  active = "communities",
  backHref = "",
  backLabel = "",
}: {
  active?: string; backHref?: string; backLabel?: string;
}) {
  const mainLink = VIEWER_ACCOUNT_NAV[0];
  const settings = VIEWER_ACCOUNT_NAV.slice(1);
  const rail = `<aside class="viewer-rail viewer-rail--account">
<div class="viewer-rail-top"><a class="viewer-rail-brand viewer-rail-brand--yr" href="${esc(mainLink.href)}"><span class="viewer-rail-mark viewer-rail-mark--yr">${brandMarkSvg({ className: "viewer-yr-mark" })}</span><span class="viewer-rail-name">YourRank</span></a><button class="viewer-rail-close" type="button" data-nav-close aria-label="Close menu">${viewerIcon("close")}</button></div>
<nav class="viewer-destinations" aria-label="Viewer account">
<a class="viewer-nav-link viewer-nav-back${active === "communities" ? " is-on" : ""}" href="${esc(backHref || mainLink.href)}"${active === "communities" ? ' aria-current="page"' : ""}>${viewerIcon("back")}<span>${esc(backLabel || "My communities")}</span></a>
<p class="viewer-rail-caption">Account</p>
${navLinks(settings.map((item) => ({ ...item, active: item.key === active })), "")}
</nav>
<div class="viewer-rail-foot">
<button class="viewer-logout" type="button" data-viewer-logout>${viewerIcon("logout")}<span>Log out</span></button>
</div>
</aside>
<div class="viewer-scrim" data-nav-scrim hidden></div>`;

  const topbar = `<header class="viewer-topbar viewer-topbar--account">
<button class="viewer-menu" type="button" data-nav-menu aria-label="Open menu" aria-expanded="false">${viewerIcon("menu")}</button>
<div class="viewer-top-actions">
<a class="viewer-icon-btn" href="${esc(viewerAccountHref("notifications"))}" aria-label="Notifications">${viewerIcon("bell")}</a>
<a class="viewer-user" href="${esc(viewerAccountHref("profile"))}" data-viewer-chip><span class="viewer-chip-mark" data-viewer-chip-mark aria-hidden="true">V</span><span class="viewer-chip-txt"><b data-viewer-chip-name>Account</b></span>${viewerIcon("down")}</a>
</div>
</header>`;

  return { rail, topbar };
}

/* ── viewer help return links ───────────────────────────────────────── */

const VIEWER_RETURN_PATTERN = /^\/(?:me(?:\/[a-z-]+)?|[a-z0-9][a-z0-9_-]{0,62}(?:\/(?:me|shop|leaderboard|contact|activities))?)$/;
const VIEWER_RESERVED_PATTERN = /^\/(?:dashboard|admin|auth|api|help|login|logout)(?:\/|$)/;
const VIEWER_RETURN_TABS = new Set(["support", "feedback", "help"]);

export function resolveViewerHelp(url: URL): { returnTo: string } | null {
  if (url.searchParams.get("audience") !== "viewer") return null;
  const raw = String(url.searchParams.get("return") || "/me");
  let returnTo = "/me";
  try {
    const target = new URL(raw, "https://yourrank.site");
    if (VIEWER_RETURN_PATTERN.test(target.pathname) && !VIEWER_RESERVED_PATTERN.test(target.pathname)) {
      returnTo = target.pathname + (target.search || "") + (target.hash || "");
    }
  } catch {
    returnTo = "/me";
  }
  return { returnTo };
}

export function viewerHelpHref(returnTo: string, origin = "", tab = "support") {
  const safeTab = VIEWER_RETURN_TABS.has(tab) ? tab : "support";
  const base = `${origin}/help/${safeTab}`;
  return `${base}?${new URLSearchParams({ audience: "viewer", return: returnTo || "/me" })}`;
}
