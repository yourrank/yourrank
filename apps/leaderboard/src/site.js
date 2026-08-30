// Site + players data helpers for the Worker.
import { effectivePlan, PLAN_LIMITS, BOARD_LIMITS, HISTORY_DAYS } from "@yourrank/shared/plans";
import { fromJsonb } from "@yourrank/shared/jsonb";
import { query, one, exec, withTransaction } from "@yourrank/shared/db";
import { detectTop3Changes, dispatchNotifyEvent, getRankChangedPlayerNames } from "@yourrank/shared/notifications";
import { RESERVED, slugify, hashPassword } from "./auth.js";
import { logAudit } from "@yourrank/shared/audit";
import { createQueueProducer } from "@yourrank/shared/queue-producer";
import { encrypt } from "@yourrank/shared/crypto";
import { verifyBoardPasswordCookie } from "./board-password.js";
import { detectImageMime, validateLogoData } from "./logo-validation.js";
import { invalidatePublicBoardCache } from "./public-html-cache.js";
import { notifyLiveBoard } from "./live-board-config.js";
import { normalizePlayerName, rankField, sortPlayersForRanking, validateAndNormalizePlayers } from "./player-rules.js";
import { getSiteRole as sharedGetSiteRole } from "@yourrank/shared/team";

export { detectImageMime, validateLogoData };


function getTokenEncKey() {
  const hex = (typeof process !== "undefined" && process.env?.TOKEN_ENC_KEY) || "";
  if (hex.length !== 64) throw new Error("TOKEN_ENC_KEY must be 64 hex characters (32 bytes)");
  return hex;
}

const DISCORD_WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/.+/;

function createNotifyQueue(env) {
  return createQueueProducer(
    env.EVENTS_QUEUE,
    async (event) => {
      if (event.type === "notify") {
        await dispatchNotifyEvent({ one, query }, env, event);
      }
    }
  );
}

// NOTE: chips + whyStats intentionally start empty. They render casino perks
// ("Deposit Bonus", "Instant Rakeback", …) that a brand-new owner never entered,
// which published fabricated partner claims on every unconfigured page. Owners
// add their own via the dashboard; the public renderer hides these sections when
// they're empty. Socials start disabled so a fresh page doesn't advertise fake links.
export const VALID_PERIODS = ["Weekly", "Monthly", "Season"];

export const DEFAULT_EXTRA = {
  chips: [],
  whyStats: [],
  rules: [
    "Leaderboard resets automatically each period.",
    "Scores update instantly when posted via the dashboard or API.",
    "Prizes are set by the board owner and displayed for entertainment.",
  ],
  socials: [
    { name: "Discord", handle: "Join the community", action: "Join", url: "#", brand: "discord", enabled: false },
    { name: "Kick", handle: "Watch live", action: "Follow", url: "#", brand: "kick", enabled: false },
    { name: "Twitch", handle: "Watch live", action: "Follow", url: "#", brand: "twitch", enabled: false },
    { name: "YouTube", handle: "Watch videos", action: "Subscribe", url: "#", brand: "youtube", enabled: false },
    { name: "X", handle: "Latest updates", action: "Follow", url: "#", brand: "x", enabled: false },
  ],
  sections: {
    hero: true,
    leaderboard: true,
    top3: true,
    search: true,
    rules: true,
    partner: true,
    socials: true,
    share: true,
    pastWinners: true,
    countdown: true,
    cta: true,
    payouts: true,
    poweredBy: false,
  },
  playerFields: {
    score: true,
    hands: true,
    netProfit: true,
    winRate: true,
    change: false,
  },
  legal: {
    // B-02: Default to false so new boards don't ship with dead footer links.
    // Streamers opt in by writing content and enabling each page individually.
    terms: "",        termsEnabled: false,
    privacy: "",      privacyEnabled: false,
    responsible: "",  responsibleEnabled: false,
    cookies: "",      cookiesEnabled: false,
    refund: "",       refundEnabled: false,
    contact: "",      contactEnabled: false,
  },
};

// All site columns except logo_data (base64 image, up to 180KB) — that's only
// needed by the /logo/:slug endpoint and saveSite(), which fetch it separately.
// PERF-004 / PERF-107: avoid SELECT * to prevent 180KB+ transfers on every page.
// PERF-005: include has_logo as a computed column to avoid a separate re-query.
const SITE_COLUMNS = "id, user_id, slug, name, tagline, casino, code, cta_url, prize_pool, period, starts_at, ends_at, rank_by, reset_note, blurb, extra_json, published, is_draft, theme_json, updated_at, published_at, custom_domain, domain_status, discord_webhook_url_enc, telegram_chat_id, telegram_notify, auto_reset_enabled, auto_reset_clear, auto_reset_last_run_at, password_hash, password_salt, viewer_kick_auth_enabled, viewer_discord_auth_enabled, viewer_public_redeem_enabled, games_enabled, shop_enabled, credits_enabled, (logo_data IS NOT NULL AND logo_data != '') AS has_logo";

// L1 in-memory cache (per-isolate). No L2 KV — sessions moved to Postgres.
const siteCache = new Map();
const inflight = new Map();        // PERF-009: single-flight — prevent cache stampede
const L1_TTL = 25_000;
const L1_MAX_ENTRY_BYTES = 50_000;
const SITE_CACHE_MAX = 1000;
const PUBLIC_STREAM_VERSION_TTL = 3_000;
const publicStreamVersionCache = new Map();
const publicStreamVersionInflight = new Map();

function evictOldest(cache, max) {
  while (cache.size > max) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
}

function setL1(cache, key, data, maxEntryBytes) {
  try {
    const size = JSON.stringify(data).length;
    if (size > maxEntryBytes) return;
  } catch { /* stringify failed */ }
  cache.set(key, { data, expires: Date.now() + L1_TTL });
  evictOldest(cache, SITE_CACHE_MAX);
}

