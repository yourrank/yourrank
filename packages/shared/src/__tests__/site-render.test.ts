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
    players: [
      { name: "Alice <3", rank: 1, wagered: 5000, prize: "$100" },
      { name: "Bob", rank: 2, wagered: 3000, prize: "$60" },
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
        redemptions: [{ id: 1, status: "pending" }, { id: 2, status: "fulfilled" }],
        shopItems: [],
      },
      opts,
    });

    expect(html).not.toContain("VIP");
    expect(html).not.toContain("Active Streak");
    expect(html).not.toContain("Events & Duels");
    // The page states the viewer's own balance, activity and orders — no stat
    // grid and no analytics reading of a loyalty balance.
    expect(html).toContain("Free loyalty credits on Ampersand &amp; Board.");
    expect(html).toContain(">500</span> <span class=\"yr-vbal-unit\">free credits");
    expect(html).toContain("Credits earned");
    expect(html).toContain("+100");
    expect(html).toContain("Pending");
    expect(html).toContain("Fulfilled");
    expect(html).not.toContain("yr-gamer-stats-grid");
    expect(html).not.toContain("Credits / 7d");
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
    expect(chosen).toContain('--yr-display-font:"Bebas Neue"');
    expect(chosen).not.toContain('--yr-font:"Bebas Neue"');

    // "Inter" is the dashboard's Default option, so it must not override the
    // site's own type stack, and an unknown family never reaches the CSS.
    const dflt = await render(fixture.data.branding);
    expect(dflt).not.toContain("--yr-display-font");
    const bogus = await render({ ...fixture.data.branding, font: "Comic Sans MS" });
    expect(bogus).not.toContain("--yr-display-font");
    expect(bogus).toContain("family=Fira+Sans");
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
