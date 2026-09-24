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

// ------------------------------------------------------------------
// Commercial limits (quota-style allowances per tier)
// ------------------------------------------------------------------

export type PlanLimitKey =
  | "sites"
  | "players_per_site"
  | "active_viewers_30d"
  | "history_days"
  | "reward_mappings"
  | "shop_items"
  | "telegram_bots"
  | "telegram_offers"
  | "telegram_interactions_per_month"
  | "broadcast_deliveries_per_month"
  | "operator_seats";

export const PLAN_LIMITS: Record<PlanTier, Record<PlanLimitKey, number>> = {
  free: {
    sites: 1,
    players_per_site: 10,
    active_viewers_30d: 50,
    history_days: 30,
    reward_mappings: 3,
    shop_items: 3,
    telegram_bots: 1,
    telegram_offers: 2,
    telegram_interactions_per_month: 1_000,
    broadcast_deliveries_per_month: 0,
    operator_seats: 1,
  },
  pro: {
    sites: 3,
    players_per_site: 1_000,
    active_viewers_30d: 2_500,
    history_days: 365,
    reward_mappings: 50,
    shop_items: 100,
    telegram_bots: 3,
    telegram_offers: 20,
    telegram_interactions_per_month: 50_000,
    broadcast_deliveries_per_month: 10_000,
    operator_seats: 1,
  },
  team: {
    sites: 10,
    players_per_site: 5_000,
    active_viewers_30d: 25_000,
    history_days: 730,
    reward_mappings: 250,
    shop_items: 500,
    telegram_bots: 10,
    telegram_offers: 100,
    telegram_interactions_per_month: 250_000,
    broadcast_deliveries_per_month: 50_000,
    operator_seats: 5,
  },
};

export function getPlanLimit(plan: PlanTier, key: PlanLimitKey): number {
  return PLAN_LIMITS[plan][key];
}

export const LIMIT_LABELS: Record<PlanLimitKey, string> = {
  sites: "Sites",
  players_per_site: "Leaderboard players per site",
  active_viewers_30d: "Active viewers (rolling 30 days)",
  history_days: "Accessible history",
  reward_mappings: "Reward mappings",
  shop_items: "Shop items",
  telegram_bots: "Telegram bots",
  telegram_offers: "Telegram offers",
  telegram_interactions_per_month: "Telegram interactions per month",
  broadcast_deliveries_per_month: "Broadcast deliveries per month",
  operator_seats: "Operator seats",
};

// ------------------------------------------------------------------
// Commercial features (minimum-tier unlocks)
// ------------------------------------------------------------------

export type PlanFeature =
  | "custom_domain"
  | "signed_api"
  | "remove_branding"
  | "advanced_insights"
  | "advanced_overlays"
  | "activity_automation" // templates + scheduling + recurring + automation
  | "advanced_giveaways"
  | "predictions"
  | "tournaments"
  | "wheel"
  | "quests"
  | "duels"
  | "battlepass"
  | "telegram_broadcasts" // broadcasts + scheduled campaigns + segmentation
  | "telegram_postbacks"
  | "team_collaboration"; // members, invites, roles, shared operation

/** Minimum tier that unlocks each feature. */
export const FEATURE_MIN_TIER: Record<PlanFeature, PlanTier> = {
  custom_domain: "pro",
  signed_api: "pro",
  remove_branding: "pro",
  advanced_insights: "pro",
  advanced_overlays: "pro",
  activity_automation: "pro",
  advanced_giveaways: "pro",
  predictions: "pro",
  tournaments: "pro",
  wheel: "pro",
  quests: "pro",
  duels: "pro",
  battlepass: "pro",
  telegram_broadcasts: "pro",
  telegram_postbacks: "pro",
  team_collaboration: "team",
};

export function tierIndex(tier: PlanTier | string): number {
  return PLAN_TIERS.indexOf(tier as PlanTier);
}

export const PLAN_FEATURES: Record<PlanTier, readonly PlanFeature[]> = Object.fromEntries(
  PLAN_TIERS.map((tier) => [
    tier,
    (Object.keys(FEATURE_MIN_TIER) as PlanFeature[]).filter(
      (f) => tierIndex(FEATURE_MIN_TIER[f]) <= tierIndex(tier)
    ),
  ])
) as unknown as Record<PlanTier, readonly PlanFeature[]>;

export function canUseFeature(plan: PlanTier, feature: PlanFeature): boolean {
  return tierIndex(plan) >= tierIndex(FEATURE_MIN_TIER[feature]);
}

export function requiredPlanFor(feature: PlanFeature): PlanTier {
  return FEATURE_MIN_TIER[feature];
}

