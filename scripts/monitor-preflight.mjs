// F-013/F-014/F-049: executable uptime-monitor configuration preflight.
//
// The monitor is the component that proves recovery still works and alerts when
// that proof goes stale, so its security-critical configuration must be verified
// before any release mutation rather than described in wrangler.toml comments.
//
//   node scripts/monitor-preflight.mjs <production|staging>
//
// Inputs (names only — values are never printed):
//   MONITOR_CHECK_SECRET_PRESENT   "true" when the GitHub environment holds the
//                                  secret the release pushes to the Worker
//   WORKER_SECRET_LIST             optional JSON from `wrangler secret list` for the
//                                  deployed Worker; when set the deployed secret
//                                  names are validated as well
//   DISABLED_INTEGRATIONS          staging only: comma list of intentionally
//                                  disabled alert integrations
//                                  (discord-monitoring, monitor-email)
//
// Contract:
//   * MONITOR_TARGET is https and points at the right host for the environment
//   * MONITOR_BACKUP_CHECK is explicitly "true" (production may never opt out)
//   * MONITOR_CHECK_SECRET exists — /check fails closed without it
//   * at least one alert path (Discord webhook, or Resend + recipient) exists;
//     staging may declare alert integrations disabled, production may not
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseToml, parseSecretNames } from "./staging-preflight.mjs";

export const MONITOR_CONFIG_PATH = "apps/monitor/wrangler.toml";

export const MONITOR_ENVIRONMENTS = Object.freeze({
  production: Object.freeze({
    scriptName: "yourrank-monitor",
    varsTable: "vars",
    triggersTable: "triggers",
    targetHost: "yourrank.site",
    allowDisabledAlerts: false,
  }),
  staging: Object.freeze({
    scriptName: "yourrank-monitor-staging",
    varsTable: "env.staging.vars",
    triggersTable: "env.staging.triggers",
    targetHost: "staging.yourrank.site",
    allowDisabledAlerts: true,
  }),
});

export const MONITOR_ALERT_INTEGRATIONS = Object.freeze({
  "discord-monitoring": Object.freeze(["DISCORD_MONITORING_WEBHOOK"]),
  "monitor-email": Object.freeze(["RESEND_API_KEY", "ALERT_EMAIL"]),
});

export const MONITOR_REQUIRED_SECRETS = Object.freeze(["MONITOR_CHECK_SECRET"]);
export const MONITOR_FORBIDDEN_SECRETS = Object.freeze(["DATABASE_URL", "HYPERDRIVE"]);

function table(parsed, path) {
  const matches = parsed.tables.filter((candidate) => candidate.path === path);
  return matches.length === 1 ? matches[0].entries : null;
}

export function checkMonitorConfig(source, environment) {
  const spec = MONITOR_ENVIRONMENTS[environment];
  if (!spec) throw new Error(`Unknown monitor environment ${environment}.`);
  const problems = [];
  const parsed = parseToml(source);
  const root = table(parsed, "");
  const name = environment === "production" ? root?.name : table(parsed, "env.staging")?.name;
  if (name !== spec.scriptName) problems.push(`${MONITOR_CONFIG_PATH}: ${environment} Worker name must be ${spec.scriptName} (got ${name ?? "none"}).`);

  const vars = table(parsed, spec.varsTable);
  if (!vars) {
    problems.push(`${MONITOR_CONFIG_PATH}: [${spec.varsTable}] table is missing.`);
    return problems;
  }
  let target;
  try {
    target = new URL(String(vars.MONITOR_TARGET ?? ""));
  } catch {
    problems.push(`${MONITOR_CONFIG_PATH}: ${spec.varsTable}.MONITOR_TARGET is not a valid URL.`);
  }
  if (target) {
    if (target.protocol !== "https:") problems.push(`${MONITOR_CONFIG_PATH}: ${spec.varsTable}.MONITOR_TARGET must use https.`);
    if (target.hostname !== spec.targetHost) problems.push(`${MONITOR_CONFIG_PATH}: ${spec.varsTable}.MONITOR_TARGET must point at ${spec.targetHost} (got ${target.hostname}).`);
  }
  if (vars.MONITOR_BACKUP_CHECK !== "true") {
    problems.push(`${MONITOR_CONFIG_PATH}: ${spec.varsTable}.MONITOR_BACKUP_CHECK must be explicitly "true" so backup-freshness monitoring cannot be silently skipped (got ${vars.MONITOR_BACKUP_CHECK === undefined ? "unset" : JSON.stringify(vars.MONITOR_BACKUP_CHECK)}).`);
  }
  for (const secretName of [...MONITOR_REQUIRED_SECRETS, ...Object.values(MONITOR_ALERT_INTEGRATIONS).flat()]) {
    if (secretName in vars) problems.push(`${MONITOR_CONFIG_PATH}: ${secretName} must be a Worker secret, not a plaintext var in ${spec.varsTable}.`);
  }
  const triggers = table(parsed, spec.triggersTable);
  if (!triggers || !Array.isArray(triggers.crons)) {
    problems.push(`${MONITOR_CONFIG_PATH}: [${spec.triggersTable}] crons must be declared explicitly.`);
  } else if (environment === "production" && triggers.crons.length === 0) {
    problems.push(`${MONITOR_CONFIG_PATH}: production monitor must keep a cron schedule.`);
  }
  return problems;
}

