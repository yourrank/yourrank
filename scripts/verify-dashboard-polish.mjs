// Browser audit against scripts/dashboard-polish-fixtures.mjs (Bun server).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const origin = process.env.POLISH_ORIGIN || 'http://127.0.0.1:8915';
const output = process.env.POLISH_OUTPUT || '.local-logs/dashboard-polish-before';
const fixtureMode = process.env.POLISH_STATE || 'populated';
await mkdir(output, { recursive: true });
const routes = [
  ['home', '/dashboard'], ['setup', '/dashboard/leaderboard/setup'], ['leaderboard', '/dashboard/leaderboard/players'], ['appearance', '/dashboard/leaderboard/design'], ['share', '/dashboard/leaderboard/share'],
  ['members', '/dashboard/audience/members'], ['activity', '/dashboard/audience/activity'], ['reviews', '/dashboard/audience/reviews'], ['activities', '/dashboard/activities'], ['giveaways', '/dashboard/giveaways/chat'],
  ['earn', '/dashboard/rewards/rules'], ['shop', '/dashboard/rewards/shop'], ['claims', '/dashboard/rewards/redemptions'], ['insights', '/dashboard/analytics/activity'], ['telegram', '/dashboard/telegram'],
  ['account', '/dashboard/settings/account'], ['team', '/dashboard/settings/team'], ['billing', '/dashboard/settings/billing'], ['connections', '/dashboard/settings/connections'], ['data', '/dashboard/settings/data'], ['site', '/dashboard/site'],
];
const requestedRoutes = new Set((process.env.POLISH_ROUTES || '').split(',').filter(Boolean));
const auditedRoutes = requestedRoutes.size ? routes.filter(([name]) => requestedRoutes.has(name)) : routes;
assert.ok(auditedRoutes.length, 'POLISH_ROUTES did not select a dashboard destination');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const results = [];
const violations = [];
try {
  const page = await browser.newPage({ colorScheme: 'dark' });
  let errors = [];
  let serverErrors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', response => {
    if (response.url().startsWith(origin) && response.status() >= 500) serverErrors.push({ url: response.url(), status: response.status() });
  });
  await page.route('https://**/*', route => route.abort());
  await page.request.get(`${origin}/__fixture?mode=${encodeURIComponent(fixtureMode)}`);
  for (const width of (process.env.POLISH_WIDTHS || '1440,1280,768,390').split(',').map(Number)) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, path] of auditedRoutes) {
      errors = [];
      serverErrors = [];
      await page.goto(origin + path, { waitUntil: fixtureMode === 'loading' ? 'domcontentloaded' : 'networkidle' });
      if (fixtureMode === 'loading') await page.waitForTimeout(300);
      await page.screenshot({ path: `${output}/${width}-${name}.png`, fullPage: true });
      const state = await page.evaluate(() => ({
        title: [...document.querySelectorAll('h1')].filter(e => e.getClientRects().length).map(e => e.textContent.trim()),
        documentWidth: document.documentElement.scrollWidth, viewport: innerWidth,
        overflow: [...document.querySelectorAll('main *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1) && getComputedStyle(e).position !== 'fixed'; }).slice(0, 14).map(e => ({ tag: e.tagName, id: e.id, class: e.className })),
        stateCues: {
          loading: [...document.querySelectorAll('[aria-busy="true"], [class*="loading" i], [class*="skeleton" i]')].filter(e => e.getClientRects().length).length,
          empty: [...document.querySelectorAll('[class*="empty" i]')].filter(e => e.getClientRects().length).length,
          error: [...document.querySelectorAll('[role="alert"], [class*="error" i]')].filter(e => e.getClientRects().length).length,
        },
        text: document.body.innerText.slice(-1200),
      }));
      const result = { name, path, width, fixtureMode, ...state, errors: [...errors], serverErrors: [...serverErrors] };
      results.push(result);
      if (state.documentWidth > width || errors.length || (fixtureMode !== 'error' && serverErrors.length)) violations.push(result);
      console.log(JSON.stringify({ name, width, title: state.title, overflow: state.documentWidth > width, errors, serverErrors, stateCues: state.stateCues }));
    }
  }
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  assert.equal(violations.length, 0, `Dashboard visual audit violations: ${violations.map(({ name, width }) => `${name}@${width}`).join(', ')}`);
} finally { await browser.close(); }
