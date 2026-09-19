// Phase 2 guarantees of 20260920000000_provider_portability_active_ownership.sql
// exercised through the generic application helpers: one active owner per
// external id, unlink keeps history but frees the id, same viewer may hold
// several providers, and Kick reversals/duplicates stay correct with routing
// resolved through community_channels. Runs only against a disposable local
// database (AUDIT_TEST_DATABASE_URL).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import {
  findViewerByExternalIdentity, persistViewerIdentity, revokeViewerIdentity,
} from "@yourrank/shared/viewer-identity";
import {
  linkCreatorConnection, revokeCreatorConnection, loadCreatorConnection,
  linkCommunityChannel, revokeCommunityChannel, loadCommunityChannel, resolveVerifiedCommunityChannel,
} from "@yourrank/shared/provider-connections";
import { processKickRewardRedemption } from "@yourrank/shared/kick-credits";

const url = process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (url ? it : it.skip)(name, fn, 60000);
const tag = crypto.randomUUID();
const userA = crypto.randomUUID();
const userB = crypto.randomUUID();
const siteA = crypto.randomUUID();
const siteB = crypto.randomUUID();
const channel = `rebind-${tag}`;
const viewerExt = `rebind-viewer-${tag}`;
const events = [];
let sql;
let run;
let oldUrl;

const identity = (provider, externalUserId, username) => ({
  provider, externalUserId, username, avatarUrl: null, accessTokenEnc: "enc", refreshTokenEnc: null, tokenExpiresAt: null,
});
const creator = (userId) => ({
  userId, provider: "kick", externalUserId: channel, username: `owner-${userId.slice(0, 6)}`,
  accessTokenEnc: "enc", refreshTokenEnc: null, tokenExpiresAt: null,
});
const event = (status, redemptionId) => {
  const messageId = crypto.randomUUID(); events.push(messageId);
  return { messageId, eventType: "channel.reward.redemption.updated", payload: {
    id: redemptionId, broadcaster: { user_id: channel }, redeemer: { user_id: viewerExt, username: "Rebind Viewer" },
    reward: { id: "rebind-reward", title: "Rebind", cost: 10 }, status,
  } };
};
const attempt = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

beforeAll(async () => {
  if (!url) return;
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "postgres"].includes(parsed.hostname) || !/test|e2e/.test(parsed.pathname)) throw new Error("Disposable local database required");
  sql = postgres(url, { max: 3, prepare: false });
  run = (text, params) => sql.unsafe(text, params);
  for (const id of [userA, userB]) {
    await sql`INSERT INTO users (id, email, status, email_verified) VALUES (${id}, ${`${id}@test.example`}, 'active', true)`;
  }
  await sql`INSERT INTO sites (id, user_id, slug, name, published, is_draft) VALUES
    (${siteA}, ${userA}, ${`ra-${siteA.slice(0, 30)}`}, 'Rebind A', true, false),
    (${siteB}, ${userB}, ${`rb-${siteB.slice(0, 30)}`}, 'Rebind B', true, false)`;
  await sql`INSERT INTO credit_reward_mappings (site_id, kick_reward_id, kick_reward_title, kick_reward_cost, credits, active)
    VALUES (${siteB}, 'rebind-reward', 'Rebind', 10, 25, true)`;
  oldUrl = process.env.DATABASE_URL; parsed.username = "yourrank_worker"; process.env.DATABASE_URL = parsed.toString();
});

afterAll(async () => {
  if (!sql) return;
  await sql`DELETE FROM kick_reward_events WHERE event_id IN ${sql(events.length ? events : ["none"])}`;
  await sql`DELETE FROM integration_events WHERE provider='kick' AND external_event_id IN ${sql(events.length ? events : ["none"])}`;
  await sql`DELETE FROM sites WHERE id IN (${siteA}, ${siteB})`;
  await sql`DELETE FROM viewers WHERE id IN (SELECT viewer_id FROM viewer_identities WHERE external_user_id LIKE ${`rebind-%${tag}%`})`;
  await sql`DELETE FROM users WHERE id IN (${userA}, ${userB})`;
  await sql.end({ timeout: 0 });
  if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
});

