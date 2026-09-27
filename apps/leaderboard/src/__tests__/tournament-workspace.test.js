// Workspace coverage for the redesigned Tournament UI: the real pane markup
// (renderGiveawaysHtml("tournaments")) runs against the real tournaments.js
// with an in-memory API. Covers the new header, entries table, bracket
// layout + summary aside + full-bracket modal, and the Settings read-only
// view for finished tournaments.
//
// Run: bun test src/__tests__/tournament-workspace.test.js

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { renderGiveawaysHtml, renderGiveawaysContentHtml } from "../pages/giveaway-pages.js";
import { clearSession } from "../assets/dashboard/session.js";

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
window.YRDialog = { trap: () => () => {}, confirm: async () => true };

const user = { id: "user-1", email: "creator@example.com", plan: "pro", emailVerified: true };
const site = { id: "site-1", name: "Kick Cup", slug: "kick-cup", published: true, userRole: "owner", kickChannelName: "" };
const BYE = "__YOURRANK_INTERNAL_BYE__";
const completed = {
  id: "tourn_8f3a2c", title: "Community tournament", game_name: "", bracket_size: 8,
  status: "completed", signup_state: "closed", entry_cap: null, format: "bracket",
  anti_alt_enabled: false, entry_keyword: "!join", chat_channel: "36-ates",
  winner_name: "36_ates", created_at: "2026-09-20T14:32:00Z",
};
const draft = {
  id: "t-2", title: "Community Cup", game_name: "Rocket League", bracket_size: 8,
  status: "draft", signup_state: "closed", entry_cap: null, format: "bracket",
  anti_alt_enabled: false, entry_keyword: "!join", chat_channel: "", winner_name: null,
  created_at: "2026-09-21T10:00:00Z",
};
const openSignups = { ...draft, id: "t-3", signup_state: "open", chat_channel: "36-ates" };
const match = (id, round_number, match_index, p1, p2, s1, s2, winner) =>
  ({ id, round_number, match_index, player1_name: p1, player2_name: p2, player1_score: s1, player2_score: s2, winner_name: winner, status: "completed" });
const completedMatches = [
  match("m1", 1, 0, "36_ates", "forolo_GB", 1, 0, "36_ates"),
  match("m2", 1, 1, BYE, BYE, null, null, BYE),
  match("m3", 1, 2, BYE, BYE, null, null, BYE),
  match("m4", 1, 3, BYE, BYE, null, null, BYE),
  match("m5", 2, 0, "36_ates", BYE, null, null, "36_ates"),
  match("m6", 2, 1, BYE, BYE, null, null, BYE),
  match("m7", 3, 0, "36_ates", BYE, null, null, "36_ates"),
];
const completedEntries = [
  { id: "e1", display_name: "36_ates", source: "chat", status: "selected", eligible: true, alt_flag: false },
  { id: "e2", display_name: "forolo_GB", source: "chat", status: "selected", eligible: true, alt_flag: false },
];

const server = { tournament: completed, entries: [], matches: [], requests: [] };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = async (input, init = {}) => {
  const path = String(input).split("?")[0];
  server.requests.push({ path, method: init.method || "GET" });
  if (path === "/api/auth/me") return json({ ok: true, user });
  if (path === "/api/site/list") return json({ ok: true, sites: [site] });
  if (path === "/api/tournaments") return json({ ok: true, tournaments: [server.tournament], chatRegistration: { connected: false, chatReady: false, channelName: null, externalChannelId: null } });
  if (path.endsWith("/entries")) return json({ entries: server.entries, counts: { active: server.entries.length, eligible: server.entries.length, waitlist: 0, removed: 0, blocked: 0 } });
  if (path.endsWith("/bracket")) return json({ matches: server.matches, tournament: server.tournament });
  return json({ ok: true });
};

