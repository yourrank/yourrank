import { Bot, Context, InlineKeyboard } from "grammy";
import type { Update } from "grammy/types";

/** Escape user content for Telegram HTML parse_mode */
export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? "")
  );

interface CommandButton { label: string; url: string; }

function buildCommandKeyboard(buttons: unknown): InlineKeyboard | undefined {
  const arr = Array.isArray(buttons) ? buttons : [];
  const valid = arr.filter((b): b is CommandButton =>
    b && typeof (b as any).label === "string" && typeof (b as any).url === "string"
  );
  if (!valid.length) return undefined;
  const kb = new InlineKeyboard();
  valid.forEach((b, i) => {
    if (i > 0) kb.row();
    kb.url(esc(b.label), b.url);
  });
  return kb;
}

import { one, query } from "@yourrank/shared/db";
import { decryptToken } from "@yourrank/shared/crypto";
import { config } from "./config.js";
import { rateLimit } from "./ratelimit.js";
import { setMyCommands } from "./telegram.js";
import { getUserPlan } from "./plans.js";
import { errMessage } from "./errors.js";

export interface BotRow {
  id: string;
  owner_id: string;
  tg_bot_id: string;
  username: string | null;
  token_encrypted: Buffer;
  webhook_secret: string;
  status: string;
  welcome_message: string | null;
}

interface OfferRow {
  id: string;
  label: string;
  promo_code: string | null;
  bonus_text: string | null;
  referral_url: string;
  partner_name: string;
  slug: string | null;
}

// ---------------------------------------------------------------
// Stateless webhook handling — one Bot per request, no cache.
// Works identically on Node (Fastify) and Workers (Hono).
// Creating a Bot is cheap (object construction + handler wiring,
// zero network calls when botInfo is passed).
// ---------------------------------------------------------------

export async function getBotBySecret(secret: string): Promise<BotRow | undefined> {
  // JOIN on users so a suspended owner's bots are automatically rejected.
  return one<BotRow>(
    `SELECT b.id, b.owner_id, b.tg_bot_id, b.username, b.token_encrypted,
            b.webhook_secret, b.status, b.welcome_message
       FROM bots b JOIN users u ON u.id = b.owner_id
      WHERE b.webhook_secret = $1 AND u.status = 'active'`,
    [secret]
  );
}

export async function getBotById(botId: string): Promise<BotRow | undefined> {
  return one<BotRow>(
    `SELECT b.id, b.owner_id, b.tg_bot_id, b.username, b.token_encrypted,
            b.webhook_secret, b.status, b.welcome_message
       FROM bots b JOIN users u ON u.id = b.owner_id
      WHERE b.id = $1 AND u.status = 'active'`,
    [botId],
  );
}

export async function handleUpdateForBot(row: BotRow, update: Update, env?: any): Promise<void> {
  const token = await decryptToken(Buffer.from(row.token_encrypted));
  const botInfo: Record<string, unknown> = {
    id: Number(row.tg_bot_id),
    is_bot: true,
    first_name: row.username ?? "Bot",
  };
  if (row.username) botInfo.username = row.username;
  const bot = new Bot(token, { botInfo: botInfo as any });
  wireHandlers(bot, row, env);
  await bot.handleUpdate(update);
}

