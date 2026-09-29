// Behavioral coverage for the Tournament lifecycle UI: the real tournaments.js
// runs against the rendered Engage markup in a DOM with an in-memory API.
// Lifecycle is derived from the server's status/signup_state/matches only.
//
// Run: bun test src/__tests__/tournament-lifecycle-ui.test.js

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { renderGiveawaysHtml } from "../pages/giveaway-pages.js";
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
// Markup-hosted dialogs use YRDialog.trap; provide the contract without loading the asset.
window.YRDialog = { trap: () => () => {}, confirm: async () => true };

const user = { id: "user-1", email: "creator@example.com", plan: "pro", emailVerified: true };
const site = { id: "site-1", name: "Kick Cup", slug: "kick-cup", published: true, userRole: "owner", kickChannelName: "" };

const server = {
  tournaments: [], entries: [], matches: [], requests: [], failSettings: false,
  chatRegistration: { connected: false, chatReady: false, channelName: null, externalChannelId: null },
};
function reset({ tournaments = [], entries = [], matches = [] } = {}) {
  server.tournaments = tournaments.map((t) => ({ ...t }));
  server.entries = entries.map((e) => ({ ...e }));
  server.matches = matches.map((m) => ({ ...m }));
  server.requests.length = 0;
  server.failSettings = false;
  server.chatRegistration = { connected: false, chatReady: false, channelName: null, externalChannelId: null };
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
      bracket_size: body.bracketSize, format: body.format,
      entry_cap: body.entryCap === "bracket" ? body.bracketSize : body.entryCap === "unlimited" ? null : body.entryCap,
      entry_keyword: body.entryKeyword, chat_channel: body.chatChannel || null,
    };
    server.tournaments.unshift(tournament);
    return json({ ok: true, tournament });
  }
  if (path === "/api/tournaments") return json({ ok: true, tournaments: server.tournaments, chatRegistration: server.chatRegistration });
  const current = server.tournaments[0];
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
    };
    return json({ ok: true, entries: list, counts });
  }
  if (path.endsWith("/entries/select")) {
    current.status = "active";
    return json({ ok: true, entries: server.entries });
  }
  if (path.endsWith("/bracket")) return json({ ok: true, tournament: current, matches: server.matches });
  if (path.endsWith("/score") && init.method === "PATCH") return json({ ok: true, message: "Score corrected." });
  if (path.endsWith("/signups/open")) { current.signup_state = "open"; return json({ ok: true, tournament: current }); }
  if (path.endsWith("/signups/lock")) { current.signup_state = "locked"; return json({ ok: true, tournament: current }); }
  if (path.endsWith("/settings")) {
    if (server.failSettings || body.bracketSize === 6) {
      return json({ error: "Bracket size must be 4, 8, 16, or 32." }, 400);
    }
    Object.assign(current, {
      title: body.title || current.title,
      ...(body.bracketSize !== undefined ? { bracket_size: body.bracketSize } : {}),
      ...(body.entryCap !== undefined ? { entry_cap: body.entryCap === "bracket" ? (body.bracketSize ?? current.bracket_size) : body.entryCap === "unlimited" ? null : body.entryCap } : {}),
      ...(body.chatChannel !== undefined ? { chat_channel: body.chatChannel } : {}),
    });
    return json({ ok: true, tournament: current });
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
    site.kickChannelName = "";
    // getSites() caches the parsed site list for the session; drop it so a
    // per-test kickChannelName is picked up by the next boot.
    clearSession();
    // A previous test may leave the create modal open with its focus trap
    // installed; close it so focus assertions aren't redirected into the modal.
    const modal = $id("tournament-create-modal");
    if (modal) await click("tournament-create-cancel");
    await mod.boot();
    await flush();
  });

  it("derives the lifecycle from server fields only", () => {
    expect(mod.lifecycleOf(null)).toBe("none");
    expect(mod.lifecycleOf({ status: "draft", signup_state: "closed" })).toBe("setup");
    expect(mod.lifecycleOf({ status: "draft", signup_state: "open" })).toBe("setup");
    expect(mod.lifecycleOf({ status: "draft", signup_state: "locked" })).toBe("setup");
    expect(mod.lifecycleOf({ status: "active", signup_state: "locked" }, 4)).toBe("live");
    expect(mod.lifecycleOf({ status: "completed", signup_state: "locked" }, 4)).toBe("finished");
    expect(mod.lifecycleOf({ status: "cancelled", signup_state: "closed" })).toBe("cancelled");
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
    const sizes = [...$id("tc-bracket-size").options].map((o) => Number(o.value));
    expect(sizes).toEqual([4, 8, 16, 32]);
    expect($id("tc-format")).toBeNull();
    expect($id("tc-bracket-size").value).toBe("8");
    expect($id("tc-entry-cap").value).toBe("bracket");
    expect($id("tc-entry-cap").querySelector('option[value="bracket"]').textContent).toBe("Same as bracket size (8)");
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
    $id("tc-bracket-size").value = "4";
    $id("tc-chat-channel").value = "36_ates";
    $id("tc-keyword").value = "!cup";
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
    expect(text("tournament-meta")).toBe("Fortnite · 4-player bracket · Single elimination");
    expect($id("tournament-chat-channel").value).toBe("36_ates");
    expect(text("tournament-fact-keyword")).toBe("!cup");
    expect(text("tournament-count")).toBe("0 of 4");
    expect(text("tournament-primary")).toBe("Start tournament");
    expect(text("tournament-primary-reason")).toBe("Add at least 2 players to start.");
    expect($id("tournament-primary").disabled).toBe(true);
    expect($id("tournament-entries-empty").textContent).toContain("No entries yet.");
    expect($id("tournament-entries-empty").textContent).toContain("Add players below, or turn on chat signup to collect them from Kick chat.");
  });

  it("stores an empty game name instead of a placeholder when the field is left blank", async () => {
    await click("tournament-create");
    $id("tc-game").value = "   ";
    await submit("tournament-create-form");
    const [post] = requestsTo("/api/tournaments", "POST");
    expect(post.body.gameName).toBe("");
    expect(server.tournaments[0].game_name).toBe("");
    expect(text("tournament-meta")).not.toContain("Game");
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
    expect(toggle.checked).toBe(false);
    toggle.checked = true;
    toggle.dispatchEvent(new window.Event("change", { bubbles: true }));
    await flush();
    expect(requestsTo("/api/tournaments/t-1/signups/open", "POST")).toHaveLength(1);
    expect(text("tournament-chat-signup-state")).toBe("On — viewers type !join in chat");

    // Turn it back off.
    const toggleOff = $id("tournament-chat-signup");
    toggleOff.checked = false;
    toggleOff.dispatchEvent(new window.Event("change", { bubbles: true }));
    await flush();
    expect(requestsTo("/api/tournaments/t-1/signups/lock", "POST")).toHaveLength(1);
    expect(text("tournament-chat-signup-state")).toBe("Off");

    server.entries = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, display_name: `viewer${i}`, source: "chat", status: "pending" }));
    await mod.boot();
    // 5 eligible players for 8 spots: start asks for BYE confirmation.
    expect(text("tournament-primary")).toBe("Start tournament");
    expect($id("tournament-primary").disabled).toBe(false);
    expect(text("tournament-count")).toBe("5");
    expect(text("tournament-fact-spots")).toBe("8");
    await click("tournament-tab-settings");
    expect($id("tournament-bracket-size").disabled).toBe(false);

    window.YRDialog.confirm = async () => true;
    await click("tournament-tab-entries");
    await click("tournament-primary");
    const [pick] = requestsTo("/api/tournaments/t-1/entries/select", "POST");
    expect(pick.body).toEqual({ mode: "all", seeding: "signup" });
  });

  it("derives chat registration status from the server, never the socket", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    expect(text("tournament-chat-status")).toBe("Chat registration off");

    // Open but no confirmed Kick chat delivery: unavailable, and the browser
    // never writes entries.
    reset({ tournaments: [{ ...base, signup_state: "open" }] });
    server.chatRegistration = { connected: true, chatReady: false, channelName: "creator", externalChannelId: "111" };
    await mod.boot();
    expect(text("tournament-chat-status")).toBe("Chat registration unavailable");
    expect($id("tournament-chat-status").classList.contains("is-live")).toBe(false);

    server.chatRegistration = { connected: true, chatReady: true, channelName: "creator", externalChannelId: "111" };
    await mod.boot();
    expect(text("tournament-chat-status")).toBe("Chat registration active");
    expect($id("tournament-chat-status").classList.contains("is-live")).toBe(true);
    // A channel mismatch keeps it unavailable.
    server.chatRegistration = { connected: true, chatReady: true, channelName: "other", externalChannelId: "999" };
    await mod.boot();
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
    clearSession();
    reset({ tournaments: [{ ...base, chat_channel: null }] });
    await mod.boot();
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
    clearSession();
    reset({ tournaments: [{ ...base, chat_channel: "saved-channel" }] });
    await mod.boot();
    expect($id("tournament-chat-channel").value).toBe("saved-channel");
    expect($id("tournament-chat-signup").disabled).toBe(false);
    expect(JSON.stringify(server.requests)).not.toContain("other-channel");
  });

  it("shows an operable chat-signup switch when the tournament has a Kick channel", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    const toggle = $id("tournament-chat-signup");
    expect(toggle.disabled).toBe(false);
    expect(toggle.checked).toBe(false);
    expect(text("tournament-chat-signup-state")).toBe("Off");
  });

  it("lets a legacy active/no-bracket tournament change bracket size", async () => {
    reset({ tournaments: [{ ...base, status: "active", signup_state: "closed", bracket_size: 8 }] });
    await mod.boot();
    expect(text("tournament-status")).toBe("Setup");
    await click("tournament-tab-settings");
    expect($id("tournament-bracket-size").disabled).toBe(false);
    expect($id("tournament-entry-cap-mode").disabled).toBe(false);
    $id("tournament-bracket-size").value = "16";
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
    expect($id("tournament-entry-cap-mode").value).toBe("unlimited");
    expect($id("tournament-entry-cap").hidden).toBe(true);
    $id("tournament-entry-cap-mode").value = "custom";
    $id("tournament-entry-cap-mode").dispatchEvent(new window.Event("change", { bubbles: true }));
    await flush();
    expect($id("tournament-entry-cap").hidden).toBe(false);
    $id("tournament-entry-cap").value = "40";
    await submit("tournament-settings-form");
    const [req] = requestsTo("/api/tournaments/t-1/settings", "POST");
    expect(req.body.entryCap).toBe(40);

    // entry_cap === bracket_size preselects "Same as bracket size".
    reset({ tournaments: [{ ...base, entry_cap: 8 }] });
    await mod.boot();
    await click("tournament-tab-settings");
    expect($id("tournament-entry-cap-mode").value).toBe("bracket");
    expect($id("tournament-entry-cap").hidden).toBe(true);

    reset({ tournaments: [{ ...base, entry_cap: 40 }] });
    await mod.boot();
    await click("tournament-tab-settings");
    // happy-dom misreports .value/.selected when the last option is selected;
    // check the selected attribute directly.
    expect($id("tournament-entry-cap-mode").querySelector('option[value="custom"]').hasAttribute("selected")).toBe(true);
    expect($id("tournament-entry-cap").hidden).toBe(false);
    expect($id("tournament-entry-cap").value).toBe("40");
  });

  it("gives every settings control the full-width tn-input treatment", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    await click("tournament-tab-settings");
    const controls = $id("tournament-settings-form").querySelectorAll("select, input");
    for (const el of controls) {
      if (el.type === "checkbox") continue;
      expect(el.classList.contains("tn-input")).toBe(true);
    }
    const css = readFileSync(new URL("../assets/tournaments.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.tn-input[^{]*\{[^}]*width:\s*100%/);
  });

  it("shows a field error on a rejected save without touching the summary", async () => {
    reset({ tournaments: [base] });
    await mod.boot();
    await click("tournament-tab-settings");
    server.failSettings = true;
    $id("tournament-bracket-size").value = "16";
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
    $id("tournament-title").value = "Renamed Cup";
    $id("tournament-title").dispatchEvent(new window.Event("input", { bubbles: true }));
    await flush();
    expect($id("tournament-settings-bar").hidden).toBe(false);
    await click("tournament-settings-discard");
    expect($id("tournament-settings-bar").hidden).toBe(true);
    expect($id("tournament-title").value).toBe("Community Tournament");
    $id("tournament-title").value = "Renamed Cup";
    $id("tournament-title").dispatchEvent(new window.Event("input", { bubbles: true }));
    await flush();
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
    expect(visible("tournament-new")).toBe(false);
    await click("tournament-tab-bracket");
    expect(visible("tournament-bracket-empty")).toBe(false);
    expect($id("tournament-bracket").querySelectorAll(".tn-match")).toHaveLength(3);
    expect($id("tournament-bracket").querySelectorAll("[data-score-match]").length).toBeGreaterThan(0);
    await click("tournament-tab-settings");
    expect($id("tournament-bracket-size").disabled).toBe(true);
    expect(text("tournament-bracket-size-hint")).toContain("locked");
  });

  it("sends a PATCH correction from a completed match's inline scores", async () => {
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
    // The correction UI is always on the card: prefilled inputs, disabled Save.
    expect(card().dataset.scoreMode).toBe("correct");
    expect(card().dataset.saved).toBe("2,1");
    expect(card().querySelector('[data-score-player="1"]').value).toBe("2");
    const save = () => card().querySelector(".tn-match-save");
    const note = () => card().querySelector(".tn-match-note");
    expect(save().disabled).toBe(true);
    expect(note().hidden).toBe(true);
    // Editing an input unlocks Save and reveals the downstream note.
    card().querySelector('[data-score-player="1"]').value = "5";
    card().querySelector('[data-score-player="1"]').dispatchEvent(new window.Event("input", { bubbles: true }));
    card().querySelector('[data-score-player="2"]').value = "3";
    card().querySelector('[data-score-player="2"]').dispatchEvent(new window.Event("input", { bubbles: true }));
    await flush();
    expect(save().disabled).toBe(false);
    expect(note().hidden).toBe(false);
    save().dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush();
    const patches = requestsTo("/api/tournaments/t-1/score", "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({ matchId: "m1", player1Score: 5, player2Score: 3 });
    expect(requestsTo("/api/tournaments/t-1/score", "POST")).toHaveLength(0);
    expect(text("tournament-message")).toBe("Score corrected.");
  });

  it("keeps Save disabled until a corrected score differs from the saved one", async () => {
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
    const note = () => card().querySelector(".tn-match-note");
    const input = (player, value) => {
      const el = card().querySelector(`[data-score-player="${player}"]`);
      el.value = value;
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
    };
    expect(save().disabled).toBe(true);
    // A changed value unlocks Save; returning it to the saved score re-locks.
    input(1, "7");
    await flush();
    expect(save().disabled).toBe(false);
    expect(note().hidden).toBe(false);
    input(1, "2");
    await flush();
    expect(save().disabled).toBe(true);
    expect(note().hidden).toBe(true);
    save().dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush();
    expect(requestsTo("/api/tournaments/t-1/score", "PATCH")).toHaveLength(0);
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
      expect(view).toContain("No rules added yet.");
      $id("tournament-title").value = "X";
      $id("tournament-title").dispatchEvent(new window.Event("input", { bubbles: true }));
      $id("tournament-entry-cap-mode").value = "";
      $id("tournament-entry-cap-mode").dispatchEvent(new window.Event("change", { bubbles: true }));
      await flush();
      expect($id("tournament-settings-bar").hidden).toBe(true);
      await submit("tournament-settings-form");
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
    $id("tournament-bracket-size").value = "4";
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
    window.YRDialog.confirm = async () => true;
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
    $id("ts-mode-manual").checked = true;
    $id("ts-mode-manual").dispatchEvent(new window.Event("change", { bubbles: true }));
    await flush();
    expect(visible("ts-pane-manual")).toBe(true);
    expect($id("ts-entry-list").querySelectorAll("input[type=checkbox]")).toHaveLength(22);
    expect(text("ts-counter")).toBe("Selected 0 / 8");
    expect($id("tournament-select-submit").disabled).toBe(true);

    // Search filters the list client-side.
    $id("ts-search").value = "player1";
    $id("ts-search").dispatchEvent(new window.Event("input", { bubbles: true }));
    await flush();
    expect($id("ts-entry-list").querySelectorAll("input[type=checkbox]")).toHaveLength(10);
    $id("ts-search").value = "";
    $id("ts-search").dispatchEvent(new window.Event("input", { bubbles: true }));
    await flush();

    const boxes = [...$id("ts-entry-list").querySelectorAll("input[type=checkbox]")];
    for (const box of boxes.slice(0, 6)) {
      box.checked = true;
      box.dispatchEvent(new window.Event("change", { bubbles: true }));
    }
    await flush();
    expect(text("ts-counter")).toBe("Selected 6 / 8");
    expect($id("tournament-select-submit").disabled).toBe(true);
    for (const box of boxes.slice(6, 8)) {
      box.checked = true;
      box.dispatchEvent(new window.Event("change", { bubbles: true }));
    }
    await flush();
    expect(text("ts-counter")).toBe("Selected 8 / 8");
    expect($id("tournament-select-submit").disabled).toBe(false);

    await click("tournament-select-submit");
    const manualReqs = requestsTo("/api/tournaments/t-1/entries/select", "POST");
    const manualReq = manualReqs[manualReqs.length - 1];
    expect(manualReq.body.mode).toBe("manual");
    expect(manualReq.body.seeding).toBe("signup");
    expect(manualReq.body.entryIds).toEqual(["e0", "e1", "e2", "e3", "e4", "e5", "e6", "e7"]);
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
    $id("ts-mode-manual").checked = true;
    $id("ts-mode-manual").dispatchEvent(new window.Event("change", { bubbles: true }));
    await flush();
    const boxes = [...$id("ts-entry-list").querySelectorAll("input[type=checkbox]")];
    // The 9 eligible rows are listed; the ineligible one is not.
    expect(boxes).toHaveLength(9);
    expect(boxes.map((b) => b.value)).toContain("flag");
    expect(boxes.map((b) => b.value)).not.toContain("inel");

    for (const box of boxes.filter((b) => b.value !== "e0")) {
      box.checked = true;
      box.dispatchEvent(new window.Event("change", { bubbles: true }));
    }
    await flush();
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
    // The undecided final is a waiting card, not a TBD line.
    expect(matches[2].dataset.state).toBe("waiting");
    expect(matches[2].textContent).toContain("Waiting for semifinalists");
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
});

  it("keeps a dirty settings form intact through an entries refresh", async () => {
    reset({
      tournaments: [{ ...base, status: "draft", signup_state: "open" }],
      entries: [{ id: "e1", display_name: "one", source: "chat", status: "pending" }],
    });
    await mod.boot();
    await click("tournament-tab-settings");
    // Dirty the form while the settings tab is visible.
    $id("tournament-title").value = "Typed but unsaved";
    $id("tournament-title").dispatchEvent(new window.Event("input", { bubbles: true }));
    await flush();
    expect($id("tournament-settings-bar").hidden).toBe(false);
    // An entry action is one loadEntries() path — the same refresh the 15s
    // poll and chat webhook take. The form must keep its edit and the bar.
    const formNode = $id("tournament-settings-form");
    server.entries = [
      { id: "e1", display_name: "one", source: "chat", status: "pending" },
      { id: "e2", display_name: "two", source: "chat", status: "pending" },
    ];
    const removeBtn = $id("tournament-entry-list").querySelector("[data-entry-action='remove']");
    removeBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush();
    expect($id("tournament-settings-form")).toBe(formNode);
    expect($id("tournament-title").value).toBe("Typed but unsaved");
    expect($id("tournament-settings-bar").hidden).toBe(false);
    // The data updates still landed.
    expect(text("tournament-count")).toBe("2");
    expect(text("tournament-tab-entries")).toBe("Entries (2)");
    expect($id("tournament-entry-list").textContent).toContain("two");
  });
