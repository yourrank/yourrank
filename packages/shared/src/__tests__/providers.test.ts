import { describe, expect, it } from "bun:test";
import { getProvider, hasCapability, listProviders } from "../providers/registry.js";
import { normalizeKickRewardEvent } from "../providers/kick.js";
import { isProviderId } from "../providers/types.js";
import { linkedViewerIdentities, viewerDisplayName } from "../viewer-identity.js";

describe("provider registry", () => {
  it("registers only the providers that exist today with their real capabilities", () => {
    expect(listProviders().map((p) => p.id).sort()).toEqual(["discord", "kick"]);
    expect(listProviders("rewards").map((p) => p.id)).toEqual(["kick"]);
    expect(listProviders("viewerAuth").map((p) => p.id).sort()).toEqual(["discord", "kick"]);
    expect(hasCapability(getProvider("discord"), "webhooks")).toBe(false);
    expect(hasCapability(getProvider("kick"), "creatorAuth")).toBe(true);
    expect(getProvider("twitch")).toBeUndefined();
    expect(isProviderId("twitch")).toBe(true);
    expect(isProviderId("steam")).toBe(false);
  });

  it("builds viewer authorize URLs through the adapter", () => {
    const env = {
      KICK_VIEWER_CLIENT_ID: "kv", KICK_VIEWER_CLIENT_SECRET: "s", KICK_VIEWER_REDIRECT_URI: "https://x/cb",
      KICK_CLIENT_ID: "k", KICK_CLIENT_SECRET: "s", KICK_REDIRECT_URI: "https://x/cb",
      DISCORD_CLIENT_ID: "d", DISCORD_CLIENT_SECRET: "s", DISCORD_REDIRECT_URI: "https://x/dcb",
    };
    const kick = getProvider("kick")!.viewerAuth!.buildAuthorizeURL(env, "st", undefined, "chal");
    expect(kick).toContain("https://id.kick.com/oauth/authorize?");
    expect(kick).toContain("code_challenge=chal");
    const discord = getProvider("discord")!.viewerAuth!.buildAuthorizeURL(env, "st");
    expect(discord).toContain("discord.com");
    expect(discord).toContain("state=st");
  });
});

describe("kick normalizeEvent", () => {
  const payload = {
    id: "red-1",
    broadcaster: { user_id: 42 },
    redeemer: { user_id: 7, username: "alice" },
    reward: { id: "r1", title: "Hydrate", cost: 10 },
    status: "fulfilled",
    created_at: "2026-09-01T00:00:00Z",
  };

  it("maps a redemption into the provider-neutral envelope", () => {
    expect(normalizeKickRewardEvent("msg-1", "channel.reward.redemption.updated", payload)).toEqual({
      provider: "kick",
      externalEventId: "msg-1",
      eventType: "reward_redemption",
      payloadType: "channel.reward.redemption.updated",
      externalChannelId: "42",
      externalActorId: "7",
      status: "fulfilled",
      payload,
      occurredAt: "2026-09-01T00:00:00Z",
    });
  });

  it("returns null for events and statuses the loyalty domain does not consume", () => {
    expect(normalizeKickRewardEvent("m", "channel.followed", payload)).toBeNull();
    expect(normalizeKickRewardEvent("m", "channel.reward.redemption.updated", { ...payload, status: "pending" })).toBeNull();
  });
});

describe("viewer identity helpers", () => {
  it("lists linked providers in display order using only *_linked_at as proof", () => {
    const row = {
      kick_user_id: "1", kick_username: "alice", kick_linked_at: null,
      discord_user_id: "2", discord_username: "alice#1", discord_linked_at: "2026-01-01",
    };
    expect(linkedViewerIdentities(row).map((i) => [i.provider, i.label, i.username])).toEqual([["discord", "Discord", "alice#1"]]);
    expect(linkedViewerIdentities({ ...row, kick_linked_at: "2026-01-02" }).map((i) => i.provider)).toEqual(["kick", "discord"]);
    expect(linkedViewerIdentities(null)).toEqual([]);
  });

  it("keeps the current display-name fallback order", () => {
    expect(viewerDisplayName({ kick_username: "k", discord_username: "d" })).toBe("k");
    expect(viewerDisplayName({ kick_username: "", discord_username: "d" })).toBe("d");
    expect(viewerDisplayName({}, "Unnamed member")).toBe("Unnamed member");
  });
});
