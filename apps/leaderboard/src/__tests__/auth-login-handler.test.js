import { describe, test, expect, mock, beforeEach } from "bun:test";
import { handleLogin } from "../handlers/auth.js";
import { hashPassword } from "../auth.js";

// Regression gates for the staging login failure report. Every path below was
// observed against staging (2026-09-27) and must keep returning a JSON body
// with a user-displayable `error` string — the frontend renders it verbatim.
//
// The account-state paths (2, 4, 5) are the actual root-cause candidates for
// "valid credentials but login fails": a row with no password_hash (account
// created outside YourRank auth), a locked_until from earlier failed attempts,
// and email_verified=false when confirmation only ever happened in Supabase.

const PASSWORD = "CorrectPass123!";
const EMAIL = "person@example.com";

const { hash: GOOD_HASH, salt: GOOD_SALT } = await hashPassword(PASSWORD);

function loginReq({ email = EMAIL, password = PASSWORD } = {}) {
  const request = new Request("https://staging.yourrank.site/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  // withHandler normally populates this after schema validation.
  request.validatedBody = { email, password };
  return request;
}

const mocks = {
  rateLimit: mock(() => Promise.resolve({ ok: true })),
  one: mock(() => Promise.resolve(null)),
  exec: mock(() => Promise.resolve()),
  createSession: mock(() => Promise.resolve("sess-token")),
  issueVerificationEmail: mock(() => Promise.resolve({ sent: true })),
  getEnabledFeatureKeys: mock(() => Promise.resolve([])),
};

function deps({ user = null } = {}) {
  mocks.one.mockImplementation((sql) =>
    Promise.resolve(sql.includes("FROM users") ? user : { slug: "test-board" }),
  );
  return {
    rateLimit: mocks.rateLimit,
    one: mocks.one,
    exec: mocks.exec,
    createSession: mocks.createSession,
    issueVerificationEmail: mocks.issueVerificationEmail,
    getEnabledFeatureKeys: mocks.getEnabledFeatureKeys,
    cookieSet: (t) => `yr_session=${t}; Path=/; HttpOnly`,
    withTransaction: async (fn) => fn({}),
    destroyAllUserSessions: () => Promise.resolve(),
  };
}

function verifiedUser(overrides = {}) {
  return {
    id: "user-1",
    email: EMAIL,
    password_hash: GOOD_HASH,
    password_salt: GOOD_SALT,
    status: "active",
    email_verified: true,
    failed_login_count: 0,
    locked_until: null,
    ...overrides,
  };
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.rateLimit.mockResolvedValue({ ok: true });
  mocks.createSession.mockResolvedValue("sess-token");
  mocks.issueVerificationEmail.mockResolvedValue({ sent: true });
  mocks.getEnabledFeatureKeys.mockResolvedValue([]);
});

describe("handleLogin credential failures", () => {
  test("unknown email returns the generic 401", async () => {
    const res = await handleLogin(loginReq(), {}, deps());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "Incorrect email or password" });
  });

  test("account without a password_hash fails as a generic 401, never a 500", async () => {
    // Rows created outside YourRank auth (e.g. Supabase-era accounts) have no
    // password_hash. This is the staging mismatch case: valid email, correct
    // password, but nothing to verify against.
    const user = verifiedUser({ password_hash: null, password_salt: null });
    const res = await handleLogin(loginReq(), {}, deps({ user }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Incorrect email or password");
  });

  test("wrong password returns the generic 401 and increments the counter", async () => {
    const res = await handleLogin(loginReq({ password: "WrongPass999!" }), {}, deps({ user: verifiedUser() }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Incorrect email or password");
    const execSql = mocks.exec.mock.calls.map((c) => c[0]);
    expect(execSql.some((s) => s.includes("failed_login_count = failed_login_count + 1"))).toBe(true);
  });

  test("the 10th consecutive failure sets locked_until", async () => {
    const user = verifiedUser({ failed_login_count: 9 });
    const res = await handleLogin(loginReq({ password: "WrongPass999!" }), {}, deps({ user }));
    expect(res.status).toBe(401);
    const execSql = mocks.exec.mock.calls.map((c) => c[0]);
    expect(execSql.some((s) => s.includes("locked_until = NOW() + INTERVAL"))).toBe(true);
  });

  test("a locked account rejects even the correct password with a specific 429", async () => {
    // This is a real "valid credentials but login fails" state on staging:
    // earlier failed attempts lock the row, and the correct password then gets
    // the lockout message rather than a session.
    const user = verifiedUser({ locked_until: new Date(Date.now() + 10 * 60_000).toISOString() });
    const res = await handleLogin(loginReq(), {}, deps({ user }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain("temporarily locked");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  test("the per-account rate limit rejects even the correct password with a specific 429", async () => {
    mocks.rateLimit.mockImplementation((env, key) =>
      Promise.resolve({ ok: !key.startsWith("login-email:") }),
    );
    const res = await handleLogin(loginReq(), {}, deps({ user: verifiedUser() }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain("Too many attempts on this account");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  test("a suspended account gets the generic error, not an enumeration leak", async () => {
    const res = await handleLogin(loginReq(), {}, deps({ user: verifiedUser({ status: "suspended" }) }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Incorrect email or password");
  });
});

describe("handleLogin success paths", () => {
  test("verified account gets a session cookie and emailVerified=true", async () => {
    const res = await handleLogin(loginReq(), {}, deps({ user: verifiedUser() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user.emailVerified).toBe(true);
    expect(body.needsVerification).toBeUndefined();
    expect(res.headers.get("set-cookie")).toContain("yr_session=sess-token");
    const execSql = mocks.exec.mock.calls.map((c) => c[0]);
    expect(execSql.some((s) => s.includes("failed_login_count = 0"))).toBe(true);
  });

  test("unverified account gets needsVerification and a fresh link, not a bare failure", async () => {
    // Supabase-side confirmation must not be assumed: only
    // public.users.email_verified counts, and when it is false the response
    // must route the UI to the verify flow.
    const user = verifiedUser({ email_verified: false });
    const res = await handleLogin(loginReq(), {}, deps({ user }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.needsVerification).toBe(true);
    expect(body.verificationSent).toBe(true);
    expect(mocks.issueVerificationEmail).toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toContain("yr_session=sess-token");
  });

  test("verificationSent=false is surfaced so the UI can show delivery failure", async () => {
    mocks.issueVerificationEmail.mockResolvedValue({ sent: false });
    const user = verifiedUser({ email_verified: false });
    const res = await handleLogin(loginReq(), {}, deps({ user }));
    expect((await res.json()).verificationSent).toBe(false);
  });
});
