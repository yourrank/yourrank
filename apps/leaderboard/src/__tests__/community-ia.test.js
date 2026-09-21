import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { DashboardContent } from '../pages/dashboard.jsx';
import { rankEventPlayers } from '@yourrank/shared/event-leaderboards';

function harness(fetchImpl) {
  const window = new Window({ url: 'https://test.com/dashboard/leaderboard/competitions?board=one' });
  const document = window.document;
  document.body.innerHTML = String(DashboardContent({ user: { email: 'test@example.test', plan: 'pro' }, activePath: '/dashboard/leaderboard/competitions' }));
  const state = { ACTIVE_SITE_ID: 'one', SLUG: 'community-one' };
  const source = readFileSync(new URL('../assets/dashboard/event-leaderboards.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export async function', 'async function');
  let guard;
  const load = new Function('state', '$', 'esc', 'getCsrf', 'showConfirmModal', 'registerNavigationGuard', 'rankEventPlayers', 'fetch', 'window', 'document', 'innerWidth',
    source + '\nreturn loadEventLeaderboards;')(
    state, id => document.getElementById(id),
    value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    () => 'csrf', async () => true, (_name, fn) => { guard = fn; }, rankEventPlayers,
    fetchImpl, window, document, 390,
  );
  return { window, document, state, load, guard: () => guard() };
}
const competition = { id: '11111111-1111-4111-8111-111111111111', name: 'Summer <Challenge>', published: true, players: [{ name: 'Alex', score: 42 }], updated_at: '2026-09-20T12:00:00Z' };
const response = events => Response.json({ ok: true, events });
describe('Community competition overview', () => {
  it('owns exactly five Community tabs with History beneath Standings and events outside Overview', () => {
    const h = harness(async () => response([]));
    expect([...h.document.querySelectorAll('#editorTabs a')].map(a => a.textContent)).toEqual(['Overview', 'Standings', 'Competitions', 'Appearance', 'Share']);
    expect(h.document.querySelector('#eventBoards').dataset.egroup).toBe('competitions');
    expect([...h.document.querySelectorAll('#standingsTabs a')].map(a => a.textContent)).toEqual(['Current', 'History']);
    expect(h.document.querySelector('.v3-players h1').textContent).toBe('Standings');
    h.window.close();
  });
  it('renders names safely, publication, player counts, timestamps and the existing public URL', async () => {
    const requests = [];
    const h = harness(async (url) => { requests.push(url); return response([competition, { ...competition, id: 'draft', name: 'Draft challenge', published: false, players: [] }]); });
    await h.load();
    expect(requests).toEqual(['/api/site/events?siteId=one']);
    const rows = h.document.querySelectorAll('.competition-row');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('h2').textContent).toBe(competition.name);
    expect(rows[0].querySelector('h2').children.length).toBe(0);
    expect(rows[0].textContent).toContain('Published');
    expect(rows[0].textContent).toContain('1 player');
    expect(rows[0].querySelector('time').dateTime).toBe('2026-09-20T12:00:00.000Z');
    expect(rows[0].querySelector('a').getAttribute('href')).toBe('/community-one/leaderboard?event=' + competition.id);
    expect(rows[1].textContent).toContain('Draft');
    expect(rows[1].querySelector('a')).toBeNull();
    expect(rows[1].querySelector('[data-event-preview]').textContent).toBe('Preview');
    expect(h.document.querySelector('#eventBoardEditor').hidden).toBe(true);
    h.window.close();
  });
  it('discards late responses from a previously selected site', async () => {
    let finishFirst;
    const h = harness(url => url.endsWith('one') ? new Promise(resolve => { finishFirst = resolve; }) : Promise.resolve(response([])));
    const first = h.load();
    h.state.ACTIVE_SITE_ID = 'two';
    await h.load();
    finishFirst(response([competition]));
    await first;
    expect(h.document.querySelectorAll('.competition-row').length).toBe(0);
    expect(h.document.querySelector('#eventBoardListStatus').textContent).toContain('No competitions yet');
    h.window.close();
  });
  it('clears old rows on load failure and recovers through the existing endpoint', async () => {
    let fail = false;
    const h = harness(async () => fail ? Response.json({ error: 'Unavailable' }, { status: 503 }) : response([competition]));
    await h.load();
    fail = true;
    await h.load();
    expect(h.document.querySelectorAll('.competition-row').length).toBe(0);
    expect(h.document.querySelector('#eventBoardListStatus').textContent).toBe('Unavailable');
    expect(h.document.querySelector('#eventBoardRetry').hidden).toBe(false);
    expect(h.document.querySelector('#eventBoardCreate').disabled).toBe(true);
    fail = false;
    await h.load();
    expect(h.document.querySelectorAll('.competition-row').length).toBe(1);
    expect(h.document.querySelector('#eventBoardRetry').hidden).toBe(true);
    h.window.close();
  });
});

