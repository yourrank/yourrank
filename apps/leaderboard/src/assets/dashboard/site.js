// Site editing: plan, branding/theme, save, archive, domain, overlay, notifications.
import { $, esc, fromLocalInput, getCsrf, guardAuth, logError, timeZoneOffsetLabel, showConfirmModal, showToast, copyToClipboard, flashButton, showLoadError, clearLoadError } from "./utils.js";
import { serializeWebhookUrl } from "./notifications.js";
import { state, boardStatus, markDirty, setState, subscribe } from "./state.js";
import { renderEmpty, setMetricUnknown } from "./states.js";
import { renderBoardSwitcher, renderBoardSelect, renderBoardsPage } from "./boards.js";
import { renderOverviewSummary } from "./overview.js";
import { renderPerformance, renderPerformanceLoading } from "./performance.js";
import { clearPlayersDraft, collectPlayers, commitDraftMutation, renderPlayers, renumber, toggleEmpty } from "./players.js";
import { requestPublicationChange } from "./publication.js";
import { DashboardRequestError, fetchDashboardJson, withDashboardTimeout } from "./request.js";
import { currentRoute, requestDashboardRoute } from "./shell.js";

export const DEFAULT_SECTIONS = {
  hero: true,
  leaderboard: true,
  top3: true,
  search: true,
  rules: true,
  partner: true,
  socials: true,
  share: true,
  pastWinners: true,
  countdown: true,
  cta: true,
  payouts: true,
  poweredBy: false,
};

const PLAN_ORDER = ["free", "starter", "pro", "agency"];
let obsSlug = "";

async function wireObsTools() {
  const buttons = [
    ["ov-btn-copy-pred-hud", (slug) => `${location.origin}/overlay/prediction?site=${slug}`, "OBS Live Prediction HUD URL copied to clipboard!"],
    ["ov-btn-copy-alerts", (slug) => `${location.origin}/overlay/alerts?site=${slug}`, "OBS Stream Alerts & Chimes URL copied to clipboard!"],
    ["ov-btn-copy-ticker", (slug) => `${location.origin}/${slug}/overlay?layout=ticker`, "OBS Leaderboard Ticker URL copied to clipboard!"],
  ];
  if (!buttons.some(([id]) => $(id))) return;
  const siteSelect = $("obsSiteSelect");
  const siteHint = $("obsSiteHint");
  try {
    const response = await fetch("/api/site/list", { credentials: "include" });
    const payload = await response.json().catch(() => ({}));
    const sites = response.ok ? payload.sites || payload.boards || [] : [];
    const selectedId = new URLSearchParams(location.search).get("siteId");
    const site = sites.find((item) => String(item.id || item.siteId) === String(selectedId)) || sites[0];
    if (siteSelect) {
      siteSelect.innerHTML = sites.map((item) => {
        const id = item.id || item.siteId;
        return `<option value="${esc(id)}"${String(id) === String(site?.id || site?.siteId) ? " selected" : ""}>${esc(item.name || item.slug || "Site")}</option>`;
      }).join("");
      siteSelect.disabled = !sites.length;
      if (!siteSelect._wired) {
        siteSelect._wired = true;
        siteSelect.addEventListener("change", () => {
          // Switching the overlay's site reloads the current route with the
          // new siteId; the entry point owns the destination and the reload.
          const next = new URL(location.href);
          next.searchParams.set("siteId", siteSelect.value);
          const route = currentRoute();
          requestDashboardRoute(route.page, route.tab, { query: next.search, reload: true });
        });
      }
    }
    obsSlug = site?.slug || "";
    if (siteHint) siteHint.textContent = site ? `Links below use ${site.name || site.slug || "this site"}.` : "Create a site before copying an overlay link.";
  } catch (error) {
    logError("load-obs-site", error);
    if (siteHint) siteHint.textContent = "Could not load your sites. Try again before copying an overlay link.";
  }
  buttons.forEach(([id, makeUrl, message]) => {
    const button = $(id);
    if (!button || button._wired) return;
    button._wired = true;
    button.addEventListener("click", async () => {
      if (!obsSlug) {
        showToast("Select a site before copying an OBS link.");
        return;
      }
      const copied = await copyToClipboard(makeUrl(obsSlug));
      flashButton(button, copied ? "Copied!" : "Copy failed");
      if (copied) showToast(message, "success");
    });
  });
}
const LIFETIME_KEY = "lifetime";
const DEFAULT_PRIZES = { prizePoolLabel: "Prize pool", payoutsLabel: "Payouts", countdownLabel: "", currency: "$", hidePrizeAmounts: false };

export function isLifetime() {
  const exp = state.ME?.planExpiresAt;
  return Number(exp) > new Date("2099-01-01T00:00:00Z").getTime();
}
export function isPro() {
  const plan = state.ME?.plan;
  return plan === "pro" || plan === "agency" || plan === "lifetime" || isLifetime();
}

function planDefs() {
  const proPrice = state.ME?.proPrice;
  const proPriceStr = proPrice == null ? "—" : `$${proPrice}`;
  return [
    { key: "free", name: "Free", price: 0, priceStr: "$0", period: "", note: "forever", features: ["1 leaderboard", "Up to 10 players", "YourRank badge", "Basic analytics (7 days)", "Live countdown"] },
    { key: "starter", name: "Starter", price: 12, priceStr: "$12", period: "/30 days", note: "", features: ["1 leaderboard", "Up to 25 players", "CSV import", "Full analytics (30 days)", "Font choice", "Custom accent colors", "Logo"] },
    { key: "pro", name: "Pro", price: proPrice, priceStr: proPriceStr, period: "/30 days", note: "Most popular", features: ["Up to 3 leaderboards", "Up to 9,999 players", "Custom domain", "OBS overlay", "Discord + Telegram alerts", "Section controls", "Prize & countdown customization", "Remove YourRank badge"] },
    { key: "agency", name: "Agency", price: 79, priceStr: "$79", period: "/30 days", note: "", features: ["Up to 99 leaderboards", "White-label branding", "Automatic score updates", "Dedicated support", "Custom CSS", "Remove YourRank badge"] },
    { key: "lifetime", name: "Lifetime Pro", price: 149, priceStr: "$149", period: "", note: "one-time", features: ["All Pro + Agency features", "Pay once, use forever", "No monthly bills"] },
  ];
}

let checkingOut = false;
let startingTrial = false;

async function startTrial(btn) {
  if (!btn || startingTrial) return;
  startingTrial = true;
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Starting…";
  const status = $("trialStatus") || $("status");
  try {
    const res = await fetch("/api/billing/trial", { method: "POST", credentials: "include", headers: { "x-csrf-token": getCsrf() } }).then(guardAuth);
    const d = await res.json();
    if (res.ok && d.ok) { location.reload(); return; }
    status.textContent = d.error || "Couldn't start trial.";
  } catch (err) { logError("trial", err); status.textContent = "Network error."; }
  btn.disabled = false;
  btn.textContent = orig;
  startingTrial = false;
}

export async function checkout(planOrBtn, btnRef) {
  const planKey = typeof planOrBtn === "string" ? planOrBtn : (planOrBtn?.dataset?.plan || "pro");
  const btn = typeof planOrBtn === "object" ? planOrBtn : btnRef;
  if (checkingOut) return;
  checkingOut = true;
  let orig = "";
  if (btn) { orig = btn.textContent; btn.disabled = true; btn.textContent = "Opening checkout…"; }
  try {
    const isLifetime = planKey === LIFETIME_KEY;
    const endpoint = isLifetime ? "/api/billing/checkout-lifetime" : "/api/billing/checkout";
    const headers = { "x-csrf-token": getCsrf() };
    const body = isLifetime ? undefined : JSON.stringify({ plan: planKey });
    if (!isLifetime) headers["content-type"] = "application/json";
    const res = await fetch(endpoint, { method: "POST", credentials: "include", headers, body }).then(guardAuth);
    const d = await res.json();
    if (res.ok && d.ok && d.url) { location.href = d.url; return; }
    $("status").textContent = d.error || "Couldn't start checkout.";
  } catch (err) { logError("checkout", err); $("status").textContent = "Network error."; }
  if (btn) { btn.disabled = false; btn.textContent = orig; }
  checkingOut = false;
}

async function loadPendingPayment() {
  const wrap = $("pendingPayment");
  const link = $("pendingPaymentLink");
  const status = wrap?.querySelector("p[role='status']");
  if (!wrap || !link || !status) return;
  try {
    const res = await fetch("/api/billing/pending", { credentials: "include" }).then(guardAuth);
    const d = await res.json();
    if (res.ok && d.ok && d.pending && d.url) {
      status.textContent = `You have a pending ${d.plan?.toUpperCase()} payment of $${Number(d.amount).toFixed(2)}.`;
      link.href = d.url;
      wrap.hidden = false;
      return;
    }
  } catch (err) { logError("loadPendingPayment", err); }
  wrap.hidden = true;
}

function renderPlanCard(p, isCurrent, isLower, cta, accent, isContact) {
  const classes = ["plan-card"];
  if (isCurrent) classes.push("plan-card--current");
  if (p.note === "Most popular") classes.push("plan-card--popular");
  const disabled = isCurrent || isLower ? "disabled" : "";
  const note = p.note ? `<span class="plan-card-note">${esc(p.note)}</span>` : "";
  const list = p.features.map((f) => `<li>${esc(f)}</li>`).join("");
  const ctaEl = isContact
    ? `<a class="btn btn--sm plan-card-cta" href="/help/support?area=billing">${esc(cta)}</a>`
    : `<button class="${accent ? "btn btn--sm btn--accent plan-card-cta" : "btn btn--sm plan-card-cta"}" data-plan="${esc(p.key)}" ${disabled}>${esc(cta)}</button>`;
  return `<div class="${classes.join(" ")}"><div class="plan-card-head"><div class="plan-card-name">${esc(p.name)}${note}</div><div class="plan-card-price">${esc(p.priceStr)}<span>${esc(p.period)}</span></div></div><ul class="plan-card-features">${list}</ul>${ctaEl}</div>`;
}

