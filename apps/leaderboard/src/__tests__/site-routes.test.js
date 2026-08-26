// Tests for the public multi-section site shell.
// Covers route parsing, section visibility enforcement, and the logged-out vs
// logged-in rendering split for Home, Leaderboard, Shop, Games and My Credits.
//
// Run: bun test src/__tests__/site-routes.test.js

import { describe, it, expect } from "bun:test";
import { detectImageMime, validateLogoData } from "../logo-validation.js";

// ── Helper: resolve module paths the same way the source files do ───────
// ── Shared module mocks ────────────────────────────────────────────────
const viewerByRequest = new Map();
const routeViewer = (req) => Promise.resolve(viewerByRequest.get(req) || { viewer: null, cookie: null });

// ── Mock site.js (constants + getPublicSite) ──────────────────────────
const DEFAULT_EXTRA = {
  chips: [],
  whyStats: [],
  rules: [],
  socials: [],
  sections: {
    hero: true, leaderboard: true, top3: true, search: true, rules: true,
    partner: true, socials: true, share: true, pastWinners: true, countdown: true,
    cta: true, payouts: true, poweredBy: false,
  },
  playerFields: { score: true, hands: true, netProfit: true, winRate: true, change: true },
  legal: {
    terms: "", termsEnabled: true, privacy: "", privacyEnabled: true,
    responsible: "", responsibleEnabled: true, cookies: "", cookiesEnabled: true,
    refund: "", refundEnabled: true, contact: "", contactEnabled: true,
  },
};

const FONT_FAMILIES = {
  Inter: "Inter",
  Oswald: "Oswald",
  "Playfair Display": "'Playfair Display'",
  Rajdhani: "Rajdhani",
  "Bebas Neue": "'Bebas Neue'",
};

const SHOP_ITEMS = [
  { id: "item-1", name: "Shoutout", description: "The streamer says your name.", cost: 100, stock: 5, active: true },
  { id: "item-2", name: "Discord role", description: "Custom role for one month.", cost: 500, stock: null, active: true },
];

function baseSiteData(siteSections = { home: true, leaderboard: true, shop: true, games: true, me: true }) {
  return {
    brand: {
      name: "TestStreamer",
      casino: "",
      code: "",
      prizePool: "$1,000",
      period: "Monthly",
      tagline: "Test tagline",
    },
    branding: { template: "classic", font: "Inter", options: {} },
    players: [
      { name: "Alice", wagered: 5000, prize: "$100" },
      { name: "Bob", wagered: 3000, prize: "$60" },
    ],
    prizes: { prizePoolLabel: "Prize pool" },
    partner: { chips: [], blurb: "" },
    socials: [],
    whyStats: [],
    endsAt: new Date(Date.now() + 86400000).toISOString(),
    sections: {},
    legal: DEFAULT_EXTRA.legal,
    siteSections,
  };
}

function makeSite(slug, sections) {
  return {
    id: "site-1",
    slug,
    plan: "pro",
    suspended: false,
    viewerKickAuthEnabled: true,
    viewerDiscordAuthEnabled: false,
    viewerPublicRedeemEnabled: false,
    data: baseSiteData(sections),
  };
}

const routeSite = {
  DEFAULT_EXTRA,
  FONT_FAMILIES,
  getPublicSite: (_env, slug, _request) => {
    if (slug === "missing") return null;
    if (slug === "suspended") return { id: "site-s", suspended: true, data: {} };
    if (slug === "password") return { id: "site-p", slug, requiresPassword: true, name: "Private Board", data: {} };
    if (slug === "error") throw new Error("render failure");
    if (slug === "disabled") return makeSite("disabled", { home: true, leaderboard: true, shop: false, games: false, me: false });
    return makeSite(slug || "streamer");
  },
  getBySlug: () => Promise.resolve(null),
  getArchives: () => Promise.resolve([]),
  ARCHIVE_LIMITS: { free: 6, starter: 6, pro: 12, agency: 24 },
  detectImageMime,
  validateLogoData,
};

