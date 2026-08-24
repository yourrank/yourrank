// ============================================================================
//  YourRank — shared page shell helpers
//
//  Deduplicates the outer HTML boilerplate (head, skip link, top nav, <main>)
//  for dashboard pages so the leaderboard and bot shells can't drift again.
//
//  These modules are built to packages/shared/dist/*.js by `tsc -p tsconfig.json`.
// ============================================================================

import { brandMarkSvg } from "./brand-assets.js";
import { DEFAULT_DASHBOARD_TITLE } from "./dashboard-chrome-state.js";
import { type ShellUser } from "./shell-nav.js";

export const DEVIN_DESIGN_CONTRACT = `<!--
THESIS: One quiet, high-contrast language makes the connected YourRank suite immediately legible.
OWN-WORLD: Near-white fields, black type, electric-violet actions, hairline dividers, restrained geometry, and readable product surfaces.
STORY: A visitor or operator understands the current state, finds the next action, and keeps product context without relearning the interface.
FIRST VIEWPORT: Compact product identity, decisive page purpose, a visible primary action, and essential product state appear before supporting detail.
FORM: Devin-reference suite system, seed 562938e8; devin.ai governs material and hierarchy while YourRank branding, copy, and product truth remain original.
FINISH: Every shipped surface is reviewed at desktop and mobile, documented in DESIGN.md, and held to the shared accessibility and responsive floor.
-->`;


function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string)
  );
}

// Operator-console type (see DESIGN.md §4): Fira Sans for UI, Fira Code for
// mono. The console stylesheets declare these; this loader must match or the
// console silently falls back to system fonts. (The public board and marketing
// pages load their own fonts separately and do not use this shell.)
const GOOGLE_FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com" />' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />' +
  '<link href="https://fonts.googleapis.com/css2?family=Fira+Sans:wght@400;500;600;700;800&family=Fira+Code:wght@500;700&display=swap" rel="stylesheet" />';

// The operator console has no dark skin (the workspace stylesheets declare only
// light values), so nothing here opts a document into `data-theme="dark"`. A
// dark theme returns when the console stylesheets actually implement one.

export interface LeaderboardPageOpts {
  title: string;
  canonical: string;
  description?: string;
  /** Defaults to "noindex, nofollow" — public pages must opt in to indexing. */
  robots?: string;
  reqId?: string;
  mainClass?: string;
  styles?: string[];
  scripts?: string[];
  noscript?: string;
  nav?: boolean;
  footer?: boolean;
  /** Footer brand target; visitor-facing pages point at the public site. */
  footerBrandHref?: string;
  wide?: boolean;
  bootWatchdog?: boolean;
  content: string;
}

export const DASHBOARD_BOOT_WATCHDOG =
  '<script src="/assets/dashboard-boot-watchdog.js?v=1"></script>';

/** Full HTML document for leaderboard dashboard pages. */
export function leaderboardPageHtml(opts: LeaderboardPageOpts): string {
  const mainClass = esc(opts.mainClass || "wrap");
  const bodyAttr = opts.wide ? ' data-wide="true"' : "";
  const reqIdMeta = opts.reqId ? `<meta name="request-id" content="${esc(opts.reqId)}" />` : "";
  const description = opts.description ? `<meta name="description" content="${esc(opts.description)}" />` : "";
  const styles = (opts.styles || ["/assets/app.css", "/assets/shell-nav.css", "/assets/ui.css"])
    .map((href) => `<link rel="stylesheet" href="${esc(href)}" />`)
    .join("") + '<link rel="stylesheet" href="/assets/devin-system.css" />';
  const scripts = (opts.scripts || []).join("");
  const noscript =
    opts.noscript ||
    "<p>YourRank requires JavaScript</p><p>Please enable JavaScript in your browser settings to use the dashboard.</p>";
  const navPlaceholder = opts.nav !== false ? "<!--GM_NAV-->" : "";
  const navScript = opts.nav !== false ? '<script src="/assets/shell-nav.js" defer></script>' : "";
  const footerBrandHref = esc(opts.footerBrandHref || "/dashboard");
  const footer = opts.footer !== false ? `<footer class="gm-shell-footer">
  <div class="gm-shell-inner">
    <a class="gm-brand" href="${footerBrandHref}"><span class="gm-brand-mark">${brandMarkSvg()}</span><span class="gm-brand-word">YourRank</span></a>
    <nav class="gm-shell-footer-links" aria-label="Legal">
      <a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/contact">Contact</a><a href="/responsible">Responsible Play</a>
    </nav>
    <span class="gm-shell-footer-copy">© {{YEAR}} YourRank</span>
  </div>
</footer>` : "";

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(opts.title)}</title>
${reqIdMeta}
${description}<meta name="robots" content="${esc(opts.robots || "noindex, nofollow")}" /><link rel="canonical" href="${esc(opts.canonical)}" />${GOOGLE_FONTS}
${styles}
${opts.bootWatchdog ? DASHBOARD_BOOT_WATCHDOG : ""}
</head><body${bodyAttr}>${DEVIN_DESIGN_CONTRACT}
<noscript><div class="noscript-msg">${noscript}</div></noscript>
<a href="#main-content" class="sr-only skip-link">Skip to content</a>
${navPlaceholder}
<main class="${mainClass}" id="main-content">${opts.content}</main>
${footer}
${navScript}
${scripts}
</body></html>`;
}

const BOT_STYLE_ATTR_CSS = `
.hidden { display: none !important; }
/* .sr-only and .skip-link come from /assets/ui.css, linked below — one skip
   link for both products rather than a second one that only looks similar. */

