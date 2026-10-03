// Tournament & Elimination Brackets Handlers.
import {
  requireUser as defaultRequireUser,
  ok,
  bad,
  json,
  readJson,
  rateLimit as defaultRateLimit,
  clientIp as defaultClientIp,
  requireSiteFeature,
} from "../auth.js";
import { getByUser as defaultGetByUser, getBoardById as defaultGetBoardById, getPublicSite as defaultGetPublicSite } from "../site.js";
import { routeContext } from "../middleware/handler.js";
import { requireSiteOwner } from "../site-authorization.js";
import { canUseFeature, effectivePlan } from "@yourrank/shared/plans";
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
import {
  ROUTABLE_CHANNEL_AUTHORIZATION_JOINS_SQL,
  ROUTABLE_CHANNEL_CONDITION_SQL,
} from "@yourrank/shared/provider-connections";
import { buildBracket, canCorrectMatch, resolveByes, isBye, BYE, MIN_BRACKET_PARTICIPANTS } from "../lib/tournament-bracket.js";
import {
  entryViews,
  LIFECYCLE_LABELS,
  tournamentLifecycle,
  tournamentViewState,
} from "../lib/tournament-state.js";
import { publicTournamentView } from "../lib/tournament-public.js";
import { championAnnouncementText, sendTournamentChatMessage } from "../lib/tournament-chat.js";

const TOURNAMENT_READ_RATE_LIMIT = 60;
const ENTRY_SOURCES = new Set(["chat", "page", "manual", "leaderboard"]);
const SUPPORTED_BRACKET_SIZES = [4, 8, 16, 32];
const CREATABLE_FORMATS = ["bracket", "1v1"];

// One champion message per tournament per minute, so an undo-and-resave of the
// final cannot repeat it back to back.
export async function announceTournamentChampion(env, announcement, {
  rateLimit = defaultRateLimit,
  send = sendTournamentChatMessage,
} = {}) {
  const rl = await rateLimit(env, `tournament-champion-announce:${announcement.tournamentId}`, 1, 60);
  if (!rl.ok) return false;
  return send(env, {
    tournamentId: announcement.tournamentId,
    siteId: announcement.siteId,
    content: championAnnouncementText(announcement),
  });
}

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

