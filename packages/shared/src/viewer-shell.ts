import { esc } from './public-render-helpers.js';
import { brandMarkSvg } from './brand-assets.js';

export const VIEWER_DESIGN_CONTRACT = `<!--
THESIS: A viewer's community home.
OWN-WORLD: User-supplied viewer-dashboard.html: ice canvas, white center panel, quiet navigation, blue pills, circular guide and membership rail.
STORY: Select a community, browse its rewards, follow personal claims, return to your memberships.
FIRST VIEWPORT: 212px navigation, flexible center panel, 314px community overview beneath one context bar.
FORM: The supplied HTML is the visual specification. Production routes and scoped records supply all content and actions.
-->`;

type Destination = { label: string; href: string; active?: boolean };
const iconPaths: Record<string, string> = {
  home: '<path d="m3 10 9-7 9 7v11h-7v-7H9v7H3Z"/>',
  leaderboard: '<path d="M8 3h8v7a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v6m-4 1h8"/>',
  gift: '<rect x="3" y="7" width="18" height="5" rx="1.5"/><path d="M5 12v9h14v-9M12 7v14m0-14C7 8 4 3 7 2c3-1 5 5 5 5Zm0 0c5 1 8-4 5-5-3-1-5 5-5 5Z"/>',
  activity: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="20" cy="18" r="2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.4 2.4 0 1 1 4.2 1.5C13 11.2 12 11.5 12 13m0 3h.01"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  coins: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 4 16 4 16 0V6M4 12v6c0 4 16 4 16 0v-6"/>',
  code: '<path d="M4 5h16v5a2 2 0 0 0 0 4v5H4v-5a2 2 0 0 0 0-4Zm10 0v3m0 3v2m0 3v3"/>',
};
export function viewerIcon(name: string): string {
  return `<svg class="viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.arrow}</svg>`;
}

export function viewerAccountOverview(): string {
  return `<aside class="viewer-overview" aria-label="Viewer account overview"><section class="viewer-rail-panel"><div class="viewer-rail-head"><h2>Your community memberships</h2>${viewerIcon('user')}</div><p>Select a community to see its rewards and your activity.</p></section><div class="viewer-scope-help">${viewerIcon('shield')}<p>Credits and claims stay with each community you join.</p></div></aside>`;
}
export function viewerHelpHref(returnTo = '/me', origin = '', tab = 'support'): string {
  return `${origin}/help/${tab}?${new URLSearchParams({ audience: 'viewer', return: returnTo })}`;
}

/** Explicit navigation context wins over a separate creator login cookie. */
export function resolveViewerHelp(url: URL): { returnTo: string } | null {
  if (url.searchParams.get('audience') !== 'viewer') return null;
  const value = url.searchParams.get('return') || '/me';
  try {
    const target = new URL(value, url.origin);
    // Keep the return link on viewer pages and on this origin; never treat it
    // as authorization or accept an arbitrary external redirect destination.
    if (target.origin === url.origin && (target.pathname === '/me' || /^\/[a-z0-9][a-z0-9_-]*(?:\/(?:me|shop|leaderboard|contact))?$/.test(target.pathname)) &&
        !/^\/(?:dashboard|admin|auth|api|help|login|logout)(?:\/|$)/.test(target.pathname)) {
      return { returnTo: target.pathname + target.hash };
    }
  } catch { /* Invalid continuation falls back to the viewer index. */ }
  return { returnTo: '/me' };
}

export function viewerNavigation({ name = 'YourRank', homeHref = '/me', accountHref = '/me', links = [], socialLinks = [], creatorMark = '', sessionControl = '', signedIn = false, helpHref, accountActive = true, helpActive = false, viewerName = '', communityStatus = 'Creator community' }: {
  name?: string; homeHref?: string; accountHref?: string; links?: Destination[]; socialLinks?: Destination[]; creatorMark?: string; sessionControl?: string; signedIn?: boolean; helpHref?: string; accountActive?: boolean; helpActive?: boolean; viewerName?: string; communityStatus?: string;
} = {}): string {
  const help = helpHref || viewerHelpHref('/me', accountHref.startsWith('https:') ? new URL(accountHref).origin : '');
  const names: Record<string, string> = { Home: 'home', Leaderboard: 'leaderboard', 'Reward shop': 'gift', 'My activity': 'activity', 'My communities': 'grid' };
  const mark = creatorMark || `<span class="viewer-avatar">${esc(Array.from(name)[0] || 'Y')}</span>`;
  return `<header class="viewer-topbar"><a class="viewer-brand" href="${esc(links.length ? homeHref : accountHref)}"><span>${brandMarkSvg({ fill: '#2200ff' })}</span><b>yourrank</b><small>Viewer</small></a><span class="viewer-top-title" id="viewer-top-title">${esc(helpActive ? 'Help & contact' : links.find(link => link.active)?.label || 'My communities')}</span><div class="viewer-top-actions"><a class="viewer-icon-button" href="${esc(help)}" aria-label="Help and contact" title="Help and contact">${viewerIcon('help')}</a><details class="viewer-switch"><summary aria-label="Select community">${links.length ? mark : viewerIcon('grid')}<span>${links.length ? esc(name) : 'Select community'}</span>${viewerIcon('down')}</summary><div class="viewer-switch-menu">${links.length ? `<p>Your selected community</p><a href="${esc(homeHref)}">${esc(name)}</a>` : ''}<a href="${esc(accountHref)}">Switch community ${viewerIcon('grid')}</a></div></details><a class="viewer-user" id="viewer-top-avatar" href="${esc(accountHref)}#vd-profile" aria-label="Viewer account${viewerName ? `: ${esc(viewerName)}` : ''}" title="Open viewer account">${viewerIcon('user')}<span>Account</span></a></div></header>
<aside class="viewer-rail" aria-label="Viewer navigation">
<div class="viewer-creator">${links.length ? `${mark}<div><span class="viewer-fine">Current community</span><strong>${esc(name)}</strong><span>${esc(communityStatus)}</span></div>` : '<p>Select a community to open its pages.</p>'}</div>
<nav class="viewer-destinations" aria-label="Community pages">${links.length ? links.map(link => `<a href="${esc(link.href)}"${link.active ? ' aria-current="page"' : ''}>${viewerIcon(names[link.label] || 'arrow')}${esc(link.label)}</a>`).join('') : ['Home','Leaderboard','Reward shop','My activity'].map(label => `<span class="viewer-nav-unavailable" aria-disabled="true">${viewerIcon(names[label])}${label}</span>`).join('')}</nav>
<div class="viewer-rail-account"><p class="viewer-nav-caption">Your account</p>${sessionControl}<a id="viewer-communities-link" href="${esc(accountHref)}"${!links.length && accountActive ? ' aria-current="page"' : ''}>${viewerIcon('grid')}My communities</a><a id="viewer-account-link" href="${esc(accountHref)}#vd-profile"${signedIn ? '' : ' hidden'}>${viewerIcon('user')}Viewer account</a></div>
${socialLinks.length ? `<nav class="viewer-channels" aria-label="${esc(name)} channels">${socialLinks.map(link => `<a href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${esc(link.label)}<span class="yr-sr"> (opens in a new tab)</span></a>`).join('')}</nav>` : ''}
<div class="viewer-sidebar-bottom"><a href="${esc(help)}"${helpActive ? ' aria-current="page"' : ''}>${viewerIcon('help')}Help &amp; contact</a><p><strong>Your people. Your place.</strong><br>Made for the other side of the stream.</p></div>

</aside>`;
}
