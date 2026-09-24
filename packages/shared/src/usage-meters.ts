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

/**
 * Unbounded add for post-hoc accounting of work already performed
 * (e.g. broadcast delivery attempts). Returns the new `used` total.
 */
export async function recordUsage(
  db: UsageDb,
  accountId: string,
  meter: UsageMeter,
  amount: number
): Promise<number> {
  const row = await db.one(
    `INSERT INTO account_usage_meters (account_id, meter, period_start, used)
       VALUES ($1, $2, ${currentPeriodStartSql()}, $3)
     ON CONFLICT (account_id, meter, period_start) DO UPDATE
        SET used = account_usage_meters.used + EXCLUDED.used,
            updated_at = now()
     RETURNING used`,
    [accountId, meter, amount]
  );
  return Number(row?.used ?? 0);
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
