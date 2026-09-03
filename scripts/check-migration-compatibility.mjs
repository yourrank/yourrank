import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RELEASE_WORKERS, versionSourceSha } from "./release-recovery-state.mjs";

const DEFAULT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MIGRATION_NAME = /^(\d{14})_(.+)\.sql$/;
const PHASE_MARKER = /^\s*--\s*yourrank:migration-phase:\s*expand\s*$/im;
const CONTRACT_PHASE_MARKER = /^\s*--\s*yourrank:migration-phase:\s*contract\s*$/im;
const CONTRACT_REQUIRES_RELEASE = /^\s*--\s*yourrank:contract-requires-release:\s*([0-9a-f]{40})\s*$/im;

const CONTRACT_PATTERNS = Object.freeze([
  { label: "DROP object", pattern: /\bDROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA|VIEW|MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE|TRIGGER|POLICY|EXTENSION|SEQUENCE|DOMAIN)\b/i },
  { label: "RENAME object", pattern: /\bALTER\s+(?:TABLE|TYPE|VIEW)\b[^;]*\bRENAME\b/i },
  { label: "ALTER COLUMN TYPE", pattern: /\bALTER\s+TABLE\b[^;]*\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i },
  { label: "SET NOT NULL", pattern: /\bALTER\s+TABLE\b[^;]*\bALTER\s+COLUMN\b[^;]*\bSET\s+NOT\s+NULL\b/i },
  { label: "ADD COLUMN NOT NULL", pattern: /\bALTER\s+TABLE\b[^;]*\bADD\s+(?:COLUMN\s+)?[^;]*\bNOT\s+NULL\b/i },
  { label: "DROP DEFAULT", pattern: /\bALTER\s+TABLE\b[^;]*\bALTER\s+COLUMN\b[^;]*\bDROP\s+DEFAULT\b/i },
  { label: "SET SCHEMA", pattern: /\bALTER\s+(?:TABLE|TYPE|VIEW|FUNCTION|PROCEDURE|SEQUENCE)\b[^;]*\bSET\s+SCHEMA\b/i },
  { label: "ALTER callable contract", pattern: /\bALTER\s+(?:FUNCTION|PROCEDURE)\b/i },
  { label: "ALTER POLICY", pattern: /\bALTER\s+POLICY\b/i },
  { label: "ENABLE/FORCE ROW LEVEL SECURITY", pattern: /\bALTER\s+TABLE\b[^;]*\b(?:ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY\b/i },
  { label: "replace trigger", pattern: /\bCREATE\s+OR\s+REPLACE\s+TRIGGER\b/i },
  { label: "ADD CONSTRAINT", pattern: /\bALTER\s+TABLE\b[^;]*\bADD\s+(?:CONSTRAINT\s+\S+\s+)?(?:CHECK|FOREIGN\s+KEY|UNIQUE|PRIMARY\s+KEY)\b/i },
  { label: "CREATE UNIQUE INDEX", pattern: /\bCREATE\s+UNIQUE\s+INDEX\b/i },
  { label: "replace callable or view contract", pattern: /\bCREATE\s+OR\s+REPLACE\s+(?:FUNCTION|PROCEDURE|VIEW)\b/i },
  { label: "TRUNCATE data", pattern: /\bTRUNCATE(?:\s+TABLE)?\b/i },
  { label: "DELETE data", pattern: /\bDELETE\s+FROM\b/i },
  { label: "REVOKE privilege", pattern: /\bREVOKE\b/i },
]);

function normalizeLineEndings(value) {
  return value.replace(/\r\n?/g, "\n");
}

