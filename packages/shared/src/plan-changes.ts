// ------------------------------------------------------------------
// Subscription change matrix. The canonical identity of a paid subscription is
// tier + interval (pro_monthly, pro_annual, team_monthly, team_annual). Free is
// the absence of a Polar subscription, never a product. The Worker uses this to
// pick the Polar `proration_behavior`; the dashboard uses it for card labels.
// Nothing here writes entitlements — Polar webhooks/reconciliation do.
// ------------------------------------------------------------------

import { PLAN_META, PLAN_PRICING, tierIndex, type BillingInterval, type PlanTier } from "./plans.js";

export type PaidTier = Exclude<PlanTier, "free">;

export interface CurrentSubscription {
  plan: PaidTier;
  interval: BillingInterval;
  cancelAtPeriodEnd?: boolean;
  pending?: { plan: PaidTier; interval: BillingInterval } | null;
}

export type PlanChangeKind =
  | "current"
  | "upgrade"
  | "downgrade"
  | "switch_annual"
  | "switch_monthly"
  | "cancel"
  | "pending";

/** Polar `proration_behavior` values (https://polar.sh/docs/api-reference/subscriptions/update). */
export type ProrationBehavior = "invoice" | "prorate" | "next_period";

export interface PlanChange {
  kind: PlanChangeKind;
  /** When the change takes effect from the customer's point of view. */
  timing: "immediate" | "period_end" | "none";
  /** Polar `proration_behavior` to send for product changes; null for cancel/no-op. */
  proration: ProrationBehavior | null;
  label: string;
}

export function subscriptionKey(plan: PlanTier, interval: BillingInterval): string {
  return plan === "free" ? "free" : `${plan}_${interval}`;
}

export function intervalPriceUsd(plan: PlanTier, interval: BillingInterval): number {
  const p = PLAN_PRICING[plan];
  return interval === "annual" ? p.annualUsd : p.monthlyUsd;
}

export function formatPlanPrice(plan: PlanTier, interval: BillingInterval): string {
  if (plan === "free") return "$0";
  const amount = intervalPriceUsd(plan, interval);
  if (interval === "annual") {
    const perMonth = PLAN_PRICING[plan].effectiveAnnualMonthlyUsd;
    const monthly = Number.isInteger(perMonth) ? String(perMonth) : perMonth.toFixed(2);
    return `$${amount}/year ($${monthly}/mo)`;
  }
  return `$${amount}/month`;
}

/**
 * Decide what selecting `target` means for a subscriber on `current`.
 *
 * - Same tier and interval → current plan (no-op).
 * - Higher tier → immediate upgrade; Polar prorates the difference and invoices
 *   it now (`invoice`). Interval changes cannot be deferred by Polar, so the
 *   interval switches immediately too.
 * - Lower tier → scheduled for the next billing cycle (`next_period`); the
 *   customer keeps what they paid for. A tier downgrade combined with an
 *   interval change also waits for the period end.
 * - Same tier, monthly → annual → immediate (`invoice`): Polar cannot schedule
 *   a change that alters the interval, and the customer gains a longer period.
 * - Same tier, annual → monthly → next period (`next_period`), so the prepaid
 *   year is honoured rather than refunded pro rata.
 */
export function planChangeFor(current: CurrentSubscription, target: { plan: PlanTier; interval: BillingInterval }): PlanChange {
  if (target.plan === "free") {
    return { kind: "cancel", timing: "period_end", proration: null, label: "Cancel subscription" };
  }
  if (current.pending && current.pending.plan === target.plan && current.pending.interval === target.interval) {
    return { kind: "pending", timing: "period_end", proration: null, label: "Scheduled" };
  }
  if (current.plan === target.plan && current.interval === target.interval) {
    return { kind: "current", timing: "none", proration: null, label: "Current plan" };
  }
  const diff = tierIndex(target.plan) - tierIndex(current.plan);
  const name = PLAN_META[target.plan].name;
  if (diff > 0) {
    return { kind: "upgrade", timing: "immediate", proration: "invoice", label: `Upgrade to ${name}` };
  }
  if (diff < 0) {
    return { kind: "downgrade", timing: "period_end", proration: "next_period", label: `Downgrade to ${name}` };
  }
  if (target.interval === "annual") {
    return { kind: "switch_annual", timing: "immediate", proration: "invoice", label: "Switch to annual" };
  }
  return { kind: "switch_monthly", timing: "period_end", proration: "next_period", label: "Switch to monthly" };
}
