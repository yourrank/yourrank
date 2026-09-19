// Cross-platform Viewer Account linking through the real OAuth handlers and a
// real Postgres database: normal sign-in creates/resolves a viewer, explicit
// link mode attaches a second provider to the signed-in viewer and never
// creates or merges accounts. Provider token exchange is stubbed.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { createViewerSession } from "@yourrank/shared/viewer-session";
import {
  handleKickViewerAuthStart,
  handleKickViewerAuthCallback,
  handleKickViewerAuthHandoff,
  handleDiscordViewerAuthStart,
  handleDiscordViewerAuthCallback,
  requireViewer,
} from "../handlers/viewer-auth.js";
import { handleViewerMe } from "../handlers/viewer-dashboard.js";

const databaseUrl = process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (databaseUrl ? it : it.skip)(name, fn, 60000);
const run = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const owner = crypto.randomUUID();
const siteId = crypto.randomUUID();
const bindingId = crypto.randomUUID();
const slug = `link-${run}`;
const hostname = `${slug}.example`;
const local = { authority: "site", siteId, hostname, domainBindingId: bindingId };
const oauthEnv = { KICK_CLIENT_ID: "kick-test", KICK_CLIENT_SECRET: "kick-test", DISCORD_CLIENT_ID: "discord-test", DISCORD_CLIENT_SECRET: "discord-test" };
const states = [];
const createdViewers = new Set();
let sql;
let oldUrl;

const ext = (provider, name) => `${provider}-${run}-${name}`;

// Provider identity the stubbed provider returns for the next callback.
function providerDeps({ kick = "a", discord = "a" } = {}) {
  return {
    rateLimit: async () => ({ ok: true }), clientIp: () => "127.0.0.1",
    buildKickViewerAuthorizeURL: (_env, state) => `https://provider.test/auth?state=${state}`,
    buildDiscordAuthorizeURL: (_env, state) => `https://provider.test/auth?state=${state}`,
    generatePKCE: async () => ({ codeVerifier: "verifier", codeChallenge: "challenge" }),
    exchangeKickViewerCode: async () => ({ access_token: "test-access" }),
    fetchKickCurrentUser: async () => ({ user_id: ext("kick", kick), name: `kick_${kick}` }),
    encryptKickToken: async () => "encrypted-test-token",
    exchangeDiscordCode: async () => ({ access_token: "test-access" }),
    fetchDiscordCurrentUser: async () => ({ id: ext("discord", discord), username: `discord_${discord}` }),
    encryptDiscordToken: async () => "encrypted-test-token", discordAvatarUrl: () => null,
  };
}

const startPath = (provider, query) => `/api/viewer/auth/${provider}?${new URLSearchParams({ returnTo: "/me", ...query })}`;
const callbackPath = (provider) => (provider === "kick" ? "/auth/kick/callback" : "/api/viewer/auth/discord/callback");
const cookieHeader = (...parts) => parts.filter(Boolean).join("; ");
const viewerCookie = (token) => (token ? `yr_viewer=${token}` : "");
const sessionCookieFrom = (response) => {
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith("yr_viewer="));
  return cookie ? decodeURIComponent(cookie.split(";")[0].slice(10)) : null;
};

async function start(provider, { host = "yourrank.site", cookie = "", query = {}, deps = providerDeps() } = {}) {
  const handler = provider === "kick" ? handleKickViewerAuthStart : handleDiscordViewerAuthStart;
  const response = await handler(new Request(`https://${host}${startPath(provider, query)}`, { headers: { cookie } }), oauthEnv, deps);
  const location = response.headers.get("location");
  if (!location.startsWith("https://provider.test/")) return { response, state: null, nonce: "" };
  const state = new URL(location).searchParams.get("state");
  states.push(state);
  const nonce = response.headers.getSetCookie().find((c) => !c.startsWith("yr_viewer=")).split(";")[0];
  return { response, state, nonce };
}

async function callback(provider, state, cookie, { host = "yourrank.site", deps = providerDeps() } = {}) {
  const handler = provider === "kick" ? handleKickViewerAuthCallback : handleDiscordViewerAuthCallback;
  const response = await handler(new Request(`https://${host}${callbackPath(provider)}?code=code&state=${state}`, { headers: { cookie } }), oauthEnv, deps);
  const token = sessionCookieFrom(response);
  return { response, token, location: response.headers.get("location") };
}

async function signIn(provider, deps = providerDeps()) {
  const flow = await start(provider, { deps });
  const result = await callback(provider, flow.state, flow.nonce, { deps });
  expect(result.location).not.toContain("error=");
  expect(result.token).toBeTruthy();
  const { viewer } = await requireViewer(new Request("https://yourrank.site/me", { headers: { cookie: viewerCookie(result.token) } }), {});
  createdViewers.add(viewer.id);
  return { viewerId: viewer.id, token: result.token };
}

