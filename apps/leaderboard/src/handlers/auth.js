import { withTransaction as defaultWithTransaction, one as defaultOne, exec as defaultExec } from "@yourrank/shared/db";
// Authentication handlers for signup, login, logout, password reset
import { hashPassword, verifyPassword, uuid, newToken, createSession, destroySession, destroyAllUserSessions, currentUser, isEmail, slugify, RESERVED, cookieSet, cookieClear, readToken, json, bad, ok, readJson, rateLimit, clientIp, generateUniqueReferralCode } from "../auth.js";
import { hashToken } from "@yourrank/shared/crypto";
import { routeContext } from "../middleware/handler.js";
import { trackActivation } from "@yourrank/shared/activation-funnel";
import { createBoard, getUserBoardsList } from "../site.js";
import { sendEmail, resetEmail, sendOnboardingEmail, sendVerificationEmail } from "../email.js";
import { validatePassword } from "../password-rules.js";
import { effectivePlan, PLAN_LIMITS, BOARD_LIMITS, priceUsd } from "@yourrank/shared/plans";
import { getEnabledFeatureKeys } from "@yourrank/shared/features";
import {
  findUserByEmail, findSiteBySlug, findUserByReferralCode, createUser
} from "../data/auth.js";

const defaultDependencies = {
  withTransaction: defaultWithTransaction,
  one: defaultOne,
  exec: defaultExec,
  destroyAllUserSessions,
  createSession,
  cookieSet,
};
const withTransaction = defaultWithTransaction;
const one = defaultOne;
const exec = defaultExec;

const REFERRAL_REWARD_DAYS = 31;
const REFERRAL_MAX_EXTENSION_DAYS = 365;
const VERIFICATION_TTL_HOURS = 24;

export function emailVerificationDeliveryState(env = {}) {
  const environment = String(env.ENVIRONMENT || "").trim().toLowerCase();
  const required = environment === "production" || environment === "staging";
  return {
    configured: Boolean(String(env.RESEND_API_KEY || "").trim() && String(env.MAIL_FROM || "").trim()),
    required,
  };
}

async function issueVerificationEmail(env, userId, email, origin, sendVerificationEmailImpl = sendVerificationEmail) {
  const token = newToken();
  const tokenHash = await hashToken(token);
  await exec(
    "UPDATE users SET email_verification_token_hash=$1, email_verification_sent_at=now() WHERE id=$2",
    [tokenHash, userId]
  );
  const link = `${origin}/verify-email?token=${encodeURIComponent(token)}`;
  try {
    const result = await sendVerificationEmailImpl(env, email, link);
    if (!result?.sent) console.error("[verification] email not sent:", result?.reason || "unknown");
    return result || { sent: false, reason: "unknown" };
  } catch (err) {
    console.error("[verification] email failed:", String(err?.message || err));
    return { sent: false, reason: "exception" };
  }
}

async function applyReferralReward(referrerId, referredId) {
  if (!referrerId || !referredId || referrerId === referredId) return;
  const referrer = await one(
    "SELECT plan, (EXTRACT(EPOCH FROM plan_expires_at) * 1000)::double precision AS plan_expires_at FROM users WHERE id=$1",
    [referrerId]
  );
  if (!referrer) return;
  const now = Date.now();
  const currentExpiry = Number(referrer.plan_expires_at) || now;
  const base = currentExpiry > now ? currentExpiry : now;
  const maxMs = now + REFERRAL_MAX_EXTENSION_DAYS * 86400000;
  const newExpiry = Math.min(base + REFERRAL_REWARD_DAYS * 86400000, maxMs);
  const newPlan = effectivePlan(referrer) === "team" ? "team" : "pro";
  await withTransaction(async (tx) => {
    await tx.unsafe(
      "INSERT INTO referral_rewards (referrer_id, referred_id, reward_days) VALUES ($1, $2, $3) ON CONFLICT (referred_id) DO NOTHING",
      [referrerId, referredId, REFERRAL_REWARD_DAYS]
    );
    await tx.unsafe(
      "UPDATE users SET plan=$1, plan_expires_at=to_timestamp($2 / 1000.0), updated_at=now() WHERE id=$3",
      [newPlan, newExpiry, referrerId]
    );
  });
}

