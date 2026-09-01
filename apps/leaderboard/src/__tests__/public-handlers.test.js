// Tests for public API handlers: /api/public/:slug/*
// Tests response shapes, error paths, and input validation.
// Uses bun:test with mocked DB and auth deps.
//
// Run: bun test src/__tests__/public-handlers.test.js
//   or: bun test   (from apps/leaderboard/)

import { describe, it, expect, mock } from "bun:test";

const dbOne = mock(() => Promise.resolve(null));

const mockSiteData = {
  rankBy: "wagered",
  brand: { name: "Test Casino", casino: "Stake", period: "Monthly", prizePool: "$10,000" },
  playerCount: 3,
  players: [
    { name: "Alice", wagered: 50000, prize: "$5,000", rank: 1 },
    { name: "Bob", wagered: 30000, prize: "$3,000", rank: 2 },
    { name: "Charlie", wagered: 10000, prize: "$1,000", rank: 3 },
  ],
  endsAt: new Date(Date.now() + 86400000).toISOString(),
};

import {
  handlePublicStandings as handlePublicStandingsImpl,
  handlePublicPlayers as handlePublicPlayersImpl,
  handlePublicRank as handlePublicRankImpl,
  handlePublicData as handlePublicDataImpl,
  handlePublicStream as handlePublicStreamImpl,
} from "../handlers/public.js";
import { attachRouteContext } from "../middleware/handler.js";

// Helper: build a minimal Request
function req(url, method = "GET") {
  return new Request(url, { method });
}

// Mock env with KV for rate limiting
function mockEnv(siteData = mockSiteData) {
  const store = new Map();
  return {
    SESSIONS: {
      get: (key) => Promise.resolve(store.get(key) ?? null),
      put: (key, value) => { store.set(key, value); return Promise.resolve(); },
    },
    HYPERDRIVE: { connectionString: "postgresql://mock" },
    __siteData: siteData,
  };
}

const clearVersionCache = mock(() => {});
const streamVersion = mock(() => Promise.resolve("2026-01-01T00:00:00.000Z"));

const siteDeps = {
  getPublicSite: (_env, slug, _request, options) => {
    if (slug === "nonexistent") return null;
    if (slug === "suspended") return { suspended: true, data: {} };
    if (slug === "protected") return { requiresPassword: true, id: "site-1", slug: "protected" };
    const source = _env.__siteData || mockSiteData;
    const data = options
      ? { ...source, players: source.players.slice(Number(options.offset) || 0, (Number(options.offset) || 0) + (Number(options.limit) || 100)) }
      : source;
    return { id: "site-1", data, plan: "pro", suspended: false };
  },
  getPublicStreamVersion: streamVersion,
  clearPublicStreamVersionCache: clearVersionCache,
  rateLimit: async (_env, key) => {
    const count = Number(String(key).includes("search") ? (siteDeps.searchCount = (siteDeps.searchCount || 0) + 1) : 0);
    return { ok: count < 61, limit: 60, remaining: Math.max(0, 60 - count), retryAfter: 1 };
  },
  clientIp: () => "test-ip",
  one: dbOne,
};
const handlePublicStandings = (request, env, ctx) => handlePublicStandingsImpl(attachRouteContext(request, ctx), env, siteDeps);
const handlePublicPlayers = (request, env, ctx) => handlePublicPlayersImpl(attachRouteContext(request, ctx), env, siteDeps);
const handlePublicRank = (request, env, ctx) => handlePublicRankImpl(attachRouteContext(request, ctx), env, siteDeps);
const handlePublicData = (request, env, ctx) => handlePublicDataImpl(attachRouteContext(request, ctx), env, siteDeps);
const handlePublicStream = (request, env, ctx) => handlePublicStreamImpl(attachRouteContext(request, ctx), env, siteDeps);

