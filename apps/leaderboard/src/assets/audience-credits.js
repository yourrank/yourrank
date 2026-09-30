import { showConfirmModal, showPromptModal, logError, clearLoadError, showToast } from "./dashboard/utils.js";
import { setState, state as dashboardState } from "./dashboard/state.js";
import { clearSession } from "./dashboard/session.js";
import { inlineStateHtml, renderEmpty, renderError, setBlockLoading, setRowsLoading } from "./dashboard/states.js";
import { loadBoardShell, preserveSiteContextLinks, sitePath, siteQuery } from "./dashboard/board-shell.js";
import { fetchDashboardJson, loginRedirectPath } from "./dashboard/request.js";
import { ServerListController } from "./dashboard/server-list.js";
import { bulkAwardSummary, remainingSelection, runBulkAward } from "./bulk-award.js";
import { exportRows, MemberSelection } from "./member-selection.js";
import "./dashboard/help-drawer.js";
import "./dashboard/command-palette.js";

const $ = (id) => document.getElementById(id);

// Cross-tab sign-out: when another tab logs out, this standalone page must
// leave the dashboard too. The persistent SPA shell installs the same listener
// in dashboard.js; guard with !window.__yrSpaShell to avoid duplicate redirects.
if (!window.__yrSpaShell) {
  window.addEventListener("storage", (event) => {
    if (event.key === "yr:logout") {
      clearSession();
      location.href = loginRedirectPath(location);
    }
  });
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const csrf = () => document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] || "";
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString() : "—";
const relative = (iso) => { const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000)); return mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`; };
const LEDGER_EVENT_LABELS = Object.freeze({ earn: "Earned", spend: "Spent", redeem: "Claimed", revoke: "Refunded spend", refund: "Reversed earn" });
async function api(method, path, body) {
  const opts = { method, credentials: "same-origin", headers: { "x-csrf-token": csrf() } };
  if (body) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
  try {
    const { body: data } = await fetchDashboardJson(path, opts);
    return data;
  } catch (error) {
    if (error?.code === "AUTH") location.href = loginRedirectPath(location);
    throw error;
  }
}
// Persist the operation key until a confirmed response, including across a
// reload after a lost response. Never manufacture a new key for a blind retry.
async function adjustMemberCredits(id, delta, reason) {
  const storageKey = "yr:credit-adjustment:" + JSON.stringify([activeSiteId, id, delta, reason]);
  let operationId = sessionStorage.getItem(storageKey);
  if (!operationId) {
    operationId = crypto.randomUUID();
    sessionStorage.setItem(storageKey, operationId);
  }
  const result = await api("POST", sitePath(`/api/credits/viewers/${encodeURIComponent(id)}/balance`), {
    delta, reason, operationId,
  });
  sessionStorage.removeItem(storageKey);
  return result;
}
let state = {}; // local credits page state (not dashboard/state.js)
let viewerCtrl;
let activeSiteId = "";
// P3-5: selected members for the Audience bulk toolbar. Selection survives
// re-renders, pagination and search; it is cleared on site change or explicit
// clear. Row snapshots are kept so export never depends on the loaded page.
const memberSelection = new MemberSelection();
// The per-viewer manual adjustment endpoint is rate limited to 30 requests /
// 60 s per user, so one bulk apply may not exceed this many members.
const BULK_AWARD_MAX = 25;
const statusClearTimers = new Map();
let activityEvents = [];
let activityCursor = null;
let activityLoading = false;
let memberHistoryEvents = [];
let memberHistoryLoading = false;
let memberDetailId = "";
let memberDetail = null;
let memberHistoryRelease;
let memberHistoryTrigger;
let memberHistoryRequest = 0;
let memberQueryOpened = false;
let wired = false;
const tab = () => $("cr-app")?.dataset.crTab || "";
function setStatus(id, msg, error = false) {
  const el = $(id);
  if (!el) return;
  const previousTimer = statusClearTimers.get(id);
  if (previousTimer) clearTimeout(previousTimer);
  statusClearTimers.delete(id);
  el.textContent = msg;
  el.className = error ? "status error" : "status";
  if (!error) {
    const timer = setTimeout(() => {
      if (statusClearTimers.get(id) !== timer) return;
      statusClearTimers.delete(id);
      el.textContent = "";
    }, 3000);
    statusClearTimers.set(id, timer);
  }
}
function setLoading(idOrEl, loading, text = "Loading…") {
  const el = typeof idOrEl === "string" ? $(idOrEl) : idOrEl;
  if (!el) return;
  if (loading) { el.dataset.origText = el.textContent; el.disabled = true; el.setAttribute("aria-busy", "true"); el.textContent = text; }
  else { el.disabled = false; el.removeAttribute("aria-busy"); el.textContent = el.dataset.origText || el.textContent; delete el.dataset.origText; }
}
async function submitWithFeedback({ btn, statusId, busyLabel = "Saving…", run }) {
  setLoading(btn, true, busyLabel);
  try { return await run(); }
  catch (err) {
    const message = err?.message || "Something went wrong. Try again.";
    setStatus(statusId, message, true);
    $(statusId)?.scrollIntoView?.({ block: "nearest" });
    showToast(message, "error");
    return undefined;
  } finally { setLoading(btn, false); }
}
function setGlobalLoading(loading) { if ($("cr-loading")) $("cr-loading").hidden = !loading; }
function setCreditsPanelLoading(loading) {
  const panel = $("cr-empty");
  if (!panel) return;
  if (loading) {
    panel.hidden = false;
    setBlockLoading(panel, { lines: 3 });
  }
}
function draftKey(id) { return `yr:credits:draft:${id}`; }
function debounce(fn, ms) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); }; }
function saveFormDraft(formId, id) {
  const form = $(formId); if (!form) return;
  const data = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") { if (el.checked) data[el.name] = true; }
    else if (el.type === "number") { if (el.value !== "") data[el.name] = el.value; }
    else if (el.value.trim()) data[el.name] = el.value;
  }
  try { if (Object.keys(data).length) localStorage.setItem(draftKey(id), JSON.stringify(data)); else localStorage.removeItem(draftKey(id)); } catch (err) { logError("save-draft", err); }
}
function restoreFormDraft(formId, id) {
  const form = $(formId); if (!form) return;
  try {
    const data = JSON.parse(localStorage.getItem(draftKey(id)) || "null"); if (!data) return;
    for (const el of form.elements) { if (el.name && data[el.name] !== undefined) el.type === "checkbox" ? el.checked = Boolean(data[el.name]) : el.value = data[el.name]; }
    setStatus(form.querySelector(".status")?.id, "Draft restored.");
  } catch (err) { logError("restore-draft", err); }
}
function clearFormDraft(id) { try { localStorage.removeItem(draftKey(id)); } catch (err) { logError("clear-draft", err); } }
function wireAutosave(formId, id) {
  const form = $(formId); if (!form) return;
  const save = debounce(() => saveFormDraft(formId, id), 400);
  form.addEventListener("input", save); form.addEventListener("change", save); form.addEventListener("submit", () => clearFormDraft(id)); restoreFormDraft(formId, id);
}
function memberIdentity(v) {
  return v.displayName || "Unnamed member";
}
// Deep link into Members → Activity pre-filtered to one member. The feed's
// `viewer` param matches a Kick or Discord username (handlers/credits.js), so
// members with neither linked username get no link.
function memberActivityHref(member) {
  const name = (member?.kick_username || member?.discord_username || member?.displayName || "").trim();
  if (!name || name === "Unnamed member") return "";
  return `/dashboard/audience/activity?${new URLSearchParams({ viewer: name })}`;
}
function setMemberActivityLink(member) {
  const link = $("cr-member-history-activity-all");
  if (!link) return;
  const href = memberActivityHref(member);
  link.hidden = !href;
  if (href) link.href = href;
}
function memberPlatforms(v) {
  return (v.linkedIdentities || []).map((identity) => identity.provider).filter(Boolean);
}
function renderViewerRow(v) {
  const identity = memberIdentity(v);
  const uname = identity;
  const platforms = memberPlatforms(v);
  const avatar = v.avatarUrl
    ? `<img class="cr-viewer-avatar" src="${esc(v.avatarUrl)}" alt="" loading="lazy" />`
    : `<span class="cr-viewer-avatar cr-viewer-avatar--fallback" aria-hidden="true">${esc(uname.slice(0, 1).toUpperCase())}</span>`;
  const lastActiveAt = v.lastSeenAt || v.lastCreditAt;
  const platformHtml = platforms.length
    ? platforms.map((platform) => `<span>${esc(platform)} sign-in</span>`).join("")
    : "<span>No signed-in account</span>";
  const activity = lastActiveAt
    ? `<b title="Last active: ${esc(fmtDate(lastActiveAt))}">Active ${esc(relative(lastActiveAt))}</b>`
    : "<b>No activity yet</b>";
  // P3-5: multi-select checkbox feeds the bulk toolbar (award credits, CSV).
  const selectCell = `<td class="cr-member-select-col" data-label="Select"><input type="checkbox" data-member-select="${esc(v.id)}" aria-label="Select ${esc(uname)}" ${memberSelection.has(v.id) ? "checked" : ""} /></td>`;
  return `${selectCell}<td data-label="Member"><div class="cr-viewer-identity">${avatar}<span class="cr-member-name"><b>${esc(uname)}</b>${v.blocked ? '<span class="v3-chip v3-chip--cancelled">Blocked on this site</span>' : ""}</span></div></td><td data-label="Membership"><div class="cr-member-activity">${activity}</div></td><td data-label="Account connection"><div class="cr-member-platforms">${platformHtml}</div></td><td data-label="Credits"><div class="cr-member-credits"><b>${Number(v.balance) || 0} Credits</b><span>Earned ${Number(v.totalEarned) || 0} · Spent ${Number(v.totalSpent) || 0}</span></div></td><td data-label="Actions" class="ta-r cr-member-actions"><div class="cr-member-action-row"><button class="btn btn--sm" type="button" data-member-detail="${esc(v.id)}" aria-controls="cr-member-history-drawer" aria-expanded="false">View member</button></div></td>`;
}
async function loadMemberHistoryDialog() {
  if (!window.YRDialog) await import("./dialog.js");
  return window.YRDialog;
}
function fetchMembersPage(params, cursor) {
  const requestSiteId = siteQuery() || dashboardState.ACTIVE_SITE_ID || activeSiteId;
  const query = new URLSearchParams(params);
  if (cursor) query.set("cursor", cursor);
  const base = sitePath("/api/people/members");
  return api("GET", `${base}${base.includes("?") ? "&" : "?"}${query}`).then((data) => {
    if (requestSiteId !== (siteQuery() || dashboardState.ACTIVE_SITE_ID || activeSiteId)) {
      return { items: [], page: data.page, total: data.total };
    }
    state.members = cursor ? [...(state.members || []), ...(data.members || [])] : (data.members || []);
    memberSelection.refresh(data.members || []);
    return { items: data.members || [], page: data.page, total: data.total };
  });
}
function syncSelectAll() {
  const selectAll = $("cr-member-select-all");
  if (!selectAll) return;
  const boxes = [...document.querySelectorAll("[data-member-select]")];
  const checked = boxes.filter((box) => box.checked).length;
  selectAll.checked = boxes.length > 0 && checked === boxes.length;
  selectAll.indeterminate = checked > 0 && checked < boxes.length;
}
function render() {
  if (tab() === "viewers") {
    if (!viewerCtrl) {
      viewerCtrl = new ServerListController({
        root: $("cr-viewers"),
        tbody: "cr-viewer-list",
        emptyEl: $("cr-viewer-empty"),
        emptySpec: {
          kind: "empty",
          title: "No members yet",
          body: "People become members when they choose to join this community or complete a supported community action.",
          compact: true,
          actions: [{ label: "Share your site", href: "/dashboard/leaderboard/share", accent: true }],
        },
        noResultsSpec: { kind: "search", title: "No matching members", body: "No member name matches this search on the selected site.", compact: true },
        errorSpec: { title: "Couldn't load members", body: "People for the selected site could not be loaded." },
        itemLabel: "members",
        sortOptions: [
          { key: "activity", label: "Recently active" },
          { key: "balance", label: "Credit balance" },
          { key: "status", label: "Blocked first" },
        ],
        fetchPage: fetchMembersPage,
        renderItem: (v) => renderViewerRow(v),
        onRender: () => { wireDynamicActions(); syncSelectAll(); },
      });
      mountListControls($("cr-viewers"), $("cr-viewer-toolbar"), $("cr-viewer-foot"));
    }
    viewerCtrl.reload();
  }
  if (tab() === "history") {
    const typeSelect = $("cr-history-type");
    if (typeSelect && typeSelect.options.length === 1) {
      for (const [value, label] of Object.entries(LEDGER_EVENT_LABELS)) typeSelect.add(new Option(label, value));
    }
    const empty = $("cr-history-feed-empty");
    const list = $("cr-history-feed-list");
    if (list) setRowsLoading(list, { cols: 5, rows: 3 });
    if (empty) empty.hidden = true;
  }
}
async function toggleBlock(id, blocked, trigger) {
  const next = !blocked;
  let reason = "";
  if (next) { reason = await showPromptModal("Block member", "Why are you blocking this member?", { confirmText: "Block", placeholder: "e.g. chargeback / abuse" }) || ""; if (!reason) return; }
  setLoading(trigger, true, next ? "Blocking…" : "Unblocking…");
  try {
    await api("POST", sitePath(`/api/credits/viewers/${encodeURIComponent(id)}/block`), { blocked: next, reason });
    await load();
    if (memberDetailId === id) {
      memberHistoryRequest++;
      memberHistoryLoading = false;
      await loadMemberHistory();
    }
  }
  catch (err) { setStatus("cr-viewer-status", err.message, true); } finally { setLoading(trigger, false); }
}
function wireDynamicActions() {
  document.querySelectorAll("[data-block]:not([data-wired])").forEach((b) => { b.dataset.wired = "1"; b.addEventListener("click", () => toggleBlock(b.dataset.block, b.dataset.blocked === "1", b)); });
  document.querySelectorAll("[data-tip-viewer]:not([data-wired])").forEach((b) => { b.dataset.wired = "1"; b.addEventListener("click", () => openTip(b.dataset.tipViewer, b.dataset.viewerName)); });
  document.querySelectorAll("[data-member-detail]:not([data-wired])").forEach((button) => {
    button.dataset.wired = "1";
    button.addEventListener("click", async () => {
      const viewer = (state.members || []).find((item) => String(item.id) === String(button.dataset.memberDetail));
      if (!viewer) return;
      try {
        await openMemberHistory(viewer, button);
      } catch (error) {
        logError("open-member-detail", error);
        setStatus("cr-viewer-status", "Couldn't load this member. Try again.", true);
      }
    });
  });
}
function mountListControls(root, toolbar, foot) {
  const controls = root?.querySelector(":scope > .list-controls");
  if (!controls) return;
  controls._mountedTargets = [toolbar, foot].filter(Boolean);
  toolbar?.appendChild(controls.querySelector(".list-controls-row"));
  foot?.appendChild(controls.querySelector(".list-pagination"));
  controls._mountedTargets.forEach((target) => { target.hidden = controls.hidden; });
  controls.remove();
}
let tipRelease;
async function openTip(viewerId, username) {
  const drawer = $("cr-tip-drawer");
  const backdrop = $("cr-tip-backdrop");
  if (!drawer) return;
  const dialog = await loadMemberHistoryDialog();
  tipRelease?.();
  drawer.hidden = false;
  if (backdrop) backdrop.hidden = false;
  document.documentElement.classList.add("yr-modal-open");
  tipRelease = dialog.trap(drawer, closeTip);
  $("cr-tip-viewer-id").value = viewerId || "";
  $("cr-tip-username").value = username || "";
  $("cr-tip-amount").value = "100";
  $("cr-tip-reason").value = "";
  setStatus("cr-tip-status", "");
  $("cr-tip-amount").focus();
}
function closeTip() {
  const drawer = $("cr-tip-drawer");
  if (!drawer) return;
  const backdrop = $("cr-tip-backdrop");
  drawer.hidden = true;
  if (backdrop) backdrop.hidden = true;
  document.documentElement.classList.remove("yr-modal-open");
  tipRelease?.();
  tipRelease = undefined;
}
function closeMemberHistory() {
  memberHistoryRequest++;
  memberHistoryLoading = false;
  memberHistoryTrigger?.setAttribute("aria-expanded", "false");
  const drawer = $("cr-member-history-drawer");
  const backdrop = $("cr-member-history-backdrop");
  if (drawer) drawer.hidden = true;
  if (backdrop) backdrop.hidden = true;
  document.documentElement.classList.remove("yr-modal-open");
  memberHistoryRelease?.();
  memberHistoryRelease = undefined;
  memberHistoryTrigger = undefined;
  memberDetailId = "";
  memberDetail = null;
}
function renderMemberHistory() {
  const list = $("cr-member-history-list");
  const empty = $("cr-member-history-empty");
  if (!list) return;
  list.removeAttribute("aria-busy");
  if (!memberHistoryEvents.length) {
    list.innerHTML = "";
    list.hidden = true;
    if (empty) {
      renderEmpty(empty, {
        kind: "empty",
        title: "No credit activity yet",
        body: "This member has not earned or spent Credits on this site.",
        compact: true,
      });
    }
  } else {
    list.hidden = false;
    if (empty) empty.hidden = true;
    list.innerHTML = memberHistoryEvents.map((event) => {
      const debit = event.direction === "debit";
      const amount = `${debit ? "−" : "+"}${event.amount}`;
      return `<li><div><strong>${esc(LEDGER_EVENT_LABELS[event.type] || event.type)}</strong><span>${esc(event.description || "No details")}</span></div><div class="cr-member-history-event-meta"><b class="${debit ? "cr-negative" : "cr-positive"}">${amount}</b><time datetime="${esc(event.createdAt)}" title="${esc(fmtDate(event.createdAt))}">${esc(relative(event.createdAt))}</time></div></li>`;
    }).join("");
  }
}
function renderMemberDetail(data) {
  const member = data.member;
  memberDetail = member;
  const name = memberIdentity(member);
  $("cr-member-history-title").textContent = name;
  $("cr-member-history-site").textContent = `Member in ${data.site?.name || "the selected site"}`;
  $("cr-member-identity-heading").textContent = name;
  $("cr-member-history-identity-summary").textContent = member.linkedIdentities?.length
    ? "Signed-in viewer account"
    : "Site activity membership";
  const avatar = $("cr-member-history-avatar");
  if (avatar) {
    avatar.innerHTML = member.avatarUrl
      ? `<img class="cr-member-detail-avatar-image" src="${esc(member.avatarUrl)}" alt="" />`
      : esc(name.slice(0, 1).toUpperCase());
  }
  const lastActiveAt = member.lastSeenAt || member.lastCreditAt;
  $("cr-member-history-active").textContent = lastActiveAt ? fmtDate(lastActiveAt) : "No activity yet";
  $("cr-member-history-balance").textContent = `${Number(member.balance) || 0} Credits`;
  $("cr-member-history-earned").textContent = Number(member.totalEarned) || 0;
  $("cr-member-history-spent").textContent = Number(member.totalSpent) || 0;

  setMemberActivityLink(member);
  const connections = member.linkedIdentities || [];
  $("cr-member-history-connections").innerHTML = connections.length
    ? connections.map((identity) => `<span class="v3-chip v3-chip--fulfilled">${esc(identity.provider)} sign-in verified</span>`).join("")
    : '<span class="v3-chip">No signed-in account connection</span>';
  $("cr-member-history-connection-note").textContent = connections.length
    ? "These connections come from completed provider sign-in. Other records are not matched by name."
    : "This membership comes from site activity. No leaderboard player or subscriber record is assumed to be this person.";

  const blocked = member.moderation?.status === "blocked";
  $("cr-member-history-moderation").textContent = blocked ? "Blocked on this site" : "Active on this site";
  $("cr-member-history-moderation-reason").textContent = blocked
    ? member.moderation?.reason || "No reason recorded."
    : "No restrictions on this site.";
  const blockButton = $("cr-member-history-block");
  blockButton.textContent = blocked ? "Unblock member" : "Block member";
  blockButton.className = `btn btn--sm ${blocked ? "" : "btn--danger"}`;
  blockButton.dataset.block = member.id;
  blockButton.dataset.blocked = blocked ? "1" : "";
  delete blockButton.dataset.wired;
  memberHistoryEvents = member.recentCreditActivity || [];
  renderMemberHistory();
  wireDynamicActions();
}
async function loadMemberHistory() {
  if (memberHistoryLoading || !memberDetailId) return;
  const request = memberHistoryRequest;
  const list = $("cr-member-history-list");
  const empty = $("cr-member-history-empty");
  memberHistoryLoading = true;
  memberHistoryEvents = [];
  if (empty) {
    empty.hidden = true;
    empty.removeAttribute("role");
  }
  if (list) {
    list.hidden = false;
    list.setAttribute("aria-busy", "true");
    list.innerHTML = Array.from({ length: 4 }, () => '<li><span class="skeleton v3-skel-line" aria-hidden="true"></span></li>').join("");
  }
  try {
    const data = await api("GET", sitePath(`/api/people/members/${encodeURIComponent(memberDetailId)}`));
    if (request !== memberHistoryRequest) return;
    renderMemberDetail(data);
    setStatus("cr-member-history-status", "Member details loaded.");
  } catch (error) {
    if (request !== memberHistoryRequest) return;
    if (empty) {
      if (list) {
        list.innerHTML = "";
        list.hidden = true;
        list.removeAttribute("aria-busy");
      }
      renderError(empty, {
        title: "Couldn't load this member",
        body: "Their site-specific details could not be loaded.",
        retry: () => loadMemberHistory(),
      });
    }
  } finally {
    if (request === memberHistoryRequest) {
      memberHistoryLoading = false;
    }
  }
}
async function openMemberHistory(viewer, trigger) {
  const drawer = $("cr-member-history-drawer");
  const backdrop = $("cr-member-history-backdrop");
  if (!drawer || !backdrop) return;
  const dialog = await loadMemberHistoryDialog();
  closeTip();
  closeMemberHistory();
  memberHistoryRequest++;
  memberDetailId = viewer.id;
  memberHistoryTrigger = trigger;
  memberHistoryTrigger.setAttribute("aria-expanded", "true");
  $("cr-member-history-title").textContent = memberIdentity(viewer);
  $("cr-member-history-site").textContent = `Member in ${state.site?.name || "the selected site"}`;
  setMemberActivityLink(viewer);
  $("cr-member-history-balance").textContent = `${Number(viewer.balance) || 0} Credits`;
  $("cr-member-history-earned").textContent = Number(viewer.totalEarned) || 0;
  $("cr-member-history-spent").textContent = Number(viewer.totalSpent) || 0;
  setStatus("cr-member-history-status", "");
  drawer.hidden = false;
  backdrop.hidden = false;
  document.documentElement.classList.add("yr-modal-open");
  memberHistoryRelease = dialog.trap(drawer, closeMemberHistory);
  await loadMemberHistory();
}

async function openMemberFromQuery() {
  if (memberQueryOpened || tab() !== "viewers") return;
  const memberId = new URLSearchParams(location.search).get("member");
  if (!memberId) return;
  const viewer = (state.members || []).find((item) => String(item.id) === String(memberId));
  if (!viewer) return;
  memberQueryOpened = true;
  const trigger = document.querySelector(`[data-member-detail="${CSS.escape(String(memberId))}"]`)
    || document.querySelector('.v3-tabs [aria-current="page"]');
  if (trigger) await openMemberHistory(viewer, trigger);
}
async function load() {
  const requestedSiteId = siteQuery() || dashboardState.ACTIVE_SITE_ID || activeSiteId;
  if (requestedSiteId !== activeSiteId) {
    state.members = [];
    memberSelection.clear();
    viewerCtrl?.clear();
    updateBulkBar();
  }
  clearLoadError($("cr-empty"), false);
  setState({ CREDITS_STATUS: "loading" });
  setCreditsPanelLoading(true);
  viewerCtrl?.setLoading(true);
  setGlobalLoading(true);
  try {
    const shell = await loadBoardShell();
    const nextSiteId = shell.activeSiteId;
    if (nextSiteId !== activeSiteId) {
      state.members = [];
      memberSelection.clear();
      viewerCtrl?.clear();
      updateBulkBar();
    }
    activeSiteId = nextSiteId;
    // The Members tab loads its rows through the cursor-paginated list
    // controller; only the shell/site context is needed up front.
    state = tab() === "viewers"
      ? { members: state.members || [], capabilities: state.capabilities }
      : await api("GET", sitePath("/api/credits/status"));
    setState({ CREDITS_STATUS: "ready" });
    render();
    if (tab() === "history") {
      const viewer = new URLSearchParams(location.search).get("viewer");
      const input = $("cr-history-username");
      if (viewer && input && !input.value) input.value = viewer;
      await loadActivity({ reset: true });
    }
    preserveSiteContextLinks();
    $("cr-app").hidden = false; $("cr-empty").hidden = true;
    await openMemberFromQuery();
  } catch (err) {
    setState({ CREDITS_STATUS: "error" });
    logError("load-credits-dashboard", err);
    renderError($("cr-empty"), tab() === "viewers"
      ? { title: "Couldn't load members", body: "People for the selected site could not be loaded.", retry: () => load().catch(() => {}) }
      : { title: "Couldn't load your credits dashboard", body: "Your rewards data could not be loaded.", retry: () => load().catch(() => {}) });
    $("cr-app").hidden = false;
    window.__yrBoot?.signal();
    throw err;
  } finally { setGlobalLoading(false); }
}
// P3-5: Audience bulk operations ---------------------------------------------
function updateBulkBar() {
  const bar = $("cr-member-bulk-bar");
  if (!bar) return;
  const count = memberSelection.size;
  bar.hidden = count === 0;
  const label = $("cr-bulk-count");
  if (label) label.textContent = `${count} selected${count > BULK_AWARD_MAX ? ` — bulk award is capped at ${BULK_AWARD_MAX} per apply` : ""}`;
  const awardBtn = $("cr-bulk-award");
  if (awardBtn) awardBtn.disabled = count === 0 || count > BULK_AWARD_MAX;
}

function clearMemberSelection() {
  memberSelection.clear();
  document.querySelectorAll("[data-member-select]").forEach((box) => { box.checked = false; });
  const selectAll = $("cr-member-select-all");
  if (selectAll) { selectAll.checked = false; selectAll.indeterminate = false; }
  updateBulkBar();
}

function exportMembersCsv(rows) {
  const header = ["name", "credits", "total_earned", "total_spent", "blocked", "last_active_at"];
  const lines = rows.map((v) => [
    memberIdentity(v),
    String(Number(v.balance) || 0),
    String(Number(v.totalEarned) || 0),
    String(Number(v.totalSpent) || 0),
    v.blocked ? "yes" : "no",
    v.lastSeenAt || v.lastCreditAt || "",
  ].map((value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)).join(","));
  const blob = new Blob(["\uFEFF" + header.join(",") + "\n" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `members-${activeSiteId || "export"}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function bulkAwardMembers() {
  const amount = Math.floor(Number($("cr-bulk-amount")?.value));
  const reason = $("cr-bulk-reason")?.value.trim();
  const statusEl = $("cr-viewer-status");
  if (!Number.isFinite(amount) || amount <= 0) { setStatus("cr-viewer-status", "Enter a positive credit amount.", true); return; }
  if (!reason) { setStatus("cr-viewer-status", "An audit note is required for bulk credit awards.", true); return; }
  const ids = memberSelection.ids();
  if (!ids.length) return;
  if (ids.length > BULK_AWARD_MAX) { setStatus("cr-viewer-status", `Bulk award is capped at ${BULK_AWARD_MAX} members per apply.`, true); return; }
  const awardBtn = $("cr-bulk-award");
  if (awardBtn) awardBtn.disabled = true;
  setStatus("cr-viewer-status", `Awarding ${amount} credits to ${ids.length} member${ids.length === 1 ? "" : "s"}…`);
  // Sequential by design: one shared ledger write at a time keeps the 30/60s
  // adjustment rate limit intact and surfaces per-member errors clearly.
  const outcome = await runBulkAward(ids, (id) => adjustMemberCredits(id, amount, reason));
  outcome.errors.forEach((err) => logError("bulk-award-member", err));
  memberSelection.retain(remainingSelection(outcome));
  document.querySelectorAll("[data-member-select]").forEach((box) => { box.checked = memberSelection.has(box.dataset.memberSelect); });
  syncSelectAll();
  updateBulkBar();
  if (awardBtn) awardBtn.disabled = false;
  const complete = !outcome.failed.length && !outcome.unattempted.length;
  setStatus("cr-viewer-status", bulkAwardSummary(outcome, amount), !complete);
  if (complete) clearMemberSelection();
  await load().catch(() => {});
}