export async function handleSignup(request, env) {
  try {
    const delivery = emailVerificationDeliveryState(env);
    if (delivery.required && !delivery.configured) {
      return bad("Account creation is temporarily unavailable because email delivery is not configured.", 503);
    }
    if (!(await rateLimit(env, `signup:${clientIp(request)}`, 10, 3600)).ok) return bad("Too many attempts. Try again later.", 429);
    const body = await readJson(request);
    if (!body) return bad("Invalid request");
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    const refCode = String(body.ref || "").trim().toLowerCase();
    const defaultName = name || email.split("@")[0] || "my-board";
    // A URL the streamer typed is a choice, not a suggestion: signup used to
    // silently hand out `<slug>-2` (or a random suffix for reserved words), so
    // people learned their public URL only after their first share link failed.
    const requestedSlug = slugify(body.slug || "");
    let slug = requestedSlug || slugify(defaultName);
    if (!isEmail(email)) return bad("Enter a valid email");
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.ok) return bad(passwordCheck.message);
    if (requestedSlug && RESERVED.has(requestedSlug)) {
      return json({ ok: false, error: "That page URL is reserved. Pick another.", field: "slug" }, 400);
    }
    if (!slug || RESERVED.has(slug)) slug = `${slug || "site"}-${Math.random().toString(36).slice(2, 6)}`;
    const existing = await findUserByEmail(email);
    if (existing) return bad("If this email isn't already registered, check your inbox to confirm.");
    if (requestedSlug && await findSiteBySlug(requestedSlug)) {
      return json({ ok: false, error: "That page URL is already taken. Pick another.", field: "slug" }, 400);
    }
    let finalSlug = slug;
    for (let n = 2; ; n++) { const c = await findSiteBySlug(finalSlug); if (!c) break; finalSlug = `${slug}-${n}`; }
    const displayName = name || defaultName;
    const { hash, salt } = await hashPassword(password);
    const userId = uuid();

    let referrerId = null;
    if (refCode) {
      const referrer = await findUserByReferralCode(refCode);
      if (referrer) referrerId = referrer.id;
    }

    // created_at/updated_at default to now(); id generated in-app for consistency.
    // The slug check above is a TOCTOU race: two concurrent signups choosing the
    // same slug can both pass the SELECT, then the second INSERT hits sites.slug
    // UNIQUE and threw an unhandled 500. Wrap the inserts; on a unique violation
    // (23505) on the slug or referral_code, regenerate and retry once.
    let referralCode = await generateUniqueReferralCode();
    let created = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await withTransaction(async (tx) => {
          await createUser(tx, userId, email, hash, salt, referralCode, referrerId);
          const board = await createBoard(env, userId, { slug: finalSlug, name: displayName, published: false, is_draft: true, seed: true }, request, tx);
          if (!board.ok) throw new Error(board.error || "board_create_failed");
        });
        created = true;
        break;
      } catch (e) {
        const msg = String(e?.message || e);
        if (/23505/.test(msg) && attempt < 2) {
          if (/referral_code/i.test(msg)) {
            referralCode = await generateUniqueReferralCode();
          } else {
            // unique violation — likely the slug raced; retry with a fresh suffix
            finalSlug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
          }
          continue;
        }
        // users.email UNIQUE collision (already checked above, but concurrent) or
        // a real error: surface a clean message, never a raw 500.
        return bad("If this email isn't already registered, check your inbox to confirm.");
      }
    }
    if (!created) return bad("Sign-up failed, please try again", 500);

    if (referrerId) {
      const rewardPromise = applyReferralReward(referrerId, userId).catch((err) => console.error("[signup] referral reward failed:", err));
      routeContext(request).waitUntil(rewardPromise);
    }

    const token = await createSession(env, userId);
    const origin = new URL(request.url).origin;
    const verification = await issueVerificationEmail(env, userId, email, origin);
    const onboardingPromise = sendOnboardingEmail(env, 0, { id: userId, email, display_name: displayName, slug: finalSlug, origin });
    routeContext(request).waitUntil(onboardingPromise.catch((err) => console.error("[signup] onboarding day 0 failed:", err)));
    trackActivation("leaderboard", userId, "signup", { email, referred: !!referrerId });
    return json({ ok: true, user: { id: userId, email, slug: finalSlug, emailVerified: false }, needsVerification: true, verificationSent: verification.sent === true }, 200, { "set-cookie": cookieSet(token, env) });
  } catch (e) {
    console.error("signup failed:", String(e?.message || e));
    return bad("Sign-up failed, please try again", 500);
  }
}

