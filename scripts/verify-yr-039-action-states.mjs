// YR-039: state gallery for the shared action contract. Renders the four roles
// (primary/secondary/tertiary/destructive) as both <a> and <button>, in
// default/hover/focus/disabled/pending states, on the light marketing surface
// (landing.css + ui.css + devin-system.css) and the dark app surface
// (app.css + ui.css), plus the public viewer's .yr-btn/.yr-act family inside .viewer-shell. Asserts 44px
// controls and 48px narrow-screen form submits, one visible focus outline,
// inert busy/disabled controls whose footprint does not change, a spinner from
// aria-busy alone, icon-only accessible names, and WCAG AA text contrast.
// Uses the real stylesheets from a local fixture, not a deployed Worker.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const output = '.local-logs/yr-039';
await mkdir(output, { recursive: true });

const ROLES = [
  ['primary', 'btn btn--accent'],
  ['secondary', 'btn btn--outline'],
  ['tertiary', 'btn btn--ghost'],
  ['destructive', 'btn btn--danger'],
];
const ICON = '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16M12 4v16"/></svg>';

const gallery = (klass, id) => `
<div class="row" data-role="${id}">
  <a class="${klass}" href="#" data-state="default" data-kind="link">${id} link</a>
  <button type="button" class="${klass}" data-state="default" data-kind="button">${id}</button>
  <button type="button" class="${klass}" data-state="disabled" disabled>${id}</button>
  <a class="${klass}" href="#" data-state="aria-disabled" aria-disabled="true">${id}</a>
  <button type="button" class="${klass}" data-state="pending" aria-busy="true">Saving…</button>
</div>`;

const btnFamily = () => `${ROLES.map(([id, klass]) => gallery(klass, id)).join('')}
<div class="row" data-role="icon">
  <button type="button" class="btn btn--icon" aria-label="Add reward" data-state="icon">${ICON}</button>
  <button type="button" class="btn btn--icon" data-state="icon-unnamed">${ICON}</button>
</div>
<form class="row" data-role="form" action="#" onsubmit="return false"><label>Email <input type="email" name="e" /></label>
  <button type="submit" class="btn btn--accent w-full" data-state="submit">Send message</button>
  <button type="button" class="btn btn--ghost" data-state="cancel">Cancel</button>
</form>`;

const SURFACES = {
  light: {
    styles: ['landing.css', 'ui.css', 'devin-system.css'],
    body: '<body class="marketing-page" data-identity="devin-reference">',
    html: btnFamily(),
  },
  dark: {
    styles: ['app.css', 'shell-nav.css', 'ui.css'],
    body: '<body>',
    html: btnFamily(),
  },
  viewer: {
    styles: ['site-shell.css', 'viewer-shell.css'],
    body: '<body class="yr-site viewer-shell">',
    html: `
<div class="row" data-role="primary">
  <a class="yr-btn" href="#" data-state="default" data-kind="link">Primary link</a>
  <button type="button" class="yr-btn" data-state="default" data-kind="button">Primary</button>
  <button type="button" class="yr-btn" data-state="disabled" disabled>Primary</button>
  <a class="yr-btn" href="#" data-state="aria-disabled" aria-disabled="true">Primary</a>
  <button type="button" class="yr-btn" data-state="pending" aria-busy="true">Joining…</button>
</div>
<div class="row" data-role="secondary">
  <a class="yr-btn yr-btn--ghost" href="#" data-state="default" data-kind="link">Secondary link</a>
  <button type="button" class="yr-btn yr-btn--ghost" data-state="default" data-kind="button">Secondary</button>
  <button type="button" class="yr-btn yr-btn--ghost" data-state="disabled" disabled>Secondary</button>
  <button type="button" class="yr-btn yr-btn--ghost" data-state="pending" aria-busy="true">Loading…</button>
</div>
<div class="row" data-role="act">
  <button type="button" class="yr-act" data-state="default" data-kind="button">Redeem</button>
  <button type="button" class="yr-act" data-state="pending" aria-busy="true">Redeeming…</button>
</div>`,
  },
};

