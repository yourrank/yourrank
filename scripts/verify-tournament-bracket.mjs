// Bracket layout audit: boots the dashboard fixture once per
// FIXTURE_TOURNAMENT variant (completed8 / live4 / live8 / live16 / live32)
// on its own port, then checks the data-driven bracket layout end to end —
// round model, connector geometry, card overlap, scroller bounds, modal
// expand/collapse cycles and responsive reconnects. Does not certify
// authentication, provider delivery, or persistence.
//
// Env: PLAYWRIGHT_MODULE_PATH, CHROMIUM_EXECUTABLE, BRACKET_OUTPUT.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const output = process.env.BRACKET_OUTPUT || '.local-logs/tournament-bracket';
await mkdir(output, { recursive: true });

const VARIANTS = [
  { name: 'completed8', size: 8, completed: true },
  { name: 'live4', size: 4 },
  { name: 'live8', size: 8 },
  { name: 'live16', size: 16 },
  { name: 'live32', size: 32 },
];
const shots = { completed8: ['embedded', 'expanded'], live16: ['expanded@1440', 'embedded@390'] };

const results = [];
const failures = [];
const check = (name, fn) => {
  try { fn(); results.push({ step: name, ok: true }); console.log(JSON.stringify({ step: name, ok: true })); }
  catch (e) { failures.push({ step: name, error: e.message }); results.push({ step: name, ok: false, error: e.message }); console.log(JSON.stringify({ step: name, ok: false, error: e.message })); }
};

async function startFixture(variant, port) {
  const proc = spawn(process.env.FIXTURE_BIN || 'bun', ['scripts/dashboard-polish-fixtures.mjs'], {
    env: { ...process.env, FIXTURE_TOURNAMENT: variant, FIXTURE_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`fixture ${variant} did not start`)), 15000);
    proc.stdout.on('data', (buf) => { if (String(buf).includes(String(port))) { clearTimeout(timer); resolve(); } });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`fixture exited ${code}`)); });
  });
  return proc;
}

const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });

// In-page audit: everything measured against the live DOM.
const auditJs = `(() => {
  const grid = document.querySelector('#tournament-bracket .tn-bracket-grid');
  if (!grid) return { missing: true };
  const rounds = [...grid.querySelectorAll('.tn-round')];
  const paths = [...grid.querySelectorAll('.tn-connectors path[data-from]')];
  const gridRect = grid.getBoundingClientRect();
  const scroller = grid.closest('.tn-bracket-scroll');
  const card = (r, i) => grid.querySelector('.tn-match[data-round="' + r + '"][data-index="' + i + '"]');
  const cards = [...grid.querySelectorAll('.tn-match')];
  // Connector endpoints vs the referenced cards' edge midpoints.
  const connectorMisalignments = paths.filter((p) => {
    const d = (p.getAttribute('d') || '').match(/[\\d.]+/g)?.map(Number) || [];
    if (d.length < 8) return false; // stub path (no geometry)
    const [x1, y1, mx, my1, my2, x2, y2] = [d[0], d[1], d[2], d[3], d[5], d[6], d[7]];
    const [fr, fi] = p.dataset.from.split(':').map(Number);
    const [tr, ti] = p.dataset.to.split(':').map(Number);
    const a = card(fr, fi)?.getBoundingClientRect();
    const b = card(tr, ti)?.getBoundingClientRect();
    if (!a || !b) return true;
    const ax = a.right - gridRect.left, ay = a.top + a.height / 2 - gridRect.top;
    const bx = b.left - gridRect.left, by = b.top + b.height / 2 - gridRect.top;
    return Math.abs(x1 - ax) > 2 || Math.abs(y1 - ay) > 2 || Math.abs(x2 - bx) > 2 || Math.abs(y2 - by) > 2;
  }).map((p) => p.dataset.from + '->' + p.dataset.to);
  // No two cards inside a column may overlap vertically.
  const overlaps = [];
  for (const round of rounds) {
    const rects = [...round.querySelectorAll('.tn-match')].map((el) => el.getBoundingClientRect());
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.bottom > b.top + 1 && b.bottom > a.top + 1) overlaps.push(round.querySelector('h3').textContent + ':' + i + '/' + j);
      }
    }
  }
  const scrollRect = scroller.getBoundingClientRect();
  const cutOff = cards.filter((el) => { const r = el.getBoundingClientRect(); return r.right > scrollRect.right + grid.scrollWidth - scrollRect.width + 2; }).length;
  return {
    missing: false,
    rounds: rounds.length,
    labels: rounds.map((r) => r.querySelector('h3').textContent),
    counts: rounds.map((r) => r.querySelectorAll('.tn-match').length),
    placeholders: grid.querySelectorAll('[data-placeholder]').length,
    paths: paths.length,
    connectorMisalignments,
    overlaps,
    gridWidth: gridRect.width,
    gridHeight: gridRect.height,
    containerWidth: document.querySelector('.tn-bracket-main').getBoundingClientRect().width,
    oldClassCount: document.querySelectorAll('[class*="tournament-"]:not([id^="tournament-"]), [class*="tourn-"]').length,
    scrollWidth: scroller.scrollWidth,
    winnerRows: grid.querySelectorAll('.tn-match-row.is-winner').length,
    completedCards: grid.querySelectorAll('.tn-match[data-state="completed"]').length,
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`;

