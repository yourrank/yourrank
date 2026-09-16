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
  it("uses a neutral score board without implying a cash pool or payout", async () => {
    const data = demoLeaderboardData();
    expect(data.rankBy).toBe("score");
    expect(data.brand.prizePool).toBe("");
    expect(data.players.every((player) => player.score > 0 && player.wagered === 0 && player.prize === 0)).toBe(true);

    const html = await render("leaderboard", data);
    expect(html).toContain("Points");
    expect(html).toContain("pts");
    expect(html).not.toContain("$500");
    expect(html).not.toContain("Wagered");
    expect(html).not.toContain(">Prize<");
  });

  it("gives every player exactly one representation behind one generic marker", async () => {
    const data = demoLeaderboardData();
    const html = await render("leaderboard", data);
    const markerCount = (html.match(/data-player-name="/g) || []).length;
    const shell = readFileSync(new URL("../assets/site-shell.js", import.meta.url), "utf8");

    // One row per player: no podium copy of the top three to filter, announce
    // or keep in sync with the standings below it.
    expect(markerCount).toBe(data.players.length);
    expect(html).toContain("data-player-board");
    expect(html).not.toContain('data-name="');
    expect(html).not.toContain("yr-card-name");
    expect(shell).toContain('playerBoard.querySelectorAll("[data-player-name]")');
    expect(shell).not.toContain('document.querySelectorAll("[data-player-name]")');
    expect(shell).toContain("representation.dataset.playerName");
    expect(shell).toContain("representation.hidden = representation.dataset.playerName.indexOf(q) === -1");
    expect(shell).toContain("representations().forEach(function (representation) { representation.hidden = false; });");
    expect(shell).toContain("updatePlayerCount(totalCount)");
  });

  it("keeps section identity, Rewards naming, and the shop route compatible", async () => {
    // The demo board keeps Activities off: daily quests need a signed-in
    // membership the virtual board cannot have.
    const expected = {
      home: "Home",
      leaderboard: "Leaderboard",
      shop: "Rewards",
      games: "Games",
      me: "My Activity",
    };

    // Each section names itself in its own heading and is marked as the
    // current destination in the community rail; home leads with the
    // creator's identity inside the hero instead of a generic page head.
    for (const [section, label] of Object.entries(expected)) {
      const html = await render(section);
      expect(html).toContain(`data-section="${section}"`);
      if (section === "home") expect(html).toContain('<h1 class="viewer-hero-name" data-preview-field="f_name">Demo Challenge</h1>');
      else if (section === "games") expect(html).toContain("Games");
      else expect(html).toContain(`<h1 class="viewer-h1">${label}</h1>`);
      // Games is reachable but sits outside the five rail destinations.
      if (section !== "games") {
        const on = (html.match(/aria-current="page"/g) || []).length;
        expect(`${section} has exactly one current nav link`).toBe(on === 1 ? `${section} has exactly one current nav link` : `${section} has ${on}`);
        const link = (html.match(/class="viewer-nav-link is-on"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || "";
        expect(`${section} current link is ${label}`).toBe(link.includes(`<span>${label}</span>`) ? `${section} current link is ${label}` : link);
      }
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
    // Home previews the board and the cheapest reward; the giveaway panel
    // belongs to the sections that own it, and a signed-out viewer gets an
    // honest sign-in prompt in the activity module rather than fake entries.
    expect(home).toContain("Recent activity");
    expect(home).toContain("Sign in to see your credit activity");
    expect(home).not.toContain("LIVE GIVEAWAY");
    expect(home).toContain(data.shopItems[0].name);
    for (const item of data.shopItems) expect(shop).toContain(item.name);
    expect(shop).not.toContain("yr-item-art");

    const illustrated = {
      ...data,
      shopItems: [...data.shopItems, { ...data.shopItems[0], id: "demo-extra", cost: 2000, image_url: "https://example.test/reward.png" }],
    };
    const illustratedShop = await render("shop", illustrated);
    // A configured reward image still renders on a non-featured row.
    expect(illustratedShop).toContain('<img class="yr-rwd-img" src="https://example.test/reward.png" alt=""');
  });
});
