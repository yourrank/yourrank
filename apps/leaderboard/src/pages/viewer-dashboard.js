import { brandMarkSvg } from "@yourrank/shared/brand-assets";
import { leaderboardPageHtml } from "@yourrank/shared/page-shell";

export const viewerDashboardPage = leaderboardPageHtml({
  title: "Your sites & account · YourRank",
  canonical: "https://yourrank.site/me",
  mainClass: "wrap cr-wrap",
  nav: false,
  // dialog.js first: both are deferred and run in order, so window.YRDialog
  // exists before the viewer client asks for a confirmation.
  scripts: [
    '<script src="/assets/dialog.js" defer></script>',
    '<script src="/assets/viewer-dashboard.js?v=2" type="module"></script>',
  ],
  content: `
<header class="gm-shell-nav"><div class="gm-shell-inner">
  <a class="gm-brand" href="/"><span class="gm-brand-mark">${brandMarkSvg()}</span><span class="gm-brand-word">YourRank</span></a>
</div></header>

  <div id="vd-loading" class="ui-loading" hidden><div class="ui-loading__spinner"></div></div>
  <div class="vd-head">
    <h1 class="vd-h1" id="vd-title">Your account</h1>
    <p class="vd-sub">Your YourRank login and your free credits on every creator you've joined. Credits are loyalty points: no purchase, no cash value, no cashout.</p>
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

  <section class="vd-identity-card" id="vd-profile" hidden>
    <div class="vd-profile-head">
      <img id="vd-avatar" class="vd-avatar" src="" alt="" hidden />
      <div class="vd-profile-txt">
        <h2 id="vd-username">Member</h2>
        <p class="card-sub" id="vd-identity">Loading identity…</p>
      </div>
      <div class="vd-profile-actions">
        <button class="btn btn--sm" id="vd-logout" type="button">Sign out</button>
      </div>
    </div>
    <p class="hint" id="vd-wrong-account" hidden>Wrong account? <button class="btn btn--ghost btn--sm" id="vd-switch" type="button">Use a different login</button></p>
    <p class="status" id="vd-account-status" role="status" aria-live="polite" tabindex="-1"></p>
  </section>

  <section class="vd-sec" id="vd-boards-card" hidden>
    <h2 id="vd-boards-heading" tabindex="-1">Your sites</h2>
    <p class="card-sub">One row per creator, with the free credits you hold there.</p>
    <p class="status" id="vd-boards-status" role="status" aria-live="polite" tabindex="-1"></p>
    <div id="vd-boards"></div>
    <p class="empty" id="vd-boards-empty" hidden>You don't have credits on any site yet. Use one of the streamer's linked Kick rewards to earn credits.</p>
  </section>

  <section class="vd-sec" id="vd-site-card" hidden>
    <button class="btn btn--ghost btn--sm" id="vd-back" type="button">Back to your sites</button>
    <div class="vd-site-head">
      <div>
        <h2 id="vd-site-name" tabindex="-1">Site</h2>
        <p class="card-sub" id="vd-site-streamer">Streamer site</p>
      </div>
      <a class="btn btn--sm" id="vd-site-visit" href="/" hidden>Visit site</a>
    </div>
    <p class="vd-balance"><b id="vd-site-balance">0</b> free credits here</p>
    <p class="status" id="vd-site-status" role="status" aria-live="polite" tabindex="-1"></p>
    <p class="hint" id="vd-earn-hint">Earn credits by using the streamer's linked Kick rewards during a live stream.</p>

    <h3>Rewards</h3>
    <div id="vd-shop-list"></div>
    <p class="empty" id="vd-shop-empty" hidden>No items available.</p>

    <h3 class="mt-24">Your orders</h3>
    <div id="vd-redemptions-list"></div>
    <p class="empty" id="vd-redemptions-empty" hidden>No orders yet. Place an order from Rewards to see it here.</p>
    <p class="hint">Pending means the creator hasn't handed it over yet. Fulfilled means they have. Cancelled and refunded both mean the credits went back to your balance.</p>

    <h3 class="mt-24">Live events</h3>
    <p class="status" id="vd-events-status" role="status" aria-live="polite"></p>
    <div id="vd-drop-claim" class="vd-card-row" hidden>
      <div class="vd-card-main">
        <div class="vd-card-title">Claim a drop code</div>
        <div class="hint">Enter a code from the streamer to earn credits.</div>
        <p class="status" id="vd-drop-status" role="status" aria-live="polite"></p>
      </div>
      <div class="vd-card-side">
        <input type="text" id="vd-drop-code" class="vd-drop-code" placeholder="CODE" aria-label="Drop code" />
        <button class="btn btn--sm" id="vd-drop-claim-btn" type="button">Claim</button>
      </div>
    </div>
    <div id="vd-raffles"></div>
    <div id="vd-predictions"></div>
    <p class="empty" id="vd-events-empty" hidden>No live events right now.</p>
  </section>
`,
});
