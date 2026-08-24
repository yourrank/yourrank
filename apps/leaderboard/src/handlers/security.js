// Security center handlers: password change, active sessions, and GDPR/CCPA export.
import { one, exec, query } from "@yourrank/shared/db";
import { hashToken } from "@yourrank/shared/crypto";
import {
  currentUser, createSession, readToken, cookieSet, destroyAllUserSessions,
  json, bad, ok, readJson, rateLimit, rateLimitHeaders, clientIp, hashPassword, verifyPassword,
} from "../auth.js";
import { updateUserPassword } from "../data/auth.js";
import { createQueueProducer } from "@yourrank/shared/queue-producer";
import { logAudit } from "@yourrank/shared/audit";
import { validatePassword } from "../password-rules.js";
import { routeContext } from "../middleware/handler.js";

async function currentSessionHash(req) {
  // If the current request just rotated the session, the new token is in
  // req._sessionCookies (set by currentUser). Otherwise read it from the request.
  const setCookies = req._sessionCookies || [];
  for (const header of setCookies) {
    const m = header.match(/(?:^|;\s*)yr_session=([^;]+)/);
    if (m) return hashToken(decodeURIComponent(m[1]));
  }
  const token = readToken(req);
  if (!token) return null;
  return hashToken(token);
}

export async function handleChangePassword(request, env) {
  try {
    if (!(await rateLimit(env, `password-change:${clientIp(request)}`, 10, 3600)).ok) {
      return bad("Too many attempts. Try again later.", 429);
    }
    const user = await currentUser(request, env);
    if (!user) return bad("unauthorized", 401);

    const body = await readJson(request);
    const current = String(body?.currentPassword || "");
    const password = String(body?.password || "");
    if (!current || !password) return bad("Current password and new password are required");
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.ok) return bad(passwordCheck.message);

    const row = await one("SELECT password_hash, password_salt FROM users WHERE id=$1", [user.id]);
    if (!row?.password_hash) return bad("Password change is not available for this account", 400);

    const { ok: pwOk } = await verifyPassword(current, row.password_salt, row.password_hash);
    if (!pwOk) return bad("Current password is incorrect", 401);

    const { hash, salt } = await hashPassword(password);
    await updateUserPassword(user.id, hash, salt);
    await destroyAllUserSessions(env, user.id);
    const token = await createSession(env, user.id);

    return json({ ok: true, message: "Password updated. All other sessions have been signed out." }, 200, {
      "set-cookie": cookieSet(token, env),
    });
  } catch (e) {
    console.error("change password failed:", String(e?.message || e));
    return bad("Password change failed. Please try again.", 500);
  }
}

export async function handleListSessions(request, env) {
  try {
    const user = await currentUser(request, env);
    if (!user) return bad("unauthorized", 401);

    const currentHash = await currentSessionHash(request);
    const rows = await query(
      `SELECT token, created_at, expires_at
         FROM sessions
        WHERE user_id=$1 AND expires_at > now()
        ORDER BY created_at DESC`,
      [user.id]
    );

    const sessions = rows.map((r) => {
      const date = (d) => (d ? new Date(d).toISOString() : null);
      return {
        id: String(r.token).slice(0, 16),
        createdAt: date(r.created_at),
        expiresAt: date(r.expires_at),
        current: r.token === currentHash,
      };
    });

    return ok({ sessions });
  } catch (e) {
    console.error("list sessions failed:", String(e?.message || e));
    return bad("Could not load sessions.", 500);
  }
}

export async function handleRevokeOtherSessions(request, env) {
  try {
    const user = await currentUser(request, env);
    if (!user) return bad("unauthorized", 401);

    const currentHash = await currentSessionHash(request);
    if (!currentHash) {
      // No current token means rotation just happened or guest — sign out all.
      await destroyAllUserSessions(env, user.id);
      return ok({ signedOutAll: true });
    }

    await exec("DELETE FROM sessions WHERE user_id=$1 AND token<>$2", [user.id, currentHash]);
    return ok({ message: "Other sessions signed out." });
  } catch (e) {
    console.error("revoke sessions failed:", String(e?.message || e));
    return bad("Could not revoke sessions.", 500);
  }
}

const exportEncoder = new TextEncoder();

function exportField(key, value, first) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) return "";
  return `${first ? "" : ","}${JSON.stringify(key)}:${encoded}`;
}

