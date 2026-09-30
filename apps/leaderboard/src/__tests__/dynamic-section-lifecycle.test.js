// Lifecycle coverage for dynamic-section React islands, including the
// separate Tournaments tab owner. Page data and behavior are covered by the
// page-specific suites.
//
// Run: bun test src/__tests__/dynamic-section-lifecycle.test.js

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { renderGiveawaysHtml } from "../pages/giveaway-pages.js";
import { ActivitiesPage } from "../pages/activities.jsx";
import { clearSession } from "../assets/dashboard/session.js";

const window = new Window({ url: "http://localhost/dashboard/giveaways/tournaments" });
const { document } = window;
const INSTALLED_GLOBALS = ["window", "document", "location", "history", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "HTMLFormElement", "HTMLIFrameElement", "HTMLInputElement", "HTMLSelectElement", "DocumentFragment", "DOMParser", "IntersectionObserver", "MutationObserver", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "matchMedia", "localStorage", "fetch"];
const originalGlobals = Object.fromEntries(INSTALLED_GLOBALS.map((k) => [k, globalThis[k]]));
const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
for (const key of INSTALLED_GLOBALS.filter((key) => key !== "localStorage" && key !== "fetch")) {
  globalThis[key] = ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(key)
    ? window[key].bind(window)
    : window[key];
}
window.Element.prototype.scrollIntoView = function () {};
window.Element.prototype.getClientRects = function () { return [{}]; };
globalThis.localStorage = window.localStorage;
window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.matchMedia = window.matchMedia;
window.scrollTo = () => {};
window.YRDialog = { trap: () => () => {}, confirm: async () => true };
window.__yrSpaShell = true;
window.__yrBoot = { signal() {}, fail() {} };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const user = { id: "user-1", email: "creator@example.com", plan: "pro", emailVerified: true };
const site = { id: "site-1", name: "Kick Cup", slug: "kick-cup", published: true, userRole: "owner", kickChannelName: "" };
const tournament = {
  id: "t-1", title: "Community Cup", game_name: "Rocket League", bracket_size: 8, status: "draft",
  signup_state: "closed", entry_cap: null, format: "bracket", anti_alt_enabled: false,
  entry_keyword: "!join", chat_channel: "", winner_name: null,
};
const activity = {
  id: "drop-1", title: "Community drop", typeLabel: "Code drop", state: "open", stateLabel: "Open",
  createdAt: new Date().toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString(),
  reward: { creditsPerClaim: 250 }, progress: { claimed: 32, capacity: 100 }, actions: { canEnd: true },
};

const FRAGMENTS = {
  "/dashboard/giveaways/tournaments": () => renderGiveawaysHtml("tournaments"),
  "/dashboard/giveaways/chat": () => renderGiveawaysHtml("chat"),
  "/dashboard/giveaways": () => renderGiveawaysHtml("hub"),
  "/dashboard/activities": () => ActivitiesPage({ fragment: true }).toString(),
};

