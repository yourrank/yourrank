// Behavioral coverage for the React Engage overview: its destination rows,
// payload mapping, and per-row API failure isolation.
//
// Run: bun test src/__tests__/engage-hub.test.js

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { renderEngageHubHtml, renderGiveawaysHtml } from "../pages/giveaway-pages.js";
import { ENGAGE_IDLE, engageCardState } from "../assets/dashboard/engage-hub-state.js";
import {
  document,
  mountGiveawaysPage,
  restoreGiveawaysDomGlobals,
  unmountGiveawaysPage,
} from "./giveaways-react-utils.js";

const site = { id: "site-1", name: "Kick Cup", slug: "kick-cup", published: true, userRole: "owner", kickChannelName: "" };

const server = {
  chat: { connection: { connected: true, chatReady: true, channelName: "creator" }, session: null, entries: [], winner: null },
  raffles: { raffles: [] },
  predictions: { predictions: [] },
  tournaments: { tournaments: [], chatRegistration: {} },
  activities: { activities: [], total: 0, nextCursor: null },
};

async function hubApi(path) {
  if (path.startsWith("/api/activities")) return server.activities;
  if (path === "/api/giveaways/chat") return server.chat;
  if (path === "/api/events/raffles") return server.raffles;
  if (path === "/api/predictions") return server.predictions;
  if (path === "/api/tournaments") return server.tournaments;
  throw new Error(`unhandled ${path}`);
}

async function mountHub(api = hubApi) {
  const requests = [];
  const trackedApi = async (path, init, siteId) => {
    requests.push({ path, init, siteId });
    return api(path, init, siteId);
  };
  await mountGiveawaysPage({ tab: "hub", site, deps: { api: trackedApi } });
  return requests;
}

afterAll(() => {
  restoreGiveawaysDomGlobals();
});
afterEach(async () => {
  await unmountGiveawaysPage();
});

const row = (feature) => document.querySelector(`.engage-row[data-feature="${feature}"]`);
const rowTitle = (feature) => row(feature)?.querySelector("a > span:nth-child(2) > span:first-child")?.textContent;
const rowDescription = (feature) => row(feature)?.querySelector("a > span:nth-child(2) > span:nth-child(2)")?.textContent;
const badge = (feature) => row(feature)?.querySelector("[data-status]");
const badgeLabel = (feature) => badge(feature)?.textContent.trim();
const rowMeta = (feature) => row(feature)?.querySelector("[data-status-meta]")?.textContent;

