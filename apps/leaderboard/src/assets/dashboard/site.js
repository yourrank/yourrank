// Site editing: plan, branding/theme, save, archive, domain, overlay, notifications.
import { $, esc, getCsrf, guardAuth, logError, timeZoneOffsetLabel, validateScheduleValues, showConfirmModal, showToast, copyToClipboard, flashButton, showLoadError, clearLoadError } from "./utils.js";
import { serializeWebhookUrl } from "./notifications.js";
import { resolveViewerTemplate } from "@yourrank/shared/viewer-templates";
import { state, boardStatus, markDirty, setState, subscribe } from "./state.js";
import { renderEmpty, setMetricUnknown } from "./states.js";
import { renderBoardSwitcher, renderBoardSelect, renderBoardsPage } from "./boards.js";
import { renderOverviewSummary } from "./overview.js";
import { renderPerformance, renderPerformanceLoading } from "./performance.js";
import { clearPlayersDraft, collectPlayers, commitDraftMutation, renderPlayers, renumber, toggleEmpty } from "./players.js";
import { requestPublicationChange } from "./publication.js";
import { DashboardRequestError, fetchDashboardJson, withDashboardTimeout } from "./request.js";
import { requestBillingRedirect } from "./shell.js";
import { effectiveBoardRole } from "./role-preview.js";
import { activeViewerUsageMarkup } from "./plan-usage.js";
import { PLAN_META, PLAN_PRICING } from "@yourrank/shared/plans";
import { CREATOR_CONTACT_FIELD_LABELS, CREATOR_CONTACT_TYPES, validateCreatorContact } from "@yourrank/shared/creator-contact";

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
  loyaltyLeaderboard: false,
};

const PLAN_ORDER = ["free", "pro", "team"];
const DEFAULT_PRIZES = { prizePoolLabel: "Prize pool", payoutsLabel: "Payouts", countdownLabel: "", currency: "$", hidePrizeAmounts: false, payoutNote: "" };

export function isPro() {
  const plan = state.ME?.plan;
  return plan === "pro" || plan === "team";
}

// Postback keys belong to the signed-in account and only authorize boards that
// account owns, so the key is only useful (and only shown) to the board owner.
export function canManageApiKey(boards = state.BOARDS, activeSiteId = state.ACTIVE_SITE_ID) {
  const board = (boards || []).find((entry) => entry.id === activeSiteId) || null;
  return effectiveBoardRole(board) === "owner";
}

const API_KEY_MASK = "•".repeat(20);
let apiKey = "";
let apiKeyRevealed = false;
let apiKeyLoading = null;

function paintApiKey() {
  const value = $("apiKeyValue");
  const reveal = $("apiKeyReveal");
  if (value) {
    value.textContent = apiKey ? (apiKeyRevealed ? apiKey : API_KEY_MASK) : "No key yet";
    value.dataset.masked = apiKeyRevealed ? "0" : "1";
  }
  if (reveal) {
    reveal.textContent = apiKeyRevealed ? "Hide" : "Reveal";
    reveal.setAttribute("aria-pressed", apiKeyRevealed ? "true" : "false");
    reveal.disabled = !apiKey;
  }
  const copy = $("apiKeyCopy");
  if (copy) copy.disabled = !apiKey;
}

