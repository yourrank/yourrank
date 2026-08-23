import { describe, expect, it } from "bun:test";
import {
  handleArchive,
  handleArchiveDelete,
  handleDeleteSite,
  handleExportStats,
  handleHeatmap,
  handleNotifyTest,
  handleStats,
} from "../handlers/sites.js";

const site = { id: "site-1", user_id: "owner-1", slug: "board" };
const env = {};
const user = { id: "member-1", status: "active" };
const request = (url, body) => new Request(`https://example.test${url}`, {
  method: body ? "POST" : "GET",
  headers: body ? { "content-type": "application/json" } : undefined,
  body: body ? JSON.stringify(body) : undefined,
});

function deps(role, extra = {}) {
  return {
    requireUserImpl: async () => ({ user, res: null }),
    getByUserImpl: async () => site,
    getBoardByIdImpl: async () => site,
    requireSiteCapabilityImpl: async (_user, _site, capability) => (
      ["owner", "manager", "moderator"].includes(role) &&
      (capability === "canRoleManageBilling" ? role === "owner" : true)
        ? { role, res: null }
        : { role, res: new Response("forbidden", { status: 403 }) }
    ),
    ...extra,
  };
}

describe("archive and notification scope", () => {
  it("deletes an archive for the selected site", async () => {
    const calls = [];
    const selectedSite = { id: "site-2", user_id: "owner-1", slug: "other" };
    const response = await handleArchiveDelete(
      request("/api/site/archive/delete", { id: "arch-1", siteId: "site-2" }),
      env,
      {
        ...deps("owner"),
        getBoardByIdImpl: async (_env, _uid, siteId) => {
          calls.push({ type: "getBoardById", siteId });
          return selectedSite;
        },
        deleteArchiveImpl: async (_env, _uid, id, siteId) => {
          calls.push({ type: "deleteArchive", id, siteId });
          return { ok: true };
        },
      }
    );
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      { type: "getBoardById", siteId: "site-2" },
      { type: "deleteArchive", id: "arch-1", siteId: "site-2" },
    ]);
  });

  it("falls back to the active site when deleting an archive without siteId", async () => {
    const calls = [];
    const response = await handleArchiveDelete(
      request("/api/site/archive/delete", { id: "arch-2" }),
      env,
      {
        ...deps("owner"),
        deleteArchiveImpl: async (_env, _uid, id, siteId) => {
          calls.push({ type: "deleteArchive", id, siteId });
          return { ok: true };
        },
      }
    );
    expect(response.status).toBe(200);
    expect(calls).toEqual([{ type: "deleteArchive", id: "arch-2", siteId: site.id }]);
  });

  it("sends a Discord test notification for the selected site", async () => {
    const calls = [];
    const proUser = { id: "owner-1", status: "active", plan: "pro", plan_expires_at: Date.now() + 86400000 };
    const selectedSite = { id: "site-2", user_id: "owner-1", slug: "other", name: "Other Board" };
    const response = await handleNotifyTest(
      request("/api/site/notify/test", { channel: "discord", webhook_url: "https://discord.com/api/webhooks/123/token", siteId: "site-2" }),
      env,
      {
        requireUserImpl: async () => ({ user: proUser, res: null }),
        getBoardByIdImpl: async (_env, _uid, siteId) => {
          calls.push({ type: "getBoardById", siteId });
          return selectedSite;
        },
        getByUserImpl: async () => { throw new Error("should not fall back to getByUser"); },
        requireSiteCapabilityImpl: async (_user, s, capability) => {
          calls.push({ type: "capability", siteId: s.id, capability });
          return { role: "owner", res: null };
        },
        sendDiscordWebhookImpl: async (url, _embed) => {
          calls.push({ type: "sendDiscord", url });
          return { ok: true };
        },
      }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(calls).toEqual([
      { type: "getBoardById", siteId: "site-2" },
      { type: "capability", siteId: "site-2", capability: "canRoleManageBot" },
      { type: "sendDiscord", url: "https://discord.com/api/webhooks/123/token" },
    ]);
  });

  it("falls back to the active site when sending a test notification without siteId", async () => {
    const calls = [];
    const proUser = { id: "owner-1", status: "active", plan: "pro", plan_expires_at: Date.now() + 86400000 };
    const response = await handleNotifyTest(
      request("/api/site/notify/test", { channel: "discord", webhook_url: "https://discord.com/api/webhooks/123/token" }),
      env,
      {
        requireUserImpl: async () => ({ user: proUser, res: null }),
        getByUserImpl: async () => {
          calls.push({ type: "getByUser" });
          return site;
        },
        getBoardByIdImpl: async () => { throw new Error("should not call getBoardById"); },
        requireSiteCapabilityImpl: async (_user, s, capability) => {
          calls.push({ type: "capability", siteId: s.id, capability });
          return { role: "owner", res: null };
        },
        sendDiscordWebhookImpl: async (url) => {
          calls.push({ type: "sendDiscord", url });
          return { ok: true };
        },
      }
    );
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      { type: "getByUser" },
      { type: "capability", siteId: site.id, capability: "canRoleManageBot" },
      { type: "sendDiscord", url: "https://discord.com/api/webhooks/123/token" },
    ]);
  });
});

describe("site role handler authorization", () => {
  for (const role of ["manager", "moderator"]) {
    it(`${role} can read stats and heatmap`, async () => {
      const stats = await handleStats(request("/api/site/stats"), env, {
        ...deps(role),
        getStatsImpl: async () => ({ today: {} }),
      });
      const heatmap = await handleHeatmap(request("/api/site/stats/heatmap"), env, {
        ...deps(role),
        getHeatmapImpl: async () => [],
        getTopReferrersImpl: async () => [],
      });
      expect(stats.status).toBe(200);
      expect(heatmap.status).toBe(200);
    });

    it(`${role} can create an archive`, async () => {
      const response = await handleArchive(
        request("/api/site/archive", { label: "snapshot", clear: "none" }),
        env,
        {
          ...deps(role),
          rateLimitImpl: async () => ({ ok: true }),
          createArchiveImpl: async () => ({ label: "snapshot" }),
        }
      );
      expect(response.status).toBe(200);
    });
  }

  it("denies a moderator from exporting stats or deleting a board", async () => {
    const exportResponse = await handleExportStats(
      request("/api/site/stats/export"),
      env,
      {
        ...deps("moderator"),
        rateLimitImpl: async () => ({ ok: true }),
      }
    );
    const deleteResponse = await handleDeleteSite(
      request("/api/site", { siteId: site.id }),
      env,
      {
        ...deps("moderator"),
        rateLimitImpl: async () => ({ ok: true }),
      }
    );
    expect(exportResponse.status).toBe(403);
    expect(deleteResponse.status).toBe(403);
  });
});
