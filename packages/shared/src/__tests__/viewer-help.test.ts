import { describe, expect, it } from 'bun:test';
import { resolveViewerHelp, viewerHelpHref } from '../viewer-shell.js';

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
