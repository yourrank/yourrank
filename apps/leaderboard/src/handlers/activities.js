// Creator-facing safe Activities API.
//
// Wave E deliberately adapts the existing free code-drop workflow instead of
// introducing universal activity persistence. Claims already resolve to the
// authenticated viewer and its site_viewers membership; no participant model
// is inferred or duplicated here.
import { one, query } from "@yourrank/shared/db";
import { rateLimit } from "@yourrank/shared/ratelimit";
import { logAudit } from "@yourrank/shared/audit";
import { requireUser, bad, json, readJson } from "../auth.js";
import { getByUser, getBoardById } from "../site.js";
import { requireSiteCapability } from "../site-authorization.js";
import { listActivityAutomation } from "./activity-automation.js";
import { pageMeta, readListCursor, readListLimit } from "../list-cursor.js";

const ACTIVITY_PAGE = 50;
const ACTIVITY_PAGE_MAX = 100;

const activityDefaults = {
  query,
  one,
  logAudit,
  rateLimit,
  requireUser,
  getByUser,
  getBoardById,
  requireSiteCapability,
};

const privateOk = (data) => json(
  { ok: true, ...data },
  200,
  { "cache-control": "no-store, no-cache, must-revalidate" },
);

function dropState(row, now) {
  const status = String(row.status || "active").toLowerCase();
  const expiresAt = row.expires_at ? Date.parse(row.expires_at) : NaN;
  if (status === "exhausted") return { state: "completed", label: "Claimed out" };
  if (row.closed_at) return { state: "completed", label: "Ended by creator" };
  if (status !== "active") return { state: "completed", label: "Ended" };
  if (Number.isFinite(expiresAt) && expiresAt <= now) {
    return { state: "completed", label: "Expired" };
  }
  return { state: "open", label: "Open" };
}

export function activityFromCodeDrop(row, now = Date.now()) {
  const state = dropState(row, now);
  return {
    id: `drop:${row.id}`,
    source: { kind: "code_drop", id: row.id },
    type: "drop",
    typeLabel: "Drop",
    title: `Code drop ${row.code}`,
    state: state.state,
    stateLabel: state.label,
    createdAt: row.created_at,
    endsAt: row.closed_at || row.expires_at || null,
    participation: {
      mode: "free",
      cost: 0,
      identity: "site_membership",
    },
    progress: {
      claimed: Number(row.claimed_count) || 0,
      capacity: Number(row.max_claims) || 0,
    },
    reward: {
      creditsPerClaim: Number(row.points_reward) || 0,
    },
    actions: { canEnd: state.state === "open" },
  };
}

const DROP_COLUMNS = `id, code, points_reward, max_claims, claimed_count, status,
          expires_at, closed_at, created_at`;
// SQL twin of dropState()'s "open": still active, not closed by the creator,
// not naturally expired. Evaluated before pagination so a filtered page and
// its total describe the same set.
const OPEN_DROP_SQL = `d.status='active' AND d.closed_at IS NULL
        AND (d.expires_at IS NULL OR d.expires_at > now())`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseActivityId(raw) {
  const value = String(raw || "").trim();
  const id = value.startsWith("drop:") ? value.slice(5) : value;
  return UUID.test(id) ? id : null;
}

async function authorizeActivityRequest(request, env, deps, siteIdFromBody) {
  const { user, res } = await deps.requireUser(request, env);
  if (res) return { res };
  const url = new URL(request.url);
  const siteId = String(siteIdFromBody || url.searchParams.get("siteId") || "").trim();
  const site = siteId
    ? await deps.getBoardById(env, user.id, siteId)
    : await deps.getByUser(env, user.id);
  if (!site) return { res: bad("Site not found.", 404) };
  const authorization = await deps.requireSiteCapability(
    user,
    site,
    "canRoleManageActivities",
  );
  if (authorization.res) return { res: authorization.res };
  return { user, site };
}

/**
 * POST /api/activities/close — the creator ends an open Code Drop now.
 * A creator-ended drop is an expired drop with `closed_at` set, so every
 * existing reader (claims, lists, automation) already treats it as ended.
 * Idempotent for an already-closed drop; a drop that ended on its own
 * (exhausted/expired) is reported as a conflict with its current state so the
 * dashboard can refresh instead of pretending it acted.
 */
