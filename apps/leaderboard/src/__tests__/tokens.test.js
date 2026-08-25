// The operator workspace and marketing site intentionally use separate accent
// axes: authenticated actions use electric violet, while marketing uses cobalt.
// This test protects ownership, consistency within each axis, and legibility.

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../../../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const MARKETING_ACCENT = "#315cff";
const V4_ACCENT = "#2200ff";

const sources = {
  app: read("apps/leaderboard/src/assets/app.css"),
  dashboard: read("apps/leaderboard/src/assets/dashboard-v4.css"),
  landing: read("apps/leaderboard/src/assets/landing.css"),
  ui: read("apps/leaderboard/src/assets/ui.css"),
  publicShell: read("apps/leaderboard/src/assets/site-shell.css"),
  publicRuntime: read("packages/shared/src/site-render.ts"),
};

function declared(source, name) {
  const m = source.match(new RegExp(`${name}\\s*:\\s*([^;}]+)`));
  return m ? m[1].trim().toLowerCase() : null;
}

function declarationCount(source, name) {
  return (source.match(new RegExp(`(?:^|[{;])\\s*${name}\\s*:`, "g")) || []).length;
}

function declarationValues(source, name) {
  return [...source.matchAll(new RegExp(`${name}\\s*:\\s*([^;}]+)`, "g"))].map((match) => match[1].trim().toLowerCase());
}

