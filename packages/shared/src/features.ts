// Shared feature-flag lookup for leaderboard and bot Workers.
//
// Priority:
//   1. Per-user override (if present)
//   2. Environment variable `FF_<UPPER_KEY>=1` (or `=true`)
//   3. Global default from the feature_flags table
//   4. fallback default passed by the caller

import { one, query } from "./db.js";

const ENV_PREFIX = "FF_";

export type FeatureFlag = {
  key: string;
  name: string;
  description: string | null;
  defaultValue: boolean;
};

function envKey(key: string): string {
  return ENV_PREFIX + key.replace(/[^a-zA-Z0-9_]/g, "_").toUpperCase();
}

function envValue(key: string): boolean | undefined {
  if (typeof process === "undefined") return undefined;
  const raw = process.env?.[envKey(key)];
  if (raw === undefined) return undefined;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

/**
 * Check whether a feature is enabled for a user (or globally if userId is omitted).
 * Reads the feature default from the DB once per request and caches it on the
 * request/env object if provided.
 */
export async function isFeatureEnabled(
  key: string,
  userId?: string,
  fallback = false
): Promise<boolean> {
  const envOverride = envValue(key);
  if (envOverride !== undefined && userId == null) {
    // Environment override wins for global checks, but per-user override can still override.
  }

  if (userId) {
    const override = await one<{ enabled: boolean }>(
      `SELECT enabled FROM user_feature_overrides WHERE user_id = $1 AND feature_key = $2`,
      [userId, key]
    );
    if (override) return override.enabled;
  }

  if (envOverride !== undefined) return envOverride;

  const row = await one<{ default_value: boolean }>(
    `SELECT default_value FROM feature_flags WHERE key = $1`,
    [key]
  );
  return row?.default_value ?? fallback;
}

/** List all defined feature flags with their current defaults. */
export async function listFeatureFlags(): Promise<FeatureFlag[]> {
  const rows = await query<FeatureFlag>(
    `SELECT key, name, description, default_value AS "defaultValue" FROM feature_flags ORDER BY name`
  );
  return rows;
}

/** Return the set of feature keys enabled for a user (or globally when userId is omitted). */
export async function getEnabledFeatureKeys(userId?: string): Promise<string[]> {
  const flags = await listFeatureFlags();
  if (flags.length === 0) return [];
  // Same precedence as isFeatureEnabled (user override > env > default), with
  // one overrides read instead of two statements per flag.
  const overrides = new Map<string, boolean>();
  if (userId) {
    const rows = await query<{ feature_key: string; enabled: boolean }>(
      `SELECT feature_key, enabled FROM user_feature_overrides WHERE user_id = $1`,
      [userId]
    );
    for (const row of rows) overrides.set(row.feature_key, row.enabled);
  }
  const enabled: string[] = [];
  for (const flag of flags) {
    const override = overrides.get(flag.key);
    const on = override !== undefined ? override : (envValue(flag.key) ?? flag.defaultValue);
    if (on) enabled.push(flag.key);
  }
  return enabled;
}

/** Upsert a feature flag. Used by admin tooling. */
export async function setFeatureFlag(
  key: string,
  values: { name?: string; description?: string | null; defaultValue?: boolean }
): Promise<FeatureFlag> {
  const row = await one<FeatureFlag>(
    `INSERT INTO feature_flags (key, name, description, default_value)
     VALUES ($1, $2, $3, COALESCE($4, false))
     ON CONFLICT (key) DO UPDATE
       SET name = COALESCE(EXCLUDED.name, feature_flags.name),
           description = COALESCE(EXCLUDED.description, feature_flags.description),
           default_value = COALESCE(EXCLUDED.default_value, feature_flags.default_value),
           updated_at = now()
     RETURNING key, name, description, default_value AS "defaultValue"`,
    [key, values.name ?? key, values.description ?? null, values.defaultValue]
  );
  if (!row) throw new Error("Failed to upsert feature flag");
  return row;
}

/** Set or clear a per-user override. enabled=null removes the override. */
export async function setUserFeatureOverride(
  userId: string,
  featureKey: string,
  enabled: boolean | null
): Promise<void> {
  if (enabled === null) {
    await query(
      `DELETE FROM user_feature_overrides WHERE user_id = $1 AND feature_key = $2`,
      [userId, featureKey]
    );
    return;
  }
  await query(
    `INSERT INTO user_feature_overrides (user_id, feature_key, enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
    [userId, featureKey, enabled]
  );
}
