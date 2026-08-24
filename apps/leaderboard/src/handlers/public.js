// Public API handlers for leaderboard data access
import { getPublicSite as defaultGetPublicSite, getPublicStreamVersion as defaultGetPublicStreamVersion } from "../site.js";
import { getStats as defaultGetStats, isStatementTimeout as defaultIsStatementTimeout } from "../stats.js";
import { rateLimit as defaultRateLimit, rateLimitHeaders, clientIp as defaultClientIp, json, bad } from "../auth.js";
import { one as defaultOne } from "@yourrank/shared/db";
import { routeContext } from "../middleware/handler.js";
import { demoLeaderboardData } from "../demo-data.js";
import {
  connectLiveBoard,
} from "../live-board.js";
import {
  liveBoardPushEnabled,
  liveBoardResponse,
  liveBoardRetryAfter,
  liveBoardStreamDisabled,
} from "../live-board-config.js";

/**
 * Handle GET /api/public/:slug/standings
 * Returns full standings JSON for embedding / Telegram bot queries
 */
export async function handlePublicStandings(request, env, deps = {}) {
  const { getPublicSite = defaultGetPublicSite, rateLimit = defaultRateLimit, clientIp = defaultClientIp } = deps;
  try {
    const { slug } = routeContext(request);
    const rl = await rateLimit(env, `pub-standings:${clientIp(request)}`, 100, 60);
    if (!rl.ok) return bad("Rate limit exceeded. Try again shortly.", 429, rateLimitHeaders(rl));

    // Demo board has no DB row — serve static demo data.
    if (slug === "demo") {
      const d = demoLeaderboardData();
      const sorted = (d.players || []).slice().sort((a, b) => (a.rank || 0) - (b.rank || 0));
      const players = sorted.map((p, i) => ({ name: p.name, wagered: p.wagered, prize: p.prize, position: Number(p.rank) || i + 1 }));
      const endsAt = d.endsAt || null;
      let countdown = null;
      if (endsAt) {
        const remaining = Math.max(0, new Date(endsAt).getTime() - Date.now());
        countdown = { endsAt, remaining };
      }
      return json({
        slug,
        name: d.brand?.name || slug,
        casino: d.brand?.casino || "",
        period: d.brand?.period || "Monthly",
        prizePool: d.brand?.prizePool || "$0",
        players,
        countdown,
      }, 200, { "cache-control": "public, max-age=30", ...rateLimitHeaders(rl) });
    }

    const r = await getPublicSite(env, slug, request);
    if (r && r.requiresPassword) return bad("Password required.", 401);
    if (!r || r.suspended) return bad("not found", 404);
    const d = r.data;
    const sorted = (d.players || []).slice().sort((a, b) => (a.rank || 0) - (b.rank || 0));
    const players = sorted.map((p, i) => ({ name: p.name, wagered: p.wagered, prize: p.prize, position: Number(p.rank) || i + 1 }));
    const endsAt = d.endsAt || null;
    let countdown = null;
    if (endsAt) {
      const remaining = Math.max(0, new Date(endsAt).getTime() - Date.now());
      countdown = { endsAt, remaining };
    }
    return json({
      slug,
      name: d.brand?.name || slug,
      casino: d.brand?.casino || "",
      period: d.brand?.period || "Monthly",
      prizePool: d.brand?.prizePool || "$0",
      players,
      countdown,
    }, 200, { "cache-control": "public, max-age=30", ...rateLimitHeaders(rl) });
  } catch (e) {
    console.error("[public/standings]", String(e?.message || e));
    return bad("Something went wrong. Try again.", 500);
  }
}

/**
 * Handle GET /api/public/:slug/players
 * Returns lightweight players-only endpoint for live polling
 */
