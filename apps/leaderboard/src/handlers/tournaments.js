// Tournament & Elimination Brackets Handlers.
import {
  requireUser as defaultRequireUser,
  ok,
  bad,
  readJson,
  rateLimit as defaultRateLimit,
  clientIp as defaultClientIp,
} from "../auth.js";
import { getByUser as defaultGetByUser, getBoardById as defaultGetBoardById } from "../site.js";
import { requireSiteCapability } from "../site-authorization.js";
import {
  one as defaultOne,
  query as defaultQuery,
  withTransaction as defaultWithTransaction,
} from "@yourrank/shared/db";
import { logAudit as defaultLogAudit } from "@yourrank/shared/audit";

const TOURNAMENT_READ_RATE_LIMIT = 60;
const ENTRY_SOURCES = new Set(["chat", "page", "manual", "leaderboard"]);
const SUPPORTED_BRACKET_SIZES = [4, 8, 16, 32];

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
  const totalRounds = Math.log2(bracketSize);

  const round1MatchCount = bracketSize / 2;
  for (let m = 0; m < round1MatchCount; m++) {
    await tx.unsafe(
      `INSERT INTO tournament_matches (tournament_id, round_number, match_index, player1_name, player2_name, status)
       VALUES ($1, 1, $2, $3, $4, 'pending')`,
      [tournamentId, m, participants[m * 2], participants[m * 2 + 1]]
    );
  }

  let currentMatchCount = round1MatchCount / 2;
  for (let r = 2; r <= totalRounds; r++) {
    for (let m = 0; m < currentMatchCount; m++) {
      await tx.unsafe(
        `INSERT INTO tournament_matches (tournament_id, round_number, match_index, player1_name, player2_name, status)
         VALUES ($1, $2, $3, 'TBD', 'TBD', 'pending')`,
        [tournamentId, r, m]
      );
    }
    currentMatchCount = currentMatchCount / 2;
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
    { id: tournament.site_id, user_id: tournament.site_user_id },
    "canRoleManageBoard"
  );
  if (authorization.res) return { error: authorization.res };
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

function entryStateFor(tournament, eligibleCount) {
  if (tournament.entry_cap && eligibleCount >= tournament.entry_cap) return "waitlist";
  return "pending";
}

/**
 * GET /api/tournaments — List tournaments for site
 */
