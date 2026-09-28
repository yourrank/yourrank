// Pure view-layer tests: buildViewModel + the HTML builders in
// assets/tournament-view.js. No DOM, no fetch — the controller owns those.
// Run: bun test src/__tests__/tournament-view.test.js
import { describe, expect, it } from "bun:test";
import { buildBracket } from "../lib/tournament-bracket.js";
import {
  buildViewModel,
  workspaceHtml,
  emptyStateHtml,
  createDialogHtml,
  selectDialogHtml,
  selectListHtml,
  fullBracketDialogHtml,
  formatCreated,
} from "../assets/tournament-view.js";

const base = {
  id: "t-1", title: "Community Cup", game_name: "Fortnite", bracket_size: 8,
  entry_cap: null, entry_keyword: "!join", chat_channel: "chan",
  signup_state: "open", status: "active", anti_alt_enabled: true, winner_name: null,
  created_at: "2026-09-20T10:00:00Z",
};
const tournament = (over = {}) => ({ ...base, ...over });
const entries = [
  { id: "e1", display_name: "alpha", source: "chat", status: "confirmed", alt_flag: false },
  { id: "e2", display_name: "beta", source: "page", status: "selected", alt_flag: true, alt_reason: "Possible duplicate account." },
  { id: "e3", display_name: "gamma", source: "manual", status: "removed", alt_flag: false },
];
const counts = { active: 2, eligible: 2, waitlist: 0, removed: 1, blocked: 0 };
const vm = (over = {}) => buildViewModel({
  tournament: tournament(over.tournament || {}),
  entries: over.entries ?? entries,
  entryCounts: over.entryCounts ?? counts,
  matches: over.matches ?? [],
  lifecycle: over.lifecycle ?? "signups_open",
  chatRegistration: over.chatRegistration ?? null,
  board: over.board ?? {},
  activeTab: over.activeTab ?? "entries",
  tournamentsEnabled: over.tournamentsEnabled ?? true,
});

