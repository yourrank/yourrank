// Tests for the public multi-section site shell.
// Covers route parsing, section visibility enforcement, and the logged-out vs
// logged-in rendering split for Home, Leaderboard, Shop, Games and My activity.
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
    // Show Leaderboard = OFF: the sections block toggle is false while the
    // legacy siteSections.leaderboard flag stays stale-true.
    if (slug === "nolb") {
      const s = makeSite("nolb");
      s.data.sections = { leaderboard: false };
      return s;
    }
    // Show Loyalty leaderboard = ON alongside the master switch.
    if (slug === "loyal") {
      const s = makeSite("loyal");
      s.data.sections = { leaderboard: true, loyaltyLeaderboard: true };
      return s;
    }
    // Master switch OFF beats the Loyalty flag.
    if (slug === "nolb-loyal") {
      const s = makeSite("nolb-loyal");
      s.data.sections = { leaderboard: false, loyaltyLeaderboard: true };
      return s;
    }
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
  getShopItem: (siteId, rewardId) => {
    routeSiteData.calls.push({ siteId, rewardId });
    if (rewardId === "withdrawn") return Promise.resolve({ id: "withdrawn", name: "Old hoodie", description: "", cost: 900, stock: null, active: false });
    return Promise.resolve(SHOP_ITEMS.find((item) => item.id === rewardId) || null);
  },
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
  getShopItem: routeSiteData.getShopItem,
  getLoyaltyBoard: (siteId) => {
    routeSiteData.calls.push({ loyaltySiteId: siteId });
    return Promise.resolve(LOYALTY_ROWS);
  },
};

