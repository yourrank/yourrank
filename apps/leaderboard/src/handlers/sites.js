// Site handlers: get, put, list, create, archive, stats, heatmap, notifications, custom domain
import { requireUser, json, bad, ok, readJson, rateLimit, rateLimitHeaders, slugify, clientIp } from "../auth.js";
import { getByUser, getUserSite, getUserSiteById, getUserBoardsList, createBoard, duplicateBoard, createArchive, deleteArchive, deleteBoard, setActiveBoard, updateSiteTheme, invalidateSiteCache, invalidateUserCache, getBoardById, saveSite } from "../site.js";
import { bumpStat, getStats, getHeatmap, getTopReferrers, isStatementTimeout } from "../stats.js";
import { effectivePlan, PLAN_LIMITS, BOARD_LIMITS, HISTORY_DAYS } from "@yourrank/shared/plans";
import { one, exec, query } from "@yourrank/shared/db";
import { fromJsonb } from "@yourrank/shared/jsonb";
import { logAudit } from "@yourrank/shared/audit";
import { buildTop3Embed, sendDiscordWebhook, sendTelegramMessage } from "@yourrank/shared/notifications";
import { decryptToken, decryptCredential } from "@yourrank/shared/crypto";
import { PLATFORM_HOST } from "../constants.js";
import { invalidateCustomDomain } from "../middleware/custom-domain.js";
import { notifyLiveBoard } from "../live-board-config.js";
import { requireSiteCapability } from "../site-authorization.js";
import { routeContext } from "../middleware/handler.js";

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function onboardingForSite(env, site, userId, plan) {
  const [bot, postback, players, firstView] = await Promise.all([
    one("SELECT 1 FROM bots WHERE owner_id=$1 LIMIT 1", [userId]),
    plan !== "free" ? one("SELECT 1 FROM postback_keys WHERE user_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) LIMIT 1", [userId]) : null,
    one("SELECT COUNT(*)::int AS n FROM players WHERE site_id=$1", [site.id]),
    one("SELECT 1 FROM site_stats WHERE site_id=$1 LIMIT 1", [site.id]),
  ]);
  const brand = site.data?.brand || site;
  return {
    brand: !!brand.name?.trim(),
    players: (players?.n || 0) > 0 && !site.data?.samplePlayers,
    botConnected: !!bot,
    shared: !!site.published && !!firstView,
    postback: !!postback,
    isFree: plan === "free",
  };
}

import { createQueueProducer } from "@yourrank/shared/queue-producer";

