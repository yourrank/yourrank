// Real PostgreSQL coverage for the abuse-signal tables: the migration shape,
// the device-link upsert semantics, the 30-day IP retention cleanup, and the
// viewer_identity_events history written by shared viewer-identity helpers.
// Self-skips without AUDIT_TEST_DATABASE_URL.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { abuseSignalHash, cleanupIpObservations, recordAbuseSignals } from "../abuse-signals.js";
import { persistViewerIdentity, revokeViewerIdentity } from "@yourrank/shared/viewer-identity";

const url = process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (url ? it : it.skip)(name, fn, 60000);
const env = { ABUSE_SIGNAL_HMAC_KEY: `pg-test-key-${crypto.randomUUID()}` };
const siteId = crypto.randomUUID();
const ownerId = crypto.randomUUID();
const viewerId = crypto.randomUUID();
let sql;

const identity = (externalUserId, username = `kick_${externalUserId}`) => ({
  provider: "kick",
  externalUserId,
  username,
  avatarUrl: null,
  accessTokenEnc: "enc-access",
  refreshTokenEnc: "enc-refresh",
  tokenExpiresAt: new Date("2030-01-01"),
});
const runInTx = (fn) => sql.begin((tx) => fn((text, params = []) => tx.unsafe(text, params)));

beforeAll(async () => {
  if (!url) return;
  sql = postgres(url, { max: 4 });
  await sql`INSERT INTO users (id, email, password_hash, status, plan, email_verified) VALUES (${ownerId}, ${`abuse-${crypto.randomUUID()}@test.local`}, 'x', 'active', 'pro', true)`;
  await sql`INSERT INTO sites (id, user_id, slug, name, published, is_draft) VALUES (${siteId}, ${ownerId}, ${`abuse-${crypto.randomUUID().slice(0, 8)}`}, 'Abuse', true, false)`;
  await sql`INSERT INTO viewers (id) VALUES (${viewerId})`;
});

afterAll(async () => {
  if (!sql) return;
  await sql`DELETE FROM sites WHERE id=${siteId}`;
  await sql`DELETE FROM users WHERE id=${ownerId}`;
  await sql`DELETE FROM viewers WHERE id=${viewerId}`;
  await sql.end();
});

describe("abuse signals (postgres)", () => {
  integrationIt("the device upsert increments seen_count and moves last_seen", async () => {
    const device = "b".repeat(64);
    const req = () => new Request("https://site.test/x", { headers: { "cf-connecting-ip": "203.0.113.7", "x-yr-device": device } });
    const run = (text, params = []) => sql.unsafe(text, params);
    await recordAbuseSignals({ run, env, request: req(), viewerId, siteId, action: "checkin" });
    const first = await sql`SELECT first_seen, last_seen, seen_count, device_hash FROM device_links WHERE site_id=${siteId} AND viewer_id=${viewerId}`;
    expect(first).toHaveLength(1);
    expect(first[0].seen_count).toBe(1);
    expect(first[0].device_hash).toBe(await abuseSignalHash(device, env));
    expect(first[0].device_hash).not.toBe(device);
    // A second sighting bumps the count and does not regress last_seen.
    await sql`SELECT pg_sleep(0.05)`;
    await recordAbuseSignals({ run, env, request: req(), viewerId, siteId, action: "checkin" });
    const rows = await sql`SELECT seen_count, first_seen, last_seen FROM device_links WHERE site_id=${siteId} AND viewer_id=${viewerId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].seen_count).toBe(2);
    expect(rows[0].last_seen >= first[0].last_seen).toBe(true);
    expect(rows[0].first_seen).toEqual(first[0].first_seen);
    const ips = await sql`SELECT ip_hash, action FROM ip_observations WHERE site_id=${siteId} AND viewer_id=${viewerId}`;
    expect(ips.length).toBe(2);
    expect(ips.every((r) => r.ip_hash.length === 64 && r.action === "checkin")).toBe(true);
  });

  integrationIt("cleanup deletes only IP observations older than 30 days", async () => {
    const run = (text, params = []) => sql.unsafe(text, params);
    const hash = await abuseSignalHash("203.0.113.8", env);
    await sql`INSERT INTO ip_observations (ip_hash, viewer_id, site_id, action, observed_at)
      VALUES (${hash}, ${viewerId}, ${siteId}, 'drop_claim', now() - interval '31 days'),
             (${hash}, ${viewerId}, ${siteId}, 'drop_claim', now())`;
    await cleanupIpObservations({ run });
    const rows = await sql`SELECT observed_at FROM ip_observations WHERE site_id=${siteId} AND ip_hash=${hash}`;
    expect(rows).toHaveLength(1);
    expect(Date.now() - new Date(rows[0].observed_at).getTime()).toBeLessThan(60_000);
  });

  integrationIt("identity events fire on new links and revokes, not on re-login", async () => {
    const ext1 = `ext-${crypto.randomUUID().slice(0, 8)}`;
    const events = () => sql`SELECT event, external_user_id FROM viewer_identity_events WHERE viewer_id=${viewerId} AND provider='kick' ORDER BY created_at, id`;
    // First link: one 'linked' event.
    await runInTx((run) => persistViewerIdentity(run, identity(ext1), viewerId));
    expect(await events()).toMatchObject([{ event: "linked", external_user_id: ext1 }]);
    // Re-login of the same account: no new event.
    await runInTx((run) => persistViewerIdentity(run, identity(ext1), viewerId));
    expect(await events()).toHaveLength(1);
    // A different external account on the same provider: one more 'linked'.
    const ext2 = `ext-${crypto.randomUUID().slice(0, 8)}`;
    await runInTx((run) => persistViewerIdentity(run, identity(ext2), viewerId));
    expect(await events()).toHaveLength(2);
    // Revoke: one 'revoked' event for the active external id.
    await runInTx((run) => revokeViewerIdentity(run, viewerId, "kick"));
    const rows = await events();
    expect(rows).toHaveLength(3);
    expect(rows.at(-1)).toMatchObject({ event: "revoked", external_user_id: ext2 });
    // Relinking after a revoke counts as a new link again.
    await runInTx((run) => persistViewerIdentity(run, identity(ext2), viewerId));
    expect(await events()).toHaveLength(4);
  });
});
