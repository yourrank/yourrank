import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DASHBOARD_ROUTES,
} from "@yourrank/shared/dashboard-routes";
import {
  dashboardChromeState,
} from "@yourrank/shared/dashboard-chrome-state";
import {
  DYNAMIC_SECTIONS,
  SECTIONS,
  chromeStateFor,
  dashboardTitle,
  dynamicTitle,
  routeIdFor,
} from "../assets/dashboard/routes.js";

// PR-4 regression gate: there is ONE canonical chrome-state computation path
// (@yourrank/shared/dashboard-chrome-state). Route-derived sidebar, breadcrumb
// and title logic must not return to the consumers this PR migrated.

// Every leaderboard source that renders dashboard chrome.
const CHROME_SOURCES = [
  "../pages/dashboard.jsx",
  "../pages/dashboard-shell.jsx",
  "../pages/rewards.jsx",
  "../pages/giveaways.jsx",
  "../pages/audience.jsx",
  "../pages/account.jsx",
  "../assets/dashboard/routes.js",
  "../assets/dashboard/shell.js",
  "../assets/dashboard/performance.js",
  "../assets/dashboard/dynamic-section.js",
];

const read = (rel) =>
  readFileSync(new URL(rel, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

describe("chrome-state one-owner gate (sources)", () => {
  it("contains no local document-title assembly", () => {
    // The only " · YourRank" literal allowed in chrome sources is the 404
    // page's static title (not a manifest route). Everything else must come
    // from dashboardChromeState().documentTitle / DEFAULT_DASHBOARD_TITLE.
    const allowed = new Set(['"Dashboard page not found · YourRank"']);
    for (const rel of CHROME_SOURCES) {
      const src = read(rel);
      for (const match of src.matchAll(/["'`][^"'`\n]*· YourRank[^"'`\n]*["'`]/g)) {
        expect(allowed.has(match[0]), `${rel}: local title literal ${match[0]}`).toBe(true);
      }
    }
  });

  it("contains no resurrected chrome label/crumb tables", () => {
    // Identifiers of the duplicated route-derived tables PR-4 deleted.
    const banned = /\b(TAB_TITLES|TAB_LABELS|SECTION_CRUMBS|CRUMB_LABELS|TAB_NAME_MAP|SITE_CONNECTIONS_CRUMBS|dashboardCrumbs)\b/;
    for (const rel of CHROME_SOURCES) {
      const match = read(rel).match(banned);
      expect(match, `${rel}: resurrected chrome table ${match?.[0]}`).toBeNull();
    }
  });

  it("passes no inline crumb arrays to the shell", () => {
    // Crumb trails must be chrome-state values, not literals built in place.
    for (const rel of CHROME_SOURCES) {
      const src = read(rel);
      expect(/crumbs=\{\[/.test(src), `${rel}: inline crumbs literal`).toBe(false);
      expect(/crumbs:\s*\[\s*\{/.test(src), `${rel}: inline crumbs literal`).toBe(false);
    }
  });
});

describe("chrome-state one-owner gate (runtime)", () => {
  it("routes.js title helpers return the canonical documentTitle", () => {
    for (const [page, section] of Object.entries(SECTIONS)) {
      for (const tab of ["", ...(section.tabs || [])]) {
        expect(dashboardTitle({ page, tab })).toBe(
          dashboardChromeState(routeIdFor(page, tab)).documentTitle,
        );
      }
    }
    for (const [page, section] of Object.entries(DYNAMIC_SECTIONS)) {
      for (const tab of section.tabs) {
        expect(dynamicTitle(page, tab)).toBe(
          dashboardChromeState(routeIdFor(page, tab)).documentTitle,
        );
      }
    }
  });

  it("chromeStateFor is a thin manifest lookup, not a second computation", () => {
    for (const route of DASHBOARD_ROUTES) {
      expect(chromeStateFor(route.section, route.tab || "", { exact: true })).toEqual(
        dashboardChromeState(route.id),
      );
    }
    // Unknown tabs: exact resolves nothing; non-exact falls back to the
    // section root route.
    expect(chromeStateFor("performance", "nope", { exact: true })).toBeNull();
    expect(chromeStateFor("performance", "nope")).toEqual(dashboardChromeState("performance"));
    expect(chromeStateFor("nope")).toBeNull();
  });

  it("pins the exact canonical creator-facing titles", () => {
    expect(dashboardTitle({ page: "home", tab: "" })).toBe("Home · YourRank");
    expect(dashboardTitle({ page: "board", tab: "players" })).toBe("Players · Leaderboard · YourRank");
    expect(dashboardTitle({ page: "board", tab: "" })).toBe("Leaderboard · YourRank");
    expect(dashboardTitle({ page: "performance", tab: "activity" })).toBe("Overview · Insights · YourRank");
    expect(dashboardTitle({ page: "performance", tab: "referrals" })).toBe("Traffic sources · Insights · YourRank");
    expect(dashboardTitle(null)).toBe("Dashboard · YourRank");
    expect(dynamicTitle("rewards", "history")).toBe("Activity · Rewards · YourRank");
    expect(dynamicTitle("rewards")).toBe("Overview · Rewards · YourRank");
    expect(dynamicTitle("siteConnections", "channel")).toBe("Kick connection · Site · YourRank");
    expect(dynamicTitle("audience", "viewers")).toBe("Members · People · YourRank");
    expect(dynamicTitle("settings", "team")).toBe("Settings · YourRank");
    expect(dynamicTitle("giveaways", "raffles")).toBe("Engagement · YourRank");
    expect(dynamicTitle("nope")).toBe("Dashboard · YourRank");
  });
});
