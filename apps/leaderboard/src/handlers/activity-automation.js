import {
  one as defaultOne,
  query as defaultQuery,
  exec as defaultExec,
} from "@yourrank/shared/db";
import { effectivePlan, canUseAutomation } from "@yourrank/shared/plans";
import { rateLimit as defaultRateLimit } from "@yourrank/shared/ratelimit";
import { logAudit as defaultLogAudit } from "@yourrank/shared/audit";
import { requireUser as defaultRequireUser, bad, json, readJsonLimited } from "../auth.js";
import { getByUser as defaultGetByUser, getBoardById as defaultGetBoardById } from "../site.js";
import { requireSiteCapability as defaultRequireSiteCapability } from "../site-authorization.js";
import { SAFE_AUTOMATION_KIND, validateCodeDropConfig } from "../code-drop-service.js";

export const AUTOMATION_BODY_LIMIT = 16_384;
export const AUTOMATION_HORIZON_MS = 365 * 24 * 60 * 60 * 1_000;
export const AUTOMATION_MIN_LEAD_MS = 60_000;
export const AUTOMATION_RECURRENCES = new Set(["once", "daily", "weekly"]);

const defaults = {
  one: defaultOne,
  query: defaultQuery,
  exec: defaultExec,
  rateLimit: defaultRateLimit,
  logAudit: defaultLogAudit,
  requireUser: defaultRequireUser,
  getByUser: defaultGetByUser,
  getBoardById: defaultGetBoardById,
  requireSiteCapability: defaultRequireSiteCapability,
  now: () => new Date(),
};

const privateOk = (data, status = 200) => json(
  { ok: true, ...data },
  status,
  { "cache-control": "no-store, no-cache, must-revalidate" },
);

async function writeOne(deps, sql, params) {
  return (await deps.exec(sql, params))[0];
}

function safeName(value) {
  const name = String(value || "").trim();
  if (!name || name.length > 80) return null;
  return name;
}

function safeKind(value) {
  return value === SAFE_AUTOMATION_KIND;
}

function creatorMessage(errorCode) {
  return {
    entitlement_required: "Automation is paused because this site no longer has Pro or Team.",
    creator_unauthorized: "The operator who created this schedule no longer has Activity access.",
    creator_unavailable: "The operator who created this schedule is no longer active.",
    site_unavailable: "This site is not live, so the schedule did not run.",
    stale_schedule: "This run was more than six hours late and needs a new future time.",
    invalid_config: "The saved Activity settings are no longer valid.",
    unsupported_kind: "This Activity type is not supported by Automation.",
    temporary_failure: "The run could not complete after three safe attempts.",
  }[errorCode] || null;
}

export function automationListFromRows({ templates = [], schedules = [], plan }) {
  const cleanTemplates = templates.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    config: row.config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  const cleanSchedules = schedules.map((row) => ({
    id: row.id,
    kind: row.kind,
    templateId: row.template_id,
    templateName: row.template_name_snapshot,
    config: row.config_snapshot,
    recurrence: row.recurrence,
    nextRunAt: row.next_run_at,
    status: row.status,
    lastRunAt: row.last_run_at,
    failureCode: row.last_error_code || null,
    attentionMessage: creatorMessage(row.last_error_code),
    createdAt: row.created_at,
  }));
  return {
    entitlement: {
      plan,
      canAutomate: canUseAutomation(plan),
      message: canUseAutomation(plan)
        ? null
        : "Manual code drops remain available. Templates and scheduling require Pro or Team.",
    },
    kinds: [SAFE_AUTOMATION_KIND],
    templateSemantics: "snapshot_on_schedule",
    timezone: "UTC",
    templates: cleanTemplates,
    schedules: cleanSchedules,
    comingNext: cleanSchedules.find((item) => item.status === "scheduled") || null,
    needsAttention: cleanSchedules.filter((item) => ["paused", "failed"].includes(item.status)).slice(0, 5),
    announcements: "deferred_communication_not_ready",
  };
}

