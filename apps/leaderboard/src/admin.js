// Owner admin API. Every route requires a session whose user has is_admin=true.
import { json, bad, ok, readJson, newToken, readToken, currentUser, destroyAllUserSessions, clientIp, rateLimit } from "./auth.js";
import { activatePlan, PRO_DAYS } from "./billing.js";
import { sendEmail, resetEmail } from "./email.js";
import { query, one, exec } from "@yourrank/shared/db";
import { logAudit } from "@yourrank/shared/audit";
import { generateSecret, verifyCode, generateOtpauthUri } from "./totp.js";
import { encrypt, decrypt, hashToken, bytesToHex, safeEqual } from "@yourrank/shared/crypto";
import { listFeatureFlags, setFeatureFlag, setUserFeatureOverride } from "@yourrank/shared/features";
import { loadPlatformIdentity, getPlatformIdentity, updatePlatformIdentity, isIdentityComplete } from "./platform-identity.js";

// QUALITY-007: Named timing constants (no magic numbers)
const RESET_TOKEN_TTL_S = 86400;   // 24 hours — admin-initiated password reset link validity
const STEPUP_FRESH_S = 10 * 60;    // 10 minutes — how long a 2FA verification stays "fresh" for sensitive actions
const PENDING_TTL_S = 10 * 60;     // 10 minutes — pending TOTP enrollment must be verified within this window
const MAX_TOTP_FAILS = 5;          // lock 2FA after 5 consecutive failures
const TOTP_LOCKOUT_S = 30 * 60;    // 30 minutes — 2FA lockout duration
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 8;     // 16 hex chars

// Log admin action to the unified audit_log table for persistent audit trail.
async function logAdminAction(env, adminId, action, targetUserId = null, details = null, request = null) {
  await logAudit({
    actorId: adminId,
    action,
    entityType: "admin",
    entityId: targetUserId || adminId,
    request,
    details: details || {},
  });
}

export async function requireAdmin(request, env) {
  // BE-007: Rate-limit admin endpoints (120 req/min per IP).
  const ip = clientIp(request);
  if (!(await rateLimit(env, `admin:${ip}`, 120, 60)).ok) {
    return { admin: null, res: bad("Too many requests. Try again later.", 429) };
  }
  const u = await currentUser(request, env);
  if (!u) return { admin: null, res: bad("You need to sign in to access this page.", 401) };
  if (!u.is_admin) return { admin: null, res: bad("You don't have permission to access this page.", 403) };
  return { admin: u, res: null };
}

async function isTotpLocked(userId) {
  const row = await one("SELECT totp_locked_until FROM users WHERE id=$1", [userId]);
  return row?.totp_locked_until && new Date(row.totp_locked_until) > new Date();
}

async function recordTotpFailure(userId) {
  const row = await one(
    "UPDATE users SET totp_failed_attempts = totp_failed_attempts + 1 WHERE id=$1 RETURNING totp_failed_attempts",
    [userId]
  );
  if (row && row.totp_failed_attempts >= MAX_TOTP_FAILS) {
    await exec(
      "UPDATE users SET totp_locked_until=now()+make_interval(secs => $1) WHERE id=$2 AND (totp_locked_until IS NULL OR totp_locked_until <= now())",
      [TOTP_LOCKOUT_S, userId]
    );
  }
  return row;
}

async function resetTotpFailures(userId) {
  await exec("UPDATE users SET totp_failed_attempts=0, totp_locked_until=NULL WHERE id=$1", [userId]);
}

async function setSession2faVerified(tokenHash) {
  await exec("UPDATE sessions SET twofa_verified=true, twofa_verified_at=now() WHERE token=$1", [tokenHash]);
}

async function clearSession2faForUser(userId) {
  await exec("UPDATE sessions SET twofa_verified=false, twofa_verified_at=NULL WHERE user_id=$1", [userId]);
}

