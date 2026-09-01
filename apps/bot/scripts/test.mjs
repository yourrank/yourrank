import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const testRoot = join(appRoot, "src", "__tests__");
const testFiles = readdirSync(testRoot)
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => relative(appRoot, join(testRoot, name)));

if (testFiles.length === 0) {
  console.error("No bot test files found.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["test", ...testFiles], {
  cwd: appRoot,
  stdio: "inherit",
  shell: false,
});

process.exit(result.status ?? 1);