// GET returns the account's active postback key; the first rotate creates one.
// Reuses the postback_keys infrastructure shared with deposit tracking.
async function loadApiKey() {
  if (apiKeyLoading) return apiKeyLoading;
  apiKeyLoading = (async () => {
    const hint = $("apiKeyHint");
    apiKeyRevealed = false;
    try {
      const r = await fetch("/api/account/postbacks", { credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || `postbacks ${r.status}`);
      if (d.postback?.key) {
        apiKey = d.postback.key;
        if (hint) hint.textContent = "";
      } else {
        const created = await fetch("/api/account/postbacks/rotate", { method: "POST", credentials: "include", headers: { "x-csrf-token": getCsrf() } });
        const cd = await created.json().catch(() => ({}));
        if (!created.ok || !cd.ok || !cd.postback?.key) throw new Error(cd.error || `postbacks ${created.status}`);
        apiKey = cd.postback.key;
        if (hint) hint.textContent = "Key created. Keep it secret — anyone holding it can post scores to your boards.";
      }
      const details = $("apiAccessDetails");
      if (details) details._apiLoaded = true;
    } catch (err) {
      logError("load-api-key", err);
      apiKey = "";
      if (hint) hint.textContent = "Could not load your API key. Reload to try again.";
    } finally {
      apiKeyLoading = null;
      paintApiKey();
    }
  })();
  return apiKeyLoading;
}

async function rotateApiKey(button) {
  const confirmed = await showConfirmModal(
    "Rotate API key",
    "The current key stops working immediately. Update any system that posts scores with the new key.",
    "Rotate",
    true,
  );
  if (!confirmed) return;
  button.disabled = true;
  const hint = $("apiKeyHint");
  try {
    const r = await fetch("/api/account/postbacks/rotate", { method: "POST", credentials: "include", headers: { "x-csrf-token": getCsrf() } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok || !d.postback?.key) throw new Error(d.error || `rotate ${r.status}`);
    apiKey = d.postback.key;
    apiKeyRevealed = false;
    if (hint) hint.textContent = "Key rotated. The previous key has been revoked.";
    showToast("API key rotated.", "success");
  } catch (err) {
    logError("rotate-api-key", err);
    showToast(err.message || "Could not rotate the key.", "error");
  } finally {
    button.disabled = false;
    paintApiKey();
  }
}

export function renderApiAccess() {
  const apiEl = $("apiAccess");
  if (!apiEl) return;
  const unlocked = isPro();
  const owner = canManageApiKey();
  apiEl.classList.toggle("locked", !unlocked);
  const lockedNote = $("apiLockedNote");
  if (lockedNote) lockedNote.hidden = unlocked;
  const badge = $("apiLockBadge");
  if (badge) badge.hidden = unlocked;
  const roleNote = $("apiRoleNote");
  if (roleNote) roleNote.hidden = !unlocked || owner;
  const setup = $("apiSetup");
  if (setup) setup.hidden = !unlocked || !owner;
  const upgrade = $("apiUpgrade");
  if (upgrade && !upgrade._wired) {
    upgrade._wired = true;
    upgrade.addEventListener("click", (event) => {
      event.preventDefault();
      checkout("pro", event.currentTarget);
    });
  }
  if (!unlocked || !owner) return;

  const reveal = $("apiKeyReveal");
  if (reveal && !reveal._wired) {
    reveal._wired = true;
    reveal.addEventListener("click", () => {
      apiKeyRevealed = !apiKeyRevealed;
      paintApiKey();
    });
  }
  const copy = $("apiKeyCopy");
  if (copy && !copy._wired) {
    copy._wired = true;
    copy.addEventListener("click", async () => {
      if (!apiKey) return;
      const ok = await copyToClipboard(apiKey);
      flashButton(copy, ok ? "Copied!" : "Copy failed");
    });
  }
  const rotate = $("apiKeyRotate");
  if (rotate && !rotate._wired) {
    rotate._wired = true;
    rotate.addEventListener("click", () => rotateApiKey(rotate));
  }
  paintApiKey();
  // Fetch (or create) the key only once the creator opens Developer tools.
  const details = $("apiAccessDetails");
  const ensureKey = () => { if (details?.open && (!apiKey || !details._apiLoaded)) loadApiKey(); };
  if (details && !details._apiWired) {
    details._apiWired = true;
    details.addEventListener("toggle", ensureKey);
  }
  // Account or board switches re-render; refetch so the key shown is the caller's.
  if (details) details._apiLoaded = false;
  ensureKey();
}

let billingInterval = "monthly";
let billingInfo = null;
let billingBusy = false;
function planDefs() {
  return PLAN_ORDER.map((key) => ({ key, ...PLAN_META[key],
    priceStr: `$${billingInterval === "annual" ? PLAN_PRICING[key].effectiveAnnualMonthlyUsd : PLAN_PRICING[key].monthlyUsd}`,
    period: key === "free" ? "forever" : "/month",
    note: key === "free" ? "No card needed" : billingInterval === "annual" ? `$${PLAN_PRICING[key].annualUsd} billed annually` : "Billed monthly",
  }));
}

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
  const btn = typeof planOrBtn === "object" ? planOrBtn : btnRef;
  const plan = typeof planOrBtn === "string" ? planOrBtn : btn?.dataset.plan || "pro";
  await openBilling("checkout", btn, { plan, interval: billingInterval });
}

async function openBilling(action, btn, body = {}) {
  if (billingBusy) return;
  billingBusy = true;
  const label = btn?.textContent;
  const status = $("billingStatus") || $("status");
  if (btn) { btn.disabled = true; btn.textContent = "Opening Polar…"; }
  if (status) status.textContent = "Connecting to Polar…";
  try {
    const { body: result } = await fetchDashboardJson(`/api/billing/${action}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": getCsrf() }, body: JSON.stringify(body) });
    await requestBillingRedirect(result.url);
  } catch (error) {
    const message = error.message || "Could not open billing. Try again.";
    if (status) status.textContent = message;
    showToast(message, "error");
  } finally {
    billingBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

async function loadPendingPayment() {
  const wrap = $("pendingPayment");
  const link = $("pendingPaymentLink");
  const status = wrap?.querySelector("p[role='status']");
  if (!wrap || !link || !status) return;
  wrap.hidden = true;
}

function renderPlanCard(p, isCurrent, isLower, cta, accent) {
  const classes = ["plan-card"];
  if (isCurrent) classes.push("plan-card--current");
  if (p.highlight) classes.push("plan-card--popular");
  const available = billingInfo?.options?.[p.key]?.[billingInterval];
  const disabled = isCurrent || isLower || !available || billingInfo?.hasSubscription ? "disabled" : "";
  const note = p.highlight ? '<span class="plan-card-note">Recommended</span>' : "";
  const list = p.features.map((f) => `<li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>${esc(f)}</li>`).join("");
  const ctaEl = `<button class="${accent ? "btn btn--sm btn--accent plan-card-cta" : "btn btn--sm plan-card-cta"}" data-plan="${esc(p.key)}" ${disabled}>${esc(cta)}</button>`;
  return `<article class="${classes.join(" ")}"><div class="plan-card-head"><div class="plan-card-name">${esc(p.name)}${note}</div><p class="plan-card-sub">${esc(p.positioning)}</p><div class="plan-card-price">${esc(p.priceStr)}<span>${esc(p.period)}</span></div><p class="plan-card-sub">${esc(p.note)}</p></div>${ctaEl}<ul class="plan-card-features">${list}</ul></article>`;
}

export function renderPlan() {
  const plan = state.ME.plan || "free";
  const isTrial = state.ME.isTrial;
  const planNames = { free: "Free", pro: "Pro", team: "Team" };
  const currentName = planNames[plan] || plan;
  const expiry = state.ME.planExpiresAt;
  const expiresMs = expiry && Number(expiry) > 0 ? Number(expiry) : null;
  const expiryDate = expiresMs ? new Date(expiresMs).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;
  const subStatus = String(state.ME.subscriptionStatus || "").toLowerCase();
  const hasSubscription = Boolean(billingInfo?.hasSubscription);
  const planExpired = expiresMs != null && expiresMs <= Date.now();

  // Status chip + date line, instead of a bare "Active until …" string.
  let chipLabel = null, chipClass = "v3-chip--fulfilled", dateLine = "";
  if (plan === "free") {
    chipLabel = "Free";
    chipClass = "";
    dateLine = "No paid features. Upgrade to add capacity.";
  } else if (isTrial) {
    chipLabel = "Trial";
    chipClass = "v3-chip--pending";
    dateLine = expiryDate ? `Trial ends ${expiryDate}.` : "";
  } else if (subStatus === "canceled" || subStatus === "cancelled") {
    chipLabel = "Cancels";
    chipClass = "v3-chip--pending";
    dateLine = expiryDate ? `Access ends ${expiryDate}.` : "";
  } else if (subStatus === "past_due") {
    chipLabel = "Past due";
    chipClass = "v3-chip--cancelled";
    dateLine = "A payment failed — update billing in the portal to keep access.";
  } else if (planExpired) {
    chipLabel = "Expired";
    chipClass = "v3-chip--cancelled";
    dateLine = expiryDate ? `Ended ${expiryDate}.` : "";
  } else if (plan !== "free") {
    chipLabel = "Active";
    dateLine = expiryDate
      ? (hasSubscription ? `Renews ${expiryDate}.` : `Access until ${expiryDate}.`)
      : "";
  }

  const summary = $("planSummary");
  if (summary) {
    summary.innerHTML = `
      <div class="plan-status">
        <div class="plan-status-head">
          <span class="plan-status-name">${esc(currentName)}</span>
          ${chipLabel ? `<span class="v3-chip ${chipClass}">${esc(chipLabel)}</span>` : ""}
        </div>
        ${dateLine ? `<p class="plan-status-meta">${esc(dateLine)}</p>` : ""}
      </div>`;
  }

  const banner = $("planBanner");
  if (banner) {
    if (plan !== "free" && !billingInfo?.hasSubscription && expiry && Number(expiry) > 0) {
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

  const grid = $("planGrid");
  if (grid) {
    const currentIdx = PLAN_ORDER.indexOf(plan);
    grid.innerHTML = planDefs().map((p) => {
      const pIdx = PLAN_ORDER.indexOf(p.key);
      const isCurrent = p.key === plan;
      const isLower = pIdx < currentIdx;
      let cta, accent = false;
      if (isCurrent) {
        cta = isTrial ? "Current (trial)" : "Current plan";
      } else if (isLower) {
        cta = "Included";
      } else {
        cta = billingInfo?.hasSubscription ? "Manage in Polar" : billingInfo?.options?.[p.key]?.[billingInterval] ? `Get ${p.name}` : "Checkout coming soon";
        accent = p.key === "pro";
      }
      return renderPlanCard(p, isCurrent, isLower, cta, accent && !isCurrent);
    }).join("");
    if (!grid._wired) {
      grid.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-plan]");
        if (btn) checkout(btn.dataset.plan, btn);
      });
      grid._wired = true;
    }
  }

  document.querySelectorAll('input[name="billingInterval"]').forEach((input) => {
    if (input._wired) return;
    input._wired = true;
    input.checked = input.value === billingInterval;
    input.addEventListener("change", () => { billingInterval = input.value; renderPlan(); });
  });
  const portal = $("billingPortal");
  if (portal) {
    portal.hidden = !billingInfo?.portalAvailable;
    if (!portal._wired) { portal._wired = true; portal.addEventListener("click", () => openBilling("portal", portal)); }
  }
  const refresh = $("refreshPlanUsage");
  if (refresh && !refresh._wired) { refresh._wired = true; refresh.addEventListener("click", loadPlanUsage); }

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
  if ($("planBadge")) $("planBadge").textContent = plan.toUpperCase() + " PLAN";
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
  const refresh = $("refreshPlanUsage");
  if (refresh) refresh.disabled = true;
  try {
    const { body: d } = await fetchDashboardJson("/api/account/usage", { credentials: "include" });
    setState({ USAGE_STATUS: "ready" });
    billingInfo = d.billing;
    setState({ ME: { ...state.ME, plan: d.plan, planExpiresAt: d.planExpiresAt } });
    const pendingReturn = new URLSearchParams(location.search).get("billing") === "return" && !d.billing?.hasSubscription;
    if ($("billingStatus")) $("billingStatus").textContent = pendingReturn ? "Waiting for payment confirmation. Refresh usage in a moment to check your plan." : d.billing?.message || "";
    renderPlan();
    const rows = [];
    rows.push({ label: "Sites", product: "Across your account", used: d.leaderboard.sites.used, limit: d.leaderboard.sites.limit });
    rows.push({ label: "Players", product: d.site?.name || "Active site", used: d.leaderboard.players.used, limit: d.leaderboard.players.limit });
    if (d.credits) {
      rows.push({ label: "Ways to earn", product: "Credits", used: d.credits.rewardMappings.used, limit: d.credits.rewardMappings.limit });
      rows.push({ label: "Shop items", product: "Credits", used: d.credits.shopItems.used, limit: d.credits.shopItems.limit });
      rows.push({ label: "Pending orders", product: "Credits", used: d.credits.pendingRedemptions.used, limit: d.credits.pendingRedemptions.limit });
      rows.push({ label: "Orders / 30 days", product: "Credits", used: d.credits.redemptionsPer30Days.used, limit: d.credits.redemptionsPer30Days.limit });
    }
    wrap.innerHTML = `${activeViewerUsageMarkup(d.activeViewers)}<p class="usage-scope">Site limits below apply to <strong>${esc(d.site?.name || "your active site")}</strong>. Each site has its own allowance.</p><div class="plan-usage-secondary">${rows.map((r) => `<div class="plan-usage-row"><div class="plan-usage-meta"><span class="plan-usage-label">${esc(r.label)}</span><span class="plan-usage-product">${esc(r.product === "Credits" ? d.site?.name || "Active site" : r.product)}</span></div><span class="plan-usage-value">${Number(r.used).toLocaleString()} <small>/ ${Number(r.limit).toLocaleString()}</small></span><meter min="0" max="${Number(r.limit)}" value="${Math.min(Number(r.used), Number(r.limit))}" aria-label="${esc(r.label)} usage" aria-valuetext="${Number(r.used)} of ${Number(r.limit)} used"></meter></div>`).join("")}</div>`;
  } catch (err) {
    setState({ USAGE_STATUS: "error" });
    logError("loadPlanUsage", err);
    if (wrap) wrap.innerHTML = `<p class="hint hint--error">Could not load usage.</p>`;
    if ($("billingStatus")) $("billingStatus").textContent = "Could not load billing. Refresh usage to try again.";
  } finally {
    if (refresh) refresh.disabled = false;
  }
}

export function collect({ reportPlayerErrors = true } = {}) {
  const playerResult = collectPlayers({ reportErrors: reportPlayerErrors });
  const scheduleResult = scheduleInvalid({ reportErrors: reportPlayerErrors });
  // Normalize on the way out as well as on the way in: the payload must ship a
  // strict boolean per block, never `undefined`, whatever shape the draft
  // arrived in.
  collectSections();
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
    startsAt: scheduleResult.startsAt,
    endsAt: scheduleResult.endsAt,
    rankBy: $("f_rank_by")?.value === "wagered" ? "wagered" : "score",
    partner: { blurb: $("f_blurb").value.trim(), chips: state.EXTRA.chips },
    whyStats: state.EXTRA.whyStats,
    rules: collectRules(),
    socials: state.EXTRA.socials,
    sections: normalizeSections(state.EXTRA.sections),
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
      contact: String(state.EXTRA?.legal?.contact || "").trim(),
      contactEnabled: state.EXTRA?.legal?.contactEnabled !== false,
    },
    contact: collectContact(),
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
      font: $("f_font")?.value || state.CURRENT_BRANDING?.font || "Inter",
    };
    // accentA comes from the canonical branding state, never from the raw
    // picker DOM: `applyTheme()` is the only writer, so an in-flight picker
    // value can never be saved as an accent the rest of the page disagrees
    // with, and a later updateThemeSelection() can never revert it.
    // accentB is legacy stored data with no visible effect in the viewer; it
    // round-trips from state untouched so an accent edit never rewrites it.
    // An accent the site does not have is omitted rather than sent as null,
    // which the branding schema rejects.
    if (state.CURRENT_BRANDING?.accentA) out.branding.accentA = state.CURRENT_BRANDING.accentA;
    if (state.CURRENT_BRANDING?.accentB) out.branding.accentB = state.CURRENT_BRANDING.accentB;
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
        payoutNote: ($("f_payoutNote")?.value || "").trim().slice(0, 300),
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
  return { payload: out, invalid: [...brandInvalid(), ...scheduleResult.invalid, ...playerResult.invalid] };
}

/**
 * Branding fields are validated where they are collected, so the save bar, the
 * preview and the invalid-field focus all read the same verdict: an empty name
 * would render a nameless public header, and a malformed link would render a
 * dead public button.
 */
function brandInvalid() {
  const invalid = [];
  const nameInput = $("f_name");
  const missingName = !!nameInput && !nameInput.value.trim();
  if (missingName) invalid.push({ label: "Site name", input: nameInput, message: "Enter a site name." });
  // A field the creator is still filling in is not yet a field they got wrong,
  // so the message waits for a blur or a save attempt to mark it touched.
  setFieldError(nameInput, missingName && isTouched(nameInput) ? "Enter a site name." : "");
  return [...invalid, ...socialInvalid(), ...contactInvalid()];
}

const CONTACT_PLACEHOLDERS = {
  email: "you@example.com",
  discord: "https://discord.gg/yourserver",
  social: "https://x.com/yourhandle",
  url: "https://yoursite.com/contact",
};

function collectContact() {
  const out = {};
  for (const type of CREATOR_CONTACT_TYPES) out[type] = ($(`f_contact_${type}`)?.value || "").trim();
  return out;
}

/** Same verdict as the Worker: one shared validator decides what the public page may render. */
function contactInvalid() {
  if (!$("siteContactFields")) return [];
  const { errors } = validateCreatorContact(collectContact());
  const invalid = [];
  for (const type of CREATOR_CONTACT_TYPES) {
    const input = $(`f_contact_${type}`);
    if (!input) continue;
    const message = errors.find((e) => e.field === type)?.message || "";
    setFieldError(input, message && isTouched(input) ? message : "");
    if (message) invalid.push({ label: CREATOR_CONTACT_FIELD_LABELS[type], input, message });
  }
  return invalid;
}

export function renderContact() {
  const wrap = $("siteContactFields");
  if (!wrap) return;
  const contact = state.EXTRA?.contact || {};
  wrap.innerHTML = CREATOR_CONTACT_TYPES.map((type) => {
    const id = `f_contact_${type}`;
    const isEmail = type === "email";
    return `<div class="field"><label for="${id}">${esc(CREATOR_CONTACT_FIELD_LABELS[type])}</label>
<input id="${id}" class="contact-method" type="${isEmail ? "email" : "url"}" inputmode="${isEmail ? "email" : "url"}" autocomplete="${isEmail ? "email" : "url"}" maxlength="254" placeholder="${esc(CONTACT_PLACEHOLDERS[type])}" aria-describedby="${id}_error" value="${esc(String(contact[type] || ""))}" /><span class="field-err" id="${id}_error" data-field-error="${id}" role="alert" hidden></span></div>`;
  }).join("");
}

function isTouched(input) {
  return input?.dataset.touched === "1";
}

// The countdown block is the only surface that presents the schedule. When a
// creator turns it off in Page design the dates are no longer public, so a
// stale or sentinel value left in the inputs must not block an unrelated save
// or preview.
//
// State is the source of truth: the per-toggle handler writes
// `state.EXTRA.sections.countdown` before this ever runs, and `renderSections()`
// normalizes it. The DOM read survives only as a freshness check for a rendered
// toggle the handler could not have seen (a programmatic check).
function countdownBlockEnabled() {
  const stored = normalizeSections(state.EXTRA?.sections).countdown;
  const row = $("sectionsList")?.querySelector('[data-section="countdown"] .section-toggle');
  return row ? row.checked : stored;
}

function scheduleInvalid({ reportErrors = true } = {}) {
  const startsInput = $("f_starts");
  const endsInput = $("f_ends");
  // With the countdown off, the schedule is inert: report no schedule errors so
  // layout-only interactions (which run the whole collect()) never surface a
  // date toast. Values still round-trip through `startsAt`/`endsAt` below.
  const result = validateScheduleValues({
    startsValue: startsInput?.value || "",
    endsValue: endsInput?.value || "",
    enforcePlausibleRange: countdownBlockEnabled(),
  });
  const byField = { starts: startsInput, ends: endsInput };
  const invalid = result.invalid.map((entry) => ({ ...entry, input: byField[entry.field] })).filter((entry) => entry.input);
  if (reportErrors) {
    for (const [field, input] of Object.entries(byField)) {
      if (!input) continue;
      const message = invalid.find((entry) => entry.field === field)?.message || "";
      setFieldError(input, message && isTouched(input) ? message : "");
    }
  }
  return { ...result, invalid };
}

document.addEventListener("blur", (event) => {
  const input = event.target;
  if (!input || typeof input.matches !== "function" || !input.matches("#f_name, .social-url, .contact-method, #f_starts, #f_ends")) return;
  input.dataset.touched = "1";
  if (input.matches("#f_starts, #f_ends")) scheduleInvalid();
  else brandInvalid();
}, true);

document.addEventListener("change", (event) => {
  const input = event.target;
  if (!input || typeof input.matches !== "function" || !input.matches("#f_starts, #f_ends")) return;
  input.dataset.touched = "1";
  scheduleInvalid();
});

/** Show or clear the error message a field's `aria-describedby` already points at. */
function setFieldError(input, message) {
  if (!input) return;
  const el = document.querySelector(`[data-field-error="${input.id}"]`);
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
  input.setAttribute("aria-invalid", message ? "true" : "false");
}

function isPublicUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function socialInvalid() {
  const list = $("socialsList");
  if (!list) return [];
  const invalid = [];
  for (const row of list.querySelectorAll("[data-social]")) {
    const input = row.querySelector(".social-url");
    if (!input) continue;
    const url = input.value.trim();
    const bad = !!url && !isPublicUrl(url);
    setFieldError(input, bad && isTouched(input) ? "Enter a valid URL, starting with https://" : "");
    if (bad) invalid.push({ label: `${row.dataset.social} link`, input, message: "Enter a valid URL, starting with https://" });
  }
  return invalid;
}

/* --- branding --- */
// One accent, one swatch: the public viewer renders a single accent color, so
// a preset that showed two would promise a gradient the viewer never paints.
const COLOR_PRESETS = [
  { name: "Indigo", accent: "#5b5bf5" },
  { name: "Cyan", accent: "#06b6d4" },
  { name: "Sunset", accent: "#ff7a59" },
  { name: "Emerald", accent: "#3cf2b1" },
  { name: "Gold", accent: "#ffd15c" },
];

function renderColorPresets() {
  const list = $("colorPresets");
  if (!list) return;
  list.innerHTML = "";
  COLOR_PRESETS.forEach((preset) => {
    const active = preset.accent.toLowerCase() === String(state.CURRENT_BRANDING.accentA || "").toLowerCase();
    const button = document.createElement("button");
    button.className = "preset-btn" + (active ? " is-selected" : "");
    button.type = "button";
    button.setAttribute("aria-pressed", String(active));
    button.innerHTML = `<span class="preset-swatch"><i data-color="${esc(preset.accent)}"></i></span><span>${esc(preset.name)}</span>`;
    button.querySelectorAll("[data-color]").forEach((swatch) => { swatch.style.background = swatch.dataset.color; });
    button.addEventListener("click", () => applyTheme(preset.accent, preset.name));
    list.appendChild(button);
  });
}

const PREVIEW_TIMEOUT_MS = 8000;
const PREVIEW_DEBOUNCE_MS = 300;
// Below this scale body copy on the public page stops being legible; a frame
// narrower than `deviceWidth * PREVIEW_MIN_SCALE` scrolls instead of shrinking.
const PREVIEW_MIN_SCALE = 0.62;
const PREVIEW_MIN_FRAME_HEIGHT = 420;
const PREVIEW_DEVICE_WIDTHS = { desktop: 1100, tablet: 820, mobile: 390 };
export const PREVIEW_DEVICES = Object.keys(PREVIEW_DEVICE_WIDTHS);

// Every preview surface — the leaderboard editor and Site settings — renders
// the real public site through /dashboard/preview, which POSTs the current
// draft to the shared renderer. A surface declares its frame, device tabs and
// status elements with data attributes; nothing about the public markup is
// reproduced in the dashboard, and a second surface adds no preview logic.
function previewMounts() {
  return [...document.querySelectorAll("[data-preview-mount]")];
}

function previewParts(mount) {
  return {
    iframe: mount.querySelector("iframe"),
    stage: mount.querySelector("[data-preview-stage]"),
    frame: mount.querySelector("[data-preview-frame]"),
    error: mount.querySelector("[data-preview-error]"),
    status: mount.querySelector("[data-preview-status]"),
    time: mount.querySelector("[data-preview-time]"),
    device: mount.querySelector(".preview-tab.is-active"),
  };
}

/** Don't waste CPU/network rendering a preview whose section isn't on screen. */
function previewVisible(mount) {
  if (mount.dataset.previewPaused) return false;
  const section = mount.closest("section[data-page]");
  return (!section || section.classList.contains("is-on")) &&
    !mount.closest("[hidden]") && mount.getClientRects().length > 0;
}

const PREVIEW_DEVICE_LABELS = { desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };

function previewTabsMarkup(active) {
  return PREVIEW_DEVICES.map((device) => {
    const on = device === active;
    return `<button class="preview-tab${on ? " is-active" : ""}" data-width="${PREVIEW_DEVICE_WIDTHS[device]}" data-device="${device}" type="button" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}">${PREVIEW_DEVICE_LABELS[device]}</button>`;
  }).join("");
}

