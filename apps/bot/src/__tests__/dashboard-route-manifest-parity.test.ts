// Parity gate for the canonical dashboard route manifest (Wave 2 PR-1),
// bot Worker side: the /bot* legacy aliases are served by THIS Worker in
// production (wrangler.toml routes yourrank.site/bot and /bot/* here), and
// its Hono redirects drop the query string — unlike the leaderboard Worker's
// defensive copies in telegram-routes.js, which would preserve it. Pin the
// exact served semantics (status, pathname, search) recorded on each alias.
import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import {
  DASHBOARD_ROUTE_ALIASES,
  routeById,
} from "@yourrank/shared/dashboard-routes";
import { buildDashboard } from "../dashboard.js";

// Mirror of the production mounting in hono-app.ts (buildHonoApp needs full
// env/webhook wiring; the dashboard mounts are the routing under test).
function mountedApp() {
  const app = new Hono();
  app.route("/bot", buildDashboard({ legacyPages: true }));
  app.route("/dashboard/telegram", buildDashboard({ canonical: true }));
  app.get("/bot", (c) => c.redirect("/dashboard/telegram", 301));
  return app;
}

const testEnv = {} as never;

describe("manifest parity: bot-served legacy aliases", () => {
  const app = mountedApp();

  it("redirects every bot-served redirect alias with the exact recorded semantics", async () => {
    for (const alias of DASHBOARD_ROUTE_ALIASES) {
      if (alias.kind !== "redirect") continue;
      const servedBy = alias.servedBy ?? routeById(alias.routeId).owner;
      if (servedBy !== "bot") continue;
      // Two unrelated parameters prove exact search behavior.
      const res = await app.fetch(new Request(`https://yourrank.site${alias.path}?keep=1&other=two`), testEnv);
      // Exact status — never "either 301 or 302".
      expect(res.status, `${alias.path} → ${res.status}`).toBe(alias.status);
      const location = new URL(res.headers.get("location") ?? "", "https://yourrank.site");
      const expectedPath = alias.redirectTo ?? routeById(alias.routeId).canonicalPath;
      expect(location.pathname, alias.path).toBe(expectedPath);
      if (alias.search === "preserve") {
        expect(location.search, alias.path).toBe("?keep=1&other=two");
      } else if (alias.search === "drop") {
        expect(location.search, alias.path).toBe("");
      } else {
        // /bot/settings: preserve all parameters, then set from=bot.
        expect(alias.searchTransform, alias.path).toBeTruthy();
        expect(location.searchParams.get("keep"), alias.path).toBe("1");
        expect(location.searchParams.get("other"), alias.path).toBe("two");
        expect(location.searchParams.get("from"), alias.path).toBe("bot");
        expect([...location.searchParams].length, alias.path).toBe(3);
      }
    }
  });

  it("documents the dead /dashboard/telegram/overview defensive redirect", async () => {
    // The leaderboard Worker's telegram-routes.js still maps
    // /dashboard/telegram/overview → /dashboard/telegram, but the bot Worker
    // owns yourrank.site/dashboard/telegram* in production and has no
    // /overview route: the entry is unreachable, so the manifest omits it.
    const res = await app.fetch(new Request("https://yourrank.site/dashboard/telegram/overview"), testEnv);
    expect(res.status).toBe(404);
    expect(
      DASHBOARD_ROUTE_ALIASES.some((a) => a.path === "/dashboard/telegram/overview"),
    ).toBe(false);
  });
});
