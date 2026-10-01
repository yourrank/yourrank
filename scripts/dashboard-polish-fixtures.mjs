// Isolated visual audit: real renderers/assets, synthetic API responses only.
// Does not certify authentication, provider delivery, or persistence.
import { handleDashboardPreview } from '../apps/leaderboard/src/handlers/preview.js';
import { renderSite } from '../packages/shared/dist/site-render.js';
import { rankEventPlayers, validateEventPlayers } from '../packages/shared/dist/event-leaderboards.js';
import { createServer } from 'node:http';
import { PAGES } from '../apps/leaderboard/src/pages.jsx';
import { resolveFragment, renderFragmentPayload } from '../apps/leaderboard/src/index.js';
import { leaderboardPageHtml } from '../packages/shared/dist/page-shell.js';
import { ASSETS } from '../apps/leaderboard/src/assets_bundled.js';
import { buildBracket, canCorrectMatch, resolveByes, isBye, BYE } from '../apps/leaderboard/src/lib/tournament-bracket.js';
import { entryViews, tournamentLifecycle, tournamentViewState } from '../apps/leaderboard/src/lib/tournament-state.js';
import { appHtml } from '../apps/bot/src/dashboard-views/app.ts';
import { clientScriptSource } from '../apps/bot/src/dashboard-views/client-script.ts';

