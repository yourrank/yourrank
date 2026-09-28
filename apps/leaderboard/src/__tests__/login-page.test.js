import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { verifyEmailPromptState, verifyEmailPageHtml } from "../pages/verify-email.js";
import { signupPage } from "../pages/signup.js";

// Regression gates for the staging login failure report:
//  1. /login shipped without <!DOCTYPE html> — login.jsx was the only JSX
//     page in PAGES, and the bare-Component render path returns the JSX
//     verbatim without a doctype, so browsers dropped into quirks mode.
//     Now it is a string template (like signup.js) and carries DOCTYPE.
//  2. The verify-email interstitial is part of the login flow (unverified
//     accounts are redirected there after a *successful* password check) and
//     must say so, otherwise it reads exactly like a silent login failure.

const loginHtml = require("../pages/login.js").loginPage.toString();
const signupHtml = signupPage.toString();
const authJs = readFileSync(new URL("../assets/auth.js", import.meta.url), "utf8");

describe("login page document", () => {
  it("starts with <!DOCTYPE html> so browsers stay in standards mode", () => {
    expect(loginHtml.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("renders exactly one <html> document with no duplicate doctype", () => {
    expect(loginHtml.match(/<!doctype html>/gi)).toHaveLength(1);
    expect(loginHtml.match(/<html[\s>]/gi)).toHaveLength(1);
  });

  it("keeps a form-level error region wired for assistive tech", () => {
    // auth.js writes every non-field failure here; losing this element is what
    // turns a rejected login into a silent no-op.
    expect(loginHtml).toContain('class="err" id="err"');
    expect(loginHtml).toMatch(/<div class="err" id="err" role="alert" aria-live="assertive">/);
  });

  it("keeps per-field error targets for email and password", () => {
    expect(loginHtml).toContain('data-field-err="email"');
    expect(loginHtml).toContain('data-field-err="password"');
  });

  it("loads all scripts externally so script-src 'self' does not break sign-in", () => {
    const scripts = [...loginHtml.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toContain("src=");
    expect(loginHtml).toContain('type="module" src="/assets/auth.js');
  });

  it("prefills both login methods from an email query parameter without submitting", () => {
    expect(loginHtml).toContain('id="codeEmail"');
    expect(authJs).toContain('urlParams.get("email")');
    expect(authJs).toContain('for (const id of ["codeEmail", "email"])');
  });
});

describe("signup page fields", () => {
  it("keeps the password signup form slim and provides the email-code fields", () => {
    const passwordForm = signupHtml.match(/<form id="form"[\s\S]*?<\/form>/)?.[0] || "";
    const passwordInputIds = [...passwordForm.matchAll(/<input\b[^>]*\bid="([^"]+)"/gi)].map((match) => match[1]);
    expect(passwordInputIds).toEqual(["email", "name", "password"]);
    const codeForm = signupHtml.match(/<form id="codeForm"[\s\S]*?<\/form>/)?.[0] || "";
    const codeInputIds = [...codeForm.matchAll(/<input\b[^>]*\bid="([^"]+)"/gi)].map((match) => match[1]);
    expect(codeInputIds).toEqual(["codeEmail", "codeName", "code"]);
    expect(signupHtml).toContain('<label for="name">Your name</label>');
    expect(signupHtml).toContain('placeholder="How viewers will see you"');
    expect(signupHtml).toContain('<label for="codeName">Your name</label>');
    expect(codeForm).toContain('placeholder="How viewers will see you"');
    expect(signupHtml).not.toContain('id="slug"');
  });

  it("uses the explicit duplicate-email recovery state", () => {
    expect(authJs).toContain('data.code === "email_registered"');
    expect(authJs).toContain("This email is already registered.");
    expect(authJs).toContain('link.textContent = "Sign in instead"');
    expect(authJs).toContain("/login?email=");
    expect(authJs).toContain("encodeURIComponent(payload.email)");
  });
});

describe("verify-email prompt state", () => {
  it("explains an unverified signed-in session without claiming a password check", () => {
    const state = verifyEmailPromptState({ loginNeedsVerification: true });
    expect(state.message).toContain("isn't verified");
    expect(state.message).toContain("signed in");
    expect(state.message).not.toContain("password was correct");
    expect(state.error || "").toBe("");
    expect(state.showResend).toBe(true);
  });

  it("reports delivery failure as an error with resend", () => {
    const state = verifyEmailPromptState({ deliveryFailed: true, loginNeedsVerification: true });
    expect(state.error).toContain("may not have been delivered");
    expect(state.showResend).toBe(true);
  });

  it("keeps generic copy for signup hints and bare visits", () => {
    expect(verifyEmailPromptState({}).message).toBe("Check your inbox for a verification link, or request a new one below.");
    expect(verifyEmailPromptState({ from: "login" }).message).toBe("Check your inbox for a verification link, or request a new one below.");
  });

  it("offers a continue-to-dashboard link to signed-in users", () => {
    const state = verifyEmailPromptState({ signedIn: true });
    expect(state.showContinue).toBe(true);
    const html = verifyEmailPageHtml(state);
    expect(html).toContain('id="continueWrap">');
    expect(html).toContain("Continue to your dashboard");
    expect(html).not.toContain('id="continueWrap" hidden');
  });

  it("hides the continue link by default", () => {
    const html = verifyEmailPageHtml(verifyEmailPromptState({}));
    expect(html).toContain('id="continueWrap" hidden');
    expect(html).not.toContain("{{VERIFY_");
  });

  it("renders the login-context message into the page", () => {
    const html = verifyEmailPageHtml(verifyEmailPromptState({ loginNeedsVerification: true }));
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("isn't verified");
    expect(html).toContain('id="resendWrap"');
    expect(html).not.toContain("{{VERIFY_");
  });
});
