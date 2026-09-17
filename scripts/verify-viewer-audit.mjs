// Browser regressions against the actual renderer, preview handler and assets.
// Fixtures replace persistence only. Requires Playwright and a Chromium binary.
// Optional PLAYWRIGHT_MODULE_PATH and CHROMIUM_EXECUTABLE select local runtimes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { renderSite } from '../packages/shared/dist/site-render.js';
import { handleDashboardPreview } from '../apps/leaderboard/src/handlers/preview.js';
import { ASSETS } from '../apps/leaderboard/src/assets_bundled.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const players = Array.from({ length: 300 }, (_, i) => ({ name: i === 299 ? 'Remote player' : `Player${i + 1}`, rank: i + 1, score: 1000 - i }));
const eventId = '11111111-1111-4111-8111-111111111111';
const data = {
  brand: { name: 'Northstar', tagline: 'Community points' },
  branding: { template: 'spotlight' },
  rankBy: 'score',
  players,
  siteSections: { home: true, leaderboard: true, shop: true, me: true },
  // Fixed, deliberately out-of-order values make the two viewer reward sort
  // modes observable without any persistence or current-time dependency.
  shopItems: [
    { id: 'alpha', name: 'Alpha reward', description: 'Alphabetical first, costlier.', cost: 300, active: true },
    { id: 'bravo', name: 'Bravo reward', description: 'Alphabetical second, cheapest.', cost: 100, active: true },
  ],
  eventBoards: [{ id: eventId, name: 'Community event' }],
};
const output = process.env.YR_003_SCREENSHOT_DIR || '.local-logs/viewer-audit';
let origin;
let releasePage;
let holdPage = false;
let pageStarted;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/assets/') && ASSETS[url.pathname]) {
      res.setHeader('content-type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
      res.end(ASSETS[url.pathname][0]); return;
    }
    if (url.pathname === '/api/public/creator/players') {
      const q = url.searchParams.get('search') || '';
      const offset = Number(url.searchParams.get('offset'));
      if (holdPage && !q) { pageStarted?.(); await new Promise(resolve => { releasePage = resolve; }); }
      const matches = players.filter(p => p.name.toLowerCase().includes(q));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ players: matches.slice(offset, offset + 100), total: matches.length, hasMore: offset + 100 < matches.length })); return;
    }
    if (url.pathname === '/preview') {
      const response = await handleDashboardPreview(new Request(`${origin}/dashboard/preview?board=site-a&device=desktop&section=${url.searchParams.get('section') || 'home'}`), {}, 'n', {
        currentUserImpl: async () => ({ id: 'owner', plan: 'pro', plan_expires_at: Date.now() + 86400000 }),
        getUserSiteByIdImpl: async () => ({ id: 'site-a', slug: 'creator', data }),
      });
      res.setHeader('content-type', 'text/html'); res.end(await response.text()); return;
    }
    if (url.pathname === '/parent') {
      res.setHeader('content-type', 'text/html');
      res.end('<iframe src="/preview" style="width:1200px;height:900px"></iframe><script>window.edits=[];addEventListener("message",e=>{if(e.data?.type==="yr_edit_request")edits.push(e.data)})</script>'); return;
    }
    const count = Number(url.searchParams.get('count') || 100);
    const section = url.pathname.split('/')[2] || 'leaderboard';
    res.setHeader('content-type', 'text/html');
    res.end(await renderSite({
      r: { slug: 'creator', plan: 'pro', viewerKickAuthEnabled: true, data: { ...data, players: players.slice(0, count), playerCount: count === 100 ? 300 : count } },
      section,
      viewer: { kick_username: 'fixture-viewer' },
      viewerData: { viewerOnSite: { balance: 1000, blocked: false }, shopItems: data.shopItems, claims: [], ledger: [], participation: [] },
      opts: { slug: 'creator', homeUrl: origin, nonce: 'n' },
    }));
  } catch (error) {
    console.error('verify-viewer-audit server error:', error);
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Internal Server Error');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  // Force the deterministic, accessible copy fallback rather than allowing a
  // host clipboard/share implementation to obscure its visible status text.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/creator/leaderboard`);
  // The production consent banner is part of the rendered page. Dismiss it as
  // a visitor would so it cannot intercept the controls this fixture verifies.
  const consentReject = page.locator("#cookieReject");
  if (await consentReject.count()) {
    await consentReject.click();
    await page.waitForFunction(() => !document.querySelector(".yr-consent"));
  }
  // Keyboard activation of the actual public skip link must move focus to the
  // canonical main landmark, not merely update the URL fragment.
  const skipLink = page.locator('a.yr-sr[href="#main-content"]');
  await skipLink.focus();
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('a.yr-sr[href="#main-content"]')), true);
  await skipLink.press("Enter");
  await page.waitForFunction(() => document.activeElement === document.getElementById("main-content"));

  const rows = page.locator('[data-rows] [data-player-name]');
  const more = page.locator('[data-load-more]');
  const search = page.locator('#yr-search');

  // Share fallback must tell a keyboard/screen-reader user the exact URL when
  // neither native share nor clipboard support is available.
  const share = page.locator("[data-share-copy]").first();
  const shareUrl = await share.getAttribute("data-share-url");
  await share.click();
  assert.equal(await page.locator("[data-share-status]").first().innerText(), `Copy this link: ${shareUrl}`);

  // The community selector returns focus to its actual summary on Escape.
  const selector = page.locator(".viewer-switch");
  const selectorSummary = selector.locator("summary");
  await selectorSummary.click();
  assert.equal(await selector.evaluate((element) => element.open), true);
  await page.keyboard.press("Escape");
  assert.equal(await selector.evaluate((element) => element.open), false);
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector(".viewer-switch summary")), true);

  // The feedback dialog receives focus, then returns it to the control that
  // opened it after close — both are observable browser behavior.
  const feedbackOpen = page.locator("[data-feedback-open]").first();
  await feedbackOpen.click();
  await page.waitForFunction(() => document.activeElement === document.querySelector('#yr-feedback textarea[name="message"]'));
  await page.locator("#yr-feedback-close").click();
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector("[data-feedback-open]")), true);

  // The remote player is outside the first server-rendered page. This makes
  // trim/case normalization, the fallback request, and the polite result
  // announcement all observable against the production asset.
  await search.fill('  REMOTE PLAYER  ');
  await page.waitForFunction(() => document.querySelector('[data-rows]').textContent.includes('Remote player'));
  assert.equal(await page.locator('#yr-search-status').innerText(), '1 player match “remote player”.');
  await search.fill('');
  await page.waitForFunction(() => document.querySelectorAll('[data-rows] [data-player-name]').length === 100);
  await more.click();
  await page.waitForFunction(() => document.querySelectorAll('[data-rows] [data-player-name]').length === 200);
  await search.fill('Remote');
  await page.waitForFunction(() => document.querySelector('[data-rows]').textContent.includes('Remote player'));
  await search.fill('');
  assert.equal(await rows.count(), 200);
  await more.click();
  await page.waitForFunction(() => document.querySelectorAll('[data-rows] [data-player-name]').length === 300);
  assert.equal(await page.locator('[data-player-name="player101"]').count(), 1);
  await search.fill('Player1'); await search.fill('');
  assert.equal(await rows.count(), 300);

  await page.goto(`${origin}/creator/leaderboard`);
  holdPage = true;
  const started = new Promise(resolve => { pageStarted = resolve; });
  await more.click(); await started;
  await search.fill('Player1'); await search.fill('');
  holdPage = false; releasePage();
  await page.waitForLoadState('networkidle');
  assert.equal(await rows.count(), 100);
  assert.equal(await more.isEnabled(), true);
  assert.equal(await more.textContent(), 'Load more players');

  await page.goto(`${origin}/creator/shop`);
  const rewardOrder = () => page.locator('#viewer-rewards > li').evaluateAll((nodes) => nodes.map((node) => node.dataset.rewardFilter));
  const rewardSort = page.locator('#viewer-reward-sort');
  await rewardSort.selectOption('name');
  assert.deepEqual(await rewardOrder(), ['alpha reward', 'bravo reward']);
  await rewardSort.selectOption('cost');
  assert.deepEqual(await rewardOrder(), ['bravo reward', 'alpha reward']);

  await mkdir(output, { recursive: true });
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const count of [1, 2, 3]) {
      await page.goto(`${origin}/creator/leaderboard?count=${count}`);
      assert.equal(await page.locator('[data-podium]').count(), count === 3 ? 1 : 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const title = await page.locator('h1').boundingBox();
      const switcher = await page.locator('.viewer-board-switcher').boundingBox();
      assert.ok(title.y + title.height <= switcher.y);
      await page.screenshot({ path: `${output}/board-${count}-${width}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/parent`);
  const frame = page.frameLocator('iframe');
  const name = frame.locator('[data-preview-field="f_name"]');
  await name.click(); await name.fill('Changed creator'); await name.press('Enter');
  await page.waitForFunction(() => window.edits.length === 1);
  const tagline = frame.locator('[data-preview-field="f_tagline"]');
  await tagline.click(); await tagline.fill('Changed tagline'); await tagline.press('Enter');
  await page.waitForFunction(() => window.edits.length === 2);
  assert.deepEqual(await page.evaluate(() => edits.map(({ key, value }) => ({ key, value }))), [{ key: 'f_name', value: 'Changed creator' }, { key: 'f_tagline', value: 'Changed tagline' }]);
  await name.click(); await name.fill('Cancelled'); await name.press('Escape');
  assert.equal(await name.textContent(), 'Changed creator');
  assert.equal(await page.evaluate(() => edits.length), 2);
  await name.click(); await name.fill('Second edit'); await name.press('Enter');
  await name.click(); await name.fill('Third edit'); await tagline.click();
  await page.waitForFunction(() => window.edits.length === 4);
  assert.deepEqual(await page.evaluate(() => edits.slice(2).map(e => e.value)), ['Second edit', 'Third edit']);
  await page.goto(`${origin}/preview?section=leaderboard`);
  await page.locator('h1').click();
  assert.equal(await page.locator('h1').getAttribute('contenteditable'), null);
  assert.deepEqual(errors, []);
  console.log(`PASSED: skip-to-main keyboard navigation, exact share fallback, selector Escape/focus return, feedback dialog focus/return, search trim/case and polite result announcement, both reward sort modes, pagination/search/clear/races, 1–3-player layouts and deterministic screenshots at 320/390/768/1024/1440, title hierarchy, preview edit/cancel and no page errors. Screenshots: ${output}`);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
