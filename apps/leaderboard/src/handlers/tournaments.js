// Tournament & Elimination Brackets Handlers.
import {
  requireUser as defaultRequireUser,
  ok,
  bad,
  readJson,
  rateLimit as defaultRateLimit,
  clientIp as defaultClientIp,
  requireSiteFeature,
} from "../auth.js";
import { getByUser as defaultGetByUser, getBoardById as defaultGetBoardById } from "../site.js";
import { requireSiteOwner } from "../site-authorization.js";
import {
  one as defaultOne,
  query as defaultQuery,
  withTransaction as defaultWithTransaction,
} from "@yourrank/shared/db";
import { logAudit as defaultLogAudit } from "@yourrank/shared/audit";
import {
  kickChatMessageToIngestInput,
  loadChatGiveawayConnection as defaultLoadChatGiveawayConnection,
} from "@yourrank/shared/chat-giveaways";
import { reconcileKickWebhookDelivery as defaultReconcileKickWebhookDelivery } from "./kick-auth.js";
import { buildBracket, resolveByes, isBye, BYE, MIN_BRACKET_PARTICIPANTS } from "../lib/tournament-bracket.js";

const TOURNAMENT_READ_RATE_LIMIT = 60;
const ENTRY_SOURCES = new Set(["chat", "page", "manual", "leaderboard"]);
const SUPPORTED_BRACKET_SIZES = [4, 8, 16, 32];
const CREATABLE_FORMATS = ["bracket", "1v1"];

class TournamentConflictError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = "TournamentConflictError";
    this.status = status;
  }
}

function isSupportedBracketSize(n) {
  return Number.isInteger(n) && SUPPORTED_BRACKET_SIZES.includes(n);
}

