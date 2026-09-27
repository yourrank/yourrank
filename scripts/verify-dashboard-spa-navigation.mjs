// SPA navigation audit: exercises the persistent-shell dynamic section loader
// (fragment fetch, boot owners, enter/leave lifecycle) against
// scripts/dashboard-polish-fixtures.mjs. Does not certify authentication,
// provider delivery, or persistence.
//
// Env: POLISH_ORIGIN (fixture origin), PLAYWRIGHT_MODULE_PATH,
// CHROMIUM_EXECUTABLE, SPA_NAV_OUTPUT.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const origin = process.env.POLISH_ORIGIN || 'http://127.0.0.1:8915';
const output = process.env.SPA_NAV_OUTPUT || '.local-logs/dashboard-spa-navigation';
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const results = [];
const failures = [];

const record = async (name, page, extra = {}) => {
  const state = await page.evaluate(() => ({
    url: location.pathname + location.search,
    activeNav: [...document.querySelectorAll('.lb-nav.is-on')].map((n) => n.dataset.nav),
    h1: [...document.querySelectorAll('h1')].filter((e) => e.getClientRects().length).map((e) => e.textContent.trim()),
    skeleton: !!document.querySelector('#lbDynamic .lb-dynamic-loading'),
    dynHidden: document.getElementById('lbDynamic')?.hidden ?? null,
    modalLock: document.documentElement.classList.contains('yr-modal-open'),
  }));
  return { name, ...state, ...extra };
};

