import { describe, expect, it } from "bun:test";
import { renderNewEmbed, renderNewHallOfFame, renderNewLegalPage, renderNewPlayerProfile, renderNewStreamerProfile } from "../auxiliary-renderers.js";
import { renderPasswordGate } from "../password-gate.js";
import { renderSite } from "@yourrank/shared/site-render";

const record = {
  slug: "demo-board",
  plan: "pro",
  data: {
    brand: { name: "Demo Board", tagline: "A sample board", period: "Monthly", prizePool: "$500" },
    prizes: { hidePrizeAmounts: false },
    players: [{ name: "Alex", wagered: 100, prize: 25 }],
    socials: [],
    pastWinners: [],
  },
};

const opts = { slug: record.slug, homeUrl: "https://test.com", nonce: "nonce" };

describe("new-shell auxiliary renderers", () => {
  it("renders legal and streamer pages in the site shell with honest empty states", async () => {
    const legal = await renderNewLegalPage(record.data, "privacy", opts);
    const profile = await renderNewStreamerProfile(record.data, opts);
    expect(legal).toContain('class="yr-site"');
    expect(legal).toContain("Privacy Policy");
    expect(profile).toContain("No channel links yet.");
    expect(profile).toContain("No public leaderboards yet.");
    expect(profile).toContain('class="yr-vhead"');
    expect(profile).not.toContain("STREAMER PROFILE");
  });

  it("renders archive empty state and chrome-less embed", async () => {
    const hall = await renderNewHallOfFame(record.data, opts);
    const embed = renderNewEmbed(record.data, opts);
    expect(hall).toContain("No past winners yet.");
    expect(hall).toContain('id="yr-hof-title"');
    expect(embed).toContain('class="yr-embed"');
    expect(embed).not.toContain("yr-region");
    expect(embed).toContain("Alex");
    expect(embed).toContain("$100");
  });

  it("renders creator channels and boards as flat rows with real actions", async () => {
    const profile = await renderNewStreamerProfile({
      ...record.data,
      socials: [
        { name: "Twitch", url: "https://twitch.tv/example", enabled: true },
        { name: "Unsafe", url: "javascript:alert(1)", enabled: true },
      ],
    }, {
      ...opts,
      boards: [
        { slug: "alpha", name: "Alpha Community" },
        { slug: "beta", name: "Beta Community" },
      ],
    });
    expect(profile).toContain('class="yr-rwds"');
    expect(profile).toContain("Twitch");
    expect(profile).toContain('class="yr-act" href="https://twitch.tv/example"');
    expect(profile).toContain('rel="noopener noreferrer"');
    expect(profile).toContain('class="yr-sr"> (opens in a new tab)</span>');
    expect(profile).not.toContain('class="sr-only"');
    expect(profile).not.toContain("javascript:alert(1)");
    expect(profile).toContain('class="yr-act" href="/alpha">Open leaderboard</a>');
    expect(profile).not.toContain('class="yr-g12"');
  });

  it("renders Hall of Fame winners as flat rows with neutral result text", async () => {
    const hall = await renderNewHallOfFame({
      ...record.data,
      pastWinners: [
        { label: "Spring", players: 42, winner: "A very long winner name ✨" },
        { label: "Summer", players: 0, winner: "" },
      ],
    }, opts);
    expect(hall).toContain('class="yr-rwds"');
    expect(hall).toContain("42 players");
    expect(hall).toContain("Winner: A very long winner name ✨");
    expect(hall).toContain("Winner: Not recorded");
    expect(hall).not.toContain('class="yr-rwd-state">Winner:');
    expect(hall).not.toContain('class="yr-card yr-lb"');
  });

  it("keeps auxiliary pages neutral in navigation and preserves free-plan attribution", async () => {
    const legal = await renderNewLegalPage(record.data, "terms", { ...opts, plan: "free" });
    expect(legal).toContain("Powered by <a");
    expect(legal).not.toContain("Not configured");
    expect(legal).not.toContain('aria-current="page"');
  });

  it("uses the authoritative Responsible Play label", async () => {
    const legal = await renderNewLegalPage(record.data, "responsible", opts);
    expect(legal).toContain(">Responsible Play<");
    expect(legal).not.toContain("Responsible Gaming");
    expect(legal).toContain("Credits cannot be purchased, withdrawn, transferred between communities, or exchanged for cash.");
    const policyBody = legal.match(/<div class="yr-prose">([\s\S]*?)<\/div>/)?.[1] || "";
    expect(policyBody).not.toMatch(/gambl|casino|wager/i);
  });

  it("does not promise creator recurring or cryptocurrency billing on the refund page", async () => {
    const legal = await renderNewLegalPage(record.data, "refund", opts);
    expect(legal).toContain("does not currently offer recurring checkout");
    expect(legal).not.toMatch(/cryptocurrency|blockchain|subscription payments/i);
  });

  it("formats player profile currency consistently", async () => {
    const profile = await renderNewPlayerProfile(
      record.data,
      { name: "Alex", rank: 1, wagered: 12500, prize: 250 },
      [{ label: "Monthly", rank: 1, wagered: 12500, prize: 250 }],
      opts,
    );
    expect(profile).toContain("$12,500");
    expect(profile).toContain("$250");
    expect(profile).not.toContain(">12500<");
  });

  it("puts the player's name, rank and archived results first without a KPI wall", async () => {
    const profile = await renderNewPlayerProfile(
      record.data,
      { name: "Alex", rank: 3, wagered: 12500, prize: 250 },
      [{ label: "Monthly", rank: 1, wagered: 12500, prize: 250 }],
      opts,
    );
    expect(profile).toContain('<h1 class="yr-h1">Alex</h1>');
    expect(profile).toContain('id="yr-player-standing">Current standing');
    expect(profile).toContain('id="yr-player-history">Archived results');
    expect(profile).toContain("Current rank");
    expect(profile).toContain(">#3<");
    expect(profile).toContain('class="yr-hists"');
    expect(profile).not.toContain('class="yr-hero"');
    expect(profile).not.toContain('class="yr-kpi');
    expect(profile).not.toContain('class="yr-table"');
    // one H1 only, and no medal/trophy gamification
    expect(profile.match(/<h1\b/g)).toHaveLength(1);
    expect(profile).not.toMatch(/medal|trophy|achievement/i);
  });

  it("names the field an archived row's leading value belongs to", async () => {
    const profile = await renderNewPlayerProfile(
      record.data,
      { name: "Alex", rank: 3, wagered: 12500, prize: 250 },
      [{ label: "Monthly", rank: 2, wagered: 9900, prize: 40 }],
      opts,
    );
    // The row has no column heading, so the value carries its own label for both
    // a sighted phone reader and a screen reader.
    expect(profile).toContain('<p class="yr-hist-amt"><span class="yr-hist-lbl">Wagered</span>$9,900</p>');
    expect(profile).toContain('<p class="yr-hist-d">Prize $40</p>');
    expect(profile).not.toContain('<p class="yr-hist-amt">$9,900</p>');
    // Current standing keeps its own labelled rows unchanged.
    expect(profile).toContain('<p class="yr-hist-n">Current rank</p></div><div class="yr-hist-side"><p class="yr-hist-amt">#3</p>');
    expect(profile).toContain('<p class="yr-hist-n">Wagered</p></div><div class="yr-hist-side"><p class="yr-hist-amt">$12,500</p>');
    expect(profile).toContain('<p class="yr-hist-n">Prize</p></div><div class="yr-hist-side"><p class="yr-hist-amt">$250</p>');
    expect(profile).not.toContain('class="yr-table"');
    expect(profile).not.toContain("<table");
    expect(profile).not.toContain('class="yr-kpi');
  });

  it("keeps a pathological player name safe while retaining the accessible name", async () => {
    const long = "Ω".repeat(50) + "🎮".repeat(10) + "x".repeat(40);
    const profile = await renderNewPlayerProfile(record.data, { name: long, rank: 0, wagered: 9e15, prize: 0 }, [], opts);
    expect(profile).toContain(long);
    expect(profile).toContain(`<h1 class="yr-h1">${long}</h1>`);
    expect(profile).toContain("Unranked");
    expect(profile).toContain("No archived results yet.");
    expect(profile).not.toContain("…");
  });

  it("omits the prize row entirely when the streamer hides prize amounts", async () => {
    const hidden = { ...record.data, prizes: { hidePrizeAmounts: true } };
    const profile = await renderNewPlayerProfile(
      hidden,
      { name: "Alex", rank: 1, wagered: 100, prize: 25 },
      [{ label: "Monthly", rank: 1, wagered: 100, prize: 25 }],
      opts,
    );
    expect(profile).toContain("Wagered");
    expect(profile).toContain('<span class="yr-hist-lbl">Wagered</span>$100');
    expect(profile).not.toContain(">Prize<");
    expect(profile).not.toContain("Prize $25");
    expect(profile).not.toContain('class="yr-hist-d"');
    expect(profile).not.toContain("—");
  });

  it("gives legal pages the viewer heading, readable prose and a help region", async () => {
    const legal = await renderNewLegalPage(record.data, "terms", opts);
    expect(legal).toContain('class="yr-vhead"');
    expect(legal).toContain('class="yr-prose"');
    expect(legal).toContain('id="yr-legal-help">Need help?');
    expect(legal.match(/<h1\b/g)).toHaveLength(1);
    expect(legal).not.toContain('class="yr-card"');
  });

  it("hides external new-tab disclosures with the public shell utility", async () => {
    const profile = await renderNewStreamerProfile({
      ...record.data,
      socials: [{ name: "Twitch", url: "https://twitch.tv/example", enabled: true }],
    }, opts);
    expect(profile).toContain('rel="noopener noreferrer"');
    expect(profile).toContain('class="yr-sr"> (opens in a new tab)</span>');
    expect(profile).not.toContain('class="sr-only"');
  });

  it("canonicalises auxiliary pages to their own URL on both host shapes", async () => {
    const legal = await renderNewLegalPage(record.data, "terms", opts);
    const player = await renderNewPlayerProfile(record.data, { name: "Alex Doe", rank: 1 }, [], opts);
    const hall = await renderNewHallOfFame(record.data, opts);
    const profile = await renderNewStreamerProfile(record.data, opts);
    expect(legal).toContain('<link rel="canonical" href="https://test.com/demo-board/terms" />');
    expect(player).toContain('<link rel="canonical" href="https://test.com/demo-board/player/Alex%20Doe" />');
    expect(hall).toContain('<link rel="canonical" href="https://test.com/demo-board/hall-of-fame" />');
    expect(profile).toContain('<link rel="canonical" href="https://test.com/demo-board/profile" />');
    const custom = await renderNewLegalPage(record.data, "privacy", { ...opts, isCustomDomain: true, homeUrl: "https://board.example" });
    expect(custom).toContain('<link rel="canonical" href="https://board.example/privacy" />');
    expect(custom).toContain('<meta property="og:url" content="https://board.example/privacy" />');
  });

  it("does not let custom content leak into a real section render", async () => {
    const html = await renderSite({
      r: { ...record, plan: "free" },
      section: "leaderboard",
      viewer: null,
      viewerData: null,
      opts: { ...opts, contentHtml: "<p>stale auxiliary body</p>" },
    });
    expect(html).not.toContain("stale auxiliary body");
    expect(html).toContain("Standings");
  });

  it("keeps the password gate standalone and preserves the error path", () => {
    const html = renderPasswordGate(
      { name: "Private Board", slug: "private-board" },
      opts,
      "Incorrect password.",
    );
    expect(html).toContain('class="yr-site"');
    expect(html).toContain('action="/private-board/password"');
    expect(html).toContain("Incorrect password.");
    expect(html).toContain('name="password"');
  });

  it("removes redundant home facts and scaffolding from an empty board", async () => {
    const html = await renderSite({
      r: {
        ...record,
        data: {
          ...record.data,
          brand: { ...record.data.brand, prizePool: "$500" },
          players: [],
        },
      },
      section: "home",
      viewer: null,
      viewerData: null,
      opts,
    });
    // Each preview owns its own empty state, so the page does not repeat a
    // "nothing here yet" line underneath them.
    expect(html).toContain('<p class="yr-empty-t">No players on the board yet</p>');
    expect(html).toContain('<p class="yr-empty-t">No rewards yet</p>');
    expect(html).not.toContain("hasn't added players or rewards yet");
    expect(html).not.toContain("How credits work");
    expect(html).not.toContain("Top of the leaderboard");
    expect(html).not.toContain("Prize pool");
  });

  it("keeps empty Rewards and My Community pages focused on their honest state", async () => {
    const empty = {
      ...record.data,
      players: [],
      shopItems: [],
    };
    const shop = await renderSite({
      r: { ...record, data: empty },
      section: "shop",
      viewer: null,
      viewerData: null,
      opts,
    });
    const me = await renderSite({
      r: { ...record, data: empty },
      section: "me",
      viewer: { name: "Viewer" },
      viewerData: {
        viewerOnSite: { balance: 0, total_earned: 0, total_spent: 0, created_at: "2026-01-02T00:00:00.000Z" },
        ledger: [],
        claims: [],
        participation: [],
      },
      opts,
    });
    // An empty page says so plainly, in the viewer's terms, and invents no
    // rewards, no activity and no dashboard statistics to fill the space.
    expect(shop).toContain("Rewards will appear here when");
    expect(shop).not.toContain("yr-rwd ");
    expect(me).toContain("No credit activity yet");
    expect(me).toContain("No claims yet");
    expect(me).not.toContain("Credits / 7d");
  });

  it("keeps the board name to distinct visible identity jobs", async () => {
    const html = await renderSite({
      r: record,
      section: "home",
      viewer: null,
      viewerData: null,
      opts,
    });
    const visible = html
      .slice(html.indexOf("<body"), html.indexOf("</body>"))
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ");
    // Four jobs: the top bar identity, the home introduction heading, the
    // narrow-width drawer identity, and the copyright line.
    expect((visible.match(/Demo Board/g) || []).length).toBe(4);
    expect(html).toContain("Tell us what works and what doesn't.");
    expect(html).not.toContain("Tell Demo Board what works");
  });
});
