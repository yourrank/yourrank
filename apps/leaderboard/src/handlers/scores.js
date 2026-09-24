// Score postback handlers (authenticated via X-Postback-Key + HMAC-SHA256 signature)
import { json, bad, denied, rateLimit as defaultRateLimit, rateLimitHeaders } from "../auth.js";
import { saveSite as defaultSaveSite } from "../site.js";
import { effectivePlan } from "@yourrank/shared/plans";
import { checkLimit, checkTotalWithinLimit, assertFeature } from "@yourrank/shared/entitlements";
import { one as defaultOne } from "@yourrank/shared/db";
import { verifyHmacSha256Hex as defaultVerifyHmacSha256Hex, hashToken as defaultHashToken } from "@yourrank/shared/crypto";
import {
  computeReplayHash as defaultComputeReplayHash,
  findPostbackOwner as defaultFindPostbackOwner,
  logPostbackIntake as defaultLogPostbackIntake,
} from "@yourrank/shared/postback";
import {
  computeIdempotencyRequestHash as defaultComputeIdempotencyRequestHash,
  reserveIdempotencyKey as defaultReserveIdempotencyKey,
  completeIdempotencyKey as defaultCompleteIdempotencyKey,
  releaseIdempotencyKey as defaultReleaseIdempotencyKey,
  IDEMPOTENCY_KEY_MAX_LENGTH,
} from "@yourrank/shared/api-idempotency";
import { z } from "@yourrank/shared/validation";
import { validateAndNormalizePlayers } from "../player-rules.js";
import { SCORE_MAX, WIN_RATE_MAX, INT32_MAX, INT32_MIN } from "../player-rules.js";

const scoreNumber = z
  .union([z.number(), z.string()])
  .transform((value) => Number(value))
  .pipe(z.number().finite().min(0).max(SCORE_MAX));

const signedNumber = z
  .union([z.number(), z.string()])
  .transform((value) => Number(value))
  .pipe(z.number().finite().min(-SCORE_MAX).max(SCORE_MAX));

const signedRateNumber = z
  .union([z.number(), z.string()])
  .transform((value) => Number(value))
  .pipe(z.number().finite().min(-WIN_RATE_MAX).max(WIN_RATE_MAX));

const intNumber = z
  .union([z.number(), z.string()])
  .transform((value) => Number(value))
  .pipe(z.number().int().finite().min(INT32_MIN).max(INT32_MAX));

const playerEntry = z.object({
  name: z.string().trim().min(1).max(80),
  wagered: scoreNumber.optional(),
  prize: scoreNumber.optional(),
  score: scoreNumber.optional(),
  hands: intNumber.optional(),
  netProfit: signedNumber.optional(),
  winRate: signedRateNumber.optional(),
  change: intNumber.optional(),
}).strict();

