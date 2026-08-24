// Leaderboard editor has exactly ONE delivery/rendering implementation.
//
// The editor is a core SPA section of the persistent dashboard document:
// the Worker serves PAGES.dashboard for every editor route, DashboardContent
// renders one `data-page="board"` body inside the canonical shell, and the
// shell owns the guarded editor-tab boot path. It is NOT a standalone
// document, NOT a fragment, and has no duplicate body, renderer, or boot path.
//
// This gate fails if the editor regains a standalone/fragment/duplicate
// implementation or if route and tab semantics drift away from the manifest.
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
  defaultTab,
  isDynamicSection,
  legacyDashboardPath,
  parseDashboardPath,
  parseDynamicPath,
} from "../assets/dashboard/routes.js";

const SRC_ROOT = path.resolve(import.meta.dir, "..");
const BOARD_PATH = "/dashboard/leaderboard";
const BOARD_TABS = ["setup", "players", "design", "share", "history"];
const BOARD_ROUTES = [
  { id: "board", path: BOARD_PATH, tab: "" },
  { id: "board.setup", path: `${BOARD_PATH}/setup`, tab: "setup" },
  { id: "board.players", path: `${BOARD_PATH}/players`, tab: "players" },
  { id: "board.design", path: `${BOARD_PATH}/design`, tab: "design" },
  { id: "board.share", path: `${BOARD_PATH}/share`, tab: "share" },
  { id: "board.history", path: `${BOARD_PATH}/history`, tab: "history" },
];
const BOARD_LABELS = {
  setup: "Setup",
  players: "Players",
  design: "Appearance",
  share: "Share",
  history: "History",
};

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
  return out.sort((a, b) => {
    const left = path.relative(SRC_ROOT, a);
    const right = path.relative(SRC_ROOT, b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function relativeFiles(files) {
  return files
    .map((file) => path.relative(SRC_ROOT, file))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function sortTuples(rows) {
  return rows.slice().sort((left, right) => {
    if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
    return left[1] - right[1];
  });
}

function executableSource(source) {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

function editorStepAnchors(html) {
  return [...html.matchAll(/<a\b[^>]*>[^<]*<\/a>/g)]
    .map(([markup]) => ({
      markup,
      href: markup.match(/\bhref="([^"]+)"/)?.[1] || "",
      key: markup.match(/\bdata-egroup="([^"]+)"/)?.[1] || "",
      label: markup.match(/<a\b[^>]*>([^<]*)<\/a>/)?.[1] || "",
    }))
    .filter(({ markup }) => /\bclass="[^"]*\beditor-step\b/.test(markup));
}

function withoutComments(source) {
  return source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
}

describe("manifest: Leaderboard editor delivery identity", () => {
  it("declares exactly the six board SPA routes", () => {
    const boardRoutes = DASHBOARD_ROUTES.filter(({ section }) => section === "board");
    expect(boardRoutes.map(({ id }) => id)).toEqual(BOARD_ROUTES.map(({ id }) => id));
    for (const expected of BOARD_ROUTES) {
      const route = routeById(expected.id);
      expect({
        canonicalPath: route.canonicalPath,
        section: route.section,
        navKey: route.navKey,
        owner: route.owner,
        delivery: route.delivery,
        scope: route.scope,
        navParams: route.navParams,
      }).toEqual({
        canonicalPath: expected.path,
        section: "board",
        navKey: "board",
        owner: "leaderboard",
        delivery: "spa-section",
        scope: "site",
        navParams: ["board"],
      });
      expect(route.delivery).not.toBe("fragment");
    }
  });

  it("pins the six legacy editor redirects", () => {
    const aliases = DASHBOARD_ROUTE_ALIASES
      .filter(({ routeId }) => /^board(?:\.|$)/.test(routeId))
      .map((alias) => ({
        path: alias.path,
        routeId: alias.routeId,
        kind: alias.kind,
        status: alias.status,
        search: alias.search,
      }));
    expect(aliases).toEqual([
      { path: "/dashboard/editor", routeId: "board", kind: "redirect", status: 301, search: "preserve" },
      { path: "/dashboard/editor/setup", routeId: "board.setup", kind: "redirect", status: 301, search: "preserve" },
      { path: "/dashboard/editor/players", routeId: "board.players", kind: "redirect", status: 301, search: "preserve" },
      { path: "/dashboard/editor/design", routeId: "board.design", kind: "redirect", status: 301, search: "preserve" },
      { path: "/dashboard/editor/share", routeId: "board.share", kind: "redirect", status: 301, search: "preserve" },
      { path: "/dashboard/editor/history", routeId: "board.history", kind: "redirect", status: 301, search: "preserve" },
    ]);
  });
});

describe("server: Leaderboard editor resolves to the one dashboard document owner", () => {
  it("maps every editor path to the board section and expected tab", () => {
    for (const { path: pathname, tab } of BOARD_ROUTES) {
      expect(parseDashboardPath(pathname)).toEqual({ page: "board", tab });
      expect(parseDashboardPath(`${pathname}/`)).toEqual({ page: "board", tab });
    }
  });

  it("does not serve editor paths as fragments or dynamic sections", () => {
    for (const { path: pathname } of BOARD_ROUTES) {
      expect(resolveFragment(pathname)).toBeNull();
      expect(resolveFragment(`${pathname}/`)).toBeNull();
      expect(resolveFragment(`${pathname}?board=site-1`)).toBeNull();
      expect(parseDynamicPath(pathname)).toBeNull();
      expect(parseDynamicPath(`${pathname}/`)).toBeNull();
    }
  });

  it("canonicalizes the legacy editor redirect", () => {
    expect(legacyDashboardPath("/dashboard/editor/players")).toBe(`${BOARD_PATH}/players`);
  });

  it("has no editor Worker path literal or dedicated page", () => {
    const indexSource = readFileSync(path.join(SRC_ROOT, "index.js"), "utf8");
    expect(withoutComments(indexSource).match(/["'`]\/dashboard\/leaderboard/g) || []).toHaveLength(0);
    expect(Object.keys(PAGES).filter((key) => /^(board|editor|leaderboard)$/i.test(key))).toEqual([]);
    expect(PAGES.dashboard).toBe(dashboardPage);
  });
});

describe("client: editor step semantics come from the manifest", () => {
  it("uses the manifest tab order and default", () => {
    expect(SECTIONS.board.tabs).toEqual(BOARD_TABS);
    expect(defaultTab("board")).toBe("setup");
    expect(isDynamicSection("board")).toBe(false);
    expect(Object.keys(DYNAMIC_SECTIONS)).not.toContain("board");
  });

  it("computes the complete canonical chrome state for every editor route", () => {
    const expected = [
      {
        routeId: "board",
        tab: "",
        canonicalPath: BOARD_PATH,
        tabLabel: "",
        documentTitle: "Leaderboard · YourRank",
        crumbs: [
          { label: "Leaderboard", href: BOARD_PATH },
          { label: "Setup" },
        ],
      },
      ...BOARD_TABS.map((tab) => ({
        routeId: `board.${tab}`,
        tab,
        canonicalPath: `${BOARD_PATH}/${tab}`,
        tabLabel: BOARD_LABELS[tab],
        documentTitle: `${BOARD_LABELS[tab]} · Leaderboard · YourRank`,
        crumbs: [
          { label: "Leaderboard", href: BOARD_PATH },
          { label: BOARD_LABELS[tab] },
        ],
      })),
    ];
    for (const route of expected) {
      expect(chromeStateFor("board", route.tab, { exact: true })).toEqual({
        ...route,
        navKey: "board",
        section: "board",
        h1: null,
      });
    }
  });
});

describe("markup: one editor body and one step nav", () => {
  it("renders one body and exactly one active step for every editor path", () => {
    const user = { display_name: "Test operator", plan: "pro" };
    for (const route of BOARD_ROUTES) {
      const html = DashboardContent({ user, activePath: route.path }).toString();
      expect(html.match(/data-page="board"/g)).toHaveLength(1);
      expect(html.match(/id="editorTabs"/g)).toHaveLength(1);
      const steps = editorStepAnchors(html);
      expect(steps.map(({ key, label, href }) => ({ key, label, href }))).toEqual(
        BOARD_TABS.map((tab) => ({ key: tab, label: BOARD_LABELS[tab], href: `${BOARD_PATH}/${tab}` })),
      );
      const active = steps.filter(({ markup }) =>
        /\bis-active\b/.test(markup) && /aria-current="page"/.test(markup),
      );
      expect(active).toHaveLength(1);
      expect(active[0].key).toBe(route.tab || defaultTab("board"));
    }
  });

  it("keeps one inactive editor body on a non-board route", () => {
    const html = DashboardContent({
      user: { display_name: "Test operator", plan: "pro" },
      activePath: "/dashboard/analytics",
    }).toString();
    expect(html.match(/data-page="board"/g)).toHaveLength(1);
    expect(html).toContain('<section class="lb-page" data-page="board">');
    // Current DashboardContent passes showTabs to every section, so the
    // inactive editor still contains its server-rendered step nav.
    expect(html.match(/id="editorTabs"/g)).toHaveLength(1);
  });

  it("declares the editor body and step nav in exactly one source file", () => {
    const files = sourceFiles();
    const bodyEmitters = files.filter((file) =>
      /<section\b[^>]*\bdata-page="board"/.test(readFileSync(file, "utf8")),
    );
    const navEmitters = files.filter((file) =>
      /<nav\b[^>]*\bid="editorTabs"/.test(readFileSync(file, "utf8")),
    );
    expect(relativeFiles(bodyEmitters)).toEqual(["pages/dashboard.jsx"]);
    expect(relativeFiles(navEmitters)).toEqual(["pages/dashboard.jsx"]);
  });
});

describe("boot: one editor initialization ownership path", () => {
  it("defines setupEditorTabs exactly once in shell.js", () => {
    const definitions = sourceFiles().filter((file) =>
      /export function setupEditorTabs\(/.test(readFileSync(file, "utf8")),
    );
    expect(relativeFiles(definitions)).toEqual(["assets/dashboard/shell.js"]);
  });

  it("calls setupEditorTabs from exactly one site", () => {
    const callers = [];
    for (const file of sourceFiles()) {
      const source = executableSource(readFileSync(file, "utf8"));
      const calls = (source.match(/\bsetupEditorTabs\(\s*\)/g) || []).length
        - (source.match(/export function setupEditorTabs\(/g) || []).length;
      if (calls > 0) callers.push([path.relative(SRC_ROOT, file), calls]);
    }
    expect(sortTuples(callers)).toEqual([["assets/dashboard/shell.js", 1]]);
  });

  it("calls setupShell from exactly one dashboard entry point", () => {
    const callers = [];
    for (const file of sourceFiles()) {
      const source = executableSource(readFileSync(file, "utf8"));
      const calls = (source.match(/\bsetupShell\(\s*\)/g) || []).length
        - (source.match(/export function setupShell\(/g) || []).length;
      if (calls > 0) callers.push([path.relative(SRC_ROOT, file), calls]);
    }
    expect(sortTuples(callers)).toEqual([["assets/dashboard.js", 1]]);
  });

  it("boots the editor only behind the single board section guard", () => {
    const owners = [];
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      const count = (source.match(/hasSection\(\s*["']board["']\s*\)/g) || []).length;
      if (count > 0) owners.push([path.relative(SRC_ROOT, file), count]);
    }
    expect(sortTuples(owners)).toEqual([["assets/dashboard.js", 1]]);
  });

  it("keeps editorTabs DOM lookup in shell.js only", () => {
    const owners = sourceFiles().filter((file) =>
      /document\.getElementById\(\s*["']editorTabs["']\s*\)/.test(readFileSync(file, "utf8")),
    );
    expect(relativeFiles(owners)).toEqual(["assets/dashboard/shell.js"]);
  });
});

describe("semantics: editor route vocabulary stays canonical", () => {
  it("removes dead and duplicated page-local tab semantics", () => {
    const pageSource = readFileSync(path.join(SRC_ROOT, "pages/dashboard.jsx"), "utf8");
    expect(pageSource).not.toContain("EDITOR_TABS");
    expect(pageSource).not.toMatch(/\[\s*["']setup["']\s*,\s*["']players["']\s*,\s*["']design["']\s*,\s*["']share["']\s*,\s*["']history["']\s*\]/);
    const boardTabsStart = pageSource.indexOf("export const BOARD_TABS");
    const boardTabsEnd = pageSource.indexOf("function LeaderboardTabs", boardTabsStart);
    expect(boardTabsStart).toBeGreaterThanOrEqual(0);
    expect(boardTabsEnd).toBeGreaterThan(boardTabsStart);
    expect(pageSource.slice(boardTabsStart, boardTabsEnd)).not.toMatch(
      /\/dashboard\/leaderboard\/(?:setup|players|design|share|history)/,
    );
  });

  it("removes literal setup fallbacks from shell.js", () => {
    const shellSource = readFileSync(path.join(SRC_ROOT, "assets/dashboard/shell.js"), "utf8");
    expect(shellSource).not.toMatch(/["']setup["']/);
  });
});
