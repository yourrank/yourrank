// Unit tests for the score postback handler.
// Uses injected collaborators to isolate from DB / KV.
//
// Run: bun test src/__tests__/scores.test.js

import { test, expect, describe, beforeEach, beforeAll, afterAll, jest } from "bun:test";

// ── shared state that individual tests can override ────────────────────────
let _rateLimitCount = 0;
let _siteRow = null;
let _ownerRow = null;
let _existingSiteRow = null;
let _saveSiteResult = {};
let _savedPayload = null;
let _saveOptions = null;
let _hashInput = null;
let _keySiteId = null;
let _rlBucket = null;
let _idem = null;

const dbDeps = ({
  one: (sql, _params) => {
    if (sql.includes("FROM sites") && sql.includes("s.user_id")) return Promise.resolve(_siteRow);
    if (sql.includes("plan_expires_at"))    return Promise.resolve(_ownerRow);
    if (sql.includes("SELECT id, slug, name")) return Promise.resolve(_existingSiteRow);
    return Promise.resolve(null);
  },
  exec:  () => Promise.resolve(),
  query: () => Promise.resolve([]),
  getSql: () => { throw new Error("getSql should not be called in scores unit tests"); },
  withTransaction: async (fn) => fn({ one: () => Promise.resolve(null), exec: () => Promise.resolve(), query: () => Promise.resolve([]) }),
});

