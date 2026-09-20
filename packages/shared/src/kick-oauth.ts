// Kick OAuth 2.1 helpers for streamer channel linking.
// Shared between leaderboard Worker and any future bot features.

import { encryptToken, decryptToken } from "./crypto.js";
import { CircuitBreaker } from "./circuit-breaker.js";

export interface KickOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface KickTokens {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export interface KickUser {
  user_id: number;
  name: string;
  email?: string;
  profile_picture?: string;
}

export interface KickChannel {
  broadcaster_user_id: number;
  slug: string;
  channel_description?: string;
  banner_picture?: string;
  stream_title?: string;
}

function base64UrlEncode(buf: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  const base64 = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return base64;
}

export async function generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(64));
  const codeVerifier = base64UrlEncode(verifierBytes);

  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(codeVerifier));
  return {
    codeVerifier,
    codeChallenge: base64UrlEncode(new Uint8Array(digest)),
  };
}

const kickCircuit = new CircuitBreaker("kick-api", { failureThreshold: 5, resetTimeoutMs: 30_000 });

function getConfig(env: any): KickOAuthConfig {
  const clientId = env.KICK_CLIENT_ID;
  const clientSecret = env.KICK_CLIENT_SECRET;
  const redirectUri = env.KICK_REDIRECT_URI || "https://yourrank.site/auth/kick/callback";
  if (!clientId || !clientSecret) {
    throw new Error("KICK_CLIENT_ID and KICK_CLIENT_SECRET are required");
  }
  return { clientId, clientSecret, redirectUri };
}

function getViewerConfig(env: any): KickOAuthConfig {
  const clientId = env.KICK_CLIENT_ID;
  const clientSecret = env.KICK_CLIENT_SECRET;
  const redirectUri = env.KICK_REDIRECT_URI || "https://yourrank.site/auth/kick/callback";
  if (!clientId || !clientSecret) {
    throw new Error("KICK_CLIENT_ID and KICK_CLIENT_SECRET are required");
  }
  return { clientId, clientSecret, redirectUri };
}

export function buildKickAuthorizeURL(
  env: any,
  state: string,
  codeChallenge: string,
  scope = "user:read channel:read channel:rewards:read channel:rewards:write events:subscribe",
  viewerFlow = false,
  redirectUri?: string
): string {
  const config = viewerFlow ? getViewerConfig(env) : getConfig(env);
  const { clientId } = config;
  const finalRedirectUri = redirectUri || config.redirectUri;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: finalRedirectUri,
    scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://id.kick.com/oauth/authorize?${params.toString()}`;
}

export function buildKickViewerAuthorizeURL(
  env: any,
  state: string,
  codeChallenge: string,
  scope = "user:read",
  redirectUri?: string
): string {
  return buildKickAuthorizeURL(env, state, codeChallenge, scope, true, redirectUri);
}

async function postTokenEndpoint(env: any, body: URLSearchParams): Promise<KickTokens> {
  const { clientId, clientSecret } = getConfig(env);
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);

  const res = await kickCircuit.call(() =>
    fetch("https://id.kick.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Kick token endpoint returned ${res.status}: ${text}`);
  }
  return JSON.parse(text) as KickTokens;
}

export function exchangeKickCode(
  env: any,
  code: string,
  codeVerifier: string,
  viewerFlow = false,
  redirectUri?: string
): Promise<KickTokens> {
  const config = viewerFlow ? getViewerConfig(env) : getConfig(env);
  const finalRedirectUri = redirectUri || config.redirectUri;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    redirect_uri: finalRedirectUri,
    code,
    code_verifier: codeVerifier,
  });
  return postTokenEndpoint(env, body);
}

export function exchangeKickViewerCode(
  env: any,
  code: string,
  codeVerifier: string,
  redirectUri?: string
): Promise<KickTokens> {
  return exchangeKickCode(env, code, codeVerifier, true, redirectUri);
}

export function refreshKickTokens(env: any, refreshToken: string): Promise<KickTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return postTokenEndpoint(env, body);
}

async function kickApiGet<T>(accessToken: string, url: string): Promise<T> {
  const res = await kickCircuit.call(() =>
    fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    })
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Kick API GET ${url} returned ${res.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

interface KickApiList<T> {
  data: T[];
  message?: string;
}

export async function fetchKickCurrentUser(accessToken: string): Promise<KickUser | null> {
  const resp = await kickApiGet<KickApiList<KickUser>>(accessToken, "https://api.kick.com/public/v1/users");
  const user = resp?.data?.[0];
  return user || null;
}

export async function fetchKickCurrentChannel(accessToken: string): Promise<KickChannel | null> {
  const resp = await kickApiGet<KickApiList<KickChannel>>(accessToken, "https://api.kick.com/public/v1/channels");
  const channel = resp?.data?.[0];
  return channel || null;
}

export async function subscribeKickWebhookEvent(
  accessToken: string,
  eventName: string,
  version = 1
): Promise<void> {
  const res = await kickCircuit.call(() =>
    fetch("https://api.kick.com/public/v1/events/subscriptions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        events: [{ name: eventName, version }],
        method: "webhook",
      }),
    })
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Kick event subscription failed ${res.status}: ${text}`);
  }
}

export interface KickWebhookSubscription {
  id: string;
  event: string;
  version: number;
  method: string;
}

export async function listKickWebhookSubscriptions(accessToken: string): Promise<KickWebhookSubscription[]> {
  const res = await kickCircuit.call(() =>
    fetch("https://api.kick.com/public/v1/events/subscriptions", {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    })
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Kick event subscription list failed ${res.status}: ${text}`);
  }
  let parsed: { data?: Array<Record<string, unknown>> } = {};
  try { parsed = JSON.parse(text); } catch { parsed = {}; }
  return (parsed.data || []).map((row) => ({
    id: String(row.id ?? ""),
    event: String(row.event ?? ""),
    version: Number(row.version ?? 1),
    method: String(row.method ?? "webhook"),
  }));
}