export async function handleGetTournaments(request, env, deps = {}) {
  const {
    one = defaultOne,
    query = defaultQuery,
    rateLimit = defaultRateLimit,
    clientIp = defaultClientIp,
  } = deps;
  const rl = await rateLimit(env, `tournaments:${clientIp(request)}`, TOURNAMENT_READ_RATE_LIMIT, 60);
  if (!rl.ok) return bad("Rate limit exceeded. Try again shortly.", 429);

  const url = new URL(request.url);
  const siteSlugOrId = url.searchParams.get("site") || url.searchParams.get("siteId");
  if (!siteSlugOrId) return bad("Site identifier is required.");

  const site = await one("SELECT id, name FROM sites WHERE slug=$1 OR id::text=$1", [siteSlugOrId]);
  if (!site) return bad("Site not found.", 404);

  const tournaments = await query(
    `SELECT id, title, game_name, bracket_size, status, winner_name, created_at,
            signup_state, entry_cap, format, anti_alt_enabled, require_login,
            min_credits, entry_fee, entry_keyword, chat_channel
       FROM tournaments
      WHERE site_id=$1
      ORDER BY created_at DESC LIMIT 20`,
    [site.id]
  );

  return ok({ tournaments: tournaments || [] });
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
    requireSiteCapabilityImpl = requireSiteCapability,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const body = await readJson(request);
  const title = String(body?.title || "").trim() || "Community Tournament";
  const gameName = String(body?.gameName || "Game").trim();
  const requestedBracketSize = [4, 8, 16, 32].includes(parseInt(body?.bracketSize, 10)) ? parseInt(body?.bracketSize, 10) : 8;
  const tournamentFormat = ["bracket", "1v1", "2v2"].includes(body?.format) ? body.format : "bracket";
  const entryCap = body?.entryCap === "" || body?.entryCap === null || body?.entryCap === undefined
    ? null
    : Math.max(1, parseInt(body.entryCap, 10) || 1);
  const antiAltEnabled = body?.antiAltEnabled === true;
  const requireLogin = body?.requireLogin === true;
  const minCredits = Math.max(0, parseInt(body?.minCredits, 10) || 0);
  const entryFee = Math.max(0, parseInt(body?.entryFee, 10) || 0);
  const entryKeyword = String(body?.entryKeyword || "!join").trim().slice(0, 40) || "!join";

  const rawParticipants = Array.isArray(body?.participants) ? body.participants : [];
  const providedParticipantCount = rawParticipants.length;
  if (providedParticipantCount > 0 && !isSupportedBracketSize(providedParticipantCount)) {
    return bad("Participant count must be a supported bracket size (4, 8, 16, or 32).");
  }
  const bracketSize = providedParticipantCount || requestedBracketSize;
  const participants = providedParticipantCount
    ? rawParticipants.map((p) => String(p || "").trim()).filter(Boolean)
    : [];
  if (providedParticipantCount && participants.length !== providedParticipantCount) {
    return bad("Every participant must have a non-empty name.");
  }

  const url = new URL(request.url);
  const siteId = body?.siteId || url.searchParams.get("siteId");
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  if (!site) return bad("Site not found", 404);
  const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageBoard");
  if (authorization.res) return authorization.res;

  const result = await withTransaction(async (tx) => {
    const tourn = await tx.one(
      `INSERT INTO tournaments
        (site_id, title, game_name, bracket_size, status, participants_json,
         entry_cap, format, anti_alt_enabled, require_login, min_credits, entry_fee, entry_keyword)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, title, game_name, bracket_size, status, signup_state, entry_cap,
              format, anti_alt_enabled, require_login, min_credits, entry_fee, entry_keyword, created_at`,
      [
        site.id,
        title,
        gameName,
        bracketSize,
        JSON.stringify(participants),
        entryCap,
        tournamentFormat,
        antiAltEnabled,
        requireLogin,
        minCredits,
        entryFee,
        entryKeyword,
      ]
    );

    if (participants.length > 0) {
      await seedTournamentMatches(tx, tourn.id, participants, bracketSize);
    }

    return tourn;
  });

  await logAudit({
    actorId: user.id,
    action: "tournament_create",
    entityType: "tournament",
    entityId: result.id,
    request,
    details: { title, gameName, bracketSize, tournamentFormat, entryCap, entryKeyword },
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
    logAudit = defaultLogAudit,
    requireSiteCapabilityImpl = requireSiteCapability,
  } = deps;
  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const access = await getTournamentForMutation(request, user, one, requireSiteCapabilityImpl);
  if (access.error) return access.error;
  // Signups are collected from Kick chat, so the server refuses to open them
  // until the channel to listen to is actually stored.
  if (state === "open" && !normalizeChatChannel(access.tournament.chat_channel)) {
    return bad("Add your Kick channel before opening signups.", 400);
  }
  const result = await one(
    `UPDATE tournaments
        SET signup_state=$1, updated_at=now()
      WHERE id=$2
      RETURNING id, signup_state, entry_cap, entry_keyword, chat_channel`,
    [state, access.tournament.id]
  );
  await logAudit({
    actorId: user.id,
    action: `tournament_signups_${state}`,
    entityType: "tournament",
    entityId: access.tournament.id,
    request,
    details: { signupState: state },
  });
  return ok({ tournament: result });
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
    logAudit = defaultLogAudit,
    requireSiteCapabilityImpl = requireSiteCapability,
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
  if (Object.prototype.hasOwnProperty.call(body, "format")) {
    addUpdate("format", ["bracket", "1v1", "2v2"].includes(body.format) ? body.format : "bracket");
  }
  if (Object.prototype.hasOwnProperty.call(body, "entryCap")) {
    addUpdate(
      "entry_cap",
      body.entryCap === "" || body.entryCap === null
        ? null
        : Math.max(1, parseInt(body.entryCap, 10) || 1)
    );
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

  let tournament = access.tournament;
  if (updates.length) {
    values.push(access.tournament.id);
    tournament = await one(
      `UPDATE tournaments
          SET ${updates.join(", ")}, updated_at=now()
        WHERE id=$${values.length}
        RETURNING id, title, game_name, signup_state, entry_cap, format,
                  anti_alt_enabled, require_login, min_credits, entry_fee, entry_keyword,
                  chat_channel`,
      values
    );
    await logAudit({
      actorId: user.id,
      action: "tournament_settings_update",
      entityType: "tournament",
      entityId: access.tournament.id,
      request,
      details: { fields: updates.map((update) => update.split("=")[0]) },
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
    requireSiteCapabilityImpl = requireSiteCapability,
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
 * POST /api/tournaments/:id/entries — Add one streamer-sourced entry.
 */
export async function handleAddTournamentEntry(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    one = defaultOne,
    withTransaction = defaultWithTransaction,
    logAudit = defaultLogAudit,
    requireSiteCapabilityImpl = requireSiteCapability,
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
    result = await withTransaction(async (tx) => {
      const tournament = await tx.one(
        `SELECT id, signup_state, entry_cap
           FROM tournaments
          WHERE id=$1
          FOR UPDATE`,
        [access.tournament.id]
      );
      if (!tournament) return { error: "Tournament not found.", status: 404 };

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

      const eligible = await tx.one(
        `SELECT count(*)::integer AS count
           FROM tournament_entries
          WHERE tournament_id=$1 AND status IN ('pending', 'confirmed', 'selected')`,
        [tournament.id]
      );
      const status = entryStateFor(tournament, eligible?.count || 0);
      if (status === "waitlist" && tournament.signup_state === "open" && tournament.entry_cap) {
        await tx.one(
          "UPDATE tournaments SET signup_state='locked', updated_at=now() WHERE id=$1 RETURNING id",
          [tournament.id]
        );
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
    });
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
    requireSiteCapabilityImpl = requireSiteCapability,
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
    requireSiteCapabilityImpl = requireSiteCapability,
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
    const status = entryStateFor(tournament, count?.count || 0);
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

export async function handleRandomPickTournamentEntries(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    one = defaultOne,
    withTransaction = defaultWithTransaction,
    logAudit = defaultLogAudit,
    requireSiteCapabilityImpl = requireSiteCapability,
  } = deps;
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const body = await readJson(request);
  const requestedCount = parseInt(body?.count, 10);
  if (!Number.isInteger(requestedCount) || requestedCount <= 0) {
    return bad("count must be a positive integer.");
  }
  const count = Math.min(1000, requestedCount);
  const access = await getTournamentForMutation(request, user, one, requireSiteCapabilityImpl);
  if (access.error) return access.error;

  const result = await withTransaction(async (tx) => {
    const tournament = await tx.one(
      "SELECT id, bracket_size, format, status FROM tournaments WHERE id=$1 FOR UPDATE",
      [access.tournament.id]
    );
    if (tournament.status === "completed" || tournament.status === "cancelled") {
      return { error: "Tournament is already finished.", status: 409 };
    }
    if (!isSupportedBracketSize(count)) {
      return { error: "Pick count must be a supported bracket size (4, 8, 16, or 32).", status: 400 };
    }
    if (count > tournament.bracket_size) {
      return { error: `Pick count cannot exceed the bracket size of ${tournament.bracket_size}.`, status: 400 };
    }
    const available = await tx.one(
      `SELECT count(*)::integer AS count FROM tournament_entries
        WHERE tournament_id=$1 AND status IN ('pending', 'confirmed')`,
      [access.tournament.id]
    );
    if ((available?.count || 0) < count) {
      return { error: `Only ${available?.count || 0} eligible entries are available.`, status: 400 };
    }
    const picked = await tx.query(
      `SELECT id, tournament_id, display_name, source, status, trust_score, alt_flag, alt_reason,
              team_no, created_at, updated_at
         FROM tournament_entries
        WHERE tournament_id=$1 AND status IN ('pending', 'confirmed')
        ORDER BY random()
        LIMIT $2
        FOR UPDATE`,
      [access.tournament.id, count]
    );
    const ids = (picked || []).map((entry) => entry.id);
    const selected = await tx.query(
      `UPDATE tournament_entries
          SET status='selected', updated_at=now()
        WHERE id = ANY($1::uuid[])
        RETURNING id, tournament_id, display_name, source, status, trust_score, alt_flag, alt_reason,
                  team_no, created_at, updated_at`,
      [ids]
    );

    const selectedNames = (selected || []).map((entry) => entry.display_name);
    if (selectedNames.length !== count) {
      return { error: "Could not select the requested number of entries.", status: 400 };
    }
    const bracketSize = count;
    await tx.unsafe(
      "UPDATE tournaments SET participants_json=$1, bracket_size=$2, updated_at=now() WHERE id=$3",
      [JSON.stringify(selectedNames), bracketSize, tournament.id]
    );
    await tx.unsafe("DELETE FROM tournament_matches WHERE tournament_id=$1", [tournament.id]);
    await seedTournamentMatches(tx, tournament.id, selectedNames, bracketSize);

    return { entries: selected || [] };
  });
  if (result.error) return bad(result.error, result.status);
  await logAudit({
    actorId: user.id,
    action: "tournament_entries_random_pick",
    entityType: "tournament",
    entityId: access.tournament.id,
    request,
    details: { count: result.entries.length },
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
    requireSiteCapabilityImpl = requireSiteCapability,
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
        { id: match.site_id, user_id: match.site_user_id },
        "canRoleManageBoard"
      );
      if (authorization.res) return { error: "Forbidden", status: authorization.res.status || 403 };

      if (match.tournament_status === "completed" || match.tournament_status === "cancelled") {
        return { error: "Tournament is already finished.", status: 409 };
      }
      if (match.status === "completed") {
        return { error: "Match has already been scored.", status: 409 };
      }
      if (!match.player1_name || !match.player2_name || match.player1_name === "TBD" || match.player2_name === "TBD") {
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
