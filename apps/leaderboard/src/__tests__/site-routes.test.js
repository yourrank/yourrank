// Tests for the public multi-section site shell.
// Covers route parsing, section visibility enforcement, and the logged-out vs
// logged-in rendering split for Home, Leaderboard, Shop, Games and My Community.
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
  ARCHIVE_LIMITS: { free: 6, pro: 12, team: 24 },
  detectImageMime,
  validateLogoData,
};

// ── Mock site-data.js to avoid DB queries for viewer data ───────────────
const routeSiteData = {
  calls: [],
  getShopItems: () => Promise.resolve(SHOP_ITEMS),
  getViewerSiteData: (_siteId, viewerId, opts) => {
    routeSiteData.calls.push({ siteId: _siteId, viewerId, opts });
    if (!viewerId) {
      return Promise.resolve({ viewerOnSite: null, shopItems: opts?.shop ? SHOP_ITEMS : [], claims: [], ledger: [], participation: [] });
    }
    const ownsHistory = viewerId !== "v2";
    return Promise.resolve({
      viewerOnSite: { id: "sv-1", balance: 500, blocked: false, total_earned: 1000, total_spent: 100 },
      shopItems: opts?.shop ? SHOP_ITEMS : [],
      claims: opts?.claims && ownsHistory ? [{ id: "redemption:r-1", reward: { name: "Shoutout", cost: 100 }, status: "submitted", statusLabel: "Needs fulfillment", submittedAt: new Date().toISOString(), completedAt: null, cancelledAt: null }] : [],
      ledger: opts?.ledger && ownsHistory ? [{ id: "l-1", type: "earn", amount: 50, description: "Stream", created_at: new Date().toISOString() }] : [],
      participation: opts?.participation && ownsHistory ? [{ type: "code_drop_claim", title: "Claimed a code drop", status: "claimed", statusLabel: "Claimed", participatedAt: new Date().toISOString() }] : [],
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
import { handleRequest, isCustomViewerApiPath, isCustomViewerAuthPath } from "../index.js";
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

  it("passes only supported viewer auth and Join paths through custom-domain routing", () => {
    expect(isCustomViewerAuthPath("GET", "/api/viewer/auth/kick")).toBe(true);
    expect(isCustomViewerAuthPath("GET", "/api/viewer/auth/kick/callback")).toBe(true);
    expect(isCustomViewerAuthPath("GET", "/api/viewer/auth/kick/handoff")).toBe(true);
    expect(isCustomViewerAuthPath("GET", "/api/viewer/auth/discord")).toBe(true);
    expect(isCustomViewerAuthPath("GET", "/api/viewer/auth/discord/callback")).toBe(true);
    expect(isCustomViewerAuthPath("POST", "/api/viewer/auth/kick/handoff")).toBe(false);
    expect(isCustomViewerAuthPath("GET", "/api/dashboard/status")).toBe(false);
    expect(isCustomViewerApiPath("POST", "/api/viewer/membership/join")).toBe(true);
    expect(isCustomViewerApiPath("POST", "/api/viewer/redeem")).toBe(false);
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

  it("routes custom-domain explicit Join through the normal API handler", async () => {
    const apiApp = {
      fetch: async (request) => {
        expect(request.method).toBe("POST");
        expect(new URL(request.url).pathname).toBe("/api/viewer/membership/join");
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };
    const response = await handleRequest(
      req("https://streamer.example/api/viewer/membership/join", { method: "POST" }),
      {},
      ctx,
      {},
      { resolveCustomDomain: async () => "streamer", apiApp },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
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

  it("shop is browsable logged out with sign-in CTAs instead of claim buttons", async () => {
    const res = await renderSiteRoute({ request: req("https://example.com/streamer/shop"), env, ctx, nonce: "n", slug: "streamer", section: "shop", isCustomDomain: false });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Shoutout");
    expect(html).toContain("Sign in with Kick");
    expect(html).not.toContain(">Claim<");
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

  it("My Community explains membership when logged out", async () => {
    const res = await renderSiteRoute({ request: req("https://example.com/streamer/me"), env, ctx, nonce: "n", slug: "streamer", section: "me", isCustomDomain: false });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("My Community");
    expect(html).toContain("Community membership");
    expect(html).toContain("Sign in with Kick");
  });

  it("shows controlled OAuth errors on creator-scoped My Community", async () => {
    const res = await renderSiteRoute({ request: req("https://streamer.example/me?error=not-a-real-provider-error"), env, ctx, nonce: "n", slug: "streamer", section: "me", isCustomDomain: true });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("We couldn&#39;t complete sign-in. Try again.");
    expect(html).not.toContain("not-a-real-provider-error");
  });

  it("logged-in viewers see their balance and claim buttons on shop", async () => {
    const viewer = { id: "v1", kick_username: "viewer1", avatar_url: null };
    const request = req("https://example.com/streamer/shop", { viewer });
    const res = await renderSiteRoute({ request, env, ctx, nonce: "n", slug: "streamer", section: "shop", isCustomDomain: false });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<span class="yr-vbal-num" data-credit-balance-num>500</span>'); // balance in the shop hero
    expect(html).toContain(">Claim<");
    expect(html).not.toContain("Sign in with Kick");
  });

  it("logged-in viewers see site-scoped Participation, credits and canonical Claims in My Community", async () => {
    const viewer = { id: "v1", kick_username: "viewer1", avatar_url: null };
    const request = req("https://example.com/streamer/me", { viewer });
    const res = await renderSiteRoute({ request, env, ctx, nonce: "n", slug: "streamer", section: "me", isCustomDomain: false });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Credits");
    expect(html).toContain('<span class="yr-vbal-num" data-credit-balance-num>500</span>'); // balance in the hero
    expect(html).toContain("Shoutout"); // claim
    expect(html).toContain("Stream"); // ledger description
    expect(html).toContain("Claimed a code drop");
    expect(html).not.toContain(">Recognition<");
  });

  it("uses the same site-scoped history composition on a custom domain", async () => {
    routeSiteData.calls.length = 0;
    const viewer = { id: "v1", kick_username: "viewer1", avatar_url: null };
    const request = req("https://streamer.example/me", { viewer });
    const res = await renderSiteRoute({ request, env, ctx, nonce: "n", slug: "streamer", section: "me", isCustomDomain: true });
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(routeSiteData.calls.at(-1)).toEqual({
      siteId: "site-1",
      viewerId: "v1",
      opts: { claims: true, ledger: true, participation: true },
    });
    expect(html).toContain("Claimed a code drop");
    expect(html).toContain("Shoutout");
    expect(html).toContain('href="https://yourrank.site/me"');
  });

  it("never carries one Viewer Account's history into the next signed-in response", async () => {
    const viewerARequest = req("https://example.com/streamer/me", { viewer: { id: "v1", kick_username: "viewer1" } });
    const viewerAResponse = await renderSiteRoute({ request: viewerARequest, env, ctx, nonce: "a", slug: "streamer", section: "me", isCustomDomain: false });
    const viewerAHtml = await viewerAResponse.text();
    expect(viewerAHtml).toContain("Claimed a code drop");
    expect(viewerAHtml).toContain("Shoutout");

    const viewerBRequest = req("https://example.com/streamer/me", { viewer: { id: "v2", kick_username: "viewer2" } });
    const viewerBResponse = await renderSiteRoute({ request: viewerBRequest, env, ctx, nonce: "b", slug: "streamer", section: "me", isCustomDomain: false });
    const viewerBHtml = await viewerBResponse.text();
    expect(viewerBResponse.headers.get("cache-control")).toContain("private");
    expect(viewerBResponse.headers.get("cache-control")).toContain("no-store");
    expect(viewerBResponse.headers.get("vary")).toContain("Cookie");
    expect(viewerBHtml).not.toContain("Claimed a code drop");
    expect(viewerBHtml).not.toContain("Shoutout");
    expect(viewerBHtml).toContain("No participation history yet");
    expect(viewerBHtml).toContain("No claims yet");
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
