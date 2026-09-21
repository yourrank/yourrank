import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { DashboardContent } from '../pages/dashboard.jsx';
import { rankEventPlayers, validateEventPlayers } from '@yourrank/shared/event-leaderboards';

function harness(fetchImpl) {
  const window = new Window({ url: 'https://test.com/dashboard/leaderboard/competitions?board=one' });
  const document = window.document;
  document.body.innerHTML = String(DashboardContent({ user: { email: 'test@example.test', plan: 'pro' }, activePath: '/dashboard/leaderboard/competitions' }));
  const state = { ACTIVE_SITE_ID: 'one', SLUG: 'community-one' };
  const source = readFileSync(new URL('../assets/dashboard/event-leaderboards.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export async function', 'async function');
  let guard;
  let confirm = true;
  let prompts = 0;
  const navigate = async (_page, _tab, { query }) => {
    if (!await guard()) return false;
    window.history.pushState({}, '', '/dashboard/leaderboard/competitions?' + query);
    document.dispatchEvent(new window.CustomEvent('yr:dashboard-route'));
    return true;
  };
  const load = new Function('state', '$', 'esc', 'getCsrf', 'showConfirmModal', 'registerNavigationGuard', 'rankEventPlayers', 'validateEventPlayers', 'requestDashboardRoute', 'location', 'fetch', 'window', 'document', 'innerWidth',
    source + '\nreturn loadEventLeaderboards;')(
    state, id => document.getElementById(id),
    value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    () => 'csrf', async () => { prompts++; return confirm; }, (_name, fn) => { guard = fn; }, rankEventPlayers, validateEventPlayers, navigate, window.location,
    fetchImpl, window, document, 390,
  );
  return { window, document, state, load, guard: () => guard(), setConfirm: value => { confirm = value; }, prompts: () => prompts,
    click: async selector => { document.querySelector(selector).click(); await new Promise(resolve => setTimeout(resolve, 0)); },
    input: (id, value) => { document.getElementById(id).value = value; document.getElementById(id).dispatchEvent(new window.Event('input', { bubbles: true })); },
    submit: async id => { document.getElementById(id).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 0)); },
  };
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


