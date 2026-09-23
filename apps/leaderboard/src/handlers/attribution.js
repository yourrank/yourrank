// Attribution analytics and casino postback endpoint.
import { json, bad, requireUser, rateLimit } from "../auth.js";
import { one, query } from "@yourrank/shared/db";
import { verifyHmacSha256Hex } from "@yourrank/shared/crypto";
import {
  POSTBACK_SUNSET,
  computeReplayHash,
  createPostbackKey,
  findPostbackOwner,
  getActivePostbackKey,
  logPostbackIntake,
  recordReplayHash,
  revokePostbackKeys,
  unsignedPostbacksEnabled,
} from "@yourrank/shared/postback";
import { recordConversion } from "@yourrank/shared/conversions";
import { notifyLiveBoard } from "../live-board-config.js";
import { effectivePlan } from "@yourrank/shared/plans";

const MAX_DAYS = 365;

function getDays(url) {
  const raw = Number(url.searchParams.get("days"));
  return Math.min(MAX_DAYS, Math.max(1, Number.isFinite(raw) ? raw : 30));
}

async function getAttributionRows(env, userId, days) {
  const rows = await query(
    `SELECT
       o.id,
       o.label,
       COALESCE(c.name, '–') AS casino,
       o.is_active,
       COALESCE(ca.clicks, 0) AS clicks,
       COALESCE(ca.unique_visitors, 0) AS unique_visitors,
       COALESCE(co.conversions, 0) AS conversions,
       COALESCE(co.revenue, 0) AS revenue,
       COALESCE(co.depositors, 0) AS depositors
     FROM offers o
     LEFT JOIN casinos c ON c.id = o.casino_id
     LEFT JOIN (
       SELECT sl.offer_id,
              COUNT(*) AS clicks,
              COUNT(DISTINCT cl.ip_hash) AS unique_visitors
         FROM clicks cl
         JOIN short_links sl ON sl.id = cl.short_link_id
        WHERE cl.ts > now() - ($2::text || ' days')::interval
        GROUP BY sl.offer_id
     ) ca ON ca.offer_id = o.id
     LEFT JOIN (
       SELECT cv.offer_id,
              COUNT(*) AS conversions,
              COALESCE(SUM(cv.amount), 0) AS revenue,
              COUNT(DISTINCT cv.click_ref) AS depositors
         FROM conversions cv
        WHERE cv.owner_id = $1
          AND cv.ts > now() - ($2::text || ' days')::interval
        GROUP BY cv.offer_id
     ) co ON co.offer_id = o.id
     WHERE o.owner_id = $1
     ORDER BY co.revenue DESC NULLS LAST, ca.clicks DESC NULLS LAST, o.label ASC`,
    [userId, days]
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    casino: r.casino,
    isActive: r.is_active,
    clicks: Number(r.clicks) || 0,
    uniqueVisitors: Number(r.unique_visitors) || 0,
    conversions: Number(r.conversions) || 0,
    revenue: Number(r.revenue) || 0,
    depositors: Number(r.depositors) || 0,
  }));
}

// GET /api/attribution — per-offer clicks, conversions, revenue, and postback URL.
export async function handleAttribution(request, env) {
  const { user, res } = await requireUser(request, env);
  if (!user) return res;
  if (!(await rateLimit(env, `attribution:${user.id}`, 120, 60)).ok) {
    return bad("Too many requests. Try again later.", 429);
  }
  const url = new URL(request.url);
  const days = getDays(url);

  // H-04: active postback key is read from postback_keys; if none exists, create
  // one for paid plans. Revocation/rotation is exposed under /api/attribution.
  let key = effectivePlan(user) !== "free" ? await getActivePostbackKey(user.id) : null;
  if (effectivePlan(user) !== "free" && !key) {
    key = await createPostbackKey(user.id, { label: "leaderboard-attribution" });
  }
  const postback = key ? {
    signedEndpoint: `${url.origin}/api/postback`,
    key,
    signature: "hex HMAC-SHA256 of the raw query string, keyed by key",
    legacyUrl: `${url.origin}/api/postback?key=${encodeURIComponent(key)}`,
    legacySunset: POSTBACK_SUNSET,
  } : null;

  const offers = await getAttributionRows(env, user.id, days);
  const summary = offers.reduce((s, o) => {
    s.clicks += o.clicks;
    s.uniqueVisitors += o.uniqueVisitors;
    s.conversions += o.conversions;
    s.revenue += o.revenue;
    s.depositors += o.depositors;
    return s;
  }, { clicks: 0, uniqueVisitors: 0, conversions: 0, revenue: 0, depositors: 0 });

  return json({ ok: true, days, summary, postback, offers });
}

