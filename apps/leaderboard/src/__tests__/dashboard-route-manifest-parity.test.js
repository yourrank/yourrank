// Parity gate for the canonical dashboard route manifest (Wave 2 PR-1).
// The manifest (@yourrank/shared/dashboard-routes) is a pure addition: the
// runtime still routes through routes.js / index.js / telegram-routes.js.
// These tests pin the manifest to the CURRENT behavior of those sources so
// later PRs can derive consumers from it without behavior drift.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DASHBOARD_ROUTES,
  DASHBOARD_ROUTE_ALIASES,
  NAV_QUERY_ALIASES,
  QUERY_PARAM_AUDIT,
  buildDashboardPath,
  canonicalDashboardPath,
  resolveDashboardLocation,
  resolveDashboardPath,
  routeById,
} from "@yourrank/shared/dashboard-routes";
import { LEGACY_ACCOUNT_PATHS, dashboardNavItems, NAV_OWNER_MAP } from "@yourrank/shared/dashboard-nav";
import {
  SECTIONS,
  DYNAMIC_SECTIONS,
  SECTION_ALIASES,
  ACCOUNT_SECTION_PATHS,
  dashboardPath,
  parseDashboardPath,
  parseDynamicPath,
  legacyDashboardPath,
  resolveSection,
} from "../assets/dashboard/routes.js";
import { LEGACY_TELEGRAM_REDIRECTS } from "../telegram-routes.js";
import worker from "../index.js";

const routesById = new Map(DASHBOARD_ROUTES.map((r) => [r.id, r]));

describe("manifest parity: core SPA sections (SECTIONS)", () => {
  it("represents every SECTIONS root with identical canonical path", () => {
    for (const [key, section] of Object.entries(SECTIONS)) {
      const route = routesById.get(key);
      expect(route, key).toBeDefined();
      expect(route.canonicalPath, key).toBe(section.path);
      expect(route.section, key).toBe(key);
      expect(route.tab, key).toBeUndefined();
      expect(route.owner, key).toBe("leaderboard");
      expect(route.delivery, key).toBe("spa-section");
    }
  });

  it("represents every SECTIONS tab with identical canonical path", () => {
    for (const [key, section] of Object.entries(SECTIONS)) {
      for (const tab of section.tabs || []) {
        const route = routesById.get(`${key}.${tab}`);
        expect(route, `${key}.${tab}`).toBeDefined();
        expect(route.canonicalPath, `${key}.${tab}`).toBe(`${section.path}/${tab}`);
        expect(route.section, `${key}.${tab}`).toBe(key);
        expect(route.tab, `${key}.${tab}`).toBe(tab);
        expect(route.delivery, `${key}.${tab}`).toBe("spa-section");
      }
    }
  });

  it("agrees with parseDashboardPath on every SPA route and stays out of the rest", () => {
    for (const route of DASHBOARD_ROUTES) {
      const parsed = parseDashboardPath(route.canonicalPath);
      if (route.delivery === "spa-section") {
        expect(parsed, route.id).toEqual({ page: route.section, tab: route.tab || "" });
      } else {
        expect(parsed, route.id).toBeNull();
      }
    }
  });
});

