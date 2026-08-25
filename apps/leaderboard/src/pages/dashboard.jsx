/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import { raw } from "hono/html";
import { DashboardShell } from "./dashboard-shell.jsx";

import { brandLoaderLogoSvg } from "@yourrank/shared/brand-assets";
import { chromeStateFor, dashboardPath, dashboardTitleForPath, defaultTab, parseDashboardPath, SECTIONS as DASHBOARD_SECTIONS } from "../assets/dashboard/routes.js";
import { DEFAULT_DASHBOARD_TITLE } from "@yourrank/shared/dashboard-chrome-state";

const OBS_TOOLS = `<div class="lb-widget lb-widget--full ov-obs-suite-card"><div class="v3-section-head"><div><h2>OBS Live Stream Overlays</h2><p class="v3-head-sub">Paste transparent browser sources directly into OBS Studio or Streamlabs.</p></div><a class="btn btn--sm btn--ghost" href="/dashboard/leaderboard/design">Appearance →</a></div><div class="v3-settings-row"><div><b>Site for these overlay links</b><p class="card-sub" id="obsSiteHint">Loading your sites…</p></div><select id="obsSiteSelect" class="v3-select" aria-label="Site for OBS links"><option>Loading sites…</option></select></div><div class="ov-obs-grid"><div class="ov-obs-item"><div class="ov-obs-info"><span class="ov-obs-tag">PREDICTIONS HUD</span><strong>Live Betting Overlay</strong><p>Live Yes/No odds bar &amp; countdown timer on stream.</p></div><button class="btn btn--sm btn--accent" id="ov-btn-copy-pred-hud" type="button">Copy OBS Link</button></div><div class="ov-obs-item"><div class="ov-obs-info"><span class="ov-obs-tag">SOUND ALERTS</span><strong>Stream Alerts &amp; Chimes</strong><p>Audio chimes &amp; popup cards for orders &amp; winners.</p></div><button class="btn btn--sm btn--accent" id="ov-btn-copy-alerts" type="button">Copy OBS Link</button></div><div class="ov-obs-item"><div class="ov-obs-info"><span class="ov-obs-tag">PODIUM TICKER</span><strong>Leaderboard Bar</strong><p>Horizontal scrolling ticker of top players &amp; points.</p></div><button class="btn btn--sm btn--accent" id="ov-btn-copy-ticker" type="button">Copy OBS Link</button></div></div></div>`;

export const dashboardConfig = {
  title: DEFAULT_DASHBOARD_TITLE,
  canonical: "https://yourrank.site/dashboard",
  styles: ["/assets/app.css", "/assets/shell-nav.css", "/assets/ui.css", "/assets/dashboard-v4.css"],
  scripts: ['<script src="/assets/dashboard.js?v=15" type="module"></script>', '<script src="/assets/dashboard/preview-tabs.js?v=1" type="module"></script>', '<script src="/assets/shell-nav.js?v=3" defer></script>'],
  nav: false,
  footer: false,
  wide: true,
  bootWatchdog: true,
  configFor: ({ activePath }) => ({
    ...dashboardConfig,
    title: dashboardTitleForPath(activePath?.split("?")[0] || "/dashboard"),
  }),
};

export const ANALYTICS_TABS = ["activity", "referrals", "events"];
export const BOARD_TABS = DASHBOARD_SECTIONS.board.tabs.map((tab) => [
  tab,
  chromeStateFor("board", tab, { exact: true }).tabLabel,
  dashboardPath("board", tab),
]);

function LeaderboardTabs({ active }) {
  return <nav class="editor-steps v3-tabs" id="editorTabs" aria-label="Leaderboard pages">
    {BOARD_TABS.map(([key, label, href]) => (
      <a class={"editor-step v3-tab" + (key === active ? " is-active is-on" : "")} href={href} data-egroup={key} aria-current={key === active ? "page" : undefined}>{label}</a>
    ))}
  </nav>;
}

// Which SPA section/tab this document opens on. Route → section/tab comes
// from the canonical resolver; the section-root default tab comes from the
// manifest tab order.
function dashboardShellRoute(activePath = "") {
  const pathname = String(activePath || "").split("?")[0];
  const route = parseDashboardPath(pathname);
  if (!route) return { activeNav: "home", activeHash: "" };
  return { activeNav: route.page, activeHash: route.tab || defaultTab(route.page) };
}


// Every route serves every section. Splitting sections across per-route
// documents made each cross-section click a full reload: the workspace
// re-initialized, re-fetched /api/auth/me and /api/site, and showed the
// full-screen "Loading your workspace…" for ordinary navigation. One document
// keeps the shell, the selected site and all editor state mounted; navTo()
// reveals the destination section (inactive sections are display:none, so
// assistive tech only ever sees the active one) and section-specific data
// loads lazily on first visit.
const ALL_SECTIONS = ["home", "board", "site", "games", "performance", "boards"];
const ROUTE_SECTIONS = Object.fromEntries(
  ["home", "board", "site", "games", "performance", "boards"].map((route) => [route, ALL_SECTIONS]),
);

function OverviewSection({ active } = {}) {
  return (
<section class={active ? "lb-page is-on" : "lb-page"} data-page="home">
<header class="v3-head ov-head v3-head--row"><div><h1>Home</h1><p class="v3-head-sub" id="ovHeadSub">Checking your site…</p><span class="ov-status" id="ovStatus" data-state="checking"><i aria-hidden="true"></i><span id="ovPublishedStatus">Checking…</span></span></div><a class="btn btn--sm btn--accent" id="ovSetupAction" href="/dashboard/leaderboard/setup" hidden>Continue setup</a><a class="btn btn--sm btn--accent" id="ovPublicSiteAction" href="#" target="_blank" rel="noopener noreferrer" hidden>View site ↗</a></header>
<div class="v3-alert v3-alert--warning" id="ovPendingOrdersAlert" role="alert" hidden><span><b id="ovPendingOrdersAlertCount">0</b> <span id="ovPendingOrdersAlertLabel">pending orders need review.</span></span><a class="btn btn--sm btn--ghost" id="ovPendingOrdersAlertAction" href="/dashboard/rewards/redemptions">Review orders →</a></div>
<section class="ov-next-step" id="ovNextStep" aria-labelledby="ovNextStepTitle" hidden><div class="ov-next-step-copy"><h2 id="ovNextStepTitle">—</h2><p id="ovNextStepBody">—</p></div><a class="btn btn--sm btn--accent" id="ovNextStepAction" href="#">—</a></section>
<section class="ov-setup" id="ovSetup" aria-labelledby="ovSetupTitle" hidden><div class="ov-setup-head"><div><h2 id="ovSetupTitle">Finish setup</h2><p id="ovSetupMessage">Add players and publish to open your site.</p></div><span class="ov-setup-count" id="ovSetupCount">0 of 4 done</span></div><ul class="ov-setup-list" id="ovSetupList" aria-label="Setup steps"></ul></section>
<section class="ov-figures" id="ovFigures" aria-label="Site summary">
  <div class="ov-figure">
    <span class="ov-figure-lbl" id="ovLblViews">Visits this week</span>
    <span class="ov-figure-val" id="ovViews14" aria-labelledby="ovLblViews"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></span>
  </div>
  <div class="ov-figure">
    <span class="ov-figure-lbl" id="ovLblPlayers">Players</span>
    <span class="ov-figure-val" id="ovPlayersCount" aria-labelledby="ovLblPlayers"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></span>
    <a class="ov-figure-link" href="/dashboard/leaderboard/players">Manage players</a>
  </div>
  <div class="ov-figure">
    <span class="ov-figure-lbl" id="ovLblGiveaway">Active giveaways</span>
    <span class="ov-figure-val" id="ovActiveGiveaway" aria-labelledby="ovLblGiveaway"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></span>
    <a class="ov-figure-link" id="ovGiveawayAction" href="/dashboard/giveaways">Create giveaway</a>
  </div>
</section>
<div class="ov-lists"><section class="ov-list" aria-labelledby="ovActivityTitle"><div class="ov-list-head"><h2 id="ovActivityTitle">Recent activity</h2><button class="ov-list-link" id="ovAnalyticsLink" type="button" data-jump="performance">See analytics</button></div><div class="ov-activity-list" id="ovActivityList"></div><div class="ov-card-empty" id="ovActivityEmpty" hidden></div></section><section class="ov-list" aria-labelledby="ovTopTitle"><div class="ov-list-head"><h2 id="ovTopTitle">Top players</h2><a class="ov-list-link" href="/dashboard/leaderboard/players">All players</a></div><div class="ov-players-list" id="ovTopPlayers"></div><div class="ov-card-empty" id="ov_topEmpty" hidden></div></section></div>
</section>
  );
}

