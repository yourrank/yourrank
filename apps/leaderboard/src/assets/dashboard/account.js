// Account settings: password, sessions, data export.
import { $, getCsrf, logError, showConfirmModal } from "./utils.js";
import { loginRedirectPath } from "./request.js";
import { markDirty, setState, state } from "./state.js";
import { renderEmpty, setBlockLoading } from "./states.js";
import { initSiteSections } from "./site-sections.js";

async function jsonPost(path, body) {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
    body: JSON.stringify(body),
  });
  let data = {};
  if (res.headers.get("content-type")?.includes("application/json")) {
    data = await res.json().catch(() => ({}));
  }
  return { ok: res.ok && data.ok, status: res.status, data };
}

function setStatus(el, message, isError) {
  el.textContent = message;
  el.className = isError ? "err" : "hint";
}

function passwordRuleMessage(value) {
  if (value.length < 8) return "New password must be at least 8 characters.";
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value)) return "New password must include upper and lower case letters.";
  if (!/\d/.test(value)) return "New password must include a number.";
  if (!/[^A-Za-z0-9]/.test(value)) return "New password must include a symbol.";
  return "";
}

async function loadSessions() {
  const list = $("accSessions");
  if (!list) return;
  setState({ SESSIONS_STATUS: "loading" });
  setBlockLoading(list, { lines: 3 });
  try {
    const res = await fetch("/api/auth/sessions", { credentials: "include" });
    const data = await res.json();
    if (!data?.ok || !data.sessions) {
      setState({ SESSIONS_STATUS: "error" });
      list.innerHTML = '<p class="err">Could not load sessions.</p>';
      return;
    }
    setState({ SESSIONS_STATUS: "ready" });
    if (!data.sessions.length) {
      renderEmpty(list, { icon: "users", title: "No active sessions.", body: "Active signed-in devices will appear here." });
      return;
    }
    let html =
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Device / Started</th><th>Expires</th><th class="ta-r">Status</th></tr></thead><tbody>';
    for (const s of data.sessions) {
      const label = s.current ? '<span class="pill pill--good">● Current device</span>' : '<span class="pill pill--muted">Other browser</span>';
      const created = s.createdAt ? new Date(s.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
      const expires = s.expiresAt ? new Date(s.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
      html += `<tr><td><div class="session-device-cell"><strong>💻 Web Session</strong><span class="hint">${created}</span></div></td><td><span class="hint">${expires}</span></td><td class="ta-r">${label}</td></tr>`;
    }
    html += "</tbody></table></div>";
    list.innerHTML = html;
    list.removeAttribute("aria-busy");
  } catch (e) {
    setState({ SESSIONS_STATUS: "error" });
    logError("loadSessions", e);
    list.innerHTML = '<p class="err">Could not load sessions.</p>';
  }
}

function wirePasswordToggles() {
  document.querySelectorAll("[data-pwd-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-pwd-toggle");
      const input = targetId ? document.getElementById(targetId) : null;
      if (!input) return;
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      const eyeOpen = btn.querySelector(".eye-open");
      const eyeClosed = btn.querySelector(".eye-closed");
      if (eyeOpen && eyeClosed) {
        eyeOpen.style.display = isPassword ? "none" : "";
        eyeClosed.style.display = isPassword ? "" : "none";
      }
      btn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
    });
  });

  const newPwdInput = $("accNewPassword");
  const reqs = {
    len: $("pwdReqLength"),
    case: $("pwdReqCase"),
    num: $("pwdReqNumber"),
    special: $("pwdReqSymbol"),
  };
  if (newPwdInput) {
    newPwdInput.addEventListener("input", () => {
      const value = newPwdInput.value;
      const checks = {
        len: value.length >= 8,
        case: /[a-z]/.test(value) && /[A-Z]/.test(value),
        num: /\d/.test(value),
        special: /[^A-Za-z0-9]/.test(value),
      };
      Object.entries(reqs).forEach(([key, el]) => el?.classList.toggle("is-met", checks[key]));
    });
  }
}

