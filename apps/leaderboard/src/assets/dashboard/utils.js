// Shared helpers used across dashboard modules.
import { state } from "./state.js";
import { renderEmpty, setRowsLoading } from "./states.js";
import { loginRedirectPath } from "./request.js";

export function getCsrf() {
  const m = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/);
  return m ? m[1] : "";
}

// E2E-005: Redirect to login on session expiry instead of showing stale "Save failed"
// AUDIT-B2: keep the current URL in `next` so re-login returns the user to
// the screen they were on instead of dropping them on /dashboard home.
export function guardAuth(res) {
  if (res.status === 401) { location.href = loginRedirectPath(); throw new Error("session expired"); }
  return res;
}

export const $ = (id) => document.getElementById(id);

export function logError(context, err, extra = {}) {
  const reqId = state.pageReqId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = { level: "error", context, message: err?.message || String(err), stack: err?.stack, req_id: reqId, extra: { url: location.href, ...extra } };
  console.error(JSON.stringify({ ...payload, ctx: "dashboard" }));
  try {
    fetch("/api/log", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "x-csrf-token": getCsrf(), "x-request-id": reqId },
      body: JSON.stringify(payload)
    }).catch(() => undefined);
  } catch (loggingErr) {
    console.error("dashboard logging failed", loggingErr);
  }
}

export function showToast(message, type = "error") {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = message;
  el.className = "toast"; // reset classes
  if (type) el.classList.add(`toast--${type}`);
  el.hidden = false;
  // Automatically hide after 4 seconds
  clearTimeout(el._toastTimeout);
  el._toastTimeout = setTimeout(() => {
    el.hidden = true;
  }, 4000);
}

/**
 * "You have nothing yet" and "we couldn't load this" are different facts, and
 * every panel used to conflate them: a failed fetch left the empty state
 * showing, so a network error read as "No payments yet". These two write to the
 * panel's existing empty node — the original copy is kept so the empty state
 * comes back after a successful retry.
 */
export function showLoadError(el, what, retry) {
  if (!el) return;
  if (el.dataset.emptyHtml === undefined) {
    el.dataset.emptyHtml = el.innerHTML;
    el.dataset.emptyClass = el.className;
  }
  el.className = `${el.dataset.emptyClass} empty--error`.trim();
  el.setAttribute("role", "status");
  el.innerHTML = `<span class="empty__icon" aria-hidden="true">⚠</span>Couldn't load ${what}.`;
  if (retry) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--sm btn--ghost ghost";
    btn.textContent = "Try again";
    btn.addEventListener("click", () => { clearLoadError(el); retry(); });
    el.appendChild(document.createElement("br"));
    el.appendChild(btn);
  }
  el.hidden = false;
}

/** Put the panel's own empty copy back, and hide it unless `show`. */
export function clearLoadError(el, show = false) {
  if (!el) return;
  if (el.dataset.emptyHtml !== undefined) {
    el.innerHTML = el.dataset.emptyHtml;
    el.className = el.dataset.emptyClass;
  }
  el.removeAttribute("role");
  el.hidden = !show;
}

/** True while the panel is showing a load failure rather than its empty copy. */
export function hasLoadError(el) {
  return Boolean(el && el.classList.contains("empty--error"));
}

