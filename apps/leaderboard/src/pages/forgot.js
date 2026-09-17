// forgot page
import { DEVIN_DESIGN_CONTRACT } from "@yourrank/shared/page-shell";

export const forgotPage = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Reset password · YourRank</title>
<meta name="robots" content="noindex, nofollow" /><link rel="canonical" href="https://yourrank.site/forgot" /><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/app.css" /><link rel="stylesheet" href="/assets/ui.css" /><link rel="stylesheet" href="/assets/devin-system.css" /></head><body>${DEVIN_DESIGN_CONTRACT}
<a href="#main-content" class="sr-only skip-link">Skip to content</a>
<div class="auth-wrap"><aside class="auth-side"><div><div class="brand">Your<b>Rank</b></div></div>
<div><h1>Locked out? It happens.</h1><p>Tell us the email on your account and we'll send a reset link. It's valid for one hour — check your spam folder if it doesn't arrive within a few minutes.</p></div>
<div class="feat"></div></aside>
<main class="auth-main" id="main-content"><div class="auth-card"><h2>Reset password</h2><p class="sub">We'll email you a link.</p>
<form id="form" method="POST" action="/api/auth/forgot" novalidate><div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required /></div>
<div class="err" id="err" role="alert" aria-live="assertive"></div><div class="msg" id="msg" hidden role="status" aria-live="polite"></div><button class="btn btn--accent w-full" type="submit" id="submit">Send reset link</button></form>
<p class="foot"><a href="/login">Back to sign in</a></p></div></main></div>
<script type="module" src="/assets/auth.js?v=4"></script></body></html>`;
