import { describe, expect, it } from "bun:test";
import { evaluateGiveawayEligibility as evaluate, giveawayRules as rules } from "../giveaway-eligibility.js";

describe("giveaway eligibility", () => {
  it("allows chat entrants and rejects duplicate accounts", () => {
    expect(evaluate({}, rules({})).status).toBe("eligible");
    expect(evaluate({ duplicateAccount: true }, rules({})).reason).toBe("duplicate_account");
  });
  it("requires a linked Viewer Account for members mode", () => {
    const r = rules({ entryMode: "members" });
    expect(evaluate({}, r).reason).toBe("not_yourrank_member");
    expect(evaluate({ viewerId: "v" }, r).reason).toBe("kick_not_linked");
    expect(evaluate({ viewerId: "v", kickLinked: true }, r).status).toBe("eligible");
  });
  it("keeps verified entries pending until identity and enabled checks pass", () => {
    const r = rules({ entryMode: "verified", onePerIp: true });
    expect(evaluate({}, r).status).toBe("pending_verification");
    const p = { verified: true, viewerId: "v", kickLinked: true, ipAvailable: true };
    expect(evaluate(p, r).status).toBe("eligible");
    expect(evaluate({ ...p, duplicateIp: true }, r).reason).toBe("duplicate_ip");
    expect(evaluate({ ...p, ipAvailable: false }, r).reason).toBe("ip_unavailable");
  });
  it("fails closed on exact badge requirements and previous winners", () => {
    expect(evaluate({ badges: [{ type: "sub_gifter" }] }, rules({ subscriberOnly: true })).reason).toBe("subscriber_required");
    expect(evaluate({ badges: [{ type: "moderator" }] }, rules({ vipOnly: true })).reason).toBe("vip_required");
    expect(evaluate({ badges: [{ type: "subscriber" }, { type: "vip" }] }, rules({ subscriberOnly: true, vipOnly: true })).status).toBe("eligible");
    expect(evaluate({ previousWinner: true }, rules({ excludePreviousWinners: true })).reason).toBe("previous_winner");
  });
  it("rejects unsupported or incompatible settings at the server boundary", () => {
    for (const r of [{ onePerIp: true }, { vpnDetection: true }, { duplicateDevice: true }, { minimumAccountAge: 1 }, { autoReroll: true }]) {
      expect(() => rules(r)).toThrow();
    }
  });
});
