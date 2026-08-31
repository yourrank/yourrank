import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { executeScheduleOccurrence } from "../automation-scheduler.js";

const databaseUrl = process.env.AUTOMATION_TEST_DATABASE_URL || "";
const integrationIt = databaseUrl ? it : it.skip;
const ids = {
  owner: "9a6d8f0d-319c-4fcb-94bf-3e4718517c01",
  site: "9a6d8f0d-319c-4fcb-94bf-3e4718517c02",
  schedule: "9a6d8f0d-319c-4fcb-94bf-3e4718517c03",
  raceSchedule: "9a6d8f0d-319c-4fcb-94bf-3e4718517c04",
};
const occurrenceAt = "2026-08-31T11:59:00.000Z";
const now = new Date("2026-08-31T12:00:00.000Z");

describe("Wave K Postgres idempotency boundary", () => {
  let sql;
  let previousDatabaseUrl;

  beforeAll(async () => {
    if (!databaseUrl) return;
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    sql = postgres(databaseUrl, { max: 4, prepare: false });
    await sql.unsafe("DELETE FROM users WHERE id=$1", [ids.owner]);
    await sql.unsafe(
      `INSERT INTO users (id, email, plan, plan_expires_at, status)
       VALUES ($1, $2, 'pro', '2027-08-31T00:00:00.000Z', 'active')`,
      [ids.owner, "wave-k-concurrency@yourrank.test"],
    );
    await sql.unsafe(
      `INSERT INTO sites (id, user_id, slug, name, published, is_draft, suspended)
       VALUES ($1, $2, $3, 'Wave K concurrency', true, false, false)`,
      [ids.site, ids.owner, `wave-k-${Date.now()}`],
    );
    await sql.unsafe(
      `INSERT INTO activity_schedules (
         id, site_id, kind, template_name_snapshot, config_snapshot,
         recurrence, next_run_at, status, created_by
       ) VALUES ($1, $2, 'safe_code_drop', 'Concurrency proof', $3::jsonb,
                 'once', $4, 'scheduled', $5)`,
      [ids.schedule, ids.site, { pointsReward: 25, maxClaims: 10, expireMinutes: 30 }, occurrenceAt, ids.owner],
    );
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await sql.unsafe("DELETE FROM users WHERE id=$1", [ids.owner]);
    await sql.end({ timeout: 0 });
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  integrationIt("allows two real transactions to race but persists one occurrence and one Activity", async () => {
    const options = {
      now: () => now,
      generateCode: () => "YR-CONCURRENCY",
    };
    const results = await Promise.all([
      executeScheduleOccurrence(ids.schedule, occurrenceAt, options),
      executeScheduleOccurrence(ids.schedule, occurrenceAt, options),
    ]);
    const [counts] = await sql.unsafe(
      `SELECT
         (SELECT count(*)::int FROM activity_schedule_occurrences WHERE schedule_id=$1 AND status='succeeded') AS occurrences,
         (SELECT count(*)::int FROM code_drops d
            JOIN activity_schedule_occurrences o ON o.id=d.automation_occurrence_id
           WHERE o.schedule_id=$1) AS activities`,
      [ids.schedule],
    );
    expect(counts).toEqual({ occurrences: 1, activities: 1 });
    expect(results.filter((result) => result.status === "executed")).toHaveLength(1);
    expect(results.filter((result) => result.status === "skipped")).toHaveLength(1);
  });

  integrationIt("serializes execution and cancellation into one deterministic terminal result", async () => {
    await sql.unsafe(
      `INSERT INTO activity_schedules (
         id, site_id, kind, template_name_snapshot, config_snapshot,
         recurrence, next_run_at, status, created_by
       ) VALUES ($1, $2, 'safe_code_drop', 'Cancellation race', $3::jsonb,
                 'once', $4, 'scheduled', $5)`,
      [ids.raceSchedule, ids.site, { pointsReward: 25, maxClaims: 10, expireMinutes: 30 }, occurrenceAt, ids.owner],
    );
    const [execution, cancellation] = await Promise.all([
      executeScheduleOccurrence(ids.raceSchedule, occurrenceAt, {
        now: () => now,
        generateCode: () => "YR-CANCEL-RACE",
      }),
      sql.unsafe(
        `UPDATE activity_schedules
            SET status='cancelled', updated_at=now()
          WHERE id=$1 AND status IN ('scheduled','paused','failed')
          RETURNING status`,
        [ids.raceSchedule],
      ),
    ]);
    const [result] = await sql.unsafe(
      `SELECT status,
              (SELECT count(*)::int FROM code_drops d
                JOIN activity_schedule_occurrences o ON o.id=d.automation_occurrence_id
               WHERE o.schedule_id=$1) AS activities
         FROM activity_schedules WHERE id=$1`,
      [ids.raceSchedule],
    );
    const cancellationWon = cancellation.length === 1;
    expect(cancellationWon ? result : execution).toBeDefined();
    expect(
      (result.status === "cancelled" && result.activities === 0)
      || (result.status === "completed" && result.activities === 1),
    ).toBe(true);
  });
});
