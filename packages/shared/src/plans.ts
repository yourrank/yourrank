// ------------------------------------------------------------------
// Canonical plan, pricing, entitlement, and usage-threshold ownership.
// Both Workers and the marketing app consume this module.
// ------------------------------------------------------------------

export type PlanTier = "free" | "pro" | "team";
export type BillingInterval = "monthly" | "annual";

export const PLAN_TIERS: readonly PlanTier[] = ["free", "pro", "team"];

export function isPlanTier(value: unknown): value is PlanTier {
  return typeof value === "string" && PLAN_TIERS.includes(value as PlanTier);
}

/** Max leaderboard players per site. */
export const PLAN_LIMITS: Record<PlanTier, number> = {
  free: 100,
  pro: 1_000,
  team: 5_000,
};

/** Max creator-owned sites per account. */
export const BOARD_LIMITS: Record<PlanTier, number> = {
  free: 1,
  pro: 3,
  team: 10,
};

/** Distinct authenticated active viewers across all account-owned sites, rolling 30 days. */
export const ACTIVE_VIEWER_LIMITS: Record<PlanTier, number> = {
  free: 200,
  pro: 2_500,
  team: 10_000,
};

/** Compatibility export; this is account-pooled active-viewer usage, never per-site signups. */
export const CREDITS_VIEWERS_PER_30D_LIMITS = ACTIVE_VIEWER_LIMITS;

/** Accessible history window. Data is retained when an account downgrades. */
export const HISTORY_DAYS: Record<PlanTier, number> = {
  free: 30,
  pro: 365,
  team: 730,
};

export const CREDITS_REWARD_LIMITS: Record<PlanTier, number> = {
  free: 3,
  pro: 50,
  team: 250,
};

export const CREDITS_SHOP_LIMITS: Record<PlanTier, number> = {
  free: 5,
  pro: 100,
  team: 500,
};

/** Existing operational safeguards, scaled with the commercial tiers. */
export const CREDITS_PENDING_REDEMPTIONS_LIMITS: Record<PlanTier, number> = {
  free: 20,
  pro: 500,
  team: 2_500,
};

export const CREDITS_REDEMPTIONS_PER_30D_LIMITS: Record<PlanTier, number> = {
  free: 50,
  pro: 2_000,
  team: 10_000,
};

/** Total operator seats, including the owning creator. */
export const OPERATOR_SEAT_LIMITS: Record<PlanTier, number> = {
  free: 1,
  pro: 1,
  team: 5,
};

export const ACTIVE_VIEWER_WINDOW_DAYS = 30;
export const ACTIVE_VIEWER_GRACE_DAYS = 14;

export const PLAN_PRICING: Record<PlanTier, {
  monthlyUsd: number;
  annualUsd: number;
  effectiveAnnualMonthlyUsd: number;
}> = {
  free: { monthlyUsd: 0, annualUsd: 0, effectiveAnnualMonthlyUsd: 0 },
  pro: { monthlyUsd: 24, annualUsd: 240, effectiveAnnualMonthlyUsd: 20 },
  team: { monthlyUsd: 69, annualUsd: 690, effectiveAnnualMonthlyUsd: 57.5 },
};

/** Monthly prices retained as a derived compatibility view for existing consumers. */
export const PLAN_PRICES: Record<PlanTier, number> = {
  free: PLAN_PRICING.free.monthlyUsd,
  pro: PLAN_PRICING.pro.monthlyUsd,
  team: PLAN_PRICING.team.monthlyUsd,
};

export const PLAN_META: Record<PlanTier, {
  name: string;
  positioning: string;
  highlight: boolean;
  features: string[];
  cta: string;
}> = {
  free: {
    name: "Free",
    positioning: "Launch your community",
    highlight: false,
    features: [
      "200 active viewers",
      "1 site and 100 leaderboard players",
      "Basic Rewards and Insights",
      "Standard customization",
      "30 days of accessible history",
    ],
    cta: "Start free",
  },
  pro: {
    name: "Pro",
    positioning: "Run a growing community",
    highlight: true,
    features: [
      "2,500 active viewers",
      "3 sites and 1,000 players per site",
      "Custom domain and stronger branding",
      "Higher Rewards and integration limits",
      "12 months of accessible history",
    ],
    cta: "Start Pro",
  },
  team: {
    name: "Team",
    positioning: "Operate together",
    highlight: false,
    features: [
      "10,000 active viewers",
      "10 sites and 5,000 players per site",
      "5 operator seats",
      "Roles and permissions",
      "24 months of accessible history",
    ],
    cta: "Start Team",
  },
};

export interface BotPlanDef {
  tier: PlanTier;
  label: string;
  maxBots: number;
  maxOffers: number;
  broadcasts: boolean;
  postbacks: boolean;
  priceUsd: number;
}

export type BotPlanTier = PlanTier;

export const BOT_PLANS: Record<BotPlanTier, BotPlanDef> = {
  free: { tier: "free", label: "Free", maxBots: 1, maxOffers: 3, broadcasts: false, postbacks: false, priceUsd: PLAN_PRICES.free },
  pro: { tier: "pro", label: "Pro", maxBots: 3, maxOffers: 50, broadcasts: true, postbacks: true, priceUsd: PLAN_PRICES.pro },
  team: { tier: "team", label: "Team", maxBots: 10, maxOffers: 250, broadcasts: true, postbacks: true, priceUsd: PLAN_PRICES.team },
};

/**
 * Canonical server price. The first object argument is accepted for existing
 * call sites but deliberately ignored: deployment configuration cannot alter
 * customer-facing prices.
 */