export function renderPlan() {
  const plan = state.ME.plan || "free";
  const isTrial = state.ME.isTrial;
  const lifetime = isLifetime();
  const planNames = { free: "Free", starter: "Starter", pro: "Pro", agency: "Agency" };
  const currentName = lifetime ? "Lifetime Pro" : (planNames[plan] || plan);
  const expiry = state.ME.planExpiresAt;
  const until = expiry && Number(expiry) > 0 && !lifetime ? `Active until ${new Date(Number(expiry)).toLocaleDateString()}` : (lifetime ? "No expiry" : "");

  const summary = $("planSummary");
  if (summary) {
    summary.innerHTML = `<div class="plan-summary-row"><span class="plan-summary-label">Current plan</span><span class="plan-summary-value">${esc(currentName)}${isTrial ? " (Trial)" : ""}</span></div>${until ? `<div class="plan-summary-row"><span class="plan-summary-label">Expires</span><span class="plan-summary-value">${esc(until)}</span></div>` : ""}`;
  }

  const banner = $("planBanner");
  if (banner) {
    if (!lifetime && plan !== "free" && expiry && Number(expiry) > 0) {
      const days = Math.floor((Number(expiry) - Date.now()) / 86_400_000);
      if (days < 0) {
        banner.hidden = false;
        banner.textContent = "Your plan has expired. Renew to restore Pro features.";
      } else if (days <= 7) {
        banner.hidden = false;
        banner.textContent = `Your plan expires in ${days} day${days === 1 ? "" : "s"}. Renew to keep your Pro features.`;
      } else {
        banner.hidden = true;
        banner.textContent = "";
      }
    } else {
      banner.hidden = true;
      banner.textContent = "";
    }
  }

  const cancelWrap = $("cancelWrap");
  if (cancelWrap) {
    const paid = plan !== "free" && !lifetime && !isTrial;
    cancelWrap.hidden = !paid;
    if (paid) {
      const cancelStatus = $("cancelStatus");
      if (cancelStatus) cancelStatus.textContent = "";
      const cancelBtn = $("cancelBtn");
      if (cancelBtn) { cancelBtn.hidden = false; cancelBtn.disabled = false; }
    }
  }

  const grid = $("planGrid");
  if (grid) {
    const currentIdx = PLAN_ORDER.indexOf(plan);
    grid.innerHTML = planDefs().map((p) => {
      if (p.key === LIFETIME_KEY) {
        const isCurrent = lifetime;
        const cta = isCurrent ? "Current plan" : "Get Lifetime Pro";
        return renderPlanCard(p, isCurrent, false, cta, !isCurrent, false);
      }
      const pIdx = PLAN_ORDER.indexOf(p.key);
      const isCurrent = p.key === plan && !lifetime;
      const isLower = pIdx < currentIdx;
      let cta, accent = false;
      if (isCurrent) {
        cta = isTrial ? "Current (trial)" : "Current plan";
      } else if (isLower) {
        cta = "Included";
      } else {
        cta = p.key === "free" ? "Current" : (p.key === "agency" ? "Contact us" : `Upgrade to ${p.name}`);
        accent = p.key !== "agency";
      }
      return renderPlanCard(p, isCurrent, isLower, cta, accent && !isCurrent, p.key === "agency");
    }).join("");
    if (!grid._wired) {
      grid.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-plan]");
        if (btn) checkout(btn.dataset.plan, btn);
      });
      grid._wired = true;
    }
  }

  const trialEl = $("planTrial");
  if (trialEl) {
    if (plan === "free" && !state.ME.hasTrial) {
      trialEl.hidden = false;
      const trialBtn = $("trialBtn");
      if (trialBtn && !trialBtn._wired) {
        trialBtn._wired = true;
        trialBtn.addEventListener("click", () => startTrial(trialBtn));
      }
    } else {
      trialEl.hidden = true;
    }
  }

  // Backfill legacy single-plan elements if they still exist
  if ($("planBadge")) $("planBadge").textContent = (lifetime ? "Lifetime" : plan).toUpperCase() + " PLAN";
  loadPendingPayment();
}

export async function loadHistory() {
  const card = $("historyCard");
  const table = $("historyTable");
  const body = $("historyBody");
  const empty = $("historyEmpty");
  if (!card || !table || !body) return;
  try {
    const res = await fetch("/api/account/payments", { credentials: "include" }).then(guardAuth);
    const d = await res.json();
    if (!res.ok || !d.ok) throw new Error(d.error || `payments ${res.status}`);
    const rows = d.payments || [];
    card.hidden = false;
    clearLoadError(empty, rows.length === 0);
    table.hidden = rows.length === 0;
    body.innerHTML = rows.map((p) => {
      const plan = String(p.plan_tier || p.plan || "–").toUpperCase();
      const amount = Number(p.amount) || 0;
      const amountStr = `$${amount.toFixed(2)} ${p.currency || "USD"}`;
      const status = String(p.status || "").toLowerCase();
      const statusClass = ["confirmed", "finished", "active", "manual"].includes(status) ? "good" : ["failed", "expired", "refunded", "abandoned", "cancelled"].includes(status) ? "bad" : "muted";
      const date = p.created_at ? new Date(p.created_at).toLocaleString() : "–";
      const note = p.message ? `<div class="hint">${esc(p.message)}</div>` : "";
      return `<tr><td>${esc(date)}</td><td>${esc(plan)}</td><td>${esc(amountStr)}</td><td><span class="pill pill--${esc(statusClass)}">${esc(status)}</span>${note}</td></tr>`;
    }).join("");
  } catch (err) {
    logError("loadHistory", err);
    card.hidden = false;
    table.hidden = true;
    showLoadError(empty, "your payment history", loadHistory);
  }
}

export async function loadPlanUsage() {
  const wrap = $("planUsage");
  if (!wrap) return;
  setState({ USAGE_STATUS: "loading" });
  try {
    const res = await fetch("/api/account/usage", { credentials: "include" }).then(guardAuth);
    const d = await res.json();
    if (!res.ok || !d.ok) { setState({ USAGE_STATUS: "error" }); wrap.innerHTML = `<p class="hint hint--error">Could not load usage.</p>`; return; }
    setState({ USAGE_STATUS: "ready" });
    const rows = [];
    rows.push({ label: "Leaderboards", product: "Leaderboard", used: d.leaderboard.boards.used, limit: d.leaderboard.boards.limit });
    rows.push({ label: "Players", product: "Leaderboard", used: d.leaderboard.players.used, limit: d.leaderboard.players.limit });
    if (d.credits) {
      rows.push({ label: "Ways to earn", product: "Credits", used: d.credits.rewardMappings.used, limit: d.credits.rewardMappings.limit });
      rows.push({ label: "Shop items", product: "Credits", used: d.credits.shopItems.used, limit: d.credits.shopItems.limit });
      rows.push({ label: "Pending orders", product: "Credits", used: d.credits.pendingRedemptions.used, limit: d.credits.pendingRedemptions.limit });
      rows.push({ label: "Orders / 30 days", product: "Credits", used: d.credits.redemptionsPer30Days.used, limit: d.credits.redemptionsPer30Days.limit });
      rows.push({ label: "New members / 30 days", product: "Credits", used: d.credits.newViewersPer30Days.used, limit: d.credits.newViewersPer30Days.limit });
    }
    wrap.innerHTML = rows.map((r) => {
      const atLimit = r.limit > 0 && r.used >= r.limit;
      const near = r.limit > 0 && !atLimit && r.used >= Math.floor(r.limit * 0.8);
      const color = atLimit ? "color:#ff6b6b" : near ? "color:#ffcc00" : "";
      return `<div class="plan-usage-row"><div class="plan-usage-meta"><span class="plan-usage-label">${esc(r.label)}</span><span class="plan-usage-product">${esc(r.product)}</span></div><span class="plan-usage-value" style="${esc(color)}">${Number(r.used).toLocaleString()} / ${Number(r.limit).toLocaleString()}</span></div>`;
    }).join("");
  } catch (err) {
    setState({ USAGE_STATUS: "error" });
    logError("loadPlanUsage", err);
    if (wrap) wrap.innerHTML = `<p class="hint hint--error">Could not load usage.</p>`;
  }
}

export function wireCancelSubscription() {
  const btn = $("cancelBtn");
  if (!btn || btn._wired) return;
  btn._wired = true;
  btn.addEventListener("click", async () => {
    const plan = state.ME?.plan || "free";
    const expiry = state.ME?.planExpiresAt;
    const until = expiry && Number(expiry) > 0 ? new Date(Number(expiry)).toUTCString().slice(5, 16) : "";
    const body = until
      ? `You'll keep ${plan} features until ${until}, then revert to Free.`
      : "Your plan will revert to Free immediately.";
    if (!await showConfirmModal("Cancel subscription?", body, "Yes, cancel", true)) return;
    const status = $("cancelStatus");
    if (status) status.textContent = "Cancelling...";
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST", credentials: "include", headers: { "x-csrf-token": getCsrf() } });
      const d = await res.json();
      if (res.ok && d.ok) {
        if (status) status.textContent = d.message || "Subscription cancelled.";
        btn.hidden = true;
        setTimeout(() => location.reload(), 1200);
      } else {
        if (status) status.textContent = d.error || "Could not cancel.";
      }
    } catch (err) { logError("cancel-subscription", err); if (status) status.textContent = "Network error."; }
  });
}

export function collect({ reportPlayerErrors = true } = {}) {
  const playerResult = collectPlayers({ reportErrors: reportPlayerErrors });
  const players = playerResult.players;
  const brandName = $("f_name").value.trim();
  const out = {
    name: brandName,
    brand: {
      name: brandName,
      tagline: $("f_tagline").value.trim(),
      casino: $("f_casino").value.trim(),
      code: $("f_code").value.trim(),
      ctaUrl: $("f_cta").value.trim(),
      prizePool: $("f_pool").value.trim(),
      period: $("f_period").value.trim() || "Monthly",
    },
    startsAt: fromLocalInput($("f_starts")?.value || ""),
    endsAt: fromLocalInput($("f_ends").value),
    rankBy: $("f_rank_by")?.value === "score" ? "score" : "wagered",
    partner: { blurb: $("f_blurb").value.trim(), chips: state.EXTRA.chips },
    whyStats: state.EXTRA.whyStats,
    rules: state.EXTRA.rules,
    socials: state.EXTRA.socials,
    sections: state.EXTRA.sections,
    playerFields: state.EXTRA.playerFields,
    players,
    legal: {
      terms: ($("f_legal_terms")?.value || "").trim(),
      termsEnabled: $("f_legal_terms_enabled")?.checked ?? true,
      privacy: ($("f_legal_privacy")?.value || "").trim(),
      privacyEnabled: $("f_legal_privacy_enabled")?.checked ?? true,
      responsible: ($("f_legal_responsible")?.value || "").trim(),
      responsibleEnabled: $("f_legal_responsible_enabled")?.checked ?? true,
      cookies: ($("f_legal_cookies")?.value || "").trim(),
      cookiesEnabled: $("f_legal_cookies_enabled")?.checked ?? true,
      refund: ($("f_legal_refund")?.value || "").trim(),
      refundEnabled: $("f_legal_refund_enabled")?.checked ?? true,
      contact: ($("f_legal_contact")?.value || "").trim(),
      contactEnabled: $("f_legal_contact_enabled")?.checked ?? true,
    },
  };
  const pubToggle = $("pubToggle");
  if (pubToggle) out.published = pubToggle.checked;
  const pwEnabled = $("f_password_enabled");
  const pwInput = $("f_password");
  if (pwEnabled) {
    if (pwEnabled.checked) {
      if (pwInput && pwInput.value.trim()) out.password = pwInput.value.trim();
    } else {
      out.passwordProtected = false;
    }
  }
  if (state.ACTIVE_SITE_ID) out.siteId = state.ACTIVE_SITE_ID;
  if (state.SITE_UPDATED_AT) out.expectedUpdatedAt = state.SITE_UPDATED_AT;
  if (state.ME && state.ME.plan !== "free") {
    out.branding = {
      template: state.CURRENT_BRANDING?.template || "cyber_arcade",
      accentA: $("c_a").value,
      accentB: $("c_b").value,
      font: $("f_font")?.value || state.CURRENT_BRANDING?.font || "Inter",
    };
    if (state.LOGO !== undefined) out.branding.logo = state.LOGO;
  }
  if (isPro()) {
    out.branding = {
      ...(out.branding || {}),
      prizes: {
        prizePoolLabel: $("f_prizePoolLabel")?.value.trim() || DEFAULT_PRIZES.prizePoolLabel,
        payoutsLabel: $("f_payoutsLabel")?.value.trim() || DEFAULT_PRIZES.payoutsLabel,
        countdownLabel: $("f_countdownLabel")?.value.trim() || "",
        currency: $("f_currency")?.value.trim() || DEFAULT_PRIZES.currency,
        hidePrizeAmounts: $("f_hidePrizeAmounts")?.checked || false,
      },
    };
  }
  const webhook = $("f_webhook");
  out.notify = {
    discord_webhook_url: serializeWebhookUrl(webhook?.value, webhook?.dataset.configured === "true"),
    telegram_chat_id: $("f_tgChatId")?.value.trim() || null,
    telegram_notify: $("f_tgNotify")?.checked || false,
  };
  const arToggle = $("f_auto_reset");
  const arClear = $("f_auto_reset_clear");
  out.autoReset = {
    enabled: !!(arToggle && arToggle.checked),
    clear: arClear && !arClear.disabled ? arClear.value : "wagers",
  };
  return { payload: out, invalid: playerResult.invalid };
}

