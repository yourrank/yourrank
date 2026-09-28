import { requireUser as defaultRequireUser, ok, bad, json, readJson } from "../auth.js";
import { getByUser as defaultGetByUser, getBoardById as defaultGetBoardById } from "../site.js";
import { requireSiteCapability as defaultRequireSiteCapability } from "../site-authorization.js";
import { one as defaultOne, exec as defaultExec, withTransaction as defaultWithTransaction } from "@yourrank/shared/db";
import { rateLimit as defaultRateLimit } from "@yourrank/shared/ratelimit";
import { logAudit as defaultLogAudit } from "@yourrank/shared/audit";
import { markSiteViewerActive as defaultMarkActive } from "@yourrank/shared/plan-usage";
import { requireViewer as defaultRequireViewer } from "./viewer-auth.js";
import { resolveJoinableCommunity as defaultResolveJoinableCommunity } from "../viewer-membership.js";

const CHECKIN_AMOUNT_ERROR = "Check-in credits must be a whole number from 1 to 1,000.";

function siteForUser(request, env, user, getByUser, getBoardById) {
  const siteId = new URL(request.url).searchParams.get("siteId");
  return siteId ? getBoardById(env, user.id, siteId) : getByUser(env, user.id);
}

function nextUtcMidnight(value) {
  const date = new Date(value);
  date.setUTCHours(24, 0, 0, 0);
  return date.toISOString();
}

function utcPeriod(value) {
  return new Date(value).toISOString().slice(0, 10);
}

async function authorizeCreator(request, env, deps) {
  const {
    requireUser = defaultRequireUser,
    getByUser = defaultGetByUser,
    getBoardById = defaultGetBoardById,
    requireSiteCapability = defaultRequireSiteCapability,
  } = deps;
  const { user, res } = await requireUser(request, env);
  if (res) return { user: null, site: null, res };
  const site = await siteForUser(request, env, user, getByUser, getBoardById);
  if (!site) return { user, site: null, res: bad("no site", 404) };
  const authorization = await requireSiteCapability(user, site, "canRoleManageRewards");
  if (authorization.res) return { user, site, res: authorization.res };
  return { user, site, res: null };
}

export async function handleGetEarningRules(request, env, deps = {}) {
  const {
    one = defaultOne,
  } = deps;
  const { site, res } = await authorizeCreator(request, env, deps);
  if (res) return res;

  const row = await one(
    `SELECT active, amount
       FROM site_earning_rules
      WHERE site_id=$1 AND rule_type='daily_checkin'`,
    [site.id],
  );
  return ok({ dailyCheckin: row ? { active: row.active, amount: row.amount } : null });
}

export async function handleSaveEarningRules(request, env, deps = {}) {
  const {
    one = defaultOne,
    rateLimit = defaultRateLimit,
    logAudit = defaultLogAudit,
  } = deps;
  const { user, site, res } = await authorizeCreator(request, env, deps);
  if (res) return res;
  if (!(await rateLimit(env, `credits:earning-rules:${user.id}`, 20, 60)).ok) {
    return bad("Too many requests.", 429);
  }

  const body = await readJson(request);
  const active = body?.dailyCheckin?.active;
  const amount = body?.dailyCheckin?.amount;
  if (!Number.isInteger(amount) || amount < 1 || amount > 1000) return bad(CHECKIN_AMOUNT_ERROR);
  if (typeof active !== "boolean") return bad("Check-in active must be a boolean.");

  const row = await one(
    `INSERT INTO site_earning_rules (site_id, rule_type, amount, active)
     VALUES ($1, 'daily_checkin', $2, $3)
     ON CONFLICT (site_id, rule_type)
     DO UPDATE SET amount=EXCLUDED.amount, active=EXCLUDED.active, updated_at=now()
     RETURNING active, amount`,
    [site.id, amount, active],
  );
  await logAudit({
    actorId: user.id,
    action: "earning_rule_updated",
    entityType: "site_earning_rule",
    entityId: site.id,
    request,
    details: {
      board_id: site.id,
      board_slug: site.slug,
      rule_type: "daily_checkin",
      active,
      amount,
    },
  });
  return ok({ dailyCheckin: { active: row.active, amount: row.amount } });
}

