import { viewerNavigation, viewerHelpHref, VIEWER_DESIGN_CONTRACT } from "@yourrank/shared/viewer-shell";
import { leaderboardPageHtml } from "@yourrank/shared/page-shell";

export const viewerDashboardPage = leaderboardPageHtml({
  title: "My communities · YourRank",
  canonical: "https://yourrank.site/me",
  bodyClass: "yr-site viewer-shell viewer-account-page",
  mainClass: "viewer-layout",
  nav: false,
  footer: false,
  styles: ["/assets/site-shell.css", "/assets/viewer-shell.css"],
  designContract: VIEWER_DESIGN_CONTRACT,
  scripts: [
    '<script src="/assets/viewer-dashboard.js?v=3" type="module"></script>',
  ],
  content: `
${viewerNavigation()}
<div class="viewer-main">

  <div id="vd-loading" class="ui-loading" role="status" aria-live="polite" aria-busy="true" hidden><div class="ui-loading__spinner" aria-hidden="true"></div><span class="sr-only">Loading your communities…</span></div>
  <div class="vd-head">
    <h1 class="vd-h1" id="vd-title">My communities</h1>
    <p class="vd-sub">Pick up where you left off. Your rewards and claims stay with each community.</p>
  </div>

  <section id="vd-login-card" tabindex="-1">
    <div class="vd-login-copy"><h2>Your communities, together.</h2>
    <p class="card-sub">Sign in to your Viewer Account with the provider you use in creator communities.</p>
    <p class="vd-login-note">One account. Separate memberships, rewards and credit balances.</p></div>
    <div class="vd-login-controls">
    <div class="vd-login-actions">
      <a class="btn btn--accent" id="vd-login-kick" href="/api/viewer/auth/kick">Log in with Kick</a>
      <a class="btn" id="vd-login-discord" href="/api/viewer/auth/discord">Log in with Discord</a>
    </div>
    <p class="status" id="vd-login-status" role="status" aria-live="polite"></p>
    </div>
  </section>

  <div class="vd-layout">
  <section class="vd-sec" id="vd-communities-card" hidden>
    <div class="vd-directory-head"><h2 id="vd-communities-heading" tabindex="-1">Your memberships</h2><span id="vd-membership-count" class="vd-count"></span></div>
    <p class="status" id="vd-communities-status" role="status" aria-live="polite" tabindex="-1"></p>
    <div id="vd-communities" class="vd-community-list"></div>
    <div class="empty vd-community-empty" id="vd-communities-empty" hidden>
      <h3>You haven't joined any communities yet.</h3>
      <p>Visit a creator's YourRank site and choose Join community. Your membership will be waiting here when you come back.</p>
      <form id="vd-open-community" class="vd-community-entry">
        <label for="vd-community-name">Community name</label>
        <p id="vd-community-name-hint">Enter the name after the slash in the creator's YourRank link.</p>
        <div class="vd-community-entry-controls">
          <input id="vd-community-name" type="text" required maxlength="63" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="e.g. atlas-community" aria-describedby="vd-community-name-hint vd-community-entry-status" />
          <button class="btn btn--accent" type="submit">Open community</button>
        </div>
        <p id="vd-community-entry-status" class="status" role="status" aria-live="polite"></p>
      </form>
    </div>
  </section>

  <section class="vd-identity-card" id="vd-profile" tabindex="-1" hidden>
    <div class="vd-profile-head">
      <img id="vd-avatar" class="vd-avatar" alt="" hidden />
      <span id="vd-avatar-fallback" class="vd-avatar-fallback" aria-hidden="true">M</span>
      <div class="vd-profile-txt">
        <h2>Viewer account</h2>
        <p class="vd-account-name" id="vd-username">Member</p>
        <p class="card-sub" id="vd-identity">Loading connected account…</p>
      </div>
    </div>
    <details class="vd-account-actions" id="vd-wrong-account" hidden>
      <summary>Manage your login</summary>
      <div class="vd-profile-actions">
        <button class="btn btn--ghost btn--sm" id="vd-switch" type="button">Use a different login</button>
        <button class="btn btn--sm" id="vd-logout" type="button">Sign out</button>
      </div>
    </details>
    <p class="status" id="vd-account-status" role="status" aria-live="polite" tabindex="-1"></p>
  </section>

  </div>
  <nav class="viewer-legal" aria-label="Legal"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="${viewerHelpHref().replaceAll('&', '&amp;')}">Contact support</a></nav>
</div>
`,
});