export async function handleCloseActivity(request, env, injected = {}) {
  const deps = { ...activityDefaults, ...injected };
  const body = await readJson(request);
  const { user, site, res } = await authorizeActivityRequest(request, env, deps, body?.siteId);
  if (res) return res;
  if (!(await deps.rateLimit(env, `activities:close:${user.id}:${site.id}`, 30, 60)).ok) {
    return bad("Too many requests.", 429);
  }

  const dropId = parseActivityId(body?.activityId ?? body?.id);
  if (!dropId) return bad("Activity id is required.", 400);

  const closed = await deps.one(
    `UPDATE code_drops
        SET status='expired', closed_at=now(), updated_at=now()
      WHERE id=$1 AND site_id=$2 AND status='active' AND closed_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
      RETURNING ${DROP_COLUMNS}`,
    [dropId, site.id],
  );
  if (closed) {
    await deps.logAudit({
      actorId: user.id,
      action: "code_drop_close",
      entityType: "code_drop",
      entityId: closed.id,
      request,
      details: { site_id: site.id, claimed_count: Number(closed.claimed_count) || 0 },
    });
    return privateOk({ activity: activityFromCodeDrop(closed), changed: true });
  }

  const existing = await deps.one(
    `SELECT ${DROP_COLUMNS} FROM code_drops WHERE id=$1 AND site_id=$2`,
    [dropId, site.id],
  );
  if (!existing) return bad("Activity not found.", 404);
  const activity = activityFromCodeDrop(existing);
  if (existing.closed_at) return privateOk({ activity, changed: false });
  return json(
    { ok: false, error: `This activity already ended (${activity.stateLabel.toLowerCase()}).`, activity },
    409,
    { "cache-control": "no-store, no-cache, must-revalidate" },
  );
}

export async function handleGetActivities(request, env, injected = {}) {
  const deps = { ...activityDefaults, ...injected };
  const { user, site, res } = await authorizeActivityRequest(request, env, deps);
  if (res) return res;
  if (!(await deps.rateLimit(env, `activities:${user.id}:${site.id}`, 60, 60)).ok) {
    return bad("Too many requests.", 429);
  }

  const url = new URL(request.url);
  const limit = readListLimit(url, { fallback: ACTIVITY_PAGE, max: ACTIVITY_PAGE_MAX });
  const { cursor, valid } = readListCursor(url);
  if (!valid) return bad("Invalid cursor.", 400);
  const stateParam = String(url.searchParams.get("state") || "all").trim().toLowerCase();
  if (stateParam !== "all" && stateParam !== "open") return bad("Invalid state filter.", 400);
  const stateSql = stateParam === "open" ? ` AND ${OPEN_DROP_SQL}` : "";
  if (cursor) {
    const anchor = await deps.one(
      `SELECT id FROM code_drops WHERE site_id=$1 AND id=$2`,
      [site.id, cursor],
    );
    if (!anchor) return bad("This page has expired. Reload the list.", 410);
  }

  // Keyset pagination on (created_at, id): newest first, so pages stay stable
  // while drops are created or closed between requests.
  const rows = await deps.query(
    `SELECT ${DROP_COLUMNS}
       FROM code_drops d
      WHERE d.site_id=$1${stateSql}
        AND ($2::uuid IS NULL OR (d.created_at, d.id) < (
              SELECT a.created_at, a.id FROM code_drops a WHERE a.id = $2::uuid
            ))
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT $3`,
    [site.id, cursor, limit + 1],
  );
  const { items, page } = pageMeta(rows || [], limit, (row) => row.id);
  const totals = await deps.one(
    `SELECT count(*)::int AS total FROM code_drops d WHERE d.site_id=$1${stateSql}`,
    [site.id],
  );
  const automation = cursor ? undefined : await listActivityAutomation(site.id, {
    query: deps.query,
    one: deps.one,
    now: new Date(),
  });

  return privateOk({
    site: { id: site.id, name: site.name || site.slug, slug: site.slug },
    foundation: {
      persistence: "existing_workflow_adapter",
      membership: "site_viewers",
      includedTypes: ["drop"],
      challenges: "deferred",
    },
    activities: items.map((row) => activityFromCodeDrop(row)),
    state: stateParam,
    page,
    total: Number(totals?.total) || 0,
    ...(automation ? { automation } : {}),
  });
}