export function priceUsd(
  envOrPlan: Record<string, string | undefined> | PlanTier = "pro",
  requestedPlan?: string,
  interval: BillingInterval = "monthly",
): number {
  const plan = typeof envOrPlan === "string" ? envOrPlan : requestedPlan || "pro";
  if (!isPlanTier(plan)) return PLAN_PRICING.pro.monthlyUsd;
  return interval === "annual" ? PLAN_PRICING[plan].annualUsd : PLAN_PRICING[plan].monthlyUsd;
}

export function tierIndex(tier: PlanTier | string): number {
  return PLAN_TIERS.indexOf(tier as PlanTier);
}

const MS_PER_DAY = 86_400_000;

/** Fixed-duration helper retained for authorized trials and referral credits. */
export function computeProratedExpiry(args: {
  nowMs: number;
  currentPlan: PlanTier | string;
  currentExpiryMs?: number | string | null;
  targetPlan: PlanTier;
  periodDays: number;
  prices: Record<string, number>;
  maxExtensionDays: number;
}): number {
  const { nowMs, currentPlan, currentExpiryMs, targetPlan, periodDays, prices, maxExtensionDays } = args;
  const targetPrice = Number(prices[targetPlan]) || 0;
  const targetDaily = targetPrice / periodDays;
  const currentPlanStr = String(currentPlan || "free").toLowerCase();
  const currentIsPaid = currentPlanStr === "pro" || currentPlanStr === "team";

  let baseMs = nowMs;
  let creditMs = 0;
  const parsedCurrentExpiry = typeof currentExpiryMs === "string"
    ? Date.parse(currentExpiryMs)
    : Number(currentExpiryMs);

  if (currentIsPaid && Number.isFinite(parsedCurrentExpiry) && parsedCurrentExpiry > nowMs) {
    const currentIndex = tierIndex(currentPlanStr);
    const targetIndex = tierIndex(targetPlan);
    const remainingMs = parsedCurrentExpiry - nowMs;

    if (targetIndex > currentIndex) {
      const currentPrice = Number(prices[currentPlanStr]) || 0;
      const currentDaily = currentPrice / periodDays;
      if (currentDaily > 0 && targetDaily > 0) {
        const creditDays = (remainingMs / MS_PER_DAY) * (currentDaily / targetDaily);
        creditMs = Math.round(creditDays * MS_PER_DAY);
      }
    } else {
      baseMs = parsedCurrentExpiry;
    }
  }

  const maxMs = nowMs + maxExtensionDays * MS_PER_DAY;
  if (targetDaily <= 0) return Math.min(Math.max(baseMs, nowMs), maxMs);
  return Math.min(baseMs + periodDays * MS_PER_DAY + creditMs, maxMs);
}

export interface PlanUser {
  plan?: string | null;
  status?: string | null;
  plan_expires_at?: number | string | Date | null;
}

/** Paid grants require a non-null, future expiry. Free never requires one. */
export function effectivePlan(user: PlanUser | null | undefined, nowMs = Date.now()): PlanTier {
  if (!user || user.status === "suspended") return "free";
  const plan = String(user.plan || "free").toLowerCase();
  if (plan === "free") return "free";
  if (!isPlanTier(plan)) return "free";
  if (user.plan_expires_at == null) return "free";
  const expiresAt = user.plan_expires_at instanceof Date
    ? user.plan_expires_at.getTime()
    : typeof user.plan_expires_at === "string"
      ? Date.parse(user.plan_expires_at)
      : Number(user.plan_expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return "free";
  return plan;
}

export type ActiveViewerUsageLevel = "normal" | "informational" | "notice" | "warning" | "at_limit" | "grace" | "restricted";

export function activeViewerUsageState(args: {
  plan: PlanTier;
  activeViewers: number;
  graceStartedAt?: number | string | Date | null;
  nowMs?: number;
}): {
  allowance: number;
  percentage: number;
  level: ActiveViewerUsageLevel;
  overLimit: boolean;
  graceEndsAt: string | null;
  expansionRestricted: boolean;
} {
  const nowMs = args.nowMs ?? Date.now();
  const allowance = ACTIVE_VIEWER_LIMITS[args.plan];
  const activeViewers = Math.max(0, Math.trunc(args.activeViewers));
  const percentage = allowance === 0 ? 0 : Math.round((activeViewers / allowance) * 100);
  const overLimit = activeViewers > allowance;
  let graceStartMs: number | null = null;
  if (args.graceStartedAt instanceof Date) graceStartMs = args.graceStartedAt.getTime();
  else if (typeof args.graceStartedAt === "string") graceStartMs = Date.parse(args.graceStartedAt);
  else if (args.graceStartedAt != null) graceStartMs = Number(args.graceStartedAt);
  if (!Number.isFinite(graceStartMs)) graceStartMs = null;
  const graceEndsMs = graceStartMs == null ? null : graceStartMs + ACTIVE_VIEWER_GRACE_DAYS * MS_PER_DAY;
  const expansionRestricted = args.plan === "free" && overLimit && graceEndsMs != null && nowMs >= graceEndsMs;

  let level: ActiveViewerUsageLevel = "normal";
  if (expansionRestricted) level = "restricted";
  else if (args.plan === "free" && overLimit) level = "grace";
  else if (percentage >= 100) level = "at_limit";
  else if (percentage >= 95) level = "warning";
  else if (percentage >= 85) level = "notice";
  else if (percentage >= 70) level = "informational";

  return {
    allowance,
    percentage,
    level,
    overLimit,
    graceEndsAt: graceEndsMs == null ? null : new Date(graceEndsMs).toISOString(),
    expansionRestricted,
  };
}
