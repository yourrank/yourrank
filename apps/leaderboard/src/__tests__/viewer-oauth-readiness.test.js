import { describe, expect, test } from "bun:test";
import { resolveViewerOAuthStatus, viewerOAuthAvailability } from "../viewer-oauth.js";
import {
  handleKickViewerAuthStart,
  handleKickViewerAuthCallback,
  handleDiscordViewerAuthStart,
  handleDiscordViewerAuthCallback,
} from "../handlers/viewer-auth.js";
import { handleViewerMe } from "../handlers/viewer-dashboard.js";
import { viewerDashboardPage } from "../pages/viewer-dashboard.js";
import { renderSite } from "@yourrank/shared/site-render";
import { maskViewerAuthProviders } from "../site.js";

const request = (path = "/me") => new Request(`https://yourrank.site${path}`);
const credentials = {
  KICK_CLIENT_ID: "kick-id",
  KICK_CLIENT_SECRET: "kick-secret",
  DISCORD_CLIENT_ID: "discord-id",
  DISCORD_CLIENT_SECRET: "discord-secret",
};
const readyStatus = {
  kick: { available: true, reason: "available", redirectUri: "https://yourrank.site/auth/kick/callback" },
  discord: { available: true, reason: "available", redirectUri: "https://yourrank.site/api/viewer/auth/discord/callback" },
};
const noRateLimit = async () => ({ ok: true });

function env(overrides = {}) {
  return { ...credentials, ...overrides };
}

