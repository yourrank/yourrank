// Audit follow-up validation tests:
//  - POST /api/billing/checkout stays explicitly unavailable until a verified provider exists
//  - saveSite() rejects a non-http(s) referral/CTA URL server-side (audit §9 "Improve")
// Uses bun:test with mocked DB and session store (same scaffold as sites-handlers).

import { describe, it, expect, mock, beforeEach } from "bun:test";

const dbUrl     = import.meta.resolve("@yourrank/shared/db");
const dbUrlTs   = import.meta.resolve("@yourrank/shared/db");
const sessUrl   = import.meta.resolve("@yourrank/shared/session");
const sessUrlTs = import.meta.resolve("@yourrank/shared/session");
const realDb = await import(dbUrl);
const realSession = await import(sessUrl);

const mockExec  = mock(() => Promise.resolve());
const mockOne   = mock(() => Promise.resolve(null));
const mockQuery = mock(() => Promise.resolve([]));

const dbMock = () => ({
  ...realDb,
  one: (...a) => mockOne(...a),
  exec: (...a) => mockExec(...a),
  query: (...a) => mockQuery(...a),
  getSql: () => null,
  withTransaction: async (fn) => fn({ unsafe: (...a) => mockQuery(...a), one: (...a) => mockOne(...a), exec: (...a) => mockExec(...a), query: (...a) => mockQuery(...a) }),
});

const USER_ROW = {
  id: "user-1", email: "test@test.com", plan: "free",
  plan_expires_at: null, status: "active", is_admin: false, created_at: Date.now(),
};

const sessMock = () => ({
  ...realSession,
  createSession: () => Promise.resolve("tok"),
  destroySession: () => Promise.resolve(),
  destroyAllUserSessions: () => Promise.resolve(),
  cookieSet: (t) => `yr_session=${t}`,
  cookieClear: () => "yr_session=",
  readToken: (req) => {
    const m = (req?.headers?.get?.("cookie") || "").match(/yr_session=([^;]+)/);
    return m ? m[1] : null;
  },
  resolveSession: (req) => {
    const m = (req?.headers?.get?.("cookie") || "").match(/yr_session=([^;]+)/);
    return Promise.resolve({ userId: m ? "user-1" : null, cookie: null });
  },
  loadUser: () => Promise.resolve(USER_ROW),
  hasLegacyCookie: () => false,
  cookieClearLegacy: () => "sess=",
  cookieClearLegacy2: () => "gm_session=",
  SESSION_ROTATE_AFTER_S: 86400,
  SESSION_TTL_S: 2592000,
});

mock.module(dbUrl, () => ({ ...realDb, ...dbMock() }));
mock.module(dbUrlTs, () => ({ ...realDb, ...dbMock() }));
mock.module(sessUrl, sessMock);
mock.module(sessUrlTs, sessMock);

const { handleBillingUnavailable } = await import("../billing.js");
// NOTE: this file relies on mock isolation — it must be run in its own
// process (scripts/test.mjs runs each leaderboard test file individually for
// exactly this reason). Running `bun test` over the whole directory lets
// other files' site.js/db mocks win and these tests fail spuriously.
const { saveSite, updateSiteTheme } = await import("../site.js");

const SESSION_VALUE = JSON.stringify({ u: "user-1", c: Date.now() });
function mockEnv(extra = {}) {
  const store = new Map([["sess:tok", SESSION_VALUE]]);
  return {
    SESSIONS: {
      get: (k) => Promise.resolve(store.get(k) ?? null),
      put: (k, v) => { store.set(k, v); return Promise.resolve(); },
    },
    HYPERDRIVE: { connectionString: "postgresql://mock" },
    ...extra,
  };
}
function checkoutReq(plan) {
  return new Request("https://test.com/api/billing/checkout", {
    method: "POST",
    headers: { cookie: "yr_session=tok", "content-type": "application/json" },
    body: JSON.stringify({ plan }),
  });
}

describe("retired checkout endpoint", () => {
  beforeEach(() => { mockOne.mockReset(); mockQuery.mockReset(); mockExec.mockReset(); });

  it("does not process a browser-selected plan while the provider is unavailable", async () => {
    mockOne.mockResolvedValue(USER_ROW); // currentUser → loadUser
    const res = await handleBillingUnavailable(checkoutReq("team"), mockEnv());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/not available yet/i);
    expect(mockExec.mock.calls.some(([sql]) => String(sql).includes("UPDATE users") || String(sql).includes("INSERT INTO payments"))).toBe(false);
  });

  it("does not grant a removed or unknown tier", async () => {
    mockOne.mockResolvedValue(USER_ROW);
    const res = await handleBillingUnavailable(checkoutReq("lifetime"), mockEnv());
    expect(res.status).toBe(503);
    expect(mockExec.mock.calls.some(([sql]) => String(sql).includes("UPDATE users") || String(sql).includes("INSERT INTO payments"))).toBe(false);
  });
});

