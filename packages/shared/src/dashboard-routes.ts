// Canonical dashboard route manifest (Wave 2 PR-1).
//
// This file is the single editable source of dashboard ROUTE SEMANTICS:
// stable route identity, canonical pathnames, section/tab structure, Worker
// ownership, delivery mechanism, scope, navigation-state query parameters and
// legacy aliases. Presentation (labels, icons, rail order) stays in
// dashboard-nav.ts; Wrangler route patterns stay deployment infrastructure in
// each Worker's wrangler.toml (parity-tested, never generated from here).
//
// PR-1 is a pure addition: no runtime consumer imports this module yet. The
// current runtime sources (apps/leaderboard/src/assets/dashboard/routes.js,
// apps/leaderboard/src/index.js redirects, apps/leaderboard/src/
// telegram-routes.js, apps/bot dashboard routes) remain authoritative until
// later PRs derive them from this manifest. Parity tests pin this manifest to
// the current behavior of those sources.
//
// Browser/server consumption decision (Correction 1): Option A — the built
// shared package already exposes browser-safe ESM. This module compiles to
// dist/dashboard-routes.js; Workers import "@yourrank/shared/dashboard-routes"
// directly, and the browser dashboard bundle gets it exactly the way it gets
// "@yourrank/shared/dashboard-nav" today: apps/leaderboard/build-assets.js
// runs esbuild over dashboard assets and inlines the shared dist module into
// the generated asset bundle. No hand-written JS/JSON copy, no second
// editable registry, no generated artifact to drift.
//
// Route identity: `id` values are stable names chosen for the destination's
// meaning, NOT derived from the pathname. If a canonical path is renamed
// later, the id does not change; the old path becomes an alias.

/** Worker that serves a dashboard destination (per wrangler.toml routes). */
export type DashboardWorker = "leaderboard" | "bot";

/**
 * How the destination's content is delivered today:
 * - "spa-section": core SPA section rendered client-side inside the
 *   persistent shell (single dashboard document; shell reads the path).
 * - "fragment": fragment-booted section — a full document on direct load,
 *   and JSON HTML via /dashboard/_content when navigated to inside the SPA.
 * - "worker-document": a standalone document served by its Worker on every
 *   navigation (the Telegram dashboard).
 */
export type DashboardDelivery = "spa-section" | "fragment" | "worker-document";

/** Whether the destination's data is keyed by the selected site or by the account. */
export type DashboardScope = "site" | "account";

/**
 * The navigation-state query parameter that carries site context to the
 * destination, when one applies. The current app uses two spellings for the
 * same navigation state (see QUERY_PARAM_AUDIT): `board` on core SPA
 * destinations and `siteId` on fragment-booted destinations.
 */
export type SiteContextParam = "board" | "siteId";

export interface DashboardRouteDef {
  /** Stable route identity. Never derived from the pathname. */
  readonly id: string;
  /** Canonical pathname (no query, no trailing slash). */
  readonly canonicalPath: string;
  /** Structural section the destination belongs to. */
  readonly section: string;
  /** Tab within the section, when the destination is a tab. */
  readonly tab?: string;
  /** Rail owner key (matches NAV_OWNER_MAP owner values in dashboard-nav.ts). */
  readonly navKey: string;
  /** Worker that serves the canonical path (parity-tested against wrangler.toml). */
  readonly owner: DashboardWorker;
  readonly delivery: DashboardDelivery;
  readonly scope: DashboardScope;
  /**
   * Navigation-state query parameters this destination consumes. Only
   * parameters classified as navigation state in QUERY_PARAM_AUDIT may
   * appear here.
   */
  readonly navParams: readonly SiteContextParam[];
}

/**
 * A legacy address for a route.
 * - "redirect": the Worker answers with a 3xx to the canonical path.
 * - "rewrite": the Worker serves the destination at the legacy path without
 *   redirecting (SECTION_ALIASES heads resolved by parseDashboardPath, the
 *   /dashboard/settings root document, /dashboard.html).
 */
export interface DashboardRouteAlias {
  readonly path: string;
  readonly routeId: string;
  readonly kind: "redirect" | "rewrite";
  /**
   * Worker that serves the alias path when it differs from the target
   * route's owner (per wrangler.toml patterns). Defaults to the target
   * route's owner.
   */
  readonly servedBy?: DashboardWorker;
}

