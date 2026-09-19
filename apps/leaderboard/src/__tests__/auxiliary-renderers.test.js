import { describe, expect, it } from "bun:test";
import { renderNewEmbed, renderNewHallOfFame, renderNewLegalPage, renderNewPlayerProfile, renderNewStreamerProfile } from "../auxiliary-renderers.js";
import { renderPasswordGate } from "../password-gate.js";
import { renderSite } from "@yourrank/shared/site-render";

const record = {
  slug: "demo-board",
  plan: "pro",
  data: {
    rankBy: "wagered",
    brand: { name: "Demo Board", tagline: "A sample board", period: "Monthly", prizePool: "$500" },
    prizes: { hidePrizeAmounts: false },
    players: [{ name: "Alex", wagered: 100, prize: 25 }],
    socials: [],
    pastWinners: [],
  },
};

const opts = { slug: record.slug, homeUrl: "https://test.com", nonce: "nonce" };

describe("new-shell auxiliary renderers", () => {
  it("renders score-ranked player profiles without legacy money terminology", async () => {
    const data = {
      ...record.data,
      rankBy: "score",
      brand: { ...record.data.brand, prizePool: "" },
      prizes: {},
    };
    const profile = await renderNewPlayerProfile(
      data,
      { name: "Score Player", rank: 2, score: 77, wagered: 900, prize: 0 },
      [{ label: "August", rank: 1, score: 65, wagered: 800, prize: 0 }],
      opts,
    );

    expect(profile).toContain("<p class=\"yr-hist-n\">Score</p>");
    expect(profile).toContain("77 points");
    expect(profile).toContain("65 points");
    expect(profile).not.toContain("Wagered");
    expect(profile).not.toContain("Prize");
  });
  it("renders legal and streamer pages in the site shell with honest empty states", async () => {
    const legal = await renderNewLegalPage(record.data, "privacy", opts);
    const profile = await renderNewStreamerProfile(record.data, opts);
    expect(legal).toContain('class="yr-site viewer-shell viewer-article-page"');
    expect(legal).toContain('aria-label="Viewer navigation"');
    expect(legal).not.toContain('/assets/devin-system.css');
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
    const rail = legal.match(/<aside class="viewer-rail"[\s\S]*?<\/aside>/)[0];
    expect(rail).not.toContain('aria-current="page"');
  });

  it("uses the authoritative Responsible Play label", async () => {
    const legal = await renderNewLegalPage(record.data, "responsible", opts);
    expect(legal).toContain(">Responsible Play<");
    expect(legal).not.toContain("Responsible Gaming");
    expect(legal).toContain("Credits cannot be purchased, withdrawn, transferred between communities, or exchanged for cash.");
    const policyBody = legal.match(/<div class="yr-prose viewer-article-body">([\s\S]*?)<\/div>/)[1];
    expect(policyBody).not.toMatch(/gambl|casino|wager/i);
  });

  it("does not promise creator recurring or cryptocurrency billing on the refund page", async () => {
    const legal = await renderNewLegalPage(record.data, "refund", opts);
    expect(legal).toContain("does not currently offer recurring checkout");
    expect(legal).not.toMatch(/cryptocurrency|blockchain|subscription payments/i);
  });

  it("renders /contact as a product page with an honest no-contact state and a separate YourRank route", async () => {
    const page = await renderNewLegalPage(record.data, "contact", opts);
    expect(page).toContain('<h1 class="yr-h1">Contact Demo Board</h1>');
    expect(page).toContain('data-contact-state="unavailable"');
    expect(page).toContain("This creator hasn't provided a contact method yet.");
    expect(page).toContain("For YourRank account or website problems:");
    expect(page).toContain('href="/help/support?audience=viewer&amp;return=%2Fdemo-board%2Fcontact" data-yourrank-support>Contact YourRank support</a>');
    expect(page).not.toContain("data-contact-method=");
    expect(page).not.toContain("Need help with a reward or claim?");
    // Not a policy: no policy cue, no sibling policy navigation.
    expect(page).not.toContain('<p class="yr-cue">Policy</p>');
    expect(page).not.toContain("viewer-article-nav");
    // Socials are not contact methods any more.
    const socialsOnly = await renderNewLegalPage({ ...record.data, socials: [{ type: "kick", name: "Kick", url: "https://kick.com/demo", enabled: true }] }, "contact", opts);
    expect(socialsOnly).toContain('data-contact-state="unavailable"');
    expect(socialsOnly).not.toContain("data-contact-method=");
    // Policy pages no longer list Contact as a sibling policy.
    const terms = await renderNewLegalPage(record.data, "terms", opts);
    expect(terms).not.toMatch(/<a[^>]*href="\/demo-board\/contact"[^>]*>Contact<\/a>/);
  });

  it("renders only configured, validated creator contact methods with safe hrefs", async () => {
    const one = await renderNewLegalPage({ ...record.data, contact: { email: "creator@example.com" } }, "contact", opts);
    expect(one).toContain('data-contact-state="available"');
    expect(one).toContain("Need help with a reward or claim?");
    expect(one).toContain("This creator handles their own reward fulfillment.");
    expect(one).toContain('<a class="yr-btn yr-contact-method" href="mailto:creator@example.com" data-contact-method="email">Email creator</a>');
    expect(one).not.toContain('data-contact-method="discord"');
    expect(one).toContain("YourRank account or website issue?");
    expect(one).toContain("data-yourrank-support>Contact YourRank support</a>");

    const discordOnly = await renderNewLegalPage({ ...record.data, contact: { discord: "https://discord.gg/demo" } }, "contact", opts);
    expect(discordOnly).toContain('<a class="yr-btn yr-contact-method" href="https://discord.gg/demo" data-contact-method="discord" target="_blank" rel="noopener noreferrer">Discord<span class="yr-sr"> (opens in a new tab)</span></a>');
    expect(discordOnly).not.toContain("mailto:");

    const all = await renderNewLegalPage({
      ...record.data,
      contact: { email: "a@b.co", discord: "https://discord.com/invite/x", social: "https://x.com/demo", url: "https://demo.example/contact?a=1&b=2" },
    }, "contact", opts);
    expect(all.match(/data-contact-method="/g)).toHaveLength(4);
    expect(all).toContain('href="https://x.com/demo" data-contact-method="social" target="_blank" rel="noopener noreferrer">X<');
    expect(all).toContain('href="https://demo.example/contact?a=1&amp;b=2" data-contact-method="url" target="_blank" rel="noopener noreferrer">Contact website<');

    const unsafe = await renderNewLegalPage({
      ...record.data,
      contact: { email: "not an email<script>", discord: "https://evil.example/discord.gg", social: "javascript:alert(1)", url: "http://plain.example" },
    }, "contact", opts);
    expect(unsafe).toContain('data-contact-state="unavailable"');
    expect(unsafe).not.toContain("javascript:");
    expect(unsafe).not.toContain("evil.example");
    expect(unsafe).not.toContain("plain.example");
    expect(unsafe).not.toContain("<script>");

    const escaped = await renderNewLegalPage({
      ...record.data,
      brand: { ...record.data.brand, name: 'Demo <b>"Board"</b>' },
      contact: { url: 'https://demo.example/"><img src=x onerror=alert(1)>' },
    }, "contact", opts);
    expect(escaped).toContain("Contact Demo &lt;b&gt;&quot;Board&quot;&lt;/b&gt;</h1>");
    expect(escaped).not.toContain("<img src=x");
    expect(escaped).toContain("&quot;&gt;&lt;img");
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

  it("gives the player page a way back, the current period and a modest archive empty state", async () => {
    const empty = await renderNewPlayerProfile(record.data, { name: "Alex", rank: 3, wagered: 100, prize: 25 }, [], opts);
    expect(empty).toContain('<header class="yr-vhead"><a class="yr-sec-link" href="/demo-board/leaderboard">');
    expect(empty).toContain("Back to leaderboard</a>");
    expect(empty).toContain("in the monthly board right now");
    expect(empty).toContain('id="yr-player-standing">Current standing</h2><span class="yr-panel-meta">Monthly board</span>');
    expect(empty).toContain('class="yr-vsec yr-vsec--empty" aria-labelledby="yr-player-history"');
    expect(empty).toContain('<p class="yr-note">No archived results yet. Past monthly boards appear here once Demo Board archives one.</p>');
    expect(empty).not.toContain('class="yr-empty"');

    const two = await renderNewPlayerProfile(
      record.data,
      { name: "Alex", rank: 3, wagered: 100, prize: 25 },
      [{ label: "August", rank: 1, wagered: 900, prize: 40 }, { label: "July", rank: 4, wagered: 300, prize: 0 }],
      opts,
    );
    expect(two).toContain('id="yr-player-history">Archived results</h2><span class="yr-panel-meta">2 boards</span>');
    expect(two).not.toContain("yr-vsec--empty");
    expect(two.match(/<li class="yr-hist">/g)).toHaveLength(3 + 2);

    const custom = await renderNewPlayerProfile(record.data, { name: "Alex", rank: 1 }, [], { ...opts, isCustomDomain: true, homeUrl: "https://board.example" });
    expect(custom).toContain('<a class="yr-sec-link" href="/leaderboard">');
    const noPeriod = await renderNewPlayerProfile({ ...record.data, brand: { ...record.data.brand, period: "" } }, { name: "Alex", rank: 1 }, [], opts);
    expect(noPeriod).toContain("stands on Demo Board right now");
    expect(noPeriod).toContain("No archived results yet. Past boards appear here");
    expect(noPeriod).not.toContain("yr-panel-meta");
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
    expect(profile.match(/<main\b[\s\S]*?<\/main>/)?.[0]).not.toContain("—");
  });

  it("renders legal pages as one community article with readable prose and a help region", async () => {
    const legal = await renderNewLegalPage(record.data, "terms", opts);
    expect(legal).toContain('<article class="viewer-article">');
    expect(legal).toContain('class="yr-prose viewer-article-body"');
    expect(legal).toContain('id="viewer-article-support-title">Need help?');
    expect(legal.match(/<h1\b/g)).toHaveLength(1);
    expect(legal).toContain("<dt>Published by</dt><dd>Demo Board</dd>");
    expect(legal).toContain("<dt>Applies to</dt><dd>Demo Board&#39;s community on YourRank</dd>");
    expect(legal).not.toContain("Last updated");
    expect(legal).not.toContain('class="yr-card"');
    expect(legal).not.toContain('<aside class="viewer-overview"');
    expect(legal).not.toContain("data-share-block");
    expect(legal).not.toContain('<footer class="viewer-panel-footer"');
  });

  it("links the enabled sibling policies from every legal page and marks the current one", async () => {
    const legal = await renderNewLegalPage({ ...record.data, legal: { refundEnabled: false } }, "privacy", opts);
    const nav = legal.match(/<nav class="viewer-article-nav"[\s\S]*?<\/nav>/)[0];
    expect(nav).toContain('<a href="/demo-board/privacy" aria-current="page">Privacy Policy</a>');
    expect(nav).toContain('<a href="/demo-board/terms">Terms of Service</a>');
    expect(nav).not.toContain('/demo-board/contact');
    expect(nav).not.toContain("Refund");
    const custom = await renderNewLegalPage(record.data, "terms", { ...opts, isCustomDomain: true });
    expect(custom).toContain('<a href="/privacy">Privacy Policy</a>');
  });

  it("lets the cookie policy open the consent preferences", async () => {
    const cookies = await renderNewLegalPage(record.data, "cookies", opts);
    const body = cookies.match(/<div class="yr-prose viewer-article-body">([\s\S]*?)<\/div>/)[1];
    expect(body).toContain('<button type="button" class="yr-btn yr-btn--sm yr-btn--ghost" data-cookie-preferences>Cookie preferences</button>');
    const customCopy = await renderNewLegalPage({ ...record.data, legal: { cookies: "Our own cookie text." } }, "cookies", opts);
    expect(customCopy).toContain("<p>Our own cookie text.</p>");
    expect(customCopy).toContain("data-cookie-preferences>Cookie preferences</button>");
    expect(cookies).toContain('<script src="/assets/cookie-consent.js"');
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
    expect(html).toContain('viewer-home-empty--podium');
    expect(html).toContain('<strong>No standings yet.</strong>');
    expect(html).toContain('viewer-home-empty--shelf');
    expect(html).toContain('No rewards yet.');
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
    // Three jobs: community context, home introduction, and copyright.
    // The visible responsive rail no longer duplicates identity in a drawer.
    expect(html).toContain('data-preview-field="f_name">Demo Board</h1>');
    expect(html).toContain('class="viewer-switch"');
    expect(visible).not.toContain("Demo Board Demo Board");
    expect(html).toContain("Goes to this community's creator, not to YourRank.");
    expect(html).toContain("There is no personal reply here;");
    expect(html).not.toContain("Tell Demo Board what works");
  });
});
