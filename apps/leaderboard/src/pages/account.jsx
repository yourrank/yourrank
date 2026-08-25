/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import { raw } from "hono/html";
import { settingsWidgets } from "./account-pages.js";
import { DashboardShell } from "./dashboard-shell.jsx";
import { chromeStateFor } from "../assets/dashboard/routes.js";

export const SETTINGS_TABS = [
  ["account", "Account", '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'],
  ["team", "Team", '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'],
  ["plan", "Billing", '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>'],
  ["connections", "Connections", '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'],
  ["data", "Data", '<path d="M4 6h16M4 12h16M4 18h16"/>'],
];

function settingsPanel(key, html) {
  return <section class="account-settings-panel" data-settings-panel={key} hidden={key !== "account"} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function UnifiedSettingsPage({ activePath, user, tab = "account", fragment } = {}) {
  const active = SETTINGS_TABS.some(([key]) => key === tab) ? tab : "account";
  const activeLabel = SETTINGS_TABS.find(([key]) => key === active)?.[1] || "Account";
  const content = <div class="account-body account-settings" id="acc-app" data-acc-tab="settings" data-settings-active={active}>
      <div class="account-settings-head">
        <h1 data-chrome-h1>{activeLabel}</h1>
        <p class="card-sub">Account settings apply to you. To change your website, use Site settings.</p>
      </div>
      <nav class="v3-tabs account-settings-tabs" aria-label="Account settings sections">
        {SETTINGS_TABS.map(([key, label, iconSvg]) => (
          <a class={"v3-tab" + (key === active ? " is-on" : "")} href={`/dashboard/settings/${key === "plan" ? "billing" : key}`} data-settings-tab={key} aria-current={key === active ? "page" : undefined}>
            <svg class="tab-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{raw(iconSvg)}</svg>
            <span>{label}</span>
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
