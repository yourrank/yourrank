// Lucky Wheel Interactive Game Handlers.
import { fromJsonb } from "@yourrank/shared/jsonb";
import { requireUser as defaultRequireUser, ok, bad, readJson } from "../auth.js";
import { getByUser as defaultGetByUser, getBoardById as defaultGetBoardById } from "../site.js";
import { requireSiteCapability } from "../site-authorization.js";
import {
  one as defaultOne,
  withTransaction as defaultWithTransaction,
} from "@yourrank/shared/db";
import { rateLimit as defaultRateLimit } from "@yourrank/shared/ratelimit";
import { logAudit as defaultLogAudit } from "@yourrank/shared/audit";
import { requireViewer as defaultRequireViewer } from "./viewer-auth.js";

const DEFAULT_SEGMENTS = [
  { id: "s1", label: "+100 Pts", type: "points", value: 100, color: "#2f6bff", weight: 25 },
  { id: "s2", label: "+25 Pts", type: "points", value: 25, color: "#10b981", weight: 35 },
  { id: "s3", label: "2x Multiplier", type: "boost", value: 2, color: "#8b5cf6", weight: 15 },
  { id: "s4", label: "🔥 500 Mega Pts", type: "points", value: 500, color: "#f59e0b", weight: 5 },
  { id: "s5", label: "🎁 Free Item", type: "shop_item", value: 1, color: "#ec4899", weight: 5 },
  { id: "s6", label: "+50 Pts", type: "points", value: 50, color: "#3b82f6", weight: 30 },
  { id: "s7", label: "👑 VIP Role", type: "role", value: 1, color: "#6366f1", weight: 5 },
  { id: "s8", label: "Try Again", type: "none", value: 0, color: "#64748b", weight: 20 },
];

function pickWeightedSegment(segments) {
  const totalWeight = segments.reduce((sum, s) => sum + Math.max(1, s.weight || 10), 0);
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  let randomVal = (arr[0] % 10000) / 10000 * totalWeight;

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const w = Math.max(1, s.weight || 10);
    if (randomVal <= w) return { index: i, segment: s };
    randomVal -= w;
  }
  return { index: 0, segment: segments[0] };
}

/**
 * GET /api/games/wheel/config — Get wheel config for site
 */
export async function handleGetWheelConfig(request, env, deps = {}) {
  const {
    one = defaultOne,
  } = deps;

  const url = new URL(request.url);
  const siteSlugOrId = url.searchParams.get("site") || url.searchParams.get("siteId");
  if (!siteSlugOrId) return bad("Site identifier is required.");

  const site = await one("SELECT id, name FROM sites WHERE slug=$1 OR id::text=$1", [siteSlugOrId]);
  if (!site) return bad("Site not found.", 404);

  const config = await one("SELECT spin_cost, enabled, segments_json FROM wheel_configs WHERE site_id=$1", [site.id]);

  let segments = DEFAULT_SEGMENTS;
  let spinCost = 50;
  let enabled = true;

  if (config) {
    spinCost = config.spin_cost;
    enabled = config.enabled;
    const raw = fromJsonb(config.segments_json);
    if (Array.isArray(raw) && raw.length >= 2) segments = raw;
  }

  return ok({ siteId: site.id, spinCost, enabled, segments });
}

/**
 * POST /api/games/wheel/config — Streamer updates wheel config
 */