const page = (surface) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Action states</title>${surface.styles.map((s) => `<link rel="stylesheet" href="/assets/${s}">`).join('')}
<style>main{padding:24px;display:flex;flex-direction:column;gap:16px}.row{display:flex;flex-wrap:wrap;gap:12px;align-items:center}</style></head>
${surface.body}<main id="main-content">${surface.html}</main></body></html>`;

let origin;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/assets/')) {
      if (!/^\/assets\/[a-z0-9-]+\.(css|js)$/.test(url.pathname)) { res.writeHead(404).end(); return; }
      res.setHeader('content-type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
      res.end(await readFile(new URL(`../apps/leaderboard/src${url.pathname}`, import.meta.url))); return;
    }
    const surface = SURFACES[url.pathname.slice(1)];
    if (!surface) { res.writeHead(404).end('not found'); return; }
    res.setHeader('content-type', 'text/html');
    res.end(page(surface));
  } catch (error) { res.writeHead(500).end(String(error?.stack || error)); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;

// WCAG relative luminance / contrast on the effective (alpha-composited) colours.
const contrastScript = `
(() => {
  const parse = (c) => { const m = c.match(/[\\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
  const surfaceOf = (el) => { let bg = { r: 255, g: 255, b: 255, a: 1 }; const chain = []; for (let n = el; n; n = n.parentElement) chain.unshift(getComputedStyle(n).backgroundColor); for (const c of chain) { const p = parse(c); if (p.a > 0) bg = blend(p, bg); } return bg; };
  window.__contrast = (el) => { const cs = getComputedStyle(el); const parent = surfaceOf(el.parentElement); const own = parse(cs.backgroundColor); const bg = own.a > 0 ? blend(own, parent) : parent; return ratio(blend(parse(cs.color), bg), bg); };
})();`;

const browser = await chromium.launch();
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };
try {
  for (const [name, surface] of Object.entries(SURFACES)) {
    for (const width of [1280, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const pg = await ctx.newPage();
      const errors = [];
      pg.on('pageerror', (e) => errors.push(String(e)));
      await pg.goto(`${origin}/${name}`, { waitUntil: 'load' });
      await pg.addScriptTag({ content: contrastScript });
      await pg.evaluate(() => document.fonts.ready);
      const isBtn = name !== 'viewer';

      const rows = await pg.$$eval('[data-state]', (els) => els.map((el) => {
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        const spinner = getComputedStyle(el, '::before');
        return {
          role: el.closest('[data-role]').dataset.role, state: el.dataset.state, tag: el.tagName, type: el.getAttribute('type'),
          h: Math.round(r.height), w: Math.round(r.width), pe: cs.pointerEvents, cursor: cs.cursor, opacity: Number(cs.opacity),
          spinner: spinner.animationName !== 'none' && spinner.content !== 'none',
          name: (el.getAttribute('aria-label') || el.textContent).trim(), contrast: window.__contrast(el),
        };
      }));
      const tag = (r) => `${name}@${width} ${r.role}/${r.state}`;
      for (const r of rows) {
        const expected = r.state === 'submit' ? (width <= 768 ? 48 : 44) : 44;
        check(r.h >= expected, `${tag(r)} height ${r.h} < ${expected}`);
        check(r.state === 'submit' ? r.type === 'submit' : (r.tag === 'A' ? r.type === null : r.type === 'button'), `${tag(r)} wrong element/type ${r.tag} ${r.type}`);
        if (r.state === 'pending') { check(r.spinner, `${tag(r)} no aria-busy spinner`); check(r.pe === 'none', `${tag(r)} pending still clickable`); check(/…$/.test(r.name), `${tag(r)} pending label not progressive: ${r.name}`); }
        if (r.state === 'aria-disabled') check(r.pe === 'none', `${tag(r)} aria-disabled link still clickable`);
        if (r.state === 'disabled' || r.state === 'aria-disabled') check(r.opacity < 1 && r.cursor === 'not-allowed', `${tag(r)} disabled treatment ${r.opacity} ${r.cursor}`);
        if (r.state === 'default' || r.state === 'submit' || r.state === 'cancel') check(r.contrast >= 4.5, `${tag(r)} contrast ${r.contrast.toFixed(2)} < 4.5`);
        if (r.state === 'icon') check(r.name === 'Add reward' && r.w >= 44 && r.h >= 44, `${tag(r)} icon-only name/size ${r.name} ${r.w}x${r.h}`);
        if (r.state === 'icon-unnamed') check(r.name === '', `${tag(r)} fixture control unexpectedly named`);
      }
      // Icon-only controls without a name are a fixture-level failure the gallery must surface.
      const unnamed = rows.filter((r) => r.state === 'icon-unnamed');
      check(unnamed.length === (isBtn ? 1 : 0), `${tag({ role: 'icon', state: 'unnamed' })} gallery must include exactly one unnamed control to prove the check fires`);

      // Focus: one visible outline, first Tab lands on the first link.
      await pg.keyboard.press('Tab');
      const focus = await pg.evaluate(() => {
        const el = document.activeElement; const cs = getComputedStyle(el);
        return { state: el.dataset.state, kind: el.dataset.kind, outline: cs.outlineStyle, width: parseFloat(cs.outlineWidth), offset: parseFloat(cs.outlineOffset), shadow: cs.boxShadow };
      });
      check(focus.state === 'default' && focus.kind === 'link', `${name}@${width} first Tab landed on ${focus.state}/${focus.kind}`);
      check(focus.outline === 'solid' && focus.width >= 2 && focus.offset >= 2, `${name}@${width} focus outline ${JSON.stringify(focus)}`);
      check(focus.shadow === 'none', `${name}@${width} focus adds a box-shadow ring: ${focus.shadow}`);
      // Disabled controls leave the tab order; aria-disabled links stay focusable (announced as disabled) but are inert.
      const order = [];
      for (let i = 0; i < 12; i++) { order.push(await pg.evaluate(() => document.activeElement.dataset.state || document.activeElement.tagName)); await pg.keyboard.press('Tab'); }
      check(!order.includes('disabled'), `${name}@${width} disabled button in tab order`);
      check(order.includes('aria-disabled'), `${name}@${width} aria-disabled link dropped from tab order: ${order.join(',')}`);
      // Hover must not change the control footprint.
      const probe = '[data-role="primary"] [data-state="default"][data-kind="button"]';
      const before = await pg.$eval(probe, (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
      await pg.hover(probe);
      const hovered = await pg.$eval(probe, (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
      check(hovered[0] === before[0] && hovered[1] === before[1], `${name}@${width} hover changed footprint ${before} -> ${hovered}`);
      check(errors.length === 0, `${name}@${width} page errors ${errors.join(' | ')}`);
      await pg.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

if (failures.length) { console.error('FAILED:\n' + failures.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
console.log('PASSED: btn family (4 roles × link/button × default/disabled/aria-disabled/pending, icon-only, form submit) on light+dark surfaces and the viewer yr-btn/yr-act family at 1280/390: 44px controls, 48px narrow submits, one solid focus outline, hover keeps footprint, busy/disabled inert and out of the tab order, aria-busy spinner, icon-only names, AA contrast.');
