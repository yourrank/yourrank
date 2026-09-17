// Keep the committed YR-003 outcome record honest and visible. A known
// limitation is allowed, but a FAILED behavior must make the dedicated
// baseline command fail rather than being hidden behind successful checks.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifestUrl = new URL("../docs/verification/yr-003-outcomes.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const allowedStatuses = new Set(["PASSED", "FAILED", "SKIPPED", "NOT RUN", "NOT VERIFIABLE"]);

assert.equal(manifest.schemaVersion, 1, "YR-003 outcome manifest schemaVersion must be 1.");
assert.ok(Array.isArray(manifest.outcomes) && manifest.outcomes.length > 0, "YR-003 outcome manifest must record at least one behavior.");
for (const outcome of manifest.outcomes) {
  assert.equal(typeof outcome.behavior, "string", "Each YR-003 outcome needs a behavior description.");
  assert.ok(outcome.behavior.trim(), "Each YR-003 outcome behavior must not be blank.");
  assert.ok(allowedStatuses.has(outcome.status), `Invalid YR-003 outcome status for ${outcome.behavior}: ${outcome.status}`);
  assert.equal(typeof outcome.evidence, "string", `YR-003 outcome ${outcome.behavior} needs evidence.`);
  assert.ok(outcome.evidence.trim(), `YR-003 outcome ${outcome.behavior} evidence must not be blank.`);
}

const counts = Object.fromEntries([...allowedStatuses].map((status) => [status, manifest.outcomes.filter((outcome) => outcome.status === status).length]));
console.log(`YR-003 outcomes: ${Object.entries(counts).map(([status, count]) => `${status}=${count}`).join(", ")}`);
const failures = manifest.outcomes.filter((outcome) => outcome.status === "FAILED");
assert.equal(failures.length, 0, `YR-003 has FAILED outcome(s): ${failures.map((outcome) => outcome.behavior).join("; ")}`);
console.log("PASSED: YR-003 outcome manifest uses valid statuses, keeps non-passing outcomes visible, and contains no FAILED behavior.");
