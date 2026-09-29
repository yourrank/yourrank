// Behavioral coverage for the Chat Giveaway draw flow: the client runs the
// real giveaways.js against the rendered page markup in a DOM, with a virtual
// clock and an in-memory API. The server picks the winner; the client only
// visualizes it. Manual "Confirm Winner" persists via POST /finalize.
//
// Run: bun test src/__tests__/giveaway-draw-flow.test.js

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { giveawaysHtml, renderGiveawaysHtml } from "../pages/giveaway-pages.js";

const window = new Window({ url: "http://localhost/dashboard/giveaways/chat" });
const { document } = window;
// This file runs inside a shared bun process with every other leaderboard
// test: every global it installs must be restored in afterAll or later files
// inherit a dead virtual clock and hang.
const INSTALLED_GLOBALS = ["window", "document", "location", "history", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "DOMParser", "getComputedStyle", "matchMedia", "localStorage", "fetch", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance"];
const originalGlobals = Object.fromEntries(INSTALLED_GLOBALS.map((k) => [k, globalThis[k]]));
const originalDateNow = Date.now;
for (const key of INSTALLED_GLOBALS.slice(0, 14)) {
  globalThis[key] = key === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[key];
}
window.Element.prototype.scrollIntoView = function () {};
if (!window.Element.prototype.scrollTo) window.Element.prototype.scrollTo = function () {};
window.Element.prototype.getClientRects = function () { return [{}]; };
globalThis.localStorage = window.localStorage;

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
// Server timestamps (drawn_at) are generated inside the fake API and compared
// against Date.now() by the client, so both must share the virtual clock.
Date.now = () => now;

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
  { id: "e1", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "u1", username: "alpha", avatar_url: null, message: "!win", badges: [], entered_at: "2026-09-28T00:00:00Z", eligibility_status: "eligible" },
  { id: "e2", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "u2", username: "bravo", avatar_url: null, message: "!win", badges: [], entered_at: "2026-09-28T00:00:01Z", eligibility_status: "eligible" },
  { id: "e3", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "u3", username: "charlie", avatar_url: null, message: "!win", badges: [], entered_at: "2026-09-28T00:00:02Z", eligibility_status: "eligible" },
];

