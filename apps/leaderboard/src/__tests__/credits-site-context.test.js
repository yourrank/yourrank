import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";

const boardShellJs = readFileSync(new URL("../assets/dashboard/board-shell.js", import.meta.url), "utf8");
const dashboardJs = readFileSync(new URL("../assets/dashboard.js", import.meta.url), "utf8");

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
  const links = [];
  const document = {
    readyState: "complete",
    cookie: "",
    querySelector: (sel) => {
      if (sel === 'meta[name="request-id"]') return null;
      const product = sel.match(/^\[data-product-link="([^"]+)"\]$/)?.[1];
      return product ? links.find((link) => link.dataset.productLink === product) || null : null;
    },
    getElementById: (id) => elements.get(id) || null,
    querySelectorAll: (sel) => sel === "a[href]" ? links : [],
    addEventListener: () => {},
    createElement: () => makeEl(""),
    body: { appendChild: () => {} },
    documentElement: { setAttribute: () => {}, getAttribute: () => null },
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
    addLink(href, productLink) {
      const link = makeEl("", "a");
      link.attributes.href = href;
      link.href = href;
      link.dataset.productLink = productLink;
      links.push(link);
      return link;
    },
  };
}

describe("credits applyOAuthContext site fallback", () => {
  it("uses the dashboard ACTIVE_SITE_ID when the URL has no ?siteId", async () => {
    const { addElement } = installBrowserGlobals();
    const { setState } = await import("../assets/dashboard/state.js");
    setState({ ACTIVE_SITE_ID: "site-from-dashboard" });
    const { applyOAuthContext } = await import("../assets/credits.js");
    const link = addElement("cr-channel-connect", makeEl("cr-channel-connect", "a"));
    applyOAuthContext();
    expect(link.href).toContain("siteId=site-from-dashboard");
  });

  it("stamps Home and Sites independently even when both share the sites product marker", async () => {
    const { addLink } = installBrowserGlobals();
    const { preserveSiteContextLinks } = await import("../assets/dashboard/board-shell.js");
    const home = addLink("/dashboard", "sites");
    const sites = addLink("/dashboard/leaderboards", "sites");

    preserveSiteContextLinks("site-42");

    expect(home.href).toBe("/dashboard?board=site-42");
    expect(sites.href).toBe("/dashboard/leaderboards?board=site-42");
    expect(home.dataset.productLink).toBe("sites");
    expect(sites.dataset.productLink).toBe("sites");
  });

  it("stamps destinations from pathname rather than the product marker", () => {
    expect(boardShellJs).not.toContain('data-product-link="sites"');
    expect(boardShellJs).not.toContain("dataset.productLink");
    expect(dashboardJs).not.toContain("dataset.productLink");
  });
});
