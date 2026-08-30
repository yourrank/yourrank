// Viewer OAuth login: Kick and Discord.
// Separate from streamer OAuth so viewers get their own /me dashboard.

import { one, exec } from "@yourrank/shared/db";
import { generatePKCE, encryptKickToken, buildKickViewerAuthorizeURL, exchangeKickViewerCode, fetchKickCurrentUser } from "@yourrank/shared/kick-oauth";
import {
  buildDiscordAuthorizeURL,
  exchangeDiscordCode,
  fetchDiscordCurrentUser,
  encryptDiscordToken,
  discordAvatarUrl,
} from "@yourrank/shared/discord-oauth";
import {
  resolveViewer,
  createViewerSession,
  destroyViewerSession,
  viewerCookieSet,
  viewerCookieClear,
  readViewerToken,
} from "@yourrank/shared/viewer-session";
import { bad, json, rateLimit, clientIp } from "../auth.js";
import { consumeOAuthState, storeOAuthState } from "@yourrank/shared/oauth-state";
import { resolveCustomDomain } from "../middleware/custom-domain.js";
import { NON_SITE_PATHS, PLATFORM_HOST } from "../constants.js";

const KICK_VIEWER_HANDOFF_PROVIDER = "kick_viewer_handoff";
const KICK_VIEWER_HANDOFF_TTL_SECONDS = 90;
export const KICK_VIEWER_STATE_PREFIX = "viewer_";
const APEX_ORIGIN = `https://${PLATFORM_HOST}`;
const CUSTOM_DOMAIN_RETURN_PATHS = new Set(["/", "/leaderboard", "/shop", "/games", "/me"]);

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("hex");
}

function redirect(url, headers = {}, status = 302) {
  return new Response(null, { status, headers: { location: url, ...headers } });
}

function errorRedirect(code, origin = "") {
  const target = origin ? new URL("/me", origin) : new URL("/me", APEX_ORIGIN);
  target.searchParams.set("error", code);
  return redirect(origin && origin !== APEX_ORIGIN ? target.toString() : `${target.pathname}${target.search}`);
}

