import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const RELEASE_WORKERS = Object.freeze([
  { key: "leaderboard", scriptName: "yourrank-site" },
  { key: "bot", scriptName: "yourrank-bot" },
  { key: "consumer", scriptName: "yourrank-consumer" },
  { key: "monitor", scriptName: "yourrank-monitor" },
]);

export const RELEASE_STAGES = Object.freeze([
  "migrate",
  "deploy-leaderboard",
  "deploy-bot",
  "deploy-consumer",
  "smoke-test",
  "deploy-monitor",
]);

const FAILED_RESULTS = new Set(["failure", "cancelled"]);
const VERSION_ID = /^[0-9a-f-]{16,64}$/i;

function required(value, name) {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function requestJson(url, token, fetchImpl, label) {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.errors?.map((error) => error.message).join("; ") || body?.message || `HTTP ${response.status}`;
    throw new Error(`Release-state request failed for ${label}: ${detail}`);
  }
  if (body && Object.hasOwn(body, "success") && body.success !== true) {
    throw new Error(`Release-state request failed for ${label}: API returned success=false.`);
  }
  return body?.result ?? body;
}

function normalizeVersions(versions, scriptName) {
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error(`${scriptName}: active deployment has no versions.`);
  }
  const normalized = versions.map((version) => {
    const versionId = String(version.version_id ?? version.versionId ?? "");
    const percentage = Number(version.percentage);
    if (!VERSION_ID.test(versionId) || !Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
      throw new Error(`${scriptName}: active deployment contains an invalid version allocation.`);
    }
    return { versionId, percentage };
  }).sort((left, right) => left.versionId.localeCompare(right.versionId));
  const total = normalized.reduce((sum, version) => sum + version.percentage, 0);
  if (Math.abs(total - 100) > 0.001) {
    throw new Error(`${scriptName}: active deployment percentages total ${total}, expected 100.`);
  }
  return normalized;
}

export function latestDeploymentState(payload, scriptName) {
  const deployments = Array.isArray(payload) ? payload : payload?.deployments;
  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new Error(`${scriptName}: Cloudflare returned no deployments.`);
  }
  for (const deployment of deployments) {
    if (!deployment?.id || !deployment?.created_on || !Number.isFinite(Date.parse(deployment.created_on))) {
      throw new Error(`${scriptName}: Cloudflare returned a deployment without a valid id or timestamp.`);
    }
  }
  const latest = [...deployments].sort((left, right) => {
    const dateDifference = Date.parse(right.created_on) - Date.parse(left.created_on);
    return dateDifference || String(right.id).localeCompare(String(left.id));
  })[0];
  return {
    scriptName,
    deploymentId: required(latest.id, `${scriptName} deployment id`),
    createdOn: required(latest.created_on, `${scriptName} deployment timestamp`),
    versions: normalizeVersions(latest.versions, scriptName),
  };
}

export function versionSpecs(workerState) {
  return [...workerState.versions]
    .sort((left, right) => left.versionId.localeCompare(right.versionId))
    .map(({ versionId, percentage }) => `${versionId}@${Number(percentage)}%`)
    .join(" ");
}

function sameVersions(left, right) {
  return versionSpecs(left) === versionSpecs(right);
}

function normalizeMigrations(payload) {
  if (!Array.isArray(payload)) throw new Error("Supabase returned an invalid migration history response.");
  return payload.map((migration) => ({
    version: required(String(migration.version ?? ""), "Supabase migration version"),
    name: String(migration.name ?? ""),
  })).sort((left, right) => left.version.localeCompare(right.version));
}