export function parseDisabledAlertIntegrations(value) {
  const names = String(value ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  const relevant = names.filter((name) => MONITOR_ALERT_INTEGRATIONS[name]);
  return new Set(relevant);
}

export function checkMonitorSecrets(secretNames, environment, disabledIntegrations = new Set()) {
  const spec = MONITOR_ENVIRONMENTS[environment];
  if (!spec) throw new Error(`Unknown monitor environment ${environment}.`);
  const problems = [];
  const names = new Set(secretNames);
  for (const secretName of MONITOR_REQUIRED_SECRETS) {
    if (!names.has(secretName)) problems.push(`${spec.scriptName}: required secret ${secretName} is not set; /check would fail closed and the release cannot trigger monitor checks.`);
  }
  for (const secretName of MONITOR_FORBIDDEN_SECRETS) {
    if (names.has(secretName)) problems.push(`${spec.scriptName}: forbidden secret ${secretName} is set; the monitor must not hold database credentials.`);
  }
  const report = [];
  let alertPaths = 0;
  for (const [integration, required] of Object.entries(MONITOR_ALERT_INTEGRATIONS)) {
    const missing = required.filter((secretName) => !names.has(secretName));
    if (missing.length === 0) {
      alertPaths += 1;
      report.push(`${integration}: CONFIGURED`);
    } else if (disabledIntegrations.has(integration)) {
      if (!spec.allowDisabledAlerts) problems.push(`${spec.scriptName}: alert integration ${integration} cannot be disabled in production.`);
      else report.push(`${integration}: INTENTIONALLY DISABLED`);
    } else {
      report.push(`${integration}: NOT CONFIGURED (missing ${missing.join(", ")})`);
    }
  }
  if (alertPaths === 0 && !spec.allowDisabledAlerts) {
    problems.push(`${spec.scriptName}: no alert path is configured (need DISCORD_MONITORING_WEBHOOK or RESEND_API_KEY + ALERT_EMAIL); failures would go unalerted.`);
  }
  if (alertPaths === 0 && spec.allowDisabledAlerts) {
    const declared = Object.keys(MONITOR_ALERT_INTEGRATIONS).every((integration) => disabledIntegrations.has(integration));
    if (!declared) problems.push(`${spec.scriptName}: no alert path is configured and not every alert integration is declared in DISABLED_INTEGRATIONS.`);
  }
  return { problems, report, alertPaths };
}

export function checkMonitorEnvironment(env, environment) {
  const spec = MONITOR_ENVIRONMENTS[environment];
  if (!spec) throw new Error(`Unknown monitor environment ${environment}.`);
  const problems = [];
  if (env.MONITOR_CHECK_SECRET_PRESENT !== "true") {
    problems.push(`GitHub ${environment} environment: MONITOR_CHECK_SECRET is not set (set it as an environment secret; the release pushes it to ${spec.scriptName}).`);
  }
  return problems;
}

function fail(problems) {
  for (const problem of problems) console.error(`::error title=Monitor preflight::${problem}`);
  throw new Error(`Monitor preflight failed with ${problems.length} problem(s).`);
}

async function main() {
  const environment = process.argv[2];
  if (!MONITOR_ENVIRONMENTS[environment]) {
    throw new Error("Usage: node scripts/monitor-preflight.mjs <production|staging>");
  }
  const source = await readFile(resolve(process.cwd(), MONITOR_CONFIG_PATH), "utf8");
  const problems = [
    ...checkMonitorConfig(source, environment),
    ...checkMonitorEnvironment(process.env, environment),
  ];
  if (process.env.WORKER_SECRET_LIST !== undefined) {
    const names = parseSecretNames(process.env.WORKER_SECRET_LIST);
    // Pre-mutation the release has not pushed MONITOR_CHECK_SECRET yet; the GitHub
    // environment secret it will push counts. Post-deploy (REQUIRE_DEPLOYED_SECRETS)
    // only the names actually present on the Worker count.
    if (process.env.REQUIRE_DEPLOYED_SECRETS !== "true" && process.env.MONITOR_CHECK_SECRET_PRESENT === "true") {
      names.push("MONITOR_CHECK_SECRET");
    }
    const disabled = parseDisabledAlertIntegrations(process.env.DISABLED_INTEGRATIONS);
    const secrets = checkMonitorSecrets(names, environment, disabled);
    for (const line of secrets.report) console.log(`${MONITOR_ENVIRONMENTS[environment].scriptName}: ${line}`);
    problems.push(...secrets.problems);
  }
  if (problems.length > 0) fail(problems);
  console.log(`Monitor preflight OK (${environment}): explicit backup-check policy, /check secret present, target ${MONITOR_ENVIRONMENTS[environment].targetHost}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(`::error title=Monitor preflight failed::${error.message}`);
    process.exitCode = 1;
  }
}
