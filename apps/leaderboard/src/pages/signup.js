// signup page
import { DEVIN_DESIGN_CONTRACT } from "@yourrank/shared/page-shell";
import { COMMUNITY_HANDLE_HOST, COMMUNITY_HANDLE_RULES } from "@yourrank/shared/community-handle";

export const signupPage = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Create account · YourRank suite</title>
<meta name="robots" content="noindex, nofollow" /><link rel="canonical" href="https://yourrank.site/signup" /><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/app.css" /><link rel="stylesheet" href="/assets/ui.css" /><link rel="stylesheet" href="/assets/devin-system.css" /></head><body>${DEVIN_DESIGN_CONTRACT}
<a href="#main-content" class="sr-only skip-link">Skip to content</a>
<div class="auth-wrap"><aside class="auth-side"><div><div class="brand">Your<b>Rank</b></div></div>
<div><h2>Your streamer suite, ready in seconds.</h2><p>One email, one password, and your page is ready. The first board is a draft sample race — you can rename the URL, edit everything, and publish when you're ready.</p>
<div class="auth-spec" aria-hidden="true"><div class="auth-spec-h"><span>your-suite.config</span><span class="dot">● live</span></div>
<div class="auth-spec-row"><span>Leaderboards</span><span>included</span></div>
<div class="auth-spec-row"><span>Telegram bot</span><span>turn on</span></div>
<div class="auth-spec-row"><span>Rewards &amp; Shop</span><span>Kick connected</span></div>
<div class="auth-spec-row"><span>Updates</span><span>instant</span></div></div></div>
<div class="feat"><div>Free to set up · upgrade when you are ready</div></div></aside>
<main class="auth-main" id="main-content"><div class="auth-card"><a href="/" class="auth-brand-m">Your<b>Rank</b></a><h1>Create account</h1><p class="sub">Free. Takes 30 seconds.</p>
<div id="planBanner" class="plan-banner" hidden></div>
<form id="form" method="POST" action="/api/auth/signup" novalidate>
<div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required aria-describedby="email-err email-tip" /><span class="field-err" id="email-err" data-field-err="email" role="alert" aria-live="polite"></span><span class="hint" id="email-tip">We'll use this for login and important updates.</span></div>
<div class="field"><label for="name">Your name / handle</label><input id="name" name="name" type="text" autocomplete="nickname" required aria-describedby="name-err" placeholder="e.g. KickStream" /><span class="field-err" id="name-err" data-field-err="name" role="alert" aria-live="polite"></span></div>
<div class="field"><label for="slug">Community handle</label><div class="auth-url-wrap"><span class="auth-url-prefix">${COMMUNITY_HANDLE_HOST}/</span><input id="slug" name="slug" type="text" autocomplete="off" required spellcheck="false" autocapitalize="none" maxlength="120" aria-describedby="slug-err slug-tip slugPreview slugNote" placeholder="your-handle" class="auth-url-input" /></div><span class="field-err" id="slug-err" data-field-err="slug" role="alert" aria-live="polite"></span><span class="hint" id="slug-tip">${COMMUNITY_HANDLE_RULES} You can also paste your ${COMMUNITY_HANDLE_HOST} link.</span><span class="hint" id="slugPreview">${COMMUNITY_HANDLE_HOST}/…</span><span class="hint" id="slugNote" aria-live="polite"></span></div>
<div class="field"><label for="password">Password</label><div class="pw-wrap"><input id="password" name="password" type="password" autocomplete="new-password" required minlength="8" aria-describedby="password-err pw-hint" /><button type="button" class="pw-toggle" data-pw-toggle aria-label="Show password"><svg data-eye width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg><svg data-eye-off width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" hidden aria-hidden="true" focusable="false"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg></button></div>
  <div class="pw-meter" id="pwMeter" hidden><div class="pw-meter-track"><div class="pw-meter-bar"></div></div><div class="pw-meter-label" data-pw-strength aria-live="polite"></div></div>
  <span class="field-err" id="password-err" data-field-err="password" role="alert" aria-live="polite"></span>
  <ul class="pw-reqs" id="pwReqs" aria-label="Password requirements">
    <li data-req="len" class="pw-req">At least 8 characters</li>
    <li data-req="case" class="pw-req">Upper &amp; lower case</li>
    <li data-req="num" class="pw-req">A number</li>
    <li data-req="special" class="pw-req">A symbol</li>
  </ul>
  <span class="hint" id="pw-hint">Longer passphrases are stronger — the meter above is just a guide.</span></div>
  <div class="err" id="err" role="alert" aria-live="assertive"></div><button class="btn btn--accent w-full" type="submit" id="submit">Create account</button></form>
<p class="foot">Already have one? <a href="/login">Sign in</a><span class="foot-sep">Are you a viewer? <a href="/me">Log in with Kick or Discord</a></span></p></div></main></div>
<script type="module" src="/assets/auth.js?v=4"></script></body></html>`;
