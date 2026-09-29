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

const server = { tournament: completed, entries: [], matches: [], requests: [], entitlementEnabled: true, entryError: null };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = async (input, init = {}) => {
  const path = String(input).split("?")[0];
  const method = init.method || "GET";
  server.requests.push({ path, method, body: init.body });
  if (path === "/api/auth/me") return json({ ok: true, user });
  if (path === "/api/site/list") return json({ ok: true, sites: [site] });
  if (path === "/api/tournaments") return json({
    ok: true,
    tournaments: server.tournament ? [server.tournament] : [],
    chatRegistration: { connected: false, chatReady: false, channelName: null, externalChannelId: null },
    entitlement: { enabled: server.entitlementEnabled },
  });
  if (path.endsWith("/signups/lock") && method === "POST") {
    server.tournament = { ...server.tournament, signup_state: "locked" };
    return json({ ok: true });
  }
  if (path.endsWith("/entries") && method === "POST") {
    if (server.entryError) return json({ error: server.entryError }, 409);
    const { displayName } = JSON.parse(init.body || "{}");
    server.entries.push({ id: `e${server.entries.length + 1}`, display_name: displayName, source: "manual", status: "pending", eligible: true });
    return json({ ok: true, entry: server.entries.at(-1) });
  }
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

function boot(tournament, entries = [], matches = [], entitlementEnabled = true) {
  server.tournament = tournament;
  server.entries = entries.map((e) => ({ ...e }));
  server.matches = matches.map((m) => ({ ...m }));
  server.entitlementEnabled = entitlementEnabled;
  server.entryError = null;
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
    expect(renderGiveawaysContentHtml("chat")).toContain('v3-tabs gw-subnav');
  });

  it("shows the shared plan lock and blocks creation when tournaments are unavailable", async () => {
    await boot(null, [], [], false);
    expect($id("tournament-create").disabled).toBe(true);
    expect($id("tournament-create").getAttribute("aria-describedby")).toBe("tournament-plan-lock");
    expect($id("tournament-plan-lock").dataset.planLock).toBe("tournaments");
    $id("tournament-create").disabled = false;
    await click("tournament-create");
    expect(text("tournament-message")).toBe("Tournaments is available on Starter and higher plans.");
    expect($id("tournament-create-modal")).toBeNull();
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
    expect($id("tournament-step-label").querySelector("svg.tn-crown")).toBeTruthy();
    expect(text("tournament-count")).toBe("2");
    expect(text("tournament-fact-spots")).toBe("8");
    expect(text("tournament-fact-keyword")).toBe("!join");
    expect(text("tournament-fact-cap")).toBe("Unlimited");
    expect($id("tournament-workspace").querySelector(".tn-head").textContent).not.toContain("Kick channel");
  });

  it("renders the entries table with pills and no action menus when finished", async () => {
    expect(text("tournament-tab-entries")).toBe("Entries (2)");
    const rows = $id("tournament-entry-list").querySelectorAll(".tn-entry:not(.tn-entry--head)");
    expect(rows).toHaveLength(2);
    expect($id("tournament-entry-list").textContent).toContain("36_ates");
    expect($id("tournament-entry-list").textContent).toContain("forolo_GB");
    expect($id("tournament-entry-list").querySelectorAll(".tn-pill--selected")).toHaveLength(2);
    expect($id("tournament-entry-list").textContent).toContain("Chat");
    expect($id("tournament-entry-list").querySelectorAll("details.tn-menu")).toHaveLength(0);
    expect($id("tournament-entry-table")).toBeTruthy();
  });

  it("renders the bracket with named rounds, BYE handling, winner rows and the summary aside", async () => {
    await click("tournament-tab-bracket");
    expect(visible("tournament-panel-bracket")).toBe(true);
    const headings = [...$id("tournament-bracket").querySelectorAll(".tn-round-head h3")].map((h) => h.textContent);
    expect(headings).toEqual(["Quarterfinals", "Semifinals", "Final"]);
    expect(text("tournament-bracket-sub")).toBe("Single elimination · 8-player bracket");
    expect($id("tournament-bracket").querySelectorAll("input")).toHaveLength(0);
    expect($id("tournament-bracket").querySelectorAll(".tn-match-row.is-winner")).not.toHaveLength(0);
    expect($id("tournament-bracket").querySelector('.tn-match[data-state="bye"]')).toBeTruthy();
    expect($id("tournament-bracket").querySelector('.tn-match[data-state="void"]')).toBeTruthy();
    expect($id("tournament-bracket").querySelector(".is-champion")).toBeTruthy();
    // Connector stubs exist even without a layout engine (happy-dom has no
    // ResizeObserver): one path per non-final match.
    const paths = $id("tournament-bracket").querySelectorAll(".tn-connectors path[data-from]");
    expect(paths.length).toBe(completedMatches.length - 1);
    const aside = $id("tournament-summary");
    expect(aside.textContent).toContain("Matches played");
    // The tournament ID lives behind a Copy ID button in Settings, not the
    // summary aside; a blank game_name renders no Game row.
    expect(aside.textContent).not.toContain("Tournament ID");
    expect(aside.innerHTML).not.toContain("tourn_8f3a2c");
    expect(aside.textContent).not.toContain("Game");
    expect(aside.textContent).toContain("Created");
    expect(aside.textContent).toContain("Sep 20, 2026");
    expect(aside.textContent).toContain("Champion");
    expect(aside.textContent).toContain("36_ates");
    expect(aside.textContent).not.toContain("Completed on");
  });

  it("opens the full-bracket modal with the same bracket markup and closes it", async () => {
    await click("tournament-tab-bracket");
    await click("tournament-bracket-expand");
    const modal = $id("tournament-bracket-modal");
    expect(modal).toBeTruthy();
    const inlineCount = $id("tournament-bracket").querySelectorAll(".tn-match").length;
    expect($id("tournament-bracket-full").querySelectorAll(".tn-match")).toHaveLength(inlineCount);
    expect($id("tournament-bracket-full").querySelector('.tn-bracket[data-mode="expanded"]')).toBeTruthy();
    expect(document.documentElement.classList.contains("yr-modal-open")).toBe(true);
    await click("tournament-bracket-close");
    expect($id("tournament-bracket-modal")).toBeNull();
    expect(document.documentElement.classList.contains("yr-modal-open")).toBe(false);
    // Backdrop click also closes.
    await click("tournament-bracket-expand");
    $id("tournament-bracket-modal").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect($id("tournament-bracket-modal")).toBeNull();
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
    expect($id("tournament-settings-aside").textContent).toContain("Tournament ID");
    const copyId = $id("tournament-settings-aside").querySelector("#tournament-copy-id");
    expect(copyId).toBeTruthy();
    expect(copyId.dataset.copyId).toBe("tourn_8f3a2c");
  });
});

