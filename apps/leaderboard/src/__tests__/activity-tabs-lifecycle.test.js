// My Activity tabs: the URL hash is the single selection state. These tests run
// the real viewer-app.js + site-shell.js in a DOM against real renderSite HTML,
// so initial load, hash changes, SPA remounts and Back/Forward are exercised
// as a browser would drive them rather than by inspecting HTML strings.
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { renderSite } from "@yourrank/shared/site-render";

const assets = join(import.meta.dir, "../assets");
const viewerAppSource = readFileSync(join(assets, "viewer-app.js"), "utf8");
const siteShellSource = readFileSync(join(assets, "site-shell.js"), "utf8");
const ORIGIN = "https://example.test";
const ACTIVITY = "/creator/activity";
const PANELS = ["membership-history", "membership-claims", "membership-participation", "membership-code"];

const baseData = {
  brand: { name: "Creator Name", tagline: "Weekly board", period: "Monthly", prizePool: "$500" },
  branding: { template: "cyber_arcade", font: "Inter", options: {} },
  players: [{ name: "Alice", rank: 1, wagered: 5000, prize: "$100" }],
  prizes: { currency: "$", wagerLabel: "Wagered", prizeLabel: "Prize" },
  shopItems: [{ id: 1, name: "Song request", cost: 600, active: true }],
  socials: [],
  siteSections: { home: true, leaderboard: true, shop: true, games: false, me: true },
};
const viewer = { kick_username: "viewer_one" };

function renderPage(section, { blocked = false } = {}) {
  return renderSite({
    r: { slug: "creator", plan: "pro", data: baseData },
    section,
    viewer,
    viewerData: { viewerOnSite: { balance: 1234, blocked }, ledger: [], claims: [], participation: [] },
    opts: { slug: "creator", homeUrl: ORIGIN, nonce: "n", isCustomDomain: false },
  });
}

function sectionFor(pathname) {
  return pathname === ACTIVITY ? "me" : pathname === "/creator/shop" ? "shop" : "home";
}

/** A viewer-shell browser: one document, the real scripts, a fetch that serves rendered pages. */
async function openBrowser(url, { blocked = false } = {}) {
  const target = new URL(url, ORIGIN);
  const window = new Window({ url: target.href, settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableErrorCapturing: true } });
  const { document } = window;
  document.documentElement.innerHTML = await renderPage(sectionFor(target.pathname), { blocked });
  window.fetch = async (input) => {
    const requested = new URL(String(input), ORIGIN);
    if (requested.pathname.startsWith("/api/")) return new window.Response("{}", { status: 200 });
    const html = await renderPage(sectionFor(requested.pathname), { blocked });
    return { ok: true, status: 200, redirected: false, url: requested.href, text: async () => html };
  };
  // Page controllers load through <script src>; serve them from disk instead of the
  // network and evaluate them against the happy-dom globals they expect.
  const globals = ["window", "document", "location", "history", "fetch", "DOMParser", "Event", "URL", "AbortController"];
  const run = (source) => new Function(...globals, source)(window, document, window.location, window.history, window.fetch, window.DOMParser, window.Event, window.URL, window.AbortController);
  const originalAppend = document.body.appendChild.bind(document.body);
  document.body.appendChild = (node) => {
    const appended = originalAppend(node);
    if (node.tagName === "SCRIPT" && node.getAttribute("src") === "/assets/site-shell.js") {
      queueMicrotask(() => { run(siteShellSource); node.onload?.(new window.Event("load")); });
    }
    return appended;
  };
  run(viewerAppSource);
  await window.__yrViewerAppReady;
  await settle(window);
  return { window, document };
}

async function settle(window) {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  await window.happyDOM.waitUntilComplete();
}

function state(document) {
  const tabs = Array.from(document.querySelectorAll('.viewer-tabs[role="tablist"] [role="tab"]'));
  const panels = PANELS.map((id) => document.getElementById(id)).filter(Boolean);
  return {
    selected: tabs.filter((tab) => tab.getAttribute("aria-selected") === "true").map((tab) => tab.getAttribute("aria-controls")),
    focusable: tabs.filter((tab) => tab.tabIndex === 0).map((tab) => tab.getAttribute("aria-controls")),
    visible: panels.filter((panel) => !panel.hidden).map((panel) => panel.id),
  };
}

function expectOnly(document, id) {
  expect(state(document)).toEqual({ selected: [id], focusable: [id], visible: [id] });
}

async function click(window, document, selector) {
  const element = document.querySelector(selector);
  expect(element).not.toBeNull();
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  await settle(window);
}

async function goHistory(window, delta) {
  window.history.go(delta);
  await settle(window);
}

