// ============================================================================
//  C15/F14: per-destination notification delivery identities against a real
//  PostgreSQL queue_event_ledger.
//
//  Proves that when one logical notify event fans out to multiple external
//  destinations (N Discord embeds + 1 Telegram summary), each destination is
//  its own durable delivery:
//   * a mid-sequence failure retries ONLY the failed leg — already-delivered
//     legs are not resent (the original F14 defect);
//   * a full replay of a completed event sends nothing at all;
//   * each leg gets its own ledger row keyed parentEventId#destination.
//
//  Needs the migrated schema (QUEUE_TEST_DATABASE_URL); when
//  NOTIFY_DELIVERY_GATE=required the suite FAILS without a database.
// ============================================================================

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";

const DB_URL = process.env.QUEUE_TEST_DATABASE_URL;
const gateRequired = process.env.NOTIFY_DELIVERY_GATE === "required";
const describeDb = DB_URL ? describe : describe.skip;
const sql = DB_URL ? postgres(DB_URL, { max: 4, onnotice: () => {} }) : (null as never);

let notifyTop3Change: typeof import("../notifications").notifyTop3Change;
let encryptToken: typeof import("../crypto").encryptToken;
let one: typeof import("../db").one;
let query: typeof import("../db").query;

if (DB_URL) {
  process.env.DATABASE_URL = DB_URL;
  process.env.TOKEN_ENC_KEY = "00".repeat(32);
  ({ notifyTop3Change } = await import("../notifications.js"));
  ({ encryptToken } = await import("../crypto.js"));
  ({ one, query } = await import("../db.js"));
}

if (gateRequired && !DB_URL) {
  describe("notify delivery gate", () => {
    it("NOTIFY_DELIVERY_GATE=required but QUEUE_TEST_DATABASE_URL is missing", () => {
      throw new Error("NOTIFY_DELIVERY_GATE=required but QUEUE_TEST_DATABASE_URL is not set; refusing to certify");
    });
  });
}