function withoutComments(value) {
  let result = "";
  let index = 0;
  let blockDepth = 0;
  let quoted = null;
  let dollarTag = null;

  while (index < value.length) {
    if (blockDepth > 0) {
      if (value.startsWith("/*", index)) {
        blockDepth += 1;
        index += 2;
      } else if (value.startsWith("*/", index)) {
        blockDepth -= 1;
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    if (dollarTag) {
      if (value.startsWith(dollarTag, index)) {
        result += dollarTag;
        index += dollarTag.length;
        dollarTag = null;
      } else {
        result += value[index];
        index += 1;
      }
      continue;
    }

    if (quoted) {
      result += value[index];
      if (value[index] === quoted) {
        if (value[index + 1] === quoted) {
          result += value[index + 1];
          index += 2;
          continue;
        }
        quoted = null;
      }
      index += 1;
      continue;
    }

    if (value.startsWith("--", index)) {
      const lineEnd = value.indexOf("\n", index + 2);
      index = lineEnd === -1 ? value.length : lineEnd;
      result += " ";
      continue;
    }
    if (value.startsWith("/*", index)) {
      blockDepth = 1;
      index += 2;
      result += " ";
      continue;
    }
    if (value[index] === "'" || value[index] === '"') {
      quoted = value[index];
      result += value[index];
      index += 1;
      continue;
    }
    if (value[index] === "$") {
      const match = value.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) {
        dollarTag = match[0];
        result += dollarTag;
        index += dollarTag.length;
        continue;
      }
    }

    result += value[index];
    index += 1;
  }

  return result;
}

export function migrationHistoryDigest(migrations) {
  const hash = createHash("sha256");
  for (const migration of [...migrations].sort((left, right) => left.name.localeCompare(right.name))) {
    hash.update(migration.name);
    hash.update("\0");
    hash.update(normalizeLineEndings(migration.source));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function migrationPhase(source) {
  if (CONTRACT_PHASE_MARKER.test(source)) return "contract";
  if (PHASE_MARKER.test(source)) return "expand";
  return null;
}

export function validateExpandMigration({ name, source }) {
  if (migrationPhase(source) === "contract") {
    throw new Error(
      `${name}: contract-phase migrations never run in the automatic production release. ` +
      "Run them later through the manual contract-migration workflow.",
    );
  }
  if (!PHASE_MARKER.test(source)) {
    throw new Error(
      `${name}: migrations newer than the production baseline must declare ` +
      "'-- yourrank:migration-phase: expand'.",
    );
  }

  const sql = withoutComments(source);
  const violation = CONTRACT_PATTERNS.find(({ pattern }) => pattern.test(sql));
  if (violation) {
    throw new Error(
      `${name}: ${violation.label} is not allowed in the automatic pre-deploy expand phase. ` +
      "Deploy compatible code first and schedule the contract change in a later release.",
    );
  }
}

async function loadMigrations(root) {
  const migrationsDirectory = resolve(root, "supabase/migrations");
  const policy = JSON.parse(await readFile(resolve(root, "supabase/migration-policy.json"), "utf8"));
  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
  const migrations = [];
  const versions = new Set();

  for (const name of names) {
    const match = name.match(MIGRATION_NAME);
    if (!match) {
      throw new Error(`${name}: expected YYYYMMDDHHMMSS_description.sql.`);
    }
    const [, version] = match;
    if (versions.has(version)) {
      throw new Error(`${name}: duplicate migration version ${version}.`);
    }
    versions.add(version);
    migrations.push({ name, version, source: await readFile(resolve(migrationsDirectory, name), "utf8") });
  }
  return { policy, migrations };
}

/**
 * The immutable baseline may only cover migrations production has actually
 * recorded. Otherwise a contract migration could be smuggled past the expand
 * gate by advancing `appliedThrough` in the same change that adds it.
 */
export function assertBaselineApplied({ policy, migrations, appliedVersions }) {
  const applied = new Set(appliedVersions);
  const unapplied = migrations
    .filter(({ version }) => version <= policy.appliedThrough && !applied.has(version))
    .map(({ name }) => name);
  if (unapplied.length > 0) {
    throw new Error(
      `migration-policy.json appliedThrough=${policy.appliedThrough} is ahead of production: ` +
      `${unapplied.join(", ")} not recorded as applied. Advance the baseline only after production has applied them.`,
    );
  }
}

export async function validateBaselineAgainstProduction({ root = DEFAULT_ROOT, appliedVersions }) {
  const { policy, migrations } = await loadMigrations(root);
  assertBaselineApplied({ policy, migrations, appliedVersions });
  return { appliedThrough: policy.appliedThrough };
}

/**
 * Gate for the manual contract-migration workflow. The contract file must be
 * the only pending migration, declare its phase and the release it requires,
 * and every production Worker must already serve exactly that release at 100%
 * (so no N-1 version can still be reading the schema being contracted).
 */
export function validateContractRelease({ policy, migrations, migrationName, appliedVersions, workerSourceShas, confirmations }) {
  assertBaselineApplied({ policy, migrations, appliedVersions });
  const pending = migrations.filter(({ version }) => version > policy.appliedThrough);
  const target = pending.find(({ name }) => name === migrationName);
  if (!target) {
    throw new Error(`${migrationName}: not a pending migration newer than baseline ${policy.appliedThrough}.`);
  }
  if (pending.length !== 1) {
    throw new Error(
      `Contract release must contain exactly one pending migration; found ${pending.map(({ name }) => name).join(", ")}. ` +
      "Ship expand migrations through the normal release first.",
    );
  }
  if (migrationPhase(target.source) !== "contract") {
    throw new Error(`${migrationName}: must declare '-- yourrank:migration-phase: contract'.`);
  }
  const requiresRelease = target.source.match(CONTRACT_REQUIRES_RELEASE)?.[1];
  if (!requiresRelease) {
    throw new Error(`${migrationName}: must declare '-- yourrank:contract-requires-release: <40-char commit sha>'.`);
  }
  if (new Set(appliedVersions).has(target.version)) {
    throw new Error(`${migrationName}: already recorded as applied in production.`);
  }
  const stale = Object.entries(workerSourceShas).filter(([, sha]) => sha !== requiresRelease).map(([key, sha]) => `${key}=${sha ?? "unknown/mixed"}`);
  if (stale.length > 0) {
    throw new Error(
      `Production is not serving release ${requiresRelease} exclusively: ${stale.join(", ")}. ` +
      "The rollback/N-1 window is still open; contract migration refused.",
    );
  }
  for (const key of ["backfill_complete", "rollback_window_closed", "data_validation_passed"]) {
    if (confirmations?.[key] !== true) throw new Error(`Contract migration requires explicit confirmation '${key}=true'.`);
  }
  const expectedPhrase = `CONTRACT ${migrationName}`;
  if (confirmations?.confirm !== expectedPhrase) {
    throw new Error(`Contract migration requires typing '${expectedPhrase}' as confirmation.`);
  }
  return { migrationName, version: target.version, requiresRelease };
}

export async function validateMigrationCompatibility({ root = DEFAULT_ROOT } = {}) {
  const { policy, migrations } = await loadMigrations(root);

  const historical = migrations.filter(({ version }) => version <= policy.appliedThrough);
  if (historical.length !== policy.historicalCount) {
    throw new Error(
      `Applied migration history through ${policy.appliedThrough} is immutable: expected ` +
      `${policy.historicalCount} files, found ${historical.length}.`,
    );
  }
  const digest = migrationHistoryDigest(historical);
  if (digest !== policy.historicalSha256) {
    throw new Error(
      `Applied migration history through ${policy.appliedThrough} was added to, removed from, or edited. ` +
      "Never rename or modify migrations recorded in production.",
    );
  }

  const pendingPolicyMigrations = migrations.filter(({ version }) => version > policy.appliedThrough);
  for (const migration of pendingPolicyMigrations) {
    validateExpandMigration(migration);
  }

  return {
    appliedThrough: policy.appliedThrough,
    historicalCount: historical.length,
    checkedExpandMigrations: pendingPolicyMigrations.map(({ name }) => name),
  };
}

async function contractGateMain() {
  const state = JSON.parse(process.env.RELEASE_STATE ?? "null");
  if (state?.schemaVersion !== 1) throw new Error("RELEASE_STATE must contain a captured release state.");
  const { policy, migrations } = await loadMigrations(DEFAULT_ROOT);
  const workerSourceShas = Object.fromEntries(RELEASE_WORKERS.map(({ key }) => [key, versionSourceSha(state.workers[key])]));
  const result = validateContractRelease({
    policy,
    migrations,
    migrationName: process.env.CONTRACT_MIGRATION ?? "",
    appliedVersions: state.migrations.map(({ version }) => version),
    workerSourceShas,
    confirmations: {
      backfill_complete: process.env.CONFIRM_BACKFILL_COMPLETE === "true",
      rollback_window_closed: process.env.CONFIRM_ROLLBACK_WINDOW_CLOSED === "true",
      data_validation_passed: process.env.CONFIRM_DATA_VALIDATION_PASSED === "true",
      confirm: process.env.CONFIRM_PHRASE ?? "",
    },
  });
  console.log(`Contract migration ${result.migrationName} admitted: production serves ${result.requiresRelease} on every Worker.`);
}

async function main() {
  try {
    if (process.argv[2] === "contract-gate") return await contractGateMain();
    if (process.argv[2] === "baseline-applied") {
      const state = JSON.parse(process.env.RELEASE_STATE ?? "null");
      if (state?.schemaVersion !== 1) throw new Error("RELEASE_STATE must contain a captured release state.");
      const result = await validateBaselineAgainstProduction({ appliedVersions: state.migrations.map(({ version }) => version) });
      console.log(`Migration baseline ${result.appliedThrough} is fully recorded in production.`);
      return;
    }
    const result = await validateMigrationCompatibility();
    console.log(
      `Immutable production migration baseline: ${result.historicalCount} files through ${result.appliedThrough}`,
    );
    console.log(
      result.checkedExpandMigrations.length > 0
        ? `Validated expand-phase migrations: ${result.checkedExpandMigrations.join(", ")}`
        : "Validated expand-phase migrations: none after the production baseline",
    );
  } catch (error) {
    console.error(`::error title=Migration compatibility preflight failed::${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
