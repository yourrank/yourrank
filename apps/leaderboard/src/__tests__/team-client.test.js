import { describe, expect, it } from "bun:test";
import {
  actAndFlush,
  document,
  mountSettingsPage,
  unmountSettingsPage,
  window,
} from "./settings-react-utils.js";

const team = (siteId, name, role = "owner") => ({
  ok: true,
  siteId,
  siteName: name,
  currentRole: role,
  canManageTeam: role === "owner",
  members: [{ userId: "fixture-target", email: "helper@example.test", role: "moderator" }],
  invites: [{ id: "fixture-target", email: "invite@example.test" }],
  seats: { plan: "team", used: 3, limit: 5 },
});

async function mountTeam({ request, confirm, url, user = { email: "owner@example.test", boards: [{ id: "alpha", name: "Atlas Community" }, { id: "beta", name: "Rif Community" }] } } = {}) {
  await mountSettingsPage({
    user,
    ...(url ? { url } : {}),
    deps: {
      request: request || (async (method, path) => {
        if (path === "/api/auth/me") return { ok: true, data: { ok: true, user } };
        return { ok: true, data: team("alpha", "Atlas Community") };
      }),
      confirm: confirm || (async () => false),
    },
  });
}

describe("Team client scope and recovery", () => {
  it("shows the authorized site name, pooled seats and Moderator read-only state", async () => {
    await mountTeam({ request: async (method, path) => path === "/api/auth/me"
      ? { ok: true, data: { ok: true, user: { email: "owner@example.test", boards: [{ id: "alpha", name: "Atlas Community" }] } } }
      : { ok: true, data: team("alpha", "Atlas Community", "moderator") } });
    expect(document.getElementById("teamSiteSelector").value).toBe("alpha");
    expect(document.getElementById("teamSeatUsage").textContent).toBe("3 used · 2 available");
    expect(document.getElementById("teamReadOnlyNotice").hidden).toBe(false);
    expect(document.getElementById("btnOpenInviteModal").hidden).toBe(true);
    expect(document.getElementById("teamPendingSection").hidden).toBe(true);
    expect(document.getElementById("teamMembersList").innerHTML).not.toContain("team-remove-btn");
    await unmountSettingsPage();
  });

  for (const [selector, endpoint] of [[".team-remove-btn", "/api/site/team/remove"], [".team-revoke-invite-btn", "/api/site/team/invite/revoke"]]) {
    it(`keeps the confirmed site when another team renders during ${endpoint}`, async () => {
      let resolveConfirmation;
      let teamRequest = 0;
      const calls = [];
      const user = { email: "owner@example.test", boards: [{ id: "alpha", name: "Atlas Community" }, { id: "beta", name: "Rif Community" }] };
      await mountTeam({
        user,
        confirm: async (_title, description) => {
          expect(description).toContain("Atlas Community");
          return new Promise((resolve) => { resolveConfirmation = resolve; });
        },
        request: async (method, path, body) => {
          if (path === "/api/auth/me") return { ok: true, data: { ok: true, user } };
          if (path.startsWith("/api/site/team?siteId=")) {
            teamRequest += 1;
            return { ok: true, data: team(teamRequest === 1 ? "alpha" : "beta", teamRequest === 1 ? "Atlas Community" : "Rif Community") };
          }
          calls.push([method, path, body]);
          return { ok: false, data: {} };
        },
      });
      document.querySelector(selector).click();
      await actAndFlush(() => {
        const select = document.getElementById("teamSiteSelector");
        select.value = "beta";
        select.dispatchEvent(new window.Event("change", { bubbles: true }));
      });
      resolveConfirmation(true);
      await actAndFlush();
      const mutationCalls = calls.filter(([, path]) => path === endpoint);
      expect(mutationCalls).toHaveLength(1);
      expect(mutationCalls[0][2].siteId).toBe("alpha");
      await unmountSettingsPage();
    });
  }

  it("prefers an explicit site URL and clears stale controls after a failed request", async () => {
    const calls = [];
    await mountTeam({
      url: "/dashboard/settings/team?siteId=beta",
      request: async (method, path) => {
        if (path === "/api/auth/me") return { ok: true, data: { ok: true, user: { email: "owner@example.test", boards: [{ id: "alpha", name: "Atlas Community" }, { id: "beta", name: "Rif Community" }] } } };
        calls.push([method, path]);
        throw new Error("offline");
      },
    });
    expect(calls[0][1]).toBe("/api/site/team?siteId=beta");
    expect(document.getElementById("teamSiteSelector").value).toBe("");
    expect(document.getElementById("btnOpenInviteModal").hidden).toBe(true);
    expect(document.getElementById("teamSeatUsage").textContent).toBe("Operator seats unavailable");
    expect(document.getElementById("teamSeatContext").textContent).toBe("Reload to try again.");
    expect(document.getElementById("teamMembersList").textContent).toContain("Could not load this site's team. Reload to try again.");
    expect(document.getElementById("teamInvitesList").textContent).toBe("Unavailable");
    await unmountSettingsPage();
  });

  it("does not render a response that arrives after leaving the settings page", async () => {
    let resolveRequest;
    const user = { email: "owner@example.test", boards: [{ id: "alpha", name: "Atlas Community" }] };
    await mountTeam({
      request: (method, path) => {
        if (path === "/api/auth/me") return Promise.resolve({ ok: true, data: { ok: true, user } });
        return new Promise((resolve) => { resolveRequest = resolve; });
      },
    });
    await unmountSettingsPage();
    resolveRequest({ ok: true, data: team("alpha", "Atlas Community") });
    await actAndFlush();
    expect(document.getElementById("teamSiteSelector")).toBeNull();
  });
});