/**
 * "Open large preview": the same draft, the same /dashboard/preview render and
 * the same device, in a dialog that gets the viewport instead of a rail. It is
 * a second preview surface, not a second preview — the dialog only declares a
 * mount and the shared pipeline renders it. The rail mount is paused while the
 * dialog is open so one draft change costs one render, and on close the rail
 * takes over the device chosen in the dialog and re-renders if it fell behind.
 */
export function openLargePreview(source) {
  if ($("previewLargeModal")) return null;
  const device = previewDevice(source);
  const overlay = document.createElement("div");
  overlay.className = "modal preview-modal";
  overlay.id = "previewLargeModal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "previewLargeTitle");
  overlay.innerHTML = `<div class="modal-card preview-modal-card preview-mount" role="document" data-preview-mount="board-large" data-preview-target="designPreviewLarge" data-preview-label-syncing="Updating" data-preview-label-synced="Up to date" data-preview-column data-preview-reserve="16">
    <div class="preview-header">
      <div class="preview-header-text"><h3 id="previewLargeTitle">Draft preview</h3><p class="preview-sub">Your unsaved changes, rendered exactly as visitors would see them after you publish.</p></div>
      <div class="preview-actions">
        <div class="preview-tabs" role="tablist" aria-label="Preview device">${previewTabsMarkup(device)}</div>
        <span class="v3-chip v3-chip--pro preview-sync" data-preview-status role="status" aria-live="polite">Preparing preview…</span>
        <button class="btn btn--sm btn--ghost" type="button" data-preview-close aria-label="Close large preview">Close</button>
      </div>
    </div>
    <div class="preview-sync-strip"><span><i aria-hidden="true"></i> Draft preview</span><span class="preview-publication" data-preview-publication></span><small data-preview-time>Last updated —</small></div>
    <div class="preview-frame" data-preview-frame><div class="preview-stage" data-preview-stage><iframe name="designPreviewLarge" loading="eager" title="Large draft preview" sandbox="allow-scripts allow-same-origin allow-popups-to-escape-sandbox"></iframe></div><div class="preview-error" data-preview-error role="status" aria-live="polite" hidden><p><span data-preview-error-message>Preview could not load. Retry to try again.</span> <button class="btn btn--sm" type="button" data-preview-retry>Retry</button></p></div></div>
  </div>`;
  document.body.appendChild(overlay);
  document.documentElement.classList.add("yr-modal-open");
  source.dataset.previewPaused = "1";
  const mount = overlay.querySelector("[data-preview-mount]");
  renderPreviewPublicationState(mount);
  const release = window.YRDialog ? window.YRDialog.trap(overlay, close) : null;
  function close() {
    if (!overlay.isConnected) return;
    const chosen = previewDevice(mount);
    clearTimeout(mount._yrPreview?.timeout);
    clearTimeout(mount._yrPreview?.watchdog);
    mount._yrPreview?.form?.remove();
    release?.();
    overlay.remove();
    document.documentElement.classList.remove("yr-modal-open");
    delete source.dataset.previewPaused;
    const sourceTab = [...source.querySelectorAll(".preview-tab")].find((tab) => tab.dataset.device === chosen);
    if (sourceTab && !sourceTab.classList.contains("is-active")) sourceTab.click();
    else fitDesignPreview();
    source.querySelector("[data-preview-expand]")?.focus();
  }
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-preview-close]")) close();
  });
  const wired = typeof window.matchMedia === "function"
    ? import("./preview-tabs.js").then(({ setupPreviewTabs }) => setupPreviewTabs()).catch(() => {})
    : Promise.resolve();
  // The tab controller re-renders on wiring; the immediate render after it
  // cancels that debounce so the dialog opens on the current draft at once.
  wired.then(() => { if (overlay.isConnected) renderPreviewMount(mount, { immediate: true }); });
  return { overlay, mount, close, ready: wired };
}

