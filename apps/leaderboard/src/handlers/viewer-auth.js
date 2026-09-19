// Viewer OAuth login: Kick and Discord.
// Separate from streamer OAuth so viewers get their own /me dashboard.

import { one, withTransaction } from "@yourrank/shared/db";
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
import { resolveVerifiedCustomDomain } from "../middleware/custom-domain.js";
import { PLATFORM_HOST } from "../constants.js";
import { applyOAuthJoinIntent, resolveJoinableCommunity } from "../viewer-membership.js";
import { resolveViewerOAuthStatus } from "../viewer-oauth.js";
import { linkExternalViewerIdentity, VIEWER_LINK_ERROR_CODES } from "@yourrank/shared/viewer-identity";

const KICK_VIEWER_HANDOFF_PROVIDER = "kick_viewer_handoff";
const KICK_VIEWER_HANDOFF_TTL_SECONDS = 90;
export const KICK_VIEWER_STATE_PREFIX = "viewer_";
const APEX_ORIGIN = `https://${PLATFORM_HOST}`;
const CUSTOM_DOMAIN_RETURN_PATHS = new Set(["/", "/leaderboard", "/shop", "/games", "/activity", "/me"]);
const CUSTOM_DOMAIN_REWARD_RETURN = /^\/shop\/[A-Za-z0-9_-]{1,64}$/;

// Shared by every viewer provider: ownership lookup + persistence live in the
// generic identity layer; protocol (token exchange, profile fetch) stays above.
// One transaction covers lock, lookup, viewer insert, identity upsert, legacy
// mirror and username history, so a failure between writes leaves nothing.
async function persistExternalIdentity(deps, identity, link) {
  const {
    withTransaction: withTransactionImpl = withTransaction,
    linkExternalViewerIdentity: linkExternalViewerIdentityImpl = linkExternalViewerIdentity,
  } = deps;
  return withTransactionImpl((tx) => linkExternalViewerIdentityImpl((sql, params) => tx.unsafe(sql, params), identity, link));
}

const LINK_INTENT = "link";

/**
 * Connect-provider mode: an authenticated viewer attaches another provider to
 * the Viewer Account it is signed in as. The state records the initiating
 * viewer and session authority; the callback re-resolves the viewer from the
 * same browser and refuses to proceed for anyone else.
 */
async function explicitLinkState(request, env, url, originInfo, deps) {
  if (url.searchParams.get("intent") !== LINK_INTENT) return {};
  const resolveViewerImpl = deps.resolveViewer || resolveViewer;
  const scope = originInfo.isCustomDomain && originInfo.siteId ? { siteId: originInfo.siteId } : {};
  const { viewer, session } = await resolveViewerImpl(request, env, scope);
  const authority = sessionAuthority(originInfo);
  if (!viewer || !session || !sameAuthority(authority, session)) return null;
  return { intent: LINK_INTENT, linkViewerId: viewer.id, linkAuthority: authority };
}

function isLinkState(stateData) {
  return stateData?.intent === LINK_INTENT;
}

async function verifyLinkInitiator(request, env, stateData, originInfo, authority, deps) {
  const resolveViewerImpl = deps.resolveViewer || resolveViewer;
  if (typeof stateData.linkViewerId !== "string" || !stateData.linkViewerId || !sameAuthority(stateData.linkAuthority, authority)) return null;
  const scope = originInfo.isCustomDomain && originInfo.siteId ? { siteId: originInfo.siteId } : {};
  const { viewer, session } = await resolveViewerImpl(request, env, scope);
  if (!viewer || !session || viewer.id !== stateData.linkViewerId || !sameAuthority(authority, session)) return null;
  return viewer.id;
}

