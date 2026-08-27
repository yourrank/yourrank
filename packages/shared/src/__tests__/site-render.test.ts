import { describe, expect, it } from "bun:test";
import { renderSite } from "../site-render.js";

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
