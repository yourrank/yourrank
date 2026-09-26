// Behavioral coverage for the Engage feature hub at /dashboard/giveaways:
// the server-rendered 4-card grid, the pure engageCardState payload mapping,
// and the real giveaways.js boot pass filling card status from the four
// feature APIs in a DOM.
//
// Run: bun test src/__tests__/engage-hub.test.js

import { afterAll, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { renderEngageHubHtml, renderGiveawaysHtml } from "../pages/giveaway-pages.js";
import { engageCardState } from "../assets/dashboard/engage-hub-state.js";

const window = new Window({ url: "http://localhost/dashboard/giveaways?siteId=site-1" });
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
// enter() is called explicitly in the harness, like the persistent shell does.
window.__yrSpaShell = true;

const user = { id: "user-1", email: "creator@example.com", plan: "pro", emailVerified: true };
const site = { id: "site-1", name: "Kick Cup", slug: "kick-cup", published: true, userRole: "owner", kickChannelName: "" };

const server = {
  chat: { connection: { connected: true, chatReady: true, channelName: "creator" }, session: null, entries: [], winner: null },
  raffles: { raffles: [] },
  predictions: { predictions: [] },
  tournaments: { tournaments: [], chatRegistration: {} },
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (input) => {
  const path = String(input).split("?")[0];
  if (path === "/api/auth/me") return json({ ok: true, user });
  if (path === "/api/site/list") return json({ ok: true, sites: [site] });
  if (path === "/api/giveaways/chat") return json(server.chat);
  if (path === "/api/events/raffles") return json(server.raffles);
  if (path === "/api/predictions") return json(server.predictions);
  if (path === "/api/tournaments") return json(server.tournaments);
  return json({ error: `unhandled ${path}` }, 404);
};

afterAll(() => {
  for (const [key, value] of Object.entries(originalGlobals)) globalThis[key] = value;
});

const card = (feature) => document.querySelector(`.engage-card[data-feature="${feature}"]`);
const cardText = (feature, sel) => card(feature)?.querySelector(sel)?.textContent;

describe("Engage hub markup", () => {
  it("renders four feature cards in order with default status copy", () => {
    const html = renderEngageHubHtml();
    document.body.innerHTML = html;
    const features = [...document.querySelectorAll(".engage-card")].map((c) => c.dataset.feature);
    expect(features).toEqual(["chat", "tournaments", "raffles", "preds"]);
    const expected = [
      ["chat", "Chat Giveaway", "Run live giveaways from your chat.", "No active giveaway", "Create a giveaway to engage your viewers.", "Create giveaway", "/dashboard/giveaways/chat"],
      ["tournaments", "Tournament", "Run brackets and community competitions.", "No active tournament", "Set up a bracket for your community.", "Create tournament", "/dashboard/giveaways/tournaments"],
      ["raffles", "Raffle", "Run ticket-based drawings for your community.", "No active raffle", "Set up a raffle to reward your community.", "Create raffle", "/dashboard/giveaways/raffles"],
      ["preds", "Prediction", "Let your viewers predict outcomes.", "No active prediction", "Create a prediction to get your community involved.", "Create prediction", "/dashboard/giveaways/predictions"],
    ];
    for (const [feature, title, desc, state, meta, action, href] of expected) {
      expect(cardText(feature, ".engage-card__title")).toBe(title);
      expect(cardText(feature, ".engage-card__desc")).toBe(desc);
      expect(cardText(feature, "[data-status-label]")).toBe(state);
      expect(cardText(feature, "[data-status-meta]")).toBe(meta);
      const link = card(feature).querySelector(".engage-card__link");
      expect(link.getAttribute("href")).toBe(href);
      const btn = card(feature).querySelector("[data-action]");
      expect(btn.textContent).toBe(action);
      expect(btn.getAttribute("href")).toBe(href);
      expect(btn.className).toContain("btn--accent");
      expect(card(feature).querySelectorAll(".engage-card__icon svg").length).toBe(1);
      expect(card(feature).querySelectorAll(".engage-card__chevron svg").length).toBe(1);
    }
    expect(html).toContain('class="v3-tabs engage-tabs"');
    expect(html).not.toContain("gw-nav-tabs");
    expect(html).not.toContain("gw-drawer-backdrop");
  });

  it("renders feature pages with the Engage back-link and no feature tab strip", () => {
    for (const tab of ["chat", "raffles", "preds", "tournaments"]) {
      const html = renderGiveawaysHtml(tab);
      expect(html, tab).toContain('class="engage-back" href="/dashboard/giveaways"');
      expect(html, tab).not.toContain("gw-nav-tabs");
      expect(html, tab).not.toContain("gw-tab-btn");
      expect(html, tab).not.toContain("data-tabs-more");
      expect(html, tab).toContain('class="v3-tabs engage-tabs"');
    }
  });

  it("renders the hub through renderGiveawaysHtml without drawers", () => {
    const html = renderGiveawaysHtml("hub");
    expect(html).toContain('id="engage-hub"');
    expect(html).not.toContain("gw-drawer-backdrop");
    expect(html).not.toContain("gw-nav-tabs");
  });
});

describe("engageCardState", () => {
  it("maps chat giveaway sessions", () => {
    expect(engageCardState("chat", { session: null, entries: [] })).toEqual({
      tone: "none", label: "No active giveaway",
      meta: ["Create a giveaway to engage your viewers."],
      action: { label: "Create giveaway", variant: "accent" },
    });
    const live = engageCardState("chat", { session: { status: "active", keyword: "!win" }, entries: [{}, {}, {}] });
    expect(live.tone).toBe("live");
    expect(live.label).toBe("Live giveaway");
    expect(live.meta).toEqual(["Keyword !win · 3 entries"]);
    expect(live.action).toEqual({ label: "Open giveaway", variant: "ghost" });
    expect(engageCardState("chat", { session: { status: "completed", keyword: "!win" }, entries: [] }).tone).toBe("none");
  });

  it("maps raffles", () => {
    expect(engageCardState("raffles", { raffles: [] }).tone).toBe("none");
    const open = engageCardState("raffles", { raffles: [{ title: "Sub raffle", status: "active", total_tickets: 12 }] });
    expect(open.tone).toBe("live");
    expect(open.label).toBe("Raffle open");
    expect(open.meta).toEqual(["Sub raffle · 12 tickets"]);
    expect(open.action).toEqual({ label: "Open raffle", variant: "ghost" });
  });

  it("maps predictions", () => {
    expect(engageCardState("preds", { predictions: [] }).tone).toBe("none");
    const open = engageCardState("preds", { predictions: [{ title: "Win the map?", status: "open" }] });
    expect(open.tone).toBe("live");
    expect(open.label).toBe("Prediction open");
    expect(open.action).toEqual({ label: "Open prediction", variant: "ghost" });
    const locked = engageCardState("preds", { predictions: [{ title: "Win the map?", status: "locked" }] });
    expect(locked.tone).toBe("warn");
    expect(locked.label).toBe("Awaiting result");
    expect(locked.meta).toEqual(["Win the map?"]);
  });

  it("maps tournaments", () => {
    expect(engageCardState("tournaments", { tournaments: [] }).tone).toBe("none");
    expect(engageCardState("tournaments", { tournaments: [{ status: "cancelled", title: "Old" }] }).tone).toBe("none");
    const done = engageCardState("tournaments", {
      tournaments: [{ title: "Community tournament", status: "completed", signup_state: "closed", bracket_size: 8, participant_count: 5, selected_count: 2 }],
    });
    expect(done.tone).toBe("done");
    expect(done.label).toBe("Completed");
    expect(done.meta).toEqual(["Community tournament", "2 participants · 8 slots"]);
    expect(done.action).toEqual({ label: "Open tournament", variant: "ghost" });
    const signups = engageCardState("tournaments", {
      tournaments: [{ title: "Cup", status: "draft", signup_state: "open", bracket_size: 8, participant_count: 5, selected_count: 0 }],
    });
    expect(signups.tone).toBe("live");
    expect(signups.label).toBe("Signups open");
    expect(signups.meta).toEqual(["Cup", "5 participants · 8 slots"]);
    const locked = engageCardState("tournaments", {
      tournaments: [{ title: "Cup", status: "draft", signup_state: "locked", bracket_size: 8, participant_count: 8 }],
    });
    expect(locked.tone).toBe("warn");
    expect(locked.label).toBe("Signups locked");
    const bracket = engageCardState("tournaments", {
      tournaments: [{ title: "Cup", status: "active", signup_state: "closed", bracket_size: 8, participant_count: 9, selected_count: 8 }],
    });
    expect(bracket.tone).toBe("live");
    expect(bracket.label).toBe("Bracket in progress");
    expect(bracket.meta).toEqual(["Cup", "8 participants · 8 slots"]);
  });
});

describe("Engage hub boot", () => {
  it("fills card status from the four feature APIs", async () => {
    document.body.innerHTML = renderEngageHubHtml();
    server.chat = { connection: { connected: true, chatReady: true, channelName: "creator" }, session: null, entries: [], winner: null };
    server.raffles = { raffles: [] };
    server.predictions = { predictions: [] };
    server.tournaments = {
      tournaments: [{ id: "t-1", title: "Community tournament", status: "completed", signup_state: "closed", bracket_size: 8, participant_count: 5, selected_count: 2 }],
      chatRegistration: {},
    };
    const mod = await import("../assets/giveaways.js");
    await mod.enter({ tab: "hub" });

    const t = card("tournaments");
    expect(t.classList.contains("is-done")).toBe(true);
    expect(cardText("tournaments", "[data-status-label]")).toBe("Completed");
    const metaLines = [...t.querySelectorAll("[data-status-meta] span")].map((s) => s.textContent);
    expect(metaLines).toEqual(["Community tournament", "2 participants · 8 slots"]);
    const action = t.querySelector("[data-action]");
    expect(action.textContent).toBe("Open tournament");
    expect(action.className).toContain("btn--ghost");
    expect(action.getAttribute("href")).toBe("/dashboard/giveaways/tournaments");

    expect(cardText("chat", "[data-status-label]")).toBe("No active giveaway");
    const chatAction = card("chat").querySelector("[data-action]");
    expect(chatAction.textContent).toBe("Create giveaway");
    expect(chatAction.className).toContain("btn--accent");
    mod.leave();
  });

  it("keeps the SSR copy and reports the meta line when a fetch fails", async () => {
    document.body.innerHTML = renderEngageHubHtml();
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const path = String(input).split("?")[0];
      if (path === "/api/tournaments") return json({ error: "boom" }, 500);
      return realFetch(input, init);
    };
    try {
      const mod = await import("../assets/giveaways.js");
      await mod.enter({ tab: "hub" });
      const t = card("tournaments");
      expect(t.classList.contains("is-done")).toBe(false);
      expect(cardText("tournaments", "[data-status-label]")).toBe("No active tournament");
      expect(cardText("tournaments", "[data-status-meta]")).toBe("Couldn't load status.");
      mod.leave();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
