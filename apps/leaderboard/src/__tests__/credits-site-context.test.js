import { describe, it, expect } from "bun:test";

function makeEl(id, tag = "div") {
  return {
    id,
    tagName: tag,
    attributes: {},
    dataset: {},
    hidden: false,
    textContent: "",
    href: "",
    disabled: false,
    classList: { contains: () => false, add: () => {}, remove: () => {}, toggle: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    getAttribute(n) { return this.attributes[n] || null; },
    setAttribute(n, v) { this.attributes[n] = String(v); },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    focus: () => {},
  };
}

function installBrowserGlobals() {
  const elements = new Map();
  const document = {
    readyState: "complete",
    cookie: "",
    querySelector: (sel) => (sel === 'meta[name="request-id"]' ? null : null),
    getElementById: (id) => elements.get(id) || null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => makeEl(""),
    body: { appendChild: () => {} },
    documentElement: {
      setAttribute: () => {},
      getAttribute: () => null,
      classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    },
  };
  const location = {
    href: "http://localhost:8787/dashboard/rewards",
    pathname: "/dashboard/rewards",
    search: "",
    origin: "http://localhost:8787",
  };
  globalThis.window = {
    __yrSpaShell: true,
    addEventListener: () => {},
    removeEventListener: () => {},
    YRDialog: { confirm: () => {} },
  };
  globalThis.document = document;
  globalThis.location = location;
  globalThis.history = { replaceState: () => {}, pushState: () => {} };
  globalThis.navigator = {};
  globalThis.fetch = () => Promise.resolve(new Response("{}", { status: 200 }));
  return {
    addElement(id, el) { elements.set(id, el); return el; },
  };
}

describe("credits applyOAuthContext site fallback", () => {
  it("uses the dashboard ACTIVE_SITE_ID when the URL has no ?siteId", async () => {
    const { addElement } = installBrowserGlobals();
    const { setState } = await import("../assets/dashboard/state.js");
    setState({ ACTIVE_SITE_ID: "site-from-dashboard" });
    const { applyOAuthContext, enter, leave } = await import("../assets/credits.js");
    // The module caches the site id across calls; re-enter the area so a
    // previous in-process test cannot leave a stale id behind.
    enter();
    leave();
    const link = addElement("cr-channel-connect", makeEl("cr-channel-connect", "a"));
    applyOAuthContext();
    expect(link.href).toContain("siteId=site-from-dashboard");
  });
});
