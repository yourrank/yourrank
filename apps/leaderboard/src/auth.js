// Auth helpers for the Worker.
import { one, withTransaction } from "@yourrank/shared/db";
import { rateLimit as kvRateLimit } from "@yourrank/shared/ratelimit";
// SHARED cross-Worker session: same cookie (yr_session) + same Postgres
// sessions table as the bot Worker. See packages/shared/src/session.ts
import {
  createSession as _createSession,
  destroySession as _destroySession,
  destroyAllUserSessions as _destroyAllUserSessions,
  cookieSet as _cookieSet,
  cookieClear as _cookieClear,
  // SEC-107: session resolution (DB-backed, handles rotation + TTL refresh)
  resolveSession as _resolveSession,
  readToken as _readToken,
  // SEC-104: legacy cookie helpers
  hasLegacyCookie,
  cookieClearLegacy,
  SESSION_TTL_S,
  SESSION_ROTATE_AFTER_S,
} from "@yourrank/shared/session";

// Re-export session primitives so callers that import from auth.js still work.
// Token reading MUST come from the shared module: it applies the
// LEGACY_GM_SESSION_CUTOFF, so a local copy would keep honouring the retired
// gm_session cookie after resolveSession() has stopped accepting it.
export const readToken = (req) => _readToken(req);
export { SESSION_TTL_S, SESSION_ROTATE_AFTER_S };

const hex = (buf) => [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
const bytesToHex = hex;

// Password hashing (PBKDF2-SHA256) and constant-time comparison.
// Cloudflare Workers' crypto.subtle.deriveBits supports at most 100k PBKDF2
// iterations; values above that throw "Pbkdf2 failed: iteration counts above
// 100000 are not supported". This must stay <= 100k for signup/login/reset to work.
const PBKDF2_ITERATIONS = 100000;
const LEGACY_ITERATIONS = 100000;
const enc = new TextEncoder();
const _bytesToHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const hexToBytes = (h) => {
  const o = new Uint8Array(h.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16);
  return o;
};

function parseStored(stored) {
  const s = String(stored ?? "");
  const i = s.indexOf("$");
  if (i > 0 && /^\d+$/.test(s.slice(0, i))) return { iterations: Number(s.slice(0, i)), hash: s.slice(i + 1) };
  return { iterations: LEGACY_ITERATIONS, hash: s };
}

export async function hashPassword(password, saltHex) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, km, 256);
  return { salt: _bytesToHex(salt), hash: `${PBKDF2_ITERATIONS}$${_bytesToHex(new Uint8Array(bits))}` };
}

export function safeEqual(a, b) {
  const sa = String(a ?? "");
  const sb = String(b ?? "");
  let diff = sa.length ^ sb.length;
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    diff |= (sa.charCodeAt(i) ?? 0) ^ (sb.charCodeAt(i) ?? 0);
  }
  return diff === 0;
}

export async function verifyPassword(password, saltHex, expected) {
  const { iterations, hash: expectedHex } = parseStored(expected);
  const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: hexToBytes(saltHex), iterations, hash: "SHA-256" }, km, 256);
  const computed = _bytesToHex(new Uint8Array(bits));
  return { ok: safeEqual(computed, expectedHex), needsRehash: iterations < PBKDF2_ITERATIONS };
}

export const uuid = () => crypto.randomUUID();
export const newToken = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));

const REFERRAL_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const REFERRAL_ALPHABET_LEN = REFERRAL_ALPHABET.length;
const REFERRAL_REJECT_CUTOFF = 256 - (256 % REFERRAL_ALPHABET_LEN);
function randReferralChar() {
  // Rejection sampling removes modulo bias from 8-bit random values.
  let n;
  do { n = crypto.getRandomValues(new Uint8Array(1))[0]; } while (n >= REFERRAL_REJECT_CUTOFF);
  return REFERRAL_ALPHABET[n % REFERRAL_ALPHABET_LEN];
}
export function newReferralCode(length = 8) {
  let code = "";
  for (let i = 0; i < length; i++) code += randReferralChar();
  return code;
}
export async function generateUniqueReferralCode() {
  for (let i = 0; i < 5; i++) {
    const code = newReferralCode();
    const existing = await one("SELECT 1 FROM users WHERE referral_code=$1", [code]);
    if (!existing) return code;
  }
  // Last resort: append a random digit to reduce collisions.
  return newReferralCode(10);
}

// Session mechanics delegate to the SHARED module (Postgres-backed).
export const createSession = (env, userId) => _createSession(env, userId);
export const destroySession = (env, token) => _destroySession(env, token);
export const destroyAllUserSessions = (env, userId) => _destroyAllUserSessions(env, userId);
export const cookieSet = (token, env) => _cookieSet(token, env);
export const cookieClear = (env) => _cookieClear(env);

// SEC-104: Legacy cookie detection helper — re-exported for index.js
export { hasLegacyCookie, cookieClearLegacy };

// Loads the full user row from Postgres for a resolved user id.
const loadUser = (env, uid) =>
    one(
      `SELECT id, email, display_name, plan,
              (EXTRACT(EPOCH FROM plan_expires_at) * 1000)::double precision AS plan_expires_at,
              status, is_admin, email_verified,
              telegram_user_id, telegram_username,
              (EXTRACT(EPOCH FROM created_at) * 1000)::double precision AS created_at,
              referral_code,
              active_site_id,
              kick_user_id, kick_username, kick_linked_at
         FROM users WHERE id=$1`,
      [uid]
    );

