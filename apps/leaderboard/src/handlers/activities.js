// Creator-facing safe Activities API.
//
// Wave E deliberately adapts the existing free code-drop workflow instead of
// introducing universal activity persistence. Claims already resolve to the
// authenticated viewer and its site_viewers membership; no participant model
// is inferred or duplicated here.
import { query } from "@yourrank/shared/db";
import { rateLimit } from "@yourrank/shared/ratelimit";
import { requireUser, bad, json } from "../auth.js";
import { getByUser, getBoardById } from "../site.js";
import { requireSiteCapability } from "../site-authorization.js";

const activityDefaults = {
  query,
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
    endsAt: row.expires_at || null,
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
  };
}

async function resolveActivitySite(request, env, user, deps) {
  const url = new URL(request.url);
  const siteId = String(url.searchParams.get("siteId") || "").trim();
  return siteId
    ? deps.getBoardById(env, user.id, siteId)
    : deps.getByUser(env, user.id);
}

export async function handleGetActivities(request, env, injected = {}) {
  const deps = { ...activityDefaults, ...injected };
  const { user, res } = await deps.requireUser(request, env);
  if (res) return res;

  const site = await resolveActivitySite(request, env, user, deps);
  if (!site) return bad("Site not found.", 404);
  const authorization = await deps.requireSiteCapability(
    user,
    site,
    "canRoleManageActivities",
  );
  if (authorization.res) return authorization.res;
  if (!(await deps.rateLimit(env, `activities:${user.id}:${site.id}`, 60, 60)).ok) {
    return bad("Too many requests.", 429);
  }

  const rows = await deps.query(
    `SELECT id, code, points_reward, max_claims, claimed_count, status,
            expires_at, created_at
       FROM code_drops
      WHERE site_id=$1
      ORDER BY created_at DESC
      LIMIT 50`,
    [site.id],
  );

  return privateOk({
    site: { id: site.id, name: site.name || site.slug, slug: site.slug },
    foundation: {
      persistence: "existing_workflow_adapter",
      membership: "site_viewers",
      includedTypes: ["drop"],
      challenges: "deferred",
    },
    activities: (rows || []).map((row) => activityFromCodeDrop(row)),
  });
}
