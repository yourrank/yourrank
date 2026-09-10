import { state } from './state.js';
import { getCsrf } from './utils.js';
import { fetchDashboardJson } from './request.js';

// One inbox instance per settings document; detached or changed sites discard late responses.
export function openSiteFeedback() {
  const panel = document.getElementById('settingsPanelFeedback');
  if (!panel || !state.ACTIVE_SITE_ID) return;
  if (panel._feedbackSite === state.ACTIVE_SITE_ID) return;
  const siteId = state.ACTIVE_SITE_ID;
  panel._feedbackSite = siteId;
  const list = panel.querySelector('[data-feedback-list]');
  const status = panel.querySelector('[data-feedback-status]');
  const count = panel.querySelector('[data-feedback-count]');
  const more = panel.querySelector('[data-feedback-more]');
  const refresh = panel.querySelector('[data-feedback-refresh]');
  const filters = [...panel.querySelectorAll('[data-feedback-filter]')];
  let cursor = null;
  let filter = 'all';
  let busy = false;
  let unreadCount = 0;
  const current = () => panel.isConnected && state.ACTIVE_SITE_ID === siteId && panel._feedbackSite === siteId;
  function setBusy(value) {
    busy = value;
    list.setAttribute('aria-busy', String(value));
    panel.querySelectorAll('button').forEach(button => { button.disabled = value; });
  }
  function showCount() { count.textContent = `${unreadCount} unread`; }
  function showEmpty() {
    if (list.children.length) return;
    const empty = document.createElement('p');
    empty.className = 'site-feedback-empty';
    empty.textContent = cursor ? 'No messages remain on this page. Load more to continue.' : filter === 'unread' ? 'You’re all caught up. Choose All to revisit earlier feedback.' : 'No viewer feedback yet. Messages sent from “Send feedback” on your published site will appear here.';
    list.append(empty);
  }
  function addItem(item) {
    const row = document.createElement('article');
    row.className = 'site-feedback-message';
    row.dataset.unread = String(!item.read);
    const meta = document.createElement('div');
    meta.className = 'site-feedback-meta';
    const author = document.createElement('strong');
    author.textContent = item.kick_username ? `@${item.kick_username}` : 'Anonymous viewer';
    const date = document.createElement('time');
    date.dateTime = new Date(item.created_at).toISOString();
    date.textContent = new Date(item.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const label = document.createElement('span');
    label.className = 'site-feedback-read-state';
    const message = document.createElement('p');
    message.className = 'site-feedback-body';
    message.dir = 'auto';
    message.textContent = item.message;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--sm';
    function sync() {
      label.textContent = item.read ? 'Read' : 'Unread';
      row.dataset.unread = String(!item.read);
      button.textContent = item.read ? 'Mark unread' : 'Mark read';
    }
    sync();
    button.onclick = async () => {
      if (busy) return;
      setBusy(true);
      status.textContent = 'Updating message…';
      try {
        const { body } = await fetchDashboardJson(`/api/site/feedback?siteId=${encodeURIComponent(siteId)}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf() },
          body: JSON.stringify({ id: item.id, read: !item.read }),
        });
        if (!current()) return;
        unreadCount = Math.max(0, unreadCount + (body.item.read ? -1 : 1));
        item.read = body.item.read;
        sync();
        showCount();
        status.textContent = item.read ? 'Marked read.' : 'Marked unread.';
        if (filter === 'unread' && item.read) {
          row.remove();
          showEmpty();
          // The activated control was removed; return keyboard focus to the list controls.
          setBusy(false);
          filters.find(b => b.dataset.feedbackFilter === 'unread').focus();
        }
      } catch (error) {
        if (current()) status.textContent = `${error.message} Refresh to check the message’s current state.`;
      } finally {
        if (current()) {
          setBusy(false);
          if (!panel.hidden && row.isConnected) button.focus();
        }
      }
    };
    meta.append(author, date, label);
    row.append(meta, message, button);
    list.append(row);
  }
  async function load(append = false) {
    if (busy) return;
    setBusy(true);
    status.textContent = 'Loading feedback…';
    if (!append) { cursor = null; list.replaceChildren(); more.hidden = true; }
    try {
      const params = new URLSearchParams({ siteId, filter });
      if (append && cursor) params.set('cursor', cursor);
      const { body } = await fetchDashboardJson(`/api/site/feedback?${params}`, { credentials: 'include' });
      if (!current()) return;
      panel.querySelector('[data-feedback-site]').textContent = body.siteName;
      list.querySelector('.site-feedback-empty')?.remove();
      body.items.forEach(addItem);
      unreadCount = body.unreadCount;
      showCount();
      cursor = body.nextCursor;
      more.hidden = !cursor;
      showEmpty();
      status.textContent = 'Up to date. Use Refresh to check for new messages.';
    } catch (error) {
      if (current()) status.textContent = `${error.message} Use ${append ? 'Load more' : 'Refresh'} to try again.`;
    } finally { if (current()) setBusy(false); }
  }
  filters.forEach(button => {
    button.onclick = () => {
      if (busy || filter === button.dataset.feedbackFilter) return;
      filter = button.dataset.feedbackFilter;
      filters.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      load();
    };
  });
  refresh.onclick = () => load();
  more.onclick = () => load(true);
  load();
}
