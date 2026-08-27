import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderSite } from "@yourrank/shared/site-render";

const root = join(import.meta.dir, "../../../../");
const assets = join(root, "apps/leaderboard/src/assets");
const css = readFileSync(join(assets, "site-shell.css"), "utf8");
const shell = readFileSync(join(assets, "site-shell.js"), "utf8");

const player = (name, rank, wagered, prize) => ({ name, rank, wagered, prize });

const baseData = {
  brand: { name: "Creator Name", tagline: "Weekly board", period: "Monthly", prizePool: "$500" },
  branding: { template: "cyber_arcade", font: "Inter", options: {} },
  players: [player("Alice", 1, 5000, 300), player("Bob", 2, 3000, 150), player("Cara", 3, 1000, 50)],
  prizes: { currency: "$", wagerLabel: "Wagered", prizeLabel: "Prize" },
  socials: [],
  siteSections: { home: true, leaderboard: true, shop: true, games: false, me: true },
};

const seq = (count) => Array.from({ length: count }, (_, i) => player(`Player${i + 1}`, i + 1, 1000 - i, 0));

function render(section = "leaderboard", { data = baseData, viewer = null, viewerData = null, custom = false, playerCount } = {}) {
  const board = playerCount === undefined ? data : { ...data, playerCount };
  return renderSite({
    r: { slug: "creator", plan: "pro", data: board },
    section,
    viewer,
    viewerData,
    opts: { slug: "creator", homeUrl: "https://example.test", nonce: "n", isCustomDomain: custom },
  });
}