function wireActions() {
  if (wired) return;
  wired = true;
  // P3-5: member multi-select + bulk toolbar.
  const loadedMember = (id) => (state.members || []).find((m) => String(m.id) === String(id));
  const toggleMember = (box) => {
    const row = loadedMember(box.dataset.memberSelect);
    if (box.checked && row) memberSelection.add(row);
    else if (box.checked) box.checked = false;
    else memberSelection.delete(box.dataset.memberSelect);
  };
  $("cr-viewer-list")?.addEventListener("change", (e) => {
    const box = e.target.closest("[data-member-select]");
    if (!box) return;
    toggleMember(box);
    updateBulkBar();
  });
  $("cr-member-select-all")?.addEventListener("change", (e) => {
    const boxes = [...document.querySelectorAll("[data-member-select]")];
    boxes.forEach((box) => {
      box.checked = e.target.checked;
      toggleMember(box);
    });
    updateBulkBar();
  });
  $("cr-bulk-award")?.addEventListener("click", () => { bulkAwardMembers().catch((err) => { logError("bulk-award", err); setStatus("cr-viewer-status", err.message || "Bulk award failed.", true); }); });
  $("cr-bulk-export")?.addEventListener("click", () => {
    const rows = exportRows(memberSelection, state.members);
    if (!rows.length) { setStatus("cr-viewer-status", "Nothing to export yet.", true); return; }
    exportMembersCsv(rows);
  });
  $("cr-bulk-clear")?.addEventListener("click", () => clearMemberSelection());
  wireAutosave("cr-history-form", "history");
  $("cr-tip-close")?.addEventListener("click", closeTip);
  $("cr-tip-cancel")?.addEventListener("click", closeTip);
  $("cr-tip-backdrop")?.addEventListener("click", closeTip);
  $("cr-member-history-close")?.addEventListener("click", closeMemberHistory);
  $("cr-member-history-backdrop")?.addEventListener("click", closeMemberHistory);
  $("cr-member-history-tip")?.addEventListener("click", () => {
    if (!memberDetail) return;
    const { id } = memberDetail;
    const name = memberIdentity(memberDetail);
    closeMemberHistory();
    openTip(id, name);
  });
  document.querySelectorAll(".cr-tip-preset").forEach((b) => b.addEventListener("click", () => {
    const amt = b.dataset.amount;
    const input = $("cr-tip-amount");
    if (input && amt) input.value = amt;
  }));
  $("cr-tip-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = e.submitter || $("cr-tip-submit");
    const viewerId = $("cr-tip-viewer-id").value;
    const username = $("cr-tip-username").value.trim();
    const amount = Number($("cr-tip-amount").value);
    const reason = $("cr-tip-reason").value.trim();

    if (!amount || amount <= 0) {
      setStatus("cr-tip-status", "Please enter a positive amount of credits.", true);
      return;
    }
    if (!reason) {
      setStatus("cr-tip-status", "Please provide a reason for the tip.", true);
      return;
    }
    if (!viewerId) {
      setStatus("cr-tip-status", "Choose an existing member before sending credits.", true);
      return;
    }

    // P3-6: optimistic balance update — reflect the award instantly, roll back
    // if the server rejects it. The authoritative reload follows success.
    const member = (state.members || []).find((m) => m.id === viewerId);
    const previousBalance = member ? Number(member.balance) || 0 : null;
    if (member) {
      member.balance = previousBalance + amount;
      member.totalEarned = (Number(member.totalEarned) || 0) + amount;
      render();
    }
    void submitWithFeedback({
      btn,
      statusId: "cr-tip-status",
      busyLabel: "Sending…",
      run: async () => {
        try {
          await adjustMemberCredits(viewerId, amount, reason);
          setStatus("cr-tip-status", `Sent +${amount} credits to ${username || "this member"}.`);
          setTimeout(() => {
            closeTip();
            load();
          }, 900);
        } catch (err) {
          if (member) {
            member.balance = previousBalance;
            member.totalEarned = (Number(member.totalEarned) || 0) - amount;
            render();
          }
          throw new Error(`${err?.message || "Something went wrong. Try again."} — the balance was restored.`, { cause: err });
        }
      },
    });
  });

  $("cr-history-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    loadActivity({ reset: true }).catch((err) => setStatus("cr-history-status", err.message, true));
  });
  $("cr-history-load-more")?.addEventListener("click", () => loadActivity({ reset: false }).catch((err) => setStatus("cr-history-status", err.message, true)));
}
async function loadViewerSummary(username) {
  const summary = $("cr-history-summary");
  if (!username) {
    if (summary) summary.hidden = true;
    return;
  }
  const data = await api("GET", `/api/credits/viewer/history?kickUsername=${encodeURIComponent(username)}`);
  renderHistory(data);
  if (summary) summary.hidden = false;
}

