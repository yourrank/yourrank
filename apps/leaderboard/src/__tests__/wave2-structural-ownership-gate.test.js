import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { appHtml } from "../../../bot/src/dashboard-views/app.ts";
import { botNavItems, pageLinks, telegramChrome } from "../../../bot/src/dashboard-views/shell.ts";
import { navListHtml } from "@yourrank/shared/dashboard-chrome";
import { dashboardNavItems } from "@yourrank/shared/dashboard-nav";
import { DASHBOARD_ROUTES, routeById } from "@yourrank/shared/dashboard-routes";

const root = join(import.meta.dir, "../../../../");
const botSrc = join(root, "apps/bot/src");
const leaderboardAssets = join(root, "apps/leaderboard/src/assets");
const user = { display_name: "Test operator", email: "operator@example.com", plan: "pro" };
const pageCases = [
  ["overview", "telegram"],
  ["bots", "telegram.bots"],
  ["commands", "telegram.commands"],
  ["offers", "telegram.offers"],
  ["broadcasts", "telegram.broadcasts"],
];

function sourceFiles(dir, { excludePages = false } = {}) {
  const files = [];
  function visit(current) {
    for (const name of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = join(current, name.name);
      if (name.isDirectory()) visit(path);
      else if (/\.(?:js|jsx|ts|tsx)$/.test(name.name) && !(excludePages && path.includes("/dashboard-views/pages/")) && !path.includes("/__tests__/")) files.push(path);
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

function allMarkup(page, routeId) {
  const html = appHtml(user, "https://yourrank.site", "nonce", page, undefined, {
    botUsername: "testbot",
    botStatus: "active",
    siteName: "Test site",
  });
  const chrome = telegramChrome(page);
  expect((html.match(/class="v3-dash"/g) || []).length).toBe(1);
  expect((html.match(/data-auth-workspace="true"/g) || []).length).toBe(1);
  expect((html.match(/data-shell-drawer="shared"/g) || []).length).toBe(1);
  expect((html.match(/id="lbSide"/g) || []).length).toBe(1);
  expect((html.match(/class="lb-topbar"/g) || []).length).toBe(1);
  expect((html.match(/<main class="lb-bento"/g) || []).length).toBe(1);
  expect((html.match(/class="v3-crumbs"/g) || []).length).toBe(1);
  expect((html.match(/<h1\b/g) || []).length).toBe(1);
  expect((html.match(/<details class="gm-profile\b/g) || []).length).toBe(1);
  expect(html).toContain(`<title>${chrome.documentTitle}</title>`);
  expect(html).toContain(`<h1>${chrome.h1}</h1>`);
  for (const crumb of chrome.crumbs) expect(html).toContain(crumb.label);
  expect(html).toContain(`data-nav="${chrome.navKey}"`);
  expect(html).toContain(`href="${chrome.canonicalPath}"`);
  expect(html).toContain(`<nav class="v3-tabs telegram-tabs`);
  for (const link of pageLinks) expect(html).toContain(`href="${link.href}"`);
  expect(html).toContain(`data-page="${page}"`);
  expect(routeById(routeId).canonicalPath).toBe(chrome.canonicalPath);
  return html;
}

function assertStructuralOwnership() {
  const shell = readFileSync(join(root, "packages/shared/src/dashboard-chrome.ts"), "utf8");
  const adapter = executableSource(join(root, "apps/leaderboard/src/pages/dashboard-shell.jsx"));
  const shellRuntime = executableSource(join(leaderboardAssets, "dashboard/shell.js"));
  const dashboardAssets = sourceFiles(leaderboardAssets);
  const botRuntime = sourceFiles(botSrc, { excludePages: true });

  expect((shell.match(/function dashboardChromeHtml/g) || []).length).toBe(1);
  expect(shell).toContain("data-shell-drawer");
  expect(adapter).not.toMatch(/class=["']lb-shell|class=["']lb-side["']|class=["']lb-topbar["']|class=["']lb-main["']/);

  const structuralEmitters = [...dashboardAssets, ...botRuntime].filter((path) => {
    if (path.endsWith("dashboard-chrome.ts")) return false;
    const src = executableSource(path);
    return /class=["'`](?:lb-shell|lb-side|lb-main|lb-topbar)["'`]|<aside[^>]+class=["'`]lb-side/.test(src);
  });
  expect(structuralEmitters, structuralEmitters.map((path) => relative(root, path)).join(", ")).toEqual([]);

  expect((shellRuntime.match(/export (?:async )?function requestDashboardRoute/g) || []).length).toBe(1);
  const navigationOwners = dashboardAssets.filter((path) => /pushState/.test(executableSource(path)));
  expect(navigationOwners).toEqual([join(leaderboardAssets, "dashboard/shell.js")]);

  const runtimeDuplicates = dashboardAssets.filter((path) => {
    if (path.endsWith("shell-nav.js")) return false;
    if (path.endsWith("contact.js")) return false;
    if (path.endsWith("dashboard/command-palette.js")) return false;
    if (path.endsWith("dashboard/help-drawer.js")) return false;
    return /(?:#lbSide|\.lb-backdrop|data-close-side|gm-logout-form|is-open)/.test(executableSource(path));
  });
  expect(runtimeDuplicates, runtimeDuplicates.map((path) => relative(root, path)).join(", ")).toEqual([]);
  expect(readFileSync(join(leaderboardAssets, "shell-nav.js"), "utf8")).toContain("yr:dashboard-drawer-close");

  const registries = botRuntime.filter((path) => /(?:DASHBOARD_ROUTE_ALIASES|NAV_QUERY_ALIASES)\s*=/.test(executableSource(path)));
  expect(registries).toEqual([]);
  const chromeRegistries = [
    ...sourceFiles(join(root, "packages/shared/src")),
    ...sourceFiles(join(root, "apps/leaderboard/src")),
    ...sourceFiles(join(root, "apps/bot/src")),
  ]
    .filter((path) => !path.endsWith("apps/leaderboard/src/assets_bundled.js"))
    .filter((path) => !path.endsWith("packages/shared/src/dashboard-chrome-state.ts"))
    .filter((path) => /(?:const|let|var)\s+\w*(?:CHROME|DASHBOARD).*(?:LABEL|TITLE|CRUMB)\w*\s*=/.test(executableSource(path)));
  expect(chromeRegistries, chromeRegistries.map((path) => relative(root, path)).join(", ")).toEqual([]);
  expect(DASHBOARD_ROUTES.filter((route) => route.owner === "bot").length).toBeGreaterThan(0);
  expect(readFileSync(join(root, "packages/shared/src/dashboard-routes.ts"), "utf8")).toContain("export const DASHBOARD_ROUTE_ALIASES");
  expect(readFileSync(join(root, "packages/shared/src/dashboard-chrome-state.ts"), "utf8")).toContain("export function dashboardChromeState");

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
  expect(existsSync(join(root, "apps/bot/src/__tests__/telegram-shell-ownership-gate.test.ts"))).toBe(true);
  expect(existsSync(join(root, "apps/leaderboard/wrangler.toml"))).toBe(true);
  expect(existsSync(join(root, "apps/bot/wrangler.toml"))).toBe(true);
}

describe("Wave 2 structural ownership gate", () => {
  it("keeps one canonical authenticated shell for every Telegram page", () => {
    for (const [page, routeId] of pageCases) allMarkup(page, routeId);
  });

  it("keeps Telegram navigation and panels as body-owned content", () => {
    for (const [page] of pageCases) {
      const html = appHtml(user, "https://yourrank.site", "nonce", page);
      expect(html).toContain("telegram-tabs");
      expect(html).toContain(`data-page="${page}"`);
    }
    expect(botNavItems()).toEqual(dashboardNavItems());
    expect(navListHtml(botNavItems(), "telegram", "Telegram")).toContain('data-nav="telegram"');
  });

  it("keeps shell structure owned by dashboardChromeHtml", () => {
    assertStructuralOwnership();
  });

  it("keeps canonical chrome and route registries singular", () => {
    const state = readFileSync(join(root, "packages/shared/src/dashboard-chrome-state.ts"), "utf8");
    const routes = readFileSync(join(root, "packages/shared/src/dashboard-routes.ts"), "utf8");
    expect((state.match(/DASHBOARD_SECTION_TITLES/g) || []).length).toBeGreaterThan(0);
    expect((routes.match(/DASHBOARD_ROUTE_ALIASES/g) || []).length).toBeGreaterThan(0);
    expect(state).toContain("crumbsFor");
    expect(routes).toContain("resolveAliasRedirect");
  });

  it("keeps delivery and Worker ownership gates present", () => {
    assertStructuralOwnership();
  });
});