async function seedTournamentMatches(tx, tournamentId, participants, bracketSize) {
  for (const match of buildBracket(participants, bracketSize)) {
    await tx.unsafe(
      `INSERT INTO tournament_matches
         (tournament_id, round_number, match_index, player1_name, player2_name,
          player1_score, player2_score, winner_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tournamentId,
        match.round_number,
        match.match_index,
        match.player1_name,
        match.player2_name,
        match.player1_score || 0,
        match.player2_score || 0,
        match.winner_name,
        match.status,
      ]
    );
  }
}

// Replays the in-memory BYE resolution against stored matches: a score update
// can fill a slot next to a BYE, and that pair auto-advances just like the
// seeded BYE matches did. Persists each newly completed match and its
// propagated winner, repeating until the bracket is stable.
async function resolveByeMatchesTx(tx, tournamentId, bracketSize) {
  const totalRounds = Math.log2(bracketSize || 0);
  for (;;) {
    const stored = await tx.query(
      `SELECT id, round_number, match_index, player1_name, player2_name, status, winner_name
         FROM tournament_matches
        WHERE tournament_id=$1
        ORDER BY round_number ASC, match_index ASC
        FOR UPDATE`,
      [tournamentId]
    );
    const resolved = resolveByes((stored || []).map((row) => ({ ...row })));
    const dirty = resolved.filter((after, i) => {
      const before = stored[i];
      return after.status !== before.status || after.winner_name !== before.winner_name;
    });
    if (!dirty.length) return;
    for (const match of dirty) {
      await tx.unsafe(
        `UPDATE tournament_matches
            SET status='completed', winner_name=$1, player1_score=0, player2_score=0
          WHERE id=$2`,
        [match.winner_name, match.id]
      );
      const nextIndex = Math.floor(match.match_index / 2);
      const slotColumn = match.match_index % 2 === 0 ? "player1_name" : "player2_name";
      if (match.round_number < totalRounds) {
        await tx.unsafe(
          `UPDATE tournament_matches
              SET ${slotColumn}=$1
            WHERE tournament_id=$2 AND round_number=$3 AND match_index=$4
              AND (${slotColumn} IS NULL OR ${slotColumn} = '' OR ${slotColumn} = 'TBD')`,
          [match.winner_name, tournamentId, match.round_number + 1, nextIndex]
        );
      }
    }
    const final = dirty.find((match) => match.round_number === totalRounds);
    if (final && !isBye(final.winner_name)) {
      await tx.unsafe(
        `UPDATE tournaments SET winner_name=$1, status='completed', updated_at=now()
          WHERE id=$2 AND status NOT IN ('completed', 'cancelled')`,
        [final.winner_name, tournamentId]
      );
      await tx.unsafe("DELETE FROM tournament_open_signups WHERE tournament_id=$1", [tournamentId]);
    }
  }
}

function tournamentIdFromRequest(request) {
  return new URL(request.url).pathname.split("/")[3] || "";
}

function clampTrustScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null;
}

async function getTournamentForMutation(request, user, one, requireSiteCapabilityImpl) {
  const tournamentId = tournamentIdFromRequest(request);
  if (!tournamentId) return { error: bad("tournamentId is required.") };

  const tournament = await one(
    `SELECT t.*, s.user_id AS site_user_id
       FROM tournaments t
       JOIN sites s ON s.id=t.site_id
      WHERE t.id=$1`,
    [tournamentId]
  );
  if (!tournament) return { error: bad("Tournament not found.", 404) };

  const authorization = await requireSiteCapabilityImpl(
    user,
    { id: tournament.site_id, user_id: tournament.site_user_id }
  );
  if (authorization.res) return { error: authorization.res };
  const gateRes = await requireSiteFeature({ user_id: tournament.site_user_id }, "tournaments", { request, oneImpl: one });
  if (gateRes) return { error: gateRes };
  return { tournament };
}

// Kick channel slugs are lowercase letters, digits, underscores and hyphens.
function normalizeChatChannel(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(?:www\.)?kick\.com\//i, "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 40);
}

// The eligible-entry predicate, shared by the participant-select count and
// row lock so both always agree. $1 = tournament_id, $2 = flag-only-when-free
// (entry_fee = 0).
const ELIGIBLE_ENTRY_PREDICATE = `
    status IN ('pending', 'confirmed')
    AND (
      NOT $2::boolean OR alt_flag = false OR EXISTS (
        SELECT 1 FROM audit_log
         WHERE entity_type='tournament_entry' AND entity_id=tournament_entries.id::text
           AND action='people_review_allow'
      )
    )`;

function shuffle(array) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const isReservedName = (name) => String(name || "").trim().toUpperCase() === BYE;

/**
 * GET /api/tournaments — List tournaments for site
 */
export async function handleGetTournaments(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    getByUser = defaultGetByUser,
    getBoardById = defaultGetBoardById,
    query = defaultQuery,
    rateLimit = defaultRateLimit,
    clientIp = defaultClientIp,
    requireSiteOwner: requireSiteOwnerImpl = requireSiteOwner,
    loadChatGiveawayConnection = defaultLoadChatGiveawayConnection,
  } = deps;
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const rl = await rateLimit(env, `tournaments:${clientIp(request)}`, TOURNAMENT_READ_RATE_LIMIT, 60);
  if (!rl.ok) return bad("Rate limit exceeded. Try again shortly.", 429);

  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId");
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  if (!site) return bad("Site not found.", 404);
  const authorization = await requireSiteOwnerImpl(user, site);
  if (authorization.res) return authorization.res;

  const tournaments = await query(
    `SELECT id, title, game_name, bracket_size, status, winner_name, created_at,
            signup_state, entry_cap, format, anti_alt_enabled, require_login,
            min_credits, entry_fee, entry_keyword, chat_channel
       FROM tournaments
      WHERE site_id=$1
      ORDER BY created_at DESC LIMIT 20`,
    [site.id]
  );

  return ok({
    tournaments: tournaments || [],
    chatRegistration: await loadChatGiveawayConnection(query, site.id, "kick"),
  });
}

/**
 * POST /api/tournaments — Streamer creates a single-elimination tournament bracket
 */
export async function handleCreateTournament(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    getByUser = defaultGetByUser,
    getBoardById = defaultGetBoardById,
    withTransaction = defaultWithTransaction,
    logAudit = defaultLogAudit,
    requireSiteCapabilityImpl = requireSiteOwner,
    one = defaultOne,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const body = await readJson(request);
  const title = String(body?.title || "").trim() || "Community Tournament";
  const gameName = String(body?.gameName || "Game").trim();
  const requestedBracketSize = body?.bracketSize === undefined || body?.bracketSize === null || body?.bracketSize === ""
    ? 8
    : parseInt(body.bracketSize, 10);
  if (!isSupportedBracketSize(requestedBracketSize)) {
    return bad("Bracket size must be 4, 8, 16, or 32.");
  }
  const tournamentFormat = body?.format === undefined || body?.format === null || body?.format === ""
    ? "bracket"
    : body.format;
  if (!CREATABLE_FORMATS.includes(tournamentFormat)) {
    return bad("Unsupported tournament format.");
  }
  const entryCap = body?.entryCap === "" || body?.entryCap === null || body?.entryCap === undefined
    ? null
    : Math.max(1, parseInt(body.entryCap, 10) || 1);
  const antiAltEnabled = body?.antiAltEnabled === true;
  const requireLogin = body?.requireLogin === true;
  const minCredits = Math.max(0, parseInt(body?.minCredits, 10) || 0);
  const entryFee = Math.max(0, parseInt(body?.entryFee, 10) || 0);
  const entryKeyword = String(body?.entryKeyword || "!join").trim().slice(0, 40) || "!join";
  const chatChannel = normalizeChatChannel(body?.chatChannel) || null;

  const rawParticipants = Array.isArray(body?.participants) ? body.participants : [];
  const providedParticipantCount = rawParticipants.length;
  const bracketSize = requestedBracketSize;
  const participants = providedParticipantCount
    ? rawParticipants.map((p) => String(p || "").trim()).filter(Boolean)
    : [];
  if (providedParticipantCount && participants.length !== providedParticipantCount) {
    return bad("Every participant must have a non-empty name.");
  }
  if (participants.length > 0
      && (participants.length < MIN_BRACKET_PARTICIPANTS || participants.length > bracketSize)) {
    return bad(`Provide between ${MIN_BRACKET_PARTICIPANTS} and ${bracketSize} participants.`);
  }
  if (participants.some(isReservedName)) {
    return bad("That name is reserved.", 400);
  }

  const url = new URL(request.url);
  const siteId = body?.siteId || url.searchParams.get("siteId");
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  if (!site) return bad("Site not found", 404);
  const authorization = await requireSiteCapabilityImpl(user, site);
  if (authorization.res) return authorization.res;
  {
    const gateRes = await requireSiteFeature(site, "tournaments", { request, oneImpl: one });
    if (gateRes) return gateRes;
  }

  // A tournament is a draft until a bracket exists: either seeded from explicit
  // participants now, or later by the participant pick.
  const status = participants.length > 0 ? "active" : "draft";
  const result = await withTransaction(async (tx) => {
    const tourn = await tx.one(
      `INSERT INTO tournaments
        (site_id, title, game_name, bracket_size, participants_json,
         entry_cap, format, anti_alt_enabled, require_login, min_credits, entry_fee, entry_keyword,
         chat_channel, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, title, game_name, bracket_size, status, signup_state, entry_cap,
              format, anti_alt_enabled, require_login, min_credits, entry_fee, entry_keyword,
              chat_channel, created_at`,
      [
        site.id,
        title,
        gameName,
        bracketSize,
        participants,
        entryCap,
        tournamentFormat,
        antiAltEnabled,
        requireLogin,
        minCredits,
        entryFee,
        entryKeyword,
        chatChannel,
        status,
      ]
    );

    if (participants.length > 0) {
      await seedTournamentMatches(tx, tourn.id, shuffle(participants), bracketSize);
    }

    return tourn;
  });

  await logAudit({
    actorId: user.id,
    action: "tournament_create",
    entityType: "tournament",
    entityId: result.id,
    request,
    details: { title, gameName, bracketSize, tournamentFormat, entryCap, entryKeyword, status },
  });

  return ok({
    tournament: result,
    message: participants.length
      ? `🏆 Tournament ${title} created with ${participants.length} players!`
      : `🏆 Tournament ${title} is ready for signups.`,
  });
}

async function updateSignupState(request, env, state, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    one = defaultOne,
    query = defaultQuery,
    logAudit = defaultLogAudit,
    requireSiteCapabilityImpl = requireSiteOwner,
    loadChatGiveawayConnection = defaultLoadChatGiveawayConnection,
    reconcileKickWebhookDelivery = defaultReconcileKickWebhookDelivery,
    withTransaction = defaultWithTransaction,
  } = deps;
  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const access = await getTournamentForMutation(request, user, one, requireSiteCapabilityImpl);
  if (access.error) return access.error;
  // Signups are collected from Kick chat, so the server refuses to open them
  // until the channel to listen to is actually stored.
  if (state === "open") {
    if (!normalizeChatChannel(access.tournament.chat_channel)) {
      return bad("Add your Kick channel before opening signups.", 400);
    }
    // Entries are created by the Kick chat webhook, so opening signups also
    // requires a routable connection and confirmed chat-event delivery; the
    // reconcile repairs drift instead of failing on first sight.
    const connection = await loadChatGiveawayConnection(query, access.tournament.site_id, "kick");
    if (!connection.connected) {
      return bad("Connect your Kick channel in Settings → Connections before opening signups.", 409);
    }
    if (normalizeChatChannel(access.tournament.chat_channel).toLowerCase() !== String(connection.channelName || "").toLowerCase()) {
      return bad(`Signups are collected from your connected Kick channel (${connection.channelName}). Set this tournament's Kick channel to it before opening signups.`, 409);
    }
    const delivery = await reconcileKickWebhookDelivery(env, access.tournament.site_id, deps);
    if (delivery.status !== "ok" || !delivery.subscriptions.chatEvents) {
      return bad("Kick chat events could not be subscribed for this channel. Reconnect Kick in Settings → Connections, then open signups again.", 409);
    }
  }
  // One open tournament per site, enforced by the tournament_open_signups
  // lock row inside the same transaction as the state change. The lock row is
  // the concurrency authority; the tournaments scan is a friendly check for
  // legacy rows that predate the lock table.
  let result;
  try {
    result = await withTransaction(async (tx) => {
      if (state === "open") {
        const siteId = access.tournament.site_id;
        const id = access.tournament.id;
        const holder = await tx.one(
          `SELECT l.tournament_id, t.signup_state, t.status
             FROM tournament_open_signups l
             JOIN tournaments t ON t.id = l.tournament_id
            WHERE l.site_id = $1
            FOR UPDATE`,
          [siteId]
        );
        if (holder && holder.tournament_id !== id && holder.signup_state === "open"
            && !["completed", "cancelled"].includes(holder.status)) {
          return { conflict: true };
        }
        if (holder && holder.tournament_id !== id) {
          // Stale holder (e.g. a finished tournament): release it first.
          await tx.one("DELETE FROM tournament_open_signups WHERE site_id=$1 RETURNING site_id", [siteId]);
        }
        const other = await tx.one(
          `SELECT id FROM tournaments
            WHERE site_id=$1 AND id<>$2 AND signup_state='open'
              AND status NOT IN ('completed','cancelled')
            LIMIT 1`,
          [siteId, id]
        );
        if (other) return { conflict: true };
        const lock = await tx.one(
          `INSERT INTO tournament_open_signups (site_id, tournament_id)
           VALUES ($1, $2) ON CONFLICT (site_id) DO NOTHING RETURNING site_id`,
          [siteId, id]
        );
        if (!lock && !(holder && holder.tournament_id === id)) return { conflict: true };
      } else {
        await tx.one("DELETE FROM tournament_open_signups WHERE tournament_id=$1 RETURNING site_id", [access.tournament.id]);
      }
      const tournament = await tx.one(
        `UPDATE tournaments
            SET signup_state=$1, updated_at=now()
          WHERE id=$2
          RETURNING id, signup_state, entry_cap, entry_keyword, chat_channel`,
        [state, access.tournament.id]
      );
      return { tournament };
    });
  } catch (error) {
    if (error?.code === "23505") {
      return bad("Another tournament already has open signups. Lock or finish it before opening this one.", 409);
    }
    throw error;
  }
  if (result.conflict) {
    return bad("Another tournament already has open signups. Lock or finish it before opening this one.", 409);
  }
  await logAudit({
    actorId: user.id,
    action: `tournament_signups_${state}`,
    entityType: "tournament",
    entityId: access.tournament.id,
    request,
    details: { signupState: state },
  });
  return ok({ tournament: result.tournament });
}

export function handleOpenTournamentSignups(request, env, deps = {}) {
  return updateSignupState(request, env, "open", deps);
}

export function handleLockTournamentSignups(request, env, deps = {}) {
  return updateSignupState(request, env, "locked", deps);
}

/**
 * POST /api/tournaments/:id/settings — Update the quiet tournament options.
 */
export async function handleUpdateTournamentSettings(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    one = defaultOne,
    withTransaction = defaultWithTransaction,
    logAudit = defaultLogAudit,
    requireSiteCapabilityImpl = requireSiteOwner,
  } = deps;
  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const access = await getTournamentForMutation(request, user, one, requireSiteCapabilityImpl);
  if (access.error) return access.error;
  const body = await readJson(request) || {};
  const updates = [];
  const values = [];
  const addUpdate = (column, value) => {
    updates.push(`${column}=$${values.length + 1}`);
    values.push(value);
  };
  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    addUpdate("title", String(body.title || "").trim() || access.tournament.title || "Tournament");
  }
  if (Object.prototype.hasOwnProperty.call(body, "gameName")) {
    addUpdate("game_name", String(body.gameName || "").trim() || access.tournament.game_name || "Game");
  }
  const wantsFormat = Object.prototype.hasOwnProperty.call(body, "format");
  const wantsBracketSize = Object.prototype.hasOwnProperty.call(body, "bracketSize");
  if (wantsFormat || wantsBracketSize) {
    // Format and bracket size shape entries and the seeded bracket. Once either
    // exists, changing them would silently invalidate state, so refuse instead.
    const usage = await one(
      `SELECT (SELECT count(*)::integer FROM tournament_entries WHERE tournament_id=$1) AS entries,
              (SELECT count(*)::integer FROM tournament_matches WHERE tournament_id=$1) AS matches`,
      [access.tournament.id]
    );
    const hasEntries = (usage?.entries || 0) > 0 || access.tournament.signup_state !== "closed";
    const hasBracket = (usage?.matches || 0) > 0
      || ["completed", "cancelled"].includes(access.tournament.status);
    if (wantsFormat && body.format !== access.tournament.format && (hasEntries || hasBracket)) {
      return bad("Format is locked once signups have opened or entries exist.", 409);
    }
    if (wantsBracketSize) {
      const bracketSize = parseInt(body.bracketSize, 10);
      if (!isSupportedBracketSize(bracketSize)) {
        return bad("Bracket size must be 4, 8, 16, or 32.");
      }
      if (bracketSize !== access.tournament.bracket_size && hasBracket) {
        return bad("Bracket size is locked once the bracket has been created.", 409);
      }
      if (bracketSize !== access.tournament.bracket_size) addUpdate("bracket_size", bracketSize);
    }
    if (wantsFormat && body.format !== access.tournament.format) {
      if (!CREATABLE_FORMATS.includes(body.format)) {
        return bad("Unsupported tournament format.");
      }
      addUpdate("format", body.format);
    }
  }
  const wantsEntryCap = Object.prototype.hasOwnProperty.call(body, "entryCap");
  const entryCap = !wantsEntryCap ? undefined
    : body.entryCap === "" || body.entryCap === null
      ? null
      : Math.max(1, parseInt(body.entryCap, 10) || 1);
  if (wantsEntryCap) {
    addUpdate("entry_cap", entryCap);
  }
  if (Object.prototype.hasOwnProperty.call(body, "antiAltEnabled")) {
    addUpdate("anti_alt_enabled", body.antiAltEnabled === true);
  }
  if (Object.prototype.hasOwnProperty.call(body, "requireLogin")) {
    addUpdate("require_login", body.requireLogin === true);
  }
  if (Object.prototype.hasOwnProperty.call(body, "minCredits")) {
    addUpdate("min_credits", Math.max(0, parseInt(body.minCredits, 10) || 0));
  }
  if (Object.prototype.hasOwnProperty.call(body, "entryFee")) {
    addUpdate("entry_fee", Math.max(0, parseInt(body.entryFee, 10) || 0));
  }
  if (Object.prototype.hasOwnProperty.call(body, "entryKeyword")) {
    addUpdate("entry_keyword", String(body.entryKeyword || "!join").trim().slice(0, 40) || "!join");
  }
  if (Object.prototype.hasOwnProperty.call(body, "chatChannel")) {
    addUpdate("chat_channel", normalizeChatChannel(body.chatChannel) || null);
  }

  const returning = `id, title, game_name, bracket_size, status, signup_state, entry_cap, format,
                     anti_alt_enabled, require_login, min_credits, entry_fee, entry_keyword,
                     chat_channel`;
  let tournament = access.tournament;
  let autoLocked = false;
  if (updates.length) {
    if (wantsEntryCap) {
      // The cap is checked and applied under the tournament row lock so a
      // concurrent signup can never land between the count and the update.
      const outcome = await withTransaction(async (tx) => {
        const locked = await tx.one(
          "SELECT id, signup_state, entry_cap, status FROM tournaments WHERE id=$1 FOR UPDATE",
          [access.tournament.id]
        );
        const active = await tx.one(
          `SELECT count(*)::integer AS count FROM tournament_entries
            WHERE tournament_id=$1 AND status IN ('pending', 'confirmed', 'selected')`,
          [access.tournament.id]
        );
        if (entryCap !== null && entryCap < (active?.count || 0)) {
          return { error: `Signup limit cannot be lower than the current ${active.count} registrations.`, status: 400 };
        }
        const txValues = [...values, access.tournament.id];
        let updated = await tx.one(
          `UPDATE tournaments
              SET ${updates.join(", ")}, updated_at=now()
            WHERE id=$${txValues.length}
            RETURNING ${returning}`,
          txValues
        );
        let lockedNow = false;
        if (locked?.signup_state === "open" && entryCap !== null && (active?.count || 0) >= entryCap) {
          updated = await tx.one(
            `UPDATE tournaments SET signup_state='locked', updated_at=now()
              WHERE id=$1 RETURNING ${returning}`,
            [access.tournament.id]
          );
          await tx.unsafe("DELETE FROM tournament_open_signups WHERE tournament_id=$1", [access.tournament.id]);
          lockedNow = true;
        }
        return { tournament: updated, autoLocked: lockedNow };
      });
      if (outcome.error) return bad(outcome.error, outcome.status);
      tournament = outcome.tournament;
      autoLocked = outcome.autoLocked;
    } else {
      values.push(access.tournament.id);
      tournament = await one(
        `UPDATE tournaments
            SET ${updates.join(", ")}, updated_at=now()
          WHERE id=$${values.length}
          RETURNING ${returning}`,
        values
      );
    }
    await logAudit({
      actorId: user.id,
      action: "tournament_settings_update",
      entityType: "tournament",
      entityId: access.tournament.id,
      request,
      details: { fields: updates.map((update) => update.split("=")[0]), ...(autoLocked ? { autoLocked: true } : {}) },
    });
  }
  return ok({ tournament });
}

