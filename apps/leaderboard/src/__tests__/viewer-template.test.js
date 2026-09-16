import { describe, expect, it } from "bun:test";
import { renderSite } from "@yourrank/shared/site-render";
import { publicShape } from "../site.js";
import { handleDashboardPreview } from "../handlers/preview.js";
import { VIEWER_TEMPLATES, resolveViewerTemplate } from "@yourrank/shared/viewer-templates";

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

describe("canonical viewer design", () => {
  it("keeps one supported presentation and maps stored choices onto it", () => {
    expect(VIEWER_TEMPLATES).toHaveLength(1);
    for (const value of [undefined, "spotlight", "esports_pro", "creator_glass", "classic", "unknown"]) {
      expect(resolveViewerTemplate(value).value).toBe("cyber_arcade");
    }
  });

  it("applies the same shell across community pages regardless of the stored template", async () => {
    for (const template of ["cyber_arcade", "spotlight", "esports_pro", "creator_glass", undefined]) {
      for (const section of ["home", "leaderboard", "shop", "me"]) {
        const html = await render(template, section);
        expect(html).toContain('class="viewer-rail"');
        expect(html).toContain('class="viewer-layout"');
        expect(html).toContain('/northstar/shop');
        expect(html).not.toContain('data-viewer-template=');
      }
    }
  });

  it("reads a saved template through the public site data model without changing the rendered shell", async () => {
    const saved = publicShape({ name: "Northstar", slug: "northstar", theme_json: { template: "spotlight" }, extra_json: {} }, []);
    // Stored legacy picks normalize to the one canonical design.
    expect(saved.branding.template).toBe("cyber_arcade");
    const html = await render("spotlight", "leaderboard");
    expect(html).toContain("viewer-shell");
    expect(html).not.toContain('data-template=');
  });

  it("renders the podium from the top three distinct ranks with honest monograms", async () => {
    const players = [...data.players, { name: "Jo", rank: 3, score: 500 }];
    const html = await renderSite({ r: { slug: "northstar", plan: "pro", data: { ...data, players, branding: {} } }, section: "leaderboard", opts: { slug: "northstar", homeUrl: "https://test.com", nonce: "n" } });
    expect(html).toContain('data-podium="3"');
    expect(html).toContain('data-podium-slot="1"');
    expect(html).toContain('data-podium-slot="2"');
    expect(html).toContain('class="viewer-podium-ava">AL</span>');
    expect(html).toContain('class="viewer-podium-name">Alex</b>');
    expect((html.match(/data-player-name="alex"/g) || [])).toHaveLength(1);
  });

  it("keeps tied leaders equal and handles empty boards without invented podium places", async () => {
    for (const players of [[], data.players.slice(0, 1), data.players, [{ name: "Alex", rank: 1 }, { name: "Sam", rank: 1 }, { name: "Jo", rank: 1 }],
      [{ name: "Alex", rank: 1 }, { name: "Sam", rank: 2 }, { name: "Jo", rank: 3 }, { name: "Lee", rank: 3 }]]) {
      const html = await renderSite({ r: { slug: "northstar", plan: "pro", data: { ...data, players, branding: {} } }, section: "leaderboard", opts: { slug: "northstar", homeUrl: "https://test.com", nonce: "n" } });
      expect(html).not.toContain('data-podium=');
      expect((html.match(/data-player-name=/g) || [])).toHaveLength(players.length);
    }
  });

  it("previews an unsaved branding draft without mutating the saved record", async () => {
    const saved = { id: "site-1", slug: "northstar", data: { ...data, branding: { template: "cyber_arcade", font: "Inter" } } };
    const response = await handleDashboardPreview(new Request("https://test.com/dashboard/preview?board=site-1&section=leaderboard", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ branding: { font: "Oswald" } }),
    }), {}, "n", { currentUserImpl: async () => ({ id: "creator", plan: "pro", plan_expires_at: Date.now() + 86400000 }), getUserSiteByIdImpl: async () => saved });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('viewer-shell');
    expect(saved.data.branding.font).toBe("Inter");
  });
});