/* --- branding --- */
const COLOR_PRESETS = [
  { name: "Indigo", accentA: "#5b5bf5", accentB: "#7b7bf8" },
  { name: "Cyan", accentA: "#06b6d4", accentB: "#42e6ff" },
  { name: "Sunset", accentA: "#ff7a59", accentB: "#ff4d9d" },
  { name: "Emerald", accentA: "#3cf2b1", accentB: "#35a7ff" },
  { name: "Gold", accentA: "#ffd15c", accentB: "#ff9f43" },
];

function renderColorPresets() {
  const list = $("colorPresets");
  if (!list) return;
  list.innerHTML = "";
  COLOR_PRESETS.forEach((preset) => {
    const active = preset.accentA.toLowerCase() === String(state.CURRENT_BRANDING.accentA || "").toLowerCase()
      && preset.accentB.toLowerCase() === String(state.CURRENT_BRANDING.accentB || "").toLowerCase();
    const button = document.createElement("button");
    button.className = "preset-btn" + (active ? " is-selected" : "");
    button.type = "button";
    button.setAttribute("aria-pressed", String(active));
    button.innerHTML = `<span class="preset-swatch"><i data-color="${esc(preset.accentA)}"></i><i data-color="${esc(preset.accentB)}"></i></span><span>${esc(preset.name)}</span>`;
    button.querySelectorAll("[data-color]").forEach((swatch) => { swatch.style.background = swatch.dataset.color; });
    button.addEventListener("click", () => applyTheme(preset.accentA, preset.accentB, preset.name));
    list.appendChild(button);
  });
}

const PREVIEW_TIMEOUT_MS = 8000;
let _previewTimeout = null;
let _previewForm = null;
let _previewWatchdog = null;
let _previewSyncedAt = null;

function setPreviewSyncStatus(status, syncedAt = _previewSyncedAt) {
  const chip = $("previewSyncStatus");
  const timestamp = $("previewSyncTime");
  if (chip) {
    chip.textContent = status;
    chip.classList.toggle("is-syncing", status === "SYNCING");
  }
  if (timestamp) {
    const seconds = syncedAt ? Math.max(0, Math.floor((Date.now() - syncedAt) / 1000)) : null;
    timestamp.textContent = seconds === null ? "Last synced —" : seconds === 0 ? "Last synced just now" : `Last synced ${seconds}s ago`;
  }
}

/**
 * Replace the preview frame with a fresh one. A form submission into an
 * existing frame appends an entry to the joint session history, which both
 * pollutes Back and truncates the forward stack, so every render targets a
 * newly created frame whose first navigation replaces instead of pushing.
 */
function resetPreviewFrame() {
  const current = $("designPreview");
  if (!current) return null;
  const fresh = document.createElement("iframe");
  for (const attr of current.attributes) {
    if (attr.name !== "src") fresh.setAttribute(attr.name, attr.value);
  }
  fresh.addEventListener("load", () => {
    clearTimeout(_previewWatchdog);
    _previewSyncedAt = Date.now();
    setPreviewSyncStatus("SYNCED", _previewSyncedAt);
    fitDesignPreview();
  });
  current.replaceWith(fresh);
  return fresh;
}

export function updateDesignPreview() {
  const iframe = $("designPreview");
  if (!iframe || !state.ACTIVE_SITE_ID) return;
  // Don't waste CPU/network rendering a preview that isn't on screen.
  const editorVisible = document.querySelector('section[data-page="board"].is-on');
  if (!editorVisible) return;

  const active = document.querySelector(".preview-tab.is-active");
  const device = active?.dataset.device || "desktop";

  // Wire retry button once.
  const retry = $("previewRetry");
  if (retry && !retry._wired) {
    retry._wired = true;
    retry.addEventListener("click", () => { $("previewError").hidden = true; updateDesignPreview(); });
  }

  // Debounce the live preview update so typing doesn't repeatedly re-render.
  clearTimeout(_previewTimeout);
  _previewTimeout = setTimeout(() => {
    try {
      const { payload: draft, invalid } = collect({ reportPlayerErrors: false });
      if (invalid.length) return;
      const url = "/dashboard/preview?" + new URLSearchParams({ board: state.ACTIVE_SITE_ID, device }).toString();
      if (!_previewForm) {
        _previewForm = document.createElement("form");
        _previewForm.method = "post";
        _previewForm.target = "designPreview";
        _previewForm.hidden = true;
        const draftInput = document.createElement("input");
        draftInput.type = "hidden";
        draftInput.name = "draft";
        _previewForm.appendChild(draftInput);
        document.body.appendChild(_previewForm);
      }
      _previewForm.action = url;
      _previewForm.querySelector("input[name='draft']").value = JSON.stringify(draft);
      setPreviewSyncStatus("SYNCING");
      if (!resetPreviewFrame()) return;
      _previewForm.submit();
      const errorOverlay = $("previewError");
      if (errorOverlay) errorOverlay.hidden = true;
      clearTimeout(_previewWatchdog);
      _previewWatchdog = setTimeout(() => {
        if (errorOverlay) errorOverlay.hidden = false;
      }, PREVIEW_TIMEOUT_MS);
    } catch (e) {
      logError("preview-submit", e);
      const errorOverlay = $("previewError");
      if (errorOverlay) errorOverlay.hidden = false;
    }
  }, 300);
}

/**
 * Scale the preview iframe so a `deviceWidth`-wide page fits the stage: the
 * iframe renders at the device width and is transform-scaled down, so the stage
 * is sized in unscaled pixels and the frame in scaled ones.
 */
export function fitDesignPreview() {
  const iframe = $("designPreview");
  const stage = $("previewStage");
  const frame = $("previewFrame");
  if (!iframe || !stage || !frame) return;
  const active = document.querySelector(".preview-tab.is-active");
  const deviceWidth = parseInt(active?.dataset.width || "1100", 10) || 1100;
  const cw = frame.clientWidth;
  if (!cw) return;
  const doc = iframe.contentDocument;
  let contentHeight = 680;
  if (doc && doc.readyState === "complete" && doc.documentElement) {
    const html = doc.documentElement;
    const body = doc.body;
    contentHeight = Math.max(680, html.scrollHeight, body ? body.scrollHeight : 0, html.offsetHeight, body ? body.offsetHeight : 0);
  }
  const scale = cw / deviceWidth;
  const maxHeight = Math.min(720, Math.floor(window.innerHeight * 0.75));
  stage.style.width = deviceWidth + "px";
  stage.style.height = contentHeight + "px";
  stage.style.setProperty("--preview-scale", String(scale));
  frame.style.height = Math.min(contentHeight * scale, maxHeight) + "px";
}

/** Re-render the preview and re-fit it: what every "show me the draft" path wants. */
export function refreshDesignPreview() {
  updateDesignPreview();
  fitDesignPreview();
}

// Renders every "is my board live" surface from boardStatus() so the badge,
// banner and share affordances can never contradict each other.
// One publication vocabulary for the whole workspace, derived from real state
// (boardStatus() + the draft flag) so no surface can contradict another:
// - not live        → "Not live" + primary "Publish site"
// - live, no draft  → "Live" + footer "All changes published"
// - live, draft     → "Live" + secondary "Draft changes" + footer "Changes
//                     not published" + primary "Publish changes"
// "Not published yet" is never shown for a site that is already live.
export function publicationCopy(s = boardStatus(), dirty = state._dirty) {
  if (s.pending) {
    return {
      statusLabel: "Verification needed",
      footerLabel: "Not live yet",
      saveLabel: "Save changes",
      saveHint: "Unsaved changes",
      draftChanges: false,
    };
  }
  if (s.published) {
    return {
      statusLabel: "Live",
      footerLabel: dirty ? "Changes not published" : "All changes published",
      saveLabel: dirty ? "Publish changes" : "Save changes",
      saveHint: dirty ? "Changes not published" : "Unsaved changes",
      draftChanges: dirty,
    };
  }
  return {
    statusLabel: "Not live",
    footerLabel: "Not live yet",
    saveLabel: "Save changes",
    saveHint: "Unsaved changes",
    draftChanges: false,
  };
}

