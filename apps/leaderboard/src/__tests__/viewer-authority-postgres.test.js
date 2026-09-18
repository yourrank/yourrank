import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { createViewerSession, destroyViewerSession, resolveViewerSession } from "@yourrank/shared/viewer-session";
import { hashToken } from "@yourrank/shared/crypto";
import { requireViewer, handleKickViewerAuthStart, handleKickViewerAuthCallback, handleKickViewerAuthHandoff, handleDiscordViewerAuthStart, handleDiscordViewerAuthCallback } from "../handlers/viewer-auth.js";
import { resolveVerifiedCustomDomain } from "../middleware/custom-domain.js";

const databaseUrl = process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (databaseUrl ? it : it.skip)(name, fn, 60000);
const owner = crypto.randomUUID();
const siteId = crypto.randomUUID();
const viewerId = crypto.randomUUID();
const bindingId = crypto.randomUUID();
const slug = `audit-${crypto.randomUUID().replace(/-/g, "")}`;
const hostname = `${slug}.example`;
const local = { authority: "site", siteId, hostname, domainBindingId: bindingId };
const request = (token, host = "yourrank.site", path = "/me") => new Request(`https://${host}${path}`, { headers: { cookie: `yr_viewer=${token}` } });
let sql;
let oldUrl;
let globalToken;
let localToken;
const states = [];
// Readiness gate needs real-looking credentials; tokens are never exchanged (deps below stub the provider).
const oauthEnv = { KICK_CLIENT_ID: "kick-test", KICK_CLIENT_SECRET: "kick-test", DISCORD_CLIENT_ID: "discord-test", DISCORD_CLIENT_SECRET: "discord-test" };
const providerDeps = {
  rateLimit: async () => ({ ok: true }), clientIp: () => "127.0.0.1",
  buildKickViewerAuthorizeURL: (_env, state) => `https://provider.test/auth?state=${state}`,
  buildDiscordAuthorizeURL: (_env, state) => `https://provider.test/auth?state=${state}`,
  generatePKCE: async () => ({ codeVerifier: "verifier", codeChallenge: "challenge" }),
  exchangeKickViewerCode: async () => ({ access_token: "test-access" }),
  fetchKickCurrentUser: async () => ({ user_id: slug, name: slug }),
  encryptKickToken: async () => "encrypted-test-token",
  exchangeDiscordCode: async () => ({ access_token: "test-access" }),
  fetchDiscordCurrentUser: async () => ({ id: slug, username: slug }),
  encryptDiscordToken: async () => "encrypted-test-token", discordAvatarUrl: () => null,
};
async function start(provider, host = "yourrank.site") {
  const response = await (provider === "kick" ? handleKickViewerAuthStart : handleDiscordViewerAuthStart)(
    new Request(`https://${host}/api/viewer/auth/${provider}?returnTo=/me`), oauthEnv, providerDeps);
  const state = new URL(response.headers.get("location")).searchParams.get("state");
  expect(state).toBeTruthy();
  states.push(state);
  return { state, cookie: response.headers.getSetCookie()[0].split(";")[0] };
}
const callback = (provider, state, cookie = "", host = "yourrank.site") => new Request(
  `https://${host}${provider === "kick" ? "/auth/kick/callback" : "/api/viewer/auth/discord/callback"}?code=code&state=${state}`,
  { headers: { cookie } });

beforeAll(async () => {
  if (!databaseUrl) return;
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "postgres"].includes(url.hostname) || !/test|e2e/.test(url.pathname)) throw new Error("Disposable local database required");
  sql = postgres(databaseUrl, { max: 3, prepare: false, onnotice: () => {} });
  await sql`INSERT INTO users (id, email, status, email_verified) VALUES (${owner}, ${`${slug}@yourrank.test`}, 'active', true)`;
  await sql`INSERT INTO sites (id, user_id, slug, name, published, is_draft, custom_domain, custom_hostname_id, domain_status, domain_auth_binding_id, domain_auth_verified_at)
    VALUES (${siteId}, ${owner}, ${slug}, 'Audit session site', true, false, ${hostname}, 'provider-record', 'active', ${bindingId}, now())`;
  await sql`INSERT INTO viewers (id, kick_user_id, kick_username, kick_linked_at, discord_user_id)
    VALUES (${viewerId}, ${slug}, ${slug}, now(), ${slug})`;
  oldUrl = process.env.DATABASE_URL;
  url.username = "yourrank_worker";
  process.env.DATABASE_URL = url.toString();
  globalToken = await createViewerSession({}, viewerId, { authority: "global" });
  localToken = await createViewerSession({}, viewerId, local);
});
afterAll(async () => {
  if (!sql) return;
  await sql`DELETE FROM oauth_states WHERE state IN ${sql(states.length ? states : ["not-a-state"])} OR payload->>'origin'=${`https://${hostname}`}`;
  await sql`DELETE FROM sites WHERE id=${siteId}`;
  await sql`DELETE FROM viewers WHERE id=${viewerId}`;
  await sql`DELETE FROM users WHERE id=${owner}`;
  await sql.end({ timeout: 0 });
  if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
});

