import { describe, it, expect, mock, beforeEach } from "bun:test";

// Resolve module URLs we need to mock before any handler imports.
const dbUrl = import.meta.resolve("@yourrank/shared/db");
const dbUrlTs = import.meta.resolve("@yourrank/shared/db");

const viewerSessionUrl = import.meta.resolve("@yourrank/shared/viewer-session");
const viewerSessionUrlTs = import.meta.resolve("@yourrank/shared/viewer-session");
const siteUrl = import.meta.resolve("../site.js");
const siteUrlTs = import.meta.resolve("../site.ts");
const viewerAuthUrl = import.meta.resolve("../handlers/viewer-auth.js");
const authUrl = import.meta.resolve("../auth.js");
const realDb = await import(dbUrl);
const realViewerSession = await import(viewerSessionUrl);
const realSite = await import(siteUrl);
const realViewerAuth = await import(viewerAuthUrl);
const realAuth = await import(authUrl);

const siteFixture = {
  id: "site-1",
  slug: "test",
  name: "Test Casino",
  user_id: "user-1",
  plan: "pro",
  suspended: false,
  requiresPassword: false,
  viewerKickAuthEnabled: true,
  viewerDiscordAuthEnabled: false,
  viewerPublicRedeemEnabled: true,
  viewer_kick_auth_enabled: true,
  viewer_discord_auth_enabled: false,
  viewer_public_redeem_enabled: true,
};
let boardResult = siteFixture;

const userFixture = { id: "user-1", plan: "pro", status: "active", email_verified: true };

// Mutable DB state used by all mocks. Tests can override per-call behaviour
// by mutating `db` before invoking a handler.
const db = {
  calls: [],
  oneResponses: [],
  unsafeResponses: [],
  queryResponses: [],
  withTransaction: async (fn) => fn({
    one: async (sql, params) => {
      db.calls.push({ method: "one", sql, params });
      const resp = db.oneResponses.shift();
      return typeof resp === "function" ? resp(sql, params) : resp;
    },
    unsafe: async (sql, params) => {
      db.calls.push({ method: "unsafe", sql, params });
      const resp = db.unsafeResponses.shift();
      return typeof resp === "function" ? resp(sql, params) : resp;
    },
    query: async (sql, params) => {
      db.calls.push({ method: "query", sql, params });
      const resp = db.queryResponses.shift();
      return typeof resp === "function" ? resp(sql, params) : (resp || []);
    },
    exec: async (sql, params) => {
      db.calls.push({ method: "exec", sql, params });
      return [];
    },
  }),
  one: async (sql, params) => {
    db.calls.push({ method: "one", sql, params });
    const resp = db.oneResponses.shift();
    return typeof resp === "function" ? resp(sql, params) : resp;
  },
  query: async (sql, params) => {
    db.calls.push({ method: "query", sql, params });
    const resp = db.queryResponses.shift();
    return typeof resp === "function" ? resp(sql, params) : (resp || []);
  },
  exec: async (sql, params) => {
    db.calls.push({ method: "exec", sql, params });
    return [];
  },
  getSql: () => null,
};

mock.module(dbUrl, () => ({ ...realDb, ...db }));
mock.module(dbUrlTs, () => ({ ...realDb, ...db }));

const viewerSessionState = { viewer: null };
mock.module(viewerSessionUrl, () => ({ ...realViewerSession, resolveViewer: async () => ({ viewer: viewerSessionState.viewer, cookie: null }) }));
mock.module(viewerSessionUrlTs, () => ({ ...realViewerSession, resolveViewer: async () => ({ viewer: viewerSessionState.viewer, cookie: null }) }));
mock.module(siteUrl, () => ({
  ...realSite,
  getPublicSite: async (_env, slug) => (slug === "missing" ? null : siteFixture),
  getByUser: async () => siteFixture,
  getBoardById: async () => boardResult,
}));
mock.module(siteUrlTs, () => ({
  ...realSite,
  getPublicSite: async (_env, slug) => (slug === "missing" ? null : siteFixture),
  getByUser: async () => siteFixture,
  getBoardById: async () => boardResult,
}));
mock.module(viewerAuthUrl, () => ({
  ...realViewerAuth,
  requireViewer: async () => ({ viewer: { id: "viewer-1", kick_user_id: "kick-1", kick_username: "alice" }, cookie: null, res: null }),
}));
mock.module(authUrl, () => ({
  ...realAuth,
  requireUser: async () => ({ user: userFixture, res: null }),
  bad: (error, status = 400) => new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } }),
  ok: (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
  readJson: async (req) => {
    try { return await req.json(); } catch { return {}; }
  },
}));

