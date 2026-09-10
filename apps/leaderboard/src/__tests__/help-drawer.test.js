import { describe, it, expect, mock } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/dashboard/help-drawer.js', import.meta.url), 'utf8').replace("import '../dialog.js';", '');
function harness() {
  const nodes = new Map();
  let doc;
  const element = () => ({
    hidden: false, disabled: false, value: '', children: [], events: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    appendChild(child) { this.children.push(child); },
    addEventListener(type, handler) { this.events[type] = handler; },
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() { doc.activeElement = this; },
    reset: mock(() => {}),
  });
  const opener = element();
  doc = { activeElement: opener, cookie: '', body: element(), createElement: element, addEventListener() {} };
  const release = mock(() => { doc.activeElement = opener; });
  const trap = mock((layer) => { doc.activeElement = layer; return release; });
  let deliver;
  const fetch = mock(async (url) => url === '/api/auth/me'
    ? { ok: true, json: async () => ({ user: { email: 'creator@example.com' } }) }
    : new Promise(resolve => { deliver = resolve; }));
  const win = { YRDialog: { trap } };
  const timers = mock(() => {});
  new Function('window', 'document', 'fetch', 'location', 'setTimeout', source)(win, doc, fetch, { pathname: '/dashboard/site', search: '' }, timers);
  return { api: win.YRHelpDrawer, nodes, doc, opener, release, trap, fetch, timers,
    deliver: () => deliver({ ok: true, json: async () => ({ ok: true }) }) };
}
describe('help drawer lifecycle', () => {
  it('shares one focus trap and releases it on close, including rapid reopen', () => {
    const h = harness();
    h.api.open('support');
    h.api.open('feedback');
    expect(h.trap).toHaveBeenCalledTimes(1);
    h.api.close();
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.doc.activeElement).toBe(h.opener);
    h.api.open('support');
    expect(h.trap).toHaveBeenCalledTimes(2);
    expect(h.timers).not.toHaveBeenCalled();
    h.api.close();
  });
  for (const kind of ['support', 'feedback']) {
    it(`preserves new ${kind} edits while the previous message is being sent`, async () => {
      const h = harness();
      h.api.open(kind);
      await new Promise(resolve => setImmediate(resolve));
      const message = h.nodes.get(`#yr_${kind}_message`);
      message.value = 'The first message to send';
      const form = h.nodes.get(kind === 'support' ? '#yrSupportForm' : '#yrFeedbackForm');
      if (kind === 'support') form.querySelector('#yr_support_subject').value = 'Site issue';
      const pending = form.events.submit({ preventDefault() {} });
      // Resolve the cached account lookup before checking the pending POST.
      await new Promise(resolve => setImmediate(resolve));
      expect(h.fetch.mock.calls.at(-1)[0]).toBe('/api/contact');
      expect(JSON.parse(h.fetch.mock.calls.at(-1)[1].body).context).toBe('dashboard');
      message.value = 'Newer unsent message';
      h.deliver();
      await pending;
      expect(message.value).toBe('Newer unsent message');
      expect(form.reset).not.toHaveBeenCalled();
      expect(h.nodes.get(`#yr_${kind}_submit`).disabled).toBe(false);
      expect(h.nodes.get(`#yr_${kind}_success`).querySelector('p').textContent).toContain('have not been sent');
      expect(h.timers).not.toHaveBeenCalled();
    });
  }
});
