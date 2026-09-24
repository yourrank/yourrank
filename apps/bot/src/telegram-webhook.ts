import { exec, query, withTransaction } from "@yourrank/shared/db";
import { effectivePlan, getPlanLimit } from "@yourrank/shared/plans";
import { classifyTelegramUpdate } from "@yourrank/shared/telegram-interactions";
import { tryConsumeUsage } from "@yourrank/shared/usage-meters";
import type { Update } from "grammy/types";

type WebhookUpdateRow = {
  bot_id: string;
  update_id: number;
  update_json: Update;
  status: "processing" | "completed" | "abandoned";
};

export async function claimTelegramUpdate(
  botId: string,
  updateId: number,
  update: Update,
): Promise<boolean> {
  const rows = await query(
    `INSERT INTO telegram_webhook_updates (bot_id, update_id, update_json)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (bot_id, update_id) DO NOTHING
     RETURNING bot_id`,
    [botId, updateId, update]
  );
  return rows.length > 0;
}

export async function completeTelegramUpdate(botId: string, updateId: number): Promise<void> {
  await exec(
    `UPDATE telegram_webhook_updates
        SET status = 'completed',
            completed_at = now()
      WHERE bot_id = $1
        AND update_id = $2
        AND status = 'processing'`,
    [botId, updateId],
  );
}

async function findRecoverableTelegramUpdates(): Promise<WebhookUpdateRow[]> {
  return query<WebhookUpdateRow>(
    `WITH abandoned AS (
       UPDATE telegram_webhook_updates
          SET status = 'abandoned',
              abandoned_at = now()
        WHERE status = 'processing'
          AND claimed_at < now() - interval '1 hour'
        RETURNING bot_id, update_id, update_json, status
     ),
     recoverable AS (
       UPDATE telegram_webhook_updates
          SET claimed_at = now()
        WHERE status = 'processing'
          AND claimed_at < now() - interval '5 minutes'
          AND claimed_at >= now() - interval '1 hour'
          AND quota_blocked IS NOT TRUE
        RETURNING bot_id, update_id, update_json, status
     )
     SELECT * FROM recoverable
     UNION ALL
     SELECT * FROM abandoned`,
  );
}

export async function recoverTelegramWebhookUpdates<TBot extends object>({
  findRecoverable = findRecoverableTelegramUpdates,
  complete = completeTelegramUpdate,
  loadBot,
  process,
  meter = meterTelegramUpdate,
  logger = console,
}: {
  findRecoverable?: () => Promise<WebhookUpdateRow[]>;
  complete?: (botId: string, updateId: number) => Promise<void>;
  loadBot: (botId: string) => Promise<TBot | undefined>;
  process: (bot: TBot, update: Update) => Promise<void>;
  meter?: MeterFn | null;
  logger?: Pick<Console, "error">;
}): Promise<number> {
  const rows = await findRecoverable();
  let recovered = 0;
  for (const row of rows) {
    if (row.status === "abandoned") {
      logger.error(
        `[telegram webhook] abandoned stale update for bot ${row.bot_id}, update ${row.update_id}`,
      );
      continue;
    }
    if (row.status === "completed") continue;
    try {
      const bot = await loadBot(row.bot_id);
      if (!bot) {
        logger.error(
          `[telegram webhook] cannot recover update for missing bot ${row.bot_id}, update ${row.update_id}`,
        );
        continue;
      }
      if (meter && (await meter(row.bot_id, row.update_id, row.update_json)) === "blocked") {
        continue;
      }
      await process(bot, row.update_json);
      await complete(row.bot_id, row.update_id);
      recovered++;
    } catch (err) {
      logger.error(
        `[telegram webhook] recovery failed for bot ${row.bot_id}, update ${row.update_id}:`,
        err,
      );
    }
  }
  return recovered;
}

export type MeterResult = "process" | "blocked";
export type MeterFn = (botId: string, updateId: number, update: Update) => Promise<MeterResult>;