async function resolveSite(request, env, user, deps, body = null) {
  const url = new URL(request.url);
  const siteId = String(body?.siteId || url.searchParams.get("siteId") || "").trim();
  return siteId
    ? deps.getBoardById(env, user.id, siteId)
    : deps.getByUser(env, user.id);
}

async function ownerPlan(site, deps, now) {
  const owner = await deps.one(
    "SELECT id, plan, plan_expires_at, status FROM users WHERE id=$1",
    [site.user_id],
  );
  return { owner, plan: effectivePlan(owner, now.getTime()) };
}

async function authorize(request, env, deps, { body = null, mutate = false, requirePaid = false } = {}) {
  const { user, res } = await deps.requireUser(request, env);
  if (res) return { res };
  const site = await resolveSite(request, env, user, deps, body);
  if (!site) return { res: bad("Site not found.", 404) };
  const authorization = await deps.requireSiteCapability(user, site, "canRoleManageActivities");
  if (authorization.res) return { res: authorization.res };
  const limit = mutate ? 30 : 60;
  if (!(await deps.rateLimit(env, `activity-automation:${user.id}:${site.id}`, limit, 60)).ok) {
    return { res: bad("Too many requests.", 429) };
  }
  const now = deps.now();
  const entitlement = await ownerPlan(site, deps, now);
  if (!entitlement.owner || entitlement.owner.status === "suspended") {
    return { res: bad("Site owner is unavailable.", 403) };
  }
  if (requirePaid && !canUseAutomation(entitlement.plan)) {
    return { res: bad("Activity automation requires Pro or Team. Your saved configuration remains available.", 403) };
  }
  if (requirePaid && (site.suspended || site.is_draft || !site.published)) {
    return { res: bad("Publish this site before scheduling an Activity.", 409) };
  }
  return { user, site, role: authorization.role, now, ...entitlement };
}

async function readBody(request) {
  const parsed = await readJsonLimited(request, AUTOMATION_BODY_LIMIT);
  if (parsed.tooLarge) return { res: bad("Automation configuration is too large.", 413) };
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return { res: bad("A JSON object is required.") };
  }
  return { body: parsed.value };
}

export async function listActivityAutomation(siteId, { query = defaultQuery, one = defaultOne, now = new Date() } = {}) {
  const [owner, templates, schedules] = await Promise.all([
    one(
      `SELECT u.plan, u.plan_expires_at, u.status
         FROM sites s JOIN users u ON u.id=s.user_id
        WHERE s.id=$1`,
      [siteId],
    ),
    query(
      `SELECT id, kind, name, config, created_at, updated_at
         FROM activity_templates
        WHERE site_id=$1
        ORDER BY updated_at DESC, id
        LIMIT 50`,
      [siteId],
    ),
    query(
      `SELECT id, template_id, kind, template_name_snapshot, config_snapshot,
              recurrence, next_run_at, status, last_run_at, last_error_code, created_at
         FROM activity_schedules
        WHERE site_id=$1
        ORDER BY CASE WHEN status='scheduled' THEN 0 WHEN status IN ('paused','failed') THEN 1 ELSE 2 END,
                 next_run_at ASC, id
        LIMIT 50`,
      [siteId],
    ),
  ]);
  return automationListFromRows({
    templates: templates || [],
    schedules: schedules || [],
    plan: effectivePlan(owner, now.getTime()),
  });
}

export async function handleCreateActivityTemplate(request, env, injected = {}) {
  const deps = { ...defaults, ...injected };
  const parsed = await readBody(request);
  if (parsed.res) return parsed.res;
  const body = parsed.body;
  if (!safeKind(body.kind)) return bad("Only safe code-drop Activities can be automated.");
  const name = safeName(body.name);
  if (!name) return bad("Template name must be 1–80 characters.");
  const config = validateCodeDropConfig(body.config);
  if (!config.ok) return bad(config.error);
  const auth = await authorize(request, env, deps, { body, mutate: true, requirePaid: true });
  if (auth.res) return auth.res;
  const template = await writeOne(deps,
    `INSERT INTO activity_templates (site_id, kind, name, config, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id, kind, name, config, created_at, updated_at`,
    [auth.site.id, SAFE_AUTOMATION_KIND, name, config.value, auth.user.id],
  );
  await deps.logAudit({
    actorId: auth.user.id,
    action: "activity_template_created",
    entityType: "activity_template",
    entityId: template.id,
    request,
    details: { site_id: auth.site.id, name },
  });
  return privateOk({ template }, 201);
}