export async function handleStats(request, env, {
  requireUserImpl = requireUser,
  getByUserImpl = getByUser,
  getBoardByIdImpl = getBoardById,
  getStatsImpl = getStats,
  requireSiteCapabilityImpl = requireSiteCapability,
} = {}) {
  const { user, res } = await requireUserImpl(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId");
  const site = siteId ? await getBoardByIdImpl(env, user.id, siteId) : await getByUserImpl(env, user.id);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageBoard");
  if (authorization.res) return authorization.res;
  try {
    return json({ ok: true, stats: await getStatsImpl(env, site.id) });
  } catch (err) {
    if (isStatementTimeout(err)) return bad("Analytics are temporarily unavailable. Try again shortly.", 503);
    throw err;
  }
}

export async function handleExportStats(request, env, {
  requireUserImpl = requireUser,
  rateLimitImpl = rateLimit,
  getByUserImpl = getByUser,
  getBoardByIdImpl = getBoardById,
  getStatsImpl = getStats,
  requireSiteCapabilityImpl = requireSiteCapability,
} = {}) {
  const { user, res } = await requireUserImpl(request, env);
  if (res) return res;
  const rl = await rateLimitImpl(env, `site-stats-export:${user.id}`, 10, 3600);
  if (!rl.ok) return bad("Too many exports. Try again later.", 429, rateLimitHeaders(rl));
  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId");
  const site = siteId ? await getBoardByIdImpl(env, user.id, siteId) : await getByUserImpl(env, user.id);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageBilling");
  if (authorization.res) return authorization.res;
  const stats = await getStatsImpl(env, site.id);
  const rows = (stats?.days || []).map((d) => [d.day, d.views, d.copies, d.clicks, d.conversions || 0, d.revenue || 0].join(","));
  const csv = "Day,Views,Copies,Clicks,Conversions,Revenue\n" + rows.join("\n") + "\n";
  const summary = `Summary,Views,Copies,Clicks,Conversions,Revenue\nToday,${stats?.today?.views || 0},${stats?.today?.copies || 0},${stats?.today?.clicks || 0},${stats?.today?.conversions || 0},${stats?.today?.revenue || 0}\nLast 7 days,${stats?.last7?.views || 0},${stats?.last7?.copies || 0},${stats?.last7?.clicks || 0},${stats?.last7?.conversions || 0},${stats?.last7?.revenue || 0}\nLast 30 days,${stats?.last30?.views || 0},${stats?.last30?.copies || 0},${stats?.last30?.clicks || 0},${stats?.last30?.conversions || 0},${stats?.last30?.revenue || 0}\n`;
  return new Response(summary + csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename=yourrank-stats-${site.slug}.csv`,
    },
  });
}

export async function handleExportPlayers(request, env, {
  requireUserImpl = requireUser,
  rateLimitImpl = rateLimit,
  getByUserImpl = getByUser,
  getBoardByIdImpl = getBoardById,
  queryImpl = query,
} = {}) {
  const { user, res } = await requireUserImpl(request, env);
  if (res) return res;
  const rl = await rateLimitImpl(env, `site-players-export:${user.id}`, 10, 3600);
  if (!rl.ok) return bad("Too many exports. Try again later.", 429, rateLimitHeaders(rl));
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId");
  const site = siteId ? await getBoardByIdImpl(env, user.id, siteId) : await getByUserImpl(env, user.id);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageBoard");
  if (authorization.res) return authorization.res;
  const rows = await queryImpl(
    "SELECT name, wagered, prize, score, hands, net_profit, win_rate, change FROM players WHERE site_id=$1 ORDER BY sort ASC",
    [site.id]
  );
  const header = "name,wagered,prize,score,hands,net_profit,win_rate,change\n";
  const body = (rows || []).map((p) => [
    p.name,
    p.wagered,
    p.prize,
    p.score ?? "",
    p.hands ?? "",
    p.net_profit ?? "",
    p.win_rate ?? "",
    p.change ?? "",
  ].map(csvCell).join(",")).join("\n") + (rows?.length ? "\n" : "");
  const csv = header + body;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename=yourrank-players-${site.slug}.csv`,
    },
  });
}

