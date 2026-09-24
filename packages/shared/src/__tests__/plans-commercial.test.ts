import { describe, expect, it } from "bun:test";
import {
  PLAN_LIMITS,
  getPlanLimit,
  FEATURE_MIN_TIER,
  PLAN_FEATURES,
  canUseFeature,
  requiredPlanFor,
  FEATURE_LABELS,
  LIMIT_LABELS,
  PLAN_TIERS,
  type PlanFeature,
  type PlanLimitKey,
} from "../plans.js";
import {
  featureDenial,
  limitDenial,
  assertFeature,
  checkLimit,
  checkTotalWithinLimit,
} from "../entitlements.js";
import { classifyTelegramUpdate } from "../telegram-interactions.js";

describe("PLAN_LIMITS table", () => {
  it("has every limit key for every tier", () => {
    const keys: PlanLimitKey[] = [
      "sites", "players_per_site", "active_viewers_30d", "history_days",
      "reward_mappings", "shop_items", "telegram_bots", "telegram_offers",
      "telegram_interactions_per_month", "broadcast_deliveries_per_month", "operator_seats",
    ];
    for (const tier of PLAN_TIERS) {
      for (const key of keys) {
        expect(typeof PLAN_LIMITS[tier][key]).toBe("number");
      }
    }
  });

  it("approved commercial values", () => {
    expect(getPlanLimit("free", "players_per_site")).toBe(10);
    expect(getPlanLimit("pro", "players_per_site")).toBe(1_000);
    expect(getPlanLimit("team", "players_per_site")).toBe(5_000);
    expect(getPlanLimit("free", "active_viewers_30d")).toBe(50);
    expect(getPlanLimit("pro", "active_viewers_30d")).toBe(2_500);
    expect(getPlanLimit("team", "active_viewers_30d")).toBe(25_000);
    expect(getPlanLimit("free", "sites")).toBe(1);
    expect(getPlanLimit("pro", "sites")).toBe(3);
    expect(getPlanLimit("team", "sites")).toBe(10);
    expect(getPlanLimit("team", "telegram_bots")).toBe(10);
    expect(getPlanLimit("team", "telegram_offers")).toBe(100);
    expect(getPlanLimit("free", "broadcast_deliveries_per_month")).toBe(0);
    expect(getPlanLimit("pro", "broadcast_deliveries_per_month")).toBe(10_000);
    expect(getPlanLimit("free", "telegram_interactions_per_month")).toBe(1_000);
    expect(getPlanLimit("team", "operator_seats")).toBe(5);
  });

  it("limits are monotonic across tiers", () => {
    for (const key of Object.keys(PLAN_LIMITS.free) as PlanLimitKey[]) {
      expect(PLAN_LIMITS.pro[key]).toBeGreaterThanOrEqual(PLAN_LIMITS.free[key]);
      expect(PLAN_LIMITS.team[key]).toBeGreaterThanOrEqual(PLAN_LIMITS.pro[key]);
    }
  });
});

describe("features", () => {
  it("every feature has a minimum tier and labels", () => {
    for (const feature of Object.keys(FEATURE_MIN_TIER) as PlanFeature[]) {
      expect(PLAN_TIERS).toContain(FEATURE_MIN_TIER[feature]);
      expect(FEATURE_LABELS[feature].name.length).toBeGreaterThan(0);
      expect(FEATURE_LABELS[feature].description.length).toBeGreaterThan(0);
    }
    for (const key of Object.keys(PLAN_LIMITS.free) as PlanLimitKey[]) {
      expect(LIMIT_LABELS[key].length).toBeGreaterThan(0);
    }
  });

  it("canUseFeature honours the tier ladder", () => {
    expect(canUseFeature("free", "custom_domain")).toBe(false);
    expect(canUseFeature("pro", "custom_domain")).toBe(true);
    expect(canUseFeature("team", "custom_domain")).toBe(true);
    expect(canUseFeature("pro", "team_collaboration")).toBe(false);
    expect(canUseFeature("team", "team_collaboration")).toBe(true);
  });

  it("PLAN_FEATURES derives from FEATURE_MIN_TIER", () => {
    expect(PLAN_FEATURES.free).toEqual([]);
    expect(PLAN_FEATURES.pro).toContain("custom_domain");
    expect(PLAN_FEATURES.pro).not.toContain("team_collaboration");
    expect(PLAN_FEATURES.team).toContain("team_collaboration");
    expect(PLAN_FEATURES.team.length).toBe(Object.keys(FEATURE_MIN_TIER).length);
  });

  it("requiredPlanFor returns the minimum tier", () => {
    expect(requiredPlanFor("signed_api")).toBe("pro");
    expect(requiredPlanFor("team_collaboration")).toBe("team");
  });
});

