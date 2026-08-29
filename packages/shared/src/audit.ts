// Shared audit-logging helper.
// Records actor actions to the `audit_log` table for board changes, admin
// actions, payouts, and any other mutating events that need a trail.

import { exec } from "./db.js";
import { getLogger } from "./request-id.js";
import { errMessage } from "./errors.js";

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
  request?: Request | null;
}

export interface AuditDeps {
  exec?: typeof exec;
  getLogger?: typeof getLogger;
}

// Whitelist of keys that are safe to persist. Any key not in this set is
// dropped to prevent tokens, secrets, passwords, or other sensitive fields
// from leaking into the audit log.
const AUDIT_SAFE_KEYS = new Set([
  "accentA",
  "accentB",
  "action",
  "amount",
  "archive_id",
  "archive_label",
  "board_id",
  "board_name",
  "board_slug",
  "boards",
  "casino",
  "changes",
  "clear",
  "code",
  "currency",
  "current_period_end",
  "days",
  "details",
  "disabled",
  "domain",
  "email",
  "entity_id",
  "entity_type",
  "export_id",
  "expires_at",
  "from_plan",
  "label",
  "message",
  "messageId",
  "method",
  "name",
  "old_plan",
  "old_slug",
  "order_id",
  "payment_id",
  "plan",
  "players",
  "provider",
  "reason",
  "remaining_boards",
  "site_id",
  "site_slug",
  "slug_rename",
  "source_board_slug",
  "source_site_id",
  "status",
  "subject",
  "target_user_id",
  "template",
  "to_plan",
  "user_id",
]);

function sanitizeAuditDetails(details: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (AUDIT_SAFE_KEYS.has(key)) safe[key] = value;
  }
  return safe;
}

/**
 * Write a single audit record. Failures are logged but never throw, so a
 * downstream DB hiccup does not break the original request.
 */
export async function logAudit(entry: AuditEntry, deps: AuditDeps = {}): Promise<void> {
  const execImpl = deps.exec || exec;
  const getLoggerImpl = deps.getLogger || getLogger;
  const { actorId, action, entityType, entityId, details, request } = entry;
  const safeDetails = details ? sanitizeAuditDetails(details) : {};
  const ipAddress = request
    ? (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || null)
    : null;
  const userAgent = request ? request.headers.get("user-agent") : null;

  try {
    await execImpl(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [actorId || null, action, entityType || null, entityId || null, safeDetails, ipAddress, userAgent]
    );
  } catch (err) {
    const logger = getLoggerImpl();
    logger.error("audit_log_insert_failed", {
      error: errMessage(err),
      action,
      entityType,
      entityId,
    });
  }
}