export async function handleHeatmap(request, env, {
  requireUserImpl = requireUser,
  getByUserImpl = getByUser,
  getBoardByIdImpl = getBoardById,
  getHeatmapImpl = getHeatmap,
  getTopReferrersImpl = getTopReferrers,
  requireSiteCapabilityImpl = requireSiteCapability,
} = {}) {
  const { user, res } = await requireUserImpl(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId");
  const site = siteId ? await getBoardByIdImpl(env, user.id, siteId) : await getByUserImpl(env, user.id);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageBoard");
  if (authorization.res) return authorization.res;
  try {
    const [heatmap, referrers] = await Promise.all([
      getHeatmapImpl(env, site.id),
      getTopReferrersImpl(env, site.id),
    ]);
    return json({ ok: true, heatmap, referrers });
  } catch (err) {
    if (isStatementTimeout(err)) return bad("Analytics are temporarily unavailable. Try again shortly.", 503);
    throw err;
  }
}

export async function handleTrackCopy(request, env) {
  const ip = clientIp(request);
  if (!(await rateLimit(env, `copy:${ip}`, 60, 60)).ok) return json({ ok: false, error: "Too many requests." }, 429);
  const body = await readJson(request);
  const slug = slugify(body?.slug || "");
  if (!slug) return json({ ok: true });
  if (!(await rateLimit(env, `copy:${slug}:${ip}`, 20, 60)).ok) return json({ ok: false, error: "Too many requests." }, 429);
  const site = await one("SELECT id FROM sites WHERE slug=$1 AND published=true AND is_draft=false", [slug]);
  if (site) {
    const producer = createQueueProducer(
      env.EVENTS_QUEUE,
      async (event) => {
        if (event.type === "bump") {
          await bumpStat(event.siteId, event.field, event.referer);
        }
      }
    );
    const p = producer.send({ type: "bump", siteId: site.id, field: "copies", referer: null, timestamp: Date.now() });
    routeContext(request).waitUntil(p);
    p.catch((err) => { console.error("[trackCopy] copy enqueue failed:", err); });
  }
  return json({ ok: true });
}

export async function handleTrackScroll(request, env) {
  const ip = clientIp(request);
  if (!(await rateLimit(env, `scroll:${ip}`, 120, 60)).ok) return json({ ok: false, error: "Too many requests." }, 429);
  const body = await readJson(request);
  const slug = slugify(body?.slug || "");
  const depth = Number(body?.depth);
  if (!slug || !Number.isFinite(depth)) return json({ ok: true });
  if (depth <= 0) return json({ ok: true });
  const site = await one("SELECT id FROM sites WHERE slug=$1 AND published=true AND is_draft=false", [slug]);
  if (!site) return json({ ok: true });
  const bucket = Math.max(0, Math.min(100, Math.ceil(depth / 25) * 25));
  await query(
    `INSERT INTO site_scroll_depth (site_id, day, bucket, count) VALUES ($1, CURRENT_DATE, $2, 1)
     ON CONFLICT (site_id, day, bucket) DO UPDATE SET count = site_scroll_depth.count + 1`,
    [site.id, bucket]
  );
  return json({ ok: true });
}

// getUserSite/getUserSiteById already normalize the row (camelCase, booleans,
// autoReset), so this response reads their fields — never the raw column names,
// which are absent from the normalized object and silently read as undefined.
export async function handleGetSite(request, env, {
  requireUserImpl = requireUser,
  getUserSiteImpl = getUserSite,
  getUserSiteByIdImpl = getUserSiteById,
  getUserBoardsListImpl = getUserBoardsList,
  onboardingForSiteImpl = onboardingForSite,
} = {}) {
  const { user, res } = await requireUserImpl(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId");
  const plan = effectivePlan(user);
  let s;
  if (siteId) {
    s = await getUserSiteByIdImpl(env, user.id, siteId, plan);
  } else {
    s = await getUserSiteImpl(env, user.id, plan);
  }
  if (!s) return bad("No site for this account", 404);
  const boards = await getUserBoardsListImpl(env, user.id);
  const onboarding = await onboardingForSiteImpl(env, s, user.id, plan);
  const data = { ...(s.data || {}), playerCount: Array.isArray(s.data?.players) ? s.data.players.length : 0 };
  return json({ ok: true, slug: s.slug, published: s.published, isDraft: !!s.isDraft, plan: plan, data, socials: s.socials, notify: s.notify || {}, archives: (s.archives || []).map((a) => ({ id: a.id, label: a.label, at: a.at, players: a.players, createdAt: a.at ? new Date(a.at).toISOString() : null, playerCount: a.players })), boards, siteId: s.id, customDomain: s.customDomain || "", domainStatus: s.customDomain ? (s.domainStatus || "pending") : "not_configured", onboarding, updatedAt: s.updatedAt, publishedAt: s.publishedAt, passwordProtected: !!s.passwordProtected, autoReset: { enabled: !!s.autoReset?.enabled, clear: s.autoReset?.clear || "wagers" } }, 200, { "cache-control": "no-store, no-cache, must-revalidate" });
}

export async function handleListBoards(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  const plan = effectivePlan(user);
  const boards = await getUserBoardsList(env, user.id);
  return json({ ok: true, boards, limits: { boards: BOARD_LIMITS[plan], players: PLAN_LIMITS[plan] }, plan });
}

export async function handleCreateBoard(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  if (!(await rateLimit(env, `createboard:${user.id}`, 5, 3600)).ok) return bad("Too many requests. Try again later.", 429);
  const body = await readJson(request);
  if (!body) return bad("Invalid request");
  let slug = slugify(body.slug || "");
  if (!slug) return bad("Enter a valid slug for the board URL.");
  const name = String(body.name || "").trim().slice(0, 80) || slug;
  // Sponsor / prize source is optional; empty values are stored as-is.
  const r = await createBoard(env, user.id, { slug, name, casino: body.casino, code: body.code }, request);
  return r.error
    ? json({ ok: false, error: r.error, code: r.code || "create_failed" }, 400)
    : json({ ok: true, id: r.id, slug: r.slug });
}

// POST /api/site/archive — { label?, clear: "wagers"|"players"|"none" }
export async function handleArchive(request, env, {
  requireUserImpl = requireUser,
  rateLimitImpl = rateLimit,
  getByUserImpl = getByUser,
  getBoardByIdImpl = getBoardById,
  createArchiveImpl = createArchive,
  requireSiteCapabilityImpl = requireSiteCapability,
} = {}) {
  const { user, res } = await requireUserImpl(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  if (!(await rateLimitImpl(env, `archive:${user.id}`, 10, 3600)).ok) return bad("Too many archive actions. Try again later.", 429);
  const body = (await readJson(request)) || {};
  const site = body.siteId ? await getBoardByIdImpl(env, user.id, body.siteId) : await getByUserImpl(env, user.id);
  if (site) {
    const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageBoard");
    if (authorization.res) return authorization.res;
  }
  const r = await createArchiveImpl(env, user.id, { label: body.label, clear: body.clear, siteId: body.siteId }, request);
  return r.error ? bad(r.error, 400) : json({ ok: true, label: r.label });
}

// POST /api/site/archive/delete — { id, siteId? }
export async function handleArchiveDelete(request, env, {
  requireUserImpl = requireUser,
  getByUserImpl = getByUser,
  getBoardByIdImpl = getBoardById,
  requireSiteCapabilityImpl = requireSiteCapability,
  deleteArchiveImpl = deleteArchive,
} = {}) {
  const { user, res } = await requireUserImpl(request, env);
  if (res) return res;
  const body = (await readJson(request)) || {};
  if (!body.id) return bad("id required");
  const site = body.siteId
    ? await getBoardByIdImpl(env, user.id, String(body.siteId))
    : await getByUserImpl(env, user.id);
  if (!site) return bad("Site not found", 404);
  const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageBilling");
  if (authorization.res) return authorization.res;
  const r = await deleteArchiveImpl(env, user.id, body.id, site.id);
  if (!r.error) {
    await logAudit({
      actorId: user.id,
      action: "archive_delete",
      entityType: "site",
      entityId: site.id,
      request,
      details: { board_id: site.id, board_slug: site.slug, archive_id: body.id },
    });
  }
  return r.error ? bad(r.error, 400) : json({ ok: true });
}

// POST /api/site/archive/restore — { archiveId, siteId? }
export async function handleRestoreArchive(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  if (!(await rateLimit(env, `archive-restore:${user.id}`, 10, 3600)).ok) return bad("Too many restore actions. Try again later.", 429);
  const body = (await readJson(request)) || {};
  if (!body.archiveId) return bad("archiveId required");
  const site = body.siteId ? await getBoardById(env, user.id, body.siteId) : await getByUser(env, user.id);
  if (!site) return bad("no site");
  const authorization = await requireSiteCapability(user, site, "canRoleManageBoard");
  if (authorization.res) return authorization.res;
  const plan = effectivePlan(user);
  const archive = await one(
    `SELECT snapshot_json FROM archives
      WHERE id=$1 AND site_id=$2
        AND created_at >= now() - ($3::int * interval '1 day')`,
    [body.archiveId, site.id, HISTORY_DAYS[plan]],
  );
  if (!archive) return bad("Archive not found.");
  const snap = fromJsonb(archive.snapshot_json) || [];
  if (!snap.length) return bad("Archive is empty.");
  const players = snap.map((p) => ({
    name: String(p.name || "").slice(0, 80),
    wagered: Number(p.wagered) || 0,
    prize: Number(p.prize) || 0,
    score: p.score ?? undefined,
    hands: p.hands ?? undefined,
    netProfit: p.net_profit ?? p.netProfit ?? undefined,
    winRate: p.win_rate ?? p.winRate ?? undefined,
    change: p.change ?? undefined,
  })).filter((p) => p.name);
  if (!players.length) return bad("No valid players in archive.");
  const r = await saveSite(env, user, { players, siteId: site.id }, site.id, request);
  if (r.error) return bad(r.error, 400);
  await logAudit({
    actorId: user.id,
    action: "archive_restore",
    entityType: "site",
    entityId: site.id,
    request,
    details: { board_id: site.id, board_slug: site.slug, archive_id: body.archiveId, players: players.length },
  });
  return json({ ok: true, players: players.length });
}

export async function handlePutSite(request, env, {
  requireSiteCapabilityImpl = requireSiteCapability,
} = {}) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  // BE-008: Rate-limit site saves (30 req/min per user) to prevent abuse.
  if (!(await rateLimit(env, `save-site:${user.id}`, 30, 60)).ok) return bad("Too many saves. Try again shortly.", 429);
  const payload = await readJson(request);
  if (!payload) return bad("Invalid request");
  const site = payload.siteId ? await getBoardById(env, user.id, payload.siteId) : await getByUser(env, user.id);
  if (site) {
    const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageBot");
    if (authorization.res) return authorization.res;
  }
  const r = await saveSite(env, user, payload, payload.siteId || null, request);
  return r.error
    ? json({ ok: false, error: r.error, code: r.code || "save_failed", currentUpdatedAt: r.currentUpdatedAt }, r.code === "concurrency_conflict" ? 409 : 400)
    : json({ ok: true, updatedAt: r.updatedAt, publishedAt: r.publishedAt, slug: r.slug, siteId: r.siteId });
}

// POST /api/site/finish — mark the wizard-created board as finished.
export async function handleFinishSetup(request, env, {
  requireSiteCapabilityImpl = requireSiteCapability,
} = {}) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  if (!(await rateLimit(env, `finish-setup:${user.id}`, 10, 60)).ok) return bad("Too many requests. Try again shortly.", 429);
  const payload = await readJson(request) || {};
  const site = payload.siteId ? await getBoardById(env, user.id, payload.siteId) : await getByUser(env, user.id);
  if (site) {
    const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageBot");
    if (authorization.res) return authorization.res;
  }
  const r = await saveSite(env, user, { isDraft: false, published: true }, payload.siteId || null, request);
  return r.error
    ? json({ ok: false, error: r.error, code: r.code || "publish_failed", currentUpdatedAt: r.currentUpdatedAt }, r.code === "concurrency_conflict" ? 409 : 400)
    : json({ ok: true, updatedAt: r.updatedAt, publishedAt: r.publishedAt, slug: r.slug, siteId: r.siteId });
}

export async function handlePutTheme(request, env, {
  requireSiteCapabilityImpl = requireSiteCapability,
} = {}) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  if (!(await rateLimit(env, `save-theme:${user.id}`, 30, 60)).ok) return bad("Too many theme changes. Try again shortly.", 429);
  const payload = await readJson(request);
  if (!payload) return bad("Invalid request");
  const site = payload.siteId ? await getBoardById(env, user.id, payload.siteId) : await getByUser(env, user.id);
  if (site) {
    const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageBot");
    if (authorization.res) return authorization.res;
  }
  const r = await updateSiteTheme(env, user, payload, request);
  return r.error ? bad(r.error, 400) : json({ ok: true, branding: r.branding });
}