async function loadActivity({ reset }) {
  if (activityLoading) return;
  if (!activeSiteId) {
    const list = $("cr-history-feed-list");
    const empty = $("cr-history-feed-empty");
    const more = $("cr-history-load-more");
    if (list) list.innerHTML = "";
    if (empty) {
      empty.innerHTML = inlineStateHtml({ kind: "setup", title: "Select a site", body: "Select a site to view its credit activity." });
      empty.hidden = false;
    }
    if (more) more.hidden = true;
    return;
  }
  activityLoading = true;
  const btn = $("cr-history-search");
  const more = $("cr-history-load-more");
  try {
    if (reset) {
      activityEvents = [];
      activityCursor = null;
      setRowsLoading($("cr-history-feed-list"), { cols: 5, rows: 3 });
      $("cr-history-feed-empty").hidden = true;
      setLoading(btn, true, "Loading…");
      await loadViewerSummary($("cr-history-username")?.value.trim());
    } else {
      setLoading(more, true, "Loading…");
    }
    const params = new URLSearchParams({ siteId: activeSiteId });
    const username = $("cr-history-username")?.value.trim();
    const type = $("cr-history-type")?.value || "";
    if (username) params.set("kickUsername", username);
    if (type) params.set("type", type);
    if (activityCursor) params.set("cursor", activityCursor);
    const data = await api("GET", `/api/credits/activity?${params}`);
    activityEvents = reset ? data.events || [] : activityEvents.concat(data.events || []);
    activityCursor = data.nextCursor || null;
    renderActivity();
    setStatus("cr-history-status", `${activityEvents.length} entries loaded.`);
  } finally {
    activityLoading = false;
    setLoading(btn, false);
    setLoading(more, false);
  }
}

