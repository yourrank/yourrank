// Analytics has exactly ONE delivery/rendering implementation.
//
// Analytics is a core SPA section of the persistent dashboard document:
// the Worker serves PAGES.dashboard for its routes, DashboardContent renders
// one `data-page="performance"` body inside the canonical shell, and the
// guarded performance boot/data path owns its rendering. It is NOT a
// standalone document, NOT a fragment, and has no duplicate body, renderer,
// tab wiring, or boot path.
//
// This gate fails if Analytics regains a standalone/fragment/duplicate
// implementation or if route semantics drift away from the manifest.
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  DASHBOARD_ROUTES,
  routeById,
} from "@yourrank/shared/dashboard-routes";
import { PAGES } from "../pages.jsx";
import { DashboardContent, dashboardPage } from "../pages/dashboard.jsx";
import { resolveFragment } from "../index.js";
import {
  DYNAMIC_SECTIONS,
  SECTIONS,
  chromeStateFor,
  defaultTab,
  isDynamicSection,
  parseDashboardPath,
  parseDynamicPath,
} from "../assets/dashboard/routes.js";

const SRC_ROOT = path.resolve(import.meta.dir, "..");
const ANALYTICS_PREFIX = "/dashboard/analytics";
const ANALYTICS_ROUTES = [
  { id: "performance", path: "/dashboard/analytics", tab: "" },
  { id: "performance.activity", path: "/dashboard/analytics/activity", tab: "activity" },
  { id: "performance.referrals", path: "/dashboard/analytics/referrals", tab: "referrals" },
  { id: "performance.events", path: "/dashboard/analytics/events", tab: "events" },
];
const ANALYTICS_TABS = ANALYTICS_ROUTES.slice(1).map(({ tab }) => tab);

/** Every .js/.jsx source file under src, excluding tests and the generated bundle. */
function sourceFiles(dir = SRC_ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      sourceFiles(full, out);
      continue;
    }
    if (!/\.(js|jsx)$/.test(name)) continue;
    if (name === "assets_bundled.js") continue;
    out.push(full);
  }
  return out;
}

function relativeFiles(files) {
  return files.map((file) => path.relative(SRC_ROOT, file));
}

function perfTabAnchors(html) {
  return [...html.matchAll(/<a\b[^>]*data-perf-tab="([^"]+)"[^>]*>/g)]
    .map(([markup, tab]) => ({ markup, tab }));
}

describe("manifest: Analytics delivery identity", () => {
  it("declares all Analytics routes as leaderboard-owned SPA sections", () => {
    for (const expected of ANALYTICS_ROUTES) {
      const route = routeById(expected.id);
      expect({
        canonicalPath: route.canonicalPath,
        section: route.section,
        navKey: route.navKey,
        owner: route.owner,
        delivery: route.delivery,
      }).toEqual({
        canonicalPath: expected.path,
        section: "performance",
        navKey: "performance",
        owner: "leaderboard",
        delivery: "spa-section",
      });
    }
  });

  it("contains exactly the four Analytics route identities and no fragments", () => {
    const analyticsRoutes = DASHBOARD_ROUTES.filter(
      ({ canonicalPath }) =>
        canonicalPath === ANALYTICS_PREFIX || canonicalPath.startsWith(`${ANALYTICS_PREFIX}/`),
    );
    expect(analyticsRoutes.map(({ id }) => id)).toEqual(ANALYTICS_ROUTES.map(({ id }) => id));
    expect(analyticsRoutes.every(({ delivery }) => delivery !== "fragment")).toBe(true);
  });
});

