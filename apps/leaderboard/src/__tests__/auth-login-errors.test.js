import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

// Regression gates for "login fails with no useful feedback" on staging.
// These run the real src/assets/auth.js against a happy-dom login page and a
// scripted fetch, asserting that EVERY failure shape lands in a visible error
// element — the form-level #err or a per-field [data-field-err] box — and that
// the verify-email redirect carries the context the interstitial needs.

const authJsSource = readFileSync(new URL("../assets/auth.js", import.meta.url), "utf8");

const LOGIN_FORM_HTML = `
  <h1 id="auth-title">Sign in</h1><p class="sub" id="auth-sub">Welcome back.</p>
  <div class="plan-banner" id="viewerBanner" hidden></div>
  <input id="codeEmail" type="email" />
  <form id="form" method="POST" action="/api/auth/login" novalidate>
    <input id="email" name="email" type="email" />
    <span class="field-err" id="email-err" data-field-err="email"></span>
    <input id="password" name="password" type="password" />
    <span class="field-err" id="password-err" data-field-err="password"></span>
    <div class="err" id="err" role="alert" aria-live="assertive"></div>
    <button type="submit" id="submit">Sign in</button>
  </form>
  <span class="foot-sep" id="viewer-foot"></span>
  <a href="/signup" data-auth-switch>Create account</a>
  <aside class="auth-side"></aside>`;

const SIGNUP_FORM_HTML = `
  <div class="plan-banner" id="planBanner" hidden></div>
  <form id="form" method="POST" action="/api/auth/signup" novalidate>
    <input id="email" name="email" type="email" />
    <span class="field-err" data-field-err="email"></span>
    <input id="name" name="name" type="text" />
    <span class="field-err" data-field-err="name"></span>
    <input id="password" name="password" type="password" />
    <span class="field-err" data-field-err="password"></span>
    <div class="err" id="err" role="alert" aria-live="assertive"></div>
    <button type="submit" id="submit">Create account</button>
  </form>
  <a href="/login" data-auth-switch>Sign in</a>`;

function setupAuthPage(markup, fetchImpl, { url }) {
  const window = new Window({ url, settings: { disableJavaScriptFileLoading: true, fetch: { virtualServers: [] } } });
  window.document.body.innerHTML = markup;
  const fetchMock = (input, init) => {
    const target = typeof input === "string" ? input : input.url;
    if (target === "/api/auth/me") {
      return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ ok: false, user: null }) });
    }
    return fetchImpl(target, init);
  };
  const run = new Function("window", "document", "location", "fetch", authJsSource);
  run(window, window.document, window.location, fetchMock);
  return {
    window,
    document: window.document,
    form: window.document.getElementById("form"),
    errEl: window.document.getElementById("err"),
    submitBtn: window.document.getElementById("submit"),
  };
}

function setupLoginPage(fetchImpl, { url = "https://staging.yourrank.site/login?next=%2Fdashboard" } = {}) {
  return setupAuthPage(LOGIN_FORM_HTML, fetchImpl, { url });
}

function setupSignupPage(fetchImpl, { url = "https://staging.yourrank.site/signup" } = {}) {
  return setupAuthPage(SIGNUP_FORM_HTML, fetchImpl, { url });
}

async function submitLogin(page, { email = "person@example.com", password = "CorrectPass123!" } = {}) {
  page.document.getElementById("email").value = email;
  page.document.getElementById("password").value = password;
  page.form.dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
  // Let the async submit handler (fetch -> json -> DOM write) settle.
  await new Promise((resolve) => setTimeout(resolve, 25));
}

async function submitSignup(page, { email = "person@example.com", name = "Alex Rivera", password = "CorrectPass123!" } = {}) {
  page.document.getElementById("email").value = email;
  page.document.getElementById("name").value = name;
  page.document.getElementById("password").value = password;
  page.form.dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 25));
}

const jsonResponse = (status, body) => () =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

describe("account entry continuity", () => {
  test("switching forms preserves a safe destination and selected plan", () => {
    const page = setupLoginPage(jsonResponse(200, {}), { url: "https://staging.yourrank.site/login?next=%2Fdashboard%2Frewards%2Fshop%3FsiteId%3Dsite-1&plan=pro" });
    const target = new URL(page.document.querySelector("[data-auth-switch]").href);
    expect(target.pathname).toBe("/signup");
    expect(target.searchParams.get("next")).toBe("/dashboard/rewards/shop?siteId=site-1");
    expect(target.searchParams.get("plan")).toBe("pro");
  });

  test("switching forms drops external destinations and unknown plans", () => {
    const page = setupLoginPage(jsonResponse(200, {}), { url: "https://staging.yourrank.site/login?next=https%3A%2F%2Fexample.org%2F&plan=unknown" });
    const target = new URL(page.document.querySelector("[data-auth-switch]").href);
    expect(target.pathname).toBe("/signup");
    expect(target.search).toBe("");
  });

  test("a valid email query prefills both login methods without submitting", () => {
    const page = setupLoginPage(jsonResponse(200, {}), { url: "https://staging.yourrank.site/login?email=person%2Btag%40example.com" });
    expect(page.document.getElementById("codeEmail").value).toBe("person+tag@example.com");
    expect(page.document.getElementById("email").value).toBe("person+tag@example.com");
    expect(page.submitBtn.disabled).toBe(false);
  });

  test("an invalid email query does not prefill either login method", () => {
    const page = setupLoginPage(jsonResponse(200, {}), { url: "https://staging.yourrank.site/login?email=not-an-email" });
    expect(page.document.getElementById("codeEmail").value).toBe("");
    expect(page.document.getElementById("email").value).toBe("");
  });
});