export function renderBoardStatus() {
  const s = boardStatus();
  const copy = publicationCopy(s);
  const TITLES = {
    draft: "Not visible to visitors",
    unpublished: "Not visible to visitors",
    pending: "Published, but visitors can't see it until you confirm your email",
    published: "Your board is live",
  };
  const badge = $("lbTopbarStatus");
  if (badge) {
    badge.textContent = copy.statusLabel;
    badge.className = "lb-status lb-status--" + s.key;
    const parts = [];
    if (state.SITE_UPDATED_AT) parts.push("Last saved " + new Date(state.SITE_UPDATED_AT).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
    if (s.published && state.PUBLISHED_AT) parts.push("Published " + new Date(state.PUBLISHED_AT).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
    if (copy.draftChanges) parts.push("Draft changes not published yet");
    parts.push(TITLES[s.key]);
    badge.title = parts.join(" · ");
  }
  // Secondary state next to the badge: a live site with unpublished edits.
  const draftBadge = $("lbTopbarDraft");
  if (draftBadge) draftBadge.hidden = !copy.draftChanges;
  const banner = $("verifyBanner");
  if (banner) {
    const email = state.ME?.email || state.ME?.emailAddress || "your email address";
    const dismissedKey = `yr-verify-dismissed:${state.ME?.id || email}`;
    let dismissed = false;
    try { dismissed = sessionStorage.getItem(dismissedKey) === "1"; } catch { dismissed = false; }
    banner.hidden = s.emailVerified || dismissed;
    const emailEl = $("verifyBannerEmail");
    if (emailEl) emailEl.textContent = email;
    const dismiss = $("verifyDismiss");
    if (dismiss && !dismiss._wired) {
      dismiss._wired = true;
      dismiss.addEventListener("click", () => {
        try { sessionStorage.setItem(dismissedKey, "1"); } catch { /* session-only dismissal unavailable */ }
        banner.hidden = true;
      });
    }
    const resend = $("verifyResend");
    if (resend && !resend._wired) {
      resend._wired = true;
      let cooldown = 0;
      resend.addEventListener("click", async () => {
        if (cooldown > 0) return;
        resend.disabled = true;
        const status = $("verifyBannerStatus");
        if (status) status.textContent = "Sending…";
        try {
          const response = await fetch("/api/auth/resend-verification", {
            method: "POST",
            credentials: "include",
            headers: { "x-csrf-token": getCsrf() },
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.ok) throw new Error(data.error || "Could not resend the verification email.");
          if (status) status.textContent = "Verification email sent. Check your inbox.";
          cooldown = 60;
          const timer = setInterval(() => {
            cooldown -= 1;
            if (cooldown <= 0) {
              clearInterval(timer);
              resend.disabled = false;
              resend.textContent = "Resend verification";
            } else resend.textContent = `Resend in ${cooldown}s`;
          }, 1000);
          resend.textContent = "Resend in 60s";
        } catch (error) {
          if (status) status.textContent = error.message || "Could not resend the verification email.";
          resend.disabled = false;
        }
      });
    }
  }
  const publishLabel = $("lbPublishLabel");
  if (publishLabel) publishLabel.textContent = s.published ? "Unpublish site" : "Publish site";
  const publishAction = $("publishAction");
  if (publishAction) {
    publishAction.className = `lb-publish-action${s.published ? " lb-publish-action--secondary" : ""}`;
    publishAction.title = s.published ? "Take this site offline" : "Make this site available to visitors";
    publishAction.setAttribute("aria-label", s.published ? "Unpublish site" : "Publish site");
  }
  const shareWarning = $("sharePublishWarning");
  if (shareWarning) {
    shareWarning.hidden = s.live;
    const title = $("sharePublishWarningTitle");
    const body = $("sharePublishWarningBody");
    const action = $("sharePublishAction");
    if (s.pending) {
      if (title) title.textContent = "Your site is published, but offline to visitors.";
      if (body) body.textContent = "Confirm your email address before visitors can open this leaderboard.";
      if (action) action.textContent = "Verify email";
    } else {
      if (title) title.textContent = "This site is not published.";
      if (body) body.textContent = "Visitors will receive a 404 until you publish it.";
      if (action) action.textContent = "Publish site";
    }
  }
  const sharePublishAction = $("sharePublishAction");
  if (sharePublishAction) sharePublishAction.onclick = () => s.pending
    ? (location.href = "/verify-email")
    : $("publishAction")?.click();
  const publishToggle = $("pubToggle");
  if (publishToggle && !state._dirty) publishToggle.checked = s.published;
  // A "View site" link must never be offered while the public URL would not
  // resolve, and it must never restate the publish action that sits next to it
  // in the topbar: the only non-live state it takes is the email verification
  // it cannot do itself.
  for (const id of ["liveLink", "previewLiveLink"]) {
    const link = $(id);
    if (!link) continue;
    link.hidden = id === "liveLink" ? !s.live && !s.pending : !s.live;
    if (id === "liveLink") {
      link.textContent = s.live ? "View site ↗" : "Verify email";
      link.href = s.live ? `/${state.SLUG}` : "/verify-email";
      if (s.live) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      } else {
        link.removeAttribute("target");
        link.removeAttribute("rel");
      }
    }
  }
  return s;
}

export function wirePublishAction({ fetchImpl = fetch, confirmAction = showConfirmModal, toast = showToast } = {}) {
  const button = $("publishAction");
  if (!button || button._wired) return;
  button._wired = true;
  button.addEventListener("click", async () => {
    const nextPublished = !state.PUBLISHED;
    let confirmed = false;
    try {
      confirmed = await confirmAction(
        nextPublished ? "Publish site" : "Unpublish site",
        nextPublished
          ? (boardStatus().emailVerified
            ? "Make this site public now? Anyone with the link will be able to visit it."
            : "Publish this site now? It will open to visitors as soon as you confirm your email.")
          : "Take this site offline? Your settings and player data will stay saved.",
        nextPublished ? "Publish" : "Unpublish",
        !nextPublished,
      );
    } catch (err) {
      logError("publication-confirmation", err);
      toast("Could not open the confirmation. Try again.");
      return;
    }
    if (!confirmed) return;

    const editorSave = $("save");
    const compatibilityToggle = $("pubToggle");
    if (state._dirty && editorSave && compatibilityToggle) {
      compatibilityToggle.checked = nextPublished;
      editorSave.click();
      return;
    }

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    if ($("lbPublishLabel")) $("lbPublishLabel").textContent = nextPublished ? "Publishing…" : "Unpublishing…";
    try {
      const data = await requestPublicationChange({
        published: nextPublished,
        siteId: state.ACTIVE_SITE_ID,
        expectedUpdatedAt: state.SITE_UPDATED_AT,
        csrfToken: getCsrf(),
        fetchImpl: (...args) => Promise.resolve(fetchImpl(...args)).then(guardAuth),
      });
      setState({
        PUBLISHED: nextPublished,
        IS_DRAFT: nextPublished ? false : state.IS_DRAFT,
        SITE_UPDATED_AT: data.updatedAt || state.SITE_UPDATED_AT,
        PUBLISHED_AT: data.publishedAt || state.PUBLISHED_AT,
        SLUG: data.slug || state.SLUG,
      });
      const active = state.BOARDS.find((board) => board.id === state.ACTIVE_SITE_ID);
      if (active) active.published = nextPublished;
      renderBoardSwitcher();
      renderBoardSelect();
      renderBoardsPage();
      renderBoardStatus();
      renderOverviewSummary();
      const publicUrl = `${location.origin}/${state.SLUG}`;
      const handoff = $("publishHandoff");
      if (handoff) {
        handoff.hidden = !nextPublished || !boardStatus().live;
        if ($("publishHandoffUrl")) $("publishHandoffUrl").textContent = publicUrl;
        if ($("publishHandoffOpen")) $("publishHandoffOpen").href = publicUrl;
        const copy = $("publishHandoffCopy");
        if (copy) copy.onclick = async () => {
          const copied = await copyToClipboard(publicUrl);
          flashButton(copy, copied ? "Copied!" : "Copy failed");
        };
      }
      toast(
        nextPublished
          ? (boardStatus().emailVerified
            ? `Published at ${publicUrl}`
            : "Published — Your leaderboard will open to visitors after you confirm your email.")
          : "Saved",
        "success",
      );
    } catch (err) {
      logError(nextPublished ? "publish-site" : "unpublish-site", err);
      toast(err.message || (nextPublished ? "Could not publish this site." : "Could not unpublish this site."));
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      renderBoardStatus();
    }
  });
}

export function renderEditorTimestamps() {
  const el = $("editorTimestamp");
  if (!el) return;
  const fmt = (iso) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      const formatted = d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      const offset = timeZoneOffsetLabel(d);
      return formatted + (offset ? ` ${offset}` : "");
    } catch { return "—"; }
  };
  const saved = state.SITE_UPDATED_AT ? "Last saved " + fmt(state.SITE_UPDATED_AT) : "";
  // The footer answers "do visitors see my latest work?", not "when did the
  // first publish happen" — a live site is never "not published yet".
  const label = publicationCopy().footerLabel;
  el.textContent = saved ? `${saved} · ${label}` : label;
}

// Save-bar copy is the same state model: on a live site the primary action
// publishes the draft, on an offline site it only saves it.
export function renderSavebarCopy() {
  const copy = publicationCopy();
  const hint = document.querySelector(".savebar-hint");
  if (hint) hint.textContent = copy.saveHint;
  const saveBtn = $("save");
  if (saveBtn && !saveBtn.disabled) saveBtn.textContent = copy.saveLabel;
}

function updateThemeSelection() {
  if (state.CURRENT_BRANDING.accentA) $("c_a").value = state.CURRENT_BRANDING.accentA;
  if (state.CURRENT_BRANDING.accentB) $("c_b").value = state.CURRENT_BRANDING.accentB;
  const font = $("f_font"); if (font) font.value = state.CURRENT_BRANDING.font || "Inter";
  const activeTpl = state.CURRENT_BRANDING.template || "cyber_arcade";
  document.querySelectorAll("#templateSelectorGrid [data-template]").forEach((btn) => {
    const isSel = btn.dataset.template === activeTpl;
    btn.classList.toggle("is-selected", isSel);
    btn.setAttribute("aria-pressed", String(isSel));
  });
  renderColorPresets();
  updateDesignPreview();
}

function _beforeUnloadGuard(e) {
  e.preventDefault();
  return (e.returnValue = "");
}

// The save bar, the unload guard and the live preview are derived from the
// draft instead of being poked by each edit handler, so an edit path that
// forgets to refresh one of them can't exist.
subscribe((keys) => {
  if (keys.includes("_dirty")) {
    const sb = $("savebar");
    const settingsSave = $("settingsSave");
    if (sb) sb.hidden = !state._dirty;
    if (settingsSave) settingsSave.disabled = !state._dirty;
    if (state._dirty) window.addEventListener("beforeunload", _beforeUnloadGuard);
    else window.removeEventListener("beforeunload", _beforeUnloadGuard);
    // The badge, footer and save bar all speak the same publication language,
    // so a dirty flip repaints every surface that states it.
    renderSavebarCopy();
    renderEditorTimestamps();
    renderBoardStatus();
  }
  if (keys.includes("draft")) updateDesignPreview();
});

export function applyTheme(accentA, accentB, label, font = null) {
  const selectedFont = font || $("f_font")?.value || state.CURRENT_BRANDING?.font || "Inter";
  state.CURRENT_BRANDING = { ...state.CURRENT_BRANDING, font: selectedFont };
  const isPaid = state.ME.plan !== "free";
  if (isPaid && accentA && accentB) {
    state.CURRENT_BRANDING.accentA = accentA;
    state.CURRENT_BRANDING.accentB = accentB;
    $("c_a").value = accentA;
    $("c_b").value = accentB;
  }
  const fontEl = $("f_font"); if (fontEl) fontEl.value = selectedFont;
  updateThemeSelection();
  renderBoardSelect();
  renderBoardsPage();
  const status = $("status");
  if (status && label) {
    status.textContent = isPaid
      ? `${label} palette selected — click Save changes to publish.`
      : `${label} previewed — upgrade to Pro to publish custom brand palettes.`;
  }
  markDirty();
}

