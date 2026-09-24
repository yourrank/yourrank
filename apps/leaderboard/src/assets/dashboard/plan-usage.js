import { esc } from "@yourrank/shared/public-render-helpers";

export function activeViewerUsageMarkup(usage) {
  if (!usage) return "";
  const used = Math.max(0, Number(usage.activeViewers) || 0);
  const limit = Math.max(1, Number(usage.allowance) || 1);
  const percentage = Math.max(0, Math.round(Number(usage.percentage) || (used / limit) * 100));
  const barPercentage = Math.min(100, percentage);
  const level = ["normal", "informational", "notice", "warning", "at_limit", "grace", "restricted"].includes(usage.level)
    ? usage.level
    : "normal";
  const upgradeAllowance = Math.max(0, Number(usage.upgradeAllowance) || 0);
  const plan = usage.plan === "pro" || usage.plan === "team" ? usage.plan : "free";
  const planLabel = plan === "team" ? "Team" : plan === "pro" ? "Pro" : "Free";
  const nextTier = plan === "free" ? "Pro" : plan === "pro" ? "Team" : null;
  const nextTierNote = nextTier && upgradeAllowance > 0 ? ` ${nextTier} supports ${upgradeAllowance.toLocaleString()} active viewers.` : "";
  let message = "Unique signed-in viewers who took part across all your sites.";
  if (level === "informational") message = "Your community is growing. This is a quiet heads-up; nothing changes for viewers.";
  if (level === "notice") message = `You are nearing the ${planLabel} allowance.${nextTierNote}`;
  if (level === "warning") message = `You are close to the ${planLabel} allowance.${nextTierNote}`;
  if (level === "at_limit") {
    message = plan === "free"
      ? "You have reached the Free allowance. Going above it starts a 14-day grace period; viewers keep access."
      : plan === "team"
        ? "You have reached the Team allowance. Viewers keep access and existing activity continues; higher limits are available on request."
        : `You have reached the Pro allowance. Viewers keep access and existing activity continues.${nextTierNote}`;
  }
  if (level === "grace") message = `Grace ends ${new Date(usage.graceEndsAt).toLocaleDateString()}. Viewer access continues;${nextTierNote || " upgrade to raise the allowance."}`;
  if (level === "restricted") message = "New creator-side expansion is paused. Viewer access, memberships, credits, orders and existing activity continue.";
  const attention = ["notice", "warning", "at_limit", "grace", "restricted"].includes(level);
  const compare = !attention
    ? ""
    : plan === "team"
      ? '<a class="plan-usage-action" href="/help/support">Talk to us about more scale</a>'
      : `<a class="plan-usage-action" href="/pricing">Compare ${nextTier}</a>`;
  return `<section class="plan-active-viewers plan-active-viewers--${esc(level)}" data-level="${esc(level)}" aria-labelledby="activeViewerUsageLabel"><div class="plan-active-viewers-head"><div><h3 id="activeViewerUsageLabel">Active viewers</h3><p>Last 30 days · across your account</p></div><strong>${used.toLocaleString()} / ${limit.toLocaleString()}</strong></div><div class="plan-active-viewers-bar" role="progressbar" aria-label="Active viewer usage" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${Math.min(used, limit)}"><i style="width:${barPercentage}%"></i></div><div class="plan-active-viewers-foot"><p>${esc(message)}</p>${compare}</div></section>`;
}
