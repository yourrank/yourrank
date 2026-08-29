// Wave 3 PR-3 pinned the authenticated page chrome — page head, breadcrumb and
// primary tab strip — to one owner. Every earlier convergence regressed the same
// way: a feature area quietly grew its own header typography, its own filled tab
// pills or its own copy of the topbar height, and the workspace stopped reading
// as one product. These gates fail on that drift instead of leaving it to review.
import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { PAGES } from "../pages.jsx";
import { SETTINGS_TABS } from "../pages/account.jsx";
import { renderGiveawaysContentHtml } from "../pages/giveaway-pages.js";

const assetsDir = path.resolve(import.meta.dir, "../assets");
const readAsset = (name) => fs.readFileSync(path.join(assetsDir, name), "utf8").replace(/\r\n/g, "\n");
const sheets = fs.readdirSync(assetsDir).filter((file) => file.endsWith(".css"));
const dashboardV4Css = readAsset("dashboard-v4.css");
const giveawaysCss = readAsset("giveaways.css");
const shellNavJs = readAsset("shell-nav.js");
const accountSource = fs.readFileSync(path.resolve(import.meta.dir, "../pages/account.jsx"), "utf8");
const user = { display_name: "Test operator", plan: "pro" };

const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const dashboardHtml = (activePath) => PAGES.dashboard.Component({ activePath, user }).toString();

function activeSectionTabStrips(html) {
  const section = [...html.matchAll(/<section\b[^>]*class="[^"]*\blb-page is-on\b[^"]*"[^>]*>[\s\S]*?<\/section>/g)]
    .map((match) => match[0]);
  const scope = section.length ? section.join("") : html;
  return [...scope.matchAll(/<nav\b[^>]*class="[^"]*\bv3-tabs\b[^"]*"[^>]*>[\s\S]*?<\/nav>/g)].map((match) => match[0]);
}

