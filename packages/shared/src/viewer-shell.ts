import { esc } from './public-render-helpers.js';
import { brandMarkSvg } from './brand-assets.js';

export const VIEWER_DESIGN_CONTRACT = `<!--
THESIS: A viewer's community home.
OWN-WORLD: A creator destination, not an admin dashboard: the creator's identity leads a dark Home canvas with a podium leaderboard and product-style rewards; the other viewer pages keep their light surfaces until they migrate. A separate YourRank settings shell holds the account.
STORY: Browse a creator's community, follow real standings, redeem rewards, and manage your global viewer identity.
FIRST VIEWPORT: 228px community navigation, 80px context bar and a 320px supporting column. Home uses a 218px rail, 64px bar and 360px supporting column. Account navigation is 252px.
FORM: DESIGN.md owns the composition. Production routes and scoped records supply content and actions; nothing is invented to fill a layout.
-->`;

type Destination = { label: string; href: string; active?: boolean };
const iconPaths: Record<string, string> = {
  home: '<path d="m3 10 9-7 9 7v11h-7v-7H9v7H3Z"/>',
  leaderboard: '<path d="M8 3h8v7a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v6m-4 1h8"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5Z"/><path d="M5 19h14"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  gift: '<rect x="3" y="7" width="18" height="5" rx="1.5"/><path d="M5 12v9h14v-9M12 7v14m0-14C7 8 4 3 7 2c3-1 5 5 5 5Zm0 0c5 1 8-4 5-5-3-1-5 5-5 5Z"/>',
  activity: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.4 2.4 0 1 1 4.2 1.5C13 11.2 12 11.5 12 13m0 3h.01"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  coins: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 4 16 4 16 0V6M4 12v6c0 4 16 4 16 0v-6"/>',
  code: '<path d="M4 5h16v5a2 2 0 0 0 0 4v5H4v-5a2 2 0 0 0 0-4Zm10 0v3m0 3v2m0 3v3"/>',
  link: '<path d="m10 13 4-4m-6 5-2 2a3 3 0 0 0 4 4l4-4a3 3 0 0 0 0-4m2-2 2-2a3 3 0 0 0-4-4L10 8a3 3 0 0 0 0 4"/>',
  bell: '<path d="M5 16h14l-2-3V9a5 5 0 0 0-10 0v4Zm5 4h4"/>',
  logout: '<path d="M10 3H4v18h6m-1-9h12m-4-4 4 4-4 4"/>',
  external: '<path d="M14 3h7v7m0-7-11 11m0-11H3v18h18v-7"/>',
  chat: '<path d="M4 4h16v12H9l-5 4Z"/><path d="M8 9h.01M12 9h.01M16 9h.01"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};
export function viewerIcon(name: string): string {
  return `<svg class="viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.arrow}</svg>`;
}

export function viewerAccountOverview(): string {
  return `<aside class="viewer-overview" aria-label="Viewer account overview"><section class="viewer-rail-panel"><div class="viewer-rail-head"><h2>Your community memberships</h2>${viewerIcon('user')}</div><p>Select a community to see its rewards and your activity.</p></section><div class="viewer-scope-help">${viewerIcon('shield')}<p>Credits and claims stay with each community you join.</p></div></aside>`;
}
export function viewerHelpHref(returnTo = '/me', origin = '', tab = 'support'): string {
  return `${origin}/help${tab === 'help' ? '' : `/${tab}`}?${new URLSearchParams({ audience: 'viewer', return: returnTo })}`;
}

export const VIEWER_COMMUNITY_SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** The global account page, remembering which community the viewer came from. */
export function viewerAccountHref(community = '', origin = ''): string {
  return `${origin}/me${community ? `?community=${encodeURIComponent(community)}` : ''}`;
}

/** The community a viewer page was reached from, or an empty string. */
export function viewerCommunityParam(url: URL): string {
  const value = url.searchParams.get('community') || '';
  return VIEWER_COMMUNITY_SLUG.test(value) ? value : '';
}

/** Explicit navigation context wins over a separate creator login cookie. */
export function resolveViewerHelp(url: URL): { returnTo: string } | null {
  if (url.searchParams.get('audience') !== 'viewer') return null;
  const value = url.searchParams.get('return') || '/me';
  try {
    const target = new URL(value, url.origin);
    // Keep the return link on viewer pages and on this origin; never treat it
    // as authorization or accept an arbitrary external redirect destination.
    if (target.origin === url.origin && target.pathname === '/me') {
      return { returnTo: viewerAccountHref(viewerCommunityParam(target)) + target.hash };
    }
    if (target.origin === url.origin && /^\/[a-z0-9][a-z0-9_-]*(?:\/(?:me|shop(?:\/[A-Za-z0-9_-]{1,64})?|leaderboard|contact))?$/.test(target.pathname) &&
        !/^\/(?:dashboard|admin|auth|api|help|login|logout)(?:\/|$)/.test(target.pathname)) {
      return { returnTo: target.pathname + target.hash };
    }
  } catch { /* Invalid continuation falls back to the viewer index. */ }
  return { returnTo: '/me' };
}

/** The community slug a viewer continuation points at, or an empty string. */
export function viewerReturnCommunity(returnTo: string): string {
  const target = new URL(returnTo, 'https://yourrank.site');
  if (target.pathname === '/me') return viewerCommunityParam(target);
  const slug = target.pathname.split('/')[1] || '';
  return VIEWER_COMMUNITY_SLUG.test(slug) ? slug : '';
}

export type ViewerCommunityReturn = { name: string; href: string };

export function viewerCommunityReturnLink(community: ViewerCommunityReturn | null | undefined, className = 'viewer-return'): string {
  if (!community) return '';
  return `<a class="${className}" href="${esc(community.href)}">${viewerIcon('back')}<span><small>Back to community</small>${esc(community.name)}</span></a>`;
}

export function viewerNavigation({ name = 'YourRank', homeHref = '/me', accountHref = '/me', links = [], socialLinks = [], creatorMark = '', sessionControl = '', signedIn = false, helpHref, accountActive = true, helpActive = false, viewerName = '', communityStatus = 'Creator community', viewerMark = '', balance, tagline = '', watchHref = '', watchLabel = '', community = null, signInHref = '', title = '' }: {
  name?: string; homeHref?: string; accountHref?: string; links?: Destination[]; socialLinks?: Destination[]; creatorMark?: string; sessionControl?: string; signedIn?: boolean; helpHref?: string; accountActive?: boolean; helpActive?: boolean; viewerName?: string; communityStatus?: string; viewerMark?: string; balance?: number; tagline?: string; watchHref?: string; watchLabel?: string; community?: ViewerCommunityReturn | null; signInHref?: string; title?: string;
} = {}): string {
  const account = accountHref.startsWith('https:') ? new URL(accountHref) : null;
  const help = helpHref || viewerHelpHref(account ? account.pathname + account.search : accountHref, account ? account.origin : '');
  const names: Record<string, string> = { Home: 'home', Leaderboard: 'leaderboard', 'Reward shop': 'gift', Rewards: 'gift', 'My activity': 'activity', 'My Activity': 'activity', 'My communities': 'grid' };
  const labels: Record<string, string> = { 'Reward shop': 'Rewards', 'My activity': 'My Activity' };
  const mark = creatorMark || `<span class="viewer-avatar">${esc(Array.from(name)[0] || 'Y')}</span>`;
  const home = links.some(link => link.active && link.label === 'Home');
  // Community pages know the session; pages that don't pass a sign-in target keep the neutral label.
  const guest = !signedIn && !!signInHref;
  const settings = [
    ['vd-profile', 'Profile', 'user'],
    ['vd-connections', 'Connected Accounts', 'link'],
    ['vd-notifications', 'Notifications', 'bell'],
    ['vd-security', 'Privacy & Security', 'shield'],
    ['vd-data', 'Data & Account', 'coins'],
  ];
  // The menu trigger and the rail's close control only work with site-shell.js
  // running, so the server ships them hidden; the footer's section map is the
  // no-script fallback. The rail itself is the compact-width drawer.
  return `<header class="viewer-topbar">
<button class="viewer-menu" id="viewer-menu" type="button" hidden aria-label="Open menu" aria-controls="viewer-rail" aria-expanded="false">${viewerIcon('menu')}</button>
${links.length && !home ? `<a class="viewer-top-community" href="${esc(homeHref)}">${mark}<span><strong data-preview-field="f_name">${esc(name)}</strong><small${tagline ? ' data-preview-field="f_tagline"' : ''}>${esc(tagline || communityStatus)}</small></span></a>` : ''}
<span class="yr-sr" id="viewer-top-title">${esc(helpActive ? 'Help & contact' : title || links.find(link => link.active)?.label || 'My communities')}</span>
<div class="viewer-top-actions">${watchHref && !home ? `<a class="viewer-watch" href="${esc(watchHref)}" target="_blank" rel="noopener noreferrer">${viewerIcon('chat')}Watch on ${esc(watchLabel)}${viewerIcon('external')}</a>` : ''}
<a class="viewer-icon-button" href="${esc(help)}" aria-label="Help and contact" title="Help and contact">${viewerIcon('help')}</a>
<a class="viewer-user" id="viewer-top-avatar" href="${esc(guest ? signInHref : `${accountHref}#vd-profile`)}" aria-label="${guest ? 'Sign in to your viewer account' : `Viewer account${viewerName ? `: ${esc(viewerName)}` : ''}`}" title="${guest ? 'Sign in' : 'Open viewer account'}"><span class="viewer-user-avatar" id="viewer-top-mark">${(!guest && viewerMark) || viewerIcon('user')}</span><span><strong id="viewer-top-name">${esc(guest ? 'Sign in' : viewerName || 'Account')}</strong>${balance != null ? `<small data-credit-balance="${Number(balance) || 0}"><span data-credit-balance-num>${Number(balance).toLocaleString("en-US")}</span> credits</small>` : ''}</span>${viewerIcon('down')}</a></div></header>
<aside class="viewer-rail" id="viewer-rail" aria-label="Viewer navigation" tabindex="-1">
<button class="viewer-rail-close" id="viewer-rail-close" type="button" hidden aria-label="Close menu">${viewerIcon('close')}</button>
${links.length ? `<details class="viewer-switch"><summary aria-label="Select community">${home ? mark : ''}<strong>${esc(name)}</strong>${viewerIcon('down')}</summary><div class="viewer-switch-menu"><p>Your selected community</p><a href="${esc(homeHref)}">${esc(name)}</a><a href="${esc(accountHref)}">Switch community ${viewerIcon('grid')}</a></div></details><nav class="viewer-destinations" aria-label="Community pages">${links.map(link => `<a href="${esc(link.href)}"${link.active ? ' aria-current="page"' : ''}>${viewerIcon(names[link.label] || 'arrow')}${esc(labels[link.label] || link.label)}</a>`).join('')}</nav>` : `<a class="viewer-brand" href="${esc(accountHref)}"><span>${brandMarkSvg({ className: 'viewer-icon' })}</span><b>YourRank</b></a>${viewerCommunityReturnLink(community)}<a class="viewer-back" id="viewer-communities-link" href="${esc(accountHref)}"${accountActive ? ' aria-current="page"' : ''}>${viewerIcon('grid')}My Communities</a><p class="viewer-nav-caption">Account</p><nav class="viewer-destinations" aria-label="Account settings">${settings.map(([id, label, icon]) => `<a ${id === 'vd-profile' ? 'id="viewer-account-link" ' : ''}href="${esc(accountHref)}#${id}">${viewerIcon(icon)}${label}</a>`).join('')}</nav>`}
${socialLinks.length ? `<nav class="viewer-channels" aria-label="${esc(name)} channels"><p class="viewer-nav-caption">Community</p>${socialLinks.map(link => `<a href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${viewerIcon('chat')}<span>${esc(link.label)}</span>${viewerIcon('external')}<span class="yr-sr"> (opens in a new tab)</span></a>`).join('')}</nav>` : ''}
<div class="viewer-sidebar-bottom">${links.length ? `<div class="viewer-rail-account">${sessionControl}<a id="viewer-communities-link" href="${esc(accountHref)}">${viewerIcon('grid')}My communities</a><a id="viewer-account-link" href="${esc(accountHref)}#vd-profile"${signedIn ? '' : ' hidden'}>${viewerIcon('user')}Viewer account</a></div>` : '<button type="button" id="vd-rail-logout" hidden>' + viewerIcon('logout') + 'Log out</button>'}<a href="${esc(help)}"${helpActive ? ' aria-current="page"' : ''}>${viewerIcon('help')}Help &amp; contact</a></div>
</aside>
<div class="viewer-scrim" id="viewer-scrim" hidden></div>`;
}
