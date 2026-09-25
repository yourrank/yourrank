// Behavioral coverage for the Tournament lifecycle UI: the real tournaments.js
// runs against the rendered Engage markup in a DOM with an in-memory API.
// Lifecycle is derived from the server's status/signup_state/matches only.
//
// Run: bun test src/__tests__/tournament-lifecycle-ui.test.js

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { renderGiveawaysHtml } from "../pages/giveaway-pages.js";

const window = new Window({ url: "http://localhost/dashboard/giveaways/tournaments?siteId=site-1" });
const { document } = window;
const INSTALLED_GLOBALS = ["window", "document", "location", "history", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "DOMParser", "getComputedStyle", "matchMedia", "localStorage", "fetch"];
const originalGlobals = Object.fromEntries(INSTALLED_GLOBALS.map((k) => [k, globalThis[k]]));
for (const key of INSTALLED_GLOBALS.slice(0, 15)) {
  globalThis[key] = key === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[key];
}
window.Element.prototype.scrollIntoView = function () {};
window.Element.prototype.getClientRects = function () { return [{}]; };
globalThis.localStorage = window.localStorage;
window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.matchMedia = window.matchMedia;
// Markup-hosted dialogs use YRDialog.trap; provide the contract without loading the asset.
window.YRDialog = { trap: () => () => {}, confirm: async () => true };

const user = { id: "user-1", email: "creator@example.com", plan: "pro", emailVerified: true };
const site = { id: "site-1", name: "Kick Cup", slug: "kick-cup", published: true, userRole: "owner", kickChannelName: "" };

const server = { tournaments: [], entries: [], matches: [], requests: [] };
function reset({ tournaments = [], entries = [], matches = [] } = {}) {
  server.tournaments = tournaments.map((t) => ({ ...t }));
  server.entries = entries.map((e) => ({ ...e }));
  server.matches = matches.map((m) => ({ ...m }));
  server.requests.length = 0;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const base = {
  id: "t-1", title: "Community Tournament", game_name: "Game", bracket_size: 8, status: "draft",
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
    if (![4, 8, 16, 32].includes(body.bracketSize)) return json({ error: "Unsupported bracket size." }, 400);
    const tournament = {
      ...base, id: `t-${server.tournaments.length + 1}`, title: body.title, game_name: body.gameName,
      bracket_size: body.bracketSize, format: body.format, entry_cap: body.entryCap,
      entry_keyword: body.entryKeyword, chat_channel: body.chatChannel || null,
    };
    server.tournaments.unshift(tournament);
    return json({ ok: true, tournament });
  }
  if (path === "/api/tournaments") return json({ ok: true, tournaments: server.tournaments });
  const current = server.tournaments[0];
  if (path.endsWith("/entries")) return json({ ok: true, entries: server.entries });
  if (path.endsWith("/bracket")) return json({ ok: true, tournament: current, matches: server.matches });
  if (path.endsWith("/signups/open")) { current.signup_state = "open"; return json({ ok: true, tournament: current }); }
  if (path.endsWith("/signups/lock")) { current.signup_state = "locked"; return json({ ok: true, tournament: current }); }
  if (path.endsWith("/settings")) { Object.assign(current, { title: body.title || current.title }); return json({ ok: true, tournament: current }); }
  if (path === "/api/giveaways/chatroom") return json({ error: "offline" }, 404);
  return json({ ok: true });
};
const requestsTo = (path, method) => server.requests.filter((r) => r.path === path && (!method || r.method === method));

window.__yrSpaShell = true;
document.body.innerHTML = renderGiveawaysHtml("tournaments");

const $id = (id) => document.getElementById(id);
const text = (id) => $id(id)?.textContent.trim();
const visible = (id) => { const el = $id(id); return Boolean(el) && !el.hidden && !el.closest("[hidden]"); };

async function flush() {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
}

const mod = await import("../assets/tournaments.js");
await flush();

async function click(id) {
  $id(id).dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await flush();
}

async function submit(id) {
  $id(id).dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await flush();
}

afterAll(() => {
  for (const key of INSTALLED_GLOBALS) globalThis[key] = originalGlobals[key];
});

