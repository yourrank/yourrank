import { describe, expect, it } from "bun:test";
import { processViewerExport, VIEWER_EXPORT_TABLES } from "./viewer-export.js";

function bucket(lines) {
  return {
    async createMultipartUpload() {
      return {
        async uploadPart(_part, body) {
          lines.push(...new TextDecoder().decode(body).trim().split("\n"));
          return { partNumber: _part, etag: "etag" };
        },
        async complete() {},
        async abort() {},
      };
    },
  };
}

describe("viewer export artifacts", () => {
  it("exports only the requesting viewer, sanitizes JSON, and excludes credentials", async () => {
    const lines = [];
    const database = {
      viewers: [
        { id: "viewer-1", kick_user_id: "kick-1", kick_username: "viewer-one", discord_user_id: null, discord_username: null, avatar_url: null, created_at: "2026-01-01", updated_at: "2026-01-02" },
        { id: "viewer-2", kick_user_id: "kick-2", kick_username: "viewer-two", discord_user_id: null, discord_username: null, avatar_url: null, created_at: "2026-01-01", updated_at: "2026-01-02", secret: "VIEWER-2-SECRET" },
      ],
      siteViewers: [
        { id: "sv-1", site_id: "site-1", viewer_id: "viewer-1" },
        { id: "sv-2", site_id: "site-1", viewer_id: "viewer-2" },
      ],
    };
    const read = async (sql, params = []) => {
      if (sql.includes("FROM viewers WHERE")) {
        return database.viewers.filter((row) => row.id === params[0]).map((row) => ({ ...row, discord_access_token_enc: "OAUTH-SECRET" }));
      }
      if (sql.includes("SELECT id FROM site_viewers")) return database.siteViewers.filter((row) => row.viewer_id === params[0]).map((row) => ({ id: row.id }));
      if (sql.includes("site_id AS id")) return [{ id: "site-1" }];
      if (sql.includes("COUNT(*)")) return [{ count: "1" }];
      if (sql.includes("FROM site_viewers sv")) return [{ id: "sv-1", site_id: "site-1", balance: 10, total_earned: 20, total_spent: 10, blocked: true, block_reason: "fraud: private investigation", fraud_score: 87, created_at: "2026-01-01", updated_at: "2026-01-02" }];
      if (sql.includes("FROM sites s")) return [{ id: "site-1", slug: "board", name: "Board", channel_name: "Channel" }];
      if (sql.includes("FROM credit_ledger")) return [{ id: "ledger-1", site_viewer_id: "sv-1", type: "earn", amount: 20, description: "Reward", metadata: { item_name: "Badge", secret: "DROP-ME" }, created_at: "2026-01-01" }];
      if (sql.includes("FROM redemptions")) return [{ id: "redemption-1", site_viewer_id: "sv-1", shop_item_id: "item-1", cost: 5, status: "fulfilled", created_at: "2026-01-01", updated_at: "2026-01-01", item_name: "Badge", item_description: "A reward" }];
      if (sql.includes("FROM game_rounds")) return [{ id: "round-1", site_id: "site-1", site_viewer_id: "sv-1", game: "dice", bet: 5, state: "settled", payout: 10, multiplier: 2, house_edge_bps: 100, server_seed_hash: "hash", client_seed: "client", nonce: 1, params: { target: 50, secret: "DROP-ME" }, outcome: { roll: 75, win: true, secret: "DROP-ME" }, revealed: [], created_at: "2026-01-01", settled_at: "2026-01-01" }];
      if (sql.includes("FROM game_seeds")) return [{ id: "seed-1", site_viewer_id: "sv-1", server_seed_hash: "hash", client_seed: "client", nonce: 1, rotated_at: "2026-01-01", created_at: "2026-01-01", updated_at: "2026-01-01", server_seed: "ACTIVE-SERVER-SEED" }];
      if (sql.includes("FROM game_seed_reveals")) return [{ id: "reveal-1", site_viewer_id: "sv-1", server_seed: "REVEALED-SEED", server_seed_hash: "old-hash", client_seed: "old-client", final_nonce: 2, revealed_at: "2026-01-01" }];
      if (sql.includes("FROM kick_reward_events")) return [{ event_id: "event-1", event_type: "reward-redeemed", site_id: "site-1", site_slug: "board", site_name: "Board", channel_name: "Channel", reward_id: "reward-1", reward_cost: 100, status: "processed", processed_at: "2026-01-01", created_at: "2026-01-01", payload: { secret: "RAW-PAYLOAD" } }];
      if (sql.includes("FROM viewer_username_history")) return [{ id: "history-1", viewer_id: "viewer-1", username: "viewer-one", seen_at: "2026-01-01" }];
      if (sql.includes("FROM viewer_feedback")) return [{ id: "feedback-1", site_id: "site-1", message: "Hello there", read: false, created_at: "2026-01-01", ip_hash: "IP-HASH" }];
      return [];
    };
    const write = async (sql) => sql.includes("SET status='processing'") ? [{ id: "job-1" }] : [];
    await processViewerExport(
      { exportId: "job-1", viewerId: "viewer-1" },
      { ACCOUNT_EXPORTS: bucket(lines) },
      { queryImpl: read, execImpl: write, logAuditImpl: async () => {} }
    );
    const parsed = lines.map((line) => JSON.parse(line));
    expect(parsed[0].manifest.tables).toEqual(VIEWER_EXPORT_TABLES);
    expect(parsed.at(-1).trailer).toMatchObject({ exportId: "job-1", exportVersion: "viewer-export-v1", complete: true });
    expect(parsed.at(-1).trailer.rowCounts).toMatchObject({ viewer: 1, siteViewers: 1, gameRounds: 1 });
    expect(JSON.stringify(parsed)).not.toContain("viewer-two");
    expect(JSON.stringify(parsed)).not.toContain("VIEWER-2-SECRET");
    expect(JSON.stringify(parsed)).not.toContain("OAUTH-SECRET");
    expect(JSON.stringify(parsed)).not.toContain("ACTIVE-SERVER-SEED");
    expect(JSON.stringify(parsed)).not.toContain("RAW-PAYLOAD");
    expect(JSON.stringify(parsed)).not.toContain("IP-HASH");
    expect(JSON.stringify(parsed)).not.toContain("DROP-ME");
    expect(JSON.stringify(parsed)).not.toContain("private investigation");
    expect(parsed.find((line) => line.table === "siteViewers").row).not.toHaveProperty("block_reason");
    expect(parsed.find((line) => line.table === "siteViewers").row).not.toHaveProperty("fraud_score");
    expect(JSON.stringify(parsed)).toContain("REVEALED-SEED");
    expect(parsed.find((line) => line.table === "creditLedger").row.metadata).toEqual({ item_name: "Badge" });
    expect(parsed.find((line) => line.table === "gameRounds").row.params).toEqual({ target: 50 });
    expect(parsed.find((line) => line.table === "gameRounds").row.outcome).toEqual({ roll: 75, win: true });
  });
});
