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
  readonly id: DashboardRouteId;
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
 * How a legacy redirect treats the request's query string today
 * (parity-tested against the serving Worker):
 * - "preserve": the full search string is carried to the target.
 * - "drop": the redirect discards the search string.
 * - "transform": documented per-alias in `searchTransform`.
 */
export type AliasSearchBehavior = "preserve" | "drop" | "transform";

/**
 * A legacy address for a route.
 * - "redirect": the Worker answers with the recorded 3xx today. `status`,
 *   `search` and (when the Location pathname is not the target route's
 *   canonical path) `redirectTo` capture the exact current behavior so
 *   PR-12 can derive these redirects without guessing.
 * - "rewrite": the Worker serves the destination at the legacy path without
 *   redirecting (SECTION_ALIASES heads resolved by parseDashboardPath, the
 *   /dashboard/settings root document, /dashboard.html).
 */
export type DashboardRouteAlias =
  | {
      readonly path: string;
      readonly routeId: DashboardRouteId;
      readonly kind: "rewrite";
      /** Worker serving the alias when it differs from the target route's owner. */
      readonly servedBy?: DashboardWorker;
    }
  | {
      readonly path: string;
      readonly routeId: DashboardRouteId;
      readonly kind: "redirect";
      /** Exact redirect status the Worker sends today. */
      readonly status: 301 | 302;
      /** Exact query/search behavior of the redirect today. */
      readonly search: AliasSearchBehavior;
      /** Required documentation of a "transform" search behavior. */
      readonly searchTransform?: string;
      /**
       * Exact Location pathname the Worker sends today, when it is NOT the
       * target route's canonical path (e.g. /dashboard/manage →
       * /dashboard/settings, itself a rewrite alias; /account/plan →
       * /dashboard/settings/plan, itself a redirect alias — a chain).
       */
      readonly redirectTo?: string;
      /** Worker serving the alias when it differs from the target route's owner. */
      readonly servedBy?: DashboardWorker;
    };

