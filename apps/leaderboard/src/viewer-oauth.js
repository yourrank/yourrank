// Server-only Viewer OAuth readiness.
//
// This module intentionally returns only public readiness facts. Credentials are
// read here, never returned or serialized. Every OAuth entry point and public
// renderer should use this one decision so a database flag cannot advertise a
// provider whose deployment is not actually ready.

const KICK_CALLBACK_PATH = "/auth/kick/callback";
const DISCORD_CALLBACK_PATH = "/api/viewer/auth/discord/callback";
const PRODUCTION_ORIGIN = "https://yourrank.site";
const STAGING_ORIGIN = "https://staging.yourrank.site";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export const VIEWER_OAUTH_PROVIDERS = Object.freeze(["kick", "discord"]);
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

function credentialsPresent(env, provider) {
  const prefix = provider === "kick" ? "KICK" : "DISCORD";
  return Boolean(String(env?.[`${prefix}_CLIENT_ID`] || "").trim() && String(env?.[`${prefix}_CLIENT_SECRET`] || "").trim());
}

function resolveKick(env) {
  const switchValue = parseSwitch(env?.VIEWER_KICK_OAUTH_ENABLED);
  const expectedOrigin = canonicalOrigin(env);
  const configured = String(env?.KICK_REDIRECT_URI || "").trim();
  const defaultCallback = expectedOrigin ? `${expectedOrigin}${KICK_CALLBACK_PATH}` : "";
  const redirectUri = validCallbackUri(configured || defaultCallback, KICK_CALLBACK_PATH, expectedOrigin);
  if (switchValue === "invalid") return unavailable("invalid_switch", redirectUri);
  if (switchValue === false) return unavailable("disabled", redirectUri);
  if (!credentialsPresent(env, "kick")) return unavailable("missing_credentials", redirectUri);
  if (!redirectUri) return unavailable("invalid_callback");
  return { available: true, reason: "available", redirectUri };
}

function resolveDiscord(env, requestOrigin) {
  const switchValue = parseSwitch(env?.VIEWER_DISCORD_OAUTH_ENABLED);
  const deploymentOrigin = canonicalOrigin(env);
  const configured = String(env?.DISCORD_REDIRECT_URI || "").trim();
  // Discord has no apex handoff. Canonical deployment origins may use their
  // request-origin callback by default; a custom domain must be configured
  // explicitly with that exact request-origin callback.
  const callback = deploymentOrigin && (configured || (requestOrigin === deploymentOrigin
    ? `${requestOrigin}${DISCORD_CALLBACK_PATH}`
    : ""));
  const redirectUri = validCallbackUri(callback, DISCORD_CALLBACK_PATH, requestOrigin);
  if (switchValue === "invalid") return unavailable("invalid_switch", redirectUri);
  if (switchValue === false) return unavailable("disabled", redirectUri);
  if (!credentialsPresent(env, "discord")) return unavailable("missing_credentials", redirectUri);
  if (!redirectUri) return unavailable("invalid_callback");
  return { available: true, reason: "available", redirectUri };
}

/**
 * Resolve the public, non-secret readiness shape for Viewer OAuth.
 * `request` may be a Request or URL string; insecure or malformed requests fail closed.
 */
export function resolveViewerOAuthStatus(request, env = {}) {
  const requestOrigin = requestOriginOf(request);
  if (!requestOrigin) {
    return {
      kick: unavailable("invalid_callback"),
      discord: unavailable("invalid_callback"),
    };
  }
  return {
    kick: resolveKick(env),
    discord: resolveDiscord(env, requestOrigin),
  };
}

export function viewerOAuthAvailability(status) {
  return {
    kick: status?.kick?.available === true,
    discord: status?.discord?.available === true,
  };
}

export function viewerOAuthRedirect(status, provider) {
  return status?.[provider]?.available ? status[provider].redirectUri : "";
}
