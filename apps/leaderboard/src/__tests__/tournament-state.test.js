import { describe, expect, it } from "bun:test";
import {
  entryViews,
  LIFECYCLE_LABELS,
  tournamentLifecycle,
  tournamentViewState,
} from "../lib/tournament-state.js";
import { BYE } from "../lib/tournament-bracket.js";

describe("tournamentLifecycle", () => {
  it("prioritizes terminal status before match count", () => {
    expect(tournamentLifecycle({ status: "cancelled" }, 4)).toBe("cancelled");
    expect(tournamentLifecycle({ status: "completed" }, 4)).toBe("finished");
    expect(tournamentLifecycle({ status: "active" }, 1)).toBe("live");
    expect(tournamentLifecycle({ status: "draft" }, 0)).toBe("setup");
    expect(LIFECYCLE_LABELS).toEqual({
      setup: "Setup",
      live: "Live",
      finished: "Finished",
      cancelled: "Cancelled",
    });
  });
});

describe("tournamentViewState", () => {
  const base = {
    status: "draft",
    bracket_size: 8,
    entry_cap: 8,
    signup_state: "open",
    chat_channel: "  channel  ",
    entry_keyword: "!enter",
    waitlist_enabled: false,
  };

  it("returns start, add-entry, chat, and delete state for setup", () => {
    expect(tournamentViewState({
      tournament: base,
      counts: { active: 3, eligible: 3 },
      matchCount: 0,
    })).toEqual({
      lifecycle: "setup",
      status_label: "Setup",
      start: {
        allowed: true,
        reason: null,
        needs_selection: false,
        confirm: "Start with 3 players? Empty spots become BYEs.",
      },
      add_entry: {
        visible: true,
        enabled: true,
        label: "Add",
        note: null,
        unavailable_reason: null,
      },
      chat_signup_text: "On — viewers type !enter in chat",
      delete_warning: "This deletes the tournament and all its entries. This can't be undone.",
    });
  });

  it("reports a full signup cap and selection requirements", () => {
    const state = tournamentViewState({
      tournament: { ...base, bracket_size: 4, entry_cap: 6, waitlist_enabled: true },
      counts: { active: 6, eligible: 5 },
      matchCount: 0,
    });
    expect(state.start.needs_selection).toBe(true);
    expect(state.start.confirm).toBeNull();
    expect(state.add_entry).toEqual({
      visible: true,
      enabled: true,
      label: "Add to waitlist",
      note: null,
      unavailable_reason: null,
    });
    expect(state.chat_signup_text).toBe("Full — new signups join the waitlist");

    const full = tournamentViewState({
      tournament: { ...base, entry_cap: 3 },
      counts: { active: 3, eligible: 1 },
      matchCount: 0,
    });
    expect(full.start).toEqual({
      allowed: false,
      reason: "Add at least 2 players to start.",
      needs_selection: false,
      confirm: null,
    });
    expect(full.add_entry.enabled).toBe(false);
    expect(full.add_entry.note).toBe("Signups are full (3/3). Raise the signup limit in Settings or turn on Allow waitlist.");
    expect(full.chat_signup_text).toBe("Full — signup limit reached (3/3)");
  });

  it("uses lifecycle-specific unavailable, signup, and delete copy", () => {
    const live = tournamentViewState({
      tournament: { ...base, status: "active", signup_state: "closed" },
      counts: { active: 2, eligible: 0 },
      matchCount: 1,
    });
    expect(live.lifecycle).toBe("live");
    expect(live.add_entry).toEqual({
      visible: false,
      enabled: false,
      label: "Add",
      note: null,
      unavailable_reason: "Players can't be added after the tournament starts.",
    });
    expect(live.chat_signup_text).toBe("Off");
    expect(live.delete_warning).toBe("This tournament is live. Deleting it removes the bracket, all results, and entries. This can't be undone.");
    expect(tournamentViewState({
      tournament: { ...base, status: "completed" },
      counts: {},
      matchCount: 7,
    }).delete_warning).toBe("This deletes the tournament, its bracket, and results. This can't be undone.");
    expect(tournamentViewState({
      tournament: { ...base, status: "cancelled", chat_channel: " " },
      counts: {},
      matchCount: 0,
    }).chat_signup_text).toBeNull();
  });
});

describe("entryViews", () => {
  const tournament = { winner_name: "Alice" };
  const entries = [
    { id: "eligible-b", display_name: "Bob", status: "selected", eligible: true, created_at: "2026-01-02" },
    { id: "eligible-a", display_name: "Alice", status: "selected", eligible: true, created_at: "2026-01-01" },
    { id: "wait-b", display_name: "Wait B", status: "waitlist", created_at: "2026-01-02" },
    { id: "wait-a", display_name: "Wait A", status: "waitlist", created_at: "2026-01-01" },
    { id: "removed", display_name: "Removed", status: "removed" },
    { id: "blocked", display_name: "Blocked", status: "blocked" },
  ];

  it("labels waitlist, champion, eliminated, and inactive entries with permitted actions", () => {
    const views = entryViews(entries, {
      tournament,
      lifecycle: "finished",
      matches: [
        { status: "completed", player1_name: "Alice", player2_name: "Bob", winner_name: "Alice" },
        { status: "completed", player1_name: "TBD", player2_name: "Removed", winner_name: "TBD" },
        { status: "pending", player1_name: "Wait A", player2_name: BYE, winner_name: null },
      ],
    });
    const byId = Object.fromEntries(views.map((entry) => [entry.id, entry]));
    expect(byId["wait-a"].status_label).toBe("Waitlist #1");
    expect(byId["wait-b"].status_label).toBe("Waitlist #2");
    expect(byId["wait-a"].status_tone).toBe("waitlist");
    expect(byId["eligible-a"].status_label).toBe("Champion");
    expect(byId["eligible-a"].status_tone).toBe("champion");
    expect(byId["eligible-b"].status_label).toBe("Eliminated");
    expect(byId["eligible-b"].status_tone).toBe("eliminated");
    expect(byId.removed).toMatchObject({ status_label: "Removed", inactive: true, actions: [] });
    expect(byId.blocked).toMatchObject({ status_label: "Blocked", inactive: true, actions: [] });
    expect(byId["eligible-a"].eligible_rank).toBe(1);
    expect(byId["eligible-b"].eligible_rank).toBe(2);
  });

  it("allows restore and remove actions while nonterminal", () => {
    const byId = Object.fromEntries(entryViews([
      entries.find((entry) => entry.id === "eligible-b"),
      entries.find((entry) => entry.id === "removed"),
      entries.find((entry) => entry.id === "blocked"),
    ], {
      tournament,
      lifecycle: "live",
      matches: [],
    }).map((entry) => [entry.id, entry]));
    expect(byId["eligible-b"].actions).toEqual(["remove", "block"]);
    expect(byId.removed.actions).toEqual(["restore"]);
    expect(byId.blocked.actions).toEqual(["restore", "remove"]);
  });
});
