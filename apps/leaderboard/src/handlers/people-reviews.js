// People → Reviews adapter.
//
// Wave F has one proven reusable-enough human-decision source: persisted
// tournament-entry exceptions. The queue intentionally remains an adapter
// over that source and the existing audit_log; it does not introduce a
// universal Review table. Only zero-entry-fee tournaments are eligible, and
// score/raw-signal fields are never selected or returned.
import { one, query, withTransaction } from "@yourrank/shared/db";
import { rateLimit } from "@yourrank/shared/ratelimit";
import { requireUser, bad, json, readJson } from "../auth.js";
import { getByUser, getBoardById } from "../site.js";
import { requireSiteCapability } from "../site-authorization.js";

const REVIEW_PREFIX = "tournament_entry:";
const REVIEW_LIMIT = 100;
const PRIVATE_CACHE = "no-store, no-cache, must-revalidate";
const REVIEW_TYPE = "participant_eligibility_exception";
const REVIEW_REASON = Object.freeze({
  code: "duplicate_participation_requires_review",
  label: "Possible duplicate participation",
  explanation: "This zero-cost tournament signup was flagged for an additional eligibility check. Similar signals can have legitimate explanations.",
});

const reviewDefaults = {
  one,
  query,
  withTransaction,
  rateLimit,
  requireUser,
  getByUser,
  getBoardById,
  requireSiteCapability,
};

function privateResponse(response) {
  if (!response) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", PRIVATE_CACHE);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const privateOk = (data) => json(
  { ok: true, ...data },
  200,
  { "cache-control": PRIVATE_CACHE },
);

const privateBad = (message, status = 400) => bad(
  message,
  status,
  { "cache-control": PRIVATE_CACHE },
);

function sourceIdFromReviewId(reviewId) {
  const value = String(reviewId || "");
  if (!value.startsWith(REVIEW_PREFIX)) return "";
  const sourceId = value.slice(REVIEW_PREFIX.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId)
    ? sourceId
    : "";
}

function reviewIdFromRequest(request) {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const reviewsIndex = parts.indexOf("reviews");
  if (reviewsIndex < 0 || !parts[reviewsIndex + 1]) return "";
  try {
    return decodeURIComponent(parts[reviewsIndex + 1]);
  } catch {
    return "";
  }
}

function linkedIdentities(row) {
  const identities = [];
  if (row.kick_linked_at) identities.push({ provider: "Kick", displayName: row.kick_username || null });
  if (row.discord_linked_at) identities.push({ provider: "Discord", displayName: row.discord_username || null });
  return identities;
}

function decisionForReviewAction(action) {
  if (action === "people_review_allow") return "allow";
  if (action === "people_review_exclude") return "exclude";
  return null;
}

function allowedDecisionsForSourceStatus(status) {
  return status === "selected" ? ["allow"] : ["allow", "exclude"];
}

function reviewSummary(row) {
  const decision = decisionForReviewAction(row.review_action);
  const identities = linkedIdentities(row);
  return {
    id: `${REVIEW_PREFIX}${row.source_id}`,
    type: REVIEW_TYPE,
    typeLabel: "Participant eligibility",
    status: decision ? "resolved" : "pending",
    statusLabel: decision ? "Resolved" : "Needs review",
    decision,
    allowedDecisions: decision ? [] : allowedDecisionsForSourceStatus(row.source_status),
    subject: {
      displayName: row.display_name || "Unnamed participant",
      membershipId: row.membership_id || null,
      memberDisplayName: identities.find((identity) => identity.displayName)?.displayName || null,
    },
    source: {
      kind: "tournament_entry",
      workflow: "Tournament signup",
      title: row.tournament_title || "Tournament",
    },
    reason: REVIEW_REASON,
    createdAt: row.created_at,
    resolvedAt: decision ? row.review_resolved_at || null : null,
  };
}

function reviewDetail(row) {
  const summary = reviewSummary(row);
  return {
    ...summary,
    context: {
      membership: row.membership_id ? {
        id: row.membership_id,
        memberSince: row.member_since || null,
        linkedIdentities: linkedIdentities(row),
      } : null,
      participation: {
        mode: "free",
        joinedAt: row.created_at,
      },
      guidance: "This context does not prove that two accounts belong to the same person. Shared households, similar names, and provider changes can be legitimate.",
    },
  };
}

