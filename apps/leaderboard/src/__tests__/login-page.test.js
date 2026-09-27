import { describe, expect, it } from "bun:test";
import { verifyEmailPromptState, verifyEmailPageHtml } from "../pages/verify-email.js";

// Regression gates for the staging login failure report:
//  1. /login shipped without <!DOCTYPE html> — login.jsx was the only JSX
//     page in PAGES, and the bare-Component render path returns the JSX
//     verbatim without a doctype, so browsers dropped into quirks mode.
//     Now it is a string template (like signup.js) and carries DOCTYPE.
//  2. The verify-email interstitial is part of the login flow (unverified
//     accounts are redirected there after a *successful* password check) and
//     must say so, otherwise it reads exactly like a silent login failure.

const loginHtml = require("../pages/login.js").loginPage.toString();

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
    const scripts = [...loginHtml.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toContain("src=");
    expect(loginHtml).toContain('type="module" src="/assets/auth.js');
  });
});

describe("verify-email prompt state", () => {
  it("explains the blocker after a login attempt (from=login)", () => {
    const state = verifyEmailPromptState({ from: "login" });
    expect(state.message).toContain("isn't verified");
    expect(state.message).toContain("password was correct");
    expect(state.error || "").toBe("");
    expect(state.showResend).toBe(true);
  });

  it("reports delivery failure as an error with resend", () => {
    const state = verifyEmailPromptState({ deliveryFailed: true, from: "login" });
    expect(state.error).toContain("Email delivery");
    expect(state.showResend).toBe(true);
  });

  it("keeps the original copy for signup and bare visits", () => {
    expect(verifyEmailPromptState({}).message).toBe("Open the link we emailed you to confirm your address.");
    expect(verifyEmailPromptState({ from: "signup" }).message).toBe("Open the link we emailed you to confirm your address.");
  });

  it("renders the login-context message into the page", () => {
    const html = verifyEmailPageHtml(verifyEmailPromptState({ from: "login" }));
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("isn't verified");
    expect(html).toContain('id="resendWrap"');
    expect(html).not.toContain("{{VERIFY_");
  });
});