/**
 * GET /api/tournaments/:id/entries — Private, rate-limited streamer entry list.
 */
export async function handleListTournamentEntries(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    one = defaultOne,
    query = defaultQuery,
    rateLimit = defaultRateLimit,
    clientIp = defaultClientIp,
    requireSiteCapabilityImpl = requireSiteOwner,
  } = deps;
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const tournamentId = tournamentIdFromRequest(request);
  if (!tournamentId) return bad("tournamentId is required.");
  const access = await getTournamentForMutation(request, user, one, requireSiteCapabilityImpl);
  if (access.error) return access.error;
  const rl = await rateLimit(env, `tournament-entries:${clientIp(request)}`, TOURNAMENT_READ_RATE_LIMIT, 60);
  if (!rl.ok) return bad("Rate limit exceeded. Try again shortly.", 429);

  const tournament = access.tournament;
  const entries = await query(
    `SELECT id, display_name, viewer_id, source, status, trust_score, alt_flag, alt_reason,
            team_no, created_at, updated_at
       FROM tournament_entries
      WHERE tournament_id=$1
      ORDER BY CASE WHEN $2::boolean AND alt_flag THEN 0 ELSE 1 END,
               created_at ASC`,
    [tournamentId, tournament.anti_alt_enabled === true]
  );
  const counts = await one(
    `SELECT count(*) FILTER (WHERE status IN ('pending', 'confirmed', 'selected'))::integer AS active,
            count(*) FILTER (WHERE status='waitlist')::integer AS waitlist,
            count(*) FILTER (WHERE status='removed')::integer AS removed,
            count(*) FILTER (WHERE status='blocked')::integer AS blocked
       FROM tournament_entries
      WHERE tournament_id=$1`,
    [tournamentId]
  );
  return ok({ tournament, entries: entries || [], counts: counts || { active: 0, waitlist: 0, removed: 0, blocked: 0 } });
}