describe("Viewer OAuth readiness", () => {
  test("resolves configured providers with safe callback-only output", () => {
    const status = resolveViewerOAuthStatus(request(), env());
    expect(status).toEqual(readyStatus);
    expect(JSON.stringify(status)).not.toContain("secret");
    expect(viewerOAuthAvailability(status)).toEqual({ kick: true, discord: true });
  });

  test("fails closed for missing credentials, disabled providers, invalid switches, and callback mismatch", () => {
    expect(resolveViewerOAuthStatus(request(), env({ KICK_CLIENT_SECRET: "" })).kick)
      .toMatchObject({ available: false, reason: "missing_credentials" });
    expect(resolveViewerOAuthStatus(request(), env({ VIEWER_DISCORD_OAUTH_ENABLED: "false" })).discord)
      .toMatchObject({ available: false, reason: "disabled" });
    expect(resolveViewerOAuthStatus(request(), env({ VIEWER_KICK_OAUTH_ENABLED: "maybe" })).kick)
      .toMatchObject({ available: false, reason: "invalid_switch" });
    expect(resolveViewerOAuthStatus(request(), env({ KICK_REDIRECT_URI: "https://other.example/auth/kick/callback" })).kick)
      .toMatchObject({ available: false, reason: "invalid_callback" });
  });

  test("requires exact canonical staging callbacks and rejects unsupported local callbacks", () => {
    const staging = resolveViewerOAuthStatus(
      new Request("https://staging.yourrank.site/me"),
      env({ ENVIRONMENT: "staging", PUBLIC_BASE_URL: "https://staging.yourrank.site" }),
    );
    expect(staging.kick.redirectUri).toBe("https://staging.yourrank.site/auth/kick/callback");
    expect(staging.discord.redirectUri).toBe("https://staging.yourrank.site/api/viewer/auth/discord/callback");
    expect(resolveViewerOAuthStatus(
      new Request("https://staging.yourrank.site/me"),
      env({ ENVIRONMENT: "staging", KICK_REDIRECT_URI: "https://yourrank.site/auth/kick/callback" }),
    ).kick).toMatchObject({ available: false, reason: "invalid_callback" });

    const local = resolveViewerOAuthStatus(
      new Request("http://localhost:8791/me"),
      env({ KICK_REDIRECT_URI: "http://localhost:8791/auth/kick/callback", DISCORD_REDIRECT_URI: "http://localhost:8791/api/viewer/auth/discord/callback" }),
    );
    expect(local.kick).toMatchObject({ available: false, reason: "invalid_callback" });
    expect(local.discord).toMatchObject({ available: false, reason: "invalid_callback" });
    expect(resolveViewerOAuthStatus("ftp://localhost/me", env()).kick)
      .toMatchObject({ available: false, reason: "invalid_callback" });
  });

  test("requires an explicit exact Discord callback on custom domains", async () => {
    const customRequest = new Request("https://community.example/api/viewer/auth/discord");
    expect(resolveViewerOAuthStatus(customRequest, env()).discord)
      .toMatchObject({ available: false, reason: "invalid_callback" });
    const customEnv = env({
      VIEWER_DISCORD_OAUTH_ENABLED: "true",
      DISCORD_REDIRECT_URI: "https://community.example/api/viewer/auth/discord/callback",
    });
    expect(resolveViewerOAuthStatus(customRequest, customEnv).discord).toMatchObject({
      available: true,
      redirectUri: "https://community.example/api/viewer/auth/discord/callback",
    });

    let stored;
    const response = await handleDiscordViewerAuthStart(customRequest, customEnv, {
      rateLimit: noRateLimit,
      clientIp: () => "127.0.0.1",
      resolveVerifiedCustomDomain: async () => ({
        hostname: "community.example",
        site_id: "site-1",
        binding_id: "binding-1",
        slug: "community",
      }),
      storeOAuthState: async (_provider, _state, data) => { stored = data; },
      buildDiscordAuthorizeURL: (_env, _state, _scope, redirectUri) => `https://discord.test/start?redirect_uri=${encodeURIComponent(redirectUri)}`,
    });
    expect(response.headers.get("location")).toContain("https://discord.test/start?");
    expect(stored.redirectUri).toBe("https://community.example/api/viewer/auth/discord/callback");
  });

  test("fails HTTP localhost before creating an OAuth transaction", async () => {
    for (const [provider, handler] of [["kick", handleKickViewerAuthStart], ["discord", handleDiscordViewerAuthStart]]) {
      let generated = false;
      let stored = false;
      let built = false;
      const response = await handler(
        new Request(`http://localhost:8791/api/viewer/auth/${provider}`),
        env({
          PUBLIC_BASE_URL: "http://localhost:8791",
          VIEWER_KICK_OAUTH_ENABLED: "true",
          VIEWER_DISCORD_OAUTH_ENABLED: "true",
          KICK_REDIRECT_URI: "http://localhost:8791/auth/kick/callback",
          DISCORD_REDIRECT_URI: "http://localhost:8791/api/viewer/auth/discord/callback",
        }),
        {
          rateLimit: noRateLimit,
          clientIp: () => "127.0.0.1",
          generatePKCE: async () => { generated = true; return { codeVerifier: "v", codeChallenge: "c" }; },
          storeOAuthState: async () => { stored = true; },
          ...(provider === "kick"
            ? { buildKickViewerAuthorizeURL: () => { built = true; return "https://provider.test"; } }
            : { buildDiscordAuthorizeURL: () => { built = true; return "https://provider.test"; } }),
        },
      );
      expect(response.headers.get("location")).toContain(`error=${provider}_signin_unavailable`);
      expect(generated).toBe(false);
      expect(stored).toBe(false);
      expect(built).toBe(false);
    }
  });

  for (const [provider, handler] of [["kick", handleKickViewerAuthStart], ["discord", handleDiscordViewerAuthStart]]) {
    test(`${provider} unavailable start fails before PKCE, state, or authorization URL`, async () => {
      let generated = false;
      let stored = false;
      let built = false;
      const response = await handler(request(`/api/viewer/auth/${provider}`), {}, {
        rateLimit: noRateLimit,
        clientIp: () => "127.0.0.1",
        resolveViewerOAuthStatus: () => ({ [provider]: { available: false, reason: "disabled", redirectUri: "" } }),
        generatePKCE: async () => { generated = true; return { codeVerifier: "v", codeChallenge: "c" }; },
        storeOAuthState: async () => { stored = true; },
        ...(provider === "kick"
          ? { buildKickViewerAuthorizeURL: () => { built = true; return "https://provider.test"; } }
          : { buildDiscordAuthorizeURL: () => { built = true; return "https://provider.test"; } }),
      });
      expect(response.headers.get("location")).toContain(`error=${provider}_signin_unavailable`);
      expect(generated).toBe(false);
      expect(stored).toBe(false);
      expect(built).toBe(false);
    });
  }

  test("returns provider-specific callback integrity errors", async () => {
    const kick = await handleKickViewerAuthCallback(
      request("/auth/kick/callback?code=code&state=state"),
      {},
      {
        stateData: {
          transactionVersion: 1,
          flow: "viewer",
          provider: "kick",
          authority: { authority: "global" },
          origin: "https://yourrank.site",
          redirectUri: "https://yourrank.site/not-the-kick-callback",
        },
      },
    );
    expect(kick.headers.get("location")).toBe("/me?error=kick_oauth_callback_mismatch");

    const discord = await handleDiscordViewerAuthCallback(
      request("/api/viewer/auth/discord/callback?code=code&state=state"),
      {},
      {
        consumeOAuthState: async () => ({
          transactionVersion: 1,
          flow: "viewer",
          provider: "discord",
          authority: { authority: "global" },
          origin: "https://yourrank.site",
          redirectUri: "https://yourrank.site/not-the-discord-callback",
        }),
      },
    );
    expect(discord.headers.get("location")).toBe("/me?error=discord_oauth_callback_mismatch");
  });
});

