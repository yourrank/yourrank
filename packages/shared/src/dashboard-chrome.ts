// ============================================================================
//  YourRank — SHARED DASHBOARD CHROME (rail + topbar)
//
//  The signed-in shell used to exist twice: the leaderboard Worker rendered a
//  `.lb-side` rail with JSX, and the bot Worker rendered its own `.side` rail
//  with different CSS, so /bot/* looked like a different (older) product. Both
//  now render this markup, styled by /assets/dashboard-v4.css.
// ============================================================================

import { profileMenuHtml, type ShellUser } from "./shell-nav.js";
import { brandMarkSvg } from "./brand-assets.js";

const DESIGN_CONTRACT = `<!--
THESIS: A creator run-sheet workspace turns dashboard state into the next clear action; it refuses the generic dark tile wall.
OWN-WORLD: Cool-gray canvas, white 12-column modules, deep-navy production rail, cobalt actions, and narrow status cue bands.
STORY: A non-technical streamer sees what is live, what needs attention, acts immediately, and can reach every feature from one rail.
FIRST VIEWPORT: Fixed branded rail at left; operational topbar above a status cue, three KPIs, and an asymmetric activity workspace; primary action sits beside the page title.
FORM: Creator Run-Sheet workspace, selected direction, seed 562938e8.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`;

const MENU_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const COLLAPSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';

export interface NavLinkItem {
  key: string;
  label: string;
  href: string;
  /** Inner SVG path markup for the section row. */
  icon?: string | null;
  productKey?: string;
}

export interface NavGroupItem {
  key: string;
  label: string;
  kind: "group";
  children: NavLinkItem[];
}

export type NavItem = NavLinkItem | NavGroupItem;

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string)
  );
}

function normalizedPath(path: string): string {
  const raw = String(path || "").split("?")[0].replace(/\/+$/, "");
  return raw || "/";
}

export function navIconHtml(path?: string | null): string {
  if (!path) return "";
  return `<span class="lb-nav-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg></span>`;
}

export function navListHtml(
  items: NavItem[],
  active: string,
  label = "Dashboard"
): string {
  const linkHtml = (item: NavLinkItem, nested = false) => {
    const isActive = item.key === active;
    const product = item.productKey ? ` data-product-link="${esc(item.productKey)}"` : "";
    const cls = `lb-nav${nested ? " lb-nav-child" : ""}${isActive ? " is-on" : ""}`;
    return `<a class="${cls}" href="${esc(item.href)}" data-nav="${esc(item.key)}"` +
      `${product}${isActive ? ' aria-current="page"' : ""} title="${esc(item.label)}">${navIconHtml(item.icon)}${esc(item.label)}</a>`;
  };
  const links = items.map((item) => {
    if ("kind" in item && item.kind === "group") {
      const groupId = `lb-nav-group-${item.key}`;
      return `<div class="lb-nav-group" role="group" aria-labelledby="${esc(groupId)}"><div class="lb-nav-group-label" id="${esc(groupId)}">${esc(item.label)}</div><div class="lb-nav-group-items">${item.children.map((child) => linkHtml(child, true)).join("")}</div></div>`;
    }
    return linkHtml(item as NavLinkItem);
  }).join("");
  return `<nav class="lb-side-group lb-side-nav" data-area="all" aria-label="${esc(label)}">${links}</nav>`;
}

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Leaf pages get an explicit path back up: the rail shows where you are, but
 * only within one product area, and several screens (board settings, credit
 * tabs, Telegram pages) are two levels deep.
 */
