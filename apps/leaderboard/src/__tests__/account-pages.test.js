import { describe, it, expect } from "bun:test";
import { settingsWidgets } from "../pages/account-pages.js";
import { UnifiedSettingsPage } from "../pages/account.jsx";
import { PAGES } from "../pages.jsx";

// The widgets are the settings page's panels; the standalone `/account/*`
// documents they used to also render are gone, so these assert the hooks on
// the widget bodies themselves.
const pages = [
  {
    key: "account",
    html: settingsWidgets.account,
    ids: [
      "profile",
      "accCurrentPassword",
      "accNewPassword",
      "accChangePassword",
      "accPasswordStatus",
      "accSignOut",
      "accRevokeSessions",
      "accSessions",
      "accSessionsStatus",
    ],
  },
  {
    key: "plan",
    html: settingsWidgets.plan,
    ids: [
      "plan",
      "planSummary",
      "planBanner",
      "planUsage",
      "planGrid",
      "planTrial",
      "trialBtn",
      "trialStatus",
      "historyCard",
      "historyTable",
      "historyBody",
      "historyEmpty",
      "refLink",
      "refCopy",
      "refCount",
      "refDays",
      "refSaved",
      "refStatus",
    ],
  },
  {
    key: "postbacks",
    html: settingsWidgets.postbacks,
    ids: [
      "postbacks",
      "postbackStatusCard",
      "postbackStatusDot",
      "postbackStatusText",
      "postbackStatusHint",
      "postbackShareCard",
      "postbackSigned",
      "postbackCopySigned",
      "postbackCopyManager",
      "postbackTest",
      "postbackTestStatus",
      "postbackKeyCard",
      "postbackKey",
      "postbackCopyKey",
      "postbackRotate",
      "postbackRevoke",
      "postbackAdvanced",
      "postbackLegacy",
      "postbackCopyLegacy",
      "postbackUpgrade",
      "conversionsTable",
      "conversionsBody",
      "conversionsEmpty",
    ],
  },
  {
    key: "connected",
    html: settingsWidgets.connected,
    ids: ["connected", "connectedAccounts"],
  },
  {
    key: "data",
    html: settingsWidgets.data,
    ids: [
      "data",
      "accExportData",
      "accExportStatus",
      "deleteAccountBtn",
      "deleteAccountModal",
      "deleteAccountConfirm",
      "deleteAccountPasswordWrap",
      "deleteAccountPassword",
      "deleteAccountConfirmBtn",
      "deleteAccountCancelBtn",
      "deleteAccountModalStatus",
    ],
  },
];

it("explains what payment history will contain when it is empty", () => {
  expect(settingsWidgets.plan).toContain(
    "Completed payments and receipts will appear here after you upgrade."
  );
});

describe("settings panels", () => {
  for (const { key, html, ids } of pages) {
    it(`${key} renders its client hooks`, () => {
      expect(html.length).toBeGreaterThan(100);
      for (const id of ids) expect(html).toContain(`id="${id}"`);
    });
  }

  it("renders the delete-account modal only in the data panel", () => {
    expect(settingsWidgets.data).toContain('id="deleteAccountModal"');
    expect(settingsWidgets.data).toContain('id="deleteAccountConfirm"');
    for (const { key, html } of pages) {
      if (key === "data") continue;
      expect(html).not.toContain('id="deleteAccountModal"');
      expect(html).not.toContain('id="deleteAccountConfirm"');
    }
  });

  it("serves every account panel from the one settings document", async () => {
    const html = await UnifiedSettingsPage({ activePath: "/dashboard/settings/billing", tab: "plan", user: { email: "a@b.c" } }).toString();
    for (const key of ["account", "plan", "connections", "data"]) {
      expect(html).toContain(`href="/dashboard/settings/${key === "plan" ? "billing" : key}"`);
      expect(html).toContain(`data-settings-panel="${key}"`);
    }
    // Site-level settings are a separate destination, not an account tab.
    expect(html).toContain('href="/dashboard/site"');
    expect(html).toContain("Earn free Pro days");
    expect(html).toContain('href="/dashboard/site?tab=danger"');
    expect(html).not.toContain('data-settings-tab="board"');
    expect(html).not.toContain("/account/profile");
  });

  it("keeps account settings creator-facing instead of exposing scope jargon", async () => {
    const html = await UnifiedSettingsPage({ activePath: "/dashboard/settings/account", tab: "account", user: { email: "a@b.c", plan: "pro" } }).toString();
    expect(html).not.toContain("Open site settings");
    expect(html).toContain("Account settings apply to you. To change your website, use Site settings.");
    expect(html).toContain("Open Help &amp; feedback");
    expect(html).not.toContain("Global Account Scope");
    expect(html).not.toContain("Owner / Master");
    expect(html).not.toContain("Security Posture");
    expect(html).not.toContain('id="accSummaryAvatar"');
  });

  it("uses the tab heading and breadcrumb as the only settings identity", async () => {
    for (const [key, label] of [
      ["account", "Account"],
      ["team", "Team"],
      ["plan", "Billing"],
      ["connections", "Connections"],
      ["data", "Data"],
    ]) {
      const html = await UnifiedSettingsPage({
        activePath: `/dashboard/settings/${key === "plan" ? "billing" : key}`,
        tab: key,
        user: { email: "a@b.c" },
      }).toString();
      expect(html).toContain(`<h1 data-chrome-h1="true">${label}</h1>`);
      expect(html).toContain(`Account</a>`);
      expect(html).toContain(`>${label}</span>`);
      expect(html).not.toContain('class="lb-board-select-lbl">Account settings');
      expect(html).not.toContain('class="lb-account-title"');
      expect(html).not.toContain("<h2>Site settings</h2>");
    }
  });

  it("keeps Sources analytical and puts referrals in Billing", async () => {
    const sources = PAGES.dashboard.Component({ activePath: "/dashboard/analytics/referrals", user: { email: "a@b.c" } }).toString();
    const plan = await UnifiedSettingsPage({ activePath: "/dashboard/settings/billing", tab: "plan", user: { email: "a@b.c" } }).toString();
    expect(sources).toContain('id="perf-referrers"');
    expect(sources).not.toContain("Earn free Pro days");
    expect(plan).toContain("Earn free Pro days");
    expect(plan).toContain('id="refLink"');
    const site = PAGES.dashboard.Component({ activePath: "/dashboard/site", user: { email: "a@b.c" } }).toString();
    expect(site).toContain(">Advanced<");
    expect(site).not.toContain(">Integrations</button>");
  });
});
