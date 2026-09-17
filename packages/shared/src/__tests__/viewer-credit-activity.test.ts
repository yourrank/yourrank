import { describe, expect, it } from "bun:test";
import { renderSite } from "../site-render.js";

describe("viewer credit activity", () => {
  it.each([
    ["earn", "+250", "Credits earned"],
    ["spend", "−250", "Claim"],
    ["refund", "−250", "Credits reversed"],
    ["revoke", "+250", "Claim refund"],
  ])("renders stored %s amounts as %s in both activity views", async (type, delta, label) => {
    for (const section of ["home", "me"]) {
      const html = await renderSite({
        r: {
          slug: "community",
          plan: "pro",
          data: {
            brand: { name: "Community" },
            players: [],
            siteSections: { home: true, leaderboard: true, shop: true, me: true },
          },
        },
        section,
        viewer: { id: "viewer", kick_username: "member" },
        viewerData: {
          membershipStatus: "member",
          viewerOnSite: { balance: 850 },
          ledger: [{ id: "entry", type, amount: 250, created_at: "2026-09-16T12:00:00Z" }],
          claims: [],
          participation: [],
          shopItems: [],
        },
        opts: { slug: "community", homeUrl: "https://example.test", nonce: "test-nonce" },
      });
      expect(html).toContain(label);
      expect(html).toContain(section === "home" ? `${delta} credits` : `${delta}<span class="yr-sr"> credits</span>`);
    }
  });
});
