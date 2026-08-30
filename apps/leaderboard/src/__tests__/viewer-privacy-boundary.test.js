import { describe, expect, it, mock } from "bun:test";
import { renderSite } from "@yourrank/shared/site-render";
import { handleViewerMe, handleViewerSite } from "../handlers/viewer-dashboard.js";
import { handlePublicCredits } from "../handlers/credits.js";

const INTERNAL_REASON = "fraud: chargeback investigation case 42";
const viewer = { id: "viewer-1", kick_username: "member" };
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
    const query = mock()
      .mockResolvedValueOnce([{
        id: "site-1", slug: "creator", name: "Creator", balance: 20,
        total_earned: 30, total_spent: 10, blocked: true,
        block_reason: INTERNAL_REASON, plan: "pro", plan_expires_at: null,
      }])
      .mockResolvedValueOnce([]);
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
    expect(query.mock.calls.every(([sql]) => !String(sql).includes("last_active_at"))).toBe(true);
  });

  it("omits internal moderation reasons from site-scoped viewer responses", async () => {
    const one = mock()
      .mockResolvedValueOnce({
        id: "site-1", slug: "creator", name: "Creator",
        viewer_kick_auth_enabled: true, viewer_discord_auth_enabled: false,
        viewer_public_redeem_enabled: true,
      })
      .mockResolvedValueOnce({
        id: "sv-1", balance: 20, total_earned: 30, total_spent: 10,
        blocked: true, block_reason: INTERNAL_REASON,
      })
      .mockResolvedValueOnce({ count: 0 });
    const response = await handleViewerSite(new Request("https://example.test/api/viewer/site?slug=creator"), {}, {
      requireViewer: allowViewer,
      rateLimit: allowRate,
      getPublicSite: async () => ({ id: "site-1", plan: "pro" }),
      one,
      query: async () => [],
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(text).not.toContain(INTERNAL_REASON);
    expect(text).not.toContain("blockReason");
    expect(one.mock.calls.every(([sql]) => !String(sql).includes("last_active_at"))).toBe(true);
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
