// Auto-reset scheduler: closes out and archives boards whose countdown has expired
// when the streamer has enabled auto-reset. Runs from the scheduled Worker event.
import { query, exec, one } from "@yourrank/shared/db";
import { createArchive, getPlayers } from "./site.js";
import { notifyReset } from "@yourrank/shared/notifications";
import { mapWithConcurrency, SHARED_WORK_CONCURRENCY_LIMIT } from "@yourrank/shared/work-concurrency";
import { restoreAutoResetMarker } from "./auto-reset-claim.js";
import { notifyLiveBoard } from "./live-board-config.js";
import { autoResetClearFromDb, rankByFromDb } from "@yourrank/shared/legacy-schema";

function nextEndsAt(period, currentEndsAt) {
  const d = currentEndsAt ? new Date(currentEndsAt) : new Date();
  switch (period) {
    case "Weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "Season":
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case "Monthly":
    default:
      d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return d.toISOString();
}

export async function runAutoReset(env) {
  const rows = await query(
    `SELECT id, user_id, slug, name, period, starts_at, ends_at, rank_by, auto_reset_clear
       FROM sites
      WHERE published = true
        AND is_draft = false
        AND auto_reset_enabled = true
        AND ends_at IS NOT NULL
        AND ends_at <= now()
        AND (auto_reset_last_run_at IS NULL OR auto_reset_last_run_at < ends_at)
      ORDER BY ends_at ASC
      LIMIT 100`,
    []
  );

  await mapWithConcurrency(
    rows || [],
    SHARED_WORK_CONCURRENCY_LIMIT,
    (site) => processAutoResetSite(env, site)
  );
}

export async function processAutoResetSite(env, site) {
  try {
    // Claim before the archive write. If the Worker is interrupted after the
    // archive commits, the marker prevents the next cron run from archiving
    // the same period again.
    const claimed = await one(
      `UPDATE sites AS s
          SET auto_reset_last_run_at = s.ends_at
         FROM sites AS old
        WHERE old.id = s.id
          AND s.id = $1
          AND s.auto_reset_enabled = true
          AND s.ends_at IS NOT NULL
          AND (s.auto_reset_last_run_at IS NULL OR s.auto_reset_last_run_at < s.ends_at)
      RETURNING s.id, s.ends_at, old.auto_reset_last_run_at AS prev`,
      [site.id]
    );
    if (!claimed) return;

    const players = await getPlayers(env, site.id, { rankBy: rankByFromDb(site.rank_by) });
    const top3 = players.slice(0, 3);
    const label = `Auto-reset · ${new Date().toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
    const clear = autoResetClearFromDb(site.auto_reset_clear);

    const result = await createArchive(env, site.user_id, { label, clear, siteId: site.id });
    if (result.error) {
      console.error(`[auto-reset] archive failed for site ${site.id}: ${result.error}`);
      await restoreAutoResetMarker(exec, site.id, claimed.prev);
      return;
    }

    const nextEnds = nextEndsAt(site.period, site.ends_at);
    await exec(
      `UPDATE sites SET starts_at = $1, ends_at = $2, auto_reset_last_run_at = now(), updated_at = now()
        WHERE id = $3 AND auto_reset_enabled = true AND ends_at = $1`,
      [site.ends_at, nextEnds, site.id]
    );
    void notifyLiveBoard(env, site.id);

    // Fire Discord/Telegram reset notifications if configured.
    await notifyReset({ one }, env, site.id, site.name, top3, site.period || "Monthly").catch((err) => {
      console.error(`[auto-reset] notify failed for site ${site.id}:`, err);
    });

    console.log(`[auto-reset] archived site ${site.slug} (${site.id}), next reset ${nextEnds}`);
  } catch (err) {
    console.error(`[auto-reset] failed for site ${site.id}:`, err);
  }
}
