import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(repoRoot, "release/n1-production-baseline.json"), "utf8"));
const databaseUrl = process.env.N1_DATABASE_URL || process.env.DATABASE_URL;
const bunBin = process.env.BUN_BIN || "bun";
const coherentRoot = resolve(repoRoot, process.env.N1_COHERENT_ROOT || ".n1/coherent");
const leaderboardRoot = resolve(repoRoot, process.env.N1_LEADERBOARD_ROOT || ".n1/leaderboard");
const contractScript = resolve(repoRoot, "scripts/n1-worker-contract.ts");

function fail(message) {
  console.error(`::error::F-004 N-1 compatibility: ${message}`);
  process.exit(1);
}

if (!databaseUrl) fail("N1_DATABASE_URL (or DATABASE_URL) is required");
const parsedDatabaseUrl = new URL(databaseUrl);
const localHosts = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
if (!localHosts.has(parsedDatabaseUrl.hostname) || !/(test|n1|e2e)/i.test(parsedDatabaseUrl.pathname)) {
  fail(`refusing non-local or non-test database ${parsedDatabaseUrl.hostname}${parsedDatabaseUrl.pathname}`);
}

const shaPattern = /^[0-9a-f]{40}$/;
if (!shaPattern.test(manifest.coherentRollbackSourceSha)) fail("invalid coherent rollback SHA in baseline manifest");
if (!shaPattern.test(manifest.workers.leaderboard.liveSourceSha)) fail("invalid live Leaderboard SHA in baseline manifest");
for (const workerName of ["leaderboard", "bot", "consumer", "monitor"]) {
  const worker = manifest.workers[workerName];
  if (!worker || !shaPattern.test(worker.liveSourceSha) || !shaPattern.test(worker.rollbackSourceSha)) {
    fail(`invalid ${workerName} production source evidence in baseline manifest`);
  }
  if (worker.rollbackSourceSha !== manifest.coherentRollbackSourceSha) {
    fail(`${workerName} rollback SHA is not the captured coherent rollback release`);
  }
}
for (const workerName of ["bot", "consumer", "monitor"]) {
  if (manifest.workers[workerName].liveSourceSha !== manifest.coherentRollbackSourceSha) {
    fail(`${workerName} needs its own exact live-source checkout and contract run`);
  }
}

function verifyCheckout(root, expectedSha, label) {
  const result = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (result.status !== 0) fail(`${label} checkout missing at ${root}`);
  const actual = result.stdout.trim();
  if (actual !== expectedSha) fail(`${label} checkout is ${actual}; expected ${expectedSha}`);
}

verifyCheckout(coherentRoot, manifest.coherentRollbackSourceSha, "coherent N-1");
verifyCheckout(leaderboardRoot, manifest.workers.leaderboard.liveSourceSha, "live Leaderboard N-1");

const migrationsDir = resolve(repoRoot, "supabase/migrations");
const migrations = readdirSync(migrationsDir)
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .sort();
const baselineThrough = manifest.schema.baselineThrough;
const baselineMigrations = migrations.filter((name) => name.slice(0, 14) <= baselineThrough);
const expandMigrations = migrations.filter((name) => name.slice(0, 14) > baselineThrough);

if (!baselineMigrations.length) fail(`no migrations found through ${baselineThrough}`);
if (!expandMigrations.includes(manifest.schema.firstExpandMigration)) {
  fail(`first expand migration ${manifest.schema.firstExpandMigration} is missing`);
}

function runPsql(sqlText, label) {
  const dockerContainer = process.env.N1_POSTGRES_CONTAINER;
  const command = dockerContainer ? (process.env.DOCKER_BIN || "docker") : (process.env.PSQL_BIN || "psql");
  const args = dockerContainer
    ? ["exec", "-i", dockerContainer, "psql", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "--dbname", databaseUrl]
    : ["--no-psqlrc", "-v", "ON_ERROR_STOP=1", "--dbname", databaseUrl];
  const result = spawnSync(command, args, { input: sqlText, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] });
  if (result.error) fail(`${label}: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} failed with exit code ${result.status}`);
}

function applyMigrations(names, stage) {
  for (const name of names) {
    console.log(`[F-004] ${stage}: ${name}`);
    runPsql(readFileSync(resolve(migrationsDir, name), "utf8"), `${stage} ${name}`);
  }
}

function runContract(label, sourceRoot, components, phase) {
  console.log(`\n[F-004] ${label}`);
  const result = spawnSync(bunBin, ["run", contractScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      N1_SOURCE_ROOT: sourceRoot,
      N1_COMPONENTS: components.join(","),
      N1_PHASE: phase,
      TOKEN_ENC_KEY: "0".repeat(64),
      IP_HASH_SALT: "f004-n1-local-only",
    },
    stdio: "inherit",
  });
  if (result.error) fail(`${label}: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} failed with exit code ${result.status}`);
}

runPsql(
  "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public') THEN RAISE EXCEPTION 'database is not empty'; END IF; END $$;",
  "empty database precondition",
);
applyMigrations(baselineMigrations, "baseline schema");
runContract("baseline DB + coherent N-1 Workers", coherentRoot, ["leaderboard", "bot", "consumer", "monitor"], "baseline");

applyMigrations(expandMigrations, "expanded schema");
runContract("NEW DB + rollback N-1 Workers", coherentRoot, ["leaderboard", "bot", "consumer", "monitor"], "expanded-rollback");
runContract("NEW DB + actual live N-1 Leaderboard", leaderboardRoot, ["leaderboard"], "expanded-live-leaderboard");
runContract("NEW DB + actual live N-1 Bot/Consumer", coherentRoot, ["bot", "consumer", "monitor"], "expanded-live-services");
runContract("current DB + current Workers", repoRoot, ["leaderboard", "bot", "consumer", "monitor"], "current");
runContract("rollback to coherent N-1 with migrations retained", coherentRoot, ["leaderboard", "bot", "consumer", "monitor"], "rollback-after-current");

console.log(`\n[F-004] PASS: ${baselineMigrations.length} baseline and ${expandMigrations.length} post-baseline migration(s) preserved all tested Worker contracts.`);