describe("buildViewModel", () => {
  it("derives status/meta/stats from data only", () => {
    const model = vm({ lifecycle: "draft", tournament: { game_name: "", status: "draft", signup_state: "closed" } });
    expect(model.statusLabel).toBe("Draft");
    expect(model.meta).toBe("8-player bracket · Single elimination");
    expect(model.meta).not.toContain("Fortnite");
    const [entriesStat, spots, keyword, cap] = model.stats;
    expect(entriesStat.value).toBe("2"); // active entries only (removed excluded)
    expect(spots.value).toBe("8");
    expect(keyword.value).toBe("!join");
    expect(cap.value).toBe("Unlimited");
  });

  it("computes the chat-registration state once for form + view", () => {
    expect(vm({ lifecycle: "signups_open" }).chatReg).toBe("Unavailable");
    expect(vm({ lifecycle: "draft", tournament: { signup_state: "closed" } }).chatReg).toBe("Off");
    expect(vm({ lifecycle: "signups_open", chatRegistration: { connected: true, chatReady: true, channelName: "chan" } }).chatReg).toBe("Active");
    expect(vm({ lifecycle: "signups_open", chatRegistration: { connected: true, chatReady: true, channelName: "other" } }).chatReg).toBe("Unavailable");
  });

  it("maps lifecycle to primary action and secondary buttons", () => {
    const draft = vm({
      lifecycle: "draft",
      tournament: { signup_state: "closed", chat_channel: "" },
      entries: [entries[0]],
      board: { kickChannelName: "mychan" },
    });
    expect(draft.primary).toEqual({ action: "use-site-channel", label: "Use mychan" });
    expect(draft.stepHtml).toContain("add players manually below");
    const connected = vm({
      lifecycle: "draft",
      tournament: { signup_state: "closed", chat_channel: "" },
      entries: [entries[0]],
      board: { kickChannelName: "mychan" },
      chatRegistration: { connected: true, channelName: "connected" },
    });
    expect(connected.siteChannel).toBe("connected");
    expect(connected.primary).toEqual({ action: "use-site-channel", label: "Use connected" });
    const populatedDraft = vm({
      lifecycle: "draft",
      tournament: { signup_state: "closed", chat_channel: "" },
    });
    expect(populatedDraft.primary).toEqual({ action: "lock", label: "Close entries" });
    expect(populatedDraft.stepHtml).toBe("Add players below, or connect Kick to collect entries from chat.");
    const open = vm({ lifecycle: "signups_open" });
    expect(open.primary).toEqual({ action: "lock", label: "Lock signups" });
    const locked = vm({ lifecycle: "signups_locked", entryCounts: { ...counts, eligible: 5 } });
    expect(locked.primary).toEqual({ action: "create-bracket", label: "Create bracket with 5 players" });
    expect(locked.reopen).toBe(true);
    const crowded = vm({ lifecycle: "signups_locked", entryCounts: { ...counts, eligible: 12 } });
    expect(crowded.primary).toEqual({ action: "select-participants", label: "Select participants" });
    const done = vm({ lifecycle: "completed", tournament: { status: "completed", winner_name: "alpha" } });
    expect(done.primary).toBeNull();
    expect(done.showNew).toBe(true);
    expect(done.finished).toBe(true);
    expect(done.stepHtml).toContain("Champion: alpha");
    const cancelled = vm({ lifecycle: "cancelled", tournament: { status: "cancelled" } });
    expect(cancelled.finished).toBe(true);
    expect(cancelled.statusLabel).toBe("Cancelled");
  });

  it("labels entries and keeps review flags data-driven", () => {
    const model = vm({});
    expect(model.entriesVm).toHaveLength(3);
    expect(model.entriesVm[1].statusLabel).toBe("Picked");
    expect(model.entriesVm[1].flagged).toBe(true);
    expect(model.entriesVm[0].flagged).toBe(false);
    expect(model.entriesVm[0].sourceLabel).toBe("Chat");
    expect(model.entriesVm[1].sourceLabel).toBe("Signup page");
  });
});

