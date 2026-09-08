import { describe, expect, it } from "bun:test";
import { renderSite } from "@yourrank/shared/site-render";
import { publicShape } from "../site.js";
import { handleDashboardPreview } from "../handlers/preview.js";

const data = {
  brand: { name: "Northstar", period: "Weekly" },
  rankBy: "score",
  players: [{ name: "Alex", rank: 1, score: 950 }, { name: "Sam", rank: 2, score: 750 }],
  siteSections: { home: true, leaderboard: true, shop: true, me: true },
  shopItems: [{ id: "song", name: "Song request", cost: 100, active: true }],
};
const render = (template, section = "leaderboard", plan = "pro") => renderSite({
  r: { slug: "northstar", plan, data: { ...data, branding: { template } } }, section,
  opts: { slug: "northstar", homeUrl: "https://test.com", nonce: "n" },
});

describe("optional viewer template", () => {
  it("leaves existing and unknown templates on Channel guide", async () => {
    for (const value of [undefined, "cyber_arcade", "classic", "esports_pro", "creator_glass", "unknown"]) {
      expect(await render(value)).not.toContain('data-viewer-template="spotlight"');
    }
  });

  it("applies the selected template across supported community pages without duplicating players", async () => {
    for (const section of ["home", "leaderboard", "shop", "me"]) {
      const html = await render("spotlight", section);
      expect(html).toContain('data-viewer-template="spotlight"');
      expect(html).toContain('class="viewer-rail"');
      expect(html).toContain('/northstar/shop');
    }
    const board = await render("spotlight");
    expect((board.match(/data-player-name="alex"/g) || [])).toHaveLength(1);
    expect(board).toContain('data-position="1"');
    expect(await render("spotlight", "leaderboard", "free")).not.toContain('data-viewer-template="spotlight"');
    expect(await render("spotlight", "games")).not.toContain('data-viewer-template="spotlight"');
  });

  it("reads a saved template through the public site data model", () => {
    const saved = publicShape({ name: "Northstar", slug: "northstar", theme_json: { template: "spotlight" }, extra_json: {} }, []);
    expect(saved.branding.template).toBe("spotlight");
  });

  it("uses the original top-ranked rows as podium places with honest monograms", async () => {
    const html = await renderSite({ r: { slug: "northstar", plan: "pro", data: { ...data, players: [...data.players, { name: "Jo", rank: 3, score: 500 }], branding: { template: "spotlight" } } }, section: "leaderboard", opts: { slug: "northstar", homeUrl: "https://test.com", nonce: "n" } });
    expect(html).toContain('data-podium="3"');
    expect(html).toContain('data-position="1" data-podium-slot="1"');
    expect(html).toContain('data-position="2" data-podium-slot="2"');
    expect(html).toContain('class="yr-player-mark" aria-hidden="true">AL</span><span class="yr-player-name">Alex</span>');
    expect((html.match(/data-player-name="alex"/g) || [])).toHaveLength(1);
    expect(await render("cyber_arcade")).not.toContain('data-podium=');
  });

  it("keeps tied leaders equal and handles empty boards without invented podium places", async () => {
    for (const players of [[], data.players.slice(0, 1), data.players, [{ name: "Alex", rank: 1 }, { name: "Sam", rank: 1 }],
      [{ name: "Alex", rank: 1 }, { name: "Sam", rank: 2 }, { name: "Jo", rank: 3 }, { name: "Lee", rank: 3 }]]) {
      const html = await renderSite({ r: { slug: "northstar", plan: "pro", data: { ...data, players, branding: { template: "spotlight" } } }, section: "leaderboard", opts: { slug: "northstar", homeUrl: "https://test.com", nonce: "n" } });
      expect(html).not.toContain('data-podium=');
      expect((html.match(/data-player-name=/g) || [])).toHaveLength(players.length);
    }
  });

  it("previews an unsaved selection without mutating the saved template", async () => {
    const saved = { id: "site-1", slug: "northstar", data: { ...data, branding: { template: "cyber_arcade" } } };
    const response = await handleDashboardPreview(new Request("https://test.com/dashboard/preview?board=site-1&section=leaderboard", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ branding: { template: "spotlight" } }),
    }), {}, "n", { currentUserImpl: async () => ({ id: "creator", plan: "pro", plan_expires_at: Date.now() + 86400000 }), getUserSiteByIdImpl: async () => saved });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('data-viewer-template="spotlight"');
    expect(saved.data.branding.template).toBe("cyber_arcade");
  });
});
