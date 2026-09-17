// Run the deterministic viewer baseline twice, then compare both fresh runs
// to the retained, reviewed PNG files and their hash manifest. The cleanup target is deliberately
// limited to a run child below .local-logs/yr-003-baseline.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, rm, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { repoRoot, resolveArtifactRoot } from "./yr-003-baseline-artifacts.mjs";

const root = repoRoot;
const artifactRoot = resolveArtifactRoot();
const runs = [path.join(artifactRoot, "run-1"), path.join(artifactRoot, "run-2")];
const expectedPngs = [320, 390, 768, 1024, 1440]
  .flatMap((width) => [1, 2, 3].map((count) => `board-${count}-${width}.png`))
  .sort();
const approvedBaseline = JSON.parse(await readFile(new URL("../docs/verification/yr-003-screenshot-baseline.json", import.meta.url), "utf8"));
const referenceDir = path.join(root, "docs", "verification", "yr-003-screenshots");

async function pngHashes(dir) {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".png")).sort();
  assert.deepEqual(names, expectedPngs, `Unexpected or missing YR-003 screenshots in ${dir}.`);
  return Promise.all(names.map(async (name) => ({
    name,
    sha256: createHash("sha256").update(await readFile(path.join(dir, name))).digest("hex"),
  })));
}

assert.equal(approvedBaseline.hashAlgorithm, "sha256", "YR-003 approved baseline must declare SHA-256.");
assert.deepEqual(approvedBaseline.hashes.map(({ name }) => name).sort(), expectedPngs, "YR-003 approved baseline has an unexpected screenshot set.");
const reference = await pngHashes(referenceDir);
assert.deepEqual(reference, approvedBaseline.hashes, "YR-003 approved PNG files do not match their committed hash manifest.");

await rm(artifactRoot, { recursive: true, force: true });
await mkdir(artifactRoot, { recursive: true });
for (const output of runs) {
  const result = spawnSync(process.execPath, ["scripts/verify-viewer-audit.mjs"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, YR_003_SCREENSHOT_DIR: output },
  });
  assert.equal(result.status, 0, `YR-003 browser baseline failed for ${output}.`);
}

const [first, second] = await Promise.all(runs.map(pngHashes));
assert.deepEqual(second, first, "YR-003 screenshots changed between clean deterministic fixture runs.");
assert.deepEqual(first, reference, "YR-003 screenshots differ from the committed approved PNGs. Review the generated images against docs/verification/yr-003-screenshots before deliberately updating the baseline.");
console.log(`PASSED: YR-003 browser baseline matched the committed approved PNGs and hashes and was stable across two clean fixture runs (${first.length} PNG files per run): ${artifactRoot}`);
