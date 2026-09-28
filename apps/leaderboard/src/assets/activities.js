import "./dashboard/command-palette.js";
import { loadBoardShell, preserveSiteContextLinks, sitePath } from "./dashboard/board-shell.js";
import { fetchDashboardJson, loginRedirectPath } from "./dashboard/request.js";
import { wirePlanLock } from "./dashboard/plan-lock.js";
import { clearSession } from "./dashboard/session.js";
import { showToast } from "./dashboard/utils.js";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  normalizePageSize,
  pageWindow,
  rangeLabel,
} from "./pagination.js";
import { ServerPages } from "./activity-pages.js";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));
const csrf = () => document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] || "";

const TABS = ["drops", "automation"];
// Page size for the live list: open drops are few by nature, and the server
// caps a page at 100, so one request always covers them.
const LIVE_LIMIT = 100;

let activeSiteId = "";
let lifecycleToken = 0;
let automation = { templates: [], schedules: [], entitlement: { canAutomate: false } };
let automationLoaded = false;
let liveRows = [];
let _activitiesEnter = null;
let _activitiesLeave = null;

// Pagination state for History (`state=completed`). Pages come from
// /api/activities one server page at a time (keyset cursor, `pageSize` rows
// each) and are cached in `pages`, so the browser never holds more history
// than the creator has actually paged through. `pageSize` is a deliberate user
// preference and survives reloads; `page` is reset to 1 whenever the dataset
// is reloaded so a shortened list can never strand the viewer on a page that
// no longer exists.
const activityPaging = { pages: new ServerPages(DEFAULT_PAGE_SIZE), page: 1, pageLoading: false };

export function enter() { return _activitiesEnter?.(); }
export function leave() { _activitiesLeave?.(); }

if (!window.__yrSpaShell) {
  window.addEventListener("storage", (event) => {
    if (event.key === "yr:logout") {
      clearSession();
      location.href = loginRedirectPath(location);
    }
  });
}

