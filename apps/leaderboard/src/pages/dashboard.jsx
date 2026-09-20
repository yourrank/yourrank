/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import { raw } from "hono/html";
import { VIEWER_TEMPLATES } from "@yourrank/shared/viewer-templates";
import { DashboardShell } from "./dashboard-shell.jsx";

import { brandLoaderLogoSvg } from "@yourrank/shared/brand-assets";
import { chromeStateFor, dashboardPath, dashboardTitleForPath, defaultTab, parseDashboardPath, SECTIONS as DASHBOARD_SECTIONS } from "../assets/dashboard/routes.js";
import { DEFAULT_DASHBOARD_TITLE } from "@yourrank/shared/dashboard-chrome-state";


export const dashboardConfig = {
  title: DEFAULT_DASHBOARD_TITLE,
  canonical: "https://yourrank.site/dashboard",
  styles: ["/assets/app.css", "/assets/shell-nav.css", "/assets/ui.css", "/assets/dashboard-v4.css"],
  scripts: ['<script src="/assets/dashboard.js?v=18" type="module"></script>', '<script src="/assets/dashboard/preview-tabs.js?v=2" type="module"></script>', '<script src="/assets/shell-nav.js?v=4" defer></script>'],
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

const BOARD_LEGACY_TABS = new Set(["history"]);

function LeaderboardTabs({ active }) {
  const legacyActive = BOARD_LEGACY_TABS.has(active);
  const tabLink = ([key, label, href]) => {
    const legacy = BOARD_LEGACY_TABS.has(key);
    return <a class={"editor-step v3-tab" + (key === active ? " is-active is-on" : "")} href={href} data-egroup={key} data-tabs-legacy={legacy ? true : undefined} hidden={legacy && !legacyActive ? true : undefined} aria-current={key === active ? "page" : undefined}>{label}</a>;
  };
  return <nav class="editor-steps v3-tabs" id="editorTabs" aria-label="My board sections">
    {BOARD_TABS.flatMap((tab) => BOARD_LEGACY_TABS.has(tab[0])
      ? [<button class="v3-tab" type="button" data-tabs-more aria-expanded={legacyActive ? "true" : "false"}>More</button>, tabLink(tab)]
      : [tabLink(tab)])}
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
<header class="v3-head ov-head v3-head--row"><div class="ov-identity"><span class="ov-avatar" aria-hidden="true"><img id="ovSiteLogo" alt="" hidden /><span id="ovSiteInitial">Y</span></span><div><h1>Home</h1><p class="ov-scope"><strong id="ovSiteName">Checking…</strong><span id="ovOperatorContext" hidden></span></p><p class="v3-head-sub" id="ovHeadSub">Your community at a glance.</p></div></div><span class="ov-status" id="ovStatus" data-state="checking"><i aria-hidden="true"></i><span id="ovPublishedStatus">Checking…</span></span></header>
<section class="ov-setup" id="ovSetup" aria-labelledby="ovSetupTitle" hidden><div class="ov-setup-head"><div><h2 id="ovSetupTitle">Get your community ready</h2><p id="ovSetupMessage">Add players and publish to open your site.</p></div><a class="btn btn--accent" id="ovSetupAction" href="/dashboard/site" hidden>Continue setup</a></div><details class="ov-setup-details"><summary>Launch checklist <span class="ov-setup-count" id="ovSetupCount">0 of 3 done</span></summary><ul class="ov-setup-list" id="ovSetupList" aria-label="Setup steps"></ul></details></section>
<section class="ov-operations ov-attention" id="ovAttention" aria-labelledby="ovAttentionTitle" role="region" aria-live="polite" aria-atomic="false" hidden>
  <header class="ov-operations-head"><div><h2 id="ovAttentionTitle">Needs attention</h2><p>Work that is waiting for you on this site.</p></div><span class="ov-operation-count" id="ovAttentionCount">0 items</span></header>
  <div class="ov-attention-list">
    <div class="v3-alert v3-alert--warning ov-attention-row" id="ovPendingOrdersAlert" hidden><span><b id="ovPendingOrdersAlertCount">0</b> <span id="ovPendingOrdersAlertLabel">pending claims need review.</span></span><a class="btn btn--sm btn--ghost" id="ovPendingOrdersAlertAction" href="/dashboard/rewards/redemptions">Review claims</a></div>
    <div class="v3-alert v3-alert--warning ov-attention-row" id="ovConnectionAlert" hidden><span><b>Kick rewards need attention.</b> <span id="ovConnectionAlertDetail">Reconnect Kick to keep active reward grants working.</span></span><a class="btn btn--sm btn--ghost" id="ovConnectionAlertAction" href="/dashboard/site/connections">Open Connections</a></div>
    <div class="v3-alert v3-alert--warning ov-attention-row" id="ovAutomationAlert" hidden><span><b id="ovAutomationAlertTitle">Scheduled Activity needs attention.</b> <span id="ovAutomationAlertDetail">Review its status before choosing a new future time.</span></span><a class="btn btn--sm btn--ghost" id="ovAutomationAlertAction" href="/dashboard/activities">Review schedule</a></div>
    <div class="v3-alert v3-alert--warning ov-attention-row" id="ovInvitesAlert" hidden><span><b id="ovInvitesAlertCount">0</b> <span id="ovInvitesAlertLabel">pending invites are waiting for teammates to accept.</span></span><a class="btn btn--sm btn--ghost" id="ovInvitesAlertAction" href="/dashboard/settings/team">Review invites</a></div>
  </div>
</section>
<section class="ov-operations ov-happening-now" id="ovHappeningNow" aria-labelledby="ovHappeningNowTitle" hidden>
  <header class="ov-operations-head"><div><h2 id="ovHappeningNowTitle">Happening now</h2><p id="ovHappeningNowSummary">Open Activities on this site.</p></div><a class="btn btn--sm" id="ovHappeningNowAction" href="/dashboard/activities">Open Activities</a></header>
  <div class="ov-live-list" id="ovHappeningNowList"></div>
</section>
<section class="ov-coming-next" id="ovComingNext" aria-labelledby="ovComingNextTitle" hidden><div><h2 id="ovComingNextTitle">Coming next</h2><p id="ovComingNextDetail">—</p></div><a class="btn btn--sm" id="ovComingNextAction" href="/dashboard/activities">Open Activities</a></section>
<section class="ov-next-step" id="ovNextStep" aria-labelledby="ovNextStepTitle" hidden><div class="ov-next-step-copy"><h2 id="ovNextStepTitle">—</h2><p id="ovNextStepBody">—</p></div><a class="btn btn--sm btn--accent" id="ovNextStepAction" href="#">—</a></section>
<section class="ov-figures" id="ovFigures" aria-label="Selected site summary">
  <div class="ov-figure">
    <span class="ov-figure-lbl" id="ovLblViews">Visits this week</span>
    <span class="ov-figure-val" id="ovViews14" aria-labelledby="ovLblViews"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></span>
  </div>
  <div class="ov-figure">
    <span class="ov-figure-lbl" id="ovLblPlayers">Players</span>
    <span class="ov-figure-val" id="ovPlayersCount" aria-labelledby="ovLblPlayers"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></span>
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
<header class="v3-section-head" data-egroup="setup"><h1 class="v3-section-title">Setup</h1><p>Choose how this leaderboard ranks players and when the current period runs.</p></header>
<section class="card event-boards" id="eventBoards" data-egroup="setup" aria-labelledby="eventBoardsTitle">
<h2 id="eventBoardsTitle">Events</h2><p class="card-sub">Run Event A, Event B and more inside this site. Each has its own points. Viewers switch between published events on your Leaderboard page.</p>
<div class="field"><label for="eventBoardSelect">Choose an event to edit</label><select id="eventBoardSelect"><option value="">Create event…</option></select></div>
<form id="eventBoardForm"><div class="field"><label for="eventBoardName">Event name</label><input id="eventBoardName" required maxlength="80" placeholder="e.g. Community challenge" /></div>
<div class="field"><label for="eventBoardPlayers">Players and points</label><textarea id="eventBoardPlayers" rows="5" placeholder={'Alex, 250\nSam, 180'} aria-describedby="eventPlayersHint"></textarea><span class="hint" id="eventPlayersHint">One player per line: name, points. Higher points rank first; tied points share a rank. These points are separate from viewer credits.</span></div>
<label class="chk"><input id="eventBoardPublished" type="checkbox" /> Show this event on the public site</label>
<div class="event-board-actions"><button class="btn btn--accent" id="eventBoardSave" type="submit">Save event</button><button class="btn btn--danger" id="eventBoardDelete" type="button" hidden>Delete event</button></div>
<p id="eventBoardStatus" class="status" role="status" aria-live="polite"></p></form></section>
<aside class="v3-owner-note" data-egroup="setup" aria-label="Site identity owner"><div><strong>Public identity is managed in Site pages.</strong><span>Name, tagline, logo, colors and links apply across every public page.</span></div><button class="btn btn--sm btn--accent" id="setupBrandLink" type="button" data-identity-edit>Edit site identity</button></aside>
<div class="card" data-egroup="setup"><h2>Leaderboard basics</h2><p class="card-sub">Set the ranking rule, prize summary and end time visitors will see.</p><div class="grid2">
<div class="field"><label for="f_rank_by">Rank players by</label><select id="f_rank_by"><option value="score">Points / score</option><option value="wagered">Amount</option></select><span class="hint">Players with the same value share a rank.</span></div>
<div class="field"><label for="f_pool">Award or prize pool (optional)</label><input id="f_pool" placeholder="Optional" /></div>
<div class="field"><label for="f_period">Leaderboard period</label><select id="f_period"><option>Weekly</option><option selected>Monthly</option><option>Season</option></select></div>
<div class="field"><label for="f_ends">Period ends</label><input id="f_ends" type="datetime-local" aria-describedby="f_ends_hint f_ends_error" /><span class="hint" id="f_ends_hint">Shown in your timezone. After this time, final standings stay visible and automated score updates stop.</span><span class="field-err" id="f_ends_error" data-field-error="f_ends" hidden role="alert" aria-live="polite"></span></div>
</div>
<details class="editor-more" data-editor-more="setup-schedule"><summary>Start date and automatic restart</summary><div class="grid2">
<div class="field"><label for="f_starts">Period starts <span class="hint">Optional</span></label><input id="f_starts" type="datetime-local" aria-describedby="f_starts_hint f_starts_error" /><span class="hint" id="f_starts_hint">Shown in your timezone.</span><span class="field-err" id="f_starts_error" data-field-error="f_starts" hidden role="alert" aria-live="polite"></span></div>
<div class="field field--full"><label class="chk"><input type="checkbox" id="f_auto_reset" /> Automatically start a new race when this one ends</label><label class="sr-only" for="f_auto_reset_clear">What to reset when the race ends</label><select id="f_auto_reset_clear" disabled class="mt-8"><option value="wagers">Reset everyone's scores to zero</option><option value="players">Remove all players and start fresh</option><option value="none">Keep everything as-is</option></select><span class="hint">Your current standings will be saved automatically before the reset.</span></div></div></details></div>
<div class="card" data-egroup="setup" id="leaderboardTypesCard"><h2>Leaderboards</h2><p class="card-sub">Viewers switch between these on the public Leaderboard page. Main is always shown while "Show Leaderboard" is on.</p>
<div class="sections-editor" id="leaderboardTypesList">
<div class="section-row lb-type-row" data-leaderboard-type="main"><span class="lb-type-copy"><span class="section-name">Main</span><span class="hint">Manual/API ranking</span></span><span class="pill pill--info">Always on</span></div>
<div class="section-row lb-type-row" data-leaderboard-type="loyalty"><span class="lb-type-copy"><span class="section-name">Loyalty</span><span class="hint">Ranks viewers by lifetime credits earned. Spending credits never lowers a rank.</span></span><span class="lb-type-control"><label class="switch" title="Show Loyalty leaderboard"><input type="checkbox" id="f_loyalty_board" role="switch" aria-label="Show Loyalty leaderboard" aria-describedby="f_loyalty_board_state" /><span class="switch-track"></span></label><span class="hint" id="f_loyalty_board_state">Off</span></span></div>
</div></div>
<details class="editor-more editor-more--standalone" data-egroup="setup" data-editor-more="setup-sponsor"><summary>Sponsor and promo code</summary><div class="grid2">
<div class="field"><label for="f_casino">Sponsor name</label><input id="f_casino" placeholder="Your brand or sponsor" /></div>
<div class="field"><label for="f_code">Promo code</label><input id="f_code" placeholder="Optional" /></div>
<div class="field"><label for="f_cta">Sponsor website</label><input id="f_cta" placeholder="https://example.com" /></div>
<div class="field field--full"><label for="f_blurb">About your sponsor</label><textarea id="f_blurb" rows="2" placeholder="Short pitch about the sponsor and your code (optional)."></textarea></div></div></details>
<div class="card" data-egroup="setup"><h2>Who can see this site</h2><p class="card-sub">Your site is open to anyone with the link once you publish it.</p>
<div class="field field--full m-0"><label class="chk"><input type="checkbox" id="f_password_enabled" /> Require a password to view this site</label><label class="sr-only" for="f_password">Site password</label><input id="f_password" type="password" placeholder="Leave blank to keep current password" disabled class="mt-8" /><span class="hint">Visitors must enter this password before seeing the leaderboard.</span></div></div>
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
<select class="v3-select" id="playerSort" aria-label="Sort players"><option value="score">Sort by: Score</option><option value="name">Sort by: Name</option><option value="wagered">Sort by: Amount</option><option value="prize">Sort by: Prize</option></select>
<div class="v3-players-bar-end">
<button class="v3-btn v3-btn--accent" id="addRow" type="button">Add player</button>
<div class="v3-menu-wrap"><button class="v3-btn" id="colDropdownBtn" type="button" aria-haspopup="true" aria-expanded="false"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/></svg>Columns</button>
<div class="v3-menu" id="colMenu" hidden><label class="v3-menu-item"><input type="checkbox" data-col="score" /> Score</label><label class="v3-menu-item"><input type="checkbox" data-col="hands" /> Hands played</label><label class="v3-menu-item"><input type="checkbox" data-col="netProfit" /> Net profit</label><label class="v3-menu-item"><input type="checkbox" data-col="winRate" /> Win rate</label><label class="v3-menu-item"><input type="checkbox" data-col="change" /> Change</label></div></div>
<div class="v3-menu-wrap"><button class="v3-btn" id="importMenuBtn" type="button" aria-haspopup="true" aria-expanded="false"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/></svg>Import</button>
<div class="v3-menu v3-menu--dark v3-menu--end" id="importMenu" hidden><button class="v3-menu-item" id="importPasteBtn" type="button">Paste from Excel or Google Sheets</button><button class="v3-menu-item" id="csvImportBtn" type="button">Upload a file (.csv)</button><button class="v3-menu-item" id="gsheetBtn" type="button">Link a Google Sheet</button><div class="v3-menu-sep"></div><button class="v3-menu-item" id="csvExportBtn" type="button">Download as spreadsheet</button><button class="v3-menu-item v3-menu-item--accent" id="csvTemplateBtn" type="button">Download blank template</button></div></div>
</div>
</div>
<div class="v3-table-card">
<div class="v3-table-scroll" id="playersTableWrap"><table class="v3-table v3-players-table"><thead><tr><th class="sel"><input type="checkbox" id="selectAll" title="Select all" aria-label="Select all players" data-no-dirty /></th><th class="rank">Rank</th><th class="player-name">Player</th><th class="num col-legacy">Amount</th><th class="num col-legacy">Prize</th><th class="num col-score" hidden>Score</th><th class="num col-hands" hidden>Hands played</th><th class="num col-net" hidden>Net profit</th><th class="num col-win" hidden>Win rate</th><th class="num col-change" hidden>Change</th><th class="act">Edit</th></tr></thead><tbody id="rows"></tbody><tfoot id="quickAdd"><tr><td class="sel"></td><td class="rank"></td><td class="player-name" data-label="Player"><input id="qa_name" class="p-name" maxlength="160" placeholder="New player" aria-label="New player name" aria-describedby="qa-name-counter qa-name-error qa-name-warning" /><span class="player-name-counter" id="qa-name-counter" hidden aria-live="polite"></span><span class="field-err" data-field-error="qa_name" id="qa-name-error" hidden role="alert" aria-live="polite"></span><span class="field-warn" data-field-warning="qa_name" id="qa-name-warning" hidden role="status" aria-live="polite"></span></td><td class="num col-legacy" data-label="Amount"><input id="qa_wager" inputmode="decimal" placeholder="0" aria-label="New player amount" aria-describedby="qa-wager-error" /><span class="field-err" data-field-error="qa_wager" id="qa-wager-error" hidden role="alert" aria-live="polite"></span></td><td class="num col-legacy" data-label="Prize"><input id="qa_prize" inputmode="decimal" placeholder="0" aria-label="New player prize" aria-describedby="qa-prize-error" /><span class="field-err" data-field-error="qa_prize" id="qa-prize-error" hidden role="alert" aria-live="polite"></span></td><td class="num col-score" data-label="Score" hidden><input id="qa_score" inputmode="decimal" placeholder="0" aria-label="New player score" aria-describedby="qa-score-error" /><span class="field-err" data-field-error="qa_score" id="qa-score-error" hidden role="alert" aria-live="polite"></span></td><td class="num col-hands" data-label="Hands played" hidden></td><td class="num col-net" data-label="Net profit" hidden></td><td class="num col-win" data-label="Win rate" hidden></td><td class="num col-change" data-label="Change" hidden></td><td class="act" data-label="Add player"><span class="field-warn" id="quickLimitMsg" hidden role="status" aria-live="polite"></span><button class="v3-btn v3-btn--xs" id="qa_add" type="button">Add player</button></td></tr></tfoot></table></div>
<div class="v3-table-foot" id="playersFoot"><span id="playersShowing">No players</span><span class="v3-pager"><button class="v3-btn v3-btn--sm" id="playersPrev" type="button">Previous</button><button class="v3-btn v3-btn--sm" id="playersNext" type="button">Next</button></span></div>
<div id="playersEmpty" class="v3-empty" hidden>
<span class="v3-empty-ic" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
<h2>No players yet</h2>
<p>Add the first player and their current value. You can import a spreadsheet later.</p>
<div class="v3-empty-actions"><button class="v3-btn v3-btn--accent" id="emptyAddBtn" type="button">Add first player</button><button class="v3-btn" id="emptyImportBtn" type="button">Import players</button></div>
</div>
</div>
<div class="v3-players-foot"><input type="file" id="csvFileInput" accept=".csv,.tsv,.txt" hidden /><span id="limitMsg" class="hint ml-auto c-muted" role="status" aria-live="polite"></span></div>
<div class="import" id="importPanel" hidden>
<p class="hint mb-8">Paste directly from Excel or Google Sheets. For a normal leaderboard, use <strong>Name</strong> and <strong>Score</strong>. Historical Amount and Prize columns are still recognized when present.</p>
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
<aside class="v3-owner-note" data-egroup="design" aria-label="Site identity owner"><div><strong>Public identity is managed in Site.</strong><span>Name, tagline, logo, colors and social links apply across every public page.</span></div><button class="btn btn--sm btn--accent" id="designBrandLink" type="button" data-identity-edit>Edit site identity</button></aside>
<div class="appearance-owner-row" data-egroup="design" id="playerFieldsCard"><div><h2>Leaderboard columns</h2><p>Choose which supporting values appear beside each player.</p></div><a class="btn btn--sm btn--ghost" id="playerFieldsLink" href="/dashboard/leaderboard/players">Manage in Players</a></div>
<div class="design-group-heading" data-egroup="design"><h2>Page design</h2></div>
<div class="card" data-egroup="design" id="sectionsCard"><h3>Layout &amp; blocks <span class="pill pill--info ml-6">PRO</span></h3><p class="card-sub">Choose what appears on your public page.</p>
<div id="sectionsBody"><div class="sections-editor" id="sectionsList"></div></div>
<div class="empty upsell-card" id="sectionsLock" hidden>Page block controls are a Pro feature. <a href="/dashboard/settings/billing?from=sections" id="sectionsUpgrade">Upgrade to unlock them</a>.</div></div>
<div class="card" data-egroup="design" id="rulesCard"><div class="d-flex gap-8 items-center justify-between"><h3>Rules</h3><label class="switch" title="Show the Rules block on your public leaderboard"><input type="checkbox" id="f_rules_enabled" role="switch" aria-label="Show Rules block" /><span class="switch-track"></span></label></div><p class="card-sub">Your own rules for this leaderboard, shown in the collapsible Rules block. One rule per line; leave empty to hide the block.</p>
<div class="field"><label for="f_rules">Rules (one per line)</label><textarea id="f_rules" rows="5" maxlength="20000" placeholder="How players get on the board
How ties are handled
Who is eligible"></textarea></div></div>
<div class="card" data-egroup="design" id="prizesCard"><h3>Prize labels <span class="pill pill--info ml-6">PRO</span></h3><p class="card-sub">Customize the text labels shown next to prizes and the countdown timer.</p>
<div id="prizesBody">
<div class="grid2">
<div class="field"><label for="f_prizePoolLabel">Prize pool label</label><input type="text" id="f_prizePoolLabel" placeholder="Prize pool" /></div>
<div class="field"><label for="f_payoutsLabel">Payouts label</label><input type="text" id="f_payoutsLabel" placeholder="Payouts" /></div>
<div class="field"><label for="f_countdownLabel">Timer label</label><input type="text" id="f_countdownLabel" placeholder="Race ends in" /></div>
<div class="field"><label for="f_currency">Currency symbol</label><input type="text" id="f_currency" placeholder="$ / € / £" maxlength="6" /></div>
</div>
<div class="field"><label for="f_payoutNote">Prize pool note</label><textarea id="f_payoutNote" rows="2" maxlength="300" placeholder="Shown with the prize pool. Leave empty for the default sentence."></textarea></div>
<label class="hint chk"><input type="checkbox" id="f_hidePrizeAmounts" /> Hide exact prize amounts from visitors</label>
</div>
<div class="empty upsell-card" id="prizesLock" hidden>Prize customization is a Pro feature. <a href="/dashboard/settings/billing?from=prizes" id="prizesUpgrade">Upgrade to unlock it</a>.</div></div>
<h1 class="v3-section-title" data-egroup="share">Share</h1>
<div class="card" data-egroup="share" id="embedShareCard"><h2>Share your leaderboard</h2><p class="card-sub">Get your link, add it to your stream, or embed it on a website.</p>
<div class="v3-alert v3-alert--warning" id="sharePublishWarning" hidden role="status"><strong id="sharePublishWarningTitle">This site is not published.</strong><span id="sharePublishWarningBody">Visitors will receive a 404 until you publish it.</span><button class="btn btn--sm btn--accent" id="sharePublishAction" type="button">Publish site</button></div>
<div class="v3-alert v3-alert--success" id="publishHandoff" hidden role="status" aria-live="polite"><span><strong>It’s live.</strong> <code id="publishHandoffUrl"></code></span><span class="d-flex gap-8"><a class="btn btn--sm btn--ghost" id="publishHandoffOpen" target="_blank" rel="noopener noreferrer">Open</a><button class="btn btn--sm btn--accent" id="publishHandoffCopy" type="button">Copy link</button></span></div>
<div class="field"><label>Your public link</label><div class="d-flex gap-8 items-center flex-wrap"><code id="embedPublicLink" class="overlay-url"></code><button class="btn btn--sm btn--accent ic-btn" id="embedPublicCopy" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> Copy</button></div></div>
<div class="card" data-egroup="share" id="overlayDesignerCard"><h3>Leaderboard overlay</h3><p class="card-sub">Position the overlay on a 1920 × 1080 stream canvas, then copy the OBS link — the preview is the live overlay itself.</p>
<div class="overlay-designer" id="overlayDesigner">
  <div class="od-canvas" id="odCanvas">
    <iframe id="odFrame" title="Live overlay preview" loading="lazy"></iframe>
    <button type="button" class="od-handle" id="odHandle" aria-label="Overlay position. Drag or use arrow keys to move the overlay on the stream canvas."><span aria-hidden="true">⠿</span> Overlay</button>
  </div>
  <div class="od-controls">
    <div class="field"><label for="odLayout">Widget</label><select class="v3-select" id="odLayout"><option value="card">Podium card</option><option value="ticker">Ticker bar</option></select></div>
    <div class="field od-switch"><label for="odAnimate">Animation</label><span class="od-switch-row"><input class="v3-toggle" id="odAnimate" type="checkbox" role="switch" checked aria-describedby="odAnimateState" /><span class="hint" id="odAnimateState">On</span></span></div>
    <div class="field"><label for="odScale">Scale</label><select class="v3-select" id="odScale"><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option></select></div>
    <div class="field od-num"><label for="odX">X %</label><input id="odX" type="number" min="5" max="95" step="1" aria-label="Overlay X position in percent" /></div>
    <div class="field od-num"><label for="odY">Y %</label><input id="odY" type="number" min="5" max="95" step="1" aria-label="Overlay Y position in percent" /></div>
    <div class="od-actions"><button class="btn btn--sm btn--accent" id="odCopy" type="button">Copy OBS link</button><button class="btn btn--sm btn--ghost" id="odReset" type="button">Reset</button></div>
  </div>
  <p class="hint" id="odHint">In OBS, add the copied link as a Browser Source sized 1920 × 1080 with “Shutdown source when not visible” unchecked, so it stays live across scene switches.</p>
</div>
<div class="empty upsell-card" id="embedObsLock" hidden>Stream overlays are available on Pro and Team. <a href="/dashboard/settings/billing?from=overlay" id="overlayUpgrade">Upgrade your plan</a> to add this leaderboard to OBS, Streamlabs, or another streaming app.</div></div>
<details class="editor-more" data-editor-more="share-embed"><summary>Embed on a website</summary>
<div class="field"><span class="hint">Paste this code where you want the leaderboard to appear.</span><div class="embed-code-block" id="embedCodeBlock"><code id="embedCodeInline"></code><button class="embed-copy-btn" id="embedCodeCopy" type="button" aria-label="Copy embed code">Copy</button></div></div>
<div class="d-flex gap-8 flex-wrap"><label class="chk"><input type="checkbox" id="embedTransparent" /> Transparent background</label><label class="chk"><input type="checkbox" id="embedHideBranding" /> Remove YourRank branding</label></div></details>
<h3 class="share-section-title fw-700">Share on social</h3>
<div class="share-cards" id="shareCards"><button class="share-card share-card--x" id="shareX" type="button"><span>Share on X</span></button><button class="share-card share-card--discord" id="shareDiscord" type="button"><span>Share on Discord</span></button><button class="share-card share-card--twitch" id="shareTwitch" type="button"><span>Share on Twitch</span></button><button class="share-card share-card--copy" id="shareCopy" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span>Copy link</span></button></div>
<details class="editor-more api-access-details" id="apiAccessDetails"><summary>Developer tools</summary><div class="api-access locked" id="apiAccess"><div class="api-access-head"><div><b class="font-14">REST API</b><p class="hint mt-4" id="apiAccessSub">Use the API to update leaderboard scores from your own system.</p></div><span class="api-lock-badge" id="apiLockBadge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Pro &amp; Team</span></div>
<p class="hint api-access-locked-note" id="apiLockedNote">Available on Pro and Team. <a href="/dashboard/settings/billing?from=api" id="apiUpgrade">Upgrade your plan</a> to update scores from your own system.</p>
<div class="api-access-setup" id="apiSetup" hidden>
<div class="field"><label>Endpoint</label><code class="overlay-url api-endpoint">POST /api/scores</code></div>
<div class="field"><label for="apiKeyValue">Postback key</label><div class="d-flex gap-8 items-center flex-wrap"><code class="overlay-url api-key" id="apiKeyValue" data-masked="1" aria-live="polite">••••••••••••••••••••</code><button class="btn btn--sm btn--ghost" id="apiKeyReveal" type="button" aria-pressed="false">Reveal</button><button class="btn btn--sm btn--accent" id="apiKeyCopy" type="button">Copy</button></div><p class="hint mt-4" id="apiKeyHint"></p></div>
<div class="d-flex gap-8 items-center flex-wrap"><button class="btn btn--sm btn--ghost" id="apiKeyRotate" type="button">Rotate key</button><a class="btn btn--sm btn--ghost" href="/api/docs" target="_blank" rel="noopener noreferrer" id="apiDocsLink">Documentation →</a></div>
<p class="hint api-access-signing">Send <code>X-Postback-Key</code> with your key and <code>X-Postback-Signature</code> with the hex HMAC-SHA256 of the raw JSON body, signed with the key. Include <code>slug</code> or <code>siteId</code> in the body.</p>
</div>
<p class="hint api-access-locked-note" id="apiRoleNote" hidden>Only the board owner can view or rotate the API key.</p>
</div></details>
</div>
<header class="v3-section-head" data-egroup="history"><h1 class="v3-section-title">History</h1><p>Close the current period and keep a dated copy of its final standings.</p></header>
<section class="history-workspace" data-egroup="history" aria-label="Leaderboard history">
<div class="arch-form">
<div class="field field-flex"><label for="a_label">Name this period</label><input id="a_label" placeholder="July 2026" /></div>
<div class="field m-0"><label for="a_clear">After archiving</label><select id="a_clear"><option value="wagers">Reset everyone's scores to zero</option><option value="players">Remove all players</option><option value="none">Keep the board as-is</option></select></div>
<button class="btn btn--accent self-end" id="a_go" type="button">Close period</button>
</div>
<div class="history-list-head"><h2>Closed periods</h2><p>Restore a period to the editor or remove it permanently.</p></div>
<div class="arch-list" id="archList"></div>
<div class="v3-empty" id="archEmpty" hidden></div>
</section>
<div class="editor-savebar savebar" id="savebar" hidden><span class="savebar-hint">Unsaved changes</span><span class="savebar-ts" id="editorTimestamp"></span><button class="btn btn--ghost" id="discard" type="button">Discard changes</button><button class="btn btn--accent" id="save" type="button">Save changes</button></div>
</div>
<div class="design-preview" data-preview-column data-preview-reserve="56">
<div class="card preview-mount" data-preview-mount="board" data-preview-target="designPreview" data-preview-label-syncing="Updating" data-preview-label-synced="Up to date">
<div class="preview-header">
<div class="preview-header-text"><h2>Draft preview</h2><p class="preview-sub">Your current edits, rendered by the same renderer visitors see. Publish to put them live.</p></div>
<div class="preview-actions">
<div class="preview-tabs" role="tablist" aria-label="Preview device" data-preview-default-device="auto"><button class="preview-tab is-active" data-width="1100" data-device="desktop" type="button" role="tab" aria-selected="true">Desktop</button><button class="preview-tab" data-width="820" data-device="tablet" type="button" role="tab" aria-selected="false">Tablet</button><button class="preview-tab" data-width="390" data-device="mobile" type="button" role="tab" aria-selected="false">Mobile</button></div>
<span class="v3-chip v3-chip--pro preview-sync" id="previewSyncStatus" data-preview-status role="status" aria-live="polite">Preparing preview…</span>
<button class="btn btn--sm btn--ghost preview-expand" id="previewExpand" type="button" data-preview-expand>Open large preview</button>
</div>
</div>
<div class="preview-sync-strip"><span><i aria-hidden="true"></i> Draft preview</span><span class="preview-publication" id="previewPublication" data-preview-publication></span><small id="previewSyncTime" data-preview-time>Last updated —</small></div>
<div class="preview-frame" id="previewFrame" data-preview-frame><div class="preview-stage" id="previewStage" data-preview-stage>{/* SEC-005-v8: allow-same-origin is required so the parent can read the preview document (diagnosePreviewDocument) and receive postMessage edits from the draft. The preview source is the same origin, so this combination is the intended architecture, not a sandbox escape risk. */}<iframe id="designPreview" name="designPreview" loading="eager" title="Live preview" sandbox="allow-scripts allow-same-origin allow-popups-to-escape-sandbox"></iframe></div><div class="preview-error" id="previewError" data-preview-error role="status" aria-live="polite" hidden><p><span data-preview-error-message>Preview could not load. Retry to try again.</span> <button class="btn btn--sm" id="previewRetry" type="button" data-preview-retry>Retry</button></p></div></div>
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
        <a class="btn btn--sm btn--accent" href="/dashboard/site?tab=customize">Manage public sections in Site settings →</a>
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
  <header class="v3-head"><h1 id="perfTitle">{chromeStateFor("performance", activeHash, { exact: true })?.tabLabel || chromeStateFor("performance", "activity").tabLabel}</h1><p class="v3-head-sub">Community growth, participation and rewards.</p></header>
  <div class="v3-analytics-scope"><span id="perfScope"><b id="perfBoardName">Active site</b><span aria-hidden="true"> · </span><span id="perfSelectedRange" hidden={activeHash === "referrals"}>Last <span id="perfRangeLabel">30</span> days · UTC</span><span id="perfSourcesRange" hidden={activeHash !== "referrals"}>Last 30 days · UTC</span></span><div id="perfRangeFilter" class="v3-range-filter" role="group" aria-label="Date range" hidden={activeHash === "referrals"}><button class="v3-range-btn" type="button" data-range="7">7 days</button><button class="v3-range-btn is-active" type="button" data-range="30">30 days</button></div></div>
  <nav class="v3-tabs" aria-label="Stats pages">
    <a class={"v3-tab" + (activeHash === "activity" ? " is-on" : "")} href="/dashboard/analytics/activity" data-perf-tab="activity" aria-current={activeHash === "activity" ? "page" : undefined}>Overview</a>
    <button class="v3-tab" type="button" data-tabs-more aria-expanded={activeHash === "referrals" || activeHash === "events" ? "true" : "false"}>More</button>
    <a class={"v3-tab" + (activeHash === "referrals" ? " is-on" : "")} href="/dashboard/analytics/referrals" data-perf-tab="referrals" data-tabs-legacy hidden={activeHash !== "referrals" && activeHash !== "events" ? true : undefined} aria-current={activeHash === "referrals" ? "page" : undefined}>Traffic sources</a>
    <a class={"v3-tab" + (activeHash === "events" ? " is-on" : "")} href="/dashboard/analytics/events" data-perf-tab="events" data-tabs-legacy hidden={activeHash !== "referrals" && activeHash !== "events" ? true : undefined} aria-current={activeHash === "events" ? "page" : undefined}>Public site activity</a>
  </nav>
  <dl class="v3-insight-band" data-perf-summary aria-label="Visitor summary" hidden>
    <div><dt>Site visits</dt><dd><strong id="perfKpiViews"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></strong><span class="v3-insight-change" id="perfKpiViewsDelta"></span></dd></div>
    <div><dt>Link clicks</dt><dd><strong id="perfKpiClicks"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></strong><span class="v3-insight-change" id="perfKpiClicksDelta"></span></dd></div>
    <div><dt>Link shares</dt><dd><strong id="perfKpiCopies"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></strong><span class="v3-insight-change" id="perfKpiCopiesDelta"></span></dd></div>
    <div><dt>Link click rate</dt><dd><strong id="perfKpiCtr"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></strong><span class="v3-insight-change" id="perfKpiCtrDelta"></span></dd></div>
  </dl>
  <div class="v3-perf-panel" data-perf-panel="activity" id="perf-activity">
    <div id="insightsStatus" class="v3-empty" role="status" aria-live="polite" hidden></div>
    <div class="insights-question-list" id="insightsQuestions" aria-busy="true">
      <section aria-labelledby="insightsCommunityTitle"><header><h2 id="insightsCommunityTitle">Your community</h2><p>Members who joined or returned in this period.</p><p id="insightsCommunityStatus" class="v3-head-sub" role="status" hidden></p></header><dl><div><dt>New members</dt><dd><strong id="insightsNewMembers"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></strong><span>Joined during this window</span></dd></div><div><dt>Returning members</dt><dd><strong id="insightsReturningMembers"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></strong><span>Joined earlier and came back in this window</span></dd></div></dl></section>
      <section class="insights-participation" aria-labelledby="insightsParticipationTitle"><header><h2 id="insightsParticipationTitle">Code-drop participation</h2><p>See whether members come back for another drop.</p><p id="insightsParticipationStatus" class="v3-head-sub" role="status" hidden></p></header><div class="insights-repeat" id="insightsRepeatVisual" aria-live="polite"><p>Loading participation…</p></div><dl><div><dt>Participants</dt><dd><strong id="insightsParticipants"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></strong><span>Members who claimed a code drop</span></dd></div><div><dt>Repeat participants</dt><dd><strong id="insightsRepeatParticipants"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></strong><span>Claimed two or more different drops</span></dd></div><div><dt>Active drops</dt><dd><strong id="insightsActiveDrops"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></strong><span>Drops with at least one claim</span></dd></div></dl></section>
      <section aria-labelledby="insightsRewardsTitle"><header><h2 id="insightsRewardsTitle">Reward claims</h2><p>Claims from the selected site's free-credit shop.</p><p id="insightsRewardsStatus" class="v3-head-sub" role="status" hidden></p></header><dl><div><dt>Claims submitted</dt><dd><strong id="insightsClaimsSubmitted"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></strong><span>Created during this window</span></dd></div><div><dt>Claims completed</dt><dd><strong id="insightsClaimsCompleted"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></strong><span>Completed during this window</span></dd></div><div><dt>Most claimed reward</dt><dd><strong class="insights-reward-name" id="insightsTopReward"><span class="skeleton v3-skel-line" aria-hidden="true"></span></strong><span id="insightsTopRewardDetail">Non-cancelled claims</span></dd></div></dl></section>
      <section class="insights-operations" aria-labelledby="insightsOperationsTitle"><header><h2 id="insightsOperationsTitle">Needs attention</h2><p>Open work right now · all dates</p></header><dl><div><dt>Reviews</dt><dd><strong id="insightsPendingReviews"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></strong><a class="btn btn--sm" href="/dashboard/audience/reviews">Open Reviews</a></dd></div><div><dt>Claims</dt><dd><strong id="insightsPendingClaims"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></strong><a class="btn btn--sm" href="/dashboard/rewards/redemptions">Open Claims</a></dd></div></dl></section>
    </div>
    <div class="v3-table-card v3-chart-card"><div class="v3-card-head"><div><h2>Public site visits</h2><p class="v3-head-sub">A secondary view of visits to the selected site's public page.</p></div><span class="v3-chart-total"><b id="perfTotalViews"><span class="skeleton v3-skel-kpi" aria-hidden="true"></span></b> total visits</span></div><div id="statBars" class="v3-line-chart" role="img" aria-label="Daily site visits over time"></div><div class="v3-empty" id="statsEmpty" hidden></div></div>
    <details class="v3-table-card v3-secondary-insight v3-activity-table-card"><summary><span>Daily public-site activity</span><small>Visits, link clicks, and shares</small></summary><div class="v3-secondary-insight-body"><div class="v3-table-scroll"><table class="v3-table"><thead><tr><th>Date</th><th class="num">Visits</th><th class="num">Link clicks</th><th class="num">Link shares</th><th class="num">Click rate</th></tr></thead><tbody id="perfActivityBody"></tbody></table></div><div class="v3-empty" id="perfActivityEmpty" hidden></div><div class="gw-pager" id="perfActivityPager" hidden></div></div></details>
    <details class="v3-table-card v3-secondary-insight" id="perf-heatmap"><summary><span>When visitors come</span><small>Last 30 days · UTC</small></summary><div class="v3-secondary-insight-body"><p class="v3-head-sub">See which days and hours usually bring the most visits.</p><div class="heatmap-wrap"><div class="heatmap" id="perfHeatmapGrid"><span class="skeleton v3-skel-heatmap" aria-hidden="true"></span></div></div></div></details>
  </div>
  <div class="v3-perf-panel" data-perf-panel="referrals" id="perf-referrals" hidden>
    <div class="v3-table-card v3-source-list" id="perf-referrers"><div class="v3-card-head"><div><h2>Where visitors found you</h2><p class="v3-head-sub">Top sources reported by visitors' browsers. Direct visits are included in your visit total but do not name a source.</p></div></div><div class="v3-table-scroll"><table class="v3-table"><thead><tr><th>Source</th><th class="num">Visits</th></tr></thead><tbody id="perfReferrersBody"></tbody></table></div><div class="v3-empty" id="perfReferrersEmpty" hidden></div></div>
  </div>
  <div class="v3-perf-panel" data-perf-panel="events" id="perf-events" hidden><div class="v3-table-card v3-event-summary"><div class="v3-card-head"><div><h2>Actions people took</h2><p class="v3-head-sub">A grouped view of visits, link clicks, and shares in the selected period.</p></div></div><ul class="events-list" id="eventsList" aria-live="polite"></ul><div class="v3-empty" id="eventsEmpty" hidden></div></div></div>
  <details class="metric-glossary"><summary>How Insights counts activity</summary><dl><div><dt>New members</dt><dd>Non-system members whose selected-site membership was created in the window.</dd></div><div><dt>Returning members</dt><dd>Members who joined before the window and whose latest authenticated site visit falls inside it.</dd></div><div><dt>Participants</dt><dd>Distinct non-system members who claimed at least one code drop in the window.</dd></div><div><dt>Repeat participants</dt><dd>Members who claimed at least two different code drops in the window.</dd></div><div><dt>Claims completed</dt><dd>Distinct selected-site Claims with a recorded completion event in the window. Completions from before completion events were recorded may not appear.</dd></div><div><dt>Operations</dt><dd>Current pending Reviews and Claims. These counts are not limited by the date window.</dd></div><div><dt>Public site visits</dt><dd>How many times someone opened the selected site's public page.</dd></div></dl></details>
</div>
</section>
  );
}

