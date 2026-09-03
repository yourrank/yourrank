// ------------------------------------------------------------------
// Cloudflare Workers entry point.
//
// Uses dynamic import so shared modules (config.ts, db.ts) pick up
// env vars from the Workers runtime before they evaluate.
// ------------------------------------------------------------------

// Copy every binding the app reads onto process.env so shared modules (which
// read process.env, not c.env) work unchanged. Called from BOTH fetch and
// scheduled — they MUST populate the same set, or a binding set in only one
import { sendCronSummaryToDiscord } from "@yourrank/shared/monitoring";
import { withWorkerFetch } from "@yourrank/shared/with-worker";
import { RateLimiter } from "@yourrank/shared/rate-limiter-do";
import { populateEnv } from "@yourrank/shared/env";
import { exec as dbExec } from "@yourrank/shared/db";
import { Toucan } from "toucan-js";
import type { BotRow } from "./botEngine.js";
import { NIGHTLY_CRON, isWebhookRecoveryTick } from "./cron-schedule.js";

// Cache the Hono app instance so it's built once per isolate, not per request.
let cachedApp: any = null;

/**
 * POST a Discord webhook embed on cron failure.
 * Falls back to console.error only if the webhook URL is not configured.
 */
async function notifyCronFailure(env: Record<string, any>, cron: string, task: string, err: unknown): Promise<void> {
  const webhookUrl = env.DISCORD_MONITORING_WEBHOOK;
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[cron ${cron}] ${task} failed:`, err);

  if (!webhookUrl) return; // No webhook configured — console.error is enough.

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "⚠️ Cron Failure Alert",
          description: `**Task:** \`${task}\`\n**Cron:** \`${cron}\`\n**Error:**\n\`\`\`\n${msg.slice(0, 1800)}\n\`\`\``,
          color: 0xff4444,
          timestamp: new Date().toISOString(),
        }],
      }),
    });
  } catch {
    // Swallow — we must never crash on alerting failure.
    console.error("[cron] Failed to send Discord webhook notification");
  }
}

async function recoverTelegramWebhookUpdatesForCron(env: Record<string, any>, cron: string): Promise<void> {
  try {
    const { getBotById, handleUpdateForBot } = await import("./botEngine.js");
    const { recoverTelegramWebhookUpdates } = await import("./telegram-webhook.js");
    const recovered = await recoverTelegramWebhookUpdates({
      loadBot: (botId) => getBotById(botId),
      process: (bot: BotRow, update) => handleUpdateForBot(bot, update, env),
    });
    console.log(`[cron ${cron}] Telegram webhook recovery: ${recovered} update(s) recovered`);
  } catch (err) {
    console.error(`[cron ${cron}] Telegram webhook recovery failed:`, err);
  }
}

