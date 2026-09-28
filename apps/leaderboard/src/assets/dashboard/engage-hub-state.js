// Pure mapping from the Engage hub-card feature API payloads to card state.
// Consumed by assets/giveaways.js (bootEngageHub): the Giveaways card reports
// the chat giveaway and the Tournaments card the latest tournament; the
// Activities card stays static (no status source). The "none" copies mirror
// the server-rendered defaults in pages/giveaway-pages.js ENGAGE_FEATURES so
// a card reads identically before and after the client status pass.

const FEATURE_DEFAULTS = {
  chat: {
    label: "No active giveaway",
    meta: ["Create a giveaway to engage your viewers."],
    action: { label: "Create giveaway", variant: "accent" },
  },
  tournaments: {
    label: "No active tournament",
    meta: ["Set up a bracket for your community."],
    action: { label: "Create tournament", variant: "accent" },
  },
};

const openAction = (label) => ({ label, variant: "ghost" });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Map a feature payload to { tone, label, meta: string[], action }.
 * tone: "none" | "live" | "done" | "warn". Unknown feature or missing data →
 * the SSR "none" state; never throws.
 */
export function engageCardState(feature, payload = {}) {
  const defaults = FEATURE_DEFAULTS[feature];
  if (!defaults) return null;
  const none = { tone: "none", ...defaults };

  if (feature === "chat") {
    const session = payload?.session || null;
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    if (session && session.status === "active") {
      return {
        tone: "live",
        label: "Live giveaway",
        meta: [`Keyword ${session.keyword || ""} · ${plural(entries.length, "entry", "entries")}`],
        action: openAction("Open giveaway"),
      };
    }
    return none;
  }

  if (feature === "tournaments") {
    const tournaments = Array.isArray(payload?.tournaments) ? payload.tournaments : [];
    const latest = tournaments.find((t) => t.status !== "cancelled");
    if (!latest) return none;
    // Once a bracket exists the selected field is the participant set; before
    // selection the pending/confirmed/selected pool is the honest count.
    const bracketed = latest.status === "completed" || latest.status === "active";
    const participants = Number(bracketed ? latest.selected_count : latest.participant_count) || 0;
    const slots = Number(latest.bracket_size) || 0;
    const counts = `${plural(participants, "participant")} · ${plural(slots, "slot")}`;
    // Bracket lifecycle outranks registration lifecycle: an active bracket
    // keeps signup_state "locked", which must not shadow "Bracket in progress".
    if (latest.status === "completed") {
      return {
        tone: "done",
        label: "Completed",
        meta: [latest.title, counts],
        action: openAction("Open tournament"),
      };
    }
    if (latest.status === "active") {
      return {
        tone: "live",
        label: "Bracket in progress",
        meta: [latest.title, counts],
        action: openAction("Open tournament"),
      };
    }
    if (latest.signup_state === "open") {
      return {
        tone: "live",
        label: "Signups open",
        meta: [latest.title, counts],
        action: openAction("Open tournament"),
      };
    }
    if (latest.signup_state === "locked") {
      return {
        tone: "warn",
        label: "Signups locked",
        meta: [latest.title, counts],
        action: openAction("Open tournament"),
      };
    }
    return {
      tone: "warn",
      label: "Draft",
      meta: [latest.title],
      action: openAction("Open tournament"),
    };
  }

  return none;
}
