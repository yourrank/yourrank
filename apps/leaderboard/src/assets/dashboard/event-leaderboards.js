import { state } from './state.js';
import { $, esc, getCsrf, showConfirmModal } from './utils.js';
import { registerNavigationGuard } from './shell.js';
import { rankEventPlayers } from '@yourrank/shared/event-leaderboards';

let loadedEvents = [];
let selected = null;
let loadedSite = '';
let siteBrand = {};
let dirty = false;
let busy = false;
let loaded = false;
let requestVersion = 0;

async function discardChanges() {
  if (busy) return false;
  return !dirty || showConfirmModal('Discard competition changes?', 'Save this competition before leaving, or discard its unsaved changes.', 'Discard changes', true);
}
registerNavigationGuard('event-leaderboards', async () => {
  if (!await discardChanges()) return false;
  dirty = false;
  if ($('eventBoardEditor')) $('eventBoardEditor').hidden = true;
  return true;
});
async function api(method, body, siteId = loadedSite) {
  const response = await fetch(`/api/site/events?siteId=${encodeURIComponent(siteId)}`, {
    method, headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Could not load competitions. Try again.');
  return result;
}
function setBusy(value) {
  busy = value;
  $('eventBoardFields').disabled = value;
  $('eventBoardCreate').disabled = value || !loaded;
  $('eventBoardClose').disabled = value;
  $('eventBoardList').querySelectorAll('button').forEach(button => { button.disabled = value; });
}
function renderList() {
  $('eventBoardList').innerHTML = loadedEvents.map(event => {
    const updated = new Date(event.updated_at);
    const timestamp = Number.isFinite(updated.getTime())
      ? `<time datetime="${esc(updated.toISOString())}">Updated ${esc(updated.toLocaleString())}</time>`
      : '<span>Update time unavailable</span>';
    const publicLink = event.published && state.SLUG
      ? `<a class="btn" href="/${encodeURIComponent(state.SLUG)}/leaderboard?event=${encodeURIComponent(event.id)}" target="_blank" rel="noopener noreferrer">View leaderboard ↗</a>`
      : `<button class="btn" type="button" data-event-preview="${esc(event.id)}">Preview</button>`;
    return `<article class="competition-row"><div><h2>${esc(event.name)}</h2><div class="competition-meta"><span class="pill">${event.published ? 'Published' : 'Draft'}</span><span>${event.players.length} ${event.players.length === 1 ? 'player' : 'players'}</span>${timestamp}</div></div><div class="event-board-actions"><button class="btn" type="button" data-event-manage="${esc(event.id)}">Manage</button>${publicLink}<button class="btn btn--danger" type="button" data-event-delete="${esc(event.id)}" aria-label="Delete ${esc(event.name)}">Delete</button></div></article>`;
  }).join('');
  $('eventBoardListStatus').textContent = loadedEvents.length ? '' : 'No competitions yet. Create one with its own players and points.';
}
function openEvent(id = '') {
  selected = loadedEvents.find(event => event.id === id) || null;
  $('eventBoardName').value = selected?.name || '';
  $('eventBoardPlayers').value = (selected?.players || []).map(p => `${p.name}, ${p.score}`).join('\n');
  $('eventBoardPublished').checked = selected?.published === true;
  $('eventBoardDelete').hidden = !selected;
  $('eventBoardEditorTitle').textContent = selected ? 'Manage competition' : 'New competition';
  $('eventBoardStatus').textContent = '';
  $('eventBoardEditor').hidden = false;
  dirty = false;
  $('eventBoardName').focus();
}
function previewEvent(event) {
  // Reuse the authenticated renderer; this draft POST never saves or publishes.
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `/dashboard/preview?board=${encodeURIComponent(loadedSite)}&section=leaderboard&edit=0&device=${innerWidth < 700 ? 'mobile' : 'desktop'}`;
  form.target = '_blank';
  form.rel = 'noopener noreferrer';
  const draft = document.createElement('input');
  draft.type = 'hidden';
  draft.name = 'draft';
  draft.value = JSON.stringify({
    players: rankEventPlayers(event.players), playerCount: event.players.length,
    playerMatchCount: event.players.length, rankBy: 'score',
    eventId: event.id, eventName: event.name, eventUpdatedAt: event.updated_at,
    eventBoards: [{ id: event.id, name: event.name }],
    brand: { ...siteBrand, period: event.name, hidePrizeAmounts: true, prizePool: '' },
    endsAt: null, startsAt: null, scheduled: false, ended: false,
  });
  form.append(draft);
  document.body.append(form);
  form.submit();
  form.remove();
}
async function deleteEvent(event) {
  if (busy || !event || !await discardChanges()) return;
  const siteId = loadedSite;
  if (!await showConfirmModal('Delete competition?', `Delete ${event.name} and its points? Your main leaderboard is unchanged.`, 'Delete competition', true)) return;
  if (siteId !== loadedSite) return;
  setBusy(true);
  try {
    await api('DELETE', { id: event.id, updatedAt: event.updated_at }, siteId);
    dirty = false;
    if (await loadEventLeaderboards()) $('eventBoardListStatus').textContent = 'Competition deleted.';
  } catch (err) { $('eventBoardListStatus').textContent = err.message; }
  finally { setBusy(false); }
}
function wire(root) {
  if (root.dataset.wired) return;
  root.dataset.wired = 'true';
  root.addEventListener('input', event => { event.stopPropagation(); dirty = true; $('eventBoardStatus').textContent = 'Unsaved competition changes'; });
  root.addEventListener('change', event => event.stopPropagation());
  $('eventBoardRetry').addEventListener('click', () => loadEventLeaderboards());
  $('eventBoardCreate').addEventListener('click', async () => { if (await discardChanges()) openEvent(); });
  $('eventBoardClose').addEventListener('click', async () => {
    if (!await discardChanges()) return;
    dirty = false;
    $('eventBoardEditor').hidden = true;
    $('eventBoardCreate').focus();
  });
  $('eventBoardList').addEventListener('click', async event => {
    if (busy) return;
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.eventManage && await discardChanges()) openEvent(button.dataset.eventManage);
    if (button.dataset.eventDelete) await deleteEvent(loadedEvents.find(item => item.id === button.dataset.eventDelete));
    if (button.dataset.eventPreview) previewEvent(loadedEvents.find(item => item.id === button.dataset.eventPreview));
  });
  $('eventBoardDelete').addEventListener('click', () => deleteEvent(selected));
  $('eventBoardForm').addEventListener('submit', async event => {
    event.preventDefault(); event.stopPropagation();
    if (busy) return;
    const siteAtStart = loadedSite;
    const players = $('eventBoardPlayers').value.split('\n').filter(line => line.trim()).map(line => {
      const comma = line.lastIndexOf(',');
      const points = comma < 0 ? '' : line.slice(comma + 1).trim();
      return { name: comma < 0 ? line.trim() : line.slice(0, comma).trim(), score: points ? Number(points) : NaN };
    });
    if (players.some(p => !Number.isFinite(p.score))) { $('eventBoardStatus').textContent = 'Use one player per line: Player name, points'; return; }
    setBusy(true);
    try {
      await api('POST', { id: selected?.id, updatedAt: selected?.updated_at, name: $('eventBoardName').value.trim(), players, published: $('eventBoardPublished').checked }, siteAtStart);
      dirty = false;
      if (await loadEventLeaderboards()) $('eventBoardListStatus').textContent = 'Competition saved.';
    } catch (err) { $('eventBoardStatus').textContent = err.message; }
    finally { setBusy(false); }
  });
  window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
}
export async function loadEventLeaderboards(brand = siteBrand) {
  const root = $('eventBoards');
  if (!root || !state.ACTIVE_SITE_ID) return false;
  siteBrand = brand;
  loaded = false;
  wire(root);
  loadedSite = state.ACTIVE_SITE_ID;
  loadedEvents = [];
  selected = null;
  dirty = false;
  const version = ++requestVersion;
  $('eventBoardEditor').hidden = true;
  $('eventBoardList').innerHTML = '';
  $('eventBoardListStatus').textContent = 'Loading competitions…';
  $('eventBoardRetry').hidden = true;
  $('eventBoardCreate').disabled = true;
  root.setAttribute('aria-busy', 'true');
  try {
    const result = await api('GET');
    if (version !== requestVersion) return false;
    loadedEvents = result.events || [];
    loaded = true;
    renderList();
    $('eventBoardCreate').disabled = busy;
    return true;
  } catch (err) {
    if (version !== requestVersion) return false;
    $('eventBoardListStatus').textContent = err.message;
    $('eventBoardRetry').hidden = false;
    return false;
  } finally { if (version === requestVersion) root.removeAttribute('aria-busy'); }
}
