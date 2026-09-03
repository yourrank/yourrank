// F-012: executable staging release preflight.
//
// Staging is the only environment where the F-003/F-004/F-005/F-009 release
// controls can be exercised before production, so its infrastructure must be
// structurally equivalent to production while never touching a production
// resource. This script is the single fail-closed contract for that:
//
//   config          parse every [env.staging] Worker config and refuse placeholder,
//                   production, or mismatched bindings (Hyperdrive, queues, DLQ,
//                   Durable Objects, routes, service bindings, vars, crons).
//   environment     validate the GitHub `staging` environment contract (vars and
//                   secrets) by name only; values are never printed.
//   render          write the real staging Hyperdrive id (STAGING_HYPERDRIVE_ID)
//                   into the checked-out Worker configs and prove no placeholder
//                   remains before any `wrangler deploy --env staging`.
//   worker-secrets  validate the secret *names* present on a deployed staging
//                   Worker (from `wrangler secret list --env staging`) against the
//                   required / integration / forbidden contract.
//
// Integrations that are intentionally disabled in staging must be declared in the
// STAGING_DISABLED_INTEGRATIONS variable; an undeclared missing integration fails.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PRODUCTION_SUPABASE_PROJECT_REF, RELEASE_WORKERS } from "./release-recovery-state.mjs";

export const STAGING_HYPERDRIVE_PLACEHOLDER = "STAGING_HYPERDRIVE_ID_PLACEHOLDER";
export const STAGING_HOST = "staging.yourrank.site";
export const STAGING_ZONE = "yourrank.site";

// Known production resources. Staging must never reference any of them.
export const PRODUCTION_RESOURCES = Object.freeze({
  hyperdriveId: "9e5b625bfdd84cd691b44c4780bdaf13",
  supabaseProjectRef: PRODUCTION_SUPABASE_PROJECT_REF,
  queues: Object.freeze(["yourrank-events", "yourrank-events-dlq"]),
  workers: Object.freeze(RELEASE_WORKERS.map((worker) => worker.scriptName)),
  hosts: Object.freeze(["yourrank.site", "app.yourrank.site", "next.yourrank.site"]),
});

export const STAGING_QUEUES = Object.freeze({ events: "yourrank-events-staging", dlq: "yourrank-events-staging-dlq" });

