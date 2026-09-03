// F-009: destructive/contract migrations must never run in the automatic
// production release; CONTRACT is a later, manual, gated action.
import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  assertBaselineApplied,
  migrationPhase,
  validateContractRelease,
  validateExpandMigration,
  validateMigrationCompatibility,
} from "../../../../scripts/check-migration-compatibility.mjs";
import { buildRecoveryPlan } from "../../../../scripts/release-recovery-state.mjs";

const rootFile = (path) => readFile(new URL(`../../../../${path}`, import.meta.url), "utf8");

const EXPAND = "-- yourrank:migration-phase: expand\n";
const RELEASE_SHA = "5fdcc1d005db05105b7ec645972eb6799af97d69";
const OLD_SHA = "d36b6253230e6dad3a535feacc02845e0463f52b";
const CONTRACT = `-- yourrank:migration-phase: contract\n-- yourrank:contract-requires-release: ${RELEASE_SHA}\nALTER TABLE sites DROP COLUMN legacy_slug;\n`;

const policy = { appliedThrough: "20260907000000", historicalCount: 1 };
const baselineFile = { name: "20260907000000_baseline.sql", version: "20260907000000", source: `${EXPAND}SELECT 1;` };
const contractFile = { name: "20260908000000_drop_legacy_slug.sql", version: "20260908000000", source: CONTRACT };
const allWorkers = (sha) => ({ leaderboard: sha, bot: sha, consumer: sha, monitor: sha, web: sha });
const confirmations = (name = contractFile.name) => ({
  backfill_complete: true,
  rollback_window_closed: true,
  data_validation_passed: true,
  confirm: `CONTRACT ${name}`,
});

const expand = (sql, name = "20260908000000_change.sql") => () => validateExpandMigration({ name, source: `${EXPAND}${sql}` });

