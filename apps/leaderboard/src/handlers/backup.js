// Backup health and verification recording.
import { one, query } from "@yourrank/shared/db";
import { currentUser, json, bad, readJson } from "../auth.js";

export function backupVerificationLimitHours(env = {}) {
  const parsed = Number(env.BACKUP_VERIFICATION_LIMIT_HOURS ?? 168);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 168;
}

export async function handleBackupHealth(_request, env, deps = { one }) {
  try {
    const limitHours = backupVerificationLimitHours(env);
    const latest = await deps.one(
      `SELECT completed_at, provider, target, rto_seconds, rpo_seconds, notes
         FROM backup_verifications
        WHERE success = true
        ORDER BY completed_at DESC
        LIMIT 1`
    );
    if (!latest) {
      return bad("No successful backup verification on record. Run a practice restore and record it.", 503);
    }
    const completedAt = new Date(latest.completed_at).getTime();
    const ageHours = (Date.now() - completedAt) / 36e5;
    if (ageHours > limitHours) {
      const unit = limitHours === 1 ? "hour" : "hours";
      return bad(
        `Last successful backup verification was ${Math.round(ageHours)} hours ago. Limit is ${limitHours} ${unit}.`,
        503
      );
    }
    return json({
      ok: true,
      lastVerifiedAt: latest.completed_at,
      ageHours: Math.round(ageHours * 100) / 100,
      limitHours,
      provider: latest.provider,
      target: latest.target,
      rtoSeconds: latest.rto_seconds,
      rpoSeconds: latest.rpo_seconds,
      notes: latest.notes,
    });
  } catch (e) {
    console.error("[backup health] failed:", String(e?.message || e));
    return bad("Backup health check failed", 500);
  }
}

export async function handleRecordBackupVerification(request, env) {
  try {
    const user = await currentUser(request, env);
    if (!user || !user.is_admin) return bad("unauthorized", 401);

    const body = await readJson(request);
    const provider = String(body?.provider || "").trim();
    const target = String(body?.target || "").trim();
    const completedAt = body?.completedAt ? new Date(body.completedAt) : null;
    const startedAt = body?.startedAt ? new Date(body.startedAt) : null;
    const rtoSeconds = Number.isInteger(body?.rtoSeconds) ? body.rtoSeconds : null;
    const rpoSeconds = Number.isInteger(body?.rpoSeconds) ? body.rpoSeconds : null;
    const notes = body?.notes ? String(body.notes).slice(0, 2000) : null;

    if (!provider || !target) return bad("provider and target are required");
    if (!completedAt || isNaN(completedAt.getTime())) return bad("completedAt is required");
    if (startedAt && isNaN(startedAt.getTime())) return bad("startedAt is invalid");

    const row = await one(
      `INSERT INTO backup_verifications
         (provider, target, started_at, completed_at, rto_seconds, rpo_seconds, success, notes)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7)
       RETURNING id, completed_at`,
      [
        provider,
        target,
        startedAt || completedAt,
        completedAt,
        rtoSeconds,
        rpoSeconds,
        notes,
      ]
    );

    return json({ ok: true, id: row?.id, completedAt: row?.completed_at });
  } catch (e) {
    console.error("[backup record] failed:", String(e?.message || e));
    return bad("Could not record backup verification", 500);
  }
}

export async function handleListBackupVerifications(request, env) {
  try {
    const user = await currentUser(request, env);
    if (!user || !user.is_admin) return bad("unauthorized", 401);

    const rows = await query(
      `SELECT id, provider, target, started_at, completed_at, rto_seconds, rpo_seconds, success, notes, created_at
         FROM backup_verifications
        ORDER BY completed_at DESC
        LIMIT 50`
    );
    return json({ ok: true, verifications: rows });
  } catch (e) {
    console.error("[backup list] failed:", String(e?.message || e));
    return bad("Could not list backup verifications", 500);
  }
}