function workspace({ limit = 5, rejectSave = false } = {}) {
  let events = [{ ...competition, players: [{ name: 'Alex', score: 20 }, { name: 'Sam', score: 10 }, { name: 'Chris', score: 20 }] }];
  const writes = [];
  const h = harness(async (url, options) => {
    if (options.method === 'GET') return Response.json({ ok: true, events, playerLimit: limit });
    const body = JSON.parse(options.body);
    writes.push({ url, body, method: options.method });
    if (rejectSave) return Response.json({ error: 'stale' }, { status: 409 });
    if (options.method === 'DELETE') events = [];
    else events = [{ ...body, id: body.id || competition.id, updated_at: '2026-09-21T12:00:00Z' }];
    return Response.json({ ok: true, id: competition.id });
  });
  h.state.PLAYERS = [{ name: 'Main player', score: 123 }];
  return { ...h, writes, events: () => events,
    open: async () => { await h.load(); await h.click('[data-event-manage]'); },
    standings: () => h.click('[data-competition-tab="standings"]'),
    player: async (name, points) => { await h.click('#eventPlayerAdd'); h.input('eventPlayerName', name); h.input('eventPlayerPoints', points); await h.submit('eventPlayerForm'); },
  };
}
describe('Competition management workspace', () => {
  it('opens settings, renames, unpublishes and deletes while preserving players and timestamp', async () => {
    const h = workspace(); await h.open();
    expect(h.document.getElementById('eventBoardEditorTitle').textContent).toBe(competition.name);
    expect(h.document.getElementById('eventBoardPublished').value).toBe('published');
    h.input('eventBoardName', 'Renamed challenge'); h.input('eventBoardPublished', 'draft');
    await h.submit('eventBoardForm');
    expect(h.writes[0].body.updatedAt).toBe(competition.updated_at);
    expect(h.writes[0].body.players.length).toBe(3);
    expect(h.writes[0].body.published).toBe(false);
    expect(h.events()[0].name).toBe('Renamed challenge');
    expect(h.document.getElementById('eventBoardLink').textContent).toBe('Preview');
    await h.click('#eventBoardDelete');
    expect(h.writes[1].method).toBe('DELETE');
    expect(h.writes[1].body.updatedAt).toBe('2026-09-21T12:00:00Z');
    expect(h.document.getElementById('eventBoardEditor').hidden).toBe(true);
    h.window.close();
  });
  it('ranks through shared tie behavior, adds, edits, searches and removes without modifying Main', async () => {
    const h = workspace(); await h.open(); await h.standings();
    const ranks = () => [...h.document.querySelectorAll('.competition-rank')].map(row => row.textContent);
    expect(ranks()).toEqual(['#1', '#1', '#3']);
    await h.player('Taylor', '30');
    expect(ranks()).toEqual(['#1', '#2', '#2', '#4']);
    expect(h.document.getElementById('eventBoardSummary').textContent).toContain('4 players');
    await h.click('[data-player-edit="Sam"]'); h.input('eventPlayerPoints', '40'); await h.submit('eventPlayerForm');
    expect(h.document.querySelector('.competition-player strong').textContent).toBe('Sam');
    expect(h.document.activeElement.dataset.playerEdit).toBe('Sam');
    h.input('eventPlayerSearch', 'tay');
    expect(h.document.querySelectorAll('.competition-player').length).toBe(1);
    await h.click('[data-player-remove="Taylor"]');
    h.input('eventPlayerSearch', '');
    await h.click('#eventStandingsSave');
    expect(h.writes[0].body.players.find(player => player.name === 'Sam').score).toBe(40);
    expect(h.writes[0].url).toBe('/api/site/events?siteId=one');
    expect(h.state.PLAYERS).toEqual([{ name: 'Main player', score: 123 }]);
    expect(h.state._dirty).toBeUndefined();
    h.window.close();
  });
  it('rejects duplicate, invalid, missing, overlong and over-limit players without dropping the form', async () => {
    const h = workspace({ limit: 3 }); await h.open(); await h.standings();
    await h.player('Fourth', '5');
    expect(h.document.getElementById('eventPlayerError').textContent).toContain('at most 3');
    await h.click('#eventPlayerCancel');
    await h.click('[data-player-edit="Sam"]');
    h.input('eventPlayerName', 'alex'); await h.submit('eventPlayerForm');
    expect(h.document.getElementById('eventPlayerError').textContent).toContain('unique name');
    for (const name of ['', 'x'.repeat(81)]) {
      h.input('eventPlayerName', name); await h.submit('eventPlayerForm');
      expect(h.document.getElementById('eventPlayerError').textContent).toContain('unique name');
    }
    h.input('eventPlayerName', 'Sam');
    for (const score of ['', '-1', '1000000000001']) {
      h.input('eventPlayerPoints', score); await h.submit('eventPlayerForm');
      expect(h.document.getElementById('eventPlayerError').textContent).toContain('Points must');
    }
    expect(h.writes.length).toBe(0);
    h.window.close();
  });
  it('imports replace-only standings with validation and shared ranking', async () => {
    const h = workspace(); await h.open(); await h.standings(); await h.click('#eventPlayerImport');
    for (const text of ['Invalid row', 'Alex, 2\nalex, 3', 'Alex, -2']) {
      h.input('eventBoardPlayers', text); await h.submit('eventImportForm');
      expect(h.document.getElementById('eventImportError').textContent.length).toBeGreaterThan(0);
      expect(h.document.querySelectorAll('.competition-player').length).toBe(3);
    }
    h.input('eventBoardPlayers', 'New, 12\nOther, 30'); await h.submit('eventImportForm');
    expect([...h.document.querySelectorAll('.competition-player strong')].map(row => row.textContent)).toEqual(['Other', 'New']);
    await h.click('#eventStandingsSave');
    expect(h.writes[0].body.players).toEqual([{ name: 'New', score: 12 }, { name: 'Other', score: 30 }]);
    h.window.close();
  });
  it('keeps unsaved settings and unfinished player forms on canceled navigation, without prompting for search', async () => {
    const h = workspace(); await h.open();
    h.setConfirm(false); h.input('eventBoardName', 'Unsaved'); await h.standings();
    expect(h.document.getElementById('eventBoardSettings').hidden).toBe(false);
    expect(h.document.getElementById('eventBoardName').value).toBe('Unsaved');
    h.setConfirm(true); await h.standings();
    expect(h.document.getElementById('eventBoardName').value).toBe(competition.name);
    const prompts = h.prompts();
    await h.click('[data-player-edit="Alex"]'); await h.submit('eventPlayerForm');
    expect(await h.guard()).toBe(true); expect(h.prompts()).toBe(prompts);
    h.input('eventPlayerSearch', 'Alex'); expect(await h.guard()).toBe(true); expect(h.prompts()).toBe(prompts);
    await h.click('#eventPlayerAdd'); h.input('eventPlayerName', 'Unfinished'); h.setConfirm(false);
    expect(await h.guard()).toBe(false);
    await h.click('#eventBoardClose'); expect(h.document.getElementById('eventBoardEditor').hidden).toBe(false);
    await h.click('#eventPlayerCancel'); expect(h.document.activeElement.id).toBe('eventPlayerAdd');
    h.window.close();
  });
  it('preserves edits on 409 and prevents repeated overwrite attempts', async () => {
    const h = workspace({ rejectSave: true }); await h.open();
    h.input('eventBoardName', 'My changes'); await h.submit('eventBoardForm');
    expect(h.document.getElementById('eventBoardName').value).toBe('My changes');
    expect(h.document.getElementById('eventBoardStatus').textContent).toContain('another window');
    expect(h.document.getElementById('eventBoardSave').disabled).toBe(true);
    expect(h.document.getElementById('eventBoardReload').hidden).toBe(false);
    await h.submit('eventBoardForm'); expect(h.writes.length).toBe(1);
    h.window.close();
  });
  it('shows an empty state and does not apply a late mutation to another site', async () => {
    let finish;
    const h = harness(async (url, options) => {
      if (options.method === 'POST') return new Promise(resolve => { finish = resolve; });
      return response(url.endsWith('one') ? [{ ...competition, players: [] }] : []);
    });
    await h.load(); await h.click('[data-event-manage]'); await h.click('[data-competition-tab="standings"]');
    expect(h.document.getElementById('eventPlayerRows').textContent).toContain('No players yet');
    await h.click('#eventStandingsSave');
    h.state.ACTIVE_SITE_ID = 'two'; await h.load();
    finish(Response.json({ ok: true, id: competition.id })); await new Promise(resolve => setTimeout(resolve, 0));
    expect(h.document.getElementById('eventBoardEditor').hidden).toBe(true);
    expect(h.document.querySelectorAll('.competition-player').length).toBe(0);
    expect(h.document.querySelectorAll('.competition-row').length).toBe(0);
    h.window.close();
  });
});

