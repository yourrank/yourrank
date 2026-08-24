import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { UnifiedSettingsPage, SETTINGS_TABS } from "../pages/account.jsx";
import { chromeStateFor } from "../assets/dashboard/routes.js";

const accountJs = readFileSync(new URL("../assets/account.js", import.meta.url), "utf8");
const shellJs = readFileSync(new URL("../assets/dashboard/shell.js", import.meta.url), "utf8");

describe("account settings chrome synchronization", () => {
  it("keeps each settings tab label aligned with its chrome-owned H1", () => {
    for (const [tab, label] of SETTINGS_TABS) {
      const chrome = chromeStateFor("settings", tab, { exact: true });
      const html = UnifiedSettingsPage({ activePath: `/dashboard/settings/${tab}`, tab, user: { email: "test@example.com" } }).toString();
      expect(chrome?.tabLabel, tab).toBe(label);
      expect(html, tab).toContain(`<h1 data-chrome-h1="true">${label}</h1>`);
    }
  });

  it("owns route chrome repaint in the canonical shell navigation module", () => {
    const helper = shellJs.slice(shellJs.indexOf("export function syncRouteChrome"));
    expect(shellJs).toMatch(/export function syncRouteChrome\(page, tab = ""\)/);
    expect(helper).toContain("setActiveSideNav");
    expect(helper).toContain("routeCrumbs");
    expect(shellJs).toContain('document.querySelector("[data-chrome-h1]")');
    expect(shellJs).toContain("chrome?.tabLabel");
    expect(helper).toContain("document.title");
    expect(accountJs).toContain("syncRouteChrome");
    expect(accountJs).toContain('syncRouteChrome("settings", tab)');
    expect(accountJs).toContain('const tab = parseDynamicPath(location.pathname)?.tab || "account";');
    expect(accountJs).toContain("select(tab);");
    expect(accountJs).not.toContain("document.title");
    expect(accountJs).not.toContain("chromeStateFor");
    expect(accountJs).not.toContain("tabLabel");
    expect(accountJs).not.toContain("crumbs");
  });
});
