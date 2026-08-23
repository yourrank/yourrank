import { describe, it, expect, mock, beforeEach } from "bun:test";

// Edge-case coverage for the rewards / shop loop, complementing
// credits-loop.test.js:
//   create item -> price -> inventory -> redeem -> inventory update
//   0 credits / exact credits / insufficient credits
//   out of stock / quantity 1 / unlimited quantity
//   double click / refresh during redeem / redeem from two tabs
//
// Mock pattern mirrors credits-loop.test.js: process-global module mocks
// with queue-based DB responses.

const dbUrl = import.meta.resolve("@yourrank/shared/db");
const viewerSessionUrl = import.meta.resolve("@yourrank/shared/viewer-session");
const siteUrl = import.meta.resolve("../site.js");
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
};
let boardResult = siteFixture;

const userFixture = { id: "user-1", plan: "pro", status: "active", email_verified: true };

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
      if (resp instanceof Error) throw resp;
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

const viewerSessionState = { viewer: null };

mock.module(dbUrl, () => ({ ...realDb, ...db }));
mock.module(viewerSessionUrl, () => ({ ...realViewerSession, resolveViewer: async () => ({ viewer: viewerSessionState.viewer, cookie: null }) }));
mock.module(siteUrl, () => ({
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
import { handleCreditsSaveShopItem, handleCreditsUpdateRedemption } from "../handlers/credits.js";

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

// --- Create item -> price -> inventory -------------------------------------

describe("handleCreditsSaveShopItem", () => {
  it("creates an item with price and starting inventory", async () => {
    db.unsafeResponses.push(
      [{ id: "site-1" }], // site FOR UPDATE
      [{ id: "item-1" }] // INSERT ... RETURNING id
    );
    db.oneResponses.push({ count: 0 }); // active item count under plan limit
    const res = await handleCreditsSaveShopItem(
      req("https://test.com/api/credits/shop", "POST", { name: "Sticker", description: "A sticker", cost: 100, stock: 5 }),
      makeEnv()
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("item-1");
    const insert = db.calls.find((c) => c.method === "unsafe" && /INSERT INTO shop_items/.test(c.sql));
    expect(insert).toBeDefined();
    expect(insert.params).toEqual(["site-1", "Sticker", "A sticker", 100, 5, true]);
  });

  it("rejects a price of 0", async () => {
    const res = await handleCreditsSaveShopItem(
      req("https://test.com/api/credits/shop", "POST", { name: "Freebie", cost: 0, stock: 5 }),
      makeEnv()
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/positive/);
  });

  it("rejects a negative price", async () => {
    const res = await handleCreditsSaveShopItem(
      req("https://test.com/api/credits/shop", "POST", { name: "Bad", cost: -50, stock: 5 }),
      makeEnv()
    );
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric price", async () => {
    const res = await handleCreditsSaveShopItem(
      req("https://test.com/api/credits/shop", "POST", { name: "Bad", cost: "lots", stock: 5 }),
      makeEnv()
    );
    expect(res.status).toBe(400);
  });

  it("rejects negative inventory", async () => {
    const res = await handleCreditsSaveShopItem(
      req("https://test.com/api/credits/shop", "POST", { name: "Bad", cost: 10, stock: -1 }),
      makeEnv()
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/non-negative/);
  });

  it("accepts stock of 0 (item created already sold out)", async () => {
    db.unsafeResponses.push([{ id: "site-1" }], [{ id: "item-1" }]);
    db.oneResponses.push({ count: 0 });
    const res = await handleCreditsSaveShopItem(
      req("https://test.com/api/credits/shop", "POST", { name: "Rare", cost: 10, stock: 0 }),
      makeEnv()
    );
    expect(res.status).toBe(200);
  });

  it("accepts null stock as unlimited quantity", async () => {
    db.unsafeResponses.push([{ id: "site-1" }], [{ id: "item-1" }]);
    db.oneResponses.push({ count: 0 });
    const res = await handleCreditsSaveShopItem(
      req("https://test.com/api/credits/shop", "POST", { name: "Unlimited", cost: 10, stock: null }),
      makeEnv()
    );
    expect(res.status).toBe(200);
    const insert = db.calls.find((c) => c.method === "unsafe" && /INSERT INTO shop_items/.test(c.sql));
    expect(insert.params[4]).toBeNull();
  });

  it("rejects an item with no name", async () => {
    const res = await handleCreditsSaveShopItem(
      req("https://test.com/api/credits/shop", "POST", { name: "  ", cost: 10, stock: 5 }),
      makeEnv()
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/name/i);
  });

  it("updates price and inventory on an existing item", async () => {
    db.unsafeResponses.push(
      [{ id: "site-1" }], // site FOR UPDATE
      [{ id: "item-1" }] // UPDATE ... RETURNING id
    );
    db.oneResponses.push({ count: 1 }); // excludes the item being edited
    const res = await handleCreditsSaveShopItem(
      req("https://test.com/api/credits/shop", "POST", { id: "item-1", name: "Sticker v2", cost: 250, stock: 9 }),
      makeEnv()
    );
    expect(res.status).toBe(200);
    const update = db.calls.find((c) => c.method === "unsafe" && /UPDATE shop_items/.test(c.sql));
    expect(update).toBeDefined();
    expect(update.params[2]).toBe(250);
    expect(update.params[3]).toBe(9);
    expect(update.params[6]).toBe("site-1"); // tenant-scoped update
  });

  it("rejects creating an item past the plan shop limit", async () => {
    db.unsafeResponses.push([{ id: "site-1" }]);
    db.oneResponses.push({ count: 100 }); // pro plan limit is 100
    const res = await handleCreditsSaveShopItem(
      req("https://test.com/api/credits/shop", "POST", { name: "One too many", cost: 10, stock: 5 }),
      makeEnv()
    );
    expect(res.status).toBe(403);
  });
});

// --- Redeem: balance edge cases ---------------------------------------------

describe("handleViewerRedeem balance edge cases", () => {
  it("redeems with exactly enough credits and lands on a zero balance", async () => {
    db.oneResponses.push(
      null, // no existing redemption for token
      { count: 0 }, // pending
      { count: 0 }, // fulfilled30d
      { id: "sv-1", balance: 50, blocked: false }, // viewer
      { id: "item-1", name: "Sticker", cost: 50, stock: 3 }, // item
      { id: "sv-1", balance: 0 }, // conditional balance update
      { id: "item-1" }, // stock update
      { id: "red-1" } // (unused by tx.unsafe path)
    );
    db.unsafeResponses.push(
      [{ id: "site-1" }], // site FOR UPDATE
      [{ id: "red-1" }], // redemption insert
      [] // ledger insert
    );
    const res = await handleViewerRedeem(req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1", idempotencyKey: "test-key" }), makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe(0);
    // The spend must be guarded so balance can never dip below zero.
    const balanceUpdate = db.calls.find((c) => c.method === "one" && /UPDATE site_viewers/.test(c.sql));
    expect(balanceUpdate.sql).toMatch(/AND balance >= \$1/);
    expect(balanceUpdate.params).toEqual([50, "sv-1"]);
  });

  it("refuses to redeem with 0 credits", async () => {
    db.oneResponses.push(
      null, // no existing redemption for token
      { count: 0 },
      { count: 0 },
      { id: "sv-1", balance: 0, blocked: false },
      { id: "item-1", name: "Sticker", cost: 50, stock: 3 },
      null // conditional update finds no row: balance 0 < cost 50
    );
    db.unsafeResponses.push([{ id: "site-1" }]);
    const res = await handleViewerRedeem(req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1", idempotencyKey: "test-key" }), makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("insufficient balance");
    // No redemption row or ledger entry may be written.
    expect(db.calls.some((c) => /INSERT INTO redemptions/.test(c.sql))).toBe(false);
    expect(db.calls.some((c) => /INSERT INTO credit_ledger/.test(c.sql))).toBe(false);
  });

  it("refuses to redeem when the viewer has never earned on this board", async () => {
    db.oneResponses.push(
      null, // no existing redemption for token
      { count: 0 },
      { count: 0 },
      null // no site_viewers row at all
    );
    db.unsafeResponses.push([{ id: "site-1" }]);
    const res = await handleViewerRedeem(req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1", idempotencyKey: "test-key" }), makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Earn some first/);
  });
});

// --- Redeem: inventory edge cases -------------------------------------------

describe("handleViewerRedeem inventory edge cases", () => {
  it("redeems the single unit of a quantity-1 item and decrements stock", async () => {
    db.oneResponses.push(
      null, // no existing redemption for token
      { count: 0 },
      { count: 0 },
      { id: "sv-1", balance: 100, blocked: false },
      { id: "item-1", name: "One-off", cost: 50, stock: 1 },
      { id: "sv-1", balance: 50 },
      { id: "item-1" } // stock 1 -> 0 succeeds
    );
    db.unsafeResponses.push([{ id: "site-1" }], [{ id: "red-1" }], []);
    const res = await handleViewerRedeem(req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1", idempotencyKey: "test-key" }), makeEnv());
    expect(res.status).toBe(200);
    const stockUpdate = db.calls.find((c) => c.method === "one" && /UPDATE shop_items/.test(c.sql));
    expect(stockUpdate.sql).toMatch(/AND stock >= 1/);
  });

  it("does not touch stock for an unlimited-quantity item", async () => {
    db.oneResponses.push(
      null, // no existing redemption for token
      { count: 0 },
      { count: 0 },
      { id: "sv-1", balance: 100, blocked: false },
      { id: "item-1", name: "Unlimited", cost: 50, stock: null },
      { id: "sv-1", balance: 50 }
      // no stock update expected for stock === null
    );
    db.unsafeResponses.push([{ id: "site-1" }], [{ id: "red-1" }], []);
    const res = await handleViewerRedeem(req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1", idempotencyKey: "test-key" }), makeEnv());
    expect(res.status).toBe(200);
    expect(db.calls.some((c) => /UPDATE shop_items/.test(c.sql))).toBe(false);
  });

  it("refuses items listed as out of stock before spending", async () => {
    db.oneResponses.push(
      null, // no existing redemption for token
      { count: 0 },
      { count: 0 },
      { id: "sv-1", balance: 100, blocked: false },
      { id: "item-1", name: "Gone", cost: 50, stock: 0 }
    );
    db.unsafeResponses.push([{ id: "site-1" }]);
    const res = await handleViewerRedeem(req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1", idempotencyKey: "test-key" }), makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("out of stock");
    // Balance must not be touched when the item is unavailable.
    expect(db.calls.some((c) => /UPDATE site_viewers/.test(c.sql))).toBe(false);
  });

  it("rejects redeeming an inactive or deleted item", async () => {
    db.oneResponses.push(
      null, // no existing redemption for token
      { count: 0 },
      { count: 0 },
      { id: "sv-1", balance: 100, blocked: false },
      null // item lookup with active=true finds nothing
    );
    db.unsafeResponses.push([{ id: "site-1" }]);
    const res = await handleViewerRedeem(req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1", idempotencyKey: "test-key" }), makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("item not found");
  });
});

// --- Double spend: double click / two tabs / refresh -------------------------

describe("handleViewerRedeem double-spend protection", () => {
  it("two tabs racing on the exact balance: only one spend succeeds", async () => {
    // Tab A wins the conditional balance update; tab B's update matches no row.
    const first = (() => {
      db.oneResponses.push(
        null, // no existing redemption for token
        { count: 0 },
        { count: 0 },
        { id: "sv-1", balance: 50, blocked: false },
        { id: "item-1", name: "Sticker", cost: 50, stock: null },
        { id: "sv-1", balance: 0 }
      );
      db.unsafeResponses.push([{ id: "site-1" }], [{ id: "red-1" }], []);
      return handleViewerRedeem(req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1", idempotencyKey: "test-key" }), makeEnv());
    })();
    const resA = await first;
    expect(resA.status).toBe(200);

    resetDb();
    db.oneResponses.push(
      null, // no existing redemption for token
      { count: 0 },
      { count: 0 },
      { id: "sv-1", balance: 50, blocked: false }, // stale read before tab A commits
      { id: "item-1", name: "Sticker", cost: 50, stock: null },
      null // tab A already spent it: balance >= 50 matches nothing
    );
    db.unsafeResponses.push([{ id: "site-1" }]);
    const resB = await handleViewerRedeem(req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1", idempotencyKey: "test-key" }), makeEnv());
    expect(resB.status).toBe(400);
    const bodyB = await resB.json();
    expect(bodyB.error).toBe("insufficient balance");
  });

  it("a failed write inside the transaction aborts the whole redemption", async () => {
    // Simulates a connection drop / crash mid-transaction ("refresh during
    // redeem"): the ledger insert blows up after the balance was debited.
    // The handler must surface an error rather than report success, so the
    // DB rolls everything back atomically.
    db.oneResponses.push(
      null, // no existing redemption for token
      { count: 0 },
      { count: 0 },
      { id: "sv-1", balance: 100, blocked: false },
      { id: "item-1", name: "Sticker", cost: 50, stock: null },
      { id: "sv-1", balance: 50 }
    );
    db.unsafeResponses.push(
      [{ id: "site-1" }],
      [{ id: "red-1" }],
      new Error("connection reset")
    );
    await expect(
      handleViewerRedeem(req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1", idempotencyKey: "test-key" }), makeEnv())
    ).rejects.toThrow("connection reset");
  });

  it("issues exactly one redemption row and one spend ledger entry per successful redeem", async () => {
    // Guard against regression where a retry handler could double-insert.
    db.oneResponses.push(
      null, // no existing redemption for token
      { count: 0 },
      { count: 0 },
      { id: "sv-1", balance: 500, blocked: false },
      { id: "item-1", name: "Sticker", cost: 50, stock: 10 },
      { id: "sv-1", balance: 450 },
      { id: "item-1" }
    );
    db.unsafeResponses.push([{ id: "site-1" }], [{ id: "red-1" }], []);
    const res = await handleViewerRedeem(req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1", idempotencyKey: "test-key" }), makeEnv());
    expect(res.status).toBe(200);
    const redemptionInserts = db.calls.filter((c) => /INSERT INTO redemptions/.test(c.sql));
    const ledgerInserts = db.calls.filter((c) => /INSERT INTO credit_ledger/.test(c.sql));
    expect(redemptionInserts.length).toBe(1);
    expect(ledgerInserts.length).toBe(1);
    expect(ledgerInserts[0].sql).toMatch(/'spend'/);
  });

  it("retry with the same idempotency key returns the original order without mutating balance or stock", async () => {
    // Simulates the client retrying after a lost/network-failed response: the
    // server already accepted the first request, so the retry must resolve to
    // the same redemption and must not deduct balance or stock again.
    db.oneResponses.push({
      id: "red-1",
      shop_item_id: "item-1",
      cost: 50,
      status: "pending",
      balance: 450,
      blocked: false,
      item_name: "Sticker",
    });
    db.unsafeResponses.push([{ id: "site-1" }]);
    const res = await handleViewerRedeem(req("https://test.com/api/viewer/redeem", "POST", { slug: "test", shopItemId: "item-1", idempotencyKey: "test-key" }), makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redemptionId).toBe("red-1");
    expect(body.balance).toBe(450);
    expect(db.calls.some((c) => /INSERT INTO redemptions/.test(c.sql))).toBe(false);
    expect(db.calls.some((c) => /INSERT INTO credit_ledger/.test(c.sql))).toBe(false);
    expect(db.calls.some((c) => /UPDATE site_viewers/.test(c.sql))).toBe(false);
    expect(db.calls.some((c) => /UPDATE shop_items/.test(c.sql))).toBe(false);
  });
});

// --- Cancel restores both balance and inventory ------------------------------

describe("handleCreditsUpdateRedemption inventory restore", () => {
  it("cancelling returns the unit to inventory and credits the viewer", async () => {
    db.oneResponses.push(
      { id: "red-1", site_viewer_id: "sv-1", shop_item_id: "item-1", cost: 50 }
    );
    db.unsafeResponses.push([], [], []); // balance refund, stock restore, ledger
    const res = await handleCreditsUpdateRedemption(
      req("https://test.com/api/credits/redemptions/red-1", "POST", { status: "cancelled" }),
      makeEnv(),
      { slug: "red-1" }
    );
    expect(res.status).toBe(200);
    const stockRestore = db.calls.find((c) => c.method === "unsafe" && /UPDATE shop_items[\s\S]*stock = stock \+ 1/s.test(c.sql));
    expect(stockRestore).toBeDefined();
    expect(stockRestore.sql).toMatch(/stock IS NOT NULL/); // unlimited items are skipped
    const balanceRefund = db.calls.find((c) => c.method === "unsafe" && /UPDATE site_viewers[\s\S]*balance = balance \+ \$1/s.test(c.sql));
    expect(balanceRefund.params).toEqual([50, "sv-1"]);
  });

  it("fulfilling does not touch balance or stock", async () => {
    db.oneResponses.push(
      { id: "red-1", site_viewer_id: "sv-1", shop_item_id: "item-1", cost: 50 }
    );
    const res = await handleCreditsUpdateRedemption(
      req("https://test.com/api/credits/redemptions/red-1", "POST", { status: "fulfilled" }),
      makeEnv(),
      { slug: "red-1" }
    );
    expect(res.status).toBe(200);
    expect(db.calls.some((c) => /UPDATE shop_items/.test(c.sql))).toBe(false);
    expect(db.calls.some((c) => /UPDATE site_viewers/.test(c.sql))).toBe(false);
    expect(db.calls.some((c) => /INSERT INTO credit_ledger/.test(c.sql))).toBe(false);
  });

  it("rejects an invalid status transition", async () => {
    const res = await handleCreditsUpdateRedemption(
      req("https://test.com/api/credits/redemptions/red-1", "POST", { status: "pending" }),
      makeEnv(),
      { slug: "red-1" }
    );
    expect(res.status).toBe(400);
  });
});