describeDb("per-destination notify delivery identities (real PostgreSQL)", () => {
  let userId: string;
  let siteId: string;
  let botId: string;
  const parentIds: string[] = [];

  beforeAll(async () => {
    const [user] = await sql`
      INSERT INTO users (email, display_name, status)
      VALUES (${`notify-${Date.now()}@yourrank.test`}, 'notify', 'active') RETURNING id`;
    userId = user.id;
    const token = await encryptToken("123:notify-bot");
    const [bot] = await sql`
      INSERT INTO bots (owner_id, token_encrypted, webhook_secret, status)
      VALUES (${userId}, ${token}, ${`wh-${Date.now()}-${crypto.randomUUID()}`}, 'active') RETURNING id`;
    botId = bot.id;
    // A non-hex webhook value passes decryptCredential through unchanged, so
    // the Discord leg needs no key material.
    const [site] = await sql`
      INSERT INTO sites (user_id, slug, name, board_order, discord_webhook_url_enc, telegram_notify, telegram_chat_id)
      VALUES (${userId}, ${`notify-${Date.now()}`}, 'notify', 1, 'https://discord.example/hook', true, '42') RETURNING id`;
    siteId = site.id;
  });

  afterAll(async () => {
    for (const pid of parentIds) {
      await sql`DELETE FROM queue_event_ledger WHERE event_id LIKE ${pid + "%"}`;
    }
    if (siteId) await sql`DELETE FROM sites WHERE id = ${siteId}`;
    if (botId) await sql`DELETE FROM bots WHERE id = ${botId}`;
    if (userId) await sql`DELETE FROM users WHERE id = ${userId}`;
    await sql.end({ timeout: 1 });
  });

  const changes = [
    { name: "Alice", rank: 1, wagered: 100 },
    { name: "Bob", rank: 2, wagered: 90 },
  ];

  it("a mid-sequence Discord failure retries only the failed leg; delivered legs and Telegram are not resent", async () => {
    const pid = crypto.randomUUID();
    parentIds.push(pid);

    const discordCalls: string[] = [];
    let telegramCalls = 0;
    const sendDiscord = async (_url: string, embed: Record<string, unknown>) => {
      discordCalls.push(String((embed as { title?: string }).title));
      // First embed lands; second embed fails with a clear rejection.
      if (discordCalls.length === 2) return { ok: false, error: "Discord 500" };
      return { ok: true };
    };
    const sendTelegram = async () => {
      telegramCalls++;
      return { ok: true };
    };
    const opts = {
      parentEventId: pid,
      sendDiscordWebhookImpl: sendDiscord as any,
      sendTelegramMessageImpl: sendTelegram as any,
    };

    // First dispatch: embed #1 delivered, embed #2 rejected -> whole dispatch throws.
    await expect(
      notifyTop3Change({ one, query } as any, {}, siteId, "notify", changes, opts)
    ).rejects.toThrow("Discord 500");
    expect(discordCalls).toHaveLength(2);
    expect(telegramCalls).toBe(0); // never reached: discord leg 2 threw first

    // Durable per-leg state after the failure: leg 0 completed, leg 1 failed.
    const [leg0] = await sql`SELECT state FROM queue_event_ledger WHERE event_id = ${pid + "#discord:0"}`;
    expect(leg0.state).toBe("completed");
    const [leg1] = await sql`SELECT state FROM queue_event_ledger WHERE event_id = ${pid + "#discord:1"}`;
    expect(leg1.state).toBe("failed");

    // Retry (the queue's normal behaviour for a failed event): the delivered
    // leg is a duplicate, only the failed one is re-sent, telegram finally
    // goes out.
    discordCalls.length = 0;
    await notifyTop3Change({ one, query } as any, {}, siteId, "notify", changes, opts);
    expect(discordCalls).toHaveLength(1); // ONLY the failed leg re-sent
    expect(telegramCalls).toBe(1);

    const rows = await sql`SELECT event_id, state FROM queue_event_ledger WHERE event_id LIKE ${pid + "%"} ORDER BY event_id`;
    expect(rows.map((r: any) => [r.event_id, r.state])).toEqual([
      [`${pid}#discord:0`, "completed"],
      [`${pid}#discord:1`, "completed"],
      [`${pid}#telegram`, "completed"],
    ]);
  });

  it("a full replay of a completed event sends nothing at all", async () => {
    const pid = crypto.randomUUID();
    parentIds.push(pid);

    let discordCalls = 0;
    let telegramCalls = 0;
    const opts = {
      parentEventId: pid,
      sendDiscordWebhookImpl: (async () => { discordCalls++; return { ok: true }; }) as any,
      sendTelegramMessageImpl: (async () => { telegramCalls++; return { ok: true }; }) as any,
    };

    await notifyTop3Change({ one, query } as any, {}, siteId, "notify", changes, opts);
    expect(discordCalls).toBe(2);
    expect(telegramCalls).toBe(1);

    await notifyTop3Change({ one, query } as any, {}, siteId, "notify", changes, opts);
    expect(discordCalls).toBe(2); // nothing resent
    expect(telegramCalls).toBe(1);

    const rows = await sql`SELECT event_id, state, attempts FROM queue_event_ledger WHERE event_id LIKE ${pid + "%"} ORDER BY event_id`;
    expect(rows.map((r: any) => [r.event_id, r.state, r.attempts])).toEqual([
      [`${pid}#discord:0`, "completed", 1],
      [`${pid}#discord:1`, "completed", 1],
      [`${pid}#telegram`, "completed", 1],
    ]);
  });
  it('deliverNotifyOnce threads the parent event id into the dispatch options', async () => {
    const pid = crypto.randomUUID();
    parentIds.push(pid);
    const { deliverNotifyOnce } = await import('../queue-effects.js');
    let seen: unknown = null;
    const dispatchImpl = async (_db: unknown, _env: unknown, _event: unknown, _cache: unknown, opts: unknown) => {
      seen = opts;
    };
    const result = await deliverNotifyOnce(
      { eventId: pid, eventType: 'notify', correlationId: null, identitySource: 'envelope' },
      { type: 'notify', kind: 'top3', siteId, siteName: 'notify', changes: [] } as any,
      {},
      new Map(),
      {
        runOnceWithLeaseImpl: (async (_identity: unknown, handler: () => Promise<void>) => {
          await handler();
          return { outcome: 'applied' as const };
        }) as any,
        dispatchImpl: dispatchImpl as any,
      },
    );
    expect(result).toEqual({ outcome: 'applied' });
    expect(seen).toEqual({ parentEventId: pid });
  });

});
