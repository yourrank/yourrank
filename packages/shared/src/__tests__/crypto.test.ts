// ============================================================================
//  YourRank — SHARED CRYPTO HELPERS (real executable tests)
// ============================================================================

process.env.TOKEN_ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.IP_HASH_SALT = 'test-salt-value';

import { describe, it, expect } from 'bun:test';
import {
  encryptToken,
  decryptToken,
  encrypt,
  decrypt,
  decryptCredential,
  verifyHmacSha256Hex,
  safeEqual,
  newLinkSlug,
  newClickRef,
  newPostbackKey,
  newWebhookSecret,
  bytesToHex,
  hexToBytes,
  hashIp,
} from '../crypto';

// ----------------------------------------------------------------------------
// encryptToken / decryptToken (Buffer-based, uses TOKEN_ENC_KEY env)
// ----------------------------------------------------------------------------

describe('encryptToken / decryptToken', () => {
  it('round-trips a plaintext string', async () => {
    const plaintext = 'hello-world-token-123';
    const blob = await encryptToken(plaintext);
    const recovered = await decryptToken(blob);
    expect(recovered).toBe(plaintext);
  });

  it('round-trips an empty string', async () => {
    const blob = await encryptToken('');
    const recovered = await decryptToken(blob);
    expect(recovered).toBe('');
  });

  it('round-trips unicode', async () => {
    const plaintext = 'مرحبا café résumé 🎉';
    const blob = await encryptToken(plaintext);
    const recovered = await decryptToken(blob);
    expect(recovered).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', async () => {
    const plaintext = 'same-input';
    const blob1 = await encryptToken(plaintext);
    const blob2 = await encryptToken(plaintext);
    expect(blob1.equals(blob2)).toBe(false);
    // But both decrypt to the same value
    expect(await decryptToken(blob1)).toBe(plaintext);
    expect(await decryptToken(blob2)).toBe(plaintext);
  });

  it('starts with v1: version prefix', async () => {
    const blob = await encryptToken('test');
    const prefix = blob.toString('latin1', 0, 3);
    expect(prefix).toBe('v1:');
  });
});

// ----------------------------------------------------------------------------
// encrypt / decrypt (hex-string-based, generic API with explicit key)
// ----------------------------------------------------------------------------

describe('encrypt / decrypt (generic hex API)', () => {
  const hexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('round-trips a plaintext string', async () => {
    const plaintext = 'generic-encrypt-test';
    const ciphertext = await encrypt(plaintext, hexKey);
    const recovered = await decrypt(ciphertext, hexKey);
    expect(recovered).toBe(plaintext);
  });

  it('round-trips an empty string', async () => {
    const ciphertext = await encrypt('', hexKey);
    const recovered = await decrypt(ciphertext, hexKey);
    expect(recovered).toBe('');
  });

  it('produces different ciphertexts for the same plaintext (random IV)', async () => {
    const plaintext = 'same-input';
    const ct1 = await encrypt(plaintext, hexKey);
    const ct2 = await encrypt(plaintext, hexKey);
    expect(ct1).not.toBe(ct2);
    // But both decrypt to the same value
    expect(await decrypt(ct1, hexKey)).toBe(plaintext);
    expect(await decrypt(ct2, hexKey)).toBe(plaintext);
  });

  it('output starts with v1: prefix encoded in hex', async () => {
    const ciphertext = await encrypt('test', hexKey);
    // v1: = 76 31 3a in hex
    expect(ciphertext.startsWith('76313a')).toBe(true);
  });
});

