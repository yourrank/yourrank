// Shared analytics counter helpers. Used by the leaderboard Worker and the
// queue consumer so click/view/copy increments are processed reliably.
import { withTransaction, type Tx } from "./db.js";

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function extractDomain(ref: string | null): string | null {
  if (!ref) return null;
  try {
    const u = new URL(ref);
    return u.hostname.replace(/^www\./, "").slice(0, 120);
  } catch {
    return null;
  }
}

const FIELDS = new Set(["views", "copies", "clicks"]);

export interface BumpParams {
  siteId: string;
  field: "views" | "copies" | "clicks";
  referer?: string | null;
  visitorHash?: string | null;
  clickRef?: string | null;
}

/**
 * Apply one additive analytics increment inside the caller's transaction.
 * Counters stay additive; exactly-once comes from the queue event ledger
 * (`runOnceInTransaction`) sharing this transaction, not from these upserts.
 */
export async function bumpStatTx(
  tx: Pick<Tx, "query">,
  siteId: string,
  field: string,
  refererHeader?: string | null,
  visitorHash?: string | null
): Promise<void> {
  if (!siteId || !FIELDS.has(field)) return;
  const day = todayUTC();
  const viewsInc = field === "views" ? 1 : 0;
  const copiesInc = field === "copies" ? 1 : 0;
  const clicksInc = field === "clicks" ? 1 : 0;

  await tx.query(
    `INSERT INTO site_stats (site_id, day, views, copies, clicks) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (site_id, day) DO UPDATE SET
       views = site_stats.views + $3,
       copies = site_stats.copies + $4,
       clicks = site_stats.clicks + $5`,
    [siteId, day, viewsInc, copiesInc, clicksInc]
  );

  if (field === "views") {
    const now = new Date();
    const hour = now.getUTCHours();
    const dow = now.getUTCDay();
    await tx.query(
      `INSERT INTO site_stats_hourly (site_id, day, hour, day_of_week, views) VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (site_id, day, hour) DO UPDATE SET views = site_stats_hourly.views + 1`,
      [siteId, day, hour, dow]
    );

    const domain = extractDomain(refererHeader || null);
    if (domain) {
      await tx.query(
        `INSERT INTO site_referrers (site_id, day, domain, count) VALUES ($1, $2, $3, 1)
         ON CONFLICT (site_id, day, domain) DO UPDATE SET count = site_referrers.count + 1`,
        [siteId, day, domain]
      );
    }

    if (visitorHash) {
      await tx.query(
        `INSERT INTO site_visitors (site_id, visitor_hash, first_seen, last_seen, sessions)
         VALUES ($1, $2, now(), now(), 1)
         ON CONFLICT (site_id, visitor_hash) DO UPDATE SET
           last_seen = now(),
           sessions = site_visitors.sessions + CASE
             WHEN site_visitors.last_seen < now() - interval '30 minutes' THEN 1
             ELSE 0
           END`,
        [siteId, visitorHash]
      );
    }
  }
}

/**
 * Increment daily site stats, hourly heatmap, and referrer tracking in one
 * transaction. NOT idempotent on its own (the upserts are additive); callers
 * that may be retried must go through the queue event ledger.
 */
export async function bumpStat(
  siteId: string,
  field: string,
  refererHeader?: string | null,
  visitorHash?: string | null
): Promise<void> {
  if (!siteId || !FIELDS.has(field)) return;
  try {
    await withTransaction((tx) => bumpStatTx(tx, siteId, field, refererHeader, visitorHash));
  } catch (err) {
    console.error("[bumpStat]: operation failed", err);
    throw err;
  }
}
