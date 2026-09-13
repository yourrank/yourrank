// Regression tests for the "Layout & blocks" visibility toggles.
//
// Bug history: the section toggles were rendered with a bare `checked`
// attribute and read back by a DOM-scraping collector delegated on the list.
// Three things went wrong:
//   1. The collector wrote `state.EXTRA.sections` but never called markDirty(),
//      so a toggle could change the draft while "Publish changes" stayed
//      disabled.
//   2. The collector bailed when the list was absent (free plan, hidden card),
//      so state was never normalized for those paths.
//   3. The payload shipped raw stored values, so a legacy string/absent key
//      could reach the API as a non-boolean.
//
// These tests pin the normalization contract that fixes all three, and the
// wiring that makes the toggle a controlled input.
//
// Run: bun test src/__tests__/sections-toggles.test.js

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { normalizeSections, DEFAULT_EXTRA } from "../site.js";

const siteJs = readFileSync(new URL("../assets/dashboard/site.js", import.meta.url), "utf8");

// The client `normalizeSections` is in a browser module, so import it through
// the same minimal globals the other dashboard suites use. The module graph
// touches `location`/`history` at import time and `document` when rendering.
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener: () => {},
  body: { innerHTML: "" },
  head: { appendChild: () => {} },
  createElement: () => ({ style: {}, setAttribute: () => {}, addEventListener: () => {}, appendChild: () => {} }),
};
globalThis.window = { addEventListener: () => {}, removeEventListener: () => {}, matchMedia: () => ({ matches: false }), location: null };
globalThis.navigator = {};
globalThis.location = { href: "http://localhost/dashboard/leaderboard/design", origin: "http://localhost", host: "localhost", pathname: "/dashboard/leaderboard/design", search: "" };
globalThis.history = { pushState() {}, replaceState() {}, state: null };
globalThis.requestAnimationFrame = (callback) => callback();
globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });

const client = await import("../assets/dashboard/site.js");

describe("normalizeSections (server payload shape)", () => {
  it("returns a strict boolean for every known block", () => {
    const out = normalizeSections({ leaderboard: false, payouts: true, countdown: false });
    for (const key of Object.keys(out)) {
      expect(typeof out[key]).toBe("boolean");
    }
    expect(out.leaderboard).toBe(false);
    expect(out.payouts).toBe(true);
    expect(out.countdown).toBe(false);
  });

  it("defaults every block on except poweredBy", () => {
    const out = normalizeSections(undefined);
    expect(out.leaderboard).toBe(true);
    expect(out.countdown).toBe(true);
    expect(out.payouts).toBe(true);
    expect(out.poweredBy).toBe(false);
  });

  it("coerces a legacy non-boolean to a boolean instead of passing it through", () => {
    const out = normalizeSections({ leaderboard: "yes", countdown: 0, payouts: null });
    expect(out.leaderboard).toBe(true);
    expect(out.countdown).toBe(true); // `0` is not an explicit `false`
    expect(out.payouts).toBe(true); // `null` means "not turned off"
  });

  it("turns a block off only on an explicit false", () => {
    const out = normalizeSections({ leaderboard: false, countdown: "false" });
    expect(out.leaderboard).toBe(false);
    // A stored string is never treated as the boolean off switch.
    expect(out.countdown).toBe(true);
  });

  it("preserves non-catalog keys a stored row may still carry", () => {
    const out = normalizeSections({ hero: true, top3: false, pastWinners: true });
    expect(out.hero).toBe(true);
    expect(out.top3).toBe(false);
    expect(out.pastWinners).toBe(true);
  });

  it("keeps every catalog key boolean even when the stored row omits them", () => {
    const out = normalizeSections({ leaderboard: false });
    for (const key of ["payouts", "countdown", "rules", "socials", "share", "poweredBy"]) {
      expect(typeof out[key]).toBe("boolean");
    }
  });

  it("survives a non-object input without throwing", () => {
    for (const bad of [null, undefined, "nope", 42, []]) {
      const out = normalizeSections(bad);
      expect(typeof out.leaderboard).toBe("boolean");
    }
  });

  it("agrees with the stored defaults it is derived from", () => {
    const out = normalizeSections(DEFAULT_EXTRA.sections);
    expect(out).toEqual(
      Object.fromEntries(Object.entries(DEFAULT_EXTRA.sections).map(([k, v]) => [k, v !== false])),
    );
  });
});

