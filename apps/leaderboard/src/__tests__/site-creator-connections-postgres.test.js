// Guarantees of 20261017000000_site_creator_connections.sql exercised through
// the shared helpers: one creator running two sites with two different Kick
// accounts keeps both sites verified and routable; reconnecting, refreshing,
// clearing or disconnecting one site never touches the other; a provider
// identity still has one active YourRank owner across both connection tables.
// Runs only against a disposable local database (AUDIT_TEST_DATABASE_URL).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import {
  clearChannelAuthorizationTokens, linkCreatorConnection, linkSiteCreatorConnection,
  linkSiteProviderAuthorization, loadChannelAuthorization, otherVerifiedChannelForCreator,
  resolveVerifiedCommunityChannel, revokeCommunityChannel, revokeCreatorConnection,
  revokeSiteCreatorConnection, storeChannelAuthorizationTokens,
} from "@yourrank/shared/provider-connections";
import { loadChatGiveawayConnection } from "@yourrank/shared/chat-giveaways";

const url = process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (url ? it : it.skip)(name, fn, 60000);
const tag = crypto.randomUUID().slice(0, 12);
const owner = crypto.randomUUID();
const stranger = crypto.randomUUID();
const siteOne = crypto.randomUUID();
const siteTwo = crypto.randomUUID();
const strangerSite = crypto.randomUUID();
const kickOne = `site-one-${tag}`;
const kickTwo = `site-two-${tag}`;
let admin;
let worker;
let run;

const connect = (runner, siteId, kickId, token = "enc") => linkSiteProviderAuthorization(runner, {
  siteId, userId: owner, provider: "kick", externalUserId: kickId, username: kickId,
  accessTokenEnc: `${token}-access`, refreshTokenEnc: `${token}-refresh`, tokenExpiresAt: null,
  externalChannelId: kickId, externalChannelName: kickId,
});
const inTx = (fn) => worker.begin((tx) => fn((text, params) => tx.unsafe(text, params)));
const legacyVerified = async (siteId) =>
  (await admin`SELECT kick_channel_verified_at IS NOT NULL AS verified FROM sites WHERE id = ${siteId}`)[0].verified;
const attempt = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

beforeAll(async () => {
  if (!url) return;
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "postgres"].includes(parsed.hostname) || !/test|e2e/.test(parsed.pathname)) throw new Error("Disposable local database required");
  admin = postgres(url, { max: 2, prepare: false });
  parsed.username = "yourrank_worker";
  worker = postgres(parsed.toString(), { max: 2, prepare: false });
  run = (text, params) => worker.unsafe(text, params);
  for (const id of [owner, stranger]) {
    await admin`INSERT INTO users (id, email, status, email_verified) VALUES (${id}, ${`${id}@test.example`}, 'active', true)`;
  }
  await admin`INSERT INTO sites (id, user_id, slug, name, published, is_draft) VALUES
    (${siteOne}, ${owner}, ${`sc1-${tag}`}, 'Site One', true, false),
    (${siteTwo}, ${owner}, ${`sc2-${tag}`}, 'Site Two', true, false),
    (${strangerSite}, ${stranger}, ${`sc3-${tag}`}, 'Stranger', true, false)`;
});

afterAll(async () => {
  if (!admin) return;
  await admin`DELETE FROM sites WHERE id IN (${siteOne}, ${siteTwo}, ${strangerSite})`;
  await admin`DELETE FROM users WHERE id IN (${owner}, ${stranger})`;
  await admin.end({ timeout: 0 });
  await worker.end({ timeout: 0 });
});

