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
<div><h1>Confirm your email.</h1><p>Click the link we sent you to finish setting up your page.</p></div>
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

// Interstitial copy for visits that carry no verification token — typically a
// redirect straight from signup or login. `from=login` must say plainly that
// the credentials were fine and unverified email is the blocker; the generic
// copy reads like a failed login and sends users retrying the form.
export function verifyEmailPromptState({ deliveryFailed = false, from = "" } = {}) {
  if (deliveryFailed) {
    return { message: "We couldn't send your verification email.", error: "Email delivery is temporarily unavailable. Try sending it again later.", showResend: true };
  }
  if (from === "login") {
    return { message: "Your password was correct, but this email address isn't verified yet. We've sent a fresh confirmation link — open it in this browser to finish signing in.", showResend: true };
  }
  return { message: "Open the link we emailed you to confirm your address.", showResend: true };
}
