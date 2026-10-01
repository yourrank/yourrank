// Behavioral coverage for the Chat Giveaway React page with a virtual clock
// and an injected in-memory API. The server picks the winner; the client only
// visualizes it. Manual "Confirm Winner" persists via POST /finalize.
//
// Run: bun test src/__tests__/giveaway-draw-flow.test.js

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { renderGiveawaysHtml } from "../pages/giveaway-pages.js";
import {
  actGiveaways,
  clickGiveaways,
  document,
  mountGiveawaysPage,
  restoreGiveawaysDomGlobals,
  setGiveawaysInputValue,
  unmountGiveawaysPage,
  window,
} from "./giveaways-react-utils.js";

const originalDateNow = Date.now;
const originalRuntime = {
  clearInterval: globalThis.clearInterval,
  clearTimeout: globalThis.clearTimeout,
  matchMedia: globalThis.matchMedia,
  performance: globalThis.performance,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  setInterval: globalThis.setInterval,
  setTimeout: globalThis.setTimeout,
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
};
const originalWindowRuntime = {
  clearInterval: window.clearInterval,
  clearTimeout: window.clearTimeout,
  matchMedia: window.matchMedia,
  requestAnimationFrame: window.requestAnimationFrame,
  setInterval: window.setInterval,
  setTimeout: window.setTimeout,
  cancelAnimationFrame: window.cancelAnimationFrame,
};

// ---- Virtual clock: timers, rAF, and performance.now all run on `now`. ----
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
Object.defineProperty(globalThis, "performance", {
  value: { now: () => now, measure() {}, getEntriesByType: () => [] },
  configurable: true,
});
window.setTimeout = globalThis.setTimeout;
window.setInterval = globalThis.setInterval;
window.clearTimeout = globalThis.clearTimeout;
window.clearInterval = globalThis.clearInterval;
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
// Server timestamps (drawn_at) are generated inside the fake API and compared
// against Date.now() by the client, so both must share the virtual clock.
Date.now = () => now;

async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