// SEC-107: Resolves the current user from the shared session using DB-backed
// resolveSession (handles rotation + TTL refresh automatically).
// When a session is rotated, the new Set-Cookie header is attached to
// req._sessionCookies for the main handler to include in the response.
export async function currentUser(req, env) {
    const { userId, cookie } = await _resolveSession(req, env);
    if (!userId) return null;

    const u = await loadUser(env, userId);
    // SEC-AUDIT-01: suspended accounts cannot act through an existing session.
    if (!u || u.status === "suspended") return null;

    // If a rotation happened, propagate the new cookie
    if (cookie) {
      if (!req._sessionCookies) req._sessionCookies = [];
      req._sessionCookies.push(cookie);
    }

    // SEC-104: If the request carries a legacy 'sess' cookie, schedule it for clearing
    if (hasLegacyCookie(req)) {
      if (!req._sessionCookies) req._sessionCookies = [];
      req._sessionCookies.push(cookieClearLegacy());
    }

    return u;
}

// Rate limit wrapper — delegates to the shared rate limiter.
// With KV removed, passes full env so DO backend is used when RL_BACKEND=do.
export async function rateLimit(env, key, limit, ttlSeconds) {
  return kvRateLimit(env, key, limit, ttlSeconds);
}
export const clientIp = (req) => req.headers.get("cf-connecting-ip") || "0.0.0.0";

export async function requireUser(req, env) {
  const u = await currentUser(req, env);
  // B-05: Was a manual new Response(). Now routes through the shared bad() helper.
  if (!u) return { user: null, res: bad("You need to sign in.", 401) };
  return { user: u, res: null };
}

export const isEmail = (s) => typeof s === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
export function slugify(s) {
  return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
// Slugs a board can never take, because the Worker already serves that path.
// `demo` belongs here: signup happily handed it out, and the new board then sat
// behind the hardcoded demo tour at /demo, unreachable to its owner.
export const RESERVED = new Set(["api", "assets", "login", "signup", "logout", "dashboard", "admin", "account", "billing", "favicon", "robots", "sitemap", "index", "forgot", "reset", "terms", "privacy", "responsible", "logo", "go", "stats", "bot", "hook", "r", "pb", "health", "demo", "invite"]);
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
export const bad = (msg, status = 400, headers = {}) => json({ ok: false, error: msg }, status, headers);
export const ok = (data = {}) => json({ ok: true, ...data });

export function rateLimitHeaders(rl) {
  const h = { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining) };
  if (rl.retryAfter > 0) h["Retry-After"] = String(rl.retryAfter);
  return h;
}
export const readJson = async (req) => {
  if (req.validatedBody !== undefined) return req.validatedBody;
  try { return await req.json(); } catch { return null; }
};
export const readJsonLimited = async (req, maxBytes) => {
  if (req.validatedBody !== undefined) return { value: req.validatedBody, tooLarge: false };
  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return { value: null, tooLarge: true };
  if (!req.body) return { value: null, tooLarge: false };

  const reader = req.body.getReader();
  const chunks = [];
  let total = 0;
  let reading = true;
  try {
    while (reading) {
      const { done, value } = await reader.read();
      if (done) {
        reading = false;
        continue;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { value: null, tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { value: JSON.parse(new TextDecoder().decode(bytes)), tooLarge: false };
  } catch {
    return { value: null, tooLarge: false };
  }
};


export async function handleAccountDelete(request, env) {
    try {
      if (!(await rateLimit(env, `account-delete:${clientIp(request)}`, 5, 3600)).ok) {
        return bad("Too many attempts. Try again later.", 429);
      }
      const user = await currentUser(request, env);
      if (!user) return bad("unauthorized", 401);
      const userPw = await one("SELECT password_hash, password_salt FROM users WHERE id=$1", [user.id]);
      if (userPw?.password_hash) {
        const body = await readJson(request);
        if (!body || !body.password) return bad("Password required to confirm deletion");
        const { ok: pwOk } = await verifyPassword(body.password, userPw.password_salt, userPw.password_hash);
        if (!pwOk) return bad("Incorrect password", 401);
      }

      await withTransaction(async (tx) => {
        // Tables without ON DELETE CASCADE FKs to sites need explicit cleanup.
        const sites = await tx.query("SELECT id FROM sites WHERE user_id=$1", [user.id]);
        const siteIds = sites.map((s) => s.id);
        if (siteIds.length) {
          await tx.unsafe("DELETE FROM site_stats_hourly WHERE site_id = ANY($1)", [siteIds]);
          await tx.unsafe("DELETE FROM site_referrers WHERE site_id = ANY($1)", [siteIds]);
        }

        // Delete logs and support messages that contain or reference this user.
        await tx.unsafe("DELETE FROM audit_log WHERE actor_id=$1", [user.id]);
        await tx.unsafe("DELETE FROM admin_audit WHERE admin_id=$1 OR target_user_id=$1", [user.id]);
        await tx.unsafe("DELETE FROM support_messages WHERE user_id=$1", [user.id]);

        // Foreign keys handle the rest (sites, offers, bots, payments, sessions,
        // etc.), but referral rows reference users directly.
        await tx.unsafe("DELETE FROM referral_rewards WHERE referrer_id=$1 OR referred_id=$1", [user.id]);

        await tx.unsafe("DELETE FROM users WHERE id=$1", [user.id]);
      });
      // Destroy all sessions (other devices/tabs) — don't leave orphaned
      // sessions for a deleted user.
      await destroyAllUserSessions(env, user.id);

      return json({ ok: true, message: "Account deleted successfully." }, 200, {
        "Set-Cookie": cookieClear(env)
      });
  } catch (e) {
    console.error("account delete failed:", String(e?.message || e));
    return bad("Account deletion failed. Please try again.", 500);
  }
}