describe("manifest parity: fragment sections (DYNAMIC_SECTIONS)", () => {
  it("represents every dynamic tab with identical canonical path and navKey", () => {
    for (const [page, section] of Object.entries(DYNAMIC_SECTIONS)) {
      for (const tab of section.tabs) {
        const route = routesById.get(`${page}.${tab}`);
        expect(route, `${page}.${tab}`).toBeDefined();
        expect(route.canonicalPath, `${page}.${tab}`).toBe(section.tabPaths[tab]);
        expect(route.section, `${page}.${tab}`).toBe(page);
        expect(route.tab, `${page}.${tab}`).toBe(tab);
        expect(route.navKey, `${page}.${tab}`).toBe(section.navKey);
        expect(route.owner, `${page}.${tab}`).toBe("leaderboard");
        expect(route.delivery, `${page}.${tab}`).toBe("fragment");
      }
    }
  });

  it("agrees with parseDynamicPath on every fragment route", () => {
    for (const route of DASHBOARD_ROUTES) {
      if (route.delivery !== "fragment") continue;
      expect(parseDynamicPath(route.canonicalPath), route.id).toEqual({
        page: route.section,
        tab: route.tab,
        dynamic: true,
      });
    }
  });

  it("covers every fragment destination and no extras", () => {
    const manifestFragmentPaths = DASHBOARD_ROUTES
      .filter((r) => r.delivery === "fragment")
      .map((r) => r.canonicalPath)
      .sort();
    const dynamicPaths = Object.values(DYNAMIC_SECTIONS)
      .flatMap((s) => Object.values(s.tabPaths))
      .sort();
    expect(manifestFragmentPaths).toEqual(dynamicPaths);
  });
});

describe("manifest parity: rail owner keys", () => {
  it("uses navKeys that are real nav-owner values", () => {
    const owners = new Set([...Object.values(NAV_OWNER_MAP), "home", "telegram"]);
    for (const route of DASHBOARD_ROUTES) {
      expect(owners.has(route.navKey), `${route.id} → ${route.navKey}`).toBe(true);
    }
  });

  it("accounts for every dashboard rail destination", () => {
    const items = dashboardNavItems({});
    const hrefs = items.flatMap((i) => (i.kind === "group" ? i.children.map((c) => c.href) : [i.href]));
    for (const href of hrefs) {
      const resolved = resolveDashboardPath(new URL(href, "https://yourrank.site").pathname);
      expect(resolved, href).toBeDefined();
    }
  });
});

