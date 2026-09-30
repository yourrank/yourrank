import { afterEach, describe, expect, it } from "bun:test";
import {
  actAndFlush,
  document,
  mountSettingsPage,
  requestDashboardRoute,
  unmountSettingsPage,
  window,
} from "./settings-react-utils.js";

const user = {
  email: "owner@example.test",
  displayName: "Atlas Owner",
  emailVerified: false,
  boards: [{ id: "alpha", name: "Atlas Community" }],
};

const team = {
  ok: true,
  siteId: "alpha",
  siteName: "Atlas Community",
  currentRole: "owner",
  canManageTeam: true,
  members: [],
  invites: [],
  seats: { plan: "team", used: 1, limit: 5 },
};

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

function requestFor({ postbacks = postbackData, connections = { ok: true, selectedSiteId: "alpha", selectedSiteName: "Atlas Community", connections: [] }, onRequest } = {}) {
  const calls = [];
  const request = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path === "/api/auth/me") return { ok: true, data: { ok: true, user } };
    if (path.startsWith("/api/site/team")) return { ok: true, data: team };
    if (path.startsWith("/api/account/connected-accounts")) return { ok: true, data: connections };
    if (path === "/api/account/postbacks" && method === "GET") return { ok: true, data: postbacks };
    if (onRequest) {
      const result = await onRequest(method, path, body);
      if (result) return result;
    }
    return { ok: true, data: { ok: true, message: "Test score update sent." } };
  };
  return { calls, request };
}

afterEach(async () => {
  await unmountSettingsPage();
});

