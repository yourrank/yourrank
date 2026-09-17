import { describe, expect, it } from "bun:test";
import { reviewRewardReadiness } from "../reward-readiness.js";

const siblings = [
  { id: "a", name: "VIP role", description: "One month of VIP in chat. Granted within 24h." },
  { id: "b", name: "Steam key", description: "A random Steam key sent by DM." },
];

describe("reviewRewardReadiness", () => {
  it("passes a complete reward with a reachable creator", () => {
    const review = reviewRewardReadiness(
      { id: "a", name: "VIP role", description: siblings[0].description },
      { siblings, contactReady: true },
    );
    expect(review).toEqual({ ready: true, findings: [] });
  });

  it("flags a blank description and says the public page only shows the generic fulfilment note", () => {
    const review = reviewRewardReadiness({ description: "   " }, { siblings, contactReady: true });
    expect(review.ready).toBe(false);
    expect(review.findings.map((f) => f.code)).toEqual(["description_missing"]);
    expect(review.findings[0].field).toBe("description");
    expect(review.findings[0].message).toMatch(/how and when you deliver/);
  });

  it("flags a description copied from another reward, ignoring case and whitespace, and names it", () => {
    const review = reviewRewardReadiness(
      { id: "new", description: "  a RANDOM steam key   sent by dm. " },
      { siblings, contactReady: true },
    );
    expect(review.findings.map((f) => f.code)).toEqual(["description_duplicate"]);
    expect(review.findings[0].message).toContain("Steam key");
  });

  it("does not compare a reward with its own stored copy when editing", () => {
    const review = reviewRewardReadiness(
      { id: "b", description: siblings[1].description },
      { siblings, contactReady: true },
    );
    expect(review.ready).toBe(true);
  });

  it("flags an absent creator contact channel as its own finding", () => {
    const review = reviewRewardReadiness(
      { id: "a", description: siblings[0].description },
      { siblings, contactReady: false },
    );
    expect(review.findings.map((f) => f.code)).toEqual(["contact_missing"]);
    expect(review.findings[0].field).toBe("contact");
  });

  it("never judges the reward name", () => {
    const review = reviewRewardReadiness(
      { name: "xqzt vvrpl 9!!", description: "Something real." },
      { siblings: [], contactReady: true },
    );
    expect(review.ready).toBe(true);
  });
});