export async function fetchReleaseState({
  cloudflareAccountId,
  cloudflareApiToken,
  supabaseProjectRef,
  supabaseAccessToken,
  fetchImpl = fetch,
} = {}) {
  const accountId = required(cloudflareAccountId, "CLOUDFLARE_ACCOUNT_ID");
  const cloudflareToken = required(cloudflareApiToken, "CLOUDFLARE_API_TOKEN");
  const projectRef = required(supabaseProjectRef, "SUPABASE_PROJECT_REF");
  const supabaseToken = required(supabaseAccessToken, "SUPABASE_ACCESS_TOKEN");

  const workers = {};
  for (const worker of RELEASE_WORKERS) {
    const payload = await requestJson(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${worker.scriptName}/deployments`,
      cloudflareToken,
      fetchImpl,
      `${worker.scriptName} deployments`,
    );
    workers[worker.key] = latestDeploymentState(payload, worker.scriptName);
  }
  const migrations = normalizeMigrations(await requestJson(
    `https://api.supabase.com/v1/projects/${projectRef}/database/migrations`,
    supabaseToken,
    fetchImpl,
    "Supabase migration history",
  ));

  return { schemaVersion: 1, capturedAt: new Date().toISOString(), migrations, workers };
}

export function shouldRunRecovery({ captureResult, stages }) {
  return captureResult === "success" && RELEASE_STAGES.some((stage) => FAILED_RESULTS.has(stages[stage]));
}

export function buildRecoveryPlan({ baseline, current, stages }) {
  if (baseline?.schemaVersion !== 1 || current?.schemaVersion !== 1) {
    throw new Error("Unsupported or missing release-state schema.");
  }
  const baselineMigrations = new Set(baseline.migrations.map(({ version }) => version));
  const currentMigrations = new Set(current.migrations.map(({ version }) => version));
  const migrationsAdded = current.migrations.filter(({ version }) => !baselineMigrations.has(version));
  const migrationsMissing = baseline.migrations.filter(({ version }) => !currentMigrations.has(version));
  const restoreTargets = [];
  const unchangedWorkers = [];
  const workers = {};

  for (const worker of RELEASE_WORKERS) {
    const before = required(baseline.workers?.[worker.key], `baseline state for ${worker.key}`);
    const after = required(current.workers?.[worker.key], `current state for ${worker.key}`);
    const changed = !sameVersions(before, after);
    workers[worker.key] = { changed, before, after, restoreSpecs: versionSpecs(before) };
    (changed ? restoreTargets : unchangedWorkers).push(worker.key);
  }

  return {
    releaseFailed: RELEASE_STAGES.some((stage) => FAILED_RESULTS.has(stages[stage])),
    mutationObserved: migrationsAdded.length > 0 || migrationsMissing.length > 0 || restoreTargets.length > 0,
    migrationsAdded,
    migrationsMissing,
    restoreTargets,
    unchangedWorkers,
    workers,
  };
}

