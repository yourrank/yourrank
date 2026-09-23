import { describe, expect, it } from "bun:test";
import {
  computeIdempotencyRequestHash,
  reserveIdempotencyKey,
  completeIdempotencyKey,
  releaseIdempotencyKey,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_TTL_S,
  IDEMPOTENCY_LOCK_S,
} from "../api-idempotency.js";

const identity = { userId: "u1", siteId: "s1", endpoint: "POST /api/scores", key: "idem-1" };

describe("computeIdempotencyRequestHash", () => {
  it("hashes method, path, site and raw body deterministically", async () => {
    const a = await computeIdempotencyRequestHash({ method: "POST", path: "/api/scores", siteId: "s1", body: "{}" });
    const b = await computeIdempotencyRequestHash({ method: "POST", path: "/api/scores", siteId: "s1", body: "{}" });
    const c = await computeIdempotencyRequestHash({ method: "PATCH", path: "/api/scores", siteId: "s1", body: "{}" });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("reserveIdempotencyKey", () => {
  it("reserves when the atomic insert returns a row", async () => {
    let sql = "";
    let params: unknown[] = [];
    const result = await reserveIdempotencyKey({ ...identity, requestHash: "h1" }, {
      execImpl: async (q, p) => { sql = q; params = p; return [{ id: "r1" }]; },
    });
    expect(result).toEqual({ state: "reserved" });
    expect(sql).toContain("ON CONFLICT (user_id, site_id, endpoint, idempotency_key) DO UPDATE");
    expect(sql).toContain("WHERE api_idempotency_keys.expires_at <= now()");
    expect(params).toEqual(["u1", "s1", "POST /api/scores", "idem-1", "h1"]);
  });

  it("replays a completed row for the same request", async () => {
    const result = await reserveIdempotencyKey({ ...identity, requestHash: "h1" }, {
      execImpl: async () => [],
      oneImpl: async () => ({ request_hash: "h1", status: "completed", response_status: 200, response_body: { ok: true } }),
    });
    expect(result).toEqual({ state: "replay", status: 200, body: { ok: true } });
  });

  it("reports a payload mismatch", async () => {
    const result = await reserveIdempotencyKey({ ...identity, requestHash: "h2" }, {
      execImpl: async () => [],
      oneImpl: async () => ({ request_hash: "h1", status: "completed", response_status: 200, response_body: {} }),
    });
    expect(result).toEqual({ state: "mismatch" });
  });

  it("reports an in-flight reservation", async () => {
    const result = await reserveIdempotencyKey({ ...identity, requestHash: "h1" }, {
      execImpl: async () => [],
      oneImpl: async () => ({ request_hash: "h1", status: "in_progress", response_status: null, response_body: null }),
    });
    expect(result).toEqual({ state: "in_progress" });
  });
});

describe("completeIdempotencyKey / releaseIdempotencyKey", () => {
  it("stores the response and extends the TTL", async () => {
    let sql = "";
    let params: unknown[] = [];
    const done = await completeIdempotencyKey({ ...identity, status: 200, body: { ok: true } }, {
      execImpl: async (q, p) => { sql = q; params = p; return [{ id: "r1" }]; },
    });
    expect(done).toBe(true);
    expect(sql).toContain("status = 'completed'");
    expect(sql).toContain(`${IDEMPOTENCY_TTL_S}`);
    expect(params[4]).toBe(200);
    expect(params[5]).toEqual({ ok: true });
  });

  it("deletes a failed reservation so the key can be retried", async () => {
    let sql = "";
    const released = await releaseIdempotencyKey(identity, {
      execImpl: async (q) => { sql = q; return [{ id: "r1" }]; },
    });
    expect(released).toBe(true);
    expect(sql).toContain("DELETE FROM api_idempotency_keys");
  });

  it("exports the documented limits", () => {
    expect(IDEMPOTENCY_KEY_MAX_LENGTH).toBe(200);
    expect(IDEMPOTENCY_TTL_S).toBe(86400);
    expect(IDEMPOTENCY_LOCK_S).toBe(60);
  });
});
