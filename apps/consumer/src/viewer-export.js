import { query, exec } from "@yourrank/shared/db";
import { logAudit } from "@yourrank/shared/audit";

const PAGE_SIZE = 500;
const PART_SIZE = 8 * 1024 * 1024;
const EXPORT_VERSION = "viewer-export-v1";
export const VIEWER_EXPORT_TABLES = [
  "exportedAt", "viewer", "sites", "siteViewers", "creditLedger", "redemptions",
  "gameRounds", "gameSeeds", "gameSeedReveals", "kickRewardEvents",
  "viewerUsernameHistory", "viewerFeedback",
];

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
    this.parts.push(await this.upload.uploadPart(++this.partNumber, body));
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
    if (this.upload) await this.upload.abort().catch(() => {});
  }
}

async function emitPages(writer, table, sql, params, key, read, transform = (row) => row) {
  let cursor = null;
  let count = 0;
  for (;;) {
    const pageSql = cursor
      ? `SELECT * FROM (${sql}) AS export_page WHERE ${key} > $${params.length + 1} ORDER BY ${key} ASC LIMIT ${PAGE_SIZE}`
      : `SELECT * FROM (${sql}) AS export_page ORDER BY ${key} ASC LIMIT ${PAGE_SIZE}`;
    const rows = await read(pageSql, cursor ? [...params, cursor] : params);
    for (const row of rows) {
      await writer.write(JSON.stringify({ table, row: transform(row) }) + "\n");
      count++;
    }
    if (rows.length < PAGE_SIZE) return count;
    cursor = rows[rows.length - 1][key];
  }
}

async function collectIds(sql, params, read) {
  let cursor = null;
  const ids = [];
  for (;;) {
    const pageSql = cursor
      ? `SELECT * FROM (${sql}) AS export_page WHERE id > $2 ORDER BY id ASC LIMIT ${PAGE_SIZE}`
      : `SELECT * FROM (${sql}) AS export_page ORDER BY id ASC LIMIT ${PAGE_SIZE}`;
    const rows = await read(pageSql, cursor ? [...params, cursor] : params);
    ids.push(...rows.map((row) => row.id));
    if (rows.length < PAGE_SIZE) return ids;
    cursor = rows[rows.length - 1].id;
  }
}

const LEDGER_METADATA_KEYS = new Set(["redemption_id", "kick_event_id", "game_round_id", "item_name"]);
const GAME_PARAM_KEYS = {
  mines: new Set(["gridSize", "mines"]),
  plinko: new Set(["rows", "risk"]),
  dice: new Set(["target", "direction"]),
  limbo: new Set(["target"]),
};
const GAME_OUTCOME_KEYS = new Set(["roll", "win", "minePositions", "gridSize", "mines", "rows", "slot", "multiplier"]);

function allowObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => keys.has(key)));
}
function safeLedgerMetadata(value) {
  return allowObject(value, LEDGER_METADATA_KEYS);
}
function safeGameParams(value, game) {
  return allowObject(value, GAME_PARAM_KEYS[game] || new Set());
}
function safeGameOutcome(value) {
  return allowObject(value, GAME_OUTCOME_KEYS);
}
function safeViewer(row) {
  return {
    id: row.id,
    kick_user_id: row.kick_user_id ?? null,
    kick_username: row.kick_username ?? null,
    discord_user_id: row.discord_user_id ?? null,
    discord_username: row.discord_username ?? null,
    avatar_url: row.avatar_url ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
function safeGameSeed(row) {
  return {
    id: row.id,
    site_viewer_id: row.site_viewer_id,
    server_seed_hash: row.server_seed_hash,
    client_seed: row.client_seed,
    nonce: row.nonce,
    rotated_at: row.rotated_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
function safeKickRewardEvent(row) {
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    site_id: row.site_id,
    site_slug: row.site_slug,
    site_name: row.site_name,
    channel_name: row.channel_name,
    reward_id: row.reward_id,
    reward_cost: row.reward_cost,
    status: row.status,
    processed_at: row.processed_at,
    created_at: row.created_at,
  };
}
function safeViewerFeedback(row) {
  return {
    id: row.id,
    site_id: row.site_id,
    message: row.message,
    read: row.read,
    created_at: row.created_at,
  };
}

export async function processViewerExport(event, env, {
  queryImpl = query,
  execImpl = exec,
  logAuditImpl = logAudit,
} = {}) {
  const read = queryImpl;
  const write = execImpl;
  const { exportId, viewerId } = event;
  const key = `viewer-exports/${viewerId}/${exportId}.ndjson`;
  if (!env.ACCOUNT_EXPORTS) throw new Error("ACCOUNT_EXPORTS R2 binding is not configured");
  const claimed = await write(
    `UPDATE viewer_export_jobs SET status='processing', started_at=now(), error=NULL
       WHERE id=$1 AND viewer_id=$2
         AND (status='pending' OR (status='processing' AND started_at < now() - INTERVAL '15 minutes'))
         AND expires_at > now()
       RETURNING id`,
    [exportId, viewerId]
  );
  if (!claimed?.length) return;

  const writer = new NdjsonWriter(env.ACCOUNT_EXPORTS, key);
  try {
    const viewerRows = await read(
      `SELECT id, kick_user_id, kick_username, discord_user_id, discord_username,
              avatar_url, created_at, updated_at
         FROM viewers WHERE id=$1`,
      [viewerId]
    );
    const siteViewerIds = await collectIds(
      "SELECT id FROM site_viewers WHERE viewer_id=$1",
      [viewerId],
      read
    );
    const siteIds = siteViewerIds.length
      ? (await read("SELECT site_id AS id FROM site_viewers WHERE id = ANY($1)", [siteViewerIds])).map((row) => row.id)
      : [];
    const count = async (table, where, params) =>
      Number((await read(`SELECT COUNT(*)::bigint AS count FROM ${table} WHERE ${where}`, params))[0]?.count || 0);
    const membershipFilter = siteViewerIds.length ? "id = ANY($1)" : "false";
    const relationshipFilter = siteViewerIds.length ? "site_viewer_id = ANY($1)" : "false";
    const counts = {
      exportedAt: 1,
      viewer: viewerRows.length,
      sites: siteIds.length,
      siteViewers: await count("site_viewers", membershipFilter, [siteViewerIds]),
      creditLedger: await count("credit_ledger", relationshipFilter, [siteViewerIds]),
      redemptions: await count("redemptions", relationshipFilter, [siteViewerIds]),
      gameRounds: await count("game_rounds", relationshipFilter, [siteViewerIds]),
      gameSeeds: await count("game_seeds", relationshipFilter, [siteViewerIds]),
      gameSeedReveals: await count("game_seed_reveals", relationshipFilter, [siteViewerIds]),
      kickRewardEvents: viewerRows[0]?.kick_user_id ? await count("kick_reward_events", "redeemer_kick_user_id=$1", [viewerRows[0].kick_user_id]) : 0,
      viewerUsernameHistory: await count("viewer_username_history", "viewer_id=$1", [viewerId]),
      viewerFeedback: await count("viewer_feedback", "viewer_id=$1", [viewerId]),
    };
    await writer.start();
    const actualCounts = { exportedAt: 1, viewer: viewerRows.length };
    const generatedAt = new Date().toISOString();
    await writer.write(JSON.stringify({
      manifest: {
        exportId, viewerId, exportVersion: EXPORT_VERSION, generatedAt,
        tables: VIEWER_EXPORT_TABLES, rowCounts: counts,
        excluded: {
          viewer_sessions: "Authentication credentials.",
          public_token: "Site-specific bearer credential.",
          oauth_tokens: "Encrypted provider access and refresh tokens.",
          active_server_seed: "Unrevealed provably-fair game secret.",
          kick_reward_payload: "Raw provider payload may contain unrelated third-party data.",
          site_visitors: "Browser-level pseudonymous identifiers are not viewer-owned records.",
          viewer_feedback_ip_hash: "Unnecessary tracking derivative.",
          player_subscriptions: "No verified Telegram-to-viewer identity link exists.",
        },
      },
    }) + "\n");
    for (const row of viewerRows) await writer.write(JSON.stringify({ table: "viewer", row: safeViewer(row) }) + "\n");

    actualCounts.sites = await emitPages(
      writer, "sites",
      `SELECT s.id, s.slug, s.name, s.kick_channel_name AS channel_name
         FROM sites s JOIN site_viewers sv ON sv.site_id=s.id
        WHERE sv.id = ANY($1)`,
      [siteViewerIds], "id", read
    );
    actualCounts.siteViewers = await emitPages(
      writer,
      "siteViewers",
      `SELECT sv.id, sv.site_id, sv.balance, sv.total_earned, sv.total_spent,
              sv.blocked, sv.last_earned_at,
              sv.last_redeemed_at, sv.created_at, sv.updated_at
         FROM site_viewers sv WHERE sv.id = ANY($1)`,
      [siteViewerIds], "id", read,
      (row) => {
        const safe = { ...row };
        delete safe.block_reason;
        delete safe.fraud_score;
        return safe;
      }
    );
    actualCounts.creditLedger = await emitPages(
      writer,
      "creditLedger",
      `SELECT cl.id, cl.site_viewer_id, cl.type, cl.amount, cl.description,
              cl.metadata, cl.created_at
         FROM credit_ledger cl WHERE cl.site_viewer_id = ANY($1)`,
      [siteViewerIds], "id", read,
      (row) => ({ ...row, metadata: safeLedgerMetadata(row.metadata) })
    );
    actualCounts.redemptions = await emitPages(
      writer,
      "redemptions",
      `SELECT r.id, r.site_viewer_id, r.shop_item_id, r.cost, r.status,
              r.created_at, r.updated_at, i.name AS item_name, i.description AS item_description
         FROM redemptions r JOIN shop_items i ON i.id=r.shop_item_id
        WHERE r.site_viewer_id = ANY($1)`,
      [siteViewerIds], "id", read
    );
    actualCounts.gameRounds = await emitPages(
      writer,
      "gameRounds",
      `SELECT gr.id, gr.site_id, gr.site_viewer_id, gr.game, gr.bet, gr.state,
              gr.payout, gr.multiplier, gr.house_edge_bps, gr.server_seed_hash,
              gr.client_seed, gr.nonce, gr.params, gr.outcome, gr.revealed,
              gr.created_at, gr.settled_at
         FROM game_rounds gr WHERE gr.site_viewer_id = ANY($1)`,
      [siteViewerIds], "id", read,
      (row) => ({ ...row, params: safeGameParams(row.params, row.game), outcome: safeGameOutcome(row.outcome) })
    );
    actualCounts.gameSeeds = await emitPages(
      writer, "gameSeeds",
      `SELECT gs.id, gs.site_viewer_id, gs.server_seed_hash, gs.client_seed,
              gs.nonce, gs.rotated_at, gs.created_at, gs.updated_at
         FROM game_seeds gs WHERE gs.site_viewer_id = ANY($1)`,
      [siteViewerIds], "id", read, safeGameSeed
    );
    actualCounts.gameSeedReveals = await emitPages(
      writer, "gameSeedReveals",
      `SELECT gsr.id, gsr.site_viewer_id, gsr.server_seed, gsr.server_seed_hash,
              gsr.client_seed, gsr.final_nonce, gsr.revealed_at
         FROM game_seed_reveals gsr WHERE gsr.site_viewer_id = ANY($1)`,
      [siteViewerIds], "id", read
    );
    actualCounts.kickRewardEvents = await emitPages(
      writer, "kickRewardEvents",
      `SELECT kre.event_id, kre.event_type, kre.site_id, s.slug AS site_slug,
              s.name AS site_name, s.kick_channel_name AS channel_name,
              kre.reward_id, kre.reward_cost, kre.status,
              kre.processed_at, kre.created_at
         FROM kick_reward_events kre
         LEFT JOIN sites s ON s.id=kre.site_id
        WHERE kre.redeemer_kick_user_id=$1
          AND kre.site_id = ANY($2)`,
      [viewerRows[0]?.kick_user_id || "", siteIds], "event_id", read, safeKickRewardEvent
    );
    actualCounts.viewerUsernameHistory = await emitPages(
      writer, "viewerUsernameHistory",
      "SELECT id, viewer_id, username, seen_at FROM viewer_username_history WHERE viewer_id=$1",
      [viewerId], "id", read
    );
    actualCounts.viewerFeedback = await emitPages(
      writer, "viewerFeedback",
      `SELECT id, site_id, message, read, created_at
         FROM viewer_feedback WHERE viewer_id=$1`,
      [viewerId], "id", read, safeViewerFeedback
    );

    await writer.write(JSON.stringify({
      trailer: { exportId, exportVersion: EXPORT_VERSION, complete: true, rowCounts: actualCounts },
    }) + "\n");
    await writer.complete();
    const manifest = { exportId, viewerId, exportVersion: EXPORT_VERSION, generatedAt, tables: VIEWER_EXPORT_TABLES, rowCounts: counts };
    await write(
      `UPDATE viewer_export_jobs SET status='completed', artifact_key=$1, manifest=$2::jsonb, completed_at=now()
         WHERE id=$3 AND viewer_id=$4`,
      [key, manifest, exportId, viewerId]
    );
    await logAuditImpl({ actorId: viewerId, action: "viewer_export_completed", entityType: "viewer_export", entityId: exportId, details: { export_id: exportId, status: "completed" } });
  } catch (error) {
    console.error("viewer export failed:", String(error?.message || error));
    await writer.abort();
    await write(
      `UPDATE viewer_export_jobs SET status='failed', error=$1, completed_at=now()
         WHERE id=$2 AND viewer_id=$3`,
      [String(error?.message || error).slice(0, 500), exportId, viewerId]
    ).catch(() => {});
    await logAuditImpl({ actorId: viewerId, action: "viewer_export_failed", entityType: "viewer_export", entityId: exportId, details: { export_id: exportId, status: "failed" } });
  }
}
