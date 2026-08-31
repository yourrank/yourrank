import { describe, expect, it, mock } from "bun:test";
import { renderSite } from "@yourrank/shared/site-render";
import { handleViewerMe } from "../handlers/viewer-dashboard.js";
import { handlePublicCredits } from "../handlers/credits.js";

const INTERNAL_REASON = "fraud: chargeback investigation case 42";
const viewer = {
  id: "viewer-1",
  kick_username: "member",
  kick_linked_at: "2026-08-01T00:00:00.000Z",
  created_at: "2026-08-01T00:00:00.000Z",
};
const allowViewer = async () => ({ viewer, res: null });
const allowRate = async () => ({ ok: true });

function siteData() {
  return {
    brand: { name: "Creator", tagline: "Community", period: "Monthly", prizePool: "" },
    branding: { template: "cyber_arcade", font: "Inter", options: {} },
    players: [],
    prizes: { currency: "$", wagerLabel: "Score", prizeLabel: "Prize" },
    shopItems: [{ id: "item-1", name: "Shoutout", cost: 10, active: true }],
    socials: [],
    siteSections: { home: true, leaderboard: true, shop: true, games: true, me: true },
  };
}

describe("viewer privacy boundary", () => {
  it("renders controlled blocked-membership copy without the internal moderation reason", async () => {
    const html = await renderSite({
      r: { id: "site-1", slug: "creator", plan: "pro", data: siteData() },
      section: "shop",
      viewer,
      viewerData: {
        viewerOnSite: { id: "sv-1", balance: 20, blocked: true, block_reason: INTERNAL_REASON },
        shopItems: siteData().shopItems,
        redemptions: [],
        ledger: [],
      },
      opts: { slug: "creator", homeUrl: "https://example.test", nonce: "n" },
    });

    expect(html).toContain("Claiming is currently unavailable for this membership.");
    expect(html).not.toContain(INTERNAL_REASON);
    expect(html).not.toMatch(/chargeback|investigation/i);
  });

  it("omits internal moderation reasons from global /me responses", async () => {
    const query = mock().mockResolvedValueOnce([{
      id: "site-1", membership_id: "membership-1", slug: "creator", name: "Creator",
      balance: 20, total_earned: 30, total_spent: 10, blocked: true,
      block_reason: INTERNAL_REASON,
      pending_claims: 2,
    }]);
    const response = await handleViewerMe(new Request("https://example.test/api/viewer/me"), {}, {
      requireViewer: allowViewer,
      rateLimit: allowRate,
      query,
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(text).not.toContain(INTERNAL_REASON);
    expect(text).not.toContain("blockReason");
    expect(text).not.toContain('"blocked"');
    expect(text).toContain('"claimingAvailable":false');
    expect(text).not.toContain("membership-1");
    expect(text).not.toContain('"siteId"');
    expect(text).not.toContain('"totalEarned"');
    expect(text).not.toContain('"totalSpent"');
    expect(text).not.toContain("memberSince");
    expect(text).toContain('"pendingClaims":2');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.every(([sql]) => !String(sql).includes("last_active_at"))).toBe(true);
  });

  it("omits internal moderation reasons from the legacy public credits response", async () => {
    const response = await handlePublicCredits(new Request("https://example.test/api/credits/public?slug=creator"), {}, {
      getPublicSite: async () => ({
        id: "site-1", plan: "pro", viewerKickAuthEnabled: true,
        viewerDiscordAuthEnabled: false, viewerPublicRedeemEnabled: true,
      }),
      resolveViewer: async () => ({ viewer }),
      rateLimit: allowRate,
      one: async () => ({
        id: "sv-1", balance: 20, total_earned: 30, total_spent: 10,
        blocked: false, block_reason: INTERNAL_REASON, kick_username: "member",
      }),
      query: async () => [],
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(text).not.toContain(INTERNAL_REASON);
    expect(text).not.toContain("block_reason");
  });
});
