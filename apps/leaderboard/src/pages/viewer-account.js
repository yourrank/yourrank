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
    sub: "Your viewer identity — the name and picture communities see.",
    body: `
<section class="viewer-card va-profile" data-va-card="profile" hidden>
<header class="viewer-card-head"><h2 class="viewer-card-title">Profile</h2><span class="viewer-card-meta">Read-only</span></header>
<div class="va-profile-head">
<span class="va-avatar" data-va-avatar aria-hidden="true">V</span>
<div class="va-profile-txt">
<b class="va-profile-name" data-va-field="displayName">—</b>
<p class="viewer-muted" data-va-field="providers">—</p>
<p class="viewer-muted" data-va-field="memberSince">—</p>
</div>
</div>
</section>
<section class="viewer-card" data-va-card="identity" hidden>
<header class="viewer-card-head"><h2 class="viewer-card-title">Community identity</h2></header>
<p class="viewer-muted">Your viewer name and picture come from your connected sign-in account. Per-community details — your credits, reward claims and activity — stay with each creator's community and are managed on their site.</p>
<footer class="viewer-card-foot"><a class="yr-btn yr-btn--sm" href="/me/connections">Manage connected accounts</a></footer>
</section>`,
  },
  connections: {
    title: "Connected accounts · YourRank",
    heading: "Connected accounts",
    sub: "The providers you use to sign in and link in communities.",
    body: `
<section class="viewer-card" data-va-card="connections" hidden>
<header class="viewer-card-head"><h2 class="viewer-card-title">Connected accounts</h2></header>
<div class="va-conn-list" data-va-list="connections"></div>
<footer class="viewer-card-foot"><p class="viewer-muted">To unlink an account, contact support — keep at least one sign-in connected so you don't lose your communities.</p></footer>
</section>`,
  },
  notifications: {
    title: "Notifications · YourRank",
    heading: "Notifications",
    sub: "How community and account updates reach you.",
    body: `
<section class="viewer-card" data-va-card="notifications" hidden>
<header class="viewer-card-head"><h2 class="viewer-card-title">Notifications</h2><span class="viewer-card-meta va-chip va-chip--mute">Coming soon</span></header>
<p class="viewer-muted">Viewer notification settings aren't part of the Viewer Account yet. There's nothing to configure here today.</p>
<div class="va-info-rows">
<div class="va-info-row"><b>Reward claims</b><p>Claim status updates live in each community's My Activity page.</p></div>
<div class="va-info-row"><b>Community news</b><p>Announcements come from the creator on their own channels — follow them where they stream.</p></div>
<div class="va-info-row"><b>Account &amp; security</b><p>Important account changes are shown here when they happen.</p></div>
</div>
</section>`,
  },
  privacy: {
    title: "Privacy & security · YourRank",
    heading: "Privacy & security",
    sub: "How you sign in, where your sessions are, and what we keep.",
    body: `
<section class="viewer-card" data-va-card="signin" hidden>
<header class="viewer-card-head"><h2 class="viewer-card-title">Sign-in methods</h2><a class="viewer-card-link" href="/me/connections">Manage</a></header>
<div class="va-conn-list va-conn-list--compact" data-va-list="signin"></div>
</section>
<section class="viewer-card" data-va-card="sessions" hidden>
<header class="viewer-card-head"><h2 class="viewer-card-title">Active sessions</h2></header>
<p class="viewer-muted">Each row is a device signed in to your Viewer Account. Signing out ends the session on this device.</p>
<div class="va-session-list" data-va-list="sessions"></div>
<footer class="viewer-card-foot"><button class="yr-btn yr-btn--ghost yr-btn--sm" type="button" data-viewer-logout>Log out of this device</button></footer>
</section>
<section class="viewer-card" data-va-card="data-note" hidden>
<header class="viewer-card-head"><h2 class="viewer-card-title">Your data</h2></header>
<p class="viewer-muted">Your Viewer Account stores your connected sign-ins, your memberships, and your credit activity in each community. You can export it or request deletion from Data &amp; account.</p>
<footer class="viewer-card-foot"><a class="yr-btn yr-btn--sm" href="/me/data">Data &amp; account</a></footer>
</section>`,
  },
  data: {
    title: "Data & account · YourRank",
    heading: "Data & account",
    sub: "Export what's yours, or ask for it to be deleted.",
    body: `
<section class="viewer-card" data-va-card="export" hidden>
<header class="viewer-card-head"><h2 class="viewer-card-title">Export your data</h2></header>
<p class="viewer-muted">Get a copy of everything your Viewer Account holds — your profile, memberships, credit balances and activity — as a downloadable file.</p>
<div class="va-export-controls">
<button class="yr-btn yr-btn--sm" type="button" data-va-export>Export my data</button>
<span class="viewer-inline-status" data-va-export-status role="status" aria-live="polite"></span>
</div>
</section>
<section class="viewer-card" data-va-card="account-info" hidden>
<header class="viewer-card-head"><h2 class="viewer-card-title">Account</h2></header>
<div class="va-info-rows" data-va-list="account-info"></div>
</section>
<section class="viewer-card" data-va-card="deletion" hidden>
<header class="viewer-card-head"><h2 class="viewer-card-title">Delete your data</h2></header>
<p class="viewer-muted">Account deletion removes your viewer profile, memberships, credit balances and activity history. Export first if you want a copy.</p>
<p class="viewer-muted">To request deletion, contact support from the Help page and mention your viewer account. We verify the request against your connected sign-ins.</p>
<footer class="viewer-card-foot"><a class="yr-btn yr-btn--ghost yr-btn--sm" href="${viewerHelpHref("/me/data").replaceAll("&", "&amp;")}">Contact support</a></footer>
</section>`,
  },
};

export function viewerAccountPage(page = "communities", { nonce = "", csrfToken = "", community = "" } = {}) {
  const config = PAGES[page] || PAGES.communities;
  const communitySlug = /^[a-z0-9][a-z0-9_-]{0,62}$/.test(community) ? community : "";
  const chrome = viewerAccountChrome({
    active: page,
    helpHref: viewerHelpHref(page === "communities" ? "/me" : `/me/${page}`),
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
