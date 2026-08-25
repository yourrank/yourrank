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

function settingsPanel(key, html) {
  return <section class="account-settings-panel" data-settings-panel={key} hidden={key !== "account"} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function UnifiedSettingsPage({ activePath, user, tab = "account", fragment } = {}) {
  const active = SETTINGS_TABS.some(([key]) => key === tab) ? tab : "account";
  const activeLabel = SETTINGS_TABS.find(([key]) => key === active)?.[1] || "Account";
  const content = <div class="account-body account-settings" id="acc-app" data-acc-tab="settings" data-settings-active={active}>
      <div class="v3-head">
        <h1 data-chrome-h1>{activeLabel}</h1>
        <p class="v3-head-sub">Account settings apply to you. To change your website, use Site settings.</p>
      </div>
      <nav class="v3-tabs" aria-label="Account settings sections">
        {SETTINGS_TABS.map(([key, label]) => (
          <a class={"v3-tab" + (key === active ? " is-on" : "")} href={`/dashboard/settings/${key === "plan" ? "billing" : key}`} data-settings-tab={key} aria-current={key === active ? "page" : undefined}>
            {label}
          </a>
        ))}
      </nav>
      <div class="account-settings-layout">
        <div class="account-settings-main">
          {settingsPanel("account", settingsWidgets.account)}
          {settingsPanel("team", settingsWidgets.team)}
          {settingsPanel("plan", settingsWidgets.plan)}
          {settingsPanel("connections", `${settingsWidgets.postbacks}<div class="lb-widget lb-widget--full"><h2>Connected accounts</h2><p class="card-sub">Streamer identities and connected services.</p><div id="connectedAccounts"><p class="hint">Loading…</p></div></div><div class="lb-widget lb-widget--full"><h2>Site connections</h2><p class="card-sub">The Kick connection that powers rewards belongs to the selected site, so it is managed in Site settings, not here.</p><a class="btn btn--accent" href="/dashboard/site/connections">Manage connections for the selected site →</a></div>`)}
          {settingsPanel("data", `${settingsWidgets.data}<div class="lb-widget lb-widget--full lb-widget--danger"><h2>Selected site data</h2><p class="card-sub">Resetting, archiving, or deleting a site affects one selected site, not your whole account, so those controls live in Site settings.</p><div class="d-flex gap-8 flex-wrap"><a class="btn btn--ghost" href="/dashboard/site?tab=danger">Manage site data in Site settings →</a></div></div>`)}
        </div>
        <aside class="account-settings-sidebar" aria-label="Related settings">
          <div class="account-scope-helper">
            <strong>Need help?</strong>
            <p>Help and feedback are kept in one place so you do not have to hunt through settings.</p>
            <a href="/help/support?area=account">Open Help &amp; feedback</a>
          </div>
        </aside>
      </div>
    </div>;
  const chrome = chromeStateFor("settings", active);
  if (fragment) return content;
  return <DashboardShell activeNav={chrome.navKey} activePath={activePath || chrome.canonicalPath} boardContext="none" crumbs={chrome.crumbs} footer="account" topbarContext="Account" user={user}>
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
