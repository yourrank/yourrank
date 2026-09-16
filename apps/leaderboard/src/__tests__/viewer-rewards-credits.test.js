// The viewer product has three explicit scopes: a creator's Rewards page, that
// creator's My Community membership, and the global My communities account.
// The global surface links to the creator-branded owner instead of duplicating
// its Rewards, credits and Claims product.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderSite } from "@yourrank/shared/site-render";
import { viewerAccountPage } from "../pages/viewer-account.js";

const appCss = readFileSync(new URL("../assets/viewer-shell.css", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../assets/site-shell.css", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../assets/viewer-account.js", import.meta.url), "utf8");
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
  { id: "pin", name: "Pinned message", description: "Pin a message in chat.", cost: 20, stock: null },
];

function shop({ viewer = { kick_username: "member" }, balance = 50, blocked = false } = {}) {
  return renderSite({
    r: record,
    section: "shop",
    viewer,
    viewerData: {
      viewerOnSite: { balance, blocked, block_reason: blocked ? "Paused." : null },
      shopItems: items,
      claims: [
        { id: "redemption:o1", reward: { name: LONG_NAME, cost: 50 }, status: "submitted", statusLabel: "Needs fulfillment", submittedAt: "2024-02-01T00:00:00Z", completedAt: null, cancelledAt: null },
        { id: "redemption:o2", reward: { name: "Wallpaper pack", cost: 500 }, status: "cancelled", statusLabel: "Cancelled", submittedAt: "2024-01-01T00:00:00Z", completedAt: null, cancelledAt: "2024-01-02T00:00:00Z" },
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
      participation: [
        { type: "code_drop_claim", title: "Claimed a code drop", status: "claimed", statusLabel: "Claimed", participatedAt: "2024-02-03T00:00:00Z" },
      ],
      participationLimit: 25,
      participationTruncated: false,
      claims: [
        { id: "redemption:o1", reward: { name: "Profile shoutout", cost: 50 }, status: "submitted", statusLabel: "Needs fulfillment", submittedAt: "2024-02-01T00:00:00Z", completedAt: null, cancelledAt: null },
        { id: "redemption:o2", reward: { name: "Chat badge", cost: 10 }, status: "completed", statusLabel: "Completed", submittedAt: "2024-01-20T00:00:00Z", completedAt: "2024-01-21T00:00:00Z", cancelledAt: null },
        { id: "redemption:o3", reward: { name: "Sticker pack", cost: 10 }, status: "cancelled", statusLabel: "Cancelled", submittedAt: "2024-01-10T00:00:00Z", completedAt: null, cancelledAt: "2024-01-11T00:00:00Z" },
      ],
      claimsLimit: 50,
      claimsTruncated: false,
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
      participation: [],
      claims: [],
    },
    opts,
  });
}

/* ── a creator's Rewards page ─────────────────────────────────────── */

describe("a creator's Rewards page", () => {
  it("keeps sign-in out of the empty reward list in the signed-out state", async () => {
    const html = await signedOut("shop");
    // The topbar chip and the Join community CTA are the only auth entries.
    expect((html.match(/\/api\/viewer\/auth\/kick/g) || []).length).toBe(2);
    expect(html).toContain('class="viewer-signin"');
    expect(html).not.toContain('class="yr-vhead-aside"');
    expect(html).toContain("Sign in to use your community credits.");
    expect(html).toContain('<p class="yr-empty-t">No rewards yet</p>');
  });

  it("is a plain list of rewards with one action each, not a shop", async () => {
    const html = await shop();
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    // The first four rewards are featured cards; the rest continue as list rows.
    expect(html).toContain('data-reward-featured');
    expect((html.match(/viewer-reward-card/g) || []).length).toBe(4);
    expect(html).toContain('<ul class="yr-rwds" role="list">');
    expect((html.match(/<li class="yr-rwd">/g) || []).length).toBe(items.length - 4);
    // One action per reward, and only the affordable in-stock ones can be claimed.
    expect((html.match(/data-redeem="/g) || []).length).toBe(3);
    expect((html.match(/yr-act yr-act--off/g) || []).length).toBe(2);
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
    expect(html).toContain('<span class="viewer-reward-state">450 more needed</span>');
    // Each unavailable state is named once, by the control the viewer reaches for.
    expect((html.match(/Out of stock/g) || []).length).toBe(1);
    expect(html).toContain("2 left");
    expect((html.match(/>Redeem<\/button>/g) || []).length).toBe(3);
    expect(html).toContain(">Claim</button>"); // dialog confirm

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
  it("keeps an empty shop discoverable alongside the signed-out guide", async () => {
    const html = await signedOut("home");
    expect(html).toContain('class="viewer-signin"');
    expect(html).toContain('class="viewer-hero"');
    expect(html).not.toContain("yr-vnote");
    expect(html).toContain("No rewards yet");
    expect(html).toContain("All rewards</a>");
  });

  it("shows a truthful zero balance and empty reward preview", async () => {
    const html = await renderSite({
      r: record,
      section: "home",
      viewer: { kick_username: "member" },
      viewerData: { viewerOnSite: { balance: 0, blocked: false }, shopItems: [] },
      opts,
    });
    expect(html).toContain('data-credit-balance="0"');
    expect(html).toContain("No rewards are available right now.");
    expect(html).toContain("All rewards</a>");
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
    expect(signedOutHtml).toContain("Sign in to see your reward progress.");
    expect(signedInHtml).toContain(">Browse rewards</a>");
    expect(signedOutHtml).toContain("Creator sticker pack");
  });
});

/* ── a creator's My Community page ───────────────────────────────── */

describe("a creator's My Community page", () => {
  it("explains the signed-out state without repeating the header sign-in action", async () => {
    const html = await signedOut("me");
    expect((html.match(/\/api\/viewer\/auth\/kick/g) || []).length).toBe(2);
    expect(html).toContain('class="viewer-card viewer-gate"');
    expect(html).toContain("Join community</a>");
    expect(html).toContain("intent=join");
    expect(html).toContain("site=demo-board");
    expect(html).toContain("follow your reward claims");
    expect(html).toContain("Your credits stay with this community.");
    expect(html).toContain("Back to my communities");
    expect(html).not.toContain("data-code-drop-claim");
    expect(html).not.toContain("yr-kpi");
  });

  it("restores free code-drop claiming to the creator-branded membership surface", async () => {
    const memberHtml = await credits();
    const nonMemberHtml = await renderSite({
      r: record,
      section: "me",
      viewer: { kick_username: "member" },
      viewerData: { membershipStatus: "absent", viewerOnSite: null, shopItems: [], ledger: [], claims: [], participation: [] },
      opts,
    });

    for (const html of [memberHtml, nonMemberHtml]) {
      expect(html).toContain('data-code-drop-claim');
      expect(html).toContain('data-site-slug="demo-board"');
      expect(html).toContain('id="yr-code-drop-code"');
      expect(html).toContain('id="yr-code-drop-status" role="status" aria-live="polite" tabindex="-1"');
      expect(html).toContain("Redeem code");
      const claimSection = html.match(/<section class="viewer-card yr-code-drop"[\s\S]*?<\/section>/)?.[0] || "";
      expect(claimSection).toContain("data-code-drop-claim");
      expect(claimSection).not.toMatch(/raffle|prediction|wager|stake|odds|payout|settlement/i);
    }

    expect(nonMemberHtml).toContain("A successful claim joins this community");
    expect(shellSource).toContain('fetch("/api/events/drops/claim"');
    expect(shellSource).toContain("codeDropForm.addEventListener(\"submit\"");
    expect(shellSource).toContain("window.location.reload()");
  });

  it("keeps a signed-in zero balance and empty activity compact", async () => {
    const html = await zeroCredits();
    expect(html).toContain('data-credit-balance="0"');
    expect(html).toContain('class="viewer-stat-grid"');
    expect(html.indexOf('viewer-activity-card')).toBeLessThan(html.indexOf('id="membership-claims"'));
    expect((html.match(/class="member-empty"/g) || []).length).toBe(1);
    expect(html).toContain("No credit activity yet");
  });

  it("does not invent a zero-balance membership when persistence is unavailable", async () => {
    const html = await renderSite({
      r: record,
      section: "me",
      viewer: { kick_username: "member" },
      viewerData: { membershipStatus: "unavailable", viewerOnSite: null, shopItems: [], ledger: [], claims: [], participation: [] },
      opts,
    });
    expect(html).toContain("Your membership couldn't load");
    expect(html).not.toContain('class="yr-vbal');
    expect(html).not.toContain("No credit activity yet");
  });

  it("renders a real signed-in non-member Join state without a fake zero membership", async () => {
    const html = await renderSite({
      r: record,
      section: "me",
      viewer: { kick_username: "member" },
      viewerData: { membershipStatus: "absent", viewerOnSite: null, shopItems: [], ledger: [], claims: [], participation: [] },
      opts,
    });
    expect(html).toContain("Signed in as <b>member</b>");
    expect(html).toContain("You haven't joined this community yet.");
    expect(html).toContain('data-membership-join');
    expect(html).toContain("Join to keep your rewards, free credits and claims together here.");
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
    expect(html).toContain('class="viewer-stat-grid"');
    expect(html).toContain("Credits balance");
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

  it("shows safe Participation as a bounded reverse-chronological membership record", async () => {
    const html = await credits();
    expect(html).toContain('class="viewer-card viewer-participation"');
    expect(html).toContain("Claimed a code drop");
    expect(html).toContain(">Claimed</span>");
    expect(html).toContain("Feb 3, 2024");
    const participationHtml = html.match(/<section class="viewer-card viewer-participation"[\s\S]*?<\/section>/)?.[0] || "";
    expect(participationHtml).toContain("Claimed a code drop");
    for (const banned of ["raffle", "prediction", "wager", "streak", "scorecard"]) {
      expect(participationHtml.toLowerCase()).not.toContain(banned);
    }
  });

  it("uses canonical Claim states and audit-backed terminal timestamps", async () => {
    const html = await credits();
    for (const label of ["Needs fulfillment", "Completed", "Cancelled"]) {
      expect(html).toContain(`>${label}</span>`);
    }
    expect((html.match(/Needs fulfillment means the creator/g) || []).length).toBe(1);
    expect(html).toContain("Completed Jan 21, 2024");
    expect(html).toContain("Cancelled Jan 11, 2024");
    // Backend truth only: no invented delivery date or fulfilment estimate.
    expect(html).not.toContain("Arrives");
    expect(html).not.toContain("Estimated");
    expect(html).not.toContain("updated_at");
  });

  it("does not introduce Recognition without a proven linked source", async () => {
    const html = await credits();
    expect(html).not.toContain(">Recognition<");
    expect(html).not.toContain("yr-recognition");
  });

  it("names a blocked Membership generically without exposing creator-only reasons", async () => {
    const html = await renderSite({
      r: record,
      section: "me",
      viewer: { kick_username: "member" },
      viewerData: {
        viewerOnSite: { balance: 25, blocked: true, block_reason: "internal fraud investigation" },
        ledger: [],
        participation: [],
        claims: [],
      },
      opts,
    });
    expect(html).toContain("Claiming is currently unavailable for this membership.");
    expect(html).not.toContain("data-code-drop-claim");
    expect(html).not.toMatch(/fraud|investigation/i);
  });
});

/* ── row geometry, shared by both surfaces ────────────────────────── */

describe("viewer row geometry", () => {
  it("lets the title keep a readable measure instead of stacking at one width", () => {
    expect(shellCss).toContain(".yr-rwd-main, .yr-hist-main, .yr-ord-main, .yr-part-main { flex: 1 1 24ch; min-width: 0; }");
    // Account community rows keep the name column flexible with ellipsis.
    expect(appCss).toContain(".va-community-main { flex: 1; min-width: 0;");
    expect(appCss).toContain("text-overflow: ellipsis");
    expect(appCss).not.toContain("vd-card");
  });
});

/* ── the global account page ──────────────────────────────────────── */

describe("the global account page", () => {
  it("keeps restricted legacy mechanics out of the viewer membership journey", () => {
    for (const page of ["communities", "profile", "connections", "notifications", "security", "data"]) {
      const html = viewerAccountPage(page, { nonce: "n", csrfToken: "t" });
      expect(html).not.toContain("vd-raffles");
      expect(html).not.toContain("vd-predictions");
    }
  });

  const page = String(viewerAccountPage("communities", { nonce: "n", csrfToken: "t" }));

  it("opens with My communities, not an operator dashboard head", () => {
    expect(page).toContain('<h1 class="viewer-h1">My communities</h1>');
    expect((page.match(/<h1\b/g) || []).length).toBe(1);
    expect(page).not.toContain("an-eyebrow");
    expect(page).not.toContain("an-title");
  });

  it("keeps one identity chip and one community membership list", () => {
    expect(page).toContain('class="viewer-rail viewer-rail--account"');
    expect(page).toContain('data-viewer-shell="account"');
    expect(page).toContain('data-va-list="communities"');
    expect(page).toContain('data-va-empty="communities"');
    expect(page).toContain("You haven't joined any communities yet.");
    expect(page).toContain("Your communities");
    expect(page).not.toContain('id="vd-communities"');
    expect(clientSource).toContain('class="va-community-mark"');
  });

  it("links to the canonical creator membership without a client router", () => {
    expect(clientSource).toContain("encodeURIComponent(slug)");
    expect(clientSource).toContain('">View site</a>');
    expect(clientSource).not.toContain('"popstate"');
    expect(clientSource).not.toContain("pushState");
    expect(clientSource).not.toContain("/api/viewer/site");
    for (const banned of ["react", "vue", "page.js", "navigo"]) {
      expect(clientSource.toLowerCase()).not.toContain(`import ${banned}`);
    }
  });

  it("shows only compact membership status, not expanded Claims history", () => {
    expect(clientSource).toContain("pendingClaims");
    expect(clientSource).toContain("claiming paused");
    expect(clientSource).not.toContain("redemptions");
    expect(clientSource).not.toContain("ORDER_STATUS");
    expect(clientSource).not.toContain("/api/viewer/claims");
  });

  it("groups large credit numbers so a balance stays readable", () => {
    expect(clientSource).toContain('var fmt = function (n) { return Number(n || 0).toLocaleString("en-US"); }');
    expect(clientSource).toContain("fmt(c.balance)");
  });
});
