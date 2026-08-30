import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  handleCreditsAdjustBalance,
  handleCreditsCreateReward,
  handleCreditsSaveReward,
} from "../handlers/credits.js";

const env = {};
const moderator = { id: "moderator-1", plan: "free", status: "active" };
const site = { id: "site-1", user_id: "owner-1" };
const request = (path, body) => new Request(`https://example.test${path}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("Wave H Rewards capability split", () => {
  it("lets a Moderator manage a site-scoped reward mapping", async () => {
    const capabilities = [];
    const response = await handleCreditsSaveReward(
      request("/api/credits/rewards?siteId=site-1", {
        id: "mapping-1",
        kickRewardId: "reward-1",
        kickRewardTitle: "Community reward",
        kickRewardCost: 100,
        credits: 50,
      }),
      env,
      {
        requireUser: async () => ({ user: moderator, res: null }),
        getByUser: async () => null,
        getBoardById: async (_env, userId, siteId) => {
          expect([userId, siteId]).toEqual([moderator.id, site.id]);
          return site;
        },
        requireSiteCapability: async (_user, selectedSite, capability) => {
          capabilities.push(capability);
          expect(selectedSite).toBe(site);
          return { role: "moderator", res: null };
        },
        rateLimit: async () => ({ ok: true }),
        one: async (sql) => {
          if (sql.includes("SELECT active FROM credit_reward_mappings")) return { active: true };
          if (sql.includes("SELECT plan, plan_expires_at, status FROM users")) {
            return { plan: "team", plan_expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: "active" };
          }
          return null;
        },
        withTransaction: async (fn) => fn({
          one: async (sql) => {
            if (sql.includes("count(*)")) return { count: 0 };
            if (sql.includes("SELECT id FROM credit_reward_mappings")) return { id: "mapping-1" };
            return null;
          },
          query: async () => [],
          unsafe: async () => [],
        }),
        creatorExpansionRestriction: async () => ({ restricted: false }),
      },
    );
    expect(response.status).toBe(200);
    expect(capabilities).toEqual(["canRoleManageRewards"]);
  });

  it("denies a Moderator before provider credential side effects", async () => {
    let rateLimited = false;
    const response = await handleCreditsCreateReward(
      request("/api/credits/rewards/create?siteId=site-1", { title: "Reward", cost: 100, credits: 50 }),
      env,
      {
        requireUser: async () => ({ user: moderator, res: null }),
        getByUser: async () => null,
        getBoardById: async () => site,
        requireSiteCapability: async (_user, _site, capability) => {
          expect(capability).toBe("canRoleManageConnections");
          return { role: "moderator", res: new Response("forbidden", { status: 403 }) };
        },
        rateLimit: async () => { rateLimited = true; return { ok: true }; },
      },
    );
    expect(response.status).toBe(403);
    expect(rateLimited).toBe(false);
  });

  it("denies a Moderator before arbitrary manual credit adjustment", async () => {
    let transactionStarted = false;
    const response = await handleCreditsAdjustBalance(
      request("/api/credits/viewers/member-1/balance?siteId=site-1", { delta: 50, reason: "manual" }),
      env,
      {
        requireUser: async () => ({ user: moderator, res: null }),
        getByUser: async () => null,
        getBoardById: async () => site,
        requireSiteCapability: async (_user, _site, capability) => {
          expect(capability).toBe("canRoleAdjustCredits");
          return { role: "moderator", res: new Response("forbidden", { status: 403 }) };
        },
        rateLimit: async () => ({ ok: true }),
        withTransaction: async () => { transactionStarted = true; return {}; },
      },
    );
    expect(response.status).toBe(403);
    expect(transactionStarted).toBe(false);
  });

  it("keeps provider identifiers out of the dashboard response and hides owner-only controls", () => {
    const handler = readFileSync(new URL("../handlers/credits.js", import.meta.url), "utf8");
    const client = readFileSync(new URL("../assets/credits.js", import.meta.url), "utf8");
    expect(handler).toContain("connected: Boolean(channel?.kick_channel_external_id)");
    expect(handler).not.toContain("externalId: channel?.kick_channel_external_id");
    expect(client).toContain('toggleAttribute("hidden", !capabilities.manageConnections)');
    expect(handler).toContain('"canRoleAdjustCredits"');
  });
});
