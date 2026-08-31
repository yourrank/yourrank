import { describe, it, expect, mock, beforeEach } from "bun:test";
import { attachRouteContext } from "../middleware/handler.js";

// Credits lifecycle coverage, complementing credits-loop.test.js and
// shop-redeem-edge-cases.test.js:
//   earn -> balance -> spend -> history
//   invariant: previous balance + earned - spent === current balance
//   negative values / duplication / replay / history / manual adjustment / undo
//
// Mock pattern mirrors credits-loop.test.js.

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

import { handleCreditsAdjustBalance, handleCreditsReconcile } from "../handlers/credits.js";
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

function earnEvent(overrides = {}) {
  return {
    messageId: "msg-1",
    eventType: "channel.reward.redemption.updated",
    payload: {
      id: "kick-red-1",
      broadcaster: { user_id: "chan-1" },
      redeemer: { user_id: "kick-1", username: "alice" },
      reward: { id: "reward-1", title: "Hydrate", cost: 10 },
      status: "fulfilled",
      ...overrides,
    },
  };
}

// Queue up the shared prefix of the creditable/reversible paths:
// event insert, site lookup, site lock, owner lookup, viewer lookup,
// viewer rename update, username history, site_viewer existence check.
function mockCommonPrefix({ existingSiteViewer = { id: "sv-1" } } = {}) {
  db.unsafeResponses.push([{ event_id: "msg-1" }]); // kick_reward_events insert
  db.oneResponses.push({ id: "site-1", user_id: "user-1" }); // site
  db.unsafeResponses.push([]); // site FOR UPDATE
  db.oneResponses.push({ plan: "pro", plan_expires_at: null, status: "active", email_verified: true }); // owner
  db.oneResponses.push({ id: "viewer-1", kick_username: "alice" }); // existing viewer
  db.unsafeResponses.push([]); // UPDATE viewers
  db.unsafeResponses.push([]); // INSERT viewer_username_history (current name)
  db.oneResponses.push(existingSiteViewer); // existing site_viewer
}

beforeEach(() => resetDb());

// --- Earn -------------------------------------------------------------------

describe("processKickRewardRedemption earn path", () => {
  it("grants exactly the mapped credits to balance AND total_earned, with a matching ledger row", async () => {
    mockCommonPrefix();
    db.oneResponses.push({ id: "map-1", credits: 25, kick_reward_cost: 10 }); // reward mapping
    db.unsafeResponses.push([{ id: "sv-1", balance: 100, blocked: false, fraud_score: 0 }]); // site_viewer upsert
    db.queryResponses.push([], []); // alt-username history, peer usernames
    db.unsafeResponses.push([]); // kick_reward_events site update
    db.unsafeResponses.push([{ id: "sv-1", balance: 125 }]); // credit grant
    db.unsafeResponses.push([]); // ledger earn insert

    const result = await processKickRewardRedemption(earnEvent());
    expect(result).toEqual({ credited: 25, balance: 125, newViewer: false });

    // Invariant: the same amount hits balance and total_earned in one statement...
    const grant = db.calls.find((c) => /UPDATE site_viewers/.test(c.sql) && /balance = balance \+ \$1/.test(c.sql));
    expect(grant).toBeDefined();
    expect(grant.sql).toMatch(/total_earned = total_earned \+ \$1/);
    expect(grant.sql).toMatch(/last_active_at = now\(\)/);
    expect(grant.params).toEqual([25, "sv-1"]);

    // Membership resolution itself is non-billable; activity is recorded only
    // by the committed credit grant above.
    const membership = db.calls.find((c) => /INSERT INTO site_viewers/.test(c.sql));
    expect(membership).toBeDefined();
    expect(membership.sql).not.toContain("last_active_at");

    // ...and the ledger row records the identical amount.
    const ledger = db.calls.find((c) => /INSERT INTO credit_ledger/.test(c.sql) && c.sql.includes("'earn'"));
    expect(ledger).toBeDefined();
    expect(ledger.params[1]).toBe(25);
    expect(ledger.params[4]).toBe("msg-1"); // kick_event_id links ledger to the event
  });

  it("ignores a replayed webhook without touching the balance (refresh/replay safe)", async () => {
    db.unsafeResponses.push([]); // ON CONFLICT DO NOTHING -> already processed
    const result = await processKickRewardRedemption(earnEvent());
    expect(result).toEqual({ duplicate: true });
    expect(db.calls.some((c) => /UPDATE site_viewers/.test(c.sql))).toBe(false);
    expect(db.calls.some((c) => /INSERT INTO credit_ledger/.test(c.sql))).toBe(false);
  });

  it("skips a reward whose cost was tampered with after mapping", async () => {
    mockCommonPrefix();
    db.oneResponses.push({ id: "map-1", credits: 25, kick_reward_cost: 10 }); // mapped at cost 10
    const result = await processKickRewardRedemption(earnEvent({ reward: { id: "reward-1", title: "Hydrate", cost: 1 } }));
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/cost mismatch/i);
    expect(db.calls.some((c) => /INSERT INTO site_viewers/.test(c.sql))).toBe(false);
    expect(db.calls.some((c) => /UPDATE site_viewers/.test(c.sql) && /balance = balance \+/.test(c.sql))).toBe(false);
    expect(db.calls.some((c) => /last_active_at\s*=\s*now\(\)/.test(c.sql))).toBe(false);
  });

  it("does not create Membership or activity for a rejected blocked provider action", async () => {
    mockCommonPrefix({ existingSiteViewer: { id: "sv-1", blocked: true, fraud_score: 100 } });
    db.oneResponses.push({ id: "map-1", credits: 25, kick_reward_cost: 10 });
    db.queryResponses.push([], []);
    db.unsafeResponses.push([]); // kick_reward_events site update

    const result = await processKickRewardRedemption(earnEvent());

    expect(result).toEqual({ blocked: true });
    expect(db.calls.some((c) => /INSERT INTO site_viewers/.test(c.sql))).toBe(false);
    expect(db.calls.some((c) => /last_active_at\s*=\s*now\(\)/.test(c.sql))).toBe(false);
  });
});

