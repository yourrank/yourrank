import {
  query as defaultQuery,
  withTransaction as defaultWithTransaction,
} from "@yourrank/shared/db";
import { effectivePlan, canUseAutomation } from "@yourrank/shared/plans";
import {
  SAFE_AUTOMATION_KIND,
  createCanonicalCodeDrop,
  generateScheduledDropCode,
  validateCodeDropConfig,
} from "./code-drop-service.js";

export const AUTOMATION_DUE_BATCH_SIZE = 50;
export const AUTOMATION_STALE_MS = 6 * 60 * 60 * 1_000;
export const AUTOMATION_RETRY_WAIT_MS = 4 * 60 * 1_000;
export const AUTOMATION_MAX_ATTEMPTS = 3;

const INTERVAL_MS = Object.freeze({
  daily: 24 * 60 * 60 * 1_000,
  weekly: 7 * 24 * 60 * 60 * 1_000,
});

function sameInstant(left, right) {
  return new Date(left).getTime() === new Date(right).getTime();
}

export function nextRecurringRun(occurrenceAt, recurrence, now) {
  const interval = INTERVAL_MS[recurrence];
  if (!interval) return null;
  const occurrenceMs = new Date(occurrenceAt).getTime();
  const nowMs = now.getTime();
  const steps = Math.max(1, Math.floor((nowMs - occurrenceMs) / interval) + 1);
  return new Date(occurrenceMs + steps * interval).toISOString();
}

async function writeAudit(tx, { actorId, action, entityId, siteId, status, reason = null }) {
  await tx.unsafe(
    `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'activity_schedule', $3, $4::jsonb)`,
    [actorId || null, action, entityId, { site_id: siteId, status, ...(reason ? { reason } : {}) }],
  );
}

async function recordControlledFailure(tx, schedule, occurrenceAt, code, occurrenceStatus = "failed") {
  const status = code === "entitlement_required" ? "paused" : "failed";
  await tx.unsafe(
    `INSERT INTO activity_schedule_occurrences (
       schedule_id, occurrence_at, status, failure_code, finished_at
     ) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (schedule_id, occurrence_at)
     DO UPDATE SET status=EXCLUDED.status, failure_code=EXCLUDED.failure_code, finished_at=now()
       WHERE activity_schedule_occurrences.status <> 'succeeded'`,
    [schedule.id, occurrenceAt, occurrenceStatus, code],
  );
  await tx.unsafe(
    `UPDATE activity_schedules
        SET status=$1, last_error_code=$2, last_run_at=now(), updated_at=now()
      WHERE id=$3`,
    [status, code, schedule.id],
  );
  await writeAudit(tx, {
    actorId: schedule.created_by,
    action: code === "entitlement_required" ? "activity_schedule_entitlement_paused" : "activity_schedule_execution_failed",
    entityId: schedule.id,
    siteId: schedule.site_id,
    status,
    reason: code,
  });
  return { status, reason: code };
}

async function lockSchedule(tx, scheduleId) {
  return tx.one(
    `SELECT sch.id, sch.site_id, sch.kind, sch.config_snapshot, sch.recurrence,
            sch.next_run_at, sch.status, sch.attempt_count, sch.last_run_at,
            sch.last_error_code, sch.created_by,
            s.user_id AS owner_id, s.published, s.is_draft, s.suspended,
            owner.plan AS owner_plan, owner.plan_expires_at AS owner_plan_expires_at,
            owner.status AS owner_status,
            creator.status AS creator_status,
            member.role AS creator_role
       FROM activity_schedules sch
       JOIN sites s ON s.id=sch.site_id
       JOIN users owner ON owner.id=s.user_id
       LEFT JOIN users creator ON creator.id=sch.created_by
       LEFT JOIN site_members member
         ON member.site_id=sch.site_id AND member.user_id=sch.created_by
      WHERE sch.id=$1
      FOR UPDATE OF sch`,
    [scheduleId],
  );
}

