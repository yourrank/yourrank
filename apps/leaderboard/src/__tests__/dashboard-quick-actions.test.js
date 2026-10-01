import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { PAGES } from "../pages.jsx";
import { effectivePlan } from "@yourrank/shared/plans";
import { buildHomeViewModel } from "../assets/dashboard/overview.js";
import { SETUP_STEPS, setupStepHref } from "../assets/dashboard/overview-state.js";

const siteJs = readFileSync(new URL("../assets/dashboard/site.js", import.meta.url), "utf8");
const utilsJs = readFileSync(new URL("../assets/dashboard/utils.js", import.meta.url), "utf8");
const overviewJs = readFileSync(new URL("../assets/dashboard/overview.js", import.meta.url), "utf8");
const overviewPage = readFileSync(new URL("../react/pages/overview/page.tsx", import.meta.url), "utf8");
const dashboardJs = readFileSync(new URL("../assets/dashboard.js", import.meta.url), "utf8");
const boardShellJs = readFileSync(new URL("../assets/dashboard/board-shell.js", import.meta.url), "utf8");
const performanceJs = readFileSync(new URL("../assets/dashboard/performance.js", import.meta.url), "utf8");
const dashboardCss = readFileSync(new URL("../assets/dashboard-v4.css", import.meta.url), "utf8");
const workerIndex = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const quickActionsJs = readFileSync(new URL("../assets/dashboard/quick-actions.js", import.meta.url), "utf8");

function dashboardHtml(activePath = "/dashboard") {
  return PAGES.dashboard.Component({ activePath }).toString();
}