describe("tournament lifecycle UI", () => {
  beforeEach(async () => {
    reset();
    await mod.boot();
    await flush();
  });

  it("derives the lifecycle from server fields only", () => {
    expect(mod.lifecycleOf(null)).toBe("none");
    expect(mod.lifecycleOf({ status: "draft", signup_state: "closed" })).toBe("draft");
    expect(mod.lifecycleOf({ status: "draft", signup_state: "open" })).toBe("signups_open");
    expect(mod.lifecycleOf({ status: "draft", signup_state: "locked" })).toBe("signups_locked");
    expect(mod.lifecycleOf({ status: "active", signup_state: "locked" }, 4)).toBe("bracket");
    expect(mod.lifecycleOf({ status: "completed", signup_state: "locked" }, 4)).toBe("completed");
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
    expect($id("tournament-create-modal").classList.contains("modal")).toBe(true);
    expect(visible("tournament-empty")).toBe(true);
    const sizes = [...$id("tc-bracket-size").options].map((o) => Number(o.value));
    expect(sizes).toEqual([4, 8, 16, 32]);
    expect([...$id("tc-format").options].map((o) => o.value)).toEqual(["bracket", "1v1"]);
    expect($id("tc-bracket-size").value).toBe("8");
    expect($id("tc-entry-cap").value).toBe("");
    expect($id("tc-title").value).toBe("Community Tournament");
    expect($id("tc-keyword").value).toBe("!join");
    await click("tournament-create-cancel");
    expect(visible("tournament-create-modal")).toBe(false);
    expect(requestsTo("/api/tournaments", "POST")).toHaveLength(0);
  });

  it("sends the selected values to the API and renders the Draft state", async () => {
    await click("tournament-create");
    $id("tc-title").value = "Friday Cup";
    $id("tc-game").value = "Fortnite";
    $id("tc-format").value = "1v1";
    $id("tc-bracket-size").value = "4";
    $id("tc-chat-channel").value = "36_ates";
    $id("tc-keyword").value = "!cup";
    await submit("tournament-create-form");

    const [post] = requestsTo("/api/tournaments", "POST");
    expect(post.body).toEqual({
      siteId: "site-1", title: "Friday Cup", gameName: "Fortnite", format: "1v1", bracketSize: 4,
      entryCap: null, chatChannel: "36_ates", entryKeyword: "!cup",
    });
    expect(visible("tournament-create-modal")).toBe(false);
    expect(visible("tournament-empty")).toBe(false);
    expect(visible("tournament-workspace")).toBe(true);
    expect(text("tournament-status")).toBe("Draft");
    expect(text("tournament-title-display")).toBe("Friday Cup");
    expect(text("tournament-meta")).toBe("Fortnite · 1v1 · 4-player bracket");
    expect(text("tournament-fact-channel")).toBe("36_ates");
    expect(text("tournament-fact-keyword")).toBe("!cup");
    expect(text("tournament-fact-cap")).toBe("Unlimited");
    expect(text("tournament-count")).toBe("0");
    expect(text("tournament-primary")).toBe("Open signups");
    expect($id("tournament-entries-empty").textContent).toContain("No entries yet.");
    expect($id("tournament-entries-empty").textContent).toContain("Open signups when you're ready for viewers to join.");
  });

  it("sends a custom signup limit independently of the bracket size", async () => {
    await click("tournament-create");
    $id("tc-bracket-size").value = "8";
    $id("tc-entry-cap").value = "custom";
    $id("tc-entry-cap").dispatchEvent(new window.Event("change", { bubbles: true }));
    await flush();
    expect(visible("tc-entry-cap-custom")).toBe(true);
    $id("tc-entry-cap-custom").value = "40";
    await submit("tournament-create-form");
    const [post] = requestsTo("/api/tournaments", "POST");
    expect(post.body.bracketSize).toBe(8);
    expect(post.body.entryCap).toBe(40);
    expect(text("tournament-fact-cap")).toBe("40");
    expect(text("tournament-fact-spots")).toBe("8");
  });

  it("refuses to submit an unsupported bracket size", async () => {
    await click("tournament-create");
    const option = document.createElement("option");
    option.value = "6";
    $id("tc-bracket-size").appendChild(option);
    $id("tc-bracket-size").value = "6";
    await submit("tournament-create-form");
    expect(requestsTo("/api/tournaments", "POST")).toHaveLength(0);
    expect(visible("tournament-create-modal")).toBe(true);
    expect(text("tournament-create-error")).toContain("4, 8, 16, 32");
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
    expect($id("tournament-bracket").querySelectorAll(".tournament-match")).toHaveLength(0);
    await click("tournament-tab-settings");
    expect(visible("tournament-panel-settings")).toBe(true);
    expect(visible("tournament-settings-form")).toBe(true);
    expect($id("tournament-format").disabled).toBe(false);
    expect($id("tournament-bracket-size").disabled).toBe(false);
  });

  it("walks Draft → Signups open → Signups locked with one primary action each", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    expect(text("tournament-status")).toBe("Draft");
    expect($id("tournament-primary").dataset.action).toBe("open");

    await click("tournament-primary");
    expect(requestsTo("/api/tournaments/t-1/signups/open", "POST")).toHaveLength(1);
    expect(text("tournament-status")).toBe("Signups open");
    expect(text("tournament-primary")).toBe("Lock signups");

    server.entries = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, display_name: `viewer${i}`, source: "chat", status: "pending" }));
    await click("tournament-primary");
    expect(requestsTo("/api/tournaments/t-1/signups/lock", "POST")).toHaveLength(1);
    expect(text("tournament-status")).toBe("Signups locked");
    expect(text("tournament-primary")).toBe("Pick participants");
    // The pick always fills the bracket: 5 eligible entries can't fill 8 spots.
    expect($id("tournament-primary").disabled).toBe(true);
    expect(text("tournament-step-label")).toBe("Need 3 more eligible players.");
    expect(text("tournament-count")).toBe("5");
    expect(text("tournament-fact-spots")).toBe("8");
    // Format is now locked because entries exist; bracket size is still open.
    await click("tournament-tab-settings");
    expect($id("tournament-format").disabled).toBe(true);
    expect(visible("tournament-format-hint")).toBe(true);
    expect($id("tournament-bracket-size").disabled).toBe(false);

    server.entries = Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, display_name: `viewer${i}`, source: "chat", status: "pending" }));
    await mod.boot();
    expect(text("tournament-step-label")).toBe("8 eligible entries for 8 bracket spots. Picking is random.");
    expect($id("tournament-primary").disabled).toBe(false);
    // The real dialog.js may have replaced the stub; approve on whatever is live.
    window.YRDialog.confirm = async () => true;
    await click("tournament-primary");
    const [pick] = requestsTo("/api/tournaments/t-1/entries/random-pick", "POST");
    expect(pick.body).toEqual({ count: 8 });
  });

  it("refuses to open signups without a Kick channel and points to Settings", async () => {
    reset({ tournaments: [{ ...base, chat_channel: null }] });
    await mod.boot();
    await click("tournament-primary");
    expect(requestsTo("/api/tournaments/t-1/signups/open", "POST")).toHaveLength(0);
    expect(text("tournament-message")).toContain("Kick channel");
    expect(visible("tournament-panel-settings")).toBe(true);
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
    expect(text("tournament-status")).toBe("Bracket live");
    expect(visible("tournament-primary")).toBe(false);
    expect(visible("tournament-new")).toBe(false);
    await click("tournament-tab-bracket");
    expect(visible("tournament-bracket-empty")).toBe(false);
    expect($id("tournament-bracket").querySelectorAll(".tournament-match")).toHaveLength(3);
    expect($id("tournament-bracket").querySelectorAll("[data-score-match]").length).toBeGreaterThan(0);
    await click("tournament-tab-settings");
    expect($id("tournament-format").disabled).toBe(true);
    expect($id("tournament-bracket-size").disabled).toBe(true);
    expect(text("tournament-bracket-size-hint")).toContain("locked");
  });

  it("shows the champion and a New tournament action when completed", async () => {
    reset({
      tournaments: [{ ...base, status: "completed", signup_state: "locked", bracket_size: 4, winner_name: "alpha" }],
      matches: [{ id: "m1", round_number: 1, match_index: 0, player1_name: "alpha", player2_name: "bravo", player1_score: 2, player2_score: 0, winner_name: "alpha", status: "completed" }],
    });
    await mod.boot();
    expect(text("tournament-status")).toBe("Completed");
    expect(text("tournament-step-label")).toBe("Champion: alpha");
    expect(visible("tournament-primary")).toBe(false);
    expect(visible("tournament-new")).toBe(true);
    await click("tournament-tab-bracket");
    expect(text("tournament-champion")).toBe("Champion: alpha");
    expect($id("tournament-bracket").querySelectorAll(".tournament-match")).toHaveLength(1);
    await click("tournament-new");
    expect(visible("tournament-create-modal")).toBe(true);
  });
});
