import { safeEqual } from "@yourrank/shared/crypto";

// SEC-108: CSRF token helpers. Tokens are stored in a __csrf cookie (readable
// by JS) and must be echoed in a X-CSRF-Token header on every state-changing
// POST/PUT/DELETE. SameSite=Lax already blocks cross-site POST forms, but
// this adds defense-in-depth against XSS exfiltration.
export function generateCsrfToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function csrfCookie(token) {
  const raw = (typeof process !== "undefined" && process.env && process.env.SESSION_COOKIE_DOMAIN) || "";
  const domain = (raw && raw !== "undefined") ? raw : ".yourrank.site";
  return `__csrf=${token}; Path=/; Domain=${domain}; Secure; SameSite=Lax; Max-Age=86400`;
}

export function readCsrfToken(req) {
  const c = req.headers.get("cookie") || "";
  const m = c.match(/(?:^|;\s*)__csrf=([^;]+)/);
  return m ? m[1] : null;
}

export function verifyCsrf(req) {
  const cookie = readCsrfToken(req);
  const header = req.headers.get("x-csrf-token");
  if (!cookie || !header) return false;
  return safeEqual(cookie, header);
}

// CSRF-exempt paths (public endpoints or webhooks without an active session)
export const CSRF_EXEMPT = new Set([
  "/api/lead",
  "/api/track/copy",
  "/api/scores",
  "/api/postback",
  "/api/csp-report",
  "/webhooks/kick",
  // Unauthenticated auth endpoints: callers do not have a CSRF cookie yet.
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/forgot",
  "/api/auth/reset",
  "/api/auth/verify",
  "/api/auth/resend-verification",
]);

export function shouldRequireCsrf(method, path) {
  if (!["POST", "PUT", "DELETE", "PATCH"].includes(method)) return false;
  return !CSRF_EXEMPT.has(path);
}
