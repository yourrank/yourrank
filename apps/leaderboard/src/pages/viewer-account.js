// Global Viewer Account pages — /me and /me/{profile,connections,notifications,privacy,data}.
//
// One shell (YourRank-branded rail + quiet top bar) for every account page;
// each page renders its own truthful frame server-side and the client hydrates
// identity from /api/viewer/me. Nothing here invents viewer state — signed-out
// visitors get the real sign-in path, and surfaces the backend cannot answer
// (notification preferences, account deletion) say so plainly instead of
// faking controls.
import { viewerAccountChrome, viewerHelpHref, VIEWER_DESIGN_CONTRACT } from "@yourrank/shared/viewer-shell";

const VIEWER_FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com" />' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />' +
  '<link href="https://fonts.googleapis.com/css2?family=Fira+Sans:wght@400;500;600;700;800&family=Fira+Code:wght@500;700&display=swap" rel="stylesheet" />';

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

const loginCard = `<section class="viewer-card viewer-gate" id="va-login-card" tabindex="-1" hidden>
<div class="viewer-gate-copy"><h2>Your account, one sign-in.</h2>
<p class="viewer-muted">Sign in to your Viewer Account with the provider you use in creator communities. One account — separate memberships, rewards and credit balances.</p></div>
<div class="viewer-gate-actions">
<div class="viewer-gate-oauths">
  <a class="yr-btn" id="va-login-kick" href="/api/viewer/auth/kick?returnTo=${encodeURIComponent("/me")}">Log in with Kick</a>
  <a class="yr-btn yr-btn--ghost" id="va-login-discord" href="/api/viewer/auth/discord?returnTo=${encodeURIComponent("/me")}">Log in with Discord</a>
</div>
<p class="viewer-inline-status" id="va-login-status" role="status" aria-live="polite"></p>
</div>
</section>`;

const loading = `<div class="va-loading" data-va-loading role="status" aria-live="polite"><span class="viewer-spinner" aria-hidden="true"></span><p>Loading your account…</p></div>`;