describe("Viewer provider availability rendering", () => {
  test("masks creator provider flags at the public-site boundary", () => {
    expect(maskViewerAuthProviders(
      { viewer_kick_auth_enabled: true, viewer_discord_auth_enabled: true },
      {
        kick: { available: false, reason: "missing_credentials", redirectUri: "" },
        discord: { available: true, reason: "available", redirectUri: "https://yourrank.site/api/viewer/auth/discord/callback" },
      },
    )).toEqual({
      viewerKickAuthEnabled: false,
      viewerDiscordAuthEnabled: true,
      viewerAuthProviders: { kick: false, discord: true },
    });
    expect(maskViewerAuthProviders(
      { viewer_kick_auth_enabled: false, viewer_discord_auth_enabled: false },
      readyStatus,
    ).viewerAuthProviders).toEqual({ kick: false, discord: false });
  });

  test("filters unavailable providers from global /me metadata", async () => {
    const response = await handleViewerMe(request("/api/viewer/me"), {}, {
      requireViewer: async () => ({
        viewer: {
          id: "viewer-1",
          created_at: "2026-01-01T00:00:00.000Z",
          kick_linked_at: null,
          discord_linked_at: null,
        },
        res: null,
      }),
      rateLimit: noRateLimit,
      query: async () => [],
      resolveViewerOAuthStatus: () => ({
        kick: { available: false, reason: "disabled", redirectUri: "" },
        discord: { available: true, reason: "available", redirectUri: "https://yourrank.site/api/viewer/auth/discord/callback" },
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ authProviders: { kick: false, discord: true } });
  });

  test("renders only available account providers and honest zero-provider state", () => {
    const discordOnly = viewerDashboardPage(null, { kick: false, discord: true });
    expect(discordOnly).not.toContain('id="vd-login-kick"');
    expect(discordOnly).toContain('id="vd-login-discord"');
    expect(discordOnly).toContain('class="btn btn--accent" id="vd-login-discord"');

    const none = viewerDashboardPage(null, { kick: false, discord: false });
    expect(none).not.toContain("/api/viewer/auth/kick");
    expect(none).not.toContain("/api/viewer/auth/discord");
    expect(none).toContain("Viewer sign-in is not available on this site right now");
  });

  test("games selects the available provider and falls back to /me", async () => {
    const base = { data: { brand: { name: "Demo" }, siteSections: { games: true } }, plan: "pro" };
    const discord = await renderSite({
      r: { ...base, viewerKickAuthEnabled: false, viewerDiscordAuthEnabled: true },
      section: "games", viewer: null, viewerData: null,
      opts: { nonce: "n", homeUrl: "https://yourrank.site", slug: "demo", isCustomDomain: false, watermark: false },
    });
    expect(discord).toContain("/api/viewer/auth/discord?");
    expect(discord).not.toContain("/api/viewer/auth/kick?");

    const none = await renderSite({
      r: { ...base, viewerKickAuthEnabled: false, viewerDiscordAuthEnabled: false },
      section: "games", viewer: null, viewerData: null,
      opts: { nonce: "n", homeUrl: "https://yourrank.site", slug: "demo", isCustomDomain: false, watermark: false },
    });
    expect(none).toContain('href="/me"');
    expect(none).not.toContain("/api/viewer/auth/kick?");
  });
});