export async function handleLogin(request, env) {
  try {
    // SEC-110: IP-based rate limit
    if (!(await rateLimit(env, `login:${clientIp(request)}`, 20, 600)).ok) return bad("Too many attempts. Try again in a few minutes.", 429);
    const body = await readJson(request);
    if (!body) return bad("Invalid request");
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!isEmail(email) || !password) return bad("Email and password required");
    // SEC-110: Per-account rate limit (prevents brute-force across multiple IPs)
    if (!(await rateLimit(env, `login-email:${email}`, 10, 900)).ok) return bad("Too many attempts on this account. Try again later.", 429);
    // QA-002: Check per-account lockout before password verification
    const user = await one("SELECT id,email,password_hash,password_salt,status,email_verified,failed_login_count,locked_until FROM users WHERE email=$1", [email]);
    if (user?.locked_until && new Date(user.locked_until) > new Date()) {
      return bad("Account temporarily locked due to too many failed attempts. Try again later.", 429);
    }
    if (!user || !user.password_hash) return bad("Incorrect email or password", 401);
    const { ok, needsRehash } = await verifyPassword(password, user.password_salt, user.password_hash);
    if (!ok) {
      // QA-002: Increment failed login counter; lock account after 10 failures
      await exec("UPDATE users SET failed_login_count = failed_login_count + 1 WHERE email=$1", [email]);
      if ((user.failed_login_count || 0) + 1 >= 10) {
        await exec("UPDATE users SET locked_until = NOW() + INTERVAL '30 minutes' WHERE email=$1", [email]);
      }
      return bad("Incorrect email or password", 401);
    }
    // QA-002: Successful login — reset lockout counter
    await exec("UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE email=$1", [email]);
    // BE-014: Use generic error even for suspended accounts to prevent
    // account enumeration. Previously the suspended message confirmed the
    // email existed, distinguishing it from a wrong-password error.
    if (user.status === "suspended") return bad("Incorrect email or password", 403);
    // Lazy upgrade: if the stored hash used fewer PBKDF2 iterations than the
    // current target, re-hash at the new count and persist — no password reset
    // needed. Fire-and-forget so login latency isn't dominated by the rehash.
    if (needsRehash) {
      const { hash, salt } = await hashPassword(password);
      exec("UPDATE users SET password_hash=$1, password_salt=$2, updated_at=now() WHERE id=$3", [hash, salt, user.id]).catch(() => {});
    }
    // PERF-003-v8: Parallelize site lookup + session creation (were sequential)
    const [site, token, features] = await Promise.all([
      one("SELECT slug FROM sites WHERE user_id=$1", [user.id]),
      createSession(env, user.id),
      getEnabledFeatureKeys(user.id),
    ]);
    const origin = new URL(request.url).origin;
    if (!user.email_verified) {
      const verification = await issueVerificationEmail(env, user.id, user.email, origin);
      return json({ ok: true, user: { id: user.id, email: user.email, slug: site?.slug || null, features, emailVerified: false }, needsVerification: true, verificationSent: verification.sent === true }, 200, { "set-cookie": cookieSet(token, env) });
    }
    return json({ ok: true, user: { id: user.id, email: user.email, slug: site?.slug || null, features, emailVerified: true } }, 200, { "set-cookie": cookieSet(token, env) });
  } catch (e) {
    console.error("login failed:", String(e?.message || e));
    return bad("Login failed, please try again", 500);
  }
}

