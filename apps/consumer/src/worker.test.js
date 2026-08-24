import { describe, expect, it } from "bun:test";
import { handleDlq, handleEvent, processQueueMessages, refreshConsumerHeartbeat } from "./worker.js";
import { processAccountExport } from "./account-export.js";

function message(id) {
  return { id, acked: 0, retried: 0, ack() { this.acked++; }, retry() { this.retried++; } };
}

describe("analytics queue events", () => {
  it("forwards the visitor hash to bumpStat", async () => {
    const calls = [];
    await handleEvent({
      type: "bump",
      siteId: "site-1",
      field: "views",
      referer: "https://example.com",
      visitorHash: "hash-1",
      timestamp: 1,
    }, new Map(), {}, {
      bumpStatImpl: async (...args) => calls.push(args),
    });
    expect(calls).toEqual([["site-1", "views", "https://example.com", "hash-1"]]);
  });
});

describe("dead-letter queue persistence", () => {
  it("persists each message before acknowledging it", async () => {
    const calls = [];
    const msg = { id: "message-1", body: { type: "bump", siteId: "site-1" }, acked: 0, retried: 0,
      ack() { this.acked++; }, retry() { this.retried++; } };
    await handleDlq({ queue: "events-dlq", messages: [msg] }, {}, undefined, {
      execImpl: async (...args) => calls.push(args),
      alertImpl: async () => {},
    });
    expect(calls[0][0]).toContain("queue_dlq_events");
    // The body must be bound as a value, not a pre-serialised copy: postgres.js
    // encodes it for the jsonb column, so a string here lands as a JSON string.
    expect(calls[0][1][3]).toEqual({ type: "bump", siteId: "site-1" });
    expect(msg.acked).toBe(1);
    expect(msg.retried).toBe(0);
  });

  it("retries instead of acknowledging when persistence fails", async () => {
    const msg = { id: "message-2", body: { type: "click" }, acked: 0, retried: 0,
      ack() { this.acked++; }, retry() { this.retried++; } };
    await handleDlq({ queue: "events-dlq", messages: [msg] }, {}, undefined, {
      execImpl: async () => { throw new Error("database unavailable"); },
      alertImpl: async () => {},
    });
    expect(msg.acked).toBe(0);
    expect(msg.retried).toBe(1);
  });
});

describe("queue batch processing", () => {
  it("bounds concurrency and retries only the failed message once", async () => {
    const messages = [message("1"), message("2"), message("3"), message("4"), message("5")];
    let active = 0;
    let peak = 0;
    const result = await processQueueMessages(messages, async (msg) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      if (msg.id === "3") throw new Error("failed");
    });

    expect(peak).toBeLessThanOrEqual(4);
    expect(result).toEqual({ processed: 4, failed: 1 });
    expect(messages.filter((msg) => msg.acked === 1)).toHaveLength(4);
    expect(messages.filter((msg) => msg.retried === 1)).toHaveLength(1);
    expect(messages.every((msg) => msg.acked + msg.retried === 1)).toBe(true);
  });
});

describe("consumer heartbeat", () => {
  it("refreshes last_seen without changing processed or failed counts", async () => {
    const row = { last_seen: 0, processed_count: 17, failed_count: 4 };
    const calls = [];
    await refreshConsumerHeartbeat(async (sql, params) => {
      calls.push([sql, params]);
      row.last_seen++;
    });

    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(
      `INSERT INTO consumer_heartbeat (name, last_seen, processed_count, failed_count)
       VALUES ('consumer', now(), 0, 0)
       ON CONFLICT (name) DO UPDATE SET last_seen = now()`
    );
    expect(calls[0][1]).toEqual([]);
    expect(row).toEqual({ last_seen: 1, processed_count: 17, failed_count: 4 });
  });
});

