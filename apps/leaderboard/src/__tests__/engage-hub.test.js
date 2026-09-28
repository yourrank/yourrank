// Behavioral coverage for the Engage hub at /dashboard/giveaways: the
// server-rendered 3-card grid, the pure engageCardState payload mapping, and
// the real giveaways.js boot pass filling card status from the feature APIs
// that have a status source (chat giveaway, tournaments).
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
  it("renders three destination cards in order with default status copy", () => {
    const html = renderEngageHubHtml();
    document.body.innerHTML = html;
    const features = [...document.querySelectorAll(".engage-card")].map((c) => c.dataset.feature);
    expect(features).toEqual(["activities", "chat", "tournaments"]);
    const expected = [
      ["activities", "Activities", "Run code drops and community activities.", "Activities", "Share a free code with your community. Track claims here.", "Open activities", "/dashboard/activities"],
      ["chat", "Giveaways", "Run chat giveaways, raffles, and predictions.", "No active giveaway", "Create a giveaway to engage your viewers.", "Create giveaway", "/dashboard/giveaways/chat"],
      ["tournaments", "Tournaments", "Run brackets and community competitions.", "No active tournament", "Set up a bracket for your community.", "Create tournament", "/dashboard/giveaways/tournaments"],
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
    expect(html).toContain("<h1>Engage</h1>");
    expect(html).not.toContain("engage-tabs");
    expect(html).not.toContain("gw-subnav");
    expect(html).not.toContain("gw-nav-tabs");
    expect(html).not.toContain("gw-drawer-backdrop");
  });

  it("renders Giveaways pages with the subnav below the head and active subtype", () => {
    const subnavPaths = {
      chat: "/dashboard/giveaways/chat",
      raffles: "/dashboard/giveaways/raffles",
      preds: "/dashboard/giveaways/predictions",
    };
    for (const tab of ["chat", "raffles", "preds"]) {
      const html = renderGiveawaysHtml(tab);
      expect(html, tab).not.toContain("engage-back");
      expect(html, tab).toContain("<h1>Giveaways</h1>");
      expect(html, tab).not.toContain("gw-nav-tabs");
      expect(html, tab).not.toContain("gw-tab-btn");
      expect(html, tab).not.toContain("data-tabs-more");
      expect(html, tab).not.toContain("engage-tabs");
      expect(html, tab).toContain('class="v3-tabs gw-subnav" aria-label="Giveaways"');
      // The subtype subnav sits under the page head: h1 first, tabs second.
      expect(html.indexOf("v3-head"), tab).toBeLessThan(html.indexOf("gw-subnav"));
      expect(html, tab).toContain(`aria-current="page"`);
      // The active subtype carries aria-current; the other two do not.
      document.body.innerHTML = html;
      const items = [...document.querySelectorAll(".gw-subnav a")].map((a) => ({
        href: a.getAttribute("href"),
        current: a.getAttribute("aria-current") === "page",
        label: a.textContent,
      }));
      expect(items.map((i) => i.label)).toEqual(["Chat Giveaway", "Raffle", "Prediction"]);
      expect(items.filter((i) => i.current).map((i) => i.href)).toEqual([subnavPaths[tab]]);
    }
    // Tournaments owns its own page chrome: no subnav, no back-link.
    const tournaments = renderGiveawaysHtml("tournaments");
    expect(tournaments).not.toContain("engage-back");
    expect(tournaments).not.toContain("gw-subnav");
    expect(tournaments).not.toContain("engage-tabs");
  });

  it("renders the hub through renderGiveawaysHtml without drawers", () => {
    const html = renderGiveawaysHtml("hub");
    expect(html).toContain('id="engage-hub"');
    expect(html).not.toContain("gw-drawer-backdrop");
    expect(html).not.toContain("gw-nav-tabs");
    expect(html).not.toContain("gw-subnav");
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
    // An active bracket keeps signup_state "locked"; bracket lifecycle must win.
    const bracket = engageCardState("tournaments", {
      tournaments: [{ title: "Community tournament", status: "active", signup_state: "locked", bracket_size: 8, participant_count: 8, selected_count: 8 }],
    });
    expect(bracket.tone).toBe("live");
    expect(bracket.label).toBe("Bracket in progress");
    expect(bracket.meta).toEqual(["Community tournament", "8 participants · 8 slots"]);
    expect(bracket.action.label).toBe("Open tournament");
    const doneLocked = engageCardState("tournaments", {
      tournaments: [{ title: "Cup", status: "completed", signup_state: "locked", bracket_size: 8, participant_count: 8, selected_count: 8 }],
    });
    expect(doneLocked.tone).toBe("done");
    expect(doneLocked.label).toBe("Completed");
    const draftClosed = engageCardState("tournaments", {
      tournaments: [{ title: "Cup", status: "draft", signup_state: "closed", bracket_size: 8, participant_count: 0, selected_count: 0 }],
    });
    expect(draftClosed.tone).toBe("warn");
    expect(draftClosed.label).toBe("Draft");
    expect(draftClosed.meta).toEqual(["Cup"]);
  });
});

describe("Engage hub boot", () => {
  it("fills card status from the feature APIs", async () => {
    document.body.innerHTML = renderEngageHubHtml();
    server.chat = { connection: { connected: true, chatReady: true, channelName: "creator" }, session: null, entries: [], winner: null };
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
