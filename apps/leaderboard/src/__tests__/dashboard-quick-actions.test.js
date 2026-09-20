import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { PAGES } from "../pages.jsx";
import { effectivePlan } from "@yourrank/shared/plans";
import { SETUP_STEPS, setupStepHref } from "../assets/dashboard/overview-state.js";
import { SECTIONS } from "../assets/dashboard/routes.js";

const siteJs = readFileSync(new URL("../assets/dashboard/site.js", import.meta.url), "utf8");
const utilsJs = readFileSync(new URL("../assets/dashboard/utils.js", import.meta.url), "utf8");
const overviewJs = readFileSync(new URL("../assets/dashboard/overview.js", import.meta.url), "utf8");
const gamesJs = readFileSync(new URL("../assets/dashboard/games.js", import.meta.url), "utf8");
const dashboardJs = readFileSync(new URL("../assets/dashboard.js", import.meta.url), "utf8");
const boardShellJs = readFileSync(new URL("../assets/dashboard/board-shell.js", import.meta.url), "utf8");
const performanceJs = readFileSync(new URL("../assets/dashboard/performance.js", import.meta.url), "utf8");
const dashboardCss = readFileSync(new URL("../assets/dashboard-v4.css", import.meta.url), "utf8");
const workerIndex = readFileSync(new URL("../index.js", import.meta.url), "utf8");

function dashboardHtml(activePath = "/dashboard") {
  return PAGES.dashboard.Component({ activePath }).toString();
}

