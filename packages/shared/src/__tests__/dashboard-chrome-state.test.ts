import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DASHBOARD_SECTION_TITLES,
  DEFAULT_DASHBOARD_TITLE,
  dashboardChromeState,
  dashboardChromeStateForLocation,
} from "../dashboard-chrome-state.js";
import {
  DASHBOARD_ROUTES,
  resolveDashboardPath,
  routeById,
} from "../dashboard-routes.js";

// PR-4: dashboard-chrome-state.ts is the single route → chrome-state owner.
// These tests pin the exact visible chrome (crumbs, labels, titles, rail
// owner) every consumer renders, plus structural invariants that keep the
// computation canonical.

describe("dashboard chrome state — full route coverage", () => {
  it("computes a complete state for every manifest route", () => {
    for (const route of DASHBOARD_ROUTES) {
      const state = dashboardChromeState(route.id);
      expect(state.routeId).toBe(route.id);
      expect(state.navKey).toBe(route.navKey);
      expect(state.section).toBe(route.section);
      expect(state.tab).toBe(route.tab || "");
      expect(state.canonicalPath).toBe(route.canonicalPath);
      expect(state.documentTitle.endsWith(" · YourRank"), route.id).toBe(true);
      expect(
        state.documentTitle.includes("undefined") || state.documentTitle.includes("null"),
        route.id,
      ).toBe(false);
      if (route.tab) {
        expect(state.tabLabel.length > 0, `${route.id} tabLabel`).toBe(true);
      }
    }
  });

  it("addresses every crumb through the manifest and never links the leaf", () => {
    for (const route of DASHBOARD_ROUTES) {
      const { crumbs } = dashboardChromeState(route.id);
      for (const crumb of crumbs) {
        expect(crumb.label.length > 0, route.id).toBe(true);
        if (crumb.href) {
          // Every linked crumb resolves in the canonical route model.
          expect(resolveDashboardPath(crumb.href), `${route.id} → ${crumb.href}`).toBeDefined();
        }
      }
      if (crumbs.length > 0) {
        expect(crumbs[crumbs.length - 1].href, `${route.id} leaf must not link`).toBeUndefined();
      }
    }
  });

  it("gives the chrome-owned H1 to Telegram document pages only", () => {
    for (const route of DASHBOARD_ROUTES) {
      const state = dashboardChromeState(route.id);
      if (route.section === "telegram") {
        expect(typeof state.h1).toBe("string");
        expect((state.h1 as string).length > 0).toBe(true);
      } else {
        expect(state.h1, route.id).toBeNull();
      }
    }
  });
});