/**
 * Insert (or reactivate) one entry under the tournament's row lock. Shared by
 * the dashboard endpoint and the Kick chat webhook ingest; signups must be
 * open regardless of the entry source.
 */
export async function addTournamentEntryTx(tx, tournamentId, { displayName, viewerId, source, trustScore, altFlag, altReason }) {
  const tournament = await tx.one(
    `SELECT id, signup_state, entry_cap
       FROM tournaments
      WHERE id=$1
      FOR UPDATE`,
    [tournamentId]
  );
  if (!tournament) return { error: "Tournament not found.", status: 404 };
  if (tournament.signup_state !== "open") {
    return { error: "Tournament signups are not open.", status: 409 };
  }
  if (isReservedName(displayName)) {
    return { error: "That name is reserved.", status: 400 };
  }

  const existing = await tx.one(
    `SELECT id, display_name, status, source, trust_score, alt_flag, alt_reason, created_at
       FROM tournament_entries
      WHERE tournament_id=$1 AND lower(display_name)=lower($2)
      FOR UPDATE`,
    [tournament.id, displayName]
  );
  if (existing?.status === "blocked") {
    return { error: "This name has been blocked from the tournament.", status: 409 };
  }
  if (existing && existing.status !== "removed") {
    return { entry: existing, duplicate: true };
  }

  const active = await tx.one(
    `SELECT count(*)::integer AS count
       FROM tournament_entries
      WHERE tournament_id=$1 AND status IN ('pending', 'confirmed', 'selected')`,
    [tournament.id]
  );
  const lockSignups = async () => {
    await tx.one(
      "UPDATE tournaments SET signup_state='locked', updated_at=now() WHERE id=$1 RETURNING id",
      [tournament.id]
    );
    await tx.one(
      "DELETE FROM tournament_open_signups WHERE tournament_id=$1 RETURNING site_id",
      [tournament.id]
    );
  };
  if (tournament.entry_cap && (active?.count || 0) >= tournament.entry_cap) {
    // A full tournament may never stay open; the FOR UPDATE row lock already
    // serialized this entrant behind the one that took the last slot.
    await lockSignups();
    return { error: "Tournament signups are full.", status: 409 };
  }
  const status = "pending";
  if (tournament.entry_cap && (active?.count || 0) + 1 >= tournament.entry_cap) {
    await lockSignups();
  }

  if (existing) {
    return {
      entry: await tx.one(
        `UPDATE tournament_entries
            SET display_name=$1, viewer_id=$2, source=$3, status=$4, trust_score=$5,
                alt_flag=$6, alt_reason=$7, updated_at=now()
          WHERE id=$8
          RETURNING id, tournament_id, display_name, viewer_id, source, status,
                    trust_score, alt_flag, alt_reason, team_no, created_at, updated_at`,
        [displayName, viewerId, source, status, trustScore, altFlag, altReason, existing.id]
      ),
      duplicate: false,
    };
  }
  return {
    entry: await tx.one(
      `INSERT INTO tournament_entries
         (tournament_id, display_name, viewer_id, source, status, trust_score, alt_flag, alt_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, tournament_id, display_name, viewer_id, source, status,
                 trust_score, alt_flag, alt_reason, team_no, created_at, updated_at`,
      [tournament.id, displayName, viewerId, source, status, trustScore, altFlag, altReason]
    ),
    duplicate: false,
  };
}