const ROUTE_DEFS = [
  // ── Core SPA sections (leaderboard Worker, client-rendered in the shell) ──
  { id: "home", canonicalPath: "/dashboard", section: "home", navKey: "home", owner: "leaderboard", delivery: "spa-section", scope: "account", navParams: ["board"] },
  { id: "board", canonicalPath: "/dashboard/leaderboard", section: "board", navKey: "board", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] },
  { id: "board.setup", canonicalPath: "/dashboard/leaderboard/setup", section: "board", tab: "setup", navKey: "board", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] },
  { id: "board.players", canonicalPath: "/dashboard/leaderboard/players", section: "board", tab: "players", navKey: "board", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] },
  { id: "board.design", canonicalPath: "/dashboard/leaderboard/design", section: "board", tab: "design", navKey: "board", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] },
  { id: "board.share", canonicalPath: "/dashboard/leaderboard/share", section: "board", tab: "share", navKey: "board", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] },
  { id: "board.history", canonicalPath: "/dashboard/leaderboard/history", section: "board", tab: "history", navKey: "board", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] },
  { id: "boards", canonicalPath: "/dashboard/leaderboards", section: "boards", navKey: "sites", owner: "leaderboard", delivery: "spa-section", scope: "account", navParams: ["board"] },
  { id: "games", canonicalPath: "/dashboard/games", section: "games", navKey: "games", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] },
  { id: "performance", canonicalPath: "/dashboard/analytics", section: "performance", navKey: "performance", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: [] },
  { id: "performance.activity", canonicalPath: "/dashboard/analytics/activity", section: "performance", tab: "activity", navKey: "performance", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] },
  { id: "performance.referrals", canonicalPath: "/dashboard/analytics/referrals", section: "performance", tab: "referrals", navKey: "performance", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: [] },
  { id: "performance.events", canonicalPath: "/dashboard/analytics/events", section: "performance", tab: "events", navKey: "performance", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: [] },
  { id: "site", canonicalPath: "/dashboard/site", section: "site", navKey: "site", owner: "leaderboard", delivery: "spa-section", scope: "site", navParams: ["board"] },

  // ── Fragment-booted sections (leaderboard Worker) ──
  { id: "rewards.overview", canonicalPath: "/dashboard/rewards", section: "rewards", tab: "overview", navKey: "redemptions", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] },
  { id: "rewards.shop", canonicalPath: "/dashboard/rewards/shop", section: "rewards", tab: "shop", navKey: "redemptions", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] },
  { id: "rewards.rules", canonicalPath: "/dashboard/rewards/rules", section: "rewards", tab: "rules", navKey: "redemptions", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] },
  { id: "rewards.redemptions", canonicalPath: "/dashboard/rewards/redemptions", section: "rewards", tab: "redemptions", navKey: "redemptions", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] },
  { id: "rewards.history", canonicalPath: "/dashboard/rewards/activity", section: "rewards", tab: "history", navKey: "redemptions", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] },
  { id: "siteConnections.channel", canonicalPath: "/dashboard/site/connections", section: "siteConnections", tab: "channel", navKey: "site", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] },
  { id: "giveaways.chat", canonicalPath: "/dashboard/giveaways/chat", section: "giveaways", tab: "chat", navKey: "engage", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] },
  { id: "giveaways.raffles", canonicalPath: "/dashboard/giveaways/raffles", section: "giveaways", tab: "raffles", navKey: "engage", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] },
  { id: "giveaways.drops", canonicalPath: "/dashboard/giveaways/drops", section: "giveaways", tab: "drops", navKey: "engage", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] },
  { id: "giveaways.preds", canonicalPath: "/dashboard/giveaways/predictions", section: "giveaways", tab: "preds", navKey: "engage", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] },
  { id: "giveaways.tournaments", canonicalPath: "/dashboard/giveaways/tournaments", section: "giveaways", tab: "tournaments", navKey: "engage", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] },
  { id: "audience.viewers", canonicalPath: "/dashboard/audience/members", section: "audience", tab: "viewers", navKey: "audience", owner: "leaderboard", delivery: "fragment", scope: "site", navParams: ["siteId"] },
  { id: "settings.account", canonicalPath: "/dashboard/settings/account", section: "settings", tab: "account", navKey: "settings", owner: "leaderboard", delivery: "fragment", scope: "account", navParams: [] },
  { id: "settings.team", canonicalPath: "/dashboard/settings/team", section: "settings", tab: "team", navKey: "settings", owner: "leaderboard", delivery: "fragment", scope: "account", navParams: [] },
  { id: "settings.plan", canonicalPath: "/dashboard/settings/billing", section: "settings", tab: "plan", navKey: "settings", owner: "leaderboard", delivery: "fragment", scope: "account", navParams: [] },
  { id: "settings.connections", canonicalPath: "/dashboard/settings/connections", section: "settings", tab: "connections", navKey: "settings", owner: "leaderboard", delivery: "fragment", scope: "account", navParams: [] },
  { id: "settings.data", canonicalPath: "/dashboard/settings/data", section: "settings", tab: "data", navKey: "settings", owner: "leaderboard", delivery: "fragment", scope: "account", navParams: [] },

  // ── Telegram dashboard (bot Worker) ──
  { id: "telegram", canonicalPath: "/dashboard/telegram", section: "telegram", navKey: "telegram", owner: "bot", delivery: "worker-document", scope: "account", navParams: [] },
  { id: "telegram.bots", canonicalPath: "/dashboard/telegram/bots", section: "telegram", tab: "bots", navKey: "telegram", owner: "bot", delivery: "worker-document", scope: "account", navParams: [] },
  { id: "telegram.commands", canonicalPath: "/dashboard/telegram/commands", section: "telegram", tab: "commands", navKey: "telegram", owner: "bot", delivery: "worker-document", scope: "account", navParams: [] },
  { id: "telegram.offers", canonicalPath: "/dashboard/telegram/offers", section: "telegram", tab: "offers", navKey: "telegram", owner: "bot", delivery: "worker-document", scope: "account", navParams: [] },
  { id: "telegram.broadcasts", canonicalPath: "/dashboard/telegram/broadcasts", section: "telegram", tab: "broadcasts", navKey: "telegram", owner: "bot", delivery: "worker-document", scope: "account", navParams: [] },
] as const satisfies readonly {
  id: string;
  canonicalPath: string;
  section: string;
  tab?: string;
  navKey: string;
  owner: DashboardWorker;
  delivery: DashboardDelivery;
  scope: DashboardScope;
  navParams: readonly SiteContextParam[];
}[];

