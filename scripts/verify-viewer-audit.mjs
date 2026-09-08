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
const data = { brand: { name: 'Northstar', tagline: 'Community points' }, branding: { template: 'spotlight' }, rankBy: 'score', players, siteSections: { home: true, leaderboard: true, shop: true, me: true }, eventBoards: [{ id: eventId, name: 'Community event' }] };
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
    res.setHeader('content-type', 'text/html');
    res.end(await renderSite({ r: { slug: 'creator', plan: 'pro', data: { ...data, players: players.slice(0, count), playerCount: count === 100 ? 300 : count } }, section: 'leaderboard', opts: { slug: 'creator', homeUrl: origin, nonce: 'n' } }));
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/creator/leaderboard`);
  const rows = page.locator('[data-rows] [data-player-name]');
  const more = page.locator('[data-load-more]');
  const search = page.locator('#yr-search');
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

  await mkdir('.local-logs/viewer-audit', { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const count of [1, 2, 3]) {
      await page.goto(`${origin}/creator/leaderboard?count=${count}`);
      assert.equal(await page.locator('[data-podium]').count(), count === 3 ? 1 : 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const title = await page.locator('h1').boundingBox();
      const switcher = await page.locator('.viewer-board-switcher').boundingBox();
      assert.ok(title.y + title.height <= switcher.y);
      await page.screenshot({ path: `.local-logs/viewer-audit/board-${count}-${width}.png`, fullPage: true });
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
  console.log('PASSED: pagination/search/clear/races, 1–3-player desktop/mobile layouts, title hierarchy, preview edit/cancel and no page errors.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