const REVIEW_SELECT = `
  SELECT te.id AS source_id, te.display_name, te.viewer_id,
         te.status AS source_status, te.created_at, te.updated_at,
         t.id AS tournament_id, t.title AS tournament_title,
         sv.id AS membership_id, sv.created_at AS member_since,
         v.kick_username, v.discord_username,
         v.kick_linked_at, v.discord_linked_at,
         review_decision.action AS review_action,
         review_decision.created_at AS review_resolved_at
    FROM tournament_entries te
    JOIN tournaments t ON t.id = te.tournament_id
    LEFT JOIN site_viewers sv
      ON sv.site_id = t.site_id AND sv.viewer_id = te.viewer_id
    LEFT JOIN viewers v ON v.id = te.viewer_id
    LEFT JOIN LATERAL (
      SELECT a.action, a.created_at
        FROM audit_log a
       WHERE a.entity_type='tournament_entry' AND a.entity_id=te.id::text
         AND a.action IN ('people_review_allow', 'people_review_exclude')
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 1
    ) review_decision ON true`;

export async function loadPeopleReviewCounts(siteId, oneImpl = one) {
  const countRow = await oneImpl(
    `SELECT
       count(*) FILTER (WHERE review_decision.action IS NULL)::integer AS pending,
       count(*) FILTER (WHERE review_decision.action IS NOT NULL)::integer AS resolved
       FROM tournament_entries te
       JOIN tournaments t ON t.id = te.tournament_id
       LEFT JOIN LATERAL (
         SELECT a.action
           FROM audit_log a
          WHERE a.entity_type='tournament_entry' AND a.entity_id=te.id::text
            AND a.action IN ('people_review_allow', 'people_review_exclude')
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT 1
       ) review_decision ON true
      WHERE t.site_id=$1
        AND COALESCE(t.entry_fee, 0) = 0
        AND te.alt_flag = true
        AND te.status IN ('pending', 'confirmed', 'selected', 'waitlist', 'blocked', 'removed')`,
    [siteId],
  );
  return {
    pending: Number(countRow?.pending) || 0,
    resolved: Number(countRow?.resolved) || 0,
  };
}

async function reviewAccess(request, env, deps) {
  const { user, res } = await deps.requireUser(request, env);
  if (res) return { res: privateResponse(res) };
  const url = new URL(request.url);
  const siteId = String(url.searchParams.get("siteId") || "").trim();
  const site = siteId
    ? await deps.getBoardById(env, user.id, siteId)
    : await deps.getByUser(env, user.id);
  if (!site) return { res: privateBad("Site not found.", 404) };
  const authorization = await deps.requireSiteCapability(user, site, "canRoleManageReviews");
  if (authorization.res) return { res: privateResponse(authorization.res) };
  return { user, site, role: authorization.role, res: null };
}

async function loadReview(siteId, sourceId, deps, { lock = false } = {}) {
  const suffix = lock ? " FOR UPDATE OF te" : "";
  return deps.one(
    `${REVIEW_SELECT}
      WHERE t.site_id=$1 AND te.id=$2
        AND COALESCE(t.entry_fee, 0) = 0
        AND te.alt_flag = true
        AND te.status IN ('pending', 'confirmed', 'selected', 'waitlist', 'blocked', 'removed')${suffix}`,
    [siteId, sourceId],
  );
}

function queueFilter(url) {
  const value = String(url.searchParams.get("status") || "pending").toLowerCase();
  return ["pending", "resolved", "all"].includes(value) ? value : "";
}