// Per-Worker staging topology expected by the application code.
export const STAGING_WORKERS = Object.freeze([
  {
    key: "leaderboard",
    config: "apps/leaderboard/wrangler.toml",
    scriptName: "yourrank-site-staging",
    hyperdrive: true,
    routes: true,
    queueProducer: true,
    queueConsumer: false,
    durableObjects: Object.freeze({ RATE_LIMITER_DO: "RateLimiter", LIVE_BOARD_DO: "LiveBoard" }),
    services: Object.freeze({ MARKETING: "yourrank-web-staging" }),
    vars: Object.freeze({ ENVIRONMENT: "staging", SESSION_COOKIE_DOMAIN: `.${STAGING_HOST}`, ALLOW_DEMO_LOGIN: "false" }),
    assets: false,
    // Secrets pushed by the staging release from the GitHub `staging` environment.
    requiredSecrets: Object.freeze(["RESEND_API_KEY", "MAIL_FROM", "TOKEN_ENC_KEY"]),
    // Secrets that would enable production-only side effects (custom-domain /
    // registrar automation against the shared Cloudflare zone).
    forbiddenSecrets: Object.freeze(["DATABASE_URL", "CF_API_TOKEN"]),
    integrations: Object.freeze(["telegram", "kick", "discord-monitoring", "lead-webhook", "nowpayments"]),
  },
  {
    key: "bot",
    config: "apps/bot/wrangler.toml",
    scriptName: "yourrank-bot-staging",
    hyperdrive: true,
    routes: true,
    queueProducer: true,
    queueConsumer: false,
    durableObjects: Object.freeze({ RATE_LIMITER_DO: "RateLimiter" }),
    services: Object.freeze({}),
    vars: Object.freeze({
      PUBLIC_BASE_URL: `https://${STAGING_HOST}`,
      SESSION_COOKIE_DOMAIN: `.${STAGING_HOST}`,
      RL_FAIL_OPEN: "false",
      POSTBACK_UNSIGNED_ENABLED: "false",
    }),
    assets: false,
    requiredSecrets: Object.freeze(["TOKEN_ENC_KEY", "IP_HASH_SALT"]),
    forbiddenSecrets: Object.freeze(["DATABASE_URL", "ALLOW_DEV_LOGIN"]),
    integrations: Object.freeze(["telegram", "discord-monitoring", "sentry"]),
  },
  {
    key: "consumer",
    config: "apps/consumer/wrangler.toml",
    scriptName: "yourrank-consumer-staging",
    hyperdrive: true,
    routes: true,
    queueProducer: true,
    queueConsumer: true,
    durableObjects: Object.freeze({ RATE_LIMITER_DO: "RateLimiter" }),
    services: Object.freeze({}),
    vars: Object.freeze({ RL_FAIL_OPEN: "false" }),
    assets: false,
    requiredSecrets: Object.freeze([]),
    forbiddenSecrets: Object.freeze(["DATABASE_URL"]),
    integrations: Object.freeze(["discord-monitoring"]),
  },
  {
    key: "monitor",
    config: "apps/monitor/wrangler.toml",
    scriptName: "yourrank-monitor-staging",
    hyperdrive: false,
    routes: false,
    queueProducer: false,
    queueConsumer: false,
    durableObjects: Object.freeze({}),
    services: Object.freeze({}),
    vars: Object.freeze({ MONITOR_TARGET: `https://${STAGING_HOST}` }),
    assets: false,
    // With staging crons disabled, /check is the deterministic manual trigger and
    // must stay protected.
    requiredSecrets: Object.freeze(["MONITOR_CHECK_SECRET"]),
    forbiddenSecrets: Object.freeze(["DATABASE_URL"]),
    integrations: Object.freeze(["discord-monitoring", "monitor-email"]),
  },
  {
    key: "web",
    config: "apps/web/wrangler.toml",
    scriptName: "yourrank-web-staging",
    hyperdrive: true,
    routes: false,
    queueProducer: false,
    queueConsumer: false,
    durableObjects: Object.freeze({}),
    services: Object.freeze({}),
    vars: Object.freeze({}),
    assets: true,
    requiredSecrets: Object.freeze([]),
    forbiddenSecrets: Object.freeze(["DATABASE_URL"]),
    integrations: Object.freeze([]),
  },
]);

// External integrations and the Worker secret names they need. Each integration is
// either fully configured on the Worker or explicitly declared disabled.
export const STAGING_INTEGRATIONS = Object.freeze({
  telegram: Object.freeze(["LOGIN_BOT_TOKEN", "LOGIN_BOT_USERNAME"]),
  kick: Object.freeze(["KICK_WEBHOOK_PUBLIC_KEY"]),
  nowpayments: Object.freeze(["NOWPAYMENTS_API_KEY", "NOWPAYMENTS_IPN_SECRET"]),
  "discord-monitoring": Object.freeze(["DISCORD_MONITORING_WEBHOOK"]),
  "lead-webhook": Object.freeze(["LEAD_WEBHOOK_URL"]),
  sentry: Object.freeze(["SENTRY_DSN"]),
  "monitor-email": Object.freeze(["RESEND_API_KEY", "ALERT_EMAIL", "ALERT_FROM"]),
});

