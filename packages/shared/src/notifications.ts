// ============================================================================
//  YourRank — SHARED NOTIFICATION HELPERS (TypeScript)
//
//  Consolidated notification utilities used by BOTH Workers:
//    * Discord webhook sending
//    * Telegram bot message sending
//    * Top-3 change detection
//    * Notification firing logic
//
//  Moves Telegram-send logic from leaderboard Worker to shared module.
//  Telegram delivery is conceptually the bot Worker's domain, but this shared
//  module allows both Workers to send notifications consistently.
// ============================================================================

import { decryptToken, decryptCredential } from "./crypto.js";
import { errMessage } from "./errors.js";

// ----------------------------------------------------------------------------
// Telegram Markdown escaping
// ----------------------------------------------------------------------------

const TG_MD_RESERVED = /([_*[\]()~`>#+\-=|{}.!\\])/g;

/** Escape a string for Telegram Markdown message content. */
export function escapeTgMarkdown(text: string | number | null | undefined): string {
  return String(text ?? "").replace(TG_MD_RESERVED, "\\$1");
}

// ----------------------------------------------------------------------------
// Discord webhook helpers
// ----------------------------------------------------------------------------

/**
 * Send a Discord webhook with an embed payload.
 * @param webhookUrl — full Discord webhook URL
 * @param embed — Discord embed object
 * @returns {{ ok: boolean, error?: string }}
 */
export async function sendDiscordWebhook(
  webhookUrl: string,
  embed: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  if (!webhookUrl) return { ok: false, error: "No webhook URL" };
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        username: "YourRank",
        avatar_url: (typeof process !== "undefined" && process.env.PUBLIC_BASE_URL || "https://yourrank.site") + "/favicon.ico",
        embeds: [embed],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Discord ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

/**
 * Build a Discord embed for a leaderboard reset event.
 */
export function buildResetEmbed(
  siteName: string,
  players: Array<{ name: string; wagered: number; prize?: number }>,
  period: string
): Record<string, unknown> {
  const top3 = players.slice(0, 3);
  const fields = top3.map((p, i) => {
    const medal = ["🥇", "🥈", "🥉"][i];
    return {
      name: `${medal} #${i + 1} — ${p.name}`,
      value: `$${Number(p.wagered).toLocaleString("en-US", { maximumFractionDigits: 0 })}${p.prize ? ` (prize: $${Number(p.prize).toLocaleString()})` : ""}`,
      inline: false,
    };
  });
  return {
    title: `🔄 ${siteName} — Leaderboard Reset!`,
    description: `The ${period || "current"} period has ended. Here are the final standings:`,
    color: 0xc8ff00, // YourRank accent green
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: "YourRank" },
  };
}

/**
 * Build a Discord embed for a top-3 rank change event.
 */
