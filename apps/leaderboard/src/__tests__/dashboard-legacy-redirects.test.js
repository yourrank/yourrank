import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DASHBOARD_ROUTE_ALIASES,
  NAV_QUERY_ALIASES,
  applyAliasSearch,
  aliasWorker,
  resolveAliasRedirect,
  resolveNavRedirect,
} from "@yourrank/shared/dashboard-routes";
import {
  handleRequest,
} from "../index.js";
import { runWithLogger } from "@yourrank/shared/request-id";

const request = (path) => new Request(`https://yourrank.test${path}`);
const testEnv = {};

const redirect = async (path) => handleRequest(request(path), testEnv, {});

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function runtimeSources(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") files.push(...runtimeSources(path));
    } else if (/\.(js|ts|tsx)$/.test(entry.name) && !entry.name.includes("assets_bundled")) {
      files.push(path);
    }
  }
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

describe("manifest-owned dashboard redirects", () => {
  it("covers representative leaderboard aliases and exact query behavior", async () => {
    for (const [path, status, target, search] of [
      ["/dashboard/settings/board?keep=1", 301, "/dashboard/site", "?keep=1"],
      ["/dashboard/manage?keep=1", 302, "/dashboard/settings", "?keep=1"],
      ["/account/plan?keep=1", 302, "/dashboard/settings/plan", "?keep=1"],
      ["/account/profile?keep=1", 302, "/dashboard/settings/account", "?keep=1"],
      ["/dashboard/setup?keep=1", 302, "/dashboard", ""],
      ["/dashboard/editor/players?board=site-1", 301, "/dashboard/leaderboard/players", "?board=site-1"],
    ]) {
      const response = await redirect(path);
      expect(response.status, path).toBe(status);
      const location = new URL(response.headers.get("location"), "https://yourrank.test");
      expect(location.pathname, path).toBe(target);
      expect(location.search, path).toBe(search);
    }
  });

  it("derives every leaderboard redirect from the shared resolver", async () => {
    for (const alias of DASHBOARD_ROUTE_ALIASES) {
      if (alias.kind !== "redirect" || aliasWorker(alias) !== "leaderboard") continue;
      const search = "?keep=1&other=two";
      const expected = resolveAliasRedirect(alias.path, search, "leaderboard");
      const response = await redirect(`${alias.path}${search}`);
      expect(expected, alias.path).toBeDefined();
      expect(response.status, alias.path).toBe(expected.status);
      const location = new URL(response.headers.get("location"), "https://yourrank.test");
      expect(location.pathname, alias.path).toBe(expected.pathname);
      expect(location.search, alias.path).toBe(expected.search.toString() ? `?${expected.search.toString()}` : "");
      const expectedSearch = applyAliasSearch(alias.search, new URLSearchParams(search)).toString();
      expect(location.search, alias.path).toBe(expectedSearch ? `?${expectedSearch}` : "");
    }
  });

  it("accounts for every redirect alias across both Worker owners", () => {
    const redirectAliases = DASHBOARD_ROUTE_ALIASES
      .filter((alias) => alias.kind === "redirect")
      .map((alias) => alias.path)
      .sort();
    const leaderboardAliases = DASHBOARD_ROUTE_ALIASES
      .filter((alias) => alias.kind === "redirect" && aliasWorker(alias) === "leaderboard")
      .map((alias) => alias.path);
    const botAliases = DASHBOARD_ROUTE_ALIASES
      .filter((alias) => alias.kind === "redirect" && aliasWorker(alias) === "bot")
      .map((alias) => alias.path);
    expect([...new Set([...leaderboardAliases, ...botAliases])].sort()).toEqual(redirectAliases);
  });

  it("keeps nav redirects manifest-backed and preserves only unrelated parameters", async () => {
    for (const nav of Object.keys(NAV_QUERY_ALIASES)) {
      const expected = resolveNavRedirect(nav, `nav=${nav}&keep=1&token=SECRET`);
      const response = await redirect(`/dashboard?nav=${nav}&keep=1&token=SECRET`);
      const location = new URL(response.headers.get("location"), "https://yourrank.test");
      expect(response.status, nav).toBe(expected.status);
      expect(location.pathname, nav).toBe(expected.pathname);
      expect(location.search, nav).toBe(expected.search.toString() ? `?${expected.search.toString()}` : "");
      expect(location.searchParams.has("nav"), nav).toBe(false);
      expect(location.searchParams.get("keep"), nav).toBe("1");
    }
  });

  it("lands manage/settings spellings on account settings", async () => {
    for (const path of ["/dashboard/manage", "/dashboard/settings/unknown", "/dashboard/manage/x"]) {
      const response = await redirect(path);
      const location = new URL(response.headers.get("location"), "https://yourrank.test");
      expect(response.status, path).toBe(302);
      expect(location.pathname, path).toBe("/dashboard/settings");
    }
    const nav = await redirect("/dashboard?nav=manage");
    expect(new URL(nav.headers.get("location"), "https://yourrank.test").pathname).toBe("/dashboard/settings");
  });

  it("does not retain a second dashboard alias registry or raw telemetry query", () => {
    const sources = runtimeSources(fileURLToPath(new URL("../", import.meta.url)))
      .map((path) => [path, stripComments(readFileSync(path, "utf8"))]);
    const joined = sources.map(([, source]) => source).join("\n");
    expect(joined).not.toContain("LEGACY_TELEGRAM_REDIRECTS");
    expect(joined).not.toMatch(/\{\s*["']\/(?:dashboard|bot)[^}]{0,240}:\s*["']\/(?:dashboard|bot)/s);
    expect(joined).not.toMatch(/logLegacyDashboardRedirect\s*\(\s*\{[\s\S]{0,500}?(?:url\.search|searchParams|query)/);
    const index = sources.find(([path]) => path.endsWith("/index.js"))?.[1] || "";
    expect(index).not.toMatch(/["'`]\/(?:bot|dashboard\/telegram)/);
  });

  it("emits exactly one bounded event and survives logger failures", async () => {
    const events = [];
    const logger = {
      reqId: "test",
      worker: "leaderboard",
      info: (message, extra) => events.push([message, extra]),
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    const response = await runWithLogger(logger, () => redirect("/dashboard/setup?token=SECRET"));
    expect(response.status).toBe(302);
    expect(events).toHaveLength(1);
    expect(events[0][0]).toBe("dashboard_legacy_redirect");
    expect(events[0][1]).toEqual({
      alias: "/dashboard/setup",
      route_id: "home",
      status: 302,
      served_by: "leaderboard",
      source: "path_alias",
    });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("token=");

    const failingLogger = {
      reqId: "test",
      worker: "leaderboard",
      info: () => { throw new Error("logger failed"); },
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    const failed = await runWithLogger(failingLogger, () => redirect("/dashboard/setup?token=SECRET"));
    expect(failed.status).toBe(response.status);
    expect(failed.headers.get("location")).toBe(response.headers.get("location"));
  });
});
