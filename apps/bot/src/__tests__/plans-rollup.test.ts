// Tests for bot plans.ts and rollup.ts — plan enforcement, partition management.
// Uses bun:test with mocked DB.
//
// Run: bun test src/__tests__/plans-rollup.test.ts

import { describe, it, expect, mock } from "bun:test";

// ── Mock DB ────────────────────────────────────────────────────────────
const dbUrl   = import.meta.resolve("@yourrank/shared/db");
const dbUrlTs = import.meta.resolve("@yourrank/shared/db");
const realDb = await import(dbUrl);

const mockOne = mock((..._args: any[]): Promise<any> => Promise.resolve(null));
const mockExec = mock((..._args: any[]): Promise<any> => Promise.resolve(undefined));
const mockQuery = mock((..._args: any[]): Promise<any> => Promise.resolve([]));

const dbMock = () => ({
  ...realDb,
  one: (..._args: any[]) => mockOne(..._args),
  exec: (..._args: any[]) => mockExec(..._args),
  query: (..._args: any[]) => mockQuery(..._args),
  getSql: () => null,
  withTransaction: async (fn: any) => fn({ one: (..._a: any[]) => mockOne(..._a), exec: (..._a: any[]) => mockExec(..._a), query: (..._a: any[]) => mockQuery(..._a) }),
});
mock.module(dbUrl, dbMock);
mock.module(dbUrlTs, dbMock);

// Mock crypto
const cryptoUrl   = import.meta.resolve("@yourrank/shared/crypto");
const cryptoUrlTs = import.meta.resolve("@yourrank/shared/crypto");
const realCrypto = await import(cryptoUrl);
const cryptoMock = () => ({
  ...realCrypto,
  decryptToken: (enc: string) => enc,
  encryptToken: (s: string) => s,
  hashToken: async (s: string) => "hash:" + s,
  reencryptToken: (s: string) => s,
  encrypt: (s: string) => s,
  decrypt: (s: string) => s,
  verifyHmacSha256Hex: async () => true,
  safeEqual: (a: string, b: string) => a === b,
  isCurrentVersion: () => true,
  newClickRef: () => "ref",
  newLinkSlug: () => "slug",
  newWebhookSecret: () => "secret",
  newPostbackKey: () => "pbkey",
  bytesToHex: (bytes: Uint8Array) =>
    Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(""),
  hexToBytes: (hex: string) =>
    new Uint8Array(hex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || []),
  hashIp: async (ip: string) => Buffer.from(ip),
});
mock.module(cryptoUrl, cryptoMock);
mock.module(cryptoUrlTs, cryptoMock);

// ── Import after mocks ─────────────────────────────────────────────────
import { PLANS } from "../plans.js";
import { effectivePlan, PLAN_LIMITS, BOARD_LIMITS } from "@yourrank/shared/plans";

// ── PLANS constant (bot-specific) ──────────────────────────────────────
describe("PLANS constant", () => {
  it("defines the Free, Pro, and Team bot tiers", () => {
    expect(PLANS).toHaveProperty("free");
    expect(PLANS).toHaveProperty("pro");
    expect(PLANS).toHaveProperty("team");
    expect(PLANS).not.toHaveProperty("starter");
  });

  it("each plan has required fields", () => {
    for (const [, plan] of Object.entries(PLANS)) {
      expect(plan).toHaveProperty("tier");
      expect(plan).toHaveProperty("label");
      expect(plan).toHaveProperty("maxBots");
      expect(plan).toHaveProperty("maxOffers");
    }
  });
});

// ── effectivePlan (from shared/plans) ──────────────────────────────────
describe("effectivePlan", () => {
  it("returns 'free' for null user", () => {
    expect(effectivePlan(null)).toBe("free");
  });

  it("returns 'free' for expired plan", () => {
    const user = { plan: "pro", plan_expires_at: Date.now() - 86400000 };
    expect(effectivePlan(user)).toBe("free");
  });

  it("returns plan name for active subscription", () => {
    const user = { plan: "pro", plan_expires_at: Date.now() + 86400000 };
    expect(effectivePlan(user)).toBe("pro");
  });

  it("returns 'free' when expiry is null (anti-exploit: null = expired)", () => {
    const user = { plan: "team", plan_expires_at: null };
    expect(effectivePlan(user)).toBe("free");
  });

  it("returns plan name for far-future expiry", () => {
    const user = { plan: "team", plan_expires_at: Date.now() + 365 * 86400000 };
    expect(effectivePlan(user)).toBe("team");
  });
});

// ── PLAN_LIMITS hierarchy ──────────────────────────────────────────────
describe("PLAN_LIMITS", () => {
  it("free has fewer players than pro", () => {
    expect(PLAN_LIMITS.free).toBeLessThan(PLAN_LIMITS.pro);
  });

  it("BOARD_LIMITS: free has fewer boards than pro", () => {
    expect(BOARD_LIMITS.free).toBeLessThan(BOARD_LIMITS.pro);
  });
});
