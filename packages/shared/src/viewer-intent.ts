/**
 * Guest authentication intent for a community site.
 *
 * Every guest CTA on a public community page (rail, hero, rewards, activity)
 * points at the community's own `/me` page with an `intent` query parameter.
 * That page is the single sign-in gate: it names what the visitor was doing,
 * offers every available provider, and only then starts OAuth with a
 * `returnTo` derived from the validated intent — never from the raw URL.
 */

export const VIEWER_INTENTS = ['signin', 'join', 'activity', 'reward'] as const;
export type ViewerIntent = (typeof VIEWER_INTENTS)[number];

export interface ViewerAuthIntent {
  intent: ViewerIntent;
  /** Reward being reviewed; only present for `reward`. */
  rewardId: string;
}

const REWARD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VALID_INTENTS: ReadonlySet<string> = new Set(VIEWER_INTENTS);

export function isViewerIntent(value: unknown): value is ViewerIntent {
  return typeof value === 'string' && VALID_INTENTS.has(value);
}

/** Read and validate the intent from a request URL; anything else is a plain sign-in. */
export function parseViewerIntent(url: URL): ViewerAuthIntent {
  const raw = url.searchParams.get('intent') || '';
  const intent: ViewerIntent = isViewerIntent(raw) ? raw : 'signin';
  const reward = url.searchParams.get('reward') || '';
  if (intent === 'reward') {
    return REWARD_ID.test(reward) ? { intent, rewardId: reward } : { intent: 'signin', rewardId: '' };
  }
  return { intent, rewardId: '' };
}

/** Href of the community gate page (`meHref` is the community's `/me` section). */
export function guestGateHref(meHref: string, intent: ViewerIntent, rewardId = ''): string {
  if (intent === 'signin') return meHref;
  const query = new URLSearchParams({ intent });
  if (intent === 'reward' && REWARD_ID.test(rewardId)) query.set('reward', rewardId);
  return `${meHref}?${query.toString()}`;
}

export interface ViewerIntentHrefs {
  homeHref: string;
  meHref: string;
  shopHref: string;
}

/** Where a successful sign-in lands: the screen the visitor asked for, never an action. */
export function viewerIntentReturnTo({ intent, rewardId }: ViewerAuthIntent, hrefs: ViewerIntentHrefs): string {
  switch (intent) {
    case 'join':
    case 'activity':
      return hrefs.meHref;
    case 'reward':
      return rewardId ? `${hrefs.shopHref}#reward-${rewardId}` : hrefs.shopHref;
    default:
      return hrefs.homeHref;
  }
}

export interface ViewerIntentCopy {
  heading: string;
  body: string;
  /** Provider button label prefix, e.g. "Join with" → "Join with Kick". */
  action: string;
}

export function viewerIntentCopy({ intent }: ViewerAuthIntent, community: string, rewardName = ''): ViewerIntentCopy {
  switch (intent) {
    case 'join':
      return {
        heading: `Join ${community}`,
        body: `Sign in and we'll add you to ${community} right away. Your credits, claims and activity for this community stay together here.`,
        action: 'Join with',
      };
    case 'activity':
      return {
        heading: 'See your activity',
        body: `Sign in to see your credits, reward claims and participation in ${community}.`,
        action: 'Sign in with',
      };
    case 'reward':
      return {
        heading: rewardName ? `Review ${rewardName}` : 'Review this reward',
        body: `Sign in to see your credits next to this reward in ${community}. You'll review it before anything is claimed.`,
        action: 'Sign in with',
      };
    default:
      return {
        heading: `Sign in to ${community}`,
        body: `Sign in to see your credits and rewards in ${community}. Your credits stay with this community.`,
        action: 'Sign in with',
      };
  }
}