export async function handlePublicPlayers(request, env, deps = {}) {
  const { getPublicSite = defaultGetPublicSite, rateLimit = defaultRateLimit, clientIp = defaultClientIp, one = defaultOne } = deps;
  try {
    const { slug } = routeContext(request);
    const ip = clientIp(request);
    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 100));
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    const search = String(url.searchParams.get("search") || "").trim().toLowerCase().replace(/\s+/g, " ");
    const rl = await rateLimit(env, `pub-players:${ip}`, 120, 60);
    const searchRl = search
      ? await rateLimit(env, `pub-player-search:${ip}`, 60, 60)
      : null;
    const effectiveRl = searchRl || rl;
    if (!rl.ok || (searchRl && !searchRl.ok)) {
      return bad("Rate limit exceeded. Try again shortly.", 429, rateLimitHeaders(effectiveRl));
    }

    // Demo board has no DB row — serve static demo data.
    if (slug === "demo") {
      const d = demoLeaderboardData();
      const all = (d.players || []).slice().sort((a, b) => b.wagered - a.wagered);
      const filtered = search ? all.filter((p) => String(p.name || "").toLowerCase().includes(search)) : all;
      const players = filtered.slice(offset, offset + limit).map((p) => ({ ...p, rank: all.indexOf(p) + 1 }));
      return json({ players, total: all.length, offset, limit, hasMore: offset + players.length < filtered.length },
        200, { "cache-control": "public, max-age=10", ...rateLimitHeaders(effectiveRl) });
    }

    const r = await getPublicSite(env, slug, request, { limit, offset, search });
    if (r && r.requiresPassword) return bad("Password required.", 401);
    if (!r || r.suspended) return bad("not found", 404);
    // C-11 / M-13: cheap ETag based on the most recent player mutation. This lets
    // the client skip DOM churn and the server skip serializing unchanged boards.
    const version = await one(
      "SELECT max(updated_at) AS m, count(*)::int AS c FROM players WHERE site_id=$1",
      [r.id]
    );
    const maxTs = version?.m ? new Date(version.m).toISOString() : "0";
    const etag = `W/"${slug}-${maxTs}-${version?.c || 0}-l${limit}-o${offset}-q${encodeURIComponent(search)}"`;
    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch === etag) {
      return new Response(null, { status: 304, headers: { "cache-control": "public, max-age=10", etag, ...rateLimitHeaders(effectiveRl) } });
    }

    const players = (r.data.players || []).map((p) => ({
      name: p.name,
      wagered: p.wagered,
      prize: p.prize,
      score: p.score,
      hands: p.hands,
      netProfit: p.netProfit,
      winRate: p.winRate,
      change: p.change,
      rank: p.rank,
    }));
    return json({
      players,
      total: r.data.playerCount,
      offset,
      limit,
      hasMore: offset + players.length < (r.data.playerMatchCount ?? r.data.playerCount),
    }, 200, { "cache-control": "public, max-age=10", etag, ...rateLimitHeaders(effectiveRl) });
  } catch (e) {
    console.error("[public/players]", String(e?.message || e));
    return bad("Something went wrong. Try again.", 500);
  }
}

/**
 * Handle GET /api/public/:slug/stream
 * Server-Sent Events for live leaderboard updates (replaces 30s polling).
 */
export async function handlePublicStream(request, env, deps = {}) {
  const { getPublicSite = defaultGetPublicSite, getPublicStreamVersion = defaultGetPublicStreamVersion, rateLimit = defaultRateLimit, clientIp = defaultClientIp } = deps;
  try {
    const { slug } = routeContext(request);
    const rl = await rateLimit(env, `pub-stream:${clientIp(request)}`, 60, 60);
    if (!rl.ok) return bad("Rate limit exceeded. Try again shortly.", 429, rateLimitHeaders(rl));
    if (liveBoardStreamDisabled(env)) {
      const headers = new Headers(rateLimitHeaders(rl));
      headers.set("retry-after", String(liveBoardRetryAfter()));
      return new Response("Live board streams are temporarily unavailable.", {
        status: 503,
        headers,
      });
    }
    const r = await getPublicSite(env, slug, request);
    if (!r || r.suspended) return bad("not found", 404);
    if (r.requiresPassword) return bad("Password required.", 401);
    if (liveBoardPushEnabled(env) && env.LIVE_BOARD_DO) {
      const pushed = await connectLiveBoard(request, env, r.id, slug);
      return liveBoardResponse(pushed, rateLimitHeaders(rl));
    }
    const siteId = r.id;
    let lastTs = "";
    let closed = false;
    const baseInterval = getPublicStreamInterval(env);
    const enc = new TextEncoder();
    const send = async (controller) => {
      try {
        if (closed) return;
        const newTs = await getPublicStreamVersion(siteId);
        if (newTs !== lastTs) {
          lastTs = newTs;
          const data = await getPublicSite(env, slug, request, { limit: 100, offset: 0 });
          if (!data || data.suspended || data.requiresPassword) {
            closed = true;
            controller.close();
            return;
          }
          const payload = JSON.stringify({ players: data.data.players, total: data.data.playerCount, updatedAt: newTs });
          controller.enqueue(enc.encode(`data: ${payload}\n\n`));
        }
      } catch (e) {
        console.error("[public/stream] tick", String(e?.message || e));
      }
      if (!closed) {
        const jitter = 0.8 + Math.random() * 0.4;
        setTimeout(() => send(controller), baseInterval * jitter);
      }
    };
    const stream = new ReadableStream({
      async start(controller) {
        await send(controller);
      },
      cancel() { closed = true; }
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "connection": "keep-alive",
        ...rateLimitHeaders(rl),
      },
    });
  } catch (e) {
    console.error("[public/stream]", String(e?.message || e));
    return bad("Something went wrong. Try again.", 500);
  }
}

