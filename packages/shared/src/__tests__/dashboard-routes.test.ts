// Internal invariants of the canonical dashboard route manifest, plus the
// Worker-ownership parity gate: every route's `owner` (and every alias's
// serving Worker) must agree with the Wrangler route patterns that actually
// serve that path in production. Wrangler config stays deployment
// infrastructure — it is verified against, never generated from, the manifest.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DASHBOARD_ROUTES,
  DASHBOARD_ROUTE_ALIASES,
  NAV_QUERY_ALIASES,
  NAV_QUERY_REDIRECT_POLICY,
  QUERY_PARAM_AUDIT,
  SETTINGS_ROOT_TAB_PARAMS,
  aliasWorker,
  applyAliasSearch,
  buildDashboardPath,
  resolveAliasRedirect,
  resolveNavRedirect,
  canonicalDashboardPath,
  parseDashboardRouteId,
  resolveDashboardLocation,
  resolveDashboardPath,
  routeById,
  trimTrailingSlashes,
  type DashboardRouteId,
  type DashboardWorker,
  type QueryParamUse,
} from "../dashboard-routes.js";

const classifications = (param: string): readonly QueryParamUse["classification"][] =>
  (QUERY_PARAM_AUDIT[param] ?? []).map((u) => u.classification);

describe("dashboard route manifest invariants", () => {
  it("gives every route a unique stable id", () => {
    const ids = DASHBOARD_ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("maps every canonical path to exactly one route", () => {
    const paths = DASHBOARD_ROUTES.map((r) => r.canonicalPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("keeps canonical paths normalized (no trailing slash, no query, no hash)", () => {
    for (const r of DASHBOARD_ROUTES) {
      expect(r.canonicalPath, r.id).toBe(trimTrailingSlashes(r.canonicalPath));
      expect(r.canonicalPath, r.id).not.toContain("?");
      expect(r.canonicalPath, r.id).not.toContain("#");
      expect(r.canonicalPath.startsWith("/"), r.id).toBe(true);
    }
  });

  it("does not derive route identity from the pathname", () => {
    // Renamed destinations keep their semantic id while the URL differs:
    // if these ever equal the last path segment, identity has been coupled
    // to the URL and canonical-path renames would break stable ids.
    for (const [id, path] of [
      ["rewards.history", "/dashboard/rewards/activity"],
      ["settings.plan", "/dashboard/settings/billing"],
      ["giveaways.preds", "/dashboard/giveaways/predictions"],
      ["audience.viewers", "/dashboard/audience/members"],
      ["performance", "/dashboard/analytics"],
      ["boards", "/dashboard/leaderboards"],
    ] as const) {
      const route = routeById(id);
      expect(route?.canonicalPath, id).toBe(path);
      expect(id.split(".").pop()).not.toBe(path.split("/").pop());
    }
  });

  it("keeps aliases unique, non-colliding and pointed at real routes", () => {
    const aliasPaths = DASHBOARD_ROUTE_ALIASES.map((a) => a.path);
    expect(new Set(aliasPaths).size).toBe(aliasPaths.length);
    const canonical = new Set(DASHBOARD_ROUTES.map((r) => r.canonicalPath));
    for (const a of DASHBOARD_ROUTE_ALIASES) {
      expect(canonical.has(a.path), a.path).toBe(false);
      expect(routeById(a.routeId), a.path).toBeDefined();
    }
    for (const [nav, id] of Object.entries(NAV_QUERY_ALIASES)) {
      expect(routeById(id), `?nav=${nav}`).toBeDefined();
    }
  });

  it("resolves canonical paths, aliases and rejects non-dashboard paths", () => {
    for (const r of DASHBOARD_ROUTES) {
      const resolved = resolveDashboardPath(r.canonicalPath);
      expect(resolved?.route.id, r.canonicalPath).toBe(r.id);
      expect(resolved?.canonical, r.canonicalPath).toBe(true);
      // Trailing-slash spellings resolve to the same route.
      expect(resolveDashboardPath(`${r.canonicalPath}/`)?.route.id, r.canonicalPath).toBe(r.id);
    }
    for (const a of DASHBOARD_ROUTE_ALIASES) {
      const resolved = resolveDashboardPath(a.path);
      expect(resolved?.route.id, a.path).toBe(a.routeId);
      expect(resolved?.canonical, a.path).toBe(false);
      expect(resolved?.alias?.kind, a.path).toBe(a.kind);
    }
    // Public, API, webhook and internal endpoints stay outside the model.
    for (const outside of [
      "/", "/help", "/auth", "/api/auth/me", "/api/site/list", "/hook/x",
      "/billing/hook/x", "/r/slug", "/pb", "/some-site-slug",
      "/dashboard/_content", "/dashboard/preview", "/dashboard/invite",
      "/dashboard/support", "/dashboard/nope",
    ]) {
      expect(resolveDashboardPath(outside), outside).toBeUndefined();
    }
  });

  it("builds deterministic canonical URLs with declared nav params only", () => {
    expect(buildDashboardPath("home")).toBe("/dashboard");
    expect(buildDashboardPath("board.design", { board: "s1" })).toBe("/dashboard/leaderboard/design?board=s1");
    expect(buildDashboardPath("rewards.shop", { siteId: "s1" })).toBe("/dashboard/rewards/shop?siteId=s1");
    expect(buildDashboardPath("activities.overview", { siteId: "s1" })).toBe("/dashboard/activities?siteId=s1");
    // Undeclared parameters never leak into built URLs.
    expect(buildDashboardPath("rewards.shop", { board: "s1" })).toBe("/dashboard/rewards/shop");
    expect(buildDashboardPath("settings.plan", { siteId: "s1", board: "s1" })).toBe("/dashboard/settings/billing");
    // Values are encoded; empty values are dropped.
    expect(buildDashboardPath("games", { board: "a b/c" })).toBe("/dashboard/games?board=a%20b%2Fc");
    expect(buildDashboardPath("games", { board: "" })).toBe("/dashboard/games");
    // Deterministic: same input, same output.
    expect(buildDashboardPath("board.design", { board: "s1" })).toBe(buildDashboardPath("board.design", { board: "s1" }));
  });

  it("separates trusted typed lookup from the untrusted-string boundary", () => {
    // Typed lookup always returns a route — and a typo is a compile error:
    // @ts-expect-error "setings.acount" is not a DashboardRouteId
    const typo: DashboardRouteId = "setings.acount";
    void typo;
    for (const r of DASHBOARD_ROUTES) expect(routeById(r.id).id).toBe(r.id);
    // Untrusted strings are parsed, never trusted.
    expect(parseDashboardRouteId("settings.account")).toBe("settings.account");
    expect(parseDashboardRouteId("setings.acount")).toBeUndefined();
    expect(parseDashboardRouteId("")).toBeUndefined();
    expect(parseDashboardRouteId("/dashboard")).toBeUndefined();
    // The trusted API throws (never returns "") if forced past the types.
    expect(() => buildDashboardPath("not.a.route" as DashboardRouteId)).toThrow();
  });

  it("records exact, executable redirect semantics on every redirect alias", () => {
    const probe = new URLSearchParams("keep=1&other=two");
    for (const a of DASHBOARD_ROUTE_ALIASES) {
      if (a.kind !== "redirect") continue;
      expect([301, 302], a.path).toContain(a.status);
      // Search behavior is executable data, never prose: every behavior can
      // be applied deterministically to real parameters.
      if (typeof a.search === "string") {
        expect(["preserve", "drop"], a.path).toContain(a.search);
      } else {
        expect(typeof a.search.preserveExisting, a.path).toBe("boolean");
      }
      const applied = applyAliasSearch(a.search, probe);
      expect(applied, a.path).toBeInstanceOf(URLSearchParams);
      // redirectTo is only for Locations that are NOT the canonical path.
      if (a.redirectTo) {
        expect(a.redirectTo, a.path).not.toBe(routeById(a.routeId).canonicalPath);
        // A chained/legacy Location must itself resolve to the same route.
        expect(resolveDashboardPath(a.redirectTo)?.route.id, a.path).toBe(a.routeId);
      }
    }
    // applyAliasSearch executes each behavior exactly.
    expect(applyAliasSearch("preserve", probe).toString()).toBe("keep=1&other=two");
    expect(applyAliasSearch("drop", probe).toString()).toBe("");
    expect(applyAliasSearch({ preserveExisting: true, set: { from: "bot" } }, probe).toString())
      .toBe("keep=1&other=two&from=bot");
    expect(applyAliasSearch({ preserveExisting: true, delete: ["keep"] }, probe).toString())
      .toBe("other=two");
    expect(applyAliasSearch({ preserveExisting: false, set: { a: "1" } }, probe).toString())
      .toBe("a=1");
    // The input is never mutated.
    expect(probe.toString()).toBe("keep=1&other=two");
  });

  it("resolves manifest aliases only for their serving Worker", () => {
    const alias = DASHBOARD_ROUTE_ALIASES.find((a) => a.path === "/dashboard/settings/board");
    expect(alias).toBeDefined();
    expect(aliasWorker(alias!)).toBe("leaderboard");
    expect(resolveAliasRedirect("/dashboard/settings/board", "?keep=1", "leaderboard")).toMatchObject({
      alias: "/dashboard/settings/board",
      routeId: "site",
      status: 301,
      pathname: "/dashboard/site",
      servedBy: "leaderboard",
    });
    expect(resolveAliasRedirect("/dashboard/settings/board/", "?keep=1", "bot")).toBeUndefined();
    expect(resolveAliasRedirect("/dashboard/sites", "?keep=1", "leaderboard")).toBeUndefined();
    expect(resolveAliasRedirect("/dashboard/site", "?keep=1", "leaderboard")).toBeUndefined();
  });

  it("encodes the legacy ?nav= redirect policy as executable manifest data", () => {
    // One uniform policy for every nav alias: 302, strip nav, preserve rest.
    expect(NAV_QUERY_REDIRECT_POLICY.status).toBe(302);
    expect(applyAliasSearch(NAV_QUERY_REDIRECT_POLICY.search, new URLSearchParams("nav=games&from=test&keep=2")).toString())
      .toBe("from=test&keep=2");
    for (const [nav, routeId] of Object.entries(NAV_QUERY_ALIASES)) {
      const redirect = resolveNavRedirect(nav, `nav=${nav}&from=test&keep=2`);
      expect(redirect, nav).toBeDefined();
      expect(redirect!.routeId, nav).toBe(routeId);
      expect(redirect!.status, nav).toBe(302);
      // The Location always resolves back to the declared route identity —
      // targets go through the canonical route model.
      expect(resolveDashboardPath(redirect!.pathname)?.route.id, nav).toBe(routeId);
      expect(redirect!.search.toString(), nav).toBe("from=test&keep=2");
    }
    // The two legacy-spelling Locations (LEGACY_ACCOUNT_PATHS in the Worker).
    expect(resolveNavRedirect("settings")!.pathname).toBe("/dashboard/settings");
    expect(resolveNavRedirect("manage")!.pathname).toBe("/dashboard/settings");
    // Everything else lands on the target route's canonical path.
    expect(resolveNavRedirect("games")!.pathname).toBe("/dashboard/games");
    expect(resolveNavRedirect("kickrewards")!.pathname).toBe("/dashboard/site/connections");
    // Unknown nav values are not redirects.
    expect(resolveNavRedirect("nope")).toBeUndefined();
  });

  it("canonicalizes deterministically and idempotently", () => {
    for (const r of DASHBOARD_ROUTES) {
      expect(canonicalDashboardPath(r.canonicalPath)).toBe(r.canonicalPath);
    }
    for (const a of DASHBOARD_ROUTE_ALIASES) {
      const target = routeById(a.routeId)!.canonicalPath;
      expect(canonicalDashboardPath(a.path), a.path).toBe(target);
      expect(canonicalDashboardPath(canonicalDashboardPath(a.path)), a.path).toBe(target);
    }
    expect(canonicalDashboardPath("/not/dashboard")).toBe("");
  });

  it("only admits parameters the audit classifies as navigation state", () => {
    for (const r of DASHBOARD_ROUTES) {
      for (const p of r.navParams) {
        expect(classifications(p), `${r.id} ${p}`).toContain("navigation");
      }
    }
    for (const p of ["nav", ...SETTINGS_ROOT_TAB_PARAMS]) {
      expect(classifications(p), p).toContain("navigation");
    }
    // One-shot and feature parameters must never be modeled as navigation.
    for (const p of ["edit", "viewer", "kick_connected", "error"]) {
      expect(classifications(p), p).not.toContain("navigation");
      expect(classifications(p), p).toContain("one-shot-action");
    }
    for (const p of ["token", "ref", "returnTo", "next", "state", "code", "path", "gid"]) {
      expect(classifications(p), p).toEqual(["feature"]);
    }
  });

  it("keeps context-sensitive parameters mechanically distinct per context", () => {
    // Every audited parameter has at least one use, and every use names its
    // context and evidence — no prose-only contradictions.
    for (const [param, uses] of Object.entries(QUERY_PARAM_AUDIT)) {
      expect(uses.length, param).toBeGreaterThan(0);
      const contexts = uses.map((u) => u.context);
      expect(new Set(contexts).size, param).toBe(contexts.length);
      for (const u of uses) {
        expect(u.context.length, param).toBeGreaterThan(0);
        expect(u.where.length, param).toBeGreaterThan(0);
      }
    }
    // `plan` is navigation ONLY on the settings root document and feature
    // state elsewhere — two explicit uses, not one global classification.
    const plan = QUERY_PARAM_AUDIT.plan;
    expect(plan.length).toBe(2);
    expect(plan.find((u) => u.classification === "navigation")?.context).toBe("/dashboard/settings root document");
    expect(plan.some((u) => u.classification === "feature")).toBe(true);
    // `error` is likewise one-shot on dashboard documents, feature on auth.
    expect(classifications("error").sort()).toEqual(["feature", "one-shot-action"]);
  });
});

describe("location-level route resolution", () => {
  const loc = (path: string, search = "") => resolveDashboardLocation(path, search);

  it("resolves the settings root tab grammar exactly (review examples)", () => {
    expect(loc("/dashboard/settings")?.routeId).toBe("settings.account");
    expect(loc("/dashboard/settings", "tab=team")?.routeId).toBe("settings.team");
    expect(loc("/dashboard/settings", "tab=connections")?.routeId).toBe("settings.connections");
    expect(loc("/dashboard/settings", "tab=billing")?.routeId).toBe("settings.plan");
    expect(loc("/dashboard/settings", "tab=plan")?.routeId).toBe("settings.plan");
    expect(loc("/dashboard/settings", "plan")?.routeId).toBe("settings.plan");
    expect(loc("/dashboard/settings", "tab=data")?.routeId).toBe("settings.data");
    expect(loc("/dashboard/settings", "tab=account")?.routeId).toBe("settings.account");
    // Unknown tabs fall back to the account tab, like the Worker.
    expect(loc("/dashboard/settings", "tab=bogus")?.routeId).toBe("settings.account");
    // ?tab wins over a bare ?plan (index.js reads tab first).
    expect(loc("/dashboard/settings", "tab=team&plan")?.routeId).toBe("settings.team");
    // Canonical addresses carry the settings tab in the PATH, so these
    // legacy-query locations are never canonical.
    const team = loc("/dashboard/settings", "tab=team");
    expect(team?.canonical).toBe(false);
    expect(team?.settingsTab).toBe("team");
    expect(team?.canonicalPath).toBe("/dashboard/settings/team");
    // ?tab= is ignored on the per-tab settings paths (path wins).
    expect(loc("/dashboard/settings/team", "tab=billing")?.routeId).toBe("settings.team");
    // ?nav= is ignored on the settings root (served before nav handling).
    expect(loc("/dashboard/settings", "nav=games")?.routeId).toBe("settings.account");
  });

  it("resolves legacy ?nav= on spa-section paths only (review example)", () => {
    const games = loc("/dashboard", "nav=games");
    expect(games?.routeId).toBe("games");
    expect(games?.canonicalPath).toBe("/dashboard/games");
    expect(games?.canonical).toBe(false);
    expect(games?.navAlias).toBe("games");
    // Every declared ?nav= alias resolves to its target from /dashboard.
    for (const [nav, id] of Object.entries(NAV_QUERY_ALIASES)) {
      expect(loc("/dashboard", `nav=${nav}`)?.routeId, `?nav=${nav}`).toBe(id);
    }
    // Unknown nav values are ignored (the Worker serves the path).
    expect(loc("/dashboard", "nav=bogus")?.routeId).toBe("home");
    expect(loc("/dashboard", "nav=bogus")?.navAlias).toBeUndefined();
    // nav applies on other spa-section paths too (parseDashboardPath branch)…
    expect(loc("/dashboard/games", "nav=settings")?.routeId).toBe("settings.account");
    // …including spa-section rewrite aliases…
    expect(loc("/dashboard/sites", "nav=games")?.routeId).toBe("games");
    // …but never on fragment or worker-document destinations.
    expect(loc("/dashboard/rewards", "nav=games")?.routeId).toBe("rewards.overview");
    expect(loc("/dashboard/telegram", "nav=games")?.routeId).toBe("telegram");
  });

  it("canonicalizes paths, aliases and trailing slashes at the location level", () => {
    for (const r of DASHBOARD_ROUTES) {
      const at = loc(r.canonicalPath);
      expect(at?.routeId, r.id).toBe(r.id);
      expect(at?.canonical, r.id).toBe(true);
      expect(loc(`${r.canonicalPath}/`)?.routeId, r.id).toBe(r.id);
      expect(loc(`${r.canonicalPath}/`)?.canonical, r.id).toBe(false);
    }
    for (const a of DASHBOARD_ROUTE_ALIASES) {
      // The settings root re-resolves by tab; every other alias resolves to
      // its declared target with canonical=false.
      if (a.path === "/dashboard/settings") continue;
      const at = loc(a.path);
      expect(at?.routeId, a.path).toBe(a.routeId);
      expect(at?.canonical, a.path).toBe(false);
      expect(at?.alias?.path, a.path).toBe(a.path);
    }
    // Non-dashboard locations resolve to nothing, with or without query.
    expect(loc("/", "nav=games")).toBeUndefined();
    expect(loc("/api/site/list", "tab=team")).toBeUndefined();
  });

  it("retains declared navigation params and exposes them typed", () => {
    const board = loc("/dashboard/leaderboard/design", "board=s1&edit=42");
    expect(board?.navParams).toEqual({ board: "s1" });
    expect(board?.canonical).toBe(true);
    const shop = loc("/dashboard/rewards/shop", "siteId=s2&viewer=x");
    expect(shop?.navParams).toEqual({ siteId: "s2" });
    // Undeclared context params are not retained for routes that ignore them.
    expect(loc("/dashboard/settings/team", "board=s1")?.navParams).toEqual({});
    // ?nav= targets expose the params the TARGET declares.
    const nav = loc("/dashboard", "nav=games&board=s3&x=1");
    expect(nav?.routeId).toBe("games");
    expect(nav?.navParams).toEqual({ board: "s3" });
  });
});

// ── Worker ownership parity against actual Wrangler configuration ──────────

interface WranglerPattern {
  worker: DashboardWorker;
  pathPattern: string;
}

function readWranglerPatterns(worker: DashboardWorker, tomlPath: string): WranglerPattern[] {
  const src = readFileSync(new URL(tomlPath, import.meta.url), "utf8");
  const patterns: WranglerPattern[] = [];
  for (const m of src.matchAll(/pattern\s*=\s*"([^"]+)"/g)) {
    const pattern = m[1];
    // Production ownership only: skip staging/preview hosts.
    if (!pattern.startsWith("yourrank.site/")) continue;
    patterns.push({ worker, pathPattern: pattern.slice("yourrank.site".length) });
  }
  expect(patterns.length, tomlPath).toBeGreaterThan(0);
  return patterns;
}

function patternMatches(pathPattern: string, path: string): boolean {
  if (!pathPattern.includes("*")) return pathPattern === path;
  const [prefix] = pathPattern.split("*");
  return path.startsWith(prefix);
}

/** Literal-prefix length; Cloudflare serves the most specific matching route. */
function specificity(pathPattern: string): number {
  return pathPattern.includes("*") ? pathPattern.indexOf("*") : pathPattern.length + 1;
}

function servingWorker(patterns: WranglerPattern[], path: string): DashboardWorker | undefined {
  let best: WranglerPattern | undefined;
  for (const p of patterns) {
    if (!patternMatches(p.pathPattern, path)) continue;
    if (!best || specificity(p.pathPattern) > specificity(best.pathPattern)) best = p;
  }
  return best?.worker;
}

describe("worker ownership parity (wrangler.toml)", () => {
  const patterns = [
    ...readWranglerPatterns("leaderboard", "../../../../apps/leaderboard/wrangler.toml"),
    ...readWranglerPatterns("bot", "../../../../apps/bot/wrangler.toml"),
  ];

  it("reads real route patterns from both Workers", () => {
    expect(patterns.some((p) => p.worker === "leaderboard" && p.pathPattern === "/*")).toBe(true);
    expect(patterns.some((p) => p.worker === "bot" && p.pathPattern === "/dashboard/telegram*")).toBe(true);
  });

  it("matches every route's manifest owner to the Worker that serves it", () => {
    for (const r of DASHBOARD_ROUTES) {
      expect(servingWorker(patterns, r.canonicalPath), `${r.id} ${r.canonicalPath}`).toBe(r.owner);
    }
  });

  it("matches every alias path to its declared serving Worker", () => {
    for (const a of DASHBOARD_ROUTE_ALIASES) {
      const expected = a.servedBy ?? routeById(a.routeId).owner;
      expect(servingWorker(patterns, a.path), a.path).toBe(expected);
    }
  });

  it("keeps non-dashboard Worker patterns outside the dashboard model", () => {
    // The bot Worker's webhook/billing/redirect/postback patterns must not
    // capture any manifest destination.
    const nonDashboard = patterns.filter(
      (p) => p.worker === "bot" && !p.pathPattern.startsWith("/dashboard/telegram") && !p.pathPattern.startsWith("/bot"),
    );
    expect(nonDashboard.length).toBeGreaterThan(0);
    for (const p of nonDashboard) {
      for (const r of DASHBOARD_ROUTES) {
        expect(patternMatches(p.pathPattern, r.canonicalPath), `${p.pathPattern} vs ${r.id}`).toBe(false);
      }
      for (const a of DASHBOARD_ROUTE_ALIASES) {
        expect(patternMatches(p.pathPattern, a.path), `${p.pathPattern} vs ${a.path}`).toBe(false);
      }
    }
  });
});
