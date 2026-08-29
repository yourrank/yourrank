// Browser/server dashboard route resolution, derived from the canonical
// manifest (@yourrank/shared/dashboard-routes). This file owns NO routing
// semantics of its own: every path, tab list, alias spelling and prefix is
// read from the manifest, and a regression gate rejects any hard-coded
// /dashboard route literal outside dashboardAliasPath(...) lookups.
// Chrome state (crumbs, tab labels, document titles, rail owner) comes from
// the canonical chrome-state owner (@yourrank/shared/dashboard-chrome-state);
// only delivery/boot metadata stays local (boot modules, topbar context).
//
// No browser globals at module scope: the Worker imports this too.

import {
  ACCOUNT_SECTION_PATHS,
  LEGACY_ACCOUNT_PATHS,
  NAV_OWNER_MAP,
  navOwner,
} from "@yourrank/shared/dashboard-nav";
import {
  DASHBOARD_ROUTES,
  dashboardAliasPath,
  routeById,
  trimTrailingSlashes,
} from "@yourrank/shared/dashboard-routes";
import {
  DASHBOARD_SECTION_TITLES,
  DEFAULT_DASHBOARD_TITLE,
  dashboardChromeState,
} from "@yourrank/shared/dashboard-chrome-state";

export { trimTrailingSlashes };

const HOME_PATH = routeById("home").canonicalPath;

/** Ordered tab keys of a manifest section (declaration order). */
const sectionTabs = (section) =>
  DASHBOARD_ROUTES.filter((r) => r.section === section && r.tab).map((r) => r.tab);

/** tab key → canonical URL path for a manifest section. */
const sectionTabPaths = (section) =>
  Object.fromEntries(
    DASHBOARD_ROUTES.filter((r) => r.section === section && r.tab).map((r) => [
      r.tab,
      r.canonicalPath,
    ]),
  );

export const SECTIONS = {
  home: { path: HOME_PATH, title: DASHBOARD_SECTION_TITLES.home },
  board: { path: routeById("board").canonicalPath, title: DASHBOARD_SECTION_TITLES.board, tabs: sectionTabs("board") },
  boards: { path: routeById("boards").canonicalPath, title: DASHBOARD_SECTION_TITLES.boards },
  games: { path: routeById("games").canonicalPath, title: DASHBOARD_SECTION_TITLES.games },
  performance: { path: routeById("performance").canonicalPath, title: DASHBOARD_SECTION_TITLES.performance, tabs: sectionTabs("performance") },
  // Account settings (`/dashboard/settings` and its tabs) are their own
  // documents, served by the Worker. This section is the selected site's
  // settings, which is all this document knows to render.
  site: { path: routeById("site").canonicalPath, title: DASHBOARD_SECTION_TITLES.site },
};

export const MANAGE_SITES_VALUE = "__manage_sites__";

/**
 * Manifest route id for a section/tab pair in this file's page vocabulary.
 * With `exact`, an unknown tab resolves to "" instead of the section root.
 */
export function routeIdFor(page, tab = "", { exact = false } = {}) {
  const wanted = String(tab || "");
  const match = DASHBOARD_ROUTES.find((r) => r.section === page && (r.tab || "") === wanted);
  if (match) return match.id;
  if (exact) return "";
  const root = DASHBOARD_ROUTES.find((r) => r.section === page);
  return root ? root.id : "";
}

/** Canonical chrome state (rail owner, crumbs, labels, document title). */
export function chromeStateFor(page, tab = "", { exact = false } = {}) {
  const id = routeIdFor(page, tab, { exact });
  return id ? dashboardChromeState(id) : null;
}

// ---- Dynamic sections ----
//
// These dashboard areas were separate server-rendered documents, each with its
// own boot script (activities.js / credits.js / people.js / giveaways.js / account.js). The persistent
// shell now fetches their content as fragments and boots them lazily so
// navigation between them and the core SPA sections never reloads the page.
//
// `boot` names the client module that owns the section's lifecycle:
//   "activities"→ assets/activities.js  (Safe Activities)
//   "credits"   → assets/credits.js     (Rewards)
//   "people"    → assets/people.js      (People; delegates Members to credits.js)
//   "giveaways" → assets/giveaways.js   (Engagement)
//   "account"   → assets/account.js     (Account settings)
//
// `boardContext` tells the shell which topbar controls to show:
//   "selector"  → site selector, no publish controls
//   "none"      → account context, no site selector
//
// Tabs and tab→path tables come from the manifest; only delivery/presentation
// metadata (boot, boardContext, rootId) is declared here. `navKey` is the
// manifest rail owner of the section's routes.

