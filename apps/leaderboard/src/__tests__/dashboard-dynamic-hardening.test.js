// Hardening tests for the Phase 2 persistent-shell navigation.
//
// These tests pin the specific bugs found during the runtime verification pass
// and the race / lifecycle / auth behaviors the Phase 2 report claimed but
// did not previously cover with regression tests.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DYNAMIC_SECTIONS,
  dynamicPath,
  parseDynamicPath,
} from "../assets/dashboard/routes.js";

const dynamicJs = readFileSync(new URL("../assets/dashboard/dynamic-section.js", import.meta.url), "utf8");
const shellJs = readFileSync(new URL("../assets/dashboard/shell.js", import.meta.url), "utf8");
const sessionJs = readFileSync(new URL("../assets/dashboard/session.js", import.meta.url), "utf8");
const boardShellJs = readFileSync(new URL("../assets/dashboard/board-shell.js", import.meta.url), "utf8");
const creditsJs = readFileSync(new URL("../assets/credits.js", import.meta.url), "utf8");
const accountJs = readFileSync(new URL("../assets/account.js", import.meta.url), "utf8");
const giveawaysJs = readFileSync(new URL("../assets/giveaways.js", import.meta.url), "utf8");
const dashboardJs = readFileSync(new URL("../assets/dashboard.js", import.meta.url), "utf8");
const shellNavJs = readFileSync(new URL("../assets/shell-nav.js", import.meta.url), "utf8");

describe("auth-expiry during dynamic navigation", () => {
  it("redirects to login on a fragment 401 instead of showing a Retry button", () => {
    // A 401 from /dashboard/_content means the session expired. The old code
    // threw and showed "Couldn't load this section — Retry", which cannot fix
    // an expired session. The fix detects 401, clears the cached session, and
    // redirects to login.
    expect(dynamicJs).toContain("res.status === 401");
    expect(dynamicJs).toContain("clearSession()");
    expect(dynamicJs).toContain("loginRedirectPath(location)");
  });

  it("imports clearSession and loginRedirectPath in dynamic-section.js", () => {
    expect(dynamicJs).toMatch(/import.*clearSession.*from.*session\.js/);
    expect(dynamicJs).toMatch(/import.*loginRedirectPath.*from.*request\.js/);
  });

  it("clears the session cache on logout so the shell cannot appear authenticated", () => {
    // Logout is handled by the shared shell-nav.js script; it broadcasts a
    // localStorage stamp only after the server confirms the logout, and the
    // storage listener clears cached identity in other open tabs.
    expect(shellNavJs).toContain("localStorage.setItem(\"yr:logout\"");
    expect(dashboardJs).toMatch(/yr:logout.*clearSession/);
  });

  it("clears the session cache inside handleAuthError", () => {
    // When getMe()/getSites() reject with code AUTH, the cache must be dropped
    // before the redirect so a retrying caller cannot serve stale data.
    expect(sessionJs).toMatch(/handleAuthError[\s\S]*clearSession/);
  });
});

describe("stale-navigation race protection", () => {
  it("uses a nav token so a late-finishing boot cannot stomp a newer section", () => {
    expect(dynamicJs).toContain("let navToken = 0");
    expect(dynamicJs).toContain("const myToken = ++navToken");
    // The token is checked after the fetch resolves AND after the async import.
    expect(dynamicJs).toMatch(/myToken !== navToken[\s\S]*return false/);
  });

  it("aborts the previous in-flight fetch before starting a new one", () => {
    expect(dynamicJs).toContain("currentController.abort()");
    expect(dynamicJs).toContain("new AbortController()");
    expect(dynamicJs).toContain("signal: controller.signal");
  });

  it("treats AbortError as a superseded navigation, not a visible error", () => {
    expect(dynamicJs).toContain("AbortError");
    expect(dynamicJs).toMatch(/AbortError[\s\S]*return false/);
  });

  it("calls the previous section leave() before loading the next one", () => {
    // The previous section's teardown must run before the new fetch starts,
    // so timers and WebSockets from the old section do not overlap with the new.
    const loadFn = dynamicJs.slice(
      dynamicJs.indexOf("export async function loadDynamicSection"),
      dynamicJs.indexOf("showLocalLoading"),
    );
    expect(loadFn).toContain("currentController.abort()");
    expect(loadFn).toContain("currentLeave()");
  });
});

