// Transactional viewer notifications: in-app records written where a claim or
// claim-support transition actually happens (transitionRedemptionClaimStatus,
// claim-support reply/resolve). Content is derived from the claim row on the
// server; clients and creators never supply title, body, href or ids.
//
// Not a broadcast or campaign system: there is no creator-facing write path.
import { exec, one, query } from "@yourrank/shared/db";
import { rateLimit } from "@yourrank/shared/ratelimit";
import { bad, json } from "../auth.js";
import { routeContext } from "../middleware/handler.js";
import { requireViewer } from "./viewer-auth.js";

export const VIEWER_NOTIFICATION_TYPES = Object.freeze([
  "claim_completed",
  "claim_cancelled",
  "claim_support_reply",
  "claim_support_resolved",
]);
export const VIEWER_NOTIFICATION_PANEL_LIMIT = 10;
const PRIVATE_CACHE = "private, no-store, no-cache, must-revalidate";
const BODY_PREVIEW_MAX = 140;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notificationDefaults = { exec, one, query, rateLimit, requireViewer };

const privateOk = (data) => json({ ok: true, ...data }, 200, { "cache-control": PRIVATE_CACHE });
const privateBad = (message, status = 400) => bad(message, status, { "cache-control": PRIVATE_CACHE });

function preview(text) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > BODY_PREVIEW_MAX ? `${flat.slice(0, BODY_PREVIEW_MAX - 1)}…` : flat;
}

// The viewer's My Activity page for the claim's community, opened on the
// Claims tab with the claim highlighted (`claim`) and, for support events, the
// conversation dialog opened (`support`). Always a same-origin path.
export function viewerClaimHref({ siteSlug, claimId, support = false }) {
  const params = new URLSearchParams({ claim: `redemption:${claimId}` });
  if (support) params.set("support", "1");
  return `/${encodeURIComponent(siteSlug)}/activity?${params.toString()}#membership-claims`;
}

// Claim rows carry the joined site/viewer/item columns of CLAIM_SELECT
// (claims.js): viewer_id, site_id, site_slug, site_name, item_name, source_id.
export function claimNotificationSpec(type, claim, extra = {}) {
  const reward = claim.item_name || "Reward";
  const creator = claim.site_name || claim.site_slug || "The creator";
  const base = {
    type,
    viewerId: claim.viewer_id,
    siteId: claim.site_id,
    claimId: claim.source_id,
    supportRequestId: extra.supportRequestId || null,
  };
  switch (type) {
    case "claim_completed":
      return {
        ...base,
        dedupeKey: `claim_completed:${claim.source_id}`,
        title: `Your ${reward} claim was completed`,
        body: `${creator} marked your claim as completed.`,
        href: viewerClaimHref({ siteSlug: claim.site_slug, claimId: claim.source_id }),
      };
    case "claim_cancelled":
      return {
        ...base,
        dedupeKey: `claim_cancelled:${claim.source_id}`,
        title: `Your ${reward} claim was cancelled`,
        body: `${creator} cancelled this claim. Your credits were refunded.`,
        href: viewerClaimHref({ siteSlug: claim.site_slug, claimId: claim.source_id }),
      };
    case "claim_support_reply":
      return {
        ...base,
        dedupeKey: `claim_support_reply:${extra.messageId}`,
        title: `${creator} replied to your ${reward} claim`,
        body: preview(extra.message),
        href: viewerClaimHref({ siteSlug: claim.site_slug, claimId: claim.source_id, support: true }),
      };
    case "claim_support_resolved":
      return {
        ...base,
        dedupeKey: `claim_support_resolved:${extra.supportRequestId}`,
        title: `Your ${reward} support request was resolved`,
        body: `${creator} marked the conversation as resolved.`,
        href: viewerClaimHref({ siteSlug: claim.site_slug, claimId: claim.source_id, support: true }),
      };
    default:
      return null;
  }
}

const INSERT_SQL = `
  INSERT INTO viewer_notifications (viewer_id, type, site_id, claim_id, support_request_id, dedupe_key, title, body, href)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id`;

function insertParams(spec) {
  return [
    spec.viewerId,
    spec.type,
    spec.siteId,
    spec.claimId || null,
    spec.supportRequestId || null,
    spec.dedupeKey,
    spec.title,
    spec.body || "",
    spec.href,
  ];
}