function contrastRatio(foreground, background) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex) => {
    const channels = hex
      .slice(1)
      .match(/../g)
      .map((part) => channel(parseInt(part, 16)));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("design tokens", () => {
  it("defines the complete authenticated workspace type scale", () => {
    for (const [name, value] of [
      ["--ws-type-page-size", "34px"],
      ["--ws-type-page-leading", "40px"],
      ["--ws-type-section-size", "20px"],
      ["--ws-type-section-leading", "28px"],
      ["--ws-type-card-size", "17px"],
      ["--ws-type-card-leading", "24px"],
      ["--ws-type-body-size", "15px"],
      ["--ws-type-body-leading", "22.5px"],
      ["--ws-type-meta-size", "13px"],
      ["--ws-type-meta-leading", "18px"],
    ]) {
      expect(declared(sources.dashboard, name), name).toBe(value);
    }
    const scale = sources.dashboard.slice(sources.dashboard.indexOf("/* Canonical operator workspace type scale. */"));
    expect(scale).toContain("h1 {\n  font-size: var(--ws-type-page-size);");
    expect(scale).toContain("h2 {\n  font-size: var(--ws-type-section-size);");
    expect(scale).toContain("h3,\n.v3-dash[data-auth-workspace] h4");
    expect(scale).toContain("font-size: var(--ws-type-card-size);");
    expect(scale).toContain("font-size: var(--ws-type-meta-size);");
    const sectionHeading = scale.match(/\.v3-dash\[data-auth-workspace\] h2\s*\{([^}]*)\}/)?.[1] || "";
    expect(sectionHeading).toContain("font-size: var(--ws-type-section-size);");
    expect(scale).not.toMatch(/\.v3-section-head h2[\s\S]*?font-size:\s*var\(--ws-type-card-size\)/);
    expect(sources.dashboard).toContain("font: 700 var(--ws-type-page-size)/var(--ws-type-page-leading) var(--ws-sans);");
    expect(sources.dashboard).not.toMatch(/\.v3-dash\[data-auth-workspace\] \.v3-head h1\s*\{\s*font-size:\s*(?:26|28)px/);
    const designGroupHeading = sources.dashboard.match(
      /\.v3-dash\[data-auth-workspace\] section\[data-page="board"\] \.design-group-heading h2\s*\{([^}]*)\}/
    )?.[1] || "";
    expect(designGroupHeading).toContain("font-size: var(--ws-type-section-size);");
    expect(designGroupHeading).toContain("line-height: var(--ws-type-section-leading);");
    expect(designGroupHeading).not.toContain("font-size: var(--ws-type-card-size);");
    const cardHeading = sources.dashboard.match(
      /\.v3-dash\[data-auth-workspace\] \.card > h2,[\s\S]*?\{([^}]*)\}/
    )?.[1] || "";
    expect(cardHeading).toContain("font-size: var(--ws-type-card-size);");
    const headingSizes = [...sources.dashboard.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector]) => /(?:^|[\s>+~,.])h[1-6](?:$|[\s.#:>+~,.])/.test(selector))
      .flatMap(([, , declarations]) => [
        ...declarations.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g),
        ...declarations.matchAll(/font:\s*[^;]*?\s(\d+(?:\.\d+)?)px(?:\/|[\s])/g),
      ])
      .map(([, size]) => Number(size));
    expect(headingSizes.every((size) => size >= 15)).toBe(true);
  });

  it("keeps each accent and status token owned by one stylesheet", () => {
    for (const name of ["--ws-accent", "--ws-accent-text", "--ws-success", "--ws-warning", "--ws-danger"]) {
      expect(declarationCount(sources.dashboard, name), `${name} ownership`).toBe(1);
    }
    for (const [name, value] of [["--ok", "#16c784"], ["--warn", "#f59e0b"], ["--danger", "#f43f5e"]]) {
      expect(declarationValues(sources.app, name).filter((entry) => entry === value), `app.css ${name} base token`).toHaveLength(1);
      expect(declarationValues(sources.landing, name).filter((entry) => entry === value), `landing.css ${name} base token`).toHaveLength(1);
    }
    expect(declarationValues(sources.app, "--accent").filter((entry) => entry === MARKETING_ACCENT)).toHaveLength(1);
    expect(declarationValues(sources.landing, "--accent").filter((entry) => entry === MARKETING_ACCENT)).toHaveLength(1);
    expect(declarationValues(sources.app, "--accent-ink").filter((entry) => entry === "#ffffff").length).toBeGreaterThan(0);
    expect(declarationValues(sources.landing, "--accent-ink").filter((entry) => entry === "#ffffff").length).toBeGreaterThan(0);
    expect(declared(sources.app, "--accent")).toBe(MARKETING_ACCENT);
    expect(declared(sources.landing, "--accent")).toBe(MARKETING_ACCENT);
    expect(declared(sources.app, "--accent-ink")).toBe("#ffffff");
    expect(declared(sources.landing, "--accent-ink")).toBe("#ffffff");
    expect(declared(sources.dashboard, "--ws-accent")).toBe(V4_ACCENT);
  });

  it("ui.css reads the accent through the brand token chain", () => {
    // ui.css primitives read var(--yr-accent, var(--accent, ...)) so they follow
    // the host product's accent (operator cobalt, or a board's own brand on
    // public pages) rather than hardcoding a colour. Guard the chain exists and
    // that no component reintroduces a hardcoded purple accent.
    expect(sources.ui).toContain("var(--yr-accent, var(--accent");
    expect(sources.ui.toLowerCase()).not.toContain("#7c3aed");
  });

  it("keeps marketing status fills consistent", () => {
    expect(declared(sources.app, "--ok")).toBe("#16c784");
    expect(declared(sources.landing, "--ok")).toBe("#16c784");
    expect(declared(sources.app, "--warn")).toBe("#f59e0b");
    expect(declared(sources.landing, "--warn")).toBe("#f59e0b");
    expect(declared(sources.app, "--danger")).toBe("#f43f5e");
    expect(declared(sources.landing, "--danger")).toBe("#f43f5e");
  });

  it("keeps v4 primary action ink legible", () => {
    const ink = declared(sources.dashboard, "--ws-accent-text");
    expect(ink).toBe("#ffffff");
    expect(sources.dashboard).toMatch(/\.btn--accent,[\s\S]*?color:\s*var\(--ws-accent-text\)/);
    expect(contrastRatio(V4_ACCENT, ink)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the public viewer accent on a separate per-board axis", () => {
    // The public board accent is the streamer's own colour, NOT the operator
    // brand cobalt — it must resolve from --yr-color-board-accent at runtime.
    expect(declared(sources.publicShell, "--yr-accent")).toBe("var(--yr-color-board-accent)");
    expect(sources.publicRuntime).toContain('value: "var(--yr-color-board-accent)"');
    expect(sources.publicRuntime).toContain('ink: "#000000"');
  });

  it("does not regress to the previous generic indigo/purple accents", () => {
    // Guard against re-introducing the drifted accents this redesign replaced.
    for (const [name, src] of Object.entries({ app: sources.app, dashboard: sources.dashboard, landing: sources.landing })) {
      expect(src.toLowerCase(), `${name} reintroduced #7c3aed`).not.toContain("#7c3aed");
    }
  });
});
