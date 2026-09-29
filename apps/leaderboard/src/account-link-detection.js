// Smart account linking — detection pass (Phase 2).
//
// Runs once a day from the scheduler (never from a request path). Scores
// viewer pairs per site from device, identity, IP and claim signals, and
// persists only pairs at or above LIKELY_LINKED_THRESHOLD. Detection never
// changes a link's status: restricting is always the streamer's decision.
import { query as defaultRun } from "@yourrank/shared/db";

export const LIKELY_LINKED_THRESHOLD = 60;

// +50 device, +40 identity, +20 IP within 24h, +15 per same-time claim capped
// at +30; total capped at 100. Reasons are emitted in canonical order.
export function scoreAccountLink({ sameDevice, sameIdentity, sameIp, sameTimeClaims } = {}) {
  let confidence = 0;
  const reasons = [];
  if (sameDevice) { confidence += 50; reasons.push("same_device"); }
  if (sameIdentity) { confidence += 40; reasons.push("same_identity"); }
  if (sameIp) { confidence += 20; reasons.push("same_ip_24h"); }
  const claims = Math.max(0, Number(sameTimeClaims) || 0);
  if (claims >= 1) {
    confidence += Math.min(30, claims * 15);
    reasons.push("same_time_claims");
  }
  return { confidence: Math.min(100, confidence), reasons };
}

const CANDIDATE_PAIRS_SQL = `WITH identities AS (
  SELECT viewer_id, provider, external_user_id FROM viewer_identities
  UNION
  SELECT viewer_id, provider, external_user_id FROM viewer_identity_events WHERE event = 'linked'
),
members AS (
  SELECT sv.viewer_id FROM site_viewers sv WHERE sv.site_id = $1
),
dev AS (
  SELECT DISTINCT a.viewer_id AS va, b.viewer_id AS vb
    FROM device_links a
    JOIN device_links b ON b.site_id = a.site_id AND b.device_hash = a.device_hash AND b.viewer_id > a.viewer_id
   WHERE a.site_id = $1
),
ident AS (
  SELECT DISTINCT a.viewer_id AS va, b.viewer_id AS vb
    FROM identities a
    JOIN identities b ON b.provider = a.provider AND b.external_user_id = a.external_user_id AND b.viewer_id > a.viewer_id
    JOIN members ma ON ma.viewer_id = a.viewer_id
    JOIN members mb ON mb.viewer_id = b.viewer_id
),
ip AS (
  SELECT DISTINCT a.viewer_id AS va, b.viewer_id AS vb
    FROM ip_observations a
    JOIN ip_observations b ON b.site_id = a.site_id AND b.ip_hash = a.ip_hash AND b.viewer_id > a.viewer_id
     AND b.observed_at BETWEEN a.observed_at - interval '24 hours' AND a.observed_at + interval '24 hours'
   WHERE a.site_id = $1
),
claims AS (
  SELECT a.viewer_id AS va, b.viewer_id AS vb, count(DISTINCT a.code_drop_id)::int AS n
    FROM code_drop_claims a
    JOIN code_drops d ON d.id = a.code_drop_id AND d.site_id = $1
    JOIN code_drop_claims b ON b.code_drop_id = a.code_drop_id AND b.viewer_id > a.viewer_id
     AND abs(extract(epoch FROM (b.created_at - a.created_at))) <= 2
   GROUP BY a.viewer_id, b.viewer_id
),
pairs AS (
  SELECT va, vb FROM dev UNION SELECT va, vb FROM ident UNION SELECT va, vb FROM ip UNION SELECT va, vb FROM claims
)
SELECT p.va AS viewer_a, p.vb AS viewer_b,
       (dev.va IS NOT NULL) AS same_device,
       (ident.va IS NOT NULL) AS same_identity,
       (ip.va IS NOT NULL) AS same_ip,
       COALESCE(claims.n, 0) AS same_time_claims
  FROM pairs p
  JOIN viewers xa ON xa.id = p.va AND xa.is_system = false
  JOIN viewers xb ON xb.id = p.vb AND xb.is_system = false
  LEFT JOIN dev ON dev.va = p.va AND dev.vb = p.vb
  LEFT JOIN ident ON ident.va = p.va AND ident.vb = p.vb
  LEFT JOIN ip ON ip.va = p.va AND ip.vb = p.vb
  LEFT JOIN claims ON claims.va = p.va AND claims.vb = p.vb`;

