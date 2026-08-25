// Sites list has exactly ONE delivery/rendering implementation.
//
// Sites list is a core SPA section of the persistent dashboard document:
// the Worker serves PAGES.dashboard for its route, DashboardContent renders
// one `data-page="boards"` body inside the canonical shell, and the guarded
// boards boot/data path owns its rendering. It is NOT a standalone document,
// NOT a fragment, and has no duplicate body, renderer, or boot path.
//
// This gate fails if Sites list regains a standalone/fragment/duplicate
// implementation or if route semantics drift away from the manifest.
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  DASHBOARD_ROUTE_ALIASES,
  DASHBOARD_ROUTES,
  routeById,
} from "@yourrank/shared/dashboard-routes";
import { PAGES } from "../pages.jsx";
import { DashboardContent, dashboardPage } from "../pages/dashboard.jsx";
import { resolveFragment } from "../index.js";
import {
  DYNAMIC_SECTIONS,
  SECTIONS,
  chromeStateFor,
  isDynamicSection,
  legacyDashboardPath,
  parseDashboardPath,
  parseDynamicPath,
} from "../assets/dashboard/routes.js";

const SRC_ROOT = path.resolve(import.meta.dir, "..");
const BOARDS_PATH = "/dashboard/leaderboards";
const BOARDS_PATHS = [BOARDS_PATH, "/dashboard/sites"];

/** Every .js/.jsx source file under src, excluding tests and the generated bundle. */
function sourceFiles(dir = SRC_ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      sourceFiles(full, out);
      continue;
    }
    if (!/\.(js|jsx)$/.test(name)) continue;
    if (name === "assets_bundled.js") continue;
    out.push(full);
  }
  return out;
}

/**
 * Source paths relative to src, sorted by code point so assertions never
 * depend on the filesystem's readdir order (which differs between machines).
 */
function relativeFiles(files) {
  return files.map((file) => path.relative(SRC_ROOT, file)).sort();
}

