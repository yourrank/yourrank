import { viewerNavigation, viewerIcon, viewerHelpHref, viewerAccountHref, viewerCommunityReturnLink, VIEWER_DESIGN_CONTRACT } from "@yourrank/shared/viewer-shell";
import { leaderboardPageHtml } from "@yourrank/shared/page-shell";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function viewerName(viewer) {
  return viewer?.kick_username || viewer?.discord_username || "Member";
}

function viewerMark(viewer) {
  if (viewer?.avatar_url) return `<img src="${esc(viewer.avatar_url)}" alt="" />`;
  const initial = Array.from(viewerName(viewer).trim())[0]?.toUpperCase() || "Y";
  return esc(initial);
}

/**
 * Server-resolved session state for the account page. `unresolved` means the
 * session could not be checked during render (e.g. a session-store error), so
 * the page renders neither signed-in nor signed-out content until the client
 * resolves it.
 */
export const VIEWER_AUTH_STATES = Object.freeze(["authenticated", "unauthenticated", "unresolved"]);

/**
 * The global Viewer Account page. `community` is the published community the
 * viewer arrived from (`/me?community=<slug>`), so every account destination
 * keeps a way back to it. `auth` is the session state resolved by the Worker so
 * the first paint already matches the viewer's real state: the topbar account
 * control and the main content come from the same source and cannot disagree.
 */
