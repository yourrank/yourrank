// Backup health and restore-verification recording.
//
// `/api/health/backup` is the signal the uptime monitor and release gates use to
// prove that recovery still works. It is green only for a fresh, valid,
// successful restore verification; every other state (none, stale, future-dated,
// unverifiable) is 503. Recording a verification changes that operational signal,
// so it requires fresh admin step-up 2FA and is audit-logged.
import { exec, one, query } from "@yourrank/shared/db";
import { logAudit } from "@yourrank/shared/audit";
import { json, bad, readJson } from "../auth.js";
import { requireAdminWith2fa } from "../admin.js";

// Mirrors the tolerance enforced database-side by
// app_private.validate_backup_verification (migration 20260909000000).
export const BACKUP_CLOCK_SKEW_MS = 5 * 60_000;
export const BACKUP_EVIDENCE_KEYS = Object.freeze([
  "workflowRunId",
  "workflowRunUrl",
  "sourceBackupId",
  "sourceBackupCreatedAt",
  "restoreTargetId",
  "restoreTargetRetired",
  "integrityChecks",
  "applicationReadChecks",
  "measuredRtoSeconds",
  "measuredRpoSeconds",
]);

const SECRET_PATTERNS = [
  /postgres(?:ql)?:\/\//i,
  /:\/\/[^/\s]*:[^/\s]*@/i,
  /\b(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|bearer)\b\s*[:=]/i,
  /\bsb[pa]_[A-Za-z0-9]{8,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

const defaults = { one, query, exec, requireAdminWith2fa, logAudit };

export function backupVerificationLimitHours(env = {}) {
  const parsed = Number(env.BACKUP_VERIFICATION_LIMIT_HOURS ?? 168);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 168;
}

export function containsSecretMaterial(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "object") return Object.entries(value).some(([k, v]) => containsSecretMaterial(k) || containsSecretMaterial(v));
  const text = String(value);
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function parseDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function nonNegativeInteger(value) {
  if (value === undefined || value === null) return null;
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

// Pure validation of an operator/workflow-supplied verification. `now` is the
// server clock; client timestamps are metadata and may never move freshness
// into the future.
export function validateBackupVerificationInput(body, now = Date.now()) {
  const provider = String(body?.provider || "").trim();
  const target = String(body?.target || "").trim();
  if (!provider || !target) return { error: "provider and target are required" };
  if (provider.length > 100 || target.length > 200) return { error: "provider or target is too long" };
  if (containsSecretMaterial(provider) || containsSecretMaterial(target)) {
    return { error: "provider/target must be identifiers, not credentials or connection strings" };
  }

  const completedAt = parseDate(body?.completedAt);
  if (!completedAt) return { error: "completedAt is required" };
  if (completedAt.getTime() > now + BACKUP_CLOCK_SKEW_MS) {
    return { error: `completedAt is in the future (tolerance ${BACKUP_CLOCK_SKEW_MS / 1000}s)` };
  }
  const startedAt = parseDate(body?.startedAt);
  if (startedAt === undefined) return { error: "startedAt is invalid" };
  if (startedAt && startedAt.getTime() > completedAt.getTime()) return { error: "startedAt is after completedAt" };

  const rtoSeconds = nonNegativeInteger(body?.rtoSeconds);
  if (rtoSeconds === undefined) return { error: "rtoSeconds must be a non-negative integer" };
  const rpoSeconds = nonNegativeInteger(body?.rpoSeconds);
  if (rpoSeconds === undefined) return { error: "rpoSeconds must be a non-negative integer" };

  const notes = body?.notes ? String(body.notes).slice(0, 2000) : null;
  if (containsSecretMaterial(notes)) return { error: "notes must not contain credentials" };

  const releaseSha = body?.releaseSha ? String(body.releaseSha).trim() : null;
  if (releaseSha && !/^[0-9a-f]{7,40}$/i.test(releaseSha)) return { error: "releaseSha is invalid" };

  let evidence = null;
  if (body?.evidence !== undefined && body?.evidence !== null) {
    if (typeof body.evidence !== "object" || Array.isArray(body.evidence)) return { error: "evidence must be an object" };
    const unknown = Object.keys(body.evidence).filter((key) => !BACKUP_EVIDENCE_KEYS.includes(key));
    if (unknown.length) return { error: `evidence contains unsupported keys: ${unknown.join(", ")}` };
    if (containsSecretMaterial(body.evidence)) return { error: "evidence must not contain credentials or connection strings" };
    if (JSON.stringify(body.evidence).length > 16_000) return { error: "evidence is too large" };
    evidence = body.evidence;
  }

  return {
    value: {
      provider,
      target,
      startedAt: startedAt || completedAt,
      completedAt,
      rtoSeconds,
      rpoSeconds,
      notes,
      releaseSha,
      evidence,
    },
  };
}

// Decides the health of the newest successful verification. Returns null when
// healthy, otherwise the 503 reason. Exported for tests.
export function evaluateBackupHealth(latest, { limitHours, now = Date.now() }) {
  if (!latest) return "No successful backup verification on record. Run a practice restore and record it.";
  const completedAt = new Date(latest.completed_at).getTime();
  if (!Number.isFinite(completedAt)) return "Latest backup verification has an invalid completion timestamp.";
  if (completedAt > now + BACKUP_CLOCK_SKEW_MS) {
    return "Latest backup verification is dated in the future and cannot be trusted.";
  }
  const verifiedAt = latest.verified_at ? new Date(latest.verified_at).getTime() : completedAt;
  if (!Number.isFinite(verifiedAt) || verifiedAt > now + BACKUP_CLOCK_SKEW_MS) {
    return "Latest backup verification has an untrusted recording timestamp.";
  }
  const ageHours = (now - Math.min(verifiedAt, completedAt)) / 36e5;
  if (ageHours > limitHours) {
    const unit = limitHours === 1 ? "hour" : "hours";
    return `Last successful backup verification was ${Math.round(ageHours)} hours ago. Limit is ${limitHours} ${unit}.`;
  }
  return null;
}

export async function handleBackupHealth(_request, env, injected = {}) {
  const deps = { ...defaults, ...injected };
  try {
    const limitHours = backupVerificationLimitHours(env);
    // Order by the server-controlled recording time so a future-dated
    // completed_at can never shadow a legitimate newer verification.
    const latest = await deps.one(
      `SELECT id, completed_at, verified_at, provider, target, rto_seconds, rpo_seconds, notes, source, release_sha
         FROM backup_verifications
        WHERE success = true
        ORDER BY COALESCE(verified_at, completed_at) DESC
        LIMIT 1`
    );
    const now = Date.now();
    const failure = evaluateBackupHealth(latest, { limitHours, now });
    if (failure) return bad(failure, 503);
    const freshnessAt = latest.verified_at || latest.completed_at;
    return json({
      ok: true,
      lastVerifiedAt: freshnessAt,
      completedAt: latest.completed_at,
      ageHours: Math.round(((now - new Date(freshnessAt).getTime()) / 36e5) * 100) / 100,
      limitHours,
      provider: latest.provider,
      target: latest.target,
      source: latest.source,
      releaseSha: latest.release_sha,
      rtoSeconds: latest.rto_seconds,
      rpoSeconds: latest.rpo_seconds,
      notes: latest.notes,
    });
  } catch (e) {
    console.error("[backup health] failed:", String(e?.message || e));
    return bad("Backup health check failed", 503);
  }
}

export async function handleRecordBackupVerification(request, env, injected = {}) {
  const deps = { ...defaults, ...injected };
  try {
    // Recording changes the recovery signal: fresh step-up 2FA is mandatory.
    const { admin, res } = await deps.requireAdminWith2fa(request, env, true);
    if (res) return res;

    const body = await readJson(request);
    const parsed = validateBackupVerificationInput(body);
    if (parsed.error) return bad(parsed.error);
    const v = parsed.value;

    let row;
    try {
      [row] = await deps.exec(
        `INSERT INTO backup_verifications
           (provider, target, started_at, completed_at, rto_seconds, rpo_seconds, success, notes,
            source, recorded_by, release_sha, evidence)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10, $11::jsonb)
         RETURNING id, completed_at, verified_at`,
        [
          v.provider,
          v.target,
          v.startedAt,
          v.completedAt,
          v.rtoSeconds,
          v.rpoSeconds,
          v.notes,
          "admin-api",
          String(admin.id),
          v.releaseSha,
          v.evidence ?? null,
        ]
      );
    } catch (e) {
      if (String(e?.code) === "23514") return bad(`Backup verification rejected by database: ${String(e.message)}`);
      throw e;
    }

    await deps.logAudit({
      actorId: admin.id,
      action: "backup_verification_recorded",
      entityType: "backup_verification",
      entityId: row?.id ?? null,
      request,
      details: {
        verification_id: row?.id ?? null,
        provider: v.provider,
        target: v.target,
        release_sha: v.releaseSha,
        rto_seconds: v.rtoSeconds,
        rpo_seconds: v.rpoSeconds,
        workflow_run_id: v.evidence?.workflowRunId ?? null,
      },
    });

    return json({ ok: true, id: row?.id, completedAt: row?.completed_at, verifiedAt: row?.verified_at });
  } catch (e) {
    console.error("[backup record] failed:", String(e?.message || e));
    return bad("Could not record backup verification", 500);
  }
}

export async function handleListBackupVerifications(request, env, injected = {}) {
  const deps = { ...defaults, ...injected };
  try {
    const { res } = await deps.requireAdminWith2fa(request, env);
    if (res) return res;

    const rows = await deps.query(
      `SELECT id, provider, target, started_at, completed_at, verified_at, rto_seconds, rpo_seconds,
              success, notes, source, recorded_by, release_sha, evidence, created_at
         FROM backup_verifications
        ORDER BY COALESCE(verified_at, completed_at) DESC
        LIMIT 50`
    );
    return json({ ok: true, verifications: rows });
  } catch (e) {
    console.error("[backup list] failed:", String(e?.message || e));
    return bad("Could not list backup verifications", 500);
  }
}
