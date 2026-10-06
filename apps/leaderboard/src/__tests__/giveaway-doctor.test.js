// The giveaway doctor's whole value is that it names the first closed gate
// correctly. These tests pin the ordering and the wording, because a doctor
// that reports the wrong cause is worse than no doctor: it sends the operator
// to the wrong console.
import { describe, expect, test } from "bun:test";
import {
  buildGiveawayDoctorReport,
  keywordVerdict,
  stampAgeMs,
  SUBSCRIPTION_STALE_AFTER_MS,
} from "../giveaway-doctor.js";

const NOW = Date.parse("2026-10-06T18:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();

const connected = { connected: true, chatReady: true, channelName: "streamer", externalChannelId: "chan-1" };
const freshDelivery = { rewardEventsSubscribedAt: hoursAgo(1), chatEventsSubscribedAt: hoursAgo(1), checkedAt: hoursAgo(1) };
const activeSession = { id: "s1", status: "active", keyword: "!win" };

const report = (overrides = {}) => buildGiveawayDoctorReport({
  connection: connected,
  delivery: freshDelivery,
  session: activeSession,
  now: NOW,
  ...overrides,
});

describe("keywordVerdict", () => {
  test("accepts a single-token keyword", () => {
    expect(keywordVerdict("!win")).toEqual({ ok: true, normalized: "!win", reason: null });
  });

  test("lowercases and trims like the matcher does", () => {
    expect(keywordVerdict("  !WIN  ").normalized).toBe("!win");
  });

  test("rejects a keyword with a space, which can never match", () => {
    const verdict = keywordVerdict("!win now");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/space/);
  });

  test("rejects an empty keyword", () => {
    expect(keywordVerdict("").ok).toBe(false);
    expect(keywordVerdict(null).ok).toBe(false);
  });
});

describe("stampAgeMs", () => {
  test("returns null for missing or unparseable stamps", () => {
    expect(stampAgeMs(null, NOW)).toBeNull();
    expect(stampAgeMs("not-a-date", NOW)).toBeNull();
  });

  test("returns the age in ms", () => {
    expect(stampAgeMs(hoursAgo(2), NOW)).toBe(2 * 3600000);
  });
});

describe("buildGiveawayDoctorReport", () => {
  test("healthy when every ingest gate is open", () => {
    const result = report();
    expect(result.healthy).toBe(true);
    expect(result.firstFailure).toBeNull();
    expect(result.action).toBeNull();
    expect(result.checks.every((c) => c.ok)).toBe(true);
  });

  test("healthy verdict still never claims an entry was created", () => {
    expect(report().verdict).toMatch(/would insert an entry/);
  });

  test("a channel with no observed chat webhook is the first failure", () => {
    const result = report({ delivery: { ...freshDelivery, chatEventsSubscribedAt: null } });
    expect(result.healthy).toBe(false);
    expect(result.firstFailure).toBe("delivery_stamped");
    expect(result.action).toMatch(/kick\.com\/settings\/developer/);
  });

  test("a stale delivery stamp fails the same check", () => {
    const stale = new Date(NOW - SUBSCRIPTION_STALE_AFTER_MS - 1000).toISOString();
    const result = report({ delivery: { ...freshDelivery, chatEventsSubscribedAt: stale } });
    expect(result.firstFailure).toBe("delivery_stamped");
  });

  test("a stamp exactly at the staleness boundary still passes", () => {
    const boundary = new Date(NOW - SUBSCRIPTION_STALE_AFTER_MS).toISOString();
    const result = report({ delivery: { ...freshDelivery, chatEventsSubscribedAt: boundary } });
    expect(result.checks.find((c) => c.name === "delivery_stamped").ok).toBe(true);
  });

  test("a disconnected channel is the first failure", () => {
    const result = report({ connection: { connected: false } });
    expect(result.firstFailure).toBe("channel_connected");
    expect(result.action).toMatch(/Settings/);
  });

  test("no active session points the operator at starting a fresh giveaway", () => {
    const result = report({ session: null });
    expect(result.firstFailure).toBe("session_active");
    expect(result.action).toMatch(/no path to self-heal/);
  });

  test("a stopped session does not count as active", () => {
    const result = report({ session: { id: "s1", status: "stopped", keyword: "!win" } });
    expect(result.firstFailure).toBe("session_active");
  });

  test("a spaced keyword is reported before anything downstream", () => {
    const result = report({ session: { id: "s1", status: "active", keyword: "!win now" } });
    expect(result.firstFailure).toBe("keyword_valid");
  });

  test("an unreachable webhook endpoint is reported last, after the data gates", () => {
    const result = report({ endpointStatus: "unreachable" });
    expect(result.firstFailure).toBe("webhook_endpoint");
  });

  test("the endpoint check is omitted when it was never probed", () => {
    const names = report().checks.map((c) => c.name);
    expect(names).not.toContain("webhook_endpoint");
  });

  test("failing checks always carry an operator action", () => {
    const cases = [
      { connection: { connected: false } },
      { delivery: { ...freshDelivery, chatEventsSubscribedAt: null } },
      { session: null },
      { session: { id: "s1", status: "active", keyword: "two words" } },
      { endpointStatus: "unreachable" },
    ];
    for (const overrides of cases) {
      const result = report(overrides);
      expect(result.healthy).toBe(false);
      expect(result.action).toBeTruthy();
    }
  });

  test("reports the first failure in ingest order, not the loudest one", () => {
    const result = report({
      connection: { connected: false },
      delivery: { ...freshDelivery, chatEventsSubscribedAt: null },
      session: null,
      endpointStatus: "unreachable",
    });
    expect(result.firstFailure).toBe("channel_connected");
  });
});