/**
 * Commercial metering gate: runs after a successful claim, before processing.
 * Stamps metered_at exactly once (recovery re-runs see a non-NULL metered_at
 * and are never double-counted); billable updates consume one unit of the
 * owner's telegram_interactions_per_month allowance. When the allowance is
 * exhausted the row is marked quota_blocked + completed (terminal — recovery
 * never retries it) and processing is skipped.
 */
export async function meterTelegramUpdate(
  botId: string,
  updateId: number,
  update: Update,
  deps: {
    ownerId?: string;
    logger?: Pick<Console, "error">;
  } = {},
): Promise<MeterResult> {
  const logger = deps.logger ?? console;
  return withTransaction(async (tx) => {
    const stamped = await tx.unsafe(
      `UPDATE telegram_webhook_updates SET metered_at = now()
        WHERE bot_id = $1 AND update_id = $2 AND metered_at IS NULL
        RETURNING update_id`,
      [botId, updateId],
    );
    if (!stamped.length) {
      // Already evaluated: a blocked row is terminal; otherwise re-process.
      const row = await tx.one<{ quota_blocked: boolean | null }>(
        `SELECT quota_blocked FROM telegram_webhook_updates WHERE bot_id=$1 AND update_id=$2`,
        [botId, updateId],
      );
      return row?.quota_blocked ? "blocked" : "process";
    }
    if (classifyTelegramUpdate(update) !== "billable") return "process";
    const ownerId = deps.ownerId
      ?? (await tx.one<{ owner_id: string }>(`SELECT owner_id FROM bots WHERE id=$1`, [botId]))?.owner_id;
    if (!ownerId) return "process";
    const user = await tx.one<{ plan: string; plan_expires_at: string | null; status: string }>(
      `SELECT plan, plan_expires_at, status FROM users WHERE id=$1`, [ownerId],
    );
    const allowance = getPlanLimit(effectivePlan(user), "telegram_interactions_per_month");
    const r = await tryConsumeUsage({ one: (sql, params) => tx.one(sql, params) }, ownerId, "telegram_interactions", 1, allowance);
    if (r.allowed) return "process";
    await tx.unsafe(
      `UPDATE telegram_webhook_updates
          SET quota_blocked = true, status = 'completed', completed_at = now()
        WHERE bot_id = $1 AND update_id = $2`,
      [botId, updateId],
    );
    logger.error(`[telegram usage] quota exhausted owner=${ownerId} bot=${botId} used=${r.used} allowance=${allowance}`);
    return "blocked";
  });
}

export async function gateAndDeferTelegramUpdate({
  botId,
  update,
  claim = claimTelegramUpdate,
  complete = completeTelegramUpdate,
  meter = meterTelegramUpdate,
  process,
  waitUntil,
  logger = console,
}: {
  botId: string;
  update: Update;
  claim?: (botId: string, updateId: number, update: Update) => Promise<boolean>;
  complete?: (botId: string, updateId: number) => Promise<void>;
  meter?: MeterFn | null;
  process: () => Promise<void>;
  waitUntil: (promise: Promise<unknown>) => void;
  logger?: Pick<Console, "error">;
}): Promise<"claimed" | "duplicate"> {
  const updateId = update.update_id;
  if (!Number.isSafeInteger(updateId)) {
    throw new Error("Telegram update_id is missing or invalid");
  }

  const claimed = await claim(botId, updateId, update);
  if (!claimed) return "duplicate";

  const deferred = Promise.resolve()
    .then(async () => {
      if (meter && (await meter(botId, updateId, update)) === "blocked") return;
      await process();
      await complete?.(botId, updateId);
    })
    .catch((err) => {
      logger.error(
        `[telegram webhook] deferred update failed for bot ${botId}, update ${updateId}:`,
        err
      );
    });
  waitUntil(deferred);
  return "claimed";
}
