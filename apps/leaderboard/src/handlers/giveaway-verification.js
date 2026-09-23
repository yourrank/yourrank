import { isIP } from "node:net";
import { one, query } from "@yourrank/shared/db";
import { resolveViewer } from "@yourrank/shared/viewer-session";
import { linkedViewerIdentities } from "@yourrank/shared/viewer-identity";
import { giveawayRules, giveawayParticipantFacts, evaluateGiveawayEligibility } from "@yourrank/shared/giveaway-eligibility";
import { giveawayTransaction } from "../chat-giveaway-service.js";
import { bad, json, readJson, rateLimit } from "../auth.js";
import { requestIsSameOrigin } from "../viewer-membership.js";
import { generateCsrfToken, csrfCookie, SECURE_HTML } from "../middleware/index.js";
import { PLATFORM_HOST } from "../constants.js";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const platformRequest = (request) => [PLATFORM_HOST, "localhost", "127.0.0.1"].includes(new URL(request.url).hostname);
const privateJson = (data, cookie) => {
  const response = json({ ok: true, ...data }, 200, { "cache-control": "private, no-store", vary: "Cookie" });
  if (cookie) response.headers.append("set-cookie", cookie);
  return response;
};

export async function giveawayIpHash(raw, salt) {
  if (!raw || !isIP(raw) || !salt) return null;
  // WHATWG URL canonicalizes equivalent IPv6 spellings; CF provides the client address.
  const normalized = isIP(raw) === 6 ? new URL(`http://[${raw}]/`).hostname : raw;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(normalized))),
    (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleGiveawayVerification(request, env, deps = {}) {
  if (!platformRequest(request)) return bad("Use the YourRank giveaway verification link.", 404);
  if (!requestIsSameOrigin(request)) return bad("Origin mismatch", 403);
  const d = { one, query, resolveViewer, transaction: giveawayTransaction, rateLimit, ...deps };
  const body = request.method === "POST" ? (await readJson(request)) || {} : {};
  const queryId = new URL(request.url).searchParams.get("sessionId");
  if (body.sessionId && queryId && body.sessionId !== queryId) return bad("Giveaway link mismatch.", 400);
  const id = queryId || body.sessionId;
  if (!UUID.test(id || "")) return bad("Invalid giveaway link.", 400);
  const session = await d.one(`SELECT gs.id, gs.site_id, gs.keyword, gs.status, gs.rules, s.name AS community
    FROM chat_giveaway_sessions gs JOIN sites s ON s.id=gs.site_id JOIN users u ON u.id=s.user_id
    WHERE gs.id=$1 AND s.published=true AND s.is_draft=false AND u.status<>'suspended' AND u.email_verified=true`, [id]);
  if (!session || giveawayRules(session.rules).entryMode !== "verified") return bad("Verification is unavailable for this giveaway.", 404);
  const { viewer, cookie } = await d.resolveViewer(request, env);
  const identity = linkedViewerIdentities(viewer).find((i) => i.provider === "kick" && i.linkedAt);
  const base = { giveaway: { id, keyword: session.keyword, community: session.community, status: session.status },
    signedIn: !!viewer, kickUsername: identity?.username || null, ipCheck: giveawayRules(session.rules).onePerIp };
  if (!viewer || !identity) return privateJson({ ...base, status: "pending_verification", reason: viewer ? "kick_not_linked" : "not_yourrank_member" }, cookie);
  if (!(await d.rateLimit(env, `giveaway-verify:${viewer.id}`, 30, 60)).ok) return bad("Too many requests. Try again shortly.", 429);
  if (request.method !== "POST") {
    const entry = await d.one(`SELECT eligibility_status, eligibility_reason FROM chat_giveaway_entries
      WHERE giveaway_session_id=$1 AND provider='kick' AND provider_user_id=$2`, [id, identity.externalUserId]);
    return privateJson({ ...base, status: entry?.eligibility_status || "pending_verification", reason: entry?.eligibility_reason || (entry ? null : "entry_required") }, cookie);
  }
  const result = await d.transaction(async (run) => {
    const [locked] = await run("SELECT id, site_id, status, rules, verification_salt FROM chat_giveaway_sessions WHERE id=$1 FOR UPDATE", [id]);
    if (!locked || !["active", "stopped"].includes(locked.status)) return { status: "rejected", reason: "giveaway_closed" };
    const rules = giveawayRules(locked.rules);
    const [entry] = await run(`SELECT id, badges, eligibility_status, viewer_id FROM chat_giveaway_entries
      WHERE giveaway_session_id=$1 AND provider='kick' AND provider_user_id=$2 FOR UPDATE`, [id, identity.externalUserId]);
    if (!entry) return { status: "pending_verification", reason: "entry_required" };
    const facts = await giveawayParticipantFacts(run, locked.site_id, identity.externalUserId);
    if (facts.viewerId !== viewer.id) return { status: "rejected", reason: "kick_not_linked" };
    if (entry.eligibility_status === "eligible" && entry.viewer_id === viewer.id) return { status: "eligible", reason: null };
    // Failed attempts cannot overwrite an existing eligible account's hash.
    const ipHash = rules.onePerIp ? await giveawayIpHash(request.headers.get("cf-connecting-ip"), locked.verification_salt) : null;
    const eligibility = evaluateGiveawayEligibility({ ...facts, badges: entry.badges, verified: true,
      ipAvailable: !!ipHash }, rules);
    if (eligibility.status === "eligible" && ipHash) {
      // The session row is locked above, serializing every verification for this giveaway.
      const duplicate = await run(`SELECT id FROM chat_giveaway_entries WHERE giveaway_session_id=$1
        AND ip_hash=$2 AND id<>$3 AND eligibility_status='eligible' LIMIT 1`, [id, ipHash, entry.id]);
      if (duplicate.length) return { status: "rejected", reason: "duplicate_ip" };
    }
    await run(`UPDATE chat_giveaway_entries SET eligibility_status=$2, eligibility_reason=$3,
      viewer_id=$4, verified_at=CASE WHEN $2='eligible' THEN now() ELSE NULL END,
      ip_hash=CASE WHEN $2='eligible' THEN $5 ELSE NULL END WHERE id=$1`,
      [entry.id, eligibility.status, eligibility.reason, viewer.id, ipHash]);
    return eligibility;
  });
  return privateJson({ ...base, ...result }, cookie);
}

export function handleGiveawayVerificationPage(request) {
  if (!platformRequest(request)) return bad("Use the YourRank giveaway verification link.", 404);
  const token = generateCsrfToken();
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Verify giveaway entry · YourRank</title><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/ui.css"></head>
    <body><main class="wrap"><section class="card"><a href="/me">YourRank account</a><h1>Verify giveaway entry</h1>
    <h2 id="giveaway-community"></h2><p id="giveaway-identity"></p><p id="giveaway-state" role="status" aria-live="polite">Loading your entry…</p>
    <p id="giveaway-ip-notice" hidden>One account per IP is enabled. YourRank stores a giveaway-specific hash, never your raw IP. People sharing a connection may be unable to enter together.</p>
    <a class="btn" id="giveaway-signin" hidden>Sign in with Kick</a><button class="btn btn--accent" id="giveaway-verify" type="button" disabled>Verify Entry</button>
    </section></main><script type="module" src="/assets/giveaway-verification.js"></script></body></html>`,
  { headers: { ...SECURE_HTML, "cache-control": "private, no-store", "set-cookie": csrfCookie(token, request) } });
}
