import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DASHBOARD_ROUTES,
  resolveDashboardPath,
} from "@yourrank/shared/dashboard-routes";
import { dashboardNavItems } from "@yourrank/shared/dashboard-nav";
import { dashboardChromeState } from "@yourrank/shared/dashboard-chrome-state";
import { PAGES } from "../pages.jsx";
import { ENGAGE_TABS } from "../pages/engage-tabs.jsx";
import { REWARDS_TABS } from "../pages/rewards.jsx";

const palette = readFileSync(new URL("../assets/dashboard/command-palette.js", import.meta.url), "utf8");

function dashboardHtml(activePath = "/dashboard") {
  return PAGES.dashboard.Component({ activePath }).toString();
}

describe("Phase 3 dashboard information architecture", () => {
  it("keeps the rail flat and ordered by creator intent", () => {
    expect(dashboardNavItems().map(({ key, label }) => [key, label])).toEqual([
      ["home", "Home"],
      ["board", "Community"],
      ["audience", "Audience"],
      ["engage", "Engage"],
      ["rewards", "Rewards"],
      ["performance", "Insights"],
      ["telegram", "Telegram"],
      ["settings", "Settings"],
    ]);
    expect(dashboardNavItems().every((item) => item.kind !== "group")).toBe(true);

    const sidebar = dashboardHtml().match(/<nav class="lb-side-group lb-side-nav"[\s\S]*?<\/nav>/)?.[0] || "";
    for (const label of ["My board", "Players", "Stats", "Members", "Drops", "Raffles", "Predictions", "Tournaments"]) {
      expect(sidebar).not.toContain(`>${label}</a>`);
    }
  });

  it("assigns each route to the intended rail owner", () => {
    for (const route of DASHBOARD_ROUTES) {
      const { id } = route;
      const expected = id.startsWith("rewards.") ? "rewards"
        : id === "activities.overview" || id.startsWith("giveaways.") ? "engage"
          : id.startsWith("audience.") ? "audience"
            : id === "board" || id.startsWith("board.") || ["site", "boards", "siteConnections.channel"].includes(id) ? "board"
              : id === "performance" || id.startsWith("performance.") ? "performance"
                : null;
      if (expected) expect(route.navKey, id).toBe(expected);
    }
    expect(dashboardChromeState("rewards.shop").navKey).toBe("rewards");
    expect(dashboardChromeState("giveaways.chat").navKey).toBe("engage");
    expect(dashboardChromeState("audience.viewers").navKey).toBe("audience");
    expect(dashboardChromeState("board.players").tabLabel).toBe("Leaderboard");
  });

  it("keeps Engage and Rewards strips separate", () => {
    expect(ENGAGE_TABS.map(({ label }) => label)).toEqual(["Activities", "Giveaways"]);
    expect(REWARDS_TABS.map(({ label }) => label)).toEqual(["Overview", "Ways to earn", "Shop", "Claims"]);
    expect(PAGES.rewardsShop.Component({ user: {} }).toString()).not.toContain("engage-tabs");
  });

  it("renames palette destinations without dropping legacy search terms", () => {
    for (const title of ["Community", "Leaderboard", "Activities", "Giveaways", "Insights", "Rewards", "Members"]) {
      expect(palette).toContain(`title: "${title}"`);
    }
    for (const title of ["My board", "Players", "Stats"]) {
      expect(palette).not.toContain(`title: "${title}"`);
    }
    for (const keyword of ["my board", "players", "stats"]) expect(palette).toContain(keyword);
  });

  it("boots the palette in every standalone dashboard bundle", () => {
    for (const name of ["activities.js", "people.js", "giveaways.js", "credits.js", "account.js"]) {
      const source = readFileSync(new URL(`../assets/${name}`, import.meta.url), "utf8");
      expect(source).toContain('import "./dashboard/command-palette.js";');
    }
  });

  it("preserves shipped dashboard aliases", () => {
    expect(resolveDashboardPath("/dashboard/editor/players")?.route.id).toBe("board.players");
    expect(resolveDashboardPath("/dashboard/credits")?.route.id).toBe("rewards.overview");
    expect(resolveDashboardPath("/dashboard/giveaways/drops")?.route.id).toBe("activities.overview");
    expect(resolveDashboardPath("/dashboard/rewards/history")?.route.id).toBe("audience.activity");
  });
});