export async function handlePeopleReviews(request, env, injected = {}) {
  const deps = { ...reviewDefaults, ...injected };
  const access = await reviewAccess(request, env, deps);
  if (access.res) return access.res;
  const { user, site } = access;
  if (!(await deps.rateLimit(env, `people:reviews:${user.id}:${site.id}`, 60, 60)).ok) {
    return privateBad("Too many requests.", 429);
  }

  const filter = queueFilter(new URL(request.url));
  if (!filter) return privateBad("Unsupported review filter.");

  const rows = await deps.query(
    `${REVIEW_SELECT}
      WHERE t.site_id=$1
        AND COALESCE(t.entry_fee, 0) = 0
        AND te.alt_flag = true
        AND te.status IN ('pending', 'confirmed', 'selected', 'waitlist', 'blocked', 'removed')
        AND (
          $2 = 'all'
          OR ($2 = 'pending' AND review_decision.action IS NULL)
          OR ($2 = 'resolved' AND review_decision.action IS NOT NULL)
        )
      ORDER BY
        CASE WHEN review_decision.action IS NULL THEN 0 ELSE 1 END,
        CASE WHEN review_decision.action IS NULL THEN te.created_at END ASC,
        CASE WHEN review_decision.action IS NOT NULL THEN review_decision.created_at END DESC,
        te.id ASC
      LIMIT $3`,
    [site.id, filter, REVIEW_LIMIT],
  );

  const counts = await loadPeopleReviewCounts(site.id, deps.one);
  const selectedCount = filter === "pending"
    ? counts.pending
    : filter === "resolved"
      ? counts.resolved
      : counts.pending + counts.resolved;

  return privateOk({
    site: { id: site.id, name: site.name || site.slug, slug: site.slug },
    filter,
    counts,
    limit: REVIEW_LIMIT,
    truncated: selectedCount > REVIEW_LIMIT,
    reviews: (rows || []).map(reviewSummary),
  });
}

const HISTORY_ACTIONS = Object.freeze({
  tournament_entry_add: { action: "review_created", label: "Review created" },
  people_review_allow: { action: "decision_made", label: "Allowed for this tournament", decision: "allow" },
  people_review_exclude: { action: "decision_made", label: "Excluded from this tournament", decision: "exclude" },
  tournament_entry_removed: { action: "source_updated", label: "Entry removed in the tournament" },
  tournament_entry_blocked: { action: "source_updated", label: "Entry blocked in the tournament" },
  tournament_entry_restore: { action: "source_updated", label: "Entry restored in the tournament" },
});

