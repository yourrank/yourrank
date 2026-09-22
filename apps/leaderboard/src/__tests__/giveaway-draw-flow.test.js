// Behavioral coverage for the Chat Giveaway draw flow: the client runs the
// real giveaways.js against the rendered page markup in a DOM, with a virtual
// clock and an in-memory API. The server picks the winner; the client only
// visualizes it. Manual "Confirm Winner" persists via POST /finalize.
//
// Run: bun test src/__tests__/giveaway-draw-flow.test.js

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { giveawaysHtml } from "../pages/giveaway-pages.js";

const window = new Window({ url: "http://localhost/dashboard/giveaways/chat" });
const { document } = window;
for (const key of ["window", "document", "location", "history", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "DOMParser", "getComputedStyle"]) {
  globalThis[key] = key === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[key];
}
window.Element.prototype.scrollIntoView = function () {};
if (!window.Element.prototype.scrollTo) window.Element.prototype.scrollTo = function () {};
window.Element.prototype.getClientRects = function () { return [{}]; };

// ---- Virtual clock: timers, rAF, and performance.now all run on `now`. ----
const realSetTimeout = globalThis.setTimeout;
let now = 0;
let timerSeq = 0;
const timers = [];
function scheduleTimer(cb, ms, interval) {
  const t = { id: ++timerSeq, time: now + ms, cb, interval, cancelled: false };
  timers.push(t);
  return t;
}
function cancelTimer(id) { const t = timers.find((x) => x.id === id || x === id); if (t) t.cancelled = true; }
globalThis.setTimeout = (cb, ms = 0, ...args) => scheduleTimer(() => cb(...args), ms, 0);
globalThis.setInterval = (cb, ms = 0, ...args) => scheduleTimer(() => cb(...args), ms, ms || 1);
globalThis.clearTimeout = (id) => cancelTimer(id);
globalThis.clearInterval = (id) => cancelTimer(id);
globalThis.requestAnimationFrame = (cb) => scheduleTimer(() => cb(now), 16, 0);
globalThis.cancelAnimationFrame = (id) => cancelTimer(id);
Object.defineProperty(globalThis, "performance", { value: { now: () => now }, configurable: true });

async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await new Promise((r) => realSetTimeout(r, 0));
}

const clock = {
  async tick(ms) {
    const target = now + ms;
    let due;
    while ((due = timers.filter((t) => !t.cancelled && t.time <= target).sort((a, b) => a.time - b.time || a.id - b.id)).length) {
      const t = due[0];
      now = Math.max(now, t.time);
      if (t.interval) t.time = now + t.interval;
      else t.cancelled = true;
      await flushMicrotasks();
      t.cb();
      await flushMicrotasks();
    }
    now = target;
    await flushMicrotasks();
  },
};

// matchMedia: controllable prefers-reduced-motion.
let reducedMotion = false;
window.matchMedia = (query) => ({
  matches: reducedMotion && query.includes("prefers-reduced-motion"),
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
});
globalThis.matchMedia = window.matchMedia;

// ---- In-memory server ----
const user = { id: "user-1", email: "creator@example.com", plan: "pro", emailVerified: true };
const site = { id: "site-1", name: "Kick Cup", slug: "kick-cup", published: true, userRole: "owner" };
const connection = { connected: true, chatReady: true, channelName: "creator" };
const ENTRANTS = [
  { id: "e1", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "u1", username: "alpha", avatar_url: null, message: "!win", badges: [], entered_at: "2026-09-28T00:00:00Z" },
  { id: "e2", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "u2", username: "bravo", avatar_url: null, message: "!win", badges: [], entered_at: "2026-09-28T00:00:01Z" },
  { id: "e3", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "u3", username: "charlie", avatar_url: null, message: "!win", badges: [], entered_at: "2026-09-28T00:00:02Z" },
];

