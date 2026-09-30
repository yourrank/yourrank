// Build: compiles shared TypeScript to JavaScript, then inlines asset files as string exports so the Worker is fully self-contained.
import { execSync } from "node:child_process";
import { writeAssetBundle } from "./build-assets.js";

// Step 1: Build the shared workspace package
console.log("Building shared package...");
try {
  execSync("bun run --cwd ../../packages/shared build", { stdio: "inherit" });
  console.log("Shared package build complete");
} catch (error) {
  console.error("Shared package build failed:", error);
  process.exit(1);
}

// Step 2: Bundle the games Preact island into src/assets/games/ (see
// build-games.mjs for why the games get a bundler and no other page does).
console.log("Bundling games island...");
try {
  execSync("bun build-games.mjs", { stdio: "inherit" });
} catch (error) {
  console.error("Games island build failed:", error);
  process.exit(1);
}

// Step 3: Build the dashboard React islands and their scoped Tailwind sheet.
console.log("Bundling dashboard React islands...");
try {
  execSync("bun build-react.mjs", { stdio: "inherit" });
} catch (error) {
  console.error("React island build failed:", error);
  process.exit(1);
}

// Step 4: Bundle assets
await writeAssetBundle();
