// Viewer account (/me) client: the member's YourRank account, their credits on
// every streamer site, and one creator's detail at a time.
//
// The open creator lives in the URL as /me?site=<slug>, so Back, Forward, a
// hard refresh and a shared link all land where the member expects. The page
// owns its own confirmation dialog (window.YRDialog, loaded by the page) and
// never imports dashboard code.
const SITE_PARAM = "site";

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleString() : "—"; }
function fmtNum(n) { return Number(n || 0).toLocaleString("en-US"); }

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/);
  return m ? m[1] : "";
}

async function api(method, path, body) {
  const opts = { method, credentials: "same-origin", headers: { "x-csrf-token": csrf() } };
  if (body) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let state = {};
let selectedSlug = null;
let redeemingItemId = null;
const redeemKeys = {};

// The API answers with short internal codes for some failures. Members see a
// sentence they can act on; anything unrecognised falls back to the caller's
// own wording rather than leaking server vocabulary.
const ERROR_MESSAGES = Object.freeze({
  unauthorized: "Your session expired. Log in again.",
  "site not found": "That site isn't available any more.",
  "rate limited": "Too many attempts. Wait a moment and try again.",
  "insufficient balance": "You don't have enough credits for that yet.",
  "item not found": "That reward is no longer available.",
  "out of stock": "That reward just went out of stock.",
  "viewer blocked": "You can't order on this site right now. Ask the streamer.",
  "invalid csrf": "Your session expired. Reload the page and try again.",
});

function errorText(message, fallback) {
  if (!message) return fallback;
  if (ERROR_MESSAGES[message]) return ERROR_MESSAGES[message];
  // Server-authored sentences (capacity, monthly limits, password) are already
  // member-facing; terse codes and "HTTP 500" are not.
  const sentence = /^[A-Z].*[.!?]$/.test(message) && !/^HTTP /.test(message);
  return sentence ? message : fallback;
}

const STATUS_IDS = ["vd-login-status", "vd-account-status", "vd-boards-status", "vd-site-status", "vd-drop-status"];

function setStatus(id, msg, err) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg || "";
  el.className = msg && err ? "status error" : "status";
}

function clearStatuses(ids) {
  (ids || STATUS_IDS).forEach((id) => setStatus(id, ""));
}

function setLoading(idOrEl, loading, text = "Loading…") {
  const el = typeof idOrEl === "string" ? $(idOrEl) : idOrEl;
  if (!el) return;
  if (loading) {
    el.dataset.origText = el.textContent;
    el.disabled = true;
    el.setAttribute("aria-busy", "true");
    el.classList.add("btn--loading");
    el.textContent = text;
  } else {
    el.disabled = false;
    el.removeAttribute("aria-busy");
    el.classList.remove("btn--loading");
    el.textContent = el.dataset.origText || el.textContent;
    delete el.dataset.origText;
  }
}

function setGlobalLoading(loading) {
  const el = $("vd-loading");
  if (el) el.hidden = !loading;
}

function focusEl(id) {
  const el = $(id);
  if (el && typeof el.focus === "function") el.focus();
}

// Every state the backend can report, named in the member's words. Cancelled
// and refunded are distinct outcomes and are never collapsed into one label.
const ORDER_STATUS = Object.freeze({
  pending: "Pending",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
  refunded: "Refunded",
});

// One client shape for an order. The API returns camelCase; a freshly placed
// order is built locally, and both must render identically.
function normalizeRedemption(r) {
  return {
    id: r.id,
    itemName: r.itemName || r.item_name || "Reward",
    cost: Number(r.cost || 0),
    status: r.status || "pending",
    createdAt: r.createdAt || r.created_at || null,
  };
}

/* ── history ─────────────────────────────────────────────────────── */

function siteFromUrl() {
  return new URLSearchParams(window.location.search).get(SITE_PARAM) || null;
}

function setUrl(slug, replace) {
  const url = new URL(window.location.href);
  if (slug) url.searchParams.set(SITE_PARAM, slug);
  else url.searchParams.delete(SITE_PARAM);
  const next = `${url.pathname}${url.search}${url.hash}`;
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ site: slug || null }, "", next);
}

// Back/Forward: the URL is the source of truth, so re-derive the view from it.
window.addEventListener("popstate", () => { syncFromUrl().catch(() => {}); });

async function syncFromUrl() {
  if (!state.viewer) return;
  const slug = siteFromUrl();
  if (!slug) {
    selectedSlug = null;
    state.current = null;
    showList({ focus: true });
    return;
  }
  if (slug === selectedSlug && state.current) {
    showDetail({ focus: true });
    return;
  }
  await openSite(slug, { history: "none", focus: true });
}

