import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dashboardNavItems } from "@yourrank/shared/dashboard-nav";
import { resolveAliasRedirect, routeById } from "@yourrank/shared/dashboard-routes";
import { PAGES } from "../pages.jsx";
import { mapActiveNav } from "../pages/dashboard-shell.jsx";
import { NAV_OWNER_MAP, navOwner, parseDashboardPath } from "../assets/dashboard/routes.js";

const user = { display_name: "Test operator", plan: "pro" };
const worker = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const dashboardJs = readFileSync(new URL("../assets/dashboard.js", import.meta.url), "utf8");
const assetBundle = readFileSync(new URL("../assets_bundled.js", import.meta.url), "utf8");
const boardsJs = readFileSync(new URL("../assets/dashboard/boards.js", import.meta.url), "utf8");
const boardShellJs = readFileSync(new URL("../assets/dashboard/board-shell.js", import.meta.url), "utf8");
const siteSelectorJs = readFileSync(new URL("../assets/dashboard/site-selector.js", import.meta.url), "utf8");
const playersJs = readFileSync(new URL("../assets/dashboard/players.js", import.meta.url), "utf8");
const shellNavJs = readFileSync(new URL("../assets/shell-nav.js", import.meta.url), "utf8");
const dashboardV4Css = readFileSync(new URL("../assets/dashboard-v4.css", import.meta.url), "utf8");
const siteSource = readFileSync(new URL("../site.js", import.meta.url), "utf8");

function dashboardHtml(activePath) {
  return PAGES.dashboard.Component({ activePath, user }).toString();
}

function hrefs(html) {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]);
}

function shellArea(html, tag, endTag) {
  const start = html.indexOf(`<${tag}`);
  const end = html.indexOf(`</${endTag}>`, start);
  return html.slice(start, end);
}

function flattenNav(items) {
  return items.flatMap((item) => "children" in item ? item.children : [item]);
}