function BoardSettingsSection({ active } = {}) {
  return (
<section class={active ? "lb-page is-on" : "lb-page"} data-page="site">
<div class="v3-settings">
  <header class="v3-head v3-head--row">
    <div>
      <h1>Site pages</h1>
      <p class="v3-head-sub" id="settingsSubline">Manage the public identity and pages viewers see for the selected site. Personal settings and billing live in <a href="/dashboard/settings/account">Account</a>.</p>
    </div>
    <a class="btn btn--sm" id="sitePublicSiteAction" href="#" target="_blank" rel="noopener noreferrer">View public site ↗</a>
  </header>
  <div class="v3-tabs" role="tablist" aria-label="Site sections">
    <button class="v3-tab is-on" id="settingsTabCustomize" type="button" role="tab" aria-selected="true" aria-controls="settingsPanelCustomize" data-settings-tab="customize">Public site</button>
    <button class="v3-tab" id="settingsTabFeedback" type="button" role="tab" aria-selected="false" aria-controls="settingsPanelFeedback" data-settings-tab="feedback">Feedback</button>
    <button class="v3-tab" id="settingsTabMore" type="button" data-tabs-more aria-expanded="false">More</button>
    <button class="v3-tab" id="settingsTabNotifications" type="button" role="tab" aria-selected="false" aria-controls="settingsPanelNotifications" data-settings-tab="notifications" data-tabs-legacy hidden>Notifications</button>
    <button class="v3-tab" id="settingsTabDomain" type="button" role="tab" aria-selected="false" aria-controls="settingsPanelDomain" data-settings-tab="domain" data-tabs-legacy hidden>Domain</button>
    <button class="v3-tab" id="settingsTabTools" type="button" role="tab" aria-selected="false" aria-controls="settingsPanelTools" data-settings-tab="tools" data-tabs-legacy hidden>Advanced</button>
    <button class="v3-tab" id="settingsTabDanger" type="button" role="tab" aria-selected="false" aria-controls="settingsPanelDanger" data-settings-tab="danger" data-tabs-legacy hidden>Danger zone</button>
  </div>
  <div class="v3-settings-save" id="settingsSaveBar" hidden>
    <p id="settingsSaveText">Use Save changes after updating these settings.</p>
    <button class="btn btn--accent" id="settingsSave" type="button" disabled>Save changes</button>
  </div>
  <section class="v3-settings-panel" id="settingsPanelCustomize" role="tabpanel" aria-labelledby="settingsTabCustomize" data-settings-panel="customize">
    <div class="v3-customize">
      <div class="v3-customize-preview">
        <div class="v3-settings-card preview-mount" data-preview-mount="site" data-preview-target="sitePreview" data-preview-edit="0" data-preview-label-syncing="Updating preview…" data-preview-label-synced="Preview matches your changes">
          <div class="preview-header">
            <div class="preview-header-text"><h2 id="sitePreviewTitle">Viewer preview</h2><p class="preview-sub">Your real public site, rendered with the changes on this page.</p></div>
            <div class="preview-actions">
              <div class="preview-tabs" role="tablist" aria-label="Preview viewport" data-preview-default-device="auto"><button class="preview-tab is-active" data-width="1100" data-device="desktop" type="button" role="tab" aria-selected="true">Desktop</button><button class="preview-tab" data-width="390" data-device="mobile" type="button" role="tab" aria-selected="false">Mobile</button></div>
              <button class="btn btn--sm btn--ghost" id="sitePreviewRefresh" type="button" data-preview-retry>Refresh preview</button>
            </div>
          </div>
          <div class="preview-sync-strip"><span><i aria-hidden="true"></i> PREVIEW MODE</span><small id="sitePreviewStatus" data-preview-status role="status" aria-live="polite">Preparing preview…</small></div>
          <div class="preview-frame" id="sitePreviewFrame" data-preview-frame><div class="preview-stage" id="sitePreviewStage" data-preview-stage>{/* SEC-005-v8: allow-same-origin is required so the parent can read the preview document (diagnosePreviewDocument) and receive postMessage edits from the draft. The preview source is the same origin, so this combination is the intended architecture, not a sandbox escape risk. */}<iframe id="sitePreview" name="sitePreview" loading="eager" title="Public site preview" sandbox="allow-scripts allow-same-origin allow-popups-to-escape-sandbox"></iframe></div><div class="preview-error" id="sitePreviewError" data-preview-error role="status" aria-live="polite" hidden><p><span data-preview-error-message>Preview could not load. Retry to try again.</span> <button class="btn btn--sm" type="button" data-preview-retry>Try again</button></p></div></div>
        </div>
      </div>
      <div class="v3-customize-controls">
        <div class="v3-settings-card" id="siteIdentityCard">
          <div class="v3-settings-card-head"><div><h2>Name and tagline</h2><p>Viewers see these at the top of every public page.</p></div></div>
          <div class="v3-settings-field">
            <label class="v3-settings-label" for="f_name">Site name</label>
            <input id="f_name" maxlength="80" autocomplete="off" aria-describedby="siteNameCounter siteNameError" />
            <span class="v3-settings-muted" id="siteNameCounter" role="status" aria-live="polite"></span>
            <span class="field-err" id="siteNameError" data-field-error="f_name" role="alert" hidden></span>
          </div>
          <div class="v3-settings-field">
            <label class="v3-settings-label" for="f_tagline">Tagline <span class="v3-settings-muted">Optional</span></label>
            <input id="f_tagline" maxlength="120" autocomplete="off" placeholder="Stream community leaderboard" aria-describedby="siteTaglineHint siteTaglineCounter" />
            <span class="v3-settings-muted" id="siteTaglineHint">Short line shown under your name. Long taglines are shortened on your public site.</span>
            <span class="v3-settings-muted" id="siteTaglineCounter" role="status" aria-live="polite"></span>
          </div>
        </div>
        <div class="v3-settings-card" id="brandCard">
          <div class="v3-settings-card-head"><div><h2>Brand</h2><p>Your viewer template, logo, accent color and text style.</p></div><span class="v3-chip v3-chip--pro">Pro</span></div>
          <div id="brandBody">
            <div class="v3-settings-field">
              <label class="v3-settings-label" for="f_viewerTemplate">Viewer template</label>
              <select id="f_viewerTemplate" aria-describedby="siteTemplateHint siteTemplateScope">{VIEWER_TEMPLATES.map(template => <option value={template.value}>{template.name}</option>)}</select>
              <span class="v3-settings-muted" id="siteTemplateHint" role="status" aria-live="polite">{VIEWER_TEMPLATES[0].description}</span>
              <span class="v3-settings-muted" id="siteTemplateScope">Applies to this site's viewer pages. Check the preview, then save your choice.</span>
            </div>
            <div class="v3-settings-field">
              <label class="v3-settings-label" for="logoFile">Logo</label>
              <div class="logo-row"><img id="logoPreview" class="logo-preview" alt="Your current logo" hidden /><input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp" aria-describedby="siteLogoHint" hidden /><button class="btn btn--sm" id="logoPick" type="button">Upload logo</button><button class="btn btn--sm btn--ghost" id="logoClear" type="button" hidden>Remove logo</button></div>
              <span class="v3-settings-muted" id="siteLogoHint">PNG, JPG or WebP, up to 2 MB. Shows in your page header and as the link preview image.</span>
              <span class="v3-settings-status" id="logoStatus" role="status" aria-live="polite"></span>
            </div>
            <div class="v3-settings-field">
              <span class="v3-settings-label" id="siteAccentLabel">Accent color</span>
              <div class="preset-list" id="colorPresets" role="group" aria-labelledby="siteAccentLabel"></div>
              <span class="v3-settings-muted">Used for active navigation, buttons and highlights.</span>
              <details class="advanced-colors"><summary>Custom accent color</summary>
              <div class="color-row"><label for="c_a" class="sr-only">Accent color</label><input type="color" id="c_a" value="#5b5bf5" /><button class="btn btn--sm btn--ghost" id="colorsReset" type="button">Reset</button></div>
              </details>
            </div>
            <div class="v3-settings-field">
              <label class="v3-settings-label" for="f_font">Text style</label>
              <select id="f_font" aria-describedby="siteFontHint"><option value="Inter">Inter — Default</option><option value="Oswald">Oswald — Bold &amp; Sporty</option><option value="Playfair Display">Playfair Display — Premium &amp; Elegant</option><option value="Rajdhani">Rajdhani — Techy &amp; Esports</option><option value="Bebas Neue">Bebas Neue — Impact &amp; Hype</option></select>
              <span class="v3-settings-muted" id="siteFontHint">Text style applies to creator names and display headings. Body text stays easy to read.</span>
            </div>
          </div>
          <div class="v3-settings-inline" id="brandLock" hidden>Branding is a Pro feature. <a href="/dashboard/settings/billing?from=branding" id="brandUpgrade">Upgrade to Pro to unlock branding</a>.</div>
        </div>
        <div class="v3-settings-card" id="siteNavigationCard">
          <div class="v3-settings-card-head"><div><h2>Navigation</h2><p>Choose which destinations appear on your public site. Turning one off also disables its public address.</p></div></div>
          <div id="siteSectionRows"></div>
          <div class="v3-settings-row"><div><b>Leaderboard appearance</b><p>Layout, page blocks and prize labels are managed with the leaderboard.</p></div><a class="v3-set-btn v3-set-btn--outline" href="/dashboard/leaderboard/design">Open Appearance</a></div>
        </div>
        <details class="v3-settings-card v3-settings-disclosure" id="siteLinksCard">
          <summary>Channels and social links</summary>
          <p class="form-help">Add each channel URL and turn it on, then publish your changes. Enabled links appear in the navigation on all viewer pages when Show Social Links is on in Appearance.</p>
          <div class="v3-settings-disclosure-body"><p class="v3-settings-muted">Add the channels viewers should follow. Only the ones you switch on appear publicly.</p>
          <div class="socials-editor" id="socialsList"></div>
          </div>
        </details>
        <div class="v3-settings-card" id="siteContactCard">
          <div class="v3-settings-card-head"><div><h2>Contact methods</h2><p>How members reach you about rewards and claims. You handle reward fulfillment; YourRank handles account and website issues. At least one method is required to publish a reward.</p></div></div>
          <div class="grid2" id="siteContactFields"></div>
        </div>
        <div class="v3-settings-card" id="sitePublicAddressCard">
          <div class="v3-settings-card-head"><div><h2>Public address</h2><p>This is where viewers find your site.</p></div></div>
          <div class="v3-settings-address">
            <code id="sitePublicUrl">Loading your address…</code>
            <div class="v3-settings-actions">
              <button class="btn btn--sm" id="sitePublicCopy" type="button">Copy link</button>
              <a class="btn btn--sm" id="sitePublicOpen" href="#" target="_blank" rel="noopener noreferrer">Open site ↗</a>
            </div>
          </div>
          <p class="v3-settings-status" id="sitePublicCopyStatus" role="status" aria-live="polite"></p>
          <div class="v3-settings-row" data-ui-advanced><div><b>Custom domain</b><p id="sitePublicDomainSummary">Checking your domain…</p></div><button class="v3-set-btn v3-set-btn--outline" id="sitePublicDomainManage" type="button" data-settings-tab-link="domain">Manage domain</button></div>
        </div>
        <div class="v3-settings-card"><div class="v3-settings-card-head"><div><h2>Viewer access</h2><p>Publication and the optional site password stay with the leaderboard editor.</p></div></div><div class="v3-settings-row"><div><b>Visibility and password</b><p>Choose whether anyone with the link can view this site or a password is required.</p></div><a class="v3-set-btn v3-set-btn--outline" id="settingsBoardAccessLink" href="/dashboard/leaderboard/setup">Manage access</a></div></div>
        <details class="v3-settings-card v3-settings-disclosure" data-ui-advanced><summary>Legal pages</summary><div class="v3-settings-disclosure-body"><p class="v3-settings-muted">Add the legal links shown in your public site footer.</p><div class="v3-settings-legal"><div id="legalList"></div><div id="legalFooterPreview" class="v3-settings-muted"></div></div></div></details>
      </div>
    </div>
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
  <section class="v3-settings-panel" id="settingsPanelFeedback" role="tabpanel" aria-labelledby="settingsTabFeedback" data-settings-panel="feedback" hidden>
    <div class="v3-settings-card site-feedback">
      <div class="v3-settings-card-head"><div><h2>Viewer feedback</h2><p>Messages for <strong data-feedback-site>this site</strong>. Only the site owner can read them here.</p></div><span class="site-feedback-count" data-feedback-count></span></div>
      <p class="v3-settings-muted">These are suggestions, with no personal reply channel. For conversations, direct viewers to your community’s contact channels.</p>
      <div class="site-feedback-toolbar"><div role="group" aria-label="Filter feedback"><button class="btn btn--sm" type="button" data-feedback-filter="all" aria-pressed="true">All</button><button class="btn btn--sm" type="button" data-feedback-filter="unread" aria-pressed="false">Unread</button></div><button class="btn btn--sm" type="button" data-feedback-refresh>Refresh</button></div>
      <p class="site-feedback-status" role="status" aria-live="polite" data-feedback-status></p>
      <div data-feedback-list aria-label="Viewer messages"></div>
      <button class="btn" type="button" data-feedback-more hidden>Load more</button>
    </div>
  </section>
  <section class="v3-settings-panel" id="settingsPanelTools" role="tabpanel" aria-labelledby="settingsTabTools" data-settings-panel="tools" hidden>
    <div class="v3-settings-card"><div class="v3-settings-card-head"><div><h2>Advanced site tools</h2><p>Connections and stream tools that support this selected site.</p></div></div><div class="v3-settings-row"><div><b>Kick channel rewards</b><p>Let viewers earn credits by claiming Kick channel rewards.</p><span class="v3-settings-muted" id="kickStatus"><span class="skeleton skeleton-text" aria-hidden="true"></span></span></div><a class="v3-set-btn v3-set-btn--outline" href="/dashboard/site/connections" id="kickRewardsLink">Manage connection</a></div><div class="v3-settings-row"><div><b>Automatic score updates</b><p id="postbackStatus">Let a sponsor send score updates without manual imports. The private connection belongs to your account.</p></div><a class="v3-set-btn v3-set-btn--outline" href="/dashboard/settings/connections">Manage connection</a></div><div class="v3-settings-row"><div><b>Stream overlay</b><p>Get the browser-source link for OBS, Streamlabs, or another streaming app.</p></div><a class="v3-set-btn v3-set-btn--outline" href="/dashboard/leaderboard/share">Open sharing</a></div></div>
    <div class="v3-settings-card" id="moderatorActivityCard" hidden>
      <div class="v3-settings-card-head"><div><h2>Moderator activity</h2><p>What moderators changed on the standings for this site, and a preview of their view.</p></div></div>
      <div id="modAuditList" aria-live="polite"><p class="v3-settings-muted">Loading moderator activity…</p></div>
      <div class="v3-settings-divider"></div>
      <div class="v3-settings-row"><div><b>Preview as moderator</b><p>See the workspace the way a moderator does. Owner-only controls are hidden while previewing; server permissions are unchanged.</p></div><button class="v3-set-btn v3-set-btn--outline" id="settingsRolePreview" type="button" hidden>Preview as moderator</button></div>
    </div>
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
    <div class="v3-settings-card v3-danger-card" id="settingsDangerCard"><div class="v3-settings-card-head"><div><h2>Danger zone</h2><p>These actions permanently change or remove data for the selected site.</p></div></div><div class="v3-settings-row"><div><b>Reset site data</b><p>Archive this period, then remove all players, scores, prize amounts, and activity history.</p></div><button class="v3-set-btn v3-set-btn--danger-outline" id="settingsResetData" type="button">Reset data</button></div><div class="v3-settings-row"><div><b>Delete this site</b><p>Permanently delete this site and its settings. This cannot be undone.</p></div><button class="v3-set-btn v3-set-btn--danger" id="settingsDeleteBoard" type="button">Delete site</button></div></div>
  </section>
</div>
</section>
  );
}