function EditorSection({ active, activeHash = defaultTab("board"), showTabs = active } = {}) {
  return (
<section class={active ? "lb-page is-on" : "lb-page"} data-page="board">

<div class="design-grid">
<div class="design-controls">
{showTabs ? <LeaderboardTabs active={activeHash} /> : null}
<h1 class="v3-section-title" data-egroup="setup">Setup</h1>
<div class="card" data-egroup="setup"><h2>Your site</h2><p class="card-sub">This is what visitors see when they open your page.</p><div class="grid2">
<div class="field"><label for="f_name">Site name</label><input id="f_name" /></div>
<div class="field"><label for="f_tagline">Tagline <span class="hint">Optional</span></label><input id="f_tagline" placeholder="Stream community leaderboard" /></div>
</div>
<details class="editor-more" data-editor-more="setup-sponsor"><summary>Sponsor and promo code</summary><div class="grid2">
<div class="field"><label for="f_casino">Sponsor name</label><input id="f_casino" placeholder="Your brand or sponsor" /></div>
<div class="field"><label for="f_code">Promo code</label><input id="f_code" placeholder="Optional" /></div>
<div class="field"><label for="f_cta">Sponsor website</label><input id="f_cta" placeholder="https://example.com" /></div>
<div class="field field--full"><label for="f_blurb">About your sponsor</label><textarea id="f_blurb" rows="2" placeholder="Short pitch about the sponsor and your code (optional)."></textarea></div></div></details></div>
<div class="card" data-egroup="setup"><h2>Ranking</h2><p class="card-sub">What decides rank, and when this round ends.</p><div class="grid2">
<div class="field"><label for="f_rank_by">Rank players by</label><select id="f_rank_by"><option value="wagered">Amount</option><option value="score">Points / score</option></select><span class="hint">Players with the same value share a rank.</span></div>
<div class="field"><label for="f_pool">Prize pool</label><input id="f_pool" placeholder="$500" /></div>
<div class="field"><label for="f_period">Race runs</label><select id="f_period"><option>Weekly</option><option selected>Monthly</option><option>Season</option></select></div>
<div class="field"><label for="f_ends">Round ends on</label><input id="f_ends" type="datetime-local" /><span class="hint" id="f_ends_hint">Shown in your timezone. After this time, final standings stay visible and automated score updates stop.</span></div>
</div>
<details class="editor-more" data-editor-more="setup-schedule"><summary>Start date and automatic restart</summary><div class="grid2">
<div class="field"><label for="f_starts">Round starts on <span class="hint">Optional</span></label><input id="f_starts" type="datetime-local" /><span class="hint" id="f_starts_hint">Shown in your timezone.</span></div>
<div class="field field--full"><label class="chk"><input type="checkbox" id="f_auto_reset" /> Automatically start a new race when this one ends</label><label class="sr-only" for="f_auto_reset_clear">What to reset when the race ends</label><select id="f_auto_reset_clear" disabled class="mt-8"><option value="wagers">Reset everyone's scores to zero</option><option value="players">Remove all players and start fresh</option><option value="none">Keep everything as-is</option></select><span class="hint">Your current standings will be saved automatically before the reset.</span></div></div></details></div>
<div class="card" data-egroup="setup"><h2>Who can see this site</h2><p class="card-sub">Your site is open to anyone with the link once you publish it.</p>
<div class="field field--full m-0"><label class="chk"><input type="checkbox" id="f_password_enabled" /> Require a password to view this site</label><input id="f_password" type="password" placeholder="Leave blank to keep current password" disabled class="mt-8" /><span class="hint">Visitors must enter this password before seeing the leaderboard.</span></div></div>
<h1 class="v3-section-title" data-egroup="design">Appearance</h1>
<div class="v3-players" data-egroup="players">
<div class="v3-head">
<h1>Players &amp; scores</h1>
<p class="v3-head-sub v3-head-sub--mono"><span id="pCount">0</span> / <span id="pLimit">0</span> players on your leaderboard <span id="limitHint" class="v3-players-limit"></span> <a class="v3-players-upgrade" id="playerLimitUpgrade" href="/dashboard/settings" hidden>Upgrade</a></p>
</div>
<div class="v3-alert v3-alert--warning players-sample-notice" id="playersSampleNotice" hidden role="status"><strong>Sample players are shown.</strong><span>Replace or clear them before publishing your real roster.</span><a class="btn btn--sm btn--ghost" href="#quickAdd">Manage players</a></div>
<div class="v3-alert v3-alert--info players-draft-notice" id="playersDraftNotice" hidden role="status"><strong>Restored unsaved changes.</strong><span>Your staged player edits are back. Review them and save or discard.</span><button class="btn btn--sm btn--ghost" id="playersDraftNoticeDismiss" type="button">Dismiss</button></div>
<div class="v3-players-bar">
<label class="v3-search" for="playerSearch"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg><input type="search" id="playerSearch" placeholder="Search players..." aria-label="Search players" autocomplete="off" /></label>
<select class="v3-select" id="playerSort" aria-label="Sort players"><option value="wagered">Sort by: Amount</option><option value="score">Sort by: Points</option><option value="prize">Sort by: Prize</option><option value="name">Sort by: Name</option></select>
<div class="v3-players-bar-end">
<div class="v3-menu-wrap"><button class="v3-btn" id="colDropdownBtn" type="button" aria-haspopup="true" aria-expanded="false"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/></svg>Columns</button>
<div class="v3-menu" id="colMenu" hidden><label class="v3-menu-item"><input type="checkbox" data-col="score" /> Score</label><label class="v3-menu-item"><input type="checkbox" data-col="hands" /> Hands played</label><label class="v3-menu-item"><input type="checkbox" data-col="netProfit" /> Net profit</label><label class="v3-menu-item"><input type="checkbox" data-col="winRate" /> Win rate</label><label class="v3-menu-item"><input type="checkbox" data-col="change" /> Change</label></div></div>
<div class="v3-menu-wrap"><button class="v3-btn v3-btn--accent" id="importMenuBtn" type="button" aria-haspopup="true" aria-expanded="false"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/></svg>Import</button>
<div class="v3-menu v3-menu--dark v3-menu--end" id="importMenu" hidden><button class="v3-menu-item" id="importPasteBtn" type="button">Paste from Excel or Google Sheets</button><button class="v3-menu-item" id="csvImportBtn" type="button">Upload a file (.csv)</button><button class="v3-menu-item" id="gsheetBtn" type="button">Link a Google Sheet</button><div class="v3-menu-sep"></div><button class="v3-menu-item" id="csvExportBtn" type="button">Download as spreadsheet</button><button class="v3-menu-item v3-menu-item--accent" id="csvTemplateBtn" type="button">Download blank template</button></div></div>
</div>
</div>
<div class="v3-table-card">
<div class="v3-table-scroll" id="playersTableWrap"><table class="v3-table v3-players-table"><thead><tr><th class="sel"><input type="checkbox" id="selectAll" title="Select all" aria-label="Select all players" /></th><th class="rank">Rank</th><th class="player-name">Player</th><th class="num">Amount</th><th class="num">Prize</th><th class="num col-score" hidden>Score</th><th class="num col-hands" hidden>Hands played</th><th class="num col-net" hidden>Net profit</th><th class="num col-win" hidden>Win rate</th><th class="num col-change" hidden>Change</th><th class="act">Edit</th></tr></thead><tbody id="rows"></tbody><tfoot id="quickAdd"><tr><td class="sel"></td><td class="rank"></td><td class="player-name"><input id="qa_name" class="p-name" maxlength="160" placeholder="New player" aria-label="New player name" aria-describedby="qa-name-counter qa-name-error qa-name-warning" /><span class="player-name-counter" id="qa-name-counter" hidden aria-live="polite"></span><span class="field-err" data-field-error="qa_name" id="qa-name-error" hidden role="alert" aria-live="polite"></span><span class="field-warn" data-field-warning="qa_name" id="qa-name-warning" hidden role="status" aria-live="polite"></span></td><td class="num"><input id="qa_wager" inputmode="decimal" placeholder="0" aria-label="New player amount" aria-describedby="qa-wager-error" /><span class="field-err" data-field-error="qa_wager" id="qa-wager-error" hidden role="alert" aria-live="polite"></span></td><td class="num"><input id="qa_prize" inputmode="decimal" placeholder="0" aria-label="New player prize" aria-describedby="qa-prize-error" /><span class="field-err" data-field-error="qa_prize" id="qa-prize-error" hidden role="alert" aria-live="polite"></span></td><td class="num col-score" hidden></td><td class="num col-hands" hidden></td><td class="num col-net" hidden></td><td class="num col-win" hidden></td><td class="num col-change" hidden></td><td class="act"><span class="field-warn" id="quickLimitMsg" hidden role="status" aria-live="polite"></span><button class="v3-btn v3-btn--xs" id="qa_add" type="button">+ Add</button></td></tr></tfoot></table></div>
<div class="v3-table-foot" id="playersFoot"><span id="playersShowing">No players</span><span class="v3-pager"><button class="v3-btn v3-btn--sm" id="playersPrev" type="button">Previous</button><button class="v3-btn v3-btn--sm" id="playersNext" type="button">Next</button></span></div>
<div id="playersEmpty" class="v3-empty" hidden>
<span class="v3-empty-ic" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
<h2>No players yet</h2>
<p>Start by adding players manually, or import them all at once from a spreadsheet.</p>
<div class="v3-empty-actions"><button class="v3-btn v3-btn--accent" id="emptyImportBtn" type="button">Import players</button><button class="v3-btn" id="emptyPasteBtn" type="button">Paste from clipboard</button></div>
</div>
</div>
<div class="v3-players-foot"><button class="v3-btn v3-btn--sm" id="addRow" type="button">+ Add player</button><input type="file" id="csvFileInput" accept=".csv,.tsv,.txt" hidden /><span id="limitMsg" class="hint ml-auto c-muted" role="status" aria-live="polite"></span></div>
<div class="import" id="importPanel" hidden>
<p class="hint mb-8">Paste directly from Excel or Google Sheets. Each row is one player. Your spreadsheet needs at least three columns: <strong>Name</strong>, <strong>Amount</strong>, and <strong>Prize</strong>. Column order doesn't matter — we'll figure it out.</p>
<textarea id="importText" rows="6" spellcheck="false" placeholder="*****ess&#9;152000&#9;1500&#10;*****y&#9;98000&#9;700&#10;*****k&#9;61250"></textarea>
<div class="import-foot"><span class="hint" id="importPreview">0 players detected</span>
<label class="hint chk"><input type="checkbox" id="importReplace" checked /> Replace current list</label>
<button class="btn btn--sm btn--accent" id="importApply" type="button" disabled>Add to table</button></div></div>
<div class="import" id="gsheetPanel" hidden>
<p class="hint mb-8">Paste a Google Sheets URL. Public or “Publish to web” sheets work best; Google may block private sheets.</p>
<div class="d-flex gap-8 flex-wrap">
<input type="text" id="gsheetUrl" class="flex-1" placeholder="https://docs.google.com/spreadsheets/d..." />
<button class="btn btn--sm btn--accent" id="gsheetFetch" type="button">Fetch CSV</button>
</div>
<p class="hint mt-8" id="gsheetStatus"></p>
</div>
<div class="v3-bulkbar" id="bulkActions" role="toolbar" aria-label="Bulk actions" hidden><span class="v3-bulkbar-mark" aria-hidden="true"></span><span id="bulkCount" role="status" aria-live="polite" aria-atomic="true">0 players selected</span><span class="v3-bulkbar-sep" aria-hidden="true"></span><button class="v3-btn v3-btn--dark" id="bulkClearWager" type="button">Reset scores to zero</button><button class="v3-btn v3-btn--danger" id="bulkDelete" type="button">Remove selected players</button></div>
</div>
<div class="card" data-egroup="design" id="playerFieldsCard"><h2>Player table columns</h2><p class="card-sub">Choose which extra columns show on the player table.</p><a class="btn btn--sm btn--ghost" id="playerFieldsLink" href="/dashboard/leaderboard/players">Manage columns in Players →</a></div>
<div class="design-group-heading" data-egroup="design"><h2>Page design</h2></div>
<div class="card" data-egroup="design" id="brandCard"><h3>Your brand <span class="pill pill--info ml-6">PRO</span></h3><p class="card-sub">Add your logo and pick your colors. Upgrade to Pro to customize.</p>
<div id="brandBody">
<div class="grid2">
<div class="field"><label for="logoFile">Your logo</label>
<div class="logo-row"><img id="logoPreview" class="logo-preview" alt="Logo preview" aria-hidden="true" hidden /><input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp" hidden />
<button class="btn btn--sm" id="logoPick" type="button">Upload logo</button><button class="btn btn--sm btn--ghost" id="logoClear" type="button" hidden>Remove</button></div>
<span class="hint">PNG, JPG or WebP. Shows in your page header and as the link preview image.</span></div>
<div class="field"><label>Website Template</label>
<div class="template-selector-grid" id="templateSelectorGrid">
  <button class="template-select-card is-selected" type="button" data-template="cyber_arcade">
    <div class="template-select-badge">🎮 Default</div>
    <strong>Cyber Arcade</strong>
    <span>High-contrast OLED dark, neon glow &amp; gaming cards</span>
  </button>
  <button class="template-select-card" type="button" data-template="esports_pro">
    <div class="template-select-badge">🏆 Tournament</div>
    <strong>Esports Arena</strong>
    <span>Stadium hierarchy, competitive rankings &amp; podiums</span>
  </button>
  <button class="template-select-card" type="button" data-template="creator_glass">
    <div class="template-select-badge">💎 Boutique</div>
    <strong>Creator Glass</strong>
    <span>Frosted glassmorphism, soft glow &amp; rewards focus</span>
  </button>
</div>
<span class="hint">Choose a signature layout &amp; visual style for your public site.</span>
</div>
<div class="field"><label>Color theme</label>
<div class="preset-list" id="colorPresets"></div>
<span class="hint">Pick a color theme for your page.</span>
<details class="advanced-colors"><summary>Custom colors</summary>
<div class="color-row"><label for="c_a" class="sr-only">Accent color start</label><input type="color" id="c_a" value="#5b5bf5" /><label for="c_b" class="sr-only">Accent color end</label><input type="color" id="c_b" value="#5b5bf5" /><button class="btn btn--sm btn--ghost" id="applyCustomColors" type="button">Apply colors</button><button class="btn btn--sm btn--ghost" id="colorsReset" type="button">Reset palette</button></div>
</details></div>
<div class="field"><label for="f_font">Text style</label><select id="f_font"><option value="Inter">Inter — Default</option><option value="Oswald">Oswald — Bold &amp; Sporty</option><option value="Playfair Display">Playfair Display — Premium &amp; Elegant</option><option value="Rajdhani">Rajdhani — Techy &amp; Esports</option><option value="Bebas Neue">Bebas Neue — Impact &amp; Hype</option></select><span class="hint">Changes the personality of your public page text.</span></div>
</div></div>
<div class="empty upsell-card" id="brandLock" hidden>Branding is a Pro feature. <a href="/dashboard/settings/billing?from=branding" id="brandUpgrade">Upgrade to Pro to unlock branding</a>.</div></div>
<div class="card" data-egroup="design" id="sectionsCard"><h3>Layout &amp; blocks <span class="pill pill--info ml-6">PRO</span></h3><p class="card-sub">Choose what appears on your public page.</p>
<div id="sectionsBody"><div class="sections-editor" id="sectionsList"></div></div>
<div class="empty upsell-card" id="sectionsLock" hidden>Page block controls are a Pro feature. <a href="/dashboard/settings/billing?from=sections" id="sectionsUpgrade">Upgrade to unlock them</a>.</div></div>
<div class="card" data-egroup="design" id="prizesCard"><h3>Prize labels <span class="pill pill--info ml-6">PRO</span></h3><p class="card-sub">Customize the text labels shown next to prizes and the countdown timer.</p>
<div id="prizesBody">
<div class="grid2">
<div class="field"><label for="f_prizePoolLabel">Prize pool label</label><input type="text" id="f_prizePoolLabel" placeholder="Prize pool" /></div>
<div class="field"><label for="f_payoutsLabel">Payouts label</label><input type="text" id="f_payoutsLabel" placeholder="Payouts" /></div>
<div class="field"><label for="f_countdownLabel">Timer label</label><input type="text" id="f_countdownLabel" placeholder="Race ends in" /></div>
<div class="field"><label for="f_currency">Currency symbol</label><input type="text" id="f_currency" placeholder="$ / € / £" maxlength="6" /></div>
</div>
<label class="hint chk"><input type="checkbox" id="f_hidePrizeAmounts" /> Hide exact prize amounts from visitors</label>
</div>
<div class="empty upsell-card" id="prizesLock" hidden>Prize customization is a Pro feature. <a href="/dashboard/settings/billing?from=prizes" id="prizesUpgrade">Upgrade to unlock it</a>.</div></div>
<div class="design-group-heading" data-egroup="design"><h2>Content</h2></div>
<div class="card" data-egroup="design" id="socialsCard"><h3>Social links</h3><p class="card-sub">Add your social media profiles. Toggle each one on or off to control what appears on your page.</p>
<div class="socials-editor" id="socialsList"></div></div>
<h1 class="v3-section-title" data-egroup="share">Share</h1>
<div class="card" data-egroup="share" id="embedShareCard"><h2>Share your leaderboard</h2><p class="card-sub">Get your link, add it to your stream, or embed it on a website.</p>
<div class="v3-alert v3-alert--warning" id="sharePublishWarning" hidden role="status"><strong id="sharePublishWarningTitle">This site is not published.</strong><span id="sharePublishWarningBody">Visitors will receive a 404 until you publish it.</span><button class="btn btn--sm btn--accent" id="sharePublishAction" type="button">Publish site</button></div>
<div class="v3-alert v3-alert--success" id="publishHandoff" hidden role="status" aria-live="polite"><span><strong>It’s live.</strong> <code id="publishHandoffUrl"></code></span><span class="d-flex gap-8"><a class="btn btn--sm btn--ghost" id="publishHandoffOpen" target="_blank" rel="noopener noreferrer">Open</a><button class="btn btn--sm btn--accent" id="publishHandoffCopy" type="button">Copy link</button></span></div>
<div dangerouslySetInnerHTML={{ __html: OBS_TOOLS }}></div>
<div class="field"><label>Your public link</label><div class="d-flex gap-8 items-center flex-wrap"><code id="embedPublicLink" class="overlay-url"></code><button class="btn btn--sm btn--accent ic-btn" id="embedPublicCopy" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> Copy</button></div></div>
<div class="embed-obs-box"><div class="d-flex items-center gap-8 mb-8"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect width="20" height="14" x="2" y="3" rx="2" ry="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg><b class="font-14">Stream overlay</b></div><p class="hint mb-8">Add this URL as a Browser Source in OBS, Streamlabs, or any streaming software.</p><div class="field mb-8"><div class="d-flex gap-8 items-center flex-wrap"><code id="embedObsUrl" class="overlay-url"></code><button class="btn btn--sm btn--accent ic-btn" id="embedObsCopy" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> Copy</button></div></div><div class="embed-obs-row"><div><span class="hint">Width</span><div class="embed-obs-dim" id="embedObsWidth">1100px</div></div><div><span class="hint">Height</span><div class="embed-obs-dim" id="embedObsHeight">auto</div></div></div><div class="embed-tip"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="16" y2="12"/><line x1="12" x2="12.01" y1="8" y2="8"/></svg><span>For best results, uncheck "Shutdown source when not visible" in OBS so the overlay stays live while switching scenes.</span></div></div>
<div class="empty upsell-card" id="embedObsLock" hidden>Stream overlays are available on Starter and higher plans. <a href="/dashboard/settings/billing?from=overlay" id="overlayUpgrade">Upgrade your plan</a> to add this leaderboard to OBS, Streamlabs, or another streaming app.</div>
<details class="editor-more" data-editor-more="share-embed"><summary>Embed on a website</summary>
<div class="field"><span class="hint">Paste this code where you want the leaderboard to appear.</span><div class="embed-code-block" id="embedCodeBlock"><code id="embedCodeInline"></code><button class="embed-copy-btn" id="embedCodeCopy" type="button" aria-label="Copy embed code">Copy</button></div></div>
<div class="d-flex gap-8 flex-wrap"><label class="chk"><input type="checkbox" id="embedTransparent" /> Transparent background</label><label class="chk"><input type="checkbox" id="embedHideBranding" /> Remove YourRank branding</label></div></details>
<h3 class="m-0 mt-18 mb-8 font-14 fw-700">Share on social</h3>
<div class="share-cards" id="shareCards"><button class="share-card share-card--x" id="shareX" type="button"><span>Share on X</span></button><button class="share-card share-card--discord" id="shareDiscord" type="button"><span>Share on Discord</span></button><button class="share-card share-card--twitch" id="shareTwitch" type="button"><span>Share on Twitch</span></button><button class="share-card share-card--copy" id="shareCopy" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span>Copy link</span></button></div>
<details class="api-access-details" id="apiAccessDetails"><summary class="font-14 fw-600">Developer tools</summary><div class="api-access locked" id="apiAccess"><div><b class="font-14">REST API</b><p class="hint mt-4">Use the API to update scores automatically from your own system.</p></div><span class="api-lock-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Pro</span></div></details>
</div>
<h1 class="v3-section-title" data-egroup="history">History</h1>
<div class="card" data-egroup="history"><p class="card-sub">End the current round and keep its final standings. Nothing is deleted — the standings are saved first.</p>
<div class="arch-form">
<div class="field field-flex"><label for="a_label">Name this period</label><input id="a_label" placeholder="July 2026" /></div>
<div class="field m-0"><label for="a_clear">After archiving</label><select id="a_clear"><option value="wagers">Reset everyone's scores to zero</option><option value="players">Remove all players</option><option value="none">Keep the board as-is</option></select></div>
<button class="btn btn--accent self-end" id="a_go" type="button">Save &amp; archive this period</button>
</div>
<div class="arch-list" id="archList"></div>
<div class="v3-empty" id="archEmpty" hidden></div>
</div>
<div class="editor-savebar savebar" id="savebar" hidden><span class="savebar-hint">Unsaved changes</span><span class="savebar-ts" id="editorTimestamp"></span><button class="btn btn--ghost" id="discard" type="button">Discard changes</button><button class="btn btn--accent" id="save" type="button">Save changes</button></div>
</div>
<div class="design-preview">
<div class="card">
<div class="preview-header">
<div class="preview-header-text"><h2>Live Preview</h2><p class="preview-sub">Click elements on the board to edit them directly.</p></div>
<div class="preview-actions">
<div class="preview-tabs" role="tablist" aria-label="Preview device"><button class="preview-tab is-active" data-width="1100" data-device="desktop" type="button" role="tab" aria-selected="true">Desktop</button><button class="preview-tab" data-width="390" data-device="mobile" type="button" role="tab" aria-selected="false">Mobile</button></div>
<span class="v3-chip v3-chip--pro preview-sync" id="previewSyncStatus">SYNCED</span>
</div>
</div>
<div class="preview-sync-strip"><span><i aria-hidden="true"></i> PREVIEW MODE</span><small id="previewSyncTime">Last synced —</small></div>
<div class="preview-frame" id="previewFrame"><div class="preview-stage" id="previewStage"><iframe id="designPreview" name="designPreview" src="" loading="eager" title="Live preview" sandbox="allow-scripts allow-same-origin allow-popups-to-escape-sandbox"></iframe></div><div class="preview-error" id="previewError" hidden><p>Preview could not load. <button class="btn btn--sm" id="previewRetry" type="button">Retry</button></p></div></div>
<a class="preview-live-link" id="previewLiveLink" href="#" target="_blank" rel="noopener noreferrer">Open live page ↗</a>
</div>
</div>
</div>
</section>
  );
}