describe("per-site creator connections", () => {
  integrationIt("connecting a second site with another Kick account keeps the first site verified and routable", async () => {
    expect(await inTx((tx) => connect(tx, siteOne, kickOne))).toMatchObject({ scope: "account" });
    const second = await inTx((tx) => connect(tx, siteTwo, kickTwo));
    expect(second.scope).toBe("site");

    expect(await resolveVerifiedCommunityChannel(run, "kick", kickOne)).toEqual({ siteId: siteOne, userId: owner });
    expect(await resolveVerifiedCommunityChannel(run, "kick", kickTwo)).toEqual({ siteId: siteTwo, userId: owner });
    expect(await loadChannelAuthorization(run, siteOne, "kick")).toMatchObject({ scope: "account", externalUserId: kickOne, accessTokenEnc: "enc-access" });
    expect(await loadChannelAuthorization(run, siteTwo, "kick")).toMatchObject({ scope: "site", connectionId: second.connectionId, externalUserId: kickTwo });
    expect(await loadChatGiveawayConnection(run, siteOne, "kick")).toMatchObject({ connected: true, channelName: kickOne });
    expect(await loadChatGiveawayConnection(run, siteTwo, "kick")).toMatchObject({ connected: true, channelName: kickTwo });
    expect(await legacyVerified(siteOne)).toBe(true);
    expect(await legacyVerified(siteTwo)).toBe(true);
    // The account connection (and its legacy users mirror) still names site one's account.
    const [account] = await admin`SELECT external_user_id FROM creator_connections WHERE user_id = ${owner} AND provider = 'kick'`;
    expect(account.external_user_id).toBe(kickOne);
    // Reconnecting either site is idempotent and keeps both routable.
    expect((await inTx((tx) => connect(tx, siteTwo, kickTwo, "again"))).scope).toBe("site");
    expect((await inTx((tx) => connect(tx, siteOne, kickOne, "again"))).scope).toBe("account");
    expect(await resolveVerifiedCommunityChannel(run, "kick", kickOne)).toEqual({ siteId: siteOne, userId: owner });
    expect(await resolveVerifiedCommunityChannel(run, "kick", kickTwo)).toEqual({ siteId: siteTwo, userId: owner });
    expect(await otherVerifiedChannelForCreator(run, owner, "kick", siteOne)).toBeNull();
  });

  integrationIt("refreshing or clearing one site's credentials leaves the other site's credentials alone", async () => {
    const two = await loadChannelAuthorization(run, siteTwo, "kick");
    await storeChannelAuthorizationTokens(run, two, { accessTokenEnc: "two-new", refreshTokenEnc: "two-refresh", tokenExpiresAt: null });
    expect(await loadChannelAuthorization(run, siteTwo, "kick")).toMatchObject({ accessTokenEnc: "two-new" });
    expect(await loadChannelAuthorization(run, siteOne, "kick")).toMatchObject({ accessTokenEnc: "again-access" });

    await inTx((tx) => clearChannelAuthorizationTokens(tx, two));
    expect(await loadChannelAuthorization(run, siteTwo, "kick")).toMatchObject({ accessTokenEnc: null, refreshTokenEnc: null });
    expect(await loadChannelAuthorization(run, siteOne, "kick")).toMatchObject({ accessTokenEnc: "again-access" });
    // Credentials loss is "reconnect required", not an unbinding.
    expect(await resolveVerifiedCommunityChannel(run, "kick", kickTwo)).toEqual({ siteId: siteTwo, userId: owner });
  });

  integrationIt("a Kick account held by one YourRank user cannot be linked by another, in either table", async () => {
    const viaAccount = await attempt(() => inTx((tx) => linkCreatorConnection(tx, {
      userId: stranger, provider: "kick", externalUserId: kickTwo, username: "x", accessTokenEnc: "e", refreshTokenEnc: null, tokenExpiresAt: null,
    })));
    expect(viaAccount?.code).toBe("23505");
    const viaSite = await attempt(() => inTx((tx) => linkSiteCreatorConnection(tx, {
      siteId: strangerSite, userId: stranger, provider: "kick", externalUserId: kickOne, username: "x",
      verifiedChannelId: kickOne, accessTokenEnc: "e", refreshTokenEnc: null, tokenExpiresAt: null,
    })));
    expect(viaSite?.code).toBe("23505");
    // A site authorization must belong to the site's owner.
    const foreign = await attempt(() => inTx((tx) => linkSiteCreatorConnection(tx, {
      siteId: siteOne, userId: stranger, provider: "kick", externalUserId: `foreign-${tag}`, username: "x",
      verifiedChannelId: `foreign-${tag}`, accessTokenEnc: "e", refreshTokenEnc: null, tokenExpiresAt: null,
    })));
    expect(foreign?.code).toBe("23514");
  });

  integrationIt("disconnecting one site never unbinds the other, whichever authorization it used", async () => {
    // Site two (own authorization) disconnects: site one keeps routing.
    await inTx(async (tx) => {
      await revokeCommunityChannel(tx, siteTwo, "kick");
      await revokeSiteCreatorConnection(tx, siteTwo, "kick");
    });
    expect(await resolveVerifiedCommunityChannel(run, "kick", kickTwo)).toBeNull();
    expect(await resolveVerifiedCommunityChannel(run, "kick", kickOne)).toEqual({ siteId: siteOne, userId: owner });
    const [revoked] = await admin`SELECT status, unlinked_at FROM site_creator_connections WHERE site_id = ${siteTwo}`;
    expect(revoked.status).toBe("revoked");
    expect(revoked.unlinked_at).not.toBeNull();

    // Site two reconnects; then site one (account authorization) disconnects.
    expect((await inTx((tx) => connect(tx, siteTwo, kickTwo, "back"))).scope).toBe("site");
    await inTx(async (tx) => {
      expect(await otherVerifiedChannelForCreator(tx, owner, "kick", siteOne)).toBeNull();
      await revokeCreatorConnection(tx, owner, "kick");
      await revokeCommunityChannel(tx, siteOne, "kick");
    });
    expect(await resolveVerifiedCommunityChannel(run, "kick", kickOne)).toBeNull();
    expect(await resolveVerifiedCommunityChannel(run, "kick", kickTwo)).toEqual({ siteId: siteTwo, userId: owner });
    expect(await loadChatGiveawayConnection(run, siteTwo, "kick")).toMatchObject({ connected: true });
    // The legacy invalidation of the user's account link keeps site two's legacy proof.
    expect(await legacyVerified(siteTwo)).toBe(true);

    // With no account link left in use, the next connect reuses the account row.
    expect((await inTx((tx) => connect(tx, siteOne, kickOne, "fresh"))).scope).toBe("account");
    expect(await resolveVerifiedCommunityChannel(run, "kick", kickOne)).toEqual({ siteId: siteOne, userId: owner });
    expect(await resolveVerifiedCommunityChannel(run, "kick", kickTwo)).toEqual({ siteId: siteTwo, userId: owner });
  });
});
