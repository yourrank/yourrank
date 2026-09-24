// HTTP-level contract for commercial denials: every feature/limit denial must
// surface as 403 with the full structured body (code, feature|limit,
// current_plan, required_plan, usage, allowance) via denied() in auth.js.
// Also guards against reintroducing ad-hoc codes in handlers.
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { handleCreditsSaveReward, handleCreditsSaveShopItem } from "../handlers/credits.js";
import { handleTeamInvite } from "../handlers/team.js";
import { handleCreateActivityTemplate } from "../handlers/activity-automation.js";

const USER = { id: "user-1", plan: "free", status: "active" };
const SITE = { id: "site-1", slug: "board", published: true, user_id: "user-1", extra_json: "{}", data: {} };

const req = (url, body) => new Request(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body || {}),
});

const env = { DATABASE_URL: "postgres://test" };

const okUser = () => async () => ({ user: USER, res: null });
const okCapability = () => async () => ({ res: null, role: "owner" });
const okRateLimit = async () => ({ ok: true });

describe("commercial denial contract (403 + structured body)", () => {
  // The PUT /api/site players_per_site denial is covered in
  // sites-handlers.test.js (module-mocked saveSite returns the denial).

  it("reward mapping save over the allowance returns plan_limit_reached", async () => {
    const tx = {
      unsafe: async () => [],
      one: async () => ({ count: 3 }),
      query: async () => [],
    };
    const res = await handleCreditsSaveReward(req("https://test.com/api/credits/reward", {
      kickRewardId: "r4", kickRewardTitle: "Reward 4", kickRewardCost: 100, credits: 50,
    }), env, {
      requireUser: okUser(),
      getByUser: async () => SITE,
      getBoardById: async () => SITE,
      requireSiteCapability: okCapability(),
      rateLimit: okRateLimit,
      one: async () => ({ active: true }),
      withTransaction: async (fn) => fn(tx),
      creatorExpansionRestriction: async () => ({ restricted: false, usage: null }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("plan_limit_reached");
    expect(body.limit).toBe("reward_mappings");
    expect(body.current_plan).toBe("free");
    expect(body.required_plan).toBe("pro");
    expect(body.usage).toBe(3);
    expect(body.allowance).toBe(3);
    expect(typeof body.error).toBe("string");
  });

  it("shop item save over the allowance returns plan_limit_reached", async () => {
    const tx = {
      unsafe: async () => [],
      one: async () => ({ count: 3 }),
      query: async () => [],
    };
    const site = { ...SITE, extra_json: JSON.stringify({ contact: { email: "owner@yourrank.test" } }) };
    const res = await handleCreditsSaveShopItem(req("https://test.com/api/credits/shop-item", {
      name: "Item 4", cost: 10, active: true,
    }), env, {
      requireUser: okUser(),
      getByUser: async () => site,
      getBoardById: async () => site,
      requireSiteCapability: okCapability(),
      rateLimit: okRateLimit,
      one: async () => null,
      withTransaction: async (fn) => fn(tx),
      creatorExpansionRestriction: async () => ({ restricted: false, usage: null }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("plan_limit_reached");
    expect(body.limit).toBe("shop_items");
    expect(body.usage).toBe(3);
    expect(body.allowance).toBe(3);
  });

  it("team invite on Free returns entitlement_required with required_plan team", async () => {
    const res = await handleTeamInvite(req("https://test.com/api/site/team/invite", {
      siteId: "site-1", email: "mod@yourrank.test", role: "moderator",
    }), env, {
      requireUser: okUser(),
      rateLimit: async () => ({ ok: true }),
      rateLimitHeaders: () => ({}),
      getTeamSiteByUser: async () => ({ site: SITE, role: "owner" }),
      getSiteById: async () => SITE,
      getSiteRole: async () => "owner",
      createSiteInvite: async () => ({
        ok: false,
        error: "Team collaboration requires Team.",
        code: "entitlement_required",
        denial: {
          error: "Team collaboration requires Team.",
          code: "entitlement_required",
          feature: "team_collaboration",
          current_plan: "free",
          required_plan: "team",
        },
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("entitlement_required");
    expect(body.feature).toBe("team_collaboration");
    expect(body.required_plan).toBe("team");
    expect(body.current_plan).toBe("free");
  });

  it("team invite at the seat cap returns plan_limit_reached operator_seats", async () => {
    const res = await handleTeamInvite(req("https://test.com/api/site/team/invite", {
      siteId: "site-1", email: "mod6@yourrank.test", role: "moderator",
    }), env, {
      requireUser: okUser(),
      rateLimit: async () => ({ ok: true }),
      rateLimitHeaders: () => ({}),
      getTeamSiteByUser: async () => ({ site: SITE, role: "owner" }),
      getSiteById: async () => SITE,
      getSiteRole: async () => "owner",
      createSiteInvite: async () => ({
        ok: false,
        error: "Team seats are full (5).",
        code: "plan_limit_reached",
        denial: {
          error: "Team seats are full (5).",
          code: "plan_limit_reached",
          limit: "operator_seats",
          usage: 5,
          allowance: 5,
          current_plan: "team",
          required_plan: "team",
        },
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("plan_limit_reached");
    expect(body.limit).toBe("operator_seats");
    expect(body.usage).toBe(5);
    expect(body.allowance).toBe(5);
  });

  it("activity template creation on Free returns entitlement_required", async () => {
    const res = await handleCreateActivityTemplate(req("https://test.com/api/activities/templates", {
      siteId: "site-1", kind: "safe_code_drop", name: "Drop", config: { pointsReward: 50, maxClaims: 20, expireMinutes: 30 },
    }), env, {
      requireUser: okUser(),
      getByUser: async () => SITE,
      getBoardById: async () => SITE,
      requireSiteCapability: okCapability(),
      rateLimit: okRateLimit,
      one: async () => ({ id: "user-1", plan: "free", plan_expires_at: null, status: "active" }),
      now: () => new Date("2026-01-01T00:00:00Z"),
      logAudit: async () => {},
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("entitlement_required");
    expect(body.feature).toBe("activity_automation");
    expect(body.required_plan).toBe("pro");
  });
});

describe("no ad-hoc denial codes in handlers", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "handlers");
  it("handlers never emit the legacy board_limit/player_limit codes", () => {
    const offenders = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".js")) continue;
      const src = readFileSync(join(dir, file), "utf8");
      for (const code of ['"board_limit"', '"player_limit"', "'board_limit'", "'player_limit'"]) {
        if (src.includes(code)) offenders.push(`${file}: ${code}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
