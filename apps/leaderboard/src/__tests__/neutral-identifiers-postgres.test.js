import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";

const url = process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (url ? it : it.skip)(name, fn, 60000);
const ownerId = crypto.randomUUID();
const siteId = crypto.randomUUID();
const partnerAId = crypto.randomUUID();
const partnerBId = crypto.randomUUID();
const suffix = crypto.randomUUID();
const siteSlug = `neutral-${suffix}`;
const partnerASlug = `neutral-a-${suffix}`;
const partnerBSlug = `neutral-b-${suffix}`;
let sql;

beforeAll(async () => {
  if (!url) return;
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "postgres"].includes(parsed.hostname) || !/test|e2e/.test(parsed.pathname)) {
    throw new Error("Disposable local database required");
  }
  sql = postgres(url, { max: 3, prepare: false });
  await sql`INSERT INTO users (id, email, status, email_verified, plan)
    VALUES (${ownerId}, ${`${suffix}@neutral.test`}, 'active', true, 'pro')`;
  await sql`INSERT INTO partners (id, slug, name, is_global, created_by)
    VALUES (${partnerAId}, ${partnerASlug}, 'Partner A', false, ${ownerId})
    ON CONFLICT (slug) DO UPDATE SET name = partners.name`;
  await sql`INSERT INTO partners (id, slug, name, is_global, created_by)
    VALUES (${partnerBId}, ${partnerBSlug}, 'Partner B', false, ${ownerId})
    ON CONFLICT (slug) DO UPDATE SET name = partners.name`;
  await sql`INSERT INTO sites (id, user_id, slug, name, published, is_draft, sponsor)
    VALUES (${siteId}, ${ownerId}, ${siteSlug}, 'Identifier Test', true, false, 'Canonical Sponsor')`;
});

afterAll(async () => {
  if (!sql) return;
  await sql`DELETE FROM leads WHERE handle LIKE ${`neutral-${suffix}-%`}`;
  await sql`DELETE FROM sites WHERE user_id = ${ownerId}`;
  await sql`DELETE FROM offers WHERE owner_id = ${ownerId}`;
  await sql`DELETE FROM partners WHERE id = ${partnerAId} OR id = ${partnerBId}`;
  await sql`DELETE FROM users WHERE id = ${ownerId}`;
  await sql.end();
});

