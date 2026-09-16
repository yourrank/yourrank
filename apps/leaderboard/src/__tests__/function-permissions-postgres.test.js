// ============================================================================
//  C01/F01: privileged SECURITY DEFINER function EXECUTE boundaries against a
//  fully migrated real PostgreSQL.
//
//  After the expand preparation and the separately admitted staged contract
//  migration 20260916000000_restrict_privileged_function_execute.sql:
//   * PUBLIC / anon / authenticated must NOT be able to execute the payout
//     functions place_bet / set_round_outcome / settle_round;
//   * yourrank_app (and yourrank_worker through its role membership) and
//     service_role keep EXECUTE;
//   * the trigger maintainers and the partition helper no longer carry a
//     PUBLIC path;
//   * new functions created by the migration role no longer grant PUBLIC
//     EXECUTE by default (ALTER DEFAULT PRIVILEGES);
//   * a direct anon RPC attempt is rejected by the database itself, while
//     the backend role still reaches the function.
//
//  Role-switch assertions run on dedicated single-connection clients: a
//  pooled SET ROLE can land on a different connection than the probe query.
//
//  Needs a migrated disposable database (FUNC_PERM_TEST_DATABASE_URL, or
//  AUDIT_TEST_DATABASE_URL as fallback); when FUNC_PERM_GATE=required the
//  suite FAILS without one.
// ============================================================================

import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const expandMigration = readFileSync(new URL(
  "../../../../supabase/migrations/20260915000500_prepare_privileged_function_execute.sql",
  import.meta.url,
), "utf8");
const stagedContract = readFileSync(new URL(
  "../../../../supabase/contract-migrations/pending/20260916000000_restrict_privileged_function_execute.sql",
  import.meta.url,
), "utf8");

describe("C01 expand/contract release separation", () => {
  it("keeps the automatic migration additive and the revocations staged", () => {
    expect(expandMigration).toContain("yourrank:migration-phase: expand");
    expect(expandMigration).toContain("GRANT EXECUTE ON FUNCTION public.place_bet");
    expect(expandMigration).not.toMatch(/\bREVOKE\b/);
    expect(stagedContract).toContain("yourrank:migration-phase: contract");
    expect(stagedContract).toContain("REVOKE EXECUTE ON FUNCTION public.place_bet");
    expect(stagedContract).toContain("ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC");
    expect(stagedContract).toContain("yourrank:contract-requires-release: <deployed 40-char commit sha>");
  });
});

const url = process.env.FUNC_PERM_TEST_DATABASE_URL || process.env.AUDIT_TEST_DATABASE_URL || "";
const gateRequired = process.env.FUNC_PERM_GATE === "required";
const integrationIt = (name, fn) => (url ? it : it.skip)(name, fn, 60000);
const sql = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;

if (gateRequired && !url) {
  describe("function permission gate", () => {
    it("FUNC_PERM_GATE=required but no FUNC_PERM_TEST_DATABASE_URL/AUDIT_TEST_DATABASE_URL", () => {
      throw new Error("FUNC_PERM_GATE=required but FUNC_PERM_TEST_DATABASE_URL is not set; refusing to certify");
    });
  });
}

const PAYOUT_FUNCTIONS = [
  "public.place_bet(uuid, uuid, text, integer, jsonb, text)",
  "public.set_round_outcome(uuid, jsonb)",
  "public.settle_round(uuid, numeric, integer, jsonb)",
];

const MAINTAINER_FUNCTIONS = [
  "public.maintain_site_credit_ledger_aggregate()",
  "public.maintain_site_credit_balance_aggregate()",
  "public.maintain_site_redemption_aggregate()",
  "app_private.ensure_clicks_partition(date)",
];