function executionGuard(schedule, occurrenceAt, now) {
  if (!schedule || schedule.status !== "scheduled") return "not_scheduled";
  if (!sameInstant(schedule.next_run_at, occurrenceAt)) return "already_advanced";
  const dueAt = new Date(occurrenceAt).getTime();
  if (!Number.isFinite(dueAt) || dueAt > now.getTime()) return "not_due";
  if (
    Number(schedule.attempt_count) > 0
    && schedule.last_error_code === "temporary_failure"
    && schedule.last_run_at
    && now.getTime() - new Date(schedule.last_run_at).getTime() < AUTOMATION_RETRY_WAIT_MS
  ) return "retry_wait";
  return null;
}

function authorizationFailure(schedule, now) {
  if (schedule.kind !== SAFE_AUTOMATION_KIND) return "unsupported_kind";
  if (now.getTime() - new Date(schedule.next_run_at).getTime() > AUTOMATION_STALE_MS) return "stale_schedule";
  if (schedule.suspended || schedule.is_draft || !schedule.published || schedule.owner_status === "suspended") {
    return "site_unavailable";
  }
  const plan = effectivePlan({
    plan: schedule.owner_plan,
    plan_expires_at: schedule.owner_plan_expires_at,
    status: schedule.owner_status,
  }, now.getTime());
  if (!canUseAutomation(plan)) return "entitlement_required";
  if (!schedule.created_by || schedule.creator_status === "suspended" || !schedule.creator_status) {
    return "creator_unavailable";
  }
  if (schedule.created_by !== schedule.owner_id && (plan !== "team" || schedule.creator_role !== "moderator")) {
    return "creator_unauthorized";
  }
  return null;
}

export async function executeScheduleOccurrence(scheduleId, occurrenceAt, injected = {}) {
  const deps = {
    withTransaction: defaultWithTransaction,
    now: () => new Date(),
    createCodeDrop: createCanonicalCodeDrop,
    generateCode: generateScheduledDropCode,
    ...injected,
  };
  const now = deps.now();
  try {
    return await deps.withTransaction(async (tx) => {
      const schedule = await lockSchedule(tx, scheduleId);
      const guard = executionGuard(schedule, occurrenceAt, now);
      if (guard) return { status: "skipped", reason: guard };

      const failure = authorizationFailure(schedule, now);
      if (failure) {
        return recordControlledFailure(
          tx,
          schedule,
          occurrenceAt,
          failure,
          failure === "stale_schedule" ? "stale" : "failed",
        );
      }

      const config = validateCodeDropConfig(schedule.config_snapshot);
      if (!config.ok) {
        return recordControlledFailure(tx, schedule, occurrenceAt, "invalid_config");
      }

      const existing = await tx.one(
        `SELECT id, status
           FROM activity_schedule_occurrences
          WHERE schedule_id=$1 AND occurrence_at=$2`,
        [schedule.id, occurrenceAt],
      );
      if (existing?.status === "succeeded") return { status: "skipped", reason: "already_executed" };
      const occurrence = existing || await tx.one(
        `INSERT INTO activity_schedule_occurrences (schedule_id, occurrence_at, status)
         VALUES ($1, $2, 'retrying')
         RETURNING id, status`,
        [schedule.id, occurrenceAt],
      );

      const activity = await deps.createCodeDrop({
        db: tx,
        siteId: schedule.site_id,
        config: config.value,
        code: deps.generateCode(),
        occurrenceId: occurrence.id,
        now,
      });
      await tx.unsafe(
        `UPDATE activity_schedule_occurrences
            SET status='succeeded', failure_code=NULL, finished_at=now()
          WHERE id=$1`,
        [occurrence.id],
      );
      const nextRunAt = nextRecurringRun(occurrenceAt, schedule.recurrence, now);
      await tx.unsafe(
        `UPDATE activity_schedules
            SET status=$1, next_run_at=$2, attempt_count=0, last_run_at=now(),
                last_error_code=NULL, updated_at=now()
          WHERE id=$3`,
        [nextRunAt ? "scheduled" : "completed", nextRunAt || occurrenceAt, schedule.id],
      );
      await writeAudit(tx, {
        actorId: schedule.created_by,
        action: "activity_schedule_execution_succeeded",
        entityId: schedule.id,
        siteId: schedule.site_id,
        status: nextRunAt ? "scheduled" : "completed",
      });
      return { status: "executed", activityId: activity.id, nextRunAt };
    });
  } catch {
    return recordTransientFailure(scheduleId, occurrenceAt, { ...deps, now: () => now });
  }
}

