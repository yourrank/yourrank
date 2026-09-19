// Regression tests for the "Show Leaderboard" visibility model.
//
// The Appearance → "Show Leaderboard" toggle (data.sections.leaderboard) is
// the single source of truth for whether the public leaderboard exists. When
// it is off, the leaderboard must disappear as a public *section* — desktop
// navigation, the sidebar/mobile drawer, the footer map, the Home preview
// block and its "View all" link — not just as a content block. Turning it
// back on must restore everything from the stored data; nothing is deleted.
//
// Run: bun test src/__tests__/leaderboard-visibility.test.ts

import { describe, expect, it } from "bun:test";
import { effectivePublicSections, isPublicSectionEnabled, renderSite } from "../site-render.js";

const baseData = {
  brand: { name: "Toggle Board", tagline: "On and off", period: "Monthly" },
  branding: { template: "classic", font: "Inter", options: {} },
  rankBy: "wagered",
  players: [
    { name: "Alice", rank: 1, wagered: 5000, prize: 100 },
    { name: "Bob", rank: 2, wagered: 3000, prize: 60 },
  ],
  prizes: { wagerLabel: "Wagered", prizeLabel: "Prize" },
  socials: [],
  siteSections: { home: true, leaderboard: true, shop: true, games: false, me: true },
};

const opts = { slug: "toggle-board", homeUrl: "https://example.test", nonce: "fixed-nonce" };

const withSections = (sections) => ({
  slug: "toggle-board",
  plan: "pro",
  data: { ...baseData, sections },
});

const renderHome = (r, viewer = null) =>
  renderSite({ r, section: "home", viewer, viewerData: null, opts });

describe("effectivePublicSections", () => {
  it("defaults the leaderboard on and home is always available", () => {
    expect(effectivePublicSections({})).toEqual({ home: true, leaderboard: true, shop: true, games: false, me: true });
    expect(effectivePublicSections(undefined).leaderboard).toBe(true);
  });

  it("derives leaderboard visibility from data.sections, not from a second siteSections flag", () => {
    // Show Leaderboard = OFF wins even over a stale siteSections.leaderboard: true.
    expect(effectivePublicSections({ sections: { leaderboard: false }, siteSections: { leaderboard: true, shop: true, games: false, me: true } }).leaderboard).toBe(false);
    // A stale siteSections.leaderboard: false can never hide an enabled leaderboard.
    expect(effectivePublicSections({ sections: { leaderboard: true }, siteSections: { leaderboard: false, shop: true, games: false, me: true } }).leaderboard).toBe(true);
    expect(isPublicSectionEnabled({ sections: { leaderboard: false } }, "leaderboard")).toBe(false);
    expect(isPublicSectionEnabled({ sections: { leaderboard: false } }, "home")).toBe(true);
  });

  it("leaves shop, games and me under their own toggles", () => {
    const sections = effectivePublicSections({ sections: { leaderboard: false }, siteSections: { shop: false, games: true, me: false } });
    expect(sections).toEqual({ home: true, leaderboard: false, shop: false, games: true, me: false });
  });
});

describe("public leaderboard visibility", () => {
  it("shows the Leaderboard destination and the Home preview block when enabled", async () => {
    const html = await renderHome(withSections({ leaderboard: true }));
    expect(html).toContain(">Leaderboard</a>");
    expect(html).toContain('href="/toggle-board/leaderboard"');
    expect(html).toContain("viewer-home-board");
    expect(html).toContain("Alice");
  });

  it("removes the leaderboard as a public section everywhere when disabled", async () => {
    const html = await renderHome(withSections({ leaderboard: false }));
    // Desktop navigation / sidebar / mobile rail all render from one list.
    expect(html).not.toContain(">Leaderboard</a>");
    expect(html).not.toContain('href="/toggle-board/leaderboard"');
    // Home carries no preview card, no standings and no empty placeholder.
    expect(html).not.toContain("viewer-home-board");
    expect(html).not.toContain("viewer-home-empty--podium");
    expect(html).not.toContain("viewer-board-list");
    // The other sections are untouched.
    expect(html).toContain(">Home</a>");
    expect(html).toContain(">Rewards</a>");
    expect(html).toContain("viewer-home-rewards");
  });

  it("keeps My Activity and Rewards for signed-in viewers when the leaderboard is off", async () => {
    const html = await renderHome(withSections({ leaderboard: false }), { kick_username: "alice" });
    expect(html).not.toContain(">Leaderboard</a>");
    expect(html).toContain(">Rewards</a>");
    expect(html).toContain(">My Activity</a>");
  });

  it("omits Leaderboard from the legacy top bar and drawer on the games surface", async () => {
    const r = {
      ...withSections({ leaderboard: false }),
      data: { ...withSections({ leaderboard: false }).data, siteSections: { home: true, leaderboard: true, shop: true, games: true, me: true } },
    };
    const html = await renderSite({ r, section: "games", viewer: null, viewerData: null, opts });
    expect(html).toContain("yr-drawer");
    expect(html).not.toContain(">Leaderboard</a>");
    expect(html).not.toContain('href="/toggle-board/leaderboard"');
  });

  it("restores the route content and navigation from stored data when re-enabled — nothing is deleted by hiding", async () => {
    const off = await renderHome(withSections({ leaderboard: false }));
    expect(off).not.toContain("viewer-home-board");

    const on = await renderHome(withSections({ leaderboard: true }));
    expect(on).toContain(">Leaderboard</a>");
    expect(on).toContain("viewer-home-board");
    expect(on).toContain("Alice");
    expect(on).toContain("Bob");

    const board = await renderSite({ r: withSections({ leaderboard: true }), section: "leaderboard", viewer: null, viewerData: null, opts });
    expect(board).toContain("Alice");
    expect(board).toContain("Bob");
  });

  it("uses custom-domain home links without the slug prefix", async () => {
    const off = await renderSite({
      r: withSections({ leaderboard: false }),
      section: "home",
      viewer: null,
      viewerData: null,
      opts: { ...opts, isCustomDomain: true },
    });
    expect(off).not.toContain('href="/leaderboard"');
    const on = await renderSite({
      r: withSections({ leaderboard: true }),
      section: "home",
      viewer: null,
      viewerData: null,
      opts: { ...opts, isCustomDomain: true },
    });
    expect(on).toContain('href="/leaderboard"');
  });
});
