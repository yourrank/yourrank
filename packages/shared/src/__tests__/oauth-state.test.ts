import { describe, expect, test } from "bun:test";
import { consumeOAuthState, storeOAuthState } from "../oauth-state.js";
import type { Tx } from "../db.js";

function transactionDb({ consumeRows = [] as Record<string, unknown>[], insertRows = [{ state: "stored" }] as Record<string, unknown>[] } = {}) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  let consumeCount = 0;
  const withTransaction = async <R>(fn: (tx: Tx) => Promise<R>): Promise<R> => fn({
    unsafe: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes("RETURNING payload")) return consumeRows[consumeCount++] ? [consumeRows[consumeCount - 1]] : [];
      if (sql.includes("RETURNING state")) return insertRows;
      return [];
    },
    one: async () => undefined,
    query: async () => [],
  });
  return { calls, withTransaction };
}

describe("OAuth state storage", () => {
  test("stores state after cleaning expired rows", async () => {
    const db = transactionDb();
    await storeOAuthState("kick", "state-1", { codeVerifier: "verifier", siteId: "site-1" }, db);

    expect(db.calls).toHaveLength(2);
    expect(db.calls[0].sql).toContain("DELETE FROM public.oauth_states WHERE expires_at <= now()");
    expect(db.calls[1].sql).toContain("INSERT INTO public.oauth_states");
    expect(db.calls[1].params).toEqual(["state-1", "kick", { codeVerifier: "verifier", siteId: "site-1" }, 600]);
  });

  test("does not overwrite an existing transaction on a state collision", async () => {
    const db = transactionDb({ insertRows: [] });
    await expect(storeOAuthState("kick", "state-1", { browserNonceHash: "hash" }, db)).rejects.toThrow("OAuth state collision");
    expect(db.calls[1].sql).toContain("ON CONFLICT (state) DO NOTHING");
  });

  test("consumes a state once and rejects a replay", async () => {
    const db = transactionDb({ consumeRows: [{ payload: { userId: "user-1" } }] });

    await expect(consumeOAuthState("kick", "state-1", db)).resolves.toEqual({ userId: "user-1" });
    await expect(consumeOAuthState("kick", "state-1", db)).resolves.toBeNull();

    expect(db.calls[0].sql).toContain("DELETE FROM public.oauth_states");
    expect(db.calls[0].sql).toContain("expires_at > now()");
    expect(db.calls[1].sql).toContain("DELETE FROM public.oauth_states");
  });

  test("supports a short custom TTL for one-time handoffs", async () => {
    const db = transactionDb();
    await storeOAuthState("kick_viewer_handoff", "handoff-1", { viewerId: "viewer-1" }, { ...db, ttlSeconds: 90 });

    expect(db.calls[1].params).toEqual(["handoff-1", "kick_viewer_handoff", { viewerId: "viewer-1" }, 90]);
  });

  test("rejects expired, missing, invalid, and wrong-provider state", async () => {
    const expired = transactionDb();
    await expect(consumeOAuthState("kick", "expired", expired)).resolves.toBeNull();

    const missing = transactionDb();
    await expect(consumeOAuthState("kick", "", missing)).resolves.toBeNull();
    expect(missing.calls).toHaveLength(0);

    const invalid = transactionDb({ consumeRows: [{ payload: "{not-json" }] });
    await expect(consumeOAuthState("kick", "invalid", invalid)).resolves.toBeNull();

    const wrongProvider = transactionDb({ consumeRows: [] });
    await expect(consumeOAuthState("discord", "kick-state", wrongProvider)).resolves.toBeNull();
    expect(wrongProvider.calls[0].params).toEqual(["kick-state", "discord"]);
  });
});