describe("saveSite referral/CTA URL validation", () => {
  const SITE = { id: "site-1", slug: "x", user_id: "user-1", cta_url: "", published: true, updated_at: null };
  beforeEach(() => { mockOne.mockReset(); mockQuery.mockReset(); mockExec.mockReset(); });

  it("rejects a non-URL ctaUrl", async () => {
    mockOne.mockResolvedValue(SITE);
    const r = await saveSite(mockEnv(), USER_ROW, { brand: { ctaUrl: "not a url" } }, "site-1");
    expect(r.code).toBe("invalid_cta");
  });

  it("rejects a javascript: ctaUrl", async () => {
    mockOne.mockResolvedValue(SITE);
    const r = await saveSite(mockEnv(), USER_ROW, { brand: { ctaUrl: "javascript:alert(1)" } }, "site-1");
    expect(r.code).toBe("invalid_cta");
  });

  it("allows an empty ctaUrl (clearing the field)", async () => {
    mockOne.mockResolvedValue(SITE);
    const r = await saveSite(mockEnv(), USER_ROW, { brand: { ctaUrl: "" } }, "site-1");
    expect(r.code).not.toBe("invalid_cta");
  });
});

describe("updateSiteTheme validation and plan behavior", () => {
  const SITE = {
    id: "site-1",
    slug: "actual-board",
    user_id: "user-1",
    theme_json: { template: "classic", accentA: "#111111", accentB: "#222222" },
  };

  beforeEach(() => { mockOne.mockReset(); mockQuery.mockReset(); mockExec.mockReset(); });

  it("ignores accent overrides on free plans", async () => {
    mockOne.mockResolvedValueOnce(SITE);
    const r = await updateSiteTheme(mockEnv(), USER_ROW, {
      siteId: "site-1",
      template: "cyber_arcade",
      accentA: "#00ffd1",
      accentB: "#ff2cd0",
    });
    expect(r.ok).toBe(true);
    const savedTheme = mockExec.mock.calls[0][1][0];
    expect(savedTheme).toEqual({
      template: "cyber_arcade",
      accentA: "#111111",
      accentB: "#222222",
    });
  });

  it("validates and saves accent and template overrides on paid plans", async () => {
    mockOne.mockResolvedValueOnce(SITE);
    const paidUser = { ...USER_ROW, plan: "pro", plan_expires_at: Date.now() + 86_400_000 };
    const invalid = await updateSiteTheme(mockEnv(), paidUser, {
      siteId: "site-1",
      template: "esports_pro",
      accentA: "red",
      accentB: "#ff2cd0",
    });
    expect(invalid.code).toBe("invalid_colors");
    expect(mockExec).not.toHaveBeenCalled();

    mockOne.mockResolvedValueOnce(SITE);
    const valid = await updateSiteTheme(mockEnv(), paidUser, {
      siteId: "site-1",
      template: "esports_pro",
      accentA: "#00ffd1",
      accentB: "#ff2cd0",
    });
    expect(valid.ok).toBe(true);
    const savedTheme = mockExec.mock.calls[0][1][0];
    expect(savedTheme).toEqual({
      template: "esports_pro",
      accentA: "#00ffd1",
      accentB: "#ff2cd0",
    });
  });
});

describe("saveSite customDomain / slug handling", () => {
  const SITE = { id: "site-1", slug: "x", user_id: "user-1", cta_url: "", published: true, updated_at: null };
  beforeEach(() => { mockOne.mockReset(); mockQuery.mockReset(); mockExec.mockReset(); });

  it("does NOT reject a round-tripped customDomain field", async () => {
    mockOne.mockResolvedValue(SITE);
    const r = await saveSite(mockEnv(), USER_ROW, { customDomain: "foo.example.com" }, "site-1");
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  it("rejects renaming the slug to a reserved word", async () => {
    mockOne.mockResolvedValueOnce(SITE); // getBoardById
    const r = await saveSite(mockEnv(), USER_ROW, { slug: "dashboard" }, "site-1");
    expect(r.code).toBe("slug_reserved");
  });

  it("rejects renaming the slug to one already taken", async () => {
    mockOne
      .mockResolvedValueOnce(SITE)                 // getBoardById
      .mockResolvedValueOnce({ id: "other-site" }); // slug uniqueness check
    const r = await saveSite(mockEnv(), USER_ROW, { slug: "taken" }, "site-1");
    expect(r.code).toBe("slug_taken");
  });

  it("applies a valid slug rename and returns the new slug", async () => {
    mockOne
      .mockResolvedValueOnce(SITE)                       // getBoardById
      .mockResolvedValueOnce(null)                       // slug uniqueness check → free
      .mockResolvedValue({ ...SITE, slug: "newhandle" }); // updatedSite reads
    const r = await saveSite(mockEnv(), USER_ROW, { slug: "NewHandle" }, "site-1");
    expect(r.error).toBeUndefined();
    expect(r.slug).toBe("newhandle");
  });
});

describe("saveSite Free player limit", () => {
  const SITE = { id: "site-1", slug: "x", user_id: "user-1", cta_url: "", published: true, updated_at: null };
  const players = (count) => Array.from({ length: count }, (_, index) => ({
    name: `Player ${index + 1}`,
    wagered: count - index,
    prize: 0,
  }));

  beforeEach(() => { mockOne.mockReset(); mockQuery.mockReset(); mockExec.mockReset(); });

  it("allows exactly 50 players on Free", async () => {
    mockOne.mockResolvedValue(SITE);
    const result = await saveSite(mockEnv(), USER_ROW, { players: players(50) }, "site-1");
    expect(result.code).not.toBe("player_limit");
    expect(result.ok).toBe(true);
  });

  it("rejects the 51st player on Free", async () => {
    mockOne.mockResolvedValue(SITE);
    const result = await saveSite(mockEnv(), USER_ROW, { players: players(51) }, "site-1");
    expect(result).toEqual({
      error: "Your plan allows up to 50 players. Upgrade for more.",
      code: "player_limit",
    });
  });
});
