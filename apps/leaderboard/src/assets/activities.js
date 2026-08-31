import { loadBoardShell, preserveSiteContextLinks, sitePath } from "./dashboard/board-shell.js";
import { fetchDashboardJson, loginRedirectPath } from "./dashboard/request.js";
import { clearSession } from "./dashboard/session.js";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));
const csrf = () => document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] || "";

let activeSiteId = "";
let lifecycleToken = 0;
let automation = { templates: [], schedules: [], entitlement: { canAutomate: false } };
let _activitiesEnter = null;
let _activitiesLeave = null;

export function enter() { _activitiesEnter?.(); }
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
  function formatDate(value) {
    if (!value) return "No time limit";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function recurrenceLabel(value) {
    return value === "daily" ? "Every 24 hours (UTC)" : value === "weekly" ? "Every 7 days (UTC)" : "One time";
  }

  function setCreateOpen(open) {
    const panel = $("act-create-panel");
    const toggle = $("act-create-toggle");
    if (!panel || !toggle) return;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) $("act-drop-code")?.focus();
  }

  function setStatus(id, message, error = false) {
    const status = $(id);
    if (!status) return;
    status.hidden = !message;
    status.textContent = message;
    status.className = error ? "status error act-form-status" : "status act-form-status";
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

  function renderActivities(activities) {
    const list = $("act-list");
    const empty = $("act-empty");
    const loading = $("act-loading");
    const error = $("act-error");
    const count = $("act-count");
    if (!list || !empty || !loading || !error || !count) return;
    loading.hidden = true;
    error.hidden = true;
    count.textContent = String(activities.length);
    if (!activities.length) {
      list.hidden = true;
      list.replaceChildren();
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.hidden = false;
    list.innerHTML = activities.map((activity) => {
      const claimed = Number(activity.progress?.claimed) || 0;
      const capacity = Number(activity.progress?.capacity) || 0;
      const credits = Number(activity.reward?.creditsPerClaim) || 0;
      const state = activity.state === "open" ? "open" : "completed";
      return `<article class="act-row">
        <div class="act-row__title"><strong>${esc(activity.title)}</strong><span>Free ${esc(activity.typeLabel || "Activity")} · Created ${esc(formatDate(activity.createdAt))}</span></div>
        <div class="act-row__fact act-row__reward"><span>Member reward</span><strong>${credits.toLocaleString()} credits</strong></div>
        <div class="act-row__fact act-row__progress"><span>Claims</span><strong>${claimed.toLocaleString()} of ${capacity.toLocaleString()}</strong></div>
        <div class="act-row__fact act-row__end"><span>Ends</span><strong>${esc(formatDate(activity.endsAt))}</strong></div>
        <span class="act-state act-state--${state}">${esc(activity.stateLabel)}</span>
      </article>`;
    }).join("");
  }

  function renderTemplates() {
    const list = $("act-template-list");
    const empty = $("act-template-empty");
    if (!list || !empty) return;
    const templates = Array.isArray(automation.templates) ? automation.templates : [];
    empty.hidden = templates.length > 0;
    list.hidden = templates.length === 0;
    list.innerHTML = templates.map((template) => `<article class="act-compact-row">
      <div><strong>${esc(template.name)}</strong><span>${Number(template.config?.pointsReward || 0).toLocaleString()} credits · ${Number(template.config?.maxClaims || 0).toLocaleString()} claims · ${template.config?.expireMinutes ? `${Number(template.config.expireMinutes).toLocaleString()} min` : "No time limit"}</span></div>
      <div class="act-row-actions"><button class="btn btn--sm" type="button" data-template-edit="${esc(template.id)}">Edit</button><button class="btn btn--sm act-destructive" type="button" data-template-delete="${esc(template.id)}">Delete</button></div>
    </article>`).join("");
    const select = $("act-schedule-template");
    if (select) {
      const previous = select.value;
      select.innerHTML = templates.length
        ? templates.map((template) => `<option value="${esc(template.id)}">${esc(template.name)}</option>`).join("")
        : '<option value="">Create a template first</option>';
      if (templates.some((template) => template.id === previous)) select.value = previous;
    }
  }

  function renderSchedules() {
    const list = $("act-schedule-list");
    const empty = $("act-schedule-empty");
    if (!list || !empty) return;
    const schedules = Array.isArray(automation.schedules) ? automation.schedules : [];
    empty.hidden = schedules.length > 0;
    list.hidden = schedules.length === 0;
    list.innerHTML = schedules.map((schedule) => {
      const cancellable = ["scheduled", "paused", "failed"].includes(schedule.status);
      const resumable = ["paused", "failed"].includes(schedule.status) && automation.entitlement?.canAutomate;
      const statusClass = ["paused", "failed"].includes(schedule.status) ? "attention" : schedule.status;
      return `<article class="act-compact-row act-schedule-row">
        <div><strong>${esc(schedule.templateName)}</strong><span>${esc(recurrenceLabel(schedule.recurrence))} · ${esc(formatDate(schedule.nextRunAt))}</span>${schedule.attentionMessage ? `<small>${esc(schedule.attentionMessage)}</small>` : ""}</div>
        <div class="act-schedule-action"><span class="act-state act-state--${esc(statusClass)}">${esc(schedule.status)}</span><div class="act-row-actions">${resumable ? `<button class="btn btn--sm" type="button" data-schedule-resume="${esc(schedule.id)}">Reschedule</button>` : ""}${cancellable ? `<button class="btn btn--sm act-destructive" type="button" data-schedule-cancel="${esc(schedule.id)}">Cancel</button>` : ""}</div></div>
      </article>`;
    }).join("");
  }

  function renderAutomation(next) {
    automation = next || { templates: [], schedules: [], entitlement: { canAutomate: false } };
    const canAutomate = automation.entitlement?.canAutomate === true;
    const entitlement = $("act-entitlement");
    if (entitlement) {
      entitlement.textContent = canAutomate ? `${automation.entitlement.plan === "team" ? "Team" : "Pro"} automation` : "Manual only";
      entitlement.dataset.state = canAutomate ? "available" : "locked";
    }
    if ($("act-automation-gate")) $("act-automation-gate").hidden = canAutomate;
    if ($("act-template-new")) $("act-template-new").disabled = !canAutomate;
    if ($("act-schedule-new")) $("act-schedule-new").disabled = !canAutomate || !automation.templates?.length;
    renderTemplates();
    renderSchedules();
  }

  function showLoadError(message) {
    $("act-loading")?.setAttribute("hidden", "");
    $("act-list")?.setAttribute("hidden", "");
    $("act-empty")?.setAttribute("hidden", "");
    if ($("act-error")) $("act-error").hidden = false;
    if ($("act-error-message")) $("act-error-message").textContent = message || "Try again.";
    if ($("act-count")) $("act-count").textContent = "—";
  }

  async function loadActivities(token = lifecycleToken) {
    if ($("act-loading")) $("act-loading").hidden = false;
    try {
      const data = await api(sitePath("/api/activities", activeSiteId));
      if (token !== lifecycleToken) return;
      renderActivities(Array.isArray(data.activities) ? data.activities : []);
      renderAutomation(data.automation);
    } catch (error) {
      if (token !== lifecycleToken) return;
      showLoadError(error?.message || "Try again.");
    }
  }

  async function submitDrop(event) {
    event.preventDefault();
    const button = $("act-drop-submit");
    if (button) button.disabled = true;
    setStatus("act-form-status", "Launching drop…");
    try {
      await api(sitePath("/api/events/drops", activeSiteId), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: activeSiteId, code: $("act-drop-code")?.value || "", pointsReward: Number($("act-drop-points")?.value || 0), maxClaims: Number($("act-drop-max")?.value || 0), expireMinutes: Number($("act-drop-expire")?.value || 0) }),
      });
      $("act-drop-form")?.reset();
      setCreateOpen(false);
      await loadActivities();
    } catch (error) {
      setStatus("act-form-status", error?.message || "The drop could not be launched.", true);
    } finally { if (button) button.disabled = false; }
  }

  function openTemplateForm(template = null) {
    const form = $("act-template-form");
    if (!form || !automation.entitlement?.canAutomate) return;
    form.hidden = false;
    $("act-template-id").value = template?.id || "";
    $("act-template-name").value = template?.name || "";
    $("act-template-points").value = String(template?.config?.pointsReward ?? 100);
    $("act-template-max").value = String(template?.config?.maxClaims ?? 50);
    $("act-template-expire").value = String(template?.config?.expireMinutes ?? 0);
    $("act-template-save").textContent = template ? "Save changes" : "Save template";
    setStatus("act-template-status", "");
    $("act-template-name")?.focus();
  }

  function closeTemplateForm() { if ($("act-template-form")) $("act-template-form").hidden = true; }

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
      closeTemplateForm();
      await loadActivities();
    } catch (error) { setStatus("act-template-status", error?.message || "The template could not be saved.", true); }
    finally { if (button) button.disabled = false; }
  }

  async function deleteTemplate(id) {
    const template = automation.templates?.find((item) => item.id === id);
    if (!template || !confirm(`Delete “${template.name}”? Existing schedules keep their saved snapshot.`)) return;
    try {
      await api(sitePath("/api/activities/templates/delete", activeSiteId), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteId: activeSiteId, templateId: id }) });
      await loadActivities();
    } catch (error) {
      setStatus("act-template-status", error?.message || "The template could not be deleted.", true);
      if ($("act-template-form")) $("act-template-form").hidden = false;
    }
  }

  function localInputValue(date) {
    const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return shifted.toISOString().slice(0, 16);
  }

  function openScheduleForm(resumeId = "") {
    const form = $("act-schedule-form");
    if (!form || !automation.entitlement?.canAutomate) return;
    form.hidden = false;
    $("act-resume-id").value = resumeId;
    $("act-schedule-template-field").hidden = Boolean(resumeId);
    $("act-schedule-recurrence-field").hidden = Boolean(resumeId);
    $("act-schedule-at").value = localInputValue(new Date(Date.now() + 10 * 60_000));
    $("act-schedule-save").textContent = resumeId ? "Set new future time" : "Schedule Activity";
    setStatus("act-schedule-status", "");
    $("act-schedule-at")?.focus();
  }

  function closeScheduleForm() { if ($("act-schedule-form")) $("act-schedule-form").hidden = true; }

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
      closeScheduleForm();
      await loadActivities();
    } catch (error) { setStatus("act-schedule-status", error?.message || "The Activity could not be scheduled.", true); }
    finally { if (button) button.disabled = false; }
  }

  async function cancelSchedule(id) {
    const schedule = automation.schedules?.find((item) => item.id === id);
    if (!schedule || !confirm(`Cancel “${schedule.templateName}”? No future Activity will be created from this schedule.`)) return;
    try {
      await api(sitePath("/api/activities/schedules/cancel", activeSiteId), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteId: activeSiteId, scheduleId: id }) });
      await loadActivities();
    } catch (error) {
      setStatus("act-schedule-status", error?.message || "The schedule could not be cancelled.", true);
      if ($("act-schedule-form")) $("act-schedule-form").hidden = false;
    }
  }

  function wire() {
    const root = document.querySelector(".act-workspace-content");
    if (!root || root.dataset.wired === "true") return;
    root.dataset.wired = "true";
    $("act-create-toggle")?.addEventListener("click", () => setCreateOpen(true));
    $("act-empty-create")?.addEventListener("click", () => setCreateOpen(true));
    $("act-create-close")?.addEventListener("click", () => setCreateOpen(false));
    $("act-drop-cancel")?.addEventListener("click", () => setCreateOpen(false));
    $("act-retry")?.addEventListener("click", () => loadActivities());
    $("act-drop-form")?.addEventListener("submit", submitDrop);
    $("act-template-new")?.addEventListener("click", () => openTemplateForm());
    $("act-template-form-cancel")?.addEventListener("click", closeTemplateForm);
    $("act-template-form")?.addEventListener("submit", submitTemplate);
    $("act-schedule-new")?.addEventListener("click", () => openScheduleForm());
    $("act-schedule-form-cancel")?.addEventListener("click", closeScheduleForm);
    $("act-schedule-form")?.addEventListener("submit", submitSchedule);
    root.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.templateEdit) openTemplateForm(automation.templates.find((item) => item.id === button.dataset.templateEdit));
      if (button.dataset.templateDelete) deleteTemplate(button.dataset.templateDelete);
      if (button.dataset.scheduleCancel) cancelSchedule(button.dataset.scheduleCancel);
      if (button.dataset.scheduleResume) openScheduleForm(button.dataset.scheduleResume);
    });
  }

  async function activitiesEnter() {
    const token = ++lifecycleToken;
    wire();
    try {
      const shell = await loadBoardShell();
      if (token !== lifecycleToken) return;
      activeSiteId = shell.activeSiteId || "";
      preserveSiteContextLinks(activeSiteId);
      await loadActivities(token);
      window.__yrBoot?.signal();
    } catch (error) {
      if (token !== lifecycleToken) return;
      showLoadError(error?.message || "The dashboard shell could not be loaded.");
      window.__yrBoot?.signal();
    }
  }

  function activitiesLeave() { lifecycleToken += 1; activeSiteId = ""; }
  _activitiesEnter = activitiesEnter;
  _activitiesLeave = activitiesLeave;
  if (!window.__yrSpaShell) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", activitiesEnter, { once: true });
    else activitiesEnter();
  }
})();