const noDuplicateNames = (body, ctx) => {
  const seen = new Set();
  for (const [index, player] of body.players.entries()) {
    const normalized = player.name.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(normalized)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate player name: ${player.name}`,
        path: ["players", index, "name"],
      });
    }
    seen.add(normalized);
  }
};

export const scoreBodySchema = z
  .object({
    slug: z.string().trim().min(1).max(80).optional(),
    siteId: z.string().uuid().optional(),
    players: z.array(playerEntry).max(9999),
  })
  .strict()
  .superRefine(noDuplicateNames);

export const scorePatchBodySchema = z
  .object({
    slug: z.string().trim().min(1).max(80).optional(),
    siteId: z.string().uuid().optional(),
    players: z.array(playerEntry).min(1).max(9999),
  })
  .strict()
  .superRefine(noDuplicateNames);

// Shared pipeline for POST (bulk replace) and PATCH (incremental) /api/scores:
// auth -> rate limit -> HMAC -> owner -> schema -> board resolve + key scope ->
// plan/schedule gates -> idempotency -> execute. `execute` returns the Response;
// `replayKind` feeds the exact-body replay guard when no Idempotency-Key is sent.
async function handleScoreWrite(request, env, deps, { method, rateLimitPerMinute, schema, replayKind, execute }) {
  const {
    saveSiteImpl = defaultSaveSite,
    rateLimit = defaultRateLimit,
    one = defaultOne,
    verifyHmacSha256Hex = defaultVerifyHmacSha256Hex,
    hashToken = defaultHashToken,
    computeReplayHash = defaultComputeReplayHash,
    findPostbackOwner = defaultFindPostbackOwner,
    logPostbackIntake = defaultLogPostbackIntake,
    computeIdempotencyRequestHash = defaultComputeIdempotencyRequestHash,
    reserveIdempotencyKey = defaultReserveIdempotencyKey,
    completeIdempotencyKey = defaultCompleteIdempotencyKey,
    releaseIdempotencyKey = defaultReleaseIdempotencyKey,
  } = deps;
  try {
    const postbackKey = request.headers.get("x-postback-key");
    if (!postbackKey) return bad("Missing X-Postback-Key header.", 401);
    const signature = request.headers.get("x-postback-signature");
    if (!signature) return bad("Missing X-Postback-Signature header.", 401);
    // Rate limit per key hash so the plaintext secret never reaches the limiter.
    const rl = await rateLimit(env, `${method === "PATCH" ? "scores-upsert" : "scores"}:${await hashToken(postbackKey)}`, rateLimitPerMinute, 60);
    if (!rl.ok) return bad("Rate limit exceeded. Try again shortly.", 429, rateLimitHeaders(rl));
    // Verify HMAC-SHA256 signature of the raw request body before parsing or lookup.
    const rawBody = await request.text();
    const valid = await verifyHmacSha256Hex(postbackKey, rawBody, signature);
    if (!valid) return bad("Invalid postback signature.", 401);

    // H-04: resolve the key owner from postback_keys, then block exact replays.
    const keyOwner = await findPostbackOwner(postbackKey, "signed");
    if (!keyOwner) return bad("Invalid postback key or board reference.", 401);
    logPostbackIntake("scores_signed", keyOwner, true);

    let raw;
    try { raw = JSON.parse(rawBody); } catch { return bad("Invalid JSON body."); }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return bad(`${issue.path.join(".") || "request"}: ${issue.message}`);
    }
    const body = parsed.data;
    // H-03: A user-level postback key can own many boards. Require an explicit
    // board reference (slug or siteId, in body or X-Postback-Site header).
    const boardRef = body.slug || body.siteId || request.headers.get("x-postback-site");
    if (!boardRef || typeof boardRef !== "string") return bad("Missing board slug or siteId. Use body.slug, body.siteId, or X-Postback-Site header.", 400);
    const site = await one("SELECT s.id, s.user_id, s.slug, s.name, s.tagline, s.casino, s.code, s.cta_url, s.prize_pool, s.period, s.starts_at, s.ends_at, s.reset_note, s.blurb, s.extra_json, s.published, s.theme_json, s.updated_at FROM sites s WHERE s.user_id=$1 AND (s.slug=$2 OR s.id::text=$2)", [keyOwner.userId, boardRef]);
    if (!site) return bad("Invalid postback key or board reference.", 401);
    if (keyOwner.siteId && keyOwner.siteId !== site.id) return bad("This API key is scoped to another board.", 403);
    // Gate behind the signed_api feature (site owner's plan decides).
    const owner = await one("SELECT id, plan, (EXTRACT(EPOCH FROM plan_expires_at) * 1000)::double precision AS plan_expires_at, status FROM users WHERE id=$1", [site.user_id]);
    const plan = effectivePlan(owner);
    const featureGate = assertFeature(plan, "signed_api");
    if (featureGate) return denied(featureGate, { actorId: keyOwner.userId, request });
    if (site.starts_at && new Date(site.starts_at).getTime() > Date.now()) {
      return bad("This leaderboard has not started yet. Change the start date before posting scores.", 409);
    }
    if (site.ends_at && new Date(site.ends_at).getTime() <= Date.now()) {
      return bad("This leaderboard has ended. Change the end date or start a new race before posting scores.", 409);
    }
    const user = owner;
    const endpoint = `${method} /api/scores`;
    // Optional Idempotency-Key: server-side reservation/replay replaces the
    // exact-body replay guard for that request.
    const rawIdempotencyKey = request.headers.get("idempotency-key");
    if (rawIdempotencyKey !== null) {
      const idemKey = rawIdempotencyKey.trim();
      if (!idemKey || idemKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
        return bad("Idempotency-Key must be 1-200 characters.", 400);
      }
      const requestHash = await computeIdempotencyRequestHash({ method, path: "/api/scores", siteId: site.id, body: rawBody });
      const identity = { userId: keyOwner.userId, siteId: site.id, endpoint, key: idemKey };
      const reservation = await reserveIdempotencyKey({ ...identity, requestHash });
      if (reservation.state === "mismatch") return bad("Idempotency-Key was already used with a different request payload.", 422);
      if (reservation.state === "in_progress") return bad("A request with this Idempotency-Key is still being processed. Retry shortly.", 409);
      if (reservation.state === "replay") {
        const stored = reservation.body && typeof reservation.body === "object" ? reservation.body : {};
        return new Response(JSON.stringify(stored), {
          status: reservation.status || 200,
          headers: { "content-type": "application/json", "Idempotency-Replayed": "true", ...rateLimitHeaders(rl) },
        });
      }
      const response = await execute({ body, site, user, plan, keyOwner, saveSiteImpl, computeReplayHash, rawBody, rl });
      const clone = response.clone();
      if (clone.status >= 200 && clone.status < 300) {
        let stored = {};
        try { stored = await clone.json(); } catch { stored = {}; }
        await completeIdempotencyKey({ ...identity, status: clone.status, body: stored });
      } else {
        await releaseIdempotencyKey(identity);
      }
      return response;
    }

    // No Idempotency-Key: keep the 24-hour exact-body replay guard.
    const replayHash = await computeReplayHash({ kind: replayKind, siteId: site.id, body: rawBody });
    const response = await execute({ body, site, user, plan, keyOwner, saveSiteImpl, computeReplayHash, rawBody, rl, replayHash });
    return response;
  } catch (e) {
    console.error("scores API failed:", String(e?.message || e));
    return bad("Internal error.", 500);
  }
}

const brandPayload = (site) => ({
  brand: { name: site.name, tagline: site.tagline, casino: site.casino, code: site.code, ctaUrl: site.cta_url, prizePool: site.prize_pool, period: site.period, resetNote: site.reset_note },
  partner: { blurb: site.blurb },
});

// POST /api/scores — authenticated by X-Postback-Key header + X-Postback-Signature HMAC.
// Validates key against sites table, checks Pro plan gate, replaces player list.
export async function handleScores(request, env, deps = {}) {
  return handleScoreWrite(request, env, deps, {
    method: "POST",
    rateLimitPerMinute: 10,
    schema: scoreBodySchema,
    replayKind: "scores",
    execute: async ({ body, site, user, plan, keyOwner, saveSiteImpl, rl, replayHash }) => {
      const validation = validateAndNormalizePlayers(body.players);
      if (validation.error) return bad(validation.error, 400);
      const validPlayers = validation.players;
      const playerDenial = checkTotalWithinLimit(plan, "players_per_site", validPlayers.length);
      if (playerDenial) return denied(playerDenial, { actorId: keyOwner.userId, request });
      const r = await saveSiteImpl(env, user, { ...brandPayload(site), players: validPlayers }, site.id, request, {
        scoreReplay: replayHash ? { userId: keyOwner.userId, hash: replayHash } : undefined,
      });
      return r.error ? bad(r.error, r.code === "duplicate_postback" ? 409 : 400) : json({ ok: true, players: validPlayers.length }, 200, rateLimitHeaders(rl));
    },
  });
}

// PATCH /api/scores — same auth contract; merges the submitted players into the
// existing board instead of replacing it.
export async function handleScoresUpsert(request, env, deps = {}) {
  return handleScoreWrite(request, env, deps, {
    method: "PATCH",
    rateLimitPerMinute: 60,
    schema: scorePatchBodySchema,
    replayKind: "scores-upsert",
    execute: async ({ body, site, user, keyOwner, saveSiteImpl, rl, replayHash }) => {
      const r = await saveSiteImpl(env, user, brandPayload(site), site.id, request, {
        scoreReplay: replayHash ? { userId: keyOwner.userId, hash: replayHash } : undefined,
        scorePatch: body.players,
      });
      if (r.error) return bad(r.error, r.code === "duplicate_postback" ? 409 : 400);
      const patch = r.patch || { total: 0, updated: 0, created: 0 };
      return json({ ok: true, players: patch.total, updated: patch.updated, created: patch.created }, 200, rateLimitHeaders(rl));
    },
  });
}