// Like requireAdmin, but also checks that 2FA is verified if the admin has it enabled.
// Used by data endpoints (overview, users, leads, payments, action).
// The 2FA endpoints themselves use plain requireAdmin to avoid chicken-and-egg.
//
// C-10: Admin MFA is mandatory. Every admin must have totp_secret set, and the
// session must record a twofa_verified_at timestamp. Sensitive actions require a
// fresh verification (within STEPUP_FRESH_S); we check the timestamp before
// authorization instead of clearing the flag after use.
// B-06: Human-readable messages for auth error codes so users never see
// raw snake_case strings in the UI if the client doesn't map them.
const AUTH_ERRORS = {
  "2fa_setup_required": "Two-factor authentication setup is required before continuing.",
  "2fa_locked":         "Too many failed attempts. Your account is temporarily locked.",
  "2fa_required":       "Please complete two-factor authentication to continue.",
  "2fa_stale":          "Your 2FA session has expired. Please verify again.",
};
function authError(code, status) {
  return bad(AUTH_ERRORS[code] || "An authentication error occurred.", status);
}

export async function requireAdminWith2fa(request, env, requireFresh = false) {
  const { admin, res } = await requireAdmin(request, env);
  if (res) return { admin: null, res };

  const user = await one("SELECT totp_secret, totp_locked_until FROM users WHERE id=$1", [admin.id]);
  if (!user?.totp_secret) {
    return { admin: null, res: authError("2fa_setup_required", 403) };
  }

  if (user.totp_locked_until && new Date(user.totp_locked_until) > new Date()) {
    return { admin: null, res: authError("2fa_locked", 423) };
  }

  const token = readToken(request);
  const tokenHash = token ? await hashToken(token) : null;
  const tfaRow = tokenHash ? await one("SELECT twofa_verified_at FROM sessions WHERE token=$1", [tokenHash]) : null;
  if (!tfaRow?.twofa_verified_at) {
    return { admin: null, res: authError("2fa_required", 403) };
  }

  if (requireFresh) {
    const verifiedAt = new Date(tfaRow.twofa_verified_at).getTime();
    if (Date.now() - verifiedAt > STEPUP_FRESH_S * 1000) {
      return { admin: null, res: authError("2fa_stale", 403) };
    }
  }

  return { admin, res: null };
}

export async function handleOverview(request, env) {
  const { admin, res } = await requireAdminWith2fa(request, env);
  if (res) return res;
  // QA-012: Audit-log admin page views
  await logAdminAction(env, admin.id, "overview", null, null, request);
  const [users, pro, leads, revenue] = await Promise.all([
    one("SELECT COUNT(*) n FROM users"),
    one("SELECT COUNT(*) n FROM users WHERE plan IN ('pro','team') AND status!='suspended'"),
    one("SELECT COUNT(*) n FROM leads"),
    one("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE status IN ('finished','manual')"),
  ]);
  return ok({ users: Number(users?.n) || 0, pro: Number(pro?.n) || 0, leads: Number(leads?.n) || 0, revenue: Number(revenue?.n) || 0 });
}

