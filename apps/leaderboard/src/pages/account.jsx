/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import { DashboardShell } from "./dashboard-shell.jsx";
import { chromeStateFor } from "../assets/dashboard/routes.js";

export const SETTINGS_TABS = [
  ["account", "Account"],
  ["team", "Team"],
  ["plan", "Billing"],
  ["connections", "Connections"],
  ["data", "Data"],
];

export function UnifiedSettingsPage({ activePath, user, tab = "account", fragment } = {}) {
  const active = SETTINGS_TABS.some(([key]) => key === tab) ? tab : "account";
  const content = <div class="account-body account-settings" id="acc-app" data-acc-tab="settings" data-settings-active={active}>
    <div class="v3-head"><h1 data-chrome-h1="true">{SETTINGS_TABS.find(([key]) => key === active)?.[1]}</h1></div>
    <nav class="v3-tabs" aria-label="Settings sections" role="tablist">{SETTINGS_TABS.map(([key, label]) => <a class={`v3-tab${active === key ? " is-on" : ""}`} href={`/dashboard/settings/${key === "plan" ? "billing" : key}`} id={`settings-tab-${key}`} role="tab" aria-controls={`settings-panel-${key}`} aria-selected={active === key} aria-current={active === key ? "page" : undefined} data-settings-tab={key}>{label}</a>)}</nav>
    <section id={`settings-panel-${active}`} role="tabpanel" aria-labelledby={`settings-tab-${active}`} data-settings-panel={active}>
      <div class="yr-react-settings-loading" aria-live="polite">Loading settings…</div>
    </section>
  </div>;
  const chrome = chromeStateFor("settings", active);
  if (fragment) return content;
  return <DashboardShell activeNav={chrome.navKey} activePath={activePath || chrome.canonicalPath} boardContext="none" crumbs={chrome.crumbs} footer="account" topbarContext="Settings" user={user}>
    {content}
  </DashboardShell>;
}

const settingsConfigBase = {
  styles: ["/assets/app.css", "/assets/shell-nav.css", "/assets/ui.css", "/assets/dashboard-v4.css", "/assets/react/react.css"],
  scripts: ['<script src="/assets/account.js?v=4" type="module"></script>', '<script src="/assets/shell-nav.js?v=4" defer></script>'],
  nav: false,
  footer: false,
  wide: true,
  bootWatchdog: true,
};

export const settingsConfig = {
  ...settingsConfigBase,
  title: chromeStateFor("settings", "account").documentTitle,
  canonical: "https://yourrank.site/dashboard/settings",
};

export const settingsUnifiedPage = { config: settingsConfig, Component: UnifiedSettingsPage };