const server = { session: null, entries: [], requests: [] };
function resetServer({ session } = {}) {
  server.session = session || { id: "gs-1", site_id: "site-1", provider: "kick", keyword: "!win", status: "stopped", winner_entry_id: null, drawn_at: null, winner_confirmed_at: null, winner_confirmation_message: null, winner_finalized_at: null, winner_finalized_by: null, created_at: "2026-09-28T00:00:00Z" };
  server.entries = ENTRANTS.map((e) => ({ ...e }));
  server.requests.length = 0;
}
const winnerEntry = () => server.entries.find((e) => e.id === server.session?.winner_entry_id) || null;
function statePayload() {
  return { ok: true, connection, session: server.session, entries: server.entries, winner: winnerEntry() };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = async (input, init = {}) => {
  const path = String(input).split("?")[0];
  const body = init.body ? JSON.parse(init.body) : undefined;
  server.requests.push({ path, method: init.method || "GET", body });
  if (path === "/api/auth/me") return json({ ok: true, user });
  if (path === "/api/site/list") return json({ ok: true, sites: [site] });
  if (path === "/api/giveaways/chat") return json(statePayload());
  if (path === "/api/giveaways/chat/draw") {
    // The server draws from the ids the client submitted — always the LAST one,
    // a pick the client could not have predicted from its own ordering.
    const ids = (body?.entryIds || []).map(String);
    const pool = server.entries.filter((e) => ids.includes(e.id));
    const winner = pool[pool.length - 1] || null;
    if (!winner) return json({ ok: false, error: "No eligible entrants to draw from." }, 409);
    Object.assign(server.session, {
      winner_entry_id: winner.id, drawn_at: "2026-09-28T00:01:00Z", status: "completed",
      winner_confirmed_at: null, winner_confirmation_message: null,
      winner_finalized_at: null, winner_finalized_by: null,
    });
    return json({ ok: true, session: server.session, entries: server.entries, winner });
  }
  if (path === "/api/giveaways/chat/finalize") {
    if (!server.session?.winner_entry_id) return json({ ok: false, error: "Draw a winner before confirming." }, 409);
    Object.assign(server.session, { winner_finalized_at: "2026-09-28T00:02:00Z", winner_finalized_by: user.id });
    return json(statePayload());
  }
  return json({ ok: true, raffles: [], predictions: [] });
};
const requestsTo = (path) => server.requests.filter((r) => r.path === path);

// Prevent the auto-init path; the SPA shell drives enter()/leave() instead.
window.__yrSpaShell = true;
document.body.innerHTML = giveawaysHtml;

const { enter, leave } = await import("../assets/giveaways.js");

const $id = (id) => document.getElementById(id);
const confirmButtons = () => [$id("gw-btn-confirm"), $id("gw-modal-confirm")].filter(Boolean);
const rerollButtons = () => [$id("gw-btn-reroll"), $id("gw-modal-reroll")].filter(Boolean);

async function boot() {
  enter();
  await clock.tick(50);
  expect($id("gw-btn-roll").disabled).toBe(false);
}

async function drawWinner() {
  $id("gw-btn-roll").click();
  // Advance until the reveal lands; stop right away so later assertions see
  // the state exactly at reveal time (e.g. the claim countdown's first value).
  for (let i = 0; i < 90 && $id("gw-winner-stage").hidden; i++) await clock.tick(100);
  expect($id("gw-winner-stage").hidden).toBe(false);
}

describe("Giveaway draw flow", () => {
  beforeEach(async () => {
    now = 0;
    timers.length = 0;
    reducedMotion = false;
    resetServer();
    // Fresh markup per test: enter() wires listeners onto the live DOM, and a
    // re-render keeps each test at exactly one listener set.
    document.body.innerHTML = giveawaysHtml;
    document.getElementById("gw-opt-claim-duration").value = "30";
  });

  afterEach(() => {
    leave();
    timers.forEach((t) => { t.cancelled = true; });
    timers.length = 0;
  });

  it("with no response requirement the claim boxes stay hidden and confirm is ready", async () => {
    await boot();
    await drawWinner();
    expect($id("gw-claim-box").hidden).toBe(true);
    expect($id("gw-modal-claim-box").hidden).toBe(true);
    for (const b of confirmButtons()) {
      expect(b.disabled).toBe(false);
      expect(b.classList.contains("btn--accent")).toBe(true);
      expect(b.classList.contains("gw-btn-confirmed")).toBe(false);
    }
    await clock.tick(950);
    expect($id("gw-winner-modal").hidden).toBe(false);
  });

  it("with a required response the confirm action waits on chat", async () => {
    await boot();
    $id("gw-opt-claim-req").checked = true;
    await drawWinner();
    expect($id("gw-claim-box").hidden).toBe(false);
    expect($id("gw-modal-claim-box").hidden).toBe(false);
    expect($id("gw-claim-status").textContent).toBe("Waiting for winner response…");
    expect($id("gw-claim-countdown").textContent).toBe("30s");
    for (const b of confirmButtons()) {
      expect(b.disabled).toBe(true);
      expect(b.title).toBe("Waiting for the winner to respond in chat");
      expect(b.classList.contains("btn--accent")).toBe(false);
    }
    for (const b of rerollButtons()) expect(b.classList.contains("btn--ghost")).toBe(true);
  });

  it("a chat reply before the deadline unlocks confirmation", async () => {
    await boot();
    $id("gw-opt-claim-req").checked = true;
    await drawWinner();
    server.session.winner_confirmed_at = "2026-09-28T00:01:30Z";
    server.session.winner_confirmation_message = "I am here";
    await clock.tick(4000); // next poll carries the confirmed state
    expect($id("gw-claim-status").textContent).toContain("Responded:");
    expect($id("gw-claim-countdown").textContent).toBe("Verified");
    expect($id("gw-modal-verify-chip").hidden).toBe(false);
    for (const b of confirmButtons()) {
      expect(b.disabled).toBe(false);
      expect(b.classList.contains("btn--accent")).toBe(true);
    }
  });

  it("an expired response window promotes re-roll and keeps confirm locked", async () => {
    await boot();
    $id("gw-opt-claim-req").checked = true;
    await drawWinner();
    await clock.tick(31000);
    expect($id("gw-claim-status").textContent).toBe("Winner did not respond within 30 seconds");
    for (const b of rerollButtons()) expect(b.classList.contains("btn--accent")).toBe(true);
    for (const b of confirmButtons()) {
      expect(b.disabled).toBe(true);
      expect(b.classList.contains("btn--accent")).toBe(false);
      expect(b.title).toBe("The winner did not respond — re-roll to pick another winner");
    }
  });

  it("manual confirmation persists through /finalize and survives a reload", async () => {
    await boot();
    await drawWinner();
    await clock.tick(950);
    expect($id("gw-winner-modal").hidden).toBe(false);
    $id("gw-modal-confirm").click();
    await clock.tick(0);
    const finalize = requestsTo("/api/giveaways/chat/finalize");
    expect(finalize).toHaveLength(1);
    expect(finalize[0].body.sessionId).toBe("gs-1");
    for (const b of confirmButtons()) {
      expect(b.disabled).toBe(true);
      expect(b.classList.contains("gw-btn-confirmed")).toBe(true);
    }
    expect($id("gw-winner-modal").hidden).toBe(true);
    expect($id("gw-winner-stage").classList.contains("gw-winner-stage--confirmed")).toBe(true);

    // Reload: the finalized rendering is server truth, not local memory.
    leave();
    enter();
    await clock.tick(50);
    expect($id("gw-winner-stage").classList.contains("gw-winner-stage--confirmed")).toBe(true);
    for (const b of confirmButtons()) expect(b.classList.contains("gw-btn-confirmed")).toBe(true);
    await clock.tick(1500);
    expect($id("gw-winner-modal").hidden).toBe(true);
    expect($id("gw-claim-box").hidden).toBe(true);
    expect($id("gw-modal-claim-box").hidden).toBe(true);
  });

  it("confirm never bypasses a pending required response", async () => {
    await boot();
    $id("gw-opt-claim-req").checked = true;
    await drawWinner();
    $id("gw-modal-confirm").click();
    await clock.tick(0);
    expect(requestsTo("/api/giveaways/chat/finalize")).toHaveLength(0);
  });

  it("re-roll re-draws without the current winner", async () => {
    await boot();
    await drawWinner();
    const firstDraw = requestsTo("/api/giveaways/chat/draw").at(-1);
    expect(firstDraw.body.entryIds).toEqual(["e1", "e2", "e3"]);
    expect(server.session.winner_entry_id).toBe("e3");
    $id("gw-btn-reroll").click();
    await clock.tick(6000);
    const draws = requestsTo("/api/giveaways/chat/draw");
    expect(draws).toHaveLength(2);
    expect(draws[1].body.entryIds).not.toContain("e3");
    expect(draws[1].body.entryIds.length).toBeGreaterThan(0);
  });

  it("the roulette lands on the server's pick, not a client guess", async () => {
    await boot();
    await drawWinner();
    // Server always drew the last submitted id.
    expect($id("gw-winner-name").textContent).toBe("charlie");
    const items = [...$id("gw-roller-track").querySelectorAll(".gw-roulette-item")];
    expect(items.at(-1).textContent).toBe("@charlie");
    expect(items.at(-2).textContent).not.toBe("@charlie");
  });

  it("reduced motion reveals the winner quickly with no motion blur", async () => {
    reducedMotion = true;
    await boot();
    $id("gw-btn-roll").click();
    await clock.tick(1500);
    expect($id("gw-winner-stage").hidden).toBe(false);
    expect($id("gw-roller-track").classList.contains("gw-roulette-track--blur")).toBe(false);
  });

  it("the verification modal opens only after the reveal lands", async () => {
    await boot();
    await drawWinner();
    expect($id("gw-winner-stage").hidden).toBe(false);
    expect($id("gw-winner-modal").hidden).toBe(true);
    await clock.tick(950);
    expect($id("gw-winner-modal").hidden).toBe(false);
  });
});