/* ---- spacing / type utilities: named steps, not indexes ---- */
.mb-sm { margin-bottom:10px }
.mb-md { margin-bottom:12px }
.mb-lg { margin-bottom:18px }
.mt-sm { margin-top:8px }
.mt-md { margin-top:14px }
.text-sm { font-size:13px }
.text-xs { font-size:12px }
.num { text-align:right }

/* ---- small shared pieces of the bot dashboard ---- */
.pagehead-row { display:flex;align-items:center;gap:12px }
.panel-intro { font-size:13px;margin-bottom:12px }
.subhead { margin:20px 0 6px;font-size:14px }
.hint { font-size:12px;margin-top:6px }
.notice { margin-bottom:12px;color:var(--accent) }
.field-label { display:block;margin-bottom:4px;font-size:13px }
.field-row { display:flex;gap:6px;align-items:center }
.field-row .grow { flex:1 }
.form-note { font-size:13px;margin:2px 0 10px }
.inline-row { display:flex;gap:8px;align-items:center;flex-wrap:wrap }
.input-w-md { max-width:300px }
.input-w-sm { max-width:150px }
.link-block { display:block;font-size:13px;color:var(--accent) }
.chart-axis { display:flex;justify-content:space-between;font-size:11px }
.divider { margin:14px 0 0;border:0;border-top:1px solid var(--v3-main-line) }
.pre-wrap { white-space:pre-wrap }
.style-warn { color:var(--v3-danger-ink); font-size:13px; margin-top:6px }
`;

const BOT_BASE_CSS = `
  .bot-card { display:flex; flex-direction:column; gap:12px; margin-bottom:12px; padding:12px; border:1px solid var(--v3-main-line); border-radius:8px; background:var(--v3-main-panel); box-shadow:var(--v3-shadow); }
  .bot-card-head { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:flex-start; gap:8px; }
  .bot-card .meta { flex:1; min-width:180px; }
  .bot-card .actions { display:flex; gap:8px; flex-wrap:wrap; }
  .bot-card button { padding:6px 12px; font-size:13px; }
  .health-details { width:100%; font-size:13px; color:var(--v3-main-ink-soft); }
  .health-details summary { cursor:pointer; color:var(--v3-main-ink); margin-bottom:6px; }
  .health-details ul { margin:0 0 8px; padding-left:18px; }
  .health-details li { margin-bottom:4px; }
  .wizard { display:flex; flex-direction:column; gap:18px; }
  .wizard-step { display:flex; flex-direction:column; gap:10px; }
  .wizard-step[hidden] { display:none; }
  .code { font-family:var(--v3-mono); font-size:12px; background:var(--v3-main-bg); padding:2px 6px; border-radius:5px; }
  /* broadcast preview modal */
  .bc-preview { position:fixed; inset:0; background:rgba(0,0,0,.7); display:flex; align-items:center; justify-content:center; padding:18px; z-index:100; }
  .bc-preview[hidden] { display:none; }
  .bc-preview-card { width:100%; max-width:480px; background:var(--v3-main-panel); border:1px solid var(--v3-main-line); border-radius:14px; padding:22px; box-shadow:var(--v3-shadow-lg); }
  .bc-preview-card h3 { margin:0 0 8px; }
  .bc-preview-card p { color:var(--v3-main-ink-soft); margin:0 0 14px; }
  .bc-preview-card p.bc-preview-audience { color:var(--v3-main-ink); font-size:20px; font-weight:700; }
  .bc-preview-card p.bc-preview-when { color:var(--v3-main-ink); font-weight:600; }
  .bc-preview-choice { border:1px solid var(--v3-main-line); border-radius:8px; padding:10px 12px; margin:0 0 14px; display:flex; gap:12px; flex-wrap:wrap; }
  .bc-preview-choice legend { color:var(--v3-main-ink-soft); font-size:12px; padding:0 4px; }
  .bc-preview-choice label { cursor:pointer; font-weight:600; }
  .bc-preview-msg { background:var(--v3-main-bg); border:1px solid var(--v3-main-line); border-radius:8px; padding:12px; margin-bottom:14px; white-space:pre-wrap; word-break:break-word; }
  .bc-preview-img img { max-width:100%; border-radius:8px; margin-bottom:14px; display:block; }
  .bc-preview-actions { display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap; }
  .bc-preview-actions button { flex:1 1 180px; min-height:44px; }
  .bc-test-action { font-weight:600; }
  .bc-detail { position:fixed; inset:0; background:rgba(0,0,0,.7); display:flex; align-items:center; justify-content:center; padding:18px; z-index:100; }
  .bc-detail[hidden] { display:none; }
  .bc-detail-card { width:100%; max-width:620px; max-height:calc(100vh - 36px); overflow:auto; background:var(--v3-main-panel); border:1px solid var(--v3-main-line); border-radius:12px; padding:22px; box-shadow:0 16px 38px -10px rgba(0,0,0,.5); }
  .bc-detail-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px; }
  .bc-detail-head h3 { margin:0; }
  .bc-detail-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-bottom:16px; }
  .bc-detail-item { min-width:0; }
  .bc-detail-item dt { color:var(--v3-main-ink-soft); font-size:12px; margin-bottom:3px; }
  .bc-detail-item dd { margin:0; overflow-wrap:anywhere; }
  .bc-detail-message { white-space:pre-wrap; overflow-wrap:anywhere; background:var(--v3-main-bg); border:1px solid var(--v3-main-line); border-radius:8px; padding:12px; margin:8px 0 14px; }
  .bc-detail-image { max-width:100%; max-height:220px; border-radius:8px; display:block; margin-top:8px; }
  .bc-detail-buttons { margin:8px 0 14px; padding-left:18px; }
  @media (max-width:600px) { .bc-detail-grid { grid-template-columns:1fr; } }
  .bc-segment { margin:10px 0; color:var(--v3-main-ink-soft); border:1px solid var(--v3-main-line); border-radius:8px; padding:10px 12px; background:var(--v3-main-panel); box-shadow:var(--v3-shadow); }
  .bc-segment summary { cursor:pointer; font-size:13px; }
  .bc-segment-fields { display:grid; grid-template-columns:repeat(2, minmax(120px, 1fr)); gap:10px; margin-top:10px; }
  .bc-segment-fields label { grid-column:1 / -1; margin:0; font-size:12px; }
  .bc-segment-fields input,
  .bc-segment-fields select { padding:6px 8px; border-radius:6px; border:1px solid var(--v3-main-line); background:var(--v3-main-bg); color:var(--v3-main-ink); }
  @media (max-width:600px) { .bc-segment-fields { grid-template-columns:1fr; } }
  .cmd-button-list { display:flex; flex-wrap:wrap; gap:8px; margin:8px 0 12px; }
  .cmd-button-chip { display:inline-flex; align-items:center; gap:6px; background:var(--v3-main-bg); border:1px solid var(--v3-main-line); border-radius:999px; padding:4px 10px; font-size:13px; color:var(--v3-main-ink); }
  .cmd-button-chip button { padding:0 4px; font-size:16px; line-height:1; background:transparent; border:none; color:var(--v3-main-ink-soft); cursor:pointer; }
