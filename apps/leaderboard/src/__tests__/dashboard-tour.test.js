import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  MAX_TOUR_STEPS,
  NO_TARGET,
  TOUR_STEPS,
  hasSeenTour,
  markTourSeen,
  tourSeenKey,
} from "../assets/dashboard/tour-steps.js";

// P4-1: creator onboarding tour — persistence contract, step budget, and the
// route-hygiene gate (the tour must navigate through the manifest-backed
// helpers, never hard-coded /dashboard literals). The pure data lives in
// tour-steps.js; the DOM-owning runner (tour.js) is gated via source reads,
// matching how the suite tests other dashboard client modules.

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
};

describe("tour persistence", () => {
  it("keys completion per account so a shared browser does not suppress new tours", () => {
    expect(tourSeenKey("u1")).toBe("yr-tour:u1");
    expect(tourSeenKey("")).toBe("yr-tour:anon");
    expect(tourSeenKey(undefined)).toBe("yr-tour:anon");
  });

  it("starts unseen and records completion exactly once per key", () => {
    const storage = memoryStorage();
    expect(hasSeenTour("u1", storage)).toBe(false);
    markTourSeen("u1", storage);
    expect(hasSeenTour("u1", storage)).toBe(true);
    expect(hasSeenTour("u2", storage)).toBe(false);
  });

  it("treats unavailable storage as unseen and never throws on write", () => {
    const broken = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(hasSeenTour("u1", broken)).toBe(false);
    expect(() => markTourSeen("u1", broken)).not.toThrow();
  });
});

describe("tour steps", () => {
  it("keeps the walkthrough inside the recommended step budget", () => {
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(MAX_TOUR_STEPS);
    expect(MAX_TOUR_STEPS).toBeLessThanOrEqual(7);
  });

  it("opens on a welcome card and closes on the Kick connection CTA", () => {
    const ids = TOUR_STEPS.map((step) => step.id);
    expect(ids[0]).toBe("welcome");
    expect(ids[ids.length - 1]).toBe("kick");
    expect(ids).toEqual(["welcome", "setup", "scoring", "overlays", "kick"]);
  });

  it("highlights the audit-mandated concepts: checklist, scoring, OBS, Kick", () => {
    expect(TOUR_STEPS.map((s) => s.target)).toEqual([
      NO_TARGET,
      "#ovSetup",
      "#ovTopPlayers",
      "#overlayDesignerCard",
      NO_TARGET,
    ]);
    const kick = TOUR_STEPS[TOUR_STEPS.length - 1];
    expect(kick.ctaRoute).toEqual(["siteConnections", "channel"]);
    expect(kick.ctaLabel).toBe("Open connections");
  });

  it("runner navigates only through manifest-backed routes (no dashboard literals)", () => {
    const src = readFileSync(
      new URL("../assets/dashboard/tour.js", import.meta.url),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    expect(src).not.toMatch(/["'`]\/dashboard/);
    expect(src).toContain("requestDashboardRoute(");
    // Completion is recorded up front, so closing the tab mid-tour still
    // respects "never show the same onboarding twice".
    expect(src).toContain("markTourSeen(tourUserId())");
  });

  it("targets only elements rendered on the Home surface", () => {
    const dashboardSrc = readFileSync(
      new URL("../pages/dashboard.jsx", import.meta.url),
      "utf8",
    );
    for (const selector of ["#ovSetup", "#ovTopPlayers", "#overlayDesignerCard"]) {
      const needle = selector.startsWith("#")
        ? `id="${selector.slice(1)}"`
        : selector.slice(1);
      expect(dashboardSrc.includes(needle), selector).toBe(true);
    }
  });
});
