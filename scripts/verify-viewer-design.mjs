// Exercise the production viewer renderer and browser assets with isolated fixtures.
// This does not verify OAuth providers, a deployed Worker, or database persistence.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { renderSite, siteSectionFromPath } from '../packages/shared/dist/site-render.js';
import { parseViewerIntent } from '../packages/shared/dist/viewer-intent.js';
import { viewerDashboardPage } from '../apps/leaderboard/src/pages/viewer-dashboard.js';
import { execFileSync } from 'node:child_process';

// The help renderer imports repository JSX. Render those fixtures with Bun;
// Chromium automation runs in Node, including on Windows.
const helpPages = JSON.parse(execFileSync('bun', ['-e', `
import { helpSupportPage, helpHubPage } from './apps/leaderboard/src/pages/help.js';
import { leaderboardPageHtml } from './packages/shared/dist/page-shell.js';
const options = { viewerHelp: { returnTo: '/nova', community: { slug: 'nova', name: "Nova's community", href: '/nova' } } };
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
    if (url.pathname === '/me') { res.end(viewerDashboardPage(url.searchParams.get('community') === 'nova' ? { slug: 'nova', name: "Nova's community", href: '/nova' } : null)); return; }
    if (url.pathname.startsWith('/help')) {
      res.end(helpPages[url.pathname === '/help' ? 0 : 1]); return;
    }
    if (url.pathname === '/missing') { res.writeHead(404).end('Not found'); return; }
    const slug = url.pathname.split('/')[1] || 'nova';
    const section = siteSectionFromPath(url.pathname.split('/')[2] || 'home');
    const rewardId = section === 'shop' ? url.pathname.split('/')[3] || '' : '';
    const signedOut = url.searchParams.has('signedout');
    const empty = url.searchParams.has('empty');
    const unavailable = url.searchParams.has('unavailable');
    const catalogSize = Number(url.searchParams.get('rewards')) || 0;
    const catalog = catalogSize ? Array.from({ length: catalogSize }, (_, i) => ({ ...rewards[i % rewards.length], id: `fixture-${i}`, cost: 250 + i * 150, name: i === 1 ? 'An unusually long reward name that wraps across several lines of the card heading' : rewards[i % rewards.length].name })) : rewards;
    const data = { brand: { name: slug === 'luna' ? 'Luna Lounge' : "Nova's community" }, socials: [{ name: 'Kick', url: 'https://kick.com/nova' }], branding: { template: url.searchParams.get('template') || 'cyber_arcade' }, rankBy: 'score', players: empty ? [] : players, siteSections: { home: true, leaderboard: true, shop: true, me: true }, shopItems: empty ? [] : catalog };
    const reward = rewardId ? (rewardId === 'withdrawn' ? { id: 'withdrawn', name: 'Retired hoodie', description: '', cost: 900, stock: null, active: false } : catalog.find(item => item.id === rewardId) || null) : null;
    if (rewardId && (!reward || reward.active === false)) res.statusCode = 404;
    res.end(await renderSite({ r: { slug, plan: 'pro', data, viewerKickAuthEnabled: true }, section, viewer: signedOut ? null : viewer, viewerData: { membershipStatus: unavailable ? 'unavailable' : signedOut ? 'absent' : 'member', viewerOnSite: signedOut || unavailable ? null : { balance: slug === 'luna' ? 480 : balance, blocked: url.searchParams.has('blocked') }, shopItems: data.shopItems, claims: empty ? [] : claims, ledger: empty ? [] : [{ type: 'code_drop', amount: 100, created_at: '2026-09-12T12:00:00Z' }], participation: [] }, opts: { slug, homeUrl: origin, nonce: 'n', csrfToken: 'fixture-csrf', rewardId, reward, viewerIntent: section === 'me' ? parseViewerIntent(url) : null } }));
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
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/nova', '/nova/shop', '/nova/activity', '/nova/leaderboard', '/me', '/me#vd-profile', '/me#vd-connections', '/me#vd-notifications', '/me#vd-security', '/me#vd-data']) {
      await page.goto(origin + path); await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.__yrViewerAppReady);
      if (await page.locator('#cookieReject').isVisible()) await page.locator('#cookieReject').click();
      assert.equal(await page.locator('h1').count(), 1, `${path}: one page heading`);
      assert.equal(await page.locator('main').count(), 1, `${path}: one content landmark`);
      assert.equal(await page.locator('main .viewer-rail').count(), 0, `${path}: navigation outside content`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${path} at ${width}: no horizontal overflow`);
      if (path.startsWith('/nova')) {
        assert.equal(await page.locator('.viewer-layout > .viewer-site-footer').count(), 1, `${path}: footer stays inside the viewer layout`);
        assert.equal(await page.evaluate(() => {
          const footer = document.querySelector('.viewer-site-footer').getBoundingClientRect();
          const main = document.querySelector('.viewer-main').getBoundingClientRect();
          const overview = document.querySelector('.viewer-overview').getBoundingClientRect();
          return footer.top >= Math.max(main.bottom, overview.bottom) - 1;
        }), true, `${path} at ${width}: footer follows all page content`);
        if (width > 760) {
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          assert.equal(await page.evaluate(() => {
            const rail = document.querySelector('.viewer-rail').getBoundingClientRect();
            const footer = document.querySelector('.viewer-site-footer').getBoundingClientRect();
            return rail.bottom >= footer.bottom - 1;
          }), true, `${path}: rail reaches the footer`);
          await page.evaluate(() => window.scrollTo(0, 0));
        }
      }
      await page.screenshot({ path: `${output}/${path.slice(1).replace(/[\/#]/g, '-')}-${width}.png`, fullPage: true });
    }
    if (process.env.VIEWER_DESIGN_REFERENCE) {
      await page.goto(origin + '/reference'); await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${output}/reference-${width}.png`, fullPage: true });
    }
  }
  // YR-019: the overview rail never squeezes the primary column below ~640px;
  // it wraps under the main column until the layout can afford both.
  for (const path of ['/nova', '/nova/shop']) {
    await page.goto(origin + path);
    await page.evaluate(() => window.__yrViewerAppReady);
    const widths = {};
    for (const width of [320, 390, 768, 1000, 1001, 1024, 1200, 1300, 1301, 1399, 1400, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const metrics = await page.evaluate(() => {
        const main = document.querySelector('.viewer-main').getBoundingClientRect();
        const overview = document.querySelector('.viewer-overview').getBoundingClientRect();
        return { main: Math.round(main.width - parseFloat(getComputedStyle(document.querySelector('.viewer-main')).paddingLeft)), beside: overview.top < main.bottom && overview.left >= main.right - 1, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      widths[width] = metrics;
      if (width === 1200) await page.screenshot({ path: `${output}/${path.slice(1).replace(/\//g, '-')}-${width}.png`, fullPage: true });
      assert.equal(metrics.overflow, false, `${path} at ${width}: no horizontal overflow`);
      if (width >= 1001) assert.ok(metrics.main >= 640, `${path} at ${width}: primary column ${metrics.main}px keeps >=640px`);
      if (width <= 1300) assert.equal(metrics.beside, false, `${path} at ${width}: overview wraps under the main column`);
      else assert.equal(metrics.beside, true, `${path} at ${width}: overview sits beside the main column`);
    }
    assert.ok(widths[1024].main >= widths[768].main, `${path}: primary column does not shrink from 768 to 1024 (${widths[768].main} -> ${widths[1024].main})`);
    assert.ok(widths[1301].main >= 640 && widths[1400].main >= 640, `${path}: overview appearing keeps the primary column >=640px`);
    console.log(`${path} main widths: ${Object.entries(widths).map(([w, m]) => `${w}:${m.main}`).join(' ')}`);
  }
  // YR-022: reward cards size to the catalog container (>=240px tracks, one column below 600px, 4:3 media).
  for (const count of [1, 4, 9]) {
    await page.goto(`${origin}/nova/shop?rewards=${count}`);
    await page.evaluate(() => window.__yrViewerAppReady);
    const report = [];
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const m = await page.evaluate(() => {
        const list = document.getElementById('viewer-rewards');
        const cards = [...list.querySelectorAll('.yr-rwd')].map(card => card.getBoundingClientRect());
        const media = list.querySelector('.yr-rwd-art, .yr-rwd-img').getBoundingClientRect();
        const actions = [...list.querySelectorAll('.yr-rwd .yr-act')];
        return { container: Math.round(list.getBoundingClientRect().width), cards: cards.map(c => Math.round(c.width)), columns: new Set(cards.map(c => Math.round(c.left))).size, ratio: media.width / media.height, overflow: document.documentElement.scrollWidth > innerWidth, clipped: actions.some(a => a.scrollWidth > a.clientWidth + 1), rowsAligned: cards.every((c, i) => cards.every((d, j) => j <= i || Math.round(c.top) !== Math.round(d.top) || Math.abs(actions[i].getBoundingClientRect().bottom - actions[j].getBoundingClientRect().bottom) < 1)) };
      });
      report.push(`${width}:${m.columns}x${m.cards[0]}`);
      if (count === 4 && (width === 390 || width === 1440)) await page.screenshot({ path: `${output}/nova-shop-4-rewards-${width}.png`, fullPage: true });
      assert.equal(m.overflow, false, `${count} rewards at ${width}: no overflow`);
      assert.equal(m.clipped, false, `${count} rewards at ${width}: actions not clipped`);
      assert.equal(m.rowsAligned, true, `${count} rewards at ${width}: cost/action rows align across each row`);
      assert.ok(Math.abs(m.ratio - 4 / 3) < 0.02, `${count} rewards at ${width}: 4:3 media (${m.ratio.toFixed(2)})`);
      if (width < 600) assert.equal(m.columns, 1, `${count} rewards at ${width}: one column`);
      else assert.ok(m.cards.every(w => w >= 240), `${count} rewards at ${width}: every card >=240px (${m.cards.join(',')})`);
      if (count === 1) assert.ok(m.cards[0] >= Math.min(m.container, 640) - 1, `lone reward at ${width}: fills the catalog up to 640px (${m.cards[0]} of ${m.container})`);
      if (count === 4 && width >= 768) assert.ok(m.columns >= 2 && m.columns <= 4, `4 rewards at ${width}: ${m.columns} columns`);
    }
    console.log(`${count} reward(s) columns x card width: ${report.join(' ')}`);
  }
  // YR-023: no promotional banner between the rewards controls and the catalog; a real reward is on the first 390x844 screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.goto(origin + '/nova/shop?signedout');
  await page.evaluate(() => window.__yrViewerAppReady);
  assert.equal(await page.locator('.viewer-rewards-banner').count(), 0, 'generic rewards banner removed');
  assert.deepEqual(await page.evaluate(() => [...document.querySelector('.viewer-main').children].map(el => el.className.split(' ')[0] || el.tagName.toLowerCase()).filter(name => !['yr-redeem-status', 'yr-note'].includes(name)).slice(0, 2)), ['viewer-page-intro', 'section'], 'search/sort controls sit immediately before the catalog');
  assert.equal(await page.locator('#cookieReject').isVisible(), true, 'fresh guest sees the consent prompt');
  await page.screenshot({ path: `${output}/nova-shop-guest-consent-390.png` });
  for (const selector of ['#cookieReject', '#cookieAccept', '#viewer-menu', '.viewer-user', '#viewer-reward-search', '#viewer-rewards .yr-rwd .yr-act']) {
    assert.equal(await page.locator(selector).first().isVisible(), true, `${selector} reachable while consent is shown`);
  }
  await page.locator('#cookieReject').click();
  await page.locator('#cookieReject').waitFor({ state: 'hidden' });
  const firstScreen = await page.evaluate(() => ({ title: Math.round(document.querySelector('.viewer-page-intro h1').getBoundingClientRect().top), reward: Math.round(document.querySelector('#viewer-rewards .yr-rwd').getBoundingClientRect().top), rewardBottom: Math.round(document.querySelector('#viewer-rewards .yr-rwd').getBoundingClientRect().bottom), hiddenAbove: [...document.querySelectorAll('.viewer-main > *')].filter(el => getComputedStyle(el).display === 'none' && !el.hidden && !el.matches(':empty')).length }));
  await page.screenshot({ path: `${output}/nova-shop-guest-settled-390.png` });
  console.log(`390x844 guest, consent dismissed: title top ${firstScreen.title}px, first reward ${firstScreen.reward}-${firstScreen.rewardBottom}px`);
  assert.ok(firstScreen.title >= 60 && firstScreen.title <= 140, `title starts within the first ~140px (${firstScreen.title})`);
  assert.ok(firstScreen.reward < 844 - 200, `a real reward is visible on the first screen (top ${firstScreen.reward})`);
  assert.equal(firstScreen.hiddenAbove, 0, 'nothing is hidden to fake the measurement');
  await page.context().addCookies([{ name: '__csrf', value: 'fixture-csrf', url: origin }]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + '/nova');
  await page.evaluate(() => window.__yrViewerAppReady);
  assert.equal(await page.locator('[data-viewer-guide],[data-guide-restore]').count(), 0);
  assert.equal(await page.locator('.viewer-destinations a', { hasText: 'Activities' }).count(), 0, 'Unavailable destinations are omitted');
  assert.equal(await page.locator('#viewer-menu').isVisible(), false, 'No menu trigger on wide screens');
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await page.locator('#viewer-rail').waitFor({ state: 'hidden', timeout: 2000 }).catch(() => assert.fail(`${width}: rail is a closed drawer`));
    assert.equal(await page.locator('#viewer-menu').getAttribute('aria-expanded'), 'false');
    await page.locator('#viewer-menu').click();
    await page.waitForFunction(() => document.activeElement && document.activeElement.closest('#viewer-rail'));
    assert.equal(await page.locator('#viewer-menu').getAttribute('aria-expanded'), 'true', `${width}: expanded state`);
    assert.equal(await page.locator('#viewer-rail').getAttribute('role'), 'dialog');
    assert.equal(await page.locator('.viewer-destinations a[href="/nova/shop"]').isVisible(), true, `${width}: destinations reachable`);
    assert.equal(await page.locator('.viewer-sidebar-bottom a[href^="/help"]').isVisible(), true, `${width}: help reachable`);
    await page.waitForFunction(() => getComputedStyle(document.getElementById('viewer-rail')).transform === 'none' && document.getElementById('viewer-rail').getBoundingClientRect().left === 0);
    await page.screenshot({ path: `${output}/nova-drawer-${width}.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#viewer-rail').getAttribute('data-open'), null, `${width}: Escape closes`);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'viewer-menu', `${width}: focus returns to trigger`);
    await page.locator('#viewer-menu').click();
    await page.locator('.viewer-destinations a[href="/nova/shop"]').click();
    await page.waitForSelector('[data-redeem="shoutout"]');
    assert.equal(await page.locator('#viewer-rail').getAttribute('data-open'), null, `${width}: route change closes the menu`);
    assert.equal(await page.evaluate(() => document.querySelector('.viewer-main').inert), false, `${width}: content usable after navigation`);
    await page.goto(origin + '/nova'); await page.evaluate(() => window.__yrViewerAppReady);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { window.shellIdentity = { rail: document.querySelector('.viewer-rail'), top: document.querySelector('.viewer-topbar'), selector: document.querySelector('.viewer-switch') }; });
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
  await page.locator('.viewer-destinations a[href="/nova/activity"]').click();
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
  await page.waitForURL('**/nova/activity');
  await page.waitForFunction(() => document.querySelector('.viewer-credit-amount').dataset.creditBalance === '1100');
  await page.locator('#yr-code-drop-code').fill('NOVA100');
  await page.locator('[data-code-drop-submit]').click();
  await page.waitForFunction(() => /already claimed/.test(document.querySelector('#yr-code-drop-status').textContent));
  assert.equal(balance, 1100);
  await page.locator('.viewer-destinations a[href="/nova"]').click();
  await page.waitForSelector('.viewer-next-reward progress');
  assert.match(await page.locator('.viewer-next-reward').innerText(), /900 more credits needed/);
  await page.locator('#viewer-communities-link').click();
  await page.waitForSelector('.vd-card-row');
  assert.equal(await page.evaluate(() => window.shellIdentity.rail === document.querySelector('.viewer-rail')), true);
  assert.equal(await page.locator('.viewer-switch').count(), 0);
  assert.equal(await page.locator('.viewer-destinations a').count(), 5);
  assert.equal(await page.locator('.viewer-topbar [data-credit-balance]').count(), 0);
  // The account page keeps a real way back to the community it was opened from.
  assert.equal(new URL(page.url()).search, '?community=nova');
  assert.equal(await page.locator('.viewer-rail .viewer-return').getAttribute('href'), '/nova');
  assert.match(await page.locator('.viewer-rail .viewer-return').innerText(), /Nova's community/);
  await page.locator('#viewer-account-link').click();
  await page.waitForSelector('#vd-profile', { state: 'visible' });
  assert.equal(new URL(page.url()).search, '?community=nova', 'Account settings keep the community context');
  await page.locator('.viewer-rail .viewer-return').click();
  await page.waitForSelector('.viewer-next-reward');
  assert.equal(new URL(page.url()).pathname, '/nova');
  await page.locator('#viewer-communities-link').click();
  await page.waitForSelector('.vd-card-row');
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
  assert.equal(await page.locator('.viewer-rail .viewer-return').getAttribute('href'), '/nova');
  assert.equal(await page.locator('#viewer-communities-link').getAttribute('href'), '/me?community=nova');
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
    await page.goto(`${origin}/nova/activity?${state}`);
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
  await page.locator('#viewer-menu').click();
  await page.locator('.viewer-sidebar-bottom a').click();
  await page.waitForSelector('#contactForm');
  releaseAccount();
  await page.unrouteAll({ behavior: 'wait' });
  assert.equal(new URL(page.url()).pathname, '/help/support', 'Account reads do not prevent navigation');
  // YR-011/012/013: one stable reward URL, readable before sign-in, honest when gone.
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin + '/nova/shop/topic?signedout');
    await page.evaluate(() => window.__yrViewerAppReady);
    assert.equal(await page.locator('h1').innerText(), 'Suggest a stream topic', `${width}: detail names the reward`);
    for (const text of ['500 credits', 'Share an idea', 'Fulfillment', 'Contact Nova']) {
      assert.ok(await page.locator('main').textContent().then(t => t.includes(text)), `${width}: guest detail shows "${text}"`);
    }
    const gate = page.locator('.viewer-reward-claim a.yr-act');
    assert.equal(await gate.innerText(), 'Sign in to claim');
    assert.ok((await gate.getAttribute('href')).endsWith('/nova/activity?intent=reward&reward=topic'), `${width}: gate carries the reward id`);
    assert.equal(await page.locator('[data-redeem]').count(), 0, `${width}: guest detail has no claim button`);
    const back = page.locator('.viewer-reward-back');
    assert.ok(await back.isVisible(), `${width}: back link visible`);
    const box = await page.locator('.viewer-reward-detail').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1, `${width}: detail fits the viewport (${Math.round(box.x)}..${Math.round(box.x + box.width)})`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}: no horizontal overflow`);
    await back.click();
    await page.waitForURL(/\/nova\/shop(\?|$)/);
    assert.ok(await page.locator('#viewer-rewards').isVisible(), `${width}: back returns to the catalog`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Catalog cards and Home reach the exact reward, and a member gets the review step, not a claim.
  await page.goto(origin + '/nova/shop');
  await page.evaluate(() => window.__yrViewerAppReady);
  await page.locator('#reward-emote .yr-rwd-link').click();
  await page.waitForURL(/\/nova\/shop\/emote$/);
  assert.equal(await page.locator('h1').innerText(), 'Choose a community emote');
  assert.ok((await page.locator('main').innerText()).includes('You have'), 'member sees balance against cost');
  await page.goto(origin + '/nova/shop/shoutout');
  await page.evaluate(() => window.__yrViewerAppReady);
  const memberBalance = await page.locator('[data-credit-balance]').first().getAttribute('data-credit-balance');
  await page.locator('.viewer-reward-claim [data-redeem]').click();
  assert.ok(await page.locator('#yr-order-confirm[open]').isVisible(), 'claim opens the review dialog first');
  assert.ok((await page.locator('#yr-order-confirm').innerText()).includes('Community shout-out'));
  await page.locator('#yr-order-confirm [data-order-cancel], #yr-order-confirm button:has-text("Cancel")').first().click();
  assert.equal(await page.locator('#yr-order-confirm[open]').count(), 0);
  assert.equal(await page.locator('[data-credit-balance]').first().getAttribute('data-credit-balance'), memberBalance, 'cancelling deducts nothing');
  await page.goto(origin + '/nova');
  await page.evaluate(() => window.__yrViewerAppReady);
  const homeViews = await page.locator('.viewer-home-columns .yr-rwd .yr-act').evaluateAll(links => links.map(link => link.getAttribute('href')));
  assert.ok(homeViews.length >= 1 && homeViews.length <= 4, 'Home shows up to four rewards');
  for (const href of homeViews) assert.match(href, /\/nova\/shop\/[a-z]+$/, 'Home "View reward" targets one reward');
  assert.equal(new Set(homeViews).size, homeViews.length, 'each Home reward links to its own detail page');
  // Unknown, other-community and withdrawn ids recover instead of claiming or 500ing.
  for (const path of ['/nova/shop/nope', '/luna/shop/topic-from-nova']) {
    const res = await page.goto(origin + path);
    assert.equal(res.status(), 404, `${path} is a 404`);
    assert.equal(await page.locator('h1').innerText(), "This reward isn't available", `${path} recovers`);
    assert.ok(await page.locator('a.yr-btn:has-text("See all rewards")').isVisible());
    assert.ok(await page.locator('.viewer-destinations').isVisible(), `${path} keeps the community shell`);
  }
  const gone = await page.goto(origin + '/nova/shop/withdrawn');
  assert.equal(gone.status(), 404);
  assert.equal(await page.locator('h1').innerText(), 'Retired hoodie');
  assert.ok((await page.locator('main').innerText()).includes('No longer offered'), 'withdrawn reward says so');
  assert.equal(await page.locator('[data-redeem]').count(), 0, 'withdrawn reward cannot be claimed');
  assert.ok((await page.locator('main').innerText()).includes("hasn't added a description yet"), 'missing description stated honestly');
  // Sign-in intent for two different rewards returns to each reward, including one that vanished meanwhile.
  for (const [id, expectHeading] of [['topic', 'Suggest a stream topic'], ['withdrawn', 'Retired hoodie']]) {
    await page.goto(origin + `/nova/activity?intent=reward&reward=${id}&signedout`);
    await page.evaluate(() => window.__yrViewerAppReady);
    const gateLink = page.locator('.member-actions a[href*="returnTo="]').first();
    const returnTo = decodeURIComponent(new URL(await gateLink.getAttribute('href'), origin).searchParams.get('returnTo'));
    assert.equal(returnTo, `${origin}/nova/shop/${id}`, `sign-in returns to reward ${id}`);
    await page.goto(returnTo);
    assert.equal(await page.locator('h1').innerText(), expectHeading, `${id} restored after sign-in`);
  }
  assert.deepEqual(errors, []);
  console.log('PASSED: desktop/mobile community and account pages, persistent shell through account/help routes and Back/Forward, account/community separation, failed navigation recovery, rewards and codes with CSRF/idempotency, repeat-code protection and signed-out/empty/unavailable/blocked states; no page errors.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
