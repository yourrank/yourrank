// Asset-delivery parity for dynamic sections.
//
// Engagement is served two ways: as a full document (page config renders its
// <link> tags) and as a content fragment injected into the persistent shell.
// The fragment carries the destination's own config styles, and the loader
// makes them usable before the markup is shown — otherwise the section paints
// unstyled until a refresh brings the document route back.
import { beforeEach, describe, expect, it } from "bun:test";
import { PAGES } from "../pages.jsx";
import { giveawaysConfig } from "../pages/giveaways.jsx";
import { renderFragmentPayload, resolveFragment } from "../index.js";

const user = { display_name: "Test operator", plan: "pro" };
const ENGAGEMENT_CSS = "/assets/giveaways.css";

/** Minimal DOM the loader needs: a head that collects stylesheet links. */
function installBrowserGlobals({ failing = [] } = {}) {
  const links = [];
  const container = makeElement();

  function makeLink() {
    const listeners = {};
    return {
      _attrs: {},
      sheet: null,
      set rel(v) { this._attrs.rel = v; },
      get rel() { return this._attrs.rel; },
      set href(v) {
        this._attrs.href = v;
        // Model the network: resolve or fail on a later turn, like a browser.
        queueMicrotask(() => {
          if (failing.includes(v)) {
            (listeners.error || []).forEach((fn) => fn());
          } else {
            this.sheet = { cssRules: [] };
            (listeners.load || []).forEach((fn) => fn());
          }
        });
      },
      get href() { return this._attrs.href; },
      getAttribute(name) { return this._attrs[name] ?? null; },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    };
  }

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
    href: "http://localhost/dashboard",
    pathname: "/dashboard",
    search: "",
    origin: "http://localhost",
  };
  globalThis.window = {
    __yrBoot: { signal() {}, fail() {} },
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };

  return { container, links };
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

  it("boots a section that declares no stylesheets", async () => {
    const { container, links } = installBrowserGlobals();
    globalThis.fetch = fragmentResponder({ html: "<h1>Account</h1>", title: "Account" });

    expect(await loadDynamicSection("settings", "account")).toBe(true);
    expect(links.length).toBe(0);
    expect(container.innerHTML).toContain("Account");
  });
});
