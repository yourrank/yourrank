// Asset-delivery parity for dynamic sections.
//
// Engagement is served two ways: as a full document (page config renders its
// <link> tags) and as a content fragment injected into the persistent shell.
// The fragment carries the destination's own config styles, and the loader
// makes them usable before the markup is shown — otherwise the section paints
// unstyled until a refresh brings the document route back.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { PAGES } from "../pages.jsx";
import { giveawaysConfig } from "../pages/giveaways.jsx";
import { renderFragmentPayload, resolveFragment } from "../index.js";

const user = { display_name: "Test operator", plan: "pro" };
const ENGAGEMENT_CSS = "/assets/giveaways.css";

/**
 * Minimal DOM the loader needs: a head that collects stylesheet links, plus
 * network control so a test can fail, stall, then heal a stylesheet.
 *
 * `requests` records every href the document actually asked the network for,
 * which is how a retry that reuses a dead link is distinguished from one that
 * issues a fresh request.
 */
function installBrowserGlobals({ failing = [], stalled = [], pathname = "/dashboard", controlTimers = false } = {}) {
  const links = [];
  const requests = [];
  const network = { failing: new Set(failing), stalled: new Set(stalled) };
  const container = makeElement();
  let retryHandler = null;

  function makeLink() {
    const listeners = {};
    return {
      _attrs: {},
      sheet: null,
      set rel(v) { this._attrs.rel = v; },
      get rel() { return this._attrs.rel; },
      set href(v) {
        this._attrs.href = v;
        requests.push(v);
        // A stalled request never settles, which is the timeout case.
        if (network.stalled.has(v)) return;
        // Model the network: resolve or fail on a later turn, like a browser.
        queueMicrotask(() => {
          if (network.failing.has(v)) {
            (listeners.error || []).forEach((fn) => fn());
          } else {
            this.sheet = { cssRules: [] };
            (listeners.load || []).forEach((fn) => fn());
          }
        });
      },
      get href() { return this._attrs.href; },
      getAttribute(name) { return this._attrs[name] ?? null; },
      remove() {
        const at = links.indexOf(this);
        if (at !== -1) links.splice(at, 1);
      },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    };
  }

  // The error state wires its Retry button through container.querySelector.
  container.querySelector = (selector) => {
    if (selector !== "#stateRetry") return null;
    return { addEventListener(type, fn) { if (type === "click") retryHandler = fn; } };
  };

  const elements = new Map([["lbDynamic", container]]);
  globalThis.document = {
    cookie: "",
    title: "",
    head: { appendChild(link) { links.push(link); } },
    body: makeElement(),
    documentElement: makeElement(),
    addEventListener() {},
    removeEventListener() {},
    getElementById(id) { return elements.get(id) || null; },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === 'link[rel="stylesheet"][href]') return links.filter((l) => l.getAttribute("href"));
      return [];
    },
    createElement() { return makeLink(); },
    createDocumentFragment() { return makeElement(); },
  };
  globalThis.location = {
    href: `http://localhost${pathname}`,
    pathname,
    search: "",
    origin: "http://localhost",
  };
  globalThis.window = {
    __yrBoot: { signal() {}, fail() {} },
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };

  // Firing the 10s stylesheet cap on demand keeps the timeout test instant.
  const timers = new Map();
  let nextTimer = 1;
  if (controlTimers) {
    globalThis.setTimeout = (fn) => {
      const id = nextTimer++;
      timers.set(id, fn);
      return id;
    };
    globalThis.clearTimeout = (id) => timers.delete(id);
  }
  const runTimers = () => {
    const due = [...timers.values()];
    timers.clear();
    due.forEach((fn) => fn());
  };

  return { container, links, requests, network, runTimers, clickRetry: () => retryHandler?.() };
}

/** Real timers, usable even while the loader's timers are controlled. */
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
function tick(ms = 10) {
  return new Promise((resolve) => realSetTimeout(resolve, ms));
}
function restoreTimers() {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
}

