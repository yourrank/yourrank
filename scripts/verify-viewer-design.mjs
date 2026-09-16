// Exercise the production viewer renderer and browser assets with isolated fixtures.
// This does not verify OAuth providers, a deployed Worker, or database persistence.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { renderSite } from '../packages/shared/dist/site-render.js';
import { viewerDashboardPage } from '../apps/leaderboard/src/pages/viewer-dashboard.js';
import { execFileSync } from 'node:child_process';

// The help renderer imports repository JSX. Render those fixtures with Bun;
// Chromium automation runs in Node, including on Windows.
const helpPages = JSON.parse(execFileSync('bun', ['-e', `
import { helpSupportPage, helpHubPage } from './apps/leaderboard/src/pages/help.js';
import { leaderboardPageHtml } from './packages/shared/dist/page-shell.js';
const options = { viewerHelp: { returnTo: '/nova' } };
console.log(JSON.stringify([helpHubPage, helpSupportPage].map(page => leaderboardPageHtml({ ...page.configFor(options), content: page.Component(options) }))));
`], { encoding: 'utf8', timeout: 30000 }));

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
const documents = [];
let balance = 1250;
let codeClaimed = false;
let accountName = 'Alex';
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
      res.end(JSON.stringify({ viewer: { displayName: accountName, connections: [{ provider: 'kick', username: accountName }] }, communities: [{ slug: 'nova', name: "Nova's community", balance, pendingClaims: claims.length, claimingAvailable: true }, { slug: 'luna', name: 'Luna Lounge', balance: 480, pendingClaims: 0, claimingAvailable: true }] })); return;
    }
    if (url.pathname === '/api/giveaways/chatroom') {
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ isLive: true, chatroomId: 123 })); return;
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
        if (body.code !== 'NOVA100') { res.writeHead(404).end(JSON.stringify({ error: 'Invalid or expired drop code.' })); return; }
        if (codeClaimed) { res.writeHead(400).end(JSON.stringify({ error: 'You have already claimed this drop code!' })); return; }
        codeClaimed = true;
        balance += 100; res.end(JSON.stringify({ ok: true, pointsAwarded: 100, newBalance: balance })); return;
      }
      res.end(JSON.stringify({ ok: true })); return;
    }
    if (url.pathname.startsWith('/api/')) { res.setHeader('content-type', 'application/json'); res.end('{}'); return; }
    documents.push(url.pathname + url.search);
    res.setHeader('content-type', 'text/html');
    if (url.pathname === '/me') { res.end(viewerDashboardPage); return; }
    if (url.pathname.startsWith('/help')) {
      res.end(helpPages[url.pathname === '/help' ? 0 : 1]); return;
    }
    if (url.pathname === '/missing') { res.writeHead(404).end('Not found'); return; }
    const slug = url.pathname.split('/')[1] || 'nova';
    const section = url.pathname.split('/')[2] || 'home';
    const signedOut = url.searchParams.has('signedout');
    const empty = url.searchParams.has('empty');
    const unavailable = url.searchParams.has('unavailable');
    const data = { brand: { name: slug === 'luna' ? 'Luna Lounge' : "Nova's community" }, socials: [{ name: 'Kick', url: 'https://kick.com/nova' }], branding: { template: url.searchParams.get('template') || 'cyber_arcade' }, rankBy: 'score', players: empty ? [] : players, siteSections: { home: true, leaderboard: true, shop: true, me: true }, shopItems: empty ? [] : rewards };
    res.end(await renderSite({ r: { slug, plan: 'pro', data, viewerKickAuthEnabled: true }, section, viewer: signedOut ? null : viewer, viewerData: { membershipStatus: unavailable ? 'unavailable' : signedOut ? 'absent' : 'member', viewerOnSite: signedOut || unavailable ? null : { balance: slug === 'luna' ? 480 : balance, blocked: url.searchParams.has('blocked') }, shopItems: data.shopItems, claims: empty ? [] : claims, ledger: empty ? [] : [{ type: 'code_drop', amount: 100, created_at: '2026-09-12T12:00:00Z' }], participation: [] }, opts: { slug, homeUrl: origin, nonce: 'n', csrfToken: 'fixture-csrf' } }));
  } catch (error) { console.error(error); res.writeHead(500).end('Fixture server failed'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = process.env.CDP_ENDPOINT ? await chromium.connectOverCDP(process.env.CDP_ENDPOINT) : await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.context().addCookies([{ name: '__csrf', value: 'fixture-csrf', url: origin }]);
  // Visual inspection is batched before the behavioral checks.
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/nova', '/nova/shop', '/nova/me', '/nova/leaderboard', '/me', '/me#vd-profile', '/me#vd-connections', '/me#vd-notifications', '/me#vd-security', '/me#vd-data']) {
      await page.goto(origin + path); await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.__yrViewerAppReady);
      if (await page.locator('#cookieReject').isVisible()) await page.locator('#cookieReject').click();
      assert.equal(await page.locator('h1').count(), 1, `${path}: one page heading`);
      assert.equal(await page.locator('main').count(), 1, `${path}: one content landmark`);
      assert.equal(await page.locator('main .viewer-rail').count(), 0, `${path}: navigation outside content`);
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
  await page.evaluate(() => window.__yrViewerAppReady);
  await page.evaluate(() => { window.shellIdentity = { rail: document.querySelector('.viewer-rail'), top: document.querySelector('.viewer-topbar'), selector: document.querySelector('.viewer-switch') }; });
  assert.equal(await page.locator('[data-viewer-guide],[data-guide-restore]').count(), 0);
  assert.match(await page.locator('.viewer-nav-unavailable').innerText(), /Activities.*Not available yet/s);
  assert.equal(await page.locator('.viewer-nav-unavailable a').count(), 0);
  await page.locator('.viewer-switch summary').click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('.viewer-switch').getAttribute('open'), null);
  await page.locator('.viewer-destinations a[href="/nova/shop"]').click();
  await page.waitForSelector('[data-redeem="shoutout"]');
  assert.equal(await page.evaluate(() => window.shellIdentity.rail === document.querySelector('.viewer-rail') && window.shellIdentity.top === document.querySelector('.viewer-topbar')), true, 'Shell containers stay mounted');
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
  await page.locator('#yr-code-drop-code').fill('CODE_-719');
  assert.equal(await page.locator('#yr-code-drop-code').evaluate(input => input.checkValidity()), true);
  await page.locator('#yr-code-drop-code').fill('INVALID!');
  assert.equal(await page.locator('#yr-code-drop-code').evaluate(input => input.checkValidity()), false);
  await page.locator('#yr-code-drop-code').fill('WRONG');
  await page.locator('[data-code-drop-submit]').click();
  await page.waitForFunction(() => document.querySelector('#yr-code-drop-status').textContent.length > 0);
  assert.match(await page.locator('#yr-code-drop-status').innerText(), /invalid or no longer active/);
  assert.equal(balance, 1000);
  await page.locator('#yr-code-drop-code').fill('NOVA100');
  await page.locator('[data-code-drop-submit]').click();
  await page.waitForURL('**/nova/me');
  await page.waitForFunction(() => document.querySelector('.viewer-credit-amount').dataset.creditBalance === '1100');
  await page.locator('#yr-code-drop-code').fill('NOVA100');
  await page.locator('[data-code-drop-submit]').click();
  await page.waitForFunction(() => /already claimed/.test(document.querySelector('#yr-code-drop-status').textContent));
  assert.equal(balance, 1100);
  await page.locator('.viewer-destinations a[href="/nova"]').click();
  await page.waitForSelector('.viewer-next-reward progress');
  assert.match(await page.locator('.viewer-next-reward').innerText(), /900 more Credits needed/);
  await page.locator('#viewer-communities-link').click();
  await page.waitForSelector('.vd-card-row');
  assert.equal(await page.evaluate(() => window.shellIdentity.rail === document.querySelector('.viewer-rail')), true);
  assert.equal(await page.locator('.viewer-switch').count(), 0);
  assert.equal(await page.locator('.viewer-destinations a').count(), 5);
  assert.equal(await page.locator('.viewer-topbar [data-credit-balance]').count(), 0);
  await page.goBack(); await page.waitForSelector('.viewer-next-reward');
  await page.goForward(); await page.waitForSelector('.vd-card-row');
  await page.locator('.viewer-sidebar-bottom a').click();
  await page.waitForURL(url => url.pathname === '/help/support');
  try {
    await page.waitForSelector('#contactForm', { timeout: 5000 });
  } catch (error) {
    throw new Error(`Viewer help did not mount at ${page.url()}: ${await page.locator('.viewer-main').innerText()} | status=${await page.locator('.viewer-navigation-status').innerText()} | pageErrors=${errors.join('; ')}`, { cause: error });
  }
  assert.equal(await page.evaluate(() => window.shellIdentity.rail === document.querySelector('.viewer-rail')), true);
  await page.locator('.viewer-help > .yr-sec-link').click();
  await page.waitForSelector('.viewer-next-reward');
  await page.evaluate(() => window.YRViewerApp.navigate('/missing'));
  assert.match(await page.locator('.viewer-navigation-status').innerText(), /could not load/);
  assert.equal(new URL(page.url()).pathname, '/nova');
  await page.goto(origin + '/luna');
  assert.match(await page.locator('.viewer-credit-amount').innerText(), /480/);
  await page.goto(origin + '/me'); await page.evaluate(() => window.__yrViewerAppReady);
  assert.equal(await page.locator('#vd-profile').isVisible(), false);
  await page.locator('#viewer-account-link').click();
  await page.waitForSelector('#vd-profile', { state: 'visible' });
  assert.equal(await page.locator('#vd-profile').isVisible(), true);
  assert.equal(await page.locator('#vd-communities-card').isVisible(), false);
  assert.equal(await page.locator('#viewer-account-link').getAttribute('aria-current'), 'page');
  await page.locator('a[href="#main-content"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(new URL(page.url()).hash, '#vd-profile', 'Skip link preserves the selected setting');
  assert.equal(await page.locator('#vd-profile').isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content');
  await page.locator('#viewer-communities-link').click();
  await page.evaluate(() => window.__yrViewerReady);
  await page.locator('.vd-card-side a[href="/nova"]').click();
  assert.match(await page.locator('.viewer-context-name').innerText(), /Nova/);
  for (const state of ['signedout', 'empty', 'unavailable', 'blocked']) {
    await page.goto(`${origin}/nova/me?${state}`);
    await page.evaluate(() => window.__yrViewerAppReady);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (state === 'signedout') assert.equal(await page.locator('[data-code-drop-claim]').count(), 0);
    if (state === 'unavailable') {
      assert.match(await page.locator('.viewer-main').innerText(), /couldn't load/);
      const reload = page.locator('.member-actions a:has-text("Reload membership")');
      const target = new URL(await reload.getAttribute('href'), page.url());
      const requestedPath = target.pathname + target.search;
      const requestCount = documents.filter(path => path === requestedPath).length;
      await reload.click();
      await page.waitForSelector('[data-code-drop-claim]');
      assert.equal(documents.filter(path => path === requestedPath).length, requestCount + 1, 'Reload membership fetches a fresh document');
    }
    if (state === 'blocked') {
      assert.equal(await page.locator('a:has-text("Browse rewards")').count(), 0);
      assert.equal(await page.locator('[data-code-drop-claim]').count(), 0);
    }
  }
  const current = new URL(page.url());
  const requestedPath = current.pathname + current.search;
  const requestCount = documents.filter(path => path === requestedPath).length;
  await page.evaluate(() => window.YRViewerApp.navigate(location.href));
  assert.equal(documents.filter(path => path === requestedPath).length, requestCount + 1, 'Same-URL navigation retries the document');
  accountName = 'LongConnectedViewerIdentity'.repeat(6);
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto(origin + '/me#vd-profile');
  await page.evaluate(() => window.__yrViewerAppReady);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Long account identity wraps on mobile');
  accountName = 'Alex';
  let releaseAccount;
  let accountStarted;
  const started = new Promise(resolve => { accountStarted = resolve; });
  const release = new Promise(resolve => { releaseAccount = resolve; });
  await page.route('**/api/viewer/me', async route => {
    accountStarted();
    await release;
    await route.continue().catch(() => {});
  });
  await page.goto(origin + '/me#vd-profile', { waitUntil: 'domcontentloaded' });
  await started;
  await page.locator('.viewer-sidebar-bottom a').click();
  await page.waitForSelector('#contactForm');
  releaseAccount();
  await page.unrouteAll({ behavior: 'wait' });
  assert.equal(new URL(page.url()).pathname, '/help/support', 'Account reads do not prevent navigation');
  assert.deepEqual(errors, []);
  console.log('PASSED: desktop/mobile community and account pages, persistent shell through account/help routes and Back/Forward, account/community separation, failed navigation recovery, rewards and codes with CSRF/idempotency, repeat-code protection and signed-out/empty/unavailable/blocked states; no page errors.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
