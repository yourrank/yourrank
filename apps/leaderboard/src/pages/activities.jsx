/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import { DashboardShell } from "./dashboard-shell.jsx";
import { chromeStateFor } from "../assets/dashboard/routes.js";

export const activitiesContentHtml = `
  <div class="act-workspace-content">
    <header class="act-hero">
      <div class="act-hero__copy">
        <h1>Activities</h1>
        <p>Give members simple ways to join in without a purchase or stake. This foundation starts with free code drops backed by real site membership.</p>
      </div>
      <button class="btn btn--accent act-create-toggle" id="act-create-toggle" type="button" aria-expanded="false" aria-controls="act-create-panel">Create drop</button>
    </header>

    <section class="act-scope-note" aria-label="Activity availability">
      <div><strong>Safe Activity boundary</strong><p>Only free, non-staked code drops appear here. Templates and schedules cannot target restricted event systems.</p></div>
    </section>

    <section class="act-create-panel" id="act-create-panel" aria-labelledby="act-create-title" hidden>
      <div class="act-section-head">
        <div><h2 id="act-create-title">Launch a free code drop</h2></div>
        <button class="btn btn--sm" id="act-create-close" type="button">Close</button>
      </div>
      <p class="act-create-intro">Share a short code with your community. Each authenticated member can claim it once while supplies last.</p>
      <form class="act-form" id="act-drop-form">
        <label class="act-field"><span>Code</span><input id="act-drop-code" name="code" type="text" minlength="3" maxlength="32" pattern="[A-Za-z0-9_-]+" placeholder="COMMUNITY100" autocomplete="off" required><small>Letters, numbers, dashes, and underscores.</small></label>
        <label class="act-field"><span>Credits per claim</span><input id="act-drop-points" name="pointsReward" type="number" min="1" max="100000" value="100" required></label>
        <label class="act-field"><span>Available claims</span><input id="act-drop-max" name="maxClaims" type="number" min="1" max="10000" value="50" required></label>
        <label class="act-field"><span>Time limit</span><select id="act-drop-expire" name="expireMinutes"><option value="0">No time limit</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="1440">24 hours</option></select></label>
        <div class="act-form__actions"><button class="btn btn--accent" id="act-drop-submit" type="submit">Launch drop</button><button class="btn" id="act-drop-cancel" type="button">Cancel</button></div>
        <p class="status act-form-status" id="act-form-status" role="status" aria-live="polite" hidden></p>
      </form>
    </section>

    <section class="act-automation" aria-labelledby="act-automation-title">
      <div class="act-section-head act-automation__head">
        <div><h2 id="act-automation-title">Plan repeat work</h2><p>Save the reward settings once, then choose an exact future time. Each run creates a normal free code drop with a new claim code.</p></div>
        <span class="act-entitlement" id="act-entitlement">Checking plan…</span>
      </div>
      <div class="act-automation-gate" id="act-automation-gate" role="status" hidden>
        <strong>Automation is available on Pro and Team.</strong>
        <p>Manual code drops stay available on Free. Existing templates and schedules remain visible.</p>
        <a class="btn btn--sm" href="/dashboard/settings/billing?from=activities">View plans</a>
      </div>
      <div class="act-automation-grid">
        <section class="act-automation-pane" aria-labelledby="act-template-title">
          <div class="act-pane-head"><div><h3 id="act-template-title">Templates</h3><p>Reusable settings only. Saving a template does not create an Activity.</p></div><button class="btn btn--sm" id="act-template-new" type="button">New template</button></div>
          <form class="act-template-form" id="act-template-form" hidden>
            <input id="act-template-id" type="hidden">
            <label class="act-field"><span>Template name</span><input id="act-template-name" maxlength="80" placeholder="Stream break drop" required></label>
            <div class="act-template-fields">
              <label class="act-field"><span>Credits per claim</span><input id="act-template-points" type="number" min="1" max="100000" value="100" required></label>
              <label class="act-field"><span>Available claims</span><input id="act-template-max" type="number" min="1" max="10000" value="50" required></label>
              <label class="act-field"><span>Time limit</span><select id="act-template-expire"><option value="0">No time limit</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="1440">24 hours</option></select></label>
            </div>
            <div class="act-form__actions"><button class="btn btn--accent" id="act-template-save" type="submit">Save template</button><button class="btn" id="act-template-form-cancel" type="button">Cancel</button></div>
            <p class="status act-form-status" id="act-template-status" role="status" aria-live="polite" hidden></p>
          </form>
          <div class="act-compact-list" id="act-template-list"></div>
          <div class="act-pane-empty" id="act-template-empty"><strong>No templates yet</strong><p>Save the settings you repeat most often.</p></div>
        </section>

        <section class="act-automation-pane" aria-labelledby="act-schedule-title">
          <div class="act-pane-head"><div><h3 id="act-schedule-title">Schedules</h3><p>Times are stored as exact UTC instants and shown in your browser’s local time.</p></div><button class="btn btn--sm" id="act-schedule-new" type="button">Schedule</button></div>
          <form class="act-schedule-form" id="act-schedule-form" hidden>
            <input id="act-resume-id" type="hidden">
            <label class="act-field" id="act-schedule-template-field"><span>Template</span><select id="act-schedule-template" required></select></label>
            <label class="act-field"><span>First run</span><input id="act-schedule-at" type="datetime-local" required><small id="act-schedule-time-hint">Uses your browser’s local time.</small></label>
            <label class="act-field" id="act-schedule-recurrence-field"><span>Repeat</span><select id="act-schedule-recurrence"><option value="once">One time</option><option value="daily">Every 24 hours (UTC)</option><option value="weekly">Every 7 days (UTC)</option></select></label>
            <div class="act-form__actions"><button class="btn btn--accent" id="act-schedule-save" type="submit">Schedule Activity</button><button class="btn" id="act-schedule-form-cancel" type="button">Cancel</button></div>
            <p class="status act-form-status" id="act-schedule-status" role="status" aria-live="polite" hidden></p>
          </form>
          <div class="act-compact-list" id="act-schedule-list"></div>
          <div class="act-pane-empty" id="act-schedule-empty"><strong>Nothing scheduled</strong><p>Create a template, then choose when it should run.</p></div>
        </section>
      </div>
    </section>

    <section class="act-list-panel" aria-labelledby="act-list-title">
      <div class="act-section-head act-section-head--list">
        <div><h2 id="act-list-title">Live and past Activities</h2><p>Manual and scheduled drops share the same viewer flow and history.</p></div>
        <span class="act-count" id="act-count" aria-live="polite">—</span>
      </div>
      <div class="act-loading" id="act-loading" role="status" aria-live="polite"><span class="ui-loading__spinner" aria-hidden="true"></span><span>Loading activities…</span></div>
      <div class="act-list" id="act-list" hidden></div>
      <div class="act-empty" id="act-empty" hidden>
        <h3>No safe activities yet</h3>
        <p>Launch a free code drop when you are ready. Claim progress will appear here.</p>
        <button class="btn btn--accent" id="act-empty-create" type="button">Create your first drop</button>
      </div>
      <div class="act-error" id="act-error" role="alert" hidden><strong>Activities could not load.</strong><p id="act-error-message">Try again.</p><button class="btn btn--sm" id="act-retry" type="button">Retry</button></div>
    </section>
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
    '<script src="/assets/activities.js?v=1" type="module"></script>',
    '<script src="/assets/shell-nav.js?v=3" defer></script>',
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