/**
 * The closed union of stable route identities, derived from the manifest.
 * A typo ("setings.acount") is a compile error in every typed consumer;
 * untrusted external strings go through parseDashboardRouteId instead.
 */
export type DashboardRouteId = (typeof ROUTE_DEFS)[number]["id"];

export const DASHBOARD_ROUTES: readonly DashboardRouteDef[] = ROUTE_DEFS;

// Legacy path aliases. Each is pinned to current Worker behavior by parity
// tests (kind "redirect" = index.js/telegram-routes.js/hono-app 3xx today,
// with the exact status and search behavior recorded; kind "rewrite" =
// served in place via parseDashboardPath SECTION_ALIASES, the
// /dashboard/settings root document or the /dashboard.html spelling).
export const DASHBOARD_ROUTE_ALIASES: readonly DashboardRouteAlias[] = [
  // home
  { path: "/dashboard.html", routeId: "home", kind: "rewrite" },
  { path: "/dashboard/overview", routeId: "home", kind: "rewrite" },
  { path: "/dashboard/setup", routeId: "home", kind: "redirect", status: 302, search: "drop" },
  // board (+ per-tab editor spellings; legacyDashboardPath in index.js)
  { path: "/dashboard/editor", routeId: "board", kind: "redirect", status: 301, search: "preserve" },
  { path: "/dashboard/editor/setup", routeId: "board.setup", kind: "redirect", status: 301, search: "preserve" },
  { path: "/dashboard/editor/players", routeId: "board.players", kind: "redirect", status: 301, search: "preserve" },
  { path: "/dashboard/editor/design", routeId: "board.design", kind: "redirect", status: 301, search: "preserve" },
  { path: "/dashboard/editor/share", routeId: "board.share", kind: "redirect", status: 301, search: "preserve" },
  { path: "/dashboard/editor/history", routeId: "board.history", kind: "redirect", status: 301, search: "preserve" },
  // boards / sites list
  { path: "/dashboard/boards", routeId: "boards", kind: "redirect", status: 301, search: "preserve" },
  { path: "/dashboard/sites", routeId: "boards", kind: "rewrite" },
  // performance
  { path: "/dashboard/growth", routeId: "performance", kind: "rewrite" },
  { path: "/dashboard/referrals", routeId: "performance", kind: "rewrite" },
  // site settings
  { path: "/dashboard/settings/board", routeId: "site", kind: "redirect", status: 301, search: "preserve" },
  // rewards
  { path: "/dashboard/credits", routeId: "rewards.overview", kind: "redirect", status: 301, search: "preserve" },
  { path: "/dashboard/rewards/overview", routeId: "rewards.overview", kind: "redirect", status: 301, search: "preserve" },
  { path: "/dashboard/rewards/maps", routeId: "rewards.rules", kind: "redirect", status: 302, search: "preserve" },
  { path: "/dashboard/rewards/rewards", routeId: "rewards.rules", kind: "redirect", status: 302, search: "preserve" },
  { path: "/dashboard/rewards/history", routeId: "rewards.history", kind: "redirect", status: 301, search: "preserve" },
  // Kick connection (moved Rewards → Site settings)
  { path: "/dashboard/rewards/channel", routeId: "siteConnections.channel", kind: "redirect", status: 301, search: "preserve" },
  { path: "/dashboard/settings/integrations", routeId: "siteConnections.channel", kind: "redirect", status: 301, search: "preserve" },
  // giveaways
  { path: "/dashboard/giveaways", routeId: "giveaways.chat", kind: "redirect", status: 302, search: "preserve" },
  { path: "/dashboard/giveaways/preds", routeId: "giveaways.preds", kind: "redirect", status: 301, search: "preserve" },
  // audience (members moved out of Rewards; activity moved into Rewards)
  { path: "/dashboard/audience", routeId: "audience.viewers", kind: "redirect", status: 301, search: "preserve" },
  { path: "/dashboard/audience/viewers", routeId: "audience.viewers", kind: "redirect", status: 301, search: "preserve" },
  { path: "/dashboard/rewards/viewers", routeId: "audience.viewers", kind: "redirect", status: 301, search: "preserve" },
  { path: "/dashboard/audience/activity", routeId: "rewards.history", kind: "redirect", status: 301, search: "preserve" },
  // account settings (root serves the account tab without redirecting)
  { path: "/dashboard/settings", routeId: "settings.account", kind: "rewrite" },
  { path: "/dashboard/manage", routeId: "settings.account", kind: "redirect", status: 302, search: "preserve", redirectTo: "/dashboard/settings" },
  { path: "/dashboard/security", routeId: "settings.account", kind: "redirect", status: 302, search: "preserve" },
  { path: "/dashboard/billing", routeId: "settings.plan", kind: "redirect", status: 301, search: "preserve" },
  { path: "/dashboard/settings/plan", routeId: "settings.plan", kind: "redirect", status: 301, search: "preserve" },
  { path: "/dashboard/attribution", routeId: "settings.connections", kind: "redirect", status: 302, search: "preserve" },
  { path: "/dashboard/integrations", routeId: "settings.connections", kind: "redirect", status: 302, search: "preserve" },
  // the retired /account/* settings implementation
  { path: "/account", routeId: "settings.account", kind: "redirect", status: 302, search: "preserve", redirectTo: "/dashboard/settings" },
  { path: "/account.html", routeId: "settings.account", kind: "redirect", status: 302, search: "preserve", redirectTo: "/dashboard/settings" },
  { path: "/account/profile", routeId: "settings.account", kind: "redirect", status: 302, search: "preserve" },
  // Chains: /account/plan lands on /dashboard/settings/plan, itself a 301
  // alias of /dashboard/settings/billing.
  { path: "/account/plan", routeId: "settings.plan", kind: "redirect", status: 302, search: "preserve", redirectTo: "/dashboard/settings/plan" },
  { path: "/account/postbacks", routeId: "settings.connections", kind: "redirect", status: 302, search: "preserve" },
  { path: "/account/connected", routeId: "settings.connections", kind: "redirect", status: 302, search: "preserve" },
  { path: "/account/data", routeId: "settings.data", kind: "redirect", status: 302, search: "preserve" },
  // telegram (bot Worker owns /bot* per wrangler.toml, and its Hono redirects
  // drop the query string; the leaderboard Worker keeps a defensive copy of
  // these redirects in telegram-routes.js that would preserve it)
  { path: "/bot", routeId: "telegram", kind: "redirect", status: 301, search: "drop" },
  { path: "/bot/dashboard", routeId: "telegram", kind: "redirect", status: 301, search: "drop" },
  { path: "/bot/bots", routeId: "telegram.bots", kind: "redirect", status: 301, search: "drop" },
  { path: "/bot/commands", routeId: "telegram.commands", kind: "redirect", status: 301, search: "drop" },
  { path: "/bot/offers", routeId: "telegram.offers", kind: "redirect", status: 301, search: "drop" },
  { path: "/bot/broadcasts", routeId: "telegram.broadcasts", kind: "redirect", status: 301, search: "drop" },
  // /bot/settings hands off to the leaderboard settings document, tagging
  // the origin so the settings page can render a back-link.
  { path: "/bot/settings", routeId: "settings.account", kind: "redirect", status: 302, search: "transform", searchTransform: "preserve all parameters, then set from=bot", redirectTo: "/dashboard/settings", servedBy: "bot" },
  // Served by the leaderboard Worker: /dashboard/bot/* does not match the bot
  // Worker's yourrank.site/dashboard/telegram* pattern.
  { path: "/dashboard/bot/setup", routeId: "telegram", kind: "redirect", status: 301, search: "preserve", servedBy: "leaderboard" },
];

