import { one } from "@yourrank/shared/db";
import { effectivePlan, getPlanLimit, canUseFeature, PLAN_META } from "@yourrank/shared/plans";
import { featureDenial, limitDenial, type EntitlementDenial } from "@yourrank/shared/entitlements";
import type { PlanTier } from "@yourrank/shared/plans";

// Re-export for consumers that import from this module.
export type { PlanTier } from "@yourrank/shared/plans";
export { getPlanLimit } from "@yourrank/shared/plans";

/**
 * Look up a valid plan tier string. Returns undefined for tiers that
 * are not valid plans, so callers can fall back to free. Every
 * DB-sourced tier MUST go through this lookup instead of casting
 * directly.
 */
export function getPlanTier(tier: string | null | undefined): PlanTier | undefined {
  return tier === "free" || tier === "pro" || tier === "team" ? tier : undefined;
}

export async function getUserPlanTier(userId: string): Promise<PlanTier> {
  const row = await one<{ plan: PlanTier; plan_expires_at: string | null }>(
    `SELECT plan, plan_expires_at FROM users WHERE id = $1`, [userId]
  );
  return effectivePlan(row);
}

/** Bot-dashboard plan view derived from the canonical PLAN_LIMITS tables. */
export function botPlanView(tier: PlanTier) {
  return {
    tier,
    label: PLAN_META[tier].name,
    maxBots: getPlanLimit(tier, "telegram_bots"),
    maxOffers: getPlanLimit(tier, "telegram_offers"),
    broadcasts: canUseFeature(tier, "telegram_broadcasts"),
    postbacks: canUseFeature(tier, "telegram_postbacks"),
  };
}

export async function getUserPlan(userId: string) {
  return botPlanView(await getUserPlanTier(userId));
}

/** Returns an entitlement denial if the user is at their plan limit, else null. */
export async function checkLimit(
  userId: string,
  kind: "bots" | "offers"
): Promise<EntitlementDenial | null> {
  const plan = await getUserPlanTier(userId);
  const table = kind === "bots" ? "bots" : "offers";
  const limitKey = kind === "bots" ? "telegram_bots" : "telegram_offers";
  const row = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE owner_id = $1` +
      (kind === "bots" ? ` AND status <> 'revoked'` : ``),
    [userId]
  );
  if ((row?.n ?? 0) >= getPlanLimit(plan, limitKey)) {
    return limitDenial(plan, limitKey, row?.n ?? 0);
  }
  return null;
}

/** Returns an entitlement denial if the feature is not in the user's plan, else null. */
export async function checkFeature(
  userId: string,
  feature: "broadcasts" | "postbacks"
): Promise<EntitlementDenial | null> {
  const plan = await getUserPlanTier(userId);
  const key = feature === "broadcasts" ? "telegram_broadcasts" : "telegram_postbacks";
  if (!canUseFeature(plan, key)) {
    return featureDenial(plan, key);
  }
  return null;
}

/**
 * Run the plan-limit check + the caller's INSERT atomically, holding a
 * per-(user,kind) Postgres advisory lock so two concurrent requests can't
 * both pass the count check and both insert (TOCTOU quota bypass).
 *
 * `kind` + `userId` are hashed into two int4 lock keys. The lock is
 * transaction-scoped: we run the count + the insert inside one transaction,
 * so the lock is held for exactly the duration of that unit and released on
 * commit/rollback. Failure (INSERT throws) propagates and rolls back.
 *
 * Returns { denial } if over limit, otherwise { result } = await fn(tx).
 */
export async function withPlanLimit<R>(
  userId: string,
  kind: "bots" | "offers",
  fn: (tx: import("@yourrank/shared/db").Tx) => Promise<R>
): Promise<{ denial: EntitlementDenial } | { result: R }> {
  const { withTransaction } = await import("@yourrank/shared/db");
  // Two stable int4 keys from userId + kind. Postgres pg_advisory_xact_lock
  // takes bigint; we pack (userIdHashHi, kindHashLo) into a stable pair.
  const kindId = kind === "bots" ? 1 : 2;
  const key = await stableHashInt64(userId + ":" + kindId);
  return withTransaction(async (tx) => {
    // Acquire the transaction-scoped advisory lock — same userId+kind always
    // maps to the same key, serializing concurrent create attempts per user.
    await tx.query(`SELECT pg_advisory_xact_lock($1)`, [key]);
    // CRITICAL: read the plan on THIS transaction's connection (tx.one), not via
    // the module-level one(). The db pool is max:1 and begin() holds the only
    // connection; a module-level query would queue for that same connection and
    // deadlock (circular wait) — permanently hanging every create endpoint.
    const planRow = await tx.one<{ plan: PlanTier; plan_expires_at: string | null }>(
      `SELECT plan, plan_expires_at FROM users WHERE id = $1`, [userId]
    );
    const plan = effectivePlan(planRow);
    const table = kind === "bots" ? "bots" : "offers";
    const limitKey = kind === "bots" ? "telegram_bots" : "telegram_offers";
    const row = await tx.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE owner_id = $1` +
        (kind === "bots" ? ` AND status <> 'revoked'` : ``),
      [userId]
    );
    if ((row?.n ?? 0) >= getPlanLimit(plan, limitKey)) {
      return { denial: limitDenial(plan, limitKey, row?.n ?? 0) };
    }
    const result = await fn(tx);
    return { result };
  });
}

/** Fold a string into a stable int64 for advisory-lock keying (non-crypto). */
async function stableHashInt64(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const view = new DataView(buf);
  // First 8 bytes -> signed int64 as a string (avoids JS BigInt/serialization quirks).
  // Mask the high bit to guarantee the result fits in PostgreSQL's signed bigint
  // range (max 2^63 - 1). Without this, values >= 2^63 overflow and pg rejects them
  // with "value is out of range for type bigint" (error 22003).
  const lo = view.getUint32(0, false);
  const hi = view.getUint32(4, false) & 0x7FFFFFFF;
  return String((BigInt(hi) << 32n) | BigInt(lo));
}