it('does not repeat a creation after a successful save whose timestamp refresh failed', async () => {
  let saved = false, failRefresh = true, posts = 0;
  const h = harness(async (_url, options) => {
    if (options.method === 'POST') { posts++; saved = true; return Response.json({ ok: true, id: competition.id }); }
    if (saved && failRefresh) return Response.json({ error: 'Unavailable' }, { status: 503 });
    return response(saved ? [{ ...competition, name: 'Created', players: [] }] : []);
  });
  await h.load(); await h.click('#eventBoardCreate');
  expect(h.document.querySelector('[data-competition-tab="standings"]').disabled).toBe(true);
  h.input('eventBoardName', 'Created'); await h.submit('eventBoardForm');
  expect(h.document.getElementById('eventBoardStatus').textContent).toContain('Competition saved, but');
  expect(h.document.getElementById('eventBoardSave').disabled).toBe(true);
  await h.submit('eventBoardForm'); expect(posts).toBe(1);
  failRefresh = false; await h.click('#eventBoardReload');
  expect(h.document.getElementById('eventBoardEditorTitle').textContent).toBe('Created');
  expect(h.document.getElementById('eventBoardSave').disabled).toBe(false);
  h.window.close();
});

it('leaves standalone dashboard documents without a competition editor navigable', async () => {
  const h = harness(async () => response([]));
  h.document.getElementById('eventBoards').remove();
  expect(await h.guard()).toBe(true);
  expect(await h.load()).toBe(false);
  h.window.close();
});
