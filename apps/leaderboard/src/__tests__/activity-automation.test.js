import { describe, expect, it, mock } from "bun:test";
import {
  SAFE_AUTOMATION_KIND,
  generateScheduledDropCode,
  validateCodeDropConfig,
} from "../code-drop-service.js";
import {
  automationListFromRows,
  handleCancelActivitySchedule,
  handleCreateActivitySchedule,
  handleCreateActivityTemplate,
  handleDeleteActivityTemplate,
  handleUpdateActivityTemplate,
} from "../handlers/activity-automation.js";
import {
  AUTOMATION_DUE_BATCH_SIZE,
  executeScheduleOccurrence,
  nextRecurringRun,
  runSafeActivityAutomation,
} from "../automation-scheduler.js";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const OWNER = { id: "owner-1", status: "active", plan: "pro", plan_expires_at: "2027-08-31T00:00:00.000Z" };
const SITE = { id: "site-1", user_id: OWNER.id, published: true, is_draft: false, suspended: false, slug: "creator" };

function handlerDeps(overrides = {}) {
  const calls = { inserts: [], audits: [] };
  const write = async (sql, params) => {
    if (sql.includes("INSERT INTO activity_templates")) {
      calls.inserts.push({ sql, params });
      return [{ id: "template-1", kind: SAFE_AUTOMATION_KIND, name: params[2], config: params[3] }];
    }
    if (sql.includes("INSERT INTO activity_schedules")) {
      calls.inserts.push({ sql, params });
      return [{ id: "schedule-1", status: "scheduled", config_snapshot: params[4], next_run_at: params[6] }];
    }
    if (sql.includes("DELETE FROM activity_templates")) return [{ id: "template-1", name: "Stream break" }];
    return [];
  };
  return {
    calls,
    value: {
      now: () => NOW,
      requireUser: async () => ({ user: { id: OWNER.id, status: "active" } }),
      getByUser: async () => SITE,
      getBoardById: async (_env, _userId, siteId) => siteId === SITE.id ? SITE : null,
      requireSiteCapability: async () => ({ role: "owner" }),
      rateLimit: async () => ({ ok: true }),
      logAudit: async (entry) => calls.audits.push(entry),
      exec: write,
      one: async (sql, _params) => {
        if (sql.includes("FROM users WHERE id")) return OWNER;
        if (sql.includes("FROM activity_templates")) {
          return { id: "template-1", kind: SAFE_AUTOMATION_KIND, name: "Stream break", config: { pointsReward: 50, maxClaims: 20, expireMinutes: 30 } };
        }
        return null;
      },
      ...overrides,
    },
  };
}