// --- Undo (Kick reversal) -----------------------------------------------------

describe("processKickRewardRedemption reversal path (undo)", () => {
  function mockReversalPrefix() {
    mockCommonPrefix();
    db.oneResponses.push({ id: "sv-1", balance: 100 }); // site_viewer FOR UPDATE
    db.oneResponses.push({ id: "led-1", amount: 25 }); // original earn row
  }

  it("reverses an earn exactly once with a guarded debit and a refund ledger row", async () => {
    mockReversalPrefix();
    db.oneResponses.push(null); // no existing refund
    db.unsafeResponses.push([{ id: "sv-1", balance: 75 }]); // debit succeeds
    db.unsafeResponses.push([]); // refund ledger insert

    const result = await processKickRewardRedemption(earnEvent({ status: "canceled" }));
    expect(result).toEqual({ refunded: 25, balance: 75 });

    const debit = db.calls.find((c) => /UPDATE site_viewers/.test(c.sql) && /balance = balance - \$1/.test(c.sql));
    expect(debit.sql).toMatch(/AND balance >= \$1/); // can never go negative
    expect(debit.sql).toMatch(/GREATEST\(total_earned - \$1, 0\)/); // earned can never go negative
    const ledger = db.calls.find((c) => /INSERT INTO credit_ledger/.test(c.sql) && c.sql.includes("'refund'"));
    expect(ledger).toBeDefined();
    expect(ledger.params[1]).toBe(25);
  });

  it("refuses to undo the same earn twice", async () => {
    mockReversalPrefix();
    db.oneResponses.push({ id: "led-2" }); // refund already exists
    const result = await processKickRewardRedemption(earnEvent({ status: "canceled" }));
    expect(result).toEqual({ duplicate: true });
    expect(db.calls.some((c) => /UPDATE site_viewers/.test(c.sql) && /balance = balance -/.test(c.sql))).toBe(false);
  });

  it("skips the undo when the viewer already spent the credits", async () => {
    mockReversalPrefix();
    db.oneResponses.push(null); // no existing refund
    db.unsafeResponses.push([]); // guarded debit finds no row: balance < 25
    const result = await processKickRewardRedemption(earnEvent({ status: "canceled" }));
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/too low to reverse/);
    // No refund ledger row: balance and history stay consistent.
    expect(db.calls.some((c) => /INSERT INTO credit_ledger/.test(c.sql))).toBe(false);
  });
});

// --- Manual adjustment --------------------------------------------------------

