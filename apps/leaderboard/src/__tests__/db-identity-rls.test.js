// F-039 / F-044: one coherent backend database identity (LOGIN role inheriting the
// yourrank_app group, explicit RLS policies for that group, public roles untouched)
// delivered as an expand-safe migration with a fail-closed certification gate.
//
// The behavioural matrix itself (real PostgreSQL: connection identity, RLS-protected
// backend operations, anon/authenticated isolation, old-identity rollback) runs in
// `scripts/verify-db-identity.mjs certify` inside the Migration Dry-Run job. This
// suite proves the static contract around it: the migration is classified and
// scoped correctly, the gate cannot be skipped, and every release path runs it.
import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateExpandMigration, migrationPhase } from "../../../../scripts/check-migration-compatibility.mjs";

const root = new URL("../../../../", import.meta.url);
const rootFile = (path) => readFile(new URL(path, root), "utf8");
const MIGRATION = "supabase/migrations/20260908000000_worker_login_role_rls.sql";
const SCRIPT = fileURLToPath(new URL("scripts/verify-db-identity.mjs", root));

const runGate = (args, env = {}) =>
  spawnSync("node", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });

describe("F-039/F-044 migration classification", () => {
  it("is an expand-phase migration accepted by the automatic release gate", async () => {
    const source = await rootFile(MIGRATION);
    expect(migrationPhase(source)).toBe("expand");
    expect(() => validateExpandMigration({ name: MIGRATION, source })).not.toThrow();
  });

  it("does not revoke or disable anything (old identity survives rollback)", async () => {
    const sql = (await rootFile(MIGRATION)).replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/\bREVOKE\b/i);
    expect(sql).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(sql).not.toMatch(/\bDROP\s+(?:ROLE|POLICY|TABLE)\b/i);
    expect(sql).not.toMatch(/\bNOLOGIN\b[^;]*yourrank_app|ALTER\s+ROLE\s+yourrank_app\b[^;]*\bLOGIN\b/i);
  });

  it("creates a dedicated non-superuser, non-BYPASSRLS LOGIN role that inherits yourrank_app", async () => {
    const sql = await rootFile(MIGRATION);
    expect(sql).toMatch(/CREATE ROLE yourrank_worker\s+LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT/);
    expect(sql).toMatch(/ALTER ROLE yourrank_worker NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT/);
    expect(sql).toContain("GRANT yourrank_app TO yourrank_worker;");
    expect(sql.replace(/--[^\n]*/g, "")).not.toMatch(/PASSWORD/i);
  });

  it("targets RLS policies only at the yourrank_app group and grants nothing to public roles", async () => {
    const sql = (await rootFile(MIGRATION)).replace(/--[^\n]*/g, "");
    expect(sql).toMatch(/CREATE POLICY %I ON public\.%I FOR ALL TO yourrank_app USING \(true\) WITH CHECK \(true\)/);
    expect(sql).not.toMatch(/\bTO\s+(?:anon|authenticated|public)\b/i);
    expect(sql).not.toMatch(/GRANT[^;]*\b(?:anon|authenticated)\b/i);
  });

  it("keeps the partition helper out of reach of anon/authenticated via a private schema", async () => {
    const sql = await rootFile(MIGRATION);
    expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS app_private;");
    expect(sql).toContain("GRANT USAGE ON SCHEMA app_private TO yourrank_app;");
    expect(sql).toMatch(/CREATE FUNCTION app_private\.ensure_clicks_partition\(month_start date\)[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/);
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION app_private.ensure_clicks_partition(date) TO yourrank_app;");
  });

  it("bot partition maintenance no longer needs table ownership on the Worker login", async () => {
    const rollup = await rootFile("apps/bot/src/rollup.ts");
    expect(rollup).toContain("SELECT app_private.ensure_clicks_partition($1::date)");
    expect(rollup).not.toMatch(/CREATE TABLE IF NOT EXISTS \$\{name\} PARTITION OF clicks/);
    expect(rollup).toContain("pg_has_role(current_user, pg_class.relowner, 'USAGE')");
  });
});

