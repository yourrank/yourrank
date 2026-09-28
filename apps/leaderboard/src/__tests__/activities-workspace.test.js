// Activities workspace behaviour: the real activities.js client runs against the
// real rendered fragment in a DOM with an in-memory API, so live/history
// separation, the create-drop drawer, plan-locked automation, template and
// schedule actions, and SPA leave/re-enter are exercised the way a browser
// drives them rather than by string-matching the source.
//
// Run: bun test src/__tests__/activities-workspace.test.js

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { ActivitiesPage } from "../pages/activities.jsx";
import { clearSession } from "../assets/dashboard/session.js";

const window = new Window({ url: "http://localhost/dashboard/activities?siteId=site-1" });
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
window.scrollTo = () => {};
let confirmAnswer = true;
const trapped = [];
window.__yrSpaShell = true;
window.__yrBoot = { signal() {}, fail() {} };

// ---- Fixture data -----------------------------------------------------------
let user = { id: "user-1", email: "creator@example.com", plan: "pro", emailVerified: true };
const sites = [
  { id: "site-1", name: "Kick Cup", slug: "kick-cup", published: true, userRole: "owner" },
  { id: "site-2", name: "Second Board", slug: "second", published: true, userRole: "owner" },
];
const now = Date.now();
const drop = (id, overrides = {}) => ({
  id: `drop:${id}`, title: id.toUpperCase(), typeLabel: "Code drop", state: "open", stateLabel: "Open",
  createdAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString(),
  reward: { creditsPerClaim: 100 }, progress: { claimed: 3, capacity: 50 }, actions: { canEnd: true }, ...overrides,
});
const ended = (id, stateLabel) => drop(id, { state: "completed", stateLabel, actions: { canEnd: false } });

/** Per-site datasets the fake API serves. Tests mutate these. */
let data;
function resetData() {
  data = {
    "site-1": {
      open: [drop("alpha"), drop("beta")],
      completed: [ended("gone", "Claimed out"), ended("late", "Expired"), ended("cut", "Ended by creator")],
      automation: {
        entitlement: { plan: "pro", canAutomate: true, message: null },
        templates: [{ id: "tpl-1", name: "Friday drop", kind: "safe_code_drop", config: { pointsReward: 100, maxClaims: 50, expireMinutes: 30 } }],
        schedules: [
          { id: "sch-1", templateName: "Friday drop", recurrence: "weekly", status: "scheduled", nextRunAt: new Date(now + 86_400_000).toISOString() },
          { id: "sch-2", templateName: "Friday drop", recurrence: "once", status: "failed", nextRunAt: new Date(now - 86_400_000).toISOString(), attentionMessage: "The last run failed." },
          { id: "sch-3", templateName: "Friday drop", recurrence: "once", status: "cancelled", nextRunAt: null },
        ],
      },
    },
    "site-2": {
      open: [],
      completed: [],
      automation: { entitlement: { plan: "free", canAutomate: false, message: "Manual code drops remain available. Templates and scheduling require Pro or Team." }, templates: [], schedules: [] },
    },
  };
}

