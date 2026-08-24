// Reading jsonb columns.
//
// postgres.js returns a jsonb column already parsed, so a correctly written row
// arrives as an object/array. Rows written by an earlier build that bound
// `JSON.stringify(value)` instead of the value itself are JSON-encoded twice and
// arrive as a string. Repairing those rows is a separate data deployment
// (supabase/repair/); until it has run everywhere this is the one place that
// tolerates them, so readers never grow their own
// `typeof x === "string" ? JSON.parse(x)` shim.

/**
 * Normalise a value read from a json/jsonb column.
 * @param value raw column value from the driver
 * @returns the parsed value, or null when a legacy string row cannot be parsed
 */
export function fromJsonb<T = unknown>(value: unknown): T | null {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return (value ?? null) as T | null;
}