const route = (def: DashboardRouteDef): DashboardRouteDef => def;

export const DASHBOARD_ROUTES: readonly DashboardRouteDef[] = [
  // ── Core SPA sections (leaderboard Worker, client-rendered in the shell) ──
  route({ id: "home", canonicalPath: "/dashboard", section: "home", navKey: "home", owner: "leaderboard", delivery: "spa-section", scope: "account", navParams: ["board"] }),
  route({ id: "board", canonicalPath: "/dashboard/leaderboard", section: "board", navKey: "board", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] }),
  route({ id: "board.setup", canonicalPath: "/dashboard/leaderboard/setup", section: "board", tab: "setup", navKey: "board", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] }),
  route({ id: "board.players", canonicalPath: "/dashboard/leaderboard/players", section: "board", tab: "players", navKey: "board", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] }),
  route({ id: "board.design", canonicalPath: "/dashboard/leaderboard/design", section: "board", tab: "design", navKey: "board", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] }),
  route({ id: "board.share", canonicalPath: "/dashboard/leaderboard/share", section: "board", tab: "share", navKey: "board", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] }),
  route({ id: "board.history", canonicalPath: "/dashboard/leaderboard/history", section: "board", tab: "history", navKey: "board", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] }),
  route({ id: "boards", canonicalPath: "/dashboard/leaderboards", section: "boards", navKey: "sites", owner: "leaderboard", delivery: "spa-section", scope: "account", navParams: ["board"] }),
  route({ id: "games", canonicalPath: "/dashboard/games", section: "games", navKey: "games", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] }),
  route({ id: "performance", canonicalPath: "/dashboard/analytics", section: "performance", navKey: "performance", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: [] }),
  route({ id: "performance.activity", canonicalPath: "/dashboard/analytics/activity", section: "performance", tab: "activity", navKey: "performance", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] }),
  route({ id: "performance.referrals", canonicalPath: "/dashboard/analytics/referrals", section: "performance", tab: "referrals", navKey: "performance", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: [] }),
  route({ id: "performance.events", canonicalPath: "/dashboard/analytics/events", section: "performance", tab: "events", navKey: "performance", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: [] }),
  route({ id: "site", canonicalPath: "/dashboard/site", section: "site", navKey: "site", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] }),

  // ── Fragment-booted sections (leaderboard Worker) ──
  route({ id: "rewards.overview", canonicalPath: "/dashboard/rewards", section: "rewards", tab: "overview", navKey: "redemptions", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] }),
  route({ id: "rewards.shop", canonicalPath: "/dashboard/rewards/shop", section: "rewards", tab: "shop", navKey: "redemptions", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] }),
  route({ id: "rewards.rules", canonicalPath: "/dashboard/rewards/rules", section: "rewards", tab: "rules", navKey: "redemptions", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] }),
  route({ id: "rewards.redemptions", canonicalPath: "/dashboard/rewards/redemptions", section: "rewards", tab: "redemptions", navKey: "redemptions", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] }),
  route({ id: "rewards.history", canonicalPath: "/dashboard/rewards/activity", section: "rewards", tab: "history", navKey: "redemptions", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] }),
  route({ id: "siteConnections.channel", canonicalPath: "/dashboard/site/connections", section: "siteConnections", tab: "channel", navKey: "site", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] }),
  route({ id: "giveaways.chat", canonicalPath: "/dashboard/giveaways/chat", section: "giveaways", tab: "chat", navKey: "engage", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] }),
  route({ id: "giveaways.raffles", canonicalPath: "/dashboard/giveaways/raffles", section: "giveaways", tab: "raffles", navKey: "engage", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] }),
  route({ id: "giveaways.drops", canonicalPath: "/dashboard/giveaways/drops", section: "giveaways", tab: "drops", navKey: "engage", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] }),
  route({ id: "giveaways.preds", canonicalPath: "/dashboard/giveaways/predictions", section: "giveaways", tab: "preds", navKey: "engage", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] }),
  route({ id: "giveaways.tournaments", canonicalPath: "/dashboard/giveaways/tournaments", section: "giveaways", tab: "tournaments", navKey: "engage", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] }),
  route({ id: "audience.viewers", canonicalPath: "/dashboard/audience/members", section: "audience", tab: "viewers", navKey: "audience", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] }),
  route({ id: "settings.account", canonicalPath: "/dashboard/settings/account", section: "settings", tab: "account", navKey: "settings", owner: "leaderboard", delivery: "fragment", scope: "account", navParams: [] }),
  route({ id: "settings.team", canonicalPath: "/dashboard/settings/team", section: "settings", tab: "team", navKey: "settings", owner: "leaderboard", delivery: "fragment", scope: "account", navParams: [] }),
  route({ id: "settings.plan", canonicalPath: "/dashboard/settings/billing", section: "settings", tab: "plan", navKey: "settings", owner: "leaderboard", delivery: "fragment", scope: "account", navParams: [] }),
  route({ id: "settings.connections", canonicalPath: "/dashboard/settings/connections", section: "settings", tab: "connections", navKey: "settings", owner: "leaderboard", delivery: "fragment", scope: "account", navParams: [] }),
  route({ id: "settings.data", canonicalPath: "/dashboard/settings/data", section: "settings", tab: "data", navKey: "settings", owner: "leaderboard", delivery: "fragment", scope: "account", navParams: [] }),

  // ── Telegram dashboard (bot Worker) ──
  route({ id: "telegram", canonicalPath: "/dashboard/telegram", section: "telegram", navKey: "telegram", owner: "bot", delivery: "worker-document", scope: "account", navParams: [] }),
  route({ id: "telegram.bots", canonicalPath: "/dashboard/telegram/bots", section: "telegram", tab: "bots", navKey: "telegram", owner: "bot", delivery: "worker-document", scope: "account", navParams: [] }),
  route({ id: "telegram.commands", canonicalPath: "/dashboard/telegram/commands", section: "telegram", tab: "commands", navKey: "telegram", owner: "bot", delivery: "worker-document", scope: "account", navParams: [] }),
  route({ id: "telegram.offers", canonicalPath: "/dashboard/telegram/offers", section: "telegram", tab: "offers", navKey: "telegram", owner: "bot", delivery: "worker-document", scope: "account", navParams: [] }),
  route({ id: "telegram.broadcasts", canonicalPath: "/dashboard/telegram/broadcasts", section: "telegram", tab: "broadcasts", navKey: "telegram", owner: "bot", delivery: "worker-document", scope: "account", navParams: [] }),
];