describe("manifest parity: legacy aliases", () => {
  it("serves rewrite aliases in place through the current parsers", () => {
    for (const alias of DASHBOARD_ROUTE_ALIASES) {
      if (alias.kind !== "rewrite") continue;
      const target = routeById(alias.routeId);
      const parsed = parseDashboardPath(alias.path) || parseDynamicPath(alias.path);
      expect(parsed, alias.path).toBeDefined();
      expect(parsed.page, alias.path).toBe(target.section);
      if (target.tab) expect(parsed.tab, alias.path).toBe(target.tab);
    }
  });

  it("redirects every leaderboard-served redirect alias with the exact recorded semantics", async () => {
    for (const alias of DASHBOARD_ROUTE_ALIASES) {
      if (alias.kind !== "redirect") continue;
      const servedBy = alias.servedBy || routeById(alias.routeId).owner;
      if (servedBy !== "leaderboard") continue;
      // Two unrelated parameters prove exact search behavior, not resemblance.
      const response = await worker.fetch(new Request(`https://yourrank.test${alias.path}?keep=1&other=two`), {}, {});
      // Exact status — never "either 301 or 302".
      expect(response.status, `${alias.path} → ${response.status}`).toBe(alias.status);
      const location = new URL(response.headers.get("location"), "https://yourrank.test");
      // Exact resulting pathname: the recorded Location (redirectTo when the
      // Worker lands on a legacy spelling, canonical path otherwise).
      const expectedPath = alias.redirectTo || routeById(alias.routeId).canonicalPath;
      expect(location.pathname, alias.path).toBe(expectedPath);
      // Exact search behavior.
      if (alias.search === "preserve") {
        expect(location.search, alias.path).toBe("?keep=1&other=two");
      } else if (alias.search === "drop") {
        expect(location.search, alias.path).toBe("");
      } else {
        expect(alias.searchTransform, alias.path).toBeTruthy();
      }
    }
  });

  it("covers legacyDashboardPath and the Telegram redirect map", () => {
    for (const [legacy, canonical] of [
      ["/dashboard/editor", "/dashboard/leaderboard"],
      ["/dashboard/editor/setup", "/dashboard/leaderboard/setup"],
      ["/dashboard/editor/players", "/dashboard/leaderboard/players"],
      ["/dashboard/editor/design", "/dashboard/leaderboard/design"],
      ["/dashboard/editor/share", "/dashboard/leaderboard/share"],
      ["/dashboard/editor/history", "/dashboard/leaderboard/history"],
      ["/dashboard/boards", "/dashboard/leaderboards"],
    ]) {
      expect(legacyDashboardPath(legacy), legacy).toBe(canonical);
      expect(canonicalDashboardPath(legacy), legacy).toBe(canonical);
    }
    for (const [legacy, canonical] of Object.entries(LEGACY_TELEGRAM_REDIRECTS)) {
      // Documented discrepancy: the bot Worker owns yourrank.site/dashboard/
      // telegram* and has no /overview route (it 404s), so this defensive
      // leaderboard entry is unreachable in production and stays out of the
      // manifest (see the bot-side parity test).
      if (legacy === "/dashboard/telegram/overview") continue;
      const resolved = resolveDashboardPath(legacy);
      expect(resolved, legacy).toBeDefined();
      expect(resolved.canonical, legacy).toBe(false);
      expect(routeById(resolved.route.id).canonicalPath === canonical
        || canonicalDashboardPath(canonical) === resolved.route.canonicalPath, legacy).toBe(true);
    }
  });

  it("covers every SECTION_ALIASES head and LEGACY_ACCOUNT_PATHS target", () => {
    for (const [aliasHead, sectionKey] of Object.entries(SECTION_ALIASES)) {
      // Heads that parse as dashboard paths must resolve to the same section
      // the runtime serves there (rewrite aliases). Account-section heads are
      // handled by Worker redirects, asserted through NAV_QUERY_ALIASES below.
      const parsed = parseDashboardPath(`/dashboard/${aliasHead}`);
      if (!parsed) continue;
      const resolved = resolveDashboardPath(`/dashboard/${aliasHead}`);
      expect(resolved, aliasHead).toBeDefined();
      if (resolved.alias?.kind === "redirect") {
        // The Worker redirects this spelling before parseDashboardPath runs
        // (e.g. /dashboard/editor via legacyDashboardPath). The redirect must
        // land in the same section — except the one documented discrepancy:
        // SECTION_ALIASES maps `manage` to the `site` section, but the Worker
        // redirects /dashboard/manage to ACCOUNT settings. The manifest
        // encodes the served (Worker) behavior; pin the divergence here.
        if (aliasHead === "manage") continue;
        expect(resolved.route.section, aliasHead).toBe(parsed.page);
        continue;
      }
      expect(resolved.route.section, aliasHead).toBe(parsed.page);
      expect(parsed.page, aliasHead).toBe(sectionKey);
    }
    for (const target of [...Object.values(LEGACY_ACCOUNT_PATHS), ...Object.values(ACCOUNT_SECTION_PATHS)]) {
      expect(resolveDashboardPath(target), target).toBeDefined();
    }
  });

  it("canonicalizes every legacy ?nav= value exactly like the Worker", async () => {
    for (const [nav, routeId] of Object.entries(NAV_QUERY_ALIASES)) {
      const response = await worker.fetch(new Request(`https://yourrank.test/dashboard?nav=${nav}&from=test&keep=2`), {}, {});
      // Exact status: legacy ?nav= is always a 302.
      expect(response.status, nav).toBe(302);
      const location = new URL(response.headers.get("location"), "https://yourrank.test");
      // Exact resulting pathname, computed from the same runtime tables the
      // Worker uses (kickrewards special case, LEGACY_ACCOUNT_PATHS, then
      // dashboardPath), and manifest agreement on the identity.
      const expectedPath = nav === "kickrewards"
        ? "/dashboard/site/connections"
        : LEGACY_ACCOUNT_PATHS[nav] || dashboardPath(resolveSection(nav));
      expect(location.pathname, `?nav=${nav}`).toBe(expectedPath);
      const resolved = resolveDashboardPath(location.pathname);
      expect(resolved?.route.id, `?nav=${nav} → ${location.pathname}`).toBe(routeId);
      // Exact transformation: only `nav` is stripped; every unrelated
      // parameter survives canonicalization.
      expect(location.searchParams.get("from"), nav).toBe("test");
      expect(location.searchParams.get("keep"), nav).toBe("2");
      expect([...location.searchParams].length, nav).toBe(2);
      expect(location.searchParams.has("nav"), nav).toBe(false);
      // The location resolver reaches the same identity without a network hop.
      expect(resolveDashboardLocation("/dashboard", `nav=${nav}`)?.routeId, nav).toBe(routeId);
    }
    // The manifest covers every nav value the runtime resolves: any name that
    // resolveSection accepts (plus the LEGACY_ACCOUNT_PATHS/kickrewards names)
    // must appear in NAV_QUERY_ALIASES.
    const runtimeNavValues = new Set([
      ...Object.keys(SECTION_ALIASES),
      ...Object.keys(SECTIONS),
      ...Object.keys(ACCOUNT_SECTION_PATHS),
      ...Object.keys(LEGACY_ACCOUNT_PATHS),
      "kickrewards",
    ].filter((name) => name === "kickrewards" || resolveSection(name)));
    expect(Object.keys(NAV_QUERY_ALIASES).sort()).toEqual([...runtimeNavValues].sort());
  });
});

