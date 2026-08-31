// Canonical validation and persistence for both manual and scheduled free code drops.
// This is deliberately narrow: restricted event kinds never enter this service.

export const SAFE_AUTOMATION_KIND = "safe_code_drop";
export const CODE_DROP_LIMITS = Object.freeze({
  codeMaxLength: 32,
  pointsMax: 100_000,
  claimsMax: 10_000,
  expiryMinutesMax: 10_080,
});

function integerField(value, { name, min, max, fallback }) {
  const candidate = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < min || candidate > max) {
    return { error: `${name} must be a whole number from ${min.toLocaleString()} to ${max.toLocaleString()}.` };
  }
  return { value: candidate };
}

export function validateCodeDropConfig(input, { requireCode = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Code-drop configuration is required.", code: "invalid_config" };
  }

  let code;
  if (requireCode) {
    code = String(input.code || "").trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
      return { ok: false, error: "Code must be 3–32 letters, numbers, dashes, or underscores.", code: "invalid_code" };
    }
  }

  const points = integerField(input.pointsReward, {
    name: "Credits per claim",
    min: 1,
    max: CODE_DROP_LIMITS.pointsMax,
    fallback: 100,
  });
  if (points.error) return { ok: false, error: points.error, code: "invalid_points" };

  const claims = integerField(input.maxClaims, {
    name: "Available claims",
    min: 1,
    max: CODE_DROP_LIMITS.claimsMax,
    fallback: 50,
  });
  if (claims.error) return { ok: false, error: claims.error, code: "invalid_claims" };

  const expiry = integerField(input.expireMinutes, {
    name: "Time limit",
    min: 0,
    max: CODE_DROP_LIMITS.expiryMinutesMax,
    fallback: 0,
  });
  if (expiry.error) return { ok: false, error: expiry.error, code: "invalid_expiry" };

  return {
    ok: true,
    value: {
      ...(requireCode ? { code } : {}),
      pointsReward: points.value,
      maxClaims: claims.value,
      expireMinutes: expiry.value,
    },
  };
}

export function generateScheduledDropCode(randomValues = (bytes) => crypto.getRandomValues(bytes)) {
  const bytes = randomValues(new Uint8Array(8));
  return `YR-${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export async function createCanonicalCodeDrop({
  db,
  siteId,
  config,
  code,
  occurrenceId = null,
  now = new Date(),
}) {
  const validated = validateCodeDropConfig({ ...config, code }, { requireCode: true });
  if (!validated.ok) {
    const error = new Error(validated.error);
    error.code = validated.code;
    throw error;
  }
  const value = validated.value;
  const expiresAt = value.expireMinutes > 0
    ? new Date(now.getTime() + value.expireMinutes * 60_000).toISOString()
    : null;
  const sql =
    `INSERT INTO code_drops (
       site_id, code, points_reward, max_claims, expires_at, automation_occurrence_id
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, code, points_reward, max_claims, claimed_count, status,
               expires_at, created_at, automation_occurrence_id`;
  const params = [siteId, value.code, value.pointsReward, value.maxClaims, expiresAt, occurrenceId];
  if (db.unsafe) return (await db.unsafe(sql, params))[0];
  if (db.exec) return (await db.exec(sql, params))[0];
  return db.one(sql, params);
}