function safeReturnTo(raw, allowedOrigin, fallback = "/me") {
  const s = String(raw || "").trim();
  // Same-origin relative path.
  if (s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\")) return s;
  // Same-origin absolute URL (or a custom domain whose auth flow started on that origin).
  if (allowedOrigin) {
    try {
      const u = new URL(s, allowedOrigin);
      if (u.origin === allowedOrigin) return s;
    } catch {
      // ignore malformed URLs
    }
  }
  return fallback;
}

function safeCustomDomainReturnTo(raw, allowedOrigin) {
  const apexFallback = safeApexViewerReturnTo(raw);
  if (apexFallback) return apexFallback;
  const rawValue = String(raw || "").trim();
  if (rawValue.startsWith("//") || rawValue.startsWith("/\\")) {
    return `${APEX_ORIGIN}/me`;
  }
  if (rawValue && !rawValue.startsWith("/")) {
    try {
      const parsed = new URL(rawValue, allowedOrigin);
      if (parsed.origin !== allowedOrigin) return `${APEX_ORIGIN}/me`;
    } catch {
      return `${APEX_ORIGIN}/me`;
    }
  }
  const candidate = safeReturnTo(raw, allowedOrigin);
  try {
    const parsed = new URL(candidate, allowedOrigin);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    if (parsed.origin !== allowedOrigin || !CUSTOM_DOMAIN_RETURN_PATHS.has(path)) {
      return `${APEX_ORIGIN}/me`;
    }
    return `${path}${parsed.search}${parsed.hash}`;
  } catch {
    return `${APEX_ORIGIN}/me`;
  }
}

function safeApexViewerReturnTo(raw) {
  try {
    const parsed = new URL(String(raw || ""));
    if (parsed.origin !== APEX_ORIGIN || parsed.pathname !== "/me") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function safeViewerReturnTo(raw, targetOrigin, sourceOrigin = targetOrigin) {
  if (sourceOrigin !== targetOrigin) return "/me";
  return isCookieCoveredOrigin(targetOrigin)
    ? safeReturnTo(raw, targetOrigin)
    : safeCustomDomainReturnTo(raw, targetOrigin);
}

function isCookieCoveredOrigin(origin) {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname === PLATFORM_HOST || hostname.endsWith(`.${PLATFORM_HOST}`);
  } catch {
    return false;
  }
}

async function resolveViewerOriginInfo(rawOrigin, env, resolveCustomDomainImpl = resolveCustomDomain) {
  let parsed;
  try {
    parsed = new URL(String(rawOrigin || ""));
  } catch {
    return { origin: APEX_ORIGIN, siteSlug: null, isCustomDomain: false };
  }
  if (parsed.protocol !== "https:") return { origin: APEX_ORIGIN, siteSlug: null, isCustomDomain: false };
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === PLATFORM_HOST || hostname.endsWith(`.${PLATFORM_HOST}`)) {
    return { origin: parsed.origin, siteSlug: null, isCustomDomain: false };
  }
  try {
    const siteSlug = await resolveCustomDomainImpl(env, hostname);
    if (siteSlug) return { origin: parsed.origin, siteSlug, isCustomDomain: true };
  } catch {
    // Invalid or unavailable custom domains fall back to the platform origin.
  }
  return { origin: APEX_ORIGIN, siteSlug: null, isCustomDomain: true };
}

async function resolveViewerOrigin(rawOrigin, env, resolveCustomDomainImpl = resolveCustomDomain) {
  return (await resolveViewerOriginInfo(rawOrigin, env, resolveCustomDomainImpl)).origin;
}

function siteSlugFromReturnTo(rawReturnTo, targetOrigin) {
  try {
    const path = new URL(String(rawReturnTo || ""), targetOrigin).pathname;
    const slug = path.split("/").filter(Boolean)[0]?.toLowerCase();
    return slug && !NON_SITE_PATHS.has(slug) ? slug : null;
  } catch {
    return null;
  }
}

async function registerViewerMembership({
  viewerId,
  stateData,
  targetOriginInfo,
  oneImpl,
  execImpl,
}) {
  try {
    const slug = targetOriginInfo.siteSlug ||
      (!targetOriginInfo.isCustomDomain
        ? siteSlugFromReturnTo(stateData?.returnTo, targetOriginInfo.origin)
        : null);
    if (!slug) return;
    const site = await oneImpl("SELECT id FROM sites WHERE slug=$1", [slug]);
    if (!site?.id) return;
    await execImpl(
      `INSERT INTO site_viewers (site_id, viewer_id, balance, total_earned, last_seen_at)
       VALUES ($1, $2, 0, 0, now())
       ON CONFLICT (site_id, viewer_id)
       DO UPDATE SET last_seen_at=now(), updated_at=now()`,
      [site.id, viewerId],
    );
  } catch (err) {
    console.error("[viewer-auth] membership registration failed:", err?.message || err);
  }
}

function viewerReturnLocation(stateData, targetOrigin) {
  const returnTo = safeViewerReturnTo(stateData?.returnTo, targetOrigin, stateData?.origin);
  try {
    return new URL(returnTo, targetOrigin).toString();
  } catch {
    return `${targetOrigin}/me`;
  }
}

export async function requireViewer(req, env) {
  const { viewer, cookie } = await resolveViewer(req, env);
  if (!viewer) return { viewer: null, cookie, res: bad("unauthorized", 401) };
  return { viewer, cookie, res: null };
}

// --- Kick ---

export async function handleKickViewerAuthStart(request, env, deps = {}) {
  const {
    rateLimit: rateLimitImpl = rateLimit,
    clientIp: clientIpImpl = clientIp,
    generatePKCE: generatePKCEImpl = generatePKCE,
    storeOAuthState: storeOAuthStateImpl = storeOAuthState,
    buildKickViewerAuthorizeURL: buildKickViewerAuthorizeURLImpl = buildKickViewerAuthorizeURL,
  } = deps;
  if (!(await rateLimitImpl(env, `viewer-oauth-start:kick:${clientIpImpl(request)}`, 20, 60)).ok) {
    return redirect("/me?error=rate_limited");
  }
  const url = new URL(request.url);
  const origin = url.origin;
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"), origin);
  const redirectUri = env.KICK_REDIRECT_URI || "https://yourrank.site/auth/kick/callback";

  const { codeVerifier, codeChallenge } = await generatePKCEImpl();
  const state = `${KICK_VIEWER_STATE_PREFIX}${randomState()}`;
  await storeOAuthStateImpl("kick", state, { provider: "kick", flow: "viewer", codeVerifier, returnTo, origin, redirectUri });

  const authorizeURL = buildKickViewerAuthorizeURLImpl(env, state, codeChallenge, undefined, redirectUri);
  return redirect(authorizeURL);
}

export async function handleKickViewerAuthCallback(request, env, deps = {}) {
  const {
    consumeOAuthState: consumeOAuthStateImpl = consumeOAuthState,
    exchangeKickViewerCode: exchangeKickViewerCodeImpl = exchangeKickViewerCode,
    fetchKickCurrentUser: fetchKickCurrentUserImpl = fetchKickCurrentUser,
    encryptKickToken: encryptKickTokenImpl = encryptKickToken,
    one: oneImpl = one,
    exec: execImpl = exec,
    createViewerSession: createViewerSessionImpl = createViewerSession,
    viewerCookieSet: viewerCookieSetImpl = viewerCookieSet,
    stateData: injectedStateData = null,
    stateConsumed: stateConsumedImpl = false,
    resolveCustomDomain: resolveCustomDomainImpl = resolveCustomDomain,
    storeOAuthState: storeOAuthStateImpl = storeOAuthState,
  } = deps;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (!state) {
    return errorRedirect(error ? (error === "access_denied" ? "access_denied" : "kick_auth_failed") : "missing_oauth_params");
  }

  const stateData = stateConsumedImpl
    ? injectedStateData
    : injectedStateData || await consumeOAuthStateImpl("kick", state);
  if (!stateData) {
    return errorRedirect("oauth_state_expired");
  }

  const targetOriginInfo = await resolveViewerOriginInfo(stateData.origin, env, resolveCustomDomainImpl);
  const targetOrigin = targetOriginInfo.origin;
  if (error) {
    return errorRedirect(error === "access_denied" ? "access_denied" : "kick_auth_failed", targetOrigin);
  }
  if (!code) {
    return errorRedirect("missing_oauth_params", targetOrigin);
  }

  try {
    const tokens = await exchangeKickViewerCodeImpl(env, code, stateData.codeVerifier, stateData.redirectUri);
    if (!tokens.access_token) {
      throw new Error("Kick did not return an access token");
    }

    const kickUser = await fetchKickCurrentUserImpl(tokens.access_token);
    if (!kickUser) {
      throw new Error("Could not fetch Kick user");
    }

    const accessEnc = await encryptKickTokenImpl(tokens.access_token);
    const refreshEnc = tokens.refresh_token ? await encryptKickTokenImpl(tokens.refresh_token) : null;
    const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;
    const kickUserId = String(kickUser.user_id);
    const kickUsername = kickUser.name || "";
    const avatarUrl = kickUser.profile_picture || null;

    const existing = await oneImpl("SELECT id, kick_username FROM viewers WHERE kick_user_id=$1", [kickUserId]);
    let viewerId;
    if (existing) {
      viewerId = existing.id;
      const oldUsername = String(existing.kick_username || "").trim().toLowerCase();
      const newUsername = kickUsername.trim().toLowerCase();
      if (oldUsername && oldUsername !== newUsername) {
        await execImpl(
          `INSERT INTO viewer_username_history (viewer_id, username)
           VALUES ($1, $2)
           ON CONFLICT (viewer_id, username)
           DO UPDATE SET seen_at = now()`,
          [viewerId, oldUsername]
        );
      }
      await execImpl(
        `UPDATE viewers
            SET kick_username = $1,
                kick_access_token_enc = $2,
                kick_refresh_token_enc = $3,
                kick_token_expires_at = $4,
                kick_linked_at = now(),
                avatar_url = COALESCE($5, avatar_url),
                updated_at = now()
          WHERE id = $6`,
        [kickUsername, accessEnc, refreshEnc, expiresAt, avatarUrl, viewerId]
      );
      if (newUsername) {
        await execImpl(
          `INSERT INTO viewer_username_history (viewer_id, username)
           VALUES ($1, $2)
           ON CONFLICT (viewer_id, username)
           DO UPDATE SET seen_at = now()`,
          [viewerId, newUsername]
        );
      }
    } else {
      const rows = await execImpl(
        `INSERT INTO viewers (kick_user_id, kick_username, kick_access_token_enc, kick_refresh_token_enc, kick_token_expires_at, kick_linked_at, avatar_url)
         VALUES ($1, $2, $3, $4, $5, now(), $6)
         RETURNING id`,
        [kickUserId, kickUsername, accessEnc, refreshEnc, expiresAt, avatarUrl]
      );
      viewerId = rows[0].id;
      if (kickUsername.trim()) {
        await execImpl(
          `INSERT INTO viewer_username_history (viewer_id, username)
           VALUES ($1, $2)
           ON CONFLICT (viewer_id, username)
           DO UPDATE SET seen_at = now()`,
          [viewerId, kickUsername.trim().toLowerCase()]
        );
      }
    }

    await registerViewerMembership({
      viewerId,
      stateData,
      targetOriginInfo,
      oneImpl,
      execImpl,
    });

    if (isCookieCoveredOrigin(targetOrigin) || url.origin === targetOrigin) {
      const sessionToken = await createViewerSessionImpl(env, viewerId);
      return redirect(viewerReturnLocation(stateData, targetOrigin), { "set-cookie": viewerCookieSetImpl(sessionToken, env, request) });
    }

    const handoff = randomState();
    await storeOAuthStateImpl(
      KICK_VIEWER_HANDOFF_PROVIDER,
      handoff,
      { viewerId, returnTo: safeViewerReturnTo(stateData.returnTo, targetOrigin, stateData.origin), origin: targetOrigin },
      { ttlSeconds: KICK_VIEWER_HANDOFF_TTL_SECONDS },
    );
    const handoffUrl = new URL("/api/viewer/auth/kick/handoff", targetOrigin);
    handoffUrl.searchParams.set("handoff", handoff);
    return redirect(handoffUrl.toString());
  } catch (err) {
    console.error("[viewer-auth] kick callback failed:", err?.message || err);
    return errorRedirect("kick_auth_failed", targetOrigin);
  }
}

export async function handleKickViewerAuthHandoff(request, env, deps = {}) {
  const {
    consumeOAuthState: consumeOAuthStateImpl = consumeOAuthState,
    createViewerSession: createViewerSessionImpl = createViewerSession,
    viewerCookieSet: viewerCookieSetImpl = viewerCookieSet,
    resolveCustomDomain: resolveCustomDomainImpl = resolveCustomDomain,
  } = deps;
  const url = new URL(request.url);
  const handoff = url.searchParams.get("handoff");
  const stateData = handoff
    ? await consumeOAuthStateImpl(KICK_VIEWER_HANDOFF_PROVIDER, handoff)
    : null;
  const targetOrigin = stateData?.origin === url.origin
    ? await resolveViewerOrigin(url.origin, env, resolveCustomDomainImpl)
    : APEX_ORIGIN;
  if (!stateData || targetOrigin !== url.origin || !stateData.viewerId) {
    return errorRedirect("oauth_state_expired");
  }
  try {
    const sessionToken = await createViewerSessionImpl(env, stateData.viewerId);
    const location = safeViewerReturnTo(stateData.returnTo, url.origin, stateData.origin);
    return redirect(location, { "set-cookie": viewerCookieSetImpl(sessionToken, env, request) });
  } catch (err) {
    console.error("[viewer-auth] kick handoff failed:", err?.message || err);
    return errorRedirect("kick_auth_failed", url.origin);
  }
}

// --- Discord ---

export async function handleDiscordViewerAuthStart(request, env) {
  if (!(await rateLimit(env, `viewer-oauth-start:discord:${clientIp(request)}`, 20, 60)).ok) {
    return redirect("/me?error=rate_limited");
  }
  const url = new URL(request.url);
  const origin = url.origin;
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"), origin);
  const redirectUri = `${origin}/api/viewer/auth/discord/callback`;

  const state = randomState();
  await storeOAuthState("discord", state, { provider: "discord", returnTo, origin, redirectUri });

  const authorizeURL = buildDiscordAuthorizeURL(env, state, undefined, redirectUri);
  return redirect(authorizeURL);
}

export async function handleDiscordViewerAuthCallback(request, env, deps = {}) {
  const {
    consumeOAuthState: consumeOAuthStateImpl = consumeOAuthState,
    exchangeDiscordCode: exchangeDiscordCodeImpl = exchangeDiscordCode,
    fetchDiscordCurrentUser: fetchDiscordCurrentUserImpl = fetchDiscordCurrentUser,
    encryptDiscordToken: encryptDiscordTokenImpl = encryptDiscordToken,
    discordAvatarUrl: discordAvatarUrlImpl = discordAvatarUrl,
    one: oneImpl = one,
    exec: execImpl = exec,
    createViewerSession: createViewerSessionImpl = createViewerSession,
    viewerCookieSet: viewerCookieSetImpl = viewerCookieSet,
    resolveCustomDomain: resolveCustomDomainImpl = resolveCustomDomain,
  } = deps;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return redirect(`/me?error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return redirect(`/me?error=${encodeURIComponent("missing_oauth_params")}`);
  }

  const stateData = await consumeOAuthStateImpl("discord", state);
  if (!stateData) {
    return redirect(`/me?error=${encodeURIComponent("oauth_state_expired")}`);
  }

  const targetOriginInfo = await resolveViewerOriginInfo(stateData.origin, env, resolveCustomDomainImpl);
  const targetOrigin = targetOriginInfo.origin;

  try {
    const tokens = await exchangeDiscordCodeImpl(env, code, stateData.redirectUri);
    if (!tokens.access_token) {
      throw new Error("Discord did not return an access token");
    }

    const discordUser = await fetchDiscordCurrentUserImpl(tokens.access_token);
    if (!discordUser) {
      throw new Error("Could not fetch Discord user");
    }

    const accessEnc = await encryptDiscordTokenImpl(tokens.access_token);
    const refreshEnc = tokens.refresh_token ? await encryptDiscordTokenImpl(tokens.refresh_token) : null;
    const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;
    const discordUserId = discordUser.id;
    const discordUsername = discordUser.global_name || discordUser.username || "";
    const avatarUrl = discordAvatarUrlImpl(discordUser.id, discordUser.avatar);

    const existing = await oneImpl("SELECT id, discord_username FROM viewers WHERE discord_user_id=$1", [discordUserId]);
    let viewerId;
    if (existing) {
      viewerId = existing.id;
      const oldUsername = String(existing.discord_username || "").trim().toLowerCase();
      const newUsername = discordUsername.trim().toLowerCase();
      if (oldUsername && oldUsername !== newUsername) {
        await execImpl(
          `INSERT INTO viewer_username_history (viewer_id, username)
           VALUES ($1, $2)
           ON CONFLICT (viewer_id, username)
           DO UPDATE SET seen_at = now()`,
          [viewerId, oldUsername]
        );
      }
      await execImpl(
        `UPDATE viewers
            SET discord_username = $1,
                discord_access_token_enc = $2,
                discord_refresh_token_enc = $3,
                discord_token_expires_at = $4,
                discord_linked_at = now(),
                avatar_url = COALESCE($5, avatar_url),
                updated_at = now()
          WHERE id = $6`,
        [discordUsername, accessEnc, refreshEnc, expiresAt, avatarUrl, viewerId]
      );
      if (newUsername) {
        await execImpl(
          `INSERT INTO viewer_username_history (viewer_id, username)
           VALUES ($1, $2)
           ON CONFLICT (viewer_id, username)
           DO UPDATE SET seen_at = now()`,
          [viewerId, newUsername]
        );
      }
    } else {
      const rows = await execImpl(
        `INSERT INTO viewers (discord_user_id, discord_username, discord_access_token_enc, discord_refresh_token_enc, discord_token_expires_at, discord_linked_at, avatar_url)
         VALUES ($1, $2, $3, $4, $5, now(), $6)
         RETURNING id`,
        [discordUserId, discordUsername, accessEnc, refreshEnc, expiresAt, avatarUrl]
      );
      viewerId = rows[0].id;
      if (discordUsername.trim()) {
        await execImpl(
          `INSERT INTO viewer_username_history (viewer_id, username)
           VALUES ($1, $2)
           ON CONFLICT (viewer_id, username)
           DO UPDATE SET seen_at = now()`,
          [viewerId, discordUsername.trim().toLowerCase()]
        );
      }
    }

    await registerViewerMembership({
      viewerId,
      stateData,
      targetOriginInfo,
      oneImpl,
      execImpl,
    });

    const sessionToken = await createViewerSessionImpl(env, viewerId);
    return redirect(safeReturnTo(stateData.returnTo, targetOrigin), { "set-cookie": viewerCookieSetImpl(sessionToken, env, request) });
  } catch (err) {
    console.error("[viewer-auth] discord callback failed:", err?.message || err);
    return redirect("/me?error=discord_auth_failed");
  }
}

// --- Logout ---

export async function handleViewerLogout(request, env) {
  const token = readViewerToken(request);
  await destroyViewerSession(env, token);
  return json({ ok: true, loggedOut: true }, 200, { "set-cookie": viewerCookieClear(env, request) });
}
