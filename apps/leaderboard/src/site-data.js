// Per-site viewer data helpers for the public site shell.
import { one, query, exec } from "@yourrank/shared/db";
import { getViewerClaimsForMembership } from "./handlers/claims.js";

const VIEWER_PARTICIPATION_LIMIT = 25;

export async function getShopItems(siteId, queryImpl = query) {
  return queryImpl(
    // Defensive ceiling above the highest current plan's active-item limit.
    "SELECT id, name, description, cost, stock, active, cooldown_seconds, (image_key IS NOT NULL) AS has_image FROM shop_items WHERE site_id=$1 AND active=true AND deleted_at IS NULL ORDER BY name ASC LIMIT 1024",
    [siteId]
  ) || [];
}

/**
 * Participation is deliberately narrower than generic activity. A persisted
 * code_drop_claim is the only current free, viewer-linked success record with
 * an immutable event timestamp. Attempts and legacy mechanics are not read.
 */
export async function getViewerParticipationHistory(
  siteId,
  viewerId,
  membershipId,
  { queryImpl = query } = {},
) {
  const rows = await queryImpl(
    `SELECT cdc.created_at AS participated_at
       FROM code_drop_claims cdc
       JOIN code_drops cd ON cd.id=cdc.code_drop_id AND cd.site_id=$1
       JOIN viewers v ON v.id=cdc.viewer_id AND v.is_system=false
      WHERE cdc.viewer_id=$2
        AND cdc.site_viewer_id=$3
      ORDER BY cdc.created_at DESC, cdc.id DESC
      LIMIT $4`,
    [siteId, viewerId, membershipId, VIEWER_PARTICIPATION_LIMIT + 1],
  );
  const found = rows || [];
  return {
    participation: found.slice(0, VIEWER_PARTICIPATION_LIMIT).map((row) => ({
      type: "code_drop_claim",
      title: "Claimed a code drop",
      status: "claimed",
      statusLabel: "Claimed",
      participatedAt: row.participated_at,
    })),
    limit: VIEWER_PARTICIPATION_LIMIT,
    truncated: found.length > VIEWER_PARTICIPATION_LIMIT,
  };
}

/** Resolve the viewer's per-site row plus requested membership records.
 *  Passing viewerId=null returns just the public shop list.
 */
