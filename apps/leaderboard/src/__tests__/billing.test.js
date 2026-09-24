import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  getPlanLimit,
  PLAN_META,
  PLAN_PRICES,
  PLAN_PRICING,
  PLAN_TIERS,
  activeViewerUsageState,
  effectivePlan,
  priceUsd,
} from "@yourrank/shared/plans";
import { activeViewerUsageMarkup } from "../assets/dashboard/plan-usage.js";

const NOW = Date.parse("2026-08-29T12:00:00Z");
const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const dashboardPlanSource = readFileSync(
  path.join(REPO_ROOT, "apps/leaderboard/src/assets/dashboard/site.js"),
  "utf8",
);
const billingMigration = readFileSync(
  path.join(REPO_ROOT, "supabase/migrations/20260904000000_billing_free_pro_team.sql"),
  "utf8",
);

describe("canonical Free / Pro / Team model", () => {
  test("has exactly three customer-facing tiers", () => {
    expect(PLAN_TIERS).toEqual(["free", "pro", "team"]);
    expect(Object.keys(PLAN_META)).toEqual(["free", "pro", "team"]);
  });

  test("implements approved scale and operator limits", () => {
    expect(getPlanLimit("free", "players_per_site")).toBe(10);
    expect(getPlanLimit("pro", "players_per_site")).toBe(1000);
    expect(getPlanLimit("team", "players_per_site")).toBe(5000);
    expect(getPlanLimit("free", "sites")).toBe(1);
    expect(getPlanLimit("pro", "sites")).toBe(3);
    expect(getPlanLimit("team", "sites")).toBe(10);
    expect(getPlanLimit("free", "active_viewers_30d")).toBe(50);
    expect(getPlanLimit("pro", "active_viewers_30d")).toBe(2500);
    expect(getPlanLimit("team", "active_viewers_30d")).toBe(10000);
    expect(getPlanLimit("free", "operator_seats")).toBe(1);
    expect(getPlanLimit("pro", "operator_seats")).toBe(1);
    expect(getPlanLimit("team", "operator_seats")).toBe(5);
  });

  test("implements approved monthly and annual prices", () => {
    expect(PLAN_PRICES).toEqual({ free: 0, pro: 24, team: 69 });
    expect(PLAN_PRICING.pro).toEqual({ monthlyUsd: 24, annualUsd: 240, effectiveAnnualMonthlyUsd: 20 });
    expect(PLAN_PRICING.team).toEqual({ monthlyUsd: 69, annualUsd: 690, effectiveAnnualMonthlyUsd: 57.5 });
    expect(priceUsd({}, "pro", "annual")).toBe(240);
    expect(priceUsd({}, "team", "annual")).toBe(690);
  });

  test("deployment variables cannot silently override prices", () => {
    expect(priceUsd({ PRO_PRICE_USD: "39" }, "pro")).toBe(24);
  });

  test("dashboard plan cards stay contract-tested against canonical prices", () => {
    const source = dashboardPlanSource.match(/function planDefs\(\) \{([\s\S]*?)\n\}/)[1];
    const getPlans = new Function("PLAN_ORDER", "PLAN_META", "PLAN_PRICING", "billingInterval", source);
    for (const interval of ["monthly", "annual"]) {
      const cards = getPlans(PLAN_TIERS, PLAN_META, PLAN_PRICING, interval);
      for (const [index, tier] of PLAN_TIERS.entries()) {
        expect(cards[index].name).toBe(PLAN_META[tier].name);
        expect(cards[index].features).toEqual(PLAN_META[tier].features);
        expect(cards[index].priceStr).toBe(`$${PLAN_PRICING[tier][interval === "monthly" ? "monthlyUsd" : "effectiveAnnualMonthlyUsd"]}`);
      }
    }
  });
});