async function* exportJsonChunks(userId, exportId, { oneImpl = one, queryImpl = query } = {}) {
  const one = oneImpl;
  const query = queryImpl;
  let first = true;
  const field = async function* (key, value) {
    const chunk = exportField(key, value, first);
    if (!chunk) return;
    first = false;
    yield exportEncoder.encode(chunk);
  };

  yield exportEncoder.encode(`{"ok":true,"exportId":${JSON.stringify(exportId)},"data":{`);
  yield* field("exportedAt", new Date().toISOString());

  const userCols = `id, email, display_name, telegram_user_id, telegram_username,
    telegram_linked_at, plan, plan_expires_at, status, is_admin, email_verified,
    created_at, updated_at, has_trial, failed_login_count, locked_until`;
  let user = await one(`SELECT ${userCols} FROM users WHERE id=$1`, [userId]);
  yield* field("user", user);
  user = null;

  let sites = await query(
    `SELECT id, slug, name, tagline, casino, code, cta_url, prize_pool, period, ends_at,
            reset_note, blurb, extra_json, published, theme_json, updated_at, custom_domain,
            domain_status, suspended, telegram_chat_id, telegram_notify
       FROM sites WHERE user_id=$1`,
    [userId]
  );
  yield* field("sites", sites);

  const siteIds = sites.map((s) => s.id);
  sites = null;
  let players = siteIds.length
    ? await query("SELECT * FROM players WHERE site_id = ANY($1)", [siteIds])
    : [];
  yield* field("players", players);
  players = null;

  let archives = siteIds.length
    ? await query("SELECT * FROM archives WHERE site_id = ANY($1)", [siteIds])
    : [];
  yield* field("archives", archives);
  archives = null;

  let subscriptions = await query("SELECT id, plan, status, provider, current_period_end, created_at FROM subscriptions WHERE user_id=$1", [userId]);
  yield* field("subscriptions", subscriptions);
  subscriptions = null;
  let payments = await query("SELECT id, subscription_id, provider, invoice_id, amount, currency, tx_ref, status, created_at, updated_at, plan_tier FROM payments WHERE user_id=$1", [userId]);
  yield* field("payments", payments);
  payments = null;
  let sessions = await query("SELECT created_at, expires_at, twofa_verified FROM sessions WHERE user_id=$1", [userId]);
  yield* field("sessions", sessions);
  sessions = null;
  let offers = await query("SELECT id, casino_id, label, referral_url, promo_code, bonus_text, priority, is_active, created_at, updated_at FROM offers WHERE owner_id=$1", [userId]);
  yield* field("offers", offers);
  const offerIds = offers.map((o) => o.id);
  offers = null;
  let shortLinks = offerIds.length
    ? await query("SELECT sl.id, sl.offer_id, sl.slug, sl.source, sl.created_at FROM short_links sl WHERE sl.offer_id = ANY($1)", [offerIds])
    : [];
  yield* field("shortLinks", shortLinks);
  shortLinks = null;
  let conversions = await query("SELECT id, offer_id, click_ref, event, amount, currency, raw, ts FROM conversions WHERE owner_id=$1", [userId]);
  yield* field("conversions", conversions);
  conversions = null;
  let bots = await query("SELECT id, tg_bot_id, username, token_hint, status, welcome_message, created_at, updated_at FROM bots WHERE owner_id=$1", [userId]);
  yield* field("bots", bots);
  const botIds = bots.map((b) => b.id);
  bots = null;

  let botCommands = botIds.length
    ? await query("SELECT bot_id, command, response, offer_id, is_enabled FROM bot_commands WHERE bot_id = ANY($1)", [botIds])
    : [];
  yield* field("botCommands", botCommands);
  botCommands = null;
  let broadcasts = botIds.length
    ? await query("SELECT id, bot_id, status, body, media_url, buttons, scheduled_at, sent_at, total_count, sent_count, fail_count, segment, created_at FROM broadcasts WHERE bot_id = ANY($1)", [botIds])
    : [];
  yield* field("broadcasts", broadcasts);
  broadcasts = null;
  let botSubscribers = botIds.length
    ? await query("SELECT id, bot_id, tg_user_id, tg_username, first_name, language, is_blocked, first_seen, last_seen FROM bot_subscribers WHERE bot_id = ANY($1)", [botIds])
    : [];
  yield* field("botSubscribers", botSubscribers);
  botSubscribers = null;
  let postbackKeys = await query("SELECT id, label, key_hash, created_at, revoked_at, expires_at, last_used_at FROM postback_keys WHERE user_id=$1", [userId]);
  yield* field("postbackKeys", postbackKeys);
  postbackKeys = null;
  let featureOverrides = await query("SELECT feature_key, enabled, created_at, updated_at FROM user_feature_overrides WHERE user_id=$1", [userId]);
  yield* field("featureOverrides", featureOverrides);
  featureOverrides = null;
  let onboardingEmails = await query("SELECT day, sent_at FROM user_onboarding_emails WHERE user_id=$1", [userId]);
  yield* field("onboardingEmails", onboardingEmails);
  onboardingEmails = null;
  let referralRewards = await query("SELECT referrer_id, referred_id, reward_days, created_at FROM referral_rewards WHERE referrer_id=$1 OR referred_id=$1", [userId]);
  yield* field("referralRewards", referralRewards);
  referralRewards = null;

  let auditLog = await query("SELECT id, action, entity_type, entity_id, details, ip_address, user_agent, created_at FROM audit_log WHERE actor_id=$1", [userId]);
  yield* field("auditLog", auditLog);
  auditLog = null;
  let adminAudit = await query("SELECT id, admin_id, target_user_id, action, details, ip_address, user_agent, created_at FROM admin_audit WHERE admin_id=$1 OR target_user_id=$1", [userId]);
  yield* field("adminAudit", adminAudit);
  adminAudit = null;
  let supportMessages = await query("SELECT id, name, email, subject, message, status, ip_hash, created_at, updated_at FROM support_messages WHERE user_id=$1", [userId]);
  yield* field("supportMessages", supportMessages);
  supportMessages = null;
  let siteStatsHourly = siteIds.length
    ? await query("SELECT site_id, day, hour, day_of_week, views FROM site_stats_hourly WHERE site_id = ANY($1)", [siteIds])
    : [];
  yield* field("siteStatsHourly", siteStatsHourly);
  siteStatsHourly = null;
  let siteReferrers = siteIds.length
    ? await query("SELECT site_id, day, domain, count FROM site_referrers WHERE site_id = ANY($1)", [siteIds])
    : [];
  yield* field("siteReferrers", siteReferrers);
  siteReferrers = null;

  yield exportEncoder.encode("}}");
}

