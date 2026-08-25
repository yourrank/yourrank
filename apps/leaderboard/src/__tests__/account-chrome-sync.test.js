import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { UnifiedSettingsPage, SETTINGS_TABS } from "../pages/account.jsx";
import { chromeStateFor } from "../assets/dashboard/routes.js";

const accountJs = readFileSync(new URL("../assets/account.js", import.meta.url), "utf8");
const shellJs = readFileSync(new URL("../assets/dashboard/shell.js", import.meta.url), "utf8");

function installShellGlobals() {
  const heading = { textContent: "" };
  const crumb = { innerHTML: "", remove: () => {} };
  const bento = {
    querySelector: () => null,
    prepend(node) { this.crumb = node; },
  };
  const rail = ["settings", "redemptions"].map((nav) => ({
    dataset: { nav },
    classList: { values: new Set(), toggle(name, on) { if (on) this.values.add(name); else this.values.delete(name); } },
    setAttribute() {},
    removeAttribute() {},
  }));
  const groups = [{ dataset: { area: "sites" }, hidden: false }];
  globalThis.document = {
    querySelector(selector) {
      if (selector === "[data-chrome-h1]") return heading;
      if (selector === ".lb-bento") return bento;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".lb-nav") return rail;
      if (selector === ".lb-side-group") return groups;
      return [];
    },
    createElement() {
      return {
        className: "",
        innerHTML: "",
        setAttribute() {},
      };
    },
    getElementById: () => null,
    addEventListener() {},
  };
  globalThis.location = {
    pathname: "/dashboard/settings/account",
    search: "",
    origin: "http://localhost:8787",
    href: "http://localhost:8787/dashboard/settings/account",
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.history = { replaceState() {}, pushState() {} };
  return { heading, bento, crumb, rail };
}

describe("account settings chrome synchronization", () => {
  it("keeps each settings tab label aligned with its chrome-owned H1", () => {
    for (const [tab, label] of SETTINGS_TABS) {
      const chrome = chromeStateFor("settings", tab, { exact: true });
      const html = UnifiedSettingsPage({ activePath: `/dashboard/settings/${tab}`, tab, user: { email: "test@example.com" } }).toString();
      expect(chrome?.tabLabel, tab).toBe(label);
      expect(html, tab).toContain(`<h1 data-chrome-h1="true">${label}</h1>`);
    }
  });

  it("synchronizes the H1, breadcrumbs, title, and active rail for settings tabs", async () => {
    const { heading, bento, rail } = installShellGlobals();
    const { syncRouteChrome } = await import("../assets/dashboard/shell.js");
    for (const [tab, label] of [["account", "Account"], ["team", "Team"], ["plan", "Billing"]]) {
      syncRouteChrome("settings", tab);
      const chrome = chromeStateFor("settings", tab, { exact: true });
      expect(chrome?.tabLabel, tab).toBe(label);
      expect(heading.textContent, tab).toBe(chrome.tabLabel);
      expect(bento.crumb.innerHTML, tab).toContain(`>${chrome.crumbs.at(-1).label}</span>`);
      expect(document.title, tab).toBe(chrome.documentTitle);
      expect(rail[0].classList.values.has("is-on"), tab).toBe(true);
    }
  });

  it("keeps chrome ownership in shell.js and delegates from Account", () => {
    expect(accountJs).toContain("syncRouteChrome");
    expect(accountJs).toContain('syncRouteChrome("settings", tab)');
    expect(accountJs).toContain('const tab = parseDynamicPath(location.pathname)?.tab || "account";');
    expect(accountJs).toContain("select(tab);");
    expect(accountJs).not.toContain("document.title");
    expect(accountJs).not.toContain("chromeStateFor");
    expect(accountJs).not.toContain("tabLabel");
    expect(accountJs).not.toContain("crumbs");
    expect(shellJs).toContain("heading.textContent = chrome.tabLabel");
  });
});