// GitHub `staging` environment contract (names only).
export const STAGING_ENVIRONMENT_CONTRACT = Object.freeze({
  requiredVars: Object.freeze([
    "STAGING_HYPERDRIVE_ID",
    "STAGING_SUPABASE_PROJECT_REF",
    "STAGING_WEB_URL",
    "STAGING_MONITOR_URL",
  ]),
  requiredSecrets: Object.freeze([
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "STAGING_SUPABASE_ACCESS_TOKEN",
    "STAGING_SUPABASE_DB_PASSWORD",
    "STAGING_RESEND_API_KEY",
    "STAGING_MAIL_FROM",
    "STAGING_TOKEN_ENC_KEY",
    "STAGING_IP_HASH_SALT",
    "STAGING_MONITOR_CHECK_SECRET",
  ]),
  optionalVars: Object.freeze(["STAGING_DISABLED_INTEGRATIONS", "CLOUDFLARE_WORKERS_PLAN"]),
  // Production-only names must never be present in the staging environment.
  forbiddenNames: Object.freeze(["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_REF", "DATABASE_URL"]),
});

const HYPERDRIVE_ID = /^[0-9a-f]{32}$/;
const SUPABASE_REF = /^[a-z]{20}$/;
const HEX_64 = /^[0-9a-f]{64}$/i;

// ---------------------------------------------------------------------------
// Minimal TOML reader: enough for Wrangler configs (tables, array tables, strings,
// booleans, numbers, arrays of strings, arrays of inline tables).
// ---------------------------------------------------------------------------

function stripComment(line) {
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index - 1] !== "\\") inString = !inString;
    if (char === "#" && !inString) return line.slice(0, index);
  }
  return line;
}

function bracketDepth(text) {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && text[index - 1] !== "\\") inString = !inString;
    if (inString) continue;
    if (char === "[" || char === "{") depth += 1;
    if (char === "]" || char === "}") depth -= 1;
  }
  return depth;
}

function parseValue(raw) {
  const text = raw.trim();
  if (text.startsWith('"')) return JSON.parse(text);
  if (text === "true" || text === "false") return text === "true";
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text.startsWith("[")) {
    const body = text.slice(1, -1).trim();
    if (!body) return [];
    if (body.startsWith("{")) {
      return [...body.matchAll(/\{([^}]*)\}/g)].map((match) => parseInlineTable(match[1]));
    }
    return [...body.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => JSON.parse(`"${match[1]}"`));
  }
  if (text.startsWith("{")) return parseInlineTable(text.slice(1, -1));
  return text;
}

function parseInlineTable(body) {
  const table = {};
  for (const match of body.matchAll(/([A-Za-z0-9_-]+)\s*=\s*("(?:\\.|[^"\\])*"|[^,]+)/g)) {
    table[match[1]] = parseValue(match[2]);
  }
  return table;
}

// Returns { tables: [{ path, array, entries }] } preserving declaration order.
export function parseToml(source) {
  const tables = [];
  let current = { path: "", array: false, entries: {} };
  tables.push(current);
  const lines = source.split(/\r?\n/);
  let pending = "";
  for (const rawLine of lines) {
    const line = pending ? `${pending}\n${stripComment(rawLine)}` : stripComment(rawLine);
    pending = "";
    if (!line.trim()) continue;
    const trimmed = line.trim();
    const arrayHeader = trimmed.match(/^\[\[\s*([A-Za-z0-9_.-]+)\s*\]\]$/);
    const tableHeader = trimmed.match(/^\[\s*([A-Za-z0-9_.-]+)\s*\]$/);
    if (arrayHeader || tableHeader) {
      current = { path: (arrayHeader ?? tableHeader)[1], array: Boolean(arrayHeader), entries: {} };
      tables.push(current);
      continue;
    }
    if (bracketDepth(line) > 0) {
      pending = line;
      continue;
    }
    const assignment = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*([\s\S]+)$/);
    if (!assignment) throw new Error(`Unparseable wrangler.toml line: ${trimmed.slice(0, 80)}`);
    current.entries[assignment[1]] = parseValue(assignment[2]);
  }
  if (pending) throw new Error("Unterminated array or inline table in wrangler.toml.");
  return { tables };
}

function stagingTables(parsed, suffix) {
  const path = suffix ? `env.staging.${suffix}` : "env.staging";
  return parsed.tables.filter((table) => table.path === path);
}