function GamesSection({ active } = {}) {
  return (
<section class={active ? "lb-page is-on" : "lb-page"} data-page="games">
<div class="v3-games-page">
    <div class="d-flex justify-between items-center flex-wrap gap-8">
      <div>
        <h1>Games</h1>
        <p class="v3-head-sub">Configure credit games and test gameplay in real-time</p>
      </div>
      <div class="d-flex gap-8 items-center">
        <a class="btn btn--sm btn--accent" id="gamesPreviewBtn" href="#" target="_blank" rel="noopener noreferrer">Open on Public Site ↗</a>
      </div>
    </div>
  <div class="v3-games-layout">
    <div class="v3-games-left">
      <div class="v3-table-card v3-game-card">
      <div class="v3-card-head"><div><h2>Game settings</h2><p class="v3-head-sub">Configure constraints for credit-based viewer games</p></div></div>
        <div id="gameSettingRows"></div>
        <div class="v3-note">All games use credits only. Outcomes are server-determined and provably fair.</div>
      </div>
      <div class="v3-table-card">
        <div class="v3-card-head"><div><h2>Public page visibility</h2><p class="v3-head-sub">Hiding or showing the public Shop, Rewards, and Games pages is a site setting.</p></div></div>
        <a class="btn btn--sm btn--accent" href="/dashboard/site?tab=sections">Manage public sections in Site settings →</a>
      </div>
    </div>
    <div class="v3-games-right">
      <div class="v3-table-card v3-games-preview-card">
        <div class="v3-card-head">
          <div>
            <h2>Live Game Preview</h2>
            <p class="v3-head-sub">Your live games page, exactly as a viewer sees it</p>
            <button class="btn btn--sm btn--ghost mt-8" id="gamesReloadPreview" type="button">🔄 Reload preview</button>
          </div>
          <div class="v3-game-preview-tabs" role="tablist" aria-label="Preview game selection">
            <button class="v3-game-preview-tab is-active" data-preview-game="mines" type="button" role="tab" aria-selected="true">💣 Mines</button>
            <button class="v3-game-preview-tab" data-preview-game="plinko" type="button" role="tab" aria-selected="false">🎯 Plinko</button>
            <button class="v3-game-preview-tab" data-preview-game="dice" type="button" role="tab" aria-selected="false">🎲 Dice</button>
          </div>
        </div>
        <div class="v3-games-preview-frame">
          <iframe id="gamesSimulatorIframe" src="" title="Live Games preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
        </div>
        <div class="v3-games-preview-foot">
          <span class="v3-hint">⚡ Live preview · bets here use real viewer credits</span>
          <a class="v3-game-popout-link" id="gamesPopoutLink" href="#" target="_blank" rel="noopener noreferrer">Pop out preview ↗</a>
        </div>
      </div>
    </div>
  </div>
</div>
</section>
  );
}

