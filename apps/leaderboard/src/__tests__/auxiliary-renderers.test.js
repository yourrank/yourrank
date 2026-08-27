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
    expect(html).toContain("hasn't added players or rewards yet");
    expect(html).not.toContain("How credits work");
    expect(html).not.toContain("Top of the leaderboard");
    expect(html).not.toContain("Prize pool");
  });

  it("keeps empty shop and credits pages focused on their honest state", async () => {
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
      viewerData: { ledger: [], redemptions: [] },
      opts,
    });
    // An empty page says so plainly, in the viewer's terms, and invents no
    // rewards, no activity and no dashboard statistics to fill the space.
    expect(shop).toContain("Rewards will appear here when");
    expect(shop).not.toContain("yr-rwd ");
    expect(me).toContain("No credit activity yet");
    expect(me).toContain("No orders yet");
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
