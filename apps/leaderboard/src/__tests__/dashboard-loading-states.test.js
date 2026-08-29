import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  UNKNOWN,
  emptyStateHtml,
  metricText,
} from "../assets/dashboard/states.js";
import { visitsMetricState } from "../assets/dashboard/overview-state.js";
import { PAGES } from "../pages.jsx";

const assets = path.resolve(import.meta.dir, "../assets");
const read = (file) => fs.readFileSync(path.join(assets, file), "utf8");

describe("dashboard loading states", () => {
  it("announces the initial dashboard and credits loaders", () => {
    const dashboardHtml = PAGES.dashboard.Component({ activePath: "/dashboard" }).toString();
    const creditsHtml = PAGES.rewardsRedemptions.Component({}).toString();
    expect(dashboardHtml).toContain('id="loading" class="yr-workspace-loader" role="status"');
    expect(dashboardHtml).toContain('id="loadingStatus">Loading your workspace');
    expect(dashboardHtml).toContain('class="yr-loader-track"');
    expect(dashboardHtml).toContain('aria-busy="true"');
    expect(creditsHtml).toContain('id="cr-loading" class="ui-loading" role="status"');
    expect(creditsHtml).toContain("Loading rewards");
    expect(PAGES.dashboard.config.bootWatchdog).toBe(true);
    expect(PAGES.rewardsRedemptions.config.bootWatchdog).toBe(true);
    expect(read("dashboard.js")).toContain("window.__yrBoot?.signal()");
    expect(read("credits.js")).toContain("window.__yrBoot?.signal()");
  });
  it("keeps loading, ready zero, and unknown values distinct", () => {
    expect(UNKNOWN).toBe("—");
    expect(metricText("loading", 0)).toBe("");
    expect(metricText("ready", 0)).toBe("0");
    expect(metricText("ready", "0.0%")).toBe("0.0%");
    expect(metricText("error")).toBe("—");
  });

  it("keeps Home visits states truthful across publication and stats status", () => {
    expect(visitsMetricState({ published: false, statsStatus: "loading" })).toEqual({
      kind: "unpublished",
      value: "Not published",
    });
    expect(visitsMetricState({
      published: true,
      statsStatus: "ready",
      stats: { days: [{ views: 0 }, { views: 0 }] },
    })).toEqual({ kind: "ready", value: 0 });
    expect(visitsMetricState({ published: true, statsStatus: "loading" })).toEqual({ kind: "loading" });
    expect(visitsMetricState({ published: true, statsStatus: "error" })).toEqual({
      kind: "unavailable",
      value: "Unavailable",
    });
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
    const referrals = read("dashboard/referrals.js");
    expect(site).toContain("setState({ STATS_STATUS: \"loading\" })");
    expect(site).toContain("setState({ STATS: s, STATS_STATUS: \"ready\" })");
    expect(site).toContain("setState({ CREDITS_STATUS: \"loading\" })");
    expect(site).toContain("setState({ USAGE_STATUS: \"loading\" })");
    expect(account).toContain("setState({ SESSIONS_STATUS: \"loading\" })");
    expect(games).toContain("setState({ GAMES_STATUS: \"loading\" })");
    expect(performance).toContain("setState({ HEATMAP_STATUS: \"loading\" })");
    expect(referrals).toContain("setState({ REFERRALS_STATUS: \"loading\" })");
  });

  it("does not coerce credits payload fields to zero before resolution", () => {
    const credits = read("credits.js");
    expect(credits).not.toMatch(/usage\.[A-Za-z0-9_]+ \|\| 0/);
    expect(credits).not.toMatch(/limits\.[A-Za-z0-9_]+ \|\| 0/);
  });

  it("uses shared list loading and confirmed-empty treatments", () => {
    const utils = read("dashboard/utils.js");
    const credits = read("credits.js");
    const pages = fs.readFileSync(path.resolve(assets, "../pages/credits-pages.js"), "utf8");
    expect(utils).toContain("setRowsLoading");
    expect(utils).toContain("renderEmpty(this.emptyEl, this.emptySpec)");
    expect(credits).toContain("rewardCtrl?.setLoading(true)");
    expect(credits).toContain('emptyEl: $("cr-reward-empty")');
    expect(credits).toContain('emptyEl: $("cr-viewer-empty")');
    expect(credits).toContain('emptyEl: $("cr-redemption-empty")');
    expect(credits).toContain('$("cr-history-feed-empty")');
    expect(pages).not.toContain("Loading your credits dashboard");
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

  it("keeps credits load failures plain and retryable", () => {
    const credits = read("credits.js");
    expect(credits).toContain('logError("load-credits-dashboard", err)');
    expect(credits).toContain('title: "Couldn\'t load members"');
    expect(credits).toContain('body: "People for the selected site could not be loaded."');
    expect(credits).toContain('title: "Couldn\'t load your credits dashboard"');
    expect(credits).toContain("retry: () => load()");
    expect(credits).not.toContain("err.message}</p>");
    expect(credits).toContain('$("cr-app").hidden = false');
  });

  it("bounds authenticated dashboard boot outside the module graph", () => {
    const shell = fs.readFileSync(path.resolve(assets, "../../../../packages/shared/src/page-shell.ts"), "utf8");
    const watchdog = read("dashboard-boot-watchdog.js");
    expect(shell).toContain("DASHBOARD_BOOT_WATCHDOG");
    expect(shell).toContain('/assets/dashboard-boot-watchdog.js?v=1');
    expect(watchdog).toContain("setTimeout(function ()");
    expect(watchdog).toContain("8000");
    expect(watchdog).toContain("unhandledrejection");
    expect(watchdog).toContain("data-yr-boot-retry");
    expect(watchdog).not.toContain("import ");
    expect(read("giveaways.js")).toContain("withDashboardTimeout");
    expect(read("giveaways.js")).toContain('window.__yrBoot?.fail');
    expect(read("giveaways.js")).not.toContain("await fetch(");
  });

  it("hides list controls and invalid page labels when lists are empty", () => {
    const utils = read("dashboard/utils.js");
    const credits = read("credits.js");
    const boards = read("dashboard/boards.js");
    const players = read("dashboard/players.js");
    expect(utils).toContain("wrap.hidden = this.all.length === 0");
    expect(utils).toContain("this._setControlsHidden(this.all.length === 0)");
    expect(utils).toContain('this.pageInfo.textContent = total ? `Page ${this.page}');
    expect(utils).not.toContain(": `0`");
    expect(credits).toContain('toggleAttribute("hidden", items.length === 0)');
    expect(boards).toContain("controls.hidden = state.BOARDS.length === 0");
    expect(players).toContain("controls.hidden = empty");
    expect(players).toContain("archiveForm.hidden = empty");
  });

  it("starts the redemption channel chip in a disconnected state", () => {
    const pages = fs.readFileSync(path.resolve(assets, "../pages/credits-pages.js"), "utf8");
    expect(pages).toContain('class="v3-chip v3-chip--cancelled">● Not connected');
    expect(pages).not.toContain("● Not connected ·");
    expect(pages).not.toContain('class="v3-chip v3-chip--refunded">● Connected to @');
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
