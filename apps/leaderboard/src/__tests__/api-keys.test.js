// Board-scoped API key management routes (/api/sites/:id/api-keys): owner +
// Pro/Team gating, list scope labels, create/rotate/revoke semantics, and the
// guarantee that account-level keys are never managed here.
//
// Run: bun test src/__tests__/api-keys.test.js

import { describe, expect, it } from "bun:test";
import {
  handleListApiKeys,
  handleCreateApiKey,
  handleRotateApiKey,
  handleDeleteApiKey,
} from "../handlers/api-keys.js";

const future = Date.now() + 86_400_000 * 30;
const userFor = (plan) => ({ id: "user-1", plan, plan_expires_at: plan === "free" ? null : future, status: "active" });
const site = { id: "site-1", user_id: "user-1", slug: "kick-cup" };

function deps(user, overrides = {}) {
  const calls = { create: [], revoke: [], list: 0, lookup: 0, limits: [] };
  return {
    calls,
    deps: {
      requireUser: async () => ({ user, res: null }),
      rateLimit: async (env, bucket) => { calls.limits.push(bucket); return { ok: true }; },
      getBoardById: async () => site,
      effectivePlan: () => user.plan,
      listApiKeys: async () => { calls.list += 1; return []; },
      createPostbackKeyRecord: async (userId, opts) => {
        calls.create.push({ userId, opts });
        return { key: "pk_new_board", id: "key-new", createdAt: "2026-01-01T00:00:00Z", expiresAt: null };
      },
      revokePostbackKeyById: async (userId, keyId, siteId) => { calls.revoke.push({ userId, keyId, siteId }); return overrides.revoked ?? 1; },
      one: async () => ("existing" in overrides ? overrides.existing : { id: "key-1" }),
      ...overrides.deps,
    },
  };
}

const listReq = () => new Request("https://yourrank.site/api/sites/site-1/api-keys");
const createReq = () => new Request("https://yourrank.site/api/sites/site-1/api-keys", { method: "POST" });
const rotateReq = (keyId = "key-1") => new Request(`https://yourrank.site/api/sites/site-1/api-keys/${keyId}/rotate`, { method: "POST" });
const deleteReq = (keyId = "key-1") => new Request(`https://yourrank.site/api/sites/site-1/api-keys/${keyId}`, { method: "DELETE" });

describe("board API key management", () => {
  it("lists keys with board/account scope labels", async () => {
    const { deps: d, calls } = deps(userFor("pro"), {
      deps: {
        listApiKeys: async (userId, siteId) => {
          calls.list += 1;
          expect(userId).toBe("user-1");
          expect(siteId).toBe("site-1");
          return [
            { id: "key-a", siteId: null, label: "account", createdAt: "t", lastUsedAt: null, expiresAt: null, key: "pk_acct" },
            { id: "key-b", siteId: "site-1", label: "kick-cup", createdAt: "t", lastUsedAt: null, expiresAt: null, key: "pk_board" },
          ];
        },
      },
    });
    const res = await handleListApiKeys(listReq(), {}, d);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.keys.map((k) => k.scope)).toEqual(["account", "board"]);
    expect(body.keys[0].key).toBe("pk_acct");
  });

  it("creates a board-scoped key labelled with the board slug", async () => {
    const { deps: d, calls } = deps(userFor("team"));
    const res = await handleCreateApiKey(createReq(), {}, d);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(calls.create).toEqual([{ userId: "user-1", opts: { label: "kick-cup", siteId: "site-1" } }]);
    expect(body.key).toMatchObject({ id: "key-new", scope: "board", key: "pk_new_board" });
    expect(calls.limits).toContain("api-keys-create:user-1");
  });

  it("rotates an existing board key: creates the replacement then revokes the old id", async () => {
    const { deps: d, calls } = deps(userFor("pro"));
    const res = await handleRotateApiKey(rotateReq("key-1"), {}, d);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(calls.create).toEqual([{ userId: "user-1", opts: { label: "kick-cup", siteId: "site-1" } }]);
    expect(calls.revoke).toEqual([{ userId: "user-1", keyId: "key-1", siteId: "site-1" }]);
    expect(body.key.scope).toBe("board");
  });

  it("revokes a board key by id", async () => {
    const { deps: d, calls } = deps(userFor("pro"));
    const res = await handleDeleteApiKey(deleteReq("key-1"), {}, d);
    expect(res.status).toBe(200);
    expect(calls.revoke).toEqual([{ userId: "user-1", keyId: "key-1", siteId: "site-1" }]);
  });

  it("rejects rotate and revoke for keys not scoped to this board (including account keys)", async () => {
    const { deps: d } = deps(userFor("pro"), { existing: null, revoked: 0 });
    expect((await handleRotateApiKey(rotateReq("key-acct"), {}, d)).status).toBe(404);
    expect((await handleDeleteApiKey(deleteReq("key-acct"), {}, d)).status).toBe(404);
  });

  it("requires the caller to be the site owner", async () => {
    const { deps: d, calls } = deps(userFor("pro"), {
      deps: { getBoardById: async () => ({ ...site, user_id: "someone-else" }) },
    });
    const res = await handleListApiKeys(listReq(), {}, d);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only the board owner can manage API keys.");
    expect(calls.list).toBe(0);
  });

  it("404s when the board is unknown to the caller", async () => {
    const { deps: d } = deps(userFor("pro"), { deps: { getBoardById: async () => null } });
    expect((await handleListApiKeys(listReq(), {}, d)).status).toBe(404);
  });

  it("requires Pro or Team", async () => {
    const { deps: d, calls } = deps(userFor("free"));
    const res = await handleListApiKeys(listReq(), {}, d);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Signed score API is available on Pro and Team.");
    expect(calls.list).toBe(0);
  });

  it("rejects suspended users and enforces the per-user rate limit", async () => {
    const suspended = deps({ ...userFor("pro"), status: "suspended" });
    expect((await handleListApiKeys(listReq(), {}, suspended.deps)).status).toBe(403);
    const limited = deps(userFor("pro"), { deps: { rateLimit: async () => ({ ok: false }) } });
    expect((await handleCreateApiKey(createReq(), {}, limited.deps)).status).toBe(429);
  });

  it("never logs key material", async () => {
    const logged = [];
    const originals = {};
    for (const level of ["log", "info", "warn", "error", "debug"]) {
      originals[level] = console[level];
      console[level] = (...args) => { logged.push(args.join(" ")); };
    }
    try {
      const { deps: d } = deps(userFor("pro"));
      await handleCreateApiKey(createReq(), {}, d);
      await handleRotateApiKey(rotateReq(), {}, d);
      await handleDeleteApiKey(deleteReq(), {}, d);
    } finally {
      for (const level of Object.keys(originals)) console[level] = originals[level];
    }
    expect(logged.join("\n")).not.toContain("pk_");
  });
});
