// Lifecycle coverage for the dynamic-section loader: SPA fragment navigation
// must mount and unmount the Tournaments React island through its tab owner.
// Page data and behavior are covered in tournament-lifecycle-ui.test.js.
//
// Run: bun test src/__tests__/dynamic-section-lifecycle.test.js

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { renderGiveawaysHtml } from "../pages/giveaway-pages.js";
import { activitiesContentHtml } from "../pages/activities.jsx";
import { clearSession } from "../assets/dashboard/session.js";

const window = new Window({ url: "http://localhost/dashboard/giveaways/tournaments" });
const { document } = window;
const REACT_DOM_GLOBALS = [
  "DocumentFragment", "FocusEvent", "HTMLButtonElement", "HTMLFormElement",
  "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement",
  "MutationObserver", "NodeFilter", "PointerEvent", "ShadowRoot", "SVGElement",
  "requestAnimationFrame", "cancelAnimationFrame",
];
const INSTALLED_GLOBALS = ["window", "document", "location", "history", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "DOMParser", "getComputedStyle", "matchMedia", ...REACT_DOM_GLOBALS, "localStorage", "fetch"];
const originalGlobals = Object.fromEntries(INSTALLED_GLOBALS.map((k) => [k, globalThis[k]]));
for (const key of INSTALLED_GLOBALS.slice(0, 15)) {
  globalThis[key] = key === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[key];
}
for (const key of REACT_DOM_GLOBALS) {
  globalThis[key] = key.endsWith("AnimationFrame") ? window[key].bind(window) : window[key];
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
  "/dashboard/activities": () => activitiesContentHtml,
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
  if (path === "/api/giveaways/chat") return json({ ok: true, state: null, entries: [] });
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
const { api } = await import("../react/lib/api.js");
const { setActivitiesPageDependenciesForTests } = await import("../assets/react/activities.js");
const loadBoardShell = async () => ({ activeSiteId: site.id, board: site });
setActivitiesPageDependenciesForTests({
  api,
  loadBoardShell,
  preserveSiteContextLinks() {},
  showToast() {},
  wirePlanLock() {},
  loginRedirectPath: () => "/login?next=%2Fdashboard%2Factivities",
});

afterAll(() => {
  setActivitiesPageDependenciesForTests(null);
  for (const key of INSTALLED_GLOBALS) globalThis[key] = originalGlobals[key];
});

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
    expect(await ds.loadDynamicSection("giveaways", "tournaments")).toBe(true);
    await flushReactUpdates();
    expect(ds.isDynamicActive()).toBe(true);
    expect($id("tournament-app")).toBeTruthy();
    expect($id("tournament-root").querySelector("#tournament-empty, #tournament-workspace")).toBeTruthy();

    // Away to Activities: tournaments leave runs, activities enter succeeds.
    expect(await ds.loadDynamicSection("activities", "overview")).toBe(true);
    await flushReactUpdates();
    expect($id("tournament-app")).toBeNull();
    expect($id("act-live-loading").hidden).toBe(true);
    expect($id("act-live-error").hidden).toBe(true);
    expect($id("act-live-list").hidden).toBe(false);
    expect($id("act-live-list").children.length).toBe(1);
    expect($id("act-history-empty").hidden).toBe(false);
    expect(document.documentElement.classList.contains("yr-modal-open")).toBe(false);

    // Back to Tournaments: the tab owner mounts a fresh React island.
    expect(await ds.loadDynamicSection("giveaways", "tournaments")).toBe(true);
    await flushReactUpdates();
    expect($id("tournament-root").querySelector("#tournament-empty, #tournament-workspace")).toBeTruthy();
    expect(ds.isDynamicActive()).toBe(true);

    // Explicit leave detaches the section; a later load still initializes.
    ds.leaveDynamicSection();
    expect(ds.isDynamicActive()).toBe(false);
    expect(await ds.loadDynamicSection("giveaways", "tournaments")).toBe(true);
    await flushReactUpdates();
    expect($id("tournament-root").querySelector("#tournament-empty, #tournament-workspace")).toBeTruthy();
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
    retry.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
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
