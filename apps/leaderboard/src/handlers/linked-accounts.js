// People → Linked accounts API (Phase 2).
//
// Lists likely same-person account groups detected for the site, and applies
// the streamer's decisions (watch / restrict / unrestrict / dismiss).
// Detection never restricts on its own, and every decision writes audit_log.
import { one, query, withTransaction } from "@yourrank/shared/db";
import { linkedViewerIdentities, viewerIdentitiesSql } from "@yourrank/shared/viewer-identity";
import { rateLimit } from "@yourrank/shared/ratelimit";
import { requireUser, bad, json, readJson } from "../auth.js";
import { getByUser, getBoardById } from "../site.js";
import { requireSiteCapability } from "../site-authorization.js";

const PRIVATE_CACHE = "no-store, no-cache, must-revalidate";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LINK_LIMIT = 200;

const handlerDefaults = {
  one,
  query,
  withTransaction,
  rateLimit,
  requireUser,
  getByUser,
  getBoardById,
  requireSiteCapability,
};

const privateResponse = (response) => {
  if (!response) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", PRIVATE_CACHE);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

const privateOk = (data) => json({ ok: true, ...data }, 200, { "cache-control": PRIVATE_CACHE });
const privateBad = (message, status = 400) => bad(message, status, { "cache-control": PRIVATE_CACHE });

const REASON_LABELS = {
  same_device: "Same device",
  same_identity: "Same Kick/Telegram account",
  same_ip_24h: "Same IP",
  same_time_claims: null, // needs the count
};
const REASON_ORDER = ["same_device", "same_identity", "same_ip_24h", "same_time_claims"];

function reasonEntries(codes, sameTimeClaims) {
  const set = new Set(codes || []);
  return REASON_ORDER.filter((code) => set.has(code)).map((code) => ({
    code,
    label: code === "same_time_claims"
      ? `${sameTimeClaims || 1} same-time claim${sameTimeClaims === 1 ? "" : "s"}`
      : REASON_LABELS[code],
  }));
}

const STATUS_ORDER = ["restricted", "watching", "pending"];

async function linkedAccess(request, env, deps) {
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
  return { user, site, res: null };
}

function statusFilter(url) {
  const value = String(url.searchParams.get("status") || "active").toLowerCase();
  return ["active", "dismissed"].includes(value) ? value : "";
}

const LINK_SELECT = `
  SELECT al.id, al.viewer_a, al.viewer_b, al.confidence, al.reasons,
         al.same_time_claims, al.status, al.created_at, al.last_detected_at,
         ${viewerIdentitiesSql("va")} AS a_identities,
         ${viewerIdentitiesSql("vb")} AS b_identities
    FROM account_links al
    LEFT JOIN viewers va ON va.id = al.viewer_a
    LEFT JOIN viewers vb ON vb.id = al.viewer_b`;

async function loadLinks(siteId, filter, deps) {
  const statusClause = filter === "dismissed"
    ? "al.status = 'dismissed'"
    : "al.status IN ('pending','watching','restricted')";
  return deps.query(
    `${LINK_SELECT}
      WHERE al.site_id = $1 AND ${statusClause}
      ORDER BY al.confidence DESC, al.created_at ASC
      LIMIT ${LINK_LIMIT * 3}`,
    [siteId],
  );
}

function viewerDisplay(row, side, identities) {
  const username = linkedViewerIdentities({ identities }).find((identity) => identity.username)?.username;
  const viewerId = row[`viewer_${side}`];
  return {
    viewerId,
    displayName: username || `Viewer ${String(viewerId).slice(0, 8)}`,
    avatarUrl: linkedViewerIdentities({ identities }).find((identity) => identity.avatarUrl)?.avatarUrl || null,
  };
}

// Connected components over the filtered links (union-find).
function groupLinks(rows) {
  const parent = new Map();
  const find = (v) => {
    let root = v;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = v;
    while (parent.get(cur) !== cur) { const next = parent.get(cur); parent.set(cur, root); cur = next; }
    return root;
  };
  const union = (a, b) => parent.set(find(a), find(b));
  for (const row of rows) {
    for (const side of [row.viewer_a, row.viewer_b]) {
      if (!parent.has(side)) parent.set(side, side);
    }
    union(row.viewer_a, row.viewer_b);
  }
  const groups = new Map();
  for (const row of rows) {
    const root = find(row.viewer_a);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(row);
  }
  return [...groups.values()].map((linkRows) => {
    const ordered = [...linkRows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const viewers = new Map();
    for (const row of linkRows) {
      if (!viewers.has(row.viewer_a)) viewers.set(row.viewer_a, viewerDisplay(row, "a", row.a_identities));
      if (!viewers.has(row.viewer_b)) viewers.set(row.viewer_b, viewerDisplay(row, "b", row.b_identities));
    }
    const status = STATUS_ORDER.find((candidate) => linkRows.some((row) => row.status === candidate)) || "pending";
    const reasons = reasonEntries(
      [...new Set(linkRows.flatMap((row) => row.reasons || []))],
      Math.max(0, ...linkRows.map((row) => Number(row.same_time_claims) || 0)),
    );
    return {
      id: ordered[0].id,
      linkIds: linkRows.map((row) => row.id),
      accounts: [...viewers.values()],
      confidence: Math.max(0, ...linkRows.map((row) => Number(row.confidence) || 0)),
      reasons,
      sameTimeClaims: Math.max(0, ...linkRows.map((row) => Number(row.same_time_claims) || 0)),
      summary: reasons.map((reason) => reason.label).join(" · "),
      status: linkRows.every((row) => row.status === "dismissed") ? "dismissed" : status,
      firstDetectedAt: linkRows.map((row) => row.created_at).sort()[0] || null,
      lastDetectedAt: linkRows.map((row) => row.last_detected_at).sort().at(-1) || null,
    };
  });
}

async function linkedPayload(siteId, filter, deps) {
  const rows = await loadLinks(siteId, filter, deps);
  const counts = await deps.one(
    `SELECT
       count(*) FILTER (WHERE status='pending')::integer AS pending,
       count(*) FILTER (WHERE status='watching')::integer AS watching,
       count(*) FILTER (WHERE status='restricted')::integer AS restricted,
       count(*) FILTER (WHERE status='dismissed')::integer AS dismissed
     FROM account_links WHERE site_id=$1`,
    [siteId],
  );
  return {
    groups: groupLinks(rows || []),
    counts: {
      pending: Number(counts?.pending) || 0,
      watching: Number(counts?.watching) || 0,
      restricted: Number(counts?.restricted) || 0,
      dismissed: Number(counts?.dismissed) || 0,
    },
  };
}

export async function handleLinkedAccounts(request, env, injected = {}) {
  const deps = { ...handlerDefaults, ...injected };
  const access = await linkedAccess(request, env, deps);
  if (access.res) return access.res;
  const { user, site } = access;
  if (!(await deps.rateLimit(env, `people:linked:${user.id}:${site.id}`, 60, 60)).ok) {
    return privateBad("Too many requests.", 429);
  }
  const filter = statusFilter(new URL(request.url));
  if (!filter) return privateBad("Unsupported status filter.");
  return privateOk(await linkedPayload(site.id, filter, deps));
}

const DECISION_STATUS = {
  dismiss: "dismissed",
  watch: "watching",
  restrict: "restricted",
  unrestrict: "watching",
};
const DECISION_AUDIT = {
  dismiss: "account_link_dismissed",
  watch: "account_link_watched",
  restrict: "account_link_restricted",
  unrestrict: "account_link_unrestricted",
};

export async function handleLinkedAccountsDecision(request, env, injected = {}) {
  const deps = { ...handlerDefaults, ...injected };
  const access = await linkedAccess(request, env, deps);
  if (access.res) return access.res;
  const { user, site } = access;
  if (!(await deps.rateLimit(env, `people:linked-decision:${user.id}:${site.id}`, 30, 60)).ok) {
    return privateBad("Too many requests.", 429);
  }
  const body = await readJson(request);
  const linkIds = Array.isArray(body?.linkIds)
    ? body.linkIds.filter((id) => typeof id === "string" && UUID_RE.test(id))
    : null;
  if (!linkIds || linkIds.length === 0 || linkIds.length > LINK_LIMIT || new Set(linkIds).size !== linkIds.length) {
    return privateBad("linkIds must be 1-200 unique link ids.");
  }
  const action = String(body?.action || "");
  if (!DECISION_STATUS[action]) return privateBad("Unsupported action.");

  const result = await deps.withTransaction(async (tx) => {
    const locked = await tx.query(
      `SELECT id, viewer_a, viewer_b, status FROM account_links
        WHERE id = ANY($1::uuid[]) AND site_id = $2 FOR UPDATE`,
      [linkIds, site.id],
    );
    if ((locked || []).length !== linkIds.length) {
      return { error: "Linked accounts not found.", status: 404 };
    }
    const nextStatus = DECISION_STATUS[action];
    for (const link of locked) {
      await tx.query(
        `UPDATE account_links
            SET status=$1, decided_at=now(), decided_by=$2, updated_at=now()
          WHERE id=$3`,
        [nextStatus, user.id, link.id],
      );
      await tx.unsafe(
        `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'account_link', $3, $4::jsonb)`,
        [
          user.id, DECISION_AUDIT[action], String(link.id),
          { siteId: site.id, viewerA: link.viewer_a, viewerB: link.viewer_b, previousStatus: link.status },
        ],
      );
    }
    return { ok: true };
  });
  if (result.error) return privateBad(result.error, result.status);
  const filter = statusFilter(new URL(request.url)) || "active";
  return privateOk(await linkedPayload(site.id, filter, deps));
}
