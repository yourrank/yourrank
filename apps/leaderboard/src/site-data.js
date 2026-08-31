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
    if (shop) return { viewerOnSite: null, shopItems: await getShopItems(siteId, queryImpl), redemptions: [], ledger: [] };
    return { viewerOnSite: null, shopItems: [], redemptions: [], ledger: [] };
  }

  let [viewerOnSite, shopItems] = await Promise.all([
    oneImpl(
      "SELECT id, balance, blocked, total_earned, total_spent, created_at, last_seen_at FROM site_viewers WHERE site_id=$1 AND viewer_id=$2",
      [siteId, viewerId]
    ),
    shop ? getShopItems(siteId, queryImpl) : Promise.resolve([]),
  ]);

  if (!viewerOnSite) {
    try {
      await execImpl(
        `INSERT INTO site_viewers (site_id, viewer_id, balance, total_earned, last_seen_at)
         VALUES ($1, $2, 0, 0, now())
         ON CONFLICT (site_id, viewer_id) DO NOTHING`,
        [siteId, viewerId],
      );
      viewerOnSite = await oneImpl(
        "SELECT id, balance, blocked, total_earned, total_spent, created_at, last_seen_at FROM site_viewers WHERE site_id=$1 AND viewer_id=$2",
        [siteId, viewerId],
      );
    } catch (err) {
      console.error("[site-data] viewer membership registration failed:", err?.message || err);
      return { viewerOnSite: null, shopItems: shop ? shopItems : [], redemptions: [], ledger: [] };
    }
    if (!viewerOnSite) {
      console.error("[site-data] viewer membership registration returned no row");
      return { viewerOnSite: null, shopItems: shop ? shopItems : [], redemptions: [], ledger: [] };
    }
  } else {
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
    viewerOnSite: {
      id: viewerOnSite.id,
      balance: viewerOnSite.balance,
      blocked: viewerOnSite.blocked,
      total_earned: viewerOnSite.total_earned,
      total_spent: viewerOnSite.total_spent,
      created_at: viewerOnSite.created_at,
      last_seen_at: viewerOnSite.last_seen_at,
    },
    shopItems: shop ? shopItems : [],
    redemptions: redemptionRows || [],
    ledger: ledgerRows || [],
  };
}