async function writeOutputs(values) {
  const outputPath = required(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT");
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");
  await appendFile(outputPath, `${lines}\n`);
}

async function appendSummary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

function environmentStateOptions() {
  return {
    cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
    supabaseProjectRef: process.env.SUPABASE_PROJECT_REF,
    supabaseAccessToken: process.env.SUPABASE_ACCESS_TOKEN,
  };
}

function stateSummary(state) {
  return RELEASE_WORKERS.map((worker) => `${worker.key}=${versionSpecs(state.workers[worker.key])}`).join(", ");
}

async function captureCommand() {
  const state = await fetchReleaseState(environmentStateOptions());
  await writeOutputs({ state: JSON.stringify(state) });
  console.log(`Captured ${state.migrations.length} applied migrations.`);
  console.log(`Captured Worker versions: ${stateSummary(state)}`);
  await appendSummary(`## Pre-mutation release state\n\n- Applied migrations: ${state.migrations.length}\n- Worker versions: ${stateSummary(state)}`);
}

async function planCommand() {
  const baseline = JSON.parse(required(process.env.BASELINE_RELEASE_STATE, "BASELINE_RELEASE_STATE"));
  const stages = JSON.parse(required(process.env.RELEASE_STAGE_RESULTS, "RELEASE_STAGE_RESULTS"));
  const current = await fetchReleaseState(environmentStateOptions());
  const plan = buildRecoveryPlan({ baseline, current, stages });
  const outputs = {
    release_failed: String(plan.releaseFailed),
    mutation_observed: String(plan.mutationObserved),
    migrations_changed: String(plan.migrationsAdded.length > 0 || plan.migrationsMissing.length > 0),
    migrations_added: plan.migrationsAdded.map(({ version }) => version).join(",") || "none",
    migrations_missing: plan.migrationsMissing.map(({ version }) => version).join(",") || "none",
    worker_changes: String(plan.restoreTargets.length > 0),
    runtime_health_required: String(
      plan.migrationsAdded.length > 0 || ["leaderboard", "bot", "consumer"].some((key) => plan.workers[key].changed),
    ),
  };
  for (const worker of RELEASE_WORKERS) {
    outputs[`${worker.key}_changed`] = String(plan.workers[worker.key].changed);
    outputs[`${worker.key}_restore_specs`] = plan.workers[worker.key].restoreSpecs;
    console.log(
      `${worker.key}: changed=${plan.workers[worker.key].changed}; ` +
      `captured=${versionSpecs(plan.workers[worker.key].before)}; ` +
      `observed=${versionSpecs(plan.workers[worker.key].after)}`,
    );
  }
  await writeOutputs(outputs);
  console.log(`Observed migrations added: ${outputs.migrations_added}`);
  console.log(`Observed migrations missing: ${outputs.migrations_missing}`);
  console.log(`Workers requiring exact restoration: ${plan.restoreTargets.join(", ") || "none"}`);
  console.log(`Workers still at captured state: ${plan.unchangedWorkers.join(", ") || "none"}`);
  const workerRows = RELEASE_WORKERS.map((worker) => {
    const state = plan.workers[worker.key];
    return `| ${worker.key} | \`${versionSpecs(state.before)}\` | \`${versionSpecs(state.after)}\` | ${state.changed ? "restore" : "unchanged"} |`;
  }).join("\n");
  await appendSummary(
    `## Recovery plan\n\n- Migrations added and retained: ${outputs.migrations_added}\n` +
    `- Migrations unexpectedly missing: ${outputs.migrations_missing}\n` +
    `- Restore exact captured versions: ${plan.restoreTargets.join(", ") || "none"}\n` +
    `- Already at captured versions: ${plan.unchangedWorkers.join(", ") || "none"}\n\n` +
    `| Worker | Captured allocation | Observed allocation | Recovery |\n` +
    `|---|---|---|---|\n${workerRows}`,
  );
}

async function verifyCommand() {
  const baseline = JSON.parse(required(process.env.BASELINE_RELEASE_STATE, "BASELINE_RELEASE_STATE"));
  const current = await fetchReleaseState(environmentStateOptions());
  const comparison = buildRecoveryPlan({ baseline, current, stages: {} });
  if (comparison.migrationsMissing.length > 0) {
    throw new Error(
      `Recovery never rolls back the database, but applied migration history lost: ` +
      comparison.migrationsMissing.map(({ version }) => version).join(", "),
    );
  }
  if (comparison.restoreTargets.length > 0) {
    throw new Error(`Worker state was not restored exactly: ${comparison.restoreTargets.join(", ")}.`);
  }
  console.log(`Exact Worker version state restored: ${stateSummary(current)}`);
  console.log(
    `Database migrations retained: ${comparison.migrationsAdded.map(({ version }) => version).join(",") || "no additions"}`,
  );
  await appendSummary("## Recovery state verification\n\nExact captured Worker version allocations restored. Database migrations were retained.");
}

async function main() {
  const command = process.argv[2];
  if (command === "capture") return captureCommand();
  if (command === "plan") return planCommand();
  if (command === "verify") return verifyCommand();
  throw new Error("Usage: node scripts/release-recovery-state.mjs <capture|plan|verify>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(`::error title=Production release recovery state failed::${error.message}`);
    process.exitCode = 1;
  }
}
