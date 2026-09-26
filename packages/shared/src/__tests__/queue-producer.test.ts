import { describe, expect, it, mock } from "bun:test";
import {
  createQueueProducer,
  parseQueueEvent,
  parseQueueMessage,
  QueueEventValidationError,
  type QueueEvent,
} from "../queue-producer.js";
import { QueueEventValidationError as PackageQueueEventValidationError } from "@yourrank/shared/queue-producer";
import { detectTop3Changes } from "../notifications.js";

const clickEvent: QueueEvent = {
  type: "click",
  shortLinkId: "link-1",
  ipHash: "a".repeat(64),
  tgUserId: 123,
  clickRef: "ref-1",
  timestamp: 1,
};

describe("parseQueueEvent", () => {
  it("accepts a minimized click payload", () => {
    expect(parseQueueEvent(clickEvent)).toEqual(clickEvent);
  });

  it("rejects raw click metadata", () => {
    expect(() => parseQueueEvent({
      ...clickEvent,
      ip: "203.0.113.10",
      userAgent: "browser",
      referer: "https://example.com/private-path",
    })).toThrow();
  });

  it("rejects unknown event types", () => {
    expect(() => parseQueueEvent({ type: "unexpected" })).toThrow();
  });

  it("accepts bump events with visitor hashes", () => {
    expect(parseQueueEvent({
      type: "bump",
      siteId: "site-1",
      field: "views",
      referer: null,
      visitorHash: "b".repeat(64),
      timestamp: 1,
    })).toMatchObject({ type: "bump", visitorHash: "b".repeat(64) });
  });

  it("accepts viewer export events", () => {
    expect(parseQueueEvent({
      type: "viewer-export",
      exportId: "export-1",
      viewerId: "viewer-1",
    })).toEqual({
      type: "viewer-export",
      exportId: "export-1",
      viewerId: "viewer-1",
    });
  });
});

