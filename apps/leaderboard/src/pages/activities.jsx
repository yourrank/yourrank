/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import {
  actionHtml,
  drawerShellHtml,
  emptyStateHtml,
  errorStateHtml,
  listShellHtml,
  loadingStateHtml,
  pageHeaderHtml,
  subnavHtml,
} from "@yourrank/shared/dashboard-ui";
import { DashboardShell } from "./dashboard-shell.jsx";
import { chromeStateFor } from "../assets/dashboard/routes.js";

// In-page tabs: the URL hash is the only selection state the page persists.
export const ACTIVITY_TABS = [
  ["drops", "Drops"],
  ["automation", "Automation"],
];

const EXPIRE_OPTIONS = `<option value="0">No time limit</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="1440">24 hours</option>`;

// One list region = loading skeleton + rows + empty + error, each toggled by
// the client. Only one of the four is visible at a time.
function dropListHtml(key, { title, description, emptyTitle, emptyBody, emptyActions, footer }) {
  return listShellHtml({
    label: title,
    id: `act-${key}`,
    className: `act-drops act-drops--${key}`,
    title,
    description,
    attrs: { "data-drop-list": key },
    body:
      loadingStateHtml({ label: `Loading ${title.toLowerCase()}…`, lines: 2, id: `act-${key}-loading` }) +
      `<ol class="act-rows" id="act-${key}-list" hidden></ol>` +
      emptyStateHtml({ title: emptyTitle, body: emptyBody, actions: emptyActions, id: `act-${key}-empty`, attrs: { hidden: true } }) +
      errorStateHtml({
        title: `${title} could not load`,
        id: `act-${key}-error`,
        attrs: { hidden: true },
        actions: [{ label: "Retry", size: "sm", attrs: { "data-retry": key } }],
      }),
    footer,
  });
}

const historyPagerHtml = `<nav class="act-pager" id="act-pager" aria-label="History pages" hidden>
  <p class="act-pager__range" id="act-pager-range" aria-live="polite"></p>
  <div class="act-pager__controls">
    ${actionHtml({ label: "Previous", size: "sm", id: "act-pager-prev", disabled: true, attrs: { "data-pager-step": "-1" } })}
    <ol class="act-pager__pages" id="act-pager-pages"></ol>
    ${actionHtml({ label: "Next", size: "sm", id: "act-pager-next", disabled: true, attrs: { "data-pager-step": "1" } })}
  </div>
  <label class="act-pager__size" for="act-pager-size"><span>Per page</span><select id="act-pager-size"></select></label>
</nav>`;

const createDrawerHtml = drawerShellHtml({
  id: "act-create-drawer",
  title: "Launch a code drop",
  description: "Members claim the code once each while supplies last. No purchase or stake is required.",
  hidden: true,
  form: { id: "act-drop-form" },
  body: `
    <label class="act-field"><span>Code</span><input id="act-drop-code" name="code" type="text" minlength="3" maxlength="32" pattern="[A-Za-z0-9_-]+" placeholder="COMMUNITY100" autocomplete="off" spellcheck="false" required><small>Letters, numbers, dashes, and underscores.</small></label>
    <div class="act-field-row">
      <label class="act-field"><span>Credits per claim</span><input id="act-drop-points" name="pointsReward" type="number" min="1" max="100000" value="100" inputmode="numeric" required></label>
      <label class="act-field"><span>Available claims</span><input id="act-drop-max" name="maxClaims" type="number" min="1" max="10000" value="50" inputmode="numeric" required></label>
    </div>
    <label class="act-field"><span>Time limit</span><select id="act-drop-expire" name="expireMinutes">${EXPIRE_OPTIONS}</select></label>
    <p class="act-form-status" id="act-form-status" role="status" aria-live="polite" hidden></p>`,
  actions: [
    { label: "Cancel", id: "act-drop-cancel", attrs: { "data-drawer-close": true } },
    { label: "Launch drop", variant: "primary", type: "submit", id: "act-drop-submit" },
  ],
});

const templateDrawerHtml = drawerShellHtml({
  id: "act-template-drawer",
  title: "Template",
  description: "Saved settings for a code drop. A template never launches anything by itself.",
  hidden: true,
  form: { id: "act-template-form" },
  body: `
    <input id="act-template-id" type="hidden">
    <label class="act-field"><span>Template name</span><input id="act-template-name" maxlength="80" placeholder="Stream break drop" autocomplete="off" required></label>
    <div class="act-field-row">
      <label class="act-field"><span>Credits per claim</span><input id="act-template-points" type="number" min="1" max="100000" value="100" inputmode="numeric" required></label>
      <label class="act-field"><span>Available claims</span><input id="act-template-max" type="number" min="1" max="10000" value="50" inputmode="numeric" required></label>
    </div>
    <label class="act-field"><span>Time limit</span><select id="act-template-expire">${EXPIRE_OPTIONS}</select></label>
    <p class="act-form-status" id="act-template-status" role="status" aria-live="polite" hidden></p>`,
  actions: [
    { label: "Cancel", id: "act-template-form-cancel", attrs: { "data-drawer-close": true } },
    { label: "Save template", variant: "primary", type: "submit", id: "act-template-save" },
  ],
});

