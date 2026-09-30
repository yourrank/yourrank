import { it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { UnifiedSettingsPage } from "../pages/account.jsx";
import { PAGES } from "../pages.jsx";

const source = readFileSync(new URL("../react/pages/settings/page.tsx", import.meta.url), "utf8");
const ids = [
  "profile", "accCurrentPassword", "accNewPassword", "accChangePassword", "accPasswordStatus",
  "accSignOut", "accRevokeSessions", "accSessions", "accSessionsStatus", "plan", "planSummary",
  "planBanner", "planUsage", "planGrid", "planTrial", "trialBtn", "trialStatus", "historyCard",
  "historyTable", "historyBody", "historyEmpty", "postbacks", "postbackStatusCard", "postbackStatusDot",
  "postbackStatusText", "postbackStatusHint", "postbackShareCard", "postbackSigned", "postbackCopySigned",
  "postbackCopyManager", "postbackKeyCard", "postbackKey", "postbackCopyKey", "postbackRotate",
  "postbackRevoke", "postbackAdvanced", "postbackLegacy", "postbackCopyLegacy", "postbackUpgrade",
  "postbackTest", "postbackTestStatus", "conversionsTable", "conversionsBody", "conversionsEmpty", "connectedAccounts", "data", "accExportData",
  "accExportStatus", "deleteAccountBtn", "deleteAccountModal", "deleteAccountConfirm",
  "deleteAccountPasswordWrap", "deleteAccountPassword", "deleteAccountConfirmBtn", "deleteAccountCancelBtn",
  "deleteAccountModalStatus",
];

it("keeps the Settings React island as the one page renderer", () => {
  expect(source.length).toBeGreaterThan(1000);
  for (const id of ids) expect(source).toContain(`id="${id}"`);
  expect(source).toContain("Completed payments and receipts will appear here after you upgrade.");
  expect(source.match(/id="deleteAccountModal"/g)).toHaveLength(1);
});

it("keeps account verification and sponsor test actions wired", () => {
  expect(source).toContain('"/api/auth/resend-verification"');
  expect(source).toContain('"/api/account/postbacks/test"');
});

it("serves the settings root for every account tab", () => {
  for (const [key] of [["account"], ["team"], ["plan"], ["connections"], ["data"]]) {
    const html = UnifiedSettingsPage({ activePath: `/dashboard/settings/${key === "plan" ? "billing" : key}`, tab: key, user: { email: "a@b.c" } }).toString();
    expect(html).toContain('id="acc-app"');
    expect(html).toContain(`data-settings-active="${key}"`);
  }
});

it("keeps account settings creator-facing instead of exposing scope jargon", () => {
  expect(source).toContain("Account settings apply to you. To change your website, use Site settings.");
  expect(source).toContain("Open Help &amp; feedback");
  expect(source).not.toContain("Global Account Scope");
  expect(source).not.toContain("Owner / Master");
  expect(source).not.toContain("Security Posture");
});

it("keeps Sources analytical and offers no referral reward in Billing", () => {
  const sources = PAGES.dashboard.Component({ activePath: "/dashboard/analytics/referrals", user: { email: "a@b.c" } }).toString();
  expect(sources).toContain('id="perf-referrers"');
  for (const html of [sources, source]) {
    expect(html).not.toContain("Invite streamers, earn Pro");
    expect(html).not.toMatch(/free (week|month) of Pro/i);
    expect(html).not.toContain('id="refLink"');
    expect(html).not.toContain('id="refCopy"');
    expect(html).not.toContain('id="planReferral"');
  }
  const site = PAGES.dashboard.Component({ activePath: "/dashboard/site", user: { email: "a@b.c" } }).toString();
  expect(site).toContain(">Advanced<");
  expect(site).not.toContain(">Integrations</button>");
});
