import { authPage } from "./auth-shell.js";

export const signupPage = authPage({
  title: "Create account",
  path: "/signup",
  signup: true,
  content: `<div class="auth-entry-intro"><h1>Create your account</h1><p>A home for your community. Start for free.</p></div>
<div id="planBanner" class="plan-banner" hidden></div>
<form id="form" method="POST" action="/api/auth/signup" novalidate>
<div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" autocapitalize="none" spellcheck="false" required aria-describedby="email-err" /><span class="field-err" id="email-err" data-field-err="email" role="alert" aria-live="polite"></span></div>
<div class="field"><label for="name">Your name</label><input id="name" name="name" type="text" autocomplete="nickname" required aria-describedby="name-err" placeholder="How viewers will see you" /><span class="field-err" id="name-err" data-field-err="name" role="alert" aria-live="polite"></span></div>
<div class="field"><label for="password">Password</label><div class="pw-wrap"><input id="password" name="password" type="password" autocomplete="new-password" required minlength="8" aria-describedby="password-err pw-hint" /><button type="button" class="pw-toggle" data-pw-toggle aria-label="Show password"><svg data-eye width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg><svg data-eye-off width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" hidden aria-hidden="true" focusable="false"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg></button></div>
  <div class="pw-meter" id="pwMeter" hidden><div class="pw-meter-track"><div class="pw-meter-bar"></div></div><div class="pw-meter-label" data-pw-strength aria-live="polite"></div></div>
  <span class="field-err" id="password-err" data-field-err="password" role="alert" aria-live="polite"></span>
  <ul class="pw-reqs" id="pwReqs" aria-label="Password requirements">
    <li data-req="len" class="pw-req">At least 8 characters</li>
    <li data-req="case" class="pw-req">Upper &amp; lower case</li>
    <li data-req="num" class="pw-req">A number</li>
    <li data-req="special" class="pw-req">A symbol</li>
  </ul>
  <span class="sr-only" id="pw-hint">Use at least 8 characters, upper and lower case letters, a number and a symbol.</span></div>
  <div class="err" id="err" role="alert" aria-live="assertive"></div><button class="btn btn--accent w-full" type="submit" id="submit">Create account</button></form>
<p class="auth-entry-alternate">Already have an account? <a href="/login" data-auth-switch>Sign in</a></p>
<div class="auth-viewer-entry"><span>Joining a creator’s community?</span><a href="/me">Continue as a viewer <span aria-hidden="true">→</span></a></div>`,
});