function historyFor(row, auditRows) {
  const events = (auditRows || []).map((event) => {
    const mapped = HISTORY_ACTIONS[event.action];
    return mapped ? {
      action: mapped.action,
      label: mapped.label,
      decision: mapped.decision || null,
      actor: event.actor_id ? {
        id: event.actor_id,
        name: event.actor_name || "Creator operator",
      } : null,
      createdAt: event.created_at,
    } : null;
  }).filter(Boolean);

  if (!events.some((event) => event.action === "review_created")) {
    events.unshift({
      action: "review_created",
      label: "Review created",
      decision: null,
      actor: null,
      createdAt: row.created_at,
    });
  }
  return events.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

export async function handlePeopleReviewDetail(request, env, injected = {}) {
  const deps = { ...reviewDefaults, ...injected };
  const access = await reviewAccess(request, env, deps);
  if (access.res) return access.res;
  const { user, site } = access;
  if (!(await deps.rateLimit(env, `people:review:${user.id}:${site.id}`, 60, 60)).ok) {
    return privateBad("Too many requests.", 429);
  }

  const sourceId = sourceIdFromReviewId(reviewIdFromRequest(request));
  if (!sourceId) return privateBad("Review not found.", 404);
  const row = await loadReview(site.id, sourceId, deps);
  if (!row) return privateBad("Review not found.", 404);

  const auditRows = await deps.query(
    `SELECT a.action, a.created_at, a.actor_id,
            COALESCE(NULLIF(u.display_name, ''), u.email::text) AS actor_name
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.entity_type='tournament_entry' AND a.entity_id=$1
        AND a.action IN (
          'tournament_entry_add', 'people_review_allow', 'people_review_exclude',
          'tournament_entry_removed', 'tournament_entry_blocked', 'tournament_entry_restore'
        )
      ORDER BY a.created_at ASC, a.id ASC
      LIMIT 100`,
    [sourceId],
  );

  return privateOk({
    site: { id: site.id, name: site.name || site.slug, slug: site.slug },
    review: {
      ...reviewDetail(row),
      history: historyFor(row, auditRows),
    },
  });
}

async function lockReviewSource(siteId, sourceId, tx, deps) {
  // Tournament entry mutations elsewhere in the repository lock the tournament
  // first and the entry second. Keep the same order here so entry_fee cannot
  // cross the zero-cost safety boundary while a decision is being committed.
  const tournament = await tx.one(
    `SELECT t.id, t.signup_state, t.entry_cap
       FROM tournaments t
       JOIN tournament_entries te ON te.tournament_id=t.id
      WHERE t.site_id=$1 AND te.id=$2
        AND COALESCE(t.entry_fee, 0) = 0
        AND te.alt_flag = true
        AND te.status IN ('pending', 'confirmed', 'selected', 'waitlist', 'blocked', 'removed')
      FOR UPDATE OF t`,
    [siteId, sourceId],
  );
  if (!tournament) return null;
  const row = await loadReview(
    siteId,
    sourceId,
    { ...deps, one: tx.one },
    { lock: true },
  );
  return row ? { row, tournament } : null;
}

async function applySourceDecision(tx, sourceId, row, tournament, decision) {
  let nextStatus = row.source_status;

  if (decision === "allow") {
    if (row.source_status === "pending") {
      nextStatus = "confirmed";
    } else if (row.source_status === "blocked" || row.source_status === "removed") {
      const active = await tx.one(
        `SELECT count(*)::integer AS count
           FROM tournament_entries
          WHERE tournament_id=$1 AND status IN ('pending', 'confirmed', 'selected')`,
        [tournament.id],
      );
      nextStatus = tournament.entry_cap && (active?.count || 0) >= tournament.entry_cap
        ? "waitlist"
        : "pending";
    }
  } else if (row.source_status === "selected") {
    return { error: "This signup has already been selected and cannot be excluded here.", status: 409 };
  } else if (row.source_status !== "blocked" && row.source_status !== "removed") {
    nextStatus = "blocked";
  }

  if (nextStatus === row.source_status) return { row };
  const updated = await tx.one(
    `UPDATE tournament_entries
        SET status=$1, updated_at=now()
      WHERE id=$2 AND status=$3
      RETURNING id AS source_id, status AS source_status, updated_at`,
    [nextStatus, sourceId, row.source_status],
  );
  if (!updated) return { error: "This review changed before your decision was saved.", status: 409 };
  return { row: { ...row, ...updated } };
}

export async function handlePeopleReviewDecision(request, env, injected = {}) {
  const deps = { ...reviewDefaults, ...injected };
  const access = await reviewAccess(request, env, deps);
  if (access.res) return access.res;
  const { user, site } = access;
  if (!(await deps.rateLimit(env, `people:review-decision:${user.id}:${site.id}`, 30, 60)).ok) {
    return privateBad("Too many requests.", 429);
  }

  const sourceId = sourceIdFromReviewId(reviewIdFromRequest(request));
  if (!sourceId) return privateBad("Review not found.", 404);
  const body = await readJson(request);
  const fields = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
  const decision = fields.length === 1 && fields[0] === "decision" ? body.decision : "";
  if (decision !== "allow" && decision !== "exclude") {
    return privateBad("Decision must be allow or exclude.");
  }

  const result = await deps.withTransaction(async (tx) => {
    const locked = await lockReviewSource(site.id, sourceId, tx, deps);
    if (!locked) return { error: "Review not found.", status: 404 };
    const { row, tournament } = locked;

    const currentDecision = decisionForReviewAction(row.review_action);
    if (currentDecision === decision) {
      return { row, replayed: true };
    }
    if (currentDecision) {
      return { error: "This review has already been resolved.", status: 409 };
    }

    const applied = await applySourceDecision(tx, sourceId, row, tournament, decision);
    if (applied.error) return applied;

    const action = decision === "allow" ? "people_review_allow" : "people_review_exclude";
    const auditRows = await tx.unsafe(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'tournament_entry', $3, $4::jsonb)
       RETURNING created_at`,
      [user.id, action, sourceId, { site_id: site.id, status: applied.row.source_status }],
    );
    return {
      row: {
        ...applied.row,
        review_action: action,
        review_resolved_at: auditRows?.[0]?.created_at || null,
      },
      replayed: false,
    };
  });

  if (result.error) return privateBad(result.error, result.status);
  return privateOk({
    replayed: result.replayed,
    review: reviewSummary(result.row),
  });
}