function singleTable(parsed, suffix) {
  const matches = stagingTables(parsed, suffix);
  return matches.length === 1 ? matches[0].entries : null;
}

// ---------------------------------------------------------------------------
// Static config contract
// ---------------------------------------------------------------------------

export function checkStagingConfig(worker, source) {
  const problems = [];
  const parsed = parseToml(source);
  const root = singleTable(parsed, "");
  if (!root) {
    problems.push(`${worker.config}: missing [env.staging] table.`);
    return problems;
  }
  if (root.name !== worker.scriptName) {
    problems.push(`${worker.config}: [env.staging] name must be "${worker.scriptName}", found "${root.name ?? "none"}".`);
  }
  if (PRODUCTION_RESOURCES.workers.includes(root.name)) {
    problems.push(`${worker.config}: staging Worker name "${root.name}" is a production Worker.`);
  }

  const stagingSource = source.slice(source.search(/^\s*\[env\.staging\]/m));
  if (/localConnectionString/.test(stagingSource)) {
    problems.push(`${worker.config}: [env.staging] must not define a direct database connection string.`);
  }
  const stagingWithoutZones = stagingSource.replace(/zone_name\s*=\s*"[^"]*"/g, "");
  for (const host of PRODUCTION_RESOURCES.hosts) {
    const escaped = host.replaceAll(".", "\\.");
    if (new RegExp(`(https?://${escaped}|"${escaped}/|"${escaped}")`).test(stagingWithoutZones)) {
      problems.push(`${worker.config}: [env.staging] references production host ${host}.`);
    }
  }

  // Hyperdrive
  const hyperdrives = stagingTables(parsed, "hyperdrive");
  if (worker.hyperdrive) {
    if (hyperdrives.length !== 1) {
      problems.push(`${worker.config}: expected exactly one [[env.staging.hyperdrive]] binding, found ${hyperdrives.length}.`);
    } else {
      const { binding, id } = hyperdrives[0].entries;
      if (binding !== "HYPERDRIVE") problems.push(`${worker.config}: staging Hyperdrive binding must be HYPERDRIVE.`);
      if (id === STAGING_HYPERDRIVE_PLACEHOLDER) {
        problems.push(`${worker.config}: staging Hyperdrive id is still ${STAGING_HYPERDRIVE_PLACEHOLDER}; run staging-preflight render with STAGING_HYPERDRIVE_ID.`);
      } else if (!HYPERDRIVE_ID.test(String(id ?? ""))) {
        problems.push(`${worker.config}: staging Hyperdrive id is not a 32-character hex Cloudflare id.`);
      } else if (id === PRODUCTION_RESOURCES.hyperdriveId) {
        problems.push(`${worker.config}: staging Hyperdrive id is the PRODUCTION Hyperdrive config.`);
      }
    }
  } else if (hyperdrives.length > 0) {
    problems.push(`${worker.config}: ${worker.key} must not bind Hyperdrive in staging.`);
  }

  // Queues
  const producers = stagingTables(parsed, "queues.producers").map((table) => table.entries);
  const consumers = stagingTables(parsed, "queues.consumers").map((table) => table.entries);
  for (const entry of [...producers, ...consumers]) {
    for (const queue of [entry.queue, entry.dead_letter_queue].filter(Boolean)) {
      if (PRODUCTION_RESOURCES.queues.includes(queue)) problems.push(`${worker.config}: staging binds PRODUCTION queue ${queue}.`);
    }
  }
  if (worker.queueProducer) {
    const producer = producers.find((entry) => entry.binding === "EVENTS_QUEUE");
    if (!producer) problems.push(`${worker.config}: missing [[env.staging.queues.producers]] binding EVENTS_QUEUE.`);
    else if (producer.queue !== STAGING_QUEUES.events) {
      problems.push(`${worker.config}: EVENTS_QUEUE must produce to ${STAGING_QUEUES.events}, found ${producer.queue}.`);
    }
  } else if (producers.length > 0) {
    problems.push(`${worker.config}: ${worker.key} must not produce to a queue in staging.`);
  }
  if (worker.queueConsumer) {
    const primary = consumers.find((entry) => entry.queue === STAGING_QUEUES.events);
    const dlq = consumers.find((entry) => entry.queue === STAGING_QUEUES.dlq);
    if (!primary) problems.push(`${worker.config}: missing staging consumer for ${STAGING_QUEUES.events}.`);
    else {
      if (primary.dead_letter_queue !== STAGING_QUEUES.dlq) {
        problems.push(`${worker.config}: ${STAGING_QUEUES.events} consumer must dead-letter to ${STAGING_QUEUES.dlq}.`);
      }
      if (!(Number(primary.max_retries) > 0)) problems.push(`${worker.config}: ${STAGING_QUEUES.events} consumer must retry before dead-lettering.`);
    }
    if (!dlq) problems.push(`${worker.config}: missing staging DLQ consumer for ${STAGING_QUEUES.dlq}.`);
    else if (Number(dlq.max_retries) !== 0) problems.push(`${worker.config}: DLQ consumer must not retry (max_retries = 0).`);
  } else if (consumers.length > 0) {
    problems.push(`${worker.config}: ${worker.key} must not consume a queue in staging.`);
  }

  // Durable Objects
  const bindings = stagingTables(parsed, "durable_objects.bindings").map((table) => table.entries);
  const expectedClasses = Object.values(worker.durableObjects);
  for (const [name, className] of Object.entries(worker.durableObjects)) {
    const binding = bindings.find((entry) => entry.name === name);
    if (!binding) problems.push(`${worker.config}: missing staging Durable Object binding ${name}.`);
    else if (binding.class_name !== className) {
      problems.push(`${worker.config}: Durable Object ${name} must bind class ${className}, found ${binding.class_name}.`);
    } else if (binding.script_name && binding.script_name !== worker.scriptName) {
      problems.push(`${worker.config}: Durable Object ${name} points at another script (${binding.script_name}).`);
    }
  }
  for (const binding of bindings) {
    if (!worker.durableObjects[binding.name]) problems.push(`${worker.config}: unexpected staging Durable Object binding ${binding.name}.`);
  }
  if (expectedClasses.length > 0) {
    const migrations = stagingTables(parsed, "migrations").map((table) => table.entries);
    const declared = new Set(migrations.flatMap((entry) => [...(entry.new_sqlite_classes ?? []), ...(entry.new_classes ?? [])]));
    const tags = migrations.map((entry) => entry.tag);
    if (migrations.length === 0 || tags.some((tag) => !tag)) {
      problems.push(`${worker.config}: staging Durable Object migrations must declare a tag for every entry.`);
    }
    if (new Set(tags).size !== tags.length) problems.push(`${worker.config}: duplicate staging Durable Object migration tags.`);
    for (const className of expectedClasses) {
      if (!declared.has(className)) problems.push(`${worker.config}: staging migrations never create Durable Object class ${className}.`);
    }
  }

  // Routes
  const routes = Array.isArray(root.routes) ? root.routes : [];
  if (worker.routes) {
    if (routes.length === 0) problems.push(`${worker.config}: ${worker.key} must define staging routes on ${STAGING_HOST}.`);
    for (const route of routes) {
      const pattern = String(route.pattern ?? "");
      if (!pattern.startsWith(`${STAGING_HOST}/`)) problems.push(`${worker.config}: staging route ${pattern} is not on ${STAGING_HOST}.`);
      if (route.zone_name !== STAGING_ZONE) problems.push(`${worker.config}: staging route ${pattern} must use zone ${STAGING_ZONE}.`);
    }
  } else if (routes.length > 0 || stagingTables(parsed, "routes").length > 0) {
    problems.push(`${worker.config}: ${worker.key} must not define staging routes; it is reached via workers.dev or service binding.`);
  }

  // Service bindings
  const services = stagingTables(parsed, "services").map((table) => table.entries);
  for (const [binding, service] of Object.entries(worker.services)) {
    const entry = services.find((candidate) => candidate.binding === binding);
    if (!entry) problems.push(`${worker.config}: missing staging service binding ${binding}.`);
    else if (entry.service !== service) problems.push(`${worker.config}: service binding ${binding} must target ${service}, found ${entry.service}.`);
  }
  for (const entry of services) {
    if (PRODUCTION_RESOURCES.workers.includes(entry.service)) problems.push(`${worker.config}: staging service binding ${entry.binding} targets PRODUCTION Worker ${entry.service}.`);
  }

  // Vars
  const vars = singleTable(parsed, "vars") ?? {};
  for (const [name, expected] of Object.entries(worker.vars)) {
    if (vars[name] !== expected) problems.push(`${worker.config}: [env.staging.vars] ${name} must be "${expected}", found "${vars[name] ?? "unset"}".`);
  }

  // Crons: staging schedules are intentionally disabled; the table must exist so
  // the policy is explicit rather than silently inherited from production.
  const triggers = singleTable(parsed, "triggers");
  if (!triggers || !Array.isArray(triggers.crons)) {
    problems.push(`${worker.config}: [env.staging.triggers] must declare crons explicitly (crons = [] disables staging schedules).`);
  } else if (triggers.crons.length > 0) {
    problems.push(`${worker.config}: staging crons must be disabled (crons = []); cron handlers are exercised locally with wrangler dev --test-scheduled.`);
  }

  // Assets (Web)
  if (worker.assets) {
    const assets = singleTable(parsed, "assets");
    if (!assets || assets.binding !== "ASSETS") problems.push(`${worker.config}: missing [env.staging.assets] binding ASSETS.`);
  }

  return problems;
}

