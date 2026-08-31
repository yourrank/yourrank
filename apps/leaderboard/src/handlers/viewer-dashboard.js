// Viewer-facing account API plus the site-scoped reward-claim action.

import { one, query, withTransaction } from "@yourrank/shared/db";
import { rateLimit } from "@yourrank/shared/ratelimit";
import { getPublicSite } from "../site.js";
import { requireViewer } from "./viewer-auth.js";
import { bad, json, ok } from "../auth.js";
import { decryptCredential } from "@yourrank/shared/crypto";
import { buildRedemptionEmbed, sendDiscordWebhook } from "@yourrank/shared/notifications";
import {
  CREDITS_PENDING_REDEMPTIONS_LIMITS,
  CREDITS_REDEMPTIONS_PER_30D_LIMITS,
} from "@yourrank/shared/plans";
import { markSiteViewerActive } from "@yourrank/shared/plan-usage";
import {
  createViewerMembership,
  requestIsSameOrigin,
  resolveJoinableCommunity,
} from "../viewer-membership.js";

const privateViewerJson = (data) => json(
  { ok: true, ...data },
  200,
  { "cache-control": "private, no-store", vary: "Cookie" },
);

function isUniqueViolation(error) {
  return error?.code === "23505" || /unique constraint|unique violation|duplicate key/i.test(error?.message || "");
}

export async function handleViewerMe(request, env, deps = {}) {
  const requireViewerImpl = deps.requireViewer || requireViewer;
  const rateLimitImpl = deps.rateLimit || rateLimit;
  const queryImpl = deps.query || query;
  const { viewer, res } = await requireViewerImpl(request, env);
  if (res) return res;
  if (!(await rateLimitImpl(env, `viewer:me:${viewer.id}`, 60, 60)).ok) return bad("Too many requests.", 429);

  const communities = await queryImpl(
    `SELECT s.slug, s.name,
            sv.id AS membership_id, sv.balance,
            sv.blocked,
            count(r.id) FILTER (WHERE r.status = 'pending')::int AS pending_claims
       FROM site_viewers sv
       JOIN sites s ON s.id = sv.site_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN redemptions r ON r.site_viewer_id = sv.id
      WHERE sv.viewer_id = $1
        AND s.published = true
        AND s.is_draft = false
        AND u.status != 'suspended'
        AND u.email_verified = true
      GROUP BY s.slug, s.name, sv.id, sv.balance, sv.blocked,
               sv.updated_at
      ORDER BY sv.updated_at DESC`,
    [viewer.id]
  );

  const safeCommunities = (communities || []).map((community) => ({
    slug: community.slug,
    name: community.name,
    balance: community.balance,
    pendingClaims: Number(community.pending_claims || 0),
    claimingAvailable: !community.blocked,
  }));

  const connections = [];
  if (viewer.kick_linked_at) {
    connections.push({
      provider: "kick",
      username: viewer.kick_username,
      linkedAt: viewer.kick_linked_at,
    });
  }
  if (viewer.discord_linked_at) {
    connections.push({
      provider: "discord",
      username: viewer.discord_username,
      linkedAt: viewer.discord_linked_at,
    });
  }
  const displayName = connections.find((connection) => connection.username)?.username || "Member";

  return privateViewerJson({
    viewer: {
      displayName,
      avatarUrl: viewer.avatar_url,
      createdAt: viewer.created_at,
      connections,
    },
    communities: safeCommunities,
  });
}

export async function handleViewerJoin(request, env, deps = {}) {
  const requireViewerImpl = deps.requireViewer || requireViewer;
  const rateLimitImpl = deps.rateLimit || rateLimit;
  const oneImpl = deps.one || one;
  const { viewer, res } = await requireViewerImpl(request, env);
  if (res) return res;
  if (!requestIsSameOrigin(request)) return bad("Join request origin is not allowed.", 403);

  const rl = await rateLimitImpl(env, `viewer:join:${viewer.id}`, 10, 60);
  if (!rl.ok) return bad("Too many join attempts. Try again shortly.", 429);

  const body = request.validatedBody || await (async () => {
    try { return await request.json(); } catch { return null; }
  })();
  const community = await resolveJoinableCommunity(request, env, body?.slug, deps);
  if (!community) return bad("Community is not available.", 404);

  const membership = await createViewerMembership(community.id, viewer.id, { oneImpl });
  if (!membership) return bad("Community membership is unavailable.", 503);
  return privateViewerJson({
    membership: {
      slug: community.slug,
      balance: Number(membership.balance || 0),
    },
  });
}

