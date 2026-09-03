// F-015: executable restore-drill control.
//
// A backup is only proven when it has been restored into an isolated target,
// checked for integrity, and read by the application queries the Workers rely
// on. This script is the fail-closed framework `.github/workflows/restore-drill.yml`
// runs; it never writes to production, never records a verification itself, and
// never produces evidence containing secrets.
//
//   preflight        validate the drill contract by name (target is not production,
//                    source/target credentials are separate, no Worker credential
//                    is reused); prints no values.
//   list-backups     read provider backup metadata (Supabase Management API) for
//                    the source project and write the newest backup's safe
//                    metadata to RESTORE_BACKUP_METADATA_FILE. Fails when the
//                    provider reports backups disabled or none exist.
//   verify           run integrity + application read checks against the restored
//                    target, compute RTO/RPO from the timing file, and write the
//                    evidence document. Any failed check => exit 1 and the
//                    evidence document is marked success:false.
//   retire           drop the restored data from the scratch target (it holds a
//                    copy of production customer data) and mark the evidence
//                    document restoreTargetRetired:true.
//   evidence-check   assert an evidence document is complete, successful, retired
//                    and free of credentials before it may be used to record a
//                    verification.
//
// Recording the verification is deliberately NOT done by this script: it happens
// through POST /api/admin/backup-verifications under fresh admin step-up 2FA
// (F-058) with the evidence document produced here, so the same authorization
// and audit path applies to every writer of the recovery signal.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { PRODUCTION_SUPABASE_PROJECT_REF } from "./release-recovery-state.mjs";

export const PRODUCTION_DB_HOST_FRAGMENTS = Object.freeze([
  PRODUCTION_SUPABASE_PROJECT_REF,
  "yourrank.site",
]);

// Tables every restored copy must contain (schema from supabase/migrations).
export const REQUIRED_TABLES = Object.freeze([
  "users",
  "sessions",
  "sites",
  "site_members",
  "site_invites",
  "oauth_states",
  "clicks",
  "click_daily",
  "audit_log",
  "backup_verifications",
  "feature_flags",
]);

// Tables that must hold data in a production restore; an empty copy of these
// means the backup did not contain the customer state it claims to protect.
export const NON_EMPTY_TABLES = Object.freeze(["users", "sites"]);

// Server-only tables that must remain RLS-protected after restore.
export const RLS_TABLES = Object.freeze([
  "users",
  "sessions",
  "site_members",
  "site_invites",
  "oauth_states",
  "backup_verifications",
]);

export const EVIDENCE_REQUIRED_KEYS = Object.freeze([
  "workflowRunId",
  "sourceBackupId",
  "restoreTargetId",
  "startedAt",
  "completedAt",
  "releaseSha",
  "integrityChecks",
  "rtoSeconds",
  "rpoSeconds",
  "success",
]);

const SECRET_PATTERNS = [
  /postgres(?:ql)?:\/\//i,
  /:\/\/[^/\s]*:[^/\s]*@/i,
  /\b(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|bearer)\b\s*[:=]/i,
  /\bsb[pa]_[A-Za-z0-9]{8,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

export function containsSecretMaterial(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "object") {
    return Object.entries(value).some(([k, v]) => containsSecretMaterial(k) || containsSecretMaterial(v));
  }
  return SECRET_PATTERNS.some((pattern) => pattern.test(String(value)));
}

function parseDbUrl(value, label) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error(`${label} is not a valid connection URL.`);
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error(`${label} must be a postgres:// URL.`);
  return url;
}

export function isProductionDatabase(url) {
  // Direct hosts embed the project ref (db.<ref>.supabase.co); pooler hosts carry
  // it in the username (postgres.<ref>), so both are inspected.
  const identity = `${url.hostname} ${decodeURIComponent(url.username)}`.toLowerCase();
  return PRODUCTION_DB_HOST_FRAGMENTS.some((fragment) => identity.includes(fragment.toLowerCase()));
}

