// Reward publishing requires a creator contact method, but only for a new
// activation: rewards that are already live keep working and can be edited or
// paused without the check.
import { describe, expect, it } from "bun:test";
import { REWARD_CONTACT_REQUIRED_MESSAGE, handleCreditsSaveShopItem } from "../handlers/credits.js";

const id = "11111111-1111-4111-8111-111111111111";
const withContact = { id: "site-a", user_id: "owner", extra_json: JSON.stringify({ contact: { email: "creator@example.com" } }) };
const socialsOnly = { id: "site-a", user_id: "owner", extra_json: JSON.stringify({ socials: [{ name: "Kick", url: "https://kick.com/demo", enabled: true }] }) };
const noContact = { id: "site-a", user_id: "owner", extra_json: JSON.stringify({ contact: { email: "", discord: "", social: "", url: "" } }) };

function save(body) {
  return new Request("https://test.com/api/credits/shop?siteId=site-a", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function deps(site, { existing = null, writes = [] } = {}) {
  return {
    requireUser: async () => ({ user: { id: "owner", plan: "pro" } }),
    getBoardById: async () => site,
    requireSiteCapability: async () => ({}),
    rateLimit: async () => ({ ok: true }),
    creatorExpansionRestriction: async () => ({ restricted: false }),
    one: async (sql) => (sql.includes("SELECT active FROM shop_items") ? existing : null),
    exec: async (sql, params) => { writes.push({ sql, params }); return [{ id }]; },
    withTransaction: async (fn) => fn({ one: async () => ({ count: 0 }), unsafe: async (sql, params) => { writes.push({ sql, params }); return [{ id }]; } }),
  };
}

describe("creator contact requirement for rewards", () => {
  it("rejects publishing a new reward when the creator has no contact method", async () => {
    const writes = [];
    const res = await handleCreditsSaveShopItem(save({ name: "Song", cost: 100 }), {}, deps(noContact, { writes }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(REWARD_CONTACT_REQUIRED_MESSAGE);
    expect(writes).toHaveLength(0);
  });

  it("does not count social links as a contact method", async () => {
    const res = await handleCreditsSaveShopItem(save({ name: "Song", cost: 100 }), {}, deps(socialsOnly));
    expect(res.status).toBe(400);
  });

  it("rejects re-activating a paused reward without a contact method", async () => {
    const res = await handleCreditsSaveShopItem(save({ id, name: "Song", cost: 100, active: true }), {}, deps(noContact, { existing: { active: false } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(REWARD_CONTACT_REQUIRED_MESSAGE);
  });

  it("publishes a new reward once any single method is configured", async () => {
    const writes = [];
    const res = await handleCreditsSaveShopItem(save({ name: "Song", cost: 100 }), {}, deps(withContact, { writes }));
    expect(res.status).toBe(200);
    expect(writes.length).toBeGreaterThan(0);
  });

  it("leaves an already published reward editable and active without a contact method", async () => {
    const writes = [];
    const res = await handleCreditsSaveShopItem(save({ id, name: "Song (renamed)", cost: 120, active: true }), {}, deps(noContact, { existing: { active: true }, writes }));
    expect(res.status).toBe(200);
    const update = writes.find((w) => /UPDATE shop_items/i.test(w.sql));
    expect(update).toBeDefined();
    expect(update.sql).not.toMatch(/active\s*=\s*false/i);
  });

  it("lets a creator pause a reward without a contact method", async () => {
    const res = await handleCreditsSaveShopItem(save({ id, name: "Song", cost: 100, active: false }), {}, deps(noContact, { existing: { active: true } }));
    expect(res.status).toBe(200);
  });
});