export async function handleLogout(request, env) {
  await destroySession(env, readToken(request));
  return json({ ok: true }, 200, { "set-cookie": cookieClear(env) });
}

export async function handleDemoLogin(request, env) {
  if (env.ALLOW_DEMO_LOGIN !== "true") return bad("Demo login is disabled", 404);
  if (!(await rateLimit(env, `demo:${clientIp(request)}`, 5, 3600)).ok) return bad("Too many demo attempts. Try again later.", 429);

  const email = String(env.DEMO_USER_EMAIL || "demo@yourrank.site").trim().toLowerCase();

  let user = await findUserByEmail(email);
  if (!user) {
    const { hash, salt } = await hashPassword(crypto.randomUUID());
    const userId = uuid();
    const referralCode = await generateUniqueReferralCode();
    const baseSlug = "demo-board";
    let finalSlug = baseSlug;
    for (let n = 2; ; n++) {
      const existing = await findSiteBySlug(finalSlug);
      if (!existing) break;
      finalSlug = `${baseSlug}-${n}`;
    }
    await withTransaction(async (tx) => {
      await createUser(tx, userId, email, hash, salt, referralCode, null);
      const board = await createBoard(env, userId, { slug: finalSlug, name: "Demo Board", published: false, is_draft: true, seed: true }, request, tx);
      if (!board.ok) throw new Error(board.error || "board_create_failed");
    });
    user = { id: userId };
  }

  const token = await createSession(env, user.id);
  return new Response(null, {
    status: 302,
    headers: {
      location: "/dashboard",
      "set-cookie": cookieSet(token, env),
    },
  });
}