// Validates the drill contract from environment variable *names/shape* only.
export function checkDrillContract(env) {
  const problems = [];
  const targetRaw = env.RESTORE_TARGET_DATABASE_URL;
  const sourceRaw = env.RESTORE_SOURCE_DATABASE_URL;
  if (!targetRaw) {
    problems.push("RESTORE_TARGET_DATABASE_URL is not set (isolated scratch database for the restore).");
  } else {
    try {
      const target = parseDbUrl(targetRaw, "RESTORE_TARGET_DATABASE_URL");
      if (isProductionDatabase(target)) {
        problems.push("RESTORE_TARGET_DATABASE_URL points at the production database; a restore drill must never restore over production.");
      }
      if (!target.username) problems.push("RESTORE_TARGET_DATABASE_URL has no username.");
      if (["yourrank_worker", "yourrank_app"].includes(target.username)) {
        problems.push("RESTORE_TARGET_DATABASE_URL must use an administrative restore credential, not the Worker DB identity.");
      }
    } catch (error) {
      problems.push(error.message);
    }
  }
  if (sourceRaw) {
    try {
      const source = parseDbUrl(sourceRaw, "RESTORE_SOURCE_DATABASE_URL");
      if (["yourrank_worker", "yourrank_app"].includes(source.username)) {
        problems.push("RESTORE_SOURCE_DATABASE_URL must be a dedicated backup/read credential, not the Worker DB identity.");
      }
      if (targetRaw) {
        try {
          const target = parseDbUrl(targetRaw, "RESTORE_TARGET_DATABASE_URL");
          if (target.hostname === source.hostname && target.pathname === source.pathname) {
            problems.push("RESTORE_SOURCE_DATABASE_URL and RESTORE_TARGET_DATABASE_URL are the same database.");
          }
        } catch {
          // already reported
        }
      }
    } catch (error) {
      problems.push(error.message);
    }
  }
  const backupSource = env.RESTORE_BACKUP_SOURCE;
  if (!["provider-backup", "logical-dump"].includes(backupSource ?? "")) {
    problems.push(`RESTORE_BACKUP_SOURCE must be "provider-backup" or "logical-dump" (got ${backupSource === undefined ? "unset" : JSON.stringify(backupSource)}).`);
  }
  if (backupSource === "provider-backup") {
    if (!env.SUPABASE_ACCESS_TOKEN) problems.push("SUPABASE_ACCESS_TOKEN is required to read provider backup metadata.");
    if (!env.RESTORE_BACKUP_DOWNLOAD_URL) problems.push("RESTORE_BACKUP_DOWNLOAD_URL (short-lived provider backup download link, secret) is required for provider-backup drills.");
  }
  if (backupSource === "logical-dump" && !sourceRaw) {
    problems.push("RESTORE_SOURCE_DATABASE_URL is required for logical-dump drills.");
  }
  if (env.RESTORE_TARGET_ID === undefined || String(env.RESTORE_TARGET_ID).trim() === "") {
    problems.push("RESTORE_TARGET_ID (safe identifier of the scratch target, e.g. scratch project ref) is required.");
  } else if (String(env.RESTORE_TARGET_ID).trim() === PRODUCTION_SUPABASE_PROJECT_REF) {
    problems.push("RESTORE_TARGET_ID is the production project ref.");
  }
  if (!env.RELEASE_SHA || !/^[0-9a-f]{7,40}$/i.test(env.RELEASE_SHA)) problems.push("RELEASE_SHA must be the git SHA the drill runs from.");
  if (!env.WORKFLOW_RUN_ID) problems.push("WORKFLOW_RUN_ID is required so the evidence is traceable to a run.");
  return problems;
}

// Supabase Management API backup listing (metadata only).
export async function fetchProviderBackups({ projectRef, accessToken, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/database/backups`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Provider backup listing failed for ${projectRef}: HTTP ${response.status}.`);
  }
  return response.json();
}

