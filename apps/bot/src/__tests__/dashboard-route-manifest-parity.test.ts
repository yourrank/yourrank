// Parity gate for the canonical dashboard route manifest (Wave 2 PR-1),
// bot Worker side: the /bot* legacy aliases are served by THIS Worker in
// production (wrangler.toml routes yourrank.site/bot and /bot/* here), and
// its manifest-driven redirects drop the query string — unlike the old
// leaderboard defensive copies, which would preserve it. Pin the
// exact served semantics (status, pathname, search) recorded on each alias,
// exercising the REAL production app (buildHonoApp), not a mount mirror.
import { describe, it, expect } from "bun:test";
import {
  DASHBOARD_ROUTE_ALIASES,
  aliasWorker,
  applyAliasSearch,
  resolveAliasRedirect,
  routeById,
} from "@yourrank/shared/dashboard-routes";
import { buildHonoApp } from "../hono-app.js";

const app = buildHonoApp();
const testEnv = {} as never;

describe("manifest parity: bot-served legacy aliases", () => {
  it("redirects every bot-served redirect alias with the exact recorded semantics", async () => {
    for (const alias of DASHBOARD_ROUTE_ALIASES) {
      if (alias.kind !== "redirect") continue;
      const servedBy = alias.servedBy ?? routeById(alias.routeId).owner;
      if (servedBy !== "bot") continue;
      // Two unrelated parameters prove exact search behavior.
      const res = await app.request(`https://yourrank.site${alias.path}?keep=1&other=two`, {}, testEnv);
      // Exact status — never "either 301 or 302".
      expect(res.status, `${alias.path} → ${res.status}`).toBe(alias.status);
      const location = new URL(res.headers.get("location") ?? "", "https://yourrank.site");
      const expectedPath = alias.redirectTo ?? routeById(alias.routeId).canonicalPath;
      expect(location.pathname, alias.path).toBe(expectedPath);
      // Exact search behavior, EXECUTED from the alias's structured data —
      // the manifest, not this test, defines the transformation.
      const expectedSearch = applyAliasSearch(alias.search, new URLSearchParams("keep=1&other=two")).toString();
      expect(location.searchParams.toString(), alias.path).toBe(expectedSearch);
    }
  });

  it("documents the dead /dashboard/telegram/overview defensive redirect", async () => {
    // The bot Worker owns yourrank.site/dashboard/telegram* in production and
    // has no /overview route: the entry is unreachable, so the manifest omits it.
    const res = await app.request("https://yourrank.site/dashboard/telegram/overview", {}, testEnv);
    expect(res.status).toBe(404);
    expect(
      DASHBOARD_ROUTE_ALIASES.some((a) => a.path === "/dashboard/telegram/overview"),
    ).toBe(false);
  });

  it("leaves leaderboard-owned aliases to the leaderboard Worker", async () => {
    for (const alias of DASHBOARD_ROUTE_ALIASES) {
      if (alias.kind !== "redirect" || aliasWorker(alias) !== "leaderboard") continue;
      expect(resolveAliasRedirect(alias.path, "?keep=1", "bot"), alias.path).toBeUndefined();
      const res = await app.request(`https://yourrank.site${alias.path}?keep=1`, {}, testEnv);
      expect(res.status, alias.path).not.toBe(alias.status);
    }
  });
});
