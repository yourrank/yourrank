// Behavioral coverage for the React Tournament page with an in-memory API.
// Lifecycle is derived from the server's status/signup_state/matches only.
//
// Run: bun test src/__tests__/tournament-lifecycle-ui.test.js

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { renderGiveawaysHtml } from "../pages/giveaway-pages.js";
import { entryViews, tournamentLifecycle, tournamentViewState } from "../lib/tournament-state.js";
import {
  actAndFlush,
  clickReactTarget,
  document,
  firePointerClick,
  flushReactUpdates,
  mountTournamentPage,
  restoreTournamentDomGlobals,
  setReactInputValue,
  unmountTournamentPage,
  window,
} from "./tournament-react-utils.js";

const user = { id: "user-1", email: "creator@example.com", plan: "pro", emailVerified: true };
const site = { id: "site-1", name: "Kick Cup", slug: "kick-cup", published: true, userRole: "owner", kickChannelName: "" };

const server = {
  tournaments: [], entries: [], matches: [], requests: [], failSettings: false, settingsGate: null,
  scoreGate: null,
  settingsError: null,
  deleteError: null,
  chatRegistration: { connected: false, chatReady: false, channelName: null, externalChannelId: null },
};
function reset({ tournaments = [], entries = [], matches = [] } = {}) {
  server.tournaments = tournaments.map((t) => ({ ...t }));
  server.entries = entries.map((e) => ({ ...e }));
  server.matches = matches.map((m) => ({ ...m }));
  server.requests.length = 0;
  server.failSettings = false;
  server.settingsGate = null;
  server.scoreGate = null;
  server.settingsError = null;
  server.deleteError = null;
  server.chatRegistration = { connected: false, chatReady: false, channelName: null, externalChannelId: null };
  window.sessionStorage.clear();
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const base = {
  id: "t-1", title: "Friday Night Cup", game_name: "Game", bracket_size: 8, status: "draft",
  signup_state: "closed", entry_cap: null, format: "bracket", anti_alt_enabled: false,
  entry_keyword: "!join", chat_channel: "creator", winner_name: null,
};

globalThis.fetch = async (input, init = {}) => {
  const path = String(input).split("?")[0];
  const body = init.body ? JSON.parse(init.body) : undefined;
  server.requests.push({ path, method: init.method || "GET", body });
  if (path === "/api/auth/me") return json({ ok: true, user });
  if (path === "/api/site/list") return json({ ok: true, sites: [site] });
  if (path === "/api/tournaments" && init.method === "POST") {
    if (!body.title?.trim()) return json({ error: "Enter a tournament name." }, 400);
    if (![4, 8, 16, 32].includes(body.bracketSize)) return json({ error: "Unsupported bracket size." }, 400);
    const tournament = {
      ...base, id: `t-${server.tournaments.length + 1}`, title: body.title, game_name: body.gameName,
      bracket_size: body.bracketSize, format: body.format,
      entry_cap: body.entryCap === "bracket" ? body.bracketSize : body.entryCap === "unlimited" ? null : body.entryCap,
      entry_keyword: body.entryKeyword, chat_channel: body.chatChannel || null,
    };
    server.tournaments.unshift(tournament);
    return json({ ok: true, tournament });
  }
  if (path === "/api/tournaments") {
    const listed = server.tournaments.map((item) => {
      const lifecycle = tournamentLifecycle(item, server.matches.length);
      return {
        ...item,
        match_count: server.matches.length,
        lifecycle,
        status_label: ({ setup: "Setup", live: "Live", finished: "Finished", cancelled: "Cancelled" })[lifecycle],
      };
    });
    const current = listed.find((item) => !["completed", "cancelled"].includes(item.status)) || listed[0] || null;
    return json({
      ok: true,
      tournaments: listed,
      current_id: current?.id || null,
      chatRegistration: server.chatRegistration,
    });
  }
  const current = server.tournaments.find((item) => path.startsWith(`/api/tournaments/${item.id}/`)) || server.tournaments[0];
  if (path.endsWith("/entries")) {
    // The real server marks each row with the authoritative `eligible` flag;
    // fixtures may override it explicitly, otherwise status decides.
    const list = server.entries.map((entry) => ({
      eligible: ["pending", "confirmed"].includes(entry.status),
      ...entry,
    }));
    const counts = {
      active: list.filter((e) => ["pending", "confirmed", "selected"].includes(e.status)).length,
      eligible: list.filter((e) => e.eligible === true).length,
      waitlist: list.filter((e) => e.status === "waitlist").length,
      removed: list.filter((e) => e.status === "removed").length,
      blocked: list.filter((e) => e.status === "blocked").length,
      inactive: list.filter((e) => ["removed", "blocked"].includes(e.status)).length,
    };
    const lifecycle = tournamentLifecycle(current, server.matches.length);
    const state = tournamentViewState({ tournament: current, counts, matchCount: server.matches.length });
    return json({
      ok: true,
      entries: entryViews(list, { tournament: current, matches: server.matches, lifecycle }),
      counts,
      state,
    });
  }
  if (path.endsWith("/entries/select")) {
    current.status = "active";
    return json({ ok: true, entries: server.entries });
  }
  if (path.endsWith("/bracket")) return json({ ok: true, tournament: current, matches: server.matches });
  if (path.endsWith("/score") && ["PATCH", "POST"].includes(init.method)) {
    if (server.scoreGate) await server.scoreGate;
    const scored = server.matches.find((m) => m.id === body.matchId);
    if (scored && body.reopen) {
      Object.assign(scored, { status: "pending", winner_name: null, player1_score: 0, player2_score: 0, correctable: false });
    } else if (scored) {
      const s1 = body.winnerSlot ? Number(body.winnerSlot === 1) : body.player1Score;
      const s2 = body.winnerSlot ? Number(body.winnerSlot === 2) : body.player2Score;
      Object.assign(scored, { status: "completed", player1_score: s1, player2_score: s2, winner_name: s1 > s2 ? scored.player1_name : scored.player2_name, correctable: true });
    }
    return json({
      ok: true,
      message: init.method === "PATCH" ? "📝 Score corrected: alpha wins the match." : "Score saved.",
    });
  }
  if (path.endsWith("/signups/open")) {
    current.signup_state = "open";
    return json({ ok: true, tournament: current, message: `Chat signups on — viewers can type ${current.entry_keyword || "!join"} in chat.` });
  }
  if (path.endsWith("/signups/lock")) {
    current.signup_state = "locked";
    return json({ ok: true, tournament: current, message: "Chat signups off — viewers can no longer join from chat." });
  }
  if (path.endsWith("/delete") && init.method === "POST") {
    if (server.deleteError) return json(server.deleteError, 400);
    if (body.confirmTitle?.trim() !== current.title.trim()) return json({ error: "Type the tournament name exactly to delete it." }, 400);
    server.tournaments = server.tournaments.filter((item) => item.id !== current.id);
    return json({ ok: true, deleted: current.id, message: `Deleted “${current.title.trim()}”.` });
  }
  if (path.endsWith("/settings")) {
    if (body.title !== undefined && !body.title.trim()) {
      return json({ ok: false, error: "Enter a tournament name.", field: "title" }, 400);
    }
    if (server.settingsError) return json(server.settingsError, 400);
    if (server.failSettings || body.bracketSize === 6) {
      return json({ ok: false, error: "Bracket size must be 4, 8, 16, or 32.", field: "bracketSize" }, 400);
    }
    Object.assign(current, {
      title: body.title || current.title,
      ...(body.bracketSize !== undefined ? { bracket_size: body.bracketSize } : {}),
      ...(body.entryCap !== undefined ? { entry_cap: body.entryCap === "bracket" ? (body.bracketSize ?? current.bracket_size) : body.entryCap === "unlimited" ? null : body.entryCap } : {}),
      ...(body.chatChannel !== undefined ? { chat_channel: body.chatChannel } : {}),
      ...(body.antiAltEnabled !== undefined ? { anti_alt_enabled: body.antiAltEnabled } : {}),
    });
    if (server.settingsGate) await server.settingsGate;
    return json({
      ok: true,
      tournament: current,
      ...(body.antiAltEnabled !== undefined
        ? { message: current.anti_alt_enabled ? "Duplicate protection on." : "Duplicate protection off." }
        : {}),
    });
  }
  if (path === "/api/giveaways/chatroom") return json({ error: "offline" }, 404);
  return json({ ok: true });
};
const requestsTo = (path, method) => server.requests.filter((r) => r.path === path && (!method || r.method === method));

window.__yrSpaShell = true;
document.body.innerHTML = renderGiveawaysHtml("tournaments");

const $id = (id) => document.getElementById(id);
const text = (id) => $id(id)?.textContent.trim();
const visible = (id) => { const el = $id(id); return Boolean(el) && !el.hidden && !el.closest("[hidden]"); };

const mod = {
  boot: () => mountTournamentPage({ site }),
  leave: unmountTournamentPage,
};
await flushReactUpdates();

async function click(id) {
  await clickReactTarget($id(id));
}

async function submit(id) {
  await actAndFlush(() => $id(id).dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
}

async function fill(id, value) {
  await setReactInputValue($id(id), value);
}

async function chooseOption(triggerId, label) {
  await click(triggerId);
  const option = [...document.querySelectorAll('[role="option"]')]
    .find((item) => item.textContent.trim() === label);
  if (!option) throw new Error(`Option not found: ${label}`);
  await clickReactTarget(option);
}

afterAll(async () => {
  await mod.leave();
  restoreTournamentDomGlobals();
});

describe("tournament lifecycle UI", () => {
  beforeEach(async () => {
    reset();
    site.kickChannelName = "";
    await mod.boot();
    await flushReactUpdates();
  });

  it("renders lifecycle from the entries state and keeps New available", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    expect(text("tournament-status")).toBe("Setup");
    expect(visible("tournament-new")).toBe(true);

    reset({
      tournaments: [{ ...base, status: "active" }],
      matches: [{ id: "m1", status: "pending" }],
    });
    await mod.boot();
    expect(text("tournament-status")).toBe("Live");
    expect(visible("tournament-new")).toBe(true);
  });

  it("switches tournaments and persists the selected id for this site", async () => {
    reset({
      tournaments: [
        { ...base },
        { ...base, id: "t-2", title: "Finished Cup", status: "completed" },
      ],
    });
    window.sessionStorage.setItem("yr:tournament:site-1", "t-2");
    await mod.boot();
    expect($id("tournament-switcher").querySelector("button").getAttribute("aria-label")).toBe("All tournaments (2)");
    expect(text("tournament-title-display")).toBe("Finished Cup");
    await clickReactTarget($id("tournament-switcher").querySelector("button"));
    const initialItems = [...document.querySelectorAll("[data-tournament-switch]")];
    expect(initialItems).toHaveLength(2);
    expect(initialItems.find((item) => item.dataset.tournamentSwitch === "t-2").getAttribute("aria-current")).toBe("true");
    const setup = initialItems.find((item) => item.dataset.tournamentSwitch === "t-1");
    await clickReactTarget(setup);
    await flushReactUpdates();
    expect(text("tournament-title-display")).toBe("Friday Night Cup");
    expect(window.sessionStorage.getItem("yr:tournament:site-1")).toBe("t-1");
    await clickReactTarget($id("tournament-switcher").querySelector("button"));
    expect(document.querySelector('[data-tournament-switch="t-1"]').getAttribute("aria-current")).toBe("true");
  });

  it("handles the mounted quick-new events and consumes new=1 once", async () => {
    const tournamentEvent = new window.CustomEvent("yr:quick-new", {
      detail: { kind: "tournament" },
      cancelable: true,
    });
    await actAndFlush(() => document.dispatchEvent(tournamentEvent));
    expect(tournamentEvent.defaultPrevented).toBe(true);
    expect(visible("tournament-create-modal")).toBe(true);
    await click("tournament-create-cancel");

    reset({ tournaments: [base] });
    await mod.boot();
    const playerEvent = new window.CustomEvent("yr:quick-new", {
      detail: { kind: "player" },
      cancelable: true,
    });
    await actAndFlush(() => document.dispatchEvent(playerEvent));
    expect(playerEvent.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("tournament-add-entry-name");

    window.history.replaceState({}, "", "/dashboard/giveaways/tournaments?siteId=site-1&new=1");
    await mod.boot();
    expect(visible("tournament-create-modal")).toBe(true);
    expect(window.location.search).toBe("?siteId=site-1");
  });

  it("keeps the duplicate-protection toggle pending through an entries refresh", async () => {
    reset({
      tournaments: [{ ...base }],
      entries: [{ id: "e1", display_name: "one", source: "chat", status: "pending" }],
    });
    await mod.boot();
    let releaseSettings;
    server.settingsGate = new Promise((resolve) => { releaseSettings = resolve; });

    await clickReactTarget($id("tournament-advanced").querySelector("button"));
    await clickReactTarget($id("tournament-dup-protection"));

    const settingsPath = "/api/tournaments/t-1/settings";
    expect(requestsTo(settingsPath, "POST")).toHaveLength(1);
    expect(requestsTo(settingsPath, "POST")[0].body).toEqual({ antiAltEnabled: true });

    const row = $id("tournament-entry-list").querySelector(".tn-entry");
    await clickReactTarget(row.querySelector("button[aria-label^='Actions for']"));
    await clickReactTarget(document.querySelector("[data-entry-action='remove']"));

    expect(requestsTo(settingsPath, "POST")).toHaveLength(1);
    expect($id("tournament-dup-protection").getAttribute("aria-checked")).toBe("true");

    await actAndFlush(() => releaseSettings());

    expect($id("tournament-dup-protection").getAttribute("aria-checked")).toBe("true");
    expect($id("tournament-dup-protection").disabled).toBe(false);
    expect(text("tournament-message")).toBe("Duplicate protection on.");
  });

  it("reverts duplicate protection and shows the server error when saving fails", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    server.settingsError = { ok: false, error: "Duplicate protection could not be updated." };
    await clickReactTarget($id("tournament-advanced").querySelector("button"));
    const toggle = $id("tournament-dup-protection");
    await clickReactTarget(toggle);
    expect(requestsTo("/api/tournaments/t-1/settings", "POST")).toHaveLength(1);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.disabled).toBe(false);
    expect(text("tournament-message")).toBe("Duplicate protection could not be updated.");
  });

  it("shows only the empty state and Create button when no tournament exists", () => {
    expect(visible("tournament-empty")).toBe(true);
    expect(text("tournament-empty-heading")).toBe("Tournaments");
    expect($id("tournament-empty").textContent).toContain("Run a tournament for your community.");
    expect(visible("tournament-create")).toBe(true);
    expect(visible("tournament-workspace")).toBe(false);
    expect(visible("tournament-panel-entries")).toBe(false);
    expect(visible("tournament-settings-form")).toBe(false);
    expect(visible("tournament-bracket")).toBe(false);
      expect(visible("tournament-chat-status")).toBe(false);
    expect(visible("tournament-create-modal")).toBe(false);
  });

  it("opens a centered create modal with supported bracket sizes and a separate signup limit", async () => {
    await click("tournament-create");
    expect(visible("tournament-create-modal")).toBe(true);
    expect($id("tournament-create-modal").classList.contains("tn-dialog")).toBe(true);
    expect(visible("tournament-empty")).toBe(true);
    expect(text("tc-bracket-size")).toBe("8 players");
    expect($id("tc-format")).toBeNull();
    expect($id("tc-title").value).toBe("");
    expect($id("tc-title").placeholder).toBe("e.g. Friday Night Cup");
    // Chat signup fields are part of the main create form, not hidden under More options.
    expect(visible("tc-keyword")).toBe(true);
    expect(visible("tc-chat-channel")).toBe(true);
    await click("tc-more-trigger");
    expect(text("tc-entry-cap")).toBe("Same as bracket size (8)");
    await click("tc-entry-cap");
    expect([...document.querySelectorAll('[role="option"]')].map((option) => option.textContent.trim()))
      .toEqual(["Same as bracket size (8)", "Unlimited", "Custom…"]);
    await click("tournament-create-cancel");
    expect(visible("tournament-create-modal")).toBe(false);
    expect(requestsTo("/api/tournaments", "POST")).toHaveLength(0);
  });

  it("keeps the create dialog usable during rapid consecutive input changes", async () => {
    await click("tournament-create");

    async function changeTwice(id, firstValue, finalValue) {
      const input = $id(id);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (!setter) throw new Error("Native HTMLInputElement value setter is unavailable");

      await actAndFlush(() => {
        setter.call(input, firstValue);
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
        setter.call(input, finalValue);
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
      });

      expect($id(id).value).toBe(finalValue);
      expect(visible("tournament-create-modal")).toBe(true);
    }

    await changeTwice("tc-title", "Fri", "Friday Cup");
    await click("tc-more-trigger");
    await changeTwice("tc-game", "Fort", "Fortnite");
    await chooseOption("tc-entry-cap", "Custom…");
    await changeTwice("tc-entry-cap-custom", "4", "40");
    await changeTwice("tc-chat-channel", "cre", "creator");
    await changeTwice("tc-keyword", "!f", "!final");
  });

  it("sends the selected values to the API and renders the Draft state", async () => {
    await click("tournament-create");
    await fill("tc-title", "Friday Cup");
    await click("tc-more-trigger");
    await fill("tc-game", "Fortnite");
    await chooseOption("tc-bracket-size", "4 players");
    await fill("tc-chat-channel", "36_ates");
    await fill("tc-keyword", "!cup");
    await submit("tournament-create-form");

    const [post] = requestsTo("/api/tournaments", "POST");
    expect(post.body).toEqual({
      siteId: "site-1", title: "Friday Cup", gameName: "Fortnite", bracketSize: 4,
      entryCap: "bracket", chatChannel: "36_ates", entryKeyword: "!cup",
    });
    expect(server.tournaments[0].game_name).toBe("Fortnite");
    expect(visible("tournament-create-modal")).toBe(false);
    expect(visible("tournament-empty")).toBe(false);
    expect(visible("tournament-workspace")).toBe(true);
    expect(text("tournament-status")).toBe("Setup");
    expect(text("tournament-title-display")).toBe("Friday Cup");
    expect(text("tournament-meta")).toBe("Fortnite · 4-player bracket");
    expect($id("tournament-fact-keyword")).toBeNull();
    expect(text("tournament-count")).toBe("0 of 4");
    expect(text("tournament-primary")).toBe("Start tournament");
    expect(text("tournament-primary-reason")).toBe("Add at least 2 players to start.");
    expect($id("tournament-primary").disabled).toBe(true);
    expect($id("tournament-entries-empty").textContent).toContain("No entries yet.");
    expect($id("tournament-entries-empty").textContent).toContain("Add players below, or turn on chat signup to collect them from Kick chat.");
    await click("tournament-tab-settings");
    expect($id("tournament-chat-channel").value).toBe("36_ates");
  });

  it("sends a blank create title to the API and shows the backend error", async () => {
    await click("tournament-create");
    await fill("tc-title", "   ");
    await submit("tournament-create-form");
    expect(requestsTo("/api/tournaments", "POST")[0].body.title).toBe("");
    expect(text("tournament-create-error")).toBe("Enter a tournament name.");
    expect(visible("tournament-create-modal")).toBe(true);
  });

  it("stores an empty game name instead of a placeholder when the field is left blank", async () => {
    await click("tournament-create");
    await fill("tc-title", "Friday Cup");
    await click("tc-more-trigger");
    await fill("tc-game", "   ");
    await submit("tournament-create-form");
    const [post] = requestsTo("/api/tournaments", "POST");
    expect(post.body.gameName).toBe("");
    expect(server.tournaments[0].game_name).toBe("");
    expect(text("tournament-meta")).not.toContain("Game");
  });

  it("sends a custom signup limit independently of the bracket size", async () => {
    await click("tournament-create");
    await fill("tc-title", "Friday Cup");
    await click("tc-more-trigger");
    await chooseOption("tc-entry-cap", "Custom…");
    expect(visible("tc-entry-cap-custom")).toBe(true);
    await fill("tc-entry-cap-custom", "40");
    await submit("tournament-create-form");
    const [post] = requestsTo("/api/tournaments", "POST");
    expect(post.body.bracketSize).toBe(8);
    expect(post.body.entryCap).toBe(40);
    expect(text("tournament-fact-cap")).toBe("40");
    expect(text("tournament-fact-spots")).toBe("8");
  });

  it("refuses to submit an unsupported bracket size", async () => {
    await click("tournament-create");
    await click("tc-bracket-size");
    const sizes = [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent.trim());
    expect(sizes).toEqual(["4 players", "8 players", "16 players", "32 players"]);
    expect(requestsTo("/api/tournaments", "POST")).toHaveLength(0);
    expect(visible("tournament-create-modal")).toBe(true);
  });

  it("keeps the bracket empty message clean and settings out of the main flow", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    expect(visible("tournament-panel-entries")).toBe(true);
    expect(visible("tournament-panel-settings")).toBe(false);
    expect(visible("tournament-panel-bracket")).toBe(false);
    await click("tournament-tab-bracket");
    expect(visible("tournament-panel-bracket")).toBe(true);
    expect(visible("tournament-bracket-empty")).toBe(true);
    expect($id("tournament-bracket-empty").textContent).toContain("Bracket not created yet.");
    expect($id("tournament-bracket").querySelectorAll(".tn-match")).toHaveLength(0);
    await click("tournament-tab-settings");
    expect(visible("tournament-panel-settings")).toBe(true);
    expect(visible("tournament-settings-form")).toBe(true);
    expect($id("tournament-format")).toBeNull();
    expect($id("tournament-bracket-size").disabled).toBe(false);
  });

  it("runs the Setup flow: chat-signup toggle then Start tournament", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    expect(text("tournament-status")).toBe("Setup");
    expect(text("tournament-primary")).toBe("Start tournament");
    expect(text("tournament-chat-signup-state")).toBe("Off");

    // Turn on chat signup via the switch — it POSTs signups/open.
    const toggle = $id("tournament-chat-signup");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await clickReactTarget(toggle);
    expect(requestsTo("/api/tournaments/t-1/signups/open", "POST")).toHaveLength(1);
    expect(text("tournament-chat-signup-state")).toBe("On — viewers type !join in chat");
    expect(text("tournament-message")).toBe("Chat signups on — viewers can type !join in chat.");
    expect(text("tournament-fact-keyword")).toBe("!join");

    // Turn it back off.
    const toggleOff = $id("tournament-chat-signup");
    await clickReactTarget(toggleOff);
    expect(requestsTo("/api/tournaments/t-1/signups/lock", "POST")).toHaveLength(1);
    expect(text("tournament-chat-signup-state")).toBe("Off");
    expect(text("tournament-message")).toBe("Chat signups off — viewers can no longer join from chat.");
    expect($id("tournament-fact-keyword")).toBeNull();

    server.entries = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, display_name: `viewer${i}`, source: "chat", status: "pending" }));
    await mod.boot();
    // 5 eligible players for 8 spots: start asks for BYE confirmation.
    expect(text("tournament-primary")).toBe("Start tournament");
    expect($id("tournament-primary").disabled).toBe(false);
    expect(text("tournament-count")).toBe("5");
    expect(text("tournament-fact-spots")).toBe("8");
    await click("tournament-tab-settings");
    expect($id("tournament-bracket-size").disabled).toBe(false);

    await click("tournament-tab-entries");
    await click("tournament-primary");
    expect($id("tournament-start-confirm").textContent).toContain("Start tournament");
    expect(document.body.textContent).toContain("Start with 5 players? Empty spots become BYEs.");
    await click("tournament-start-confirm");
    const [pick] = requestsTo("/api/tournaments/t-1/entries/select", "POST");
    expect(pick.body).toEqual({ mode: "all", seeding: "signup" });
  });

  it("derives chat registration status from the server, never the socket", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    await click("tournament-tab-settings");
    expect(text("tournament-chat-status")).toBe("Chat registration off");

    // Open but no confirmed Kick chat delivery: unavailable, and the browser
    // never writes entries.
    reset({ tournaments: [{ ...base, signup_state: "open" }] });
    server.chatRegistration = { connected: true, chatReady: false, channelName: "creator", externalChannelId: "111" };
    await mod.boot();
    await click("tournament-tab-settings");
    expect(text("tournament-chat-status")).toBe("Chat registration unavailable");
    expect($id("tournament-chat-status").classList.contains("is-live")).toBe(false);

    server.chatRegistration = { connected: true, chatReady: true, channelName: "creator", externalChannelId: "111" };
    await mod.boot();
    await click("tournament-tab-settings");
    expect(text("tournament-chat-status")).toBe("Chat registration active");
    expect($id("tournament-chat-status").classList.contains("is-live")).toBe(true);
    // A channel mismatch keeps it unavailable.
    server.chatRegistration = { connected: true, chatReady: true, channelName: "other", externalChannelId: "999" };
    await mod.boot();
    await click("tournament-tab-settings");
    expect(text("tournament-chat-status")).toBe("Chat registration unavailable");
    expect(requestsTo("/api/tournaments/t-1/entries", "POST")).toHaveLength(0);
  });

  it("routes a setup tournament without a Kick channel to Settings via Add Kick channel", async () => {
    reset({ tournaments: [{ ...base, chat_channel: null }] });
    await mod.boot();
    expect(text("tournament-primary")).toBe("Start tournament");
    expect($id("tournament-chat-signup").disabled).toBe(true);
    expect($id("tournament-chat-signup-state").textContent).toContain("Kick channel required");
    await click("tournament-use-channel");
    expect(requestsTo("/api/tournaments/t-1/signups/open", "POST")).toHaveLength(0);
    expect(requestsTo("/api/tournaments/t-1/settings", "POST")).toHaveLength(0);
    expect(visible("tournament-panel-settings")).toBe(true);
    expect($id("tournament-chat-channel").value).toBe("");
    expect($id("tournament-chat-channel").placeholder).toBe("channelname");
    expect(document.activeElement?.id).toBe("tournament-chat-channel");
  });

  it("offers the connected site channel without presenting it as saved", async () => {
    site.kickChannelName = "36-ates";
    reset({ tournaments: [{ ...base, chat_channel: null }] });
    await mod.boot();
    await click("tournament-tab-settings");
    // The site channel is only a suggestion: nothing is stored yet.
    expect($id("tournament-chat-channel").value).toBe("");
    expect($id("tournament-chat-channel").placeholder).toBe("36-ates");
    expect($id("tournament-settings-bar").hidden).toBe(true);
    const useBtn = $id("tournament-use-channel");
    expect(useBtn.textContent).toContain("Use 36-ates");
    await click("tournament-use-channel");
    const [req] = requestsTo("/api/tournaments/t-1/settings", "POST");
    expect(req.body).toEqual({ chatChannel: "36-ates" });
    expect($id("tournament-chat-channel").value).toBe("36-ates");
    // With a channel stored, the chat-signup switch becomes operable.
    expect($id("tournament-chat-signup").disabled).toBe(false);
  });

  it("prefers the stored tournament channel over the site channel", async () => {
    site.kickChannelName = "other-channel";
    reset({ tournaments: [{ ...base, chat_channel: "saved-channel" }] });
    await mod.boot();
    await click("tournament-tab-settings");
    expect($id("tournament-chat-channel").value).toBe("saved-channel");
    expect($id("tournament-chat-signup").disabled).toBe(false);
    expect(JSON.stringify(server.requests)).not.toContain("other-channel");
  });

  it("shows an operable chat-signup switch when the tournament has a Kick channel", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    const toggle = $id("tournament-chat-signup");
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(text("tournament-chat-signup-state")).toBe("Off");
  });

  it("lets a legacy active/no-bracket tournament change bracket size", async () => {
    reset({ tournaments: [{ ...base, status: "active", signup_state: "closed", bracket_size: 8 }] });
    await mod.boot();
    expect(text("tournament-status")).toBe("Setup");
    await click("tournament-tab-settings");
    expect($id("tournament-bracket-size").disabled).toBe(false);
    expect($id("tournament-entry-cap-mode").disabled).toBe(false);
    await chooseOption("tournament-bracket-size", "16 players");
    await submit("tournament-settings-form");
    const [req] = requestsTo("/api/tournaments/t-1/settings", "POST");
    expect(req.body.bracketSize).toBe(16);
    expect(text("tournament-fact-spots")).toBe("16");
  });

  it("locks bracket size in Settings once matches exist", async () => {
    reset({
      tournaments: [{ ...base, status: "active", signup_state: "locked", bracket_size: 4 }],
      entries: [{ id: "e1", display_name: "a", source: "chat", status: "selected" }],
      matches: [
        { id: "m1", round_number: 1, match_index: 0, player1_name: "a", player2_name: "b", status: "pending" },
        { id: "m2", round_number: 1, match_index: 1, player1_name: "c", player2_name: "d", status: "pending" },
        { id: "m3", round_number: 2, match_index: 0, player1_name: "TBD", player2_name: "TBD", status: "pending" },
      ],
    });
    await mod.boot();
    await click("tournament-tab-settings");
    expect($id("tournament-bracket-size").disabled).toBe(true);
    expect(visible("tournament-bracket-size-hint")).toBe(true);
  });

  it("drives the signup limit field through the bracket/custom/unlimited select", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    await click("tournament-tab-settings");
    // entry_cap null → Unlimited.
    expect(text("tournament-entry-cap-mode")).toBe("Unlimited");
    expect($id("tournament-entry-cap")).toBeNull();
    await chooseOption("tournament-entry-cap-mode", "Custom…");
    expect(visible("tournament-entry-cap")).toBe(true);
    await fill("tournament-entry-cap", "40");
    await submit("tournament-settings-form");
    const [req] = requestsTo("/api/tournaments/t-1/settings", "POST");
    expect(req.body.entryCap).toBe(40);

    // entry_cap === bracket_size preselects "Same as bracket size".
    reset({ tournaments: [{ ...base, entry_cap: 8 }] });
    await mod.boot();
    await click("tournament-tab-settings");
    expect(text("tournament-entry-cap-mode")).toBe("Same as bracket size (8)");
    expect($id("tournament-entry-cap")).toBeNull();

    reset({ tournaments: [{ ...base, entry_cap: 40 }] });
    await mod.boot();
    await click("tournament-tab-settings");
    expect(text("tournament-entry-cap-mode")).toBe("Custom…");
    expect(visible("tournament-entry-cap")).toBe(true);
    expect($id("tournament-entry-cap").value).toBe("40");
  });

  it("gives every settings control the full-width tn-input treatment", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    await click("tournament-tab-settings");
    for (const id of [
      "tournament-title",
      "tournament-game",
      "tournament-bracket-size",
      "tournament-chat-channel",
      "tournament-keyword",
      "tournament-entry-cap-mode",
    ]) {
      expect($id(id).classList.contains("tn-input")).toBe(true);
    }
  });

  it("shows a field error on a rejected save without touching the summary", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    await click("tournament-tab-settings");
    server.failSettings = true;
    await chooseOption("tournament-bracket-size", "16 players");
    await submit("tournament-settings-form");
    expect(visible("tournament-bracket-size-error")).toBe(true);
    expect(text("tournament-bracket-size-error")).toContain("Bracket size");
    expect(text("tournament-message")).toBe("");
    expect(text("tournament-fact-spots")).toBe("8");
  });

  it("tracks dirty state with the settings bar, discard, and saved indicator", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    await click("tournament-tab-settings");
    expect($id("tournament-settings-bar").hidden).toBe(true);
    await fill("tournament-title", "Renamed Cup");
    expect($id("tournament-settings-bar").hidden).toBe(false);
    await click("tournament-settings-discard");
    expect($id("tournament-settings-bar").hidden).toBe(true);
    expect($id("tournament-title").value).toBe("Friday Night Cup");
    await fill("tournament-title", "Renamed Cup");
    await submit("tournament-settings-form");
    expect($id("tournament-settings-bar").hidden).toBe(true);
    expect(visible("tournament-settings-saved")).toBe(true);
  });

  it("shows the live bracket and locks bracket-critical settings once matches exist", async () => {
    reset({
      tournaments: [{ ...base, status: "active", signup_state: "locked", bracket_size: 4 }],
      entries: [{ id: "e1", display_name: "a", source: "chat", status: "selected" }],
      matches: [
        { id: "m1", round_number: 1, match_index: 0, player1_name: "a", player2_name: "b", status: "pending" },
        { id: "m2", round_number: 1, match_index: 1, player1_name: "c", player2_name: "d", status: "pending" },
        { id: "m3", round_number: 2, match_index: 0, player1_name: "TBD", player2_name: "TBD", status: "pending" },
      ],
    });
    await mod.boot();
    expect(text("tournament-status")).toBe("Live");
    expect(visible("tournament-primary")).toBe(false);
    expect(visible("tournament-new")).toBe(true);
    await click("tournament-tab-bracket");
    expect(visible("tournament-bracket-empty")).toBe(false);
    expect($id("tournament-bracket").querySelectorAll(".tn-match")).toHaveLength(3);
    expect($id("tournament-bracket").querySelectorAll("[data-score-match]").length).toBeGreaterThan(0);
    await click("tournament-tab-settings");
    expect($id("tournament-bracket-size").disabled).toBe(true);
    expect(text("tournament-bracket-size-hint")).toContain("locked");
  });

  it("corrects a completed match only after Correct result, then undoes the correction via PATCH", async () => {
    reset({
      tournaments: [{ ...base, status: "active", signup_state: "locked", bracket_size: 4 }],
      matches: [
        { id: "m1", round_number: 1, match_index: 0, player1_name: "a", player2_name: "b", player1_score: 2, player2_score: 1, winner_name: "a", status: "completed", correctable: true },
        { id: "m2", round_number: 1, match_index: 1, player1_name: "c", player2_name: "d", status: "pending" },
        { id: "m3", round_number: 2, match_index: 0, player1_name: "a", player2_name: "TBD", status: "pending" },
      ],
    });
    await mod.boot();
    await click("tournament-tab-bracket");
    const card = () => $id("tournament-bracket").querySelector('.tn-match[data-match-id="m1"]');
    // A completed card is read-only until the streamer asks to correct it.
    expect(card().dataset.correctable).toBe("true");
    expect(card().querySelector("input")).toBeNull();
    const correct = card().querySelector("[data-correct-match]");
    expect(correct.getAttribute("aria-label")).toBe("Correct result: a vs b");
    await clickReactTarget(correct);
    expect(card().dataset.scoreMode).toBe("correct");
    expect(card().dataset.saved).toBe("2,1");
    expect(card().querySelector('[data-score-player="1"]').value).toBe("2");
    expect(card().querySelector('[data-score-player="2"]').value).toBe("1");
    const save = () => card().querySelector(".tn-match-save");
    expect(save().disabled).toBe(true);
    await setReactInputValue(card().querySelector('[data-score-player="1"]'), "1");
    await setReactInputValue(card().querySelector('[data-score-player="2"]'), "3");
    expect(save().disabled).toBe(false);
    expect(card().querySelector("[data-match-pending]").textContent).toBe("b wins 3–1?");
    expect(card().textContent).toContain("Later rounds update.");
    expect(requestsTo("/api/tournaments/t-1/score", "PATCH")).toHaveLength(0);
    await clickReactTarget(save());
    const patches = requestsTo("/api/tournaments/t-1/score", "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({ matchId: "m1", player1Score: 1, player2Score: 3 });
    expect(requestsTo("/api/tournaments/t-1/score", "POST")).toHaveLength(0);
    // The result is reported on the card, not in the page status line.
    expect(card().querySelector("[data-match-feedback]").textContent).toContain("Corrected: b wins 3–1.");
    expect(visible("tournament-message")).toBe(false);
    const undo = card().querySelector("[data-undo-match]");
    expect(document.activeElement).toBe(undo);
    await clickReactTarget(undo);
    expect(requestsTo("/api/tournaments/t-1/score", "PATCH")[1].body).toEqual({ matchId: "m1", player1Score: 2, player2Score: 1 });
    expect(card().querySelector("[data-match-feedback]").textContent).toContain("Correction undone. The previous result is back.");
    expect(card().querySelector("[data-undo-match]")).toBeNull();
  });


  it("keeps Confirm disabled until a corrected score differs from the saved one, and Cancel restores the card", async () => {
    reset({
      tournaments: [{ ...base, status: "active", signup_state: "locked", bracket_size: 4 }],
      matches: [
        { id: "m1", round_number: 1, match_index: 0, player1_name: "a", player2_name: "b", player1_score: 2, player2_score: 1, winner_name: "a", status: "completed", correctable: true },
        { id: "m2", round_number: 2, match_index: 0, player1_name: "a", player2_name: "TBD", status: "pending" },
      ],
    });
    await mod.boot();
    await click("tournament-tab-bracket");
    const card = () => $id("tournament-bracket").querySelector('.tn-match[data-match-id="m1"]');
    const save = () => card().querySelector(".tn-match-save");
    const input = async (player, value) => {
      const el = card().querySelector(`[data-score-player="${player}"]`);
      await setReactInputValue(el, value);
    };
    await clickReactTarget(card().querySelector("[data-correct-match]"));
    expect(save().disabled).toBe(true);
    expect(card().textContent).toContain("Change a score or the winner to correct this result.");
    // A changed value unlocks Confirm; returning it to the saved score re-locks.
    await input(1, "7");
    expect(save().disabled).toBe(false);
    await input(1, "2");
    expect(save().disabled).toBe(true);
    await clickReactTarget(save());
    expect(requestsTo("/api/tournaments/t-1/score", "PATCH")).toHaveLength(0);
    await clickReactTarget(card().querySelector("[data-cancel-match]"));
    expect(card().querySelector("input")).toBeNull();
    expect(document.activeElement).toBe(card().querySelector("[data-correct-match]"));
  });


  for (const [status, winner_name] of [["completed", "alpha"], ["cancelled", null]]) {
    it(`makes Settings fully read-only when the tournament is ${status}`, async () => {
      reset({ tournaments: [{ ...base, status, winner_name, entry_cap: 40, chat_channel: "creator" }] });
      await mod.boot();
      await click("tournament-tab-settings");
      // Read-only is a definition-list view, not a frozen form: no inputs at
      // all in the view, and the hidden form can't be dirtied or submitted.
      expect(visible("tournament-settings-view")).toBe(true);
      expect(visible("tournament-settings-form")).toBe(false);
      expect($id("tournament-settings-view").querySelectorAll("input, select")).toHaveLength(0);
      const view = $id("tournament-settings-view").textContent;
      expect(view).toContain("creator");
      expect(view).toContain("40");
      expect(view).not.toContain("Rules");
      expect($id("tournament-settings-bar").hidden).toBe(true);
      expect($id("tournament-settings-form")).toBeNull();
      expect(requestsTo("/api/tournaments/t-1/settings", "POST")).toHaveLength(0);
    });
  }

  it("shows the champion and a New tournament action when completed", async () => {
    reset({
      tournaments: [{ ...base, status: "completed", signup_state: "locked", bracket_size: 4, winner_name: "alpha" }],
      matches: [{ id: "m1", round_number: 1, match_index: 0, player1_name: "alpha", player2_name: "bravo", player1_score: 2, player2_score: 0, winner_name: "alpha", status: "completed" }],
    });
    await mod.boot();
    expect(text("tournament-status")).toBe("Finished");
    expect(text("tournament-step-label")).toBe("Champion: alpha");
    expect(visible("tournament-primary")).toBe(false);
    expect(visible("tournament-new")).toBe(true);
    await click("tournament-tab-bracket");
    expect(text("tournament-champion")).toBe("Champion: alpha");
    // The 4-player grid pads missing slots with TBD placeholders; the one
    // real match is the completed final.
    expect($id("tournament-bracket").querySelectorAll('.tn-match[data-state="completed"]')).toHaveLength(1);
    await click("tournament-new");
    expect(visible("tournament-create-modal")).toBe(true);
  });

  it("disables Start tournament under 2 eligible players with the reason visible", async () => {
    reset({
      tournaments: [{ ...base, signup_state: "locked" }],
      entries: [{ id: "e1", display_name: "solo", source: "chat", status: "pending" }],
    });
    await mod.boot();
    expect(text("tournament-status")).toBe("Setup");
    expect($id("tournament-primary").disabled).toBe(true);
    expect(text("tournament-primary-reason")).toBe("Add at least 2 players to start.");
    expect($id("tournament-reopen")).toBeNull();
  });

  it("creates the bracket with the eligible count when it fits the capacity", async () => {
    reset({
      tournaments: [{ ...base, signup_state: "locked" }],
      entries: Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, display_name: `p${i}`, source: "chat", status: "pending" })),
    });
    await mod.boot();
    expect(text("tournament-primary")).toBe("Start tournament");

    // Lowering the capacity below the eligible count routes Start to the modal.
    await click("tournament-tab-settings");
    await chooseOption("tournament-bracket-size", "4 players");
    await submit("tournament-settings-form");
    expect(requestsTo("/api/tournaments/t-1/settings", "POST")[0].body.bracketSize).toBe(4);
    await click("tournament-tab-entries");
    expect(text("tournament-primary")).toBe("Start tournament");
    await click("tournament-primary");
    expect(visible("tournament-select-modal")).toBe(true);
  });

  it("drives the select-participants modal in random and manual modes", async () => {
    reset({
      tournaments: [{ ...base, signup_state: "locked", bracket_size: 8 }],
      entries: Array.from({ length: 22 }, (_, i) => ({ id: `e${i}`, display_name: `player${String(i).padStart(2, "0")}`, source: "chat", status: "pending" })),
    });
    await mod.boot();
    expect(text("tournament-primary")).toBe("Start tournament");
    await click("tournament-primary");
    expect(visible("tournament-select-modal")).toBe(true);
    expect(text("ts-random-text")).toBe("Randomly select 8 of 22 eligible players.");
    expect(visible("ts-pane-random")).toBe(true);
    expect(visible("ts-pane-manual")).toBe(false);

    // Random submit posts mode only.
    await click("tournament-select-submit");
    const [randomReq] = requestsTo("/api/tournaments/t-1/entries/select", "POST");
    expect(randomReq.body).toEqual({ mode: "random", seeding: "signup" });
    expect(visible("tournament-select-modal")).toBe(false);

    // Manual mode: checkboxes gate the submit on exactly CAP selections.
    reset({
      tournaments: [{ ...base, signup_state: "locked", bracket_size: 8 }],
      entries: Array.from({ length: 22 }, (_, i) => ({ id: `e${i}`, display_name: `player${String(i).padStart(2, "0")}`, source: "chat", status: "pending" })),
    });
    await mod.boot();
    await click("tournament-primary");
    await clickReactTarget($id("ts-mode-manual"));
    expect(visible("ts-pane-manual")).toBe(true);
    expect($id("ts-entry-list").querySelectorAll('[role="checkbox"]')).toHaveLength(22);
    expect(text("ts-counter")).toBe("Selected 0 / 8");
    expect($id("tournament-select-submit").disabled).toBe(true);

    // Search filters the list client-side.
    await fill("ts-search", "player1");
    expect($id("ts-entry-list").querySelectorAll('[role="checkbox"]')).toHaveLength(10);
    await fill("ts-search", "");

    const boxes = [...$id("ts-entry-list").querySelectorAll('[role="checkbox"]')];
    for (const box of boxes.slice(0, 6)) {
      await clickReactTarget(box);
    }
    expect(text("ts-counter")).toBe("Selected 6 / 8");
    expect($id("tournament-select-submit").disabled).toBe(true);
    for (const box of boxes.slice(6, 8)) {
      await clickReactTarget(box);
    }
    expect(text("ts-counter")).toBe("Selected 8 / 8");
    expect($id("tournament-select-submit").disabled).toBe(false);

    await click("tournament-select-submit");
    const manualReqs = requestsTo("/api/tournaments/t-1/entries/select", "POST");
    const manualReq = manualReqs[manualReqs.length - 1];
    expect(manualReq.body.mode).toBe("manual");
    expect(manualReq.body.seeding).toBe("signup");
    expect(manualReq.body.entryIds).toEqual(["e0", "e1", "e2", "e3", "e4", "e5", "e6", "e7"]);
  });

  it("selects the first bracket-sized set by server eligible_rank", async () => {
    reset({
      tournaments: [{ ...base, signup_state: "locked", bracket_size: 4 }],
      entries: [
        { id: "later", display_name: "Later", source: "chat", status: "pending", created_at: "2026-02-02" },
        { id: "first", display_name: "First", source: "chat", status: "pending", created_at: "2026-02-01" },
        { id: "third", display_name: "Third", source: "chat", status: "pending", created_at: "2026-02-03" },
        { id: "fourth", display_name: "Fourth", source: "chat", status: "pending", created_at: "2026-02-04" },
        { id: "fifth", display_name: "Fifth", source: "chat", status: "pending", created_at: "2026-02-05" },
      ],
    });
    await mod.boot();
    await click("tournament-primary");
    await clickReactTarget($id("ts-mode-manual"));
    await click("ts-select-first");
    expect(text("ts-counter")).toBe("Selected 4 / 4");
    expect([...$id("ts-entry-list").querySelectorAll('[role="checkbox"][aria-checked="true"]')].map((input) => input.getAttribute("value")))
      .toEqual(["later", "first", "third", "fourth"]);
    expect($id("tournament-select-submit").disabled).toBe(false);
  });

  it("uses the server eligible flag — an approved flagged entrant counts and is selectable", async () => {
    reset({
      tournaments: [{ ...base, signup_state: "locked", bracket_size: 8 }],
      entries: [
        { id: "e1", display_name: "normal", source: "chat", status: "pending", eligible: true },
        { id: "e2", display_name: "approved-flag", source: "chat", status: "pending", alt_flag: true, eligible: true },
        { id: "e3", display_name: "unapproved-flag", source: "chat", status: "pending", alt_flag: true, eligible: false },
      ],
    });
    await mod.boot();
    // counts.eligible = 2: the unapproved flag is excluded by the server.
    expect(text("tournament-primary")).toBe("Start tournament");
    expect($id("tournament-primary").disabled).toBe(false);

    // Oversubscribed: 9 eligible (one approved flag) for cap 8 → manual modal.
    reset({
      tournaments: [{ ...base, signup_state: "locked", bracket_size: 8 }],
      entries: [
        { id: "flag", display_name: "approved-flag", source: "chat", status: "pending", alt_flag: true, eligible: true },
        ...Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, display_name: `player${i}`, source: "chat", status: "pending", eligible: true })),
        { id: "inel", display_name: "not-eligible", source: "chat", status: "pending", alt_flag: true, eligible: false },
      ],
    });
    await mod.boot();
    expect(text("tournament-primary")).toBe("Start tournament");
    await click("tournament-primary");
    await clickReactTarget($id("ts-mode-manual"));
    const boxes = [...$id("ts-entry-list").querySelectorAll('[role="checkbox"]')];
    // The 9 eligible rows are listed; the ineligible one is not.
    expect(boxes).toHaveLength(9);
    expect(boxes.map((b) => b.getAttribute("value"))).toContain("flag");
    expect(boxes.map((b) => b.getAttribute("value"))).not.toContain("inel");

    for (const box of boxes.filter((b) => b.getAttribute("value") !== "e0")) {
      await clickReactTarget(box);
    }
    expect(text("ts-counter")).toBe("Selected 8 / 8");
    await click("tournament-select-submit");
    const reqs = requestsTo("/api/tournaments/t-1/entries/select", "POST");
    const last = reqs[reqs.length - 1];
    expect(last.body.entryIds).toContain("flag");
    expect(last.body.entryIds).toHaveLength(8);
  });

  it("renders BYE matches without score inputs", async () => {
    const BYE_SLOT = "__YOURRANK_INTERNAL_BYE__";
    reset({
      tournaments: [{ ...base, status: "active", signup_state: "locked", bracket_size: 4 }],
      entries: [{ id: "e1", display_name: "Alice", source: "chat", status: "selected" }],
      matches: [
        { id: "m1", round_number: 1, match_index: 0, player1_name: "Alice", player2_name: BYE_SLOT, status: "completed", winner_name: "Alice" },
        { id: "m2", round_number: 1, match_index: 1, player1_name: BYE_SLOT, player2_name: BYE_SLOT, status: "completed", winner_name: BYE_SLOT },
        { id: "m3", round_number: 2, match_index: 0, player1_name: "Alice", player2_name: "TBD", status: "pending" },
      ],
    });
    await mod.boot();
    await click("tournament-tab-bracket");
    const matches = [...$id("tournament-bracket").querySelectorAll(".tn-match")];
    expect(matches).toHaveLength(3);
    // Alice vs BYE: no inputs, no score, BYE tag, sentinel never leaks.
    expect(matches[0].dataset.state).toBe("bye");
    expect(matches[0].querySelectorAll("input")).toHaveLength(0);
    expect(matches[0].textContent).not.toContain(BYE_SLOT);
    expect(matches[0].textContent).toContain("Alice");
    expect(matches[0].textContent).toContain("BYE");
    expect(matches[0].querySelector(".tn-bye-tag")).toBeTruthy();
    expect(matches[0].textContent).not.toContain("0 - 0");
    // BYE vs BYE: dashed void line reading BYE / BYE.
    expect(matches[1].dataset.state).toBe("void");
    expect(matches[1].textContent).not.toContain(BYE_SLOT);
    expect(matches[1].textContent).toContain("BYE");
    expect(matches[1].querySelectorAll("input")).toHaveLength(0);
    // The bracket explains BYEs once, above the scroller.
    expect($id("tournament-bracket").querySelector("[data-bye-note]")).toBeTruthy();
    // A half-known final names the finalist and the semifinal still to be decided.
    expect(matches[2].dataset.state).toBe("waiting");
    expect(matches[2].textContent).toContain("Alice");
    expect(matches[2].textContent).toContain("Waiting for winner of Semifinal 2");
    expect(matches[2].textContent).not.toContain("Waiting for semifinalists");
    expect(matches[2].querySelectorAll("input")).toHaveLength(0);
  });

  it("still shows score inputs for a real-versus-real pending match", async () => {
    reset({
      tournaments: [{ ...base, status: "active", signup_state: "locked", bracket_size: 4 }],
      matches: [
        // "BYE" here is a real player's display name, not the sentinel.
        { id: "m1", round_number: 1, match_index: 0, player1_name: "BYE", player2_name: "Bob", status: "pending" },
      ],
    });
    await mod.boot();
    await click("tournament-tab-bracket");
    const match = $id("tournament-bracket").querySelector(".tn-match");
    expect(match.querySelectorAll("input[data-score-player]")).toHaveLength(2);
  });

  it("saves a picked winner only after Confirm, and only once when Confirm is double-clicked", async () => {
    reset({
      tournaments: [{ ...base, status: "active", signup_state: "locked", bracket_size: 4 }],
      matches: [
        { id: "m1", round_number: 1, match_index: 0, player1_name: "Alice", player2_name: "Bob", status: "pending" },
      ],
    });
    await mod.boot();
    expect(text("tournament-step-label")).toBe("In the Bracket tab, pick each match's winner or enter scores, then confirm.");
    await click("tournament-tab-bracket");
    const card = () => $id("tournament-bracket").querySelector('.tn-match[data-match-id="m1"]');
    expect(card().querySelector("[data-advance-match]")).toBeNull();
    const pick = card().querySelector('[data-pick-match="m1"][data-winner-slot="2"]');
    expect(pick.tagName).toBe("BUTTON");
    expect(pick.getAttribute("aria-label")).toBe("Winner: Bob");
    expect(pick.getAttribute("aria-pressed")).toBe("false");
    await clickReactTarget(pick);
    // Picking a winner is only a pending decision.
    expect(requestsTo("/api/tournaments/t-1/score", "POST")).toHaveLength(0);
    expect(pick.getAttribute("aria-pressed")).toBe("true");
    expect(card().querySelector("[data-match-pending]").textContent).toBe("Bob wins?");
    const confirm = card().querySelector(".tn-match-save");
    expect(confirm.disabled).toBe(false);
    expect(confirm.getAttribute("aria-label")).toBe("Confirm result: Bob wins");
    let releaseScore;
    server.scoreGate = new Promise((resolve) => { releaseScore = resolve; });
    await actAndFlush(() => firePointerClick(confirm));
    expect(confirm.disabled).toBe(true);
    await actAndFlush(() => firePointerClick(confirm));
    expect(requestsTo("/api/tournaments/t-1/score", "POST")).toHaveLength(1);
    await actAndFlush(() => releaseScore());
    expect(requestsTo("/api/tournaments/t-1/score", "POST")).toHaveLength(1);
    expect(requestsTo("/api/tournaments/t-1/score", "POST")[0].body)
      .toEqual({ matchId: "m1", winnerSlot: 2 });
    expect(card().querySelector("[data-match-feedback]").textContent).toContain("Saved: Bob wins.");
  });

  it("starts with empty score inputs, blocks ties inline, then saves scores and undoes via PATCH reopen", async () => {
    reset({
      tournaments: [{ ...base, status: "active", signup_state: "locked", bracket_size: 4 }],
      matches: [
        { id: "m1", round_number: 1, match_index: 0, player1_name: "Alice", player2_name: "Bob", status: "pending" },
        { id: "m2", round_number: 1, match_index: 1, player1_name: "Cara", player2_name: "Dan", status: "pending" },
        { id: "m3", round_number: 2, match_index: 0, player1_name: "TBD", player2_name: "TBD", status: "pending" },
      ],
    });
    await mod.boot();
    await click("tournament-tab-bracket");
    const card = () => $id("tournament-bracket").querySelector('.tn-match[data-match-id="m1"]');
    const score = (player) => card().querySelector(`[data-score-player="${player}"]`);
    const save = () => card().querySelector(".tn-match-save");
    expect(score(1).value).toBe("");
    expect(score(2).value).toBe("");
    expect(score(1).placeholder).toBe("–");
    expect(score(1).getAttribute("aria-label")).toBe("Alice score");
    expect(save().disabled).toBe(true);
    expect(card().querySelector(".tn-match-msg").textContent).toBe("Pick the winner or enter scores.");
    await setReactInputValue(score(1), "2");
    expect(save().disabled).toBe(true);
    expect(card().querySelector(".tn-match-msg").textContent).toBe("Enter both scores, or clear them to pick a winner only.");
    await setReactInputValue(score(2), "2");
    const error = card().querySelector("[data-match-error]");
    expect(error.textContent).toBe("Scores are tied. A match needs a winner, so change one score.");
    expect(score(1).getAttribute("aria-invalid")).toBe("true");
    expect(score(1).getAttribute("aria-describedby")).toBe(error.closest(".tn-match-msg").id);
    expect(save().disabled).toBe(true);
    expect(visible("tournament-message")).toBe(false);
    await setReactInputValue(score(2), "1");
    expect(card().querySelector("[data-match-pending]").textContent).toBe("Alice wins 2–1?");
    expect(requestsTo("/api/tournaments/t-1/score", "POST")).toHaveLength(0);
    await clickReactTarget(save());
    expect(requestsTo("/api/tournaments/t-1/score", "POST")[0].body).toEqual({ matchId: "m1", player1Score: 2, player2Score: 1 });
    expect(card().dataset.state).toBe("completed");
    expect(card().querySelector("[data-match-feedback]").textContent).toContain("Saved: Alice wins 2–1.");
    const undo = card().querySelector("[data-undo-match]");
    expect(undo.getAttribute("aria-label")).toBe("Undo result: Alice vs Bob");
    expect(document.activeElement).toBe(undo);
    await clickReactTarget(undo);
    expect(requestsTo("/api/tournaments/t-1/score", "PATCH")[0].body).toEqual({ matchId: "m1", reopen: true });
    expect(card().dataset.state).toBe("scorable");
    expect(score(1).value).toBe("");
    expect(card().querySelector("[data-match-feedback]").textContent).toContain("Result undone. Pick the winner again.");
    expect(document.activeElement).toBe(card().querySelector("[data-pick-match]"));
  });

  it("shows a champion card with the final score and runner-up on the Bracket tab", async () => {
    reset({
      tournaments: [{ ...base, status: "completed", signup_state: "locked", bracket_size: 4, winner_name: "Bob" }],
      matches: [
        { id: "m1", round_number: 1, match_index: 0, player1_name: "Alice", player2_name: "Cara", player1_score: 2, player2_score: 0, winner_name: "Alice", status: "completed" },
        { id: "m2", round_number: 1, match_index: 1, player1_name: "Bob", player2_name: "Dan", player1_score: 2, player2_score: 1, winner_name: "Bob", status: "completed" },
        { id: "m3", round_number: 2, match_index: 0, player1_name: "Alice", player2_name: "Bob", player1_score: 1, player2_score: 3, winner_name: "Bob", status: "completed" },
      ],
    });
    await mod.boot();
    await click("tournament-tab-bracket");
    const champion = $id("tournament-champion-card");
    expect(visible("tournament-champion-card")).toBe(true);
    expect(champion.querySelector("[data-champion-name]").textContent).toBe("Bob");
    expect(champion.querySelector("[data-champion-score]").textContent).toBe("3–1");
    expect(champion.querySelector("[data-runner-up]").textContent).toBe("Alice");
    expect($id("tournament-bracket").querySelector("[data-correct-match]")).toBeNull();
  });

  it("orders setup next steps and points the empty bracket at the header Start button", async () => {
    reset({ tournaments: [{ ...base }] });
    await mod.boot();
    const steps = [...$id("tournament-next-steps").querySelectorAll("[data-step]")];
    expect(steps.map((step) => step.dataset.step)).toEqual(["signups", "players", "start"]);
    expect(text("tournament-join-command")).toBe("!join");
    expect(text("tournament-join-hint")).toBe("Viewers type !join in kick.com/creator chat.");
    expect(steps[0].contains($id("tournament-chat-signup"))).toBe(true);
    expect(steps[2].contains($id("tournament-seeding-signup"))).toBe(true);
    await click("tournament-tab-bracket");
    expect(text("tournament-bracket-empty")).toContain("Press Start tournament at the top of this page");
    await click("tournament-tab-entries");
    await clickReactTarget($id("tournament-advanced").querySelector("button"));
    const reviews = $id("tournament-advanced").querySelector('a[href^="/dashboard/audience/reviews"]');
    expect(reviews.textContent).toBe("Audience → Reviews");
    expect(reviews.getAttribute("href")).toBe("/dashboard/audience/reviews?siteId=site-1");
  });


  it("confirms deletion with a trimmed exact title and displays inline server errors", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    await click("tournament-tab-settings");
    await click("tournament-delete");
    expect($id("tournament-delete-modal").textContent).toContain("This deletes the tournament and all its entries. This can't be undone.");
    expect($id("tournament-delete-modal").querySelector('label[for="td-confirm"]').textContent)
      .toBe('Type “Friday Night Cup” to confirm');
    await fill("td-confirm", "  Friday Night Cup  ");
    expect($id("tournament-delete-submit").disabled).toBe(false);

    server.deleteError = { error: "Deletion is temporarily unavailable." };
    await submit("tournament-delete-form");
    expect(text("tournament-delete-error")).toBe("Deletion is temporarily unavailable.");
    expect(visible("tournament-delete-modal")).toBe(true);

    server.deleteError = null;
    await submit("tournament-delete-form");
    expect(requestsTo("/api/tournaments/t-1/delete", "POST").at(-1).body)
      .toEqual({ confirmTitle: "  Friday Night Cup  " });
    expect(visible("tournament-delete-modal")).toBe(false);
    expect(visible("tournament-empty")).toBe(true);
    expect(text("tournament-message")).toBe("Deleted “Friday Night Cup”.");
    expect(window.sessionStorage.getItem("yr:tournament:site-1")).toBeNull();
  });

  it("maps settings field errors and retries with the server-provided fix", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    await click("tournament-tab-settings");
    server.settingsError = {
      ok: false,
      error: "Set signup limit to 4.",
      field: "entryCap",
      fix: { label: "Keep signup limit at 8", settings: { entryCap: 8 } },
    };
    await submit("tournament-settings-form");
    expect(text("tournament-entry-cap-error")).toContain("Set signup limit to 4.");
    const fix = $id("tournament-settings-fix");
    expect(fix.textContent).toBe("Keep signup limit at 8");
    server.settingsError = null;
    await click("tournament-settings-fix");
    const settingsPosts = requestsTo("/api/tournaments/t-1/settings", "POST");
    expect(settingsPosts).toHaveLength(2);
    expect(settingsPosts[1].body.entryCap).toBe(8);
  });

  it("shows blank-title settings errors in the title field", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    await click("tournament-tab-settings");
    await fill("tournament-title", "  ");
    server.settingsError = {
      ok: false,
      error: "Enter a tournament name.",
      field: "title",
    };
    await submit("tournament-settings-form");
    expect(text("tournament-title-error")).toBe("Enter a tournament name.");
    expect(text("tournament-message")).toBe("");
  });
});

  it("keeps a dirty settings form intact through an entries refresh", async () => {
    reset({
      tournaments: [{ ...base, status: "draft", signup_state: "open" }],
      entries: [{ id: "e1", display_name: "one", source: "chat", status: "pending" }],
    });
    await mod.boot();
    await click("tournament-tab-settings");
    // Dirty the form while the settings tab is visible.
    await fill("tournament-title", "Typed but unsaved");
    expect($id("tournament-settings-bar").hidden).toBe(false);
    // An entry action is one loadEntries() path — the same refresh the 15s
    // poll and chat webhook take. The form must keep its edit and the bar.
    server.entries = [
      { id: "e1", display_name: "one", source: "chat", status: "pending" },
      { id: "e2", display_name: "two", source: "chat", status: "pending" },
    ];
    await click("tournament-tab-entries");
    const row = $id("tournament-entry-list").querySelector(".tn-entry");
    await clickReactTarget(row.querySelector("button[aria-label^='Actions for']"));
    await clickReactTarget(document.querySelector("[data-entry-action='remove']"));
    // The data updates still landed.
    expect(text("tournament-count")).toBe("2");
    expect(text("tournament-tab-entries")).toBe("Entries (2)");
    expect($id("tournament-entry-list").textContent).toContain("two");
    await click("tournament-tab-settings");
    expect($id("tournament-title").value).toBe("Typed but unsaved");
    expect($id("tournament-settings-bar").hidden).toBe(false);
  });