// Insert inside the caller's transaction behind a savepoint: a duplicate is a
// silent no-op (retry of the same action), and any other failure is rolled
// back to the savepoint so the domain transition still commits. Falls back to
// a plain statement for transaction fakes without savepoint support.
export async function insertViewerNotificationTx(tx, spec) {
  if (!spec || !spec.viewerId || !spec.siteId || !spec.dedupeKey) return { inserted: false };
  const insert = (t) => t.unsafe(INSERT_SQL, insertParams(spec));
  try {
    const rows = typeof tx.savepoint === "function" ? await tx.savepoint(insert) : await insert(tx);
    return { inserted: rows.length > 0, id: rows[0]?.id || null };
  } catch (err) {
    console.warn("[viewer-notifications] insert skipped", spec.type, err?.message || err);
    return { inserted: false };
  }
}

// --- Viewer API -------------------------------------------------------------

function view(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body || "",
    href: row.href,
    siteId: row.site_id,
    claimId: row.claim_id ? `redemption:${row.claim_id}` : null,
    supportRequestId: row.support_request_id || null,
    read: !!row.read_at,
    readAt: row.read_at || null,
    createdAt: row.created_at,
  };
}

async function viewerAccess(request, env, deps, bucket, limit) {
  const { viewer, res } = await deps.requireViewer(request, env);
  if (res) {
    const headers = new Headers(res.headers);
    headers.set("cache-control", PRIVATE_CACHE);
    return { res: new Response(res.body, { status: res.status, headers }) };
  }
  if (!(await deps.rateLimit(env, `viewer:notifications:${bucket}:${viewer.id}`, limit, 60)).ok) {
    return { res: privateBad("Too many requests.", 429) };
  }
  return { viewer, res: null };
}

function notificationIdFromRequest(request) {
  const contextId = routeContext(request).slug;
  if (contextId) return String(contextId);
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const index = parts.indexOf("notifications");
  return index >= 0 && parts[index + 1] ? parts[index + 1] : "";
}

async function unreadCount(viewerId, deps) {
  const row = await deps.one(
    `SELECT count(*)::int AS unread FROM viewer_notifications WHERE viewer_id=$1 AND read_at IS NULL`,
    [viewerId],
  );
  return Number(row?.unread) || 0;
}

export async function handleViewerNotifications(request, env, injected = {}) {
  const deps = { ...notificationDefaults, ...injected };
  const access = await viewerAccess(request, env, deps, "read", 120);
  if (access.res) return access.res;
  const rows = await deps.query(
    `SELECT id, type, site_id, claim_id, support_request_id, title, body, href, read_at, created_at
       FROM viewer_notifications
      WHERE viewer_id=$1
      ORDER BY (read_at IS NULL) DESC, created_at DESC, id DESC
      LIMIT ${VIEWER_NOTIFICATION_PANEL_LIMIT}`,
    [access.viewer.id],
  );
  return privateOk({
    notifications: (rows || []).map(view),
    unreadCount: await unreadCount(access.viewer.id, deps),
  });
}

export async function handleViewerNotificationRead(request, env, injected = {}) {
  const deps = { ...notificationDefaults, ...injected };
  const access = await viewerAccess(request, env, deps, "write", 60);
  if (access.res) return access.res;
  const id = notificationIdFromRequest(request);
  if (!UUID.test(id)) return privateBad("Notification not found.", 404);
  const row = await deps.one(
    `UPDATE viewer_notifications SET read_at = COALESCE(read_at, now())
      WHERE id=$1 AND viewer_id=$2
      RETURNING id, type, site_id, claim_id, support_request_id, title, body, href, read_at, created_at`,
    [id, access.viewer.id],
  );
  if (!row) return privateBad("Notification not found.", 404);
  return privateOk({ notification: view(row), unreadCount: await unreadCount(access.viewer.id, deps) });
}

export async function handleViewerNotificationsReadAll(request, env, injected = {}) {
  const deps = { ...notificationDefaults, ...injected };
  const access = await viewerAccess(request, env, deps, "write", 60);
  if (access.res) return access.res;
  const rows = await deps.exec(
    `UPDATE viewer_notifications SET read_at = now() WHERE viewer_id=$1 AND read_at IS NULL RETURNING id`,
    [access.viewer.id],
  );
  return privateOk({ updated: (rows || []).length, unreadCount: 0 });
}
