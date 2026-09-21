import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DASHBOARD_ROUTES,
  resolveDashboardLocation,
  resolveDashboardPath,
} from "@yourrank/shared/dashboard-routes";
import { dashboardNavItems } from "@yourrank/shared/dashboard-nav";
import { dashboardChromeState } from "@yourrank/shared/dashboard-chrome-state";
import { PAGES } from "../pages.jsx";
import { RewardsChannelPage } from "../pages/rewards.jsx";
import { UnifiedSettingsPage } from "../pages/account.jsx";
import { ENGAGE_TABS } from "../pages/engage-tabs.jsx";
import { REWARDS_TABS } from "../pages/rewards.jsx";
import { defaultTab } from "../assets/dashboard/routes.js";

const palette = readFileSync(new URL("../assets/dashboard/command-palette.js", import.meta.url), "utf8");
const dashboardPageSource = readFileSync(new URL("../pages/dashboard.jsx", import.meta.url), "utf8");
const siteClientSource = readFileSync(new URL("../assets/dashboard/site.js", import.meta.url), "utf8");
const creditsPageSource = readFileSync(new URL("../pages/credits-pages.js", import.meta.url), "utf8");
const creditsClientSource = readFileSync(new URL("../assets/credits.js", import.meta.url), "utf8");

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
            : id === "board" || id.startsWith("board.") || ["site", "boards"].includes(id) ? "board"
              : id === "performance" || id.startsWith("performance.") ? "performance"
                : null;
      if (expected) expect(route.navKey, id).toBe(expected);
    }
    expect(dashboardChromeState("rewards.shop").navKey).toBe("rewards");
    expect(dashboardChromeState("giveaways.chat").navKey).toBe("engage");
    expect(dashboardChromeState("audience.viewers").navKey).toBe("audience");
    expect(dashboardChromeState("board.players").tabLabel).toBe("Leaderboard");
    expect(dashboardChromeState("siteConnections.channel").navKey).toBe("settings");
    expect(dashboardChromeState("siteConnections.channel").navKey).not.toBe("board");
    expect(resolveDashboardLocation("/dashboard/site/connections", "siteId=abc")?.route.id).toBe("siteConnections.channel");
    expect(resolveDashboardLocation("/dashboard/site/connections", "siteId=abc")?.route.navKey).toBe("settings");
    expect(dashboardChromeState("settings.connections").navKey).toBe("settings");
    expect(defaultTab("board")).toBe("setup");
    expect(dashboardChromeState("siteConnections.channel").crumbs).toEqual([
      { label: "Settings", href: "/dashboard/settings/account" },
      { label: "Connections", href: "/dashboard/settings/connections" },
      { label: "Kick connection" },
    ]);
    const channel = RewardsChannelPage({ user: {} }).toString();
    expect(channel).toMatch(/data-nav="settings"[^>]*aria-current="page"/);
    expect(channel).not.toMatch(/data-nav="board"[^>]*aria-current="page"/);
    expect((channel.match(/class="lb-nav[^"]* is-on/g) || []).length).toBe(1);
    const settings = UnifiedSettingsPage({ user: {}, tab: "connections" }).toString();
    expect(settings).toMatch(/data-nav="settings"[^>]*aria-current="page"/);
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
    expect((palette.match(/title: "Connections"/g) || []).length).toBe(1);
    expect(palette).not.toContain('title: "Kick connection"');
    expect(palette).toContain('keywords: "kick channel connection connect integrations providers settings"');
    expect(palette).not.toContain('id: "nav-kick-connection"');
    const boardCommand = palette.match(/\{ id: "nav-board",[^}]+/u)?.[0] || "";
    expect(boardCommand).toContain('requestDashboardRoute("board")');
    expect(boardCommand).not.toContain('"players"');
    const playersCommand = palette.match(/\{ id: "nav-players",[^}]+/u)?.[0] || "";
    expect(playersCommand).toContain('requestDashboardRoute("board", "players")');
  });

  it("boots the palette in every standalone dashboard bundle", () => {
    for (const name of ["activities.js", "people.js", "giveaways.js", "credits.js", "account.js"]) {
      const source = readFileSync(new URL(`../assets/${name}`, import.meta.url), "utf8");
      expect(source).toContain('import "./dashboard/command-palette.js";');
    }
  });

  it("keeps Connections as the only provider-management surface", () => {
    // The old hidden Advanced panel displayed a second Kick status. It made
    // Settings → Connections look non-canonical even though its client fetch
    // still feeds Home's summary projection.
    expect(dashboardPageSource).not.toContain('id="kickStatus"');
    expect(dashboardPageSource).not.toContain('id="kickRewardsLink"');
    expect(siteClientSource).not.toContain('"kickStatus"');
    expect(siteClientSource).toContain('fetch(creditsUrl)');
  });

  it("keeps palette and responsive reward-editor overlays accessible", () => {
    expect(palette).toContain('paletteEl.hidden = true');
    expect(palette).toContain('backdropEl.hidden = true');
    expect(palette).toContain('canRestorePaletteFocus(paletteTrigger)');
    expect(creditsPageSource).toContain('role="region" aria-labelledby="cr-shop-drawer-title"');
    expect(creditsPageSource).toContain('aria-label="Close reward editor"');
    expect(creditsClientSource).toContain('drawer.setAttribute("role", modal ? "dialog" : "region")');
    expect(creditsClientSource).toContain('window.YRDialog?.trap(drawer, closeShop)');
  });

  it("preserves shipped dashboard aliases", () => {
    expect(resolveDashboardPath("/dashboard/editor/players")?.route.id).toBe("board.players");
    expect(resolveDashboardPath("/dashboard/credits")?.route.id).toBe("rewards.overview");
    expect(resolveDashboardPath("/dashboard/giveaways/drops")?.route.id).toBe("activities.overview");
    expect(resolveDashboardPath("/dashboard/rewards/history")?.route.id).toBe("audience.activity");
  });
});
