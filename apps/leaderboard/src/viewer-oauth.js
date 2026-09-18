// Server-only Viewer OAuth readiness.
//
// This module intentionally returns only public readiness facts. Credentials are
// read here, never returned or serialized. Every OAuth entry point and public
// renderer should use this one decision so a database flag cannot advertise a
// provider whose deployment is not actually ready.

import { listProviders } from "@yourrank/shared/providers/registry";

const PRODUCTION_ORIGIN = "https://yourrank.site";
const STAGING_ORIGIN = "https://staging.yourrank.site";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

// Deployment wiring per provider that offers viewer auth. Adding a provider
// means registering its adapter and adding a row here; the readiness decision
// below is the same for every provider.
//   callbackOrigin: "canonical" = callback lives on the deployment origin (apex
//   handoff relays to custom domains); "request" = callback must be on the
//   requesting origin (no handoff), custom domains need an explicit redirect URI.
const DEPLOYMENT = Object.freeze({
  kick: Object.freeze({ envPrefix: "KICK", switchVar: "VIEWER_KICK_OAUTH_ENABLED", redirectVar: "KICK_REDIRECT_URI", callbackPath: "/auth/kick/callback", callbackOrigin: "canonical" }),
  discord: Object.freeze({ envPrefix: "DISCORD", switchVar: "VIEWER_DISCORD_OAUTH_ENABLED", redirectVar: "DISCORD_REDIRECT_URI", callbackPath: "/api/viewer/auth/discord/callback", callbackOrigin: "request" }),
});

export const VIEWER_OAUTH_PROVIDERS = Object.freeze(
  listProviders("viewerAuth").map((adapter) => adapter.id).filter((id) => id in DEPLOYMENT),
);
export const VIEWER_OAUTH_UNAVAILABLE_REASONS = Object.freeze([
  "disabled",
  "invalid_switch",
  "missing_credentials",
  "invalid_callback",
]);

function unavailable(reason, redirectUri = "") {
  return { available: false, reason, redirectUri };
}

function parseSwitch(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "auto";
  if (TRUE_VALUES.has(raw)) return true;
  if (FALSE_VALUES.has(raw)) return false;
  return "invalid";
}

function canonicalOrigin(env = {}) {
  const configured = String(env.PUBLIC_BASE_URL || "").trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash) {
        return url.origin;
      }
    } catch {
      // An invalid configured base URL fails readiness closed below.
    }
    return "";
  }
  return String(env.ENVIRONMENT || "").trim().toLowerCase() === "staging"
    ? STAGING_ORIGIN
    : PRODUCTION_ORIGIN;
}

function validCallbackUri(raw, path, expectedOrigin) {
  const value = String(raw || "").trim();
  if (!value || !expectedOrigin) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    if (url.pathname !== path || url.origin !== expectedOrigin) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function requestOriginOf(request) {
  try {
    const url = new URL(typeof request === "string" ? request : request?.url);
    if (url.protocol !== "https:" || url.username || url.password || LOCAL_HOSTS.has(url.hostname.toLowerCase())) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function credentialsPresent(env, prefix) {
  return Boolean(String(env?.[`${prefix}_CLIENT_ID`] || "").trim() && String(env?.[`${prefix}_CLIENT_SECRET`] || "").trim());
}

function resolveProvider(wiring, env, requestOrigin) {
  const switchValue = parseSwitch(env?.[wiring.switchVar]);
  const deploymentOrigin = canonicalOrigin(env);
  const configured = String(env?.[wiring.redirectVar] || "").trim();
  let expectedOrigin = deploymentOrigin;
  let callback = configured || (deploymentOrigin ? `${deploymentOrigin}${wiring.callbackPath}` : "");
  if (wiring.callbackOrigin === "request") {
    // Canonical deployment origins may use their request-origin callback by
    // default; a custom domain must be configured explicitly with that exact
    // request-origin callback.
    expectedOrigin = requestOrigin;
    callback = deploymentOrigin && (configured || (requestOrigin === deploymentOrigin ? `${requestOrigin}${wiring.callbackPath}` : ""));
  }
  const redirectUri = validCallbackUri(callback, wiring.callbackPath, expectedOrigin);
  if (switchValue === "invalid") return unavailable("invalid_switch", redirectUri);
  if (switchValue === false) return unavailable("disabled", redirectUri);
  if (!credentialsPresent(env, wiring.envPrefix)) return unavailable("missing_credentials", redirectUri);
  if (!redirectUri) return unavailable("invalid_callback");
  return { available: true, reason: "available", redirectUri };
}

/**
 * Resolve the public, non-secret readiness shape for Viewer OAuth.
 * `request` may be a Request or URL string; insecure or malformed requests fail closed.
 */
export function resolveViewerOAuthStatus(request, env = {}) {
  const requestOrigin = requestOriginOf(request);
  return Object.fromEntries(VIEWER_OAUTH_PROVIDERS.map((id) => [
    id,
    requestOrigin ? resolveProvider(DEPLOYMENT[id], env, requestOrigin) : unavailable("invalid_callback"),
  ]));
}

export function viewerOAuthAvailability(status) {
  return Object.fromEntries(VIEWER_OAUTH_PROVIDERS.map((id) => [id, status?.[id]?.available === true]));
}

export function viewerOAuthRedirect(status, provider) {
  return status?.[provider]?.available ? status[provider].redirectUri : "";
}