export async function handleUsers(request, env) {
  const { admin, res } = await requireAdminWith2fa(request, env);
  if (res) return res;
  // QA-012: Audit-log admin page views
  await logAdminAction(env, admin.id, "users", null, null, request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = 50;
  const offset = (page - 1) * pageSize;
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const statusFilter = url.searchParams.get("status") || "all";
  const planFilter = url.searchParams.get("plan") || "all";
  if (!["all", "free", "pro", "team"].includes(planFilter)) return bad("Unknown plan filter", 400);

  const conditions = ["1=1"];
  const params = [];
  if (q) { conditions.push("(LOWER(u.email) LIKE $" + (params.length + 1) + " OR LOWER(u.id::text) LIKE $" + (params.length + 1) + ")"); params.push("%" + q + "%"); }
  if (statusFilter !== "all") { conditions.push("u.status = $" + (params.length + 1)); params.push(statusFilter); }
  if (planFilter !== "all") { conditions.push("u.plan = $" + (params.length + 1)); params.push(planFilter); }
  const where = "WHERE " + conditions.join(" AND ");

  const [total, rows] = await Promise.all([
    one("SELECT COUNT(*) n FROM users u " + where, params),
    query(
      `WITH first_board AS (
         SELECT DISTINCT ON (s.user_id) s.user_id, s.id AS site_id, s.slug
         FROM sites s ORDER BY s.user_id, s.board_order ASC
       )
       SELECT u.id, u.email, u.plan,
              (EXTRACT(EPOCH FROM u.plan_expires_at) * 1000)::double precision AS plan_expires_at,
              u.status, u.is_admin,
              u.totp_secret IS NOT NULL AS totp_enabled,
              u.totp_locked_until,
              u.suspension_reason,
              (EXTRACT(EPOCH FROM u.created_at) * 1000)::double precision AS created_at,
              COALESCE(bc.board_count, 0) AS board_count,
              fb.slug,
              COALESCE(pc.player_count, 0) AS player_count
         FROM users u
         LEFT JOIN (SELECT user_id, COUNT(*) AS board_count FROM sites GROUP BY user_id) bc ON bc.user_id = u.id
         LEFT JOIN first_board fb ON fb.user_id = u.id
         LEFT JOIN (SELECT site_id, COUNT(*) AS player_count FROM players GROUP BY site_id) pc ON pc.site_id = fb.site_id
         ${where}
         ORDER BY u.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    ),
  ]);
  return ok({ users: rows || [], page, pageSize, total: Number(total?.n) || 0, filters: { q, status: statusFilter, plan: planFilter } });
}

export async function handleLeads(request, env) {
  const { admin, res } = await requireAdminWith2fa(request, env);
  if (res) return res;
  // QA-012: Audit-log admin page views
  await logAdminAction(env, admin.id, "leads", null, null, request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = 50;
  const offset = (page - 1) * pageSize;
  const [rows, total] = await Promise.all([
    query(
      "SELECT id, handle, casino, contact, note, (EXTRACT(EPOCH FROM created_at) * 1000)::double precision AS created_at FROM leads ORDER BY created_at DESC LIMIT $1 OFFSET $2",
      [pageSize, offset]
    ),
    one("SELECT COUNT(*)::int AS n FROM leads"),
  ]);
  return ok({ leads: rows || [], page, pageSize, total: total?.n || 0 });
}

export async function handlePayments(request, env) {
  const { admin, res } = await requireAdminWith2fa(request, env);
  if (res) return res;
  // QA-012: Audit-log admin page views
  await logAdminAction(env, admin.id, "payments", null, null, request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = 50;
  const offset = (page - 1) * pageSize;
  const [rows, total] = await Promise.all([
    query(
      `SELECT p.id, p.user_id, p.provider, p.amount AS amount_usd, p.currency, p.invoice_id, p.tx_ref, p.status,
              (EXTRACT(EPOCH FROM p.created_at) * 1000)::double precision AS created_at,
              u.email
         FROM payments p LEFT JOIN users u ON u.id = p.user_id
         ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    ),
    one("SELECT COUNT(*)::int AS n FROM payments"),
  ]);
  return ok({ payments: rows || [], page, pageSize, total: total?.n || 0 });
}

// POST /api/admin/action — { userId, action: pro|team|free|suspend|unsuspend|reset-link, days?, plan? }
export async function handleAction(request, env) {
  // Sensitive actions (plan changes, reset-link) require fresh 2FA verification
  const body = await readJson(request);
  if (!body || !body.userId || !body.action) return bad("userId and action required");

  const sensitiveActions = ["pro", "team", "free", "reset-link"];
  const requireFresh = sensitiveActions.includes(body.action);

  const { admin, res } = await requireAdminWith2fa(request, env, requireFresh);
  if (res) return res;

  const target = await one("SELECT id, email, is_admin FROM users WHERE id=$1", [body.userId]);
  if (!target) return bad("No such user", 404);

  switch (body.action) {
    case "pro":
    case "team": {
      const days = Number(body.days);
      await activatePlan(env, target.id, body.action, Number.isFinite(days) ? days : PRO_DAYS, {
        provider: "manual",
        amountUsd: Number(body.amountUsd) || 0,
      });
      break;
    }
    case "free":
      await exec("UPDATE users SET plan='free', plan_expires_at=NULL, updated_at=now() WHERE id=$1", [target.id]);
      break;
    case "suspend": {
      if (target.is_admin) return bad("Can't suspend an admin");
      const reason = String(body.reason || "").trim();
      await exec("UPDATE users SET status='suspended', suspension_reason=$2, updated_at=now() WHERE id=$1", [target.id, reason || null]);
      await destroyAllUserSessions(env, target.id);
      break;
    }
    case "unsuspend":
      await exec("UPDATE users SET status='active', suspension_reason=NULL, updated_at=now() WHERE id=$1", [target.id]);
      break;
    case "reset-link": {
      if (target.is_admin) return bad("Can't generate a reset link for an admin");
      // H-22: do not generate an undeliverable reset token. Email is the only
      // allowed delivery channel for admin-initiated reset links.
      if (!env.RESEND_API_KEY) return bad("Email provider is not configured. Reset links cannot be delivered securely.", 503);
      await exec("DELETE FROM password_resets WHERE user_id=$1 AND expires_at > now()", [target.id]);
      const token = newToken();
      const tokenHash = await hashToken(token);
      await exec("INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3)) ON CONFLICT (token) DO UPDATE SET user_id=$2, expires_at=now() + make_interval(secs => $3)", [tokenHash, target.id, RESET_TOKEN_TTL_S]);
      const link = `${new URL(request.url).origin}/reset?token=${token}`;
      const mail = resetEmail(link);
      const result = await sendEmail(env, { to: target.email, ...mail });
      if (!result.sent) {
        // If delivery fails, revoke the token so it cannot later be used.
        await exec("DELETE FROM password_resets WHERE token=$1", [tokenHash]);
        console.error("[admin] reset-link send failed", result.reason, "for", target.email.replace(/(.).+(@)/, "$1***$2"));
        return bad("Failed to send reset email. The link has been revoked.", 500);
      }
      await logAdminAction(env, admin.id, body.action, target.id, {
        email: target.email,
        details: "reset-link-sent",
      }, request);
      return ok({ message: `Reset link sent to ${target.email}.`, email: target.email });
    }
    default:
      return bad("Unknown action");
  }
  await logAdminAction(env, admin.id, body.action, target.id, {
    email: target.email,
    details: body.days || body.amountUsd || body.reason || null,
  }, request);
  return ok();
}

// GET /api/admin/support — list support messages for the admin inbox.
export async function handleSupportMessages(request, env) {
  const { res } = await requireAdminWith2fa(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "all";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = 50;
  const offset = (page - 1) * pageSize;
  const args = [pageSize, offset];
  const where =
    status === "pending" ? "WHERE reply IS NULL" :
    status === "replied" ? "WHERE reply IS NOT NULL" : "";
  const [total, rows] = await Promise.all([
    one(`SELECT COUNT(*) n FROM support_messages ${where}`),
    query(
      `SELECT id, name, email, subject, message, reply,
              (EXTRACT(EPOCH FROM created_at) * 1000)::double precision AS created_at,
              (EXTRACT(EPOCH FROM replied_at) * 1000)::double precision AS replied_at
         FROM support_messages
         ${where}
         ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      args
    ),
  ]);
  return ok({ messages: rows || [], page, pageSize, total: Number(total?.n) || 0 });
}

// POST /api/admin/support/reply — reply to a support message and email the user.
export async function handleSupportReply(request, env) {
  const { admin, res } = await requireAdminWith2fa(request, env);
  if (res) return res;
  const body = await readJson(request);
  if (!body?.id || typeof body.reply !== "string" || body.reply.trim().length < 1) {
    return bad("Message ID and reply are required.");
  }
  const m = await one(
    "SELECT id, name, email, subject, message FROM support_messages WHERE id = $1",
    [body.id]
  );
  if (!m) return bad("Message not found.", 404);
  await exec(
    "UPDATE support_messages SET reply = $1, replied_at = now() WHERE id = $2",
    [body.reply.trim(), m.id]
  );
  const emailResult = await sendEmail(env, {
    to: m.email,
    subject: `Re: ${m.subject}`,
    text: `Hi ${m.name},\n\n${body.reply.trim()}\n\n---\nOriginal message:\n${m.message}`,
    html: `<p>Hi ${esc(m.name)},</p><p>${esc(body.reply.trim()).replace(/\n/g, "<br>")}</p><hr><p><b>Original message:</b></p><pre style="white-space:pre-wrap">${esc(m.message)}</pre>`,
  });
  await logAdminAction(env, admin.id, "support_reply", null, {
    messageId: m.id,
    email: m.email,
    subject: m.subject,
  }, request);
  return ok({ emailSent: emailResult.sent });
}

// GET /api/admin/audit — recent audit log events for sensitive actions.
export async function handleAudit(request, env) {
  const { res } = await requireAdminWith2fa(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = 50;
  const offset = (page - 1) * pageSize;
  const [total, rows] = await Promise.all([
    one("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'admin'"),
    query(
      `SELECT a.id,
              (EXTRACT(EPOCH FROM a.created_at) * 1000)::double precision AS created_at,
              a.action, a.entity_id, a.details,
              u.email AS actor_email
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.entity_type = 'admin'
        ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    ),
  ]);
  return ok({ events: rows || [], page, pageSize, total: Number(total?.n) || 0 });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function normalizeRecoveryCode(raw) {
  return String(raw || "").replace(/[^0-9a-fA-F]/g, "").toLowerCase();
}

function generateRecoveryCode() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(RECOVERY_CODE_BYTES)));
}

