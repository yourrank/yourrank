import { describe, expect, it } from "bun:test";
import {
  handleCreatorClaimDetail,
  handleCreatorClaims,
  handleCreatorClaimTransition,
  handleViewerClaimDetail,
  handleViewerClaims,
} from "../handlers/claims.js";
import { transitionRedemptionClaimStatus } from "../handlers/credits.js";

const USER = { id: "creator-1" };
const VIEWER = { id: "viewer-1" };
const SITE = { id: "site-1", user_id: USER.id, name: "Site One", slug: "one" };
const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const CLAIM_ID = `redemption:${SOURCE_ID}`;

const request = (path, init) => new Request(`https://yourrank.site${path}`, init);

function claimRow(overrides = {}) {
  return {
    source_id: SOURCE_ID,
    source_status: "pending",
    cost: 250,
    created_at: "2026-08-29T10:00:00.000Z",
    updated_at: "2026-08-29T10:00:00.000Z",
    site_viewer_id: "membership-1",
    display_name: "Alice",
    shop_item_id: "item-1",
    item_name: "VIP role",
    site_id: SITE.id,
    site_slug: SITE.slug,
    site_name: SITE.name,
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  const calls = { query: [], one: [], capability: [], transitions: [] };
  const deps = {
    requireUser: async () => ({ user: USER, res: null }),
    requireViewer: async () => ({ viewer: VIEWER, res: null }),
    getByUser: async () => SITE,
    getBoardById: async (_env, userId, siteId) => userId === USER.id && siteId === SITE.id ? SITE : null,
    requireSiteCapability: async (user, site, capability) => {
      calls.capability.push({ user, site, capability });
      return { role: "owner", res: null };
    },
    rateLimit: async () => ({ ok: true }),
    query: async (sql, params) => {
      calls.query.push({ sql: String(sql), params });
      return [claimRow()];
    },
    one: async (sql, params) => {
      calls.one.push({ sql: String(sql), params });
      if (String(sql).includes("FILTER")) return { action_required: 1, completed: 0, cancelled: 0 };
      return claimRow();
    },
    withTransaction: async (callback) => callback({}),
    transitionRedemptionClaimStatus: async (_tx, input) => {
      calls.transitions.push(input);
      return { id: input.sourceId, status: input.nextStatus, replayed: false };
    },
    ...overrides,
  };
  return { calls, deps };
}

describe("canonical Claims adapter", () => {
  it("lists site-scoped reward claims with canonical statuses and no private fields", async () => {
    const { calls, deps } = dependencies();
    const response = await handleCreatorClaims(request("/api/claims?siteId=site-1"), {}, deps);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.filter).toBe("action_required");
    expect(body.counts).toEqual({ actionRequired: 1, submitted: 1, completed: 0, cancelled: 0 });
    expect(body.claims).toEqual([expect.objectContaining({
      id: CLAIM_ID,
      type: "reward_redemption",
      status: "submitted",
      actionRequired: true,
      allowedActions: ["complete", "cancel"],
      subject: { membershipId: "membership-1", displayName: "Alice" },
      source: expect.objectContaining({ kind: "redemption", workflow: "Rewards redemption" }),
    })]);
    expect(body.claims[0]).not.toHaveProperty("fulfillmentDetails");
    expect(JSON.stringify(body)).not.toMatch(/address|phone|email|shipping|kick_user_id|discord_user_id/i);
    expect(calls.capability[0].capability).toBe("canRoleManageCredits");
    expect(calls.query[0].params).toEqual([SITE.id, "action_required", 100]);
    expect(calls.query[0].sql).toContain("WHERE sv.site_id=$1");
    expect(calls.query[0].sql).toContain("r.created_at END ASC");
  });

  it("loads a site-bound detail with a redacted fulfillment model and audited history", async () => {
    const { calls, deps } = dependencies({
      query: async (sql, params) => {
        calls.query.push({ sql: String(sql), params });
        return [{
          action: "claim_completed",
          created_at: "2026-08-29T11:00:00.000Z",
          actor_id: USER.id,
          actor_name: "Creator",
        }];
      },
    });
    const response = await handleCreatorClaimDetail(
      request(`/api/claims/${encodeURIComponent(CLAIM_ID)}?siteId=site-1`),
      {},
      deps,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(calls.one[0].params).toEqual([SITE.id, SOURCE_ID]);
    expect(calls.one[0].sql).toContain("sv.site_id=$1 AND r.id=$2");
    expect(body.claim.fulfillmentDetails).toEqual(expect.objectContaining({
      privateDataStored: false,
      fields: [],
    }));
    expect(body.claim.history).toEqual([
      expect.objectContaining({ action: "claim_submitted" }),
      expect.objectContaining({ action: "claim_completed", actor: expect.objectContaining({ id: USER.id }) }),
    ]);
  });

  it("keeps creator authorization failures private and query-free", async () => {
    const unauthorized = dependencies({
      requireUser: async () => ({ user: null, res: new Response("unauthorized", { status: 401 }) }),
    });
    const response = await handleCreatorClaims(request("/api/claims?siteId=site-1"), {}, unauthorized.deps);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(unauthorized.calls.query).toHaveLength(0);

    const wrongSite = dependencies({ getBoardById: async () => null });
    const missing = await handleCreatorClaims(request("/api/claims?siteId=site-2"), {}, wrongSite.deps);
    expect(missing.status).toBe(404);
    expect(wrongSite.calls.query).toHaveLength(0);

    const forbidden = dependencies({
      requireSiteCapability: async () => ({ role: null, res: new Response("forbidden", { status: 403 }) }),
    });
    const blocked = await handleCreatorClaims(request("/api/claims?siteId=site-1"), {}, forbidden.deps);
    expect(blocked.status).toBe(403);
    expect(blocked.headers.get("cache-control")).toContain("no-store");
    expect(forbidden.calls.query).toHaveLength(0);
  });

  it("preserves the existing moderator Rewards capability without adding a Claim role", async () => {
    const { calls, deps } = dependencies({
      requireSiteCapability: async (user, site, capability) => {
        calls.capability.push({ user, site, capability });
        return { role: "moderator", res: null };
      },
    });
    const response = await handleCreatorClaims(request("/api/claims?siteId=site-1"), {}, deps);
    expect(response.status).toBe(200);
    expect(calls.capability[0].capability).toBe("canRoleManageCredits");
  });

  it("maps every supported source state without inventing approved, review, or expired states", async () => {
    const { deps } = dependencies({
      query: async () => [
        claimRow({ source_status: "pending" }),
        claimRow({ source_id: "22222222-2222-4222-8222-222222222222", source_status: "fulfilled" }),
        claimRow({ source_id: "33333333-3333-4333-8333-333333333333", source_status: "cancelled" }),
      ],
      one: async () => ({ action_required: 1, completed: 1, cancelled: 1 }),
    });
    const response = await handleCreatorClaims(request("/api/claims?siteId=site-1&status=all"), {}, deps);
    const body = await response.json();
    expect(body.claims.map((claim) => claim.status)).toEqual(["submitted", "completed", "cancelled"]);
    expect(JSON.stringify(body.claims)).not.toMatch(/approved|needs_review|expired|waiting_for_viewer/i);
  });

  it("lists only the authenticated viewer's claims on eligible sites", async () => {
    const { calls, deps } = dependencies();
    const response = await handleViewerClaims(request("/api/viewer/claims?slug=one"), {}, deps);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.viewer).toEqual({ id: VIEWER.id });
    expect(body.claims[0].id).toBe(CLAIM_ID);
    expect(calls.query[0].params).toEqual([VIEWER.id, "one", "all", 100]);
    expect(calls.query[0].sql).toContain("WHERE sv.viewer_id=$1");
    expect(calls.query[0].sql).toContain("s.published = true");
    expect(calls.query[0].sql).toContain("u.email_verified = true");
  });

  it("denies anonymous viewer access before any Claim lookup", async () => {
    const anonymous = dependencies({
      requireViewer: async () => ({ viewer: null, res: new Response("unauthorized", { status: 401 }) }),
    });
    const response = await handleViewerClaims(request("/api/viewer/claims"), {}, anonymous.deps);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(anonymous.calls.query).toHaveLength(0);
    expect(anonymous.calls.one).toHaveLength(0);
  });

  it("never lets one viewer load another viewer's claim detail", async () => {
    const { calls, deps } = dependencies({ one: async (sql, params) => {
      calls.one.push({ sql: String(sql), params });
      return null;
    } });
    const response = await handleViewerClaimDetail(
      request(`/api/viewer/claims/${encodeURIComponent(CLAIM_ID)}`),
      {},
      deps,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(calls.one[0].params).toEqual([VIEWER.id, SOURCE_ID]);
    expect(calls.one[0].sql).toContain("WHERE sv.viewer_id=$1");
  });

  it("maps a strict complete action to the existing fulfilled state", async () => {
    const { calls, deps } = dependencies({
      one: async (sql, params) => {
        calls.one.push({ sql: String(sql), params });
        return claimRow({ source_status: "fulfilled", updated_at: "2026-08-29T11:00:00.000Z" });
      },
    });
    const response = await handleCreatorClaimTransition(
      request(`/api/claims/${encodeURIComponent(CLAIM_ID)}/transition?siteId=site-1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "complete", expectedStatus: "submitted" }),
      }),
      {},
      deps,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(calls.transitions).toEqual([{
      siteId: SITE.id,
      userId: USER.id,
      sourceId: SOURCE_ID,
      nextStatus: "fulfilled",
    }]);
    expect(body.claim).toEqual(expect.objectContaining({ status: "completed", actionRequired: false }));
  });

  it("rejects invented fulfillment fields before any transition", async () => {
    const { calls, deps } = dependencies();
    const response = await handleCreatorClaimTransition(
      request(`/api/claims/${encodeURIComponent(CLAIM_ID)}/transition?siteId=site-1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "complete", privateNote: "call this number" }),
      }),
      {},
      deps,
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(calls.transitions).toHaveLength(0);
  });
});