function makeElement() {
  return {
    attributes: {},
    children: [],
    hidden: false,
    innerHTML: "",
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
  };
}

/** Fragment response for a section, as the Worker endpoint returns it. */
function fragmentResponder(payload) {
  return async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stylesheetHrefs(links) {
  return links.map((l) => l.getAttribute("href"));
}

describe("Engagement style requirements are declared by one owner", () => {
  it("declares giveaways.css on the full document", () => {
    expect(giveawaysConfig.styles).toContain(ENGAGEMENT_CSS);
    expect(PAGES.giveaways.config.styles).toContain(ENGAGEMENT_CSS);
  });

  it("reports the same stylesheets on the SPA fragment as the document renders", async () => {
    const fragment = resolveFragment("/dashboard/giveaways/chat");
    const payload = await renderFragmentPayload(PAGES[fragment.pageKey], { user, tab: fragment.tab });
    expect(payload.styles).toEqual(giveawaysConfig.styles);
    expect(payload.styles).toContain(ENGAGEMENT_CSS);
    expect(payload.html).toBeTruthy();
    expect(payload.title).toBe(giveawaysConfig.title);
  });

  it("reports an empty list for a section with no extra feature stylesheet", async () => {
    const fragment = resolveFragment("/dashboard/settings/account");
    const payload = await renderFragmentPayload(PAGES[fragment.pageKey], { user, tab: fragment.tab });
    expect(payload.styles).not.toContain(ENGAGEMENT_CSS);
    expect(payload.styles.length).toBeGreaterThan(0);
  });
});

describe("dynamic navigation waits for the destination's stylesheets", () => {
  let loadDynamicSection;

  beforeEach(async () => {
    // The loader's module graph reads `document` at import time.
    installBrowserGlobals();
    ({ loadDynamicSection } = await import("../assets/dashboard/dynamic-section.js"));
  });

  afterEach(restoreTimers);

  it("loads a required stylesheet before the fragment markup is injected", async () => {
    // A distinct URL per test keeps the loader's in-document dedupe state from
    // leaking between cases (the real page only ever has one document).
    const css = "/assets/test-engagement-a.css";
    const { container, links } = installBrowserGlobals();
    globalThis.fetch = fragmentResponder({ html: "<h1>Engagement</h1>", title: "Engagement", styles: [css] });

    // Snapshot which stylesheets were usable at the moment the markup landed.
    let sheetsAtInject = null;
    let html = "";
    Object.defineProperty(container, "innerHTML", {
      get: () => html,
      set: (value) => {
        html = value;
        if (value.includes("Engagement")) sheetsAtInject = links.map((l) => Boolean(l.sheet));
      },
    });

    expect(await loadDynamicSection("giveaways", "chat")).toBe(true);
    expect(stylesheetHrefs(links)).toEqual([css]);
    expect(container.innerHTML).toContain("Engagement");
    // The stylesheet was already parsed when the fragment became visible.
    expect(sheetsAtInject).toEqual([true]);
  });

  it("reuses the stylesheet already in the document instead of adding another", async () => {
    const css = "/assets/test-engagement-b.css";
    const { links } = installBrowserGlobals();
    globalThis.fetch = fragmentResponder({ html: "<h1>Engagement</h1>", title: "Engagement", styles: [css] });

    expect(await loadDynamicSection("giveaways", "chat")).toBe(true);
    // Away and back, twice: still exactly one usable copy.
    expect(await loadDynamicSection("rewards", "overview")).toBe(true);
    expect(await loadDynamicSection("giveaways", "chat")).toBe(true);
    expect(stylesheetHrefs(links)).toEqual([css]);
  });

  it("treats equivalent absolute and relative spellings as the same stylesheet", async () => {
    const { links } = installBrowserGlobals();
    globalThis.fetch = fragmentResponder({
      html: "<h1>Engagement</h1>",
      title: "Engagement",
      styles: ["/assets/test-engagement-c.css", "http://localhost/assets/test-engagement-c.css"],
    });

    expect(await loadDynamicSection("giveaways", "chat")).toBe(true);
    expect(links.length).toBe(1);
  });

  it("uses the section error path when a required stylesheet fails to load", async () => {
    const css = "/assets/test-engagement-d.css";
    const { container } = installBrowserGlobals({ failing: [css] });
    globalThis.fetch = fragmentResponder({ html: "<h1>Engagement</h1>", title: "Engagement", styles: [css] });

    expect(await loadDynamicSection("giveaways", "chat")).toBe(false);
    expect(container.innerHTML).toContain("Couldn&#39;t load this section.");
    // The unstyled markup is never shown.
    expect(container.innerHTML).not.toContain("<h1>Engagement</h1>");
  });

  it("lets Retry re-request a stylesheet that failed, then styles the section", async () => {
    const css = "/assets/test-engagement-e.css";
    const harness = installBrowserGlobals({ failing: [css], pathname: "/dashboard/giveaways/chat" });
    const { container, links, requests, network, clickRetry } = harness;
    globalThis.fetch = fragmentResponder({ html: "<h1>Engagement</h1>", title: "Engagement", styles: [css] });

    expect(await loadDynamicSection("giveaways", "chat")).toBe(false);
    expect(container.innerHTML).toContain("Couldn&#39;t load this section.");
    expect(requests).toEqual([css]);
    // The dead link is gone, so the retry cannot be starved by an element the
    // browser has already given up on.
    expect(links.length).toBe(0);

    // Retry through the error state's own button, with the failure removed.
    network.failing.delete(css);
    let sheetReadyAtInject = null;
    let html = container.innerHTML;
    Object.defineProperty(container, "innerHTML", {
      get: () => html,
      set: (value) => {
        html = value;
        if (value.includes("<h1>Engagement</h1>")) sheetReadyAtInject = links.map((l) => Boolean(l.sheet));
      },
    });

    clickRetry();
    await tick();

    // A genuinely fresh request was issued, and the markup only appeared once
    // the new stylesheet was usable.
    expect(requests).toEqual([css, css]);
    expect(sheetReadyAtInject).toEqual([true]);
    expect(container.innerHTML).toContain("Engagement");
    expect(stylesheetHrefs(links)).toEqual([css]);

    // Later navigation is unaffected: still one usable copy, no stale link.
    expect(await loadDynamicSection("rewards", "overview")).toBe(true);
    expect(await loadDynamicSection("giveaways", "chat")).toBe(true);
    expect(stylesheetHrefs(links)).toEqual([css]);
    expect(requests).toEqual([css, css]);
  });

  it("drops a stalled stylesheet after the timeout so the next attempt re-requests it", async () => {
    const css = "/assets/test-engagement-f.css";
    const { container, links, requests, network, runTimers } = installBrowserGlobals({ stalled: [css], controlTimers: true });
    globalThis.fetch = fragmentResponder({ html: "<h1>Engagement</h1>", title: "Engagement", styles: [css] });

    const pending = loadDynamicSection("giveaways", "chat");
    // Let the fragment fetch settle and the link be inserted, then run out the
    // 10s stylesheet cap without waiting for it in real time.
    await tick();
    expect(links.length).toBe(1);
    runTimers();

    expect(await pending).toBe(false);
    expect(container.innerHTML).toContain("Couldn&#39;t load this section.");
    expect(links.length).toBe(0);

    network.stalled.delete(css);
    expect(await loadDynamicSection("giveaways", "chat")).toBe(true);
    expect(requests).toEqual([css, css]);
    expect(stylesheetHrefs(links)).toEqual([css]);
    expect(container.innerHTML).toContain("Engagement");
  });

  it("boots a section that declares no stylesheets", async () => {
    const { container, links } = installBrowserGlobals();
    globalThis.fetch = fragmentResponder({ html: "<h1>Account</h1>", title: "Account" });

    expect(await loadDynamicSection("settings", "account")).toBe(true);
    expect(links.length).toBe(0);
    expect(container.innerHTML).toContain("Account");
  });
});