const PUBLIC_STREAM_INTERVAL_MS = 15_000;

function getPublicStreamInterval(env) {
  const configured = Number(env?.PUBLIC_STREAM_INTERVAL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : PUBLIC_STREAM_INTERVAL_MS;
}

/**
 * Handle GET /api/public/:slug/rank?user=X
 * Returns plain-text rank lookup for Nightbot / Streamlabs custom commands
 */
export async function handlePublicRank(request, env, deps = {}) {
  const { getPublicSite = defaultGetPublicSite, rateLimit = defaultRateLimit, clientIp = defaultClientIp } = deps;
  try {
    const { slug } = routeContext(request);
    const userParam = new URL(request.url).searchParams.get("user") || "";
    const rl = await rateLimit(env, `pub-rank:${clientIp(request)}`, 60, 60);
    const rankHeaders = { "content-type": "text/plain; charset=utf-8", ...rateLimitHeaders(rl) };
    if (!userParam) {
      return new Response("Usage: /api/public/:slug/rank?user=NAME", {
        status: 400,
        headers: { ...rankHeaders, "cache-control": "public, max-age=30" }
      });
    }
    if (!rl.ok) {
      return new Response("Rate limit exceeded.", {
        status: 429,
        headers: rankHeaders
      });
    }

    // Demo board has no DB row — serve static demo data.
    if (slug === "demo") {
      const d = demoLeaderboardData();
      const sorted = (d.players || []).slice().sort((a, b) => (b.wagered || 0) - (a.wagered || 0));
      const matchUser = userParam.toLowerCase().replace(/^@/, "").replace(/\s+/g, " ").trim();
      const normalizeForRank = (n) => String(n || "").toLowerCase().replace(/^\*+/, "").replace(/\s+/g, " ").trim();
      const idx = sorted.findIndex(p => normalizeForRank(p.name) === matchUser);
      if (idx === -1) {
        return new Response(`${userParam} is not on ${d.brand?.name || slug}'s leaderboard yet.`, {
          headers: { ...rankHeaders, "cache-control": "public, max-age=30" }
        });
      }
      const player = sorted[idx];
      const rank = idx + 1;
      const total = sorted.length;
      const wagered = "$" + Number(player.wagered || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
      let gap = "";
      if (rank > 1) {
        const ahead = sorted[idx - 1];
        const diff = (ahead.wagered || 0) - (player.wagered || 0);
        gap = ` ($${Number(diff).toLocaleString("en-US", { maximumFractionDigits: 0 })} behind #${rank - 1})`;
      }
      const name = d.brand?.name || slug;
      const text = rank === 1
        ? `${player.name} is #1 of ${total} on ${name}'s leaderboard! 🏆 ${wagered} wagered`
        : `${player.name} is #${rank} of ${total} on ${name}'s leaderboard. ${wagered} wagered${gap}`;
      return new Response(text, {
        headers: { ...rankHeaders, "cache-control": "public, max-age=30" }
      });
    }

    const r = await getPublicSite(env, slug, request);
    if (r && r.requiresPassword) {
      return new Response("Password required.", { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (!r || r.suspended) {
      return new Response("Leaderboard not found.", {
        status: 404,
        headers: { ...rankHeaders, "cache-control": "public, max-age=30" }
      });
    }
    const sorted = (r.data.players || []).slice().sort((a, b) => (b.wagered || 0) - (a.wagered || 0));
    const matchUser = userParam.toLowerCase().replace(/^@/, "").replace(/\s+/g, " ").trim();
    const normalizeForRank = (n) => String(n || "").toLowerCase().replace(/^\*+/, "").replace(/\s+/g, " ").trim();
    const idx = sorted.findIndex(p => normalizeForRank(p.name) === matchUser);
    if (idx === -1) {
      return new Response(`${userParam} is not on ${r.data.brand?.name || slug}'s leaderboard yet.`, {
        headers: { ...rankHeaders, "cache-control": "public, max-age=30" }
      });
    }
    const player = sorted[idx];
    const rank = idx + 1;
    const total = sorted.length;
    const wagered = "$" + Number(player.wagered || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
    let gap = "";
    if (rank > 1) {
      const ahead = sorted[idx - 1];
      const diff = (ahead.wagered || 0) - (player.wagered || 0);
      gap = ` ($${Number(diff).toLocaleString("en-US", { maximumFractionDigits: 0 })} behind #${rank - 1})`;
    }
    const name = r.data.brand?.name || slug;
    const text = rank === 1
      ? `${player.name} is #1 of ${total} on ${name}'s leaderboard! 🏆 ${wagered} wagered`
      : `${player.name} is #${rank} of ${total} on ${name}'s leaderboard. ${wagered} wagered${gap}`;
    return new Response(text, {
      headers: { ...rankHeaders, "cache-control": "public, max-age=30" }
    });
  } catch (e) {
    console.error("[public/rank]", String(e?.message || e));
    return new Response("Something went wrong.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
}

/**
 * Handle GET /api/public/:slug (generic endpoint)
 * Returns the full leaderboard data as JSON
 */
export async function handlePublicData(request, env, deps = {}) {
  const { getPublicSite = defaultGetPublicSite, rateLimit = defaultRateLimit, clientIp = defaultClientIp } = deps;
  try {
    const { slug } = routeContext(request);
    const rl = await rateLimit(env, `pub-data:${clientIp(request)}`, 120, 60);
    if (!rl.ok) return bad("Rate limit exceeded. Try again shortly.", 429, rateLimitHeaders(rl));

    // Demo board has no DB row — serve static demo data.
    if (slug === "demo") {
      return json(demoLeaderboardData(), 200, { "cache-control": "public, max-age=30", ...rateLimitHeaders(rl) });
    }

    const r = await getPublicSite(env, slug, request);
    if (r && r.requiresPassword) return bad("Password required.", 401);
    return r && !r.suspended ? json(r.data, 200, { "cache-control": "public, max-age=30", ...rateLimitHeaders(rl) }) : bad("not found", 404);
  } catch (e) {
    console.error("[public/data]", String(e?.message || e));
    return bad("Something went wrong. Try again.", 500);
  }
}

/**
 * Handle GET /api/public/:slug/stats
 * Public stats page for publishers/streamers to share.
 * Returns summary counts and a 14-day views series.
 */
export async function handlePublicStats(request, env, deps = {}) {
  const { getPublicSite = defaultGetPublicSite, getStats = defaultGetStats, isStatementTimeout = defaultIsStatementTimeout, rateLimit = defaultRateLimit, clientIp = defaultClientIp } = deps;
  try {
    const { slug } = routeContext(request);
    const rl = await rateLimit(env, `pub-stats:${clientIp(request)}`, 60, 60);
    if (!rl.ok) return bad("Rate limit exceeded. Try again shortly.", 429, rateLimitHeaders(rl));

    // Demo board has no DB row — serve static demo data.
    if (slug === "demo") {
      const d = demoLeaderboardData();
      return json({
        slug,
        name: d.brand?.name || slug,
        playerCount: d.players?.length || 0,
        summary: { last7: {}, last30: {}, today: {} },
        days: [],
      }, 200, { "cache-control": "public, max-age=60", ...rateLimitHeaders(rl) });
    }

    const r = await getPublicSite(env, slug, request);
    if (r && r.requiresPassword) return bad("Password required.", 401);
    if (!r || r.suspended) return bad("not found", 404);
    const stats = await getStats(env, r.id);
    return json({
      slug,
      name: r.data.brand?.name || slug,
      playerCount: r.data.players?.length || 0,
      summary: stats ? { last7: stats.last7, last30: stats.last30, today: stats.today } : { last7: {}, last30: {}, today: {} },
      days: stats?.days || [],
    }, 200, { "cache-control": "public, max-age=60", ...rateLimitHeaders(rl) });
  } catch (e) {
    console.error("[public/stats]", String(e?.message || e));
    if (isStatementTimeout(e)) return bad("Analytics are temporarily unavailable. Try again shortly.", 503);
    return bad("Something went wrong. Try again.", 500);
  }
}
