import { BYE, isBye } from "./tournament-bracket.js";

export const LIFECYCLE_LABELS = {
  setup: "Setup",
  live: "Live",
  finished: "Finished",
  cancelled: "Cancelled",
};

export function tournamentLifecycle(tournament, matchCount) {
  if (tournament?.status === "cancelled") return "cancelled";
  if (tournament?.status === "completed") return "finished";
  if (matchCount > 0) return "live";
  return "setup";
}

export function tournamentViewState({ tournament, counts, matchCount }) {
  const lifecycle = tournamentLifecycle(tournament, matchCount);
  const cap = tournament?.entry_cap;
  const active = counts?.active || 0;
  const eligible = counts?.eligible || 0;
  const full = cap != null && active >= cap;
  const waitlist = tournament?.waitlist_enabled === true;
  const open = tournament?.signup_state === "open";
  const channel = String(tournament?.chat_channel || "").trim();
  const keyword = tournament?.entry_keyword || "!join";
  const visible = lifecycle === "setup";

  return {
    lifecycle,
    status_label: LIFECYCLE_LABELS[lifecycle],
    start: lifecycle === "setup" ? {
      allowed: eligible >= 2,
      reason: eligible >= 2 ? null : "Add at least 2 players to start.",
      needs_selection: eligible > (tournament?.bracket_size || 0),
      confirm: eligible >= 2 && eligible < (tournament?.bracket_size || 0)
        ? `Start with ${eligible} players? Empty spots become BYEs.`
        : null,
    } : null,
    add_entry: {
      visible,
      enabled: visible && !(full && !waitlist),
      label: full && waitlist ? "Add to waitlist" : "Add",
      note: visible && full && !waitlist
        ? `Signups are full (${active}/${cap}). Raise the signup limit in Settings or turn on Allow waitlist.`
        : null,
      unavailable_reason: visible ? null : "Players can't be added after the tournament starts.",
    },
    chat_signup_text: !channel
      ? null
      : full && !waitlist
        ? `Full — signup limit reached (${active}/${cap})`
        : full
          ? "Full — new signups join the waitlist"
          : open
            ? `On — viewers type ${keyword} in chat`
            : "Off",
    delete_warning: lifecycle === "setup"
      ? "This deletes the tournament and all its entries. This can't be undone."
      : lifecycle === "live"
        ? "This tournament is live. Deleting it removes the bracket, all results, and entries. This can't be undone."
        : "This deletes the tournament, its bracket, and results. This can't be undone.",
  };
}

function compareEntryOrder(a, b) {
  return String(a.created_at || "").localeCompare(String(b.created_at || ""))
    || String(a.id || "").localeCompare(String(b.id || ""));
}

function isRealPlayer(name) {
  const value = String(name || "").trim();
  return Boolean(value) && value !== "TBD" && value !== BYE && !isBye(value);
}

export function entryViews(entries, { tournament, matches, lifecycle }) {
  const rows = entries || [];
  const waitlistPositions = new Map();
  rows.filter((entry) => entry.status === "waitlist")
    .slice()
    .sort(compareEntryOrder)
    .forEach((entry, index) => waitlistPositions.set(entry.id, index + 1));

  const eligibleRanks = new Map();
  rows.filter((entry) => entry.eligible === true)
    .slice()
    .sort(compareEntryOrder)
    .forEach((entry, index) => eligibleRanks.set(entry.id, index + 1));

  const eliminated = new Set();
  for (const match of matches || []) {
    if (match.status !== "completed"
        || !isRealPlayer(match.player1_name)
        || !isRealPlayer(match.player2_name)
        || ![match.player1_name, match.player2_name].includes(match.winner_name)) continue;
    eliminated.add(match.winner_name === match.player1_name ? match.player2_name : match.player1_name);
  }

  const terminal = lifecycle === "finished" || lifecycle === "cancelled";
  return rows.map((entry) => {
    let statusLabel = "Registered";
    let statusTone = "registered";
    if (entry.status === "waitlist") {
      statusLabel = `Waitlist #${waitlistPositions.get(entry.id)}`;
      statusTone = "waitlist";
    } else if (entry.status === "selected" && lifecycle === "finished"
        && entry.display_name === tournament?.winner_name) {
      statusLabel = "Champion";
      statusTone = "champion";
    } else if (entry.status === "selected" && eliminated.has(entry.display_name)) {
      statusLabel = "Eliminated";
      statusTone = "eliminated";
    } else if (entry.status === "selected") {
      statusLabel = "In bracket";
      statusTone = "in-bracket";
    } else if (entry.status === "removed") {
      statusLabel = "Removed";
      statusTone = "removed";
    } else if (entry.status === "blocked") {
      statusLabel = "Blocked";
      statusTone = "blocked";
    }

    const actions = terminal
      ? []
      : entry.status === "blocked"
        ? ["restore", "remove"]
        : entry.status === "removed"
          ? ["restore"]
          : ["remove", "block"];

    return {
      ...entry,
      status_label: statusLabel,
      status_tone: statusTone,
      actions,
      inactive: entry.status === "removed" || entry.status === "blocked",
      eligible_rank: eligibleRanks.get(entry.id) ?? null,
    };
  });
}
