// Stateless password-token helpers for password-protected public boards.
import { verifyPassword, safeEqual } from "./auth.js";

const enc = new TextEncoder();
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;
const TOKEN_PREFIX = "yr_boardpass_";

function cookieName(slug) {
  return `${TOKEN_PREFIX}${slug}`;
}

async function hmacSha256Hex(keyString, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(keyString), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Buffer.from(sig).toString("hex");
}

export async function verifyBoardPassword(password, site) {
  if (!site.password_hash || !site.password_salt) return false;
  const v = await verifyPassword(password, site.password_salt, site.password_hash);
  return v.ok;
}

export async function issueBoardPasswordToken(site, maxAge = COOKIE_MAX_AGE) {
  const expiry = Math.floor(Date.now() / 1000) + maxAge;
  const sig = await hmacSha256Hex(site.password_hash, `${site.slug}:${expiry}`);
  return `${site.slug}:${expiry}:${sig}`;
}

function parseBoardPasswordToken(token) {
  const parts = String(token).split(":");
  if (parts.length !== 3) return null;
  return { slug: parts[0], expiry: Number(parts[1]), sig: parts[2] };
}

export async function verifyBoardPasswordToken(token, site) {
  const t = parseBoardPasswordToken(token);
  if (!t) return false;
  if (t.slug !== site.slug) return false;
  if (Number.isNaN(t.expiry) || t.expiry * 1000 < Date.now()) return false;
  if (!site.password_hash) return false;
  const expected = await hmacSha256Hex(site.password_hash, `${t.slug}:${t.expiry}`);
  return safeEqual(expected, t.sig);
}

export function boardPasswordCookieFromRequest(request, site) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;)\\s*${cookieName(site.slug)}=([^;]+)`));
  if (!match) return null;
  return decodeURIComponent(match[1]);
}

export async function verifyBoardPasswordCookie(request, site) {
  const token = boardPasswordCookieFromRequest(request, site);
  if (!token) return false;
  return verifyBoardPasswordToken(token, site);
}

export function boardPasswordSetCookieHeader(site, token) {
  // The token is cryptographically bound to the Site slug, so a root path does
  // not grant authority to another community. Root scope is required because
  // authenticated claim mutations live under /api rather than /<slug>.
  return `${cookieName(site.slug)}=${encodeURIComponent(token)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; Secure; SameSite=Lax; HttpOnly`;
}