describe("server: Analytics resolves to the one dashboard document owner", () => {
  it("maps every Analytics path to the performance section and expected tab", () => {
    for (const { path: pathname, tab } of ANALYTICS_ROUTES) {
      expect(parseDashboardPath(pathname)).toEqual({ page: "performance", tab });
    }
  });

  it("does not serve any Analytics path as a fragment", () => {
    for (const { path: pathname } of ANALYTICS_ROUTES) {
      expect(resolveFragment(pathname)).toBeNull();
      expect(resolveFragment(`${pathname}/`)).toBeNull();
      expect(resolveFragment(`${pathname}?board=site-1`)).toBeNull();
    }
  });

  it("has no Analytics Worker path literal or dedicated page", () => {
    const indexSource = readFileSync(path.join(SRC_ROOT, "index.js"), "utf8");
    expect(indexSource.match(/\/dashboard\/analytics/g) || []).toHaveLength(0);
    expect(Object.keys(PAGES).filter((key) => /analytics|performance/i.test(key))).toEqual([]);
    expect(PAGES.dashboard).toBe(dashboardPage);
  });
});

describe("client: Analytics is a core SPA section, not a second delivery path", () => {
  it("uses the manifest path and tab order", () => {
    expect(SECTIONS.performance.path).toBe(ANALYTICS_PREFIX);
    expect(SECTIONS.performance.tabs).toEqual(ANALYTICS_TABS);
    expect(SECTIONS.performance.tabs).toEqual(
      DASHBOARD_ROUTES
        .filter(({ section, tab }) => section === "performance" && tab)
        .map(({ tab }) => tab),
    );
  });

  it("is not a dynamic section for any Analytics path", () => {
    expect(isDynamicSection("performance")).toBe(false);
    expect(Object.keys(DYNAMIC_SECTIONS)).not.toContain("performance");
    for (const { path: pathname } of ANALYTICS_ROUTES) {
      expect(parseDynamicPath(pathname)).toBeNull();
    }
  });

  it("computes canonical Analytics chrome state for every tab", () => {
    const expectedChrome = {
      activity: {
        path: "/dashboard/analytics/activity",
        tabLabel: "Site visitors",
        documentTitle: "Site visitors · Analytics · YourRank",
      },
      referrals: {
        path: "/dashboard/analytics/referrals",
        tabLabel: "Sources",
        documentTitle: "Referrals · Analytics · YourRank",
      },
      events: {
        path: "/dashboard/analytics/events",
        tabLabel: "Events",
        documentTitle: "Events · Analytics · YourRank",
      },
    };
    for (const tab of ANALYTICS_TABS) {
      const chrome = chromeStateFor("performance", tab);
      expect(chrome).not.toBeNull();
      expect(chrome.canonicalPath).toBe(expectedChrome[tab].path);
      expect(chrome.navKey).toBe("performance");
      expect(chrome.tabLabel).toBe(expectedChrome[tab].tabLabel);
      expect(chrome.documentTitle).toBe(expectedChrome[tab].documentTitle);
    }
  });
});

describe("markup: one Analytics body", () => {
  it("renders one body and activates only the requested tab", () => {
    const user = { display_name: "Test operator", plan: "pro" };
    const referralsHtml = DashboardContent({
      user,
      activePath: "/dashboard/analytics/referrals",
    }).toString();
    expect(referralsHtml.match(/data-page="performance"/g)).toHaveLength(1);
    expect(referralsHtml.match(/class="v3-analytics-page"/g)).toHaveLength(1);
    expect(referralsHtml.match(/id="perfRangeFilter"/g)).toHaveLength(1);
    const referralsActive = perfTabAnchors(referralsHtml).filter(({ markup }) => /aria-current="page"/.test(markup));
    expect(referralsActive).toHaveLength(1);
    expect(referralsActive[0].tab).toBe("referrals");

    const defaultHtml = DashboardContent({
      user,
      activePath: "/dashboard/analytics",
    }).toString();
    const defaultActive = perfTabAnchors(defaultHtml).filter(({ markup }) => /aria-current="page"/.test(markup));
    expect(defaultActive).toHaveLength(1);
    expect(defaultActive[0].tab).toBe(defaultTab("performance"));
  });

  it("keeps one inactive Analytics body on non-Analytics routes", () => {
    const html = DashboardContent({
      user: { display_name: "Test operator", plan: "pro" },
      activePath: "/dashboard/leaderboard/setup",
    }).toString();
    expect(html.match(/data-page="performance"/g)).toHaveLength(1);
    expect(html).toContain('<section class="lb-page" data-page="performance">');
    expect(perfTabAnchors(html).filter(({ markup }) => /aria-current="page"/.test(markup))).toHaveLength(0);
  });

  it("declares each Analytics body marker in exactly one source file", () => {
    const files = sourceFiles();
    const pageEmitters = files.filter((file) =>
      /<section\b[^>]*\bdata-page="performance"/.test(readFileSync(file, "utf8")),
    );
    const classEmitters = files.filter((file) =>
      /<[A-Za-z][^>]*\bclass="v3-analytics-page"/.test(readFileSync(file, "utf8")),
    );
    expect(relativeFiles(pageEmitters)).toEqual(["pages/dashboard.jsx"]);
    expect(relativeFiles(classEmitters)).toEqual(["pages/dashboard.jsx"]);
  });
});

