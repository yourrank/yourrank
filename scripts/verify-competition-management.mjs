// Real dashboard assets and public/preview renderers; fixture API persistence.
// CI's release-gate journey separately exercises the real API and database.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const origin = process.env.POLISH_ORIGIN || 'http://127.0.0.1:8915';
const output = '.local-logs/competition-management';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const results = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 950 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.request.get(origin + '/__fixture?mode=populated');
    const mainBefore = (await (await page.request.get(origin + '/api/site?siteId=fixture-site')).json()).data;
    await page.goto(origin + '/dashboard/leaderboard/competitions?board=fixture-site');
    await page.locator('#eventBoardCreate').click();
    await page.locator('#eventBoardName').fill('Managed challenge ' + width);
    const saved = async button => {
      await button.click();
      await page.locator('#eventBoardStatus').filter({ hasText: 'Competition saved.' }).waitFor();
    };
    await saved(page.locator('#eventBoardSave'));
    const id = new URL(page.url()).searchParams.get('competition');
    assert.ok(id && id !== 'new');
    await page.locator('[data-competition-tab="standings"]').click();
    await page.locator('#eventPlayerRows').getByText('No players yet', { exact: true }).waitFor();
    const add = async (name, points) => {
      await page.locator('#eventPlayerAdd').click();
      await page.locator('#eventPlayerName').fill(name);
      await page.locator('#eventPlayerPoints').fill(String(points));
      await page.locator('#eventPlayerForm').getByRole('button', { name: 'Save player' }).click();
      await page.locator('#eventPlayerForm').waitFor({ state: 'hidden' });
    };
    await add('Alex', 250); await add('Sam', 180); await add('Chris', 145);
    await page.getByRole('button', { name: 'Edit Chris', exact: true }).click();
    await page.locator('#eventPlayerPoints').fill('300');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: `${output}/${width}-edit-player.png`, fullPage: true });
    await page.locator('#eventPlayerForm').getByRole('button', { name: 'Save player' }).click();
    assert.equal(await page.locator('.competition-player strong').first().innerText(), 'Chris');
    assert.equal(await page.getByRole('button', { name: 'Edit Chris', exact: true }).evaluate(el => el === document.activeElement), true);
    await add('Taylor', 300);
    assert.deepEqual(await page.locator('.competition-rank').allTextContents(), ['#1', '#1', '#3', '#4']);
    await saved(page.locator('#eventStandingsSave'));
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: `${output}/${width}-standings.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#eventPlayerSearch').fill('Alex');
    assert.equal(await page.locator('.competition-player').count(), 1);
    await page.locator('#eventPlayerSearch').fill('');
    await page.locator('[data-competition-tab="overview"]').click();
    await page.locator('#eventBoardPublished').selectOption('published');
    await saved(page.locator('#eventBoardSave'));
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: `${output}/${width}-overview.png`, fullPage: true });
    const openPopup = async (control, expectedUrl) => {
      const opened = context.waitForEvent('page'); await control.click(); const popup = await opened;
      await popup.waitForLoadState(); assert.match(popup.url(), expectedUrl);
      for (const name of ['Chris', 'Taylor', 'Alex', 'Sam']) assert.match(await popup.locator('body').innerText(), new RegExp(name));
      assert.doesNotMatch(await popup.locator('body').innerText(), /Community member 1/);
      assert.deepEqual(await popup.locator('.yr-srow').evaluateAll(rows => rows.map(row => ({ name: row.querySelector('.yr-player-name').textContent, rank: Number(row.dataset.position), points: row.querySelector('.yr-srow-val').textContent.trim().replace(/^.*?:\s*/, '') }))), [
        { name: 'Chris', rank: 1, points: '300 pts' }, { name: 'Taylor', rank: 1, points: '300 pts' }, { name: 'Alex', rank: 3, points: '250 pts' }, { name: 'Sam', rank: 4, points: '180 pts' },
      ]);
      await popup.close();
    };
    await openPopup(page.locator('#eventBoardLink a'), new RegExp(`/polish-fixture/leaderboard\\?event=${id}`));
    await page.locator('#eventBoardPublished').selectOption('draft');
    await saved(page.locator('#eventBoardSave'));
    await openPopup(page.locator('#eventBoardLink button'), /dashboard\/preview\?board=fixture-site/);
    assert.equal((await (await page.request.get(origin + '/api/site/events?siteId=fixture-site')).json()).events.find(event => event.id === id).published, false);
    // Clean browser navigation retains the selected competition and subview.
    await page.locator('[data-competition-tab="standings"]').click();
    await page.goBack(); await page.locator('#eventBoardSettings').waitFor();
    await page.goForward(); await page.locator('#eventStandings').waitFor();
    // Reject dirty navigation, including browser Back and selected-site switch.
    await page.locator('#eventPlayerAdd').click(); await page.locator('#eventPlayerName').fill('Unfinished');
    await page.goBack();
    await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
    assert.equal(await page.locator('#eventPlayerName').inputValue(), 'Unfinished');
    await page.locator('#sidebarBoardSelect').selectOption('second-site');
    await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
    assert.equal(await page.locator('#sidebarBoardSelect').inputValue(), 'fixture-site');
    await page.locator('#eventBoardClose').click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
    assert.equal(await page.locator('#eventPlayerName').inputValue(), 'Unfinished');
    await page.locator('#eventPlayerCancel').click();
    assert.equal(await page.locator('#eventPlayerAdd').evaluate(el => el === document.activeElement), true);
    // Duplicate validation and secondary replace import.
    await page.locator('#eventPlayerAdd').click(); await page.locator('#eventPlayerName').fill('alex'); await page.locator('#eventPlayerPoints').fill('5');
    await page.locator('#eventPlayerForm').getByRole('button', { name: 'Save player' }).click();
    await page.locator('#eventPlayerError').filter({ hasText: 'unique name' }).waitFor();
    await page.locator('#eventPlayerCancel').click();
    await page.locator('#eventPlayerImport').click(); await page.locator('#eventBoardPlayers').fill('Import A, 8\nImport B, 15');
    await page.locator('#eventImportForm').getByRole('button', { name: 'Replace current standings' }).click();
    assert.deepEqual(await page.locator('.competition-player strong').allTextContents(), ['Import B', 'Import A']);
    await saved(page.locator('#eventStandingsSave'));
    // Another session updates the persisted version; the current draft must survive 409.
    const endpoint = origin + '/api/site/events?siteId=fixture-site';
    const latest = (await (await page.request.get(endpoint)).json()).events.find(event => event.id === id);
    await page.request.post(endpoint, { data: { ...latest, updatedAt: latest.updated_at, name: 'Other session' } });
    await page.locator('[data-competition-tab="overview"]').click();
    await page.locator('#eventBoardName').fill('My unsaved rename');
    await page.locator('#eventBoardSave').click();
    await page.locator('#eventBoardStatus').filter({ hasText: 'another window' }).waitFor();
    assert.equal(await page.locator('#eventBoardName').inputValue(), 'My unsaved rename');
    assert.equal(await page.locator('#eventBoardSave').isDisabled(), true);
    await page.locator('#eventBoardReload').click();
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await page.locator('#eventBoardEditorTitle').filter({ hasText: 'Other session' }).waitFor();
    await page.locator('#eventBoardClose').click();
    await page.locator('#eventBoardOverview').waitFor();
    assert.deepEqual((await (await page.request.get(origin + '/api/site?siteId=fixture-site')).json()).data, mainBefore);
    // Site switch closes management; both link types use the newly selected site.
    await page.locator('#sidebarBoardSelect').selectOption('second-site');
    await page.waitForURL(/(?:board|siteId)=second-site/);
    if (!await page.locator('#eventBoardCreate').isVisible()) {
      if (width === 390) await page.locator('#lbMenu').click();
      await page.locator('[data-nav="board"]').first().click();
      await page.locator('#editorTabs [data-egroup="competitions"]').click();
    }
    await page.locator('#eventBoardCreate').click();
    await page.locator('#eventBoardName').fill('Second site challenge');
    await saved(page.locator('#eventBoardSave'));
    await page.locator('#eventBoardPublished').selectOption('published'); await saved(page.locator('#eventBoardSave'));
    assert.match(await page.locator('#eventBoardLink a').getAttribute('href'), /^\/second-community\/leaderboard\?event=/);
    await page.locator('[data-competition-tab="standings"]').click();
    assert.equal(await page.locator('.competition-player').count(), 0);
    const secondId = new URL(page.url()).searchParams.get('competition');
    await page.locator('#eventBoardClose').click();
    await page.locator(`[data-event-delete="${secondId}"]`).click();
    await page.getByRole('button', { name: 'Delete competition', exact: true }).last().click();
    await page.locator(`[data-event-delete="${secondId}"]`).waitFor({ state: 'detached' });
    const cleanup = (await (await page.request.get(endpoint)).json()).events.find(event => event.id === id);
    await page.request.delete(endpoint, { data: { id, updatedAt: cleanup.updated_at } });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    results.push({ width, lifecycle: 'PASSED', rankingAndTies: 'PASSED', import: 'PASSED', conflict: 'PASSED', dirtyNavigation: 'PASSED', siteAndMainIsolation: 'PASSED', overflow: 'PASSED', consoleErrors: errors });
    await context.close();
  }
  await writeFile(output + '/results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
