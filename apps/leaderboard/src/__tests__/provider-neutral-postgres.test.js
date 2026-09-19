// Portability blockers that must hold at the database level, not just in
// application memory: atomic viewer identity persistence, one Viewer Account
// per concurrent first login, and channel routing through the explicit
// `community_channels.creator_connection_id` relationship where the creator's
// external user id and the channel's external id are different strings.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { linkExternalViewerIdentity } from "@yourrank/shared/viewer-identity";
import {
  linkCommunityChannel,
  linkCreatorConnection,
  loadCommunityChannel,
  resolveVerifiedCommunityChannel,
  revokeCommunityChannel,
  revokeCreatorConnection,
} from "@yourrank/shared/provider-connections";

const databaseUrl = process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (databaseUrl ? it : it.skip)(name, fn, 60000);
const run = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const creator = crypto.randomUUID();
const rival = crypto.randomUUID();
const creatorSite = crypto.randomUUID();
const rivalSite = crypto.randomUUID();
const creatorUserId = `user-123-${run}`;
const rivalUserId = `user-456-${run}`;
const channelId = `channel-999-${run}`;
let sql;

const ext = (name) => `${name}-${run}`;
const identity = (provider, externalUserId, username = externalUserId) => ({
  provider, externalUserId, username, avatarUrl: null, accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null,
});
const txRunner = (tx) => (text, params) => tx.unsafe(text, params);
const route = (provider, externalChannelId) => sql.begin((tx) => resolveVerifiedCommunityChannel(txRunner(tx), provider, externalChannelId));
const viewersFor = (provider, externalUserId) => sql`
  SELECT v.id FROM viewers v JOIN viewer_identities vi ON vi.viewer_id = v.id
   WHERE vi.provider=${provider} AND vi.external_user_id=${externalUserId}`;
const attempt = async (fn) => { try { await fn(); return null; } catch (error) { return error; } };

beforeAll(async () => {
  if (!databaseUrl) return;
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "postgres"].includes(url.hostname) || !/test|e2e/.test(url.pathname)) throw new Error("Disposable local database required");
  sql = postgres(databaseUrl, { max: 12, prepare: false, onnotice: () => {} });
  await sql`INSERT INTO users (id, email, status, email_verified) VALUES
    (${creator}, ${`creator-${run}@yourrank.test`}, 'active', true),
    (${rival}, ${`rival-${run}@yourrank.test`}, 'active', true)`;
  await sql`INSERT INTO sites (id, user_id, slug, name, published, is_draft) VALUES
    (${creatorSite}, ${creator}, ${`c-${run}`}, 'Creator site', true, false),
    (${rivalSite}, ${rival}, ${`r-${run}`}, 'Rival site', true, false)`;
});
afterAll(async () => {
  if (!sql) return;
  await sql`DELETE FROM viewers WHERE id IN (SELECT viewer_id FROM viewer_identities WHERE external_user_id LIKE ${`%-${run}%`})`;
  await sql`DELETE FROM sites WHERE id IN (${creatorSite}, ${rivalSite})`;
  await sql`DELETE FROM users WHERE id IN (${creator}, ${rival})`;
  await sql.end({ timeout: 0 });
});

