import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { hasBareImport } from "../../build-assets.js";
import { ASSETS } from "../assets_bundled.js";

const assetBundle = readFileSync(new URL("../assets_bundled.js", import.meta.url), "utf8");
const siteSource = readFileSync(new URL("../assets/dashboard/site.js", import.meta.url), "utf8");

describe("dashboard asset bundling", () => {
  it("detects bare imports while leaving relative asset imports unbundled", () => {
    expect(hasBareImport('import { navOwner } from "@yourrank/shared/dashboard-nav";')).toBe(true);
    expect(hasBareImport('import { esc } from "./utils.js";')).toBe(false);
    expect(hasBareImport(siteSource)).toBe(false);
    expect(hasBareImport('export const sections = { note: "from \\"./utils.js\\"" };')).toBe(false);
    expect(hasBareImport('import "pkg";')).toBe(true);
    expect(hasBareImport('export * from "pkg";')).toBe(true);
    expect(hasBareImport('export { value } from "pkg";')).toBe(true);
    expect(hasBareImport('import("pkg");')).toBe(true);
  });

  it("keeps the state module singleton when bundling package imports", () => {
    expect(ASSETS["/assets/dashboard/site.js"][0]).toBe(siteSource);
    const stateEntries = Object.entries(ASSETS)
      .filter(([, [content]]) => content.includes("function createDashboardState("))
      .map(([path]) => path);
    expect(stateEntries).toEqual(["/assets/dashboard/state.js"]);
  });

  it("does not ship unresolved shared-package imports to the browser", () => {
    expect(assetBundle).not.toContain("@yourrank/shared/dashboard-nav");
  });

  it("resolves every relative import in bundled js assets to a served asset", () => {
    // Inlined package modules (shared dist) import their siblings relatively;
    // those must be bundled in, because the browser would resolve them
    // against /assets/ and 404. Only asset-to-asset imports may stay.
    for (const [assetPath, [content, ext]] of Object.entries(ASSETS)) {
      if (ext !== ".js") continue;
      for (const [, specifier] of content.matchAll(/(?:from|import)\s*\(?\s*"(\.[^"]+)"/g)) {
        const resolved = new URL(specifier, `https://assets.test${assetPath}`).pathname;
        expect(ASSETS[resolved], `${assetPath} → ${specifier}`).toBeDefined();
      }
    }
  });
});