export async function handleExportData(request, env, {
  currentUserImpl = currentUser,
  rateLimitImpl = rateLimit,
  oneImpl = one,
  queryImpl = query,
} = {}) {
  try {
    const user = await currentUserImpl(request, env);
    if (!user) return bad("unauthorized", 401);
    const rl = await rateLimitImpl(env, `account-export:${user.id}`, 2, 3600);
    if (!rl.ok) return bad("Too many exports. Try again later.", 429, rateLimitHeaders(rl));

    const exportId = `${Date.now()}-${user.id}`;
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of exportJsonChunks(user.id, exportId, { oneImpl, queryImpl })) {
            controller.enqueue(chunk);
          }
          controller.close();
        } catch (e) {
          console.error("data export stream failed:", String(e?.message || e));
          controller.error(e);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="yourrank-export-${exportId}.json"`,
      },
    });
  } catch (e) {
    console.error("data export failed:", String(e?.message || e));
    return bad("Data export failed. Please try again.", 500);
  }
}

const EXPORT_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function handleCreateExportJob(request, env, {
  currentUserImpl = currentUser,
  rateLimitImpl = rateLimit,
  oneImpl = one,
  execImpl = exec,
  sendImpl,
  logAuditImpl = logAudit,
} = {}) {
  try {
    const user = await currentUserImpl(request, env);
    if (!user) return bad("unauthorized", 401);
    if (!env.ACCOUNT_EXPORTS) {
      console.error("account export unavailable: ACCOUNT_EXPORTS R2 binding is not configured");
      return bad("Data export is temporarily unavailable. Please try again later.", 503);
    }
    const rl = await rateLimitImpl(env, `account-export:${user.id}`, 2, 3600);
    if (!rl.ok) return bad("Too many exports. Try again later.", 429, rateLimitHeaders(rl));

    const existing = await oneImpl(
      `SELECT id, status, created_at, expires_at, error FROM account_export_jobs
         WHERE user_id=$1 AND status IN ('pending', 'processing') AND expires_at > now()
         ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );
    if (existing) return ok({ exportId: existing.id, status: existing.status, createdAt: existing.created_at, expiresAt: existing.expires_at });

    const exportId = crypto.randomUUID();
    try {
      await execImpl(
        `INSERT INTO account_export_jobs (id, user_id, status, expires_at)
         VALUES ($1, $2, 'pending', now() + make_interval(secs => $3))`,
        [exportId, user.id, EXPORT_TTL_SECONDS]
      );
    } catch (error) {
      if (!/duplicate|unique/i.test(String(error?.message || error))) throw error;
      const duplicate = await oneImpl(
        `SELECT id, status, created_at, expires_at FROM account_export_jobs
           WHERE user_id=$1 AND status IN ('pending', 'processing') AND expires_at > now()
           ORDER BY created_at DESC LIMIT 1`,
        [user.id]
      );
      if (duplicate) return ok({ exportId: duplicate.id, status: duplicate.status, createdAt: duplicate.created_at, expiresAt: duplicate.expires_at });
      throw error;
    }
    await logAuditImpl({ actorId: user.id, action: "account_export_requested", entityType: "account_export", entityId: exportId, request, details: { export_id: exportId, status: "pending" } });
    try {
      if (sendImpl) await sendImpl({ type: "account-export", exportId, userId: user.id });
      else {
        const producer = createQueueProducer(env.EVENTS_QUEUE, async () => {
          throw new Error("EVENTS_QUEUE binding is not configured");
        });
        await producer.send({ type: "account-export", exportId, userId: user.id });
      }
    } catch (error) {
      await execImpl("UPDATE account_export_jobs SET status='failed', error=$1, completed_at=now() WHERE id=$2", [String(error?.message || error).slice(0, 500), exportId]).catch(() => {});
      await logAuditImpl({ actorId: user.id, action: "account_export_failed", entityType: "account_export", entityId: exportId, request, details: { export_id: exportId, status: "failed" } });
      console.error("account export enqueue failed:", String(error?.message || error));
      return bad("Could not start data export. Please try again.", 503);
    }
    return ok({ exportId, status: "pending" });
  } catch (e) {
    console.error("account export job creation failed:", String(e?.message || e));
    return bad("Could not start data export. Please try again.", 500);
  }
}

