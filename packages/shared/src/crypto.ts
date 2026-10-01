// ============================================================================
//  YourRank — SHARED CRYPTO HELPERS (TypeScript)
//
//  Consolidated cryptographic utilities used by BOTH Workers:
//    * AES-256-GCM encrypt/decrypt for token storage
//    * HMAC-SHA256 verification for postback signatures
//    * Random value generation (slugs, keys, tokens)
//    * IP hashing for analytics
//
//  Replaces apps/leaderboard/src/crypto.js and apps/bot/src/crypto.ts
// ============================================================================

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

function getTokenEncKey(): Buffer {
  if (typeof process !== "undefined" && process.env?.TOKEN_ENC_KEY) {
    const hex = process.env.TOKEN_ENC_KEY;
    if (hex.length !== 64) {
      throw new Error(`TOKEN_ENC_KEY must be 64 hex characters (32 bytes), got ${hex.length}`);
    }
    return Buffer.from(hex, "hex");
  }
  throw new Error("TOKEN_ENC_KEY is not configured (must be set by worker.ts before crypto operations)");
}

function getIpHashSalt(): string {
  if (typeof process !== "undefined") {
    const salt = process.env?.IP_HASH_SALT;
    if (!salt) throw new Error("IP_HASH_SALT is not configured (required for IP hashing)");
    return salt;
  }
  throw new Error("IP_HASH_SALT is not configured (must be set by worker.ts before crypto operations)");
}

// ----------------------------------------------------------------------------
// AES-256-GCM encryption/decryption
// ----------------------------------------------------------------------------

// Web Crypto API — available on Node 20+, Bun, and Cloudflare Workers.
// AES-256-GCM. Blob layout: [12-byte iv][ciphertext + 16-byte auth tag].
// (Web Crypto appends the tag to the ciphertext, unlike Node's createCipheriv.)
//
// KEY ROTATION (v1 prefix):
//   All newly encrypted tokens are prefixed with "v1:" (5 bytes) so a future
//   key rotation can introduce "v2:<ciphertext>" using a new key while still
//   decrypting old "v1:" entries with the original key. Legacy tokens (no
//   prefix) also decrypt with the current key.
//
//   To rotate:
//     1. Set a new TOKEN_ENC_KEY_V2 env var (32-byte hex).
//     2. Update this module: map "v2:" to the new key via config.tokenEncKeyV2.
//     3. New encrypts produce "v2:" prefix.
//     4. Run POST /api/admin/reencrypt to re-encrypt all "v1:" tokens with v2.
//     5. Once all tokens are migrated, optionally remove v1 support.

// Current key version prefix embedded in all new ciphertexts.
const CURRENT_KEY_VERSION = "v1";
const VERSION_PREFIX = `${CURRENT_KEY_VERSION}:`;
const VERSION_PREFIX_BYTES = Buffer.from(VERSION_PREFIX);

let _key: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (_key) return _key;
  _key = await crypto.subtle.importKey(
    "raw",
    getTokenEncKey() as BufferSource,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  );
  return _key;
}

/**
 * Resolve which CryptoKey to use for decryption based on the key version
 * prefix embedded in the blob. Legacy blobs (no prefix) use the current key.
 */
async function getKeyForBlob(blob: Buffer | Uint8Array): Promise<{ key: CryptoKey; offset: number }> {
  const b = Buffer.from(blob as Buffer);
  const asString = b.toString("latin1");
  if (asString.startsWith("v1:")) {
    return { key: await getKey(), offset: 3 };
  }
  // Legacy (no prefix) — use current key, offset 0
  return { key: await getKey(), offset: 0 };
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns a hex-encoded string: "v1:" + [12-byte IV][ciphertext+tag]
 */
export async function encryptToken(plaintext: string): Promise<Buffer> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getKey();
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  // Prepend version prefix: "v1:" + [12-byte iv][ciphertext + tag]
  return Buffer.concat([VERSION_PREFIX_BYTES, Buffer.from(iv), Buffer.from(ct)]);
}

/**
 * Decrypt a hex-encoded blob produced by encryptToken().
 * Supports v1: prefix and legacy (no prefix) blobs.
 */