export function renderBranding(br) {
  state.CURRENT_BRANDING = {
    template: br.template || "cyber_arcade",
    accentA: br.accentA || null,
    accentB: br.accentB || null,
    font: br.font || "Inter",
  };
  const paid = state.ME.plan !== "free";
  $("brandBody").hidden = !paid;
  $("brandLock").hidden = paid;
  updateThemeSelection();
  if (br.hasLogo) { $("logoPreview").src = "/logo/" + state.SLUG + "?t=" + Date.now(); $("logoPreview").hidden = false; $("logoClear").hidden = false; }
}

export function renderPrizes(prizes = {}) {
  const p = { ...DEFAULT_PRIZES, ...prizes };
  const body = $("prizesBody"), lock = $("prizesLock");
  if (body) body.hidden = !isPro();
  if (lock) lock.hidden = isPro();
  if (!isPro()) return;
  $("f_prizePoolLabel").value = p.prizePoolLabel || "";
  $("f_payoutsLabel").value = p.payoutsLabel || "";
  $("f_countdownLabel").value = p.countdownLabel || "";
  $("f_currency").value = p.currency || "$";
  $("f_hidePrizeAmounts").checked = !!p.hidePrizeAmounts;
}

$("logoPick")?.setAttribute("aria-label", "Upload logo");
$("logoPick")?.addEventListener("click", () => $("logoFile")?.click());
$("logoClear")?.setAttribute("aria-label", "Remove logo");
$("logoClear")?.addEventListener("click", () => { state.LOGO = null; $("logoPreview").hidden = true; $("logoClear").hidden = true; $("status").textContent = "Logo will be removed when you save."; });
$("logoFile")?.addEventListener("change", () => {
  const f = $("logoFile").files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    const aspect = img.width / img.height;
    const sizes = [64, 128, 256, 512];
    const srcset = {};
    for (const w of sizes) {
      const h = Math.max(1, Math.round(w / aspect));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      let uri = c.toDataURL("image/webp", 0.85);
      if (!uri.startsWith("data:image/webp")) uri = c.toDataURL("image/jpeg", 0.85);
      if (!uri.startsWith("data:")) continue;
      srcset[w] = uri;
    }
    const entries = Object.values(srcset);
    if (entries.length === 0) { $("status").textContent = "Couldn't convert that image."; URL.revokeObjectURL(img.src); return; }
    const totalChars = entries.reduce((a, b) => a + b.length, 0);
    if (totalChars > 300000) { $("status").textContent = "That image is too big even after resizing. Try a simpler one."; return; }
    state.LOGO = srcset;
    $("logoPreview").src = entries[entries.length - 1];
    $("logoPreview").hidden = false; $("logoClear").hidden = false;
    $("status").textContent = "Logo ready — hit Save to publish it.";
    URL.revokeObjectURL(img.src);
  };
  img.onerror = () => { $("status").textContent = "Couldn't read that image."; };
  img.src = URL.createObjectURL(f);
  $("logoFile").value = "";
});
$("applyCustomColors")?.addEventListener("click", () => applyTheme($("c_a")?.value, $("c_b")?.value, "Custom colors"));
$("colorsReset")?.addEventListener("click", () => applyTheme(COLOR_PRESETS[0].accentA, COLOR_PRESETS[0].accentB, COLOR_PRESETS[0].name));
$("f_font")?.addEventListener("change", () => applyTheme($("c_a")?.value, $("c_b")?.value, "Font"));

document.querySelectorAll("#templateSelectorGrid [data-template]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tpl = btn.dataset.template;
    state.CURRENT_BRANDING = { ...state.CURRENT_BRANDING, template: tpl };
    updateThemeSelection();
    markDirty();
    const status = $("status");
    if (status) status.textContent = `Template switched — click Save changes to publish.`;
  });
});

export function renderNotifications(n) {
  const paid = state.ME.plan !== "free";
  $("notifyBody").hidden = !paid; $("notifyLock").hidden = paid;
  if (!paid) return;
  const wh = $("f_webhook");
  if (wh) {
    wh.dataset.configured = n.discord_webhook_url ? "true" : "false";
    if (n.discord_webhook_url) {
      wh.value = "";
      wh.placeholder = "Connected and working ✓ (enter a new URL to change)";
    }
  }
  const tg = $("f_tgNotify"); if (tg) tg.checked = !!n.telegram_notify;
  const tgChat = $("f_tgChatId"); if (tgChat) tgChat.value = n.telegram_chat_id || "";
}

const SOCIAL_CATALOG = [
  { brand: "discord", name: "Discord", action: "Join", handle: "Join the community", placeholder: "https://discord.gg/yourserver" },
  { brand: "kick", name: "Kick", action: "Follow", handle: "Watch live", placeholder: "https://kick.com/yourname" },
  { brand: "twitch", name: "Twitch", action: "Follow", handle: "Watch live", placeholder: "https://twitch.tv/yourname" },
  { brand: "x", name: "X (Twitter)", action: "Follow", handle: "Latest updates", placeholder: "https://x.com/yourname" },
  { brand: "youtube", name: "YouTube", action: "Subscribe", handle: "Watch videos", placeholder: "https://youtube.com/@yourname" },
  { brand: "instagram", name: "Instagram", action: "Follow", handle: "Follow along", placeholder: "https://instagram.com/yourname" },
  { brand: "telegram", name: "Telegram", action: "Join", handle: "Join the channel", placeholder: "https://t.me/yourchannel" },
];

// Read the current editor rows back into state.EXTRA.socials so a save picks them up.
function collectSocials() {
  const list = $("socialsList");
  if (!list) return;
  state.EXTRA.socials = SOCIAL_CATALOG.map((c) => {
    const row = list.querySelector(`[data-social="${c.brand}"]`);
    const url = row ? row.querySelector(".social-url").value.trim() : "";
    const enabled = row ? row.querySelector(".social-toggle").checked : false;
    return { name: c.name, brand: c.brand, handle: c.handle, action: c.action, url, enabled };
  });
}