describe("dashboard overview quick actions", () => {
  it("adds a site-aware tournament action to the global New menu", () => {
    const html = dashboardHtml();
    expect(html).toMatch(/data-new="drop"[^>]*>New drop<\/a>[\s\S]*data-new="tournament"[^>]*href="\/dashboard\/giveaways\/tournaments\?new=1">New tournament<\/a>/);
    expect(quickActionsJs).toContain('tournament: `/dashboard/giveaways/tournaments?new=1${sid ? `&siteId=${encodeURIComponent(sid)}` : ""}`');
    expect(quickActionsJs).toContain('new CustomEvent("yr:quick-new"');
    expect(quickActionsJs).toContain('detail: { kind: link.dataset.new }');
    expect(quickActionsJs).toContain("cancelable: true");
    expect(quickActionsJs).toContain("if (quickNewEvent.defaultPrevented) event.preventDefault()");
  });

  it("puts the main tasks one click from the Overview", () => {
    const html = dashboardHtml();
    expect(html).toContain('<div id="ov-app" class="yr-react">');
    expect(html).toContain("Checking…");
    expect(html).toContain("Your community at a glance.");
    expect(html).toContain('id="ovSetupMessage"');
    expect(html).not.toContain('id="ovActiveGiveaway"');
    expect(html).not.toContain("Times shared");
    for (const id of ["ovAttention", "ovLiveNow", "ovComingNext", "ovPulse", "ovRecent", "ovQuickActions", "ovSetup"]) {
      expect(html).toContain(`id="${id}"`);
      expect(overviewPage).toContain(`id="${id}"`);
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
    expect(overviewPage).toContain('className="ov-figures" id="ovFigures" aria-label="Community pulse"');
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
    const sectionOrder = ["ovAttention", "ovLiveNow", "ovComingNext", "ovPulse", "ovRecent", "ovQuickActions", "ovSetup"]
      .map((id) => html.indexOf(`id="${id}"`));
    expect(sectionOrder.every((position) => position >= 0)).toBe(true);
    expect(sectionOrder).toEqual([...sectionOrder].sort((left, right) => left - right));
    expect(html).toMatch(/id="ovSetup"[^>]*\shidden(?:="[^"]*")?(?:\s|>)/);
    expect(html).not.toContain("Active giveaways");
    expect(overviewJs).toContain("sourceState.CREDITS?.usage?.pendingRedemptions");
    expect(overviewJs).toContain("sourceState.CREDITS?.channel || null");
    expect(overviewPage).toContain('id="ovAttentionList"');
    expect(overviewPage).toContain('id="ovAttentionCount"');
    expect(overviewPage).toContain('role="region" aria-live="polite" aria-atomic="false" hidden={vm.attention.hidden}');
    expect(overviewPage).toContain('data-setup-state={step.stateKey}');
    expect(overviewJs).toContain('"owner-action"');
    expect(overviewJs).not.toContain("GIVEAWAYS_STATUS");
    expect(overviewPage).toContain('className="v3-empty v3-empty--compact-heading"');
    expect(overviewJs).not.toContain("ov_topEmpty");
  });

  it("keeps one owner for the Home body and its data", () => {
    const html = dashboardHtml();
    for (const marker of [/data-page="home"/g, /id="ov-app"/g]) {
      expect(html.match(marker)).toHaveLength(1);
    }
    for (const id of ["ovFigures", "ovActivityList", "ovQuickActionsList"]) {
      expect(html.match(new RegExp(`id="${id}"`, "g"))).toHaveLength(1);
      expect(overviewPage).toContain(`id="${id}"`);
    }
    // overview-state.js owns projections, overview.js publishes the serializable
    // view model, and the React island owns Home markup.
    expect(overviewJs).toContain("renderOverviewSummary");
    for (const projection of ["attentionItems(", "liveNowItems(", "comingNextItems(", "pulseMetrics(", "recentActivityItems(", "quickActions(", "setupProgress("]) {
      expect(overviewJs).toContain(projection);
    }
    expect(overviewPage).toContain("v3-skel-kpi");
    expect(overviewPage).toContain("ov-live-row--skeleton");
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
    const vm = buildHomeViewModel({
      state: {
        ACTIVE_SITE_ID: "site-1",
        SLUG: "night-owls",
        BOARDS: [{ id: "site-1", name: "Night Owls", userRole: "owner" }],
        ME: { emailVerified: false },
        CREDITS: { usage: { pendingRedemptions: 0 }, channel: null },
      },
      status: { live: false, published: true, emailVerified: false },
      steps: { brand: true, players: true, publish: true },
    });
    expect(vm.setup).toMatchObject({
      hidden: false,
      attention: true,
      title: "Confirm your email to go live",
      action: { href: "/verify-email", label: "Confirm email", publicationAction: false },
    });
    expect(vm.attention.items.filter((item) => item.key === "verifyEmail")).toHaveLength(1);
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
    expect(html).toContain('<div class="design-group-heading" data-egroup="design"><h2>Leaderboard design</h2></div>');
    // Branding is owned by Appearance itself: a Brand group holds name,
    // tagline, logo, banner and accent above the leaderboard design groups.
    expect(html).toContain('<div class="design-group-heading" data-egroup="design"><h2>Brand</h2></div>');
    expect(html).not.toContain('<div class="design-group-heading" data-egroup="design"><h2>Content</h2></div>');
    expect(html).not.toContain('<div class="design-group-heading" data-egroup="design"><h2>Appearance</h2></div>');
    expect(html).not.toContain("<h2>Theme &amp; branding</h2>");
    // No owner note sends creators elsewhere for branding anymore.
    expect(html).not.toContain("Public identity is managed in Site");
    expect(html).not.toContain("data-identity-edit");
    expect(html).not.toContain('href="/dashboard/site">Edit site identity</a>');
    expect(html).toContain("Your current edits, rendered by the same renderer visitors see. Publish to put them live.");
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
    expect(dashboardHtml("/dashboard/leaderboard/share")).toContain("The branded live overlay is available on Starter and above.");
    expect(dashboardHtml("/dashboard/leaderboard/share")).toContain('href="/dashboard/settings/billing?from=overlay"');
    expect(dashboardHtml("/dashboard/leaderboard/share")).toContain('>Get Starter</a> to add this leaderboard to OBS, Streamlabs, or another streaming app.');
    expect(siteJs).toContain('checkout("starter", event.currentTarget)');
    expect(siteJs).not.toContain("obsLock.innerHTML");
    expect(workerIndex).toContain('if (!canUseFeature(r.plan, "advanced_overlays"))');
    const future = Date.now() + 86_400_000;
    for (const [plan, expected] of [["free", false], ["starter", true], ["pro", true], ["team", true], ["agency", false], ["lifetime", false]]) {
      expect(effectivePlan({ plan, status: "active", plan_expires_at: future }) !== "free").toBe(expected);
    }
  });

  it("organises navigation into a focused creator section list", () => {
    const html = dashboardHtml();
    expect(html).toContain('data-nav="home"');
    expect(html).toContain('data-nav="board"');
    expect(html).toContain('data-nav="settings"');
    expect(html).toContain('lb-side-group');
    // Engage is the sole collapsible branch; the other roots stay flat.
    expect((html.match(/data-nav-group=/g) || []).length).toBe(1);
    expect(html).toContain('data-nav-group="engage"');
    expect(html).not.toContain(">Community</div>");
    expect(html).not.toContain(">Current site</div>");
    expect(html).not.toContain('aria-hidden="true">🔌</span>');
    expect(html).toContain('<span class="lb-nav-label">Home</span>');
    const sidebar = html.match(/<nav class="lb-side-group lb-side-nav"[\s\S]*?<\/nav>/)?.[0] || "";
    for (const label of [
      "Community", "Audience", "Engage", "Tournaments", "Giveaways", "Rewards", "Insights", "Telegram", "Settings",
    ]) expect(sidebar).toContain(`<span class="lb-nav-label">${label}</span>`);
    for (const label of ["Sites", "Site", "Leaderboard", "People", "Stats", "Members", "Engagement", "Drops"]) {
      expect(sidebar).not.toContain(`<span class="lb-nav-label">${label}</span>`);
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
