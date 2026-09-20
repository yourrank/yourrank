// Regression gate for Wave 2 PR-2: dashboard-nav.ts is the PRESENTATION
// owner (labels, icons, grouping) and must never regain routing semantics —
// no hard-coded /dashboard (or /account, /bot) route literals and no second
// routing registry. Routing data flows from dashboard-routes.ts only.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ACCOUNT_SECTION_PATHS,
  LEGACY_ACCOUNT_PATHS,
  NAV_OWNER_MAP,
  dashboardNavItems,
  navOwner,
} from "../dashboard-nav.js";
import {
  DASHBOARD_ROUTES,
  resolveDashboardPath,
  resolveNavRedirect,
  routeById,
} from "../dashboard-routes.js";

const flatten = (items: ReturnType<typeof dashboardNavItems>) =>
  items.flatMap((item) => ("children" in item && item.children ? item.children : [item]));

describe("dashboard-nav regression gate: no second routing registry", () => {
  it("contains no hard-coded route literal outside manifest-validated lookups", () => {
    const src = readFileSync(new URL("../dashboard-nav.ts", import.meta.url), "utf8");
    // Every /dashboard, /account or /bot string literal must be the first
    // argument of a dashboardAliasPath(...) manifest lookup, which throws at
    // module load when the alias leaves the manifest. Any other occurrence
    // is a returning hand-written route table.
    const literal = /["'`]\/(?:dashboard|account|bot)(?:[/?#][^"'`]*)?["'`]/g;
    let match;
    while ((match = literal.exec(src)) !== null) {
      const before = src.slice(Math.max(0, match.index - 40), match.index);
      expect(/dashboardAliasPath\(\s*$/.test(before), `hard-coded route literal ${match[0]}`).toBe(true);
    }
  });

  it("derives every rail href from the manifest", () => {
    for (const item of flatten(dashboardNavItems())) {
      const resolved = resolveDashboardPath(item.href);
      expect(resolved, `${item.key} → ${item.href}`).toBeDefined();
    }
    // Behavior pin: the exact hrefs shipped before the derivation.
    expect(Object.fromEntries(flatten(dashboardNavItems()).map((i) => [i.key, i.href]))).toEqual({
      home: routeById("home").canonicalPath,
      board: routeById("board").canonicalPath,
      audience: routeById("audience.viewers").canonicalPath,
      engage: routeById("activities.overview").canonicalPath,
      rewards: routeById("rewards.overview").canonicalPath,
      performance: routeById("performance").canonicalPath,
      telegram: routeById("telegram").canonicalPath,
      settings: "/dashboard/settings",
    });
  });

  it("derives rail ownership from manifest navKeys", () => {
    const navKeys = new Set(DASHBOARD_ROUTES.map((r) => r.navKey));
    for (const [key, owner] of Object.entries(NAV_OWNER_MAP)) {
      expect(navKeys.has(owner), `${key} → ${owner}`).toBe(true);
    }
    // Route ownership remains available for direct legacy URLs even where an
    // owner is intentionally absent from the rendered primary rail (games).
    expect(NAV_OWNER_MAP).toEqual({
      board: "board", leaderboard: "board",
      activities: "engage",
      engage: "engage", giveaways: "engage", raffles: "engage",
      predictions: "engage", drops: "engage", tournaments: "engage",
      games: "games",
      activity: "performance", referrals: "performance", performance: "performance",
      redemptions: "rewards", overview: "rewards", shop: "rewards",
      rules: "rewards", rewards: "rewards", history: "audience",
      channel: "settings", siteConnections: "settings",
      members: "audience", reviews: "audience", audience: "audience", viewers: "audience",
      boards: "board",
      site: "board",
      settings: "settings", account: "settings", team: "settings",
      plan: "settings", connections: "settings", data: "settings",
      integrations: "settings", billing: "settings",
    });
    expect(navOwner("channel")).toBe("settings");
    expect(navOwner("unknown-name")).toBe("unknown-name");
    expect(navOwner(null)).toBe("home");
  });

  it("derives the account path tables from the manifest", () => {
    expect(ACCOUNT_SECTION_PATHS).toEqual({
      plan: routeById("settings.plan").canonicalPath,
      connections: routeById("settings.connections").canonicalPath,
    });
    // LEGACY_ACCOUNT_PATHS is the encoded ?nav= policy's exact Locations.
    for (const [nav, path] of Object.entries(LEGACY_ACCOUNT_PATHS)) {
      expect(resolveNavRedirect(nav)?.pathname, nav).toBe(path);
    }
    expect(LEGACY_ACCOUNT_PATHS).toEqual({
      billing: "/dashboard/settings/billing",
      integrations: "/dashboard/settings/connections",
      manage: "/dashboard/settings",
      settings: "/dashboard/settings",
    });
  });
});