describe("Engage hub markup", () => {
  it("renders three destination rows in order, pending until the APIs settle", async () => {
    await mountHub(() => new Promise(() => {}));
    const features = [...document.querySelectorAll(".engage-row")].map((c) => c.dataset.feature);
    expect(features).toEqual(["activities", "giveaways", "tournaments"]);
    const expected = [
      ["activities", "Activities", "/dashboard/activities"],
      ["giveaways", "Giveaways", "/dashboard/giveaways/chat"],
      ["tournaments", "Tournaments", "/dashboard/giveaways/tournaments"],
    ];
    for (const [feature, title, href] of expected) {
      expect(rowTitle(feature)).toBe(title);
      expect(rowDescription(feature)).toBeTruthy();
      expect(row(feature).querySelector("a").getAttribute("href")).toBe(href);
      expect(row(feature).dataset.status).toBe("pending");
      expect(badge(feature).dataset.status).toBe("pending");
      expect(badgeLabel(feature)).toBe("Checking…");
      expect(row(feature).querySelector("a > span:first-child svg")).toBeTruthy();
      // One link per row: no secondary action button duplicating the destination.
      expect(row(feature).querySelectorAll("a").length).toBe(1);
    }
    expect(document.querySelector("h1")?.textContent).toBe("Engage");
    expect(document.getElementById("engage-scope").getAttribute("data-scope")).toBe("site");
    expect(document.querySelector("#giveaway-root")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("engage-tabs");
    expect(document.body.innerHTML).not.toContain("gw-subnav");
    expect(document.body.innerHTML).not.toContain("gw-drawer-backdrop");
  });

  it("renders Giveaways pages with the subnav below the head and active subtype", async () => {
    const subnavPaths = {
      chat: "/dashboard/giveaways/chat",
      raffles: "/dashboard/giveaways/raffles",
      preds: "/dashboard/giveaways/predictions",
    };
    for (const tab of ["chat", "raffles", "preds"]) {
      const html = renderGiveawaysHtml(tab);
      expect(html, tab).toContain(`data-tab="${tab}"`);
      expect(html, tab).toContain('id="giveaway-root"');
      await mountGiveawaysPage({ tab, site, deps: { api: async () => ({}) } });
      expect(document.querySelector("h1")?.textContent).toBe("Giveaways");
      expect(document.querySelector("nav[aria-label='Giveaways']")).toBeTruthy();
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
    expect(tournaments).toContain('id="tournament-root"');
    expect(tournaments).toContain('id="tournament-dialogs"');
    expect(tournaments).not.toContain("giveaway-root");
    expect(tournaments).not.toContain("gw-subnav");
    expect(tournaments).not.toContain("engage-tabs");
  });

  it("renders the hub through renderGiveawaysHtml without drawers", () => {
    const html = renderGiveawaysHtml("hub");
    expect(html).toContain('id="giveaway-root"');
    expect(html).toContain('data-tab="hub"');
    expect(renderEngageHubHtml()).toBe(html);
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
    server.chat = liveChat;
    server.activities = { activities: [{ id: "drop:1", progress: { claimed: 4, capacity: 10 } }, { id: "drop:2", progress: { claimed: 0, capacity: 0 } }], total: 2, nextCursor: null };
    server.raffles = { raffles: [{ id: "r-1", status: "active" }] };
    server.predictions = { predictions: [{ id: "p-1", status: "locked" }] };
    server.tournaments = {
      tournaments: [{ id: "t-1", title: "Community tournament", status: "completed", signup_state: "closed", bracket_size: 8, participant_count: 5, selected_count: 2 }],
      chatRegistration: {},
    };
    const requests = await mountHub();

    expect(row("activities").dataset.status).toBe("live");
    expect(badge("activities").dataset.tone).toBe("success");
    expect(badgeLabel("activities")).toBe("2 active drops");
    expect(rowMeta("activities")).toBe("4 of 10 claims taken");

    expect(badgeLabel("giveaways")).toBe("2 running");
    expect(rowMeta("giveaways")).toBe("1 raffle open · 1 prediction locked");

    expect(row("tournaments").dataset.status).toBe("completed");
    expect(badgeLabel("tournaments")).toBe("Completed");
    expect(rowMeta("tournaments")).toBe("Community tournament · 2 participants · 8 slots");
    // Destinations are unchanged by status.
    expect(row("tournaments").querySelector("a").getAttribute("href")).toBe("/dashboard/giveaways/tournaments");
    expect(document.querySelector("#engage-scope .v3-scope-name")?.textContent).toBe("Kick Cup");
    expect(requests).toHaveLength(5);
    expect(requests.every((request) => request.siteId === "site-1")).toBe(true);
  });

  it("shows idle rows when nothing is running", async () => {
    server.chat = liveChat;
    server.activities = { activities: [], total: 0, nextCursor: null };
    server.raffles = { raffles: [] };
    server.predictions = { predictions: [] };
    server.tournaments = { tournaments: [], chatRegistration: {} };
    await mountHub();
    expect(badgeLabel("activities")).toBe("No active drops");
    expect(badgeLabel("giveaways")).toBe("Nothing running");
    expect(badgeLabel("tournaments")).toBe("No tournament");
    for (const f of ["activities", "giveaways", "tournaments"]) expect(row(f).dataset.status).toBe("idle");
  });

  it("isolates a failed feature API to its own row", async () => {
    server.chat = liveChat;
    server.activities = { activities: [{ id: "drop:1", progress: { claimed: 1, capacity: 5 } }], total: 1, nextCursor: null };
    server.raffles = { raffles: [] };
    server.predictions = { predictions: [{ status: "open" }] };
    await mountHub(async (path) => {
      if (path === "/api/tournaments") throw new Error("boom");
      if (path === "/api/giveaways/chat") throw new TypeError("network down");
      return hubApi(path);
    });
    expect(row("tournaments").dataset.status).toBe("unavailable");
    expect(badgeLabel("tournaments")).toBe("Status unavailable");
    expect(rowMeta("tournaments")).toBe("Couldn't load status. Open the page to check.");
    // The other rows still resolve from their own data.
    expect(badgeLabel("activities")).toBe("1 active drop");
    expect(badgeLabel("giveaways")).toBe("1 running");
    expect(rowMeta("giveaways")).toBe("1 prediction open · Couldn't check chat giveaway.");
  });

  it("marks Giveaways unavailable only when every source fails", async () => {
    server.activities = { activities: [], total: 0, nextCursor: null };
    server.tournaments = { tournaments: [], chatRegistration: {} };
    await mountHub(async (path) => {
      if (["/api/giveaways/chat", "/api/events/raffles", "/api/predictions"].includes(path)) throw new Error("boom");
      return hubApi(path);
    });
    expect(row("giveaways").dataset.status).toBe("unavailable");
    expect(badgeLabel("activities")).toBe("No active drops");
    expect(badgeLabel("tournaments")).toBe("No tournament");
  });
});