describe("lifecycle cleanup", () => {
  it("giveaways leave() closes the WebSocket and clears all intervals", () => {
    expect(giveawaysJs).toMatch(/giveawaysLeave[\s\S]*ws\.close/);
    expect(giveawaysJs).toMatch(/giveawaysLeave[\s\S]*clearInterval\(timerInterval\)/);
    expect(giveawaysJs).toMatch(/giveawaysLeave[\s\S]*clearInterval\(claimTimerInterval\)/);
    expect(giveawaysJs).toMatch(/giveawaysLeave[\s\S]*removeEventListener.*trapEventDrawerFocus/);
  });

  it("giveaways enter() resets state and re-initializes for fresh re-entry", () => {
    expect(giveawaysJs).toMatch(/giveawaysEnter[\s\S]*ws = null/);
    expect(giveawaysJs).toMatch(/giveawaysEnter[\s\S]*clearInterval\(timerInterval\)/);
    expect(giveawaysJs).toMatch(/giveawaysEnter[\s\S]*init\(\)/);
  });

  it("credits leave() clears status timers and destroys list controllers", () => {
    expect(creditsJs).toMatch(/export function leave[\s\S]*clearTimeout/);
    expect(creditsJs).toMatch(/export function leave[\s\S]*statusClearTimers/);
    expect(creditsJs).toMatch(/export function leave[\s\S]*viewerCtrl.*destroy/);
    expect(creditsJs).toMatch(/export function leave[\s\S]*redemptionCtrl.*destroy/);
    expect(creditsJs).toMatch(/export function leave[\s\S]*rewardCtrl.*destroy/);
  });

  it("credits enter() resets wired flag and module state for re-entry", () => {
    expect(creditsJs).toMatch(/export function enter[\s\S]*wired = false/);
    expect(creditsJs).toMatch(/export function enter[\s\S]*state = \{\}/);
    expect(creditsJs).toMatch(/export function enter[\s\S]*activeSiteId = ""/);
  });

  it("account leave() removes the popstate listener it installed", () => {
    // Account's wireUnifiedSettingsTabs adds a window popstate listener.
    // Without teardown, repeated enter/leave cycles stack duplicate handlers.
    expect(accountJs).toContain("_accountPopstate");
    expect(accountJs).toMatch(/leave[\s\S]*removeEventListener.*popstate.*_accountPopstate/);
  });

  it("account enter() re-initializes against the fresh fragment DOM", () => {
    expect(accountJs).toMatch(/export function enter[\s\S]*init\(\)/);
  });
});

describe("site context persistence", () => {
  it("sitePath falls back to the shell's ACTIVE_SITE_ID when the URL has no ?siteId=", () => {
    // The command palette navigates with { query: "" }, stripping ?siteId=
    // from the URL. Without the fallback, sitePath() would produce unscoped
    // API calls and the section could silently load the first site's data.
    expect(boardShellJs).toMatch(/sitePath[\s\S]*state\.ACTIVE_SITE_ID/);
  });

  it("loadBoardShell falls back to state.ACTIVE_SITE_ID when siteQuery is empty", () => {
    expect(boardShellJs).toMatch(/siteQuery\(\) \|\| state\.ACTIVE_SITE_ID/);
  });

  it("credits applyOAuthContext falls back to dashboardState.ACTIVE_SITE_ID", () => {
    expect(creditsJs).toMatch(/applyOAuthContext[\s\S]*dashboardState\.ACTIVE_SITE_ID/);
  });
});

describe("focus management after route change", () => {
  it("moves focus to the new section heading after dynamic load", () => {
    // After a fragment loads, keyboard and screen-reader users must arrive
    // at the content, not stranded on the sidebar link they activated.
    expect(dynamicJs).toContain("tabindex");
    expect(dynamicJs).toContain("heading.focus");
    // Focus is only moved when the token matches (not for stale responses).
    expect(dynamicJs).toMatch(/myToken === navToken[\s\S]*heading/);
  });
});

