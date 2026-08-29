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

function deps({ rows = [], execError = null } = {}) {
  const calls = { one: [], query: [], exec: [] };
  let index = 0;
  return {
    calls,
    oneImpl: async (sql, params) => {
      calls.one.push({ sql, params });
      return rows[index++] || null;
    },
    queryImpl: async (sql, params) => {
      calls.query.push({ sql, params });
      return [];
    },
    execImpl: async (sql, params) => {
      calls.exec.push({ sql, params });
      if (execError) throw execError;
    },
    markActiveImpl: async () => null,
  };
}

describe("viewer board membership tracking", () => {
  it("creates a membership on the first signed-in board view and uses the fresh row", async () => {
    const injected = deps({ rows: [null, membershipRow({ balance: 0, total_earned: 0, total_spent: 0 })] });
    const result = await getViewerSiteData("site-1", "viewer-1", {}, injected);

    expect(injected.calls.exec).toHaveLength(1);
    expect(injected.calls.exec[0].sql).toContain(
      "INSERT INTO site_viewers (site_id, viewer_id, balance, total_earned, last_seen_at, last_active_at)",
    );
    expect(injected.calls.exec[0].sql).toContain("ON CONFLICT (site_id, viewer_id) DO NOTHING");
    expect(injected.calls.exec[0].params).toEqual(["site-1", "viewer-1"]);
    expect(injected.calls.one).toHaveLength(2);
    expect(result.viewerOnSite.balance).toBe(0);
  });

  it("does not create a membership for an anonymous visitor", async () => {
    const injected = deps();
    const result = await getViewerSiteData("site-1", null, {}, injected);

    expect(result.viewerOnSite).toBeNull();
    expect(injected.calls.one).toHaveLength(0);
    expect(injected.calls.exec).toHaveLength(0);
  });

  it("touches an existing member without changing balances or blocked state", async () => {
    const row = membershipRow({ blocked: true, block_reason: "fraud", balance: 0, total_earned: 0, total_spent: 0 });
    const injected = deps({ rows: [row] });
    const result = await getViewerSiteData("site-1", "viewer-1", {}, injected);

    expect(injected.calls.exec).toHaveLength(1);
    expect(injected.calls.exec[0].sql).toContain("SET last_seen_at = now()");
    expect(injected.calls.exec[0].sql).toContain("last_seen_at < now() - interval '5 minutes'");
    expect(result.viewerOnSite).toMatchObject({
      balance: 0,
      total_earned: 0,
      total_spent: 0,
      blocked: true,
      block_reason: "fraud",
    });
  });

  it("does not touch an existing member inside the five-minute window", async () => {
    const injected = deps({ rows: [membershipRow({ last_seen_at: new Date().toISOString() })] });
    await getViewerSiteData("site-1", "viewer-1", {}, injected);

    expect(injected.calls.exec).toHaveLength(0);
  });

  it("keeps board rendering alive when membership creation fails", async () => {
    const injected = deps({ rows: [null], execError: new Error("database unavailable") });
    const originalError = console.error;
    console.error = () => {};
    try {
      const result = await getViewerSiteData("site-1", "viewer-1", {}, injected);
      expect(result.viewerOnSite).toBeNull();
      expect(injected.calls.exec).toHaveLength(1);
    } finally {
      console.error = originalError;
    }
  });

  it("falls back when membership creation succeeds but the re-read is still empty", async () => {
    const injected = deps({ rows: [null, null] });
    const originalError = console.error;
    console.error = () => {};
    try {
      const result = await getViewerSiteData("site-1", "viewer-1", {}, injected);
      expect(result).toEqual({
        viewerOnSite: null,
        shopItems: [],
        redemptions: [],
        ledger: [],
      });
      expect(injected.calls.exec).toHaveLength(1);
      expect(injected.calls.query).toHaveLength(0);
    } finally {
      console.error = originalError;
    }
  });
});