const identities = (viewerId) => sql`
  SELECT provider, external_user_id, status FROM viewer_identities WHERE viewer_id=${viewerId} ORDER BY provider`;
const ownerOf = async (provider, externalUserId) => {
  const [row] = await sql`SELECT viewer_id FROM viewer_identities WHERE provider=${provider} AND external_user_id=${externalUserId} AND status='active'`;
  return row?.viewer_id ?? null;
};
const viewerCount = () => sql`SELECT count(*)::int AS n FROM viewers`.then(([row]) => row.n);

beforeAll(async () => {
  if (!databaseUrl) return;
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "postgres"].includes(url.hostname) || !/test|e2e/.test(url.pathname)) throw new Error("Disposable local database required");
  sql = postgres(databaseUrl, { max: 3, prepare: false, onnotice: () => {} });
  await sql`INSERT INTO users (id, email, status, email_verified) VALUES (${owner}, ${`${slug}@yourrank.test`}, 'active', true)`;
  await sql`INSERT INTO sites (id, user_id, slug, name, published, is_draft, custom_domain, custom_hostname_id, domain_status, domain_auth_binding_id, domain_auth_verified_at)
    VALUES (${siteId}, ${owner}, ${slug}, 'Link test site', true, false, ${hostname}, 'provider-record', 'active', ${bindingId}, now())`;
  oldUrl = process.env.DATABASE_URL;
  url.username = "yourrank_worker";
  process.env.DATABASE_URL = url.toString();
});
afterAll(async () => {
  if (!sql) return;
  await sql`DELETE FROM oauth_states WHERE state IN ${sql(states.length ? states : ["not-a-state"])}`;
  await sql`DELETE FROM viewers WHERE id IN ${sql(createdViewers.size ? [...createdViewers] : [crypto.randomUUID()])}`;
  await sql`DELETE FROM viewers WHERE id IN (SELECT viewer_id FROM viewer_identities WHERE external_user_id LIKE ${`%-${run}-%`})`;
  await sql`DELETE FROM sites WHERE id=${siteId}`;
  await sql`DELETE FROM users WHERE id=${owner}`;
  await sql.end({ timeout: 0 });
  if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
});