describe("entitlements", () => {
  it("featureDenial shape", () => {
    const d = featureDenial("free", "custom_domain");
    expect(d.code).toBe("entitlement_required");
    expect(d.feature).toBe("custom_domain");
    expect(d.current_plan).toBe("free");
    expect(d.required_plan).toBe("pro");
    expect(d.error).toContain("Pro");
  });

  it("limitDenial picks the next tier whose allowance exceeds usage", () => {
    const d = limitDenial("free", "players_per_site", 10);
    expect(d.code).toBe("plan_limit_reached");
    expect(d.limit).toBe("players_per_site");
    expect(d.usage).toBe(10);
    expect(d.allowance).toBe(10);
    expect(d.required_plan).toBe("pro");
    expect(d.error).toContain("1,000");
  });

  it("limitDenial at the top tier has required_plan null", () => {
    const d = limitDenial("team", "sites", 10);
    expect(d.required_plan).toBeNull();
  });

  it("assertFeature returns null when entitled", () => {
    expect(assertFeature("pro", "signed_api")).toBeNull();
    expect(assertFeature("free", "signed_api")?.code).toBe("entitlement_required");
  });

  it("checkLimit denies at exactly the allowance", () => {
    expect(checkLimit("free", "sites", 0)).toBeNull();
    expect(checkLimit("free", "sites", 1)?.code).toBe("plan_limit_reached");
  });

  it("checkTotalWithinLimit allows the resulting total at the allowance and denies above it", () => {
    // checkLimit is the pre-create "can I add one more" check; at usage 1 on
    // Free sites (allowance 1) it already denies. checkTotalWithinLimit is
    // the resulting-total check: 1 site is allowed, 2 is denied.
    expect(checkTotalWithinLimit("free", "sites", 1)).toBeNull();
    expect(checkTotalWithinLimit("free", "sites", 2)?.code).toBe("plan_limit_reached");
    expect(checkTotalWithinLimit("free", "players_per_site", 10)).toBeNull();
    expect(checkTotalWithinLimit("free", "players_per_site", 11)?.allowance).toBe(10);
    expect(checkTotalWithinLimit("pro", "players_per_site", 1000)).toBeNull();
    expect(checkTotalWithinLimit("pro", "players_per_site", 1001)?.required_plan).toBe("team");
  });
});

describe("classifyTelegramUpdate", () => {
  it("bot_command at offset 0 is billable", () => {
    expect(classifyTelegramUpdate({
      message: { text: "/start", entities: [{ type: "bot_command", offset: 0 }], chat: { type: "private" } },
    })).toBe("billable");
  });

  it("!rank in a group is billable, in private ignored", () => {
    expect(classifyTelegramUpdate({ message: { text: "!rank", chat: { type: "group" } } })).toBe("billable");
    expect(classifyTelegramUpdate({ message: { text: "!board top", chat: { type: "supergroup" } } })).toBe("billable");
    expect(classifyTelegramUpdate({ message: { text: "!rank", chat: { type: "private" } } })).toBe("ignored");
  });

  it("callback_query with data is billable; without data ignored", () => {
    expect(classifyTelegramUpdate({ callback_query: { data: "vote:yes" } })).toBe("billable");
    expect(classifyTelegramUpdate({ callback_query: {} })).toBe("ignored");
  });

  it("plain text, joins and other updates are ignored", () => {
    expect(classifyTelegramUpdate({ message: { text: "hello", chat: { type: "private" } } })).toBe("ignored");
    expect(classifyTelegramUpdate({ message: { text: "say !rank", chat: { type: "group" } } })).toBe("ignored");
    expect(classifyTelegramUpdate({})).toBe("ignored");
  });
});