async function hashRecoveryCode(code) {
  const data = new TextEncoder().encode(code);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(buf));
}

async function generateAndStoreRecoveryCodes(userId) {
  const codes = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) codes.push(generateRecoveryCode());
  for (const code of codes) {
    const h = await hashRecoveryCode(code);
    await exec("INSERT INTO admin_recovery_codes (user_id, code_hash) VALUES ($1, $2)", [userId, h]);
  }
  return codes;
}

async function clearRecoveryCodes(userId) {
  await exec("DELETE FROM admin_recovery_codes WHERE user_id=$1", [userId]);
}

async function verifyRecoveryCode(userId, rawCode) {
  const code = normalizeRecoveryCode(rawCode);
  if (!code || code.length !== RECOVERY_CODE_BYTES * 2) return false;
  const rows = await query("SELECT id, code_hash FROM admin_recovery_codes WHERE user_id=$1 AND used_at IS NULL", [userId]);
  const inputHash = await hashRecoveryCode(code);
  let matchedId = null;
  for (const row of rows || []) {
    if (safeEqual(inputHash, row.code_hash)) {
      matchedId = row.id;
      break;
    }
  }
  if (!matchedId) return false;
  const updated = await exec("UPDATE admin_recovery_codes SET used_at=now() WHERE id=$1 AND used_at IS NULL", [matchedId]);
  return updated && updated.length > 0;
}

