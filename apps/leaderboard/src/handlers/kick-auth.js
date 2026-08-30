// Kick OAuth 2.1 flow for streamers linking their Kick channel.
import { currentUser, requireUser, ok, bad, readJson, rateLimit } from "../auth.js";
import { one, exec, withTransaction } from "@yourrank/shared/db";
import { requireSiteCapability } from "../site-authorization.js";
import { consumeOAuthState, storeOAuthState } from "@yourrank/shared/oauth-state";
import {
  generatePKCE,
  buildKickAuthorizeURL,
  exchangeKickCode,
  fetchKickCurrentUser,
  fetchKickCurrentChannel,
  subscribeKickWebhookEvent,
  encryptKickToken,
} from "@yourrank/shared/kick-oauth";
import { notifyLiveBoard } from "../live-board-config.js";
import { handleKickViewerAuthCallback, KICK_VIEWER_STATE_PREFIX } from "./viewer-auth.js";

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("hex");
}

function redirect(url, status = 302) {
  return new Response(null, { status, headers: { location: url } });
}

function channelRedirect(params, siteId = "") {
  const query = new URLSearchParams(params);
  if (siteId) query.set("siteId", siteId);
  return `/dashboard/site/connections?${query}`;
}

async function resolveDefaultKickSite(oneImpl, userId) {
  const owned = await oneImpl(
    `SELECT id, user_id
       FROM sites
      WHERE user_id=$1
      ORDER BY CASE WHEN id=(SELECT active_site_id FROM users WHERE id=$1) THEN 0 ELSE 1 END,
               id ASC
      LIMIT 1`,
    [userId]
  );
  if (owned) return owned;
  return oneImpl(
    `SELECT s.id, s.user_id
       FROM sites s
       JOIN site_members sm ON sm.site_id=s.id
      WHERE sm.user_id=$1
      ORDER BY s.id ASC
      LIMIT 1`,
    [userId]
  );
}

export async function handleKickAuthStart(request, env, deps = {}) {
  const {
    currentUser: currentUserImpl = currentUser,
    rateLimit: rateLimitImpl = rateLimit,
    one: oneImpl = one,
    requireSiteCapability: requireSiteCapabilityImpl = requireSiteCapability,
    storeOAuthState: storeOAuthStateImpl = storeOAuthState,
    generatePKCE: generatePKCEImpl = generatePKCE,
    buildKickAuthorizeURL: buildKickAuthorizeURLImpl = buildKickAuthorizeURL,
  } = deps;
  const user = await currentUserImpl(request, env);
  if (!user) return redirect("/login");
  if (!(await rateLimitImpl(env, `kick-oauth-start:${user.id}`, 10, 60)).ok) {
    return redirect(channelRedirect({ error: "rate_limited" }));
  }

  const url = new URL(request.url);
  let siteId = url.searchParams.get("siteId") || "";
  let site = siteId
    ? await oneImpl("SELECT id, user_id FROM sites WHERE id=$1", [siteId])
    : await resolveDefaultKickSite(oneImpl, user.id);
  siteId = site?.id || "";
  if (!siteId) {
    return redirect(channelRedirect({ error: "no_site_selected" }));
  }

  if (!site) {
    return redirect(channelRedirect({ error: "site_not_found" }, siteId));
  }
  const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageConnections");
  if (authorization.res) return redirect(channelRedirect({ error: "site_not_authorized" }, siteId));

  try {
    const { codeVerifier, codeChallenge } = await generatePKCEImpl();
    const state = randomState();
    await storeOAuthStateImpl("kick", state, { codeVerifier, siteId, userId: user.id });
    const authorizeURL = buildKickAuthorizeURLImpl(env, state, codeChallenge);
    return redirect(authorizeURL);
  } catch (err) {
    console.error("[kick-auth] start failed:", err?.message || err);
    return redirect(channelRedirect({ error: "kick_auth_failed" }, siteId));
  }
}

