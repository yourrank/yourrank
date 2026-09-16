import { describe, expect, it } from 'bun:test';
import { resolveViewerHelp, viewerAccountHref, viewerCommunityParam, viewerHelpHref, viewerNavigation, viewerReturnCommunity } from '../viewer-shell.js';

describe('viewer help continuation', () => {
  it('preserves viewer context through support and feedback', () => {
    for (const tab of ['support', 'feedback']) {
      const url = new URL(viewerHelpHref('/creator/shop', '', tab), 'https://yourrank.site');
      expect(url.pathname).toBe(`/help/${tab}`);
      expect(resolveViewerHelp(url)).toEqual({ returnTo: '/creator/shop' });
    }
    expect(resolveViewerHelp(new URL('https://yourrank.site/help/support'))).toBeNull();
  });
  it('rejects external and creator-dashboard return destinations', () => {
    for (const target of ['https://evil.test/me', '//evil.test/me', '/dashboard', '/dashboard/rewards', '/admin', 'javascript:alert(1)']) {
      expect(resolveViewerHelp(new URL(viewerHelpHref(target), 'https://yourrank.site'))).toEqual({ returnTo: '/me' });
    }
  });
});

describe('viewer account return context', () => {
  it('carries the originating community into the account page and back through Help', () => {
    expect(viewerAccountHref('creator')).toBe('/me?community=creator');
    expect(viewerAccountHref('creator', 'https://yourrank.site')).toBe('https://yourrank.site/me?community=creator');
    expect(viewerAccountHref()).toBe('/me');
    const url = new URL(viewerHelpHref('/me?community=creator#vd-profile'), 'https://yourrank.site');
    expect(resolveViewerHelp(url)).toEqual({ returnTo: '/me?community=creator#vd-profile' });
    expect(viewerReturnCommunity('/me?community=creator')).toBe('creator');
    expect(viewerReturnCommunity('/creator/shop')).toBe('creator');
    expect(viewerReturnCommunity('/me')).toBe('');
  });
  it('drops unsupported community values instead of trusting them', () => {
    for (const bad of ['Creator', '../me', 'a b', 'https://evil.test', 'x'.repeat(80)]) {
      expect(viewerCommunityParam(new URL(`https://yourrank.site/me?community=${encodeURIComponent(bad)}`))).toBe('');
      expect(resolveViewerHelp(new URL(viewerHelpHref(`/me?community=${encodeURIComponent(bad)}`), 'https://yourrank.site'))).toEqual({ returnTo: '/me' });
    }
    expect(resolveViewerHelp(new URL(viewerHelpHref('/me?next=https://evil.test'), 'https://yourrank.site'))).toEqual({ returnTo: '/me' });
  });
  it('renders a way back to the community in the account rail without claiming membership', () => {
    const html = viewerNavigation({ accountHref: '/me?community=creator', community: { name: 'Creator <One>', href: '/creator' } });
    expect(html).toContain('<a class="viewer-return" href="/creator">');
    expect(html).toContain('<small>Back to community</small>Creator &lt;One&gt;');
    expect(html).toContain('id="viewer-communities-link" href="/me?community=creator"');
    expect(html).toContain('href="/me?community=creator#vd-profile"');
    expect(html).toContain('return=%2Fme%3Fcommunity%3Dcreator');
    expect(html).not.toContain('Your memberships');
    expect(viewerNavigation()).not.toContain('viewer-return');
  });
});