describe("client and server normalization cannot drift", () => {
  // The editor and the API each own a copy (a Worker asset cannot import from
  // src/, and src/ cannot import a browser asset). They must agree, or a value
  // saved by one reads back differently through the other.
  const CASES = [
    undefined,
    null,
    {},
    { leaderboard: false },
    { countdown: false, poweredBy: true },
    { leaderboard: "yes", payouts: 0, rules: null },
    { hero: false, top3: true, pastWinners: false },
    { unknownKey: true, another: false },
  ];

  it("produces an identical map for every representative input", () => {
    for (const input of CASES) {
      expect(client.normalizeSections(input)).toEqual(normalizeSections(input));
    }
  });

  it("keeps the same default and the same strict-boolean contract", () => {
    expect(client.DEFAULT_SECTIONS).toEqual(DEFAULT_EXTRA.sections);
    for (const input of CASES) {
      for (const value of Object.values(client.normalizeSections(input))) {
        expect(typeof value).toBe("boolean");
      }
    }
  });
});

describe("the /api/site sections contract", () => {
  // handlePutSite is `.strict()` with `sections: z.record(z.boolean())`, so a
  // single non-boolean value rejects the WHOLE save, not just that field. This
  // is why normalization is load-bearing rather than cosmetic: a legacy row
  // carrying `"yes"` or `null` would have failed every save.
  it("accepts a normalized map and rejects raw legacy values", async () => {
    const { handlerSchemas } = await import("@yourrank/shared/validation");
    const schema = handlerSchemas.handlePutSite;
    const accepts = (sections) => schema.safeParse({ sections }).success;

    // Raw values the editor used to ship are rejected.
    expect(accepts({ leaderboard: "yes" })).toBe(false);
    expect(accepts({ payouts: null })).toBe(false);
    expect(accepts({ countdown: 0 })).toBe(false);
    expect(accepts({ rules: undefined })).toBe(false);

    // Everything the editor ships now is accepted.
    for (const input of [
      undefined,
      { leaderboard: false },
      { leaderboard: "yes", payouts: null, countdown: 0 },
      { hero: true, poweredBy: false },
    ]) {
      expect(accepts(normalizeSections(input))).toBe(true);
      expect(accepts(client.normalizeSections(input))).toBe(true);
    }
  });
});

describe("Layout & blocks toggle wiring (client)", () => {
  it("binds each toggle to the state write path, not a list delegate", () => {
    expect(siteJs).toContain("function bindSectionToggle(input)");
    expect(siteJs).toContain('input.addEventListener("change"');
    expect(siteJs).toContain("setSectionValue(input.dataset.sectionToggle, input.checked === true)");
    // The old delegated collector must not be the only write path.
    expect(siteJs).not.toContain('list.addEventListener("input", collectSections)');
  });

  it("marks the draft dirty from the one state write path", () => {
    const start = siteJs.indexOf("function setSectionValue(");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = siteJs.slice(start, siteJs.indexOf("\n}", start));
    expect(body).toContain("markDirty()");
    expect(body).toContain("state.EXTRA.sections =");
  });

  it("normalizes sections before the plan gate so a hidden list keeps its shape", () => {
    const start = siteJs.indexOf("export function renderSections()");
    const body = siteJs.slice(start, siteJs.indexOf("\n}", start));
    const normalizeAt = body.indexOf("state.EXTRA.sections = normalizeSections(");
    const gateAt = body.indexOf("if (!list || !isPro()) return;");
    expect(normalizeAt).toBeGreaterThanOrEqual(0);
    expect(gateAt).toBeGreaterThan(normalizeAt);
  });

  it("emits the checked attribute only for an on block", () => {
    expect(siteJs).toContain('${current[s.key] ? " checked" : ""}');
  });

  it("ships the normalized map in the save payload", () => {
    expect(siteJs).toContain("sections: normalizeSections(state.EXTRA.sections)");
  });

  it("reads the countdown gate from normalized state", () => {
    expect(siteJs).toContain("normalizeSections(state.EXTRA?.sections).countdown");
  });

  it("exposes an accessible switch for each block", () => {
    expect(siteJs).toContain('role="switch"');
    expect(siteJs).toContain('aria-label="${esc(s.label)}"');
  });
});