export async function handleMe(request, env) {
  try {
    const user = await currentUser(request, env);
    if (!user) return json({ ok: false, user: null }, 401);
    const site = await one("SELECT slug FROM sites WHERE user_id=$1", [user.id]);
    const boards = await getUserBoardsList(env, user.id);
    const plan = effectivePlan(user);
    // Inspect the most recent subscription row for trial + cancellation state so
    // the billing UI can reflect "cancelled — Pro until X" instead of looking
    // identical to an active subscription after a cancel.
    let isTrial = false;
    let subscriptionStatus = null;
    try {
      const sub = await one("SELECT provider, status FROM subscriptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [user.id]);
      subscriptionStatus = sub?.status || null;
      if (plan === "pro" && user.has_trial) isTrial = sub?.provider === "trial";
    } catch (e) { console.error("[handleMe] subscription status check failed:", e); }
    const features = await getEnabledFeatureKeys(user.id);
    return json({ ok: true, user: {
      id: user.id, email: user.email, displayName: user.display_name || null,
      plan, planExpiresAt: user.plan_expires_at || 0,
      status: user.status, isAdmin: !!user.is_admin, emailVerified: !!user.email_verified,
      slug: site?.slug || null,
      limits: { players: PLAN_LIMITS[plan], boards: BOARD_LIMITS[plan] },
      proPrice: priceUsd(env, "pro"),
      hasTrial: !!user.has_trial,
      isTrial,
      subscriptionStatus,
      boards,
      features,
      referralCode: user.referral_code || null,
    } });
  } catch (e) {
    console.error("handleMe error:", String(e?.message || e), String(e?.stack || ""));
    console.error("[handleMe]", e);
    return json({ ok: false, error: "Internal error" }, 500);
  }
}

// POST /api/auth/forgot — always answers ok; never reveals whether the account exists.
// SEC-702: try/catch ensures reset tokens are never logged even if an unexpected
// error occurs during the email send or KV write.
export async function handleForgot(request, env) {
  try {
    const delivery = emailVerificationDeliveryState(env);
    if (delivery.required && !delivery.configured) {
      return bad("Password recovery is temporarily unavailable because email delivery is not configured.", 503);
    }
    if (!(await rateLimit(env, `forgot:${clientIp(request)}`, 5, 3600)).ok) return bad("Too many attempts. Try again later.", 429);
    const body = await readJson(request);
    const email = String(body?.email || "").trim().toLowerCase();
    if (!isEmail(email)) return bad("Enter a valid email");
    // Per-email rate limit: 3 resets per hour (prevents email bomb abuse).
    if (!(await rateLimit(env, `forgot-email:${email}`, 3, 3600)).ok) return bad("Too many attempts. Try again later.", 429);
    const user = await one("SELECT id, email FROM users WHERE email=$1", [email]);
    if (user && env.RESEND_API_KEY) {
      // H-09: invalidate any earlier unexpired reset token before creating a new one.
      await exec("DELETE FROM password_resets WHERE user_id=$1 AND expires_at > now()", [user.id]);
      const token = newToken();
      const tokenHash = await hashToken(token);
      await exec("INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1, $2, now() + INTERVAL '1 hour') ON CONFLICT (token) DO UPDATE SET user_id=$2, expires_at=now() + INTERVAL '1 hour'", [tokenHash, user.id]);
      const link = `${new URL(request.url).origin}/reset?token=${token}`;
      const mail = resetEmail(link);
      const result = await sendEmail(env, { to: user.email, ...mail });
      if (!result.sent) {
        // SEC-702: Log only the failure reason, never the token or link.
        // If the email can't be delivered, the token is useless; revoke it.
        await exec("DELETE FROM password_resets WHERE token=$1", [tokenHash]);
        console.error("[forgot]: email send failed", result.reason);
      }
    } else if (user && !env.RESEND_API_KEY) {
      // No email provider configured; skip generating a token so we never leave an
      // undeliverable, active reset token in the table.
      console.warn("[forgot] no email provider configured; reset not generated for", email);
    }
    return ok({ message: "If that account exists, a reset link is on its way." });
  } catch (e) {
    // SEC-702: Redact any hex tokens that may have leaked into the error message.
    console.error("[forgot] failed:", String(e?.message || e).replace(/[a-f0-9]{32,}/gi, '[REDACTED]'));
    return bad("Couldn't process your request. Please try again.", 500);
  }
}

// POST /api/auth/reset — { token, password }
// SEC-702: Wrap in try/catch that redacts the reset token before logging.
export async function handleReset(request, env, deps = defaultDependencies) {
  try {
    const body = await readJson(request);
    const token = String(body?.token || "");
    const password = String(body?.password || "");
    if (!token) return bad("Missing reset token");
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.ok) return bad(passwordCheck.message);
    const tokenHash = await hashToken(token);
    const resetRow = await deps.one("SELECT user_id FROM password_resets WHERE token=$1 AND expires_at > now()", [tokenHash]);
    const userId = resetRow?.user_id ?? null;
    if (!userId) return bad("This reset link is invalid or expired. Ask for a new one.", 400);
    const { hash, salt } = await hashPassword(password);
    // H-09: update password + delete reset token atomically.
    await deps.withTransaction(async (tx) => {
      await tx.unsafe("UPDATE users SET password_hash=$1, password_salt=$2, updated_at=now() WHERE id=$3", [hash, salt, userId]);
      await tx.unsafe("DELETE FROM password_resets WHERE token=$1", [tokenHash]);
    });
    // Revoke EVERY other live session for this user before issuing a fresh one.
    // Without this, a stolen session survives a victim-initiated reset for up to
    // the 30-day KV TTL. The per-user token index in shared/session.js makes this
    // possible without a schema change.
    await deps.destroyAllUserSessions(env, userId);
    const session = await deps.createSession(env, userId);
    return json({ ok: true }, 200, { "set-cookie": deps.cookieSet(session, env) });
  } catch (e) {
    // SEC-702: Never log the reset token — redact it from any error context.
    console.error("reset failed:", String(e?.message || e).replace(/[a-f0-9]{32,}/gi, '[REDACTED]'));
    return bad("Password reset failed. Please try again.", 500);
  }
}

