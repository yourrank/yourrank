import { describe, expect, it, mock } from "bun:test";
import { handleSignup } from "../handlers/auth.js";

const registered = {
  ok: false,
  error: "This email is already registered.",
  field: "email",
  code: "email_registered",
};

function signupRequest({ name = "Alex Rivera", ...body } = {}) {
  return new Request("https://yourrank.site/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://yourrank.site" },
    body: JSON.stringify({ email: "alex@example.com", password: "CorrectHorse!42", name, ...body }),
  });
}

function signupDeps(overrides = {}) {
  const tx = { unsafe: async () => [] };
  const createUser = mock(async () => {});
  const createBoard = mock(async () => ({ ok: true }));
  const deps = {
    rateLimit: async () => ({ ok: true }),
    findUserByEmail: async () => null,
    findSiteBySlug: async () => null,
    withTransaction: async (fn) => fn(tx),
    createUser,
    createBoard,
    createSession: async () => "session-token",
    issueVerificationEmail: async () => ({ sent: true }),
    sendOnboardingEmail: async () => Promise.resolve(),
    trackActivation: () => {},
    waitUntil: () => {},
    ...overrides,
  };
  return { deps, createUser: deps.createUser, createBoard: deps.createBoard };
}

async function responseBody(response) {
  return response.json();
}

describe("signup duplicate email handling", () => {
  it("returns an exact 409 before creating a user when the email is already registered", async () => {
    const f = signupDeps({ findUserByEmail: async () => ({ id: "existing-user" }) });

    const response = await handleSignup(signupRequest(), {}, f.deps);

    expect(response.status).toBe(409);
    expect(await responseBody(response)).toEqual(registered);
    expect(f.createUser).not.toHaveBeenCalled();
  });

  it("detects an email registered concurrently after a 23505", async () => {
    let lookupCount = 0;
    const f = signupDeps({
      findUserByEmail: async () => (++lookupCount === 1 ? null : { id: "existing-user" }),
      createUser: mock(async () => { throw new Error("23505 unique constraint"); }),
    });

    const response = await handleSignup(signupRequest(), {}, f.deps);

    expect(response.status).toBe(409);
    expect(await responseBody(response)).toEqual(registered);
    expect(f.createUser).toHaveBeenCalledTimes(1);
  });

  it("retries a 23505 when the email is still unregistered", async () => {
    let attempts = 0;
    const f = signupDeps({
      createBoard: mock(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("23505 unique constraint");
        return { ok: true };
      }),
    });

    const response = await handleSignup(signupRequest(), {}, f.deps);

    expect(response.status).toBe(200);
    expect((await responseBody(response)).ok).toBe(true);
    expect(attempts).toBe(2);
    expect(f.createUser).toHaveBeenCalledTimes(2);
  });

  it("returns the signup failure message for non-23505 transaction errors", async () => {
    const f = signupDeps({
      withTransaction: async () => { throw new Error("database unavailable"); },
    });

    const response = await handleSignup(signupRequest(), {}, f.deps);

    expect(response.status).toBe(500);
    expect(await responseBody(response)).toEqual({
      ok: false,
      error: "Sign-up failed, please try again",
    });
  });

  it("generates a suffixed URL from the name and keeps long names within 40 characters", async () => {
    const short = signupDeps();
    const shortResponse = await handleSignup(signupRequest(), {}, short.deps);
    const shortBody = await responseBody(shortResponse);
    expect(shortBody.user.slug).toMatch(/^alex-rivera-[a-z0-9]{1,4}$/);

    const longName = "Alex ".repeat(12);
    const long = signupDeps();
    const longResponse = await handleSignup(signupRequest({ name: longName }), {}, long.deps);
    const longBody = await responseBody(longResponse);
    expect(longBody.user.slug.length).toBeLessThanOrEqual(40);
    expect(longBody.user.slug).toMatch(/-[a-z0-9]{1,4}$/);
  });
});
