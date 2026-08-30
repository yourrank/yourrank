// ============================================================================
//  YourRank — SHARED TEAM & MODERATOR MANAGEMENT (TypeScript)
//
//  Role-Based Access Control (RBAC) and team delegation for streamer sites:
//    - V1 roles: 'owner', 'moderator'
//    - Least-privilege capability guards
//    - Secure email & token invitation lifecycle
// ============================================================================

import { one as defaultOne, query as defaultQuery, exec as defaultExec, withTransaction as defaultWithTransaction } from "./db.js";
import type { Tx } from "./db.js";
import { hashToken } from "./crypto.js";
import { effectivePlan, OPERATOR_SEAT_LIMITS } from "./plans.js";

export type SiteRole = "owner" | "moderator";

export type SiteCapability =
  | "canRoleManageBoard"
  | "canRoleManageCredits"
  | "canRoleManageBot"
  | "canRoleViewMembers"
  | "canRoleManageMembers"
  | "canRoleManageActivities"
  | "canRoleManageReviews"
  | "canRoleManageClaims"
  | "canRoleViewRewards"
  | "canRoleManageRewards"
  | "canRoleAdjustCredits"
  | "canRoleViewInsights"
  | "canRoleManageSiteSettings"
  | "canRoleManageConnections"
  | "canRoleManageTeam"
  | "canRoleManageBilling"
  | "canRoleManageAccountSecurity";

const SITE_ROLE_CAPABILITIES: Record<SiteRole, ReadonlySet<SiteCapability>> = {
  owner: new Set<SiteCapability>([
    "canRoleManageBoard",
    "canRoleManageCredits",
    "canRoleManageBot",
    "canRoleViewMembers",
    "canRoleManageMembers",
    "canRoleManageActivities",
    "canRoleManageReviews",
    "canRoleManageClaims",
    "canRoleViewRewards",
    "canRoleManageRewards",
    "canRoleAdjustCredits",
    "canRoleViewInsights",
    "canRoleManageSiteSettings",
    "canRoleManageConnections",
    "canRoleManageTeam",
    "canRoleManageBilling",
    "canRoleManageAccountSecurity",
  ]),
  moderator: new Set<SiteCapability>([
    "canRoleManageBoard",
    "canRoleViewMembers",
    "canRoleManageMembers",
    "canRoleManageActivities",
    "canRoleManageReviews",
    "canRoleManageClaims",
    "canRoleViewRewards",
    "canRoleManageRewards",
    "canRoleViewInsights",
  ]),
};

export interface SiteMemberInfo {
  id: string;
  siteId: string;
  userId: string;
  role: SiteRole;
  email: string;
  displayName: string | null;
  slug: string;
  createdAt: string;
  invitedBy?: string | null;
}

export interface SiteInviteInfo {
  id: string;
  siteId: string;
  email: string;
  role: SiteRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
  invitedBy: string;
  siteName?: string;
  siteSlug?: string;
  ownerName?: string;
}

export interface DbOps {
  one?: typeof defaultOne;
  query?: typeof defaultQuery;
  exec?: typeof defaultExec;
  withTransaction?: typeof defaultWithTransaction;
}

export interface OperatorSeatUsage {
  plan: "free" | "pro" | "team";
  used: number;
  limit: number;
}

function transactionRunner(ops: DbOps) {
  if (ops.withTransaction) return ops.withTransaction;
  if (ops.one || ops.exec || ops.query) {
    return async <R>(fn: (tx: Tx) => Promise<R>): Promise<R> => fn({
      one: ops.one ?? defaultOne,
      query: ops.query ?? defaultQuery,
      unsafe: ops.exec ?? defaultExec,
    });
  }
  return defaultWithTransaction;
}