const user = { id: 'fixture-owner', email: 'creator@example.test', display_name: 'Alex Community', plan: 'pro', emailVerified: true, isAdmin: false };
const now = new Date().toISOString();
const name = 'A community member with a long display name';
const site = { ok: true, id: 'fixture-site', siteId: 'fixture-site', slug: 'polish-fixture', name: 'Community after hours', published: true, isDraft: false, publishedAt: now, updatedAt: now, plan: 'pro', role: 'owner', boards: [], archives: [], onboarding: {}, data: { brand: { name: 'Community after hours', tagline: 'A place for the whole community' }, branding: { template: 'cyber_arcade', font: 'Inter' }, rankBy: 'score', players: Array.from({ length: 12 }, (_, i) => ({ name: i === 1 ? name : `Community member ${i + 1}`, score: 98450 - i * 350, rank: i + 1 })), siteSections: { home: true, leaderboard: true, shop: true, me: true, countdown: true }, playerFields: {}, sections: { countdown: true } } };
const secondarySite = { ...site, id: 'second-site', siteId: 'second-site', slug: 'second-community', name: 'Second community', data: { ...site.data, brand: { name: 'Second community' } } };
site.boards = [
  { id: site.id, siteId: site.siteId, slug: site.slug, name: site.name, published: site.published, plan: site.plan },
  { id: secondarySite.id, siteId: secondarySite.siteId, slug: secondarySite.slug, name: secondarySite.name, published: secondarySite.published, plan: secondarySite.plan },
];
secondarySite.boards = site.boards;
const activities = Array.from({ length: 15 }, (_, i) => ({ id: `drop-${i}`, title: i === 0 ? 'Community celebration with an unusually long activity title' : `Community drop ${i + 1}`, type: 'drop', source: { kind: 'code_drop' }, typeLabel: 'Code drop', state: i < 3 ? 'open' : 'ended', stateLabel: i < 3 ? 'Open' : ['Ended by creator', 'Expired', 'Claimed out'][i % 3], createdAt: now, endsAt: new Date(Date.now() + 86400000).toISOString(), reward: { creditsPerClaim: 250 }, progress: { claimed: 32, capacity: 100 }, actions: { canEnd: i < 3 } }));
const activityTemplates = [
  { id: 'template-1', name: 'Stream break drop', kind: 'safe_code_drop', config: { pointsReward: 250, maxClaims: 100, expireMinutes: 30 } },
  { id: 'template-2', name: 'Community milestone celebration with a longer template name', kind: 'safe_code_drop', config: { pointsReward: 1000, maxClaims: 25, expireMinutes: 0 } },
];
const activitySchedules = [
  { id: 'schedule-1', templateId: 'template-1', templateName: 'Stream break drop', status: 'failed', recurrence: 'daily', nextRunAt: new Date(Date.now() + 3600000).toISOString(), attentionMessage: 'The last run failed because the plan changed. Reschedule to try again.' },
  { id: 'schedule-2', templateId: 'template-1', templateName: 'Stream break drop', status: 'scheduled', recurrence: 'weekly', nextRunAt: new Date(Date.now() + 86400000).toISOString() },
  { id: 'schedule-3', templateId: 'template-2', templateName: 'Community milestone celebration with a longer template name', status: 'cancelled', recurrence: 'once', nextRunAt: new Date(Date.now() - 86400000).toISOString() },
];
const members = Array.from({ length: 12 }, (_, i) => ({ id: `member-${i}`, displayName: i === 1 ? name : `Community member ${i + 1}`, linkedIdentities: [{ provider: 'kick' }], balance: 1250 + i * 100, totalEarned: 12000, totalSpent: 500, joinedAt: now, lastSeenAt: now }));
const shopItems = Array.from({ length: 4 }, (_, i) => ({ id: `reward-${i}`, name: i === 1 ? 'Choose the theme for our next community celebration stream' : ['Community shout-out', '', 'Suggest a stream topic', 'Choose a community emote'][i], description: 'A creator reward for participating in the community. Claim it with earned credits.', cost: 500 + i * 250, stock: null, active: true, cooldown_seconds: 0 }));
const claims = members.slice(0, 4).map((m, i) => ({ id: `redemption:claim-${i}`, source: { id: `claim-${i}`, title: shopItems[i].name }, subject: { displayName: m.displayName }, reward: shopItems[i], status: 'submitted', statusLabel: 'Needs fulfillment', submittedAt: now }));
const credits = { ok: true, enabled: true, channel: { connected: true, name: 'community', externalId: '123', status: 'authorized', statusLabel: 'Connected' }, shopItems, mappings: [{ id: 'mapping-1', kick_reward_title: 'Community participation reward with a longer title', kick_reward_id: 'kick-1', kick_reward_cost: 150, credits: 200, active: true }], usage: { shopItems: 4, rewardMappings: 1, pendingRedemptions: 4, redemptionsPer30Days: 16, newViewersPer30Days: 24 }, limits: { shopItems: 50, rewardMappings: 50, pendingRedemptions: 100, redemptionsPer30Days: 1000, newViewersPer30Days: 1000 }, viewerAuth: {}, capabilities: { manageRewards: true, manageConnections: true, manageClaims: true, manageMembers: true } };
const competitions = new Map([[site.id, [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Summer Challenge', published: true, players: [{ name: 'Summer player', score: 42 }], updated_at: now },
  { id: '22222222-2222-4222-8222-222222222222', name: 'September Challenge', published: false, players: [{ name: 'Draft player', score: 18 }], updated_at: now },
]], [secondarySite.id, []]]);
let mode = 'populated';
const giveawayChat = {
  connection: { connected: false, chatReady: false, channelName: null },
  capabilities: { vpnDetection: false },
  session: {
    id: 'fixture-giveaway-session',
    provider: 'manual',
    keyword: '',
    status: 'active',
    started_at: now,
    rules: {
      entryMode: 'chat',
      subscriberOnly: false,
      vipOnly: false,
      excludePreviousWinners: false,
      winnerRepeat: 'once',
      onePerIp: false,
      vpnDetection: false,
      winnerMustRespond: false,
      responseTimeout: 60,
      autoReroll: false,
    },
  },
  entries: ['Mira', 'Jordan'].map((username, i) => ({
    id: `fixture-entrant-${i + 1}`,
    provider: 'manual',
    provider_user_id: `manual:${username.toLowerCase()}`,
    username,
    avatar_url: null,
    message: '',
    badges: [],
    entered_at: now,
    eligibility_status: 'eligible',
    eligibility_reason: null,
    linked: [],
  })),
  winner: null,
  draws: [],
};
// Tournament fixture variants: real buildBracket() output, no hand-written
// rows. FIXTURE_TOURNAMENT selects the shape; `empty` mode still wins.
// setup — unstarted tournament with eligible entries and no bracket.
// completed8 — finished 8-player bracket with a champion.
// live{4,8,16,32} — active bracket with size-1 participants (exactly one
// round-1 BYE) and generated round-1 results.
const tournamentVariant = process.env.FIXTURE_TOURNAMENT || 'completed8';
function buildTournamentFixture(empty) {
  const tournament = { id: `tourn_${tournamentVariant}`, title: 'Community tournament', game_name: '', bracket_size: 8, status: 'completed', signup_state: 'closed', entry_cap: null, format: 'bracket', anti_alt_enabled: false, entry_keyword: '!join', chat_channel: 'community', winner_name: null, created_at: '2026-09-20T14:32:00Z' };
  let matches = [];
  let participants = [];
  const live = /^live(\d+)$/.exec(tournamentVariant);
  const setup = tournamentVariant === 'setup';
  if (setup) {
    tournament.status = 'draft';
    participants = ['seed_1', 'seed_2', 'seed_3', 'seed_4', 'seed_5'];
  } else if (live) {
    const size = Number(live[1]);
    tournament.bracket_size = size;
    tournament.status = 'active';
    participants = Array.from({ length: size - 1 }, (_, i) => `seed_${i + 1}`);
    matches = buildBracket(participants, size);
    // Complete the round-1 matches that have no BYE, alternating winners so
    // both scores and BYE propagation are exercised; scores are generated.
    let scorer = 0;
    for (const m of matches) {
      if (m.round_number !== 1 || m.status === 'completed') continue;
      if (m.player1_name === BYE || m.player2_name === BYE) continue;
      scorer += 1;
      m.status = 'completed';
      m.player1_score = scorer + 1;
      m.player2_score = scorer;
      m.winner_name = scorer % 2 === 0 ? m.player2_name : m.player1_name;
      const next = matches.find((n) => n.round_number === 2 && n.match_index === Math.floor(m.match_index / 2));
      if (next) {
        const slot = m.match_index % 2 === 0 ? 'player1_name' : 'player2_name';
        if (next[slot] === 'TBD' || !next[slot]) next[slot] = m.winner_name;
      }
    }
    // One already-played round-2 match (brackets with a round 3+) so the
    // "downstream played" correction block is exercised: its round-1 feeders
    // stop being correctable while the rest stay open.
    if (Math.log2(size) >= 3) {
      const played = matches.find((m) => m.round_number === 2 && m.match_index === 0
        && m.status === 'pending' && m.player1_name && m.player2_name
        && m.player1_name !== 'TBD' && m.player2_name !== 'TBD'
        && !isBye(m.player1_name) && !isBye(m.player2_name));
      if (played) {
        played.status = 'completed';
        played.player1_score = 4;
        played.player2_score = 2;
        played.winner_name = played.player1_name;
        const final = matches.find((n) => n.round_number === 3 && n.match_index === 0);
        if (final && (final.player1_name === 'TBD' || !final.player1_name)) final.player1_name = played.winner_name;
      }
    }
  } else {
    // completed8: two real entrants; the only real match is scored, the rest
    // of the bracket resolves via BYEs.
    participants = ['seed_1', 'seed_2'];
    matches = buildBracket(participants, 8);
    for (const m of matches) {
      if (m.status === 'completed') continue;
      if (m.player1_name === BYE || m.player2_name === BYE) continue;
      m.status = 'completed';
      m.player1_score = 1;
      m.player2_score = 0;
      m.winner_name = m.player1_name;
    }
    tournament.winner_name = participants[0];
  }
  // API rows carry ids; give the in-memory fixture stable ones for score ops.
  for (const m of matches) m.id = m.id || `m-${m.round_number}-${m.match_index}`;
  const fixtureEntries = participants.map((name, i) => ({ id: `e${i + 1}`, display_name: name, source: 'chat', status: setup ? 'pending' : 'selected', eligible: true, alt_flag: false, alt_reason: null }));
  return { tournament, matches: empty ? [] : matches, fixtureEntries };
}
// Built once so PATCH /score mutations persist across requests.
const tournamentState = buildTournamentFixture(false);