const dynamicSection = (section, meta) => {
  const routes = DASHBOARD_ROUTES.filter((r) => r.section === section && r.tab);
  return {
    ...meta,
    navKey: routes[0].navKey,
    tabs: routes.map((r) => r.tab),
    tabPaths: sectionTabPaths(section),
  };
};

export const DYNAMIC_SECTIONS = {
  activities: dynamicSection("activities", { boot: "activities", boardContext: "selector", rootId: "act-dash" }),
  rewards: dynamicSection("rewards", { boot: "credits", boardContext: "selector", rootId: "cr-dash" }),
  // The Kick connection is stored on the site row (sites.kick_channel_*), so
  // its canonical home is Site settings → Connections. It still boots the
  // credits client module — the fragment markup and behaviour are unchanged,
  // only the address and the rail owner moved.
  siteConnections: dynamicSection("siteConnections", { boot: "credits", boardContext: "selector", rootId: "cr-dash" }),
  giveaways: dynamicSection("giveaways", { boot: "giveaways", boardContext: "selector", rootId: "gw-dash" }),
  audience: dynamicSection("audience", { boot: "people", boardContext: "selector", rootId: "cr-dash" }),
  settings: dynamicSection("settings", { boot: "account", boardContext: "none", rootId: "acc-app" }),
};

// URL path prefix each dynamic section answers under, resolved through the
// manifest: the section's bare entry address (canonical or a registered
// legacy alias — the mount spelling stays validated either way).
// `/dashboard/site` itself is a core SPA section matched by
// parseDashboardPath first, so siteConnections mounts on the full
// connections path and only ever claims its sub-paths.
const DYNAMIC_PATH_PREFIXES = [
  ["activities", routeById("activities.overview").canonicalPath],
  ["rewards", routeById("rewards.overview").canonicalPath],
  ["giveaways", dashboardAliasPath("/dashboard/giveaways", "giveaways.chat")],
  ["audience", dashboardAliasPath("/dashboard/audience", "audience.viewers")],
  ["settings", dashboardAliasPath("/dashboard/settings", "settings.account")],
  ["siteConnections", routeById("siteConnections.channel").canonicalPath],
];

/** true if `page` is one of the dynamic (fragment-loaded) sections. */
export function isDynamicSection(page) {
  return Boolean(DYNAMIC_SECTIONS[page]);
}

/**
 * Parse a dashboard URL into a dynamic section route, or null if the path
 * does not belong to a dynamic section.
 *
 * `/dashboard/rewards/shop` → { page: "rewards", tab: "shop", dynamic: true }
 * `/dashboard/settings`     → { page: "settings", tab: "account", dynamic: true }
 */
export function parseDynamicPath(pathname) {
  const clean = trimTrailingSlashes(pathname) || HOME_PATH;
  for (const [key, prefix] of DYNAMIC_PATH_PREFIXES) {
    if (clean === prefix) {
      // Bare prefix → first tab of that section.
      const section = DYNAMIC_SECTIONS[key];
      return { page: key, tab: section.tabs[0], dynamic: true };
    }
    if (clean.startsWith(prefix + "/")) {
      const segment = clean.slice(prefix.length + 1).split("/")[0];
      const section = DYNAMIC_SECTIONS[key];
      // Map URL segment back to the internal tab key.
      const tabByKey = section.tabs.find((t) => t === segment);
      const tabByPath = Object.entries(section.tabPaths).find(([, p]) => p === clean)?.[0];
      const tab = tabByKey || tabByPath;
      if (tab) return { page: key, tab, dynamic: true };
      return null; // unknown sub-path → let the server handle it
    }
  }
  return null;
}

