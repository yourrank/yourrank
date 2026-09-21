import { state } from './state.js';
import { $, esc, getCsrf, showConfirmModal } from './utils.js';
import { registerNavigationGuard, requestDashboardRoute } from './shell.js';
import { rankEventPlayers, validateEventPlayers } from '@yourrank/shared/event-leaderboards';

let loadedEvents = [];
let selected = null;
let players = [];
let loadedSite = '';
let siteBrand = {};
let playerLimit = Infinity;
let busy = false;
let loaded = false;
let requestVersion = 0;
let editingName = null;
let entrySnapshot = '';
let entryTrigger = null;
let conflict = false;
let savedAwaitingReload = null;

const snapshot = value => JSON.stringify({ name: value.name, published: value.published, players: rankEventPlayers(value.players).map(({ name, score }) => ({ name, score })) });
const draft = () => ({ name: $('eventBoardName').value.trim(), published: $('eventBoardPublished').value === 'published', players });
function entryValue() {
  if (!$('eventPlayerForm').hidden) return JSON.stringify([$('eventPlayerName').value, $('eventPlayerPoints').value]);
  if (!$('eventImportForm').hidden) return $('eventBoardPlayers').value;
  return '';
}
function isDirty() {
  if (!$('eventBoardEditor') || $('eventBoardEditor').hidden) return false;
  return (snapshot(draft()) !== snapshot(selected || { name: '', published: false, players: [] }) || entryValue() !== entrySnapshot);
}
function status(message, error = false) {
  $('eventBoardStatus').textContent = message;
  $('eventBoardStatus').classList.toggle('field-err', error);
}
async function discardChanges() {
  if (!$('eventBoardEditor')) return true;
  if (busy) return false;
  if (isDirty() && !await showConfirmModal('Discard competition changes?', 'Save this competition before leaving, or discard its unsaved changes.', 'Discard changes', true)) return false;
  if (selected || !$('eventBoardEditor').hidden) fillEditor(selected);
  return true;
}
registerNavigationGuard('event-leaderboards', discardChanges);
async function api(method, body, siteId = loadedSite) {
  const response = await fetch(`/api/site/events?siteId=${encodeURIComponent(siteId)}`, {
    method, headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    const error = new Error(response.status === 409 ? 'This competition changed in another window. Your edits are still here. Reload the saved competition before making further changes.' : result.error || 'Could not load competitions. Try again.');
    error.status = response.status;
    throw error;
  }
  return result;
}
function setBusy(value) {
  busy = value;
  $('eventBoards').querySelectorAll('button, input, select, textarea').forEach(control => { control.disabled = value; });
  $('eventBoardCreate').disabled = value || !loaded;
  $('eventBoardSave').disabled = value || conflict;
  $('eventStandingsSave').disabled = value || conflict;
  $('eventBoardDelete').disabled = value || conflict;
  $('eventBoardEditor').querySelector('[data-competition-tab="standings"]').disabled = value || !selected;
  $('eventBoards').setAttribute('aria-busy', String(value));
}
function updatedLabel(event) {
  const updated = new Date(event?.updated_at);
  return Number.isFinite(updated.getTime()) ? updated.toLocaleString() : 'Not saved yet';
}
function eventLink(event) {
  return event.published && state.SLUG
    ? `<a class="btn" href="/${encodeURIComponent(state.SLUG)}/leaderboard?event=${encodeURIComponent(event.id)}" target="_blank" rel="noopener noreferrer">View leaderboard ↗</a>`
    : `<button class="btn" type="button" data-event-preview="${esc(event.id)}">Preview</button>`;
}
function renderList() {
  $('eventBoardList').innerHTML = loadedEvents.map(event => {
    const date = new Date(event.updated_at);
    const timestamp = Number.isFinite(date.getTime()) ? `<time datetime="${esc(date.toISOString())}">Updated ${esc(updatedLabel(event))}</time>` : '<span>Update time unavailable</span>';
    return `<article class="competition-row"><div><h2>${esc(event.name)}</h2><div class="competition-meta"><span class="pill">${event.published ? 'Published' : 'Draft'}</span><span>${event.players.length} ${event.players.length === 1 ? 'player' : 'players'}</span>${timestamp}</div></div><div class="event-board-actions"><button class="btn" type="button" data-event-manage="${esc(event.id)}">Manage</button>${eventLink(event)}<button class="btn btn--danger" type="button" data-event-delete="${esc(event.id)}" aria-label="Delete ${esc(event.name)}">Delete</button></div></article>`;
  }).join('');
  $('eventBoardListStatus').textContent = loadedEvents.length ? '' : 'No competitions yet. Create one with its own players and points.';
}
function closeEntry({ restoreFocus = true } = {}) {
  $('eventPlayerForm').hidden = true;
  $('eventImportForm').hidden = true;
  entrySnapshot = '';
  if (restoreFocus) {
    const trigger = entryTrigger?.isConnected ? entryTrigger : $('eventPlayerAdd');
    trigger.focus();
  }
}
function fillEditor(event) {
  selected = event;
  players = (event?.players || []).map(player => ({ ...player }));
  $('eventBoardName').value = event?.name || '';
  $('eventBoardPublished').value = event?.published ? 'published' : 'draft';
  $('eventBoardEditorTitle').textContent = event?.name || 'New competition';
  $('eventBoardSummary').textContent = `${event?.published ? 'Published' : 'Draft'} · ${players.length} ${players.length === 1 ? 'player' : 'players'}`;
  $('eventBoardCount').textContent = String(players.length);
  $('eventBoardUpdated').textContent = updatedLabel(event);
  $('eventBoardLink').innerHTML = event ? eventLink(event) : '';
  $('eventBoardDanger').hidden = !event;
  $('eventBoardNewHint').hidden = Boolean(event);
  $('eventBoardSave').textContent = event ? 'Save changes' : 'Create competition';
  $('eventPlayerSearch').value = '';
  conflict = false;
  savedAwaitingReload = null;
  $('eventBoardReload').hidden = true;
  closeEntry({ restoreFocus: false });
  status('');
  renderPlayers();
  setBusy(busy);
}
function renderPlayers() {
  $('eventBoardSummary').textContent = `${selected?.published ? 'Published' : 'Draft'} · ${players.length} ${players.length === 1 ? 'player' : 'players'}`;
  const query = $('eventPlayerSearch').value.trim().toLocaleLowerCase('en-US');
  const rows = rankEventPlayers(players).filter(player => player.name.toLocaleLowerCase('en-US').includes(query));
  $('eventPlayerCount').textContent = query ? `${rows.length} of ${players.length} players` : `${players.length} ${players.length === 1 ? 'player' : 'players'}`;
  $('eventBoardCount').textContent = String(players.length);
  $('eventPlayerRows').innerHTML = !players.length
    ? '<div class="competition-empty"><h3>No players yet</h3><p>Add the first player or import a list.</p></div>'
    : !rows.length ? '<p>No players match your search.</p>'
      : '<div class="competition-player-head" aria-hidden="true"><span>#</span><span>Player</span><span>Points</span><span>Actions</span></div>' + rows.map(player => `<div class="competition-player" role="listitem"><span class="competition-rank" aria-label="Rank ${player.rank}">#${player.rank}</span><strong>${esc(player.name)}</strong><span class="competition-points" aria-label="${esc(String(player.score))} points">${esc(String(player.score))}<span class="competition-points-label"> points</span></span><div class="event-board-actions"><button class="btn" type="button" data-player-edit="${esc(player.name)}" aria-label="Edit ${esc(player.name)}">Edit</button><button class="btn btn--danger" type="button" data-player-remove="${esc(player.name)}" aria-label="Remove ${esc(player.name)}">Remove</button></div></div>`).join('');
}
async function navigate(id = '', tab = 'overview', options = {}) {
  const params = new URLSearchParams(location.search);
  params.set('board', loadedSite);
  params.delete('competition'); params.delete('competitionTab');
  if (id) { params.set('competition', id); params.set('competitionTab', tab); }
  return requestDashboardRoute('board', 'competitions', { query: params.toString(), ...options });
}
function renderRoute({ focus = true } = {}) {
  if (!loaded || loadedSite !== state.ACTIVE_SITE_ID) return;
  if (!location.pathname.endsWith('/competitions')) {
    $('eventBoardEditor').hidden = true;
    $('eventBoardOverview').hidden = false;
    return;
  }
  const params = new URLSearchParams(location.search);
  const id = params.get('competition');
  const event = loadedEvents.find(item => item.id === id);
  const manage = id === 'new' || Boolean(event);
  $('eventBoardEditor').hidden = !manage;
  $('eventBoardOverview').hidden = manage;
  if (!manage) {
    selected = null;
    if (id) $('eventBoardListStatus').textContent = 'This competition is no longer available for this site.';
    if (focus) $('eventBoardCreate').focus();
    return;
  }
  fillEditor(event || null);
  const tab = event && params.get('competitionTab') === 'standings' ? 'standings' : 'overview';
  $('eventBoardSettings').hidden = tab !== 'overview';
  $('eventStandings').hidden = tab !== 'standings';
  $('eventBoardEditor').querySelectorAll('[data-competition-tab]').forEach(button => {
    if (button.dataset.competitionTab === tab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (focus) $('eventBoardEditorTitle').focus({ preventScroll: true });
}
function previewEvent(event) {
  if (!event || loadedSite !== state.ACTIVE_SITE_ID) return;
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `/dashboard/preview?board=${encodeURIComponent(loadedSite)}&section=leaderboard&edit=0&device=${innerWidth < 700 ? 'mobile' : 'desktop'}`;
  form.target = '_blank'; form.rel = 'noopener noreferrer';
  const input = document.createElement('input');
  input.type = 'hidden'; input.name = 'draft';
  input.value = JSON.stringify({ players: rankEventPlayers(event.players), playerCount: event.players.length, playerMatchCount: event.players.length, rankBy: 'score', eventId: event.id, eventName: event.name, eventUpdatedAt: event.updated_at, eventBoards: [{ id: event.id, name: event.name }], brand: { ...siteBrand, period: event.name, hidePrizeAmounts: true, prizePool: '' }, endsAt: null, startsAt: null, scheduled: false, ended: false });
  form.append(input); document.body.append(form); form.submit(); form.remove();
}
function currentRequest(version, site) { return version === requestVersion && loadedSite === site && state.ACTIVE_SITE_ID === site; }
function mutationError(error) {
  status(error.message, true);
  if (error.status === 409) { conflict = true; $('eventBoardReload').hidden = false; }
}
async function saveCompetition() {
  if (busy || conflict || loadedSite !== state.ACTIVE_SITE_ID) return;
  if (!$('eventPlayerForm').hidden || !$('eventImportForm').hidden) { status('Finish or cancel the open player form before saving.', true); return; }
  const value = draft();
  if (!value.name || value.name.length > 80) { status('Enter a competition name of at most 80 characters.', true); $('eventBoardName').focus(); return; }
  try { value.players = validateEventPlayers(value.players, playerLimit); } catch (error) { status(error.message, true); return; }
  const site = loadedSite, version = requestVersion;
  setBusy(true); status('Saving competition…');
  try {
    const result = await api('POST', { ...value, id: selected?.id, updatedAt: selected?.updated_at }, site);
    if (!currentRequest(version, site)) return;
    savedAwaitingReload = result.id;
    // Re-read the server timestamp before enabling any subsequent mutation.
    const fresh = await api('GET', undefined, site);
    if (!currentRequest(version, site)) return;
    loadedEvents = fresh.events;
    playerLimit = fresh.playerLimit ?? playerLimit;
    renderList();
    fillEditor(loadedEvents.find(event => event.id === result.id));
    setBusy(false);
    await navigate(result.id, new URLSearchParams(location.search).get('competitionTab') || 'overview', { replace: true });
    status('Competition saved.');
  } catch (error) {
    if (!currentRequest(version, site)) return;
    if (savedAwaitingReload) {
      conflict = true;
      status('Competition saved, but its latest version could not be loaded. Reload the saved competition before editing again.', true);
    } else mutationError(error);
    $('eventBoardReload').hidden = false;
  } finally { if (currentRequest(version, site)) setBusy(false); }
}
async function deleteEvent(event) {
  if (busy || conflict || !event || !await discardChanges()) return;
  const site = loadedSite, version = requestVersion;
  if (!await showConfirmModal('Delete competition?', `Delete ${event.name} and its points? Your main leaderboard is unchanged.`, 'Delete competition', true)) return;
  if (!currentRequest(version, site)) return;
  setBusy(true);
  try {
    await api('DELETE', { id: event.id, updatedAt: event.updated_at }, site);
    if (!currentRequest(version, site)) return;
    loadedEvents = loadedEvents.filter(item => item.id !== event.id);
    fillEditor(null); $('eventBoardEditor').hidden = true;
    renderList(); setBusy(false);
    await navigate();
    $('eventBoardListStatus').textContent = 'Competition deleted.';
  } catch (error) {
    if (!currentRequest(version, site)) return;
    if ($('eventBoardEditor').hidden) { $('eventBoardListStatus').textContent = error.message; $('eventBoardRetry').hidden = false; }
    else mutationError(error);
  } finally { if (currentRequest(version, site)) setBusy(false); }
}
async function openEntry(kind, name, trigger) {
  if (busy) return;
  const version = requestVersion, selection = selected;
  if (entryValue() !== entrySnapshot && !await showConfirmModal('Discard player changes?', 'Discard the unfinished player form?', 'Discard changes', true)) return;
  if (version !== requestVersion || selection !== selected || loadedSite !== state.ACTIVE_SITE_ID) return;
  closeEntry({ restoreFocus: false });
  entryTrigger = trigger;
  editingName = name ?? null;
  if (kind === 'import') {
    $('eventBoardPlayers').value = '';
    $('eventImportError').textContent = '';
    $('eventImportForm').hidden = false;
    $('eventBoardPlayers').focus();
  } else {
    const player = players.find(item => item.name === name);
    $('eventPlayerFormTitle').textContent = player ? 'Edit player' : 'Add player';
    $('eventPlayerName').value = player?.name || '';
    $('eventPlayerPoints').value = player ? String(player.score) : '';
    $('eventPlayerError').textContent = '';
    $('eventPlayerForm').hidden = false;
    $('eventPlayerName').focus();
  }
  entrySnapshot = entryValue();
}
function wire(root) {
  if (root.dataset.wired) return;
  root.dataset.wired = 'true';
  root.addEventListener('input', event => {
    event.stopPropagation();
    if (event.target.id === 'eventPlayerSearch') { renderPlayers(); return; }
    if (!conflict) status(isDirty() ? 'Unsaved competition changes' : '');
  });
  root.addEventListener('change', event => { event.stopPropagation(); status(isDirty() ? 'Unsaved competition changes' : ''); });
  root.addEventListener('submit', event => { event.preventDefault(); event.stopPropagation(); });
  root.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || busy) return;
    if (button.dataset.eventManage) await navigate(button.dataset.eventManage);
    if (button.dataset.eventDelete) await deleteEvent(loadedEvents.find(item => item.id === button.dataset.eventDelete));
    if (button.dataset.eventPreview) {
      const value = loadedEvents.find(item => item.id === button.dataset.eventPreview);
      if (isDirty()) { status('Save your changes before opening the saved leaderboard or preview.', true); return; }
      previewEvent(value);
    }
    if (button.dataset.competitionTab) await navigate(selected?.id || 'new', button.dataset.competitionTab);
    if (button.dataset.playerEdit) await openEntry('player', button.dataset.playerEdit, button);
    if (button.dataset.playerRemove) {
      const version = requestVersion, selection = selected;
      if (!await showConfirmModal('Remove player?', `Remove ${button.dataset.playerRemove} from this competition? Save standings to apply the removal.`, 'Remove player', true)) return;
      if (version !== requestVersion || selection !== selected || loadedSite !== state.ACTIVE_SITE_ID) return;
      players = players.filter(player => player.name !== button.dataset.playerRemove);
      renderPlayers(); status('Unsaved competition changes'); $('eventPlayerAdd').focus();
    }
  });
  $('eventBoardRetry').addEventListener('click', () => loadEventLeaderboards());
  $('eventBoardReload').addEventListener('click', async () => {
    const savedId = savedAwaitingReload;
    if (!await discardChanges()) return;
    if (await loadEventLeaderboards() && savedId) await navigate(savedId, 'overview', { replace: true });
  });
  $('eventBoardCreate').addEventListener('click', () => navigate('new'));
  $('eventBoardClose').addEventListener('click', () => navigate());
  $('eventBoardDelete').addEventListener('click', () => deleteEvent(selected));
  $('eventBoardForm').addEventListener('submit', event => { event.preventDefault(); saveCompetition(); });
  $('eventStandingsSave').addEventListener('click', saveCompetition);
  $('eventPlayerAdd').addEventListener('click', event => openEntry('player', null, event.currentTarget));
  $('eventPlayerImport').addEventListener('click', event => openEntry('import', null, event.currentTarget));
  $('eventPlayerCancel').addEventListener('click', () => { closeEntry(); status(isDirty() ? 'Unsaved competition changes' : ''); });
  $('eventImportCancel').addEventListener('click', () => { closeEntry(); status(isDirty() ? 'Unsaved competition changes' : ''); });
  $('eventPlayerForm').addEventListener('submit', event => {
    event.preventDefault();
    const next = { name: $('eventPlayerName').value, score: $('eventPlayerPoints').value.trim() ? Number($('eventPlayerPoints').value) : NaN };
    try {
      const values = players.filter(player => player.name !== editingName);
      players = validateEventPlayers([...values, next], playerLimit);
      renderPlayers();
      if (editingName !== null) entryTrigger = [...$('eventPlayerRows').querySelectorAll('[data-player-edit]')].find(button => button.dataset.playerEdit === next.name.trim()) || $('eventPlayerSearch');
      closeEntry(); status('Unsaved competition changes');
    } catch (error) { $('eventPlayerError').textContent = error.message; }
  });
  $('eventImportForm').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const rows = $('eventBoardPlayers').value.split('\n').filter(line => line.trim()).map((line, index) => {
        const comma = line.lastIndexOf(',');
        const score = line.slice(comma + 1).trim();
        if (comma < 1 || !score) throw new Error(`Row ${index + 1}: use Player name, points.`);
        return { name: line.slice(0, comma).trim(), score: Number(score) };
      });
      if (!rows.length) throw new Error('Enter at least one player to import.');
      players = validateEventPlayers(rows, playerLimit);
      renderPlayers(); closeEntry(); status('Standings replaced. Save standings to apply these changes.');
    } catch (error) { $('eventImportError').textContent = error.message; }
  });
  document.addEventListener('yr:dashboard-route', () => renderRoute());
  window.addEventListener('beforeunload', event => { if (isDirty() || busy) { event.preventDefault(); event.returnValue = ''; } });
}
export async function loadEventLeaderboards(brand = siteBrand) {
  const root = $('eventBoards');
  if (!root || !state.ACTIVE_SITE_ID) return false;
  siteBrand = brand; loaded = false;
  wire(root);
  loadedSite = state.ACTIVE_SITE_ID;
  loadedEvents = []; selected = null; players = []; entrySnapshot = ''; conflict = false;
  const version = ++requestVersion, site = loadedSite;
  $('eventBoardEditor').hidden = true;
  $('eventBoardOverview').hidden = false;
  $('eventBoardList').innerHTML = '';
  $('eventPlayerRows').innerHTML = '';
  $('eventBoardListStatus').textContent = 'Loading competitions…';
  $('eventBoardRetry').hidden = true;
  setBusy(true);
  try {
    const result = await api('GET', undefined, site);
    if (!currentRequest(version, site)) return false;
    loadedEvents = result.events || [];
    playerLimit = result.playerLimit ?? Infinity;
    loaded = true; renderList();
    renderRoute({ focus: false });
    return true;
  } catch (error) {
    if (!currentRequest(version, site)) return false;
    $('eventBoardListStatus').textContent = error.message;
    $('eventBoardRetry').hidden = false;
    return false;
  } finally { if (currentRequest(version, site)) setBusy(false); }
}
