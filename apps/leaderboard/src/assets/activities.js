import { loadBoardShell, preserveSiteContextLinks, sitePath } from "./dashboard/board-shell.js";
import { fetchDashboardJson, loginRedirectPath } from "./dashboard/request.js";
import { clearSession } from "./dashboard/session.js";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[char]));
const csrf = () => document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] || "";

let activeSiteId = "";
let lifecycleToken = 0;
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
  function setCreateOpen(open) {
    const panel = $("act-create-panel");
    const toggle = $("act-create-toggle");
    if (!panel || !toggle) return;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) $("act-drop-code")?.focus();
  }

  function showFormStatus(message, error = false) {
    const status = $("act-form-status");
    if (!status) return;
    status.hidden = !message;
    status.textContent = message;
    status.className = error ? "status error act-form-status" : "status act-form-status";
  }

  function formatDate(value) {
    if (!value) return "No time limit";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
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
        <div class="act-row__title"><strong>${esc(activity.title)}</strong><span>Free ${esc(activity.typeLabel || "activity")} · Created ${esc(formatDate(activity.createdAt))}</span></div>
        <div class="act-row__fact act-row__reward"><span>Member reward</span><strong>${credits.toLocaleString()} credits</strong></div>
        <div class="act-row__fact act-row__progress"><span>Claims</span><strong>${claimed.toLocaleString()} of ${capacity.toLocaleString()}</strong></div>
        <div class="act-row__fact act-row__end"><span>Ends</span><strong>${esc(formatDate(activity.endsAt))}</strong></div>
        <span class="act-state act-state--${state}">${esc(activity.stateLabel)}</span>
      </article>`;
    }).join("");
  }

  function showLoadError(message) {
    $("act-loading")?.setAttribute("hidden", "");
    $("act-list")?.setAttribute("hidden", "");
    $("act-empty")?.setAttribute("hidden", "");
    const error = $("act-error");
    if (error) error.hidden = false;
    const text = $("act-error-message");
    if (text) text.textContent = message || "Try again.";
    const count = $("act-count");
    if (count) count.textContent = "—";
  }

  async function api(path, init = {}) {
    const method = String(init.method || "GET").toUpperCase();
    const headers = new Headers(init.headers || {});
    if (!new Set(["GET", "HEAD", "OPTIONS"]).has(method)) {
      headers.set("x-csrf-token", csrf());
    }
    try {
      const { body } = await fetchDashboardJson(path, {
        ...init,
        credentials: "same-origin",
        headers,
      });
      return body;
    } catch (error) {
      if (error?.code === "AUTH") location.href = loginRedirectPath(location);
      throw error;
    }
  }

  async function loadActivities(token = lifecycleToken) {
    const loading = $("act-loading");
    if (loading) loading.hidden = false;
    try {
      const data = await api(sitePath("/api/activities", activeSiteId));
      if (token !== lifecycleToken) return;
      renderActivities(Array.isArray(data.activities) ? data.activities : []);
    } catch (error) {
      if (token !== lifecycleToken) return;
      showLoadError(error?.message || "Try again.");
    }
  }

  async function submitDrop(event) {
    event.preventDefault();
    const button = $("act-drop-submit");
    if (button) button.disabled = true;
    showFormStatus("Launching drop…");
    try {
      await api(sitePath("/api/events/drops", activeSiteId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteId: activeSiteId,
          code: $("act-drop-code")?.value || "",
          pointsReward: Number($("act-drop-points")?.value || 0),
          maxClaims: Number($("act-drop-max")?.value || 0),
          expireMinutes: Number($("act-drop-expire")?.value || 0),
        }),
      });
      $("act-drop-form")?.reset();
      showFormStatus("Drop launched.");
      setCreateOpen(false);
      await loadActivities();
    } catch (error) {
      showFormStatus(error?.message || "The drop could not be launched.", true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function wire() {
    $("act-create-toggle")?.addEventListener("click", () => setCreateOpen(true));
    $("act-empty-create")?.addEventListener("click", () => setCreateOpen(true));
    $("act-create-close")?.addEventListener("click", () => setCreateOpen(false));
    $("act-drop-cancel")?.addEventListener("click", () => setCreateOpen(false));
    $("act-retry")?.addEventListener("click", () => loadActivities());
    $("act-drop-form")?.addEventListener("submit", submitDrop);
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

  function activitiesLeave() {
    lifecycleToken += 1;
    activeSiteId = "";
  }

  _activitiesEnter = activitiesEnter;
  _activitiesLeave = activitiesLeave;

  if (!window.__yrSpaShell) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", activitiesEnter, { once: true });
    } else {
      activitiesEnter();
    }
  }
})();
