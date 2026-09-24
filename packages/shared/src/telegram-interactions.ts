// Commercial metering classification for inbound Telegram updates.
// "billable" updates count against telegram_interactions_per_month;
// everything else is ignored by the meter.
// Structural subset of grammy's Update — shared has no grammy dependency.
export interface TelegramUpdateLike {
  update_id?: number;
  message?: {
    text?: string;
    entities?: Array<{ type?: string; offset?: number }>;
    chat?: { type?: string };
  };
  callback_query?: { data?: string };
}

const BILLABLE_GROUP_COMMAND = /^!(rank|board|leaderboard)\b/i;

export function classifyTelegramUpdate(update: TelegramUpdateLike): "billable" | "ignored" {
  const message = update.message;
  if (message) {
    // (a) /command at the start of the message.
    const firstEntity = message.entities?.[0];
    if (firstEntity?.type === "bot_command" && firstEntity.offset === 0) return "billable";
    // (b) !rank / !board / !leaderboard in a group or supergroup.
    const chatType = message.chat?.type;
    if (
      (chatType === "group" || chatType === "supergroup") &&
      typeof message.text === "string" &&
      BILLABLE_GROUP_COMMAND.test(message.text)
    ) {
      return "billable";
    }
  }
  // (c) callback_query carrying data.
  if (update.callback_query?.data) return "billable";
  return "ignored";
}