describe("Settings React account and connection actions", () => {
  it("waits for the authenticated account before loading panel data", async () => {
    let resolveUser;
    const calls = [];
    const request = async (_method, path) => {
      calls.push(path);
      return { ok: true, data: { ok: true, user } };
    };
    await mountSettingsPage({
      user,
      tab: "team",
      deps: {
        request,
        getCurrentUser: () => new Promise((resolve) => { resolveUser = resolve; }),
      },
    });
    expect(calls).toEqual([]);

    await actAndFlush(() => resolveUser(user));
    expect(calls).toContain("/api/site/team?siteId=alpha");
    expect(calls).toContain("/api/account/postbacks");
  });

  it("opens the invite dialog when the active Team route receives an invite query", async () => {
    const { request } = requestFor();
    await mountSettingsPage({
      user,
      tab: "team",
      url: "/dashboard/settings/team?siteId=alpha",
      deps: { request },
    });
    expect(document.getElementById("inviteEmail")).toBeNull();

    await actAndFlush(() => requestDashboardRoute("settings", "team", { query: "?invite=1&siteId=alpha" }));

    expect(document.getElementById("inviteEmail")).not.toBeNull();
    expect(window.location.search).toBe("?siteId=alpha");
  });

  it("resends account verification with the original empty JSON body", async () => {
    const { calls, request } = requestFor();
    await mountSettingsPage({ user, tab: "account", deps: { request } });

    await actAndFlush(() => document.getElementById("accResendVerification").click());

    const resendCalls = calls.filter(({ path }) => path === "/api/auth/resend-verification");
    expect(resendCalls).toHaveLength(1);
    expect(resendCalls[0]).toEqual({
      method: "POST",
      path: "/api/auth/resend-verification",
      body: {},
    });
    expect(document.getElementById("accVerificationStatus").textContent).toBe("Verification email requested. Check your inbox.");
  });

  it("keeps the sponsor guide copy and sends the test conversion request", async () => {
    const { calls, request } = requestFor();
    let copied = "";
    await mountSettingsPage({
      user,
      tab: "connections",
      deps: { request, copy: async (value) => { copied = value; return true; } },
    });
    document.getElementById("postbacks").open = true;

    await actAndFlush(() => document.getElementById("postbackCopyManager").click());
    expect(copied).toBe(
      "Deposit tracking link: https://api.example.test/deposit?key=signed\n" +
      "Method: POST\n" +
      "Sign the raw query string with HMAC-SHA256 using your deposit tracking key, then send the hex signature in the X-Postback-Signature header.\n" +
      "Also include X-Postback-Key with your key.\n" +
      "Legacy unsigned link: https://api.example.test/legacy?key=legacy (sunset 2026-10-01)",
    );

    await actAndFlush(() => document.getElementById("postbackTest").click());
    expect(calls.find(({ path }) => path === "/api/account/postbacks/test")).toEqual({
      method: "POST",
      path: "/api/account/postbacks/test",
      body: undefined,
    });
    expect(document.getElementById("postbackTestStatus").textContent).toBe("Test score update sent.");
  });

  it("keeps Telegram unlink behind its Manage disclosure and confirms the original endpoint", async () => {
    const connections = {
      ok: true,
      selectedSiteId: "alpha",
      selectedSiteName: "Atlas Community",
      connections: [{
        id: "telegram-account",
        provider: "Telegram",
        statusLabel: "Connected",
        action: { kind: "manage_telegram" },
      }],
    };
    const { calls, request } = requestFor({
      connections,
      onRequest: async (method, path) => path === "/api/auth/telegram/unlink"
        ? { ok: true, data: { ok: true } }
        : null,
    });
    const confirmations = [];
    await mountSettingsPage({
      user,
      tab: "connections",
      deps: {
        request,
        confirm: async (...args) => { confirmations.push(args); return true; },
      },
    });

    const manage = document.querySelector(".account-connection-manage");
    expect(manage.querySelector("summary").textContent).toBe("Manage");
    expect(document.getElementById("tgDisconnect").textContent).toBe("Disconnect account");
    manage.open = true;
    await actAndFlush(() => document.getElementById("tgDisconnect").click());

    expect(confirmations[0]).toEqual([
      "Disconnect Telegram",
      "Telegram login and bot management for this account stop until you connect again.",
      "Disconnect",
      true,
    ]);
    expect(calls.find(({ path }) => path === "/api/auth/telegram/unlink")).toEqual({
      method: "POST",
      path: "/api/auth/telegram/unlink",
      body: {},
    });
  });

  it("supports ArrowLeft, ArrowRight, Home and End across settings tabs", async () => {
    const navigations = [];
    await mountSettingsPage({
      user,
      tab: "account",
      deps: { route: async (page, tab) => { navigations.push([page, tab]); } },
    });

    const press = async (tab, key) => {
      const anchor = document.querySelector(`[data-settings-tab="${tab}"]`);
      await actAndFlush(() => anchor.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true })));
    };
    await press("account", "ArrowRight");
    expect(document.activeElement.dataset.settingsTab).toBe("team");
    await press("team", "Home");
    expect(document.activeElement.dataset.settingsTab).toBe("account");
    await press("account", "End");
    expect(document.activeElement.dataset.settingsTab).toBe("data");
    await press("data", "ArrowLeft");
    expect(document.activeElement.dataset.settingsTab).toBe("connections");
    expect(navigations).toEqual([
      ["settings", "team"],
      ["settings", "account"],
      ["settings", "data"],
      ["settings", "connections"],
    ]);
  });

  it("clears the delete-account busy state when submission rejects", async () => {
    await mountSettingsPage({
      user,
      tab: "data",
      deps: {
        request: requestFor().request,
        deleteAccount: async () => { throw new Error("The network request failed."); },
      },
    });

    await actAndFlush(() => document.getElementById("deleteAccountBtn").click());
    const confirmInput = document.getElementById("deleteAccountConfirm");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(confirmInput, "DELETE");
    await actAndFlush(() => confirmInput.dispatchEvent(new window.Event("input", { bubbles: true })));
    await actAndFlush(() => document.getElementById("deleteAccountConfirmBtn").click());

    expect(document.getElementById("deleteAccountModalStatus").textContent).toBe("Couldn't delete account. Try again.");
    expect(document.getElementById("deleteAccountConfirmBtn").disabled).toBe(false);
  });

  it("clears account export polling when the Settings island unmounts", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const originalGlobalFetch = globalThis.fetch;
    const originalFetch = window.fetch;
    const pollTimers = [];
    const clearedPollTimers = [];
    globalThis.setTimeout = (callback, delay, ...args) => {
      const timer = originalSetTimeout(callback, delay, ...args);
      if (delay === 2000) pollTimers.push(timer);
      return timer;
    };
    globalThis.clearTimeout = (timer) => {
      if (pollTimers.includes(timer)) clearedPollTimers.push(timer);
      return originalClearTimeout(timer);
    };

    try {
      await mountSettingsPage({ user, tab: "data", deps: { request: requestFor().request } });
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        const path = new URL(url, window.location.origin).pathname;
        const payload = path === "/api/account/export" && init?.method === "POST"
          ? { ok: true, exportId: "export-1", status: "processing" }
          : path === "/api/account/export/export-1/status"
            ? { ok: true, exportId: "export-1", status: "processing" }
            : { ok: true, sessions: [] };
        return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
      };

      await actAndFlush(() => document.getElementById("accExportData").click());
      expect(pollTimers).toHaveLength(1);
      const timer = pollTimers[0];

      await unmountSettingsPage();

      expect(clearedPollTimers).toContain(timer);
    } finally {
      await unmountSettingsPage();
      window.fetch = originalFetch;
      globalThis.fetch = originalGlobalFetch;
      for (const timer of pollTimers) originalClearTimeout(timer);
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});
