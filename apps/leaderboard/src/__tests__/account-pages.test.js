import { afterEach, it, expect } from "bun:test";
import { UnifiedSettingsPage } from "../pages/account.jsx";
import { PAGES } from "../pages.jsx";
import {
  actAndFlush,
  document,
  mountSettingsPage,
  unmountSettingsPage,
  window,
} from "./settings-react-utils.js";

const user = {
  email: "owner@example.test",
  displayName: "Atlas Owner",
  emailVerified: false,
  boards: [{ id: "alpha", name: "Atlas Community" }],
};

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

const postbackData = {
  ok: true,
  status: "pending",
  postback: {
    signedEndpoint: "https://api.example.test/deposit?key=signed",
    key: "private-key",
    legacyUrl: "https://api.example.test/legacy?key=legacy",
    createdAt: "2026-02-01T00:00:00Z",
  },
  conversions: [],
};

function settingsRequest(postbacks = postbackData) {
  return async (_method, path) => {
    if (path === "/api/auth/me") return { ok: true, data: { ok: true, user } };
    if (path.startsWith("/api/site/team")) return {
      ok: true,
      data: {
        ok: true,
        siteId: "alpha",
        siteName: "Atlas Community",
        currentRole: "owner",
        canManageTeam: true,
        members: [],
        invites: [],
        seats: { plan: "team", used: 1, limit: 5 },
      },
    };
    if (path.startsWith("/api/account/connected-accounts")) return {
      ok: true,
      data: { ok: true, selectedSiteId: "alpha", selectedSiteName: "Atlas Community", connections: [] },
    };
    if (path === "/api/account/postbacks") return { ok: true, data: postbacks };
    return { ok: true, data: {} };
  };
}

async function mountSettingsFixture({ tab = "account", postbacks = postbackData, deps = {} } = {}) {
  const previousWindowFetch = window.fetch;
  const previousGlobalFetch = globalThis.fetch;
  const fixtureFetch = async (input) => {
    const path = new URL(String(input), window.location.href).pathname;
    const data = path === "/api/account/payments"
      ? { ok: true, payments: [] }
      : path === "/api/account/usage"
        ? { ok: true, plan: "free", billing: { hasSubscription: false }, limits: {}, overLimit: [] }
        : path === "/api/auth/sessions"
          ? { ok: true, sessions: [] }
          : { ok: true, data: {} };
    return { ok: true, status: 200, json: async () => data };
  };
  window.fetch = fixtureFetch;
  globalThis.fetch = fixtureFetch;
  try {
    await mountSettingsPage({
      user,
      tab,
      deps: { request: settingsRequest(postbacks), ...deps },
    });
  } finally {
    window.fetch = previousWindowFetch;
    globalThis.fetch = previousGlobalFetch;
  }
}

afterEach(async () => {
  await unmountSettingsPage();
});

it("serves every account panel from the one settings document", async () => {
  const html = UnifiedSettingsPage({
    activePath: "/dashboard/settings/billing",
    tab: "plan",
    user,
  }).toString();

  for (const href of [
    "/dashboard/settings/account",
    "/dashboard/settings/team",
    "/dashboard/settings/billing",
    "/dashboard/settings/connections",
    "/dashboard/settings/data",
  ]) {
    expect(html).toContain(`href="${href}"`);
  }

  expect(html).toContain('id="acc-app"');
  expect(html).toContain('data-settings-active="plan"');
  expect(html).not.toContain('data-settings-tab="board"');
  expect(html).not.toContain("/account/profile");

  await mountSettingsFixture({ tab: "plan" });
  for (const panel of ["account", "plan", "connections", "data"]) {
    expect(document.querySelector(`[data-settings-panel="${panel}"]`)).not.toBeNull();
  }
  expect(document.querySelector('a[href="/dashboard/site"]')).not.toBeNull();
  expect(document.querySelector('a[href="/dashboard/site?tab=danger"]')).not.toBeNull();
  expect(document.querySelector('[data-settings-tab="board"]')).toBeNull();
  expect(document.body.innerHTML).not.toContain("/account/profile");
});