/** Build the URL path for a dynamic section + tab. */
export function dynamicPath(page, tab = "") {
  const section = DYNAMIC_SECTIONS[page];
  if (!section) return "";
  const resolvedTab = tab || section.tabs[0];
  return section.tabPaths[resolvedTab] || section.tabPaths[section.tabs[0]];
}

/** Human-readable title for a dynamic section route. */
export function dynamicTitle(page, tab = "") {
  const section = DYNAMIC_SECTIONS[page];
  if (!section) return DEFAULT_DASHBOARD_TITLE;
  return chromeStateFor(page, tab || section.tabs[0]).documentTitle;
}

export { ACCOUNT_SECTION_PATHS, LEGACY_ACCOUNT_PATHS, NAV_OWNER_MAP, navOwner };

// Names we have shipped links for, in copy, e-mails and older builds. The
// spellings are this file's vocabulary; each resolves through the manifest
// to the section key (SPA sections) or settings tab key it addresses.
const SECTION_ALIAS_ROUTES = {
  overview: "home",
  editor: "board",
  leaderboard: "board",
  leaderboards: "boards",
  sites: "boards",
  analytics: "performance",
  growth: "performance",
  referrals: "performance",
  integrations: "settings.connections",
  billing: "settings.plan",
};

export const SECTION_ALIASES = {
  ...Object.fromEntries(
    Object.entries(SECTION_ALIAS_ROUTES).map(([name, id]) => {
      const route = routeById(id);
      return [name, route.section in SECTIONS ? route.section : route.tab];
    }),
  ),
};

export function legacyDashboardPath(pathname) {
  const clean = trimTrailingSlashes(pathname) || HOME_PATH;
  const editor = dashboardAliasPath("/dashboard/editor", "board");
  if (clean === editor || clean.startsWith(editor + "/")) {
    return `${routeById("board").canonicalPath}${clean.slice(editor.length)}`;
  }
  if (clean === dashboardAliasPath("/dashboard/boards", "boards")) {
    return routeById("boards").canonicalPath;
  }
  return "";
}

export function resolveSection(name) {
  if (!name) return "";
  const key = SECTION_ALIASES[name] || name;
  return SECTIONS[key] || ACCOUNT_SECTION_PATHS[key] ? key : "";
}

export function defaultTab(page) {
  return SECTIONS[page]?.tabs?.[0] || "";
}

/** `("board", "players") → "/dashboard/leaderboard/players"` */
export function dashboardPath(page, tab = "") {
  const resolved = resolveSection(page) || "home";
  if (ACCOUNT_SECTION_PATHS[resolved]) return ACCOUNT_SECTION_PATHS[resolved];
  const section = SECTIONS[resolved];
  const tabs = section.tabs || [];
  return tabs.includes(tab) ? `${section.path}/${tab}` : section.path;
}

/** `"/dashboard/leaderboard/players" → { page: "board", tab: "players" }`, or null. */
export function parseDashboardPath(pathname) {
  const clean = trimTrailingSlashes(pathname) || HOME_PATH;
  if (clean === HOME_PATH || clean === dashboardAliasPath("/dashboard.html", "home")) {
    return { page: "home", tab: "" };
  }
  // The account settings document owns every other `/dashboard/settings` URL.
  // Returning a route for them made the shell intercept the sidebar link and
  // show this document's board settings instead of navigating to that page.
  const settingsRoot = dashboardAliasPath("/dashboard/settings", "settings.account");
  if (clean === settingsRoot || clean.startsWith(settingsRoot + "/")) return null;
  if (!clean.startsWith(HOME_PATH + "/")) return null;
  const [head, tail] = clean.slice(HOME_PATH.length + 1).split("/");
  const page = resolveSection(head);
  if (!page) return null;
  if (ACCOUNT_SECTION_PATHS[page]) return null;
  const tabs = SECTIONS[page].tabs || [];
  if (tail && !tabs.includes(tail)) return null;
  return { page, tab: tail || "" };
}

export function dashboardTitle(route) {
  if (!route || !SECTIONS[route.page]) return DEFAULT_DASHBOARD_TITLE;
  return chromeStateFor(route.page, route.tab).documentTitle;
}

export function dashboardTitleForPath(pathname) {
  return dashboardTitle(parseDashboardPath(pathname));
}