export async function handleUpdateActivityTemplate(request, env, injected = {}) {
  const deps = { ...defaults, ...injected };
  const parsed = await readBody(request);
  if (parsed.res) return parsed.res;
  const body = parsed.body;
  const templateId = String(body.templateId || "").trim();
  if (!templateId) return bad("Template is required.");
  if (!safeKind(body.kind)) return bad("Only safe code-drop Activities can be automated.");
  const name = safeName(body.name);
  if (!name) return bad("Template name must be 1–80 characters.");
  const config = validateCodeDropConfig(body.config);
  if (!config.ok) return bad(config.error);
  const auth = await authorize(request, env, deps, { body, mutate: true, requirePaid: true });
  if (auth.res) return auth.res;
  const template = await writeOne(deps,
    `UPDATE activity_templates
        SET name=$1, config=$2::jsonb, updated_at=now()
      WHERE id=$3 AND site_id=$4 AND kind=$5
      RETURNING id, kind, name, config, created_at, updated_at`,
    [name, config.value, templateId, auth.site.id, SAFE_AUTOMATION_KIND],
  );
  if (!template) return bad("Template not found.", 404);
  await deps.logAudit({
    actorId: auth.user.id,
    action: "activity_template_updated",
    entityType: "activity_template",
    entityId: template.id,
    request,
    details: { site_id: auth.site.id, name },
  });
  return privateOk({ template });
}

export async function handleDeleteActivityTemplate(request, env, injected = {}) {
  const deps = { ...defaults, ...injected };
  const parsed = await readBody(request);
  if (parsed.res) return parsed.res;
  const body = parsed.body;
  const templateId = String(body.templateId || "").trim();
  if (!templateId) return bad("Template is required.");
  const auth = await authorize(request, env, deps, { body, mutate: true });
  if (auth.res) return auth.res;
  const deleted = await writeOne(deps,
    "DELETE FROM activity_templates WHERE id=$1 AND site_id=$2 RETURNING id, name",
    [templateId, auth.site.id],
  );
  if (!deleted) return bad("Template not found.", 404);
  await deps.logAudit({
    actorId: auth.user.id,
    action: "activity_template_deleted",
    entityType: "activity_template",
    entityId: deleted.id,
    request,
    details: { site_id: auth.site.id, name: deleted.name },
  });
  return privateOk({ deleted: true });
}

function parseFutureRunAt(value, now) {
  const runAt = new Date(value);
  if (!value || Number.isNaN(runAt.getTime())) {
    return { error: "Choose a valid future date and time." };
  }
  const delta = runAt.getTime() - now.getTime();
  if (delta < AUTOMATION_MIN_LEAD_MS) return { error: "Choose a time at least one minute from now." };
  if (delta > AUTOMATION_HORIZON_MS) return { error: "Choose a time within the next 365 days." };
  return { value: runAt.toISOString() };
}