// "bracket"/empty means "cap at the bracket size"; null/"unlimited" removes
// the cap; anything else parses to an integer clamped to >= 1.
function parseEntryCap(value, bracketSize) {
  if (value === undefined || value === "" || value === "bracket") return bracketSize;
  if (value === null || value === "unlimited") return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(1, n) : 1;
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
    one = defaultOne,
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
  const owner = await one(
    "SELECT plan, plan_expires_at, status FROM users WHERE id=$1",
    [site.user_id],
  );

  const tournaments = await query(
    `SELECT id, title, game_name, bracket_size, status, winner_name, created_at,
            signup_state, entry_cap, format, anti_alt_enabled, require_login,
            min_credits, entry_fee, entry_keyword, chat_channel, waitlist_enabled,
            (SELECT count(*) FROM tournament_entries
              WHERE tournament_id=tournaments.id AND status IN ('pending','confirmed','selected'))::integer AS participant_count,
            (SELECT count(*) FROM tournament_entries
              WHERE tournament_id=tournaments.id AND status='selected')::integer AS selected_count,
            (SELECT count(*) FROM tournament_matches
              WHERE tournament_id=tournaments.id)::integer AS match_count
       FROM tournaments
      WHERE site_id=$1
      ORDER BY created_at DESC`,
    [site.id]
  );
  const listed = (tournaments || []).map((tournament) => {
    const lifecycle = tournamentLifecycle(tournament, tournament.match_count);
    return { ...tournament, lifecycle, status_label: LIFECYCLE_LABELS[lifecycle] };
  });
  const current = listed.find((tournament) => !["completed", "cancelled"].includes(tournament.status))
    || listed[0]
    || null;

  return ok({
    tournaments: listed,
    current_id: current?.id || null,
    chatRegistration: await loadChatGiveawayConnection(query, site.id, "kick"),
    entitlement: {
      enabled: canUseFeature(effectivePlan(owner), "tournaments"),
    },
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
    query = defaultQuery,
    loadChatGiveawayConnection = defaultLoadChatGiveawayConnection,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const body = await readJson(request);
  const title = String(body?.title || "").trim();
  if (!title) return bad("Enter a tournament name.");
  const gameName = String(body?.gameName || "").trim();
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
  const entryCap = parseEntryCap(body?.entryCap, requestedBracketSize);
  const antiAltEnabled = body?.antiAltEnabled === true;
  const requireLogin = body?.requireLogin === true;
  const minCredits = Math.max(0, parseInt(body?.minCredits, 10) || 0);
  const entryFee = Math.max(0, parseInt(body?.entryFee, 10) || 0);
  const entryKeyword = String(body?.entryKeyword || "!join").trim().slice(0, 40) || "!join";
  let chatChannel = normalizeChatChannel(body?.chatChannel) || null;

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
  const connection = await loadChatGiveawayConnection(query, site.id, "kick");
  if (connection.connected) {
    if (!chatChannel) {
      chatChannel = normalizeChatChannel(connection.channelName) || null;
    } else if (chatChannel.toLowerCase() !== String(connection.channelName || "").toLowerCase()) {
      return json({
        ok: false,
        error: `Use your connected Kick channel (${connection.channelName}). Signups are collected from that channel.`,
        field: "chatChannel",
      }, 400);
    }
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
              chat_channel, waitlist_enabled, created_at`,
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
  return ok({
    tournament: result.tournament,
    message: state === "open"
      ? `Chat signups on — viewers can type ${result.tournament.entry_keyword || "!join"} in chat.`
      : "Chat signups off — viewers can no longer join from chat.",
  });
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
    query = defaultQuery,
    loadChatGiveawayConnection = defaultLoadChatGiveawayConnection,
    withTransaction = defaultWithTransaction,
    logAudit = defaultLogAudit,
    requireSiteCapabilityImpl = requireSiteOwner,
  } = deps;
  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const access = await getTournamentForMutation(request, user, one, requireSiteCapabilityImpl);
  if (access.error) return access.error;
  const body = await readJson(request) || {};
  if (Object.prototype.hasOwnProperty.call(body, "title") && !String(body.title || "").trim()) {
    return json({ ok: false, error: "Enter a tournament name.", field: "title" }, 400);
  }
  if (Object.prototype.hasOwnProperty.call(body, "chatChannel")
      && String(body.chatChannel || "").trim()) {
    const connection = await loadChatGiveawayConnection(query, access.tournament.site_id, "kick");
    const normalized = normalizeChatChannel(body.chatChannel);
    if (connection.connected
        && normalized.toLowerCase() !== String(connection.channelName || "").toLowerCase()) {
      return json({
        ok: false,
        error: `Use your connected Kick channel (${connection.channelName}). Signups are collected from that channel.`,
        field: "chatChannel",
      }, 400);
    }
  }
  const updates = [];
  const values = [];
  const addUpdate = (column, value) => {
    updates.push(`${column}=$${values.length + 1}`);
    values.push(value);
  };
  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    addUpdate("title", String(body.title).trim());
  }
  if (Object.prototype.hasOwnProperty.call(body, "gameName")) {
    addUpdate("game_name", String(body.gameName || "").trim());
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
  const nextBracketSize = wantsBracketSize && isSupportedBracketSize(parseInt(body.bracketSize, 10))
    ? parseInt(body.bracketSize, 10)
    : access.tournament.bracket_size;
  const wantsEntryCap = Object.prototype.hasOwnProperty.call(body, "entryCap");
  // entryCapUpdate records the cap actually being written (undefined = untouched),
  // whether it came from the body or followed a bracket-size change.
  let entryCapUpdate;
  if (wantsEntryCap) {
    entryCapUpdate = parseEntryCap(body.entryCap, nextBracketSize);
    addUpdate("entry_cap", entryCapUpdate);
  } else if (nextBracketSize !== access.tournament.bracket_size
      && access.tournament.entry_cap === access.tournament.bracket_size) {
    // A cap equal to the old bracket size was "same as bracket", so it follows.
    entryCapUpdate = nextBracketSize;
    addUpdate("entry_cap", entryCapUpdate);
  }
  const wantsWaitlist = Object.prototype.hasOwnProperty.call(body, "waitlistEnabled");
  if (wantsWaitlist) {
    addUpdate("waitlist_enabled", body.waitlistEnabled === true);
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
                     chat_channel, waitlist_enabled`;
  let tournament = access.tournament;
  let promoted = [];
  if (updates.length) {
    // The cap is checked and applied under the tournament row lock so a
    // concurrent signup can never land between the count and the update.
    const outcome = await withTransaction(async (tx) => {
      await tx.one("SELECT id FROM tournaments WHERE id=$1 FOR UPDATE", [access.tournament.id]);
      const active = await tx.one(
        `SELECT count(*)::integer AS count FROM tournament_entries
          WHERE tournament_id=$1 AND status IN ('pending', 'confirmed', 'selected')`,
        [access.tournament.id]
      );
      if (entryCapUpdate !== undefined && entryCapUpdate !== null
          && entryCapUpdate < (active?.count || 0)) {
        const activeCount = active?.count || 0;
        const bracketSizeChanged = wantsBracketSize && nextBracketSize !== access.tournament.bracket_size;
        const followsBracket = !wantsEntryCap || body.entryCap === "bracket";
        if (bracketSizeChanged && followsBracket) {
          const oldCap = access.tournament.entry_cap;
          const fix = oldCap != null && oldCap >= activeCount
            ? { label: `Keep signup limit at ${oldCap}`, settings: { entryCap: oldCap } }
            : { label: "Set signup limit to Unlimited", settings: { entryCap: "unlimited" } };
          return {
            error: `${activeCount} players are already registered — more than a ${nextBracketSize}-player signup limit. Keep the current signup limit; you'll choose who plays when you start.`,
            field: "bracketSize",
            fix,
            status: 400,
          };
        }
        return {
          error: `Signup limit cannot be lower than the current ${activeCount} registrations.`,
          field: "entryCap",
          fix: {
            label: `Set signup limit to ${activeCount}`,
            settings: { entryCap: activeCount },
          },
          status: 400,
        };
      }
      const txValues = [...values, access.tournament.id];
      const updated = await tx.one(
        `UPDATE tournaments
            SET ${updates.join(", ")}, updated_at=now()
          WHERE id=$${txValues.length}
          RETURNING ${returning}`,
        txValues
      );
      const filled = entryCapUpdate !== undefined || wantsWaitlist
        ? await promoteWaitlistTx(tx, access.tournament.id, { actorUserId: user.id })
        : { promoted: [] };
      return { tournament: updated, promoted: filled.promoted };
    });
    if (outcome.error) {
      return json({
        ok: false,
        error: outcome.error,
        field: outcome.field,
        fix: outcome.fix,
      }, outcome.status);
    }
    tournament = outcome.tournament;
    promoted = outcome.promoted;
    await logAudit({
      actorId: user.id,
      action: "tournament_settings_update",
      entityType: "tournament",
      entityId: access.tournament.id,
      request,
      details: { fields: updates.map((update) => update.split("=")[0]) },
    });
  }
  return ok({
    tournament,
    promoted,
    ...(Object.prototype.hasOwnProperty.call(body, "antiAltEnabled")
      ? { message: tournament.anti_alt_enabled ? "Duplicate protection on." : "Duplicate protection off." }
      : {}),
  });
}

export async function handleDeleteTournament(request, env, deps = {}) {
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
  const confirmedTitle = String(body.confirmTitle || "").trim();
  const title = String(access.tournament.title || "").trim();
  if (confirmedTitle !== title) return bad("Type the tournament name exactly to delete it.");

  const result = await withTransaction(async (tx) => {
    const tournament = await tx.one(
      "SELECT id, title, status FROM tournaments WHERE id=$1 FOR UPDATE",
      [access.tournament.id]
    );
    if (!tournament) return { error: "Tournament not found.", status: 404 };
    const lockedTitle = String(tournament.title || "").trim();
    if (confirmedTitle !== lockedTitle) {
      return { error: "Type the tournament name exactly to delete it.", status: 400 };
    }
    const counts = await tx.one(
      `SELECT (SELECT count(*)::integer FROM tournament_entries WHERE tournament_id=$1) AS entries,
              (SELECT count(*)::integer FROM tournament_matches WHERE tournament_id=$1) AS matches`,
      [tournament.id]
    );
    await tx.one("DELETE FROM tournament_open_signups WHERE tournament_id=$1", [tournament.id]);
    await tx.one("DELETE FROM tournaments WHERE id=$1", [tournament.id]);
    return {
      id: tournament.id,
      title: lockedTitle,
      lifecycle: tournamentLifecycle({ ...access.tournament, ...tournament }, counts?.matches || 0),
      entries: counts?.entries || 0,
      matches: counts?.matches || 0,
    };
  });
  if (result.error) return bad(result.error, result.status);
  await logAudit({
    actorId: user.id,
    action: "tournament_delete",
    entityType: "tournament",
    entityId: result.id,
    request,
    details: {
      title: result.title,
      lifecycle: result.lifecycle,
      entries: result.entries,
      matches: result.matches,
    },
  });
  return ok({ deleted: result.id, message: `Deleted “${result.title}”.` });
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
  // Eligibility is server-authoritative: the same predicate the select
  // endpoint uses is computed per row and in the counts, so the dashboard
  // never approximates the rule client-side. $2 = flag-only-when-free.
  const flagOnlyWhenFree = Number(tournament.entry_fee) === 0;
  const entries = await query(
    `SELECT id, display_name, viewer_id, source, status, trust_score, alt_flag, alt_reason,
            team_no, created_at, updated_at, (${ELIGIBLE_ENTRY_PREDICATE}) AS eligible
       FROM tournament_entries
      WHERE tournament_id=$1
      ORDER BY CASE WHEN $3::boolean AND alt_flag THEN 0 ELSE 1 END,
               created_at ASC`,
    [tournamentId, flagOnlyWhenFree, tournament.anti_alt_enabled === true]
  );
  const counts = await one(
    `SELECT count(*) FILTER (WHERE status IN ('pending', 'confirmed', 'selected'))::integer AS active,
            count(*) FILTER (WHERE ${ELIGIBLE_ENTRY_PREDICATE})::integer AS eligible,
            count(*) FILTER (WHERE status='waitlist')::integer AS waitlist,
            count(*) FILTER (WHERE status='removed')::integer AS removed,
            count(*) FILTER (WHERE status='blocked')::integer AS blocked
       FROM tournament_entries
      WHERE tournament_id=$1`,
      [tournamentId, flagOnlyWhenFree]
  );
  const matches = await query(
    `SELECT player1_name, player2_name, winner_name, status
       FROM tournament_matches
      WHERE tournament_id=$1`,
    [tournamentId]
  );

  // Linked-account overlays: when two active entries resolve to viewers linked
  // by account_links, both rows carry `linked_to`/`linked_reasons` so the UI
  // can flag them without exposing viewer ids, IPs, or device hashes.
  const activeEntries = (entries || []).filter((entry) =>
    ["pending", "confirmed", "selected"].includes(entry.status) && entry.viewer_id);
  const viewerIds = [...new Set(activeEntries.map((entry) => entry.viewer_id))];
  const linkRows = viewerIds.length ? await query(
    `SELECT al.viewer_a, al.viewer_b, al.reasons
       FROM account_links al
      WHERE al.site_id = $1
        AND al.status IN ('pending','watching','restricted')
        AND (al.viewer_a = ANY($2::uuid[]) OR al.viewer_b = ANY($2::uuid[]))`,
    [tournament.site_id, viewerIds]
  ) : [];
  const byViewer = new Map();
  for (const entry of activeEntries) {
    if (!byViewer.has(entry.viewer_id)) byViewer.set(entry.viewer_id, []);
    byViewer.get(entry.viewer_id).push(entry);
  }
  for (const link of linkRows || []) {
    for (const [viewerId, otherViewerId] of [[link.viewer_a, link.viewer_b], [link.viewer_b, link.viewer_a]]) {
      const partner = (byViewer.get(otherViewerId) || [])[0];
      if (!partner) continue;
      for (const entry of byViewer.get(viewerId) || []) {
        entry.linked_to = partner.display_name;
        entry.linked_reasons = link.reasons || [];
      }
    }
  }
  for (const entry of entries || []) {
    entry.flagged = tournament.anti_alt_enabled === true && (!!entry.alt_flag || !!entry.linked_to);
  }
  const entryCounts = {
    active: counts?.active || 0,
    eligible: counts?.eligible || 0,
    waitlist: counts?.waitlist || 0,
    removed: counts?.removed || 0,
    blocked: counts?.blocked || 0,
    inactive: (counts?.removed || 0) + (counts?.blocked || 0),
  };
  const state = tournamentViewState({
    tournament,
    counts: entryCounts,
    matchCount: matches?.length || 0,
  });
  const viewedEntries = entryViews(entries || [], {
    tournament,
    matches: matches || [],
    lifecycle: state.lifecycle,
  });
  return ok({ tournament, entries: viewedEntries, counts: entryCounts, state });
}

/**
 * Insert (or reactivate) one entry under the tournament's row lock. The
 * dashboard may add entries before signups open, but chat remains open-only.
 */
export async function addTournamentEntryTx(tx, tournamentId, {
  displayName,
  viewerId,
  source,
  trustScore,
  altFlag,
  altReason,
  allowClosedSignups = false,
}) {
  const tournament = await tx.one(
    `SELECT id, signup_state, entry_cap, status, waitlist_enabled
       FROM tournaments
      WHERE id=$1
      FOR UPDATE`,
    [tournamentId]
  );
  if (!tournament) return { error: "Tournament not found.", status: 404 };
  if (["completed", "cancelled"].includes(tournament.status)) {
    return { error: "Tournament is already finished.", status: 409 };
  }
  if (allowClosedSignups) {
    if (!["closed", "open", "locked"].includes(tournament.signup_state)) {
      return { error: "Tournament signups are not open.", status: 409 };
    }
    const matches = await tx.one(
      "SELECT count(*)::integer AS count FROM tournament_matches WHERE tournament_id=$1",
      [tournament.id]
    );
    if ((matches?.count || 0) > 0) return { error: "The bracket already exists.", status: 409 };
  } else if (tournament.signup_state !== "open") {
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
  const full = tournament.entry_cap && (active?.count || 0) >= tournament.entry_cap;
  // Full is a derived state: signups stay open so chat keeps routing and can
  // answer with the full/waitlist reply. With a waitlist, overflow entrants
  // queue instead of being rejected.
  const status = full && tournament.waitlist_enabled === true ? "waitlist" : "pending";
  if (full && status === "pending") {
    return { error: "Signups are full.", status: 409, full: true };
  }

  let waitlistPosition;
  if (status === "waitlist") {
    const ahead = await tx.one(
      "SELECT count(*)::integer AS count FROM tournament_entries WHERE tournament_id=$1 AND status='waitlist'",
      [tournament.id]
    );
    waitlistPosition = (ahead?.count || 0) + 1;
  }

  const waitlistResult = status === "waitlist"
    ? { waitlisted: true, waitlistPosition }
    : {};

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
      ...waitlistResult,
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
    ...waitlistResult,
  };
}

/**
 * Fill freed spots from the waitlist, oldest first. Runs inside the caller's
 * transaction under the tournament row lock; a tournament with a bracket or a
 * terminal status never promotes.
 */
export async function promoteWaitlistTx(tx, tournamentId, { actorUserId = null } = {}) {
  const tournament = await tx.one(
    "SELECT id, status, entry_cap FROM tournaments WHERE id=$1 FOR UPDATE",
    [tournamentId]
  );
  const promoted = [];
  if (!tournament || ["completed", "cancelled"].includes(tournament.status)) {
    return { promoted };
  }
  const bracket = await tx.one(
    "SELECT count(*)::integer AS count FROM tournament_matches WHERE tournament_id=$1",
    [tournamentId]
  );
  if ((bracket?.count || 0) > 0) return { promoted };

  for (;;) {
    if (tournament.entry_cap !== null && tournament.entry_cap !== undefined) {
      const active = await tx.one(
        `SELECT count(*)::integer AS count FROM tournament_entries
          WHERE tournament_id=$1 AND status IN ('pending', 'confirmed', 'selected')`,
        [tournamentId]
      );
      if ((active?.count || 0) >= tournament.entry_cap) break;
    }
    const next = await tx.one(
      `SELECT id FROM tournament_entries
        WHERE tournament_id=$1 AND status='waitlist'
        ORDER BY created_at ASC, id ASC
        LIMIT 1
        FOR UPDATE`,
      [tournamentId]
    );
    if (!next) break;
    await tx.one(
      "UPDATE tournament_entries SET status='pending', updated_at=now() WHERE id=$1 RETURNING id",
      [next.id]
    );
    await tx.unsafe(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details)
       VALUES ($1, 'tournament_entry_promoted', 'tournament_entry', $2, $3::jsonb)`,
      [actorUserId, next.id, { tournamentId }]
    );
    promoted.push(next.id);
  }
  return { promoted };
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
    `SELECT t.id, t.title, t.entry_keyword, l.site_id,
            ch.external_channel_id AS broadcaster_user_id
       FROM community_channels ch
       JOIN sites s ON s.id = ch.site_id${ROUTABLE_CHANNEL_AUTHORIZATION_JOINS_SQL}
       JOIN tournament_open_signups l ON l.site_id = ch.site_id
       JOIN tournaments t ON t.id = l.tournament_id
      WHERE ch.provider = 'kick' AND ch.external_channel_id = $1
        AND ${ROUTABLE_CHANNEL_CONDITION_SQL}
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

  outcome.senderUsername = input.senderUsername;
  outcome.messageId = payload?.message_id ? String(payload.message_id) : null;
  outcome.siteId = route.site_id;
  outcome.broadcasterUserId = route.broadcaster_user_id;
  if (route.title) outcome.tournamentTitle = String(route.title);

  // The entry can carry the sender's YourRank viewer when this site has one
  // linked to that Kick identity.
  const viewer = input.senderUserId
    ? await tx.one(
        `SELECT sv.viewer_id
           FROM viewer_identities vi
           JOIN site_viewers sv ON sv.viewer_id = vi.viewer_id
          WHERE vi.provider = 'kick' AND vi.external_user_id = $1
            AND vi.status = 'active' AND sv.site_id = $2
          LIMIT 1`,
        [input.senderUserId, route.site_id]
      )
    : null;

  const result = await addTournamentEntryTx(tx, route.id, {
    displayName: input.senderUsername,
    viewerId: viewer?.viewer_id || null,
    source: "chat",
    trustScore: null,
    altFlag: false,
    altReason: null,
  });
  if (result.error) {
    outcome.rejected = result.error;
    if (result.full) outcome.full = true;
  } else if (result.duplicate) outcome.duplicate = true;
  else {
    outcome.entered = true;
    if (result.waitlisted) {
      outcome.waitlisted = true;
      outcome.waitlistPosition = result.waitlistPosition;
    }
  }
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
      allowClosedSignups: true,
    }));
  } catch (error) {
    if (error?.code === "23505") return bad(`${displayName} is already entered.`, 409);
    throw error;
  }
  if (result.error) {
    return json({ ok: false, error: result.error, ...(result.full ? { full: true } : {}) }, result.status);
  }
  if (result.duplicate) return bad(`${displayName} is already entered.`, 409);
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
  return ok({
    entry: result.entry,
    duplicate: result.duplicate,
    ...(result.waitlisted ? { waitlisted: true, waitlistPosition: result.waitlistPosition } : {}),
  });
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
    const filled = await promoteWaitlistTx(tx, access.tournament.id, { actorUserId: user.id });
    return { entry, promoted: filled.promoted };
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
  return ok({ entry: result.entry, promoted: result.promoted });
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
      "SELECT id, signup_state, entry_cap, waitlist_enabled FROM tournaments WHERE id=$1 FOR UPDATE",
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
    const full = tournament.entry_cap && (count?.count || 0) >= tournament.entry_cap;
    if (full && tournament.waitlist_enabled !== true) {
      return { error: "Signup limit reached. Raise the limit before restoring this entry.", status: 409 };
    }
    const status = full ? "waitlist" : "pending";
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
  if (mode !== "all" && mode !== "random" && mode !== "manual") {
    return bad("Unsupported selection mode.", 400);
  }
  const access = await getTournamentForMutation(request, user, one, requireSiteCapabilityImpl);
  if (access.error) return access.error;

  const seeding = body?.seeding === "shuffle" ? "shuffle" : "signup";
  const bySignupOrder = (a, b) => {
    const time = new Date(a.created_at) - new Date(b.created_at);
    return time !== 0 ? time : String(a.id).localeCompare(String(b.id));
  };

  const result = await withTransaction(async (tx) => {
    const tournament = await tx.one(
      "SELECT id, bracket_size, format, status, signup_state, entry_fee FROM tournaments WHERE id=$1 FOR UPDATE",
      [access.tournament.id]
    );
    if (tournament.status === "completed" || tournament.status === "cancelled") {
      return { error: "Tournament is already finished.", status: 409 };
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
        ORDER BY created_at ASC, id ASC
        FOR UPDATE`,
      [access.tournament.id, flagOnlyWhenFree]
    );
    const eligibleCount = (eligible || []).length;
    if (eligibleCount < MIN_BRACKET_PARTICIPANTS) {
      return { error: `Need at least ${MIN_BRACKET_PARTICIPANTS} eligible players to start.`, status: 409 };
    }
    if (mode === "all" && eligibleCount > tournament.bracket_size) {
      return { error: "More players than spots. Choose who plays.", status: 409 };
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
    } else if (mode === "random" && eligibleCount > tournament.bracket_size) {
      picked = shuffle(eligible).slice(0, tournament.bracket_size);
    } else {
      picked = eligible;
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
    if ((selected || []).length !== picked.length) {
      return { error: "Could not select the requested entries.", status: 400 };
    }

    // "signup" seeding keeps the registration order (seed 1 = first signup);
    // "shuffle" randomizes it. Either way the bracket is seeded from this list.
    const seeded = seeding === "shuffle"
      ? shuffle(selected)
      : [...selected].sort(bySignupOrder);
    const selectedNames = seeded.map((entry) => entry.display_name);
    await tx.unsafe(
      "UPDATE tournaments SET participants_json=$1, status='active', signup_state='locked', updated_at=now() WHERE id=$2",
      [selectedNames, tournament.id]
    );
    await tx.unsafe("DELETE FROM tournament_open_signups WHERE tournament_id=$1", [tournament.id]);
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
    details: { mode, seeding, count: result.count },
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
    announceChampion = announceTournamentChampion,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const body = await readJson(request) || {};
  const matchId = String(body?.matchId || "").trim();
  if (!matchId) return bad("matchId is required.");

  const hasWinnerSlot = Object.prototype.hasOwnProperty.call(body, "winnerSlot");
  if (hasWinnerSlot && body.winnerSlot !== 1 && body.winnerSlot !== 2) {
    return bad("Choose the winner of this match.");
  }
  const rawP1 = hasWinnerSlot ? (body.winnerSlot === 1 ? 1 : 0) : Number(body?.player1Score);
  const rawP2 = hasWinnerSlot ? (body.winnerSlot === 2 ? 1 : 0) : Number(body?.player2Score);
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
                t.id AS tournament_id, t.status AS tournament_status, t.bracket_size, t.site_id, s.user_id AS site_user_id,
                t.title AS tournament_title, t.chat_channel
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

      const announcement = isFinals && match.chat_channel
        ? {
            tournamentId: match.tournament_id,
            siteId: match.site_id,
            title: match.tournament_title || "",
            champion: winnerName,
            runnerUp: winnerName === match.player1_name ? match.player2_name : match.player1_name,
            scores: hasWinnerSlot ? null : [Math.max(rawP1, rawP2), Math.min(rawP1, rawP2)],
          }
        : null;
      return { matchId: match.id, winnerName, isFinals, roundNumber: match.round_number, announcement };
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

  if (result.announcement) {
    // The final is saved; the chat announcement is best-effort and never
    // delays or fails the score response.
    const announced = Promise.resolve()
      .then(() => announceChampion(env, result.announcement))
      .catch((err) => console.error(JSON.stringify({
        event: "tournament_champion_announce_failed",
        tournamentId: result.announcement.tournamentId,
        reason: String(err?.message || err).slice(0, 200),
      })));
    routeContext(request).waitUntil(announced);
  }

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
 * PATCH /api/tournaments/:id/score — Correct a completed match's score
 *
 * A typo'd score is permanent via POST (which 409s on completed matches).
 * Corrections are allowed only while the winner's downstream path is
 * unplayed: pending next matches get their slot rewritten, BYE-resolved
 * matches are reset and re-resolved, and a genuinely played downstream
 * match blocks the correction (correct it first, walking backwards).
 * `{ matchId, reopen: true }` undoes a result under the same rule: the match
 * returns to pending and its winner's unplayed downstream slots to TBD.
 */
export async function handleCorrectMatchScore(request, env, deps = {}) {
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

  // `reopen` undoes a result: the match goes back to pending and the
  // winner's unplayed downstream slots go back to TBD.
  const reopen = body?.reopen === true;
  const rawP1 = reopen ? 0 : Number(body?.player1Score);
  const rawP2 = reopen ? 0 : Number(body?.player2Score);
  if (!reopen) {
    if (!Number.isInteger(rawP1) || !Number.isInteger(rawP2) || rawP1 < 0 || rawP2 < 0) {
      return bad("Scores must be non-negative integers.");
    }
    if (rawP1 === rawP2) return bad("Scores cannot be tied. A winner must be decided.");
  }

  const tournamentId = tournamentIdFromRequest(request);
  if (!tournamentId) return bad("tournamentId is required.");

  let result;
  try {
    result = await withTransaction(async (tx) => {
      const tourn = await tx.one(
        `SELECT t.id, t.status, t.bracket_size, t.site_id, t.winner_name, s.user_id AS site_user_id
           FROM tournaments t
           JOIN sites s ON s.id = t.site_id
          WHERE t.id=$1
          FOR UPDATE OF t`,
        [tournamentId]
      );
      if (!tourn) return { error: "Tournament not found.", status: 404 };

      const authorization = await requireSiteCapabilityImpl(
        user,
        { id: tourn.site_id, user_id: tourn.site_user_id }
      );
      if (authorization.res) return { error: "Forbidden", status: authorization.res.status || 403 };
      {
        const gateRes = await requireSiteFeature({ user_id: tourn.site_user_id }, "tournaments", { request, oneImpl: tx.one });
        if (gateRes) return { error: "Tournaments are not available on this site's plan.", status: 403 };
      }

      if (tourn.status === "cancelled") {
        return { error: "Tournament is cancelled.", status: 409 };
      }

      const stored = await tx.query(
        `SELECT id, round_number, match_index, player1_name, player2_name,
                player1_score, player2_score, winner_name, status
           FROM tournament_matches
          WHERE tournament_id=$1
          ORDER BY round_number ASC, match_index ASC
          FOR UPDATE`,
        [tournamentId]
      );
      const matches = stored || [];
      const match = matches.find((m) => String(m.id) === matchId);
      if (!match) return { error: "Match not found or unauthorized.", status: 404 };

      const totalRounds = Math.log2(tourn.bracket_size || 0);
      if (!Number.isFinite(totalRounds) || totalRounds < 1) {
        return { error: "Invalid bracket size.", status: 400 };
      }
      const isFinals = match.round_number === totalRounds;
      const correctable = canCorrectMatch(matches, match);
      if (!correctable.ok) {
        const blocked = match.status === "completed"
          && match.player1_name && match.player2_name
          && match.player1_name !== "TBD" && match.player2_name !== "TBD"
          && !isBye(match.player1_name) && !isBye(match.player2_name);
        return {
          error: blocked
            ? "A later match has already been played. Correct that match first."
            : "Match is not correctable.",
          status: 409,
        };
      }

      const previous = { p1: match.player1_score, p2: match.player2_score, winner: match.winner_name };
      if (reopen) {
        for (const step of correctable.path) {
          const setClause = step.byeResolved
            ? `${step.slotColumn}='TBD', status='pending', winner_name=NULL, player1_score=0, player2_score=0`
            : `${step.slotColumn}='TBD'`;
          const stepUpdate = await tx.unsafe(
            `UPDATE tournament_matches
                SET ${setClause}
              WHERE id=$1 AND ${step.slotColumn}=$2
              RETURNING id`,
            [step.id, match.winner_name]
          );
          if (!stepUpdate || stepUpdate.length === 0) {
            throw new TournamentConflictError("A downstream match changed while undoing. Try again.", 409);
          }
        }
        const reopened = await tx.unsafe(
          `UPDATE tournament_matches
              SET status='pending', winner_name=NULL, player1_score=0, player2_score=0
            WHERE id=$1 AND status='completed'
            RETURNING id`,
          [match.id]
        );
        if (!reopened || reopened.length === 0) {
          return { error: "Match could not be reopened. It may no longer be completed.", status: 409 };
        }
        if (tourn.status === "completed") {
          await tx.unsafe(
            `UPDATE tournaments SET status='active', winner_name=NULL, updated_at=now() WHERE id=$1 AND status='completed'`,
            [tournamentId]
          );
        }
        return { matchId: match.id, reopened: true, winnerName: null, winnerChanged: true, isFinals, previous, next: null };
      }
      const winnerName = rawP1 > rawP2 ? match.player1_name : match.player2_name;
      const winnerChanged = winnerName !== match.winner_name;

      const matchUpdate = await tx.unsafe(
        `UPDATE tournament_matches
            SET player1_score=$1, player2_score=$2, winner_name=$3
          WHERE id=$4 AND status='completed'
          RETURNING id`,
        [rawP1, rawP2, winnerName, match.id]
      );
      if (!matchUpdate || matchUpdate.length === 0) {
        return { error: "Match could not be corrected. It may no longer be completed.", status: 409 };
      }

      if (winnerChanged) {
        // Rewrite the old winner's slot along the unplayed path, resetting
        // BYE-resolved matches so the cascade re-derives them.
        for (const step of correctable.path) {
          const setClause = step.byeResolved
            ? `${step.slotColumn}=$1, status='pending', winner_name=NULL, player1_score=0, player2_score=0`
            : `${step.slotColumn}=$1`;
          const stepUpdate = await tx.unsafe(
            `UPDATE tournament_matches
                SET ${setClause}
              WHERE id=$2 AND ${step.slotColumn}=$3
              RETURNING id`,
            [winnerName, step.id, match.winner_name]
          );
          if (!stepUpdate || stepUpdate.length === 0) {
            throw new TournamentConflictError("A downstream match changed while correcting. Try again.", 409);
          }
        }
        await resolveByeMatchesTx(tx, tournamentId, tourn.bracket_size);
      }

      // Champion sync covers correcting the final itself and a correction
      // whose cascade re-resolved a BYE-fed final.
      const final = await tx.one(
        `SELECT winner_name, status FROM tournament_matches
          WHERE tournament_id=$1 AND round_number=$2
          ORDER BY match_index ASC LIMIT 1`,
        [tournamentId, totalRounds]
      );
      if (tourn.status === "completed" && final?.status === "completed"
          && final.winner_name && !isBye(final.winner_name)
          && final.winner_name !== tourn.winner_name) {
        await tx.unsafe(
          `UPDATE tournaments SET winner_name=$1, updated_at=now() WHERE id=$2`,
          [final.winner_name, tournamentId]
        );
      }

      return { matchId: match.id, winnerName, winnerChanged, isFinals, previous, next: { p1: rawP1, p2: rawP2, winner: winnerName } };
    });
  } catch (err) {
    if (err instanceof TournamentConflictError) return bad(err.message, err.status);
    throw err;
  }
  if (result.error) return bad(result.error, result.status);

  if (result.reopened) {
    await logAudit({
      actorId: user.id,
      action: "tournament_match_score_reopen",
      entityType: "tournament_match",
      entityId: result.matchId,
      request,
      details: { previous: result.previous, isFinals: result.isFinals },
    });
    return ok({
      matchId: result.matchId,
      reopened: true,
      winnerName: null,
      winnerChanged: true,
      isFinals: result.isFinals,
      message: "Result undone. The match is open again.",
    });
  }

  await logAudit({
    actorId: user.id,
    action: "tournament_match_score_correction",
    entityType: "tournament_match",
    entityId: result.matchId,
    request,
    details: { previous: result.previous, next: result.next, isFinals: result.isFinals },
  });

  return ok({
    matchId: result.matchId,
    winnerName: result.winnerName,
    winnerChanged: result.winnerChanged,
    isFinals: result.isFinals,
    message: result.isFinals
      ? `\u{1F451} Champion corrected: ${result.winnerName}!`
      : `\u{1F4DD} Score corrected: ${result.winnerName} wins the match.`,
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

  const rows = matches || [];
  return ok({
    tournament: tourn,
    matches: rows.map((m) => ({ ...m, correctable: canCorrectMatch(rows, m).ok })),
  });
}

// The site's current tournament for viewers. "Current" is the live bracket,
// else a tournament taking signups (or waiting to start), else the most
// recently finished one. Drafts nobody can join yet and cancelled tournaments
// stay private.
export async function getPublicTournamentView(site, deps = {}) {
  const { one = defaultOne, query = defaultQuery } = deps;
  if (!site?.id || !canUseFeature(site.plan, "tournaments")) return null;
  const tourn = await one(
    `SELECT id, title, game_name, bracket_size, status, signup_state, winner_name, entry_keyword, chat_channel,
            (status <> 'completed' OR updated_at > now() - interval '7 days') AS featured
       FROM tournaments
      WHERE site_id=$1
        AND (status IN ('active', 'completed') OR (status='draft' AND signup_state IN ('open', 'locked')))
      ORDER BY CASE WHEN status='active' THEN 0 WHEN status='draft' THEN 1 ELSE 2 END, updated_at DESC
      LIMIT 1`,
    [site.id]
  );
  if (!tourn) return null;
  const [matches, counts] = await Promise.all([
    query(
      `SELECT round_number, match_index, player1_name, player2_name, player1_score, player2_score, winner_name, status
         FROM tournament_matches
        WHERE tournament_id=$1
        ORDER BY round_number ASC, match_index ASC`,
      [tourn.id]
    ),
    one(
      `SELECT count(*) FILTER (WHERE status IN ('pending', 'confirmed', 'selected'))::integer AS entries
         FROM tournament_entries WHERE tournament_id=$1`,
      [tourn.id]
    ),
  ]);
  const players = matches?.length ? [] : await query(
    `SELECT display_name
       FROM tournament_entries
      WHERE tournament_id=$1 AND status IN ('pending', 'confirmed', 'selected')
      ORDER BY created_at ASC
      LIMIT 256`,
    [tourn.id]
  );
  return publicTournamentView(tourn, matches || [], {
    entryCount: counts?.entries,
    players: (players || []).map((row) => row.display_name),
  });
}

// GET /api/public/:slug/tournament
export async function handlePublicTournament(request, env, deps = {}) {
  const {
    rateLimit = defaultRateLimit,
    clientIp = defaultClientIp,
    getPublicSite = defaultGetPublicSite,
  } = deps;
  const rl = await rateLimit(env, `pub-tournament:${clientIp(request)}`, 120, 60);
  if (!rl.ok) return bad("Rate limit exceeded. Try again shortly.", 429);

  const slug = String(routeContext(request).slug || "").toLowerCase();
  if (!slug) return bad("Not found.", 404);
  const site = await getPublicSite(env, slug, request);
  if (!site || site.suspended) return bad("Not found.", 404);
  if (site.requiresPassword) return bad("This community is password protected.", 401);
  const tournament = await getPublicTournamentView(site, deps);
  return json({ ok: true, tournament }, 200, { "cache-control": "no-store" });
}