// Completes a viewer OAuth callback once the provider identity is known.
// Sign-in mode resolves/creates the Viewer Account and issues a session; link
// mode attaches the identity to the already-authenticated viewer and never
// creates a Viewer Account or a session.
async function completeViewerIdentity(request, env, { stateData, identity, authority, originInfo, browserState, returnLocation }, deps) {
  const {
    one: oneImpl = one,
    createViewerSession: createViewerSessionImpl = createViewerSession,
    viewerCookieSet: viewerCookieSetImpl = viewerCookieSet,
  } = deps;
  const targetOrigin = stateData.origin;
  const clearBrowserCookie = (response) => {
    response.headers.append("set-cookie", oauthBrowserCookie(request, browserState, "", 0));
    return response;
  };

  if (isLinkState(stateData)) {
    const linkViewerId = await verifyLinkInitiator(request, env, stateData, originInfo, authority, deps);
    if (!linkViewerId) return clearBrowserCookie(errorRedirect(VIEWER_LINK_ERROR_CODES.session_mismatch, targetOrigin));
    const result = await persistExternalIdentity(deps, identity, { mode: "link", viewerId: linkViewerId });
    if (!result.ok) return clearBrowserCookie(errorRedirect(VIEWER_LINK_ERROR_CODES[result.reason], targetOrigin));
    const location = new URL(returnLocation, targetOrigin);
    location.searchParams.set("connected", identity.provider);
    return clearBrowserCookie(redirect(location.toString()));
  }

  const result = await persistExternalIdentity(deps, identity, { mode: "signin" });
  const viewerId = result.viewerId;
  const join = await applyOAuthJoinIntent(viewerId, stateData, { oneImpl });
  if (join.attempted && !join.membership) return errorRedirect("join_failed", targetOrigin);

  const sessionToken = await createViewerSessionImpl(env, viewerId, authority);
  return clearBrowserCookie(redirect(returnLocation, { "set-cookie": viewerCookieSetImpl(sessionToken, env, request) }));
}

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("hex");
}

const OAUTH_BROWSER_COOKIE_PREFIX = "yr_oauth_";
const OAUTH_BROWSER_TTL_SECONDS = 600 + KICK_VIEWER_HANDOFF_TTL_SECONDS;

async function hashBrowserNonce(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}

