import { brandMarkSvg } from "@yourrank/shared/brand-assets";
import { leaderboardPageHtml } from "@yourrank/shared/page-shell";

export const viewerDashboardPage = leaderboardPageHtml({
  title: "My communities · YourRank",
  canonical: "https://yourrank.site/me",
  bodyClass: "viewer-account-page",
  mainClass: "wrap cr-wrap vd-account-shell",
  nav: false,
  scripts: [
    '<script src="/assets/viewer-dashboard.js?v=3" type="module"></script>',
  ],
  content: `
<header class="gm-shell-nav"><div class="gm-shell-inner">
  <a class="gm-brand" href="/"><span class="gm-brand-mark">${brandMarkSvg()}</span><span class="gm-brand-word">YourRank</span></a>
</div></header>

  <div id="vd-loading" class="ui-loading" role="status" aria-live="polite" aria-busy="true" hidden><div class="ui-loading__spinner" aria-hidden="true"></div><span class="sr-only">Loading your communities…</span></div>
  <div class="vd-head">
    <h1 class="vd-h1" id="vd-title">My communities</h1>
    <p class="vd-sub">One Viewer Account for every creator community you join. Each membership keeps its own Rewards, free credits and Claims.</p>
  </div>

  <section class="card" id="vd-login-card">
    <h2>Sign in to your Viewer Account</h2>
    <p class="card-sub">Use the same provider account you use in creator communities.</p>
    <div class="vd-login-actions">
      <a class="btn btn--accent" id="vd-login-kick" href="/api/viewer/auth/kick">Log in with Kick</a>
      <a class="btn" id="vd-login-discord" href="/api/viewer/auth/discord">Log in with Discord</a>
    </div>
    <p class="status" id="vd-login-status" role="status" aria-live="polite"></p>
  </section>

  <section class="vd-identity-card" id="vd-profile" hidden>
    <div class="vd-profile-head">
      <img id="vd-avatar" class="vd-avatar" alt="" hidden />
      <span id="vd-avatar-fallback" class="vd-avatar-fallback" aria-hidden="true">M</span>
      <div class="vd-profile-txt">
        <h2>Viewer Account</h2>
        <p class="vd-account-name" id="vd-username">Member</p>
        <p class="card-sub" id="vd-identity">Loading connected account…</p>
      </div>
      <div class="vd-profile-actions" id="vd-wrong-account" hidden>
        <button class="btn btn--ghost btn--sm" id="vd-switch" type="button">Use a different login</button>
        <button class="btn btn--sm" id="vd-logout" type="button">Sign out</button>
      </div>
    </div>
    <p class="status" id="vd-account-status" role="status" aria-live="polite" tabindex="-1"></p>
  </section>

  <section class="vd-sec" id="vd-communities-card" hidden>
    <h2 id="vd-communities-heading" tabindex="-1">Community memberships</h2>
    <p class="card-sub">Open a creator's community to see that membership's Rewards, credits and Claims.</p>
    <p class="status" id="vd-communities-status" role="status" aria-live="polite" tabindex="-1"></p>
    <div id="vd-communities" class="vd-community-list"></div>
    <div class="empty vd-community-empty" id="vd-communities-empty" hidden>
      <p>You haven't joined any communities yet.</p>
      <p class="hint">Communities appear here after you choose to join them.</p>
    </div>
  </section>
`,
});