describe("redemption-backed Claim transitions", () => {
  it("completes once and writes a redacted Claim audit event", async () => {
    const unsafeCalls = [];
    const tx = {
      one: async () => ({ id: SOURCE_ID, site_viewer_id: "membership-1", shop_item_id: "item-1", cost: 250 }),
      unsafe: async (sql, params) => {
        unsafeCalls.push({ sql: String(sql), params });
        return [];
      },
    };
    const result = await transitionRedemptionClaimStatus(tx, {
      siteId: SITE.id,
      userId: USER.id,
      sourceId: SOURCE_ID,
      nextStatus: "fulfilled",
    });

    expect(result).toEqual({ id: SOURCE_ID, status: "fulfilled", replayed: false });
    expect(unsafeCalls).toHaveLength(1);
    expect(unsafeCalls[0].sql).toContain("INSERT INTO audit_log");
    expect(unsafeCalls[0].params[1]).toBe("claim_completed");
    expect(unsafeCalls[0].params[2]).toBe(CLAIM_ID);
    expect(JSON.stringify(unsafeCalls[0].params[3])).not.toMatch(/address|phone|email|shipping|note/i);
  });

  it("treats an exact terminal retry as replay without repeating side effects", async () => {
    let reads = 0;
    const unsafeCalls = [];
    const tx = {
      one: async () => ++reads === 1 ? null : { id: SOURCE_ID, status: "cancelled" },
      unsafe: async (sql, params) => unsafeCalls.push({ sql, params }),
    };
    const result = await transitionRedemptionClaimStatus(tx, {
      siteId: SITE.id,
      userId: USER.id,
      sourceId: SOURCE_ID,
      nextStatus: "cancelled",
    });

    expect(result).toEqual({ id: SOURCE_ID, status: "cancelled", replayed: true });
    expect(unsafeCalls).toHaveLength(0);
  });

  it("cancels once with one refund, stock restore, ledger entry, and redacted actor audit", async () => {
    const unsafeCalls = [];
    const tx = {
      one: async () => ({ id: SOURCE_ID, site_viewer_id: "membership-1", shop_item_id: "item-1", cost: 250 }),
      unsafe: async (sql, params) => {
        unsafeCalls.push({ sql: String(sql), params });
        return [];
      },
    };
    const result = await transitionRedemptionClaimStatus(tx, {
      siteId: SITE.id,
      userId: USER.id,
      sourceId: SOURCE_ID,
      nextStatus: "cancelled",
    });

    expect(result).toEqual({ id: SOURCE_ID, status: "cancelled", replayed: false });
    expect(unsafeCalls).toHaveLength(4);
    expect(unsafeCalls[0]).toEqual(expect.objectContaining({ params: [250, "membership-1"] }));
    expect(unsafeCalls[0].sql).toContain("UPDATE site_viewers");
    expect(unsafeCalls[1].sql).toContain("UPDATE shop_items");
    expect(unsafeCalls[2].sql).toContain("INSERT INTO credit_ledger");
    expect(unsafeCalls[3].sql).toContain("INSERT INTO audit_log");
    expect(unsafeCalls[3].params[0]).toBe(USER.id);
    expect(unsafeCalls[3].params[1]).toBe("claim_cancelled");
    expect(unsafeCalls[3].params[2]).toBe(CLAIM_ID);
    expect(JSON.stringify(unsafeCalls[3].params[3])).not.toMatch(/address|phone|email|shipping|note/i);
  });

  it("rejects a competing terminal transition without changing balances or audit", async () => {
    let reads = 0;
    const unsafeCalls = [];
    const tx = {
      one: async () => ++reads === 1 ? null : { id: SOURCE_ID, status: "fulfilled" },
      unsafe: async (sql, params) => unsafeCalls.push({ sql, params }),
    };
    const result = await transitionRedemptionClaimStatus(tx, {
      siteId: SITE.id,
      userId: USER.id,
      sourceId: SOURCE_ID,
      nextStatus: "cancelled",
    });

    expect(result).toEqual(expect.objectContaining({ status: 409, currentStatus: "fulfilled" }));
    expect(unsafeCalls).toHaveLength(0);
  });
});