const scheduleDrawerHtml = drawerShellHtml({
  id: "act-schedule-drawer",
  title: "Schedule an Activity",
  description: "The template's settings are copied when the schedule runs.",
  hidden: true,
  size: "compact",
  form: { id: "act-schedule-form" },
  body: `
    <input id="act-resume-id" type="hidden">
    <label class="act-field" id="act-schedule-template-field"><span>Template</span><select id="act-schedule-template" required></select></label>
    <label class="act-field"><span>First run</span><input id="act-schedule-at" type="datetime-local" required><small id="act-schedule-time-hint">Uses your browser’s local time.</small></label>
    <label class="act-field" id="act-schedule-recurrence-field"><span>Repeat</span><select id="act-schedule-recurrence"><option value="once">One time</option><option value="daily">Every 24 hours (UTC)</option><option value="weekly">Every 7 days (UTC)</option></select></label>
    <p class="act-form-status" id="act-schedule-status" role="status" aria-live="polite" hidden></p>`,
  actions: [
    { label: "Cancel", id: "act-schedule-form-cancel", attrs: { "data-drawer-close": true } },
    { label: "Schedule Activity", variant: "primary", type: "submit", id: "act-schedule-save" },
  ],
});

export const activitiesContentHtml = `
  <div class="act-workspace-content" id="act-app" data-tab="drops">
    ${pageHeaderHtml({
      title: "Activities",
      description: "Free code drops that hand out credits to your community.",
      scope: { kind: "site", id: "act-scope" },
      actions: [{ label: "Create drop", variant: "primary", id: "act-create-toggle", attrs: { "data-drawer-open": "act-create-drawer" } }],
    })}
    ${subnavHtml({
      label: "Activities sections",
      className: "act-tabs",
      tablist: true,
      active: "drops",
      items: ACTIVITY_TABS.map(([key, label]) => ({ key, label, href: `#${key}`, attrs: { id: `act-tab-${key}`, "aria-controls": `act-panel-${key}` } })),
    })}
    <p class="act-feedback" id="act-feedback" role="status" aria-live="polite" hidden></p>

    <section class="act-panel" id="act-panel-drops" role="tabpanel" aria-labelledby="act-tab-drops" data-tab-panel="drops">
      ${dropListHtml("live", {
        title: "Live now",
        emptyTitle: "No live drops",
        emptyBody: "Launch a code and claims will show up here as they happen.",
        emptyActions: [{ label: "Create drop", variant: "primary", attrs: { "data-drawer-open": "act-create-drawer" } }],
      })}
      ${dropListHtml("history", {
        title: "History",
        emptyTitle: "No past drops yet",
        emptyBody: "Ended, expired, and claimed-out drops are kept here.",
        footer: historyPagerHtml,
      })}
    </section>

    <section class="act-panel" id="act-panel-automation" role="tabpanel" aria-labelledby="act-tab-automation" data-tab-panel="automation" hidden>
      ${loadingStateHtml({ label: "Checking automation…", lines: 2, id: "act-automation-loading" })}
      <div class="act-lock v3-empty" id="act-automation-gate" data-plan-lock="activity_automation" role="status" hidden>
        <h2>Templates and schedules need Pro or Team</h2>
        <p id="act-automation-gate-copy"></p>
        ${actionHtml({ label: "View plans", size: "sm", href: "/dashboard/settings/billing?from=activities", attrs: { "data-plan-lock-upgrade": true } })}
      </div>
      <div class="act-automation" id="act-automation" hidden>
        ${listShellHtml({
          label: "Templates",
          id: "act-templates",
          className: "act-automation-list",
          title: "Templates",
          description: "Reusable drop settings.",
          actions: [{ label: "New template", variant: "primary", size: "sm", id: "act-template-new", attrs: { "data-drawer-open": "act-template-drawer" } }],
          body:
            `<ol class="act-rows act-rows--compact" id="act-template-list" hidden></ol>` +
            emptyStateHtml({ title: "No templates yet", body: "Save the settings you repeat most often.", id: "act-template-empty", attrs: { hidden: true } }),
        })}
        ${listShellHtml({
          label: "Schedules",
          id: "act-schedules",
          className: "act-automation-list",
          title: "Schedules",
          description: "Shown in your local time.",
          actions: [{ label: "Schedule", size: "sm", id: "act-schedule-new", attrs: { "data-drawer-open": "act-schedule-drawer" } }],
          body:
            `<div class="act-schedule-groups" id="act-schedule-list" hidden></div>` +
            emptyStateHtml({ title: "Nothing scheduled", body: "Create a template, then choose when it should run.", id: "act-schedule-empty", attrs: { hidden: true } }),
        })}
      </div>
    </section>

    ${createDrawerHtml}
    ${templateDrawerHtml}
    ${scheduleDrawerHtml}
  </div>`;

export function ActivitiesPage({ activePath, user, fragment } = {}) {
  const chrome = chromeStateFor("activities", "overview", { exact: true });
  const content = <div dangerouslySetInnerHTML={{ __html: activitiesContentHtml }} />;
  if (fragment) return content;
  return <DashboardShell activeNav={chrome.navKey} activePath={activePath || chrome.canonicalPath} boardContext="selector" crumbs={chrome.crumbs} footer="rewards" rootId="act-dash" user={user}>{content}</DashboardShell>;
}

export const activitiesConfig = {
  title: chromeStateFor("activities", "overview").documentTitle,
  canonical: "https://yourrank.site/dashboard/activities",
  styles: [
    "/assets/app.css",
    "/assets/shell-nav.css",
    "/assets/ui.css",
    "/assets/dashboard-v4.css",
    "/assets/activities.css",
  ],
  scripts: [
    '<script src="/assets/activities.js?v=2" type="module"></script>',
    '<script src="/assets/shell-nav.js?v=4" defer></script>',
  ],
  nav: false,
  footer: false,
  wide: true,
  bootWatchdog: true,
};

export const activitiesPage = {
  config: activitiesConfig,
  Component: ActivitiesPage,
};
