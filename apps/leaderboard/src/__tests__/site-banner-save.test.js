// saveSite() branding persistence for the community banner: upload, replace
// and remove ride the same site row and the same branding payload as the logo,
// invalid uploads are rejected before any write, and free plans cannot write
// branding at all. Uses bun:test with the mocked DB scaffold from
// audit-validation.test.js — run in its own process for mock isolation.
import { describe, it, expect, mock, beforeEach } from "bun:test";

const dbUrl = import.meta.resolve("@yourrank/shared/db");
const sessUrl = import.meta.resolve("@yourrank/shared/session");
const realDb = await import(dbUrl);
const realSession = await import(sessUrl);

const mockExec = mock(() => Promise.resolve());
const mockOne = mock(() => Promise.resolve(null));
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
const PAID_USER = { ...USER_ROW, plan: "pro", plan_expires_at: Date.now() + 86_400_000 };

const sessMock = () => ({
  ...realSession,
  createSession: () => Promise.resolve("tok"),
  destroySession: () => Promise.resolve(),
  destroyAllUserSessions: () => Promise.resolve(),
  cookieSet: (t) => `yr_session=${t}`,
  cookieClear: () => "yr_session=",
  readToken: () => null,
  resolveSession: () => Promise.resolve({ userId: null, cookie: null }),
  loadUser: () => Promise.resolve(USER_ROW),
  hasLegacyCookie: () => false,
  cookieClearLegacy: () => "sess=",
  cookieClearLegacy2: () => "gm_session=",
  SESSION_ROTATE_AFTER_S: 86400,
  SESSION_TTL_S: 2592000,
});

mock.module(dbUrl, () => ({ ...realDb, ...dbMock() }));
mock.module(sessUrl, sessMock);

const { saveSite } = await import("../site.js");

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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
const BANNER_URI = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
const OLD_BANNER_URI = `data:image/webp;base64,${Buffer.from(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])).toString("base64")}`;

const SITE = { id: "site-1", slug: "x", user_id: "user-1", cta_url: "", published: true, updated_at: null };

function savedBannerParam() {
  const call = mockQuery.mock.calls.find(([sql]) => String(sql).startsWith("UPDATE sites SET slug="));
  if (!call) return undefined;
  const params = call[1];
  // banner_data is bound second-to-last, ahead of the site id.
  return params[params.length - 2];
}

describe("saveSite banner persistence", () => {
  beforeEach(() => { mockOne.mockReset(); mockQuery.mockReset(); mockExec.mockReset(); });

  it("stores a valid uploaded banner on the site row", async () => {
    mockOne.mockResolvedValue(SITE);
    const r = await saveSite(mockEnv(), PAID_USER, { branding: { banner: BANNER_URI } }, "site-1");
    expect(r.ok).toBe(true);
    expect(savedBannerParam()).toBe(BANNER_URI);
  });

  it("replaces an existing banner with the new image", async () => {
    mockOne.mockResolvedValue({ ...SITE, banner_data: OLD_BANNER_URI });
    const r = await saveSite(mockEnv(), PAID_USER, { branding: { banner: BANNER_URI } }, "site-1");
    expect(r.ok).toBe(true);
    expect(savedBannerParam()).toBe(BANNER_URI);
  });

  it("removes the banner when the draft sends null, clearing the stored image", async () => {
    mockOne.mockResolvedValue({ ...SITE, banner_data: OLD_BANNER_URI });
    const r = await saveSite(mockEnv(), PAID_USER, { branding: { banner: null } }, "site-1");
    expect(r.ok).toBe(true);
    expect(savedBannerParam()).toBe("");
  });

  it("keeps the stored banner when the payload does not mention it", async () => {
    mockOne.mockResolvedValue({ ...SITE, banner_data: OLD_BANNER_URI });
    const r = await saveSite(mockEnv(), PAID_USER, { brand: { tagline: "hi" } }, "site-1");
    expect(r.ok).toBe(true);
    expect(savedBannerParam()).toBe(OLD_BANNER_URI);
  });

  it("rejects an invalid banner before any write", async () => {
    mockOne.mockResolvedValue(SITE);
    const r = await saveSite(mockEnv(), PAID_USER, { branding: { banner: "data:image/png;base64,R0lGODdh notpng" } }, "site-1");
    expect(r.code).toBe("invalid_banner");
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE sites SET slug="))).toBe(false);
  });

  it("rejects SVG banners: the format stays unsupported", async () => {
    mockOne.mockResolvedValue(SITE);
    const svg = `data:image/svg+xml;base64,${Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>").toString("base64")}`;
    const r = await saveSite(mockEnv(), PAID_USER, { branding: { banner: svg } }, "site-1");
    expect(r.code).toBe("invalid_banner");
  });

  it("ignores branding writes on the free plan, banner included", async () => {
    mockOne.mockResolvedValue(SITE);
    const r = await saveSite(mockEnv(), USER_ROW, { branding: { banner: BANNER_URI } }, "site-1");
    expect(r.ok).toBe(true);
    expect(savedBannerParam()).toBe("");
  });
});
