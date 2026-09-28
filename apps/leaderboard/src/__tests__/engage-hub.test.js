// Behavioral coverage for the Engage overview at /dashboard/giveaways: the
// server-rendered destination list, the pure engageCardState payload mapping
// (Activities count, Giveaways aggregate, Tournament lifecycle), and the real
// giveaways.js boot pass filling each row from its APIs with per-row failure
// isolation.
//
// Run: bun test src/__tests__/engage-hub.test.js

import { afterAll, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { renderEngageHubHtml, renderGiveawaysHtml } from "../pages/giveaway-pages.js";
import { ENGAGE_IDLE, engageCardState } from "../assets/dashboard/engage-hub-state.js";

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
  activities: { activities: [], total: 0, nextCursor: null },
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
  if (path === "/api/activities") return json(server.activities);
  return json({ error: `unhandled ${path}` }, 404);
};

afterAll(() => {
  for (const [key, value] of Object.entries(originalGlobals)) globalThis[key] = value;
});

const row = (feature) => document.querySelector(`.engage-row[data-feature="${feature}"]`);
const rowText = (feature, sel) => row(feature)?.querySelector(sel)?.textContent;
const badge = (feature) => row(feature)?.querySelector(".v3-badge");
const badgeLabel = (feature) => badge(feature)?.textContent.trim();