export const FEATURE_LABELS: Record<PlanFeature, { name: string; description: string }> = {
  custom_domain: { name: "Custom domain", description: "Serve your leaderboard on your own domain." },
  signed_api: { name: "Signed score API", description: "Update scores from your own system with signed requests." },
  remove_branding: { name: "Remove YourRank branding", description: "Hide the Powered by YourRank attribution." },
  advanced_insights: { name: "Advanced analytics", description: "Deeper breakdowns and a longer history window." },
  advanced_overlays: { name: "Advanced overlays", description: "Custom OBS overlay styling and alerts without branding." },
  activity_automation: { name: "Activity automation", description: "Templates, scheduling and recurring Activities." },
  advanced_giveaways: { name: "Advanced giveaways", description: "Verified entry, anti-abuse rules and winner response checks." },
  predictions: { name: "Predictions", description: "Run viewer predictions on your site." },
  tournaments: { name: "Tournaments", description: "Brackets and signups for your community." },
  wheel: { name: "Lucky wheel", description: "Spin-to-win engagement for viewers." },
  quests: { name: "Quests", description: "Daily quests and progress rewards." },
  duels: { name: "Duels", description: "Head-to-head viewer challenges." },
  battlepass: { name: "Battlepass", description: "Season tiers and XP rewards." },
  telegram_broadcasts: { name: "Telegram broadcasts", description: "Mass messages with scheduling and segmentation." },
  telegram_postbacks: { name: "Telegram postbacks", description: "Conversion postbacks for tracked offers." },
  team_collaboration: { name: "Team collaboration", description: "Operator seats, roles and shared site operation." },
};

// ------------------------------------------------------------------
// Operational safeguards (not commercial levers)
// ------------------------------------------------------------------

export const ACTIVE_VIEWER_WINDOW_DAYS = 30;
export const ACTIVE_VIEWER_GRACE_DAYS = 14;

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

// ------------------------------------------------------------------
// Pricing and marketing copy
// ------------------------------------------------------------------

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
  /** Shown inside a paid card while recurring checkout is not open; empty when checkout is live. */
  availability: string;
}> = {
  free: {
    name: "Free",
    positioning: "Start your community",
    highlight: false,
    features: [
      `${PLAN_LIMITS.free.sites} site · ${PLAN_LIMITS.free.players_per_site} leaderboard players · ${PLAN_LIMITS.free.active_viewers_30d} active viewers`,
      "Basic leaderboard, rewards and shop",
      "Manual Code Drops and chat giveaways",
      `${PLAN_LIMITS.free.telegram_bots} Telegram bot with basic commands and ${PLAN_LIMITS.free.telegram_offers} offers`,
      `Branded OBS overlay · ${PLAN_LIMITS.free.history_days} days of history`,
    ],
    cta: "Start free",
    availability: "",
  },
  pro: {
    name: "Pro",
    positioning: "Grow and automate your community",
    highlight: true,
    features: [
      `Everything in Free, at scale: ${PLAN_LIMITS.pro.sites} sites · ${PLAN_LIMITS.pro.players_per_site.toLocaleString("en-US")} players · ${PLAN_LIMITS.pro.active_viewers_30d.toLocaleString("en-US")} viewers`,
      "Activity templates, scheduling and automation",
      "Predictions, tournaments, wheel, quests, duels, battlepass",
      `Telegram broadcasts, scheduling, postbacks and segmentation (${PLAN_LIMITS.pro.broadcast_deliveries_per_month.toLocaleString("en-US")} deliveries/mo)`,
      "Custom domain, signed API and no YourRank branding",
      `Advanced analytics · 12 months of history`,
    ],
    cta: "Get Pro",
    availability: "",
  },
  team: {
    name: "Team",
    positioning: "Run your community with a team",
    highlight: false,
    features: [
      `Everything in Pro: ${PLAN_LIMITS.team.sites} sites · ${PLAN_LIMITS.team.players_per_site.toLocaleString("en-US")} players · ${PLAN_LIMITS.team.active_viewers_30d.toLocaleString("en-US")} viewers`,
      `${PLAN_LIMITS.team.operator_seats} operator seats with roles and permissions`,
      "Shared site operation and team-run automation",
      `${PLAN_LIMITS.team.telegram_bots} Telegram bots · ${PLAN_LIMITS.team.telegram_interactions_per_month.toLocaleString("en-US")} interactions/mo · ${PLAN_LIMITS.team.broadcast_deliveries_per_month.toLocaleString("en-US")} deliveries/mo`,
      `24 months of history`,
    ],
    cta: "Get Team",
    availability: "",
  },
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

/** A paid plan with a past expiry falls back to free. NULL expiry on a paid
    plan is a non-expiring grant — how admin/manual grants (e.g. a Supabase
    table edit) work. Free never requires one. */
export function effectivePlan(user: PlanUser | null | undefined, nowMs = Date.now()): PlanTier {
  if (!user || user.status === "suspended") return "free";
  const plan = String(user.plan || "free").toLowerCase();
  if (plan === "free") return "free";
  if (!isPlanTier(plan)) return "free";
  if (user.plan_expires_at == null) return plan;
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
  const allowance = getPlanLimit(args.plan, "active_viewers_30d");
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