describe("C08-C10 real database and browser proof boundary", () => {
  integrationIt("accepts only the declared audience; local cookies cannot access global APIs even on their own host", async () => {
    expect((await requireViewer(request(globalToken), {})).viewer.id).toBe(viewerId);
    expect((await requireViewer(request(localToken), {})).res.status).toBe(401);
    const oldReaderRows = await sql`SELECT viewer_id FROM viewer_sessions WHERE token=${await hashToken(localToken)}`;
    expect(oldReaderRows).toHaveLength(0);
    expect((await requireViewer(request(localToken, hostname), {})).res.status).toBe(401);
    expect((await requireViewer(request(globalToken, hostname), {}, { siteId })).res.status).toBe(401);
    expect((await requireViewer(request(localToken, hostname), {}, { siteId })).viewer.id).toBe(viewerId);
    expect((await requireViewer(request(localToken, hostname), {}, { siteId: crypto.randomUUID() })).res.status).toBe(401);
    expect((await requireViewer(request(localToken, "another.example"), {}, { siteId })).res.status).toBe(401);
  });
  integrationIt("custom-domain logout revokes the domain-separated database session", async () => {
    const token = await createViewerSession({}, viewerId, local);
    expect((await resolveViewerSession(request(token, hostname), {}, { siteId })).viewerId).toBe(viewerId);
    await destroyViewerSession({}, token, hostname);
    expect((await resolveViewerSession(request(token, hostname), {}, { siteId })).viewerId).toBeNull();
  });
  integrationIt("rejects unclassified legacy tokens without upgrading or rotating them", async () => {
    const hash = await hashToken("legacy-test-token");
    await sql`INSERT INTO viewer_sessions (token, viewer_id, created_at, expires_at) VALUES (${hash}, ${viewerId}, now()-interval '2 days', now()+interval '1 day')`;
    expect((await resolveViewerSession(request("legacy-test-token"), {})).viewerId).toBeNull();
    const [row] = await sql`SELECT authority, token FROM viewer_sessions WHERE token=${hash}`;
    expect(row).toEqual({ authority: null, token: hash });
  });
  integrationIt("rotates local tokens without elevating authority and applies scope to previous-token grace", async () => {
    await sql`UPDATE viewer_sessions SET created_at=now()-interval '2 days' WHERE token=${await hashToken(`site:${hostname}:${localToken}`)}`;
    const result = await resolveViewerSession(request(localToken, hostname), {}, { siteId });
    expect(result.viewerId).toBe(viewerId);
    expect(result.cookie).toContain("yr_viewer=");
    expect(result.cookie).not.toContain("Domain=");
    expect(result.session.domainBindingId).toBe(bindingId);
    expect((await resolveViewerSession(request(localToken), {})).viewerId).toBeNull();
    expect((await resolveViewerSession(request(localToken, hostname), {}, { siteId })).viewerId).toBe(viewerId);
    await sql`UPDATE viewer_sessions SET rotated_at=now()-interval '3 minutes' WHERE previous_token=${await hashToken(`site:${hostname}:${localToken}`)}`;
    expect((await resolveViewerSession(request(localToken, hostname), {}, { siteId })).viewerId).toBeNull();
  });
  integrationIt("rechecks current domain evidence and denies revoked generations and pending domains", async () => {
    const token = await createViewerSession({}, viewerId, local);
    await sql`UPDATE sites SET domain_auth_binding_id=gen_random_uuid() WHERE id=${siteId}`;
    expect((await resolveViewerSession(request(token, hostname), {}, { siteId })).viewerId).toBeNull();
    await expect(createViewerSession({}, viewerId, local)).rejects.toThrow("authority changed");
    await sql`UPDATE sites SET domain_auth_binding_id=${bindingId}, domain_status='pending' WHERE id=${siteId}`;
    expect(await resolveVerifiedCustomDomain({}, hostname)).toBeUndefined();
    await sql`UPDATE sites SET domain_status='active' WHERE id=${siteId}`;
    expect((await resolveVerifiedCustomDomain({}, hostname)).site_id).toBe(siteId);
  });
  for (const provider of ["kick", "discord"]) {
    integrationIt(`${provider} checks the real nonce cookie before identity mutation and consumes a valid flow once`, async () => {
      const stolen = await start(provider);
      const handler = provider === "kick" ? handleKickViewerAuthCallback : handleDiscordViewerAuthCallback;
      let exchanged = false;
      const refused = await handler(callback(provider, stolen.state), oauthEnv, {
        ...providerDeps,
        [provider === "kick" ? "exchangeKickViewerCode" : "exchangeDiscordCode"]: async () => { exchanged = true; throw new Error("must not exchange"); },
      });
      expect(refused.headers.get("location")).toContain(`${provider}_oauth_browser_mismatch`);
      expect(exchanged).toBe(false);
      const valid = await start(provider);
      const accepted = await handler(callback(provider, valid.state, valid.cookie), oauthEnv, providerDeps);
      expect(accepted.headers.get("location")).not.toContain("error=");
      expect(accepted.headers.getSetCookie().some((c) => c.startsWith("yr_viewer="))).toBe(true);
      expect((await handler(callback(provider, valid.state, valid.cookie), oauthEnv, providerDeps)).headers.get("location")).toContain("oauth_state_expired");
    });
  }
  integrationIt("Kick custom-domain relay has no authenticated side effects until original-host browser proof", async () => {
    const flow = await start("kick", hostname);
    const relayed = await handleKickViewerAuthCallback(callback("kick", flow.state), oauthEnv, {
      ...providerDeps, exchangeKickViewerCode: async () => { throw new Error("relay must not exchange"); },
    });
    const target = relayed.headers.get("location");
    expect(target).toStartWith(`https://${hostname}/api/viewer/auth/kick/handoff?`);
    expect(relayed.headers.get("set-cookie")).toBeNull();
    const accepted = await handleKickViewerAuthHandoff(new Request(target, { headers: { cookie: flow.cookie } }), oauthEnv, providerDeps);
    expect(accepted.headers.get("location")).toBe(`https://${hostname}/me`);
    const token = decodeURIComponent(accepted.headers.getSetCookie().find((c) => c.startsWith("yr_viewer=")).split(";")[0].slice(10));
    expect((await requireViewer(request(token), {})).res.status).toBe(401);
    expect((await requireViewer(request(token, hostname), {}, { siteId })).viewer.id).toBe(viewerId);
  });
  integrationIt("a transferred custom-domain handoff cannot authenticate without its original nonce", async () => {
    const flow = await start("kick", hostname);
    const relayed = await handleKickViewerAuthCallback(callback("kick", flow.state), oauthEnv, providerDeps);
    let exchanged = false;
    const refused = await handleKickViewerAuthHandoff(new Request(relayed.headers.get("location")), oauthEnv, {
      ...providerDeps, exchangeKickViewerCode: async () => { exchanged = true; throw new Error("must not exchange"); },
    });
    expect(refused.headers.get("location")).toContain("kick_oauth_browser_mismatch");
    expect(refused.headers.get("set-cookie")).toBeNull();
    expect(exchanged).toBe(false);
  });
  integrationIt("a domain reassignment during OAuth cannot redirect or upgrade the original local authority", async () => {
    const flow = await start("kick", hostname);
    await sql`UPDATE sites SET domain_auth_binding_id=gen_random_uuid() WHERE id=${siteId}`;
    const response = await handleKickViewerAuthCallback(callback("kick", flow.state), oauthEnv, providerDeps);
    expect(response.headers.get("location")).toContain("custom_domain_unverified");
    expect(response.headers.get("set-cookie")).toBeNull();
    await sql`UPDATE sites SET domain_auth_binding_id=${bindingId} WHERE id=${siteId}`;
  });
});