// POST /api/admin/2fa/enable — start TOTP enrollment for the admin user.
// Stores only a pending secret until handle2faVerify proves the admin can generate
// a valid code (verified enrollment transaction).
export async function handle2faEnable(request, env) {
  const { admin, res } = await requireAdmin(request, env);
  if (res) return res;

  if (await isTotpLocked(admin.id)) {
    return bad("2FA locked due to too many failed attempts. Try again later.", 423);
  }

  const user = await one("SELECT totp_secret, totp_pending_secret, totp_pending_at FROM users WHERE id=$1", [admin.id]);
  if (user?.totp_secret) {
    return bad("2FA is already enabled. Disable it first to re-generate.", 400);
  }

  const encKey = env.TOKEN_ENC_KEY;
  if (!encKey) {
    console.error("[2FA] TOKEN_ENC_KEY not configured");
    return bad("Server configuration error. Contact support.", 500);
  }

  // If a pending enrollment exists and has not expired, reuse the same secret.
  if (user?.totp_pending_secret && user?.totp_pending_at) {
    const age = (Date.now() - new Date(user.totp_pending_at).getTime()) / 1000;
    if (age <= PENDING_TTL_S) {
      try {
        const existing = await decrypt(user.totp_pending_secret, encKey);
        const uri = generateOtpauthUri(existing, admin.email);
        return ok({ uri, secret: existing, pending: true });
      } catch {
        // Fall through and generate a fresh pending secret.
      }
    }
  }

  const secret = generateSecret();
  const encrypted = await encrypt(secret, encKey);
  await exec(
    "UPDATE users SET totp_pending_secret=$1, totp_pending_at=now(), totp_failed_attempts=0, totp_locked_until=NULL WHERE id=$2",
    [encrypted, admin.id]
  );

  await logAdminAction(env, admin.id, "2fa_setup_started", admin.id, {
    email: admin.email,
    details: "2FA enrollment started",
  }, request);

  const uri = generateOtpauthUri(secret, admin.email);
  return ok({ uri, secret });
}

