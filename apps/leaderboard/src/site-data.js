// Per-site viewer data helpers for the public site shell.
import { one, query, exec } from "@yourrank/shared/db";

export async function getShopItems(siteId, queryImpl = query) {
  return queryImpl(
    // Defensive ceiling above the highest current plan's active-item limit.
    "SELECT id, name, description, cost, stock, active FROM shop_items WHERE site_id=$1 AND active=true ORDER BY name ASC LIMIT 1024",
    [siteId]
  ) || [];
}

/** Resolve the viewer's per-site row plus shop, redemptions and ledger.
 *  Passing viewerId=null returns just the public shop list.
 */
export async function getViewerSiteData(
  siteId,
  viewerId,
  { shop = false, redemptions = false, ledger = false } = {},
  { oneImpl = one, queryImpl = query, execImpl = exec } = {},
) {
  if (!viewerId) {
    if (shop) return { membershipStatus: "absent", viewerOnSite: null, shopItems: await getShopItems(siteId, queryImpl), redemptions: [], ledger: [] };
    return { membershipStatus: "absent", viewerOnSite: null, shopItems: [], redemptions: [], ledger: [] };
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
      redemptions: [],
      ledger: [],
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

  const [redemptionRows, ledgerRows] = await Promise.all([
    redemptions
      ? queryImpl(
          `SELECT r.id, r.cost, r.status, r.created_at, r.updated_at, i.name AS item_name
             FROM redemptions r
             JOIN shop_items i ON i.id = r.shop_item_id
            WHERE r.site_viewer_id=$1
            ORDER BY r.created_at DESC LIMIT 50`,
          [viewerOnSite.id]
        )
      : Promise.resolve([]),
    ledger
      ? queryImpl(
          `SELECT id, type, amount, description, created_at FROM credit_ledger WHERE site_viewer_id=$1 ORDER BY created_at DESC LIMIT 100`,
          [viewerOnSite.id]
        )
      : Promise.resolve([]),
  ]);

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
    shopItems: shop ? shopItems : [],
    redemptions: redemptionRows || [],
    ledger: ledgerRows || [],
  };
}