describe("dashboard overview quick actions", () => {
  it("puts the main tasks one click from the Overview", () => {
    const html = dashboardHtml();
    expect(html).toContain('ov-setup');
    expect(html).toContain('id="ovSetupMessage"');
    expect(html).toContain('id="ovSetupAction"');
    expect(html).toContain('<ul class="ov-setup-list" id="ovSetupList" aria-label="Setup steps"></ul>');
    expect(html).not.toContain('id="ovActiveGiveaway"');
    expect(html).not.toContain("Times shared");
    for (const id of ["ovAttention", "ovLiveNow", "ovComingNext", "ovPulse", "ovRecent", "ovQuickActions", "ovSetup"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).not.toContain('id="ovTopPlayers"');
    expect(html).not.toContain('id="ovNextStep"');
    expect(html).not.toContain('id="ovHappeningNow"');
    expect(html).not.toContain('class="ov-summary"');
    expect(html).toContain('id="ovPublishedStatus"');
    expect(html).toContain('id="ovPublicLink"');
    expect(html).toMatch(/id="ovPublicLink"[^>]*hidden/);
    expect(html).not.toContain('id="ovPublicSiteAction"');
    expect(html).toContain('id="liveLink"');
    expect((html.match(/>View site ↗</g) || []).length).toBe(1);
    expect(html).toContain('class="ov-scope"><strong id="ovSiteName"');
    expect(html).toContain('id="ovOperatorContext" hidden');
    expect(html).toContain('class="ov-status" id="ovStatus"');
    expect(html).toContain('class="ov-figures" id="ovFigures" aria-label="Community pulse"');
    expect(html).toContain('id="ovPulseRange">Last 30 days<');
    expect(html).not.toContain("Visits this week");
    expect(html).not.toContain('id="ovKpiRow"');
    expect(html).not.toContain('id="ovCommandGrid"');
    expect((html.match(/id="ovPublishedStatus"/g) || []).length).toBe(1);
  });

  it("models Home setup as an accessible essentials-only checklist that sits last", () => {
    const html = dashboardHtml();
    expect(SETUP_STEPS.map((step) => step.key)).toEqual(["brand", "players", "publish"]);
    expect(SETUP_STEPS.some((step) => step.key === "kick")).toBe(false);
    expect(setupStepHref(SETUP_STEPS[0], { siteId: "s1" })).toBe("/dashboard/site?board=s1");
    expect(setupStepHref(SETUP_STEPS[1], { siteId: "s1" })).toBe("/dashboard/leaderboard/players?board=s1");
    expect(setupStepHref(SETUP_STEPS[2], { emailVerified: true })).toBe("#publish");
    expect(setupStepHref(SETUP_STEPS[2], { emailVerified: false })).toBe("/verify-email");
    // Setup progress must be the last Home section and start hidden.
    expect(html.lastIndexOf('id="ovSetup"')).toBeGreaterThan(html.indexOf('id="ovQuickActions"'));
    expect(html).toMatch(/id="ovSetup"[^>]*hidden/);
    expect(html).not.toContain("Active giveaways");
    expect(overviewJs).toContain("state.CREDITS?.usage?.pendingRedemptions");
    expect(overviewJs).toContain("state.CREDITS?.channel || null");
    expect(dashboardHtml()).toContain('id="ovAttentionList"');
    expect(dashboardHtml()).toContain('id="ovAttentionCount"');
    expect(dashboardHtml()).toContain('role="region" aria-live="polite" aria-atomic="false" hidden');
    expect(overviewJs).toContain('Moderator for ${ownerName}');
    expect(overviewJs).toContain('data-setup-state="${stateKey}"');
    expect(overviewJs).toContain('"owner-action"');
    expect(overviewJs).toContain("setMetricLoading(");
    expect(overviewJs).not.toContain("/api/events/raffles");
    expect(overviewJs).not.toContain("/api/predictions");
    expect(overviewJs).not.toContain("GIVEAWAYS_STATUS");
    expect(overviewJs).toContain('renderEmpty(activityEmpty');
    expect(overviewJs).not.toContain("ov_topEmpty");
  });

  it("keeps one owner for the Home body and its data", () => {
    const html = dashboardHtml();
    for (const marker of [/data-page="home"/g, /id="ovFigures"/g, /id="ovActivityList"/g, /id="ovQuickActionsList"/g]) {
      expect(html.match(marker)).toHaveLength(1);
    }
    // Every Home section is derived in overview-state.js and painted by
    // overview.js; nothing else may render Home.
    expect(overviewJs).toContain("renderOverviewSummary");
    for (const projection of ["attentionItems(", "liveNowItems(", "comingNextItems(", "pulseMetrics(", "recentActivityItems(", "quickActions(", "setupProgress("]) {
      expect(overviewJs).toContain(projection);
    }
    expect(overviewJs).toContain("setMetricLoading(");
    expect(overviewJs).not.toContain("nextStepAction(");
    expect(overviewJs).not.toContain("visitsMetricState(");
    expect(dashboardCss).not.toContain(".ov-next-step");
    expect(dashboardCss).not.toContain(".ov-lists");
  });

  it("keeps Home orientation-only by removing score mutation controls", () => {
    const html = dashboardHtml();
    expect(html).not.toContain("ov-inc-btn");
    expect(html).not.toContain("+100");
    expect(html).not.toContain("+500");
    expect(html).not.toContain("+1k");
    expect(overviewJs).not.toContain("markDirty");
    expect(overviewJs).not.toContain("querySelectorAll(\".ov-inc-btn\")");
  });

  it("routes unverified users to email confirmation without a duplicate Overview banner", () => {
    expect(overviewJs).toContain("status.published && !status.emailVerified");
    expect(overviewJs).toContain("const needsVerification = !status.emailVerified");
    expect(overviewJs).toContain("const readyToPublish = steps.brand && steps.players");
    expect(overviewJs).toContain("const verificationIsNext = pendingVerification || (readyToPublish && needsVerification)");
    expect(overviewJs).toContain('verificationIsNext ? "/verify-email"');
    expect(overviewJs).toContain('verificationIsNext ? "Confirm email"');
    expect(siteJs).toContain("banner.hidden = s.emailVerified || dismissed");
    expect(siteJs).toContain("export function wirePublishAction");
    expect(siteJs).toContain("requestPublicationChange");
  });

  it("preserves the selected site across Sites and Credits", () => {
    expect(dashboardJs).toContain('target.searchParams.set("siteId", state.ACTIVE_SITE_ID)');
    expect(dashboardJs).toContain('target.searchParams.set("board", state.ACTIVE_SITE_ID)');
    expect(dashboardJs).toContain('target.pathname.startsWith("/dashboard/leaderboard/")');
    expect(dashboardJs).toContain('target.pathname.startsWith("/dashboard/analytics/")');
    expect(boardShellJs).toContain('"/dashboard/leaderboards"');
    expect(boardShellJs).toContain('target.pathname.startsWith("/dashboard/leaderboard/")');
    expect(boardShellJs).toContain('target.searchParams.set("board", siteId)');
    expect(boardShellJs).toContain('target.searchParams.set("siteId", siteId)');
    expect(boardShellJs).not.toContain("dataset.productLink");
    expect(dashboardJs).not.toContain("dataset.productLink");
  });

  it("reports public site availability truthfully from Credits", () => {
    expect(boardShellJs).toContain("Boolean(board.published) && user.emailVerified !== false");
    expect(boardShellJs).toContain('live ? "Live" : pendingVerification ? "Verification needed" : "Not live"');
    expect(boardShellJs).toContain('publicLink.textContent = "View site ↗"');
    // The topbar publish button is the single publication action: this link
    // never restates it, it only opens the page or asks for verification.
    expect(boardShellJs).toContain('publicLink.hidden = !(live && board.slug) && !pendingVerification');
    expect(boardShellJs).toContain('publicLink.textContent = "Verify email"');
    expect(boardShellJs).not.toContain('publicLink.textContent = pendingVerification ? "Verify email" : "Publish site"');
    expect(siteJs).toContain('export function publicationCopy');
    expect(siteJs).toContain('statusLabel: "Live"');
    expect(siteJs).toContain('statusLabel: "Not live"');
    expect(siteJs).toContain('footerLabel: dirty ? "Changes not published" : "All changes published"');
    expect(siteJs).toContain('s.published ? "Unpublish site" : "Publish site"');
    expect(siteJs).toContain('nextPublished ? "Publishing…" : "Unpublishing…"');
  });

  it("keeps tablet navigation closable", () => {
    expect(dashboardCss).toMatch(/@media \(max-width: 980px\)[\s\S]*?\.v3-dash\[data-auth-workspace\] \.lb-side-close \{[\s\S]*?display: inline-flex;[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
  });

  it("keeps account plan panels readable on the dark dashboard", () => {
    expect(dashboardCss).toMatch(/\.v3-dash\[data-auth-workspace\] \.plan-usage-row \{[\s\S]*?background: var\(--ws-surface\);/);
    expect(dashboardCss).toMatch(/\.v3-dash\[data-auth-workspace\] \.plan-pending,[\s\S]*?\.v3-dash\[data-auth-workspace\] \.plan-cancel \{[\s\S]*?background: var\(--ws-surface-soft\);/);
  });

  it("keeps public-section ownership in Site and leaderboard presentation in Appearance", () => {
    expect(dashboardCss).toContain(".v3-dash[data-auth-workspace] .v3-alert");
    expect(dashboardCss).toContain(".v3-dash[data-auth-workspace] .v3-alert--warning");
    expect(dashboardCss).not.toContain(".v3-dash[data-auth-workspace] .v3-block-status");
    expect(dashboardHtml()).toContain('class="v3-alert v3-alert--warning"');
    // The contained Games page may remain directly routable for the owner, but
    // Site settings no longer promotes it as a public navigation pillar.
    const games = dashboardHtml("/dashboard/games");
    expect(games).toContain("Public page visibility");
    expect(games).toContain("Manage public sections in Site settings →");
    expect(games).toContain("/dashboard/site?tab=customize");
    expect(games).not.toContain("Page block visibility");
    expect(games).not.toContain("Choose which blocks appear on your leaderboard page");
    const site = dashboardHtml("/dashboard/site");
    // Public destinations are presented as the site's navigation, next to the
    // preview that shows them, rather than as a separate "sections" concept.
    expect(site).toContain("<h2>Navigation</h2>");
    expect(site).toContain('id="siteSectionRows"');
    expect(site).toContain("Leaderboard appearance");
    expect(site).toContain("Layout, page blocks and prize labels are managed with the leaderboard.");
    expect(site).toContain('href="/dashboard/leaderboard/design">Open Appearance</a>');
    expect(site).not.toContain("leaderboardBlockRows");
  });

  it("keeps authenticated cards on the v4 geometry without changing public cards", () => {
    expect(dashboardCss).toMatch(/\.v3-dash\[data-auth-workspace\] \.card \{[\s\S]*?padding: 24px;[\s\S]*?margin-top: 0;[\s\S]*?transition: none;/);
    expect(dashboardCss).toContain(".v3-dash[data-auth-workspace] .card:hover { border-color: var(--ws-line); }");
    // Home sections stack in one column; no framed side-by-side card grid.
    expect(dashboardCss).not.toContain(".ov-lists");
    expect(dashboardCss).not.toContain(".ov-live-grid");
  });

  it("labels Appearance editor groups by the content they contain", () => {
    const html = dashboardHtml("/dashboard/leaderboard/design");
    expect(html).toContain('<h1 class="v3-section-title" data-egroup="design">Appearance</h1>');
    expect(html).toContain('<div class="design-group-heading" data-egroup="design"><h2>Page design</h2></div>');
    // Brand text and links are owned by Site, so Appearance no longer
    // carries a "Content" group; it owns layout, blocks and prize labels.
    expect(html).not.toContain('<div class="design-group-heading" data-egroup="design"><h2>Content</h2></div>');
    expect(html).not.toContain('<div class="design-group-heading" data-egroup="design"><h2>Appearance</h2></div>');
    expect(html).not.toContain("<h2>Theme &amp; branding</h2>");
    expect(html).toContain("Public identity is managed in Site.");
    expect(html).toContain("Name, tagline, logo, colors and social links apply across every public page.");
    // Identity opens in place: an action button, not an <a> that leaves the
    // section (and trips the unsaved-changes guard).
    expect(html).toContain('class="btn btn--sm btn--accent" id="designBrandLink" type="button" data-identity-edit="true">Edit site identity</button>');
    expect(html).not.toContain('href="/dashboard/site">Edit site identity</a>');
    expect(html).toContain("Your current edits, rendered by the same renderer visitors see. Publish to put them live.");
  });

  it("keeps Games terminology and status copy singular", () => {
    expect(SECTIONS.games).toEqual({ path: "/dashboard/games", title: "Games" });
    expect(gamesJs).toContain('{ key: "limbo", label: "Limbo", description: "", disabled: true }');
    expect(gamesJs).toContain('<span class="v3-game-coming">Coming soon</span>');
  });

  it("announces the active audience insight tab", () => {
    expect(performanceJs).toContain('node.setAttribute("aria-current", "page")');
    expect(performanceJs).toContain('node.removeAttribute("aria-current")');
  });

  it("copies the live page URL from the editor Share tab", () => {
    expect(utilsJs).toContain('navigator.clipboard.writeText');
    expect(siteJs).toContain('const shareCopy = $("shareCopy")');
    expect(siteJs).toContain('copyToClipboard(publicUrl)');
  });

  it("matches the server's effective-plan OBS overlay gate", () => {
    expect(dashboardHtml("/dashboard/leaderboard/share")).toContain('id="embedObsLock"');
    expect(siteJs).toContain('const overlayAccess = state.ME?.plan !== "free"');
    expect(siteJs).toContain("obsLock.hidden = overlayAccess");
    expect(dashboardHtml("/dashboard/leaderboard/share")).toContain("Stream overlays are available on Pro and Team.");
    expect(dashboardHtml("/dashboard/leaderboard/share")).toContain('href="/dashboard/settings/billing?from=overlay"');
    expect(dashboardHtml("/dashboard/leaderboard/share")).toContain('>Upgrade your plan</a> to add this leaderboard to OBS, Streamlabs, or another streaming app.');
    expect(siteJs).not.toContain("obsLock.innerHTML");
    expect(workerIndex).toContain('const paid = r.plan !== "free"');
    const future = Date.now() + 86_400_000;
    for (const [plan, expected] of [["free", false], ["pro", true], ["team", true], ["starter", false], ["agency", false], ["lifetime", false]]) {
      expect(effectivePlan({ plan, status: "active", plan_expires_at: future }) !== "free").toBe(expected);
    }
  });

  it("organises navigation into a focused creator section list", () => {
    const html = dashboardHtml();
    expect(html).toContain('data-nav="home"');
    expect(html).toContain('data-nav="board"');
    expect(html).toContain('data-nav="settings"');
    expect(html).toContain('lb-side-group');
    // The rail is flat and task-worded — no grouping labels.
    expect(html).not.toContain("lb-nav-group");
    expect(html).not.toContain(">Community</div>");
    expect(html).not.toContain(">Current site</div>");
    expect(html).not.toContain('aria-hidden="true">🔌</span>');
    expect(html).toContain('>Home</a>');
    const sidebar = html.match(/<nav class="lb-side-group lb-side-nav"[\s\S]*?<\/nav>/)?.[0] || "";
    for (const label of [
      "Community", "Audience", "Engage", "Rewards", "Insights", "Telegram", "Settings",
    ]) expect(sidebar).toContain(`>${label}</a>`);
    for (const label of ["Sites", "Site", "Leaderboard", "People", "Stats", "Members", "Engagement", "Games", "Giveaways", "Raffles", "Predictions", "Drops", "Tournaments"]) {
      expect(sidebar).not.toContain(`>${label}</a>`);
    }
    expect(html).not.toContain(">Integrations</a>");
    expect(html).not.toContain(">All sites</a>");
    expect(html).not.toContain('>Help</a>');
  });

  it("activates only the section the URL addresses", () => {
    // The dashboard is a single document: every section ships in the markup so
    // navigation swaps them client-side without a reload. Only the addressed
    // section carries `is-on`; the rest are display:none (see dashboard-v4.css
    // `.lb-page:not(.is-on)`), so assistive tech only reaches the live one.
    const activePages = (html) =>
      [...html.matchAll(/<section class="(lb-page[^"]*)" data-page="([^"]+)"/g)]
        .filter((m) => /\bis-on\b/.test(m[1]))
        .map((m) => m[2]);

    const overview = dashboardHtml();
    expect(overview).toContain('data-page="home"');
    expect(overview).toContain('data-page="board"');
    expect(activePages(overview)).toEqual(["home"]);

    const games = dashboardHtml("/dashboard/games");
    expect(games).toContain('data-page="games"');
    expect(games).toContain('data-page="home"');
    expect(activePages(games)).toEqual(["games"]);
  });

  it("keeps every site editor section directly available", () => {
    const html = dashboardHtml("/dashboard/leaderboard");
    expect(html).toContain('data-page="board"');
    expect(html).toContain('id="savebar"');
    expect(html).toContain('class="design-grid"');
    expect(html).toContain('id="designPreview"');
    expect(html).toContain('class="editor-steps v3-tabs"');
    expect(html).toContain('data-egroup="setup"');
    expect(html).toContain('data-egroup="players"');
    expect(html).toContain('data-egroup="design"');
    expect(html).toContain('data-egroup="share"');
    expect(html).toContain('data-egroup="history"');
  });
});