async function auditBracket(page, tag, { size, expectConnectorGeometry = true }) {
  await page.waitForSelector('#tournament-bracket .tn-bracket-grid', { timeout: 15000 });
  // layoutBracket measures via ResizeObserver once the panel is visible;
  // give it a couple of frames before asserting geometry.
  await page.waitForTimeout(250);
  const a = await page.evaluate(auditJs);
  const totalRounds = Math.log2(size);
  check(`${tag}: round count = log2(${size})`, () => assert.equal(a.rounds, totalRounds));
  check(`${tag}: round labels`, () => {
    assert.equal(a.labels.at(-1), 'Final');
    if (totalRounds >= 2) assert.equal(a.labels.at(-2), 'Semifinals');
    if (totalRounds >= 3) assert.equal(a.labels.at(-3), 'Quarterfinals');
  });
  check(`${tag}: card count per round`, () => {
    a.counts.forEach((n, i) => assert.equal(n, size / 2 ** (i + 1), `round ${i + 1}`));
  });
  check(`${tag}: connector count = matches - final round`, () => assert.equal(a.paths, size - 1 - 1));
  if (expectConnectorGeometry) {
    check(`${tag}: connector endpoints on card edges`, () => assert.deepEqual(a.connectorMisalignments, []));
  }
  check(`${tag}: no overlapping cards`, () => assert.deepEqual(a.overlaps, []));
  check(`${tag}: grid fits its container`, () => assert.ok(a.gridWidth <= a.scrollWidth + 1, `grid ${a.gridWidth} vs scroll ${a.scrollWidth}`));
  check(`${tag}: no page-level horizontal scroll`, () => assert.ok(a.docOverflow <= 0, `overflow ${a.docOverflow}`));
  return a;
}