export async function getViewerSiteData(
  siteId,
  viewerId,
  { shop = false, claims = false, ledger = false, participation = false, quests = false } = {},
  {
    oneImpl = one,
    queryImpl = query,
    execImpl = exec,
    getViewerClaimsImpl = getViewerClaimsForMembership,
    getViewerParticipationImpl = getViewerParticipationHistory,
  } = {},
) {
  const emptyHistory = {
    claims: [],
    claimsLimit: 50,
    claimsTruncated: false,
    ledger: [],
    participation: [],
    participationLimit: VIEWER_PARTICIPATION_LIMIT,
    participationTruncated: false,
    streak: null,
    questsCompleted: 0,
  };
  if (!viewerId) {
    if (shop) return { membershipStatus: "absent", viewerOnSite: null, shopItems: await getShopItems(siteId, queryImpl), ...emptyHistory };
    return { membershipStatus: "absent", viewerOnSite: null, shopItems: [], ...emptyHistory };
  }

  const [membershipLookup, shopItems] = await Promise.all([
    oneImpl(
      "SELECT id, balance, blocked, total_earned, total_spent, last_seen_at FROM site_viewers WHERE site_id=$1 AND viewer_id=$2",
      [siteId, viewerId],
    ).then((row) => ({ ok: true, row })).catch((err) => {
      console.error("[site-data] viewer membership lookup failed:", err?.message || err);
      return { ok: false, row: null };
    }),
    shop ? getShopItems(siteId, queryImpl) : Promise.resolve([]),
  ]);
  const viewerOnSite = membershipLookup.row;

  if (!membershipLookup.ok || !viewerOnSite) {
    return {
      membershipStatus: membershipLookup.ok ? "absent" : "unavailable",
      viewerOnSite: null,
      shopItems: shop ? shopItems : [],
      ...emptyHistory,
    };
  }

  {
    const lastSeen = viewerOnSite.last_seen_at ? Date.parse(viewerOnSite.last_seen_at) : NaN;
    if (!Number.isFinite(lastSeen) || Date.now() - lastSeen >= 5 * 60 * 1000) {
      try {
        await execImpl(
          `UPDATE site_viewers
             SET last_seen_at = now()
           WHERE id = $1
             AND (last_seen_at IS NULL OR last_seen_at < now() - interval '5 minutes')`,
          [viewerOnSite.id],
        );
      } catch (err) {
        console.error("[site-data] viewer last-seen update failed:", err?.message || err);
      }
    }
  }

  const [claimResult, ledgerRows, participationResult, streakRow, questsDoneRow] = await Promise.all([
    claims
      ? getViewerClaimsImpl(siteId, viewerId, viewerOnSite.id, { queryImpl })
      : Promise.resolve({ claims: [], limit: 50, truncated: false }),
    ledger
      ? queryImpl(
          `SELECT id, type, amount, description, created_at FROM credit_ledger WHERE site_viewer_id=$1 ORDER BY created_at DESC LIMIT 100`,
          [viewerOnSite.id]
        )
      : Promise.resolve([]),
    participation
      ? getViewerParticipationImpl(siteId, viewerId, viewerOnSite.id, { queryImpl })
      : Promise.resolve({ participation: [], limit: VIEWER_PARTICIPATION_LIMIT, truncated: false }),
    quests
      ? oneImpl(
          "SELECT current_streak, longest_streak FROM viewer_streaks WHERE site_id=$1 AND viewer_id=$2",
          [siteId, viewerId]
        ).catch((err) => {
          console.error("[site-data] viewer streak lookup failed:", err?.message || err);
          return null;
        })
      : Promise.resolve(null),
    quests
      ? oneImpl(
          `SELECT count(*)::int AS n
             FROM viewer_daily_quests vq
             JOIN daily_quests dq ON dq.id = vq.quest_id
            WHERE dq.site_id=$1 AND vq.viewer_id=$2 AND vq.completed = true`,
          [siteId, viewerId]
        ).catch((err) => {
          console.error("[site-data] viewer quest count lookup failed:", err?.message || err);
          return null;
        })
      : Promise.resolve(null),
  ]);

  // Per-item cooldown snapshot: how long this member must still wait before
  // claiming each cooled-down item again. Cancelled claims are refunded and
  // never count toward a cooldown.
  let shopItemsWithCooldown = shop ? shopItems : [];
  if (shop && shopItemsWithCooldown.some((item) => Number(item.cooldown_seconds) > 0)) {
    try {
      const lastClaims = await queryImpl(
        `SELECT shop_item_id, max(created_at) AS last_at
           FROM redemptions
          WHERE site_viewer_id=$1 AND status != 'cancelled'
          GROUP BY shop_item_id`,
        [viewerOnSite.id]
      );
      const lastByItem = new Map((lastClaims || []).map((row) => [row.shop_item_id, row.last_at]));
      shopItemsWithCooldown = shopItemsWithCooldown.map((item) => {
        const cooldown = Number(item.cooldown_seconds) || 0;
        if (cooldown <= 0) return item;
        const lastAt = lastByItem.get(item.id);
        const remaining = lastAt
          ? Math.ceil(cooldown - (Date.now() - Date.parse(lastAt)) / 1000)
          : 0;
        return { ...item, cooldownRemaining: Math.max(0, remaining) };
      });
    } catch (err) {
      console.error("[site-data] cooldown lookup failed:", err?.message || err);
    }
  }

  return {
    membershipStatus: "member",
    viewerOnSite: {
      id: viewerOnSite.id,
      balance: viewerOnSite.balance,
      blocked: viewerOnSite.blocked,
      total_earned: viewerOnSite.total_earned,
      total_spent: viewerOnSite.total_spent,
      last_seen_at: viewerOnSite.last_seen_at,
    },
    shopItems: shopItemsWithCooldown,
    claims: claimResult.claims || [],
    claimsLimit: claimResult.limit,
    claimsTruncated: !!claimResult.truncated,
    ledger: ledgerRows || [],
    participation: participationResult.participation || [],
    participationLimit: participationResult.limit,
    participationTruncated: !!participationResult.truncated,
    streak: streakRow
      ? { current: Number(streakRow.current_streak) || 0, longest: Number(streakRow.longest_streak) || 0 }
      : null,
    questsCompleted: Number(questsDoneRow?.n) || 0,
  };
}