function wireChangePassword() {
  const save = $("accChangePassword");
  if (!save) return;
  wirePasswordToggles();
  save.addEventListener("click", async () => {
    const status = $("accPasswordStatus");
    const current = $("accCurrentPassword").value.trim();
    const password = $("accNewPassword").value.trim();
    setStatus(status, "", false);
    const passwordError = passwordRuleMessage(password);
    if (passwordError) {
      setStatus(status, passwordError, true);
      $("accNewPassword")?.focus();
      return;
    }
    setStatus(status, "Saving…", false);
    const result = await jsonPost("/api/auth/change-password", { currentPassword: current, password });
    if (result.ok) {
      setStatus(status, result.data.message || "Password updated.", false);
      $("accCurrentPassword").value = "";
      $("accNewPassword").value = "";
      loadSessions();
    } else {
      setStatus(status, result.data?.message || "Update failed.", true);
    }
  });
}

function wireSignOut() {
  const button = $("accSignOut");
  if (!button) return;
  button.addEventListener("click", async () => {
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "Signing out…";
    try {
      const result = await jsonPost("/api/auth/logout", {});
      if (!result.ok) throw new Error(result.data?.error || "Could not sign out.");
      try { localStorage.setItem("yr:logout", String(Date.now())); } catch { /* storage unavailable */ }
      location.href = loginRedirectPath(location);
    } catch (error) {
      button.disabled = false;
      button.textContent = original;
      setStatus($("accSessionsStatus"), error.message || "Could not sign out.", true);
    }
  });
}

function wireRevokeSessions() {
  const btn = $("accRevokeSessions");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const status = $("accSessionsStatus");
    if (!await showConfirmModal("Sign out other devices", "Every other active session will be closed. This device will stay signed in.", "Sign out", false)) return;
    setStatus(status, "Signing out…", false);
    const result = await jsonPost("/api/auth/sessions/revoke-others", {});
    if (result.ok) {
      setStatus(status, result.data.message || "Other sessions signed out.", false);
      loadSessions();
    } else {
      setStatus(status, result.data?.message || "Could not sign out sessions.", true);
    }
  });
}

function wireExport() {
  const btn = $("accExportData");
  if (!btn) return;
  let timer = null;
  const renderJob = (job) => {
    const status = $("accExportStatus");
    if (!status) return;
    if (job.status === "completed") {
      status.innerHTML = `<a href="/api/account/export/${encodeURIComponent(job.exportId)}/download">Download your export</a>`;
      btn.disabled = false;
    } else if (job.status === "unavailable") {
      // Retrying cannot succeed while the export backend is unconfigured, so no
      // "Try again" affordance is offered.
      setStatus(status, job.message, true);
      btn.disabled = true;
    } else if (job.status === "failed" || job.status === "expired") {
      const message = job.status === "failed" ? (job.message || "Export failed.") : "Export expired.";
      status.innerHTML = `${message} <button type="button" class="btn btn--sm btn--ghost" id="accExportRetry">Try again</button>`;
      $("accExportRetry")?.addEventListener("click", () => btn.click(), { once: true });
      btn.disabled = false;
    } else {
      setStatus(status, "Preparing export… this page will update when it is ready.", false);
      btn.disabled = true;
    }
  };
  const poll = async (exportId) => {
    try {
      const res = await fetch(`/api/account/export/${encodeURIComponent(exportId)}/status`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || "Could not load export status.");
      renderJob(data);
      if (!["completed", "failed", "expired"].includes(data.status)) timer = setTimeout(() => poll(exportId), 2000);
    } catch (e) {
      logError("exportStatus", e);
      setStatus($("accExportStatus"), "Could not check export status. Refresh to try again.", true);
      btn.disabled = false;
    }
  };
  btn.addEventListener("click", async () => {
    const status = $("accExportStatus");
    if (timer) clearTimeout(timer);
    setStatus(status, "Starting export…", false);
    btn.disabled = true;
    try {
      const res = await fetch("/api/account/export", {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": getCsrf() },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        const message = data?.error || data?.message;
        renderJob({
          status: data?.code === "export_not_configured" ? "unavailable" : "failed",
          message,
        });
        return;
      }
      renderJob(data);
      poll(data.exportId);
    } catch (e) {
      logError("exportData", e);
      setStatus(status, "Download failed.", true);
      btn.disabled = false;
    }
  });
}

export function wireAccount() {
  wireChangePassword();
  wireRevokeSessions();
  wireSignOut();
  wireExport();
  loadSessions();
}

function wireSettingsTabs(initialTab = "access") {
  const tabs = [...document.querySelectorAll("[data-settings-tab]")];
  const panels = [...document.querySelectorAll("[data-settings-panel]")];
  if (!tabs.length) return;
  const validTabs = new Set(tabs.map((tab) => tab.dataset.settingsTab));
  if (!validTabs.has(initialTab)) initialTab = tabs[0].dataset.settingsTab;
  const select = (key, focus = false) => {
    const saveBar = $("settingsSaveBar");
    const saveText = $("settingsSaveText");
    tabs.forEach((tab) => {
      const active = tab.dataset.settingsTab === key;
      tab.classList.toggle("is-on", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.settingsPanel !== key; });
    if (saveBar) saveBar.hidden = !["sections", "notifications"].includes(key);
    if (saveText) {
      saveText.textContent = key === "sections"
        ? "Public page switches save immediately. Use Save changes for legal links."
        : "Use Save changes after updating notification destinations.";
    }
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab.dataset.settingsTab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      select(tabs[next].dataset.settingsTab, true);
    });
  });
  select(initialTab);
}