function jsonRequest(path, body, method = "POST") {
  return new Request(`https://yourrank.test${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Wave K safe Activity automation", () => {
  it("uses one strict canonical code-drop validator for manual and template config", () => {
    expect(validateCodeDropConfig({ code: "DROP_100", pointsReward: 100, maxClaims: 20, expireMinutes: 30 }, { requireCode: true })).toEqual({
      ok: true,
      value: { code: "DROP_100", pointsReward: 100, maxClaims: 20, expireMinutes: 30 },
    });
    expect(validateCodeDropConfig({ pointsReward: 100_001, maxClaims: 20, expireMinutes: 30 }).code).toBe("invalid_points");
    expect(validateCodeDropConfig({ code: "bad secret!", pointsReward: 1, maxClaims: 1 }, { requireCode: true }).code).toBe("invalid_code");
    expect(generateScheduledDropCode((bytes) => bytes.fill(0xab))).toBe("YR-ABABABABABABABAB");
  });

  it("creates an inert paid template and rejects arbitrary automation kinds", async () => {
    const deps = handlerDeps();
    const response = await handleCreateActivityTemplate(jsonRequest("/api/activities/templates", {
      siteId: SITE.id,
      kind: SAFE_AUTOMATION_KIND,
      name: "Stream break",
      config: { pointsReward: 50, maxClaims: 20, expireMinutes: 30 },
    }), {}, deps.value);
    expect(response.status).toBe(201);
    expect(deps.calls.inserts).toHaveLength(1);
    expect(deps.calls.inserts[0].sql).toContain("activity_templates");
    expect(deps.calls.inserts[0].sql).not.toContain("code_drops");
    expect(deps.calls.audits[0].details).not.toHaveProperty("code");

    const restricted = await handleCreateActivityTemplate(jsonRequest("/api/activities/templates", {
      siteId: SITE.id,
      kind: "prediction",
      name: "Not allowed",
      config: { pointsReward: 50, maxClaims: 20, expireMinutes: 30 },
    }), {}, deps.value);
    expect(restricted.status).toBe(400);
    expect(deps.calls.inserts).toHaveLength(1);
  });

  it("allows the canonical safe Activity capability and denies missing or cross-site authority", async () => {
    const moderator = handlerDeps({ requireSiteCapability: async () => ({ role: "moderator" }) });
    const allowed = await handleCreateActivityTemplate(jsonRequest("/api/activities/templates", {
      siteId: SITE.id,
      kind: SAFE_AUTOMATION_KIND,
      name: "Moderator template",
      config: { pointsReward: 25, maxClaims: 5, expireMinutes: 15 },
    }), {}, moderator.value);
    expect(allowed.status).toBe(201);

    const denied = handlerDeps({
      requireSiteCapability: async () => ({ role: null, res: new Response("denied", { status: 403 }) }),
    });
    expect((await handleCreateActivityTemplate(jsonRequest("/api/activities/templates", {
      siteId: SITE.id,
      kind: SAFE_AUTOMATION_KIND,
      name: "Denied",
      config: { pointsReward: 25, maxClaims: 5, expireMinutes: 15 },
    }), {}, denied.value)).status).toBe(403);

    const substituted = handlerDeps();
    expect((await handleCreateActivityTemplate(jsonRequest("/api/activities/templates", {
      siteId: "site-other",
      kind: SAFE_AUTOMATION_KIND,
      name: "Wrong site",
      config: { pointsReward: 25, maxClaims: 5, expireMinutes: 15 },
    }), {}, substituted.value)).status).toBe(404);
    expect(substituted.calls.inserts).toHaveLength(0);
  });

  it("revalidates edits and rejects oversized, malicious recurrence, and unsafe schedule input", async () => {
    const edits = [];
    const deps = handlerDeps({
      exec: async (sql, params) => {
        edits.push({ sql, params });
        if (sql.includes("UPDATE activity_templates")) return [{ id: "template-1", kind: SAFE_AUTOMATION_KIND, name: params[0], config: params[1] }];
        return [];
      },
    });
    const invalidEdit = await handleUpdateActivityTemplate(jsonRequest("/api/activities/templates", {
      siteId: SITE.id,
      templateId: "template-1",
      kind: SAFE_AUTOMATION_KIND,
      name: "Edited",
      config: { pointsReward: -1, maxClaims: 5, expireMinutes: 15 },
    }, "PUT"), {}, deps.value);
    expect(invalidEdit.status).toBe(400);
    expect(edits).toHaveLength(0);

    const validEdit = await handleUpdateActivityTemplate(jsonRequest("/api/activities/templates", {
      siteId: SITE.id,
      templateId: "template-1",
      kind: SAFE_AUTOMATION_KIND,
      name: "Edited",
      config: { pointsReward: 30, maxClaims: 5, expireMinutes: 15 },
    }, "PUT"), {}, deps.value);
    expect(validEdit.status).toBe(200);
    expect(edits).toHaveLength(1);

    const huge = new Request("https://yourrank.test/api/activities/templates", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "20000" },
      body: JSON.stringify({ siteId: SITE.id, padding: "x".repeat(17_000) }),
    });
    expect((await handleCreateActivityTemplate(huge, {}, deps.value)).status).toBe(413);

    for (const body of [
      { recurrence: "hourly", runAt: "2026-09-01T12:00:00.000Z" },
      { recurrence: "daily", runAt: "2026-08-31T12:00:30.000Z" },
      { recurrence: "weekly", runAt: "2028-09-01T12:00:00.000Z" },
    ]) {
      const response = await handleCreateActivitySchedule(jsonRequest("/api/activities/schedules", {
        siteId: SITE.id,
        templateId: "template-1",
        ...body,
      }), {}, deps.value);
      expect(response.status).toBe(400);
    }
  });

  it("keeps Free manual Activities available while denying new automation and preserving deletion", async () => {
    const deps = handlerDeps({
      one: async (sql) => {
        if (sql.includes("FROM users WHERE id")) return { ...OWNER, plan: "free", plan_expires_at: null };
        return null;
      },
      exec: async (sql) => sql.includes("DELETE FROM activity_templates") ? [{ id: "template-1", name: "Saved" }] : [],
    });
    const create = await handleCreateActivityTemplate(jsonRequest("/api/activities/templates", {
      siteId: SITE.id,
      kind: SAFE_AUTOMATION_KIND,
      name: "Saved",
      config: { pointsReward: 10, maxClaims: 5, expireMinutes: 0 },
    }), {}, deps.value);
    expect(create.status).toBe(403);

    const remove = await handleDeleteActivityTemplate(jsonRequest("/api/activities/templates/delete", {
      siteId: SITE.id,
      templateId: "template-1",
    }), {}, deps.value);
    expect(remove.status).toBe(200);
  });

  it("snapshots a site-scoped template into an exact future UTC schedule", async () => {
    const deps = handlerDeps();
    const response = await handleCreateActivitySchedule(jsonRequest("/api/activities/schedules", {
      siteId: SITE.id,
      templateId: "template-1",
      recurrence: "daily",
      runAt: "2026-09-01T12:00:00.000Z",
    }), {}, deps.value);
    expect(response.status).toBe(201);
    const insert = deps.calls.inserts.find((call) => call.sql.includes("activity_schedules"));
    expect(insert.params[4]).toEqual({ pointsReward: 50, maxClaims: 20, expireMinutes: 30 });
    expect(insert.params[6]).toBe("2026-09-01T12:00:00.000Z");

    const malicious = await handleCreateActivitySchedule(jsonRequest("/api/activities/schedules", {
      siteId: SITE.id,
      templateId: "template-1",
      kind: "raffle",
      recurrence: "daily",
      runAt: "2026-09-01T12:00:00.000Z",
    }), {}, deps.value);
    expect(malicious.status).toBe(400);
  });

  it("cancels without deleting audit history and does not expose generated codes in automation lists", async () => {
    const writes = [];
    const deps = handlerDeps({
      exec: async (sql, params) => {
        writes.push({ sql, params });
        if (sql.includes("UPDATE activity_schedules")) return [{ id: "schedule-1", status: "cancelled", recurrence: "weekly" }];
        return [];
      },
    });
    const response = await handleCancelActivitySchedule(jsonRequest("/api/activities/schedules/cancel", {
      siteId: SITE.id,
      scheduleId: "schedule-1",
    }), {}, deps.value);
    expect(response.status).toBe(200);
    expect(writes[0].sql).toContain("SET status='cancelled'");
    expect(writes[0].sql).not.toMatch(/DELETE/i);
    expect(deps.calls.audits[0].action).toBe("activity_recurrence_disabled");

    const listed = automationListFromRows({
      plan: "pro",
      templates: [{ id: "template-1", kind: SAFE_AUTOMATION_KIND, name: "Safe", config: { pointsReward: 1, maxClaims: 1, expireMinutes: 0 } }],
      schedules: [{ id: "schedule-1", kind: SAFE_AUTOMATION_KIND, template_name_snapshot: "Safe", config_snapshot: { pointsReward: 1, maxClaims: 1, expireMinutes: 0 }, recurrence: "once", next_run_at: NOW.toISOString(), status: "scheduled" }],
    });
    expect(JSON.stringify(listed)).not.toMatch(/YR-[A-Z0-9]|secret|claimCode/i);
    expect(listed.announcements).toBe("deferred_communication_not_ready");
  });

  it("computes fixed UTC recurrence without generating a backlog", () => {
    expect(nextRecurringRun("2026-08-31T10:00:00.000Z", "daily", NOW)).toBe("2026-09-01T10:00:00.000Z");
    expect(nextRecurringRun("2026-08-20T12:00:00.000Z", "weekly", NOW)).toBe("2026-09-03T12:00:00.000Z");
    expect(nextRecurringRun("2026-08-31T10:00:00.000Z", "once", NOW)).toBeNull();
  });

  it("bounds and orders every due-job scan", async () => {
    const query = mock().mockResolvedValue([]);
    const logger = { info: mock() };
    const summary = await runSafeActivityAutomation({}, { query, logger, now: () => NOW });
    expect(summary.inspected).toBe(0);
    expect(query.mock.calls[0][0]).toContain("ORDER BY next_run_at ASC, id ASC");
    expect(query.mock.calls[0][0]).toContain("LIMIT $2");
    expect(query.mock.calls[0][1]).toEqual([NOW.toISOString(), AUTOMATION_DUE_BATCH_SIZE]);
    expect(logger.info).toHaveBeenCalledWith("safe_activity_automation_run", summary);
  });

  it("serializes concurrent executors so one occurrence creates one Activity", async () => {
    const state = {
      schedule: {
        id: "schedule-1", site_id: SITE.id, kind: SAFE_AUTOMATION_KIND,
        config_snapshot: { pointsReward: 50, maxClaims: 20, expireMinutes: 30 },
        recurrence: "once", next_run_at: "2026-08-31T11:59:00.000Z", status: "scheduled",
        attempt_count: 0, last_run_at: null, last_error_code: null, created_by: OWNER.id,
        owner_id: OWNER.id, published: true, is_draft: false, suspended: false,
        owner_plan: "pro", owner_plan_expires_at: OWNER.plan_expires_at, owner_status: "active",
        creator_status: "active", creator_role: null,
      },
      occurrence: null,
      activities: 0,
    };
    const tx = {
      one: async (sql) => {
        if (sql.includes("FROM activity_schedules sch")) return { ...state.schedule };
        if (sql.includes("FROM activity_schedule_occurrences")) return state.occurrence;
        if (sql.includes("INSERT INTO activity_schedule_occurrences")) {
          state.occurrence = { id: "occurrence-1", status: "retrying" };
          return state.occurrence;
        }
        return null;
      },
      unsafe: async (sql, params) => {
        if (sql.includes("UPDATE activity_schedule_occurrences") && sql.includes("succeeded")) state.occurrence.status = "succeeded";
        if (sql.includes("UPDATE activity_schedules") && sql.includes("attempt_count=0")) state.schedule.status = params[0];
        return [];
      },
    };
    let tail = Promise.resolve();
    const withTransaction = async (fn) => {
      const previous = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      await previous;
      try { return await fn(tx); } finally { release(); }
    };
    const createCodeDrop = async () => {
      state.activities += 1;
      await Promise.resolve();
      return { id: "drop-1" };
    };
    const args = { withTransaction, createCodeDrop, generateCode: () => "YR-ONE", now: () => NOW };
    const results = await Promise.all([
      executeScheduleOccurrence("schedule-1", state.schedule.next_run_at, args),
      executeScheduleOccurrence("schedule-1", state.schedule.next_run_at, args),
    ]);
    expect(state.activities).toBe(1);
    expect(results.map((result) => result.status).sort()).toEqual(["executed", "skipped"]);
  });

  it("creates separate canonical Activities for separate fixed-UTC recurrence occurrences", async () => {
    const state = {
      schedule: {
        id: "schedule-recurring", site_id: SITE.id, kind: SAFE_AUTOMATION_KIND,
        config_snapshot: { pointsReward: 10, maxClaims: 2, expireMinutes: 15 },
        recurrence: "daily", next_run_at: "2026-08-31T11:59:00.000Z", status: "scheduled",
        attempt_count: 0, last_run_at: null, last_error_code: null, created_by: OWNER.id,
        owner_id: OWNER.id, published: true, is_draft: false, suspended: false,
        owner_plan: "pro", owner_plan_expires_at: OWNER.plan_expires_at, owner_status: "active",
        creator_status: "active", creator_role: null,
      },
      occurrences: new Map(),
      activities: [],
    };
    const tx = {
      one: async (sql, params) => {
        if (sql.includes("FROM activity_schedules sch")) return { ...state.schedule };
        if (sql.includes("FROM activity_schedule_occurrences")) return state.occurrences.get(String(params[1])) || null;
        if (sql.includes("INSERT INTO activity_schedule_occurrences")) {
          const row = { id: `occurrence-${state.occurrences.size + 1}`, status: "retrying" };
          state.occurrences.set(String(params[1]), row);
          return row;
        }
        return null;
      },
      unsafe: async (sql, params) => {
        if (sql.includes("UPDATE activity_schedule_occurrences") && sql.includes("succeeded")) {
          for (const row of state.occurrences.values()) if (row.id === params[0]) row.status = "succeeded";
        }
        if (sql.includes("UPDATE activity_schedules") && sql.includes("attempt_count=0")) {
          state.schedule.status = params[0];
          state.schedule.next_run_at = params[1];
        }
        return [];
      },
    };
    const createCodeDrop = async ({ occurrenceId }) => {
      state.activities.push(occurrenceId);
      return { id: `drop-${state.activities.length}` };
    };
    const firstAt = state.schedule.next_run_at;
    const first = await executeScheduleOccurrence(state.schedule.id, firstAt, {
      now: () => NOW, withTransaction: async (fn) => fn(tx), createCodeDrop, generateCode: () => "YR-FIRST",
    });
    const secondAt = state.schedule.next_run_at;
    const secondNow = new Date("2026-09-01T12:00:00.000Z");
    const second = await executeScheduleOccurrence(state.schedule.id, secondAt, {
      now: () => secondNow, withTransaction: async (fn) => fn(tx), createCodeDrop, generateCode: () => "YR-SECOND",
    });
    expect(first.status).toBe("executed");
    expect(second.status).toBe("executed");
    expect(state.activities).toEqual(["occurrence-1", "occurrence-2"]);
    expect(state.schedule.next_run_at).toBe("2026-09-02T11:59:00.000Z");
  });

  it("bounds transient retries and cannot create or retry after terminal failure", async () => {
    const state = {
      schedule: {
        id: "schedule-retry", site_id: SITE.id, kind: SAFE_AUTOMATION_KIND,
        config_snapshot: { pointsReward: 10, maxClaims: 2, expireMinutes: 15 }, recurrence: "once",
        next_run_at: "2026-08-31T11:59:00.000Z", status: "scheduled", attempt_count: 0,
        last_run_at: null, last_error_code: null, created_by: OWNER.id, owner_id: OWNER.id,
        published: true, is_draft: false, suspended: false, owner_plan: "pro",
        owner_plan_expires_at: OWNER.plan_expires_at, owner_status: "active", creator_status: "active", creator_role: null,
      },
      occurrence: null,
      audits: [],
    };
    const tx = {
      one: async (sql) => {
        if (sql.includes("FROM activity_schedules sch")) return { ...state.schedule };
        if (sql.includes("FROM activity_schedule_occurrences")) return state.occurrence;
        if (sql.includes("INSERT INTO activity_schedule_occurrences")) {
          state.occurrence = { id: "occurrence-retry", status: "retrying" };
          return state.occurrence;
        }
        return null;
      },
      unsafe: async (sql, params) => {
        if (sql.includes("INSERT INTO activity_schedule_occurrences") && sql.includes("temporary_failure")) {
          state.occurrence = { id: "occurrence-retry", status: params[2] };
        }
        if (sql.includes("UPDATE activity_schedules") && sql.includes("attempt_count=$2")) {
          state.schedule.status = params[0];
          state.schedule.attempt_count = params[1];
          state.schedule.last_run_at = params[2];
          state.schedule.last_error_code = "temporary_failure";
        }
        if (sql.includes("INSERT INTO audit_log")) state.audits.push(params[4]);
        return [];
      },
    };
    let now = new Date(NOW);
    const args = {
      now: () => now,
      withTransaction: async (fn) => fn(tx),
      createCodeDrop: async () => { throw new Error("temporary database outage"); },
      generateCode: () => "YR-NEVER-LOG-ME",
    };
    const results = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      results.push(await executeScheduleOccurrence(state.schedule.id, state.schedule.next_run_at, args));
      now = new Date(now.getTime() + 5 * 60_000);
    }
    expect(results.map((result) => result.status)).toEqual(["retrying", "retrying", "failed"]);
    expect(state.schedule.attempt_count).toBe(3);
    expect((await executeScheduleOccurrence(state.schedule.id, state.schedule.next_run_at, args))).toMatchObject({ status: "skipped", reason: "not_scheduled" });
    expect(JSON.stringify(state.audits)).not.toContain("YR-NEVER-LOG-ME");
  });

  it("fails stale runs and pauses entitlement-ineligible runs without creating an Activity", async () => {
    async function executeWith(overrides) {
      const schedule = {
        id: "schedule-1", site_id: SITE.id, kind: SAFE_AUTOMATION_KIND,
        config_snapshot: { pointsReward: 1, maxClaims: 1, expireMinutes: 0 }, recurrence: "once",
        next_run_at: "2026-08-31T05:00:00.000Z", status: "scheduled", attempt_count: 0,
        created_by: OWNER.id, owner_id: OWNER.id, published: true, is_draft: false, suspended: false,
        owner_plan: "pro", owner_plan_expires_at: OWNER.plan_expires_at, owner_status: "active",
        creator_status: "active", creator_role: null,
        ...overrides,
      };
      const tx = {
        one: async (sql) => sql.includes("FROM activity_schedules sch") ? schedule : null,
        unsafe: async () => [],
      };
      return executeScheduleOccurrence(schedule.id, schedule.next_run_at, {
        now: () => NOW,
        withTransaction: async (fn) => fn(tx),
        createCodeDrop: async () => { throw new Error("must not create"); },
      });
    }
    expect(await executeWith({})).toMatchObject({ status: "failed", reason: "stale_schedule" });
    expect(await executeWith({
      next_run_at: "2026-08-31T11:59:00.000Z",
      owner_plan: "free",
      owner_plan_expires_at: null,
    })).toMatchObject({ status: "paused", reason: "entitlement_required" });
    expect(await executeWith({
      next_run_at: "2026-08-31T11:59:00.000Z",
      created_by: "moderator-removed",
      creator_role: null,
    })).toMatchObject({ status: "failed", reason: "creator_unauthorized" });
    expect(await executeWith({
      next_run_at: "2026-08-31T11:59:00.000Z",
      is_draft: true,
    })).toMatchObject({ status: "failed", reason: "site_unavailable" });
    expect(await executeWith({
      next_run_at: "2026-08-31T11:59:00.000Z",
      status: "cancelled",
    })).toMatchObject({ status: "skipped", reason: "not_scheduled" });
  });
});