export function crumbsHtml(trail: Crumb[], activePath = ""): string {
  // Top-level dashboard pages intentionally omit breadcrumbs; tab pages provide the two-item trail.
  if (!trail || trail.length < 2) return "";
  const active = normalizedPath(activePath);
  const parts = trail.map((c, i) => {
    const last = i === trail.length - 1;
    const current = Boolean(c.href && normalizedPath(c.href) === active);
    const item = last || !c.href || current
      ? `<span${last ? ' aria-current="page"' : ""}>${esc(c.label)}</span>`
      : `<a href="${esc(c.href)}">${esc(c.label)}</a>`;
    return i === 0 ? item : `<span class="v3-crumb-sep" aria-hidden="true">/</span>${item}`;
  }).join("");
  return `<nav class="v3-crumbs" aria-label="Breadcrumb">${parts}</nav>`;
}

export interface ChromeOpts {
  /** Rail contents, in order. */
  nav: NavItem[];
  active: string;
  navLabel?: string;
  /** Override the shell root identity for callers with a distinct document. */
  rootId?: string;
  rootHidden?: boolean;
  identity?: string;
  /** Rail header: label above a name (e.g. "Telegram" / the streamer). */
  headLabel?: string;
  headName?: string;
  headMeta?: string;
  railHeadHtml?: string;
  sideLabel?: string;
  /** Context markup rendered between the menu button and topbar actions. */
  topbarContextHtml?: string;
  topbarHtml?: string;
  title?: string;
  titleId?: string;
  subtitle?: string;
  subtitleId?: string;
  crumbs?: Crumb[];
  user?: ShellUser;
  activePath?: string;
  logoutAction?: string;
  /** Extra markup for the rail footer (e.g. a log out button). */
  footHtml?: string;
  /** Move account controls to the bottom of the rail instead of the topbar. */
  railProfile?: boolean;
  /** Enable the persisted desktop rail-collapse control. */
  collapsible?: boolean;
  /** The surrounding document already provides the main landmark. */
  embeddedInMain?: boolean;
  /** Render crumbs and content directly inside the bento without a stack. */
  directContent?: boolean;
  contentId?: string;
  overlaysHtml?: string;
  /** Add profile-name hooks used by the browser shell's identity updater. */
  dynamicIdentity?: boolean;
  content: string;
}

/**
 * The whole signed-in shell as a string, for Workers that render HTML without
 * JSX (the bot). The leaderboard's `DashboardShell` renders the same rail and
 * topbar from `navListHtml` / `profileMenuHtml`.
 */
