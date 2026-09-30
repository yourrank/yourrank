import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { tournamentLifecycle, tournamentViewState, entryViews } from "../lib/tournament-state.js";
import { renderGiveawaysHtml } from "../pages/giveaway-pages.js";
import {
  actAndFlush,
  clickReactTarget,
  document,
  mountTournamentPage,
  restoreTournamentDomGlobals,
  unmountTournamentPage,
  window,
} from "./tournament-react-utils.js";

const site = { id: "site-1", name: "Cup Site", slug: "cup-site", published: true, userRole: "owner", kickChannelName: "board-channel" };
const base = {
  id: "t-1", title: "Community Cup", game_name: "Fortnite", bracket_size: 8, entry_cap: null,
  entry_keyword: "!join", chat_channel: "chan", signup_state: "closed", status: "draft",
  anti_alt_enabled: true, waitlist_enabled: false, winner_name: null, created_at: "2026-09-20T10:30:00Z",
};
const server = { tournaments: [], entries: [], matches: [], entitlement: true, chatRegistration: null };
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});
const countsFor = (entries) => ({
  active: entries.filter((entry) => ["pending", "confirmed", "selected"].includes(entry.status)).length,
  eligible: entries.filter((entry) => entry.eligible === true).length,
  waitlist: entries.filter((entry) => entry.status === "waitlist").length,
  removed: entries.filter((entry) => entry.status === "removed").length,
  blocked: entries.filter((entry) => entry.status === "blocked").length,
  inactive: entries.filter((entry) => ["removed", "blocked"].includes(entry.status)).length,
});
const currentFor = (path) => {
  const id = path.match(/^\/api\/tournaments\/([^/]+)/)?.[1];
  return server.tournaments.find((item) => String(item.id) === id) || server.tournaments[0] || null;
};

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input), "http://localhost");
  const path = url.pathname;
  const method = init.method || "GET";
  if (path === "/api/auth/me") return json({ ok: true, user: { id: "owner", plan: "pro", emailVerified: true } });
  if (path === "/api/site/list") return json({ ok: true, sites: [site] });
  if (path === "/api/tournaments") {
    const tournaments = server.tournaments.map((item) => {
      const lifecycle = tournamentLifecycle(item, server.matches.length);
      return {
        ...item,
        lifecycle,
        match_count: server.matches.length,
        status_label: ({ setup: "Setup", live: "Live", finished: "Finished", cancelled: "Cancelled" })[lifecycle],
      };
    });
    const current = tournaments.find((item) => !["completed", "cancelled"].includes(item.status)) || tournaments[0] || null;
    return json({
      ok: true,
      tournaments,
      current_id: current?.id || null,
      entitlement: { enabled: server.entitlement },
      chatRegistration: server.chatRegistration,
    });
  }
  const tournament = currentFor(path);
  if (path.endsWith("/entries")) {
    const counts = countsFor(server.entries);
    const lifecycle = tournamentLifecycle(tournament, server.matches.length);
    return json({
      ok: true,
      entries: entryViews(server.entries, { tournament, matches: server.matches, lifecycle }),
      counts,
      state: tournamentViewState({ tournament, counts, matchCount: server.matches.length }),
    });
  }
  if (path.endsWith("/bracket")) return json({ ok: true, tournament, matches: server.matches });
  if (path.endsWith("/chatroom")) return json({ ok: true, chatroomId: "chatroom-1" });
  if (path.endsWith("/signups/open")) {
    tournament.signup_state = "open";
    return json({ ok: true, tournament, message: `Chat signups on — viewers can type ${tournament.entry_keyword || "!join"} in chat.` });
  }
  if (path.endsWith("/signups/lock")) {
    tournament.signup_state = "locked";
    return json({ ok: true, tournament, message: "Chat signups off — viewers can no longer join from chat." });
  }
  if (path.endsWith("/entries/select")) return json({ ok: true, entries: server.entries });
  if (method === "POST" && path.endsWith("/entries")) return json({ ok: true, entry: {} });
  return json({ ok: true });
};

document.body.innerHTML = renderGiveawaysHtml("tournaments");
const $id = (id) => document.getElementById(id);
const text = (id) => $id(id)?.textContent?.trim() || "";
const click = async (id) => clickReactTarget($id(id));

