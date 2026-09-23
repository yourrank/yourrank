#!/usr/bin/env node
// Runs the provider-portability real-Postgres suites and fails closed.
//
// The suites self-skip when AUDIT_TEST_DATABASE_URL is unset so the plain
// `bun run test` job stays database-free. This wrapper is the CI gate: it
// requires the URL, refuses anything that is not a disposable local database,
// runs each suite in its own process, parses Bun's summary and fails when a
// suite has 0 passes, any failures, or any skipped test. `0 pass / N skip`
// is never a pass here.
//
// Usage: AUDIT_TEST_DATABASE_URL=postgres://postgres:test@localhost:5432/yourrank_test \
//        node scripts/verify-portability-postgres.mjs

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PORTABILITY_SUITES = Object.freeze([
  // Cross-platform linking, ownership conflicts, sign-in vs link mode,
  // stale/forged/wrong-session state, custom-domain handoff.
  "apps/leaderboard/src/__tests__/viewer-link-postgres.test.js",
  // Atomic rollback, concurrent first logins, racing links,
  // user-123 / channel-999 routing, unverified/revoked/hijack routing, rebind.
  "apps/leaderboard/src/__tests__/provider-neutral-postgres.test.js",
  // Unlink -> another creator legitimately binds the same channel.
  "apps/leaderboard/src/__tests__/provider-rebind-postgres.test.js",
  // Legacy-column mirror stays consistent with the generic channel binding.
  "apps/leaderboard/src/__tests__/provider-portability-postgres.test.js",
  // Kick auth callback -> generic binding; unverified binding never routes.
  "apps/leaderboard/src/__tests__/provider-binding-postgres.test.js",
  // Viewer session authority (global vs custom domain) across providers.
  "apps/leaderboard/src/__tests__/viewer-authority-postgres.test.js",
  // Chat giveaways: verified channel -> site routing, one active session per
  // site, one entry per stable provider user, stop/disconnect keep history.
  "apps/leaderboard/src/__tests__/chat-giveaways-postgres.test.js",
  // Board-scoped API keys, idempotency reservations, concurrent score merges.
  "apps/leaderboard/src/__tests__/scores-api-postgres.test.js",
  // Entry-mode eligibility, authenticated verification, giveaway-scoped IP HMAC and draw filtering.
  "apps/leaderboard/src/__tests__/giveaway-rules-postgres.test.js",
]);

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function parseSummary(output) {
  const count = (label) => {
    const match = output.match(new RegExp(`^\\s*(\\d+) ${label}\\b`, "m"));
    return match ? Number(match[1]) : 0;
  };
  return { pass: count("pass"), fail: count("fail"), skip: count("skip"), todo: count("todo") };
}

function assertDisposable(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail("AUDIT_TEST_DATABASE_URL is not a valid URL");
  }
  const localHost = ["localhost", "127.0.0.1", "postgres"].includes(parsed.hostname);
  const disposableName = /test|e2e/.test(parsed.pathname);
  if (!localHost || !disposableName) {
    fail(`AUDIT_TEST_DATABASE_URL must point at a disposable local database (got ${parsed.hostname}${parsed.pathname})`);
  }
}

export function main() {
  const databaseUrl = process.env.AUDIT_TEST_DATABASE_URL || "";
  if (!databaseUrl) {
    fail("AUDIT_TEST_DATABASE_URL is required: the portability Postgres suites must execute, not skip");
  }
  assertDisposable(databaseUrl);

  const results = [];
  let ok = true;
  for (const suite of PORTABILITY_SUITES) {
    if (!existsSync(path.join(repoRoot, suite))) {
      fail(`portability suite missing: ${suite}`);
    }
    const proc = spawnSync("bun", ["test", suite], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, AUDIT_TEST_DATABASE_URL: databaseUrl },
      maxBuffer: 64 * 1024 * 1024,
    });
    const output = `${proc.stdout || ""}${proc.stderr || ""}`;
    process.stdout.write(output);
    const summary = parseSummary(output);
    const problems = [];
    if (proc.status !== 0) problems.push(`exit code ${proc.status}`);
    if (summary.fail > 0) problems.push(`${summary.fail} failed`);
    if (summary.skip > 0) problems.push(`${summary.skip} skipped`);
    if (summary.pass === 0) problems.push("0 tests executed");
    if (problems.length) ok = false;
    results.push({ suite: path.basename(suite, ".test.js"), ...summary, problems });
  }

  console.log("\nProvider-portability Postgres suites:");
  for (const r of results) {
    const status = r.problems.length ? `FAILED (${r.problems.join(", ")})` : "PASSED";
    console.log(`  ${r.suite}: ${r.pass} pass, ${r.fail} fail, ${r.skip} skip — ${status}`);
  }
  if (!ok) fail("provider-portability Postgres gate failed");
  console.log("OK: every portability suite executed against the migrated database with 0 failures and 0 skips");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