const json = (res, body, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const html = (res, body) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body); };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:8915');
    const path = url.pathname;
    if (path === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (path === '/__fixture') { mode = url.searchParams.get('mode') || 'populated'; return json(res, { mode }); }
    if (ASSETS[path]) { const [body] = ASSETS[path]; res.writeHead(200, { 'content-type': path.endsWith('.css') ? 'text/css' : 'text/javascript' }); return res.end(body); }
    if (path === '/bot/dash/client.js') { res.setHeader('content-type', 'text/javascript'); return res.end(clientScriptSource()); }
    if (path === '/dashboard/_content') { const fragment = resolveFragment(url.searchParams.get('path')); if (fragment) return json(res, await renderFragmentPayload(PAGES[fragment.pageKey], { user, tab: fragment.tab })); return json(res, {}, 404); }
    if (path.startsWith('/dashboard/telegram')) return html(res, appHtml(user, 'http://127.0.0.1:8915', 'fixture', path.split('/')[3] || 'overview', undefined, { botUsername: 'community_bot', botStatus: 'active' }));
    if (path === '/dashboard/preview') {
      let body = ''; for await (const chunk of req) body += chunk;
      const response = await handleDashboardPreview(new Request(url, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body } : {}) }), {}, 'fixture', {
        currentUserImpl: async () => user,
        getUserSiteByIdImpl: async (_env, _user, id) => id === site.id ? site : id === secondarySite.id ? secondarySite : null,
      });
      res.writeHead(response.status, { 'content-type': 'text/html' }); return res.end(await response.text());
    }
    if (path.endsWith('/leaderboard') && !path.startsWith('/dashboard')) {
      const selectedSite = path.startsWith('/' + secondarySite.slug + '/') ? secondarySite : site;
      const event = competitions.get(selectedSite.id).find(item => item.id === url.searchParams.get('event') && item.published);
      if (event) return html(res, await renderSite({ r: { ...selectedSite, data: { ...selectedSite.data, eventId: event.id, eventName: event.name, rankBy: 'score', players: rankEventPlayers(event.players) } }, section: 'leaderboard', opts: { slug: selectedSite.slug, homeUrl: url.origin, nonce: 'fixture' } }));
    }
    if (path.startsWith('/dashboard')) {
      const fragment = resolveFragment(path);
      const page = PAGES[fragment?.pageKey || 'dashboard'];
      const props = { user, tab: fragment?.tab, activePath: path };
      const config = page.configFor ? page.configFor(props) : page.config;
      return html(res, leaderboardPageHtml({ ...config, content: String(await page.Component(props)) }));
    }
    if (path === '/api/auth/me') return json(res, { ok: true, user });
    if (path === '/api/site/list') return json(res, { ok: true, sites: [site, secondarySite] });
    if (path === '/api/site') {
      const requestedSiteId = url.searchParams.get('siteId') || url.searchParams.get('board');
      const selectedSite = requestedSiteId === secondarySite.id ? secondarySite : site;
      return json(res, mode === 'empty' ? { ...selectedSite, data: { ...selectedSite.data, players: [] } } : selectedSite);
    }
    if (mode === 'loading') await new Promise(resolve => setTimeout(resolve, 6000));
    if (mode === 'error' && path.startsWith('/api/')) return json(res, { error: 'Could not load this information. Try again.' }, 503);
    const empty = mode === 'empty';
    const { tournament, fixtureEntries } = tournamentState;
    const matches = tournamentState.matches;
    const counts = {
      active: fixtureEntries.filter((entry) => ['pending', 'confirmed', 'selected'].includes(entry.status)).length,
      eligible: fixtureEntries.filter((entry) => entry.eligible === true).length,
      waitlist: fixtureEntries.filter((entry) => entry.status === 'waitlist').length,
      removed: fixtureEntries.filter((entry) => entry.status === 'removed').length,
      blocked: fixtureEntries.filter((entry) => entry.status === 'blocked').length,
      inactive: fixtureEntries.filter((entry) => ['removed', 'blocked'].includes(entry.status)).length,
    };
    const lifecycle = tournamentLifecycle(tournament, matches.length);
    const listedTournament = { ...tournament, match_count: matches.length, lifecycle, status_label: ({ setup: 'Setup', live: 'Live', finished: 'Finished', cancelled: 'Cancelled' })[lifecycle] };
    if (path === '/api/tournaments' && req.method === 'GET') return json(res, { ok: true, tournaments: empty ? [] : [listedTournament], current_id: empty ? null : tournament.id, chatRegistration: { connected: false, chatReady: false, channelName: null, externalChannelId: null } });
    if (path === `/api/tournaments/${tournament.id}/entries`) {
      const state = tournamentViewState({ tournament, counts, matchCount: matches.length });
      const entries = entryViews(empty ? [] : fixtureEntries, { tournament, matches, lifecycle });
      return json(res, { entries, counts: empty ? { ...counts, active: 0, eligible: 0, waitlist: 0, removed: 0, blocked: 0, inactive: 0 } : counts, state });
    }
    if (path === `/api/tournaments/${tournament.id}/bracket`) return json(res, { matches: empty ? [] : matches.map((m) => ({ ...m, correctable: canCorrectMatch(matches, m).ok })), tournament });
    if (path === `/api/tournaments/${tournament.id}/score` && req.method === 'PATCH') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || '{}');
      const match = matches.find((m) => String(m.id) === String(body.matchId));
      if (!match) return json(res, { error: 'Match not found or unauthorized.' }, 404);
      const decision = canCorrectMatch(matches, match);
      if (!decision.ok) return json(res, { error: match.status === 'completed' ? 'A later match has already been played. Correct that match first.' : 'Match is not correctable.' }, 409);
      const p1 = Number(body.player1Score), p2 = Number(body.player2Score);
      if (!Number.isInteger(p1) || !Number.isInteger(p2) || p1 < 0 || p2 < 0 || p1 === p2) return json(res, { error: 'Scores must be non-negative integers and cannot be tied.' }, 400);
      const winnerName = p1 > p2 ? match.player1_name : match.player2_name;
      const winnerChanged = winnerName !== match.winner_name;
      match.player1_score = p1; match.player2_score = p2; match.winner_name = winnerName;
      if (winnerChanged) {
        for (const step of decision.path) {
          const next = matches.find((n) => n.id === step.id);
          if (!next) continue;
          next[step.slotColumn] = winnerName;
          if (step.byeResolved) { next.status = 'pending'; next.winner_name = null; next.player1_score = 0; next.player2_score = 0; }
        }
        resolveByes(matches);
      }
      const totalRounds = Math.log2(tournament.bracket_size);
      const final = matches.find((m) => m.round_number === totalRounds && m.match_index === 0);
      const isFinals = match.round_number === totalRounds;
      if (tournament.status === 'completed' && final?.status === 'completed' && final.winner_name && !isBye(final.winner_name) && final.winner_name !== tournament.winner_name) {
        tournament.winner_name = final.winner_name;
      }
      return json(res, { ok: true, matchId: match.id, winnerName, winnerChanged, isFinals, message: `Score corrected: ${winnerName} wins the match.` });
    }
    if (path === '/api/site/events') {
      const events = competitions.get(url.searchParams.get('siteId'));
      if (!events) return json(res, { ok: false, error: 'Site not found' }, 404);
      if (req.method === 'GET') return json(res, { ok: true, playerLimit: 1000, events: empty ? [] : events });
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const index = events.findIndex(item => item.id === body.id);
      if (body.id && index < 0) return json(res, { error: 'Event not found' }, 404);
      if (index >= 0 && body.updatedAt !== events[index].updated_at) return json(res, { error: 'This event changed in another window. Reload it before saving.' }, 409);
      if (req.method !== 'DELETE') {
        try { body.players = validateEventPlayers(body.players, 1000); } catch (error) { return json(res, { error: error.message }, 400); }
      }
      if (req.method === 'DELETE') { if (index >= 0) events.splice(index, 1); return json(res, { ok: true }); }
      const event = { ...body, id: body.id || crypto.randomUUID(), updated_at: new Date().toISOString() };
      if (index >= 0) events[index] = event; else events.push(event);
      return json(res, { ok: true, id: event.id });
    }
    if (path === '/api/credits/status') return json(res, empty ? { ...credits, shopItems: [], mappings: [] } : credits);
    if (path === '/api/activities') {
      const state = url.searchParams.get('state') || 'all';
      const matching = empty ? [] : activities.filter((a) => state === 'all' || (state === 'open' ? a.state === 'open' : a.state !== 'open'));
      const limit = Number(url.searchParams.get('limit')) || 50;
      const offset = Number(url.searchParams.get('cursor')) || 0;
      const rows = matching.slice(offset, offset + limit);
      const hasMore = offset + limit < matching.length;
      const canAutomate = mode !== 'free';
      const automation = { templates: empty || !canAutomate ? [] : activityTemplates, schedules: empty || !canAutomate ? [] : activitySchedules, entitlement: canAutomate ? { canAutomate: true } : { canAutomate: false, message: 'Manual code drops remain available on Free. Upgrade to reuse templates and run drops on a schedule.' } };
      return json(res, { activities: rows, total: matching.length, page: { limit, hasMore, nextCursor: hasMore ? String(offset + limit) : null }, ...(offset ? {} : { automation }) });
    }
    if (path === '/api/people/members') return json(res, { members: empty ? [] : members, total: empty ? 0 : members.length, page: { hasMore: false, nextCursor: null } });
    if (path === '/api/claims') return json(res, { claims: empty ? [] : claims, total: empty ? 0 : claims.length, page: { hasMore: false, nextCursor: null } });
    if (path === '/api/people/reviews') return json(res, { reviews: empty ? [] : [{ id: 'review-1', status: 'pending', subject: { displayName: name }, reason: { label: 'Eligibility needs review' }, typeLabel: 'Signup review', source: { title: 'Community signup' }, createdAt: now }], counts: { pending: empty ? 0 : 1 } });
    if (path === '/api/credits/activity') return json(res, { events: empty ? [] : members.slice(0, 5).map((m, i) => ({ id: `entry-${i}`, kickUsername: m.displayName, amount: 250, type: 'earn', direction: 'credit', description: 'Community activity reward', createdAt: now })), nextCursor: null });
    if (path === '/api/site/team') return json(res, { ok: true, members: empty ? [] : [{ id: 'moderator-1', user_id: 'moderator-1', email: 'moderator-with-a-long-address@example.test', role: 'moderator', display_name: name }], invites: [], role: 'owner' });
    if (path === '/api/insights') return json(res, { ok: true, window: { effectiveDays: 30 }, community: { newMembers: empty ? 0 : 24 }, participation: { participants: empty ? 0 : 68 }, rewards: { claimsCompleted: empty ? 0 : 19 } });
    if (path === '/api/home/activity') return json(res, { events: empty ? [] : members.slice(0, 8).map(m => ({ kind: 'membership', at: now, title: m.displayName + ' joined the community', detail: 'Community membership' })) });
    if (path === '/bot/dash/api/me') return json(res, user);
    if (path === '/bot/dash/api/offers' || path === '/bot/dash/api/stats/daily') return json(res, []);
    if (path === '/bot/dash/api/bots') return json(res, empty ? [] : [{ id: 'fixture-bot', username: 'community_bot', status: 'active', subscriber_count: 128 }]);
    if (path === '/bot/dash/api/stats/subscribers') return json(res, { total: 128, sources: [] });
    if (path === '/api/giveaways/chat') return json(res, empty
      ? { ...giveawayChat, session: null, entries: [] }
      : giveawayChat);
    if (path === '/dashboard/preview') return html(res, '<!doctype html><p>Isolated audit preview</p>');
    if (path.startsWith('/api/') || path.startsWith('/bot/')) return json(res, { ok: true, items: [], events: [], sessions: [], bots: [], broadcasts: [], commands: [], accounts: [], stats: {}, usage: {}, billing: {}, data: {}, connected: false });
    res.writeHead(404).end('Not found');
  } catch (error) { console.error(error); res.writeHead(500).end('Fixture renderer failed'); }
});
const port = Number(process.env.FIXTURE_PORT || 8915);
server.listen(port, '127.0.0.1', () => console.log(`Dashboard audit fixture http://127.0.0.1:${port}`));
