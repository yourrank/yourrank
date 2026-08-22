import { beforeEach, describe, expect, it } from "bun:test";

function makeElement() {
  return {
    attributes: {},
    children: [],
    hidden: false,
    innerHTML: "",
    textContent: "",
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
  };
}

function installBrowserGlobals() {
  const elements = new Map();
  const container = makeElement();
  elements.set("lbDynamic", container);

  globalThis.document = {
    cookie: "",
    title: "",
    getElementById(id) { return elements.get(id) || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return makeElement(); },
    createDocumentFragment() { return makeElement(); },
  };

  globalThis.location = {
    href: "http://localhost/dashboard/settings/account",
    pathname: "/dashboard/settings/account",
    search: "",
    origin: "http://localhost",
  };

  globalThis.window = { __yrBoot: { signal() {} } };

  return { container, elements };
}

describe("dynamic-section auth handling", () => {
  let dynamicSection;

  beforeEach(async () => {
    installBrowserGlobals();
    dynamicSection = await import("../assets/dashboard/dynamic-section.js");
  });

  function fetchWithStatus(status, body) {
    return async () => new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("401 clears the session and redirects to login with a return path", async () => {
    globalThis.fetch = fetchWithStatus(401, { ok: false, error: "unauthorized" });
    const { loadDynamicSection } = dynamicSection;
    const result = await loadDynamicSection("settings", "account");
    expect(result).toBe(false);
    expect(globalThis.location.href).toBe("/login?next=%2Fdashboard%2Fsettings%2Faccount");
  });

  it("403 does not redirect and shows a permission error in place", async () => {
    globalThis.fetch = fetchWithStatus(403, { ok: false, error: "You don't have permission to view this section." });
    const { loadDynamicSection } = dynamicSection;
    const { container } = installBrowserGlobals();
    const result = await loadDynamicSection("settings", "account");
    expect(result).toBe(false);
    expect(globalThis.location.href).toBe("http://localhost/dashboard/settings/account");
    expect(container.innerHTML).toContain("You don&#39;t have permission");
    expect(container.hidden).toBe(false);
  });
});