// ── Mock site-data.js to avoid DB queries for viewer data ───────────────
const routeSiteData = {
  getShopItems: () => Promise.resolve(SHOP_ITEMS),
  getViewerSiteData: (_siteId, viewerId, opts) => {
    if (!viewerId) {
      return Promise.resolve({ viewerOnSite: null, shopItems: SHOP_ITEMS, redemptions: [], ledger: [] });
    }
    return Promise.resolve({
      viewerOnSite: { id: "sv-1", balance: 500, blocked: false, total_earned: 1000, total_spent: 100 },
      shopItems: opts?.shop ? SHOP_ITEMS : [],
      redemptions: opts?.redemptions ? [{ id: "r-1", cost: 100, status: "pending", created_at: new Date().toISOString(), item_name: "Shoutout" }] : [],
      ledger: opts?.ledger ? [{ id: "l-1", type: "earn", amount: 50, description: "Stream", created_at: new Date().toISOString() }] : [],
    });
  },
};

// ── Mock stats.js to avoid shared module loading in tests ────────────────
const routeDeps = {
  getPublicSite: routeSite.getPublicSite,
  resolveViewer: routeViewer,
  createQueueProducer: () => ({ send: () => Promise.resolve() }),
  bumpStat: () => Promise.resolve(),
  hashToken: async () => "hash",
  getViewerSiteData: routeSiteData.getViewerSiteData,
};

// ── Import after mocks ─────────────────────────────────────────────────
import { parseSitePath, renderSiteRoute as renderSiteRouteImpl } from "../site-routes.js";
import { handleRequest, isCustomViewerAuthPath } from "../index.js";
const renderSiteRoute = (args) => renderSiteRouteImpl({ ...args, deps: routeDeps });

function req(url, opts = {}) {
  const request = new Request(url, { method: opts.method || "GET", headers: opts.headers || {} });
  if (opts.viewer) viewerByRequest.set(request, { viewer: opts.viewer, cookie: null });
  return request;
}

const env = {};
const ctx = { waitUntil: () => {} };

async function expectHydratedResponse(response, nonce) {
  const body = await response.text();
  const csp = response.headers.get("content-security-policy") || "";
  expect(body).toContain(`nonce="${nonce}"`);
  expect(csp).toContain(`'nonce-${nonce}'`);
  expect(body).not.toContain("__YOURRANK_");
  expect(csp).not.toContain("__YOURRANK_");
  expect(response.headers.get("set-cookie") || "").not.toContain("__YOURRANK_");
}

// ── Route parsing ──────────────────────────────────────────────────────