export async function handleViewerCheckin(request, env, deps = {}) {
  const {
    one = defaultOne,
    exec = defaultExec,
    withTransaction = defaultWithTransaction,
    rateLimit = defaultRateLimit,
    requireViewer = defaultRequireViewer,
    resolveJoinableCommunity = defaultResolveJoinableCommunity,
    markActive = defaultMarkActive,
    now = () => new Date(),
  } = deps;

  const body = await readJson(request);
  const siteSlug = String(body?.site || "").trim();
  // Resolve the Site before authorizing a local bearer: hostname possession
  // alone never grants Viewer Account authority or access to another community.
  const site = siteSlug ? await resolveJoinableCommunity(request, env, siteSlug) : null;
  const { viewer, res } = await requireViewer(request, env, { siteId: site?.id });
  if (res) return res;
  const viewerId = viewer.id;

  const clientIp = request.headers.get("cf-connecting-ip") || "anon";
  const rl = await rateLimit(env, `checkin:${viewerId}:${clientIp}`, 10, 60);
  if (!rl.ok) return bad("Too many attempts. Please wait a minute.", 429);
  if (!site) return bad("Community is not available.", 404);

  const rule = await one(
    `SELECT id, amount
       FROM site_earning_rules
      WHERE site_id=$1
        AND rule_type='daily_checkin'
        AND active`,
    [site.id],
  );
  if (!rule) return bad("Daily check-in isn't available in this community.", 404);

  const current = now();
  const nextAvailableAt = nextUtcMidnight(current);
  const period = utcPeriod(current);
  const outcome = await withTransaction(async (tx) => {
    const siteViewer = await tx.one(
      `INSERT INTO site_viewers (site_id, viewer_id, balance, total_earned, total_spent)
       VALUES ($1, $2, 0, 0, 0)
       ON CONFLICT (site_id, viewer_id) DO UPDATE SET viewer_id=EXCLUDED.viewer_id
       RETURNING id, balance, blocked`,
      [site.id, viewerId],
    );
    if (siteViewer.blocked) return { blocked: true };

    const claim = await tx.one(
      `INSERT INTO earning_rule_claims
        (rule_id, site_viewer_id, period, amount)
       VALUES
        ($1, $2, (now() AT TIME ZONE 'UTC')::date, $3)
       ON CONFLICT (rule_id, site_viewer_id, period)
       DO NOTHING
       RETURNING id`,
      [rule.id, siteViewer.id, rule.amount],
    );
    if (!claim) return { alreadyCheckedIn: true };

    const updatedViewer = await tx.one(
      `UPDATE site_viewers
          SET balance = balance + $1,
              total_earned = total_earned + $1,
              updated_at=now()
        WHERE id=$2
        RETURNING id, balance`,
      [rule.amount, siteViewer.id],
    );
    await tx.unsafe(
      `INSERT INTO credit_ledger
        (site_viewer_id, type, amount, description, metadata)
       VALUES ($1, 'earn', $2, 'Daily check-in', $3)`,
      [siteViewer.id, rule.amount, { earning_rule_id: rule.id, period }],
    );
    return { success: true, pointsAwarded: rule.amount, newBalance: updatedViewer.balance };
  });

  if (outcome?.blocked) return bad("Check-in is unavailable for this membership.", 403);
  if (outcome?.alreadyCheckedIn) {
    return json({ error: "already_checked_in", nextAvailableAt }, 409);
  }

  await markActive(site.id, viewerId, { one, exec });
  return ok({
    pointsAwarded: outcome.pointsAwarded,
    newBalance: outcome.newBalance,
    nextAvailableAt,
  });
}