function previewLocalState(mount) {
  if (!mount._yrPreview) mount._yrPreview = { timeout: null, watchdog: null, form: null, syncedAt: null, revision: 0, draftRevision: -1 };
  return mount._yrPreview;
}

/** The device the mount's active tab selects; every surface defaults to desktop. */
export function previewDevice(mount) {
  const device = previewParts(mount).device?.dataset.device;
  return PREVIEW_DEVICES.includes(device) ? device : "desktop";
}

function previewDeviceWidth(mount) {
  const { device } = previewParts(mount);
  const declared = parseInt(device?.dataset.width || "", 10);
  return declared > 0 ? declared : PREVIEW_DEVICE_WIDTHS[previewDevice(mount)];
}

/**
 * The strip under the preview header answers two different questions, and
 * conflating them is how a loaded frame gets mistaken for a published site:
 * the chip says whether the frame shows the current draft, this label says
 * whether visitors see that draft yet. It speaks the save bar's language.
 */
function renderPreviewPublicationState(mount) {
  const label = mount.querySelector("[data-preview-publication]");
  if (!label) return;
  const copy = publicationCopy();
  label.textContent = copy.footerLabel;
  label.dataset.state = copy.draftChanges ? "dirty" : boardStatus().live ? "published" : "offline";
}

function setPreviewSyncStatus(mount, phase, detail = "") {
  const { status, time } = previewParts(mount);
  const local = previewLocalState(mount);
  if (status) {
    status.textContent = phase === "syncing"
      ? mount.dataset.previewLabelSyncing || "Updating preview…"
      : phase === "synced" ? mount.dataset.previewLabelSynced || "Preview ready"
        : phase === "invalid" ? `Fix the highlighted fields${detail ? ` — ${detail}` : ""} before saving`
          : "Preview could not be loaded";
    status.classList.toggle("is-syncing", phase === "syncing");
    status.classList.toggle("is-invalid", phase === "invalid");
  }
  if (time) {
    const seconds = local.syncedAt ? Math.max(0, Math.floor((Date.now() - local.syncedAt) / 1000)) : null;
    time.textContent = seconds === null ? "Last synced —" : seconds === 0 ? "Last synced just now" : `Last synced ${seconds}s ago`;
  }
}

/**
 * The reason strings a failed preview can show. The frame loads through a form
 * submission, so the client cannot read the response status directly — every
 * cause is diagnosed from the loaded document instead. Each reason names what
 * the creator can actually do about it.
 */
const PREVIEW_FAILURE_COPY = {
  session: "Your session expired. Refresh the page to sign back in, then retry the preview.",
  board: "This board could not be previewed. Check that it still exists, then retry.",
  server: "The preview renderer hit an error. Retry, and contact support if it keeps happening.",
  timeout: "The preview took too long to load. Retry, or check your connection.",
  unknown: "Preview could not load. Retry to try again.",
};

/**
 * The single failure path: name the cause, log it with enough detail to debug,
 * and paint the fallback. The watchdog, the `load` diagnosis and the submit
 * catch all route through here so no failure is silent and none reports a
 * different story from the others.
 */
function failPreview(mount, reason, detail = {}) {
  const local = previewLocalState(mount);
  clearTimeout(local.watchdog);
  const { error } = previewParts(mount);
  const copy = PREVIEW_FAILURE_COPY[reason] || PREVIEW_FAILURE_COPY.unknown;
  if (error) {
    error.hidden = false;
    const message = error.querySelector("[data-preview-error-message]");
    if (message) message.textContent = copy;
  }
  setPreviewSyncStatus(mount, "error");
  logError(`preview-${reason}`, new Error(copy), {
    mount: mount.dataset.previewMount || "",
    section: mount.dataset.previewSection || "",
    revision: local.revision,
    ...detail,
  });
}

/**
 * Decide what a loaded preview document actually is. A frame that carries the
 * ready meta rendered the draft; anything else is a failure, and the document
 * usually says which one. Reading `contentDocument` is safe because the preview
 * iframes are same-origin (`allow-same-origin`), but a cross-origin navigation
 * — a login redirect, or a custom-domain bounce — throws, which is itself the
 * session answer.
 *
 * Exported so the reason mapping can be pinned by tests without a live iframe.
 */
export function diagnosePreviewDocument(frame) {
  let doc = null;
  try {
    doc = frame.contentDocument;
  } catch {
    return { ok: false, reason: "session", detail: { diagnosis: "cross-origin-redirect" } };
  }
  if (!doc) return { ok: false, reason: "session", detail: { diagnosis: "unreadable-document" } };
  if (doc.querySelector('meta[name="yr-preview-ready"]')) return { ok: true };

  const text = (doc.body?.textContent || "").trim();
  const title = (doc.title || "").trim();
  // The endpoint answers these two as plain text, so the body IS the reason.
  if (/^board required$/i.test(text)) {
    return { ok: false, reason: "board", detail: { diagnosis: "board-required", status: 400 } };
  }
  if (/^not found$/i.test(text)) {
    return { ok: false, reason: "board", detail: { diagnosis: "site-not-found", status: 404 } };
  }
  // A login page means the session lapsed between boot and the render.
  const looksLikeLogin = /sign in|log in|login/i.test(title) || doc.querySelector('form[action*="/login"], input[name="password"]');
  if (looksLikeLogin) {
    return { ok: false, reason: "session", detail: { diagnosis: "login-document", title } };
  }
  return { ok: false, reason: "server", detail: { diagnosis: "missing-ready-meta", title, bodyPrefix: text.slice(0, 160) } };
}

/**
 * Replace a preview frame with a fresh one. A form submission into an
 * existing frame appends an entry to the joint session history, which both
 * pollutes Back and truncates the forward stack, so every render targets a
 * newly created frame whose first navigation replaces instead of pushing.
 */
function resetPreviewFrame(mount) {
  const current = previewParts(mount).iframe;
  if (!current) return null;
  const revision = previewLocalState(mount).revision;
  const fresh = document.createElement("iframe");
  for (const attr of current.attributes) {
    if (attr.name !== "src") fresh.setAttribute(attr.name, attr.value);
  }
  fresh.addEventListener("load", () => {
    const local = previewLocalState(mount);
    // A brand-new frame fires `load` for its initial empty document before the
    // draft submission lands. Treating that as synced would clear the watchdog
    // and claim the stale preview matches the draft, so only the render's own
    // navigation counts.
    if (previewParts(mount).iframe !== fresh || local.revision !== revision) return;
    let loaded = "";
    try {
      loaded = fresh.contentWindow?.location?.href || "";
    } catch { /* A cross-origin document resolves below, not here. */ }
    // Still the initial about:blank — the real navigation has not landed yet.
    if (!loaded || loaded === "about:blank") {
      if (!loaded) return;
      try {
        if (!fresh.contentDocument?.querySelector('meta[name="yr-preview-ready"]')) return;
      } catch { return; }
    }
    // Diagnose on arrival rather than waiting out the watchdog: a 400/404/500
    // document is a finished answer, and the creator should hear it at once.
    const verdict = diagnosePreviewDocument(fresh);
    if (!verdict.ok) {
      failPreview(mount, verdict.reason, verdict.detail);
      return;
    }
    clearTimeout(local.watchdog);
    const { error } = previewParts(mount);
    if (error) error.hidden = true;
    local.syncedAt = Date.now();
    // The draft may render while fields still fail validation — the frame
    // shows what was sent, the chip keeps reporting what blocks saving.
    const lastInvalid = local.lastInvalid || [];
    setPreviewSyncStatus(mount, lastInvalid.length ? "invalid" : "synced", lastInvalid[0]?.label || "");
    fitPreviewMount(mount);
  });
  current.replaceWith(fresh);
  return fresh;
}

