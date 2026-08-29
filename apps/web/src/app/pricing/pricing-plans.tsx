"use client";

import { useState } from "react";
import {
  ACTIVE_VIEWER_LIMITS,
  BOARD_LIMITS,
  BOT_PLANS,
  CREDITS_REWARD_LIMITS,
  CREDITS_SHOP_LIMITS,
  HISTORY_DAYS,
  OPERATOR_SEAT_LIMITS,
  PLAN_LIMITS,
  PLAN_META,
  PLAN_PRICING,
  PLAN_TIERS,
  type BillingInterval,
  type PlanTier,
} from "@yourrank/shared/plans";

const number = (value: number) => value.toLocaleString("en-US");

function displayPrice(tier: PlanTier, interval: BillingInterval) {
  if (tier === "free") return { amount: "$0", period: "forever", detail: "No credit card required" };
  const pricing = PLAN_PRICING[tier];
  if (interval === "annual") {
    return {
      amount: `$${pricing.effectiveAnnualMonthlyUsd.toFixed(pricing.effectiveAnnualMonthlyUsd % 1 ? 2 : 0)}`,
      period: "/month",
      detail: `$${pricing.annualUsd} billed annually · 2 months free`,
    };
  }
  return { amount: `$${pricing.monthlyUsd}`, period: "/month", detail: "Billed monthly" };
}

const strongestFeatures: Record<PlanTier, string[]> = {
  free: [
    `${number(ACTIVE_VIEWER_LIMITS.free)} active viewers`,
    `${BOARD_LIMITS.free} site · ${number(PLAN_LIMITS.free)} leaderboard players`,
    `${CREDITS_REWARD_LIMITS.free} reward mappings · ${CREDITS_SHOP_LIMITS.free} shop items`,
    "Basic recent Insights",
    "Standard customization with YourRank badge",
  ],
  pro: [
    `${number(ACTIVE_VIEWER_LIMITS.pro)} active viewers`,
    `${BOARD_LIMITS.pro} sites · ${number(PLAN_LIMITS.pro)} players per site`,
    "Custom domain and stronger branding",
    `${CREDITS_REWARD_LIMITS.pro} reward mappings · ${CREDITS_SHOP_LIMITS.pro} shop items`,
    "CSV exports and automatic scores",
    "12 months of accessible history",
  ],
  team: [
    `${number(ACTIVE_VIEWER_LIMITS.team)} active viewers`,
    `${BOARD_LIMITS.team} sites · ${number(PLAN_LIMITS.team)} players per site`,
    `${OPERATOR_SEAT_LIMITS.team} total operator seats`,
    "Manager and moderator roles",
    `${CREDITS_REWARD_LIMITS.team} reward mappings · ${CREDITS_SHOP_LIMITS.team} shop items`,
    "24 months of accessible history",
  ],
};

const comparison = [
  ["Active viewers · rolling 30 days", ...PLAN_TIERS.map((tier) => number(ACTIVE_VIEWER_LIMITS[tier]))],
  ["Creator-owned sites", ...PLAN_TIERS.map((tier) => String(BOARD_LIMITS[tier]))],
  ["Leaderboard players per site", ...PLAN_TIERS.map((tier) => number(PLAN_LIMITS[tier]))],
  ["Accessible history", `${HISTORY_DAYS.free} days`, "12 months", "24 months"],
  ["Reward mappings per site", ...PLAN_TIERS.map((tier) => number(CREDITS_REWARD_LIMITS[tier]))],
  ["Shop items per site", ...PLAN_TIERS.map((tier) => number(CREDITS_SHOP_LIMITS[tier]))],
  ["Connected Telegram bots", ...PLAN_TIERS.map((tier) => number(BOT_PLANS[tier].maxBots))],
  ["Custom domain", "Not included", "Included", "Included"],
  ["Automatic scores", "Not included", "Included", "Included"],
  ["Operator seats", ...PLAN_TIERS.map((tier) => String(OPERATOR_SEAT_LIMITS[tier]))],
] as const;

