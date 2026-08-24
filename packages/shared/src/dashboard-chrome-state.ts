// Canonical dashboard chrome-state owner.
//
// Given a canonical route identity from the manifest (dashboard-routes.ts),
// this module is the single pure computation of the chrome state every
// dashboard surface renders:
//
//   - active sidebar/rail key       (navKey — the manifest rail owner)
//   - active section/tab            (manifest section + tab)
//   - breadcrumb trail              (crumbs — ancestry, leaf never linked)
//   - page H1 label where the chrome owns it (Telegram document pages)
//   - document title
//
// Rendering stays where it is (dashboard-chrome.ts markup helpers, JSX
// shells, the browser shell); rail labels/icons/grouping stay owned by
// dashboard-nav.ts. This module owns only the route → chrome-state mapping
// and the human-readable chrome labels that mapping needs. No consumer may
// keep a second sidebar/breadcrumb/title computation — the regression gates
// in packages/shared/src/__tests__/dashboard-chrome-state.test.ts and
// apps/leaderboard/src/__tests__/dashboard-chrome-state-gate.test.js reject
// re-introduced local label tables and title assembly.
//
// Route addressing derives from the manifest only: canonical paths via
// routeById(), registered legacy spellings via dashboardAliasPath(). No
// second route/path registry exists here.

import {
  dashboardAliasPath,
  resolveDashboardLocation,
  routeById,
  type DashboardRouteDef,
  type DashboardRouteId,
} from "./dashboard-routes.js";

export interface DashboardCrumb {
  readonly label: string;
  readonly href?: string;
}

export interface DashboardChromeState {
  readonly routeId: DashboardRouteId;
  /** Active rail item (manifest navKey) — feed to navListHtml/setActiveSideNav. */
  readonly navKey: string;
  readonly section: string;
  /** Active tab key, "" for section roots. */
  readonly tab: string;
  readonly canonicalPath: string;
  /**
   * Breadcrumb trail as rendered. Trails with fewer than two entries render
   * nothing (crumbsHtml contract) — top-level pages ship no breadcrumb.
   */
  readonly crumbs: readonly DashboardCrumb[];
  /** Human-readable label of the active tab ("" when the route has none). */
  readonly tabLabel: string;
  readonly documentTitle: string;
  /**
   * Page H1 where the chrome owns it (Telegram document pages). null when
   * the section's own content markup owns the heading.
   */
  readonly h1: string | null;
}

export const DEFAULT_DASHBOARD_TITLE = "Dashboard · YourRank";

/** Section display titles (crumb heads + document-title section wording). */
export const DASHBOARD_SECTION_TITLES = {
  home: "Home",
  board: "Leaderboard",
  boards: "Sites",
  games: "Games",
  performance: "Analytics",
  site: "Site settings",
  rewards: "Rewards",
  siteConnections: "Site settings",
  giveaways: "Engagement",
  audience: "Audience",
  settings: "Account",
  telegram: "Telegram",
} as const satisfies Readonly<Record<string, string>>;

// Tab labels as the chrome shows them (breadcrumb leaves, subnav-synced crumb
// text, Telegram page H1s). The Telegram root is its Overview page, so the
// tab-less `telegram` route carries that page's label.
const TAB_LABELS: Readonly<Partial<Record<DashboardRouteId, string>>> = {
  "board.setup": "Setup",
  "board.players": "Players",
  "board.design": "Appearance",
  "board.share": "Share",
  "board.history": "History",
  "performance.activity": "Site visitors",
  "performance.referrals": "Sources",
  "performance.events": "Events",
  "rewards.overview": "Overview",
  "rewards.shop": "Shop",
  "rewards.rules": "Ways to earn",
  "rewards.redemptions": "Orders",
  "rewards.history": "Activity",
  "siteConnections.channel": "Kick connection",
  "giveaways.chat": "Giveaways",
  "giveaways.raffles": "Raffles",
  "giveaways.drops": "Drops",
  "giveaways.preds": "Predictions",
  "giveaways.tournaments": "Tournaments",
  "audience.viewers": "Members",
  "settings.account": "Account",
  "settings.team": "Team",
  "settings.plan": "Billing",
  "settings.connections": "Connections",
  "settings.data": "Data",
  telegram: "Overview",
  "telegram.bots": "Bots",
  "telegram.commands": "Commands",
  "telegram.offers": "Offers",
  "telegram.broadcasts": "Broadcasts",
};

// Document-title wording where it differs from the crumb label. The Analytics
// sources tab has always been titled "Referrals · Analytics · YourRank" while
// its breadcrumb/subnav say "Sources"; both spellings are pinned here so the
// divergence is data, not two competing computations.
const TITLE_TAB_LABELS: Readonly<Partial<Record<DashboardRouteId, string>>> = {
  "performance.referrals": "Referrals",
};

// Sections whose document titles never carry the tab (their documents have
// always been titled at the section level).
const SECTION_TITLED_SECTIONS = new Set(["giveaways", "settings", "telegram"]);

