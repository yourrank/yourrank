// Isolated visual audit: real renderers/assets, synthetic API responses only.
// Does not certify authentication, provider delivery, or persistence.
import { createServer } from 'node:http';
import { PAGES } from '../apps/leaderboard/src/pages.jsx';
import { resolveFragment, renderFragmentPayload } from '../apps/leaderboard/src/index.js';
import { leaderboardPageHtml } from '../packages/shared/dist/page-shell.js';
import { ASSETS } from '../apps/leaderboard/src/assets_bundled.js';
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
const activities = Array.from({ length: 7 }, (_, i) => ({ id: `drop-${i}`, title: i === 0 ? 'Community celebration with an unusually long activity title' : `Community drop ${i + 1}`, type: 'drop', source: { kind: 'code_drop' }, typeLabel: 'Code drop', state: i < 3 ? 'open' : 'ended', stateLabel: i < 3 ? 'Open' : 'Ended', createdAt: now, endsAt: new Date(Date.now() + 86400000).toISOString(), reward: { creditsPerClaim: 250 }, progress: { claimed: 32, capacity: 100 }, actions: { canEnd: i < 3 } }));
const members = Array.from({ length: 12 }, (_, i) => ({ id: `member-${i}`, displayName: i === 1 ? name : `Community member ${i + 1}`, linkedIdentities: [{ provider: 'kick' }], balance: 1250 + i * 100, totalEarned: 12000, totalSpent: 500, joinedAt: now, lastSeenAt: now }));
const shopItems = Array.from({ length: 4 }, (_, i) => ({ id: `reward-${i}`, name: i === 1 ? 'Choose the theme for our next community celebration stream' : ['Community shout-out', '', 'Suggest a stream topic', 'Choose a community emote'][i], description: 'A creator reward for participating in the community. Claim it with earned credits.', cost: 500 + i * 250, stock: null, active: true, cooldown_seconds: 0 }));
const claims = members.slice(0, 4).map((m, i) => ({ id: `redemption:claim-${i}`, source: { id: `claim-${i}`, title: shopItems[i].name }, subject: { displayName: m.displayName }, reward: shopItems[i], status: 'submitted', statusLabel: 'Needs fulfillment', submittedAt: now }));
const credits = { ok: true, enabled: true, channel: { connected: true, name: 'community', externalId: '123', status: 'authorized', statusLabel: 'Connected' }, shopItems, mappings: [{ id: 'mapping-1', kick_reward_title: 'Community participation bonus with a longer reward title', kick_reward_id: 'kick-1', kick_reward_cost: 150, credits: 200, active: true }], usage: { shopItems: 4, rewardMappings: 1, pendingRedemptions: 4, redemptionsPer30Days: 16, newViewersPer30Days: 24 }, limits: { shopItems: 50, rewardMappings: 50, pendingRedemptions: 100, redemptionsPer30Days: 1000, newViewersPer30Days: 1000 }, viewerAuth: {}, capabilities: { manageRewards: true, manageConnections: true, manageClaims: true, manageMembers: true } };
let mode = 'populated';
const json = (res, body, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const html = (res, body) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body); };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:8915');
    const path = url.pathname;
    if (path === '/__fixture') { mode = url.searchParams.get('mode') || 'populated'; return json(res, { mode }); }
    if (ASSETS[path]) { const [body] = ASSETS[path]; res.writeHead(200, { 'content-type': path.endsWith('.css') ? 'text/css' : 'text/javascript' }); return res.end(body); }
    if (path === '/bot/dash/client.js') { res.setHeader('content-type', 'text/javascript'); return res.end(clientScriptSource()); }
    if (path === '/dashboard/_content') { const fragment = resolveFragment(url.searchParams.get('path')); if (fragment) return json(res, await renderFragmentPayload(PAGES[fragment.pageKey], { user, tab: fragment.tab })); return json(res, {}, 404); }
    if (path.startsWith('/dashboard/telegram')) return html(res, appHtml(user, 'http://127.0.0.1:8915', 'fixture', path.split('/')[3] || 'overview', undefined, { botUsername: 'community_bot', botStatus: 'active' }));
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
    if (path === '/api/credits/status') return json(res, empty ? { ...credits, shopItems: [], mappings: [] } : credits);
    if (path === '/api/activities') return json(res, { activities: empty ? [] : activities, total: empty ? 0 : activities.length, page: { hasMore: false, nextCursor: null }, automation: { templates: [], schedules: [], entitlement: { canAutomate: true } } });
    if (path === '/api/people/members') return json(res, { members: empty ? [] : members, total: empty ? 0 : members.length, page: { hasMore: false, nextCursor: null } });
    if (path === '/api/claims') return json(res, { claims: empty ? [] : claims, total: empty ? 0 : claims.length, page: { hasMore: false, nextCursor: null } });
    if (path === '/api/people/reviews') return json(res, { reviews: empty ? [] : [{ id: 'review-1', status: 'pending', subject: { displayName: name }, reason: { label: 'Eligibility needs review' }, typeLabel: 'Signup review', source: { title: 'Community signup' }, createdAt: now }], counts: { pending: empty ? 0 : 1 } });
    if (path === '/api/credits/activity') return json(res, { events: empty ? [] : members.slice(0, 5).map((m, i) => ({ id: `entry-${i}`, kickUsername: m.displayName, amount: 250, type: 'earn', direction: 'credit', description: 'Community activity reward', createdAt: now })), nextCursor: null });
    if (path === '/api/site/team') return json(res, { ok: true, members: empty ? [] : [{ id: 'moderator-1', user_id: 'moderator-1', email: 'moderator-with-a-long-address@example.test', role: 'moderator', display_name: name }], invites: [], role: 'owner' });
    if (path === '/api/insights') return json(res, { window: { effectiveDays: 30 }, community: { newMembers: empty ? 0 : 24 }, participation: { participants: empty ? 0 : 68 }, rewards: { claimsCompleted: empty ? 0 : 19 } });
    if (path === '/api/home/activity') return json(res, { events: empty ? [] : members.slice(0, 8).map(m => ({ kind: 'membership', at: now, title: m.displayName + ' joined the community', detail: 'Community membership' })) });
    if (path === '/bot/dash/api/me') return json(res, user);
    if (path === '/bot/dash/api/offers' || path === '/bot/dash/api/stats/daily') return json(res, []);
    if (path === '/bot/dash/api/bots') return json(res, empty ? [] : [{ id: 'fixture-bot', username: 'community_bot', status: 'active', subscriber_count: 128 }]);
    if (path === '/bot/dash/api/stats/subscribers') return json(res, { total: 128, sources: [] });
    if (path === '/api/giveaways/chat') return json(res, { ok: true, state: null, entries: [] });
    if (path === '/dashboard/preview') return html(res, '<!doctype html><p>Isolated audit preview</p>');
    if (path.startsWith('/api/') || path.startsWith('/bot/')) return json(res, { ok: true, items: [], events: [], sessions: [], bots: [], broadcasts: [], commands: [], accounts: [], stats: {}, usage: {}, billing: {}, data: {}, connected: false });
    res.writeHead(404).end('Not found');
  } catch (error) { console.error(error); res.writeHead(500).end('Fixture renderer failed'); }
});
server.listen(8915, '127.0.0.1', () => console.log('Dashboard audit fixture http://127.0.0.1:8915'));
