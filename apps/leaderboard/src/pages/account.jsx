/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import { settingsWidgets } from "./account-pages.js";
import { DashboardShell } from "./dashboard-shell.jsx";
import { chromeStateFor } from "../assets/dashboard/routes.js";

export const SETTINGS_TABS = [
  ["account", "Account"],
  ["team", "Team"],
  ["plan", "Billing"],
  ["connections", "Connections"],
  ["data", "Data"],
];

const SETTINGS_DESCRIPTIONS = {
  account: "Your profile, password, and signed-in devices.",
  team: "People who can help manage the selected site.",
  plan: "Your current plan, usage, and payment history.",
  connections: "Accounts and services connected to YourRank.",
  data: "Export your account data or permanently close your account.",
};

function settingsPanel(key, html, active) {
  return <section class="account-settings-panel" data-settings-panel={key} hidden={key !== active} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function UnifiedSettingsPage({ activePath, user, tab = "account", fragment } = {}) {
  const active = SETTINGS_TABS.some(([key]) => key === tab) ? tab : "account";
  const activeLabel = SETTINGS_TABS.find(([key]) => key === active)?.[1] || "Account";
  const activeDescription = SETTINGS_DESCRIPTIONS[active];
  const content = <div class="account-body account-settings" id="acc-app" data-acc-tab="settings" data-settings-active={active}>
      <div class="v3-head">
        <h1 data-chrome-h1>{activeLabel}</h1>
        <p class="v3-head-sub" data-settings-page-description>{activeDescription}</p>
      </div>
      <nav class="v3-tabs" role="tablist" aria-label="Settings sections">
        {SETTINGS_TABS.map(([key, label]) => (
          <a class={"v3-tab" + (key === active ? " is-on" : "")} href={`/dashboard/settings/${key === "plan" ? "billing" : key}`} data-settings-tab={key} data-settings-description={SETTINGS_DESCRIPTIONS[key]} role="tab" aria-selected={key === active ? "true" : "false"} aria-current={key === active ? "page" : undefined} tabindex={key === active ? "0" : "-1"}>
            {label}
          </a>
        ))}
      </nav>
      <div class="account-settings-layout">
        <div class="account-settings-main">
          {settingsPanel("account", settingsWidgets.account, active)}
          {settingsPanel("team", settingsWidgets.team, active)}
          {settingsPanel("plan", settingsWidgets.plan, active)}
          {settingsPanel("connections", `${settingsWidgets.connected}${settingsWidgets.postbacks}<div class="account-related-setting"><div><strong>Kick rewards for the selected site</strong><p>The channel connection that powers rewards is managed separately for each site.</p></div><a class="btn btn--ghost" href="/dashboard/site/connections">Manage site connection</a></div>`, active)}
          {settingsPanel("data", `${settingsWidgets.data}<div class="account-related-setting"><div><strong>Looking for one site's data?</strong><p>Resetting, archiving, or deleting a site affects only the selected site.</p></div><a class="btn btn--ghost" href="/dashboard/site?tab=danger">Manage site data</a></div>`, active)}
        </div>
        <div class="account-settings-help">
          <span>Account settings apply to you. To change your website, use Site settings.</span>
          <a href="/dashboard/site">Open Site settings</a>
          <span aria-hidden="true">·</span>
          <a href="/help/support?area=account">Open Help &amp; feedback</a>
        </div>
      </div>
    </div>;
  const chrome = chromeStateFor("settings", active);
  if (fragment) return content;
  return <DashboardShell activeNav={chrome.navKey} activePath={activePath || chrome.canonicalPath} boardContext="none" crumbs={chrome.crumbs} footer="account" topbarContext="Settings" user={user}>
    {content}
  </DashboardShell>;
}

const settingsConfigBase = {
  styles: ["/assets/app.css", "/assets/shell-nav.css", "/assets/ui.css", "/assets/dashboard-v4.css"],
  scripts: ['<script src="/assets/account.js?v=3" type="module"></script>', '<script src="/assets/shell-nav.js?v=3" defer></script>'],
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