export async function decryptToken(blob: Buffer | Uint8Array): Promise<string> {
  const b = Buffer.from(blob as Buffer);
  const { key, offset } = await getKeyForBlob(b);
  const iv = new Uint8Array(b.subarray(offset, offset + 12));
  const ct = new Uint8Array(b.subarray(offset + 12));
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ct
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * Re-encrypt a token blob: decrypt with the key determined by its prefix,
 * then re-encrypt with the current key (producing a fresh "v1:" prefix).
 * Used by POST /api/admin/reencrypt to migrate legacy tokens.
 */
export async function reencryptToken(blob: Buffer): Promise<Buffer> {
  const plaintext = await decryptToken(blob);
  return encryptToken(plaintext);
}

/** Check if a token blob already has the current key version prefix. */
export function isCurrentVersion(blob: Buffer | Uint8Array): boolean {
  const asString = Buffer.from(blob as Buffer).toString("latin1");
  return asString.startsWith(VERSION_PREFIX);
}

// ----------------------------------------------------------------------------
// JavaScript compatibility layer for leaderboard Worker
// ----------------------------------------------------------------------------

/**
 * Encrypt a plaintext string with AES-256-GCM (JavaScript version).
 * Returns a hex-encoded string: "v1:" + [12-byte IV][ciphertext+tag]
 * This is the legacy function used by the leaderboard Worker.
 */
export async function encrypt(plaintext: string, hexKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(hexKey),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  );
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  // Combine: v1: + iv + ciphertext+tag
  const combined = new Uint8Array(
    VERSION_PREFIX_BYTES.length + iv.length + ct.byteLength
  );
  combined.set(VERSION_PREFIX_BYTES, 0);
  combined.set(iv, VERSION_PREFIX_BYTES.length);
  combined.set(new Uint8Array(ct), VERSION_PREFIX_BYTES.length + iv.length);
  // Store as hex for safe TEXT column storage
  return [...combined].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Decrypt a hex-encoded blob produced by encrypt().
 * Supports v1: prefix and legacy (no prefix) blobs.
 * This is the legacy function used by the leaderboard Worker.
 */
export async function decrypt(blobHex: string, hexKey: string): Promise<string> {
  const bytes = hexToBytes(blobHex);
  const asStr = new TextDecoder("latin1").decode(bytes);
  let offset = 0;
  if (asStr.startsWith(VERSION_PREFIX)) {
    offset = VERSION_PREFIX_BYTES.length;
  }
  const iv = bytes.slice(offset, offset + 12);
  const ct = bytes.slice(offset + 12);
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(hexKey),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  );
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ct
  );
  return new TextDecoder().decode(pt);
}

/**
 * Decrypt a stored credential (e.g. a Discord webhook URL) kept as hex
 * ciphertext. Returns the stored value unchanged when it isn't encrypted
 * (legacy rows or plaintext migration copies), so callers never crash on
 * legacy data. Throws only when TOKEN_ENC_KEY is misconfigured.
 */
export async function decryptCredential(blobHex: string | null | undefined): Promise<string | null> {
  if (!blobHex) return null;
  const value = String(blobHex).trim();
  const hex = (typeof process !== "undefined" && process.env?.TOKEN_ENC_KEY) || "";
  if (hex.length !== 64) throw new Error("TOKEN_ENC_KEY must be 64 hex characters (32 bytes)");
  if (!/^[0-9a-f]+$/i.test(value) || value.length < 56 || value.length % 2 !== 0) {
    return value;
  }
  try {
    return await decrypt(value, hex);
  } catch (error) {
    console.error("[crypto] credential decryption failed:", String((error as Error)?.message || error));
    return null;
  }
}

// ----------------------------------------------------------------------------
// Constant-time comparison
// ----------------------------------------------------------------------------

/**
 * Constant-time string comparison. A plain !== short-circuits on the first
 * differing byte, leaking how close a guess is via timing.  safeEqual always
 * compares the full expected length.
 */
export function safeEqual(a: string, b: string): boolean {
  const sa = new TextEncoder().encode(a);
  const sb = new TextEncoder().encode(b);
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa[i] ^ sb[i];
  return diff === 0;
}

// ----------------------------------------------------------------------------
// Hex encoding helpers
// ----------------------------------------------------------------------------

/** Convert a Uint8Array to a lowercase hex string. */
export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Convert a hex string to a Uint8Array. */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// ----------------------------------------------------------------------------
// Random value generation
// ----------------------------------------------------------------------------

/** Salted hash — we never store raw visitor IPs. */
export async function hashIp(ip: string): Promise<Buffer> {
  const data = new TextEncoder().encode(getIpHashSalt() + ip);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(hash as ArrayBuffer);
}

/** One-way hash for bearer tokens (sessions, password resets). */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(hash as ArrayBuffer));
}

/** Routing id + Telegram secret header value. */
export function newWebhookSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("hex");
}

/** Short, url-safe slug for /r/:slug links. */
export function newLinkSlug(): string {
  // Increased from 4 to 8 bytes (64 bits) to prevent collisions and enumeration.
  // 4 bytes = 32 bits (birthday bound ~65k links) - too low for public URLs.
  // 8 bytes = 64 bits (birthday bound ~4 billion links) - sufficient for production.
  return Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString("base64url");
}

/** Public click reference id — echoed back by partners in conversion postbacks. */
export function newClickRef(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(9))).toString("base64url");
}

/** Secret per-streamer postback key. */
export function newPostbackKey(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
}

// ----------------------------------------------------------------------------
// HMAC-SHA256 verification
// ----------------------------------------------------------------------------

/**
 * Constant-time verify of a hex HMAC-SHA256 over `payload` keyed by `secret`.
 * Used by the signed postback endpoint (POST /pb). Partners that support signing
 * send `X-Postback-Signature: <hex hmac>` where the hmac is of the exact query
 * string they sent (e.g. `event=conversion&amount=50&click_ref=x`). Verified
 * against the streamer's own postback_key as the HMAC secret — same value the
 * legacy path uses, so no schema change.
 */
export async function verifyHmacSha256Hex(secret: string, payload: string, signatureHex: string): Promise<boolean> {
  const sig = String(signatureHex ?? "").trim().toLowerCase();
  if (!sig || !/^[0-9a-f]{64}$/.test(sig)) return false; // SHA-256 = 64 hex chars
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = Buffer.from(mac as ArrayBuffer).toString("hex");
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
