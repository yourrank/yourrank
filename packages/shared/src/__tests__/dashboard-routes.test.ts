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
  QUERY_PARAM_AUDIT,
  SETTINGS_ROOT_TAB_PARAMS,
  buildDashboardPath,
  canonicalDashboardPath,
  resolveDashboardPath,
  routeById,
  trimTrailingSlashes,
  type DashboardWorker,
} from "../dashboard-routes.js";

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
    // Undeclared parameters never leak into built URLs.
    expect(buildDashboardPath("rewards.shop", { board: "s1" })).toBe("/dashboard/rewards/shop");
    expect(buildDashboardPath("settings.plan", { siteId: "s1", board: "s1" })).toBe("/dashboard/settings/billing");
    // Values are encoded; empty values are dropped; unknown ids build nothing.
    expect(buildDashboardPath("games", { board: "a b/c" })).toBe("/dashboard/games?board=a%20b%2Fc");
    expect(buildDashboardPath("games", { board: "" })).toBe("/dashboard/games");
    expect(buildDashboardPath("not.a.route")).toBe("");
    // Deterministic: same input, same output.
    expect(buildDashboardPath("board.design", { board: "s1" })).toBe(buildDashboardPath("board.design", { board: "s1" }));
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
        expect(QUERY_PARAM_AUDIT[p]?.classification, `${r.id} ${p}`).toBe("navigation");
      }
    }
    for (const p of ["nav", ...SETTINGS_ROOT_TAB_PARAMS]) {
      expect(QUERY_PARAM_AUDIT[p]?.classification, p).toBe("navigation");
    }
    // One-shot and feature parameters must never be modeled as navigation.
    for (const p of ["edit", "viewer", "kick_connected", "error"]) {
      expect(QUERY_PARAM_AUDIT[p]?.classification, p).toBe("one-shot-action");
    }
    for (const p of ["token", "ref", "returnTo", "next", "state", "code", "path", "gid"]) {
      expect(QUERY_PARAM_AUDIT[p]?.classification, p).toBe("feature");
    }
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
      const expected = a.servedBy ?? routeById(a.routeId)!.owner;
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