describe("workspaceHtml", () => {
  it("emits the behavior ids and no old classes", () => {
    const model = vm({ lifecycle: "completed", tournament: { status: "completed", winner_name: "alpha" } });
    const html = workspaceHtml(model, "<div class=\"tn-bracket\"></div>");
    for (const id of [
      "tournament-workspace", "tournament-title-display", "tournament-status", "tournament-meta",
      "tournament-step-label", "tournament-primary", "tournament-reopen", "tournament-new",
      "tournament-count", "tournament-fact-spots", "tournament-fact-keyword", "tournament-fact-cap",
      "tournament-tab-entries", "tournament-tab-bracket", "tournament-tab-settings",
      "tournament-panel-entries", "tournament-panel-bracket", "tournament-panel-settings",
      "tournament-entry-list", "tournament-bracket", "tournament-bracket-expand",
      "tournament-summary", "tournament-champion", "tournament-settings-view",
      "tournament-settings-form", "tournament-settings-aside", "tournament-message",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).not.toMatch(/class="[^"]*\b(?:tournament|tourn)-/);
    // Completed: champion shown, settings view visible, form hidden.
    expect(html).toContain("Champion: alpha");
    expect(html).toContain('id="tournament-settings-view"');
    expect(html).toContain('<form id="tournament-settings-form" class="tn-form" novalidate hidden');
  });

  it("hides entry menus when finished and shows them while active", () => {
    const done = workspaceHtml(vm({ lifecycle: "completed", tournament: { status: "completed" } }));
    expect(done).not.toContain("tn-menu");
    const open = workspaceHtml(vm({}));
    expect(open.match(/class="tn-menu"/g)).toHaveLength(3);
    expect(open).toContain('data-entry-action="remove"');
    expect(open).toContain('data-entry-action="block"');
    expect(open).toContain('data-entry-action="restore"');
  });

  it("shows the bracket empty state until matches exist", () => {
    const html = workspaceHtml(vm({ lifecycle: "signups_open" }));
    expect(html).toContain('id="tournament-bracket-empty"');
    expect(html).toContain("Bracket not created yet.");
    const live = workspaceHtml(vm({ lifecycle: "bracket", matches: buildBracket(["a", "b"], 4) }), "<div class=\"tn-bracket\"></div>");
    expect(live).not.toContain('id="tournament-bracket-empty"');
  });

  it("adds players for draft, open and locked signups only", () => {
    for (const lifecycle of ["draft", "signups_open", "signups_locked"]) {
      const html = workspaceHtml(vm({
        lifecycle,
        tournament: { signup_state: lifecycle === "draft" ? "closed" : "open", chat_channel: "" },
      }));
      expect(html).toContain('id="tournament-add-entry-form"');
      expect(html).toContain('id="tournament-add-entry-name"');
      expect(html).toContain('maxlength="80"');
    }
    for (const lifecycle of ["bracket", "completed", "cancelled"]) {
      const html = workspaceHtml(vm({ lifecycle, tournament: { status: lifecycle } }));
      expect(html).not.toContain('id="tournament-add-entry-form"');
    }
  });

  it("uses the manual-first draft empty-state copy", () => {
    const html = workspaceHtml(vm({
      lifecycle: "draft",
      tournament: { signup_state: "closed", chat_channel: "" },
      entries: [],
    }));
    expect(html).toContain("<b>No entries yet.</b><span>Add players below, or open signups to collect them from Kick chat.</span>");
  });

  it("renders the read-only settings sections for finished tournaments", () => {
    const html = workspaceHtml(vm({ lifecycle: "completed", tournament: { status: "completed" } }));
    const view = html.slice(html.indexOf('id="tournament-settings-view"'));
    for (const section of ["General", "Registration", "Rules"]) expect(view).toContain(section);
    expect(view).toContain("No rules added yet.");
    expect(view).toContain("Kick channel");
    expect(view).toContain("Signup limit");
    // read-only view must not render disabled inputs
    const viewOnly = view.slice(0, view.indexOf("<form"));
    expect(viewOnly).not.toContain("<input");
  });

  it("keeps every summary aside label to one row", () => {
    const html = workspaceHtml(vm({ lifecycle: "completed", tournament: { status: "completed", winner_name: "alpha" } }), "<div class=\"tn-bracket\"></div>");
    const aside = html.slice(html.indexOf('id="tournament-summary"'), html.indexOf('id="tournament-champion"'));
    for (const label of ["Entries", "Bracket size", "Matches played", "Status", "Game", "Bracket type", "Created", "Tournament ID"]) {
      expect(aside.split(label).length - 1).toBe(1);
    }
    // Settings Details covers its own set without repeating General's rows.
    const details = html.slice(html.indexOf('id="tournament-settings-aside"'));
    for (const label of ["Created", "Tournament ID", "Entries", "Matches played"]) {
      expect(details).toContain(label);
    }
  });

  it("marks only the active tab/panel", () => {
    const html = workspaceHtml(vm({ activeTab: "bracket" }));
    expect(html).toContain('id="tournament-tab-bracket" type="button" role="tab" aria-selected="true"');
    expect(html).toContain('id="tournament-panel-entries" role="tabpanel" aria-labelledby="tournament-tab-entries" hidden');
    expect(html).toContain('id="tournament-panel-bracket" role="tabpanel" aria-labelledby="tournament-tab-bracket"');
  });
});