export interface EnsureKickSubscriptionsResult {
  subscribed: string[];
  failed: Array<{ event: string; error: string }>;
}

/**
 * Make sure the creator's channel has a webhook subscription for every event
 * in `eventNames`, reusing existing ones instead of creating duplicates. Each
 * event is reported individually so callers can be truthful about what is
 * actually wired up (e.g. rewards succeeded but chat did not).
 */
export async function ensureKickWebhookSubscriptions(
  accessToken: string,
  eventNames: string[],
  deps: {
    list?: typeof listKickWebhookSubscriptions;
    subscribe?: typeof subscribeKickWebhookEvent;
  } = {}
): Promise<EnsureKickSubscriptionsResult> {
  const list = deps.list ?? listKickWebhookSubscriptions;
  const subscribe = deps.subscribe ?? subscribeKickWebhookEvent;
  let existing = new Set<string>();
  try {
    existing = new Set((await list(accessToken)).filter((s) => s.method === "webhook").map((s) => s.event));
  } catch (err) {
    // Listing is an optimization; fall back to subscribing each event.
    console.warn("[kick-oauth] could not list event subscriptions:", err instanceof Error ? err.message : err);
  }
  const result: EnsureKickSubscriptionsResult = { subscribed: [], failed: [] };
  for (const event of eventNames) {
    if (existing.has(event)) { result.subscribed.push(event); continue; }
    try {
      await subscribe(accessToken, event);
      result.subscribed.push(event);
    } catch (err) {
      result.failed.push({ event, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

export async function encryptKickToken(plaintext: string): Promise<string> {
  const buf = await encryptToken(plaintext);
  return Buffer.from(buf).toString("hex");
}

export async function decryptKickToken(hex: string): Promise<string> {
  return decryptToken(Buffer.from(hex, "hex"));
}

export interface KickTokenSet {
  accessToken: string;
  accessEnc: string;
  refreshEnc: string | null;
  expiresAt: Date | null;
}

export async function getValidKickAccessToken(
  env: any,
  encryptedAccess: string,
  encryptedRefresh: string | null,
  expiresAt: Date | string | null
): Promise<KickTokenSet> {
  const now = Date.now();
  const expiry = expiresAt ? new Date(expiresAt).getTime() : 0;
  if (encryptedAccess && expiry > now + 60_000) {
    return {
      accessToken: await decryptKickToken(encryptedAccess),
      accessEnc: encryptedAccess,
      refreshEnc: encryptedRefresh,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    };
  }
  if (!encryptedRefresh) {
    throw new Error("Kick refresh token not available");
  }
  const refresh = await decryptKickToken(encryptedRefresh);
  const tokens = await refreshKickTokens(env, refresh);
  const accessEnc = await encryptKickToken(tokens.access_token);
  const newRefreshEnc = tokens.refresh_token ? await encryptKickToken(tokens.refresh_token) : encryptedRefresh;
  const newExpiresAt = tokens.expires_in ? new Date(now + tokens.expires_in * 1000) : null;
  return {
    accessToken: tokens.access_token,
    accessEnc,
    refreshEnc: newRefreshEnc,
    expiresAt: newExpiresAt,
  };
}

export interface KickRewardInput {
  title: string;
  cost: number;
  description?: string;
  background_color?: string;
  is_enabled?: boolean;
  is_user_input_required?: boolean;
  should_redemptions_skip_request_queue?: boolean;
}

export interface KickReward {
  id: string;
  title: string;
  cost: number;
  description?: string;
  background_color?: string;
  is_enabled?: boolean;
  is_paused?: boolean;
  is_user_input_required?: boolean;
  should_redemptions_skip_request_queue?: boolean;
}

export async function createKickChannelReward(
  accessToken: string,
  reward: KickRewardInput
): Promise<KickReward> {
  const res = await kickCircuit.call(() =>
    fetch("https://api.kick.com/public/v1/channels/rewards", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(reward),
    })
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Kick create reward failed ${res.status}: ${text}`);
  }
  const json = JSON.parse(text) as { data?: KickReward; message?: string };
  if (!json.data) {
    throw new Error(`Kick create reward returned no data: ${text}`);
  }
  return json.data;
}