describe("dashboard chrome state — exact visible behavior pins", () => {
  it("top-level pages ship no breadcrumb trail", () => {
    expect(dashboardChromeState("home").crumbs).toEqual([]);
    // Single-entry trails render nothing (crumbsHtml contract).
    expect(dashboardChromeState("games").crumbs).toEqual([{ label: "Games" }]);
    expect(dashboardChromeState("boards").crumbs).toEqual([{ label: "Sites" }]);
    expect(dashboardChromeState("site").crumbs).toEqual([{ label: "Site settings" }]);
    expect(dashboardChromeState("rewards.overview").crumbs).toEqual([{ label: "Rewards" }]);
  });

  it("pins the leaderboard editor chrome", () => {
    const players = dashboardChromeState("board.players");
    expect(players.navKey).toBe("board");
    expect(players.crumbs).toEqual([
      { label: "Leaderboard", href: "/dashboard/leaderboard" },
      { label: "Players" },
    ]);
    expect(players.documentTitle).toBe("Players · Leaderboard · YourRank");
    // The board root opens on Setup; its crumb says so, its title stays
    // section-level.
    const root = dashboardChromeState("board");
    expect(root.crumbs).toEqual([
      { label: "Leaderboard", href: "/dashboard/leaderboard" },
      { label: "Setup" },
    ]);
    expect(root.documentTitle).toBe("Leaderboard · YourRank");
  });

  it("pins the analytics Sources/Referrals divergence as data", () => {
    const referrals = dashboardChromeState("performance.referrals");
    expect(referrals.tabLabel).toBe("Sources");
    expect(referrals.documentTitle).toBe("Referrals · Analytics · YourRank");
    expect(referrals.crumbs).toEqual([
      { label: "Analytics", href: "/dashboard/analytics" },
      { label: "Sources" },
    ]);
    expect(dashboardChromeState("performance.activity").tabLabel).toBe("Site visitors");
  });

  it("pins the fragment sections' chrome", () => {
    const history = dashboardChromeState("rewards.history");
    expect(history.navKey).toBe("redemptions");
    expect(history.canonicalPath).toBe("/dashboard/rewards/activity");
    expect(history.crumbs).toEqual([
      { label: "Rewards", href: "/dashboard/rewards" },
      { label: "Activity" },
    ]);
    expect(history.documentTitle).toBe("Activity · Rewards · YourRank");

    const channel = dashboardChromeState("siteConnections.channel");
    expect(channel.navKey).toBe("site");
    expect(channel.crumbs).toEqual([
      { label: "Site settings", href: "/dashboard/site" },
      { label: "Connections", href: "/dashboard/site/connections" },
      { label: "Kick connection" },
    ]);
    expect(channel.documentTitle).toBe("Kick connection · Site settings · YourRank");

    const preds = dashboardChromeState("giveaways.preds");
    expect(preds.navKey).toBe("engage");
    expect(preds.crumbs).toEqual([
      { label: "Engagement", href: "/dashboard/giveaways" },
      { label: "Predictions" },
    ]);
    expect(preds.documentTitle).toBe("Engagement · YourRank");

    const viewers = dashboardChromeState("audience.viewers");
    expect(viewers.crumbs).toEqual([
      { label: "Audience", href: "/dashboard/audience/members" },
      { label: "Members" },
    ]);
    expect(viewers.documentTitle).toBe("Members · Audience · YourRank");
  });

  it("pins the account settings chrome", () => {
    const plan = dashboardChromeState("settings.plan");
    expect(plan.navKey).toBe("settings");
    expect(plan.canonicalPath).toBe("/dashboard/settings/billing");
    expect(plan.crumbs).toEqual([
      { label: "Account", href: "/dashboard/settings" },
      { label: "Billing" },
    ]);
    expect(plan.documentTitle).toBe("Account · YourRank");
    expect(dashboardChromeState("settings.account").crumbs).toEqual([
      { label: "Account", href: "/dashboard/settings" },
      { label: "Account" },
    ]);
  });

  it("pins the Telegram chrome", () => {
    const overview = dashboardChromeState("telegram");
    expect(overview.navKey).toBe("telegram");
    expect(overview.h1).toBe("Overview");
    expect(overview.crumbs).toEqual([
      { label: "Telegram", href: "/dashboard/telegram" },
      { label: "Overview" },
    ]);
    const bots = dashboardChromeState("telegram.bots");
    expect(bots.h1).toBe("Bots");
    expect(bots.canonicalPath).toBe("/dashboard/telegram/bots");
    expect(bots.crumbs).toEqual([
      { label: "Telegram", href: "/dashboard/telegram" },
      { label: "Bots" },
    ]);
  });

  it("pins section-level document titles", () => {
    expect(dashboardChromeState("home").documentTitle).toBe("Home · YourRank");
    expect(dashboardChromeState("games").documentTitle).toBe("Games · YourRank");
    expect(dashboardChromeState("boards").documentTitle).toBe("Sites · YourRank");
    expect(dashboardChromeState("site").documentTitle).toBe("Site settings · YourRank");
    expect(dashboardChromeState("settings.team").documentTitle).toBe("Account · YourRank");
    expect(dashboardChromeState("giveaways.raffles").documentTitle).toBe("Engagement · YourRank");
    expect(dashboardChromeState("telegram.broadcasts").documentTitle).toBe("Telegram · YourRank");
    expect(DEFAULT_DASHBOARD_TITLE).toBe("Dashboard · YourRank");
  });
});

describe("dashboard chrome state — location resolution", () => {
  it("resolves full locations through the canonical resolver", () => {
    expect(dashboardChromeStateForLocation("/dashboard/settings", "?tab=team")?.routeId).toBe("settings.team");
    expect(dashboardChromeStateForLocation("/dashboard/settings", "?plan")?.routeId).toBe("settings.plan");
    expect(dashboardChromeStateForLocation("/dashboard", "?nav=games")?.routeId).toBe("games");
    expect(dashboardChromeStateForLocation("/dashboard/leaderboard/players/")?.routeId).toBe("board.players");
    expect(dashboardChromeStateForLocation("/dashboard/rewards/activity")?.routeId).toBe("rewards.history");
    expect(dashboardChromeStateForLocation("/pricing")).toBeUndefined();
  });

  it("matches per-route state exactly", () => {
    for (const route of DASHBOARD_ROUTES) {
      expect(dashboardChromeStateForLocation(route.canonicalPath)).toEqual(
        dashboardChromeState(route.id),
      );
    }
  });
});

describe("dashboard chrome state — one-owner gate", () => {
  it("keeps every route address in the module manifest-derived", () => {
    // The chrome-state source may not contain hard-coded route literals: all
    // addressing goes through routeById()/dashboardAliasPath(). A second
    // route/path registry here would fail this scan.
    const src = readFileSync(new URL("../dashboard-chrome-state.ts", import.meta.url), "utf8")
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

  it("covers every manifest section with a display title", () => {
    for (const route of DASHBOARD_ROUTES) {
      expect(
        DASHBOARD_SECTION_TITLES[route.section as keyof typeof DASHBOARD_SECTION_TITLES],
        route.section,
      ).toBeDefined();
    }
    // …and carries no orphan section (a stale key would be a silent second
    // vocabulary).
    const sections = new Set(DASHBOARD_ROUTES.map((r) => r.section));
    for (const key of Object.keys(DASHBOARD_SECTION_TITLES)) {
      expect(sections.has(key), key).toBe(true);
    }
  });

  it("keeps navKey lookups identical to the manifest rail owners", () => {
    for (const route of DASHBOARD_ROUTES) {
      expect(dashboardChromeState(route.id).navKey).toBe(routeById(route.id).navKey);
    }
  });
});