async function boot({
  tournament = base,
  tournaments,
  entries = [],
  matches = [],
  entitlement = true,
  chatRegistration = null,
  selectedId,
} = {}) {
  server.tournaments = (tournaments || (tournament ? [tournament] : [])).map((item) => ({ ...item }));
  server.entries = entries.map((entry) => ({ ...entry }));
  server.matches = matches.map((match) => ({ ...match }));
  server.entitlement = entitlement;
  server.chatRegistration = chatRegistration;
  window.sessionStorage.clear();
  if (selectedId) window.sessionStorage.setItem("yr:tournament:site-1", selectedId);
  await mountTournamentPage({ site });
}

beforeEach(() => {
  server.tournaments = [];
  server.entries = [];
  server.matches = [];
  server.entitlement = true;
  server.chatRegistration = null;
  window.sessionStorage.clear();
});

afterAll(async () => {
  await unmountTournamentPage();
  restoreTournamentDomGlobals();
});

describe("React tournament workspace rendering", () => {
  it("renders status, bracket metadata, active counts, and the server-provided entry label", async () => {
    await boot({
      tournament: { ...base, game_name: "" },
      entries: [
        { id: "e1", display_name: "alpha", source: "chat", status: "confirmed", eligible: true },
        { id: "e2", display_name: "beta", source: "page", status: "selected", eligible: true },
        { id: "e3", display_name: "gamma", source: "manual", status: "removed", eligible: false },
      ],
    });
    expect(text("tournament-status")).toBe("Setup");
    expect(text("tournament-meta")).toBe("8-player bracket");
    expect(text("tournament-meta")).not.toContain("Fortnite");
    expect(text("tournament-count")).toBe("2");
    expect(text("tournament-fact-spots")).toBe("8");
    expect(text("tournament-fact-cap")).toBe("Unlimited");
    expect($id("tournament-fact-keyword")).toBeNull();
    expect(text("tournament-tab-entries")).toBe("Entries (2)");
  });

  it("renders entry sources, server labels, duplicate flags, and the active lifecycle actions", async () => {
    await boot({
      entries: [
        { id: "e1", display_name: "alpha", source: "chat", status: "confirmed", eligible: true },
        { id: "e2", display_name: "beta", source: "page", status: "selected", eligible: true, alt_flag: true, alt_reason: "Possible duplicate account." },
        { id: "e3", display_name: "gamma", source: "manual", status: "removed", eligible: false },
      ],
    });
    const list = $id("tournament-entry-list");
    expect(list.textContent).toContain("Chat");
    expect(list.textContent).toContain("Signup page");
    expect(list.textContent).toContain("In bracket");
    expect(list.textContent).toContain("Possible duplicate");
    expect(list.querySelectorAll('button[aria-label^="Actions for"]')).toHaveLength(2);
    expect($id("tournament-removed").querySelector("summary").textContent).toContain("Removed (1)");
    expect($id("tournament-removed").open).toBe(false);
  });

  it("renders eliminated and waitlist positions from tournament entries", async () => {
    const matches = [{
      id: "m1", round_number: 1, match_index: 0, player1_name: "winner", player2_name: "loser",
      player1_score: 2, player2_score: 0, winner_name: "winner", status: "completed",
    }];
    await boot({
      tournament: { ...base, status: "active" },
      matches,
      entries: [
        { id: "w", display_name: "winner", source: "chat", status: "selected", eligible: false },
        { id: "l", display_name: "loser", source: "chat", status: "selected", eligible: false },
        { id: "q1", display_name: "queued1", source: "chat", status: "waitlist", eligible: false, created_at: "2026-09-20T10:01:00Z" },
        { id: "q2", display_name: "queued2", source: "chat", status: "waitlist", eligible: false, created_at: "2026-09-20T10:02:00Z" },
      ],
    });
    const list = $id("tournament-entry-list").textContent;
    expect(list).toContain("Eliminated");
    expect(list).toContain("In bracket");
    expect(list).toContain("Waitlist #1");
    expect(list).toContain("Waitlist #2");
  });

  it("renders the champion label for the finished winner", async () => {
    await boot({
      tournament: { ...base, status: "completed", winner_name: "alpha" },
      matches: [{ id: "m1", round_number: 1, match_index: 0, player1_name: "alpha", player2_name: "beta", status: "completed", winner_name: "alpha" }],
      entries: [
        { id: "e1", display_name: "alpha", source: "manual", status: "selected", eligible: false },
        { id: "e2", display_name: "beta", source: "manual", status: "selected", eligible: false },
      ],
    });
    expect($id("tournament-entry-list").textContent).toContain("Champion");
    expect($id("tournament-entry-list").querySelectorAll('button[aria-label^="Actions for"]')).toHaveLength(0);
  });

  it("switches between every tournament and persists the selected id", async () => {
    const first = { ...base, id: "setup", title: "Friday Cup", status: "draft" };
    const second = { ...base, id: "done", title: "Summer Cup", status: "completed" };
    await boot({ tournaments: [first, second], selectedId: "done", tournament: null });
    expect(text("tournament-title-display")).toBe("Summer Cup");
    await clickReactTarget(document.querySelector('button[aria-label="All tournaments (2)"]'));
    const options = [...document.querySelectorAll("[data-tournament-switch]")];
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("Friday Cup");
    expect(options[0].textContent).toContain("Setup");
    expect(options[0].querySelector(".tn-pill").className).toContain("tn-pill--setup");
    expect(options[1].getAttribute("aria-current")).toBe("true");
    await clickReactTarget(options[0]);
    expect(text("tournament-title-display")).toBe("Friday Cup");
    expect(window.sessionStorage.getItem("yr:tournament:site-1")).toBe("setup");
    expect($id("tournament-tab-entries").getAttribute("aria-selected")).toBe("true");
  });

  it("reveals inactive entries on demand and applies each server action list", async () => {
    await boot({
      entries: [
        { id: "active", display_name: "active-user", source: "chat", status: "pending", eligible: true },
        { id: "removed", display_name: "removed-user", source: "chat", status: "removed", eligible: false },
        { id: "blocked", display_name: "blocked-user", source: "chat", status: "blocked", eligible: false },
      ],
    });
    const removed = $id("tournament-removed");
    expect(removed.querySelector("summary").textContent).toContain("Removed (2)");
    expect(removed.open).toBe(false);
    const summary = removed.querySelector("summary");
    await clickReactTarget(summary);
    expect(removed.open).toBe(true);
    expect(removed.querySelector("[data-entry-id='removed']")).toBeTruthy();

    const activeMenu = $id("tournament-entry-list").querySelector('[data-entry-id="active"] button[aria-label^="Actions for"]');
    await clickReactTarget(activeMenu);
    expect([...document.querySelectorAll("[data-entry-action]")].map((item) => item.dataset.entryAction)).toEqual(["remove", "block"]);
    await actAndFlush(() => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

    const blockedMenu = $id("tournament-removed-list").querySelector('[data-entry-id="blocked"] button[aria-label^="Actions for"]');
    await clickReactTarget(blockedMenu);
    expect([...document.querySelectorAll("[data-entry-action]")].map((item) => item.dataset.entryAction)).toEqual(["restore", "remove"]);
    expect(document.querySelector("[data-entry-action='restore'][data-entry-id='blocked']")).toBeTruthy();
  });

  it("hides the entry menus after the tournament finishes", async () => {
    await boot({
      tournament: { ...base, status: "completed" },
      entries: [{ id: "e1", display_name: "alpha", source: "manual", status: "selected", eligible: false }],
    });
    expect($id("tournament-entry-list").querySelectorAll('button[aria-label^="Actions for"]')).toHaveLength(0);
  });

  it("keeps the bracket empty state until matches are loaded", async () => {
    await boot();
    expect($id("tournament-bracket-empty")).toBeTruthy();
    expect($id("tournament-bracket-empty").textContent).toContain("Bracket not created yet.");
    await boot({
      tournament: { ...base, status: "active" },
      matches: [{ id: "m1", round_number: 1, match_index: 0, player1_name: "a", player2_name: "b", status: "pending" }],
    });
    expect($id("tournament-bracket-empty")).toBeNull();
    expect($id("tournament-bracket").querySelector('[data-match-id="m1"]')).toBeTruthy();
  });

  it("shows the add-entry controls only during setup and uses the server's full/waitlist note", async () => {
    const active = [
      { id: "e1", display_name: "alpha", source: "manual", status: "pending", eligible: true },
      { id: "e2", display_name: "beta", source: "manual", status: "confirmed", eligible: true },
    ];
    for (const signupState of ["closed", "open", "locked"]) {
      await boot({ tournament: { ...base, signup_state: signupState, chat_channel: "" } });
      expect($id("tournament-add-entry-form")).toBeTruthy();
      expect($id("tournament-add-entry-name").getAttribute("maxLength")).toBe("80");
    }
    for (const { status, matches = [] } of [
      { status: "active", matches: [{ id: "m1", player1_name: "alpha", player2_name: "beta", status: "pending" }] },
      { status: "completed" },
      { status: "cancelled" },
    ]) {
      await boot({ tournament: { ...base, status }, matches });
      expect($id("tournament-add-entry-form")).toBeNull();
    }
    await boot({
      tournament: { ...base, bracket_size: 4, entry_cap: 2 },
      entries: active,
    });
    expect($id("tournament-add-entry-submit").disabled).toBe(true);
    expect($id("tournament-add-entry-form").querySelector(".tn-add-entry-note").textContent)
      .toBe("Signups are full (2/2). Raise the signup limit in Settings or turn on Allow waitlist.");
    await boot({
      tournament: { ...base, bracket_size: 4, entry_cap: 2, waitlist_enabled: true },
      entries: active,
    });
    expect(text("tournament-add-entry-submit")).toBe("Add to waitlist");
    expect($id("tournament-add-entry-submit").disabled).toBe(false);
  });

  it("renders the setup empty-state copy and chat keyword", async () => {
    await boot({
      tournament: { ...base, signup_state: "open", entry_keyword: "!cup" },
      entries: [],
    });
    expect($id("tournament-entries-empty").textContent).toContain("Waiting for viewers.");
    expect($id("tournament-entries-empty").textContent).toContain("Ask viewers to type !cup in chat.");
    expect($id("tournament-fact-keyword")).toBeTruthy();
  });

  it("renders read-only settings and summary without obsolete Rules or ID rows", async () => {
    await boot({
      tournament: { ...base, status: "completed", winner_name: "alpha" },
      matches: [{ id: "m1", round_number: 1, match_index: 0, player1_name: "alpha", player2_name: "beta", status: "completed", winner_name: "alpha" }],
    });
    await click("tournament-tab-settings");
    expect($id("tournament-settings-form")).toBeNull();
    expect($id("tournament-settings-view")).toBeTruthy();
    const view = $id("tournament-settings-view").textContent;
    expect(view).toContain("General");
    expect(view).toContain("Registration");
    expect(view).not.toContain("Rules");
    expect(view).toContain("Kick channel");
    expect(view).toContain("Signup limit");
    expect($id("tournament-settings-aside").textContent).toContain("Delete tournament");
    expect($id("tournament-settings-aside").textContent).not.toContain("Tournament ID");

    await click("tournament-tab-bracket");
    const summary = $id("tournament-summary").textContent;
    for (const label of ["Entries", "Bracket size", "Matches played", "Status", "Game", "Created"]) {
      expect(summary.split(label).length - 1).toBe(1);
    }
    expect(summary).not.toContain("Tournament ID");
    expect(summary).toContain("Fortnite");
    expect(summary).toContain("Sep 20, 2026, 10:30");
  });

  it("keeps waitlist settings collapsed under Advanced until opened", async () => {
    await boot();
    await click("tournament-tab-settings");
    const advanced = document.querySelector(".tn-settings-advanced button");
    expect(advanced.getAttribute("aria-expanded")).toBe("false");
    await clickReactTarget(advanced);
    expect(advanced.getAttribute("aria-expanded")).toBe("true");
    expect($id("tournament-waitlist")).toBeTruthy();
  });

  it("marks the selected tab and panel", async () => {
    await boot();
    expect($id("tournament-tab-entries").getAttribute("aria-selected")).toBe("true");
    await click("tournament-tab-bracket");
    expect($id("tournament-tab-bracket").getAttribute("aria-selected")).toBe("true");
    expect($id("tournament-panel-bracket")).toBeTruthy();
    expect($id("tournament-tab-entries").getAttribute("aria-selected")).toBe("false");
  });

  it("renders the empty workspace and its create action", async () => {
    await boot({ tournament: null });
    expect($id("tournament-empty")).toBeTruthy();
    expect($id("tournament-create")).toBeTruthy();
    expect($id("tournament-primary")).toBeNull();
    expect(document.body.textContent).toContain("Run a tournament for your community.");
    await click("tournament-create");
    expect($id("tournament-create-modal")).toBeTruthy();
  });

  it("describes and disables create actions when the plan is locked", async () => {
    await boot({ tournament: null, entitlement: false });
    expect($id("tournament-create").disabled).toBe(true);
    expect($id("tournament-create").getAttribute("aria-describedby")).toBe("tournament-plan-lock");
    expect($id("tournament-plan-lock").dataset.planLock).toBe("tournaments");
  });

  it("shows New in enabled workspaces and hides it only when the plan is locked", async () => {
    await boot();
    expect($id("tournament-new").hidden).toBe(false);
    await boot({ entitlement: false });
    expect($id("tournament-new").hidden).toBe(true);
  });

  it("opens an empty create form with basic fields and collapsed More options", async () => {
    await boot({ tournament: null });
    await click("tournament-create");
    for (const id of ["tournament-create-modal", "tournament-create-form", "tc-title", "tc-bracket-size", "tournament-create-error", "tournament-create-submit", "tournament-create-cancel"]) {
      expect($id(id)).toBeTruthy();
    }
    expect($id("tc-title").value).toBe("");
    expect($id("tc-title").placeholder).toBe("e.g. Friday Night Cup");
    expect($id("tc-more-trigger").getAttribute("aria-expanded")).toBe("false");
    expect($id("tc-game")).toBeNull();
    await click("tc-more-trigger");
    expect($id("tc-game")).toBeTruthy();
    expect($id("tc-entry-cap")).toBeTruthy();
    expect($id("tc-chat-channel")).toBeTruthy();
  });

  it("prefills and locks a connected Kick channel, while disconnected channels stay editable", async () => {
    await boot({
      tournament: null,
      chatRegistration: { connected: true, channelName: "streamer" },
    });
    await click("tournament-create");
    await click("tc-more-trigger");
    expect($id("tc-chat-channel").value).toBe("streamer");
    expect($id("tc-chat-channel").readOnly).toBe(true);
    expect(document.body.textContent).toContain("Your connected Kick channel. Signups are collected here.");

    await boot({ tournament: null, chatRegistration: { connected: false } });
    await click("tournament-create");
    await click("tc-more-trigger");
    expect($id("tc-chat-channel").value).toBe("board-channel");
    expect($id("tc-chat-channel").readOnly).toBe(false);
    expect(document.body.textContent).toContain("Connect Kick in Settings → Connections before opening signups.");
  });

  it("opens the manual selection pane and selects the first bracket-sized eligible ranks", async () => {
    const entries = Array.from({ length: 6 }, (_, index) => ({
      id: `e${index + 1}`,
      display_name: `player${index + 1}`,
      source: "manual",
      status: "pending",
      eligible: true,
      created_at: `2026-09-20T10:0${index}:00Z`,
    }));
    await boot({
      tournament: { ...base, bracket_size: 4 },
      entries,
    });
    await click("tournament-primary");
    expect($id("tournament-select-modal")).toBeTruthy();
    await click("ts-mode-manual");
    expect($id("ts-select-first").textContent).toBe("Select first 4");
    await click("ts-select-first");
    expect(text("ts-counter")).toContain("Selected 4 / 4");
    expect($id("ts-entry-list").querySelectorAll('[role="checkbox"][aria-checked="true"]')).toHaveLength(4);
  });

  it("opens the expanded read-only bracket dialog and closes it", async () => {
    await boot({
      tournament: { ...base, status: "completed", winner_name: "alpha" },
      matches: [{ id: "m1", round_number: 1, match_index: 0, player1_name: "alpha", player2_name: "beta", status: "completed", winner_name: "alpha" }],
    });
    await click("tournament-tab-bracket");
    await click("tournament-bracket-expand");
    expect($id("tournament-bracket-modal")).toBeTruthy();
    expect($id("tournament-bracket-full").querySelector('.tn-bracket[data-mode="expanded"]')).toBeTruthy();
    expect($id("tournament-bracket-full").querySelectorAll("input,button[data-score-match]")).toHaveLength(0);
    expect(document.body.textContent).toContain("Read-only, sized for screen sharing. Enter scores in the Bracket tab.");
    await click("tournament-bracket-close");
    expect($id("tournament-bracket-modal")).toBeNull();
  });
});
