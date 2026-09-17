import { describe, expect, it } from "bun:test";
import { guestGateHref, parseViewerIntent, viewerIntentReturnTo } from "../viewer-intent.js";

const hrefs = { homeHref: "/creator", meHref: "/creator/me", shopHref: "/creator/shop" };

describe("viewer auth intent", () => {
  it("accepts only known intents and well-formed reward ids", () => {
    expect(parseViewerIntent(new URL("https://x.test/creator/me"))).toEqual({ intent: "signin", rewardId: "" });
    expect(parseViewerIntent(new URL("https://x.test/creator/me?intent=join"))).toEqual({ intent: "join", rewardId: "" });
    expect(parseViewerIntent(new URL("https://x.test/creator/me?intent=activity&reward=9"))).toEqual({ intent: "activity", rewardId: "" });
    expect(parseViewerIntent(new URL("https://x.test/creator/me?intent=reward&reward=abc_1-2"))).toEqual({ intent: "reward", rewardId: "abc_1-2" });
    expect(parseViewerIntent(new URL("https://x.test/creator/me?intent=reward"))).toEqual({ intent: "signin", rewardId: "" });
    expect(parseViewerIntent(new URL("https://x.test/creator/me?intent=reward&reward=%3Cscript%3E"))).toEqual({ intent: "signin", rewardId: "" });
    expect(parseViewerIntent(new URL("https://x.test/creator/me?intent=claim"))).toEqual({ intent: "signin", rewardId: "" });
    expect(parseViewerIntent(new URL("https://x.test/creator/me?intent=//evil.test"))).toEqual({ intent: "signin", rewardId: "" });
  });

  it("returns to the requested screen, never to an external or action URL", () => {
    expect(viewerIntentReturnTo({ intent: "signin", rewardId: "" }, hrefs)).toBe("/creator");
    expect(viewerIntentReturnTo({ intent: "join", rewardId: "" }, hrefs)).toBe("/creator/me");
    expect(viewerIntentReturnTo({ intent: "activity", rewardId: "" }, hrefs)).toBe("/creator/me");
    expect(viewerIntentReturnTo({ intent: "reward", rewardId: "7" }, hrefs)).toBe("/creator/shop/7");
  });

  it("builds gate links from the community's own /me page", () => {
    expect(guestGateHref("/creator/me", "signin")).toBe("/creator/me");
    expect(guestGateHref("/me", "join")).toBe("/me?intent=join");
    expect(guestGateHref("/creator/me", "reward", "7")).toBe("/creator/me?intent=reward&reward=7");
    expect(guestGateHref("/creator/me", "reward", "bad id")).toBe("/creator/me?intent=reward");
  });
});