/** [file, count] tuples sorted by code point, for the same reason. */
function sortByFile(entries) {
  return [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

describe("manifest: Sites-list delivery identity", () => {
  it("declares the canonical account-owned SPA route", () => {
    expect(routeById("boards")).toEqual({
      id: "boards",
      canonicalPath: BOARDS_PATH,
      section: "boards",
      navKey: "sites",
      owner: "leaderboard",
      delivery: "spa-section",
      scope: "account",
      navParams: ["board"],
    });
  });

  it("contains exactly one boards route and the pinned legacy aliases", () => {
    const boardsRoutes = DASHBOARD_ROUTES.filter(({ section }) => section === "boards");
    expect(boardsRoutes.map(({ id }) => id)).toEqual(["boards"]);
    expect(boardsRoutes[0].delivery).toBe("spa-section");
    expect(boardsRoutes[0].delivery).not.toBe("fragment");

    const boardsAliases = DASHBOARD_ROUTE_ALIASES
      .filter(({ routeId }) => routeId === "boards")
      .map((alias) => ({
        path: alias.path,
        kind: alias.kind,
        ...(alias.status ? { status: alias.status } : {}),
        ...(alias.search ? { search: alias.search } : {}),
      }));
    expect(boardsAliases).toEqual([
      { path: "/dashboard/boards", kind: "redirect", status: 301, search: "preserve" },
      { path: "/dashboard/sites", kind: "rewrite" },
    ]);
  });
});

describe("server: Sites list resolves to the one dashboard document owner", () => {
  it("maps canonical and rewrite paths to the boards section", () => {
    for (const pathname of BOARDS_PATHS) {
      expect(parseDashboardPath(pathname)).toEqual({ page: "boards", tab: "" });
    }
    expect(parseDashboardPath(`${BOARDS_PATH}/`)).toEqual({ page: "boards", tab: "" });
  });

  it("canonicalizes the legacy redirect path", () => {
    expect(legacyDashboardPath("/dashboard/boards")).toBe(BOARDS_PATH);
  });

  it("does not serve any Sites-list path as a fragment", () => {
    for (const pathname of BOARDS_PATHS) {
      expect(resolveFragment(pathname)).toBeNull();
      expect(resolveFragment(`${pathname}/`)).toBeNull();
      expect(resolveFragment(`${pathname}?board=site-1`)).toBeNull();
    }
  });

  it("has no Sites-list Worker path literal or dedicated page", () => {
    const indexSource = readFileSync(path.join(SRC_ROOT, "index.js"), "utf8");
    expect(indexSource.match(/\/dashboard\/leaderboards/g) || []).toHaveLength(0);
    expect(Object.keys(PAGES).filter((key) => /^(boards|sites|leaderboards)$/i.test(key))).toEqual([]);
    expect(PAGES.dashboard).toBe(dashboardPage);
  });
});

describe("client: Sites list is a core SPA section, not a second delivery path", () => {
  it("uses the canonical path and declares no tabs", () => {
    expect(SECTIONS.boards.path).toBe(BOARDS_PATH);
    expect(SECTIONS.boards.tabs).toBeUndefined();
  });

  it("is not a dynamic section for either Sites-list path", () => {
    expect(isDynamicSection("boards")).toBe(false);
    expect(Object.keys(DYNAMIC_SECTIONS)).not.toContain("boards");
    for (const pathname of BOARDS_PATHS) {
      expect(parseDynamicPath(pathname)).toBeNull();
    }
  });

  it("computes the canonical Sites-list chrome state", () => {
    expect(chromeStateFor("boards", "")).toEqual({
      routeId: "boards",
      navKey: "sites",
      section: "boards",
      tab: "",
      canonicalPath: BOARDS_PATH,
      crumbs: [{ label: "Sites" }],
      tabLabel: "",
      documentTitle: "Sites · YourRank",
      h1: null,
    });
  });
});

describe("markup: one Sites-list body", () => {
  it("renders one active body on the canonical Sites-list route", () => {
    const html = DashboardContent({
      user: { display_name: "Test operator", plan: "pro" },
      activePath: BOARDS_PATH,
    }).toString();
    expect(html.match(/data-page="boards"/g)).toHaveLength(1);
    expect(html.match(/id="boardsBody"/g)).toHaveLength(1);
    expect(html.match(/id="boardsEmpty"/g)).toHaveLength(1);
    expect(html.match(/id="boardsSearch"/g)).toHaveLength(1);
    expect(html).toContain('<section class="lb-page is-on" data-page="boards">');
  });

  it("keeps one inactive Sites-list body on non-boards routes", () => {
    const html = DashboardContent({
      user: { display_name: "Test operator", plan: "pro" },
      activePath: "/dashboard/leaderboard/setup",
    }).toString();
    expect(html.match(/data-page="boards"/g)).toHaveLength(1);
    expect(html).toContain('<section class="lb-page" data-page="boards">');
  });

  it("declares each Sites-list body marker in exactly one source file", () => {
    const files = sourceFiles();
    const sectionEmitters = files.filter((file) =>
      /<section\b[^>]*\bdata-page="boards"/.test(readFileSync(file, "utf8")),
    );
    const bodyEmitters = files.filter((file) =>
      /<[A-Za-z][^>]*\bid="boardsBody"/.test(readFileSync(file, "utf8")),
    );
    expect(relativeFiles(sectionEmitters)).toEqual(["pages/dashboard.jsx"]);
    expect(relativeFiles(bodyEmitters)).toEqual(["pages/dashboard.jsx"]);
  });
});

describe("boot/render/data: one Sites-list path", () => {
  it("defines renderBoardsPage exactly once in boards.js", () => {
    const definitions = sourceFiles().filter((file) =>
      /export function renderBoardsPage\(/.test(readFileSync(file, "utf8")),
    );
    expect(relativeFiles(definitions)).toEqual(["assets/dashboard/boards.js"]);
  });

  it("calls renderBoardsPage only from its pinned modules", () => {
    const callers = [];
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      const calls = (source.match(/renderBoardsPage\(/g) || []).length
        - (source.match(/export function renderBoardsPage\(/g) || []).length;
      if (calls > 0) callers.push([path.relative(SRC_ROOT, file), calls]);
    }
    expect(sortByFile(callers)).toEqual([
      ["assets/dashboard.js", 1],
      ["assets/dashboard/boards.js", 1],
      ["assets/dashboard/site.js", 3],
    ]);
  });

  it("assigns state.BOARDS only from the bootstrap owner", () => {
    const assignments = [];
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      const count = (source.match(/\bstate\.BOARDS\s*=/g) || []).length;
      if (count > 0) assignments.push([path.relative(SRC_ROOT, file), count]);
    }
    expect(sortByFile(assignments)).toEqual([["assets/dashboard.js", 1]]);
  });

  it("keeps the Sites-list DOM ids owned by boards.js", () => {
    const idReference = /\b(?:boardsBody|boardsEmpty|boardsSearch)\b/;
    const javascriptFiles = sourceFiles().filter((file) => file.endsWith(".js"));
    const owners = javascriptFiles.filter((file) => idReference.test(readFileSync(file, "utf8")));
    expect(relativeFiles(owners)).toEqual(["assets/dashboard/boards.js"]);
  });

  it("routes the site selector to the Sites list without raw location navigation", () => {
    const selectorFile = path.join(SRC_ROOT, "assets/dashboard/site-selector.js");
    const selectorSource = readFileSync(selectorFile, "utf8");
    expect(selectorSource.match(/requestDashboardRoute\(\s*["']boards["']/g)).toHaveLength(1);

    const rawNavigations = sourceFiles().filter((file) =>
      /location\.(?:href\s*=|assign\s*\()[^;\n]*\/dashboard\/leaderboards/.test(readFileSync(file, "utf8")),
    );
    expect(relativeFiles(rawNavigations)).toEqual([]);
  });
});

describe("presentation: the Sites list stays a list", () => {
  const boardsJs = readFileSync(path.join(SRC_ROOT, "assets/dashboard/boards.js"), "utf8");
  const dashboardCss = readFileSync(path.join(SRC_ROOT, "assets/dashboard-v4.css"), "utf8");
  const sitesHtml = () =>
    DashboardContent({ user: { display_name: "Test operator", plan: "pro" }, activePath: BOARDS_PATH }).toString();

  it("uses one table-like structure with one creation action", () => {
    const html = sitesHtml();
    expect(html).toContain('class="v3-table sites-table"');
    expect(html.match(/id="newBoard"/g)).toHaveLength(1);
    expect(html).toContain(">Create site<");
    expect(html).not.toContain("New leaderboard");
  });

  it("gives each row one primary action and hides the rest behind a menu", () => {
    // Rows carry Manage; Duplicate and Delete live in the details menu so a
    // long list is not a wall of buttons.
    expect(boardsJs).toContain('data-action="edit"');
    expect(boardsJs).toContain('class="site-row-menu"');
    for (const action of ['data-action="dup"', 'data-action="del"']) {
      const menuBody = boardsJs.slice(boardsJs.indexOf("site-row-menu-body"), boardsJs.indexOf("</details>"));
      expect(menuBody).toContain(action);
    }
    expect(dashboardCss).toContain(".v3-dash[data-auth-workspace] .site-row-menu-body");
  });

  it("keeps the row menu out of any clipping or scrolling ancestor", () => {
    // A popover inside `.v3-table-scroll` (overflow:auto) was clipped, making
    // Delete unclickable, and the 980px `min-width: 680px` rule pushed the row
    // actions off-screen. The Sites table must therefore stay unwrapped.
    const sites = sitesHtml();
    const listStart = sites.indexOf('class="sites-list"');
    const list = sites.slice(listStart, sites.indexOf("</section>", listStart));
    expect(list).not.toContain("v3-table-scroll");
    expect(list).not.toContain("table-wrap");
    expect(dashboardCss).not.toMatch(/\.sites-list\s*{[^}]*overflow:\s*hidden/);
  });

  it("dismisses the row menu on Escape and on an outside pointer", () => {
    expect(boardsJs).toContain("wireRowMenuDismissal");
    const dismissal = boardsJs.slice(
      boardsJs.indexOf("function wireRowMenuDismissal"),
      boardsJs.indexOf("export function renderBoardsPage"),
    );
    expect(dismissal).toContain('"keydown"');
    expect(dismissal).toContain('event.key !== "Escape"');
    expect(dismissal).toContain('"pointerdown"');
  });

  it("stacks the rows instead of scrolling them sideways at narrow widths", () => {
    const narrow = dashboardCss.slice(dashboardCss.indexOf(".v3-dash[data-auth-workspace] .sites-table thead {"));
    expect(narrow).toContain("display: block");
    // Hidden rows must stay hidden while filtering.
    expect(narrow).toContain("tr:not([hidden])");
    expect(narrow).toContain('td[data-label="Players"]::before');
  });

  it("keeps an empty, searching and error surface for the list", () => {
    // Every asynchronous list state has somewhere to render.
    expect(sitesHtml()).toContain('id="boardsEmpty" class="v3-empty" hidden');
    expect(boardsJs).toContain('title: "No sites yet"');
    expect(boardsJs).toContain('title: "No sites match your search"');
    expect(boardsJs).toContain('label: "Create site"');
  });

  it("adds no fixed or minimum width that could overflow a 320px viewport", () => {
    const homeAndSites = dashboardCss.slice(
      dashboardCss.indexOf(".v3-dash[data-auth-workspace] .ov-figures"),
      dashboardCss.indexOf(".v3-dash[data-auth-workspace] .site-row-menu-body"),
    );
    expect(homeAndSites.length).toBeGreaterThan(0);
    const widths = [...homeAndSites.matchAll(/(?:^|[;{\s])(?:min-)?width:\s*(\d+)px/g)].map((match) => Number(match[1]));
    for (const width of widths) expect(width).toBeLessThanOrEqual(288);
  });
});