export async function handleUpdateWheelConfig(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    getByUser = defaultGetByUser,
    getBoardById = defaultGetBoardById,
    one = defaultOne,
    logAudit = defaultLogAudit,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const body = await readJson(request);
  const spinCost = Math.max(0, parseInt(body?.spinCost, 10) || 50);
  const enabled = body?.enabled !== false;
  const rawSegments = Array.isArray(body?.segments) && body.segments.length >= 2 ? body.segments : DEFAULT_SEGMENTS;

  const segments = rawSegments.slice(0, 16).map((s, idx) => ({
    id: String(s.id || `s${idx + 1}`),
    label: String(s.label || `Prize ${idx + 1}`).trim().slice(0, 30),
    type: String(s.type || "points"),
    value: parseInt(s.value, 10) || 0,
    color: String(s.color || "#2f6bff"),
    weight: Math.max(1, parseInt(s.weight, 10) || 10),
  }));

  const url = new URL(request.url);
  const siteId = body?.siteId || url.searchParams.get("siteId");
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  if (!site) return bad("Site not found", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageBot");
  if (authorization.res) return authorization.res;

  const result = await one(
    `INSERT INTO wheel_configs (site_id, spin_cost, enabled, segments_json, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (site_id) DO UPDATE
        SET spin_cost=$2, enabled=$3, segments_json=$4, updated_at=now()
     RETURNING spin_cost, enabled, segments_json`,
    [site.id, spinCost, enabled, segments]
  );

  await logAudit({
    actorId: user.id,
    action: "wheel_config_update",
    entityType: "wheel_config",
    entityId: site.id,
    request,
    details: { spinCost, enabled, segmentCount: segments.length },
  });

  return ok({ config: result, message: "Lucky Wheel configuration updated! 🎡" });
}

/**
 * POST /api/games/wheel/spin — Viewer spins the wheel
 */
export async function handleSpinWheel(request, env, deps = {}) {
  const {
    one = defaultOne,
    withTransaction = defaultWithTransaction,
    rateLimit = defaultRateLimit,
    requireViewer = defaultRequireViewer,
  } = deps;

  const { viewer, res } = await requireViewer(request, env);
  if (res) return res;

  const body = await readJson(request);
  const siteSlugOrId = String(body?.site || body?.siteId || "").trim();
  const viewerId = viewer.id;

  if (!siteSlugOrId) {
    return bad("Site is required.");
  }

  // Rate limit spins per viewer/IP
  const clientIp = request.headers.get("cf-connecting-ip") || "anon";
  const rl = await rateLimit(env, `wheel:spin:${clientIp}:${viewerId}`, 30, 60);
  if (!rl.ok) return bad("Slow down! Please wait a moment between spins.", 429);

  const site = await one("SELECT id, name FROM sites WHERE slug=$1 OR id::text=$1", [siteSlugOrId]);
  if (!site) return bad("Site not found.", 404);

  const config = await one("SELECT spin_cost, enabled, segments_json FROM wheel_configs WHERE site_id=$1", [site.id]);
  const spinCost = config ? config.spin_cost : 50;
  const enabled = config ? config.enabled : true;

  if (!enabled) return bad("Lucky wheel is currently disabled by the streamer.", 400);

  let segments = DEFAULT_SEGMENTS;
  if (config?.segments_json) {
    const raw = fromJsonb(config.segments_json);
    if (Array.isArray(raw) && raw.length >= 1) segments = raw;
  }

  const siteViewer = await one(
    "SELECT id, balance FROM site_viewers WHERE site_id=$1 AND viewer_id=$2",
    [site.id, viewerId]
  );

  if (!siteViewer) return bad("Viewer not found on this site.", 404);
  if ((siteViewer.balance || 0) < spinCost) {
    return bad(`Insufficient credits. You need ${spinCost} pts to spin (you have ${siteViewer.balance || 0} pts).`);
  }

  // Provably fair weighted random pick
  const { index: winningIndex, segment: won } = pickWeightedSegment(segments);
  const pointsDelta = (won.type === "points" ? won.value : 0) - spinCost;

  const outcome = await withTransaction(async (tx) => {
    // Deduct cost and add winning points
    const updatedViewer = await tx.one(
      "UPDATE site_viewers SET balance = balance + $1, total_earned = total_earned + $2, updated_at=now() WHERE id=$3 AND balance >= $4 RETURNING id, balance",
      [pointsDelta, won.type === "points" ? won.value : 0, siteViewer.id, spinCost]
    );
    if (!updatedViewer) return { error: `Insufficient credits. You need ${spinCost} pts to spin (you have ${siteViewer.balance || 0} pts).`, status: 400 };

    // Record in wheel_spins history
    await tx.unsafe(
      `INSERT INTO wheel_spins (site_id, site_viewer_id, viewer_id, segment_id, cost_paid, reward_label, reward_type, reward_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [site.id, siteViewer.id, viewerId, won.id, spinCost, won.label, won.type, won.value]
    );

    // Record in credit ledger
    await tx.unsafe(
      `INSERT INTO credit_ledger (site_viewer_id, type, amount, description)
       VALUES ($1, 'game', $2, $3)`,
      [siteViewer.id, pointsDelta, `Lucky Wheel Spin (${won.label})`]
    );

    return {
      newBalance: updatedViewer.balance,
    };
  });
  if (outcome.error) return bad(outcome.error, outcome.status);

  return ok({
    winningIndex,
    segment: won,
    newBalance: outcome.newBalance,
    message: won.value > 0 ? `🎉 You won ${won.label}!` : `Result: ${won.label}`,
  });
}