describe("boot/renderer: one guarded Analytics path", () => {
  it("defines one idempotent initPerformance boot", () => {
    const performanceSource = readFileSync(path.join(SRC_ROOT, "assets/dashboard/performance.js"), "utf8");
    expect(performanceSource.match(/export function initPerformance\(/g)).toHaveLength(1);
    expect(performanceSource).toContain("if (initPerformance._done) return;");
    expect(performanceSource).toContain("initPerformance._done = true;");
  });

  it("calls initPerformance from exactly one site", () => {
    const callers = [];
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      const calls = (source.match(/initPerformance\(/g) || []).length
        - (source.match(/function initPerformance\(/g) || []).length;
      if (calls > 0) callers.push([path.relative(SRC_ROOT, file), calls]);
    }
    expect(callers).toEqual([["assets/dashboard.js", 1]]);
  });

  it("registers the performance renderer exactly once", () => {
    const registrations = [];
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      const calls = (source.match(/registerRouteRenderer\("performance"/g) || []).length;
      if (calls > 0) registrations.push([path.relative(SRC_ROOT, file), calls]);
    }
    expect(registrations).toEqual([["assets/dashboard/performance.js", 1]]);
  });

  it("keeps performance renderers owned by the two data/render modules", () => {
    const renderers = [
      ["renderPerformance", /renderPerformance\(/g, /export function renderPerformance\(/g],
      ["renderPerformanceLoading", /renderPerformanceLoading\(/g, /export function renderPerformanceLoading\(/g],
    ];
    const expected = {
      renderPerformance: [["assets/dashboard/performance.js", 1], ["assets/dashboard/site.js", 1]],
      renderPerformanceLoading: [["assets/dashboard/site.js", 1]],
    };
    for (const [name, callPattern, definitionPattern] of renderers) {
      const callers = [];
      for (const file of sourceFiles()) {
        const source = readFileSync(file, "utf8");
        const calls = (source.match(callPattern) || []).length
          - (source.match(definitionPattern) || []).length;
        if (calls > 0) callers.push([path.relative(SRC_ROOT, file), calls]);
      }
      expect(callers, name).toEqual(expected[name]);
    }
  });

  it("wires Analytics tabs in exactly one JavaScript module", () => {
    const wired = sourceFiles().filter((file) =>
      /querySelectorAll\(\s*["']\[data-perf-tab\]["']\s*\)/.test(readFileSync(file, "utf8")),
    );
    expect(relativeFiles(wired)).toEqual(["assets/dashboard/performance.js"]);
  });

  it("keeps Analytics path and tab semantics canonical", () => {
    const performanceSource = readFileSync(path.join(SRC_ROOT, "assets/dashboard/performance.js"), "utf8");
    expect(performanceSource).not.toContain("/analytics/");
    expect(performanceSource).not.toContain("\\/analytics\\/");
    expect(performanceSource).not.toMatch(/\[\s*["']activity["']\s*,\s*["']referrals["']\s*,\s*["']events["']\s*\]/);
  });
});