export function dashboardChromeHtml(opts: ChromeOpts): string {
  const profile = profileMenuHtml({
    activePath: opts.activePath || "/dashboard",
    user: opts.user,
    logoutAction: opts.logoutAction,
    standalone: true,
    dynamicIdentity: opts.dynamicIdentity,
  });
  const head = opts.railHeadHtml || (opts.headLabel || opts.headName
    ? `<div class="lb-side-head"><span class="label">${esc(opts.headLabel || "")}</span>` +
      `<div class="lb-active-name">${esc(opts.headName || "")}</div>` +
      (opts.headMeta ? `<div class="lb-active-meta">${esc(opts.headMeta)}</div>` : "") +
      `</div>`
    : "");
  const crumbs = crumbsHtml(opts.crumbs || [], opts.activePath);
  const title = opts.title
    ? `<div class="v3-head">${crumbs}<h1${opts.titleId ? ` id="${esc(opts.titleId)}"` : ""}>${esc(opts.title)}</h1>` +
      (opts.subtitle ? `<p class="v3-head-sub"${opts.subtitleId ? ` id="${esc(opts.subtitleId)}"` : ""}>${esc(opts.subtitle)}</p>` : "") +
      `</div>`
    : "";
  const sideProfile = opts.railProfile ? `<div class="lb-side-profile">${profile}</div>` : "";
  const topProfile = opts.railProfile ? "" : `<div class="gm-profile-host">${profile}</div>`;
  const contentId = opts.contentId || (opts.embeddedInMain ? "workspace-content" : "main-content");
  const contentOpen = opts.embeddedInMain
    ? `<div class="lb-bento" id="${esc(contentId)}">`
    : `<main class="lb-bento" id="${esc(contentId)}">`;
  const contentClose = opts.embeddedInMain ? "</div>" : "</main>";
  const shellNewline = opts.directContent ? "" : "\n";
  const collapseIcon = opts.directContent
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>'
    : COLLAPSE_ICON;
  const closeIcon = opts.directContent
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>'
    : CLOSE_ICON;
  const menuIcon = opts.directContent
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>'
    : MENU_ICON;
  const collapseAttribute = opts.directContent ? "data-collapse-side=\"true\"" : "data-collapse-side";
  const contentBody = opts.directContent
    ? `${crumbs}${opts.content}`
    : `<div class="v3-stack">\n${title}\n${opts.content}\n</div>`;
  const topbarContext = opts.topbarContextHtml
    ? `${opts.directContent ? "" : "\n"}${opts.topbarContextHtml}`
    : "";
  const overlaysHtml = opts.overlaysHtml
    ? `${opts.directContent ? "" : "\n"}${opts.overlaysHtml}`
    : "";
  const rootId = opts.rootId || "dash";
  const rootIdentity = opts.identity ? ` data-identity="${esc(opts.identity)}"` : "";
  const rootHidden = opts.rootHidden ? ' hidden=""' : "";
  const sideLabel = opts.sideLabel || `${opts.navLabel || "Dashboard"} sections`;
  // The workspace attribute is inherent to this shell: every stylesheet rule for
  // the rail, topbar and bento is scoped to `.v3-dash[data-auth-workspace]`, so
  // rendering it without the attribute produces unstyled workspace markup.
  const collapse = opts.collapsible
    ? `<button class="lb-side-collapse" type="button" aria-label="Collapse navigation" aria-pressed="false" aria-controls="lbSide" ${collapseAttribute}>${collapseIcon}</button>`
    : "";
  return `<div class="v3-dash" id="${esc(rootId)}" data-auth-workspace="true"${rootIdentity} data-shell-drawer="shared"${rootHidden}>${shellNewline}${DESIGN_CONTRACT}${shellNewline}<div class="toast" id="status" role="status" aria-live="polite"></div>${shellNewline}<div class="lb-shell">${shellNewline}<aside class="lb-side" id="lbSide" aria-label="${esc(sideLabel)}">${shellNewline}<div class="lb-side-brandrow">${shellNewline}<a class="lb-side-brand" href="/dashboard" aria-label="YourRank dashboard"><span class="lb-brand-mark">${brandMarkSvg()}</span><span class="lb-side-brandcopy"><b>YourRank</b><small>Creator workspace</small></span></a>${shellNewline}${collapse}${shellNewline}<button class="lb-side-close" type="button" aria-label="Close navigation" data-close-side="true">${closeIcon}</button>${shellNewline}</div>${shellNewline}${head}${shellNewline}${navListHtml(opts.nav, opts.active, opts.navLabel || "Dashboard")}${shellNewline}${opts.footHtml ? `<div class="lb-side-foot">${opts.footHtml}</div>` : ""}${shellNewline}${sideProfile}${shellNewline}</aside>${shellNewline}<div class="lb-main">${shellNewline}<header class="lb-topbar" id="lbTopbar">${shellNewline}<button class="lb-menu lb-topbar-menu" id="lbMenu" type="button" aria-label="Show sections" aria-expanded="false" aria-controls="lbSide">${menuIcon}</button>${shellNewline}${opts.railProfile ? "" : `<a class="lb-brand" href="/dashboard" aria-label="YourRank dashboard"><span class="lb-brand-mark">${brandMarkSvg()}</span><span class="lb-brand-txt">YourRank</span></a>`}${topbarContext}${shellNewline}<div class="lb-topbar-actions">${opts.topbarHtml || topProfile}</div>${shellNewline}</header>${shellNewline}${contentOpen}${shellNewline}${contentBody}${shellNewline}${contentClose}${overlaysHtml}${shellNewline}</div>${shellNewline}</div>${shellNewline}</div>`;
}
