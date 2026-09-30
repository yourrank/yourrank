/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import { raw } from "hono/html";
import { subnavHtml } from "@yourrank/shared/dashboard-ui";
import { DashboardShell } from "./dashboard-shell.jsx";
import { chromeStateFor } from "../assets/dashboard/routes.js";

export const PEOPLE_TABS = [
  { key: "viewers", label: "Members", href: "/dashboard/audience/members" },
  { key: "activity", label: "Activity", href: "/dashboard/audience/activity" },
  { key: "reviews", label: "Reviews", href: "/dashboard/audience/reviews" },
  { key: "linked", label: "Linked accounts", href: "/dashboard/audience/linked" },
];

function PeopleTabs({ tab }) {
  return raw(subnavHtml({ items: PEOPLE_TABS, active: tab, label: "Audience pages" }));
}

function AudienceTabPage({ activePath, user, fragment, tab }) {
  const chromeTab = tab === "history" ? "activity" : tab;
  const content = <div class="cr-workspace-content">
    <PeopleTabs tab={chromeTab} />
    <div id="audience-app" data-audience-tab={tab}></div>
  </div>;
  const chrome = chromeStateFor("audience", chromeTab);
  if (fragment) return content;
  return <DashboardShell activeNav={chrome.navKey} activePath={activePath || chrome.canonicalPath} boardContext="selector" crumbs={chrome.crumbs} footer="rewards" rootId="cr-dash" user={user}>
    {content}
  </DashboardShell>;
}

export function AudienceMembersPage(props = {}) {
  return AudienceTabPage({ ...props, tab: "viewers" });
}

export function AudienceActivityPage(props = {}) {
  return AudienceTabPage({ ...props, tab: "history" });
}

export function AudienceReviewsPage(props = {}) {
  return AudienceTabPage({ ...props, tab: "reviews" });
}

export function AudienceLinkedAccountsPage(props = {}) {
  return AudienceTabPage({ ...props, tab: "linked" });
}

const audienceConfigBase = {
  styles: [
    "/assets/app.css",
    "/assets/shell-nav.css",
    "/assets/ui.css",
    "/assets/dashboard-v4.css",
    "/assets/react/react.css",
    "/assets/react/audience.css",
  ],
  scripts: ['<script src="/assets/people.js?v=2" type="module"></script>', '<script src="/assets/shell-nav.js?v=4" defer></script>'],
  nav: false,
  footer: false,
  wide: true,
  bootWatchdog: true,
};

export const audienceMembersPage = {
  config: { ...audienceConfigBase, title: chromeStateFor("audience", "viewers").documentTitle, canonical: "https://yourrank.site/dashboard/audience/members" },
  Component: AudienceMembersPage,
};

export const audienceActivityPage = {
  config: { ...audienceConfigBase, title: chromeStateFor("audience", "activity").documentTitle, canonical: "https://yourrank.site/dashboard/audience/activity" },
  Component: AudienceActivityPage,
};

export const audienceReviewsPage = {
  config: { ...audienceConfigBase, title: chromeStateFor("audience", "reviews").documentTitle, canonical: "https://yourrank.site/dashboard/audience/reviews" },
  Component: AudienceReviewsPage,
};

export const audienceLinkedPage = {
  config: { ...audienceConfigBase, title: chromeStateFor("audience", "linked").documentTitle, canonical: "https://yourrank.site/dashboard/audience/linked" },
  Component: AudienceLinkedAccountsPage,
};