describe("tournament workspace — editable lifecycles", () => {
  it("closes draft entries without requiring a Kick channel", async () => {
    await boot(draft, [
      { id: "e1", display_name: "alpha", source: "manual", status: "pending", eligible: true },
      { id: "e2", display_name: "beta", source: "manual", status: "confirmed", eligible: true },
    ]);
    expect(text("tournament-primary")).toBe("Close entries");
    expect($id("tournament-primary").dataset.action).toBe("lock");
    const requestStart = server.requests.length;
    await click("tournament-primary");
    expect(server.tournament.signup_state).toBe("locked");
    expect(server.requests.slice(requestStart).some(({ path, method }) =>
      path.endsWith("/signups/lock") && method === "POST"
    )).toBe(true);
  });

  it("adds a manual player and shows duplicate errors without losing the input", async () => {
    await boot(draft);
    const form = $id("tournament-add-entry-form");
    expect(form).toBeTruthy();
    const input = $id("tournament-add-entry-name");
    input.value = "ManualPlayer";
    const requestStart = server.requests.length;
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(server.requests.slice(requestStart).some(({ path, method, body }) =>
      path.endsWith("/entries") && method === "POST" && JSON.parse(body).displayName === "ManualPlayer"
    )).toBe(true);
    expect($id("tournament-entry-list").textContent).toContain("ManualPlayer");

    server.entryError = "ManualPlayer is already entered.";
    $id("tournament-add-entry-name").value = "ManualPlayer";
    $id("tournament-add-entry-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(text("tournament-message")).toBe("ManualPlayer is already entered.");
    expect($id("tournament-add-entry-name").value).toBe("ManualPlayer");
  });

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
    const menus = $id("tournament-entry-list").querySelectorAll("details.tn-menu");
    expect(menus).toHaveLength(2);
    const actions = [...menus[0].querySelectorAll("[data-entry-action]")].map((b) => b.dataset.entryAction);
    expect(actions).toEqual(["remove", "block"]);
    expect(menus[0].querySelectorAll("[data-entry-id='e1']")).toHaveLength(2);
    expect(menus[0].querySelector("summary").getAttribute("aria-label")).toContain("viewer1");
  });
});

// Last: this test leaves the dialog-script promise pending (happy-dom never
// loads injected scripts), so it must not precede tests that open modals.
describe("tournament workspace — bracket modal teardown race", () => {
  it("leaves no trap or scroll-lock when leave() beats the dialog script", async () => {
    await boot(completed, completedEntries, completedMatches);
    await click("tournament-tab-bracket");
    const realDialog = window.YRDialog;
    window.YRDialog = undefined;
    try {
      const opened = click("tournament-bracket-expand");
      // The modal paints immediately; the trap only installs once
      // ensureDialog() resolves — simulate a navigation winning that race.
      mod.leave();
      await opened;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect($id("tournament-bracket-modal")).toBeNull();
      expect(document.documentElement.classList.contains("yr-modal-open")).toBe(false);
      // Escape on the closed modal must do nothing and not throw.
      document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect($id("tournament-bracket-modal")).toBeNull();
    } finally {
      window.YRDialog = realDialog;
    }
  });
});