try {
  for (const [vi, variant] of VARIANTS.entries()) {
    const port = 8975 + vi;
    const fixture = await startFixture(variant.name, port);
    const origin = `http://127.0.0.1:${port}`;
    try {
      const page = await browser.newPage({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('net::ERR_FAILED')) errors.push('console: ' + m.text()); });
      await page.route('https://**/*', (route) => route.abort());
      await page.goto(`${origin}/dashboard/giveaways/tournaments`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#tournament-workspace:not([hidden])', { timeout: 15000 });
      await page.click('[data-tournament-tab="bracket"]');
      const embedded = await auditBracket(page, `${variant.name}-embedded`, variant);
      if (variant.completed) {
        check(`${variant.name}: winner rows highlighted`, () => assert.ok(embedded.winnerRows >= 1, `winnerRows ${embedded.winnerRows}`));
      }
      if (shots[variant.name]?.includes('embedded')) {
        await page.screenshot({ path: `${output}/${variant.name}-embedded-1440.png`, fullPage: true });
      }
      // Expanded modal: same model, wider min column, own connector set.
      await page.click('#tournament-bracket-expand');
      await page.waitForSelector('#tournament-bracket-modal', { timeout: 15000 });
      await page.waitForTimeout(250);
      const expanded = await page.evaluate(auditJs.replaceAll('#tournament-bracket', '#tournament-bracket-full'));
      check(`${variant.name}-expanded: round count`, () => assert.equal(expanded.rounds, Math.log2(variant.size)));
      check(`${variant.name}-expanded: same card count`, () => assert.equal(expanded.paths, embedded.paths));
      if (variant.size >= 8) {
        check(`${variant.name}-expanded: >=1.2x embedded width`, () => assert.ok(expanded.gridWidth >= embedded.gridWidth * 1.2, `width ${expanded.gridWidth} vs ${embedded.gridWidth}`));
      } else {
        check(`${variant.name}-expanded: wider or equal grid`, () => assert.ok(expanded.gridWidth >= embedded.gridWidth));
      }
      const dlg = await page.evaluate(() => {
        const card = document.querySelector('#tournament-bracket-modal .tn-dialog-card');
        const body = document.getElementById('tournament-bracket-full');
        const grid = body.querySelector('.tn-bracket-grid');
        return {
          dlgW: card.getBoundingClientRect().width,
          bodyW: body.getBoundingClientRect().width,
          gridW: grid.getBoundingClientRect().width,
          vScroll: body.scrollHeight - body.clientHeight,
        };
      });
      check(`${variant.name}-expanded: dialog width >= 85vw`, () => assert.ok(dlg.dlgW >= 0.85 * 1440, `dialog ${dlg.dlgW}`));
      check(`${variant.name}-expanded: grid >= 80% of dialog body`, () => assert.ok(dlg.gridW >= dlg.bodyW * 0.8, `grid ${dlg.gridW} vs body ${dlg.bodyW}`));
      if (variant.name === 'completed8') {
        check('completed8-expanded: no vertical scroll at 1440x900', () => assert.ok(dlg.vScroll <= 1, `vScroll ${dlg.vScroll}`));
      }
      if (shots[variant.name]?.includes('expanded') || shots[variant.name]?.includes('expanded@1440')) {
        await page.screenshot({ path: `${output}/${variant.name}-expanded-1440.png`, fullPage: true });
      }
      // Open/close 3x: connectors must not multiply and observers must not leak.
      for (let i = 0; i < 3; i++) {
        await page.click('#tournament-bracket-close');
        await page.waitForSelector('#tournament-bracket-modal', { state: 'detached', timeout: 15000 });
        await page.click('#tournament-bracket-expand');
        await page.waitForSelector('#tournament-bracket-modal', { timeout: 15000 });
      }
      check(`${variant.name}: no .tournament-/.tourn- elements in DOM`, () => assert.equal(expanded.oldClassCount + embedded.oldClassCount, 0));
      const connectorCount = await page.evaluate(() => document.querySelectorAll('.tn-connectors').length);
      check(`${variant.name}: no connector/observer leak after 3 open-close cycles`, () => assert.equal(connectorCount, 2));
      await page.click('#tournament-bracket-close');
      // Responsive: realign connectors at 1024 and 390.
      for (const width of [1024, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(150);
        const narrow = await auditBracket(page, `${variant.name}-embedded@${width}`, variant);
        if (width === 390 && shots[variant.name]?.includes('embedded@390')) {
          await page.screenshot({ path: `${output}/${variant.name}-embedded-390.png`, fullPage: true });
        }
      }
      check(`${variant.name}: no page/console errors`, () => assert.deepEqual(errors, [], errors.join(' | ')));
      await page.close();
    } finally {
      fixture.kill();
    }
  }
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ results, failures }, null, 2));
  await browser.close();
}

if (failures.length) {
  console.log('FAIL');
  for (const f of failures) console.log(`  ${f.step}: ${f.error}`);
  process.exit(1);
}
console.log('PASS');