// Legacy path aliases. Each is pinned to current Worker behavior by parity
// tests (kind "redirect" = index.js/telegram-routes.js/hono-app 3xx today;
// kind "rewrite" = served in place via parseDashboardPath SECTION_ALIASES,
// the /dashboard/settings root document or the /dashboard.html spelling).
export const DASHBOARD_ROUTE_ALIASES: readonly DashboardRouteAlias[] = [
  // home
  { path: "/dashboard.html", routeId: "home", kind: "rewrite" },
  { path: "/dashboard/overview", routeId: "home", kind: "rewrite" },
  { path: "/dashboard/setup", routeId: "home", kind: "redirect" },
  // board (+ per-tab editor spellings)
  { path: "/dashboard/editor", routeId: "board", kind: "redirect" },
  { path: "/dashboard/editor/setup", routeId: "board.setup", kind: "redirect" },
  { path: "/dashboard/editor/players", routeId: "board.players", kind: "redirect" },
  { path: "/dashboard/editor/design", routeId: "board.design", kind: "redirect" },
  { path: "/dashboard/editor/share", routeId: "board.share", kind: "redirect" },
  { path: "/dashboard/editor/history", routeId: "board.history", kind: "redirect" },
  // boards / sites list
  { path: "/dashboard/boards", routeId: "boards", kind: "redirect" },
  { path: "/dashboard/sites", routeId: "boards", kind: "rewrite" },
  // performance
  { path: "/dashboard/growth", routeId: "performance", kind: "rewrite" },
  { path: "/dashboard/referrals", routeId: "performance", kind: "rewrite" },
  // site settings
  { path: "/dashboard/settings/board", routeId: "site", kind: "redirect" },
  // rewards
  { path: "/dashboard/credits", routeId: "rewards.overview", kind: "redirect" },
  { path: "/dashboard/rewards/overview", routeId: "rewards.overview", kind: "redirect" },
  { path: "/dashboard/rewards/maps", routeId: "rewards.rules", kind: "redirect" },
  { path: "/dashboard/rewards/rewards", routeId: "rewards.rules", kind: "redirect" },
  { path: "/dashboard/rewards/history", routeId: "rewards.history", kind: "redirect" },
  // Kick connection (moved Rewards → Site settings)
  { path: "/dashboard/rewards/channel", routeId: "siteConnections.channel", kind: "redirect" },
  { path: "/dashboard/settings/integrations", routeId: "siteConnections.channel", kind: "redirect" },
  // giveaways
  { path: "/dashboard/giveaways", routeId: "giveaways.chat", kind: "redirect" },
  { path: "/dashboard/giveaways/preds", routeId: "giveaways.preds", kind: "redirect" },
  // audience (members moved out of Rewards; activity moved into Rewards)
  { path: "/dashboard/audience", routeId: "audience.viewers", kind: "redirect" },
  { path: "/dashboard/audience/viewers", routeId: "audience.viewers", kind: "redirect" },
  { path: "/dashboard/rewards/viewers", routeId: "audience.viewers", kind: "redirect" },
  { path: "/dashboard/audience/activity", routeId: "rewards.history", kind: "redirect" },
  // account settings (root serves the account tab without redirecting)
  { path: "/dashboard/settings", routeId: "settings.account", kind: "rewrite" },
  { path: "/dashboard/manage", routeId: "settings.account", kind: "redirect" },
  { path: "/dashboard/security", routeId: "settings.account", kind: "redirect" },
  { path: "/dashboard/billing", routeId: "settings.plan", kind: "redirect" },
  { path: "/dashboard/settings/plan", routeId: "settings.plan", kind: "redirect" },
  { path: "/dashboard/attribution", routeId: "settings.connections", kind: "redirect" },
  { path: "/dashboard/integrations", routeId: "settings.connections", kind: "redirect" },
  // the retired /account/* settings implementation
  { path: "/account", routeId: "settings.account", kind: "redirect" },
  { path: "/account.html", routeId: "settings.account", kind: "redirect" },
  { path: "/account/profile", routeId: "settings.account", kind: "redirect" },
  { path: "/account/plan", routeId: "settings.plan", kind: "redirect" },
  { path: "/account/postbacks", routeId: "settings.connections", kind: "redirect" },
  { path: "/account/connected", routeId: "settings.connections", kind: "redirect" },
  { path: "/account/data", routeId: "settings.data", kind: "redirect" },
  // telegram (bot Worker owns /bot* per wrangler.toml; the leaderboard Worker
  // keeps a defensive copy of these redirects in telegram-routes.js)
  { path: "/bot", routeId: "telegram", kind: "redirect" },
  { path: "/bot/dashboard", routeId: "telegram", kind: "redirect" },
  { path: "/bot/bots", routeId: "telegram.bots", kind: "redirect" },
  { path: "/bot/commands", routeId: "telegram.commands", kind: "redirect" },
  { path: "/bot/offers", routeId: "telegram.offers", kind: "redirect" },
  { path: "/bot/broadcasts", routeId: "telegram.broadcasts", kind: "redirect" },
  { path: "/dashboard/telegram/overview", routeId: "telegram", kind: "redirect" },
  // Served by the leaderboard Worker: /dashboard/bot/* does not match the bot
  // Worker's yourrank.site/dashboard/telegram* pattern.
  { path: "/dashboard/bot/setup", routeId: "telegram", kind: "redirect", servedBy: "leaderboard" },
];

