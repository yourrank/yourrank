/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

export function LoginPage() {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Sign in · YourRank suite</title>
        <meta name="robots" content="noindex, nofollow" />
        <link rel="canonical" href="https://yourrank.site/login" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/assets/app.css" /><link rel="stylesheet" href="/assets/ui.css" /><link rel="stylesheet" href="/assets/devin-system.css" />
      </head>
      <body>
        <a href="#main-content" class="sr-only skip-link">Skip to content</a>
        <div class="auth-wrap">
          <aside class="auth-side">
            <div><div class="brand">Your<b>Rank</b></div></div>
            <div>
              <h2>Your streamer suite, hosted and handled.</h2>
              <p>Leaderboards, Telegram bot, and viewer rewards &amp; shop — all from one dashboard. No code, no redeploys.</p>
              <div class="auth-spec" aria-hidden="true">
                <div class="auth-spec-h"><span>your-suite.config</span><span class="dot">● live</span></div>
                <div class="auth-spec-row"><span>Leaderboards</span><span>included</span></div>
                <div class="auth-spec-row"><span>Telegram bot</span><span>turn on</span></div>
                <div class="auth-spec-row"><span>Rewards &amp; Shop</span><span>Kick connected</span></div>
                <div class="auth-spec-row"><span>Updates</span><span>instant</span></div>
              </div>
            </div>
            <div class="feat">
              <div>— Branded leaderboards for your community</div>
              <div>— Tracked offers and broadcasts in Telegram</div>
              <div>— Viewer credits powered by Kick channel points</div>
            </div>
          </aside>
          <main class="auth-main" id="main-content">
            <div class="auth-card" id="auth-card">
              <a href="/" class="auth-brand-m">Your<b>Rank</b></a>
              <h1 id="auth-title">Sign in</h1><p class="sub" id="auth-sub">Welcome back.</p>
              <div class="plan-banner" id="viewerBanner" hidden role="status">Sign in with the account you use in creator communities. After signing in you go back to the community you came from.</div>
              <form id="form" method="POST" action="/api/auth/login" novalidate>
                <div class="field">
                  <label for="email">Email</label>
                  <input id="email" name="email" type="email" autocomplete="email" required aria-describedby="email-err" />
                  <span class="field-err" id="email-err" data-field-err="email" role="alert" aria-live="polite"></span>
                </div>
                <div class="field">
                  <label for="password">Password</label>
                  <div class="pw-wrap">
                    <input id="password" name="password" type="password" autocomplete="current-password" required aria-describedby="password-err" />
                    <button type="button" class="pw-toggle" data-pw-toggle aria-label="Show password">
                      <svg data-eye width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      <svg data-eye-off width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" hidden aria-hidden="true" focusable="false">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    </button>
                  </div>
                  <span class="field-err" id="password-err" data-field-err="password" role="alert" aria-live="polite"></span>
                </div>
                <div class="err" id="err" role="alert" aria-live="assertive"></div>
                <button class="btn btn--accent w-full" type="submit" id="submit">Sign in</button>
              </form>
              <p class="foot">No account? <a href="/signup">Create one</a> · <a href="/forgot">Forgot password?</a><span class="foot-sep" id="viewer-foot">Are you a viewer? <a href="/me">Log in with Kick or Discord</a></span></p>
            </div>
          </main>
        </div>
        <script src="/assets/auth.js?v=2"></script>
      </body>
    </html>
  );
}

export const loginPage = { Component: LoginPage };