/**
 * Turn one Kick `chat.message.sent` payload into a tournament entry: route the
 * channel to a site through the verified binding (same rule as chat
 * giveaways), match the tournament's entry keyword, and add the sender under
 * the entry rules. Redelivered webhooks and repeated !join are idempotent.
 */
export async function ingestTournamentChatMessageTx(tx, payload) {
  const input = kickChatMessageToIngestInput(payload);
  const outcome = {
    routed: false, matched: false, entered: false, duplicate: false,
    rejected: null, tournamentId: null,
  };
  if (!input.externalChannelId) return outcome;
  // Route through the open-signups lock row: one site can hold at most one,
  // so a message can never pick among several open tournaments.
  const route = await tx.one(
    `SELECT t.id, t.entry_keyword
       FROM community_channels ch
       JOIN sites s ON s.id = ch.site_id
       JOIN creator_connections cc ON cc.id = ch.creator_connection_id
       JOIN tournament_open_signups l ON l.site_id = ch.site_id
       JOIN tournaments t ON t.id = l.tournament_id
      WHERE ch.provider = 'kick' AND ch.external_channel_id = $1
        AND ch.status = 'active' AND ch.verified_at IS NOT NULL
        AND cc.provider = ch.provider AND cc.user_id = s.user_id
        AND cc.status = 'active' AND cc.linked_at IS NOT NULL
        AND t.signup_state = 'open' AND t.status NOT IN ('completed','cancelled')
        AND lower(t.chat_channel) IN (lower(ch.external_channel_name), lower($2))`,
    [input.externalChannelId, String(payload.broadcaster?.channel_slug || "")]
  );
  if (!route) return outcome;
  outcome.routed = true;
  outcome.tournamentId = route.id;

  const keyword = String(route.entry_keyword || "").trim().toLowerCase();
  const firstToken = String(input.content || "").trim().split(/\s+/)[0]?.toLowerCase();
  if (!keyword || firstToken !== keyword) return outcome;
  outcome.matched = true;

  const result = await addTournamentEntryTx(tx, route.id, {
    displayName: input.senderUsername,
    viewerId: null,
    source: "chat",
    trustScore: null,
    altFlag: false,
    altReason: null,
  });
  if (result.error) outcome.rejected = result.error;
  else if (result.duplicate) outcome.duplicate = true;
  else outcome.entered = true;
  return outcome;
}

export async function ingestTournamentChatMessage(payload, { withTransaction = defaultWithTransaction } = {}) {
  return withTransaction((tx) => ingestTournamentChatMessageTx(tx, payload));
}

