// Fail-closed release target identity guard.
//
// Every mutation path (production deploy, staging release, staging bootstrap)
// runs this before touching Cloudflare or Supabase so a workflow can never act
// on the wrong environment even when variables are misconfigured or a trigger
// fires from an unexpected ref. Problems are reported by variable NAME only —
// secret values are never printed.
//
//   node scripts/release-target-guard.mjs <staging|production>
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PRODUCTION_RESOURCES } from "./staging-preflight.mjs";

export const PROD_REF = PRODUCTION_RESOURCES.supabaseProjectRef;
export const PROD_HYPERDRIVE = PRODUCTION_RESOURCES.hyperdriveId;
export const PROD_HOSTS = PRODUCTION_RESOURCES.hosts;

const HYPERDRIVE_ID = /^[0-9a-f]{32}$/;
const SUPABASE_REF = /^[a-z]{20}$/;

const present = (env, name) => typeof env[name] === "string" && env[name].trim() !== "";

function parsePostgresUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
    return url;
  } catch {
    return null;
  }
}

// A staging/worker database URL must resolve to the declared staging project
// (Supavisor pooler usernames embed the ref as `postgres.<ref>`; direct hosts
// embed it as `db.<ref>.supabase.co`) and may never contain a production
// identifier.
function checkStagingDbUrl(name, raw, stagingRef, problems) {
  const url = parsePostgresUrl(raw);
  if (!url) {
    problems.push(`${name} is not a postgres:// connection URL.`);
    return;
  }
  const identity = `${url.hostname} ${url.username}`;
  if (SUPABASE_REF.test(stagingRef) && !identity.includes(stagingRef)) {
    problems.push(`${name} does not resolve to STAGING_SUPABASE_PROJECT_REF.`);
  }
  if (raw.includes(PROD_REF) || PROD_HOSTS.some((host) => raw.includes(host))) {
    problems.push(`${name} references a production resource.`);
  }
}

function evaluateProduction(env, problems) {
  if (env.GITHUB_REF !== "refs/heads/main") {
    problems.push("GITHUB_REF is not refs/heads/main; production releases only run from main.");
  }
  if (!["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME ?? "")) {
    problems.push("GITHUB_EVENT_NAME must be push or workflow_dispatch for a production release.");
  }
  if (env.SUPABASE_PROJECT_REF !== PROD_REF) {
    problems.push("SUPABASE_PROJECT_REF is not the production project ref.");
  }
  for (const name of Object.keys(env)) {
    if (name.startsWith("STAGING_")) problems.push(`Staging variable ${name} leaked into a production release.`);
  }
  if (present(env, "SUPABASE_DB_URL")) {
    const url = parsePostgresUrl(env.SUPABASE_DB_URL);
    if (!url) {
      problems.push("SUPABASE_DB_URL is not a postgres:// connection URL.");
    } else {
      const identity = `${url.hostname} ${url.username}`;
      if (!identity.includes(PROD_REF)) problems.push("SUPABASE_DB_URL does not resolve to the production project ref.");
      if (env.SUPABASE_DB_URL.includes("staging")) problems.push("SUPABASE_DB_URL references a staging resource.");
    }
  }
}

function evaluateStaging(env, problems) {
  const ref = env.STAGING_SUPABASE_PROJECT_REF ?? "";
  if (!SUPABASE_REF.test(ref)) problems.push("STAGING_SUPABASE_PROJECT_REF is not a valid Supabase project ref.");
  else if (ref === PROD_REF) problems.push("STAGING_SUPABASE_PROJECT_REF is the production project.");

  if (present(env, "STAGING_HYPERDRIVE_ID")) {
    if (!HYPERDRIVE_ID.test(env.STAGING_HYPERDRIVE_ID)) problems.push("STAGING_HYPERDRIVE_ID is not a 32-character hex Cloudflare id.");
    else if (env.STAGING_HYPERDRIVE_ID === PROD_HYPERDRIVE) problems.push("STAGING_HYPERDRIVE_ID is the production Hyperdrive id.");
  }

  // Production DB names must never be visible to a staging release.
  for (const name of ["SUPABASE_DB_URL", "DATABASE_URL"]) {
    if (present(env, name)) problems.push(`Production database variable ${name} must not be present in a staging release.`);
  }

  if (!present(env, "STAGING_DATABASE_URL")) {
    problems.push("STAGING_DATABASE_URL is required for staging releases.");
  } else {
    checkStagingDbUrl("STAGING_DATABASE_URL", env.STAGING_DATABASE_URL, ref, problems);
    for (const name of ["SUPABASE_DB_URL", "DATABASE_URL"]) {
      if (present(env, name) && env[name] === env.STAGING_DATABASE_URL) {
        problems.push(`STAGING_DATABASE_URL must not equal ${name}.`);
      }
    }
  }

  // The Hyperdrive bootstrap URL is only needed by staging-bootstrap; validate it
  // under the same contract whenever it is provided.
  if (present(env, "STAGING_WORKER_DATABASE_URL")) {
    checkStagingDbUrl("STAGING_WORKER_DATABASE_URL", env.STAGING_WORKER_DATABASE_URL, ref, problems);
  }

  for (const name of ["STAGING_WEB_URL", "STAGING_MONITOR_URL"]) {
    if (!present(env, name)) continue;
    let url;
    try {
      url = new URL(env[name]);
    } catch {
      problems.push(`${name} is not a valid URL.`);
      continue;
    }
    if (PROD_HOSTS.includes(url.hostname)) problems.push(`${name} points at production host ${url.hostname}.`);
  }

  // A production billing server must never be reachable from a staging release.
  if (env.POLAR_SERVER === "production") problems.push("POLAR_SERVER is \"production\" in a staging release.");
}

// Returns a list of problems (variable names only); empty means the environment
// identity is safe for the requested mode.
export function evaluate(mode, env) {
  const problems = [];
  if (env.RELEASE_ENVIRONMENT !== mode) {
    problems.push(`RELEASE_ENVIRONMENT must be "${mode}" for this release path.`);
  }
  if (mode === "production") evaluateProduction(env, problems);
  else if (mode === "staging") evaluateStaging(env, problems);
  else problems.push(`Unknown release target "${mode}".`);
  return problems;
}

function main() {
  const mode = process.argv[2];
  if (!["staging", "production"].includes(mode)) {
    throw new Error("Usage: node scripts/release-target-guard.mjs <staging|production>");
  }
  const problems = evaluate(mode, process.env);
  for (const problem of problems) console.error(`::error title=Release target guard::${problem}`);
  if (problems.length > 0) {
    console.error(`::error title=Release target guard::Refusing to release: ${problems.length} identity problem(s).`);
    process.exitCode = 1;
    return;
  }
  console.log(`Release target "${mode}" verified: environment identity is coherent.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(`::error title=Release target guard::${error.message}`);
    process.exitCode = 1;
  }
}
