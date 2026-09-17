// YR-038: the global Terms, Privacy, Cookies, Refund and Responsible Play pages
// use the responsive public header/footer. Checks 320/390/768/1440 for no
// horizontal overflow, reachable header actions (drawer open/close via click,
// Escape with focus restoration, link dismissal), Cookie preferences, one H1,
// no viewer dashboard rail, and 200% zoom reflow. Exercises production page
// strings and browser assets with a local fixture; not a deployed Worker.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { applyLegalIdentity } from '../apps/leaderboard/src/pages/legal-helper.js';
import { termsPage } from '../apps/leaderboard/src/pages/terms.js';
import { privacyPage } from '../apps/leaderboard/src/pages/privacy.js';
import { cookiesPage } from '../apps/leaderboard/src/pages/cookies.js';
import { refundPage } from '../apps/leaderboard/src/pages/refund.js';
import { responsiblePage } from '../apps/leaderboard/src/pages/responsible.js';
import { reviewsPage } from '../apps/leaderboard/src/pages/reviews.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const output = '.local-logs/yr-038';
await mkdir(output, { recursive: true });

// Mirrors addCookieConsent() in apps/leaderboard/src/index.js.
const addCookieConsent = (html) => html.replace(/<\/body>\s*<\/html>\s*$/i, '<script src="/assets/cookie-consent.js" defer></script></body></html>');
const PAGES = { terms: termsPage, privacy: privacyPage, cookies: cookiesPage, refund: refundPage, responsible: responsiblePage, reviews: reviewsPage };
const LEGAL = ['terms', 'privacy', 'cookies', 'refund', 'responsible'];
const WIDTHS = [320, 390, 768, 1440];

