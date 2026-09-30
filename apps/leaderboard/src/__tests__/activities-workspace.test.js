// Activities workspace behavior is exercised through the React island with an
// in-memory API and portal-aware DOM helpers.
//
// Run: bun test src/__tests__/activities-workspace.test.js

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  activitiesAct,
  clickActivity,
  document,
  flushActivitiesUpdates,
  mountActivitiesPage,
  restoreActivitiesDomGlobals,
  setActivityInput,
  setActivitySelect,
  submitActivityForm,
  unmountActivitiesPage,
  window,
} from "./activities-react-utils.js";

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
let holdFailure = null;
let holdApiResponse = null;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = async (input, init = {}) => {
  const raw = String(input);
  const url = new URL(raw, "http://localhost");
  const path = url.pathname;
  const body = init.body ? JSON.parse(init.body) : null;
  requests.push({ path, url: `${url.pathname}${url.search}`, query: Object.fromEntries(url.searchParams), method: init.method || "GET", body });
  if (failNext && failNext.path === path) {
    const { status, error } = failNext;
    failNext = null;
    const response = json({ error }, status);
    if (holdFailure?.path === path) {
      return new Promise((resolve) => { holdFailure.release = () => resolve(response); });
    }
    return response;
  }
  if (holdApiResponse?.path === path
    && (!holdApiResponse.state || url.searchParams.get("state") === holdApiResponse.state)
    && (!holdApiResponse.siteId || url.searchParams.get("siteId") === holdApiResponse.siteId)) {
    return new Promise((resolve) => {
      holdApiResponse.release = () => resolve(json(holdApiResponse.body));
    });
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
const settle = flushActivitiesUpdates;
const click = clickActivity;
const submit = submitActivityForm;
const setInput = (id, value) => setActivityInput($id(id), value);
const setSelect = (id, value) => setActivitySelect($id(id), value);
const dialogButton = (label) => Array.from(document.querySelector('[role="alertdialog"]')?.querySelectorAll("button") || [])
  .find((button) => button.textContent.trim() === label);
const clickDialogButton = (label) => click(dialogButton(label));
const rowsOf = (id) => Array.from($id(id).querySelectorAll("li.act-drop"));
const codesOf = (id) => rowsOf(id).map((li) => li.querySelector("code").textContent);

/** Mount a fresh fragment (as the SPA loader does) and run enter(). */
async function mount(siteId = "site-1", hash = "", deps = {}) {
  const site = sites.find((item) => item.id === siteId);
  await mountActivitiesPage({ site, hash, deps });
  await settle();
}

afterAll(restoreActivitiesDomGlobals);

beforeEach(async () => {
  await unmountActivitiesPage();
  resetData();
  requests.length = 0;
  failNext = null;
  holdFailure = null;
  holdApiResponse = null;
  user = { id: "user-1", email: "creator@example.com", plan: "pro", emailVerified: true };
});

describe("Activities workspace", () => {
  it("keeps live drops and history as separate server datasets, newest first, with the pager hidden for one page", async () => {
    await mount();
    const activityRequests = requestsTo("/api/activities");
    const states = requestsTo("/api/activities").map((r) => r.query.state);
    expect(states).toContain("open");
    expect(states).toContain("completed");
    expect(states).not.toContain("all");
    expect(activityRequests.find((r) => r.query.state === "open").url).toBe("/api/activities?siteId=site-1&state=open&limit=100");
    expect(activityRequests.find((r) => r.query.state === "completed").url).toBe("/api/activities?siteId=site-1&state=completed&limit=5");

    expect($id("act-live-loading").hidden).toBe(true);
    expect($id("act-live-loading").getAttribute("role")).toBe("status");
    expect($id("act-live-loading").getAttribute("aria-busy")).toBe("true");
    expect($id("act-live-error").getAttribute("data-state")).toBe("error");
    expect($id("act-live-empty").getAttribute("data-state")).toBe("empty");
    expect($id("act-live").dataset.dropList).toBe("live");
    expect($id("act-live").getAttribute("aria-label")).toBe("Live now");
    expect($id("act-history").dataset.dropList).toBe("history");
    expect($id("act-history").getAttribute("aria-label")).toBe("History");
    expect($id("act-pager").parentElement.classList.contains("v3-list-shell-foot")).toBe(true);
    expect($id("act-scope").dataset.scope).toBe("site");
    expect($id("act-scope").querySelector(".v3-scope-label").textContent).toBe("Current site");
    expect(codesOf("act-live-list")).toEqual(["ALPHA", "BETA"]);
    expect($id("act-live").querySelector("h2").textContent).toBe("Live now · 2");
    expect(rowsOf("act-live-list").every((li) => li.querySelector("[data-activity-end]"))).toBe(true);

    expect(codesOf("act-history-list")).toEqual(["GONE", "LATE", "CUT"]);
    expect(rowsOf("act-history-list").some((li) => li.querySelector("[data-activity-end]"))).toBe(false);
    const labels = rowsOf("act-history-list").map((li) => li.querySelector(".v3-badge").textContent.trim());
    expect(labels).toEqual(["Claimed out", "Expired", "Ended by creator"]);
    expect(rowsOf("act-live-list")[0].querySelector(".v3-badge").dataset.tone).toBe("success");
    expect(rowsOf("act-history-list").map((li) => li.querySelector(".v3-badge").dataset.tone)).toEqual(["accent", "warning", "neutral"]);
    const liveBadge = rowsOf("act-live-list")[0].querySelector(".v3-badge");
    expect(liveBadge.classList.contains("uppercase")).toBe(false);
    expect(liveBadge.classList.contains("tracking-wide")).toBe(false);
    expect(rowsOf("act-live-list")[0].querySelector(".act-meter > span").style.width).toBe("6%");
    expect($id("act-create-toggle")).toBeTruthy();
    expect($id("act-create-toggle").classList.contains("bg-primary")).toBe(true);
    expect($id("act-create-toggle").classList.contains("v3-btn--primary")).toBe(false);
    expect($id("act-app").querySelector(".v3-head").classList.contains("!mb-0")).toBe(true);
    const mobileAreas = Array.from(rowsOf("act-live-list")[0].querySelectorAll(".act-drop__fact"))
      .map((item) => item.className.match(/\[grid-area:([^\]]+)\]/)?.[1]);
    expect(mobileAreas).toEqual(["credits", "expiry", "claims"]);
    expect($id("act-pager").hidden).toBe(true);
  });

  it("shows empty states with zero drops and no pager", async () => {
    await mount("site-2");
    expect($id("act-live-empty").hidden).toBe(false);
    expect($id("act-live-empty").getAttribute("data-state")).toBe("empty");
    expect($id("act-live-empty").querySelector(".v3-empty-actions").classList.contains("justify-center")).toBe(true);
    expect($id("act-live-list").hidden).toBe(true);
    expect($id("act-history-empty").hidden).toBe(false);
    expect($id("act-pager").hidden).toBe(true);
    expect($id("act-live").querySelector("h2").textContent).toBe("Live now");
    const emptyCreate = $id("act-live-empty").querySelector('[data-drawer-open="act-create-drawer"]');
    expect(emptyCreate.textContent).toBe("Create drop");
    await click(emptyCreate);
    expect($id("act-create-drawer").hidden).toBe(false);
    await click($id("act-drop-cancel"));
    expect($id("act-create-drawer")).toBeNull();
    expect(document.activeElement).toBe(emptyCreate);
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

    await click($id("act-pager-next"));
    await settle();
    const historyRequests = requestsTo("/api/activities").filter((r) => r.query.state === "completed");
    expect(historyRequests).toHaveLength(2);
    expect(historyRequests[1].query.cursor).toBe("5");
    expect(historyRequests[1].url).toBe("/api/activities?siteId=site-1&state=completed&limit=5&cursor=5");
    expect(codesOf("act-history-list")[0]).toBe("OLD6");
    expect($id("act-pager-prev").disabled).toBe(false);

    // Going back reuses the cached page instead of re-fetching it.
    await click($id("act-pager-prev"));
    await settle();
    expect(requestsTo("/api/activities").filter((r) => r.query.state === "completed")).toHaveLength(2);
    expect(codesOf("act-history-list")[0]).toBe("OLD1");
  });

  it("opens the create drawer, posts the unchanged payload, then closes, refreshes, and reports", async () => {
    data["site-1"].open = [];
    const toasts = [];
    await mount("site-1", "", { showToast: (message, type) => toasts.push({ message, type }) });
    expect($id("act-create-toggle")).toBeTruthy();
    expect($id("act-create-drawer")).toBeNull();
    const opener = document.querySelector('[data-drawer-open="act-create-drawer"]');
    await click(opener);
    expect($id("act-create-drawer").hidden).toBe(false);
    expect(document.activeElement?.id).toBe("act-drop-code");
    expect(Array.from($id("act-drop-expire").options).map((option) => option.value)).toEqual(["0", "15", "30", "60", "1440"]);
    expect($id("act-drop-expire").value).toBe("0");

    await setInput("act-drop-code", "party100");
    await setInput("act-drop-points", "250");
    await setInput("act-drop-max", "20");
    await setSelect("act-drop-expire", "30");
    await submit($id("act-drop-form"));
    await settle();

    const post = requestsTo("/api/events/drops")[0];
    expect(post.method).toBe("POST");
    expect(post.url).toBe("/api/events/drops?siteId=site-1");
    expect(post.body).toEqual({ siteId: "site-1", code: "party100", pointsReward: 250, maxClaims: 20, expireMinutes: 30 });
    expect($id("act-create-drawer")).toBeNull();
    expect(codesOf("act-live-list")[0]).toBe("PARTY100");
    expect($id("act-live").querySelector("h2").textContent).toBe("Live now · 1");
    expect($id("act-feedback").textContent).toBe("Drop PARTY100 is live.");
    expect(toasts).toContainEqual({ message: "Drop PARTY100 is live.", type: "success" });
    await click(opener);
    expect($id("act-drop-code").value).toBe("");
    await click($id("act-drop-cancel"));
  });

  it("keeps the drawer open and shows the server's message when creation fails", async () => {
    data["site-1"].open = [];
    await mount();
    await click(document.querySelector('[data-drawer-open="act-create-drawer"]'));
    failNext = { path: "/api/events/drops", status: 409, error: "That code is already live." };
    await setInput("act-drop-code", "ALPHA");
    await submit($id("act-drop-form"));
    await settle();
    expect($id("act-create-drawer").hidden).toBe(false);
    expect($id("act-form-status").textContent).toBe("That code is already live.");
    expect($id("act-form-status").classList.contains("is-error")).toBe(true);
  });

  it("closes the drawer on Cancel without posting", async () => {
    data["site-1"].open = [];
    await mount();
    const opener = document.querySelector('[data-drawer-open="act-create-drawer"]');
    await click(opener);
    await click($id("act-drop-cancel"));
    expect($id("act-create-drawer")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(requestsTo("/api/events/drops")).toHaveLength(0);
  });

  it("keeps Escape and the close button as no-request drawer dismissal paths", async () => {
    data["site-1"].open = [];
    await mount();
    await click(document.querySelector('[data-drawer-open="act-create-drawer"]'));
    await activitiesAct(() => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect($id("act-create-drawer")).toBeNull();
    expect(requestsTo("/api/events/drops")).toHaveLength(0);

    await click(document.querySelector('[data-drawer-open="act-create-drawer"]'));
    await click($id("act-create-drawer").querySelector("[data-drawer-close]"));
    expect($id("act-create-drawer")).toBeNull();
    expect(requestsTo("/api/events/drops")).toHaveLength(0);
  });

  it("ends a live drop only after confirmation and moves it to history", async () => {
    await mount();
    await click(document.querySelector('[data-activity-end="drop:alpha"]'));
    await settle();
    expect(requestsTo("/api/activities/close")).toHaveLength(0);
    expect(codesOf("act-live-list")).toEqual(["ALPHA", "BETA"]);
    expect(document.querySelector('[role="alertdialog"]').textContent).toContain('End "ALPHA" now?');
    const confirmEnd = dialogButton("End now");
    expect(confirmEnd.classList.contains("bg-background")).toBe(true);
    expect(confirmEnd.classList.contains("text-destructive")).toBe(true);
    expect(confirmEnd.classList.contains("border-destructive/30")).toBe(true);
    expect(confirmEnd.classList.contains("bg-destructive")).toBe(false);
    await clickDialogButton("Cancel");

    const button = document.querySelector('[data-activity-end="drop:alpha"]');
    expect(button.classList.contains("v3-btn--danger")).toBe(false);
    expect(button.classList.contains("v3-btn--accent")).toBe(false);
    await click(button);
    expect(button.classList.contains("opacity-55")).toBe(true);
    await clickDialogButton("End now");
    await settle();
    expect(requestsTo("/api/activities/close")[0].body).toEqual({ siteId: "site-1", activityId: "drop:alpha" });
    expect(codesOf("act-live-list")).toEqual(["BETA"]);
    expect(codesOf("act-history-list")[0]).toBe("ALPHA");
    expect($id("act-feedback").textContent).toBe("Ended ALPHA.");
  });

  it("switches tabs via the in-page subnav and the URL hash", async () => {
    await mount();
    expect(document.querySelector(".act-tabs").getAttribute("aria-label")).toBe("Activities");
    expect(document.querySelector(".act-tabs").hasAttribute("data-subnav-strip")).toBe(true);
    expect($id("act-tab-drops").classList.contains("is-on")).toBe(true);
    expect($id("act-panel-drops").hidden).toBe(false);
    expect($id("act-panel-automation").hidden).toBe(true);
    await click(document.querySelector('.act-tabs [data-subnav="automation"]'));
    expect($id("act-panel-drops").hidden).toBe(true);
    expect($id("act-panel-automation").hidden).toBe(false);
    expect(document.querySelector('.act-tabs [data-subnav="automation"]').getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector('.act-tabs [data-subnav="drops"]').getAttribute("aria-selected")).toBe("false");
    expect(window.location.hash).toBe("#automation");

    await unmountActivitiesPage();
    await mount("site-1", "#automation");
    expect($id("act-panel-automation").hidden).toBe(false);
  });

  it("supports roving tabs with arrow, Home, and End keys without rewriting the initial hash", async () => {
    await mount("site-1", "#automation");
    expect(window.location.hash).toBe("#automation");
    const automationTab = document.querySelector('[role="tab"][data-subnav="automation"]');
    expect(automationTab.getAttribute("tabindex")).toBe("0");
    await activitiesAct(() => automationTab.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true })));
    expect(document.activeElement.id).toBe("act-tab-drops");
    expect(window.location.hash).toBe("#drops");
    await activitiesAct(() => document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true })));
    expect(document.activeElement.id).toBe("act-tab-automation");
    expect(document.querySelector('[role="tab"][data-subnav="drops"]').getAttribute("tabindex")).toBe("-1");
    await activitiesAct(() => document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })));
    expect(document.activeElement.id).toBe("act-tab-drops");
  });

  it("renders Pro/Team automation with templates and prioritised schedules", async () => {
    await mount();
    expect($id("act-automation-gate").hidden).toBe(true);
    expect($id("act-automation").hidden).toBe(false);
    expect($id("act-template-list").querySelectorAll("[data-template-id]")).toHaveLength(1);
    const groups = Array.from($id("act-schedule-list").querySelectorAll(".act-schedule-group")).map((g) => g.dataset.group);
    expect(groups).toEqual(["attention", "upcoming", "past"]);
    const failed = $id("act-schedule-list").querySelector('[data-schedule-id="sch-2"]');
    const scheduled = $id("act-schedule-list").querySelector('[data-schedule-id="sch-1"]');
    const cancelled = $id("act-schedule-list").querySelector('[data-schedule-id="sch-3"]');
    const templateRow = $id("act-template-list").querySelector('[data-template-id="tpl-1"]');
    expect(failed.classList.contains("is-attention")).toBe(true);
    expect(failed.querySelector("[data-schedule-resume]")).toBeTruthy();
    expect(failed.querySelector("[data-schedule-resume]").classList.contains("v3-btn--accent")).toBe(true);
    expect(failed.textContent).toContain("The last run failed.");
    expect($id("act-schedule-list").querySelector('[data-schedule-id="sch-3"] [data-schedule-cancel]')).toBeNull();
    expect($id("act-schedule-list").querySelector('[data-schedule-id="sch-3"] [data-schedule-resume]')).toBeNull();
    expect(failed.closest(".act-schedule-group").dataset.group).toBe("attention");
    expect(failed.closest(".act-schedule-group").querySelector("h3").classList.contains("text-[15px]")).toBe(true);
    expect(failed.closest(".act-schedule-group").querySelector("h3").classList.contains("text-amber-800")).toBe(true);
    expect(failed.querySelector(".v3-badge").textContent.trim()).toBe("failed");
    expect(scheduled.querySelector(".v3-badge").textContent.trim()).toBe("scheduled");
    expect(cancelled.querySelector(".v3-badge").textContent.trim()).toBe("cancelled");
    expect($id("act-schedule-list").querySelector('[data-schedule-id="sch-1"]').closest(".act-schedule-group").dataset.group).toBe("upcoming");
    expect($id("act-schedule-list").querySelector('[data-schedule-id="sch-3"]').closest(".act-schedule-group").dataset.group).toBe("past");
    expect($id("act-schedule-list").querySelector('[data-schedule-id="sch-3"]').textContent).toContain("No time limit");
    const metricAreas = Array.from(rowsOf("act-live-list")[0].querySelectorAll(".act-drop__fact"))
      .map((item) => item.className.match(/\[grid-area:([^\]]+)\]/)?.[1]);
    expect(metricAreas).toEqual(["credits", "expiry", "claims"]);
    expect($id("act-templates").classList.contains("rounded-xl")).toBe(false);
    expect($id("act-templates").classList.contains("border")).toBe(false);
    expect($id("act-schedules").classList.contains("rounded-xl")).toBe(false);
    expect($id("act-schedules").classList.contains("border")).toBe(false);
    expect($id("act-schedule-new").classList.contains("bg-background")).toBe(true);
    expect($id("act-schedule-new").classList.contains("bg-primary")).toBe(false);
    expect(failed.querySelector(".act-item__actions").classList.contains("opacity-70")).toBe(false);
    expect(failed.querySelector("[data-schedule-resume]").classList.contains("opacity-70")).toBe(false);
    expect(scheduled.querySelector("[data-schedule-cancel]").classList.contains("opacity-70")).toBe(true);
    expect(templateRow.querySelector(".act-item__actions").classList.contains("opacity-70")).toBe(false);
    expect(templateRow.querySelector("[data-template-edit]").classList.contains("opacity-70")).toBe(true);
    expect(templateRow.querySelector("[data-template-delete]").classList.contains("opacity-70")).toBe(true);
  });

  it("uses centered automation empty states and an outlined disabled Schedule button", async () => {
    data["site-1"].automation.templates = [];
    data["site-1"].automation.schedules = [];
    await mount("site-1", "#automation");
    expect($id("act-template-empty").hidden).toBe(false);
    expect($id("act-template-empty").classList.contains("v3-empty")).toBe(true);
    expect($id("act-template-empty").getAttribute("data-state")).toBe("empty");
    expect($id("act-schedule-empty").hidden).toBe(false);
    expect($id("act-schedule-empty").classList.contains("v3-empty")).toBe(true);
    expect($id("act-schedule-empty").getAttribute("data-state")).toBe("empty");
    expect($id("act-schedule-new").disabled).toBe(true);
    expect($id("act-schedule-new").classList.contains("bg-background")).toBe(true);
    expect($id("act-schedule-new").classList.contains("border-input")).toBe(true);
  });

  it("shows one compact locked state on Free and wires the plan lock", async () => {
    const wired = [];
    await mount("site-2", "", { wirePlanLock: (element, feature) => wired.push({ element, feature }) });
    await settle();
    expect($id("act-automation-gate").hidden).toBe(false);
    expect($id("act-automation-gate-copy").textContent).toContain("Templates and scheduling require Pro or Team.");
    expect($id("act-automation").hidden).toBe(true);
    const upgrade = $id("act-automation-gate").querySelector("[data-plan-lock-upgrade]");
    expect(upgrade.getAttribute("href")).toBe("/dashboard/settings/billing?from=activities");
    expect(upgrade.classList.contains("bg-background")).toBe(true);
    expect(upgrade.classList.contains("underline")).toBe(false);
    expect($id("act-automation-gate").classList.contains("border-dashed")).toBe(true);
    expect($id("act-automation-gate").classList.contains("bg-transparent")).toBe(true);
    const visibleControls = Array.from($id("act-panel-automation").querySelectorAll("button, select, input"))
      .filter((el) => !el.closest("[hidden]"));
    expect(visibleControls.filter((el) => el.closest("#act-automation"))).toHaveLength(0);
    expect(visibleControls.some((el) => el.disabled)).toBe(false);
    expect(wired).toEqual([{ element: $id("act-automation-gate"), feature: "activity_automation" }]);
    // Manual drops stay available.
    expect(document.querySelector('[data-drawer-open="act-create-drawer"]').disabled).toBe(false);
  });

  it("keeps the live error message verbatim and retries that dataset", async () => {
    failNext = { path: "/api/activities", status: 500, error: "The board is temporarily offline." };
    await mount();
    expect($id("act-live-error").hidden).toBe(false);
    expect($id("act-live-error").getAttribute("role")).toBe("alert");
    expect($id("act-live-error").getAttribute("data-state")).toBe("error");
    expect($id("act-live-error").textContent).toContain("The board is temporarily offline.");
    await click($id("act-live-error").querySelector("[data-retry]"));
    await settle();
    expect($id("act-live-error").hidden).toBe(true);
    expect(codesOf("act-live-list")).toEqual(["ALPHA", "BETA"]);
  });

  it("creates and edits templates through the drawer with the existing API contract", async () => {
    await mount();
    await click(document.querySelector('[data-drawer-open="act-template-drawer"]'));
    expect($id("act-template-drawer").hidden).toBe(false);
    expect($id("act-template-drawer-title").textContent).toBe("New template");
    expect(document.activeElement).toBe($id("act-template-name"));
    await setInput("act-template-name", "Weekend");
    await setInput("act-template-points", "500");
    await setInput("act-template-max", "10");
    await setSelect("act-template-expire", "60");
    await submit($id("act-template-form"));
    await settle();
    const create = requestsTo("/api/activities/templates")[0];
    expect(create.method).toBe("POST");
    expect(create.url).toBe("/api/activities/templates?siteId=site-1");
    expect(create.body).toEqual({ siteId: "site-1", kind: "safe_code_drop", name: "Weekend", config: { pointsReward: 500, maxClaims: 10, expireMinutes: 60 } });
    expect($id("act-template-drawer")).toBeNull();
    expect($id("act-template-list").querySelectorAll("[data-template-id]")).toHaveLength(2);

    await click($id("act-template-list").querySelector('[data-template-edit="tpl-1"]'));
    expect($id("act-template-drawer-title").textContent).toBe("Edit template");
    expect($id("act-template-name").value).toBe("Friday drop");
    await setInput("act-template-name", "Friday drop v2");
    await submit($id("act-template-form"));
    await settle();
    const update = requestsTo("/api/activities/templates")[1];
    expect(update.method).toBe("PUT");
    expect(update.url).toBe("/api/activities/templates?siteId=site-1");
    expect(update.body.templateId).toBe("tpl-1");
    expect($id("act-template-list").textContent).toContain("Friday drop v2");
  });

  it("deletes a template optimistically and restores it when the server rejects", async () => {
    await mount();
    failNext = { path: "/api/activities/templates/delete", status: 500, error: "Nope." };
    holdFailure = { path: "/api/activities/templates/delete", release: null };
    await click($id("act-template-list").querySelector('[data-template-delete="tpl-1"]'));
    expect(document.querySelector('[role="alertdialog"]').textContent).toContain('Delete "Friday drop"?');
    expect(document.querySelector('[role="alertdialog"]').textContent).toContain("Existing schedules keep their saved snapshot.");
    await clickDialogButton("Delete");
    await settle();
    expect($id("act-template-list").querySelectorAll("[data-template-id]")).toHaveLength(0);
    await activitiesAct(() => holdFailure.release());
    await settle();
    expect(requestsTo("/api/activities/templates/delete")[0].body).toEqual({ siteId: "site-1", templateId: "tpl-1" });
    expect(requestsTo("/api/activities/templates/delete")[0].url).toBe("/api/activities/templates/delete?siteId=site-1");
    expect($id("act-template-list").querySelectorAll("[data-template-id]")).toHaveLength(1);
    expect($id("act-feedback").textContent).toBe("Nope.");

    await click($id("act-template-list").querySelector('[data-template-delete="tpl-1"]'));
    await clickDialogButton("Delete");
    await settle();
    expect($id("act-template-list").hidden).toBe(true);
    expect($id("act-template-empty").hidden).toBe(false);
  });

  it("reschedules a failed schedule and cancels schedules through the existing endpoints", async () => {
    await mount();
    await click($id("act-schedule-list").querySelector('[data-schedule-resume="sch-2"]'));
    expect($id("act-schedule-drawer").hidden).toBe(false);
    expect($id("act-schedule-drawer-title").textContent).toBe("Reschedule");
    expect($id("act-schedule-template-field").hidden).toBe(true);
    expect($id("act-schedule-recurrence-field").hidden).toBe(true);
    expect(document.activeElement).toBe($id("act-schedule-at"));
    await submit($id("act-schedule-form"));
    await settle();
    const resume = requestsTo("/api/activities/schedules/resume")[0];
    expect(resume.url).toBe("/api/activities/schedules/resume?siteId=site-1");
    expect(resume.body.scheduleId).toBe("sch-2");
    expect(typeof resume.body.runAt).toBe("string");
    expect(resume.body.templateId).toBeUndefined();
    expect($id("act-schedule-list").querySelector(".act-schedule-group[data-group=attention]")).toBeNull();

    await click($id("act-schedule-list").querySelector('[data-schedule-cancel="sch-1"]'));
    expect(document.querySelector('[role="alertdialog"]').textContent).toContain('Cancel "Friday drop"?');
    expect(document.querySelector('[role="alertdialog"]').textContent).toContain("No future Activity will be created from this schedule.");
    await clickDialogButton("Cancel");
    expect(requestsTo("/api/activities/schedules/cancel")).toHaveLength(0);
    await click($id("act-schedule-list").querySelector('[data-schedule-cancel="sch-1"]'));
    await clickDialogButton("Cancel Schedule");
    await settle();
    expect(requestsTo("/api/activities/schedules/cancel")[0].body).toEqual({ siteId: "site-1", scheduleId: "sch-1" });
    expect($id("act-schedule-list").querySelector('[data-schedule-id="sch-1"]').closest(".act-schedule-group").dataset.group).toBe("past");

    await click($id("act-schedule-new"));
    expect($id("act-schedule-drawer-title").textContent).toBe("Schedule an Activity");
    await setSelect("act-schedule-recurrence", "daily");
    await submit($id("act-schedule-form"));
    await settle();
    const created = requestsTo("/api/activities/schedules")[0];
    expect(created.url).toBe("/api/activities/schedules?siteId=site-1");
    expect(created.body).toMatchObject({ siteId: "site-1", templateId: "tpl-1", recurrence: "daily" });
    expect(created.body.scheduleId).toBeUndefined();
    await click($id("act-schedule-new"));
    expect($id("act-schedule-recurrence").value).toBe("daily");
    expect($id("act-schedule-template").value).toBe("tpl-1");
    await click($id("act-schedule-form-cancel"));
  });

  it("re-enters after leave without duplicate listeners or stale site data", async () => {
    await mount("site-1");
    expect(codesOf("act-live-list")).toEqual(["ALPHA", "BETA"]);
    expect($id("act-scope").textContent).toContain("Kick Cup");
    await click(document.querySelector('[data-subnav="automation"]'));
    await click($id("act-template-new"));
    expect($id("act-template-drawer").hidden).toBe(false);

    await unmountActivitiesPage();
    expect($id("act-template-drawer")).toBeNull();
    await mount("site-2");
    expect($id("act-live-empty").hidden).toBe(false);
    expect($id("act-live-list").hidden).toBe(true);
    expect($id("act-scope").textContent).toContain("Second Board");
    expect($id("act-scope").textContent).not.toContain("Kick Cup");
    expect($id("act-automation-gate").hidden).toBe(false);
    expect(requestsTo("/api/activities").at(-1).query.siteId).toBe("site-2");

    // Re-rendering the same island does not accumulate event handlers.
    requests.length = 0;
    await mount("site-2");
    await click(document.querySelector('[data-drawer-open="act-create-drawer"]'));
    await setInput("act-drop-code", "ONCE");
    await submit($id("act-drop-form"));
    await settle();
    expect(requestsTo("/api/events/drops")).toHaveLength(1);
    expect(requestsTo("/api/events/drops")[0].body.siteId).toBe("site-2");
  });

  it("keeps the selected history page size after leaving and re-entering", async () => {
    data["site-1"].completed = Array.from({ length: 12 }, (_, i) => ended(`page${i + 1}`, "Expired"));
    await mount();
    await setSelect("act-pager-size", "8");
    await settle();
    expect($id("act-pager-size").value).toBe("8");
    expect(requestsTo("/api/activities").filter((r) => r.query.state === "completed").at(-1).url)
      .toBe("/api/activities?siteId=site-1&state=completed&limit=8");

    await unmountActivitiesPage();
    await mount("site-2");
    expect($id("act-pager-size").value).toBe("8");

    await unmountActivitiesPage();
    await mount();
    await setSelect("act-pager-size", "5");
    await settle();
  });

  it("uses the HTTP fallback copy when an error response has no message", async () => {
    data["site-1"].open = [];
    await mount();
    failNext = { path: "/api/events/drops", status: 503 };
    await click(document.querySelector('[data-drawer-open="act-create-drawer"]'));
    await setInput("act-drop-code", "TEMPORARY");
    await submit($id("act-drop-form"));
    await settle();
    expect($id("act-form-status").textContent).toBe("The server returned HTTP 503.");
  });

  it("uses the access-denied fallback for a 403 response without an error field", async () => {
    data["site-1"].open = [];
    await mount();
    failNext = { path: "/api/events/drops", status: 403 };
    await click(document.querySelector('[data-drawer-open="act-create-drawer"]'));
    await setInput("act-drop-code", "DENIED");
    await submit($id("act-drop-form"));
    await settle();
    expect($id("act-form-status").textContent).toBe("You don't have access to do that.");
  });

  it("discards responses that arrive after leaving", async () => {
    let resolveOldShell;
    const pending = mountActivitiesPage({
      site: sites[0],
      deps: { loadBoardShell: () => new Promise((resolve) => { resolveOldShell = resolve; }) },
    });
    await pending;
    await unmountActivitiesPage();
    await mount("site-2");
    resolveOldShell({ activeSiteId: "site-1", board: sites[0] });
    await pending;
    await settle();
    expect(codesOf("act-live-list")).toEqual([]);
    expect($id("act-live-empty").hidden).toBe(false);
    expect($id("act-scope").textContent).toContain("Second Board");
  });

  it("discards a stale Activities response after switching boards", async () => {
    holdApiResponse = {
      path: "/api/activities",
      state: "open",
      siteId: "site-1",
      body: { activities: [drop("stale")], total: 1, page: { hasMore: false, nextCursor: null } },
      release: null,
    };
    await mount("site-1");
    expect(holdApiResponse.release).toBeTruthy();
    await unmountActivitiesPage();
    await mount("site-2");
    await activitiesAct(() => holdApiResponse.release());
    holdApiResponse = null;
    await settle();
    expect(codesOf("act-live-list")).toEqual([]);
    expect($id("act-scope").textContent).toContain("Second Board");
  });
});
