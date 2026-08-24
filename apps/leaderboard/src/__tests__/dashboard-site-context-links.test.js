import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const boardShellJs = readFileSync(new URL("../assets/dashboard/board-shell.js", import.meta.url), "utf8");
const dashboardJs = readFileSync(new URL("../assets/dashboard.js", import.meta.url), "utf8");

function makeEl(id, tag = "div") {
  return {
    id,
    tagName: tag,
    attributes: {},
    dataset: {},
    href: "",
    getAttribute(name) { return this.attributes[name] || null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
  };
}

function installBrowserGlobals() {
  const elements = new Map();
  const links = [];
  const document = {
    readyState: "complete",
    cookie: "",
    querySelector: () => null,
    getElementById: (id) => elements.get(id) || null,
    querySelectorAll: (selector) => selector === "a[href]" ? links : [],
    addEventListener: () => {},
    createElement: () => makeEl(""),
    body: { appendChild: () => {} },
    documentElement: { setAttribute: () => {}, getAttribute: () => null },
  };
  const location = {
    href: "http://localhost:8787/dashboard",
    pathname: "/dashboard",
    search: "",
    origin: "http://localhost:8787",
  };
  globalThis.window = {
    __yrSpaShell: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.document = document;
  globalThis.location = location;
  globalThis.history = { replaceState: () => {}, pushState: () => {} };
  globalThis.navigator = {};
  globalThis.fetch = () => Promise.resolve(new Response("{}", { status: 200 }));
  return {
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

describe("dashboard site-context link stamping", () => {
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
    expect(boardShellJs).not.toContain("data-product-link");
    expect(boardShellJs).not.toContain("dataset.productLink");
    expect(dashboardJs).not.toContain("dataset.productLink");
  });
});
