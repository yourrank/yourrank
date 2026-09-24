// ------------------------------------------------------------------
// Canonical entitlement-denial contract shared by both Workers.
// HTTP transport: always 403. Body is the denial object plus ok:false.
// ------------------------------------------------------------------

import {
  FEATURE_LABELS,
  FEATURE_MIN_TIER,
  getPlanLimit,
  LIMIT_LABELS,
  PLAN_LIMITS,
  PLAN_TIERS,
  tierIndex,
  canUseFeature,
  type PlanFeature,
  type PlanLimitKey,
  type PlanTier,
} from "./plans.js";

export type EntitlementDenial =
  | {
      code: "entitlement_required";
      feature: PlanFeature;
      current_plan: PlanTier;
      required_plan: PlanTier;
      error: string;
    }
  | {
      code: "plan_limit_reached";
      limit: PlanLimitKey;
      current_plan: PlanTier;
      usage: number;
      allowance: number;
      required_plan: PlanTier | null;
      error: string;
    };

function planName(plan: PlanTier): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/** Lowest tier whose allowance for `limit` exceeds `usage`, or null when none does. */
function nextTierFor(limit: PlanLimitKey, usage: number): PlanTier | null {
  for (const tier of PLAN_TIERS) {
    if (PLAN_LIMITS[tier][limit] > usage) return tier;
  }
  return null;
}

export function featureDenial(plan: PlanTier, feature: PlanFeature): EntitlementDenial {
  const required = FEATURE_MIN_TIER[feature];
  const tiers = PLAN_TIERS.slice(tierIndex(required)).map(planName).join(" and ");
  return {
    code: "entitlement_required",
    feature,
    current_plan: plan,
    required_plan: required,
    error: `${FEATURE_LABELS[feature].name} is available on ${tiers}.`,
  };
}

export function limitDenial(plan: PlanTier, limit: PlanLimitKey, usage: number): EntitlementDenial {
  const allowance = getPlanLimit(plan, limit);
  const required = nextTierFor(limit, usage);
  const label = LIMIT_LABELS[limit];
  const upgrade = required ? ` Upgrade to ${planName(required)} for ${PLAN_LIMITS[required][limit].toLocaleString("en-US")}.` : "";
  return {
    code: "plan_limit_reached",
    limit,
    current_plan: plan,
    usage,
    allowance,
    required_plan: required,
    error: `Your ${planName(plan)} plan includes ${allowance.toLocaleString("en-US")} ${label.toLowerCase()}.${upgrade}`,
  };
}

export function assertFeature(plan: PlanTier, feature: PlanFeature): EntitlementDenial | null {
  return canUseFeature(plan, feature) ? null : featureDenial(plan, feature);
}

/**
 * "Can I add one more?" — pass the PRE-CREATE count: denied once the
 * current usage already reaches the allowance. For checks against a
 * resulting total (e.g. a roster being replaced wholesale), use
 * checkTotalWithinLimit instead.
 */
export function checkLimit(plan: PlanTier, limit: PlanLimitKey, usage: number): EntitlementDenial | null {
  return usage >= getPlanLimit(plan, limit) ? limitDenial(plan, limit, usage) : null;
}

/**
 * "Is this resulting total allowed?" — pass the FINAL count the
 * operation would leave behind: denied only when it exceeds the
 * allowance, so exactly-allowance totals are permitted.
 */
export function checkTotalWithinLimit(plan: PlanTier, limit: PlanLimitKey, total: number): EntitlementDenial | null {
  return total > getPlanLimit(plan, limit) ? limitDenial(plan, limit, total) : null;
}
