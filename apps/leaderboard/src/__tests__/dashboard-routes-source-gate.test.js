import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DYNAMIC_SECTIONS,
  SECTIONS,
  SECTION_ALIASES,
  dashboardPath,
  dynamicPath,
  legacyDashboardPath,
  parseDashboardPath,
  parseDynamicPath,
  resolveSection,
} from "../assets/dashboard/routes.js";
import {
  DASHBOARD_ROUTES,
  resolveDashboardPath,
  routeById,
} from "@yourrank/shared/dashboard-routes";

// PR-3 regression gate: routes.js must not regain a second dashboard
// route/path registry. Every routing decision derives from the manifest;
// the only route literals allowed in the source are manifest-validated
// dashboardAliasPath(...) lookups.

describe("routes.js source gate", () => {
  it("contains no hard-coded route literal outside manifest-validated lookups", () => {
    const src = readFileSync(
      new URL("../assets/dashboard/routes.js", import.meta.url),
      "utf8",
    )
      // Scan executable source only: comments may name paths in prose.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    const literal = /["'`]\/(?:dashboard|account|bot)(?:[/?#.][^"'`]*)?["'`]/g;
    let match;
    while ((match = literal.exec(src)) !== null) {
      const before = src.slice(Math.max(0, match.index - 40), match.index);
      expect(
        /dashboardAliasPath\(\s*$/.test(before),
        `hard-coded route literal ${match[0]}`,
      ).toBe(true);
    }
  });

  it("derives every SECTIONS path and tab list from the manifest", () => {
    for (const [key, section] of Object.entries(SECTIONS)) {
      expect(section.path).toBe(routeById(key).canonicalPath);
      for (const tab of section.tabs || []) {
        const tabRoute = DASHBOARD_ROUTES.find((r) => r.section === key && r.tab === tab);
        expect(tabRoute, `${key}/${tab}`).toBeDefined();
        expect(section.path + "/" + tab).toBe(tabRoute.canonicalPath);
      }
    }
    expect(SECTIONS.board.tabs).toEqual(["setup", "players", "design", "share", "history"]);
    expect(SECTIONS.performance.tabs).toEqual(["activity", "referrals", "events"]);
  });

  it("derives every dynamic tab path from the manifest", () => {
    for (const [key, section] of Object.entries(DYNAMIC_SECTIONS)) {
      const routes = DASHBOARD_ROUTES.filter((r) => r.section === key && r.tab);
      expect(section.tabs).toEqual(routes.map((r) => r.tab));
      expect(section.tabPaths).toEqual(
        Object.fromEntries(routes.map((r) => [r.tab, r.canonicalPath])),
      );
      expect(section.navKey).toBe(routes[0].navKey);
    }
    // Exact-value behavior pins (previous hand-written tables).
    expect(DYNAMIC_SECTIONS.activities.tabPaths).toEqual({ overview: "/dashboard/activities" });
    expect(DYNAMIC_SECTIONS.rewards.tabPaths).toEqual({
      overview: "/dashboard/rewards",
      shop: "/dashboard/rewards/shop",
      rules: "/dashboard/rewards/rules",
      redemptions: "/dashboard/rewards/redemptions",
      history: "/dashboard/rewards/activity",
    });
    expect(DYNAMIC_SECTIONS.settings.tabPaths).toEqual({
      account: "/dashboard/settings/account",
      team: "/dashboard/settings/team",
      plan: "/dashboard/settings/billing",
      connections: "/dashboard/settings/connections",
      data: "/dashboard/settings/data",
    });
    expect(DYNAMIC_SECTIONS.giveaways.tabPaths).toEqual({
      chat: "/dashboard/giveaways/chat",
      raffles: "/dashboard/giveaways/raffles",
      drops: "/dashboard/giveaways/drops",
      preds: "/dashboard/giveaways/predictions",
      tournaments: "/dashboard/giveaways/tournaments",
    });
    expect(DYNAMIC_SECTIONS.audience.tabPaths).toEqual({
      viewers: "/dashboard/audience/members",
      reviews: "/dashboard/audience/reviews",
    });
    expect(DYNAMIC_SECTIONS.siteConnections.tabPaths).toEqual({ channel: "/dashboard/site/connections" });
  });

  it("pins SECTION_ALIASES to the manifest-backed vocabulary", () => {
    expect(SECTION_ALIASES).toEqual({
      overview: "home",
      editor: "board",
      leaderboard: "board",
      leaderboards: "boards",
      sites: "boards",
      analytics: "performance",
      growth: "performance",
      referrals: "performance",
      integrations: "connections",
      billing: "plan",
    });
  });

  it("preserves exact parse/build behavior", () => {
    expect(parseDashboardPath("/dashboard")).toEqual({ page: "home", tab: "" });
    expect(parseDashboardPath("/dashboard.html")).toEqual({ page: "home", tab: "" });
    expect(parseDashboardPath("/dashboard/leaderboard/players")).toEqual({ page: "board", tab: "players" });
    expect(parseDashboardPath("/dashboard/growth/activity")).toEqual({ page: "performance", tab: "activity" });
    expect(parseDashboardPath("/dashboard/settings")).toBeNull();
    expect(parseDashboardPath("/dashboard/settings/team")).toBeNull();
    expect(parseDashboardPath("/dashboard/billing")).toBeNull();
    expect(parseDashboardPath("/dashboard/rewards")).toBeNull();
    expect(parseDashboardPath("/pricing")).toBeNull();

    expect(dashboardPath("board", "players")).toBe("/dashboard/leaderboard/players");
    expect(dashboardPath("billing")).toBe("/dashboard/settings/billing");
    expect(resolveSection("settings")).toBe("");
    expect(resolveSection("manage")).toBe("");

    expect(parseDynamicPath("/dashboard/rewards")).toEqual({ page: "rewards", tab: "overview", dynamic: true });
    expect(parseDynamicPath("/dashboard/activities")).toEqual({ page: "activities", tab: "overview", dynamic: true });
    expect(parseDynamicPath("/dashboard/rewards/activity")).toEqual({ page: "rewards", tab: "history", dynamic: true });
    expect(parseDynamicPath("/dashboard/rewards/history")).toEqual({ page: "rewards", tab: "history", dynamic: true });
    expect(parseDynamicPath("/dashboard/rewards/maps")).toBeNull();
    expect(parseDynamicPath("/dashboard/giveaways")).toEqual({ page: "giveaways", tab: "chat", dynamic: true });
    expect(parseDynamicPath("/dashboard/giveaways/preds")).toEqual({ page: "giveaways", tab: "preds", dynamic: true });
    expect(parseDynamicPath("/dashboard/audience/members")).toEqual({ page: "audience", tab: "viewers", dynamic: true });
    expect(parseDynamicPath("/dashboard/settings")).toEqual({ page: "settings", tab: "account", dynamic: true });
    expect(parseDynamicPath("/dashboard/settings/billing")).toEqual({ page: "settings", tab: "plan", dynamic: true });
    expect(parseDynamicPath("/dashboard/site/connections")).toEqual({ page: "siteConnections", tab: "channel", dynamic: true });
    expect(parseDynamicPath("/dashboard/site")).toBeNull();

    expect(dynamicPath("rewards", "history")).toBe("/dashboard/rewards/activity");
    expect(dynamicPath("activities", "overview")).toBe("/dashboard/activities");
    expect(dynamicPath("settings", "plan")).toBe("/dashboard/settings/billing");

    expect(legacyDashboardPath("/dashboard/editor")).toBe("/dashboard/leaderboard");
    expect(legacyDashboardPath("/dashboard/editor/players")).toBe("/dashboard/leaderboard/players");
    expect(legacyDashboardPath("/dashboard/boards")).toBe("/dashboard/leaderboards");
    expect(legacyDashboardPath("/dashboard/leaderboard")).toBe("");
  });

  it("keeps every parseable dashboard path resolvable by the manifest", () => {
    // Every canonical spa-section and fragment path the client can produce
    // must resolve in the manifest (no client-only routes).
    for (const [key, section] of Object.entries(SECTIONS)) {
      expect(resolveDashboardPath(section.path)?.route.section, key).toBe(key);
    }
    for (const [key, section] of Object.entries(DYNAMIC_SECTIONS)) {
      for (const path of Object.values(section.tabPaths)) {
        expect(resolveDashboardPath(path)?.route.section, `${key} ${path}`).toBe(key);
      }
    }
  });
});