describe("F-039/F-044 certification gate cannot silently pass", () => {
  it("certify fails closed without a database", () => {
    const result = runGate(["certify"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NOT CERTIFIED");
    expect(result.stderr).toContain("DB_IDENTITY_TEST_DATABASE_URL");
  });

  it("readiness fails closed without the Worker credential and refuses forbidden logins", () => {
    const missing = runGate(["readiness"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("WORKER_DATABASE_URL is required");

    const superuser = runGate(["readiness"], { WORKER_DATABASE_URL: "postgres://postgres:x@127.0.0.1:1/db" });
    expect(superuser.status).toBe(1);
    expect(superuser.stderr).toContain("forbidden login postgres");
    expect(superuser.stderr).not.toContain(":x@");
  });

  it("unknown modes are rejected", () => {
    expect(runGate(["skip"]).status).toBe(1);
    expect(runGate(["health", "prod"]).status).toBe(1);
  });

  it("health mode certifies only the expected non-superuser member of yourrank_app", () => {
    const good = { db: true, db_identity: { expected: true, superuser: false, bypassrls: false, app_member: true } };
    expect(runGate(["health", "staging"], { HEALTH_BODY: JSON.stringify(good) }).status).toBe(0);
    for (const bad of [
      { ...good.db_identity, expected: false },
      { ...good.db_identity, superuser: true },
      { ...good.db_identity, bypassrls: true },
      { ...good.db_identity, app_member: false },
    ]) {
      const result = runGate(["health", "staging"], { HEALTH_BODY: JSON.stringify({ db: true, db_identity: bad }) });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("NOT CERTIFIED");
    }
    expect(runGate(["health", "staging"], { HEALTH_BODY: JSON.stringify({ db: true }) }).status).toBe(1);
    expect(runGate(["health", "staging"], { HEALTH_BODY: "" }).status).toBe(1);
    expect(runGate(["health", "staging"], { HEALTH_BODY: "not json" }).status).toBe(1);
  });

  it("production identity is an explicit, documented PENDING warning until the Hyperdrive switch", async () => {
    const config = JSON.parse(await rootFile("release/db-identity.json"));
    expect(config.expectedRole).toBe("yourrank_worker");
    expect(config.environments.staging.enforce).toBe(true);
    expect(typeof config.environments.production.enforce).toBe("boolean");
    if (!config.environments.production.enforce) {
      expect(config.environments.production.reason.length).toBeGreaterThan(40);
    }
    const pending = runGate(["health", "production"], { HEALTH_BODY: JSON.stringify({ db: true }) });
    expect(pending.status).toBe(config.environments.production.enforce ? 1 : 0);
    expect(pending.stdout + pending.stderr).toMatch(/PENDING|NOT CERTIFIED/);
    expect(pending.stdout + pending.stderr).not.toContain("PASS");
  });
});

describe("F-039/F-044 release wiring", () => {
  it("every Postgres-backed release path runs the certification on the expanded schema", async () => {
    for (const workflow of [".github/workflows/pr-check.yml", ".github/workflows/deploy.yml", ".github/workflows/staging.yml"]) {
      const source = await rootFile(workflow);
      expect(source).toContain("node scripts/verify-db-identity.mjs certify");
      expect(source).toMatch(/DB_IDENTITY_TEST_DATABASE_URL: postgres:\/\/postgres:test@localhost:5432\/yourrank_(?:n1_)?test/);
    }
  });

  it("deploy and staging readiness apply the Hyperdrive identity gate from release/db-identity.json", async () => {
    const deploy = await rootFile(".github/workflows/deploy.yml");
    const staging = await rootFile(".github/workflows/staging.yml");
    expect(deploy).toContain("node scripts/verify-db-identity.mjs health production");
    expect(staging).toContain("node scripts/verify-db-identity.mjs health staging");
    expect(deploy).not.toContain("verify-db-identity.mjs health staging");
    expect(staging).not.toContain("verify-db-identity.mjs health production");
  });

  it("leaderboard /health exposes the effective DB identity as booleans only", async () => {
    const index = await rootFile("apps/leaderboard/src/index.js");
    expect(index).toContain("result.db_identity = identity");
    expect(index).toMatch(/current_user = \$1 AS expected, r\.rolsuper AS superuser, r\.rolbypassrls AS bypassrls, pg_has_role\(current_user, 'yourrank_app', 'USAGE'\) AS app_member/);
    expect(index).not.toMatch(/db_identity[^\n]*current_user AS role/);
  });

  it("no workflow or config feeds a superuser connection string to the Workers", async () => {
    for (const path of ["DEPLOY.md", "apps/leaderboard/STAGING.md"]) {
      const source = await rootFile(path);
      expect(source).not.toMatch(/hyperdrive (?:create|update)[^\n]*\n?[^\n]*postgresql:\/\/postgres[.:]/);
      expect(source).toContain("yourrank_worker");
    }
  });
});
