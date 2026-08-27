// HTTP response headers constants

export const MIME = {
  ".css": "text/css; charset=utf-8", 
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", 
  ".svg": "image/svg+xml",
};

// SEC-005-v7: HTML intentionally has NO Content-Security-Policy or X-Frame-Options.
// Public leaderboard pages MUST be iframe-embeddable (streamers embed in OBS/browser
// sources). Authenticated pages (login, dashboard, admin) use SECURE_HTML which
// includes frame-ancestors 'self' and a full CSP. Do NOT add frame restrictions here.
export const HTML = {
  "content-type": "text/html; charset=utf-8",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // SEC-002-v9: Permissive CSP for public pages. Allows iframe embedding (frame-ancestors *)
  // for streamers while blocking inline scripts and data exfiltration as XSS defense-in-depth.
  // style-src includes 'unsafe-inline' because error pages, OBS overlays, and dynamic branding
  // use <style> blocks (nonces would require per-request CSP generation — tracked for future).
  // All style="" attributes have been extracted to CSS classes (SEC-713) for maintainability.
  "Content-Security-Policy": "default-src 'self'; script-src 'self' https://telegram.org https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://cloudflareinsights.com; frame-ancestors *; base-uri 'none'; form-action 'self'; upgrade-insecure-requests; report-uri /api/csp-report",
};

// Hardened headers for the authenticated/app pages (login, signup, forgot,
// reset, dashboard, admin). The public leaderboard keeps the plain HTML set
// (it's intentionally iframe-able and loads Google Fonts) so we scope security
// headers only to the pages that hold sessions/credentials. All inline scripts
// are external; style-src still allows 'unsafe-inline' because a few dynamic UI
// elements (progress bars, dashboard widgets) set inline styles via JS/templates.
export const SECURE_HTML = {
  "content-type": "text/html; charset=utf-8",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
};

// HTML-escape a value for interpolation into text/attribute context
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Inject nonce into CSP header for both style-src and script-src.
// Replaces 'unsafe-inline' with 'nonce-xxx' where present, adds nonce otherwise.
// Handles script-src with additional origins (e.g. https://telegram.org) by
// inserting the nonce after 'self' rather than requiring an exact match.
export function withNonce(headers, nonce) {
  const csp = headers["Content-Security-Policy"];
  if (!nonce || !csp) return headers;
  let updated = csp
    .replace(/style-src 'self' 'unsafe-inline'/, `style-src 'self' 'nonce-${nonce}'`);
  // Insert nonce after script-src 'self' (handles both bare and multi-origin forms)
  if (/script-src 'self'(?![^;]*'nonce-)/.test(updated)) {
    updated = updated.replace(/script-src 'self'/, `script-src 'self' 'nonce-${nonce}'`);
  }
  return { ...headers, "Content-Security-Policy": updated };
}

// Every status page (404, suspended, unverified, 500) is one branded layout.
// They used to be four hand-rolled dark documents while the rest of the product
// is light with the brand blue, so landing on one felt like leaving the site.
// Self-contained on purpose: these also serve custom domains and must render
// even when nothing else about the request worked.
// The status pages are the one document that has to render when everything
// else has failed, so they stay self-contained: no stylesheet request, no font
// request, and the same tokens, control radius and focus ring as the public
// viewer so a viewer who mistypes a creator's link does not land in an
// unrelated template.
const STATUS_CSS = `:root{--bg:#f3f3ef;--panel:#fff;--line:rgba(20,20,12,.1);--ink:#191919;--dim:#5c5c5c;--accent:#2200ff;--accent-ink:#fff}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--ink);font:15px/1.6 "Inter","Fira Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px;gap:20px}
.brand{font-weight:600;font-size:20px;letter-spacing:-.03em;color:var(--ink);text-decoration:none}
.brand b{color:inherit;font-weight:600}
.card{width:100%;max-width:460px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:28px 24px;text-align:center}
h1{font-size:26px;line-height:1.15;font-weight:500;letter-spacing:-.03em;margin-bottom:12px;overflow-wrap:anywhere}
p{color:var(--dim);font-size:14px;overflow-wrap:anywhere}
p+p{margin-top:8px}
p a{color:var(--ink);font-weight:500;text-underline-offset:4px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:1px 6px;word-break:break-all}
.actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:20px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 18px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font-weight:500;font-size:14px;text-decoration:none}
.btn--accent{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.btn:hover{border-color:var(--accent)}
a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`;

function statusPage({ title, heading, body, actions, nonce }) {
  const n = nonce ? ` nonce="${nonce}"` : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)} · YourRank</title>
<style${n}>${STATUS_CSS}</style></head>
<body><a class="brand" href="/">Your<b>Rank</b></a>
<main class="card"><h1>${esc(heading)}</h1>${body}
<div class="actions">${actions}</div></main>
<script src="/assets/cookie-consent.js" defer></script></body></html>`;
}

const HOME_BTN = '<a class="btn btn--accent" href="/">Go to YourRank</a>';

export function notFoundPage(slug, nonce) {
  return statusPage({
    nonce,
    title: "Not found",
    heading: "No leaderboard here",
    body: slug
      ? `<p>Nothing is published at <code>/${esc(slug)}</code>. The link may be mistyped, or the board may have been renamed.</p>`
      : "<p>Nothing is published at that address. The link may be mistyped, or the board may have been renamed.</p>",
    // Only on the marketing domain: /demo is not a page on a customer's own domain.
    actions: slug ? `${HOME_BTN}<a class="btn" href="/demo">See an example board</a>` : HOME_BTN,
  });
}

export function suspendedPage(nonce) {
  return statusPage({
    nonce,
    title: "Unavailable",
    heading: "This page is unavailable",
    body: "<p>The owner's account is suspended, so their boards are hidden for now.</p>",
    actions: HOME_BTN,
  });
}

// Shown when the owner's account is fine but their email is not confirmed yet.
// Deliberately does not accuse the owner of anything.
export function pendingVerificationPage(nonce) {
  return statusPage({
    nonce,
    title: "Not live yet",
    heading: "This leaderboard isn't live yet",
    body: "<p>The owner still needs to confirm their email address. Check back soon.</p>",
    actions: HOME_BTN,
  });
}

export function error500Page(nonce) {
  return statusPage({
    nonce,
    title: "Something went wrong",
    heading: "Something went wrong",
    body:
      "<p>We're having trouble loading this page. Try refreshing, or come back in a moment.</p>" +
      '<p>If it keeps happening, <a href="/help/support">contact support</a>.</p>',
    actions: `<a class="btn btn--accent" href="">Try again</a><a class="btn" href="/">Go to YourRank</a>`,
  });
}