describe("atomic viewer identity persistence (real database)", () => {
  integrationIt("a failure after the viewer insert rolls back viewers, identities, legacy mirror and username history together", async () => {
    const externalUserId = ext("kick-rollback");
    const before = await sql`SELECT count(*)::int AS n FROM viewers`.then(([r]) => r.n);
    const error = await attempt(() => sql.begin(async (tx) => {
      const result = await linkExternalViewerIdentity(txRunner(tx), identity("kick", externalUserId, "Rollback"), { mode: "signin" });
      expect(result.ok).toBe(true);
      // Every write landed inside the transaction...
      expect(await tx`SELECT id FROM viewers WHERE id=${result.viewerId} AND kick_user_id=${externalUserId}`).toHaveLength(1);
      expect(await tx`SELECT id FROM viewer_identities WHERE viewer_id=${result.viewerId}`).toHaveLength(1);
      expect(await tx`SELECT id FROM viewer_username_history WHERE viewer_id=${result.viewerId}`).toHaveLength(1);
      throw new Error("simulated failure between identity writes and commit");
    }));
    expect(error?.message).toContain("simulated failure");
    // ...and none of them survived the rollback.
    expect(await sql`SELECT count(*)::int AS n FROM viewers`.then(([r]) => r.n)).toBe(before);
    expect(await sql`SELECT id FROM viewers WHERE kick_user_id=${externalUserId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM viewer_identities WHERE external_user_id=${externalUserId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM viewer_username_history WHERE username='rollback'`).toHaveLength(0);
  });

  integrationIt("a database error on the last write (username history) leaves no orphan viewer, identity or legacy mirror", async () => {
    const externalUserId = ext("kick-mirror");
    const failing = (tx) => (text, params) => {
      if (/viewer_username_history/.test(text)) return tx.unsafe("SELECT 1/0");
      return tx.unsafe(text, params);
    };
    const error = await attempt(() => sql.begin((tx) =>
      linkExternalViewerIdentity(failing(tx), identity("kick", externalUserId, "Mirror"), { mode: "signin" })));
    expect(error?.code).toBe("22012");
    expect(await sql`SELECT id FROM viewers WHERE kick_user_id=${externalUserId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM viewer_identities WHERE external_user_id=${externalUserId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM viewer_username_history WHERE username='mirror'`).toHaveLength(0);
  });
});

describe("concurrent first login (real database)", () => {
  integrationIt("eight simultaneous first logins for one Discord identity produce exactly one Viewer Account", async () => {
    const externalUserId = ext("discord-race");
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => sql.begin(async (tx) => {
      // Separate connections and transactions: only the advisory lock and the
      // unique constraint decide who creates and who resolves.
      const result = await linkExternalViewerIdentity(txRunner(tx), identity("discord", externalUserId, `racer_${i}`), { mode: "signin" });
      await tx`SELECT pg_sleep(0.02)`;
      return result;
    })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => r.viewerId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await viewersFor("discord", externalUserId)).toHaveLength(1);
    expect(await sql`SELECT id FROM viewers WHERE discord_user_id=${externalUserId}`).toHaveLength(1);
  });

  integrationIt("concurrent link attempts from two viewers for one identity leave exactly one owner and both accounts intact", async () => {
    const externalUserId = ext("discord-contested");
    const [a] = await sql`INSERT INTO viewers DEFAULT VALUES RETURNING id`;
    const [b] = await sql`INSERT INTO viewers DEFAULT VALUES RETURNING id`;
    await sql`INSERT INTO viewer_identities (viewer_id, provider, external_user_id, username, linked_at) VALUES
      (${a.id}, 'kick', ${ext("kick-a")}, 'a', now()), (${b.id}, 'kick', ${ext("kick-b")}, 'b', now())`;
    const results = await Promise.all([a.id, b.id].map((viewerId) => sql.begin((tx) =>
      linkExternalViewerIdentity(txRunner(tx), identity("discord", externalUserId), { mode: "link", viewerId }))));
    const winners = results.filter((r) => r.ok);
    expect(winners).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: "identity_owned_by_other_viewer" });
    expect(await viewersFor("discord", externalUserId)).toEqual([{ id: winners[0].viewerId }]);
    expect(await sql`SELECT id FROM viewers WHERE id IN (${a.id}, ${b.id})`).toHaveLength(2);
  });
});

