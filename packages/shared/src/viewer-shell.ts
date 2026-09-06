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
export function viewerNavigation({ name = 'YourRank', homeHref = '/me', accountHref = '/me', links = [], creatorMark = '', sessionControl = '', signedIn = false }: {
  name?: string; homeHref?: string; accountHref?: string; links?: Destination[]; creatorMark?: string; sessionControl?: string; signedIn?: boolean;
} = {}): string {
  return `<aside class="viewer-rail" aria-label="Viewer navigation">
<a class="viewer-brand" href="${esc(accountHref)}"><span>${brandMarkSvg()}</span>YourRank</a>
${links.length ? `<div class="viewer-context">${creatorMark}<a href="${esc(homeHref)}">${esc(name)}</a><span>Community</span></div>` : ''}
<nav class="viewer-destinations" aria-label="${links.length ? 'Community pages' : 'Viewer pages'}">${(links.length ? links : [{ label: 'My communities', href: accountHref, active: true }]).map(link => `<a href="${esc(link.href)}"${link.active ? ' aria-current="page"' : ''}>${esc(link.label)}</a>`).join('')}</nav>
<div class="viewer-rail-account">${sessionControl}${links.length && signedIn ? `<a href="${esc(accountHref)}">All communities</a>` : ''}<a id="viewer-account-link" href="${esc(accountHref)}#vd-profile"${signedIn ? '' : ' hidden'}>Your account</a><a href="${esc(accountHref.startsWith('https:') ? new URL(accountHref).origin : '')}/contact">Help & contact</a></div>
</aside>`;
}