/**
 * POST /api/tournaments/:id/entries — Add one streamer-sourced entry.
 */
export async function handleAddTournamentEntry(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    one = defaultOne,
    withTransaction = defaultWithTransaction,
    logAudit = defaultLogAudit,
    requireSiteCapabilityImpl = requireSiteOwner,
  } = deps;
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const body = await readJson(request);
  const displayName = String(body?.displayName || "").trim().slice(0, 80);
  if (!displayName) return bad("displayName is required.");
  const source = ENTRY_SOURCES.has(body?.source) ? body.source : "manual";
  const trustScore = clampTrustScore(body?.trustScore);
  const altFlag = body?.altFlag === true;
  const altReason = altFlag ? String(body?.altReason || "Looks similar to another account.").trim().slice(0, 240) : null;
  const viewerId = body?.viewerId ? String(body.viewerId).trim() : null;

  const access = await getTournamentForMutation(request, user, one, requireSiteCapabilityImpl);
  if (access.error) return access.error;

  let result;
  try {
    result = await withTransaction(async (tx) => addTournamentEntryTx(tx, access.tournament.id, {
      displayName,
      viewerId,
      source,
      trustScore,
      altFlag,
      altReason,
    }));
  } catch (error) {
    if (error?.code === "23505") return bad("This name is already entered.", 409);
    throw error;
  }
  if (result.error) return bad(result.error, result.status);
  if (!result.duplicate) {
    await logAudit({
      actorId: user.id,
      action: "tournament_entry_add",
      entityType: "tournament_entry",
      entityId: result.entry.id,
      request,
      details: { tournamentId: access.tournament.id, source, altFlag, status: result.entry.status },
    });
  }
  return ok({ entry: result.entry, duplicate: result.duplicate });
}

async function updateTournamentEntryStatus(request, env, nextStatus, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    one = defaultOne,
    withTransaction = defaultWithTransaction,
    logAudit = defaultLogAudit,
    requireSiteCapabilityImpl = requireSiteOwner,
  } = deps;
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const access = await getTournamentForMutation(request, user, one, requireSiteCapabilityImpl);
  if (access.error) return access.error;
  const entryId = new URL(request.url).pathname.split("/")[5] || "";
  if (!entryId) return bad("entryId is required.");

  const result = await withTransaction(async (tx) => {
    const tournament = await tx.one(
      "SELECT id, signup_state, entry_cap FROM tournaments WHERE id=$1 FOR UPDATE",
      [access.tournament.id]
    );
    const existing = await tx.one(
      "SELECT id, status FROM tournament_entries WHERE id=$1 AND tournament_id=$2 FOR UPDATE",
      [entryId, access.tournament.id]
    );
    if (!tournament || !existing) return { error: "Entry not found.", status: 404 };
    if (!["removed", "blocked"].includes(nextStatus)) return { error: "Unsupported entry state.", status: 400 };

    const entry = await tx.one(
      `UPDATE tournament_entries
          SET status=$1, updated_at=now()
        WHERE id=$2
        RETURNING id, tournament_id, display_name, source, status, trust_score, alt_flag, alt_reason,
                  team_no, created_at, updated_at`,
      [nextStatus, entryId]
    );
    return { entry };
  });
  if (result.error) return bad(result.error, result.status);
  await logAudit({
    actorId: user.id,
    action: `tournament_entry_${nextStatus}`,
    entityType: "tournament_entry",
    entityId: result.entry.id,
    request,
    details: { tournamentId: access.tournament.id, status: nextStatus },
  });
  return ok({ entry: result.entry });
}

export function handleRemoveTournamentEntry(request, env, deps = {}) {
  return updateTournamentEntryStatus(request, env, "removed", deps);
}

export function handleBlockTournamentEntry(request, env, deps = {}) {
  return updateTournamentEntryStatus(request, env, "blocked", deps);
}

export async function handleRestoreTournamentEntry(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    one = defaultOne,
    withTransaction = defaultWithTransaction,
    logAudit = defaultLogAudit,
    requireSiteCapabilityImpl = requireSiteOwner,
  } = deps;
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const access = await getTournamentForMutation(request, user, one, requireSiteCapabilityImpl);
  if (access.error) return access.error;
  const entryId = new URL(request.url).pathname.split("/")[5] || "";
  const result = await withTransaction(async (tx) => {
    const tournament = await tx.one(
      "SELECT id, signup_state, entry_cap FROM tournaments WHERE id=$1 FOR UPDATE",
      [access.tournament.id]
    );
    const existing = await tx.one(
      "SELECT id, display_name, status FROM tournament_entries WHERE id=$1 AND tournament_id=$2 FOR UPDATE",
      [entryId, access.tournament.id]
    );
    if (!tournament || !existing) return { error: "Entry not found.", status: 404 };
    if (!["removed", "blocked"].includes(existing.status)) return { error: "Entry is already active.", status: 400 };
    const count = await tx.one(
      `SELECT count(*)::integer AS count FROM tournament_entries
        WHERE tournament_id=$1 AND status IN ('pending', 'confirmed', 'selected')`,
      [tournament.id]
    );
    if (tournament.entry_cap && (count?.count || 0) >= tournament.entry_cap) {
      return { error: "Signup limit reached. Raise the limit before restoring this entry.", status: 409 };
    }
    const status = "pending";
    const entry = await tx.one(
      `UPDATE tournament_entries SET status=$1, updated_at=now() WHERE id=$2
       RETURNING id, tournament_id, display_name, source, status, trust_score, alt_flag, alt_reason,
                 team_no, created_at, updated_at`,
      [status, entryId]
    );
    return { entry };
  });
  if (result.error) return bad(result.error, result.status);
  await logAudit({
    actorId: user.id,
    action: "tournament_entry_restore",
    entityType: "tournament_entry",
    entityId: result.entry.id,
    request,
    details: { tournamentId: access.tournament.id, status: result.entry.status },
  });
  return ok({ entry: result.entry });
}

/**
 * POST /api/tournaments/:id/entries/select — Pick the bracket participants
 * (random fill or an explicit entry-id list) and seed the bracket.
 */
