// Browser checks for the advisory reward publish-readiness review (YR-014) in
// the real Rewards → Shop editor. The in-process server replaces only auth and
// persistence; the served page, bundled client and CSS are the real ones.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { RewardsShopPage, rewardsShopConfig } from "../apps/leaderboard/src/pages/rewards.jsx";
import { ASSETS } from "../apps/leaderboard/src/assets_bundled.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
  : "playwright");

const fixtureUser = { id: "fixture-owner", email: "fixture-owner@example.test", display_name: "Fixture owner", plan: "pro", emailVerified: true, isAdmin: false };
const fixtureSite = { ok: true, slug: "fixture-site", siteId: "fixture-site-id", published: true, isDraft: false, boards: [], archives: [], onboarding: {}, data: { brand: { name: "Fixture site" }, players: [] } };

let contactReady = false;
const shopItems = [
  { id: "complete", name: "VIP role", description: "One month of VIP in chat. I grant it within 24 hours of your claim.", cost: 500, stock: null, active: true, cooldown_seconds: 0, has_image: false },
  { id: "blank", name: "Mystery box", description: "", cost: 200, stock: 3, active: true, cooldown_seconds: 0, has_image: false },
  { id: "copy", name: "Steam key", description: "One month of VIP in chat. I grant it within 24 hours of your claim.", cost: 900, stock: 1, active: true, cooldown_seconds: 0, has_image: false },
  { id: "hidden", name: "Draft prize", description: "", cost: 50, stock: null, active: false, cooldown_seconds: 0, has_image: false },
];
const saves = [];

function statusPayload() {
  return {
    ok: true, enabled: true,
    channel: { connected: true, name: "fixture", status: "healthy", statusLabel: "Connected", needsAttention: false, canManage: true },
    mappings: [], shopItems, viewers: [], redemptions: [],
    creatorContact: { ready: contactReady, editHref: "/dashboard/site#siteLinksCard" },
    usage: { rewardMappings: 0, shopItems: 3, pendingRedemptions: 0, redemptionsPer30Days: 0 },
    viewerAuth: { kick: true, discord: false, public: false },
    limits: { rewardMappings: 50, shopItems: 50, pendingRedemptions: 100, redemptionsPer30Days: 1000, activeViewersPer30Days: 1000 },
    capabilities: { manageRewards: true, manageClaims: true, adjustCredits: true, manageConnections: true },
  };
}