// GET /api/attribution/export — CSV download of the same data.
export async function handleAttributionExport(request, env) {
  const { user, res } = await requireUser(request, env);
  if (!user) return res;
  if (!(await rateLimit(env, `attribution-export:${user.id}`, 30, 60)).ok) {
    return bad("Too many requests. Try again later.", 429);
  }
  const days = getDays(new URL(request.url));
  const offers = await getAttributionRows(env, user.id, days);

  const escapeCsv = (s) => {
    const str = String(s ?? "");
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };
  const header = ["Offer", "Casino", "Clicks", "Unique Visitors", "Conversions", "Revenue", "Depositors"];
  const lines = [header.join(",")];
  for (const o of offers) {
    lines.push([
      escapeCsv(o.label),
      escapeCsv(o.casino),
      escapeCsv(o.clicks),
      escapeCsv(o.uniqueVisitors),
      escapeCsv(o.conversions),
      escapeCsv(o.revenue.toFixed(2)),
      escapeCsv(o.depositors),
    ].join(","));
  }
  const csv = lines.join("\n") + "\n";
  const filename = `attribution-${days}d-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

// POST /api/attribution/rotate-key — create a new postback key and revoke active ones.
export async function handleRotatePostbackKey(request, env) {
  const { user, res } = await requireUser(request, env);
  if (!user) return res;
  if (effectivePlan(user) === "free") return bad("Postbacks require a paid plan.", 402);
  if (!(await rateLimit(env, `rotate-pb:${user.id}`, 10, 60)).ok) {
    return bad("Too many rotations. Try again later.", 429);
  }
  const key = await createPostbackKey(user.id, { label: "leaderboard-attribution", revokeOthers: true });
  const url = new URL(request.url);
  return json({
    ok: true,
    postback: {
      signedEndpoint: `${url.origin}/api/postback`,
      key,
      signature: "hex HMAC-SHA256 of the raw query string, keyed by key",
      legacyUrl: `${url.origin}/api/postback?key=${encodeURIComponent(key)}`,
      legacySunset: POSTBACK_SUNSET,
    },
  });
}

// DELETE /api/attribution/postback-key — revoke all active postback keys.
export async function handleRevokePostbackKey(request, env) {
  const { user, res } = await requireUser(request, env);
  if (!user) return res;
  await revokePostbackKeys(user.id);
  return json({ ok: true });
}

// POST /api/postback — receive casino conversion postbacks.
export async function handlePostback(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || request.headers.get("x-postback-key");
  if (!key) return bad("Missing postback key.", 400);
  if (!(await rateLimit(env, `pb:${key}`, 60, 60)).ok) {
    return bad("Too many requests. Try again later.", 429);
  }

  const sig = request.headers.get("x-postback-signature");
  const unsigned = !sig;
  const legacyHeaders = unsigned ? {
    Deprecation: "true",
    Sunset: POSTBACK_SUNSET,
    Link: '</api/postback>; rel="successor-version"',
  } : undefined;
  if (unsigned && !unsignedPostbacksEnabled(env.POSTBACK_UNSIGNED_ENABLED)) {
    return json({
      error: "Unsigned postbacks are no longer accepted.",
      successor: "/api/postback",
      sunset: POSTBACK_SUNSET,
    }, 410, legacyHeaders);
  }

  if (sig) {
    const qs = url.search.slice(1);
    if (!(await verifyHmacSha256Hex(key, qs, sig))) {
      return bad("Bad signature.", 401);
    }
  }

  // H-04: lookup by key hash, then reject exact replays and support revocation.
  const owner = await findPostbackOwner(key, unsigned ? "unsigned" : "signed");
  if (!owner) return bad("Unknown postback key.", 404, legacyHeaders);
  logPostbackIntake(unsigned ? "api_postback_unsigned" : "pb_signed", owner, !unsigned);

  const clone = request.clone();
  const bodyText = await clone.text();
  const contentType = request.headers.get("content-type") || "";

  const replayInputs = Object.fromEntries(url.searchParams.entries());
  if (bodyText) replayInputs.body = bodyText;
  const replayHash = await computeReplayHash(replayInputs);
  if (!(await recordReplayHash(owner.userId, replayHash))) {
    return bad("Duplicate postback.", 409);
  }

  const out = {};
  const add = (k, v) => {
    if (v === null || v === undefined) return;
    if (out[k] === undefined) { out[k] = v; }
    else if (Array.isArray(out[k])) { out[k].push(v); }
    else { out[k] = [out[k], v]; }
  };

  // Process body first, then query string, so body values win.
  if (bodyText) {
    if (contentType.includes("application/json")) {
      try {
        const body = JSON.parse(bodyText);
        for (const [k, v] of Object.entries(body)) {
          if (Array.isArray(v)) v.forEach((x) => add(k, String(x)));
          else if (v !== null && v !== undefined) add(k, String(v));
        }
      } catch { /* ignore malformed JSON */ }
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      for (const [k, v] of new URLSearchParams(bodyText)) add(k, v);
    }
  }
  for (const [k, v] of url.searchParams) add(k, v);

  delete out.key;
  delete out.signature;

  // Link postback to the leaderboard CTA click when yr_click is echoed back.
  let siteId = null;
  const rawClickRef = out.yr_click;
  const clickRef = Array.isArray(rawClickRef) ? rawClickRef[0] : rawClickRef;
  if (clickRef) {
    const click = await one(
      "SELECT site_id, owner_id FROM site_clicks WHERE click_ref=$1",
      [clickRef]
    );
    if (click && click.owner_id === owner.userId) {
      siteId = click.site_id;
      await one("UPDATE site_clicks SET converted_at=now() WHERE click_ref=$1", [clickRef]);
    }
  }
  // A board-scoped key can only attribute conversions to its own board.
  if (owner.siteId) {
    if (siteId && siteId !== owner.siteId) return bad("This postback key is scoped to another board.", 403);
    siteId = siteId || owner.siteId;
  }

  await recordConversion(owner.userId, out, siteId, (id) => notifyLiveBoard(env, id));
  return json({ ok: true }, 200, legacyHeaders);
}
