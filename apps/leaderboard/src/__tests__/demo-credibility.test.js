import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderSite } from "@yourrank/shared/site-render";
import { demoLeaderboardData } from "../demo-data.js";

const opts = { slug: "demo", homeUrl: "https://example.test", nonce: "fixed-nonce", isDemo: true };

function record(data = demoLeaderboardData()) {
  return { slug: "demo", plan: "free", data };
}

async function render(section, data = demoLeaderboardData()) {
  return renderSite({
    r: record(data),
    section,
    viewer: null,
    viewerData: null,
    opts,
  });
}

describe("demo credibility invariants", () => {
  it("uses one canonical cash currency for the pool and every payout", async () => {
    const data = demoLeaderboardData();
    const top = data.players.slice(0, 3);
    const pool = Number(data.brand.prizePool.replace(/[^\d.]/g, ""));

    expect(data.prizes.currency).toBe("$");
    expect(top.reduce((sum, player) => sum + player.prize, 0)).toBe(pool);

    const html = await render("leaderboard", data);
    expect(html).toContain("$500");
    for (const player of top) expect(html).toContain(`$${player.prize}`);
    expect(html).not.toContain("500 points");
  });

  it("filters every player representation through one generic marker", async () => {
    const data = demoLeaderboardData();
    const html = await render("leaderboard", data);
    const markerCount = (html.match(/data-player-name="/g) || []).length;
    const expectedRepresentations = data.players.length + Math.min(data.players.length, 3);
    const shell = readFileSync(new URL("../assets/site-shell.js", import.meta.url), "utf8");

    expect(markerCount).toBe(expectedRepresentations);
    expect(html).toContain("<div data-player-board>");
    expect(html).not.toContain('data-name="');
    expect(shell).toContain('playerBoard.querySelectorAll("[data-player-name]")');
    expect(shell).not.toContain('document.querySelectorAll("[data-player-name]")');
    expect(shell).not.toContain('querySelectorAll("tr[data-name]")');
    expect(shell).toContain("representation.dataset.playerName");
    expect(shell).toContain("representation.hidden = representation.dataset.playerName.indexOf(q) === -1");
    expect(shell).toContain("representations().forEach(function (representation) { representation.hidden = false; });");
    expect(shell).toContain("updatePlayerCount(visiblePlayerCount())");
    expect(shell).toContain("updatePlayerCount(totalCount)");
  });

  it("keeps section identity, Rewards naming, and the shop route compatible", async () => {
    const expected = {
      home: "Home",
      leaderboard: "Leaderboard",
      shop: "Rewards",
      games: "Games",
      me: "My credits",
    };

    // Each section names itself in its own heading; the shared chrome no
    // longer restates the current section next to the creator identity.
    for (const [section, label] of Object.entries(expected)) {
      const html = await render(section);
      expect(html).toContain(`data-section="${section}"`);
      if (section === "home") expect(html).toContain('<h1 class="yr-intro-name">Demo Challenge</h1>');
      else if (section !== "leaderboard") expect(html).toContain(`<h1 class="yr-h1">${label}</h1>`);
    }

    const shop = await render("shop");
    expect(shop).toContain("Rewards");
    expect(shop).toContain("/demo/shop");
    expect(shop).not.toContain(">Shop<");
    expect(shop).not.toContain("in the shop");
  });

  it("seeds the demo with rewards, recent activity, and a running giveaway", async () => {
    const data = demoLeaderboardData();
    const home = await render("home", data);
    const shop = await render("shop", data);

    expect(data.shopItems.length).toBeGreaterThanOrEqual(3);
    expect(data.shopItems.length).toBeLessThanOrEqual(5);
    expect(data.demoActivity.length).toBeGreaterThan(0);
    expect(data.demoGiveaway).toMatchObject({ name: "Demo Drop" });
    // Home previews the board and the cheapest rewards; the activity feed and
    // giveaway panel belong to the sections that own them, not the landing page.
    expect(home).not.toContain("Recent activity");
    expect(home).not.toContain("LIVE GIVEAWAY");
    expect(home).toContain(data.shopItems[0].name);
    for (const item of data.shopItems) expect(shop).toContain(item.name);
    expect(shop).not.toContain("yr-item-art");

    const illustrated = {
      ...data,
      shopItems: [{ ...data.shopItems[0], image_url: "https://example.test/reward.png" }],
    };
    const illustratedShop = await render("shop", illustrated);
    expect(illustratedShop).toContain('<img src="https://example.test/reward.png" alt="" />');
  });
});
