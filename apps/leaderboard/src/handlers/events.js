// Community Events Handlers: Flash Code Drops.
import { requireUser as defaultRequireUser, ok, bad, denied, readJson } from "../auth.js";
import { requireViewer as defaultRequireViewer } from "./viewer-auth.js";
import { getByUser as defaultGetByUser, getBoardById as defaultGetBoardById } from "../site.js";
import { requireSiteCapability } from "../site-authorization.js";
import {
  one as defaultOne,
  query as defaultQuery,
  exec as defaultExec,
  withTransaction as defaultWithTransaction,
} from "@yourrank/shared/db";
import { rateLimit as defaultRateLimit } from "@yourrank/shared/ratelimit";
import { logAudit as defaultLogAudit } from "@yourrank/shared/audit";
import { creatorExpansionRestriction, markSiteViewerActive } from "@yourrank/shared/plan-usage";
import { limitDenial } from "@yourrank/shared/entitlements";
import { getPlanLimit } from "@yourrank/shared/plans";
import { createCanonicalCodeDrop, validateCodeDropConfig } from "../code-drop-service.js";
import { resolveJoinableCommunity as defaultResolveJoinableCommunity } from "../viewer-membership.js";
import { recordAbuseSignals as defaultRecordSignals } from "../abuse-signals.js";
/**
 * GET /api/events/drops — List flash code drops
 */
export async function handleGetCodeDrops(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    getByUser = defaultGetByUser,
    getBoardById = defaultGetBoardById,
    query = defaultQuery,
    requireSiteCapabilityImpl = requireSiteCapability,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId");
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  if (!site) return bad("Site not found", 404);
  const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageActivities");
  if (authorization.res) return authorization.res;

  const drops = await query(
    `SELECT id, code, points_reward, max_claims, claimed_count, status, expires_at, created_at
       FROM code_drops
      WHERE site_id=$1
      ORDER BY created_at DESC LIMIT 50`,
    [site.id]
  );

  return ok({ drops: drops || [] });
}

/**
 * POST /api/events/drops — Create a new flash code drop
 */
export async function handleCreateCodeDrop(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    getByUser = defaultGetByUser,
    getBoardById = defaultGetBoardById,
    exec = defaultExec,
    logAudit = defaultLogAudit,
    expansionRestriction = creatorExpansionRestriction,
    requireSiteCapabilityImpl = requireSiteCapability,
    createCodeDrop = createCanonicalCodeDrop,
    now = () => new Date(),
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const body = await readJson(request);
  const validated = validateCodeDropConfig(body, { requireCode: true });
  if (!validated.ok) return bad(validated.error);
  const { code, pointsReward, maxClaims } = validated.value;

  const url = new URL(request.url);
  const siteId = body?.siteId || url.searchParams.get("siteId");
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  if (!site) return bad("Site not found", 404);
  const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageActivities");
  if (authorization.res) return authorization.res;
  const expansion = await expansionRestriction(site.user_id || user.id);
  if (expansion.restricted) {
    return denied(limitDenial("free", "active_viewers_30d", Math.max(Number(expansion.usage?.activeViewers) || 0, getPlanLimit("free", "active_viewers_30d"))), { actorId: user.id, request });
  }

  try {
    const result = await createCodeDrop({
      db: { exec },
      siteId: site.id,
      config: validated.value,
      code,
      now: now(),
    });

    await logAudit({
      actorId: user.id,
      action: "code_drop_create",
      entityType: "code_drop",
      entityId: result.id,
      request,
      details: { site_id: site.id, pointsReward, maxClaims },
    });

    return ok({ drop: result, message: `Drop code ${code} is now live! ⚡` });
  } catch (err) {
    if (String(err?.message || "").includes("idx_code_drops_site_code")) {
      return bad("A drop with this code already exists for this site.");
    }
    throw err;
  }
}

/**
 * POST /api/events/drops/claim — Viewer redeems a flash drop code
 */