// ── handlePublicStandings ──────────────────────────────────────────────
describe("handlePublicStandings", () => {
  it("returns JSON with correct shape", async () => {
    const env = mockEnv();
    const res = await handlePublicStandings(req("https://test.com/api/public/testboard/standings"), env, { slug: "testboard" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("slug", "testboard");
    expect(body).toHaveProperty("name", "Test Casino");
    expect(body).toHaveProperty("casino", "Stake");
    expect(body).toHaveProperty("period", "Monthly");
    expect(body).toHaveProperty("prizePool", "$10,000");
    expect(body).toHaveProperty("players");
    expect(Array.isArray(body.players)).toBe(true);
    expect(body.players).toHaveLength(3);
    // Players should be sorted by wagered descending
    expect(body.players[0].wagered).toBeGreaterThanOrEqual(body.players[1].wagered);
    // Each player should have name, wagered, prize, position
    expect(body.players[0]).toHaveProperty("name");
    expect(body.players[0]).toHaveProperty("wagered");
    expect(body.players[0]).toHaveProperty("prize");
    expect(body.players[0]).toHaveProperty("position");
    // Countdown should exist when endsAt is set
    expect(body).toHaveProperty("countdown");
    expect(body.countdown).toHaveProperty("endsAt");
    expect(body.countdown).toHaveProperty("remaining");
  });

  it("returns 404 for nonexistent slug", async () => {
    const env = mockEnv();
    const res = await handlePublicStandings(req("https://test.com/api/public/nonexistent/standings"), env, { slug: "nonexistent" });
    expect(res.status).toBe(404);
  });

  it("returns 404 for suspended site", async () => {
    const env = mockEnv();
    const res = await handlePublicStandings(req("https://test.com/api/public/suspended/standings"), env, { slug: "suspended" });
    expect(res.status).toBe(404);
  });
});

// ── handlePublicPlayers ────────────────────────────────────────────────
describe("handlePublicPlayers", () => {
  it("returns players array with correct shape", async () => {
    const env = mockEnv();
    const res = await handlePublicPlayers(req("https://test.com/api/public/testboard/players"), env, { slug: "testboard" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("players");
    expect(Array.isArray(body.players)).toBe(true);
    expect(body.players).toHaveLength(3);
    // Sorted by wagered descending
    expect(body.players[0].wagered).toBeGreaterThanOrEqual(body.players[1].wagered);
  });

  it("returns truthful pagination metadata and global ranks", async () => {
    const env = mockEnv();
    const res = await handlePublicPlayers(
      req("https://test.com/api/public/testboard/players?limit=2&offset=1"),
      env,
      { slug: "testboard" }
    );
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.offset).toBe(1);
    expect(body.limit).toBe(2);
    expect(body.hasMore).toBe(false);
    expect(body.players.map((p) => p.rank)).toEqual([2, 3]);
  });

  it("keeps search requests on a separate generous limit", async () => {
    const env = mockEnv();
    for (let i = 0; i < 60; i++) {
      const res = await handlePublicPlayers(
        req("https://test.com/api/public/testboard/players?search=alice"),
        env,
        { slug: "testboard" }
      );
      expect(res.status).toBe(200);
    }
    const limited = await handlePublicPlayers(
      req("https://test.com/api/public/testboard/players?search=alice"),
      env,
      { slug: "testboard" }
    );
    expect(limited.status).toBe(429);
  });
  it("returns 404 for nonexistent slug", async () => {
    const env = mockEnv();
    const res = await handlePublicPlayers(req("https://test.com/api/public/nonexistent/players"), env, { slug: "nonexistent" });
    expect(res.status).toBe(404);
  });
});

// ── handlePublicRank ───────────────────────────────────────────────────
describe("handlePublicRank", () => {
  it("uses score for a normal board without ranking configuration", async () => {
    const env = mockEnv({
      brand: { name: "Community Board", period: "Monthly", prizePool: "" },
      players: [
        { name: "Score Leader", score: 80, wagered: 1, prize: 0, rank: 1 },
        { name: "Amount Leader", score: 20, wagered: 999, prize: 0, rank: 2 },
      ],
    });
    const response = await handlePublicRank(
      req("https://test.com/api/public/testboard/rank?user=Score%20Leader"),
      env,
      { slug: "testboard" },
    );
    const text = await response.text();
    expect(text).toContain("#1 of 2");
    expect(text).toContain("80 points");
    expect(text.toLowerCase()).not.toContain("wager");
  });

  it("returns plain-text rank for matching user", async () => {
    const env = mockEnv();
    const res = await handlePublicRank(req("https://test.com/api/public/testboard/rank?user=Alice"), env, { slug: "testboard" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Alice");
    expect(text).toContain("#1");
    expect(text).toContain("Test Casino");
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("returns 400 when user param missing", async () => {
    const env = mockEnv();
    const res = await handlePublicRank(req("https://test.com/api/public/testboard/rank"), env, { slug: "testboard" });
    expect(res.status).toBe(400);
  });

  it("returns not-found message for unknown user", async () => {
    const env = mockEnv();
    const res = await handlePublicRank(req("https://test.com/api/public/testboard/rank?user=Unknown"), env, { slug: "testboard" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("not on");
  });
});

// ── handlePublicStream ─────────────────────────────────────────────────
describe("handlePublicStream", () => {
  it("returns 401 for a password-protected board", async () => {
    const env = mockEnv();
    const res = await handlePublicStream(req("https://test.com/api/public/protected/stream"), env, { slug: "protected" });
    expect(res.status).toBe(401);
  });

  it("returns 404 for a nonexistent slug", async () => {
    const env = mockEnv();
    const res = await handlePublicStream(req("https://test.com/api/public/nonexistent/stream"), env, { slug: "nonexistent" });
    expect(res.status).toBe(404);
  });

  it("sheds streams with the kill switch and tells clients to back off", async () => {
    const env = { ...mockEnv(), LIVE_BOARD_STREAM_KILL_SWITCH: "true" };
    const res = await handlePublicStream(req("https://test.com/api/public/testboard/stream"), env, { slug: "testboard" });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("pushes the full payload when the player timestamp changes", async () => {
    streamVersion.mockResolvedValueOnce("2026-01-01T00:00:00.000Z");
    const env = mockEnv();
    const res = await handlePublicStream(req("https://test.com/api/public/testboard/stream"), env, { slug: "testboard" });
    const reader = res.body.getReader();
    const first = await reader.read();
    await reader.cancel();
    const payload = JSON.parse(new TextDecoder().decode(first.value).replace(/^data: |\n\n$/g, ""));
    expect(payload.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.players).toEqual(mockSiteData.players);
  });
});

// ── handlePublicData ───────────────────────────────────────────────────
describe("handlePublicData", () => {
  it("returns full data object", async () => {
    const env = mockEnv();
    const res = await handlePublicData(req("https://test.com/api/public/testboard"), env, { slug: "testboard" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("brand");
    expect(body).toHaveProperty("players");
  });

  it("returns 404 for nonexistent slug", async () => {
    const env = mockEnv();
    const res = await handlePublicData(req("https://test.com/api/public/nonexistent"), env, { slug: "nonexistent" });
    expect(res.status).toBe(404);
  });
});