function AnalyticsSection({ active, activeHash = "activity" } = {}) {
  return (
<section class={active ? "lb-page is-on" : "lb-page"} data-page="performance">
<div class="v3-analytics-page">
  {/* The document's activeHash names the h1 even when it belongs to another
      section (a board tab on a leaderboard URL): the SSR'd heading has always
      reflected the address the document was opened on. */}
  <header class="v3-head"><h1>{chromeStateFor("performance", activeHash, { exact: true })?.tabLabel || chromeStateFor("board", activeHash, { exact: true })?.tabLabel || chromeStateFor("performance", "activity").tabLabel}</h1><p class="v3-head-sub">Understand what happened, where visitors came from, and what they did.</p></header>
  <div class="v3-analytics-scope"><span id="perfScope"><b id="perfBoardName">Active site</b><span aria-hidden="true"> · </span><span id="perfSelectedRange" hidden={activeHash === "referrals"}>Last <span id="perfRangeLabel">14</span> days</span><span id="perfSourcesRange" hidden={activeHash !== "referrals"}>Last 30 days</span></span><div id="perfRangeFilter" class="v3-range-filter" role="group" aria-label="Date range" hidden={activeHash === "referrals"}><button class="v3-range-btn" type="button" data-range="7">7 days</button><button class="v3-range-btn is-active" type="button" data-range="14">14 days</button><button class="v3-range-btn" type="button" data-range="30">30 days</button></div></div>
  <nav class="v3-tabs" aria-label="Analytics pages">
    <a class={"v3-tab" + (activeHash === "activity" ? " is-on" : "")} href="/dashboard/analytics/activity" data-perf-tab="activity" aria-current={activeHash === "activity" ? "page" : undefined}>Site visitors</a>
    <a class={"v3-tab" + (activeHash === "referrals" ? " is-on" : "")} href="/dashboard/analytics/referrals" data-perf-tab="referrals" aria-current={activeHash === "referrals" ? "page" : undefined}>Sources</a>
    <a class={"v3-tab" + (activeHash === "events" ? " is-on" : "")} href="/dashboard/analytics/events" data-perf-tab="events" aria-current={activeHash === "events" ? "page" : undefined}>Events</a>
  </nav>
  <dl class="v3-insight-band" data-perf-summary aria-label="Visitor summary" hidden={activeHash !== "activity"}>
    <div><dt>Site visits</dt><dd><strong id="perfKpiViews"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></strong><span class="v3-insight-change" id="perfKpiViewsDelta"></span></dd></div>
    <div><dt>Link clicks</dt><dd><strong id="perfKpiClicks"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></strong><span class="v3-insight-change" id="perfKpiClicksDelta"></span></dd></div>
    <div><dt>Link shares</dt><dd><strong id="perfKpiCopies"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></strong><span class="v3-insight-change" id="perfKpiCopiesDelta"></span></dd></div>
    <div><dt>Link click rate</dt><dd><strong id="perfKpiCtr"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></strong><span class="v3-insight-change" id="perfKpiCtrDelta"></span></dd></div>
  </dl>
  <div class="v3-perf-panel" data-perf-panel="activity" id="perf-activity">
    <div class="v3-table-card v3-chart-card"><div class="v3-card-head"><div><h2>Visits over time</h2><p class="v3-head-sub">See whether attention is growing, steady, or slowing down.</p></div><span class="v3-chart-total"><b id="perfTotalViews"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></b> total visits</span></div><div id="statBars" class="v3-line-chart" role="img" aria-label="Daily site visits over time"></div><div class="v3-empty" id="statsEmpty" hidden></div></div>
    <div class="v3-table-card v3-activity-table-card"><div class="v3-card-head"><div><h2>Daily activity</h2><p class="v3-head-sub">Compare visits with the actions people took each day.</p></div><a class="v3-btn" href="/api/site/stats/export" id="perfExport">Export CSV</a></div><div class="v3-table-scroll"><table class="v3-table"><thead><tr><th>Date</th><th class="num">Visits</th><th class="num">Link clicks</th><th class="num">Link shares</th><th class="num">Click rate</th></tr></thead><tbody id="perfActivityBody"></tbody></table></div><div class="v3-empty" id="perfActivityEmpty" hidden></div></div>
    <details class="v3-table-card v3-secondary-insight" id="perf-heatmap"><summary><span>When visitors come</span><small>Last 30 days · UTC</small></summary><div class="v3-secondary-insight-body"><p class="v3-head-sub">See which days and hours usually bring the most visits.</p><div class="heatmap-wrap"><div class="heatmap" id="perfHeatmapGrid"><span class="skeleton v3-skel-heatmap" aria-hidden="true"></span></div></div></div></details>
  </div>
  <div class="v3-perf-panel" data-perf-panel="referrals" id="perf-referrals" hidden>
    <div class="v3-table-card v3-source-list" id="perf-referrers"><div class="v3-card-head"><div><h2>Where visitors found you</h2><p class="v3-head-sub">Top sources reported by visitors' browsers. Direct visits are included in your visit total but do not name a source.</p></div></div><div class="v3-table-scroll"><table class="v3-table"><thead><tr><th>Source</th><th class="num">Visits</th></tr></thead><tbody id="perfReferrersBody"></tbody></table></div><div class="v3-empty" id="perfReferrersEmpty" hidden></div></div>
  </div>
  <div class="v3-perf-panel" data-perf-panel="events" id="perf-events" hidden><div class="v3-table-card v3-event-summary"><div class="v3-card-head"><div><h2>Actions people took</h2><p class="v3-head-sub">A grouped view of visits, link clicks, and shares in the selected period.</p></div></div><ul class="events-list" id="eventsList" aria-live="polite"></ul><div class="v3-empty" id="eventsEmpty" hidden></div></div></div>
  <details class="metric-glossary"><summary>How Analytics counts activity</summary><dl><div><dt>Site visits</dt><dd>How many times someone opened your public site.</dd></div><div><dt>Link clicks</dt><dd>How many times someone clicked a sponsor or share link.</dd></div><div><dt>Link shares</dt><dd>How many times someone copied your site link to share it.</dd></div><div><dt>Link click rate</dt><dd>Link clicks as a percentage of site visits in the selected period.</dd></div><div><dt>Sources</dt><dd>Websites that sent visitors to your site when their browser reports one.</dd></div></dl></details>
</div>
</section>
  );
}