describe("login form error rendering", () => {
  test("wrong credentials show the generic server message", async () => {
    const page = setupLoginPage(jsonResponse(401, { ok: false, error: "Incorrect email or password" }));
    await submitLogin(page);
    expect(page.errEl.textContent).toBe("Incorrect email or password");
    expect(page.submitBtn.disabled).toBe(false);
    expect(page.submitBtn.textContent).toBe("Sign in");
  });

  test("account lockout (429) shows the lockout message", async () => {
    const page = setupLoginPage(jsonResponse(429, { ok: false, error: "Account temporarily locked due to too many failed attempts. Try again later." }));
    await submitLogin(page);
    expect(page.errEl.textContent).toContain("temporarily locked");
  });

  test("per-account rate limit (429) shows the rate-limit message", async () => {
    const page = setupLoginPage(jsonResponse(429, { ok: false, error: "Too many attempts on this account. Try again later." }));
    await submitLogin(page);
    expect(page.errEl.textContent).toContain("Too many attempts");
  });

  test("a failure naming a field this form does not have still shows the error", async () => {
    // Regression: the old code blanked #err whenever data.field was set, even
    // when no [data-field-err] target existed — a completely silent failure.
    const page = setupLoginPage(jsonResponse(400, { ok: false, error: "That page URL is already taken. Pick another.", field: "slug" }));
    await submitLogin(page);
    expect(page.errEl.textContent).toBe("That page URL is already taken. Pick another.");
  });

  test("a failure naming a real field renders next to the input and clears #err", async () => {
    const page = setupLoginPage(jsonResponse(400, { ok: false, error: "Enter a valid email", field: "email" }));
    await submitLogin(page);
    expect(page.document.querySelector('[data-field-err="email"]').textContent).toBe("Enter a valid email");
    expect(page.errEl.textContent).toBe("");
  });

  test("a failure body without an error string falls back to a visible message", async () => {
    const page = setupLoginPage(jsonResponse(500, { ok: false }));
    await submitLogin(page);
    expect(page.errEl.textContent).toBe("Something went wrong.");
  });

  test("a non-JSON 5xx (edge/proxy error page) shows a server-error message, not 'Network error'", async () => {
    const page = setupLoginPage(() =>
      Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new SyntaxError("Unexpected token <")) }),
    );
    await submitLogin(page);
    expect(page.errEl.textContent).toBe("Server error on our side. Try again in a moment.");
  });

  test("a rejected fetch shows the network error message", async () => {
    const page = setupLoginPage(() => Promise.reject(new TypeError("fetch failed")));
    await submitLogin(page);
    expect(page.errEl.textContent).toBe("Network error. Try again.");
  });
});

describe("login form success routing", () => {
  test("unverified account redirects to /verify-email with from=login context", async () => {
    const page = setupLoginPage(jsonResponse(200, {
      ok: true,
      user: { id: "u1", email: "person@example.com", emailVerified: false },
      needsVerification: true,
      verificationSent: true,
    }));
    await submitLogin(page);
    expect(page.window.location.pathname).toBe("/verify-email");
    expect(page.window.location.search).toContain("from=login");
    expect(page.window.location.search).toContain("next=%2Fdashboard");
    expect(page.window.location.search).not.toContain("delivery=failed");
  });

  test("failed verification delivery adds delivery=failed so the interstitial can say so", async () => {
    const page = setupLoginPage(jsonResponse(200, {
      ok: true,
      user: { id: "u1", email: "person@example.com", emailVerified: false },
      needsVerification: true,
      verificationSent: false,
    }));
    await submitLogin(page);
    expect(page.window.location.search).toContain("delivery=failed");
  });

  test("verified account goes to the requested next path", async () => {
    const page = setupLoginPage(jsonResponse(200, {
      ok: true,
      user: { id: "u1", email: "person@example.com", emailVerified: true },
    }));
    await submitLogin(page);
    expect(page.window.location.pathname).toBe("/dashboard");
  });
});

describe("duplicate email signup recovery", () => {
  test("shows a safe sign-in link with the email, destination, and plan preserved", async () => {
    let signupPayload;
    const email = "alex<svg@example.com";
    const page = setupSignupPage((target, init) => {
      if (target === "/api/auth/signup") signupPayload = JSON.parse(init.body);
      return jsonResponse(409, {
        ok: false,
        error: "This email is already registered.",
        field: "email",
        code: "email_registered",
      })();
    }, {
      url: "https://staging.yourrank.site/signup?next=%2Fdashboard%2Frewards%2Fshop%3FsiteId%3Dsite-1&plan=pro",
    });

    await submitSignup(page, { email });

    const emailError = page.document.querySelector('[data-field-err="email"]');
    const link = emailError.querySelector("a");
    const signIn = new URL(link.href);
    expect(emailError.textContent).toBe("This email is already registered. Sign in instead");
    expect(emailError.querySelector("svg")).toBeNull();
    expect(page.document.getElementById("email").getAttribute("aria-invalid")).toBe("true");
    expect(page.document.activeElement.id).toBe("email");
    expect(page.errEl.textContent).toBe("");
    expect(signIn.pathname).toBe("/login");
    expect(signIn.searchParams.get("email")).toBe(email);
    expect(signIn.searchParams.get("next")).toBe("/dashboard/rewards/shop?siteId=site-1");
    expect(signIn.searchParams.get("plan")).toBe("pro");
    expect(signupPayload).not.toHaveProperty("slug");
  });
});
