// The dashboard is one document.
//
// It used to serve a separate document per section, so every cross-section click
// fell through to `location.href` and rebooted the whole app: full-screen
// "Loading your workspace…", a fresh /api/auth/me, a fresh /api/site. These
// tests pin the single-document contract so that regression cannot come back
// quietly.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { PAGES } from "../pages.jsx";
import { parseDashboardPath } from "../assets/dashboard/routes.js";

const user = { display_name: "Test operator", plan: "pro" };
const shellJs = readFileSync(new URL("../assets/dashboard/shell.js", import.meta.url), "utf8");
const bootJs = readFileSync(new URL("../assets/dashboard.js", import.meta.url), "utf8");
const dashboardCss = readFileSync(new URL("../assets/dashboard-v4.css", import.meta.url), "utf8");

const SPA_SECTIONS = ["home", "board", "site", "games", "performance", "boards"];

function dashboardHtml(activePath) {
  return PAGES.dashboard.Component({ activePath, user }).toString();
}

function sections(html) {
  return [...html.matchAll(/<section class="(lb-page[^"]*)" data-page="([^"]+)"/g)]
    .map((match) => ({ page: match[2], active: /\bis-on\b/.test(match[1]) }));
}

// Every route that renders the dashboard document, with the section it addresses.
const ROUTES = [
  ["/dashboard", "home"],
  ["/dashboard/leaderboard/setup", "board"],
  ["/dashboard/leaderboard/players", "board"],
  ["/dashboard/leaderboard/design", "board"],
  ["/dashboard/leaderboard/share", "board"],
  ["/dashboard/leaderboard/history", "board"],
  ["/dashboard/site", "site"],
  ["/dashboard/games", "games"],
  ["/dashboard/analytics/activity", "performance"],
  ["/dashboard/analytics/referrals", "performance"],
  ["/dashboard/analytics/events", "performance"],
  ["/dashboard/leaderboards", "boards"],
];

describe("dashboard single-document navigation", () => {
  it("never gives Insights the heading of the opening editor tab", () => {
    const html = dashboardHtml("/dashboard/leaderboard/players");
    expect(html).toContain('<h1 id="perfTitle">Overview</h1>');
    expect(dashboardHtml("/dashboard/analytics/referrals")).toContain('<h1 id="perfTitle">Traffic sources</h1>');
  });
  it("ships every section on every dashboard route", () => {
    for (const [path] of ROUTES) {
      const present = sections(dashboardHtml(path)).map((s) => s.page);
      for (const section of SPA_SECTIONS) {
        expect(present, `${path} is missing the ${section} section`).toContain(section);
      }
    }
  });

  it("activates exactly the section the URL addresses", () => {
    for (const [path, expected] of ROUTES) {
      const active = sections(dashboardHtml(path)).filter((s) => s.active).map((s) => s.page);
      expect(active, path).toEqual([expected]);
    }
  });

  it("hides the sections that are not active", () => {
    // Inactive sections stay in the DOM but out of the accessibility tree and
    // out of the layout, so only the addressed section is reachable.
    expect(dashboardCss).toContain(".lb-page:not(.is-on) { display: none; }");
  });

  it("agrees with the client router about which section a route addresses", () => {
    for (const [path, expected] of ROUTES) {
      const parsed = parseDashboardPath(path) || { page: "home" };
      expect(parsed.page, path).toBe(expected);
    }
  });

  it("swaps sections in place instead of loading a new document", () => {
    // navTo() toggles is-on across the sections already in the page.
    expect(shellJs).toContain('document.querySelectorAll(".lb-page").forEach((p) => p.classList.toggle("is-on", p.dataset.page === page));');
    // The hard-navigation fallback survives only for documents this shell does
    // not own (account settings, and Telegram on the bot Worker).
    expect(shellJs).toContain("location.href = destination;");
  });

  it("does not reboot the workspace when moving between sections", () => {
    // Section data loads once, on first visit, through the mounter hook rather
    // than at boot for every section or on every navigation.
    expect(shellJs).toContain("export function registerSectionMounter(fn) { sectionMounter = fn; }");
    expect(shellJs).toContain("sectionMounter?.(page);");
    expect(bootJs).toContain("registerSectionMounter((page) => {");
    // Boot resolves the section from the URL, so a refresh deep in the app lands
    // where the operator was rather than back on Home.
    expect(bootJs).toContain("const route = currentRoute();");
    expect(bootJs).toContain("navTo(route.page, hash);");
  });

  it("keeps breadcrumbs in step with client-side navigation", () => {
    // Crumbs are server-rendered for the opening URL; without this they keep
    // naming the section the operator came from.
    expect(shellJs).toContain("function renderCrumbs(page, tab)");
    expect(shellJs).toContain("renderCrumbs(page, scrollHash);");
  });

  it("closes the mobile drawer for fragment routes and core routes alike", () => {
    const fragmentChrome = shellJs.slice(shellJs.indexOf("export function syncRouteChrome"), shellJs.indexOf("export async function requestDashboardRoute"));
    const coreChrome = shellJs.slice(shellJs.indexOf("export function navTo"), shellJs.indexOf("export function scrollToHash"));
    expect(fragmentChrome).toContain("closeDashboardDrawer();");
    expect(coreChrome).toContain("closeDashboardDrawer();");
    expect(shellJs).toContain('new CustomEvent("yr:dashboard-drawer-close", { detail: { returnFocus: false } })');
  });

  it("keeps browser back and forward inside the app", () => {
    expect(shellJs).toContain('window.addEventListener("popstate"');
    // popstate now handles both core SPA sections and dynamic (fragment)
    // sections; for SPA sections it still calls navTo to swap in place.
    expect(shellJs).toMatch(/popstate[\s\S]{0,2000}navTo\(route\.page, route\.tab\)/);
  });
});
