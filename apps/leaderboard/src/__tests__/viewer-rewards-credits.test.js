// The viewer's three credit surfaces — a creator's Rewards page, a creator's My
// credits page and the global /me account — are consumer pages: a small list of
// things you can get with free loyalty points, your own balance and history, and
// your account across creators. They are not a shop, not a dashboard and not a
// gambling surface, and every one of those regressions is asserted here.
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

/* ── a creator's Rewards page ─────────────────────────────────────── */

describe("a creator's Rewards page", () => {
  it("is a plain list of rewards with one action each, not a shop", async () => {
    const html = await shop();
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    expect(html).toContain('<ul class="yr-rwds" role="list">');
    // One action per reward row, and only the affordable in-stock ones order.
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

  it("says in words why a reward cannot be ordered", async () => {
    const html = await shop();
    expect(html).toContain("Not enough credits — 450 more needed");
    expect(html).toContain("Out of stock");
    expect(html).toContain("2 left");
    expect(html).toContain(">Order</button>");
  });

  it("offers sign-in instead of a dead Order button to a signed-out viewer", async () => {
    const html = await shop({ viewer: null });
    expect(html).toContain("Sign in to order");
    expect(html).not.toContain("data-redeem=");
    expect(html).not.toContain("yr-order-confirm");
  });

  it("states a site-wide ordering block once and disables ordering", async () => {
    const html = await shop({ blocked: true });
    expect(html).toContain("Ordering is disabled on this site.");
    expect(html).toContain("Ordering disabled on this site");
    expect(html).not.toContain("data-redeem=");
  });

  it("confirms an order in the viewer's own dialog, not the browser's", async () => {
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

  it("hands focus to the order status once the button is spent, never to the document", async () => {
    // One helper owns focus-without-scroll for both the standings pager and
    // ordering, so a placed order cannot drop focus onto a disabled button.
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

/* ── a creator's My credits page ──────────────────────────────────── */

describe("a creator's My credits page", () => {
  it("shows the balance, activity and orders without a stat dashboard", async () => {
    const html = await credits();
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    expect(html).toContain("1,234,567");
    expect(html).toContain("Free loyalty credits on");
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

  it("names every order state the backend can report, and explains them once", async () => {
    const html = await credits();
    for (const label of ["Pending", "Fulfilled", "Cancelled", "Refunded"]) {
      expect(html).toContain(`>${label}</span>`);
    }
    expect((html.match(/Pending means the streamer/g) || []).length).toBe(1);
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
  const page = String(viewerDashboardPage);

  it("opens with the account, not an operator dashboard head", () => {
    expect(page).toContain('<h1 class="vd-h1" id="vd-title">Your account</h1>');
    expect((page.match(/<h1\b/g) || []).length).toBe(1);
    expect(page).not.toContain("an-eyebrow");
    expect(page).not.toContain("an-title");
    expect(page).toContain("no purchase, no cash value, no cashout");
  });

  it("keeps one identity row, your sites, and one creator detail", () => {
    expect(page).toContain('id="vd-avatar"');
    expect(page).toContain('id="vd-username"');
    expect(page).toContain('id="vd-identity"');
    expect(page).toContain('id="vd-logout"');
    expect(page).toContain(">Your sites<");
    expect(page).toContain('id="vd-back" type="button">Back to your sites<');
    expect(page).toContain('id="vd-site-visit"');
    expect(page).toContain('id="vd-site-balance"');
    expect(page).toContain("Cancelled and refunded both mean the credits went back to your balance.");
  });

  it("keeps ?site=<slug> history, with no hash route and no router library", () => {
    expect(clientSource).toContain("history[method]");
    expect(clientSource).toContain('"popstate"');
    expect(clientSource).not.toContain("location.hash =");
    expect(clientSource).not.toContain("/me/");
    for (const banned of ["react", "vue", "page.js", "navigo"]) {
      expect(clientSource.toLowerCase()).not.toContain(`import ${banned}`);
    }
  });

  it("names every order state and explains an unavailable Order in words", () => {
    for (const label of ["Pending", "Fulfilled", "Cancelled", "Refunded"]) {
      expect(clientSource).toContain(`"${label}"`);
    }
    expect(clientSource).toContain("Ordering disabled on this site");
    expect(clientSource).toContain("Out of stock");
    expect(clientSource).toContain("Not enough credits");
    expect(clientSource).toContain("Credits have no cash value.");
    expect(clientSource).toContain("free credits");
  });

  it("groups large credit numbers so a balance stays readable", () => {
    expect(clientSource).toContain('function fmtNum(n) { return Number(n || 0).toLocaleString("en-US"); }');
    expect(clientSource).toContain("${fmtNum(b.balance)} free credits");
    expect(clientSource).toContain('$("vd-site-balance").textContent = fmtNum(v.balance)');
    expect(clientSource).toContain("${fmtNum(i.cost)} credits");
    expect(clientSource).toContain("${fmtNum(r.cost)} credits");
  });
});