const requests = [];
let failNext = null; // { path, status, error }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = async (input, init = {}) => {
  const raw = String(input);
  const url = new URL(raw, "http://localhost");
  const path = url.pathname;
  const body = init.body ? JSON.parse(init.body) : null;
  requests.push({ path, query: Object.fromEntries(url.searchParams), method: init.method || "GET", body });
  if (failNext && failNext.path === path) {
    const { status, error } = failNext;
    failNext = null;
    return json({ error }, status);
  }
  const siteId = url.searchParams.get("siteId") || body?.siteId || "site-1";
  const site = data[siteId];
  if (path === "/api/auth/me") return json({ ok: true, user });
  if (path === "/api/site/list") return json({ ok: true, sites });
  if (path === "/api/activities") {
    const state = url.searchParams.get("state") || "all";
    const limit = Number(url.searchParams.get("limit")) || 50;
    const rows = state === "open" ? site.open : state === "completed" ? site.completed : [...site.open, ...site.completed];
    const cursor = Number(url.searchParams.get("cursor") || 0);
    const pageRows = rows.slice(cursor, cursor + limit);
    const hasMore = cursor + limit < rows.length;
    const payload = { activities: pageRows, total: rows.length, page: { hasMore, nextCursor: hasMore ? String(cursor + limit) : null } };
    if (!url.searchParams.get("cursor")) payload.automation = site.automation;
    return json(payload);
  }
  if (path === "/api/activities/close") {
    const row = site.open.find((r) => r.id === body.activityId);
    if (!row) return json({ error: "Not found." }, 404);
    site.open = site.open.filter((r) => r !== row);
    site.completed.unshift({ ...row, state: "completed", stateLabel: "Ended by creator", actions: { canEnd: false } });
    return json({ ok: true, changed: true, activity: site.completed[0] });
  }
  if (path === "/api/events/drops") {
    site.open.unshift(drop(body.code.toLowerCase(), { reward: { creditsPerClaim: body.pointsReward }, progress: { claimed: 0, capacity: body.maxClaims } }));
    return json({ ok: true });
  }
  if (path === "/api/activities/templates") {
    if (init.method === "PUT") {
      const t = site.automation.templates.find((x) => x.id === body.templateId);
      Object.assign(t, { name: body.name, config: body.config });
    } else site.automation.templates.push({ id: `tpl-${site.automation.templates.length + 1}`, name: body.name, kind: body.kind, config: body.config });
    return json({ ok: true });
  }
  if (path === "/api/activities/templates/delete") {
    site.automation.templates = site.automation.templates.filter((x) => x.id !== body.templateId);
    return json({ ok: true });
  }
  if (path === "/api/activities/schedules/resume") {
    const s = site.automation.schedules.find((x) => x.id === body.scheduleId);
    Object.assign(s, { status: "scheduled", nextRunAt: body.runAt, attentionMessage: null });
    return json({ ok: true });
  }
  if (path === "/api/activities/schedules/cancel") {
    const s = site.automation.schedules.find((x) => x.id === body.scheduleId);
    s.status = "cancelled";
    return json({ ok: true });
  }
  if (path === "/api/activities/schedules") {
    site.automation.schedules.push({ id: `sch-${site.automation.schedules.length + 1}`, templateName: "Friday drop", recurrence: body.recurrence, status: "scheduled", nextRunAt: body.runAt });
    return json({ ok: true });
  }
  return json({ ok: true });
};
const requestsTo = (path) => requests.filter((r) => r.path === path);

const $id = (id) => document.getElementById(id);
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
const submit = (form) => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
const rowsOf = (id) => Array.from($id(id).querySelectorAll("li.act-drop"));
const codesOf = (id) => rowsOf(id).map((li) => li.querySelector("code").textContent);

document.body.innerHTML = `<div id="lbDynamic"></div>`;
const activities = await import("../assets/activities.js");
// The client imports the real dialog.js transitively; stub the dialog after
// that so confirmations resolve without a modal and focus traps are recorded.
window.YRDialog = {
  trap: (el) => { trapped.push(el); return () => {}; },
  confirm: async () => confirmAnswer,
};

/** Mount a fresh fragment (as the SPA loader does) and run enter(). */
async function mount(siteId = "site-1", hash = "") {
  window.history.replaceState(null, "", `/dashboard/activities?siteId=${siteId}${hash}`);
  $id("lbDynamic").innerHTML = ActivitiesPage({ fragment: true }).toString();
  await activities.enter();
  await settle();
}

afterAll(() => {
  for (const key of INSTALLED_GLOBALS) globalThis[key] = originalGlobals[key];
});

beforeEach(() => {
  resetData();
  requests.length = 0;
  trapped.length = 0;
  confirmAnswer = true;
  failNext = null;
  user = { id: "user-1", email: "creator@example.com", plan: "pro", emailVerified: true };
  clearSession();
  activities.leave();
});