// DELETE /api/site — { siteId }
export async function handleDeleteSite(request, env, {
  requireUserImpl = requireUser,
  rateLimitImpl = rateLimit,
  getBoardByIdImpl = getBoardById,
  deleteBoardImpl = deleteBoard,
  requireSiteCapabilityImpl = requireSiteCapability,
} = {}) {
  const { user, res } = await requireUserImpl(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  if (!(await rateLimitImpl(env, `delete-site:${user.id}`, 10, 60)).ok) return bad("Too many delete actions. Try again later.", 429);
  const body = await readJson(request);
  if (!body || !body.siteId) return bad("siteId required");
  const site = await getBoardByIdImpl(env, user.id, body.siteId);
  const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageBilling");
  if (authorization.res) return authorization.res;
  const r = await deleteBoardImpl(env, user.id, body.siteId, request);
  return r.error ? bad(r.error, 400) : json({ ok: true });
}

// POST /api/site/active — { siteId }
export async function handleSetActive(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  if (!(await rateLimit(env, `set-active:${user.id}`, 30, 60)).ok) return bad("Too many requests. Try again later.", 429);
  const body = await readJson(request);
  if (!body || !body.siteId) return bad("siteId required");
  const r = await setActiveBoard(env, user.id, body.siteId, request);
  return r.error ? bad(r.error, 400) : json({ ok: true });
}

// POST /api/site/duplicate — { siteId }
export async function handleDuplicateBoard(request, env, {
  requireSiteCapabilityImpl = requireSiteCapability,
} = {}) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  if (!(await rateLimit(env, `duplicate-board:${user.id}`, 10, 3600)).ok) return bad("Too many duplicate actions. Try again later.", 429);
  const body = await readJson(request);
  if (!body || !body.siteId) return bad("siteId required");
  const site = await getBoardById(env, user.id, body.siteId);
  const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageBilling");
  if (authorization.res) return authorization.res;
  const r = await duplicateBoard(env, user.id, body.siteId, request);
  return r.error ? bad(r.error, 400) : json({ ok: true, id: r.id, slug: r.slug });
}