let fragmentStatus = 200;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = async (input) => {
  const raw = String(input);
  const path = raw.split("?")[0];
  if (path === "/dashboard/_content") {
    if (fragmentStatus !== 200) return json({ error: "boom" }, fragmentStatus);
    const target = decodeURIComponent(new URLSearchParams(raw.split("?")[1]).get("path") || "").split("?")[0];
    const render = FRAGMENTS[target];
    if (!render) return json({ error: "not found" }, 404);
    return json({ html: render(), title: "Fixture", styles: [] });
  }
  if (path === "/api/auth/me") return json({ ok: true, user });
  if (path === "/api/site/list") return json({ ok: true, sites: [site] });
  if (path === "/api/tournaments") return json({ ok: true, tournaments: [tournament], chatRegistration: { connected: false, chatReady: false, channelName: null, externalChannelId: null } });
  if (path.endsWith("/entries")) return json({ ok: true, entries: [], counts: { active: 0, eligible: 0, waitlist: 0, removed: 0, blocked: 0 } });
  if (path.endsWith("/bracket")) return json({ ok: true, tournament, matches: [] });
  if (path === "/api/activities") {
    const state = new URLSearchParams(raw.split("?")[1]).get("state");
    const rows = state === "completed" ? [] : [activity];
    return json({ activities: rows, total: rows.length, page: { hasMore: false, nextCursor: null }, automation: { templates: [], schedules: [], entitlement: { canAutomate: true } } });
  }
  if (path === "/api/giveaways/chat") return json({
    connection: { connected: false, chatReady: false, channelName: null },
    session: null,
    entries: [],
    winner: null,
  });
  if (path === "/api/giveaways/chatroom") return json({ error: "offline" }, 404);
  return json({ ok: true });
};
const flushReactUpdates = async () => {
  for (let index = 0; index < 12; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

document.body.innerHTML = `<h1 data-chrome-h1>Home</h1><div id="lbDynamic" hidden></div>`;
const $id = (id) => document.getElementById(id);

const routes = await import("../assets/dashboard/routes.js");
const ds = await import("../assets/dashboard/dynamic-section.js");

afterAll(() => {
  for (const key of INSTALLED_GLOBALS) globalThis[key] = originalGlobals[key];
  if (originalActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  else globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
});

async function actDynamic(callback) {
  let result;
  await act(async () => {
    result = await callback();
    await flushReactUpdates();
  });
  return result;
}

const loadDynamicSection = (section, tab) => actDynamic(() => ds.loadDynamicSection(section, tab));
const leaveDynamicSection = () => actDynamic(() => ds.leaveDynamicSection());

describe("bootOwners", () => {
  it("returns the base owner plus tab-specific owners", () => {
    expect(routes.bootOwners("giveaways", "tournaments")).toEqual(["giveaways", "tournaments"]);
    expect(routes.bootOwners("giveaways", "chat")).toEqual(["giveaways"]);
    expect(routes.bootOwners("activities", "overview")).toEqual(["activities"]);
    expect(routes.bootOwners("nope", "x")).toEqual([]);
  });
});

describe("dynamic-section lifecycle", () => {
  beforeEach(() => {
    fragmentStatus = 200;
    clearSession();
  });

  it("boots the tab owner on the tournaments route, leaves it, and re-enters", async () => {
    expect(await loadDynamicSection("giveaways", "tournaments")).toBe(true);
    expect(ds.isDynamicActive()).toBe(true);
    expect($id("tournament-app")).toBeTruthy();
    expect($id("tournament-root").querySelector("#tournament-empty, #tournament-workspace")).toBeTruthy();

    // Away to Activities: tournaments leave runs, activities enter succeeds.
    expect(await loadDynamicSection("activities", "overview")).toBe(true);
    expect($id("tournament-app")).toBeNull();
    expect($id("act-live-loading").hidden).toBe(true);
    expect($id("act-live-error").hidden).toBe(true);
    expect($id("act-live-list").hidden).toBe(false);
    expect($id("act-live-list").children.length).toBe(1);
    expect($id("act-history-empty").hidden).toBe(false);
    expect(document.documentElement.classList.contains("yr-modal-open")).toBe(false);

    // Back to Tournaments: the tab owner mounts a fresh React island.
    expect(await loadDynamicSection("giveaways", "tournaments")).toBe(true);
    expect($id("tournament-root").querySelector("#tournament-empty, #tournament-workspace")).toBeTruthy();
    expect(ds.isDynamicActive()).toBe(true);

    // Explicit leave detaches the section; a later load still initializes.
    await leaveDynamicSection();
    expect(ds.isDynamicActive()).toBe(false);
    expect(await loadDynamicSection("giveaways", "tournaments")).toBe(true);
    expect($id("tournament-root").querySelector("#tournament-empty, #tournament-workspace")).toBeTruthy();
  });

  it("mounts the Giveaways React island, unmounts on navigation, and mounts again", async () => {
    expect(await loadDynamicSection("giveaways", "chat")).toBe(true);
    expect($id("giveaway-root").childElementCount).toBeGreaterThan(0);

    expect(await loadDynamicSection("activities", "overview")).toBe(true);
    expect($id("gw-layout")).toBeNull();
    expect($id("giveaway-root")).toBeNull();
    expect($id("act-live-list").children.length).toBe(1);

    expect(await loadDynamicSection("giveaways", "chat")).toBe(true);
    expect($id("giveaway-root").childElementCount).toBeGreaterThan(0);
    await leaveDynamicSection();
    expect($id("giveaway-root")).toBeNull();
  });

  it("shows a generic error body with Retry for fragment failures", async () => {
    fragmentStatus = 500;
    expect(await ds.loadDynamicSection("giveaways", "chat")).toBe(false);
    const container = $id("lbDynamic");
    expect(container.textContent).toContain("Couldn't load this section.");
    expect(container.textContent).not.toContain("HTTP 500");
    const retry = container.querySelector("#stateRetry");
    expect(retry?.textContent).toBe("Retry");
    fragmentStatus = 200;
    await actDynamic(() => retry.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  });

  it("surfaces the permission message for a 403", async () => {
    fragmentStatus = 403;
    globalThis.fetch = ((real) => async (input, init) => {
      const raw = String(input);
      if (raw.startsWith("/dashboard/_content")) {
        return json({ error: "You don't have permission to view this section." }, 403);
      }
      return real(input, init);
    })(globalThis.fetch);
    expect(await ds.loadDynamicSection("giveaways", "chat")).toBe(false);
    expect($id("lbDynamic").textContent).toContain("You don't have permission to view this section.");
  });
});