// POST /api/admin/2fa/verify — verify a TOTP code.
// For enrollment, promotes the pending secret and returns recovery codes.
// For re-verification, sets the session's twofa_verified_at timestamp.
export async function handle2faVerify(request, env) {
  const { admin, res } = await requireAdmin(request, env);
  if (res) return res;

  const body = await readJson(request);
  if (!body || !body.code) return bad("6-digit code required");
  const code = String(body.code).trim();
  if (!/^\d{6}$/.test(code)) return bad("Invalid code format");

  // Per-user TOTP rate limit: 5 attempts per 5 minutes (SEC-710)
  const totpKey = `totp:admin:${admin.id}`;
  if (!(await rateLimit(env, totpKey, 5, 300)).ok) {
    return json({ ok: false, error: "Too many verification attempts. Try again in a few minutes." }, 429);
  }

  const user = await one(
    "SELECT totp_secret, totp_pending_secret, totp_pending_at, totp_failed_attempts, totp_locked_until FROM users WHERE id=$1",
    [admin.id]
  );
  if (!user?.totp_secret && !user?.totp_pending_secret) {
    return bad("2FA is not enabled or enrollment has not started", 400);
  }
  if (user?.totp_locked_until && new Date(user.totp_locked_until) > new Date()) {
    return bad("2FA locked due to too many failed attempts. Try again later.", 423);
  }

  const encKey = env.TOKEN_ENC_KEY;
  if (!encKey) return bad("Server configuration error.", 500);

  let secret = null;
  let mode = "verify";
  if (user?.totp_secret) {
    try {
      secret = await decrypt(user.totp_secret, encKey);
    } catch (e) {
      console.error("[2FA] decrypt failed:", String(e?.message || e));
      return bad("Failed to verify. Try again.", 500);
    }
  } else if (user?.totp_pending_secret) {
    const age = user.totp_pending_at ? (Date.now() - new Date(user.totp_pending_at).getTime()) / 1000 : Infinity;
    if (age > PENDING_TTL_S) {
      return bad("Setup expired. Start 2FA enrollment again.", 400);
    }
    try {
      secret = await decrypt(user.totp_pending_secret, encKey);
      mode = "enroll";
    } catch (e) {
      console.error("[2FA] decrypt failed:", String(e?.message || e));
      return bad("Failed to verify. Try again.", 500);
    }
  }

  const valid = await verifyCode(secret, code);
  if (!valid) {
    await recordTotpFailure(admin.id);
    console.error(JSON.stringify({ level: "warn", ctx: "admin-totp", outcome: "fail", adminId: admin.id, ip: request.headers.get("cf-connecting-ip") || "unknown" }));
    return bad("Invalid code. Check your authenticator and try again.", 401);
  }

  await resetTotpFailures(admin.id);

  const token = readToken(request);
  const tokenHash = token ? await hashToken(token) : null;
  if (tokenHash) {
    await setSession2faVerified(tokenHash);
  }

  if (mode === "enroll") {
    const recoveryCodes = await generateAndStoreRecoveryCodes(admin.id);
    // Promote pending secret to active only after successful verification.
    await exec(
      "UPDATE users SET totp_secret=totp_pending_secret, totp_pending_secret=NULL, totp_pending_at=NULL, totp_enabled_at=now() WHERE id=$1",
      [admin.id]
    );
    await logAdminAction(env, admin.id, "2fa_enable", admin.id, {
      email: admin.email,
      details: "2FA enabled for admin account",
    }, request);
    return ok({ verified: true, recoveryCodes });
  }

  await logAdminAction(env, admin.id, "2fa_verify", admin.id, {
    email: admin.email,
    details: "2FA verification successful",
  }, request);

  return ok({ verified: true });
}

