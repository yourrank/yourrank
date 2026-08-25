// ============================================================================
//  Brand identity integrity — one mark, one wordmark, one owner.
//
//  The product used to ship three competing identities: the canonical
//  triple-chevron mark, a generic 3-rect bar chart in apps/web, and a literal
//  "YR" text square in the Worker shells. packages/shared/src/brand-assets.ts is
//  now the single source of truth for every brand path, and this test fails if a
//  fourth identity (or one of the deleted two) shows up in source again.
// ============================================================================

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  LOGO_FULL_PATH,
  LOGO_MARK_PATH,
} from "@yourrank/shared/brand-assets";

const repoRoot = path.resolve(import.meta.dir, "../../../..");
const brandAssetsRel = "packages/shared/src/brand-assets.ts";
const scanRoots = ["apps", "packages"];
const skipDirs = new Set(["node_modules", "dist", ".wrangler", ".next", ".open-next", "coverage", "__tests__"]);
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".css", ".html"]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      walk(path.join(dir, entry.name), files);
    } else if (sourceExtensions.has(path.extname(entry.name)) && entry.name !== "assets_bundled.js") {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

const sourceFiles = scanRoots.flatMap((root) => walk(path.join(repoRoot, root)));
const sources = sourceFiles.map((file) => ({
  rel: path.relative(repoRoot, file),
  text: fs.readFileSync(file, "utf8"),
}));

const brandDir = path.join(repoRoot, "apps/web/public/brand");
const brandFiles = fs.readdirSync(brandDir).filter((f) => f.endsWith(".svg"));

describe("brand identity", () => {
  it("scans a meaningful set of source files", () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.some((s) => s.rel === brandAssetsRel)).toBe(true);
  });

  it("has no bar-chart brand geometry (identity B) left in source", () => {
    const barChartRects = [
      /<rect[^>]*\bx="3"[^>]*\by="13"/,
      /<rect[^>]*\bx="10"[^>]*\by="8"/,
      /<rect[^>]*\bx="17"[^>]*\by="3"/,
      /rect\s+x="3"\s+y="13"/,
    ];
    const offenders = sources.filter((s) => barChartRects.some((re) => re.test(s.text)));
    expect(offenders.map((s) => s.rel)).toEqual([]);
  });

  it("has no literal 'YR' text brand mark (identity C) left in source", () => {
    const offenders = sources.filter((s) => /brand-mark[^>]*>\s*YR\s*</.test(s.text) || />YR<\/span>/.test(s.text));
    expect(offenders.map((s) => s.rel)).toEqual([]);
  });

  it("keeps every brand path in brand-assets.ts", () => {
    const markSignature = LOGO_MARK_PATH.slice(0, 40);
    const wordmarkSignature = LOGO_FULL_PATH.slice(0, 40);
    const offenders = sources.filter(
      (s) => s.rel !== brandAssetsRel && (s.text.includes(markSignature) || s.text.includes(wordmarkSignature)),
    );
    expect(offenders.map((s) => s.rel)).toEqual([]);
  });

  it("renders Worker and marketing brand marks through the shared helpers", () => {
    const consumers = [
      "packages/shared/src/shell-nav.ts",
      "packages/shared/src/page-shell.ts",
      "packages/shared/src/dashboard-chrome.ts",
      "apps/leaderboard/src/pages/viewer-dashboard.js",
      "apps/leaderboard/src/middleware/seo.js",
      "apps/web/src/components/site-shell.tsx",
      "apps/web/src/components/home/workspace-preview.tsx",
    ];
    for (const rel of consumers) {
      const source = sources.find((s) => s.rel === rel);
      expect(source, `${rel} should be scanned`).toBeDefined();
      expect(source.text, `${rel} must import from brand-assets`).toMatch(/brand-assets/);
    }
  });

  it("serves the canonical mark as the favicon", () => {
    const seo = sources.find((s) => s.rel === "apps/leaderboard/src/middleware/seo.js");
    expect(seo.text).toContain("brandFaviconSvg()");
    expect(seo.text).not.toContain('viewBox="0 0 1 1"');
  });

  it("gives the brand mark an unconditional intrinsic size so it cannot balloon", () => {
    const dashboardCss = sources.find((s) => s.rel === "apps/leaderboard/src/assets/dashboard-v4.css");
    const baseRule = dashboardCss.text.match(/(^|\n)\.lb-brand-mark \{[^}]*\}/);
    expect(baseRule, "dashboard-v4.css needs an unscoped .lb-brand-mark rule").not.toBeNull();
    expect(baseRule[0]).toMatch(/width: 34px/);
    expect(baseRule[0]).toMatch(/height: 34px/);

    const shellNavCss = sources.find((s) => s.rel === "apps/leaderboard/src/assets/shell-nav.css");
    expect(shellNavCss.text).toMatch(/\.gm-brand-mark\{[^}]*width:26px;height:26px/);
  });

  it("generates the downloadable brand files from the canonical paths", () => {
    expect(brandFiles.sort()).toEqual([
      "powered-by-yourrank-dark.svg",
      "powered-by-yourrank-light.svg",
      "yourrank-mark-blue.svg",
      "yourrank-mark-dark.svg",
      "yourrank-mark-light.svg",
      "yourrank-wordmark-dark.svg",
      "yourrank-wordmark-light.svg",
    ]);
    for (const file of brandFiles) {
      const svg = fs.readFileSync(path.join(brandDir, file), "utf8");
      const expectedPath = file.startsWith("yourrank-mark-") ? LOGO_MARK_PATH : LOGO_FULL_PATH;
      expect(svg, `${file} must use the canonical geometry`).toContain(expectedPath);
      expect(svg, `${file} must not carry bar-chart rects`).not.toMatch(/<rect[^>]*\bx="3"[^>]*\by="13"/);
    }
  });
});