describe("neutral identifier migration (PostgreSQL)", () => {
  integrationIt("synchronizes every canonical/legacy column pair on insert and update", async () => {
    const [site] = await sql`SELECT sponsor, casino FROM sites WHERE id = ${siteId}`;
    expect(site).toEqual({ sponsor: "Canonical Sponsor", casino: "Canonical Sponsor" });

    const oldOnlySiteId = crypto.randomUUID();
    const [oldSite] = await sql`
      INSERT INTO sites (id, user_id, slug, name, casino)
      VALUES (${oldOnlySiteId}, ${ownerId}, ${`${siteSlug}-old`}, 'Legacy Site', 'Legacy Sponsor')
      RETURNING sponsor, casino`;
    expect(oldSite).toEqual({ sponsor: "Legacy Sponsor", casino: "Legacy Sponsor" });

    const [canonicalSiteUpdate] = await sql`
      UPDATE sites SET sponsor = 'Updated Sponsor' WHERE id = ${siteId}
      RETURNING sponsor, casino`;
    expect(canonicalSiteUpdate).toEqual({ sponsor: "Updated Sponsor", casino: "Updated Sponsor" });
    const [legacySiteUpdate] = await sql`
      UPDATE sites SET casino = 'Updated Legacy Sponsor' WHERE id = ${siteId}
      RETURNING sponsor, casino`;
    expect(legacySiteUpdate).toEqual({ sponsor: "Updated Legacy Sponsor", casino: "Updated Legacy Sponsor" });

    const canonicalPlayerId = crypto.randomUUID();
    const [canonicalPlayer] = await sql`
      INSERT INTO players (id, site_id, name, normalized_name, amount)
      VALUES (${canonicalPlayerId}, ${siteId}, 'Canonical Player', 'canonical player', 12)
      RETURNING amount, wagered`;
    expect(canonicalPlayer).toEqual({ amount: "12.00", wagered: "12.00" });
    const legacyPlayerId = crypto.randomUUID();
    const [legacyPlayer] = await sql`
      INSERT INTO players (id, site_id, name, normalized_name, wagered)
      VALUES (${legacyPlayerId}, ${siteId}, 'Legacy Player', 'legacy player', 23)
      RETURNING amount, wagered`;
    expect(legacyPlayer).toEqual({ amount: "23.00", wagered: "23.00" });
    const [canonicalPlayerUpdate] = await sql`
      UPDATE players SET amount = 34 WHERE id = ${canonicalPlayerId}
      RETURNING amount, wagered`;
    expect(canonicalPlayerUpdate).toEqual({ amount: "34.00", wagered: "34.00" });
    const [legacyPlayerUpdate] = await sql`
      UPDATE players SET wagered = 45 WHERE id = ${canonicalPlayerId}
      RETURNING amount, wagered`;
    expect(legacyPlayerUpdate).toEqual({ amount: "45.00", wagered: "45.00" });

    const [canonicalLead] = await sql`
      INSERT INTO leads (handle, brand)
      VALUES (${`neutral-${suffix}-brand`}, 'Canonical Brand')
      RETURNING brand, casino`;
    expect(canonicalLead).toEqual({ brand: "Canonical Brand", casino: "Canonical Brand" });
    const [legacyLead] = await sql`
      INSERT INTO leads (handle, casino)
      VALUES (${`neutral-${suffix}-old-brand`}, 'Legacy Brand')
      RETURNING brand, casino`;
    expect(legacyLead).toEqual({ brand: "Legacy Brand", casino: "Legacy Brand" });
    const [canonicalLeadUpdate] = await sql`
      UPDATE leads SET brand = 'Updated Brand' WHERE handle = ${`neutral-${suffix}-brand`}
      RETURNING brand, casino`;
    expect(canonicalLeadUpdate).toEqual({ brand: "Updated Brand", casino: "Updated Brand" });
    const [legacyLeadUpdate] = await sql`
      UPDATE leads SET casino = 'Updated Legacy Brand' WHERE handle = ${`neutral-${suffix}-brand`}
      RETURNING brand, casino`;
    expect(legacyLeadUpdate).toEqual({ brand: "Updated Legacy Brand", casino: "Updated Legacy Brand" });

    const canonicalOfferId = crypto.randomUUID();
    const [canonicalOffer] = await sql`
      INSERT INTO offers (id, owner_id, partner_id, label, referral_url)
      VALUES (${canonicalOfferId}, ${ownerId}, ${partnerAId}, 'Canonical Offer', 'https://example.test/canonical')
      RETURNING partner_id, casino_id`;
    expect(canonicalOffer).toEqual({ partner_id: partnerAId, casino_id: partnerAId });
    const legacyOfferId = crypto.randomUUID();
    const [legacyOffer] = await sql`
      INSERT INTO offers (id, owner_id, casino_id, label, referral_url)
      VALUES (${legacyOfferId}, ${ownerId}, ${partnerAId}, 'Legacy Offer', 'https://example.test/legacy')
      RETURNING partner_id, casino_id`;
    expect(legacyOffer).toEqual({ partner_id: partnerAId, casino_id: partnerAId });
    const [canonicalOfferUpdate] = await sql`
      UPDATE offers SET partner_id = ${partnerBId} WHERE id = ${canonicalOfferId}
      RETURNING partner_id, casino_id`;
    expect(canonicalOfferUpdate).toEqual({ partner_id: partnerBId, casino_id: partnerBId });
    const [legacyOfferUpdate] = await sql`
      UPDATE offers SET casino_id = ${partnerAId} WHERE id = ${canonicalOfferId}
      RETURNING partner_id, casino_id`;
    expect(legacyOfferUpdate).toEqual({ partner_id: partnerAId, casino_id: partnerAId });
  });

  integrationIt("supports partner view insert/upsert and denies anon/authenticated access", async () => {
    const [first] = await sql`
      INSERT INTO partners (slug, name, created_by)
      VALUES (${partnerASlug}, 'Ignored Partner Name', ${ownerId})
      ON CONFLICT (slug) DO UPDATE SET name = partners.name
      RETURNING id, name`;
    expect(first.id).toBe(partnerAId);
    expect(first.name).toBe("Partner A");

    const [view] = await sql`
      SELECT reloptions FROM pg_class WHERE oid = 'public.partners'::regclass`;
    expect(view.reloptions).toContain("security_invoker=true");

    const access = await sql`
      SELECT rolname,
        has_table_privilege(rolname, 'public.partners', 'SELECT') AS can_select,
        has_table_privilege(rolname, 'public.partners', 'INSERT') AS can_insert,
        has_table_privilege(rolname, 'public.partners', 'UPDATE') AS can_update,
        has_table_privilege(rolname, 'public.partners', 'DELETE') AS can_delete
      FROM pg_roles
      WHERE rolname IN ('service_role', 'anon', 'authenticated')`;
    const byRole = Object.fromEntries(access.map((role) => [role.rolname, role]));
    expect(Object.keys(byRole).sort()).toEqual(["anon", "authenticated", "service_role"]);
    expect(byRole.service_role).toMatchObject({ can_select: true, can_insert: true, can_update: true, can_delete: true });
    for (const role of ["anon", "authenticated"]) {
      expect(byRole[role]).toMatchObject({ can_select: false, can_insert: false, can_update: false, can_delete: false });
      const connection = await sql.reserve();
      try {
        await connection.unsafe(`SET ROLE ${role}`);
        let accessError;
        try {
          await connection.unsafe("SELECT id FROM public.partners LIMIT 1");
        } catch (error) {
          accessError = error;
        }
        expect(accessError?.message).toMatch(/permission denied/i);
      } finally {
        await connection.unsafe("RESET ROLE");
        await connection.release();
      }
    }

    const [appRole] = await sql`
      SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yourrank_app') AS present`;
    if (appRole.present) {
      const [appPrivileges] = await sql`
        SELECT
          has_table_privilege('yourrank_app', 'public.partners', 'SELECT') AS can_select,
          has_table_privilege('yourrank_app', 'public.partners', 'INSERT') AS can_insert,
          has_table_privilege('yourrank_app', 'public.partners', 'UPDATE') AS can_update`;
      expect(appPrivileges).toEqual({ can_select: true, can_insert: true, can_update: true });

      const rollbackSignal = new Error("rollback yourrank_app partner privileges test");
      try {
        await sql.begin(async (transaction) => {
          await transaction.unsafe("SET LOCAL ROLE yourrank_app");
          const [visible] = await transaction`
            SELECT id FROM public.partners WHERE slug = ${partnerASlug}`;
          expect(visible.id).toBe(partnerAId);
          const [upserted] = await transaction`
            INSERT INTO public.partners (slug, name, created_by)
            VALUES (${partnerASlug}, 'Ignored Partner Name', ${ownerId})
            ON CONFLICT (slug) DO UPDATE SET name = partners.name
            RETURNING id, name`;
          expect(upserted).toEqual({ id: partnerAId, name: "Partner A" });
          throw rollbackSignal;
        });
      } catch (error) {
        if (error !== rollbackSignal) throw error;
      }
    }
  });
});
