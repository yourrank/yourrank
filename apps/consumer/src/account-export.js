import { query, exec } from "@yourrank/shared/db";
import { logAudit } from "@yourrank/shared/audit";

const PAGE_SIZE = 500;
const PART_SIZE = 8 * 1024 * 1024;
const EXPORT_VERSION = "account-export-v2";
const TABLES = [
  "exportedAt", "user", "sites", "players", "archives", "subscriptions",
  "payments", "sessions", "offers", "shortLinks", "conversions", "bots",
  "botCommands", "broadcasts", "botSubscribers", "postbackKeys",
  "featureOverrides", "onboardingEmails", "referralRewards", "auditLog",
  "adminAudit", "supportMessages", "siteStatsHourly", "siteReferrers",
  "viewers", "siteViewers", "creditLedger", "redemptions", "shopItems",
  "creditRewardMappings", "kickRewardEvents", "viewerUsernameHistory",
  "siteGameSettings", "gameSeeds", "gameSeedReveals", "gameRounds",
  "playerSubscriptions", "streamChannels", "siteVisitorStats",
  "siteScrollDepth", "siteClicks",
];

const EXCLUDED_TABLES = {
  viewer_sessions: "Bearer session tokens are authentication credentials.",
  provider_events: "Raw provider callbacks may contain third-party PII and provider-sensitive fields.",
  site_visitors: "Raw visitor hashes are pseudonymous, linkable behavioral identifiers; aggregate counts are exported instead.",
  postback_keys: "API-key verifier hashes are credential material and are not needed in a data export.",
};

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomSalt() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

function copyFields(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(value, field)) output[field] = value[field];
  }
  return output;
}

async function sanitiseLedgerMetadata(value, pseudonymise) {
  const output = copyFields(value, ["game", "nonce", "manual"]);
  if (typeof value?.game_round_id === "string") output.game_round_ref = await pseudonymise("round:", value.game_round_id);
  if (typeof value?.redemption_id === "string") output.redemption_ref = await pseudonymise("redemption:", value.redemption_id);
  return output;
}

const GAME_PARAM_FIELDS = {
  mines: ["gridSize", "mines", "houseEdgeBps"],
  plinko: ["rows", "risk", "houseEdgeBps"],
  dice: ["target", "direction", "houseEdgeBps"],
  limbo: ["target", "houseEdgeBps"],
};

const GAME_OUTCOME_FIELDS = {
  mines: ["gridSize", "mines", "minePositions"],
  plinko: ["rows", "risk", "path", "bucket"],
  dice: ["target", "direction", "roll", "rollDisplay", "win"],
  limbo: ["target", "crashPoint", "win"],
};

function sanitiseGameJson(value, game, fields) {
  return copyFields(value, fields[game] || []);
}