const LOYALTY_ROWS = [
  { viewerId: "viewer-a", name: "Viewer A", avatarUrl: "https://cdn.example/a.png", earned: 500, rank: 1 },
  { viewerId: "viewer-b", name: "Viewer B", avatarUrl: null, earned: 300, rank: 2 },
];

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
    expect(parseSitePath("/foo/activity", false)).toEqual({ slug: "foo", section: "me" });
  });

  it("resolves the legacy /me segment to My Activity and names the canonical /activity path", () => {
    expect(parseSitePath("/foo/me", false)).toEqual({ slug: "foo", section: "me", redirectTo: "/foo/activity" });
    expect(parseSitePath("/me", true, "foo")).toEqual({ slug: "foo", section: "me", redirectTo: "/activity" });
    expect(parseSitePath("/foo/activity", false).redirectTo).toBeUndefined();
    expect(parseSitePath("/activity", true, "foo")).toEqual({ slug: "foo", section: "me" });
  });

  it("rejects unknown sections and extra path segments", () => {
    expect(parseSitePath("/foo/unknown", false)).toBeNull();
    expect(parseSitePath("/foo/leaderboard/extra", false)).toBeNull();
    expect(parseSitePath("/foo/shop/extra/more", false)).toBeNull();
    expect(parseSitePath("/foo/shop/not%20valid", false)).toBeNull();
    expect(parseSitePath("/foo/shop/" + "x".repeat(65), false)).toBeNull();
  });

  it("maps /<slug>/shop/<rewardId> to the reward detail page (YR-012)", () => {
    expect(parseSitePath("/foo/shop/item-1", false)).toEqual({ slug: "foo", section: "shop", rewardId: "item-1" });
    expect(parseSitePath("/foo/shop/3f2b9c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b/", false)).toEqual({ slug: "foo", section: "shop", rewardId: "3f2b9c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b" });
    expect(parseSitePath("/shop/item-1", true, "foo")).toEqual({ slug: "foo", section: "shop", rewardId: "item-1" });
    expect(parseSitePath("/activity/item-1", true, "foo")).toBeNull();
  });

  it("works on custom domains without a slug prefix", () => {
    expect(parseSitePath("/", true, "foo")).toEqual({ slug: "foo", section: "home" });
    expect(parseSitePath("/shop", true, "foo")).toEqual({ slug: "foo", section: "shop" });
    expect(parseSitePath("/unknown", true, "foo")).toBeNull();
    expect(parseSitePath("/shop/a/b", true, "foo")).toBeNull();
  });

  it("passes only supported viewer auth, Join, and free code-drop claim paths through custom-domain routing", () => {
    expect(isCustomViewerAuthPath("GET", "/api/viewer/auth/kick")).toBe(true);
    expect(isCustomViewerAuthPath("GET", "/api/viewer/auth/kick/callback")).toBe(true);
    expect(isCustomViewerAuthPath("GET", "/api/viewer/auth/kick/handoff")).toBe(true);
    expect(isCustomViewerAuthPath("GET", "/api/viewer/auth/discord")).toBe(true);
    expect(isCustomViewerAuthPath("GET", "/api/viewer/auth/discord/callback")).toBe(true);
    expect(isCustomViewerAuthPath("POST", "/api/viewer/auth/kick/handoff")).toBe(false);
    expect(isCustomViewerAuthPath("GET", "/api/dashboard/status")).toBe(false);
    expect(isCustomViewerApiPath("POST", "/api/viewer/membership/join")).toBe(true);
    expect(isCustomViewerApiPath("POST", "/api/events/drops/claim")).toBe(true);
    expect(isCustomViewerApiPath("GET", "/api/events/drops/claim")).toBe(false);
    expect(isCustomViewerApiPath("POST", "/api/events/raffles")).toBe(false);
    expect(isCustomViewerApiPath("POST", "/api/viewer/redeem")).toBe(false);
  });

  it("redirects the legacy /me section permanently to /activity, keeping the query string", async () => {
    const custom = await handleRequest(
      req("https://streamer.example/me?intent=join"),
      {},
      ctx,
      {},
      { resolveCustomDomain: async () => "streamer" },
    );
    expect(custom.status).toBe(301);
    expect(custom.headers.get("location")).toBe("https://streamer.example/activity?intent=join");

    const primary = await handleRequest(req("https://yourrank.site/streamer/me"), {}, ctx, {}, { resolveCustomDomain: async () => null });
    expect(primary.status).toBe(301);
    expect(primary.headers.get("location")).toBe("https://yourrank.site/streamer/activity");

    const demo = await handleRequest(req("https://yourrank.site/demo/me"), {}, ctx, {}, { resolveCustomDomain: async () => null });
    expect(demo.status).toBe(301);
    expect(demo.headers.get("location")).toBe("https://yourrank.site/demo/activity");
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

  it("routes a custom-domain free code-drop claim through the normal API handler", async () => {
    const apiApp = {
      fetch: async (request) => {
        expect(request.method).toBe("POST");
        expect(new URL(request.url).pathname).toBe("/api/events/drops/claim");
        return new Response(JSON.stringify({ ok: true, pointsAwarded: 25 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };
    const response = await handleRequest(
      req("https://streamer.example/api/events/drops/claim", { method: "POST" }),
      {},
      ctx,
      {},
      { resolveCustomDomain: async () => "streamer", apiApp },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, pointsAwarded: 25 });
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

    const me = await renderSiteRoute({ request: req("https://example.com/disabled/activity"), env, ctx, nonce: "n", slug: "disabled", section: "me", isCustomDomain: false });
    expect(me.status).toBe(404);
  });

  it("serves one reward at a stable URL for guests and members, and recovers from bad ids (YR-011/012)", async () => {
    const detail = (path, extra = {}) => renderSiteRoute({ request: req(`https://example.com${path}`, extra), env, ctx, nonce: "n", slug: "streamer", section: "shop", rewardId: path.split("/")[3], isCustomDomain: false });

    const guest = await detail("/streamer/shop/item-1");
    expect(guest.status).toBe(200);
    const guestHtml = await guest.text();
    expect(guestHtml).toContain("<h1>Shoutout</h1>");
    expect(guestHtml).toContain('<link rel="canonical" href="https://example.com/streamer/shop/item-1" />');
    expect(guestHtml).toContain("<title>Shoutout · Rewards · ");
    expect(guestHtml).toContain("The streamer says your name.");
    expect(guestHtml).toContain("<dd>5 left.</dd>");
    expect(guestHtml).toContain("<span>Fulfillment</span></dt>");
    expect(guestHtml).toContain('<a href="/streamer/contact">Contact ');
    expect(guestHtml).toContain('href="/streamer/shop"');
    // Guests are sent to the community gate with the reward identity, never straight to a claim.
    expect(guestHtml).toContain('href="https://example.com/streamer/activity?intent=reward&reward=item-1">Sign in to claim</a>');
    expect(guestHtml).not.toContain("data-redeem=");
    expect(guestHtml).not.toContain("sv-1");

    const member = await detail("/streamer/shop/item-1", { viewer: { id: "v1", kick_username: "m" } });
    const memberHtml = await member.text();
    expect(memberHtml).toContain("You have 500 credits — enough to claim this.");
    expect(memberHtml).toContain('data-redeem="item-1"');
    expect(memberHtml).toContain('id="yr-order-confirm"');

    const withdrawn = await detail("/streamer/shop/withdrawn");
    expect(withdrawn.status).toBe(404);
    const withdrawnHtml = await withdrawn.text();
    expect(withdrawnHtml).toContain("<h1>Old hoodie</h1>");
    expect(withdrawnHtml).toContain("No longer offered by the creator.");
    expect(withdrawnHtml).toContain(">No longer offered</span>");
    expect(withdrawnHtml).toContain("hasn't added a description yet");

    const unknown = await detail("/streamer/shop/nope");
    expect(unknown.status).toBe(404);
    const unknownHtml = await unknown.text();
    expect(unknownHtml).toContain("<h1>This reward isn't available</h1>");
    expect(unknownHtml).toContain('<a class="yr-btn" href="/streamer/shop">See all rewards</a>');
    expect(unknownHtml).toContain('class="viewer-destinations"');

    // The lookup is always scoped to the resolved community.
    expect(routeSiteData.calls.filter((c) => c.rewardId).every((c) => c.siteId === "site-1")).toBe(true);
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
    expect(homeHtml).toContain('href="/streamer/activity">Sign in</a>');
    expect(homeHtml).not.toContain("/api/viewer/auth/");
    expect(homeHtml).toContain("Credits");
    expect(homeHtml).toContain("TestStreamer");

    const lbRes = await renderSiteRoute({ request: req("https://example.com/streamer/leaderboard"), env, ctx, nonce: "n", slug: "streamer", section: "leaderboard", isCustomDomain: false });
    expect(lbRes.status).toBe(200);
    const lbHtml = await lbRes.text();
    expect(lbHtml).toContain("Alice");
    expect(lbHtml).toContain('href="/streamer/activity">Sign in</a>');
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
    expect(html).toContain("/streamer/activity?intent=reward&reward=");
    expect(html).toContain("Sign in to claim");
    expect(html).not.toContain("/api/viewer/auth/");
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

  it("My activity explains membership when logged out", async () => {
    const res = await renderSiteRoute({ request: req("https://example.com/streamer/activity"), env, ctx, nonce: "n", slug: "streamer", section: "me", isCustomDomain: false });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("My Activity");
    expect(html).toContain("Your credits, claims and activity in TestStreamer");
    expect(html).toContain("Sign in to TestStreamer");
    expect(html).toContain('href="/api/viewer/auth/kick?returnTo=https%3A%2F%2Fexample.com%2Fstreamer">Sign in with Kick</a>');
    expect(html).toContain('href="/streamer/activity?intent=join">Join TestStreamer</a>');

    const joinRes = await renderSiteRoute({ request: req("https://example.com/streamer/activity?intent=join"), env, ctx, nonce: "n", slug: "streamer", section: "me", isCustomDomain: false });
    const joinHtml = await joinRes.text();
    expect(joinHtml).toContain("Join TestStreamer");
    expect(joinHtml).toContain('href="/api/viewer/auth/kick?returnTo=https%3A%2F%2Fexample.com%2Fstreamer%2Factivity&intent=join&site=streamer">Join with Kick</a>');

    const hostileRes = await renderSiteRoute({ request: req("https://example.com/streamer/activity?intent=reward&reward=..%2F%2Fevil"), env, ctx, nonce: "n", slug: "streamer", section: "me", isCustomDomain: false });
    const hostileHtml = await hostileRes.text();
    expect(hostileHtml).toContain('data-viewer-intent="signin"');
    expect(hostileHtml).not.toContain("evil");
  });

  it("shows controlled OAuth errors on creator-scoped My activity", async () => {
    const res = await renderSiteRoute({ request: req("https://streamer.example/activity?error=not-a-real-provider-error"), env, ctx, nonce: "n", slug: "streamer", section: "me", isCustomDomain: true });
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
    expect(html).toContain('<span data-credit-balance-num>500</span>'); // balance in the shop strip
    expect(html).toContain(">Redeem</button>");
    expect(html).not.toContain("Sign in with Kick");
  });

  it("logged-in viewers see site-scoped Participation, credits and canonical Claims in My activity", async () => {
    const viewer = { id: "v1", kick_username: "viewer1", avatar_url: null };
    const request = req("https://example.com/streamer/activity", { viewer });
    const res = await renderSiteRoute({ request, env, ctx, nonce: "n", slug: "streamer", section: "me", isCustomDomain: false });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Credits");
    expect(html).toContain('<strong data-credit-balance-num>500</strong>'); // compact membership balance
    expect(html).toContain("Shoutout"); // claim
    expect(html).toContain("Stream"); // ledger description
    expect(html).toContain("Claimed a code drop");
    expect(html).not.toContain(">Recognition<");
  });

  it("uses the same site-scoped history composition on a custom domain", async () => {
    routeSiteData.calls.length = 0;
    const viewer = { id: "v1", kick_username: "viewer1", avatar_url: null };
    const request = req("https://streamer.example/activity", { viewer });
    const res = await renderSiteRoute({ request, env, ctx, nonce: "n", slug: "streamer", section: "me", isCustomDomain: true });
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(routeSiteData.calls.at(-1)).toEqual({
      siteId: "site-1",
      viewerId: "v1",
      opts: { shop: true, claims: true, ledger: true, participation: true },
    });
    expect(html).toContain("Claimed a code drop");
    expect(html).toContain("Shoutout");
    expect(html).toContain('href="https://yourrank.site/me?community=streamer"');
  });

  it("never carries one Viewer Account's history into the next signed-in response", async () => {
    const viewerARequest = req("https://example.com/streamer/activity", { viewer: { id: "v1", kick_username: "viewer1" } });
    const viewerAResponse = await renderSiteRoute({ request: viewerARequest, env, ctx, nonce: "a", slug: "streamer", section: "me", isCustomDomain: false });
    const viewerAHtml = await viewerAResponse.text();
    expect(viewerAHtml).toContain("Claimed a code drop");
    expect(viewerAHtml.match(/<section[^>]*id="membership-claims"[^]*?<\/section>/)?.[0]).toContain("Shoutout");

    const viewerBRequest = req("https://example.com/streamer/activity", { viewer: { id: "v2", kick_username: "viewer2" } });
    const viewerBResponse = await renderSiteRoute({ request: viewerBRequest, env, ctx, nonce: "b", slug: "streamer", section: "me", isCustomDomain: false });
    const viewerBHtml = await viewerBResponse.text();
    expect(viewerBResponse.headers.get("cache-control")).toContain("private");
    expect(viewerBResponse.headers.get("cache-control")).toContain("no-store");
    expect(viewerBResponse.headers.get("vary")).toContain("Cookie");
    expect(viewerBHtml).not.toContain("Claimed a code drop");
    const viewerBClaims = viewerBHtml.match(/<section[^>]*id="membership-claims"[^]*?<\/section>/)?.[0];
    expect(viewerBClaims).toBeDefined();
    expect(viewerBClaims).not.toContain("Shoutout");
    expect(viewerBHtml).not.toContain('class="viewer-claim-preview"');
    expect(viewerBHtml).toContain("No participation history yet");
    expect(viewerBHtml).toContain("No claims yet");
  });

  it("leaderboard renders inside the shared site shell", async () => {
    const res = await renderSiteRoute({ request: req("https://example.com/streamer/leaderboard"), env, ctx, nonce: "n", slug: "streamer", section: "leaderboard", isCustomDomain: false });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Alice");
    expect(html).toContain('class="viewer-rail"');
    expect(html).toContain('class="viewer-main"');
    expect(html).not.toContain('class="yr-drawer"');
    expect(html).toContain("Leaderboard");
  });
});

// ── Show Leaderboard toggle: public section visibility ─────────────────

describe("Show Leaderboard visibility", () => {
  it("redirects /{slug}/leaderboard to home instead of exposing standings when disabled", async () => {
    const res = await renderSiteRoute({ request: req("https://example.com/nolb/leaderboard"), env, ctx, nonce: "n", slug: "nolb", section: "leaderboard", isCustomDomain: false });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/nolb");
    expect(await res.text()).not.toContain("Alice");
  });

  it("redirects a custom-domain /leaderboard to / when disabled", async () => {
    const res = await renderSiteRoute({ request: req("https://nolb.example/leaderboard"), env, ctx, nonce: "n", slug: "nolb", section: "leaderboard", isCustomDomain: true });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  it("drops Leaderboard from navigation and the Home preview block when disabled", async () => {
    const res = await renderSiteRoute({ request: req("https://example.com/nolb"), env, ctx, nonce: "n", slug: "nolb", section: "home", isCustomDomain: false });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain(">Leaderboard</a>");
    expect(html).not.toContain('href="/nolb/leaderboard"');
    expect(html).not.toContain("viewer-home-board");
    expect(html).toContain(">Home</a>");
    expect(html).toContain(">Rewards</a>");
  });

  it("keeps Rewards and My Activity routes working when the leaderboard is disabled", async () => {
    const shop = await renderSiteRoute({ request: req("https://example.com/nolb/shop"), env, ctx, nonce: "n", slug: "nolb", section: "shop", isCustomDomain: false });
    expect(shop.status).toBe(200);
    expect(await shop.text()).toContain("Shoutout");
    const me = await renderSiteRoute({ request: req("https://example.com/nolb/activity"), env, ctx, nonce: "n", slug: "nolb", section: "me", isCustomDomain: false });
    expect(me.status).toBe(200);
  });

  it("serves the leaderboard again with its stored standings when re-enabled", async () => {
    // "streamer" is the same fixture with the toggle on: players come back
    // from the stored rows, proving the OFF state never touched the data.
    const res = await renderSiteRoute({ request: req("https://example.com/streamer/leaderboard"), env, ctx, nonce: "n", slug: "streamer", section: "leaderboard", isCustomDomain: false });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
    expect(html).toContain(">Leaderboard</a>");
  });
});

// ── Main / Loyalty boards inside the one Leaderboard route ─────────────

describe("Main / Loyalty public boards", () => {
  const lb = (slug, search = "", isCustomDomain = false) =>
    renderSiteRoute({ request: req(`https://${isCustomDomain ? `${slug}.example` : "example.com"}${isCustomDomain ? "" : `/${slug}`}/leaderboard${search}`), env, ctx, nonce: "n", slug, section: "leaderboard", isCustomDomain });

  it("keeps Main as the default with no switcher when Loyalty is off", async () => {
    const res = await lb("streamer");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Alice");
    expect(html).not.toContain("viewer-board-tabs");
    expect(html).not.toContain("Credits earned");
    expect(routeSiteData.calls.some((c) => c.loyaltySiteId)).toBe(false);
  });

  it("renders the Main/Loyalty switcher only when both boards are available", async () => {
    const html = await (await lb("loyal")).text();
    expect(html).toContain('<nav class="viewer-board-tabs" aria-label="Leaderboards">');
    expect(html).toContain('href="/loyal/leaderboard" data-board="main" aria-current="page">Main</a>');
    expect(html).toContain('href="/loyal/leaderboard?board=loyalty" data-board="loyalty">Loyalty</a>');
    // Main content, Main metric.
    expect(html).toContain("Alice");
    expect(html).not.toContain("Viewer A");
    expect(html).not.toContain("Credits earned");
  });

  it("serves the shareable ?board=loyalty link with lifetime credits earned, isolated to this site", async () => {
    routeSiteData.calls.length = 0;
    const res = await lb("loyal", "?board=loyalty");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(routeSiteData.calls.filter((c) => c.loyaltySiteId).map((c) => c.loyaltySiteId)).toEqual(["site-1"]);
    expect(html).toContain('data-board="loyalty" aria-current="page">Loyalty</a>');
    expect(html).toContain("Credits earned");
    expect(html).toContain('data-value-label="Credits earned"');
    expect(html).toContain("Viewer A");
    expect(html).toContain("Viewer B");
    expect(html.indexOf("Viewer A")).toBeLessThan(html.indexOf("Viewer B"));
    expect(html).toContain('src="https://cdn.example/a.png"');
    // Loyalty viewers are memberships, never Main players.
    expect(html).not.toContain("Alice");
    expect(html).not.toContain("Bob");
  });

  it("treats ?board=main and unknown values as Main", async () => {
    for (const search of ["?board=main", "?board=nonsense"]) {
      const html = await (await lb("loyal", search)).text();
      expect(html).toContain("Alice");
      expect(html).not.toContain("Credits earned");
    }
  });

  it("redirects a direct Loyalty URL back to Main once the creator turns Loyalty off", async () => {
    const res = await lb("streamer", "?board=loyalty");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/streamer/leaderboard");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const custom = await lb("streamer", "?board=loyalty", true);
    expect(custom.status).toBe(302);
    expect(custom.headers.get("location")).toBe("/leaderboard");
  });

  it("hides both boards when the master Show Leaderboard switch is off", async () => {
    const main = await lb("nolb-loyal");
    expect(main.status).toBe(302);
    expect(main.headers.get("location")).toBe("/nolb-loyal");
    const loyalty = await lb("nolb-loyal", "?board=loyalty");
    expect(loyalty.status).toBe(302);
    expect(loyalty.headers.get("location")).toBe("/nolb-loyal");
    expect(await loyalty.text()).not.toContain("Viewer A");
  });

  it("keeps the public sidebar unchanged on the Loyalty board", async () => {
    const html = await (await lb("loyal", "?board=loyalty")).text();
    const rail = html.slice(html.indexOf('class="viewer-rail"'), html.indexOf('class="viewer-main"'));
    expect(rail).not.toContain("Loyalty");
    expect((rail.match(/href="\/loyal\/leaderboard"/g) || []).length).toBe(1);
  });
});

describe("developer docs routing", () => {
  it("sends /docs/api and /openapi.json to the Worker API handler, not marketing", async () => {
    const seen = [];
    const apiApp = {
      fetch: async (request) => {
        seen.push(new URL(request.url).pathname);
        return new Response("api", { status: 200 });
      },
    };
    const marketing = { fetch: async () => new Response("marketing", { status: 200 }) };

    for (const path of ["/docs/api", "/openapi.json"]) {
      const response = await handleRequest(
        req(`https://yourrank.site${path}`),
        { MARKETING: marketing },
        ctx,
        {},
        { resolveCustomDomain: async () => null, apiApp },
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("api");
    }
    expect(seen).toEqual(["/docs/api", "/openapi.json"]);
  });

  it("still proxies /docs to marketing", async () => {
    const apiApp = {
      fetch: async () => { throw new Error("api router must not see /docs"); },
    };
    const marketing = { fetch: async () => new Response("marketing", { status: 200 }) };
    const response = await handleRequest(
      req("https://yourrank.site/docs"),
      { MARKETING: marketing },
      ctx,
      {},
      { resolveCustomDomain: async () => null, apiApp },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("marketing");
  });
});
