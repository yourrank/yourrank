// Read-only sanitizer for the Production DLQ Inspect workflow. Reduces a
// GET /bot/api/dlq?include_body=true page to grouped structural diagnostics:
// JSON types, key names, counts, Zod codes/paths/unrecognized key names. It
// never emits message ids, received_at values, last_replay_error text, or any
// value from inside a row body.

import { readFileSync } from "node:fs";
import { parseQueueMessage } from "../packages/shared/dist/queue-producer.js";

const ENVELOPE_KEYS = ["v", "eventId", "eventType", "createdAt", "payload"];
const LEGACY_KEYS = ["type", "kind", "siteId"];

const keysOf = (value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];

const shape = (body) => `${Array.isArray(body) ? "array" : typeof body}:${keysOf(body).join(",")}`;

const hasAll = (obj, keys) =>
  obj !== null && typeof obj === "object" && !Array.isArray(obj) && keys.every((k) => k in obj);

// last_replay_error is free-form runtime text and is never emitted; it is
// reduced to a kind plus structural Zod diagnostics when it parses as a Zod
// issue list (codes / schema paths / unrecognized key names only).
const zodIssues = (errorText) => {
  try {
    const issues = JSON.parse(errorText);
    return Array.isArray(issues) && issues.length > 0 &&
      issues.every((i) => i && typeof i === "object" && "code" in i && "path" in i)
      ? issues
      : null;
  } catch {
    return null;
  }
};

const errorKind = (row) => {
  const e = row.last_replay_error ?? "";
  if (e === "") return "none";
  if (zodIssues(e) !== null) return "zod_validation";
  if (e === "replay lease expired after max attempts") return "lease_failure";
  if (row.replay_state === "invalid") return "other";
  return "send_failure";
};

const zodDiag = (row) => {
  const issues = zodIssues(row.last_replay_error ?? "");
  if (issues === null) return null;
  return issues.map((issue) => ({
    code: String(issue.code),
    path: (Array.isArray(issue.path) ? issue.path : []).map(String).join("."),
    unrecognized_keys: issue.code === "unrecognized_keys"
      ? (Array.isArray(issue.keys) ? issue.keys : []).map(String)
      : [],
  }));
};

const groupBy = (rows, keyOf, emit) => {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, group]) => emit(key, group));
};

const isTop3Notify = (row) => {
  const body = row.body;
  if (hasAll(body, ENVELOPE_KEYS)) {
    const payload = body.payload;
    return payload !== null && typeof payload === "object" &&
      payload.type === "notify" && payload.kind === "top3";
  }
  return hasAll(body, LEGACY_KEYS) && body.type === "notify" && body.kind === "top3";
};

const top3Changes = (row) => {
  const body = row.body;
  const payload = hasAll(body, ENVELOPE_KEYS) ? body.payload : body;
  return payload && typeof payload === "object" && Array.isArray(payload.changes)
    ? payload.changes
    : [];
};

const schemaValid = (row) => {
  try {
    parseQueueMessage(row.body);
    return true;
  } catch {
    return false;
  }
};

export function sanitizeDlqPage(page) {
  const rows = Array.isArray(page?.rows) ? page.rows : [];
  const top3 = rows.filter(isTop3Notify);
  const top3Valid = top3.filter(schemaValid);

  const zodSignatureGroups = new Map();
  for (const row of rows) {
    for (const issue of zodDiag(row) ?? []) {
      const sig = JSON.stringify(issue);
      zodSignatureGroups.set(sig, (zodSignatureGroups.get(sig) ?? 0) + 1);
    }
  }

  return {
    total_actionable: rows.length,
    summary: (Array.isArray(page?.summary) ? page.summary : []).map((row) => ({
      event_type: row.event_type,
      pending: row.pending,
      invalid: row.invalid,
      exhausted: row.exhausted,
      max_attempts: row.max_attempts,
    })),
    by_replay_state: groupBy(rows, (r) => r.replay_state ?? "pending",
      (state, g) => ({ state, count: g.length })),
    event_types: groupBy(rows, (r) => r.event_type,
      (event_type, g) => ({ event_type, count: g.length })),
    body_shapes: groupBy(rows, (r) => shape(r.body),
      (s, g) => ({ shape: s, event_types: [...new Set(g.map((r) => r.event_type))], count: g.length })),
    error_kinds: groupBy(rows, errorKind,
      (error_kind, g) => ({ error_kind, count: g.length })),
    zod_issue_signatures: [...zodSignatureGroups.entries()].map(([sig, count]) => ({
      ...JSON.parse(sig),
      count,
    })),
    envelope_vs_legacy: {
      envelope: rows.filter((r) => hasAll(r.body, ENVELOPE_KEYS)).length,
      legacy: rows.filter((r) => !hasAll(r.body, ENVELOPE_KEYS) && hasAll(r.body, LEGACY_KEYS)).length,
      unknown: rows.filter((r) => !hasAll(r.body, ENVELOPE_KEYS) && !hasAll(r.body, LEGACY_KEYS)).length,
    },
    current_schema: {
      valid: rows.filter(schemaValid).length,
      invalid: rows.filter((r) => !schemaValid(r)).length,
    },
    top3_notify: {
      compatible_count: top3Valid.length,
      change_item_key_sets: groupBy(top3,
        (r) => [...new Set(top3Changes(r).flatMap((c) => keysOf(c)))].sort().join(","),
        (keys, g) => ({ keys, count: g.length })),
      with_score: top3.filter((r) => top3Changes(r).some((c) => keysOf(c).includes("score"))).length,
      with_rankBy: top3.filter((r) => top3Changes(r).some((c) => keysOf(c).includes("rankBy"))).length,
      schema_drift_rows: top3.length - top3Valid.length,
      current_schema_valid: top3.length > 0 && top3Valid.length === top3.length,
    },
    other_count: rows.length - top3.length,
    safe_to_replay_count: rows.filter(
      (r) => (r.replay_state ?? "pending") === "pending" && schemaValid(r),
    ).length,
  };
}

function main() {
  try {
    const page = JSON.parse(readFileSync(process.argv[2], "utf8"));
    process.stdout.write(`${JSON.stringify(sanitizeDlqPage(page), null, 1)}\n`);
  } catch {
    console.error("DLQ inspect sanitize failed");
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