const SOCIAL_ICONS = {
    discord: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026c.462-.62.874-1.275 1.226-1.963.021-.04.001-.088-.041-.104a13.201 13.201 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.245.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028z"/></svg>`,
    kick: `<span style="font-weight:900;font-size:18px">K</span>`,
    twitch: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>`,
    x: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
    youtube: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
    instagram: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>`,
    telegram: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>`,
  };

  export function renderSocials() {
    const list = $("socialsList");
    if (!list) return;
    const existing = Array.isArray(state.EXTRA?.socials) ? state.EXTRA.socials : [];
    const byBrand = new Map(existing.map((s) => [String(s.brand || s.name || "").toLowerCase(), s]));
    list.innerHTML = SOCIAL_CATALOG.map((c) => {
      const cur = byBrand.get(c.brand) || {};
      const url = cur.url && cur.url !== "#" ? cur.url : "";
      const enabled = cur.enabled !== undefined ? !!cur.enabled : !!url;
      const icon = SOCIAL_ICONS[c.brand] || `<span style="font-weight:700;font-size:14px">${esc(c.name[0])}</span>`;
      return `<div class="social-row-brand" data-social="${esc(c.brand)}">
<div class="social-brand-icon social-brand-icon--${esc(c.brand)}">${icon}</div>
<div><span class="social-name">${esc(c.name)}</span><span class="social-handle">${esc(c.handle)}</span>
<input id="social_${esc(c.brand)}" class="social-url" type="url" inputmode="url" placeholder="${esc(c.placeholder)}" value="${esc(url)}" /></div>
<label class="yr-toggle" title="Show on public page"><input type="checkbox" class="social-toggle" ${enabled ? "checked" : ""} /><span class="yr-slider"></span></label>
</div>`;
    }).join("");
    list.addEventListener("input", collectSocials);
    list.addEventListener("change", collectSocials);
    collectSocials();
  }

const SECTIONS_CATALOG = [
  { key: "leaderboard", label: "Show Leaderboard" },
  { key: "payouts", label: "Show Prize Pool" },
  { key: "countdown", label: "Show Countdown Timer" },
  { key: "rules", label: "Show Rules block" },
  { key: "socials", label: "Show Social Links" },
  { key: "share", label: "Show Share Buttons" },
  { key: "poweredBy", label: "Show 'Powered by YourRank' badge" },
];

function collectSections() {
  const list = $("sectionsList");
  if (!list) return;
  const sections = {};
  for (const row of list.querySelectorAll("[data-section]")) {
    const key = row.dataset.section;
    const checked = row.querySelector(".section-toggle")?.checked ?? true;
    sections[key] = checked;
  }
  state.EXTRA.sections = { ...(state.EXTRA.sections || DEFAULT_SECTIONS), ...sections };
}

export function renderSections() {
  const list = $("sectionsList");
  const body = $("sectionsBody");
  const lock = $("sectionsLock");
  if (list) {
    list.innerHTML = "";
    list.removeEventListener("input", collectSections);
    list.removeEventListener("change", collectSections);
  }
  if (body) body.hidden = !isPro();
  if (lock) lock.hidden = isPro();
  if (!list || !isPro()) return;
  const current = { ...DEFAULT_SECTIONS, ...(state.EXTRA?.sections || {}) };
  list.innerHTML = SECTIONS_CATALOG.map((s) => `<div class="section-row" data-section="${esc(s.key)}">
<span class="section-name">${esc(s.label)}</span>
<label class="switch" title="Show on public page"><input type="checkbox" class="section-toggle" ${current[s.key] !== false ? "checked" : ""} /><span class="switch-track"></span></label>
</div>`).join("");
  list.addEventListener("input", collectSections);
  list.addEventListener("change", collectSections);
  collectSections();
}

export function renderLegal() {
  const list = $("legalList");
  if (!list) return;
  const legal = state.EXTRA?.legal || {};
  const pages = [
    { key: "terms", label: "Terms of Service" },
    { key: "privacy", label: "Privacy Policy" },
    { key: "responsible", label: "Responsible Play" },
    { key: "cookies", label: "Cookie Policy" },
    { key: "refund", label: "Refund Policy" },
    { key: "contact", label: "Contact" },
  ];
  list.innerHTML = pages.map((p) => {
    const enabled = legal[`${p.key}Enabled`] !== false;
    return `<div class="field" style="margin-bottom: 24px;">
<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
  <label for="f_legal_${p.key}" style="margin-bottom: 0;">${esc(p.label)}</label>
  <label class="switch"><input type="checkbox" id="f_legal_${p.key}_enabled"${enabled ? " checked" : ""}><span class="switch-track"></span></label>
</div>
<textarea id="f_legal_${p.key}" rows="4" placeholder="Leave blank to use the default legal text.">${esc(legal[p.key] || "")}</textarea>
</div>`;
  }).join("");
}

export async function renderDomain() {
  const pro = state.ME.plan === "pro" || state.ME.plan === "agency";
  const domainBody = $("domainBody");
  const domainLock = $("domainLock");
  const overview = $("domainOverviewCard");
  const overviewTitle = $("domainOverviewTitle");
  const overviewText = $("domainOverviewText");
  const overviewStatus = $("domainOverviewStatus");
  if (domainBody) domainBody.hidden = !pro;
  if (domainLock) domainLock.hidden = pro;
  if (overview) overview.hidden = false;
  if (overviewTitle) overviewTitle.textContent = "Checking your domain…";
  if (overviewText) overviewText.textContent = "Your default yourrank.site address remains available while we check for a custom domain.";
  if (overviewStatus) overviewStatus.textContent = "Checking";

  // Load existing domain status
  try {
    const activeSiteParam = state.ACTIVE_SITE_ID ? `?siteId=${encodeURIComponent(state.ACTIVE_SITE_ID)}` : "";
    const res = await fetch(`/api/domains/my-domain${activeSiteParam}`, {
      credentials: "include",
      headers: { "x-csrf-token": getCsrf() },
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Could not load domain status.");
    if (data.ok && data.customDomain) {
      if (overview) overview.hidden = true;
      $("domainManageCard")?.removeAttribute("hidden");
      if ($("domainManageName")) $("domainManageName").textContent = data.customDomain;
      const domainState = data.domainStatus || data.order?.status || "active";
      const badge = $("domainManageBadge");
      const manageStatus = $("domainManageStatus");
      const stateLabels = {
        active: "Active",
        pending: "Verification pending",
        saved: "Setup required",
        error: "Needs attention",
      };
      const stateMessages = {
        active: "This domain is opening your site.",
        pending: "Verification is still in progress. DNS changes can take time.",
        saved: "Reconnect the domain below to finish verification.",
        error: "Reconnect the domain below to check its DNS setup.",
      };
      if (badge) {
        badge.textContent = stateLabels[domainState] || "Connected";
        badge.className = `v3-chip${domainState === "active" ? " v3-chip--fulfilled" : domainState === "pending" || domainState === "saved" ? " v3-chip--pending" : ""}`;
      }
      if (manageStatus) manageStatus.textContent = stateMessages[domainState] || "This domain is connected to your site.";
      if ($("domainManageExpiry")) {
        $("domainManageExpiry").textContent = data.order?.expires_at ? new Date(data.order.expires_at).toLocaleDateString() : "Managed externally";
      }
      if ($("domainManageLockStatus")) {
        $("domainManageLockStatus").textContent = data.order?.locked ? "Enabled" : "Unlocked";
      }
      if ($("domainToggleLockBtn")) {
        $("domainToggleLockBtn").textContent = data.order?.locked ? "Unlock for transfer" : "Lock domain";
        $("domainToggleLockBtn").onclick = async () => {
          $("domainManageStatus").textContent = "Updating lock status…";
          try {
            const lRes = await fetch("/api/domains/toggle-lock", {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
              body: JSON.stringify({ domain: data.customDomain, lock: !data.order?.locked }),
            });
            const lData = await lRes.json();
            if (lData.ok) {
              $("domainManageStatus").textContent = lData.message;
              await renderDomain();
            } else {
              $("domainManageStatus").textContent = lData.error || "Failed to update lock.";
            }
          } catch (e) {
            $("domainManageStatus").textContent = "Network error.";
          }
        };
      }
      if ($("domainGetAuthCodeBtn")) {
        $("domainGetAuthCodeBtn").onclick = async () => {
          $("domainManageStatus").textContent = "Requesting transfer code…";
          try {
            const aRes = await fetch("/api/domains/transfer-auth-code", {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
              body: JSON.stringify({ domain: data.customDomain }),
            });
            const aData = await aRes.json();
            if (aData.ok) {
              $("domainManageStatus").innerHTML = `<b>Transfer code:</b> <code class="domain-auth-code">${esc(aData.authCode)}</code><br><small class="muted">${esc(aData.icannNote)}</small>`;
            } else {
              $("domainManageStatus").textContent = aData.error || "Failed to retrieve transfer code.";
            }
          } catch (e) {
            $("domainManageStatus").textContent = "Network error.";
          }
        };
      }
      if ($("domainDisconnectBtn")) {
        $("domainDisconnectBtn").onclick = async () => {
          if (!await showConfirmModal(
            "Disconnect custom domain",
            `${data.customDomain} will stop opening this site. Your yourrank.site address will remain available.`,
            "Disconnect domain",
            true,
          )) return;
          $("domainManageStatus").textContent = "Disconnecting…";
          try {
            const dRes = await fetch("/api/site/domain/verify", {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
              body: JSON.stringify({ remove: true, siteId: state.ACTIVE_SITE_ID }),
            });
            const dData = await dRes.json();
            if (dData.ok) {
              $("domainManageCard")?.setAttribute("hidden", "true");
              $("domainManageStatus").textContent = "Domain disconnected.";
              await renderDomain();
            } else {
              $("domainManageStatus").textContent = dData.error || "Could not disconnect the domain.";
            }
          } catch (e) {
            $("domainManageStatus").textContent = "Network error disconnecting domain.";
          }
        };
      }
    } else {
      $("domainManageCard")?.setAttribute("hidden", "true");
      if (overviewTitle) overviewTitle.textContent = "No custom domain";
      if (overviewText) overviewText.textContent = "Your default yourrank.site address is active. Connect a domain you own or search for a new one below.";
      if (overviewStatus) overviewStatus.textContent = "Not connected";
    }
  } catch (err) {
    logError("domain-status", err);
    if (overviewTitle) overviewTitle.textContent = "Domain status unavailable";
    if (overviewText) overviewText.textContent = "We could not check the current domain. Try again before making changes.";
    if (overviewStatus) overviewStatus.textContent = "Needs attention";
  }

  // Domain search & 1-click purchase wiring
  const searchBtn = $("domainSearchBtn");
  const searchInput = $("domainSearchInput");
  const resultsContainer = $("domainSearchResults");

  const runSearch = async () => {
    const query = searchInput?.value.trim().toLowerCase();
    if (!query) return;
    $("domainSearchStatus").textContent = "Searching available domains…";
    searchBtn.disabled = true;
    try {
      const sRes = await fetch("/api/domains/search", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
        body: JSON.stringify({ query }),
      });
      const sData = await sRes.json();
      if (sData.ok && sData.results) {
        $("domainSearchStatus").textContent = "";
        resultsContainer.removeAttribute("hidden");
        resultsContainer.innerHTML = sData.results.map((r) => `
          <div class="domain-result-card ${r.available ? "is-available" : "is-taken"}">
            <div class="domain-result-name">
              <strong>${esc(r.domain)}</strong>
              <span class="domain-tld-badge">.${esc(r.tld)}</span>
            </div>
            <div class="domain-result-action">
              <span class="domain-result-price">${r.available ? esc(r.priceFormatted) : "Taken"}</span>
              ${r.available ? `<button class="btn btn--sm btn--accent" data-buy-domain="${esc(r.domain)}" data-price="${esc(r.priceFormatted)}">Buy and connect</button>` : `<span class="domain-taken-lbl">Unavailable</span>`}
            </div>
          </div>
        `).join("");

        // Wire purchase buttons
        resultsContainer.querySelectorAll("[data-buy-domain]").forEach((b) => {
          b.addEventListener("click", async () => {
            const domainToBuy = b.dataset.buyDomain;
            const price = b.dataset.price;
            if (!await showConfirmModal(
              "Buy and connect domain",
              `Register ${domainToBuy} for ${price} and connect it to this site? DNS and SSL setup will start automatically.`,
              `Buy for ${price}`,
              false,
            )) return;
            b.disabled = true;
            b.textContent = "Registering…";
            $("domainSearchStatus").textContent = `Registering ${domainToBuy} and setting up its secure connection…`;
            try {
              // AUDIT-B5: money endpoint, previously no timeout — a hung
              // request left the button at "Registering…" forever.
              const pRes = await withDashboardTimeout(
                (signal) => fetch("/api/domains/purchase", {
                  method: "POST",
                  credentials: "include",
                  headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
                  body: JSON.stringify({ domain: domainToBuy, siteId: state.ACTIVE_SITE_ID }),
                  signal,
                }),
                { timeoutMs: 45_000 },
              );
              const pData = await pRes.json();
              if (pData.ok) {
                $("domainSearchStatus").innerHTML = `<span class="domain-ok">${esc(pData.message)}</span>`;
                resultsContainer.setAttribute("hidden", "true");
                await renderDomain();
              } else {
                $("domainSearchStatus").innerHTML = `<span class="domain-error">${esc(pData.error || "Purchase failed.")}</span>`;
                b.disabled = false;
                b.textContent = "Buy and connect";
              }
            } catch (err) {
              $("domainSearchStatus").innerHTML = `<span class="domain-error">Network error.</span>`;
              b.disabled = false;
              b.textContent = "Buy and connect";
            }
          });
        });
      } else {
        $("domainSearchStatus").textContent = sData.error || "Search failed.";
      }
    } catch (err) {
      logError("domain-search", err);
      $("domainSearchStatus").textContent = "Network error searching domains.";
    } finally {
      searchBtn.disabled = false;
    }
  };

  if (searchBtn && searchInput) {
    searchBtn.onclick = runSearch;
    searchInput.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } };
  }

  // Connect existing domain verification
  const verifyBtn = $("domainVerify");
  if (verifyBtn) {
    verifyBtn.onclick = async () => {
      const domain = $("f_domain").value.trim().toLowerCase();
      if (!domain) { $("domainStatus").textContent = "Enter a domain first."; return; }
      $("domainStatus").textContent = "Verifying…";
      verifyBtn.disabled = true;
      try {
        const body = { domain };
        if (state.ACTIVE_SITE_ID) body.siteId = state.ACTIVE_SITE_ID;
        const res = await fetch("/api/site/domain/verify", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
          body: JSON.stringify(body),
        });
        const d = await res.json();
        if (d.ok) {
          renderDomainStatus(d.status, d.message);
          await renderDomain();
        } else {
          $("domainStatus").innerHTML = `<span class="domain-error">${esc(d.error || "Verification failed.")}</span>`;
        }
      } catch (err) {
        logError("domain-verify", err);
        $("domainStatus").innerHTML = `<span class="domain-error">Network error.</span>`;
      }
      verifyBtn.disabled = false;
    };
  }
}

export function renderDomainStatus(status, message) {
  const el = $("domainStatus");
  if (!el) return;
  if (status === "not_configured") {
    el.textContent = "No custom domain configured. Your yourrank.site link is active.";
  } else if (status === "active") {
    el.innerHTML = `<span class="domain-ok">${esc(message || "Domain active with TLS")}</span>`;
  } else if (status === "pending") {
    el.innerHTML = `<span class="domain-pending">${esc(message || "DNS detected; TLS provisioning is in progress")}</span>`;
  } else if (status === "error") {
    el.innerHTML = `<span class="domain-error">${esc(message || "Domain setup needs attention")}</span>`;
  } else if (status === "saved") {
    el.innerHTML = `<span class="domain-saved">${esc(message || "Domain saved; TLS automation is not configured")}</span>`;
  } else {
    el.textContent = "";
  }
}

export async function loadCreditsStatus() {
  const statusEl = $("kickStatus");
  const linkEl = $("kickRewardsLink");
  setState({ CREDITS_STATUS: "loading" });
  if (statusEl) {
    statusEl.setAttribute("aria-busy", "true");
    statusEl.innerHTML = '<span class="skeleton v3-skel-line" aria-hidden="true"></span>';
  }
  try {
    const creditsUrl = state.ACTIVE_SITE_ID ? `/api/credits/status?siteId=${encodeURIComponent(state.ACTIVE_SITE_ID)}` : "/api/credits/status";
    const res = await fetch(creditsUrl);
    const data = await res.json();
    setState({ CREDITS: data, CREDITS_STATUS: "ready", CREDITS_PRODUCT_ENABLED: data.enabled === true });
    renderOverviewSummary();
    const connected = Boolean(data.channel?.externalId);
    if (statusEl) statusEl.textContent = connected
      ? `Connected to ${data.channel?.name || "your Kick channel"}. ${data.usage?.rewardMappings == null ? "—" : data.usage.rewardMappings} ways to earn active.`
      : "Connect your Kick channel in Rewards to start giving members credits.";
    if (linkEl) linkEl.textContent = connected ? "Manage connected apps →" : "Open connected apps →";
  } catch (err) {
    setState({ CREDITS_STATUS: "error" });
    logError("credits/status", err);
    renderOverviewSummary();
    if (statusEl) {
      statusEl.removeAttribute("aria-busy");
      statusEl.textContent = "Could not load connected apps status. Try again.";
    }
  }
}

/* --- past winners / close out --- */
export function renderArchives(list) {
  const box = $("archList"); box.innerHTML = "";
  if (list.length) clearLoadError($("archEmpty"), false);
  else renderEmpty($("archEmpty"), { icon: "archive", title: "No closed-out periods yet", body: "Your first one will show up here and on your page." });
  list.forEach((a) => {
    const row = document.createElement("div"); row.className = "arch-row";
    const when = new Date(a.at).toLocaleDateString();
    row.innerHTML = `<span class="arch-label"></span><span class="hint">${a.players} players · closed ${when}</span><button class="btn btn--xs btn--ghost arch-restore" type="button">Restore</button><button class="btn btn--xs btn--ghost arch-del" type="button">Delete</button>`;
    row.querySelector(".arch-label").textContent = a.label;
    row.querySelector(".arch-restore").addEventListener("click", async (e) => {
      if (!await showConfirmModal("Restore archive", `Restore players from "${a.label}"? This will replace the current player list. Save changes to publish.`, "Restore", false)) return;
      const btn = e.target;
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Restoring…";
      try {
        const body = { archiveId: a.id };
        if (state.ACTIVE_SITE_ID) body.siteId = state.ACTIVE_SITE_ID;
        const res = await fetch("/api/site/archive/restore", { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": getCsrf() }, body: JSON.stringify(body) });
        const d = await res.json().catch(() => ({}));
        if (res.ok && d.ok) {
          const apiUrl = state.ACTIVE_SITE_ID ? `/api/site?siteId=${encodeURIComponent(state.ACTIVE_SITE_ID)}` : "/api/site";
          const p = await (await fetch(apiUrl)).json();
          if (p.ok) {
            commitDraftMutation(() => {
              renderPlayers(p.data.players || []);
              renumber();
              toggleEmpty();
            }, `Restored ${d.players || a.players} players from "${a.label}". Save to publish.`);
          }
        } else $("status").textContent = d.error || "Couldn't restore that.";
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    });
    row.querySelector(".arch-del").addEventListener("click", async (e) => {
      if (!await showConfirmModal("Delete archive", `Delete the "${a.label}" archive? It disappears from your page too.`, "Delete", true)) return;
      const btn = e.target;
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Deleting…";
      try {
        const body = { id: a.id };
        if (state.ACTIVE_SITE_ID) body.siteId = state.ACTIVE_SITE_ID;
        const res = await fetch("/api/site/archive/delete", { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": getCsrf() }, body: JSON.stringify(body) });
        const d = await res.json();
        if (res.ok && d.ok) {
          row.remove();
          if (!$("archList").children.length) renderEmpty($("archEmpty"), { icon: "archive", title: "No closed-out periods yet", body: "Your first one will show up here and on your page." });
          $("status").textContent = "Archive deleted.";
        }
        else $("status").textContent = d.error || "Couldn't delete that.";
      } finally {
        if (document.body.contains(btn)) {
          btn.disabled = false;
          btn.textContent = orig;
        }
      }
    });
    box.appendChild(row);
  });
}

$("a_go")?.addEventListener("click", () => { closeOutPeriod(); });

export async function closeOutPeriod({
  collectImpl = collect,
  fetchJsonImpl = fetchDashboardJson,
  confirmImpl = showConfirmModal,
} = {}) {
  const btn = $("a_go"), status = $("status");
  if (![...$("rows").children].length) { status.textContent = "The board is empty — nothing to close out."; return; }
  const clear = $("a_clear").value;
  const warn = clear === "players" ? "save the current board as past winners, then CLEAR the player list" : clear === "wagers" ? "save the current board as past winners, then reset every wager to 0" : "save the current board as past winners";
  if (!await confirmImpl("Close out period", `This will ${warn}. Continue?`, "Close out", true)) return;
  btn.disabled = true; btn.textContent = "Closing out…";
  try {
    const { payload: savePayload, invalid } = collectImpl();
    if (invalid.length) {
      const first = invalid[0];
      $("status").textContent = `Fix the invalid ${first.label.toLowerCase()} before closing out.`;
      first.input?.focus();
      btn.disabled = false;
      btn.textContent = "Close out period";
      return;
    }
    await fetchJsonImpl("/api/site", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
      body: JSON.stringify(savePayload),
    }, { timeoutMs: 20_000 });
    const archiveBody = { label: $("a_label").value.trim(), clear };
    if (state.ACTIVE_SITE_ID) archiveBody.siteId = state.ACTIVE_SITE_ID;
    const { body: d } = await fetchJsonImpl("/api/site/archive", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
      body: JSON.stringify(archiveBody),
    }, { timeoutMs: 20_000 });
    const apiUrl2 = state.ACTIVE_SITE_ID ? `/api/site?siteId=${encodeURIComponent(state.ACTIVE_SITE_ID)}` : "/api/site";
    const { body: p } = await fetchJsonImpl(apiUrl2, { credentials: "same-origin" });
    if (p?.ok) {
      commitDraftMutation(() => {
        renderPlayers(p.data.players || []);
        renderArchives(p.archives || []);
      }, `"${d.label}" closed out. Save to publish.`);
      $("a_label").value = "";
      status.textContent = `"${d.label}" closed out — it's on your page now.`;
    } else {
      throw new DashboardRequestError(p?.error || "Couldn't refresh the board after closing out.", { code: "SERVER" });
    }
  } catch (err) {
    logError("archive", err);
    status.setAttribute("role", "alert");
    status.setAttribute("aria-live", "assertive");
    status.textContent = closeOutErrorMessage(err);
  }
  btn.disabled = false; btn.textContent = "Close out period";
}

