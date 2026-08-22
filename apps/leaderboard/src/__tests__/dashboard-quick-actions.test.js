import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { PAGES } from "../pages.jsx";
import { effectivePlan } from "@yourrank/shared/plans";
import { activityEmptyAction, giveawayAction, nextStepAction } from "../assets/dashboard/overview-state.js";

const siteJs = readFileSync(new URL("../assets/dashboard/site.js", import.meta.url), "utf8");
const utilsJs = readFileSync(new URL("../assets/dashboard/utils.js", import.meta.url), "utf8");
const overviewJs = readFileSync(new URL("../assets/dashboard/overview.js", import.meta.url), "utf8");
const gamesJs = readFileSync(new URL("../assets/dashboard/games.js", import.meta.url), "utf8");
const routesJs = readFileSync(new URL("../assets/dashboard/routes.js", import.meta.url), "utf8");
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
    expect(html).toContain('id="ovActiveGiveaway"');
    expect(html).toContain('id="ovCreditsUsed"');
    expect(html).not.toContain("Times shared");
    expect(html).toContain('id="ovActivityList"');
    expect(html).toContain('id="ovTopPlayers"');
    expect(html).not.toContain('class="ov-summary"');
    expect(html).toContain('id="ovPublishedStatus"');
    expect(html).toContain('id="ovPublicSiteAction"');
    expect(html).toContain("View public leaderboard ↗");
    expect(html).toContain('href="/dashboard/leaderboard/setup"');
    expect(html).toContain('class="ov-card-empty" id="ovActivityEmpty"');
    expect(html).toContain('id="ovCreditsCard" hidden');
    expect(html).toContain('id="ovPendingOrdersCard" hidden');
    expect(html).toContain('href="/dashboard/rewards/redemptions"');
    expect(html).toContain('id="ovKpiRow"');
  });

  it("models Home setup as an accessible four-step launch checklist", () => {
    const html = dashboardHtml();
    const setupDefinition = overviewJs.slice(overviewJs.indexOf("const SETUP_STEPS"), overviewJs.indexOf("function isBoardSetup"));
    const setupKeys = [...setupDefinition.matchAll(/key: "([^"]+)"/g)].map((match) => match[1]);
    expect(setupKeys).toEqual(["brand", "players", "configure", "publish"]);
    expect(setupDefinition).not.toContain('key: "kick"');
    expect(html).toContain('id="ovLblGiveaway">Active giveaway</span>');
    expect(html).toContain('id="ovLblCredits">Credits used</span>');
    expect(html).toContain('id="ovCreditsCard" hidden');
    expect(overviewJs).toContain("state.CREDITS?.usage?.pendingRedemptions");
    expect(overviewJs).toContain('pendingOrders === 1 ? "pending order needs review." : "pending orders need review."');
    expect(overviewJs).toContain('pendingOrders === 1 ? "Review order" : "Review orders"');
    expect(dashboardHtml()).toContain('id="ovPendingOrdersAlertLabel">pending orders need review.</span>');
    expect(dashboardHtml()).toContain('id="ovPendingOrdersAction"');
    expect(html).toContain('id="ovKpiRow"');
  });

  it("keeps the giveaway KPI action aligned with every active-count state", () => {
    expect(giveawayAction(0)).toEqual({ label: "Create giveaway", href: "/dashboard/giveaways" });
    expect(giveawayAction(1)).toEqual({ label: "Review activity", href: "/dashboard/giveaways" });
    expect(giveawayAction(12)).toEqual({ label: "Review activity", href: "/dashboard/giveaways" });
  });

  it("names one contextual next step and lets dedicated surfaces keep their own", () => {
    // Setup, verification and pending orders already have dedicated Home
    // surfaces, so the card must not repeat them.
    const setupComplete = { brand: true, players: true, publish: true };
    expect(nextStepAction({ status: { published: false, emailVerified: true }, steps: {} }).key).toBe("brand");
    expect(nextStepAction({ status: { published: false, emailVerified: true }, steps: { brand: true } }).key).toBe("players");
    expect(nextStepAction({ status: { published: false, emailVerified: true }, steps: { brand: true, players: true } }).key).toBe("publish");
    expect(nextStepAction({ status: { published: true, emailVerified: false }, steps: setupComplete }).key).toBe("verifyEmail");
    expect(nextStepAction({ status: { published: true, emailVerified: true }, steps: setupComplete, pendingOrders: 2 }).key).toBe("pendingOrders");

    // These have no other owner on Home, so the card speaks for them.
    const live = { status: { published: true, emailVerified: true }, steps: setupComplete };
    expect(nextStepAction({ ...live, creditsEnabled: true, creditsStatus: "ready", creditsConnected: false }).key).toBe("connectKick");
    expect(nextStepAction({ ...live, creditsEnabled: true, creditsStatus: "ready", creditsConnected: true, rewardMappings: 0 }).key).toBe("addReward");
    expect(nextStepAction({ ...live, hasActivity: false, visits: 0 }).key).toBe("shareSite");
    expect(nextStepAction({ ...live, hasActivity: false, visits: 4, giveawayStatus: "ready", activeGiveaways: 0 }).key).toBe("createGiveaway");

    // A healthy, active site is told nothing at all.
    expect(nextStepAction({ ...live, hasActivity: true, visits: 40, giveawayStatus: "ready", activeGiveaways: 1 })).toBeNull();
    // Unresolved async state must not produce a premature instruction.
    expect(nextStepAction({ ...live, hasActivity: true, visits: 40, creditsEnabled: true, creditsStatus: "loading", giveawayStatus: "loading" })).toBeNull();
  });

  it("renders the next step card and suppresses steps another surface owns", () => {
    const html = dashboardHtml();
    expect(html).toContain('id="ovNextStep"');
    expect(html).toContain('id="ovNextStepTitle"');
    expect(html).toContain('id="ovNextStepAction"');
    // Starts hidden so it never flashes generic copy before state resolves.
    expect(html).toMatch(/id="ovNextStep"[^>]*hidden/);
    // Labelled for assistive tech rather than relying on visual order.
    expect(html).toContain('aria-labelledby="ovNextStepTitle"');
    expect(overviewJs).toContain("NEXT_STEP_OWNED_ELSEWHERE");
    for (const key of ["verifyEmail", "brand", "players", "publish", "pendingOrders"]) {
      expect(overviewJs).toContain(`"${key}"`);
    }
    expect(overviewJs).toContain("nextStepAction(");
    expect(dashboardCss).toContain(".ov-next-step");
  });

  it("matches the empty activity action to publication state", () => {
    expect(activityEmptyAction(false)).toEqual({ label: "Publish your site", href: "/dashboard/leaderboard/setup" });
    expect(activityEmptyAction(true)).toEqual({ label: "Share your site", href: "/dashboard/leaderboard/share" });
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
    expect(boardShellJs).toContain('`/dashboard/leaderboards?board=${encodeURIComponent(siteId)}`');
    expect(boardShellJs).toContain('target.pathname.startsWith("/dashboard/leaderboard/")');
    expect(boardShellJs).toContain('target.searchParams.set("board", siteId)');
    expect(boardShellJs).toContain('target.searchParams.set("siteId", siteId)');
  });

  it("reports public site availability truthfully from Credits", () => {
    expect(boardShellJs).toContain("Boolean(board.published) && user.emailVerified !== false");
    expect(boardShellJs).toContain('live ? "Live" : pendingVerification ? "Verification needed" : "Not live"');
    expect(boardShellJs).toContain('pendingVerification ? "/verify-email"');
    expect(boardShellJs).toContain('publicLink.textContent = "View site ↗"');
    expect(boardShellJs).toContain('publicLink.textContent = pendingVerification ? "Verify email" : "Publish site"');
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
    expect(dashboardCss).toMatch(/\.v3-dash\[data-auth-workspace\] \.plan-usage-row \{[\s\S]*?background: var\(--v4-surface\);/);
    expect(dashboardCss).toMatch(/\.v3-dash\[data-auth-workspace\] \.plan-pending,[\s\S]*?\.v3-dash\[data-auth-workspace\] \.plan-cancel \{[\s\S]*?background: var\(--v4-surface-soft\);/);
  });

  it("styles the Home alert and block status rows in the v4 workspace", () => {
    expect(dashboardCss).toContain(".v3-dash[data-auth-workspace] .v3-alert");
    expect(dashboardCss).toContain(".v3-dash[data-auth-workspace] .v3-alert--warning");
    expect(dashboardCss).toContain(".v3-dash[data-auth-workspace] .v3-block-status");
    expect(dashboardHtml()).toContain('class="v3-alert v3-alert--warning"');
    // Public-section visibility is a site setting: Games defers to Site
    // settings → Sections instead of owning the toggles itself.
    const games = dashboardHtml("/dashboard/games");
    expect(games).toContain("Public page visibility");
    expect(games).toContain("Manage public sections in Site settings →");
    expect(games).not.toContain("Page block visibility");
    expect(games).not.toContain("Choose which blocks appear on your leaderboard page");
    const site = dashboardHtml("/dashboard/site");
    expect(site).toContain("Public page sections");
    expect(site).toContain('id="siteSectionRows"');
    expect(site).toContain("Leaderboard page blocks");
    expect(site).toContain("Current block visibility on your leaderboard page");
    expect(site).toContain("Edit layout &amp; blocks in Appearance →");
  });

  it("keeps authenticated cards on the v4 geometry without changing public cards", () => {
    expect(dashboardCss).toMatch(/\.v3-dash\[data-auth-workspace\] \.card \{[\s\S]*?padding: 24px;[\s\S]*?margin-top: 0;[\s\S]*?transition: none;/);
    expect(dashboardCss).toContain(".v3-dash[data-auth-workspace] .card:hover { border-color: var(--v4-line); }");
    expect(dashboardCss).toContain(".v3-dash[data-auth-workspace] .ov-live-grid { display: grid;");
    expect(dashboardCss).toContain("gap: 16px; }");
    expect(dashboardCss).not.toContain(".v3-dash[data-auth-workspace] .ov-live-grid { display: grid; grid-template-columns: minmax(0, 8fr) minmax(280px, 4fr); gap: 0; overflow: hidden;");
  });

  it("labels Appearance editor groups by the content they contain", () => {
    const html = dashboardHtml("/dashboard/leaderboard/design");
    expect(html).toContain('<h1 class="v3-section-title" data-egroup="design">Appearance</h1>');
    expect(html).toContain('<div class="design-group-heading" data-egroup="design"><h2>Page design</h2></div>');
    expect(html).toContain('<div class="design-group-heading" data-egroup="design"><h2>Content</h2></div>');
    expect(html).not.toContain('<div class="design-group-heading" data-egroup="design"><h2>Appearance</h2></div>');
    expect(html).not.toContain("<h2>Theme &amp; branding</h2>");
  });

  it("keeps Games terminology and status copy singular", () => {
    expect(routesJs).toContain('games: { path: "/dashboard/games", title: "Games" }');
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
    expect(siteJs).toContain('obsLink.textContent = overlayAccess ? obsUrl : ""');
    expect(siteJs).toContain("obsBox.hidden = !overlayAccess");
    expect(siteJs).toContain("obsLock.hidden = overlayAccess");
    expect(dashboardHtml("/dashboard/leaderboard/share")).toContain("Stream overlays are available on Starter and higher plans.");
    expect(dashboardHtml("/dashboard/leaderboard/share")).toContain('href="/dashboard/settings/billing?from=overlay"');
    expect(dashboardHtml("/dashboard/leaderboard/share")).toContain('>Upgrade your plan</a> to add this leaderboard to OBS, Streamlabs, or another streaming app.');
    expect(siteJs).toContain("if (overlayAccess && obsCopy && !obsCopy._wired)");
    expect(siteJs).not.toContain("obsLock.innerHTML");
    expect(workerIndex).toContain('const paid = r.plan !== "free"');
    const future = Date.now() + 86_400_000;
    for (const [plan, expected] of [["free", false], ["starter", true], ["pro", true], ["agency", true], ["lifetime", false]]) {
      expect(effectivePlan({ plan, status: "active", plan_expires_at: future }) !== "free").toBe(expected);
    }
  });

  it("organises navigation into a focused creator section list", () => {
    const html = dashboardHtml();
    expect(html).toContain('data-nav="home"');
    expect(html).toContain('data-nav="board"');
    expect(html).toContain('data-nav="settings"');
    expect(html).toContain('lb-side-group');
    // The rail has exactly one scope group: "Current site". Everything outside
    // it (Home, Sites, Telegram, Account) is account-global or manages the
    // whole site collection. Group labels are hierarchy, not links.
    expect(html).toContain("lb-nav-group");
    expect(html).toContain(">Current site</div>");
    expect(html).not.toContain(">Your site</div>");
    expect(html).not.toContain(">Settings</div>");
    expect(html).not.toContain('aria-hidden="true">🔌</span>');
    expect(html).toContain('>Home</a>');
    for (const label of [
      "Leaderboard", "Engagement", "Games", "Rewards", "Audience", "Telegram", "Analytics", "Site settings", "Account",
    ]) expect(html).toContain(`>${label}</a>`);
    for (const label of ["Giveaways", "Raffles", "Predictions", "Drops"]) {
      expect(html).not.toContain(`>${label}</a>`);
    }
    expect(html).not.toContain(">Integrations</a>");
    expect(html).toContain(">Sites</a>");
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
