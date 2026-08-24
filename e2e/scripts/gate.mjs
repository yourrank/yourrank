#!/usr/bin/env bun
/**
 * The release gate.
 *
 * Runs the E2E suite, maps each `[scenario:<key>]` tagged test back to the
 * registry in `src/scenarios.ts`, and prints one verdict per scenario:
 *
 *   PASSED / FAILED / SKIPPED / NOT VERIFIABLE
 *
 * The gate fails when a required scenario is anything other than PASSED, when the
 * suite executed no tests at all, or when a tagged test refers to an unknown
 * scenario. A skipped run can therefore never be reported as a passing gate.
 */

import { spawn } from "node:child_process";
import { SCENARIOS, SCENARIO_KEYS, scenarioReady } from "../src/scenarios.ts";

const VERDICT = { PASSED: "PASSED", FAILED: "FAILED", SKIPPED: "SKIPPED", NV: "NOT VERIFIABLE" };

const args = process.argv.slice(2);

/**
 * Streamed rather than buffered: `spawnSync` caps captured output at its default
 * `maxBuffer` and the full suite exceeds it, killing the run with ENOBUFS before
 * any verdict is computed — a gate that cannot report is a gate that cannot fail
 * honestly. Chunks are echoed as they arrive and accumulated for parsing.
 */
const run = await new Promise((resolve) => {
  const child = spawn("bun", ["test", "--timeout", "30000", ...(args.length ? args : ["src/"])], {
    cwd: new URL("..", import.meta.url).pathname,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });
  let captured = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      captured += chunk;
      process.stdout.write(chunk);
    });
  }
  child.on("error", (error) => resolve({ output: captured, status: null, error }));
  child.on("close", (status) => resolve({ output: captured, status, error: null }));
});

const output = run.output;

if (run.error) {
  console.error(`::error::E2E gate could not start bun test: ${run.error.message}`);
  process.exit(1);
}

/** bun prints one line per test: `(pass|fail|skip|todo) suite > name [1.00ms]`. */
const results = new Map(); // scenario key -> Set of outcomes
const unknownTags = new Set();
let executed = 0;

for (const line of output.split("\n")) {
  const m = /^\s*\((pass|fail|skip|todo)\)\s(.*)$/.exec(line);
  if (!m) continue;
  const [, outcome, name] = m;
  if (outcome === "pass" || outcome === "fail") executed++;
  const tags = [...name.matchAll(/\[scenario:([a-z0-9-]+)\]/g)].map((t) => t[1]);
  for (const key of tags) {
    if (!SCENARIO_KEYS.has(key)) {
      unknownTags.add(key);
      continue;
    }
    if (!results.has(key)) results.set(key, new Set());
    results.get(key).add(outcome);
  }
}

const summary = /(\d+) pass[\s\S]*?(\d+) fail/.exec(output);
const reportedPass = summary ? Number(summary[1]) : 0;
const reportedFail = summary ? Number(summary[2]) : 0;

function verdictFor(scenario) {
  const outcomes = results.get(scenario.key);
  if (scenario.tier === "not-verifiable") return VERDICT.NV;
  if (!outcomes || outcomes.size === 0) return VERDICT.SKIPPED;
  if (outcomes.has("fail")) return VERDICT.FAILED;
  if (outcomes.has("pass")) return VERDICT.PASSED;
  return VERDICT.SKIPPED;
}

const rows = SCENARIOS.map((scenario) => {
  const verdict = verdictFor(scenario);
  const ready = scenarioReady(scenario, process.env);
  const blocking =
    scenario.tier === "required"
      ? verdict !== VERDICT.PASSED
      : scenario.tier === "conditional" && ready && verdict !== VERDICT.PASSED;
  return { scenario, verdict, ready, blocking };
});

const width = Math.max(...SCENARIOS.map((s) => s.key.length));
console.log("\nE2E scenario matrix");
console.log("-".repeat(width + 24));
for (const { scenario, verdict, ready } of rows) {
  const note =
    verdict === VERDICT.PASSED
      ? ""
      : scenario.tier === "conditional" && !ready
        ? `  (needs ${scenario.requires.join(", ")})`
        : scenario.reason
          ? `  (${scenario.reason})`
          : "";
  console.log(`${scenario.key.padEnd(width)}  ${verdict}${note}`);
}
console.log("-".repeat(width + 24));
console.log(`tests executed: ${executed} (bun reported ${reportedPass} pass, ${reportedFail} fail)`);

const failures = [];
if (executed === 0) failures.push("the suite executed zero tests; a skipped run is not a passing run");
if (reportedFail > 0) failures.push(`${reportedFail} test(s) failed`);
if (run.status !== 0) failures.push(`bun test exited ${run.status}`);
for (const tagName of unknownTags) failures.push(`test tagged with unknown scenario '${tagName}'`);
for (const { scenario, verdict, blocking } of rows) {
  if (blocking) failures.push(`${scenario.key} is ${verdict}`);
}

if (failures.length) {
  for (const failure of failures) console.error(`::error::E2E gate failed: ${failure}`);
  process.exit(1);
}

console.log("E2E gate passed: every required scenario executed and passed.");
