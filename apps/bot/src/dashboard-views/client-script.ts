// Client-side dashboard script injected by appHtml
export function clientScriptSource(): string {
  return `const $ = (id) => document.getElementById(id);
const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
const setHtml = (id, v) => { const el = $(id); if (el) el.innerHTML = v; };
function toast(msg) {
  const t = $('status');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast';
  t.hidden = false;
  clearTimeout(t._toastTimeout);
  t._toastTimeout = setTimeout(() => { t.hidden = true; }, 4000);
}
// The dialog itself is /assets/dialog.js, shared with the leaderboard Worker.
function confirmModal(title, body, confirmText, isDanger) {
  return window.YRDialog.confirm({ title: title, body: body, confirmText: confirmText, danger: isDanger });
}
function setFieldErr(id, msg) {
  const input = $(id); if (!input) return;
  input.setAttribute('aria-invalid','true'); input.classList.add('input-err');
  let err = $(id + '-error');
  if (!err) { err = document.createElement('span'); err.id = id + '-error'; err.className = 'field-err'; err.setAttribute('role','alert'); input.parentNode.insertBefore(err, input.nextSibling); }
  err.textContent = msg;
}
function clearFieldErr(id) {
  const input = $(id); if (input) { input.removeAttribute('aria-invalid'); input.classList.remove('input-err'); }
  const err = $(id + '-error'); if (err) err.textContent = '';
}
function setFormStatus(id, msg, isErr) {
  const el = $(id); if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', !!isErr);
  el.classList.toggle('ok', !isErr);
  el.hidden = !msg;
}
function clearFormStatus(id) { setFormStatus(id, '', false); }
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { return navigator.clipboard.writeText(text).then(function(){ return true; }).catch(function(){ return false; }); } catch (e) { return Promise.resolve(false); }
  }
  return new Promise(function(resolve){
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand('copy'); document.body.removeChild(ta); resolve(ok);
    } catch (e) { resolve(false); }
  });
}
function manualCopyFallback(text) {
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.readOnly = true; ta.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const msg = document.createElement('p'); msg.className = 'form-status ok'; msg.textContent = 'Text selected. Press Ctrl+C (or Cmd+C) to copy, then close this message.';
    ta.parentNode.insertBefore(msg, ta.nextSibling);
    setTimeout(function(){ if(msg.parentNode) msg.parentNode.removeChild(msg); if(ta.parentNode) ta.parentNode.removeChild(ta); }, 6000);
    return true;
  } catch (e) { return false; }
}
async function copyWithFallback(text) {
  const ok = await copyText(text);
  if (ok) return true;
  return manualCopyFallback(text);
}

// Generic client-side search/sort/pagination for bot dashboard lists.
function ListController(opts){
  var self = this;
  self.tbody = typeof opts.tbody === 'string' ? $(opts.tbody) : opts.tbody;
  var table = self.tbody && self.tbody.closest && self.tbody.closest('table');
  self.root = table || (typeof opts.root === 'string' ? $(opts.root) : opts.root);
  self.all = opts.items || [];
  self.perPage = opts.perPage || 20;
  self.searchFn = opts.searchFn || function(){ return ''; };
  self.sortOptions = opts.sortOptions || [];
  self.emptyAllText = opts.emptyAllText || 'No items yet.';
  self.emptyAllMarkup = opts.emptyAllMarkup || null;
  self.emptyText = opts.emptyText || 'No matching items.';
  self.renderItem = opts.renderItem || function(item){ return '<td colspan="99">'+esc(String(item))+'</td>'; };
  self.onRender = opts.onRender || function(){};
  self.page = 1;
  self.query = '';
  self.sortKey = self.sortOptions[0] ? self.sortOptions[0].key : '';

  var wrap = document.createElement('div');
  wrap.className = 'list-controls';
  self.controls = wrap;
  var html = '<div class="list-controls-row">';
  html += '<input type="search" class="list-search" placeholder="'+(opts.searchPlaceholder || 'Search…')+'" aria-label="Search">';
  if (self.sortOptions.length) {
    html += '<select class="list-sort" aria-label="Sort"><option value="">Sort by…</option>';
    self.sortOptions.forEach(function(o){ html += '<option value="'+esc(o.key)+'"'+(o.key===self.sortKey?' selected':'')+'>'+esc(o.label)+'</option>'; });
    html += '</select>';
  }
  html += '</div><div class="list-pagination" role="group" aria-label="Pagination"><button class="ghost" data-prev type="button">Previous</button><span class="list-page-info"></span><button class="ghost" data-next type="button">Next</button></div>';
  wrap.innerHTML = html;
  if (self.root && table && table.parentNode) table.parentNode.insertBefore(wrap, table);
  else if (self.root) self.root.insertBefore(wrap, self.root.firstChild);

  self.searchInput = wrap.querySelector('.list-search');
  self.sortSelect = wrap.querySelector('.list-sort');
  self.prevBtn = wrap.querySelector('[data-prev]');
  self.nextBtn = wrap.querySelector('[data-next]');
  self.pageInfo = wrap.querySelector('.list-page-info');

  self.searchInput.addEventListener('input', function(){ self.query = self.searchInput.value.trim().toLowerCase(); self.page = 1; self.refresh(); });
  if (self.sortSelect) self.sortSelect.addEventListener('change', function(){ self.sortKey = self.sortSelect.value; self.page = 1; self.refresh(); });
  self.prevBtn.addEventListener('click', function(){ if (self.page > 1){ self.page--; self.refresh(); } });
  self.nextBtn.addEventListener('click', function(){ if (self.page < self.totalPages){ self.page++; self.refresh(); } });

  wrap.hidden = self.all.length === 0;
  self.refresh();
}
ListController.prototype.setItems = function(items){
  this.all = items || [];
  this.page = 1;
  this.controls.hidden = this.all.length === 0;
  this.refresh();
};
ListController.prototype.matches = function(item){
  if (!this.query) return true;
  var hay = String(this.searchFn(item)).toLowerCase();
  var terms = this.query.split(' ').filter(Boolean);
  for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) === -1) return false;
  return true;
};
ListController.prototype.compare = function(a, b){
  var opt = null;
  for (var i = 0; i < this.sortOptions.length; i++) if (this.sortOptions[i].key === this.sortKey){ opt = this.sortOptions[i]; break; }
  if (!opt || !opt.fn) return 0;
  return opt.fn(a, b);
};
ListController.prototype.refresh = function(){
  var self = this;
  var filtered = self.all.filter(function(item){ return self.matches(item); });
  var sorted = self.sortKey ? filtered.slice().sort(function(a, b){ return self.compare(a,b); }) : filtered;
  self.totalPages = Math.max(1, Math.ceil(sorted.length / self.perPage));
  if (self.page > self.totalPages) self.page = self.totalPages || 1;
  var start = (self.page - 1) * self.perPage;
  var pageItems = sorted.slice(start, start + self.perPage);
  if (!pageItems.length) {
    var isEmpty = self.all.length === 0 && !self.query;
    var msg = isEmpty ? self.emptyAllText : self.emptyText;
    var colCount = self.tbody && self.tbody.closest && self.tbody.closest('table') ? self.tbody.closest('table').querySelectorAll('thead th').length || 1 : 1;
    var content = isEmpty && self.emptyAllMarkup ? self.emptyAllMarkup : esc(msg);
    self.tbody.innerHTML = '<tr><td colspan="'+colCount+'">'+content+'</td></tr>';
  } else {
    self.tbody.innerHTML = pageItems.map(function(item){ return '<tr>'+self.renderItem(item)+'</tr>'; }).join('');
  }
  self.updatePagination(sorted.length);
  self.onRender(pageItems);
};
ListController.prototype.updatePagination = function(total){
  this.pageInfo.textContent = total ? 'Page '+this.page+' of '+this.totalPages+' ('+total+')' : '';
  this.prevBtn.disabled = this.page <= 1;
  this.nextBtn.disabled = this.page >= this.totalPages || this.totalPages === 0;
};

let __offersCtrl, __broadcastsCtrl, __broadcasts = [];

async function api(path, opts) {
  const readRequest = !opts || !opts.method || opts.method.toUpperCase() === 'GET';
  const controller = readRequest ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 10000) : null;
  const requestOpts = controller
    ? Object.assign({}, opts || {}, { signal: controller.signal })
    : (opts || {});
  let r;
  try {
    r = await fetch('/bot/dash/api'+path, requestOpts);
  } catch (err) {
    if (err && err.name === 'AbortError') return { error: 'The request timed out — try again.' };
    throw err;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (r.status === 401) { saveBroadcastDraft(); location.reload(); throw new Error('session expired'); }
  if (!r.ok) {
    try { const data = await r.json(); if (data && data.error) return data; } catch {}
    return { error: 'Server error (' + r.status + ') — try again or contact support' };
  }
  try { return await r.json(); }
  catch { return { error: 'Server error (' + r.status + ') — try again or contact support' }; }
}
let submitting = false;
const page = document.body.dataset.page || 'overview';
let __lastBots = [];
let __offers = [];
let __planInfo = null;
let __maxBots = Infinity;
let __maxOffers = Infinity;
let __canBroadcast = false;
let __testBotId = null;

function showPage(p) {
  document.querySelectorAll('[data-page]').forEach(el => {
    const pages = (el.dataset.page || '').split(' ').filter(Boolean);
    el.classList.toggle('hidden', !pages.includes(p));
  });
}
showPage(page);

function esc(s){ return String(s??'').replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

function fmtTime(iso){
  if (!iso) return 'never';
  try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

function showWizardStep(n){
  document.querySelectorAll('#connectWizard .wizard-step').forEach(el => { el.hidden = Number(el.dataset.step) !== n; });
}
function wizardNext(btn){ showWizardStep(Number(btn.dataset.step) + 1); }
function wizardPrev(btn){ showWizardStep(Number(btn.dataset.step) - 1); }

let firstBotId = null;
let firstBroadcastBotId = null;
let custBotId = null;
const requestedBotId = new URLSearchParams(location.search).get('bot');

// Every panel ships a static "Loading…" placeholder; if the load fails they
// have to say so instead of claiming to load forever.
const LOADING_SLOTS = [['botList',0],['ovBots',0],['ovOffers',0],['postbackStatusOffers',0],['postbackStatusSettings',0],['offers',11],['cmdList',5],['subSources',2]];
function loadErrorMarkup(msg, action){
  return '<div class="empty empty--error"><span class="empty__icon" aria-hidden="true">\u26a0</span>' +
    esc(msg) +
    '<br><button class="btn btn--sm btn--ghost ghost" type="button" data-action="'+action+'">Try again</button></div>';
}
function showLoadError(msg){
  // Same empty/error component as the leaderboard dashboard (ui.css).
  const body = loadErrorMarkup(msg || "Couldn't load your dashboard.", 'retryLoad');
  for (const slot of LOADING_SLOTS) {
    const el = $(slot[0]);
    if (!el) continue;
    el.innerHTML = slot[1] ? '<tr><td colspan="' + slot[1] + '">' + body + '</td></tr>' : body;
  }
}
function showPostbackError(msg){
  ['postbackStatusOffers','postbackStatusSettings'].forEach(id => {
    const el = $(id);
    if (el) el.innerHTML = loadErrorMarkup(msg || "Couldn't load extra results status. Try again.", 'retryPostbacks');
  });
}

async function load() {
  const me = await api('/me');
  if (me.error) { toast(me.error); showLoadError(me.error); showConnectionError(); return; }

  const [offers, daily, bots] = await Promise.all([api('/offers'), api('/stats/daily'), api('/bots')]);
  if (daily.error || offers.error || bots.error) {
    const err = daily.error || offers.error || bots.error;
    toast(err); showLoadError(err); showConnectionError(); return;
  }

  showPage(page);

  // overview stats
  if (page === 'overview') {
    setHtml('ovScope', 'Metrics for all connected bots over the last 14 days, shown in your local time.');
    const totClicks = (daily||[]).reduce((s,d)=>s+d.clicks,0);
    const totUnique = (daily||[]).reduce((s,d)=>s+d.unique_clicks,0);
    const activeOffers = (offers||[]).filter(o=>o.is_active).length;
    setText('totClicks', totClicks);
    setText('totUnique', totUnique);
    setText('totOffers', activeOffers);
    setText('uniqueSub', totClicks > 0 ? Math.round(totUnique/totClicks*100) + '% of clicks' : '');
    setText('offersSub', (offers||[]).length ? 'of ' + (offers||[]).length + ' total' : 'none yet');
    renderOverviewSummary(bots, offers);

    const max = Math.max(1, ...(daily||[]).map(d=>d.clicks));
    const w = daily.length ? 100/daily.length : 10;
    const chart = $('chart');
    if (chart) {
      chart.setAttribute('viewBox','0 0 100 40');
      chart.innerHTML = (daily||[]).map((d,i)=>{
        const h = d.clicks/max*36;
        return '<rect x="'+(i*w+0.5)+'" y="'+(40-h)+'" width="'+(w-1)+'" height="'+h+'" rx="0.6" fill="#f0b429"><title>'+esc(d.day)+': '+esc(String(d.clicks))+'</title></rect>';
      }).join('');
    }
    setHtml('chartLabels', daily.length > 0
      ? '<span>'+esc(daily[0].day.slice(5))+'</span><span>'+esc(daily[daily.length-1].day.slice(5))+'</span>'
      : '');
  }

  renderBots(bots);

  if (page === 'overview') loadSubscribers(bots);

  __offers = offers || [];
  renderOffers();
  if (__planInfo) renderPlanState(__planInfo);
}

// Compact bot + offer summaries (overview only).
function renderOverviewSummary(bots, offers){
  const ov = $('ovBots');
  if (ov) {
    const list = (bots||[]).slice(0,4);
    ov.innerHTML = list.length
      ? '<ul class="tg-row-list">'+list.map(b=>{
          const state = botConnectionState(b);
          return '<li class="tg-row"><div class="tg-row-copy"><span class="tg-row-name">@'+esc(b.username)+'</span>'+
            '<span class="tg-row-meta">'+esc(state.rowText)+'</span></div>'+
            '<span class="tg-state" data-state="'+esc(state.key)+'"><i aria-hidden="true"></i>'+esc(state.label)+'</span></li>';
        }).join('')+'</ul>'
      : '<p class="muted text-sm">No bot connected yet. <a href="/dashboard/telegram/bots">Connect Telegram</a></p>';
  }
  const oo = $('ovOffers');
  if (oo) {
    const top = (offers||[]).slice().sort((a,b)=>(b.clicks||0)-(a.clicks||0)).slice(0,4);
    oo.innerHTML = top.length
      ? '<ul class="tg-row-list">'+top.map(o=>{
          const on = o.is_active;
          return '<li class="tg-row"><div class="tg-row-copy"><span class="tg-row-name">'+esc(o.casino)+'</span>'+
            '<span class="tg-row-meta">'+esc(o.label||'')+' · '+esc(String(o.clicks||0))+' clicks · '+esc(String(o.conversions||0))+' of '+esc(String(o.unique_clicks||0))+' signed up</span></div>'+
            '<span class="tg-state" data-state="'+(on?'ok':'off')+'"><i aria-hidden="true"></i>'+(on?'Active':'Off')+'</span></li>';
        }).join('')+'</ul>'
      : '<p class="muted text-sm">No offers yet. <a href="/dashboard/telegram/offers">Create one</a></p>';
  }
}

// ---- connection truth -------------------------------------------------------
// One place that turns the /bots payload into the state a creator reads:
// Connected, Setup incomplete, Needs attention or Not connected. Health checks
// can escalate a connected bot to "Needs attention"; nothing here invents a
// state the API did not report.
const __botAttention = {};
function botConnectionState(bot){
  if (!bot) return { key: 'off', label: 'Not connected', rowText: 'Not connected' };
  if (__botAttention[bot.id]) return { key: 'attention', label: 'Needs attention', rowText: __botAttention[bot.id] };
  if (bot.status === 'active') return { key: 'ok', label: 'Connected', rowText: 'Connected and replying to subscribers' };
  if (bot.status === 'revoked') return { key: 'attention', label: 'Needs attention', rowText: 'Disconnected — reconnect to keep sending updates' };
  return { key: 'setup', label: 'Setup incomplete', rowText: 'Waiting on Telegram to finish the connection' };
}
function renderConnectionState(bots){
  const card = $('tgConn');
  if (!card) return;
  const list = bots || [];
  const active = list.find(b => b.status === 'active');
  const chosen = active || list[0] || null;
  const state = list.length ? botConnectionState(chosen) : { key: 'off', label: 'Not connected', rowText: '' };
  const name = $('tgConnName');
  const sub = $('tgConnSub');
  const badge = $('tgConnState');
  const badgeText = $('tgConnStateText');
  const actions = $('tgConnActions');
  const primary = $('tgConnPrimary');
  const secondary = $('tgConnSecondary');
  const note = $('tgConnNote');
  if (badge) badge.dataset.state = state.key;
  if (badgeText) badgeText.textContent = state.label;
  if (name) name.textContent = chosen ? '@'+chosen.username : 'Telegram';
  if (sub) {
    sub.textContent = !list.length
      ? 'No Telegram bot connected yet. Connect one to send updates to your subscribers.'
      : state.rowText;
  }
  if (primary && secondary) {
    if (state.key === 'ok') {
      primary.textContent = 'Send update';
      primary.href = '/dashboard/telegram/broadcasts';
      secondary.textContent = 'Manage connection';
      secondary.hidden = page === 'bots';
    } else if (state.key === 'attention') {
      primary.textContent = 'Manage connection';
      primary.href = '/dashboard/telegram/bots';
      secondary.hidden = true;
    } else if (state.key === 'setup') {
      primary.textContent = 'Finish setup';
      primary.href = '/dashboard/telegram/bots';
      secondary.hidden = true;
    } else {
      primary.textContent = 'Connect Telegram';
      primary.href = '/dashboard/telegram/bots';
      secondary.hidden = true;
    }
  }
  if (actions) actions.hidden = false;
  if (note) {
    const extra = list.length > 1 ? (list.length - 1) + ' other bot' + (list.length === 2 ? '' : 's') + ' in this workspace.' : '';
    note.textContent = extra;
    note.hidden = !extra;
  }
}
// The raw upstream error belongs in the toast and the panel it came from, not
// in the sentence a creator reads to learn what Telegram is doing.
function showConnectionError(){
  const badge = $('tgConnState');
  const badgeText = $('tgConnStateText');
  const sub = $('tgConnSub');
  const actions = $('tgConnActions');
  if (!badge) return;
  badge.dataset.state = 'unknown';
  if (badgeText) badgeText.textContent = 'Status unavailable';
  if (sub) sub.textContent = "Couldn't check your Telegram connection. Reload to try again.";
  if (actions) actions.hidden = true;
}

// Subscriber totals + deep-link attribution (overview only).
async function loadSubscribers(bots){
  const s = await api('/stats/subscribers');
  if (!s || s.error) return;
  const t = s.totals || {};
  setText('totSubs', t.active ?? 0);
  setText('subsNew', (t.new_7d ?? 0) > 0 ? '+' + (t.new_7d ?? 0) + ' new in the last 7 days' : 'No new subscribers in the last 7 days');
  const rows = (s.sources || []);
  setHtml('subSources', rows.length
    ? rows.map(r=>'<tr><td>'+esc(r.source)+'</td><td class="num">'+esc(String(r.count))+'</td></tr>').join('')
    : '<tr><td colspan="2" class="muted">No subscribers yet. Share your bot link to get your first subscriber.</td></tr>');
  const active = (bots || []).find(b=>b.status==='active' && b.username);
  if (active) setText('deepLinkExample', 't.me/'+active.username+'?start=twitch');
}

// Render the offers table from client state. Mutation handlers update __offers
// from their authoritative result and re-render, so the table reflects changes
// immediately without a re-fetch (which can read stale data after a write).
function offerRow(o){
  const ctr = o.ctr != null ? ((o.ctr)*100).toFixed(1) : '0.0';
  const cr = o.cr != null ? ((o.cr)*100).toFixed(1) : '0.0';
  const revenue = Array.isArray(o.reported_revenue) && o.reported_revenue.length
    ? o.reported_revenue.map(function(r){
        const amount = Number(r.amount);
        const currency = String(r.currency || 'Unknown');
        if (!Number.isFinite(amount)) return esc(currency);
        try {
          return esc(new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount));
        } catch {
          return esc(amount.toFixed(2)+' '+currency);
        }
      }).join('<br>')
    : '—';
  const lastActivity = o.last_activity_at ? fmtTime(o.last_activity_at) : '—';
  return '<td><b>'+esc(o.casino)+'</b><br><span class="muted">'+esc(o.label)+'</span></td>'+
  '<td>'+(o.slug?'<span class="copy" data-action="copyLink" data-slug="'+esc(o.slug)+'" title="Copy share link">'+esc('/r/'+o.slug)+'</span> <button class="ghost btn--xs" data-action="copyLink" data-slug="'+esc(o.slug)+'" type="button" aria-label="Copy share link">Copy</button>':'–')+'</td>'+
  '<td>'+esc(String(o.clicks))+'</td><td>'+esc(String(o.unique_clicks))+'</td>'+
  '<td>'+esc(ctr)+'%</td><td>'+esc(cr)+'%</td><td>'+esc(String(o.conversions||0))+'</td>'+
  '<td>'+revenue+'</td><td>'+esc(lastActivity)+'</td>'+
  '<td class="'+(o.is_active?'ok':'off')+'">'+(o.is_active?'active':'off')+'</td>'+
  '<td><button class="ghost" data-action="toggleOffer" data-id="'+esc(o.id)+'" data-active="'+(!o.is_active)+'">'+(o.is_active?'Disable':'Enable')+'</button></td>';
}
function formatBroadcastDate(value){
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleString(undefined, {dateStyle:'medium', timeStyle:'short'});
}
// Backend broadcast status → plain creator words. Unknown values fall through
// unchanged rather than being hidden behind a guess.
const BROADCAST_STATUS_WORDS = { queued: 'Sending', sending: 'Sending', sent: 'Sent', scheduled: 'Scheduled', canceled: 'Cancelled', cancelled: 'Cancelled', failed: 'Failed' };
function broadcastStatusLabel(status){
  return BROADCAST_STATUS_WORDS[String(status || '').toLowerCase()] || String(status || 'Unknown');
}
function broadcastRow(b){
  const audience = b.total_count != null ? String(b.total_count) : '—';
  const status = String(b.status || 'unknown');
  const canCancel = status === 'scheduled';
  return '<td><span class="badge '+esc(status)+'">'+esc(broadcastStatusLabel(status))+'</span></td>'+
    '<td><b>'+esc(audience)+'</b> <span class="muted">subscribers</span></td>'+
    '<td><button class="link-button" data-action="viewBroadcast" data-id="'+esc(b.id)+'" type="button">'+esc(String(b.body || '').slice(0,90))+(String(b.body || '').length>90?'…':'')+'</button></td>'+
    '<td>'+esc(b.bot_username || '—')+'</td>'+
    '<td>'+esc(formatBroadcastDate(b.scheduled_at))+'</td>'+
    '<td>'+esc(String(b.sent_count ?? 0))+'</td>'+
    '<td>'+esc(String(b.fail_count ?? 0))+'</td>'+
    '<td><button class="ghost" data-action="viewBroadcast" data-id="'+esc(b.id)+'" type="button">View</button>'+
      (canCancel ? ' <button class="ghost" data-action="cancelBroadcast" data-id="'+esc(b.id)+'" type="button">Cancel</button>' : '')+'</td>';
}
function broadcastAudienceText(b){
  const n = b.total_count != null ? String(b.total_count) : 'not recorded';
  const label = formatSegmentLabel(b.audience_filter_snapshot || b.segment) || 'all subscribers';
  return label+' · '+n+' subscribers';
}
let bcDetailFocusTrap = null;
let bcDetailTrigger = null;
function renderBroadcastButtons(value){
  if (!Array.isArray(value)) return value == null ? '<span class="muted">No buttons recorded</span>' : '<pre class="bc-detail-message">'+esc(JSON.stringify(value, null, 2))+'</pre>';
  const rows = value.flatMap(row => Array.isArray(row) ? row : [row]);
  if (!rows.length) return '<span class="muted">No buttons recorded</span>';
  if (!rows.every(button => button && typeof button === 'object' && (button.label || button.text) && button.url)) {
    return '<pre class="bc-detail-message">'+esc(JSON.stringify(value, null, 2))+'</pre>';
  }
  return '<ul class="bc-detail-buttons">'+rows.map(button => '<li><b>'+esc(button.label || button.text)+'</b> — '+esc(button.url)+'</li>').join('')+'</ul>';
}
function openBroadcastDetail(id){
  const b = __broadcasts.find(x => x.id === id);
  if (!b) return toast('Update not found');
  const body = $('bcDetailBody');
  if (!body) return;
  const filter = b.audience_filter_snapshot;
  const filterText = filter ? (formatSegmentLabel(filter) || 'All subscribers') : 'Not recorded for this older update.';
  const image = b.media_url ? '<img class="bc-detail-image" src="'+esc(b.media_url)+'" alt="Broadcast image" />' : '<span class="muted">No image</span>';
  const buttonHtml = renderBroadcastButtons(b.buttons);
  body.innerHTML =
    '<dl class="bc-detail-grid">'+
      '<div class="bc-detail-item"><dt>Bot</dt><dd>'+esc(b.bot_username || '—')+'</dd></div>'+
      '<div class="bc-detail-item"><dt>Status</dt><dd>'+esc(b.status ? broadcastStatusLabel(b.status) : '—')+'</dd></div>'+
      '<div class="bc-detail-item"><dt>Subscribers</dt><dd>'+esc(filterText)+'</dd></div>'+
      '<div class="bc-detail-item"><dt>Subscribers at send time</dt><dd>'+esc(b.total_count == null ? 'Not recorded' : String(b.total_count))+'</dd></div>'+
      '<div class="bc-detail-item"><dt>Scheduled</dt><dd>'+esc(formatBroadcastDate(b.scheduled_at))+'</dd></div>'+
      '<div class="bc-detail-item"><dt>Sent</dt><dd>'+esc(formatBroadcastDate(b.sent_at))+'</dd></div>'+
      '<div class="bc-detail-item"><dt>Delivered</dt><dd>'+esc(String(b.sent_count ?? 0))+'</dd></div>'+
      '<div class="bc-detail-item"><dt>Failed</dt><dd>'+esc(String(b.fail_count ?? 0))+'</dd></div>'+
    '</dl>'+
    '<h4>Message sent</h4><div class="bc-detail-message">'+esc(b.body || '')+'</div>'+
    '<h4>Image</h4>'+image+(b.media_url ? '<p><a href="'+esc(b.media_url)+'" target="_blank" rel="noreferrer">'+esc(b.media_url)+'</a></p>' : '')+
    '<h4>Buttons</h4>'+buttonHtml+
    '<p class="muted">The list of individual subscribers is not kept.</p>';
  const detail = $('bcDetail');
  if (detail) {
    bcDetailTrigger = document.activeElement;
    detail.hidden = false;
    const card = detail.querySelector('.bc-detail-card');
    bcDetailFocusTrap = card && window.YRDialog ? window.YRDialog.trap(card, closeBroadcastDetail) : null;
  }
}
function closeBroadcastDetail(){
  const detail = $('bcDetail'); if (detail) detail.hidden = true;
  if (bcDetailFocusTrap) { bcDetailFocusTrap(); bcDetailFocusTrap = null; }
  if (bcDetailTrigger && bcDetailTrigger.focus) bcDetailTrigger.focus();
  bcDetailTrigger = null;
}
function renderOffers(){
  const offersEl = $('offers');
  if (!offersEl) return;
  if (!__offersCtrl) {
    __offersCtrl = new ListController({
      tbody: 'offers', items: __offers || [], perPage: 10,
      searchFn: function(o){ return [o.casino, o.label, o.slug, o.code].filter(Boolean).join(' '); },
      sortOptions: [
          { key: 'clicks', label: 'Visits', fn: function(a,b){ return (b.clicks||0) - (a.clicks||0); } },
          { key: 'unique', label: 'People reached', fn: function(a,b){ return (b.unique_clicks||0) - (a.unique_clicks||0); } },
          { key: 'ctr', label: 'Visit rate', fn: function(a,b){ return (b.ctr||0) - (a.ctr||0); } },
          { key: 'cr', label: 'Sign-up rate', fn: function(a,b){ return (b.cr||0) - (a.cr||0); } },
          { key: 'conversions', label: 'Sign-ups', fn: function(a,b){ return (b.conversions||0) - (a.conversions||0); } },
          { key: 'active', label: 'Active first', fn: function(a,b){ return Number(b.is_active) - Number(a.is_active); } }
        ],
        emptyAllMarkup: '<div class="empty"><b>No offers yet</b><br><span>Create your first offer above to get a share link for your bot.</span><br><a class="btn btn--accent btn--sm mt-sm" href="#offerCreateForm">Create an offer</a></div>',
        emptyText: 'No matching offers.',
        searchPlaceholder: 'Search offers…',
      renderItem: offerRow
    });
  } else {
    __offersCtrl.setItems(__offers || []);
  }
}

function renderPlanState(plan){
  if (!plan || !plan.current) return;
  __planInfo = plan;
  const cur = plan.current;
  __maxBots = typeof cur.maxBots === 'number' ? cur.maxBots : Infinity;
  __maxOffers = typeof cur.maxOffers === 'number' ? cur.maxOffers : Infinity;
  __canBroadcast = cur.broadcasts === true;
  const label = esc(cur.label || cur.tier || 'Current');
  const manageUrl = esc(plan.upgradeUrl || '/dashboard/settings');
  const activeBots = __lastBots.filter(b => b.status === 'active');
  const botAtLimit = activeBots.length >= __maxBots;
  const botState = $('botPlanState');
  if (botState) {
    botState.innerHTML = '<b>'+label+' plan:</b> '+activeBots.length+' of '+__maxBots+' bot slots used. Disconnected bots do not count.'+
      (botAtLimit ? ' <a href="'+manageUrl+'">Upgrade or manage your plan to connect another bot.</a>' : '');
  }
  const connect = $('connectWizard');
  if (connect) connect.classList.toggle('hidden', botAtLimit);

  const offerAtLimit = __offers.length >= __maxOffers;
  const offerState = $('offerPlanState');
  if (offerState) {
    offerState.innerHTML = '<b>'+label+' plan:</b> '+__offers.length+' of '+__maxOffers+' offer slots used.'+
      (offerAtLimit ? ' <a href="'+manageUrl+'">Upgrade or manage your plan to add another offer.</a>' : '');
  }
  const offerForm = $('offerCreateForm');
  if (offerForm) offerForm.querySelectorAll('input, button').forEach(el => { el.disabled = offerAtLimit; });

  const bcState = $('bcPlanState');
  if (bcState) {
    bcState.innerHTML = __canBroadcast
      ? '<b>'+label+' plan:</b> Broadcasts are included.'
      : '<b>'+label+' plan:</b> Broadcasts require a plan with broadcast access. <a href="'+manageUrl+'">Upgrade to compose a broadcast.</a>';
    if (plan.warning) bcState.innerHTML += ' '+esc(plan.warning);
  }
  setBroadcastAvailability(activeBots.length > 0);
}

async function loadExtras(){
  const bcListLoading = $('bcList');
  if (bcListLoading) bcListLoading.innerHTML = '<tr><td colspan="8" class="muted">Loading updates…</td></tr>';
  const [plan, bcs, pbStatus] = await Promise.all([api('/plan'), api('/broadcasts'), api('/postback-status')]);
  const errors = [plan.error, bcs.error, pbStatus.error].filter(Boolean);

  if (plan.error) {
    const state = $('bcPlanState');
    if (state) state.textContent = "Couldn't load plan access. Reload before composing a broadcast.";
  } else {
    renderPlanState(plan);
  }

  if (bcs.error) {
    const bcList = $('bcList');
    if (bcList) {
      const colCount = bcList.closest('table')?.querySelectorAll('thead th').length || 1;
      bcList.innerHTML = '<tr><td colspan="' + colCount + '">' + loadErrorMarkup(bcs.error || "Couldn’t load the updates you sent.", 'retryBroadcasts') + '</td></tr>';
    }
  } else {
    __broadcasts = bcs || [];
    const bcList = $('bcList');
    if (bcList) {
      if (!__broadcastsCtrl) {
        __broadcastsCtrl = new ListController({
          tbody: 'bcList', items: __broadcasts, perPage: 10,
          searchFn: function(b){ return [b.body, b.bot_username, b.status, formatSegmentLabel(b.segment)].filter(Boolean).join(' '); },
          sortOptions: [
            { key: 'time', label: 'Newest', fn: function(a,b){ return new Date(b.created_at || b.scheduled_at || 0) - new Date(a.created_at || a.scheduled_at || 0); } },
            { key: 'status', label: 'Status', fn: function(a,b){ return (a.status||'').localeCompare(b.status||''); } },
            { key: 'sent', label: 'Sent', fn: function(a,b){ return (b.sent_count||0) - (a.sent_count||0); } }
          ],
          emptyAllText: 'No updates sent yet. Your sent and scheduled updates appear here.', emptyText: 'No matching updates.',
          searchPlaceholder: 'Search updates…',
          renderItem: broadcastRow
        });
      } else {
        __broadcastsCtrl.setItems(__broadcasts);
      }
    }
  }

  if (pbStatus.error) showPostbackError("Couldn't load extra results status.");
  else renderPostbackStatus(pbStatus);
  if (errors.length) toast(errors[0]);
}

function renderPostbackStatus(pb){
  const els = ['postbackStatusOffers','postbackStatusSettings'].map(id => $(id)).filter(Boolean);
  if (!els.length) return;
  if (!pb || pb.error) { els.forEach(el => { el.textContent = 'Could not load extra results status. Try again.'; }); return; }
  const html = pb.active
    ? '<span class="badge ok">Extra results connected</span> Sign-ups and revenue updates can appear here.'
    : '<span class="badge off">Extra results not connected</span> Connect your partner results in Account → Connected apps to see sign-ups and revenue.';
  els.forEach(el => { el.innerHTML = html; });
}

async function copyLink(target){ const ok = await copyWithFallback(location.origin+'/r/'+target.dataset.slug); toast(ok ? 'Link copied' : 'Copy failed — copy the URL manually'); }
async function toggleOffer(target){
  const on = target.dataset.active === 'true';
  setLoading(target);
  const r = await api('/offers/'+target.dataset.id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({is_active:on})});
  if (r.error) { restoreBtn(target); return toast(r.error); }
  const o = __offers.find(x => x.id === target.dataset.id);
  if (o) o.is_active = (r.is_active !== undefined ? r.is_active : on);
  renderOffers();
  restoreBtn(target);
}
function updateOfferPreview(){
  const casino = ($('oCasino')?.value || '').trim();
  const label = ($('oLabel')?.value || '').trim();
  const url = ($('oUrl')?.value || '').trim();
  const code = ($('oCode')?.value || '').trim();
  const bonus = ($('oBonus')?.value || '').trim();
  const wrap = $('offerPreview');
  if (!wrap) return;
  if (!casino && !label && !url) { wrap.hidden = true; return; }
  const title = $('offerPreviewTitle'); if (title) title.textContent = 'Link preview';
  const actions = $('offerCreatedActions'); if (actions) actions.hidden = true;
  const parts = [];
  if (label) parts.push(label);
  if (casino) parts.push('at ' + casino);
  if (bonus) parts.push('— ' + bonus);
  if (code) parts.push('Code: ' + code);
  const line = parts.join(' ');
  const urlEl = $('offerPreviewUrl');
  const textEl = $('offerPreviewText');
  if (urlEl) {
    urlEl.textContent = url || 'https://yourrank.site/r/<short-link-will-appear-here>';
    urlEl.href = url || '';
  }
  if (textEl) textEl.textContent = line || 'Offer preview will appear here';
  wrap.hidden = false;
}
async function createOffer(btn){
  ['oCasino','oLabel','oUrl','oCode','oBonus'].forEach(id => clearFieldErr(id));
  const body = { casino:$('oCasino').value.trim(), label:$('oLabel').value.trim(), referral_url:$('oUrl').value.trim(),
                 promo_code:$('oCode').value.trim()||undefined, bonus_text:$('oBonus').value.trim()||undefined };
  if (!body.label) { setFieldErr('oLabel','Enter an offer label'); return; }
  if (!body.referral_url) { setFieldErr('oUrl','Enter a referral URL'); return; }
  if (!body.referral_url.startsWith('http://') && !body.referral_url.startsWith('https://')) { setFieldErr('oUrl','URL must start with http:// or https://'); return; }
  setLoading(btn, 'Creating…');
  const r = await api('/offers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  if (r.error) { restoreBtn(btn); setFieldErr('oLabel', r.error + ' — click Create again to retry.'); return; }
  const trackedLink = String(r.tracked_link || '');
  const summary = [body.label, body.casino ? 'at '+body.casino : ''].filter(Boolean).join(' ');
  ['oCasino','oLabel','oUrl','oCode','oBonus'].forEach(id=>$(id).value='');
  const wrap = $('offerPreview'); if (wrap) wrap.hidden = false;
  const title = $('offerPreviewTitle'); if (title) title.textContent = 'Tracked link ready';
  const urlEl = $('offerPreviewUrl');
  if (urlEl) { urlEl.textContent = trackedLink; urlEl.href = trackedLink; }
  const textEl = $('offerPreviewText'); if (textEl) textEl.textContent = summary;
  const actions = $('offerCreatedActions');
  if (actions) {
    actions.hidden = false;
    const copy = actions.querySelector('[data-action="copyCreatedOffer"]');
    if (copy) copy.dataset.link = trackedLink;
  }
  toast('Offer created — tracked link ready'); restoreBtn(btn); load();
}
async function copyCreatedOffer(target){
  const ok = await copyWithFallback(target.dataset.link || '');
  toast(ok ? 'Tracked link copied' : 'Copy failed — select the tracked link and copy it manually');
}
async function connectBot(btn){
  clearFieldErr('botToken');
  const token = $('botToken').value.trim();
  if (!token) { setFieldErr('botToken','Paste a connect code first'); return; }
  showWizardStep(3);
  const status = $('connectStatus'); if (status) { status.className = 'muted'; status.textContent = 'Checking token with Telegram…'; }
  const r = await api('/bots',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token, welcome_message:$('botWelcome').value.trim()||undefined})});
  if (r.error) {
    if (status) { status.className = 'muted off'; status.textContent = 'Could not connect: ' + r.error + '. Go back and check your connect code.'; }
    return;
  }
  $('botToken').value='';
  if (status) { status.className = 'muted ok'; status.textContent = 'Connected to @' + r.username + '! You can send a test message below.'; }
  if (r.warning) { toast(r.warning); } else { toast('Bot @'+r.username+' connected'); }
  load();
}
async function checkHealth(target){
  setLoading(target, 'Checking…');
  const id = target.dataset.id;
  const r = await api('/bots/'+id+'/health');
  restoreBtn(target);
  if (r.error) { return toast(r.error); }
  // Health is the only signal that can escalate a stored "active" bot to
  // "Needs attention", so the summary above never claims Connected on a
  // stored status alone once Telegram has reported a problem.
  if (!r.configured) __botAttention[id] = 'Telegram is not delivering messages to this bot yet — reconnect it';
  else if (r.last_error) __botAttention[id] = 'Telegram reported a delivery problem — reconnect if messages stop arriving';
  else delete __botAttention[id];
  renderConnectionState(__lastBots);
  const details = $('health-body-'+id);
  const wrap = $('health-'+id);
  if (details && wrap) {
    const action = r.configured
      ? (r.last_error ? 'Telegram reported a problem. Reconnect the bot to restore delivery.' : 'Connected and working. If messages stop arriving, reconnect the bot.')
      : 'Telegram is not delivering to this bot. Reconnect it to restore the connection.';
    details.innerHTML = '<ul>'+
      '<li><b>Delivery:</b> '+(r.configured ? 'Telegram is delivering messages to this bot' : 'Telegram is not delivering messages to this bot')+'</li>'+
      '<li><b>Waiting to be processed:</b> '+esc(String(r.pending_updates))+'</li>'+
      (r.last_error ? '<li><b>Last problem reported:</b> '+esc(r.last_error)+(r.last_error_at ? ' <span class="muted">('+esc(fmtTime(r.last_error_at))+')</span>' : '')+'</li>' : '')+
      '</ul><p>'+action+'</p>';
    wrap.hidden = false;
    wrap.open = true;
  }
  const summary = r.configured
    ? (r.last_error ? 'Needs attention' : 'Connected')
    : 'Needs attention';
  toast(summary + ' — see connection details');
}
async function disconnectBot(btn){
  if (!await confirmModal('Disconnect Telegram', 'Your bot stops replying to subscribers and updates can no longer be sent. Commands, offers and subscribers stay in YourRank, and your connect code is kept encrypted so you can reconnect without pasting it again.', 'Disconnect', true)) return;
  setLoading(btn, 'Disconnecting…');
  const r = await api('/bots/'+btn.dataset.id+'/disconnect',{method:'POST'});
  if (r.error) { restoreBtn(btn); return toast(r.error); }
  toast(r.webhook_removed ? 'Bot disconnected' : 'Bot disconnected, but Telegram could not remove the connection. Delete it manually in @BotFather if needed.');
  const bot = __lastBots.find(b => b.id === btn.dataset.id); if (bot) bot.status = 'revoked';
  restoreBtn(btn); renderBots(__lastBots, false);
}
async function reconnectBot(btn){
  setLoading(btn, 'Reconnecting…');
  const r = await api('/bots/'+btn.dataset.id+'/reconnect',{method:'POST'});
  if (r.error) { restoreBtn(btn); return toast(r.error); }
  toast('Bot @'+r.username+' reconnected');
  const bot = __lastBots.find(b => b.id === btn.dataset.id); if (bot) bot.status = 'active';
  delete __botAttention[btn.dataset.id];
  restoreBtn(btn); renderBots(__lastBots, false);
}
async function syncCommands(btn){
  setLoading(btn, 'Syncing…');
  const r = await api('/bots/'+btn.dataset.id+'/sync-commands',{method:'POST'});
  if (r.error) { restoreBtn(btn); return toast(r.error); }
  toast('Commands synced');
  const bot = __lastBots.find(b => b.id === btn.dataset.id);
  if (bot) bot.last_command_sync_at = r.last_command_sync_at;
  restoreBtn(btn); renderBots(__lastBots, false);
}
async function deleteBot(btn){
  if (!await confirmModal('Delete bot', 'Permanently delete this bot? This cannot be undone.', 'Delete', true)) return;
  setLoading(btn, 'Deleting…');
  const r = await api('/bots/'+btn.dataset.id,{method:'DELETE'});
  if (r.error) { restoreBtn(btn); return toast(r.error); }
  toast('Bot deleted');
  restoreBtn(btn); renderBots(__lastBots.filter(b => b.id !== btn.dataset.id), false);
}
function testMessage(target){
  __testBotId = target.dataset.id;
  const bot = __lastBots.find(b => b.id === __testBotId);
  const name = $('tmBotName'); if (name) name.textContent = bot ? '@'+bot.username : 'your bot';
  const panel = $('testMsgPanel'); if (panel) panel.hidden = false;
  const ci = $('tmChatId'); if (ci) ci.focus();
}
function cancelTestMessage(){
  const panel = $('testMsgPanel'); if (panel) panel.hidden = true;
  const ci = $('tmChatId'); if (ci) ci.value = '';
  const tx = $('tmText'); if (tx) tx.value = '';
  __testBotId = null;
}
async function sendTestMessage(btn){
  clearFieldErr('tmChatId'); clearFieldErr('tmText');
  if (!__testBotId) return toast('Select a bot first');
  const chatId = Number(($('tmChatId').value || '').trim());
  if (!chatId || isNaN(chatId)) { setFieldErr('tmChatId','Enter a valid numeric chat ID'); return; }
  const text = ($('tmText').value || '').trim();
  if (!text) { setFieldErr('tmText','Enter a message'); return; }
  setLoading(btn, 'Sending…');
  const r = await api('/bots/'+__testBotId+'/test-message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text})});
  if (r.error) { restoreBtn(btn); setFieldErr('tmText', r.error + ' — click Send again to retry.'); return; }
  toast('Test message sent');
  restoreBtn(btn); cancelTestMessage();
}

// Render the bot list + select dropdowns from the given bots array. Kept
// separate from load() so mutation handlers can re-render immediately from the
// authoritative mutation response instead of an immediate (stale) re-read.
function renderBots(bots, loadCmds = true){
  bots = bots || [];
  __lastBots = bots;
  const botList = $('botList');
  if (botList) {
    botList.innerHTML = bots.length
      ? '<ul class="tg-row-list tg-bot-list">'+bots.map(b => {
          const state = botConnectionState(b);
          const isActive = b.status === 'active';
          const syncLabel = b.last_command_sync_at ? 'Commands updated '+fmtTime(b.last_command_sync_at) : 'Commands not sent to Telegram yet';
          return '<li class="tg-row tg-bot-row">'+
            '<div class="tg-row-head">'+
              '<div class="tg-row-copy">'+
                '<span class="tg-row-name"><a href="https://t.me/'+esc(b.username)+'" target="_blank" rel="noopener">@'+esc(b.username)+'</a></span>'+
                '<span class="tg-row-meta">'+esc(state.rowText)+'</span>'+
              '</div>'+
              '<span class="tg-state" data-state="'+esc(state.key)+'"><i aria-hidden="true"></i>'+esc(state.label)+'</span>'+
            '</div>'+
            '<div class="tg-row-actions">'+
              (isActive ? '<a class="btn btn--ghost" href="/dashboard/telegram/commands?bot='+encodeURIComponent(b.id)+'">Edit commands</a>' : '')+
              (isActive ? '<button class="btn btn--ghost" data-action="syncCommands" data-id="'+esc(b.id)+'" type="button">Update commands in Telegram</button>' : '')+
              (isActive && page === 'bots' ? '<button class="btn btn--ghost" data-action="testMessage" data-id="'+esc(b.id)+'" type="button">Send test message</button>' : '')+
              (isActive ? '' : '<button class="btn btn--accent" data-action="reconnectBot" data-id="'+esc(b.id)+'" type="button">Reconnect</button>')+
            '</div>'+
            '<details class="health-details tg-row-details" id="health-'+esc(b.id)+'">'+
              '<summary>Connection details</summary>'+
              '<div class="health-body" id="health-body-'+esc(b.id)+'">'+
                '<p class="muted">'+esc(syncLabel)+' · last change '+esc(fmtTime(b.updated_at))+'. Connect code ending …'+esc(b.token_hint)+'.</p>'+
                '<div class="tg-row-details-actions">'+
                  (isActive ? '<button class="btn btn--ghost" data-action="checkHealth" data-id="'+esc(b.id)+'" type="button">Check connection</button>' : '')+
                  (isActive ? '<button class="btn btn--ghost" data-action="disconnectBot" data-id="'+esc(b.id)+'" type="button">Disconnect</button>' : '')+
                  (page === 'bots' ? '<button class="btn btn--ghost danger" data-action="deleteBot" data-id="'+esc(b.id)+'" type="button">Delete bot</button>' : '')+
                '</div>'+
              '</div>'+
            '</details>'+
          '</li>';
        }).join('')+'</ul>'
      : '<p class="muted text-sm">No bot connected yet. Follow the steps below to connect Telegram.</p>';
  }
  renderConnectionState(bots);

  const botSelect = $('botSelect');
  const bcBotSelect = $('bcBotSelect');
  const activeBots = bots.filter(b => b.status === 'active');
  const botOptions = bots.map(b => '<option value="'+esc(b.id)+'">@'+esc(b.username)+' ('+esc(b.status)+')</option>').join('');
  const broadcastBotOptions = activeBots.map(b => '<option value="'+esc(b.id)+'">@'+esc(b.username)+'</option>').join('');
  if (botSelect) { botSelect.innerHTML = botOptions || '<option value="">No bots</option>'; }
  if (bcBotSelect) { bcBotSelect.innerHTML = broadcastBotOptions || '<option value="">No active bots</option>'; }

  firstBotId = activeBots[0]?.id ?? bots[0]?.id ?? null;
  firstBroadcastBotId = activeBots[0]?.id ?? null;
  const requestedBot = requestedBotId && bots.find(b => b.id === requestedBotId);
  if ((!custBotId || !bots.some(b => b.id === custBotId)) && (requestedBot?.id || firstBotId)) custBotId = requestedBot?.id || firstBotId;
  if (!bots.length) custBotId = null;
  if (botSelect && custBotId) botSelect.value = custBotId;
  loadBroadcastDraft();
  if (bcBotSelect && !bcBotSelect.value && firstBroadcastBotId) bcBotSelect.value = firstBroadcastBotId;
  if (bcBotSelect) firstBroadcastBotId = bcBotSelect.value || firstBroadcastBotId;
  setBroadcastAvailability(activeBots.length > 0);
  if (bcBotSelect && firstBroadcastBotId) updateAudience();
  else updateAudience();
  updateScheduleInputState();
  showTimezone();
  if (__planInfo) renderPlanState(__planInfo);

  // customize panel (only on pages that show it)
  if ($('customizePanel') && page === 'commands') {
    const bot = custBotId ? (bots.find(b => b.id === custBotId) || bots[0]) : null;
    if (bot) {
      $('customizePanel').classList.remove('hidden');
      applyCustomizeState(bot);
      if (loadCmds) loadCommands();
    } else {
      $('customizePanel').classList.add('hidden');
    }
  }

  // Hide the "connect a bot first" hint once the user has a bot.
  const commandsHint = $('commandsEmptyHint');
  if (commandsHint) commandsHint.classList.toggle('hidden', page !== 'commands' || bots.length > 0);
}

function setBroadcastAvailability(hasActiveBots){
  const setup = $('bcSetupState');
  const composer = $('bcComposer');
  if (setup) setup.hidden = !__canBroadcast || hasActiveBots;
  if (composer) composer.hidden = !__canBroadcast || !hasActiveBots;
}

// A disconnected bot can't be customized — reflect that by disabling the
// welcome/command inputs and showing a hint, instead of silently accepting
// edits that won't apply until the bot is reconnected.
function applyCustomizeState(bot){
  const active = bot.status === 'active';
  const note = $('custDisabledNote'); if (note) note.classList.toggle('hidden', active);
  const welcome = $('welcomeMsg'); if (welcome) welcome.value = bot.welcome_message || '';
  const nameEl = $('selectedBotName');
  if (nameEl) nameEl.textContent = bot ? 'Selected bot: @' + bot.username : 'No bot selected';
  ['welcomeMsg','cmdName','cmdResp'].forEach(id => { const el = $(id); if (el) el.disabled = !active; });
  const panel = $('customizePanel');
  if (panel) panel.querySelectorAll('[data-action="saveWelcome"],[data-action="addCommand"]').forEach(b => { b.disabled = !active; });
}

function selectBotById(id){
  const bot = __lastBots.find(b => b.id === id);
  if (bot) { custBotId = id; }
  const botSelect = $('botSelect');
  if (botSelect && id) botSelect.value = id;
  if (bot && page === 'commands') {
    const url = new URL(location.href);
    url.searchParams.set('bot', id);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  if ($('customizePanel')) {
    $('customizePanel').classList.toggle('hidden', page !== 'commands' || !id);
    if (bot) applyCustomizeState(bot);
    loadCommands();
  }
}

// ---- bot customization: welcome message + custom slash-commands ----
async function saveWelcome(btn){
  clearFieldErr('welcomeMsg');
  if (!custBotId) return toast('Select a bot first');
  const text = $('welcomeMsg').value.trim();
  setLoading(btn, 'Saving…');
  const r = await api('/bots/'+custBotId,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({welcome_message:text||null})});
  if (r.error) { restoreBtn(btn); setFieldErr('welcomeMsg', r.error + ' — click Save again to retry.'); return; }
  toast(text ? 'Welcome message saved' : 'Default welcome message restored'); restoreBtn(btn);
}
let __commands = [];
let __cmdButtons = [];
function renderCmdButtons(){
  const el = $('cmdButtonList');
  if (!el) return;
  el.innerHTML = (__cmdButtons||[]).map((b,i)=>'<span class="cmd-button-chip">'+esc(b.label)+' <button class="ghost" data-action="removeCommandButton" data-idx="'+i+'" type="button" title="Remove">×</button></span>').join('') || '';
}
function addCommandButton(btn){
  clearFieldErr('cmdBtnLabel'); clearFieldErr('cmdBtnUrl');
  const label = $('cmdBtnLabel').value.trim(), url = $('cmdBtnUrl').value.trim();
  if (!label) { setFieldErr('cmdBtnLabel','Enter a button label'); return; }
  if (!url) { setFieldErr('cmdBtnUrl','Enter a button URL'); return; }
  if (!url.startsWith('http://') && !url.startsWith('https://')) { setFieldErr('cmdBtnUrl','URL must start with http:// or https://'); return; }
  if (__cmdButtons.length >= 10) { setFieldErr('cmdBtnUrl','Max 10 buttons per command'); return; }
  __cmdButtons.push({label, url});
  renderCmdButtons();
  $('cmdBtnLabel').value=''; $('cmdBtnUrl').value=''; $('cmdBtnLabel').focus();
}
function removeCommandButton(target){
  const idx = Number(target.dataset.idx);
  if (Number.isNaN(idx)) return;
  __cmdButtons.splice(idx, 1);
  renderCmdButtons();
}
// Render the custom-commands table from client state. Mutation handlers update
// __commands from their authoritative response and re-render, so the table is
// correct immediately (an immediate re-read can lag behind the write).
function renderCommands(){
  const cmdList = $('cmdList');
  if (!cmdList) return;
  cmdList.innerHTML = (__commands||[]).map(c=>{
    const buttons = Array.isArray(c.buttons) ? c.buttons : [];
    const btnText = buttons.length ? buttons.map(b => esc(b.label)).join(', ') : '–';
    const short = esc((c.response||'').slice(0,60));
    const ellipsis = (c.response||'').length > 60 ? '…' : '';
    return '<tr>'+
    '<td>/'+esc(c.command)+'</td>'+
    '<td class="muted">'+short+ellipsis+'</td>'+
    '<td class="muted">'+btnText+'</td>'+
    '<td class="'+(c.is_enabled?'ok':'off')+'">'+(c.is_enabled?'On':'Off')+'</td>'+
    '<td><button class="ghost" data-action="viewCommand" data-id="'+esc(c.id)+'">View</button> '
        +'<button class="ghost" data-action="testCommand" data-id="'+esc(c.id)+'">Test</button> '
        +'<button class="ghost" data-action="toggleCommand" data-id="'+esc(c.id)+'" data-active="'+(!c.is_enabled)+'">'+(c.is_enabled?'Disable':'Enable')+'</button> '
        +'<button class="ghost" data-action="deleteCommand" data-id="'+esc(c.id)+'">Delete</button></td>'+
  '</tr>';
  }).join('') || '<tr><td colspan="5" class="muted">No custom commands yet.</td></tr>';
}
async function loadCommands(){
  if (!custBotId) return;
  const cmds = await api('/bots/'+custBotId+'/commands');
  if (cmds.error) return toast(cmds.error);
  __commands = cmds || [];
  renderCommands();
}
const RESERVED_COMMANDS = new Set(['start','menu','help','support','code','codes','subscribe','unsubscribe','rank','board','leaderboard']);
function normalizeCommandInput(raw){
  let s = (raw ?? '').trim();
  if (s.startsWith('/')) s = s.slice(1);
  const parts = s.split(/[ \\t\\r\\n@]/);
  return parts[0].toLowerCase();
}
async function addCommand(btn){
  clearFieldErr('cmdName'); clearFieldErr('cmdResp');
  if (!custBotId) return toast('Select a bot first');
  const command = normalizeCommandInput($('cmdName').value);
  const response = $('cmdResp').value.trim();
  if (!command) { setFieldErr('cmdName','Enter a command'); return; }
  if (!response) { setFieldErr('cmdResp','Enter a reply'); return; }
  if (!/^[a-z0-9_]{1,32}$/.test(command)) { setFieldErr('cmdName','Command must be 1-32 chars: letters, numbers, or underscore'); return; }
  if (RESERVED_COMMANDS.has(command)) { setFieldErr('cmdName',"/"+command+" is a built-in command and can't be overridden"); return; }
  if (__commands.some(c => c.command === command)) { setFieldErr('cmdName','/'+command+' already exists for this bot'); return; }
  setLoading(btn, 'Adding…');
  const payload = {command, response};
  if (__cmdButtons.length) payload.buttons = __cmdButtons;
  const r = await api('/bots/'+custBotId+'/commands',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  if (r.error) { restoreBtn(btn); setFieldErr('cmdName', r.error + ' — click Add again to retry.'); return; }
  const i = __commands.findIndex(c => c.id === r.id || c.command === r.command);
  if (i >= 0) __commands[i] = r; else __commands.push(r);
  __commands.sort((a,b)=>a.command.localeCompare(b.command));
  __cmdButtons = [];
  renderCmdButtons();
  renderCommands();
  $('cmdName').value=''; $('cmdResp').value=''; toast('Command saved'); restoreBtn(btn);
  if (r.warning) toast(r.warning);
}
async function toggleCommand(target){
  const on = target.dataset.active === 'true';
  setLoading(target);
  const r = await api('/commands/'+target.dataset.id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({is_enabled:on})});
  if (r.error) { restoreBtn(target); return toast(r.error); }
  const i = __commands.findIndex(c => c.id === target.dataset.id);
  if (i >= 0) __commands[i] = r;
  renderCommands();
  restoreBtn(target);
  if (r.warning) toast(r.warning);
}
async function deleteCommand(target){
  const c = __commands.find(x => x.id === target.dataset.id);
  if (!await confirmModal('Delete command', 'Delete /'+(c?.command||'this command')+'? This cannot be undone.', 'Delete', true)) return;
  setLoading(target, 'Deleting…');
  const r = await api('/commands/'+target.dataset.id,{method:'DELETE'});
  if (r.error) { restoreBtn(target); return toast(r.error); }
  __commands = __commands.filter(c => c.id !== target.dataset.id);
  renderCommands();
  toast(r.warning || 'Command deleted'); restoreBtn(target);
}
function openCommandPreview(id){
  const c = __commands.find(x => x.id === id);
  if (!c) return;
  const wrap = $('cmdPreview');
  if (!wrap) return;
  const name = $('cmdPreviewName');
  const resp = $('cmdPreviewResponse');
  if (name) name.textContent = '/' + c.command;
  if (resp) resp.textContent = c.response || '';
  wrap.hidden = false;
  wrap.dataset.commandId = id;
  const chat = $('cmdTestChatId'); if (chat) chat.focus();
}
function closeCommandPreview(){
  const wrap = $('cmdPreview');
  if (wrap) { wrap.hidden = true; wrap.dataset.commandId = ''; }
  const chat = $('cmdTestChatId'); if (chat) chat.value = '';
}
async function testCommand(target){
  clearFieldErr('cmdTestChatId');
  const id = target.dataset.id || target.closest('[data-command-id]')?.dataset.commandId;
  const c = __commands.find(x => x.id === id);
  if (!c) return toast('Command not found');
  const chatId = Number(($('cmdTestChatId')?.value || '').trim());
  if (!chatId || isNaN(chatId)) { setFieldErr('cmdTestChatId','Enter a valid numeric chat ID'); return; }
  const bot = __lastBots.find(b => b.id === custBotId);
  if (!bot) return toast('Select a bot first');
  setLoading(target, 'Sending…');
  const r = await api('/bots/'+custBotId+'/test-message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId, text:c.response})});
  restoreBtn(target);
  if (r.error) { setFieldErr('cmdTestChatId', r.error + ' — try again.'); return; }
  toast('Test message sent');
}

let __bcAudience = null;
let __bcAudienceTimer = null;
let __bcAudienceRequest = 0;
let __bcPreviewSnapshot = null;
const BC_DRAFT_KEY = 'yr_bc_draft';
function buildSegmentFromForm(){
  const segment = {};
  const lang = ($('bcLang')?.value || '').trim();
  const minLast = Number($('bcMinLastSeen')?.value || '0');
  const firstSeen = Number($('bcFirstSeen')?.value || '0');
  const username = ($('bcUsername')?.value || '').trim();
  if (lang) segment.language = lang;
  if (minLast > 0) segment.minLastSeenDays = minLast;
  if (firstSeen > 0) segment.firstSeenWithinDays = firstSeen;
  if (username) segment.usernameContains = username;
  return Object.keys(segment).length ? segment : null;
}
function getScheduledAt(){
  const v = ($('bcSchedule')?.value || '').trim();
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function isScheduleSelected(){
  const when = document.querySelector('input[name="bcWhen"]:checked');
  return when?.value === 'schedule';
}
function formatSegmentLabel(segment){
  if (!segment) return '';
  const parts = [];
  if (segment.language) parts.push(segment.language);
  if (segment.minLastSeenDays) parts.push('active '+segment.minLastSeenDays+'d');
  if (segment.firstSeenWithinDays) parts.push('new '+segment.firstSeenWithinDays+'d');
  if (segment.usernameContains) parts.push('@'+segment.usernameContains);
  return parts.join(', ');
}
function broadcastDraftSignature(){
  return JSON.stringify({
    body: ($('bcBody')?.value || '').trim(),
    botId: ($('bcBotSelect')?.value || '').trim() || firstBroadcastBotId,
    mediaUrl: ($('bcImage')?.value || '').trim() || null,
    segment: buildSegmentFromForm(),
    when: isScheduleSelected() ? 'schedule' : 'now',
    scheduledAt: isScheduleSelected() ? getScheduledAt() : null,
    audience: __bcAudience,
  });
}
function invalidateBroadcastPreview(){
  if (!__bcPreviewSnapshot || $('bcPreview')?.hidden) return;
  __bcPreviewSnapshot = null;
  closeBroadcastPreview();
  setFormStatus('bcFormStatus','The draft changed after preview. Review it again before sending.',true);
}
function getBotNameForBroadcast(){
  const botId = $('bcBotSelect')?.value || firstBroadcastBotId;
  const select = $('bcBotSelect');
  if (!select || !botId) return '';
  const opt = Array.from(select.options).find(o => o.value === botId);
  return opt?.text || botId;
}
function saveBroadcastDraft(){
  try {
    const draft = {
      body: ($('bcBody')?.value || ''),
      image: ($('bcImage')?.value || ''),
      botId: ($('bcBotSelect')?.value || firstBroadcastBotId || ''),
      lang: ($('bcLang')?.value || ''),
      minLast: ($('bcMinLastSeen')?.value || ''),
      firstSeen: ($('bcFirstSeen')?.value || ''),
      username: ($('bcUsername')?.value || ''),
      when: (document.querySelector('input[name="bcWhen"]:checked'))?.value || 'now',
      schedule: ($('bcSchedule')?.value || ''),
      testChat: ($('bcTestChat')?.value || ''),
    };
    localStorage.setItem(BC_DRAFT_KEY, JSON.stringify(draft));
  } catch { /* storage may be unavailable */ }
}
function loadBroadcastDraft(){
  try {
    const raw = localStorage.getItem(BC_DRAFT_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object') return false;
    if (d.botId && $('bcBotSelect')) ($('bcBotSelect')).value = d.botId;
    if ($('bcBody')) ($('bcBody')).value = d.body || '';
    if ($('bcImage')) ($('bcImage')).value = d.image || '';
    if ($('bcLang')) ($('bcLang')).value = d.lang || '';
    if ($('bcMinLastSeen')) ($('bcMinLastSeen')).value = d.minLast || '';
    if ($('bcFirstSeen')) ($('bcFirstSeen')).value = d.firstSeen || '';
    if ($('bcUsername')) ($('bcUsername')).value = d.username || '';
    if (d.when === 'schedule') {
      const radio = document.querySelector('input[name="bcWhen"][value="schedule"]');
      if (radio) radio.checked = true;
    }
    if ($('bcSchedule')) ($('bcSchedule')).value = d.schedule || '';
    if ($('bcTestChat')) ($('bcTestChat')).value = d.testChat || '';
    const status = $('bcDraftStatus');
    if (status) status.hidden = false;
    return true;
  } catch { return false; }
}
function clearBroadcastDraft(){
  try { localStorage.removeItem(BC_DRAFT_KEY); } catch {}
  const status = $('bcDraftStatus'); if (status) status.hidden = true;
}
function clearBroadcastForm(){
  if ($('bcBody')) ($('bcBody')).value = '';
  if ($('bcImage')) ($('bcImage')).value = '';
  if ($('bcSchedule')) ($('bcSchedule')).value = '';
  if ($('bcUsername')) ($('bcUsername')).value = '';
  if ($('bcMinLastSeen')) ($('bcMinLastSeen')).value = '';
  if ($('bcFirstSeen')) ($('bcFirstSeen')).value = '';
  if ($('bcLang')) ($('bcLang')).value = '';
  const nowRadio = document.querySelector('input[name="bcWhen"][value="now"]');
  if (nowRadio) nowRadio.checked = true;
  updateScheduleInputState();
  clearBroadcastDraft();
}
function updateScheduleInputState(){
  const selected = isScheduleSelected();
  const input = $('bcSchedule');
  if (input) input.disabled = !selected;
  updateUtcHint();
}
function updateUtcHint(){
  const v = getScheduledAt();
  const hint = $('bcUtcHint');
  if (!hint) return;
  if (v) {
    hint.hidden = false;
    const b = hint.querySelector('b');
    if (b) b.textContent = new Date(v).toISOString();
  } else {
    hint.hidden = true;
  }
}
function showTimezone(){
  const el = $('bcTimezone');
  if (!el) return;
  el.textContent = 'Times use your local time.';
}
// Show how many subscribers the selected bot would reach, so the streamer
// knows the blast size before committing. Sequence and signature checks ensure
// a slower response for old filters can never replace the current estimate.
async function updateAudience(requestId){
  const el = $('bcAudience');
  if (!el) return;
  const currentRequest = requestId == null ? ++__bcAudienceRequest : requestId;
  const botId = $('bcBotSelect')?.value || firstBroadcastBotId;
  if (!botId) {
    if (currentRequest === __bcAudienceRequest) {
      __bcAudience = null;
      el.textContent = 'Connect or reconnect Telegram to see who would receive this.';
    }
    return;
  }
  const segment = buildSegmentFromForm();
  const signature = botId+'|'+JSON.stringify(segment);
  el.textContent = 'Updating subscriber count…';
  const qs = '/broadcasts/audience?bot_id='+encodeURIComponent(botId)+(segment ? '&segment='+encodeURIComponent(JSON.stringify(segment)) : '');
  const r = await api(qs);
  const currentBotId = $('bcBotSelect')?.value || firstBroadcastBotId;
  const currentSignature = currentBotId+'|'+JSON.stringify(buildSegmentFromForm());
  if (currentRequest !== __bcAudienceRequest || signature !== currentSignature) return;
  if (!r || r.error) {
    __bcAudience = null;
    el.textContent = "Couldn't work out who would receive this. Change a filter or try again.";
    return;
  }
  __bcAudience = r.count;
  const label = formatSegmentLabel(segment);
  const botName = getBotNameForBroadcast();
  el.innerHTML = 'Goes to <b>'+esc(String(r.count))+'</b> subscriber'+(r.count===1?'':'s')+
    (botName?' of '+esc(botName):'')+
    (label?' <span class="muted">('+esc(label)+')</span>':'')+'.';
}
function scheduleAudienceUpdate(){
  clearTimeout(__bcAudienceTimer);
  __bcAudience = null;
  const requestId = ++__bcAudienceRequest;
  const el = $('bcAudience'); if (el) el.textContent = 'Updating subscriber count…';
  __bcAudienceTimer = setTimeout(() => { updateAudience(requestId); }, 250);
}
function buildSummaryHtml(){
  const body = ($('bcBody')?.value || '').trim();
  const botName = getBotNameForBroadcast();
  const segment = buildSegmentFromForm();
  const segLabel = formatSegmentLabel(segment) || 'all subscribers';
  const scheduled = getScheduledAt();
  const when = isScheduleSelected() && scheduled ? new Date(scheduled).toLocaleString(undefined, {dateStyle:'medium', timeStyle:'short'}) : 'now';
  let html = '';
  html += '<li><b>Bot:</b> '+esc(botName || '—')+'</li>';
  html += '<li><b>Subscribers:</b> '+esc(segLabel)+' ('+esc(String(__bcAudience ?? '–'))+' subscribers)</li>';
  html += '<li><b>When:</b> '+esc(when)+'</li>';
  html += '<li><b>Message:</b> '+esc(body.slice(0,120))+(body.length>120?'…':'')+'</li>';
  const image = ($('bcImage')?.value || '').trim();
  if (image) html += '<li><b>Image:</b> '+esc(image)+'</li>';
  return html;
}
let bcPreviewFocusTrap = null;
function openBroadcastPreview(){
  clearFieldErr('bcBody'); clearFieldErr('bcBotSelect'); clearFormStatus('bcFormStatus');
  if (!__canBroadcast) { setFormStatus('bcFormStatus','Upgrade your plan to compose broadcast messages.',true); return; }
  const body = ($('bcBody')?.value || '').trim();
  if (!body) { setFieldErr('bcBody','Write a message first'); setFormStatus('bcFormStatus','Write a message first',true); return; }
  const botId = ($('bcBotSelect')?.value || '').trim() || firstBroadcastBotId;
  if (!botId) { setFieldErr('bcBotSelect','Select an active bot first'); setFormStatus('bcFormStatus','Select a bot first',true); return; }
  const n = __bcAudience;
  if (typeof n !== 'number') { setFormStatus('bcFormStatus','Wait for the subscriber count to finish loading, then review again.',true); return; }
  if (typeof n === 'number' && n === 0) { setFormStatus('bcFormStatus','This segment has no subscribers yet — nobody would receive it.',true); return; }
  const countEl = $('bcPreviewCount');
  const bodyEl = $('bcPreviewBody');
  if (countEl) countEl.innerHTML = esc(String(n ?? '–'));
  if (bodyEl) bodyEl.innerHTML = esc(body).split('{name}').join('<b>{name}</b>');
  const img = ($('bcImage')?.value || '').trim();
  const imgEl = $('bcPreviewImg');
  if (imgEl) {
    imgEl.innerHTML = img ? '<img src="'+esc(img)+'" alt="" />' : '';
    (imgEl).hidden = !img;
  }
  const summaryList = $('bcSummaryList');
  if (summaryList) summaryList.innerHTML = buildSummaryHtml();
  const summary = $('bcSummary'); if (summary) summary.hidden = false;
  __bcPreviewSnapshot = broadcastDraftSignature();
  renderBroadcastPreviewAction();
  const preview = $('bcPreview'); if (preview) preview.hidden = false;
  const card = preview?.querySelector('.bc-preview-card');
  // Same trap as every other dialog (/assets/dialog.js).
  bcPreviewFocusTrap = card ? window.YRDialog.trap(card, closeBroadcastPreview) : null;
}
function closeBroadcastPreview(){
  const preview = $('bcPreview'); if (preview) preview.hidden = true;
  if (bcPreviewFocusTrap) { bcPreviewFocusTrap(); bcPreviewFocusTrap = null; }
}
function renderBroadcastPreviewAction(){
  const scheduled = isScheduleSelected();
  const when = scheduled ? formatBroadcastDate(getScheduledAt()) : 'now';
  const n = __bcAudience ?? '–';
  const whenEl = $('bcPreviewTiming');
  if (whenEl) whenEl.textContent = scheduled ? 'Sends at '+when+' local time. You can cancel until it starts sending.' : 'Sends immediately and cannot be undone.';
  const label = $('bcPreviewScheduleLabel'); if (label) label.textContent = getScheduledAt() ? formatBroadcastDate(getScheduledAt()) : '(choose a time above)';
  const confirmBtn = $('bcConfirmBtn');
  if (confirmBtn) confirmBtn.textContent = scheduled
    ? 'Send at '+when+' to '+n+' subscribers'
    : 'Send now to '+n+' subscribers';
  document.querySelectorAll('input[name="bcPreviewWhen"]').forEach(r => { r.checked = (r.value === (scheduled ? 'schedule' : 'now')); });
}
function selectBroadcastWhen(input){
  const value = input.value;
  const source = document.querySelector('input[name="bcWhen"][value="'+value+'"]');
  if (source) source.checked = true;
  updateScheduleInputState();
  saveBroadcastDraft();
  if (value === 'schedule' && !getScheduledAt()) {
    closeBroadcastPreview();
    setFormStatus('bcFormStatus','Choose a scheduled time, then review again.',true);
    return;
  }
  __bcPreviewSnapshot = broadcastDraftSignature();
  renderBroadcastPreviewAction();
}
async function confirmSendBroadcast(btn){
  if (!__bcPreviewSnapshot || __bcPreviewSnapshot !== broadcastDraftSignature()) {
    closeBroadcastPreview();
    setFormStatus('bcFormStatus','The draft changed after preview. Review it again before sending.',true);
    return;
  }
  const body = ($('bcBody')?.value || '').trim();
  const botId = ($('bcBotSelect')?.value || '').trim() || firstBroadcastBotId;
  if (!botId || !body) return;
  setLoading(btn, isScheduleSelected() ? 'Scheduling…' : 'Queueing…');
  clearFormStatus('bcFormStatus');
  const mediaUrl = ($('bcImage')?.value || '').trim() || null;
  const scheduledAt = isScheduleSelected() ? getScheduledAt() : null;
  const segment = buildSegmentFromForm();
  const r = await api('/broadcasts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bot_id:botId, body, media_url: mediaUrl, scheduled_at: scheduledAt, segment})});
  if (r.error) { restoreBtn(btn); setFormStatus('bcFormStatus', r.error + ' — review the draft and try again.', true); return; }
  const wasScheduled = isScheduleSelected();
  clearBroadcastForm(); closeBroadcastPreview(); setFormStatus('bcFormStatus', wasScheduled ? 'Update scheduled — you can cancel it until it starts sending' : 'Update sent to your subscribers', false); restoreBtn(btn); loadExtras();
}
async function sendBroadcast(btn){ openBroadcastPreview(); }
// Send a single test copy of the broadcast to one chat ID before blasting.
async function testBroadcast(btn){
  clearFieldErr('bcBody'); clearFieldErr('bcBotSelect'); clearFieldErr('bcTestChat'); clearFormStatus('bcFormStatus');
  const body = $('bcBody').value.trim();
  if (!body) { setFieldErr('bcBody','Write a message first'); setFormStatus('bcFormStatus','Write a message first',true); return; }
  const botId = $('bcBotSelect')?.value || firstBroadcastBotId;
  if (!botId) { setFieldErr('bcBotSelect','Select an active bot first'); setFormStatus('bcFormStatus','Select a bot first',true); return; }
  const chatId = Number(($('bcTestChat')?.value || '').trim());
  if (!chatId || isNaN(chatId)) { setFieldErr('bcTestChat','Enter a valid numeric chat ID'); setFormStatus('bcFormStatus','Enter a valid chat ID',true); return; }
  setLoading(btn, 'Sending…');
  const imageUrl = ($('bcImage')?.value || '').trim() || null;
  const r = await api('/bots/'+botId+'/test-message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId, text:body, image_url: imageUrl})});
  restoreBtn(btn);
  if (r.error) { setFormStatus('bcFormStatus', r.error + ' — click Send test again to retry.', true); return; }
  setFormStatus('bcFormStatus','Test sent — check that chat', false);
}
async function cancelBroadcast(btn){
  if (!await confirmModal('Cancel update', 'This update will not be sent. Your subscribers receive nothing.', 'Cancel update', true)) return;
  setLoading(btn, 'Cancelling…');
  const r = await api('/broadcasts/'+btn.dataset.id,{method:'DELETE'});
  if (r.error) { restoreBtn(btn); return toast(r.error); }
  toast('Update cancelled'); restoreBtn(btn); loadExtras();
}
function setLoading(el, text = 'Loading…') {
  if (!el) return;
  if (el.disabled !== undefined) el.disabled = true;
  // Capture the original label only once so repeated setLoading calls (e.g. a
  // central call plus an action-specific 'Connecting…') don't clobber it.
  if (el.dataset.originalText === undefined) el.dataset.originalText = el.textContent;
  el.textContent = text;
}
function restoreBtn(el) {
  if (!el) return;
  if (el.disabled !== undefined) el.disabled = false;
  if (el.dataset.originalText !== undefined) { el.textContent = el.dataset.originalText; delete el.dataset.originalText; }
}

function boot(){
  const overviewTargets = ['chart','totClicks','subSources','ovBots','ovOffers'];
  if (page === 'overview' && !overviewTargets.some((id) => $(id))) return;
  load().catch((err) => { console.error('[dashboard load]', err); showLoadError(); });
  loadExtras();
}
boot();

function toggleToken(btn) {
  const input = document.getElementById('botToken');
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? 'Hide' : 'Show';
  btn.setAttribute('aria-label', show ? 'Hide code' : 'Show code');
}

async function handleAction(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'toggleToken') { e.preventDefault(); toggleToken(target); return; }
  if (action === 'retryLoad') { e.preventDefault(); location.reload(); return; }
  if (action === 'retryPostbacks') { e.preventDefault(); loadExtras(); return; }
  if (submitting && action !== 'copyLink' && action !== 'copyCreatedOffer') return;
  submitting = true;
  // Show a loading state on the clicked control for every network-backed action.
  // Pure client-side actions (copy, local bot selection) don't need it.
  const NO_LOADING = action === 'copyLink' || action === 'copyCreatedOffer' || action === 'selectBot'
    || action === 'testMessage' || action === 'cancelTestMessage'
    || action === 'sendBroadcast' || action === 'openBroadcastPreview' || action === 'closeBroadcastPreview'
    || action === 'selectBroadcastWhen' || action === 'viewBroadcast' || action === 'closeBroadcastDetail'
    || action === 'viewCommand' || action === 'closeCommandPreview'
    || action === 'wizardNext' || action === 'wizardPrev';
  if (!NO_LOADING) setLoading(target);
  try {
    if (action === 'connectBot') { e.preventDefault(); await connectBot(target); }
    else if (action === 'checkHealth') { e.preventDefault(); await checkHealth(target); }
    else if (action === 'syncCommands') { e.preventDefault(); await syncCommands(target); }
    else if (action === 'disconnectBot') { e.preventDefault(); await disconnectBot(target); }
    else if (action === 'reconnectBot') { e.preventDefault(); await reconnectBot(target); }
    else if (action === 'deleteBot') { e.preventDefault(); await deleteBot(target); }
    else if (action === 'testMessage') { e.preventDefault(); testMessage(target); }
    else if (action === 'sendTestMessage') { e.preventDefault(); await sendTestMessage(target); }
    else if (action === 'cancelTestMessage') { e.preventDefault(); cancelTestMessage(); }
    else if (action === 'selectBot') { e.preventDefault(); selectBotById(target.dataset.id); }
    else if (action === 'wizardNext') { e.preventDefault(); wizardNext(target); }
    else if (action === 'wizardPrev') { e.preventDefault(); wizardPrev(target); }
    else if (action === 'createOffer') { e.preventDefault(); await createOffer(target); }
    else if (action === 'addCommand') { e.preventDefault(); await addCommand(target); }
    else if (action === 'addCommandButton') { e.preventDefault(); addCommandButton(target); }
    else if (action === 'removeCommandButton') { e.preventDefault(); removeCommandButton(target); }
    else if (action === 'saveWelcome') { e.preventDefault(); await saveWelcome(target); }
    else if (action === 'sendBroadcast') { e.preventDefault(); openBroadcastPreview(); }
    else if (action === 'openBroadcastPreview') { e.preventDefault(); openBroadcastPreview(); }
    else if (action === 'confirmBroadcast') { e.preventDefault(); await confirmSendBroadcast(target); }
    else if (action === 'closeBroadcastPreview') { e.preventDefault(); closeBroadcastPreview(); }
    else if (action === 'selectBroadcastWhen') { e.preventDefault(); selectBroadcastWhen(target); }
    else if (action === 'testBroadcast') { e.preventDefault(); await testBroadcast(target); }
    else if (action === 'cancelBroadcast') { e.preventDefault(); await cancelBroadcast(target); }
    else if (action === 'viewBroadcast') { e.preventDefault(); openBroadcastDetail(target.dataset.id); }
    else if (action === 'closeBroadcastDetail') { e.preventDefault(); closeBroadcastDetail(); }
    else if (action === 'retryBroadcasts') { e.preventDefault(); loadExtras(); }
    else if (action === 'copyLink') { e.preventDefault(); await copyLink(target); }
    else if (action === 'copyCreatedOffer') { e.preventDefault(); await copyCreatedOffer(target); }
    else if (action === 'toggleOffer') { e.preventDefault(); await toggleOffer(target); }
    else if (action === 'toggleCommand') { e.preventDefault(); await toggleCommand(target); }
    else if (action === 'deleteCommand') { e.preventDefault(); await deleteCommand(target); }
    else if (action === 'viewCommand') { e.preventDefault(); openCommandPreview(target.dataset.id); }
    else if (action === 'closeCommandPreview') { e.preventDefault(); closeCommandPreview(); }
    else if (action === 'testCommand') { e.preventDefault(); await testCommand(target); }
  } catch (err) {
    console.error('[dashboard action]', action, err);
    toast('Something went wrong — please reload');
  } finally {
    submitting = false;
    restoreBtn(target);
  }
}

document.addEventListener('click', handleAction);
const botSelect = $('botSelect');
if (botSelect) botSelect.addEventListener('change', (e) => { selectBotById(e.target.value); });
const bcBotSelect = $('bcBotSelect');
if (bcBotSelect) bcBotSelect.addEventListener('change', (e) => { firstBroadcastBotId = e.target.value; saveBroadcastDraft(); scheduleAudienceUpdate(); invalidateBroadcastPreview(); });
const bcTestChat = $('bcTestChat');
if (bcTestChat) bcTestChat.addEventListener('input', saveBroadcastDraft);
['bcLang','bcMinLastSeen','bcFirstSeen','bcUsername'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('input', () => { saveBroadcastDraft(); scheduleAudienceUpdate(); invalidateBroadcastPreview(); });
});
['bcBody','bcImage','bcSchedule'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('input', () => { saveBroadcastDraft(); invalidateBroadcastPreview(); });
});
document.querySelectorAll('input[name="bcWhen"]').forEach(radio => {
  radio.addEventListener('change', () => { updateScheduleInputState(); saveBroadcastDraft(); invalidateBroadcastPreview(); });
});
window.addEventListener('beforeunload', (e) => {
  const body = ($('bcBody')?.value || '').trim();
  if (!body) return;
  e.preventDefault();
  e.returnValue = '';
});
['oCasino','oLabel','oUrl','oCode','oBonus'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('input', updateOfferPreview);
});
showTimezone();

window.addEventListener('error', () => {
  const bl = $('botList'); if (bl) bl.textContent = 'Something went wrong. Please reload the page.';
});
window.addEventListener('unhandledrejection', () => {
  const bl = $('botList'); if (bl) bl.textContent = 'Something went wrong. Please reload the page.';
});

`;
}

export function dashClientScript(): string {
  return `<script src="/bot/dash/client.js"></script>`;
}