describe("authenticated page chrome", () => {
  it("keeps page head, breadcrumb and tab paint in one stylesheet", () => {
    const chromeSelector = /(?<![\w-])\.(v3-head|v3-head-sub|v3-head-col|v3-tabs|v3-tab|v3-crumbs|v3-crumb-sep|editor-steps|editor-step|v3-section-title)(?![\w-])/;
    for (const sheet of sheets) {
      if (sheet === "dashboard-v4.css") continue;
      expect({ sheet, paints: chromeSelector.test(withoutComments(readAsset(sheet))) })
        .toEqual({ sheet, paints: false });
    }
    // No second authenticated chrome stylesheet may appear beside it.
    for (const forbidden of ["dashboard-v5.css", "wave3.css", "page-headers.css", "tabs.css", "breadcrumb.css"]) {
      expect(sheets).not.toContain(forbidden);
    }
  });

  it("paints one primary tab language: text-led, underlined, never a filled pill", () => {
    const tabBlock = dashboardV4Css.slice(
      dashboardV4Css.indexOf(".v3-dash[data-auth-workspace] .v3-tabs,"),
      dashboardV4Css.indexOf(".v3-dash[data-auth-workspace] .v3-tab:hover"),
    );
    expect(tabBlock).toContain(".editor-steps");
    expect(tabBlock).toContain("border-bottom: 1px solid var(--ws-line)");
    expect(tabBlock).toContain("border-bottom: 2px solid transparent");
    expect(tabBlock).toContain("overflow-x: auto");
    expect(tabBlock).not.toContain("border-radius: var(--ws-radius)");
    // Selected state carries weight and an underline, so it never rests on colour alone.
    const selected = dashboardV4Css.slice(
      dashboardV4Css.indexOf(".v3-dash[data-auth-workspace] .v3-tab.is-on,"),
      dashboardV4Css.indexOf(".v3-dash[data-auth-workspace] .v3-tab:focus-visible"),
    );
    expect(selected).toContain("font-weight: 650");
    expect(selected).toContain("border-bottom-color: var(--ws-text)");
    // The strip is a horizontal scroll box, so an outset ring would be clipped.
    expect(dashboardV4Css).toMatch(/\.v3-tab:focus-visible,\n\.v3-dash\[data-auth-workspace\] \.editor-step:focus-visible \{\n {2}outline-offset: -2px;/);
    // Feature areas keep their behaviour hooks but not their own tab paint.
    expect(withoutComments(giveawaysCss)).not.toMatch(/\.gw-tab-btn\.is-active/);
    expect(dashboardV4Css).not.toContain(".account-settings-tabs");
    expect(dashboardV4Css).not.toContain(".account-settings-head");
    expect(accountSource).not.toContain("tab-icon");
    expect(SETTINGS_TABS.every((tab) => tab.length === 2)).toBe(true);
  });

  it("derives every sticky page-chrome offset from the shell tokens", () => {
    const stickyOffsets = [...withoutComments(dashboardV4Css).matchAll(/top:\s*(?!0;|auto|100%|calc\(100%)([^;]+);/g)]
      .map((match) => match[1].trim())
      .filter((value) => /^(-?\d|calc\(\s*-?\d)/.test(value));
    expect(stickyOffsets.filter((value) => /\b(64|76|112|153)px\b/.test(value))).toEqual([]);
    expect(dashboardV4Css).toContain("top: var(--ws-topbar-h);");
    expect(dashboardV4Css).toContain("top: calc(var(--ws-topbar-h) + var(--sticky-head-offset, 0px));");
    // The tab strip measures the real head instead of assuming its height.
    expect(shellNavJs).toContain('["#acc-app > .v3-head + .v3-tabs", "#acc-app > .v3-head"]');
    expect(shellNavJs).toContain('["#gw-app > .v3-tabs", "#gw-app > .v3-head"]');
    expect(shellNavJs).not.toContain("account-settings");
    // The editor renders its steps above the step title, so only the strip pins:
    // a second sticky layer would slide the opaque title across its own tabs.
    expect(dashboardV4Css).not.toContain(".design-controls > .v3-section-title");
    expect(shellNavJs).not.toContain("design-controls");
  });

  it("lets a stacked page head collapse to its content height", () => {
    // A 360px flex-basis becomes a minimum *height* once the head stacks, which
    // left a dead gap between the supporting copy and the page action.
    const narrow = dashboardV4Css.slice(dashboardV4Css.indexOf("@media (max-width: 700px)"));
    expect(narrow).toMatch(/\.v3-head-col \{ flex-basis: auto; \}/);
  });

  it("gives every authenticated page exactly one visible H1 and a marked active tab", () => {
    for (const route of [
      "/dashboard",
      "/dashboard/leaderboards",
      "/dashboard/leaderboard/setup",
      "/dashboard/analytics/activity",
      "/dashboard/site",
      "/dashboard/settings/billing",
    ]) {
      const html = dashboardHtml(route);
      const visible = [...html.matchAll(/<h1\b[^>]*>/g)].filter((match) => !match[0].includes("sr-only"));
      expect({ route, h1: visible.length >= 1 }).toEqual({ route, h1: true });
      // The shell ships every section's markup, so only the active section's
      // tab strip is checked for a single marked current tab.
      for (const strip of activeSectionTabStrips(html)) {
        expect({ route, current: (strip.match(/aria-current="page"/g) || []).length })
          .toEqual({ route, current: 1 });
      }
    }
    const engage = renderGiveawaysContentHtml("raffles");
    expect((engage.match(/<h1\b/g) || []).length).toBe(1);
    expect(engage).toContain('class="v3-head v3-head--row"');
    expect((engage.match(/aria-current="page"/g) || []).length).toBe(1);
  });

  it("keeps breadcrumbs quiet and truncatable rather than a second navigation", () => {
    expect(dashboardV4Css).toContain("text-overflow: ellipsis");
    const crumbBlock = dashboardV4Css.slice(
      dashboardV4Css.indexOf(".v3-dash[data-auth-workspace] .v3-crumbs { display: flex;"),
      dashboardV4Css.indexOf(".v3-dash[data-auth-workspace] .v3-crumbs > [aria-current=\"page\"]"),
    );
    expect(crumbBlock).toContain("font: 500 13px/1.3 var(--ws-sans)");
    expect(crumbBlock).toContain("flex-wrap: nowrap");
    expect(crumbBlock).not.toContain("font-size: 1");
  });

  it("keeps route-to-chrome semantics in the shared manifest, not in page code", () => {
    for (const file of ["account.jsx", "rewards.jsx", "audience.jsx", "giveaway-pages.js", "dashboard.jsx"]) {
      const source = fs.readFileSync(path.resolve(import.meta.dir, "../pages", file), "utf8");
      expect({ file, registry: /const\s+[A-Z_]*(TITLES|CRUMBS|BREADCRUMBS|H1S|DOCUMENT_TITLES)\s*=/.test(source) })
        .toEqual({ file, registry: false });
    }
    expect(accountSource).toContain('chromeStateFor("settings", active)');
    // Client-side tab selection must move `aria-current`, or two tabs read as
    // selected once the paint no longer differs by colour.
    const accountJs = readAsset("account.js");
    expect(accountJs).toContain('tab.setAttribute("aria-current", "page")');
    expect(accountJs).toContain('tab.removeAttribute("aria-current")');
  });
});