describe("manifest parity: navigation-state query parameters", () => {
  const boardShell = readFileSync(new URL("../assets/dashboard/board-shell.js", import.meta.url), "utf8");

  const extractSet = (name) => {
    const start = boardShell.indexOf(`const ${name} = new Set([`);
    expect(start, name).toBeGreaterThan(-1);
    const body = boardShell.slice(start, boardShell.indexOf("])", start));
    return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  };

  it("declares siteId on every destination the shell stamps with siteId", () => {
    for (const path of extractSet("creditsDestinations")) {
      const route = resolveDashboardPath(path)?.route;
      expect(route, path).toBeDefined();
      expect(route.navParams, `${path} (${route.id})`).toContain("siteId");
    }
  });

  it("declares board on every destination the shell stamps with board", () => {
    for (const path of extractSet("siteDestinations")) {
      const route = resolveDashboardPath(path)?.route;
      expect(route, path).toBeDefined();
      expect(route.navParams, `${path} (${route.id})`).toContain("board");
    }
    // ...including every /dashboard/leaderboard/* tab (prefix rule in the shell).
    for (const route of DASHBOARD_ROUTES) {
      if (route.canonicalPath.startsWith("/dashboard/leaderboard/")) {
        expect(route.navParams, route.id).toContain("board");
      }
    }
  });

  it("keeps one-shot parameters out of the manifest and in the audit", () => {
    const credits = readFileSync(new URL("../assets/credits.js", import.meta.url), "utf8");
    // The audit's one-shot classifications reflect real consumption sites.
    expect(credits).toContain('get("edit")');
    expect(credits).toContain('get("viewer")');
    expect(credits).toContain('searchParams.delete("kick_connected")');
    expect(credits).toContain('searchParams.delete("error")');
    for (const route of DASHBOARD_ROUTES) {
      for (const p of ["edit", "viewer", "kick_connected", "error", "nav", "tab", "plan"]) {
        expect(route.navParams.includes(p), `${route.id} must not declare ${p}`).toBe(false);
      }
    }
    for (const [param, uses] of Object.entries(QUERY_PARAM_AUDIT)) {
      expect(uses.length, param).toBeGreaterThan(0);
      for (const use of uses) {
        expect(["navigation", "one-shot-action", "feature"].includes(use.classification), param).toBe(true);
      }
    }
  });

  it("resolves the settings root tab grammar exactly like the Worker source", () => {
    // The tab grammar lives in index.js and is served behind auth, so pin
    // the exact source the location resolver mirrors: tab= wins, a bare
    // ?plan falls back to the plan tab, billing|plan collapse to plan.
    const indexSrc = readFileSync(new URL("../index.js", import.meta.url), "utf8");
    expect(indexSrc).toContain('url.searchParams.get("tab") || (url.searchParams.has("plan") ? "plan" : null)');
    expect(indexSrc).toContain('requestedTab === "billing" || requestedTab === "plan"');
    expect(indexSrc).toContain('["account", "team", "connections", "data"].includes(requestedTab)');
    // And the resolver reproduces it (review examples).
    expect(resolveDashboardLocation("/dashboard/settings", "")?.routeId).toBe("settings.account");
    expect(resolveDashboardLocation("/dashboard/settings", "tab=team")?.routeId).toBe("settings.team");
    expect(resolveDashboardLocation("/dashboard/settings", "tab=connections")?.routeId).toBe("settings.connections");
    expect(resolveDashboardLocation("/dashboard/settings", "tab=billing")?.routeId).toBe("settings.plan");
    expect(resolveDashboardLocation("/dashboard/settings", "tab=plan")?.routeId).toBe("settings.plan");
    expect(resolveDashboardLocation("/dashboard/settings", "plan")?.routeId).toBe("settings.plan");
    expect(resolveDashboardLocation("/dashboard/settings", "tab=bogus")?.routeId).toBe("settings.account");
  });

  it("builds URLs the current runtime already accepts", async () => {
    // A manifest-built URL with declared nav state is served by the current
    // Worker exactly like the hand-built equivalent (no redirect, same doc).
    const built = buildDashboardPath("board.design", { board: "site-1" });
    expect(built).toBe("/dashboard/leaderboard/design?board=site-1");
    expect(parseDashboardPath(new URL(built, "https://yourrank.test").pathname)).toEqual({ page: "board", tab: "design" });
    const builtFragment = buildDashboardPath("rewards.shop", { siteId: "site-1" });
    expect(builtFragment).toBe("/dashboard/rewards/shop?siteId=site-1");
    expect(parseDynamicPath(new URL(builtFragment, "https://yourrank.test").pathname)).toEqual({ page: "rewards", tab: "shop", dynamic: true });
  });
});