export async function handleCreateActivitySchedule(request, env, injected = {}) {
  const deps = { ...defaults, ...injected };
  const parsed = await readBody(request);
  if (parsed.res) return parsed.res;
  const body = parsed.body;
  if (body.kind !== undefined && !safeKind(body.kind)) {
    return bad("Only safe code-drop Activities can be automated.");
  }
  const templateId = String(body.templateId || "").trim();
  const recurrence = String(body.recurrence || "once");
  if (!templateId) return bad("Choose a template.");
  if (!AUTOMATION_RECURRENCES.has(recurrence)) return bad("Choose one-time, daily, or weekly recurrence.");
  const auth = await authorize(request, env, deps, { body, mutate: true, requirePaid: true });
  if (auth.res) return auth.res;
  const runAt = parseFutureRunAt(body.runAt, auth.now);
  if (runAt.error) return bad(runAt.error);
  const template = await deps.one(
    `SELECT id, kind, name, config
       FROM activity_templates
      WHERE id=$1 AND site_id=$2`,
    [templateId, auth.site.id],
  );
  if (!template) return bad("Template not found.", 404);
  if (!safeKind(template.kind)) return bad("This template type cannot be automated.");
  const config = validateCodeDropConfig(template.config);
  if (!config.ok) return bad(config.error);
  const schedule = await writeOne(deps,
    `INSERT INTO activity_schedules (
       site_id, template_id, kind, template_name_snapshot, config_snapshot,
       recurrence, next_run_at, created_by
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
     RETURNING id, template_id, kind, template_name_snapshot, config_snapshot,
               recurrence, next_run_at, status, created_at`,
    [auth.site.id, template.id, SAFE_AUTOMATION_KIND, template.name, config.value, recurrence, runAt.value, auth.user.id],
  );
  await deps.logAudit({
    actorId: auth.user.id,
    action: "activity_schedule_created",
    entityType: "activity_schedule",
    entityId: schedule.id,
    request,
    details: { site_id: auth.site.id, name: template.name, status: "scheduled" },
  });
  return privateOk({ schedule }, 201);
}

export async function handleCancelActivitySchedule(request, env, injected = {}) {
  const deps = { ...defaults, ...injected };
  const parsed = await readBody(request);
  if (parsed.res) return parsed.res;
  const body = parsed.body;
  const scheduleId = String(body.scheduleId || "").trim();
  if (!scheduleId) return bad("Schedule is required.");
  const auth = await authorize(request, env, deps, { body, mutate: true });
  if (auth.res) return auth.res;
  const schedule = await writeOne(deps,
    `UPDATE activity_schedules
        SET status='cancelled', last_error_code=NULL, updated_at=now()
      WHERE id=$1 AND site_id=$2 AND status IN ('scheduled','paused','failed')
      RETURNING id, status, recurrence`,
    [scheduleId, auth.site.id],
  );
  if (!schedule) return bad("This schedule is no longer cancellable.", 409);
  await deps.logAudit({
    actorId: auth.user.id,
    action: schedule.recurrence === "once" ? "activity_schedule_cancelled" : "activity_recurrence_disabled",
    entityType: "activity_schedule",
    entityId: schedule.id,
    request,
    details: { site_id: auth.site.id, status: "cancelled" },
  });
  return privateOk({ schedule });
}

export async function handleResumeActivitySchedule(request, env, injected = {}) {
  const deps = { ...defaults, ...injected };
  const parsed = await readBody(request);
  if (parsed.res) return parsed.res;
  const body = parsed.body;
  const scheduleId = String(body.scheduleId || "").trim();
  if (!scheduleId) return bad("Schedule is required.");
  const auth = await authorize(request, env, deps, { body, mutate: true, requirePaid: true });
  if (auth.res) return auth.res;
  const runAt = parseFutureRunAt(body.runAt, auth.now);
  if (runAt.error) return bad(runAt.error);
  const schedule = await writeOne(deps,
    `UPDATE activity_schedules
        SET status='scheduled', next_run_at=$1, attempt_count=0,
            last_error_code=NULL, updated_at=now()
      WHERE id=$2 AND site_id=$3 AND status IN ('paused','failed')
      RETURNING id, status, next_run_at, recurrence`,
    [runAt.value, scheduleId, auth.site.id],
  );
  if (!schedule) return bad("Only a paused or failed schedule can be rescheduled.", 409);
  await deps.logAudit({
    actorId: auth.user.id,
    action: "activity_schedule_rescheduled",
    entityType: "activity_schedule",
    entityId: schedule.id,
    request,
    details: { site_id: auth.site.id, status: "scheduled" },
  });
  return privateOk({ schedule });
}
