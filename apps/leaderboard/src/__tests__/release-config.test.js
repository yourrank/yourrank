import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

const rootFile = (path) => readFile(new URL(`../../../../${path}`, import.meta.url), "utf8");

describe("release configuration", () => {
  it("gates production migration on the semantic N-1 compatibility suite", async () => {
    const [deploy, prCheck, baseline, packageJson] = await Promise.all([
      rootFile(".github/workflows/deploy.yml"),
      rootFile(".github/workflows/pr-check.yml"),
      rootFile("release/n1-production-baseline.json"),
      rootFile("package.json"),
    ]);

    expect(deploy).toContain("n1-compatibility:");
    expect(deploy).toContain("needs: n1-compatibility");
    expect(deploy).toContain("bun run verify:n1-compatibility");
    expect(prCheck).toContain("bun run verify:n1-compatibility");
    expect(packageJson).toContain('"verify:n1-compatibility"');

    const evidence = JSON.parse(baseline);
    expect(evidence.schema.baselineThrough).toBe("20260906000000");
    expect(evidence.workers.leaderboard.liveSourceSha).toBe("5fdcc1d005db05105b7ec645972eb6799af97d69");
    expect(evidence.workers.bot.liveSourceSha).toBe("d36b6253230e6dad3a535feacc02845e0463f52b");
    expect(evidence.workers.consumer.liveSourceSha).toBe("d36b6253230e6dad3a535feacc02845e0463f52b");
  });

  it("fails staging before code deployment and applies schema first", async () => {
    const workflow = await rootFile(".github/workflows/staging.yml");
    expect(workflow).toContain("Refuse incomplete or production-shared staging infrastructure");
    expect(workflow).toContain("supabase db push --include-all");
    expect(workflow).toContain("needs: [migrate-staging, deploy-web-staging, deploy-consumer-staging]");
    expect(workflow).toContain("command: deploy --env staging");
    expect(workflow).toContain("STAGING_RESEND_API_KEY");
    expect(workflow).toContain("STAGING_MAIL_FROM");
  });

  it("defines isolated staging queues, services, workers, and fail-closed rate limiting", async () => {
    const [leaderboard, bot, consumer, monitor, web] = await Promise.all([
      rootFile("apps/leaderboard/wrangler.toml"),
      rootFile("apps/bot/wrangler.toml"),
      rootFile("apps/consumer/wrangler.toml"),
      rootFile("apps/monitor/wrangler.toml"),
      rootFile("apps/web/wrangler.toml"),
    ]);
    expect(leaderboard).toContain('queue = "yourrank-events-staging"');
    expect(leaderboard).toContain('service = "yourrank-web-staging"');
    expect(leaderboard).toContain('ENVIRONMENT = "staging"');
    expect(leaderboard).toContain('new_sqlite_classes = ["RateLimiter", "LiveBoard"]');
    expect(bot).toContain('queue = "yourrank-events-staging"');
    expect(bot).toContain('RL_FAIL_OPEN = "false"');
    expect(bot).toContain('new_sqlite_classes = ["RateLimiter"]');
    expect(consumer).toContain('name = "yourrank-consumer-staging"');
    expect(consumer).toContain('dead_letter_queue = "yourrank-events-staging-dlq"');
    expect(monitor).toContain('MONITOR_TARGET = "https://staging.yourrank.site"');
    expect(monitor).toContain('MONITOR_BACKUP_CHECK = "true"');
    expect(web).toContain('name = "yourrank-web-staging"');
  });
});