describe("handleCreditsAdjustBalance validation", () => {
  it("rejects a delta of 0", async () => {
    const res = await handleCreditsAdjustBalance(
      attachRouteContext(req("https://test.com/api/credits/viewers/sv-1/balance", "POST", { delta: 0, reason: "oops" }), { slug: "sv-1" }),
      makeEnv()
    );
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric delta", async () => {
    const res = await handleCreditsAdjustBalance(
      attachRouteContext(req("https://test.com/api/credits/viewers/sv-1/balance", "POST", { delta: "lots", reason: "oops" }), { slug: "sv-1" }),
      makeEnv()
    );
    expect(res.status).toBe(400);
  });

  it("requires a reason so history stays auditable", async () => {
    const res = await handleCreditsAdjustBalance(
      attachRouteContext(req("https://test.com/api/credits/viewers/sv-1/balance", "POST", { delta: 10 }), { slug: "sv-1" }),
      makeEnv()
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/reason/);
  });

  it("allows debiting exactly the full balance down to zero", async () => {
    db.oneResponses.push(
      { id: "sv-1", balance: 100, total_earned: 100 }, // FOR UPDATE
      { id: "sv-1", balance: 0 } // guarded debit succeeds
    );
    db.unsafeResponses.push([]); // ledger
    const res = await handleCreditsAdjustBalance(
      attachRouteContext(req("https://test.com/api/credits/viewers/sv-1/balance", "POST", { delta: -100, reason: "correction" }), { slug: "sv-1" }),
      makeEnv()
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe(0);
    const debit = db.calls.find((c) => /UPDATE site_viewers/.test(c.sql) && /balance = balance - \$1/.test(c.sql));
    expect(debit.sql).toMatch(/AND balance >= \$1/);
    expect(debit.sql).toMatch(/GREATEST\(total_earned - \$1, 0\)/);
  });

  it("writes a ledger row for every manual adjustment so history matches the balance", async () => {
    db.oneResponses.push(
      { id: "sv-1", balance: 100, total_earned: 100 },
      { id: "sv-1", balance: 150 } // +50 credit
    );
    db.unsafeResponses.push([]);
    const res = await handleCreditsAdjustBalance(
      attachRouteContext(req("https://test.com/api/credits/viewers/sv-1/balance", "POST", { delta: 50, reason: "giveaway" }), { slug: "sv-1" }),
      makeEnv()
    );
    expect(res.status).toBe(200);
    const ledger = db.calls.find((c) => /INSERT INTO credit_ledger/.test(c.sql));
    expect(ledger).toBeDefined();
    expect(ledger.params[1]).toBe(50); // same amount as the balance change
    expect(ledger.params[2]).toMatch(/giveaway/); // reason preserved in history
  });

  it("lets the compatibility tip route select only an existing authenticated membership", async () => {
    db.oneResponses.push(
      { id: "sv-1", balance: 100, total_earned: 100 }, // exact existing membership
      { id: "sv-1", balance: 150 } // +50 credit
    );
    db.unsafeResponses.push([]);
    const res = await handleCreditsAdjustBalance(
      req("https://test.com/api/credits/tip", "POST", { siteId: "site-1", username: "@alice", delta: 50, reason: "release gate funding" }),
      makeEnv()
    );

    expect(res.status).toBe(200);
    const lookup = db.calls.find((c) => /JOIN viewers v/.test(c.sql));
    expect(lookup.params).toEqual(["site-1", "alice"]);
    expect(lookup.sql).toContain("v.kick_linked_at IS NOT NULL");
    expect(lookup.sql).toContain("sv.site_id = $1");
    expect(db.calls.some((c) => /INSERT INTO (viewers|site_viewers)/.test(c.sql))).toBe(false);
  });
});

// --- The invariant ------------------------------------------------------------

describe("handleCreditsReconcile", () => {
  it("confirms previous + earned - spent === current for a consistent viewer", async () => {
    db.queryResponses.push([
      { id: "sv-1", balance: 75, total_earned: 100, total_spent: 25, ledger_earned: 100, ledger_spent: 25 },
    ]);
    const res = await handleCreditsReconcile(req("https://test.com/api/credits/reconcile"), makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mismatches).toEqual([]);
  });

  it("flags any drift between ledger-derived and stored totals", async () => {
    db.queryResponses.push([
      { id: "sv-1", balance: 80, total_earned: 100, total_spent: 25, ledger_earned: 100, ledger_spent: 25 },
    ]);
    const res = await handleCreditsReconcile(req("https://test.com/api/credits/reconcile"), makeEnv());
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.mismatches).toHaveLength(1);
    expect(body.mismatches[0].expectedBalance).toBe(75);
  });
});