const sessionDeps = ({
    createSession:          () => Promise.resolve("mock-token"),
    destroySession:         () => Promise.resolve(),
    destroyAllUserSessions: () => Promise.resolve(),
    cookieSet:  (t) => `yr_session=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    cookieClear: ()  => "yr_session=; Path=/; Max-Age=0",
    readToken:  () => null,
    resolveSession:       () => Promise.resolve({ userId: null, cookie: null }),
    loadUser:             () => Promise.resolve(null),
    hasLegacyCookie:  () => false,
    cookieClearLegacy: () => "sess=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    SESSION_ROTATE_AFTER_S: 86400,
    SESSION_TTL_S: 2592000, // 30 days
    });

  // Mock crypto.js so HMAC verification always passes in tests
  // Include the full crypto API so later tests in the same process don't see
  // a partial crypto module cannot leak into other tests.
const cryptoDeps = ({
  decryptToken: (enc) => enc,
  encryptToken: (s) => s,
  reencryptToken: (s) => s,
  encrypt: (s) => s,
  decrypt: (s) => s,
  verifyHmacSha256Hex: async () => true,
  safeEqual: (a, b) => a === b,
  isCurrentVersion: () => true,
  newClickRef: () => "ref",
  newLinkSlug: () => "slug",
  newPostbackKey: () => "pbkey",
  newWebhookSecret: () => "secret",
  hashToken: async (s) => "hash:" + s,
  hashIp: async (ip) => ip,
});

// Include the full postback API so later tests in the same process (e.g. the
// coverage run that loads every file together) don't see a partial module —
// Keep the full postback collaborator surface local to this test.
const postbackDeps = ({
  POSTBACK_SUNSET: "2026-10-01",
  unsignedPostbacksEnabled: (value) => value !== "false" && value !== "0",
  findPostbackOwner: async () => _siteRow ? { id: "key-id", userId: _siteRow.user_id, siteId: _keySiteId } : null,
  logPostbackIntake: () => {},
  getActivePostbackKey: async () => null,
  createPostbackKey: async () => "pbkey",
  revokePostbackKeys: async () => 0,
  computeReplayHash: async (input) => { _hashInput = input; return "replay-hash"; },
  recordReplayHash: async () => { throw new Error("Replay admission must be inside the save transaction"); },
});

const { handleScores, handleScoresUpsert } = await import("../handlers/scores.js");
const idemDeps = () => ({
  computeIdempotencyRequestHash: async (input) => { _idem.hashInput = input; return "req-hash"; },
  reserveIdempotencyKey: async (args) => { _idem.reserveArgs = args; return _idem.reserve; },
  completeIdempotencyKey: async (args) => { _idem.completed.push(args); return true; },
  releaseIdempotencyKey: async (args) => { _idem.released.push(args); return true; },
});
const invokeScores = (request, env) =>
  handleScores(request, env, {
    ...dbDeps,
    ...sessionDeps,
    ...cryptoDeps,
    ...postbackDeps,
    ...( _idem ? idemDeps() : {}),
    rateLimit: _rlSpy || undefined,
    saveSiteImpl: async (_env, _user, payload, _siteId, _request, options) => {
      _savedPayload = payload;
      _saveOptions = options;
      return _saveSiteResult;
    },
  });
const invokeUpsert = (request, env) =>
  handleScoresUpsert(request, env, {
    ...dbDeps,
    ...sessionDeps,
    ...cryptoDeps,
    ...postbackDeps,
    ...( _idem ? idemDeps() : {}),
    rateLimit: _rlSpy || undefined,
    saveSiteImpl: async (_env, _user, payload, _siteId, _request, options) => {
      _savedPayload = payload;
      _saveOptions = options;
      return _saveSiteResult;
    },
  });
let _rlSpy = null;

// QA-006: Freeze the clock so Date.now()-based tests are deterministic
const FROZEN_TIME = new Date("2025-06-15T12:00:00Z").getTime();
beforeAll(() => { jest.setSystemTime(FROZEN_TIME); });
afterAll(() => { jest.useRealTimers(); });

// ── helpers ───────────────────────────────────────────────────────────────

function makeRequest(opts = {}) {
  const headers = new Headers(opts.headers || {});
  // Include HMAC signature by default when x-postback-key is present
  if (headers.has("x-postback-key") && !headers.has("x-postback-signature")) {
    headers.set("x-postback-signature", "test-hmac-signature");
  }
  return new Request("https://yourrank.site/api/scores", {
    method: "POST",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

const proOwner    = () => ({ plan: "pro", plan_expires_at: Date.now() + 86_400_000 * 30, status: "active" });
const agencyOwner = () => ({ plan: "agency", plan_expires_at: Date.now() + 86_400_000 * 30, status: "active" });
const site        = () => ({ id: "site-1", user_id: "user-1" });
const existingSite = () => ({
  id: "site-1", slug: "testslug", name: "Test", tagline: "", casino: "Stake",
  code: "CODE", cta_url: "", prize_pool: "", period: "Monthly", ends_at: null,
  reset_note: null, blurb: "", extra_json: null, published: true, theme_json: null,
  updated_at: new Date().toISOString(),
});

// Environment with a controllable SESSIONS KV so the real rate limiter can fail closed.
function makeEnv() {
  return {
    SESSIONS: {
      get: () => Promise.resolve(String(_rateLimitCount)),
      put: () => Promise.resolve(),
    },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────

describe("handleScores — auth", () => {
  beforeEach(() => {
    _siteRow = site();
    _ownerRow = proOwner();
    _existingSiteRow = existingSite();
    _saveSiteResult = {};
    _savedPayload = null;
    _rateLimitCount = 0;
  });

  test("missing X-Postback-Key returns 401", async () => {
    const req = makeRequest({ body: { slug: "test", players: [] } });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("X-Postback-Key");
  });

  test("rate limit exceeded returns 429", async () => {
    _rateLimitCount = 10;
    const req = makeRequest({ headers: { "x-postback-key": "valid-key" }, body: { slug: "test", players: [] } });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(429);
    _rateLimitCount = 0;
  });

  test("unknown postback key returns 401", async () => {
    _siteRow = null;
    const req = makeRequest({ headers: { "x-postback-key": "unknown-key" }, body: { slug: "test", players: [] } });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(401);
  });

  test("missing board slug or siteId returns 400", async () => {
    const req = makeRequest({ headers: { "x-postback-key": "key" }, body: { players: [] } });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("slug");
  });

  test("non-matching board slug returns 401", async () => {
    _siteRow = null;
    const req = makeRequest({ headers: { "x-postback-key": "key" }, body: { slug: "wrong-slug", players: [] } });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(401);
  });
});

describe("handleScores — plan gate", () => {
  test("free-plan owner gets 403 with Pro hint", async () => {
    _siteRow = site();
    _ownerRow = { plan: "free", plan_expires_at: null, status: "active" };
    const req = makeRequest({ headers: { "x-postback-key": "key" }, body: { slug: "test", players: [] } });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Pro");
  });

  test("starter-plan owner gets 403", async () => {
    _siteRow = site();
    _ownerRow = { plan: "starter", plan_expires_at: Date.now() + 86_400_000, status: "active" };
    const req = makeRequest({ headers: { "x-postback-key": "key" }, body: { slug: "test", players: [] } });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(403);
  });

  test("suspended owner gets 403", async () => {
    _siteRow = site();
    _ownerRow = { plan: "pro", plan_expires_at: Date.now() + 86_400_000, status: "suspended" };
    const req = makeRequest({ headers: { "x-postback-key": "key" }, body: { slug: "test", players: [] } });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(403);
  });

  test("expired pro plan gets 403", async () => {
    _siteRow = site();
    _ownerRow = { plan: "pro", plan_expires_at: Date.now() - 1000, status: "active" };
    const req = makeRequest({ headers: { "x-postback-key": "key" }, body: { slug: "test", players: [] } });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(403);
  });
});

describe("handleScores — payload validation", () => {
  beforeEach(() => {
    _siteRow = site();
    _ownerRow = proOwner();
    _existingSiteRow = existingSite();
    _saveSiteResult = {};
    _savedPayload = null;
  });

  test("missing JSON body returns 400", async () => {
    const req = new Request("https://yourrank.site/api/scores", {
      method: "POST",
      headers: { "x-postback-key": "key", "x-postback-signature": "test-sig", "content-type": "text/plain" },
      body: "not json",
    });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(400);
  });

  test("players not an array returns 400", async () => {
    const req = makeRequest({ headers: { "x-postback-key": "key" }, body: { slug: "test", players: "notanarray" } });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("array");
  });

  test("too many players for plan returns 400", async () => {
    _ownerRow = agencyOwner();
    const players = Array.from({ length: 10000 }, (_, i) => ({ name: `Player${i}`, wagered: 100 }));
    const req = makeRequest({ headers: { "x-postback-key": "key" }, body: { slug: "test", players } });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("players");
  });

  test("valid pro request returns 200 with player count", async () => {
    const players = [
      { name: "Alice", wagered: 5000, prize: 100 },
      { name: "Bob",   wagered: 3000, prize: 50  },
    ];
    const req = makeRequest({ headers: { "x-postback-key": "key" }, body: { slug: "test", players } });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.players).toBe(2);
  });

  test("valid team request returns 200 with player count", async () => {
    _ownerRow = { plan: "team", plan_expires_at: Date.now() + 86_400_000 * 30, status: "active" };
    const players = [{ name: "Alice", wagered: 5000, prize: 100 }];
    const req = makeRequest({ headers: { "x-postback-key": "key" }, body: { slug: "test", players } });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.players).toBe(1);
  });

  test("accepts name and score without requiring wagered", async () => {
    const req = makeRequest({
      headers: { "x-postback-key": "key" },
      body: { slug: "test", players: [{ name: "Score Player", score: 88 }] },
    });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(200);
    expect(_savedPayload.players[0]).toMatchObject({ name: "Score Player", score: 88, wagered: 0 });
  });

  test("players without a name are rejected", async () => {
    const players = [
      { name: "Alice", wagered: 1000 },
      { wagered: 500 },
    ];
    const req = makeRequest({ headers: { "x-postback-key": "key" }, body: { slug: "test", players } });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(400);
  });

  test("unknown request fields are rejected", async () => {
    const req = makeRequest({
      headers: { "x-postback-key": "key" },
      body: { slug: "test", players: [], ownerId: "unexpected" },
    });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(400);
  });

  test("unknown player fields are rejected", async () => {
    const req = makeRequest({
      headers: { "x-postback-key": "key" },
      body: { slug: "test", players: [{ name: "Player", wagered: 100, admin: true }] },
    });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(400);
  });

  test("duplicate normalized player names are rejected", async () => {
    const req = makeRequest({
      headers: { "x-postback-key": "key" },
      body: {
        slug: "test",
        players: [
          { name: "Player One", wagered: 100 },
          { name: " player   one ", wagered: 50 },
        ],
      },
    });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(400);
  });

  test("passes Site-scoped replay identity into the save transaction", async () => {
    const res = await invokeScores(makeRequest({
      headers: { "x-postback-key": "key", "x-postback-site": "test" },
      body: { players: [{ name: "Alice", score: 10 }] },
    }), makeEnv());
    expect(res.status).toBe(200);
    expect(_hashInput).toMatchObject({ kind: "scores", siteId: "site-1" });
    expect(_saveOptions).toEqual({ scoreReplay: { userId: "user-1", hash: "replay-hash" } });
  });

  test("preserves 409 on a committed score replay", async () => {
    _saveSiteResult = { error: "Duplicate postback.", code: "duplicate_postback" };
    const res = await invokeScores(makeRequest({ headers: { "x-postback-key": "key" }, body: { slug: "test", players: [] } }), makeEnv());
    expect(res.status).toBe(409);
  });

  test("saveSite error is surfaced as 400", async () => {
    _saveSiteResult = { error: "slug already taken" };
    const req = makeRequest({ headers: { "x-postback-key": "key" }, body: { slug: "test", players: [{ name: "Alice", wagered: 100 }] } });
    const res = await invokeScores(req, makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("slug already taken");
  });
});

// ── PATCH /api/scores, board-scoped keys, idempotency ───────────────────────

function makePatchRequest(opts = {}) {
  const headers = new Headers(opts.headers || {});
  if (!headers.has("x-postback-key")) headers.set("x-postback-key", "key");
  if (!headers.has("x-postback-signature")) headers.set("x-postback-signature", "test-hmac-signature");
  return new Request("https://yourrank.site/api/scores", {
    method: "PATCH",
    headers,
    body: JSON.stringify(opts.body ?? { slug: "test", players: [{ name: "Alice", score: 5 }] }),
  });
}

describe("score write pipeline — auth and buckets", () => {
  beforeEach(() => {
    _siteRow = site();
    _ownerRow = proOwner();
    _saveSiteResult = {};
    _savedPayload = null;
    _saveOptions = null;
    _keySiteId = null;
    _rlSpy = null;
    _rateLimitCount = 0;
    _idem = null;
    _hashInput = null;
  });

  test("PATCH requires the postback key and signature headers", async () => {
    const noKey = new Request("https://yourrank.site/api/scores", { method: "PATCH", body: "{}" });
    expect((await invokeUpsert(noKey, makeEnv())).status).toBe(401);
    const noSig = new Request("https://yourrank.site/api/scores", { method: "PATCH", headers: { "x-postback-key": "k" }, body: "{}" });
    expect((await invokeUpsert(noSig, makeEnv())).status).toBe(401);
  });

  test("rate-limit bucket uses the key hash, not the plaintext key", async () => {
    _rlSpy = async (env, bucket) => { _rlBucket = bucket; return { ok: true }; };
    const res = await invokeUpsert(makePatchRequest({ headers: { "x-postback-key": "secret-key-123" } }), makeEnv());
    expect(res.status).toBe(200);
    expect(_rlBucket).toBe("scores-upsert:hash:secret-key-123");
    expect(_rlBucket).not.toContain("secret-key-123:");
  });
});

describe("board-scoped API keys", () => {
  beforeEach(() => {
    _siteRow = site();
    _ownerRow = proOwner();
    _saveSiteResult = {};
    _keySiteId = null;
  });

  test("a scoped key updates its own board via slug", async () => {
    _keySiteId = "site-1";
    const res = await invokeScores(makeRequest({ headers: { "x-postback-key": "key" }, body: { slug: "test", players: [] } }), makeEnv());
    expect(res.status).toBe(200);
  });

  test("a scoped key is rejected for another board via slug", async () => {
    _keySiteId = "site-9";
    const res = await invokeScores(makeRequest({ headers: { "x-postback-key": "key" }, body: { slug: "test", players: [] } }), makeEnv());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("scoped to another board");
  });

  test("a scoped key is rejected for another board via siteId and via header", async () => {
    _keySiteId = "site-9";
    const byBody = await invokeScores(makeRequest({ headers: { "x-postback-key": "key" }, body: { siteId: "11111111-1111-4111-8111-111111111111", players: [] } }), makeEnv());
    expect(byBody.status).toBe(403);
    const byHeader = await invokeScores(makeRequest({ headers: { "x-postback-key": "key", "x-postback-site": "test" }, body: { players: [] } }), makeEnv());
    expect(byHeader.status).toBe(403);
  });

  test("an account-level key still works across boards", async () => {
    _keySiteId = null;
    _siteRow = { id: "site-2", user_id: "user-1" };
    const res = await invokeScores(makeRequest({ headers: { "x-postback-key": "key" }, body: { slug: "test", players: [] } }), makeEnv());
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/scores", () => {
  beforeEach(() => {
    _siteRow = site();
    _ownerRow = proOwner();
    _saveSiteResult = { ok: true, patch: { total: 4, updated: 1, created: 1 } };
    _savedPayload = null;
    _saveOptions = null;
    _keySiteId = null;
    _rateLimitCount = 0;
    _hashInput = null;
  });

  test("passes the submitted players to the server-side merge and returns counts", async () => {
    const res = await invokeUpsert(makePatchRequest({ body: { slug: "test", players: [{ name: "Alice", score: 50 }, { name: "New", wagered: 5 }] } }), makeEnv());
    expect(res.status).toBe(200);
    expect(_saveOptions.scorePatch).toEqual([{ name: "Alice", score: 50 }, { name: "New", wagered: 5 }]);
    expect(_savedPayload.players).toBeUndefined();
    const body = await res.json();
    expect(body).toEqual({ ok: true, players: 4, updated: 1, created: 1 });
  });

  test("rejects an empty players array", async () => {
    const res = await invokeUpsert(makePatchRequest({ body: { slug: "test", players: [] } }), makeEnv());
    expect(res.status).toBe(400);
  });

  test("rejects duplicate player names", async () => {
    const res = await invokeUpsert(makePatchRequest({ body: { slug: "test", players: [{ name: "A" }, { name: " a " }] } }), makeEnv());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Duplicate player name");
  });

  test("keeps the replay guard with a distinct kind when no Idempotency-Key is sent", async () => {
    const res = await invokeUpsert(makePatchRequest(), makeEnv());
    expect(res.status).toBe(200);
    expect(_hashInput.kind).toBe("scores-upsert");
    expect(_saveOptions.scoreReplay).toEqual({ userId: "user-1", hash: "replay-hash" });
  });

  test("free-plan owner gets 403 and a closed board gets 409", async () => {
    _ownerRow = { plan: "free", plan_expires_at: null, status: "active" };
    expect((await invokeUpsert(makePatchRequest(), makeEnv())).status).toBe(403);
    _ownerRow = proOwner();
    _siteRow = { ...site(), ends_at: new Date(Date.now() - 1000).toISOString() };
    expect((await invokeUpsert(makePatchRequest(), makeEnv())).status).toBe(409);
  });
});

describe("Idempotency-Key", () => {
  beforeEach(() => {
    _siteRow = site();
    _ownerRow = proOwner();
    _saveSiteResult = {};
    _savedPayload = null;
    _saveOptions = null;
    _keySiteId = null;
    _rateLimitCount = 0;
    _hashInput = null;
    _idem = { reserve: { state: "reserved" }, completed: [], released: [], hashInput: null, reserveArgs: null };
  });

  test("completes the reservation on a 2xx and skips the replay guard", async () => {
    const res = await invokeScores(makeRequest({ headers: { "x-postback-key": "key", "idempotency-key": "abc" }, body: { slug: "test", players: [] } }), makeEnv());
    expect(res.status).toBe(200);
    expect(_idem.completed).toHaveLength(1);
    expect(_idem.completed[0]).toMatchObject({ userId: "user-1", siteId: "site-1", endpoint: "POST /api/scores", key: "abc", status: 200 });
    expect(_idem.reserveArgs.requestHash).toBe("req-hash");
    expect(_hashInput).toBeNull();
    expect(_saveOptions.scoreReplay).toBeUndefined();
  });

  test("releases the reservation on a 4xx so the key can be retried", async () => {
    _saveSiteResult = { error: "slug already taken" };
    const res = await invokeScores(makeRequest({ headers: { "x-postback-key": "key", "idempotency-key": "abc" }, body: { slug: "test", players: [{ name: "A", wagered: 1 }] } }), makeEnv());
    expect(res.status).toBe(400);
    expect(_idem.released).toHaveLength(1);
    expect(_idem.completed).toHaveLength(0);
  });

  test("replays the stored response with Idempotency-Replayed", async () => {
    _idem.reserve = { state: "replay", status: 200, body: { ok: true, players: 3 } };
    const res = await invokeScores(makeRequest({ headers: { "x-postback-key": "key", "idempotency-key": "abc" }, body: { slug: "test", players: [] } }), makeEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("idempotency-replayed")).toBe("true");
    expect(await res.json()).toEqual({ ok: true, players: 3 });
    expect(_savedPayload).toBeNull();
  });

  test("rejects a key reused with a different payload and one still processing", async () => {
    _idem.reserve = { state: "mismatch" };
    const req = () => makeRequest({ headers: { "x-postback-key": "key", "idempotency-key": "abc" }, body: { slug: "test", players: [] } });
    expect((await invokeScores(req(), makeEnv())).status).toBe(422);
    _idem.reserve = { state: "in_progress" };
    expect((await invokeScores(req(), makeEnv())).status).toBe(409);
  });

  test("rejects an Idempotency-Key outside 1-200 characters", async () => {
    const longKey = "x".repeat(201);
    expect((await invokeScores(makeRequest({ headers: { "x-postback-key": "key", "idempotency-key": longKey }, body: { slug: "test", players: [] } }), makeEnv())).status).toBe(400);
    expect((await invokeScores(makeRequest({ headers: { "x-postback-key": "key", "idempotency-key": "   " }, body: { slug: "test", players: [] } }), makeEnv())).status).toBe(400);
  });

  test("a completed PATCH replays identically", async () => {
    _saveSiteResult = { ok: true, patch: { total: 2, updated: 1, created: 1 } };
    const req = () => makePatchRequest({ headers: { "idempotency-key": "p1" } });
    const res = await invokeUpsert(req(), makeEnv());
    expect(res.status).toBe(200);
    expect(_idem.completed[0].endpoint).toBe("PATCH /api/scores");
    expect(_idem.completed[0].body).toEqual({ ok: true, players: 2, updated: 1, created: 1 });
  });
});