export function viewerDashboardPage(community = null, providerAvailability = { kick: false, discord: false }, auth = { state: "unauthenticated", viewer: null }) {
  const authState = VIEWER_AUTH_STATES.includes(auth?.state) ? auth.state : "unauthenticated";
  const viewer = authState === "authenticated" && auth?.viewer ? auth.viewer : null;
  const signedIn = !!viewer;
  const unauthenticated = authState === "unauthenticated";
  const accountHref = viewerAccountHref(community?.slug || "");
  const helpHref = esc(viewerHelpHref(accountHref));
  const available = {
    kick: providerAvailability?.kick === true,
    discord: providerAvailability?.discord === true,
  };
  const primaryProvider = available.kick ? "kick" : available.discord ? "discord" : "";
  const loginHref = (provider) => esc(`/api/viewer/auth/${provider}${community ? `?returnTo=${encodeURIComponent(accountHref)}` : ""}`);
  return leaderboardPageHtml({
  title: "My communities · YourRank",
  canonical: "https://yourrank.site/me",
  bodyClass: `yr-site viewer-shell viewer-account-page viewer-auth-${authState}`,
  mainClass: "viewer-layout",
  contentOwnsMain: true,
  nav: false,
  footer: false,
  styles: ["/assets/site-shell.css", "/assets/viewer-shell.css"],
  designContract: VIEWER_DESIGN_CONTRACT,
  scripts: [
    '<script src="/assets/viewer-app.js" defer></script>',
  ],
  content: `
${viewerNavigation({ accountHref, community, signedIn, viewerName: signedIn ? viewerName(viewer) : "", viewerMark: signedIn ? viewerMark(viewer) : "", signInHref: unauthenticated ? `${accountHref}#vd-login-card` : "" })}
<main class="viewer-main" id="main-content" tabindex="-1">

  <div id="vd-loading" class="vd-loading" role="status" aria-live="polite" aria-busy="true"${unauthenticated ? " hidden" : ""}><span class="sr-only">${signedIn ? "Loading your communities…" : "Checking your sign-in…"}</span><div class="vd-skeleton" aria-hidden="true"><span></span><span></span><span></span></div></div>
  ${viewerCommunityReturnLink(community, "yr-sec-link vd-return")}
  <div class="vd-head">
    <p class="vd-breadcrumb" id="vd-breadcrumb" hidden>Settings <span aria-hidden="true">›</span> <span id="vd-breadcrumb-current"></span></p>
    <h1 class="vd-h1" id="vd-title" tabindex="-1">My communities</h1>
    <p class="vd-sub" id="vd-subtitle">Choose a community. Your rewards and claims stay with each community.</p>
  </div>

  <section id="vd-login-card" tabindex="-1"${unauthenticated ? "" : " hidden"}>
    <div class="vd-login-copy"><h2>Your communities, together.</h2>
    <p class="card-sub">Sign in to your Viewer Account with the provider you use in creator communities.</p>
    <p class="vd-login-note">One account. Separate memberships, rewards and credit balances.</p></div>
    <div class="vd-login-controls">
    <div class="vd-login-actions">
      ${available.kick ? `<a class="btn${primaryProvider === "kick" ? " btn--accent" : ""}" id="vd-login-kick" href="${loginHref("kick")}">Log in with Kick</a>` : ""}
      ${available.discord ? `<a class="btn${primaryProvider === "discord" ? " btn--accent" : ""}" id="vd-login-discord" href="${loginHref("discord")}">Log in with Discord</a>` : ""}
      ${!primaryProvider ? '<p class="status" role="status">Sign-in is not available right now. Please try again later.</p>' : ""}
    </div>
    <p class="status" id="vd-login-status" role="status" aria-live="polite"></p>
    </div>
  </section>

  <div class="vd-layout">
  <section class="vd-sec" id="vd-communities-card" hidden>
    <div class="vd-directory-head"><h2 id="vd-communities-heading" tabindex="-1">Your memberships</h2><span id="vd-membership-count" class="vd-count"></span></div>
    <p class="status" id="vd-communities-status" role="status" aria-live="polite" tabindex="-1"></p>
    <div id="vd-communities" class="vd-community-list"></div>
    <div class="vd-community-empty" id="vd-communities-empty" hidden>
      <h3>You haven't joined any communities yet.</h3>
      <p>Visit a creator's YourRank site and choose Join community. Your membership will be waiting here when you come back.</p>
    </div>
    <div class="vd-find-community"><h3>Looking for another community?</h3>
      <form id="vd-open-community" class="vd-community-entry">
        <label for="vd-community-name">Community name or link</label>
        <p id="vd-community-name-hint">Find a joined community by name, or enter a creator's handle or YourRank community link.</p>
        <div class="vd-community-entry-controls">
          <input id="vd-community-name" type="text" required maxlength="256" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Creator name or yourrank.site/community" aria-describedby="vd-community-name-hint vd-community-entry-status" />
          <button class="btn btn--accent" type="submit">Open community</button>
        </div>
        <p id="vd-community-entry-status" class="status" role="status" aria-live="polite"></p>
      </form>
    </div>
  </section>

  <section class="vd-settings-card" id="vd-profile" tabindex="-1" hidden>
    <div class="vd-setting-row"><div><h2>Profile Picture</h2><p>Your profile picture comes from your connected provider.</p></div><div class="vd-profile-head"><img id="vd-avatar" class="vd-avatar" alt="" hidden /><span id="vd-avatar-fallback" class="vd-avatar-fallback" aria-hidden="true">M</span><p>Photo uploads aren't available yet.</p></div></div>
    <div class="vd-setting-row"><div><h2>Display Name</h2><p>Your identity across YourRank communities.</p></div><div><p class="vd-readonly" id="vd-username">Member</p><p>Profile editing isn't available yet.</p></div></div>
    <div class="vd-setting-row"><div><h2>Connected Identity</h2><p>Provided by your sign-in account.</p></div><p id="vd-identity">Loading connected account…</p></div>
    <div class="vd-setting-row"><div><h2>Member Since</h2><p>When your YourRank viewer account was created.</p></div><p id="vd-created"></p></div>
    <details class="vd-account-actions" id="vd-wrong-account" hidden>
      <summary>Manage your login</summary>
      <div class="vd-profile-actions">
        <button class="btn btn--ghost btn--sm" id="vd-switch" type="button">Use a different login</button>
        <button class="btn btn--sm" id="vd-logout" type="button">Sign out</button>
      </div>
    </details>
  </section>

  <section id="vd-connections" tabindex="-1" hidden><div class="vd-settings-card"><h2>Connected Accounts</h2><p>Accounts connected to your YourRank identity.</p><div id="vd-provider-list"></div><p class="vd-info">${viewerIcon('shield')}Connecting or disconnecting providers from settings isn't available yet. Signing in with a different provider may open a separate viewer account.</p></div></section>
  <section id="vd-notifications" tabindex="-1" hidden><div class="vd-settings-card"><h2>Notification Preferences</h2><p>Notification channels, frequency, and preference controls aren't available for viewer accounts yet.</p><p>Your credit activity and reward claim updates are available inside each community.</p><a class="btn" href="${esc(accountHref)}">My Communities ${viewerIcon('arrow')}</a></div></section>
  <section id="vd-security" tabindex="-1" hidden><div class="vd-settings-card"><h2>Authentication</h2><p>Your connected provider manages your sign-in credentials.</p><div id="vd-security-providers"></div><p class="vd-info">Two-factor authentication and active-session management aren't available in YourRank viewer settings. Manage sign-in security with your provider.</p></div><div class="vd-settings-card"><h2>Privacy</h2><p>Your account identifies you across communities. Credits, claims, and participation remain attached to each community.</p><p>Viewer privacy preference controls aren't available yet.</p><a class="btn" href="/privacy">Privacy policy ${viewerIcon('external')}</a></div></section>
  <section id="vd-data" tabindex="-1" hidden><div class="vd-settings-card"><h2>Account Information</h2><p>Your basic YourRank account information.</p><div class="vd-setting-row"><div><h3>Display Name</h3><p id="vd-data-name"></p></div><p>Email management isn't available for viewer accounts.</p></div></div><div class="vd-settings-card"><h2>Export Your Data</h2><p>Download a copy of your YourRank viewer data.</p><div class="vd-export-row"><div><h3>What's included?</h3><p>Your viewer identity, provider connections, community memberships, credits, claims, and supported participation records.</p></div><div><button class="btn btn--accent" id="vd-export" type="button">Request Data Export</button><p>Keep this page open to check the export and download it when ready.</p><button class="btn" id="vd-export-check" type="button" hidden>Check export status</button><a class="btn" id="vd-export-download" hidden>Download data</a><p id="vd-export-status" class="status" role="status" aria-live="polite"></p></div></div></div><div class="vd-settings-card"><h2>Delete Account</h2><p>Self-service viewer account deletion isn't available yet. Contact support for account and data requests.</p><a class="btn" href="${helpHref}">Contact support ${viewerIcon('arrow')}</a></div></section>
  <p class="status" id="vd-account-status" role="status" aria-live="polite" tabindex="-1"></p>
  </div>
  <nav class="viewer-legal" aria-label="Legal"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="${helpHref}">Contact support</a></nav>
</main>
`,
  });
}