export function selectLatestBackup(listing) {
  if (!listing || typeof listing !== "object") throw new Error("Provider backup listing is not an object.");
  const status = {
    physicalBackupsEnabled: Boolean(listing.physical_backup_data ?? listing.physicalBackupData) || false,
    pitrEnabled: Boolean(listing.pitr_enabled ?? listing.pitrEnabled),
    walgEnabled: Boolean(listing.walg_enabled ?? listing.walgEnabled),
  };
  const backups = Array.isArray(listing.backups) ? listing.backups : [];
  const completed = backups.filter((backup) => String(backup.status ?? "").toUpperCase() === "COMPLETED" && backup.inserted_at);
  if (completed.length === 0) {
    throw new Error("Provider reports no COMPLETED backups for the source project; automated backups are NOT proven.");
  }
  completed.sort((a, b) => new Date(b.inserted_at).getTime() - new Date(a.inserted_at).getTime());
  const latest = completed[0];
  return {
    ...status,
    sourceBackupId: String(latest.id ?? latest.inserted_at),
    sourceBackupCreatedAt: new Date(latest.inserted_at).toISOString(),
    isPhysical: Boolean(latest.is_physical_backup),
  };
}

async function integrityChecks(sql) {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail });

  const tables = (await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`).map((row) => row.tablename);
  for (const table of REQUIRED_TABLES) push(`table ${table} present`, tables.includes(table), tables.includes(table) ? "present" : "missing");

  for (const table of NON_EMPTY_TABLES) {
    if (!tables.includes(table)) continue;
    const [{ count }] = await sql.unsafe(`SELECT count(*)::int AS count FROM public.${table}`);
    push(`table ${table} non-empty`, count > 0, `${count} rows`);
  }

  const [{ invalid }] = await sql`SELECT count(*)::int AS invalid FROM pg_constraint WHERE contype = 'f' AND NOT convalidated`;
  push("foreign keys validated", invalid === 0, `${invalid} unvalidated`);

  const rls = await sql`SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND relkind = 'r'`;
  for (const table of RLS_TABLES) {
    const row = rls.find((r) => r.relname === table);
    push(`rls enabled on ${table}`, Boolean(row?.relrowsecurity), row ? String(row.relrowsecurity) : "missing");
  }

  const [migrations] = await sql`SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS present`;
  push("migration history present", migrations.present === true, migrations.present ? "supabase_migrations.schema_migrations" : "missing");
  if (migrations.present) {
    const [{ applied }] = await sql`SELECT count(*)::int AS applied FROM supabase_migrations.schema_migrations`;
    push("migration history non-empty", applied > 0, `${applied} versions`);
  }

  const [{ roles }] = await sql`SELECT count(*)::int AS roles FROM pg_roles WHERE rolname IN ('yourrank_app', 'yourrank_worker')`;
  push("application roles present", roles === 2, `${roles}/2`);
  return checks;
}

// Read paths the Workers depend on at runtime; a restore that cannot serve
// these is not a recovery.
async function applicationReadChecks(sql) {
  const checks = [];
  const run = async (name, fn) => {
    try {
      const detail = await fn();
      checks.push({ name, ok: true, detail });
    } catch (error) {
      checks.push({ name, ok: false, detail: String(error?.message ?? error).slice(0, 200) });
    }
  };
  await run("session lookup shape", async () => {
    await sql`SELECT s.user_id, s.expires_at, u.email, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id LIMIT 1`;
    return "ok";
  });
  await run("site by slug", async () => {
    const rows = await sql`SELECT id, slug FROM sites ORDER BY slug LIMIT 1`;
    return rows.length ? `slug ${rows[0].slug}` : "no sites";
  });
  await run("site membership join", async () => {
    await sql`SELECT sm.site_id, sm.role FROM site_members sm JOIN sites s ON s.id = sm.site_id LIMIT 1`;
    return "ok";
  });
  await run("click rollup read", async () => {
    await sql`SELECT count(*)::int AS n FROM click_daily`;
    return "ok";
  });
  await run("backup verification history read", async () => {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM backup_verifications`;
    return `${n} rows`;
  });
  return checks;
}

