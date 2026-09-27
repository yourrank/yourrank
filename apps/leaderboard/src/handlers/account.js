// Account-level API: postback keys, conversion log, profile data.
import { json, bad, denied, requireUser, rateLimit } from "../auth.js";
import { loadCreatorConnection } from "@yourrank/shared/provider-connections";
import { one, query } from "@yourrank/shared/db";
import { effectivePlan } from "@yourrank/shared/plans";
import { assertFeature } from "@yourrank/shared/entitlements";
import { handlePostback } from "./attribution.js";
import { deriveKickConnectionHealth } from "../connection-health.js";
import { buildDashboardPath } from "@yourrank/shared/dashboard-routes";
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
export async function handleAccountPostbacks(request, env, injected = {}) {
  const deps = { requireUser, rateLimit, getActivePostbackKey, loadActivePostbackStatus, loadConversions, ...injected };
  const { user, res } = await deps.requireUser(request, env);
  if (!user) return res;
  if (!(await deps.rateLimit(env, `account-postbacks:${user.id}`, 120, 60)).ok) {
    return bad("Too many requests. Try again later.", 429);
  }

  const url = new URL(request.url);
  const paid = effectivePlan(user) !== "free";
  if (!paid) {
    return json({ ok: true, postback: null, upgrade: true, canRotate: false, conversions: [] });
  }

  const key = await deps.getActivePostbackKey(user.id);
  const statusRow = key ? await deps.loadActivePostbackStatus(user.id) : null;
  const conversions = await deps.loadConversions(user.id);

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
export async function handleAccountPostbacksRotate(request, env, injected = {}) {
  const deps = { requireUser, rateLimit, createPostbackKey, ...injected };
  const { user, res } = await deps.requireUser(request, env);
  if (!user) return res;
  {
    const gate = assertFeature(effectivePlan(user), "telegram_postbacks");
    if (gate) return denied(gate, { actorId: user.id, request });
  }
  if (!(await deps.rateLimit(env, `postback-rotate:${user.id}`, 10, 60)).ok) {
    return bad("Too many rotations. Try again later.", 429);
  }

  // revokeOthers: the previous active key stops working the moment the new one exists.
  const key = await deps.createPostbackKey(user.id, { label: "account", revokeOthers: true });
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
  {
    const gate = assertFeature(effectivePlan(user), "telegram_postbacks");
    if (gate) return denied(gate, { actorId: user.id, request });
  }
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
  const deps = { requireUser, rateLimit, query, loadCreatorConnection, ...injected };
  const { user, res } = await deps.requireUser(request, env);
  if (!user) return res;
  if (!(await deps.rateLimit(env, `account-connections:${user.id}`, 120, 60)).ok) {
    return bad("Too many requests. Try again later.", 429);
  }

  const sites = await deps.query(
    `SELECT s.id, s.name, s.slug, s.credits_enabled,
            ch.external_channel_id AS kick_channel_external_id, ch.external_channel_name AS kick_channel_name,
            ch.reward_events_subscribed_at, ch.chat_events_subscribed_at, ch.event_subscriptions_checked_at,
            EXISTS (SELECT 1 FROM chat_giveaway_sessions g WHERE g.site_id = s.id) AS uses_chat_giveaways,
            s.discord_webhook_url_enc, s.telegram_chat_id, s.telegram_notify,
            (SELECT count(*)::integer FROM credit_reward_mappings m WHERE m.site_id=s.id AND m.active=true) AS active_reward_mappings
       FROM sites s
       LEFT JOIN community_channels ch ON ch.site_id = s.id AND ch.provider = 'kick' AND ch.status = 'active'
      WHERE user_id = $1
      ORDER BY board_order ASC, id ASC`,
    [user.id]
  );
  const requestedSiteId = String(new URL(request.url).searchParams.get("board") || "").trim();
  const selectedSiteId = (sites || []).some((site) => site.id === requestedSiteId) ? requestedSiteId : "";
  const selectedSite = (sites || []).find((site) => site.id === selectedSiteId);
  const selectedSiteName = selectedSite?.name || selectedSite?.slug || null;
  const orderedSites = selectedSiteId
    ? [...sites].sort((left, right) => Number(right.id === selectedSiteId) - Number(left.id === selectedSiteId))
    : sites;

  // Kick is a creator connection. Telegram identity is the user's linked ID;
  // older Telegram sign-ins may have an ID without telegram_linked_at.
  const kickConnection = await deps.loadCreatorConnection((sql, params) => deps.query(sql, params), user.id, "kick");

  const accountKickIdentity = Boolean(kickConnection?.externalUserId && kickConnection?.linkedAt);
  const kickHealthInputs = {
    accountLinked: accountKickIdentity,
    hasAccessToken: Boolean(kickConnection?.hasAccessToken),
    hasRefreshToken: Boolean(kickConnection?.hasRefreshToken),
    tokenExpiresAt: kickConnection?.tokenExpiresAt || null,
  };
  const accountKick = deriveKickConnectionHealth({ requireChannel: false, ...kickHealthInputs });
  const accountTelegramLinked = Boolean(user.telegram_user_id);
  let selectedKickHealth = { status: "not_tested", issueHref: null };
  let selectedDiscordHealth = { status: "not_configured" };
  let selectedTelegramHealth = { status: "not_configured" };
  const connections = [
    {
      id: "kick-account",
      provider: "Kick account",
      scope: "Creator account",
      connected: accountKickIdentity,
      status: accountKickIdentity ? accountKick.status : "not_connected",
      statusLabel: accountKickIdentity ? "Connected" : "Not connected",
      detail: !accountKickIdentity ? "" : accountKick.needsAttention
        ? "Authorization needs reconnecting."
        : kickConnection?.username ? `@${kickConnection.username}` : "",
      action: {
        label: !accountKickIdentity ? "Connect" : accountKick.needsAttention ? "Reconnect" : "Manage",
        href: buildDashboardPath("siteConnections.channel", { siteId: selectedSiteId }),
      },
    },
    {
      id: "telegram-account",
      provider: "Telegram account",
      scope: "Creator account",
      connected: accountTelegramLinked,
      status: accountTelegramLinked ? "linked" : "not_connected",
      statusLabel: accountTelegramLinked ? "Connected" : "Not connected",
      detail: accountTelegramLinked && user.telegram_username ? `@${user.telegram_username}` : "",
      action: accountTelegramLinked
        ? { label: "Manage", kind: "manage_telegram" }
        : { label: "Connect", href: selectedSiteId ? `/auth/telegram/connect?board=${encodeURIComponent(selectedSiteId)}` : "/auth/telegram/connect" },
    },
  ];

  for (const site of orderedSites || []) {
    const scope = site.name || site.slug || "Site";
    const selectedSite = site.id === selectedSiteId;
    const kick = deriveKickConnectionHealth({
      channelLinked: Boolean(site.kick_channel_external_id),
      ...kickHealthInputs,
      activeRewardMappings: Number(site.active_reward_mappings) || 0,
      operationEnabled: Boolean(site.credits_enabled),
      usesChatGiveaways: Boolean(site.uses_chat_giveaways),
      delivery: {
        rewardEventsSubscribedAt: site.reward_events_subscribed_at || null,
        chatEventsSubscribedAt: site.chat_events_subscribed_at || null,
        checkedAt: site.event_subscriptions_checked_at || null,
      },
    });
    const kickConnected = Boolean(site.kick_channel_external_id);
    const discordConfigured = Boolean(site.discord_webhook_url_enc);
    const telegramConfigured = Boolean(site.telegram_chat_id);
    const telegramEnabled = telegramConfigured && site.telegram_notify !== false;
    if (selectedSite) {
      const rewardInUse = Boolean(site.credits_enabled) && Number(site.active_reward_mappings) > 0;
      const rewardIssue = rewardInUse && (
        !kickConnected || !env.KICK_WEBHOOK_PUBLIC_KEY ||
        ["authorization_missing", "authorization_expired", "reward_events_missing"].includes(kick.reason)
      );
      selectedKickHealth = {
        status: rewardIssue ? "failing" : "not_tested",
        issueHref: rewardIssue ? buildDashboardPath("siteConnections.channel", { siteId: site.id }) : null,
      };
      selectedDiscordHealth = { status: discordConfigured ? "not_tested" : "not_configured" };
      selectedTelegramHealth = { status: telegramConfigured ? "not_tested" : "not_configured" };
    }
    connections.push({
      id: `kick-site:${site.id}`,
      provider: "Kick rewards",
      scope,
      selectedSite,
      connected: kickConnected,
      status: kick.status,
      statusLabel: kickConnected ? "Connected" : "Not connected",
      detail: kickConnected && site.kick_channel_name ? `@${site.kick_channel_name} on Kick` : "",
      action: {
        label: kickConnected ? "Manage" : "Connect",
        href: buildDashboardPath("siteConnections.channel", { siteId: site.id }),
      },
    });
    connections.push({
      id: `discord-site:${site.id}`,
      provider: "Discord delivery",
      scope,
      selectedSite,
      configured: discordConfigured,
      status: discordConfigured ? "configured" : "not_configured",
      statusLabel: discordConfigured ? "Configured" : "Not configured",
      detail: "",
      action: { label: discordConfigured ? "Manage" : "Set up", href: `${buildDashboardPath("site", { board: site.id })}&tab=notifications` },
    });
    connections.push({
      id: `telegram-site:${site.id}`,
      provider: "Telegram delivery",
      scope,
      selectedSite,
      configured: telegramConfigured,
      status: telegramEnabled ? "enabled" : telegramConfigured ? "paused" : "not_configured",
      statusLabel: telegramConfigured ? "Configured" : "Not configured",
      detail: telegramEnabled
        ? "Chat saved. A connected Telegram bot is required to deliver messages."
        : telegramConfigured ? "Chat saved, but delivery is turned off. A Telegram bot is required."
          : "Add a chat and connect a Telegram bot to deliver messages.",
      action: { label: telegramConfigured ? "Manage" : "Set up", href: `${buildDashboardPath("site", { board: site.id })}&tab=notifications` },
    });
  }

  // This endpoint only lists sites the user owns. Delivery telemetry is not
  // persisted, so a saved webhook or chat is never reported as healthy.
  return json({
    ok: true,
    connections,
    capabilities: { canRoleManageConnections: true },
    selectedSiteId: selectedSiteId || null,
    selectedSiteName,
    integrationHealth: {
      kickIngest: selectedKickHealth,
      discordDelivery: selectedDiscordHealth,
      telegramDelivery: selectedTelegramHealth,
    },
  }, 200, { "cache-control": "no-store, no-cache, must-revalidate" });
}
