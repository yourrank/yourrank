import { describe, expect, it } from "bun:test";
import { deriveKickConnectionHealth } from "../connection-health.js";

const NOW = Date.parse("2026-08-30T12:00:00.000Z");

describe("Kick connection health", () => {
  it("does not turn an optional never-connected integration into a warning", () => {
    expect(deriveKickConnectionHealth({ now: NOW })).toEqual(expect.objectContaining({
      status: "not_connected",
      needsAttention: false,
      homeAttention: false,
    }));
  });

  it("makes a missing channel actionable only when enabled reward mappings depend on it", () => {
    expect(deriveKickConnectionHealth({ activeRewardMappings: 2, operationEnabled: true, now: NOW })).toEqual(expect.objectContaining({
      status: "needs_attention",
      reason: "channel_missing",
      homeAttention: true,
    }));
    expect(deriveKickConnectionHealth({ activeRewardMappings: 2, operationEnabled: false, now: NOW })).toEqual(expect.objectContaining({
      status: "not_connected",
      homeAttention: false,
    }));
  });

  it("does not call an expired access token authorized merely because a refresh credential exists", () => {
    expect(deriveKickConnectionHealth({
      channelLinked: true,
      accountLinked: true,
      hasAccessToken: true,
      hasRefreshToken: true,
      tokenExpiresAt: "2026-08-29T12:00:00.000Z",
      activeRewardMappings: 3,
      now: NOW,
    })).toEqual(expect.objectContaining({
      status: "refresh_required",
      label: "Connected",
      needsAttention: false,
      homeAttention: false,
    }));
  });

  it("requires verification when an access token has no trustworthy expiry", () => {
    expect(deriveKickConnectionHealth({
      channelLinked: true,
      accountLinked: true,
      hasAccessToken: true,
      hasRefreshToken: true,
      tokenExpiresAt: null,
      now: NOW,
    })).toEqual(expect.objectContaining({
      status: "needs_verification",
      label: "Needs verification",
      needsAttention: false,
      homeAttention: false,
    }));
  });

  it("describes stored credentials as authorization, not verified provider health", () => {
    const health = deriveKickConnectionHealth({
      channelLinked: true,
      accountLinked: true,
      hasAccessToken: true,
      hasRefreshToken: true,
      tokenExpiresAt: "2026-08-31T12:00:00.000Z",
      now: NOW,
    });
    expect(health.status).toBe("authorized");
    expect(health.label).toBe("Authorized");
    expect(health.detail).toContain("not independently verified");
  });

  it("alerts Home only when broken authorization affects active reward mappings", () => {
    const disconnectedAuthorization = {
      channelLinked: true,
      accountLinked: false,
      hasAccessToken: false,
      now: NOW,
    };
    expect(deriveKickConnectionHealth({ ...disconnectedAuthorization, activeRewardMappings: 0 })).toEqual(expect.objectContaining({
      status: "needs_attention",
      reason: "authorization_missing",
      homeAttention: false,
    }));
    expect(deriveKickConnectionHealth({ ...disconnectedAuthorization, activeRewardMappings: 2 })).toEqual(expect.objectContaining({
      status: "needs_attention",
      homeAttention: true,
    }));
    expect(deriveKickConnectionHealth({ ...disconnectedAuthorization, activeRewardMappings: 2, operationEnabled: false })).toEqual(expect.objectContaining({
      status: "needs_attention",
      homeAttention: false,
    }));
  });

  describe("event delivery health", () => {
    const authorized = {
      channelLinked: true,
      accountLinked: true,
      hasAccessToken: true,
      hasRefreshToken: true,
      tokenExpiresAt: "2026-08-31T12:00:00.000Z",
      now: NOW,
    };
    const checkedAt = "2026-08-30T11:00:00.000Z";

    it("is Ready when every required subscription was confirmed", () => {
      const health = deriveKickConnectionHealth({
        ...authorized,
        activeRewardMappings: 2,
        usesChatGiveaways: true,
        delivery: { rewardEventsSubscribedAt: checkedAt, chatEventsSubscribedAt: checkedAt, checkedAt },
      });
      expect(health).toEqual(expect.objectContaining({ status: "ready", label: "Ready", needsAttention: false }));
      expect(health.delivery).toEqual(expect.objectContaining({
        verifiedAt: checkedAt,
        required: ["rewardEvents", "chatEvents"],
        missing: [],
        events: { rewardEvents: "subscribed", chatEvents: "subscribed" },
      }));
    });

    it("stays Authorized (not Ready) while delivery has never been reconciled", () => {
      const health = deriveKickConnectionHealth({
        ...authorized,
        activeRewardMappings: 2,
        delivery: { rewardEventsSubscribedAt: null, chatEventsSubscribedAt: null, checkedAt: null },
      });
      expect(health).toEqual(expect.objectContaining({ status: "authorized", needsAttention: false }));
      expect(health.delivery.events).toEqual({ rewardEvents: "unverified", chatEvents: "unverified" });
      expect(health.delivery.missing).toEqual([]);
    });

    it("reports a missing required reward subscription as a repairable delivery fault, not a disconnect", () => {
      const health = deriveKickConnectionHealth({
        ...authorized,
        activeRewardMappings: 2,
        delivery: { rewardEventsSubscribedAt: null, chatEventsSubscribedAt: checkedAt, checkedAt },
      });
      expect(health).toEqual(expect.objectContaining({
        status: "delivery_failed",
        label: "Delivery setup failed",
        reason: "reward_events_missing",
        needsAttention: true,
        homeAttention: true,
        canRepair: true,
      }));
      expect(health.detail).toContain("reward redemption events");
      expect(health.detail).not.toMatch(/reconnect|revoked/i);
    });

    it("requires chat.message.sent only when the site uses Chat Giveaways", () => {
      const missingChat = { rewardEventsSubscribedAt: checkedAt, chatEventsSubscribedAt: null, checkedAt };
      expect(deriveKickConnectionHealth({ ...authorized, activeRewardMappings: 1, usesChatGiveaways: true, delivery: missingChat })).toEqual(expect.objectContaining({
        status: "delivery_failed",
        reason: "chat_events_missing",
        homeAttention: false,
      }));
      expect(deriveKickConnectionHealth({ ...authorized, activeRewardMappings: 1, usesChatGiveaways: false, delivery: missingChat })).toEqual(expect.objectContaining({
        status: "ready",
      }));
    });

    it("does not require reward events when no enabled mapping depends on them", () => {
      const missingRewards = { rewardEventsSubscribedAt: null, chatEventsSubscribedAt: null, checkedAt };
      expect(deriveKickConnectionHealth({ ...authorized, activeRewardMappings: 0, delivery: missingRewards })).toEqual(expect.objectContaining({
        status: "authorized",
        needsAttention: false,
      }));
      expect(deriveKickConnectionHealth({ ...authorized, activeRewardMappings: 2, operationEnabled: false, delivery: missingRewards })).toEqual(expect.objectContaining({
        status: "authorized",
      }));
    });

    it("keeps revoked authorization as reconnect-required even when subscriptions were once confirmed", () => {
      expect(deriveKickConnectionHealth({
        ...authorized,
        hasAccessToken: false,
        activeRewardMappings: 2,
        delivery: { rewardEventsSubscribedAt: checkedAt, chatEventsSubscribedAt: checkedAt, checkedAt },
      })).toEqual(expect.objectContaining({
        status: "needs_attention",
        reason: "authorization_missing",
      }));
    });
  });
});
