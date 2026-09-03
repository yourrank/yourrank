import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MIGRATION_NAME = /^(\d{14})_(.+)\.sql$/;
const PHASE_MARKER = /^\s*--\s*yourrank:migration-phase:\s*expand\s*$/im;

const CONTRACT_PATTERNS = Object.freeze([
  { label: "DROP object", pattern: /\bDROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA|VIEW|MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE|TRIGGER|POLICY|EXTENSION|SEQUENCE|DOMAIN)\b/i },
  { label: "RENAME object", pattern: /\bALTER\s+(?:TABLE|TYPE|VIEW)\b[^;]*\bRENAME\b/i },
  { label: "ALTER COLUMN TYPE", pattern: /\bALTER\s+TABLE\b[^;]*\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i },
  { label: "SET NOT NULL", pattern: /\bALTER\s+TABLE\b[^;]*\bALTER\s+COLUMN\b[^;]*\bSET\s+NOT\s+NULL\b/i },
  { label: "ADD COLUMN NOT NULL", pattern: /\bALTER\s+TABLE\b[^;]*\bADD\s+(?:COLUMN\s+)?[^;]*\bNOT\s+NULL\b/i },
  { label: "DROP DEFAULT", pattern: /\bALTER\s+TABLE\b[^;]*\bALTER\s+COLUMN\b[^;]*\bDROP\s+DEFAULT\b/i },
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

export function validateExpandMigration({ name, source }) {
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

export async function validateMigrationCompatibility({ root = DEFAULT_ROOT } = {}) {
  const migrationsDirectory = resolve(root, "supabase/migrations");
  const policyPath = resolve(root, "supabase/migration-policy.json");
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
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

async function main() {
  try {
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