export async function handleClaimCodeDrop(request, env, deps = {}) {
  const {
    one = defaultOne,
    exec = defaultExec,
    withTransaction = defaultWithTransaction,
    rateLimit = defaultRateLimit,
    requireViewer = defaultRequireViewer,
    resolveJoinableCommunity = defaultResolveJoinableCommunity,
    markActive = markSiteViewerActive,
    recordSignals = defaultRecordSignals,
  } = deps;

  const body = await readJson(request);
  const rawCode = String(body?.code || "").trim().toUpperCase();
  const siteSlug = String(body?.site || "").trim();
  // Resolve the Site before authorizing a local bearer: hostname possession alone
  // never grants Viewer Account authority or access to another community.
  const site = siteSlug ? await resolveJoinableCommunity(request, env, siteSlug) : null;
  const { viewer, res } = await requireViewer(request, env, { siteId: site?.id });
  if (res) return res;
  const viewerId = viewer.id;

  if (!rawCode || !siteSlug) {
    return bad("Code and community are required.");
  }

  // Rate limit claims by IP / viewer to prevent brute forcing
  const clientIp = request.headers.get("cf-connecting-ip") || "anon";
  const rl = await rateLimit(env, `drop:claim:${viewerId}:${clientIp}`, 15, 60);
  if (!rl.ok) return bad("Too many attempts. Please wait a minute.", 429);

  if (!site) return bad("Community is not available.", 404);

  // Find the drop for this site; the creator may have ended it early.
  const drop = await one(
    `SELECT id, code, points_reward, max_claims, claimed_count, status, expires_at, closed_at
       FROM code_drops
      WHERE site_id=$1 AND lower(code)=lower($2)`,
    [site.id, rawCode]
  );

  if (drop?.closed_at) {
    return bad("This drop has ended.", 400);
  }
  if (!drop || drop.status !== "active") {
    return bad("Invalid or expired drop code.", 404);
  }

  if (drop.expires_at && new Date(drop.expires_at).getTime() < Date.now()) {
    await exec("UPDATE code_drops SET status='expired', updated_at=now() WHERE id=$1", [drop.id]);
    return bad("This drop code has expired.", 400);
  }

  if (drop.claimed_count >= drop.max_claims) {
    await exec("UPDATE code_drops SET status='exhausted', updated_at=now() WHERE id=$1", [drop.id]);
    return bad("All claims for this drop have been taken!", 400);
  }

  // Check if viewer already claimed
  const alreadyClaimed = await one(
    "SELECT id FROM code_drop_claims WHERE code_drop_id=$1 AND viewer_id=$2",
    [drop.id, viewerId]
  );
  if (alreadyClaimed) {
    return bad("You have already claimed this drop code!", 400);
  }

  // Execute atomic claim and points award
  const outcome = await withTransaction(async (tx) => {
    // Re-verify under row lock
    const lockedDrop = await tx.one("SELECT claimed_count, max_claims, status FROM code_drops WHERE id=$1 FOR UPDATE", [drop.id]);
    if (lockedDrop.status !== "active") return { ended: true };
    if (lockedDrop.claimed_count >= lockedDrop.max_claims) {
      await tx.unsafe("UPDATE code_drops SET status='exhausted' WHERE id=$1", [drop.id]);
      return { exhausted: true };
    }

    // Membership is part of the successful safe action transaction. Passive,
    // invalid, exhausted, rate-limited and already-claimed requests never create it.
    const siteViewer = await tx.one(
      `INSERT INTO site_viewers (site_id, viewer_id, balance, total_earned, total_spent)
       VALUES ($1, $2, 0, 0, 0)
       ON CONFLICT (site_id, viewer_id) DO UPDATE SET viewer_id=EXCLUDED.viewer_id
       RETURNING id, balance, blocked`,
      [site.id, viewerId],
    );
    if (siteViewer.blocked) return { blocked: true };

    // Claim first: a duplicate conflicts here, so the count below only ever
    // counts claims that were actually recorded.
    const claim = await tx.one(
      `INSERT INTO code_drop_claims (code_drop_id, site_viewer_id, viewer_id, points_awarded)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code_drop_id, viewer_id) DO NOTHING
       RETURNING id`,
      [drop.id, siteViewer.id, viewerId, drop.points_reward]
    );
    if (!claim) return { alreadyClaimed: true };

    const newClaimedCount = lockedDrop.claimed_count + 1;
    const newStatus = newClaimedCount >= lockedDrop.max_claims ? "exhausted" : "active";

    await tx.unsafe(
      "UPDATE code_drops SET claimed_count=$1, status=$2, updated_at=now() WHERE id=$3",
      [newClaimedCount, newStatus, drop.id]
    );

    const updatedViewer = await tx.one(
      "UPDATE site_viewers SET balance = balance + $1, total_earned = total_earned + $1, updated_at=now() WHERE id=$2 RETURNING id, balance",
      [drop.points_reward, siteViewer.id]
    );

    await tx.unsafe(
      `INSERT INTO credit_ledger (site_viewer_id, type, amount, description)
       VALUES ($1, 'earn', $2, $3)`,
      [siteViewer.id, drop.points_reward, `Flash Code Drop: ${drop.code}`]
    );

    return { success: true, pointsAwarded: drop.points_reward, newBalance: updatedViewer.balance };
  });

  if (outcome?.ended) {
    return bad("This drop has ended.", 400);
  }
  if (outcome?.exhausted) {
    return bad("All claims for this drop have been taken!", 400);
  }
  if (outcome?.alreadyClaimed) {
    return bad("You have already claimed this drop code!", 400);
  }
  if (outcome?.blocked) {
    return bad("Claiming is unavailable for this membership.", 403);
  }

  await markActive(site.id, viewerId, { one, exec });

  // Anti-abuse signals record only after a successful claim commits and must
  // never fail the viewer's claim.
  await recordSignals({ env, request, viewerId, siteId: site.id, action: "drop_claim" })
    .catch((err) => console.error("[abuse-signals] record failed:", "drop_claim", String(err?.message || err)));

  return ok({
    code: drop.code,
    pointsAwarded: outcome.pointsAwarded,
    newBalance: outcome.newBalance,
    message: `🎉 Success! +${outcome.pointsAwarded} credits added to your balance.`,
  });
}