// Verifies an email token. Shared by the POST API and the server-rendered
// GET /verify-email page so verification never depends on client JavaScript.
export async function verifyEmailToken(token, deps = defaultDependencies) {
  const value = String(token || "").trim();
  if (!value) return { ok: false, status: 400, error: "Verification token required" };
  try {
    const tokenHash = await hashToken(value);
    const user = await deps.one(
      "SELECT id, email_verification_sent_at FROM users WHERE email_verification_token_hash=$1 AND email_verified=false",
      [tokenHash]
    );
    if (!user) return { ok: false, status: 400, error: "This verification link is invalid or has already been used." };
    if (user.email_verification_sent_at) {
      const sentAt = new Date(user.email_verification_sent_at).getTime();
      if (Date.now() - sentAt > VERIFICATION_TTL_HOURS * 60 * 60 * 1000) {
        return { ok: false, status: 410, error: "Verification link has expired. Please sign in to request a new one." };
      }
    }
    await deps.exec(
      "UPDATE users SET email_verified=true, email_verification_token_hash=NULL, email_verification_sent_at=NULL WHERE id=$1",
      [user.id]
    );
    return { ok: true, userId: user.id };
  } catch (e) {
    console.error("[verify] failed:", String(e?.message || e).replace(/[a-f0-9]{32,}/gi, '[REDACTED]'));
    return { ok: false, status: 500, error: "Could not verify email. Please try again." };
  }
}

// POST /api/auth/verify — { token }
export async function handleVerifyEmail(request, _env) {
  let body = null;
  try { body = await readJson(request); } catch { return bad("Verification token required"); }
  const result = await verifyEmailToken(body?.token);
  if (!result.ok) return bad(result.error, result.status);
  return ok({ emailVerified: true });
}

// POST /api/auth/resend-verification — { email }
// Does not reveal whether the email exists.
export async function handleResendVerification(request, env, deps = {}) {
  try {
    const delivery = emailVerificationDeliveryState(env);
    if (delivery.required && !delivery.configured) {
      return bad("Verification email delivery is temporarily unavailable.", 503);
    }
    const body = await readJson(request);
    let email = String(body?.email || "").trim().toLowerCase();
    let authenticated = false;
    if (!isEmail(email)) {
      const signedInUser = await (deps.currentUser || currentUser)(request, env);
      email = String(signedInUser?.email || "").trim().toLowerCase();
      authenticated = isEmail(email);
    }
    if (!isEmail(email)) return bad("Enter a valid email");
    if (!(await (deps.rateLimit || rateLimit)(env, `resend-verification:${email}`, 3, 3600)).ok) {
      return bad("Too many requests. Try again later.", 429);
    }
    const user = await (deps.one || one)("SELECT id, email_verified FROM users WHERE email=$1", [email]);
    if (user && !user.email_verified) {
      const origin = new URL(request.url).origin;
      const result = await (deps.issueVerificationEmail || issueVerificationEmail)(env, user.id, email, origin);
      if (authenticated && !result?.sent) return bad("Verification email delivery is temporarily unavailable.", 503);
    }
    return ok({ sent: true });
  } catch (e) {
    console.error("[resend verification] failed:", String(e?.message || e));
    return bad("Could not resend verification email. Please try again.", 500);
  }
}
