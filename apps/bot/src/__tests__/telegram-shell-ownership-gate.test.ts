// Telegram has exactly ONE authenticated dashboard shell implementation.
//
// Telegram pages are full documents served by the bot Worker, but their
// authenticated document uses the canonical shared dashboard shell. The bot
// owns only its page tabs and panel bodies; it is NOT allowed to grow a second
// rail, topbar, breadcrumb, profile menu, drawer runtime, title computation,
// or shell route/label table.
//
// This gate fails if Telegram regains duplicate dashboard shell markup/runtime
// or if the shell identity drifts away from the shared chrome-state owners.
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DEFAULT_DASHBOARD_TITLE } from "@yourrank/shared/dashboard-chrome-state";
import { dashboardNavItems } from "@yourrank/shared/dashboard-nav";
import { crumbsHtml, navListHtml } from "@yourrank/shared/dashboard-chrome";
import { botPageHtml } from "@yourrank/shared/page-shell";
import { appHtml, clientScriptSource, loginHtml } from "../dashboard-views.js";
import { botNavItems, pageLinks, telegramChrome } from "../dashboard-views/shell.js";

const SRC_ROOT = path.resolve(import.meta.dir, "..");
const PAGES = ["overview", "bots", "commands", "offers", "broadcasts"] as const;
const USER = { display_name: "Creator", email: "creator@example.com", plan: "pro" };
const BASE_URL = "https://yourrank.site";

const SHELL_MARKERS = [
  /v3-dash/,
  /class="lb-shell\b/,
  /class="lb-side\b/,
  /class="lb-topbar"/,
  /class="lb-bento\b/,
  /class="lb-side-brandrow\b/,
  /class="v3-crumbs\b/,
  /gm-shell-nav/,
  /class="gm-profile\b/,
];

