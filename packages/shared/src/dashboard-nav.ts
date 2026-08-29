// Presentation owner for the dashboard rail: labels, icons, grouping and
// ordering live here. ROUTING semantics (paths, route ownership, legacy
// spellings) are derived from the canonical manifest in dashboard-routes.ts
// — this module holds no route table of its own (gated by
// packages/shared/src/__tests__/dashboard-nav.test.ts).
import type { NavItem } from "./dashboard-chrome.js";
import {
  dashboardAliasPath,
  resolveNavRedirect,
  routeById,
  type DashboardRouteId,
} from "./dashboard-routes.js";

const href = (id: DashboardRouteId): string => routeById(id).canonicalPath;

const NAV_ICONS = {
  players: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
  design: '<path d="M12 3a9 9 0 1 0 9 9c0-1.1-.9-2-2-2h-1.5a2.5 2.5 0 0 1-2.5-2.5V6a3 3 0 0 0-3-3z"/><circle cx="7.5" cy="10.5" r=".5"/><circle cx="10.5" cy="7.5" r=".5"/><circle cx="7.5" cy="15.5" r=".5"/>',
  games: '<path d="M6 11h4M8 9v4"/><path d="M15 12h.01M18 10h.01"/><path d="M17.3 5H6.7A4.7 4.7 0 0 0 2 9.7v4.6A4.7 4.7 0 0 0 6.7 19h10.6a4.7 4.7 0 0 0 4.7-4.7V9.7A4.7 4.7 0 0 0 17.3 5z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>',
  boards: '<rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/>',
  giveaways: '<path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
  activities: '<path d="M13 2 4 14h7l-1 8 10-14h-7z"/>',
  shop: '<path d="M3 9l2-5h14l2 5"/><path d="M5 13v7h14v-7M9 20v-5h6v5"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>',
  viewers: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
  audience: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  analytics: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  siteSettings: '<path d="M4 6h10"/><path d="M18 6h2"/><circle cx="16" cy="6" r="2"/><path d="M4 12h2"/><path d="M10 12h10"/><circle cx="8" cy="12" r="2"/><path d="M4 18h10"/><path d="M18 18h2"/><circle cx="16" cy="18" r="2"/>',
};

const GEAR_ICON = '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>';