`;
const BOT_DASH_V2_CSS = ``;

export interface BotPageOpts {
  user: ShellUser;
  page: string;
  nonce?: string;
  nav?: string;
  documentTitle?: string;
  /** Page renders the shared dashboard rail/topbar, so it needs its stylesheets. */
  dashboardChrome?: boolean;
  content: string;
}

/** Full HTML document for the bot dashboard. `nav` is rendered before `<main>`. */
export function botPageHtml(opts: BotPageOpts): string {
  const nonceAttr = opts.nonce ? ` nonce="${esc(opts.nonce)}"` : "";
  const nav = opts.nav || "";
  // Bot component CSS is emitted before the shared dashboard sheets so the
  // shell chrome remains identical to the leaderboard while panel rules work.
  const chromeCss = opts.dashboardChrome
    ? '<link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/shell-nav.css"><link rel="stylesheet" href="/assets/ui.css"><link rel="stylesheet" href="/assets/dashboard-v4.css"><link rel="stylesheet" href="/assets/devin-system.css">'
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.documentTitle || DEFAULT_DASHBOARD_TITLE)}</title>${GOOGLE_FONTS}<style${nonceAttr}>${BOT_STYLE_ATTR_CSS}${BOT_BASE_CSS}${BOT_DASH_V2_CSS}</style>${chromeCss}</head><body class="yr-ui" data-page="${esc(opts.page)}">${DEVIN_DESIGN_CONTRACT}
<a href="#main-content" class="skip-link">Skip to main content</a>
${nav}
${opts.content}
<script src="/assets/shell-nav.js" defer></script>
<script src="/assets/dialog.js" defer></script>
</body></html>`;
}
