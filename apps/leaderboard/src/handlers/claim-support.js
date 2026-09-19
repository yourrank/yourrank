// Claim support conversations: a creator <-> viewer thread attached to one
// reward claim. This is not YourRank support (handlers/contact.js,
// support_messages, SUPPORT_EMAIL are never involved).
//
// Authorization is derived server-side from the claim, never from client ids:
// a viewer reaches a request only through a claim they own (loadViewerClaim);
// a creator only through a claim of a site they may manage claims for
// (creatorAccess + loadCreatorClaim). Support request ids are never accepted
// from the client.
import { exec, one, query, withTransaction } from "@yourrank/shared/db";
import { rateLimit } from "@yourrank/shared/ratelimit";
import { requireUser, bad, json, readJson } from "../auth.js";
import { getByUser, getBoardById } from "../site.js";
import { requireSiteCapability } from "../site-authorization.js";
import { requireViewer } from "./viewer-auth.js";
import {
  claimIdFromRequest,
  claimSummary,
  creatorAccess,
  loadCreatorClaim,
  loadViewerClaim,
  privateResponse,
  sourceIdFromClaimId,
  viewerClaimSummary,
} from "./claims.js";

export const CLAIM_SUPPORT_MESSAGE_MAX = 2000;
export const CLAIM_SUPPORT_ISSUES = Object.freeze({
  reward_not_received: "Reward not received",
  wrong_or_invalid_reward: "Wrong / invalid reward",
  taking_too_long: "Taking too long",
  other: "Other",
});
const PRIVATE_CACHE = "private, no-store, no-cache, must-revalidate";
const MESSAGE_LIMIT = 200;

const supportDefaults = {
  exec,
  one,
  query,
  withTransaction,
  rateLimit,
  requireUser,
  requireViewer,
  getByUser,
  getBoardById,
  requireSiteCapability,
};

const privateOk = (data, status = 200) => json({ ok: true, ...data }, status, { "cache-control": PRIVATE_CACHE });
const privateBad = (message, status = 400) => bad(message, status, { "cache-control": PRIVATE_CACHE });

function readMessage(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Message is required." };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return { error: "Message is required." };
  if (message.length > CLAIM_SUPPORT_MESSAGE_MAX) {
    return { error: `Message must be at most ${CLAIM_SUPPORT_MESSAGE_MAX} characters.` };
  }
  return { message };
}

function readIssueType(body) {
  const value = body && typeof body === "object" && !Array.isArray(body) && typeof body.issueType === "string"
    ? body.issueType.trim().toLowerCase()
    : "";
  return Object.hasOwn(CLAIM_SUPPORT_ISSUES, value) ? value : "";
}

const REQUEST_SELECT = `
  SELECT q.id, q.claim_id, q.viewer_id, q.issue_type, q.status, q.created_at, q.resolved_at
    FROM claim_support_requests q
   WHERE q.claim_id = $1
   ORDER BY CASE WHEN q.status = 'open' THEN 0 ELSE 1 END, q.created_at DESC
   LIMIT 1`;

// Sender names are resolved through the claim itself (the viewer who owns it,
// the site that owns it) so no per-message identity lookup is needed.
const MESSAGE_SELECT = `
  SELECT m.id, m.sender_type, m.sender_id, m.message, m.created_at
    FROM claim_support_messages m
   WHERE m.support_request_id = $1
   ORDER BY m.created_at ASC, m.id ASC
   LIMIT ${MESSAGE_LIMIT}`;

function supportView(requestRow, messageRows, claimRow) {
  if (!requestRow) return null;
  const status = requestRow.status === "resolved" ? "resolved" : "open";
  return {
    id: requestRow.id,
    claimId: `redemption:${requestRow.claim_id}`,
    issueType: requestRow.issue_type,
    issueLabel: CLAIM_SUPPORT_ISSUES[requestRow.issue_type] || "Other",
    status,
    statusLabel: status === "resolved" ? "Resolved" : "Open",
    canReply: status === "open",
    createdAt: requestRow.created_at,
    resolvedAt: requestRow.resolved_at || null,
    messages: (messageRows || []).map((row) => ({
      id: row.id,
      senderType: row.sender_type === "creator" ? "creator" : "viewer",
      senderName: row.sender_type === "creator"
        ? claimRow.site_name || claimRow.site_slug || "Creator"
        : claimRow.display_name || "Member",
      message: row.message,
      createdAt: row.created_at,
    })),
  };
}

