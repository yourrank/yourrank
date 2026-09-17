// YR-037: the six community policy/contact routes render as one shared article
// (one H1, no overview/share/credits clutter), link each other, open cookie
// preferences from the Cookie Policy and keep honest support destinations.
// Exercises the production renderer and browser assets with a fixture; not a
// deployed Worker or database.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { renderNewLegalPage } from '../apps/leaderboard/src/auxiliary-renderers.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const output = '.local-logs/yr-037';
await mkdir(output, { recursive: true });

const PAGES = ['terms', 'privacy', 'cookies', 'refund', 'contact', 'responsible'];
const data = {
  brand: { name: 'Nova', tagline: 'Weekly board' },
  branding: {},
  players: [{ name: 'Milo', rank: 1, score: 900 }],
  shopItems: [{ id: 'r1', name: 'Shout-out', cost: 100, active: true }],
  socials: [{ name: 'Discord', type: 'discord', url: 'https://discord.gg/nova', enabled: true }],
  legal: { refundEnabled: false },
  siteSections: { home: true, leaderboard: true, shop: true, me: true },
};
let origin;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/assets/')) {
      if (!/^\/assets\/[a-z0-9-]+\.(css|js)$/.test(url.pathname)) { res.writeHead(404).end(); return; }
      res.setHeader('content-type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
      res.end(await readFile(new URL(`../apps/leaderboard/src${url.pathname}`, import.meta.url))); return;
    }
    const m = url.pathname.match(/^\/nova\/(terms|privacy|cookies|refund|contact|responsible)$/);
    if (!m) { res.writeHead(404).end('not found'); return; }
    res.setHeader('content-type', 'text/html');
    res.end(await renderNewLegalPage(data, m[1], { nonce: 'n', slug: 'nova', plan: 'pro', homeUrl: origin, isCustomDomain: false, logoUrl: null }));
  } catch (e) { res.writeHead(500).end(String(e?.stack || e)); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    for (const key of PAGES) {
      await page.goto(`${origin}/nova/${key}`);
      const m = await page.evaluate(() => ({
        h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
        scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
        overview: !!document.querySelector('.viewer-overview'),
        share: !!document.querySelector('[data-share-block]'),
        credits: !!document.querySelector('.viewer-panel-footer'),
        standings: !!document.querySelector('main .yr-lb, main .viewer-stats, main [data-reward-card]'),
        signin: !!document.querySelector('main a[href*="/auth/"], main [data-guest-gate]'),
        nav: [...document.querySelectorAll('.viewer-article-nav a')].map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')]),
        support: [...document.querySelectorAll('.viewer-article-support a')].map((a) => [a.textContent.replace(/\s+\(opens.*$/, ''), a.getAttribute('href')]),
        back: document.querySelector('.viewer-rail a[href="/nova"]')?.textContent.trim() || null,
        menu: !!document.querySelector('#viewer-menu')?.offsetParent,
      }));
      assert.deepEqual(m.h1.length, 1, `${key}@${width}: one H1`);
      assert.equal(m.scrollW, m.innerW, `${key}@${width}: no horizontal overflow`);
      assert.ok(!m.overview && !m.share && !m.credits && !m.standings && !m.signin, `${key}@${width}: no rail/share/credits/standings/sign-in clutter`);
      assert.equal(m.nav.length, key === 'refund' ? 6 : 5, `${key}@${width}: enabled sibling policies (refund disabled, but still listed on its own page)`);
      assert.equal(m.nav.some(([t]) => /Refund/.test(t)), key === 'refund', `${key}@${width}: disabled refund policy not listed elsewhere`);
      assert.deepEqual(m.nav.filter(([, , cur]) => cur === 'page').map(([, h]) => h), [`/nova/${key}`], `${key}@${width}: current policy marked`);
      assert.ok(m.support.some(([t, h]) => t === 'Contact YourRank support' && h.startsWith('/help/support?audience=viewer&return=%2Fnova%2Fcontact')), `${key}@${width}: platform support destination`);
      if (key !== 'contact') assert.ok(m.support.some(([t, h]) => t === 'Discord' && h === 'https://discord.gg/nova'), `${key}@${width}: creator destination`);
      assert.ok(m.back, `${key}@${width}: back-to-community link in shared nav`);
      assert.equal(m.menu, width < 1000, `${key}@${width}: compact menu only below 1000px`);
      await page.screenshot({ path: `${output}/${key}-${width}.png`, fullPage: true });
    }
    // Refund stays reachable by URL even when hidden from the sibling list.
    await page.goto(`${origin}/nova/refund`);
    assert.equal(await page.locator('h1').textContent(), 'Refund & Cancellation');
    assert.equal(await page.locator('.viewer-article-nav a[aria-current="page"]').getAttribute('href'), '/nova/refund');

    // Cookie Policy opens the consent preferences dialog.
    await page.goto(`${origin}/nova/cookies`);
    await page.locator('#cookieReject').click().catch(() => {});
    await page.locator('.viewer-article-body [data-cookie-preferences]').click();
    await page.waitForFunction(() => document.querySelector('dialog[open]'));
    assert.ok(await page.evaluate(() => document.activeElement?.closest('dialog[open]') !== null), `cookies@${width}: focus moved into preferences dialog`);

    // Sibling nav navigates between policies and the shared nav returns to the community.
    await page.goto(`${origin}/nova/terms`);
    await page.locator('.viewer-article-nav a', { hasText: 'Privacy Policy' }).click();
    await page.waitForURL(`${origin}/nova/privacy`);
    assert.equal(await page.locator('h1').textContent(), 'Privacy Policy');
    assert.deepEqual(errors, [], `no page errors @${width}`);
    await page.close();
  }
  console.log('PASSED: six community policy/contact routes render as one article at 1440/390 (one H1, no rail/share/credits/standings/sign-in clutter, sibling nav with current page, creator + platform support links, cookie preferences open, no page errors).');
} finally {
  await browser.close();
  server.close();
}
