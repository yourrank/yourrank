// Exercise the production viewer renderer and browser assets with isolated fixtures.
// This does not verify OAuth providers, a deployed Worker, or database persistence.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { renderSite } from '../packages/shared/dist/site-render.js';
import { viewerDashboardPage } from '../apps/leaderboard/src/pages/viewer-dashboard.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const output = '.local-logs/viewer-design';
await mkdir(output, { recursive: true });
const viewer = { id: 'fixture-viewer', kick_username: 'Alex' };
const rewards = [
  { id: 'shoutout', name: 'Community shout-out', description: 'A little recognition on the next stream.', cost: 250, active: true },
  { id: 'topic', name: 'Suggest a stream topic', description: 'Share an idea for a future community stream.', cost: 500, active: true },
  { id: 'emote', name: 'Choose a community emote', description: 'Help choose the next community expression.', cost: 2000, active: true },
];
const claims = [{ id: 'fixture-claim', reward: rewards[1], status: 'submitted', statusLabel: 'Needs fulfillment', submittedAt: '2026-09-12T12:00:00Z' }];
const players = ['Milo', 'Stella', 'Cloudwalker'].map((name, i) => ({ name, rank: i + 1, score: 9500 - i * 1200 }));
const mutations = [];
let balance = 1250;
let origin;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/reference' && process.env.VIEWER_DESIGN_REFERENCE) {
      res.setHeader('content-type', 'text/html'); res.end(await readFile(process.env.VIEWER_DESIGN_REFERENCE)); return;
    }
    if (url.pathname.startsWith('/assets/')) {
      if (!/^\/assets\/[a-z0-9-]+\.(css|js)$/.test(url.pathname)) { res.writeHead(404).end(); return; }
      res.setHeader('content-type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
      res.end(await readFile(new URL(`../apps/leaderboard/src${url.pathname}`, import.meta.url))); return;
    }
    if (url.pathname === '/api/viewer/me') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ viewer: { displayName: 'Alex', connections: [{ provider: 'kick', username: 'alexontheotherside' }] }, communities: [{ slug: 'nova', name: "Nova's community", balance, pendingClaims: claims.length, claimingAvailable: true }, { slug: 'luna', name: 'Luna Lounge', balance: 480, pendingClaims: 0, claimingAvailable: true }] })); return;
    }
    if (url.pathname === '/api/viewer/redeem' || url.pathname === '/api/events/drops/claim' || url.pathname === '/api/viewer/logout') {
      let raw = ''; for await (const part of req) raw += part;
      const body = raw ? JSON.parse(raw) : {};
      mutations.push({ path: url.pathname, body, csrf: req.headers['x-csrf-token'] });
      res.setHeader('content-type', 'application/json');
      if (url.pathname.endsWith('/redeem')) {
        const reward = rewards.find(reward => reward.id === body.shopItemId);
        if (!reward || reward.cost > balance) { res.writeHead(400).end(JSON.stringify({ error: 'insufficient balance' })); return; }
        balance -= reward.cost;
        claims.unshift({ id: 'fixture-new-claim', reward, status: 'submitted', statusLabel: 'Needs fulfillment', submittedAt: new Date().toISOString() });
        res.end(JSON.stringify({ ok: true, balance })); return;
      }
      if (url.pathname.endsWith('/claim')) {
        if (body.code !== 'NOVA100') { res.writeHead(400).end(JSON.stringify({ error: 'Invalid code' })); return; }
        balance += 100; res.end(JSON.stringify({ ok: true, points: 100, balance })); return;
      }
      res.end(JSON.stringify({ ok: true })); return;
    }
    if (url.pathname.startsWith('/api/')) { res.setHeader('content-type', 'application/json'); res.end('{}'); return; }
    res.setHeader('content-type', 'text/html');
    if (url.pathname === '/me') { res.end(viewerDashboardPage); return; }
    const slug = url.pathname.split('/')[1] || 'nova';
    const section = url.pathname.split('/')[2] || 'home';
    const signedOut = url.searchParams.has('signedout');
    const empty = url.searchParams.has('empty');
    const unavailable = url.searchParams.has('unavailable');
    const data = { brand: { name: slug === 'luna' ? 'Luna Lounge' : "Nova's community" }, branding: { template: url.searchParams.get('template') || 'cyber_arcade' }, rankBy: 'score', players: empty ? [] : players, siteSections: { home: true, leaderboard: true, shop: true, me: true }, shopItems: empty ? [] : rewards };
    res.end(await renderSite({ r: { slug, plan: 'pro', data, viewerKickAuthEnabled: true }, section, viewer: signedOut ? null : viewer, viewerData: { membershipStatus: unavailable ? 'unavailable' : signedOut ? 'absent' : 'member', viewerOnSite: signedOut || unavailable ? null : { balance: slug === 'luna' ? 480 : balance }, shopItems: data.shopItems, claims: empty ? [] : claims, ledger: [], participation: [] }, opts: { slug, homeUrl: origin, nonce: 'n', csrfToken: 'fixture-csrf' } }));
  } catch (error) { console.error(error); res.writeHead(500).end('Fixture server failed'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.context().addCookies([{ name: '__csrf', value: 'fixture-csrf', url: origin }]);
  // Visual inspection is batched before the behavioral checks.
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/nova', '/nova/shop', '/nova/me', '/nova/leaderboard', '/me', '/me#vd-profile']) {
      await page.goto(origin + path); await page.evaluate(() => document.fonts.ready);
      if (path.startsWith('/me')) await page.evaluate(() => window.__yrViewerReady);
      if (await page.locator('#cookieReject').isVisible()) await page.locator('#cookieReject').click();
      assert.equal(await page.locator('h1').count(), 1, `${path}: one page heading`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${path} at ${width}: no horizontal overflow`);
      await page.screenshot({ path: `${output}/${path.slice(1).replace(/[\/#]/g, '-')}-${width}.png`, fullPage: true });
    }
    if (process.env.VIEWER_DESIGN_REFERENCE) {
      await page.goto(origin + '/reference'); await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${output}/reference-${width}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + '/nova');
  await page.locator('[data-guide-dismiss]').click();
  assert.equal(await page.locator('[data-viewer-guide]').isVisible(), false);
  await page.locator('[data-guide-restore]').click();
  assert.equal(await page.locator('[data-viewer-guide]').isVisible(), true);
  await page.locator('.viewer-switch summary').click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('.viewer-switch').getAttribute('open'), null);
  await page.locator('.viewer-destinations a[href="/nova/shop"]').click();
  await page.locator('[data-redeem="shoutout"]').click();
  assert.equal(await page.locator('#yr-order-confirm').isVisible(), true);
  await page.locator('[data-order-cancel]').click();
  assert.equal(mutations.length, 0, 'Cancelling confirmation sends no mutation');
  await page.locator('[data-redeem="shoutout"]').click();
  await page.locator('[data-order-confirm]').click();
  await page.waitForFunction(() => document.querySelector('.viewer-credit-amount').dataset.creditBalance === '1000');
  assert.equal(mutations[0].body.slug, 'nova');
  assert.ok(mutations[0].body.idempotencyKey);
  assert.equal(mutations[0].csrf, 'fixture-csrf');
  await page.locator('.viewer-destinations a[href="/nova/me"]').click();
  assert.match(await page.locator('#membership-claims').innerText(), /Community shout-out/);
  await page.locator('#yr-code-drop-code').fill('WRONG');
  await page.locator('[data-code-drop-submit]').click();
  await page.waitForFunction(() => document.querySelector('#yr-code-drop-status').textContent.length > 0);
  assert.equal(balance, 1000);
  await page.locator('#yr-code-drop-code').fill('NOVA100');
  await page.locator('[data-code-drop-submit]').click();
  await page.waitForURL('**/nova/me');
  await page.waitForFunction(() => document.querySelector('.viewer-credit-amount').dataset.creditBalance === '1100');
  await page.goto(origin + '/luna');
  assert.match(await page.locator('.viewer-credit-amount').innerText(), /480/);
  await page.goto(origin + '/me'); await page.evaluate(() => window.__yrViewerReady);
  assert.equal(await page.locator('#vd-profile').isVisible(), false);
  await page.locator('#viewer-account-link').click();
  assert.equal(await page.locator('#vd-profile').isVisible(), true);
  assert.equal(await page.locator('#vd-communities-card').isVisible(), false);
  assert.equal(await page.locator('#viewer-account-link').getAttribute('aria-current'), 'page');
  await page.locator('#viewer-communities-link').click();
  await page.evaluate(() => window.__yrViewerReady);
  await page.locator('.vd-card-side a[href="/nova"]').click();
  assert.match(await page.locator('.viewer-context-name').innerText(), /Nova/);
  for (const state of ['signedout', 'empty', 'unavailable']) {
    await page.goto(`${origin}/nova/me?${state}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (state === 'signedout') assert.equal(await page.locator('[data-code-drop-claim]').count(), 0);
    if (state === 'unavailable') assert.match(await page.locator('.viewer-main').innerText(), /couldn't load/);
  }
  assert.deepEqual(errors, []);
  console.log('PASSED: six viewer destinations at desktop/mobile, guide and keyboard menu, account navigation, reward confirm/cancel with CSRF and idempotency, code error/success, community isolation, signed-out/empty/unavailable states; no page errors.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
