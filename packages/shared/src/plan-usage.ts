import { exec as defaultExec, one as defaultOne } from "./db.js";
import {
  ACTIVE_VIEWER_LIMITS,
  ACTIVE_VIEWER_WINDOW_DAYS,
  activeViewerUsageState,
  effectivePlan,
  type PlanTier,
} from "./plans.js";

type One = typeof defaultOne;
type Exec = typeof defaultExec;

export interface PlanUsageDependencies {
  one?: One;
  exec?: Exec;
}

export interface AccountActiveViewerUsage {
  accountId: string;
  plan: PlanTier;
  activeViewers: number;
  rollingDays: number;
  allowance: number;
  percentage: number;
  level: ReturnType<typeof activeViewerUsageState>["level"];
  overLimit: boolean;
  graceStartedAt: string | null;
  graceEndsAt: string | null;
  expansionRestricted: boolean;
}

interface AccountRow {
  id: string;
  plan: string;
  status: string;
  plan_expires_at: string | null;
  active_viewer_grace_started_at: string | null;
}

async function accountUsageRows(
  accountId: string,
  dependencies: PlanUsageDependencies,
): Promise<{ account: AccountRow; activeViewers: number } | null> {
  const one = dependencies.one ?? defaultOne;
  const account = await one<AccountRow>(
    `SELECT id, plan::text AS plan, status::text AS status, plan_expires_at,
            active_viewer_grace_started_at
       FROM users
      WHERE id=$1`,
    [accountId],
  );
  if (!account) return null;
  const usage = await one<{ active_viewers: number }>(
    `SELECT COUNT(DISTINCT sv.viewer_id)::int AS active_viewers
       FROM sites s
       JOIN site_viewers sv ON sv.site_id=s.id
       JOIN viewers v ON v.id=sv.viewer_id
      WHERE s.user_id=$1
        AND sv.last_active_at >= now() - interval '${ACTIVE_VIEWER_WINDOW_DAYS} days'
        AND sv.last_active_at <= now()
        AND v.is_system=FALSE`,
    [accountId],
  );
  return { account, activeViewers: Number(usage?.active_viewers) || 0 };
}

/**
 * Recompute account-pooled rolling usage and persist only the Free overage
 * grace start. Paid plans and Free accounts back within allowance clear grace.
 */
export async function reconcileAccountActiveViewerUsage(
  accountId: string,
  dependencies: PlanUsageDependencies = {},
): Promise<AccountActiveViewerUsage | null> {
  const rows = await accountUsageRows(accountId, dependencies);
  if (!rows) return null;
  const exec = dependencies.exec ?? defaultExec;
  const plan = effectivePlan(rows.account);
  let graceStartedAt = rows.account.active_viewer_grace_started_at;
  const overFreeAllowance = plan === "free" && rows.activeViewers > ACTIVE_VIEWER_LIMITS.free;

  if (overFreeAllowance && !graceStartedAt) {
    const updated = await exec(
      `UPDATE users
          SET active_viewer_grace_started_at=COALESCE(active_viewer_grace_started_at, now()),
              updated_at=now()
        WHERE id=$1
        RETURNING active_viewer_grace_started_at`,
      [accountId],
    ) as Array<{ active_viewer_grace_started_at: string }>;
    graceStartedAt = updated[0]?.active_viewer_grace_started_at ?? new Date().toISOString();
  } else if (!overFreeAllowance && graceStartedAt) {
    await exec(
      `UPDATE users
          SET active_viewer_grace_started_at=NULL, updated_at=now()
        WHERE id=$1 AND active_viewer_grace_started_at IS NOT NULL`,
      [accountId],
    );
    graceStartedAt = null;
  }

  const state = activeViewerUsageState({
    plan,
    activeViewers: rows.activeViewers,
    graceStartedAt,
  });
  return {
    accountId,
    plan,
    activeViewers: rows.activeViewers,
    rollingDays: ACTIVE_VIEWER_WINDOW_DAYS,
    graceStartedAt,
    ...state,
  };
}

/**
 * Mark one existing site membership active after a server-verified,
 * authenticated qualifying action. Anonymous traffic must never call this.
 */
export async function markSiteViewerActive(
  siteId: string,
  viewerId: string,
  dependencies: PlanUsageDependencies = {},
): Promise<AccountActiveViewerUsage | null> {
  const exec = dependencies.exec ?? defaultExec;
  const one = dependencies.one ?? defaultOne;
  await exec(
    `UPDATE site_viewers
        SET last_active_at=now(), updated_at=now()
      WHERE site_id=$1 AND viewer_id=$2`,
    [siteId, viewerId],
  );
  const site = await one<{ user_id: string }>("SELECT user_id FROM sites WHERE id=$1", [siteId]);
  return site?.user_id
    ? reconcileAccountActiveViewerUsage(site.user_id, dependencies)
    : null;
}

export async function creatorExpansionRestriction(
  accountId: string,
  dependencies: PlanUsageDependencies = {},
): Promise<{ restricted: boolean; usage: AccountActiveViewerUsage | null }> {
  const usage = await reconcileAccountActiveViewerUsage(accountId, dependencies);
  return { restricted: Boolean(usage?.expansionRestricted), usage };
}