import { handleViewerRedeem } from "../handlers/viewer-dashboard.js";
import {
  handlePublicCredits,
  handleCreditsUpdateRedemption,
  handleCreditsAdjustBalance,
  handleCreditsReconcile,
  handleCreditsActivity,
  handleCreditsAnalytics,
  handleCreditsViewerAuth,
  handleCreditsViewerHistory,
} from "../handlers/credits.js";
import { processKickRewardRedemption } from "@yourrank/shared/kick-credits";

function resetDb() {
  db.calls.length = 0;
  db.oneResponses.length = 0;
  db.unsafeResponses.length = 0;
  db.queryResponses.length = 0;
  viewerSessionState.viewer = null;
  boardResult = siteFixture;
}

function req(url, method = "GET", body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

function makeEnv() {
  return {
    SESSIONS: { get: async () => null, put: async () => {} },
    RL_FAIL_OPEN: "true",
  };
}

beforeEach(() => resetDb());

describe("handleViewerRedeem", () => {
  it("blocks a blocked viewer before spending", async () => {
    db.oneResponses.push(
      null, // pending count (not reached)
      null, // fulfilled30d count
      { id: "sv-1", balance: 100, blocked: true } // viewer row
    );
    const res = await handleViewerRedeem(req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1" }), makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("viewer blocked");
  });

  it("redeems atomically with conditional balance and stock updates", async () => {
    db.oneResponses.push(
      { count: 0 }, // pending
      { count: 0 }, // fulfilled30d
      { id: "sv-1", balance: 100, blocked: false }, // viewer
      { id: "item-1", name: "Sticker", cost: 50, stock: 3 }, // item
      { id: "sv-1", balance: 50 }, // balance update result
      { id: "item-1" }, // stock update result
      { id: "red-1" } // redemption insert
    );
    db.unsafeResponses.push(
      [{ id: "site-1" }], // site FOR UPDATE
      [{ id: "red-1" }], // redemption insert RETURNING
      [] // ledger insert
    );
    const res = await handleViewerRedeem(req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1" }), makeEnv());
    expect(res.status).toBe(200);
    const balanceUpdate = db.calls.find((c) => c.method === "one" && /UPDATE site_viewers[\s\S]*balance = balance - \$1/s.test(c.sql));
    expect(balanceUpdate).toBeDefined();
    expect(balanceUpdate.sql).toMatch(/AND balance >= \$1/);
    expect(balanceUpdate.sql).toMatch(/RETURNING/);
    const stockUpdate = db.calls.find((c) => c.method === "one" && /UPDATE shop_items[\s\S]*stock = stock - 1/s.test(c.sql));
    expect(stockUpdate).toBeDefined();
    expect(stockUpdate.sql).toMatch(/AND stock >= 1/);
    expect(stockUpdate.sql).toMatch(/RETURNING/);
  });

  it("fails with insufficient balance when the conditional update returns no row", async () => {
    db.oneResponses.push(
      { count: 0 },
      { count: 0 },
      { id: "sv-1", balance: 20, blocked: false },
      { id: "item-1", name: "Sticker", cost: 50, stock: 3 },
      null // conditional balance update fails
    );
    db.unsafeResponses.push([{ id: "site-1" }]);
    const res = await handleViewerRedeem(req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1" }), makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("insufficient balance");
  });

  it("fails with out of stock when the conditional stock update returns no row", async () => {
    db.oneResponses.push(
      { count: 0 },
      { count: 0 },
      { id: "sv-1", balance: 100, blocked: false },
      { id: "item-1", name: "Sticker", cost: 50, stock: 0 },
      null // site_viewers update still runs? Actually stock is checked before update; in code item.stock<=0 returns out of stock early
    );
    db.unsafeResponses.push([{ id: "site-1" }]);
    const res = await handleViewerRedeem(req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1" }), makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("out of stock");
  });

  it("prevents concurrent redemption of the last stock unit", async () => {
    db.oneResponses.push(
      { count: 0 },
      { count: 0 },
      { id: "sv-1", balance: 100, blocked: false },
      { id: "item-1", name: "Sticker", cost: 50, stock: 1 },
      { id: "sv-1", balance: 50 }, // balance update ok
      null // stock update loses the race
    );
    db.unsafeResponses.push([{ id: "site-1" }]);
    const res = await handleViewerRedeem(req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1" }), makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("out of stock");
  });

  it("returns the existing order when retried with the same idempotency key", async () => {
    db.oneResponses.push(
      { count: 0 },
      { count: 0 },
      { id: "sv-1", balance: 100, blocked: false },
      { id: "item-1", name: "Sticker", cost: 50, stock: 3 },
      { id: "red-1", cost: 50 }, // existing redemption for this key
    );
    db.unsafeResponses.push([{ id: "site-1" }]);
    const res = await handleViewerRedeem(
      req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1", idempotencyKey: "retry-key" }),
      makeEnv()
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redemptionId).toBe("red-1");
    expect(body.balance).toBe(100);
    const insertCalls = db.calls.filter((c) => c.method === "unsafe" && /INSERT INTO redemptions/.test(c.sql));
    expect(insertCalls.length).toBe(0);
  });
});

describe("handlePublicCredits", () => {
  it("ignores kickUsername query param and returns viewer only for the authenticated session", async () => {
    // No session -> viewer should be null regardless of query params.
    viewerSessionState.viewer = null;
    db.queryResponses.push([]); // shopItems
    const res = await handlePublicCredits(req("https://test.com/api/public/credits?slug=test&kickUsername=alice"), makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.viewer).toBeNull();
    const viewerQuery = db.calls.find((c) => c.method === "one" && /site_viewers.*viewer_id/.test(c.sql));
    expect(viewerQuery).toBeUndefined();
  });
});

describe("handleCreditsUpdateRedemption", () => {
  it("allows cancelling a pending redemption once and writes a revoke ledger row", async () => {
    db.oneResponses.push(
      { id: "red-1", site_viewer_id: "sv-1", shop_item_id: "item-1", cost: 50 } // UPDATE RETURNING
    );
    db.unsafeResponses.push([], [], []);
    const res = await handleCreditsUpdateRedemption(
      req("https://test.com/api/credits/redemptions/red-1", "POST", { status: "cancelled" }),
      makeEnv(),
      { slug: "red-1" }
    );
    expect(res.status).toBe(200);
    const updateCall = db.calls.find((c) => c.method === "one" && /UPDATE redemptions/.test(c.sql));
    expect(updateCall.sql).toMatch(/AND r\.status = 'pending'/);
    const ledgerCall = db.calls.find((c) => c.method === "unsafe" && /INSERT INTO credit_ledger/.test(c.sql) && c.sql.includes("'revoke'"));
    expect(ledgerCall).toBeDefined();
  });

  it("prevents double-refunding a redemption", async () => {
    // First cancellation succeeds; second returns 404 because the row is no longer pending.
    db.oneResponses.push(null);
    const res = await handleCreditsUpdateRedemption(
      req("https://test.com/api/credits/redemptions/red-1", "POST", { status: "cancelled" }),
      makeEnv(),
      { slug: "red-1" }
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("redemption not found");
  });
});

describe("handleCreditsAdjustBalance", () => {
  it("adds credits with an earn ledger row", async () => {
    db.oneResponses.push(
      { id: "sv-1", balance: 10, total_earned: 50 }, // select
      { id: "sv-1", balance: 30 } // update
    );
    db.unsafeResponses.push([]);
    const res = await handleCreditsAdjustBalance(
      req("https://test.com/api/credits/viewers/sv-1/balance", "POST", { delta: 20, reason: "Birthday bonus" }),
      makeEnv(),
      { slug: "sv-1" }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe(30);
    const ledger = db.calls.find((c) => c.method === "unsafe" && /INSERT INTO credit_ledger/.test(c.sql));
    expect(ledger.sql).toMatch(/'earn'/);
    expect(ledger.params[2]).toContain("Birthday bonus");
  });

  it("refuses to debit more than the viewer's balance", async () => {
    db.oneResponses.push(
      { id: "sv-1", balance: 10, total_earned: 50 },
      null // conditional debit fails
    );
    const res = await handleCreditsAdjustBalance(
      req("https://test.com/api/credits/viewers/sv-1/balance", "POST", { delta: -20, reason: "Oops" }),
      makeEnv(),
      { slug: "sv-1" }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("insufficient balance to debit");
  });
});

describe("handleCreditsReconcile", () => {
  it("reports a mismatch when stored balance does not match the ledger", async () => {
    db.queryResponses.push([
      {
        id: "sv-1",
        balance: 100,
        total_earned: 50,
        total_spent: 0,
        ledger_earned: 50,
        ledger_spent: 10,
      },
    ]);
    const res = await handleCreditsReconcile(req("https://test.com/api/credits/reconcile?slug=test"), makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.mismatches.length).toBe(1);
    expect(body.mismatches[0].expectedBalance).toBe(40);
  });
});

describe("handleCreditsActivity", () => {
  const event = (id, type, createdAt) => ({
    id,
    created_at: createdAt || "2026-08-12T12:00:00.000Z",
    type,
    amount: 10,
    description: `${type} event`,
    kick_username: "alice",
    kick_user_id: "kick-1",
    site_id: "site-1",
    site_name: "Test Casino",
  });

  it("requires an owned site and does not leak another user's rows", async () => {
    boardResult = null;
    const res = await handleCreditsActivity(req("https://test.com/api/credits/activity?siteId=other-site"), makeEnv());
    expect(res.status).toBe(404);
    expect(db.calls.some((call) => call.method === "query")).toBe(false);
  });

  it("caps the requested page at 100", async () => {
    db.queryResponses.push([]);
    const res = await handleCreditsActivity(req("https://test.com/api/credits/activity?siteId=site-1&limit=500"), makeEnv());
    expect(res.status).toBe(200);
    expect(db.calls[0].params.at(-1)).toBe(101);
  });

  it("maps all five ledger types to balance directions", async () => {
    db.queryResponses.push([
      event("e1", "earn"),
      event("e2", "spend"),
      event("e3", "redeem"),
      event("e4", "revoke"),
      event("e5", "refund"),
    ]);
    const res = await handleCreditsActivity(req("https://test.com/api/credits/activity?siteId=site-1&limit=100"), makeEnv());
    const body = await res.json();
    expect(body.events.map((item) => item.direction)).toEqual(["credit", "debit", "debit", "credit", "debit"]);
  });

  it("uses a cursor to fetch the next page without duplicating rows", async () => {
    db.queryResponses.push(
      [event("e3", "earn", "2026-08-12T12:00:03.000Z"), event("e2", "spend", "2026-08-12T12:00:02.000Z"), event("e1", "earn", "2026-08-12T12:00:01.000Z")],
      [event("e1", "earn", "2026-08-12T12:00:01.000Z")]
    );
    const first = await handleCreditsActivity(req("https://test.com/api/credits/activity?siteId=site-1&limit=2"), makeEnv());
    const firstBody = await first.json();
    expect(firstBody.events.map((item) => item.id)).toEqual(["e3", "e2"]);
    expect(firstBody.nextCursor).toBeTruthy();

    const second = await handleCreditsActivity(req(`https://test.com/api/credits/activity?siteId=site-1&limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`), makeEnv());
    const secondBody = await second.json();
    expect(secondBody.events.map((item) => item.id)).toEqual(["e1"]);
    expect(db.calls.at(-1).sql).toContain("(cl.created_at, cl.id) < ($5::timestamptz, $6::uuid)");
    expect(db.calls.at(-1).params.slice(4, 6)).toEqual(["2026-08-12T12:00:02.000Z", "e2"]);
  });

  it("passes the username and type filters into the tenant-scoped query", async () => {
    db.queryResponses.push([]);
    const res = await handleCreditsActivity(req("https://test.com/api/credits/activity?siteId=site-1&kickUsername=Alice&type=refund"), makeEnv());
    expect(res.status).toBe(200);
    expect(db.calls[0].sql).toContain("lower(v.kick_username) = lower($2)");
    expect(db.calls[0].sql).toContain("lower(v.discord_username) = lower($2)");
    expect(db.calls[0].sql).toContain("cl.type = $3");
    expect(db.calls[0].sql).toContain("s.user_id = $4");
    expect(db.calls[0].params.slice(0, 4)).toEqual(["site-1", "Alice", "refund", "user-1"]);
  });

  it("returns Discord identity in activity rows and finds members by Discord username", async () => {
    const createdAt = "2026-08-20T12:00:00.000Z";
    db.queryResponses.push([
      {
        id: "ev-1",
        created_at: createdAt,
        type: "earn",
        amount: 15,
        description: "Discord welcome",
        kick_username: null,
        kick_user_id: null,
        discord_username: "disc_user",
        discord_user_id: "d1",
        site_id: "site-1",
        site_name: "Test",
      },
    ]);
    const res = await handleCreditsActivity(req("https://test.com/api/credits/activity?siteId=site-1&kickUsername=disc_user"), makeEnv());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.events[0].discordUsername).toBe("disc_user");
    const activityQuery = db.calls.find((c) => c.method === "query" && /credit_ledger/.test(c.sql));
    expect(activityQuery.params.slice(0, 4)).toEqual(["site-1", "disc_user", "", userFixture.id]);
  });
});

describe("handleCreditsAnalytics", () => {
  it("filters top items by the selected date range", async () => {
    db.oneResponses.push(
      { total: 1000 }, // allTimeEarned
      { total: 100 }, // periodEarned
      { total: 500 }, // allTimeSpent
      { total: 50 }, // periodSpent
      { total: 10, fulfilled: 5, pending: 3, cancelled: 2, credits_spent: 500 }, // redemptionSummary
      { total: 200 } // viewerBalance
    );
    db.queryResponses.push(
      [], // topEarners
      [{ id: "i1", name: "Sticker", redemptions: 5, credits_spent: 250 }], // topItems
      [], // redemptionsByStatus
      [] // creditsByDay
    );
    const res = await handleCreditsAnalytics(req("https://test.com/api/credits/analytics?days=7"), makeEnv());
    expect(res.status).toBe(200);
    const topItem = db.calls.find((c) => c.method === "query" && /FROM shop_items i/.test(c.sql));
    expect(topItem).toBeDefined();
    expect(topItem.params.length).toBe(2);
    expect(topItem.sql).toMatch(/r\.created_at > \$2::timestamptz/);
    expect(topItem.params[0]).toBe("site-1");
    const start = Date.parse(topItem.params[1]);
    expect(Number.isFinite(start)).toBe(true);
    expect(Math.abs(Date.now() - 7 * 86400000 - start)).toBeLessThan(1000);
    const body = await res.json();
    expect(body.topItems).toEqual([{ id: "i1", name: "Sticker", redemptions: 5, credits_spent: 250 }]);
  });
});

describe("handleCreditsViewerAuth", () => {
  it("preserves the existing public-redeem setting when the dashboard omits the field", async () => {
    siteFixture.viewer_public_redeem_enabled = false;
    const res = await handleCreditsViewerAuth(
      req("https://test.com/api/credits/viewer-auth", "POST", { kick: true, discord: true }),
      makeEnv()
    );
    expect(res.status).toBe(200);
    const call = db.calls.find((c) => c.method === "exec" && /UPDATE sites/.test(c.sql));
    expect(call.params.slice(0, 3)).toEqual([true, true, false]);
    siteFixture.viewer_public_redeem_enabled = true;
  });

  it("updates the public-redeem setting when the dashboard explicitly sends it", async () => {
    const res = await handleCreditsViewerAuth(
      req("https://test.com/api/credits/viewer-auth", "POST", { kick: true, discord: true, public: true }),
      makeEnv()
    );
    expect(res.status).toBe(200);
    const call = db.calls.find((c) => c.method === "exec" && /UPDATE sites/.test(c.sql));
    expect(call.params.slice(0, 3)).toEqual([true, true, true]);
  });
});

describe("handleCreditsViewerHistory", () => {
  it("finds a member by Discord username and returns their Discord identity", async () => {
    db.queryResponses.push([
      {
        site_id: "site-1",
        slug: "test",
        name: "Test Casino",
        site_viewer_id: "sv-1",
        balance: 30,
        total_earned: 50,
        total_spent: 20,
        blocked: false,
        fraud_score: 0,
        created_at: "2026-08-01T00:00:00.000Z",
        kick_user_id: null,
        kick_username: null,
        discord_user_id: "d1",
        discord_username: "disc_user",
        redemptions_total: 2,
        redemptions_pending: 0,
      },
    ]);
    const res = await handleCreditsViewerHistory(req("https://test.com/api/credits/viewer/history?kickUsername=disc_user"), makeEnv());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.boards[0].discordUsername).toBe("disc_user");
    const historyQuery = db.calls.find((c) => c.method === "query" && /FROM sites s/.test(c.sql));
    expect(historyQuery.sql).toMatch(/lower\(v\.discord_username\) = lower\(\$2\)/i);
  });
});

describe("processKickRewardRedemption", () => {
  it("treats a repeated event id as a duplicate", async () => {
    // Event already exists -> ON CONFLICT DO NOTHING returns no rows.
    db.unsafeResponses.push([]);
    const result = await processKickRewardRedemption({
      messageId: "msg-1",
      eventType: "channel.reward.redemption.updated",
      payload: {
        id: "red-1",
        broadcaster: { user_id: "chan-1" },
        redeemer: { user_id: "kick-1", username: "alice" },
        reward: { id: "reward-1", title: "test", cost: 10 },
        status: "fulfilled",
      },
    });
    expect(result).toEqual({ duplicate: true });
  });
});