describe("manifest parity: complete route inventory", () => {
  it("accounts for every current dashboard destination", () => {
    const destinations = new Set([
      ...Object.values(SECTIONS).flatMap((s) => [s.path, ...(s.tabs || []).map((t) => `${s.path}/${t}`)]),
      ...Object.values(DYNAMIC_SECTIONS).flatMap((s) => Object.values(s.tabPaths)),
      ...Object.values(LEGACY_ACCOUNT_PATHS),
      ...Object.values(ACCOUNT_SECTION_PATHS),
      ...Object.keys(LEGACY_TELEGRAM_REDIRECTS),
      ...Object.values(LEGACY_TELEGRAM_REDIRECTS),
    ]);
    for (const path of destinations) {
      // Unreachable defensive entry (bot Worker owns the pattern and 404s);
      // see the Telegram redirect-map test above and the bot-side parity test.
      if (path === "/dashboard/telegram/overview") continue;
      expect(resolveDashboardPath(path), path).toBeDefined();
    }
  });

  it("adds no destination the runtime does not serve", async () => {
    // Every canonical leaderboard-owned path must be served by the current
    // Worker without redirecting away (auth redirects to /auth are fine).
    for (const route of DASHBOARD_ROUTES) {
      if (route.owner !== "leaderboard") continue;
      const response = await worker.fetch(new Request(`https://yourrank.test${route.canonicalPath}`), {}, {});
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = new URL(response.headers.get("location"), "https://yourrank.test");
        expect(location.pathname, `${route.id} → ${location.pathname}`).toBe("/login");
      } else {
        expect(response.status, route.id).toBeLessThan(400);
      }
    }
  });
});