function BoardsSection({ active } = {}) {
  return (
<section class={active ? "lb-page is-on" : "lb-page"} data-page="boards">
 <header class="v3-head v3-head--row"><div><h1>All sites</h1><p class="v3-head-sub">Manage the public sites in your account and choose which one you are working on.</p></div><button class="btn btn--sm btn--accent" id="newBoard" type="button" title="Create a site">Create site</button></header>
 <div class="board-upsell" id="boardLimitUpsell" role="status" hidden><div><b id="boardLimitTitle">Need another site?</b><p class="hint" id="boardLimitText"></p></div><a class="btn btn--sm btn--accent" id="boardLimitCta" href="/dashboard/settings">Upgrade plan</a></div>
 <div class="lb-board-form" id="newBoardForm" hidden><div class="field field-flex"><label for="nb_name">Site name</label><input id="nb_name" placeholder="Summer Race 2026" aria-describedby="nb_err" /></div><div class="field field-flex"><label for="nb_slug">Public link</label><input id="nb_slug" placeholder="summer-race-2026" aria-describedby="nb_err" /><span class="hint">We’ll create yourrank.site/this-link.</span></div><details class="editor-more lb-board-form-more"><summary>Optional sponsor details</summary><div class="grid2"><div class="field field-flex"><label for="nb_casino">Partner or sponsor</label><input id="nb_casino" placeholder="Your brand or sponsor" /></div><div class="field field-flex"><label for="nb_code">Promo code</label><input id="nb_code" placeholder="Optional" /></div></div></details><div class="lb-board-form-actions"><button class="btn btn--sm btn--accent" id="nb_create" type="button">Create site</button><button class="btn btn--sm btn--ghost" id="nb_cancel" type="button">Cancel</button><div class="hint w-full" id="nb_err" role="alert" aria-live="assertive"></div></div></div>
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
            <a class="v3-tab" href="/dashboard/leaderboard/setup">My board</a>
            <a class="v3-tab" href="/dashboard/leaderboards">All sites</a>
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
  scripts: ['<script src="/assets/shell-nav.js?v=4" defer></script>'],
  bootWatchdog: false,
  configFor: undefined,
};

export const dashboardPage = { config: dashboardConfig, configFor: dashboardConfig.configFor, Component: DashboardContent };
export const dashboardNotFoundPage = { config: dashboardNotFoundConfig, Component: DashboardNotFoundContent };
