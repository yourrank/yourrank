import { showConfirmModal, showPromptModal, ListController, logError, clearLoadError } from "./dashboard/utils.js";
import { requestDashboardRoute } from "./dashboard/shell.js";
import { setState, state as dashboardState } from "./dashboard/state.js";
import { clearSession } from "./dashboard/session.js";
import { UNKNOWN, inlineStateHtml, renderEmpty, renderError, setBlockLoading, setMetricEmpty, setMetricLoading, setRowsLoading } from "./dashboard/states.js";
import { loadBoardShell, preserveSiteContextLinks, sitePath, siteQuery } from "./dashboard/board-shell.js";
import { fetchDashboardJson, loginRedirectPath } from "./dashboard/request.js";
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
const LEDGER_EVENT_LABELS = Object.freeze({ earn: "Earned", spend: "Spent", redeem: "Ordered", revoke: "Refunded spend", refund: "Reversed earn" });
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
let state = {}; // local credits page state (not dashboard/state.js)
let viewerCtrl, redemptionCtrl, rewardCtrl;
let activeSiteId = "";
let pendingOAuthFeedback = null;
const statusClearTimers = new Map();
let activityEvents = [];
let activityCursor = null;
let activityLoading = false;
let shopItemsView = [];
let shopSearch = "";
let shopSort = "cost";
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
function authPath(path) {
  return activeSiteId ? `${path}?siteId=${encodeURIComponent(activeSiteId)}` : path;
}
const OAUTH_MESSAGES = Object.freeze({
  no_site_selected: "Select a site before connecting Kick.",
  site_not_found: "That site is no longer available. Select another site.",
  site_not_authorized: "You do not have permission to connect Kick for this site.",
  rate_limited: "Too many connection attempts. Try again shortly.",
  missing_oauth_params: "Kick did not return the information needed. Try again.",
  oauth_state_expired: "That took too long — try connecting again.",
  oauth_user_mismatch: "This connection started in another account. Try again.",
  access_denied: "Kick connection was cancelled.",
  kick_auth_failed: "Kick connection could not be completed. Try again.",
});
function showOAuthMessage({ finalize = false } = {}) {
  if (!pendingOAuthFeedback) {
    const params = new URLSearchParams(location.search);
    const error = params.get("error");
    const connected = params.get("kick_connected") === "1";
    if (!error && !connected) return;
    pendingOAuthFeedback = { error, connected };
    const clean = new URL(location.href);
    clean.searchParams.delete("error");
    clean.searchParams.delete("kick_connected");
    history.replaceState({}, "", `${clean.pathname}${clean.search}${clean.hash}`);
  }
  const { error, connected } = pendingOAuthFeedback;
  if (error) {
    setStatus("cr-channel-status", OAUTH_MESSAGES[error] || "Kick connection could not be completed. Try again.", true);
  } else {
    const channel = state.channel?.name ? `@${state.channel.name}` : "your channel";
    setStatus("cr-channel-status", `Connected to ${channel} on Kick.`, false);
  }
  if (error || finalize) pendingOAuthFeedback = null;
}
function updateKickAuthLinks() {
  for (const id of ["cr-channel-connect", "cr-channel-reconnect"]) {
    const link = $(id);
    if (link) link.href = authPath("/auth/kick");
  }
}
// The connected card always told the streamer "Connected", even when the OAuth
// token had expired or was never stored (manual channel-ID connect). These two
// helpers make the card honest: an expired/missing token flips the card to
// "Needs attention" and reveals the Reconnect link, which the template ships
// hidden and nothing used to unhide.
function renderChannelHealth({ connected, tokenExpired, expiryDate, linkedAt }) {
  const live = $("cr-channel-live");
  if (live) {
    live.textContent = !connected ? "—" : tokenExpired ? "Needs attention" : "Connected";
    live.classList.toggle("cr-attention", Boolean(connected && tokenExpired));
  }
  const token = $("cr-channel-token");
  if (token) {
    token.textContent = tokenExpired
      ? "Needs attention · reconnect"
      : connected
        ? "Renews automatically"
        : "Not connected yet";
    token.classList.toggle("cr-attention", Boolean(connected && tokenExpired));
  }
  const linked = $("cr-channel-linked");
  if (linked) linked.textContent = linkedAt ? fmtDate(linkedAt) : "—";
  const chip = $("cr-channel-chip");
  if (chip) {
    const attention = Boolean(connected && tokenExpired);
    chip.textContent = attention ? "● Needs attention" : "● Connected";
    chip.classList.toggle("v3-chip--fulfilled", !attention);
    chip.classList.toggle("v3-chip--pending", attention);
  }
  const reconnect = $("cr-channel-reconnect");
  if (reconnect) reconnect.hidden = !(connected && tokenExpired);
}
// Called when the API reports kick_reconnect_required: the streamer just
// learned the connection is broken mid-action, so surface the fix inline.
function markKickNeedsAttention() {
  renderChannelHealth({ connected: true, tokenExpired: true, expiryDate: null, linkedAt: state.channel?.linkedAt });
}
export function applyOAuthContext() {
  if (!activeSiteId) activeSiteId = siteQuery() || dashboardState.ACTIVE_SITE_ID || "";
  updateKickAuthLinks();
  showOAuthMessage();
}
function setLoading(idOrEl, loading, text = "Loading…") {
  const el = typeof idOrEl === "string" ? $(idOrEl) : idOrEl;
  if (!el) return;
  if (loading) { el.dataset.origText = el.textContent; el.disabled = true; el.setAttribute("aria-busy", "true"); el.classList.add("btn--loading"); el.textContent = text; }
  else { el.disabled = false; el.removeAttribute("aria-busy"); el.classList.remove("btn--loading"); el.textContent = el.dataset.origText || el.textContent; delete el.dataset.origText; }
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
function usageCls(used, limit) { const pct = limit > 0 ? Math.round((used / limit) * 100) : 0; return limit > 0 && used >= limit ? "cr-usage-over" : limit > 0 && pct >= 80 ? "cr-usage-near" : ""; }
function usageCard(used, limit, name) { const cls = usageCls(used, limit); return `<div class="cr-usage-card"><div class="hint">${esc(name)}</div><div class="cr-usage-number${cls ? ` ${cls}` : ""}">${used} / ${limit}</div>${cls ? '<a href="/dashboard/settings/billing" class="cr-usage-upgrade">Upgrade plan</a>' : ""}</div>`; }
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
function statusChip(status) {
  const meta = {
    pending: ["pending", "◷", "Pending"],
    fulfilled: ["fulfilled", "✓", "Fulfilled"],
    refunded: ["refunded", "↶", "Refunded"],
    cancelled: ["cancelled", "×", "Cancelled"],
  }[status] || ["pending", "◷", "Pending"];
  return `<span class="v3-chip v3-chip--${meta[0]}"><i aria-hidden="true">${meta[1]}</i> ${meta[2]}</span>`;
}
const metric = (value) => value == null ? UNKNOWN : value;
function renderRewardRow(m) {
  return `<td data-label="Kick reward"><b>${esc(m.kick_reward_title)}</b><br><span class="hint">${esc(m.kick_reward_id)}</span></td><td data-label="How it works" class="hint">Kick reward used · ${m.kick_reward_cost} points</td><td data-label="Credits" class="num"><b>+${m.credits} credits</b></td><td data-label="Available"><input class="v3-toggle" type="checkbox" ${m.active ? "checked" : ""} data-toggle-reward="${esc(m.id)}" aria-label="Make ${esc(m.kick_reward_title)} available" /></td><td data-label="Actions" class="ta-r"><button class="btn btn--sm" data-edit-reward="${esc(m.id)}">Edit</button> <button class="btn btn--sm btn--danger" data-del-reward="${esc(m.id)}">Disable</button></td>`;
}
function viewerIdentity(v) {
  return v.kick_username || v.discord_username || v.kick_user_id || v.discord_user_id || "Member";
}
function memberIdentity(v) {
  return v.kick_username || v.discord_username || "Member";
}
function memberPlatforms(v) {
  return [
    v.kick_username || v.kick_user_id ? "Kick" : "",
    v.discord_username || v.discord_user_id ? "Discord" : "",
  ].filter(Boolean);
}
function renderViewerRow(v) {
  const identity = memberIdentity(v);
  const uname = identity;
  const platforms = memberPlatforms(v);
  const avatar = v.avatar_url
    ? `<img class="cr-viewer-avatar" src="${esc(v.avatar_url)}" alt="" loading="lazy" />`
    : `<span class="cr-viewer-avatar cr-viewer-avatar--fallback" aria-hidden="true">${esc(uname.slice(0, 1).toUpperCase())}</span>`;
  const joined = fmtDate(v.created_at);
  const earned = v.last_earned_at ? fmtDate(v.last_earned_at) : "Not yet";
  const seen = v.last_seen_at ? fmtDate(v.last_seen_at) : "Not yet";
  const lastActiveAt = v.last_seen_at || v.last_earned_at;
  const history = identity !== "Member"
    ? `<a class="btn btn--sm" href="/dashboard/rewards/activity?viewer=${encodeURIComponent(identity)}">History</a> `
    : "";
  const platformHtml = platforms.length
    ? platforms.map((platform) => `<span>${platform}</span>`).join("")
    : "<span>Account connected</span>";
  const activity = lastActiveAt
    ? `<b title="Last seen: ${esc(seen)} · Last earned: ${esc(earned)}">Active ${esc(relative(lastActiveAt))}</b>`
    : "<b>No activity yet</b>";
  return `<td data-label="Member"><div class="cr-viewer-identity">${avatar}<span class="cr-member-name"><b>${esc(uname)}</b><span class="cr-member-platforms">${platformHtml}</span>${v.blocked ? '<span class="v3-chip v3-chip--cancelled">Blocked</span>' : ""}</span></div></td><td data-label="Recent activity"><div class="cr-member-activity">${activity}<span title="${esc(joined)}">Joined ${esc(relative(v.created_at))}</span></div></td><td data-label="Credits"><div class="cr-member-credits"><b>${Number(v.balance) || 0} Credits</b><span>Earned ${Number(v.total_earned) || 0} · Spent ${Number(v.total_spent) || 0}</span></div></td><td data-label="Actions" class="ta-r cr-member-actions"><div class="cr-member-action-row">${history}<button class="btn btn--sm btn--accent" data-tip-viewer="${esc(v.id)}" data-viewer-name="${esc(uname)}" data-viewer-balance="${Number(v.balance) || 0}" title="Tip credits to ${esc(uname)}">Tip</button> <button class="btn btn--sm ${v.blocked ? "" : "btn--danger"}" data-block="${esc(v.id)}" data-blocked="${v.blocked ? "1" : ""}">${v.blocked ? "Unblock" : "Block"}</button></div></td>`;
}
function renderRedemptionRow(r) { return `<td data-label="Member"><b>${esc(viewerIdentity(r))}</b></td><td data-label="Item">${esc(r.item_name)}</td><td data-label="Cost" class="num"><b>${r.cost}</b><span class="hint">credits</span></td><td data-label="Status">${statusChip(r.status)}</td><td data-label="Ordered" title="${esc(fmtDate(r.created_at))}">${relative(r.created_at)}</td><td data-label="Actions" class="ta-r">${r.status === "pending" ? `<button class="btn btn--sm" data-cancel="${esc(r.id)}">Cancel</button> <button class="btn btn--sm btn--accent" data-fulfill="${esc(r.id)}">Fulfil</button>` : ""}</td>`; }
function renderShopCards(items) {
  const root = $("cr-shop-list"); if (!root) return;
  ensureShopControls(items.length > 0);
  $("cr-shop-controls")?.toggleAttribute("hidden", items.length === 0);
  const filtered = items.filter((i) => !shopSearch || `${i.name} ${i.description || ""} ${i.cost} ${i.stock ?? ""}`.toLowerCase().includes(shopSearch));
  const sorted = [...filtered].sort((a, b) => shopSort === "active" ? Number(b.active) - Number(a.active) : shopSort === "stock" ? ((b.stock ?? Infinity) - (a.stock ?? Infinity)) : (b.cost || 0) - (a.cost || 0));
  const pages = Math.max(1, Math.ceil(sorted.length / 10)); shopPage = Math.min(shopPage, pages);
  const pageItems = sorted.slice((shopPage - 1) * 10, shopPage * 10);
  if (filtered.length) {
    $("cr-shop-empty").hidden = true;
  } else {
    const emptySpec = items.length
      ? {
          kind: "search",
          title: "No matching items",
          body: "Try a different item name, cost, or stock value.",
          compact: true,
        }
      : {
          kind: "empty",
          title: "No shop items yet",
          body: "Create a shop item members can order with Credits.",
          compact: true,
          actions: [{ label: "Create item", id: "crShopEmptyCreate", accent: true }],
        };
    renderEmpty($("cr-shop-empty"), emptySpec);
    if (!items.length) $("crShopEmptyCreate")?.addEventListener("click", () => openShop(), { once: true });
  }
  root.innerHTML = pageItems.map((i) => {
    const stock = i.stock === null ? "Unlimited" : `${i.stock} left`;
    return `<article class="cr-shop-row${i.active ? "" : " is-inactive"}">
      <div class="cr-shop-row-main">
        <button class="cr-shop-row-title" type="button" data-edit-shop="${esc(i.id)}">${esc(i.name)}</button>
        <p>${esc(i.description || "No description")}</p>
      </div>
      <dl class="cr-shop-row-facts">
        <div><dt>Cost</dt><dd>${i.cost} Credits</dd></div>
        <div><dt>Stock</dt><dd>${stock}</dd></div>
      </dl>
      <label class="cr-shop-row-availability">
        <span>${i.active ? "Available" : "Hidden"}</span>
        <input class="v3-toggle" type="checkbox" ${i.active ? "checked" : ""} data-toggle-shop="${esc(i.id)}" aria-label="Make ${esc(i.name)} available" />
      </label>
      <div class="cr-shop-row-actions">
        <button class="btn btn--sm" type="button" data-edit-shop="${esc(i.id)}">Edit</button>
        <button class="btn btn--sm btn--danger" type="button" data-del-shop="${esc(i.id)}">Disable</button>
      </div>
    </article>`;
  }).join("");
  const controls = $("cr-shop-controls"); if (controls) { controls.querySelector("[data-shop-page]").textContent = filtered.length ? `Page ${shopPage} of ${pages} (${filtered.length})` : ""; controls.querySelector("[data-shop-prev]").disabled = shopPage <= 1; controls.querySelector("[data-shop-next]").disabled = shopPage >= pages; }
  wireDynamicActions();
}
function render() {
  const usage = state.usage || {}, limits = state.limits || {}, current = tab();
  const rewardAtLimit = usage.rewardMappings != null && limits.rewardMappings != null && usage.rewardMappings >= limits.rewardMappings;
  const shopAtLimit = usage.shopItems != null && limits.shopItems != null && usage.shopItems >= limits.shopItems;
  const rewardUsage = $("cr-reward-usage");
  if (rewardUsage) rewardUsage.innerHTML = `${metric(usage.rewardMappings)} / ${metric(limits.rewardMappings)} ways to earn${rewardAtLimit ? ' · <a href="/dashboard/settings/billing">Billing limit reached — upgrade plan</a>' : ""}`;
  const addMapping = $("cr-add-mapping");
  if (addMapping) {
    addMapping.classList.toggle("is-disabled", rewardAtLimit);
    addMapping.title = rewardAtLimit ? "Upgrade your plan to add more ways to earn" : "";
    addMapping.setAttribute("aria-disabled", rewardAtLimit ? "true" : "false");
    addMapping.onclick = rewardAtLimit ? (e) => e.preventDefault() : (e) => {
      e.preventDefault();
      revealRewardPanel("cr-reward-create-form", true);
    };
  }
  if (current === "channel") {
    const connected = Boolean(state.channel?.externalId);
    $("cr-channel-connected").hidden = !connected; $("cr-channel-connect-wrap").hidden = connected;
    $("cr-channel-name").textContent = state.channel?.name || ""; $("cr-channel-id-input").value = state.channel?.externalId || ""; $("cr-channel-name-input").value = state.channel?.name || "";
    const expiry = state.channel?.tokenExpiresAt;
    const expiryDate = expiry ? new Date(expiry) : null;
    const tokenExpired = connected && (!expiryDate || expiryDate <= new Date());
    renderChannelHealth({ connected, tokenExpired, expiryDate, linkedAt: state.channel?.linkedAt });
    $("cr-usage").innerHTML = [usageCard(metric(usage.rewardMappings), metric(limits.rewardMappings), "ways to earn"), usageCard(metric(usage.shopItems), metric(limits.shopItems), "items"), usageCard(metric(usage.pendingRedemptions), metric(limits.pendingRedemptions), "pending orders"), usageCard(metric(usage.redemptionsPer30Days), metric(limits.redemptionsPer30Days), "orders / 30 days"), usageCard(metric(usage.newViewersPer30Days), metric(limits.newViewersPer30Days), "new members / 30 days")].join("");
    const auth = state.viewerAuth || {};
    $("cr-viewer-auth-kick").checked = auth.kick !== false; $("cr-viewer-auth-discord").checked = auth.discord !== false; const publicToggle = $("cr-viewer-auth-public"); if (publicToggle) publicToggle.checked = auth.public !== false;
  }
  if (current === "rules") {
    for (const id of ["cr-reward-submit", "cr-reward-create-submit"]) { const el = $(id); if (el) { el.disabled = rewardAtLimit; el.title = rewardAtLimit ? "Upgrade your plan to add more ways to earn" : ""; } }
    const mappings = state.mappings || [];
    if (!rewardCtrl) { rewardCtrl = new ListController({ root: $("cr-rewards"), tbody: "cr-reward-list", emptyEl: $("cr-reward-empty"), emptySpec: { kind: "empty", title: "No ways to earn yet", body: "Set how Kick rewards award credits to your members.", compact: true, actions: [{ label: "Create Kick reward", href: "/dashboard/rewards/rules#cr-reward-create-form", accent: true }] }, items: mappings, perPage: 10, searchFn: (m) => `${m.kick_reward_title} ${m.kick_reward_id} ${m.kick_reward_cost} ${m.credits}`, sortOptions: [{ key: "cost", label: "Kick cost", fn: (a, b) => (b.kick_reward_cost || 0) - (a.kick_reward_cost || 0) }, { key: "credits", label: "Credits", fn: (a, b) => (b.credits || 0) - (a.credits || 0) }, { key: "active", label: "Active first", fn: (a, b) => Number(b.active) - Number(a.active) }], emptyAllText: "No ways to earn yet.", emptyText: "No matching ways to earn.", renderItem: (m) => renderRewardRow(m), onRender: () => wireDynamicActions() }); mountListControls($("cr-rewards"), $("cr-mapping-toolbar"), $("cr-mapping-foot")); }
    else rewardCtrl.setItems(mappings);
    prefillEditFromQuery();
    revealRewardFromHash();
  }
  if (current === "shop") {
    $("cr-shop-usage").innerHTML = `${metric(usage.shopItems)} / ${metric(limits.shopItems)} active items${shopAtLimit ? ' · <a href="/dashboard/settings/billing">Billing limit reached — upgrade plan</a>' : ""}`;
    const submit = $("cr-shop-submit"); if (submit) { submit.disabled = shopAtLimit; submit.title = shopAtLimit ? "Upgrade your plan to add more items" : ""; }
    const create = $("cr-shop-new"); if (create) { create.disabled = shopAtLimit; create.title = shopAtLimit ? "Upgrade your plan to add more items" : ""; }
    shopItemsView = state.shopItems || []; renderShopCards(shopItemsView);
  }
  if (current === "viewers") {
    const viewers = state.viewers || [];
    if (!viewerCtrl) { viewerCtrl = new ListController({ root: $("cr-viewers"), tbody: "cr-viewer-list", emptyEl: $("cr-viewer-empty"), emptySpec: { kind: "empty", title: "No members yet", body: "Members who sign in will appear here after they use your YourRank site. Share your site to invite your first member.", compact: true, actions: [{ label: "Share your site", href: "/dashboard/leaderboard/share", accent: true }] }, items: viewers, perPage: 15, searchFn: (v) => `${memberIdentity(v)} ${memberPlatforms(v).join(" ")} ${v.block_reason || ""} ${v.blocked ? "blocked" : "active"}`, sortOptions: [{ key: "activity", label: "Recently active", fn: (a, b) => new Date(b.last_seen_at || b.last_earned_at || b.created_at || 0) - new Date(a.last_seen_at || a.last_earned_at || a.created_at || 0) }, { key: "joined", label: "Newest members", fn: (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0) }, { key: "balance", label: "Credit balance", fn: (a, b) => (b.balance || 0) - (a.balance || 0) }, { key: "status", label: "Blocked first", fn: (a, b) => Number(b.blocked) - Number(a.blocked) }], emptyAllText: "No members yet.", emptyText: "No matching members.", renderItem: (v) => renderViewerRow(v), onRender: () => wireDynamicActions() }); mountListControls($("cr-viewers"), $("cr-viewer-toolbar"), $("cr-viewer-foot")); }
    else viewerCtrl.setItems(viewers);
  }
  if (current === "overview") {
    renderOnboarding();
    const channel = $("cr-redemption-channel");
    if (state.channel?.externalId) { channel.innerHTML = `● Connected to @${esc(state.channel.name || state.channel.externalId)}`; channel.className = "v3-chip v3-chip--refunded"; } else { channel.innerHTML = '<a href="/dashboard/site/connections">Not connected · Connect Kick</a>'; channel.className = "v3-chip v3-chip--cancelled"; }
    $("cr-pending-counter").textContent = `${metric(usage.pendingRedemptions)} / ${metric(limits.pendingRedemptions)}`; $("cr-fulfilled-counter").textContent = `${metric(usage.redemptionsPer30Days)} / ${metric(limits.redemptionsPer30Days)}`;
    if ($("cr-analytics")) renderAnalytics();
  }
  if (current === "redemptions") {
    const redemptions = state.redemptions || [];
    if (!redemptionCtrl) { redemptionCtrl = new ListController({ root: $("cr-redemptions"), tbody: "cr-redemption-list", emptyEl: $("cr-redemption-empty"), emptySpec: { kind: "empty", title: "No orders yet", body: "Orders will appear after a member orders a shop item.", compact: true }, items: redemptions, perPage: 15, searchFn: (r) => `${r.kick_username || r.kick_user_id} ${r.item_name} ${r.status}`, sortOptions: [{ key: "queue", label: "Pending first", fn: (a, b) => Number(a.status !== "pending") - Number(b.status !== "pending") || new Date(b.created_at || 0) - new Date(a.created_at || 0) }, { key: "time", label: "Newest", fn: (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0) }, { key: "cost", label: "Cost", fn: (a, b) => (b.cost || 0) - (a.cost || 0) }, { key: "status", label: "Status", fn: (a, b) => (a.status || "").localeCompare(b.status || "") }], emptyAllText: "No orders yet.", emptyText: "No matching orders.", renderItem: (r) => renderRedemptionRow(r), onRender: () => wireDynamicActions() }); mountListControls($("cr-redemptions"), $("cr-redemption-toolbar"), $("cr-redemption-foot")); }
    else redemptionCtrl.setItems(redemptions);
  }
  if (current === "history") {
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
function renderOnboarding() {
  const wrap = $("cr-onboarding"); if (!wrap) return;
  let hidden = false;
  try { hidden = localStorage.getItem("cr-onboarding-hide") === "1"; } catch { void 0; }
  const connected = Boolean(state.channel?.externalId);
  const mappings = (state.mappings || []).filter((m) => m.active).length;
  const items = (state.shopItems || []).filter((i) => i.active).length;
  const redemptions = (state.redemptions || []).length;
  const steps = [{ id: 1, done: connected }, { id: 2, done: mappings > 0 }, { id: 3, done: items > 0 }, { id: 4, done: redemptions > 0 }, { id: 5, done: connected && mappings > 0 && items > 0 }];
  const current = steps.find((step) => !step.done)?.id;
  for (const step of steps) {
    const el = $(`cr-step-${step.id}`); if (!el) continue;
    el.classList.toggle("done", step.done); el.classList.toggle("current", current === step.id && !step.done);
  }
  const ready = steps[4].done;
  if (ready && !hidden) { hidden = true; try { localStorage.setItem("cr-onboarding-hide", "1"); } catch { void 0; } }
  wrap.hidden = hidden;
  const hide = $("cr-onboarding-hide"); if (hide) hide.hidden = false;
}
async function loadAnalytics() {
  const days = Number($("cr-analytics-days")?.value) || 30;
  for (const id of ["cr-stat-earned", "cr-stat-spent", "cr-stat-redemptions", "cr-stat-pending", "cr-stat-balance"]) setMetricLoading($(id));
  const bars = $("cr-credits-by-day");
  if (bars) {
    bars.setAttribute("aria-busy", "true");
    bars.innerHTML = '<span class="skeleton v3-skel-line" aria-hidden="true"></span>';
  }
  try {
    const data = await api("GET", sitePath(`/api/credits/analytics?days=${days}`));
    state.analytics = data; renderAnalytics(); setStatus("cr-analytics-status", "");
  } catch { setStatus("cr-analytics-status", "Analytics are temporarily unavailable.", true); }
}
function renderAnalytics() {
  const a = state.analytics; if (!a) return;
  const s = a.summary || {};
  const hasActivity = (a.topItems || []).length > 0 || (a.creditsByDay || []).length > 0 ||
    [s.periodEarned, s.periodSpent, s.redemptionsTotal, s.redemptionsPending, s.viewerBalance].some((value) => Number(value) > 0);
  if (hasActivity) {
    $("cr-stat-earned").innerHTML = `${s.periodEarned ?? 0} <small class="kpi-sub">All time: ${s.allTimeEarned ?? 0}</small>`;
    $("cr-stat-spent").innerHTML = `${s.periodSpent ?? 0} <small class="kpi-sub">All time: ${s.allTimeSpent ?? 0}</small>`;
    $("cr-stat-redemptions").textContent = s.redemptionsTotal ?? 0;
    $("cr-stat-pending").textContent = s.redemptionsPending ?? 0;
    $("cr-stat-balance").textContent = s.viewerBalance ?? 0;
  } else {
    // Analytics loaded and every counter really is zero — show the zeros
    // rather than the "data unavailable" placeholder.
    ["cr-stat-earned", "cr-stat-spent", "cr-stat-redemptions", "cr-stat-pending", "cr-stat-balance"].forEach((id) => setMetricEmpty($(id)));
  }
  const label = $("cr-analytics-days-label"); if (label) label.textContent = String(Number($("cr-analytics-days")?.value) || 30);
  const items = a.topItems || [];
  $("cr-top-items-list").innerHTML = items.map((i) => `<tr><td data-label="Item">${esc(i.name)}</td><td data-label="Orders" class="num">${i.redemptions}</td><td data-label="Credits spent" class="num">${i.credits_spent}</td></tr>`).join("");
  const topEmpty = $("cr-top-items-empty");
  if (items.length) topEmpty.hidden = true;
  else renderEmpty(topEmpty, { kind: "empty", title: "No items ordered yet", body: "Orders will appear after members order a shop item.", compact: true });
  renderCreditsByDay(a.creditsByDay || []);
}
function renderCreditsByDay(rows) {
  const container = $("cr-credits-by-day"); if (!container) return;
  container.innerHTML = ""; container.removeAttribute("role"); container.removeAttribute("aria-label"); container.removeAttribute("aria-busy");
  const empty = $("cr-credits-by-day-empty");
  if (!rows.length) {
    renderEmpty(empty, { kind: "empty", title: "No credit activity for this period", body: "Activity will appear after members earn or spend credits.", compact: true });
    return;
  }
  empty.hidden = true;
  const grouped = {};
  for (const row of rows) { grouped[row.day] = grouped[row.day] || { earn: 0, spend: 0 }; grouped[row.day][row.type] = row.total; }
  const days = Object.keys(grouped).sort(); const max = Math.max(1, ...days.map((day) => grouped[day].earn + grouped[day].spend));
  container.innerHTML = days.map((day) => {
    const g = grouped[day]; const total = g.earn + g.spend; const label = new Date(day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `<div class="cr-bar-col" title="${label}: ${total} (${g.earn} earned, ${g.spend} spent)"><div class="cr-bar-col-inner"><div class="cr-bar-earn" style="height:${(g.earn / max) * 100}%"></div><div class="cr-bar-spend" style="height:${(g.spend / max) * 100}%"></div></div></div>`;
  }).join("");
  container.setAttribute("role", "img"); const allTotal = days.reduce((sum, day) => sum + grouped[day].earn + grouped[day].spend, 0);
  container.setAttribute("aria-label", `Bar chart of credits across ${days.length} days with activity. Total: ${allTotal} credits.`);
}
function revealRewardPanel(formId, focus = false) {
  const form = $(formId);
  const details = form?.closest("details");
  if (!form || !details) return;
  details.parentElement?.querySelectorAll("details").forEach((panel) => {
    if (panel !== details) panel.open = false;
  });
  details.open = true;
  if (focus) {
    const firstField = form.querySelector("input:not([type='hidden']), select, textarea");
    firstField?.focus();
  }
}
function revealRewardFromHash() {
  const formId = location.hash.slice(1);
  if (formId === "cr-reward-form" || formId === "cr-reward-create-form") revealRewardPanel(formId);
}
function prefillEditFromQuery() {
  if (tab() !== "rules") return;
  const id = new URLSearchParams(location.search).get("edit");
  const m = (state.mappings || []).find((x) => String(x.id) === String(id));
  if (!m) return;
  $("cr-reward-id").value = m.id; $("cr-reward-kick-id").value = m.kick_reward_id; $("cr-reward-title").value = m.kick_reward_title; $("cr-reward-cost").value = m.kick_reward_cost; $("cr-reward-credits").value = m.credits;
  setStatus("cr-reward-status", "Editing way to earn.");
}
function editReward(id) {
  const q = new URLSearchParams(); q.set("edit", id); if (siteQuery()) q.set("siteId", siteQuery());
  // The entry point re-routes in place inside the persistent shell (`force`
  // re-runs the section even when only the query changed — same path,
  // different ?edit=) and falls back to a document load on standalone pages.
  requestDashboardRoute("rewards", "rules", { query: `?${q.toString()}`, force: true });
}
async function delReward(id, trigger) {
  const confirmed = await confirmPopover(trigger, "Disable way to earn", "This disables the way to earn; credit activity is retained.");
  if (!confirmed) return;
  setLoading(trigger, true, "Disabling…");
  try { await api("DELETE", sitePath(`/api/credits/rewards/${encodeURIComponent(id)}`)); await load(); }
  catch (err) { setStatus("cr-reward-status", err.message, true); } finally { setLoading(trigger, false); }
}
async function delShop(id, trigger) {
  if (!await showConfirmModal("Disable item", "Disable this item? It will no longer be available, but past orders stay in credit activity.", "Disable", true)) return;
  setLoading(trigger, true, "Disabling…");
  try { await api("DELETE", sitePath(`/api/credits/shop/${encodeURIComponent(id)}`)); await load(); }
  catch (err) { setStatus("cr-shop-status", err.message, true); } finally { setLoading(trigger, false); }
}
async function toggleBlock(id, blocked, trigger) {
  const next = !blocked;
  let reason = "";
  if (next) { reason = await showPromptModal("Block member", "Why are you blocking this member?", { confirmText: "Block", placeholder: "e.g. chargeback / abuse" }) || ""; if (!reason) return; }
  setLoading(trigger, true, next ? "Blocking…" : "Unblocking…");
  try { await api("POST", sitePath(`/api/credits/viewers/${encodeURIComponent(id)}/block`), { blocked: next, reason }); await load(); }
  catch (err) { setStatus("cr-viewer-status", err.message, true); } finally { setLoading(trigger, false); }
}
function wireDynamicActions() {
  document.querySelectorAll("[data-edit-reward]:not([data-wired])").forEach((b) => { b.dataset.wired = "1"; b.addEventListener("click", () => editReward(b.dataset.editReward)); });
  document.querySelectorAll("[data-del-reward]:not([data-wired])").forEach((b) => { b.dataset.wired = "1"; b.addEventListener("click", () => delReward(b.dataset.delReward, b)); });
  document.querySelectorAll("[data-edit-shop]:not([data-wired])").forEach((b) => { b.dataset.wired = "1"; b.addEventListener("click", () => openShop(state.shopItems.find((i) => i.id === b.dataset.editShop), b)); });
  document.querySelectorAll("[data-del-shop]:not([data-wired])").forEach((b) => { b.dataset.wired = "1"; b.addEventListener("click", () => delShop(b.dataset.delShop, b)); });
  document.querySelectorAll("[data-fulfill]:not([data-wired])").forEach((b) => { b.dataset.wired = "1"; b.addEventListener("click", () => updateRedemption(b.dataset.fulfill, "fulfilled", b)); });
  document.querySelectorAll("[data-cancel]:not([data-wired])").forEach((b) => { b.dataset.wired = "1"; b.addEventListener("click", () => updateRedemption(b.dataset.cancel, "cancelled", b)); });
  document.querySelectorAll("[data-block]:not([data-wired])").forEach((b) => { b.dataset.wired = "1"; b.addEventListener("click", () => toggleBlock(b.dataset.block, b.dataset.blocked === "1", b)); });
  document.querySelectorAll("[data-tip-viewer]:not([data-wired])").forEach((b) => { b.dataset.wired = "1"; b.addEventListener("click", () => openTip(b.dataset.tipViewer, b.dataset.viewerName)); });
  document.querySelectorAll("[data-toggle-shop]:not([data-wired])").forEach((b) => { b.dataset.wired = "1"; b.addEventListener("change", () => toggleShop(b.dataset.toggleShop, b)); });
  document.querySelectorAll("[data-toggle-reward]:not([data-wired])").forEach((b) => { b.dataset.wired = "1"; b.addEventListener("change", () => toggleReward(b.dataset.toggleReward, b)); });
}
function ensureShopControls(hasItems = false) {
  const root = $("cr-shop-list"); if (!root || $("cr-shop-controls")) return;
  const controls = document.createElement("div"); controls.id = "cr-shop-controls"; controls.className = "list-controls";
  controls.hidden = !hasItems;
  controls.innerHTML = '<div class="list-controls-row"><input class="list-search" type="search" placeholder="Search items…" aria-label="Search items" /><select class="list-sort" aria-label="Sort items"><option value="cost">Cost</option><option value="stock">Stock</option><option value="active">Active first</option></select></div><div class="list-pagination"><button class="btn btn--sm" type="button" data-shop-prev>Previous</button><span data-shop-page></span><button class="btn btn--sm" type="button" data-shop-next>Next</button></div>';
  root.parentElement.insertBefore(controls, root);
  controls.querySelector(".list-search").addEventListener("input", (e) => { shopSearch = e.target.value.toLowerCase(); renderShopCards(shopItemsView); });
  controls.querySelector(".list-sort").addEventListener("change", (e) => { shopSort = e.target.value; renderShopCards(shopItemsView); });
  controls.querySelector("[data-shop-prev]").addEventListener("click", () => { shopPage = Math.max(1, shopPage - 1); renderShopCards(shopItemsView); });
  controls.querySelector("[data-shop-next]").addEventListener("click", () => { shopPage++; renderShopCards(shopItemsView); });
}
let shopPage = 1;
function mountListControls(root, toolbar, foot) {
  const controls = root?.querySelector(":scope > .list-controls");
  if (!controls) return;
  controls._mountedTargets = [toolbar, foot].filter(Boolean);
  toolbar?.appendChild(controls.querySelector(".list-controls-row"));
  foot?.appendChild(controls.querySelector(".list-pagination"));
  controls._mountedTargets.forEach((target) => { target.hidden = controls.hidden; });
  controls.remove();
}
let drawerTrigger;
function openShop(item, trigger) {
  drawerTrigger = trigger || $("cr-shop-new");
  $("cr-shop")?.classList.add("has-drawer");
  $("cr-shop-drawer").hidden = false; $("cr-shop-drawer-title").textContent = item ? "Edit item" : "Create item"; $("cr-shop-item-id").value = item?.id || ""; $("cr-shop-name").value = item?.name || ""; $("cr-shop-desc").value = item?.description || ""; $("cr-shop-cost").value = item?.cost || 100; $("cr-shop-stock").value = item?.stock === null ? "" : (item?.stock ?? ""); $("cr-shop-active").checked = item?.active !== false; 
  $("cr-shop-name").focus(); 
}
function closeShop() { $("cr-shop-drawer").hidden = true; $("cr-shop")?.classList.remove("has-drawer"); drawerTrigger?.focus(); }
function openTip(viewerId, username) {
  const drawer = $("cr-tip-drawer");
  if (!drawer) return;
  drawer.hidden = false;
  $("cr-viewers")?.classList.add("has-drawer");
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
  drawer.hidden = true;
  $("cr-viewers")?.classList.remove("has-drawer");
}
let activePopover;
function closePopover(result = false) {
  if (!activePopover) return;
  const { el, resolve, trigger } = activePopover; el.remove(); activePopover = null; trigger?.focus(); resolve(result);
}
function confirmPopover(trigger, title, body) {
  closePopover();
  return new Promise((resolve) => {
    const el = document.createElement("div"); el.className = "cr-confirm-popover"; el.setAttribute("role", "dialog");
    el.innerHTML = `<strong>${esc(title)}</strong><p>${esc(body)}</p><div><button type="button" data-pop-no>No</button><button type="button" class="btn--accent" data-pop-yes>Confirm</button></div>`;
    document.body.appendChild(el); activePopover = { el, resolve, trigger };
    const rect = trigger.getBoundingClientRect(); const width = 260; let left = Math.min(Math.max(8, rect.left), innerWidth - width - 8); let top = rect.bottom + 8;
    if (top + el.offsetHeight > innerHeight - 8) top = Math.max(8, rect.top - el.offsetHeight - 8);
    el.style.left = `${left}px`; el.style.top = `${top}px`; el.querySelector("[data-pop-no]").focus();
    el.querySelector("[data-pop-no]").addEventListener("click", () => closePopover(false)); el.querySelector("[data-pop-yes]").addEventListener("click", () => closePopover(true));
    setTimeout(() => document.addEventListener("click", outsidePopover, { capture: true }), 0);
    function outsidePopover(e) { if (!activePopover || el.contains(e.target) || e.target === trigger) return; document.removeEventListener("click", outsidePopover, { capture: true }); closePopover(false); }
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); document.removeEventListener("click", outsidePopover, { capture: true }); closePopover(false); } });
  });
}
async function updateRedemption(id, status, trigger) {
  const body = status === "cancelled" ? "This restores the member’s credits and returns one item to stock." : "This marks the item as fulfilled.";
  if (!await confirmPopover(trigger, status === "cancelled" ? "Cancel order" : "Fulfil order", body)) return;
  setLoading(trigger, true, "Saving…");
  try { await api("POST", sitePath(`/api/credits/redemptions/${encodeURIComponent(id)}`), { status }); await load(); }
  catch (err) { setStatus("cr-redemption-status", err.message, true); } finally { setLoading(trigger, false); }
}
async function toggleShop(id, trigger) {
  const item = state.shopItems.find((i) => i.id === id); if (!item) return;
  setLoading(trigger, true, "Saving…");
  try { await api("POST", sitePath("/api/credits/shop"), { ...item, active: trigger.checked }); await load(); }
  catch (err) { trigger.checked = item.active; setStatus("cr-shop-status", err.message, true); } finally { setLoading(trigger, false); }
}
async function toggleReward(id, trigger) {
  const m = state.mappings.find((x) => x.id === id); if (!m) return;
  setLoading(trigger, true, "Saving…");
  try {
    if (trigger.checked) await api("POST", sitePath("/api/credits/rewards"), { id: m.id, kickRewardId: m.kick_reward_id, kickRewardTitle: m.kick_reward_title, kickRewardCost: m.kick_reward_cost, credits: m.credits });
    else if (await confirmPopover(trigger, "Disable way to earn", "This disables the way to earn; credit activity is retained.")) await api("DELETE", sitePath(`/api/credits/rewards/${m.id}`));
    else { trigger.checked = true; return; }
    await load();
  } catch (err) { trigger.checked = m.active; setStatus("cr-reward-status", err.message, true); } finally { setLoading(trigger, false); }
}
async function load() {
  clearLoadError($("cr-empty"), false);
  applyOAuthContext();
  setState({ CREDITS_STATUS: "loading" });
  setCreditsPanelLoading(true);
  setMetricLoading($("cr-pending-counter"));
  setMetricLoading($("cr-fulfilled-counter"));
  rewardCtrl?.setLoading(true);
  viewerCtrl?.setLoading(true);
  redemptionCtrl?.setLoading(true);
  setGlobalLoading(true);
  try {
    const shell = await loadBoardShell();
    activeSiteId = shell.activeSiteId;
    updateKickAuthLinks();
    state = await api("GET", sitePath("/api/credits/status"));
    setState({ CREDITS_STATUS: "ready" });
    render();
    showOAuthMessage({ finalize: true });
    if (tab() === "history") {
      const viewer = new URLSearchParams(location.search).get("viewer");
      const input = $("cr-history-username");
      if (viewer && input && !input.value) input.value = viewer;
      await loadActivity({ reset: true });
    }
    if (tab() === "overview" && $("cr-analytics")) await loadAnalytics();
    preserveSiteContextLinks();
    $("cr-app").hidden = false; $("cr-empty").hidden = true;
  } catch (err) {
    showOAuthMessage({ finalize: true });
    setState({ CREDITS_STATUS: "error" });
    logError("load-credits-dashboard", err);
    renderError($("cr-empty"), { title: "Couldn't load your credits dashboard", body: "Your rewards data could not be loaded.", retry: () => load().catch(() => {}) });
    $("cr-app").hidden = false;
    window.__yrBoot?.signal();
    throw err;
  } finally { setGlobalLoading(false); }
}
function wireActions() {
  if (wired) return;
  wired = true;
  wireAutosave("cr-channel-form", "channel"); wireAutosave("cr-reward-form", "reward"); wireAutosave("cr-reward-create-form", "reward-create"); wireAutosave("cr-shop-form", "shop"); wireAutosave("cr-viewer-auth-form", "viewer-auth"); wireAutosave("cr-history-form", "history");
  $("cr-channel-form")?.addEventListener("submit", async (e) => {
    e.preventDefault(); const btn = e.submitter || $("cr-channel-submit"); setLoading(btn, true, "Saving…");
    try { const data = await api("POST", sitePath("/api/credits/connect"), { externalId: $("cr-channel-id-input").value.trim(), name: $("cr-channel-name-input").value.trim() }); state.channel = data.channel; setStatus("cr-channel-status", "Channel saved."); render(); }
    catch (err) { setStatus("cr-channel-status", err.message, true); } finally { setLoading(btn, false); }
  });
  $("cr-channel-disconnect")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget; setLoading(btn, true, "Disconnecting…");
    try { await api("POST", sitePath("/api/kick/disconnect", activeSiteId)); state.channel = { externalId: null, name: null }; render(); setStatus("cr-channel-status", "Disconnected."); }
    catch (err) { setStatus("cr-channel-status", err.message, true); } finally { setLoading(btn, false); }
  });
  $("cr-reward-form")?.addEventListener("submit", async (e) => {
    e.preventDefault(); const btn = e.submitter || $("cr-reward-submit"); setLoading(btn, true, "Saving…");
    try { await api("POST", sitePath("/api/credits/rewards"), { id: $("cr-reward-id").value || undefined, kickRewardId: $("cr-reward-kick-id").value.trim(), kickRewardTitle: $("cr-reward-title").value.trim(), kickRewardCost: Number($("cr-reward-cost").value), credits: Number($("cr-reward-credits").value) }); setStatus("cr-reward-status", "Way to earn saved."); $("cr-reward-form").reset(); $("cr-reward-id").value = ""; await load(); }
    catch (err) { setStatus("cr-reward-status", err.message, true); } finally { setLoading(btn, false); }
  });
  $("cr-reward-create-form")?.addEventListener("submit", async (e) => {
    e.preventDefault(); const btn = e.submitter || $("cr-reward-create-submit"); setLoading(btn, true, "Creating…");
    try { await api("POST", sitePath("/api/credits/rewards/create"), { title: $("cr-reward-create-title").value.trim(), cost: Number($("cr-reward-create-cost").value), credits: Number($("cr-reward-create-credits").value), description: $("cr-reward-create-desc").value.trim(), backgroundColor: $("cr-reward-create-color").value }); setStatus("cr-reward-create-status", "Kick reward created and linked to credits."); $("cr-reward-create-form").reset(); $("cr-reward-create-color").value = "#00e701"; await load(); }
    catch (err) { if (err?.code === "kick_reconnect_required") markKickNeedsAttention(); setStatus("cr-reward-create-status", err.message, true); } finally { setLoading(btn, false); }
  });
  $("cr-shop-new")?.addEventListener("click", () => openShop()); $("cr-shop-close")?.addEventListener("click", closeShop); $("cr-shop-cancel")?.addEventListener("click", closeShop);

  $("cr-shop-form")?.addEventListener("submit", async (e) => {
    e.preventDefault(); const btn = e.submitter || $("cr-shop-submit"); setLoading(btn, true, "Saving…");
    try { await api("POST", sitePath("/api/credits/shop"), { id: $("cr-shop-item-id").value || undefined, name: $("cr-shop-name").value.trim(), description: $("cr-shop-desc").value.trim(), cost: Number($("cr-shop-cost").value), stock: $("cr-shop-stock").value === "" ? null : Number($("cr-shop-stock").value), active: $("cr-shop-active").checked }); setStatus("cr-shop-status", "Shop item saved."); closeShop(); await load(); }
    catch (err) { setStatus("cr-shop-status", err.message, true); } finally { setLoading(btn, false); }
  });
  $("cr-tip-open-btn")?.addEventListener("click", () => openTip("", ""));
  $("cr-tip-close")?.addEventListener("click", closeTip);
  $("cr-tip-cancel")?.addEventListener("click", closeTip);
  document.querySelectorAll(".cr-tip-preset").forEach((b) => b.addEventListener("click", () => {
    const amt = b.dataset.amount;
    const input = $("cr-tip-amount");
    if (input && amt) input.value = amt;
  }));
  $("cr-tip-form")?.addEventListener("submit", async (e) => {
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

    setLoading(btn, true, "Sending…");
    try {
      const endpoint = viewerId ? sitePath(`/api/credits/viewers/${encodeURIComponent(viewerId)}/balance`) : sitePath("/api/credits/tip");
      await api("POST", endpoint, { delta: amount, reason, kickUsername: username });
      setStatus("cr-tip-status", `Successfully sent +${amount} credits to @${username || "member"}!`);
      setTimeout(() => {
        closeTip();
        load();
      }, 900);
    } catch (err) {
      setStatus("cr-tip-status", err.message, true);
    } finally {
      setLoading(btn, false);
    }
  });

  $("cr-viewer-auth-form")?.addEventListener("submit", async (e) => {
    e.preventDefault(); const btn = e.submitter || $("cr-viewer-auth-submit"); setLoading(btn, true, "Saving…");
    try { state.viewerAuth = await api("POST", "/api/credits/viewer-auth", { kick: $("cr-viewer-auth-kick").checked, discord: $("cr-viewer-auth-discord").checked, public: $("cr-viewer-auth-public").checked }); setStatus("cr-viewer-auth-status", "Member login settings saved."); }
    catch (err) { setStatus("cr-viewer-auth-status", err.message, true); } finally { setLoading(btn, false); }
  });
  $("cr-history-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    loadActivity({ reset: true }).catch((err) => setStatus("cr-history-status", err.message, true));
  });
  $("cr-history-load-more")?.addEventListener("click", () => loadActivity({ reset: false }).catch((err) => setStatus("cr-history-status", err.message, true)));
  $("cr-analytics-days")?.addEventListener("change", loadAnalytics);
  $("cr-onboarding-hide")?.addEventListener("click", () => { try { localStorage.setItem("cr-onboarding-hide", "1"); } catch { void 0; } $("cr-onboarding").hidden = true; });
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
      empty.innerHTML = inlineStateHtml({ kind: "empty", title: "No credit activity found", body: "This member has signed in but has not earned or spent credits yet. Try another member or activity type." });
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
  list.innerHTML = boards.map((b) => `<tr><td data-label="Site"><b>${esc(b.name || b.slug)}</b><br><span class="hint">${esc(b.slug)}</span></td><td data-label="Balance" class="num">${b.balance}</td><td data-label="Earned" class="num">${b.totalEarned}</td><td data-label="Spent" class="num">${b.totalSpent}</td><td data-label="Pending" class="num">${b.redemptionsPending}</td><td data-label="Orders" class="num">${b.redemptionsTotal}</td><td data-label="Actions" class="ta-r"><a class="btn btn--sm" href="/dashboard/site/connections?siteId=${esc(b.siteId)}">Connect Kick</a></td></tr>`).join("");
  if (empty) {
    empty.innerHTML = boards.length ? "" : inlineStateHtml({ kind: "empty", title: "No sites found", body: "This member has no activity on your sites." });
    empty.hidden = boards.length > 0;
  }
}
if ($("cr-app") && !window.__yrSpaShell) {
  wireActions();
  load().then(() => window.__yrBoot?.signal()).catch(() => {});
}

// ---- Persistent-shell lifecycle ----
//
// When this module is imported as a fragment by the dynamic-section loader
// (window.__yrSpaShell is set), the auto-init above is skipped and the shell
// calls enter() explicitly. enter() resets module state so re-entering the
// Rewards area re-wires and re-loads fresh data; leave() clears timers so
// nothing leaks when the operator navigates away.

export function enter() {
  // Reset so re-entry re-wires event handlers against the freshly injected DOM.
  wired = false;
  state = {};
  activeSiteId = "";
  pendingOAuthFeedback = null;
  activityEvents = [];
  activityCursor = null;
  activityLoading = false;
  shopItemsView = [];
  shopSearch = "";
  shopSort = "cost";
  wireActions();
  load().then(() => window.__yrBoot?.signal()).catch(() => {});
}

export function leave() {
  // Clear all status toast timers so they don't fire into a detached DOM.
  for (const timer of statusClearTimers.values()) clearTimeout(timer);
  statusClearTimers.clear();
  // Release any controller/poller references held by the list controllers.
  viewerCtrl?.destroy?.();
  redemptionCtrl?.destroy?.();
  rewardCtrl?.destroy?.();
  viewerCtrl = redemptionCtrl = rewardCtrl = undefined;
}