const rowsOf = (html) => html.match(/<li class="yr-srow[\s\S]*?<\/li>/g) || [];

describe("public leaderboard standings", () => {
  it("opens with one leaderboard heading and a generic state line", async () => {
    const html = await render();
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    expect(html).toContain('<h1 class="yr-h1 yr-lbh-title">Standings</h1>');
    expect(html).toContain('<span class="yr-lbh-state is-live">Live</span>');
    expect(html).toContain("<span>Monthly leaderboard</span>");
    // The count belongs to the list it counts, stated once above the rows.
    expect(html).toContain('<span data-player-count-badge>3 players</span>');
    expect((html.match(/3 players/g) || []).length).toBe(1);
    expect(html).toContain("Ranked by wagered. Tied players share a rank.");
    // The intro states the board, it does not become a KPI or prize hero.
    expect(html).not.toContain("yr-kpi");
    expect(html).not.toContain("yr-big");
    expect(html.indexOf('id="yr-search"')).toBeLessThan(html.indexOf("</main>"));
  });

  it("labels an upcoming and an ended board without inventing data", async () => {
    const soon = await render("leaderboard", { data: { ...baseData, scheduled: true, startsAt: new Date(Date.now() + 864e5).toISOString() } });
    expect(soon).toContain("Standings open soon");
    expect(soon).toContain('<span class="yr-lbh-state is-soon">Not started</span>');
    expect(soon).toContain("Starts in");

    const ended = await render("leaderboard", { data: { ...baseData, ended: true } });
    expect(ended).toContain("Final standings");
    expect(ended).toContain('<span class="yr-lbh-state is-ended">Ended</span>');
    expect(ended).not.toContain("Ends in");
  });

  it("says so plainly when the board has no players", async () => {
    const html = await render("leaderboard", { data: { ...baseData, players: [] } });
    // The empty board is a designed state: what is empty, and one line about
    // when it fills — not a sentence floating in a blank panel.
    expect(html).toContain('<p class="yr-empty-t">No players yet</p>');
    expect(html).toContain('<p class="yr-empty-p">The board fills in when');
    expect(rowsOf(html).length).toBe(0);
    expect(html).not.toContain('id="yr-search"');
    expect(html).not.toContain("data-load-more");
    expect(html).not.toContain("No players match that search.");

    const soon = await render("leaderboard", { data: { ...baseData, players: [], scheduled: true } });
    expect(soon).toContain('<p class="yr-empty-p">Standings fill in once the round starts.</p>');
  });

  it("ranks one player, three players and twenty players through the same rows", async () => {
    const one = await render("leaderboard", { data: { ...baseData, players: [player("Solo", 1, 10, 0)] } });
    expect(rowsOf(one).length).toBe(1);
    expect(one).toContain("<span data-player-count-badge>1 player</span>");
    expect(one).toContain('<span class="yr-srow-rank"><span class="yr-sr">Rank </span>1</span>');

    const three = await render();
    const rows = rowsOf(three);
    expect(rows.length).toBe(3);
    expect(rows[0]).toContain("yr-srow--first");
    expect(rows[1]).toContain("yr-srow--top");
    expect(rows[2]).toContain("yr-srow--top");

    const twenty = await render("leaderboard", { data: { ...baseData, players: seq(20) } });
    const many = rowsOf(twenty);
    expect(many.length).toBe(20);
    expect(many.filter((row) => row.includes("yr-srow--first")).length).toBe(1);
    expect(many[19]).not.toContain("yr-srow--top");
    // Restraint at the top of the board: rank typography, never trophy cards.
    for (const loud of ["yr-g3", "yr-card-name", "confetti", "trophy-wall"]) expect(twenty).not.toContain(loud);
  });

  it("announces each cell for a screen reader without repeating column labels", async () => {
    const html = await render();
    const [first] = rowsOf(html);
    expect(first).toContain('<span class="yr-sr">Rank </span>1');
    expect(first).toContain('<span class="yr-sr">Wagered: </span>');
    expect(first).toContain('<span class="yr-sr">Prize: </span>');
    expect(html).toContain('<div class="yr-stand-head" aria-hidden="true"');
    expect(html).toContain('<ol class="yr-stand" data-rows aria-label="Standings for Creator Name"');
    // A list of players, not a fake table.
    expect(html).not.toContain('role="table"');
    expect(html).not.toContain('role="row"');
    expect(html).not.toContain('role="cell"');
  });

  it("keeps long, unicode and emoji names safe and complete", async () => {
    const long = "L".repeat(100);
    const html = await render("leaderboard", {
      data: { ...baseData, players: [player(long, 1, 10, 0), player("Ω_игрок", 2, 9, 0), player("🎯 aim <b>", 3, 8, 0)] },
    });
    expect(html).toContain(`>${long}</a>`);
    expect(html).toContain(">Ω_игрок</a>");
    expect(html).toContain(">🎯 aim &lt;b&gt;</a>");
    expect(html).not.toContain("<b>");
    // Names wrap inside their own cell rather than widening the document.
    expect(css).toMatch(/\.yr-srow-name \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.yr-srow-name \{[^}]*min-width: 0/);
  });

  it("bounds an extreme username visually without shortening it anywhere", async () => {
    const long = "L".repeat(100);
    const html = await render("leaderboard", { data: { ...baseData, players: [player(long, 1, 1e12, 0)] } });
    // The whole name is the link text and the link target: nothing is cut.
    expect(html).toContain(`>${long}</a>`);
    expect(html).toContain(`/creator/player/${long}`);
    expect(html).not.toContain("…</a>");

    const nameRule = css.match(/\.yr-srow-name \{([^}]*)\}/)[1];
    // Two visible lines on a phone, so one username cannot build a 250px row.
    expect(nameRule).toContain("-webkit-line-clamp: 2");
    expect(nameRule).toContain("line-clamp: 2");
    expect(nameRule).toContain("-webkit-box-orient: vertical");
    expect(nameRule).toContain("overflow: hidden");
    // Identity keeps the row's primary width because a phone lets the secondary
    // values claim at most 10ch instead of reserving half the row for a figure.
    const rowRule = css.match(/\.yr-stand-head, \.yr-srow \{([^}]*)\}/)[1];
    expect(rowRule).toContain("grid-template-columns: minmax(2ch, auto) minmax(0, 1fr) auto");
    expect(css).toMatch(/\.yr-srow-val \{[^}]*max-width: 10ch/);
    expect(css).toMatch(/\.yr-srow-prize \{[^}]*max-width: 10ch/);
  });

  it("leaves normal names and the wide layout alone", async () => {
    const html = await render();
    expect(html).toContain('<a class="yr-srow-name" href="/creator/player/Alice">Alice</a>');
    // A one-line name still occupies the same 44px target as before.
    expect(css).toMatch(/\.yr-srow-name \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.yr-srow-name \{[^}]*line-height: 20px/);
    const wide = css.slice(css.indexOf("@media (min-width: 640px)"));
    expect(wide).toMatch(/\.yr-srow-name \{ -webkit-line-clamp: 3; line-clamp: 3; \}/);
    expect(wide).toMatch(/\.yr-srow-val, \.yr-srow-prize \{ max-width: none; \}/);
    expect(wide).toMatch(/grid-template-areas: "rank name val prize"/);
  });

  it("links players on slug sites and on custom domains", async () => {
    const slugged = await render();
    expect(slugged).toContain('<a class="yr-srow-name" href="/creator/player/Alice">Alice</a>');

    const custom = await render("leaderboard", { custom: true });
    expect(custom).toContain('<a class="yr-srow-name" href="/player/Alice">Alice</a>');
    expect(custom).not.toContain("/creator/player/");

    expect(shell).toContain('(isCustomDomain ? "/player/" : "/" + encodeURIComponent(slug) + "/player/")');
  });

  it("keeps search with the standings it filters and reports matches politely", async () => {
    const html = await render();
    expect(html).toContain('<label class="yr-sr" for="yr-search">Search players</label>');
    expect(html).toContain('placeholder="Search players by name"');
    expect(html.indexOf('id="yr-search"')).toBeGreaterThan(html.indexOf("</header>"));
    expect(html.indexOf('id="yr-search"')).toBeLessThan(html.indexOf('class="yr-stand"'));
    expect((html.match(/type="search"/g) || []).length).toBe(1);
    expect(html).toContain('<p class="yr-search-status" id="yr-search-status" role="status" aria-live="polite">');
    expect(css).toMatch(/\.yr-search \{[^}]*min-height: 44px/);
    expect(shell).toContain('setSearchStatus(plural(visiblePlayerCount()) + " match');
    // Search takes the standings module's width on every viewport: no desktop
    // cap that stops it short of the panel and leaves the composition open.
    expect(css).toMatch(/\.yr-search \{[^}]*width: 100%/);
    expect(css).not.toMatch(/\.yr-search-row \.yr-search \{[^}]*max-width/);
    // The count stays as quiet metadata at the top of the panel, to the side.
    expect(html).toContain('<span data-player-count-badge>3 players</span>');
    expect(css).toMatch(/\.yr-panel-head--quiet \{[^}]*justify-content: flex-end/);
  });

  it("keeps the no-match, failure and cleared states of search honest", async () => {
    const html = await render();
    expect(html).toContain('<p class="yr-nomatch" id="yr-no-match" hidden>No players match that search.</p>');
    expect(shell).toContain('setSearchStatus("Searching…")');
    expect(shell).toContain('setSearchStatus("Couldn’t search players.", true)');
    expect(shell).toContain("addRetry(searchStatus, function () { search.dispatchEvent(new Event(\"input\", { bubbles: true })); })");
    expect(shell).toContain("if (rowsRoot && savedRowsHtml) rowsRoot.innerHTML = savedRowsHtml;");
    expect(shell).toContain("updatePlayerCount(totalCount)");
    // A late response for an abandoned query can never repaint the list.
    expect(shell).toContain("if (searchController) searchController.abort();");
    expect(shell).toContain("if (requestId !== searchRequest || activeSearch !== q) return;");
  });

  it("pages with an explicit button that cannot duplicate or lose rows", async () => {
    const html = await render("leaderboard", { data: { ...baseData, players: seq(20) }, playerCount: 140 });
    expect(html).toContain("<span data-player-count-badge>140 players</span>");
    expect(html).toContain('<button class="yr-btn yr-btn--sm" type="button" data-load-more>Load more players</button>');
    expect(html).toContain('<p class="yr-page-status" data-load-more-status role="status" aria-live="polite" tabindex="-1">');
    expect(css).toMatch(/\.yr-btn--sm \{[^}]*min-height: 44px/);

    const complete = await render("leaderboard", { data: { ...baseData, players: seq(20) }, playerCount: 20 });
    expect(complete).not.toContain("data-load-more");

    expect(shell).toContain("if (known[key]) return;");
    expect(shell).toContain('setPageStatus("Loading more players…")');
    expect(shell).toContain("loadMore.disabled = true;");
    expect(shell).toContain('setPageStatus("Couldn’t load more players.", true)');
    expect(shell).toContain("addRetry(loadMoreStatus, loadNextPage)");
    // Focus follows the vanished button for continuity, but the viewport stays
    // where the reader was: never a scroll jump, never a drop to the document.
    expect(shell).toContain("focusWithoutScroll(loadMoreStatus)");
    expect(shell).toContain("el.focus({ preventScroll: true });");
    expect(shell).toContain("if (window.scrollX !== restoreX || window.scrollY !== restoreY) window.scrollTo(restoreX, restoreY);");
    expect(shell).not.toMatch(/loadMoreStatus\.focus\(\)/);
    expect(shell).not.toContain("scrollIntoView");
    expect(shell).toContain("loadMore.hidden && loadMoreStatus");
    expect(html).toContain('data-load-more-status role="status" aria-live="polite" tabindex="-1"');
    // Search paging and board paging are separate offsets.
    expect(shell).toContain("fetchPage(query ? searchOffset : loadedCount, query)");
    expect(shell).not.toContain("IntersectionObserver");
  });

  it("hides prize values and the prize column when the creator hides amounts", async () => {
    const html = await render("leaderboard", { data: { ...baseData, brand: { ...baseData.brand, hidePrizeAmounts: true } } });
    expect(html).toContain('data-hide-prizes="true"');
    expect(html).not.toContain("yr-srow-prize");
    expect(html).not.toContain('<span class="yr-r">Prize</span>');
    expect(html).not.toContain("$500");
    expect(css).toContain('.yr-stand[data-hide-prizes="true"] .yr-srow');
  });

  it("builds one list geometry for phones and columns only when there is room", () => {
    const base = css.match(/\.yr-stand-head, \.yr-srow \{([^}]*)\}/);
    expect(base).not.toBeNull();
    expect(base[1]).toContain('grid-template-areas: "rank name val" "rank name prize"');
    const wide = css.slice(css.indexOf("@media (min-width: 640px)"));
    expect(wide).toMatch(/\.yr-stand-head, \.yr-srow \{[^}]*grid-template-areas: "rank name val prize"/);
    expect(wide).toMatch(/\.yr-stand-head \{ display: grid; \}/);
    // Standings never inherit the horizontally scrolling table contract.
    expect(css).not.toMatch(/\.yr-stand[^-{]*\{[^}]*min-width: 620px/);
    expect(css).not.toMatch(/\.yr-srow[^{]*\{[^}]*white-space: nowrap/);
    expect(css).toMatch(/\.yr-srow-name \{[^}]*min-height: 44px/);
  });

  it("keeps one public stylesheet and script owner for the standings", () => {
    const names = readdirSync(assets);
    for (const forbidden of ["leaderboard-v2.css", "standings.css", "standings.js", "leaderboard-new.js"]) {
      expect(names).not.toContain(forbidden);
    }
    expect(shell).toContain('document.getElementById("yr-search")');
    expect(shell).toContain('document.querySelector("[data-load-more]")');
  });

  it("leaves the wave 2 shell and the home preview untouched", async () => {
    const html = await render();
    expect((html.match(/<header class="yr-top">/g) || []).length).toBe(1);
    expect((html.match(/<main\b/g) || []).length).toBe(1);
    expect(html).toContain('<div class="yr-drawer" id="yr-side"');
    expect(html).not.toContain("<aside");
    expect((html.match(/aria-current="page"/g) || []).length).toBe(2);

    const home = await render("home");
    expect(home).toContain('<a class="yr-lead-name" href="/creator/player/Alice">Alice</a>');
    expect(home).toContain('<span class="yr-lead-rank">01</span>');
    expect(home).toContain("3 players");
  });
});
