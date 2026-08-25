// GET /api/site must return the values the canonical site helper already
// normalized. The regression this guards: the handler read raw column names
// (auto_reset_enabled, is_draft, updated_at, password_hash) off the normalized
// object, so every one of them was undefined and the editor reloaded with
// auto-reset, draft state and password protection silently switched off.
//
// Collaborators are injected — no module mocks.
//
// Run: bun test src/__tests__/site-readback-contract.test.js

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { handleGetSite } from "../handlers/sites.js";

const USER = { id: "user-1", plan: "free", status: "active", plan_expires_at: null };

// Shape produced by getUserSite()/getUserSiteById() in ../site.js.
function normalizedSite(overrides = {}) {
  return {
    id: "site-1",
    slug: "testboard",
    published: true,
    isDraft: true,
    passwordProtected: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
    publishedAt: "2025-12-01T00:00:00.000Z",
    autoReset: { enabled: true, clear: "wagers" },
    data: { brand: { name: "Test" }, players: [{ name: "Alice" }] },
    socials: [],
    customDomain: "",
    domainStatus: "pending",
    notify: { telegram_notify: false },
    archives: [{ id: "arc-1", label: "December", at: 1735689600000, players: 7 }],
    ...overrides,
  };
}

function deps(site, calls = {}) {
  return {
    requireUserImpl: () => Promise.resolve({ user: USER, res: null }),
    getUserSiteImpl: (...args) => { calls.byUser = args; return Promise.resolve(site); },
    getUserSiteByIdImpl: (...args) => { calls.byId = args; return Promise.resolve(site); },
    getUserBoardsListImpl: () => Promise.resolve([]),
    onboardingForSiteImpl: () => Promise.resolve({ brand: true }),
  };
}

async function getSite(site, url = "https://test.com/api/site") {
  const calls = {};
  const res = await handleGetSite(new Request(url), {}, deps(site, calls));
  expect(res.status).toBe(200);
  return { body: await res.json(), calls };
}

describe("GET /api/site readback contract", () => {
  it("returns the normalized settings unchanged", async () => {
    const { body } = await getSite(normalizedSite());
    expect(body.ok).toBe(true);
    expect(body.autoReset).toEqual({ enabled: true, clear: "wagers" });
    expect(body.isDraft).toBe(true);
    expect(body.passwordProtected).toBe(true);
    expect(body.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(body.publishedAt).toBe("2025-12-01T00:00:00.000Z");
  });

  it("returns the disabled case as disabled, not as a default", async () => {
    const { body } = await getSite(normalizedSite({
      isDraft: false,
      passwordProtected: false,
      autoReset: { enabled: false, clear: "players" },
    }));
    expect(body.autoReset).toEqual({ enabled: false, clear: "players" });
    expect(body.isDraft).toBe(false);
    expect(body.passwordProtected).toBe(false);
  });

  it("falls back safely when the helper omits autoReset", async () => {
    const site = normalizedSite();
    delete site.autoReset;
    const { body } = await getSite(site);
    expect(body.autoReset).toEqual({ enabled: false, clear: "wagers" });
  });

  it("reads the same fields for a specific board", async () => {
    const { body, calls } = await getSite(
      normalizedSite(),
      "https://test.com/api/site?siteId=site-1",
    );
    expect(calls.byId).toBeDefined();
    expect(calls.byUser).toBeUndefined();
    expect(body.autoReset.enabled).toBe(true);
    expect(body.passwordProtected).toBe(true);
    expect(body.publishedAt).toBe("2025-12-01T00:00:00.000Z");
  });

  it("returns archive rows with the timestamp and player count the client renders", async () => {
    const { body } = await getSite(normalizedSite());
    expect(body.archives).toEqual([{
      id: "arc-1",
      label: "December",
      at: 1735689600000,
      players: 7,
      createdAt: new Date(1735689600000).toISOString(),
      playerCount: 7,
    }]);
  });
});

describe("canonical site helper shape", () => {
  // storage → getUserSite/getUserSiteById → GET /api/site must preserve the
  // value, so both helpers have to keep supplying every field the handler
  // reads. Guards against one helper drifting back to a raw-only shape.
  const siteSource = readFileSync(new URL("../site.js", import.meta.url), "utf8");
  const helpers = ["getUserSite", "getUserSiteById"];

  for (const helper of helpers) {
    it(`${helper}() normalizes the settings the API response reads`, () => {
      const start = siteSource.indexOf(`export async function ${helper}(`);
      expect(start).toBeGreaterThan(-1);
      const body = siteSource.slice(start, siteSource.indexOf("\nexport ", start + 1));
      for (const field of ["isDraft:", "passwordProtected:", "updatedAt:", "publishedAt:", "autoReset:"]) {
        expect(body).toContain(field);
      }
    });
  }
});