const PAGES = {
  communities: {
    title: "My communities · YourRank",
    heading: "My communities",
    sub: "Every community you joined — rewards and credits stay with each one.",
    body: `
<div class="va-stat-grid" data-va-stats hidden>
<div class="viewer-stat"><div><p class="viewer-stat-num" data-va-stat="communities">0</p><p class="viewer-stat-label">Communities</p></div></div>
<div class="viewer-stat"><div><p class="viewer-stat-num" data-va-stat="credits">0</p><p class="viewer-stat-label">Total credits</p></div></div>
<div class="viewer-stat"><div><p class="viewer-stat-num" data-va-stat="claims">0</p><p class="viewer-stat-label">Pending claims</p></div></div>
</div>
<section class="viewer-card" data-va-card="communities" hidden>
<header class="viewer-card-head"><h2 class="viewer-card-title">Your communities</h2><span class="viewer-card-meta" data-va-count></span></header>
<div class="va-community-list" data-va-list="communities"></div>
<div class="va-empty" data-va-empty="communities" hidden><h3>You haven't joined any communities yet.</h3><p>Visit a creator's YourRank site and choose Join community. Your membership will be waiting here.</p></div>
</section>
<section class="viewer-card" data-va-card="find" hidden>
<header class="viewer-card-head"><h2 class="viewer-card-title">Open a community</h2></header>
<p class="viewer-muted" id="va-community-hint">Enter a creator's handle or YourRank community link.</p>
<form class="va-community-entry" data-va-open-community>
<div class="va-entry-controls">
<input id="va-community-name" type="text" required maxlength="256" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Creator name or yourrank.site/community" aria-describedby="va-community-hint va-community-status" />
<button class="yr-btn" type="submit">Open community</button>
</div>
<p class="viewer-inline-status" id="va-community-status" role="status" aria-live="polite"></p>
</form>
</section>`,
  },
  profile: {
    title: "Profile · YourRank",
    heading: "Profile",
    sub: "Manage your basic YourRank identity.",
    body: `
<section class="viewer-card va-profile" data-va-card="profile" hidden>
<div class="va-row">
<div class="va-row-copy"><b class="va-row-name">Profile Picture</b><p>This image is shown in your communities and across YourRank.</p></div>
<div class="va-row-side"><span class="va-avatar" data-va-avatar aria-hidden="true">V</span></div>
</div>
<div class="va-row">
<div class="va-row-copy"><b class="va-row-name">Display Name</b><p>This is how others see you on YourRank.</p></div>
<div class="va-row-side"><span class="va-field" data-va-field="displayName">—</span></div>
</div>
<div class="va-row">
<div class="va-row-copy"><b class="va-row-name">Username</b><p>Your unique identifier on YourRank.</p></div>
<div class="va-row-side"><span class="va-field va-field--locked" data-va-field="username">—</span><p class="va-field-note">Your username comes from your connected account.</p></div>
</div>
<div class="va-row">
<div class="va-row-copy"><b class="va-row-name">Member since</b><p>When your viewer account was created.</p></div>
<div class="va-row-side"><span class="va-field" data-va-field="memberSince">—</span></div>
</div>
<footer class="viewer-card-foot"><p class="viewer-muted">Your name and picture come from your connected sign-in account — update them on the provider, then reconnect.</p></footer>
</section>
<section class="viewer-card" data-va-card="identity" hidden>
<header class="viewer-card-head"><h2 class="viewer-card-title">Community identity</h2></header>
<p class="viewer-muted">Per-community details — your credits, reward claims and activity — stay with each creator's community and are managed on their site.</p>
<footer class="viewer-card-foot"><a class="yr-btn yr-btn--sm" href="/me/connections">Manage connected accounts</a></footer>
</section>`,
  },
  connections: {
    title: "Connected accounts · YourRank",
    heading: "Connected accounts",
    sub: "Connect your accounts to verify your activity and participate in communities.",
    body: `
<div class="va-grid-2">
<div class="va-col">
<section class="viewer-card" data-va-card="connections" hidden>
<div class="va-conn-list" data-va-list="connections"></div>
</section>
<section class="viewer-card va-callout" data-va-card="safe" hidden>
<span class="va-callout-ico" aria-hidden="true"><svg class="viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg></span>
<div><b>Your data is safe</b><p class="viewer-muted">We only access the information needed to verify your activity. We never post or make changes to your accounts.</p><a class="viewer-text-link" href="/privacy">Learn more</a></div>
</section>
</div>
<aside class="va-side">
<section class="viewer-card va-connect" data-va-card="connect" hidden>
<header class="viewer-card-head"><h2 class="viewer-card-title" data-va-connect-title>Connect</h2></header>
<p class="viewer-muted" data-va-connect-sub></p>
<div class="va-benefits"><b>What you'll get</b><ul class="va-benefits-list">
<li>Verify your activity in communities</li>
<li>Unlock community-specific rewards</li>
<li>Appear on leaderboards</li>
</ul></div>
<a class="yr-btn" href="#" data-va-connect-btn>Connect</a>
<p class="va-note-small">You'll be redirected to authorize YourRank.</p>
<div class="va-access"><b>We access (read-only)</b><ul class="va-access-list">
<li>Your user ID and profile name</li>
<li>Follows, to verify community participation</li>
<li>Chat activity, to verify engagement</li>
</ul><p class="viewer-muted">We never post, stream, or make changes to your account.</p></div>
</section>
</aside>
</div>`,
  },
  notifications: {
    title: "Notifications · YourRank",
    heading: "Notifications",
    sub: "Choose what you want to be notified about and how you want to receive notifications.",
    body: `
<div class="va-grid-2">
<div class="va-col">
<section class="viewer-card" data-va-card="channels" hidden>
<header class="viewer-card-head"><div><h2 class="viewer-card-title">Notification Channels</h2><p class="viewer-card-sub">Choose how you want to receive notifications.</p></div></header>
<div class="va-pref-list">
<div class="va-pref"><span class="va-pref-ico" aria-hidden="true"><svg class="viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg></span><span class="va-pref-main"><b>Email</b><small>Receive important updates via email.</small></span><span class="va-chip va-chip--mute">Coming soon</span></div>
<div class="va-pref"><span class="va-pref-ico" aria-hidden="true"><svg class="viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8"/></svg></span><span class="va-pref-main"><b>In-app</b><small>Receive notifications inside YourRank.</small></span><span class="va-chip va-chip--mute">Coming soon</span></div>
<div class="va-pref"><span class="va-pref-ico" aria-hidden="true"><svg class="viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17h2"/></svg></span><span class="va-pref-main"><b>Push (Browser)</b><small>Receive push notifications in your browser.</small></span><span data-va-push-toggle></span></div>
</div>
</section>
<section class="viewer-card" data-va-card="types" hidden>
<header class="viewer-card-head"><div><h2 class="viewer-card-title">Notification Types</h2><p class="viewer-card-sub">Manage the types of notifications you receive.</p></div><span class="va-chip va-chip--mute">Coming soon</span></header>
<div class="va-pref-list">
<div class="va-pref"><span class="va-pref-ico" aria-hidden="true"><svg class="viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.4"/><path d="M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7"/></svg></span><span class="va-pref-main"><b>Streamer live notifications</b><small>Get notified when streamers you follow go live.</small></span><span class="va-chip va-chip--mute">Soon</span></div>
<div class="va-pref"><span class="va-pref-ico" aria-hidden="true"><svg class="viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg></span><span class="va-pref-main"><b>Community announcements</b><small>Important updates from the communities you joined.</small></span><span class="va-chip va-chip--mute">Soon</span></div>
<div class="va-pref"><span class="va-pref-ico" aria-hidden="true"><svg class="viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg></span><span class="va-pref-main"><b>Rank and rewards</b><small>Rank changes, rewards and achievements.</small></span><span class="va-chip va-chip--mute">Soon</span></div>
<div class="va-pref"><span class="va-pref-ico" aria-hidden="true"><svg class="viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H4l2.5-2.9A8 8 0 1 1 21 12z"/></svg></span><span class="va-pref-main"><b>Mentions and interactions</b><small>When someone mentions you or replies to you.</small></span><span class="va-chip va-chip--mute">Soon</span></div>
</div>
</section>
</div>
<aside class="va-side">
<section class="viewer-card" data-va-card="examples" hidden>
<header class="viewer-card-head"><div><h2 class="viewer-card-title">Example Notifications</h2><p class="viewer-card-sub">Here are examples of what you'll receive.</p></div></header>
<div class="va-pref-list va-pref-list--examples">
<div class="va-pref"><span class="va-pref-ico va-pref-ico--live" aria-hidden="true"></span><span class="va-pref-main"><b>Streamer is live!</b><small>Come join the stream.</small></span><small class="va-pref-time">2m ago</small></div>
<div class="va-pref"><span class="va-pref-ico" aria-hidden="true"><svg class="viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="12" rx="1.5"/><path d="M12 8v12M3 13h18M12 8s-1.5-4-3.5-4a2 2 0 0 0 0 4zM12 8s1.5-4 3.5-4a2 2 0 0 1 0 4z"/></svg></span><span class="va-pref-main"><b>You earned a reward</b><small>Your claim was fulfilled.</small></span><small class="va-pref-time">1h ago</small></div>
<div class="va-pref"><span class="va-pref-ico" aria-hidden="true"><svg class="viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H4l2.5-2.9A8 8 0 1 1 21 12z"/></svg></span><span class="va-pref-main"><b>Quest completed</b><small>Credits landed in your balance.</small></span><small class="va-pref-time">3h ago</small></div>
</div>
</section>
<section class="viewer-card va-callout" data-va-card="notif-help" hidden>
<span class="va-callout-ico" aria-hidden="true"><svg class="viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.4 9.4a2.7 2.7 0 0 1 5.3.8c0 1.8-2.7 2.2-2.7 3.8M12 17.6h.01"/></svg></span>
<div><b>Still not receiving notifications?</b><p class="viewer-muted">Check our Help Center for troubleshooting tips or contact support.</p><a class="yr-btn yr-btn--ghost yr-btn--sm" href="${viewerHelpHref("/me/notifications").replaceAll("&", "&amp;")}">Visit Help Center</a></div>
</section>
</aside>
</div>`,
  },
  privacy: {
    title: "Privacy & security · YourRank",
    heading: "Privacy & Security",
    sub: "Manage sign-in security, sessions, and privacy controls.",
    body: `
<section class="viewer-card" data-va-card="signin" hidden>
<header class="viewer-card-head"><div><h2 class="viewer-card-title">Authentication</h2><p class="viewer-card-sub">Manage how you sign in to YourRank.</p></div><a class="viewer-card-link" href="/me/connections">Manage</a></header>
<div class="va-conn-list va-conn-list--compact" data-va-list="signin"></div>
</section>
<section class="viewer-card" data-va-card="sessions" hidden>
<header class="viewer-card-head"><div><h2 class="viewer-card-title">Active Sessions</h2><p class="viewer-card-sub">These are the devices and browsers currently signed in to your account.</p></div></header>
<div class="va-session-list" data-va-list="sessions"></div>
<footer class="viewer-card-foot"><button class="yr-btn yr-btn--ghost yr-btn--sm" type="button" data-viewer-logout>Log out of this device</button></footer>
</section>
<section class="viewer-card" data-va-card="data-note" hidden>
<header class="viewer-card-head"><div><h2 class="viewer-card-title">Privacy</h2><p class="viewer-card-sub">What communities can see and what we keep.</p></div></header>
<div class="va-info-rows">
<div class="va-info-row"><b>What communities see</b><p>Your viewer name, picture, credit balance, claims and activity — inside that community only.</p></div>
<div class="va-info-row"><b>What we keep</b><p>Your connected sign-ins, memberships, credit activity and sessions. Export them anytime from Data &amp; account.</p></div>
</div>
<footer class="viewer-card-foot"><a class="yr-btn yr-btn--sm" href="/me/data">Data &amp; account</a></footer>
</section>`,
  },
  data: {
    title: "Data & account · YourRank",
    heading: "Data & Account",
    sub: "Export what's yours, or ask for it to be deleted.",
    body: `
<section class="viewer-card" data-va-card="account-info" hidden>
<header class="viewer-card-head"><div><h2 class="viewer-card-title">Account Information</h2></div></header>
<div class="va-info-rows" data-va-list="account-info"></div>
</section>
<section class="viewer-card" data-va-card="export" hidden>
<header class="viewer-card-head"><div><h2 class="viewer-card-title">Export Your Data</h2><p class="viewer-card-sub">Get a copy of everything your Viewer Account holds.</p></div></header>
<div class="va-benefits"><b>What's included</b><ul class="va-benefits-list">
<li>Your profile and connected sign-ins</li>
<li>Memberships, credit balances and activity</li>
<li>Claims and participation records</li>
</ul></div>
<div class="va-export-controls">
<button class="yr-btn" type="button" data-va-export>Request Data Export</button>
<span class="viewer-inline-status" data-va-export-status role="status" aria-live="polite"></span>
</div>
</section>
<section class="viewer-card va-danger" data-va-card="deletion" hidden>
<header class="viewer-card-head"><div><h2 class="viewer-card-title">Delete Account</h2></div><span class="va-chip va-chip--danger">Danger zone</span></header>
<p class="viewer-muted">Account deletion removes your viewer profile, memberships, credit balances and activity history. Export first if you want a copy.</p>
<p class="viewer-muted">To request deletion, contact support from the Help page and mention your viewer account. We verify the request against your connected sign-ins.</p>
<footer class="viewer-card-foot"><a class="yr-btn yr-btn--ghost yr-btn--sm va-danger-btn" href="${viewerHelpHref("/me/data").replaceAll("&", "&amp;")}">Contact support</a></footer>
</section>`,
  },
};