describe("F-009 contract migration safety", () => {
  it("allows additive expand migrations, new tables and non-unique indexes", () => {
    expect(expand("ALTER TABLE sites ADD COLUMN plan_next text;")).not.toThrow();
    expect(expand("ALTER TABLE sites ADD COLUMN plan_next text NOT NULL DEFAULT 'free';", "x.sql")).toThrow("ADD COLUMN NOT NULL");
    expect(expand("CREATE TABLE IF NOT EXISTS site_flags (site_id uuid, flag text);")).not.toThrow();
    expect(expand("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clicks_day ON clicks (day);")).not.toThrow();
    expect(expand("ALTER TYPE plan_tier ADD VALUE IF NOT EXISTS 'team';")).not.toThrow();
    expect(expand("UPDATE sites SET plan_next = plan::text WHERE plan_next IS NULL;")).not.toThrow();
  });

  it("blocks DROP column/table, incompatible renames and unsafe NOT NULL from the automatic release", () => {
    expect(expand("ALTER TABLE sites DROP COLUMN slug;")).toThrow("DROP object");
    expect(expand("DROP TABLE public.payments;")).toThrow("DROP object");
    expect(expand("ALTER TABLE sites RENAME COLUMN slug TO handle;")).toThrow("RENAME object");
    expect(expand("ALTER TABLE sites RENAME TO communities;")).toThrow("RENAME object");
    expect(expand("ALTER TABLE sites ALTER COLUMN owner_id SET NOT NULL;")).toThrow("SET NOT NULL");
    expect(expand("ALTER TABLE sites ALTER COLUMN plan DROP DEFAULT;")).toThrow("DROP DEFAULT");
    expect(expand("ALTER TABLE sites SET SCHEMA archive;")).toThrow("SET SCHEMA");
  });

  it("blocks enum/status replacement, function-signature and RLS/privilege changes that break N-1", () => {
    expect(expand("ALTER TYPE plan_tier RENAME VALUE 'starter' TO 'free';")).toThrow("RENAME object");
    expect(expand("DROP TYPE public.plan_tier;")).toThrow("DROP object");
    expect(expand("ALTER TABLE users ALTER COLUMN plan TYPE plan_tier_next USING plan::text::plan_tier_next;")).toThrow("ALTER COLUMN TYPE");
    expect(expand("CREATE OR REPLACE FUNCTION rank_for(site uuid, player uuid) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;")).toThrow("replace callable");
    expect(expand("ALTER FUNCTION rank_for(uuid) SECURITY DEFINER;")).toThrow("ALTER callable contract");
    expect(expand("ALTER POLICY sites_read ON sites USING (owner_id = auth.uid());")).toThrow("ALTER POLICY");
    expect(expand("ALTER TABLE sites ENABLE ROW LEVEL SECURITY;")).toThrow("ROW LEVEL SECURITY");
    expect(expand("REVOKE SELECT ON sites FROM anon;")).toThrow("REVOKE");
    expect(expand("CREATE OR REPLACE TRIGGER trg BEFORE INSERT ON sites FOR EACH ROW EXECUTE FUNCTION f();")).toThrow("replace trigger");
  });

  it("would have rejected the historical billing enum replacement from an initial automatic rollout", async () => {
    const billing = await rootFile("supabase/migrations/20260904000000_billing_free_pro_team.sql");
    expect(() => validateExpandMigration({ name: "20260904000000_billing_free_pro_team.sql", source: `${EXPAND}${billing}` }))
      .toThrow(/DROP DEFAULT|ALTER COLUMN TYPE|DROP object/);
  });

  it("blocks an explicitly marked contract migration from the normal deploy, even if its SQL looks harmless", () => {
    expect(migrationPhase(CONTRACT)).toBe("contract");
    expect(() => validateExpandMigration({
      name: contractFile.name,
      source: "-- yourrank:migration-phase: contract\nALTER TABLE sites ADD COLUMN harmless text;",
    })).toThrow("never run in the automatic production release");
    expect(() => validateExpandMigration({ name: "x.sql", source: "-- yourrank:migration-phase: contract\n-- yourrank:migration-phase: expand\nSELECT 1;" }))
      .toThrow("never run in the automatic production release");
  });

  it("refuses to advance the immutable baseline past what production has recorded", () => {
    const migrations = [baselineFile, contractFile];
    expect(() => assertBaselineApplied({ policy: { appliedThrough: "20260908000000" }, migrations, appliedVersions: ["20260907000000"] }))
      .toThrow("ahead of production");
    expect(() => assertBaselineApplied({ policy, migrations, appliedVersions: ["20260907000000"] })).not.toThrow();
  });

  it("the committed migration history passes the expand-only policy", async () => {
    const result = await validateMigrationCompatibility();
    expect(result.appliedThrough).toBe("20260907000000");
    expect(result.historicalCount).toBe(126);
  });

  it("contract gate admits only when every Worker serves the required release exclusively and all confirmations are explicit", () => {
    const base = { policy, migrations: [baselineFile, contractFile], migrationName: contractFile.name, appliedVersions: ["20260907000000"] };

    expect(validateContractRelease({ ...base, workerSourceShas: allWorkers(RELEASE_SHA), confirmations: confirmations() }))
      .toEqual({ migrationName: contractFile.name, version: "20260908000000", requiresRelease: RELEASE_SHA });

    // rollback / N-1 window still open: one Worker is old, or mixed allocation (sourceSha null)
    expect(() => validateContractRelease({ ...base, workerSourceShas: { ...allWorkers(RELEASE_SHA), bot: OLD_SHA }, confirmations: confirmations() }))
      .toThrow("rollback/N-1 window is still open");
    expect(() => validateContractRelease({ ...base, workerSourceShas: { ...allWorkers(RELEASE_SHA), web: null }, confirmations: confirmations() }))
      .toThrow("web=unknown/mixed");

    for (const key of ["backfill_complete", "rollback_window_closed", "data_validation_passed"]) {
      expect(() => validateContractRelease({ ...base, workerSourceShas: allWorkers(RELEASE_SHA), confirmations: { ...confirmations(), [key]: false } }))
        .toThrow(`'${key}=true'`);
    }
    expect(() => validateContractRelease({ ...base, workerSourceShas: allWorkers(RELEASE_SHA), confirmations: { ...confirmations(), confirm: "yes" } }))
      .toThrow("requires typing");

    // expand-phase file cannot be pushed through the contract path, nor alongside a contract file
    const expandFile = { name: "20260908000000_expand.sql", version: "20260908000000", source: `${EXPAND}SELECT 1;` };
    expect(() => validateContractRelease({ ...base, migrations: [baselineFile, expandFile], migrationName: expandFile.name, workerSourceShas: allWorkers(RELEASE_SHA), confirmations: confirmations(expandFile.name) }))
      .toThrow("must declare '-- yourrank:migration-phase: contract'");
    const secondExpand = { name: "20260909000000_more.sql", version: "20260909000000", source: `${EXPAND}SELECT 1;` };
    expect(() => validateContractRelease({ ...base, migrations: [baselineFile, contractFile, secondExpand], workerSourceShas: allWorkers(RELEASE_SHA), confirmations: confirmations() }))
      .toThrow("exactly one pending migration");
    const unpinned = { ...contractFile, source: "-- yourrank:migration-phase: contract\nDROP TABLE x;" };
    expect(() => validateContractRelease({ ...base, migrations: [baselineFile, unpinned], workerSourceShas: allWorkers(RELEASE_SHA), confirmations: confirmations() }))
      .toThrow("contract-requires-release");
  });

  it("recovery to N-1 keeps expand migrations applied and never removes them", () => {
    const state = (migrations, sha) => ({
      schemaVersion: 1,
      migrations: migrations.map((version) => ({ version, name: version })),
      workers: Object.fromEntries(["leaderboard", "bot", "consumer", "monitor", "web"].map((key) => [key, { scriptName: key, versions: [{ versionId: sha, percentage: 100 }] }])),
    });
    const plan = buildRecoveryPlan({
      baseline: state(["20260907000000"], "old"),
      current: state(["20260907000000", "20260908000000"], "new"),
      stages: { migrate: "success", "deploy-leaderboard": "failure" },
    });
    expect(plan.releaseFailed).toBe(true);
    expect(plan.migrationsAdded.map(({ version }) => version)).toEqual(["20260908000000"]);
    expect(plan.migrationsMissing).toEqual([]);
    expect(plan.restoreTargets).toEqual(["leaderboard", "bot", "consumer", "monitor", "web"]);
  });

  it("contract migrations cannot run by pushing to main; only the manual gated workflow may apply them", async () => {
    const deploy = await rootFile(".github/workflows/deploy.yml");
    const contract = await rootFile(".github/workflows/contract-migration.yml");

    expect(deploy).toContain("node scripts/check-migration-compatibility.mjs\n");
    expect(deploy).toContain("node scripts/check-migration-compatibility.mjs baseline-applied");
    expect(deploy).not.toContain("contract-gate");
    expect(deploy).toMatch(/migrate:\n\s+needs: \[capture-release-state, n1-compatibility\]/);

    expect(contract).toMatch(/^on:\n\s+workflow_dispatch:/m);
    expect(contract).not.toMatch(/^\s+push:/m);
    expect(contract).toContain("group: production-mutation");
    expect(contract).toContain("environment: production");
    expect(contract).toContain("node scripts/check-migration-compatibility.mjs contract-gate");
    expect(contract).toMatch(/apply-contract:\n\s+name: [^\n]+\n\s+needs: contract-gate/);
    for (const input of ["backfill_complete", "rollback_window_closed", "data_validation_passed", "confirm"]) {
      expect(contract).toContain(`${input}:`);
    }
    expect(contract).not.toMatch(/supabase\s+(?:db reset|migration down)/);
  });
});