const clock = {
  async tick(ms) {
    await actGiveaways(async () => {
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
    });
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

const server = { session: null, entries: [], draws: [], drawRows: [], requests: [], responseRulesResponse: null, connection };
function resetServer({ session, entries } = {}) {
  server.connection = connection;
  server.session = session || { id: "gs-1", site_id: "site-1", provider: "kick", keyword: "!win", status: "stopped", started_at: new Date(now).toISOString(), rules: {}, winner_entry_id: null, drawn_at: null, winner_confirmed_at: null, winner_confirmation_message: null, winner_finalized_at: null, winner_finalized_by: null, winner_response_required: null, winner_response_timeout_seconds: null, winner_response_deadline: null, created_at: "2026-09-28T00:00:00Z" };
  server.entries = (entries || ENTRANTS).map((e) => ({ ...e }));
  server.draws.length = 0;
  server.drawRows.length = 0;
  server.requests.length = 0;
  server.responseRulesResponse = null;
}
const winnerEntry = () => server.entries.find((e) => e.id === server.session?.winner_entry_id) || null;
function statePayload() {
  return { ok: true, connection: server.connection, session: server.session, entries: server.entries, winner: winnerEntry(), draws: server.drawRows };
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
    server.session ||= { id: "gs-1", site_id: "site-1", winner_entry_id: null, started_at: new Date(now).toISOString() };
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
  if (path === "/api/giveaways/chat/entries/clear") {
    server.entries = [];
    for (const draw of server.drawRows) draw.entry_id = null;
    Object.assign(server.session, {
      winner_entry_id: null,
      drawn_at: null,
      winner_confirmed_at: null,
      winner_confirmation_message: null,
      winner_finalized_at: null,
      winner_finalized_by: null,
      winner_response_deadline: null,
      auto_reroll_exhausted_at: null,
    });
    return json(statePayload());
  }
  if (path === "/api/giveaways/chat/draw") {
    // CAS: the draw only lands on the identity the client claimed to see
    // (null/null = "no draw yet").
    const expectedId = body?.expectedWinnerEntryId ?? null;
    const expectedDrawn = body?.expectedDrawnAt ?? null;
    const isNext = body?.next === true;
    if (isNext && !server.session.winner_finalized_at) {
      return json({ ok: false, error: "Confirm or re-roll the current winner first.", session: server.session, entries: server.entries, winner: winnerEntry() }, 409);
    }
    const mismatch = isNext
      ? expectedId !== server.session.winner_entry_id || Date.parse(server.session.drawn_at) !== Date.parse(expectedDrawn)
      : expectedId === null
        ? server.session.winner_entry_id !== null
        : server.session.winner_entry_id !== expectedId
          || Date.parse(server.session.drawn_at) !== Date.parse(expectedDrawn);
    if (mismatch) {
      const error = server.session.winner_finalized_at
        ? "This winner is already confirmed and cannot be re-rolled."
        : "The giveaway draw changed. Refresh the current draw before drawing again.";
      return json({ ok: false, error, session: server.session, entries: server.entries, winner: winnerEntry() }, 409);
    }
    if (expectedId !== null && server.session.winner_finalized_at && !isNext) {
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
    if (!winner) {
      if (body?.automatic === true) {
        // Mirrors drawGiveaway's exhausted path: deadline disarmed, flag stamped,
        // and the 409 carries the persisted session so the client can render it.
        server.session.winner_response_deadline = null;
        server.session.auto_reroll_exhausted_at = new Date(now).toISOString();
        return json({ ok: false, error: eligible.length ? "No other eligible entrants remain." : "No eligible entrants to draw from.", exhausted: true, session: server.session, entries: server.entries, winner: winnerEntry(), draws: server.drawRows }, 409);
      }
      return json({ ok: false, error: eligible.length ? "No other eligible entrants remain." : "No eligible entrants to draw from." }, 409);
    }
    server.draws.push(winner.id);
    const rules = server.session.rules || {};
    // A manually-added winner has no chat identity to respond with.
    const required = rules.winnerMustRespond === true && winner.provider !== "manual";
    const timeout = required ? (rules.responseTimeout || 60) : null;
    const replacedId = isNext ? null : server.session.winner_entry_id;
    server.drawRows.push({
      id: `draw-${server.drawRows.length + 1}`,
      entry_id: winner.id,
      reason: body?.automatic === true ? "auto_reroll" : expectedId !== null && !isNext ? "reroll" : "draw",
      drawn_at: new Date(now).toISOString(),
      replaced_entry_id: replacedId,
      username: winner.username,
      replaced_username: server.entries.find((e) => e.id === replacedId)?.username || null,
      confirmed_at: null,
    });
    Object.assign(server.session, {
      winner_entry_id: winner.id, drawn_at: new Date(now).toISOString(),
      status: server.session.status === "active" ? "active" : "completed",
      winner_confirmed_at: null, winner_confirmation_message: null,
      winner_finalized_at: null, winner_finalized_by: null,
      winner_response_required: required,
      winner_response_timeout_seconds: timeout,
      winner_response_deadline: required ? new Date(now + timeout * 1000).toISOString() : null,
      auto_reroll_exhausted_at: null,
    });
    return json({ ok: true, session: server.session, entries: server.entries, winner, draws: server.drawRows });
  }
  if (path === "/api/giveaways/chat/response-rules") {
    if (server.responseRulesResponse) return json(server.responseRulesResponse.body, server.responseRulesResponse.status);
    if (!body?.sessionId) return json({ ok: false, error: "Missing sessionId" }, 400);
    const s = server.session;
    if (!s || s.id !== body.sessionId) return json({ ok: false, error: "Giveaway not found" }, 404);
    if (s.provider !== "kick" || s.status === "cancelled") {
      return json({ ok: false, error: "Winner verification can't change after the giveaway ends." }, 409);
    }
    if (body.autoReroll && !body.winnerMustRespond) return json({ ok: false, error: "Auto re-roll requires winner response verification." }, 400);
    s.rules = { ...(s.rules || {}), winnerMustRespond: !!body.winnerMustRespond, responseTimeout: body.responseTimeout || 60, autoReroll: !!body.autoReroll };
    return json(statePayload());
  }
  if (path === "/api/giveaways/chat/finalize") {
    if (!body?.sessionId) return json({ ok: false, error: "Missing sessionId" }, 400);
    if (!body?.winnerEntryId) return json({ ok: false, error: "Missing winnerEntryId" }, 400);
    if (body?.drawnAt == null) return json({ ok: false, error: "Missing drawnAt" }, 400);
    // CAS: only the draw the client saw may be finalized.
    if (server.session?.winner_entry_id !== body.winnerEntryId
        || Date.parse(server.session?.drawn_at) !== Date.parse(body.drawnAt)) {
      return json({ ok: false, error: "The giveaway winner changed. Refresh the current draw before confirming." }, 409);
    }
    if (server.session.winner_finalized_at) return json(statePayload());
    if (server.session.winner_response_required && !server.session.winner_confirmed_at) {
      return json({ ok: false, error: "The winner must respond in chat before you can confirm.", session: server.session }, 409);
    }
    Object.assign(server.session, { winner_finalized_at: "2026-09-28T00:02:00Z", winner_finalized_by: user.id });
    const latestDraw = [...server.drawRows].reverse().find((draw) => draw.entry_id === server.session.winner_entry_id);
    if (latestDraw) latestDraw.confirmed_at = server.session.winner_finalized_at;
    return json(statePayload());
  }
  return json({ ok: true });
};
const requestsTo = (path) => server.requests.filter((r) => r.path === path);

const $id = (id) => document.getElementById(id);
const confirmButtons = () => [$id("gw-btn-confirm"), $id("gw-modal-confirm")].filter(Boolean);
const rerollButtons = () => [$id("gw-btn-reroll"), $id("gw-modal-reroll")].filter(Boolean);
const click = (id) => clickGiveaways($id(id));
async function clickAndFlush(id) {
  await actGiveaways(async () => {
    $id(id)?.click();
    await flushMicrotasks();
  });
}
async function dispatchAndFlush(target, event) {
  await actGiveaways(async () => {
    target.dispatchEvent(event);
    await flushMicrotasks();
  });
}
const setInput = (id, value, eventName = "input") => setGiveawaysInputValue($id(id), value, eventName);
const setCheckbox = (id, checked) => {
  if (($id(id).getAttribute("aria-checked") === "true") !== checked) click(id);
};
async function selectDuration(seconds) {
  click("gw-opt-claim-duration");
  await actGiveaways();
  const option = [...document.querySelectorAll('[role="option"]')]
    .find((item) => item.textContent.trim() === `${seconds} seconds`);
  clickGiveaways(option);
  await actGiveaways();
}

async function enter() {
  const tab = document.getElementById("giveaway-root")?.getAttribute("data-tab") || "chat";
  await mountGiveawaysPage({ tab, site: { id: "site-1", name: "Kick Cup" } });
}

async function leave() {
  await unmountGiveawaysPage();
}

async function boot() {
  await enter();
  await clock.tick(50);
  expect($id("gw-btn-roll").disabled).toBe(false);
}

async function tickUntilReveal() {
  for (let i = 0; i < 90 && !$id("gw-winner-stage"); i++) await clock.tick(100);
  expect($id("gw-winner-stage")).toBeTruthy();
}

async function drawWinner() {
  await clickAndFlush("gw-btn-roll");
  await tickUntilReveal();
}

describe("Giveaway draw flow", () => {
  beforeEach(async () => {
    now = 0;
    timers.length = 0;
    reducedMotion = false;
    resetServer();
    document.body.innerHTML = renderGiveawaysHtml("chat");
    window.localStorage.clear();
  });

  afterEach(async () => {
    await leave();
    timers.forEach((t) => { t.cancelled = true; });
    timers.length = 0;
  });

  afterAll(() => {
    // Hand every installed global back so the next test file sees real timers,
    // the real fetch, and the real Date.now.
    restoreGiveawaysDomGlobals();
    Object.assign(globalThis, originalRuntime);
    Object.assign(window, originalWindowRuntime);
    Object.defineProperty(globalThis, "performance", { value: originalRuntime.performance, configurable: true });
    Date.now = originalDateNow;
  });

  it("with no response requirement the claim boxes stay hidden and confirm is ready", async () => {
    await boot();
    await drawWinner();
    expect($id("gw-claim-box")).toBeNull();
    expect($id("gw-modal-claim-box")).toBeNull();
    for (const b of confirmButtons()) {
      expect(b.disabled).toBe(false);
    }
    await clock.tick(950);
    expect($id("gw-winner-modal")).toBeTruthy();
  });

  it("starts a manual giveaway and adds dashboard-entered viewers without Kick links", async () => {
    server.session = null;
    server.entries = [];
    server.connection = { connected: false, chatReady: false, channelName: null };
    await enter();
    await clock.tick(50);

    expect($id("gw-manual-start-hint")).toBeTruthy();
    expect($id("gw-keyword-field")).toBeNull();
    expect($id("gw-btn-listen").disabled).toBe(false);
    expect($id("gw-listen-btn-label").textContent).toBe("Start manual giveaway");
    expect($id("gw-entry-modes").hidden).toBe(true);
    expect($id("gw-kick-eligibility-section").hidden).toBe(true);
    expect($id("gw-winner-verification-section").hidden).toBe(true);
    expect($id("gw-anti-abuse-section").hidden).toBe(true);
    expect($id("gw-rules-card")).toBeNull();
    expect($id("gw-advanced-options").open).toBe(false);

    await actGiveaways(() => { $id("gw-advanced-options").open = true; });
    click("gw-opt-skip-past");
    click("gw-opt-winner-repeat");

    await clickAndFlush("gw-btn-listen");
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
    expect($id("gw-setup-card").textContent).toContain("LIVE");
    expect($id("gw-stage-card").textContent).toContain("Winners (0)");
    expect($id("gw-add-entrant-form").hidden).toBe(false);
    expect($id("gw-layout").classList.contains("is-live")).toBe(true);

    const input = $id("gw-add-entrant-name");
    expect(input.placeholder).toBe("Add viewer name…");
    setGiveawaysInputValue(input, "Alex Rivera");
    await dispatchAndFlush($id("gw-add-entrant-form"), new window.Event("submit", { bubbles: true, cancelable: true }));
    const addRequest = requestsTo("/api/giveaways/chat/entries/add")[0];
    expect(addRequest.body).toMatchObject({ sessionId: "gs-1", username: "Alex Rivera", siteId: "site-1" });
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);

    const row = $id("entrant-manual-1");
    expect(row.querySelector("a")).toBeNull();
    expect(row.querySelector(".gw-entrant-name").tagName).toBe("SPAN");
    expect(row.querySelector("img").src.startsWith("data:image/svg+xml")).toBe(true);
    expect(row.querySelector('[data-label="Status"]').textContent).toContain("Added manually");
    expect(row.querySelector(".gw-entrant-msg")).toBeNull();
    expect($id("gw-btn-roll").hidden).toBe(false);
    expect($id("gw-btn-roll").disabled).toBe(false);
  });

  it("with a required response the confirm action waits on chat", async () => {
    // Rules are locked at /start; the draw reads them from the session row.
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    await boot();
    await drawWinner();
    expect($id("gw-claim-box")).toBeTruthy();
    expect($id("gw-claim-status").textContent).toBe("Waiting for winner response…");
    // The winner reveal consumed part of the 30s window: the countdown derives
    // from drawn_at, not the checkbox duration.
    const shown = parseInt($id("gw-claim-countdown").textContent, 10);
    expect(shown).toBeLessThanOrEqual(27);
    expect(shown).toBeGreaterThanOrEqual(24);
    for (const b of confirmButtons()) {
      expect(b.disabled).toBe(true);
      expect(b.title).toBe("Waiting for the winner to respond in chat");
    }
    expect(rerollButtons().every((button) => !button.disabled)).toBe(true);
  });

  it("a chat reply before the deadline unlocks confirmation", async () => {
    // Rules are locked at /start; the draw reads them from the session row.
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    await boot();
    await drawWinner();
    expect($id("gw-confetti")).toBeTruthy();
    server.session.winner_confirmed_at = "2026-09-28T00:01:30Z";
    server.session.winner_confirmation_message = "I am here";
    await clock.tick(4000); // next poll carries the confirmed state
    expect($id("gw-claim-status").textContent).toBe("I am here");
    expect($id("gw-claim-countdown").textContent).toBe("Verified");
    expect($id("gw-modal-verify-chip")).toBeTruthy();
    const feed = $id("gw-winner-chat-feed");
    expect(feed.getAttribute("aria-live")).toBe("polite");
    expect(feed.textContent).toContain(`@${winnerEntry().username}:`);
    expect(feed.textContent).toContain("!win");
    expect(feed.textContent).toContain("I am here");
    for (const b of confirmButtons()) {
      expect(b.disabled).toBe(false);
    }
  });

  it("an expired response window promotes re-roll and keeps confirm locked", async () => {
    // Rules are locked at /start; the draw reads them from the session row.
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    await boot();
    await drawWinner();
    await clock.tick(31000);
    expect($id("gw-claim-status").textContent).toBe("Winner did not respond");
    expect(rerollButtons().every((button) => !button.disabled)).toBe(true);
    for (const b of confirmButtons()) {
      expect(b.disabled).toBe(true);
      expect(b.title).toBe("The winner did not respond — re-roll to pick another winner");
    }
  });

  it("manual confirmation persists through /finalize and survives a reload", async () => {
    await boot();
    await drawWinner();
    await clock.tick(950);
    expect($id("gw-winner-modal")).toBeTruthy();
    click("gw-modal-confirm");
    await clock.tick(0);
    const finalize = requestsTo("/api/giveaways/chat/finalize");
    expect(finalize).toHaveLength(1);
    expect(finalize[0].body.sessionId).toBe("gs-1");
    expect(finalize[0].body.winnerEntryId).toBe("e3");
    expect(finalize[0].body.drawnAt).toBe(server.session.drawn_at);
    for (const b of confirmButtons()) {
      expect(b.disabled).toBe(true);
    }
    expect($id("gw-winner-modal")).toBeNull();
    expect($id("gw-winner-stage").classList.contains("gw-winner-stage--confirmed")).toBe(true);

    // Reload: the finalized rendering is server truth, not local memory.
    await leave();
    await enter();
    await clock.tick(50);
    expect($id("gw-winner-stage").className).toContain("gw-winner-stage--confirmed");
    await clock.tick(1500);
    expect($id("gw-winner-modal")).toBeNull();
    expect($id("gw-claim-box")).toBeNull();
    expect($id("gw-modal-claim-box")).toBeNull();
  });

  it("keeps an active giveaway live and lets the confirmed winner lead to a next draw", async () => {
    server.session.status = "active";
    await boot();
    await drawWinner();

    expect($id("gw-setup-card").textContent).toContain("LIVE");
    expect($id("gw-btn-clear").disabled).toBe(true);
    const firstWinner = server.session.winner_entry_id;
    await clickAndFlush("gw-btn-confirm");
    expect(server.drawRows.at(-1).confirmed_at).toBe(server.session.winner_finalized_at);
    expect($id("gw-winner-stage").textContent).toContain("Winner confirmed");
    expect($id("gw-btn-roll").hidden).toBe(false);
    expect($id("gw-btn-roll").textContent.trim()).toBe("Draw next winner");

    await clickAndFlush("gw-btn-roll");
    await clock.tick(1_000);
    const revealNames = [...document.querySelectorAll(".gw-winner-reveal-item")].map((item) => item.textContent.trim());
    expect(revealNames).not.toContain(`@${server.entries.find((entry) => entry.id === firstWinner).username}`);
    await tickUntilReveal();
    const draws = requestsTo("/api/giveaways/chat/draw");
    expect(draws).toHaveLength(2);
    expect(draws[1].body).toMatchObject({
      next: true,
      expectedWinnerEntryId: firstWinner,
    });
    expect(server.session.winner_entry_id).not.toBe(firstWinner);
    expect(server.drawRows.at(-1)).toMatchObject({ reason: "draw", replaced_entry_id: null });
    expect($id("gw-draw-history-list").textContent).toContain("Confirmed");
    expect($id("gw-setup-card").textContent).toContain("LIVE");
  });

  it("clears participants while preserving confirmed draw history", async () => {
    server.drawRows.push({
      id: "draw-kept",
      entry_id: "e1",
      username: "prior-winner",
      reason: "draw",
      drawn_at: "2026-09-28T00:01:00Z",
      confirmed_at: "2026-09-28T00:02:00Z",
    });
    server.draws.push("e1");
    const keyword = server.session.keyword;
    await boot();

    expect($id("gw-btn-clear").disabled).toBe(false);
    await clickAndFlush("gw-btn-clear");
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog.textContent).toContain("Clear all participants?");
    expect(dialog.textContent).toContain("Everyone will need to type the keyword again. Winners stay in the Winners list.");
    const clearAction = [...dialog.querySelectorAll("button")].find((button) => button.textContent.trim() === "Clear list");
    expect(clearAction).toBeTruthy();
    await clickGiveaways(clearAction);
    await clock.tick(0);

    const clearRequest = requestsTo("/api/giveaways/chat/entries/clear").at(-1);
    expect(clearRequest.method).toBe("POST");
    expect(clearRequest.body).toMatchObject({ sessionId: "gs-1", siteId: "site-1" });
    expect(server.entries).toHaveLength(0);
    expect(server.session.keyword).toBe(keyword);
    expect(server.drawRows).toHaveLength(1);
    expect(server.drawRows[0]).toMatchObject({ entry_id: null, username: "prior-winner" });
    expect($id("gw-draw-history-list").textContent).toContain("prior-winner");
    expect($id("gw-btn-clear").disabled).toBe(true);
  });

  it("keeps Clear list disabled while the current winner is awaiting confirmation", async () => {
    await boot();
    await drawWinner();
    expect(server.session.winner_finalized_at).toBeNull();
    expect($id("gw-btn-clear").disabled).toBe(true);
  });

  it("allows winner response rules to change after a winner is confirmed", async () => {
    server.session.status = "active";
    server.session.winner_entry_id = "e1";
    server.session.drawn_at = "2026-09-28T00:01:00Z";
    server.session.winner_finalized_at = "2026-09-28T00:02:00Z";
    server.session.rules = { winnerMustRespond: false, responseTimeout: 60 };
    server.draws.push("e1");
    server.drawRows.push({
      id: "draw-confirmed",
      entry_id: "e1",
      username: "alpha",
      reason: "draw",
      drawn_at: server.session.drawn_at,
      confirmed_at: server.session.winner_finalized_at,
    });
    await boot();

    click("gw-opt-claim-req");
    await clock.tick(0);
    expect(requestsTo("/api/giveaways/chat/response-rules")).toHaveLength(1);
    expect(server.session.rules.winnerMustRespond).toBe(true);
    expect($id("gw-response-live-note")).toBeTruthy();
  });

  it("confirm never bypasses a pending required response", async () => {
    // Rules are locked at /start; the draw reads them from the session row.
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    await boot();
    await drawWinner();
    click("gw-btn-confirm");
    await clock.tick(0);
    expect(requestsTo("/api/giveaways/chat/finalize")).toHaveLength(0);
  });

  it("re-roll re-draws without the current winner", async () => {
    await boot();
    await drawWinner();
    expect(server.session.winner_entry_id).toBe("e3");
    click("gw-btn-reroll");
    await tickUntilReveal();
    const draws = requestsTo("/api/giveaways/chat/draw");
    expect(draws).toHaveLength(2);
    // The server excludes entries already drawn this session: e3 cannot repeat.
    expect(server.session.winner_entry_id).not.toBe("e3");
    expect(server.draws).toContain("e3");
    expect(server.draws).toContain(server.session.winner_entry_id);
  });

  it("the winner reveal lands on the server's pick, not a client guess", async () => {
    await boot();
    click("gw-btn-roll");
    await clock.tick(2_000);
    const items = [...$id("gw-roller-track").querySelectorAll(".gw-winner-reveal-item")];
    expect(items.at(-1).textContent).toBe("@charlie");
    expect(items.at(-2).textContent).not.toBe("@charlie");
    expect($id("gw-winner-stage")).toBeNull();
    await tickUntilReveal();
    // Server always drew the last submitted id.
    expect($id("gw-winner-name").textContent).toBe("charlie");
  });

  it("reduced motion reveals the winner quickly with no motion blur", async () => {
    reducedMotion = true;
    await boot();
    click("gw-btn-roll");
    await clock.tick(200);
    expect($id("gw-roller-track").classList.contains("blur-[1px]")).toBe(false);
    await tickUntilReveal();
    expect($id("gw-winner-stage")).toBeTruthy();
  });

  it("the verification modal opens only after the reveal lands", async () => {
    await boot();
    await drawWinner();
    expect($id("gw-winner-stage")).toBeTruthy();
    expect($id("gw-winner-modal")).toBeNull();
    await clock.tick(950);
    expect($id("gw-winner-modal")).toBeTruthy();
  });

  it("a reload during a required response window resumes the claim, not the confirm", async () => {
    // Rules are locked at /start; the draw reads them from the session row.
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    await boot();
    await drawWinner();
    await leave();
    await enter();
    await clock.tick(50);
    expect($id("gw-claim-box")).toBeTruthy();
    expect($id("gw-claim-status").textContent).toBe("Waiting for winner response…");
    for (const b of confirmButtons()) {
      expect(b.disabled).toBe(true);
      expect(b.title).toContain("Waiting for the winner");
    }
    expect($id("gw-winner-modal")).toBeNull();
  });

  it("the countdown on reload is derived from drawn_at, not the full window", async () => {
    // Rules are locked at /start; the draw reads them from the session row.
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    await boot();
    await drawWinner();
    // Reach exactly 10s after the server's drawn_at before reloading.
    const drawnAt = Date.parse(server.session.drawn_at);
    await clock.tick(Math.max(0, drawnAt + 10_000 - now));
    await leave();
    await enter();
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
    await leave();
    await clock.tick(31_000);
    await enter();
    await clock.tick(50);
    expect($id("gw-claim-box")).toBeTruthy();
    expect($id("gw-claim-status").textContent).toBe("Winner did not respond");
    expect(rerollButtons().every((button) => !button.disabled)).toBe(true);
    for (const b of confirmButtons()) {
      expect(b.disabled).toBe(true);
    }
    // No countdown was restarted.
    await clock.tick(2000);
    expect($id("gw-claim-status").textContent).toBe("Winner did not respond");
  });

  it("a reload after the winner responded in chat renders the verified state", async () => {
    // Rules are locked at /start; the draw reads them from the session row.
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    await boot();
    await drawWinner();
    server.session.winner_confirmed_at = new Date(now).toISOString();
    server.session.winner_confirmation_message = "here!";
    await leave();
    await enter();
    await clock.tick(50);
    expect($id("gw-claim-status").textContent).toBe("here!");
    expect($id("gw-claim-countdown").textContent).toBe("Verified");
    expect($id("gw-winner-modal")).toBeNull();
    for (const b of confirmButtons()) {
      expect(b.disabled).toBe(false);
    }
  });

  it("a reload with no response requirement keeps claim boxes hidden and confirm ready", async () => {
    await boot();
    await drawWinner();
    await leave();
    await enter();
    await clock.tick(50);
    expect($id("gw-claim-box")).toBeNull();
    expect($id("gw-modal-claim-box")).toBeNull();
    for (const b of confirmButtons()) expect(b.disabled).toBe(false);
  });

  it("a reload mid-window keeps counting down from the same deadline", async () => {
    // Rules are locked at /start; the draw reads them from the session row.
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    await boot();
    await drawWinner();
    const atReveal = parseInt($id("gw-claim-countdown").textContent, 10);
    await clock.tick(5000);
    await leave();
    await enter();
    await clock.tick(50);
    // ~5s later than the reveal value, from the same drawn_at deadline.
    const afterReload = parseInt($id("gw-claim-countdown").textContent, 10);
    expect(Math.abs(afterReload - (atReveal - 5))).toBeLessThanOrEqual(1);
    expect($id("gw-claim-status").textContent).toBe("Waiting for winner response…");
  });

  it("a re-roll sends no client-side rule overrides", async () => {
    server.session.rules = { winnerMustRespond: true, responseTimeout: 90 };
    await boot();
    await drawWinner();
    // Changing the controls after the draw cannot change this session's rules:
    // the draw request carries none of them and the server keeps the persisted
    // 90s required-response window.
    click("gw-btn-reroll");
    await tickUntilReveal();
    const draws = requestsTo("/api/giveaways/chat/draw");
    expect(draws).toHaveLength(2);
    expect(draws[1].body).not.toHaveProperty("responseRequired");
    expect(draws[1].body).not.toHaveProperty("responseTimeoutSeconds");
    expect(draws[1].body).not.toHaveProperty("entryIds");
    expect(server.session.winner_response_required).toBe(true);
    expect(server.session.winner_response_timeout_seconds).toBe(90);
    // The persisted rules drive the UI; the winner reveal consumed a few seconds.
    expect($id("gw-claim-box")).toBeTruthy();
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
    click("gw-btn-reroll");
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
    click("gw-btn-confirm");
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
    click("gw-btn-reroll");
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
    await leave();
    document.body.innerHTML = renderGiveawaysHtml("chat");
    await enter();
    await clock.tick(50);
    expect(document.querySelector('input[name="gw-entry-mode"]:checked').value).toBe("verified");
  });

  it("Advanced options are collapsed by default", async () => {
    await boot();
    const details = $id("gw-advanced-options");
    expect(details.open).toBe(false);
    expect(details.innerHTML).toContain('id="gw-opt-subscriber"');
    expect(details.innerHTML).toContain('id="gw-opt-ip"');
  });

  it("opening and closing Advanced options is a local preference, not a rule", async () => {
    await boot();
    const details = $id("gw-advanced-options");
    await actGiveaways(() => { details.open = true; });
    expect(localStorage.getItem("yr:gw-advanced-open")).toBe("1");
    await actGiveaways(() => { details.open = false; });
    expect(localStorage.getItem("yr:gw-advanced-open")).toBe("0");
    click("gw-btn-listen");
    await clock.tick(50);
    const start = requestsTo("/api/giveaways/chat/start").at(-1);
    expect(Object.keys(start.body.rules).sort()).toEqual(
      ["entryMode", "subscriberOnly", "vipOnly", "excludePreviousWinners", "winnerRepeat", "onePerIp", "vpnDetection", "winnerMustRespond", "responseTimeout", "autoReroll"].sort(),
    );
  });

  it("advanced settings keep their values while collapsed", async () => {
    await boot();
    await actGiveaways(() => { $id("gw-advanced-options").open = true; });
    setCheckbox("gw-opt-subscriber", true);
    await actGiveaways(() => { $id("gw-advanced-options").open = false; });
    click("gw-btn-listen");
    await clock.tick(50);
    expect(requestsTo("/api/giveaways/chat/start").at(-1).body.rules.subscriberOnly).toBe(true);
  });

  it("the default winner rule is Win once per giveaway", async () => {
    await boot();
    expect($id("gw-opt-winner-repeat").getAttribute("aria-checked")).toBe("false");
    click("gw-btn-listen");
    await clock.tick(50);
    expect(requestsTo("/api/giveaways/chat/start").at(-1).body.rules.winnerRepeat).toBe("once");
  });

  it("Win once excludes the current winner from a later re-roll", async () => {
    await boot();
    await drawWinner();
    const firstId = server.session.winner_entry_id;
    click("gw-btn-reroll");
    await tickUntilReveal();
    expect(server.session.winner_entry_id).not.toBe(firstId);
    expect(server.draws).toContain(firstId);
    expect(server.draws).toContain(server.session.winner_entry_id);
  });

  it("Can win again lets a re-roll land on the same participant", async () => {
    resetServer({ entries: [ENTRANTS[0]] });
    await boot();
    click("gw-opt-winner-repeat");
    click("gw-btn-listen");
    await clock.tick(50);
    expect(server.session.rules.winnerRepeat).toBe("again");
    await drawWinner();
    const firstId = server.session.winner_entry_id;
    click("gw-btn-reroll");
    await tickUntilReveal();
    expect(server.session.winner_entry_id).toBe(firstId);
    expect($id("gw-page-alert")).toBeNull();
    expect($id("gw-winner-stage")).toBeTruthy();
    expect($id("gw-btn-roll").hidden).toBe(true);
  });

  it("with no other eligible entrant a Win-once re-roll shows a clear error", async () => {
    resetServer({ entries: [ENTRANTS[0]] });
    await boot();
    await drawWinner();
    click("gw-btn-reroll");
    await clock.tick(3000);
    expect($id("gw-page-alert").textContent).toContain("No other eligible entrants remain.");
    // The reveal that already happened is untouched by the failed re-roll.
    expect(server.session.winner_entry_id).toBe("e1");
    expect($id("gw-winner-name").textContent).toBe("alpha");
  });

  it("a reload preserves the persisted winner repeat rule", async () => {
    server.session.rules = { winnerRepeat: "again" };
    await boot();
    expect($id("gw-opt-winner-repeat").getAttribute("aria-checked")).toBe("true");
    await leave();
    document.body.innerHTML = renderGiveawaysHtml("chat");
    await enter();
    await clock.tick(50);
    expect($id("gw-opt-winner-repeat").getAttribute("aria-checked")).toBe("true");
  });

  it("a stale tab's re-roll follows the server-persisted rule", async () => {
    resetServer({ entries: [ENTRANTS[0]] });
    server.session.status = "active";
    await boot();
    await drawWinner();
    // The fieldset is locked while the giveaway runs; even a forged control
    // change cannot alter the rule persisted at start.
    click("gw-opt-winner-repeat");
    expect($id("gw-opt-winner-repeat").getAttribute("aria-checked")).toBe("false");
    click("gw-btn-reroll");
    await clock.tick(3000);
    expect(server.session.rules.winnerRepeat ?? "once").toBe("once");
    expect($id("gw-page-alert").textContent).toContain("No other eligible entrants remain.");
  });

  it("historical past-winner exclusion stays separate from winner repeat", async () => {
    await boot();
    setCheckbox("gw-opt-skip-past", true);
    await clickAndFlush("gw-btn-listen");
    await clock.tick(50);
    const rules = requestsTo("/api/giveaways/chat/start").at(-1).body.rules;
    expect(rules.excludePreviousWinners).toBe(true);
    expect(rules.winnerRepeat).toBe("once");
    expect($id("gw-opt-skip-past").closest("label").textContent).toContain("Exclude past giveaway winners");
  });

  it("response timeout appears only when the winner must respond", async () => {
    await boot();
    expect($id("gw-claim-duration-wrap").hidden).toBe(true);
    await clickAndFlush("gw-opt-claim-req");
    expect($id("gw-claim-duration-wrap").hidden).toBe(false);
    expect($id("gw-opt-claim-duration").disabled).toBe(false);
    await clickAndFlush("gw-opt-claim-req");
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
    click("gw-opt-claim-req");
    await actGiveaways();
    expect($id("gw-auto-reroll-wrap").hidden).toBe(false);
    expect($id("gw-opt-auto-reroll").disabled).toBe(false);
    click("gw-opt-claim-req");
    await actGiveaways();
    expect($id("gw-auto-reroll-wrap").hidden).toBe(true);
    expect($id("gw-opt-auto-reroll").getAttribute("aria-checked")).toBe("false");
  });

  it("keeps winner verification editable on a live Kick giveaway while entry rules stay locked", async () => {
    server.session.status = "active";
    server.session.rules = { winnerMustRespond: true, responseTimeout: 60, autoReroll: false };
    await boot();

    expect($id("gw-settings").disabled).toBe(true);
    expect($id("gw-advanced-settings").disabled).toBe(true);
    expect($id("gw-response-settings").disabled).toBe(false);
    expect(document.querySelector('input[name="gw-entry-mode"][value="chat"]').closest("fieldset").disabled).toBe(true);
    expect($id("gw-opt-claim-req").disabled).toBe(false);
    expect($id("gw-opt-claim-duration").disabled).toBe(false);
    expect($id("gw-opt-auto-reroll").disabled).toBe(false);
    expect($id("gw-response-live-note")).toBeTruthy();
    expect($id("gw-settings-note").textContent).toContain("Entry rules are locked");

    await selectDuration(30);
    const req = requestsTo("/api/giveaways/chat/response-rules").at(-1);
    expect(req.method).toBe("POST");
    expect(req.body).toMatchObject({ sessionId: "gs-1", siteId: "site-1", winnerMustRespond: true, responseTimeout: 30, autoReroll: false });
    expect(server.session.rules.responseTimeout).toBe(30);
    expect($id("gw-opt-claim-duration").textContent).toBe("30 seconds");
  });

  it("restores the persisted response rules when the live save fails", async () => {
    server.session.status = "active";
    server.session.rules = { winnerMustRespond: true, responseTimeout: 60, autoReroll: false };
    server.responseRulesResponse = { status: 409, body: { ok: false, error: "Winner verification can't change after the giveaway ends." } };
    await boot();

    await selectDuration(90);
    expect(requestsTo("/api/giveaways/chat/response-rules")).toHaveLength(1);
    expect($id("gw-page-alert").textContent).toContain("Winner verification can't change");
    expect($id("gw-opt-claim-duration").textContent).toBe("60 seconds");
    expect($id("gw-opt-claim-req").getAttribute("aria-checked")).toBe("true");
    expect($id("gw-opt-claim-duration").disabled).toBe(false);
  });

  it("draw history lists earlier winners newest-first with replacement labels", async () => {
    server.session.status = "active";
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30, autoReroll: true };
    await boot();

    await drawWinner(); // server picks e3 (charlie)
    expect($id("gw-draw-history")).toBeTruthy();
    expect($id("gw-draw-history-list").querySelectorAll("li")).toHaveLength(0);
    expect($id("gw-btn-roll").hidden).toBe(true);

    await clickAndFlush("gw-btn-reroll");
    await tickUntilReveal();
    const items = [...$id("gw-draw-history-list").querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toHaveLength(1);
    expect(items[0]).toContain("charlie");
    expect(items[0]).toContain("Re-rolled");
    expect($id("gw-btn-roll").hidden).toBe(true);

    // Let the response window lapse; the open page fires the automatic re-roll.
    await clock.tick(31_000);
    const auto = requestsTo("/api/giveaways/chat/draw").at(-1);
    expect(auto.body.automatic).toBe(true);
    const after = [...$id("gw-draw-history-list").querySelectorAll("li")].map((li) => li.textContent);
    expect(after).toHaveLength(2);
    expect(after[0]).toContain("bravo");
    expect(after[0]).toContain("Didn't respond");
    expect(after[1]).toContain("charlie");
    expect(after[1]).toContain("Re-rolled");

    // Alpha's window lapses too; with no entrant left the sweep exhausts and the
    // server-side flag lands in the client's state via the 409 payload.
    await clock.tick(31_000);
    expect(requestsTo("/api/giveaways/chat/draw").at(-1).body.automatic).toBe(true);
    expect(server.session.auto_reroll_exhausted_at).not.toBeNull();
    expect($id("gw-page-alert").textContent).toBe("No other eligible entrants remain.");
    expect($id("gw-auto-reroll-stopped").textContent).toBe(
      "Auto re-roll stopped — alpha didn't respond and no other eligible entrants remain, so re-roll isn't possible. Start a new giveaway when you're ready.",
    );
    expect($id("gw-modal-auto-reroll-stopped").textContent).toBe(
      "Auto re-roll stopped — alpha didn't respond and no other eligible entrants remain, so re-roll isn't possible. Start a new giveaway when you're ready.",
    );
    const items2 = [...$id("gw-draw-history-list").querySelectorAll("li")].map((li) => li.textContent);
    expect(items2[0]).toContain("Auto re-roll stopped — no other eligible entrants left (alpha didn't respond)");
    expect(items2[1]).toContain("bravo");
    expect(items2[1]).toContain("Didn't respond");
    expect(items2[2]).toContain("charlie");
    expect(items2[2]).toContain("Re-rolled");
    // Confirm stays disabled (unanswered required response); nothing else hid.
    for (const b of confirmButtons()) expect(b.disabled).toBe(true);
  });

  it("shows a no-match state when the entrant search filters out every row", async () => {
    await boot();
    const search = $id("gw-search-entrants");
    const rows = () => [...($id("gw-entrants-list")?.querySelectorAll("tr") || [])];
    const visible = () => rows().filter((r) => !r.hidden);
    expect(visible()).toHaveLength(3);
    expect($id("gw-entrants-no-match")).toBeNull();

    // A term matching nothing hides all rows but shows the no-match state.
    setInput("gw-search-entrants", "zzz");
    expect(visible()).toHaveLength(0);
    expect($id("gw-entrants-no-match")).toBeTruthy();
    expect($id("gw-entrants-no-match").getAttribute("role")).toBe("status");
    expect($id("gw-entrants-no-match-text").textContent).toBe('No entrants match "zzz"');
    expect($id("gw-entrants-empty")).toBeNull();

    // Clear search restores every row and hides the notice.
    await clickAndFlush("gw-btn-clear-search");
    expect(search.value).toBe("");
    expect(visible()).toHaveLength(3);
    expect($id("gw-entrants-no-match")).toBeNull();

    // A partial match shows only the matching row and no notice.
    setInput("gw-search-entrants", "alp");
    expect(visible().map((r) => r.dataset.username)).toEqual(["alpha"]);
    expect($id("gw-entrants-no-match")).toBeNull();
  });

  it("a manually-added winner shows the no-response hint instead of the claim box", async () => {
    server.session.status = "active";
    server.session.rules = { winnerMustRespond: true, responseTimeout: 30 };
    server.entries = [{ id: "m1", giveaway_session_id: "gs-1", provider: "manual", provider_user_id: "manual:alice", username: "alice", avatar_url: null, message: "", badges: [], entered_at: "2026-09-28T00:00:00Z", eligibility_status: "eligible" }];
    await boot();
    await drawWinner();
    expect(server.session.winner_response_required).toBe(false);
    expect($id("gw-claim-box")).toBeNull();
    const hint = $id("gw-winner-manual-hint");
    expect(hint).toBeTruthy();
    expect(hint.textContent).toContain("no chat response needed");
    for (const b of confirmButtons()) expect(b.disabled).toBe(false);
  });
});
