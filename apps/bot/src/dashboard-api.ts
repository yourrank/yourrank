// API handlers module for the bot dashboard.
// Extracted from dashboard.ts to separate API handlers from routing logic.

import { Hono } from "hono";
import { config } from "./config.js";
import { one, query, exec } from "@yourrank/shared/db";
import { encryptToken, decryptToken, newLinkSlug, newWebhookSecret } from "@yourrank/shared/crypto";
import {
  POSTBACK_SUNSET,
  createPostbackKey,
  getActivePostbackKey,
  revokePostbackKeys,
} from "@yourrank/shared/postback";
import { getMe, setWebhook, deleteWebhook, getWebhookInfo, sendMessage, sendPhoto } from "./telegram.js";
import { syncMyCommands, syncMyCommandsForBot } from "./botEngine.js";
import { withPlanLimit, getUserPlan } from "./plans.js";
import { checkFeature, PLANS } from "./plans.js";
import { rateLimit } from "./ratelimit.js";
import { sameOrigin } from "./dashboard-auth.js";
import { resolveSession, type SessionEnv } from "@yourrank/shared/session";
import { type RateLimitKV } from "./ratelimit.js";
import { validatedBody, offerCreateSchema, offerToggleSchema, botCreateSchema, botWelcomeSchema, testMessageSchema, commandCreateSchema, commandUpdateSchema, broadcastSchema, broadcastSegmentSchema } from "./validation.js";
import { normalizeSegment, parseSegment, buildSegmentWhere } from "./broadcast-segment.js";
import { errMessage } from "./errors.js";

type DashApiBindings = SessionEnv & {
  SESSIONS?: RateLimitKV;
  RATE_LIMITER_DO?: any;
  RL_BACKEND?: string;
  [key: string]: unknown;
};