// ---------------------------------------------------------------
// Handlers — the actual bot behavior, same code for every tenant.
// ---------------------------------------------------------------
export function wireHandlers(bot: Bot, botRow: BotRow, env?: any): void {
  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (from && !from.is_bot) {
      await query(
        `INSERT INTO bot_subscribers (bot_id, tg_user_id, tg_username, first_name, language)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (bot_id, tg_user_id) DO UPDATE
           SET last_seen = now(),
               tg_username = EXCLUDED.tg_username,
               is_blocked = false`,
        [botRow.id, from.id, from.username ?? null, from.first_name ?? null, from.language_code ?? null]
      );
    }
    await next();
  });

  // ---- Tappable menu (inline buttons) --------------------------------
  // Viewers tap buttons instead of memorising slash-commands. The same set
  // of actions is registered with Telegram (syncMyCommands) so they also show
  // in the native "Menu" button next to the chat input.
  async function buildMenuKeyboard(): Promise<InlineKeyboard> {
    const kb = new InlineKeyboard()
      .text("🎁 Promo codes", "m:code").text("🏆 Leaderboard", "m:board").row()
      .text("🔔 Subscribe", "m:sub").text("❓ Help", "m:help").row()
      .text("💬 Support", "m:support");
    const customs = await query<{ command: string }>(
      `SELECT command FROM bot_commands WHERE bot_id = $1 AND is_enabled ORDER BY command`,
      [botRow.id]
    );
    customs.forEach((c, i) => {
      if (i % 2 === 0) kb.row();
      kb.text("/" + c.command, "m:c:" + c.command);
    });
    return kb;
  }

  async function sendMenu(ctx: Context, intro: string): Promise<void> {
    await ctx.reply(intro, { reply_markup: await buildMenuKeyboard() });
  }

  const helpText = (): string =>
    "<b>Available commands</b>\n\n" +
    "/menu — open the tappable menu\n" +
    "/code — get promo codes and referral links\n" +
    "/subscribe &lt;player name&gt; — get DMs when your rank changes\n" +
    "/unsubscribe — stop rank-change DMs\n" +
    "/support — contact the YourRank team\n" +
    "/help — show this list";

  const supportText = (): string => {
    const supportEmail = (typeof process !== "undefined" && process.env?.SUPPORT_EMAIL) || "contact@yourrank.site";
    return "Need help?\n\n" +
      "1. Visit the dashboard: https://yourrank.site/dashboard\n" +
      `2. Email us: ${esc(supportEmail)}\n` +
      "3. Use the contact form: https://yourrank.site/contact\n\n" +
      "For account or billing issues, include your registered email so we can find you faster.";
  };

  const subscribeUsageText = (): string =>
    "Usage: /subscribe <your player name>\n\n" +
    "This subscribes you to DMs when your rank changes on this leaderboard.";

  // Send the top-5 leaderboard in any chat (used by /start menu "Leaderboard").
  async function sendLeaderboardTop(ctx: Context): Promise<void> {
    const site = await getOwnerSite();
    if (!site) { await ctx.reply("This bot doesn't have an active leaderboard yet."); return; }
    const players = await query<{ name: string; amount: number }>(
      `SELECT name, amount FROM players WHERE site_id = $1 ORDER BY amount DESC LIMIT 5`,
      [site.id]
    );
    if (!players.length) { await ctx.reply("This leaderboard is empty. Ask the streamer to add players!"); return; }
    const lines = players.map((p, i) => `${i + 1}. ${p.name} — ${fmtMoney(p.amount)}`);
    const url = config.publicBaseUrl ? `${config.publicBaseUrl}/${site.slug}` : "";
    let msg = `🏆 ${site.name || "Leaderboard"}'s Leaderboard\n${lines.join("\n")}`;
    if (url) msg += `\n\n🔗 ${url}`;
    await ctx.reply(msg);
  }

  bot.command("start", async (ctx) => {
    // Deep-link attribution: t.me/<bot>?start=<source> arrives as ctx.match.
    // Record it first-touch (only if not already set) so re-/start-ing keeps
    // the original source. Sanitised to a short, safe token.
    const payload = String(ctx.match ?? "").trim().slice(0, 64).replace(/[^A-Za-z0-9_.:-]/g, "");
    if (payload && ctx.from?.id) {
      await query(
        `UPDATE bot_subscribers SET source = $1
          WHERE bot_id = $2 AND tg_user_id = $3 AND source IS NULL`,
        [payload, botRow.id, ctx.from.id]
      ).catch((e) => console.error("[start] attribution update failed:", errMessage(e)));
    }
    const welcome = botRow.welcome_message ?? "Welcome! Tap a button below to get started.";
    await sendMenu(ctx, welcome);
  });

  bot.command("menu", async (ctx) => {
    await sendMenu(ctx, "📋 Menu — tap an option below:");
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(helpText(), { parse_mode: "HTML" });
  });

  bot.command("support", async (ctx) => {
    await ctx.reply(supportText(), { parse_mode: "HTML" });
  });

  // Menu button taps arrive as callback queries — run the same action the
  // matching slash-command would.
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data ?? "";
    await ctx.answerCallbackQuery();
    if (data === "m:code") { await sendOffers(ctx, botRow); return; }
    if (data === "m:board") { await sendLeaderboardTop(ctx); return; }
    if (data === "m:sub") { await ctx.reply(subscribeUsageText()); return; }
    if (data === "m:help") { await ctx.reply(helpText(), { parse_mode: "HTML" }); return; }
    if (data === "m:support") { await ctx.reply(supportText(), { parse_mode: "HTML" }); return; }
    if (data.startsWith("m:c:")) {
      const cmd = data.slice(4);
      const custom = await one<{ response: string | null; buttons: unknown }>(
        `SELECT response, buttons FROM bot_commands WHERE bot_id = $1 AND command = $2 AND is_enabled`,
        [botRow.id, cmd]
      );
      if (custom?.response) {
        const replyMarkup = buildCommandKeyboard(custom.buttons);
        await ctx.reply(esc(custom.response), { parse_mode: "HTML", reply_markup: replyMarkup });
      } else {
        await ctx.reply("That option is no longer available.");
      }
    }
  });

  bot.command(["code", "codes"], async (ctx) => {
    await sendOffers(ctx, botRow);
  });

  // /subscribe <player_name> — opt into rank-change DMs on this leaderboard.
  bot.command("subscribe", async (ctx) => {
    const from = ctx.from;
    if (!from || from.is_bot) return;

    // Parse the player name from the command text
    const text = ctx.message?.text ?? "";
    const playerName = text.replace(/^\/subscribe(@\S+)?\s*/i, "").trim();
    if (!playerName) {
      await ctx.reply(subscribeUsageText());
      return;
    }

    // Find the site(s) owned by this bot's owner
    const sites = await query<{ id: string; name: string }>(
      `SELECT id, name FROM sites WHERE user_id = $1 AND published = true`,
      [botRow.owner_id]
    );
    if (!sites.length) {
      await ctx.reply("This bot doesn't have an active leaderboard yet.");
      return;
    }

    // Subscribe to the first site (primary board)
    const site = sites[0];
    try {
      await query(
        `INSERT INTO player_subscriptions (bot_id, site_id, tg_user_id, player_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (bot_id, tg_user_id, site_id) DO UPDATE SET player_name = EXCLUDED.player_name`,
        [botRow.id, site.id, from.id, playerName]
      );
      // Rank-change DMs only fire on paid plans (see leaderboard save path).
      // Be honest on Free so viewers don't expect DMs that never arrive.
      let paid = false;
      try { paid = (await getUserPlan(botRow.owner_id)).tier !== "free"; }
      catch (e) { console.error("[subscribe] plan lookup failed:", errMessage(e)); }
      await ctx.reply(
        paid
          ? `✅ Subscribed! You'll get a DM when "${playerName}" changes rank on the ${site.name || "leaderboard"}.\n\n` +
            "Send /unsubscribe to stop notifications."
          : `✅ Saved! I'll watch "${playerName}" on the ${site.name || "leaderboard"}.\n\n` +
            "Heads up: automatic rank-change DMs are a paid feature this streamer hasn't enabled yet, so you may not get alerts. Send /unsubscribe to stop."
      );
    } catch (err) {
      console.error("[subscribe]", err);
      await ctx.reply("Something went wrong. Try again later.");
    }
  });

  // /unsubscribe — stop receiving rank-change DMs.
  bot.command("unsubscribe", async (ctx) => {
    const from = ctx.from;
    if (!from || from.is_bot) return;
    const deleted = await query(
      `DELETE FROM player_subscriptions WHERE bot_id = $1 AND tg_user_id = $2 RETURNING id`,
      [botRow.id, from.id]
    );
    if (deleted.length) {
      await ctx.reply("✅ Unsubscribed. You won't receive rank change notifications anymore.");
    } else {
      await ctx.reply("You weren't subscribed. Use /subscribe <player name> to start.");
    }
  });

  // ------------------------------------------------------------------
  // Chat commands: !rank, !board, !leaderboard
  // These work in GROUP chats where the bot is a member.
  // They look up the streamer's leaderboard (via bots.owner_id -> sites)
  // and respond with rank / top-5.
  // ------------------------------------------------------------------

  // Helper: format a number as $12,345
  const fmtMoney = (n: number | string): string => {
    const v = Number(n) || 0;
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  // Helper: get the primary site for this bot's owner
  async function getOwnerSite(): Promise<{ id: string; name: string; slug: string } | null> {
    const site = await one<{ id: string; name: string; slug: string }>(
      `SELECT id, name, slug FROM sites WHERE user_id = $1 AND published = true ORDER BY id ASC LIMIT 1`,
      [botRow.owner_id]
    );
    return site ?? null;
  }

  // Rate limit for chat commands: 5 per minute per chat
  const CHAT_CMD_LIMIT = 5;
  const CHAT_CMD_WINDOW = 60; // seconds

  async function chatCmdRateLimited(chatId: number): Promise<boolean> {
    if (!env) return false; // no KV = no rate limit
    const result = await rateLimit(env, `chatcmd:${chatId}`, CHAT_CMD_LIMIT, CHAT_CMD_WINDOW);
    return !result.ok;
  }

  // !rank — show the sender's rank on the leaderboard
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message?.text?.trim() ?? "";
    // Match !rank, /rank, or @botname variants — case-insensitive
    if (!/^!rank\b/i.test(text)) return next();

    // Only respond in group/supergroup chats
    const chatType = ctx.chat?.type;
    if (chatType !== "group" && chatType !== "supergroup") return next();

    // Rate limit
    if (await chatCmdRateLimited(ctx.chat.id)) return next();

    const from = ctx.from;
    if (!from || from.is_bot) return next();

    const site = await getOwnerSite();
    if (!site) {
      await ctx.reply("No leaderboard linked to this chat.", {
        reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
      });
      return;
    }

    const username = (from.username ?? "").toLowerCase().replace(/^@/, "");
    if (!username) {
      await ctx.reply("You need a Telegram username to use !rank. Set one in Telegram Settings → Username.", {
        reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
      });
      return;
    }

    // Compute the exact ordinal and total in the database rather than loading
    // up to 1,000 players into the Worker. The id tie-breaker makes equal
    // amount values deterministic while preserving one position per player.
    const player = await one<{ name: string; amount: number; rank: number; total: number }>(
      `SELECT p.name, p.amount,
              (
                SELECT count(*) FROM players ahead
                 WHERE ahead.site_id = p.site_id
                   AND (ahead.amount > p.amount
                     OR (ahead.amount = p.amount AND ahead.id < p.id))
              )::int + 1 AS rank,
              (SELECT count(*) FROM players total WHERE total.site_id = p.site_id)::int AS total
         FROM players p
        WHERE p.site_id = $1
          AND lower(regexp_replace(p.name, '^@', '')) = $2
        LIMIT 1`,
      [site.id, username]
    );

    if (!player) {
      await ctx.reply("You're not on this leaderboard yet. Ask the streamer to add you! 🎯", {
        reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
      });
      return;
    }

    const displayName = site.name || "this streamer";
    const url = config.publicBaseUrl ? `${config.publicBaseUrl}/${site.slug}` : "";

    let msg = `🏆 @${username} is ranked #${player.rank} of ${player.total} on ${displayName}'s leaderboard! Amount: ${fmtMoney(player.amount)}`;
    if (url) msg += `\n\n🔗 ${url}`;

    await ctx.reply(msg, {
      reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
    });
  });

  // !board / !leaderboard — show top 5 players
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message?.text?.trim() ?? "";
    if (!/^!(board|leaderboard)\b/i.test(text)) return next();

    const chatType = ctx.chat?.type;
    if (chatType !== "group" && chatType !== "supergroup") return next();

    if (await chatCmdRateLimited(ctx.chat.id)) return next();

    const site = await getOwnerSite();
    if (!site) {
      await ctx.reply("No leaderboard linked to this chat.", {
        reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
      });
      return;
    }

    const players = await query<{ name: string; amount: number }>(
      `SELECT name, amount FROM players WHERE site_id = $1 ORDER BY amount DESC LIMIT 5`,
      [site.id]
    );

    if (!players.length) {
      await ctx.reply("This leaderboard is empty. Ask the streamer to add players!", {
        reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
      });
      return;
    }

    const displayName = site.name || "Leaderboard";
    const lines = players.map(
      (p, i) => `${i + 1}. ${p.name} — ${fmtMoney(p.amount)}`
    );

    const url = config.publicBaseUrl ? `${config.publicBaseUrl}/${site.slug}` : "";
    let msg = `🏆 ${displayName}'s Leaderboard\n${lines.join("\n")}`;
    if (url) msg += `\n\n🔗 ${url}`;

    await ctx.reply(msg, {
      reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
    });
  });

  bot.on("message::bot_command", async (ctx) => {
    const text = ctx.message?.text ?? "";
    const cmd = text.split(/\s/)[0]?.replace(/^\//, "").split("@")[0]?.toLowerCase();
    if (!cmd || ["start", "code", "codes", "subscribe", "unsubscribe"].includes(cmd)) return;

    const custom = await one<{ response: string | null; buttons: unknown }>(
      `SELECT response, buttons FROM bot_commands
        WHERE bot_id = $1 AND command = $2 AND is_enabled`,
      [botRow.id, cmd]
    );
    if (custom?.response) {
      const replyMarkup = buildCommandKeyboard(custom.buttons);
      await ctx.reply(esc(custom.response), { parse_mode: "HTML", reply_markup: replyMarkup });
    }
  });

  bot.catch((err) => {
    console.error(`[bot ${botRow.username ?? botRow.id}]`, err.error);
  });
}