function shopDocument() {
  const content = RewardsShopPage({ user: fixtureUser }).toString();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="csrf-token" content="fixture-csrf">${rewardsShopConfig.styles.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body>${content}${rewardsShopConfig.scripts.join("")}</body></html>`;
}

let origin;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  if (url.pathname.startsWith("/assets/") && ASSETS[url.pathname]) {
    const [body] = ASSETS[url.pathname];
    res.setHeader("content-type", url.pathname.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8");
    res.end(body);
    return;
  }
  if (url.pathname === "/api/auth/me") return json(res, { ok: true, user: fixtureUser });
  if (url.pathname === "/api/site/list") return json(res, { ok: true, sites: [{ id: fixtureSite.siteId, slug: fixtureSite.slug, name: "Fixture site" }], activeSiteId: fixtureSite.siteId });
  if (url.pathname === "/api/site") return json(res, fixtureSite);
  if (url.pathname === "/api/credits/status") return json(res, statusPayload());
  if (url.pathname === "/api/credits/shop" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    saves.push(JSON.parse(raw));
    return json(res, { ok: true, id: "saved" });
  }
  if (url.pathname.startsWith("/dashboard")) return html(res, shopDocument());
  return json(res, { ok: true, items: [], data: {}, usage: {}, billing: {} });
});
function json(res, body) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); }
function html(res, body) { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(body); }

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error("pageerror:", error.message); });
  page.on("console", (message) => { if (message.type() === "error") { errors.push(message.text()); console.error("console:", message.text()); } });

  const findings = async () => page.locator("#cr-shop-review-list li").evaluateAll((items) => items.map((li) => li.dataset.reviewCode));
  const reviewVisible = async () => page.evaluate(() => !document.getElementById("cr-shop-review").hidden);

  await page.goto(`${origin}/dashboard/rewards/shop?siteId=fixture-site-id`);
  await page.locator("#cr-shop-list article").first().waitFor();

  // Already-published rewards: a non-destructive review path per row.
  const chips = await page.locator("#cr-shop-list article").evaluateAll((rows) => rows.map((row) => [row.querySelector(".cr-shop-row-title").textContent, Boolean(row.querySelector(".cr-shop-review-chip"))]));
  assert.deepEqual(chips, [["Steam key", true], ["VIP role", true], ["Mystery box", true], ["Draft prize", false]]);
  const chipLabel = await page.locator(".cr-shop-review-chip").first().getAttribute("aria-label");
  assert.match(chipLabel, /^Review .*: live with incomplete details$/);

  // Published reward whose copy another reward reuses: both sides are flagged; contact links to the Site editor.
  await page.locator('#cr-shop-list article:has(.cr-shop-row-title:text-is("VIP role")) .cr-shop-review-chip').click();
  await page.locator("#cr-shop-drawer:not([hidden])").waitFor();
  assert.equal(await page.locator("#cr-shop-name").inputValue(), "VIP role");
  assert.deepEqual(await findings(), ["description_duplicate", "contact_missing"]);
  assert.match(await page.locator('[data-review-code="description_duplicate"]').innerText(), /Same description as “Steam key”/);
  assert.equal(await page.locator("#cr-shop-review-list a.cr-shop-review-fix").getAttribute("href"), "/dashboard/site?board=fixture-site-id#siteLinksCard");
  assert.equal(await page.locator("#cr-shop-review-list a.cr-shop-review-fix").innerText(), "Add a contact channel");

  // Blank description: the finding names the field and its fix control focuses the textarea.
  await page.locator("#cr-shop-close").click();
  await page.locator('#cr-shop-list article:has(.cr-shop-row-title:text-is("Mystery box")) [data-edit-shop].btn').click();
  await page.locator("#cr-shop-drawer:not([hidden])").waitFor();
  assert.deepEqual(await findings(), ["description_missing", "contact_missing"]);
  assert.match(await page.locator('[data-review-code="description_missing"]').innerText(), /how and when you deliver it/);
  await page.locator('[data-review-focus="cr-shop-desc"]').click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "cr-shop-desc");

  // Duplicated copy: typing the other reward's description is flagged live and names it.
  await page.locator("#cr-shop-desc").fill("one month of vip in chat. i grant it within 24 hours of your claim.");
  assert.deepEqual(await findings(), ["description_duplicate", "contact_missing"]);
  assert.match(await page.locator('[data-review-code="description_duplicate"]').innerText(), /Same description as “VIP role”/);

  // Fixing the copy clears that finding without any save; hiding the item hides the review entirely.
  await page.locator("#cr-shop-desc").fill("A sealed mystery box mailed to you. I ask for your address by DM after the claim.");
  assert.deepEqual(await findings(), ["contact_missing"]);
  await page.locator("#cr-shop-active").uncheck();
  assert.equal(await reviewVisible(), false);
  await page.locator("#cr-shop-active").check();
  assert.equal(await reviewVisible(), true);

  // Advisory only: saving with findings still saves, payload unchanged in shape and untouched copy.
  await page.locator("#cr-shop-submit").click();
  await page.waitForFunction(() => document.getElementById("cr-shop-drawer").hidden);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].id, "blank");
  assert.equal(saves[0].description, "A sealed mystery box mailed to you. I ask for your address by DM after the claim.");
  assert.equal(saves[0].active, true);

  // Once the creator has a public channel and the reward is complete, no review is shown.
  contactReady = true;
  shopItems[2].description = "A random Steam key sent by DM within a day.";
  await page.reload();
  await page.locator("#cr-shop-list article").first().waitFor();
  await page.locator('#cr-shop-list article:has(.cr-shop-row-title:text-is("VIP role")) [data-edit-shop].btn').click();
  await page.locator("#cr-shop-drawer:not([hidden])").waitFor();
  assert.equal(await reviewVisible(), false);
  assert.equal(await page.locator('#cr-shop-list article:has(.cr-shop-row-title:text-is("VIP role")) .cr-shop-review-chip').count(), 0);
  assert.equal(await page.locator('#cr-shop-list article:has(.cr-shop-row-title:text-is("Steam key")) .cr-shop-review-chip').count(), 0);
  assert.equal(await page.locator('#cr-shop-list article:has(.cr-shop-row-title:text-is("Mystery box")) .cr-shop-review-chip').count(), 1);

  // Mobile: the drawer review stays within the viewport width.
  await page.locator("#cr-shop-close").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#cr-shop-list article:has(.cr-shop-row-title:text-is("Mystery box")) [data-edit-shop].btn').click();
  await page.locator("#cr-shop-drawer:not([hidden])").waitFor();
  await page.locator("#cr-shop-review:not([hidden])").waitFor();
  const box = await page.locator("#cr-shop-review").boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390, `review panel overflows at 390: ${JSON.stringify(box)}`);
  if (process.env.YR014_SHOT) { await page.locator("#cr-shop-review").scrollIntoViewIfNeeded(); await page.screenshot({ path: process.env.YR014_SHOT, fullPage: false }); }

  assert.deepEqual(errors, []);
  console.log("PASSED: complete / blank / duplicated / missing-contact / already-published rewards reviewed in the real shop editor; advisory save unchanged; contact link carries the board context.");
} finally {
  await browser?.close();
  server.close();
}