describe("provider-neutral channel ownership (real database)", () => {
  integrationIt("routes channel-999 to the creator whose connection user-123 verified it; revoked, unverified, hijacked and rebound states behave", async () => {
    const run = (text, params) => sql.unsafe(text, params);
    const connectionId = await linkCreatorConnection(run, {
      userId: creator, provider: "discord", externalUserId: creatorUserId, username: "creator", accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null,
    });
    const rivalConnectionId = await linkCreatorConnection(run, {
      userId: rival, provider: "discord", externalUserId: rivalUserId, username: "rival", accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null,
    });
    expect(creatorUserId).not.toBe(channelId);

    // An unverified binding never routes, whatever the ids look like.
    await linkCommunityChannel(run, { siteId: creatorSite, provider: "discord", externalChannelId: channelId, externalChannelName: "Guild", verified: false });
    expect(await route("discord", channelId)).toBeNull();

    // A verified binding must name the verifying connection, and that
    // connection must belong to the site owner for the same provider.
    expect((await attempt(() => linkCommunityChannel(run, { siteId: creatorSite, provider: "discord", externalChannelId: channelId, externalChannelName: "Guild", verified: true })))?.message)
      .toContain("requires the verifying creator connection");
    expect((await attempt(() => linkCommunityChannel(run, { siteId: creatorSite, provider: "discord", externalChannelId: channelId, externalChannelName: "Guild", creatorConnectionId: rivalConnectionId, verified: true })))?.message)
      .toContain("does not belong to the site owner");
    expect(await route("discord", channelId)).toBeNull();

    // Provider-specific verification happened (simulated) -> explicit binding routes.
    await linkCommunityChannel(run, { siteId: creatorSite, provider: "discord", externalChannelId: channelId, externalChannelName: "Guild", creatorConnectionId: connectionId, verified: true });
    expect((await loadCommunityChannel(run, creatorSite, "discord"))?.creatorConnectionId).toBe(connectionId);
    expect(await route("discord", channelId)).toEqual({ siteId: creatorSite, userId: creator });
    expect(await route("kick", channelId)).toBeNull();

    // Another creator cannot hijack the binding: the (provider, channel) is
    // actively owned, and their connection does not belong to this site anyway.
    const hijack = await attempt(() => linkCommunityChannel(run, { siteId: rivalSite, provider: "discord", externalChannelId: channelId, externalChannelName: "Guild", creatorConnectionId: rivalConnectionId, verified: true }));
    expect(hijack?.code).toBe("23505");
    expect(await route("discord", channelId)).toEqual({ siteId: creatorSite, userId: creator });

    // Revoking the creator connection stops routing and drops the verification.
    await revokeCreatorConnection(run, creator, "discord");
    expect(await route("discord", channelId)).toBeNull();
    expect((await loadCommunityChannel(run, creatorSite, "discord"))?.verifiedAt).toBeNull();

    // Re-linking the same identity re-verifies (through provider code) and routes again.
    const relinkedId = await linkCreatorConnection(run, {
      userId: creator, provider: "discord", externalUserId: creatorUserId, username: "creator", accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null,
    });
    await linkCommunityChannel(run, { siteId: creatorSite, provider: "discord", externalChannelId: channelId, externalChannelName: "Guild", creatorConnectionId: relinkedId, verified: true });
    expect(await route("discord", channelId)).toEqual({ siteId: creatorSite, userId: creator });

    // Re-linking as a DIFFERENT external identity invalidates the old proof.
    await linkCreatorConnection(run, {
      userId: creator, provider: "discord", externalUserId: `${creatorUserId}-other`, username: "creator2", accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null,
    });
    expect(await route("discord", channelId)).toBeNull();
    await linkCommunityChannel(run, { siteId: creatorSite, provider: "discord", externalChannelId: channelId, externalChannelName: "Guild", creatorConnectionId: relinkedId, verified: true });
    expect(await route("discord", channelId)).toEqual({ siteId: creatorSite, userId: creator });

    // Revoking the channel stops routing; unlink then lets the rival bind and route.
    await revokeCommunityChannel(run, creatorSite, "discord");
    expect(await route("discord", channelId)).toBeNull();
    await linkCommunityChannel(run, { siteId: rivalSite, provider: "discord", externalChannelId: channelId, externalChannelName: "Guild", creatorConnectionId: rivalConnectionId, verified: true });
    expect(await route("discord", channelId)).toEqual({ siteId: rivalSite, userId: rival });
  });
});
