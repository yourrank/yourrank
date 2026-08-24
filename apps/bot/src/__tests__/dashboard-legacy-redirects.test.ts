import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DASHBOARD_ROUTE_ALIASES,
  aliasWorker,
  applyAliasSearch,
  resolveAliasRedirect,
} from "@yourrank/shared/dashboard-routes";
import { runWithLogger } from "@yourrank/shared/request-id";
import { buildHonoApp } from "../hono-app.js";

const app = buildHonoApp();
const testEnv = {} as never;

function logger(events: unknown[]) {
  return {
    reqId: "test",
    worker: "bot",
    info: (message: string, extra?: unknown) => events.push([message, extra]),
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
}

describe("manifest-owned bot redirects", () => {
  it("covers every bot-owned redirect with exact status, path, and search", async () => {
    for (const alias of DASHBOARD_ROUTE_ALIASES) {
      if (alias.kind !== "redirect" || aliasWorker(alias) !== "bot") continue;
      const search = "?keep=1&other=two";
      const expected = resolveAliasRedirect(alias.path, search, "bot");
      const response = await app.request(`https://yourrank.site${alias.path}${search}`, {}, testEnv);
      const location = new URL(response.headers.get("location") ?? "", "https://yourrank.site");
      expect(expected, alias.path).toBeDefined();
      expect(response.status, alias.path).toBe(expected!.status);
      expect(location.pathname, alias.path).toBe(expected!.pathname);
      const expectedSearch = applyAliasSearch(alias.search, new URLSearchParams(search)).toString();
      expect(location.search, alias.path).toBe(expectedSearch ? `?${expectedSearch}` : "");
    }
  });

  it("does not serve leaderboard-owned aliases", async () => {
    for (const alias of DASHBOARD_ROUTE_ALIASES) {
      if (alias.kind !== "redirect" || aliasWorker(alias) !== "leaderboard") continue;
      expect(resolveAliasRedirect(alias.path, "?keep=1", "bot"), alias.path).toBeUndefined();
      const response = await app.request(`https://yourrank.site${alias.path}?keep=1`, {}, testEnv);
      expect(response.status, alias.path).not.toBe(alias.status);
    }
  });

  it("keeps the legacy mount page-free while preserving its support surfaces", async () => {
    for (const [path, target] of [
      ["/bot/bots", "/dashboard/telegram/bots"],
      ["/bot/dashboard", "/dashboard/telegram"],
    ]) {
      const response = await app.request(`https://yourrank.site${path}`, {}, testEnv);
      expect(response.status, path).toBe(301);
      expect(new URL(response.headers.get("location") ?? "", "https://yourrank.site").pathname, path)
        .toBe(target);
    }

    const nonAliasPage = await app.request("https://yourrank.site/bot/overview", {}, testEnv);
    expect(nonAliasPage.status).toBe(404);

    const client = await app.request("https://yourrank.site/bot/dash/client.js", {}, testEnv);
    expect(client.status).toBe(200);
    expect(client.headers.get("content-type")).toContain("application/javascript");

    const auth = await app.request("https://yourrank.site/bot/auth/logout", {
      method: "POST",
      headers: { accept: "application/json" },
    }, testEnv);
    expect(auth.status).toBe(200);

    const api = await app.request("https://yourrank.site/bot/api/users", {
      method: "POST",
    }, testEnv);
    expect(api.status).not.toBe(404);
  });

  it("emits one bounded path event and ignores logger failures", async () => {
    const events: unknown[] = [];
    const response = await runWithLogger(logger(events), () =>
      app.request("https://yourrank.site/bot/settings?token=SECRET&keep=1", {}, testEnv),
    );
    expect(response.status).toBe(302);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(["dashboard_legacy_redirect", {
      alias: "/bot/settings",
      route_id: "settings.account",
      status: 302,
      served_by: "bot",
      source: "path_alias",
    }]);
    expect(JSON.stringify(events)).not.toContain("SECRET");
    expect(JSON.stringify(events)).not.toContain("token=");

    const failed = await runWithLogger({
      ...logger([]),
      info: () => { throw new Error("logger failed"); },
    }, () => app.request("https://yourrank.site/bot/settings?token=SECRET&keep=1", {}, testEnv));
    expect(failed.status).toBe(response.status);
    expect(failed.headers.get("location")).toBe(response.headers.get("location"));
  });

  it("does not emit for canonical Telegram navigation", async () => {
    const events: unknown[] = [];
    await runWithLogger(logger(events), () =>
      app.request("https://yourrank.site/dashboard/telegram", {}, testEnv),
    );
    expect(events).toHaveLength(0);
  });

  it("keeps runtime alias ownership manifest-driven", () => {
    const source = readFileSync(new URL("../hono-app.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(source).not.toContain("LEGACY_TELEGRAM_REDIRECTS");
    expect(source).not.toMatch(/\{\s*["']\/(?:dashboard|bot)[^}]{0,240}:\s*["']\/(?:dashboard|bot)/s);
    expect(source).not.toMatch(/logLegacyDashboardRedirect\s*\(\s*\{[\s\S]{0,500}?(?:url\.search|searchParams|query)/);
  });
});
