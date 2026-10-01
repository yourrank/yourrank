import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderSite } from "@yourrank/shared/site-render";
import { publicShape } from "../site.js";
import { handleDashboardPreview } from "../handlers/preview.js";

const viewerCss = readFileSync(join(import.meta.dir, "../assets/viewer-shell.css"), "utf8");
const data = {
  brand: { name: "Northstar", period: "Weekly" },
  rankBy: "score",
  players: [{ name: "Alex", rank: 1, score: 950 }, { name: "Sam", rank: 2, score: 750 }],
  siteSections: { home: true, leaderboard: true, shop: true, me: true },
  shopItems: [{ id: "song", name: "Song request", cost: 100, active: true }],
};
const render = (template, section = "leaderboard", plan = "pro") => renderSite({
  r: { slug: "northstar", plan, data: { ...data, branding: { template } } }, section,
  opts: { slug: "northstar", homeUrl: "https://test.com", nonce: "n" },
});
const renderStandings = (players, page = 1, playerCount = players.length) => renderSite({
  r: { slug: "northstar", plan: "pro", data: { ...data, playerCount, players, branding: { template: "spotlight" } } },
  section: "leaderboard",
  opts: { slug: "northstar", homeUrl: "https://test.com", nonce: "n", page, pageSize: 25 },
});

describe("optional viewer template", () => {
  it("leaves existing and unknown templates on Channel guide", async () => {
    for (const value of [undefined, "cyber_arcade", "classic", "esports_pro", "creator_glass", "unknown"]) {
      expect(await render(value)).not.toContain('data-viewer-template="spotlight"');
    }
  });

  it("applies the selected template across supported community pages without duplicating players", async () => {
    for (const section of ["home", "leaderboard", "shop", "me"]) {
      const html = await render("spotlight", section);
      expect(html).toContain('data-viewer-template="spotlight"');
      expect(html).toContain('class="viewer-rail"');
      expect(html).toContain('/northstar/shop');
    }
    const board = await render("spotlight");
    expect((board.match(/data-player-name="alex"/g) || [])).toHaveLength(1);
    expect(board).toContain('data-position="1"');
    expect(await render("spotlight", "leaderboard", "free")).not.toContain('data-viewer-template="spotlight"');
  });

  it("reads a saved template through the public site data model", () => {
    const saved = publicShape({ name: "Northstar", slug: "northstar", theme_json: { template: "spotlight" }, extra_json: {} }, []);
    expect(saved.branding.template).toBe("spotlight");
  });

  it("uses the original top-ranked rows as podium places with honest monograms", async () => {
    const html = await renderSite({ r: { slug: "northstar", plan: "pro", data: { ...data, players: [...data.players, { name: "Jo", rank: 3, score: 500 }], branding: { template: "spotlight" } } }, section: "leaderboard", opts: { slug: "northstar", homeUrl: "https://test.com", nonce: "n" } });
    expect(html).toContain('data-podium="3"');
    expect(html).toContain('data-position="1" data-podium-slot="1"');
    expect(html).toContain('data-position="2" data-podium-slot="2"');
    expect(html).toContain('class="yr-player-mark" aria-hidden="true">AL</span><span class="yr-player-name">Alex</span>');
    expect((html.match(/data-player-name="alex"/g) || [])).toHaveLength(1);
    expect(await render("cyber_arcade")).not.toContain('data-podium=');
  });

  it("uses positional podium slots while retaining tied ranks and one row per player", async () => {
    const players = [
      { name: "Ava", rank: 1 },
      { name: "Bea", rank: 2 },
      { name: "Cleo", rank: 2 },
      { name: "Drew", rank: 2 },
      { name: "Evan", rank: 5 },
    ];
    const html = await renderStandings(players);
    const rows = html.match(/<li class="yr-srow[\s\S]*?<\/li>/g) || [];
    expect(html).toContain('data-podium="3"');
    expect(rows[0]).toContain('data-position="1" data-podium-slot="1"');
    expect(rows[1]).toContain('data-position="2" data-podium-slot="2"');
    expect(rows[2]).toContain('data-position="2" data-podium-slot="3"');
    expect(rows[0]).toContain('<span class="yr-srow-rank"><span class="yr-sr">Rank </span>1</span>');
    expect(rows[1]).toContain('<span class="yr-srow-rank"><span class="yr-sr">Rank </span>2</span>');
    expect(rows[2]).toContain('<span class="yr-srow-rank"><span class="yr-sr">Rank </span>2</span>');
    expect(rows).toHaveLength(players.length);
    for (const player of players) {
      expect((html.match(new RegExp(`data-player-name="${player.name.toLowerCase()}"`, "g")) || [])).toHaveLength(1);
    }
    expect(viewerCss).toContain(".viewer-shell .yr-stand{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))");
    expect(viewerCss).toContain('[data-podium-slot]{grid-row:1;grid-column:2;');
    expect(viewerCss).toContain('[data-podium-slot="2"]{grid-column:1');
    expect(viewerCss).toContain('[data-podium-slot="3"]{grid-column:3');
    expect(viewerCss).toContain('data-podium-slot="1"]::after{content:"";position:absolute;top:12px');

    for (const short of [[], players.slice(0, 1), players.slice(0, 2)]) {
      const shortHtml = await renderStandings(short);
      expect(shortHtml).not.toContain("data-podium=");
      expect((shortHtml.match(/data-player-name=/g) || [])).toHaveLength(short.length);
    }
  });

  it("keeps positional podiums to page one and preserves supplied ranks on later pages", async () => {
    const allPlayers = Array.from({ length: 30 }, (_, index) => ({
      name: `Player${String(index + 1).padStart(2, "0")}`,
      rank: index === 0 ? 1 : index < 4 ? 2 : index + 1,
      score: 100 - index,
    }));
    const firstPage = await renderStandings(allPlayers.slice(0, 25), 1, allPlayers.length);
    expect(firstPage).toContain('data-podium="3"');
    expect((firstPage.match(/data-player-name=/g) || [])).toHaveLength(25);

    const secondPage = await renderStandings(allPlayers.slice(25), 2, allPlayers.length);
    const rows = secondPage.match(/<li class="yr-srow[\s\S]*?<\/li>/g) || [];
    expect(secondPage).not.toContain("data-podium=");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain('data-player-name="player26" data-position="26"');
    expect(rows[0]).toContain('<span class="yr-srow-rank"><span class="yr-sr">Rank </span>26</span>');
    expect((secondPage.match(/data-player-name=/g) || [])).toHaveLength(5);
  });

  it("previews an unsaved selection without mutating the saved template", async () => {
    const saved = { id: "site-1", slug: "northstar", data: { ...data, branding: { template: "cyber_arcade" } } };
    const response = await handleDashboardPreview(new Request("https://test.com/dashboard/preview?board=site-1&section=leaderboard", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ branding: { template: "spotlight" } }),
    }), {}, "n", { currentUserImpl: async () => ({ id: "creator", plan: "pro", plan_expires_at: Date.now() + 86400000 }), getUserSiteByIdImpl: async () => saved });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('data-viewer-template="spotlight"');
    expect(saved.data.branding.template).toBe("cyber_arcade");
  });
});