describe('decryptCredential', () => {
  it('returns legacy plaintext values unchanged', async () => {
    expect(await decryptCredential('https://discord.example/webhook')).toBe('https://discord.example/webhook');
  });

  it('returns null instead of using malformed ciphertext as a credential', async () => {
    expect(await decryptCredential('a'.repeat(64))).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// verifyHmacSha256Hex
// ----------------------------------------------------------------------------

describe('verifyHmacSha256Hex', () => {
  const secret = 'my-postback-secret';

  it('verifies a correct signature', async () => {
    // Compute a known-good HMAC
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const payload = 'event=conversion&amount=50&click_ref=abc123';
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    const sigHex = Buffer.from(mac as ArrayBuffer).toString('hex');

    const result = await verifyHmacSha256Hex(secret, payload, sigHex);
    expect(result).toBe(true);
  });

  it('rejects an incorrect signature', async () => {
    const payload = 'event=conversion&amount=50';
    const badSig = 'a'.repeat(64);
    const result = await verifyHmacSha256Hex(secret, payload, badSig);
    expect(result).toBe(false);
  });

  it('rejects a truncated signature', async () => {
    const result = await verifyHmacSha256Hex(secret, 'data', 'abc123');
    expect(result).toBe(false);
  });

  it('rejects an empty signature', async () => {
    const result = await verifyHmacSha256Hex(secret, 'data', '');
    expect(result).toBe(false);
  });

  it('handles empty payload', async () => {
    // Compute HMAC of empty string
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(''));
    const sigHex = Buffer.from(mac as ArrayBuffer).toString('hex');

    const result = await verifyHmacSha256Hex(secret, '', sigHex);
    expect(result).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// safeEqual
// ----------------------------------------------------------------------------

describe('safeEqual', () => {
  it('returns true for equal strings', () => {
    expect(safeEqual('hello', 'hello')).toBe(true);
  });

  it('returns false for unequal strings', () => {
    expect(safeEqual('hello', 'world')).toBe(false);
  });

  it('returns false for strings of different lengths', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('returns true for equal empty strings', () => {
    expect(safeEqual('', '')).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// Random value generators
// ----------------------------------------------------------------------------

describe('newLinkSlug', () => {
  it('generates a non-empty string', () => {
    expect(newLinkSlug().length).toBeGreaterThan(0);
  });

  it('generates unique values', () => {
    const a = newLinkSlug();
    const b = newLinkSlug();
    expect(a).not.toBe(b);
  });
});

describe('newClickRef', () => {
  it('generates a non-empty string', () => {
    expect(newClickRef().length).toBeGreaterThan(0);
  });

  it('generates unique values', () => {
    const a = newClickRef();
    const b = newClickRef();
    expect(a).not.toBe(b);
  });
});

describe('newPostbackKey', () => {
  it('generates a non-empty string', () => {
    expect(newPostbackKey().length).toBeGreaterThan(0);
  });

  it('generates unique values', () => {
    const a = newPostbackKey();
    const b = newPostbackKey();
    expect(a).not.toBe(b);
  });
});

describe('newWebhookSecret', () => {
  it('generates a non-empty string', () => {
    expect(newWebhookSecret().length).toBeGreaterThan(0);
  });

  it('generates unique values', () => {
    const a = newWebhookSecret();
    const b = newWebhookSecret();
    expect(a).not.toBe(b);
  });

  it('generates a 48-character hex string (24 bytes)', () => {
    const s = newWebhookSecret();
    expect(s.length).toBe(48);
    expect(/^[0-9a-f]+$/.test(s)).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// bytesToHex / hexToBytes
// ----------------------------------------------------------------------------

describe('bytesToHex / hexToBytes', () => {
  it('round-trips random bytes', () => {
    const original = new Uint8Array([0x00, 0x0f, 0xff, 0xab, 0xcd, 0xef]);
    const hex = bytesToHex(original);
    const recovered = hexToBytes(hex);
    expect([...recovered]).toEqual([...original]);
  });

  it('known vector: all zeros', () => {
    const hex = bytesToHex(new Uint8Array([0, 0, 0]));
    expect(hex).toBe('000000');
    const bytes = hexToBytes('000000');
    expect([...bytes]).toEqual([0, 0, 0]);
  });

  it('known vector: 0xdeadbeef', () => {
    const hex = bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(hex).toBe('deadbeef');
    const bytes = hexToBytes('deadbeef');
    expect([...bytes]).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('produces lowercase hex', () => {
    const hex = bytesToHex(new Uint8Array([0xAB, 0xCD]));
    expect(hex).toBe('abcd');
  });
});

// ----------------------------------------------------------------------------
// hashIp
// ----------------------------------------------------------------------------

describe('hashIp', () => {
  it('returns a Buffer', async () => {
    const result = await hashIp('192.168.1.1');
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('produces consistent output for the same input', async () => {
    const h1 = await hashIp('10.0.0.1');
    const h2 = await hashIp('10.0.0.1');
    expect(h1.equals(h2)).toBe(true);
  });

  it('produces different hashes for different IPs', async () => {
    const h1 = await hashIp('10.0.0.1');
    const h2 = await hashIp('10.0.0.2');
    expect(h1.equals(h2)).toBe(false);
  });

  it('produces a 32-byte SHA-256 hash', async () => {
    const h = await hashIp('127.0.0.1');
    expect(h.length).toBe(32);
  });
});
