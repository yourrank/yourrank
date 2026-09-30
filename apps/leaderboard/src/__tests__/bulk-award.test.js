import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { bulkAwardSummary, isRateLimitError, remainingSelection, runBulkAward } from "../assets/bulk-award.js";

const ids = ["A", "B", "C", "D", "E"];
const rateLimit = () => Object.assign(new Error("Too many"), { code: "RATE_LIMITED", status: 429 });
const audiencePage = readFileSync(new URL("../react/pages/audience/page.tsx", import.meta.url), "utf8");

function awarder(failures = {}) {
  const calls = [];
  const award = async (id) => {
    calls.push(id);
    if (failures[id]) throw failures[id];
  };
  return { award, calls };
}

describe("runBulkAward partial-failure contract", () => {
  it("awards every recipient sequentially on complete success", async () => {
    const { award, calls } = awarder();
    const outcome = await runBulkAward(ids, award);
    expect(calls).toEqual(ids);
    expect(outcome).toMatchObject({ total: 5, attempted: 5, succeeded: ids, failed: [], unattempted: [], rateLimited: false });
    expect(remainingSelection(outcome)).toEqual([]);
    expect(bulkAwardSummary(outcome, 10)).toBe("Awarded 10 credits to 5 members.");
  });

  it("keeps going after a normal recipient failure and reports it as failed", async () => {
    const boom = new Error("insufficient permissions");
    const { award, calls } = awarder({ C: boom });
    const outcome = await runBulkAward(ids, award);
    expect(calls).toEqual(ids);
    expect(outcome.succeeded).toEqual(["A", "B", "D", "E"]);
    expect(outcome.failed).toEqual(["C"]);
    expect(outcome.unattempted).toEqual([]);
    expect(outcome.attempted).toBe(5);
    expect(outcome.errors.get("C")).toBe(boom);
    expect(outcome.rateLimited).toBe(false);
    expect(remainingSelection(outcome)).toEqual(["C"]);
    expect(bulkAwardSummary(outcome, 10)).toContain("Attempted 5 of 5 · succeeded 4 · failed 1 · not attempted 0. An error occurred");
    expect(bulkAwardSummary(outcome, 10)).toContain("1 member still needing credits stay selected");
  });

  it("stops at a rate limit mid-batch and leaves the rest unattempted", async () => {
    const { award, calls } = awarder({ C: rateLimit() });
    const outcome = await runBulkAward(ids, award);
    expect(calls).toEqual(["A", "B", "C"]);
    expect(outcome).toMatchObject({
      total: 5, attempted: 3,
      succeeded: ["A", "B"], failed: ["C"], unattempted: ["D", "E"], rateLimited: true,
    });
    expect(remainingSelection(outcome)).toEqual(["C", "D", "E"]);
    const summary = bulkAwardSummary(outcome, 5);
    expect(summary).toContain("Attempted 3 of 5 · succeeded 2 · failed 1 · not attempted 2. Rate limit reached");
    expect(summary).toContain("3 members still needing credits stay selected; apply again to retry");
  });

  it("recognises rate limits by code or HTTP status only", () => {
    expect(isRateLimitError({ code: "RATE_LIMITED" })).toBe(true);
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ status: 500 })).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });

  it("retry re-attempts exactly the remaining selection without touching succeeded recipients", async () => {
    const first = await runBulkAward(ids, awarder({ C: rateLimit() }).award);
    const retry = awarder();
    const outcome = await runBulkAward(remainingSelection(first), retry.award);
    expect(retry.calls).toEqual(["C", "D", "E"]);
    expect(outcome.succeeded).toEqual(["C", "D", "E"]);
    expect(remainingSelection(outcome)).toEqual([]);
  });

  it("handles an empty batch", async () => {
    const outcome = await runBulkAward([], async () => { throw new Error("never"); });
    expect(outcome).toMatchObject({ total: 0, attempted: 0, succeeded: [], failed: [], unattempted: [] });
  });
});

describe("bulk award wiring in the Audience React page", () => {
  it("reuses the persisted operation key per (site, member, delta, reason) and never mints one for a blind retry", () => {
    expect(audiencePage).toContain('"yr:credit-adjustment:" + JSON.stringify([activeSiteId, id, delta, reason])');
    expect(audiencePage).toMatch(/let operationId = storage\.getItem\(storageKey\);\s*if \(!operationId\) \{\s*operationId = deps\.randomUUID\(\);\s*storage\.setItem\(storageKey, operationId\);/);
    expect(audiencePage).toContain("storage.removeItem(storageKey);");
  });

  it("feeds the bulk outcome back into the selection so failed and unattempted members stay selected", () => {
    expect(audiencePage).toMatch(/runBulkAward\(ids, \(id(?:: string)?\) => adjustMemberCredits\([\s\S]*?amount,[\s\S]*?reason/);
    expect(audiencePage).toContain("selection.retain(remainingSelection(outcome))");
    expect(audiencePage).toContain("bulkAwardSummary(outcome, amount)");
  });

  it("enforces the 25-member apply cap in the UI and before calling the helper", () => {
    expect(audiencePage).toContain("const BULK_AWARD_MAX = 25;");
    expect(audiencePage).toContain("if (ids.length > BULK_AWARD_MAX)");
    expect(audiencePage).toContain("disabled={!selection.size || selection.size > BULK_AWARD_MAX}");
  });
});