export function buildTop3Embed(
  siteName: string,
  playerName: string,
  rank: number,
  wagered: number,
  metricLabel = "Wagered",
  metricValue: number = wagered
): Record<string, unknown> {
  const medal = ["🥇", "🥈", "🥉"][rank - 1] || "🏆";
  return {
    title: `${medal} ${playerName} just entered Top 3!`,
    description: `**${siteName}** leaderboard update`,
    color: 0xffcb45, // gold
    fields: [
      { name: "New Rank", value: `#${rank}`, inline: true },
      { name: metricLabel, value: metricLabel === "Points" ? `${Number(metricValue).toLocaleString("en-US")} pts` : `$${Number(metricValue).toLocaleString("en-US", { maximumFractionDigits: 0 })}`, inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: "YourRank" },
  };
}

/**
 * Build a Discord embed for a reward claim event.
 */
export function buildRedemptionEmbed(
  siteName: string,
  viewerName: string,
  itemName: string,
  cost: number
): Record<string, unknown> {
  return {
    title: "🎁 New Claim!",
    description: `**${viewerName}** claimed **${itemName}** on **${siteName}**`,
    color: 0x315cff, // Cobalt
    fields: [
      { name: "Item", value: itemName, inline: true },
      { name: "Cost", value: `${Number(cost).toLocaleString("en-US")} credits`, inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: "YourRank Rewards" },
  };
}

// ----------------------------------------------------------------------------
// Telegram helpers
// ----------------------------------------------------------------------------

/**
 * Send a Telegram message via the Bot API.
 * @param botToken — Telegram bot token
 * @param chatId — target chat/group ID
 * @param text — message text (supports Markdown)
 * @returns {{ ok: boolean, error?: string }}
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string | number,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  if (!botToken || !chatId) return { ok: false, error: "Missing bot token or chat ID" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json() as { ok: boolean; description?: string };
    if (!data.ok) return { ok: false, error: data.description || "Telegram API error" };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

function requireDelivery(channel: string, result: { ok: boolean; error?: string }): void {
  if (!result.ok) {
    throw new Error(`${channel} delivery failed: ${result.error || "unknown error"}`);
  }
}

// ----------------------------------------------------------------------------
// Top-3 change detection
// ----------------------------------------------------------------------------

/**
 * Compare old and new player lists and return any new top-3 entries.
 * @param oldPlayers — previous players (sorted by wagered desc)
 * @param newPlayers — new players (sorted by wagered desc)
 * @returns Array of top-3 changes
 */
export function detectTop3Changes(
  oldPlayers: Array<{ name: string; wagered: number; score?: number }>,
  newPlayers: Array<{ name: string; wagered: number; score?: number }>,
  rankBy: "wagered" | "score" = "wagered"
): Array<{ name: string; rank: number; wagered: number; score?: number; rankBy: "wagered" | "score" }> {
  const oldTop3Names = new Set((oldPlayers || []).slice(0, 3).map((p) => p.name));
  const changes: Array<{ name: string; rank: number; wagered: number; score?: number; rankBy: "wagered" | "score" }> = [];
  const sorted = (newPlayers || []).slice().sort((a, b) => Number(b[rankBy] || 0) - Number(a[rankBy] || 0) || a.name.localeCompare(b.name));
  let previousValue: number | null = null;
  let competitionRank = 0;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const value = Number(p[rankBy] || 0);
    if (previousValue === null || value !== previousValue) competitionRank = i + 1;
    previousValue = value;
    if (competitionRank > 3) break;
    if (!oldTop3Names.has(p.name)) {
      changes.push({ name: p.name, rank: competitionRank, wagered: p.wagered, score: p.score, rankBy });
    }
  }
  return changes;
}

// ----------------------------------------------------------------------------
// Notification firing functions
// ----------------------------------------------------------------------------

/**
 * Fire all configured notifications for a top-3 change event.
 * Reads the site's extra_json for notification config and bot token.
 * @param db — Database helpers ({ one, query })
 * @param env — Worker env (for DB access)
 * @param siteId
 * @param siteName
 * @param top3Changes — from detectTop3Changes()
 */
export async function notifyTop3Change(
  db: { one: (sql: string, params: any[]) => Promise<any>; query: (sql: string, params: any[]) => Promise<any[]> },
  env: any,
  siteId: string,
  siteName: string,
  top3Changes: Array<{ name: string; rank: number; wagered: number; score?: number; rankBy?: "wagered" | "score" }>
): Promise<void> {
  if (!top3Changes.length) return;

  // H-25: notification credentials now live in dedicated columns.
  const site = await db.one(
    "SELECT discord_webhook_url_enc, telegram_chat_id, telegram_notify, user_id FROM sites WHERE id=$1",
    [siteId]
  );
  if (!site) return;
  const discordUrl = await decryptCredential(site.discord_webhook_url_enc);
  const tgEnabled = site.telegram_notify;
  const tgChatId = site.telegram_chat_id;

  // Discord: one embed per new top-3 player
  if (discordUrl) {
    for (const change of top3Changes) {
      const scoreRanked = change.rankBy === "score";
      const embed = buildTop3Embed(siteName, change.name, change.rank, change.wagered, scoreRanked ? "Points" : "Wagered", scoreRanked ? Number(change.score || 0) : change.wagered);
      requireDelivery("Discord", await sendDiscordWebhook(discordUrl, embed));
    }
  }

  // Telegram: one message listing all new top-3 entries
  if (tgEnabled && tgChatId) {
    // Find the bot token for this site's owner from bots table (encrypted)
    const bot = await db.one(
      "SELECT token_encrypted FROM bots WHERE owner_id=$1 AND status='active' LIMIT 1",
      [site.user_id]
    );
    if (bot?.token_encrypted) {
      let botToken: string;
      try {
        botToken = await decryptToken(Buffer.from(bot.token_encrypted));
      } catch (e) {
        console.error("[notify] failed to decrypt bot token:", errMessage(e));
        throw e;
      }
      const lines = top3Changes.map((c) => {
        const medal = ["🥇", "🥈", "🥉"][c.rank - 1] || "🏆";
        const metric = c.rankBy === "score"
          ? `${Number(c.score || 0).toLocaleString("en-US")} pts`
          : `$${Number(c.wagered).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
        return `${medal} *${escapeTgMarkdown(c.name)}* entered #${c.rank} — ${metric}`;
      });
      const text = `⚡ *${escapeTgMarkdown(siteName)}* — New Top 3!\n\n${lines.join("\n")}`;
      requireDelivery("Telegram", await sendTelegramMessage(botToken, tgChatId, text));
    }
  }
}

/**
 * Fire Discord webhook for a leaderboard reset event.
 */
export async function notifyReset(
  db: { one: (sql: string, params: any[]) => Promise<any> },
  env: any,
  siteId: string,
  siteName: string,
  players: Array<{ name: string; wagered: number; prize?: number }>,
  period: string
): Promise<void> {
  // H-25: Discord webhook URL now lives in a dedicated encrypted column.
  const site = await db.one("SELECT discord_webhook_url_enc FROM sites WHERE id=$1", [siteId]);
  if (!site) return;
  const discordUrl = await decryptCredential(site.discord_webhook_url_enc);
  if (!discordUrl) return;
  const embed = buildResetEmbed(siteName, players, period);
  requireDelivery("Discord", await sendDiscordWebhook(discordUrl, embed));
}

/**
 * Detect rank changes for ALL players (not just top-3) and send DMs
 * to players who subscribed via /subscribe on the streamer's Telegram bot.
 *
 * @param db — Database helpers ({ one, query })
 * @param env — Worker env (for DB access)
 * @param siteId
 * @param siteName
 * @param oldPlayers — previous players sorted by wagered desc
 * @param newPlayers — new players sorted by wagered desc
 */
export interface PlayerRankMessage {
  siteId: string;
  siteName: string;
  playerName: string;
  oldRank: number | null;
  newRank: number;
  botId: string;
  tgUserId: number;
}

function buildPlayerRankText(siteName: string, playerName: string, oldRank: number | null, newRank: number): string | null {
  if (!newRank) return null;
  const safeSite = escapeTgMarkdown(siteName);
  const safePlayer = escapeTgMarkdown(playerName);
  if (oldRank === null && newRank <= 20) {
    return `🎉 *${safePlayer}* entered the *${safeSite}* leaderboard at #${newRank}!`;
  }
  if (oldRank !== null && oldRank !== newRank) {
    const direction = newRank < oldRank ? "📈" : "📉";
    return `${direction} *${safePlayer}* moved from #${oldRank} to #${newRank} on the *${safeSite}* leaderboard!`;
  }
  return null;
}

export function getRankChangedPlayerNames(
  oldPlayers: Array<{ name: string; wagered: number; score?: number; rank?: number }>,
  newPlayers: Array<{ name: string; wagered: number; score?: number }>,
  rankBy: "wagered" | "score" = "wagered"
): string[] {
  const oldRankMap = new Map<string, number>();
  (oldPlayers || []).forEach((p, i) => oldRankMap.set(p.name, p.rank || i + 1));

  const newSorted = (newPlayers || []).slice().sort((a, b) => Number(b[rankBy] || 0) - Number(a[rankBy] || 0) || a.name.localeCompare(b.name));
  const newRankMap = new Map<string, number>();
  let previousValue: number | null = null;
  let competitionRank = 0;
  newSorted.forEach((p, i) => {
    const value = Number(p[rankBy] || 0);
    if (previousValue === null || value !== previousValue) competitionRank = i + 1;
    previousValue = value;
    newRankMap.set(p.name, competitionRank);
  });

  return newSorted
    .filter((p) => {
      const oldRank = oldRankMap.get(p.name) ?? null;
      const newRank = newRankMap.get(p.name);
      if (!newRank) return false;
      return (oldRank === null && newRank <= 20) || (oldRank !== null && oldRank !== newRank);
    })
    .map((p) => p.name);
}

/**
 * Send a single player rank-change DM using the bot the player subscribed to.
 * A token cache avoids fetching/decrypting the same bot token repeatedly when
 * many messages are processed in a batch.
 */
export async function sendPlayerRankNotification(
  db: { one: (sql: string, params: any[]) => Promise<any> },
  msg: PlayerRankMessage,
  tokenCache: Map<string, string> = new Map()
): Promise<void> {
  const text = buildPlayerRankText(msg.siteName, msg.playerName, msg.oldRank, msg.newRank);
  if (!text) return;

  let botToken = tokenCache.get(msg.botId);
  if (botToken === undefined) {
    const bot = await db.one(
      "SELECT token_encrypted FROM bots WHERE id=$1 AND status='active'",
      [msg.botId]
    );
    if (!bot?.token_encrypted) {
      tokenCache.set(msg.botId, "");
      return;
    }
    try {
      botToken = await decryptToken(Buffer.from(bot.token_encrypted));
      tokenCache.set(msg.botId, botToken);
    } catch (e) {
      console.error("[notify] failed to decrypt bot token:", errMessage(e));
      throw e;
    }
  }
  if (!botToken) return;
  requireDelivery("Telegram", await sendTelegramMessage(botToken, msg.tgUserId, text));
}

export async function notifySubscribedPlayers(
  db: { one: (sql: string, params: any[]) => Promise<any>; query: (sql: string, params: any[]) => Promise<any[]> },
  env: any,
  siteId: string,
  siteName: string,
  oldPlayers: Array<{ name: string; wagered: number; score?: number }>,
  newPlayers: Array<{ name: string; wagered: number; score?: number }>,
  rankBy: "wagered" | "score" = "wagered",
  sendNotification: typeof sendPlayerRankNotification = sendPlayerRankNotification
): Promise<void> {
  const oldRankMap = new Map<string, number>();
  const oldSorted = (oldPlayers || []).slice().sort((a, b) => Number(b[rankBy] || 0) - Number(a[rankBy] || 0) || a.name.localeCompare(b.name));
  { let prev: number | null = null; let cr = 0; oldSorted.forEach((p, i) => { const v = Number(p[rankBy] || 0); if (prev === null || v !== prev) cr = i + 1; prev = v; oldRankMap.set(p.name, cr); }); }

  const newRankMap = new Map<string, number>();
  const newSorted = (newPlayers || []).slice().sort((a, b) => Number(b[rankBy] || 0) - Number(a[rankBy] || 0) || a.name.localeCompare(b.name));
  { let prev: number | null = null; let cr = 0; newSorted.forEach((p, i) => { const v = Number(p[rankBy] || 0); if (prev === null || v !== prev) cr = i + 1; prev = v; newRankMap.set(p.name, cr); }); }

  const changedNames = getRankChangedPlayerNames(oldPlayers, newPlayers, rankBy);
  if (!changedNames.length) return;

  const subs = await db.query(
    `SELECT ps.tg_user_id, ps.player_name, ps.bot_id
       FROM player_subscriptions ps
      WHERE ps.site_id = $1
        AND ps.player_name = ANY($2::text[])`,
    [siteId, changedNames]
  );
  if (!subs.length) return;

  const tokenCache = new Map<string, string>();
  for (const sub of subs) {
    const playerName = sub.player_name;
    const oldRank = oldRankMap.get(playerName) ?? null;
    const newRank = newRankMap.get(playerName);
    if (!newRank) continue;
    try {
      await sendNotification(db, {
        siteId,
        siteName,
        playerName,
        oldRank,
        newRank,
        botId: sub.bot_id,
        tgUserId: sub.tg_user_id,
      }, tokenCache);
    } catch (e) {
      console.error("[notify] player notification failed:", String(e instanceof Error ? e.message : e));
    }
  }
}

export interface NotifyEventPayload {
  type: "notify";
  kind: "top3" | "reset" | "player-rank";
  siteId: string;
  siteName: string;
  [key: string]: any;
}

export async function dispatchNotifyEvent(
  db: { one: (sql: string, params: any[]) => Promise<any>; query: (sql: string, params: any[]) => Promise<any[]> },
  env: any,
  event: NotifyEventPayload,
  tokenCache: Map<string, string> = new Map()
): Promise<void> {
  switch (event.kind) {
    case "top3":
      await notifyTop3Change(db, env, event.siteId, event.siteName, event.changes || []);
      break;
    case "reset":
      await notifyReset(db, env, event.siteId, event.siteName, event.players || [], event.period || "");
      break;
    case "player-rank":
      await sendPlayerRankNotification(db, {
        siteId: event.siteId,
        siteName: event.siteName,
        playerName: event.playerName,
        oldRank: event.oldRank ?? null,
        newRank: event.newRank,
        botId: event.botId,
        tgUserId: event.tgUserId,
      }, tokenCache);
      break;
    default:
      throw new Error("unknown notify event kind");
  }
}
