import { withTransaction, query } from "@yourrank/shared/db";
import { giveawayRules, evaluateGiveawayEligibility } from "@yourrank/shared/giveaway-eligibility";

export const SESSION_COLUMNS = `id, site_id, provider, keyword, rules, status, started_at, stopped_at,
  winner_entry_id, drawn_at, winner_confirmed_at, winner_confirmation_message,
  winner_finalized_at, winner_finalized_by,
  winner_response_required, winner_response_timeout_seconds, winner_response_deadline,
  auto_reroll_exhausted_at, created_at`;
export const ENTRY_COLUMNS = `id, giveaway_session_id, provider, provider_user_id, username, avatar_url, message,
  badges, entered_at, eligibility_status, eligibility_reason`;
export const giveawayTransaction = (fn) => withTransaction((tx) => fn((sql, params = []) => tx.unsafe(sql, params)));

export const DRAW_CHANGED_ERROR = "The giveaway draw changed. Refresh the current draw before drawing again.";
export const DRAW_FINALIZED_ERROR = "This winner is already confirmed and cannot be re-rolled.";
export const NO_OTHER_ENTRANTS_ERROR = "No other eligible entrants remain.";

function randomIndex(max) {
  const values = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  do { crypto.getRandomValues(values); } while (values[0] >= limit);
  return values[0] % max;
}

const sameInstant = (a, b) => new Date(a).getTime() === new Date(b).getTime();

/**
 * Caller holds the session row lock (SELECT ... FOR UPDATE). All draw paths use
 * this same eligible pool. Manual draws are a compare-and-swap on the draw
 * identity the client saw: an initial draw requires no winner yet; a re-roll
 * requires the exact winner + drawn_at (millisecond precision, since it
 * round-trips through JSON) and an unfinalized draw. The response rule for the
 * draw comes from the rules persisted at start, never from the request.
 */