export async function handleSelectTournamentEntries(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    one = defaultOne,
    withTransaction = defaultWithTransaction,
    logAudit = defaultLogAudit,
    requireSiteCapabilityImpl = requireSiteOwner,
  } = deps;
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const body = await readJson(request);
  const mode = body?.mode;
  if (mode !== "random" && mode !== "manual") {
    return bad("Unsupported selection mode.", 400);
  }
  const access = await getTournamentForMutation(request, user, one, requireSiteCapabilityImpl);
  if (access.error) return access.error;

  const result = await withTransaction(async (tx) => {
    const tournament = await tx.one(
      "SELECT id, bracket_size, format, status, signup_state, entry_fee FROM tournaments WHERE id=$1 FOR UPDATE",
      [access.tournament.id]
    );
    if (tournament.status === "completed" || tournament.status === "cancelled") {
      return { error: "Tournament is already finished.", status: 409 };
    }
    if (tournament.signup_state !== "locked") {
      return { error: "Lock signups before creating the bracket.", status: 409 };
    }
    const existing = await tx.one(
      "SELECT count(*)::integer AS count FROM tournament_matches WHERE tournament_id=$1",
      [tournament.id]
    );
    if ((existing?.count || 0) > 0) {
      return { error: "Bracket already exists.", status: 409 };
    }
    const flagOnlyWhenFree = Number(tournament.entry_fee) === 0;
    const eligible = await tx.query(
      `SELECT id, tournament_id, display_name, source, status, trust_score, alt_flag, alt_reason,
              team_no, created_at, updated_at
         FROM tournament_entries
        WHERE tournament_id=$1 AND ${ELIGIBLE_ENTRY_PREDICATE}
        FOR UPDATE`,
      [access.tournament.id, flagOnlyWhenFree]
    );
    const eligibleCount = (eligible || []).length;
    if (eligibleCount < MIN_BRACKET_PARTICIPANTS) {
      return { error: `Need at least ${MIN_BRACKET_PARTICIPANTS} eligible players to start.`, status: 409 };
    }
    if (mode === "manual" && eligibleCount <= tournament.bracket_size) {
      return { error: "All eligible players fit the bracket; use random selection.", status: 400 };
    }

    let picked;
    if (mode === "manual") {
      const entryIds = Array.isArray(body?.entryIds) ? body.entryIds : null;
      if (!entryIds || !entryIds.length || !entryIds.every((id) => typeof id === "string")) {
        return { error: "entryIds must be a non-empty array of entry IDs.", status: 400 };
      }
      if (new Set(entryIds).size !== entryIds.length) {
        return { error: "Duplicate entry IDs.", status: 400 };
      }
      if (entryIds.length !== tournament.bracket_size) {
        return { error: `Select exactly ${tournament.bracket_size} participants.`, status: 400 };
      }
      const eligibleIds = new Set(eligible.map((entry) => entry.id));
      if (!entryIds.every((id) => eligibleIds.has(id))) {
        return { error: "One or more selected entries are not eligible.", status: 400 };
      }
      picked = eligible.filter((entry) => eligibleIds.has(entry.id) && entryIds.includes(entry.id));
    } else {
      const count = Math.min(eligibleCount, tournament.bracket_size);
      picked = shuffle(eligible).slice(0, count);
    }

    const ids = picked.map((entry) => entry.id);
    const selected = await tx.query(
      `UPDATE tournament_entries
          SET status='selected', updated_at=now()
        WHERE id = ANY($1::uuid[])
        RETURNING id, tournament_id, display_name, source, status, trust_score, alt_flag, alt_reason,
                  team_no, created_at, updated_at`,
      [ids]
    );

    const selectedNames = shuffle((selected || []).map((entry) => entry.display_name));
    if (selectedNames.length !== picked.length) {
      return { error: "Could not select the requested entries.", status: 400 };
    }
    await tx.unsafe(
      "UPDATE tournaments SET participants_json=$1, status='active', updated_at=now() WHERE id=$2",
      [selectedNames, tournament.id]
    );
    await seedTournamentMatches(tx, tournament.id, selectedNames, tournament.bracket_size);

    return { entries: selected || [], count: picked.length };
  });
  if (result.error) return bad(result.error, result.status);
  await logAudit({
    actorId: user.id,
    action: "tournament_entries_select",
    entityType: "tournament",
    entityId: access.tournament.id,
    request,
    details: { mode, count: result.count },
  });
  return ok({ entries: result.entries });
}

/**
 * POST /api/tournaments/:id/score — Streamer updates match score & advances winner
 */