describe("Engage hub markup", () => {
  it("renders three destination rows in order, pending until the client fills them", () => {
    const html = renderEngageHubHtml();
    document.body.innerHTML = html;
    const features = [...document.querySelectorAll(".engage-row")].map((c) => c.dataset.feature);
    expect(features).toEqual(["activities", "giveaways", "tournaments"]);
    const expected = [
      ["activities", "Activities", "/dashboard/activities"],
      ["giveaways", "Giveaways", "/dashboard/giveaways/chat"],
      ["tournaments", "Tournaments", "/dashboard/giveaways/tournaments"],
    ];
    for (const [feature, title, href] of expected) {
      expect(rowText(feature, ".engage-row__title")).toBe(title);
      expect(row(feature).querySelector(".engage-row__link").getAttribute("href")).toBe(href);
      expect(row(feature).dataset.status).toBe("pending");
      expect(badge(feature).dataset.status).toBe("pending");
      expect(badgeLabel(feature)).toBe("Checking…");
      expect(row(feature).querySelectorAll(".engage-row__icon svg").length).toBe(1);
      // One link per row: no secondary action button duplicating the destination.
      expect(row(feature).querySelectorAll("a").length).toBe(1);
    }
    // Shared primitives: page header with site scope, neutral list shell.
    expect(html).toContain("<h1>Engage</h1>");
    expect(html).toContain('id="engage-scope"');
    expect(html).toContain('data-scope="site"');
    expect(html).toContain('class="v3-list-shell engage-hub" aria-label="Engage destinations" id="engage-hub"');
    expect(html).not.toContain("v3-table-card");
    expect(html).not.toContain("engage-card");
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
  it("counts open drops from the Activities API", () => {
    expect(engageCardState("activities", { activities: [], total: 0 })).toEqual({ tone: "neutral", status: "idle", ...ENGAGE_IDLE.activities });
    const one = engageCardState("activities", {
      activities: [{ id: "drop:1", progress: { claimed: 3, capacity: 10 } }], total: 1,
    });
    expect(one.tone).toBe("success");
    expect(one.label).toBe("1 active drop");
    expect(one.meta).toBe("3 of 10 claims taken");
    const two = engageCardState("activities", {
      activities: [{ progress: { claimed: 3, capacity: 10 } }, { progress: { claimed: 0, capacity: 5 } }], total: 2,
    });
    expect(two.label).toBe("2 active drops");
    expect(two.meta).toBe("3 of 15 claims taken");
    // `total` is the server count; rows are only a fallback.
    expect(engageCardState("activities", { activities: [{}, {}] }).label).toBe("2 active drops");
    expect(engageCardState("activities", { activities: [{}], total: 7 }).label).toBe("7 active drops");
  });

  it("aggregates chat giveaway, raffles, and predictions", () => {
    const idle = { chat: { session: null, entries: [] }, raffles: { raffles: [] }, predictions: { predictions: [] } };
    expect(engageCardState("giveaways", idle)).toEqual({ tone: "neutral", status: "idle", ...ENGAGE_IDLE.giveaways });
    // Ended chat session and closed raffle/prediction are not "running".
    expect(engageCardState("giveaways", {
      chat: { session: { status: "completed" }, entries: [{}] },
      raffles: { raffles: [{ status: "drawn" }] },
      predictions: { predictions: [{ status: "resolved" }, { status: "cancelled" }] },
    })).toEqual({ tone: "neutral", status: "idle", ...ENGAGE_IDLE.giveaways });

    const chat = engageCardState("giveaways", { ...idle, chat: { session: { status: "active", keyword: "!win" }, entries: [{}, {}, {}] } });
    expect(chat.tone).toBe("success");
    expect(chat.label).toBe("1 running");
    expect(chat.meta).toBe("Chat giveaway live · 3 entries");

    // A raffle alone must not read as "nothing running".
    const raffle = engageCardState("giveaways", { ...idle, raffles: { raffles: [{ status: "active" }, { status: "drawn" }] } });
    expect(raffle.label).toBe("1 running");
    expect(raffle.meta).toBe("1 raffle open");

    const preds = engageCardState("giveaways", { ...idle, predictions: { predictions: [{ status: "open" }, { status: "locked" }, { status: "resolved" }] } });
    expect(preds.label).toBe("2 running");
    expect(preds.meta).toBe("1 prediction open · 1 prediction locked");

    const all = engageCardState("giveaways", {
      chat: { session: { status: "active" }, entries: [] },
      raffles: { raffles: [{ status: "active" }, { status: "active" }] },
      predictions: { predictions: [{ status: "locked" }] },
    });
    expect(all.label).toBe("3 running");
    expect(all.meta).toBe("Chat giveaway live · 0 entries · 2 raffles open · 1 prediction locked");
  });

  it("reports partially-known giveaway state instead of guessing", () => {
    // One source failed, another is live: keep the live fact, flag the gap.
    const partial = engageCardState("giveaways", {
      chat: undefined, raffles: { raffles: [{ status: "active" }] }, predictions: { predictions: [] },
    });
    expect(partial.tone).toBe("success");
    expect(partial.label).toBe("1 running");
    expect(partial.meta).toBe("1 raffle open · Couldn't check chat giveaway.");
    // Nothing live among the sources that loaded: say so, but not "idle".
    const quiet = engageCardState("giveaways", { chat: { session: null }, raffles: undefined, predictions: undefined });
    expect(quiet.status).toBe("partial");
    expect(quiet.label).toBe("Nothing running");
    expect(quiet.meta).toBe("Couldn't check raffles or predictions.");
    // Every source failed: null so the caller shows the load-failure state.
    expect(engageCardState("giveaways", {})).toBeNull();
    expect(engageCardState("chat", {})).toBeNull();
    expect(engageCardState("nope", {})).toBeNull();
  });

  it("maps the real tournament lifecycle", () => {
    expect(engageCardState("tournaments", { tournaments: [] })).toEqual({ tone: "neutral", status: "idle", ...ENGAGE_IDLE.tournaments });
    expect(engageCardState("tournaments", { tournaments: [{ status: "cancelled", title: "Old" }] })).toEqual({ tone: "neutral", status: "idle", ...ENGAGE_IDLE.tournaments });
    const done = engageCardState("tournaments", {
      tournaments: [{ title: "Community tournament", status: "completed", signup_state: "closed", bracket_size: 8, participant_count: 5, selected_count: 2 }],
    });
    expect(done).toEqual({ tone: "neutral", status: "completed", label: "Completed", meta: "Community tournament · 2 participants · 8 slots" });
    const signups = engageCardState("tournaments", {
      tournaments: [{ title: "Cup", status: "draft", signup_state: "open", bracket_size: 8, participant_count: 5, selected_count: 0 }],
    });
    expect(signups).toEqual({ tone: "success", status: "signups_open", label: "Signups open", meta: "Cup · 5 participants · 8 slots" });
    const locked = engageCardState("tournaments", {
      tournaments: [{ title: "Cup", status: "draft", signup_state: "locked", bracket_size: 8, participant_count: 8 }],
    });
    expect(locked.status).toBe("signups_locked");
    expect(locked.tone).toBe("warning");
    // An active bracket keeps signup_state "locked"; bracket lifecycle must win.
    const bracket = engageCardState("tournaments", {
      tournaments: [{ title: "Community tournament", status: "active", signup_state: "locked", bracket_size: 8, participant_count: 8, selected_count: 8 }],
    });
    expect(bracket).toEqual({ tone: "success", status: "active", label: "Bracket in progress", meta: "Community tournament · 8 participants · 8 slots" });
    const draftClosed = engageCardState("tournaments", {
      tournaments: [{ title: "Cup", status: "draft", signup_state: "closed", bracket_size: 8, participant_count: 0, selected_count: 0 }],
    });
    expect(draftClosed).toEqual({ tone: "info", status: "draft", label: "Draft", meta: "Cup" });
  });
});

describe("Engage hub boot", () => {
  const liveChat = { connection: { connected: true, chatReady: true, channelName: "creator" }, session: null, entries: [], winner: null };

  it("fills every row from its API and stamps the site scope", async () => {
    document.body.innerHTML = renderEngageHubHtml();
    server.chat = liveChat;
    server.activities = { activities: [{ id: "drop:1", progress: { claimed: 4, capacity: 10 } }, { id: "drop:2", progress: { claimed: 0, capacity: 0 } }], total: 2, nextCursor: null };
    server.raffles = { raffles: [{ id: "r-1", status: "active" }] };
    server.predictions = { predictions: [{ id: "p-1", status: "locked" }] };
    server.tournaments = {
      tournaments: [{ id: "t-1", title: "Community tournament", status: "completed", signup_state: "closed", bracket_size: 8, participant_count: 5, selected_count: 2 }],
      chatRegistration: {},
    };
    const mod = await import("../assets/giveaways.js");
    await mod.enter({ tab: "hub" });

    expect(row("activities").dataset.status).toBe("live");
    expect(badge("activities").dataset.tone).toBe("success");
    expect(badgeLabel("activities")).toBe("2 active drops");
    expect(rowText("activities", "[data-status-meta]")).toBe("4 of 10 claims taken");

    expect(badgeLabel("giveaways")).toBe("2 running");
    expect(rowText("giveaways", "[data-status-meta]")).toBe("1 raffle open · 1 prediction locked");

    expect(row("tournaments").dataset.status).toBe("completed");
    expect(badgeLabel("tournaments")).toBe("Completed");
    expect(rowText("tournaments", "[data-status-meta]")).toBe("Community tournament · 2 participants · 8 slots");
    // Destinations are unchanged by status.
    expect(row("tournaments").querySelector("a").getAttribute("href")).toBe("/dashboard/giveaways/tournaments");
    expect(document.querySelector("#engage-scope .v3-scope-name")?.textContent).toBe("Kick Cup");
    mod.leave();
  });

  it("shows idle rows when nothing is running", async () => {
    document.body.innerHTML = renderEngageHubHtml();
    server.chat = liveChat;
    server.activities = { activities: [], total: 0, nextCursor: null };
    server.raffles = { raffles: [] };
    server.predictions = { predictions: [] };
    server.tournaments = { tournaments: [], chatRegistration: {} };
    const mod = await import("../assets/giveaways.js");
    await mod.enter({ tab: "hub" });
    expect(badgeLabel("activities")).toBe("No active drops");
    expect(badgeLabel("giveaways")).toBe("Nothing running");
    expect(badgeLabel("tournaments")).toBe("No tournament");
    for (const f of ["activities", "giveaways", "tournaments"]) expect(row(f).dataset.status).toBe("idle");
    mod.leave();
  });

  it("isolates a failed feature API to its own row", async () => {
    document.body.innerHTML = renderEngageHubHtml();
    server.chat = liveChat;
    server.activities = { activities: [{ id: "drop:1", progress: { claimed: 1, capacity: 5 } }], total: 1, nextCursor: null };
    server.raffles = { raffles: [] };
    server.predictions = { predictions: [{ status: "open" }] };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const path = String(input).split("?")[0];
      if (path === "/api/tournaments") return json({ error: "boom" }, 500);
      if (path === "/api/giveaways/chat") throw new TypeError("network down");
      return realFetch(input, init);
    };
    try {
      const mod = await import("../assets/giveaways.js");
      await mod.enter({ tab: "hub" });
      expect(row("tournaments").dataset.status).toBe("unavailable");
      expect(badgeLabel("tournaments")).toBe("Status unavailable");
      expect(rowText("tournaments", "[data-status-meta]")).toBe("Couldn't load status. Open the page to check.");
      // The other rows still resolve from their own data.
      expect(badgeLabel("activities")).toBe("1 active drop");
      expect(badgeLabel("giveaways")).toBe("1 running");
      expect(rowText("giveaways", "[data-status-meta]")).toBe("1 prediction open · Couldn't check chat giveaway.");
      mod.leave();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("marks Giveaways unavailable only when every source fails", async () => {
    document.body.innerHTML = renderEngageHubHtml();
    server.activities = { activities: [], total: 0, nextCursor: null };
    server.tournaments = { tournaments: [], chatRegistration: {} };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const path = String(input).split("?")[0];
      if (["/api/giveaways/chat", "/api/events/raffles", "/api/predictions"].includes(path)) return json({ error: "boom" }, 503);
      return realFetch(input, init);
    };
    try {
      const mod = await import("../assets/giveaways.js");
      await mod.enter({ tab: "hub" });
      expect(row("giveaways").dataset.status).toBe("unavailable");
      expect(badgeLabel("activities")).toBe("No active drops");
      expect(badgeLabel("tournaments")).toBe("No tournament");
      mod.leave();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