describe("Activities workspace", () => {
  it("keeps live drops and history as separate server datasets, newest first, with the pager hidden for one page", async () => {
    await mount();
    const states = requestsTo("/api/activities").map((r) => r.query.state);
    expect(states).toContain("open");
    expect(states).toContain("completed");
    expect(states).not.toContain("all");

    expect($id("act-live-loading").hidden).toBe(true);
    expect(codesOf("act-live-list")).toEqual(["ALPHA", "BETA"]);
    expect($id("act-live").querySelector("h2").textContent).toBe("Live now · 2");
    expect(rowsOf("act-live-list").every((li) => li.querySelector("[data-activity-end]"))).toBe(true);

    expect(codesOf("act-history-list")).toEqual(["GONE", "LATE", "CUT"]);
    expect(rowsOf("act-history-list").some((li) => li.querySelector("[data-activity-end]"))).toBe(false);
    const labels = rowsOf("act-history-list").map((li) => li.querySelector(".v3-badge").textContent.trim());
    expect(labels).toEqual(["Claimed out", "Expired", "Ended by creator"]);
    expect($id("act-pager").hidden).toBe(true);
  });

  it("shows empty states with zero drops and no pager", async () => {
    await mount("site-2");
    expect($id("act-live-empty").hidden).toBe(false);
    expect($id("act-live-list").hidden).toBe(true);
    expect($id("act-history-empty").hidden).toBe(false);
    expect($id("act-pager").hidden).toBe(true);
    expect($id("act-live").querySelector("h2").textContent).toBe("Live now");
  });

  it("pages history through the server only when more than one page exists", async () => {
    data["site-1"].completed = Array.from({ length: 12 }, (_, i) => ended(`old${i + 1}`, "Expired"));
    await mount();
    expect($id("act-pager").hidden).toBe(false);
    expect(codesOf("act-history-list")).toHaveLength(5);
    expect(codesOf("act-history-list")[0]).toBe("OLD1");
    expect($id("act-pager-prev").disabled).toBe(true);
    expect($id("act-pager-next").disabled).toBe(false);
    expect(requestsTo("/api/activities").filter((r) => r.query.state === "completed")).toHaveLength(1);

    click($id("act-pager-next"));
    await settle();
    const historyRequests = requestsTo("/api/activities").filter((r) => r.query.state === "completed");
    expect(historyRequests).toHaveLength(2);
    expect(historyRequests[1].query.cursor).toBe("5");
    expect(codesOf("act-history-list")[0]).toBe("OLD6");
    expect($id("act-pager-prev").disabled).toBe(false);

    // Going back reuses the cached page instead of re-fetching it.
    click($id("act-pager-prev"));
    await settle();
    expect(requestsTo("/api/activities").filter((r) => r.query.state === "completed")).toHaveLength(2);
    expect(codesOf("act-history-list")[0]).toBe("OLD1");
  });

  it("opens the create drawer, posts the unchanged payload, then closes, refreshes, and reports", async () => {
    await mount();
    expect($id("act-create-drawer").hidden).toBe(true);
    click(document.querySelector('[data-drawer-open="act-create-drawer"]'));
    expect($id("act-create-drawer").hidden).toBe(false);
    expect(trapped.at(-1)).toBeTruthy();
    expect(trapped.at(-1).contains($id("act-drop-code"))).toBe(true);

    $id("act-drop-code").value = "party100";
    $id("act-drop-points").value = "250";
    $id("act-drop-max").value = "20";
    $id("act-drop-expire").value = "30";
    submit($id("act-drop-form"));
    await settle();

    const post = requestsTo("/api/events/drops")[0];
    expect(post.method).toBe("POST");
    expect(post.body).toEqual({ siteId: "site-1", code: "party100", pointsReward: 250, maxClaims: 20, expireMinutes: 30 });
    expect($id("act-create-drawer").hidden).toBe(true);
    expect(codesOf("act-live-list")[0]).toBe("PARTY100");
    expect($id("act-live").querySelector("h2").textContent).toBe("Live now · 3");
    expect($id("act-feedback").textContent).toBe("Drop PARTY100 is live.");
    expect($id("act-drop-code").value).toBe("");
  });

  it("keeps the drawer open and shows the server's message when creation fails", async () => {
    await mount();
    click(document.querySelector('[data-drawer-open="act-create-drawer"]'));
    failNext = { path: "/api/events/drops", status: 409, error: "That code is already live." };
    $id("act-drop-code").value = "ALPHA";
    submit($id("act-drop-form"));
    await settle();
    expect($id("act-create-drawer").hidden).toBe(false);
    expect($id("act-form-status").textContent).toBe("That code is already live.");
    expect($id("act-form-status").classList.contains("is-error")).toBe(true);
  });

  it("closes the drawer on Cancel without posting", async () => {
    await mount();
    click(document.querySelector('[data-drawer-open="act-create-drawer"]'));
    click($id("act-create-drawer").querySelector("[data-drawer-close]"));
    expect($id("act-create-drawer").hidden).toBe(true);
    expect(requestsTo("/api/events/drops")).toHaveLength(0);
  });

  it("ends a live drop only after confirmation and moves it to history", async () => {
    await mount();
    confirmAnswer = false;
    click(document.querySelector('[data-activity-end="drop:alpha"]'));
    await settle();
    expect(requestsTo("/api/activities/close")).toHaveLength(0);
    expect(codesOf("act-live-list")).toEqual(["ALPHA", "BETA"]);

    confirmAnswer = true;
    const button = document.querySelector('[data-activity-end="drop:alpha"]');
    expect(button.classList.contains("v3-btn--danger")).toBe(false);
    expect(button.classList.contains("v3-btn--accent")).toBe(false);
    click(button);
    await settle();
    expect(requestsTo("/api/activities/close")[0].body).toEqual({ siteId: "site-1", activityId: "drop:alpha" });
    expect(codesOf("act-live-list")).toEqual(["BETA"]);
    expect(codesOf("act-history-list")[0]).toBe("ALPHA");
    expect($id("act-feedback").textContent).toBe("Ended ALPHA.");
  });

  it("switches tabs via the in-page subnav and the URL hash", async () => {
    await mount();
    expect($id("act-panel-drops").hidden).toBe(false);
    expect($id("act-panel-automation").hidden).toBe(true);
    click(document.querySelector('.act-tabs [data-subnav="automation"]'));
    expect($id("act-panel-drops").hidden).toBe(true);
    expect($id("act-panel-automation").hidden).toBe(false);
    expect(document.querySelector('.act-tabs [data-subnav="automation"]').getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector('.act-tabs [data-subnav="drops"]').getAttribute("aria-selected")).toBe("false");
    expect(window.location.hash).toBe("#automation");

    activities.leave();
    await mount("site-1", "#automation");
    expect($id("act-panel-automation").hidden).toBe(false);
  });

  it("renders Pro/Team automation with templates and prioritised schedules", async () => {
    await mount();
    expect($id("act-automation-gate").hidden).toBe(true);
    expect($id("act-automation").hidden).toBe(false);
    expect($id("act-template-list").querySelectorAll("[data-template-id]")).toHaveLength(1);
    const groups = Array.from($id("act-schedule-list").querySelectorAll(".act-schedule-group")).map((g) => g.dataset.group);
    expect(groups).toEqual(["attention", "upcoming", "past"]);
    const failed = $id("act-schedule-list").querySelector('[data-schedule-id="sch-2"]');
    expect(failed.classList.contains("is-attention")).toBe(true);
    expect(failed.querySelector("[data-schedule-resume]")).toBeTruthy();
    expect(failed.querySelector("[data-schedule-resume]").classList.contains("v3-btn--accent")).toBe(true);
    expect(failed.textContent).toContain("The last run failed.");
    expect($id("act-schedule-list").querySelector('[data-schedule-id="sch-3"] [data-schedule-cancel]')).toBeNull();
    expect($id("act-schedule-list").querySelector('[data-schedule-id="sch-3"] [data-schedule-resume]')).toBeNull();
  });

  it("shows one compact locked state on Free with no automation controls underneath", async () => {
    await mount("site-2");
    expect($id("act-automation-gate").hidden).toBe(false);
    expect($id("act-automation-gate-copy").textContent).toContain("Templates and scheduling require Pro or Team.");
    expect($id("act-automation").hidden).toBe(true);
    const visibleControls = Array.from($id("act-panel-automation").querySelectorAll("button, select, input"))
      .filter((el) => !el.closest("[hidden]"));
    expect(visibleControls.filter((el) => el.closest("#act-automation"))).toHaveLength(0);
    expect(visibleControls.some((el) => el.disabled)).toBe(false);
    // Manual drops stay available.
    expect(document.querySelector('[data-drawer-open="act-create-drawer"]').disabled).toBe(false);
  });

  it("creates and edits templates through the drawer with the existing API contract", async () => {
    await mount();
    click(document.querySelector('[data-drawer-open="act-template-drawer"]'));
    expect($id("act-template-drawer").hidden).toBe(false);
    expect($id("act-template-drawer-title").textContent).toBe("New template");
    $id("act-template-name").value = "Weekend";
    $id("act-template-points").value = "500";
    $id("act-template-max").value = "10";
    $id("act-template-expire").value = "60";
    submit($id("act-template-form"));
    await settle();
    const create = requestsTo("/api/activities/templates")[0];
    expect(create.method).toBe("POST");
    expect(create.body).toEqual({ siteId: "site-1", kind: "safe_code_drop", name: "Weekend", config: { pointsReward: 500, maxClaims: 10, expireMinutes: 60 } });
    expect($id("act-template-drawer").hidden).toBe(true);
    expect($id("act-template-list").querySelectorAll("[data-template-id]")).toHaveLength(2);

    click($id("act-template-list").querySelector('[data-template-edit="tpl-1"]'));
    expect($id("act-template-drawer-title").textContent).toBe("Edit template");
    expect($id("act-template-name").value).toBe("Friday drop");
    $id("act-template-name").value = "Friday drop v2";
    submit($id("act-template-form"));
    await settle();
    const update = requestsTo("/api/activities/templates")[1];
    expect(update.method).toBe("PUT");
    expect(update.body.templateId).toBe("tpl-1");
    expect($id("act-template-list").textContent).toContain("Friday drop v2");
  });

  it("deletes a template optimistically and restores it when the server rejects", async () => {
    await mount();
    failNext = { path: "/api/activities/templates/delete", status: 500, error: "Nope." };
    click($id("act-template-list").querySelector('[data-template-delete="tpl-1"]'));
    await settle();
    expect(requestsTo("/api/activities/templates/delete")[0].body).toEqual({ siteId: "site-1", templateId: "tpl-1" });
    expect($id("act-template-list").querySelectorAll("[data-template-id]")).toHaveLength(1);
    expect($id("act-feedback").textContent).toBe("Nope.");

    click($id("act-template-list").querySelector('[data-template-delete="tpl-1"]'));
    await settle();
    expect($id("act-template-list").hidden).toBe(true);
    expect($id("act-template-empty").hidden).toBe(false);
  });

  it("reschedules a failed schedule and cancels schedules through the existing endpoints", async () => {
    await mount();
    click($id("act-schedule-list").querySelector('[data-schedule-resume="sch-2"]'));
    expect($id("act-schedule-drawer").hidden).toBe(false);
    expect($id("act-schedule-drawer-title").textContent).toBe("Reschedule");
    expect($id("act-schedule-template-field").hidden).toBe(true);
    submit($id("act-schedule-form"));
    await settle();
    const resume = requestsTo("/api/activities/schedules/resume")[0];
    expect(resume.body.scheduleId).toBe("sch-2");
    expect(typeof resume.body.runAt).toBe("string");
    expect(resume.body.templateId).toBeUndefined();
    expect($id("act-schedule-list").querySelector(".act-schedule-group[data-group=attention]")).toBeNull();

    click($id("act-schedule-list").querySelector('[data-schedule-cancel="sch-1"]'));
    await settle();
    expect(requestsTo("/api/activities/schedules/cancel")[0].body).toEqual({ siteId: "site-1", scheduleId: "sch-1" });
    expect($id("act-schedule-list").querySelector('[data-schedule-id="sch-1"]').closest(".act-schedule-group").dataset.group).toBe("past");

    click($id("act-schedule-new"));
    expect($id("act-schedule-drawer-title").textContent).toBe("Schedule an Activity");
    $id("act-schedule-recurrence").value = "daily";
    submit($id("act-schedule-form"));
    await settle();
    const created = requestsTo("/api/activities/schedules")[0];
    expect(created.body).toMatchObject({ siteId: "site-1", templateId: "tpl-1", recurrence: "daily" });
    expect(created.body.scheduleId).toBeUndefined();
  });

  it("re-enters after leave without duplicate listeners or stale site data", async () => {
    await mount("site-1");
    expect(codesOf("act-live-list")).toEqual(["ALPHA", "BETA"]);
    expect($id("act-scope").textContent).toContain("Kick Cup");
    click(document.querySelector('[data-drawer-open="act-create-drawer"]'));
    expect($id("act-create-drawer").hidden).toBe(false);

    activities.leave();
    expect($id("act-create-drawer").hidden).toBe(true);
    await mount("site-2");
    expect($id("act-live-empty").hidden).toBe(false);
    expect($id("act-live-list").hidden).toBe(true);
    expect($id("act-scope").textContent).toContain("Second Board");
    expect($id("act-scope").textContent).not.toContain("Kick Cup");
    expect($id("act-automation-gate").hidden).toBe(false);
    expect(requestsTo("/api/activities").at(-1).query.siteId).toBe("site-2");

    // Wiring is per-fragment: a second enter() on the same fragment must not add listeners.
    requests.length = 0;
    await activities.enter();
    await settle();
    click(document.querySelector('[data-drawer-open="act-create-drawer"]'));
    $id("act-drop-code").value = "ONCE";
    submit($id("act-drop-form"));
    await settle();
    expect(requestsTo("/api/events/drops")).toHaveLength(1);
    expect(requestsTo("/api/events/drops")[0].body.siteId).toBe("site-2");
  });

  it("discards responses that arrive after leaving", async () => {
    // Start entering site-1, then leave and mount site-2 before that entry's
    // responses land: the stale site-1 payload must not paint into site-2.
    window.history.replaceState(null, "", "/dashboard/activities?siteId=site-1");
    $id("lbDynamic").innerHTML = ActivitiesPage({ fragment: true }).toString();
    const pending = activities.enter();
    activities.leave();
    await mount("site-2");
    await pending;
    await settle();
    expect(codesOf("act-live-list")).toEqual([]);
    expect($id("act-live-empty").hidden).toBe(false);
    expect($id("act-scope").textContent).toContain("Second Board");
  });
});