export async function checkStagingConfigs(readConfig = defaultReadConfig) {
  const problems = [];
  for (const worker of STAGING_WORKERS) {
    problems.push(...checkStagingConfig(worker, await readConfig(worker.config)));
  }
  return problems;
}

async function defaultReadConfig(path) {
  return readFile(resolve(process.cwd(), path), "utf8");
}

// ---------------------------------------------------------------------------
// Hyperdrive rendering
// ---------------------------------------------------------------------------

export function renderStagingHyperdrive(source, hyperdriveId, configPath = "wrangler.toml") {
  if (!HYPERDRIVE_ID.test(hyperdriveId ?? "")) throw new Error("STAGING_HYPERDRIVE_ID must be a 32-character hex Cloudflare Hyperdrive id.");
  if (hyperdriveId === PRODUCTION_RESOURCES.hyperdriveId) throw new Error("STAGING_HYPERDRIVE_ID is the PRODUCTION Hyperdrive id; refusing to render.");
  const occurrences = source.split(STAGING_HYPERDRIVE_PLACEHOLDER).length - 1;
  if (occurrences !== 1) throw new Error(`${configPath}: expected exactly one ${STAGING_HYPERDRIVE_PLACEHOLDER}, found ${occurrences}.`);
  const productionSection = source.slice(0, source.search(/^\s*\[env\./m));
  if (productionSection.includes(STAGING_HYPERDRIVE_PLACEHOLDER)) throw new Error(`${configPath}: placeholder found outside [env.staging].`);
  const rendered = source.replace(STAGING_HYPERDRIVE_PLACEHOLDER, hyperdriveId);
  if (rendered.includes(STAGING_HYPERDRIVE_PLACEHOLDER)) throw new Error(`${configPath}: placeholder still present after render.`);
  const productionHyperdrives = productionSection.match(new RegExp(PRODUCTION_RESOURCES.hyperdriveId, "g")) ?? [];
  const renderedProduction = rendered.match(new RegExp(PRODUCTION_RESOURCES.hyperdriveId, "g")) ?? [];
  if (renderedProduction.length !== productionHyperdrives.length) throw new Error(`${configPath}: staging section references the production Hyperdrive id.`);
  return rendered;
}

// ---------------------------------------------------------------------------
// GitHub environment contract
// ---------------------------------------------------------------------------

export function parseDisabledIntegrations(value) {
  const names = String(value ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  const unknown = names.filter((name) => !STAGING_INTEGRATIONS[name]);
  if (unknown.length > 0) throw new Error(`STAGING_DISABLED_INTEGRATIONS lists unknown integrations: ${unknown.join(", ")}.`);
  return new Set(names);
}

export function checkStagingEnvironment(env) {
  const problems = [];
  const present = (name) => typeof env[name] === "string" && env[name].trim() !== "";
  for (const name of STAGING_ENVIRONMENT_CONTRACT.requiredVars) {
    if (!present(name)) problems.push(`Required staging variable ${name} is not set in the GitHub staging environment.`);
  }
  for (const name of STAGING_ENVIRONMENT_CONTRACT.requiredSecrets) {
    if (!present(name)) problems.push(`Required staging secret ${name} is not set in the GitHub staging environment.`);
  }
  for (const name of STAGING_ENVIRONMENT_CONTRACT.forbiddenNames) {
    if (present(name)) problems.push(`Production-only ${name} must not be exposed to the staging release.`);
  }
  if (present("STAGING_HYPERDRIVE_ID")) {
    if (!HYPERDRIVE_ID.test(env.STAGING_HYPERDRIVE_ID)) problems.push("STAGING_HYPERDRIVE_ID is not a 32-character hex Cloudflare id.");
    else if (env.STAGING_HYPERDRIVE_ID === PRODUCTION_RESOURCES.hyperdriveId) problems.push("STAGING_HYPERDRIVE_ID is the PRODUCTION Hyperdrive id.");
  }
  if (present("STAGING_SUPABASE_PROJECT_REF")) {
    if (!SUPABASE_REF.test(env.STAGING_SUPABASE_PROJECT_REF)) problems.push("STAGING_SUPABASE_PROJECT_REF is not a valid Supabase project ref.");
    else if (env.STAGING_SUPABASE_PROJECT_REF === PRODUCTION_RESOURCES.supabaseProjectRef) problems.push("STAGING_SUPABASE_PROJECT_REF is the PRODUCTION Supabase project.");
  }
  if (present("STAGING_TOKEN_ENC_KEY") && !HEX_64.test(env.STAGING_TOKEN_ENC_KEY)) problems.push("STAGING_TOKEN_ENC_KEY must be 64 hex characters.");
  for (const name of ["STAGING_WEB_URL", "STAGING_MONITOR_URL"]) {
    if (!present(name)) continue;
    let url;
    try { url = new URL(env[name]); } catch { problems.push(`${name} is not a valid URL.`); continue; }
    if (url.protocol !== "https:") problems.push(`${name} must use https.`);
    if (PRODUCTION_RESOURCES.hosts.includes(url.hostname)) problems.push(`${name} points at production host ${url.hostname}.`);
    if (url.hostname === STAGING_HOST) problems.push(`${name} must be the Worker's own hostname, not the shared ${STAGING_HOST} apex.`);
  }
  try { parseDisabledIntegrations(env.STAGING_DISABLED_INTEGRATIONS); } catch (error) { problems.push(error.message); }
  return problems;
}

// ---------------------------------------------------------------------------
// Deployed Worker secret contract (names only)
// ---------------------------------------------------------------------------

export function parseSecretNames(listOutput) {
  const text = String(listOutput ?? "").trim();
  if (!text) return [];
  const start = text.indexOf("[");
  const parsed = JSON.parse(text.slice(start === -1 ? 0 : start));
  if (!Array.isArray(parsed)) throw new Error("wrangler secret list did not return a JSON array.");
  return parsed.map((entry) => String(entry.name ?? "")).filter(Boolean);
}

export function checkWorkerSecrets(worker, secretNames, disabledIntegrations) {
  const problems = [];
  const names = new Set(secretNames);
  for (const name of worker.requiredSecrets) {
    if (!names.has(name)) problems.push(`${worker.scriptName}: required secret ${name} is not set.`);
  }
  for (const name of worker.forbiddenSecrets) {
    if (names.has(name)) problems.push(`${worker.scriptName}: forbidden secret ${name} is set (staging must not bypass Hyperdrive or enable production-only side effects).`);
  }
  const report = [];
  for (const integration of worker.integrations) {
    const required = STAGING_INTEGRATIONS[integration];
    const missing = required.filter((name) => !names.has(name));
    if (disabledIntegrations.has(integration)) {
      report.push(`${integration}: INTENTIONALLY DISABLED`);
      continue;
    }
    if (missing.length === 0) report.push(`${integration}: REAL AND ISOLATED (configured)`);
    else problems.push(`${worker.scriptName}: integration ${integration} is missing ${missing.join(", ")} and is not declared in STAGING_DISABLED_INTEGRATIONS.`);
  }
  return { problems, report };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function fail(problems) {
  for (const problem of problems) console.error(`::error title=Staging preflight::${problem}`);
  throw new Error(`Staging preflight failed with ${problems.length} problem(s).`);
}

async function configCommand() {
  const problems = await checkStagingConfigs();
  if (problems.length > 0) fail(problems);
  console.log(`Staging config OK: ${STAGING_WORKERS.map((worker) => worker.scriptName).join(", ")} are isolated from production resources.`);
}

async function environmentCommand() {
  const problems = checkStagingEnvironment(process.env);
  if (problems.length > 0) fail(problems);
  const disabled = [...parseDisabledIntegrations(process.env.STAGING_DISABLED_INTEGRATIONS)];
  console.log(`Staging environment contract OK (${STAGING_ENVIRONMENT_CONTRACT.requiredVars.length} vars, ${STAGING_ENVIRONMENT_CONTRACT.requiredSecrets.length} secrets present).`);
  console.log(`Intentionally disabled integrations: ${disabled.join(", ") || "none"}`);
}

async function renderCommand() {
  const hyperdriveId = process.env.STAGING_HYPERDRIVE_ID;
  for (const worker of STAGING_WORKERS.filter((candidate) => candidate.hyperdrive)) {
    const path = resolve(process.cwd(), worker.config);
    const rendered = renderStagingHyperdrive(await readFile(path, "utf8"), hyperdriveId, worker.config);
    await writeFile(path, rendered);
    console.log(`${worker.config}: staging Hyperdrive id rendered.`);
  }
  const problems = await checkStagingConfigs();
  if (problems.length > 0) fail(problems);
  console.log("Rendered staging configs contain no placeholders and no production resource ids.");
}

async function workerSecretsCommand() {
  const key = process.env.STAGING_WORKER;
  const worker = STAGING_WORKERS.find((candidate) => candidate.key === key);
  if (!worker) throw new Error(`STAGING_WORKER must be one of ${STAGING_WORKERS.map((candidate) => candidate.key).join(", ")}.`);
  const names = parseSecretNames(process.env.WORKER_SECRET_LIST);
  const disabled = parseDisabledIntegrations(process.env.STAGING_DISABLED_INTEGRATIONS);
  const { problems, report } = checkWorkerSecrets(worker, names, disabled);
  for (const line of report) console.log(`${worker.scriptName}: ${line}`);
  if (problems.length > 0) fail(problems);
  console.log(`${worker.scriptName}: secret contract OK (${names.length} secret names present).`);
}

async function main() {
  const command = process.argv[2];
  if (command === "config") return configCommand();
  if (command === "environment") return environmentCommand();
  if (command === "render") return renderCommand();
  if (command === "worker-secrets") return workerSecretsCommand();
  throw new Error("Usage: node scripts/staging-preflight.mjs <config|environment|render|worker-secrets>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(`::error title=Staging preflight failed::${error.message}`);
    process.exitCode = 1;
  }
}
