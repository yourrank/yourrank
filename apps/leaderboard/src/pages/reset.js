// reset page
import { DEVIN_DESIGN_CONTRACT } from "@yourrank/shared/page-shell";

export const resetPage = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>New password · YourRank</title>
<meta name="robots" content="noindex, nofollow" /><link rel="canonical" href="https://yourrank.site/reset" /><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/app.css" /><link rel="stylesheet" href="/assets/ui.css" /><link rel="stylesheet" href="/assets/devin-system.css" /></head><body>${DEVIN_DESIGN_CONTRACT}
<a href="#main-content" class="sr-only skip-link">Skip to content</a>
<div class="auth-wrap"><aside class="auth-side"><div><div class="brand">Your<b>Rank</b></div></div>
<div><h1>Set a new password.</h1><p>Pick something you'll remember this time. At least 8 characters, upper &amp; lower case, a number, and a symbol.</p></div>
<div class="feat"></div></aside>
<main class="auth-main" id="main-content"><div class="auth-card"><h2>New password</h2><p class="sub">Then you're straight back in.</p>
<form id="form" method="POST" action="/api/auth/reset" novalidate><div class="field"><label for="password">New password</label><div class="pw-wrap"><input id="password" name="password" type="password" autocomplete="new-password" required minlength="8" aria-describedby="pw-hint" /><button type="button" class="pw-toggle" data-pw-toggle aria-label="Show password"><svg data-eye width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg><svg data-eye-off width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" hidden aria-hidden="true" focusable="false"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg></button></div>
  <span class="field-err" id="password-err" data-field-err="password" role="alert" aria-live="polite"></span>
  <ul class="pw-reqs" id="pwReqs" aria-label="Password requirements">
    <li data-req="len" class="pw-req">At least 8 characters</li>
    <li data-req="case" class="pw-req">Upper &amp; lower case</li>
    <li data-req="num" class="pw-req">A number</li>
    <li data-req="special" class="pw-req">A symbol</li>
  </ul>
  <span class="hint" id="pw-hint">Use all four requirements above.</span></div>
    <div class="err" id="err" role="alert" aria-live="assertive"></div><button class="btn btn--accent w-full" type="submit" id="submit">Save &amp; sign in</button></form>
  <p class="foot"><a href="/login">Back to sign in</a></p></div></main></div>
  <script type="module" src="/assets/auth.js?v=4"></script></body></html>`;