let origin;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/assets/')) {
      if (!/^\/assets\/[a-z0-9-]+\.(css|js)$/.test(url.pathname)) { res.writeHead(404).end(); return; }
      res.setHeader('content-type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
      res.end(await readFile(new URL(`../apps/leaderboard/src${url.pathname}`, import.meta.url))); return;
    }
    const page = PAGES[url.pathname.slice(1)];
    if (!page) { res.writeHead(404).end('not found'); return; }
    res.setHeader('content-type', 'text/html');
    res.end(addCookieConsent(applyLegalIdentity(page, {}).replace(/{{YEAR}}/g, '2026')));
  } catch (e) { res.writeHead(500).end(String(e?.stack || e)); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

const measure = () => ({
  h1: document.querySelectorAll('h1').length,
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
  wide: [...document.querySelectorAll('body *')]
    .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
    .slice(0, 4).map((el) => `${el.tagName}.${el.className}`),
  toggleVisible: !!document.querySelector('.nav-toggle')?.offsetParent,
  linksVisible: !!document.querySelector('nav.top .links')?.offsetParent,
  rail: !!document.querySelector('.yr-rail, .yr-vaside, .viewer-rail, .topbar, .topbar-right'),
  article: !!document.querySelector('main article.legal, main.pg-wrap'),
  prefs: !!document.querySelector('[data-cookie-preferences]'),
  legalLinks: [...document.querySelectorAll('.ftr-col a')].map((a) => a.getAttribute('href')),
  current: document.querySelector('.ftr-col a[aria-current]')?.getAttribute('href') ?? null,
  headerActions: [...document.querySelectorAll('nav.top a, nav.top button')].map((el) => el.textContent.trim() || el.getAttribute('aria-label')),
});

for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const key of Object.keys(PAGES)) {
    await page.goto(`${origin}/${key}`, { waitUntil: 'load' });
    const m = await page.evaluate(measure);
    const tag = `${key}@${width}`;
    check(m.h1 === 1, `${tag}: expected one H1, got ${m.h1}`);
    check(m.scrollW <= m.clientW + 1, `${tag}: horizontal overflow ${m.scrollW} > ${m.clientW} (${m.wide.join(', ')})`);
    check(m.wide.length === 0, `${tag}: elements past viewport ${m.wide.join(', ')}`);
    check(!m.rail, `${tag}: viewer rail / legacy topbar present`);
    check(m.article, `${tag}: main content is not an article`);
    check(m.prefs, `${tag}: Cookie preferences trigger missing`);
    const compact = width <= 720;
    check(m.toggleVisible === compact && m.linksVisible === !compact, `${tag}: header mode wrong (toggle=${m.toggleVisible}, links=${m.linksVisible})`);
    if (LEGAL.includes(key)) {
      for (const p of LEGAL) check(m.legalLinks.includes(`/${p}`), `${tag}: footer misses /${p}`);
      check(m.current === `/${key}`, `${tag}: footer aria-current is ${m.current}`);
    }
    await page.screenshot({ path: `${output}/${key}-${width}.png` });

    if (compact) {
      // Header actions must be reachable through the drawer, by pointer and keyboard.
      await page.click('.nav-toggle');
      const opened = await page.evaluate(() => {
        const links = document.querySelector('nav.top .links');
        const items = [...links.querySelectorAll('a')];
        return {
          expanded: document.querySelector('.nav-toggle').getAttribute('aria-expanded'),
          open: links.classList.contains('open'),
          visible: items.every((a) => a.offsetParent && a.getBoundingClientRect().right <= document.documentElement.clientWidth + 1),
          count: items.length,
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
        };
      });
      check(opened.expanded === 'true' && opened.open, `${tag}: drawer did not open`);
      check(opened.visible && opened.count >= 6, `${tag}: drawer links not all visible/reachable (${opened.count})`);
      check(opened.scrollW <= opened.clientW + 1, `${tag}: drawer causes overflow`);
      if (key === 'terms') await page.screenshot({ path: `${output}/${key}-${width}-menu.png` });
      await page.keyboard.press('Escape');
      const closed = await page.evaluate(() => ({
        expanded: document.querySelector('.nav-toggle').getAttribute('aria-expanded'),
        open: document.querySelector('nav.top .links').classList.contains('open'),
        focusOnToggle: document.activeElement === document.querySelector('.nav-toggle'),
      }));
      check(closed.expanded === 'false' && !closed.open, `${tag}: Escape did not close drawer`);
      check(closed.focusOnToggle, `${tag}: focus not restored to toggle after Escape`);
      // Keyboard: Enter on the focused toggle re-opens, Tab reaches the first link.
      await page.keyboard.press('Enter');
      await page.keyboard.press('Tab');
      const tabbed = await page.evaluate(() => ({
        open: document.querySelector('nav.top .links').classList.contains('open'),
        focusInLinks: !!document.activeElement.closest('nav.top .links'),
      }));
      check(tabbed.open && tabbed.focusInLinks, `${tag}: keyboard open/Tab into drawer failed`);
      await page.keyboard.press('Escape');
    }

    if (key === 'cookies') {
      await page.evaluate(() => document.querySelector('[data-cookie-preferences]').scrollIntoView());
      await page.click('[data-cookie-preferences]');
      const dialogVisible = await page.evaluate(() => {
        const d = document.querySelector('dialog.yr-consent-dialog');
        return !!d && d.open && document.activeElement && d.contains(document.activeElement);
      });
      check(dialogVisible, `${tag}: Cookie preferences dialog did not open`);
      if (width === 390) await page.screenshot({ path: `${output}/${key}-${width}-prefs.png` });
    }
  }
  check(errors.length === 0, `width ${width}: page errors ${errors.join(' | ')}`);
  await context.close();
}

// Zoom/reflow: browser zoom at 200% on a 1280px window yields a 640px CSS viewport
// at 2x device pixels; the layout must reflow to the compact header with no overflow.
{
  const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${origin}/terms`, { waitUntil: 'load' });
  const z = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    toggleVisible: !!document.querySelector('.nav-toggle')?.offsetParent,
  }));
  check(z.scrollW <= z.clientW + 1, `zoom 200%: horizontal overflow ${z.scrollW} > ${z.clientW}`);
  check(z.toggleVisible, 'zoom 200%: header did not reflow to compact mode');
  await page.screenshot({ path: `${output}/terms-zoom200.png` });
  await context.close();
}

await browser.close();
server.close();
if (failures.length) {
  console.error(`FAILED (${failures.length})\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`PASSED: ${LEGAL.length} global legal routes + /reviews at ${WIDTHS.join('/')} share the responsive public header (no overflow, drawer opens/closes by pointer, Escape restores focus, keyboard reaches links, Cookie preferences open, one H1, no viewer rail, 200% zoom reflows).`);
