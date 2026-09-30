import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.join(here, "src/react/pages");
const outdir = path.join(here, "src/assets/react");
const styles = path.join(here, "src/react/styles.css");
const cssOutput = path.join(outdir, "react.css");
const entries = fs.readdirSync(pagesDir, { withFileTypes: true })
  .filter((item) => item.isDirectory())
  .map((item) => ({
    name: item.name,
    path: path.join(pagesDir, item.name, "entry.tsx"),
  }))
  .filter((item) => fs.existsSync(item.path));

fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });

let outputSizes;
try {
  const result = await esbuild.build({
    entryPoints: Object.fromEntries(entries.map(({ name, path: entry }) => [name, entry])),
    outdir,
    bundle: true,
    splitting: true,
    format: "esm",
    target: ["es2022", "chrome100", "safari15", "firefox100"],
    minify: true,
    legalComments: "none",
    jsx: "automatic",
    jsxImportSource: "react",
    entryNames: "[name]",
    chunkNames: "[name]-[hash]",
    define: { "process.env.NODE_ENV": '"production"' },
    metafile: true,
  });
  outputSizes = Object.entries(result.metafile.outputs)
    .map(([file, meta]) => `${path.basename(file)} ${(meta.bytes / 1024).toFixed(1)}kB`);
} catch (error) {
  if (typeof Bun === "undefined" || typeof Bun.build !== "function") throw error;
  console.warn("esbuild unavailable; using Bun's in-process React bundler");
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), "yourrank-react-entries-"));
  try {
    const entrypoints = entries.map(({ name, path: entry }) => {
      const wrapper = path.join(wrapperDir, `${name}.tsx`);
      fs.writeFileSync(wrapper, `export { enter, leave } from ${JSON.stringify(entry)};\n`);
      return wrapper;
    });
    const result = await Bun.build({
      entrypoints,
      outdir,
      splitting: true,
      format: "esm",
      target: "browser",
      minify: true,
      naming: { entry: "[name].[ext]", chunk: "[name]-[hash].[ext]" },
      define: { "process.env.NODE_ENV": '"production"' },
    });
    if (!result.success) {
      for (const log of result.logs) console.error(log);
      throw error;
    }
    outputSizes = result.outputs.map((output) =>
      `${path.basename(output.path)} ${(output.size / 1024).toFixed(1)}kB`
    );
  } finally {
    fs.rmSync(wrapperDir, { recursive: true, force: true });
  }
}

execFileSync("bun", [
  "x",
  "@tailwindcss/cli",
  "-i",
  styles,
  "-o",
  cssOutput,
  "--minify",
], { cwd: here, stdio: "inherit" });
outputSizes.push(`${path.basename(cssOutput)} ${(fs.statSync(cssOutput).size / 1024).toFixed(1)}kB`);

console.log(`React islands: ${outputSizes.sort().join(", ")}`);