// POST /api/site/notify/test — send a test Discord or Telegram notification.
export async function handleNotifyTest(request, env, {
  requireUserImpl = requireUser,
  getBoardByIdImpl = getBoardById,
  getByUserImpl = getByUser,
  requireSiteCapabilityImpl = requireSiteCapability,
  oneImpl = one,
  decryptCredentialImpl = decryptCredential,
  decryptTokenImpl = decryptToken,
  sendDiscordWebhookImpl = sendDiscordWebhook,
  sendTelegramMessageImpl = sendTelegramMessage,
} = {}) {
  const { user, res } = await requireUserImpl(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  if (effectivePlan(user) === "free") return bad("Notifications are a Pro feature. Upgrade to unlock.", 403);

  const body = await readJson(request);
  if (!body) return bad("Invalid request");
  const channel = String(body.channel || "").trim(); // "discord" or "telegram"

  const site = body.siteId
    ? await getBoardByIdImpl(env, user.id, String(body.siteId))
    : await getByUserImpl(env, user.id);
  if (!site) return bad("No site found", 404);
  const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageBot");
  if (authorization.res) return authorization.res;

  if (channel === "discord") {
    let webhookUrl = body.webhook_url ? String(body.webhook_url).trim() : null;
    if (!webhookUrl) {
      try { webhookUrl = await decryptCredentialImpl(site.discord_webhook_url_enc); } catch { webhookUrl = null; }
    }
    if (!webhookUrl) return bad("No Discord link saved yet.");
    if (!/^https:\/\/discord\.com\/api\/webhooks\/\d+\/.+/.test(webhookUrl) &&
        !/^https:\/\/discordapp\.com\/api\/webhooks\/\d+\/.+/.test(webhookUrl)) {
      return bad("That doesn't look like the link Discord gives you. Copy it again from Channel settings.");
    }
    const embed = buildTop3Embed(site.name || "Your Site", "TestPlayer", 1, 99999);
    embed.title = "🧪 Test Notification";
    embed.description = "Discord notifications are set up correctly!";
    embed.fields.push({ name: "Status", value: "✅ Notifications are working.", inline: false });
    const result = await sendDiscordWebhookImpl(webhookUrl, embed);
    return result.ok ? json({ ok: true, message: "Test message sent to Discord!" }) : bad(result.error || "Failed to send.", 502);
  }

  if (channel === "telegram") {
    const chatId = String(body.chat_id || site.telegram_chat_id || "").trim();
    if (!chatId) return bad("No Telegram chat ID configured.");
    // Find bot token — BUG-DB-008: bot_token doesn't exist on users. Tokens live in bots table (encrypted).
    const bot = await oneImpl("SELECT token_encrypted FROM bots WHERE owner_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1", [user.id]);
    if (!bot?.token_encrypted) return bad("No Telegram bot connected. Set up your bot first.");
    const botToken = await decryptTokenImpl(Buffer.from(bot.token_encrypted));
    const text = `🧪 *Test Notification*\n\nYour Telegram notifications for *${site.name || "Your Site"}* are working!`;
    const result = await sendTelegramMessageImpl(botToken, chatId, text);
    return result.ok ? json({ ok: true, message: "Test message sent to Telegram!" }) : bad(result.error || "Failed to send.", 502);
  }

  return bad("Unknown channel. Use 'discord' or 'telegram'.");
}

// Verify that the domain has a CNAME record pointing to the platform host.
async function verifyCnameToYourrank(domain) {
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=CNAME`,
      {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return false;
    const data = await res.json();
    const answers = Array.isArray(data?.Answer) ? data.Answer : [];
    return answers.some((a) => {
      if (a.type !== 5) return false;
      const target = String(a.data || "").toLowerCase().replace(/\.$/, "");
      return target === PLATFORM_HOST || target.endsWith(`.${PLATFORM_HOST}`);
    });
  } catch (e) {
    console.error("[domain] DNS lookup failed:", String(e?.message || e));
    return false;
  }
}

// POST /api/site/domain/verify — verify custom domain CNAME and provision TLS
// via Cloudflare for SaaS custom hostnames. Pro/Team only.
export async function handleDomainVerify(request, env) {
  try {
    const { user, res } = await requireUser(request, env);
    if (res) return res;
    if (user.status === "suspended") return bad("This account is suspended.", 403);
    const plan = effectivePlan(user);
    if (plan !== "pro" && plan !== "team") return bad("Custom domains require Pro or Team.", 403);

    const body = await readJson(request);
    if (!body) return bad("Domain required");

    const siteId = body.siteId || null;
    const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
    if (!site) return bad("No site found", 404);
    const authorization = await requireSiteCapability(user, site, "canRoleManageBilling");
    if (authorization.res) return authorization.res;

    const zoneId = env.CF_ZONE_ID;
    const cfToken = env.CF_API_TOKEN;

    // H-12: support explicit removal / replacement lifecycle.
    const remove = body.remove === true || body.remove === "true";
    const rawDomain = String(body.domain || "").trim().toLowerCase();
    if (remove || !rawDomain) {
      const existing = await one(
        "SELECT custom_hostname_id, custom_domain FROM sites WHERE id=$1",
        [site.id]
      );
      if (cfToken && existing?.custom_hostname_id) {
        try {
          await fetch(
            `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/${existing.custom_hostname_id}`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${cfToken}` },
              signal: AbortSignal.timeout(15000),
            }
          );
        } catch (e) {
          console.error("[domain] CF delete failed:", String(e?.message || e));
        }
      }
      await exec(
        "UPDATE sites SET custom_domain=NULL, custom_hostname_id=NULL, domain_status='pending', updated_at=now() WHERE id=$1",
        [site.id]
      );
      void notifyLiveBoard(env, site.id);
      invalidateSiteCache(env, site.slug);
      invalidateUserCache(env, user.id);
      invalidateCustomDomain(existing?.custom_domain);
      return ok({ status: "removed", message: "Custom domain removed." });
    }

    const domain = rawDomain;
    // Basic domain validation
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(domain)) {
      return bad("Invalid domain format.");
    }

    // Verify DNS CNAME before saving or provisioning.
    const hasCname = await verifyCnameToYourrank(domain);
    if (!hasCname) {
      return bad(`We couldn't find a CNAME record for this domain pointing to ${PLATFORM_HOST}. Add the CNAME first, then verify.`, 400);
    }

    if (!cfToken) {
      // Fallback: just save the domain without TLS provisioning
      await exec("UPDATE sites SET custom_domain=$1, custom_hostname_id=NULL, domain_status='pending', updated_at=now() WHERE id=$2", [domain, site.id]);
      void notifyLiveBoard(env, site.id);
      invalidateSiteCache(env, site.slug);
      invalidateUserCache(env, user.id);
      invalidateCustomDomain(domain);
      return ok({ status: "saved", message: "Domain saved. TLS automation is not configured — contact support." });
    }

    // H-12: Read current domain state before deciding to reuse, replace, or create.
    const existing = await one(
      "SELECT custom_domain, custom_hostname_id, domain_status FROM sites WHERE id=$1",
      [site.id]
    );

    // If the exact same domain is already active, verify with CF and short-circuit.
    if (domain === existing?.custom_domain && existing?.domain_status === "active" && existing?.custom_hostname_id) {
      try {
        const cfRes = await fetch(
          `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/${existing.custom_hostname_id}`,
          {
            headers: { "Authorization": `Bearer ${cfToken}`, "Content-Type": "application/json" },
            signal: AbortSignal.timeout(15000),
          }
        );
        const cfData = await cfRes.json();
        if (cfData.success && cfData.result?.ssl?.status === "active") {
          return ok({ status: "active", message: "TLS is active on your custom domain." });
        }
      } catch (e) {
        console.error("[domain] CF status check failed:", String(e?.message || e));
      }
    }

    // If the domain is changing, detach the old hostname first.
    if (domain !== existing?.custom_domain && existing?.custom_hostname_id) {
      try {
        const cfRes = await fetch(
          `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/${existing.custom_hostname_id}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${cfToken}` },
            signal: AbortSignal.timeout(15000),
          }
        );
        if (!cfRes.ok) {
          console.warn("[domain] CF old-hostname delete returned non-2xx:", cfRes.status);
        }
      } catch (e) {
        console.error("[domain] CF old-hostname delete failed:", String(e?.message || e));
      }
    }

    // Create a new custom hostname via CF API
    let cfResult;
    try {
      const cfRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames`,
        {
          method: "POST",
          headers: { "Authorization": `Bearer ${cfToken}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            hostname: domain,
            ssl: { method: "http", type: "dv" },
          }),
        }
      );
      cfResult = await cfRes.json();
    } catch (e) {
      console.error("[domain] CF create failed:", String(e?.message || e));
      return bad("Failed to connect to Cloudflare. Try again.", 502);
    }

    if (!cfResult.success) {
      const errMsg = cfResult.errors?.[0]?.message || "Cloudflare API error";
      console.error("[domain] CF error:", errMsg);
      // Save domain even if CF fails, for manual resolution
      await exec("UPDATE sites SET custom_domain=$1, custom_hostname_id=NULL, domain_status='error', updated_at=now() WHERE id=$2", [domain, site.id]);
      void notifyLiveBoard(env, site.id);
      invalidateSiteCache(env, site.slug);
      invalidateUserCache(env, user.id);
      invalidateCustomDomain(existing?.custom_domain, domain);
      return ok({ status: "error", message: errMsg });
    }

    const chId = cfResult.result?.id;
    const chStatus = cfResult.result?.ssl?.status || "pending";
    const dbStatus = chStatus === "active" ? "active" : "pending";

    // Save domain, custom_hostname_id, and status
    await exec(
      "UPDATE sites SET custom_domain=$1, custom_hostname_id=$2, domain_status=$3, updated_at=now() WHERE id=$4",
      [domain, chId, dbStatus, site.id]
    );
    void notifyLiveBoard(env, site.id);

    invalidateSiteCache(env, site.slug);
    invalidateUserCache(env, user.id);
    invalidateCustomDomain(existing?.custom_domain, domain);

    return ok({
      status: dbStatus,
      customHostnameId: chId,
      message: dbStatus === "active"
        ? "TLS is active on your custom domain!"
        : `TLS provisioning started. Point a CNAME for your domain to ${PLATFORM_HOST}, then check back in a few minutes.`,
    });
  } catch (e) {
    console.error("[domain] verify failed:", String(e?.message || e));
    return bad("Domain verification failed. Try again.", 500);
  }
}