/* ── views ───────────────────────────────────────────────────────── */

function showList({ focus = false } = {}) {
  $("vd-login-card").hidden = true;
  $("vd-profile").hidden = false;
  $("vd-boards-card").hidden = false;
  $("vd-site-card").hidden = true;
  setStatus("vd-site-status", "");
  if (focus) focusEl("vd-boards-heading");
}

function showDetail({ focus = false } = {}) {
  $("vd-login-card").hidden = true;
  $("vd-profile").hidden = false;
  $("vd-boards-card").hidden = true;
  $("vd-site-card").hidden = false;
  if (focus) focusEl("vd-site-name");
}

function renderLoggedOut() {
  state = {};
  selectedSlug = null;
  $("vd-login-card").hidden = false;
  $("vd-profile").hidden = true;
  $("vd-boards-card").hidden = true;
  $("vd-site-card").hidden = true;
}

async function load() {
  setGlobalLoading(true);
  try {
    const data = await api("GET", "/api/viewer/me");
    state = { ...data, redemptions: (data.redemptions || []).map(normalizeRedemption), current: state.current };
    if (!state.viewer) { renderLoggedOut(); return; }
    renderAccount();
    renderBoards();
    if (selectedSlug && state.current) showDetail();
    else showList();
  } catch (err) {
    if (err.message === "unauthorized") renderLoggedOut();
    else setStatus("vd-login-status", errorText(err.message, "We couldn't load your account. Try again."), true);
  } finally {
    setGlobalLoading(false);
  }
}

function renderAccount() {
  const v = state.viewer;
  if (!v) return;
  const name = v.discordUsername || v.kickUsername || "Member";
  $("vd-username").textContent = name;
  if (v.avatarUrl) {
    $("vd-avatar").src = v.avatarUrl;
    $("vd-avatar").alt = name;
    $("vd-avatar").hidden = false;
  } else {
    $("vd-avatar").hidden = true;
  }
  const providerName = v.provider === "kick" ? "Kick" : v.provider === "discord" ? "Discord" : "YourRank";
  const linkedAt = v.provider === "kick" ? v.kickLinkedAt : v.provider === "discord" ? v.discordLinkedAt : null;
  $("vd-identity").textContent = `Logged in with ${providerName} as @${name}${linkedAt ? " · linked " + fmtDate(linkedAt) : ""}`;
  $("vd-wrong-account").hidden = false;
}

function renderBoards() {
  const boards = state.boards || [];
  $("vd-boards-empty").hidden = boards.length > 0;
  $("vd-boards").innerHTML = boards.map((b) => `
    <div class="vd-card-row">
      <div class="vd-card-main">
        <div class="vd-card-title">${esc(b.name || b.slug)}</div>
        <div class="hint">${fmtNum(b.balance)} free credits${b.blocked ? " · ordering disabled" : ""}</div>
      </div>
      <div class="vd-card-side">
        <button class="btn btn--sm" type="button" data-view-site="${esc(b.slug)}" aria-label="Open ${esc(b.name || b.slug)}">Open</button>
      </div>
    </div>
  `).join("");

  $("vd-boards").querySelectorAll("[data-view-site]").forEach((b) => {
    b.addEventListener("click", () => openSite(b.dataset.viewSite, { btn: b, focus: true }));
  });
}

/* ── creator detail ──────────────────────────────────────────────── */

// history: "push" from the list, "replace" for a deep link, "none" for popstate.
async function openSite(slug, { btn = null, history = "push", focus = false } = {}) {
  if (btn) setLoading(btn, true, "Opening…");
  setStatus("vd-boards-status", "");
  try {
    const data = await api("GET", `/api/viewer/site?slug=${encodeURIComponent(slug)}`);
    data.redemptions = (data.redemptions || []).map(normalizeRedemption);
    state.current = data;
    selectedSlug = slug;
    if (history === "push") setUrl(slug, false);
    else if (history === "replace") setUrl(slug, true);
    renderSite();
    showDetail({ focus });
  } catch (err) {
    state.current = null;
    selectedSlug = null;
    setUrl(null, true);
    showList({ focus });
    setStatus("vd-boards-status", errorText(err.message, "We couldn't open that site. Try again."), true);
  } finally {
    if (btn) setLoading(btn, false);
  }
}