function wirePreviewMount(mount) {
  if (mount._previewWired) return;
  mount._previewWired = true;
  mount.addEventListener("click", (event) => {
    if (!event.target.closest("[data-preview-retry]")) {
      if (event.target.closest("[data-preview-expand]")) openLargePreview(mount);
      return;
    }
    const { error } = previewParts(mount);
    if (error) error.hidden = true;
    // Clear the previous reason so a failed retry cannot leave a stale message
    // behind, and a fresh failure can paint its own.
    const message = error?.querySelector("[data-preview-error-message]");
    if (message) message.textContent = "Retrying the preview…";
    renderPreviewMount(mount, { immediate: true });
  });
}

function renderPreviewMount(mount, { immediate = false } = {}) {
  wirePreviewMount(mount);
  const local = previewLocalState(mount);
  local.revision++;
  clearTimeout(local.timeout);
  clearTimeout(local.watchdog);
  const { iframe } = previewParts(mount);
  if (!iframe) return;
  renderPreviewPublicationState(mount);
  // A section that is scrolled away or hidden does no work and says nothing —
  // it is not a failure, so it must not paint an error. `draftRevision` stays
  // behind, so the mount is known-stale and renders when it is next shown.
  if (!previewVisible(mount)) return;
  // No active site is a real, explainable state: the preview has no board to
  // render. Say so instead of leaving the chip on "Updating preview…" forever.
  if (!state.ACTIVE_SITE_ID) {
    failPreview(mount, "board", { diagnosis: "no-active-site" });
    return;
  }
  setPreviewSyncStatus(mount, "syncing");
  // Debounce so typing doesn't repeatedly re-render the same draft.
  local.timeout = setTimeout(() => {
    local.timeout = null;
    if (!previewVisible(mount)) return;
    const { error } = previewParts(mount);
    try {
      const { payload: draft, invalid } = collect({ reportPlayerErrors: false });
      // Render even when fields fail validation: a blank frame tells the
      // creator nothing, while the draft render plus the invalid chip shows
      // both what they have and what still needs fixing before saving.
      local.lastInvalid = invalid;
      local.draftRevision = state.DRAFT_REVISION;
      local.device = previewDevice(mount);
      const params = { board: state.ACTIVE_SITE_ID, device: local.device };
      if (mount.dataset.previewSection) params.section = mount.dataset.previewSection;
      // Site settings previews what viewers see, so the editor's
      // click-to-edit overlay stays with the editor that owns those fields.
      if (mount.dataset.previewEdit === "0") params.edit = "0";
      // Without a named frame the POST would open a new window, so a mount
      // that names no target renders nothing rather than something wrong.
      const target = mount.dataset.previewTarget || iframe.name;
      if (!target) return;
      if (!local.form) {
        local.form = document.createElement("form");
        local.form.method = "post";
        local.form.target = target;
        local.form.hidden = true;
        const draftInput = document.createElement("input");
        draftInput.type = "hidden";
        draftInput.name = "draft";
        local.form.appendChild(draftInput);
        document.body.appendChild(local.form);
      }
      local.form.action = "/dashboard/preview?" + new URLSearchParams(params).toString();
      local.form.querySelector("input[name='draft']").value = JSON.stringify(draft);
      setPreviewSyncStatus(mount, "syncing");
      if (invalid.length) setPreviewSyncStatus(mount, "invalid", invalid[0]?.label || "");
      if (!resetPreviewFrame(mount)) return;
      local.form.submit();
      if (error) error.hidden = true;
      clearTimeout(local.watchdog);
      // The `load` handler diagnoses a finished error document; this watchdog is
      // only for a frame that never settles at all (a hung request).
      local.watchdog = setTimeout(() => failPreview(mount, "timeout", { afterMs: PREVIEW_TIMEOUT_MS }), PREVIEW_TIMEOUT_MS);
    } catch (e) {
      failPreview(mount, "server", { diagnosis: "collect-or-submit-threw", message: e?.message || String(e) });
    }
  }, immediate ? 0 : PREVIEW_DEBOUNCE_MS);
}

/**
 * Pure sizing rule for a preview frame, exported so it can be pinned without a
 * layout engine. The page renders at `deviceWidth` and is transform-scaled to
 * the frame, but never below PREVIEW_MIN_SCALE: a rail too narrow for the
 * desktop page scrolls sideways instead of turning the copy into a miniature,
 * and a page taller than the frame scrolls inside it instead of being cut off.
 */
export function previewFit({ deviceWidth, frameWidth, contentHeight, maxHeight }) {
  const scale = Math.min(1, Math.max(PREVIEW_MIN_SCALE, frameWidth / deviceWidth));
  const scaledWidth = Math.ceil(deviceWidth * scale);
  const scaledHeight = Math.ceil(contentHeight * scale);
  return {
    scale,
    scaledWidth,
    scaledHeight,
    frameHeight: Math.min(scaledHeight, Math.max(PREVIEW_MIN_FRAME_HEIGHT, maxHeight)),
    overflowsWidth: scaledWidth > frameWidth,
  };
}

/** Frame height the mount's column can give the page before the column itself scrolls. */
function previewMaxHeight(mount, frame) {
  const column = mount.closest("[data-preview-column]");
  if (column && typeof column.getBoundingClientRect === "function" && typeof frame.getBoundingClientRect === "function") {
    const top = frame.getBoundingClientRect().top - column.getBoundingClientRect().top + (column.scrollTop || 0);
    const reserve = parseInt(column.dataset.previewReserve || "0", 10) || 0;
    const available = column.clientHeight - top - reserve;
    if (available > 0) return Math.floor(available);
  }
  return Math.floor(window.innerHeight * 0.75);
}

function fitPreviewMount(mount) {
  const { iframe, stage, frame } = previewParts(mount);
  if (!iframe || !stage || !frame) return;
  const deviceWidth = previewDeviceWidth(mount);
  const cw = frame.clientWidth;
  if (!cw) return;
  const doc = iframe.contentDocument;
  let contentHeight = 680;
  if (doc && doc.readyState === "complete" && doc.documentElement) {
    const html = doc.documentElement;
    const body = doc.body;
    contentHeight = Math.max(680, html.scrollHeight, body ? body.scrollHeight : 0, html.offsetHeight, body ? body.offsetHeight : 0);
  }
  const fit = previewFit({ deviceWidth, frameWidth: cw, contentHeight, maxHeight: previewMaxHeight(mount, frame) });
  stage.style.width = fit.scaledWidth + "px";
  stage.style.height = fit.scaledHeight + "px";
  stage.style.setProperty("--preview-scale", String(fit.scale));
  stage.style.setProperty("--preview-device-width", deviceWidth + "px");
  stage.style.setProperty("--preview-content-height", contentHeight + "px");
  frame.classList.toggle("is-overflowing", fit.overflowsWidth);
  frame.style.height = fit.frameHeight + "px";
}

export function updateDesignPreview() {
  for (const mount of previewMounts()) renderPreviewMount(mount);
}

/**
 * A mount that skipped a draft change while hidden (its section was off, or
 * the large preview was closed) still shows the older draft. Re-render it as
 * soon as it is on screen again; a mount that already rendered this revision on
 * this device is left alone so showing it costs nothing.
 */
function renderStalePreviewMount(mount, options) {
  const local = previewLocalState(mount);
  if (!previewVisible(mount)) return false;
  if (local.draftRevision === state.DRAFT_REVISION && local.device === previewDevice(mount) && !local.timeout) return false;
  renderPreviewMount(mount, options);
  return true;
}

export function fitDesignPreview() {
  for (const mount of previewMounts()) {
    if (!previewVisible(mount)) continue;
    if (renderStalePreviewMount(mount)) continue;
    fitPreviewMount(mount);
  }
}

/** Re-render the visible previews and re-fit them: what every "show me the draft" path wants. */
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
    publishAction.disabled = !s.published && !s.emailVerified;
    if (publishAction.disabled) publishAction.title = "Confirm your email before publishing";
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
  const template = resolveViewerTemplate(state.CURRENT_BRANDING?.template);
  if ($("f_viewerTemplate")) $("f_viewerTemplate").value = template.value;
  if ($("siteTemplateHint")) $("siteTemplateHint").textContent = template.description;
  if (state.CURRENT_BRANDING.accentA && $("c_a")) $("c_a").value = state.CURRENT_BRANDING.accentA;
  const font = $("f_font"); if (font) font.value = state.CURRENT_BRANDING.font || "Inter";
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
    // A disabled button is not an explanation; the strip says why it is quiet.
    setSaveStatusText(state._dirty ? "You have unsaved changes." : cleanSaveStatusText());
    syncSettingsSaveBar();
  }
  if (keys.includes("_dirty") || keys.includes("PUBLISHED")) {
    for (const mount of previewMounts()) renderPreviewPublicationState(mount);
  }
  if (keys.includes("draft")) updateDesignPreview();
});

