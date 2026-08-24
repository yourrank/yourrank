/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import { dashboardNavItems as sharedDashboardNavItems } from "@yourrank/shared/dashboard-nav";
import { raw } from "hono/html";
import { dashboardChromeHtml } from "@yourrank/shared/dashboard-chrome";
import { navOwner } from "@yourrank/shared/dashboard-nav";

export function dashboardNavItems() {
  return sharedDashboardNavItems();
}

export function mapActiveNav(nav) {
  return navOwner(nav);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

export function workspaceAccountTopbarHtml({ context, title = "", help = false } = {}) {
  const icon = help
    ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4M12 18h.01"/></svg>'
    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  return `<div class="lb-topbar-hud"><div class="lb-account-hud"><span class="lb-hud-icon" aria-hidden="true">${icon}</span><div class="lb-hud-details"><span class="lb-board-select-lbl">${escapeHtml(context)}</span>${title ? `<span class="lb-account-title">${escapeHtml(title)}</span>` : ""}</div></div></div>`;
}

export function workspaceSearchHtml() {
  return '<button class="lb-topbar-cmd" type="button" id="topbarCmdTrigger" aria-label="Search (⌘K or Ctrl+K)" title="Press ⌘K or Ctrl+K to search"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg><span>Search…</span><kbd>⌘K</kbd></button>';
}

function workspaceSiteContextHtml() {
  return '<div class="lb-topbar-hud"><div class="lb-site-command"><div class="lb-board-select-wrap"><span class="lb-board-select-lbl">Current site</span><div class="lb-board-select-row"><select class="lb-board-select" id="sidebarBoardSelect" aria-label="Switch site"></select></div></div></div></div>';
}

function workspaceAvailabilityHtml(boardContext) {
  if (boardContext === "none") return "";
  return `<div class="lb-availability"><span class="lb-status" id="lbTopbarStatus">Checking</span><span class="lb-status lb-status--draft-changes" id="lbTopbarDraft" hidden="">Draft changes</span>${boardContext === "full"
    ? '<input type="checkbox" id="pubToggle" hidden="" tabindex="-1" aria-hidden="true"/><button class="lb-publish-action" id="publishAction" type="button"><span id="lbPublishLabel">Publish site</span></button><a class="lb-live-link" id="liveLink" href="#" hidden="">View site ↗</a>'
    : ""}</div>`;
}

export function DashboardShell({ activeNav = "home", boardContext = "full", footer = "dashboard", title = "", topbarContext, crumbs = null, activePath = "", rootId, initiallyHidden = false, user, overlays = null, children }) {
  // Pages that own a canonical route pass activePath from the chrome state;
  // the fallback covers chromeless shells only (e.g. the dashboard 404).
  const resolvedActivePath = activePath || (boardContext === "none" ? "/dashboard/settings" : "/dashboard");
  const shellId = rootId || (boardContext === "none" ? "account-dash" : "dash");
  const resolvedTopbarContext = topbarContext ?? (footer === "help" ? "Help & feedback" : "Account settings");
  const contextHtml = boardContext !== "none"
    ? workspaceSiteContextHtml()
    : resolvedTopbarContext
      ? workspaceAccountTopbarHtml({
        context: resolvedTopbarContext,
        title,
        help: footer === "help",
      })
      : "";
  const contentId = boardContext === "selector" ? "cr-main" : "workspace-content";

  return raw(dashboardChromeHtml({
    nav: dashboardNavItems(),
    active: mapActiveNav(activeNav),
    navLabel: "Dashboard",
    sideLabel: "Dashboard features",
    rootId: shellId,
    rootHidden: initiallyHidden,
    identity: "devin-reference",
    activePath: resolvedActivePath,
    user,
    dynamicIdentity: true,
    railProfile: true,
    collapsible: true,
    topbarContextHtml: contextHtml,
    topbarHtml: `${workspaceSearchHtml()}${workspaceAvailabilityHtml(boardContext)}`,
    crumbs: crumbs || [],
    embeddedInMain: true,
    directContent: true,
    contentId,
    overlaysHtml: overlays || "",
    content: String(children ?? ""),
  }));
}