// POST /api/admin/2fa/recovery — verify a single-use recovery code instead of a TOTP.
// On success the session is marked 2FA-verified, so the admin can access the panel
// and (re-)configure 2FA.
export async function handle2faRecovery(request, env) {
  const { admin, res } = await requireAdmin(request, env);
  if (res) return res;

  const body = await readJson(request);
  if (!body || !body.code) return bad("Recovery code required");

  const rawCode = String(body.code).trim();
  const code = normalizeRecoveryCode(rawCode);
  if (!code || code.length !== RECOVERY_CODE_BYTES * 2) {
    return bad("Invalid recovery code format", 400);
  }

  const user = await one("SELECT totp_secret, totp_failed_attempts, totp_locked_until FROM users WHERE id=$1", [admin.id]);
  if (!user?.totp_secret) return bad("2FA is not enabled", 400);

  // Rate-limit recovery attempts the same way as TOTP attempts.
  if (!(await rateLimit(env, `totp:admin:${admin.id}`, 5, 300)).ok) {
    return json({ ok: false, error: "Too many attempts. Try again in a few minutes." }, 429);
  }

  const valid = await verifyRecoveryCode(admin.id, code);
  if (!valid) {
    await recordTotpFailure(admin.id);
    return bad("Invalid or already used recovery code.", 401);
  }

  await resetTotpFailures(admin.id);
  const token = readToken(request);
  const tokenHash = token ? await hashToken(token) : null;
  if (tokenHash) {
    await setSession2faVerified(tokenHash);
  }

  await logAdminAction(env, admin.id, "2fa_recovery", admin.id, {
    email: admin.email,
    details: "2FA verified via recovery code",
  }, request);

  return ok({ verified: true });
}

// GET /api/admin/2fa/status — check if 2FA is enabled and verified for the current session.
export async function handle2faStatus(request, env) {
  const { admin, res } = await requireAdmin(request, env);
  if (res) return res;

  const user = await one("SELECT totp_secret, totp_locked_until FROM users WHERE id=$1", [admin.id]);
  const enabled = !!user?.totp_secret;
  const locked = user?.totp_locked_until && new Date(user.totp_locked_until) > new Date();

  let verified = false;
  let fresh = false;
  let recoveryCodesRemaining = 0;
  if (enabled) {
    const token = readToken(request);
    if (token) {
      const tokenHash = await hashToken(token);
      const tfaRow = await one("SELECT twofa_verified_at FROM sessions WHERE token=$1", [tokenHash]);
      verified = !!tfaRow?.twofa_verified_at;
      if (verified && tfaRow.twofa_verified_at) {
        fresh = (Date.now() - new Date(tfaRow.twofa_verified_at).getTime()) <= STEPUP_FRESH_S * 1000;
      }
    }
    const rc = await one("SELECT COUNT(*)::int AS n FROM admin_recovery_codes WHERE user_id=$1 AND used_at IS NULL", [admin.id]);
    recoveryCodesRemaining = rc?.n || 0;
  }

  return ok({ enabled, verified, fresh, locked, recoveryCodesRemaining });
}

