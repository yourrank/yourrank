import { describe, expect, test } from "bun:test";
import { handleKickAuthCallback, handleKickAuthDisconnect, handleKickAuthStart } from "../handlers/kick-auth.js";
import {
  handleKickViewerAuthCallback,
  handleKickViewerAuthHandoff,
  handleKickViewerAuthStart,
  handleDiscordViewerAuthStart,
  handleDiscordViewerAuthCallback,
  KICK_VIEWER_STATE_PREFIX,
} from "../handlers/viewer-auth.js";

const user = { id: "user-1" };
const site = { id: "site-1", user_id: "owner-1" };
const noRateLimit = async () => ({ ok: true });
const ownerCapability = async (_user, _site, capability) => {
  expect(capability).toBe("canRoleManageConnections");
  return { role: "owner", res: null };
};
const pkce = async () => ({ codeVerifier: "verifier", codeChallenge: "challenge" });

function request(path) {
  return new Request(`https://test.local${path}`);
}

describe("Kick OAuth state integration seams", () => {
  test("requires an authenticated user before rate limiting or site lookup", async () => {
    let rateLimited = false;
    const response = await handleKickAuthStart(request("/auth/kick?siteId=site-1"), {}, {
      currentUser: async () => null,
      rateLimit: async () => {
        rateLimited = true;
        return { ok: true };
      },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
    expect(rateLimited).toBe(false);
  });

  test("streamer and viewer starts use the same injected state collaborator", async () => {
    const calls = [];
    const storeOAuthState = async (...args) => calls.push(args);
    const streamer = await handleKickAuthStart(request("/auth/kick?siteId=site-1"), {}, {
      currentUser: async () => user,
      rateLimit: noRateLimit,
      one: async () => site,
      requireSiteCapability: ownerCapability,
      storeOAuthState,
      generatePKCE: pkce,
      buildKickAuthorizeURL: (_env, state) => `https://kick.test/authorize?state=${state}`,
    });
    const viewer = await handleKickViewerAuthStart(request("/api/viewer/auth/kick"), {}, {
      rateLimit: noRateLimit,
      clientIp: () => "127.0.0.1",
      storeOAuthState,
      generatePKCE: pkce,
      buildKickViewerAuthorizeURL: (_env, state) => `https://kick.test/authorize?state=${state}`,
    });

    expect(streamer.status).toBe(302);
    expect(viewer.status).toBe(302);
    expect(calls).toHaveLength(2);
    expect(calls.map(([provider]) => provider)).toEqual(["kick", "kick"]);
    expect(calls[0][2]).toMatchObject({ siteId: "site-1", userId: "user-1" });
    expect(calls[1][2]).toMatchObject({
      flow: "viewer",
      codeVerifier: "verifier",
      redirectUri: "https://yourrank.site/auth/kick/callback",
    });
    expect(calls[1][1]).toMatch(KICK_VIEWER_STATE_PREFIX);
  });

  test("viewer start uses the registered Kick callback URI from env", async () => {
    let authorizeArgs;
    const response = await handleKickViewerAuthStart(request("/api/viewer/auth/kick?returnTo=/me"), {}, {
      rateLimit: noRateLimit,
      clientIp: () => "127.0.0.1",
      storeOAuthState: async () => {},
      generatePKCE: pkce,
      buildKickViewerAuthorizeURL: (...args) => {
        authorizeArgs = args;
        return "https://kick.test/authorize";
      },
    });

    expect(response.status).toBe(302);
    expect(authorizeArgs[4]).toBe("https://yourrank.site/auth/kick/callback");
  });

  test("explicit Kick and Discord Join starts store a site-bound intent in single-use OAuth state", async () => {
    const stored = [];
    const common = {
      rateLimit: noRateLimit,
      clientIp: () => "127.0.0.1",
      storeOAuthState: async (...args) => stored.push(args),
      getPublicSite: async (_env, slug) => ({ id: "site-beta", slug, data: { siteSections: { me: true } } }),
      resolveCustomDomain: async () => "beta",
    };
    await handleKickViewerAuthStart(request("/api/viewer/auth/kick?intent=join&site=beta&returnTo=/me"), {}, {
      ...common,
      generatePKCE: pkce,
      buildKickViewerAuthorizeURL: () => "https://kick.test/authorize",
    });
    await handleDiscordViewerAuthStart(request("/api/viewer/auth/discord?intent=join&site=beta&returnTo=/me"), {}, {
      ...common,
      buildDiscordAuthorizeURL: () => "https://discord.test/authorize",
    });

    expect(stored).toHaveLength(2);
    for (const [, , stateData] of stored) {
      expect(stateData).toMatchObject({
        flow: "viewer",
        intent: "join",
        joinSiteId: "site-beta",
        joinSiteSlug: "beta",
      });
    }
  });

  test("substituted custom-domain Join targets are rejected before OAuth state is stored", async () => {
    let stored = false;
    const response = await handleKickViewerAuthStart(request("/api/viewer/auth/kick?intent=join&site=other&returnTo=/me"), {}, {
      rateLimit: noRateLimit,
      clientIp: () => "127.0.0.1",
      resolveCustomDomain: async () => "beta",
      getPublicSite: async () => { throw new Error("must not resolve a substituted target"); },
      storeOAuthState: async () => { stored = true; },
    });
    expect(response.headers.get("location")).toContain("error=join_unavailable");
    expect(stored).toBe(false);
  });

  test("the canonical callback dispatches a viewer state after consuming it once", async () => {
    let consumed = 0;
    let dispatched;
    const response = await handleKickAuthCallback(request("/auth/kick/callback?code=code&state=state"), {}, {
      consumeOAuthState: async () => {
        consumed += 1;
        return { flow: "viewer", codeVerifier: "verifier", origin: "https://yourrank.site", returnTo: "/me" };
      },
      viewerCallback: async (_request, _env, deps) => {
        dispatched = deps.stateData;
        expect(deps.stateConsumed).toBe(true);
        return new Response(null, { status: 302, headers: { location: "https://yourrank.site/me" } });
      },
      currentUser: async () => {
        throw new Error("viewer dispatch must not require a streamer session");
      },
    });

    expect(response.status).toBe(302);
    expect(consumed).toBe(1);
    expect(dispatched).toMatchObject({ flow: "viewer" });
  });

  test("expired viewer state uses its public prefix without consuming twice", async () => {
    let consumed = 0;
    const response = await handleKickAuthCallback(
      request(`/auth/kick/callback?code=code&state=${KICK_VIEWER_STATE_PREFIX}expired`),
      {},
      {
        consumeOAuthState: async () => {
          consumed += 1;
          return null;
        },
        currentUser: async () => {
          throw new Error("expired viewer state must not require a streamer session");
        },
      },
    );

    expect(response.headers.get("location")).toBe("/me?error=oauth_state_expired");
    expect(consumed).toBe(1);
  });

  test("expired unprefixed state keeps streamer callback behavior", async () => {
    let consumed = 0;
    const response = await handleKickAuthCallback(
      request("/auth/kick/callback?code=code&state=expired"),
      {},
      {
        consumeOAuthState: async () => {
          consumed += 1;
          return null;
        },
        currentUser: async () => null,
      },
    );

    expect(response.headers.get("location")).toBe("/login");
    expect(consumed).toBe(1);
  });

  test("viewer callback sets a cookie directly for a cookie-covered origin", async () => {
    const response = await handleKickViewerAuthCallback(request("/auth/kick/callback?code=code&state=state"), {}, {
      stateData: { flow: "viewer", codeVerifier: "verifier", origin: "https://streamer.yourrank.site", returnTo: "/me" },
      exchangeKickViewerCode: async () => ({ access_token: "access" }),
      fetchKickCurrentUser: async () => ({ user_id: 42, name: "viewer" }),
      encryptKickToken: async (value) => `enc:${value}`,
      one: async () => null,
      exec: async (sql) => sql.includes("INSERT INTO viewers") ? [{ id: "viewer-1" }] : [],
      createViewerSession: async () => "session-token",
      viewerCookieSet: (token) => `yr_viewer=${token}; Domain=.yourrank.site`,
    });

    expect(response.headers.get("location")).toBe("https://streamer.yourrank.site/me");
    expect(response.headers.get("set-cookie")).toContain("yr_viewer=session-token");
  });

  test("generic Kick sign-in from a creator path authenticates only the Viewer Account", async () => {
    const queries = [];
    const memberships = [];
    const response = await handleKickViewerAuthCallback(request("/auth/kick/callback?code=code&state=state"), {}, {
      stateData: { flow: "viewer", codeVerifier: "verifier", origin: "https://streamer.yourrank.site", returnTo: "/streamer-slug/me" },
      exchangeKickViewerCode: async () => ({ access_token: "access" }),
      fetchKickCurrentUser: async () => ({ user_id: 42, name: "viewer" }),
      encryptKickToken: async (value) => `enc:${value}`,
      one: async (sql) => {
        queries.push(sql);
        return sql.includes("FROM sites") ? { id: "site-1" } : null;
      },
      exec: async (sql, params) => {
        if (sql.includes("INSERT INTO viewers")) return [{ id: "viewer-1" }];
        if (sql.includes("INSERT INTO site_viewers")) memberships.push({ sql, params });
        return [];
      },
      createViewerSession: async () => "session-token",
      viewerCookieSet: (token) => `yr_viewer=${token}`,
    });

    expect(response.status).toBe(302);
    expect(queries.some((sql) => sql.includes("FROM sites"))).toBe(false);
    expect(memberships).toHaveLength(0);
  });

  test("platform paths do not create a viewer site membership", async () => {
    const memberships = [];
    await handleKickViewerAuthCallback(request("/auth/kick/callback?code=code&state=state"), {}, {
      stateData: { flow: "viewer", codeVerifier: "verifier", origin: "https://yourrank.site", returnTo: "/dashboard" },
      exchangeKickViewerCode: async () => ({ access_token: "access" }),
      fetchKickCurrentUser: async () => ({ user_id: 42, name: "viewer" }),
      encryptKickToken: async (value) => `enc:${value}`,
      one: async () => null,
      exec: async (sql) => {
        if (sql.includes("INSERT INTO viewers")) return [{ id: "viewer-1" }];
        if (sql.includes("INSERT INTO site_viewers")) memberships.push(sql);
        return [];
      },
      createViewerSession: async () => "session-token",
      viewerCookieSet: (token) => `yr_viewer=${token}`,
    });

    expect(memberships).toHaveLength(0);
  });

  test("generic custom-domain Kick sign-in does not join the resolved site", async () => {
    const memberships = [];
    await handleKickViewerAuthCallback(request("/auth/kick/callback?code=code&state=state"), {}, {
      stateData: { flow: "viewer", codeVerifier: "verifier", origin: "https://streamer.example", returnTo: "/me" },
      exchangeKickViewerCode: async () => ({ access_token: "access" }),
      fetchKickCurrentUser: async () => ({ user_id: 42, name: "viewer" }),
      encryptKickToken: async (value) => `enc:${value}`,
      one: async (sql) => sql.includes("FROM sites") ? { id: "site-custom" } : null,
      exec: async (sql, params) => {
        if (sql.includes("INSERT INTO viewers")) return [{ id: "viewer-1" }];
        if (sql.includes("INSERT INTO site_viewers")) memberships.push(params);
        return [];
      },
      resolveCustomDomain: async () => "custom-slug",
      storeOAuthState: async () => {},
    });

    expect(memberships).toEqual([]);
  });

  test("generic Discord sign-in authenticates only the Viewer Account", async () => {
    const memberships = [];
    const response = await handleDiscordViewerAuthCallback(
      request("/api/viewer/auth/discord/callback?code=code&state=state"),
      {},
      {
        consumeOAuthState: async () => ({
          origin: "https://yourrank.site",
          returnTo: "/discord-site/me",
          redirectUri: "https://yourrank.site/api/viewer/auth/discord/callback",
        }),
        exchangeDiscordCode: async () => ({ access_token: "access" }),
        fetchDiscordCurrentUser: async () => ({ id: "discord-1", username: "viewer", global_name: "Viewer", avatar: null }),
        encryptDiscordToken: async (value) => `enc:${value}`,
        discordAvatarUrl: () => null,
        one: async (sql) => sql.includes("FROM sites") ? { id: "site-discord" } : null,
        exec: async (sql, params) => {
          if (sql.includes("INSERT INTO viewers")) return [{ id: "viewer-discord" }];
          if (sql.includes("INSERT INTO site_viewers")) memberships.push(params);
          return [];
        },
        createViewerSession: async () => "session-token",
        viewerCookieSet: (token) => `yr_viewer=${token}`,
      },
    );

    expect(response.status).toBe(302);
    expect(memberships).toEqual([]);
  });

  test("Discord consumes Join state even when the provider returns an error", async () => {
    let consumes = 0;
    const response = await handleDiscordViewerAuthCallback(
      request("/api/viewer/auth/discord/callback?error=access_denied&state=join-state"),
      {},
      {
        consumeOAuthState: async () => {
          consumes += 1;
          return consumes === 1
            ? { origin: "https://yourrank.site", intent: "join", joinSiteId: "site-beta", joinSiteSlug: "beta" }
            : null;
        },
      },
    );

    expect(response.headers.get("location")).toBe("/me?error=access_denied");
    expect(consumes).toBe(1);
  });

  test("valid explicit Kick and Discord Join state creates only the bound membership", async () => {
    const joined = [];
    const one = async (sql, params) => {
      if (sql.includes("SELECT s.id, s.slug")) return params[0] === "site-beta" && params[1] === "beta" ? { id: "site-beta", slug: "beta" } : null;
      if (sql.includes("WITH inserted AS")) {
        joined.push({ sql, params });
        return { id: "membership-beta", balance: 0, created: true };
      }
      return null;
    };
    const exec = async (sql) => sql.includes("INSERT INTO viewers") ? [{ id: "viewer-joined" }] : [];
    const kick = await handleKickViewerAuthCallback(request("/auth/kick/callback?code=code&state=state"), {}, {
      stateData: {
        flow: "viewer", codeVerifier: "verifier", origin: "https://yourrank.site", returnTo: "/beta/me",
        intent: "join", joinSiteId: "site-beta", joinSiteSlug: "beta",
      },
      exchangeKickViewerCode: async () => ({ access_token: "access" }),
      fetchKickCurrentUser: async () => ({ user_id: 42, name: "viewer" }),
      encryptKickToken: async (value) => `enc:${value}`,
      one, exec,
      createViewerSession: async () => "session-token",
      viewerCookieSet: (token) => `yr_viewer=${token}`,
    });
    const discord = await handleDiscordViewerAuthCallback(request("/api/viewer/auth/discord/callback?code=code&state=state"), {}, {
      consumeOAuthState: async () => ({
        flow: "viewer", origin: "https://yourrank.site", returnTo: "/beta/me",
        redirectUri: "https://yourrank.site/api/viewer/auth/discord/callback",
        intent: "join", joinSiteId: "site-beta", joinSiteSlug: "beta",
      }),
      exchangeDiscordCode: async () => ({ access_token: "access" }),
      fetchDiscordCurrentUser: async () => ({ id: "discord-1", username: "viewer", global_name: "Viewer", avatar: null }),
      encryptDiscordToken: async (value) => `enc:${value}`,
      discordAvatarUrl: () => null,
      one, exec,
      createViewerSession: async () => "session-token",
      viewerCookieSet: (token) => `yr_viewer=${token}`,
    });

    expect(kick.status).toBe(302);
    expect(discord.status).toBe(302);
    expect(joined).toHaveLength(2);
    expect(joined.map(({ params }) => params)).toEqual([
      ["site-beta", "viewer-joined"],
      ["site-beta", "viewer-joined"],
    ]);
    expect(joined.every(({ sql }) => !sql.includes("last_active_at") && !sql.includes("last_seen_at"))).toBe(true);
  });

  test("expired or substituted explicit Join state cannot create Membership", async () => {
    const joined = [];
    const response = await handleKickViewerAuthCallback(request("/auth/kick/callback?code=code&state=state"), {}, {
      stateData: {
        flow: "viewer", codeVerifier: "verifier", origin: "https://yourrank.site", returnTo: "/beta/me",
        intent: "join", joinSiteId: "site-alpha", joinSiteSlug: "beta",
      },
      exchangeKickViewerCode: async () => ({ access_token: "access" }),
      fetchKickCurrentUser: async () => ({ user_id: 42, name: "viewer" }),
      encryptKickToken: async (value) => `enc:${value}`,
      one: async (sql) => {
        if (sql.includes("SELECT s.id, s.slug")) return null;
        return null;
      },
      exec: async (sql) => {
        if (sql.includes("INSERT INTO viewers")) return [{ id: "viewer-joined" }];
        if (sql.includes("site_viewers")) joined.push(sql);
        return [];
      },
    });
    expect(response.headers.get("location")).toContain("error=join_failed");
    expect(joined).toHaveLength(0);
  });

  test("viewer callback creates a short-lived custom-domain handoff", async () => {
    let handoffArgs;
    const response = await handleKickViewerAuthCallback(request("/auth/kick/callback?code=code&state=state"), {}, {
      stateData: { flow: "viewer", codeVerifier: "verifier", origin: "https://streamer.example", returnTo: "/me" },
      exchangeKickViewerCode: async () => ({ access_token: "access" }),
      fetchKickCurrentUser: async () => ({ user_id: 42, name: "viewer" }),
      encryptKickToken: async (value) => `enc:${value}`,
      one: async () => null,
      exec: async (sql) => sql.includes("INSERT INTO viewers") ? [{ id: "viewer-1" }] : [],
      resolveCustomDomain: async () => "streamer",
      storeOAuthState: async (...args) => { handoffArgs = args; },
    });

    expect(response.headers.get("location")).toMatch(/^https:\/\/streamer\.example\/api\/viewer\/auth\/kick\/handoff\?handoff=/);
    expect(handoffArgs[0]).toBe("kick_viewer_handoff");
    expect(handoffArgs[2]).toMatchObject({ viewerId: "viewer-1", origin: "https://streamer.example" });
    expect(handoffArgs[3]).toMatchObject({ ttlSeconds: 90 });
  });

  test("custom-domain handoffs only retain served site destinations", async () => {
    let handoffArgs;
    const response = await handleKickViewerAuthCallback(
      request("/auth/kick/callback?code=code&state=state"),
      {},
      {
        stateData: {
          flow: "viewer",
          codeVerifier: "verifier",
          origin: "https://streamer.example",
          returnTo: "/dashboard",
        },
        exchangeKickViewerCode: async () => ({ access_token: "access" }),
        fetchKickCurrentUser: async () => ({ user_id: 42, name: "viewer" }),
        encryptKickToken: async (value) => `enc:${value}`,
        one: async () => null,
        exec: async (sql) => sql.includes("INSERT INTO viewers") ? [{ id: "viewer-1" }] : [],
        resolveCustomDomain: async () => "streamer",
        storeOAuthState: async (...args) => { handoffArgs = args; },
      },
    );

    expect(response.status).toBe(302);
    expect(handoffArgs[2]).toMatchObject({
      viewerId: "viewer-1",
      returnTo: "https://yourrank.site/me",
      origin: "https://streamer.example",
    });
  });

  test("viewer handoffs are single-use and host-bound", async () => {
    const rejected = await handleKickViewerAuthHandoff(new Request("https://other.example/api/viewer/auth/kick/handoff?handoff=x"), {}, {
      consumeOAuthState: async () => {
        return { viewerId: "viewer-1", origin: "https://streamer.example", returnTo: "/me" };
      },
      createViewerSession: async () => "session-token",
      viewerCookieSet: (token) => `yr_viewer=${token}`,
    });
    let consumes = 0;
    const deps = {
      consumeOAuthState: async () => {
        consumes += 1;
        return consumes === 1 ? { viewerId: "viewer-1", origin: "https://streamer.example", returnTo: "/me" } : null;
      },
      createViewerSession: async () => "session-token",
      viewerCookieSet: (token) => `yr_viewer=${token}`,
      resolveCustomDomain: async () => "streamer",
    };
    const accepted = await handleKickViewerAuthHandoff(new Request("https://streamer.example/api/viewer/auth/kick/handoff?handoff=x"), {}, deps);
    const replayed = await handleKickViewerAuthHandoff(new Request("https://streamer.example/api/viewer/auth/kick/handoff?handoff=x"), {}, deps);

    expect(rejected.headers.get("location")).toContain("error=oauth_state_expired");
    expect(accepted.headers.get("location")).toBe("/me");
    expect(accepted.headers.get("set-cookie")).toBe("yr_viewer=session-token");
    expect(replayed.headers.get("location")).toContain("error=oauth_state_expired");
  });

  test("expired viewer handoffs are rejected without creating a session", async () => {
    let created = false;
    const response = await handleKickViewerAuthHandoff(new Request("https://streamer.example/api/viewer/auth/kick/handoff?handoff=expired"), {}, {
      consumeOAuthState: async () => null,
      createViewerSession: async () => {
        created = true;
        return "session-token";
      },
      resolveCustomDomain: async () => "streamer",
    });

    expect(response.headers.get("location")).toContain("error=oauth_state_expired");
    expect(created).toBe(false);
  });

  test("resolves the active owned site when the start URL omits siteId", async () => {
    const calls = [];
    const response = await handleKickAuthStart(request("/auth/kick"), {}, {
      currentUser: async () => ({ ...user, active_site_id: "site-1" }),
      rateLimit: noRateLimit,
      one: async (sql, params) => {
        calls.push({ sql, params });
        return site;
      },
      requireSiteCapability: ownerCapability,
      storeOAuthState: async (...args) => calls.push({ state: args }),
      generatePKCE: pkce,
      buildKickAuthorizeURL: (_env, state) => `https://kick.test/authorize?state=${state}`,
    });

    expect(response.status).toBe(302);
    expect(calls[0].sql).toContain("active_site_id");
    expect(calls.find((call) => call.state)?.state[2]).toMatchObject({ siteId: "site-1" });
  });

  test("rejects a Moderator from managing provider credentials", async () => {
    const response = await handleKickAuthStart(request("/auth/kick?siteId=site-1"), {}, {
      currentUser: async () => user,
      rateLimit: noRateLimit,
      one: async () => site,
      requireSiteCapability: async (_user, _site, capability) => {
        expect(capability).toBe("canRoleManageConnections");
        return { role: "moderator", res: new Response("forbidden", { status: 403 }) };
      },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/dashboard/site/connections?error=site_not_authorized&siteId=site-1");
  });

  test("streamer callback rejects a state created for another user", async () => {
    const response = await handleKickAuthCallback(request("/auth/kick/callback?code=code&state=state"), {}, {
      currentUser: async () => user,
      consumeOAuthState: async () => ({ userId: "another-user", siteId: "site-1", codeVerifier: "verifier" }),
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/dashboard/site/connections?error=oauth_user_mismatch&siteId=site-1");
  });

  test("streamer callback redirects with a stable error code", async () => {
    const response = await handleKickAuthCallback(request("/auth/kick/callback?code=code&state=state"), {}, {
      currentUser: async () => user,
      consumeOAuthState: async () => ({ userId: user.id, siteId: site.id, codeVerifier: "verifier" }),
      one: async () => site,
      requireSiteCapability: ownerCapability,
      exchangeKickCode: async () => {
        throw new Error("Kick token endpoint returned 401: response body");
      },
    });

    expect(response.headers.get("location")).toBe("/dashboard/site/connections?error=kick_auth_failed&siteId=site-1");
  });

  test("viewer callback redirects with a stable error code", async () => {
    const response = await handleKickViewerAuthCallback(request("/api/viewer/auth/kick/callback?code=code&state=state"), {}, {
      consumeOAuthState: async () => ({ codeVerifier: "verifier", redirectUri: "https://test.local/callback" }),
      exchangeKickViewerCode: async () => {
        throw new Error("Kick token endpoint returned 401: response body");
      },
    });

    expect(response.headers.get("location")).toBe("/me?error=kick_auth_failed");
  });

  test("disconnects the explicitly selected site and clears identity plus token fields", async () => {
    const queries = [];
    const response = await handleKickAuthDisconnect(request("/api/kick/disconnect?siteId=site-2"), {}, {
      requireUser: async () => ({ user, res: null }),
      one: async (sql, params) => {
        queries.push({ sql, params });
        return { ...site, id: "site-2" };
      },
      requireSiteCapability: ownerCapability,
      readJson: async () => ({}),
      withTransaction: async (fn) => fn({
        unsafe: async (sql, params) => queries.push({ sql, params }),
        one: async (sql, params) => {
          queries.push({ sql, params });
          return null;
        },
        query: async () => [],
      }),
    });

    expect(response.status).toBe(200);
    expect(queries[0].params).toEqual(["site-2"]);
    expect(queries[1].sql).toContain("FOR UPDATE");
    expect(queries[2].sql).toContain("kick_channel_external_id");
    expect(queries[3].sql).toContain("kick_user_id = null");
  });

  test("preserves the account link when another owned site remains connected", async () => {
    const queries = [];
    const response = await handleKickAuthDisconnect(request("/api/kick/disconnect?siteId=site-2"), {}, {
      requireUser: async () => ({ user, res: null }),
      one: async (sql, params) => {
        queries.push({ sql, params });
        return { ...site, id: "site-2" };
      },
      requireSiteCapability: ownerCapability,
      readJson: async () => ({}),
      withTransaction: async (fn) => fn({
        unsafe: async (sql, params) => queries.push({ sql, params }),
        one: async (sql, params) => {
          queries.push({ sql, params });
          return { id: "other-site" };
        },
        query: async () => [],
      }),
    });

    expect(response.status).toBe(200);
    expect(queries.some((query) => query.sql.includes("kick_user_id = null"))).toBe(false);
    expect(queries.at(-1).sql).toContain("kick_channel_external_id");
  });
});
