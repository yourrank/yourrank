/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import { DashboardShell } from "./dashboard-shell.jsx";
import { chromeStateFor } from "../assets/dashboard/routes.js";

export const activitiesContentHtml = `
  <div class="act-workspace-content">
    <header class="act-hero">
      <div class="act-hero__copy">
        <p class="act-kicker">Free community activities</p>
        <h1>Activities</h1>
        <p>Give members simple ways to join in without a purchase or stake. This foundation starts with free code drops backed by real site membership.</p>
      </div>
      <button class="btn btn--accent act-create-toggle" id="act-create-toggle" type="button" aria-expanded="false" aria-controls="act-create-panel">Create drop</button>
    </header>

    <section class="act-scope-note" aria-label="Activity availability">
      <span class="act-scope-note__icon" aria-hidden="true">✦</span>
      <div><strong>Safe foundation</strong><p>Only free, non-staked activities appear here. Challenges are deferred until a shared foundation is sufficiently proven.</p></div>
    </section>

    <section class="act-create-panel" id="act-create-panel" aria-labelledby="act-create-title" hidden>
      <div class="act-section-head">
        <div><p class="act-kicker">New activity</p><h2 id="act-create-title">Launch a free code drop</h2></div>
        <button class="act-close" id="act-create-close" type="button" aria-label="Close create drop form">×</button>
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

    <section class="act-list-panel" aria-labelledby="act-list-title">
      <div class="act-section-head act-section-head--list">
        <div><p class="act-kicker">Selected site</p><h2 id="act-list-title">Your activities</h2></div>
        <span class="act-count" id="act-count" aria-live="polite">—</span>
      </div>
      <div class="act-loading" id="act-loading" role="status" aria-live="polite"><span class="ui-loading__spinner" aria-hidden="true"></span><span>Loading activities…</span></div>
      <div class="act-list" id="act-list" hidden></div>
      <div class="act-empty" id="act-empty" hidden>
        <span class="act-empty__icon" aria-hidden="true">✦</span>
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