describe("query-parameter audit enforcement (mechanical gate)", () => {
  // Deterministic, focused scanner over the dashboard routing/navigation
  // sources: every literal URLSearchParams read/write they perform must be
  // classified in QUERY_PARAM_AUDIT (or sit in the documented exclusion list
  // below). A new routing-affecting query parameter therefore fails CI until
  // it is classified.
  const SCANNED_SOURCES = [
    "../index.js",
    "../telegram-routes.js",
    "../login-redirect.js",
    "../assets/dashboard/routes.js",
    "../assets/dashboard/board-shell.js",
    "../assets/credits.js",
    "../assets/dashboard/players.js",
  ];

  // Parameters a scanned source touches that are deliberately NOT dashboard
  // query parameters. Every entry needs a tight justification; growing this
  // list is a review event, not a default.
  const EXCLUDED_PARAMS = new Map([
    // (none currently — every discovered parameter is classified)
  ]);

  const scanParams = (src) => {
    const params = new Set();
    // Receivers that are URLSearchParams: `url.searchParams`-style access
    // plus local `const x = new URLSearchParams(...)` bindings.
    const receivers = new Set(["searchParams"]);
    for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*new URLSearchParams/g)) {
      receivers.add(m[1]);
    }
    const names = [...receivers].map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const accessRe = new RegExp(`\\b(?:${names})\\.(?:get|getAll|has|set|delete|append)\\(\\s*["']([\\w-]+)["']`, "g");
    const inlineRe = /new URLSearchParams\([^)]*\)\.(?:get|getAll|has|set|delete|append)\(\s*["']([\w-]+)["']/g;
    for (const m of src.matchAll(accessRe)) params.add(m[1]);
    for (const m of src.matchAll(inlineRe)) params.add(m[1]);
    return params;
  };

  it("finds every literal query parameter of the routing sources in the audit", () => {
    const discovered = new Map();
    for (const file of SCANNED_SOURCES) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      for (const param of scanParams(src)) {
        if (!discovered.has(param)) discovered.set(param, []);
        discovered.get(param).push(file);
      }
    }
    // The scanner has real coverage (guards against a silently broken regex).
    for (const expected of ["nav", "tab", "plan", "board", "siteId", "edit", "viewer"]) {
      expect(discovered.has(expected), `scanner lost ${expected}`).toBe(true);
    }
    for (const [param, files] of discovered) {
      const classified = Object.prototype.hasOwnProperty.call(QUERY_PARAM_AUDIT, param);
      const excluded = EXCLUDED_PARAMS.has(param);
      expect(
        classified || excluded,
        `query parameter "${param}" (read/written in ${files.join(", ")}) is not classified in QUERY_PARAM_AUDIT — classify it (navigation / one-shot-action / feature) or add a documented exclusion`,
      ).toBe(true);
      expect(classified && excluded, `"${param}" cannot be both classified and excluded`).toBe(false);
    }
  });

  it("keeps navigation classifications context-bound (no global `plan`)", () => {
    // `plan` must be navigation ONLY on the settings root document and
    // feature state elsewhere; the structure carries both uses explicitly.
    const plan = QUERY_PARAM_AUDIT.plan;
    expect(plan.map((u) => u.classification).sort()).toEqual(["feature", "navigation"]);
    expect(plan.find((u) => u.classification === "navigation").context).toBe("/dashboard/settings root document");
    // The resolver honors that context: ?plan is identity on the settings
    // root and inert everywhere else.
    expect(resolveDashboardLocation("/dashboard/settings", "plan")?.routeId).toBe("settings.plan");
    expect(resolveDashboardLocation("/dashboard", "plan")?.routeId).toBe("home");
    expect(resolveDashboardLocation("/dashboard/settings/team", "plan")?.routeId).toBe("settings.team");
  });
});
