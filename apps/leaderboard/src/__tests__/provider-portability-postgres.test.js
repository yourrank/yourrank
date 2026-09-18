// Expand-phase guarantees of 20260919000000_provider_portability_expand.sql:
// legacy kick_*/discord_* columns stay authoritative, generic rows mirror them,
// and the redemption path dual-writes integration_events. Runs only against a
// disposable local database (AUDIT_TEST_DATABASE_URL).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { processKickRewardRedemption, setSiteKickChannel } from "@yourrank/shared/kick-credits";

const url = process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (url ? it : it.skip)(name, fn, 60000);
const owner = crypto.randomUUID();
const site = crypto.randomUUID();
const channel = `port-${crypto.randomUUID()}`;
const viewerExt = `${channel}-viewer`;
const events = [];
let sql;
let oldUrl;

const event = (status = "fulfilled") => {
  const messageId = crypto.randomUUID(); events.push(messageId);
  return { messageId, eventType: "channel.reward.redemption.updated", payload: {
    id: messageId, broadcaster: { user_id: channel }, redeemer: { user_id: viewerExt, username: "Port Viewer" },
    reward: { id: "port-reward", title: "Port", cost: 10 }, status,
  } };
};

beforeAll(async () => {
  if (!url) return;
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "postgres"].includes(parsed.hostname) || !/test|e2e/.test(parsed.pathname)) throw new Error("Disposable local database required");
  sql = postgres(url, { max: 3, prepare: false });
  await sql`INSERT INTO users (id, email, status, email_verified, kick_user_id, kick_username, kick_linked_at)
    VALUES (${owner}, ${`${owner}@test.example`}, 'active', true, ${channel}, 'portowner', now())`;
  await sql`INSERT INTO sites (id, user_id, slug, name, published, is_draft) VALUES
    (${site}, ${owner}, ${`p-${site.slice(0, 30)}`}, 'Portability', true, false)`;
  await sql`INSERT INTO credit_reward_mappings (site_id, kick_reward_id, kick_reward_title, kick_reward_cost, credits, active)
    VALUES (${site}, 'port-reward', 'Port', 10, 25, true)`;
  oldUrl = process.env.DATABASE_URL; parsed.username = "yourrank_worker"; process.env.DATABASE_URL = parsed.toString();
});

afterAll(async () => {
  if (!sql) return;
  await sql`DELETE FROM kick_reward_events WHERE event_id IN ${sql(events.length ? events : ["none"])}`;
  await sql`DELETE FROM integration_events WHERE provider='kick' AND external_event_id IN ${sql(events.length ? events : ["none"])}`;
  await sql`DELETE FROM sites WHERE id=${site}`;
  await sql`DELETE FROM viewers WHERE kick_user_id=${viewerExt}`;
  await sql`DELETE FROM users WHERE id=${owner}`;
  await sql.end({ timeout: 0 });
  if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
});

describe("provider portability expand phase", () => {
  integrationIt("mirrors creator and channel bindings into generic rows without touching legacy columns", async () => {
    const conn = await sql`SELECT provider, external_user_id, username, status FROM creator_connections WHERE user_id=${owner}`;
    expect(conn).toEqual([{ provider: "kick", external_user_id: channel, username: "portowner", status: "active" }]);

    await setSiteKickChannel(site, channel, "owner");
    const ch = await sql`SELECT provider, external_channel_id, external_channel_name, verified_at FROM community_channels WHERE site_id=${site}`;
    expect(ch).toHaveLength(1);
    expect(ch[0].provider).toBe("kick");
    expect(ch[0].external_channel_id).toBe(channel);
    expect(ch[0].verified_at).toBeTruthy();
    expect((await sql`SELECT kick_channel_external_id FROM sites WHERE id=${site}`)[0].kick_channel_external_id).toBe(channel);
    expect((await sql`SELECT provider FROM credit_reward_mappings WHERE site_id=${site}`)[0].provider).toBe("kick");
  });

  integrationIt("dual-writes the normalized event and stamps the ledger while keeping kick_event_id", async () => {
    const e = event();
    expect(await processKickRewardRedemption(e)).toEqual({ credited: 25, balance: 25, newViewer: true });

    const [viewer] = await sql`SELECT id FROM viewers WHERE kick_user_id=${viewerExt}`;
    const ids = await sql`SELECT provider, external_user_id, username, status FROM viewer_identities WHERE viewer_id=${viewer.id}`;
    expect(ids).toEqual([{ provider: "kick", external_user_id: viewerExt, username: "Port Viewer", status: "active" }]);

    const [ie] = await sql`SELECT id, event_type, site_id, viewer_id, external_actor_id, processed_at
      FROM integration_events WHERE provider='kick' AND external_event_id=${e.messageId}`;
    expect(ie.event_type).toBe("reward_redemption");
    expect(ie.site_id).toBe(site);
    expect(ie.viewer_id).toBe(viewer.id);
    expect(ie.external_actor_id).toBe(viewerExt);
    expect(ie.processed_at).toBeTruthy();

    const [ledger] = await sql`SELECT kick_event_id, integration_event_id FROM credit_ledger WHERE kick_event_id=${e.messageId}`;
    expect(ledger.kick_event_id).toBe(e.messageId);
    expect(String(ledger.integration_event_id)).toBe(String(ie.id));

    // Replay: legacy idempotency still wins, no second envelope or credit.
    expect(await processKickRewardRedemption(e)).toEqual({ duplicate: true });
    expect(await sql`SELECT count(*)::int AS n FROM integration_events WHERE provider='kick' AND external_event_id=${e.messageId}`).toEqual([{ n: 1 }]);
    expect(await sql`SELECT count(*)::int AS n FROM credit_ledger WHERE kick_event_id=${e.messageId}`).toEqual([{ n: 1 }]);
  });

  integrationIt("rejects a second viewer claiming the same active identity, then allows relinking after unlink", async () => {
    const [{ id: viewerA }] = await sql`SELECT id FROM viewers WHERE kick_user_id=${viewerExt}`;
    const [{ id: viewerB }] = await sql`INSERT INTO viewers (kick_user_id, kick_username) VALUES (NULL, '') RETURNING id`;
    let error = null;
    try {
      await sql`INSERT INTO viewer_identities (viewer_id, provider, external_user_id) VALUES (${viewerB}, 'kick', ${viewerExt})`;
    } catch (err) { error = err; }
    expect(error?.code).toBe("23505");

    // Legacy unlink on A revokes its generic row but keeps it for audit.
    await sql`UPDATE viewers SET kick_user_id=NULL, kick_username='' WHERE id=${viewerA}`;
    const [revoked] = await sql`SELECT status, unlinked_at FROM viewer_identities WHERE viewer_id=${viewerA} AND provider='kick'`;
    expect(revoked.status).toBe("revoked");
    expect(revoked.unlinked_at).toBeTruthy();

    // B may now take the identity; only one active owner exists.
    await sql`INSERT INTO viewer_identities (viewer_id, provider, external_user_id, username) VALUES (${viewerB}, 'kick', ${viewerExt}, 'Port Viewer B')`;
    const owners = await sql`SELECT viewer_id, status FROM viewer_identities WHERE provider='kick' AND external_user_id=${viewerExt} ORDER BY status`;
    expect(owners).toEqual([{ viewer_id: viewerB, status: "active" }, { viewer_id: viewerA, status: "revoked" }]);
    await sql`DELETE FROM viewers WHERE id IN (${viewerA}, ${viewerB})`;
  });
});
