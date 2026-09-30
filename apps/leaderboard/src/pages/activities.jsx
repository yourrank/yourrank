/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import { DashboardShell } from "./dashboard-shell.jsx";
import { chromeStateFor } from "../assets/dashboard/routes.js";

export const ACTIVITY_TABS = [
  ["drops", "Drops"],
  ["automation", "Automation"],
];

export const activitiesContentHtml = `
  <main class="yr-react" id="activities-root" aria-labelledby="activities-title">
    <header class="mb-6">
      <h1 class="text-2xl font-bold tracking-tight" id="activities-title">Activities</h1>
      <p class="mt-1 text-sm text-muted-foreground">Free code drops that hand out credits to your community.</p>
    </header>
    <div class="grid gap-5" aria-hidden="true">
      <section class="rounded-xl border border-border bg-card p-5">
        <span class="block h-4 w-28 animate-pulse rounded bg-muted"></span>
        <span class="mt-4 block h-12 animate-pulse rounded bg-muted"></span>
      </section>
      <section class="rounded-xl border border-border bg-card p-5">
        <span class="block h-4 w-20 animate-pulse rounded bg-muted"></span>
        <span class="mt-4 block h-12 animate-pulse rounded bg-muted"></span>
      </section>
    </div>
    <p class="sr-only" role="status" aria-live="polite">Loading Activities…</p>
  </main>`;

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
    "/assets/react/react.css",
  ],
  scripts: [
    '<script src="/assets/activities.js?v=3" type="module"></script>',
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