export function PricingPlans() {
  const [interval, setInterval] = useState<BillingInterval>("monthly");

  return (
    <>
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="inline-flex self-start rounded-[12px] border border-devin-line bg-white p-1" role="group" aria-label="Billing interval">
              {(["monthly", "annual"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={interval === value}
                  onClick={() => setInterval(value)}
                  className={`min-h-10 rounded-[8px] px-4 text-sm font-medium capitalize transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-devin-primary ${interval === value ? "bg-devin-ink text-white" : "text-devin-ink-soft hover:text-devin-ink"}`}
                >
                  {value}
                </button>
              ))}
            </div>
            <p className="text-sm text-devin-ink-soft">Annual Pro and Team include 2 months free.</p>
          </div>

          <div className="grid gap-px overflow-hidden rounded-[16px] border border-devin-line bg-devin-line lg:grid-cols-3">
            {PLAN_TIERS.map((tier) => {
              const plan = PLAN_META[tier];
              const price = displayPrice(tier, interval);
              return (
                <article key={tier} className={`relative flex flex-col bg-white p-7 sm:p-8 ${plan.highlight ? "outline outline-1 -outline-offset-1 outline-devin-primary" : ""}`}>
                  {plan.highlight && <span className="mb-5 self-start rounded-full bg-devin-primary px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-white">Recommended</span>}
                  <h2 className="text-2xl font-medium tracking-[-0.02em] text-devin-ink">{plan.name}</h2>
                  <p className="mt-2 min-h-12 text-sm leading-relaxed text-devin-ink-soft">{plan.positioning}</p>
                  <p className="mt-6 flex items-end gap-1 text-devin-ink">
                    <span className="text-5xl font-medium tracking-[-0.04em] tabular-nums">{price.amount}</span>
                    <span className="pb-1.5 text-sm text-devin-ink-soft">{price.period}</span>
                  </p>
                  <p className="mt-2 min-h-5 text-xs text-devin-ink-soft">{price.detail}</p>
                  <ul className="mt-7 flex-1 space-y-3 border-t border-devin-line pt-6">
                    {strongestFeatures[tier].map((feature) => (
                      <li key={feature} className="flex gap-3 text-sm leading-relaxed text-devin-ink-soft">
                        <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-devin-primary" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m3.2 8.2 3 3.1 6.7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <a href={`/signup?plan=${tier}&interval=${interval}`} data-magnetic className={`mt-8 inline-flex min-h-12 items-center justify-center rounded-[2px] px-5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-devin-primary ${plan.highlight ? "bg-devin-primary text-white hover:bg-devin-primary-hover" : "border border-devin-line text-devin-ink hover:border-devin-ink/40"}`}>
                    {plan.cta}
                  </a>
                </article>
              );
            })}
          </div>
          <p className="mt-5 max-w-3xl text-sm leading-relaxed text-devin-ink-soft">
            Free is available now. Recurring card checkout for Pro and Team is not available yet; paid access will only be activated after a verified provider confirmation.
          </p>
        </div>
      </section>

      <section className="border-y border-devin-line bg-devin-secondary/35 px-6 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-medium tracking-[-0.02em] text-devin-ink sm:text-4xl">Compare the operating limits.</h2>
          <p className="mt-3 text-sm text-devin-ink-soft sm:hidden">Scroll sideways to compare all plans.</p>
          <div className="scroll-x-hint mt-8 overflow-x-auto rounded-[16px] border border-devin-line bg-white" role="region" aria-label="Plan comparison" tabIndex={0}>
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-devin-line text-left">
                  <th scope="col" className="px-5 py-4 font-medium text-devin-ink">Capability</th>
                  {PLAN_TIERS.map((tier) => <th key={tier} scope="col" className={`px-5 py-4 font-medium text-devin-ink ${tier === "pro" ? "bg-devin-secondary/45" : ""}`}>{PLAN_META[tier].name}</th>)}
                </tr>
              </thead>
              <tbody>
                {comparison.map(([label, ...values]) => (
                  <tr key={label} className="border-b border-devin-line last:border-b-0">
                    <th scope="row" className="px-5 py-3.5 text-left font-normal text-devin-ink">{label}</th>
                    {values.map((value, index) => <td key={PLAN_TIERS[index]} className={`px-5 py-3.5 tabular-nums text-devin-ink-soft ${PLAN_TIERS[index] === "pro" ? "bg-devin-secondary/45 text-devin-ink" : ""}`}>{value}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
