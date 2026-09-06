// Shared Discord monitoring helper for unhandled errors.
// Both the leaderboard and bot Workers import this to post crash details
// to a monitoring webhook (env.DISCORD_MONITORING_WEBHOOK).
//
// The webhook is optional — if the env var is not set, this is a silent no-op.
// The caller's try/catch should still console.error regardless.

interface ErrorEmbedOpts {
  webhookUrl: string;
  title?: string;
  message: string;
  path?: string;
  worker?: string;
  color?: number;
}

interface CronSummaryOpts {
  webhookUrl: string;
  title: string;
  fields: Array<{ name: string; value: string; inline?: boolean }>;
  color?: number;
}

export async function sendErrorToDiscord({
  webhookUrl,
  title = "YourRank Error",
  message,
  path,
  worker,
  color = 0xff4444,
}: ErrorEmbedOpts): Promise<void> {
  if (!webhookUrl) return;
  const fields = [
    { name: "Error", value: `\`\`\`\n${String(message).slice(0, 900)}\n\`\`\``, inline: false },
  ];
  if (path) fields.push({ name: "Path", value: `\`${path}\``, inline: true });
  if (worker) fields.push({ name: "Worker", value: worker, inline: true });
  fields.push({ name: "Timestamp", value: new Date().toISOString(), inline: true });

  const embed = {
    title,
    color,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: "YourRank Monitoring" },
  };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({
        username: "YourRank Monitor",
        embeds: [embed],
      }),
    });
  } catch {
    // Swallow — never let a monitoring failure crash the handler
  }
}

export async function sendCronSummaryToDiscord({
  webhookUrl,
  title,
  fields,
  color = 0x57f287,
}: CronSummaryOpts): Promise<void> {
  if (!webhookUrl) return;
  const embed = {
    title,
    color,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: "YourRank Cron" },
  };
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({
        username: "YourRank Monitor",
        embeds: [embed],
      }),
    });
  } catch {
    // Swallow
  }
}
