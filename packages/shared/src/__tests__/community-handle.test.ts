import { describe, expect, it } from 'bun:test';
import { COMMUNITY_HANDLE_MAX, normalizeCommunityHandle, RESERVED_COMMUNITY_HANDLES, slugifyHandle } from '../community-handle';

describe('normalizeCommunityHandle', () => {
  it('normalizes spaces, case and punctuation and explains the change', () => {
    const r = normalizeCommunityHandle('  Kick Stream!! 2026 ');
    expect(r).toMatchObject({ ok: true, handle: 'kick-stream-2026' });
    expect(r.note).toBe('Saved as yourrank.site/kick-stream-2026 — lowercase letters, numbers and hyphens, up to 40 characters.');
    expect(normalizeCommunityHandle('already-clean')).toEqual({ ok: true, handle: 'already-clean' });
    expect(normalizeCommunityHandle('café_latte')).toMatchObject({ ok: true, handle: 'caf-latte' });
  });

  it('extracts the single path segment from an own-site link without the hostname', () => {
    for (const input of ['https://yourrank.site/My-Handle', 'yourrank.site/my-handle/', 'http://www.yourrank.site/my-handle?utm=x#top', 'https://app.yourrank.site:443/My%20Handle', 'localhost:8787/my-handle', '/my-handle']) {
      const r = normalizeCommunityHandle(input);
      expect(r, input).toMatchObject({ ok: true, handle: 'my-handle' });
      expect(r.handle, input).not.toContain('yourrank');
    }
    expect(normalizeCommunityHandle('https://yourrank.site/My-Handle').note).toBe('Using the handle from your link: yourrank.site/my-handle');
  });

  it('rejects links to other sites instead of turning the hostname into a handle', () => {
    for (const input of ['https://kick.com/streamer', 'twitch.tv/streamer', 'https://example.com', 'notyourrank.site/handle']) {
      const r = normalizeCommunityHandle(input);
      expect(r.ok, input).toBe(false);
      expect(r.reason, input).toBe('external_url');
      expect(r.handle, input).toBe('');
    }
  });

  it('rejects multiple path segments and links with no handle', () => {
    expect(normalizeCommunityHandle('https://yourrank.site/one/leaderboard').reason).toBe('multiple_segments');
    expect(normalizeCommunityHandle('one/two').reason).toBe('multiple_segments');
    expect(normalizeCommunityHandle('one%2Ftwo').reason).toBe('multiple_segments');
    expect(normalizeCommunityHandle('https://yourrank.site/').reason).toBe('empty');
    expect(normalizeCommunityHandle('https://yourrank.site').reason).toBe('empty');
  });

  it('reports empty, invalid, overlong and reserved handles with actionable errors', () => {
    expect(normalizeCommunityHandle('')).toMatchObject({ ok: false, reason: 'empty', error: 'Enter a community handle.' });
    expect(normalizeCommunityHandle('   ')).toMatchObject({ ok: false, reason: 'empty' });
    expect(normalizeCommunityHandle(null)).toMatchObject({ ok: false, reason: 'empty' });
    expect(normalizeCommunityHandle('!!!')).toMatchObject({ ok: false, reason: 'invalid' });
    const long = normalizeCommunityHandle('a'.repeat(COMMUNITY_HANDLE_MAX + 1));
    expect(long).toMatchObject({ ok: false, reason: 'too_long' });
    expect(long.handle).toHaveLength(COMMUNITY_HANDLE_MAX + 1);
    expect(normalizeCommunityHandle('a'.repeat(COMMUNITY_HANDLE_MAX)).ok).toBe(true);
    for (const word of ['demo', 'Dashboard', 'https://yourrank.site/api']) {
      const r = normalizeCommunityHandle(word);
      expect(r, word).toMatchObject({ ok: false, reason: 'reserved', error: 'That handle is reserved by YourRank. Pick another.' });
    }
    expect(normalizeCommunityHandle('custom', new Set(['custom'])).reason).toBe('reserved');
  });

  it('keeps the reserved set equal to the paths the Worker serves itself', () => {
    for (const slug of ['demo', 'dashboard', 'account', 'bot', 'api', 'login']) expect(RESERVED_COMMUNITY_HANDLES.has(slug)).toBe(true);
  });

  it('slugifyHandle never truncates, so overlong input is reported instead of silently cut', () => {
    expect(slugifyHandle('x'.repeat(60))).toHaveLength(60);
  });
});