export async function handleViewerRedeem(request, env, deps = {}) {
  const requireViewerFn = deps.requireViewer || requireViewer;
  const markActive = deps.markActive || markSiteViewerActive;
  const { viewer, res } = await requireViewerFn(request, env);
  if (res) return res;

  const body = request.validatedBody || await (async () => {
    try { return await request.json(); } catch { return null; }
  })();
  const slug = String(body?.slug || "").trim().toLowerCase();
  const shopItemId = String(body?.shopItemId || "").trim();
  const idempotencyKey = String(body?.idempotencyKey || "").trim();
  if (!slug || !shopItemId) return bad("slug and shopItemId required");
  if (!idempotencyKey) return bad("idempotency key required");
  const clientToken = idempotencyKey;

  const r = await getPublicSite(env, slug, request);
  if (r && r.requiresPassword) return bad("Password required.", 401);
  if (!r || r.suspended) return bad("site not found", 404);

  const rl = await rateLimit(env, `viewer-redeem:${r.id}:${viewer.id}`, 10, 60);
  if (!rl.ok) return bad("rate limited", 429);

  let txResult;
  try {
    txResult = await withTransaction(async (tx) => {
      await tx.unsafe("SELECT id FROM sites WHERE id=$1 FOR UPDATE", [r.id]);

      // Idempotency lookup is performed before any mutable business checks
      // (plan capacity, stock, balance) so retries always return the original
      // order and cancellation cannot make a token reusable.
      const existing = await tx.one(
        `SELECT r.id, r.shop_item_id, r.cost, r.status, sv.balance, sv.blocked, i.name AS item_name
           FROM redemptions r
           JOIN site_viewers sv ON sv.id = r.site_viewer_id
           LEFT JOIN shop_items i ON i.id = r.shop_item_id
          WHERE sv.site_id = $1
            AND sv.viewer_id = $2
            AND r.client_token = $3`,
        [r.id, viewer.id, clientToken]
      );
      if (existing) {
        if (existing.shop_item_id !== shopItemId) {
          return { error: "idempotency key already used for a different item", status: 409 };
        }
        return { redemptionId: existing.id, balance: Number(existing.balance), itemName: existing.item_name || shopItemId, itemCost: existing.cost, status: existing.status, activityCommitted: false };
      }

      const plan = r.plan;
      const [pendingRow, fulfilled30dRow] = await Promise.all([
        tx.one(
          `SELECT count(*)::int AS count FROM redemptions red
             JOIN site_viewers sv ON sv.id = red.site_viewer_id
            WHERE sv.site_id=$1 AND red.status='pending'`,
          [r.id]
        ),
        tx.one(
          `SELECT count(*)::int AS count FROM redemptions red
             JOIN site_viewers sv ON sv.id = red.site_viewer_id
            WHERE sv.site_id=$1 AND red.status='fulfilled' AND red.created_at > now() - interval '30 days'`,
          [r.id]
        ),
      ]);
      if ((pendingRow?.count || 0) >= CREDITS_PENDING_REDEMPTIONS_LIMITS[plan]) {
        return { error: "This streamer's shop is at capacity. Ask them to upgrade.", status: 403 };
      }
      if ((fulfilled30dRow?.count || 0) >= CREDITS_REDEMPTIONS_PER_30D_LIMITS[plan]) {
        return { error: "This streamer's monthly redemption limit is reached. Ask them to upgrade.", status: 403 };
      }

      const viewerRow = await tx.one(
        `SELECT sv.id, sv.balance, sv.blocked
           FROM site_viewers sv
          WHERE sv.site_id=$1 AND sv.viewer_id=$2
          FOR UPDATE`,
        [r.id, viewer.id]
      );
      if (!viewerRow) return { error: "No credits found on this site. Earn some first.", status: 400 };
      if (viewerRow.blocked) return { error: "viewer blocked", status: 400 };

      const item = await tx.one(
        "SELECT id, name, cost, stock FROM shop_items WHERE id=$1 AND site_id=$2 AND active=true FOR UPDATE",
        [shopItemId, r.id]
      );
      if (!item) return { error: "item not found", status: 400 };
      if (item.stock !== null && item.stock <= 0) return { error: "out of stock", status: 400 };

      // Atomic conditional update: the WHERE clauses make concurrent redemptions
      // race-safe and ensure balance can never go negative or stock below zero.
      const updatedViewer = await tx.one(
        `UPDATE site_viewers
          SET balance = balance - $1,
              total_spent = total_spent + $1,
              last_redeemed_at = now(),
              updated_at = now()
        WHERE id=$2 AND balance >= $1
        RETURNING id, balance`,
        [item.cost, viewerRow.id]
      );
      if (!updatedViewer) return { error: "insufficient balance", status: 400 };

      if (item.stock !== null) {
        const updatedItem = await tx.one(
          `UPDATE shop_items
              SET stock = stock - 1, updated_at = now()
            WHERE id=$1 AND stock >= 1
           RETURNING id`,
          [item.id]
        );
        if (!updatedItem) return { error: "out of stock", status: 400 };
      }

      const redemptionRows = await tx.unsafe(
        `INSERT INTO redemptions (site_viewer_id, shop_item_id, cost, status, client_token)
         VALUES ($1, $2, $3, 'pending', $4)
         RETURNING id`,
        [viewerRow.id, item.id, item.cost, clientToken]
      );

      await tx.unsafe(
        `INSERT INTO credit_ledger (site_viewer_id, type, amount, description, metadata)
         VALUES ($1, 'spend', $2, $3, $4)`,
        [
          viewerRow.id,
          item.cost,
          `Claimed: ${item.name || item.id}`,
          { shop_item_id: item.id, redemption_id: redemptionRows[0].id, item_name: item.name || "" },
        ]
      );

      return { redemptionId: redemptionRows[0].id, balance: updatedViewer.balance, itemName: item.name, itemCost: item.cost, activityCommitted: true };
    });
  } catch (e) {
    // If two retries race on the same idempotency key, the durable unique index
    // raises a conflict. Return the existing order (or a misuse conflict) so the
    // member is never charged twice.
    if (isUniqueViolation(e)) {
      const existing = await one(
        `SELECT r.id, r.shop_item_id, r.cost, r.status, sv.balance, i.name AS item_name
           FROM redemptions r
           JOIN site_viewers sv ON sv.id = r.site_viewer_id
           LEFT JOIN shop_items i ON i.id = r.shop_item_id
          WHERE sv.site_id = $1
            AND sv.viewer_id = $2
            AND r.client_token = $3`,
        [r.id, viewer.id, clientToken]
      );
      if (existing) {
        if (existing.shop_item_id !== shopItemId) {
          return bad("idempotency key already used for a different item", 409);
        }
        return ok({ redemptionId: existing.id, balance: Number(existing.balance), itemName: existing.item_name || shopItemId });
      }
    }
    throw e;
  }

  if (txResult.error) return bad(txResult.error, txResult.status);

  if (txResult.activityCommitted) await markActive(r.id, viewer.id);

  // Asynchronously notify streamer via Discord webhook if configured
  (async () => {
    try {
      const siteRow = await one("SELECT discord_webhook_url_enc FROM sites WHERE id=$1", [r.id]);
      if (siteRow?.discord_webhook_url_enc) {
        const webhookUrl = await decryptCredential(siteRow.discord_webhook_url_enc);
        if (webhookUrl) {
          const viewerName = viewer.kick_username || viewer.discord_username || "Viewer";
          const embed = buildRedemptionEmbed(r.name || slug, viewerName, txResult.itemName || "Shop Item", txResult.itemCost || 0);
          await sendDiscordWebhook(webhookUrl, embed);
        }
      }
    } catch (e) {
      console.error("[redeem-notify] failed to dispatch webhook:", e?.message || e);
    }
  })();

  return ok({ redemptionId: txResult.redemptionId, balance: txResult.balance });
}
