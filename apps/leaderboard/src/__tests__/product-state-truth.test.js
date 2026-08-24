// Product surfaces must not claim states that are not real: a loaded panel with
// zero activity is not "data unavailable", a stale draft identical to the saved
// rows is not "Draft changes", and a control that does nothing must not exist.
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const assets = path.resolve(import.meta.dir, "../assets");
const read = (file) => fs.readFileSync(path.join(assets, file), "utf8");
const states = read("dashboard/states.js");
const performance = read("dashboard/performance.js");
const credits = read("credits.js");
const account = read("dashboard/account.js");
const shellNavAsset = read("shell-nav.js");
const appCss = read("app.css");
const sharedShellNav = fs.readFileSync(path.resolve(import.meta.dir, "../../../../packages/shared/src/shell-nav.ts"), "utf8");
const sharedPageShell = fs.readFileSync(path.resolve(import.meta.dir, "../../../../packages/shared/src/page-shell.ts"), "utf8");

describe("metric state vocabulary", () => {
  it("separates a real zero from an unknown value", () => {
    expect(states).toContain("export function setMetricEmpty");
    expect(states).toContain("export function setMetricUnknown");
    // The old copy folded loading, empty and misconfiguration into one string.
    expect(states).not.toContain("stats may still be loading or analytics isn't configured yet");
  });

  it("gives each unknown reason its own copy", () => {
    expect(states).toMatch(/error:\s*"Couldn't load this stat/);
    expect(states).toMatch(/setup:\s*"Not connected yet/);
  });

  it("renders zeros for a loaded but traffic-less analytics period", () => {
    expect(performance).toContain("setMetricEmpty");
    expect(performance).not.toContain("setMetricUnknown");
    expect(performance).toContain('setMetricEmpty($("perfKpiCtr"), { value: "0.0%" })');
  });

  it("renders zeros for a credits economy with no activity yet", () => {
    expect(credits).toContain("setMetricEmpty");
    expect(credits).not.toContain("setMetricUnknown");
  });
});

describe("account export truthfulness", () => {
  it("treats an unconfigured export backend as unavailable, not as a retryable failure", () => {
    expect(account).toContain('job.status === "unavailable"');
    expect(account).toContain('data?.code === "export_not_configured"');
  });
});

describe("removed non-functional controls", () => {
  it("has no appearance/dark-mode control while the workspace has no dark skin", () => {
    expect(sharedShellNav).not.toContain("yrThemeToggle");
    expect(shellNavAsset).not.toContain("yrThemeToggle");
    expect(sharedPageShell).not.toContain("yr-theme");
    expect(appCss).not.toContain('[data-theme="dark"]');
    expect(fs.existsSync(path.join(assets, "theme.js"))).toBe(false);
  });

  it("does not report a sign-out failure it cannot prove", () => {
    expect(shellNavAsset).not.toContain("Couldn't sign out");
    expect(shellNavAsset).toContain("form.submit()");
  });

  it("offers no demo credits, because no demo balance exists anywhere in the product", () => {
    const gamesAsset = read("dashboard/games.js");
    const palette = read("dashboard/command-palette.js");
    const dashboardPage = fs.readFileSync(path.resolve(import.meta.dir, "../pages/dashboard.jsx"), "utf8");
    // The games preview frame is the real viewer island against the real API,
    // so nothing may promise a sandbox balance or claim to refill one.
    for (const src of [gamesAsset, palette, dashboardPage]) {
      expect(src).not.toContain("demo=1");
      expect(src).not.toContain("Demo balance");
      expect(src).not.toContain("demo points");
      expect(src).not.toContain("Reset Demo Credits");
    }
    expect(gamesAsset).toContain("Preview reloaded");
  });
});