export function buildDashboardApi(): Hono<{ Bindings: DashApiBindings; Variables: { uid: string } }> {
  const api = new Hono<{ Bindings: DashApiBindings; Variables: { uid: string } }>();

  // Resolve session FIRST — every subsequent middleware reads c.get("uid").
  // SEC-107: Use resolveSession for rotation; propagate new cookie if rotated.
  api.use("*", async (c, next) => {
    try {
      const session = await resolveSession(c.req.raw, c.env as SessionEnv);
      if (session) {
        c.set("uid", session.uid ?? "");
        if (session.rotatedCookie) c.header("Set-Cookie", session.rotatedCookie);
      }
      await next();
    } catch (e: any) {
      console.error("[dashboard-api session middleware]", e?.message, e?.stack);
      return c.json({ error: "session_middleware_error" }, 500);
    }
  });
  // Rate-limit all API requests (120 req/min per IP).
  api.use("*", async (c, next) => {
    try {
      const ip = c.req.header("cf-connecting-ip") || "0.0.0.0";
      const rlResult = await rateLimit(c.env, `dash:${ip}`, 120, 60);
      if (!rlResult.ok) return c.json({ error: "rate limit exceeded", retryAfter: rlResult.retryAfter }, 429);
    } catch (rlErr) {
      console.error("[rate-limit] KV error, allowing request:", errMessage(rlErr));
    }
    await next();
  });




  // Auth check: verify session, check suspension status
  api.use("*", async (c, next) => {
    try {
      // CSRF: block cross-site state-changing calls that ride the session cookie.
      if (c.req.method !== "GET" && c.req.method !== "HEAD" && !sameOrigin(c.req.raw, config.publicBaseUrl)) {
        return c.json({ error: "cross-origin request rejected" }, 403);
      }
      const uid = c.get("uid");
      if (!uid) return c.json({ error: "not logged in" }, 401);
      const u = await one<{ status: string }>(`SELECT status FROM users WHERE id = $1`, [uid]);
      if (!u) return c.json({ error: "not logged in" }, 401);
      if (u.status === "suspended") return c.json({ error: "account suspended" }, 403);
      await next();
    } catch (e: any) {
      console.error("[dashboard-api auth middleware]", e?.message, e?.stack);
      return c.json({ error: "auth_middleware_error" }, 500);
    }
  });

  api.get("/me", async (c) => {
    const me = await one(
      `SELECT id, display_name, telegram_user_id, plan, created_at FROM users WHERE id = $1`,
      [c.get("uid")]
    );
    return me ? c.json(me) : c.json({ error: "gone" }, 401);
  });

  api.get("/offers", async (c) => {
    // Click totals come from the pre-aggregated click_daily rollup (the nightly
    // cron rolls raw clicks into it), NOT a full scan of the raw partitioned
    // clicks table — which grows unbounded and made this query slow at scale.
    //
    // click_daily is complete up to yesterday; today's clicks aren't rolled
    // yet, so we add today's rows from the (small) current-day raw partition.
    // Per-short_link totals are summed first, then joined onto offers, so the
    // offer<->short_link fan-out never double-counts.
    return c.json(await query(
      `WITH link_clicks AS (
         SELECT sl.id AS short_link_id,
                coalesce(sum(cd.clicks), 0)::int        AS clicks,
                coalesce(sum(cd.unique_clicks), 0)::int AS unique_clicks
           FROM short_links sl
           JOIN offers owner_offer
             ON owner_offer.id = sl.offer_id
            AND owner_offer.owner_id = $1
           LEFT JOIN click_daily cd ON cd.short_link_id = sl.id AND cd.day < current_date
          GROUP BY sl.id
       ),
       today_clicks AS (
         SELECT cl.short_link_id,
                count(*)::int                                AS clicks,
                count(*) FILTER (WHERE cl.is_unique)::int    AS unique_clicks
           FROM clicks cl
           JOIN short_links sl ON sl.id = cl.short_link_id
           JOIN offers owner_offer
             ON owner_offer.id = sl.offer_id
            AND owner_offer.owner_id = $1
          WHERE cl.ts >= current_date
          GROUP BY cl.short_link_id
       ),
       conversion_by_currency AS (
         SELECT c.offer_id,
                coalesce(nullif(upper(c.currency), ''), 'Unknown') AS currency,
                count(*)::int AS conversions,
                max(c.ts) AS last_conversion_at,
                sum(c.amount)::numeric AS amount
           FROM conversions c
          WHERE c.owner_id = $1
          GROUP BY c.offer_id, coalesce(nullif(upper(c.currency), ''), 'Unknown')
       ),
       offer_conversions AS (
         SELECT offer_id,
                sum(conversions)::int AS conversions,
                max(last_conversion_at) AS last_conversion_at,
                coalesce(
                  jsonb_agg(
                    jsonb_build_object('currency', currency, 'amount', amount)
                    ORDER BY currency
                  ) FILTER (WHERE amount IS NOT NULL),
                  '[]'::jsonb
                ) AS reported_revenue
           FROM conversion_by_currency
          GROUP BY offer_id
       ),
       click_activity AS (
         SELECT sl.offer_id,
                max(cl.ts) AS last_click_at
           FROM clicks cl
           JOIN short_links sl ON sl.id = cl.short_link_id
           JOIN offers owner_offer
             ON owner_offer.id = sl.offer_id
            AND owner_offer.owner_id = $1
          GROUP BY sl.offer_id
       )
       SELECT o.id, o.label, ca.name AS casino, o.promo_code, o.bonus_text,
              o.is_active, o.priority, sl.slug,
              (coalesce(lc.clicks, 0) + coalesce(tc.clicks, 0))::int               AS clicks,
              (coalesce(lc.unique_clicks, 0) + coalesce(tc.unique_clicks, 0))::int AS unique_clicks,
              coalesce(conv.conversions, 0)::int                                  AS conversions,
              conv.reported_revenue,
              greatest(act.last_click_at, conv.last_conversion_at)                AS last_activity_at,
              CASE WHEN (coalesce(lc.clicks, 0) + coalesce(tc.clicks, 0)) > 0
                   THEN round(((coalesce(lc.unique_clicks, 0) + coalesce(tc.unique_clicks, 0))::numeric) / (coalesce(lc.clicks, 0) + coalesce(tc.clicks, 0)), 3)::float
                   ELSE 0
              END AS ctr,
              CASE WHEN (coalesce(lc.unique_clicks, 0) + coalesce(tc.unique_clicks, 0)) > 0
                   THEN round((coalesce(conv.conversions, 0)::numeric) / (coalesce(lc.unique_clicks, 0) + coalesce(tc.unique_clicks, 0)), 3)::float
                   ELSE 0
              END AS cr
         FROM offers o
         JOIN casinos ca ON ca.id = o.casino_id
         LEFT JOIN short_links sl ON sl.offer_id = o.id
         LEFT JOIN link_clicks  lc ON lc.short_link_id = sl.id
         LEFT JOIN today_clicks tc ON tc.short_link_id = sl.id
         LEFT JOIN offer_conversions conv ON conv.offer_id = o.id
         LEFT JOIN click_activity act ON act.offer_id = o.id
        WHERE o.owner_id = $1
        ORDER BY o.priority DESC, o.created_at DESC`,
      [c.get("uid")]
    ));
  });

  api.post("/offers", async (c) => {
    const b = await validatedBody(c, offerCreateSchema);
    if (b instanceof Response) return b;
    try {
      const parsed = new URL(b.referral_url);
      if (!/^https?:$/.test(parsed.protocol)) return c.json({ error: "referral_url must use http or https" }, 400);
    } catch { return c.json({ error: "referral_url must be a valid URL" }, 400); }
    const uid = c.get("uid");

    // count-check + the inserts run atomically under a per-user advisory lock
    // so two concurrent create-offer requests can't both pass the count and
    // both insert (TOCTOU plan-limit bypass).
    const out = await withPlanLimit(uid, "offers", async (tx) => {
      const slug = b.casino.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const casinoRow = (await tx.one<{ id: string }>(
        `INSERT INTO casinos (slug, name, is_global, created_by) VALUES ($1, $2, false, $3)
         ON CONFLICT (slug) DO UPDATE SET name = casinos.name RETURNING id`,
        [slug, b.casino, uid]
      ))!;
      const offer = (await tx.one<{ id: string }>(
        `INSERT INTO offers (owner_id, casino_id, label, referral_url, promo_code, bonus_text)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [uid, casinoRow.id, b.label, b.referral_url, b.promo_code ?? null, b.bonus_text ?? null]
      ))!;
      const linkSlug = newLinkSlug();
      await tx.query(`INSERT INTO short_links (offer_id, slug, source) VALUES ($1, $2, 'telegram')`, [offer.id, linkSlug]);
      return { offer_id: offer.id, tracked_link: `${config.publicBaseUrl}/r/${linkSlug}` };
    });
    if ("error" in out) return c.json({ error: out.error }, 402);
    return c.json(out.result);
  });

  api.patch("/offers/:id", async (c) => {
    const parsed = await validatedBody(c, offerToggleSchema);
    if (parsed instanceof Response) return parsed;
    const { is_active } = parsed;
    const row = await one(
      `UPDATE offers SET is_active = $1, updated_at = now()
        WHERE id = $2 AND owner_id = $3 RETURNING id, is_active`,
      [is_active, c.req.param("id"), c.get("uid")]
    );
    return row ? c.json(row) : c.json({ error: "not found" }, 404);
  });

  api.get("/stats/daily", async (c) => {
    return c.json(await query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              coalesce(count(cl.*), 0)::int AS clicks,
              coalesce(count(cl.*) FILTER (WHERE cl.is_unique), 0)::int AS unique_clicks
         FROM generate_series(current_date - 13, current_date, '1 day') AS d(day)
         LEFT JOIN (
             SELECT cl.ts, cl.is_unique FROM clicks cl
               JOIN short_links sl ON sl.id = cl.short_link_id
               JOIN offers o ON o.id = sl.offer_id
              WHERE o.owner_id = $1 AND cl.ts > current_date - 14
         ) cl ON cl.ts::date = d.day
        GROUP BY d.day ORDER BY d.day`,
      [c.get("uid")]
    ));
  });

  // Subscriber totals + deep-link attribution (where subscribers came from).
  api.get("/stats/subscribers", async (c) => {
    const uid = c.get("uid");
    const totals = await one<{ total: number; active: number; new_7d: number; new_30d: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE NOT bs.is_blocked)::int AS active,
              count(*) FILTER (WHERE bs.first_seen > now() - interval '7 days')::int AS new_7d,
              count(*) FILTER (WHERE bs.first_seen > now() - interval '30 days')::int AS new_30d
         FROM bot_subscribers bs JOIN bots b ON b.id = bs.bot_id
        WHERE b.owner_id = $1`,
      [uid]
    );
    const sources = await query<{ source: string; count: number }>(
      `SELECT coalesce(nullif(bs.source, ''), 'direct') AS source, count(*)::int AS count
         FROM bot_subscribers bs JOIN bots b ON b.id = bs.bot_id
        WHERE b.owner_id = $1
        GROUP BY coalesce(nullif(bs.source, ''), 'direct')
        ORDER BY count DESC, source ASC LIMIT 10`,
      [uid]
    );
    return c.json({ totals: totals ?? { total: 0, active: 0, new_7d: 0, new_30d: 0 }, sources });
  });

  api.get("/bots", async (c) => {
    return c.json(await query(
      `SELECT id, username, token_hint, status, welcome_message, created_at, updated_at, last_command_sync_at FROM bots WHERE owner_id = $1 ORDER BY created_at DESC`,
      [c.get("uid")]
    ));
  });

  // Returns the bot's current webhook status from Telegram.
  // Useful for diagnosing why a connected bot isn't receiving messages.
  api.get("/bots/:id/health", async (c) => {
    const bot = await one<{ token_encrypted: Buffer; webhook_secret: string }>(
      `SELECT token_encrypted, webhook_secret FROM bots WHERE id = $1 AND owner_id = $2`,
      [c.req.param("id"), c.get("uid")]
    );
    if (!bot) return c.json({ error: "not found" }, 404);
    let token: string;
    try { token = await decryptToken(bot.token_encrypted); }
    catch (err) {
      console.error("[GET /bots/:id/health] decrypt failed:", errMessage(err));
      return c.json({ error: "could not decrypt bot token" }, 500);
    }
    try {
      const info = await getWebhookInfo(token);
      const expected = `${config.publicBaseUrl}/hook/${bot.webhook_secret}`;
      const configured = info.url === expected;
      const lastErrorAt = info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null;
      return c.json({
        ok: true,
        configured,
        url: info.url || null,
        pending_updates: info.pending_update_count ?? 0,
        last_error: info.last_error_message || null,
        last_error_at: lastErrorAt,
      });
    } catch (err) {
      const msg = errMessage(err);
      console.error("[GET /bots/:id/health] getWebhookInfo failed:", msg);
      return c.json({ ok: false, error: msg }, 500);
    }
  });

  // Disconnect a bot: remove its Telegram webhook and mark it revoked so the
  // hook endpoint stops accepting updates. This frees the bot plan slot and
  // lets the user reconnect or switch to a different bot later.
  api.post("/bots/:id/disconnect", async (c) => {
    const bot = await one<{ id: string; token_encrypted: Buffer; webhook_secret: string }>(
      `SELECT id, token_encrypted, webhook_secret FROM bots WHERE id = $1 AND owner_id = $2`,
      [c.req.param("id"), c.get("uid")]
    );
    if (!bot) return c.json({ error: "bot not found" }, 404);

    let token: string;
    try { token = await decryptToken(bot.token_encrypted); }
    catch (err) {
      console.error("[POST /bots/:id/disconnect] decrypt failed:", errMessage(err));
      return c.json({ error: "Could not decrypt stored bot token. Disconnect it manually in @BotFather, then reconnect with a fresh token." }, 500);
    }

    let webhookRemoved = false;
    try {
      await deleteWebhook(token);
      webhookRemoved = true;
    } catch (err) {
      console.error("[POST /bots/:id/disconnect] deleteWebhook failed:", errMessage(err));
    }

    const row = await one<{ id: string }>(
      `UPDATE bots SET status = 'revoked', updated_at = now() WHERE id = $1 RETURNING id`,
      [bot.id]
    );
    if (!row) return c.json({ error: "bot not found" }, 404);
    return c.json({ ok: true, webhook_removed: webhookRemoved });
  });

  // Manually re-sync a bot's Telegram command menu (custom + built-in commands).
  // Updates the bot's last_command_sync_at on success.
  api.post("/bots/:id/sync-commands", async (c) => {
    const bot = await one<{ id: string; token_encrypted: Buffer }>(
      `SELECT id, token_encrypted FROM bots WHERE id = $1 AND owner_id = $2 AND status = 'active'`,
      [c.req.param("id"), c.get("uid")]
    );
    if (!bot) return c.json({ error: "bot not found or not active" }, 404);
    try {
      await syncMyCommandsForBot(bot.id);
      const row = await one<{ last_command_sync_at: string }>(
        `SELECT last_command_sync_at FROM bots WHERE id = $1`,
        [bot.id]
      );
      return c.json({ ok: true, last_command_sync_at: row?.last_command_sync_at || null });
    } catch (err) {
      const msg = errMessage(err);
      console.error("[POST /bots/:id/sync-commands] failed:", msg);
      return c.json({ error: msg }, 502);
    }
  });

  // One-click reconnect: re-register the stored webhook with Telegram.
  // Useful when the dashboard shows the bot disconnected or after a webhook
  // failure during the initial token setup.
  api.post("/bots/:id/reconnect", async (c) => {
    const uid = c.get("uid");
    const bot = await one<{ id: string; token_encrypted: Buffer; webhook_secret: string; status: string }>(
      `SELECT id, token_encrypted, webhook_secret, status FROM bots WHERE id = $1 AND owner_id = $2`,
      [c.req.param("id"), uid]
    );
    if (!bot) return c.json({ error: "bot not found" }, 404);

    // H-20: reconnecting a revoked bot must not bypass the active-bot quota.
    if (bot.status === "revoked") {
      const plan = await getUserPlan(uid);
      const cnt = await one<{ n: number }>(
        `SELECT count(*)::int AS n FROM bots WHERE owner_id = $1 AND status <> 'revoked' AND id <> $2`,
        [uid, bot.id]
      );
      if ((cnt?.n ?? 0) >= plan.maxBots) {
        return c.json({ error: `Your ${plan.label} plan allows ${plan.maxBots} bots. Upgrade or remove an active bot first.` }, 402);
      }
    }

    let token: string;
    try { token = await decryptToken(bot.token_encrypted); }
    catch (err) {
      console.error("[POST /bots/:id/reconnect] decrypt failed:", errMessage(err));
      return c.json({ error: "Could not decrypt stored bot token. Paste the token again to reconnect." }, 500);
    }

    let me;
    try { me = await getMe(token); }
    catch (err) {
      const msg = errMessage(err);
      console.error("[POST /bots/:id/reconnect] getMe failed:", msg);
      return c.json({ error: "Telegram rejected the stored token. It may have been regenerated in @BotFather. Paste the new token to reconnect." }, 400);
    }

    const expectedUrl = `${config.publicBaseUrl}/hook/${bot.webhook_secret}`;
    try {
      await setWebhook(token, expectedUrl, bot.webhook_secret, {
        dropPendingUpdates: true,
        allowedUpdates: ["message", "callback_query"],
      });
    } catch (err) {
      const msg = errMessage(err);
      console.error("[POST /bots/:id/reconnect] setWebhook failed:", msg);
      return c.json({ error: "Telegram could not set the webhook. Check that PUBLIC_BASE_URL is correct and reachable from the internet." }, 500);
    }

    const row = await one<{ id: string; username: string }>(
      `UPDATE bots SET status = 'active', username = $1, tg_bot_id = $2, updated_at = now() WHERE id = $3 RETURNING id, username`,
      [me.username, me.id, bot.id]
    );
    if (!row) return c.json({ error: "bot not found" }, 404);
    try { await syncMyCommands(token, row.id); }
    catch (err) { console.error("[POST /bots/:id/reconnect] setMyCommands failed:", errMessage(err)); }
    return c.json({ ok: true, bot_id: row.id, username: row.username, try_it: `https://t.me/${row.username}` });
  });

  // Permanently delete a bot. Remove the webhook first so Telegram stops
  // sending updates to a secret that no longer exists in our DB.
  api.delete("/bots/:id", async (c) => {
    const bot = await one<{ id: string; token_encrypted: Buffer; status: string }>(
      `SELECT id, token_encrypted, status FROM bots WHERE id = $1 AND owner_id = $2`,
      [c.req.param("id"), c.get("uid")]
    );
    if (!bot) return c.json({ error: "bot not found" }, 404);

    let token: string;
    try { token = await decryptToken(bot.token_encrypted); }
    catch (err) {
      console.error("[DELETE /bots/:id] decrypt failed:", errMessage(err));
      return c.json({ error: "Could not decrypt stored bot token. Delete it manually in @BotFather and reconnect with a fresh token." }, 500);
    }

    if (bot.status === "active") {
      try { await deleteWebhook(token); }
      catch (err) { console.error("[DELETE /bots/:id] deleteWebhook failed:", errMessage(err)); }
    }

    const deleted = await exec(
      `DELETE FROM bots WHERE id = $1 AND owner_id = $2 RETURNING id`,
      [bot.id, c.get("uid")]
    );
    if (!deleted || deleted.length === 0) return c.json({ error: "bot not found" }, 404);
    return c.json({ ok: true });
  });

  // Send a test DM to verify the bot token works and the user can receive it.
  api.post("/bots/:id/test-message", async (c) => {
    const parsed = await validatedBody(c, testMessageSchema);
    if (parsed instanceof Response) return parsed;
    const { chat_id, text, image_url } = parsed;

    const bot = await one<{ token_encrypted: Buffer }>(
      `SELECT token_encrypted FROM bots WHERE id = $1 AND owner_id = $2`,
      [c.req.param("id"), c.get("uid")]
    );
    if (!bot) return c.json({ error: "bot not found" }, 404);

    let token: string;
    try { token = await decryptToken(bot.token_encrypted); }
    catch (err) {
      console.error("[POST /bots/:id/test-message] decrypt failed:", errMessage(err));
      return c.json({ error: "Could not decrypt stored bot token" }, 500);
    }

    // Same trim-after-validate gap as broadcasts: "   " passes min(1) but
    // Telegram rejects an empty text.
    if (!text.trim()) return c.json({ error: "text required" }, 400);
    try {
      const result = image_url
        ? await sendPhoto(token, chat_id, image_url, text.trim())
        : await sendMessage(token, chat_id, text.trim());
      return c.json({ ok: true, message_id: result.message_id });
    } catch (err) {
      const msg = errMessage(err);
      console.error("[POST /bots/:id/test-message] send failed:", msg);
      return c.json({ error: msg }, 500);
    }
  });

  api.post("/bots", async (c) => {
    const parsed = await validatedBody(c, botCreateSchema);
    if (parsed instanceof Response) return parsed;
    const { token, welcome_message } = parsed;
    // Validate the token with Telegram BEFORE taking a DB lock/transaction —
    // don't hold a Postgres advisory lock across an external HTTP call.
    let me;
    try { me = await getMe(token); }
    catch (err) {
      const msg = errMessage(err);
      console.error("[POST /bots] getMe failed:", msg);
      return c.json({ error: "Telegram rejected that token — double-check it in @BotFather" }, 400);
    }

    const uid = c.get("uid");
    const secret = newWebhookSecret();
    // encryptToken requires TOKEN_ENC_KEY to be a valid 32-byte hex secret.
    // Wrap so a misconfigured key returns a clear 500 rather than an opaque
    // Hono-default {"message":"Internal Server Error"} that the client can't
    // distinguish from a plan-limit 402 or a Telegram error 400.
    let encToken: Buffer;
    try { encToken = await encryptToken(token); }
    catch (err) {
        console.error("[POST /bots] encryptToken failed:", errMessage(err));
        return c.json({ error: "Server configuration error — could not encrypt bot token. Contact support." }, 500);
      }
    // count-check + INSERT run atomically under a per-user advisory lock so two
    // concurrent connect-bot requests can't both pass the count and both insert.
    let out: { error: string } | { result: { bot_id: string; username: string; secret: string } };
    try {
      out = await withPlanLimit(uid, "bots", async (tx) => {
        const row = (await tx.one<{ id: string; username: string }>(
          `INSERT INTO bots (owner_id, tg_bot_id, username, token_encrypted, token_hint, webhook_secret, status, welcome_message)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
           ON CONFLICT (tg_bot_id) DO UPDATE
             SET owner_id = EXCLUDED.owner_id,
                 username = EXCLUDED.username,
                 token_encrypted = EXCLUDED.token_encrypted,
                 token_hint = EXCLUDED.token_hint,
                 webhook_secret = EXCLUDED.webhook_secret,
                 status = 'pending',
                 welcome_message = COALESCE(EXCLUDED.welcome_message, bots.welcome_message),
                 updated_at = now()
           RETURNING id, username`,
          [uid, me.id, me.username, encToken, token.slice(-4), secret, welcome_message ?? null]
        ))!;
        return { bot_id: row.id, username: row.username, secret };
      });
    } catch (err) {
        const msg = errMessage(err);
        console.error("[POST /bots] DB error:", msg);
        return c.json({ error: "Database error — please try again in a moment" }, 500);
      }
    if ("error" in out) return c.json({ error: out.error }, 402);
    // H-20: set the Telegram webhook before marking the bot active. Only activate
    // once Telegram confirms the webhook is set, so a failed setWebhook never
    // leaves an active row that will not receive updates.
    try {
      await setWebhook(token, `${config.publicBaseUrl}/hook/${out.result.secret}`, out.result.secret, {
        dropPendingUpdates: true, // Onboarding: drop queued updates for clean start
        allowedUpdates: ["message", "callback_query"],
      });
    } catch (err) {
      const msg = errMessage(err);
      console.error("[POST /bots] setWebhook failed:", msg);
      return c.json({ error: "Telegram could not set the webhook. The bot is saved as pending; click Reconnect to retry once your PUBLIC_BASE_URL is reachable." }, 502);
    }

    // Webhook confirmed - activate the bot and install commands.
    try {
      await one(
        `UPDATE bots SET status = 'active', updated_at = now() WHERE id = $1 AND owner_id = $2`,
        [out.result.bot_id, uid]
      );
    } catch (err) {
      const msg = errMessage(err);
      console.error("[POST /bots] activation failed:", msg);
      return c.json({ error: "Webhook set, but we could not activate the bot record." }, 500);
    }

    try { await syncMyCommands(token, out.result.bot_id); }
    catch (err) { console.error("[POST /bots] setMyCommands failed:", errMessage(err)); }
    return c.json({
      bot_id: out.result.bot_id,
      username: out.result.username,
      try_it: `https://t.me/${out.result.username}`,
    });
  });

  // ---- bot customization: welcome message + custom slash-commands ----
  // These let a streamer personalize what their bot says without redeploying.
  // The bot Worker reads bots.welcome_message (the /start reply) and the
  // bot_commands table (custom /commands) live on each Telegram update.

  // Built-in commands the engine handles itself; a custom row named the same
  // would never fire (the engine skips these in its catch-all handler), so
  // reject them up front with a clear message instead of silently no-op'ing.
  const RESERVED_COMMANDS = new Set([
    "start", "menu", "help", "support", "code", "codes", "subscribe", "unsubscribe", "rank", "board", "leaderboard",
  ]);

  // Re-register the bot's Telegram command menu after a custom-command change.
  // The database mutation still succeeds if Telegram is unavailable, but the
  // caller receives a warning so the two command stores cannot drift silently.
  const resyncCommands = async (botId: string): Promise<string | null> => {
    try {
      await syncMyCommandsForBot(botId);
      return null;
    } catch (err) {
      console.error("[commands] setMyCommands sync failed:", errMessage(err));
      return "Telegram's command menu could not be updated. Use Sync commands in Bots to retry.";
    }
  };
  // Strip a leading slash / @mention / args and lowercase, matching exactly how
  // the bot engine derives the command name from an incoming message.
  const normalizeCommand = (raw: string): string =>
    (raw ?? "").trim().replace(/^\//, "").split(/[\s@]/)[0].toLowerCase();

  // Update a bot's welcome message (the /start reply). Empty clears it back to
  // the engine's default greeting.
  api.patch("/bots/:id", async (c) => {
    const parsed = await validatedBody(c, botWelcomeSchema);
    if (parsed instanceof Response) return parsed;
    const { welcome_message } = parsed;
    if (welcome_message != null && welcome_message.length > 500)
      return c.json({ error: "welcome_message too long (max 500)" }, 400);
    const row = await one(
      `UPDATE bots SET welcome_message = $1, updated_at = now()
        WHERE id = $2 AND owner_id = $3 RETURNING id, welcome_message`,
      [welcome_message?.trim() || null, c.req.param("id"), c.get("uid")]
    );
    return row ? c.json(row) : c.json({ error: "bot not found" }, 404);
  });

  // List a bot's custom commands.
  api.get("/bots/:id/commands", async (c) => {
    const bot = await one(`SELECT id FROM bots WHERE id = $1 AND owner_id = $2`, [c.req.param("id"), c.get("uid")]);
    if (!bot) return c.json({ error: "bot not found" }, 404);
    return c.json(await query(
      `SELECT id, command, response, is_enabled, buttons FROM bot_commands WHERE bot_id = $1 ORDER BY command`,
      [c.req.param("id")]
    ));
  });

  // Create or replace a custom command (upsert on the (bot_id, command) unique key).
  api.post("/bots/:id/commands", async (c) => {
    const parsed = await validatedBody(c, commandCreateSchema);
    if (parsed instanceof Response) return parsed;
    const { command, response, buttons } = parsed;
    const bot = await one(`SELECT id FROM bots WHERE id = $1 AND owner_id = $2`, [c.req.param("id"), c.get("uid")]);
    if (!bot) return c.json({ error: "bot not found" }, 404);
    const cmd = normalizeCommand(command ?? "");
    if (!cmd) return c.json({ error: "command required" }, 400);
    if (!/^[a-z0-9_]{1,32}$/.test(cmd))
      return c.json({ error: "command must be 1-32 chars: letters, numbers, or underscore" }, 400);
    if (RESERVED_COMMANDS.has(cmd))
      return c.json({ error: `/${cmd} is a built-in command and can't be overridden` }, 400);
    if (!response?.trim()) return c.json({ error: "response required" }, 400);
    if (response.length > 1000) return c.json({ error: "response too long (max 1000)" }, 400);
    const cleanButtons = Array.isArray(buttons) ? buttons.filter((b: any) => b && typeof b.label === "string" && typeof b.url === "string") : [];
    const row = await one(
      `INSERT INTO bot_commands (bot_id, command, response, is_enabled, buttons)
         VALUES ($1, $2, $3, true, $4::jsonb)
       ON CONFLICT (bot_id, command) DO UPDATE SET response = EXCLUDED.response, is_enabled = true, buttons = EXCLUDED.buttons
       RETURNING id, command, response, is_enabled, buttons`,
      [c.req.param("id"), cmd, response.trim(), cleanButtons]
    );
    const warning = await resyncCommands(c.req.param("id"));
    return c.json(warning ? { ...row, warning } : row);
  });

  // Toggle or edit a command. Ownership is enforced by joining bots.owner_id.
  api.patch("/commands/:id", async (c) => {
    const parsed = await validatedBody(c, commandUpdateSchema);
    if (parsed instanceof Response) return parsed;
    const { is_enabled, response, buttons } = parsed;
    if (response != null && (!response.trim() || response.length > 1000))
      return c.json({ error: "response must be 1-1000 chars" }, 400);
    const cleanButtons = Array.isArray(buttons) ? buttons.filter((b: any) => b && typeof b.label === "string" && typeof b.url === "string") : null;
    const row = await one(
      `UPDATE bot_commands bc
          SET is_enabled = COALESCE($1, bc.is_enabled),
              response   = COALESCE($2, bc.response),
              buttons    = COALESCE($3, bc.buttons)
         FROM bots b
        WHERE bc.id = $4 AND bc.bot_id = b.id AND b.owner_id = $5
        RETURNING bc.id, bc.bot_id, bc.command, bc.response, bc.is_enabled, bc.buttons`,
      [is_enabled ?? null, response?.trim() ?? null, cleanButtons, c.req.param("id"), c.get("uid")]
    ) as { id: string; bot_id: string; command: string; response: string; is_enabled: boolean; buttons: any } | undefined;
    if (row) {
      const warning = await resyncCommands(row.bot_id);
      return c.json(warning ? { ...row, warning } : row);
    }
    return c.json({ error: "command not found" }, 404);
  });

  // Delete a command.
  api.delete("/commands/:id", async (c) => {
    const row = await one<{ bot_id: string }>(
      `DELETE FROM bot_commands bc USING bots b
        WHERE bc.id = $1 AND bc.bot_id = b.id AND b.owner_id = $2
        RETURNING bc.id, bc.bot_id`,
      [c.req.param("id"), c.get("uid")]
    );
    if (!row) return c.json({ error: "command not found" }, 404);
    const warning = await resyncCommands(row.bot_id);
    return c.json(warning ? { ok: true, warning } : { ok: true });
  });

  // ---- plan & billing ----
  api.get("/plan", async (c) => {
    const row = await one<{ plan: string; plan_expires_at: string | null }>(
      `SELECT plan, plan_expires_at FROM users WHERE id = $1`,
      [c.get("uid")]
    );
    const plan = await getUserPlan(c.get("uid"));
    const expiresAt = row?.plan_expires_at ? new Date(row.plan_expires_at).getTime() : null;
    const now = Date.now();
    const daysLeft = expiresAt ? Math.floor((expiresAt - now) / 86_400_000) : null;
    let warning: string | null = null;
    if (plan.tier !== "free" && expiresAt) {
      if (daysLeft !== null && daysLeft < 0) {
        warning = "Your plan has expired and will downgrade to Free. Renew to restore features.";
      } else if (daysLeft !== null && daysLeft <= 7) {
        warning = `Your plan expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Renew to keep features.`;
      }
    }
    const origin = config.publicBaseUrl || "https://yourrank.site";
    return c.json({
      current: plan,
      expiresAt,
      daysLeft,
      warning,
      upgradeUrl: `${origin}/dashboard/settings`,
      plans: Object.values(PLANS),
    });
  });

  // ---- broadcasts ----
  api.get("/broadcasts", async (c) => {
    const rows = await query(
      `SELECT b.id, b.bot_id, b.body, b.media_url, b.buttons, b.status, b.scheduled_at, b.sent_at,
              b.created_at, b.segment, b.audience_filter_snapshot, b.total_count, b.sent_count, b.fail_count,
              bo.username AS bot_username
         FROM broadcasts b JOIN bots bo ON bo.id = b.bot_id
        WHERE bo.owner_id = $1
        ORDER BY b.created_at DESC LIMIT 20`,
      [c.get("uid")]
    );
    return c.json(rows.map((r: any) => ({
      ...r,
      segment: parseSegment(r.segment),
      audience_filter_snapshot: r.audience_filter_snapshot ?? null,
    })));
  });

  // How many subscribers a broadcast would reach (active, non-blocked),
  // so the UI can warn before sending to the whole list.
  api.get("/broadcasts/audience", async (c) => {
    const uid = c.get("uid");
    const botId = c.req.query("bot_id");
    if (!botId) return c.json({ error: "bot_id required" }, 400);

    let segment = null;
    const segmentParam = c.req.query("segment");
    if (segmentParam) {
      try {
        segment = broadcastSegmentSchema.parse(JSON.parse(segmentParam));
      } catch {
        return c.json({ error: "invalid segment" }, 400);
      }
    }
    const { clause, values } = buildSegmentWhere(segment, 2);
    const row = await one<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM bot_subscribers bs JOIN bots b ON b.id = bs.bot_id
        WHERE b.id = $1 AND b.owner_id = $2 AND NOT bs.is_blocked${clause ? ` AND ${clause}` : ""}`,
      [botId, uid, ...values]
    );
    return c.json({ count: row?.count ?? 0, segment });
  });

  api.post("/broadcasts", async (c) => {
    const uid = c.get("uid");
    const gateErr = await checkFeature(uid, "broadcasts");
    if (gateErr) return c.json({ error: gateErr }, 402);

    const parsed = await validatedBody(c, broadcastSchema);
    if (parsed instanceof Response) return parsed;
    const { bot_id, body: broadcastBody, scheduled_at, media_url, segment } = parsed;
    const body = broadcastBody.trim();
    // The schema validates the untrimmed string, so "   " would pass min(1)
    // and queue an empty message to every subscriber.
    if (!body) return c.json({ error: "body required" }, 400);

    const bot = await one(`SELECT id FROM bots WHERE id = $1 AND owner_id = $2`, [bot_id, uid]);
    if (!bot) return c.json({ error: "bot not found" }, 404);

    const segmentValue = normalizeSegment(segment);
    const rows = await exec(
      `INSERT INTO broadcasts (bot_id, body, media_url, status, scheduled_at, segment, audience_filter_snapshot)
       VALUES ($1, $2, $3, 'scheduled', $4, $5, $6::jsonb)
       RETURNING id, status`,
      [bot_id, body.trim(), media_url ?? null, scheduled_at ?? null, segmentValue, segment ?? {}]
    );
    const row = rows[0];
    return c.json({ ...row, segment: parseSegment(segmentValue) });
  });

  // Cancel a scheduled broadcast. Already sent/delivered broadcasts can't be
  // canceled; the cron processor will skip rows with status = 'canceled'.
  api.delete("/broadcasts/:id", async (c) => {
    const result = await exec(
      `UPDATE broadcasts b
          SET status = 'canceled'
         FROM bots bo
        WHERE b.id = $1 AND b.bot_id = bo.id AND bo.owner_id = $2 AND b.status = 'scheduled'
        RETURNING b.id`,
      [c.req.param("id"), c.get("uid")]
    );
    if (!result || result.length === 0) return c.json({ error: "broadcast not found or already sent" }, 404);
    return c.json({ ok: true });
  });

  // ---- postbacks ----
  api.post("/postback-key", async (c) => {
    const uid = c.get("uid");
    const gateErr = await checkFeature(uid, "postbacks");
    if (gateErr) return c.json({ error: gateErr }, 402);

    // H-04: read or create the active postback key from postback_keys.
    let key = await getActivePostbackKey(uid);
    if (!key) key = await createPostbackKey(uid, { label: "bot-dashboard" });
    return c.json({
      signed_endpoint: `${config.publicBaseUrl}/pb`,
      postback_key: key,
      signature: "hex HMAC-SHA256 of the raw query string, keyed by postback_key",
      legacy_postback_url: `${config.publicBaseUrl}/pb/${key}`,
      legacy_sunset: POSTBACK_SUNSET,
    });
  });

  api.post("/postback-key/rotate", async (c) => {
    const uid = c.get("uid");
    const gateErr = await checkFeature(uid, "postbacks");
    if (gateErr) return c.json({ error: gateErr }, 402);

    const key = await createPostbackKey(uid, { label: "bot-dashboard", revokeOthers: true });
    return c.json({
      signed_endpoint: `${config.publicBaseUrl}/pb`,
      postback_key: key,
      signature: "hex HMAC-SHA256 of the raw query string, keyed by postback_key",
      legacy_postback_url: `${config.publicBaseUrl}/pb/${key}`,
      legacy_sunset: POSTBACK_SUNSET,
    });
  });

  api.delete("/postback-key", async (c) => {
    const uid = c.get("uid");
    await revokePostbackKeys(uid);
    return c.json({ ok: true });
  });

  // Status-only view for Bot Settings; full management lives in /dashboard/settings/connections.
  api.get("/postback-status", async (c) => {
    const uid = c.get("uid");
    const row = await one<{ active: boolean; created_at: string | null }>(
      `SELECT (COUNT(*) > 0) AS active, MAX(created_at) AS created_at
         FROM postback_keys
        WHERE user_id = $1
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())`,
      [uid]
    );
    return c.json({ ok: true, active: row?.active ?? false, createdAt: row?.created_at ?? null });
  });

  api.get("/conversions", async (c) => {
    return c.json(await query(
      `SELECT cv.event, cv.amount, cv.currency, cv.click_ref,
              to_char(cv.ts, 'MM-DD HH24:MI') AS at, o.label AS offer
         FROM conversions cv LEFT JOIN offers o ON o.id = cv.offer_id
        WHERE cv.owner_id = $1
        ORDER BY cv.ts DESC LIMIT 25`,
      [c.get("uid")]
    ));
  });

  return api;
}
