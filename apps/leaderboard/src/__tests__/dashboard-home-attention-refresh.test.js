// Home → Needs attention reads the selected site's /api/credits/status
// (pending claims, Kick channel health). These tests run the real shell
// navigation against the rendered dashboard document in a DOM, so every SPA
// entry into Home is proven to refresh that status — a claim completed on
// Rewards → Claims must not still be "waiting" when the creator comes back.
//
// Run: bun test src/__tests__/dashboard-home-attention-refresh.test.js

import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { DashboardContent } from "../pages/dashboard.jsx";

const window = new Window({ url: "http://localhost/dashboard" });
const { document } = window;
for (const key of ["window", "document", "location", "history", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "DOMParser", "getComputedStyle"]) {
  globalThis[key] = key === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[key];
}
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
window.Element.prototype.getClientRects = function () { return [{}]; };

// The server the Home loaders talk to. Only credits/status carries state the
// tests mutate; every other dashboard endpoint answers with an empty payload.
const server = { pendingRedemptions: 1, channel: { externalId: "kick-1", name: "creator", homeAttention: false }, requests: [] };
globalThis.fetch = async (url) => {
  const path = String(url);
  server.requests.push(path);
  const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (path.startsWith("/api/credits/status")) {
    return reply({ ok: true, enabled: true, channel: server.channel, usage: { pendingRedemptions: server.pendingRedemptions, rewardMappings: 2 } });
  }
  return reply({ ok: true });
};

document.body.innerHTML = DashboardContent({ user: { email: "creator@example.com", plan: "pro" }, activePath: "/dashboard" }).toString();
document.getElementById("dash").hidden = false;

const { state } = await import("../assets/dashboard/state.js");
const { enterHome, navTo } = await import("../assets/dashboard/shell.js");

Object.assign(state, {
  ACTIVE_SITE_ID: "site-1",
  SLUG: "kick-cup",
  BOARDS: [{ id: "site-1", name: "Kick Cup", published: true, userRole: "owner" }],
  ME: { plan: "pro", emailVerified: true },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const creditsRequests = () => server.requests.filter((path) => path.startsWith("/api/credits/status"));
const claimRow = () => document.querySelector('#ovAttentionList [data-attention="pendingClaims"]');
const kickRow = () => document.querySelector('#ovAttentionList [data-attention="kickDelivery"]');

async function completeClaimOnRewardsThenReturnHome(remaining) {
  navTo("boards");
  server.pendingRedemptions = remaining;
  navTo("home");
  await settle();
}

describe("Home → Needs attention refreshes credits/status on every SPA entry", () => {
  beforeEach(() => {
    server.requests.length = 0;
    server.pendingRedemptions = 1;
    server.channel = { externalId: "kick-1", name: "creator", homeAttention: false };
  });

  it("entering Home in-app requests the selected site's credits/status exactly once and renders the pending claim", async () => {
    navTo("home");
    await settle();
    expect(creditsRequests()).toEqual(["/api/credits/status?siteId=site-1"]);
    expect(claimRow()?.textContent).toContain("1 claim is waiting for you");
    expect(claimRow()?.querySelector("a")?.getAttribute("href")).toContain("site-1");
    expect(document.getElementById("ovAttention").hidden).toBe(false);
  });

  it("re-entering Home after the last claim was completed drops the claim item without a reload", async () => {
    navTo("home");
    await settle();
    expect(claimRow()).not.toBeNull();

    await completeClaimOnRewardsThenReturnHome(0);
    expect(creditsRequests()).toEqual(["/api/credits/status?siteId=site-1", "/api/credits/status?siteId=site-1"]);
    expect(state.CREDITS.usage.pendingRedemptions).toBe(0);
    expect(claimRow()).toBeNull();
    expect(document.getElementById("ovAttention").hidden).toBe(true);
  });

  it("re-entering Home with claims still pending shows the fresh count, not the count from the last visit", async () => {
    navTo("home");
    await settle();
    expect(claimRow()?.textContent).toContain("1 claim is waiting for you");

    await completeClaimOnRewardsThenReturnHome(3);
    expect(claimRow()?.textContent).toContain("3 claims are waiting for you");
    expect(claimRow()?.querySelector("a")?.textContent).toBe("Review claims");
  });

  it("re-entering Home also picks up fresh Kick channel health for the selected site", async () => {
    navTo("home");
    await settle();
    expect(kickRow()).toBeNull();

    navTo("boards");
    server.channel = { externalId: "kick-1", name: "creator", homeAttention: true, connected: true };
    navTo("home");
    await settle();
    expect(kickRow()).not.toBeNull();
    expect(kickRow()?.querySelector("a")?.getAttribute("href")).toContain("site-1");
  });

  it("keeps the credits request scoped to the site selected at entry time", async () => {
    state.ACTIVE_SITE_ID = "site-2";
    state.BOARDS.push({ id: "site-2", name: "Other", published: true, userRole: "owner" });
    try {
      await enterHome();
      expect(creditsRequests()).toEqual(["/api/credits/status?siteId=site-2"]);
    } finally {
      state.ACTIVE_SITE_ID = "site-1";
      state.BOARDS.pop();
    }
  });
});

describe("Home boot owns credits/status through the shell entry, never twice", () => {
  const dashboardJs = readFileSync(new URL("../assets/dashboard.js", import.meta.url), "utf8");
  const shellJs = readFileSync(new URL("../assets/dashboard/shell.js", import.meta.url), "utf8");

  it("navTo(home) is the single place that loads credits/status and the live sections for Home", () => {
    expect(shellJs).toContain('if (page === "home") enterHome();');
    expect(shellJs).toContain("homeEntry = Promise.all([loadCreditsStatus(), loadOverviewLiveData()])");
    expect(dashboardJs).not.toContain("loadOverviewLiveData");
  });

  it("boot only fetches credits/status itself for board settings when Home is not the landing section", () => {
    expect(dashboardJs).toContain('if (hasBoardSettings && route.page !== "home") loadCreditsStatus();');
    expect(dashboardJs).not.toContain('if (hasSection("home") || hasBoardSettings) loadCreditsStatus();');
    expect(dashboardJs).toContain("homeEntrySettled()");
  });
});
