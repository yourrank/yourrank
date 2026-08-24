// @ts-nocheck
// ============================================================================
//  Server-side mount point for the Originals games island.
//
//  This is the whole integration surface: whichever page owns the site chrome
//  (today the Games section of the branded site shell) drops the two strings
//  below into its <head> and its section body. The island then boots itself
//  from the `data-gx-boot` payload — no globals, no inline script, nothing for
//  the host page to call.
//
//  Everything inside the mount is scoped to `.gx`, so the host page's own
//  tokens and layout are untouched.
//
//  Usage (hono/jsx host page):
//    <head>{raw(gamesIslandHead())}</head>
//    ...
//    <section>{raw(gamesIslandMount({ slug, siteName, logoUrl, nonce }))}</section>
//
//  Contract with the backend: the markup below carries no game state. The
//  island asks GET /api/games/config what exists, and the server decides — this
//  helper cannot enable a game the streamer turned off.
// ============================================================================
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Stylesheet for the island. Safe to include on a page that never mounts it. */
export function gamesIslandHead() {
  return `<link rel="stylesheet" href="/assets/games.css" />`;
}

/**
 * The mount element, its server-rendered placeholder, a no-JS fallback and the
 * module script. `nonce` must be the page's CSP nonce.
 *
 * @param {object} o
 * @param {string} o.slug            Site slug — scopes every API call.
 * @param {string} o.nonce           CSP nonce for the module script tag.
 * @param {string} [o.siteName]      Streamer's site name, shown in the island header.
 * @param {string|null} [o.logoUrl]  Streamer's logo, or null for a text mark.
 * @param {string} [o.creditsUrl]    Where "earn credits" points.
 * @param {string} [o.signInUrl]     Where "sign in to play" points.
 * @param {boolean} [o.header]       Render the island's own header. Off when the
 *                                   host page already shows branding and balance.
 */
export function gamesIslandMount({
  slug,
  nonce,
  siteName = "",
  logoUrl = null,
  creditsUrl = "",
  signInUrl = "",
  header = false,
}) {
  const boot = {
    slug,
    siteName: siteName || slug,
    logoUrl: logoUrl || null,
    homeUrl: `/${slug}`,
    signInHref: signInUrl || `/api/viewer/auth/kick?returnTo=${encodeURIComponent(`/${slug}/games`)}`,
    earnHref: creditsUrl || `/${slug}/credits`,
    header,
  };

  return `<div class="gx" id="gx-root"
     data-gx-boot="${esc(JSON.stringify(boot))}">
  <div class="gx-app">
    <main class="gx-main">
      <div class="gx-board-slot">
        <div class="gx-frame gx-surface" aria-busy="true">
          <div class="gx-skeleton" aria-hidden="true">
            <div class="gx-skeleton__row gx-skeleton__board"></div>
            <div class="gx-skeleton__row"></div>
            <div class="gx-skeleton__row"></div>
          </div>
        </div>
      </div>
    </main>
  </div>
</div>
<noscript>
  <div class="gx gx-noscript">
    <p>Originals are interactive, so they need JavaScript enabled. Your ${esc(slug)} credits and balance are unaffected.</p>
    <p><a href="${esc(boot.earnHref)}">View your credits</a></p>
  </div>
</noscript>
<script type="module" src="/assets/games/games.js" nonce="${esc(nonce)}"></script>`;
}
