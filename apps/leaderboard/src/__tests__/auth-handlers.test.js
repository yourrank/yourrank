import { describe, test, expect, mock, beforeEach } from "bun:test";

// Collaborators are injected into the handler under test.
const mockOne = mock(() => Promise.resolve(null));
const mockUnsafe = mock(() => Promise.resolve());
const mockExec = mock(() => Promise.resolve());
const mockQuery = mock(() => Promise.resolve([]));
const mockCreateSession = mock(() => Promise.resolve("new-session"));
const mockDestroyAllUserSessions = mock(() => Promise.resolve());

const db = {
  one: (...args) => mockOne(...args),
  exec: (...args) => mockExec(...args),
  query: (...args) => mockQuery(...args),
  withTransaction: async (fn) => fn({
    one: (...a) => mockOne(...a),
    exec: (...a) => mockExec(...a),
    query: (...a) => mockQuery(...a),
    unsafe: (...a) => mockUnsafe(...a),
  }),
  getSql: () => null,
};
const session = {
  createSession: (...args) => mockCreateSession(...args),
  destroySession: () => Promise.resolve(),
  destroyAllUserSessions: (...args) => mockDestroyAllUserSessions(...args),
  cookieSet: (t) => `yr_session=${t}`,
  cookieClear: () => "yr_session=",
  readToken: () => null,
  resolveSession: () => Promise.resolve({ userId: null, cookie: null }),
  loadUser: () => Promise.resolve(null),
  hasLegacyCookie: () => false,
  cookieClearLegacy: () => "sess=",
  SESSION_ROTATE_AFTER_S: 86400,
  SESSION_TTL_S: 2592000,
};

import { handleReset as handleResetImpl, handleRequestLoginCode, handleVerifyLoginCode } from "../handlers/auth.js";
import { hashToken } from "@yourrank/shared/crypto";
const handleReset = (request, env) => handleResetImpl(request, env, { ...db, ...session });

