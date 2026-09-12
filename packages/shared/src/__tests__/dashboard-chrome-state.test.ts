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
  resolveDashboardLocation,
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
          expect(resolveDashboardLocation(crumb.href)?.route.id, `${route.id} must not link itself`).not.toBe(route.id);
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
    expect(dashboardChromeState("boards").crumbs).toEqual([{ label: "All sites" }]);
    expect(dashboardChromeState("site").crumbs).toEqual([{ label: "Site pages" }]);
    expect(dashboardChromeState("activities.overview").crumbs).toEqual([{ label: "Engage" }]);
    expect(dashboardChromeState("rewards.overview").crumbs).toEqual([{ label: "Engage" }]);
  });

  it("pins the leaderboard editor chrome", () => {
    const players = dashboardChromeState("board.players");
    expect(players.navKey).toBe("board");
    expect(players.crumbs).toEqual([
      { label: "My board", href: "/dashboard/leaderboard" },
      { label: "Players" },
    ]);
    expect(players.documentTitle).toBe("Players · My board · YourRank");
    // The board root opens on Setup; its crumb says so, its title stays
    // section-level.
    const root = dashboardChromeState("board");
    expect(root.crumbs).toEqual([
      { label: "My board" },
      { label: "Setup" },
    ]);
    expect(root.documentTitle).toBe("My board · YourRank");
  });

  it("pins the customer-facing Stats detail labels", () => {
    const referrals = dashboardChromeState("performance.referrals");
    expect(referrals.tabLabel).toBe("Traffic sources");
    expect(referrals.documentTitle).toBe("Traffic sources · Stats · YourRank");
    expect(referrals.crumbs).toEqual([
      { label: "Stats", href: "/dashboard/analytics" },
      { label: "Traffic sources" },
    ]);
    expect(dashboardChromeState("performance.activity").tabLabel).toBe("Overview");
    expect(dashboardChromeState("performance.events").tabLabel).toBe("Public site activity");
  });

  it("pins the fragment sections' chrome", () => {
    const history = dashboardChromeState("audience.activity");
    expect(history.navKey).toBe("audience");
    expect(history.canonicalPath).toBe("/dashboard/audience/activity");
    expect(history.crumbs).toEqual([
      { label: "Members", href: "/dashboard/audience/members" },
      { label: "Activity" },
    ]);
    expect(history.documentTitle).toBe("Activity · Members · YourRank");

    const channel = dashboardChromeState("siteConnections.channel");
    expect(channel.navKey).toBe("board");
    expect(channel.crumbs).toEqual([
      { label: "Site pages", href: "/dashboard/site" },
      { label: "Connections" },
      { label: "Kick connection" },
    ]);
    expect(channel.documentTitle).toBe("Kick connection · Site pages · YourRank");

    const preds = dashboardChromeState("giveaways.preds");
    expect(preds.navKey).toBe("engage");
    expect(preds.crumbs).toEqual([
      { label: "Engage", href: "/dashboard/activities" },
      { label: "Predictions" },
    ]);
    expect(preds.documentTitle).toBe("Engage · YourRank");

    // The Members tab inside the Members section collapses to a single
    // crumb entry (which renders no trail) and a section-level title.
    const viewers = dashboardChromeState("audience.viewers");
    expect(viewers.crumbs).toEqual([
      { label: "Members" },
    ]);
    expect(viewers.documentTitle).toBe("Members · YourRank");
  });

  it("pins the account settings chrome", () => {
    const plan = dashboardChromeState("settings.plan");
    expect(plan.navKey).toBe("settings");
    expect(plan.canonicalPath).toBe("/dashboard/settings/billing");
    expect(plan.crumbs).toEqual([
      { label: "Settings", href: "/dashboard/settings" },
      { label: "Billing" },
    ]);
    expect(plan.documentTitle).toBe("Settings · YourRank");
    expect(dashboardChromeState("settings.account").crumbs).toEqual([
      { label: "Settings" },
      { label: "Account" },
    ]);
  });

  it("pins the Telegram chrome", () => {
    const overview = dashboardChromeState("telegram");
    expect(overview.navKey).toBe("telegram");
    expect(overview.h1).toBe("Overview");
    expect(overview.crumbs).toEqual([
      { label: "Telegram" },
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
    expect(dashboardChromeState("boards").documentTitle).toBe("All sites · YourRank");
    expect(dashboardChromeState("site").documentTitle).toBe("Site pages · YourRank");
    expect(dashboardChromeState("activities.overview").documentTitle).toBe("Engage · YourRank");
    expect(dashboardChromeState("settings.team").documentTitle).toBe("Settings · YourRank");
    expect(dashboardChromeState("giveaways.raffles").documentTitle).toBe("Engage · YourRank");
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
    expect(dashboardChromeStateForLocation("/dashboard/rewards/activity")?.routeId).toBe("audience.activity");
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
