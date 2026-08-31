// The viewer product has three explicit scopes: a creator's Rewards page, that
// creator's My Community membership, and the global My communities account.
// The global surface links to the creator-branded owner instead of duplicating
// its Rewards, credits and Claims product.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderSite } from "@yourrank/shared/site-render";
import { viewerDashboardPage } from "../pages/viewer-dashboard.js";

const appCss = readFileSync(new URL("../assets/app.css", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../assets/site-shell.css", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../assets/viewer-dashboard.js", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../assets/site-shell.js", import.meta.url), "utf8");

const LONG_NAME = "R".repeat(100);
const LONG_DETAIL = "Reason ".repeat(30).trim();

const record = {
  slug: "demo-board",
  plan: "pro",
  viewerKickAuthEnabled: true,
  data: {
    brand: { name: "A Creator With A Very Long Channel Name Indeed", tagline: "Tag" },
    prizes: {},
    players: [{ name: "Alex", wagered: 100, prize: 25 }],
    socials: [],
    siteSections: { home: true, leaderboard: true, shop: true, me: true },
  },
};

const opts = { slug: record.slug, homeUrl: "https://test.com", nonce: "nonce" };

const items = [
  { id: "cheap", name: "Creator sticker pack", description: "A set of chat stickers.", cost: 10, stock: null },
  { id: "mid", name: LONG_NAME, description: "😀 Ünicode description", cost: 50, stock: 2 },
  { id: "dear", name: "Profile shoutout", description: "A shoutout on stream.", cost: 500, stock: null },
  { id: "gone", name: "Wallpaper pack", description: "", cost: 500, stock: 0 },
];

function shop({ viewer = { kick_username: "member" }, balance = 50, blocked = false } = {}) {
  return renderSite({
    r: record,
    section: "shop",
    viewer,
    viewerData: {
      viewerOnSite: { balance, blocked, block_reason: blocked ? "Paused." : null },
      shopItems: items,
      redemptions: [
        { id: "o1", item_name: LONG_NAME, cost: 50, status: "pending", created_at: "2024-02-01T00:00:00Z" },
        { id: "o2", item_name: "Wallpaper pack", cost: 500, status: "refunded", created_at: "2024-01-01T00:00:00Z" },
      ],
    },
    opts,
  });
}

function credits({ balance = 1234567 } = {}) {
  return renderSite({
    r: record,
    section: "me",
    viewer: { kick_username: "member" },
    viewerData: {
      viewerOnSite: { balance, blocked: false },
      shopItems: items,
      ledger: [
        { id: 1, amount: 100, type: "earn", created_at: "2024-02-02T00:00:00Z", description: LONG_DETAIL },
        { id: 2, amount: -50, type: "spend", created_at: "2024-02-01T00:00:00Z", description: LONG_NAME },
        { id: 3, amount: 25, type: "adjust", created_at: "2024-01-30T00:00:00Z" },
      ],
      redemptions: [
        { id: "o1", item_name: "Profile shoutout", cost: 50, status: "pending", created_at: "2024-02-01T00:00:00Z" },
        { id: "o2", item_name: "Chat badge", cost: 10, status: "fulfilled", created_at: "2024-01-20T00:00:00Z" },
        { id: "o3", item_name: "Sticker pack", cost: 10, status: "cancelled", created_at: "2024-01-10T00:00:00Z" },
        { id: "o4", item_name: "Wallpaper pack", cost: 500, status: "refunded", created_at: "2024-01-05T00:00:00Z" },
      ],
    },
    opts,
  });
}

function signedOut(section) {
  return renderSite({
    r: record,
    section,
    viewer: null,
    viewerData: null,
    opts,
  });
}

function zeroCredits() {
  return renderSite({
    r: record,
    section: "me",
    viewer: { kick_username: "member" },
    viewerData: {
      viewerOnSite: { balance: 0, blocked: false },
      shopItems: [],
      ledger: [],
      redemptions: [],
    },
    opts,
  });
}

/* ── a creator's Rewards page ─────────────────────────────────────── */

describe("a creator's Rewards page", () => {
  it("uses the header as the only sign-in owner in the empty signed-out state", async () => {
    const html = await signedOut("shop");
    expect((html.match(/\/api\/viewer\/auth\/kick/g) || []).length).toBe(1);
    expect(html).not.toContain('class="yr-vhead-aside"');
    expect(html).toContain("Sign in from the header to use your credits.");
    expect(html).toContain('<p class="yr-empty-t">No rewards yet</p>');
  });

  it("is a plain list of rewards with one action each, not a shop", async () => {
    const html = await shop();
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    expect(html).toContain('<ul class="yr-rwds" role="list">');
    // One action per reward row, and only the affordable in-stock ones can be claimed.
    expect((html.match(/<li class="yr-rwd">/g) || []).length).toBe(items.length);
    expect((html.match(/class="yr-act/g) || []).length).toBe(items.length);
    expect((html.match(/data-redeem="/g) || []).length).toBe(2);
    // No commerce apparatus and no pressure: those patterns do not belong on a
    // page that spends free loyalty points.
    for (const banned of ["Add to cart", "Wishlist", "Buy now", "quantity", "Limited time", "Hurry", "Bundle"]) {
      expect(html).not.toContain(banned);
    }
    expect(html).toContain("Credits are free loyalty points earned from channel-point rewards. No purchase, no cash value, no cashout.");
  });

  it("says in words why a reward cannot be claimed", async () => {
    const html = await shop();
    expect(html).toContain('<span class="yr-act yr-act--off" role="note">Not enough credits</span>');
    expect(html).toContain('<p class="yr-rwd-state">450 more needed</p>');
    // Each unavailable state is named once, by the control the viewer reaches for.
    expect((html.match(/Out of stock/g) || []).length).toBe(1);
    expect(html).toContain("2 left");
    expect(html).toContain(">Claim</button>");
  });

  it("offers sign-in instead of a dead Claim button to a signed-out viewer", async () => {
    const html = await shop({ viewer: null });
    expect(html).toContain("Sign in to claim");
    expect(html).not.toContain("data-redeem=");
    expect(html).not.toContain("yr-order-confirm");
  });

  it("states a site-wide claiming block once and disables claiming", async () => {
    const html = await shop({ blocked: true });
    expect(html).toContain("Claiming is currently unavailable for this membership.");
    expect(html).not.toContain("Paused.");
    expect(html).toContain("Claiming disabled on this site");
    expect(html).not.toContain("data-redeem=");
  });

  it("confirms a claim in the viewer's own dialog, not the browser's", async () => {
    const html = await shop();
    expect(html).toContain('<dialog class="yr-modal" id="yr-order-confirm"');
    expect(html).toContain('aria-labelledby="yr-order-confirm-t"');
    expect(html).toContain('aria-describedby="yr-order-confirm-d"');
    expect(html).toContain("Credits have no cash value.");
    expect(html).toContain("data-order-cancel");
    expect(html).toContain("data-order-confirm");
    expect(shellSource).not.toContain("window.confirm");
    // Cancel and Escape resolve the same promise, and neither reaches the API.
    expect(shellSource).toContain("confirmDialog.showModal()");
    expect(shellSource).toContain('confirmDialog.addEventListener("close"');
    expect(shellSource).toContain('aria-busy');
    expect(shellSource).toContain("idempotencyKey");
  });

  it("opens the confirmation on Cancel so a stray Enter cannot spend credits", () => {
    expect(shellSource).toContain("confirmCancel.focus()");
    const open = shellSource.indexOf("confirmDialog.showModal()");
    expect(shellSource.slice(open, open + 260)).toContain("confirmCancel.focus()");
  });

  it("hands focus to the claim status once the button is spent, never to the document", async () => {
    // One helper owns focus-without-scroll for both the standings pager and
    // claiming, so a submitted claim cannot drop focus onto a disabled button.
    expect((shellSource.match(/function focusWithoutScroll/g) || []).length).toBe(1);
    expect(shellSource).toContain("focusWithoutScroll(redeemStatus || btn)");
    expect(shellSource).not.toContain("btn.focus({ preventScroll: true })");
    expect(await shop()).toContain('id="yr-redeem-status" role="status" aria-live="polite" tabindex="-1"');
  });

  it("keeps a long reward name, unicode and emoji intact and unclipped by JS", async () => {
    const html = await shop();
    expect(html).toContain(LONG_NAME);
    expect(html).toContain("😀 Ünicode description");
    expect(html).not.toContain("…</h3>");
  });
});

describe("the creator home credit state", () => {
  it("keeps a zero-reward signed-out introduction whole without promoting the empty destination", async () => {
    const html = await signedOut("home");
    expect((html.match(/\/api\/viewer\/auth\/kick/g) || []).length).toBe(1);
    expect(html).toContain('class="yr-home-top yr-home-top--solo"');
    expect(html).not.toContain("yr-vnote");
    expect(html).toContain("No rewards yet");
    expect(html).not.toContain(">View rewards</a>");
  });

  it("keeps signed-in zero credits quiet when there are no rewards to browse", async () => {
    const html = await renderSite({
      r: record,
      section: "home",
      viewer: { kick_username: "member" },
      viewerData: { viewerOnSite: { balance: 0, blocked: false }, shopItems: [] },
      opts,
    });
    expect(html).toContain('class="yr-vnote is-zero"');
    expect(html).toContain("No rewards yet");
    expect(html).not.toContain(">View rewards</a>");
    expect(html).not.toContain(">Spend credits</a>");
  });

  it("exposes the Rewards action when active rewards actually exist", async () => {
    const populated = { ...record, data: { ...record.data, shopItems: items } };
    const signedOutHtml = await renderSite({ r: populated, section: "home", viewer: null, viewerData: null, opts });
    const signedInHtml = await renderSite({
      r: populated,
      section: "home",
      viewer: { kick_username: "member" },
      viewerData: { viewerOnSite: { balance: 0, blocked: false }, shopItems: items },
      opts,
    });
    expect(signedOutHtml).toContain(">View rewards</a>");
    expect(signedInHtml).toContain(">View rewards</a>");
    expect(signedOutHtml).toContain("Creator sticker pack");
  });
});

/* ── a creator's My Community page ───────────────────────────────── */

describe("a creator's My Community page", () => {
  it("explains the signed-out state without repeating the header sign-in action", async () => {
    const html = await signedOut("me");
    expect((html.match(/\/api\/viewer\/auth\/kick/g) || []).length).toBe(2);
    expect(html).toContain('class="yr-vhead-aside"');
    expect(html).toContain("Join community</a>");
    expect(html).toContain("intent=join");
    expect(html).toContain("site=demo-board");
    expect(html).toContain('<section class="yr-vsec yr-vsec--narrow yr-credit-guide">');
    expect(html).toContain('<h2 class="yr-sec-title">After you sign in</h2>');
    expect(html).toContain("Community membership");
    expect(html).toContain("Rewards and credits");
    expect(html).toContain(">Claims<");
    expect(html).not.toContain("yr-kpi");
  });

  it("keeps a signed-in zero balance and empty activity compact", async () => {
    const html = await zeroCredits();
    expect(html).toContain('class="yr-vbal is-zero"');
    expect(html).toContain('class="yr-vcols yr-vcols--empty"');
    expect((html.match(/class="yr-empty /g) || []).length).toBe(2);
  });

  it("does not invent a zero-balance membership when persistence is unavailable", async () => {
    const html = await renderSite({
      r: record,
      section: "me",
      viewer: { kick_username: "member" },
      viewerData: { membershipStatus: "unavailable", viewerOnSite: null, shopItems: [], ledger: [], redemptions: [] },
      opts,
    });
    expect(html).toContain("We couldn't load your community membership right now.");
    expect(html).not.toContain('class="yr-vbal');
    expect(html).not.toContain("No credit activity yet");
  });

  it("renders a real signed-in non-member Join state without a fake zero membership", async () => {
    const html = await renderSite({
      r: record,
      section: "me",
      viewer: { kick_username: "member" },
      viewerData: { membershipStatus: "absent", viewerOnSite: null, shopItems: [], ledger: [], redemptions: [] },
      opts,
    });
    expect(html).toContain("Signed in as <b>member</b>.");
    expect(html).toContain("You haven&#39;t joined this community yet.");
    expect(html).toContain('data-membership-join');
    expect(html).toContain("Membership connects this Viewer Account");
    expect(html).not.toContain("We couldn&#39;t load your community membership");
    expect(html).not.toContain('class="yr-vbal');
    expect(html).not.toContain("Member since");
  });

  it("shows and then clears controlled creator-scoped sign-in errors", async () => {
    const html = await renderSite({
      r: record,
      section: "me",
      viewer: null,
      viewerData: null,
      opts: { ...opts, viewerAuthError: "untrusted-provider-detail" },
    });
    expect(html).toContain("We couldn&#39;t complete sign-in. Try again.");
    expect(html).not.toContain("untrusted-provider-detail");
    expect(shellSource).toContain('authUrl.searchParams.delete("error")');
    expect(shellSource).toContain("window.history.replaceState");
  });

  it("shows the balance, activity and claims without a stat dashboard", async () => {
    const html = await credits();
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    expect(html).toContain("1,234,567");
    expect(html).toContain("Your membership in");
    expect(html).not.toContain("Member since");
    expect(html).not.toContain("yr-gamer");
    expect(html).not.toContain("Credits / 7d");
    expect(html).not.toContain("Lifetime");
    expect(html).not.toContain("yr-kpi");
  });

  it("signs credit movements in text, not by colour alone", async () => {
    const html = await credits();
    expect(html).toContain("+100");
    expect(html).toContain("−50");
    expect(html).toContain("Credits earned");
    expect(html).toContain("Adjustment by the streamer");
    expect(html).toContain(LONG_DETAIL);
  });

  it("names every claim source state the backend can report, and explains them once", async () => {
    const html = await credits();
    for (const label of ["Pending", "Completed", "Cancelled", "Refunded"]) {
      expect(html).toContain(`>${label}</span>`);
    }
    expect((html.match(/Pending means the creator/g) || []).length).toBe(1);
    // Backend truth only: no invented delivery date or fulfilment estimate.
    expect(html).not.toContain("Arrives");
    expect(html).not.toContain("Estimated");
  });
});

/* ── row geometry, shared by both surfaces ────────────────────────── */

describe("viewer row geometry", () => {
  it("lets the title keep a readable measure instead of stacking at one width", () => {
    expect(shellCss).toContain(".yr-rwd-main, .yr-hist-main, .yr-ord-main { flex: 1 1 24ch; min-width: 0; }");
    expect(appCss).toContain(".vd-card-main{flex:1 1 22ch;min-width:0}");
    // The 360px stacking workaround is gone: wrapping is the root behaviour.
    expect(appCss).not.toContain("@media (max-width:360px)");
    expect(appCss).toContain(".vd-card-side{flex:0 1 auto;min-width:0;margin-left:auto;display:flex;flex-wrap:wrap");
  });
});

/* ── the global account page ──────────────────────────────────────── */

describe("the global account page", () => {
  it("keeps restricted legacy mechanics out of the viewer membership journey", () => {
    expect(viewerDashboardPage).not.toContain("vd-raffles");
    expect(viewerDashboardPage).not.toContain("vd-predictions");
  });

  const page = String(viewerDashboardPage);

  it("opens with My communities, not an operator dashboard head", () => {
    expect(page).toContain('<h1 class="vd-h1" id="vd-title">My communities</h1>');
    expect((page.match(/<h1\b/g) || []).length).toBe(1);
    expect(page).not.toContain("an-eyebrow");
    expect(page).not.toContain("an-title");
    expect(page).toContain("One Viewer Account for every creator community you join.");
  });

  it("keeps one identity row and one community membership list", () => {
    expect(page).toContain('<main class="wrap cr-wrap vd-account-shell"');
    expect(page).toContain('id="vd-avatar"');
    expect(page).toContain('id="vd-avatar-fallback"');
    expect(page).toContain('id="vd-username"');
    expect(page).toContain('id="vd-identity"');
    expect(page).toContain('id="vd-logout"');
    expect(page).toContain('class="vd-profile-actions"');
    expect(page).toContain(">Community memberships<");
    expect(page).toContain('id="vd-communities"');
    expect(page).not.toContain('id="vd-site-card"');
    expect(page).not.toContain('id="vd-back"');
    expect(clientSource).toContain('class="vd-site-mark"');
  });

  it("links to the canonical creator membership without a client router", () => {
    expect(clientSource).toContain('const href = `/${encodeURIComponent(community.slug)}/me`');
    expect(clientSource).not.toContain('"popstate"');
    expect(clientSource).not.toContain("pushState");
    expect(clientSource).not.toContain("/api/viewer/site");
    for (const banned of ["react", "vue", "page.js", "navigo"]) {
      expect(clientSource.toLowerCase()).not.toContain(`import ${banned}`);
    }
  });

  it("shows only compact membership status, not expanded Claims history", () => {
    expect(clientSource).toContain("pendingClaims");
    expect(clientSource).toContain("Claiming unavailable");
    expect(clientSource).not.toContain("redemptions");
    expect(clientSource).not.toContain("ORDER_STATUS");
    expect(clientSource).not.toContain("/api/viewer/claims");
  });

  it("groups large credit numbers so a balance stays readable", () => {
    expect(clientSource).toContain('function fmtNum(value) { return Number(value || 0).toLocaleString("en-US"); }');
    expect(clientSource).toContain("${fmtNum(community.balance)} free credits");
  });
});