export function viewerAccountPage(page = "communities", { nonce = "", csrfToken = "", community = "" } = {}) {
  const config = PAGES[page] || PAGES.communities;
  const communitySlug = /^[a-z0-9][a-z0-9_-]{0,62}$/.test(community) ? community : "";
  const chrome = viewerAccountChrome({
    active: page,
    // A community the viewer came from stays one click away — as an explicit
    // back link inside the account rail, not a swapped community rail.
    backHref: communitySlug ? `/${communitySlug}` : "",
    backLabel: communitySlug ? `Back to ${communitySlug}` : "",
  });
  const content = `
<div class="viewer-layout" data-viewer-shell="account">
${chrome.rail}
<div class="viewer-body">
${chrome.topbar}
<main class="viewer-main" id="main-content">
<p class="viewer-crumb"><a class="viewer-crumb-home" href="/me">Settings</a><span class="viewer-crumb-sep" aria-hidden="true">›</span><span>${esc(config.heading)}</span></p>
<header class="viewer-page-head viewer-page-head--account">
<div class="viewer-page-copy"><h1 class="viewer-h1">${config.heading}</h1><p class="viewer-sub">${config.sub}</p></div>
</header>
${loginCard}
${loading}
<div data-va-page="${page}">${config.body}</div>
</main>
<footer class="viewer-site-footer"><div class="yr-foot"><p class="yr-fine">YourRank viewer account — communities keep their own rewards and credits.</p><div class="yr-foot-links"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="${viewerHelpHref("/me").replaceAll("&", "&amp;")}">Contact support</a></div></div></footer>
</div>
</div>`;

  const csrf = csrfToken ? `<meta name="csrf-token" content="${esc(csrfToken)}" />` : "";
  const path = page === "communities" ? "/me" : `/me/${page}`;
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(config.title)}</title>
<meta name="robots" content="noindex, nofollow" /><link rel="canonical" href="https://yourrank.site${esc(path)}" />
${VIEWER_FONTS}
<link rel="stylesheet" href="/assets/site-shell.css" />
<link rel="stylesheet" href="/assets/viewer-shell.css" />
${csrf}
</head><body class="yr-site viewer-shell" data-viewer-shell="account">
${VIEWER_DESIGN_CONTRACT}
<noscript><div class="noscript-msg"><p>YourRank requires JavaScript</p><p>Your viewer account loads with JavaScript. Enable it to see your communities and settings.</p></div></noscript>
<a class="yr-sr" href="#main-content">Skip to content</a>
${content}
<script src="/assets/viewer-app.js"${nonce ? ` nonce="${esc(nonce)}"` : ""} defer></script>
</body></html>`;
}
