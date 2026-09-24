import { describe, expect, it, mock } from "bun:test";
import type { Update } from "grammy/types";
import {
  gateAndDeferTelegramUpdate,
  recoverTelegramWebhookUpdates,
} from "../telegram-webhook.js";

function update(update_id: number): Update {
  return { update_id } as Update;
}

describe("Telegram webhook admission", () => {
  it("processes a claimed update once and ignores a redelivery", async () => {
    const claimedIds: string[] = [];
    const processed: number[] = [];
    const claim = async (botId: string, updateId: number) => {
      const key = `${botId}:${updateId}`;
      if (claimedIds.includes(key)) return false;
      claimedIds.push(key);
      return true;
    };
    const pending: Promise<unknown>[] = [];
    const waitUntil = (promise: Promise<unknown>) => pending.push(promise);

    expect(await gateAndDeferTelegramUpdate({
      botId: "bot-a",
      update: update(7),
      claim,
      meter: null,
      complete: async () => {},
      process: async () => { processed.push(7); },
      waitUntil,
    })).toBe("claimed");
    expect(await gateAndDeferTelegramUpdate({
      botId: "bot-a",
      update: update(7),
      claim,
      process: async () => { processed.push(7); },
      waitUntil,
    })).toBe("duplicate");
    await Promise.all(pending);
    expect(processed).toEqual([7]);
  });

  it("scopes the same update_id independently per bot", async () => {
    const seen = new Set<string>();
    const processed: string[] = [];
    const claim = async (botId: string, updateId: number) => {
      const key = `${botId}:${updateId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };
    const pending: Promise<unknown>[] = [];
    const waitUntil = (promise: Promise<unknown>) => pending.push(promise);

    for (const botId of ["bot-a", "bot-b"]) {
      await gateAndDeferTelegramUpdate({
        botId,
        update: update(9),
        claim,
        meter: null,
        complete: async () => {},
        process: async () => { processed.push(botId); },
        waitUntil,
      });
    }
    await Promise.all(pending);
    expect(processed).toEqual(["bot-a", "bot-b"]);
  });

  it("acknowledges before deferred handler work completes", async () => {
    let resolveHandler!: () => void;
    const handler = new Promise<void>((resolve) => { resolveHandler = resolve; });
    let deferred!: Promise<unknown>;
    await gateAndDeferTelegramUpdate({
      botId: "bot-a",
      update: update(11),
      claim: async () => true,
      complete: async () => {},
      process: () => handler,
      waitUntil: (promise) => { deferred = promise; },
    });
    expect(deferred).toBeDefined();
    let completed = false;
    deferred.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    resolveHandler();
    await deferred;
  });

  it("logs deferred handler failures without rejecting the webhook task", async () => {
    const error = mock();
    let deferred!: Promise<unknown>;
    await gateAndDeferTelegramUpdate({
      botId: "bot-a",
      update: update(13),
      claim: async () => true,
      complete: async () => {},
      process: async () => { throw new Error("handler failed"); },
      waitUntil: (promise) => { deferred = promise; },
      logger: { error },
    });
    await deferred;
    expect(error).toHaveBeenCalled();
  });

  it("propagates a dedup database failure so the route can return 503", async () => {
    await expect(gateAndDeferTelegramUpdate({
      botId: "bot-a",
      update: update(15),
      claim: async () => { throw new Error("database unavailable"); },
      process: async () => {},
      waitUntil: () => {},
    })).rejects.toThrow("database unavailable");
  });

  it("recovers fresh unfinished updates, abandons stale ones, and skips completed rows", async () => {
    const rows = [
      { bot_id: "bot-a", update_id: 21, update_json: update(21), status: "processing" as const },
      { bot_id: "bot-a", update_id: 22, update_json: update(22), status: "abandoned" as const },
      { bot_id: "bot-a", update_id: 23, update_json: update(23), status: "completed" as const },
    ];
    const processed: number[] = [];
    const completed: string[] = [];
    const errors: unknown[][] = [];

    const recovered = await recoverTelegramWebhookUpdates({
      findRecoverable: async () => rows,
      loadBot: async (botId) => ({ id: botId }),
      meter: null,
      process: async (_bot, current) => { processed.push(current.update_id); },
      complete: async (botId, updateId) => { completed.push(`${botId}:${updateId}`); },
      logger: { error: (...args) => errors.push(args) },
    });

    expect(recovered).toBe(1);
    expect(processed).toEqual([21]);
    expect(completed).toEqual(["bot-a:21"]);
    expect(errors).toHaveLength(1);
    expect(String(errors[0][0])).toContain("abandoned stale update");
  });
});


it("recovery meters a claimed-but-unmetered update before processing", async () => {
  const processed: number[] = [];
  const metered: number[] = [];
  const rows = [{ bot_id: "bot-a", update_id: 21, update_json: update(21), status: "processing" as const }];
  const recovered = await recoverTelegramWebhookUpdates({
    findRecoverable: async () => rows,
    complete: async () => {},
    loadBot: async () => ({ id: "bot-a" }),
    process: async (_bot, u) => { processed.push(u.update_id); },
    meter: async (_botId, updateId) => { metered.push(updateId); return "process"; },
  });
  expect(recovered).toBe(1);
  expect(metered).toEqual([21]);
  expect(processed).toEqual([21]);
});

it("recovery skips processing when the meter reports blocked", async () => {
  const processed: number[] = [];
  const rows = [{ bot_id: "bot-a", update_id: 22, update_json: update(22), status: "processing" as const }];
  const recovered = await recoverTelegramWebhookUpdates({
    findRecoverable: async () => rows,
    complete: async () => {},
    loadBot: async () => ({ id: "bot-a" }),
    process: async (_bot, u) => { processed.push(u.update_id); },
    meter: async () => "blocked",
  });
  expect(recovered).toBe(0);
  expect(processed).toEqual([]);
});
