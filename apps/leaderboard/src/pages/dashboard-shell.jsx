/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import { profileMenuHtml } from "@yourrank/shared/shell-nav";
import { dashboardNavItems as sharedDashboardNavItems } from "@yourrank/shared/dashboard-nav";
import { raw } from "hono/html";
import { crumbsHtml, navListHtml } from "@yourrank/shared/dashboard-chrome";
import { brandMarkSvg } from "@yourrank/shared/brand-assets";
import { navOwner } from "@yourrank/shared/dashboard-nav";

const DESIGN_CONTRACT = `<!--
THESIS: A creator run-sheet workspace turns dashboard state into the next clear action; it refuses the generic dark tile wall.
OWN-WORLD: Devin-reference operating system — quiet near-white fields, an ink production rail, electric-violet actions, restrained geometry, and precise hairline rules.
STORY: A non-technical streamer sees what is live, what needs attention, acts immediately, and can reach every feature from one rail.
FIRST VIEWPORT: Fixed branded rail at left; operational topbar above one launch run-sheet, a divided KPI band, and a compact 8/4 activity and players workspace.
FORM: Devin-reference identity layered onto the Creator Run-Sheet workspace, seed 562938e8; the devin.ai reference governs material and hierarchy while YourRank content and branding remain original.
FINISH: Every shipped surface is reviewed at desktop and mobile, documented in DESIGN.md, and held to the shared accessibility and responsive floor.
-->`;

export function dashboardNavItems() {
  return sharedDashboardNavItems();
}

export function mapActiveNav(nav) {
  return navOwner(nav);
}

function SidebarFooter({ profile }) {
  return <div class="lb-side-profile">{raw(profile)}</div>;
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

export function DashboardShell({ activeNav = "home", boardContext = "full", footer = "dashboard", title = "", topbarContext, crumbs = null, activePath = "", rootId, initiallyHidden = false, user, overlays = null, children }) {
  // Pages that own a canonical route pass activePath from the chrome state;
  // the fallback covers chromeless shells only (e.g. the dashboard 404).
  const resolvedActivePath = activePath || (boardContext === "none" ? "/dashboard/settings" : "/dashboard");
  const shellId = rootId || (boardContext === "none" ? "account-dash" : "dash");
  const profile = profileMenuHtml({ activePath: resolvedActivePath, user, standalone: true, dynamicIdentity: true });
  const resolvedTopbarContext = topbarContext ?? (footer === "help" ? "Help & feedback" : "Account settings");

  return <div class="v3-dash" id={shellId} data-auth-workspace="true" data-identity="devin-reference" hidden={initiallyHidden}>
    {raw(DESIGN_CONTRACT)}
    <div class="toast" id="status" role="status" aria-live="polite"></div>
    <div class="lb-shell">
      <aside class="lb-side" id="lbSide" aria-label="Dashboard features">
        <div class="lb-side-brandrow">
          <a class="lb-side-brand" href="/dashboard" aria-label="YourRank dashboard"><span class="lb-brand-mark">{raw(brandMarkSvg())}</span><span class="lb-side-brandcopy"><b>YourRank</b><small>Creator workspace</small></span></a>
          <button class="lb-side-collapse" type="button" aria-label="Collapse navigation" aria-pressed="false" aria-controls="lbSide" data-collapse-side><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
          <button class="lb-side-close" type="button" aria-label="Close navigation" data-close-side><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div>
        {raw(navListHtml(
          dashboardNavItems(),
          mapActiveNav(activeNav),
          "Dashboard"
        ))}
        <SidebarFooter profile={profile} />
      </aside>
      <div class="lb-main">
        <header class="lb-topbar" id="lbTopbar">
          <button class="lb-menu lb-topbar-menu" id="lbMenu" type="button" aria-label="Show sections" aria-expanded="false" aria-controls="lbSide"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
          {boardContext !== "none" ? (
            <div class="lb-topbar-hud">
              <div class="lb-site-command">
                <div class="lb-board-select-wrap">
                  <span class="lb-board-select-lbl">Current site</span>
                  <div class="lb-board-select-row">
                    <select class="lb-board-select" id="sidebarBoardSelect" aria-label="Switch site"></select>
                  </div>
                </div>
              </div>
            </div>
          ) : resolvedTopbarContext ? (
            raw(workspaceAccountTopbarHtml({
              context: resolvedTopbarContext,
              title,
              help: footer === "help",
            }))
          ) : null}
          <div class="lb-topbar-actions">
            {raw(workspaceSearchHtml())}
            {boardContext !== "none" && (
              <div class="lb-availability">
                <span class="lb-status" id="lbTopbarStatus">Checking</span>
                <span class="lb-status lb-status--draft-changes" id="lbTopbarDraft" hidden>Draft changes</span>
                {boardContext === "full" && (
                  <>
                    <input type="checkbox" id="pubToggle" hidden tabindex="-1" aria-hidden="true" />
                    <button class="lb-publish-action" id="publishAction" type="button">
                      <span id="lbPublishLabel">Publish site</span>
                    </button>
                    <a class="lb-live-link" id="liveLink" href="#" hidden>View site ↗</a>
                  </>
                )}
              </div>
            )}
          </div>
        </header>
        <div class="lb-bento" id={boardContext === "selector" ? "cr-main" : undefined}>{crumbs ? raw(crumbsHtml(crumbs, resolvedActivePath)) : null}{children}</div>
        {overlays ? raw(overlays) : null}
      </div>
    </div>
  </div>;
}
