import { esc } from './public-render-helpers.js';
import { brandMarkSvg } from './brand-assets.js';

export const VIEWER_DESIGN_CONTRACT = `<!--
THESIS: A connected community guide, not isolated account pages or a credit-wallet dashboard.
OWN-WORLD: Blue channel rail, ice-white content, navy Fira Sans, compact labelled controls, flat working records.
STORY: Know whose community this is, move between its pages, follow personal claims, return to all communities.
FIRST VIEWPORT: Persistent community navigation beside a reading surface. Membership identity and compact balance precede a full-width claims record; optional tasks follow.
FORM: Channel guide, grounded candidate 6, direction seed c2610fb4. Native navigation and disclosures; no decorative entrance motion.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`;

type Destination = { label: string; href: string; active?: boolean };
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

export function viewerNavigation({ name = 'YourRank', homeHref = '/me', accountHref = '/me', links = [], socialLinks = [], creatorMark = '', sessionControl = '', signedIn = false, helpHref, accountActive = true, helpActive = false }: {
  name?: string; homeHref?: string; accountHref?: string; links?: Destination[]; socialLinks?: Destination[]; creatorMark?: string; sessionControl?: string; signedIn?: boolean; helpHref?: string; accountActive?: boolean; helpActive?: boolean;
} = {}): string {
  return `<aside class="viewer-rail" aria-label="Viewer navigation">
<a class="viewer-brand" href="${esc(links.length ? homeHref : accountHref)}"><span>${brandMarkSvg()}</span>YourRank</a>
${links.length ? `<div class="viewer-context">${creatorMark}<a href="${esc(homeHref)}">${esc(name)}</a><span>Community</span></div>` : ''}
<nav class="viewer-destinations" aria-label="${links.length ? 'Community pages' : 'Viewer pages'}">${(links.length ? links : [{ label: 'My communities', href: accountHref, active: accountActive }]).map(link => `<a href="${esc(link.href)}"${link.active ? ' aria-current="page"' : ''}>${esc(link.label)}</a>`).join('')}</nav>
<div class="viewer-rail-account">${sessionControl}${links.length && signedIn ? `<a href="${esc(accountHref)}">My communities</a>` : ''}<a id="viewer-account-link" href="${esc(accountHref)}#vd-profile"${signedIn ? '' : ' hidden'}>Viewer account</a><a href="${esc(helpHref || viewerHelpHref('/me', accountHref.startsWith('https:') ? new URL(accountHref).origin : ''))}"${helpActive ? ' aria-current="page"' : ''}>Help &amp; contact</a></div>
${socialLinks.length ? `<nav class="viewer-channels" aria-label="${esc(name)} channels">${socialLinks.map(link => `<a href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${esc(link.label)}<span class="yr-sr"> (opens in a new tab)</span></a>`).join('')}</nav>` : ''}
</aside>`;
}
