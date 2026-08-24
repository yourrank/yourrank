import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { appHtml } from "../../../bot/src/dashboard-views/app.ts";
import { pageLinks } from "../../../bot/src/dashboard-views/shell.ts";
import { PAGES } from "../pages.jsx";
import { BOARD_TABS, ANALYTICS_TABS } from "../pages/dashboard.jsx";
import { GIVEAWAY_TABS } from "../pages/giveaway-pages.js";
import { REWARDS_TABS } from "../pages/rewards.jsx";
import { SETTINGS_TABS } from "../pages/account.jsx";
import { ACCOUNT_SECTION_PATHS, SECTIONS } from "../assets/dashboard/routes.js";

const user = { display_name: "Test operator", email: "operator@example.com", plan: "pro" };
const workerSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const PERMITTED_DEFAULT_TAB_ROOTS = new Map([
  ["/dashboard/telegram", "Telegram Overview is the section-root back-link owned by the sidebar."],
  ["/dashboard/rewards", "Rewards Overview is the section root and the default tab."],
]);

function linksIn(markup, { excludeContextualActions = false } = {}) {
  return [...markup.matchAll(/<a\b([^>]*?)\bhref="([^"]+)"([^>]*)>/g)]
    .filter((match) => !excludeContextualActions || !/data-chrome-contextual-action(?:="[^"]*")?/.test(`${match[1]}${match[3]}`))
    .map((match) => match[2])
    .filter((href) => href && href !== "#");
}

function region(markup, startPattern, endTag) {
  const start = markup.search(startPattern);
  if (start < 0) return "";
  const end = markup.indexOf(`</${endTag}>`, start);
  if (end < 0) return "";
  return markup.slice(start, end + endTag.length + 3);
}

// The dashboard is a single document: every section ships in the markup and
// navigation swaps them client-side. Only the section carrying `is-on` is
// visible (the rest are display:none), so chrome ownership is judged against
// the active section alone. Non-dashboard routes have no `lb-page` sections, so
// we fall back to the whole document.
function activeSectionMarkup(markup) {
  const onStart = markup.search(/<section\b[^>]*class="lb-page[^"]*\bis-on\b/);
  if (onStart < 0) return markup;
  const rest = markup.slice(onStart + 1);
  const nextSibling = rest.search(/<section\b[^>]*class="lb-page\b/);
  return nextSibling < 0 ? markup.slice(onStart) : markup.slice(onStart, onStart + 1 + nextSibling);
}

function subnavs(markup) {
  return [...activeSectionMarkup(markup).matchAll(/<(nav|div)\b[^>]*class="[^"]*(?:v3-tabs|editor-steps)[^"]*"[^>]*>[\s\S]*?<\/\1>/g)]
    .map((match) => match[0])
    .join("");
}

function breadcrumb(markup) {
  return region(markup, /<nav\b[^>]*class="v3-crumbs"/, "nav");
}

function workerRouteLiterals(source) {
  return [...source.matchAll(/(["'])(\/dashboard[^"']*)\1/g)]
    .map((match) => normalizedPath(match[2]))
    .filter((path) => !path.includes("${") && !path.includes("*"));
}

function workerBranchTabRoutes(source, prefix) {
  const start = source.indexOf(`path.startsWith("${prefix}/")`);
  if (start < 0) return [];
  const end = source.indexOf("\n      if (path.", start + 1);
  const branch = source.slice(start, end < 0 ? source.length : end);
  const tabs = new Set();
  for (const match of branch.matchAll(/tab\s*===\s*"([^"]+)"/g)) tabs.add(match[1]);
  for (const match of branch.matchAll(/\[([^\]]+)\]\.includes\(tab\)/g)) {
    for (const tab of match[1].matchAll(/"([^"]+)"/g)) tabs.add(tab[1]);
  }
  const map = branch.match(/const map = \{([\s\S]*?)\};/);
  if (map) {
    for (const tab of map[1].matchAll(/^\s*([a-z]+):/gm)) tabs.add(tab[1]);
  }
  return [...tabs].map((tab) => `${prefix}/${tab}`);
}

function workerRenderedRewardRoutes(source) {
  const prefix = "/dashboard/rewards";
  const start = source.indexOf(`path.startsWith("${prefix}/")`);
  if (start < 0) return [];
  const end = source.indexOf("\n      //", start + 1);
  const branch = source.slice(start, end < 0 ? source.length : end);
  const routes = [];
  for (const match of branch.matchAll(/if \(tab === "([^"]+)"\) return renderDashboardPage\("([^"]+)"/g)) {
    routes.push({ path: `${prefix}/${match[1]}`, render: "rewards", tab: match[1] });
  }
  const map = branch.match(/const map = \{([\s\S]*?)\};/);
  if (map) {
    for (const match of map[1].matchAll(/^\s*([a-z]+):/gm)) {
      routes.push({ path: `${prefix}/${match[1]}`, render: "rewards", tab: match[1] });
    }
  }
  return routes;
}

function workerRegexTabRoutes(source, prefix) {
  const escapedPrefix = prefix.replaceAll("/", "\\\\/");
  const match = source.match(new RegExp(`${escapedPrefix}\\\\/\\(([^)]+)\\)`));
  if (!match) return [];
  return match[1].split("|").map((tab) => `${prefix}/${tab}`);
}

function normalizedPath(path) {
  return String(path || "").split("?")[0].replace(/\/+$/, "") || "/";
}

function dashboardSectionForPath(path) {
  const normalized = normalizedPath(path);
  const section = Object.entries(SECTIONS)
    .filter(([, definition]) => {
      const sectionPath = normalizedPath(definition.path);
      return normalized === sectionPath || (
        definition.tabs?.length
        && normalized.startsWith(`${sectionPath}/`)
      );
    })
    .sort(([, left], [, right]) => right.path.length - left.path.length)[0];
  if (section) return section[0];

  const accountPaths = Object.values(ACCOUNT_SECTION_PATHS).map(normalizedPath);
  const accountSegments = accountPaths.map((accountPath) => accountPath.split("/"));
  const accountRoot = accountSegments.length
    ? accountSegments[0]
      .filter((segment, index) => accountSegments.every((segments) => segments[index] === segment))
      .join("/")
    : "";
  if (accountRoot && (normalized === accountRoot || normalized.startsWith(`${accountRoot}/`))) {
    return "account";
  }
  return "";
}

function subnavItems(markup) {
  return [...markup.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((match) => ({
      label: match[2]
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim(),
      href: match[1] === "a" ? match[0].match(/\bhref="([^"]+)"/)?.[1] || "" : "",
    }))
    .filter(({ label }) => label);
}

function deriveRenderableRoutes() {
  const routes = [];
  for (const [page, section] of Object.entries(SECTIONS)) {
    const tabs = page === "board"
      ? BOARD_TABS.map(([key]) => key)
      : page === "performance"
        ? ANALYTICS_TABS
        : section.tabs || [];
    const hasSubnav = page === "board" || page === "performance" || page === "site";
    const hasBreadcrumbs = ["board", "performance"].includes(page);
    routes.push({ path: section.path, render: "dashboard", hasSubnav, hasBreadcrumbs });
    for (const tab of tabs) routes.push({ path: `${section.path}/${tab}`, render: "dashboard", hasSubnav: true, hasBreadcrumbs: true });
  }
  for (const [tab] of GIVEAWAY_TABS) {
    routes.push({ path: `/dashboard/giveaways/${tab === "preds" ? "predictions" : tab}`, render: "giveaways", tab, hasSubnav: true, hasBreadcrumbs: true });
  }
  for (const tab of REWARDS_TABS) {
    routes.push({
      path: tab.href,
      render: "rewards",
      tab: tab.key,
      hasSubnav: true,
      hasBreadcrumbs: tab.key !== "overview",
    });
  }
  for (const route of workerRenderedRewardRoutes(workerSource)) {
    if (!routes.some(({ path }) => path === route.path)) {
      routes.push({ ...route, hasSubnav: true, hasBreadcrumbs: true });
    }
  }
  routes.push({ path: "/dashboard/audience/members", render: "rewards", tab: "members", hasSubnav: false, hasBreadcrumbs: true });
  // The Kick connection lives under Site settings → Connections: it renders the
  // channel content without the Rewards subnav, owned by the Site settings rail.
  routes.push({ path: "/dashboard/site/connections", render: "rewards", tab: "channel", hasSubnav: false, hasBreadcrumbs: true });
  routes.push({ path: "/dashboard/settings", render: "settings", tab: "account", hasSubnav: true, hasBreadcrumbs: true });
  for (const [key] of SETTINGS_TABS) {
    routes.push({ path: `/dashboard/settings/${key === "plan" ? "billing" : key}`, render: "settings", tab: key, hasSubnav: true, hasBreadcrumbs: true });
  }
  for (const page of pageLinks) {
    routes.push({ path: page.href, render: "telegram", tab: page.key, hasSubnav: true, hasBreadcrumbs: true });
  }
  return routes;
}

function renderRoute(route) {
  if (route.render === "dashboard") {
    return PAGES.dashboard.Component({ activePath: route.path, user }).toString();
  }
  if (route.render === "giveaways") {
    return PAGES.giveaways.Component({ activePath: route.path, tab: route.tab, user }).toString();
  }
  if (route.render === "settings") {
    return PAGES.settingsUnified.Component({ activePath: route.path, tab: route.tab, user }).toString();
  }
  if (route.render === "rewards") {
    const page = {
      channel: PAGES.rewardsChannel,
      overview: PAGES.rewardsOverview,
      rules: PAGES.rewardsRules,
      shop: PAGES.rewardsShop,
      redemptions: PAGES.rewardsRedemptions,
      members: PAGES.audienceMembers,
      history: PAGES.rewardsHistory,
    }[route.tab];
    if (!page) throw new Error(`No Rewards renderer for ${route.tab}`);
    return page.Component({ activePath: route.path, user }).toString();
  }
  if (route.render === "telegram") {
    return appHtml(user, "https://yourrank.site", undefined, route.tab, undefined, "/dashboard/telegram");
  }
  throw new Error(`No SSR renderer for derived route ${route.path}`);
}

function ownershipViolations(markup, activePath) {
  const sidebarMarkup = region(markup, /<nav\b[^>]*class="lb-side-group lb-side-nav"/, "nav");
  const topbarMarkup = region(markup, /<header\b[^>]*class="lb-topbar"/, "header");
  const subnavMarkup = subnavs(markup);
  const breadcrumbMarkup = breadcrumb(markup);
  const regions = {
    sidebar: linksIn(sidebarMarkup),
    // Contextual setup CTAs are actions, not navigation destinations.
    topbar: linksIn(topbarMarkup, { excludeContextualActions: true }),
    subnav: linksIn(subnavMarkup),
    breadcrumbs: linksIn(breadcrumbMarkup),
  };
  const owned = ["sidebar", "topbar", "subnav"].flatMap((name) =>
    regions[name].map((href) => ({ href, name }))
  );
  const counts = new Map();
  for (const entry of owned) {
    const list = counts.get(entry.href) || [];
    list.push(entry.name);
    counts.set(entry.href, list);
  }
  const duplicates = [...counts.entries()]
    .filter(([, owners]) => owners.length > 1)
    .filter(([href, owners]) => !(
      owners.length === 2
      && owners.includes("sidebar")
      && owners.includes("subnav")
      && PERMITTED_DEFAULT_TAB_ROOTS.has(href)
    ))
    .map(([href, owners]) => ({ href, owners }));
  const sidebarHrefs = new Set(regions.sidebar);
  const sidebarSubnav = [...new Set(regions.subnav.filter((href) =>
    sidebarHrefs.has(href) && !PERMITTED_DEFAULT_TAB_ROOTS.has(href)
  ))];
  const pageSection = dashboardSectionForPath(activePath);
  const foreignSubnav = [...new Map(
    subnavItems(subnavMarkup)
      .filter(({ href }) => href)
      .map(({ href }) => [href, { href, section: dashboardSectionForPath(href) }])
      .filter(([, entry]) => entry.section && entry.section !== pageSection)
  ).values()];
  const labelCounts = new Map();
  for (const { label } of subnavItems(subnavMarkup)) {
    labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
  }
  const duplicateSubnavLabels = [...labelCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([label, count]) => ({ label, count }));
  const active = normalizedPath(activePath);
  const activeBreadcrumbs = regions.breadcrumbs.filter((href) => normalizedPath(href) === active);
  return {
    regions,
    markup: {
      sidebar: sidebarMarkup,
      topbar: topbarMarkup,
      subnav: subnavMarkup,
      breadcrumbs: breadcrumbMarkup,
    },
    duplicates,
    sidebarSubnav,
    foreignSubnav,
    duplicateSubnavLabels,
    activeBreadcrumbs,
  };
}

describe("dashboard chrome ownership", () => {
  it("marks each Rewards route's tab active inside the Rewards subnavigation", () => {
    for (const [path, href, tab] of [
      ["/dashboard/rewards", "/dashboard/rewards", "overview"],
      ["/dashboard/rewards/activity", "/dashboard/rewards/activity", "history"],
    ]) {
      const markup = renderRoute({ path, render: "rewards", tab, hasSubnav: true, hasBreadcrumbs: true });
      expect(markup).toContain(`href="${href}"`);
      expect(markup).toContain(`href="${href}" aria-current="page"`);
    }
  });

  it("marks the members page as the Audience area and links visitor analytics", () => {
    const markup = renderRoute({ path: "/dashboard/audience/members", render: "rewards", tab: "members", hasSubnav: false, hasBreadcrumbs: true });
    expect(markup).toMatch(/data-nav="audience"[^>]*aria-current="page"/);
    expect(markup).toContain('href="/dashboard/analytics"');
  });

  it("covers every renderable Worker route with one rendered chrome invariant", () => {
    const routes = deriveRenderableRoutes();
    expect(new Set(routes.map(({ path }) => path)).size).toBe(routes.length);
    expect(routes.map(({ path }) => path)).toContain("/dashboard/settings/account");
    expect(routes.map(({ path }) => path)).toContain("/dashboard/settings/team");
    expect(routes.map(({ path }) => path)).toContain("/dashboard/settings/billing");
    expect(routes.map(({ path }) => path)).toContain("/dashboard/settings/connections");
    expect(routes.map(({ path }) => path)).toContain("/dashboard/settings/data");
    expect(routes.map(({ path }) => path)).toContain("/dashboard/site/connections");

    const checkedRoutes = new Set(routes.map(({ path }) => normalizedPath(path)));
    const allowlistedWorkerRoutes = new Map([
      ["/dashboard/preview", "POST endpoint for template preview, not a dashboard chrome page"],
      ["/dashboard/support", "redirect-only redirect to help"],
      ["/dashboard/giveaways", "redirect-only section root to the default tab"],
      ["/dashboard/_content", "JSON fragment endpoint for persistent-shell navigation, not a chrome page"],
    ]);
    const workerRoutes = new Set(workerRouteLiterals(workerSource));
    for (const path of workerBranchTabRoutes(workerSource, "/dashboard/giveaways")) workerRoutes.add(path);
    for (const path of workerBranchTabRoutes(workerSource, "/dashboard/rewards")) workerRoutes.add(path);
    for (const path of workerRegexTabRoutes(workerSource, "/dashboard/settings")) workerRoutes.add(path);
    for (const [path, reason] of allowlistedWorkerRoutes) {
      expect(workerRoutes).toContain(path);
      expect(reason.trim()).not.toBe("");
    }
    const uncoveredWorkerRoutes = [...workerRoutes]
      .filter((path) => !checkedRoutes.has(path) && !allowlistedWorkerRoutes.has(path));
    expect(uncoveredWorkerRoutes).toEqual([]);
    for (const path of [
      "/dashboard/giveaways/chat",
      "/dashboard/giveaways/predictions",
      "/dashboard/site/connections",
      "/dashboard/rewards/rules",
      "/dashboard/settings/data",
    ]) {
      expect(workerRoutes).toContain(path);
    }

    for (const route of routes) {
      const markup = renderRoute(route);
      const violations = ownershipViolations(markup, route.path);
      expect(violations.markup.sidebar, `${route.path} sidebar`).not.toBe("");
      expect(violations.markup.topbar, `${route.path} topbar`).not.toBe("");
      if (route.hasSubnav) {
        expect(violations.markup.subnav, `${route.path} subnav`).not.toBe("");
      }
      if (route.hasBreadcrumbs) {
        expect(violations.markup.breadcrumbs, `${route.path} breadcrumbs`).not.toBe("");
      }
      expect(violations.duplicates, route.path).toEqual([]);
      expect(violations.sidebarSubnav, route.path).toEqual([]);
      expect(violations.foreignSubnav, route.path).toEqual([]);
      expect(violations.duplicateSubnavLabels, route.path).toEqual([]);
      expect(violations.activeBreadcrumbs, route.path).toEqual([]);
    }
  });

  it("reports duplicate chrome links and active breadcrumb links", () => {
    const markup = `
      <nav class="lb-side-group lb-side-nav"><a href="/dashboard/leaderboard">Leaderboard</a></nav>
      <header class="lb-topbar"><a href="/dashboard/leaderboard">Leaderboard</a></header>
      <nav class="v3-tabs"><a href="/dashboard/leaderboard/players">Players</a></nav>
      <nav class="v3-crumbs"><a href="/dashboard/leaderboard/players">Players</a></nav>
    `;
    const violations = ownershipViolations(markup, "/dashboard/leaderboard/players");
    expect(violations.duplicates).toEqual([
      { href: "/dashboard/leaderboard", owners: ["sidebar", "topbar"] },
    ]);
    expect(violations.activeBreadcrumbs).toEqual(["/dashboard/leaderboard/players"]);
  });

  it("reports subnav links owned by another sidebar section and duplicate labels", () => {
    const markup = `
      <nav class="lb-side-group lb-side-nav"><a href="/dashboard/site">Site settings</a></nav>
      <nav class="v3-tabs">
        <a href="/dashboard/settings/account">Account</a>
        <a href="/dashboard/settings/team">Account</a>
        <button type="button">Account</button>
      </nav>
    `;
    const violations = ownershipViolations(markup, "/dashboard/site");
    expect(violations.foreignSubnav).toEqual([
      { href: "/dashboard/settings/account", section: "account" },
      { href: "/dashboard/settings/team", section: "account" },
    ]);
    expect(violations.duplicateSubnavLabels).toEqual([
      { label: "Account", count: 3 },
    ]);
  });

  it("permits only marked contextual topbar actions and the Telegram default-tab back-link", () => {
    const markup = `
      <nav class="lb-side-group lb-side-nav"><a href="/dashboard/telegram">Telegram</a></nav>
      <header class="lb-topbar">
        <a href="/dashboard/telegram/bots" data-chrome-contextual-action="true">Connect one</a>
      </header>
      <nav class="v3-tabs">
        <a href="/dashboard/telegram">Overview</a>
        <a href="/dashboard/telegram/bots">Bot</a>
      </nav>
    `;
    const violations = ownershipViolations(markup, "/dashboard/telegram");
    expect(violations.duplicates).toEqual([]);
    expect(violations.sidebarSubnav).toEqual([]);
    expect(violations.foreignSubnav).toEqual([]);
    expect(violations.duplicateSubnavLabels).toEqual([]);
  });
});