async function getCached(env, key, dbFetcher) {
  // L1 check (synchronous, per-isolate)
  const entry = siteCache.get(key);
  if (entry && entry.expires > Date.now()) return entry.data;

  // DB fetch — single-flight: coalesce concurrent misses into one query
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const data = await dbFetcher();
      setL1(siteCache, key, data, L1_MAX_ENTRY_BYTES);
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function invalidateSiteCache(env, ...keys) {
  for (const key of keys) {
    siteCache.delete(key);
  }
}

export function invalidateUserCache(env, uid) {
  siteCache.delete(uid);
  siteCache.delete(`user_boards:${uid}`);
}

export async function getPublicStreamVersion(siteId, { one: oneImpl = one } = {}) {
  const cached = publicStreamVersionCache.get(siteId);
  if (cached && cached.expires > Date.now()) return cached.value;

  if (publicStreamVersionInflight.has(siteId)) {
    return publicStreamVersionInflight.get(siteId);
  }

  const p = (async () => {
    try {
      const row = await oneImpl("SELECT max(updated_at) AS m FROM players WHERE site_id=$1", [siteId]);
      const value = row?.m ? new Date(row.m).toISOString() : "0";
      publicStreamVersionCache.set(siteId, { value, expires: Date.now() + PUBLIC_STREAM_VERSION_TTL });
      evictOldest(publicStreamVersionCache, SITE_CACHE_MAX);
      return value;
    } finally {
      publicStreamVersionInflight.delete(siteId);
    }
  })();
  publicStreamVersionInflight.set(siteId, p);
  return p;
}

export async function getPublicLiveBoardVersion(siteId, { one: oneImpl = one } = {}) {
  const row = await oneImpl(
    `SELECT GREATEST(
       s.updated_at,
       COALESCE(MAX(p.updated_at), s.updated_at)
     ) AS m,
     now() AS _fresh
       FROM sites s
       LEFT JOIN players p ON p.site_id = s.id
      WHERE s.id=$1
      GROUP BY s.updated_at`,
    [siteId]
  );
  return row?.m ? new Date(row.m).toISOString() : "0";
}

export function clearPublicStreamVersionCache() {
  publicStreamVersionCache.clear();
  publicStreamVersionInflight.clear();
}

export const getBySlug = (env, slug) => getCached(env, slug, () => one(`SELECT ${SITE_COLUMNS} FROM sites WHERE slug=$1`, [slug]));

export async function getClickRedirectSite(env, slug, request = null) {
  const site = await one(
    `SELECT s.id, s.user_id, s.slug, s.cta_url, s.published, s.is_draft,
            s.password_hash, s.password_salt, u.status AS owner_status, u.email_verified
       FROM sites s
       JOIN users u ON u.id = s.user_id
      WHERE s.slug = $1`,
    [slug]
  );
  if (!site || !site.published || site.is_draft || site.owner_status === "suspended" || !site.email_verified) {
    return null;
  }
  if (site.password_hash && !(request && await verifyBoardPasswordCookie(request, site))) {
    return null;
  }
  return site;
}

// Multi-board: returns the ACTIVE board for a user (or the first board if none set).
// Not cached: the dashboard reads this on every load and must see the latest saves
// immediately, even when the request hits a different worker isolate.
const getByUser = async (env, uid, {
  one: oneImpl = one,
  getSiteRole = sharedGetSiteRole,
} = {}) => {
  const owned = await oneImpl(`SELECT ${SITE_COLUMNS} FROM sites WHERE user_id=$1 ORDER BY CASE WHEN id=(SELECT active_site_id FROM users WHERE id=$1) THEN 0 ELSE 1 END, id ASC LIMIT 1`, [uid]);
  if (owned) return owned;
  const candidate = await oneImpl(
    `SELECT ${SITE_COLUMNS}
       FROM sites
      WHERE id IN (
        SELECT sm.site_id
          FROM site_members sm
          JOIN sites delegated ON delegated.id=sm.site_id
          JOIN users owner ON owner.id=delegated.user_id
         WHERE sm.user_id=$1
           AND sm.role='moderator'
           AND lower(owner.plan)='team'
           AND owner.status IS DISTINCT FROM 'suspended'
           AND owner.plan_expires_at > now()
      )
      ORDER BY id ASC LIMIT 1`,
    [uid],
  );
  if (!candidate) return null;
  return await getSiteRole(candidate.id, uid, { one: oneImpl }) === "moderator" ? candidate : null;
};

// Multi-board: returns ALL boards for a user.
export async function getAllBoards(env, uid) {
  // Defensive ceiling above the highest current plan's board limit.
  const rows = await query(`SELECT ${SITE_COLUMNS} FROM sites WHERE user_id=$1 ORDER BY id ASC LIMIT 128`, [uid]);
  return rows || [];
}

// Multi-board: returns a specific board by site ID (if owned or member).
export async function getBoardById(env, uid, siteId, {
  one: oneImpl = one,
  getSiteRole = sharedGetSiteRole,
} = {}) {
  const owned = await oneImpl(`SELECT ${SITE_COLUMNS} FROM sites WHERE id=$1 AND user_id=$2`, [siteId, uid]);
  if (owned) return owned;
  if (await getSiteRole(siteId, uid, { one: oneImpl }) !== "moderator") return null;
  return oneImpl(`SELECT ${SITE_COLUMNS} FROM sites WHERE id=$1`, [siteId]);
}

export async function getSiteById(env, siteId) {
  return one(`SELECT ${SITE_COLUMNS} FROM sites WHERE id=$1`, [siteId]);
}

// Public "hub": the owner's published boards, so a visitor on one board's page
// can tab across to the streamer's other sponsor leaderboards.
async function getPublicBoards(env, uid) {
  const rows = await query(
    // Defensive ceiling above the highest current plan's board limit.
    "SELECT slug, name FROM sites WHERE user_id=$1 AND published=true AND is_draft=false ORDER BY board_order ASC, id ASC LIMIT 128",
    [uid]
  );
  return (rows || []).map((r) => ({ slug: r.slug, name: r.name || r.slug }));
}

export async function getPlayers(env, siteId, options = {}) {
  const limit = Math.min(10000, Math.max(1, Number(options.limit) || 10000));
  const offset = Math.max(0, Number(options.offset) || 0);
  const search = normalizePlayerName(options.search || "");
  const metric = rankField(options.rankBy);
  const sql = `SELECT name, wagered, prize, score, hands, net_profit, win_rate, change, rank
     FROM (
       SELECT name, normalized_name, wagered, prize, score, hands, net_profit, win_rate, change,
              RANK() OVER (ORDER BY ${metric} DESC)::int AS rank
         FROM (
           SELECT name, normalized_name, wagered, prize, score, hands, net_profit, win_rate, change
             FROM players
            WHERE site_id=$1
            ORDER BY ${metric} DESC, normalized_name ASC
            LIMIT 10000
         ) bounded
     ) ranked
    WHERE ($2 = '' OR normalized_name LIKE '%' || $2 || '%')
    ORDER BY rank, normalized_name ASC
    LIMIT $3 OFFSET $4`;
  const rows = await query(sql, [siteId, search, limit, offset]);
  return rows || [];
}

async function getPlayerCount(siteId, search = "") {
  const normalizedSearch = String(search || "").trim().toLowerCase().replace(/\s+/g, " ");
  const row = await one(
    "SELECT count(*)::int AS count FROM players WHERE site_id=$1 AND ($2 = '' OR normalized_name LIKE '%' || $2 || '%')",
    [siteId, normalizedSearch]
  );
  return Number(row?.count) || 0;
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// C-06: Added proper CSS generic fallback stacks so browsers FOUT to a sane
// generic font rather than the arbitrary system default when the webfont fails.
export const FONT_FAMILIES = {
  Inter:              "'Inter', system-ui, -apple-system, sans-serif",
  Oswald:             "'Oswald', system-ui, sans-serif",
  "Playfair Display": "'Playfair Display', Georgia, serif",
  Rajdhani:           "'Rajdhani', system-ui, sans-serif",
  "Bebas Neue":       "'Bebas Neue', system-ui, sans-serif",
};
export const FONT_KEYS = Object.keys(FONT_FAMILIES);

const DEFAULT_PRIZES = {
  prizePoolLabel: "Prize pool",
  countdownLabel: "",
  currency: "$",
  hidePrizeAmounts: false,
  payoutsLabel: "Payouts",
  wagerLabel: "Wagered",
  prizeLabel: "Prize",
  wagerTotalLabel: "Wager total",
};
// C-01: Single source of truth for prize label sanitization.
// Previously duplicated verbatim across parseTheme, saveSite, and updateSiteTheme.
const PRIZE_LABEL_MAX = 40;
const CURRENCY_MAX = 6;

function parsePrizes(rawPrizes) {
  const raw = (rawPrizes && typeof rawPrizes === "object") ? rawPrizes : {};
  return {
    prizePoolLabel:  String(raw.prizePoolLabel  || DEFAULT_PRIZES.prizePoolLabel).slice(0, PRIZE_LABEL_MAX),
    countdownLabel:  String(raw.countdownLabel  || DEFAULT_PRIZES.countdownLabel).slice(0, PRIZE_LABEL_MAX),
    currency:        String(raw.currency        || DEFAULT_PRIZES.currency).slice(0, CURRENCY_MAX),
    hidePrizeAmounts: raw.hidePrizeAmounts === true,
    payoutsLabel:    String(raw.payoutsLabel    || DEFAULT_PRIZES.payoutsLabel).slice(0, PRIZE_LABEL_MAX),
    wagerLabel:      String(raw.wagerLabel      || DEFAULT_PRIZES.wagerLabel).slice(0, PRIZE_LABEL_MAX),
    prizeLabel:      String(raw.prizeLabel      || DEFAULT_PRIZES.prizeLabel).slice(0, PRIZE_LABEL_MAX),
    wagerTotalLabel: String(raw.wagerTotalLabel || DEFAULT_PRIZES.wagerTotalLabel).slice(0, PRIZE_LABEL_MAX),
  };
}


export const VALID_TEMPLATES = ["cyber_arcade", "esports_pro", "creator_glass", "classic"];

function parseTheme(site) {
  const raw = fromJsonb(site.theme_json);
  const t = (raw && typeof raw === "object") ? raw : {};
  const font = FONT_KEYS.includes(t.font) ? t.font : "Inter";
  const template = VALID_TEMPLATES.includes(t.template)
    ? (t.template === "classic" ? "cyber_arcade" : t.template)
    : "cyber_arcade";
  // C-01: Use shared parsePrizes helper instead of inline duplication.
  const prizes = parsePrizes((t.prizes && typeof t.prizes === "object") ? t.prizes : {});
  return {
    template,
    accentA: HEX.test(t.accentA || "") ? t.accentA : null,
    accentB: HEX.test(t.accentB || "") ? t.accentB : null,
    options: {},
    font,
    prizes,
  };
}

export function archiveShape(a) {
  const top = fromJsonb(a.top3_json);
  const players = Array.isArray(top) ? top : [];
  return { label: a.label, at: a.created_at, top: players };
}

export function playerStreak(player, currentRank, archives) {
  if (currentRank !== 0) return 0;
  const name = normalizePlayerName(player.name);
  let streak = 1;
  for (const a of archives) {
    if (normalizePlayerName(a.winner_name) !== name) break;
    streak++;
  }
  return streak;
}

// Archive creation count is a separate operational safeguard from the
// time-based accessible-history entitlement below. Downgrades never delete rows.
export const ARCHIVE_LIMITS = { free: 6, pro: 12, team: 24 };
export const PUBLIC_ARCHIVE_LIMIT = 24;

export async function getArchives(env, siteId, limit = 6, historyDays = HISTORY_DAYS.free, queryImpl = query) {
    const rows = await queryImpl(
      `SELECT id, label, top3_json, winner_name,
              (EXTRACT(EPOCH FROM created_at) * 1000)::double precision AS created_at
         FROM archives
        WHERE site_id=$1
          AND created_at >= now() - ($2::int * interval '1 day')
        ORDER BY created_at DESC LIMIT $3`,
      [siteId, historyDays, limit]
    );
    return rows || [];
  }

// Expensive detail-only read. Never use this on the board render path: it
// transfers the full archived player snapshots instead of derived summaries.
export async function getArchiveSnapshots(env, siteId, limit = 6, historyDays = HISTORY_DAYS.free, queryImpl = query) {
  const rows = await queryImpl(
    `SELECT id, label, snapshot_json,
            (EXTRACT(EPOCH FROM created_at) * 1000)::double precision AS created_at
       FROM archives
      WHERE site_id=$1
        AND created_at >= now() - ($2::int * interval '1 day')
      ORDER BY created_at DESC LIMIT $3`,
    [siteId, historyDays, Math.min(limit, PUBLIC_ARCHIVE_LIMIT)]
  );
  return rows || [];
}

async function getArchivePlayerCounts(env, siteId, limit = 6, historyDays = HISTORY_DAYS.free) {
  const rows = await query(
    `SELECT id, label, top3_json, winner_name,
            jsonb_array_length(public.archive_snapshot_array(snapshot_json)) AS player_count,
            (EXTRACT(EPOCH FROM created_at) * 1000)::double precision AS created_at
       FROM archives
      WHERE site_id=$1
        AND created_at >= now() - ($2::int * interval '1 day')
      ORDER BY created_at DESC LIMIT $3`,
    [siteId, historyDays, limit]
  );
  return rows || [];
}

export function publicShape(site, players, archives = [], hasLogo = false, playerCount = null) {
  const rawExtra = fromJsonb(site.extra_json);
  const extra = (rawExtra && typeof rawExtra === "object") ? rawExtra : {};
  const m = { ...DEFAULT_EXTRA, ...extra };
  const theme = parseTheme(site);
  const brand = {
    name: site.name, tagline: site.tagline, code: site.code,
    prizePool: site.prize_pool, period: site.period, casino: site.casino,
    ctaUrl: site.cta_url, resetNote: site.reset_note,
    currency: theme.prizes.currency,
    hidePrizeAmounts: theme.prizes.hidePrizeAmounts,
    prizePoolLabel: theme.prizes.prizePoolLabel,
    countdownLabel: theme.prizes.countdownLabel,
    payoutsLabel: theme.prizes.payoutsLabel,
  };
  return {
    brand,
    prizes: { ...theme.prizes },
    startsAt: site.starts_at,
    endsAt: site.ends_at,
    scheduled: !!(site.starts_at && new Date(site.starts_at).getTime() > Date.now()),
    ended: !!(site.ends_at && new Date(site.ends_at).getTime() <= Date.now()),
    rankBy: rankField(site.rank_by),
    partner: { blurb: site.blurb, chips: m.chips },
    whyStats: m.whyStats, rules: m.rules, socials: (m.socials || []).filter(s => s.enabled !== false),
    branding: { hasLogo, accentA: theme.accentA, accentB: theme.accentB, template: theme.template, text: theme.text, font: theme.font, options: theme.options },
    pastWinners: archives.map(archiveShape),
    playerCount: Number.isFinite(Number(playerCount)) ? Number(playerCount) : players.length,
    players: players.map((p, i) => ({
      name: p.name,
      wagered: p.wagered,
      prize: p.prize,
      score: p.score,
      hands: p.hands,
      netProfit: p.net_profit,
      winRate: p.win_rate,
      change: p.change,
      rank: Number(p.rank) || i + 1,
      streak: playerStreak(p, i, archives),
    })),
    sections: m.sections || DEFAULT_EXTRA.sections,
    siteSections: {
      home: true,
      leaderboard: true,
      shop: !!site.shop_enabled,
      games: !!site.games_enabled,
      me: !!site.credits_enabled,
    },
    legal: m.legal || DEFAULT_EXTRA.legal,
    playerFields: { ...DEFAULT_EXTRA.playerFields, ...(m.playerFields || {}) },
    samplePlayers: m.samplePlayers === true,
  };
}

export async function getPublicSite(env, slug, request = null, playerOptions = null) {
    const site = playerOptions?.fresh
      ? await one(`SELECT ${SITE_COLUMNS}, now() AS _fresh FROM sites WHERE slug=$1`, [slug])
      : await getBySlug(env, slug);
    if (!site || !site.published || site.is_draft) return null;
    if (site.password_hash && !(request && await verifyBoardPasswordCookie(request, site))) {
      return { requiresPassword: true, id: site.id, slug: site.slug, name: site.name };
    }
    // PERF-005: has_logo is now part of SITE_COLUMNS (computed from logo_data).
    // Eliminated redundant re-query of sites table. Owner query remains separate
    // since it's from the users table (indexed by id, ~0.1ms).
    // DB-003-v8: Resolve plan first, then fetch only needed archives
    const owner = await one(
      "SELECT plan, (EXTRACT(EPOCH FROM plan_expires_at) * 1000)::double precision AS plan_expires_at, status, email_verified FROM users WHERE id=$1",
      [site.user_id]
    );
    // Gate the board for suspended owners and for owners who have not confirmed
    // their email — but keep the two states distinct so the public page can say
    // "not live yet" instead of accusing the owner of being suspended.
    if (owner && owner.status === "suspended") return { suspended: true };
    if (owner && !owner.email_verified) return { suspended: true, pendingVerification: true };
    const plan = effectivePlan(owner);
    const archiveLimit = Math.min(ARCHIVE_LIMITS[plan] || 6, PUBLIC_ARCHIVE_LIMIT);
    const boundedPlayers = playerOptions && Number.isFinite(Number(playerOptions.limit));
    const totalCountPromise = boundedPlayers ? getPlayerCount(site.id) : Promise.resolve(null);
    const matchCountPromise = boundedPlayers && String(playerOptions.search || "").trim()
      ? getPlayerCount(site.id, playerOptions.search)
      : totalCountPromise;
    const [players, playerCount, playerMatchCount, archives, boards, bot] = await Promise.all([
      getPlayers(env, site.id, { ...(boundedPlayers ? playerOptions : {}), rankBy: site.rank_by }),
      totalCountPromise,
      matchCountPromise,
      getArchives(env, site.id, archiveLimit, HISTORY_DAYS[plan]), // DB-003-v8: fetch only entitled history
      getPublicBoards(env, site.user_id),
      one("SELECT username FROM bots WHERE owner_id=$1 LIMIT 1", [site.user_id]),
    ]);
    const data = publicShape(site, players, archives, !!site.has_logo, playerCount);
    if (boundedPlayers) data.playerMatchCount = playerMatchCount;
    return {
      id: site.id,
      userId: site.user_id,
      published: !!site.published,
      isDraft: !!site.is_draft,
      data,
      plan,
      boards,
      botUsername: bot?.username || null,
      viewerKickAuthEnabled: !!site.viewer_kick_auth_enabled,
      viewerDiscordAuthEnabled: !!site.viewer_discord_auth_enabled,
      viewerPublicRedeemEnabled: !!site.viewer_public_redeem_enabled,
    };
  }

async function planForSelectedSite(site, uid, fallbackPlan) {
  if (site.user_id === uid) return fallbackPlan || "free";
  const owner = await one(
    "SELECT plan, plan_expires_at, status FROM users WHERE id=$1",
    [site.user_id],
  );
  return effectivePlan(owner);
}

export async function getUserSite(env, uid, plan) {
      const site = await getByUser(env, uid);
      if (!site) return null;
      const selectedPlan = await planForSelectedSite(site, uid, plan);
      const archiveLimit = ARCHIVE_LIMITS[selectedPlan] || 6;
      // PERF-005: has_logo is now in SITE_COLUMNS — no separate query needed.
      const archives = await getArchivePlayerCounts(env, site.id, archiveLimit, HISTORY_DAYS[selectedPlan]);
    return {
        id: site.id, slug: site.slug, published: !!site.published, plan: selectedPlan,
        isDraft: !!site.is_draft,
        passwordProtected: !!site.password_hash,
        updatedAt: site.updated_at,
        publishedAt: site.published_at,
        autoReset: { enabled: !!site.auto_reset_enabled, clear: site.auto_reset_clear || "wagers" },
        data: publicShape(site, await getPlayers(env, site.id, { rankBy: site.rank_by }), archives.slice(0, archiveLimit), !!site.has_logo),
        socials: (fromJsonb(site.extra_json)?.socials) ?? DEFAULT_EXTRA.socials,
        customDomain: site.custom_domain || "",
          domainStatus: site.domain_status || "pending",
        notify: {
          discord_webhook_url: !!site.discord_webhook_url_enc,
          telegram_bot_token: false,
          telegram_chat_id: site.telegram_chat_id || "",
          telegram_notify: !!site.telegram_notify,
        },
        archives: archives.map((a) => {
          return { id: a.id, label: a.label, at: a.created_at, players: Number(a.player_count) || 0 };
        }),
      };
    }

// Multi-board: return a summary list of all boards for a user (owned and delegated).
export async function getUserBoardsList(env, uid, { query: queryImpl = query } = {}) {
  const rows = await queryImpl(
    `SELECT s.id, s.slug, s.name, s.casino, s.code, s.published, s.is_draft, s.board_order, s.theme_json,
            s.kick_channel_external_id, s.kick_channel_name,
            'owner' AS user_role, NULL AS owner_name,
            NULL::text AS owner_plan, NULL::timestamptz AS owner_plan_expires_at, NULL::text AS owner_status,
            (SELECT COUNT(*) FROM players p WHERE p.site_id = s.id) AS player_count
       FROM sites s
      WHERE s.user_id=$1
     UNION ALL
     SELECT s.id, s.slug, s.name, s.casino, s.code, s.published, s.is_draft, s.board_order, s.theme_json,
            s.kick_channel_external_id, s.kick_channel_name,
            sm.role AS user_role, u.display_name AS owner_name,
            u.plan AS owner_plan, u.plan_expires_at AS owner_plan_expires_at, u.status AS owner_status,
            (SELECT COUNT(*) FROM players p WHERE p.site_id = s.id) AS player_count
       FROM site_members sm
       JOIN sites s ON s.id = sm.site_id
       JOIN users u ON u.id = s.user_id
      WHERE sm.user_id=$1
      ORDER BY board_order ASC, id ASC`,
    [uid]
  );
  return (rows || []).filter((b) => b.user_role === "owner" || (
    b.user_role === "moderator" && effectivePlan({
      plan: b.owner_plan,
      plan_expires_at: b.owner_plan_expires_at,
      status: b.owner_status,
    }) === "team"
  )).map((b) => {
    const theme = parseTheme(b);
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      casino: b.casino || "",
      code: b.code || "",
      published: !!b.published,
      isDraft: !!b.is_draft,
      players: Number(b.player_count) || 0,
      template: theme.template,
      kickChannelExternalId: b.kick_channel_external_id || null,
      kickChannelName: b.kick_channel_name || null,
      boardOrder: b.board_order || 0,
      userRole: b.user_role || "owner",
      ownerName: b.owner_name || null,
    };
  });
}

// Multi-board: get full site data for a specific board by siteId.
export async function getUserSiteById(env, uid, siteId, plan) {
    const site = await getBoardById(env, uid, siteId);
    if (!site) return null;
    const selectedPlan = await planForSelectedSite(site, uid, plan);
    const archiveLimit = ARCHIVE_LIMITS[selectedPlan] || 6;
    // PERF-005: has_logo is now in SITE_COLUMNS — no separate query needed.
    const archives = await getArchivePlayerCounts(env, site.id, archiveLimit, HISTORY_DAYS[selectedPlan]);
  return {
    id: site.id, slug: site.slug, published: !!site.published, plan: selectedPlan,
    isDraft: !!site.is_draft,
    passwordProtected: !!site.password_hash,
    updatedAt: site.updated_at,
    publishedAt: site.published_at,
    autoReset: { enabled: !!site.auto_reset_enabled, clear: site.auto_reset_clear || "wagers" },
    data: publicShape(site, await getPlayers(env, site.id, { rankBy: site.rank_by }), archives.slice(0, archiveLimit), !!site.has_logo),
    socials: (fromJsonb(site.extra_json)?.socials) ?? DEFAULT_EXTRA.socials,
      customDomain: site.custom_domain || "",
          domainStatus: site.domain_status || "pending",
      notify: {
        discord_webhook_url: !!site.discord_webhook_url_enc,
        telegram_bot_token: false,
        telegram_chat_id: site.telegram_chat_id || "",
        telegram_notify: !!site.telegram_notify,
      },
      archives: archives.map((a) => {
        return { id: a.id, label: a.label, at: a.created_at, players: Number(a.player_count) || 0 };
      }),
    };
  }

// Multi-board: create a new board for a user.
export async function createBoard(env, uid, { slug, name, casino = "", code = "", published = false, is_draft = true, seed = false } = {}, request = null, tx = null) {
  const dbOne = tx ? (text, params) => tx.one(text, params) : one;
  const dbExec = tx ? (text, params) => tx.unsafe(text, params) : exec;
  const dbQuery = tx ? (text, params) => tx.query(text, params) : query;
  const plan = effectivePlan(await dbOne("SELECT plan, (EXTRACT(EPOCH FROM plan_expires_at) * 1000)::double precision AS plan_expires_at, status FROM users WHERE id=$1", [uid]));
  const limit = BOARD_LIMITS[plan] || 1;
  const boards = await dbQuery(`SELECT ${SITE_COLUMNS} FROM sites WHERE user_id=$1 ORDER BY id ASC`, [uid]);
  if (boards.length >= limit) {
    return { error: `Your ${plan} plan allows up to ${limit} leaderboard${limit > 1 ? "s" : ""}. Upgrade to create more.`, code: "board_limit" };
  }
  const existing = await dbOne("SELECT id FROM sites WHERE slug=$1", [slug]);
  if (existing) return { error: "That URL is already taken. Pick another.", code: "slug_taken" };
  // BIZ-004: Reject reserved slugs (api, login, dashboard, bot, etc.)
  if (RESERVED.has(slug)) return { error: "That URL is reserved and cannot be used.", code: "slug_reserved" };
  const siteId = crypto.randomUUID();
  const cleanCasino = String(casino || "").trim().slice(0, 40);
  const cleanCode = String(code || "").trim().slice(0, 40);
  const themeObj = { template: "classic" };
  await dbExec(
    "INSERT INTO sites (id,user_id,slug,name,casino,code,prize_pool,period,published,is_draft,extra_json,theme_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)",
    [siteId, uid, slug, name || slug, cleanCasino, cleanCode, "$0", "Monthly", published, is_draft, DEFAULT_EXTRA, themeObj]
  );
  // If the user has no active board, make the new one active.
  await dbExec("UPDATE users SET active_site_id=$1, updated_at=now() WHERE id=$2 AND active_site_id IS NULL", [siteId, uid]);
  if (seed) {
    const seedTx = tx || { unsafe: dbExec };
    await seedSamplePlayers(seedTx, siteId);
  }
  invalidateUserCache(env, uid);
  await logAudit({
    actorId: uid,
    action: "board_create",
    entityType: "site",
    entityId: siteId,
    request,
    details: { board_id: siteId, board_slug: slug, name: name || slug, casino: cleanCasino, code: cleanCode, published, is_draft },
  }, { exec: dbExec });
  return { ok: true, id: siteId, slug };
}

// Seed a freshly-created board with sample players so the dashboard and public page
// are never empty. Uses generic names/prizes and a short countdown.
export async function seedSamplePlayers(tx, siteId) {
  const endsAt = new Date(Date.now() + 7 * 86400000).toISOString();
  await tx.unsafe(
    "UPDATE sites SET prize_pool=$1, ends_at=$2, extra_json=jsonb_set(COALESCE(extra_json, '{}'::jsonb), '{samplePlayers}', 'true'::jsonb, true) WHERE id=$3",
    ["$500", endsAt, siteId]
  );
  const players = [
    { name: "Alex", wagered: 9500, prize: 250 },
    { name: "Bree", wagered: 7200, prize: 150 },
    { name: "Casey", wagered: 5400, prize: 100 },
    { name: "Drew", wagered: 3100, prize: 0 },
    { name: "Ellis", wagered: 1800, prize: 0 },
  ];
  const valueRows = [];
  const params = [];
  let idx = 1;
  const cols = 13;
  players.forEach((p, i) => {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(`$${idx++}`);
    valueRows.push(`(${row.join(",")})`);
    params.push(
      crypto.randomUUID(), siteId, p.name, normalizePlayerName(p.name),
      p.wagered, p.prize, i, 1, p.wagered, 0, 0, 0, 0
    );
  });
  await tx.unsafe(
    `INSERT INTO players (id, site_id, name, normalized_name, wagered, prize, sort, version, score, hands, net_profit, win_rate, change) VALUES ${valueRows.join(",")}`,
    params
  );
}

// Generate a unique slug for a duplicated board by appending -copy, -copy-2, etc.
async function uniqueSlug(env, base) {
  let candidate = slugify(`${base}-copy`);
  let counter = 2;
  while (await one("SELECT id FROM sites WHERE slug=$1", [candidate])) {
    candidate = slugify(`${base}-copy-${counter}`);
    counter++;
    if (counter > 99) {
      candidate = slugify(`${base}-copy-${crypto.randomUUID().slice(0, 8)}`);
      break;
    }
  }
  return candidate;
}

// Multi-board: duplicate an existing board (design + players) for the next sponsor.
export async function duplicateBoard(env, uid, siteId, request = null) {
  const source = await getBoardById(env, uid, siteId);
  if (!source) return { error: "no site" };
  const owner = await one("SELECT plan, (EXTRACT(EPOCH FROM plan_expires_at) * 1000)::double precision AS plan_expires_at, status FROM users WHERE id=$1", [uid]);
  const plan = effectivePlan(owner);
  const limit = BOARD_LIMITS[plan] || 1;
  const boards = await getAllBoards(env, uid);
  if (boards.length >= limit) {
    return { error: `Your ${plan} plan allows up to ${limit} leaderboard${limit > 1 ? "s" : ""}. Upgrade to create more.`, code: "board_limit" };
  }
  const newSlug = await uniqueSlug(env, source.slug);
  const newId = crypto.randomUUID();
  const players = await getPlayers(env, siteId);
  const rawTheme = fromJsonb(source.theme_json);
  const theme = (rawTheme && typeof rawTheme === "object") ? rawTheme : {};
  const rawExtra = fromJsonb(source.extra_json);
  const extra = (rawExtra && typeof rawExtra === "object") ? rawExtra : {};
  const logoRow = await one("SELECT logo_data FROM sites WHERE id=$1", [siteId]);
  const logoData = logoRow?.logo_data || "";
  const boardOrder = (source.board_order || 0) + 1;

  await withTransaction(async (tx) => {
    await tx.unsafe(
      `INSERT INTO sites (id,user_id,slug,name,tagline,casino,code,cta_url,prize_pool,period,starts_at,ends_at,rank_by,reset_note,blurb,published,is_draft,extra_json,logo_data,theme_json,board_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20::jsonb,$21)`,
      [newId, uid, newSlug, `${source.name} (copy)`.slice(0, 80), source.tagline, source.casino, source.code, source.cta_url, source.prize_pool, source.period, source.starts_at, source.ends_at, rankField(source.rank_by), source.reset_note, source.blurb, false, true, extra, logoData, theme, boardOrder]
    );
    if (players.length) {
      const valueRows = [];
      const params = [];
      let idx = 1;
      players.forEach((p, i) => {
        const row = [];
        for (let c = 0; c < 13; c++) row.push(`$${idx++}`);
        valueRows.push(`(${row.join(",")})`);
        params.push(
          crypto.randomUUID(), newId, p.name, normalizePlayerName(p.name),
          p.wagered, p.prize, i, 1, p.score, p.hands, p.net_profit, p.win_rate, p.change
        );
      });
      await tx.unsafe(
        `INSERT INTO players (id, site_id, name, normalized_name, wagered, prize, sort, version, score, hands, net_profit, win_rate, change) VALUES ${valueRows.join(",")}`,
        params
      );
    }
  });
  invalidateUserCache(env, uid);
  await logAudit({
    actorId: uid,
    action: "board_duplicate",
    entityType: "site",
    entityId: newId,
    request,
    details: { board_id: newId, board_slug: newSlug, source_site_id: siteId, source_board_slug: source.slug },
  });
  return { ok: true, id: newId, slug: newSlug };
}

export async function createArchive(env, uid, { label, clear, siteId } = {}, request = null) {
    const site = siteId ? await getBoardById(env, uid, siteId) : await getByUser(env, uid);
    if (!site) return { error: "no site" };
    
    const owner = await one("SELECT plan, (EXTRACT(EPOCH FROM plan_expires_at) * 1000)::double precision AS plan_expires_at, status FROM users WHERE id=$1", [uid]);
    const plan = effectivePlan(owner);
    const maxArchives = ARCHIVE_LIMITS[plan] || 6;
  const lab = String(label || "").trim().slice(0, 60) ||
    new Date().toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const archiveId = crypto.randomUUID();
  
  // QA-005: Atomic limit check — the count + INSERT happen in a single
  // statement so two concurrent archive-creation requests can't both pass
  // the count check and exceed the plan limit.
  let limitReached = false;
  let emptyBoard = false;
  let finalPlayers = [];
  
  await withTransaction(async (tx) => {
    // Read players inside the transaction so the snapshot and clear are consistent
    const archiveMetric = rankField(site.rank_by);
    const rows = await tx.unsafe(
      `SELECT name, wagered, prize, score, hands, net_profit, win_rate, change FROM players WHERE site_id=$1 ORDER BY ${archiveMetric} DESC, normalized_name ASC`,
      [site.id]
    );
    const players = rows || [];
    if (!players.length) {
      emptyBoard = true;
      return;
    }
    finalPlayers = players;
    
    if (maxArchives < 999) {
      const inserted = await tx.unsafe(
        `INSERT INTO archives (id,site_id,label,snapshot_json,rank_by,created_at)
         SELECT $1,$2,$3,$4::jsonb,$5,now()
           WHERE (SELECT COUNT(*) FROM archives WHERE site_id=$2) < $6
         RETURNING id`,
        [archiveId, site.id, lab, players, archiveMetric, maxArchives]
      );
      if (!inserted || inserted.length === 0) { limitReached = true; return; }
    } else {
      await tx.unsafe(
        "INSERT INTO archives (id,site_id,label,snapshot_json,rank_by,created_at) VALUES ($1,$2,$3,$4::jsonb,$5,now())",
        [archiveId, site.id, lab, players, archiveMetric]
      );
    }
    if (clear === "players") {
      await tx.unsafe("DELETE FROM players WHERE site_id=$1", [site.id]);
      await tx.unsafe("DELETE FROM player_subscriptions WHERE site_id=$1", [site.id]);
    } else if (clear === "wagers") {
      const resetMetric = rankField(site.rank_by);
      await tx.unsafe(`UPDATE players SET ${resetMetric}=0, change=0, updated_at=now() WHERE site_id=$1`, [site.id]);
    }
    await tx.unsafe("UPDATE sites SET updated_at=now() WHERE id=$1", [site.id]);
  });

  if (emptyBoard) return { error: "Nothing to archive — the board is empty." };
  if (limitReached) return { error: `Archive limit reached (${maxArchives}). Delete an old one first. Upgrade for more.` };
  void notifyLiveBoard(env, site.id);
  await logAudit({
    actorId: uid,
    action: "archive_create",
    entityType: "site",
    entityId: site.id,
    request,
    details: { board_id: site.id, board_slug: site.slug, archive_label: lab, clear: clear || null },
  });
  // Enqueue reset notification so outbound calls don't block the request.
  try {
    if (site.discord_webhook_url_enc || (site.telegram_notify && site.telegram_chat_id)) {
      const notifyQueue = createNotifyQueue(env);
      await notifyQueue.send({
        type: "notify",
        kind: "reset",
        siteId: site.id,
        siteName: site.name || site.slug,
        players: finalPlayers,
        period: lab,
      });
    }
  } catch (e) {
    console.error("[notify] reset enqueue failed:", String(e?.message || e));
  }
  return { ok: true, label: lab };
}

export async function deleteArchive(env, uid, id, siteId = null) {
  const site = siteId
    ? await getBoardById(env, uid, String(siteId))
    : await getByUser(env, uid);
  if (!site) return { error: "no site" };
  await exec("DELETE FROM archives WHERE id=$1 AND site_id=$2", [String(id || ""), site.id]);
  return { ok: true };
}

// ends_at is a timestamptz. The dashboard always sends `endsAt`, using an empty
// string when no countdown is set — and nullish coalescing keeps that "" (it only
// defaults on null/undefined), so Postgres rejects the write with 22007 "invalid
// input syntax for type timestamp with time zone". Normalise a blank value to NULL;
// a genuinely omitted field (undefined) keeps the existing stored value.
export function normalizeEndsAt(incoming, existing) {
  if (incoming === undefined) return existing ?? null;
  const trimmed = String(incoming ?? "").trim();
  return trimmed || null;
}

function isProPlan(plan) {
  return plan === "pro" || plan === "team";
}

export async function saveSite(env, user, payload, siteId, request = null) {
  const uid = typeof user === "string" ? user : user.id;
  const plan = typeof user === "object" ? effectivePlan(user) : "free";
  const site = siteId ? await getBoardById(env, uid, siteId) : await getByUser(env, uid);
  if (!site) return { error: "no site" };
  const requestedStartsAt = normalizeEndsAt(payload.startsAt, site.starts_at);
  const requestedEndsAt = normalizeEndsAt(payload.endsAt, site.ends_at);
  if (requestedStartsAt && !Number.isFinite(new Date(requestedStartsAt).getTime())) {
    return { error: "Start date must be a valid date and time.", code: "invalid_starts_at" };
  }
  if (requestedEndsAt && !Number.isFinite(new Date(requestedEndsAt).getTime())) {
    return { error: "End date must be a valid date and time.", code: "invalid_ends_at" };
  }
  if (requestedStartsAt && requestedEndsAt && new Date(requestedStartsAt) >= new Date(requestedEndsAt)) {
    return { error: "End date must be after the start date.", code: "invalid_schedule" };
  }
  // Internal / dedicated-endpoint fields are silently ignored rather than
  // rejecting the whole save: the dashboard and setup wizard round-trip fields
  // like `customDomain` (managed via /api/site/domain) straight back from the
  // load response, and a hard reject broke every save that included them.
  // `slug` is the one exception we act on — see the guarded rename below.
  // The custom domain is provisioned through its own verify/TLS endpoint.

  // Onboarding lets a streamer pick their handle after signup. Allow a validated
  // slug rename here (reserved + uniqueness checked); ignore a no-op or blank.
  let slugRename = null;
  if (payload.slug != null) {
    const next = slugify(payload.slug);
    if (next && next !== site.slug) {
      if (site.user_id !== uid) {
        return { error: "Only the site owner can rename the site URL.", code: "forbidden" };
      }
      if (RESERVED.has(next)) return { error: "That URL is reserved. Pick another.", code: "slug_reserved" };
      const taken = await one("SELECT id FROM sites WHERE slug=$1", [next]);
      if (taken && taken.id !== site.id) return { error: "That URL is already taken. Pick another.", code: "slug_taken" };
      slugRename = next;
    }
  }
  
  // Optimistic concurrency check: if client provides expected updatedAt, verify it matches
  if (payload.expectedUpdatedAt && site.updated_at) {
    const clientTime = new Date(payload.expectedUpdatedAt).getTime();
    const serverTime = new Date(site.updated_at).getTime();
    if (clientTime !== serverTime) {
      return { 
        error: "This board was modified by another session. Refresh and try again.", 
        code: "concurrency_conflict",
        currentUpdatedAt: site.updated_at 
      };
    }
  }
  
  let validatedPlayers = null;
  if (Array.isArray(payload.players)) {
    const validation = validateAndNormalizePlayers(payload.players);
    if (validation.error) return validation;
    validatedPlayers = validation.players;
  }

  // Plan gate: player count is the paid lever.
  if (typeof user === "object" && validatedPlayers) {
    let effectiveSitePlan = plan;
    if (site.user_id !== uid) {
      const owner = await one("SELECT plan, (EXTRACT(EPOCH FROM plan_expires_at) * 1000)::double precision AS plan_expires_at, status FROM users WHERE id=$1", [site.user_id]);
      if (owner) effectiveSitePlan = effectivePlan(owner);
    }
    if (validatedPlayers.length > PLAN_LIMITS[effectiveSitePlan]) {
      return {
        error: effectiveSitePlan === "pro" || effectiveSitePlan === "team"
          ? `Your plan allows up to ${PLAN_LIMITS[effectiveSitePlan]} players.`
          : `Your plan allows up to ${PLAN_LIMITS[effectiveSitePlan]} players. Upgrade for more.`,
        code: "player_limit",
      };
    }
  }
  const b = payload.brand || {};
  // Validate the referral/CTA link server-side (the client only rejects it at
  // render time via safeUrl). A non-empty value must be a valid http(s) URL.
  if (b.ctaUrl != null && String(b.ctaUrl).trim() !== "") {
    const cta = String(b.ctaUrl).trim();
    let ctaOk = false;
    try { ctaOk = /^https?:$/.test(new URL(cta).protocol); } catch { ctaOk = false; }
    if (!ctaOk) return { error: "Referral link must be a valid http:// or https:// URL.", code: "invalid_cta" };
  }
  // Keep the top-level site name in sync with brand.name (dashboard sends both).
  const siteName = String(payload.name ?? b.name ?? site.name).trim().slice(0, 80) || site.name;
  const existingExtra = fromJsonb(site.extra_json) || {};
  const notify = payload.notify || {};

  // H-25: notification credentials live in dedicated columns (and Discord URLs
  // are encrypted at rest), not inside extra_json. Strip any legacy copies so
  // they cannot leak through public-shape or future code that reads extra_json.
  const incomingSections = payload.sections && typeof payload.sections === "object" ? payload.sections : {};
  const incomingLegal = payload.legal && typeof payload.legal === "object" ? payload.legal : {};
  const existingLegal = existingExtra.legal || {};
  const legalDefaults = DEFAULT_EXTRA.legal;
  const legal = {};
  for (const k of Object.keys(legalDefaults)) {
    const v = incomingLegal[k] !== undefined ? incomingLegal[k] : existingLegal[k];
    // *Enabled flags are booleans, page bodies are strings. Preserve both
    // (the old coercion turned a saved `false` back into the default `true`).
    legal[k] = typeof v === "boolean" ? v : (typeof v === "string" ? v.trim() : (legalDefaults[k] ?? ""));
  }
  const incomingFields = payload.playerFields && typeof payload.playerFields === "object" ? payload.playerFields : {};
  const existingFields = existingExtra.playerFields || {};
  const playerFields = {};
  for (const k of Object.keys(DEFAULT_EXTRA.playerFields)) {
    const v = incomingFields[k] !== undefined ? incomingFields[k] : existingFields[k];
    playerFields[k] = !!v;
  }
  const extra = {
    chips: payload.partner?.chips ?? payload.chips ?? existingExtra.chips ?? DEFAULT_EXTRA.chips,
    whyStats: payload.whyStats ?? existingExtra.whyStats ?? DEFAULT_EXTRA.whyStats,
    rules: payload.rules ?? existingExtra.rules ?? DEFAULT_EXTRA.rules,
    socials: payload.socials ?? existingExtra.socials ?? DEFAULT_EXTRA.socials,
    sections: { ...(existingExtra.sections || DEFAULT_EXTRA.sections), ...incomingSections },
    legal,
    playerFields,
    samplePlayers: Array.isArray(payload.players) ? false : !!existingExtra.samplePlayers,
  };

  let discordWebhookUrlEnc = site.discord_webhook_url_enc;
  if (notify.discord_webhook_url !== undefined && notify.discord_webhook_url !== null) {
    const url = String(notify.discord_webhook_url).trim();
    if (url === "") {
      discordWebhookUrlEnc = null;
    } else {
      if (!DISCORD_WEBHOOK_RE.test(url)) return { error: "That doesn't look like a valid Discord webhook URL.", code: "invalid_webhook" };
      discordWebhookUrlEnc = await encrypt(url, getTokenEncKey());
    }
  }

  const telegramChatId = notify.telegram_chat_id !== undefined && notify.telegram_chat_id !== null
    ? String(notify.telegram_chat_id).trim() || null
    : site.telegram_chat_id;
  const telegramNotify = notify.telegram_notify !== undefined ? !!notify.telegram_notify : !!site.telegram_notify;

  // Site section visibility toggles (home and leaderboard are always on).
  const sectionPayload = payload.siteSections && typeof payload.siteSections === "object" ? payload.siteSections : {};
  const shopEnabled = typeof sectionPayload.shop === "boolean" ? sectionPayload.shop : !!site.shop_enabled;
  const creditsEnabled = typeof sectionPayload.credits === "boolean" ? sectionPayload.credits : !!site.credits_enabled;
  const gamesEnabled = typeof sectionPayload.games === "boolean" ? sectionPayload.games : !!site.games_enabled;

  // Auto-reset scheduler controls
  const autoReset = payload.autoReset && typeof payload.autoReset === "object" ? payload.autoReset : {};
  const autoResetEnabled = typeof autoReset.enabled === "boolean" ? autoReset.enabled : !!site.auto_reset_enabled;
  const autoResetClear = ["wagers", "players", "none"].includes(String(autoReset.clear).trim())
    ? String(autoReset.clear).trim()
    : (site.auto_reset_clear || "wagers");

  // Password-protected board. passwordProtected=false clears the hash; a non-empty password sets it.
  let passwordHash = site.password_hash;
  let passwordSalt = site.password_salt;
  if (payload.passwordProtected === false || payload.password === null || payload.password === "") {
    passwordHash = null;
    passwordSalt = null;
  } else if (typeof payload.password === "string" && payload.password.trim()) {
    const hashed = await hashPassword(payload.password.trim());
    passwordHash = hashed.hash;
    passwordSalt = hashed.salt;
  }

  // Fetch logo_data separately since the shared query no longer includes it (PERF-004).
  const existingLogoRow = await one("SELECT logo_data FROM sites WHERE id=$1", [site.id]);
  let logoData = existingLogoRow?.logo_data ?? "";
  const rawThemeObj = fromJsonb(site.theme_json);
  let themeObj = (rawThemeObj && typeof rawThemeObj === "object") ? rawThemeObj : {};
  const br = payload.branding;
  if (br && typeof user === "object" && plan !== "free") {
    if (br.logo === null) logoData = "";
    else if ((typeof br.logo === "string" && br.logo) || (br.logo && typeof br.logo === "object")) {
      const validated = validateLogoData(br.logo);
      if (validated.error) return { error: validated.error, code: "invalid_logo" };
      logoData = validated.dataUri;
    }
    const t = {};
    if (br.template && VALID_TEMPLATES.includes(br.template)) {
      t.template = br.template === "classic" ? "cyber_arcade" : br.template;
    } else if (themeObj.template) {
      t.template = themeObj.template;
    }
    if (HEX.test(br.accentA || "")) t.accentA = br.accentA;
    if (HEX.test(br.accentB || "")) t.accentB = br.accentB;
    if (FONT_KEYS.includes(br.font || "")) t.font = br.font;
    if (isProPlan(plan) && br.prizes && typeof br.prizes === "object") {
      // C-01: Use shared parsePrizes helper.
      t.prizes = parsePrizes(br.prizes);
    }
    themeObj = t;
  }
  // Legacy theme text remains stored for compatibility but is ignored by the
  // canonical public shell.
  if (br && br.text && typeof br.text === "object") {
    themeObj = { ...themeObj, text: br.text };
  }
  const themeJson = themeObj;

  // Invalidate this isolate's L1 cache before writing. There is no L2/KV, so
  // other live isolates keep stale entries until the 25s TTL expires.
  invalidateSiteCache(env, site.slug, uid, siteId);
  if (slugRename) invalidateSiteCache(env, slugRename);

  // Capture old top-3 for notifications
  const nextRankBy = rankField(payload.rankBy ?? site.rank_by);
  const oldPlayers = await getPlayers(env, site.id, { rankBy: site.rank_by });
  const oldTop3 = sortPlayersForRanking(oldPlayers, site.rank_by).slice(0, 3);
  if (validatedPlayers) {
    const closed = (requestedStartsAt && new Date(requestedStartsAt).getTime() > Date.now())
      || (requestedEndsAt && new Date(requestedEndsAt).getTime() <= Date.now());
    if (closed) {
      const comparable = (player) => JSON.stringify([
        normalizePlayerName(player.name), Number(player.wagered || 0), Number(player.prize || 0),
        Number(player.score ?? player.wagered ?? 0), Number(player.hands || 0),
        Number(player.netProfit ?? player.net_profit ?? 0), Number(player.winRate ?? player.win_rate ?? 0),
      ]);
      const before = oldPlayers.map(comparable).sort();
      const after = validatedPlayers.map(comparable).sort();
      if (before.length !== after.length || before.some((value, index) => value !== after[index])) {
        return { error: requestedStartsAt && new Date(requestedStartsAt).getTime() > Date.now()
          ? "This leaderboard has not started yet. Change the start date before updating scores."
          : "This leaderboard has ended. Change the end date or start a new race before updating scores.", code: "board_not_active" };
      }
    }
    const oldRanks = new Map(oldPlayers.map((player) => [normalizePlayerName(player.name), Number(player.rank)]));
    let previousValue = null;
    let competitionRank = 0;
    sortPlayersForRanking(validatedPlayers, nextRankBy).forEach((player, index) => {
      const value = Number(player[nextRankBy] || 0);
      if (previousValue === null || value !== previousValue) competitionRank = index + 1;
      previousValue = value;
      const oldRank = oldRanks.get(player.normalizedName);
      player.change = oldRank ? oldRank - competitionRank : 0;
    });
  }

  const txResult = await withTransaction(async (tx) => {
    // QA-004 / C-07: Lock the site row and re-read updated_at inside the same
    // transaction so the optimistic concurrency check is authoritative.
    const locked = await tx.one(
      `SELECT id, slug, name, tagline, casino, code, cta_url, prize_pool, period, starts_at, ends_at, rank_by, reset_note, blurb, extra_json, published, is_draft, theme_json, updated_at FROM sites WHERE id=$1 FOR UPDATE`,
      [site.id]
    );
    if (!locked) throw new Error("site not found");

    if (payload.expectedUpdatedAt) {
      const clientTime = new Date(payload.expectedUpdatedAt).getTime();
      const serverTime = new Date(locked.updated_at).getTime();
      if (clientTime !== serverTime) {
        return {
          error: "This board was modified by another session. Refresh and try again.",
          code: "concurrency_conflict",
          currentUpdatedAt: locked.updated_at,
        };
      }
    }

    const publishedVal = typeof payload.published === "boolean" ? payload.published : site.published;
    const isDraftVal = publishedVal ? false : (typeof payload.isDraft === "boolean" ? payload.isDraft : site.is_draft);
    const publishedAtVal = publishedVal && !site.published ? new Date().toISOString() : site.published_at;
    const startsAtVal = requestedStartsAt;
    const endsAtVal = requestedEndsAt;
    const slugVal = slugRename || site.slug;
    const periodVal = VALID_PERIODS.includes(String(b.period || "Monthly").trim())
      ? String(b.period || "Monthly").trim()
      : (site.period || "Monthly");
    await tx.unsafe(
      `UPDATE sites SET slug=$1, name=$2, tagline=$3, casino=$4, code=$5, cta_url=$6, prize_pool=$7, period=$8, starts_at=$9, ends_at=$10, rank_by=$11, reset_note=$12, blurb=$13, extra_json=$14::jsonb, logo_data=$15, theme_json=$16::jsonb, published=$17, is_draft=$18, discord_webhook_url_enc=$19, telegram_chat_id=$20, telegram_notify=$21, auto_reset_enabled=$22, auto_reset_clear=$23, password_hash=$24, password_salt=$25, published_at=$26, shop_enabled=$27, credits_enabled=$28, games_enabled=$29, updated_at=now() WHERE id=$30`,
      [
        slugVal, siteName, b.tagline ?? site.tagline, b.casino ?? site.casino, b.code ?? site.code,
        b.ctaUrl ?? site.cta_url, b.prizePool ?? site.prize_pool, periodVal,
        startsAtVal, endsAtVal, nextRankBy, b.resetNote ?? site.reset_note, (payload.partner && payload.partner.blurb) ?? site.blurb,
        extra, logoData, themeJson, publishedVal, isDraftVal, discordWebhookUrlEnc, telegramChatId, telegramNotify,
        autoResetEnabled, autoResetClear, passwordHash, passwordSalt, publishedAtVal,
        shopEnabled, creditsEnabled, gamesEnabled, site.id,
      ]
    );

    if (validatedPlayers) {
      const validPlayers = validatedPlayers;
      // C-07: delete only players whose stable normalized name is not in the
      // new payload; upsert the rest instead of replacing every row.
      if (validPlayers.length > 0) {
        const keepNames = validPlayers.map((p) => normalizePlayerName(p.name));
        await tx.unsafe("DELETE FROM players WHERE site_id=$1 AND normalized_name <> ALL($2::text[])", [site.id, keepNames]);
      } else {
        await tx.unsafe("DELETE FROM players WHERE site_id=$1", [site.id]);
      }
      if (validPlayers.length > 0) {
        const cols = 13;
        const params = [];
        const valueRows = [];
        let idx = 1;
        validPlayers.forEach((p, i) => {
          const row = [];
          for (let c = 0; c < cols; c++) row.push(`$${idx++}`);
          valueRows.push(`(${row.join(",")})`);
          params.push(
            crypto.randomUUID(), site.id, p.name, p.normalizedName,
            p.wagered, p.prize, i, 1, p.score, p.hands, p.netProfit, p.winRate, p.change
          );
        });
        await tx.unsafe(
          `INSERT INTO players (id, site_id, name, normalized_name, wagered, prize, sort, version, score, hands, net_profit, win_rate, change) VALUES ${valueRows.join(",")}
           ON CONFLICT (site_id, normalized_name) DO UPDATE
           SET name = EXCLUDED.name,
               wagered = EXCLUDED.wagered,
               prize = EXCLUDED.prize,
               sort = EXCLUDED.sort,
               score = EXCLUDED.score,
               hands = EXCLUDED.hands,
               net_profit = EXCLUDED.net_profit,
               win_rate = EXCLUDED.win_rate,
               change = EXCLUDED.change,
               updated_at = now(),
               version = players.version + 1
           RETURNING id, name, wagered, prize, sort, version, score, hands, net_profit, win_rate, change`,
          params
        );
      }
      await tx.unsafe(
        `DELETE FROM player_subscriptions ps
          WHERE ps.site_id=$1
            AND NOT EXISTS (
              SELECT 1 FROM players p
               WHERE p.site_id=ps.site_id
                 AND p.normalized_name=lower(regexp_replace(btrim(ps.player_name), '\\s+', ' ', 'g'))
            )`,
        [site.id]
      );
    }
    return { ok: true };
  });
  if (txResult.error) return txResult;

  // Detect top-3 / rank changes and enqueue notifications for the consumer to
  // deliver. This keeps outbound Telegram/Discord calls off the saveSite request
  // thread and routes player DMs through the bot_id the player subscribed to.
  if (validatedPlayers && typeof user === "object" && effectivePlan(user) !== "free") {
    try {
      const notifyQueue = createNotifyQueue(env);
      const newSorted = sortPlayersForRanking(validatedPlayers, nextRankBy);
      const top3Changes = detectTop3Changes(oldTop3, newSorted, nextRankBy);
      if (top3Changes.length) {
        await notifyQueue.send({ type: "notify", kind: "top3", siteId: site.id, siteName, changes: top3Changes });
      }

      const changedNames = getRankChangedPlayerNames(oldPlayers || [], newSorted, nextRankBy);
      if (changedNames.length) {
        const subs = await query(
          `SELECT ps.tg_user_id, ps.player_name, ps.bot_id
             FROM player_subscriptions ps
            WHERE ps.site_id = $1
              AND ps.player_name = ANY($2::text[])`,
          [site.id, changedNames]
        );
        if (subs && subs.length > 0) {
          const oldRankMap = new Map();
          (oldPlayers || []).forEach((p) => oldRankMap.set(p.name, Number(p.rank)));
          const newRankMap = new Map();
          let previousValue = null;
          let competitionRank = 0;
          newSorted.forEach((p, index) => {
            const value = Number(p[nextRankBy] || 0);
            if (previousValue === null || value !== previousValue) competitionRank = index + 1;
            previousValue = value;
            newRankMap.set(p.name, competitionRank);
          });
          const rankEvents = [];

          for (const sub of subs) {
            const playerName = sub.player_name;
            const oldRank = oldRankMap.get(playerName) ?? null;
            const newRank = newRankMap.get(playerName);
            if (!newRank) continue;
            rankEvents.push({
              type: "notify",
              kind: "player-rank",
              siteId: site.id,
              siteName,
              playerName,
              oldRank,
              newRank,
              botId: sub.bot_id,
              tgUserId: sub.tg_user_id,
            });
          }
          if (rankEvents.length) await notifyQueue.sendBatch(rankEvents);
        }
      }
    } catch (e) {
      console.error("[notify] notification enqueue failed:", String(e?.message || e));
    }
  }
  // Return updated site data including new timestamp for optimistic concurrency
  const updatedSite = await getBoardById(env, uid, site.id);
  void notifyLiveBoard(env, site.id, updatedSite?.updated_at || new Date().toISOString());
  invalidatePublicBoardCache(
    `yourrank.site/${site.slug}`,
    `yourrank.site/${site.slug}/leaderboard`,
    slugRename ? `yourrank.site/${slugRename}` : null,
    slugRename ? `yourrank.site/${slugRename}/leaderboard` : null,
    site.custom_domain ? `${site.custom_domain}/` : null,
    site.custom_domain ? `${site.custom_domain}/leaderboard` : null,
  );

  // Build a concise list of what changed for the audit log
  const changes = [];
  if (slugRename) changes.push("slug");
  if (siteName !== site.name) changes.push("name");
  if (typeof payload.published === "boolean" && payload.published !== !!site.published) changes.push(payload.published ? "publish" : "unpublish");
  if (validatedPlayers) changes.push(`players:${validatedPlayers.length}`);
  const oldTheme = rawThemeObj && typeof rawThemeObj === "object" ? rawThemeObj : {};
  if (payload.branding) {
    const hadLogo = !!existingLogoRow?.logo_data;
    const hasLogo = !!logoData;
    if (br && br.logo !== undefined && hadLogo !== hasLogo) changes.push("logo");
    if (br && br.accentA && br.accentA !== (oldTheme.accentA || "")) changes.push("accentA");
    if (br && br.accentB && br.accentB !== (oldTheme.accentB || "")) changes.push("accentB");
  }
  if (payload.startsAt !== undefined) changes.push("starts_at");
  if (payload.endsAt !== undefined) changes.push("ends_at");
  if (payload.rankBy !== undefined && nextRankBy !== rankField(site.rank_by)) changes.push("rank_by");
  if (payload.customDomain !== undefined) changes.push("custom_domain");
  if (typeof sectionPayload.shop === "boolean" && sectionPayload.shop !== !!site.shop_enabled) changes.push("shop_enabled");
  if (typeof sectionPayload.credits === "boolean" && sectionPayload.credits !== !!site.credits_enabled) changes.push("credits_enabled");
  if (typeof sectionPayload.games === "boolean" && sectionPayload.games !== !!site.games_enabled) changes.push("games_enabled");

  await logAudit({
    actorId: uid,
    action: "board_update",
    entityType: "site",
    entityId: site.id,
    request,
    details: {
      board_id: site.id,
      board_slug: slugRename || site.slug,
      slug_rename: slugRename || null,
      old_slug: slugRename ? site.slug : null,
      changes,
    },
  });

  return { ok: true, updatedAt: updatedSite?.updated_at, publishedAt: updatedSite?.published_at, slug: updatedSite?.slug || slugRename || site.slug, siteId: updatedSite?.id || site.id };
}

export async function deleteBoard(env, uid, siteId, request = null) {
  const site = await getBoardById(env, uid, siteId);
  if (!site) return { error: "no site" };
  const boards = await getAllBoards(env, uid);
  if (boards.length <= 1) {
    return { error: "You must keep at least one board. Create a new board before deleting this one.", code: "last_board" };
  }
  await withTransaction(async (tx) => {
    const fallback = boards.find((b) => b.id !== siteId)?.id || null;
    await tx.unsafe("UPDATE users SET active_site_id=$1, updated_at=now() WHERE id=$2", [fallback, uid]);
    // Manual cleanup: these tables do not have ON DELETE CASCADE FKs.
    await tx.unsafe("DELETE FROM site_stats_hourly WHERE site_id=$1", [siteId]);
    await tx.unsafe("DELETE FROM site_referrers WHERE site_id=$1", [siteId]);
    await tx.unsafe("DELETE FROM sites WHERE id=$1 AND user_id=$2", [siteId, uid]);
  });
  invalidateSiteCache(env, site.slug, uid, siteId);
  invalidateUserCache(env, uid);
  await logAudit({
    actorId: uid,
    action: "board_delete",
    entityType: "site",
    entityId: siteId,
    request,
    details: { board_id: siteId, board_slug: site.slug, remaining_boards: boards.length - 1 },
  });
  return { ok: true };
}

export async function setActiveBoard(env, uid, siteId, request = null) {
  const site = await getBoardById(env, uid, siteId);
  if (!site) return { error: "no site" };
  await exec("UPDATE users SET active_site_id=$1, updated_at=now() WHERE id=$2", [siteId, uid]);
  invalidateUserCache(env, uid);
  await logAudit({
    actorId: uid,
    action: "board_set_active",
    entityType: "site",
    entityId: siteId,
    request,
    details: { board_id: siteId, board_slug: site.slug },
  });
  return { ok: true };
}

export async function updateSiteTheme(env, user, payload = {}, request = null) {
  const site = payload.siteId
    ? await getBoardById(env, user.id, payload.siteId)
    : await getByUser(env, user.id);
  if (!site) return { error: "no site" };
  const rawTheme = fromJsonb(site.theme_json);
  const theme = (rawTheme && typeof rawTheme === "object") ? { ...rawTheme } : {};
  if (payload.template && VALID_TEMPLATES.includes(payload.template)) {
    theme.template = payload.template === "classic" ? "cyber_arcade" : payload.template;
  }
  const plan = effectivePlan(user);
  if (plan !== "free" && (payload.accentA != null || payload.accentB != null)) {
    if (!HEX.test(payload.accentA || "") || !HEX.test(payload.accentB || "")) {
      return { error: "Choose two valid accent colors.", code: "invalid_colors" };
    }
    theme.accentA = payload.accentA;
    theme.accentB = payload.accentB;
  }
  if (plan !== "free" && payload.font && FONT_KEYS.includes(payload.font)) {
    theme.font = payload.font;
  }
  if (isProPlan(plan) && payload.prizes && typeof payload.prizes === "object") {
    // C-01: Use shared parsePrizes helper.
    theme.prizes = parsePrizes(payload.prizes);
  }

  await exec(
    "UPDATE sites SET theme_json=$1::jsonb, updated_at=now() WHERE id=$2 AND user_id=$3",
    [theme, site.id, user.id]
  );
  void notifyLiveBoard(env, site.id);
  invalidateSiteCache(env, site.slug, user.id, site.id);
  invalidateUserCache(env, user.id);
  await logAudit({
    actorId: user.id,
    action: "theme_update",
    entityType: "site",
    entityId: site.id,
    request,
    details: { board_id: site.id, board_slug: site.slug, template: theme.template, accentA: theme.accentA, accentB: theme.accentB, font: theme.font },
  });
  return {
    ok: true,
    branding: {
      template: theme.template,
      accentA: HEX.test(theme.accentA || "") ? theme.accentA : null,
      accentB: HEX.test(theme.accentB || "") ? theme.accentB : null,
      font: theme.font || "Inter",
    },
  };
}

export { getByUser };
