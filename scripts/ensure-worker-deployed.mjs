// Ensure a Cloudflare Worker's latest uploaded version is the deployed one.
//
// wrangler-action uploads secrets BEFORE deploying, and Cloudflare rejects
// secret edits on a Worker whose latest version was never deployed (code
// 10215) — the remnant left behind whenever a release deploys a new version
// and the finalizer then restores the previous one. With --placeholder a
// missing Worker gets a 503 stub instead (bootstrap only; release jobs must
// not create Workers — a missing script is fine because wrangler deploy
// creates it).
//
//   node scripts/ensure-worker-deployed.mjs <scriptName> [--placeholder]
//
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, WRANGLER_VERSION.
// Only script names, version ids, and status codes are ever printed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const API_BASE = "https://api.cloudflare.com/client/v4";
const COMPATIBILITY_DATE = "2026-08-16";
const PLACEHOLDER_SOURCE =
  'export default { fetch: () => new Response("staging bootstrap placeholder", { status: 503 }) };\n';

export function pickLatestVersion(items) {
  const list = Array.isArray(items) ? items : [];
  let best = null;
  for (const item of list) {
    if (!item?.id) continue;
    const number = typeof item.number === "number" ? item.number : null;
    const created = Date.parse(item?.metadata?.created_on ?? "") || 0;
    if (
      !best ||
      (number !== null && (best.number === null || number > best.number)) ||
      (number === null && best.number === null && created > best.created)
    ) {
      best = { id: item.id, number, created };
    }
  }
  return best?.id ?? null;
}

export function isDeployed(latestId, deployment) {
  const versions = Array.isArray(deployment?.versions) ? deployment.versions : [];
  return versions.some((version) => version?.version_id === latestId);
}

function latestDeployment(deployments) {
  const list = Array.isArray(deployments) ? deployments : [];
  return (
    [...list].sort(
      (a, b) => (Date.parse(b?.created_on ?? "") || 0) - (Date.parse(a?.created_on ?? "") || 0),
    )[0] ?? null
  );
}

async function apiGet(token, accountId, path) {
  const response = await fetch(`${API_BASE}/accounts/${accountId}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function writeTempConfig(scriptName) {
  const dir = mkdtempSync(join(tmpdir(), "ensure-worker-"));
  writeFileSync(join(dir, "worker.mjs"), PLACEHOLDER_SOURCE);
  writeFileSync(
    join(dir, "wrangler.toml"),
    `name = "${scriptName}"\nmain = "worker.mjs"\ncompatibility_date = "${COMPATIBILITY_DATE}"\n`,
  );
  return dir;
}

export async function ensureWorkerDeployed(scriptName, { placeholder = false } = {}) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required.");
  }
  const script = await apiGet(token, accountId, `/workers/scripts/${scriptName}`);
  if (script.status === 404) {
    if (!placeholder) {
      console.log(`${scriptName} does not exist yet — first deploy.`);
      return;
    }
    const dir = writeTempConfig(scriptName);
    runIn(dir, ["deploy"]);
    console.log(`::notice::Created placeholder Worker ${scriptName} — the first staging release replaces it.`);
    return;
  }
  if (script.status !== 200) {
    throw new Error(`Unexpected HTTP ${script.status} checking for ${scriptName}.`);
  }
  const versions = await apiGet(token, accountId, `/workers/scripts/${scriptName}/versions`);
  const latestId = pickLatestVersion(versions.body?.result?.items);
  if (!latestId) throw new Error(`Could not determine the latest version id of ${scriptName}.`);
  const deployments = await apiGet(token, accountId, `/workers/scripts/${scriptName}/deployments`);
  const current = latestDeployment(deployments.body?.result?.deployments);
  if (current && isDeployed(latestId, current)) {
    console.log(`${scriptName} is deployed at its latest version.`);
    return;
  }
  const dir = writeTempConfig(scriptName);
  runIn(dir, ["versions", "deploy", `${latestId}@100%`, "-y"]);
  console.log(`::notice::Deployed pending version ${latestId} of ${scriptName}.`);
}

function runIn(dir, command) {
  const version = process.env.WRANGLER_VERSION;
  if (!version) throw new Error("WRANGLER_VERSION is not set.");
  const result = spawnSync("bunx", [`wrangler@${version}`, ...command], {
    stdio: "inherit",
    cwd: dir,
  });
  if (result.status !== 0) {
    throw new Error(`wrangler ${command.join(" ")} failed (exit ${result.status}).`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const scriptName = args.find((arg) => !arg.startsWith("--"));
  const placeholder = args.includes("--placeholder");
  if (!scriptName) {
    console.error("usage: node scripts/ensure-worker-deployed.mjs <scriptName> [--placeholder]");
    process.exit(1);
  }
  ensureWorkerDeployed(scriptName, { placeholder }).catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
