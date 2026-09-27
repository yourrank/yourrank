// email verification landing page
// The {{VERIFY_*}} placeholders are filled server-side so
// verification never depends on client JavaScript running.
import { DEVIN_DESIGN_CONTRACT } from "@yourrank/shared/page-shell";

export const verifyEmailPage = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Verify email · YourRank</title>
<meta name="robots" content="noindex, nofollow" /><link rel="canonical" href="https://yourrank.site/verify-email" /><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/app.css" /><link rel="stylesheet" href="/assets/ui.css" /><link rel="stylesheet" href="/assets/devin-system.css" /></head><body>${DEVIN_DESIGN_CONTRACT}
<a href="#main-content" class="sr-only skip-link">Skip to content</a>
<div class="auth-wrap"><aside class="auth-side"><div><div class="brand">Your<b>Rank</b></div></div>
<div><h1>Confirm your email.</h1><p>Use the confirmation link in your inbox, or request a new one below.</p></div>
<div class="feat"></div></aside>
<main class="auth-main" id="main-content"><div class="auth-card"><h2>Verify email</h2>
<p class="sub" id="msg">{{VERIFY_MSG}}</p>
<div class="err" id="err" role="alert" aria-live="assertive"{{VERIFY_ERR_HIDDEN}}>{{VERIFY_ERR}}</div>
<p class="foot" id="resendWrap"{{VERIFY_RESEND_HIDDEN}}>Didn't get it? <button class="btn btn--ghost btn--sm" id="resendBtn" type="button">Send again</button></p>
<p class="foot"><a href="/login">Back to sign in</a></p></div></main></div>
<script src="/assets/verify-email.js" type="module"></script></body></html>`;

// Server-rendered states for the page above.
export function verifyEmailPageHtml({ message, error = "", showResend = false } = {}) {
  return verifyEmailPage
    .replace("{{VERIFY_MSG}}", message)
    .replace("{{VERIFY_ERR}}", error)
    .replace("{{VERIFY_ERR_HIDDEN}}", error ? "" : " hidden")
    .replace("{{VERIFY_RESEND_HIDDEN}}", showResend ? "" : " hidden");
}

// Only a resolved, unverified account session can identify email verification
// as the current blocker. The public `from` and `delivery` URL parameters are
// hints, not evidence of a password check or a successful email send.
export function verifyEmailPromptState({ deliveryFailed = false, loginNeedsVerification = false } = {}) {
  const message = loginNeedsVerification
    ? "You're signed in, but your email address isn't verified yet. Check your inbox for a confirmation link, or request a new one below."
    : "Check your inbox for a verification link, or request a new one below.";
  if (deliveryFailed) {
    return { message, error: "The verification email may not have been delivered. Request a new link below.", showResend: true };
  }
  return { message, showResend: true };
}