describe("popstate query preservation", () => {
  it("passes the query string to loadDynamicSection in the popstate handler", () => {
    // Back/forward to a URL with ?edit= or ?siteId= must preserve that query
    // so the fragment fetch and boot module receive the right context.
    expect(shellJs).toMatch(/popstate[\s\S]*loadDynamicSection[\s\S]*query: location\.search/);
  });
});

describe("delegated click handler safety", () => {
  it("does not hijack modifier-clicks, new-tab links, downloads, or external links", () => {
    const handler = shellJs.slice(
      shellJs.indexOf('Catch-all for internal dashboard links'),
      shellJs.indexOf("});\n}", shellJs.indexOf('Catch-all for internal dashboard links')),
    );
    // Modifier keys (Ctrl/Cmd/Shift/Alt) must be ignored.
    expect(handler).toContain("e.metaKey");
    expect(handler).toContain("e.ctrlKey");
    expect(handler).toContain("e.shiftKey");
    expect(handler).toContain("e.altKey");
    // Only left-click (button 0).
    expect(handler).toContain("e.button !== 0");
    // New-tab and download links must load normally.
    expect(handler).toContain('target === "_blank"');
    expect(handler).toContain("download");
    // External/protocol-relative links must not be intercepted.
    expect(handler).toContain('href.startsWith("//")');
    expect(handler).toContain("url.origin !== location.origin");
    // Already-handled links (defaultPrevented) must be skipped.
    expect(handler).toContain("e.defaultPrevented");
  });

  it("lets Telegram and unsupported routes fall through to normal navigation", () => {
    // parseDynamicPath and parseDashboardPath both return null for
    // /dashboard/telegram, so the handler returns without preventDefault.
    expect(parseDynamicPath("/dashboard/telegram")).toBeNull();
  });
});

describe("session cache correctness", () => {
  it("clears the mePromise on fetch failure so the next call retries", () => {
    expect(sessionJs).toMatch(/getMe[\s\S]*mePromise = null[\s\S]*throw err/);
  });

  it("clears the sitesPromise on fetch failure so the next call retries", () => {
    expect(sessionJs).toMatch(/getSites[\s\S]*sitesPromise = null[\s\S]*throw err/);
  });

  it("refreshSites clears the sites cache for forced re-fetch", () => {
    expect(sessionJs).toContain("refreshSites");
    expect(sessionJs).toMatch(/refreshSites[\s\S]*sitesPromise = null/);
  });

  it("clearSession drops both cached promises", () => {
    expect(sessionJs).toMatch(/clearSession[\s\S]*mePromise = null/);
    expect(sessionJs).toMatch(/clearSession[\s\S]*sitesPromise = null/);
  });
});

describe("direct load / fragment parity", () => {
  it("every dynamic tab resolves on both the client and the server", () => {
    // This is already pinned in dashboard-dynamic-routing.test.js, but we
    // re-assert the core invariant here so the hardening file is self-contained.
    for (const [page, section] of Object.entries(DYNAMIC_SECTIONS)) {
      for (const tab of section.tabs) {
        const path = dynamicPath(page, tab);
        expect(path, `${page}/${tab}`).toBeTruthy();
        expect(parseDynamicPath(path), `${path}`).toEqual({ page, tab, dynamic: true });
      }
    }
  });
});

describe("account team scope", () => {
  it("derives the managed site from the team list and includes it in every team mutation", () => {
    expect(accountJs).toContain('let teamSiteId = state.ACTIVE_SITE_ID || "";');
    expect(accountJs).toContain('if (data?.siteId) teamSiteId = data.siteId;');
    expect(accountJs).toContain('"/api/site/team/role", { targetUserId, role: newRole, siteId: teamSiteId }');
    expect(accountJs).toContain('"/api/site/team/remove", { targetUserId, siteId: teamSiteId }');
    expect(accountJs).toContain('"/api/site/team/invite/revoke", { inviteId, siteId: teamSiteId }');
    expect(accountJs).toContain('"/api/site/team/invite", { email, role, siteId: teamSiteId }');
  });
});