function wireSettingsDanger() {
  const reset = $("settingsResetData");
  if (reset) reset.addEventListener("click", async () => {
    if (!await showConfirmModal("Reset leaderboard data", "Archive this period and clear all players? This cannot be undone.", "Reset data", true)) return;
    const status = $("status");
    try {
      const res = await fetch("/api/site/archive", { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": getCsrf() }, body: JSON.stringify({ label: "Settings reset", clear: "players", siteId: state.ACTIVE_SITE_ID }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Reset failed");
      if (status) { status.textContent = "Leaderboard data reset."; status.hidden = false; }
      location.reload();
    } catch (err) { logError("settings-reset", err); if (status) { status.textContent = err.message; status.hidden = false; } }
  });
  const del = $("settingsDeleteBoard");
  if (del) del.addEventListener("click", async () => {
    if (!await showConfirmModal("Delete board", "Delete this board and all of its data? This cannot be undone.", "Delete board", true)) return;
    try {
      const res = await fetch("/api/site", { method: "DELETE", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": getCsrf() }, body: JSON.stringify({ siteId: state.ACTIVE_SITE_ID }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Delete failed");
      location.href = "/dashboard";
    } catch (err) { logError("settings-delete-board", err); const status = $("status"); if (status) { status.textContent = err.message; status.hidden = false; } }
  });
}

function wireSettingsBoardAccess() {
  if (!state.ACTIVE_SITE_ID) return;
  const board = encodeURIComponent(state.ACTIVE_SITE_ID);
  const accessLink = $("settingsBoardAccessLink");
  if (accessLink) accessLink.href = `/dashboard/leaderboard/setup?board=${board}`;
  const playerFieldsLink = $("playerFieldsLink");
  if (playerFieldsLink) playerFieldsLink.href = `/dashboard/leaderboard/players?board=${board}`;
}

function keepIndependentSettingsActionsOutOfDraft() {
  for (const id of ["f_domain", "domainSearchInput"]) {
    const input = $(id);
    input?.addEventListener("input", (event) => event.stopPropagation());
    input?.addEventListener("change", (event) => event.stopPropagation());
  }
}

function wireSettingsWebhook(sitePayload) {
  const toggle = $("settingsWebhookEnabled");
  const body = $("notifyBody");
  if (!toggle || !body) return;
  const webhook = $("f_webhook");
  toggle.checked = sitePayload?.notify?.discord_webhook_url === true || webhook?.dataset.configured === "true";
  const sync = () => {
    if (!toggle.checked && webhook) {
      webhook.value = "";
      webhook.dataset.configured = "false";
    }
    body.classList.toggle("is-disabled", !toggle.checked);
    body.querySelectorAll("input, button").forEach((el) => { el.disabled = !toggle.checked; });
  };
  toggle.addEventListener("change", () => { sync(); markDirty(); });
  webhook?.addEventListener("input", () => {
    webhook.dataset.configured = webhook.value.trim() ? "true" : "false";
    markDirty();
  });
  sync();
}

// Board settings (`/dashboard/site`). Plan, usage and account-level
// providers live in the account settings document, not here.
export function setupSettingsScreen(sitePayload, initialTab = "access") {
  if (!document.querySelector('[data-page="site"]')) return;
  wireSettingsTabs(initialTab);
  wireSettingsDanger();
  wireSettingsBoardAccess();
  keepIndependentSettingsActionsOutOfDraft();
  wireSettingsWebhook(sitePayload);
  initSiteSections();
}
