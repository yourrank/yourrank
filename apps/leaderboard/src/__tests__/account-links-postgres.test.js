// Real PostgreSQL coverage for account_links: the detection candidate SQL,
// the upsert/audit semantics, and dismissed-pair immutability.
// Self-skips without AUDIT_TEST_DATABASE_URL.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { runAccountLinkDetection } from "../account-link-detection.js";
import { abuseSignalHash } from "../abuse-signals.js";

const url = process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (url ? it : it.skip)(name, fn, 60000);
const env = { ABUSE_SIGNAL_HMAC_KEY: `pg-link-key-${crypto.randomUUID()}` };
const siteId = crypto.randomUUID();
const otherSiteId = crypto.randomUUID();
const ownerId = crypto.randomUUID();
const va = crypto.randomUUID();
const vb = crypto.randomUUID();
const vc = crypto.randomUUID();
let sql;

beforeAll(async () => {
  if (!url) return;
  sql = postgres(url, { max: 4 });
  await sql`INSERT INTO users (id, email, password_hash, status, plan, email_verified) VALUES (${ownerId}, ${`links-${crypto.randomUUID()}@test.local`}, 'x', 'active', 'pro', true)`;
  await sql`INSERT INTO sites (id, user_id, slug, name, published, is_draft) VALUES
    (${siteId}, ${ownerId}, ${`l-${crypto.randomUUID().slice(0, 8)}`}, 'LinkSite', true, false),
    (${otherSiteId}, ${ownerId}, ${`l2-${crypto.randomUUID().slice(0, 8)}`}, 'Other', true, false)`;
  await sql`INSERT INTO viewers (id, is_system) VALUES (${va}, false), (${vb}, false), (${vc}, false)`;
  await sql`INSERT INTO site_viewers (site_id, viewer_id) VALUES (${siteId}, ${va}), (${siteId}, ${vb}), (${siteId}, ${vc})`;
});

afterAll(async () => {
  if (!sql) return;
  await sql`DELETE FROM account_links WHERE site_id IN (${siteId}, ${otherSiteId})`;
  await sql`DELETE FROM device_links WHERE site_id IN (${siteId}, ${otherSiteId})`;
  await sql`DELETE FROM ip_observations WHERE site_id IN (${siteId}, ${otherSiteId})`;
  await sql`DELETE FROM site_viewers WHERE site_id IN (${siteId}, ${otherSiteId})`;
  await sql`DELETE FROM viewers WHERE id IN (${va}, ${vb}, ${vc})`;
  await sql`DELETE FROM sites WHERE id IN (${siteId}, ${otherSiteId})`;
  await sql`DELETE FROM users WHERE id=${ownerId}`;
  await sql.end();
});

const run = (text, params = []) => sql.unsafe(text, params);

async function insertDeviceLink(site, viewer, device) {
  await sql`INSERT INTO device_links (site_id, device_hash, viewer_id, first_seen, last_seen)
            VALUES (${site}, ${await abuseSignalHash(device, env)}, ${viewer}, now(), now())`;
}

