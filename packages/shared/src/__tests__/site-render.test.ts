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
    expect(html).toContain("Lifetime Earned");
    expect(html).toContain("Lifetime Spent");
    expect(html).toContain("1,000 CR");
    expect(html).toContain("300 CR");
    expect(html).toContain("2 orders");
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
    expect(html).toContain("Q&amp;A LEADERBOARD");
    expect(html).not.toContain("Join sponsor");
    expect(html).not.toContain("U-09");
    expect(html).not.toContain("// Alignment is preserved");
    const firstRowPrefix = html.match(/<tr[^>]*>[\s\S]*?<td/)?.[0] || "";
    expect(firstRowPrefix).not.toContain("U-09");
    expect(firstRowPrefix).not.toContain("//");
  });
});
