import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { DashboardContent } from "../pages/dashboard.jsx";
import { UnifiedSettingsPage } from "../pages/account.jsx";

const siteJs = readFileSync(new URL("../assets/dashboard/site.js", import.meta.url), "utf8");
const dashboardAccountJs = readFileSync(new URL("../assets/dashboard/account.js", import.meta.url), "utf8");
const settingsPage = readFileSync(new URL("../react/pages/settings/page.tsx", import.meta.url), "utf8");
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
    for (const state of ["No custom domain", "Not connected", "Verification pending", "Setup required", "Domain status unavailable", "Needs attention", "Managed by the site owner", "Owner access required"]) {
      expect(siteJs).toContain(state);
    }
    expect(siteJs).toContain("if (res.status === 403)");
    expect(siteJs).toMatch(/showConfirmModal\(\s*"Disconnect custom domain"/);
    expect(siteJs).toMatch(/showConfirmModal\(\s*"Buy and connect domain"/);
  });
});

describe("Account settings creator UX", () => {
  it("server-renders the requested tab as current and visible", () => {
    const html = UnifiedSettingsPage({ fragment: true, tab: "connections" }).toString();
    expect(html).toContain('id="acc-app"');
    expect(html).toContain('data-settings-active="connections"');
  });

  it("separates account, selected-site, and health rows without repeating Kick setup", () => {
    expect(settingsPage).toContain('className="account-connection-row"');
    expect(settingsPage).toContain("connection.statusLabel");
    expect(settingsPage).toContain("connection.selectedSite");
    expect(settingsPage).toContain("siteConnectionName");
    expect(settingsPage).not.toContain("data-integration-test");
    expect(settingsPage).not.toContain("kick.userId");
    expect(settingsPage).not.toContain("telegram.userId");
    expect(settingsPage).not.toContain("telegramChat.chatId");
    expect(settingsPage).not.toContain("Per-board connected apps");
  });

  it("preserves the selected site for account connection links", () => {
    expect(settingsPage).toContain('new URLSearchParams(location.search).get("board")');
    expect(settingsPage).toContain('new URLSearchParams(location.search).get("siteId")');
    expect(settingsPage).toContain("state.ACTIVE_SITE_ID");
    expect(settingsPage).toContain('`?board=${encodeURIComponent(siteId)}`');
    expect(settingsPage).toContain('const siteConnections = connections.filter((connection) => connection.selectedSite)');
  });

  it("keeps account deletion singular and team removal confirmed", () => {
    expect(occurrences(settingsPage, 'id="deleteAccountModal"')).toBe(1);
    expect(settingsPage).toContain('id="deleteAccountBtn"');
    expect(settingsPage).toContain('"/api/site/team/remove"');
    expect(settingsPage).toContain('"/api/site/team/invite/revoke"');
    expect(settingsPage).toContain("confirmAction");
  });

  it("presents one fixed Moderator role with canonical seats and owner-only controls", () => {
    expect(settingsPage).toContain('id="teamSeatUsage"');
    expect(settingsPage).toContain('id="teamUpgradeLink"');
    expect(settingsPage).toContain("Roles &amp; permissions · Compare roles");
    expect(settingsPage).toContain('className="team-role-compare"');
    expect(settingsPage).not.toContain('id="inviteRole"');
    expect(settingsPage).not.toContain(">Manager<");
    expect(settingsPage).toContain('role: "moderator"');
    expect(settingsPage).toContain('role !== "moderator"');
    expect(settingsPage).not.toContain('"/api/site/team/role"');
    expect(dashboardCss).toContain("min-height: 44px");
  });

  it("keeps account controls outside the site draft and traps invite-dialog focus", () => {
    expect(settingsPage).toContain('data-settings-root="true"');
    expect(settingsPage).toContain("<Dialog open={inviteOpen}");
    expect(settingsPage).toContain("<Dialog open={open}");
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