function sourceFiles(dir = SRC_ROOT, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      sourceFiles(full, out);
      continue;
    }
    if (!/\.ts$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

function relativeFiles(files: string[]): string[] {
  return files
    .map((file) => path.relative(SRC_ROOT, file))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

function appPage(page: string): string {
  return appHtml(USER, BASE_URL, "nonce123", page, undefined, {
    botUsername: "creator_bot",
    botStatus: "active",
    siteName: "Main site",
  });
}

function navLinks(html: string): Array<{ markup: string; href: string; label: string }> {
  return [...html.matchAll(/<a\b([^>]*)href="([^"]+)"[^>]*>([^<]*)<\/a>/g)]
    .map(([markup, _attrs, href, label]) => ({ markup, href, label }))
    .filter(({ markup }) => markup.includes('class="v3-tab'));
}

describe("Telegram shell: one canonical authenticated document", () => {
  it("renders one shared shell for every Telegram page", () => {
    for (const page of PAGES) {
      const html = appPage(page);
      expect(html.match(/<div class="v3-dash"[^>]*data-auth-workspace="true"[^>]*data-shell-drawer="shared"/g)).toHaveLength(1);
      expect(html.match(/id="lbSide"/g)).toHaveLength(1);
      expect(html.match(/class="lb-topbar"/g)).toHaveLength(1);
      expect(html.match(/<main\b/g)).toHaveLength(1);
      expect(html.match(/class="v3-crumbs"/g)).toHaveLength(1);
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html.match(/<details[^>]*class="[^"]*\bgm-profile\b[^"]*"/g)).toHaveLength(1);
      expect(html).toContain('<script src="/assets/shell-nav.js" defer></script>');
    }
  });

  it("gets title, heading, crumbs, and rail identity from shared owners", () => {
    for (const page of PAGES) {
      const state = telegramChrome(page);
      const html = appPage(page);
      expect(html.match(/<title>([^<]*)<\/title>/)?.[1]).toBe(state.documentTitle);
      expect(html).toContain(`<h1>${state.h1}</h1>`);
      expect(html).toContain(crumbsHtml([...state.crumbs], state.canonicalPath));
      expect(html).toContain(navListHtml(dashboardNavItems(), state.navKey, "Telegram"));
      expect(html).toContain(navListHtml(botNavItems(), state.navKey, "Telegram"));
      expect(html).toContain(`data-nav="${state.navKey}"`);
    }
  });

  it("supports an escaped canonical title and the shared fallback", () => {
    const escaped = botPageHtml({
      user: USER,
      page: "overview",
      documentTitle: '<Title & "quoted">',
      content: "",
    });
    expect(escaped).toContain("<title>&lt;Title &amp; &quot;quoted&quot;&gt;</title>");

    const fallback = botPageHtml({ user: USER, page: "overview", content: "" });
    expect(fallback).toContain(`<title>${DEFAULT_DASHBOARD_TITLE}</title>`);
  });
});

describe("Telegram body ownership and navigation", () => {
  it("keeps the five Telegram tabs and each page body", () => {
    for (const page of PAGES) {
      const html = appPage(page);
      const links = navLinks(html);
      expect(links).toHaveLength(PAGES.length);
      expect(links.map(({ href, label }) => [href, label])).toEqual(
        pageLinks.map(({ href, label }) => [href, label]),
      );
      expect(links.filter(({ markup }) => markup.includes('aria-current="page"'))).toHaveLength(1);
      expect(links.find(({ markup }) => markup.includes('aria-current="page"'))?.href)
        .toBe(pageLinks.find(({ key }) => key === page)?.href);
      expect(html.match(new RegExp(`<div class="lb-bento" data-page="${page}"`, "g"))).toHaveLength(1);
    }
  });

  it("does not let the login surface become a dashboard shell", () => {
    const html = loginHtml("testbot", true, "nonce123");
    for (const marker of SHELL_MARKERS) expect(html).not.toMatch(marker);
    expect(html).not.toMatch(/<aside\b|<nav\b|data-nav=|id="lbSide"/);
  });
});

describe("Telegram source ownership", () => {
  it("keeps shell structural markup out of bot-owned sources", () => {
    const emitters = sourceFiles()
      .filter((file) => !path.relative(SRC_ROOT, file).startsWith("dashboard-views/pages/"))
      .filter((file) => {
        const source = stripComments(readFileSync(file, "utf8"));
        return SHELL_MARKERS.some((marker) => marker.test(source));
      });
    expect(relativeFiles(emitters)).toEqual([]);
  });

  it("keeps dashboard path literals out of Telegram shell view owners", () => {
    const shellOwners = sourceFiles().filter((file) => {
      const relative = path.relative(SRC_ROOT, file);
      return relative === "dashboard-views/app.ts" || relative === "dashboard-views/shell.ts";
    });
    const offenders = shellOwners.filter((file) =>
      /["'`]\/dashboard(?:\/|["'`])/.test(stripComments(readFileSync(file, "utf8"))),
    );
    expect(relativeFiles(offenders)).toEqual([]);
  });

  it("keeps shared shell and chrome-state calls as the only shell owners", () => {
    const appSource = readFileSync(path.join(SRC_ROOT, "dashboard-views/app.ts"), "utf8");
    const shellSource = readFileSync(path.join(SRC_ROOT, "dashboard-views/shell.ts"), "utf8");
    expect(appSource.match(/dashboardChromeHtml\(/g)).toHaveLength(1);
    expect(appSource).toContain("documentTitle: chromeState.documentTitle");
    expect(shellSource.match(/dashboardChromeState\(/g)).toHaveLength(2);
    expect(stripComments(appSource)).not.toContain("Telegram · YourRank");
    expect(stripComments(shellSource)).not.toContain("Telegram · YourRank");
  });
});

describe("Telegram client runtime: shared shell owns the drawer", () => {
  it("contains no duplicate drawer, profile, logout, or title runtime", () => {
    const source = clientScriptSource();
    for (const token of [
      "lbSide",
      "lbMenu",
      "data-collapse-side",
      "data-close-side",
      "lb-backdrop",
      "gm-logout-form",
      "gm-profile",
    ]) {
      expect(source).not.toContain(token);
    }
    expect(source).not.toMatch(/document\.title\s*=/);
    expect(source).not.toMatch(/classList\.(?:toggle|add|remove)\(\s*["']is-open["']/);
  });
});