// Legacy `?nav=` addressing: `/dashboard?nav=<name>` was the old address of a
// section; the Worker 302s it to the real URL, preserving all other query
// parameters. Values mirror resolveSection/SECTION_ALIASES +
// LEGACY_ACCOUNT_PATHS + the kickrewards special case (parity-tested).
export const NAV_QUERY_ALIASES: Readonly<Record<string, string>> = {
  kickrewards: "siteConnections.channel",
  home: "home",
  overview: "home",
  board: "board",
  leaderboard: "board",
  editor: "board",
  boards: "boards",
  leaderboards: "boards",
  sites: "boards",
  games: "games",
  performance: "performance",
  analytics: "performance",
  growth: "performance",
  referrals: "performance",
  site: "site",
  settings: "settings.account",
  manage: "settings.account",
  plan: "settings.plan",
  billing: "settings.plan",
  connections: "settings.connections",
  integrations: "settings.connections",
};

// Legacy tab-selection query parameters on the /dashboard/settings root
// document: `?tab=<tab>` picks the settings tab, and a bare `?plan` selects
// the billing tab. Navigation state, resolved server-side (index.js).
export const SETTINGS_ROOT_TAB_PARAMS = Object.freeze(["tab", "plan"] as const);

/**
 * Query-parameter audit (Correction: freeze navParams only after auditing).
 * Every query parameter discovered on dashboard documents/assets and the
 * Workers that serve them, with its classification. Only "navigation"
 * parameters may appear in a route's navParams or in the legacy query
 * aliases above. This record is the frozen audit result; parity tests assert
 * the manifest never references a parameter classified otherwise.
 */