// POST /api/admin/2fa/disable — disable 2FA for the admin user.
// Requires fresh 2FA verification to prevent accidental/malicious disabling.
export async function handle2faDisable(request, env) {
  const { admin, res } = await requireAdminWith2fa(request, env, true); // require fresh verification
  if (res) return res;

  const user = await one("SELECT totp_secret FROM users WHERE id=$1", [admin.id]);
  if (!user?.totp_secret) {
    return bad("2FA is not enabled", 400);
  }

  await exec(
    "UPDATE users SET totp_secret=NULL, totp_pending_secret=NULL, totp_pending_at=NULL, totp_enabled_at=NULL WHERE id=$1",
    [admin.id]
  );
  await clearRecoveryCodes(admin.id);
  await clearSession2faForUser(admin.id);

  await logAdminAction(env, admin.id, "2fa_disable", admin.id, {
    email: admin.email,
    details: "2FA disabled for admin account",
  }, request);

  return ok({ disabled: true });
}

// GET /api/admin/features — list global feature flags.
// POST /api/admin/features — create or update a global feature flag.
export async function handleFeatureFlags(request, env) {
  const { admin, res } = await requireAdminWith2fa(request, env);
  if (res) return res;

  if (request.method === "GET") {
    const flags = await listFeatureFlags();
    return ok({ flags });
  }

  const body = await readJson(request);
  if (!body || typeof body !== "object") return bad("Invalid body", 400);
  const key = String(body.key ?? "").trim();
  if (!key) return bad("key is required", 400);
  const flag = await setFeatureFlag(key, {
    name: body.name,
    description: body.description,
    defaultValue: body.defaultValue,
  });
  await logAdminAction(env, admin.id, "feature_flag_set", null, { key, name: flag.name, defaultValue: flag.defaultValue }, request);
  return ok(flag);
}

// POST /api/admin/features/override — set or clear a per-user feature override.
export async function handleFeatureFlagOverride(request, env) {
  const { admin, res } = await requireAdminWith2fa(request, env);
  if (res) return res;

  const body = await readJson(request);
  if (!body || typeof body !== "object") return bad("Invalid body", 400);
  const userId = String(body.userId ?? "").trim();
  const featureKey = String(body.featureKey ?? "").trim();
  if (!userId || !featureKey) return bad("userId and featureKey required", 400);
  const enabled = body.enabled === null ? null : Boolean(body.enabled);
  await setUserFeatureOverride(userId, featureKey, enabled);
  await logAdminAction(env, admin.id, "feature_flag_override", userId, { featureKey, enabled }, request);
  return ok({ userId, featureKey, enabled });
}

// GET /api/admin/identity — platform legal identity (company details + disclosures)
export async function handleGetIdentity(request, env) {
  const { res } = await requireAdminWith2fa(request, env);
  if (res) return res;

  await loadPlatformIdentity(env);
  const identity = getPlatformIdentity();
  return ok({ identity: { ...identity, complete: isIdentityComplete(identity) } });
}

// PUT /api/admin/identity — update platform legal identity
export async function handleUpdateIdentity(request, env) {
  const { admin, res } = await requireAdminWith2fa(request, env);
  if (res) return res;

  const body = await readJson(request);
  if (!body || typeof body !== "object") return bad("Invalid body", 400);

  const identity = await updatePlatformIdentity(env, body, admin.id, request);
  await logAdminAction(env, admin.id, "platform_identity_update", null, {
    company_name: identity.company_name,
    company_country: identity.company_country,
    support_email: identity.support_email,
  }, request);

  return ok({ identity: { ...identity, complete: isIdentityComplete(identity) } });
}
