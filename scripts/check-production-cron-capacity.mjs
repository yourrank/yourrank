import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PRODUCTION_CRON_INVENTORY = Object.freeze([
  { worker: "Leaderboard", config: "apps/leaderboard/wrangler.toml", expected: 1 },
  { worker: "Bot", config: "apps/bot/wrangler.toml", expected: 2 },
  { worker: "Consumer", config: "apps/consumer/wrangler.toml", expected: 1 },
  { worker: "Monitor", config: "apps/monitor/wrangler.toml", expected: 1 },
]);

export const CLOUDFLARE_CRON_CAPACITY = Object.freeze({
  free: 5,
  paid: 250,
});

function productionConfig(source) {
  const stagingStart = source.search(/^\s*\[env\./m);
  return stagingStart === -1 ? source : source.slice(0, stagingStart);
}

export function parseProductionCrons(source, configPath = "wrangler.toml") {
  if (/^\s*\[\[\s*triggers\s*\]\]/m.test(source)) {
    throw new Error(`${configPath}: malformed [[triggers]] table; use the Wrangler object table [triggers].`);
  }

  const production = productionConfig(source);
  const headers = [...production.matchAll(/^\s*\[triggers\]\s*(?:#.*)?$/gm)];
  if (headers.length !== 1) {
    throw new Error(`${configPath}: expected exactly one production [triggers] table, found ${headers.length}.`);
  }

  const start = headers[0].index + headers[0][0].length;
  const remainder = production.slice(start);
  const nextHeader = remainder.search(/^\s*\[/m);
  const table = nextHeader === -1 ? remainder : remainder.slice(0, nextHeader);
  const keys = [...table.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=/gm)].map((match) => match[1]);
  if (keys.length !== 1 || keys[0] !== "crons") {
    throw new Error(
      `${configPath}: production [triggers] must contain exactly one crons assignment; found ` +
      `${keys.length === 0 ? "none" : keys.join(", ")}.`,
    );
  }
  const cronsMatch = table.match(/^\s*crons\s*=\s*\[([\s\S]*?)\]\s*(?:#.*)?$/m);
  if (!cronsMatch) {
    throw new Error(`${configPath}: production [triggers] must define a crons array.`);
  }

  const arrayBody = cronsMatch[1];
  const strings = [...arrayBody.matchAll(/"((?:\\.|[^"\\])*)"/g)];
  const unexpected = arrayBody.replace(/"(?:\\.|[^"\\])*"/g, "").replace(/#[^\r\n]*/g, "").replace(/[\s,]/g, "");
  if (unexpected) {
    throw new Error(`${configPath}: production crons must be a TOML array containing only double-quoted strings.`);
  }
  const crons = strings
    .map((match) => JSON.parse(`"${match[1]}"`));
  if (crons.length === 0) {
    throw new Error(`${configPath}: production crons array must not be empty.`);
  }
  if (new Set(crons).size !== crons.length) {
    throw new Error(`${configPath}: production crons array contains duplicate schedules.`);
  }
  for (const cron of crons) {
    if (cron.trim().split(/\s+/).length !== 5) {
      throw new Error(`${configPath}: invalid five-field Cron Trigger expression '${cron}'.`);
    }
  }
  return crons;
}

export async function validateProductionCronCapacity({
  root = resolve(fileURLToPath(new URL("..", import.meta.url))),
  plan,
  inventory = PRODUCTION_CRON_INVENTORY,
} = {}) {
  const normalizedPlan = String(plan || "").trim().toLowerCase();
  const capacity = CLOUDFLARE_CRON_CAPACITY[normalizedPlan];
  if (!capacity) {
    throw new Error(
      "CLOUDFLARE_WORKERS_PLAN must explicitly be 'free' or 'paid' (GitHub repository variable) so the " +
      "production Cron Trigger inventory is checked against the real account capacity.",
    );
  }

  const workers = [];
  for (const item of inventory) {
    const source = await readFile(resolve(root, item.config), "utf8");
    const crons = parseProductionCrons(source, item.config);
    if (crons.length !== item.expected) {
      throw new Error(
        `${item.config}: expected ${item.expected} production Cron Trigger(s) for ${item.worker}, found ${crons.length}.`,
      );
    }
    workers.push({ ...item, crons });
  }

  const required = workers.reduce((total, worker) => total + worker.crons.length, 0);
  if (required > capacity) {
    const breakdown = workers.map((worker) => `${worker.worker}=${worker.crons.length}`).join(", ");
    throw new Error(
      `Production requires ${required} Cloudflare Cron Triggers (${breakdown}), but the declared ` +
      `${normalizedPlan} plan capacity is ${capacity}. Upgrade the Cloudflare account to Workers Paid or ` +
      "consolidate schedules within the owning Worker; do not move scheduler ownership across Workers.",
    );
  }

  return { plan: normalizedPlan, capacity, required, workers };
}

async function main() {
  try {
    const result = await validateProductionCronCapacity({ plan: process.env.CLOUDFLARE_WORKERS_PLAN });
    for (const worker of result.workers) {
      console.log(`${worker.worker}: ${worker.crons.length} (${worker.crons.join(", ")})`);
    }
    console.log(`Production Cron Trigger requirement: ${result.required}/${result.capacity} (${result.plan})`);
  } catch (error) {
    console.error(`::error title=Cloudflare Cron Trigger preflight failed::${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