export const QUERY_PARAM_AUDIT: Readonly<Record<string, {
  readonly classification: "navigation" | "one-shot-action" | "feature";
  readonly where: string;
}>> = {
  board: { classification: "navigation", where: "Site context on core SPA destinations; stamped by preserveSiteContextLinks (board-shell.js siteDestinations + /dashboard/leaderboard/*)." },
  siteId: { classification: "navigation", where: "Site context on fragment-booted destinations; stamped by preserveSiteContextLinks (creditsDestinations), read by credits/giveaways/audience clients and sitePath()." },
  nav: { classification: "navigation", where: "Legacy section addressing on /dashboard; 302-canonicalized by index.js (NAV_QUERY_ALIASES)." },
  tab: { classification: "navigation", where: "Legacy tab selection on the /dashboard/settings root document (index.js)." },
  plan: { classification: "navigation", where: "Bare ?plan on /dashboard/settings selects the billing tab (index.js). Elsewhere (/auth, /account.js, dashboard.js checkout return) it is feature state — see plan (feature)." },
  edit: { classification: "one-shot-action", where: "credits.js prefillEditFromQuery: opens one mapping editor on Rewards → Ways to earn; consumed on load, not navigation identity." },
  viewer: { classification: "one-shot-action", where: "credits.js history tab: prefills the history username filter once." },
  kick_connected: { classification: "one-shot-action", where: "credits.js OAuth return banner; deleted from the URL after display." },
  error: { classification: "one-shot-action", where: "credits.js OAuth error banner; deleted from the URL after display. Also auth/login feature state outside the dashboard." },
  gid: { classification: "feature", where: "players.js: Google Sheets worksheet id inside a pasted import URL; not a dashboard parameter." },
  token: { classification: "feature", where: "Invite acceptance (/dashboard/invite) and auth flows; capability token, not navigation." },
  path: { classification: "feature", where: "/dashboard/_content internal fragment endpoint input; not a user-facing route." },
  ref: { classification: "feature", where: "Marketing/referral attribution on public pages." },
  returnTo: { classification: "feature", where: "Auth flow return address (login/logout), validated by safe-next; not dashboard routing." },
  next: { classification: "feature", where: "Auth flow return address; validated by safe-next." },
  state: { classification: "feature", where: "OAuth state parameter (Kick/Telegram flows)." },
  code: { classification: "feature", where: "OAuth authorization code." },
  area: { classification: "feature", where: "/help/support contact area preselect (public help pages)." },
  return: { classification: "feature", where: "/help/support back-link target (public help pages)." },
  search: { classification: "feature", where: "API list filtering (Worker endpoints), not dashboard document routing." },
  limit: { classification: "feature", where: "API pagination." },
  offset: { classification: "feature", where: "API pagination." },
  cursor: { classification: "feature", where: "API pagination." },
  days: { classification: "feature", where: "API analytics range." },
  type: { classification: "feature", where: "API filters and auth document variants." },
  slug: { classification: "feature", where: "Public site resolution and API lookups." },
  site: { classification: "feature", where: "API site lookups (server-side), distinct from the siteId navigation parameter on dashboard documents." },
  section: { classification: "feature", where: "Public help/marketing pages; not the signed-in dashboard." },
  device: { classification: "feature", where: "/dashboard/preview render option (template preview tool, POST/GET endpoint, not a dashboard section)." },
  layout: { classification: "feature", where: "Public leaderboard render options." },
  embed: { classification: "feature", where: "Public leaderboard embed mode." },
  font: { classification: "feature", where: "Public leaderboard render options." },
  accentA: { classification: "feature", where: "Public leaderboard render options." },
  accentB: { classification: "feature", where: "Public leaderboard render options." },
  channel: { classification: "feature", where: "API connection endpoints; not a dashboard document parameter." },
  handoff: { classification: "feature", where: "Auth session handoff between Workers." },
  isolated: { classification: "feature", where: "Games island debug/render mode." },
  id: { classification: "feature", where: "API object lookups." },
  key: { classification: "feature", where: "API/webhook credentials." },
  kickUsername: { classification: "feature", where: "API viewer lookups." },
};