it("uses the tab heading and breadcrumb as the only settings identity", () => {
  for (const [key, label] of [
    ["account", "Account"],
    ["team", "Team"],
    ["plan", "Billing"],
    ["connections", "Connections"],
    ["data", "Data"],
  ]) {
    const html = UnifiedSettingsPage({
      activePath: `/dashboard/settings/${key === "plan" ? "billing" : key}`,
      tab: key,
      user,
    }).toString();
    expect(html).toContain(`<h1 data-chrome-h1="true">${label}</h1>`);
    expect(html).toContain("Account</a>");
    expect(html).toContain(`>${label}</span>`);
    expect(html).not.toContain('class="lb-board-select-lbl">Account settings');
    expect(html).not.toContain('class="lb-account-title"');
    expect(html).not.toContain("<h2>Site settings</h2>");
  }
});

it("renders the delete-account modal only from the data panel", async () => {
  const deleteAccount = async () => ({
    ok: false,
    status: 400,
    data: { error: "Password required" },
  });

  await mountSettingsFixture({
    tab: "account",
    deps: { deleteAccount },
  });
  expect(document.getElementById("deleteAccountModal")).toBeNull();
  expect(document.getElementById("deleteAccountConfirm")).toBeNull();
  for (const panel of ["account", "team", "plan", "connections"]) {
    expect(document.querySelector(`[data-settings-panel="${panel}"] #deleteAccountBtn`)).toBeNull();
  }
  expect(document.querySelector('[data-settings-panel="data"] #deleteAccountBtn')).not.toBeNull();

  await unmountSettingsPage();
  await mountSettingsFixture({
    tab: "data",
    deps: { deleteAccount },
  });
  const dataPanel = document.querySelector('[data-settings-panel="data"]');
  expect(dataPanel.querySelector("#deleteAccountBtn")).not.toBeNull();

  await actAndFlush(() => dataPanel.querySelector("#deleteAccountBtn").click());
  expect(dataPanel.hidden).toBe(false);
  expect(document.getElementById("deleteAccountModal")).not.toBeNull();
  expect(document.getElementById("deleteAccountConfirm")).not.toBeNull();
  expect(document.querySelectorAll("#deleteAccountModal")).toHaveLength(1);
  expect(document.querySelectorAll("#deleteAccountConfirm")).toHaveLength(1);
});

it("renders every client hook in the authenticated island", async () => {
  await mountSettingsFixture({
    tab: "data",
    deps: {
      deleteAccount: async () => ({
        ok: false,
        status: 400,
        data: { error: "Password required" },
      }),
    },
  });
  await actAndFlush(() => document.getElementById("deleteAccountBtn").click());

  const confirmInput = document.getElementById("deleteAccountConfirm");
  const { Event, HTMLInputElement } = document.defaultView;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(confirmInput, "DELETE");
  await actAndFlush(() => confirmInput.dispatchEvent(new Event("input", { bubbles: true })));
  await actAndFlush(() => document.getElementById("deleteAccountConfirmBtn").click());

  for (const id of ids.filter((id) => id !== "postbackUpgrade")) {
    expect(document.getElementById(id), id).not.toBeNull();
  }

  await unmountSettingsPage();
  await mountSettingsFixture({
    tab: "connections",
    postbacks: { ok: true, upgrade: true, conversions: [] },
  });
  expect(document.getElementById("postbackUpgrade")).not.toBeNull();
});

it("explains what payment history will contain when it is empty", async () => {
  await mountSettingsFixture({ tab: "plan" });
  expect(document.getElementById("historyEmpty").textContent.trim()).toBe(
    "No payments yet. Completed payments and receipts will appear here after you upgrade.",
  );
});

it("keeps account settings creator-facing instead of exposing scope jargon", async () => {
  await mountSettingsFixture({ tab: "account" });
  const rendered = document.body.textContent;
  expect(rendered).toContain("Account settings apply to you. To change your website, use Site settings.");
  expect(rendered).toContain("Open Help & feedback");
  expect(rendered).not.toContain("Global Account Scope");
  expect(rendered).not.toContain("Owner / Master");
  expect(rendered).not.toContain("Security Posture");
  expect(document.getElementById("accSummaryAvatar")).toBeNull();
});

it("keeps Sources analytical and offers no referral reward in Billing", async () => {
  const sources = PAGES.dashboard.Component({ activePath: "/dashboard/analytics/referrals", user: { email: "a@b.c" } }).toString();
  await mountSettingsFixture({ tab: "plan" });
  const plan = document.body.innerHTML;
  expect(sources).toContain('id="perf-referrers"');
  for (const html of [sources, plan]) {
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
