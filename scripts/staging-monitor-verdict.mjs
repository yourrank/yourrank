// Verdict for the staging monitor /check array during release smoke.
//
// Two check failures are structural to staging and tolerated:
//   - GET /api/health/backup -> 503: restore drills only run against
//     production, so staging legitimately has no record.
//   - GET /health -> 503: the leaderboard reports "degraded" solely because
//     the queue-consumer heartbeat is stale — staging runs `crons = []` and
//     has no queue traffic, so the heartbeat can never be fresh there. It is
//     only tolerated when the leaderboard /health body shows every other
//     signal healthy.
//
//   node scripts/staging-monitor-verdict.mjs <checks.json> <health.json>
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function healthTolerated(healthBody) {
  const failures = [];
  if (healthBody?.status !== "degraded") {
    failures.push(`status is ${JSON.stringify(healthBody?.status)}, expected "degraded"`);
  }
  if (healthBody?.db !== true) failures.push("db is not true");
  if (healthBody?.db_identity?.expected !== true) {
    failures.push("db_identity.expected is not true");
  }
  const email = healthBody?.email_verification;
  if (email && email.required === true && email.configured !== true) {
    failures.push("email_verification is required but not configured");
  }
  const dlqReasons = healthBody?.dlq?.degraded_reasons;
  if (dlqReasons !== undefined && !(Array.isArray(dlqReasons) && dlqReasons.length === 0)) {
    failures.push("dlq.degraded_reasons is not empty");
  }
  if (healthBody?.consumer?.healthy !== false) {
    failures.push("consumer.healthy is not false (degradation is not the expected stale heartbeat)");
  }
  return failures;
}

export function evaluateStagingMonitorChecks(checks, healthBody) {
  const problems = [];
  const tolerated = [];
  if (!Array.isArray(checks) || checks.length === 0) {
    return { ok: false, problems: ["monitor /check returned a non-array or empty result"], tolerated };
  }
  for (const item of checks) {
    if (item?.ok === true) continue;
    const name = item?.name ?? "<unnamed>";
    if (name === "GET /api/health/backup" && item.status === 503) {
      tolerated.push("GET /api/health/backup: no restore-drill record exists in staging");
      continue;
    }
    if (name === "GET /health" && item.status === 503) {
      const failures = healthTolerated(healthBody);
      if (failures.length === 0) {
        tolerated.push("GET /health: only the consumer heartbeat is stale in staging (crons = [], no queue traffic)");
      } else {
        problems.push(`GET /health: 503 not tolerated — ${failures.join("; ")}`);
      }
      continue;
    }
    problems.push(`${name}: status ${item?.status} ${item?.error ?? ""}`.trim());
  }
  return { ok: problems.length === 0, problems, tolerated };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [checksPath, healthPath] = process.argv.slice(2);
  if (!checksPath || !healthPath) {
    console.error("usage: node scripts/staging-monitor-verdict.mjs <checks.json> <health.json>");
    process.exit(1);
  }
  try {
    const checks = JSON.parse(readFileSync(checksPath, "utf8"));
    const health = JSON.parse(readFileSync(healthPath, "utf8"));
    const verdict = evaluateStagingMonitorChecks(checks, health);
    for (const line of verdict.tolerated) {
      console.log(`::notice::Tolerated in staging: ${line}`);
    }
    for (const line of verdict.problems) {
      console.log(`::error::${line}`);
    }
    if (!verdict.ok) process.exit(1);
    console.log("OK: monitor checks pass (with staging-structural tolerations applied)");
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