const GAME_KEYS = new Set(["mines", "plinko", "dice", "limbo"]);

// POST /api/site/sections — toggle public viewer sections (shop, credits, games).
export async function handlePostSiteSections(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  if (!(await rateLimit(env, `save-site:${user.id}`, 30, 60)).ok) return bad("Too many saves. Try again shortly.", 429);
  const payload = await readJson(request);
  if (!payload || typeof payload.siteSections !== "object") return bad("siteSections required");
  const siteId = payload.siteId || null;
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  if (site) {
    const authorization = await requireSiteCapability(user, site, "canRoleManageBot");
    if (authorization.res) return authorization.res;
  }
  const r = await saveSite(env, user, { siteSections: payload.siteSections }, siteId, request);
  return r.error ? bad(r.error, 400) : json({ ok: true, updatedAt: r.updatedAt, siteId: r.siteId });
}

// GET /api/site/games/settings
export async function handleGetSiteGameSettings(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId");
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageBot");
  if (authorization.res) return authorization.res;
  const rows = await query(
    `SELECT game, enabled, min_bet AS "minBet", max_bet AS "maxBet", house_edge_bps AS "houseEdgeBps", daily_loss_cap AS "dailyLossCap"
     FROM site_game_settings WHERE site_id=$1`,
    [site.id]
  );
  return json({ ok: true, settings: rows || [] });
}

