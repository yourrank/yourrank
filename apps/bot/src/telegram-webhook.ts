import { exec, query } from "@yourrank/shared/db";
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
  logger = console,
}: {
  findRecoverable?: () => Promise<WebhookUpdateRow[]>;
  complete?: (botId: string, updateId: number) => Promise<void>;
  loadBot: (botId: string) => Promise<TBot | undefined>;
  process: (bot: TBot, update: Update) => Promise<void>;
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

export async function gateAndDeferTelegramUpdate({
  botId,
  update,
  claim = claimTelegramUpdate,
  complete = completeTelegramUpdate,
  process,
  waitUntil,
  logger = console,
}: {
  botId: string;
  update: Update;
  claim?: (botId: string, updateId: number, update: Update) => Promise<boolean>;
  complete?: (botId: string, updateId: number) => Promise<void>;
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
