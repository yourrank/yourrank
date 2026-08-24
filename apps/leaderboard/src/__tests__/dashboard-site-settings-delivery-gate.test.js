// Site settings has exactly ONE delivery/rendering implementation.
//
// `/dashboard/site` is a core SPA section of the persistent dashboard
// document: the Worker serves PAGES.dashboard for it, DashboardContent
// renders a single `data-page="site"` body inside the canonical shell, and
// the one guarded boot path (setupSettingsScreen) initializes it. It is NOT
// a fragment, NOT a standalone document, and has no second body or boot.
//
// `/dashboard/site/connections` (Kick connection) is a separate
// manifest-backed fragment route and stays that way.
//
// This gate fails if Site settings regains a second delivery
// implementation/document, a duplicate body, or a duplicate boot path.
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { routeById } from "@yourrank/shared/dashboard-routes";
import { PAGES } from "../pages.jsx";
import { DashboardContent, dashboardPage } from "../pages/dashboard.jsx";
import { resolveFragment } from "../index.js";
import {
  DYNAMIC_SECTIONS,
  SECTIONS,
  chromeStateFor,
  dashboardPath,
  isDynamicSection,
  parseDashboardPath,
  parseDynamicPath,
} from "../assets/dashboard/routes.js";

const SRC_ROOT = path.resolve(import.meta.dir, "..");

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

describe("manifest: site settings delivery identity", () => {
  it("declares /dashboard/site as an spa-section owned by the site rail key", () => {
    const site = routeById("site");
    expect(site.canonicalPath).toBe("/dashboard/site");
    expect(site.delivery).toBe("spa-section");
    expect(site.navKey).toBe("site");
  });

  it("keeps Connections a separate fragment route, not a second Site settings delivery", () => {
    const connections = routeById("siteConnections.channel");
    expect(connections.canonicalPath).toBe("/dashboard/site/connections");
    expect(connections.delivery).toBe("fragment");
    expect(connections.section).toBe("siteConnections");
  });
});

describe("server: /dashboard/site resolves to the one dashboard document owner", () => {
  it("routes /dashboard/site into the core dashboard document", () => {
    expect(parseDashboardPath("/dashboard/site")).toEqual({ page: "site", tab: "" });
    expect(PAGES.dashboard).toBe(dashboardPage);
  });

  it("does not serve /dashboard/site as a fragment", () => {
    expect(resolveFragment("/dashboard/site")).toBeNull();
    expect(resolveFragment("/dashboard/site/")).toBeNull();
    expect(resolveFragment("/dashboard/site?tab=sections")).toBeNull();
  });

  it("still serves the Connections fragment exactly as before", () => {
    expect(resolveFragment("/dashboard/site/connections")).toEqual({ pageKey: "rewardsChannel", tab: "channel" });
  });

  it("has no dedicated Worker handler for /dashboard/site besides the dashboard document", () => {
    const indexSource = readFileSync(path.join(SRC_ROOT, "index.js"), "utf8");
    // The only exact-path branch for the Site settings address family is the
    // separate Connections document; `/dashboard/site` itself must fall
    // through to the parseDashboardPath → PAGES.dashboard branch.
    const exactPathBranches = indexSource.match(/path === "\/dashboard\/site[^"]*"/g) || [];
    expect(exactPathBranches).toEqual(['path === "/dashboard/site/connections"']);
    expect(indexSource).toMatch(/renderHtmlPage\(PAGES\.dashboard,/);
  });
});

describe("client: site settings is a core SPA section, not a second delivery path", () => {
  it("is a core section of the SPA shell", () => {
    expect(Object.keys(SECTIONS)).toContain("site");
    expect(SECTIONS.site.path).toBe("/dashboard/site");
    expect(dashboardPath("site")).toBe("/dashboard/site");
  });

  it("is not a dynamic (fragment-loaded) section", () => {
    expect(isDynamicSection("site")).toBe(false);
    expect(Object.keys(DYNAMIC_SECTIONS)).not.toContain("site");
    expect(parseDynamicPath("/dashboard/site")).toBeNull();
  });

  it("keeps Connections on the dynamic path without claiming /dashboard/site", () => {
    expect(parseDynamicPath("/dashboard/site/connections")).toEqual({ page: "siteConnections", tab: "channel", dynamic: true });
  });

  it("computes site settings chrome from the canonical chrome-state owner", () => {
    const chrome = chromeStateFor("site");
    expect(chrome.canonicalPath).toBe("/dashboard/site");
    expect(chrome.navKey).toBe("site");
    expect(chrome.documentTitle).toContain("Site settings");
  });
});

describe("markup: one Site settings body", () => {
  it("renders exactly one data-page=\"site\" section, active on direct /dashboard/site load", () => {
    const user = { display_name: "Test operator", plan: "pro" };
    const html = DashboardContent({ user, activePath: "/dashboard/site" }).toString();
    expect(html.match(/data-page="site"/g)).toHaveLength(1);
    expect(html).toContain('<section class="lb-page is-on" data-page="site">');
    expect(html.match(/<h1>Site settings<\/h1>/g)).toHaveLength(1);
    expect(html.match(/id="settingsSubline"/g)).toHaveLength(1);

    const homeHtml = DashboardContent({ user, activePath: "/dashboard" }).toString();
    expect(homeHtml.match(/data-page="site"/g)).toHaveLength(1);
    expect(homeHtml).toContain('<section class="lb-page" data-page="site">');
  });

  it("declares the Site settings body markup in exactly one source file", () => {
    // `[data-page="site"]` selector lookups are fine; a second file *emitting*
    // the body markup means a duplicate delivery implementation.
    const emitters = sourceFiles().filter((file) => {
      const source = readFileSync(file, "utf8");
      return /[^[]data-page="site"/.test(source) || /[^[]data-page=\\"site\\"/.test(source);
    });
    expect(emitters.map((f) => path.relative(SRC_ROOT, f))).toEqual(["pages/dashboard.jsx"]);
  });
});

describe("boot: one guarded Site settings initializer", () => {
  it("defines setupSettingsScreen once, guarded by the canonical body", () => {
    const accountSource = readFileSync(path.join(SRC_ROOT, "assets/dashboard/account.js"), "utf8");
    expect(accountSource.match(/export function setupSettingsScreen\(/g)).toHaveLength(1);
    expect(accountSource).toContain('if (!document.querySelector(\'[data-page="site"]\')) return;');
  });

  it("boots Site settings from exactly one call site", () => {
    const callers = [];
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      const calls = (source.match(/setupSettingsScreen\(/g) || []).length
        - (source.match(/function setupSettingsScreen\(/g) || []).length;
      if (calls > 0) callers.push([path.relative(SRC_ROOT, file), calls]);
    }
    expect(callers).toEqual([["assets/dashboard.js", 1]]);
  });

  it("initializes nested site sections only from the canonical boot path", () => {
    const callers = [];
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      const calls = (source.match(/initSiteSections\(\)/g) || []).length
        - (source.match(/function initSiteSections\(\)/g) || []).length;
      if (calls > 0) callers.push(path.relative(SRC_ROOT, file));
    }
    expect(callers).toEqual(["assets/dashboard/account.js"]);
  });
});
