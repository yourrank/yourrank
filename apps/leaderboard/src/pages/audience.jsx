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
export const PEOPLE_TABS = [
  { key: "viewers", label: "Members", href: "/dashboard/audience/members" },
  { key: "reviews", label: "Reviews", href: "/dashboard/audience/reviews" },
];

function PeopleTabs({ tab }) {
  return <nav class="v3-tabs" aria-label="People pages">
    {PEOPLE_TABS.map((item) => <a
      class={"v3-tab" + (item.key === tab ? " is-on" : "")}
      href={item.href}
      aria-current={item.key === tab ? "page" : undefined}
    >{item.label}</a>)}
  </nav>;
}
const MEMBER_HISTORY_DRAWER = `
  <div class="cr-member-history-backdrop" id="cr-member-history-backdrop" hidden></div>
  <aside class="cr-member-history-drawer" id="cr-member-history-drawer" role="dialog" aria-modal="true" aria-labelledby="cr-member-history-title" aria-describedby="cr-member-history-site" hidden>
    <header class="cr-member-history-head">
      <div>
        <h2 id="cr-member-history-title">Member details</h2>
        <p id="cr-member-history-site">Membership in the selected site.</p>
      </div>
      <button class="cr-drawer-close" id="cr-member-history-close" type="button" aria-label="Close member details">×</button>
    </header>
    <div class="cr-member-history-body">
      <section class="cr-member-detail-section" aria-labelledby="cr-member-identity-heading">
        <div class="cr-member-detail-identity">
          <span class="cr-viewer-avatar cr-viewer-avatar--fallback" id="cr-member-history-avatar" aria-hidden="true">M</span>
          <div><h3 id="cr-member-identity-heading">Member</h3><p id="cr-member-history-identity-summary">Site membership</p></div>
        </div>
        <dl class="cr-member-context-facts">
          <div><dt>Last active</dt><dd id="cr-member-history-active">—</dd></div>
        </dl>
      </section>
      <section class="cr-member-detail-section" aria-labelledby="cr-member-connections-heading">
        <div class="cr-member-history-section-head"><h3 id="cr-member-connections-heading">Account connection</h3></div>
        <div class="cr-member-connections" id="cr-member-history-connections"></div>
        <p class="cr-member-detail-note" id="cr-member-history-connection-note"></p>
      </section>
      <section class="cr-member-detail-section" aria-labelledby="cr-member-credits-heading">
        <div class="cr-member-history-section-head"><h3 id="cr-member-credits-heading">Credits</h3></div>
        <dl class="cr-member-history-facts" aria-label="Member credits summary">
          <div><dt>Balance</dt><dd id="cr-member-history-balance">—</dd></div>
          <div><dt>Earned</dt><dd id="cr-member-history-earned">—</dd></div>
          <div><dt>Spent</dt><dd id="cr-member-history-spent">—</dd></div>
        </dl>
      </section>
      <section class="cr-member-detail-section" aria-labelledby="cr-member-activity-heading">
        <div class="cr-member-history-section-head"><h3 id="cr-member-activity-heading">Recent credit activity</h3></div>
        <p class="status" id="cr-member-history-status" role="status" aria-live="polite"></p>
        <ol class="cr-member-history-list" id="cr-member-history-list" aria-live="polite"></ol>
        <div class="v3-empty" id="cr-member-history-empty" hidden></div>
      </section>
      <section class="cr-member-detail-section" aria-labelledby="cr-member-moderation-heading">
        <div class="cr-member-history-section-head"><h3 id="cr-member-moderation-heading">Site status</h3></div>
        <div class="cr-member-moderation-row"><div><strong id="cr-member-history-moderation">Active</strong><p id="cr-member-history-moderation-reason">No restrictions on this site.</p></div><button class="btn btn--sm btn--danger" id="cr-member-history-block" type="button">Block member</button></div>
      </section>
      <div class="cr-member-detail-actions"><button class="btn btn--accent" id="cr-member-history-tip" type="button">Tip credits</button></div>
    </div>
  </aside>`;