// The rail is the one primary product navigation. Its visible hierarchy uses
// the creator-facing product model while route scope remains canonical data in
// dashboard-routes.ts and selected-site context stays owned by the topbar.
// "Community" groups the two existing surfaces that shape a site's public
// identity; it does not create a Community entity, route prefix or schema.
// Sites remains account-scoped and top-level until the context selector is a
// complete replacement from every account-scoped surface. Telegram also stays
// top-level because its operational workflows are owner-scoped. Activities is
// a separate safe product boundary; mixed legacy Engagement and restricted
// Games remain explicit transitional destinations rather than being relabeled.
// Group labels are visual hierarchy only — they are not links and collapse
// nothing.
// Hrefs come from the manifest: canonical paths via routeById, plus the two
// entries that deliberately address a registered alias spelling today — the
// Engagement entry (the /dashboard/giveaways section entry, a 302 to the
// chat tab) and Account (the /dashboard/settings root document).
const DASHBOARD_NAV: NavItem[] = [
  { key: "home", label: "Home", href: href("home"), icon: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>', productKey: "sites" },
  { key: "sites", label: "Sites", href: href("boards"), icon: NAV_ICONS.boards, productKey: "sites" },
  {
    key: "community",
    label: "Community",
    kind: "group",
    children: [
      { key: "site", label: "Site", href: href("site"), icon: NAV_ICONS.siteSettings },
      { key: "board", label: "Leaderboard", href: href("board"), icon: NAV_ICONS.players },
    ],
  },
  { key: "activities", label: "Activities", href: href("activities.overview"), icon: NAV_ICONS.activities },
  { key: "audience", label: "People", href: href("audience.viewers"), icon: NAV_ICONS.audience },
  { key: "redemptions", label: "Rewards", href: href("rewards.overview"), icon: NAV_ICONS.shop, productKey: "credits" },
  { key: "performance", label: "Insights", href: href("performance"), icon: NAV_ICONS.analytics },
  { key: "engage", label: "Engagement", href: dashboardAliasPath("/dashboard/giveaways", "giveaways.chat"), icon: NAV_ICONS.giveaways },
  { key: "games", label: "Games", href: href("games"), icon: NAV_ICONS.games },
  { key: "telegram", label: "Telegram", href: href("telegram"), icon: NAV_ICONS.share, productKey: "telegram" },
  { key: "settings", label: "Settings", href: dashboardAliasPath("/dashboard/settings", "settings.account"), icon: GEAR_ICON },
];

// Rail ownership: each accepted spelling (section names, tab names, legacy
// aliases) maps to the manifest ROUTE that owns it; the rendered rail key is
// the route's navKey. The spellings are nav vocabulary; the OWNERSHIP is
// manifest data — change a route's navKey and the rail follows.
const NAV_OWNER_ROUTES = {
  board: "board",
  leaderboard: "board",
  activities: "activities.overview",
  engage: "giveaways.chat",
  giveaways: "giveaways.chat",
  raffles: "giveaways.raffles",
  predictions: "giveaways.preds",
  drops: "giveaways.drops",
  tournaments: "giveaways.tournaments",
  games: "games",
  activity: "performance.activity",
  referrals: "performance.referrals",
  performance: "performance",
  redemptions: "rewards.redemptions",
  overview: "rewards.overview",
  shop: "rewards.shop",
  rules: "rewards.rules",
  rewards: "rewards.overview",
  history: "rewards.history",
  // The Kick connection belongs to the selected site: the channel link is
  // stored on the site row, so its rail owner is Site settings, not Rewards.
  channel: "siteConnections.channel",
  siteConnections: "siteConnections.channel",
  members: "audience.viewers",
  audience: "audience.viewers",
  viewers: "audience.viewers",
  boards: "boards",
  site: "site",
  settings: "settings.account",
  account: "settings.account",
  team: "settings.team",
  plan: "settings.plan",
  connections: "settings.connections",
  data: "settings.data",
  integrations: "settings.connections",
  billing: "settings.plan",
} as const satisfies Readonly<Record<string, DashboardRouteId>>;

export const NAV_OWNER_MAP: { readonly [K in keyof typeof NAV_OWNER_ROUTES]: string } =
  Object.fromEntries(
    Object.entries(NAV_OWNER_ROUTES).map(([key, id]) => [key, routeById(id).navKey]),
  ) as { [K in keyof typeof NAV_OWNER_ROUTES]: string };

export const ACCOUNT_SECTION_PATHS: { readonly plan: string; readonly connections: string } = {
  plan: href("settings.plan"),
  connections: href("settings.connections"),
};

// The exact Locations of the legacy account ?nav= redirects, derived from
// the manifest's encoded ?nav= policy (resolveNavRedirect).
const legacyAccountPath = (nav: string): string => {
  const redirect = resolveNavRedirect(nav);
  /* istanbul ignore next -- these four nav values are manifest aliases */
  if (!redirect) throw new Error(`no ?nav= redirect for ${nav}`);
  return redirect.pathname;
};

export const LEGACY_ACCOUNT_PATHS: Readonly<
  Record<"billing" | "integrations" | "manage" | "settings", string>
> = {
  billing: legacyAccountPath("billing"),
  integrations: legacyAccountPath("integrations"),
  manage: legacyAccountPath("manage"),
  settings: legacyAccountPath("settings"),
};

export function navOwner(nav: string | null | undefined): string {
  return NAV_OWNER_MAP[nav as keyof typeof NAV_OWNER_MAP] || nav || "home";
}

export function dashboardNavItems(): NavItem[] {
  return DASHBOARD_NAV.map((item) => ({ ...item }));
}