// Legacy `?nav=` addressing: `/dashboard?nav=<name>` was the old address of a
// section; the Worker 302s it to the real URL, preserving all other query
// parameters. Values mirror resolveSection/SECTION_ALIASES +
// LEGACY_ACCOUNT_PATHS + the kickrewards special case (parity-tested).
export const NAV_QUERY_ALIASES: Readonly<Record<string, DashboardRouteId>> = {
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

/** One audited use of a query parameter in a specific context. */
export interface QueryParamUse {
  readonly classification: "navigation" | "one-shot-action" | "feature";
  /** The URL/document context this classification applies to. */
  readonly context: string;
  /** Evidence: where the parameter is read/written today. */
  readonly where: string;
}

/**
 * Query-parameter audit (Correction: freeze navParams only after auditing).
 * Every query parameter discovered on dashboard documents/assets and the
 * Workers that serve them, with one entry per distinct use context — a
 * context-sensitive parameter (e.g. `plan`) carries multiple uses instead of
 * one global classification. Only parameters with a "navigation" use may
 * appear in a route's navParams, in NAV_QUERY_ALIASES or in
 * SETTINGS_ROOT_TAB_PARAMS; the location resolver applies them only in their
 * audited context. Enforced mechanically: shared invariant tests assert the
 * manifest references only navigation uses, and the leaderboard scanner test
 * fails CI when a dashboard routing/navigation source reads or writes a
 * literal query parameter that has no audit entry.
 */
export const QUERY_PARAM_AUDIT: Readonly<Record<string, readonly QueryParamUse[]>> = {
  board: [{ classification: "navigation", context: "core SPA destinations", where: "Site context; stamped by preserveSiteContextLinks (board-shell.js siteDestinations + /dashboard/leaderboard/*)." }],
  siteId: [{ classification: "navigation", context: "fragment-booted destinations", where: "Site context; stamped by preserveSiteContextLinks (creditsDestinations), read by credits/giveaways/audience clients and sitePath()." }],
  nav: [{ classification: "navigation", context: "core SPA paths (parseDashboardPath matches)", where: "Legacy section addressing; 302-canonicalized by index.js (NAV_QUERY_ALIASES)." }],
  tab: [{ classification: "navigation", context: "/dashboard/settings root document", where: "Legacy tab selection resolved server-side (index.js); ignored on /dashboard/settings/<tab> paths." }],
  plan: [
    { classification: "navigation", context: "/dashboard/settings root document", where: "Bare ?plan selects the billing tab (index.js)." },
    { classification: "feature", context: "auth/checkout flows", where: "Plan selection on /auth, account.js and dashboard.js checkout return; billing state, not routing." },
  ],
  edit: [{ classification: "one-shot-action", context: "Rewards → Ways to earn", where: "credits.js prefillEditFromQuery: opens one mapping editor; consumed on load, not navigation identity." }],
  viewer: [{ classification: "one-shot-action", context: "Rewards → Activity", where: "credits.js history tab: prefills the history username filter once." }],
  kick_connected: [{ classification: "one-shot-action", context: "dashboard documents after Kick OAuth", where: "credits.js OAuth return banner; deleted from the URL after display." }],
  error: [
    { classification: "one-shot-action", context: "dashboard documents after OAuth", where: "credits.js OAuth error banner; deleted from the URL after display." },
    { classification: "feature", context: "auth/login pages", where: "Login error display outside the dashboard." },
  ],
  gid: [{ classification: "feature", context: "Players → Google Sheets import", where: "players.js: worksheet id inside a pasted import URL; not a dashboard parameter." }],
  token: [{ classification: "feature", context: "invite/auth URLs", where: "Invite acceptance (/dashboard/invite) and auth flows; capability token, not navigation." }],
  path: [{ classification: "feature", context: "/dashboard/_content endpoint", where: "/dashboard/_content internal fragment endpoint input; not a user-facing route." }],
  ref: [{ classification: "feature", context: "public/marketing pages", where: "Marketing/referral attribution on public pages." }],
  returnTo: [{ classification: "feature", context: "auth flows", where: "Auth flow return address (login/logout), validated by safe-next; not dashboard routing." }],
  next: [{ classification: "feature", context: "auth flows", where: "Auth flow return address; validated by safe-next." }],
  state: [{ classification: "feature", context: "OAuth flows", where: "OAuth state parameter (Kick/Telegram flows)." }],
  code: [{ classification: "feature", context: "OAuth flows", where: "OAuth authorization code." }],
  area: [{ classification: "feature", context: "public help pages", where: "/help/support contact area preselect (public help pages)." }],
  return: [{ classification: "feature", context: "public help pages", where: "/help/support back-link target (public help pages)." }],
  search: [{ classification: "feature", context: "API endpoints", where: "API list filtering (Worker endpoints), not dashboard document routing." }],
  limit: [{ classification: "feature", context: "API endpoints", where: "API pagination." }],
  offset: [{ classification: "feature", context: "API endpoints", where: "API pagination." }],
  cursor: [{ classification: "feature", context: "API endpoints", where: "API pagination." }],
  days: [{ classification: "feature", context: "API endpoints", where: "API analytics range." }],
  type: [{ classification: "feature", context: "API/auth endpoints", where: "API filters and auth document variants." }],
  slug: [{ classification: "feature", context: "public/API lookups", where: "Public site resolution and API lookups." }],
  site: [{ classification: "feature", context: "API endpoints", where: "API site lookups (server-side), distinct from the siteId navigation parameter on dashboard documents." }],
  section: [{ classification: "feature", context: "public help/marketing pages", where: "Public help/marketing pages; not the signed-in dashboard." }],
  device: [{ classification: "feature", context: "/dashboard/preview endpoint", where: "/dashboard/preview render option (template preview tool, POST/GET endpoint, not a dashboard section)." }],
  layout: [{ classification: "feature", context: "public leaderboard rendering", where: "Public leaderboard render options." }],
  w: [{ classification: "feature", context: "image proxy endpoint", where: "Requested width on the avatar/image proxy (index.js); render option, not navigation." }],
  embed: [{ classification: "feature", context: "public leaderboard rendering", where: "Public leaderboard embed mode." }],
  font: [{ classification: "feature", context: "public leaderboard rendering", where: "Public leaderboard render options." }],
  accentA: [{ classification: "feature", context: "public leaderboard rendering", where: "Public leaderboard render options." }],
  accentB: [{ classification: "feature", context: "public leaderboard rendering", where: "Public leaderboard render options." }],
  channel: [{ classification: "feature", context: "API endpoints", where: "API connection endpoints; not a dashboard document parameter." }],
  handoff: [{ classification: "feature", context: "auth flows", where: "Auth session handoff between Workers." }],
  isolated: [{ classification: "feature", context: "Games island debug", where: "Games island debug/render mode." }],
  id: [{ classification: "feature", context: "API endpoints", where: "API object lookups." }],
  key: [{ classification: "feature", context: "API/webhook endpoints", where: "API/webhook credentials." }],
  kickUsername: [{ classification: "feature", context: "API endpoints", where: "API viewer lookups." }],
};

// ── Primitives ──────────────────────────────────────────────────────────────

const ROUTES_BY_ID: ReadonlyMap<DashboardRouteId, DashboardRouteDef> = new Map(
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

/**
 * Trusted typed lookup: `id` is a compile-checked DashboardRouteId, so the
 * route always exists (guaranteed by the type system plus the manifest
 * uniqueness invariants).
 */
export function routeById(id: DashboardRouteId): DashboardRouteDef {
  const def = ROUTES_BY_ID.get(id);
  /* istanbul ignore next -- unreachable for a valid DashboardRouteId */
  if (!def) throw new Error(`unknown dashboard route id: ${String(id)}`);
  return def;
}

/**
 * Untrusted-string boundary: parse an external value (URL fragment, storage,
 * postMessage, JS callers without type checking) into a DashboardRouteId.
 * This is the ONLY API that accepts an arbitrary string as a route id.
 */
export function parseDashboardRouteId(value: string): DashboardRouteId | undefined {
  return ROUTES_BY_ID.has(value as DashboardRouteId) ? (value as DashboardRouteId) : undefined;
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
 * Build the canonical URL for a typed route id, appending only declared
 * navigation-state parameters, in a deterministic (declaration) order.
 * Undeclared parameters append nothing. External strings must go through
 * parseDashboardRouteId first.
 */
export function buildDashboardPath(
  id: DashboardRouteId,
  navParams?: Readonly<Partial<Record<SiteContextParam, string>>>,
): string {
  const def = routeById(id);
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

// ── Location-level resolution (pathname + search) ────────────────────────

const SETTINGS_ROOT_PATH = "/dashboard/settings";

// Tab-name → route-id resolution used by the /dashboard/settings root
// document (index.js): billing|plan → the plan tab; unknown → account.
const SETTINGS_TAB_ROUTE_IDS: Readonly<Record<string, DashboardRouteId>> = {
  account: "settings.account",
  team: "settings.team",
  billing: "settings.plan",
  plan: "settings.plan",
  connections: "settings.connections",
  data: "settings.data",
};

/**
 * Complete route identity of a dashboard location. Pathname alone is not
 * identity: the /dashboard/settings root resolves its tab from ?tab=/?plan,
 * and legacy ?nav= re-addresses core SPA paths. This is the top-level
 * resolver; resolveDashboardPath is the path-only lower-level primitive.
 */
export interface DashboardLocation {
  readonly route: DashboardRouteDef;
  readonly routeId: DashboardRouteId;
  /** Canonical pathname for this identity (no legacy spelling, no ?tab/?nav). */
  readonly canonicalPath: string;
  /**
   * True when the given location already addresses the route canonically:
   * canonical pathname and no identity-affecting legacy query parameters.
   */
  readonly canonical: boolean;
  /** Set when the pathname matched a legacy path alias. */
  readonly alias?: DashboardRouteAlias;
  /** Set when a legacy ?nav= value decided the identity. */
  readonly navAlias?: string;
  /** Set when ?tab=/?plan on the settings root decided the identity. */
  readonly settingsTab?: string;
  /**
   * Declared navigation-state parameters present in the location, retained
   * on canonicalization (mirrors the Worker, which strips only `nav`).
   */
  readonly navParams: Readonly<Partial<Record<SiteContextParam, string>>>;
}

/**
 * Resolve a full location (pathname + search) to its route identity,
 * mirroring the Worker's current order of decisions (index.js):
 *
 * 1. Trailing slashes are trimmed (trimTrailingSlashes).
 * 2. The /dashboard/settings root document resolves its tab from ?tab= or a
 *    bare ?plan (billing|plan → settings.plan; unknown → settings.account).
 *    ?tab= is ignored on /dashboard/settings/<tab> paths and ?nav= is
 *    ignored on the settings root.
 * 3. Legacy ?nav= re-addresses spa-section paths only (the Worker honors it
 *    inside the parseDashboardPath branch); unknown values are ignored.
 * 4. Otherwise identity is the path resolution (canonical or alias).
 *
 * Returns undefined for non-dashboard locations.
 */
export function resolveDashboardLocation(
  pathname: string,
  search?: string | URLSearchParams,
): DashboardLocation | undefined {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search || "");
  const byPath = resolveDashboardPath(pathname);
  if (!byPath) return undefined;

  const clean = trimTrailingSlashes(pathname);
  const finish = (
    routeId: DashboardRouteId,
    extra: { alias?: DashboardRouteAlias; navAlias?: string; settingsTab?: string },
  ): DashboardLocation => {
    const route = routeById(routeId);
    const navParams: Partial<Record<SiteContextParam, string>> = {};
    for (const p of route.navParams) {
      const v = params.get(p);
      if (typeof v === "string" && v !== "") navParams[p] = v;
    }
    // Canonical means the input needed no transformation at all: the exact
    // canonical pathname (no trailing slash to trim), no alias, no legacy
    // ?nav=, no settings query tab.
    const canonical =
      pathname === route.canonicalPath && !extra.navAlias && !extra.settingsTab && !extra.alias;
    return {
      route,
      routeId,
      canonicalPath: route.canonicalPath,
      canonical,
      ...extra,
      navParams,
    };
  };

  // 2. Settings root: ?tab= / bare ?plan select the tab (before ?nav=).
  if (clean === SETTINGS_ROOT_PATH) {
    const requestedTab = params.get("tab") || (params.has("plan") ? "plan" : null);
    const routeId = (requestedTab && SETTINGS_TAB_ROUTE_IDS[requestedTab]) || "settings.account";
    return finish(routeId, {
      alias: byPath.alias,
      settingsTab: requestedTab || undefined,
    });
  }

  // 3. Legacy ?nav= on spa-section paths (parseDashboardPath territory).
  const nav = params.get("nav");
  if (nav && byPath.route.delivery === "spa-section") {
    const navRouteId = NAV_QUERY_ALIASES[nav];
    if (navRouteId) {
      return finish(navRouteId, { alias: byPath.alias, navAlias: nav });
    }
  }

  // 4. Path resolution decides identity.
  return finish(byPath.route.id, { alias: byPath.alias });
}