describe("createQueueProducer", () => {
  it("uses the fallback when enqueue fails", async () => {
    const fallbackEvents: QueueEvent[] = [];
    const producer = createQueueProducer(
      { send: async () => { throw new Error("queue unavailable"); } },
      async (event) => { fallbackEvents.push(event); }
    );

    await producer.send(clickEvent);

    expect(fallbackEvents).toEqual([clickEvent]);
  });

  it("attempts every fallback event when one batch delivery fails", async () => {
    const events = [
      { type: "notify", kind: "player-rank", siteId: "s-1", siteName: "Board", playerName: "A", oldRank: 2, newRank: 1, botId: "b-1", tgUserId: 1 },
      { type: "notify", kind: "player-rank", siteId: "s-1", siteName: "Board", playerName: "B", oldRank: 3, newRank: 2, botId: "b-1", tgUserId: 2 },
      { type: "notify", kind: "player-rank", siteId: "s-1", siteName: "Board", playerName: "C", oldRank: 4, newRank: 3, botId: "b-1", tgUserId: 3 },
    ] as const;
    const fallback = mock(async (event: (typeof events)[number]) => {
      if (event.playerName === "B") throw new Error("subscriber unavailable");
    });
    const queue = {
      send: async () => {},
      sendBatch: async () => { throw new Error("queue unavailable"); },
    };

    const producer = createQueueProducer(queue, fallback);
    await expect(producer.sendBatch([...events])).rejects.toThrow("subscriber unavailable");

    expect(fallback).toHaveBeenCalledTimes(3);
    expect(fallback.mock.calls.map(([event]) => event.playerName)).toEqual(["A", "B", "C"]);
  });

  describe("top3 notify contract", () => {
    const fakeQueue = () => {
      const sent: unknown[] = [];
      return { sent, send: async (message: unknown) => { sent.push(message); } };
    };
    const noFallback = async () => { throw new Error("fallback must not run"); };

    it("carries score and rankBy through the envelope and back through parseQueueMessage", async () => {
      const changes = detectTop3Changes(
        [{ name: "A", wagered: 10, score: 5 }],
        [
          { name: "B", wagered: 20, score: 42 },
          { name: "C", wagered: 15, score: 11 },
        ],
        "score",
      );
      expect(changes[0]).toMatchObject({ name: "B", score: 42, rankBy: "score" });
      const queue = fakeQueue();
      const producer = createQueueProducer(queue, noFallback);
      await producer.send({
        type: "notify",
        kind: "top3",
        siteId: "site-1",
        siteName: "Arena",
        changes,
      });
      const parsed = parseQueueMessage(queue.sent[0]);
      expect(parsed.legacy).toBe(false);
      expect((parsed.event as { changes: unknown[] }).changes).toEqual(changes);
    });

    it("accepts rankBy wagered changes without a score key", async () => {
      const changes = detectTop3Changes(
        [],
        [{ name: "A", wagered: 99 }],
        "wagered",
      );
      expect(changes).toEqual([{ name: "A", rank: 1, wagered: 99, score: undefined, rankBy: "wagered" }]);
      const queue = fakeQueue();
      const producer = createQueueProducer(queue, noFallback);
      await producer.send({ type: "notify", kind: "top3", siteId: "site-1", siteName: "Arena", changes });
      const parsed = parseQueueMessage(queue.sent[0]);
      expect(parsed.legacy).toBe(false);
      expect((parsed.event as { changes: unknown[] }).changes).toEqual(changes);
    });
  });

  describe("producer boundary validation", () => {
    const badEvent = {
      type: "notify",
      kind: "top3",
      siteId: "site-1",
      siteName: "Arena",
      changes: [{ name: "A", rank: 1, wagered: 5, bogus: "SENTINEL_VALUE" }],
    } as unknown as QueueEvent;

    it("exports QueueEventValidationError from the package entry point", () => {
      expect(PackageQueueEventValidationError.name).toBe("QueueEventValidationError");
      expect(PackageQueueEventValidationError.prototype).toBeInstanceOf(Error);
      expect(new PackageQueueEventValidationError([]).issues).toEqual([]);
      const error = new QueueEventValidationError([{ code: "unrecognized_keys", path: ["changes", 0], keys: ["bogus"], message: "x" }]);
      expect(error.message).toContain("changes.0: unrecognized_keys");
      expect(error.issues).toHaveLength(1);
    });

    it("rejects non-canonical events before any queue send or fallback on every path", async () => {
      const sent: unknown[] = [];
      const batched: unknown[] = [];
      const fallback = mock(async () => {});
      const queueWithBatch = {
        send: async (m: unknown) => { sent.push(m); },
        sendBatch: async (ms: Iterable<{ body: unknown }>) => { for (const m of ms) batched.push(m); },
      };
      const queueNoBatch = { send: async (m: unknown) => { sent.push(m); } };

      // (a) queue present, send
      await expect(createQueueProducer(queueWithBatch, fallback).send(badEvent)).rejects.toBeInstanceOf(QueueEventValidationError);
      // (b) queue present, sendBatch
      await expect(createQueueProducer(queueWithBatch, fallback).sendBatch([badEvent])).rejects.toBeInstanceOf(QueueEventValidationError);
      // (c) no-queue fallback, send
      await expect(createQueueProducer(undefined, fallback).send(badEvent)).rejects.toBeInstanceOf(QueueEventValidationError);
      // (d) no-queue fallback, sendBatch
      await expect(createQueueProducer(undefined, fallback).sendBatch([badEvent])).rejects.toBeInstanceOf(QueueEventValidationError);
      // (e) queue.sendBatch missing → fallbackBatch path still validates first
      await expect(createQueueProducer(queueNoBatch, fallback).sendBatch([badEvent])).rejects.toBeInstanceOf(QueueEventValidationError);

      expect(sent).toEqual([]);
      expect(batched).toEqual([]);
      expect(fallback).toHaveBeenCalledTimes(0);

      let message = "";
      try {
        await createQueueProducer(queueWithBatch, fallback).send(badEvent);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).not.toContain("SENTINEL_VALUE");
    });
  });
});