function req({ token = "valid-token", password = "Newpassword123!" } = {}) {
  const request = new Request("https://test.com/api/auth/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  // readJson in auth.js prefers validatedBody when present.
  request.validatedBody = { token, password };
  return request;
}

describe("handleReset", () => {
  beforeEach(() => {
    mockOne.mockReset();
    mockUnsafe.mockReset();
    mockExec.mockReset();
    mockQuery.mockReset();
    mockCreateSession.mockReset();
    mockCreateSession.mockResolvedValue("new-session");
    mockDestroyAllUserSessions.mockReset();
    mockDestroyAllUserSessions.mockResolvedValue();
  });

  test("succeeds for a valid token and writes via tx.unsafe", async () => {
    mockOne.mockResolvedValueOnce({ user_id: "user-1" });

    const res = await handleReset(req(), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(mockUnsafe).toHaveBeenCalledTimes(2);
    expect(mockUnsafe.mock.calls[0][0]).toContain("UPDATE users SET password_hash");
    expect(mockUnsafe.mock.calls[1][0]).toContain("DELETE FROM password_resets");
    expect(mockDestroyAllUserSessions).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(res.headers.get("set-cookie")).toBe("yr_session=new-session");
  });

  test("returns 400 for an invalid or expired token", async () => {
    mockOne.mockResolvedValueOnce(null);

    const res = await handleReset(req({ token: "bad-token" }), {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(mockUnsafe).not.toHaveBeenCalled();
  });

  test("rejects a password that is too short", async () => {
    const res = await handleReset(req({ password: "short" }), {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(mockOne).not.toHaveBeenCalled();
  });
});

const mockRateLimit = mock(() => Promise.resolve({ ok: true }));
const mockSendEmail = mock(() => Promise.resolve({ sent: true }));
const mockFeatures = mock(() => Promise.resolve(["chat"]));

const codeDeps = {
  rateLimit: (...args) => mockRateLimit(...args),
  one: (...args) => mockOne(...args),
  exec: (...args) => mockExec(...args),
  withTransaction: db.withTransaction,
  sendEmail: (...args) => mockSendEmail(...args),
  createSession: (...args) => mockCreateSession(...args),
  cookieSet: (t) => `yr_session=${t}`,
  getEnabledFeatureKeys: (...args) => mockFeatures(...args),
};

function codeReq(path, body) {
  const request = new Request(`https://test.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  request.validatedBody = body;
  return request;
}

describe("handleRequestLoginCode", () => {
  beforeEach(() => {
    mockOne.mockReset(); mockExec.mockReset(); mockUnsafe.mockReset();
    mockRateLimit.mockReset(); mockRateLimit.mockResolvedValue({ ok: true });
    mockSendEmail.mockReset(); mockSendEmail.mockResolvedValue({ sent: true });
    mockFeatures.mockReset(); mockFeatures.mockResolvedValue(["chat"]);
    mockCreateSession.mockReset(); mockCreateSession.mockResolvedValue("new-session");
  });

  test("stores a hashed code row and emails it to a known active user", async () => {
    mockOne.mockResolvedValueOnce({ id: "u-1", status: "active", locked_until: null });
    const res = await handleRequestLoginCode(codeReq("/api/auth/code/request", { email: "Owner@Example.com" }), {}, codeDeps);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const inserts = mockExec.mock.calls.filter(([sql]) => sql.includes("INSERT INTO login_codes"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1][0]).toBe("owner@example.com");
    // The stored value is a hash, never the raw code.
    expect(inserts[0][1][1]).toMatch(/^[a-f0-9]{64}$/);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][1].to).toBe("owner@example.com");
    expect(mockSendEmail.mock.calls[0][1].subject).toContain("sign-in code");
    expect(mockSendEmail.mock.calls[0][1].text).toMatch(/\d{6}/);
  });

  test("unknown user still answers ok without a row or an email", async () => {
    mockOne.mockResolvedValueOnce(null);
    const res = await handleRequestLoginCode(codeReq("/api/auth/code/request", { email: "nobody@example.com" }), {}, codeDeps);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  test("suspended user gets no code but the same ok response", async () => {
    mockOne.mockResolvedValueOnce({ id: "u-2", status: "suspended", locked_until: null });
    const res = await handleRequestLoginCode(codeReq("/api/auth/code/request", { email: "sus@example.com" }), {}, codeDeps);
    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  test("per-email cooldown returns 429", async () => {
    mockRateLimit.mockImplementation((_env, key) =>
      Promise.resolve({ ok: !key.startsWith("login-code:cooldown:") }));
    const res = await handleRequestLoginCode(codeReq("/api/auth/code/request", { email: "a@b.com" }), {}, codeDeps);
    expect(res.status).toBe(429);
  });

  test("delivery not configured in production returns 503", async () => {
    const res = await handleRequestLoginCode(codeReq("/api/auth/code/request", { email: "a@b.com" }), { ENVIRONMENT: "production" }, codeDeps);
    expect(res.status).toBe(503);
    expect(mockOne).not.toHaveBeenCalled();
  });

  test("send failure revokes the stored code row", async () => {
    mockOne.mockResolvedValueOnce({ id: "u-1", status: "active", locked_until: null });
    mockSendEmail.mockResolvedValueOnce({ sent: false, reason: "network" });
    const res = await handleRequestLoginCode(codeReq("/api/auth/code/request", { email: "a@b.com" }), {}, codeDeps);
    expect(res.status).toBe(200);
    const deletes = mockExec.mock.calls.filter(([sql]) => sql.includes("DELETE FROM login_codes"));
    expect(deletes.some(([sql]) => sql.includes("code_hash"))).toBe(true);
  });
});

describe("handleVerifyLoginCode", () => {
  const EMAIL = "owner@example.com";
  const CODE = "482913";

  beforeEach(() => {
    mockOne.mockReset(); mockExec.mockReset(); mockUnsafe.mockReset();
    mockRateLimit.mockReset(); mockRateLimit.mockResolvedValue({ ok: true });
    mockSendEmail.mockReset();
    mockFeatures.mockReset(); mockFeatures.mockResolvedValue(["chat"]);
    mockCreateSession.mockReset(); mockCreateSession.mockResolvedValue("new-session");
  });

  async function rowFor(email, code, attempts = 0) {
    return { id: "lc-1", code_hash: await hashToken(`${email}:${code}`), attempts };
  }

  test("a correct code deletes the row, verifies the email, and sets the session cookie", async () => {
    mockOne
      .mockResolvedValueOnce(await rowFor(EMAIL, CODE))
      .mockResolvedValueOnce({ id: "u-1", email: EMAIL, status: "active", locked_until: null })
      .mockResolvedValueOnce({ slug: "board" });
    const res = await handleVerifyLoginCode(codeReq("/api/auth/code/verify", { email: EMAIL, code: CODE }), {}, codeDeps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user.emailVerified).toBe(true);
    expect(body.user.slug).toBe("board");
    expect(res.headers.get("set-cookie")).toBe("yr_session=new-session");
    expect(mockUnsafe.mock.calls[0][0]).toContain("DELETE FROM login_codes");
    expect(mockUnsafe.mock.calls[1][0]).toContain("email_verified=true");
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  test("wrong code increments attempts and returns 401", async () => {
    mockOne.mockResolvedValueOnce(await rowFor(EMAIL, CODE));
    const res = await handleVerifyLoginCode(codeReq("/api/auth/code/verify", { email: EMAIL, code: "000000" }), {}, codeDeps);
    expect(res.status).toBe(401);
    const updates = mockExec.mock.calls.filter(([sql]) => sql.includes("attempts = attempts + 1"));
    expect(updates).toHaveLength(1);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  test("a row at the attempts cap is deleted and rejected", async () => {
    mockOne.mockResolvedValueOnce(await rowFor(EMAIL, CODE, 5));
    const res = await handleVerifyLoginCode(codeReq("/api/auth/code/verify", { email: EMAIL, code: CODE }), {}, codeDeps);
    expect(res.status).toBe(401);
    expect(mockExec.mock.calls.some(([sql]) => sql.includes("DELETE FROM login_codes"))).toBe(true);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  test("no live code row → 401", async () => {
    mockOne.mockResolvedValueOnce(null);
    const res = await handleVerifyLoginCode(codeReq("/api/auth/code/verify", { email: EMAIL, code: CODE }), {}, codeDeps);
    expect(res.status).toBe(401);
    expect(mockExec).not.toHaveBeenCalled();
  });

  test("malformed code → 400 without touching storage", async () => {
    const res = await handleVerifyLoginCode(codeReq("/api/auth/code/verify", { email: EMAIL, code: "abc" }), {}, codeDeps);
    expect(res.status).toBe(400);
    expect(mockOne).not.toHaveBeenCalled();
  });

  test("matching code for a suspended account signs no session", async () => {
    mockOne
      .mockResolvedValueOnce(await rowFor(EMAIL, CODE))
      .mockResolvedValueOnce({ id: "u-9", email: EMAIL, status: "suspended", locked_until: null });
    const res = await handleVerifyLoginCode(codeReq("/api/auth/code/verify", { email: EMAIL, code: CODE }), {}, codeDeps);
    expect(res.status).toBe(401);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});