describe("C01 privileged function EXECUTE boundaries (migrated database)", () => {
  integrationIt("harness sanity: has_function_privilege('public', ...) observes a real PUBLIC grant (pg_sleep)", async () => {
    const [row] = await sql`SELECT has_function_privilege('public', 'pg_sleep(double precision)', 'EXECUTE') AS ok`;
    expect(row.ok).toBe(true);
  });

  integrationIt("removes PUBLIC EXECUTE from payout functions", async () => {
    for (const fn of PAYOUT_FUNCTIONS) {
      const [row] = await sql`SELECT has_function_privilege('public', ${fn}, 'EXECUTE') AS ok`;
      expect([fn, row.ok]).toEqual([fn, false]);
    }
  });

  integrationIt("removes anon and authenticated EXECUTE from payout functions", async () => {
    for (const fn of PAYOUT_FUNCTIONS) {
      const [anon] = await sql`SELECT has_function_privilege('anon', ${fn}, 'EXECUTE') AS ok`;
      expect([fn, anon.ok]).toEqual([fn, false]);
      const [auth] = await sql`SELECT has_function_privilege('authenticated', ${fn}, 'EXECUTE') AS ok`;
      expect([fn, auth.ok]).toEqual([fn, false]);
    }
  });

  integrationIt("keeps backend and service-role EXECUTE on payout functions", async () => {
    for (const fn of PAYOUT_FUNCTIONS) {
      const [app] = await sql`SELECT has_function_privilege('yourrank_app', ${fn}, 'EXECUTE') AS ok`;
      expect([fn, app.ok]).toEqual([fn, true]);
      const [worker] = await sql`SELECT has_function_privilege('yourrank_worker', ${fn}, 'EXECUTE') AS ok`;
      expect([fn, worker.ok]).toEqual([fn, true]);
      const [svc] = await sql`SELECT has_function_privilege('service_role', ${fn}, 'EXECUTE') AS ok`;
      expect([fn, svc.ok]).toEqual([fn, true]);
    }
  });

  integrationIt("trigger maintainers and partition helper no longer carry a PUBLIC path", async () => {
    for (const fn of MAINTAINER_FUNCTIONS) {
      const rows = await sql`
        SELECT (aclexplode(coalesce(proacl, acldefault('f', proowner)))).grantee AS grantee
          FROM pg_proc WHERE oid = ${fn}::regprocedure`;
      expect([fn, rows.filter((r) => r.grantee === 0)]).toEqual([fn, []]);
    }
  });

  integrationIt("new functions created by the migration role no longer grant PUBLIC EXECUTE by default", async () => {
    await sql`CREATE FUNCTION public._yr_audit_default_priv_probe() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$`;
    try {
      const [row] = await sql`SELECT has_function_privilege('public', 'public._yr_audit_default_priv_probe()', 'EXECUTE') AS ok`;
      expect(row.ok).toBe(false);
    } finally {
      await sql`DROP FUNCTION public._yr_audit_default_priv_probe()`;
    }
  });

  integrationIt("an anon session cannot invoke place_bet directly", async () => {
    const anon = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await anon`SET ROLE anon`;
      let err = null;
      try {
        await anon`SELECT public.place_bet(gen_random_uuid(), gen_random_uuid(), 'coinflip', 10, '{}'::jsonb, 'perm-regression') AS r`;
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(String((err && err.message) || "")).toMatch(/permission denied/i);
    } finally {
      await anon.end({ timeout: 1 });
    }
  });

  integrationIt("the backend role still reaches place_bet (function-level authorization, not permission denial)", async () => {
    const worker = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await worker`SET ROLE yourrank_worker`;
      const res = await worker`SELECT public.place_bet(gen_random_uuid(), gen_random_uuid(), 'coinflip', 10, '{}'::jsonb, ${"perm-regression-" + crypto.randomUUID()} ) AS r`;
      // EXECUTE succeeded: the function ran and returned its own jsonb
      // application error (unknown site/viewer), not a database rejection.
      expect(res[0].r.ok).toBe(false);
      expect(String(res[0].r.error)).toBeTruthy();
    } finally {
      await worker.end({ timeout: 1 });
    }
  });
});

afterAll(async () => {
  if (sql) await sql.end({ timeout: 1 });
});
