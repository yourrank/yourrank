// saveSite() branding persistence through its local dependency-injection seam.
import { describe, it, expect } from "bun:test";
import { saveSite } from "../site.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
const BANNER = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
const OLD = `data:image/webp;base64,${Buffer.from("RIFF    WEBP").toString("base64")}`;
const SITE = { id: "site-1", slug: "x", user_id: "user-1", name: "X", tagline: "", published: true, is_draft: false, updated_at: null };
const FREE = { id: "user-1", plan: "free", plan_expires_at: null, status: "active" };
const PRO = { ...FREE, plan: "pro", plan_expires_at: Date.now() + 86_400_000 };

function harness(existing = "") {
  const calls = [];
  let current = { ...SITE, banner_data: existing };
  const deps = {
    getBoardById: async () => ({ ...current, updated_at: new Date().toISOString() }),
    getPlayers: async () => [],
    one: async (sql) => String(sql).startsWith("SELECT logo_data") ? { logo_data: "", banner_data: current.banner_data } : null,
    query: async () => [],
    withTransaction: async (fn) => fn({
      one: async () => ({ ...current, updated_at: null }),
      unsafe: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).startsWith("UPDATE sites SET slug=")) current.banner_data = params.at(-2);
      },
    }),
    invalidateSiteCache: () => {},
    invalidatePublicBoardCache: () => {},
    logAudit: async () => {},
    notifyLiveBoard: () => {},
    createNotifyQueue: () => ({ send: async () => {}, sendBatch: async () => {} }),
  };
  return { deps, calls };
}

async function run(payload, user = PRO, existing = "") {
  const h = harness(existing);
  const result = await saveSite({}, user, payload, "site-1", null, { deps: h.deps });
  return { result, calls: h.calls };
}

function savedBanner(calls) {
  return calls.find(({ sql }) => sql.startsWith("UPDATE sites SET slug="))?.params.at(-2);
}

describe("saveSite banner persistence", () => {
  it("stores and replaces valid banners", async () => {
    const first = await run({ branding: { banner: BANNER } });
    expect(first.result.ok).toBe(true);
    expect(savedBanner(first.calls)).toBe(BANNER);
    const replacement = await run({ branding: { banner: BANNER } }, PRO, OLD);
    expect(savedBanner(replacement.calls)).toBe(BANNER);
  });

  it("removes a banner and preserves it when omitted", async () => {
    const removed = await run({ branding: { banner: null } }, PRO, OLD);
    expect(removed.result.ok).toBe(true);
    expect(savedBanner(removed.calls)).toBe("");
    const kept = await run({ brand: { tagline: "hi" } }, PRO, OLD);
    expect(savedBanner(kept.calls)).toBe(OLD);
  });

  it("rejects invalid formats before writing", async () => {
    const invalid = await run({ branding: { banner: "data:image/png;base64,R0lGODdh notpng" } });
    expect(invalid.result.code).toBe("invalid_banner");
    expect(invalid.calls.some(({ sql }) => sql.startsWith("UPDATE sites SET slug="))).toBe(false);
    const svg = await run({ branding: { banner: `data:image/svg+xml;base64,${Buffer.from("<svg></svg>").toString("base64")}` } });
    expect(svg.result.code).toBe("invalid_banner");
  });

  it("ignores branding writes on the free plan", async () => {
    const result = await run({ branding: { banner: BANNER } }, FREE);
    expect(result.result.ok).toBe(true);
    expect(savedBanner(result.calls)).toBe("");
  });
});