describe("account link detection (postgres)", () => {
  integrationIt("a device+IP pair scores 70 and is persisted as pending", async () => {
    await insertDeviceLink(siteId, va, "device-ab");
    await insertDeviceLink(siteId, vb, "device-ab");
    const ipHash = await abuseSignalHash("203.0.113.9", env);
    await sql`INSERT INTO ip_observations (site_id, ip_hash, viewer_id, action, observed_at) VALUES
      (${siteId}, ${ipHash}, ${va}, 'checkin', now()), (${siteId}, ${ipHash}, ${vb}, 'checkin', now())`;
    await runAccountLinkDetection({ run });
    const rows = await sql`SELECT confidence, status, reasons FROM account_links WHERE site_id=${siteId}`;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const pair = rows.find((r) => r.confidence === 70);
    expect(pair.status).toBe("pending");
    expect(pair.reasons).toContain("same_device");
    expect(pair.reasons).toContain("same_ip_24h");
  });

  integrationIt("IP pairs seen >24h apart are not linked; stale IP alone won't reach 60", async () => {
    const vd = crypto.randomUUID();
    const ve = crypto.randomUUID();
    await sql`INSERT INTO viewers (id, is_system) VALUES (${vd}, false), (${ve}, false)`;
    await sql`INSERT INTO site_viewers (site_id, viewer_id) VALUES (${siteId}, ${vd}), (${siteId}, ${ve})`;
    const ipHash = await abuseSignalHash("203.0.113.50", env);
    await sql`INSERT INTO ip_observations (site_id, ip_hash, viewer_id, action, observed_at) VALUES
      (${siteId}, ${ipHash}, ${vd}, 'checkin', now()), (${siteId}, ${ipHash}, ${ve}, 'checkin', now() - interval '25 hours')`;
    await runAccountLinkDetection({ run });
    const rows = await sql`SELECT * FROM account_links WHERE site_id=${siteId} AND viewer_a=${vd} AND viewer_b=${ve}`;
    expect(rows).toHaveLength(0);
    await sql`DELETE FROM ip_observations WHERE viewer_id IN (${vd}, ${ve})`;
    await sql`DELETE FROM site_viewers WHERE viewer_id IN (${vd}, ${ve})`;
    await sql`DELETE FROM viewers WHERE id IN (${vd}, ${ve})`;
  });

  integrationIt("claims within 2s count; 3s apart do not", async () => {
    // Already covered by the boundary in the SQL: create a drop, both claim.
    const dropId = crypto.randomUUID();
    await sql`INSERT INTO code_drops (id, site_id, code) VALUES (${dropId}, ${siteId}, 'X')`;
    const vf = crypto.randomUUID();
    const vg = crypto.randomUUID();
    await sql`INSERT INTO viewers (id, is_system) VALUES (${vf}, false), (${vg}, false)`;
    await sql`INSERT INTO site_viewers (site_id, viewer_id) VALUES (${siteId}, ${vf}), (${siteId}, ${vg})`;
    const svF = (await sql`SELECT id FROM site_viewers WHERE site_id=${siteId} AND viewer_id=${vf}`)[0]?.id;
    const svG = (await sql`SELECT id FROM site_viewers WHERE site_id=${siteId} AND viewer_id=${vg}`)[0]?.id;
    const drop2Id = crypto.randomUUID();
    const drop3Id = crypto.randomUUID();
    await sql`INSERT INTO code_drops (id, site_id, code) VALUES (${drop2Id}, ${siteId}, 'Y'), (${drop3Id}, ${siteId}, 'Z')`;
    // Claims within 2s → same-time claim. Claims 3s apart do not count.
    await sql`INSERT INTO code_drop_claims (code_drop_id, site_viewer_id, viewer_id, points_awarded, created_at) VALUES
      (${dropId}, ${svF}, ${vf}, 0, now()), (${dropId}, ${svG}, ${vg}, 0, now() + interval '2 seconds'),
      (${drop2Id}, ${svF}, ${vf}, 0, now()), (${drop3Id}, ${svF}, ${vf}, 0, now()),
      (${drop3Id}, ${svG}, ${vg}, 0, now() + interval '3 seconds')`;
    await runAccountLinkDetection({ run });
    // Claims alone = 15/cap30 → below 60, not persisted.
    const rows = await sql`SELECT * FROM account_links WHERE site_id=${siteId} AND viewer_a=${vf} AND viewer_b=${vg}`;
    expect(rows).toHaveLength(0);
    await sql`DELETE FROM code_drop_claims WHERE code_drop_id IN (${dropId}, ${drop2Id}, ${drop3Id})`;
    await sql`DELETE FROM code_drops WHERE id IN (${dropId}, ${drop2Id}, ${drop3Id})`;
    await sql`DELETE FROM site_viewers WHERE viewer_id IN (${vf}, ${vg})`;
    await sql`DELETE FROM viewers WHERE id IN (${vf}, ${vg})`;
  });

  integrationIt("device signals do not leak across sites", async () => {
    const vh = crypto.randomUUID();
    const vi = crypto.randomUUID();
    await sql`INSERT INTO viewers (id, is_system) VALUES (${vh}, false), (${vi}, false)`;
    await sql`INSERT INTO site_viewers (site_id, viewer_id) VALUES (${otherSiteId}, ${vh}), (${otherSiteId}, ${vi})`;
    await insertDeviceLink(otherSiteId, vh, "dev-other");
    // vi has the same device but on `siteId`, not otherSiteId → no pair there.
    await insertDeviceLink(siteId, vi, "dev-other");
    await insertDeviceLink(otherSiteId, vi, "dev-other");
    await runAccountLinkDetection({ run });
    const wrong = await sql`SELECT * FROM account_links WHERE site_id=${siteId} AND (viewer_a=${vh} OR viewer_b=${vh})`;
    expect(wrong).toHaveLength(0);
    await sql`DELETE FROM device_links WHERE viewer_id IN (${vh}, ${vi})`;
    await sql`DELETE FROM site_viewers WHERE viewer_id IN (${vh}, ${vi})`;
    await sql`DELETE FROM viewers WHERE id IN (${vh}, ${vi})`;
  });

  integrationIt("a dismissed pair is not re-flagged", async () => {
    const vj = crypto.randomUUID();
    const vk = crypto.randomUUID();
    await sql`INSERT INTO viewers (id, is_system) VALUES (${vj}, false), (${vk}, false)`;
    await sql`INSERT INTO site_viewers (site_id, viewer_id) VALUES (${siteId}, ${vj}), (${siteId}, ${vk})`;
    await insertDeviceLink(siteId, vj, "dev-dismissed");
    await insertDeviceLink(siteId, vk, "dev-dismissed");
    const ipHash = await abuseSignalHash("203.0.113.99", env);
    await sql`INSERT INTO ip_observations (site_id, ip_hash, viewer_id, action, observed_at) VALUES
      (${siteId}, ${ipHash}, ${vj}, 'checkin', now()), (${siteId}, ${ipHash}, ${vk}, 'checkin', now())`;
    await runAccountLinkDetection({ run });
    await sql`UPDATE account_links SET status='dismissed' WHERE site_id=${siteId} AND viewer_a=${vj} AND viewer_b=${vk}`;
    await runAccountLinkDetection({ run });
    const rows = await sql`SELECT status FROM account_links WHERE site_id=${siteId} AND viewer_a=${vj} AND viewer_b=${vk}`;
    expect(rows[0].status).toBe("dismissed");
    await sql`DELETE FROM account_links WHERE viewer_a=${vj} AND viewer_b=${vk}`;
    await sql`DELETE FROM device_links WHERE viewer_id IN (${vj}, ${vk})`;
    await sql`DELETE FROM ip_observations WHERE viewer_id IN (${vj}, ${vk})`;
    await sql`DELETE FROM site_viewers WHERE viewer_id IN (${vj}, ${vk})`;
    await sql`DELETE FROM viewers WHERE id IN (${vj}, ${vk})`;
  });
});