describe("account export artifacts", () => {
  it("selects only canonical user identity columns", async () => {
    let usersSql = "";
    const bucket = {
      async createMultipartUpload() {
        return {
          async uploadPart() { return { partNumber: 1, etag: "etag" }; },
          async complete() {},
          async abort() {},
        };
      },
    };
    const read = async (sql) => {
      if (sql.includes("FROM users")) {
        usersSql = sql;
        return [{ id: "user-1" }];
      }
      if (sql.includes("FROM sites")) return [];
      if (sql.includes("COUNT(*)")) return [{ count: "0" }];
      return [];
    };
    const write = async (sql) => sql.includes("RETURNING id") ? [{ id: "job-1" }] : [];

    await processAccountExport(
      { exportId: "job-1", userId: "user-1" },
      { ACCOUNT_EXPORTS: bucket },
      { queryImpl: read, execImpl: write, logAuditImpl: async () => {} }
    );

    expect(usersSql).toContain("telegram_user_id");
    expect(usersSql).toContain("telegram_username");
    expect(usersSql).not.toContain("telegram_id");
  });

  it("writes a manifest with exactly the synchronous export collections", async () => {
    const chunks = [];
    const uploads = [];
    const bucket = {
      async createMultipartUpload() {
        return {
          async uploadPart(_part, body) {
            chunks.push(new TextDecoder().decode(body));
            uploads.push(body.byteLength);
            return { partNumber: _part, etag: "etag" };
          },
          async complete() {},
          async abort() { throw new Error("should not abort"); },
        };
      },
    };
    const read = async (sql) => {
      if (sql.includes("FROM users")) return [{ id: "user-1", email: "u@example.com" }];
      if (sql.includes("FROM sites")) return [{ id: "site-1", slug: "board" }];
      if (sql.includes("COUNT(*)")) return [{ count: "0" }];
      return [];
    };
    const write = async (sql) => sql.includes("RETURNING id") ? [{ id: "job-1" }] : [];
    await processAccountExport(
      { exportId: "job-1", userId: "user-1" },
      { ACCOUNT_EXPORTS: bucket },
      { queryImpl: read, execImpl: write, logAuditImpl: async () => {} }
    );
    const lines = chunks.join("").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines[0].manifest.tables).toEqual([
      "exportedAt", "user", "sites", "players", "archives", "subscriptions",
      "payments", "sessions", "offers", "shortLinks", "conversions", "bots",
      "botCommands", "broadcasts", "botSubscribers", "postbackKeys",
      "featureOverrides", "onboardingEmails", "referralRewards", "auditLog",
      "adminAudit", "supportMessages", "siteStatsHourly", "siteReferrers",
      "viewers", "siteViewers", "creditLedger", "redemptions", "shopItems",
      "creditRewardMappings", "kickRewardEvents", "viewerUsernameHistory",
      "siteGameSettings", "gameSeeds", "gameSeedReveals", "gameRounds",
      "playerSubscriptions", "streamChannels", "siteVisitorStats",
      "siteScrollDepth", "siteClicks",
    ]);
    expect(lines.slice(1).map((line) => line.table || (line.trailer && "trailer"))).toEqual(["user", "sites", "siteVisitorStats", "trailer"]);
    expect(lines.at(-1).trailer.complete).toBe(true);
    expect(lines.at(-1).trailer.rowCounts).toMatchObject({ user: 1, sites: 1 });
    expect(uploads.length).toBe(1);
  });

  it("never emits session tokens and safely paginates OR-filtered collections", async () => {
    const lines = [];
    const bucket = {
      async createMultipartUpload() {
        return {
          async uploadPart(_part, body) { lines.push(...new TextDecoder().decode(body).trim().split("\n")); return { partNumber: _part, etag: "etag" }; },
          async complete() {},
          async abort() {},
        };
      },
    };
    const referralRows = Array.from({ length: 501 }, (_, i) => ({ id: `ref-${i}`, referrer_id: "user-1", referred_id: `other-${i}`, reward_days: 1, created_at: "2026-01-01" }));
    const adminRows = Array.from({ length: 501 }, (_, i) => ({ id: `audit-${i}`, admin_id: "user-1", target_user_id: `other-${i}`, action: "view", details: {}, created_at: "2026-01-01" }));
    const read = async (sql, params = []) => {
      if (sql.includes("FROM users")) return [{ id: "user-1" }];
      if (sql.includes("FROM sites")) return [];
      if (sql.includes("COUNT(*)")) return [{ count: "501" }];
      if (sql.includes("FROM sessions")) return [{ token: "secret-session-token", created_at: "2026-01-01", expires_at: "2026-02-01", twofa_verified: false }];
      if (sql.includes("FROM referral_rewards")) {
        return params.length > 1 ? referralRows.slice(500) : referralRows.slice(0, 500);
      }
      if (sql.includes("FROM admin_audit")) {
        return params.length > 1 ? adminRows.slice(500) : adminRows.slice(0, 500);
      }
      return [];
    };
    const write = async (sql) => sql.includes("RETURNING id") ? [{ id: "job-1" }] : [];
    await processAccountExport(
      { exportId: "job-1", userId: "user-1" },
      { ACCOUNT_EXPORTS: bucket },
      { queryImpl: read, execImpl: write, logAuditImpl: async () => {} }
    );
    const parsed = lines.map((line) => JSON.parse(line));
    const session = parsed.find((line) => line.table === "sessions");
    expect(session.row).toEqual({ created_at: "2026-01-01", expires_at: "2026-02-01", twofa_verified: false });
    expect(JSON.stringify(parsed)).not.toContain("secret-session-token");
    expect(parsed.filter((line) => line.table === "referralRewards")).toHaveLength(501);
    expect(parsed.filter((line) => line.table === "adminAudit")).toHaveLength(501);
  });

  it("aborts an incomplete multipart upload when export processing fails", async () => {
    let aborted = false;
    const bucket = {
      async createMultipartUpload() {
        return {
          async uploadPart() { return { partNumber: 1, etag: "etag" }; },
          async complete() {},
          async abort() { aborted = true; },
        };
      },
    };
    const read = async (sql) => {
      if (sql.includes("FROM users")) return [{ id: "user-1" }];
      if (sql.includes("FROM sites")) return [];
      if (sql.includes("COUNT(*)")) return [{ count: "0" }];
      if (sql.includes("FROM players")) throw new Error("database unavailable");
      return [];
    };
    const write = async (sql) => sql.includes("RETURNING id") ? [{ id: "job-1" }] : [];
    await processAccountExport(
      { exportId: "job-1", userId: "user-1" },
      { ACCOUNT_EXPORTS: bucket },
      { queryImpl: read, execImpl: write, logAuditImpl: async () => {} }
    );
    expect(aborted).toBe(true);
  });

  it("uploads fixed-size multipart parts except for the final part", async () => {
    const partSizes = [];
    const bucket = {
      async createMultipartUpload() {
        return {
          async uploadPart(partNumber, body) {
            partSizes.push([partNumber, body.byteLength]);
            return { partNumber, etag: "etag" };
          },
          async complete() {},
          async abort() {},
        };
      },
    };
    const read = async (sql) => {
      if (sql.includes("FROM users")) return [{ id: "user-1", email: "x".repeat(8 * 1024 * 1024) }];
      if (sql.includes("FROM sites")) return [];
      if (sql.includes("COUNT(*)")) return [{ count: "0" }];
      return [];
    };
    const write = async (sql) => sql.includes("RETURNING id") ? [{ id: "job-1" }] : [];
    await processAccountExport(
      { exportId: "job-1", userId: "user-1" },
      { ACCOUNT_EXPORTS: bucket },
      { queryImpl: read, execImpl: write, logAuditImpl: async () => {} }
    );
    expect(partSizes.length).toBeGreaterThan(1);
    expect(partSizes.slice(0, -1).every(([, size]) => size === 8 * 1024 * 1024)).toBe(true);
  });

  it("pseudonymises viewer data consistently and excludes secrets and raw analytics", async () => {
    const lines = [];
    const bucket = {
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
    const read = async (sql) => {
      if (sql.includes("FROM site_visitors")) return [{ site_id: "site-1", visitor_count: 1, first_seen: "2026-01-01", last_seen: "2026-01-02", sessions: 2 }];
      if (sql.includes("COUNT(*)")) return [{ count: "1" }];
      if (sql.includes("FROM users")) return [{ id: "user-1", email: "owner@example.com" }];
      if (sql.includes("FROM sites")) return [{ id: "site-1", slug: "board" }];
      if (sql.includes("FROM viewers")) return [{ id: "viewer-1", kick_user_id: "kick-1", kick_access_token_enc: "OAUTH-ACCESS-SECRET", discord_refresh_token_enc: "OAUTH-REFRESH-SECRET", created_at: "2026-01-01", updated_at: "2026-01-02", has_kick_identity: true }];
      if (sql.includes("FROM site_viewers")) return [{ id: "sv-1", site_id: "site-1", viewer_id: "viewer-1", public_token: "PUBLIC-BEARER-SECRET", balance: 10, total_earned: 20, total_spent: 10, blocked: false, fraud_score: 0 }];
      if (sql.includes("FROM credit_ledger")) return [{ id: "ledger-1", site_viewer_id: "sv-1", type: "earn", amount: 5, description: "earned", metadata: { game: "dice", secret: "must-drop" }, created_at: "2026-01-01" }];
      if (sql.includes("FROM redemptions")) return [{ id: "redemption-1", site_viewer_id: "sv-1", shop_item_id: "item-1", cost: 5, status: "fulfilled", created_at: "2026-01-01", updated_at: "2026-01-01" }];
      if (sql.includes("FROM kick_reward_events")) return [{ event_id: "event-1", event_type: "reward", site_id: "site-1", reward_id: "reward-1", redeemer_kick_user_id: "kick-1", reward_cost: 100, status: "processed", viewer_id: "viewer-1", payload: { secret: "KICK-RAW-PAYLOAD-SECRET" } }];
      if (sql.includes("FROM viewer_username_history")) return [{ id: "history-1", viewer_id: "viewer-1", username: "viewer-name", seen_at: "2026-01-01" }];
      if (sql.includes("FROM game_seeds")) return [{ id: "seed-1", site_viewer_id: "sv-1", viewer_id: "viewer-1", server_seed: "ACTIVE-SERVER-SEED", server_seed_hash: "hash", client_seed: "client", nonce: 1 }];
      if (sql.includes("FROM game_seed_reveals")) return [{ id: "reveal-1", site_viewer_id: "sv-1", viewer_id: "viewer-1", server_seed: "REVEALED-SEED", server_seed_hash: "old-hash", client_seed: "old-client", final_nonce: 2 }];
      if (sql.includes("FROM game_rounds")) return [{ id: "round-1", site_id: "site-1", site_viewer_id: "sv-1", viewer_id: "viewer-1", game: "dice", bet: 5, state: "settled", payout: 10, multiplier: 2, house_edge_bps: 100, server_seed_hash: "hash", client_seed: "client", nonce: 1, params: { target: 50, direction: "over", secret: "drop-me" }, outcome: { target: 50, roll: 75, win: true, secret: "drop-me" }, revealed: [1] }];
      if (sql.includes("FROM player_subscriptions")) return [{ id: "subscription-1", site_id: "site-1", bot_id: "bot-1", tg_user_id: 123, player_name: "Telegram Viewer", created_at: "2026-01-01" }];
      if (sql.includes("FROM site_visitors")) return [{ site_id: "site-1", visitor_hash: "RAW-VISITOR-HASH-SECRET", visitor_count: 1, first_seen: "2026-01-01", last_seen: "2026-01-02", sessions: 2 }];
      if (sql.includes("FROM sessions")) return [{ token: "SESSION-SECRET", created_at: "2026-01-01", expires_at: "2026-02-01", twofa_verified: false }];
      return [];
    };
    const write = async (sql) => sql.includes("RETURNING id") ? [{ id: "job-1" }] : [];
    await processAccountExport(
      { exportId: "job-1", userId: "user-1" },
      { ACCOUNT_EXPORTS: bucket },
      { queryImpl: read, execImpl: write, logAuditImpl: async () => {} }
    );
    const parsed = lines.map((line) => JSON.parse(line));
    const row = (table) => parsed.find((line) => line.table === table)?.row;
    expect(row("viewers").viewer_ref).toBe(row("siteViewers").viewer_ref);
    expect(row("siteViewers").viewer_ref).toBe(row("gameRounds").viewer_ref);
    expect(row("kickRewardEvents").viewer_ref).toBe(row("viewers").viewer_ref);
    const artifact = JSON.stringify(parsed);
    expect(artifact).not.toContain("ACTIVE-SERVER-SEED");
    expect(artifact).not.toContain("SESSION-SECRET");
    expect(artifact).not.toContain("OAUTH-ACCESS-SECRET");
    expect(artifact).not.toContain("OAUTH-REFRESH-SECRET");
    expect(artifact).not.toContain("PUBLIC-BEARER-SECRET");
    expect(artifact).not.toContain("KICK-RAW-PAYLOAD-SECRET");
    expect(artifact).not.toContain("RAW-VISITOR-HASH-SECRET");
    expect(artifact).not.toContain("must-drop");
    expect(artifact).not.toContain("viewer-name");
    expect(artifact).not.toContain("Telegram Viewer");
    expect(artifact).not.toContain("RAW-VISITOR-HASH-SECRET");
    expect(artifact).not.toContain("PROVIDER-RAW-PAYLOAD-SECRET");
    expect(row("siteVisitorStats")).toEqual(expect.objectContaining({ visitor_count: 1, sessions: 2 }));
    expect(row("gameSeedReveals").server_seed).toBe("REVEALED-SEED");
    expect(row("gameRounds").params).toEqual({ target: 50, direction: "over" });
    expect(row("gameRounds").outcome).toEqual({ target: 50, roll: 75, win: true });
  });
});