// A theme choice sets the one accent the viewer paints. `accentB` is legacy
// stored data and is deliberately not touched here, so picking a preset or a
// custom color never overwrites what a legacy row carries.
export function applyTheme(accentA, label, font = null) {
  const selectedFont = font || $("f_font")?.value || state.CURRENT_BRANDING?.font || "Inter";
  state.CURRENT_BRANDING = { ...state.CURRENT_BRANDING, font: selectedFont };
  const isPaid = state.ME.plan !== "free";
  if (isPaid && accentA) {
    state.CURRENT_BRANDING.accentA = accentA;
    if ($("c_a")) $("c_a").value = accentA;
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

export function applyViewerTemplate(value) {
  if (!state.ME || state.ME.plan === "free") return;
  const template = resolveViewerTemplate(value);
  if (template.value === resolveViewerTemplate(state.CURRENT_BRANDING?.template).value) return;
  state.CURRENT_BRANDING = { ...state.CURRENT_BRANDING, template: template.value };
  markDirty();
  updateThemeSelection();
}

export function wireViewerTemplatePicker() {
  $("f_viewerTemplate")?.addEventListener("input", event => event.stopPropagation());
  $("f_viewerTemplate")?.addEventListener("change", event => {
    event.stopPropagation();
    applyViewerTemplate($("f_viewerTemplate").value);
  });
}
wireViewerTemplatePicker();

// Untouched legacy values still round-trip; changing the picker deliberately
// selects one of the supported viewer presentations on the existing theme.
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
  const note = $("f_payoutNote");
  if (note) note.value = p.payoutNote || "";
}

/** Rules are the creator's own lines; legacy rows may still hold structured
 *  items, which are left untouched in state and never shown in the textarea. */
function ruleLines(rules) {
  return (Array.isArray(rules) ? rules : []).filter((rule) => typeof rule === "string" && rule.trim());
}

function collectRules() {
  const field = $("f_rules");
  if (!field) return state.EXTRA.rules;
  return field.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 40).map((line) => line.slice(0, 500));
}

export function renderRules() {
  const field = $("f_rules");
  const toggle = $("f_rules_enabled");
  if (!field || !toggle) return;
  field.value = ruleLines(state.EXTRA.rules).join("\n");
  toggle.checked = normalizeSections(state.EXTRA.sections).rules;
  if (field.dataset.wired) return;
  field.dataset.wired = "1";
  field.addEventListener("input", () => {
    state.EXTRA.rules = collectRules();
    markDirty();
  });
  toggle.addEventListener("change", () => {
    setSectionValue("rules", toggle.checked === true);
    const row = $("sectionsList")?.querySelector('[data-section-toggle="rules"]');
    if (row) row.checked = toggle.checked;
  });
}

// The logo lives next to the field that changed it, so its outcome is reported
// there instead of only in the editor's save strip further down the page.
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

function setLogoStatus(message) {
  const local = $("logoStatus");
  if (local) local.textContent = message;
  const status = $("status");
  if (status) { status.textContent = message; status.hidden = false; }
}

// Same event-ownership rule as the accent picker: the file input's own
// input/change must not reach the dashboard's global dirty owner, because a
// rejected file (wrong type, over 2 MB, undecodable) would otherwise show
// "unsaved changes" for a logo that was never accepted. Only assigning a
// converted logo to `state.LOGO` marks dirty. Stopping propagation never
// *clears* dirty, so a legitimate edit made earlier keeps its unsaved state.
export function wireLogoControls() {
  $("logoPick")?.setAttribute("aria-label", "Upload logo");
  $("logoPick")?.addEventListener("click", () => $("logoFile")?.click());
  $("logoClear")?.setAttribute("aria-label", "Remove logo");
  $("logoClear")?.addEventListener("click", () => {
    state.LOGO = null;
    $("logoPreview").hidden = true;
    $("logoClear").hidden = true;
    setLogoStatus("Logo will be removed when you save.");
    markDirty();
  });
  $("logoFile")?.addEventListener("input", (event) => event.stopPropagation());
  $("logoFile")?.addEventListener("change", (event) => {
    event.stopPropagation();
    handleLogoSelection($("logoFile").files[0]);
  });
}
wireLogoControls();

// Exported so the rejection paths can be proven directly: every early return
// below leaves the draft exactly as dirty as it already was.
export function handleLogoSelection(f) {
  if (!f) return;
  // Reject before decoding: a rejected file should never look half-accepted.
  if (f.type && !LOGO_TYPES.includes(f.type)) {
    setLogoStatus("That file type isn't supported. Use a PNG, JPG or WebP image.");
    if ($("logoFile")) $("logoFile").value = "";
    return;
  }
  if (f.size > LOGO_MAX_BYTES) {
    setLogoStatus(`That image is ${(f.size / (1024 * 1024)).toFixed(1)} MB. Use one under 2 MB.`);
    if ($("logoFile")) $("logoFile").value = "";
    return;
  }
  // The dashboard's CSP allows `data:` images but not `blob:`, so the picked
  // file is decoded from a data URL rather than an object URL.
  const reader = new FileReader();
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
    if (entries.length === 0) { setLogoStatus("Couldn't convert that image."); return; }
    const totalChars = entries.reduce((a, b) => a + b.length, 0);
    if (totalChars > 300000) { setLogoStatus("That image is too big even after resizing. Try a simpler one."); return; }
    state.LOGO = srcset;
    $("logoPreview").src = entries[entries.length - 1];
    $("logoPreview").hidden = false; $("logoClear").hidden = false;
    setLogoStatus("Logo ready — hit Save to publish it.");
    markDirty();
  };
  img.onerror = () => { setLogoStatus("Couldn't read that image."); };
  reader.onload = () => { img.src = String(reader.result); };
  reader.onerror = () => { setLogoStatus("Couldn't read that image."); };
  reader.readAsDataURL(f);
  if ($("logoFile")) $("logoFile").value = "";
}
// The custom accent picker owns its own dirty/update path. The dashboard marks
// every bubbled input/change dirty, which would flag unsaved work for a colour
// the canonical branding state had not accepted yet; stopping propagation here
// makes `applyTheme()` the single writer. `input` fires continuously while the
// native picker is open, so it is swallowed and the committed `change` is the
// one that applies. There is no separate Apply step: one picker, one state.
export function wireAccentPicker() {
  $("c_a")?.addEventListener("input", (event) => event.stopPropagation());
  $("c_a")?.addEventListener("change", (event) => {
    event.stopPropagation();
    applyTheme($("c_a")?.value, "Custom color");
  });
  $("colorsReset")?.addEventListener("click", () => applyTheme(COLOR_PRESETS[0].accent, COLOR_PRESETS[0].name));
}
wireAccentPicker();
$("f_font")?.addEventListener("change", () => applyTheme(null, "Font"));

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
  socialInvalid();
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
<input id="social_${esc(c.brand)}" class="social-url" type="url" inputmode="url" aria-label="${esc(c.name)} link" aria-describedby="social_${esc(c.brand)}_error" placeholder="${esc(c.placeholder)}" value="${esc(url)}" /><span class="field-err" id="social_${esc(c.brand)}_error" data-field-error="social_${esc(c.brand)}" role="alert" hidden></span></div>
<label class="yr-toggle" title="Show on public page"><input type="checkbox" class="social-toggle" aria-label="Show ${esc(c.name)} on public page" ${enabled ? "checked" : ""} /><span class="yr-slider"></span></label>
</div>`;
    }).join("");
    // renderSocials runs again on every editor entry and after a save; the
    // listeners live on the container that survives, so binding them per render
    // stacked one collectSocials call per past render.
    if (!list.dataset.socialsWired) {
      list.addEventListener("input", collectSocials);
      list.addEventListener("change", collectSocials);
      list.dataset.socialsWired = "1";
    }
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

// The Loyalty board flag lives in the same visibility map but is edited from
// the Setup → Leaderboards card, not the Layout & blocks list.
const LOYALTY_SECTION_KEY = "loyaltyLeaderboard";
const SECTION_KEYS = [...SECTIONS_CATALOG.map((s) => s.key), LOYALTY_SECTION_KEY];

/**
 * The one read path for block visibility, kept in lockstep with the server's
 * `normalizeSections` in `src/site.js` (pinned by sections-toggles.test.js).
 * Every key is coerced to a strict boolean against its default with `!== false`:
 * only an explicit `false` turns a block off, so a legacy row, a `null` from a
 * partial save, or an absent key can never reach the payload as `undefined`.
 *
 * The non-catalog keys a stored row may still carry (`hero`, `top3`, `search`,
 * `partner`, `pastWinners`, `cta`) are deliberately preserved so a save from
 * this editor never drops a flag it does not render. `DEFAULT_SECTIONS` already
 * carries every catalog key, so merging it in is what guarantees the catalog is
 * always covered.
 */
export function normalizeSections(raw) {
  const merged = { ...DEFAULT_SECTIONS, ...(raw && typeof raw === "object" ? raw : {}) };
  const out = {};
  for (const key of Object.keys(merged)) out[key] = merged[key] !== false;
  return out;
}

/**
 * The one write path for block visibility. Called by the toggle handler with
 * the key that changed, so the value lands in state before any re-render reads
 * it back. `markDirty()` is what enables "Publish changes" — without it the
 * toggle would update the draft while the save action stayed disabled.
 */
function setSectionValue(key, checked) {
  if (!SECTION_KEYS.includes(key)) return;
  state.EXTRA.sections = { ...normalizeSections(state.EXTRA.sections), [key]: checked === true };
  markDirty();
}

/**
 * Keep the draft in step with the DOM for any path that did not go through a
 * toggle handler (a programmatic check, an autofill). This is a fallback, not
 * the primary write path: it only ever widens a value to `false` when a rendered
 * toggle is genuinely unchecked, and it never runs when the list is absent.
 */
function collectSections() {
  const list = $("sectionsList");
  if (!list) return;
  const sections = normalizeSections(state.EXTRA.sections);
  let changed = false;
  for (const row of list.querySelectorAll("[data-section]")) {
    const key = row.dataset.section;
    if (!SECTION_KEYS.includes(key)) continue;
    const checked = row.querySelector(".section-toggle")?.checked ?? true;
    if (sections[key] !== checked) {
      sections[key] = checked;
      changed = true;
    }
  }
  state.EXTRA.sections = sections;
  if (changed) markDirty();
}

// A toggle is bound per input, not delegated on the list: one click runs one
// handler, writes state first, then marks the draft dirty. Binding to the list
// ran the collector twice per click (`input` + `change`) with no dirty mark.
// The key is read from the toggle's own data attribute, not the enclosing row.
function bindSectionToggle(input) {
  input.addEventListener("change", () => {
    setSectionValue(input.dataset.sectionToggle, input.checked === true);
    const rulesToggle = $("f_rules_enabled");
    if (rulesToggle && input.dataset.sectionToggle === "rules") rulesToggle.checked = input.checked;
  });
}

/**
 * Setup → Leaderboards: Main is the board itself and is always listed; the
 * Loyalty board (viewers ranked by lifetime credits earned) is a plain on/off
 * flag stored beside the other block flags. "Show Leaderboard" in Layout &
 * blocks stays the master switch, so this toggle can only add a second view.
 */
export function renderLeaderboardTypes() {
  const input = $("f_loyalty_board");
  if (!input) return;
  const current = normalizeSections(state.EXTRA.sections);
  input.checked = current[LOYALTY_SECTION_KEY] === true;
  const stateEl = $("f_loyalty_board_state");
  if (stateEl) stateEl.textContent = input.checked ? "On" : "Off";
  if (input.dataset.bound) return;
  input.dataset.bound = "1";
  input.addEventListener("change", () => {
    setSectionValue(LOYALTY_SECTION_KEY, input.checked === true);
    if (stateEl) stateEl.textContent = input.checked ? "On" : "Off";
  });
}

export function renderSections() {
  const list = $("sectionsList");
  const body = $("sectionsBody");
  const lock = $("sectionsLock");
  // Normalize before the plan gate so a free plan still holds a fully-shaped
  // sections object — the tabs that do not render the list must not be the
  // reason a later upgrade ships a half-filled payload.
  state.EXTRA.sections = normalizeSections(state.EXTRA.sections);
  renderLeaderboardTypes();
  if (body) body.hidden = !isPro();
  if (lock) lock.hidden = isPro();
  if (!list || !isPro()) return;
  const current = state.EXTRA.sections;
  list.innerHTML = SECTIONS_CATALOG.map((s) => `<div class="section-row" data-section="${esc(s.key)}">
