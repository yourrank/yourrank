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
      label: "Refresh required",
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
});
