import { describe, expect, it } from "bun:test";
import { getViewerSiteData, getLoyaltyBoard, LOYALTY_BOARD_LIMIT } from "../site-data.js";

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

describe("getLoyaltyBoard", () => {
  const loyaltyRow = (overrides = {}) => ({
    viewer_id: "viewer-a",
    total_earned: 500,
    rank: 1,
    avatar_url: null,
    identities: [{ provider: "kick", externalUserId: "1", username: "viewer_a", avatarUrl: "https://cdn.example/a.png", linkedAt: null }],
    ...overrides,
  });

  it("ranks this site's memberships by lifetime credits earned, never by spendable balance", async () => {
    const calls = [];
    const rows = await getLoyaltyBoard("site-1", {}, {
      queryImpl: async (sql, params) => {
        calls.push({ sql, params });
        return [
          loyaltyRow(),
          loyaltyRow({ viewer_id: "viewer-b", total_earned: 300, rank: 2, identities: [{ provider: "discord", externalUserId: "2", username: "viewer_b", avatarUrl: null, linkedAt: null }] }),
        ];
      },
    });

    expect(calls).toHaveLength(1);
    const { sql, params } = calls[0];
    expect(params[0]).toBe("site-1");
    expect(sql).toContain("sv.site_id=$1");
    expect(sql).toContain("sv.total_earned DESC");
    expect(sql).toContain("sv.blocked=false");
    expect(sql).toContain("v.is_system=false");
    expect(sql).not.toMatch(/\bbalance\b/);
    expect(sql).not.toMatch(/\bplayers\b/);
    expect(sql).not.toMatch(/\btotal_spent\b/);

    expect(rows).toEqual([
      { viewerId: "viewer-a", name: "viewer_a", avatarUrl: "https://cdn.example/a.png", earned: 500, rank: 1 },
      { viewerId: "viewer-b", name: "viewer_b", avatarUrl: null, earned: 300, rank: 2 },
    ]);
  });

  it("clamps the limit and returns an empty board when nobody has earned credits", async () => {
    let seen;
    const rows = await getLoyaltyBoard("site-2", { limit: 100000 }, { queryImpl: async (_sql, params) => { seen = params; return []; } });
    expect(seen).toEqual(["site-2", LOYALTY_BOARD_LIMIT]);
    expect(rows).toEqual([]);
  });

  it("falls back to a generic display name and the viewer avatar when no identity is linked", async () => {
    const rows = await getLoyaltyBoard("site-1", {}, {
      queryImpl: async () => [loyaltyRow({ identities: [], avatar_url: "https://cdn.example/v.png" })],
    });
    expect(rows[0].name).toBe("Viewer");
    expect(rows[0].avatarUrl).toBe("https://cdn.example/v.png");
  });
});
