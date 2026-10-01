import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  UNKNOWN,
  emptyStateHtml,
  metricText,
} from "../assets/dashboard/states.js";
import { pulseMetrics } from "../assets/dashboard/overview-state.js";
import { PAGES } from "../pages.jsx";

const assets = path.resolve(import.meta.dir, "../assets");
const read = (file) => fs.readFileSync(path.join(assets, file), "utf8");

function runWatchdogError(event) {
  const listeners = {};
  const classes = [];
  const surface = {
    hidden: true,
    innerHTML: "",
    classList: { add: (className) => classes.push(className) },
    querySelector: () => null,
  };
  const window = {
    addEventListener: (name, listener) => {
      listeners[name] = listener;
    },
  };
  const document = {
    getElementById: (id) => id === "gw-app" ? surface : null,
  };
  const location = {
    origin: "https://yourrank.site",
    href: "https://yourrank.site/dashboard",
  };
  const watchdog = new Function(
    "window",
    "document",
    "location",
    "setTimeout",
    "clearTimeout",
    read("dashboard-boot-watchdog.js"),
  );
  watchdog(window, document, location, () => 1, () => {});
  listeners.error(event);
  return { surface, classes };
}

describe("dashboard loading states", () => {
  it("announces the initial dashboard and credits loaders", () => {
    const dashboardHtml = PAGES.dashboard.Component({ activePath: "/dashboard" }).toString();
    const creditsHtml = PAGES.rewardsRedemptions.Component({}).toString();
    const rewardsPage = fs.readFileSync(path.resolve(assets, "../react/pages/rewards/page.tsx"), "utf8");
    expect(dashboardHtml).toContain('id="loading" class="yr-workspace-loader" role="status"');
    expect(dashboardHtml).toContain('id="loadingStatus">Loading your workspace');
    expect(dashboardHtml).toContain('class="yr-loader-track"');
    expect(dashboardHtml).toContain('aria-busy="true"');
    expect(creditsHtml).toContain('id="cr-loading" class="ui-loading" role="status"');
    expect(creditsHtml).toContain("Loading rewards");
    expect(PAGES.dashboard.config.bootWatchdog).toBe(true);
    expect(PAGES.rewardsRedemptions.config.bootWatchdog).toBe(true);
    expect(read("dashboard.js")).toContain("window.__yrBoot?.signal()");
    expect(rewardsPage).toContain("__yrBoot?.signal?.()");
  });
  it("keeps loading, ready zero, and unknown values distinct", () => {
    expect(UNKNOWN).toBe("—");
    expect(metricText("loading", 0)).toBe("");
    expect(metricText("ready", 0)).toBe("0");
    expect(metricText("ready", "0.0%")).toBe("0.0%");
    expect(metricText("error")).toBe("—");
  });

  it("keeps Home pulse figures unresolved until the Insights window arrives", () => {
    // No payload yet: a labelled range and no metrics, so nothing paints a zero.
    expect(pulseMetrics(null)).toEqual({ rangeLabel: "Last 30 days", metrics: [] });
    const ready = pulseMetrics({ window: { effectiveDays: 30 }, community: { newMembers: 0 }, participation: { participants: 0 }, rewards: { claimsCompleted: 0 } });
    expect(ready.metrics.map((metric) => metric.value)).toEqual([0, 0, 0]);
  });

  it("generates the shared empty state with optional actions", () => {
    const html = emptyStateHtml({
      icon: "chart",
      title: "Nothing here",
      body: "Try again later.",
      actions: [{ label: "Create board", href: "/dashboard/leaderboards", accent: true }],
    });
    expect(html).toContain("v3-empty");
    expect(html).toContain("Nothing here");
    expect(html).toContain('href="/dashboard/leaderboards"');
    expect(html).toContain("Create board");
  });

  it("does not seed asynchronous surfaces with invented values", () => {
    const page = fs.readFileSync(path.resolve(assets, "../pages/dashboard.jsx"), "utf8");
    expect(page).not.toMatch(/id="(?:ovPendingRedemptions|ovViews14|ovCopies14|perfKpiViews|perfKpiClicks|perfKpiCopies|perfKpiCtr)">[–—]/);
    expect(page).not.toMatch(/id="perfTotalViews">0</);
    expect(read("dashboard/games.js")).not.toContain("renderGames([])");
  });

  it("does not link to disabled public Games pages", () => {
    const games = read("dashboard/games.js");
    expect(games).toContain('previewBtn.removeAttribute("href")');
    expect(games).toContain('previewBtn.setAttribute("aria-disabled", "true")');
    expect(games).toContain('previewBtn.textContent = "Enable Games to open the public page"');
    expect(games).toContain("updateSimulator();");
  });

  it("tracks request status around dashboard fetches", () => {
    const site = read("dashboard/site.js");
    const account = read("dashboard/account.js");
    const games = read("dashboard/games.js");
    const performance = read("dashboard/performance.js");
    expect(site).toContain("setState({ STATS_STATUS: \"loading\" })");
    expect(site).toContain("setState({ STATS: s, STATS_STATUS: \"ready\" })");
    expect(site).toContain("setState({ CREDITS_STATUS: \"loading\" })");
    expect(site).toContain("setState({ USAGE_STATUS: \"loading\" })");
    expect(account).toContain("setState({ SESSIONS_STATUS: \"loading\" })");
    expect(games).toContain("setState({ GAMES_STATUS: \"loading\" })");
    expect(performance).toContain("setState({ HEATMAP_STATUS: \"loading\" })");
  });

  it("does not coerce credits payload fields to zero before resolution", () => {
    const rewardsPage = fs.readFileSync(path.resolve(assets, "../react/pages/rewards/page.tsx"), "utf8");
    expect(rewardsPage).toContain('value={loading ? "—" : String(summary.periodEarned ?? 0)}');
    expect(rewardsPage).toContain('numberOr(usage.shopItems, "—")');
    expect(rewardsPage).not.toMatch(/usage\.[A-Za-z0-9_]+ \|\| 0/);
    expect(rewardsPage).not.toMatch(/limits\.[A-Za-z0-9_]+ \|\| 0/);
  });

  it("uses loading and confirmed-empty treatments on Rewards and Audience lists", () => {
    const utils = read("dashboard/utils.js");
    const audiencePage = fs.readFileSync(path.resolve(assets, "../react/pages/audience/page.tsx"), "utf8");
    const rewardsPage = fs.readFileSync(path.resolve(assets, "../react/pages/rewards/page.tsx"), "utf8");
    expect(utils).toContain("setRowsLoading");
    expect(utils).toContain("renderEmpty(this.emptyEl, this.emptySpec)");
    expect(rewardsPage).toContain('loading ? <div role="status" aria-live="polite" aria-busy="true"');
    expect(rewardsPage).toContain('all: { title: "No claims yet"');
    expect(audiencePage).toContain('function LoadingRows(');
    expect(audiencePage).toContain('id="cr-viewer-empty"');
    expect(audiencePage).toContain('id="cr-history-feed-empty"');
  });

  it("resets error presentation before retrying into a normal empty state", () => {
    const performance = read("dashboard/performance.js");
    expect(performance).toMatch(/clearLoadError\(empty, false\);\s*renderEmpty\(empty/);
    expect(performance).toContain('setMetricValue(total, String(values.reduce');
  });

  it("keeps audience insight tabs accessible after client navigation", () => {
    const performance = read("dashboard/performance.js");
    expect(performance).toContain('node.setAttribute("aria-current", "page")');
    expect(performance).toContain('node.removeAttribute("aria-current")');
  });

  it("keeps Audience and Rewards load failures plain and retryable", () => {
    const audiencePage = fs.readFileSync(path.resolve(assets, "../react/pages/audience/page.tsx"), "utf8");
    const rewardsPage = fs.readFileSync(path.resolve(assets, "../react/pages/rewards/page.tsx"), "utf8");
    expect(audiencePage).toContain('title="Couldn\'t load members"');
    expect(audiencePage).toContain('body="People for the selected site could not be loaded."');
    expect(audiencePage).toContain('onRetry={() => void loadMembers()}');
    expect(audiencePage).not.toContain("err.message}</p>");
    expect(rewardsPage).toContain("Couldn't load your credits dashboard");
    expect(rewardsPage).toContain("Your rewards data could not be loaded.");
    expect(rewardsPage).toContain(">Try again</Button>");
    expect(rewardsPage).not.toContain("err.message}</p>");
  });

  it("bounds authenticated dashboard boot outside the module graph", () => {
    const shell = fs.readFileSync(path.resolve(assets, "../../../../packages/shared/src/page-shell.ts"), "utf8");
    const watchdog = read("dashboard-boot-watchdog.js");
    const giveawaysPage = fs.readFileSync(path.resolve(assets, "../react/pages/giveaways/page.tsx"), "utf8");
    const tournamentsShim = read("tournaments.js");
    expect(shell).toContain("DASHBOARD_BOOT_WATCHDOG");
    expect(shell).toContain('/assets/dashboard-boot-watchdog.js?v=2');
    expect(watchdog).toContain("setTimeout(function ()");
    expect(watchdog).toContain("8000");
    expect(watchdog).toContain("unhandledrejection");
    expect(watchdog).toContain("data-yr-boot-retry");
    expect(watchdog).not.toContain("import ");
    expect(giveawaysPage).toContain("withDashboardTimeout");
    expect(giveawaysPage).toContain("window.__yrBoot?.fail");
    expect(giveawaysPage).toContain("window.__yrBoot?.signal()");
    expect(giveawaysPage).not.toContain("await fetch(");
    expect(tournamentsShim).toContain("window.__yrBoot?.fail");
    expect(tournamentsShim).toContain("window.__yrBoot?.signal()");
  });

  it("ignores third-party boot errors but catches same-origin assets", () => {
    const thirdPartyScript = runWatchdogError({
      target: {
        tagName: "SCRIPT",
        src: "https://static.cloudflareinsights.com/beacon.min.js",
      },
      error: {},
    });
    expect(thirdPartyScript.surface.hidden).toBe(true);
    expect(thirdPartyScript.surface.innerHTML).toBe("");
    expect(thirdPartyScript.classes).toEqual([]);

    const anonymousRuntimeError = runWatchdogError({ error: {} });
    expect(anonymousRuntimeError.surface.hidden).toBe(false);
    expect(anonymousRuntimeError.surface.innerHTML).toContain("Couldn't load this dashboard.");
    expect(anonymousRuntimeError.classes).toContain("yr-boot-failure");

    const localScript = runWatchdogError({
      target: { tagName: "SCRIPT", src: "https://yourrank.site/assets/giveaways.js" },
    });
    expect(localScript.surface.hidden).toBe(false);
    expect(localScript.surface.innerHTML).toContain("Couldn't load this dashboard.");
    expect(localScript.classes).toContain("yr-boot-failure");

    const extensionError = runWatchdogError({
      filename: "moz-extension://abc/content.js",
      error: {},
    });
    expect(extensionError.surface.hidden).toBe(true);
    expect(extensionError.surface.innerHTML).toBe("");
    expect(extensionError.classes).toEqual([]);

    const localRuntimeError = runWatchdogError({
      filename: "https://yourrank.site/assets/giveaways.js",
    });
    expect(localRuntimeError.surface.hidden).toBe(false);
    expect(localRuntimeError.surface.innerHTML).toContain("Couldn't load this dashboard.");
    expect(localRuntimeError.classes).toContain("yr-boot-failure");

    const localStylesheet = runWatchdogError({
      target: { tagName: "LINK", href: "/assets/react/react.css" },
    });
    expect(localStylesheet.surface.hidden).toBe(false);
    expect(localStylesheet.surface.innerHTML).toContain("Couldn't load this dashboard.");
    expect(localStylesheet.classes).toContain("yr-boot-failure");
  });

  it("hides list controls and invalid page labels when lists are empty", () => {
    const utils = read("dashboard/utils.js");
    const rewardsPage = fs.readFileSync(path.resolve(assets, "../react/pages/rewards/page.tsx"), "utf8");
    const boards = read("dashboard/boards.js");
    const players = read("dashboard/players.js");
    expect(utils).toContain("wrap.hidden = this.all.length === 0");
    expect(utils).toContain("this._setControlsHidden(this.all.length === 0)");
    expect(utils).toContain('this.pageInfo.textContent = total ? `Page ${this.page}');
    expect(utils).not.toContain(": `0`");
    expect(rewardsPage).toContain("items.length > 0 && <div id=\"cr-shop-controls\"");
    expect(boards).toContain("controls.hidden = state.BOARDS.length === 0");
    expect(players).toContain("controls.hidden = empty");
    expect(players).toContain("archiveForm.hidden = empty");
  });

  it("starts the redemption channel chip in a disconnected state", () => {
    const rewardsPage = fs.readFileSync(path.resolve(assets, "../react/pages/rewards/page.tsx"), "utf8");
    expect(rewardsPage).toContain("Not connected · Connect Kick");
    expect(rewardsPage).toContain("Not connected · Owner action required");
  });

  it("preserves shared boards empty markup while filtering", () => {
    const boards = read("dashboard/boards.js");
    const account = read("dashboard/account.js");
    const utils = read("dashboard/utils.js");
    expect(boards).toContain('renderEmpty(empty, q');
    expect(boards).not.toContain('empty.textContent = q ? "No boards match your search."');
    expect(account).toContain('setState({ SESSIONS_STATUS: "error" })');
    expect(utils).toContain("catch (loggingErr)");
  });
});
