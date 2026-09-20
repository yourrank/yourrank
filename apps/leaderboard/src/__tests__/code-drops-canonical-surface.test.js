// Phase 2 dedupe: Activities is the one creator-facing Code Drop surface.
// The retired Giveaways → Drops tab must stay gone from discovery, its old
// address must redirect to Activities (keeping site context, never looping),
// and the shared Code Drop API/persistence that Activities and public claiming
// use must remain registered.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { DASHBOARD_ROUTES, DASHBOARD_ROUTE_ALIASES, resolveAliasRedirect, resolveNavRedirect } from "@yourrank/shared/dashboard-routes";
import { NAV_OWNER_MAP, navOwner, dashboardNavItems } from "@yourrank/shared/dashboard-nav";
import { dashboardChromeStateForLocation } from "@yourrank/shared/dashboard-chrome-state";
import { DYNAMIC_SECTIONS, parseDynamicPath } from "../assets/dashboard/routes.js";
import { renderGiveawaysContentHtml, GIVEAWAY_TABS } from "../pages/giveaway-pages.js";
import { ROUTES } from "../routes.js";
import worker, { resolveFragment } from "../index.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const LEGACY_DROPS = "/dashboard/giveaways/drops";
const ACTIVITIES = "/dashboard/activities";

describe("Code Drops have one canonical creator surface (Activities)", () => {
  it("no longer models Giveaways → Drops as a dashboard route or tab", () => {
    expect(DASHBOARD_ROUTES.find((r) => r.id === "giveaways.drops")).toBeUndefined();
    expect(DASHBOARD_ROUTES.find((r) => r.canonicalPath === LEGACY_DROPS)).toBeUndefined();
    expect(DYNAMIC_SECTIONS.giveaways.tabs).toEqual(["chat", "raffles", "preds", "tournaments"]);
    expect(GIVEAWAY_TABS.map(([tab]) => tab)).toEqual(["chat", "raffles", "preds", "tournaments"]);
    expect(parseDynamicPath(LEGACY_DROPS)).toBeNull();
    expect(resolveFragment(LEGACY_DROPS)).toBeNull();
    expect(dashboardChromeStateForLocation(ACTIVITIES, "?siteId=site-42").documentTitle).toBe("Engage · YourRank");
  });

  it("redirects the legacy Drops address to Activities and preserves site context", async () => {
    const alias = resolveAliasRedirect(LEGACY_DROPS, "?siteId=site-42&viewer=Ghost", "leaderboard");
    expect(alias).toBeDefined();
    expect(alias.routeId).toBe("activities.overview");
    expect(alias.status).toBe(301);
    expect(alias.pathname).toBe(ACTIVITIES);
    expect(alias.search.get("siteId")).toBe("site-42");
    expect(alias.search.get("viewer")).toBe("Ghost");

    const response = await worker.fetch(new Request(`https://yourrank.site${LEGACY_DROPS}?siteId=site-42`), {}, {});
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(`https://yourrank.site${ACTIVITIES}?siteId=site-42`);

    // The legacy `?nav=drops` spelling also lands on Activities.
    expect(navOwner("drops")).toBe(navOwner("activities"));
    expect(NAV_OWNER_MAP.drops).toBe(NAV_OWNER_MAP.activities);
  });

  it("does not loop: the redirect target is a canonical route, not another alias", () => {
    expect(resolveAliasRedirect(ACTIVITIES, "", "leaderboard")).toBeUndefined();
    expect(resolveNavRedirect("activities")).toBeUndefined();
    expect(DASHBOARD_ROUTE_ALIASES.some((a) => a.path === ACTIVITIES)).toBe(false);
    expect(DASHBOARD_ROUTE_ALIASES.find((a) => a.path === LEGACY_DROPS)?.routeId).toBe("activities.overview");
    expect(DASHBOARD_ROUTES.find((r) => r.id === "activities.overview")?.canonicalPath).toBe(ACTIVITIES);
  });

  it("removes the duplicate Drops pane, drawer and controller from Giveaways", () => {
    for (const tab of ["chat", "raffles", "preds", "tournaments", "drops"]) {
      const html = renderGiveawaysContentHtml(tab);
      expect(html, tab).not.toContain('data-tab="drops"');
      expect(html, tab).not.toContain('id="pane-drops"');
      expect(html, tab).not.toContain('id="cd-drawer"');
      expect(html, tab).not.toContain('id="btn-create-drop"');
      expect(html, tab).not.toContain(LEGACY_DROPS);
    }
    // An unknown/removed tab falls back to the primary Chat giveaways tab.
    expect(renderGiveawaysContentHtml("drops")).toContain('id="tab-btn-chat" href="/dashboard/giveaways/chat" data-tab="chat" role="tab" aria-selected="true"');

    const controller = read("../assets/giveaways.js");
    expect(controller).not.toContain("/api/events/drops");
    expect(controller).not.toContain("loadCodeDrops");
    expect(controller).not.toContain("handleCreateDropSubmit");
    expect(controller).not.toContain("cd-drawer");

    const css = read("../assets/giveaways.css");
    expect(css).not.toContain(".gw-drops-container");
    expect(css).not.toContain("#pane-drops");
    expect(css).not.toContain(".gw-code-input");
  });

  it("keeps Activities as the owner of Code Drop creation and lifecycle", () => {
    const activities = read("../assets/activities.js");
    expect(activities).toContain('sitePath("/api/events/drops", activeSiteId)');
    expect(activities).toContain('sitePath("/api/activities/close", activeSiteId)');

    const registered = (path, method) => ROUTES.some((r) => r.path === path && r.method === method);
    expect(registered("/api/activities", "GET")).toBe(true);
    expect(registered("/api/activities/close", "POST")).toBe(true);
    expect(registered("/api/events/drops", "GET")).toBe(true);
    expect(registered("/api/events/drops", "POST")).toBe(true);
    expect(registered("/api/events/drops/claim", "POST")).toBe(true);
  });

  it("exposes no duplicate Drops destination in navigation, command palette or quick actions", () => {
    expect(dashboardNavItems().some((item) => /drops/i.test(item.label))).toBe(false);
    for (const rel of [
      "../assets/dashboard/command-palette.js",
      "../assets/dashboard/command-context.js",
      "../assets/dashboard/quick-actions.js",
      "../assets/dashboard/shell.js",
      "../assets/dashboard.js",
      "../pages/dashboard-shell.jsx",
      "../pages/engage-tabs.jsx",
      "../assets/activity-pages.js",
    ]) {
      expect(read(rel), rel).not.toContain(LEGACY_DROPS);
      expect(read(rel), rel).not.toContain('"giveaways", "drops"');
    }
    const quick = read("../assets/dashboard/quick-actions.js");
    expect(quick).toContain("drop: `/dashboard/activities");
  });

  it("keeps Giveaways ordered as Chat (primary) with secondary mechanics behind More", () => {
    const html = renderGiveawaysContentHtml("chat");
    expect(html).toContain('id="tab-btn-chat"');
    expect(html).not.toMatch(/id="tab-btn-chat"[^>]*data-tabs-legacy/);
    expect(html).toContain('id="tab-btn-gw-more"');
    for (const tab of ["raffles", "preds", "tournaments"]) {
      expect(html).toMatch(new RegExp(`id="tab-btn-${tab}"[^>]*data-tabs-legacy hidden`));
    }
    const chatIndex = html.indexOf('id="tab-btn-chat"');
    const moreIndex = html.indexOf('id="tab-btn-gw-more"');
    expect(chatIndex).toBeGreaterThan(-1);
    expect(moreIndex).toBeGreaterThan(chatIndex);
  });
});