describe("dashboard navigation ownership", () => {
  it("groups the rail by data scope, not feature category", () => {
    // Scope evidence (see packages/shared/src/dashboard-nav.ts header):
    // CURRENT-SITE rows are keyed by site_id in the database and follow the
    // topbar selector; GLOBAL/ACCOUNT-OWNED rows are keyed by the user.
    const items = dashboardNavItems();
    const groups = items.filter((item) => "kind" in item && item.kind === "group");
    const topLevel = items.filter((item) => !("kind" in item && item.kind === "group"));

    // One meaningful scope label only — no decorative grouping.
    expect(groups.length).toBe(1);
    expect(groups[0].label).toBe("Current site");

    const currentSiteKeys = groups[0].children.map((child) => child.key);
    const topLevelKeys = topLevel.map((item) => item.key);

    // Sites manages the creator's whole collection of sites
    // (handlers/sites.js lists every site for the user), so it must NOT sit
    // under the selected site.
    expect(currentSiteKeys).not.toContain("sites");
    expect(topLevelKeys).toContain("sites");

    // Telegram bots/offers/broadcasts/commands are keyed by owner_id with no
    // site_id column, so switching the current site cannot own them.
    expect(currentSiteKeys).not.toContain("telegram");
    expect(topLevelKeys).toContain("telegram");

    // Account is creator-global; it must not read as selected-site data.
    expect(currentSiteKeys).not.toContain("settings");
    expect(topLevelKeys).toContain("settings");

    // Only confirmed site_id-scoped destinations live in the group, and Site
    // settings (selected-site by definition) belongs with them — not in a
    // generic Settings group next to Account.
    expect([...currentSiteKeys].sort()).toEqual(
      ["audience", "board", "engage", "games", "performance", "redemptions", "site"].sort()
    );

    // Home stays the global dashboard entry, never inside Current site.
    expect(currentSiteKeys).not.toContain("home");
    expect(topLevelKeys[0]).toBe("home");
  });

  it("keeps the route owner map consistent with the scope grouping", () => {
    // Route ownership is independent of visual grouping: every route still
    // resolves to exactly one rendered rail key.
    const keys = new Set(flattenNav(dashboardNavItems()).map((item) => item.key));
    for (const route of Object.keys(NAV_OWNER_MAP)) {
      expect(keys.has(navOwner(route))).toBe(true);
    }
    for (const item of flattenNav(dashboardNavItems())) {
      expect(keys.has(item.key)).toBe(true);
    }
    // Kick channel management stays owned by Site settings (Phase 4).
    expect(navOwner("channel")).toBe("site");
    expect(navOwner("siteConnections")).toBe("site");
    // Sites routes still resolve to the Sites rail owner.
    expect(navOwner("boards")).toBe("sites");
  });

  it("keeps every rendered destination owned by one shell area", () => {
    for (const path of ["/dashboard", "/dashboard/leaderboards", "/dashboard/site"]) {
      const html = dashboardHtml(path);
      const rail = new Set(hrefs(shellArea(html, "aside", "aside")));
      const topbar = new Set(hrefs(shellArea(html, "header", "header")));
      expect([...rail].filter((href) => topbar.has(href))).toEqual([]);
    }
  });

  it("keeps site creation on the Sites page rather than the topbar", () => {
    const overview = dashboardHtml("/dashboard");
    const sites = dashboardHtml("/dashboard/leaderboards");
    const overviewTopbar = shellArea(overview, "header", "header");
    const sitesTopbar = shellArea(sites, "header", "header");
    expect(overviewTopbar).not.toContain("newBoard");
    expect(overviewTopbar).not.toContain("boardLimitUpsell");
    expect(sitesTopbar).not.toContain("newBoard");
    expect(sites).toContain('id="newBoard"');
    expect(sites).toContain('id="newBoardForm"');
    expect(sites).toContain('id="boardLimitUpsell"');
    expect(sites).not.toContain('aria-label="Create another site"');
    expect(sites).toContain('title="Create another leaderboard">+ New leaderboard');
    expect(dashboardJs).not.toContain("#newBoardSide, #addBoardBtn");
    expect(boardsJs).not.toContain("addBoardFromBoards");
    expect(boardsJs).toContain('const newBtn = $("newBoard")');
    expect(boardsJs).toContain("renderSiteSelector({");
    expect(boardShellJs).toContain("renderSiteSelector({");
    expect(boardsJs).not.toContain("MANAGE_SITES_VALUE");
    expect(boardShellJs).not.toContain("MANAGE_SITES_VALUE");
    expect(boardShellJs).not.toContain("topbarPath");
    expect(siteSelectorJs).not.toContain("topbarPath");
  });

  it("keeps the leaderboard tabs reachable only on leaderboard routes", () => {
    // Every section ships in the single-document shell, so the leaderboard
    // tablist is always in the markup. It lives inside the board section, which
    // only carries `is-on` on leaderboard routes; everywhere else that section
    // is display:none, so assistive tech never reaches the tabs off-route.
    const boardSection = (html) => {
      const start = html.indexOf('data-page="board"');
      const open = html.lastIndexOf("<section", start);
      const end = html.indexOf("</section>", start);
      return { markup: html.slice(open, end), active: /class="lb-page[^"]*\bis-on\b/.test(html.slice(open, start + 20)) };
    };
    for (const path of ["/dashboard", "/dashboard/games", "/dashboard/analytics/activity", "/dashboard/leaderboards"]) {
      const board = boardSection(dashboardHtml(path));
      expect(board.markup).toContain('aria-label="Leaderboard pages"');
      expect(board.active).toBe(false);
    }
    const onRoute = boardSection(dashboardHtml("/dashboard/leaderboard/setup"));
    expect(onRoute.markup).toContain('aria-label="Leaderboard pages"');
    expect(onRoute.active).toBe(true);
  });

  it("resolves every sidebar href to a real dashboard route", () => {
    for (const { href } of flattenNav(dashboardNavItems())) {
      const path = new URL(href, "https://yourrank.test").pathname;
      const parsed = parseDashboardPath(path);
      const routeHandled = parsed || resolveAliasRedirect(path, "", "leaderboard") ||
        (path === "/dashboard/settings" && worker.includes('path === "/dashboard/settings"')) ||
        (path === "/dashboard/giveaways" && worker.includes('path === "/dashboard/giveaways"')) ||
        (path === "/dashboard/rewards" && worker.includes('path === "/dashboard/rewards"')) ||
        (path === "/dashboard/audience/members" && worker.includes('path === "/dashboard/audience/members"')) ||
        (path === "/dashboard/telegram" && routeById("telegram").canonicalPath === path && readFileSync(new URL("../../../bot/src/dashboard-views/shell.ts", import.meta.url), "utf8").includes('overview: "telegram"')) ||
        (path.startsWith("/dashboard/giveaways/") && worker.includes('path.startsWith("/dashboard/giveaways/")')) ||
        (path.startsWith("/dashboard/rewards/") && worker.includes('path.startsWith("/dashboard/rewards/")'));
      expect(routeHandled).toBeTruthy();
    }
  });

  it("maps each route to exactly one visible navigation key", () => {
    const keys = new Set(flattenNav(dashboardNavItems()).map((item) => item.key));
    const items = Object.fromEntries(flattenNav(dashboardNavItems()).map((item) => [item.key, item]));
    expect(items.sites.icon).not.toBe(items.site.icon);
    for (const [route, owner] of [
      ["home", "home"],
      ["board", "board"],
      ["games", "games"],
      ["performance", "performance"],
      ["telegram", "telegram"],
      ["boards", "sites"],
      ["settings", "settings"],
      ["account", "settings"],
      ["connections", "settings"],
      ["integrations", "settings"],
      ["redemptions", "redemptions"],
      ["overview", "redemptions"],
      ["rules", "redemptions"],
      ["shop", "redemptions"],
      ["history", "redemptions"],
      ["channel", "site"],
      ["siteConnections", "site"],
      ["members", "audience"],
      ["audience", "audience"],
      ["viewers", "audience"],
      ["engage", "engage"],
      ["giveaways", "engage"],
      ["raffles", "engage"],
      ["predictions", "engage"],
      ["drops", "engage"],
    ]) {
      expect(navOwner(route)).toBe(owner);
      expect(mapActiveNav(route)).toBe(navOwner(route));
      expect(keys.has(NAV_OWNER_MAP[route] || route)).toBe(true);
    }
    for (const path of ["/dashboard", "/dashboard/leaderboard/setup", "/dashboard/games", "/dashboard/analytics/activity", "/dashboard/leaderboards", "/dashboard/site", "/dashboard/audience/members", "/dashboard/rewards/activity", "/dashboard/settings/billing", "/dashboard/giveaways/predictions"]) {
      expect((dashboardHtml(path).match(/class="lb-nav[^"]* is-on/g) || []).length).toBe(1);
    }
    expect(dashboardHtml("/dashboard/leaderboards")).toContain('data-nav="sites"');
    expect(dashboardHtml("/dashboard/site")).toContain('data-nav="site"');
  });

  it("uses one shared active-navigation map in server and client code", () => {
    const shell = readFileSync(new URL("../pages/dashboard-shell.jsx", import.meta.url), "utf8");
    expect(shell).toContain('from "@yourrank/shared/dashboard-nav"');
    expect(shell).not.toContain("../assets/dashboard/routes.js");
    expect(readFileSync(new URL("../assets/dashboard/shell.js", import.meta.url), "utf8"))
      .not.toContain("const NAV_OWNER_MAP");
    expect(assetBundle).not.toContain("@yourrank/shared/dashboard-nav");
    expect(assetBundle).toContain('"/assets/dashboard/routes.js"');
    for (const [route] of Object.entries(NAV_OWNER_MAP)) {
      expect(mapActiveNav(route)).toBe(navOwner(route));
    }
  });

  it("keeps the site address quiet in the topbar", () => {
    const html = dashboardHtml("/dashboard");
    const share = dashboardHtml("/dashboard/leaderboard/share");
    expect(html).not.toContain('id="lbTopbarSitePath"');
    expect(html).not.toContain(">Web address</span>");
    expect(siteSelectorJs).not.toContain("Web address");
    expect(boardShellJs).not.toContain("Web address");
    expect(share).toContain('id="embedPublicLink"');
    expect(share).toContain('id="embedPublicCopy"');
  });

  it("keeps feature headings and subnavigation clear of the sticky topbar", () => {
    expect(dashboardV4Css).toContain(".lb-page.is-on > .v3-head");
    expect(dashboardV4Css).toContain(".lb-page.is-on > .design-grid > .design-controls > .v3-section-title");
    expect(dashboardV4Css).toContain("top: var(--v3-topbar-h);");
    expect(dashboardV4Css).toContain(".lb-page.is-on > .v3-head + .v3-tabs");
    expect(dashboardV4Css).toContain("top: calc(var(--v3-topbar-h) + var(--v3-sticky-head-offset, 0px));");
    expect(shellNavJs).toContain("ResizeObserver");
    expect(shellNavJs).toContain("--v3-sticky-head-offset");
  });

  it("aligns the topbar band and content to the main column", () => {
    expect(dashboardV4Css).toContain("position: sticky;");
    expect(dashboardV4Css).toContain("top: 0;");
    expect(dashboardV4Css).toContain("margin-inline: calc(-1 * var(--v3-main-pad-inline));");
    expect(dashboardV4Css).toContain("margin: 0 calc(-1 * var(--v3-main-pad-inline));");
    expect(dashboardV4Css).toContain("padding: 0 var(--v3-main-pad-inline) 64px;");
    expect(dashboardV4Css).toContain(".lb-main > .lb-topbar + .lb-bento");
    expect(dashboardV4Css).not.toContain("inset: 0 0 auto var(--v3-sidebar-w);");
    expect(dashboardV4Css).toContain(".lb-topbar-hud");
    expect(dashboardV4Css).toContain(".lb-availability .lb-live-link");
    expect(dashboardV4Css).toContain(".lb-availability .lb-status--published");
    expect(dashboardV4Css).toContain(".lb-publish-action--secondary");
  });

  it("gives identifying names flexible space and full-value hints", () => {
    expect(dashboardV4Css).toContain(".v3-dash[data-auth-workspace] .v3-players-table .player-name {");
    expect(dashboardV4Css).toContain("width: 200px;");
    expect(dashboardV4Css).toContain("min-width: 200px;");
    expect(dashboardV4Css).toContain("min-width: var(--v3-players-table-min-width, 620px);");
    expect(dashboardV4Css).not.toContain("min-width: 1180px;");
    expect(playersJs).toContain("PLAYER_TABLE_BASE_WIDTH = 44 + 56 + 200 + 112 + 112 + 96");
    expect(playersJs).toContain("PLAYER_OPTIONAL_COLUMN_WIDTH = 112");
    expect(playersJs).toContain("--v3-players-table-min-width");
    expect(dashboardV4Css).not.toContain(".v3-players-table th:nth-child(3)");
    expect(dashboardV4Css).not.toContain(".v3-players-table td:nth-child(3)");
    expect(dashboardV4Css).toContain(".ov-player-name {\n  min-width: 0;");
    expect(boardsJs).toContain("renderSiteSelector({");
    expect(siteSelectorJs).toContain("import { esc } from \"./utils.js\";");
    expect(readFileSync(new URL("../assets/dashboard/players.js", import.meta.url), "utf8"))
      .toContain('class="p-name" placeholder="Player name" aria-label="Player name" title="${esc(p.name)}"');
    expect(readFileSync(new URL("../assets/dashboard/overview.js", import.meta.url), "utf8"))
      .toContain('class="ov-player-name" title="${esc(player.name)}"');
  });

  it("keeps delegated site lookup unambiguous", () => {
    expect(siteSource).toContain(
      "FROM sites WHERE id IN (SELECT site_id FROM site_members WHERE user_id=$1) ORDER BY id ASC LIMIT 1"
    );
    expect(siteSource).not.toContain("FROM sites s JOIN site_members sm");
    expect(siteSource).not.toContain("ORDER BY 8 ASC, 1 ASC");
  });
});
