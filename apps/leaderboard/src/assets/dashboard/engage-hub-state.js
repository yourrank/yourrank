// Pure mapping from feature API payloads to an Engage overview row state.
// Consumed by assets/giveaways.js (bootEngageHub). Three destinations:
//   activities  ← GET /api/activities?state=open      (total open drops)
//   giveaways   ← chat session
//   tournaments ← GET /api/tournaments                 (latest lifecycle)
// The "none" copies mirror the server-rendered defaults in
// pages/giveaway-pages.js ENGAGE_FEATURES so a row reads identically before
// and after the client status pass.

export const ENGAGE_IDLE = Object.freeze({
  activities: { label: "No active drops", meta: "Launch a code drop to hand out free credits." },
  giveaways: { label: "Nothing running", meta: "Start a chat giveaway." },
  tournaments: { label: "No tournament", meta: "Set up a bracket for your community." },
});

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const idle = (feature) => ({ tone: "neutral", status: "idle", ...ENGAGE_IDLE[feature] });

/**
 * { tone, status, label, meta }.
 * tone: "neutral" | "success" | "warning" | "info"; status is a machine key.
 * Unknown feature → null; missing data → the idle state (giveaways with an
 * unavailable source → null so the caller reports a load failure); never throws.
 */
export function engageCardState(feature, payload = {}) {
  if (!Object.hasOwn(ENGAGE_IDLE, feature)) return null;

  if (feature === "activities") {
    const rows = Array.isArray(payload?.activities) ? payload.activities : [];
    const open = Number.isFinite(Number(payload?.total)) ? Number(payload.total) : rows.length;
    if (open <= 0) return idle(feature);
    const claimed = rows.reduce((sum, row) => sum + (Number(row?.progress?.claimed) || 0), 0);
    const capacity = rows.reduce((sum, row) => sum + (Number(row?.progress?.capacity) || 0), 0);
    return {
      tone: "success",
      status: "live",
      label: plural(open, "active drop"),
      meta: capacity ? `${claimed.toLocaleString()} of ${capacity.toLocaleString()} claims taken` : "Claims are open.",
    };
  }

  if (feature === "giveaways") return giveawaysState(payload);

  if (feature === "tournaments") {
    const tournaments = Array.isArray(payload?.tournaments) ? payload.tournaments : [];
    const latest = tournaments.find((t) => t.status !== "cancelled");
    if (!latest) return idle(feature);
    // Once a bracket exists the selected field is the participant set; before
    // selection the pending/confirmed/selected pool is the honest count.
    const bracketed = latest.status === "completed" || latest.status === "active";
    const participants = Number(bracketed ? latest.selected_count : latest.participant_count) || 0;
    const slots = Number(latest.bracket_size) || 0;
    const counts = `${plural(participants, "participant")} · ${plural(slots, "slot")}`;
    const meta = `${latest.title || "Tournament"} · ${counts}`;
    // Bracket lifecycle outranks registration lifecycle: an active bracket
    // keeps signup_state "locked", which must not shadow "Bracket in progress".
    if (latest.status === "completed") return { tone: "neutral", status: "completed", label: "Completed", meta };
    if (latest.status === "active") return { tone: "success", status: "active", label: "Bracket in progress", meta };
    if (latest.signup_state === "open") return { tone: "success", status: "signups_open", label: "Signups open", meta };
    if (latest.signup_state === "locked") return { tone: "warning", status: "signups_locked", label: "Signups locked", meta };
    return { tone: "info", status: "draft", label: "Draft", meta: latest.title || "Tournament" };
  }

  return idle(feature);
}

/**
 * Summarize the chat giveaway session. An unavailable source is reported as
 * unknown rather than treated as inactive.
 */
function giveawaysState({ chat } = {}) {
  if (chat === undefined) return null;
  if (chat?.session?.status !== "active") return idle("giveaways");
  const entries = Array.isArray(chat.entries) ? chat.entries.length : 0;
  return {
    tone: "success",
    status: "live",
    label: "1 running",
    meta: `Chat giveaway live · ${plural(entries, "entry", "entries")}`,
  };
}