function renderSite() {
  const data = state.current;
  if (!data) return;

  $("vd-site-name").textContent = data.site.name || data.site.slug;
  const channel = data.site.kickChannelName;
  $("vd-site-streamer").textContent = channel
    ? `Kick channel: @${channel}`
    : "Streamer site";

  const v = data.viewer || { balance: 0, blocked: false };
  $("vd-site-balance").textContent = fmtNum(v.balance);

  // The creator's own site is the canonical place to see everything they offer.
  const visit = $("vd-site-visit");
  if (visit) {
    visit.href = `/${encodeURIComponent(data.site.slug)}`;
    visit.textContent = `Visit ${data.site.name || data.site.slug}`;
    visit.hidden = false;
  }

  const earnHint = $("vd-earn-hint");
  if (earnHint) {
    earnHint.textContent = channel
      ? `Earn credits by using @${channel}'s linked Kick rewards during a live stream.`
      : "Earn credits by using the streamer's linked Kick rewards during a live stream.";
  }

  const items = data.shopItems || [];
  $("vd-shop-empty").hidden = items.length > 0;
  $("vd-shop-list").innerHTML = items.map((i) => {
    const isRedeeming = redeemingItemId === i.id;
    const inStock = i.stock === null || i.stock === undefined || i.stock > 0;
    const canBuy = v && !v.blocked && v.balance >= i.cost && inStock && !isRedeeming;
    // Why an Order button is unavailable is said in words, never left to the
    // disabled styling alone.
    const state = v.blocked
      ? "Ordering disabled on this site"
      : !inStock
        ? "Out of stock"
        : v.balance < i.cost
          ? `Not enough credits — ${fmtNum(i.cost - v.balance)} more needed`
          : i.stock !== null && i.stock !== undefined && i.stock <= 3
            ? `${i.stock} left`
            : "";
    return `
      <div class="vd-card-row">
        <div class="vd-card-main">
          <div class="vd-card-title">${esc(i.name)}</div>
          ${i.description ? `<div class="hint">${esc(i.description)}</div>` : ""}
        </div>
        <div class="vd-card-side">
          <div class="vd-card-cost">${fmtNum(i.cost)} credits</div>
          ${state ? `<div class="hint">${esc(state)}</div>` : ""}
          <button class="btn btn--sm" type="button" data-redeem="${esc(i.id)}" aria-label="Order ${esc(i.name)}" ${canBuy ? "" : "disabled"}>Order</button>
        </div>
      </div>
    `;
  }).join("");

  $("vd-shop-list").querySelectorAll("[data-redeem]").forEach((b) => {
    b.addEventListener("click", () => redeem(b.dataset.redeem, b));
  });

  const redemptions = (data.redemptions || []).map(normalizeRedemption);
  $("vd-redemptions-empty").hidden = redemptions.length > 0;
  $("vd-redemptions-list").innerHTML = redemptions.map((r) => {
    const statusLabel = ORDER_STATUS[r.status] || "Pending";
    return `
    <div class="vd-card-row vd-redemption-row">
      <div class="vd-card-main">
        <div class="vd-card-title">${esc(r.itemName)}</div>
        <div class="hint">${fmtNum(r.cost)} credits · ${fmtDate(r.createdAt)}</div>
      </div>
      <div class="vd-card-side">
        <span class="pill pill--${r.status === "pending" ? "muted" : r.status === "fulfilled" ? "good" : "bad"}">${esc(statusLabel)}</span>
      </div>
    </div>
  `}).join("");

  renderEvents();
}

function renderEvents() {
  const data = state.current;
  if (!data) return;

  const dropClaim = $("vd-drop-claim");
  const eventsEmpty = $("vd-events-empty");

  dropClaim.hidden = !(data.activeDropCount > 0);
  eventsEmpty.hidden = data.activeDropCount > 0;
}

$("vd-drop-claim-btn")?.addEventListener("click", claimDrop);

async function claimDrop() {
  const input = $("vd-drop-code");
  const code = String(input.value).trim().toUpperCase();
  if (!code) {
    setStatus("vd-drop-status", "Enter a code.", true);
    return;
  }
  const btn = $("vd-drop-claim-btn");
  setLoading(btn, true, "Claiming…");
  try {
    const data = await api("POST", "/api/events/drops/claim", { site: state.current.site.slug, code });
    setStatus("vd-drop-status", `+${data.pointsAwarded} credits claimed.`, false);
    state.current.viewer = state.current.viewer || { balance: 0, blocked: false };
    state.current.viewer.balance = data.newBalance;
    $("vd-drop-code").value = "";
    renderSite();
  } catch (err) {
    setStatus("vd-drop-status", errorText(err.message, "We couldn't claim that code. Check it and try again."), true);
  } finally {
    setLoading(btn, false);
  }
}

