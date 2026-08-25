/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import { membersPage } from "./credits-pages.js";
import { DashboardShell } from "./dashboard-shell.jsx";
import { chromeStateFor } from "../assets/dashboard/routes.js";

// Audience is the people area. Members (who earn and spend credits) are managed
// here; site visitors (anonymous traffic) already have their canonical view
// under Analytics, so the page links there as an action instead of duplicating
// the view or adding a tab that teleports to another product area.
const VISITOR_ANALYTICS_CARD = `<aside class="cr-audience-note"><div><h2>Looking for visitor trends?</h2><p>Anonymous visits and traffic sources live in Analytics.</p></div><a class="btn btn--sm" href="/dashboard/analytics">Open Analytics</a></aside>`;

export function AudienceMembersPage({ activePath, user, fragment } = {}) {
  const content = <div class="cr-workspace-content">
    <div id="cr-loading" class="ui-loading" role="status" aria-live="polite" aria-busy="true" hidden><div class="ui-loading__spinner"></div><span class="sr-only">Loading members…</span></div>
    <div id="cr-app" data-cr-tab="viewers" hidden dangerouslySetInnerHTML={{ __html: membersPage + VISITOR_ANALYTICS_CARD }}></div>
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
