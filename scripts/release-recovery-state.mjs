import { appendFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const RELEASE_WORKERS = Object.freeze([
  { key: "leaderboard", scriptName: "yourrank-site" },
  { key: "bot", scriptName: "yourrank-bot" },
  { key: "consumer", scriptName: "yourrank-consumer" },
  { key: "monitor", scriptName: "yourrank-monitor" },
  { key: "web", scriptName: "yourrank-web" },
]);

// Staging mirrors the production topology one Worker per script with a `-staging`
// suffix, so the same capture/plan/verify/promote machinery certifies the release
// controls against isolated staging resources.
export const STAGING_RELEASE_WORKERS = Object.freeze(
  RELEASE_WORKERS.map((worker) => Object.freeze({ key: worker.key, scriptName: `${worker.scriptName}-staging` })),
);

export const PRODUCTION_SUPABASE_PROJECT_REF = "lygcqzjxlqbvymkfjvel";

export const RELEASE_ENVIRONMENTS = Object.freeze({
  production: Object.freeze({ workers: RELEASE_WORKERS, label: "production" }),
  staging: Object.freeze({ workers: STAGING_RELEASE_WORKERS, label: "staging" }),
});

export function releaseEnvironment(name = "production") {
  const environment = RELEASE_ENVIRONMENTS[name];
  if (!environment) throw new Error(`RELEASE_ENVIRONMENT must be one of ${Object.keys(RELEASE_ENVIRONMENTS).join(", ")}.`);
  return environment;
}

export const BACKEND_WORKERS = Object.freeze(["leaderboard", "bot", "consumer", "monitor"]);

export const RELEASE_STAGES = Object.freeze([
  "migrate",
  "deploy-leaderboard",
  "deploy-bot",
  "deploy-consumer",
  "backend-readiness",
  "deploy-monitor",
  "deploy-web",
  "web-readiness",
  "release-smoke",
]);

const FAILED_RESULTS = new Set(["failure", "cancelled"]);
const VERSION_ID = /^[0-9a-f-]{16,64}$/i;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

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
    const entry = { versionId, percentage };
    if (version.tag !== undefined) entry.tag = version.tag;
    return entry;
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

// Wrangler `deploy --tag <sha>` stores the tag as the `workers/tag` version
// annotation; the Versions API returns annotations on the version object.
export function versionTag(versionPayload) {
  const annotations = versionPayload?.annotations ?? versionPayload?.metadata?.annotations ?? {};
  const tag = annotations["workers/tag"];
  return typeof tag === "string" && tag.length > 0 ? tag : null;
}

export function versionSourceSha(workerState) {
  const tags = new Set(workerState.versions.map((version) => version.tag ?? null));
  if (tags.size !== 1) return null;
  const [tag] = tags;
  return COMMIT_SHA.test(tag ?? "") ? tag : null;
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
  releaseWorkers = RELEASE_WORKERS,
} = {}) {
  const accountId = required(cloudflareAccountId, "CLOUDFLARE_ACCOUNT_ID");
  const cloudflareToken = required(cloudflareApiToken, "CLOUDFLARE_API_TOKEN");
  const projectRef = required(supabaseProjectRef, "SUPABASE_PROJECT_REF");
  const supabaseToken = required(supabaseAccessToken, "SUPABASE_ACCESS_TOKEN");

  const workers = {};
  for (const worker of releaseWorkers) {
    const scriptUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${worker.scriptName}`;
    const payload = await requestJson(`${scriptUrl}/deployments`, cloudflareToken, fetchImpl, `${worker.scriptName} deployments`);
    const state = latestDeploymentState(payload, worker.scriptName);
    for (const version of state.versions) {
      const detail = await requestJson(
        `${scriptUrl}/versions/${version.versionId}`,
        cloudflareToken,
        fetchImpl,
        `${worker.scriptName} version ${version.versionId}`,
      );
      version.tag = versionTag(detail);
    }
    workers[worker.key] = state;
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

export function buildRecoveryPlan({ baseline, current, stages, releaseWorkers = RELEASE_WORKERS }) {
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

  for (const worker of releaseWorkers) {
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

export function buildReleaseManifest({ intendedReleaseSha, state, stages = {}, releaseWorkers = RELEASE_WORKERS, environment = "production" }) {
  if (!COMMIT_SHA.test(intendedReleaseSha ?? "")) throw new Error("intendedReleaseSha must be a full 40-character commit SHA.");
  if (state?.schemaVersion !== 1) throw new Error("Unsupported or missing release-state schema.");
  releaseEnvironment(environment);
  const workers = {};
  const incoherent = [];
  for (const worker of releaseWorkers) {
    const workerState = required(state.workers?.[worker.key], `release state for ${worker.key}`);
    const sourceSha = versionSourceSha(workerState);
    workers[worker.key] = {
      scriptName: worker.scriptName,
      sourceSha,
      allocation: versionSpecs(workerState),
      versions: workerState.versions.map(({ versionId, percentage, tag }) => ({ versionId, percentage, tag: tag ?? null })),
    };
    if (sourceSha !== intendedReleaseSha) incoherent.push(worker.key);
  }
  const stagesFailed = RELEASE_STAGES.filter((stage) => FAILED_RESULTS.has(stages[stage]));
  const stagesIncomplete = RELEASE_STAGES.filter((stage) => stages[stage] !== "success");
  const promoted = incoherent.length === 0 && stagesIncomplete.length === 0;
  const latestMigration = state.migrations.at(-1) ?? null;
  return {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    environment,
    intendedReleaseSha,
    promotedReleaseSha: promoted ? intendedReleaseSha : null,
    promotion: promoted ? "promoted" : "refused",
    incoherentWorkers: incoherent,
    stagesFailed,
    stagesIncomplete,
    workers,
    database: {
      migrationVersion: latestMigration?.version ?? null,
      migrationName: latestMigration?.name ?? null,
      appliedMigrations: state.migrations.length,
    },
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

function environmentName() {
  return process.env.RELEASE_ENVIRONMENT || "production";
}

function environmentStateOptions() {
  const name = environmentName();
  const environment = releaseEnvironment(name);
  const supabaseProjectRef = process.env.SUPABASE_PROJECT_REF;
  if (name !== "production" && supabaseProjectRef === PRODUCTION_SUPABASE_PROJECT_REF) {
    throw new Error(`${name} release state must not read the production Supabase project.`);
  }
  return {
    cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
    supabaseProjectRef,
    supabaseAccessToken: process.env.SUPABASE_ACCESS_TOKEN,
    releaseWorkers: environment.workers,
  };
}

function stateSummary(state, releaseWorkers) {
  return releaseWorkers.map((worker) => {
    const sha = versionSourceSha(state.workers[worker.key]);
    return `${worker.key}=${versionSpecs(state.workers[worker.key])}${sha ? ` (${sha.slice(0, 12)})` : ""}`;
  }).join(", ");
}

async function captureCommand() {
  const options = environmentStateOptions();
  const state = await fetchReleaseState(options);
  await writeOutputs({ state: JSON.stringify(state) });
  console.log(`Captured ${state.migrations.length} applied migrations.`);
  console.log(`Captured Worker versions: ${stateSummary(state, options.releaseWorkers)}`);
  await appendSummary(`## Pre-mutation release state\n\n- Applied migrations: ${state.migrations.length}\n- Worker versions: ${stateSummary(state, options.releaseWorkers)}`);
}

async function planCommand() {
  const baseline = JSON.parse(required(process.env.BASELINE_RELEASE_STATE, "BASELINE_RELEASE_STATE"));
  const stages = JSON.parse(required(process.env.RELEASE_STAGE_RESULTS, "RELEASE_STAGE_RESULTS"));
  const options = environmentStateOptions();
  const current = await fetchReleaseState(options);
  const plan = buildRecoveryPlan({ baseline, current, stages, releaseWorkers: options.releaseWorkers });
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
    web_health_required: String(plan.workers.web.changed),
  };
  for (const worker of options.releaseWorkers) {
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
  const workerRows = options.releaseWorkers.map((worker) => {
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
  const options = environmentStateOptions();
  const current = await fetchReleaseState(options);
  const comparison = buildRecoveryPlan({ baseline, current, stages: {}, releaseWorkers: options.releaseWorkers });
  if (comparison.migrationsMissing.length > 0) {
    throw new Error(
      `Recovery never rolls back the database, but applied migration history lost: ` +
      comparison.migrationsMissing.map(({ version }) => version).join(", "),
    );
  }
  if (comparison.restoreTargets.length > 0) {
    throw new Error(`Worker state was not restored exactly: ${comparison.restoreTargets.join(", ")}.`);
  }
  console.log(`Exact Worker version state restored: ${stateSummary(current, options.releaseWorkers)}`);
  console.log(
    `Database migrations retained: ${comparison.migrationsAdded.map(({ version }) => version).join(",") || "no additions"}`,
  );
  await appendSummary("## Recovery state verification\n\nExact captured Worker version allocations restored. Database migrations were retained.");
}

async function promoteCommand() {
  const intendedReleaseSha = required(process.env.GITHUB_SHA, "GITHUB_SHA");
  const stages = JSON.parse(required(process.env.RELEASE_STAGE_RESULTS, "RELEASE_STAGE_RESULTS"));
  const manifestPath = required(process.env.RELEASE_MANIFEST_PATH, "RELEASE_MANIFEST_PATH");
  const options = environmentStateOptions();
  const environment = environmentName();
  const state = await fetchReleaseState(options);
  const manifest = buildReleaseManifest({ intendedReleaseSha, state, stages, releaseWorkers: options.releaseWorkers, environment });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeOutputs({ promoted: String(manifest.promotion === "promoted"), promoted_release_sha: manifest.promotedReleaseSha ?? "" });
  const rows = options.releaseWorkers.map((worker) => {
    const entry = manifest.workers[worker.key];
    return `| ${worker.key} | \`${entry.allocation}\` | ${entry.sourceSha ? `\`${entry.sourceSha}\`` : "unknown"} | ${entry.sourceSha === intendedReleaseSha ? "coherent" : "INCOHERENT"} |`;
  }).join("\n");
  await appendSummary(
    `## Release provenance (${environment})\n\n- Intended release SHA: \`${intendedReleaseSha}\`\n` +
    `- Promoted release SHA: ${manifest.promotedReleaseSha ? `\`${manifest.promotedReleaseSha}\`` : "none (promotion refused)"}\n` +
    `- Database migration version: ${manifest.database.migrationVersion ?? "unknown"} (${manifest.database.appliedMigrations} applied)\n\n` +
    `| Worker | Active allocation | Source SHA | Coherence |\n|---|---|---|---|\n${rows}`,
  );
  console.log(`Release manifest written to ${manifestPath}`);
  if (manifest.promotion !== "promoted") {
    throw new Error(
      `Release ${intendedReleaseSha} was not promoted: ` +
      `incoherent workers [${manifest.incoherentWorkers.join(", ") || "none"}], ` +
      `incomplete stages [${manifest.stagesIncomplete.join(", ") || "none"}].`,
    );
  }
  console.log(`Promoted release ${intendedReleaseSha}: every ${environment} Worker serves this commit.`);
}

async function main() {
  const command = process.argv[2];
  if (command === "capture") return captureCommand();
  if (command === "plan") return planCommand();
  if (command === "verify") return verifyCommand();
  if (command === "promote") return promoteCommand();
  throw new Error("Usage: node scripts/release-recovery-state.mjs <capture|plan|verify|promote>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(`::error title=${environmentName()} release recovery state failed::${error.message}`);
    process.exitCode = 1;
  }
}
