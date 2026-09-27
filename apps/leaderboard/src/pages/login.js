import { authPage } from "./auth-shell.js";

export const loginPage = authPage({
  title: "Sign in",
  path: "/login",
  content: `<div class="auth-entry-intro"><h1 id="auth-title">Welcome back</h1><p id="auth-sub">Sign in to your YourRank workspace.</p></div>
<div class="plan-banner" id="viewerBanner" hidden="" role="status">Sign in with the account you use in creator communities. After signing in you go back to the community you came from.</div>
<form id="form" method="POST" action="/api/auth/login" novalidate="">
<div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" autocapitalize="none" spellcheck="false" required="" aria-describedby="email-err" /><span class="field-err" id="email-err" data-field-err="email" role="alert" aria-live="polite"></span></div>
<div class="field"><div class="auth-field-heading"><label for="password">Password</label><a href="/forgot">Forgot password?</a></div><div class="pw-wrap"><input id="password" name="password" type="password" autocomplete="current-password" required="" aria-describedby="password-err" /><button type="button" class="pw-toggle" data-pw-toggle="true" aria-label="Show password"><svg data-eye="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg><svg data-eye-off="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" hidden="" aria-hidden="true" focusable="false"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg></button></div><span class="field-err" id="password-err" data-field-err="password" role="alert" aria-live="polite"></span></div>
<div class="err" id="err" role="alert" aria-live="assertive"></div>
<button class="btn btn--accent w-full" type="submit" id="submit">Sign in</button>
</form>
<p class="auth-entry-alternate">New to YourRank? <a href="/signup" data-auth-switch>Create an account</a></p>
<div class="auth-viewer-entry" id="viewer-foot"><span>Here for a creator’s community?</span><a href="/me">Continue as a viewer <span aria-hidden="true">→</span></a></div>`,
});
