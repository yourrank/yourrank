// Screenshots for the Engage navigation hierarchy: the hub Overview, the
// Giveaways subnav (Chat Giveaway, Raffle), Tournaments, and Activities at
// desktop and 390px. Runs against scripts/dashboard-polish-fixtures.mjs.
//
// Env: POLISH_ORIGIN (fixture origin), PLAYWRIGHT_MODULE_PATH,
// CHROMIUM_EXECUTABLE, ENGAGE_NAV_OUTPUT.
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const origin = process.env.POLISH_ORIGIN || 'http://127.0.0.1:8915';
const output = process.env.ENGAGE_NAV_OUTPUT || '.local-logs/engage-nav';
await mkdir(output, { recursive: true });

const pages = [
  ['overview', '/dashboard/giveaways', '#engage-hub'],
  ['chat', '/dashboard/giveaways/chat', '#pane-chat'],
  ['raffle', '/dashboard/giveaways/raffles', '#pane-raffles'],
  ['tournaments', '/dashboard/giveaways/tournaments', '#tournament-workspace:not([hidden]), #tournament-empty:not([hidden])'],
  ['activities', '/dashboard/activities', '#act-list:not([hidden]), #act-empty:not([hidden]), #act-error:not([hidden])'],
];

const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage({ colorScheme: 'dark' });
await page.route('https://**/*', (route) => route.abort());
for (const { width, height, suffix } of [
  { width: 1440, height: 900, suffix: '1440' },
  { width: 390, height: 844, suffix: '390' },
]) {
  await page.setViewportSize({ width, height });
  for (const [name, path, waitSel] of pages) {
    await page.goto(origin + path, { waitUntil: 'networkidle' });
    await page.waitForSelector(waitSel, { timeout: 15000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${output}/${name}-${suffix}.png`, fullPage: true });
    console.log(`${name}-${suffix}.png`);
  }
}
await browser.close();