function BoardSettingsSection({ active } = {}) {
  return (
<section class={active ? "lb-page is-on" : "lb-page"} data-page="site">
<div class="v3-settings">
  <header class="v3-head">
    <h1>Site settings</h1>
    <p class="v3-head-sub" id="settingsSubline">Control the selected site's access, public pages, notifications, domain, and data. Personal settings and billing live in <a href="/dashboard/settings/account">Account</a>.</p>
  </header>
  <div class="v3-tabs" role="tablist" aria-label="Site settings sections">
    <button class="v3-tab is-on" id="settingsTabAccess" type="button" role="tab" aria-selected="true" aria-controls="settingsPanelAccess" data-settings-tab="access">Access</button>
    <button class="v3-tab" id="settingsTabSections" type="button" role="tab" aria-selected="false" aria-controls="settingsPanelSections" data-settings-tab="sections">Pages</button>
    <button class="v3-tab" id="settingsTabNotifications" type="button" role="tab" aria-selected="false" aria-controls="settingsPanelNotifications" data-settings-tab="notifications">Notifications</button>
    <button class="v3-tab" id="settingsTabDomain" type="button" role="tab" aria-selected="false" aria-controls="settingsPanelDomain" data-settings-tab="domain">Domain</button>
    <button class="v3-tab" id="settingsTabTools" type="button" role="tab" aria-selected="false" aria-controls="settingsPanelTools" data-settings-tab="tools">Advanced</button>
    <button class="v3-tab" id="settingsTabDanger" type="button" role="tab" aria-selected="false" aria-controls="settingsPanelDanger" data-settings-tab="danger">Danger zone</button>
  </div>
  <div class="v3-settings-save" id="settingsSaveBar" hidden>
    <p id="settingsSaveText">Use Save changes after updating these settings.</p>
    <button class="btn btn--accent" id="settingsSave" type="button" disabled>Save changes</button>
  </div>
  <section class="v3-settings-panel" id="settingsPanelAccess" role="tabpanel" aria-labelledby="settingsTabAccess" data-settings-panel="access">
    <div class="v3-settings-card">
      <div class="v3-settings-card-head"><div><h2>Who can view this site?</h2><p>Choose whether anyone with the link can view it or a password is required.</p></div></div>
      <div class="v3-settings-row"><div><b>Visibility and password</b><p>Site name, public address, publication, and password controls stay together in the site editor.</p></div><a class="v3-set-btn v3-set-btn--outline" id="settingsBoardAccessLink" href="/dashboard/leaderboard/setup">Manage access</a></div>
    </div>
  </section>
  <section class="v3-settings-panel" id="settingsPanelSections" role="tabpanel" aria-labelledby="settingsTabSections" data-settings-panel="sections" hidden>
    <div class="v3-settings-card"><div class="v3-settings-card-head"><div><h2>Public page sections</h2><p>Choose which destinations appear on your public site. Turning one off also disables its public address.</p></div></div><div id="siteSectionRows"></div></div>
    <div class="v3-settings-card"><div class="v3-settings-card-head"><div><h2>Leaderboard page blocks</h2><p>Current block visibility on your leaderboard page. Edit the layout itself in Appearance.</p></div><span class="v3-chip v3-chip--pro">Pro</span></div><div class="v3-block-grid" id="leaderboardBlockRows"></div><div class="v3-note" id="leaderboardBlockNote">Block visibility follows your site settings.</div><a class="btn btn--sm btn--accent mt-12" href="/dashboard/leaderboard/design">Edit layout &amp; blocks in Appearance →</a></div>
    <details class="v3-settings-card v3-settings-disclosure"><summary>Legal pages</summary><div class="v3-settings-disclosure-body"><p class="v3-settings-muted">Add the legal links shown in your public site footer.</p><div class="v3-settings-legal"><div id="legalList"></div><div id="legalFooterPreview" class="v3-settings-muted"></div></div></div></details>
  </section>
  <section class="v3-settings-panel" id="settingsPanelNotifications" role="tabpanel" aria-labelledby="settingsTabNotifications" data-settings-panel="notifications" hidden>
    <div class="v3-settings-card">
      <div class="v3-settings-card-head"><div><h2>Where should YourRank send updates?</h2><p>Send reset and top-three activity to the services your community already uses.</p></div></div>
      <div class="v3-settings-row v3-settings-row--top"><div><b>Discord</b><p>Send updates to a Discord channel.</p></div><input class="v3-toggle" id="settingsWebhookEnabled" type="checkbox" aria-label="Send site updates to Discord" /></div>
      <div class="v3-settings-notify-body" id="notifyBody">
        <div class="v3-settings-field">
          <label class="v3-settings-label" for="f_webhook">Discord webhook URL</label>
          <div class="v3-settings-inline-form"><input id="f_webhook" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="Paste the webhook URL from Discord" /><button class="v3-set-btn v3-set-btn--outline" id="testDiscord" type="button">Send test</button><span class="v3-settings-status" id="testDiscordStatus" role="status" aria-live="polite"></span></div>
        </div>
        <details class="v3-settings-help"><summary>How to find the webhook URL</summary><p class="v3-settings-muted">In Discord, open Channel settings, then Integrations and Webhooks. Create or open a webhook and copy its URL.</p></details>
      </div>
      <div class="v3-settings-inline" id="notifyLock" hidden>Discord notifications are available on Pro. <a href="/dashboard/settings/billing?from=notifications">View billing</a>.</div>
      <div class="v3-settings-divider"></div>
      <div class="v3-settings-notify-account">
        <div><b>Telegram</b><p class="v3-settings-muted">Send updates to a Telegram group you manage.</p></div>
        <label class="v3-settings-label" for="f_tgChatId">Telegram group ID</label>
        <input id="f_tgChatId" autocomplete="off" inputmode="numeric" placeholder="Enter the group or chat ID" />
        <label class="v3-settings-check"><input type="checkbox" id="f_tgNotify" /> Send site updates to this group</label>
        <div class="v3-settings-actions"><button class="v3-set-btn v3-set-btn--outline" id="testTelegram" type="button">Send test</button><span class="v3-settings-status" id="testTelegramStatus" role="status" aria-live="polite"></span></div>
        <details class="v3-settings-help"><summary>How to find the group ID</summary><p class="v3-settings-muted">Use @getidsbot in Telegram, then paste the group ID here.</p></details>
      </div>
    </div>
  </section>
  <section class="v3-settings-panel" id="settingsPanelTools" role="tabpanel" aria-labelledby="settingsTabTools" data-settings-panel="tools" hidden>
    <div class="v3-settings-card"><div class="v3-settings-card-head"><div><h2>Advanced site tools</h2><p>Connections and stream tools that support this selected site.</p></div></div><div class="v3-settings-row"><div><b>Kick channel rewards</b><p>Let viewers earn credits by claiming Kick channel rewards.</p><span class="v3-settings-muted" id="kickStatus"><span class="skeleton skeleton-text" aria-hidden="true"></span></span></div><a class="v3-set-btn v3-set-btn--outline" href="/dashboard/site/connections" id="kickRewardsLink">Manage connection</a></div><div class="v3-settings-row"><div><b>Automatic score updates</b><p id="postbackStatus">Let a sponsor send score updates without manual imports. The private connection belongs to your account.</p></div><a class="v3-set-btn v3-set-btn--outline" href="/dashboard/settings/connections">Manage connection</a></div><div class="v3-settings-row"><div><b>Stream overlay</b><p>Get the browser-source link for OBS, Streamlabs, or another streaming app.</p></div><a class="v3-set-btn v3-set-btn--outline" href="/dashboard/leaderboard/share">Open sharing</a></div></div>
  </section>
  <section class="v3-settings-panel" id="settingsPanelDomain" role="tabpanel" aria-labelledby="settingsTabDomain" data-settings-panel="domain" hidden>
    <div class="v3-settings-card v3-domain-overview" id="domainOverviewCard">
      <div><span class="v3-settings-eyebrow">Current domain</span><h2 id="domainOverviewTitle">Checking your domain…</h2><p id="domainOverviewText">Your default yourrank.site address remains available while we check for a custom domain.</p></div>
      <span class="v3-settings-status-text" id="domainOverviewStatus" role="status" aria-live="polite">Checking</span>
    </div>
    <div class="v3-settings-card" id="domainManageCard" hidden>
      <div class="v3-settings-card-head">
        <div>
          <h2>Your custom domain</h2>
          <p>This is the public address connected to the selected site.</p>
        </div>
        <span class="v3-chip v3-chip--fulfilled" id="domainManageBadge">Active</span>
      </div>
      <div class="domain-info-box">
        <div class="domain-info-row"><span>Domain</span><strong id="domainManageName">—</strong></div>
        <div class="domain-info-row"><span>Renews</span><span id="domainManageExpiry">—</span></div>
      </div>
      <details class="v3-settings-help v3-domain-transfer"><summary>Transfer this domain</summary><div class="domain-info-row"><span>Transfer lock</span><span id="domainManageLockStatus">Enabled</span></div><div class="d-flex gap-8 mt-12 flex-wrap"><button class="btn btn--sm" id="domainToggleLockBtn" type="button">Unlock for transfer</button><button class="btn btn--sm btn--accent" id="domainGetAuthCodeBtn" type="button">Get transfer code</button></div></details>
      <div class="v3-settings-divider"></div>
      <button class="btn btn--sm btn--danger-outline" id="domainDisconnectBtn" type="button">Disconnect domain</button>
      <div id="domainManageStatus" class="v3-settings-status mt-8" role="status"></div>
    </div>

    <div class="v3-settings-card" id="domainConnectCard">
      <div class="v3-settings-card-head">
        <div>
          <h2>Connect a domain you own</h2>
          <p>Use a domain from your current provider, such as GoDaddy, Namecheap, or Cloudflare.</p>
        </div>
      </div>
      <div id="domainBody">
        <label class="v3-settings-label" for="f_domain">Domain</label>
        <input id="f_domain" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="board.mystream.com" />
        <div class="v3-settings-actions"><button class="v3-set-btn v3-set-btn--dark" id="domainVerify" type="button">Check connection</button><div id="domainStatus" class="v3-settings-status" role="status" aria-live="polite"></div></div>
        <details class="v3-settings-help"><summary>DNS setup</summary><p class="v3-settings-muted">Add a CNAME record at your domain provider that points to <code>yourrank.site</code>, then return here to check the connection.</p></details>
      </div>
      <div class="v3-settings-inline" id="domainLock" hidden>Custom domains are a Pro feature. <a href="/dashboard/settings/billing?from=domain">Upgrade to unlock it</a>.</div>
    </div>
    <details class="v3-settings-card v3-settings-disclosure" id="domainBuyCard">
      <summary>Buy a new domain</summary>
      <div class="v3-settings-disclosure-body" id="domainSearchBody">
        <p class="v3-settings-muted">Search for a domain and connect it to this site. DNS and SSL setup are handled automatically.</p>
        <div class="domain-search-bar"><label class="sr-only" for="domainSearchInput">Search for a domain</label><input id="domainSearchInput" autocomplete="off" spellcheck="false" placeholder="Search a name, such as mystream" /><button class="btn btn--accent" id="domainSearchBtn" type="button">Search domains</button></div>
        <div id="domainSearchResults" class="domain-results-grid" hidden></div>
        <div id="domainSearchStatus" class="v3-settings-status" role="status" aria-live="polite"></div>
      </div>
    </details>
  </section>
  <section class="v3-settings-panel" id="settingsPanelDanger" role="tabpanel" aria-labelledby="settingsTabDanger" data-settings-panel="danger" hidden>
    <div class="v3-settings-card v3-danger-card"><div class="v3-settings-card-head"><div><h2>Danger zone</h2><p>These actions permanently change or remove data for the selected site.</p></div></div><div class="v3-settings-row"><div><b>Reset site data</b><p>Archive this period, then remove all players, scores, prize amounts, and activity history.</p></div><button class="v3-set-btn v3-set-btn--danger-outline" id="settingsResetData" type="button">Reset data</button></div><div class="v3-settings-row"><div><b>Delete this site</b><p>Permanently delete this site and its settings. This cannot be undone.</p></div><button class="v3-set-btn v3-set-btn--danger" id="settingsDeleteBoard" type="button">Delete site</button></div></div>
  </section>
</div>
</section>
  );
}