describe("cross-platform Viewer Account linking (real database)", () => {
  integrationIt("logged-out Discord sign-in creates a Viewer Account with a generic identity and legacy mirror", async () => {
    const deps = providerDeps({ discord: "solo" });
    const { viewerId } = await signIn("discord", deps);
    expect(await identities(viewerId)).toEqual([{ provider: "discord", external_user_id: ext("discord", "solo"), status: "active" }]);
    const [viewer] = await sql`SELECT discord_user_id, discord_username FROM viewers WHERE id=${viewerId}`;
    expect(viewer).toEqual({ discord_user_id: ext("discord", "solo"), discord_username: "discord_solo" });
    // Signing in again resolves the same viewer instead of creating another.
    const again = await signIn("discord", deps);
    expect(again.viewerId).toBe(viewerId);
  });

  integrationIt("Kick login → Viewer A → Connect Discord → Viewer A owns Kick + Discord, no Viewer B", async () => {
    const deps = providerDeps({ kick: "a", discord: "a" });
    const a = await signIn("kick", deps);
    const before = await viewerCount();

    const flow = await start("discord", { cookie: viewerCookie(a.token), query: { intent: "link" }, deps });
    expect(flow.state).toBeTruthy();
    const [stored] = await sql`SELECT payload FROM oauth_states WHERE state=${flow.state}`;
    expect(stored.payload).toMatchObject({ intent: "link", linkViewerId: a.viewerId, linkAuthority: { authority: "global" } });

    const result = await callback("discord", flow.state, cookieHeader(viewerCookie(a.token), flow.nonce), { deps });
    expect(result.location).toBe("https://yourrank.site/me?connected=discord");
    expect(result.token).toBeNull(); // existing session is kept; no replacement session issued

    expect(await viewerCount()).toBe(before);
    expect(await identities(a.viewerId)).toEqual([
      { provider: "discord", external_user_id: ext("discord", "a"), status: "active" },
      { provider: "kick", external_user_id: ext("kick", "a"), status: "active" },
    ]);
    const [mirror] = await sql`SELECT kick_user_id, discord_user_id FROM viewers WHERE id=${a.viewerId}`;
    expect(mirror).toEqual({ kick_user_id: ext("kick", "a"), discord_user_id: ext("discord", "a") });

    // Connected Accounts surface reflects both providers as connected.
    const me = await handleViewerMe(new Request("https://yourrank.site/api/viewer/me", { headers: { cookie: viewerCookie(a.token) } }), oauthEnv, { rateLimit: async () => ({ ok: true }) });
    const body = await me.json();
    expect(body.connectedAccounts.map(({ provider, state }) => [provider, state])).toEqual([["kick", "connected"], ["discord", "connected"]]);

    // Logged-out Discord sign-in with that identity now resolves Viewer A.
    const resolved = await signIn("discord", deps);
    expect(resolved.viewerId).toBe(a.viewerId);
  });

  integrationIt("an external identity owned by Viewer B cannot be linked to Viewer A; both accounts are preserved", async () => {
    const a = await signIn("kick", providerDeps({ kick: "conflict-a" }));
    const b = await signIn("discord", providerDeps({ discord: "conflict-b" }));
    const before = await viewerCount();
    const linkDeps = providerDeps({ kick: "conflict-a", discord: "conflict-b" });

    const flow = await start("discord", { cookie: viewerCookie(a.token), query: { intent: "link" }, deps: linkDeps });
    const result = await callback("discord", flow.state, cookieHeader(viewerCookie(a.token), flow.nonce), { deps: linkDeps });
    expect(result.location).toContain("error=link_identity_in_use");
    expect(result.token).toBeNull();

    expect(await viewerCount()).toBe(before);
    expect(await ownerOf("discord", ext("discord", "conflict-b"))).toBe(b.viewerId);
    expect(await identities(a.viewerId)).toEqual([{ provider: "kick", external_user_id: ext("kick", "conflict-a"), status: "active" }]);
    expect(await identities(b.viewerId)).toEqual([{ provider: "discord", external_user_id: ext("discord", "conflict-b"), status: "active" }]);
  });

  integrationIt("a viewer that already has a different identity for the provider cannot link a second one", async () => {
    const a = await signIn("kick", providerDeps({ kick: "dup-1" }));
    const deps = providerDeps({ kick: "dup-2" });
    const flow = await start("kick", { cookie: viewerCookie(a.token), query: { intent: "link" }, deps });
    const result = await callback("kick", flow.state, cookieHeader(viewerCookie(a.token), flow.nonce), { deps });
    expect(result.location).toContain("error=link_provider_already_connected");
    expect(await identities(a.viewerId)).toEqual([{ provider: "kick", external_user_id: ext("kick", "dup-1"), status: "active" }]);
    expect(await ownerOf("kick", ext("kick", "dup-2"))).toBeNull();
  });

  integrationIt("link mode requires an authenticated viewer; normal sign-in remains distinct from link mode", async () => {
    const deps = providerDeps({ kick: "distinct", discord: "distinct" });
    const anonymous = await start("discord", { query: { intent: "link" }, deps });
    expect(anonymous.state).toBeNull();
    expect(anonymous.response.headers.get("location")).toContain("error=link_requires_signin");

    // Signed in as A, a *normal* Discord sign-in (no link intent) does not attach to A.
    const a = await signIn("kick", deps);
    const flow = await start("discord", { cookie: viewerCookie(a.token), deps });
    const [stored] = await sql`SELECT payload FROM oauth_states WHERE state=${flow.state}`;
    expect(stored.payload.intent).toBeUndefined();
    expect(stored.payload.linkViewerId).toBeUndefined();
    const result = await callback("discord", flow.state, cookieHeader(viewerCookie(a.token), flow.nonce), { deps });
    expect(result.token).toBeTruthy();
    const other = await ownerOf("discord", ext("discord", "distinct"));
    createdViewers.add(other);
    expect(other).not.toBe(a.viewerId);
    expect(await identities(a.viewerId)).toEqual([{ provider: "kick", external_user_id: ext("kick", "distinct"), status: "active" }]);
  });

  integrationIt("stale, forged, wrong-session and wrong-viewer link states fail without touching accounts", async () => {
    const deps = providerDeps({ kick: "guard-a", discord: "guard" });
    const a = await signIn("kick", deps);
    const c = await signIn("kick", providerDeps({ kick: "guard-c" }));
    const before = await viewerCount();
    const discordUnowned = async () => expect(await ownerOf("discord", ext("discord", "guard"))).toBeNull();

    // Wrong session: link state started by A, callback arrives with no viewer session.
    let flow = await start("discord", { cookie: viewerCookie(a.token), query: { intent: "link" }, deps });
    let result = await callback("discord", flow.state, flow.nonce, { deps });
    expect(result.location).toContain("error=link_session_mismatch");
    await discordUnowned();

    // Wrong viewer: link state started by A, callback arrives in C's session (with A's nonce).
    flow = await start("discord", { cookie: viewerCookie(a.token), query: { intent: "link" }, deps });
    result = await callback("discord", flow.state, cookieHeader(viewerCookie(c.token), flow.nonce), { deps });
    expect(result.location).toContain("error=link_session_mismatch");
    await discordUnowned();
    expect(await identities(c.viewerId)).toEqual([{ provider: "kick", external_user_id: ext("kick", "guard-c"), status: "active" }]);

    // Stale: a consumed state cannot be replayed.
    flow = await start("discord", { cookie: viewerCookie(a.token), query: { intent: "link" }, deps });
    await sql`UPDATE oauth_states SET expires_at = now() - interval '1 minute' WHERE state=${flow.state}`;
    result = await callback("discord", flow.state, cookieHeader(viewerCookie(a.token), flow.nonce), { deps });
    expect(result.location).toContain("error=oauth_state_expired");
    await discordUnowned();

    // Forged: an unknown state value, and a stored state whose link fields were tampered with.
    result = await callback("discord", "forged-state-value", cookieHeader(viewerCookie(a.token)), { deps });
    expect(result.location).toContain("error=oauth_state_expired");
    flow = await start("discord", { cookie: viewerCookie(a.token), query: { intent: "link" }, deps });
    await sql`UPDATE oauth_states SET payload = payload || ${sql.json({ linkViewerId: c.viewerId })} WHERE state=${flow.state}`;
    result = await callback("discord", flow.state, cookieHeader(viewerCookie(a.token), flow.nonce), { deps });
    expect(result.location).toContain("error=link_session_mismatch");
    await discordUnowned();
    flow = await start("discord", { cookie: viewerCookie(a.token), query: { intent: "link" }, deps });
    await sql`UPDATE oauth_states SET payload = payload || ${sql.json({ linkAuthority: local })} WHERE state=${flow.state}`;
    result = await callback("discord", flow.state, cookieHeader(viewerCookie(a.token), flow.nonce), { deps });
    expect(result.location).toContain("error=link_session_mismatch");
    await discordUnowned();

    expect(await viewerCount()).toBe(before);
    expect(await identities(a.viewerId)).toEqual([{ provider: "kick", external_user_id: ext("kick", "guard-a"), status: "active" }]);
  });

  integrationIt("custom-domain (site authority) link attaches to the local session's viewer via the Kick handoff", async () => {
    const deps = providerDeps({ kick: "custom", discord: "custom" });
    const a = await signIn("discord", deps);
    const localToken = await createViewerSession({}, a.viewerId, local);
    const localCookie = viewerCookie(localToken);

    // A global session cannot start a link on the custom domain.
    const refused = await start("kick", { host: hostname, cookie: viewerCookie(a.token), query: { intent: "link" }, deps });
    expect(refused.response.headers.get("location")).toContain("error=link_requires_signin");

    const flow = await start("kick", { host: hostname, cookie: localCookie, query: { intent: "link" }, deps });
    const [stored] = await sql`SELECT payload FROM oauth_states WHERE state=${flow.state}`;
    expect(stored.payload).toMatchObject({ intent: "link", linkViewerId: a.viewerId, linkAuthority: local });

    // Kick returns to the apex, which relays to the custom domain without side effects.
    const relayed = await handleKickViewerAuthCallback(new Request(`https://yourrank.site${callbackPath("kick")}?code=code&state=${flow.state}`), oauthEnv, {
      ...deps, exchangeKickViewerCode: async () => { throw new Error("relay must not exchange"); },
    });
    const target = relayed.headers.get("location");
    expect(target).toStartWith(`https://${hostname}/api/viewer/auth/kick/handoff?`);
    expect(await ownerOf("kick", ext("kick", "custom"))).toBeNull();

    // Handoff without the local viewer session is a session mismatch.
    const noSession = await handleKickViewerAuthHandoff(new Request(target, { headers: { cookie: flow.nonce } }), oauthEnv, deps);
    expect(noSession.headers.get("location")).toContain("error=link_session_mismatch");
    expect(await ownerOf("kick", ext("kick", "custom"))).toBeNull();

    const flow2 = await start("kick", { host: hostname, cookie: localCookie, query: { intent: "link" }, deps });
    const relayed2 = await handleKickViewerAuthCallback(new Request(`https://yourrank.site${callbackPath("kick")}?code=code&state=${flow2.state}`), oauthEnv, deps);
    const accepted = await handleKickViewerAuthHandoff(new Request(relayed2.headers.get("location"), { headers: { cookie: cookieHeader(localCookie, flow2.nonce) } }), oauthEnv, deps);
    expect(accepted.headers.get("location")).toBe(`https://${hostname}/me?connected=kick`);
    expect(sessionCookieFrom(accepted)).toBeNull();
    expect(await ownerOf("kick", ext("kick", "custom"))).toBe(a.viewerId);
    expect(await identities(a.viewerId)).toHaveLength(2);
  });
});
