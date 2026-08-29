import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { appHtml } from "../../../bot/src/dashboard-views/app.ts";
import { PAGES } from "../pages.jsx";
import { dashboardChromeHtml } from "@yourrank/shared/dashboard-chrome";
import { DASHBOARD_ROUTES } from "@yourrank/shared/dashboard-routes";

const root = join(import.meta.dir, "../../../../");
const sharedSrc = join(root, "packages/shared/src");
const leaderboardSrc = join(root, "apps/leaderboard/src");
const botSrc = join(root, "apps/bot/src");
const leaderboardAssets = join(leaderboardSrc, "assets");
const user = { display_name: "Test operator", email: "operator@example.com", plan: "pro" };

function sourceFiles(dir) {
  const files = [];
  function visit(current) {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    );
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") visit(path);
      } else if (
        /\.(?:js|jsx|ts|tsx)$/.test(entry.name) &&
        entry.name !== "assets_bundled.js"
      ) {
        files.push(path);
      }
    }
  }
  visit(dir);
  return files.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

function executableSource(path) {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

function shellCounts(html, { telegram = false } = {}) {
  return {
    root: (html.match(/class="v3-dash"[^>]*data-auth-workspace="true"[^>]*data-shell-drawer="shared"/g) || []).length,
    side: (html.match(/id="lbSide"/g) || []).length,
    topbar: (html.match(/class="lb-topbar"/g) || []).length,
    bento: (html.match(telegram ? /<main class="lb-bento"/g : /<div class="lb-bento"/g) || []).length,
    main: (html.match(/<main\b/g) || []).length,
  };
}

function assertSingleShell(html, { telegram = false } = {}) {
  expect(shellCounts(html, { telegram })).toEqual({
    root: 1,
    side: 1,
    topbar: 1,
    bento: 1,
    main: telegram ? 1 : 0,
  });
}

function assertRouteOwnership() {
  const routes = readFileSync(join(sharedSrc, "dashboard-routes.ts"), "utf8");
  expect(routes).toContain("export const DASHBOARD_ROUTES");
  expect(routes).toContain("export const DASHBOARD_ROUTE_ALIASES");
  expect(DASHBOARD_ROUTES.length).toBeGreaterThan(0);
}

function assertChromeStateOwnership() {
  const state = readFileSync(join(sharedSrc, "dashboard-chrome-state.ts"), "utf8");
  expect(state).toContain("export function dashboardChromeState");
  expect(state).toContain("DASHBOARD_SECTION_TITLES");
  expect(state).toContain("crumbsFor");
}

function assertClientNavigationOwnership() {
  const shellRuntime = executableSource(join(leaderboardAssets, "dashboard/shell.js"));
  const navigationOwners = sourceFiles(leaderboardSrc).filter((path) =>
    /pushState/.test(executableSource(path))
  );
  expect((shellRuntime.match(/export (?:async )?function requestDashboardRoute/g) || []).length).toBe(1);
  // Dashboard routing stays singular in dashboard/shell.js. The public viewer
  // account page keeps the creator it has open in its own /me?site= history and
  // shares nothing with the dashboard shell.
  expect(navigationOwners).toEqual([
    join(leaderboardAssets, "dashboard/shell.js"),
    join(leaderboardAssets, "viewer-dashboard.js"),
  ]);
}

function assertShellStructureOwnership() {
  const sharedShell = readFileSync(join(sharedSrc, "dashboard-chrome.ts"), "utf8");
  const adapter = executableSource(join(leaderboardSrc, "pages/dashboard-shell.jsx"));
  const structuralEmitters = [...sourceFiles(sharedSrc), ...sourceFiles(leaderboardSrc), ...sourceFiles(botSrc)]
    .filter((path) => path !== join(sharedSrc, "dashboard-chrome.ts"))
    .filter((path) => {
      const src = executableSource(path);
      return /class=["'`](?:v3-dash|lb-shell|lb-side|lb-topbar|lb-side-brandrow)["'`]|<aside[^>]+class=["'`]lb-side/.test(src);
  });
  const telegramShellSources = sourceFiles(botSrc)
    .filter((path) => !path.replaceAll("\\", "/").includes("/dashboard-views/pages/"))
    .filter((path) => /class=["'`](?:v3-dash|lb-shell|lb-side|lb-topbar|lb-bento|lb-side-brandrow|v3-crumbs|gm-shell-nav|gm-profile)(?:["'` ])/.test(executableSource(path)));
  expect((sharedShell.match(/function dashboardChromeHtml/g) || []).length).toBe(1);
  expect(adapter).not.toMatch(/class=["'](?:v3-dash|lb-shell|lb-side|lb-topbar|lb-main)["']/);
  expect(structuralEmitters, structuralEmitters.map((path) => relative(root, path)).join(", ")).toEqual([]);
  expect(telegramShellSources, telegramShellSources.map((path) => relative(root, path)).join(", ")).toEqual([]);
}

function assertShellRuntimeOwnership() {
  const runtimeDuplicates = sourceFiles(leaderboardAssets)
    .filter((path) => {
      if (path.endsWith("shell-nav.js")) {
        // shell-nav.js is the canonical authenticated drawer/profile runtime.
        return false;
      }
      if (path.endsWith("contact.js")) {
        // contact.js owns the separate public #helpSide drawer.
        return false;
      }
      return /(?:#lbSide|\.lb-backdrop|data-close-side|data-collapse-side|gm-logout-form)/.test(
        executableSource(path)
      );
    });
  expect(runtimeDuplicates, runtimeDuplicates.map((path) => relative(root, path)).join(", ")).toEqual([]);
  expect(readFileSync(join(leaderboardAssets, "shell-nav.js"), "utf8")).toContain("yr:dashboard-drawer-close");
}

function assertRedirectOwnership() {
  const routeRegistrySources = [...sourceFiles(leaderboardSrc), ...sourceFiles(botSrc)]
    .filter((path) => path !== join(sharedSrc, "dashboard-routes.ts"))
    .filter((path) => /(?:DASHBOARD_ROUTE_ALIASES|NAV_QUERY_ALIASES)\s*=/.test(executableSource(path)));
  expect(routeRegistrySources, routeRegistrySources.map((path) => relative(root, path)).join(", ")).toEqual([]);
}

function assertDeliveryGatesPresent() {
  const requiredGates = [
    "dashboard-analytics-delivery-gate.test.js",
    "dashboard-editor-delivery-gate.test.js",
    "dashboard-sites-list-delivery-gate.test.js",
    "dashboard-chrome-ownership.test.js",
    "dashboard-nav-ownership.test.js",
    "dashboard-route-manifest-parity.test.js",
    "dashboard-legacy-redirects.test.js",
  ];
  for (const file of requiredGates) expect(existsSync(join(import.meta.dir, file))).toBe(true);
  expect(existsSync(join(botSrc, "__tests__/telegram-shell-ownership-gate.test.ts"))).toBe(true);
}

function assertWorkerOwnership() {
  expect(existsSync(join(root, "apps/leaderboard/wrangler.toml"))).toBe(true);
  expect(existsSync(join(root, "apps/bot/wrangler.toml"))).toBe(true);
  expect(DASHBOARD_ROUTES.filter((route) => route.owner === "bot").length).toBeGreaterThan(0);
  expect(DASHBOARD_ROUTES.filter((route) => route.owner === "leaderboard").length).toBeGreaterThan(0);
}

function assertAntiDuplication() {
  const chromeRegistries = [...sourceFiles(sharedSrc), ...sourceFiles(leaderboardSrc), ...sourceFiles(botSrc)]
    .filter((path) => path !== join(sharedSrc, "dashboard-chrome-state.ts"))
    .filter((path) => /(?:const|let|var)\s+\w*(?:CHROME|DASHBOARD).*(?:LABEL|TITLE|CRUMB)\w*\s*=/.test(executableSource(path)));
  expect(chromeRegistries, chromeRegistries.map((path) => relative(root, path)).join(", ")).toEqual([]);
  expect(readFileSync(join(sharedSrc, "dashboard-chrome.ts"), "utf8")).toContain("data-shell-drawer=\"shared\"");
  expect(dashboardChromeHtml).toBeFunction();
}

describe("Wave 2 structural ownership gate", () => {
  it("keeps one authenticated shell per product", () => {
    const telegram = appHtml(user, "https://yourrank.site", "nonce", "overview", undefined, {
      botUsername: "testbot",
      botStatus: "active",
      siteName: "Test site",
    });
    const leaderboard = PAGES.dashboard.Component({ user, activePath: "/dashboard" }).toString();
    assertSingleShell(telegram, { telegram: true });
    assertSingleShell(leaderboard);
  });

  it("keeps route ownership singular", () => {
    assertRouteOwnership();
  });

  it("keeps chrome-state ownership singular", () => {
    assertChromeStateOwnership();
  });

  it("keeps client navigation singular", () => {
    assertClientNavigationOwnership();
  });

  it("keeps shell structure owned by the shared emitter", () => {
    assertShellStructureOwnership();
  });

  it("keeps shell runtime owned by shell-nav.js", () => {
    assertShellRuntimeOwnership();
  });

  it("keeps redirect registries owned by the shared manifest", () => {
    assertRedirectOwnership();
  });

  it("keeps delivery gates present", () => {
    assertDeliveryGatesPresent();
  });

  it("keeps Worker ownership explicit", () => {
    assertWorkerOwnership();
  });

  it("keeps anti-duplication invariants active", () => {
    assertAntiDuplication();
  });
});