<span class="section-name">${esc(s.label)}</span>
<label class="switch" title="Show on public page"><input type="checkbox" class="section-toggle" data-section-toggle="${esc(s.key)}" role="switch" aria-label="${esc(s.label)}"${current[s.key] ? " checked" : ""} /><span class="switch-track"></span></label>
</div>`).join("");
  for (const input of list.querySelectorAll("[data-section-toggle]")) bindSectionToggle(input);
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

/**
 * The Customize tab states the public address; the Domain tab owns changing it.
 * Both read the one domain status this function already fetches.
 */
function setPublicDomainSummary(text) {
  const el = $("sitePublicDomainSummary");
  if (el) el.textContent = text;
}

// Only a domain the backend calls active is a public address; a pending, saved
// or failed one would send viewers nowhere, so it never replaces the default.
let _activePublicDomain = null;

/** The one resolved public URL every address affordance reads. */
export function publicSiteUrl() {
  if (_activePublicDomain) return `https://${_activePublicDomain}/`;
  return `${location.origin}/${state.SLUG}`;
}

/** Domain truth arrives after first paint; it repaints the address in place. */
export function setActivePublicDomain(domain) {
  _activePublicDomain = domain || null;
  renderSitePublicAddress();
}

/** Publish-independent facts about where the site lives, stated once. */
export function renderSitePublicAddress() {
  const card = $("sitePublicAddressCard");
  if (!card || (!state.SLUG && !_activePublicDomain)) return;
  const publicUrl = publicSiteUrl();
  const urlEl = $("sitePublicUrl");
  if (urlEl) urlEl.textContent = publicUrl;
  for (const id of ["sitePublicOpen", "sitePublicSiteAction"]) {
    const link = $(id);
    if (link) {
      link.href = publicUrl;
      link.title = publicUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    }
  }
  const copy = $("sitePublicCopy");
  const copyStatus = $("sitePublicCopyStatus");
  if (copy && !copy._wired) {
    copy._wired = true;
    copy.addEventListener("click", async () => {
      // Read the URL at click time so a domain that went active mid-session
      // is the one that gets copied.
      const url = publicSiteUrl();
      const copied = await copyToClipboard(url);
      flashButton(copy, copied ? "Copied!" : "Copy failed");
      // Colour and a flashing label are not a message: say what happened.
      if (copyStatus) copyStatus.textContent = copied ? `Copied ${url} to your clipboard.` : "Could not copy the link. Select it and copy manually.";
    });
  }
}

// Identity is edited where it is referenced, not by leaving the page. The old
// "Edit site identity" text link was an <a href="/dashboard/site">: even though
// the shell intercepts it, the cross-section request ran through
// allowNavigation(), so a dirty draft raised the "Unsaved changes" modal and a
// clean one swapped the visible section — a page-trip feel for what is a
// two-field edit. The action below opens the same name/tagline fields in an
// inline dialog and persists them directly, so nothing navigates and the
// creator's unsaved work in the surrounding editor is left untouched.
export function openSiteIdentityModal() {
  if ($("siteIdentityModal")) return;
  const nameValue = $("f_name")?.value.trim() || "";
  const taglineValue = $("f_tagline")?.value.trim() || "";
  const overlay = document.createElement("div");
  overlay.className = "modal";
  overlay.id = "siteIdentityModal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "siteIdentityTitle");
  overlay.innerHTML = `<div class="modal-card" role="document">
    <h3 id="siteIdentityTitle">Edit site identity</h3>
    <p>This is the name and tagline visitors see at the top of every public page.</p>
    <div class="field"><label for="identityName">Site name</label><input id="identityName" maxlength="80" autocomplete="off" placeholder="Summer Race 2026" /></div>
    <div class="field"><label for="identityTagline">Tagline <span class="hint">Optional</span></label><input id="identityTagline" maxlength="120" autocomplete="off" placeholder="Stream community leaderboard" /></div>
    <div class="modal-actions"><button class="btn btn--sm btn--ghost" data-identity="cancel" type="button">Cancel</button><button class="btn btn--sm btn--accent" data-identity="save" type="button">Save identity</button></div>
    <p class="status" id="siteIdentityErr" role="alert" aria-live="assertive"></p>
  </div>`;
  document.body.appendChild(overlay);
  document.documentElement.classList.add("yr-modal-open");
  const release = window.YRDialog ? window.YRDialog.trap(overlay, close) : null;
  const nameInput = overlay.querySelector("#identityName");
  const taglineInput = overlay.querySelector("#identityTagline");
  const err = overlay.querySelector("#siteIdentityErr");
  const save = overlay.querySelector('[data-identity="save"]');
  nameInput.value = nameValue;
  taglineInput.value = taglineValue;
  function close() {
    release?.();
    overlay.remove();
    document.documentElement.classList.remove("yr-modal-open");
  }
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-identity="cancel"]').addEventListener("click", close);
  for (const input of [nameInput, taglineInput]) {
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save.click(); } });
  }
  save.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const tagline = taglineInput.value.trim();
    if (!name) { err.textContent = "Enter a site name."; nameInput.focus(); return; }
    err.textContent = "Saving…";
    save.disabled = true;
    try {
      const { body } = await fetchDashboardJson("/api/site", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
        body: JSON.stringify({
          siteId: state.ACTIVE_SITE_ID || undefined,
          name,
          brand: { name, tagline },
        }),
      });
      if (body?.ok) {
        // Mirror the saved values into the editor fields so the Settings →
        // Public site card and the live preview agree without a reload.
        const nameField = $("f_name");
        const taglineField = $("f_tagline");
        if (nameField) nameField.value = name;
        if (taglineField) taglineField.value = tagline;
        state.ONBOARDING = { ...(state.ONBOARDING || {}), brand: true };
        close();
        showToast("Site identity saved.", "success");
        renderOverviewSummary();
        refreshDesignPreview();
      } else {
        err.textContent = body?.error || "Couldn't save the identity.";
        save.disabled = false;
      }
    } catch (e) {
      logError("site-identity-save", e);
      err.textContent = e?.message || "Couldn't save the identity.";
      save.disabled = false;
    }
  });
}

// The owner-note action is a button, so no routing is involved: clicking it
// never reaches requestDashboardRoute/allowNavigation and therefore never
// raises the unsaved-changes guard. Wiring is idempotent because the sections
// this note lives in re-render on navigation.
export function wireSiteIdentityActions() {
  for (const button of document.querySelectorAll("[data-identity-edit]")) {
    if (button._identityWired) continue;
    button._identityWired = true;
    button.addEventListener("click", () => openSiteIdentityModal());
  }
}