async function recordTransientFailure(scheduleId, occurrenceAt, deps) {
  return deps.withTransaction(async (tx) => {
    const schedule = await lockSchedule(tx, scheduleId);
    const guard = executionGuard(schedule, occurrenceAt, deps.now());
    if (guard && guard !== "retry_wait") return { status: "skipped", reason: guard };
    if (!schedule || schedule.status !== "scheduled" || !sameInstant(schedule.next_run_at, occurrenceAt)) {
      return { status: "skipped", reason: "already_advanced" };
    }
    const nextAttempt = Math.min(AUTOMATION_MAX_ATTEMPTS, Number(schedule.attempt_count || 0) + 1);
    const terminal = nextAttempt >= AUTOMATION_MAX_ATTEMPTS;
    await tx.unsafe(
      `INSERT INTO activity_schedule_occurrences (
         schedule_id, occurrence_at, status, failure_code, finished_at
       ) VALUES ($1, $2, $3, 'temporary_failure', $4)
       ON CONFLICT (schedule_id, occurrence_at)
       DO UPDATE SET status=EXCLUDED.status, failure_code='temporary_failure', finished_at=EXCLUDED.finished_at
         WHERE activity_schedule_occurrences.status <> 'succeeded'`,
      [schedule.id, occurrenceAt, terminal ? "failed" : "retrying", terminal ? deps.now().toISOString() : null],
    );
    await tx.unsafe(
      `UPDATE activity_schedules
          SET status=$1, attempt_count=$2, last_run_at=$3,
              last_error_code='temporary_failure', updated_at=now()
        WHERE id=$4`,
      [terminal ? "failed" : "scheduled", nextAttempt, deps.now().toISOString(), schedule.id],
    );
    if (terminal) {
      await writeAudit(tx, {
        actorId: schedule.created_by,
        action: "activity_schedule_execution_failed",
        entityId: schedule.id,
        siteId: schedule.site_id,
        status: "failed",
        reason: "temporary_failure",
      });
    }
    return { status: terminal ? "failed" : "retrying", reason: "temporary_failure", attempt: nextAttempt };
  });
}

export async function runSafeActivityAutomation(_env, injected = {}) {
  const deps = {
    query: defaultQuery,
    now: () => new Date(),
    execute: executeScheduleOccurrence,
    logger: console,
    ...injected,
  };
  const now = deps.now();
  const due = await deps.query(
    `SELECT id, next_run_at
       FROM activity_schedules
      WHERE status='scheduled' AND next_run_at <= $1
      ORDER BY next_run_at ASC, id ASC
      LIMIT $2`,
    [now.toISOString(), AUTOMATION_DUE_BATCH_SIZE],
  );
  const summary = { inspected: due.length, executed: 0, skipped: 0, retrying: 0, failed: 0, paused: 0 };
  for (const schedule of due) {
    const result = await deps.execute(schedule.id, schedule.next_run_at, { now: () => now });
    if (result.status === "executed") summary.executed += 1;
    else if (result.status === "retrying") summary.retrying += 1;
    else if (result.status === "paused") summary.paused += 1;
    else if (result.status === "failed") summary.failed += 1;
    else summary.skipped += 1;
  }
  deps.logger.info("safe_activity_automation_run", summary);
  return summary;
}