export async function handleKickAuthCallback(request, env, deps = {}) {
  const {
    currentUser: currentUserImpl = currentUser,
    one: oneImpl = one,
    exec: execImpl = exec,
    requireSiteCapability: requireSiteCapabilityImpl = requireSiteCapability,
    consumeOAuthState: consumeOAuthStateImpl = consumeOAuthState,
    exchangeKickCode: exchangeKickCodeImpl = exchangeKickCode,
    fetchKickCurrentUser: fetchKickCurrentUserImpl = fetchKickCurrentUser,
    fetchKickCurrentChannel: fetchKickCurrentChannelImpl = fetchKickCurrentChannel,
    subscribeKickWebhookEvent: subscribeKickWebhookEventImpl = subscribeKickWebhookEvent,
    encryptKickToken: encryptKickTokenImpl = encryptKickToken,
    stateData: injectedStateData = null,
    viewerCallback: viewerCallbackImpl = handleKickViewerAuthCallback,
  } = deps;

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (!state) {
    const user = await currentUserImpl(request, env);
    if (!user) return redirect("/login");
    if (error) return redirect(channelRedirect({ error: error === "access_denied" ? "access_denied" : "kick_auth_failed" }));
    return redirect(channelRedirect({ error: "missing_oauth_params" }));
  }

  const isViewerState = state.startsWith(KICK_VIEWER_STATE_PREFIX);
  const stateData = injectedStateData || await consumeOAuthStateImpl("kick", state);
  if (!stateData) {
    if (isViewerState) {
      return viewerCallbackImpl(request, env, { ...deps, stateData: null, stateConsumed: true });
    }
    const user = await currentUserImpl(request, env);
    if (!user) return redirect("/login");
    return redirect(channelRedirect({ error: "oauth_state_expired" }));
  }
  if (stateData.flow === "viewer") {
    return viewerCallbackImpl(request, env, { ...deps, stateData, stateConsumed: true });
  }

  const user = await currentUserImpl(request, env);
  if (!user) return redirect("/login");
  if (error) {
    return redirect(channelRedirect({ error: error === "access_denied" ? "access_denied" : "kick_auth_failed" }, stateData.siteId));
  }
  if (!code) {
    return redirect(channelRedirect({ error: "missing_oauth_params" }, stateData.siteId));
  }
  if (stateData.userId !== user.id) {
    return redirect(channelRedirect({ error: "oauth_user_mismatch" }, stateData.siteId));
  }

  const site = await oneImpl("SELECT id, user_id FROM sites WHERE id=$1", [stateData.siteId]);
  if (!site) return redirect(channelRedirect({ error: "site_not_found" }, stateData.siteId));
  const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageConnections");
  if (authorization.res) return redirect(channelRedirect({ error: "site_not_authorized" }, stateData.siteId));

  try {
    const tokens = await exchangeKickCodeImpl(env, code, stateData.codeVerifier);
    if (!tokens.access_token) {
      throw new Error("Kick did not return an access token");
    }

    const [kickUser, kickChannel] = await Promise.all([
      fetchKickCurrentUserImpl(tokens.access_token),
      fetchKickCurrentChannelImpl(tokens.access_token),
    ]);
    if (!kickUser || !kickChannel) {
      throw new Error("Could not fetch Kick user or channel");
    }

    // Subscribe to the channel-point reward redemption event.
    try {
      await subscribeKickWebhookEventImpl(tokens.access_token, "channel.reward.redemption.updated");
    } catch (subErr) {
      console.warn("[kick-auth] event subscription failed:", subErr?.message || subErr);
    }

    const accessEnc = await encryptKickTokenImpl(tokens.access_token);
    const refreshEnc = tokens.refresh_token ? await encryptKickTokenImpl(tokens.refresh_token) : null;
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    await execImpl(
      `UPDATE users
          SET kick_user_id = $1,
              kick_username = $2,
              kick_access_token_enc = $3,
              kick_refresh_token_enc = $4,
              kick_token_expires_at = $5,
              kick_linked_at = now(),
              updated_at = now()
        WHERE id = $6`,
      [
        String(kickUser.user_id),
        kickUser.name || "",
        accessEnc,
        refreshEnc,
        expiresAt,
        user.id,
      ]
    );

    await execImpl(
      `UPDATE sites
          SET kick_channel_external_id = $1,
              kick_channel_name = $2,
              kick_channel_linked_at = now(),
              updated_at = now()
        WHERE id = $3`,
      [String(kickChannel.broadcaster_user_id), kickChannel.slug || "", stateData.siteId]
    );
    void notifyLiveBoard(env, stateData.siteId);

    return redirect(channelRedirect({ kick_connected: "1" }, stateData.siteId));
  } catch (err) {
    console.error("[kick-auth] callback failed:", err?.message || err);
    return redirect(channelRedirect({ error: "kick_auth_failed" }, stateData.siteId));
  }
}

export async function handleKickAuthDisconnect(request, env, deps = {}) {
  const {
    requireUser: requireUserImpl = requireUser,
    one: oneImpl = one,
    withTransaction: withTransactionImpl = withTransaction,
    requireSiteCapability: requireSiteCapabilityImpl = requireSiteCapability,
    readJson: readJsonImpl = readJson,
  } = deps;
  const { user, res } = await requireUserImpl(request, env);
  if (res) return res;

  const url = new URL(request.url);
  const body = await readJsonImpl(request);
  const siteId = url.searchParams.get("siteId") || body?.siteId || "";
  if (!siteId) return bad("Select a site before disconnecting Kick.");
  const site = await oneImpl("SELECT id, user_id FROM sites WHERE id=$1", [siteId]);
  if (!site) return bad("Site not found.", 404);
  const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageConnections");
  if (authorization.res) return authorization.res;

  const result = await withTransactionImpl(async (tx) => {
    await tx.unsafe("SELECT id FROM public.sites WHERE id=$1 FOR UPDATE", [site.id]);
    const otherSite = await tx.one(
      `SELECT id
         FROM public.sites
        WHERE user_id=$1
          AND id<>$2
          AND kick_channel_external_id IS NOT NULL
        LIMIT 1`,
      [user.id, site.id]
    );
    if (!otherSite) {
      await tx.unsafe(
        `UPDATE public.users
            SET kick_user_id = null,
                kick_username = null,
                kick_access_token_enc = null,
                kick_refresh_token_enc = null,
                kick_token_expires_at = null,
                kick_linked_at = null,
                updated_at = now()
          WHERE id = $1`,
        [user.id]
      );
    }
    await tx.unsafe(
      `UPDATE public.sites
          SET kick_channel_external_id = null,
              kick_channel_name = null,
              kick_channel_linked_at = null,
              updated_at = now()
        WHERE id = $1`,
      [site.id]
    );
    return { accountDisconnected: !otherSite };
  });
  void notifyLiveBoard(env, site.id);

  return ok({ disconnected: true, accountDisconnected: result?.accountDisconnected !== false });
}