export function buildEvidence({ env, timing, backup, integrity, appReads }) {
  const startedAt = new Date(timing.drillStartedAt);
  const restoreCompletedAt = new Date(timing.restoreCompletedAt);
  const completedAt = new Date();
  const rtoSeconds = Math.max(0, Math.round((restoreCompletedAt.getTime() - startedAt.getTime()) / 1000));
  const backupCreatedAt = new Date(backup.sourceBackupCreatedAt);
  const rpoSeconds = Math.max(0, Math.round((startedAt.getTime() - backupCreatedAt.getTime()) / 1000));
  const allChecks = [...integrity, ...appReads];
  const success = allChecks.length > 0 && allChecks.every((check) => check.ok) && timing.restoreExitCode === 0;
  return {
    provider: "supabase",
    target: `restore-drill:${env.RESTORE_TARGET_ID}`,
    workflowRunId: String(env.WORKFLOW_RUN_ID),
    workflowRunUrl: env.WORKFLOW_RUN_URL ?? null,
    backupSource: env.RESTORE_BACKUP_SOURCE,
    sourceBackupId: backup.sourceBackupId,
    sourceBackupCreatedAt: backupCreatedAt.toISOString(),
    restoreTargetId: String(env.RESTORE_TARGET_ID),
    restoreTargetRetired: false,
    startedAt: startedAt.toISOString(),
    restoreCompletedAt: restoreCompletedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    releaseSha: env.RELEASE_SHA,
    restoreExitCode: timing.restoreExitCode,
    integrityChecks: integrity,
    applicationReadChecks: appReads,
    rtoSeconds,
    rpoSeconds,
    success,
  };
}

export function checkEvidence(evidence) {
  const problems = [];
  if (!evidence || typeof evidence !== "object") return ["evidence is not an object"];
  for (const key of EVIDENCE_REQUIRED_KEYS) {
    if (evidence[key] === undefined || evidence[key] === null) problems.push(`evidence.${key} is missing`);
  }
  if (evidence.success !== true) problems.push("evidence.success is not true; a failed or incomplete drill cannot record a verification");
  if (evidence.restoreTargetRetired !== true) problems.push("evidence.restoreTargetRetired is not true; the scratch copy of production data must be retired first");
  if (!Array.isArray(evidence.integrityChecks) || evidence.integrityChecks.length === 0) problems.push("evidence.integrityChecks is empty");
  else if (evidence.integrityChecks.some((check) => check.ok !== true)) problems.push("evidence.integrityChecks contains a failed check");
  if (Array.isArray(evidence.applicationReadChecks) && evidence.applicationReadChecks.some((check) => check.ok !== true)) {
    problems.push("evidence.applicationReadChecks contains a failed check");
  }
  if (String(evidence.restoreTargetId) === PRODUCTION_SUPABASE_PROJECT_REF) problems.push("evidence.restoreTargetId is the production project");
  if (Number.isFinite(Number(evidence.rtoSeconds)) && Number(evidence.rtoSeconds) < 0) problems.push("evidence.rtoSeconds is negative");
  if (Number.isFinite(Number(evidence.rpoSeconds)) && Number(evidence.rpoSeconds) < 0) problems.push("evidence.rpoSeconds is negative");
  if (evidence.startedAt && evidence.completedAt && new Date(evidence.startedAt) > new Date(evidence.completedAt)) problems.push("evidence.startedAt is after completedAt");
  if (evidence.completedAt && new Date(evidence.completedAt).getTime() > Date.now() + 5 * 60_000) problems.push("evidence.completedAt is in the future");
  if (containsSecretMaterial(evidence)) problems.push("evidence contains credential-like material");
  return problems;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(process.cwd(), path), "utf8"));
}

function fail(problems, label) {
  for (const problem of problems) console.error(`::error title=Restore drill::${problem}`);
  throw new Error(`${label} failed with ${problems.length} problem(s).`);
}