// POST /api/site/games/settings
export async function handlePostSiteGameSettings(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  if (!(await rateLimit(env, `save-game-settings:${user.id}`, 30, 60)).ok) return bad("Too many requests. Try again shortly.", 429);
  const body = await readJson(request);
  if (!body || !body.siteId || !body.game) return bad("siteId and game required");
  const site = await getBoardById(env, user.id, body.siteId);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageBot");
  if (authorization.res) return authorization.res;
  if (!GAME_KEYS.has(body.game)) return bad("invalid game", 400);

  const minBet = Number.isInteger(body.minBet) && body.minBet > 0 ? body.minBet : 1;
  let maxBet = Number.isInteger(body.maxBet) && body.maxBet > 0 ? body.maxBet : minBet;
  if (maxBet < minBet) maxBet = minBet;
  const houseEdgeBps = Number.isInteger(body.houseEdgeBps) && body.houseEdgeBps >= 0 && body.houseEdgeBps <= 1000 ? body.houseEdgeBps : 100;
  const dailyLossCap = body.dailyLossCap === null || body.dailyLossCap === undefined
    ? null
    : (Number.isInteger(body.dailyLossCap) && body.dailyLossCap > 0 ? body.dailyLossCap : null);
  const enabled = body.enabled === true;

  await exec(
    `INSERT INTO site_game_settings (site_id, game, enabled, min_bet, max_bet, house_edge_bps, daily_loss_cap)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (site_id, game) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       min_bet = EXCLUDED.min_bet,
       max_bet = EXCLUDED.max_bet,
       house_edge_bps = EXCLUDED.house_edge_bps,
       daily_loss_cap = EXCLUDED.daily_loss_cap`,
    [site.id, body.game, enabled, minBet, maxBet, houseEdgeBps, dailyLossCap]
  );

  await logAudit({
    actorId: user.id,
    action: "game_settings_update",
    entityType: "site",
    entityId: site.id,
    request,
    details: { board_id: site.id, board_slug: site.slug, game: body.game, enabled, minBet, maxBet, houseEdgeBps, dailyLossCap },
  });

  return json({ ok: true });
}
