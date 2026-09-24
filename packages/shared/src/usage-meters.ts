// Monthly account usage meters backed by public.account_usage_meters.
// Meters count commercial usage per UTC month; allowances come from
// PLAN_LIMITS via USAGE_METER_LIMIT.
//
// `db` is injected (`{one, exec}`) so callers can pass a transaction handle:
// the bot Worker pool is max:1, so metering inside a transaction MUST use
// the tx's own query methods (see apps/bot/src/plans.ts for the deadlock
// explanation).
import { one as defaultOne, exec as defaultExec } from "./db.js";
import type { PlanLimitKey } from "./plans.js";

export type UsageMeter = "telegram_interactions" | "broadcast_deliveries";

export const USAGE_METER_LIMIT: Record<UsageMeter, PlanLimitKey> = {
  telegram_interactions: "telegram_interactions_per_month",
  broadcast_deliveries: "broadcast_deliveries_per_month",
};

export interface UsageDb {
  one: (sql: string, params?: unknown[]) => Promise<Record<string, unknown> | null | undefined>;
  exec?: (sql: string, params?: unknown[]) => Promise<unknown>;
}

/** SQL fragment for the first day of the current UTC month. */
export function currentPeriodStartSql(): string {
  return "(date_trunc('month', now() AT TIME ZONE 'utc'))::date";
}

export interface ConsumeResult {
  allowed: boolean;
  used: number;
  allowance: number;
}

/**
 * Bounded increment: consumes `amount` only if used + amount <= allowance.
 * One atomic statement — safe under concurrent consumers. When no row is
 * returned the meter is already at/over allowance; `used` is then read back
 * for the caller's denial details.
 */
export async function tryConsumeUsage(
  db: UsageDb,
  accountId: string,
  meter: UsageMeter,
  amount: number,
  allowance: number
): Promise<ConsumeResult> {
  if (amount > allowance) {
    const used = await getUsage(db, accountId, meter);
    return { allowed: false, used, allowance };
  }
  const row = await db.one(
    `INSERT INTO account_usage_meters (account_id, meter, period_start, used)
       VALUES ($1, $2, ${currentPeriodStartSql()}, $3)
     ON CONFLICT (account_id, meter, period_start) DO UPDATE
        SET used = account_usage_meters.used + EXCLUDED.used,
            updated_at = now()
      WHERE account_usage_meters.used + EXCLUDED.used <= $4
     RETURNING used`,
    [accountId, meter, amount, allowance]
  );
  if (row) return { allowed: true, used: Number(row.used), allowance };
  const used = await getUsage(db, accountId, meter);
  return { allowed: false, used, allowance };
}

export interface ReserveResult {
  /** Units actually reserved (0 when the allowance is exhausted). */
  granted: number;
  /** Post-reservation `used` total for the current period. */
  used: number;
  /** Period the reservation was taken from — pass back to releaseUsage. */
  periodStart: string;
}

/**
 * Atomic bounded reservation: grants `min(requested, allowance - used)` and
 * commits it inside the caller's transaction — the account_usage_meters row
 * lock serializes concurrent same-account reservations, so concurrent
 * workers can never oversubscribe the monthly allowance.
 *
 * MUST be called inside a transaction (the FOR UPDATE would otherwise lock
 * nothing). Unused units are returned with releaseUsage against the
 * reservation's own periodStart, so a month rollover mid-batch cannot
 * corrupt the next period.
 */
export async function reserveUsage(
  db: UsageDb,
  accountId: string,
  meter: UsageMeter,
  requested: number,
  allowance: number
): Promise<ReserveResult> {
  await db.one(
    `INSERT INTO account_usage_meters (account_id, meter, period_start, used)
       VALUES ($1, $2, ${currentPeriodStartSql()}, 0)
     ON CONFLICT (account_id, meter, period_start) DO NOTHING`,
    [accountId, meter]
  );
  const row = (await db.one(
    `SELECT used, period_start::text AS period_start FROM account_usage_meters
      WHERE account_id=$1 AND meter=$2 AND period_start=${currentPeriodStartSql()}
      FOR UPDATE`,
    [accountId, meter]
  )) as { used: number | string; period_start: string } | null | undefined;
  const usedBefore = Number(row?.used ?? 0);
  const granted = Math.max(0, Math.min(requested, allowance - usedBefore));
  if (granted > 0) {
    await db.one(
      `UPDATE account_usage_meters SET used = used + $3, updated_at = now()
        WHERE account_id=$1 AND meter=$2 AND period_start=${currentPeriodStartSql()}`,
      [accountId, meter, granted]
    );
  }
  return { granted, used: usedBefore + granted, periodStart: String(row?.period_start ?? "") };
}

/**
 * Returns unused reserved units to the period the reservation came from.
 * `periodStart` is the `period_start` returned by reserveUsage, not the
 * current month — a rollover mid-batch must not touch the new period.
 */
export async function releaseUsage(
  db: UsageDb,
  accountId: string,
  meter: UsageMeter,
  amount: number,
  periodStart: string
): Promise<void> {
  await db.one(
    `UPDATE account_usage_meters SET used = GREATEST(0, used - $4), updated_at = now()
      WHERE account_id=$1 AND meter=$2 AND period_start=$3::date`,
    [accountId, meter, periodStart, amount]
  );
}

export async function getUsage(db: UsageDb, accountId: string, meter: UsageMeter): Promise<number> {
  const row = await db.one(
    `SELECT used FROM account_usage_meters
      WHERE account_id=$1 AND meter=$2 AND period_start=${currentPeriodStartSql()}`,
    [accountId, meter]
  );
  return Number(row?.used ?? 0);
}

export async function getUsageSummary(
  db: UsageDb,
  accountId: string
): Promise<Record<UsageMeter, number>> {
  const summary: Record<UsageMeter, number> = { telegram_interactions: 0, broadcast_deliveries: 0 };
  // `exec` returns a row array; when only `one` is injected, callers wrap a
  // multi-row select (e.g. tx.unsafe) so the result may still be an array.
  const query = db.exec ?? db.one;
  const result = await query(
    `SELECT meter, used FROM account_usage_meters
      WHERE account_id=$1 AND period_start=${currentPeriodStartSql()}`,
    [accountId]
  );
  for (const row of (Array.isArray(result) ? result : result ? [result] : []) as Array<{ meter: UsageMeter; used: number | string }>) {
    if (row.meter in summary) summary[row.meter] = Number(row.used);
  }
  return summary;
}