export async function handleUpdateMatchScore(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    withTransaction = defaultWithTransaction,
    logAudit = defaultLogAudit,
    requireSiteCapabilityImpl = requireSiteOwner,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const body = await readJson(request) || {};
  const matchId = String(body?.matchId || "").trim();
  if (!matchId) return bad("matchId is required.");

  const rawP1 = Number(body?.player1Score);
  const rawP2 = Number(body?.player2Score);
  if (!Number.isInteger(rawP1) || !Number.isInteger(rawP2) || rawP1 < 0 || rawP2 < 0) {
    return bad("Scores must be non-negative integers.");
  }
  if (rawP1 === rawP2) return bad("Scores cannot be tied. A winner must be decided.");

  const tournamentId = tournamentIdFromRequest(request);
  if (!tournamentId) return bad("tournamentId is required.");

  let result;
  try {
    result = await withTransaction(async (tx) => {
      const match = await tx.one(
        `SELECT tm.id, tm.round_number, tm.match_index, tm.player1_name, tm.player2_name, tm.status,
                t.id AS tournament_id, t.status AS tournament_status, t.bracket_size, t.site_id, s.user_id AS site_user_id
           FROM tournament_matches tm
           JOIN tournaments t ON t.id = tm.tournament_id
           JOIN sites s ON s.id = t.site_id
          WHERE tm.tournament_id=$1 AND tm.id=$2
          FOR UPDATE OF tm, t`,
        [tournamentId, matchId]
      );
      if (!match) return { error: "Match not found or unauthorized.", status: 404 };

      const authorization = await requireSiteCapabilityImpl(
        user,
        { id: match.site_id, user_id: match.site_user_id }
      );
      if (authorization.res) return { error: "Forbidden", status: authorization.res.status || 403 };
      {
        const gateRes = await requireSiteFeature({ user_id: match.site_user_id }, "tournaments", { request, oneImpl: tx.one });
        if (gateRes) return { error: "Tournaments are not available on this site's plan.", status: 403 };
      }

      if (match.tournament_status === "completed" || match.tournament_status === "cancelled") {
        return { error: "Tournament is already finished.", status: 409 };
      }
      if (match.status === "completed") {
        return { error: "Match has already been scored.", status: 409 };
      }
      if (!match.player1_name || !match.player2_name
          || match.player1_name === "TBD" || match.player2_name === "TBD"
          || isBye(match.player1_name) || isBye(match.player2_name)) {
        return { error: "Match is not ready to score.", status: 400 };
      }

      const totalRounds = Math.log2(match.bracket_size || 0);
      if (!Number.isFinite(totalRounds) || totalRounds < 1) {
        return { error: "Invalid bracket size.", status: 400 };
      }
      const isFinals = match.round_number === totalRounds;
      const winnerName = rawP1 > rawP2 ? match.player1_name : match.player2_name;

      // Lock and validate downstream state before mutating the current match.
      if (!isFinals) {
        const nextRound = match.round_number + 1;
        const nextMatchIndex = Math.floor(match.match_index / 2);
        const isPlayer1Slot = match.match_index % 2 === 0;
        const slotColumn = isPlayer1Slot ? "player1_name" : "player2_name";

        const nextMatch = await tx.one(
          `SELECT ${slotColumn}, status FROM tournament_matches
            WHERE tournament_id=$1 AND round_number=$2 AND match_index=$3
            FOR UPDATE`,
          [match.tournament_id, nextRound, nextMatchIndex]
        );
        if (!nextMatch) return { error: "Downstream match not found.", status: 400 };
        if (nextMatch.status === "completed") {
          return { error: "Downstream match has already progressed.", status: 409 };
        }
        const slotValue = nextMatch[slotColumn];
        if (slotValue && slotValue !== "" && slotValue !== "TBD") {
          return { error: "Downstream match has already progressed.", status: 409 };
        }

        const matchUpdate = await tx.unsafe(
          `UPDATE tournament_matches
              SET player1_score=$1, player2_score=$2, winner_name=$3, status='completed'
            WHERE id=$4 AND status != 'completed'
            RETURNING id`,
          [rawP1, rawP2, winnerName, match.id]
        );
        if (!matchUpdate || matchUpdate.length === 0) {
          return { error: "Match could not be scored. It may have already been completed.", status: 409 };
        }

        const nextUpdate = await tx.unsafe(
          `UPDATE tournament_matches
              SET ${slotColumn}=$1
            WHERE tournament_id=$2 AND round_number=$3 AND match_index=$4
              AND (${slotColumn} IS NULL OR ${slotColumn} = '' OR ${slotColumn} = 'TBD')
            RETURNING ${slotColumn}`,
          [winnerName, match.tournament_id, nextRound, nextMatchIndex]
        );
        if (!nextUpdate || nextUpdate.length === 0) {
          throw new TournamentConflictError("Downstream match has already progressed or is conflicting.", 409);
        }
        // The winner may now face a BYE downstream; that pair auto-advances
        // (and can cascade through an undersubscribed bracket).
        await resolveByeMatchesTx(tx, match.tournament_id, match.bracket_size);
      } else {
        const matchUpdate = await tx.unsafe(
          `UPDATE tournament_matches
              SET player1_score=$1, player2_score=$2, winner_name=$3, status='completed'
            WHERE id=$4 AND status != 'completed'
            RETURNING id`,
          [rawP1, rawP2, winnerName, match.id]
        );
        if (!matchUpdate || matchUpdate.length === 0) {
          return { error: "Match could not be scored. It may have already been completed.", status: 409 };
        }

        const tournUpdate = await tx.unsafe(
          `UPDATE tournaments
              SET winner_name=$1, status='completed', updated_at=now()
            WHERE id=$2 AND status NOT IN ('completed', 'cancelled')
            RETURNING id`,
          [winnerName, match.tournament_id]
        );
        if (!tournUpdate || tournUpdate.length === 0) {
          throw new TournamentConflictError("Tournament already has a champion.", 409);
        }
        // A completed tournament can never hold open signups again.
        await tx.unsafe("DELETE FROM tournament_open_signups WHERE tournament_id=$1", [match.tournament_id]);
      }

      return { matchId: match.id, winnerName, isFinals, roundNumber: match.round_number };
    });
  } catch (err) {
    if (err instanceof TournamentConflictError) return bad(err.message, err.status);
    throw err;
  }
  if (result.error) return bad(result.error, result.status);

  await logAudit({
    actorId: user.id,
    action: "tournament_match_score",
    entityType: "tournament_match",
    entityId: result.matchId,
    request,
    details: { winnerName: result.winnerName, p1Score: rawP1, p2Score: rawP2, isFinals: result.isFinals },
  });

  return ok({
    matchId: result.matchId,
    winnerName: result.winnerName,
    isFinals: result.isFinals,
    message: result.isFinals
      ? `👑 Champion crowned: ${result.winnerName}!`
      : `🏆 ${result.winnerName} advanced to Round ${result.roundNumber + 1}!`,
  });
}

/**
 * GET /api/tournaments/:id/bracket — Get bracket tree for viewer & streamer
 */
export async function handleGetBracket(request, env, deps = {}) {
  const {
    one = defaultOne,
    query = defaultQuery,
    rateLimit = defaultRateLimit,
    clientIp = defaultClientIp,
  } = deps;
  const rl = await rateLimit(env, `tournament-bracket:${clientIp(request)}`, TOURNAMENT_READ_RATE_LIMIT, 60);
  if (!rl.ok) return bad("Rate limit exceeded. Try again shortly.", 429);

  const url = new URL(request.url);
  const tournamentId = url.pathname.split("/")[3] || url.searchParams.get("id");
  if (!tournamentId) return bad("tournamentId is required.");

  const tourn = await one("SELECT id, title, game_name, bracket_size, status, winner_name, created_at FROM tournaments WHERE id=$1", [tournamentId]);
  if (!tourn) return bad("Tournament not found.", 404);

  const matches = await query(
    `SELECT id, round_number, match_index, player1_name, player2_name, player1_score, player2_score, winner_name, status
       FROM tournament_matches
      WHERE tournament_id=$1
      ORDER BY round_number ASC, match_index ASC`,
    [tourn.id]
  );

  return ok({
    tournament: tourn,
    matches: matches || [],
  });
}