const server = { session: null, entries: [], draws: [], requests: [], predictions: null, predictionCreateResponse: null, connection };
function resetServer({ session, entries } = {}) {
  server.connection = connection;
  server.session = session || { id: "gs-1", site_id: "site-1", provider: "kick", keyword: "!win", status: "stopped", rules: {}, winner_entry_id: null, drawn_at: null, winner_confirmed_at: null, winner_confirmation_message: null, winner_finalized_at: null, winner_finalized_by: null, winner_response_required: null, winner_response_timeout_seconds: null, winner_response_deadline: null, created_at: "2026-09-28T00:00:00Z" };
  server.entries = (entries || ENTRANTS).map((e) => ({ ...e }));
  server.draws.length = 0;
  server.requests.length = 0;
  server.predictions = { ok: true, predictions: [], entitlement: { enabled: true } };
  server.predictionCreateResponse = null;
}
const winnerEntry = () => server.entries.find((e) => e.id === server.session?.winner_entry_id) || null;
function statePayload() {
  return { ok: true, connection: server.connection, session: server.session, entries: server.entries, winner: winnerEntry() };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = async (input, init = {}) => {
  const path = String(input).split("?")[0];
  const body = init.body ? JSON.parse(init.body) : undefined;
  server.requests.push({ path, method: init.method || "GET", body });
  if (path === "/api/auth/me") return json({ ok: true, user });
  if (path === "/api/site/list") return json({ ok: true, sites: [site] });
  if (path === "/api/giveaways/chat") return json(statePayload());
  if (path === "/api/giveaways/chat/start") {
    server.session ||= { id: "gs-1", site_id: "site-1", winner_entry_id: null };
    Object.assign(server.session, {
      status: "active",
      provider: body?.mode === "manual" ? "manual" : "kick",
      keyword: body?.mode === "manual" ? "manual" : body?.keyword || "!win",
      rules: body?.rules || {},
    });
    return json(statePayload());
  }
  if (path === "/api/giveaways/chat/entries/add") {
    const username = String(body?.username || "").trim();
    server.entries.push({
      id: `manual-${server.entries.length + 1}`,
      giveaway_session_id: server.session?.id,
      provider: "manual",
      provider_user_id: `manual:${username.toLowerCase()}`,
      username,
      avatar_url: null,
      message: "",
      badges: [],
      entered_at: new Date(now).toISOString(),
      eligibility_status: "eligible",
    });
    return json(statePayload());
  }
  if (path === "/api/giveaways/chat/draw") {
    // CAS: the draw only lands on the identity the client claimed to see
    // (null/null = "no draw yet").
    const expectedId = body?.expectedWinnerEntryId ?? null;
    const expectedDrawn = body?.expectedDrawnAt ?? null;
    const mismatch = expectedId === null
      ? server.session.winner_entry_id !== null
      : server.session.winner_entry_id !== expectedId
        || Date.parse(server.session.drawn_at) !== Date.parse(expectedDrawn);
    if (mismatch) {
      const error = server.session.winner_finalized_at
        ? "This winner is already confirmed and cannot be re-rolled."
        : "The giveaway draw changed. Refresh the current draw before drawing again.";
      return json({ ok: false, error, session: server.session, entries: server.entries, winner: winnerEntry() }, 409);
    }
    if (expectedId !== null && server.session.winner_finalized_at) {
      return json({ ok: false, error: "This winner is already confirmed and cannot be re-rolled.", session: server.session, entries: server.entries, winner: winnerEntry() }, 409);
    }
    // The server picks from eligible entries; the persisted winnerRepeat rule
    // decides whether earlier draws of this giveaway leave the pool. The LAST
    // of the pool is picked, a pick the client could not have predicted. The
    // response rule comes only from the rules persisted at /start.
    const once = (server.session.rules || {}).winnerRepeat !== "again";
    const eligible = server.entries.filter((e) => e.eligibility_status === "eligible");
    const pool = once ? eligible.filter((e) => !server.draws.includes(e.id)) : eligible;
    const winner = pool[pool.length - 1] || null;
    if (!winner) return json({ ok: false, error: eligible.length ? "No other eligible entrants remain." : "No eligible entrants to draw from." }, 409);
    server.draws.push(winner.id);
    const rules = server.session.rules || {};
    const required = rules.winnerMustRespond === true;
    const timeout = required ? (rules.responseTimeout || 60) : null;
    Object.assign(server.session, {
      winner_entry_id: winner.id, drawn_at: new Date(now).toISOString(), status: "completed",
      winner_confirmed_at: null, winner_confirmation_message: null,
      winner_finalized_at: null, winner_finalized_by: null,
      winner_response_required: required,
      winner_response_timeout_seconds: timeout,
      winner_response_deadline: required ? new Date(now + timeout * 1000).toISOString() : null,
    });
    return json({ ok: true, session: server.session, entries: server.entries, winner });
  }
  if (path === "/api/giveaways/chat/finalize") {
    if (!body?.sessionId) return json({ ok: false, error: "Missing sessionId" }, 400);
    if (!body?.winnerEntryId) return json({ ok: false, error: "Missing winnerEntryId" }, 400);
    if (body?.drawnAt == null) return json({ ok: false, error: "Missing drawnAt" }, 400);
    // CAS: only the draw the client saw may be finalized.
    if (server.session?.winner_entry_id !== body.winnerEntryId
        || Date.parse(server.session?.drawn_at) !== Date.parse(body.drawnAt)) {
      return json({ ok: false, error: "The giveaway winner changed. Refresh the current draw before confirming.", session: server.session }, 409);
    }
    if (server.session.winner_finalized_at) return json(statePayload());
    if (server.session.winner_response_required && !server.session.winner_confirmed_at) {
      return json({ ok: false, error: "The winner must respond in chat before you can confirm.", session: server.session }, 409);
    }
    Object.assign(server.session, { winner_finalized_at: "2026-09-28T00:02:00Z", winner_finalized_by: user.id });
    return json(statePayload());
  }
  if (path === "/api/predictions") {
    if ((init.method || "GET").toUpperCase() === "POST" && server.predictionCreateResponse) {
      return json(server.predictionCreateResponse.body, server.predictionCreateResponse.status);
    }
    return json(server.predictions);
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

async function tickUntilReveal() {
  // Advance until the reveal lands; stop right away so later assertions see
  // the state exactly at reveal time (e.g. the claim countdown's first value).
  for (let i = 0; i < 90 && $id("gw-winner-stage").hidden; i++) await clock.tick(100);
  expect($id("gw-winner-stage").hidden).toBe(false);
}

async function drawWinner() {
  $id("gw-btn-roll").click();
  await tickUntilReveal();
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
    window.localStorage.clear();
  });

  afterEach(() => {
    leave();
    timers.forEach((t) => { t.cancelled = true; });
    timers.length = 0;
  });

  afterAll(() => {
    // Hand every installed global back so the next test file sees real timers,
    // the real fetch, and the real Date.now.
    for (const key of INSTALLED_GLOBALS) {
      if (key === "performance") {
        Object.defineProperty(globalThis, "performance", { value: originalGlobals.performance, configurable: true });
      } else if (originalGlobals[key] === undefined) {
        delete globalThis[key];
      } else {
        globalThis[key] = originalGlobals[key];
      }
    }
    Date.now = originalDateNow;
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

  it("starts a manual giveaway and adds dashboard-entered viewers without Kick links", async () => {
    server.session = null;
    server.entries = [];
    server.connection = { connected: false, chatReady: false, channelName: null };
    enter();
    await clock.tick(50);

    expect($id("gw-manual-start-hint").hidden).toBe(false);
    expect($id("gw-keyword-field").hidden).toBe(true);
    expect($id("gw-btn-listen").disabled).toBe(false);
    expect($id("gw-listen-btn-label").textContent).toBe("Start manual giveaway");
    expect($id("gw-entry-modes").hidden).toBe(true);
    expect($id("gw-kick-eligibility-section").hidden).toBe(true);
    expect($id("gw-winner-verification-section").hidden).toBe(true);
    expect($id("gw-anti-abuse-section").hidden).toBe(true);
    expect($id("gw-rules-panel").open).toBe(true);
    expect($id("gw-advanced-options").open).toBe(false);

    $id("gw-advanced-options").open = true;
    $id("gw-opt-skip-past").checked = true;
    $id("gw-opt-skip-past").dispatchEvent(new window.Event("change", { bubbles: true }));
    document.querySelector('input[name="gw-winner-repeat"][value="again"]').click();
    expect($id("gw-rules-summary").textContent).toBe("Anyone in chat · Can win again · Exclude past winners · No chat response");

    $id("gw-btn-listen").click();
    await flushMicrotasks();
    const startRequest = requestsTo("/api/giveaways/chat/start")[0];
    expect(startRequest.body.mode).toBe("manual");
    expect(startRequest.body.keyword).toBeUndefined();
    expect(startRequest.body.rules).toMatchObject({
      entryMode: "chat",
      subscriberOnly: false,
      vipOnly: false,
      onePerIp: false,
      winnerMustRespond: false,
      responseTimeout: 60,
      autoReroll: false,
      winnerRepeat: "again",
      excludePreviousWinners: true,
    });
    expect(server.session.provider).toBe("manual");
    expect(server.session.keyword).toBe("manual");
    expect($id("gw-status-text").textContent).toBe("LIVE");
    expect($id("gw-stat-keyword").textContent).toBe("Manual");
    expect($id("gw-add-entrant-form").hidden).toBe(false);
    expect($id("gw-layout").classList.contains("is-live")).toBe(true);

    const input = $id("gw-add-entrant-name");
    input.value = "Alex Rivera";
    $id("gw-add-entrant-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();
    const addRequest = requestsTo("/api/giveaways/chat/entries/add")[0];
    expect(addRequest.body).toMatchObject({ sessionId: "gs-1", username: "Alex Rivera", siteId: "site-1" });
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);

    const row = $id("entrant-manual-1");
    expect(row.querySelector("a")).toBeNull();
    expect(row.querySelector(".gw-entrant-name").tagName).toBe("SPAN");
    expect(row.querySelector(".gw-entrant-avatar").src.startsWith("data:image/svg+xml")).toBe(true);
    expect(row.querySelector(".gw-trust-badge").textContent).toBe("Added manually");
    expect(row.querySelector(".gw-entrant-msg").textContent).toBe("—");
  });

  it("locks prediction entry points for a free owner while preserving the page", async () => {
    server.predictions = { ok: true, predictions: [], entitlement: { enabled: false } };
    document.body.innerHTML = renderGiveawaysHtml("preds");
    enter();
    await clock.tick(50);

    expect($id("btn-create-pred").disabled).toBe(true);
    expect($id("btn-open-event-drawer").disabled).toBe(true);
    expect($id("btn-create-pred").getAttribute("aria-describedby")).toBe("pred-plan-lock");
    expect($id("btn-open-event-drawer").getAttribute("aria-describedby")).toBe("pred-plan-lock");
    expect($id("pred-plan-lock").hidden).toBe(false);
    expect($id("pred-plan-lock").querySelector('[data-plan-lock="predictions"]')).toBeTruthy();
    expect($id("pred-drawer").hidden).toBe(true);
    $id("btn-create-pred").disabled = false;
    await new Promise((resolve) => {
      $id("btn-create-pred").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
      resolve();
    });
    expect($id("pred-drawer").hidden).toBe(true);
  });

  it("adds a safe upgrade link to a stale prediction entitlement error", async () => {
    server.predictionCreateResponse = {
      status: 403,
      body: { ok: false, code: "entitlement_required", error: "Predictions is available on Starter and higher plans." },
    };
    document.body.innerHTML = renderGiveawaysHtml("preds");
    enter();
    await clock.tick(50);
    $id("btn-create-pred").click();
    $id("pred-title").value = "Who wins?";
    $id("pred-opt-1").value = "Yes";
    $id("pred-opt-2").value = "No";
    $id("pred-min-bet").value = "1";
    $id("pred-max-bet").value = "10";
    $id("pred-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    const status = $id("pred-status");
    expect(status.classList.contains("error")).toBe(true);
    expect(status.textContent).toContain("Predictions is available on Starter and higher plans.");
    expect(status.querySelector("a").textContent).toBe("Upgrade your plan");
    expect(status.querySelector("a").getAttribute("href")).toBe("/dashboard/settings/billing?from=predictions");
  });

  it("with a required response the confirm action waits on chat", async () => {
    // Rules are locked at /start; the draw reads them from the session row.
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    await boot();
    await drawWinner();
    expect($id("gw-claim-box").hidden).toBe(false);
    expect($id("gw-modal-claim-box").hidden).toBe(false);
    expect($id("gw-claim-status").textContent).toBe("Waiting for winner response…");
    // The roulette consumed part of the 30s window: the countdown derives
    // from drawn_at, not the checkbox duration.
    const shown = parseInt($id("gw-claim-countdown").textContent, 10);
    expect(shown).toBeLessThanOrEqual(27);
    expect(shown).toBeGreaterThanOrEqual(24);
    for (const b of confirmButtons()) {
      expect(b.disabled).toBe(true);
      expect(b.title).toBe("Waiting for the winner to respond in chat");
      expect(b.classList.contains("btn--accent")).toBe(false);
    }
    for (const b of rerollButtons()) expect(b.classList.contains("btn--ghost")).toBe(true);
  });

  it("a chat reply before the deadline unlocks confirmation", async () => {
    // Rules are locked at /start; the draw reads them from the session row.
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    await boot();
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
    // Rules are locked at /start; the draw reads them from the session row.
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    await boot();
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
    expect(finalize[0].body.winnerEntryId).toBe("e3");
    expect(finalize[0].body.drawnAt).toBe(server.session.drawn_at);
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
    // Rules are locked at /start; the draw reads them from the session row.
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    await boot();
    await drawWinner();
    $id("gw-modal-confirm").click();
    await clock.tick(0);
    expect(requestsTo("/api/giveaways/chat/finalize")).toHaveLength(0);
  });

  it("re-roll re-draws without the current winner", async () => {
    await boot();
    await drawWinner();
    expect(server.session.winner_entry_id).toBe("e3");
    $id("gw-btn-reroll").click();
    await tickUntilReveal();
    const draws = requestsTo("/api/giveaways/chat/draw");
    expect(draws).toHaveLength(2);
    // The server excludes entries already drawn this session: e3 cannot repeat.
    expect(server.session.winner_entry_id).not.toBe("e3");
    expect(server.draws).toContain("e3");
    expect(server.draws).toContain(server.session.winner_entry_id);
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

  it("a reload during a required response window resumes the claim, not the confirm", async () => {
    // Rules are locked at /start; the draw reads them from the session row.
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    await boot();
    await drawWinner();
    leave();
    enter();
    await clock.tick(50);
    expect($id("gw-claim-box").hidden).toBe(false);
    expect($id("gw-modal-claim-box").hidden).toBe(false);
    expect($id("gw-claim-status").textContent).toBe("Waiting for winner response…");
    for (const b of confirmButtons()) {
      expect(b.disabled).toBe(true);
      expect(b.title).toContain("Waiting for the winner");
    }
    expect($id("gw-winner-modal").hidden).toBe(true);
  });

  it("the countdown on reload is derived from drawn_at, not the full window", async () => {
    // Rules are locked at /start; the draw reads them from the session row.
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    await boot();
    await drawWinner();
    // Reach exactly 10s after the server's drawn_at before reloading.
    const drawnAt = Date.parse(server.session.drawn_at);
    await clock.tick(Math.max(0, drawnAt + 10_000 - now));
    leave();
    enter();
    await clock.tick(50);
    expect($id("gw-claim-countdown").textContent).toBe("20s");
    await clock.tick(5000);
    expect($id("gw-claim-countdown").textContent).toBe("15s");
  });

  it("a reload after the response window closed renders the expired state immediately", async () => {
    // Rules are locked at /start; the draw reads them from the session row.
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    await boot();
    await drawWinner();
    leave();
    await clock.tick(31_000);
    enter();
    await clock.tick(50);
    expect($id("gw-claim-box").hidden).toBe(false);
    expect($id("gw-claim-status").textContent).toBe("Winner did not respond within 30 seconds");
    for (const b of rerollButtons()) expect(b.classList.contains("btn--accent")).toBe(true);
    for (const b of confirmButtons()) {
      expect(b.disabled).toBe(true);
      expect(b.classList.contains("btn--accent")).toBe(false);
    }
    // No countdown was restarted.
    await clock.tick(2000);
    expect($id("gw-claim-status").textContent).toBe("Winner did not respond within 30 seconds");
  });

  it("a reload after the winner responded in chat renders the verified state", async () => {
    // Rules are locked at /start; the draw reads them from the session row.
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    await boot();
    await drawWinner();
    server.session.winner_confirmed_at = new Date(now).toISOString();
    server.session.winner_confirmation_message = "here!";
    leave();
    enter();
    await clock.tick(50);
    expect($id("gw-claim-status").textContent).toContain("Responded:");
    expect($id("gw-claim-countdown").textContent).toBe("Verified");
    expect($id("gw-modal-verify-chip").hidden).toBe(false);
    for (const b of confirmButtons()) {
      expect(b.disabled).toBe(false);
      expect(b.classList.contains("btn--accent")).toBe(true);
    }
  });

  it("a reload with no response requirement keeps claim boxes hidden and confirm ready", async () => {
    await boot();
    await drawWinner();
    leave();
    enter();
    await clock.tick(50);
    expect($id("gw-claim-box").hidden).toBe(true);
    expect($id("gw-modal-claim-box").hidden).toBe(true);
    for (const b of confirmButtons()) expect(b.disabled).toBe(false);
  });

  it("a reload mid-window keeps counting down from the same deadline", async () => {
    // Rules are locked at /start; the draw reads them from the session row.
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    await boot();
    await drawWinner();
    const atReveal = parseInt($id("gw-claim-countdown").textContent, 10);
    await clock.tick(5000);
    leave();
    enter();
    await clock.tick(50);
    // ~5s later than the reveal value, from the same drawn_at deadline.
    const afterReload = parseInt($id("gw-claim-countdown").textContent, 10);
    expect(Math.abs(afterReload - (atReveal - 5))).toBeLessThanOrEqual(1);
    expect($id("gw-claim-status").textContent).toBe("Waiting for winner response…");
  });

  it("a re-roll keeps the rules persisted at start, not the current controls", async () => {
    server.session.rules = { winnerMustRespond: true, responseTimeout: 90 };
    await boot();
    await drawWinner();
    // Changing the controls after the draw cannot change this session's rules:
    // the draw request carries none of them and the server keeps the persisted
    // 90s required-response window.
    $id("gw-opt-claim-req").checked = false;
    $id("gw-opt-claim-duration").value = "30";
    $id("gw-btn-reroll").click();
    await tickUntilReveal();
    const draws = requestsTo("/api/giveaways/chat/draw");
    expect(draws).toHaveLength(2);
    expect(draws[1].body).not.toHaveProperty("responseRequired");
    expect(draws[1].body).not.toHaveProperty("responseTimeoutSeconds");
    expect(draws[1].body).not.toHaveProperty("entryIds");
    expect(server.session.winner_response_required).toBe(true);
    expect(server.session.winner_response_timeout_seconds).toBe(90);
    // The persisted rules drive the UI; the roulette consumed a few seconds.
    expect($id("gw-claim-box").hidden).toBe(false);
    const shown = parseInt($id("gw-claim-countdown").textContent, 10);
    expect(shown).toBeLessThanOrEqual(88);
    expect(shown).toBeGreaterThanOrEqual(83);
  });

  it("a re-roll carries the current draw's compare-and-swap identity", async () => {
    await boot();
    await drawWinner();
    const firstDraw = requestsTo("/api/giveaways/chat/draw").at(-1);
    expect(firstDraw.body.expectedWinnerEntryId).toBeNull();
    expect(firstDraw.body.expectedDrawnAt).toBeNull();
    $id("gw-btn-reroll").click();
    await tickUntilReveal();
    const second = requestsTo("/api/giveaways/chat/draw").at(-1);
    expect(second.body.expectedWinnerEntryId).toBe("e3");
    expect(second.body.expectedDrawnAt).toBeTruthy();
  });

  it("confirming a draw that changed underneath resyncs instead of finalizing", async () => {
    await boot();
    await drawWinner();
    expect($id("gw-winner-name").textContent).toBe("charlie");
    // Another device re-drew while we were looking at charlie.
    Object.assign(server.session, {
      winner_entry_id: "e2", drawn_at: new Date(now).toISOString(),
      winner_confirmed_at: null, winner_finalized_at: null,
    });
    $id("gw-modal-confirm").click();
    await clock.tick(0);
    const finalize = requestsTo("/api/giveaways/chat/finalize");
    expect(finalize).toHaveLength(1);
    expect(finalize[0].body.winnerEntryId).toBe("e3");
    expect(server.session.winner_finalized_at).toBeNull();
    // The client resynced to the server's draw: bravo is shown, not charlie.
    expect($id("gw-winner-name").textContent).toBe("bravo");
    expect($id("gw-page-alert").textContent).toContain("winner changed");
  });

  it("a stale re-roll surfaces the conflict without revealing a winner", async () => {
    await boot();
    await drawWinner();
    // Another device re-drew to a different winner.
    Object.assign(server.session, {
      winner_entry_id: "e1", drawn_at: new Date(now + 1000).toISOString(),
      winner_confirmed_at: null, winner_finalized_at: null,
    });
    $id("gw-btn-reroll").click();
    await clock.tick(3000);
    const draws = requestsTo("/api/giveaways/chat/draw");
    expect(draws).toHaveLength(2);
    expect(draws[1].body.expectedWinnerEntryId).toBe("e3");
    // The 409 resynced to winner e1; no new reveal happened.
    expect($id("gw-winner-name").textContent).toBe("alpha");
    expect(server.session.winner_entry_id).toBe("e1");
    expect($id("gw-page-alert").textContent).toContain("draw changed");
  });

  it("SPA re-entry restores the persisted Entry Mode", async () => {
    server.session.rules = { entryMode: "verified" };
    server.session.status = "active";
    await boot();
    expect(document.querySelector('input[name="gw-entry-mode"]:checked').value).toBe("verified");
    leave();
    document.body.innerHTML = giveawaysHtml;
    enter();
    await clock.tick(50);
    expect(document.querySelector('input[name="gw-entry-mode"]:checked').value).toBe("verified");
  });

  it("Advanced options are collapsed by default", async () => {
    await boot();
    const details = $id("gw-advanced-options");
    expect(details.open).toBe(false);
    expect($id("gw-opt-subscriber").closest("#gw-advanced-options")).toBe(details);
    expect($id("gw-opt-ip").closest("#gw-advanced-options")).toBe(details);
  });

  it("opening and closing Advanced options is a local preference, not a rule", async () => {
    await boot();
    const details = $id("gw-advanced-options");
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    expect(localStorage.getItem("yr:gw-advanced-open")).toBe("1");
    details.open = false;
    details.dispatchEvent(new Event("toggle"));
    expect(localStorage.getItem("yr:gw-advanced-open")).toBe("0");
    $id("gw-btn-listen").click();
    await clock.tick(50);
    const start = requestsTo("/api/giveaways/chat/start").at(-1);
    expect(Object.keys(start.body.rules).sort()).toEqual(
      ["entryMode", "subscriberOnly", "vipOnly", "excludePreviousWinners", "winnerRepeat", "onePerIp", "winnerMustRespond", "responseTimeout", "autoReroll"].sort(),
    );
  });

  it("advanced settings keep their values while collapsed", async () => {
    await boot();
    $id("gw-advanced-options").open = true;
    $id("gw-opt-subscriber").checked = true;
    $id("gw-advanced-options").open = false;
    $id("gw-btn-listen").click();
    await clock.tick(50);
    expect(requestsTo("/api/giveaways/chat/start").at(-1).body.rules.subscriberOnly).toBe(true);
  });

  it("the default winner rule is Win once per giveaway", async () => {
    await boot();
    expect($id("gw-winner-repeat-once").checked).toBe(true);
    $id("gw-btn-listen").click();
    await clock.tick(50);
    expect(requestsTo("/api/giveaways/chat/start").at(-1).body.rules.winnerRepeat).toBe("once");
  });

  it("Win once excludes the current winner from a later re-roll", async () => {
    await boot();
    await drawWinner();
    const firstId = server.session.winner_entry_id;
    $id("gw-btn-reroll").click();
    await tickUntilReveal();
    expect(server.session.winner_entry_id).not.toBe(firstId);
    expect(server.draws).toContain(firstId);
    expect(server.draws).toContain(server.session.winner_entry_id);
  });

  it("Can win again lets a re-roll land on the same participant", async () => {
    resetServer({ entries: [ENTRANTS[0]] });
    await boot();
    $id("gw-winner-repeat-again").click();
    $id("gw-btn-listen").click();
    await clock.tick(50);
    expect(server.session.rules.winnerRepeat).toBe("again");
    await drawWinner();
    const firstId = server.session.winner_entry_id;
    $id("gw-btn-reroll").click();
    await tickUntilReveal();
    expect(server.session.winner_entry_id).toBe(firstId);
    expect($id("gw-page-alert").textContent).toBe("");
    expect($id("gw-winner-stage").hidden).toBe(false);
  });

  it("with no other eligible entrant a Win-once re-roll shows a clear error", async () => {
    resetServer({ entries: [ENTRANTS[0]] });
    await boot();
    await drawWinner();
    $id("gw-btn-reroll").click();
    await clock.tick(3000);
    expect($id("gw-page-alert").textContent).toContain("No other eligible entrants remain.");
    // The reveal that already happened is untouched by the failed re-roll.
    expect(server.session.winner_entry_id).toBe("e1");
    expect($id("gw-winner-name").textContent).toBe("alpha");
  });

  it("a reload preserves the persisted winner repeat rule", async () => {
    server.session.rules = { winnerRepeat: "again" };
    await boot();
    expect($id("gw-winner-repeat-again").checked).toBe(true);
    leave();
    document.body.innerHTML = giveawaysHtml;
    enter();
    await clock.tick(50);
    expect($id("gw-winner-repeat-again").checked).toBe(true);
  });

  it("a stale tab's re-roll follows the server-persisted rule", async () => {
    resetServer({ entries: [ENTRANTS[0]] });
    await boot();
    await drawWinner();
    // The fieldset is locked while the giveaway runs; even a forged control
    // change cannot alter the rule persisted at start.
    $id("gw-winner-repeat-again").checked = true;
    $id("gw-btn-reroll").click();
    await clock.tick(3000);
    expect(server.session.rules.winnerRepeat ?? "once").toBe("once");
    expect($id("gw-page-alert").textContent).toContain("No other eligible entrants remain.");
  });

  it("historical past-winner exclusion stays separate from winner repeat", async () => {
    await boot();
    $id("gw-opt-skip-past").checked = true;
    $id("gw-btn-listen").click();
    await clock.tick(50);
    const rules = requestsTo("/api/giveaways/chat/start").at(-1).body.rules;
    expect(rules.excludePreviousWinners).toBe(true);
    expect(rules.winnerRepeat).toBe("once");
    expect($id("gw-opt-skip-past").closest("label").textContent).toContain("Exclude past giveaway winners");
  });

  it("response timeout appears only when the winner must respond", async () => {
    await boot();
    expect($id("gw-claim-duration-wrap").hidden).toBe(true);
    $id("gw-opt-claim-req").click();
    expect($id("gw-claim-duration-wrap").hidden).toBe(false);
    expect($id("gw-opt-claim-duration").disabled).toBe(false);
    $id("gw-opt-claim-req").click();
    expect($id("gw-claim-duration-wrap").hidden).toBe(true);
  });

  it("the winner instruction lives inside Advanced options", async () => {
    await boot();
    expect($id("gw-custom-rule-text").closest("#gw-advanced-options")).toBeTruthy();
    const fieldset = $id("gw-settings");
    for (const section of fieldset.querySelectorAll(":scope > .gw-settings-section")) {
      expect(section.querySelector("#gw-custom-rule-text")).toBeNull();
    }
  });

  it("auto re-roll follows the response verification toggle", async () => {
    await boot();
    expect($id("gw-auto-reroll-wrap").hidden).toBe(true);
    $id("gw-opt-claim-req").click();
    expect($id("gw-auto-reroll-wrap").hidden).toBe(false);
    expect($id("gw-opt-auto-reroll").disabled).toBe(false);
    $id("gw-opt-claim-req").click();
    expect($id("gw-auto-reroll-wrap").hidden).toBe(true);
    expect($id("gw-opt-auto-reroll").checked).toBe(false);
  });
});
