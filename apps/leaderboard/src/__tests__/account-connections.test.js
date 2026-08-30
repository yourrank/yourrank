import { describe, expect, it } from "bun:test";
import { handleAccountConnectedAccounts } from "../handlers/account.js";

const request = (query = "") => new Request(`https://yourrank.site/api/account/connected-accounts${query}`);

function dependencies({ identity = {}, sites = [] } = {}) {
  return {
    requireUser: async () => ({
      user: {
        id: "owner-1",
        kick_user_id: "provider-user-secret",
        kick_username: "creator",
        kick_linked_at: "2026-08-01T00:00:00.000Z",
        telegram_user_id: 998877,
        telegram_username: "creator_tg",
      },
      res: null,
    }),
    rateLimit: async () => ({ ok: true }),
    query: async () => sites,
    one: async () => ({
      kick_token_expires_at: "2026-09-30T00:00:00.000Z",
      telegram_linked_at: "2026-08-02T00:00:00.000Z",
      has_kick_access_token: true,
      has_kick_refresh_token: true,
      ...identity,
    }),
  };
}

describe("Settings connection inventory", () => {
  it("returns explicit mixed scopes without provider IDs, tokens, or webhook values", async () => {
    const response = await handleAccountConnectedAccounts(request(), {}, dependencies({
      sites: [{
        id: "site-1",
        name: "Long Community Name",
        slug: "long-community",
        kick_channel_external_id: "provider-channel-secret",
        kick_channel_name: "community",
        discord_webhook_url_enc: "encrypted-webhook-secret",
        telegram_chat_id: "private-chat-id",
        telegram_notify: true,
        active_reward_mappings: 2,
      }],
    }));
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.connections.map(({ provider, scope, statusLabel }) => ({ provider, scope, statusLabel }))).toEqual([
      { provider: "Kick", scope: "Creator account", statusLabel: "Authorized" },
      { provider: "Telegram", scope: "Creator account", statusLabel: "Linked" },
      { provider: "Kick rewards", scope: "Long Community Name", statusLabel: "Authorized" },
      { provider: "Discord delivery", scope: "Long Community Name", statusLabel: "Configured" },
      { provider: "Telegram delivery", scope: "Long Community Name", statusLabel: "Enabled" },
    ]);
    expect(serialized).not.toContain("provider-user-secret");
    expect(serialized).not.toContain("provider-channel-secret");
    expect(serialized).not.toContain("encrypted-webhook-secret");
    expect(serialized).not.toContain("private-chat-id");
    expect(serialized).not.toMatch(/access_token|refresh_token|webhook_url|telegram_user_id|kick_user_id/i);
  });

  it("keeps optional unconfigured delivery quiet and makes broken active Kick authorization actionable", async () => {
    const response = await handleAccountConnectedAccounts(request(), {}, dependencies({
      identity: { has_kick_access_token: false, has_kick_refresh_token: false },
      sites: [{
        id: "site-1",
        name: "Site One",
        slug: "one",
        kick_channel_external_id: "channel",
        kick_channel_name: "one",
        discord_webhook_url_enc: null,
        telegram_chat_id: null,
        telegram_notify: false,
        active_reward_mappings: 1,
      }],
    }));
    const body = await response.json();
    const kick = body.connections.find(({ id }) => id === "kick-site:site-1");
    const accountKick = body.connections.find(({ id }) => id === "kick-account");
    const discord = body.connections.find(({ id }) => id === "discord-site:site-1");
    const telegram = body.connections.find(({ id }) => id === "telegram-site:site-1");

    expect(accountKick).toEqual(expect.objectContaining({ status: "needs_attention", statusLabel: "Needs attention" }));
    expect(accountKick.action.label).toBe("Reconnect");
    expect(kick).toEqual(expect.objectContaining({ status: "needs_attention", statusLabel: "Needs attention" }));
    expect(kick.action).toEqual({ label: "Reconnect", href: "/auth/kick?siteId=site-1" });
    expect(discord).toEqual(expect.objectContaining({ status: "not_configured", statusLabel: "Not configured" }));
    expect(telegram).toEqual(expect.objectContaining({ status: "not_configured", statusLabel: "Not configured" }));
  });

  it("labels an expired access token with unverified refreshability truthfully", async () => {
    const response = await handleAccountConnectedAccounts(request(), {}, dependencies({
      identity: { kick_token_expires_at: "2026-08-29T00:00:00.000Z", has_kick_refresh_token: true },
      sites: [{
        id: "site-1",
        name: "Site One",
        slug: "one",
        kick_channel_external_id: "channel",
        kick_channel_name: "one",
        discord_webhook_url_enc: null,
        telegram_chat_id: null,
        telegram_notify: false,
        active_reward_mappings: 1,
      }],
    }));
    const body = await response.json();
    expect(body.connections.find(({ id }) => id === "kick-account")).toEqual(expect.objectContaining({
      status: "refresh_required",
      statusLabel: "Refresh required",
    }));
    expect(body.connections.find(({ id }) => id === "kick-site:site-1")).toEqual(expect.objectContaining({
      status: "refresh_required",
      statusLabel: "Refresh required",
    }));
  });

  it("builds every site-settings action with canonical board context for a two-site owner", async () => {
    const response = await handleAccountConnectedAccounts(request("?board=site-b"), {}, dependencies({
      sites: ["A", "B"].map((suffix) => ({
        id: `site-${suffix.toLowerCase()}`,
        name: `Site ${suffix}`,
        slug: suffix.toLowerCase(),
        kick_channel_external_id: `channel-${suffix}`,
        kick_channel_name: suffix.toLowerCase(),
        discord_webhook_url_enc: "encrypted",
        telegram_chat_id: "chat",
        telegram_notify: true,
        active_reward_mappings: 1,
      })),
    }));
    const body = await response.json();
    expect(body.selectedSiteId).toBe("site-b");
    expect(body.connections.slice(2, 5).every(({ selectedSite }) => selectedSite)).toBe(true);
    expect(body.connections.slice(2, 5).map(({ id }) => id)).toEqual([
      "kick-site:site-b",
      "discord-site:site-b",
      "telegram-site:site-b",
    ]);
    expect(body.connections.find(({ id }) => id === "kick-account").action.href).toContain("siteId=site-b");
    for (const provider of ["discord-site:site-b", "telegram-site:site-b"]) {
      const action = body.connections.find(({ id }) => id === provider).action;
      expect(action.href).toContain("/dashboard/site?");
      expect(action.href).toContain("board=site-b");
      expect(action.href).toContain("tab=notifications");
      expect(action.href).not.toContain("siteId=");
    }
  });
});
