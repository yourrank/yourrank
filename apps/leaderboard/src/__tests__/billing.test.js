import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ACTIVE_VIEWER_LIMITS,
  BOARD_LIMITS,
  OPERATOR_SEAT_LIMITS,
  PLAN_LIMITS,
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
    expect(PLAN_LIMITS).toEqual({ free: 100, pro: 1000, team: 5000 });
    expect(BOARD_LIMITS).toEqual({ free: 1, pro: 3, team: 10 });
    expect(ACTIVE_VIEWER_LIMITS).toEqual({ free: 200, pro: 2500, team: 10000 });
    expect(OPERATOR_SEAT_LIMITS).toEqual({ free: 1, pro: 1, team: 5 });
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
    for (const tier of PLAN_TIERS) {
      const pricing = PLAN_PRICING[tier];
      expect(dashboardPlanSource).toContain(
        `key: "${tier}", name: "${PLAN_META[tier].name}", price: ${pricing.monthlyUsd}, priceStr: "$${pricing.monthlyUsd}"`,
      );
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
  test("requires a future expiry for paid grants", () => {
    expect(effectivePlan({ plan: "pro", plan_expires_at: null }, NOW)).toBe("free");
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
  test("200 explains the limit without restricting", () => {
    const state = activeViewerUsageState({ plan: "free", activeViewers: 200, nowMs: NOW });
    expect(state.level).toBe("at_limit");
    expect(state.expansionRestricted).toBe(false);
  });

  test("201 starts in grace and restricts only after 14 days", () => {
    const graceStartedAt = NOW - 13 * 86_400_000;
    expect(activeViewerUsageState({ plan: "free", activeViewers: 201, graceStartedAt, nowMs: NOW }).level).toBe("grace");
    const expired = activeViewerUsageState({ plan: "free", activeViewers: 201, graceStartedAt: NOW - 14 * 86_400_000, nowMs: NOW });
    expect(expired.level).toBe("restricted");
    expect(expired.expansionRestricted).toBe(true);
  });

  test("usage recovery and paid plans are never expansion-restricted", () => {
    expect(activeViewerUsageState({ plan: "free", activeViewers: 200, graceStartedAt: NOW - 30 * 86_400_000, nowMs: NOW }).expansionRestricted).toBe(false);
    expect(activeViewerUsageState({ plan: "pro", activeViewers: 3000, graceStartedAt: NOW - 30 * 86_400_000, nowMs: NOW }).expansionRestricted).toBe(false);
  });

  test("renders low, threshold, grace, and restricted usage without a KPI wall", () => {
    const render = (activeViewers, graceStartedAt = null) => {
      const state = activeViewerUsageState({ plan: "free", activeViewers, graceStartedAt, nowMs: NOW });
      return activeViewerUsageMarkup({
        ...state,
        activeViewers,
        upgradeAllowance: ACTIVE_VIEWER_LIMITS.pro,
      });
    };

    expect(render(40)).toContain('data-level="normal"');
    expect(render(170)).toContain('data-level="notice"');
    expect(render(190)).toContain('data-level="warning"');
    expect(render(200)).toContain('data-level="at_limit"');
    expect(render(201, NOW - 13 * 86_400_000)).toContain('data-level="grace"');
    expect(render(201, NOW - 14 * 86_400_000)).toContain('data-level="restricted"');
    expect(render(201, NOW - 14 * 86_400_000)).toContain("Viewer access, memberships, credits, orders and existing activity continue.");
    expect(render(170)).toContain('href="/pricing"');
  });
});