async function loadSupport(sourceId, claimRow, deps) {
  const requestRow = await deps.one(REQUEST_SELECT, [sourceId]);
  if (!requestRow) return null;
  const messages = await deps.query(MESSAGE_SELECT, [requestRow.id]);
  return supportView(requestRow, messages, claimRow);
}

async function viewerClaimAccess(request, env, deps, bucket, limit) {
  const { viewer, res } = await deps.requireViewer(request, env);
  if (res) return { res: privateResponse(res) };
  if (!(await deps.rateLimit(env, `viewer:claim-support:${bucket}:${viewer.id}`, limit, 60)).ok) {
    return { res: privateBad("Too many requests.", 429) };
  }
  const sourceId = sourceIdFromClaimId(claimIdFromRequest(request));
  if (!sourceId) return { res: privateBad("Claim not found.", 404) };
  const row = await loadViewerClaim(viewer.id, sourceId, deps);
  if (!row) return { res: privateBad("Claim not found.", 404) };
  return { viewer, sourceId, row, res: null };
}

async function creatorClaimAccess(request, env, deps, bucket, limit) {
  const access = await creatorAccess(request, env, deps);
  if (access.res) return access;
  const { user, site } = access;
  if (!(await deps.rateLimit(env, `claims:support:${bucket}:${user.id}:${site.id}`, limit, 60)).ok) {
    return { res: privateBad("Too many requests.", 429) };
  }
  const sourceId = sourceIdFromClaimId(claimIdFromRequest(request));
  if (!sourceId) return { res: privateBad("Claim not found.", 404) };
  const row = await loadCreatorClaim(site.id, sourceId, deps);
  if (!row) return { res: privateBad("Claim not found.", 404) };
  return { user, site, sourceId, row, res: null };
}

// Appends a message to the open request of this claim, inside a transaction so
// a concurrent "Mark resolved" cannot slip a reply into a resolved thread.
async function appendMessage(deps, { sourceId, senderType, senderId, message }) {
  return deps.withTransaction(async (tx) => {
    const open = await tx.one(
      `SELECT id FROM claim_support_requests WHERE claim_id=$1 AND status='open' FOR UPDATE`,
      [sourceId],
    );
    if (!open) return { error: "This support request is resolved. New replies are disabled.", status: 409 };
    await tx.unsafe(
      `INSERT INTO claim_support_messages (support_request_id, sender_type, sender_id, message) VALUES ($1, $2, $3, $4)`,
      [open.id, senderType, senderId, message],
    );
    return { ok: true };
  });
}

// --- Viewer -----------------------------------------------------------------

export async function handleViewerClaimSupport(request, env, injected = {}) {
  const deps = { ...supportDefaults, ...injected };
  const access = await viewerClaimAccess(request, env, deps, "read", 120);
  if (access.res) return access.res;
  const claim = viewerClaimSummary(access.row);
  return privateOk({
    claim,
    creator: { name: access.row.site_name || access.row.site_slug || "the creator" },
    support: await loadSupport(access.sourceId, access.row, deps),
    issueTypes: Object.entries(CLAIM_SUPPORT_ISSUES).map(([value, label]) => ({ value, label })),
  });
}