describe("parseSitePath", () => {
  it("maps /<slug> and /<slug>/ to home", () => {
    expect(parseSitePath("/foo", false)).toEqual({ slug: "foo", section: "home" });
    expect(parseSitePath("/foo/", false)).toEqual({ slug: "foo", section: "home" });
  });

  it("maps /<slug>/<section> to the named section", () => {
    expect(parseSitePath("/foo/leaderboard", false)).toEqual({ slug: "foo", section: "leaderboard" });
    expect(parseSitePath("/foo/shop", false)).toEqual({ slug: "foo", section: "shop" });
    expect(parseSitePath("/foo/games", false)).toEqual({ slug: "foo", section: "games" });
    expect(parseSitePath("/foo/me", false)).toEqual({ slug: "foo", section: "me" });
  });

  it("rejects unknown sections and extra path segments", () => {
    expect(parseSitePath("/foo/unknown", false)).toBeNull();
    expect(parseSitePath("/foo/shop/extra", false)).toBeNull();
  });

  it("works on custom domains without a slug prefix", () => {
    expect(parseSitePath("/", true, "foo")).toEqual({ slug: "foo", section: "home" });
    expect(parseSitePath("/shop", true, "foo")).toEqual({ slug: "foo", section: "shop" });
    expect(parseSitePath("/unknown", true, "foo")).toBeNull();
  });

  it("passes only viewer Kick auth paths through custom-domain routing", () => {
    expect(isCustomViewerAuthPath("GET", "/api/viewer/auth/kick")).toBe(true);
    expect(isCustomViewerAuthPath("GET", "/api/viewer/auth/kick/callback")).toBe(true);
    expect(isCustomViewerAuthPath("GET", "/api/viewer/auth/kick/handoff")).toBe(true);
    expect(isCustomViewerAuthPath("POST", "/api/viewer/auth/kick/handoff")).toBe(false);
    expect(isCustomViewerAuthPath("GET", "/api/dashboard/status")).toBe(false);
  });

  it("routes the custom-domain viewer handoff through the normal handler", async () => {
    const apiApp = {
      fetch: async (request) => {
        expect(new URL(request.url).pathname).toBe("/api/viewer/auth/kick/handoff");
        return new Response("viewer handoff handler", { status: 200 });
      },
    };
    const response = await handleRequest(
      req("https://streamer.example/api/viewer/auth/kick/handoff?handoff=test"),
      {},
      ctx,
      {},
      { resolveCustomDomain: async () => "streamer", apiApp },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("viewer handoff handler");
  });
});

// ── Section visibility enforcement ──────────────────────────────────────

describe("section visibility", () => {
  it("renders enabled sections and returns 404 for disabled sections", async () => {
    const home = await renderSiteRoute({ request: req("https://example.com/disabled"), env, ctx, nonce: "n", slug: "disabled", section: "home", isCustomDomain: false });
    expect(home.status).toBe(200);

    const shop = await renderSiteRoute({ request: req("https://example.com/disabled/shop"), env, ctx, nonce: "n", slug: "disabled", section: "shop", isCustomDomain: false });
    expect(shop.status).toBe(404);

    const games = await renderSiteRoute({ request: req("https://example.com/disabled/games"), env, ctx, nonce: "n", slug: "disabled", section: "games", isCustomDomain: false });
    expect(games.status).toBe(404);

    const me = await renderSiteRoute({ request: req("https://example.com/disabled/me"), env, ctx, nonce: "n", slug: "disabled", section: "me", isCustomDomain: false });
    expect(me.status).toBe(404);
  });

  it("returns 404 for a nonexistent site", async () => {
    const res = await renderSiteRoute({ request: req("https://example.com/missing"), env, ctx, nonce: "n", slug: "missing", section: "home", isCustomDomain: false });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a suspended site", async () => {
    const res = await renderSiteRoute({ request: req("https://example.com/suspended"), env, ctx, nonce: "n", slug: "suspended", section: "home", isCustomDomain: false });
    expect(res.status).toBe(404);
  });

  it("keeps a cookie-free password gate nonce-matched and hydrated", async () => {
    const res = await renderSiteRoute({
      request: req("https://example.com/password"),
      env,
      ctx,
      nonce: "password-nonce",
      slug: "password",
      section: "home",
      isCustomDomain: false,
    });
    expect(res.status).toBe(200);
    await expectHydratedResponse(res, "password-nonce");
  });

  it("keeps the 500 response nonce-matched and hydrated", async () => {
    const res = await renderSiteRoute({
      request: req("https://example.com/error"),
      env,
      ctx,
      nonce: "error-nonce",
      slug: "error",
      section: "home",
      isCustomDomain: false,
    });
    expect(res.status).toBe(500);
    await expectHydratedResponse(res, "error-nonce");
  });
});

// ── Logged-out vs logged-in rendering split ────────────────────────────

describe("logged-out vs logged-in rendering", () => {
  it("home and leaderboard are public and show a sign-in CTA when logged out", async () => {
    const homeRes = await renderSiteRoute({ request: req("https://example.com/streamer"), env, ctx, nonce: "n", slug: "streamer", section: "home", isCustomDomain: false });
    expect(homeRes.status).toBe(200);
    const homeHtml = await homeRes.text();
    expect(homeHtml).toContain("Sign in with Kick");
    expect(homeHtml).toContain("Credits");
    expect(homeHtml).toContain("TestStreamer");

    const lbRes = await renderSiteRoute({ request: req("https://example.com/streamer/leaderboard"), env, ctx, nonce: "n", slug: "streamer", section: "leaderboard", isCustomDomain: false });
    expect(lbRes.status).toBe(200);
    const lbHtml = await lbRes.text();
    expect(lbHtml).toContain("Alice");
    expect(lbHtml).toContain("Sign in with Kick");
  });

  it("does not emit renderer comments inside leaderboard rows", async () => {
    const res = await renderSiteRoute({
      request: req("https://example.com/streamer/leaderboard"),
      env,
      ctx,
      nonce: "n",
      slug: "streamer",
      section: "leaderboard",
      isCustomDomain: false,
    });
    const html = await res.text();
    const rows = html.match(/<ol class="yr-stand"[^>]*>([\s\S]*?)<\/ol>/)?.[1] || "";
    const rowBodies = [...rows.matchAll(/<li class="yr-srow[^>]*>([\s\S]*?)<a /g)].map((match) => match[1]);
    expect(rowBodies.length).toBeGreaterThan(0);
    expect(rowBodies.join("")).not.toContain("U-09");
    expect(rowBodies.join("")).not.toContain("//");
  });

  it("shop is browsable logged out with sign-in CTAs instead of order buttons", async () => {
    const res = await renderSiteRoute({ request: req("https://example.com/streamer/shop"), env, ctx, nonce: "n", slug: "streamer", section: "shop", isCustomDomain: false });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Shoutout");
    expect(html).toContain("Sign in with Kick");
    expect(html).not.toContain(">Order<");
  });

  it("games shows a locked panel with a sign-in CTA when logged out", async () => {
    const res = await renderSiteRoute({ request: req("https://example.com/streamer/games"), env, ctx, nonce: "n", slug: "streamer", section: "games", isCustomDomain: false });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Sign in to play originals");
    expect(html).toContain("Sign in with Kick");
  });

  it("uses a custom-domain-served return path for the games sign-in CTA", async () => {
    const res = await renderSiteRoute({ request: req("https://streamer.example/games"), env, ctx, nonce: "n", slug: "streamer", section: "games", isCustomDomain: true });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("returnTo=https%3A%2F%2Fstreamer.example%2Fgames");
    expect(html).not.toContain("returnTo=https%3A%2F%2Fstreamer.example%2Fstreamer%2Fgames");
  });

  it("Credits is a sign-in prompt when logged out", async () => {
    const res = await renderSiteRoute({ request: req("https://example.com/streamer/me"), env, ctx, nonce: "n", slug: "streamer", section: "me", isCustomDomain: false });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Credits");
    expect(html).toContain("Sign in with Kick");
  });

  it("logged-in viewers see their balance and order buttons on shop", async () => {
    const viewer = { id: "v1", kick_username: "viewer1", avatar_url: null };
    const request = req("https://example.com/streamer/shop", { viewer });
    const res = await renderSiteRoute({ request, env, ctx, nonce: "n", slug: "streamer", section: "shop", isCustomDomain: false });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(">500</p>"); // balance in the shop hero
    expect(html).toContain(">Order<");
    expect(html).not.toContain("Sign in with Kick");
  });

  it("logged-in viewers see history and orders on Credits", async () => {
    const viewer = { id: "v1", kick_username: "viewer1", avatar_url: null };
    const request = req("https://example.com/streamer/me", { viewer });
    const res = await renderSiteRoute({ request, env, ctx, nonce: "n", slug: "streamer", section: "me", isCustomDomain: false });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Credits");
    expect(html).toContain(">500</p>"); // balance in the hero
    expect(html).toContain("Shoutout"); // order
    expect(html).toContain("Stream"); // ledger description
  });

  it("leaderboard renders inside the shared site shell", async () => {
    const res = await renderSiteRoute({ request: req("https://example.com/streamer/leaderboard"), env, ctx, nonce: "n", slug: "streamer", section: "leaderboard", isCustomDomain: false });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Alice");
    expect(html).toContain('class="yr-top"');
    expect(html).toContain('class="yr-drawer"');
    expect(html).toContain("Leaderboard");
  });
});