export async function handleExportJobStatus(request, env, {
  currentUserImpl = currentUser,
  oneImpl = one,
} = {}) {
  try {
    const user = await currentUserImpl(request, env);
    if (!user) return bad("unauthorized", 401);
    const id = routeContext(request).slug || new URL(request.url).searchParams.get("id");
    const job = await oneImpl(
      `SELECT id, status, error, manifest, created_at, started_at, completed_at, expires_at
         FROM account_export_jobs WHERE id=$1 AND user_id=$2`,
      [id, user.id]
    );
    if (!job) return bad("not found", 404);
    if (new Date(job.expires_at).getTime() <= Date.now()) return ok({ exportId: job.id, status: "expired", expiresAt: job.expires_at });
    return ok({ exportId: job.id, status: job.status, error: job.error, manifest: job.manifest, createdAt: job.created_at, startedAt: job.started_at, completedAt: job.completed_at, expiresAt: job.expires_at });
  } catch (e) {
    console.error("account export status failed:", String(e?.message || e));
    return bad("Could not load export status.", 500);
  }
}

export async function handleExportJobDownload(request, env, {
  currentUserImpl = currentUser,
  oneImpl = one,
} = {}) {
  try {
    const user = await currentUserImpl(request, env);
    if (!user) return bad("unauthorized", 401);
    const id = routeContext(request).slug || new URL(request.url).searchParams.get("id");
    const job = await oneImpl(
      `SELECT id, status, artifact_key, expires_at FROM account_export_jobs WHERE id=$1 AND user_id=$2`,
      [id, user.id]
    );
    if (!job || job.status !== "completed" || !job.artifact_key || new Date(job.expires_at).getTime() <= Date.now()) return bad("Export is not available.", 404);
    if (!env.ACCOUNT_EXPORTS) {
      console.error("account export download unavailable: ACCOUNT_EXPORTS R2 binding is not configured");
      return bad("Data export is temporarily unavailable.", 503);
    }
    const object = await env.ACCOUNT_EXPORTS.get(job.artifact_key);
    if (!object) return bad("Export artifact is no longer available.", 404);
    return new Response(object.body, {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": `attachment; filename="yourrank-export-${job.id}.ndjson"`,
      },
    });
  } catch (e) {
    console.error("account export download failed:", String(e?.message || e));
    return bad("Could not download export.", 500);
  }
}
