import { describe, expect, it } from "bun:test";
import { getViewerSiteData } from "../site-data.js";

const membershipRow = (overrides = {}) => ({
  id: "sv-1",
  balance: 25,
  blocked: false,
  block_reason: null,
  total_earned: 100,
  total_spent: 75,
  last_seen_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  ...overrides,
});

function deps({ rows = [], oneError = null } = {}) {
  const calls = { one: [], query: [], exec: [], claims: [], participation: [] };
  let index = 0;
  return {
    calls,
    oneImpl: async (sql, params) => {
      calls.one.push({ sql, params });
      if (oneError) throw oneError;
      return rows[index++] || null;
    },
    queryImpl: async (sql, params) => {
      calls.query.push({ sql, params });
      return [];
    },
    execImpl: async (sql, params) => {
      calls.exec.push({ sql, params });
    },
    markActiveImpl: async () => null,
    getViewerClaimsImpl: async (...args) => {
      calls.claims.push(args);
      return { claims: [{ id: "redemption:claim-1" }], limit: 50, truncated: false };
    },
    getViewerParticipationImpl: async (...args) => {
      calls.participation.push(args);
      return { participation: [{ type: "code_drop_claim" }], limit: 25, truncated: false };
    },
  };
}

describe("viewer board membership tracking", () => {
  it("keeps a signed-in passive visit membership-free", async () => {
    const injected = deps({ rows: [null] });
    const result = await getViewerSiteData("site-1", "viewer-1", {}, injected);

    expect(injected.calls.exec).toHaveLength(0);
    expect(injected.calls.one).toHaveLength(1);
    expect(result.viewerOnSite).toBeNull();
    expect(result.membershipStatus).toBe("absent");
  });

  it("does not create a membership for an anonymous visitor", async () => {
    const injected = deps();
    const result = await getViewerSiteData("site-1", null, {}, injected);

    expect(result.viewerOnSite).toBeNull();
    expect(result.membershipStatus).toBe("absent");
    expect(injected.calls.one).toHaveLength(0);
    expect(injected.calls.exec).toHaveLength(0);
  });

  it("touches last-seen for an existing member without changing billable activity, balances, or blocked state", async () => {
    const row = membershipRow({ blocked: true, block_reason: "fraud", balance: 0, total_earned: 0, total_spent: 0 });
    const injected = deps({ rows: [row] });
    const result = await getViewerSiteData("site-1", "viewer-1", {}, injected);

    expect(injected.calls.exec).toHaveLength(1);
    expect(injected.calls.exec[0].sql).toContain("SET last_seen_at = now()");
    expect(injected.calls.exec[0].sql).toContain("last_seen_at < now() - interval '5 minutes'");
    expect(injected.calls.exec[0].sql).not.toContain("last_active_at");
    expect(result.viewerOnSite).toMatchObject({
      balance: 0,
      total_earned: 0,
      total_spent: 0,
      blocked: true,
    });
    expect(result.membershipStatus).toBe("member");
    expect(result.viewerOnSite).not.toHaveProperty("block_reason");
  });

  it("keeps an authenticated passive Rewards view non-billable", async () => {
    const injected = deps({ rows: [membershipRow()] });
    await getViewerSiteData("site-1", "viewer-1", { shop: true }, injected);

    expect(injected.calls.query).toHaveLength(1);
    expect(injected.calls.exec.every(({ sql }) => !sql.includes("last_active_at"))).toBe(true);
  });

  it("does not touch an existing member inside the five-minute window", async () => {
    const injected = deps({ rows: [membershipRow({ last_seen_at: new Date().toISOString() })] });
    await getViewerSiteData("site-1", "viewer-1", {}, injected);

    expect(injected.calls.exec).toHaveLength(0);
  });

  it("distinguishes a membership lookup failure from an absent membership", async () => {
    const injected = deps({ oneError: new Error("database unavailable") });
    const originalError = console.error;
    console.error = () => {};
    try {
      const result = await getViewerSiteData("site-1", "viewer-1", {}, injected);
      expect(result.viewerOnSite).toBeNull();
      expect(result.membershipStatus).toBe("unavailable");
      expect(injected.calls.exec).toHaveLength(0);
    } finally {
      console.error = originalError;
    }
  });

  it("does not load private membership history for a non-member", async () => {
    const injected = deps({ rows: [null] });
    const result = await getViewerSiteData("site-1", "viewer-1", { shop: true, claims: true, ledger: true, participation: true }, injected);

    expect(result.membershipStatus).toBe("absent");
    expect(result.claims).toEqual([]);
    expect(result.participation).toEqual([]);
    expect(result.ledger).toEqual([]);
    expect(injected.calls.query).toHaveLength(1);
    expect(injected.calls.claims).toHaveLength(0);
    expect(injected.calls.participation).toHaveLength(0);
  });

  it("loads bounded Claims and participation only after exact membership resolution", async () => {
    const injected = deps({ rows: [membershipRow()] });
    const result = await getViewerSiteData("site-1", "viewer-1", { claims: true, participation: true }, injected);

    expect(injected.calls.claims[0].slice(0, 3)).toEqual(["site-1", "viewer-1", "sv-1"]);
    expect(injected.calls.participation[0].slice(0, 3)).toEqual(["site-1", "viewer-1", "sv-1"]);
    expect(result.claims).toEqual([{ id: "redemption:claim-1" }]);
    expect(result.claimsLimit).toBe(50);
    expect(result.claimsTruncated).toBe(false);
    expect(result.participation).toEqual([{ type: "code_drop_claim" }]);
    expect(result.participationLimit).toBe(25);
    expect(result.participationTruncated).toBe(false);
  });
});