const SITES_SQL = `SELECT site_id FROM device_links
UNION SELECT site_id FROM ip_observations
UNION SELECT d.site_id FROM code_drop_claims c JOIN code_drops d ON d.id = c.code_drop_id WHERE c.created_at > now() - interval '30 days'
UNION SELECT sv.site_id FROM site_viewers sv WHERE sv.viewer_id IN (SELECT viewer_id FROM viewer_identity_events)`;

const UPSERT_SQL = `INSERT INTO account_links (site_id, viewer_a, viewer_b, confidence, reasons, same_time_claims, status, last_detected_at)
VALUES ($1, $2, $3, $4, $5::text[], $6, 'pending', now())
ON CONFLICT (site_id, viewer_a, viewer_b) DO UPDATE SET
  confidence = GREATEST(account_links.confidence, EXCLUDED.confidence),
  reasons = ARRAY(SELECT DISTINCT r FROM unnest(account_links.reasons || EXCLUDED.reasons) AS r ORDER BY r),
  same_time_claims = GREATEST(account_links.same_time_claims, EXCLUDED.same_time_claims),
  last_detected_at = now(), updated_at = now()
WHERE account_links.status <> 'dismissed'
RETURNING id, (xmax = 0) AS inserted`;

/**
 * Score and persist likely-linked pairs for every site with signal data.
 * `run` is a SqlRunner (text, params) => rows.
 */
export async function runAccountLinkDetection({ run = defaultRun } = {}) {
  const sites = await run(SITES_SQL);
  for (const { site_id: siteId } of sites || []) {
    try {
      const pairs = await run(CANDIDATE_PAIRS_SQL, [siteId]);
      let likely = 0;
      let belowThreshold = 0;
      let inserted = 0;
      let updated = 0;
      let skippedDismissed = 0;
      for (const pair of pairs || []) {
        const { confidence, reasons } = scoreAccountLink({
          sameDevice: pair.same_device,
          sameIdentity: pair.same_identity,
          sameIp: pair.same_ip,
          sameTimeClaims: pair.same_time_claims,
        });
        if (confidence < LIKELY_LINKED_THRESHOLD) {
          belowThreshold += 1;
          continue;
        }
        likely += 1;
        const a = String(pair.viewer_a) < String(pair.viewer_b) ? pair.viewer_a : pair.viewer_b;
        const b = String(pair.viewer_a) < String(pair.viewer_b) ? pair.viewer_b : pair.viewer_a;
        const rows = await run(UPSERT_SQL, [siteId, a, b, confidence, reasons, pair.same_time_claims || 0]);
        if (!rows?.length) {
          // A dismissed pair is never re-flagged.
          skippedDismissed += 1;
          continue;
        }
        if (rows[0].inserted) {
          inserted += 1;
          await run(
            `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details)
             VALUES (NULL, 'account_link_detected', 'account_link', $1, $2::jsonb)`,
            [
              String(rows[0].id),
              {
                siteId,
                confidence,
                reasons,
                sameTimeClaims: pair.same_time_claims || 0,
              },
            ],
          );
        } else {
          updated += 1;
        }
      }
      console.log(JSON.stringify({
        event: "account_link_detection", siteId,
        candidates: (pairs || []).length, likely, belowThreshold,
        inserted, updated, skippedDismissed,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "account_link_detection_failed", siteId,
        error: String(error?.message || error),
      }));
    }
  }
}