function BoardsSection({ active } = {}) {
  return (
<section class={active ? "lb-page is-on" : "lb-page"} data-page="boards">
 <header class="v3-head v3-head--row"><div><h1>Sites</h1><p class="v3-head-sub">Every site is a public leaderboard page your viewers can open.</p></div><button class="btn btn--sm btn--accent" id="newBoard" type="button" title="Create a site">Create site</button></header>
 <div class="board-upsell" id="boardLimitUpsell" role="status" hidden><div><b id="boardLimitTitle">Need another site?</b><p class="hint" id="boardLimitText"></p></div><a class="btn btn--sm btn--accent" id="boardLimitCta" href="/dashboard/settings">Upgrade plan</a></div>
 <div class="lb-board-form" id="newBoardForm" hidden><div class="field field-flex"><label for="nb_name">Site name</label><input id="nb_name" placeholder="Summer Race 2026" /></div><div class="field field-flex"><label for="nb_slug">Public link</label><input id="nb_slug" placeholder="summer-race-2026" /><span class="hint">We’ll create yourrank.site/this-link.</span></div><div class="field field-flex"><label for="nb_casino">Partner or sponsor <span class="hint">Optional</span></label><input id="nb_casino" placeholder="Your brand or sponsor" /></div><div class="field field-flex"><label for="nb_code">Promo code <span class="hint">Optional</span></label><input id="nb_code" placeholder="Optional" /></div><div class="lb-board-form-actions"><button class="btn btn--sm btn--accent" id="nb_create" type="button">Create site</button><button class="btn btn--sm btn--ghost" id="nb_cancel" type="button">Cancel</button><div class="hint w-full" id="nb_err" role="alert" aria-live="assertive"></div></div></div>
 <div class="sites-list">
<div class="list-controls"><input type="search" id="boardsSearch" class="list-search" placeholder="Find a site…" aria-label="Find a site" /></div>
<table class="v3-table sites-table">
<thead><tr><th>Site</th><th>Status</th><th>Players</th><th class="ta-r">Actions</th></tr></thead>
<tbody id="boardsBody"></tbody>
</table>
<div id="boardsEmpty" class="v3-empty" hidden></div>
</div>
</section>
  );
}