// Fragment sections titled "<tab> · <section> · YourRank".
const TAB_TITLED_SECTIONS = new Set(["rewards", "siteConnections", "audience"]);

/** Breadcrumb head crumb of a section, addressed through the manifest. */
function sectionCrumbHead(section: string): DashboardCrumb | undefined {
  switch (section) {
    case "board":
      return { label: DASHBOARD_SECTION_TITLES.board, href: routeById("board").canonicalPath };
    case "performance":
      return { label: DASHBOARD_SECTION_TITLES.performance, href: routeById("performance").canonicalPath };
    case "rewards":
      return { label: DASHBOARD_SECTION_TITLES.rewards, href: routeById("rewards.overview").canonicalPath };
    case "giveaways":
      // The Engagement crumb links the section's bare entry address, a
      // registered legacy alias of its first tab.
      return { label: DASHBOARD_SECTION_TITLES.giveaways, href: dashboardAliasPath("/dashboard/giveaways", "giveaways.chat") };
    case "audience":
      return { label: DASHBOARD_SECTION_TITLES.audience, href: routeById("audience.viewers").canonicalPath };
    case "settings":
      return { label: DASHBOARD_SECTION_TITLES.settings, href: dashboardAliasPath("/dashboard/settings", "settings.account") };
    case "telegram":
      return { label: DASHBOARD_SECTION_TITLES.telegram, href: routeById("telegram").canonicalPath };
    default:
      return undefined;
  }
}

function crumbLabel(route: DashboardRouteDef): string {
  if (TAB_LABELS[route.id]) return TAB_LABELS[route.id] as string;
  // Tab-less roots of tabbed core sections show their default tab's crumb
  // (the document opens on that tab).
  if (route.id === "board") return TAB_LABELS["board.setup"] as string;
  if (route.id === "performance") return TAB_LABELS["performance.activity"] as string;
  return "";
}

function crumbsFor(route: DashboardRouteDef): readonly DashboardCrumb[] {
  const sectionTitle = DASHBOARD_SECTION_TITLES[route.section as keyof typeof DASHBOARD_SECTION_TITLES];
  switch (route.section) {
    case "home":
      return [];
    case "boards":
    case "games":
    case "site":
      // Top-level pages: a single-entry trail renders no breadcrumb.
      return [{ label: sectionTitle }];
    case "siteConnections":
      // Nested under Site settings → Connections.
      return [
        { label: DASHBOARD_SECTION_TITLES.site, href: routeById("site").canonicalPath },
        { label: "Connections", href: routeById("siteConnections.channel").canonicalPath },
        { label: crumbLabel(route) },
      ];
    case "rewards":
      if (route.id === "rewards.overview") {
        // The section root shows no trail: a single unlinked entry.
        return [{ label: sectionTitle }];
      }
      break;
    default:
      break;
  }
  const head = sectionCrumbHead(route.section);
  const leaf = crumbLabel(route);
  if (!head || !leaf) return head ? [head] : [];
  return [head, { label: leaf }];
}

function documentTitleFor(route: DashboardRouteDef): string {
  const sectionTitle = DASHBOARD_SECTION_TITLES[route.section as keyof typeof DASHBOARD_SECTION_TITLES];
  if (SECTION_TITLED_SECTIONS.has(route.section)) {
    return `${sectionTitle} · YourRank`;
  }
  if (TAB_TITLED_SECTIONS.has(route.section)) {
    return `${TAB_LABELS[route.id]} · ${sectionTitle} · YourRank`;
  }
  // Core SPA sections: the tab appears in the title only when the route
  // addresses one (section roots are titled at the section level).
  const titleTab = route.tab ? (TITLE_TAB_LABELS[route.id] ?? TAB_LABELS[route.id]) : undefined;
  return `${titleTab ? `${titleTab} · ` : ""}${sectionTitle} · YourRank`;
}

/** The canonical chrome state of a dashboard route. Pure and deterministic. */
export function dashboardChromeState(id: DashboardRouteId): DashboardChromeState {
  const route = routeById(id);
  return {
    routeId: route.id,
    navKey: route.navKey,
    section: route.section,
    tab: route.tab || "",
    canonicalPath: route.canonicalPath,
    crumbs: crumbsFor(route),
    tabLabel: TAB_LABELS[route.id] || "",
    documentTitle: documentTitleFor(route),
    h1: route.section === "telegram" ? (TAB_LABELS[route.id] as string) : null,
  };
}

/**
 * Chrome state for a full location (pathname + search), resolved through the
 * canonical location resolver. undefined off the dashboard route model.
 */
export function dashboardChromeStateForLocation(
  pathname: string,
  search?: string | URLSearchParams,
): DashboardChromeState | undefined {
  const location = resolveDashboardLocation(pathname, search);
  return location ? dashboardChromeState(location.routeId) : undefined;
}
