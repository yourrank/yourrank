// Run against dashboard-polish-fixtures.mjs: production renderers/assets,
// synthetic account data. This verifies sidebar UI, not backend persistence.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const origin = process.env.POLISH_ORIGIN || 'http://127.0.0.1:8915';
const output = process.env.POLISH_OUTPUT || '.local-logs/dashboard-sidebar';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const group = page.locator('[data-toggle-nav-group]');
  const rail = page.locator('.lb-side');
  const current = page.locator('.lb-side-nav [aria-current="page"]');
  const route = async (path, key) => {
    await page.goto(origin + path, { waitUntil: 'networkidle' });
    assert.equal(await current.count(), 1, path);
    assert.equal(await current.getAttribute('data-nav'), key, path);
  };
  await route('/dashboard/giveaways/tournaments', 'tournaments');
  assert.equal((await rail.boundingBox()).width, 228);
  await page.setViewportSize({ width: 1024, height: 640 });
  assert.equal((await rail.boundingBox()).width, 228, 'Compact desktop retains the same rail width');
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await group.getAttribute('aria-expanded'), 'true');
  assert.equal(await group.getAttribute('aria-current'), null);
  assert.deepEqual(await page.locator('.lb-side-nav .lb-nav').allTextContents(), ['Home', 'Community', 'Audience', 'Engage', 'Tournaments', 'Giveaways', 'Rewards', 'Insights', 'Telegram', 'Settings']);
  const item = page.locator('[data-nav="audience"]');
  const before = await item.evaluate(e => getComputedStyle(e).backgroundColor);
  await item.hover();
  await page.waitForTimeout(180);
  assert.notEqual(await item.evaluate(e => getComputedStyle(e).backgroundColor), before);
  await group.focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.nav), 'tournaments');
  assert.notEqual(await current.evaluate(e => getComputedStyle(e).outlineStyle), 'none');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  assert.equal(await group.getAttribute('aria-expanded'), 'false');
  await page.keyboard.press('Space');
  assert.equal(await group.getAttribute('aria-expanded'), 'true');
  // Clear the manual preference: active-route expansion should be automatic.
  await page.evaluate(() => localStorage.removeItem('yr-nav-open-engage'));
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await group.getAttribute('aria-expanded'), 'true');
  await page.locator('.lb-side-profile .gm-who-name').evaluate(e => { e.textContent = 'The community with an exceptionally long creator workspace name'; });
  assert.equal(await page.locator('.lb-side-profile .gm-who-name').evaluate(e => e.scrollWidth > e.clientWidth && getComputedStyle(e).textOverflow === 'ellipsis'), true);
  await page.screenshot({ path: `${output}/expanded.png` });
  results.push('Expanded hierarchy, single active child, hover, keyboard disclosure, focus, long account name: PASSED');

  const content = await page.locator('.lb-bento').innerHTML();
  await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
  assert.equal((await rail.boundingBox()).width, 68);
  assert.equal(await page.locator('.lb-bento').innerHTML(), content);
  assert.equal(await page.locator('.lb-side-nav .lb-nav:visible').count(), 10);
  for (const link of await page.locator('.lb-side-nav .lb-nav').all()) {
    assert.ok(await link.getAttribute('title'), 'Every icon has a native hover tooltip');
  }
  const geometry = await page.locator('.lb-main').boundingBox();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await page.locator('.lb-main').boundingBox(), geometry, 'No delayed content jump after collapse');
  await page.screenshot({ path: `${output}/collapsed.png` });
  await page.locator('.lb-side-profile summary').click();
  assert.ok(await page.locator('.gm-profile-menu').isVisible());
  const menuBox = await page.locator('.gm-profile-menu').boundingBox();
  assert.ok(menuBox.x >= 68 && menuBox.x + menuBox.width <= 1440);
  await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal((await rail.boundingBox()).width, 68);
  assert.equal(await current.getAttribute('data-nav'), 'tournaments');
  await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
  assert.equal((await rail.boundingBox()).width, 228);
  results.push('Collapsed order, native tooltips, account menu, width synchronization and saved preference: PASSED');

  await page.locator('[data-nav="giveaways"]').click();
  await page.waitForURL('**/dashboard/giveaways/chat*');
  assert.equal(await current.getAttribute('data-nav'), 'giveaways');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await current.getAttribute('data-nav'), 'giveaways');
  await page.locator('[data-nav="home"]').click();
  await page.waitForURL(url => url.pathname === '/dashboard');
  assert.equal(await group.getAttribute('aria-expanded'), 'false');
  await group.click();
  await page.locator('[data-nav="audience"]').click();
  await page.waitForURL('**/dashboard/audience/members*');
  assert.equal(await group.getAttribute('aria-expanded'), 'true');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await group.getAttribute('aria-expanded'), 'true');
  await group.click();
  await route('/dashboard/telegram', 'telegram');
  assert.equal(await group.getAttribute('aria-expanded'), 'false');
  await route('/dashboard/settings/account', 'settings');
  results.push('Client navigation, refresh selection, manual Engage persistence, Telegram and global Settings: PASSED');

  await route('/dashboard/giveaways/tournaments', 'tournaments');
  await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const opener = page.getByRole('button', { name: 'Show sections', exact: true });
    await opener.click();
    await page.waitForTimeout(250);
    assert.equal(await rail.getAttribute('aria-modal'), 'true');
    assert.equal(await group.getAttribute('aria-expanded'), 'true');
    assert.ok((await rail.boundingBox()).width > 200);
    assert.ok(await current.isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${output}/${width}.png` });
    const close = page.getByRole('button', { name: 'Close navigation', exact: true });
    await close.focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await rail.evaluate(e => e.contains(document.activeElement)), true);
    await page.keyboard.press('Escape');
    assert.equal(await opener.getAttribute('aria-expanded'), 'false');
    assert.equal(await opener.evaluate(e => document.activeElement === e), true);
  }
  results.push('Tablet/mobile drawer, overflow, visible active child, focus containment and Escape return: PASSED');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(results.join('\n'));
} finally { await browser.close(); }