export async function renderDomain() {
  const pro = isPro();
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
  setPublicDomainSummary("Checking your domain…");

  // Load existing domain status
  try {
    const activeSiteParam = state.ACTIVE_SITE_ID ? `?siteId=${encodeURIComponent(state.ACTIVE_SITE_ID)}` : "";
    const res = await fetch(`/api/domains/my-domain${activeSiteParam}`, {
      credentials: "include",
      headers: { "x-csrf-token": getCsrf() },
    });
    const data = await res.json();
    if (res.status === 403) {
      if (domainBody) domainBody.hidden = true;
      if (domainLock) domainLock.hidden = true;
      $("domainManageCard")?.setAttribute("hidden", "true");
      setActivePublicDomain(null);
      setPublicDomainSummary("Custom domain settings are managed by the site owner.");
      if (overviewTitle) overviewTitle.textContent = "Managed by the site owner";
      if (overviewText) overviewText.textContent = "Only the site owner can view or change custom-domain settings.";
      if (overviewStatus) overviewStatus.textContent = "Owner access required";
      return;
    }
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
      setPublicDomainSummary(`${data.customDomain} — ${(stateLabels[domainState] || "Connected").toLowerCase()}.`);
      setActivePublicDomain(domainState === "active" ? data.customDomain : null);
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
      setActivePublicDomain(null);
      if (overviewTitle) overviewTitle.textContent = "No custom domain";
      if (overviewText) overviewText.textContent = "Your default yourrank.site address is active. Connect a domain you own or search for a new one below.";
      if (overviewStatus) overviewStatus.textContent = "Not connected";
      setPublicDomainSummary(pro
        ? "No custom domain. Connect one you own, or buy one from the Domain tab."
        : "Custom domains are a Pro feature. Your yourrank.site address stays active.");
    }
  } catch (err) {
    logError("domain-status", err);
    setActivePublicDomain(null);
    setPublicDomainSummary("We could not check your domain. Open the Domain tab to retry.");
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
  else renderEmpty($("archEmpty"), { icon: "archive", title: "No closed periods yet", body: "Close the current period when you want to preserve its final standings." });
  list.forEach((a) => {
    const row = document.createElement("div"); row.className = "arch-row";
    const at = new Date(a.at);
    const validAt = !Number.isNaN(at.getTime());
    const when = validAt ? at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Date unavailable";
    const datetime = validAt ? ` datetime="${esc(at.toISOString())}"` : "";
    row.innerHTML = `<div class="arch-copy"><span class="arch-label"></span><span class="hint">${a.players} player${Number(a.players) === 1 ? "" : "s"} · Closed <time${datetime}>${esc(when)}</time></span></div><div class="arch-actions"><button class="btn btn--xs btn--ghost arch-restore" type="button">Restore to editor</button><button class="btn btn--xs btn--ghost arch-del" type="button">Delete</button></div>`;
    row.querySelector(".arch-label").textContent = a.label;
    row.querySelector(".arch-restore").setAttribute("aria-label", `Restore ${a.label} to the editor`);
    row.querySelector(".arch-del").setAttribute("aria-label", `Delete ${a.label}`);
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
        } else showToast(d.error || "Couldn't restore that.", "error");
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
          if (!$("archList").children.length) renderEmpty($("archEmpty"), { icon: "archive", title: "No closed periods yet", body: "Close the current period when you want to preserve its final standings." });
          showToast("Archive deleted.", "success");
        }
        else showToast(d.error || "Couldn't delete that.", "error");
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
  // DEF-08: fall back to the toast stack when the host chrome has no #status.
  const setStatusText = (message, type = "info") => {
    if (status) { status.textContent = message; status.hidden = false; }
    else if (message) showToast(message, type);
  };
  if (![...$("rows").children].length) { setStatusText("The board is empty — nothing to close out.", "info"); return; }
  const clear = $("a_clear").value;
  const warn = clear === "players" ? "save the current board as past winners, then CLEAR the player list" : clear === "wagers" ? "save the current board as past winners, then reset every wager to 0" : "save the current board as past winners";
  if (!await confirmImpl("Close out period", `This will ${warn}. Continue?`, "Close out", true)) return;
  btn.disabled = true; btn.textContent = "Closing out…";
  try {
    const { payload: savePayload, invalid } = collectImpl();
    if (invalid.length) {
      const first = invalid[0];
      showToast(`Fix the invalid ${first.label.toLowerCase()} before closing out.`, "error");
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
      setStatusText(`"${d.label}" closed out — it's on your page now.`, "success");
    } else {
      throw new DashboardRequestError(p?.error || "Couldn't refresh the board after closing out.", { code: "SERVER" });
    }
  } catch (err) {
    logError("archive", err);
    if (status) { status.setAttribute("role", "alert"); status.setAttribute("aria-live", "assertive"); }
    setStatusText(closeOutErrorMessage(err), "error");
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

// One save can be in flight at a time, whichever save button started it: the
// editor save bar and the Site settings save bar are two views of one draft.
let _saving = false;

function saveButtons() {
  return [$("save"), $("settingsSave")].filter(Boolean);
}

/**
 * What the quiet save strip says, which depends on which settings tab the
 * creator is on: only Customize has controls that save on their own.
 */
export function cleanSaveStatusText() {
  const active = document.querySelector("[data-settings-tab].is-on")?.dataset.settingsTab;
  return active === "notifications"
    ? "Use Save changes after updating notification destinations."
    : "Navigation switches save immediately. Use Save changes for everything else.";
}

/** Mirror the save status where the creator is looking, not only in the toast. */
function setSaveStatusText(text) {
  const settingsText = $("settingsSaveText");
  if (settingsText) settingsText.textContent = text || "Use Save changes after updating these settings.";
}

/**
 * The settings save bar sits directly under the tabs so an edit anywhere on
 * the page surfaces Save without scrolling. It appears only while the draft
 * is dirty on a tab whose fields it saves, and hides again the moment a save
 * (or a tab that saves on its own, like Navigation switches) leaves nothing
 * unsaved.
 */
export function syncSettingsSaveBar() {
  const bar = $("settingsSaveBar");
  if (!bar) return;
  const tab = document.querySelector("[data-settings-tab].is-on")?.dataset.settingsTab || "customize";
  bar.hidden = !(state._dirty && (tab === "customize" || tab === "notifications"));
}

export async function saveEditorDraft({ fetchImpl = fetch, collectImpl = collect, button } = {}) {
  const btn = button || $("save"), status = $("status"), publishAction = $("publishAction");
  // DEF-08: The chrome replaced the single #status element with the stacked
  // toast queue. Keep writing to #status when a host page still provides it
  // (tests, worker documents) and fall back to toasts otherwise.
  const setStatusText = (message, type = "info") => {
    if (status) { status.textContent = message; status.hidden = false; }
    else if (message) showToast(message, type);
  };
  if (_saving) return false;
  const { payload, invalid } = collectImpl();
  if (invalid.length) {
    const first = invalid[0];
    for (const entry of invalid) {
      if (entry.input) entry.input.dataset.touched = "1";
    }
    collectImpl();
    // The field may live on another tab, so the toast has to name it —
    // "Period end: choose a date…" tells the creator where to look.
    const message = first.message
      ? `${first.label}: ${first.message.charAt(0).toLowerCase()}${first.message.slice(1)}`
      : `Fix the invalid ${first.label.toLowerCase()} before saving.`;
    if (status) status.setAttribute("role", "alert");
    setStatusText(message, "error");
    setSaveStatusText(message);
    first.input?.focus();
    return false;
  }
  _saving = true;
  const savingRevision = state.DRAFT_REVISION;
  for (const other of saveButtons()) other.disabled = true;
  setSaveStatusText("Saving your changes…");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  if (status) { status.textContent = ""; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); }
  if (publishAction) { publishAction.disabled = true; publishAction.setAttribute("aria-busy", "true"); }
  const limitEl = $("limitMsg"); if (limitEl) limitEl.textContent = "";
  let justPublished = false;
  let saved = false;
  let saveMessage = "";
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
    const newerChanges = state.DRAFT_REVISION !== savingRevision;
    if (Array.isArray(payload.players)) state.SAMPLE_PLAYERS = false;
    state.SAVED_PLAYERS = Array.isArray(payload.players) ? payload.players.map((player) => ({ ...player })) : [];
    if (!newerChanges) clearPlayersDraft();
    const restoredNotice = $("playersDraftNotice");
    if (restoredNotice && !newerChanges) restoredNotice.hidden = true;
    setState({ _dirty: newerChanges, PUBLISHED: !!payload.published, RANK_BY: payload.rankBy === "wagered" ? "wagered" : "score" });
    const savedMessage = newerChanges
      ? "Saved the earlier changes. Your newer changes are still unsaved — save again before leaving."
      : justPublished && !boardStatus().emailVerified
      ? "Published — Your leaderboard will open to visitors after you confirm your email."
      : "Saved";
    setStatusText(savedMessage, "success");
    saveMessage = savedMessage;
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
    // Navigation may continue only if the current draft was actually saved.
    saved = !newerChanges;
  } catch (err) {
    logError("save", err);
    // The draft is intentionally NOT cleared on any failure — say so.
    if (err?.code === "AUTH") {
      saveMessage = "Your session ended — your changes are still here. Sign in again in a new tab, then retry.";
    } else if (err?.code === "FORBIDDEN") {
      saveMessage = err.message || "You don't have access to do that.";
    } else if (err?.code === "concurrency_conflict" || err?.status === 409) {
      saveMessage = "Another session saved this leaderboard. Your draft is still here — reload to review their version, or save again after reconciling.";
    } else if (err?.code === "TIMEOUT") {
      saveMessage = "Saving timed out. Your changes are still here — try again.";
    } else if (err?.code === "NETWORK") {
      saveMessage = "Couldn't save. Your changes are still here — try again.";
    } else {
      saveMessage = err?.message || "Couldn't save. Your changes are still here — try again.";
    }
    if (status) { status.setAttribute("role", "alert"); status.setAttribute("aria-live", "assertive"); }
    setStatusText(saveMessage, "error");
  }
  _saving = false;
  for (const other of saveButtons()) other.disabled = false;
  if (btn) { btn.disabled = false; btn.textContent = "Save changes"; }
  // A clean draft has nothing to save, so the settings save button goes quiet
  // again instead of inviting a second identical request.
  const settingsSave = $("settingsSave");
  if (settingsSave) settingsSave.disabled = !state._dirty;
  if (publishAction) { publishAction.disabled = false; publishAction.removeAttribute("aria-busy"); }
  const finalStatusMessage = status ? status.textContent : (saved ? "Saved" : saveMessage);
  setSaveStatusText(finalStatusMessage);
  if (status) {
    const savedMsg = status.textContent;
    if (justPublished || savedMsg === "Saved") {
      setTimeout(() => { if (status.textContent === savedMsg) status.textContent = ""; }, 6000);
    }
  }
  return saved;
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

    // The server exposes overlays for every non-Free effective plan; the
    // designer card is the one place to compose and copy the OBS link.
    const overlayAccess = state.ME?.plan !== "free";
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

    renderApiAccess();
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