// The page loads /assets/dialog.js before this module; without it we refuse the
// order rather than fall back to the browser's native confirm().
async function confirmOrder(item) {
  const dialog = window.YRDialog;
  if (!dialog) {
    setStatus("vd-site-status", "Ordering is unavailable right now. Reload the page and try again.", true);
    return false;
  }
  const balance = state.current?.viewer?.balance;
  const left = typeof balance === "number" && balance >= item.cost
    ? ` You'd have ${fmtNum(balance - item.cost)} credits left.`
    : "";
  return dialog.confirm({
    title: "Confirm order",
    body: `Order ${item.name} for ${fmtNum(item.cost)} free credits.${left} Credits have no cash value.`,
    confirmText: "Place order",
  });
}

async function redeem(shopItemId, btn) {
  const slug = state.current?.site?.slug;
  if (!slug) return;
  const item = (state.current.shopItems || []).find((i) => i.id === shopItemId);
  if (!item) return;
  setStatus("vd-site-status", "");
  if (!await confirmOrder(item)) return;
  if (btn) setLoading(btn, true, "Placing order…");

  // Tie the idempotency key to the item, not just the DOM node, so retries and
  // rapid clicks resolve to the same order. The key is only cleared on success.
  let idempotencyKey = redeemKeys[shopItemId] || btn?.dataset.redeemKey;
  if (!idempotencyKey) {
    idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    redeemKeys[shopItemId] = idempotencyKey;
  }
  if (btn) btn.dataset.redeemKey = idempotencyKey;

  redeemingItemId = shopItemId;

  try {
    const data = await api("POST", "/api/viewer/redeem", { slug, shopItemId, idempotencyKey });
    // The member stays in this creator's detail: apply the server's balance and
    // the new order in place instead of reloading the whole account.
    state.current.viewer = state.current.viewer || { balance: 0, blocked: false };
    state.current.viewer.balance = data.balance;
    state.current.redemptions = state.current.redemptions || [];
    state.current.redemptions.unshift(normalizeRedemption({
      id: data.redemptionId,
      itemName: data.itemName || item.name,
      cost: data.itemCost ?? item.cost,
      status: data.status || "pending",
      createdAt: new Date().toISOString(),
    }));
    const board = (state.boards || []).find((b) => b.slug === slug);
    if (board) board.balance = data.balance;
    delete redeemKeys[shopItemId];
    setStatus("vd-site-status", `Order placed for ${item.name}. The streamer will confirm it.`, false);
  } catch (err) {
    setStatus("vd-site-status", errorText(err.message, "We couldn't place that order. Try again."), true);
  } finally {
    redeemingItemId = null;
    if (btn) setLoading(btn, false);
    // Re-render so the visible Order button reflects the latest balance and
    // order state, then put focus back on the control the member used.
    if (state.current) {
      renderSite();
      renderBoards();
      const again = $("vd-shop-list").querySelector(`[data-redeem="${shopItemId}"]`);
      if (again && !again.disabled) again.focus();
      else focusEl("vd-site-status");
    }
  }
}

$("vd-logout")?.addEventListener("click", async () => {
  const btn = $("vd-logout");
  setLoading(btn, true, "Logging out…");
  try {
    await api("POST", "/api/viewer/logout");
    clearStatuses();
    setUrl(null, true);
    renderLoggedOut();
  } catch (err) { setStatus("vd-account-status", errorText(err.message, "We couldn't sign you out. Try again."), true); }
  finally { setLoading(btn, false); }
});

$("vd-back")?.addEventListener("click", () => {
  state.current = null;
  selectedSlug = null;
  setUrl(null, false);
  showList({ focus: true });
  load().catch(() => {});
});

$("vd-switch")?.addEventListener("click", async () => {
  await api("POST", "/api/viewer/logout").catch(() => {});
  location.href = "/me";
});

const LOGIN_ERROR_MESSAGES = Object.freeze({
  rate_limited: "Too many login attempts. Try again shortly.",
  missing_oauth_params: "Kick did not return the information needed. Try again.",
  oauth_state_expired: "That login took too long — try again.",
  access_denied: "Kick login was cancelled.",
  kick_auth_failed: "We couldn't complete Kick login. Try again.",
});

// Show any sign-in error in the URL, then remove the one-time code.
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("error")) {
  setStatus("vd-login-status", LOGIN_ERROR_MESSAGES[urlParams.get("error")] || "We couldn't complete login. Try again.", true);
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("error");
  window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
}

async function boot() {
  const slug = siteFromUrl();
  await load();
  if (!state.viewer) {
    // A ?site= link is meaningless until the member logs in.
    if (slug) setUrl(null, true);
    return;
  }
  if (slug) await openSite(slug, { history: "replace" });
  else setUrl(null, true);
}

// Exposed so tests and runtime checks can await the first render.
window.__yrViewerReady = boot().catch((err) => {
  setStatus("vd-login-status", errorText(err.message, "We couldn't load your account. Try again."), true);
});