document.body.innerHTML = renderGiveawaysHtml("tournaments");
const $id = (id) => document.getElementById(id);
const text = (id) => $id(id)?.textContent ?? "";
const visible = (id) => Boolean($id(id)) && !$id(id).hidden;
const click = async (id) => {
  $id(id).dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const mod = await import("../assets/tournaments.js");

function boot(tournament, entries = [], matches = []) {
  server.tournament = tournament;
  server.entries = entries.map((e) => ({ ...e }));
  server.matches = matches.map((m) => ({ ...m }));
  clearSession();
  return mod.enter();
}

afterAll(() => {
  mod.leave();
  for (const key of INSTALLED_GLOBALS) globalThis[key] = originalGlobals[key];
});

describe("tournament workspace chrome", () => {
  it("drops the Engage tabs, back-link and page h1 for the tournaments pane", () => {
    const html = renderGiveawaysContentHtml("tournaments");
    expect(html).not.toContain("engage-tabs");
    expect(html).not.toContain("engage-back");
    // The pane's only h1s live inside the tournament app itself.
    expect(html).not.toContain("<h1>Tournaments</h1>");
    // Other panes keep their chrome untouched.
    expect(renderGiveawaysContentHtml("chat")).toContain("engage-tabs");
  });
});

describe("tournament workspace — completed tournament", () => {
  beforeEach(async () => {
    await boot(completed, completedEntries, completedMatches);
  });

  it("renders the header with title, chip, meta, champion and stats", () => {
    expect($id("tournament-workspace").hidden).toBe(false);
    expect($id("tournament-title-display").tagName).toBe("H1");
    expect(text("tournament-title-display")).toBe("Community tournament");
    expect(text("tournament-status")).toBe("Completed");
    expect(text("tournament-meta")).toBe("8-player bracket · Single elimination");
    expect(text("tournament-step-label")).toBe("Champion: 36_ates");
    expect($id("tournament-step-label").querySelector("svg.tourn-crown")).toBeTruthy();
    expect(text("tournament-count")).toBe("2");
    expect(text("tournament-fact-spots")).toBe("8");
    expect(text("tournament-fact-keyword")).toBe("!join");
    expect(text("tournament-fact-cap")).toBe("Unlimited");
    expect($id("tournament-workspace").querySelector(".tourn-head").textContent).not.toContain("Kick channel");
  });

  it("renders the entries table with pills and no action menus when finished", async () => {
    expect(text("tournament-tab-entries")).toBe("Entries (2)");
    const rows = $id("tournament-entry-list").querySelectorAll("tr.tournament-entry-row");
    expect(rows).toHaveLength(2);
    expect($id("tournament-entry-list").textContent).toContain("36_ates");
    expect($id("tournament-entry-list").textContent).toContain("forolo_GB");
    expect($id("tournament-entry-list").querySelectorAll(".tourn-pill--selected")).toHaveLength(2);
    expect($id("tournament-entry-list").textContent).toContain("Chat");
    expect($id("tournament-entry-list").querySelectorAll("details.tourn-menu")).toHaveLength(0);
    expect($id("tournament-entry-table")).toBeTruthy();
  });

  it("renders the bracket with named rounds, BYE handling, winner rows and the summary aside", async () => {
    await click("tournament-tab-bracket");
    expect(visible("tournament-panel-bracket")).toBe(true);
    const headings = [...$id("tournament-bracket").querySelectorAll(".tournament-round-head h3")].map((h) => h.textContent);
    expect(headings).toEqual(["Round 1", "Semifinals", "Final"]);
    expect(text("tournament-bracket-sub")).toBe("Single elimination · 8-player bracket");
    expect($id("tournament-bracket").querySelectorAll("input")).toHaveLength(0);
    expect($id("tournament-bracket").querySelectorAll(".tournament-match-row.is-winner")).not.toHaveLength(0);
    expect($id("tournament-bracket").querySelector(".tournament-match.is-bye")).toBeTruthy();
    expect($id("tournament-bracket").querySelector(".tournament-match-row.is-champion")).toBeTruthy();
    const aside = $id("tournament-summary").textContent;
    expect(aside).toContain("Matches played");
    expect(aside).toContain("Tournament ID");
    expect(aside).toContain("tourn_8f3a2c");
    expect(aside).toContain("Created");
    expect(aside).toContain("Sep 20, 2026");
    expect(aside).toContain("Champion");
    expect(aside).toContain("36_ates");
    expect(aside).not.toContain("Completed on");
  });

  it("opens the full-bracket modal with the same bracket markup and closes it", async () => {
    await click("tournament-tab-bracket");
    await click("tournament-bracket-expand");
    const modal = $id("tournament-bracket-modal");
    expect(modal.hidden).toBe(false);
    const inlineCount = $id("tournament-bracket").querySelectorAll(".tournament-match").length;
    expect($id("tournament-bracket-full").querySelectorAll(".tournament-match")).toHaveLength(inlineCount);
    expect(document.documentElement.classList.contains("yr-modal-open")).toBe(true);
    await click("tournament-bracket-close");
    expect(modal.hidden).toBe(true);
    expect(document.documentElement.classList.contains("yr-modal-open")).toBe(false);
    // Backdrop click also closes.
    await click("tournament-bracket-expand");
    modal.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(modal.hidden).toBe(true);
  });

  it("shows the read-only settings view instead of the form when finished", async () => {
    await click("tournament-tab-settings");
    expect(visible("tournament-settings-form")).toBe(false);
    expect(visible("tournament-settings-view")).toBe(true);
    const view = $id("tournament-settings-view").textContent;
    expect(view).toContain("Kick channel");
    expect(view).toContain("36-ates");
    expect(view).toContain("Chat registration");
    expect(view).toContain("Off");
    expect(view).toContain("Community tournament");
    expect(view).toContain("8 players");
    expect($id("tournament-settings-aside").textContent).toContain("Tournament status");
    expect($id("tournament-settings-aside").textContent).toContain("Details");
  });
});

describe("tournament workspace — editable lifecycles", () => {
  it("shows the settings form for a draft tournament with a dirty bar on edit", async () => {
    await boot(draft);
    await click("tournament-tab-settings");
    expect(visible("tournament-settings-form")).toBe(true);
    expect(visible("tournament-settings-view")).toBe(false);
    expect($id("tournament-settings-bar").hidden).toBe(true);
    $id("tournament-title").value = "Renamed Cup";
    $id("tournament-title").dispatchEvent(new window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect($id("tournament-settings-bar").hidden).toBe(false);
  });

  it("renders per-row Remove/Block menus while signups are open", async () => {
    await boot(openSignups, [
      { id: "e1", display_name: "viewer1", source: "chat", status: "pending", eligible: true, alt_flag: false },
      { id: "e2", display_name: "viewer2", source: "chat", status: "pending", eligible: true, alt_flag: false },
    ]);
    const menus = $id("tournament-entry-list").querySelectorAll("details.tourn-menu");
    expect(menus).toHaveLength(2);
    const actions = [...menus[0].querySelectorAll("[data-entry-action]")].map((b) => b.dataset.entryAction);
    expect(actions).toEqual(["remove", "block"]);
    expect(menus[0].querySelectorAll("[data-entry-id='e1']")).toHaveLength(2);
    expect(menus[0].querySelector("summary").getAttribute("aria-label")).toContain("viewer1");
  });
});
