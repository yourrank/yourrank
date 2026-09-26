// Pure mapping from the four Engage feature API payloads to hub-card state.
// Consumed by assets/giveaways.js (bootEngageHub); the "none" copies mirror the
// server-rendered defaults in pages/giveaway-pages.js ENGAGE_FEATURES so a card
// reads identically before and after the client status pass.

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
  raffles: {
    label: "No active raffle",
    meta: ["Set up a raffle to reward your community."],
    action: { label: "Create raffle", variant: "accent" },
  },
  preds: {
    label: "No active prediction",
    meta: ["Create a prediction to get your community involved."],
    action: { label: "Create prediction", variant: "accent" },
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

  if (feature === "raffles") {
    const raffles = Array.isArray(payload?.raffles) ? payload.raffles : [];
    const active = raffles.find((r) => r.status === "active");
    if (active) {
      return {
        tone: "live",
        label: "Raffle open",
        meta: [`${active.title} · ${plural(Number(active.total_tickets) || 0, "ticket")}`],
        action: openAction("Open raffle"),
      };
    }
    return none;
  }

  if (feature === "preds") {
    const predictions = Array.isArray(payload?.predictions) ? payload.predictions : [];
    const open = predictions.find((p) => p.status === "open");
    if (open) {
      return {
        tone: "live",
        label: "Prediction open",
        meta: [open.title],
        action: openAction("Open prediction"),
      };
    }
    const locked = predictions.find((p) => p.status === "locked");
    if (locked) {
      return {
        tone: "warn",
        label: "Awaiting result",
        meta: [locked.title],
        action: openAction("Open prediction"),
      };
    }
    return none;
  }

  if (feature === "tournaments") {
    const tournaments = Array.isArray(payload?.tournaments) ? payload.tournaments : [];
    const latest = tournaments.find((t) => t.status !== "cancelled");
    if (!latest) return none;
    const participants = Number(latest.participant_count) || 0;
    const slots = Number(latest.bracket_size) || 0;
    const counts = `${plural(participants, "participant")} · ${plural(slots, "slot")}`;
    if (latest.status === "completed") {
      return {
        tone: "done",
        label: "Completed",
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
    if (latest.status === "active") {
      return {
        tone: "live",
        label: "Bracket in progress",
        meta: [latest.title, counts],
        action: openAction("Open tournament"),
      };
    }
    if (latest.status === "draft") {
      return {
        tone: "warn",
        label: "Draft",
        meta: [latest.title],
        action: openAction("Open tournament"),
      };
    }
    return none;
  }

  return none;
}