// The dialog itself lives in /assets/dialog.js so the bot dashboard can use the
// same one; these keep the call sites unchanged.
let dialogReady;
function ensureDialog() {
  if (window.YRDialog) return Promise.resolve(window.YRDialog);
  if (!dialogReady) {
    dialogReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/assets/dialog.js";
      s.onload = () => resolve(window.YRDialog);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return dialogReady;
}

export function loadDialog() {
  return ensureDialog();
}

export async function showConfirmModal(title, body, confirmText = "Confirm", isDanger = false) {
  const dialog = await ensureDialog();
  return dialog.confirm({ title, body, confirmText, danger: isDanger });
}

export async function showPromptModal(title, body, opts = {}) {
  const dialog = await ensureDialog();
  return dialog.prompt({
    title,
    body,
    confirmText: opts.confirmText || "OK",
    type: opts.inputType || "text",
    value: opts.defaultValue || "",
    placeholder: opts.placeholder || "",
    label: opts.label || title,
  });
}

export function getViewerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function dateFromInput(value) {
  if (value instanceof Date) return value;
  const date = new Date(value);
  return isNaN(date) ? null : date;
}

function offsetMinutes(date, timeZone) {
  if (!timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const name = parts.find((part) => part.type === "timeZoneName")?.value || "";
    const match = name.match(/GMT([+-])(\d{1,2}):?(\d{2})?$/);
    if (match) return (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3] || 0));
    if (name === "GMT") return 0;
  } catch {
    // Fall back to parts arithmetic for engines without longOffset.
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    const wall = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
    return Math.round((wall - date.getTime()) / 60000);
  } catch {
    return null;
  }
}

export function timeZoneOffsetLabel(value, timeZone = getViewerTimeZone()) {
  const date = dateFromInput(value);
  const offset = date && offsetMinutes(date, timeZone);
  if (offset === null || offset === undefined) return "";
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export function timeZoneLabel(value, timeZone = getViewerTimeZone()) {
  const offset = timeZoneOffsetLabel(value, timeZone);
  return offset && timeZone ? `${timeZone} (${offset})` : offset;
}

function localParts(value, timeZone) {
  const date = dateFromInput(value);
  if (!date || !timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    return values;
  } catch {
    return null;
  }
}

function inputParts(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  const [year, month, day, hour, minute] = parts;
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute) return null;
  return { year, month, day, hour, minute };
}

function sameMinute(a, b) {
  return a && b && a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}

