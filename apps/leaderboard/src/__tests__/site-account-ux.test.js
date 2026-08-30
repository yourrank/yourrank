import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { DashboardContent } from "../pages/dashboard.jsx";
import { UnifiedSettingsPage } from "../pages/account.jsx";

const siteJs = readFileSync(new URL("../assets/dashboard/site.js", import.meta.url), "utf8");
const dashboardAccountJs = readFileSync(new URL("../assets/dashboard/account.js", import.meta.url), "utf8");
const accountJs = readFileSync(new URL("../assets/account.js", import.meta.url), "utf8");
const accountPages = readFileSync(new URL("../pages/account-pages.js", import.meta.url), "utf8");
const dashboardCss = readFileSync(new URL("../assets/dashboard-v4.css", import.meta.url), "utf8");

function occurrences(source, value) {
  return source.split(value).length - 1;
}

describe("Site settings creator UX", () => {
  const html = DashboardContent({ user: { email: "creator@example.com" }, activePath: "/dashboard/site" }).toString();

  it("keeps one tabbed settings body with common tasks before advanced actions", () => {
    // Branding, navigation, links and the public address are one creator task,
    // so they share the Customize tab that also owns the viewer preview.
    for (const tab of ["customize", "notifications", "domain", "tools", "danger"]) {
      expect(html).toContain(`data-settings-tab="${tab}"`);
      expect(html).toContain(`data-settings-panel="${tab}"`);
    }
    expect(html.indexOf("data-settings-tab=\"customize\"")).toBeLessThan(html.indexOf("data-settings-tab=\"tools\""));
    expect(html.indexOf("data-settings-tab=\"domain\"")).toBeLessThan(html.indexOf("data-settings-tab=\"danger\""));
    expect(occurrences(html, 'id="settingsSave"')).toBe(1);
  });

  it("delegates visible settings saving to the canonical editor save owner", () => {
    expect(siteJs).toContain('export async function saveEditorDraft({ fetchImpl = fetch, collectImpl = collect, button } = {})');
    expect(siteJs).toContain('saveEditorDraft({ button: event.currentTarget })');
    expect(occurrences(siteJs, "status.hidden = false;")).toBeGreaterThanOrEqual(3);
    // The save bar is dirty-driven from one owner: tab switches defer to the
    // same sync the draft subscriber uses, and only Customize/Notifications —
    // the tabs whose fields the bar saves — can show it.
    expect(dashboardAccountJs).toContain("syncSettingsSaveBar()");
    expect(siteJs).toContain("export function syncSettingsSaveBar()");
    expect(siteJs).toContain('bar.hidden = !(state._dirty && (tab === "customize" || tab === "notifications"))');
    expect(dashboardAccountJs).toContain('for (const id of ["f_domain", "domainSearchInput"])');
  });

  it("keeps domain states truthful and destructive actions confirmed", () => {
    for (const state of ["No custom domain", "Not connected", "Verification pending", "Setup required", "Domain status unavailable", "Needs attention"]) {
      expect(siteJs).toContain(state);
    }
    expect(siteJs).toMatch(/showConfirmModal\(\s*"Disconnect custom domain"/);
    expect(siteJs).toMatch(/showConfirmModal\(\s*"Buy and connect domain"/);
  });
});

describe("Account settings creator UX", () => {
  it("server-renders the requested tab as current and visible", () => {
    const html = UnifiedSettingsPage({ fragment: true, tab: "connections" }).toString();
    expect(html).toMatch(/data-settings-tab="connections"[^>]*aria-current="page"/);
    expect(html).toContain('data-settings-panel="connections"');
    expect(html).toMatch(/data-settings-panel="account"[^>]*hidden/);
    expect(html).not.toMatch(/data-settings-panel="connections"[^>]*hidden/);
  });

  it("uses list rows without exposing provider IDs or expiry timestamps", () => {
    expect(accountJs).toContain('class="account-connection-row"');
    expect(accountJs).toContain("Reconnect needed");
    expect(accountJs).not.toContain("kick.userId");
    expect(accountJs).not.toContain("telegram.userId");
    expect(accountJs).not.toContain("telegramChat.chatId");
    expect(accountJs).not.toContain("Per-board connected apps");
  });

  it("keeps account deletion singular and team removal confirmed", () => {
    expect(occurrences(accountPages, 'id="deleteAccountModal"')).toBe(1);
    expect(accountPages).toContain('id="deleteAccountBtn"');
    expect(accountJs).toContain('showConfirmModal("Remove team member"');
    expect(accountJs).toContain('showConfirmModal("Revoke invitation"');
    expect(accountJs).not.toMatch(/\bconfirm\(/);
  });

  it("presents one fixed Moderator role with canonical seats and owner-only controls", () => {
    const html = UnifiedSettingsPage({ fragment: true, tab: "team" }).toString();
    expect(html).toContain('id="teamSeatUsage"');
    expect(html).toContain('id="teamUpgradeLink"');
    expect(html).toContain("Owner and Moderator permissions");
    expect(html).not.toContain('id="inviteRole"');
    expect(html).not.toContain(">Manager<");
    expect(accountJs).toContain('role: "moderator"');
    expect(accountJs).toContain('currentRole !== "moderator"');
    expect(accountJs).not.toContain('"/api/site/team/role"');
    expect(dashboardCss).toContain("min-height: 44px");
  });

  it("keeps account controls outside the site draft and traps invite-dialog focus", () => {
    expect(accountJs).toContain('accountRoot?.addEventListener("input", (event) => event.stopPropagation())');
    expect(accountJs).toContain('accountRoot?.addEventListener("change", (event) => event.stopPropagation())');
    // The invite modal uses the one shared trap (Escape, focus loop, inert
    // background, focus return) rather than a second local implementation.
    expect(accountJs).toContain('window.YRDialog.trap(modal, closeModal)');
    expect(accountJs).not.toMatch(/_inviteModalKeydown/);
  });

  it("keeps narrow account and settings structures free of fixed minimum widths", () => {
    expect(dashboardCss).toContain(".account-team-row");
    expect(dashboardCss).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(dashboardCss).toContain(".account-settings-panel > .account-related-setting { grid-column: 1 / -1; }");
    expect(dashboardCss).toContain(".domain-result-name strong");
    expect(dashboardCss).not.toMatch(/#connectedAccounts\s*>\s*\.admin-table\s*\{[^}]*min-width:\s*720px/s);
    expect(dashboardCss).not.toMatch(/\.account-team-row\s*\{[^}]*min-width:\s*[1-9]\d+px/s);
  });
});