function closeOutErrorMessage(err) {
  if (err?.code === "AUTH") return "Your session ended — your changes are still here. Sign in again in a new tab, then retry.";
  if (err?.code === "FORBIDDEN") return err.message || "You don't have access to do that.";
  if (err?.code === "concurrency_conflict" || err?.status === 409) return "Another session saved this leaderboard. Your draft is still here — reload to review their version, or save again after reconciling.";
  if (err?.code === "TIMEOUT") return "Closing out timed out. Your changes are still here — try again.";
  if (err?.code === "NETWORK") return "Couldn't close out — your changes are still here. Check your connection and try again.";
  return err?.message || "Couldn't close out — your changes are still here. Check your connection and try again.";
}

export async function saveEditorDraft({ fetchImpl = fetch, collectImpl = collect, button } = {}) {
  const btn = button || $("save"), status = $("status"), publishAction = $("publishAction");
  const { payload, invalid } = collectImpl();
  if (invalid.length) {
    const first = invalid[0];
    status.textContent = `Fix the invalid ${first.label.toLowerCase()} before saving.`;
    status.hidden = false;
    status.setAttribute("role", "alert");
    first.input?.focus();
    return;
  }
  btn.disabled = true; btn.textContent = "Saving…"; status.textContent = "";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  if (publishAction) { publishAction.disabled = true; publishAction.setAttribute("aria-busy", "true"); }
  const limitEl = $("limitMsg"); if (limitEl) limitEl.textContent = "";
  let justPublished = false;
  try {
    // AUDIT-B5: raw fetch had no timeout — a hung connection left the button
    // at "Saving…" forever. Run the save through the shared timeout wrapper.
    // A 401 means the session ended mid-edit — keep the draft on screen so
    // the user can re-auth in another tab instead of being bounced to /login.
    // A 403 means the signed-in user is not allowed to save this board; keep
    // the draft on screen and show the server's permission message.
    const { body: d } = await fetchDashboardJson("/api/site", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
      body: JSON.stringify(payload),
    }, { fetchFn: fetchImpl, timeoutMs: 20_000 });
    justPublished = !!payload.published && !state.PUBLISHED;
    if (Array.isArray(payload.players)) state.SAMPLE_PLAYERS = false;
    state.SAVED_PLAYERS = Array.isArray(payload.players) ? payload.players.map((player) => ({ ...player })) : [];
    clearPlayersDraft();
    const restoredNotice = $("playersDraftNotice");
    if (restoredNotice) restoredNotice.hidden = true;
    setState({ _dirty: false, PUBLISHED: !!payload.published, RANK_BY: payload.rankBy === "score" ? "score" : "wagered" });
    status.textContent = justPublished && !boardStatus().emailVerified
      ? "Published — Your leaderboard will open to visitors after you confirm your email."
      : "Saved";
    if (d.updatedAt) setState({ SITE_UPDATED_AT: d.updatedAt });
    if (d.publishedAt) setState({ PUBLISHED_AT: d.publishedAt });
    const saveBtn = $("save"); if (saveBtn) saveBtn.textContent = "Save changes";
    renderSavebarCopy();
    renderEditorTimestamps();
    renderBoardStatus();
    renderOverviewSummary();
    const active = state.BOARDS.find((b) => b.id === state.ACTIVE_SITE_ID);
    if (active) { active.name = payload.name; active.casino = payload.brand?.casino || active.casino; active.code = payload.brand?.code || active.code; active.published = !!payload.published; }
    renderBoardSwitcher();
    renderBoardSelect();
    renderBoardsPage();
    if (justPublished && boardStatus().live) {
      const publicUrl = `${location.origin}/${state.SLUG}`;
      const handoff = $("publishHandoff");
      if (handoff) {
        handoff.hidden = false;
        if ($("publishHandoffUrl")) $("publishHandoffUrl").textContent = publicUrl;
        if ($("publishHandoffOpen")) $("publishHandoffOpen").href = publicUrl;
        const copy = $("publishHandoffCopy");
        if (copy) copy.onclick = async () => {
          const copied = await copyToClipboard(publicUrl);
          flashButton(copy, copied ? "Copied!" : "Copy failed");
        };
      }
      showToast(`Published at ${publicUrl}`, "success");
    }
    // Close the 2-click loop: refresh the live preview so the edit shows immediately.
    updateDesignPreview();
  } catch (err) {
    logError("save", err);
    // The draft is intentionally NOT cleared on any failure — say so.
    status.setAttribute("role", "alert");
    status.setAttribute("aria-live", "assertive");
    if (err?.code === "AUTH") {
      status.textContent = "Your session ended — your changes are still here. Sign in again in a new tab, then retry.";
    } else if (err?.code === "FORBIDDEN") {
      status.textContent = err.message || "You don't have access to do that.";
    } else if (err?.code === "concurrency_conflict" || err?.status === 409) {
      status.textContent = "Another session saved this leaderboard. Your draft is still here — reload to review their version, or save again after reconciling.";
    } else if (err?.code === "TIMEOUT") {
      status.textContent = "Saving timed out. Your changes are still here — try again.";
    } else if (err?.code === "NETWORK") {
      status.textContent = "Couldn't save. Your changes are still here — try again.";
    } else {
      status.textContent = err?.message || "Couldn't save. Your changes are still here — try again.";
    }
  }
  btn.disabled = false; btn.textContent = "Save changes";
  if (publishAction) { publishAction.disabled = false; publishAction.removeAttribute("aria-busy"); }
  const savedMsg = status.textContent;
  if (justPublished || savedMsg === "Saved") {
    setTimeout(() => { if (status.textContent === savedMsg) status.textContent = ""; }, 6000);
  }
}