export default {
  fetch: withWorkerFetch("bot", async (req, env, ctx) => {
    populateEnv(env);
    // Ensure current month partition exists on first request (idempotent)
    if (!cachedApp) {
      const { buildHonoApp } = await import("./hono-app.js");
      cachedApp = buildHonoApp();
      // Ensure current month partition exists on Worker startup
      ctx.waitUntil(
        (async () => {
          try {
            const { ensureCurrentMonthPartition } = await import("./rollup.js");
            await ensureCurrentMonthPartition();
            console.log("[startup] ensureCurrentMonthPartition completed");
          } catch (err) {
            console.error("[startup] ensureCurrentMonthPartition failed:", err);
          }
        })()
      );
    }
    return await cachedApp.fetch(req, env as any);
  }),

  // Cron Triggers (see wrangler.toml):
  //   * * * * *  — broadcast worker: one rate-limited batch per tick;
  //                 Telegram webhook recovery on every 5th minute
  //   0 3 * * *  — nightly: click rollup, partitions, expired plans
  async scheduled(event: { cron: string; scheduledTime: number }, env: Record<string, any>, ctx: { waitUntil: (p: Promise<unknown>) => void }): Promise<void> {
    const sentry = env.SENTRY_DSN ? (() => { const s = new Toucan({
      dsn: env.SENTRY_DSN,
      context: ctx,
      environment: "production",
      release: `yourrank@${process.env.npm_package_version || "dev"}`,
    }); s.setTag("worker", "bot"); return s; })() : null;
    populateEnv(env);
    try {
      if (event.cron === NIGHTLY_CRON) {
        const { rollupClicks, ensureNextMonthPartition, ensureCurrentMonthPartition } = await import("./rollup.js");
        const { downgradeExpired } = await import("./billing.js");

        const results = await Promise.allSettled([
          (async () => {
            try {
              await rollupClicks();
            } catch (err) {
              console.error("[cron 0 3 * * *] rollupClicks failed:", err);
              throw err;
            }
          })(),
          (async () => {
            try {
              await ensureCurrentMonthPartition();
            } catch (err) {
              console.error("[cron 0 3 * * *] ensureCurrentMonthPartition failed:", err);
              throw err;
            }
          })(),
          (async () => {
            try {
              await ensureNextMonthPartition();
            } catch (err) {
              console.error("[cron 0 3 * * *] ensureNextMonthPartition failed:", err);
              throw err;
            }
          })(),
          (async () => {
            try {
              const { sendExpiryWarnings } = await import("@yourrank/shared/email");
              const origin = env.PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || "https://yourrank.site";
              const { sent, skipped } = await sendExpiryWarnings(env, { origin });
              console.log(`[cron 0 3 * * *] sendExpiryWarnings: ${sent} sent, ${skipped} skipped`);
              return { sent, skipped };
            } catch (err) {
              console.error("[cron 0 3 * * *] sendExpiryWarnings failed:", err);
              throw err;
            }
          })(),
          (async () => {
            try {
              const downgraded = await downgradeExpired();
              console.log(`[cron 0 3 * * *] downgradeExpired: ${downgraded} user(s) downgraded to free`);
              // Alert via monitoring webhook if any users were downgraded
              if (downgraded > 0 && env.DISCORD_MONITORING_WEBHOOK) {
                await sendCronSummaryToDiscord({
                  webhookUrl: env.DISCORD_MONITORING_WEBHOOK,
                  title: "🌙 Nightly Plan Downgrade Report",
                  fields: [
                    { name: "Users Downgraded", value: String(downgraded), inline: true },
                    { name: "Action", value: "Expired plans reset to Free", inline: true },
                    { name: "Cron", value: "`0 3 * * *`", inline: true },
                  ],
                });
              }
              return downgraded;
            } catch (err) {
              console.error("[cron 0 3 * * *] downgradeExpired failed:", err);
              throw err;
            }
          })(),
          (async () => {
            try {
              const { purgeExpiredReplayHashes } = await import("@yourrank/shared/postback");
              const deleted = await purgeExpiredReplayHashes();
              console.log(`[cron 0 3 * * *] purgeExpiredReplayHashes: deleted ${deleted} replay hashes`);
              return deleted;
            } catch (err) {
              console.error("[cron 0 3 * * *] purgeExpiredReplayHashes failed:", err);
              throw err;
            }
          })(),
          // DB-101: Data retention — delete click_daily rows older than 90 days
          (async () => {
            try {
              const result = await dbExec("SELECT cleanup_old_clicks()");
              const deleted = result?.[0]?.deleted_count ?? 0;
              console.log(`[cron 0 3 * * *] cleanup_old_clicks: deleted ${deleted} click_daily rows`);
            } catch (err) {
              console.error("[cron] click cleanup failed:", err);
              // Non-critical — don't fail the whole cron batch
            }
          })(),
          // AUTH-102: Purge expired sessions and password reset tokens so the
          // tables don't grow unbounded. Single statement via CTEs; counts are
          // logged for observability.
          (async () => {
            try {
              const result = await dbExec(
                `WITH s AS (DELETE FROM sessions WHERE expires_at < now() RETURNING 1),
                      r AS (DELETE FROM password_resets WHERE expires_at < now() RETURNING 1),
                      t AS (DELETE FROM telegram_webhook_updates
                            WHERE (status = 'completed' AND completed_at < now() - interval '2 days')
                               OR (status = 'abandoned' AND abandoned_at < now() - interval '7 days')
                            RETURNING 1)
                 SELECT (SELECT count(*)::int FROM s) AS sessions_deleted,
                        (SELECT count(*)::int FROM r) AS resets_deleted,
                        (SELECT count(*)::int FROM t) AS webhook_updates_deleted`
              );
              const row = result?.[0] ?? {};
              console.log(`[cron 0 3 * * *] auth cleanup: deleted ${row.sessions_deleted ?? 0} expired sessions, ${row.resets_deleted ?? 0} expired password resets, ${row.webhook_updates_deleted ?? 0} Telegram webhook updates`);
            } catch (err) {
              console.error("[cron] auth cleanup failed:", err);
              // Non-critical — don't fail the whole cron batch
            }
          })(),
          // Onboarding email sequence: Day 0 (welcome), Day 3 (bot/offers), Day 7 (upgrade)
          (async () => {
            try {
              const { sendPendingOnboardingEmails } = await import("@yourrank/shared/email");
              const { sent, skipped } = await sendPendingOnboardingEmails(env);
              console.log(`[cron 0 3 * * *] onboarding emails: ${sent} sent, ${skipped} skipped`);
            } catch (err) {
              console.error("[cron 0 3 * * *] onboarding emails failed:", err);
              throw err;
            }
          })(),
        ]);

        // Log any rejections and alert via Discord — allSettled never throws
        const failures = results.filter(r => r.status === "rejected");
        if (failures.length > 0) {
          const failedTasks = ["rollupClicks", "ensureCurrentMonthPartition", "ensureNextMonthPartition", "sendExpiryWarnings", "downgradeExpired", "purgeExpiredReplayHashes", "cleanupOldClicks", "authCleanup", "onboardingEmails"]
            .filter((_, i) => results[i].status === "rejected");
          const reasons = failures.map(f => String((f as PromiseRejectedResult).reason?.message || f.reason)).join("; ");
          console.error(`[cron 0 3 * * *] ${failures.length} task(s) failed: ${failedTasks.join(", ")} — ${reasons}`);
          await notifyCronFailure(env, event.cron, failedTasks.join(", "), reasons);
        } else {
          console.log(`[cron 0 3 * * *] All tasks completed successfully at ${new Date().toISOString()}`);
        }
      } else {
        // Default: broadcast batch (every minute cron)
        const { processBroadcastBatch } = await import("./broadcasts.js");
        ctx.waitUntil(
          processBroadcastBatch().catch((err: unknown) => {
            console.error(`[cron ${event.cron}] processBroadcastBatch failed:`, err);
            notifyCronFailure(env, event.cron, "processBroadcastBatch", err).catch(() => {});
          }),
        );
        if (isWebhookRecoveryTick(event.scheduledTime)) {
          await recoverTelegramWebhookUpdatesForCron(env, event.cron);
        }
      }
    } catch (err) {
      sentry?.captureException(err);
      await notifyCronFailure(env, event.cron, "scheduled-handler", err);
    }
  },
};

// Durable Object classes must be exported from the main module.
export { RateLimiter };
