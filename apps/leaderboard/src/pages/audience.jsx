/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import { membersPage } from "./credits-pages.js";
import { DashboardShell } from "./dashboard-shell.jsx";
import { chromeStateFor } from "../assets/dashboard/routes.js";

// People is the creator-facing area. Members (who earn and spend credits) are managed
// here; site visitors (anonymous traffic) already have their canonical view
// under Insights, so the page links there as an action instead of duplicating
// the view or adding a tab that teleports to another product area.
const VISITOR_ANALYTICS_CARD = `<aside class="cr-audience-note"><div><h2>Looking for visitor trends?</h2><p>Anonymous visits and traffic sources live in Insights.</p></div><a class="btn btn--sm" href="/dashboard/analytics">Open Insights</a></aside>`;
const MEMBER_HISTORY_DRAWER = `<div class="cr-member-history-backdrop" id="cr-member-history-backdrop" hidden></div><aside class="cr-member-history-drawer" id="cr-member-history-drawer" role="dialog" aria-modal="true" aria-labelledby="cr-member-history-title" hidden><header class="cr-member-history-head"><div><h2 id="cr-member-history-title">Member history</h2><p>Credits activity on this site.</p></div><button class="cr-drawer-close" id="cr-member-history-close" type="button" aria-label="Close member history">×</button></header><div class="cr-member-history-body"><dl class="cr-member-history-facts" aria-label="Member credits summary"><div><dt>Balance</dt><dd id="cr-member-history-balance">—</dd></div><div><dt>Earned</dt><dd id="cr-member-history-earned">—</dd></div><div><dt>Spent</dt><dd id="cr-member-history-spent">—</dd></div></dl><div class="cr-member-history-section-head"><h3>Recent activity</h3><a class="btn btn--sm" id="cr-member-history-full" href="/dashboard/rewards/activity">Open full activity</a></div><p class="status" id="cr-member-history-status" role="status" aria-live="polite"></p><ol class="cr-member-history-list" id="cr-member-history-list" aria-live="polite"></ol><div class="v3-empty" id="cr-member-history-empty" hidden></div><button class="btn btn--sm" id="cr-member-history-more" type="button" hidden>Show more</button></div></aside>`;

export function AudienceMembersPage({ activePath, user, fragment } = {}) {
  const content = <div class="cr-workspace-content">
    <div id="cr-loading" class="ui-loading" role="status" aria-live="polite" aria-busy="true" hidden><div class="ui-loading__spinner"></div><span class="sr-only">Loading members…</span></div>
    <div id="cr-app" data-cr-tab="viewers" hidden dangerouslySetInnerHTML={{ __html: membersPage + MEMBER_HISTORY_DRAWER + VISITOR_ANALYTICS_CARD }}></div>
    <div id="cr-empty" class="empty cr-loading-state" hidden><div class="ui-loading__spinner" aria-hidden="true"></div><p>Loading your members…</p></div>
  </div>;
  const chrome = chromeStateFor("audience", "viewers");
  if (fragment) return content;
  return <DashboardShell activeNav={chrome.navKey} activePath={activePath || chrome.canonicalPath} boardContext="selector" crumbs={chrome.crumbs} footer="rewards" rootId="cr-dash" user={user}>
    {content}
  </DashboardShell>;
}

const audienceConfigBase = { styles: ["/assets/app.css", "/assets/shell-nav.css", "/assets/ui.css", "/assets/dashboard-v4.css"], scripts: ['<script src="/assets/credits.js?v=4" type="module"></script>', '<script src="/assets/shell-nav.js?v=3" defer></script>'], nav: false, footer: false, wide: true, bootWatchdog: true };

export const audienceMembersPage = {
  config: { ...audienceConfigBase, title: chromeStateFor("audience", "viewers").documentTitle, canonical: "https://yourrank.site/dashboard/audience/members" },
  Component: AudienceMembersPage,
};