export async function drawGiveaway(run, session, { automatic = false, expectedWinnerEntryId = null, expectedDrawnAt = null } = {}) {
  const rules = giveawayRules(session.rules);
  if (session.status === "cancelled") return { error: "This giveaway was cancelled." };
  if (automatic) {
    if (!rules.autoReroll || !rules.winnerMustRespond || session.winner_confirmed_at || session.winner_finalized_at ||
        !session.winner_response_deadline || Date.parse(session.winner_response_deadline) > Date.now() ||
        (expectedWinnerEntryId != null && expectedWinnerEntryId !== session.winner_entry_id) ||
        (expectedDrawnAt && !sameInstant(expectedDrawnAt, session.drawn_at))) {
      return { unchanged: true };
    }
  } else if (expectedWinnerEntryId == null) {
    if (session.winner_entry_id) return { conflict: true, error: DRAW_CHANGED_ERROR };
  } else {
    if (session.winner_finalized_at) return { conflict: true, error: DRAW_FINALIZED_ERROR };
    if (session.winner_entry_id !== expectedWinnerEntryId || !sameInstant(expectedDrawnAt, session.drawn_at)) {
      return { conflict: true, error: DRAW_CHANGED_ERROR };
    }
  }
  const entries = await run(`SELECT e.*,
      EXISTS (SELECT 1 FROM chat_giveaway_draws d JOIN chat_giveaway_sessions gs ON gs.id=d.giveaway_session_id
        WHERE gs.site_id=$2 AND d.provider_user_id=e.provider_user_id) AS previous_winner,
      EXISTS (SELECT 1 FROM chat_giveaway_draws d WHERE d.giveaway_session_id=e.giveaway_session_id
        AND d.provider_user_id=e.provider_user_id) AS already_drawn,
      (SELECT vi.viewer_id FROM viewer_identities vi JOIN viewers v ON v.id=vi.viewer_id
        WHERE vi.provider='kick' AND vi.external_user_id=e.provider_user_id AND vi.status='active'
          AND vi.linked_at IS NOT NULL AND v.is_system=false LIMIT 1) AS linked_viewer_id,
      EXISTS (SELECT 1 FROM account_links al
        JOIN viewers lv ON lv.id IN (al.viewer_a, al.viewer_b)
        JOIN viewer_identities vi ON vi.viewer_id = lv.id AND vi.provider='kick' AND vi.status='active'
          AND vi.linked_at IS NOT NULL AND vi.external_user_id = e.provider_user_id
        JOIN viewers x ON x.id = vi.viewer_id AND x.is_system = false
       WHERE al.site_id=$2 AND al.status='restricted') AS linked_restricted
    FROM chat_giveaway_entries e WHERE e.giveaway_session_id=$1 ORDER BY entered_at`, [session.id, session.site_id]);
  const eligible = entries.filter((entry) => entry.eligibility_status === "eligible" &&
    evaluateGiveawayEligibility({ badges: entry.badges, viewerId: entry.linked_viewer_id,
      kickLinked: !!entry.linked_viewer_id, previousWinner: entry.previous_winner,
      linkedRestricted: !!entry.linked_restricted,
      verified: !!entry.verified_at && entry.viewer_id === entry.linked_viewer_id,
      ipAvailable: !!entry.ip_hash }, rules).status === "eligible");
  const pool = rules.winnerRepeat === "again" ? eligible : eligible.filter((entry) => !entry.already_drawn);
  if (!pool.length) {
    if (automatic) {
      // Persist that auto re-roll stopped here: the deadline is disarmed so the
      // sweep won't retry forever, and the flag lets the dashboard tell the
      // streamer why the giveaway is waiting instead of failing silently.
      const [row] = await run(`UPDATE chat_giveaway_sessions
        SET winner_response_deadline=NULL, auto_reroll_exhausted_at=now()
        WHERE id=$1 RETURNING ${SESSION_COLUMNS}`, [session.id]);
      return { error: eligible.length ? NO_OTHER_ENTRANTS_ERROR : "No eligible entrants to draw from.", exhausted: true, session: row };
    }
    return { error: eligible.length ? NO_OTHER_ENTRANTS_ERROR : "No eligible entrants to draw from." };
  }
  const winner = pool[randomIndex(pool.length)];
  // drawn_at strictly advances even within one transaction so every draw has a
  // distinct identity; the deadline is derived from that same instant so the
  // persisted window and winner_response_deadline can never disagree. A
  // manually-added winner has no chat identity to respond with, so the
  // response requirement is never armed for them.
  const responseRequired = rules.winnerMustRespond && winner.provider !== "manual";
  const responseTimeoutSeconds = responseRequired ? rules.responseTimeout : null;
  const cas = expectedWinnerEntryId == null && !automatic
    ? "AND s.winner_entry_id IS NULL"
    : "AND s.winner_entry_id = $6 AND date_trunc('milliseconds', s.drawn_at) = date_trunc('milliseconds', $7::timestamptz)";
  const params = [session.id, winner.id, session.site_id, responseRequired, responseTimeoutSeconds];
  if (expectedWinnerEntryId != null || automatic) params.push(session.winner_entry_id, session.drawn_at);
  const updated = await run(`WITH stamp AS (
      SELECT GREATEST(clock_timestamp(), drawn_at + interval '1 millisecond') AS new_drawn_at
        FROM chat_giveaway_sessions WHERE id = $1
    )
    UPDATE chat_giveaway_sessions s
       SET winner_entry_id = $2, drawn_at = stamp.new_drawn_at,
           winner_confirmed_at = NULL, winner_confirmation_message = NULL,
           winner_finalized_at = NULL, winner_finalized_by = NULL,
           winner_response_required = $4::boolean, winner_response_timeout_seconds = $5::int,
           winner_response_deadline = CASE WHEN $4::boolean THEN stamp.new_drawn_at + make_interval(secs => $5::int) ELSE NULL END,
           auto_reroll_exhausted_at = NULL,
           status = 'completed', stopped_at = COALESCE(s.stopped_at, now())
      FROM stamp
     WHERE s.id = $1 AND s.site_id = $3 AND s.winner_finalized_at IS NULL ${cas}
    RETURNING ${SESSION_COLUMNS}`, params);
  if (!updated.length) return { conflict: true, error: DRAW_CHANGED_ERROR };
  // The history row lands only after the CAS commits the draw itself, so a
  // racing draw never leaves a phantom entry in history.
  await run(`INSERT INTO chat_giveaway_draws (giveaway_session_id, entry_id, provider_user_id, reason, replaced_entry_id)
    VALUES ($1,$2,$3,$4,$5)`,
    [session.id, winner.id, winner.provider_user_id,
     automatic ? "auto_reroll" : expectedWinnerEntryId != null ? "reroll" : "draw",
     session.winner_entry_id]);
  return { winnerId: winner.id, session: updated[0] };
}

/** Cron is a fallback when the dashboard is closed; open dashboards request at expiry. */
export async function runGiveawayTimeouts({ queryImpl = query, transaction = giveawayTransaction } = {}) {
  const due = await queryImpl(`SELECT id FROM chat_giveaway_sessions WHERE status='completed'
    AND winner_confirmed_at IS NULL AND winner_finalized_at IS NULL
    AND winner_response_deadline <= now() AND rules->>'autoReroll'='true'
    ORDER BY winner_response_deadline LIMIT 100`);
  const counts = { rerolled: 0, exhausted: 0, failed: 0 };
  for (const row of due) {
    try {
      const result = await transaction(async (run) => {
        const [session] = await run(`SELECT ${SESSION_COLUMNS} FROM chat_giveaway_sessions WHERE id=$1 FOR UPDATE`, [row.id]);
        return session ? drawGiveaway(run, session, { automatic: true }) : { unchanged: true };
      });
      if (result?.exhausted) {
        counts.exhausted += 1;
        console.warn(`[giveaway-timeouts] auto re-roll stopped for session ${row.id}: ${result.error}`);
      } else if (result?.error) {
        console.warn(`[giveaway-timeouts] session ${row.id} draw failed: ${result.error}`);
      } else if (!result?.unchanged) {
        counts.rerolled += 1;
      }
    } catch (err) {
      counts.failed += 1;
      console.error(`[giveaway-timeouts] session ${row.id} failed:`, String(err?.message || err));
    }
  }
  return counts;
}