// Fill a <input type="datetime-local"> with the wall-clock time in `timeZone`.
export function toLocalInput(iso, timeZone = getViewerTimeZone()) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  if (!timeZone) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  const parts = localParts(d, timeZone);
  if (!parts) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${parts.year}-${p(parts.month)}-${p(parts.day)}T${p(parts.hour)}:${p(parts.minute)}`;
}

export function fromLocalInput(value, timeZone = getViewerTimeZone()) {
  const wanted = inputParts(value);
  if (!wanted) return "";
  if (!timeZone) {
    const date = new Date(value);
    return isNaN(date) ? "" : date.toISOString();
  }
  const wall = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute);
  const offsets = new Set([
    offsetMinutes(new Date(wall), timeZone),
    offsetMinutes(new Date(wall - 86400000), timeZone),
    offsetMinutes(new Date(wall + 86400000), timeZone),
  ].filter((offset) => offset !== null));
  const candidates = [...offsets]
    .map((offset) => new Date(wall - offset * 60000))
    .filter((date) => sameMinute(localParts(date, timeZone), wanted))
    .sort((a, b) => a - b);
  // For a fall-back overlap, choose the earlier of the two valid instants.
  if (candidates.length) return candidates[0].toISOString();

  // For a spring-forward gap, choose the first representable wall time after the gap.
  const later = [...offsets]
    .map((offset) => new Date(wall - offset * 60000))
    .map((date) => ({ date, parts: localParts(date, timeZone) }))
    .filter(({ parts }) => parts && Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) >= wall)
    .sort((a, b) => Date.UTC(a.parts.year, a.parts.month - 1, a.parts.day, a.parts.hour, a.parts.minute) - Date.UTC(b.parts.year, b.parts.month - 1, b.parts.day, b.parts.hour, b.parts.minute));
  return later[0]?.date.toISOString() || "";
}

export function slugify(s) {
  return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function fmtMoney(n) {
  return n ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "0";
}

export function parseAmount(str) {
  const raw = String(str || "").replace(/[$,\s]/g, "");
  if (raw === "") return 0;
  const n = parseFloat(raw);
  return (Number.isNaN(n) || !Number.isFinite(n) || n < 0) ? 0 : n;
}

export function currentPlayers() {
  const rows = $("rows");
  if (!rows) return Array.isArray(state.PLAYERS) ? state.PLAYERS : [];
  return [...rows.children].map((tr) => ({
    name: tr.querySelector(".p-name").value.trim(),
    wagered: parseAmount(tr.querySelector(".p-wager").value),
    prize: parseAmount(tr.querySelector(".p-prize").value),
  })).filter((p) => p.name);
}

export function resetsIn() {
  const v = $("f_ends")?.value;
  if (!v) return "—";
  const end = new Date(v);
  if (isNaN(end)) return "—";
  const ms = end.getTime() - Date.now();
  if (ms <= 0) return "Ended";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d >= 1 ? `${d}d` : `${h}h`;
}

export async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch (err) { logError("clipboard-api", err); }
  }
  // Fallback for non-secure contexts or denied permission.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (err) { logError("clipboard-fallback", err); return false; }
}

export function flashButton(btn, message, duration = 1500) {
  if (!btn) return;
  if (btn._flashTimeout) clearTimeout(btn._flashTimeout);
  if (btn._flashOriginal === undefined) btn._flashOriginal = btn.innerHTML;
  btn.textContent = message;
  btn._flashTimeout = setTimeout(() => {
    btn.innerHTML = btn._flashOriginal;
    delete btn._flashOriginal;
  }, duration);
}

// Generic client-side search/sort/pagination controller for data-driven tables.
export class ListController {
  constructor(opts) {
    this.root = opts.root;
    this.tbody = typeof opts.tbody === "string" ? $(opts.tbody) : opts.tbody;
    this.all = opts.items || [];
    this.perPage = opts.perPage || 20;
    this.searchFn = opts.searchFn || (() => "");
    this.sortOptions = opts.sortOptions || [];
    this.emptyText = opts.emptyText || "No items.";
    this.emptyAllText = opts.emptyAllText || this.emptyText;
    this.emptyEl = opts.emptyEl || null;
    this.emptySpec = opts.emptySpec || { icon: "chart", title: this.emptyAllText };
    this.onRender = opts.onRender || (() => {});
    this.renderItem = opts.renderItem || ((item) => `<tr><td colspan="99">${esc(String(item))}</td></tr>`);
    this.page = 1;
    this.query = "";
    this.sortKey = this.sortOptions[0]?.key || "";
    this._buildControls();
    this.refresh();
  }
  _buildControls() {
    const wrap = document.createElement("div");
    wrap.className = "list-controls";
    wrap.hidden = this.all.length === 0;
    const searchPlaceholder = this.root?.dataset?.searchPlaceholder || "Search…";
    let html = `<div class="list-controls-row">`;
    html += `<input type="search" class="list-search" placeholder="${esc(searchPlaceholder)}" aria-label="Search" />`;
    if (this.sortOptions.length) {
      html += `<select class="list-sort" aria-label="Sort"><option value="">Sort by…</option>`;
      for (const opt of this.sortOptions) html += `<option value="${esc(opt.key)}"${opt.key === this.sortKey ? " selected" : ""}>${esc(opt.label)}</option>`;
      html += `</select>`;
    }
    html += `</div><div class="list-pagination" role="group" aria-label="Pagination"><button class="btn btn--sm" data-prev type="button">Previous</button><span class="list-page-info"></span><button class="btn btn--sm" data-next type="button">Next</button></div>`;
    wrap.innerHTML = html;
    this.root.insertBefore(wrap, this.root.firstChild);
    this.searchInput = wrap.querySelector(".list-search");
    this.sortSelect = wrap.querySelector(".list-sort");
    this.prevBtn = wrap.querySelector("[data-prev]");
    this.nextBtn = wrap.querySelector("[data-next]");
    this.pageInfo = wrap.querySelector(".list-page-info");
    this.controls = wrap;
    this.searchInput.addEventListener("input", () => { this.query = this.searchInput.value.trim().toLowerCase(); this.page = 1; this.refresh(); });
    if (this.sortSelect) this.sortSelect.addEventListener("change", () => { this.sortKey = this.sortSelect.value; this.page = 1; this.refresh(); });
    this.prevBtn.addEventListener("click", () => { if (this.page > 1) { this.page--; this.refresh(); } });
    this.nextBtn.addEventListener("click", () => { if (this.page < this.totalPages) { this.page++; this.refresh(); } });
  }
  setItems(items) {
    this.all = items || [];
    this.page = 1;
    this._setControlsHidden(this.all.length === 0);
    this.setLoading(false);
    this.refresh();
  }
  _setControlsHidden(hidden) {
    if (!this.controls) return;
    this.controls.hidden = hidden;
    this.controls._mountedTargets?.forEach((target) => { target.hidden = hidden; });
  }
  setLoading(loading) {
    if (!this.tbody) return;
    if (loading) {
      this.tbody.closest("table")?.setAttribute("aria-busy", "true");
      if (this.emptyEl) this.emptyEl.hidden = true;
      setRowsLoading(this.tbody, { cols: this.tbody.closest("table")?.querySelectorAll("thead th").length || 1, rows: 3 });
    } else {
      this.tbody.closest("table")?.removeAttribute("aria-busy");
      this.tbody.removeAttribute("aria-busy");
    }
  }
  _matches(item) {
    if (!this.query) return true;
    const hay = String(this.searchFn(item)).toLowerCase();
    const terms = this.query.split(/\s+/).filter(Boolean);
    return terms.every((t) => hay.includes(t));
  }
  _sort(a, b) {
    const opt = this.sortOptions.find((o) => o.key === this.sortKey);
    if (!opt || !opt.fn) return 0;
    return opt.fn(a, b);
  }
  refresh() {
    const filtered = this.all.filter((item) => this._matches(item));
    const sorted = this.sortKey ? [...filtered].sort(this._sort.bind(this)) : filtered;
    this.totalPages = Math.max(1, Math.ceil(sorted.length / this.perPage));
    if (this.page > this.totalPages) this.page = this.totalPages || 1;
    const start = (this.page - 1) * this.perPage;
    const pageItems = sorted.slice(start, start + this.perPage);
    if (pageItems.length === 0) {
      const msg = this.all.length === 0 && !this.query ? this.emptyAllText : this.emptyText;
      const colCount = this.tbody?.closest("table")?.querySelectorAll("thead th").length || 1;
      this.tbody.innerHTML = "";
      if (this.emptyEl && this.all.length === 0 && !this.query) {
        renderEmpty(this.emptyEl, this.emptySpec);
      } else {
        this.tbody.innerHTML = `<tr><td colspan="${colCount}" class="muted">${esc(msg)}</td></tr>`;
      }
    } else {
      if (this.emptyEl) this.emptyEl.hidden = true;
      const frag = document.createDocumentFragment();
      for (const item of pageItems) {
        const rendered = this.renderItem(item);
        if (typeof rendered === "string") {
          const tr = document.createElement("tr");
          tr.innerHTML = rendered;
          frag.appendChild(tr);
        } else {
          frag.appendChild(rendered);
        }
      }
      this.tbody.innerHTML = "";
      this.tbody.appendChild(frag);
    }
    this._updatePagination(sorted.length);
    this.onRender(pageItems);
  }
  _updatePagination(total) {
    this.pageInfo.textContent = total ? `Page ${this.page} of ${this.totalPages} (${total})` : "";
    this.prevBtn.disabled = this.page <= 1;
    this.nextBtn.disabled = this.page >= this.totalPages || this.totalPages === 0;
  }
}
