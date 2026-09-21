import { describe, expect, it } from "bun:test";
import { formatLeaderboardTiming, renderSite } from "../site-render.js";

const fixture = {
  slug: "board fixture",
  plan: "pro",
  data: {
    brand: {
      name: "Ampersand & Board",
      tagline: "A & B",
      period: "Q&A",
      ctaUrl: "https://sponsor.example/offer",
    },
    branding: { template: "classic", font: "Inter", options: {} },
    rankBy: "wagered",
    players: [
      { name: "Alice <3", rank: 1, wagered: 5000, prize: 100 },
      { name: "Bob", rank: 2, wagered: 3000, prize: 60 },
    ],
    prizes: { wagerLabel: "Wagered", prizeLabel: "Prize" },
    socials: [],
    siteSections: { home: true, leaderboard: true, shop: true, games: false, me: true },
  },
};

const opts = {
  slug: fixture.slug,
  homeUrl: "https://example.test",
  nonce: "fixed-nonce",
};

describe("shared public board renderer", () => {
  it("keeps the fixed fixture HTML stable", async () => {
    const html = await renderSite({
      r: fixture,
      section: "leaderboard",
      viewer: null,
      viewerData: null,
      opts,
    });

    expect(html).toMatchSnapshot();
  });

  it("does not fabricate VIP, streak or duels stats on the member page", async () => {
    const html = await renderSite({
      r: fixture,
      section: "me",
      viewer: { kick_username: "alice" },
      viewerData: {
        viewerOnSite: { balance: 500, total_earned: 1000, total_spent: 300 },
        ledger: [{ id: 1, amount: 100, type: "earn", created_at: new Date().toISOString() }],
        participation: [],
        claims: [
          { id: "redemption:1", reward: { name: "Reward one", cost: 10 }, status: "submitted", statusLabel: "Needs fulfillment", submittedAt: new Date().toISOString() },
          { id: "redemption:2", reward: { name: "Reward two", cost: 20 }, status: "completed", statusLabel: "Completed", submittedAt: new Date().toISOString() },
        ],
        shopItems: [],
      },
      opts,
    });

    expect(html).not.toContain("VIP");
    expect(html).not.toContain("Active Streak");
    expect(html).not.toContain("Events & Duels");
    expect(html).toContain("<strong>Ampersand &amp; Board</strong>");
    expect(html).toContain('<strong id="viewer-top-name">alice</strong>');
    expect(html).toContain('data-credit-balance-num>500</strong>');
    expect(html).toContain("Only in Ampersand &amp; Board");
    expect(html).toContain("Credits earned");
    expect(html).toContain("+100");
    expect(html).toContain("Needs fulfillment");
    expect(html).toContain("Completed");
    expect(html).not.toContain("yr-gamer-stats-grid");
    expect(html).not.toContain("Credits / 7d");
  });

  it("hides My Activity from the signed-out rail but keeps the direct-URL sign-in gate", async () => {
    const html = await renderSite({ r: fixture, section: "me", viewer: null, viewerData: null, opts });
    expect(html).not.toContain(">My Activity</a>");
    expect(html).toContain('class="member-gate"');
    expect(html).toContain("Sign in to");
    expect(html).not.toContain("viewer-me-stats");
  });

  it("shows only real personal stats on My Activity and omits rank without a standing", async () => {
    const base = {
      r: fixture,
      section: "me",
      viewer: { kick_username: "alice" },
      opts,
    };
    const empty = await renderSite({
      ...base,
      viewerData: { viewerOnSite: { balance: 0 }, ledger: [], participation: [], claims: [], shopItems: [] },
    });
    expect(empty).toContain(">My Activity</a>");
    expect(empty).toContain("viewer-me-stats");
    expect(empty).toContain('data-credit-balance-num>0</span>');
    expect(empty).not.toContain("Current rank");
    expect(empty).toContain("No credit activity yet");
    expect(empty).toContain("No claims yet");

    const ranked = await renderSite({
      ...base,
      r: { ...fixture, data: { ...fixture.data, players: [{ rank: 1, name: "bob", score: 20 }, { rank: 2, name: "Alice", score: 10 }] } },
      viewerData: {
        viewerOnSite: { balance: 850 },
        ledger: [{ id: 1, amount: 250, type: "spend", created_at: "2026-09-16T21:14:00Z" }],
        participation: [],
        claims: [],
        shopItems: [],
      },
    });
    expect(ranked).toContain("Current rank");
    expect(ranked).toContain("<dd>#2</dd>");
    expect(ranked).toContain('yr-hist-amt yr-neg');
    expect(ranked).toContain("−250");
  });

  it("renders the community banner as the home and leaderboard hero cover, with the scene as fallback", async () => {
    const withBanner = await renderSite({
      r: fixture,
      section: "home",
      viewer: null,
      viewerData: null,
      opts: { ...opts, bannerUrl: "https://example.test/banner/board%20fixture" },
    });
    expect(withBanner).toContain('class="viewer-hero-cover" src="https://example.test/banner/board%20fixture"');
    expect(withBanner).not.toContain("viewer-hero-orb");
    // The banner leads the social-card metadata ahead of the logo.
    expect(withBanner).toContain('property="og:image" content="https://example.test/banner/board%20fixture"');

    const board = await renderSite({
      r: fixture,
      section: "leaderboard",
      viewer: null,
      viewerData: null,
      opts: { ...opts, bannerUrl: "https://example.test/banner/board%20fixture" },
    });
    expect(board).toContain('class="viewer-board-hero-cover" src="https://example.test/banner/board%20fixture"');
    expect(board).not.toContain("viewer-board-orb");

    // No banner: the existing abstract scenes render instead of a broken image.
    const without = await renderSite({ r: fixture, section: "home", viewer: null, viewerData: null, opts });
    expect(without).not.toContain("viewer-hero-cover");
    expect(without).toContain("viewer-hero-orb");
    const boardWithout = await renderSite({ r: fixture, section: "leaderboard", viewer: null, viewerData: null, opts });
    expect(boardWithout).not.toContain("viewer-board-hero-cover");
    expect(boardWithout).toContain("viewer-board-orb");
  });

  it("prefers the logo for social cards when no banner exists", async () => {
    const html = await renderSite({
      r: fixture,
      section: "home",
      viewer: null,
      viewerData: null,
      opts: { ...opts, logoUrl: "https://example.test/logo/board%20fixture" },
    });
    expect(html).toContain('property="og:image" content="https://example.test/logo/board%20fixture"');
  });

  it("contains a chosen creator typeface to display roles", async () => {
    const render = (branding) => renderSite({
      r: { ...fixture, data: { ...fixture.data, branding } },
      section: "leaderboard",
      viewer: null,
      viewerData: null,
      opts,
    });

    const chosen = await render({ ...fixture.data.branding, font: "Bebas Neue" });
    expect(chosen).toContain("family=Bebas+Neue");
    expect(chosen).toContain('name="viewer-display-font" content="&quot;Bebas Neue&quot;');
    expect(chosen).not.toContain('--yr-font:"Bebas Neue"');

    // "Inter" is the dashboard's Default option, so it must not override the
    // site's own type stack, and an unknown family never reaches the CSS.
    const dflt = await render(fixture.data.branding);
    expect(dflt).not.toContain('name="viewer-display-font"');
    const bogus = await render({ ...fixture.data.branding, font: "Comic Sans MS" });
    expect(bogus).not.toContain('name="viewer-display-font"');
    expect(bogus).toContain("family=Inter");
  });

  it("formats ordinary, expired, invalid, extreme and offset countdowns safely", () => {
    const now = Date.UTC(2029, 0, 1, 12);

    expect(formatLeaderboardTiming("2029-01-03T14:00:00Z", { now })).toEqual({
      kind: "relative",
      text: "2d 2h",
      iso: "2029-01-03T14:00:00.000Z",
    });
    expect(formatLeaderboardTiming("2028-12-31T23:59:59Z", { now })).toMatchObject({
      kind: "expired",
      text: "Ended",
    });
    expect(formatLeaderboardTiming("not-a-date", { now })).toEqual({ kind: "invalid", text: "", iso: "" });

    const extreme = formatLeaderboardTiming("2031-04-12T08:00:00Z", { now });
    expect(extreme).toEqual({ kind: "calendar", text: "Apr 12, 2031", iso: "2031-04-12T08:00:00.000Z" });
    expect(extreme.text).not.toContain("d ");

    // Calendar fallbacks are based on the actual instant, not the date-like
    // prefix before an explicit timezone offset.
    expect(formatLeaderboardTiming("2031-01-01T00:30:00+02:00", { now }).text).toBe("Dec 31, 2030");
  });

  it("covers the reconciled public-board behavior", async () => {
    const html = await renderSite({
      r: fixture,
      section: "leaderboard",
      viewer: null,
      viewerData: null,
      opts,
    });

    expect(html).toContain("/board%20fixture/leaderboard");
    expect(html).toContain("Ampersand &amp; Board");
    expect(html).not.toContain("Ampersand &amp;amp; Board");
    expect(html).toContain("Q&amp;A leaderboard");
    expect(html).not.toContain("Join sponsor");
    expect(html).not.toContain("U-09");
    expect(html).not.toContain("// Alignment is preserved");
    const firstRowPrefix = html.match(/<li class="yr-srow[\s\S]*?<a /)?.[0] || "";
    expect(firstRowPrefix).not.toContain("U-09");
    expect(firstRowPrefix).not.toContain("//");
  });
});