export async function handleViewerClaimSupportCreate(request, env, injected = {}) {
  const deps = { ...supportDefaults, ...injected };
  const access = await viewerClaimAccess(request, env, deps, "create", 10);
  if (access.res) return access.res;
  const { viewer, sourceId, row } = access;
  if (row.viewer_id && row.viewer_id !== viewer.id) return privateBad("Claim not found.", 404);

  const body = await readJson(request);
  const issueType = readIssueType(body);
  if (!issueType) return privateBad("Choose what the issue is.");
  const parsed = readMessage(body);
  if (parsed.error) return privateBad(parsed.error);

  // One open request per claim: lock the claim row so two concurrent opens
  // serialize and the second sees the first one's request.
  const result = await deps.withTransaction(async (tx) => {
    const locked = await tx.one(`SELECT id FROM redemptions WHERE id=$1 FOR UPDATE`, [sourceId]);
    if (!locked) return { error: "Claim not found.", status: 404 };
    const existing = await tx.one(
      `SELECT id FROM claim_support_requests WHERE claim_id=$1 AND status='open'`,
      [sourceId],
    );
    if (existing) return { existing: true };
    const created = await tx.one(
      `INSERT INTO claim_support_requests (claim_id, viewer_id, issue_type) VALUES ($1, $2, $3) RETURNING id`,
      [sourceId, viewer.id, issueType],
    );
    await tx.unsafe(
      `INSERT INTO claim_support_messages (support_request_id, sender_type, sender_id, message) VALUES ($1, 'viewer', $2, $3)`,
      [created.id, viewer.id, parsed.message],
    );
    return { created: true };
  });
  if (result.error) return privateBad(result.error, result.status);

  const support = await loadSupport(sourceId, row, deps);
  return privateOk({ created: Boolean(result.created), existing: Boolean(result.existing), claim: viewerClaimSummary(row), support }, result.existing ? 409 : 201);
}

export async function handleViewerClaimSupportReply(request, env, injected = {}) {
  const deps = { ...supportDefaults, ...injected };
  const access = await viewerClaimAccess(request, env, deps, "reply", 30);
  if (access.res) return access.res;
  const { viewer, sourceId, row } = access;
  if (row.viewer_id && row.viewer_id !== viewer.id) return privateBad("Claim not found.", 404);

  const parsed = readMessage(await readJson(request));
  if (parsed.error) return privateBad(parsed.error);
  const result = await appendMessage(deps, { sourceId, senderType: "viewer", senderId: viewer.id, message: parsed.message });
  if (result.error) return privateBad(result.error, result.status);
  return privateOk({ support: await loadSupport(sourceId, row, deps) });
}

// --- Creator ----------------------------------------------------------------

export async function handleCreatorClaimSupport(request, env, injected = {}) {
  const deps = { ...supportDefaults, ...injected };
  const access = await creatorClaimAccess(request, env, deps, "read", 120);
  if (access.res) return access.res;
  return privateOk({
    claim: claimSummary(access.row),
    support: await loadSupport(access.sourceId, access.row, deps),
  });
}

export async function handleCreatorClaimSupportReply(request, env, injected = {}) {
  const deps = { ...supportDefaults, ...injected };
  const access = await creatorClaimAccess(request, env, deps, "reply", 30);
  if (access.res) return access.res;
  const { user, sourceId, row } = access;

  const parsed = readMessage(await readJson(request));
  if (parsed.error) return privateBad(parsed.error);
  const result = await appendMessage(deps, { sourceId, senderType: "creator", senderId: user.id, message: parsed.message });
  if (result.error) return privateBad(result.error, result.status);
  return privateOk({ support: await loadSupport(sourceId, row, deps) });
}

export async function handleCreatorClaimSupportResolve(request, env, injected = {}) {
  const deps = { ...supportDefaults, ...injected };
  const access = await creatorClaimAccess(request, env, deps, "resolve", 30);
  if (access.res) return access.res;
  const { sourceId, row } = access;

  const updatedRows = await deps.exec(
    `UPDATE claim_support_requests SET status='resolved', resolved_at=now()
      WHERE claim_id=$1 AND status='open'
      RETURNING id`,
    [sourceId],
  );
  const updated = (updatedRows || []).length > 0;
  const support = await loadSupport(sourceId, row, deps);
  if (!updated && !support) return privateBad("No support request for this claim.", 404);
  return privateOk({ resolved: updated, support });
}
