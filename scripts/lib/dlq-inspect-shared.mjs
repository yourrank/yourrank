// Shared structural helpers for the DLQ inspect/acknowledge scripts. All
// functions work on key names and types only — never row values.

export const ENVELOPE_KEYS = ["v", "eventId", "eventType", "createdAt", "payload"];
export const LEGACY_KEYS = ["type", "kind", "siteId"];

export const keysOf = (value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];

export const hasAll = (obj, keys) =>
  obj !== null && typeof obj === "object" && !Array.isArray(obj) && keys.every((k) => k in obj);

export const isTop3Notify = (row) => {
  const body = row.body;
  if (hasAll(body, ENVELOPE_KEYS)) {
    const payload = body.payload;
    return payload !== null && typeof payload === "object" &&
      payload.type === "notify" && payload.kind === "top3";
  }
  return hasAll(body, LEGACY_KEYS) && body.type === "notify" && body.kind === "top3";
};