async function createPseudonymiser(salt = randomSalt()) {
  const encoder = new TextEncoder();
  const cache = new Map();
  return async (namespace, value) => {
    const cacheKey = `${namespace}${value}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const encoded = encoder.encode(cacheKey);
    const input = new Uint8Array(salt.byteLength + encoded.byteLength);
    input.set(salt);
    input.set(encoded, salt.byteLength);
    const digest = await crypto.subtle.digest("SHA-256", input);
    const result = `p_${hex(new Uint8Array(digest))}`;
    cache.set(cacheKey, result);
    return result;
  };
}

class NdjsonWriter {
  constructor(bucket, key) {
    this.bucket = bucket;
    this.key = key;
    this.encoder = new TextEncoder();
    this.buffers = [];
    this.bytes = 0;
    this.parts = [];
    this.partNumber = 0;
    this.upload = null;
  }

  async start() {
    this.upload = await this.bucket.createMultipartUpload(this.key, {
      httpMetadata: { contentType: "application/x-ndjson; charset=utf-8" },
    });
  }

  async flush() {
    if (!this.bytes) return;
    const body = new Uint8Array(this.bytes);
    let offset = 0;
    for (const buffer of this.buffers) {
      body.set(buffer, offset);
      offset += buffer.byteLength;
    }
    const uploaded = await this.upload.uploadPart(++this.partNumber, body);
    this.parts.push(uploaded);
    this.buffers = [];
    this.bytes = 0;
  }

  async write(line) {
    const bytes = this.encoder.encode(line);
    for (let offset = 0; offset < bytes.byteLength;) {
      const length = Math.min(PART_SIZE - this.bytes, bytes.byteLength - offset);
      this.buffers.push(bytes.subarray(offset, offset + length));
      this.bytes += length;
      offset += length;
      if (this.bytes === PART_SIZE) await this.flush();
    }
  }

  async complete() {
    await this.flush();
    await this.upload.complete(this.parts);
  }

  async abort() {
    if (!this.upload) return;
    await this.upload.abort().catch(() => {});
  }
}

async function emitPages(writer, table, sql, params, key = "id", read = query, transform = (row) => row) {
  let cursor = null;
  let count = 0;
  for (;;) {
    const pageSql = cursor
      ? `SELECT * FROM (${sql}) AS export_page WHERE ${key} > $${params.length + 1} ORDER BY ${key} ASC LIMIT ${PAGE_SIZE}`
      : `SELECT * FROM (${sql}) AS export_page ORDER BY ${key} ASC LIMIT ${PAGE_SIZE}`;
    const rows = await read(pageSql, cursor ? [...params, cursor] : params);
    for (const row of rows) {
      const artifactRow = await transform(row);
      await writer.write(JSON.stringify({ table, row: artifactRow }) + "\n");
      count++;
    }
    if (rows.length < PAGE_SIZE) return count;
    cursor = rows[rows.length - 1][key];
  }
}

async function emitTuplePages(writer, table, sql, params, keys, read = query) {
  let cursor = null;
  let count = 0;
  for (;;) {
    const pageSql = cursor
      ? `SELECT * FROM (${sql}) AS export_page WHERE (${keys.join(", ")}) > (${keys.map((_, i) => `$${params.length + i + 1}`).join(", ")}) ORDER BY ${keys.join(", ")} ASC LIMIT ${PAGE_SIZE}`
      : `SELECT * FROM (${sql}) AS export_page ORDER BY ${keys.join(", ")} ASC LIMIT ${PAGE_SIZE}`;
    const rows = await read(pageSql, cursor ? [...params, ...cursor] : params);
    for (const row of rows) {
      await writer.write(JSON.stringify({ table, row }) + "\n");
      count++;
    }
    if (rows.length < PAGE_SIZE) return count;
    cursor = keys.map((key) => rows[rows.length - 1][key]);
  }
}

async function collectIds(sql, params, key = "id", read = query) {
  const ids = [];
  let cursor = null;
  for (;;) {
    const pageSql = cursor
      ? `SELECT * FROM (${sql}) AS export_page WHERE ${key} > $${params.length + 1} ORDER BY ${key} ASC LIMIT ${PAGE_SIZE}`
      : `SELECT * FROM (${sql}) AS export_page ORDER BY ${key} ASC LIMIT ${PAGE_SIZE}`;
    const rows = await read(pageSql, cursor ? [...params, cursor] : params);
    ids.push(...rows.map((row) => row[key]));
    if (rows.length < PAGE_SIZE) return ids;
    cursor = rows[rows.length - 1][key];
  }
}

export async function processAccountExport(event, env, {
  queryImpl = query,
  execImpl = exec,
  logAuditImpl = logAudit,
} = {}) {
  const read = queryImpl;
  const write = execImpl;
  const { exportId, userId } = event;
  const key = `account-exports/${userId}/${exportId}.ndjson`;
  if (!env.ACCOUNT_EXPORTS) throw new Error("ACCOUNT_EXPORTS R2 binding is not configured");

  const claimed = await write(
    `UPDATE account_export_jobs SET status='processing', started_at=now(), error=NULL
       WHERE id=$1 AND user_id=$2
         AND (status='pending' OR (status='processing' AND started_at < now() - INTERVAL '15 minutes'))
         AND expires_at > now()
       RETURNING id`,
    [exportId, userId]
  );
  if (!claimed?.length) return;

  const writer = new NdjsonWriter(env.ACCOUNT_EXPORTS, key);
  try {
    const pseudonymise = await createPseudonymiser();
    const userCols = `id, email, display_name, telegram_user_id, telegram_username,
      telegram_linked_at, plan, plan_expires_at, status, is_admin, email_verified,
      created_at, updated_at, has_trial, failed_login_count, locked_until`;
    const userRows = await read(`SELECT ${userCols} FROM users WHERE id=$1`, [userId]);
    const siteIds = await collectIds("SELECT id FROM sites WHERE user_id=$1", [userId], "id", read);
    const offerIds = await collectIds("SELECT id FROM offers WHERE owner_id=$1", [userId], "id", read);
    const botIds = await collectIds("SELECT id FROM bots WHERE owner_id=$1", [userId], "id", read);
    const count = async (table, where, params) => Number((await read(`SELECT COUNT(*)::bigint AS count FROM ${table} WHERE ${where}`, params))[0]?.count || 0);
    const siteFilter = siteIds.length ? "site_id = ANY($1)" : "false";
    const countQuery = async (sql, params) => Number((await read(sql, params))[0]?.count || 0);
    const counts = {
      exportedAt: 1,
      user: userRows.length,
      sites: siteIds.length,
      players: await count("players", siteFilter, [siteIds]),
      archives: await count("archives", siteFilter, [siteIds]),
      subscriptions: await count("subscriptions", "user_id=$1", [userId]),
      payments: await count("payments", "user_id=$1", [userId]),
      sessions: await count("sessions", "user_id=$1", [userId]),
      offers: offerIds.length,
      shortLinks: offerIds.length ? await count("short_links", "offer_id = ANY($1)", [offerIds]) : 0,
      conversions: await count("conversions", "owner_id=$1", [userId]),
      bots: botIds.length,
      botCommands: botIds.length ? await count("bot_commands", "bot_id = ANY($1)", [botIds]) : 0,
      broadcasts: botIds.length ? await count("broadcasts", "bot_id = ANY($1)", [botIds]) : 0,
      botSubscribers: botIds.length ? await count("bot_subscribers", "bot_id = ANY($1)", [botIds]) : 0,
      postbackKeys: await count("postback_keys", "user_id=$1", [userId]),
      featureOverrides: await count("user_feature_overrides", "user_id=$1", [userId]),
      onboardingEmails: await count("user_onboarding_emails", "user_id=$1", [userId]),
      referralRewards: await count("referral_rewards", "(referrer_id=$1 OR referred_id=$1)", [userId]),
      auditLog: await count("audit_log", "actor_id=$1", [userId]),
      adminAudit: await count("admin_audit", "(admin_id=$1 OR target_user_id=$1)", [userId]),
      supportMessages: await count("support_messages", "user_id=$1", [userId]),
      siteStatsHourly: siteIds.length ? await count("site_stats_hourly", "site_id = ANY($1)", [siteIds]) : 0,
      siteReferrers: siteIds.length ? await count("site_referrers", "site_id = ANY($1)", [siteIds]) : 0,
      viewers: siteIds.length ? await countQuery("SELECT COUNT(DISTINCT v.id)::bigint AS count FROM viewers v JOIN site_viewers sv ON sv.viewer_id=v.id WHERE sv.site_id = ANY($1)", [siteIds]) : 0,
      siteViewers: siteIds.length ? await count("site_viewers", siteFilter, [siteIds]) : 0,
      creditLedger: siteIds.length ? await countQuery("SELECT COUNT(*)::bigint AS count FROM credit_ledger cl JOIN site_viewers sv ON sv.id=cl.site_viewer_id WHERE sv.site_id = ANY($1)", [siteIds]) : 0,
      redemptions: siteIds.length ? await countQuery("SELECT COUNT(*)::bigint AS count FROM redemptions r JOIN site_viewers sv ON sv.id=r.site_viewer_id WHERE sv.site_id = ANY($1)", [siteIds]) : 0,
      shopItems: siteIds.length ? await count("shop_items", siteFilter, [siteIds]) : 0,
      creditRewardMappings: siteIds.length ? await count("credit_reward_mappings", siteFilter, [siteIds]) : 0,
      kickRewardEvents: siteIds.length ? await count("kick_reward_events", siteFilter, [siteIds]) : 0,
      viewerUsernameHistory: siteIds.length ? await countQuery("SELECT COUNT(*)::bigint AS count FROM viewer_username_history h JOIN site_viewers sv ON sv.viewer_id=h.viewer_id WHERE sv.site_id = ANY($1)", [siteIds]) : 0,
      siteGameSettings: siteIds.length ? await count("site_game_settings", siteFilter, [siteIds]) : 0,
      gameSeeds: siteIds.length ? await countQuery("SELECT COUNT(*)::bigint AS count FROM game_seeds gs JOIN site_viewers sv ON sv.id=gs.site_viewer_id WHERE sv.site_id = ANY($1)", [siteIds]) : 0,
      gameSeedReveals: siteIds.length ? await countQuery("SELECT COUNT(*)::bigint AS count FROM game_seed_reveals gsr JOIN site_viewers sv ON sv.id=gsr.site_viewer_id WHERE sv.site_id = ANY($1)", [siteIds]) : 0,
      gameRounds: siteIds.length ? await countQuery("SELECT COUNT(*)::bigint AS count FROM game_rounds gr JOIN site_viewers sv ON sv.id=gr.site_viewer_id WHERE sv.site_id = ANY($1)", [siteIds]) : 0,
      playerSubscriptions: siteIds.length ? await count("player_subscriptions", siteFilter, [siteIds]) : 0,
      streamChannels: await count("stream_channels", "owner_id=$1", [userId]),
      siteVisitorStats: siteIds.length ? siteIds.length : 0,
      siteScrollDepth: siteIds.length ? await count("site_scroll_depth", siteFilter, [siteIds]) : 0,
      siteClicks: siteIds.length ? await count("site_clicks", siteFilter, [siteIds]) : 0,
    };
    await writer.start();
    const actualCounts = { exportedAt: 1, user: userRows.length };
    await writer.write(JSON.stringify({
      manifest: {
        exportId, userId, exportVersion: EXPORT_VERSION,
        generatedAt: new Date().toISOString(), tables: TABLES, excludedTables: EXCLUDED_TABLES, rowCounts: counts,
      },
    }) + "\n");
    for (const row of userRows) await writer.write(JSON.stringify({ table: "user", row }) + "\n");
    actualCounts.sites = await emitPages(writer, "sites", `SELECT id, slug, name, tagline, casino, code, cta_url, prize_pool, period, ends_at,
      reset_note, blurb, extra_json, published, theme_json, updated_at, custom_domain,
      domain_status, suspended, telegram_chat_id, telegram_notify
      FROM sites WHERE user_id=$1`, [userId], "id", read);

    actualCounts.players = await emitPages(writer, "players", "SELECT id, site_id, name, normalized_name, wagered, prize, sort, updated_at, version, score, hands, net_profit, win_rate, change FROM players WHERE " + siteFilter, [siteIds], "id", read);
    actualCounts.archives = await emitPages(writer, "archives", "SELECT id, site_id, label, snapshot_json, top3_json, winner_name, created_at FROM archives WHERE " + siteFilter, [siteIds], "id", read);

    /** @type {Array<[string, string, string, ((row: any) => any)?]>} */
    const accountSpecs = [
      ["subscriptions", "SELECT id, plan, status, provider, current_period_end, created_at FROM subscriptions WHERE user_id=$1", "id"],
      ["payments", "SELECT id, subscription_id, provider, invoice_id, amount, currency, tx_ref, status, created_at, updated_at, plan_tier FROM payments WHERE user_id=$1", "id"],
      ["sessions", "SELECT token, created_at, expires_at, twofa_verified FROM sessions WHERE user_id=$1", "token",
        ({ token: _token, ...row }) => row],
      ["offers", "SELECT id, casino_id, label, referral_url, promo_code, bonus_text, priority, is_active, created_at, updated_at FROM offers WHERE owner_id=$1", "id"],
      ["conversions", "SELECT id, offer_id, click_ref, event, amount, currency, raw, ts FROM conversions WHERE owner_id=$1", "id"],
      ["bots", "SELECT id, tg_bot_id, username, token_hint, status, welcome_message, created_at, updated_at FROM bots WHERE owner_id=$1", "id"],
      ["postbackKeys", "SELECT id, label, created_at, revoked_at, expires_at, last_used_at FROM postback_keys WHERE user_id=$1", "id"],
      ["featureOverrides", "SELECT feature_key, enabled, created_at, updated_at FROM user_feature_overrides WHERE user_id=$1", "feature_key"],
      ["onboardingEmails", "SELECT id, day, sent_at FROM user_onboarding_emails WHERE user_id=$1", "id"],
      ["referralRewards", "SELECT id, referrer_id, referred_id, reward_days, created_at FROM referral_rewards WHERE referrer_id=$1 OR referred_id=$1", "id"],
      ["auditLog", "SELECT id, action, entity_type, entity_id, details, ip_address, user_agent, created_at FROM audit_log WHERE actor_id=$1", "id"],
      ["adminAudit", "SELECT id, admin_id, target_user_id, action, details, ip_address, user_agent, created_at FROM admin_audit WHERE admin_id=$1 OR target_user_id=$1", "id"],
      ["supportMessages", "SELECT id, name, email, subject, message, status, ip_hash, created_at, updated_at FROM support_messages WHERE user_id=$1", "id"],
    ];
    for (const [table, sql, key, transform] of accountSpecs) actualCounts[table] = await emitPages(writer, table, sql, [userId], key, read, transform || ((row) => row));

    actualCounts.shortLinks = offerIds.length
      ? await emitPages(writer, "shortLinks", "SELECT sl.id, sl.offer_id, sl.slug, sl.source, sl.created_at FROM short_links sl WHERE sl.offer_id = ANY($1)", [offerIds], "id", read)
      : 0;
    actualCounts.botCommands = 0;
    actualCounts.broadcasts = 0;
    actualCounts.botSubscribers = 0;
    if (botIds.length) {
      actualCounts.botCommands = await emitPages(writer, "botCommands", "SELECT id, bot_id, command, response, offer_id, is_enabled FROM bot_commands WHERE bot_id = ANY($1)", [botIds], "id", read);
      actualCounts.broadcasts = await emitPages(writer, "broadcasts", "SELECT id, bot_id, status, body, media_url, buttons, scheduled_at, sent_at, total_count, sent_count, fail_count, segment, created_at FROM broadcasts WHERE bot_id = ANY($1)", [botIds], "id", read);
      actualCounts.botSubscribers = await emitPages(writer, "botSubscribers", "SELECT id, bot_id, tg_user_id, tg_username, first_name, language, is_blocked, first_seen, last_seen FROM bot_subscribers WHERE bot_id = ANY($1)", [botIds], "id", read);
    }
    actualCounts.siteStatsHourly = 0;
    actualCounts.siteReferrers = 0;
    if (siteIds.length) {
      actualCounts.siteStatsHourly = await emitTuplePages(writer, "siteStatsHourly", "SELECT site_id, day, hour, day_of_week, views FROM site_stats_hourly WHERE site_id = ANY($1)", [siteIds], ["site_id", "day", "hour"], read);
      actualCounts.siteReferrers = await emitTuplePages(writer, "siteReferrers", "SELECT site_id, day, domain, count FROM site_referrers WHERE site_id = ANY($1)", [siteIds], ["site_id", "day", "domain"], read);
    }
    actualCounts.viewers = siteIds.length
      ? await emitPages(writer, "viewers", "SELECT v.id, v.created_at, v.updated_at, (v.kick_user_id IS NOT NULL) AS has_kick_identity, (v.discord_user_id IS NOT NULL) AS has_discord_identity, (v.telegram_user_id IS NOT NULL) AS has_telegram_identity FROM viewers v JOIN site_viewers sv ON sv.viewer_id=v.id WHERE sv.site_id = ANY($1) GROUP BY v.id", [siteIds], "id", read,
        async (row) => ({
          viewer_ref: await pseudonymise("viewer:", row.id),
          has_kick_identity: row.has_kick_identity,
          has_discord_identity: row.has_discord_identity,
          has_telegram_identity: row.has_telegram_identity,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }))
      : 0;
    actualCounts.siteViewers = siteIds.length
      ? await emitPages(writer, "siteViewers", "SELECT id, site_id, viewer_id, balance, total_earned, total_spent, blocked, block_reason, fraud_score, last_earned_at, last_redeemed_at, created_at, updated_at FROM site_viewers WHERE site_id = ANY($1)", [siteIds], "id", read,
        async (row) => ({
          site_viewer_ref: await pseudonymise("site-viewer:", row.id),
          viewer_ref: await pseudonymise("viewer:", row.viewer_id),
          site_id: row.site_id,
          balance: row.balance,
          total_earned: row.total_earned,
          total_spent: row.total_spent,
          blocked: row.blocked,
          block_reason: row.block_reason,
          fraud_score: row.fraud_score,
          last_earned_at: row.last_earned_at,
          last_redeemed_at: row.last_redeemed_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }))
      : 0;
    actualCounts.creditLedger = siteIds.length
      ? await emitPages(writer, "creditLedger", "SELECT cl.id, cl.site_viewer_id, cl.type, cl.amount, cl.description, cl.metadata, cl.created_at FROM credit_ledger cl JOIN site_viewers sv ON sv.id=cl.site_viewer_id WHERE sv.site_id = ANY($1)", [siteIds], "id", read,
        async (row) => ({
          ledger_ref: await pseudonymise("ledger:", row.id),
          site_viewer_ref: await pseudonymise("site-viewer:", row.site_viewer_id),
          type: row.type,
          amount: row.amount,
          description: row.description,
          metadata: await sanitiseLedgerMetadata(row.metadata, pseudonymise),
          created_at: row.created_at,
        }))
      : 0;
    actualCounts.redemptions = siteIds.length
      ? await emitPages(writer, "redemptions", "SELECT r.id, r.site_viewer_id, r.shop_item_id, r.cost, r.status, r.created_at, r.updated_at FROM redemptions r JOIN site_viewers sv ON sv.id=r.site_viewer_id WHERE sv.site_id = ANY($1)", [siteIds], "id", read,
        async (row) => ({
          redemption_ref: await pseudonymise("redemption:", row.id),
          site_viewer_ref: await pseudonymise("site-viewer:", row.site_viewer_id),
          shop_item_id: row.shop_item_id,
          cost: row.cost,
          status: row.status,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }))
      : 0;
    actualCounts.shopItems = siteIds.length
      ? await emitPages(writer, "shopItems", "SELECT id, site_id, name, description, cost, stock, active, created_at, updated_at FROM shop_items WHERE site_id = ANY($1)", [siteIds], "id", read)
      : 0;
    actualCounts.creditRewardMappings = siteIds.length
      ? await emitPages(writer, "creditRewardMappings", "SELECT id, site_id, kick_reward_id, kick_reward_title, kick_reward_cost, credits, active, created_at, updated_at FROM credit_reward_mappings WHERE site_id = ANY($1)", [siteIds], "id", read)
      : 0;
    actualCounts.kickRewardEvents = siteIds.length
      ? await emitPages(writer, "kickRewardEvents", "SELECT kre.event_id, kre.event_type, kre.site_id, kre.reward_id, kre.redeemer_kick_user_id, kre.reward_cost, kre.status, kre.processed_at, kre.created_at, v.id AS viewer_id FROM kick_reward_events kre LEFT JOIN viewers v ON v.kick_user_id=kre.redeemer_kick_user_id WHERE kre.site_id = ANY($1)", [siteIds], "event_id", read,
        async (row) => ({
          event_ref: await pseudonymise("kick-event:", row.event_id),
          event_type: row.event_type,
          site_id: row.site_id,
          reward_id: row.reward_id,
          viewer_ref: row.viewer_id
            ? await pseudonymise("viewer:", row.viewer_id)
            : row.redeemer_kick_user_id ? await pseudonymise("kick-viewer:", row.redeemer_kick_user_id) : null,
          reward_cost: row.reward_cost,
          status: row.status,
          processed_at: row.processed_at,
          created_at: row.created_at,
        }))
      : 0;
    actualCounts.viewerUsernameHistory = siteIds.length
      ? await emitPages(writer, "viewerUsernameHistory", "SELECT h.id, h.viewer_id, h.username, h.seen_at FROM viewer_username_history h JOIN site_viewers sv ON sv.viewer_id=h.viewer_id WHERE sv.site_id = ANY($1)", [siteIds], "id", read,
        async (row) => ({
          history_ref: await pseudonymise("username-history:", row.id),
          viewer_ref: await pseudonymise("viewer:", row.viewer_id),
          username_ref: await pseudonymise("viewer-username:", row.username),
          seen_at: row.seen_at,
        }))
      : 0;
    actualCounts.siteGameSettings = siteIds.length
      ? await emitPages(writer, "siteGameSettings", "SELECT id, site_id, game, enabled, min_bet, max_bet, house_edge_bps, daily_loss_cap, created_at, updated_at FROM site_game_settings WHERE site_id = ANY($1)", [siteIds], "id", read)
      : 0;
    actualCounts.gameSeeds = siteIds.length
      ? await emitPages(writer, "gameSeeds", "SELECT gs.id, gs.site_viewer_id, sv.viewer_id, gs.server_seed_hash, gs.client_seed, gs.nonce, gs.rotated_at, gs.created_at, gs.updated_at FROM game_seeds gs JOIN site_viewers sv ON sv.id=gs.site_viewer_id WHERE sv.site_id = ANY($1)", [siteIds], "id", read,
        async (row) => ({
          seed_ref: await pseudonymise("seed:", row.id),
          site_viewer_ref: await pseudonymise("site-viewer:", row.site_viewer_id),
          viewer_ref: await pseudonymise("viewer:", row.viewer_id),
          server_seed_hash: row.server_seed_hash,
          client_seed: row.client_seed,
          nonce: row.nonce,
          rotated_at: row.rotated_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }))
      : 0;
    actualCounts.gameSeedReveals = siteIds.length
      ? await emitPages(writer, "gameSeedReveals", "SELECT gsr.id, gsr.site_viewer_id, sv.viewer_id, gsr.server_seed, gsr.server_seed_hash, gsr.client_seed, gsr.final_nonce, gsr.revealed_at FROM game_seed_reveals gsr JOIN site_viewers sv ON sv.id=gsr.site_viewer_id WHERE sv.site_id = ANY($1)", [siteIds], "id", read,
        async (row) => ({
          reveal_ref: await pseudonymise("seed-reveal:", row.id),
          site_viewer_ref: await pseudonymise("site-viewer:", row.site_viewer_id),
          viewer_ref: await pseudonymise("viewer:", row.viewer_id),
          server_seed: row.server_seed,
          server_seed_hash: row.server_seed_hash,
          client_seed: row.client_seed,
          final_nonce: row.final_nonce,
          revealed_at: row.revealed_at,
        }))
      : 0;
    actualCounts.gameRounds = siteIds.length
      ? await emitPages(writer, "gameRounds", "SELECT gr.id, gr.site_id, gr.site_viewer_id, sv.viewer_id, gr.game, gr.bet, gr.state, gr.payout, gr.multiplier, gr.house_edge_bps, gr.server_seed_hash, gr.client_seed, gr.nonce, gr.params, gr.outcome, gr.revealed, gr.created_at, gr.settled_at FROM game_rounds gr JOIN site_viewers sv ON sv.id=gr.site_viewer_id WHERE sv.site_id = ANY($1)", [siteIds], "id", read,
        async (row) => ({
          round_ref: await pseudonymise("round:", row.id),
          site_id: row.site_id,
          site_viewer_ref: await pseudonymise("site-viewer:", row.site_viewer_id),
          viewer_ref: await pseudonymise("viewer:", row.viewer_id),
          game: row.game,
          bet: row.bet,
          state: row.state,
          payout: row.payout,
          multiplier: row.multiplier,
          house_edge_bps: row.house_edge_bps,
          server_seed_hash: row.server_seed_hash,
          client_seed: row.client_seed,
          nonce: row.nonce,
          params: sanitiseGameJson(row.params, row.game, GAME_PARAM_FIELDS),
          outcome: sanitiseGameJson(row.outcome, row.game, GAME_OUTCOME_FIELDS),
          revealed: Array.isArray(row.revealed) ? row.revealed.filter(Number.isInteger) : [],
          created_at: row.created_at,
          settled_at: row.settled_at,
        }))
      : 0;
    actualCounts.playerSubscriptions = siteIds.length
      ? await emitPages(writer, "playerSubscriptions", "SELECT id, site_id, bot_id, tg_user_id, player_name, created_at FROM player_subscriptions WHERE site_id = ANY($1)", [siteIds], "id", read,
        async (row) => ({
          subscription_ref: await pseudonymise("subscription:", row.id),
          site_id: row.site_id,
          bot_id: row.bot_id,
          viewer_ref: await pseudonymise("telegram-viewer:", String(row.tg_user_id)),
          has_player_name: Boolean(row.player_name),
          created_at: row.created_at,
        }))
      : 0;
    actualCounts.streamChannels = await emitPages(writer, "streamChannels", "SELECT id, platform, channel_name, external_id, is_live, last_live_at, auto_post_bot_id, live_template FROM stream_channels WHERE owner_id=$1", [userId], "id", read);
    actualCounts.siteVisitorStats = siteIds.length
      ? await emitPages(writer, "siteVisitorStats", "SELECT site_id, COUNT(*)::bigint AS visitor_count, MIN(first_seen) AS first_seen, MAX(last_seen) AS last_seen, COALESCE(SUM(sessions), 0)::bigint AS sessions FROM site_visitors WHERE site_id = ANY($1) GROUP BY site_id", [siteIds], "site_id", read)
      : 0;
    actualCounts.siteScrollDepth = siteIds.length
      ? await emitTuplePages(writer, "siteScrollDepth", "SELECT site_id, day, bucket, count FROM site_scroll_depth WHERE site_id = ANY($1)", [siteIds], ["site_id", "day", "bucket"], read)
      : 0;
    actualCounts.siteClicks = siteIds.length
      ? await emitPages(writer, "siteClicks", "SELECT click_ref, site_id, cta_url, converted_at, created_at FROM site_clicks WHERE site_id = ANY($1)", [siteIds], "click_ref", read)
      : 0;

    await writer.write(JSON.stringify({
      trailer: {
        exportId, exportVersion: EXPORT_VERSION, complete: true, rowCounts: actualCounts,
      },
    }) + "\n");
    await writer.complete();
    const manifest = { exportId, userId, exportVersion: EXPORT_VERSION, generatedAt: new Date().toISOString(), tables: TABLES, excludedTables: EXCLUDED_TABLES, rowCounts: counts };
    await write(
      `UPDATE account_export_jobs SET status='completed', artifact_key=$1, manifest=$2::jsonb, completed_at=now()
         WHERE id=$3 AND user_id=$4`,
      [key, manifest, exportId, userId]
    );
    await logAuditImpl({ actorId: userId, action: "account_export_completed", entityType: "account_export", entityId: exportId, details: { export_id: exportId, status: "completed" } });
  } catch (error) {
    console.error("account export failed:", String(error?.message || error));
    await writer.abort();
    await write(
      `UPDATE account_export_jobs SET status='failed', error=$1, completed_at=now()
         WHERE id=$2 AND user_id=$3`,
      [String(error?.message || error).slice(0, 500), exportId, userId]
    ).catch(() => {});
    await logAuditImpl({ actorId: userId, action: "account_export_failed", entityType: "account_export", entityId: exportId, details: { export_id: exportId, status: "failed" } });
  }
}