// Built-in commands surfaced in Telegram's native "Menu" button; the
// streamer's enabled custom commands are appended.
const BUILTIN_MENU_COMMANDS = [
  { command: "menu", description: "Show the menu" },
  { command: "code", description: "Get promo codes & links" },
  { command: "subscribe", description: "Get DMs when your rank changes" },
  { command: "unsubscribe", description: "Stop rank-change DMs" },
  { command: "help", description: "Show help" },
  { command: "support", description: "Contact support" },
];

// Register a bot's command list with Telegram so the native "Menu" button
// lists both built-ins and the streamer's custom commands. Callers treat
// failures as non-fatal.
export async function syncMyCommands(token: string, botId: string): Promise<void> {
  const customs = await query<{ command: string; response: string }>(
    `SELECT command, response FROM bot_commands WHERE bot_id = $1 AND is_enabled ORDER BY command`,
    [botId]
  );
  const commands = [
    ...BUILTIN_MENU_COMMANDS,
    ...customs.map((c) => ({
      command: c.command,
      description: (c.response || "").replace(/\s+/g, " ").trim().slice(0, 256) || "Custom command",
    })),
  ];
  await setMyCommands(token, commands);
}

// Look up and decrypt an active bot's stored token, then sync its command
// list. Used by the dashboard when custom commands change.
export async function syncMyCommandsForBot(botId: string): Promise<void> {
  const row = await one<{ token_encrypted: Buffer }>(
    `SELECT token_encrypted FROM bots WHERE id = $1 AND status = 'active'`,
    [botId]
  );
  if (!row) return;
  const token = await decryptToken(Buffer.from(row.token_encrypted));
  await syncMyCommands(token, botId);
  await query(`UPDATE bots SET last_command_sync_at = now(), updated_at = now() WHERE id = $1`, [botId]);
}

