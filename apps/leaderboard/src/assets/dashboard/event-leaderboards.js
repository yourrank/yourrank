import { state } from './state.js';
import { $, esc, getCsrf, showConfirmModal } from './utils.js';
import { registerNavigationGuard } from './shell.js';

let loadedEvents = [];
let selected = null;
let loadedSite = '';
let dirty = false;
let requestVersion = 0;
registerNavigationGuard('event-leaderboards', async () => {
  if (!dirty) return true;
  if (!await showConfirmModal('Discard event changes?', 'Save this event before leaving, or discard its unsaved changes.', 'Discard changes', true)) return false;
  openEvent(selected?.id);
  return true;
});
const path = () => `/api/site/events?siteId=${encodeURIComponent(loadedSite)}`;
async function api(method, body) {
  const response = await fetch(path(), { method, headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf() }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Could not load event leaderboards.');
  return result;
}
function openEvent(id = '') {
  selected = loadedEvents.find(event => event.id === id) || null;
  $('eventBoardSelect').value = selected?.id || '';
  $('eventBoardName').value = selected?.name || '';
  $('eventBoardPlayers').value = (selected?.players || []).map(p => `${p.name}, ${p.score}`).join('\n');
  $('eventBoardPublished').checked = selected?.published === true;
  $('eventBoardDelete').hidden = !selected;
  $('eventBoardStatus').textContent = selected ? 'Edit this event, then save its changes.' : 'Create an event with its own players and points.';
  dirty = false;
}
export async function loadEventLeaderboards() {
  const root = $('eventBoards');
  if (!root || !state.ACTIVE_SITE_ID) return;
  loadedSite = state.ACTIVE_SITE_ID;
  const version = ++requestVersion;
  $('eventBoardStatus').textContent = 'Loading event leaderboards…';
  $('eventBoardSave').disabled = true;
  try {
    const result = await api('GET');
    if (version !== requestVersion) return;
    loadedEvents = result.events || [];
    $('eventBoardSelect').innerHTML = '<option value="">Create event…</option>' + loadedEvents.map(event => `<option value="${esc(event.id)}">${esc(event.name)}${event.published ? '' : ' (draft)'}</option>`).join('');
    openEvent();
    $('eventBoardSave').disabled = false;
  } catch (err) { if (version === requestVersion) $('eventBoardStatus').textContent = err.message; }
  if (root.dataset.wired) return;
  root.dataset.wired = 'true';
  root.addEventListener('input', event => { event.stopPropagation(); if (event.target.id === 'eventBoardSelect') return; dirty = true; $('eventBoardStatus').textContent = 'Unsaved event changes'; });
  root.addEventListener('change', event => event.stopPropagation());
  $('eventBoardSelect').addEventListener('change', async () => {
    const id = $('eventBoardSelect').value;
    if (dirty && !await showConfirmModal('Discard event changes?', 'The current event has unsaved changes.', 'Discard changes', true)) { $('eventBoardSelect').value = selected?.id || ''; return; }
    openEvent(id);
  });
  $('eventBoardForm').addEventListener('submit', async event => {
    event.preventDefault(); event.stopPropagation();
    const siteAtStart = loadedSite;
    const players = $('eventBoardPlayers').value.split('\n').filter(line => line.trim()).map(line => {
      const comma = line.lastIndexOf(',');
      const points = comma < 0 ? '' : line.slice(comma + 1).trim();
      return { name: comma < 0 ? line.trim() : line.slice(0, comma).trim(), score: points ? Number(points) : NaN };
    });
    if (players.some(p => !Number.isFinite(p.score))) { $('eventBoardStatus').textContent = 'Use one player per line: Player name, points'; return; }
    $('eventBoardSave').disabled = true;
    try {
      const result = await api('POST', { id: selected?.id, updatedAt: selected?.updated_at, name: $('eventBoardName').value.trim(), players, published: $('eventBoardPublished').checked });
      if (siteAtStart !== loadedSite) return;
      await loadEventLeaderboards(); openEvent(result.id);
      $('eventBoardStatus').textContent = selected?.published ? 'Event saved. Visible in your public leaderboard switcher when this site is published.' : 'Event draft saved. It is hidden from viewers.';
    } catch (err) { $('eventBoardStatus').textContent = err.message; }
    finally { $('eventBoardSave').disabled = false; }
  });
  $('eventBoardDelete').addEventListener('click', async () => {
    if (!selected || !await showConfirmModal('Delete event leaderboard?', `Delete ${selected.name} and its points? Your main leaderboard is unchanged.`, 'Delete event', true)) return;
    try { await api('DELETE', { id: selected.id, updatedAt: selected.updated_at }); await loadEventLeaderboards(); $('eventBoardStatus').textContent = 'Event deleted.'; }
    catch (err) { $('eventBoardStatus').textContent = err.message; }
  });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
}