export function AudienceMembersPage({ activePath, user, fragment } = {}) {
  const content = <div class="cr-workspace-content">
    <PeopleTabs tab="viewers" />
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

export function AudienceReviewsPage({ activePath, user, fragment } = {}) {
  const content = <div class="cr-workspace-content">
    <PeopleTabs tab="reviews" />
    <div class="people-reviews" id="people-reviews-app" data-people-tab="reviews">
      <header class="v3-head people-reviews__head">
        <div><h1>Reviews</h1><p class="v3-head-sub">Human decisions needed for your community.</p></div>
        <div class="people-review-count" aria-live="polite"><strong id="people-reviews-pending-count">—</strong><span>need attention</span></div>
      </header>
      <section class="people-review-queue" aria-labelledby="people-review-queue-title">
        <div class="people-review-toolbar">
          <div><h2 id="people-review-queue-title">Review queue</h2><p>Resolve eligibility exceptions for this site. Decisions apply only to the named signup.</p></div>
          <div class="people-review-filters" role="group" aria-label="Review status">
            <button class="btn btn--sm is-active" type="button" data-review-filter="pending" aria-pressed="true">Needs review</button>
            <button class="btn btn--sm" type="button" data-review-filter="resolved" aria-pressed="false">Resolved</button>
          </div>
        </div>
        <div class="people-review-feedback"><p class="status" id="people-reviews-status" role="status" aria-live="polite"></p><button class="btn btn--sm" id="people-reviews-retry" type="button" hidden>Try again</button></div>
        <div class="people-review-table-wrap" id="people-reviews-table-wrap">
          <table class="v3-table people-review-table">
            <thead><tr><th scope="col">Participant</th><th scope="col">Review reason</th><th scope="col">Signup</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
            <tbody id="people-reviews-list" aria-live="polite"></tbody>
          </table>
        </div>
        <div class="v3-empty people-review-empty" id="people-reviews-empty" hidden>
          <h3>No reviews need your attention.</h3><p>New eligibility exceptions for this site will appear here.</p>
        </div>
      </section>
      <div class="people-review-backdrop" id="people-review-backdrop" hidden></div>
      <aside class="people-review-drawer" id="people-review-drawer" role="dialog" aria-modal="true" aria-labelledby="people-review-title" aria-describedby="people-review-description" hidden>
        <header class="people-review-drawer__head"><div><p class="people-review-eyebrow">Participant eligibility</p><h2 id="people-review-title">Review</h2><p id="people-review-description">Zero-cost tournament signup.</p></div><button class="people-review-close" id="people-review-close" type="button" aria-label="Close review">×</button></header>
        <div class="people-review-drawer__body" id="people-review-detail"></div>
        <footer class="people-review-actions" id="people-review-actions">
          <p>Choose only for this tournament signup.</p>
          <p class="status" id="people-review-decision-status" role="status" aria-live="polite"></p>
          <div><button class="btn" id="people-review-exclude" type="button">Exclude signup</button><button class="btn btn--accent" id="people-review-allow" type="button">Allow signup</button></div>
        </footer>
      </aside>
    </div>
    <div id="people-reviews-loading" class="people-review-loading" role="status" aria-live="polite" aria-busy="true" hidden><div class="ui-loading__spinner" aria-hidden="true"></div><span>Loading reviews…</span></div>
  </div>;
  const chrome = chromeStateFor("audience", "reviews");
  if (fragment) return content;
  return <DashboardShell activeNav={chrome.navKey} activePath={activePath || chrome.canonicalPath} boardContext="selector" crumbs={chrome.crumbs} footer="rewards" rootId="cr-dash" user={user}>
    {content}
  </DashboardShell>;
}

const audienceConfigBase = { styles: ["/assets/app.css", "/assets/shell-nav.css", "/assets/ui.css", "/assets/dashboard-v4.css", "/assets/people.css"], scripts: ['<script src="/assets/people.js?v=1" type="module"></script>', '<script src="/assets/shell-nav.js?v=3" defer></script>'], nav: false, footer: false, wide: true, bootWatchdog: true };

export const audienceMembersPage = {
  config: { ...audienceConfigBase, title: chromeStateFor("audience", "viewers").documentTitle, canonical: "https://yourrank.site/dashboard/audience/members" },
  Component: AudienceMembersPage,
};

export const audienceReviewsPage = {
  config: { ...audienceConfigBase, title: chromeStateFor("audience", "reviews").documentTitle, canonical: "https://yourrank.site/dashboard/audience/reviews" },
  Component: AudienceReviewsPage,
};