describe("empty-database commercial migration", () => {
  test("migrates to exactly Free, Pro, and Team with deterministic legacy mappings", () => {
    expect(billingMigration).toContain("CREATE TYPE public.plan_tier_next AS ENUM ('free', 'pro', 'team')");
    expect(billingMigration).toContain("WHEN 'starter' THEN 'free'");
    expect(billingMigration).toContain("WHEN 'agency' THEN 'team'");
  });

  test("aborts on unexpected Lifetime rows before removing the provider value", () => {
    expect(billingMigration).toContain("provider::text = 'nowpayments_lifetime'");
    expect(billingMigration).toContain("RAISE EXCEPTION 'Lifetime billing rows exist; stop Billing Phase 2A and investigate before cleanup'");
    expect(billingMigration).not.toMatch(/pay_provider_next[\s\S]*?'nowpayments_lifetime'/);
  });

  test("adds account-pooled rolling activity and grace storage with query indexes", () => {
    expect(billingMigration).toContain("ADD COLUMN last_active_at timestamptz");
    expect(billingMigration).toContain("ADD COLUMN is_system boolean NOT NULL DEFAULT FALSE");
    expect(billingMigration).toContain("ADD COLUMN active_viewer_grace_started_at timestamptz");
    expect(billingMigration).toContain("CREATE INDEX idx_site_viewers_billing_active");
    expect(billingMigration).toContain("CREATE INDEX idx_sites_owner_billing_usage");
  });
});

describe("canonical entitlement resolver", () => {
  test("requires a future expiry for paid grants when an expiry is set", () => {
    // NULL expiry on a paid plan = non-expiring grant (admin/manual grant).
    expect(effectivePlan({ plan: "pro", plan_expires_at: null }, NOW)).toBe("pro");
    expect(effectivePlan({ plan: "team", plan_expires_at: NOW }, NOW)).toBe("free");
    expect(effectivePlan({ plan: "team", plan_expires_at: NOW + 1 }, NOW)).toBe("team");
  });

  test("rejects removed and unknown tiers", () => {
    for (const plan of ["starter", "agency", "lifetime", "vip"]) {
      expect(effectivePlan({ plan, plan_expires_at: NOW + 86_400_000 }, NOW)).toBe("free");
    }
  });

  test("suspension always resolves to Free", () => {
    expect(effectivePlan({ plan: "team", status: "suspended", plan_expires_at: NOW + 1 }, NOW)).toBe("free");
  });
});

describe("Free active-viewer grace", () => {
  test("49 remains under the allowance and 50 explains the limit without restricting", () => {
    const under = activeViewerUsageState({ plan: "free", activeViewers: 49, nowMs: NOW });
    const state = activeViewerUsageState({ plan: "free", activeViewers: 50, nowMs: NOW });
    expect(under.overLimit).toBe(false);
    expect(under.expansionRestricted).toBe(false);
    expect(state.level).toBe("at_limit");
    expect(state.overLimit).toBe(false);
    expect(state.expansionRestricted).toBe(false);
  });

  test("51 starts in grace and restricts only after 14 days", () => {
    const graceStartedAt = NOW - 13 * 86_400_000;
    expect(activeViewerUsageState({ plan: "free", activeViewers: 51, graceStartedAt, nowMs: NOW }).level).toBe("grace");
    const expired = activeViewerUsageState({ plan: "free", activeViewers: 51, graceStartedAt: NOW - 14 * 86_400_000, nowMs: NOW });
    expect(expired.level).toBe("restricted");
    expect(expired.expansionRestricted).toBe(true);
  });

  test("usage recovery and paid plans are never expansion-restricted", () => {
    expect(activeViewerUsageState({ plan: "free", activeViewers: 50, graceStartedAt: NOW - 30 * 86_400_000, nowMs: NOW }).expansionRestricted).toBe(false);
    expect(activeViewerUsageState({ plan: "pro", activeViewers: 3000, graceStartedAt: NOW - 30 * 86_400_000, nowMs: NOW }).expansionRestricted).toBe(false);
  });

  test("renders low, threshold, grace, and restricted usage without a KPI wall", () => {
    const render = (activeViewers, graceStartedAt = null) => {
      const state = activeViewerUsageState({ plan: "free", activeViewers, graceStartedAt, nowMs: NOW });
      return activeViewerUsageMarkup({
        ...state,
        activeViewers,
        upgradeAllowance: getPlanLimit("pro", "active_viewers_30d"),
      });
    };

    expect(render(34)).toContain('data-level="normal"');
    expect(render(35)).toContain('data-level="informational"');
    expect(render(43)).toContain('data-level="notice"');
    expect(render(48)).toContain('data-level="warning"');
    expect(render(50)).toContain('data-level="at_limit"');
    expect(render(51, NOW - 13 * 86_400_000)).toContain('data-level="grace"');
    expect(render(51, NOW - 14 * 86_400_000)).toContain('data-level="restricted"');
    expect(render(51, NOW - 14 * 86_400_000)).toContain("Viewer access, memberships, credits, orders and existing activity continue.");
    expect(render(43)).toContain('href="/pricing"');
  });
});
