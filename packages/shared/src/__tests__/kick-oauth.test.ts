import { describe, expect, it, mock } from 'bun:test';
import { buildKickAuthorizeURL, postKickChatMessage } from '../kick-oauth';

const env = { KICK_CLIENT_ID: 'client-1', KICK_CLIENT_SECRET: 'secret-1' };

describe('buildKickAuthorizeURL', () => {
  it('requests chat:write in the default creator scope', () => {
    const url = buildKickAuthorizeURL(env, 'state-1', 'challenge-1');
    expect(new URL(url).searchParams.get('scope')).toBe(
      'user:read channel:read channel:rewards:read channel:rewards:write events:subscribe chat:write'
    );
  });
});

describe('postKickChatMessage', () => {
  const withFetch = async (impl: any, fn: (calls: any[]) => void | Promise<void>) => {
    const calls: any[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = mock(async (input: any, init: any) => {
      calls.push({ input, init });
      return impl(input, init);
    }) as any;
    try {
      await fn(calls);
    } finally {
      globalThis.fetch = realFetch;
    }
  };

  it('posts a user message with the broadcaster id and reply link', async () => {
    await withFetch(() => new Response('{}', { status: 200 }), async (calls) => {
      await postKickChatMessage('tok-1', {
        broadcasterUserId: '111',
        content: '@viewer Bracket is full.',
        replyToMessageId: 'msg-9',
      });
      expect(calls).toHaveLength(1);
      expect(String(calls[0].input)).toBe('https://api.kick.com/public/v1/chat');
      expect(calls[0].init.method).toBe('POST');
      expect(calls[0].init.headers.authorization).toBe('Bearer tok-1');
      expect(JSON.parse(calls[0].init.body)).toEqual({
        type: 'user',
        broadcaster_user_id: 111,
        content: '@viewer Bracket is full.',
        reply_to_message_id: 'msg-9',
      });
    });
  });

  it('omits reply_to_message_id when there is nothing to reply to', async () => {
    await withFetch(() => new Response('{}', { status: 200 }), async (calls) => {
      await postKickChatMessage('tok-1', { broadcasterUserId: 111, content: 'hi' });
      expect(JSON.parse(calls[0].init.body)).toEqual({
        type: 'user',
        broadcaster_user_id: 111,
        content: 'hi',
      });
    });
  });

  it('throws the status and response body on failure', async () => {
    await withFetch(() => new Response('nope', { status: 401 }), async () => {
      await expect(
        postKickChatMessage('tok-1', { broadcasterUserId: 111, content: 'hi' })
      ).rejects.toThrow('Kick chat post failed 401: nope');
    });
  });
});