async function writeTeamAudit(
  tx: Tx,
  entry: {
    actorId: string;
    action: string;
    entityType: "site_invite" | "site_member";
    entityId: string;
    siteId: string;
    role?: SiteRole;
    targetUserId?: string;
    status?: string;
  },
): Promise<void> {
  await tx.unsafe(
    `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      entry.actorId,
      entry.action,
      entry.entityType,
      entry.entityId,
      {
        site_id: entry.siteId,
        ...(entry.role ? { role: entry.role } : {}),
        ...(entry.targetUserId ? { target_user_id: entry.targetUserId } : {}),
        ...(entry.status ? { status: entry.status } : {}),
      },
    ],
  );
}

/** The one server-owned V1 role-to-capability decision point. */
export function hasSiteCapability(
  role: SiteRole | null | undefined,
  capability: SiteCapability,
): boolean {
  if (role !== "owner" && role !== "moderator") return false;
  return SITE_ROLE_CAPABILITIES[role].has(capability);
}

/** Compatibility boundary for existing leaderboard operations. */
export function canRoleManageBoard(role: SiteRole | null | undefined): boolean {
  return hasSiteCapability(role, "canRoleManageBoard");
}

/** Legacy broad Credits capability. New safe callers use narrower capabilities. */
export function canRoleManageCredits(role: SiteRole | null | undefined): boolean {
  return hasSiteCapability(role, "canRoleManageCredits");
}

export function canRoleManageBot(role: SiteRole | null | undefined): boolean {
  return hasSiteCapability(role, "canRoleManageBot");
}

export const canRoleViewMembers = (role: SiteRole | null | undefined): boolean => hasSiteCapability(role, "canRoleViewMembers");
export const canRoleManageMembers = (role: SiteRole | null | undefined): boolean => hasSiteCapability(role, "canRoleManageMembers");
export const canRoleManageActivities = (role: SiteRole | null | undefined): boolean => hasSiteCapability(role, "canRoleManageActivities");
export const canRoleManageReviews = (role: SiteRole | null | undefined): boolean => hasSiteCapability(role, "canRoleManageReviews");
export const canRoleManageClaims = (role: SiteRole | null | undefined): boolean => hasSiteCapability(role, "canRoleManageClaims");
export const canRoleViewRewards = (role: SiteRole | null | undefined): boolean => hasSiteCapability(role, "canRoleViewRewards");
export const canRoleManageRewards = (role: SiteRole | null | undefined): boolean => hasSiteCapability(role, "canRoleManageRewards");
export const canRoleAdjustCredits = (role: SiteRole | null | undefined): boolean => hasSiteCapability(role, "canRoleAdjustCredits");
export const canRoleViewInsights = (role: SiteRole | null | undefined): boolean => hasSiteCapability(role, "canRoleViewInsights");
export const canRoleManageSiteSettings = (role: SiteRole | null | undefined): boolean => hasSiteCapability(role, "canRoleManageSiteSettings");
export const canRoleManageConnections = (role: SiteRole | null | undefined): boolean => hasSiteCapability(role, "canRoleManageConnections");

export function canRoleManageTeam(role: SiteRole | null | undefined): boolean {
  return hasSiteCapability(role, "canRoleManageTeam");
}

export function canRoleManageBilling(role: SiteRole | null | undefined): boolean {
  return hasSiteCapability(role, "canRoleManageBilling");
}

export const canRoleManageAccountSecurity = (role: SiteRole | null | undefined): boolean => hasSiteCapability(role, "canRoleManageAccountSecurity");

/**
 * Get the effective role for a user on a given site.
 * Returns 'owner', 'moderator', or null if not affiliated or Team is inactive.
 */
export async function getSiteRole(
  siteId: string,
  userId: string,
  { one = defaultOne }: DbOps = {}
): Promise<SiteRole | null> {
  if (!siteId || !userId) return null;

  // 1. Check if user is the direct site owner
  const site = await one<{ user_id: string }>(
    "SELECT user_id FROM sites WHERE id=$1",
    [siteId]
  );
  if (!site) return null;
  if (site.user_id === userId) return "owner";

  const owner = await one<{ plan: string; plan_expires_at: string | null; status: string }>(
    "SELECT plan, plan_expires_at, status FROM users WHERE id=$1",
    [site.user_id],
  );
  if (effectivePlan(owner) !== "team") return null;

  // 2. Check if user is an active member
  const member = await one<{ role: SiteRole }>(
    "SELECT role FROM site_members WHERE site_id=$1 AND user_id=$2",
    [siteId, userId]
  );
  if (member?.role === "moderator") return "moderator";

  return null;
}

/**
 * List all active members for a site (including the owner).
 */
export async function listSiteMembers(
  siteId: string,
  { one = defaultOne, query = defaultQuery }: DbOps = {}
): Promise<SiteMemberInfo[]> {
  const site = await one<{ user_id: string }>("SELECT user_id FROM sites WHERE id=$1", [siteId]);
  if (!site) return [];

  const owner = await one<{ id: string; email: string; display_name: string | null; slug: string; created_at: string }>(
    `SELECT u.id, u.email, u.display_name,
            COALESCE(sa.slug, sf.slug, '') AS slug,
            u.created_at
       FROM users u
       LEFT JOIN sites sa ON sa.id = u.active_site_id AND sa.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT s.slug FROM sites s
          WHERE s.user_id = u.id
          ORDER BY s.board_order NULLS LAST, s.updated_at ASC, s.slug ASC
          LIMIT 1
       ) sf ON true
      WHERE u.id = $1`,
    [site.user_id]
  );

  const members = await query<{
    id: string;
    site_id: string;
    user_id: string;
    role: SiteRole;
    email: string;
    display_name: string | null;
    slug: string;
    created_at: string;
    invited_by: string | null;
  }>(
    `SELECT sm.id, sm.site_id, sm.user_id, sm.role, sm.created_at, sm.invited_by,
            u.email, u.display_name,
            COALESCE(sa.slug, sf.slug, '') AS slug
       FROM site_members sm
       JOIN users u ON u.id = sm.user_id
       LEFT JOIN sites sa ON sa.id = u.active_site_id AND sa.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT s.slug FROM sites s
          WHERE s.user_id = u.id
          ORDER BY s.board_order NULLS LAST, s.updated_at ASC, s.slug ASC
          LIMIT 1
       ) sf ON true
      WHERE sm.site_id = $1
      ORDER BY sm.created_at ASC`,
    [siteId]
  );

  const result: SiteMemberInfo[] = [];

  if (owner) {
    result.push({
      id: `owner-${owner.id}`,
      siteId,
      userId: owner.id,
      role: "owner",
      email: owner.email,
      displayName: owner.display_name,
      slug: owner.slug,
      createdAt: owner.created_at,
    });
  }

  for (const m of members || []) {
    if (m.role !== "moderator") continue;
    result.push({
      id: m.id,
      siteId: m.site_id,
      userId: m.user_id,
      role: m.role,
      email: m.email,
      displayName: m.display_name,
      slug: m.slug,
      createdAt: m.created_at,
      invitedBy: m.invited_by,
    });
  }

  return result;
}

/**
 * List pending invites for a site.
 */
export async function listSiteInvites(
  siteId: string,
  { query = defaultQuery }: DbOps = {}
): Promise<SiteInviteInfo[]> {
  const rows = await query<{
    id: string;
    site_id: string;
    email: string;
    role: SiteRole;
    status: "pending" | "accepted" | "revoked" | "expired";
    expires_at: string;
    created_at: string;
    invited_by: string;
  }>(
    `SELECT id, site_id, email, role, status, expires_at, created_at, invited_by
       FROM site_invites
      WHERE site_id=$1 AND status='pending' AND expires_at > now()
      ORDER BY created_at DESC`,
    [siteId]
  );

  return (rows || []).filter((r) => r.role === "moderator").map((r) => ({
    id: r.id,
    siteId: r.site_id,
    email: r.email,
    role: r.role,
    status: r.status,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    invitedBy: r.invited_by,
  }));
}

async function countAccountOperatorIdentities(
  ownerId: string,
  one: typeof defaultOne,
): Promise<number> {
  const seats = await one<{ count: number }>(
    `WITH account_sites AS (
       SELECT id FROM sites WHERE user_id=$1
     ), identities AS (
       SELECT 'user:' || $1::text AS identity
       UNION
       SELECT 'user:' || sm.user_id::text
         FROM site_members sm JOIN account_sites a ON a.id=sm.site_id
       UNION
       SELECT COALESCE('user:' || invited.id::text, 'email:' || lower(si.email))
         FROM site_invites si
         JOIN account_sites a ON a.id=si.site_id
         LEFT JOIN users invited ON lower(invited.email)=lower(si.email)
        WHERE si.status='pending' AND si.expires_at > now()
     ) SELECT count(DISTINCT identity)::int AS count FROM identities`,
    [ownerId],
  );
  return Number(seats?.count) || 0;
}

/** Account-pooled seat usage for the selected site owner. Preserved rows remain visible after downgrade. */
export async function getOperatorSeatUsage(
  siteId: string,
  { one = defaultOne }: DbOps = {},
): Promise<OperatorSeatUsage | null> {
  const owner = await one<{
    user_id: string;
    plan: string;
    plan_expires_at: string | null;
    status: string;
  }>(
    `SELECT s.user_id, u.plan, u.plan_expires_at, u.status
       FROM sites s JOIN users u ON u.id=s.user_id
      WHERE s.id=$1`,
    [siteId],
  );
  if (!owner) return null;
  const plan = effectivePlan(owner);
  return {
    plan,
    used: await countAccountOperatorIdentities(owner.user_id, one),
    limit: OPERATOR_SEAT_LIMITS[plan],
  };
}

/**
 * Create a new invitation for a user by email.
 */
export async function createSiteInvite(
  siteId: string,
  inviterId: string,
  email: string,
  role: SiteRole,
  ops: DbOps = {}
): Promise<{ ok: boolean; token?: string; inviteId?: string; error?: string; code?: string }> {
  const one = ops.one ?? defaultOne;
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) {
    return { ok: false, error: "Please provide a valid email address.", code: "invalid_email" };
  }

  if (role !== "moderator") {
    return { ok: false, error: "Role must be Moderator.", code: "invalid_role" };
  }

  const requesterRole = await getSiteRole(siteId, inviterId, { one });
  if (!canRoleManageTeam(requesterRole)) {
    return { ok: false, error: "Only the site owner can invite team members.", code: "forbidden" };
  }

  // Generate a cryptographically random token
  const rawBytes = new Uint8Array(24);
  crypto.getRandomValues(rawBytes);
  const token = Buffer.from(rawBytes).toString("base64url");
  const tokenHash = await hashToken(token);

  return transactionRunner(ops)(async (tx) => {
    const site = await tx.one(
      `SELECT s.user_id, u.plan, u.plan_expires_at, u.status
         FROM sites s JOIN users u ON u.id=s.user_id
        WHERE s.id=$1 FOR UPDATE OF u`,
      [siteId],
    );
    if (!site) return { ok: false, error: "Site not found.", code: "not_found" };
    if (site.user_id !== inviterId) {
      return { ok: false, error: "Only the site owner can invite team members.", code: "forbidden" };
    }
    if (effectivePlan(site) !== "team") {
      return { ok: false, error: "Additional operators require the Team plan.", code: "requires_team" };
    }

    const targetUser = await tx.one("SELECT id FROM users WHERE lower(email)=$1", [cleanEmail]);
    if (targetUser?.id === site.user_id) {
      return { ok: false, error: "The site owner is already on the team.", code: "already_owner" };
    }
    if (targetUser) {
      const existingMember = await tx.one(
        "SELECT id FROM site_members WHERE site_id=$1 AND user_id=$2",
        [siteId, targetUser.id],
      );
      if (existingMember) {
        return { ok: false, error: "This user is already a member of this site.", code: "already_member" };
      }
    }

    const existingInvite = await tx.one(
      "SELECT id FROM site_invites WHERE site_id=$1 AND lower(email)=$2 AND status='pending' AND expires_at > now()",
      [siteId, cleanEmail],
    );
    if (existingInvite) {
      const existingInviteId = String(existingInvite.id);
      await tx.unsafe(
        "UPDATE site_invites SET token_hash=$1, expires_at=now() + interval '7 days', role=$2 WHERE id=$3",
        [tokenHash, role, existingInviteId],
      );
      await writeTeamAudit(tx, {
        actorId: inviterId,
        action: "team_invitation_created",
        entityType: "site_invite",
        entityId: existingInviteId,
        siteId,
        role,
        status: "rotated",
      });
      return { ok: true, token, inviteId: existingInviteId };
    }

    const seatCount = await countAccountOperatorIdentities(site.user_id, tx.one);
    if (seatCount >= OPERATOR_SEAT_LIMITS.team) {
      return { ok: false, error: "The Team plan includes 5 operator seats.", code: "seat_limit" };
    }

    const created = (await tx.unsafe(
      `INSERT INTO site_invites (site_id, email, role, token_hash, invited_by, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', now() + interval '7 days')
       RETURNING id`,
      [siteId, cleanEmail, role, tokenHash, inviterId],
    ))[0];
    if (!created?.id) return { ok: false, error: "Failed to create invitation.", code: "create_failed" };
    await writeTeamAudit(tx, {
      actorId: inviterId,
      action: "team_invitation_created",
      entityType: "site_invite",
      entityId: created.id,
      siteId,
      role,
      status: "pending",
    });
    return { ok: true, token, inviteId: created?.id };
  });
}

/**
 * Revoke/cancel a pending invite.
 */
export async function revokeSiteInvite(
  siteId: string,
  inviteId: string,
  requesterId: string,
  ops: DbOps = {},
): Promise<{ ok: boolean; error?: string; code?: string }> {
  const one = ops.one ?? defaultOne;
  const requesterRole = await getSiteRole(siteId, requesterId, { one });
  if (!canRoleManageTeam(requesterRole)) {
    return { ok: false, error: "Only the site owner can revoke invitations.", code: "forbidden" };
  }

  return transactionRunner(ops)(async (tx) => {
    const rows = await tx.unsafe(
      "UPDATE site_invites SET status='revoked' WHERE id=$1 AND site_id=$2 AND status='pending' RETURNING id, role",
      [inviteId, siteId],
    );
    if (!rows?.[0]) return { ok: false, error: "Invitation not found.", code: "not_found" };
    await writeTeamAudit(tx, {
      actorId: requesterId,
      action: "team_invitation_revoked",
      entityType: "site_invite",
      entityId: rows[0].id,
      siteId,
      role: rows[0].role === "moderator" ? "moderator" : undefined,
      status: "revoked",
    });
    return { ok: true };
  });
}

/**
 * Remove a member from a site.
 */
export async function removeSiteMember(
  siteId: string,
  targetUserId: string,
  requesterId: string,
  ops: DbOps = {},
): Promise<{ ok: boolean; error?: string; code?: string }> {
  const one = ops.one ?? defaultOne;
  const requesterRole = await getSiteRole(siteId, requesterId, { one });
  // An owner can remove anyone; a member can remove themselves (leave site)
  if (!canRoleManageTeam(requesterRole) && requesterId !== targetUserId) {
    return { ok: false, error: "Only the site owner can remove team members.", code: "forbidden" };
  }

  return transactionRunner(ops)(async (tx) => {
    const site = await tx.one<{ user_id: string }>(
      "SELECT user_id FROM sites WHERE id=$1 FOR UPDATE",
      [siteId],
    );
    if (!site) return { ok: false, error: "Site not found.", code: "not_found" };
    if (site.user_id === targetUserId) {
      return { ok: false, error: "The site owner cannot be removed.", code: "owner_protected" };
    }
    const removed = await tx.unsafe(
      "DELETE FROM site_members WHERE site_id=$1 AND user_id=$2 RETURNING id, role",
      [siteId, targetUserId],
    );
    if (!removed?.[0]) return { ok: false, error: "Team member not found.", code: "not_found" };
    await writeTeamAudit(tx, {
      actorId: requesterId,
      action: "team_operator_removed",
      entityType: "site_member",
      entityId: removed[0].id,
      siteId,
      role: removed[0].role === "moderator" ? "moderator" : undefined,
      targetUserId,
      status: "removed",
    });
    return { ok: true };
  });
}

/**
 * Fetch invite details by token for the invite landing view.
 */
export async function getInviteByToken(
  token: string,
  { one = defaultOne }: DbOps = {}
): Promise<SiteInviteInfo | null> {
  if (!token) return null;

  const row = await one<{
    id: string;
    site_id: string;
    email: string;
    role: SiteRole;
    status: "pending" | "accepted" | "revoked" | "expired";
    expires_at: string;
    created_at: string;
    invited_by: string;
    site_name: string;
    site_slug: string;
    owner_name: string | null;
  }>(
    `SELECT si.id, si.site_id, si.email, si.role, si.status, si.expires_at, si.created_at, si.invited_by,
            s.name AS site_name, s.slug AS site_slug, u.display_name AS owner_name
       FROM site_invites si
       JOIN sites s ON s.id = si.site_id
       JOIN users u ON u.id = s.user_id
      WHERE si.token_hash = $1`,
    [await hashToken(token)]
  );

  if (!row) return null;
  if (row.role !== "moderator") return null;

  return {
    id: row.id,
    siteId: row.site_id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    invitedBy: row.invited_by,
    siteName: row.site_name,
    siteSlug: row.site_slug,
    ownerName: row.owner_name || "Streamer",
  };
}

/**
 * Accept an invitation token for a logged-in user.
 */
export async function acceptSiteInvite(
  token: string,
  userId: string,
  ops: DbOps = {}
): Promise<{ ok: boolean; siteId?: string; role?: SiteRole; error?: string; code?: string }> {
  if (!token || !userId) {
    return { ok: false, error: "Invalid invite token or user.", code: "invalid_request" };
  }

  const tokenHash = await hashToken(token);
  return transactionRunner(ops)(async (tx) => {
  const invite = await tx.one<{
    id: string;
    site_id: string;
    email: string;
    role: SiteRole;
    status: string;
    expires_at: string;
    invited_by: string;
    owner_id: string;
    plan: string;
    plan_expires_at: string | null;
    owner_status: string;
  }>(
    `SELECT si.id, si.site_id, si.email, si.role, si.status, si.expires_at, si.invited_by,
            s.user_id AS owner_id, u.plan, u.plan_expires_at, u.status AS owner_status
       FROM site_invites si
       JOIN sites s ON s.id=si.site_id
       JOIN users u ON u.id=s.user_id
      WHERE si.token_hash=$1
      FOR UPDATE OF si, u`,
    [tokenHash]
  );

  if (!invite) {
    return { ok: false, error: "Invitation not found.", code: "not_found" };
  }

  if (invite.status === "revoked") {
    return { ok: false, error: "This invitation has been revoked by the site owner.", code: "revoked" };
  }

  const user = await tx.one<{ email: string }>("SELECT email FROM users WHERE id=$1", [userId]);
  if (!user || user.email.trim().toLowerCase() !== invite.email.trim().toLowerCase()) {
    return { ok: false, error: "This invitation was issued for a different email address.", code: "email_mismatch" };
  }

  if (invite.status === "accepted") {
    return { ok: true, siteId: invite.site_id, role: invite.role };
  }

  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "This invitation has expired.", code: "expired" };
  }

  if (invite.role !== "moderator") {
    return { ok: false, error: "This invitation has an unsupported role.", code: "invalid_role" };
  }

  if (effectivePlan({ plan: invite.plan, plan_expires_at: invite.plan_expires_at, status: invite.owner_status }) !== "team") {
    return { ok: false, error: "The site owner needs the Team plan before this invitation can be accepted.", code: "requires_team" };
  }

  const existingAccountSeat = await tx.one(
    `SELECT sm.id
       FROM site_members sm
       JOIN sites s ON s.id=sm.site_id
      WHERE s.user_id=$1 AND sm.user_id=$2
      LIMIT 1`,
    [invite.owner_id, userId],
  );
  if (!existingAccountSeat) {
    const seats = await tx.one(
      `SELECT (1 + COUNT(DISTINCT sm.user_id))::int AS count
         FROM sites s
         LEFT JOIN site_members sm ON sm.site_id=s.id
        WHERE s.user_id=$1`,
      [invite.owner_id],
    );
    if ((Number(seats?.count) || 0) >= OPERATOR_SEAT_LIMITS.team) {
      return { ok: false, error: "The Team plan includes 5 operator seats.", code: "seat_limit" };
    }
  }

  // Insert membership record
  await tx.unsafe(
    `INSERT INTO site_members (site_id, user_id, role, invited_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (site_id, user_id)
     DO UPDATE SET role = EXCLUDED.role, updated_at = now()`,
    [invite.site_id, userId, invite.role, invite.invited_by]
  );

  // Mark invite as accepted
  await tx.unsafe(
    "UPDATE site_invites SET status='accepted' WHERE id=$1",
    [invite.id]
  );

  await writeTeamAudit(tx, {
    actorId: userId,
    action: "team_invitation_accepted",
    entityType: "site_invite",
    entityId: invite.id,
    siteId: invite.site_id,
    role: "moderator",
    targetUserId: userId,
    status: "accepted",
  });

  return { ok: true, siteId: invite.site_id, role: invite.role };
  });
}
