import { spawnSync } from "child_process";

// A cross-platform test runner that replaces the bash 'for' loops in package.json
function runCmd(command, args, cwd) {
  console.log(`\n> Running: ${command} ${args.join(" ")} in ${cwd || "."}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: true });
  if (result.status !== 0) {
    console.error(`\n❌ Command failed with exit code ${result.status}`);
    process.exit(1);
  }
}

// Build the shared workspace package first; apps/leaderboard's build also
// builds it, but doing it up-front keeps direct callers, CI, and deploy jobs
// equivalent and makes generated `.js`/`.d.ts` available to all suites.
runCmd("bun", ["run", "build"], "packages/shared");

// Build leaderboard assets (also ensures shared is up to date).
runCmd("node", ["build.js"], "apps/leaderboard");

// 1. Run shared tests
runCmd("bun", ["test", "src/__tests__/"], "packages/shared");

// 2. Run queue consumer tests. Every file under src/ — naming a single file here
// meant src/viewer-export.test.js never ran in CI.
runCmd("bun", ["test", "src/"], "apps/consumer");

// 3. Run bot tests through its exact-file runner. Bun treats directory test
// filters as substrings, which can rediscover ignored compiled tests under
// dist/ after a local build and execute the suite twice.
runCmd("bun", ["run", "test"], "apps/bot");

// 4. Run leaderboard tests one by one to avoid mock.module cross-contamination
runCmd("node", ["scripts/test-leaderboard.mjs"]);

// 5. Run monitor tests
runCmd("bun", ["run", "test"], "apps/monitor");

// 6. Run the canonical marketing homepage tests
runCmd("bun", ["run", "test"], "apps/web");

console.log("\n✅ All tests passed successfully!");
