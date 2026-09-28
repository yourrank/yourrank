// Shared dashboard UI primitives. Both Workers render page-level building
// blocks from here so a page header, tab strip, status badge, action button,
// state block, list shell, drawer shell or scope indicator has exactly one
// markup shape. Feature pages own their content; this module owns the frame.
//
// Everything is a pure HTML-string renderer: JSX pages splice the result with
// `dangerouslySetInnerHTML`, TypeScript Workers concatenate it, and the client
// bundle can hydrate against the same class names. Nothing here knows about
// data, counts or feature state — callers pass the values they already have.

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string)
  );
}

const esc = escapeHtml;

function attrs(extra: Record<string, string | number | boolean | null | undefined> | undefined): string {
  if (!extra) return "";
  return Object.entries(extra).map(([name, value]) => {
    if (value === false || value === null || value === undefined) return "";
    if (value === true) return ` ${esc(name)}`;
    return ` ${esc(name)}="${esc(value)}"`;
  }).join("");
}

function classes(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Actions

export type ActionVariant = "primary" | "secondary" | "destructive";
export type ActionSize = "md" | "sm" | "xs";

export interface ActionSpec {
  label: string;
  variant?: ActionVariant;
  size?: ActionSize;
  href?: string;
  id?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  /** Extra attributes (data-*, aria-*), escaped. */
  attrs?: Record<string, string | number | boolean | null | undefined>;
}

const ACTION_VARIANT_CLASS: Record<ActionVariant, string> = {
  primary: "v3-btn--accent",
  secondary: "",
  destructive: "v3-btn--danger",
};

const ACTION_SIZE_CLASS: Record<ActionSize, string> = { md: "", sm: "v3-btn--sm", xs: "v3-btn--xs" };

export function actionClass(variant: ActionVariant = "secondary", size: ActionSize = "md"): string {
  return classes("v3-btn", ACTION_VARIANT_CLASS[variant], ACTION_SIZE_CLASS[size]);
}

export function actionHtml(spec: ActionSpec): string {
  const cls = actionClass(spec.variant, spec.size);
  const id = spec.id ? ` id="${esc(spec.id)}"` : "";
  const extra = attrs(spec.attrs);
  if (spec.href && !spec.disabled) {
    return `<a class="${cls}" href="${esc(spec.href)}"${id}${extra}>${esc(spec.label)}</a>`;
  }
  return `<button class="${cls}" type="${spec.type || "button"}"${id}${spec.disabled ? " disabled" : ""}${extra}>${esc(spec.label)}</button>`;
}

export function actionsHtml(actions: ActionSpec[] = [], className = "v3-actions"): string {
  if (!actions.length) return "";
  return `<div class="${esc(className)}">${actions.map(actionHtml).join("")}</div>`;
}

// ---------------------------------------------------------------------------
// Scope indicator

export type ScopeKind = "account" | "site" | "bot";

export interface ScopeSpec {
  kind: ScopeKind;
  /** Name of the selected site or bot; omitted for account-wide scope. */
  name?: string | null;
  id?: string;
}

export const SCOPE_LABELS: Readonly<Record<ScopeKind, string>> = Object.freeze({
  account: "Account-wide",
  site: "Current site",
  bot: "Current bot",
});

export function scopeIndicatorHtml({ kind, name, id }: ScopeSpec): string {
  const label = SCOPE_LABELS[kind];
  const value = name ? `<span class="v3-scope-name">${esc(name)}</span>` : "";
  return `<span class="v3-scope" data-scope="${esc(kind)}"${id ? ` id="${esc(id)}"` : ""}>` +
    `<span class="v3-scope-dot" aria-hidden="true"></span>` +
    `<span class="v3-scope-label">${esc(label)}</span>${value}</span>`;
}

// ---------------------------------------------------------------------------
// Status badge

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

export interface BadgeSpec {
  label: string;
  tone?: BadgeTone;
  /** Machine-readable status value, exposed as data-status for client updates. */
  status?: string;
  id?: string;
  live?: boolean;
}

export function statusBadgeHtml({ label, tone = "neutral", status, id, live }: BadgeSpec): string {
  return `<span class="v3-badge" data-tone="${esc(tone)}"${status ? ` data-status="${esc(status)}"` : ""}` +
    `${id ? ` id="${esc(id)}"` : ""}${live ? ' role="status" aria-live="polite"' : ""}>` +
    `<span class="v3-badge-dot" aria-hidden="true"></span>${esc(label)}</span>`;
}

// ---------------------------------------------------------------------------
// Page header

export interface PageHeaderSpec {
  title: string;
  kicker?: string;
  description?: string;
  scope?: ScopeSpec;
  badge?: BadgeSpec;
  actions?: ActionSpec[];
  /** Extra attributes on the <h1> (e.g. data-chrome-h1). */
  titleAttrs?: Record<string, string | number | boolean | null | undefined>;
  attrs?: Record<string, string | number | boolean | null | undefined>;
}

export function pageHeaderHtml(spec: PageHeaderSpec): string {
  const kicker = spec.kicker ? `<p class="v3-head-kicker">${esc(spec.kicker)}</p>` : "";
  const meta = spec.scope || spec.badge
    ? `<div class="v3-head-meta">${spec.scope ? scopeIndicatorHtml(spec.scope) : ""}${spec.badge ? statusBadgeHtml(spec.badge) : ""}</div>`
    : "";
  const sub = spec.description ? `<p class="v3-head-sub">${esc(spec.description)}</p>` : "";
  const actions = actionsHtml(spec.actions, "v3-head-actions");
  return `<header class="${classes("v3-head", actions && "v3-head--row")}"${attrs(spec.attrs)}>` +
    `<div class="v3-head-col">${kicker}<h1${attrs(spec.titleAttrs)}>${esc(spec.title)}</h1>${meta}${sub}</div>${actions}</header>`;
}

// ---------------------------------------------------------------------------
// Tab / sub-navigation

export interface SubnavItem {
  key: string;
  label: string;
  href: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
}

export interface SubnavSpec {
  items: SubnavItem[];
  active: string;
  /** Accessible name of the strip, e.g. "Giveaways". */
  label: string;
  className?: string;
  /** Render as a `tablist` (in-page panels) instead of route navigation. */
  tablist?: boolean;
  attrs?: Record<string, string | number | boolean | null | undefined>;
}

export function subnavHtml({ items, active, label, className, tablist, attrs: extra }: SubnavSpec): string {
  const links = items.map((item) => {
    const on = item.key === active;
    const a11y = tablist
      ? ` role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}"`
      : "";
    return `<a class="${classes("v3-tab", on && "is-on")}" href="${esc(item.href)}"` +
      `${on ? ' aria-current="page"' : ""} data-subnav="${esc(item.key)}"${a11y}${attrs(item.attrs)}>${esc(item.label)}</a>`;
  }).join("");
  return `<nav class="${classes("v3-tabs", className)}" aria-label="${esc(label)}"` +
    `${tablist ? ' role="tablist"' : ""} data-subnav-strip${attrs(extra)}>${links}</nav>`;
}

// ---------------------------------------------------------------------------
// States: empty / loading / error

export interface StateSpec {
  title: string;
  body?: string;
  actions?: ActionSpec[];
  /** Inline SVG markup for the icon; escaped text is not accepted here. */
  iconSvg?: string;
  id?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
}

export function emptyStateHtml(spec: StateSpec): string {
  const icon = spec.iconSvg ? `<span class="v3-empty-ic">${spec.iconSvg}</span>` : "";
  return `<div class="v3-empty" data-state="empty"${spec.id ? ` id="${esc(spec.id)}"` : ""}${attrs(spec.attrs)}>` +
    `${icon}<h2>${esc(spec.title)}</h2>${spec.body ? `<p>${esc(spec.body)}</p>` : ""}${actionsHtml(spec.actions, "v3-empty-actions")}</div>`;
}

export function errorStateHtml(spec: StateSpec): string {
  return `<div class="v3-empty v3-empty--error" data-state="error" role="alert"${spec.id ? ` id="${esc(spec.id)}"` : ""}${attrs(spec.attrs)}>` +
    `<h2>${esc(spec.title)}</h2>${spec.body ? `<p>${esc(spec.body)}</p>` : ""}${actionsHtml(spec.actions, "v3-empty-actions")}</div>`;
}

export interface LoadingSpec {
  label: string;
  /** Skeleton rows to draw; 0 draws a spinner only. */
  lines?: number;
  id?: string;
  hidden?: boolean;
}

export function loadingStateHtml({ label, lines = 3, id, hidden }: LoadingSpec): string {
  const rows = Array.from({ length: Math.max(0, lines) }, () => '<span class="v3-skeleton-line" aria-hidden="true"></span>').join("");
  return `<div class="v3-loading" data-state="loading" role="status" aria-live="polite" aria-busy="true"${id ? ` id="${esc(id)}"` : ""}${hidden ? " hidden" : ""}>` +
    `${rows || '<span class="ui-loading__spinner" aria-hidden="true"></span>'}<span class="sr-only">${esc(label)}</span></div>`;
}

// ---------------------------------------------------------------------------
// Table / list shell

export interface ListShellSpec {
  /** Accessible name for the region. */
  label: string;
  /** Optional heading rendered in the shell head. */
  title?: string;
  description?: string;
  actions?: ActionSpec[];
  /** Pre-rendered body (a <table>, <ul>, or feature markup). */
  body: string;
  /** Pre-rendered footer (pagination, totals). */
  footer?: string;
  /**
   * Containment. `"none"` (default) is layout-neutral so lists can sit
   * directly in the page; `"card"` adds the bordered `v3-table-card` surface.
   */
  surface?: ListShellSurface;
  id?: string;
  className?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
}

export type ListShellSurface = "none" | "card";

const LIST_SHELL_SURFACE_CLASS: Record<ListShellSurface, string> = { none: "", card: "v3-table-card v3-list-shell--card" };

export function listShellHtml(spec: ListShellSpec): string {
  const heading = spec.title || spec.description || spec.actions?.length
    ? `<div class="v3-list-shell-head">` +
      `<div class="v3-list-shell-copy">${spec.title ? `<h2>${esc(spec.title)}</h2>` : ""}${spec.description ? `<p>${esc(spec.description)}</p>` : ""}</div>` +
      `${actionsHtml(spec.actions, "v3-list-shell-actions")}</div>`
    : "";
  const footer = spec.footer ? `<div class="v3-list-shell-foot">${spec.footer}</div>` : "";
  const surface = LIST_SHELL_SURFACE_CLASS[spec.surface ?? "none"];
  return `<section class="${classes("v3-list-shell", surface, spec.className)}" aria-label="${esc(spec.label)}"` +
    `${spec.id ? ` id="${esc(spec.id)}"` : ""}${attrs(spec.attrs)}>${heading}<div class="v3-list-shell-body">${spec.body}</div>${footer}</section>`;
}

// ---------------------------------------------------------------------------
// Drawer / form shell

export interface DrawerShellSpec {
  id: string;
  title: string;
  description?: string;
  /** Pre-rendered body: form fields, detail sections. */
  body: string;
  /** Footer actions; primary last. */
  actions?: ActionSpec[];
  /** Pre-rendered footer, used instead of `actions` when the feature owns it. */
  footer?: string;
  /** Wrap the body in a <form> with these attributes. */
  form?: Record<string, string | number | boolean | null | undefined>;
  closeLabel?: string;
  hidden?: boolean;
  /** Desktop panel width; mobile is always full-width. Defaults to `"default"`. */
  size?: DrawerSize;
  className?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
}

export type DrawerSize = "compact" | "default" | "wide";

const DRAWER_SIZE_CLASS: Record<DrawerSize, string> = { compact: "v3-drawer--compact", default: "", wide: "v3-drawer--wide" };

export function drawerShellHtml(spec: DrawerShellSpec): string {
  const titleId = `${spec.id}-title`;
  const descId = spec.description ? `${spec.id}-desc` : "";
  const footerInner = spec.footer ?? actionsHtml(spec.actions, "v3-drawer-actions");
  const footer = footerInner ? `<footer class="v3-drawer-foot">${footerInner}</footer>` : "";
  const inner = `<div class="v3-drawer-body">${spec.body}</div>${footer}`;
  const content = spec.form ? `<form class="v3-drawer-form"${attrs(spec.form)}>${inner}</form>` : inner;
  const size = spec.size ?? "default";
  return `<div class="${classes("v3-drawer", DRAWER_SIZE_CLASS[size], spec.className)}" id="${esc(spec.id)}" data-drawer data-drawer-size="${size}"${spec.hidden ? " hidden" : ""}${attrs(spec.attrs)}>` +
    `<div class="v3-drawer-backdrop" data-drawer-close></div>` +
    `<aside class="v3-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="${esc(titleId)}"${descId ? ` aria-describedby="${esc(descId)}"` : ""}>` +
    `<header class="v3-drawer-head"><div class="v3-drawer-copy"><h2 id="${esc(titleId)}">${esc(spec.title)}</h2>` +
    `${spec.description ? `<p id="${esc(descId)}">${esc(spec.description)}</p>` : ""}</div>` +
    `<button class="v3-drawer-close" type="button" data-drawer-close aria-label="${esc(spec.closeLabel || "Close")}">` +
    `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header>` +
    `${content}</aside></div>`;
}