(function () {
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

  function formatDate(value) {
    if (!value) return "No time limit";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return dateFormat.format(date);
  }

  // "Ends in 12 min" / "Ends Sep 28, 14:05" / "No time limit" for a live row.
  function expiryLabel(value, now = Date.now()) {
    if (!value) return "No time limit";
    const at = new Date(value).getTime();
    if (Number.isNaN(at)) return "—";
    const minutes = Math.round((at - now) / 60_000);
    if (minutes <= 0) return "Ending now";
    if (minutes < 60) return `Ends in ${minutes} min`;
    if (minutes < 24 * 60) {
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return `Ends in ${hours}h${rest ? ` ${rest}m` : ""}`;
    }
    return `Ends ${formatDate(value)}`;
  }

  function recurrenceLabel(value) {
    return value === "daily" ? "Every 24 hours (UTC)" : value === "weekly" ? "Every 7 days (UTC)" : "One time";
  }

  // ---- Shared primitives (client side) ------------------------------------
  // Mirrors statusBadgeHtml / actionHtml from @yourrank/shared/dashboard-ui so
  // client-rendered rows use the same classes the server markup does.
  function badge(label, tone = "neutral", status = "") {
    return `<span class="v3-badge" data-tone="${esc(tone)}"${status ? ` data-status="${esc(status)}"` : ""}><span class="v3-badge-dot" aria-hidden="true"></span>${esc(label)}</span>`;
  }

  function action({ label, variant = "secondary", size = "sm", attrs = "" }) {
    const cls = ["v3-btn", variant === "primary" ? "v3-btn--accent" : variant === "destructive" ? "v3-btn--danger" : "", size === "sm" ? "v3-btn--sm" : size === "xs" ? "v3-btn--xs" : ""].filter(Boolean).join(" ");
    return `<button class="${cls}" type="button" ${attrs}>${esc(label)}</button>`;
  }

  // Drop state → badge tone. Labels come from the API (`stateLabel`).
  function dropTone(activity) {
    if (activity.state === "open") return "success";
    const label = String(activity.stateLabel || "").toLowerCase();
    if (label.includes("claimed out")) return "accent";
    if (label.includes("expired")) return "warning";
    return "neutral";
  }

  function scheduleTone(status) {
    if (status === "scheduled") return "info";
    if (status === "paused" || status === "failed") return "warning";
    return "neutral";
  }

  // ---- Feedback -----------------------------------------------------------
  // Drawer forms report inline (next to the fields); page-level outcomes use
  // the shared toast so the list is never pushed around by a status line.
  function setStatus(id, message, error = false) {
    const status = $(id);
    if (!status) return;
    status.hidden = !message;
    status.textContent = message;
    status.classList.toggle("is-error", Boolean(error));
  }

  function feedback(message, error = false) {
    const line = $("act-feedback");
    if (line) {
      line.hidden = !message;
      line.textContent = message || "";
      line.classList.toggle("is-error", Boolean(error));
    }
    if (message) showToast(message, error ? "error" : "success");
  }

  async function api(path, init = {}) {
    const method = String(init.method || "GET").toUpperCase();
    const headers = new Headers(init.headers || {});
    if (!new Set(["GET", "HEAD", "OPTIONS"]).has(method)) headers.set("x-csrf-token", csrf());
    try {
      const { body } = await fetchDashboardJson(path, { ...init, credentials: "same-origin", headers });
      return body;
    } catch (error) {
      if (error?.code === "AUTH") location.href = loginRedirectPath(location);
      throw error;
    }
  }

  // ---- Tabs ---------------------------------------------------------------
  function currentTab() {
    return $("act-app")?.dataset.tab || "drops";
  }

  function setTab(next, { updateHash = true } = {}) {
    const key = TABS.includes(next) ? next : "drops";
    const root = $("act-app");
    if (!root) return;
    root.dataset.tab = key;
    for (const tab of root.querySelectorAll(".act-tabs [data-subnav]")) {
      const on = tab.dataset.subnav === key;
      tab.classList.toggle("is-on", on);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    for (const panel of root.querySelectorAll("[data-tab-panel]")) panel.hidden = panel.dataset.tabPanel !== key;
    if (updateHash && location.hash !== `#${key}`) history.replaceState(history.state, "", `${location.pathname}${location.search}#${key}`);
  }

  // ---- Drawers ------------------------------------------------------------
  // One open drawer at a time. YRDialog.trap (when loaded) handles focus
  // containment and Escape; the fallback listener only handles Escape.
  let openDrawer = null;

  function closeDrawer() {
    if (!openDrawer) return;
    const { el, release } = openDrawer;
    openDrawer = null;
    el.hidden = true;
    document.body.classList.remove("act-drawer-open");
    release?.();
  }

  function showDrawer(id) {
    const el = $(id);
    if (!el) return;
    if (openDrawer?.el === el) return;
    closeDrawer();
    el.hidden = false;
    document.body.classList.add("act-drawer-open");
    const panel = el.querySelector(".v3-drawer-panel") || el;
    let release;
    if (window.YRDialog?.trap) {
      release = window.YRDialog.trap(panel, closeDrawer);
    } else {
      const onKey = (event) => { if (event.key === "Escape") closeDrawer(); };
      document.addEventListener("keydown", onKey);
      release = () => document.removeEventListener("keydown", onKey);
      panel.querySelector("input, select, textarea, button")?.focus();
    }
    openDrawer = { el, release };
  }

  function openCreateDrawer() {
    setStatus("act-form-status", "");
    showDrawer("act-create-drawer");
    $("act-drop-code")?.focus();
  }

  // ---- Drop rows ----------------------------------------------------------
  function liveRowHtml(activity) {
    const claimed = Number(activity.progress?.claimed) || 0;
    const capacity = Number(activity.progress?.capacity) || 0;
    const credits = Number(activity.reward?.creditsPerClaim) || 0;
    const pct = capacity ? Math.min(100, Math.round((claimed / capacity) * 100)) : 0;
    return `<li class="act-drop" data-activity-id="${esc(activity.id)}">
      <div class="act-drop__code"><code>${esc(activity.title)}</code><span class="act-drop__since">Since ${esc(formatDate(activity.createdAt))}</span></div>
      <div class="act-drop__fact"><span>Per claim</span><strong>${credits.toLocaleString()} cr</strong></div>
      <div class="act-drop__fact act-drop__claims"><span>Claimed</span><strong>${claimed.toLocaleString()} / ${capacity.toLocaleString()}</strong><span class="act-meter" aria-hidden="true"><span style="width:${pct}%"></span></span></div>
      <div class="act-drop__fact"><span>Expiry</span><strong>${esc(expiryLabel(activity.endsAt))}</strong></div>
      <div class="act-drop__state">${badge(activity.stateLabel, dropTone(activity), activity.state)}</div>
      <div class="act-drop__actions">${activity.actions?.canEnd ? action({ label: "End now", size: "xs", attrs: `data-activity-end="${esc(activity.id)}" aria-label="End ${esc(activity.title)} now"` }) : ""}</div>
    </li>`;
  }

  function historyRowHtml(activity) {
    const claimed = Number(activity.progress?.claimed) || 0;
    const capacity = Number(activity.progress?.capacity) || 0;
    const credits = Number(activity.reward?.creditsPerClaim) || 0;
    return `<li class="act-drop act-drop--past" data-activity-id="${esc(activity.id)}">
      <div class="act-drop__code"><code>${esc(activity.title)}</code><span class="act-drop__since">${esc(formatDate(activity.createdAt))}</span></div>
      <div class="act-drop__fact"><span>Per claim</span><strong>${credits.toLocaleString()} cr</strong></div>
      <div class="act-drop__fact act-drop__claims"><span>Claimed</span><strong>${claimed.toLocaleString()} / ${capacity.toLocaleString()}</strong></div>
      <div class="act-drop__fact"><span>Ended</span><strong>${esc(activity.endsAt ? formatDate(activity.endsAt) : "—")}</strong></div>
      <div class="act-drop__state">${badge(activity.stateLabel, dropTone(activity), activity.state)}</div>
    </li>`;
  }

  // Each list region shows exactly one of: loading, rows, empty, error.
  function showListState(key, state, message = "") {
    const map = { loading: `act-${key}-loading`, rows: `act-${key}-list`, empty: `act-${key}-empty`, error: `act-${key}-error` };
    for (const [name, id] of Object.entries(map)) {
      const el = $(id);
      if (el) el.hidden = name !== state;
    }
    if (state === "error") {
      const error = $(`act-${key}-error`);
      const body = error?.querySelector("p");
      if (body) body.textContent = message || "Try again.";
      else if (error) error.querySelector("h2")?.insertAdjacentHTML("afterend", `<p>${esc(message || "Try again.")}</p>`);
    }
  }

  function renderLive(rows) {
    liveRows = Array.isArray(rows) ? rows : [];
    const list = $("act-live-list");
    const shell = $("act-live");
    if (!list) return;
    const heading = shell?.querySelector(".v3-list-shell-copy h2");
    if (heading) heading.textContent = liveRows.length ? `Live now · ${liveRows.length}` : "Live now";
    if (!liveRows.length) {
      list.replaceChildren();
      showListState("live", "empty");
      return;
    }
    list.innerHTML = liveRows.map(liveRowHtml).join("");
    showListState("live", "rows");
  }

  // ---- History pagination ----------------------------------------------------
  function renderPageSizeOptions() {
    const select = $("act-pager-size");
    if (!select) return;
    if (!select.options.length) {
      select.innerHTML = PAGE_SIZE_OPTIONS.map((size) => `<option value="${size}">${size}</option>`).join("");
    }
    select.value = String(activityPaging.pages.pageSize);
    select.setAttribute("aria-label", "History rows per page");
  }

  function renderPageNumbers(totalPages) {
    const holder = $("act-pager-pages");
    if (!holder) return;
    holder.innerHTML = pageWindow(activityPaging.page, totalPages)
      .map((entry) => {
        if (entry === "gap") return '<li class="act-pager__gap" aria-hidden="true">…</li>';
        const current = entry === activityPaging.page;
        return `<li><button class="act-pager__page${current ? " is-current" : ""}" type="button" data-pager-page="${entry}"${current ? ' aria-current="page"' : ""} aria-label="Page ${entry}">${entry}</button></li>`;
      })
      .join("");
  }

  // The pager exists only when there is more than one page to move between:
  // a single page of history needs no controls at all.
  function renderPager() {
    const pager = $("act-pager");
    if (!pager) return;
    const { pages } = activityPaging;
    const total = pages.total;
    const totalPages = pages.reachableCount();
    activityPaging.page = pages.clamp(activityPaging.page);

    pager.hidden = total === 0 || (totalPages <= 1 && total <= pages.pageSize);
    if (pager.hidden) return;

    const range = $("act-pager-range");
    if (range) range.textContent = rangeLabel(total, activityPaging.page, pages.pageSize);
    renderPageSizeOptions();
    renderPageNumbers(totalPages);
    const previous = $("act-pager-prev");
    const next = $("act-pager-next");
    if (previous) previous.disabled = activityPaging.pageLoading || activityPaging.page <= 1;
    if (next) next.disabled = activityPaging.pageLoading || activityPaging.page >= totalPages;
  }

  function renderHistoryRows() {
    const list = $("act-history-list");
    if (!list) return;
    const rows = activityPaging.pages.rows(activityPaging.page);
    if (!rows.length) {
      list.replaceChildren();
      showListState("history", "empty");
      return;
    }
    list.innerHTML = rows.map(historyRowHtml).join("");
    showListState("history", "rows");
  }

  function activitiesQuery(state, limit, cursor) {
    const query = new URLSearchParams({ state, limit: String(limit) });
    if (cursor) query.set("cursor", cursor);
    const base = sitePath("/api/activities", activeSiteId);
    return `${base}${base.includes("?") ? "&" : "?"}${query}`;
  }

  // First page of a fresh history dataset: every cached page is invalidated
  // and the viewer lands on the start of the new list.
  function renderHistory(data) {
    const next = Array.isArray(data?.activities) ? data.activities : [];
    activityPaging.pages.reset();
    activityPaging.pages.store(1, next, data?.page, data?.total ?? next.length);
    activityPaging.page = 1;
    renderHistoryRows();
    renderPager();
  }

  async function goToPage(target, token = lifecycleToken) {
    const { pages } = activityPaging;
    const next = pages.clamp(target);
    if (next === activityPaging.page || activityPaging.pageLoading) return false;
    if (pages.isLoaded(next)) {
      activityPaging.page = next;
      return true;
    }
    const cursor = pages.cursorFor(next);
    if (cursor === undefined) return false;
    activityPaging.pageLoading = true;
    renderPager();
    try {
      const data = await api(activitiesQuery("completed", pages.pageSize, cursor));
      if (token !== lifecycleToken) return false;
      pages.store(next, Array.isArray(data.activities) ? data.activities : [], data.page, data.total);
      activityPaging.page = next;
      return true;
    } catch (error) {
      if (token !== lifecycleToken) return false;
      // A stale cursor (410) means the list changed underneath us: reload from
      // the first page rather than showing a page that no longer exists.
      if (error?.status === 410) { await loadHistory(token); return false; }
      feedback(error?.message || "Older drops could not be loaded.", true);
      return false;
    } finally {
      if (token === lifecycleToken) { activityPaging.pageLoading = false; renderPager(); }
    }
  }

  function repaintHistory() {
    renderHistoryRows();
    renderPager();
    const panel = $("act-history");
    if (panel && typeof panel.scrollIntoView === "function" && document.documentElement?.scrollHeight > window.innerHeight) {
      panel.scrollIntoView({ block: "nearest" });
    }
  }

  // ---- Loading ------------------------------------------------------------
  // Live, History, and Automation load independently: a failure in one shows
  // that region's error state and leaves the others usable. Automation rides
  // on the first live page (the API attaches it to any first page) so the
  // page costs two requests, not three.
  async function loadLive(token = lifecycleToken) {
    showListState("live", "loading");
    try {
      const data = await api(activitiesQuery("open", LIVE_LIMIT, null));
      if (token !== lifecycleToken) return;
      renderLive(data.activities);
      if (data.automation) renderAutomation(data.automation);
    } catch (error) {
      if (token !== lifecycleToken) return;
      showListState("live", "error", error?.message);
      if (!automationLoaded) showAutomationError(error?.message);
    }
  }

  async function loadHistory(token = lifecycleToken) {
    showListState("history", "loading");
    $("act-pager")?.setAttribute("hidden", "");
    try {
      const data = await api(activitiesQuery("completed", activityPaging.pages.pageSize, null));
      if (token !== lifecycleToken) return;
      renderHistory(data);
    } catch (error) {
      if (token !== lifecycleToken) return;
      showListState("history", "error", error?.message);
    }
  }

  function loadAll(token = lifecycleToken) {
    return Promise.all([loadLive(token), loadHistory(token)]);
  }

  // Creator ends an open drop. The server row is authoritative: the returned
  // activity replaces the cached one whether the close happened now, already
  // happened (idempotent), or the drop had ended on its own (409 + activity).
  async function endActivity(id, token = lifecycleToken) {
    const current = liveRows.find((row) => row.id === id);
    if (!current) return false;
    const confirmed = window.YRDialog?.confirm
      ? await window.YRDialog.confirm({
          title: `End "${current.title}" now?`,
          body: "Members can no longer claim it. Existing claims are kept.",
          confirmText: "End now",
          danger: true,
        })
      : window.confirm(`End "${current.title}" now? Members can no longer claim it; existing claims are kept.`);
    if (!confirmed) return false;
    const button = document.querySelector(`[data-activity-end="${id}"]`);
    if (button) button.disabled = true;
    try {
      const body = await api(sitePath("/api/activities/close", activeSiteId), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: activeSiteId, activityId: id }),
      });
      if (token !== lifecycleToken) return false;
      feedback(body.changed ? `Ended ${current.title}.` : "That drop had already ended.");
      await loadAll(token);
      return true;
    } catch (error) {
      if (token !== lifecycleToken) return false;
      if (error?.status === 409 || error?.status === 404) await loadAll(token);
      feedback(error?.message || "The drop could not be ended.", true);
      if (button) button.disabled = false;
      return false;
    }
  }

  async function submitDrop(event) {
    event.preventDefault();
    const button = $("act-drop-submit");
    if (button) button.disabled = true;
    setStatus("act-form-status", "Launching drop…");
    const code = $("act-drop-code")?.value || "";
    try {
      await api(sitePath("/api/events/drops", activeSiteId), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: activeSiteId, code, pointsReward: Number($("act-drop-points")?.value || 0), maxClaims: Number($("act-drop-max")?.value || 0), expireMinutes: Number($("act-drop-expire")?.value || 0) }),
      });
      $("act-drop-form")?.reset();
      setStatus("act-form-status", "");
      closeDrawer();
      feedback(`Drop ${code.trim().toUpperCase()} is live.`);
      await loadAll();
    } catch (error) {
      setStatus("act-form-status", error?.message || "The drop could not be launched.", true);
    } finally { if (button) button.disabled = false; }
  }

  // ---- Automation ---------------------------------------------------------
  function templateRowHtml(template) {
    const config = template.config || {};
    const summary = `${Number(config.pointsReward || 0).toLocaleString()} cr · ${Number(config.maxClaims || 0).toLocaleString()} claims · ${config.expireMinutes ? `${Number(config.expireMinutes).toLocaleString()} min` : "No time limit"}`;
    return `<li class="act-item" data-template-id="${esc(template.id)}">
      <div class="act-item__copy"><strong>${esc(template.name)}</strong><span>${esc(summary)}</span></div>
      <div class="act-item__actions">${action({ label: "Edit", size: "xs", attrs: `data-template-edit="${esc(template.id)}"` })}${action({ label: "Delete", size: "xs", attrs: `data-template-delete="${esc(template.id)}" aria-label="Delete ${esc(template.name)}"` })}</div>
    </li>`;
  }

  function renderTemplates() {
    const list = $("act-template-list");
    const empty = $("act-template-empty");
    if (!list || !empty) return;
    const templates = Array.isArray(automation.templates) ? automation.templates : [];
    empty.hidden = templates.length > 0;
    list.hidden = templates.length === 0;
    list.innerHTML = templates.map(templateRowHtml).join("");
    const select = $("act-schedule-template");
    if (select) {
      const previous = select.value;
      select.innerHTML = templates.length
        ? templates.map((template) => `<option value="${esc(template.id)}">${esc(template.name)}</option>`).join("")
        : '<option value="">Create a template first</option>';
      if (templates.some((template) => template.id === previous)) select.value = previous;
    }
  }

  function scheduleRowHtml(schedule) {
    const cancellable = ["scheduled", "paused", "failed"].includes(schedule.status);
    const resumable = ["paused", "failed"].includes(schedule.status) && automation.entitlement?.canAutomate;
    const attention = ["paused", "failed"].includes(schedule.status);
    return `<li class="act-item act-item--schedule${attention ? " is-attention" : ""}" data-schedule-id="${esc(schedule.id)}">
      <div class="act-item__copy"><strong>${esc(schedule.templateName)}</strong><span>${esc(recurrenceLabel(schedule.recurrence))} · ${esc(formatDate(schedule.nextRunAt))}</span>${schedule.attentionMessage ? `<small>${esc(schedule.attentionMessage)}</small>` : ""}</div>
      <div class="act-item__state">${badge(schedule.status, scheduleTone(schedule.status), schedule.status)}</div>
      <div class="act-item__actions">${resumable ? action({ label: "Reschedule", variant: "primary", size: "xs", attrs: `data-schedule-resume="${esc(schedule.id)}"` }) : ""}${cancellable ? action({ label: "Cancel", size: "xs", attrs: `data-schedule-cancel="${esc(schedule.id)}" aria-label="Cancel schedule ${esc(schedule.templateName)}"` }) : ""}</div>
    </li>`;
  }

  // Groups in priority order: needs attention (paused/failed), upcoming
  // (scheduled), then everything else (cancelled, and any status the server
  // adds later). Empty groups are not drawn.
  function renderSchedules() {
    const list = $("act-schedule-list");
    const empty = $("act-schedule-empty");
    if (!list || !empty) return;
    const schedules = Array.isArray(automation.schedules) ? automation.schedules : [];
    empty.hidden = schedules.length > 0;
    list.hidden = schedules.length === 0;
    const groups = [
      ["attention", "Needs attention", schedules.filter((s) => s.status === "paused" || s.status === "failed")],
      ["upcoming", "Upcoming", schedules.filter((s) => s.status === "scheduled")],
      ["past", "Past", schedules.filter((s) => !["paused", "failed", "scheduled"].includes(s.status))],
    ];
    list.innerHTML = groups
      .filter(([, , rows]) => rows.length)
      .map(([key, title, rows]) => `<section class="act-schedule-group" data-group="${key}"><h3>${title} <span>${rows.length}</span></h3><ol class="act-rows act-rows--compact">${rows.map(scheduleRowHtml).join("")}</ol></section>`)
      .join("");
  }

  function showAutomationError(message) {
    const loading = $("act-automation-loading");
    if (loading) loading.hidden = true;
    const gate = $("act-automation-gate");
    if (gate) gate.hidden = true;
    const body = $("act-automation");
    if (body) body.hidden = true;
    feedback(message || "Automation could not load.", true);
  }

  // Free: one compact locked state, no disabled controls behind it. Pro/Team:
  // the template and schedule lists with their primary actions.
  function renderAutomation(next) {
    automation = next || { templates: [], schedules: [], entitlement: { canAutomate: false } };
    automationLoaded = true;
    const loading = $("act-automation-loading");
    if (loading) loading.hidden = true;
    const canAutomate = automation.entitlement?.canAutomate === true;
    const gate = $("act-automation-gate");
    if (gate) {
      gate.hidden = canAutomate;
      const copy = $("act-automation-gate-copy");
      if (copy) copy.textContent = automation.entitlement?.message || "Manual code drops remain available.";
      if (!canAutomate) wirePlanLock(gate, "activity_automation");
    }
    const body = $("act-automation");
    if (body) body.hidden = !canAutomate;
    if (!canAutomate) return;
    if ($("act-schedule-new")) $("act-schedule-new").disabled = !automation.templates?.length;
    renderTemplates();
    renderSchedules();
  }

  function openTemplateForm(template = null) {
    if (!automation.entitlement?.canAutomate) return;
    $("act-template-id").value = template?.id || "";
    $("act-template-name").value = template?.name || "";
    $("act-template-points").value = String(template?.config?.pointsReward ?? 100);
    $("act-template-max").value = String(template?.config?.maxClaims ?? 50);
    $("act-template-expire").value = String(template?.config?.expireMinutes ?? 0);
    $("act-template-save").textContent = template ? "Save changes" : "Save template";
    const title = document.querySelector("#act-template-drawer-title");
    if (title) title.textContent = template ? "Edit template" : "New template";
    setStatus("act-template-status", "");
    showDrawer("act-template-drawer");
    $("act-template-name")?.focus();
  }

  async function submitTemplate(event) {
    event.preventDefault();
    const id = $("act-template-id")?.value || "";
    const button = $("act-template-save");
    if (button) button.disabled = true;
    setStatus("act-template-status", id ? "Saving changes…" : "Saving template…");
    try {
      await api(sitePath("/api/activities/templates", activeSiteId), {
        method: id ? "PUT" : "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: activeSiteId, templateId: id || undefined, kind: "safe_code_drop", name: $("act-template-name")?.value || "", config: { pointsReward: Number($("act-template-points")?.value), maxClaims: Number($("act-template-max")?.value), expireMinutes: Number($("act-template-expire")?.value) } }),
      });
      closeDrawer();
      feedback(id ? "Template updated." : "Template saved.");
      await loadLive();
    } catch (error) { setStatus("act-template-status", error?.message || "The template could not be saved.", true); }
    finally { if (button) button.disabled = false; }
  }

  async function deleteTemplate(id) {
    const template = automation.templates?.find((item) => item.id === id);
    if (!template) return;
    const confirmed = window.YRDialog?.confirm
      ? await window.YRDialog.confirm({
          title: `Delete "${template.name}"?`,
          body: "Existing schedules keep their saved snapshot.",
          confirmText: "Delete",
          danger: true,
        })
      : window.confirm(`Delete "${template.name}"? Existing schedules keep their saved snapshot.`);
    if (!confirmed) return;
    // Optimistic removal — drop the row immediately, restore it if the server
    // rejects the delete. The authoritative reload follows success.
    const snapshot = automation.templates.slice();
    automation.templates = automation.templates.filter((item) => item.id !== id);
    renderAutomation({ ...automation });
    try {
      await api(sitePath("/api/activities/templates/delete", activeSiteId), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteId: activeSiteId, templateId: id }) });
      feedback(`Deleted ${template.name}.`);
      await loadLive();
    } catch (error) {
      automation.templates = snapshot;
      renderAutomation({ ...automation });
      feedback(error?.message || "The template could not be deleted.", true);
    }
  }

  function localInputValue(date) {
    const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return shifted.toISOString().slice(0, 16);
  }

  function openScheduleForm(resumeId = "") {
    if (!automation.entitlement?.canAutomate) return;
    if (!resumeId && !automation.templates?.length) {
      feedback("Create a template before scheduling.", true);
      return;
    }
    $("act-resume-id").value = resumeId;
    $("act-schedule-template-field").hidden = Boolean(resumeId);
    $("act-schedule-recurrence-field").hidden = Boolean(resumeId);
    $("act-schedule-at").value = localInputValue(new Date(Date.now() + 10 * 60_000));
    $("act-schedule-save").textContent = resumeId ? "Set new future time" : "Schedule Activity";
    const title = document.querySelector("#act-schedule-drawer-title");
    if (title) title.textContent = resumeId ? "Reschedule" : "Schedule an Activity";
    setStatus("act-schedule-status", "");
    showDrawer("act-schedule-drawer");
    $("act-schedule-at")?.focus();
  }

  async function submitSchedule(event) {
    event.preventDefault();
    const resumeId = $("act-resume-id")?.value || "";
    const local = new Date($("act-schedule-at")?.value || "");
    if (Number.isNaN(local.getTime())) return setStatus("act-schedule-status", "Choose a valid future date and time.", true);
    const button = $("act-schedule-save");
    if (button) button.disabled = true;
    setStatus("act-schedule-status", resumeId ? "Rescheduling…" : "Scheduling…");
    try {
      await api(sitePath(resumeId ? "/api/activities/schedules/resume" : "/api/activities/schedules", activeSiteId), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: activeSiteId, scheduleId: resumeId || undefined, templateId: resumeId ? undefined : $("act-schedule-template")?.value, recurrence: resumeId ? undefined : $("act-schedule-recurrence")?.value, runAt: local.toISOString() }),
      });
      closeDrawer();
      feedback(resumeId ? "Schedule updated." : "Activity scheduled.");
      await loadLive();
    } catch (error) { setStatus("act-schedule-status", error?.message || "The Activity could not be scheduled.", true); }
    finally { if (button) button.disabled = false; }
  }

  async function cancelSchedule(id) {
    const schedule = automation.schedules?.find((item) => item.id === id);
    if (!schedule) return;
    const confirmed = window.YRDialog?.confirm
      ? await window.YRDialog.confirm({
          title: `Cancel "${schedule.templateName}"?`,
          body: "No future Activity will be created from this schedule.",
          confirmText: "Cancel Schedule",
          danger: true,
        })
      : window.confirm(`Cancel "${schedule.templateName}"? No future Activity will be created from this schedule.`);
    if (!confirmed) return;
    // Optimistic removal — hide the schedule immediately, restore it if the
    // server rejects. The authoritative reload follows.
    const snapshot = automation.schedules.slice();
    automation.schedules = automation.schedules.filter((item) => item.id !== id);
    renderAutomation({ ...automation });
    try {
      await api(sitePath("/api/activities/schedules/cancel", activeSiteId), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteId: activeSiteId, scheduleId: id }) });
      feedback("Schedule cancelled.");
      await loadLive();
    } catch (error) {
      automation.schedules = snapshot;
      renderAutomation({ ...automation });
      feedback(error?.message || "The schedule could not be cancelled.", true);
    }
  }

  // ---- Wiring -------------------------------------------------------------
  // Listeners attach once per fragment: the guard is on the fragment root, so
  // a SPA re-entry into a fresh fragment wires again while the same fragment
  // never gets a second set.
  function wire() {
    const root = $("act-app");
    if (!root || root.dataset.wired === "true") return;
    root.dataset.wired = "true";
    $("act-drop-form")?.addEventListener("submit", submitDrop);
    $("act-template-form")?.addEventListener("submit", submitTemplate);
    $("act-schedule-form")?.addEventListener("submit", submitSchedule);
    // Changing the page size is a dataset-view change: history is re-fetched
    // at the new size from page 1.
    $("act-pager-size")?.addEventListener("change", (event) => {
      activityPaging.pages.reset(normalizePageSize(event.target?.value));
      activityPaging.page = 1;
      loadHistory();
    });
    root.addEventListener("click", (event) => {
      const tab = event.target.closest(".act-tabs [data-subnav]");
      if (tab) {
        event.preventDefault();
        setTab(tab.dataset.subnav);
        return;
      }
      if (event.target.closest("[data-drawer-close]")) {
        event.preventDefault();
        closeDrawer();
        return;
      }
      const opener = event.target.closest("[data-drawer-open]");
      if (opener) {
        const id = opener.dataset.drawerOpen;
        if (id === "act-create-drawer") openCreateDrawer();
        else if (id === "act-template-drawer") openTemplateForm();
        else if (id === "act-schedule-drawer") openScheduleForm();
        return;
      }
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.retry === "live") return void loadLive();
      if (button.dataset.retry === "history") return void loadHistory();
      if (button.dataset.pagerStep) {
        goToPage(activityPaging.page + Number(button.dataset.pagerStep)).then((moved) => { if (moved) repaintHistory(); });
        return;
      }
      if (button.dataset.pagerPage) {
        goToPage(Number(button.dataset.pagerPage)).then((moved) => { if (moved) repaintHistory(); });
        return;
      }
      if (button.dataset.activityEnd) return void endActivity(button.dataset.activityEnd);
      if (button.dataset.templateEdit) openTemplateForm(automation.templates.find((item) => item.id === button.dataset.templateEdit));
      if (button.dataset.templateDelete) deleteTemplate(button.dataset.templateDelete);
      if (button.dataset.scheduleCancel) cancelSchedule(button.dataset.scheduleCancel);
      if (button.dataset.scheduleResume) openScheduleForm(button.dataset.scheduleResume);
    });
    // Arrow keys move between tabs (WAI-ARIA tabs pattern, automatic activation).
    root.querySelector(".act-tabs")?.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const index = TABS.indexOf(currentTab());
      const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
      event.preventDefault();
      setTab(next);
      root.querySelector(`.act-tabs [data-subnav="${next}"]`)?.focus();
    });
  }

  function stampScope(shell) {
    const scope = $("act-scope");
    if (!scope) return;
    scope.querySelector(".v3-scope-name")?.remove();
    const name = shell?.board?.name || shell?.board?.slug || "";
    if (!name) return;
    const el = document.createElement("span");
    el.className = "v3-scope-name";
    el.textContent = name;
    scope.appendChild(el);
  }

  async function activitiesEnter() {
    const token = ++lifecycleToken;
    wire();
    setTab(location.hash.replace(/^#/, ""), { updateHash: false });
    try {
      const shell = await loadBoardShell();
      if (token !== lifecycleToken) return;
      activeSiteId = shell.activeSiteId || "";
      stampScope(shell);
      preserveSiteContextLinks(activeSiteId);
      await loadAll(token);
      window.__yrBoot?.signal();
    } catch (error) {
      if (token !== lifecycleToken) return;
      showListState("live", "error", error?.message || "The dashboard shell could not be loaded.");
      showListState("history", "error", error?.message || "The dashboard shell could not be loaded.");
      showAutomationError(error?.message);
      window.__yrBoot?.signal();
    }
  }

  function activitiesLeave() {
    lifecycleToken += 1;
    activeSiteId = "";
    closeDrawer();
    liveRows = [];
    automation = { templates: [], schedules: [], entitlement: { canAutomate: false } };
    automationLoaded = false;
    // Drop the cached pages so switching boards cannot briefly page through the
    // previous board's history. `pageSize` is a UI preference and is kept.
    activityPaging.pages.reset();
    activityPaging.page = 1;
    activityPaging.pageLoading = false;
  }
  _activitiesEnter = activitiesEnter;
  _activitiesLeave = activitiesLeave;
  if (!window.__yrSpaShell) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", activitiesEnter, { once: true });
    else activitiesEnter();
  }
})();
