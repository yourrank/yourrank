// P4-4: View-as-Moderator simulator. An owner-only, session-only preview that
// renders the dashboard chrome the way a moderator sees it: owner-gated UI
// (Danger Zone, Sites table actions) hides and moderator messaging shows.
// This is explicitly cosmetic — every owner-only API stays enforced
// server-side; the banner says so in plain words. Not persisted: closing the
// tab ends the preview.
import { $ } from "./utils.js";

const ROLE_PREVIEW_BANNER_ID = "yr-role-preview-banner";

let active = false;

/** True while the owner is previewing the moderator experience. */
export function isRolePreviewActive() {
  return active;
}

/**
 * The role the UI should present for a board. Real owners see "moderator"
 * while the preview is on; everyone else sees their real role unchanged.
 */
export function effectiveBoardRole(board) {
  const realRole = board?.userRole || null;
  if (active && realRole === "owner") return "moderator";
  return realRole;
}

/** Owners only; starting the preview twice is a no-op. Returns success. */
export function startRolePreview(realRole) {
  if (realRole !== "owner" || active) return false;
  active = true;
  showBanner();
  return true;
}

export function stopRolePreview() {
  if (!active) return false;
  active = false;
  $(ROLE_PREVIEW_BANNER_ID)?.remove();
  return true;
}

function showBanner() {
  if ($(ROLE_PREVIEW_BANNER_ID) || typeof document === "undefined") return;
  const banner = document.createElement("div");
  banner.id = ROLE_PREVIEW_BANNER_ID;
  banner.className = "yr-role-preview-banner";
  banner.setAttribute("role", "status");
  banner.innerHTML = `
    <span>Previewing as <strong>moderator</strong> — owner-only controls are hidden in this view. Server permissions are unchanged.</span>
    <button type="button" class="btn btn--xs btn--ghost yr-role-preview-exit">Exit preview</button>`;
  document.body.appendChild(banner);
  banner.querySelector(".yr-role-preview-exit")?.addEventListener("click", () => {
    stopRolePreview();
    // Re-render the current surface so hidden owner controls come back.
    window.dispatchEvent(new CustomEvent("yr:role-preview-changed"));
  });
}