const SECTIONS = {
  home: OverviewSection,
  board: EditorSection,
  games: GamesSection,
  performance: AnalyticsSection,
  site: BoardSettingsSection,
  boards: BoardsSection,
};

export function DashboardContent({ user, activePath } = {}) {
  const { activeNav, activeHash } = dashboardShellRoute(activePath);
  const sections = ROUTE_SECTIONS[activeNav] || ROUTE_SECTIONS.home;
  return (
    <>
      <div id="loading" class="yr-workspace-loader" role="status" aria-live="polite" aria-busy="true"><span class="sr-only">Loading your dashboard…</span>
<div class="yr-loader-lockup">
{raw(brandLoaderLogoSvg())}
<p id="loadingStatus">Loading your workspace…</p>
<div class="yr-loader-track" aria-hidden="true"><i></i></div>
<small>Creator workspace</small>
</div>
</div>
<DashboardShell activeNav={activeNav} activePath={activePath} boardContext="full" crumbs={chromeStateFor(activeNav, activeHash, { exact: true })?.crumbs || null} footer="dashboard" initiallyHidden user={user}>
<div class="lb-notice lb-notice--verification" id="verifyBanner" hidden role="status" aria-live="polite"><span class="lb-notice-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/></svg></span><div class="lb-notice-copy"><strong>Public leaderboard offline until you verify</strong><span id="verifyBannerText">Visitors cannot open your published leaderboard until you verify <b id="verifyBannerEmail"></b>.</span><span id="verifyBannerStatus"></span></div><button class="btn btn--sm btn--ghost" id="verifyResend" type="button">Resend verification</button><button class="btn btn--sm btn--ghost" id="verifyDismiss" type="button" aria-label="Dismiss email verification notice">Dismiss</button></div>
  {sections.map((key) => {
    const Section = SECTIONS[key];
    return <Section active={key === activeNav} activeHash={activeHash} showTabs />;
  })}
{/* Dynamic content region for fragment-loaded sections (Rewards, Engagement,
    Audience, Account). Hidden by default; shown by the dynamic-section loader
    when navigating to those areas, hidden again when returning to SPA sections. */}
<div id="lbDynamic" class="lb-dynamic-region" hidden aria-live="polite"></div>
    </DashboardShell>
    </>
  );
}

