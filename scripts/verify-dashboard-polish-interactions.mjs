// Keyboard, overlay, deep-link, and site-selector checks for the fixture audit.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
const origin = process.env.POLISH_ORIGIN || 'http://127.0.0.1:8915';
const output = process.env.POLISH_OUTPUT || '.local-logs/dashboard-polish-after';
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
const findings = [];

async function visit(path) {
  await page.goto(origin + path, { waitUntil: 'networkidle' });
}

async function noDocumentOverflow(label) {
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: innerWidth }));
  assert.ok(dimensions.scrollWidth <= dimensions.width, `${label} overflows the document (${dimensions.scrollWidth}px > ${dimensions.width}px)`);
  return dimensions;
}

async function closePaletteAndAssert(triggerId) {
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#yrPaletteModal').isVisible(), false, 'Escape must hide the command palette');
  assert.equal(await page.locator('#yrPaletteBackdrop').isVisible(), false, 'Escape must hide the palette backdrop');
  const focus = await page.evaluate((id) => {
    const trigger = document.getElementById(id);
    return {
      active: document.activeElement?.id,
      trigger: trigger && { connected: trigger.isConnected, disabled: trigger.disabled, inert: trigger.inert, parentInert: trigger.parentElement?.inert, visible: Boolean(trigger.getClientRects().length) },
    };
  }, triggerId);
  console.log(JSON.stringify({ check: 'palette-close-focus', focus }));
  assert.equal(focus.active, triggerId, 'Escape must return focus to the palette trigger');
}

try {
  // Mobile: the visible topbar Search control, Ctrl+K, arrows, Enter, Escape,
  // direct deep links, and Back/Forward all use the existing route entry point.
  await visit('/dashboard/activities');
  const trigger = page.locator('#topbarCmdTrigger');
  assert.equal(await trigger.isVisible(), true, 'Search must be discoverable at 390px');
  await trigger.click();
  assert.equal(await page.locator('#yrPaletteModal').isVisible(), true, 'Topbar Search must open the command palette');
  const initialActive = await page.locator('#yrPaletteInput').getAttribute('aria-activedescendant');
  await page.keyboard.press('ArrowDown');
  const arrowActive = await page.locator('#yrPaletteInput').getAttribute('aria-activedescendant');
  assert.ok(arrowActive && arrowActive !== initialActive, 'Arrow navigation must update the active command');
  await page.locator('#yrPaletteInput').fill('home');
  assert.ok(await page.locator('#yrPaletteResults [role="option"]').count() > 0, 'Home must remain reachable in the command palette');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.pathname === '/dashboard');
  assert.equal(await page.locator('#yrPaletteModal').isVisible(), false, 'Enter must close the palette after activation');
  await page.goBack();
  await page.waitForFunction(() => location.pathname === '/dashboard/activities');
  await page.goForward();
  await page.waitForFunction(() => location.pathname === '/dashboard');
  await page.keyboard.press('Control+k');
  assert.equal(await page.locator('#yrPaletteModal').isVisible(), true, 'Ctrl+K must open the command palette');
  await closePaletteAndAssert('topbarCmdTrigger');
  findings.push({ check: 'palette-and-history', dimensions: await noDocumentOverflow('mobile command palette') });

  // The selected-site control remains the existing route/state owner.
  const siteSelect = page.locator('#sidebarBoardSelect');
  assert.equal(await siteSelect.isVisible(), true, 'The site selector must be available on Home');
  const options = await siteSelect.locator('option').evaluateAll(items => items.map(item => ({ value: item.value, selected: item.selected })));
  const alternateSite = options.find(({ value, selected }) => value && !selected);
  assert.ok(alternateSite, 'The site selector fixture must offer another site');
  await siteSelect.selectOption(alternateSite.value);
  await page.waitForFunction((siteId) => new URLSearchParams(location.search).get('board') === siteId, alternateSite.value);
  await page.waitForFunction((siteId) => document.getElementById('sidebarBoardSelect')?.value === siteId, alternateSite.value);
  assert.equal(await siteSelect.inputValue(), alternateSite.value, 'The selected site must remain reflected in the selector');
  findings.push({ check: 'site-selector', path: await page.evaluate(() => location.pathname + location.search) });

  // The mobile reward editor is a named dialog only while it overlays the page;
  // it keeps focus inside, starts at the top, and restores focus on Escape.
  await visit('/dashboard/rewards/shop');
  await page.locator('#cr-shop-new').click();
  const drawer = page.locator('#cr-shop-drawer');
  assert.equal(await drawer.getAttribute('role'), 'dialog', 'The mobile reward editor must expose dialog semantics');
  assert.equal(await drawer.getAttribute('aria-modal'), 'true', 'The mobile reward editor must be modal');
  assert.equal(await drawer.getAttribute('aria-labelledby'), 'cr-shop-drawer-title', 'The reward editor must have a programmatic name');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'cr-shop-name', 'Opening the reward editor must focus its first field');
  assert.equal(await drawer.evaluate(el => el.scrollTop), 0, 'Opening the reward editor must start at its heading');
  const headerGeometry = await page.evaluate(() => {
    const topbar = document.querySelector('.lb-topbar')?.getBoundingClientRect();
    const drawerEl = document.getElementById('cr-shop-drawer');
    const heading = document.getElementById('cr-shop-drawer-title')?.getBoundingClientRect();
    const close = document.getElementById('cr-shop-close')?.getBoundingClientRect();
    const hit = close && document.elementFromPoint(close.left + close.width / 2, close.top + close.height / 2);
    const drawerRect = drawerEl?.getBoundingClientRect();
    return {
      topbarBottom: topbar?.bottom,
      headingTop: heading?.top,
      drawerTop: drawerRect?.top,
      drawerBottom: drawerRect?.bottom,
      viewportHeight: innerHeight,
      closeInDrawer: Boolean(hit && drawerEl?.contains(hit)),
    };
  });
  console.log(JSON.stringify({ check: 'reward-editor-header', headerGeometry }));
  assert.ok(headerGeometry.drawerTop >= headerGeometry.topbarBottom, 'The reward editor must start below the topbar');
  assert.ok(headerGeometry.drawerBottom <= headerGeometry.viewportHeight, 'The reward editor must fit the viewport');
  assert.ok(headerGeometry.headingTop >= headerGeometry.topbarBottom, 'The reward editor heading must not be covered by the topbar');
  assert.equal(headerGeometry.closeInDrawer, true, 'The reward editor close control must remain exposed above the page');
  await page.screenshot({ path: `${output}/reward-editor-mobile.png`, fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await drawer.isVisible(), false, 'Escape must close the reward editor');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'cr-shop-new', 'Closing the reward editor must return focus to its trigger');
  findings.push({ check: 'reward-editor-dialog', dimensions: await noDocumentOverflow('mobile reward editor') });

  await writeFile(`${output}/interaction-probe.json`, JSON.stringify(findings, null, 2));
  console.log(JSON.stringify(findings));
} finally {
  await browser.close();
}
