// Production Cron Trigger ownership for the bot Worker (see wrangler.toml).
// The every-minute trigger owns broadcast batches and, on 5-minute boundaries
// of the scheduled tick, Telegram webhook recovery — one trigger, two cadences,
// so the production inventory fits the Workers Free Cron Trigger limit.

export const NIGHTLY_CRON = "0 3 * * *";
export const EVERY_MINUTE_CRON = "* * * * *";
export const WEBHOOK_RECOVERY_INTERVAL_MINUTES = 5;

export function isWebhookRecoveryTick(scheduledTime: number): boolean {
  if (!Number.isFinite(scheduledTime)) return false;
  return new Date(scheduledTime).getUTCMinutes() % WEBHOOK_RECOVERY_INTERVAL_MINUTES === 0;
}