// ── Primitives ──────────────────────────────────────────────────────────────

const ROUTES_BY_ID: ReadonlyMap<string, DashboardRouteDef> = new Map(
  DASHBOARD_ROUTES.map((r) => [r.id, r]),
);

const ROUTES_BY_PATH: ReadonlyMap<string, DashboardRouteDef> = new Map(
  DASHBOARD_ROUTES.map((r) => [r.canonicalPath, r]),
);

const ALIASES_BY_PATH: ReadonlyMap<string, DashboardRouteAlias> = new Map(
  DASHBOARD_ROUTE_ALIASES.map((a) => [a.path, a]),
);

/** Trim trailing slashes the way routes.js does (parity-tested). */
export function trimTrailingSlashes(pathname: string): string {
  const s = String(pathname || "");
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47) end -= 1;
  return s.slice(0, end);
}

export function routeById(id: string): DashboardRouteDef | undefined {
  return ROUTES_BY_ID.get(id);
}

/** Resolution of a pathname against the manifest. */
export interface ResolvedDashboardPath {
  readonly route: DashboardRouteDef;
  /** True when the pathname is the route's canonical path. */
  readonly canonical: boolean;
  /** Set when the pathname is a legacy alias. */
  readonly alias?: DashboardRouteAlias;
}

/**
 * Resolve a pathname to a manifest route, matching the canonical path first
 * and legacy aliases second. Returns undefined for non-dashboard paths
 * (public, API, webhook and marketing routes stay outside this model).
 */
export function resolveDashboardPath(pathname: string): ResolvedDashboardPath | undefined {
  const clean = trimTrailingSlashes(pathname);
  const direct = ROUTES_BY_PATH.get(clean);
  if (direct) return { route: direct, canonical: true };
  const alias = ALIASES_BY_PATH.get(clean);
  if (alias) {
    const target = ROUTES_BY_ID.get(alias.routeId);
    if (target) return { route: target, canonical: false, alias };
  }
  return undefined;
}

/**
 * Build the canonical URL for a route id, appending only declared
 * navigation-state parameters, in a deterministic (declaration) order.
 * Unknown ids and undeclared parameters return/append nothing.
 */
export function buildDashboardPath(
  id: string,
  navParams?: Readonly<Partial<Record<SiteContextParam, string>>>,
): string {
  const def = ROUTES_BY_ID.get(id);
  if (!def) return "";
  if (!navParams) return def.canonicalPath;
  const query = def.navParams
    .filter((p) => typeof navParams[p] === "string" && navParams[p] !== "")
    .map((p) => `${p}=${encodeURIComponent(navParams[p] as string)}`)
    .join("&");
  return query ? `${def.canonicalPath}?${query}` : def.canonicalPath;
}

/**
 * Canonicalize any known dashboard pathname: canonical paths return
 * themselves, aliases return their target's canonical path, unknown paths
 * return "". Deterministic and idempotent.
 */
export function canonicalDashboardPath(pathname: string): string {
  const resolved = resolveDashboardPath(pathname);
  return resolved ? resolved.route.canonicalPath : "";
}
