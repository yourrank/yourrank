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
    subnavCurrent: (document.querySelector('.gw-subnav [aria-current="page"]')?.getAttribute('href') || "").split('?')[0] || null,
    subnavPresent: !!document.querySelector('.gw-subnav'),
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
    // The workspace header h1 is the tournament title itself.
    assert.ok(s.h1.includes('Community tournament') || s.h1.includes('Tournaments'), `h1 ${s.h1}`);
    assert.equal(s.skeleton, false);
    assert.ok(s.tournamentWorkspace === true || s.tournamentEmpty === true, 'tournament pane hidden');
    assert.equal(s.tournamentTitle, 'Community tournament');
    assert.equal(s.modalLock, false);
  });
  const activityAssertions = (name) => expectState(name, (s) => {
    assert.ok(s.url.startsWith('/dashboard/activities'), s.url);
    assert.ok(s.h1.includes('Activities'), `h1 ${s.h1}`);
    assert.ok(s.activeNav.includes('activities'), `activeNav ${s.activeNav}`);
    assert.equal(s.actLoading, false);
    assert.equal(s.actError, false);
    assert.ok(s.actRows > 0, 'no activity rows');
    assert.equal(s.tournamentApp, false);
    assert.equal(s.engageCurrent, true);
    assert.equal(s.subnavPresent, false);
    assert.equal(s.skeleton, false);
    assert.equal(s.modalLock, false);
  });
  const ensureEngageExpanded = async () => {
    const toggle = '[data-nav-group="engage"] [data-toggle-nav-group]';
    if (await page.evaluate((sel) => document.querySelector(sel)?.getAttribute('aria-expanded') !== 'true', toggle)) {
      await page.click(toggle);
    }
  };
  const subtypeAssertions = (name, path) => expectState(name, (s) => {
    assert.equal(s.url.split('?')[0], path);
    assert.ok(s.activeNav.includes('giveaways'), `activeNav ${s.activeNav}`);
    assert.equal(s.engageCurrent, true);
    assert.equal(s.subnavPresent, true);
    assert.equal(s.subnavCurrent, path);
    assert.equal(s.skeleton, false);
    assert.equal(s.modalLock, false);
    assert.ok(s.h1.includes('Giveaways'), `h1 ${s.h1}`);
  });

  // 1-3. Home → Engage group → Tournaments via SPA navigation.
  await page.goto(origin + '/dashboard', { waitUntil: 'networkidle' });
  await snap('home');
  errors = [];
  await page.click('[data-nav-group="engage"] [data-toggle-nav-group], [data-toggle-nav-group]');
  await page.click('.lb-nav[href^="/dashboard/giveaways/tournaments"]');
  await page.waitForSelector('#tournament-workspace:not([hidden]), #tournament-empty:not([hidden])', { timeout: 15000 });
  await snap('tournaments');
  await tournamentAssertions('tournaments-first');
  await page.screenshot({ path: `${output}/tournaments.png`, fullPage: true });

  // 4. Tournaments → Activities: the Engage rail's Activities child is a
  // first-class destination, so this is one sidebar click.
  errors = [];
  await ensureEngageExpanded();
  await page.click('.lb-nav[href^="/dashboard/activities"]');
  await page.waitForFunction(() => document.getElementById('act-loading')?.hidden === true || document.getElementById('act-error')?.hidden === false, null, { timeout: 15000 });
  await activityAssertions('activities-after-tournaments');
  await page.screenshot({ path: `${output}/activities.png`, fullPage: true });
  expectNoErrors('activities');

  // 5. Back to Tournaments: re-init against fresh fragment DOM.
  errors = [];
  await page.click('.lb-nav[href^="/dashboard/giveaways/tournaments"]');
  await page.waitForSelector('#tournament-workspace:not([hidden]), #tournament-empty:not([hidden])', { timeout: 15000 });
  await tournamentAssertions('tournaments-reenter');
  expectNoErrors('tournaments-reenter');

  // 5b. Workspace tabs: Entries / Bracket / Settings panels swap in place,
  // the bracket renders real matches, and the read-only settings view shows.
  errors = [];
  for (const [tab, panel] of [['entries', 'tournament-panel-entries'], ['bracket', 'tournament-panel-bracket'], ['settings', 'tournament-panel-settings']]) {
    await page.click(`[data-tournament-tab="${tab}"]`);
    await page.waitForSelector(`#${panel}:not([hidden])`, { timeout: 15000 });
    await expectState(`tab-${tab}`, (s) => {
      assert.equal(s.skeleton, false);
      assert.equal(s.modalLock, false);
    });
    const active = await page.evaluate((t) => document.querySelector(`[data-tournament-tab="${t}"]`)?.classList.contains('is-active'), tab);
    check(`tab-${tab}: active class`, () => assert.equal(active, true));
  }
  await expectState('bracket-content', (s) => assert.ok(s.tournamentWorkspace, 'workspace hidden'));
  const bracketInfo = await page.evaluate(() => ({
    matches: document.querySelectorAll('#tournament-bracket .tn-match').length,
    rounds: [...document.querySelectorAll('#tournament-bracket .tn-round-head h3')].map((h) => h.textContent),
    connectors: document.querySelectorAll('#tournament-bracket .tn-connectors path[data-from]').length,
    settingsView: !document.getElementById('tournament-settings-view')?.hidden,
    entriesTab: document.getElementById('tournament-tab-entries')?.textContent.trim(),
  }));
  check('bracket: rounds + matches + entries count', () => {
    assert.ok(bracketInfo.matches >= 1, `matches ${bracketInfo.matches}`);
    assert.deepEqual(bracketInfo.rounds, ['Quarterfinals', 'Semifinals', 'Final']);
    assert.ok(bracketInfo.connectors >= 1, `connectors ${bracketInfo.connectors}`);
    assert.equal(bracketInfo.entriesTab, 'Entries (2)');
  });
  await page.click('[data-tournament-tab="settings"]');
  await page.waitForSelector('#tournament-panel-settings:not([hidden])', { timeout: 15000 });
  check('settings: read-only view for finished tournament', async () => assert.equal(
    await page.evaluate(() => !document.getElementById('tournament-settings-view').hidden && document.getElementById('tournament-settings-form').hidden), true));

  // 5c. No page-level horizontal overflow on the bracket tab at 1280 and 390.
  await page.click('[data-tournament-tab="bracket"]');
  await page.waitForSelector('#tournament-panel-bracket:not([hidden])', { timeout: 15000 });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`bracket: no page-level h-overflow at ${width}px`, () => assert.ok(overflow <= 0, `overflow ${overflow}px at ${width}`));
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  expectNoErrors('workspace-tabs');

  // 6. Route sweep without a document reload: the Engage hub is the rail's
  // Overview child; Giveaways subtypes switch through the page subnav.
  const sweeps = [
    ['giveaways-hub', '.lb-nav[href^="/dashboard/giveaways"]', '#engage-hub', (s) => {
      assert.equal(s.url.split('?')[0], '/dashboard/giveaways');
      assert.ok(s.activeNav.includes('overview'), `activeNav ${s.activeNav}`);
      assert.equal(s.engageCurrent, true);
      assert.ok(s.h1.includes('Engage'), `h1 ${s.h1}`);
      assert.equal(s.subnavPresent, false);
      assert.equal(s.skeleton, false);
    }],
    ['giveaways-chat', '.lb-nav[href^="/dashboard/giveaways/chat"]', '#pane-chat', (s) => {
      assert.equal(s.url.split('?')[0], '/dashboard/giveaways/chat');
      assert.ok(s.h1.length, 'no h1');
      assert.equal(s.subnavCurrent, '/dashboard/giveaways/chat');
      assert.equal(s.subnavPresent, true);
      assert.equal(s.skeleton, false);
      assert.equal(s.modalLock, false);
    }],
  ];
  for (const [name, sel, waitSel, assertFn] of sweeps) {
    errors = [];
    await ensureEngageExpanded();
    await page.click(sel);
    await page.waitForSelector(waitSel, { timeout: 15000 });
    await page.waitForTimeout(300);
    await expectState(name, assertFn);
    expectNoErrors(name);
  }

  // 6b. Giveaways subtype subnav: Chat Giveaway → Raffle → Prediction through
  // the page subnav, asserting rail child and subnav state on each.
  for (const [name, path] of [
    ['subtype-raffle', '/dashboard/giveaways/raffles'],
    ['subtype-prediction', '/dashboard/giveaways/predictions'],
    ['subtype-chat', '/dashboard/giveaways/chat'],
  ]) {
    errors = [];
    await page.click(`.gw-subnav a[href^="${path}"]`);
    await page.waitForSelector(`.gw-subnav a[aria-current="page"][href^="${path}"]`, { timeout: 15000 });
    await page.waitForTimeout(250);
    await subtypeAssertions(name, path);
    expectNoErrors(name);
  }
  // And back through the rail children: Tournaments → Activities → Giveaways.
  errors = [];
  await ensureEngageExpanded();
  await page.click('.lb-nav[href^="/dashboard/giveaways/tournaments"]');
  await page.waitForSelector('#tournament-workspace:not([hidden]), #tournament-empty:not([hidden])', { timeout: 15000 });
  await tournamentAssertions('rail-tournaments');
  errors = [];
  await ensureEngageExpanded();
  await page.click('.lb-nav[href^="/dashboard/activities"]');
  await page.waitForFunction(() => document.getElementById('act-loading')?.hidden === true || document.getElementById('act-error')?.hidden === false, null, { timeout: 15000 });
  await activityAssertions('rail-activities');
  errors = [];
  await ensureEngageExpanded();
  await page.click('.lb-nav[href^="/dashboard/giveaways/chat"]');
  await page.waitForSelector('.gw-subnav a[aria-current="page"][href^="/dashboard/giveaways/chat"]', { timeout: 15000 });
  await page.waitForTimeout(250);
  await subtypeAssertions('rail-giveaways', '/dashboard/giveaways/chat');
  errors = [];
  await page.click('.lb-nav[href^="/dashboard/giveaways/tournaments"]');
  await page.waitForSelector('#tournament-workspace:not([hidden]), #tournament-empty:not([hidden])', { timeout: 15000 });
  await tournamentAssertions('sweep-tournaments');

  errors = [];
  await ensureEngageExpanded();
  await page.click('.lb-nav[href^="/dashboard/activities"]');
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
  const deepLinks = [
    ['dl-giveaways', '/dashboard/giveaways', 'overview', null],
    ['dl-chat', '/dashboard/giveaways/chat', 'giveaways', '/dashboard/giveaways/chat'],
    ['dl-raffles', '/dashboard/giveaways/raffles', 'giveaways', '/dashboard/giveaways/raffles'],
    ['dl-predictions', '/dashboard/giveaways/predictions', 'giveaways', '/dashboard/giveaways/predictions'],
    ['dl-tournaments', '/dashboard/giveaways/tournaments', 'tournaments', null],
    ['dl-activities', '/dashboard/activities', 'activities', null],
    ['dl-rewards', '/dashboard/rewards', 'rewards', null],
    ['dl-members', '/dashboard/audience/members', 'audience', null],
    ['dl-account', '/dashboard/settings/account', 'settings', null],
  ];
  for (const [name, path, rail, subnav] of deepLinks) {
    errors = [];
    await page.goto(origin + path, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await expectState(name, (s) => {
      assert.ok(s.h1.length > 0, 'no visible h1');
      assert.equal(s.skeleton, false);
      assert.equal(s.modalLock, false);
      assert.ok(s.activeNav.includes(rail), `activeNav ${s.activeNav}`);
      if (subnav) assert.equal(s.subnavCurrent, subnav);
      if (path.startsWith('/dashboard/giveaways') || path.startsWith('/dashboard/activities')) {
        assert.equal(s.engageCurrent, true);
      }
      if (path.includes('tournaments')) assert.ok(s.tournamentWorkspace === true || s.tournamentEmpty === true, 'tournament pane hidden');
    });
    expectNoErrors(name);
  }

  // 8b. Giveaways subnav at 390px: no page-level horizontal overflow and the
  // active tab stays inside the viewport on direct load and reload.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/dashboard/giveaways/chat', '/dashboard/giveaways/raffles', '/dashboard/giveaways/predictions']) {
    errors = [];
    await page.goto(origin + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const mobile = await page.evaluate(() => {
      const current = document.querySelector('.gw-subnav [aria-current="page"]');
      const rect = current?.getBoundingClientRect();
      return {
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        hasSubnav: !!document.querySelector('.gw-subnav'),
        activeVisible: rect ? rect.left >= -1 && rect.right <= window.innerWidth + 1 : false,
      };
    });
    check(`mobile-390 ${path}`, () => {
      assert.equal(mobile.hasSubnav, true);
      assert.ok(mobile.docOverflow <= 0, `doc overflow ${mobile.docOverflow}px`);
      assert.ok(mobile.activeVisible, 'active subnav tab outside viewport');
    });
    expectNoErrors(`mobile-390 ${path}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // 9. Repeated switching: leave/enter cycles must not degrade.
  // The Engage group may be collapsed after deep links or full reloads;
  // expand it whenever the tournaments nav link isn't clickable.
  for (let i = 0; i < 3; i++) {
    errors = [];
    await ensureEngageExpanded();
    await page.click('.lb-nav[href^="/dashboard/giveaways/tournaments"]');
    await page.waitForSelector('#tournament-workspace:not([hidden]), #tournament-empty:not([hidden])', { timeout: 15000 });
    await tournamentAssertions(`cycle-${i}-tournaments`);
    await ensureEngageExpanded();
    await page.click('.lb-nav[href^="/dashboard/activities"]');
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
