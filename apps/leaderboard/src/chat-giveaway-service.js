import { withTransaction, query } from "@yourrank/shared/db";
import { giveawayRules, evaluateGiveawayEligibility } from "@yourrank/shared/giveaway-eligibility";

export const SESSION_COLUMNS = `id, site_id, provider, keyword, rules, status, started_at, stopped_at,
  winner_entry_id, drawn_at, winner_confirmed_at, winner_confirmation_message, winner_response_deadline, created_at`;
export const ENTRY_COLUMNS = `id, giveaway_session_id, provider, provider_user_id, username, avatar_url, message,
  badges, entered_at, eligibility_status, eligibility_reason`;
export const giveawayTransaction = (fn) => withTransaction((tx) => fn((sql, params = []) => tx.unsafe(sql, params)));

function randomIndex(max) {
  const values = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  do { crypto.getRandomValues(values); } while (values[0] >= limit);
  return values[0] % max;
}

/** Caller holds the session lock. All draw paths use this same eligible pool. */
export async function drawGiveaway(run, session, { automatic = false, expectedDrawnAt = null } = {}) {
  const rules = giveawayRules(session.rules);
  if (session.status === "cancelled") return { error: "This giveaway was cancelled." };
  if (automatic && (!rules.autoReroll || !rules.winnerMustRespond || session.winner_confirmed_at ||
      !session.winner_response_deadline || Date.parse(session.winner_response_deadline) > Date.now() ||
      (expectedDrawnAt && Date.parse(expectedDrawnAt) !== Date.parse(session.drawn_at)))) {
    return { unchanged: true };
  }
  const entries = await run(`SELECT e.*,
      EXISTS (SELECT 1 FROM chat_giveaway_draws d JOIN chat_giveaway_sessions gs ON gs.id=d.giveaway_session_id
        WHERE gs.site_id=$2 AND d.provider_user_id=e.provider_user_id) AS previous_winner,
      EXISTS (SELECT 1 FROM chat_giveaway_draws d WHERE d.giveaway_session_id=e.giveaway_session_id
        AND d.provider_user_id=e.provider_user_id) AS already_drawn,
      (SELECT vi.viewer_id FROM viewer_identities vi JOIN viewers v ON v.id=vi.viewer_id
        WHERE vi.provider='kick' AND vi.external_user_id=e.provider_user_id AND vi.status='active'
          AND vi.linked_at IS NOT NULL AND v.is_system=false LIMIT 1) AS linked_viewer_id
    FROM chat_giveaway_entries e WHERE e.giveaway_session_id=$1 ORDER BY entered_at`, [session.id, session.site_id]);
  const pool = entries.filter((entry) => !entry.already_drawn && entry.eligibility_status === "eligible" &&
    evaluateGiveawayEligibility({ badges: entry.badges, viewerId: entry.linked_viewer_id,
      kickLinked: !!entry.linked_viewer_id, previousWinner: entry.previous_winner,
      verified: !!entry.verified_at && entry.viewer_id === entry.linked_viewer_id,
      ipAvailable: !!entry.ip_hash }, rules).status === "eligible");
  if (!pool.length) {
    if (automatic) await run("UPDATE chat_giveaway_sessions SET winner_response_deadline=NULL WHERE id=$1", [session.id]);
    return { error: "No eligible entrants to draw from." };
  }
  const winner = pool[randomIndex(pool.length)];
  await run(`INSERT INTO chat_giveaway_draws (giveaway_session_id, entry_id, provider_user_id) VALUES ($1,$2,$3)`,
    [session.id, winner.id, winner.provider_user_id]);
  await run(`UPDATE chat_giveaway_sessions SET winner_entry_id=$2, drawn_at=now(), winner_confirmed_at=NULL,
    winner_confirmation_message=NULL, status='completed', stopped_at=COALESCE(stopped_at,now()),
    winner_response_deadline=CASE WHEN $3 THEN now()+make_interval(secs=>$4) ELSE NULL END WHERE id=$1`,
    [session.id, winner.id, rules.winnerMustRespond, rules.responseTimeout]);
  return { winnerId: winner.id };
}

/** Cron is a fallback when the dashboard is closed; open dashboards request at expiry. */
export async function runGiveawayTimeouts({ queryImpl = query, transaction = giveawayTransaction } = {}) {
  const due = await queryImpl(`SELECT id FROM chat_giveaway_sessions WHERE status='completed'
    AND winner_confirmed_at IS NULL AND winner_response_deadline <= now() AND rules->>'autoReroll'='true'
    ORDER BY winner_response_deadline LIMIT 100`);
  for (const row of due) await transaction(async (run) => {
    const [session] = await run(`SELECT ${SESSION_COLUMNS} FROM chat_giveaway_sessions WHERE id=$1 FOR UPDATE`, [row.id]);
    if (session) await drawGiveaway(run, session, { automatic: true });
  });
}