function renderActivity() {
  const list = $("cr-history-feed-list");
  const empty = $("cr-history-feed-empty");
  const more = $("cr-history-load-more");
  if (!list) return;
  if (!activityEvents.length) {
    list.innerHTML = "";
    if (empty) {
      const memberFilter = $("cr-history-username")?.value.trim();
      empty.innerHTML = inlineStateHtml({ kind: "empty", title: "No credit activity found", body: memberFilter
        ? "This member has not earned or spent credits yet. Try another member or activity type."
        : "No credit activity matches the current filters. Try another member or activity type." });
      empty.hidden = false;
    }
  } else {
    if (empty) empty.hidden = true;
    list.innerHTML = activityEvents.map((event) => {
      const debit = event.direction === "debit";
      const amount = `${debit ? "−" : "+"}${event.amount}`;
      const memberName = event.kickUsername || event.discordUsername || event.kickUserId || event.discordUserId || "Unknown member";
      return `<tr><td data-label="When" title="${esc(fmtDate(event.createdAt))}">${esc(relative(event.createdAt))}</td><td data-label="Member">${esc(memberName)}</td><td data-label="Activity">${esc(LEDGER_EVENT_LABELS[event.type] || event.type)}</td><td data-label="Change" class="num ${debit ? "cr-negative" : "cr-positive"}">${amount}</td><td data-label="Details">${esc(event.description || "—")}</td></tr>`;
    }).join("");
  }
  if (more) more.hidden = !activityCursor;
}
function renderHistory(data) {
  const boards = data.boards || [];
  const list = $("cr-history-list");
  const empty = $("cr-history-empty");
  if (!list) return;
  list.innerHTML = boards.map((b) => `<tr><td data-label="Site"><b>${esc(b.name || b.slug)}</b><br><span class="hint">${esc(b.slug)}</span></td><td data-label="Balance" class="num">${b.balance}</td><td data-label="Earned" class="num">${b.totalEarned}</td><td data-label="Spent" class="num">${b.totalSpent}</td><td data-label="Pending" class="num">${b.redemptionsPending}</td><td data-label="Claims" class="num">${b.redemptionsTotal}</td><td data-label="Actions" class="ta-r"><a class="btn btn--sm" href="/dashboard/site/connections?siteId=${esc(b.siteId)}">Connect Kick</a></td></tr>`).join("");
  if (empty) {
    empty.innerHTML = boards.length ? "" : inlineStateHtml({ kind: "empty", title: "No sites found", body: "This member has no activity on your sites." });
    empty.hidden = boards.length > 0;
  }
}
// Persistent-shell lifecycle for Audience Members and Activity.
export function enter() {
  // Reset so re-entry re-wires event handlers against the freshly injected DOM.
  wired = false;
  state = {};
  activeSiteId = "";
  activityEvents = [];
  activityCursor = null;
  activityLoading = false;
  memberHistoryEvents = [];
  memberHistoryLoading = false;
  memberDetailId = "";
  memberDetail = null;
  memberHistoryRelease = undefined;
  memberHistoryTrigger = undefined;
  memberHistoryRequest = 0;
  tipRelease = undefined;
  memberQueryOpened = false;
  wireActions();
  load().then(() => { window.__yrBoot?.signal(); }).catch(() => {});
}

export function leave() {
  closeTip();
  closeMemberHistory();
  // Clear all status toast timers so they don't fire into a detached DOM.
  for (const timer of statusClearTimers.values()) clearTimeout(timer);
  statusClearTimers.clear();
  viewerCtrl?.destroy?.();
  viewerCtrl = undefined;
}
