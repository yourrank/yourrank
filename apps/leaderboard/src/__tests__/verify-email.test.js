import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockOne = mock(() => Promise.resolve(null));
const mockExec = mock(() => Promise.resolve());
const mockQuery = mock(() => Promise.resolve([]));

const dbModule = {
  one: (...args) => mockOne(...args),
  exec: (...args) => mockExec(...args),
  query: (...args) => mockQuery(...args),
  withTransaction: async (fn) => fn({
    one: (...a) => mockOne(...a),
    exec: (...a) => mockExec(...a),
    query: (...a) => mockQuery(...a),
  }),
  getSql: () => null,
};
import { emailVerificationDeliveryState, handleResendVerification, verifyEmailToken as verifyEmailTokenImpl } from "../handlers/auth.js";
const verifyEmailToken = (token) => verifyEmailTokenImpl(token, dbModule);
import { verifyEmailPageHtml } from "../pages/verify-email.js";

describe("verifyEmailToken", () => {
  beforeEach(() => {
    mockOne.mockReset();
    mockExec.mockReset();
    mockQuery.mockReset();
  });

  test("marks the user verified and clears the token", async () => {
    mockOne.mockResolvedValueOnce({ id: "user-1", email_verification_sent_at: new Date().toISOString() });

    const result = await verifyEmailToken("good-token");
    expect(result).toEqual({ ok: true, userId: "user-1" });
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExec.mock.calls[0][0]).toContain("email_verified=true");
    expect(mockExec.mock.calls[0][0]).toContain("email_verification_token_hash=NULL");
  });

  test("rejects a missing token without touching the database", async () => {
    const result = await verifyEmailToken("  ");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(mockOne).not.toHaveBeenCalled();
  });

  test("rejects an unknown or already-used token", async () => {
    mockOne.mockResolvedValueOnce(null);

    const result = await verifyEmailToken("stale-token");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(mockExec).not.toHaveBeenCalled();
  });

  test("reports an expired link as 410 and keeps the user unverified", async () => {
    const sentAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    mockOne.mockResolvedValueOnce({ id: "user-1", email_verification_sent_at: sentAt });

    const result = await verifyEmailToken("old-token");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(410);
    expect(mockExec).not.toHaveBeenCalled();
  });
});

describe("verification email delivery", () => {
  test("is required and only configured with a provider and From address in deployed environments", () => {
    expect(emailVerificationDeliveryState({ ENVIRONMENT: "production" })).toEqual({ configured: false, required: true });
    expect(emailVerificationDeliveryState({ ENVIRONMENT: "staging", RESEND_API_KEY: "configured", MAIL_FROM: "YourRank <hey@example.com>" })).toEqual({ configured: true, required: true });
    expect(emailVerificationDeliveryState({ ENVIRONMENT: "development" })).toEqual({ configured: false, required: false });
  });

  test("lets the signed-in dashboard resend without posting its email address", async () => {
    const sent = mock(() => Promise.resolve({ sent: true }));
    const response = await handleResendVerification(
      new Request("https://test.com/api/auth/resend-verification", { method: "POST" }),
      { ENVIRONMENT: "development" },
      {
        currentUser: () => Promise.resolve({ id: "user-1", email: "creator@example.com" }),
        rateLimit: () => Promise.resolve({ ok: true }),
        one: () => Promise.resolve({ id: "user-1", email_verified: false }),
        issueVerificationEmail: sent,
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, sent: true });
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0][2]).toBe("creator@example.com");
  });

  test("fails closed before lookup when deployed email configuration is missing", async () => {
    const lookup = mock(() => Promise.resolve(null));
    const request = new Request("https://test.com/api/auth/resend-verification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "creator@example.com" }),
    });
    const response = await handleResendVerification(request, { ENVIRONMENT: "production" }, { one: lookup });
    expect(response.status).toBe(503);
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("verifyEmailPageHtml", () => {
  test("loads its script as a module so the page never crashes on import", () => {
    const html = verifyEmailPageHtml({ message: "Checking…" });
    expect(html).toContain('<script src="/assets/verify-email.js" type="module">');
  });

  test("renders the outcome server-side and hides the error and resend blocks by default", () => {
    const html = verifyEmailPageHtml({ message: "Email confirmed." });
    expect(html).toContain("Email confirmed.");
    expect(html).not.toContain("{{VERIFY");
    expect(html).toContain('id="err" role="alert" aria-live="assertive" hidden');
    expect(html).toContain('id="resendWrap" hidden');
  });

  test("shows the error and resend affordance when verification failed", () => {
    const html = verifyEmailPageHtml({ message: "We couldn't confirm your email.", error: "Link expired.", showResend: true });
    expect(html).toContain("Link expired.");
    expect(html).not.toContain('id="err" role="alert" aria-live="assertive" hidden');
    expect(html).not.toContain('id="resendWrap" hidden');
  });
});