describe("My Activity tabs follow the URL hash", () => {
  let browser;
  afterEach(async () => { await browser?.window.happyDOM.close(); browser = null; });

  for (const id of PANELS) {
    it(`initial load of ${ACTIVITY}#${id} shows only that panel`, async () => {
      browser = await openBrowser(`${ACTIVITY}#${id}`);
      expectOnly(browser.document, id);
    });
  }

  it("repeated tab switching keeps hash, aria-selected and visible panel in sync", async () => {
    browser = await openBrowser(ACTIVITY);
    const { window, document } = browser;
    expectOnly(document, "membership-history");
    for (const id of ["membership-claims", "membership-participation", "membership-history", "membership-claims", "membership-code"]) {
      await click(window, document, `#membership-tab-${id.slice("membership-".length)}`);
      expect(window.location.hash).toBe(`#${id}`);
      expectOnly(document, id);
    }
  });

  it("keeps working after SPA navigation away and back (remount)", async () => {
    browser = await openBrowser("/creator");
    const { window, document } = browser;
    await click(window, document, `.viewer-rail a[href="${ACTIVITY}"]`);
    expect(window.location.pathname).toBe(ACTIVITY);
    expectOnly(document, "membership-history");
    await click(window, document, "#membership-tab-claims");
    expectOnly(document, "membership-claims");
    await click(window, document, '.viewer-rail a[href="/creator/shop"]');
    expect(window.location.pathname).toBe("/creator/shop");
    await click(window, document, `.viewer-rail a[href="${ACTIVITY}"]`);
    expect(window.location.pathname).toBe(ACTIVITY);
    expectOnly(document, "membership-history");
    await click(window, document, "#membership-tab-participation");
    expect(window.location.hash).toBe("#membership-participation");
    expectOnly(document, "membership-participation");
    await click(window, document, "#membership-tab-claims");
    expectOnly(document, "membership-claims");
  });

  it("remount does not leave the previous controller listening", async () => {
    browser = await openBrowser(ACTIVITY);
    const { window, document } = browser;
    const originalTab = document.getElementById("membership-tab-claims");
    const originalPanel = document.getElementById("membership-claims");
    await click(window, document, '.viewer-rail a[href="/creator/shop"]');
    await click(window, document, `.viewer-rail a[href="${ACTIVITY}"]`);
    expect(document.getElementById("membership-claims")).not.toBe(originalPanel);
    await click(window, document, "#membership-tab-claims");
    expectOnly(document, "membership-claims");
    // Detached nodes from the unmounted page are never touched again.
    expect(originalTab.getAttribute("aria-selected")).toBe("false");
    expect(originalPanel.hidden).toBe(true);
  });

  it("follows Back and Forward through hash history", async () => {
    browser = await openBrowser(`${ACTIVITY}#membership-history`);
    const { window, document } = browser;
    await click(window, document, "#membership-tab-claims");
    await click(window, document, "#membership-tab-participation");
    expectOnly(document, "membership-participation");
    await goHistory(window, -1);
    expect(window.location.hash).toBe("#membership-claims");
    expectOnly(document, "membership-claims");
    await goHistory(window, -1);
    expect(window.location.hash).toBe("#membership-history");
    expectOnly(document, "membership-history");
    await goHistory(window, 1);
    expect(window.location.hash).toBe("#membership-claims");
    expectOnly(document, "membership-claims");
  });

  it("falls back to the default panel for an unknown hash", async () => {
    browser = await openBrowser(`${ACTIVITY}#not-a-panel`);
    expectOnly(browser.document, "membership-history");
  });

  it("falls back safely when #membership-code is not rendered for a blocked membership", async () => {
    browser = await openBrowser(`${ACTIVITY}#membership-code`, { blocked: true });
    expect(browser.document.getElementById("membership-code")).toBeNull();
    expectOnly(browser.document, "membership-history");
  });

  it("supports ArrowLeft / ArrowRight / Home / End on the tablist", async () => {
    browser = await openBrowser(ACTIVITY);
    const { window, document } = browser;
    // Activating a tab moves focus into its panel (existing hash-anchor focus
    // behaviour), so each keypress starts from the selected tab as a user would.
    const press = async (key) => {
      const selected = document.querySelector('.viewer-tabs [role="tab"][aria-selected="true"]');
      selected.focus();
      expect(document.activeElement).toBe(selected);
      const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      selected.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      await settle(window);
    };
    await press("ArrowRight");
    expect(window.location.hash).toBe("#membership-claims");
    expectOnly(document, "membership-claims");
    await press("End");
    expectOnly(document, "membership-code");
    await press("ArrowRight");
    expectOnly(document, "membership-history");
    await press("ArrowLeft");
    expectOnly(document, "membership-code");
    await press("Home");
    expectOnly(document, "membership-history");
  });
});
