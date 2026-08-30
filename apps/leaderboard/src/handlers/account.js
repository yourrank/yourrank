// Account-level API: postback keys, conversion log, profile data.
import { json, bad, requireUser, rateLimit } from "../auth.js";
import { one, query } from "@yourrank/shared/db";
import { effectivePlan } from "@yourrank/shared/plans";
import { handlePostback } from "./attribution.js";
import { deriveKickConnectionHealth } from "../connection-health.js";
import {
  POSTBACK_SUNSET,
  createPostbackKey,
  getActivePostbackKey,
  revokePostbackKeys,
} from "@yourrank/shared/postback";

function postbackObject(url, key) {
  return {
    signedEndpoint: `${url.origin}/api/postback`,
    key,
    signature: "hex HMAC-SHA256 of the raw query string, keyed by key",
    legacyUrl: `${url.origin}/api/postback?key=${encodeURIComponent(key)}`,
    legacySunset: POSTBACK_SUNSET,
  };
}

async function loadConversions(ownerId) {
  return query(
    `SELECT cv.event, cv.amount, cv.currency, cv.click_ref,
            to_char(cv.ts, 'MM-DD HH24:MI') AS at, o.label AS offer
       FROM conversions cv LEFT JOIN offers o ON o.id = cv.offer_id
      WHERE cv.owner_id = $1
      ORDER BY cv.ts DESC LIMIT 25`,
    [ownerId]
  );
}

async function loadActivePostbackStatus(ownerId) {
  return one(
    `SELECT id, created_at, last_used_at
       FROM postback_keys
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at DESC
      LIMIT 1`,
    [ownerId]
  );
}

