import { describe, expect, it, spyOn } from "bun:test";
import {
  createPostbackKey,
  revokePostbackKeys,
  logPostbackIntake,
  purgeExpiredReplayHashes,
  recordReplayHash,
  releaseReplayHash,
  unsignedPostbacksEnabled,
} from "../postback.js";

describe("postback sunset policy", () => {
  it("keeps unsigned postbacks enabled unless explicitly disabled", () => {
    expect(unsignedPostbacksEnabled()).toBe(true);
    expect(unsignedPostbacksEnabled("true")).toBe(true);
    expect(unsignedPostbacksEnabled("false")).toBe(false);
    expect(unsignedPostbacksEnabled("0")).toBe(false);
  });

  it("emits structured signed-versus-unsigned intake telemetry", () => {
    const info = spyOn(console, "info").mockImplementation(() => {});
    logPostbackIntake("pb_legacy", { id: "key-1", userId: "user-1" }, false);

    const event = JSON.parse(String(info.mock.calls[0][0]));
    expect(event).toMatchObject({
      event: "postback_intake",
      path: "pb_legacy",
      signed: false,
      owner_id: "user-1",
      key_id: "key-1",
    });
    info.mockRestore();
  });
});

describe("postback replay guard", () => {
  it("claims a fresh hash when the insert returns a row", async () => {
    const calls: unknown[][] = [];
    const claimed = await recordReplayHash("user-1", "hash-1", 60, {
      execImpl: async (...args) => {
        calls.push(args);
        return [{ id: "replay-1" }];
      },
    });

    expect(claimed).toBe(true);
    expect(calls[0][0]).toContain("ON CONFLICT (user_id, replay_hash) DO UPDATE");
    expect(calls[0][1]).toEqual(["user-1", "hash-1", 60]);
  });

  it("rejects a live duplicate when the claim returns no row", async () => {
    const rejected = await recordReplayHash("user-1", "hash-1", 60, {
      execImpl: async () => [],
    });

    expect(rejected).toBe(false);
  });

  it("reclaims an expired hash through the same atomic statement", async () => {
    let sql = "";
    const reclaimed = await recordReplayHash("user-1", "hash-1", 120, {
      execImpl: async (query) => {
        sql = query;
        return [{ id: "replay-1" }];
      },
    });

    expect(reclaimed).toBe(true);
    expect(sql).toContain("WHERE postback_replay_guard.expires_at <= now()");
  });

  it("releases a claimed hash when the conversion is not durable", async () => {
    const calls: unknown[][] = [];
    const released = await releaseReplayHash("user-1", "hash-1", {
      execImpl: async (...args) => {
        calls.push(args);
        return [{ id: "replay-1" }];
      },
    });

    expect(released).toBe(true);
    expect(calls[0][0]).toContain("DELETE FROM postback_replay_guard");
    expect(calls[0][1]).toEqual(["user-1", "hash-1"]);
  });

  it("reports when no replay hash was released", async () => {
    const released = await releaseReplayHash("user-1", "hash-1", {
      execImpl: async () => [],
    });

    expect(released).toBe(false);
  });

  it("purges expired hashes in bounded batches", async () => {
    const calls: unknown[][] = [];
    const batches = [[{ id: "1" }, { id: "2" }], [{ id: "3" }], []];
    const deleted = await purgeExpiredReplayHashes(2, {
      execImpl: async (...args) => {
        calls.push(args);
        return batches.shift() || [];
      },
    });

    expect(deleted).toBe(3);
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toContain("LIMIT $1");
    expect(calls[0][1]).toEqual([2]);
    expect(calls[1][1]).toEqual([2]);
  });
});

process.env.TOKEN_ENC_KEY = process.env.TOKEN_ENC_KEY || "00".repeat(32);

describe("board-scoped API keys", () => {
  it("revokes only account keys when no site scope is given", async () => {
    let sql = "";
    let params: unknown[] = [];
    await revokePostbackKeys("user-1", null, {
      execImpl: async (q, p) => { sql = q; params = p; return [{ id: "k1" }]; },
    });
    expect(sql).toContain("site_id IS NULL");
    expect(params).toEqual(["user-1", null]);
  });

  it("revokes only the scoped board's keys when a siteId is given", async () => {
    let sql = "";
    let params: unknown[] = [];
    await revokePostbackKeys("user-1", "keep-1", {
      siteId: "site-9",
      execImpl: async (q, p) => { sql = q; params = p; return [{ id: "k1" }, { id: "k2" }]; },
    });
    expect(sql).toContain("site_id = $3::uuid");
    expect(sql).not.toContain("site_id IS NULL");
    expect(params).toEqual(["user-1", "keep-1", "site-9"]);
  });

  it("persists the site scope on creation and scopes revokeOthers to it", async () => {
    const calls: unknown[][] = [];
    await createPostbackKey("user-1", {
      label: "board",
      revokeOthers: true,
      siteId: "site-9",
      execImpl: async (...args) => {
        calls.push(args);
        return [{ id: "new-key" }];
      },
    });
    expect(calls[0][1][1]).toBe("site-9");
    expect(calls[1][0]).toContain("site_id = $3::uuid");
    expect(calls[1][1]).toEqual(["user-1", "new-key", "site-9"]);
  });
});
