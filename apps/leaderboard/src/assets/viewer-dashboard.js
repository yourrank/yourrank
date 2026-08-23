// Viewer dashboard (/me) client.
import { showConfirmModal } from "./dashboard/utils.js";
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleString() : "—"; }

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
let redeemingItemId = null;
const redeemKeys = {};

function setStatus(id, msg, err) {
  const el = $(id);
  el.textContent = msg;
  el.className = err ? "status error" : "status";
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

async function load() {
  setGlobalLoading(true);
  try {
    const data = await api("GET", "/api/viewer/me");
    state = data;
    render();
  } catch (err) {
    if (err.message === "unauthorized") {
      renderLoggedOut();
    } else {
      setStatus("vd-login-status", err.message, true);
    }
  } finally {
    setGlobalLoading(false);
  }
}

function renderLoggedOut() {
  $("vd-login-card").hidden = false;
  $("vd-profile").hidden = true;
  $("vd-boards-card").hidden = true;
  $("vd-site-card").hidden = true;
}

function render() {
  const v = state.viewer;
  if (!v) return renderLoggedOut();

  $("vd-login-card").hidden = true;
  $("vd-profile").hidden = false;
  $("vd-boards-card").hidden = false;
  $("vd-site-card").hidden = true;

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

  $("vd-nav").innerHTML = `<a class="btn btn--sm" href="/me">My credits</a>`;

  const boards = state.boards || [];
  $("vd-boards-empty").hidden = boards.length > 0;
  $("vd-boards").innerHTML = boards.map((b) => `
    <div class="vd-card-row">
      <div class="vd-card-main">
        <div class="vd-card-title">${esc(b.name || b.slug)}</div>
        <div class="hint">${esc(b.slug)}</div>
        ${b.blocked ? `<span class="pill pill--bad">blocked</span>` : ""}
      </div>
      <div class="vd-card-side">
        <div class="vd-card-cost">${b.balance}</div>
        <div class="hint">credits</div>
        <button class="btn btn--sm" data-view-site="${esc(b.slug)}">View shop</button>
      </div>
    </div>
  `).join("");

  document.querySelectorAll("[data-view-site]").forEach((b) => {
    b.addEventListener("click", () => viewSite(b.dataset.viewSite, b));
  });
}

async function viewSite(slug, btn) {
  if (btn) setLoading(btn, true);
  try {
    const data = await api("GET", `/api/viewer/site?slug=${encodeURIComponent(slug)}`);
    state.current = data;
    renderSite();
  } catch (err) { setStatus("vd-login-status", err.message, true); }
  finally { if (btn) setLoading(btn, false); }
}

function renderSite() {
  const data = state.current;
  if (!data) return;

  $("vd-boards-card").hidden = true;
  $("vd-site-card").hidden = false;
  $("vd-site-name").textContent = data.site.name || data.site.slug;
  const channel = data.site.kickChannelName;
  $("vd-site-streamer").textContent = channel
    ? `Kick channel: @${channel}`
    : "Streamer site";

  const v = data.viewer || { balance: 0, blocked: false };
  $("vd-site-balance").textContent = v.balance;

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
  const canBuy = v && !v.blocked && v.balance >= i.cost && (i.stock === null || i.stock > 0) && !isRedeeming;
    return `
      <div class="vd-card-row">
        <div class="vd-card-main">
          <div class="vd-card-title">${esc(i.name)}</div>
          <div class="hint">${esc(i.description || "")}</div>
        </div>
        <div class="vd-card-side">
          <div class="vd-card-cost">${i.cost} credits</div>
          ${i.stock !== null ? `<div class="hint">Stock: ${i.stock}</div>` : ""}
          <button class="btn btn--sm" data-redeem="${esc(i.id)}" ${canBuy ? "" : "disabled"}>Order</button>
        </div>
      </div>
    `;
  }).join("");

  document.querySelectorAll("[data-redeem]").forEach((b) => {
    b.addEventListener("click", () => redeem(b.dataset.redeem, b));
  });

  const redemptions = data.redemptions || [];
  $("vd-redemptions-empty").hidden = redemptions.length > 0;
  $("vd-redemptions-list").innerHTML = redemptions.map((r) => {
    const statusLabel = r.status === "pending" ? "Pending" : r.status === "fulfilled" ? "Fulfilled" : "Cancelled";
    return `
    <div class="vd-card-row vd-redemption-row">
      <div class="vd-card-main">
        <div class="vd-card-title">${esc(r.item_name)}</div>
        <div class="hint">${r.cost} credits · ${fmtDate(r.createdAt)}</div>
      </div>
      <div class="vd-card-side">
        <span class="pill pill--${r.status === "pending" ? "muted" : r.status === "fulfilled" ? "good" : "bad"}">${statusLabel}</span>
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
    setStatus("vd-drop-status", err.message, true);
  } finally {
    setLoading(btn, false);
  }
}

async function redeem(shopItemId, btn) {
  const slug = state.current?.site?.slug;
  if (!slug) return;
  const item = (state.current.shopItems || []).find((i) => i.id === shopItemId);
  if (!item) return;
  if (!await showConfirmModal("Confirm order", `Spend ${item.cost} credits on ${item.name}?`, "Place order", false)) return;
  if (btn) setLoading(btn, true, "Placing order…");

  // Tie the idempotency key to the item, not just the DOM node, so rapid clicks
  // before re-render still resolve to the same order.
  let idempotencyKey = redeemKeys[shopItemId] || btn?.dataset.redeemKey;
  if (!idempotencyKey) {
    idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    redeemKeys[shopItemId] = idempotencyKey;
  }
  if (btn) btn.dataset.redeemKey = idempotencyKey;

  redeemingItemId = shopItemId;
  renderSite();

  try {
    const data = await api("POST", "/api/viewer/redeem", { slug, shopItemId, idempotencyKey });
    state.current.viewer.balance = data.balance;
    state.current.redemptions = state.current.redemptions || [];
    state.current.redemptions.unshift({
      id: data.redemptionId,
      itemName: item.name,
      cost: item.cost,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    delete redeemKeys[shopItemId];
    renderSite();
    // Refresh sites list to update balances.
    load().catch(() => {});
  } catch (err) { setStatus("vd-login-status", err.message, true); }
  finally {
    redeemingItemId = null;
    if (btn) setLoading(btn, false);
  }
}

$("vd-logout")?.addEventListener("click", async () => {
  const btn = $("vd-logout");
  setLoading(btn, true, "Logging out…");
  try {
    await api("POST", "/api/viewer/logout");
    state = {};
    renderLoggedOut();
  } catch (err) { setStatus("vd-login-status", err.message, true); }
  finally { setLoading(btn, false); }
});

$("vd-back")?.addEventListener("click", () => {
  state.current = null;
  $("vd-site-card").hidden = true;
  $("vd-boards-card").hidden = false;
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

load().catch((err) => {
  setStatus("vd-login-status", err.message, true);
});