describe("provider portability active ownership", () => {
  integrationIt("viewer identity: link A, reject B, unlink A, relink B; Kick + Discord on one viewer", async () => {
    const viewerA = await persistViewerIdentity(run, identity("kick", viewerExt, "Viewer A"), null);
    expect(await findViewerByExternalIdentity(run, "kick", viewerExt)).toEqual({ viewerId: viewerA, username: "Viewer A" });

    // Second provider on the same viewer is fine.
    await persistViewerIdentity(run, identity("discord", `${viewerExt}-dc`, "viewer#1"), viewerA);
    const providers = await sql`SELECT provider FROM viewer_identities WHERE viewer_id=${viewerA} AND status='active' ORDER BY provider`;
    expect(providers.map((r) => r.provider)).toEqual(["discord", "kick"]);
    const [legacy] = await sql`SELECT kick_user_id, discord_user_id FROM viewers WHERE id=${viewerA}`;
    expect(legacy).toEqual({ kick_user_id: viewerExt, discord_user_id: `${viewerExt}-dc` });

    // Active duplicate ownership is impossible.
    const viewerB = await persistViewerIdentity(run, identity("discord", `${viewerExt}-dc2`, "viewer#2"), null);
    const dup = await attempt(() => persistViewerIdentity(run, identity("kick", viewerExt, "Thief"), viewerB));
    expect(dup?.code).toBe("23505");
    expect((await sql`SELECT kick_user_id FROM viewers WHERE id=${viewerB}`)[0].kick_user_id).toBeNull();

    // Unlink from A: history kept, legacy mirror cleared, lookup no longer resolves A.
    await revokeViewerIdentity(run, viewerA, "kick");
    const [revoked] = await sql`SELECT status, unlinked_at, access_token_enc FROM viewer_identities WHERE viewer_id=${viewerA} AND provider='kick'`;
    expect(revoked.status).toBe("revoked");
    expect(revoked.unlinked_at).toBeTruthy();
    expect(revoked.access_token_enc).toBeNull();
    expect((await sql`SELECT kick_user_id FROM viewers WHERE id=${viewerA}`)[0].kick_user_id).toBeNull();
    expect(await findViewerByExternalIdentity(run, "kick", viewerExt)).toBeNull();

    // Relink to B.
    await persistViewerIdentity(run, identity("kick", viewerExt, "Viewer B"), viewerB);
    expect(await findViewerByExternalIdentity(run, "kick", viewerExt)).toEqual({ viewerId: viewerB, username: "Viewer B" });
    const owners = await sql`SELECT viewer_id, status FROM viewer_identities WHERE provider='kick' AND external_user_id=${viewerExt} ORDER BY status`;
    expect(owners).toEqual([{ viewer_id: viewerB, status: "active" }, { viewer_id: viewerA, status: "revoked" }]);

    // A can reclaim its own former identity later (owner/provider row reactivates instead of duplicating).
    await revokeViewerIdentity(run, viewerB, "kick");
    await persistViewerIdentity(run, identity("kick", viewerExt, "Viewer A"), viewerA);
    expect(await sql`SELECT count(*)::int AS n FROM viewer_identities WHERE provider='kick' AND external_user_id=${viewerExt} AND status='active'`).toEqual([{ n: 1 }]);
    await revokeViewerIdentity(run, viewerA, "kick");
  });

  integrationIt("creator connection: link A, reject B, unlink A, relink B", async () => {
    await linkCreatorConnection(run, creator(userA));
    expect((await loadCreatorConnection(run, userA, "kick"))?.externalUserId).toBe(channel);
    expect((await sql`SELECT kick_user_id FROM users WHERE id=${userA}`)[0].kick_user_id).toBe(channel);

    const dup = await attempt(() => linkCreatorConnection(run, creator(userB)));
    expect(dup?.code).toBe("23505");
    expect(await loadCreatorConnection(run, userB, "kick")).toBeNull();

    await revokeCreatorConnection(run, userA, "kick");
    expect(await loadCreatorConnection(run, userA, "kick")).toBeNull();
    const [row] = await sql`SELECT status, unlinked_at, access_token_enc FROM creator_connections WHERE user_id=${userA} AND provider='kick'`;
    expect(row).toMatchObject({ status: "revoked", access_token_enc: null });
    expect(row.unlinked_at).toBeTruthy();
    expect((await sql`SELECT kick_user_id, kick_access_token_enc FROM users WHERE id=${userA}`)[0]).toEqual({ kick_user_id: null, kick_access_token_enc: null });

    await linkCreatorConnection(run, creator(userB));
    expect((await loadCreatorConnection(run, userB, "kick"))?.externalUserId).toBe(channel);
    const owners = await sql`SELECT user_id, status FROM creator_connections WHERE provider='kick' AND external_user_id=${channel} ORDER BY status`;
    expect(owners).toEqual([{ user_id: userB, status: "active" }, { user_id: userA, status: "revoked" }]);
  });

  integrationIt("community channel: link A, reject B, unlink A, relink B; routing needs active+verified+owned", async () => {
    // Site A's owner (userA) no longer holds a creator connection, so no
    // verification can name one: a verified binding is refused outright and an
    // unverified binding is allowed but must not route.
    const connectionB = (await loadCreatorConnection(run, userB, "kick")).id;
    const unproven = await attempt(() => linkCommunityChannel(run, { siteId: siteA, provider: "kick", externalChannelId: channel, externalChannelName: "Rebind", verified: true }));
    expect(unproven?.message).toContain("requires the verifying creator connection");
    const hijack = await attempt(() => linkCommunityChannel(run, { siteId: siteA, provider: "kick", externalChannelId: channel, externalChannelName: "Rebind", creatorConnectionId: connectionB, verified: true }));
    expect(hijack?.message).toContain("does not belong to the site owner");
    await linkCommunityChannel(run, { siteId: siteA, provider: "kick", externalChannelId: channel, externalChannelName: "Rebind", verified: false });
    expect((await loadCommunityChannel(run, siteA, "kick"))?.externalChannelId).toBe(channel);
    expect(await sql.begin((tx) => resolveVerifiedCommunityChannel((t, p) => tx.unsafe(t, p), "kick", channel))).toBeNull();

    const dup = await attempt(() => linkCommunityChannel(run, { siteId: siteB, provider: "kick", externalChannelId: channel, externalChannelName: "Rebind", creatorConnectionId: connectionB, verified: true }));
    expect(dup?.code).toBe("23505");
    expect((await sql`SELECT kick_channel_external_id FROM sites WHERE id=${siteB}`)[0].kick_channel_external_id).toBeNull();

    await revokeCommunityChannel(run, siteA, "kick");
    expect(await loadCommunityChannel(run, siteA, "kick")).toBeNull();
    const [row] = await sql`SELECT status, verified_at, unlinked_at FROM community_channels WHERE site_id=${siteA} AND provider='kick'`;
    expect(row.status).toBe("revoked");
    expect(row.verified_at).toBeNull();
    expect(row.unlinked_at).toBeTruthy();
    expect((await sql`SELECT kick_channel_external_id, kick_channel_verified_at FROM sites WHERE id=${siteA}`)[0])
      .toEqual({ kick_channel_external_id: null, kick_channel_verified_at: null });

    // Unverified binding on B does not route even though B's owner holds the creator connection.
    await linkCommunityChannel(run, { siteId: siteB, provider: "kick", externalChannelId: channel, externalChannelName: "Rebind", verified: false });
    expect(await sql.begin((tx) => resolveVerifiedCommunityChannel((t, p) => tx.unsafe(t, p), "kick", channel))).toBeNull();

    await linkCommunityChannel(run, { siteId: siteB, provider: "kick", externalChannelId: channel, externalChannelName: "Rebind", creatorConnectionId: connectionB, verified: true });
    expect(await sql.begin((tx) => resolveVerifiedCommunityChannel((t, p) => tx.unsafe(t, p), "kick", channel))).toEqual({ siteId: siteB, userId: userB });
    expect((await loadCommunityChannel(run, siteB, "kick"))?.creatorConnectionId).toBe(connectionB);
    const owners = await sql`SELECT site_id, status FROM community_channels WHERE provider='kick' AND external_channel_id=${channel} ORDER BY status`;
    expect(owners).toEqual([{ site_id: siteB, status: "active" }, { site_id: siteA, status: "revoked" }]);
  });

  integrationIt("kick reward event routes via community_channels; duplicate and refund stay correct and traceable", async () => {
    const redemptionId = `redemption-${tag}`;
    const earn = event("fulfilled", redemptionId);
    const first = await processKickRewardRedemption(earn);
    expect(first).toMatchObject({ credited: 25, balance: 25 });

    // Same provider event id replayed: no double credit.
    expect(await processKickRewardRedemption(earn)).toEqual({ duplicate: true });

    const viewer = await findViewerByExternalIdentity(run, "kick", viewerExt);
    expect(viewer?.viewerId).toBeTruthy();
    const [sv] = await sql`SELECT id, balance FROM site_viewers WHERE site_id=${siteB} AND viewer_id=${viewer.viewerId}`;
    expect(sv.balance).toBe(25);

    const refund = event("refunded", redemptionId);
    expect(await processKickRewardRedemption(refund)).toEqual({ refunded: 25, balance: 0 });
    expect(await processKickRewardRedemption(event("refunded", redemptionId))).toEqual({ duplicate: true });

    const ledger = await sql`SELECT type, amount, kick_event_id, integration_event_id FROM credit_ledger WHERE site_viewer_id=${sv.id} ORDER BY created_at`;
    expect(ledger.map((r) => [r.type, Number(r.amount)])).toEqual([["earn", 25], ["refund", 25]]);
    expect(ledger[0].kick_event_id).toBe(earn.messageId);
    expect(ledger[0].integration_event_id).toBeTruthy();
    const [ie] = await sql`SELECT provider, external_event_id, site_id FROM integration_events WHERE id=${ledger[0].integration_event_id}`;
    expect(ie).toEqual({ provider: "kick", external_event_id: earn.messageId, site_id: siteB });
    expect((await sql`SELECT balance FROM site_viewers WHERE id=${sv.id}`)[0].balance).toBe(0);

    // After the channel is unlinked, the same provider channel no longer routes anywhere.
    await revokeCommunityChannel(run, siteB, "kick");
    expect(await processKickRewardRedemption(event("fulfilled", `${redemptionId}-late`))).toMatchObject({ skipped: true });
  });
});