try {
  const page = await browser.newPage({ colorScheme: 'dark' });
  let errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('net::ERR_FAILED')) errors.push('console: ' + m.text());
  });
  // External calls (Kick CDNs, sockets) are unreachable in the fixture.
  await page.route('https://**/*', (route) => route.abort());

  const check = (name, fn) => {
    try { fn(); results.push({ step: name, ok: true }); console.log(JSON.stringify({ step: name, ok: true })); }
    catch (e) { failures.push({ step: name, error: e.message }); results.push({ step: name, ok: false, error: e.message }); console.log(JSON.stringify({ step: name, ok: false, error: e.message })); }
  };
  const snap = async (name) => {
    const s = await record(name, page);
    results.push(s);
    console.log(JSON.stringify(s));
    return s;
  };
  const expectNoErrors = (name) => check(`${name}: no page/console errors`, () => assert.deepEqual(errors, [], errors.join(' | ')));
  // Assertions read a full snapshot of shell + section state per step.
  const evalState = () => page.evaluate(() => ({
    url: location.pathname + location.search,
    activeNav: [...document.querySelectorAll('.lb-nav.is-on')].map((n) => n.dataset.nav),
    h1: [...document.querySelectorAll('h1')].filter((e) => e.getClientRects().length).map((e) => e.textContent.trim()),
    skeleton: !!document.querySelector('#lbDynamic .lb-dynamic-loading'),
    dynHidden: document.getElementById('lbDynamic')?.hidden ?? null,
    dynEmpty: !document.getElementById('lbDynamic')?.innerHTML.trim(),
    modalLock: document.documentElement.classList.contains('yr-modal-open'),
    tournamentApp: !!document.getElementById('tournament-app'),
    engageCurrent: !!document.querySelector('[data-nav-group="engage"][data-current-group]'),
    actLoading: document.getElementById('act-loading') ? !document.getElementById('act-loading').hidden : null,
    actError: document.getElementById('act-error') ? !document.getElementById('act-error').hidden : null,
    actRows: document.querySelectorAll('#act-list .act-row, .act-row').length,
    tournamentTitle: document.getElementById('tournament-title-display')?.textContent.trim() || null,
    tournamentWorkspace: document.getElementById('tournament-workspace') ? !document.getElementById('tournament-workspace').hidden : null,
    tournamentEmpty: document.getElementById('tournament-empty') ? !document.getElementById('tournament-empty').hidden : null,
    crDash: !!document.getElementById('cr-app'),
  }));

  const expectState = async (name, predicate) => {
    const s = await evalState();
    try { predicate(s); results.push({ step: name, ok: true, state: s }); console.log(JSON.stringify({ step: name, ok: true, state: s })); }
    catch (e) { failures.push({ step: name, error: e.message, state: s }); results.push({ step: name, ok: false, error: e.message, state: s }); console.log(JSON.stringify({ step: name, ok: false, error: e.message, state: s })); }
    return s;
  };
  const tournamentAssertions = (name) => expectState(name, (s) => {
    assert.equal(s.url.split('?')[0], '/dashboard/giveaways/tournaments');
    assert.ok(s.activeNav.includes('tournaments'), `activeNav ${s.activeNav}`);
    assert.ok(s.h1.includes('Tournaments'), `h1 ${s.h1}`);
    assert.equal(s.skeleton, false);
    assert.ok(s.tournamentWorkspace === true || s.tournamentEmpty === true, 'tournament pane hidden');
    assert.equal(s.tournamentTitle, 'Community Cup');
    assert.equal(s.modalLock, false);
  });
  const activityAssertions = (name) => expectState(name, (s) => {
    assert.ok(s.url.startsWith('/dashboard/activities'), s.url);
    assert.ok(s.h1.includes('Activities'), `h1 ${s.h1}`);
    assert.equal(s.actLoading, false);
    assert.equal(s.actError, false);
    assert.ok(s.actRows > 0, 'no activity rows');
    assert.equal(s.tournamentApp, false);
    assert.equal(s.engageCurrent, true);
    assert.equal(s.skeleton, false);
    assert.equal(s.modalLock, false);
  });

  // 1-3. Home → Engage group → Tournaments via SPA navigation.
  await page.goto(origin + '/dashboard', { waitUntil: 'networkidle' });
  await snap('home');
  errors = [];
  await page.click('[data-nav-group="engage"] [data-toggle-nav-group], [data-toggle-nav-group]');
  await page.click('.lb-nav[href="/dashboard/giveaways/tournaments"]');
  await page.waitForSelector('#tournament-workspace:not([hidden]), #tournament-empty:not([hidden])', { timeout: 15000 });
  await snap('tournaments');
  await tournamentAssertions('tournaments-first');
  await page.screenshot({ path: `${output}/tournaments.png`, fullPage: true });

  // 4. Tournaments → Activities through the fragment's own engage tabs.
  errors = [];
  await page.click('#lbDynamic a[href^="/dashboard/activities"]');
  await page.waitForFunction(() => document.getElementById('act-loading')?.hidden === true || document.getElementById('act-error')?.hidden === false, null, { timeout: 15000 });
  await activityAssertions('activities-after-tournaments');
  await page.screenshot({ path: `${output}/activities.png`, fullPage: true });
  expectNoErrors('activities');

  // 5. Back to Tournaments: re-init against fresh fragment DOM.
  errors = [];
  await page.click('.lb-nav[href="/dashboard/giveaways/tournaments"]');
  await page.waitForSelector('#tournament-workspace:not([hidden]), #tournament-empty:not([hidden])', { timeout: 15000 });
  await tournamentAssertions('tournaments-reenter');
  expectNoErrors('tournaments-reenter');

  // 6. Route sweep without a document reload.
  const sweeps = [
    ['giveaways-hub', '#lbDynamic a[href="/dashboard/giveaways"], .lb-nav[href="/dashboard/giveaways"]', '#engage-hub', (s) => {
      assert.equal(s.url.split('?')[0], '/dashboard/giveaways');
      assert.ok(s.h1.length, 'no h1');
      assert.equal(s.skeleton, false);
    }],
    ['giveaways-chat', '.lb-nav[href="/dashboard/giveaways/chat"]', '#pane-chat', (s) => {
      assert.equal(s.url.split('?')[0], '/dashboard/giveaways/chat');
      assert.ok(s.h1.length, 'no h1');
      assert.equal(s.skeleton, false);
      assert.equal(s.modalLock, false);
    }],
  ];
  for (const [name, sel, waitSel, assertFn] of sweeps) {
    errors = [];
    await page.click(sel);
    await page.waitForSelector(waitSel, { timeout: 15000 });
    await page.waitForTimeout(300);
    await expectState(name, assertFn);
    expectNoErrors(name);
  }
  errors = [];
  await page.click('.lb-nav[href="/dashboard/giveaways/tournaments"]');
  await page.waitForSelector('#tournament-workspace:not([hidden]), #tournament-empty:not([hidden])', { timeout: 15000 });
  await tournamentAssertions('sweep-tournaments');

  errors = [];
  await page.click('#lbDynamic a[href^="/dashboard/activities"], .lb-nav[href^="/dashboard/activities"]');
  await page.waitForFunction(() => document.getElementById('act-loading')?.hidden === true || document.getElementById('act-error')?.hidden === false, null, { timeout: 15000 });
  await activityAssertions('sweep-activities');

  errors = [];
  await page.click('.lb-nav[href^="/dashboard/rewards"]');
  await page.waitForFunction(() => document.getElementById('cr-app') && !document.getElementById('cr-app').hidden, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await expectState('rewards', (s) => {
    assert.equal(s.url.split('?')[0], '/dashboard/rewards');
    assert.ok(s.h1.some((h) => /rewards|overview/i.test(h)), `h1 ${s.h1}`);
    assert.equal(s.crDash, true);
    assert.equal(s.skeleton, false);
    assert.equal(s.modalLock, false);
  });
  expectNoErrors('rewards');

  errors = [];
  await page.click('.lb-nav[href^="/dashboard/analytics"]');
  await page.waitForTimeout(600);
  await expectState('insights', (s) => {
    assert.ok(s.url.startsWith('/dashboard/analytics'), s.url);
    assert.ok(s.h1.includes('Insights'), `h1 ${s.h1}`);
    // Insights is a core SPA section: the dynamic region is dismounted.
    assert.equal(s.dynHidden, true);
    assert.equal(s.dynEmpty, true);
    assert.equal(s.modalLock, false);
  });
  expectNoErrors('insights');
  await page.screenshot({ path: `${output}/insights.png`, fullPage: true });

  // 7. History traversal stays inside the app.
  errors = [];
  await page.goBack({ waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(500);
  await expectState('back-1', (s) => {
    assert.ok(s.url.startsWith('/dashboard/rewards'), s.url);
    assert.ok(s.h1.some((h) => /rewards|overview/i.test(h)), `h1 ${s.h1}`);
  });
  await page.goBack({ waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(500);
  await expectState('back-2', (s) => {
    assert.ok(s.url.startsWith('/dashboard/activities'), s.url);
    assert.ok(s.h1.includes('Activities'), `h1 ${s.h1}`);
  });
  await page.goForward().catch(() => {});
  await page.waitForTimeout(400);
  const fwd1 = await evalState();
  await page.goForward().catch(() => {});
  await page.waitForTimeout(400);
  const fwd2 = await evalState();
  check('history: back/forward lands on visited routes', () => {
    assert.ok(fwd1.url.startsWith('/dashboard/rewards'), fwd1.url);
    assert.ok(fwd2.url.startsWith('/dashboard/analytics'), fwd2.url);
  });

  // 8. Deep links + refresh: every route boots standalone.
  for (const [name, path] of [
    ['dl-giveaways', '/dashboard/giveaways'],
    ['dl-chat', '/dashboard/giveaways/chat'],
    ['dl-tournaments', '/dashboard/giveaways/tournaments'],
    ['dl-activities', '/dashboard/activities'],
    ['dl-rewards', '/dashboard/rewards'],
    ['dl-members', '/dashboard/audience/members'],
    ['dl-account', '/dashboard/settings/account'],
  ]) {
    errors = [];
    await page.goto(origin + path, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await expectState(name, (s) => {
      assert.ok(s.h1.length > 0, 'no visible h1');
      assert.equal(s.skeleton, false);
      assert.equal(s.modalLock, false);
      if (path.includes('tournaments')) assert.ok(s.tournamentWorkspace === true || s.tournamentEmpty === true, 'tournament pane hidden');
    });
    expectNoErrors(name);
  }

  // 9. Repeated switching: leave/enter cycles must not degrade.
  // The Engage group may be collapsed after deep links or full reloads;
  // expand it whenever the tournaments nav link isn't clickable.
  const engageToggle = '[data-nav-group="engage"] [data-toggle-nav-group]';
  for (let i = 0; i < 3; i++) {
    errors = [];
    if (await page.evaluate((sel) => document.querySelector(sel)?.getAttribute('aria-expanded') !== 'true', engageToggle)) {
      await page.click(engageToggle);
    }
    await page.click('.lb-nav[href="/dashboard/giveaways/tournaments"]');
    await page.waitForSelector('#tournament-workspace:not([hidden]), #tournament-empty:not([hidden])', { timeout: 15000 });
    await tournamentAssertions(`cycle-${i}-tournaments`);
    await page.click('.engage-tabs a[href^="/dashboard/activities"], #lbDynamic a[href^="/dashboard/activities"]');
    await page.waitForFunction(() => document.getElementById('act-loading')?.hidden === true || document.getElementById('act-error')?.hidden === false, null, { timeout: 15000 });
    await activityAssertions(`cycle-${i}-activities`);
    expectNoErrors(`cycle-${i}`);
  }
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ results, failures }, null, 2));
  await browser.close();
}
console.log(failures.length ? `FAIL ${failures.length} step(s)` : 'PASS');
if (failures.length) process.exitCode = 1;