async function sendOffers(ctx: Context, botRow: BotRow): Promise<void> {
  const offers = await query<OfferRow>(
    `SELECT o.id, o.label, o.promo_code, o.bonus_text, o.referral_url,
            c.name AS partner_name, sl.slug
       FROM offers o
       JOIN partners c ON c.id = o.partner_id
       LEFT JOIN LATERAL (
         SELECT slug FROM short_links
          WHERE offer_id = o.id AND source = 'telegram'
          ORDER BY created_at LIMIT 1
       ) sl ON true
      WHERE o.owner_id = $1 AND o.is_active
      ORDER BY o.priority DESC, o.created_at`,
    [botRow.owner_id]
  );

  if (offers.length === 0) {
    await ctx.reply("No active offers right now. Check back soon!");
    return;
  }

  for (const offer of offers) {
    const lines = [`<b>${esc(offer.label)}</b>`];
    if (offer.bonus_text) lines.push(esc(offer.bonus_text));
    if (offer.promo_code) lines.push(`Code: <code>${esc(offer.promo_code)}</code>`);

    const trackable =
      offer.slug &&
      /^https:\/\//.test(config.publicBaseUrl) &&
      !/localhost|127\.0\.0\.1|example\.com/.test(config.publicBaseUrl);
    const u = ctx.from?.id ? `?u=${ctx.from.id}` : "";
    const buttonUrl = trackable
      ? `${config.publicBaseUrl}/r/${offer.slug}${u}`
      : offer.referral_url;
    const kb = new InlineKeyboard().url(
      `Claim at ${offer.partner_name}`,
      buttonUrl
    );

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: kb });
  }
}
