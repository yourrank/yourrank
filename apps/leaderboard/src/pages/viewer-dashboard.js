import { brandMarkSvg } from "@yourrank/shared/brand-assets";
import { leaderboardPageHtml } from "@yourrank/shared/page-shell";

export const viewerDashboardPage = leaderboardPageHtml({
  title: "My credits · YourRank",
  canonical: "https://yourrank.site/me",
  mainClass: "wrap cr-wrap",
  nav: false,
  scripts: ['<script src="/assets/viewer-dashboard.js?v=1" type="module"></script>'],
  content: `
<header class="gm-shell-nav"><div class="gm-shell-inner">
  <a class="gm-brand" href="/"><span class="gm-brand-mark">${brandMarkSvg()}</span><span class="gm-brand-word">YourRank</span></a>
  <nav id="vd-nav" aria-label="Viewer"></nav>
</div></header>

<main class="wrap cr-wrap" id="main-content">
  <div id="vd-loading" class="ui-loading" hidden><div class="ui-loading__spinner"></div></div>
  <div class="an-head">
    <div>
      <div class="an-eyebrow">Viewer dashboard</div>
      <h1 class="an-title" id="vd-title">My credits</h1>
      <p class="an-sub">See your credits across all streamer sites and order items.</p>
    </div>
  </div>

  <section class="card" id="vd-login-card">
    <h2>Log in to YourRank</h2>
    <p class="card-sub">Connect the account you use to earn channel points.</p>
    <div class="vd-login-actions">
      <a class="btn btn--accent" id="vd-login-kick" href="/api/viewer/auth/kick">Log in with Kick</a>
      <a class="btn" id="vd-login-discord" href="/api/viewer/auth/discord">Log in with Discord</a>
    </div>
    <p class="status" id="vd-login-status" role="status" aria-live="polite"></p>
  </section>

  <section class="card" id="vd-profile" hidden>
    <div class="vd-profile-head">
      <img id="vd-avatar" class="vd-avatar" src="" alt="" hidden />
      <div>
        <h2 id="vd-username">Viewer</h2>
        <p class="card-sub" id="vd-identity">Loading identity…</p>
      </div>
      <div class="vd-profile-actions">
        <button class="btn btn--sm" id="vd-logout" type="button">Sign out</button>
      </div>
    </div>
    <p class="hint" id="vd-wrong-account" hidden>Wrong account? <button class="btn btn--ghost btn--sm" id="vd-switch" type="button">Use a different login</button></p>
  </section>

  <section class="card" id="vd-boards-card" hidden>
    <h2>Your sites</h2>
    <p class="card-sub">Each card shows your credits for a streamer's site. Select one to view rewards and your orders.</p>
    <div id="vd-boards"></div>
    <p class="empty" id="vd-boards-empty" hidden>You don't have credits on any site yet. Redeem a Kick channel reward covered by a way to earn to earn some.</p>
  </section>

  <section class="card" id="vd-site-card" hidden>
    <div class="vd-site-head">
      <div>
        <h2 id="vd-site-name">Site</h2>
        <p class="card-sub" id="vd-site-streamer">Streamer site</p>
      </div>
      <button class="btn btn--sm" id="vd-back" type="button">Back to sites</button>
    </div>
    <p class="card-sub">Balance: <b id="vd-site-balance">0</b> credits</p>
    <p class="hint" id="vd-earn-hint">Earn credits by redeeming the streamer's Kick channel rewards covered by ways to earn during a live stream.</p>

    <h3>Rewards</h3>
    <div id="vd-shop-list"></div>
    <p class="empty" id="vd-shop-empty" hidden>No items available.</p>

    <h3 class="mt-24">Your orders</h3>
    <div id="vd-redemptions-list"></div>
    <p class="empty" id="vd-redemptions-empty" hidden>No orders yet. Place an order from Rewards to see it here.</p>
    <p class="hint"><b>Pending</b> = waiting for the streamer; <b>Fulfilled</b> = approved; <b>Cancelled</b> = refunded.</p>
  </section>
</main>
`,
});