async function main() {
  const command = process.argv[2];
  const env = process.env;
  switch (command) {
    case "preflight": {
      const problems = checkDrillContract(env);
      if (problems.length) fail(problems, "Restore drill preflight");
      console.log(`Restore drill preflight OK: target ${env.RESTORE_TARGET_ID} (not production), source ${env.RESTORE_BACKUP_SOURCE}, run ${env.WORKFLOW_RUN_ID}.`);
      return;
    }
    case "list-backups": {
      const listing = await fetchProviderBackups({ projectRef: PRODUCTION_SUPABASE_PROJECT_REF, accessToken: env.SUPABASE_ACCESS_TOKEN });
      const latest = selectLatestBackup(listing);
      await writeFile(resolve(process.cwd(), env.RESTORE_BACKUP_METADATA_FILE ?? "restore-backup-metadata.json"), JSON.stringify(latest, null, 2));
      console.log(`Latest provider backup ${latest.sourceBackupId} created ${latest.sourceBackupCreatedAt} (PITR ${latest.pitrEnabled ? "enabled" : "disabled"}).`);
      return;
    }
    case "verify": {
      const contract = checkDrillContract(env);
      if (contract.length) fail(contract, "Restore drill verify");
      const timing = await readJson(env.RESTORE_TIMING_FILE ?? "restore-timing.json");
      const backup = await readJson(env.RESTORE_BACKUP_METADATA_FILE ?? "restore-backup-metadata.json");
      const sql = postgres(env.RESTORE_TARGET_DATABASE_URL, { max: 1, onnotice: () => {}, connect_timeout: 20 });
      let integrity = [];
      let appReads = [];
      try {
        integrity = await integrityChecks(sql);
        appReads = await applicationReadChecks(sql);
      } finally {
        await sql.end({ timeout: 5 });
      }
      const evidence = buildEvidence({ env, timing, backup, integrity, appReads });
      await writeFile(resolve(process.cwd(), env.RESTORE_EVIDENCE_FILE ?? "restore-drill-evidence.json"), JSON.stringify(evidence, null, 2));
      for (const check of [...integrity, ...appReads]) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name} — ${check.detail}`);
      console.log(`RTO ${evidence.rtoSeconds}s, RPO ${evidence.rpoSeconds}s, success=${evidence.success}`);
      if (!evidence.success) fail(["restore drill did not pass every integrity/application check; no verification may be recorded"], "Restore drill verify");
      return;
    }
    case "retire": {
      const contract = checkDrillContract(env);
      if (contract.length) fail(contract, "Restore drill retire");
      const target = parseDbUrl(env.RESTORE_TARGET_DATABASE_URL, "RESTORE_TARGET_DATABASE_URL");
      if (isProductionDatabase(target)) fail(["refusing to retire: target is production"], "Restore drill retire");
      const sql = postgres(env.RESTORE_TARGET_DATABASE_URL, { max: 1, onnotice: () => {}, connect_timeout: 20 });
      try {
        await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS app_private CASCADE; DROP SCHEMA IF EXISTS supabase_migrations CASCADE;");
      } finally {
        await sql.end({ timeout: 5 });
      }
      const evidencePath = resolve(process.cwd(), env.RESTORE_EVIDENCE_FILE ?? "restore-drill-evidence.json");
      let evidence = null;
      try {
        evidence = JSON.parse(await readFile(evidencePath, "utf8"));
      } catch {
        evidence = null;
      }
      if (evidence) {
        evidence.restoreTargetRetired = true;
        evidence.retiredAt = new Date().toISOString();
        await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
      }
      console.log(`Restore target ${env.RESTORE_TARGET_ID} retired (restored schemas dropped).`);
      return;
    }
    case "evidence-check": {
      const evidence = await readJson(env.RESTORE_EVIDENCE_FILE ?? "restore-drill-evidence.json");
      const problems = checkEvidence(evidence);
      if (problems.length) fail(problems, "Restore evidence check");
      console.log(`Restore evidence OK: run ${evidence.workflowRunId}, backup ${evidence.sourceBackupId}, target ${evidence.restoreTargetId}, RTO ${evidence.rtoSeconds}s, RPO ${evidence.rpoSeconds}s.`);
      return;
    }
    default:
      throw new Error("Usage: node scripts/restore-drill.mjs <preflight|list-backups|verify|retire|evidence-check>");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(`::error title=Restore drill failed::${error.message}`);
    process.exitCode = 1;
  }
}
