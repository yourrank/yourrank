// Negative tests for the artifact cleanup guard. These execute the same
// resolver used by the verifier and also prove the verifier rejects hostile
// environment values before it can start any cleanup or browser work.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { artifactParent, resolveArtifactRoot } from "./yr-003-baseline-artifacts.mjs";

assert.equal(resolveArtifactRoot(undefined), path.join(artifactParent, "current"));
assert.equal(resolveArtifactRoot("review-17"), path.join(artifactParent, "review-17"));

const hostileValues = [".", "..", "/", "/tmp/outside", "../outside", "nested/run", "nested\\run", "", " space", "a".repeat(81)];
for (const value of hostileValues) {
  assert.throws(() => resolveArtifactRoot(value), /YR_003_ARTIFACT_DIR/);
  const result = spawnSync(process.execPath, ["scripts/verify-yr-003-baseline.mjs"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, YR_003_ARTIFACT_DIR: value },
  });
  assert.notEqual(result.status, 0, `Verifier unexpectedly accepted hostile YR_003_ARTIFACT_DIR=${JSON.stringify(value)}.`);
  assert.match(`${result.stdout}\n${result.stderr}`, /YR_003_ARTIFACT_DIR/);
}

console.log(`PASSED: YR-003 artifact cleanup accepts only a child run name below ${artifactParent}; ${hostileValues.length} hostile values were rejected.`);