async function signQueryString(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// GET /api/account/postbacks
export async function handleAccountPostbacks(request, env) {
  const { user, res } = await requireUser(request, env);
  if (!user) return res;
  if (!(await rateLimit(env, `account-postbacks:${user.id}`, 120, 60)).ok) {
    return bad("Too many requests. Try again later.", 429);
  }

  const url = new URL(request.url);
  const paid = effectivePlan(user) !== "free";
  if (!paid) {
    return json({ ok: true, postback: null, upgrade: true, canRotate: false, conversions: [] });
  }

  const key = await getActivePostbackKey(user.id);
  const statusRow = key ? await loadActivePostbackStatus(user.id) : null;
  const conversions = await loadConversions(user.id);

  let status = "not_configured";
  if (key) {
    status = statusRow?.last_used_at ? "active" : "pending";
  }

  return json({
    ok: true,
    postback: key ? { ...postbackObject(url, key), createdAt: statusRow?.created_at, lastUsedAt: statusRow?.last_used_at } : null,
    status,
    upgrade: false,
    canRotate: true,
    conversions,
  });
}

// POST /api/account/postbacks/rotate
export async function handleAccountPostbacksRotate(request, env) {
  const { user, res } = await requireUser(request, env);
  if (!user) return res;
  if (effectivePlan(user) === "free") return bad("Postbacks require a paid plan.", 402);
  if (!(await rateLimit(env, `postback-rotate:${user.id}`, 10, 60)).ok) {
    return bad("Too many rotations. Try again later.", 429);
  }

  const key = await createPostbackKey(user.id, { label: "account", revokeOthers: true });
  const url = new URL(request.url);
  return json({ ok: true, postback: postbackObject(url, key) });
}

// DELETE /api/account/postbacks
export async function handleAccountPostbacksRevoke(request, env) {
  const { user, res } = await requireUser(request, env);
  if (!user) return res;
  await revokePostbackKeys(user.id);
  return json({ ok: true });
}

// POST /api/account/postbacks/test
export async function handleAccountPostbacksTest(request, env) {
  const { user, res } = await requireUser(request, env);
  if (!user) return res;
  if (effectivePlan(user) === "free") return bad("Postbacks require a paid plan.", 402);
  if (!(await rateLimit(env, `postback-test:${user.id}`, 10, 60)).ok) {
    return bad("Too many test conversions. Try again later.", 429);
  }

  const key = await getActivePostbackKey(user.id);
  if (!key) return bad("No active postback key. Generate one first.", 400);

  const url = new URL(request.url);
  const testUrl = new URL("/api/postback", url.origin);
  const testId = crypto.randomUUID();
  testUrl.searchParams.set("event", "test");
  testUrl.searchParams.set("amount", "0.00");
  testUrl.searchParams.set("currency", "TEST");
  testUrl.searchParams.set("test_id", testId);
  const queryString = testUrl.search.slice(1);
  const signature = await signQueryString(key, queryString);
  const body = JSON.stringify({ event: "test", amount: "0.00", currency: "TEST", test_id: testId });

  const testReq = new Request(testUrl.toString(), {
    method: "POST",
    headers: {
      "x-postback-key": key,
      "x-postback-signature": signature,
      "content-type": "application/json",
    },
    body,
  });

  const result = await handlePostback(testReq, env);
  if (result.status !== 200) {
    const text = await result.text().catch(() => "unknown");
    return bad(`Test postback failed: ${text}`, 502);
  }
  return json({ ok: true, message: "Test conversion sent and accepted. It will appear in Recent conversions as event 'test'." });
}

// GET /api/account/conversions
export async function handleAccountConversions(request, env) {
  const { user, res } = await requireUser(request, env);
  if (!user) return res;
  if (!(await rateLimit(env, `account-conversions:${user.id}`, 120, 60)).ok) {
    return bad("Too many requests. Try again later.", 429);
  }

  const rows = await loadConversions(user.id);
  return json({ ok: true, conversions: rows });
}

// GET /api/account/connected-accounts
export async function handleAccountConnectedAccounts(request, env, injected = {}) {
  const deps = { requireUser, rateLimit, query, one, ...injected };
  const { user, res } = await deps.requireUser(request, env);
  if (!user) return res;
  if (!(await deps.rateLimit(env, `account-connections:${user.id}`, 120, 60)).ok) {
    return bad("Too many requests. Try again later.", 429);
  }

  const sites = await deps.query(
    `SELECT s.id, s.name, s.slug, s.credits_enabled, s.kick_channel_external_id, s.kick_channel_name,
            s.discord_webhook_url_enc, s.telegram_chat_id, s.telegram_notify,
            (SELECT count(*)::integer FROM credit_reward_mappings m WHERE m.site_id=s.id AND m.active=true) AS active_reward_mappings
       FROM sites s
      WHERE user_id = $1
      ORDER BY board_order ASC, id ASC`,
    [user.id]
  );

  // loadUser() selects telegram_user_id (not telegram_id) and neither
  // kick_token_expires_at nor telegram_linked_at — the old code read
  // user.telegram_id, so the Telegram card never rendered at all.
  const identity = await deps.one(
    `SELECT kick_token_expires_at, telegram_linked_at,
            kick_access_token_enc IS NOT NULL AS has_kick_access_token,
            kick_refresh_token_enc IS NOT NULL AS has_kick_refresh_token
       FROM users WHERE id = $1`,
    [user.id]
  );

  const accountKickIdentity = Boolean(user.kick_user_id && user.kick_linked_at);
  const kickExpiresAt = identity?.kick_token_expires_at ? new Date(identity.kick_token_expires_at).getTime() : null;
  const kickCannotRefresh = Number.isFinite(kickExpiresAt) && kickExpiresAt <= Date.now() && !identity?.has_kick_refresh_token;
  const accountKickNeedsAttention = accountKickIdentity && (!identity?.has_kick_access_token || kickCannotRefresh);
  const accountKickLinked = accountKickIdentity && !accountKickNeedsAttention;
  const accountTelegramLinked = Boolean(user.telegram_user_id && identity?.telegram_linked_at);
  const connections = [
    {
      id: "kick-account",
      provider: "Kick",
      scope: "Creator account",
      status: accountKickNeedsAttention ? "needs_attention" : accountKickLinked ? "authorized" : "not_connected",
      statusLabel: accountKickNeedsAttention ? "Needs attention" : accountKickLinked ? "Authorized" : "Not connected",
      detail: accountKickNeedsAttention
        ? "Reconnect Kick to restore creator account authorization."
        : accountKickLinked
        ? user.kick_username ? `Signed in as @${user.kick_username}.` : "Creator identity linked."
        : "Connect your creator identity before linking site rewards.",
      action: { label: accountKickNeedsAttention ? "Reconnect" : accountKickLinked ? "Manage" : "Connect", href: "/dashboard/site/connections" },
    },
    {
      id: "telegram-account",
      provider: "Telegram",
      scope: "Creator account",
      status: accountTelegramLinked ? "linked" : "not_connected",
      statusLabel: accountTelegramLinked ? "Linked" : "Not connected",
      detail: accountTelegramLinked
        ? user.telegram_username ? `Signed in as @${user.telegram_username}.` : "Telegram identity linked."
        : "Connect Telegram to use Telegram operations.",
      action: accountTelegramLinked
        ? { label: "Disconnect", kind: "disconnect_telegram" }
        : { label: "Connect", href: "/dashboard/telegram" },
    },
  ];

  for (const site of sites || []) {
    const scope = site.name || site.slug || "Site";
    const kick = deriveKickConnectionHealth({
      channelLinked: Boolean(site.kick_channel_external_id),
      accountLinked: Boolean(user.kick_user_id && user.kick_linked_at),
      hasAccessToken: Boolean(identity?.has_kick_access_token),
      hasRefreshToken: Boolean(identity?.has_kick_refresh_token),
      tokenExpiresAt: identity?.kick_token_expires_at || null,
      activeRewardMappings: Number(site.active_reward_mappings) || 0,
      operationEnabled: Boolean(site.credits_enabled),
    });
    connections.push({
      id: `kick-site:${site.id}`,
      provider: "Kick rewards",
      scope,
      status: kick.status,
      statusLabel: kick.label,
      detail: site.kick_channel_name && site.kick_channel_external_id
        ? `${kick.detail} Channel: @${site.kick_channel_name}.`
        : kick.detail,
      action: kick.status === "authorized"
        ? { label: "Disconnect", kind: "disconnect_kick", siteId: site.id }
        : { label: kick.needsAttention ? "Reconnect" : "Connect", href: `/auth/kick?siteId=${encodeURIComponent(site.id)}` },
    });
    connections.push({
      id: `discord-site:${site.id}`,
      provider: "Discord delivery",
      scope,
      status: site.discord_webhook_url_enc ? "configured" : "not_configured",
      statusLabel: site.discord_webhook_url_enc ? "Configured" : "Not configured",
      detail: site.discord_webhook_url_enc
        ? "A webhook is saved. Use Send test in Site notifications to verify delivery."
        : "Optional. Add a webhook when you want Discord notifications.",
      action: { label: site.discord_webhook_url_enc ? "Manage" : "Set up", href: `/dashboard/site?tab=notifications&siteId=${encodeURIComponent(site.id)}` },
    });
    const telegramConfigured = Boolean(site.telegram_chat_id);
    const telegramEnabled = telegramConfigured && site.telegram_notify !== false;
    connections.push({
      id: `telegram-site:${site.id}`,
      provider: "Telegram delivery",
      scope,
      status: telegramEnabled ? "enabled" : telegramConfigured ? "paused" : "not_configured",
      statusLabel: telegramEnabled ? "Enabled" : telegramConfigured ? "Paused" : "Not configured",
      detail: telegramEnabled
        ? "Delivery is enabled. Use Send test in Site notifications to verify it."
        : telegramConfigured ? "A chat is saved, but delivery is turned off." : "Optional. Add a chat when you want site notifications in Telegram.",
      action: { label: telegramConfigured ? "Manage" : "Set up", href: `/dashboard/site?tab=notifications&siteId=${encodeURIComponent(site.id)}` },
    });
  }

  return json({ ok: true, connections }, 200, { "cache-control": "no-store, no-cache, must-revalidate" });
}