function oauthBrowserCookieName(state) {
  return `${OAUTH_BROWSER_COOKIE_PREFIX}${String(state || "").replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function oauthBrowserCookie(request, state, value, maxAge = OAUTH_BROWSER_TTL_SECONDS) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  const domain = isCookieCoveredOrigin(new URL(request.url).origin) && hostname !== "localhost"
    ? `; Domain=.${PLATFORM_HOST}`
    : "";
  return `${oauthBrowserCookieName(state)}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}${domain}`;
}

function readOAuthBrowserNonce(request, state) {
  const cookie = request.headers.get("cookie") || "";
  const name = oauthBrowserCookieName(state);
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  try { return match ? decodeURIComponent(match[1]) : ""; } catch { return ""; }
}

async function browserTransactionMatches(request, state, expectedHash) {
  const nonce = readOAuthBrowserNonce(request, state);
  if (!nonce || !expectedHash) return false;
  return (await hashBrowserNonce(nonce)) === String(expectedHash);
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
    if (parsed.origin !== allowedOrigin || !(CUSTOM_DOMAIN_RETURN_PATHS.has(path) || CUSTOM_DOMAIN_REWARD_RETURN.test(path))) {
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

async function resolveViewerOriginInfo(rawOrigin, env, resolveCustomDomainImpl = resolveVerifiedCustomDomain) {
  let parsed;
  try {
    parsed = new URL(String(rawOrigin || ""));
  } catch {
    return { origin: null, siteSlug: null, isCustomDomain: false };
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return { origin: null, siteSlug: null, isCustomDomain: false };
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === PLATFORM_HOST || hostname.endsWith(`.${PLATFORM_HOST}`)) {
    return { origin: parsed.origin, siteSlug: null, isCustomDomain: false };
  }
  try {
    const binding = await resolveCustomDomainImpl(env, hostname);
    if (binding?.site_id && binding?.binding_id && binding.hostname === hostname) {
      return {
        origin: parsed.origin,
        siteSlug: binding.slug,
        siteId: binding.site_id,
        bindingId: binding.binding_id,
        hostname,
        isCustomDomain: true,
      };
    }
  } catch {
    // Authentication never falls back from a failed custom-domain lookup to
    // global platform authority.
  }
  return { origin: null, siteSlug: null, siteId: null, bindingId: null, hostname, isCustomDomain: true };
}

function sessionAuthority(originInfo) {
  if (!originInfo?.origin) return null;
  if (!originInfo.isCustomDomain) return { authority: "global" };
  if (!originInfo.origin || !originInfo.siteId || !originInfo.hostname || !originInfo.bindingId) return null;
  return {
    authority: "site",
    siteId: originInfo.siteId,
    hostname: originInfo.hostname,
    domainBindingId: originInfo.bindingId,
  };
}

function sameAuthority(expected, actual) {
  return Boolean(expected && actual && expected.authority === actual.authority
    && (actual.authority === "global" || (
      expected.siteId === actual.siteId && expected.hostname === actual.hostname
      && expected.domainBindingId === actual.domainBindingId
    )));
}

function isExpectedCallback(url, redirectUri) {
  try {
    const expected = new URL(redirectUri);
    return expected.protocol === "https:" && url.origin === expected.origin && url.pathname === expected.pathname;
  } catch { return false; }
}

async function explicitJoinState(request, env, url, deps) {
  if (url.searchParams.get("intent") !== "join") return {};
  const community = await resolveJoinableCommunity(request, env, url.searchParams.get("site"), deps);
  return community
    ? { intent: "join", joinSiteId: community.id, joinSiteSlug: community.slug }
    : null;
}

function viewerReturnLocation(stateData, targetOrigin) {
  const returnTo = safeViewerReturnTo(stateData?.returnTo, targetOrigin, stateData?.origin);
  try {
    return new URL(returnTo, targetOrigin).toString();
  } catch {
    return `${targetOrigin}/me`;
  }
}

export async function requireViewer(req, env, scope = {}) {
  const { viewer, cookie } = await resolveViewer(req, env, scope);
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
    resolveViewerOAuthStatus: resolveViewerOAuthStatusImpl = resolveViewerOAuthStatus,
  } = deps;
  if (!(await rateLimitImpl(env, `viewer-oauth-start:kick:${clientIpImpl(request)}`, 20, 60)).ok) {
    return redirect("/me?error=rate_limited");
  }
  const url = new URL(request.url);
  const origin = url.origin;
  const oauth = resolveViewerOAuthStatusImpl(request, env)?.kick;
  if (!oauth?.available) return errorRedirect("kick_signin_unavailable", origin);
  const originInfo = await resolveViewerOriginInfo(origin, env, deps.resolveVerifiedCustomDomain || resolveVerifiedCustomDomain);
  if (!originInfo.origin || !sessionAuthority(originInfo)) return errorRedirect("custom_domain_unverified");
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"), origin);
  const redirectUri = oauth.redirectUri;
  const linkState = await explicitLinkState(request, env, url, originInfo, deps);
  if (!linkState) return errorRedirect(VIEWER_LINK_ERROR_CODES.signin_required, origin);
  const joinState = linkState.intent ? {} : await explicitJoinState(request, env, url, deps);
  if (!joinState) return errorRedirect("join_unavailable", origin);

  const { codeVerifier, codeChallenge } = await generatePKCEImpl();
  const state = `${KICK_VIEWER_STATE_PREFIX}${randomState()}`;
  const browserNonce = randomState();
  const browserNonceHash = await hashBrowserNonce(browserNonce);
  await storeOAuthStateImpl("kick", state, {
    transactionVersion: 1,
    provider: "kick",
    flow: "viewer",
    browserNonceHash,
    authority: sessionAuthority(originInfo),
    codeVerifier,
    returnTo,
    origin,
    redirectUri,
    ...joinState,
    ...linkState,
  });

  let authorizeURL;
  try {
    authorizeURL = buildKickViewerAuthorizeURLImpl(env, state, codeChallenge, undefined, redirectUri);
  } catch {
    // A provider-specific construction failure must not imply every sign-in is unavailable.
    return errorRedirect("kick_signin_unavailable", origin);
  }
  return redirect(authorizeURL, { "set-cookie": oauthBrowserCookie(request, state, browserNonce) });
}

export async function handleKickViewerAuthCallback(request, env, deps = {}) {
  const {
    consumeOAuthState: consumeOAuthStateImpl = consumeOAuthState,
    stateData: injectedStateData = null,
    stateConsumed: stateConsumedImpl = false,
    resolveVerifiedCustomDomain: resolveCustomDomainImpl = resolveVerifiedCustomDomain,
    storeOAuthState: storeOAuthStateImpl = storeOAuthState,
    browserTransactionMatches: browserTransactionMatchesImpl = browserTransactionMatches,
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

  if (stateData.transactionVersion !== 1 || stateData.flow !== "viewer" || stateData.provider !== "kick") {
    return errorRedirect("oauth_state_expired");
  }
  const targetOriginInfo = await resolveViewerOriginInfo(stateData.origin, env, resolveCustomDomainImpl);
  const targetOrigin = targetOriginInfo.origin;
  const authority = sessionAuthority(targetOriginInfo);
  if (!targetOrigin || !sameAuthority(stateData.authority, authority)) return errorRedirect("custom_domain_unverified");
  if (!isExpectedCallback(url, stateData.redirectUri)) return errorRedirect("kick_oauth_callback_mismatch");
  const callbackHasBrowserCookie = url.origin === targetOrigin || authority.authority === "global";
  if (callbackHasBrowserCookie && !await browserTransactionMatchesImpl(request, state, stateData.browserNonceHash)) {
    return errorRedirect("kick_oauth_browser_mismatch", targetOrigin);
  }
  if (error) {
    return errorRedirect(error === "access_denied" ? "access_denied" : "kick_auth_failed", targetOrigin);
  }
  if (!code) {
    return errorRedirect("missing_oauth_params", targetOrigin);
  }

  if (!callbackHasBrowserCookie) {
    // The initiating custom-host cookie cannot arrive at the registered apex
    // callback. Relay a pending code, not an authenticated Viewer Account.
    const handoff = randomState();
    await storeOAuthStateImpl(KICK_VIEWER_HANDOFF_PROVIDER, handoff, {
      ...stateData, stage: "pending_completion", code, browserState: state,
    }, { ttlSeconds: KICK_VIEWER_HANDOFF_TTL_SECONDS });
    const handoffUrl = new URL("/api/viewer/auth/kick/handoff", targetOrigin);
    handoffUrl.searchParams.set("handoff", handoff);
    return redirect(handoffUrl.toString());
  }
  return completeKickViewerAuth(request, env, { ...stateData, browserState: state }, code, authority, targetOriginInfo, deps);
}

async function completeKickViewerAuth(request, env, stateData, code, authority, originInfo, deps) {
  const {
    exchangeKickViewerCode: exchangeKickViewerCodeImpl = exchangeKickViewerCode,
    fetchKickCurrentUser: fetchKickCurrentUserImpl = fetchKickCurrentUser,
    encryptKickToken: encryptKickTokenImpl = encryptKickToken,
  } = deps;
  const targetOrigin = stateData.origin;
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

    return await completeViewerIdentity(request, env, {
      stateData,
      authority,
      originInfo,
      browserState: stateData.browserState,
      returnLocation: viewerReturnLocation(stateData, targetOrigin),
      identity: {
        provider: "kick",
        externalUserId: kickUserId,
        username: kickUsername,
        avatarUrl,
        accessTokenEnc: accessEnc,
        refreshTokenEnc: refreshEnc,
        tokenExpiresAt: expiresAt,
      },
    }, deps);
  } catch (err) {
    console.error("[viewer-auth] kick callback failed:", err?.message || err);
    return errorRedirect("kick_auth_failed", targetOrigin);
  }
}

export async function handleKickViewerAuthHandoff(request, env, deps = {}) {
  const {
    consumeOAuthState: consumeOAuthStateImpl = consumeOAuthState,
    resolveVerifiedCustomDomain: resolveCustomDomainImpl = resolveVerifiedCustomDomain,
    browserTransactionMatches: browserTransactionMatchesImpl = browserTransactionMatches,
  } = deps;
  const url = new URL(request.url);
  const handoff = url.searchParams.get("handoff");
  const stateData = handoff
    ? await consumeOAuthStateImpl(KICK_VIEWER_HANDOFF_PROVIDER, handoff)
    : null;
  if (stateData?.transactionVersion !== 1 || stateData.flow !== "viewer" || stateData.provider !== "kick"
      || stateData.stage !== "pending_completion" || !stateData.code || stateData.origin !== url.origin) {
    return errorRedirect("oauth_state_expired");
  }
  const originInfo = await resolveViewerOriginInfo(url.origin, env, resolveCustomDomainImpl);
  const authority = sessionAuthority(originInfo);
  if (authority?.authority !== "site" || !sameAuthority(stateData.authority, authority)) {
    return errorRedirect("oauth_state_expired");
  }
  if (!await browserTransactionMatchesImpl(request, stateData.browserState, stateData.browserNonceHash)) {
    return errorRedirect("kick_oauth_browser_mismatch", url.origin);
  }
  return completeKickViewerAuth(request, env, stateData, stateData.code, authority, originInfo, deps);
}

// --- Discord ---

export async function handleDiscordViewerAuthStart(request, env, deps = {}) {
  const rateLimitImpl = deps.rateLimit || rateLimit;
  const clientIpImpl = deps.clientIp || clientIp;
  const storeOAuthStateImpl = deps.storeOAuthState || storeOAuthState;
  const buildDiscordAuthorizeURLImpl = deps.buildDiscordAuthorizeURL || buildDiscordAuthorizeURL;
  const resolveViewerOAuthStatusImpl = deps.resolveViewerOAuthStatus || resolveViewerOAuthStatus;
  if (!(await rateLimitImpl(env, `viewer-oauth-start:discord:${clientIpImpl(request)}`, 20, 60)).ok) {
    return redirect("/me?error=rate_limited");
  }
  const url = new URL(request.url);
  const origin = url.origin;
  const oauth = resolveViewerOAuthStatusImpl(request, env)?.discord;
  if (!oauth?.available) return errorRedirect("discord_signin_unavailable", origin);
  const originInfo = await resolveViewerOriginInfo(origin, env, deps.resolveVerifiedCustomDomain || resolveVerifiedCustomDomain);
  if (!originInfo.origin || !sessionAuthority(originInfo)) return errorRedirect("custom_domain_unverified");
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"), origin);
  const redirectUri = oauth.redirectUri;
  const linkState = await explicitLinkState(request, env, url, originInfo, deps);
  if (!linkState) return errorRedirect(VIEWER_LINK_ERROR_CODES.signin_required, origin);
  const joinState = linkState.intent ? {} : await explicitJoinState(request, env, url, deps);
  if (!joinState) return errorRedirect("join_unavailable", origin);

  const state = randomState();
  const browserNonce = randomState();
  const browserNonceHash = await hashBrowserNonce(browserNonce);
  await storeOAuthStateImpl("discord", state, {
    transactionVersion: 1,
    provider: "discord",
    flow: "viewer",
    browserNonceHash,
    authority: sessionAuthority(originInfo),
    returnTo,
    origin,
    redirectUri,
    ...joinState,
    ...linkState,
  });

  let authorizeURL;
  try {
    authorizeURL = buildDiscordAuthorizeURLImpl(env, state, undefined, redirectUri);
  } catch {
    return errorRedirect("discord_signin_unavailable", origin);
  }
  return redirect(authorizeURL, { "set-cookie": oauthBrowserCookie(request, state, browserNonce) });
}

export async function handleDiscordViewerAuthCallback(request, env, deps = {}) {
  const {
    consumeOAuthState: consumeOAuthStateImpl = consumeOAuthState,
    exchangeDiscordCode: exchangeDiscordCodeImpl = exchangeDiscordCode,
    fetchDiscordCurrentUser: fetchDiscordCurrentUserImpl = fetchDiscordCurrentUser,
    encryptDiscordToken: encryptDiscordTokenImpl = encryptDiscordToken,
    discordAvatarUrl: discordAvatarUrlImpl = discordAvatarUrl,
    resolveVerifiedCustomDomain: resolveCustomDomainImpl = resolveVerifiedCustomDomain,
    browserTransactionMatches: browserTransactionMatchesImpl = browserTransactionMatches,
  } = deps;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (!state) return errorRedirect("missing_oauth_params");

  const stateData = await consumeOAuthStateImpl("discord", state);
  if (!stateData) return errorRedirect("oauth_state_expired");

  if (stateData.transactionVersion !== 1 || stateData.flow !== "viewer" || stateData.provider !== "discord") {
    return errorRedirect("oauth_state_expired");
  }
  const targetOriginInfo = await resolveViewerOriginInfo(stateData.origin, env, resolveCustomDomainImpl);
  const targetOrigin = targetOriginInfo.origin;
  const authority = sessionAuthority(targetOriginInfo);
  if (!targetOrigin || !sameAuthority(stateData.authority, authority) || url.origin !== targetOrigin) return errorRedirect("custom_domain_unverified");
  if (!isExpectedCallback(url, stateData.redirectUri)) return errorRedirect("discord_oauth_callback_mismatch");
  if (!await browserTransactionMatchesImpl(request, state, stateData.browserNonceHash)) {
    return errorRedirect("discord_oauth_browser_mismatch", targetOrigin);
  }
  if (error) return errorRedirect(error === "access_denied" ? "access_denied" : "discord_auth_failed", targetOrigin);
  if (!code) return errorRedirect("missing_oauth_params", targetOrigin);

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

    return await completeViewerIdentity(request, env, {
      stateData,
      authority,
      originInfo: targetOriginInfo,
      browserState: state,
      returnLocation: safeReturnTo(stateData.returnTo, targetOrigin),
      identity: {
        provider: "discord",
        externalUserId: discordUserId,
        username: discordUsername,
        avatarUrl,
        accessTokenEnc: accessEnc,
        refreshTokenEnc: refreshEnc,
        tokenExpiresAt: expiresAt,
      },
    }, deps);
  } catch (err) {
    console.error("[viewer-auth] discord callback failed:", err?.message || err);
    return errorRedirect("discord_auth_failed", targetOrigin);
  }
}

// --- Logout ---

export async function handleViewerLogout(request, env) {
  const token = readViewerToken(request);
  await destroyViewerSession(env, token, new URL(request.url).hostname);
  return json({ ok: true, loggedOut: true }, 200, { "set-cookie": viewerCookieClear(env, request) });
}