$("save")?.addEventListener("click", () => { saveEditorDraft(); });
$("settingsSave")?.addEventListener("click", (event) => {
  saveEditorDraft({ button: event.currentTarget });
});

export function discardEditorChanges({ reload = () => location.reload() } = {}) {
  clearPlayersDraft();
  setState({ _dirty: false });
  reload();
}

$("discard")?.addEventListener("click", async () => {
  if (!state._dirty) return;
  const confirmed = await showConfirmModal(
    "Discard unsaved changes",
    "Discard all staged editor changes and reload the last saved version?",
    "Discard changes",
    true,
  );
  if (!confirmed) return;
  discardEditorChanges();
});

export function renderEmbedShare() {
    const slug = state.SLUG;
    if (!slug) return;
    wireObsTools();
    const origin = location.origin;
    const publicUrl = origin + "/" + slug;

    // Public link
    const pubLink = $("embedPublicLink");
    if (pubLink) pubLink.textContent = publicUrl;
    const pubCopy = $("embedPublicCopy");
    if (pubCopy && !pubCopy._wired) {
      pubCopy._wired = true;
      pubCopy.addEventListener("click", async () => {
        const ok = await copyToClipboard(publicUrl);
        flashButton(pubCopy, ok ? "Copied!" : "Copy failed");
      });
    }

    // The server exposes overlays for every non-Free effective plan.
    const obsUrl = origin + "/" + slug + "/overlay";
    const overlayAccess = state.ME?.plan !== "free";
    const obsBox = $("embedObsUrl")?.closest(".embed-obs-box");
    const obsLock = $("embedObsLock");
    if (obsLock) {
      obsLock.hidden = overlayAccess;
      const upgrade = $("overlayUpgrade");
      if (upgrade && !upgrade._wired) {
        upgrade._wired = true;
        upgrade.addEventListener("click", (event) => {
          event.preventDefault();
          checkout("pro", event.currentTarget);
        });
      }
    }
    if (obsBox) obsBox.hidden = !overlayAccess;
    const obsLink = $("embedObsUrl");
    if (obsLink) obsLink.textContent = overlayAccess ? obsUrl : "";
    const obsCopy = $("embedObsCopy");
    if (overlayAccess && obsCopy && !obsCopy._wired) {
      obsCopy._wired = true;
      obsCopy.addEventListener("click", async () => {
        const ok = await copyToClipboard(obsUrl);
        flashButton(obsCopy, ok ? "Copied!" : "Copy failed");
      });
    }

    // Embed code
    const embedCode = `<iframe src="${origin}/${slug}/embed" width="100%" height="600" frameborder="0"></iframe>`;
    const embedInline = $("embedCodeInline");
    if (embedInline) embedInline.textContent = embedCode;
    const embedCopy = $("embedCodeCopy");
    if (embedCopy && !embedCopy._wired) {
      embedCopy._wired = true;
      embedCopy.addEventListener("click", async () => {
        const ok = await copyToClipboard(embedCode);
        flashButton(embedCopy, ok ? "Copied!" : "Copy failed");
      });
    }

    // Embed options: transparent + hide branding
    const transparentCb = $("embedTransparent");
    const brandingCb = $("embedHideBranding");
    const updateEmbedCode = () => {
      let src = `${origin}/${slug}/embed`;
      const params = [];
      if (transparentCb?.checked) params.push("transparent=1");
      if (brandingCb?.checked) params.push("noBrand=1");
      if (params.length) src += "?" + params.join("&");
      const code = `<iframe src="${src}" width="100%" height="600" frameborder="0"></iframe>`;
      if (embedInline) embedInline.textContent = code;
    };
    if (transparentCb && !transparentCb._wired) { transparentCb._wired = true; transparentCb.addEventListener("change", updateEmbedCode); }
    if (brandingCb && !brandingCb._wired) { brandingCb._wired = true; brandingCb.addEventListener("change", updateEmbedCode); }

    // Social share cards
    const shareUrl = encodeURIComponent(publicUrl);
    const shareText = encodeURIComponent("Check out my leaderboard!");
    const shareX = $("shareX");
    if (shareX && !shareX._wired) { shareX._wired = true; shareX.addEventListener("click", () => window.open(`https://twitter.com/intent/tweet?url=${shareUrl}&text=${shareText}`, "_blank")); }
    const shareDiscord = $("shareDiscord");
    if (shareDiscord && !shareDiscord._wired) { shareDiscord._wired = true; shareDiscord.addEventListener("click", () => window.open(`https://discord.com/channels/@me`, "_blank")); }
    const shareTwitch = $("shareTwitch");
    if (shareTwitch && !shareTwitch._wired) { shareTwitch._wired = true; shareTwitch.addEventListener("click", () => window.open(`https://dashboard.twitch.tv`, "_blank")); }
    const shareCopy = $("shareCopy");
    if (shareCopy && !shareCopy._wired) {
      shareCopy._wired = true;
      shareCopy.addEventListener("click", async () => {
        const ok = await copyToClipboard(publicUrl);
        flashButton(shareCopy, ok ? "Copied!" : "Copy failed");
      });
    }

    // API access (unlock for Pro)
    const apiEl = $("apiAccess");
    if (apiEl) {
      apiEl.classList.toggle("locked", !isPro());
    }
  }

export async function loadStats() {
  setState({ STATS_STATUS: "loading" });
  renderPerformanceLoading();
  const statsUrl = state.ACTIVE_SITE_ID ? `/api/site/stats?siteId=${encodeURIComponent(state.ACTIVE_SITE_ID)}` : "/api/site/stats";
  let s;
  try {
    const r = await fetch(statsUrl);
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || `stats ${r.status}`);
    s = d.stats;
  } catch (err) {
    // Returning quietly left "No activity yet" on screen, which reads as a
    // fact about the account rather than a failed request.
    logError("load-stats", err);
    setState({ STATS_STATUS: "error" });
    showLoadError($("statsEmpty"), "your stats", loadStats);
    renderStatsError();
    return null;
  }
  setState({ STATS: s, STATS_STATUS: "ready" });
  renderOverviewSummary();
  renderPerformance(s);
  return s;
}

function renderStatsError() {
  ["perfKpiViews", "perfKpiClicks", "perfKpiCopies", "perfKpiCtr", "perfTotalViews"].forEach((id) => setMetricUnknown($(id), "error"));
  ["perfKpiViewsDelta", "perfKpiClicksDelta", "perfKpiCopiesDelta", "perfKpiCtrDelta"].forEach((id) => {
    const node = $(id);
    if (node) node.textContent = "";
  });
  if ($("perfExport")) $("perfExport").hidden = true;
  const rangeFilter = $("perfRangeFilter");
  if (rangeFilter) {
    rangeFilter.dataset.hasData = "0";
    rangeFilter.hidden = true;
  }
  if ($("statBars")) $("statBars").innerHTML = "";
  if ($("perfActivityBody")) $("perfActivityBody").innerHTML = "";
  showLoadError($("perfActivityEmpty"), "daily activity", loadStats);
  const events = $("eventsList");
  if (events) {
    events.removeAttribute("aria-busy");
    events.innerHTML = "";
    events.hidden = true;
  }
  showLoadError($("eventsEmpty"), "site activity", loadStats);
}

// Cross-tab sign-out is handled by the shared /assets/shell-nav.js script so
// every page with the shell (SPA, standalone Rewards/Audience/Giveaways, and
// Telegram) broadcasts yr:logout from a single place after the server logout
// succeeds. This avoids duplicating the logout implementation and keeps the
// failure/redirect semantics identical everywhere.
$("upgrade")?.addEventListener("click", (e) => { e.preventDefault(); checkout("pro", e.target); });
$("testDiscord")?.addEventListener("click", async () => {
  const s = $("testDiscordStatus"); if (s) s.textContent = "Sending…";
  try {
    const r = await fetch("/api/site/notify/test", { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": getCsrf() }, body: JSON.stringify({ channel: "discord", webhook_url: $("f_webhook")?.value.trim() || undefined, siteId: state.ACTIVE_SITE_ID || undefined }) });
    const d = await r.json();
    if (s) s.textContent = d.ok ? "✅ Sent!" : (d.error || "Failed");
  } catch (e) { if (s) s.textContent = "Network error."; }
});
$("testTelegram")?.addEventListener("click", async () => {
  const s = $("testTelegramStatus"); if (s) s.textContent = "Sending…";
  try {
    const r = await fetch("/api/site/notify/test", { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": getCsrf() }, body: JSON.stringify({ channel: "telegram", chat_id: $("f_tgChatId")?.value.trim() || undefined, siteId: state.ACTIVE_SITE_ID || undefined }) });
    const d = await r.json();
    if (s) s.textContent = d.ok ? "✅ Sent!" : (d.error || "Failed");
  } catch (e) { if (s) s.textContent = "Network error."; }
});