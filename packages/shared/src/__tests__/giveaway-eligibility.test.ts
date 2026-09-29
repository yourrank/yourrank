import { describe, expect, it } from "bun:test";
import { evaluateGiveawayEligibility as evaluate, giveawayRules as rules, giveawayRulesSchema } from "../giveaway-eligibility.js";

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
  it("enforces the VPN/proxy check only for verified entries", () => {
    const r = rules({ entryMode: "verified", vpnDetection: true });
    const p = { verified: true, viewerId: "v", kickLinked: true };
    expect(evaluate({ ...p, vpnCheckAvailable: false }, r).reason).toBe("vpn_check_unavailable");
    expect(evaluate({ ...p, vpnCheckAvailable: true, anonymousNetwork: true }, r).reason).toBe("vpn_detected");
    expect(evaluate({ ...p, vpnCheckAvailable: true, anonymousNetwork: false }, r).status).toBe("eligible");
  });
  it("rejects restricted linked accounts right after the duplicate-account check", () => {
    expect(evaluate({ linkedRestricted: true }, rules({})).reason).toBe("linked_account_restricted");
    expect(evaluate({ duplicateAccount: true, linkedRestricted: true }, rules({})).reason).toBe("duplicate_account");
    // Chat-mode entries are covered too (the check runs before entry-mode gates).
    expect(evaluate({ linkedRestricted: true }, rules({ entryMode: "chat" })).reason).toBe("linked_account_restricted");
    expect(evaluate({ linkedRestricted: true, verified: true, viewerId: "v", kickLinked: true }, rules({ entryMode: "verified" })).reason).toBe("linked_account_restricted");
  });
  it("rejects unsupported or incompatible settings at the server boundary", () => {
    for (const r of [{ onePerIp: true }, { vpnDetection: true }, { duplicateDevice: true }, { minimumAccountAge: 1 }, { autoReroll: true }]) {
      expect(() => rules(r)).toThrow();
    }
    expect(rules({ entryMode: "verified", vpnDetection: true }).vpnDetection).toBe(true);
    expect(rules({}).winnerRepeat).toBe("once");
    expect(rules({ winnerRepeat: "again" }).winnerRepeat).toBe("again");
    expect(giveawayRulesSchema.safeParse({ winnerRepeat: "sometimes" }).success).toBe(false);
  });
});