describe("empty + dialog markup", () => {
  it("empty state keeps the page heading and create hook", () => {
    const html = emptyStateHtml();
    expect(html).toContain('id="tournament-empty"');
    expect(html).toContain('id="tournament-create"');
    expect(html).toContain('id="tournament-workspace" hidden');
    expect(html).toContain("Run a tournament for your community.");
    expect(html).not.toContain('data-plan-lock="tournaments"');
  });

  it("empty state locks creation with a described shared plan card", () => {
    const html = emptyStateHtml({ locked: true });
    expect(html).toContain('id="tournament-create"');
    expect(html).toContain('id="tournament-create" type="button" disabled aria-describedby="tournament-plan-lock"');
    expect(html).toContain('id="tournament-plan-lock"');
    expect(html).toContain('data-plan-lock="tournaments"');
  });

  it("create dialog exposes every behavior hook", () => {
    const html = createDialogHtml({ siteChannel: "sitechan" });
    for (const id of ["tournament-create-modal", "tournament-create-form", "tc-title", "tc-game", "tc-bracket-size", "tc-entry-cap", "tc-entry-cap-custom", "tc-chat-channel", "tc-keyword", "tournament-create-error", "tournament-create-submit", "tournament-create-cancel"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('value="sitechan"');
    expect(html).not.toMatch(/class="[^"]*\bmodal\b/);
  });

  it("hides the new-tournament action for locked existing workspaces", () => {
    const html = workspaceHtml(vm({
      lifecycle: "completed",
      tournament: { status: "completed", winner_name: "alpha" },
      tournamentsEnabled: false,
    }), "");
    expect(html).toContain('id="tournament-new"');
    expect(html).toContain('id="tournament-new" type="button" hidden');
  });

  it("locks the connected Kick channel in the creation dialog", () => {
    const html = createDialogHtml({
      chatRegistration: { connected: true, channelName: "streamer" },
      siteChannel: "board-channel",
    });
    expect(html).toContain('value="streamer"');
    expect(html).toContain('id="tc-chat-channel"');
    expect(html).toContain("readonly");
    expect(html).toContain("Your connected Kick channel. Signups are collected here.");
    expect(html).not.toContain('href="/dashboard/settings/connections"');
  });

  it("keeps the channel editable and links to Connections when disconnected", () => {
    const html = createDialogHtml({
      chatRegistration: { connected: false },
      siteChannel: "board-channel",
    });
    expect(html).toContain('value="board-channel"');
    expect(html).not.toContain('id="tc-chat-channel" name="chatChannel" type="text" value="board-channel" placeholder="channelname" autocomplete="off" class="tn-input" readonly');
    expect(html).toContain("Connect Kick in ");
    expect(html).toContain('href="/dashboard/settings/connections"');
    expect(html).toContain("Settings → Connections");
  });

  it("select dialog exposes modes, panes and list hooks", () => {
    const html = selectDialogHtml({ cap: 8, eligible: 12 });
    for (const id of ["tournament-select-modal", "ts-mode-random", "ts-mode-manual", "ts-pane-random", "ts-pane-manual", "ts-search", "ts-entry-list", "ts-counter", "ts-random-text", "tournament-select-error", "tournament-select-submit", "tournament-select-cancel"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("Selected 0 / 8");
  });

  it("select list is filtered data, not fixtures", () => {
    const selection = new Set(["e2"]);
    const html = selectListHtml(
      [
        { id: "e1", display_name: "alpha", eligible: true },
        { id: "e2", display_name: "beta", eligible: true },
        { id: "e3", display_name: "gone", eligible: false },
      ],
      selection,
      "beta",
    );
    expect(html).toContain("beta");
    expect(html).toContain('value="e2" checked');
    expect(html).not.toContain("alpha");
    expect(html).not.toContain("gone");
  });

  it("full bracket dialog is its own tn-dialog structure", () => {
    const html = fullBracketDialogHtml();
    expect(html).toContain('id="tournament-bracket-modal"');
    expect(html).toContain('id="tournament-bracket-full"');
    expect(html).toContain('id="tournament-bracket-close"');
    expect(html).toContain("Full bracket");
    expect(html).not.toMatch(/class="[^"]*\bmodal\b/);
  });
});

describe("formatCreated", () => {
  it("is deterministic en-US formatting", () => {
    expect(formatCreated("2026-09-20T10:30:00Z")).toBe("Sep 20, 2026, 10:30");
    expect(formatCreated("")).toBe("—");
  });
});
