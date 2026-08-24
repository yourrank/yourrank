import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dashboardChromeState } from "@yourrank/shared/dashboard-chrome-state";
import { pageLinks, telegramChrome } from "../dashboard-views/shell.js";
import { appHtml } from "../dashboard-views/app.js";

// PR-4 regression gate: Telegram dashboard chrome derives from the canonical
// chrome-state owner. No local route→label/crumb/path tables may return.

describe("telegram chrome state", () => {
  it("derives every page link from the canonical chrome state", () => {
    expect(pageLinks.map((l) => [l.key, l.label, l.href])).toEqual([
      ["overview", "Overview", "/dashboard/telegram"],
      ["bots", "Bots", "/dashboard/telegram/bots"],
      ["commands", "Commands", "/dashboard/telegram/commands"],
      ["offers", "Offers", "/dashboard/telegram/offers"],
      ["broadcasts", "Broadcasts", "/dashboard/telegram/broadcasts"],
    ]);
    for (const link of pageLinks) {
      const chrome = telegramChrome(link.key);
      expect(link.label).toBe(chrome.h1 as string);
      expect(link.href).toBe(chrome.canonicalPath);
    }
  });

  it("resolves unknown pages to the Overview chrome", () => {
    expect(telegramChrome("nope").routeId).toBe("telegram");
    expect(telegramChrome("bots").routeId).toBe("telegram.bots");
  });

  it("renders the canonical crumbs, H1 and active path", () => {
    const user = { display_name: "Test", email: "test@example.com", plan: "free" };
    const html = appHtml(user, "https://yourrank.site", "nonce", "bots");
    const chrome = dashboardChromeState("telegram.bots");
    expect(html).toContain('<a href="/dashboard/telegram">Telegram</a>');
    expect(html).toContain(`<span aria-current="page">${chrome.h1}</span>`);
    expect(html).toContain(`<h1>${chrome.h1}</h1>`);
  });

  it("keeps the shell free of local route/label tables", () => {
    const src = readFileSync(new URL("../dashboard-views/shell.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    // No path literals: addressing goes through the manifest route ids.
    expect(/["'`]\/dashboard/.test(src)).toBe(false);
    // No crumb literals in the app shell either.
    const app = readFileSync(new URL("../dashboard-views/app.ts", import.meta.url), "utf8");
    expect(/crumbs:\s*\[\s*\{/.test(app)).toBe(false);
  });
});