export function DashboardNotFoundContent({ user } = {}) {
  return (
    <DashboardShell activeNav="home" boardContext="none" footer="dashboard" rootId="dashboard-not-found" user={user}>
      <section class="lb-page is-on" data-page="not-found">
        <header class="v3-head">
          <p class="v3-head-kicker">404 · Dashboard</p>
          <h1>This dashboard page doesn't exist</h1>
          <p class="v3-head-sub">The address may be outdated, or the page may have moved.</p>
        </header>
        <div class="card">
          <h2>Try one of these destinations</h2>
          <nav class="v3-tabs" aria-label="Dashboard destinations">
            <a class="v3-tab is-on" href="/dashboard">Home</a>
            <a class="v3-tab" href="/dashboard/leaderboard/setup">Leaderboard</a>
            <a class="v3-tab" href="/dashboard/leaderboards">Sites</a>
            <a class="v3-tab" href="/dashboard/settings/account">Account</a>
          </nav>
        </div>
      </section>
    </DashboardShell>
  );
}

export const dashboardNotFoundConfig = {
  ...dashboardConfig,
  title: "Dashboard page not found · YourRank",
  scripts: ['<script src="/assets/shell-nav.js?v=3" defer></script>'],
  bootWatchdog: false,
  configFor: undefined,
};

export const dashboardPage = { config: dashboardConfig, configFor: dashboardConfig.configFor, Component: DashboardContent };
export const dashboardNotFoundPage = { config: dashboardNotFoundConfig, Component: DashboardNotFoundContent };
