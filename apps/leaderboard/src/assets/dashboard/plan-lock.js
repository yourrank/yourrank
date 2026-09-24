// Shared plan paywall: renders a quiet inline locked state for a feature the
// current plan doesn't include, and records billing funnel events
// (paywall_viewed once per feature per page load, upgrade_clicked on click).
// Reuses the `.empty.upsell-card` pattern from embedObsLock — feature stays
// visible, no modal.
import { esc } from "@yourrank/shared/public-render-helpers";
import { FEATURE_LABELS, FEATURE_MIN_TIER, PLAN_TIERS } from "@yourrank/shared/plans";
import { getCsrf } from "./utils.js";

const viewed = new Set();

export function trackFunnel(event, feature) {
  if (event === "paywall_viewed") {
    if (viewed.has(feature)) return;
    viewed.add(feature);
  }
  fetch("/api/billing/funnel", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "x-csrf-token": getCsrf() },
    body: JSON.stringify({ event, feature }),
  }).catch(() => {});
}

function tierList(feature) {
  const min = FEATURE_MIN_TIER[feature];
  if (!min) return "a paid plan";
  const names = PLAN_TIERS.slice(PLAN_TIERS.indexOf(min)).map((t) => t.charAt(0).toUpperCase() + t.slice(1));
  return names.join(" and ");
}

/** Markup for the locked state. Wire with wirePlanLock(container, feature). */
export function planLockMarkup(feature, { ctaId } = {}) {
  const label = FEATURE_LABELS[feature];
  const name = label?.name || "This feature";
  const desc = label?.description || "";
  return `<div class="empty upsell-card plan-lock" data-plan-lock="${esc(feature)}"><p><strong>${esc(name)}</strong>${desc ? ` — ${esc(desc)}` : ""}</p><p class="hint">Available on ${esc(tierList(feature))}. <a href="/dashboard/settings/billing?from=${esc(feature)}"${ctaId ? ` id="${esc(ctaId)}"` : ""} data-plan-lock-upgrade>Upgrade your plan</a></p></div>`;
}

/** Attaches funnel tracking to a plan-lock container (or an existing upsell
 * element like #embedObsLock). Returns the element. */
export function wirePlanLock(el, feature, { onUpgrade } = {}) {
  if (!el) return el;
  trackFunnel("paywall_viewed", feature);
  if (el._planLockWired) return el;
  el._planLockWired = true;
  el.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-plan-lock-upgrade], #overlayUpgrade, #apiUpgrade, #teamUpgradeLink, [data-upgrade-link]");
    if (!link) return;
    trackFunnel("upgrade_clicked", feature);
    if (onUpgrade) {
      event.preventDefault();
      onUpgrade(link);
    }
  });
  return el;
}

/** Full helper: insert a locked state after `anchor` (or replace `el`
 * content), show it when not entitled. `features` = enabled feature list from
 * /api/account/usage (or derive from plan via PLAN_FEATURES). */
export function planLock(feature, { enabled = false, into = null } = {}) {
  if (enabled) return null;
  const el = document.createElement("div");
  el.innerHTML = planLockMarkup(feature);
  const card = el.firstElementChild;
  if (into) into.appendChild(card);
  wirePlanLock(card, feature);
  return card;
}

/** True when the shared fetch error came from an entitlement denial (403 with
 * code entitlement_required / plan_limit_reached). */
export function isEntitlementError(error) {
  return error?.status === 403 && ["entitlement_required", "plan_limit_reached"].includes(error?.code);
}
