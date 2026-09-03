import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  parseProductionCrons,
  validateProductionCronCapacity,
} from "../../../../scripts/check-production-cron-capacity.mjs";
import { validateExpandMigration } from "../../../../scripts/check-migration-compatibility.mjs";
import {
  buildRecoveryPlan,
  latestDeploymentState,
  shouldRunRecovery,
  versionSpecs,
} from "../../../../scripts/release-recovery-state.mjs";

const rootFile = (path) => readFile(new URL(`../../../../${path}`, import.meta.url), "utf8");

const releaseState = ({ migrations = ["20260907000000"], leaderboard = "lb-old", bot = "bot-old", consumer = "consumer-old", monitor = "monitor-old", web = "web-old" } = {}) => ({
  schemaVersion: 1,
  migrations: migrations.map((version) => ({ version, name: version })),
  workers: {
    leaderboard: { scriptName: "yourrank-site", versions: [{ versionId: leaderboard, percentage: 100 }] },
    bot: { scriptName: "yourrank-bot", versions: [{ versionId: bot, percentage: 100 }] },
    consumer: { scriptName: "yourrank-consumer", versions: [{ versionId: consumer, percentage: 100 }] },
    monitor: { scriptName: "yourrank-monitor", versions: [{ versionId: monitor, percentage: 100 }] },
    web: { scriptName: "yourrank-web", versions: [{ versionId: web, percentage: 100 }] },
  },
});

const successfulStages = {
  migrate: "success",
  "deploy-leaderboard": "success",
  "deploy-bot": "success",
  "deploy-consumer": "success",
  "backend-readiness": "success",
  "deploy-monitor": "success",
  "deploy-web": "success",
  "web-readiness": "success",
  "release-smoke": "success",
};

describe("release configuration", () => {
  it("derives the five-trigger production inventory that fits Workers Free capacity", async () => {
    const free = await validateProductionCronCapacity({ plan: "free" });
    expect(free.required).toBe(5);
    expect(free.capacity).toBe(5);
    expect(free.workers.map(({ worker, crons }) => [worker, crons.length])).toEqual([
      ["Leaderboard", 1],
      ["Bot", 2],
      ["Consumer", 1],
      ["Monitor", 1],
    ]);

    const paid = await validateProductionCronCapacity({ plan: "paid" });
    expect(paid.required).toBe(5);
    expect(paid.capacity).toBe(250);

    await expect(validateProductionCronCapacity({ plan: "" })).rejects.toThrow(
      "CLOUDFLARE_WORKERS_PLAN must explicitly be 'free' or 'paid'",
    );
    await expect(validateProductionCronCapacity({
      plan: "free",
      inventory: [{ worker: "Bot", config: "apps/bot/wrangler.toml", expected: 3 }],
    })).rejects.toThrow("expected 3 production Cron Trigger(s) for Bot, found 2");
  });

  it("rejects the malformed array-table trigger syntax that Wrangler previously ignored", () => {
    expect(() => parseProductionCrons('name = "worker"\n[[triggers]]\ncrons = ["*/5 * * * *"]\n'))
      .toThrow("malformed [[triggers]] table");
    expect(() => parseProductionCrons('name = "worker"\n[triggers]\ncrons = ["*/5 * * * *", invalid]\n'))
      .toThrow("only double-quoted strings");
    expect(() => parseProductionCrons('name = "worker"\n[triggers]\ncrons = ["*/5 * * *"]\n'))
      .toThrow("invalid five-field Cron Trigger expression");
  });

  it("runs the capacity preflight before production migrations", async () => {
    const workflow = await rootFile(".github/workflows/deploy.yml");
    expect(workflow).toContain("release-preflight:");
    expect(workflow).toContain("node scripts/check-production-cron-capacity.mjs");
    expect(workflow).toContain("node scripts/check-migration-compatibility.mjs");
    expect(workflow).toContain("CLOUDFLARE_WORKERS_PLAN: ${{ vars.CLOUDFLARE_WORKERS_PLAN }}");
    expect(workflow).toMatch(/capture-release-state:[\s\S]*?needs: release-preflight/);
    expect(workflow).toMatch(/n1-compatibility:[\s\S]*?needs: release-preflight/);
    expect(workflow).toMatch(/migrate:\s+needs: \[capture-release-state, n1-compatibility\]/);
  });

  it("keeps automatic pre-deploy migrations expand-only", () => {
    expect(() => validateExpandMigration({
      name: "20260908000000_add_safe_column.sql",
      source: "-- yourrank:migration-phase: expand\nALTER TABLE sites ADD COLUMN safe_value text;",
    })).not.toThrow();

    expect(() => validateExpandMigration({
      name: "20260908000000_drop_live_column.sql",
      source: "-- yourrank:migration-phase: expand\nALTER TABLE sites DROP COLUMN slug;",
    })).toThrow("DROP object is not allowed");
    expect(() => validateExpandMigration({
      name: "20260908000001_unmarked.sql",
      source: "ALTER TABLE sites ADD COLUMN safe_value text;",
    })).toThrow("must declare");
    expect(() => validateExpandMigration({
      name: "20260908000002_dynamic_contract.sql",
      source: "-- yourrank:migration-phase: expand\nDO $$ BEGIN EXECUTE 'DROP TABLE sites'; END $$;",
    })).toThrow("DROP object is not allowed");
  });

  it("recovers a partially changed leaderboard when its deployment reports failure", () => {
    const baseline = releaseState();
    const current = releaseState({ migrations: ["20260907000000", "20260908000000"], leaderboard: "lb-new" });
    const stages = { ...successfulStages, "deploy-leaderboard": "failure", "deploy-bot": "skipped", "deploy-consumer": "skipped", "backend-readiness": "skipped", "deploy-monitor": "skipped", "deploy-web": "skipped", "web-readiness": "skipped", "release-smoke": "skipped" };
    expect(shouldRunRecovery({ captureResult: "success", stages })).toBe(true);
    const partialMutation = buildRecoveryPlan({ baseline, current, stages });
    expect(partialMutation.restoreTargets).toEqual(["leaderboard"]);
    expect(partialMutation.migrationsAdded.map(({ version }) => version)).toEqual(["20260908000000"]);

    const failedBeforeWorkerMutation = buildRecoveryPlan({
      baseline,
      current: releaseState({ migrations: ["20260907000000", "20260908000000"] }),
      stages,
    });
    expect(failedBeforeWorkerMutation.restoreTargets).toEqual([]);
    expect(failedBeforeWorkerMutation.mutationObserved).toBe(true);
  });

  it("restores only leaderboard when bot fails without changing production", () => {
    const stages = { ...successfulStages, "deploy-bot": "failure", "deploy-consumer": "skipped", "backend-readiness": "skipped", "deploy-monitor": "skipped", "deploy-web": "skipped", "web-readiness": "skipped", "release-smoke": "skipped" };
    const plan = buildRecoveryPlan({ baseline: releaseState(), current: releaseState({ leaderboard: "lb-new" }), stages });
    expect(plan.restoreTargets).toEqual(["leaderboard"]);
    expect(plan.unchangedWorkers).toContain("bot");

    const partialBotMutation = buildRecoveryPlan({
      baseline: releaseState(),
      current: releaseState({ leaderboard: "lb-new", bot: "bot-new" }),
      stages,
    });
    expect(partialBotMutation.restoreTargets).toEqual(["leaderboard", "bot"]);
  });

  it("detects a consumer partial mutation even when its deployment reports failure", () => {
    const stages = { ...successfulStages, "deploy-consumer": "failure", "backend-readiness": "skipped", "deploy-monitor": "skipped", "deploy-web": "skipped", "web-readiness": "skipped", "release-smoke": "skipped" };
    const plan = buildRecoveryPlan({
      baseline: releaseState(),
      current: releaseState({ leaderboard: "lb-new", bot: "bot-new", consumer: "consumer-new" }),
      stages,
    });
    expect(plan.restoreTargets).toEqual(["leaderboard", "bot", "consumer"]);
  });

  it("restores every changed backend Worker when backend readiness fails", () => {
    const stages = { ...successfulStages, "backend-readiness": "failure", "deploy-monitor": "skipped", "deploy-web": "skipped", "web-readiness": "skipped", "release-smoke": "skipped" };
    const plan = buildRecoveryPlan({
      baseline: releaseState(),
      current: releaseState({ leaderboard: "lb-new", bot: "bot-new", consumer: "consumer-new" }),
      stages,
    });
    expect(plan.restoreTargets).toEqual(["leaderboard", "bot", "consumer"]);
  });

  it("does not enter recovery when preflight prevented state capture and mutation", () => {
    expect(shouldRunRecovery({
      captureResult: "skipped",
      stages: Object.fromEntries(Object.keys(successfulStages).map((stage) => [stage, "skipped"])),
    })).toBe(false);
  });

  it("enters recovery for a cancelled release after mutation and targets observed changes", () => {
    const stages = { ...successfulStages, "deploy-consumer": "cancelled", "backend-readiness": "skipped", "deploy-monitor": "skipped", "deploy-web": "skipped", "web-readiness": "skipped", "release-smoke": "skipped" };
    expect(shouldRunRecovery({ captureResult: "success", stages })).toBe(true);
    expect(buildRecoveryPlan({
      baseline: releaseState(),
      current: releaseState({ leaderboard: "lb-new", bot: "bot-new" }),
      stages,
    }).restoreTargets).toEqual(["leaderboard", "bot"]);
  });

  it("captures the newest active Cloudflare deployment with exact version percentages", () => {
    const state = latestDeploymentState({ deployments: [
      { id: "deploy-new", created_on: "2026-09-02T12:00:00Z", versions: [
        { version_id: "aaaaaaaa-aaaa-aaaa-aaaa", percentage: 90 },
        { version_id: "bbbbbbbb-bbbb-bbbb-bbbb", percentage: 10 },
      ] },
      { id: "deploy-old", created_on: "2026-09-01T12:00:00Z", versions: [
        { version_id: "cccccccc-cccc-cccc-cccc", percentage: 100 },
      ] },
    ] }, "yourrank-site");
    expect(state.deploymentId).toBe("deploy-new");
    expect(versionSpecs(state)).toBe("aaaaaaaa-aaaa-aaaa-aaaa@90% bbbbbbbb-bbbb-bbbb-bbbb@10%");
  });

  it("rejects malformed Cloudflare deployment state instead of guessing a rollback target", () => {
    expect(() => latestDeploymentState({ deployments: [
      { id: "deploy-unknown", created_on: "not-a-timestamp", versions: [
        { version_id: "aaaaaaaa-aaaa-aaaa-aaaa", percentage: 100 },
      ] },
    ] }, "yourrank-site")).toThrow("without a valid id or timestamp");
  });

  it("keeps one always-evaluated finalizer connected to every production mutation stage", async () => {
    const workflow = await rootFile(".github/workflows/deploy.yml");
    expect(workflow).toContain("capture-release-state:");
    expect(workflow).toMatch(/migrate:\s+needs: \[capture-release-state, n1-compatibility\]/);
    expect(workflow).toContain("release-finalizer:");
    for (const job of ["migrate", "deploy-leaderboard", "deploy-bot", "deploy-consumer", "backend-readiness", "deploy-monitor", "deploy-web", "web-readiness", "release-smoke"]) {
      expect(workflow).toContain(`      - ${job}`);
      expect(workflow).toContain(`needs.${job}.result`);
    }
    expect(workflow).toContain("if: ${{ always() && needs.capture-release-state.result == 'success' }}");
    expect(workflow).toContain("node scripts/release-recovery-state.mjs plan");
    expect(workflow).toContain('wrangler versions deploy "${SPECS[@]}"');
    expect(workflow).toContain("node scripts/release-recovery-state.mjs verify");
    expect(workflow).not.toContain("command: rollback");
  });

  it("keeps recovery command and verification failures red", async () => {
    const workflow = await rootFile(".github/workflows/deploy.yml");
    const finalizer = workflow.slice(workflow.indexOf("  release-finalizer:"));
    const stages = { ...successfulStages, "deploy-leaderboard": "failure", "deploy-bot": "skipped", "deploy-consumer": "skipped", "backend-readiness": "skipped", "deploy-monitor": "skipped", "deploy-web": "skipped", "web-readiness": "skipped", "release-smoke": "skipped" };
    expect(buildRecoveryPlan({
      baseline: releaseState(),
      current: releaseState({ leaderboard: "lb-new" }),
      stages,
    }).restoreTargets).toEqual(["leaderboard"]);
    expect(finalizer).not.toContain("continue-on-error");
    expect(finalizer).toContain("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}");
    expect(finalizer).toContain("SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}");
    expect(finalizer).toContain("if: ${{ always() && steps.plan.outputs.release_failed == 'true' && steps.plan.outputs.worker_changes == 'true' }}");
    expect(finalizer).toContain("if: ${{ always() && steps.plan.outputs.release_failed == 'true' && steps.plan.outputs.bot_changed == 'true' }}");
    expect(finalizer).toContain("if: ${{ always() && steps.plan.outputs.release_failed == 'true' && steps.plan.outputs.mutation_observed == 'true' }}");
    expect(finalizer).toContain("if: ${{ always() && (steps.plan.outcome != 'success' || steps.plan.outputs.release_failed == 'true') }}");
    expect(finalizer).toContain("Recovered Worker versions did not return to a coherent healthy state after bounded retries");
    expect(finalizer).not.toMatch(/supabase\s+(?:db reset|migration down)/);
  });

  it("gates production migration on the semantic N-1 compatibility suite", async () => {
    const [deploy, prCheck, baseline, packageJson] = await Promise.all([
      rootFile(".github/workflows/deploy.yml"),
      rootFile(".github/workflows/pr-check.yml"),
      rootFile("release/n1-production-baseline.json"),
      rootFile("package.json"),
    ]);

    expect(deploy).toContain("n1-compatibility:");
    expect(deploy).toMatch(/migrate:\s+needs: \[capture-release-state, n1-compatibility\]/);
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
    expect(workflow).toContain("node scripts/staging-preflight.mjs environment");
    expect(workflow).toContain("node scripts/staging-preflight.mjs render");
    expect(workflow).toContain("supabase db push --include-all");
    expect(workflow).toContain("needs: [capture-staging-state, n1-compatibility]");
    expect(workflow).toMatch(/deploy-leaderboard-staging:\n(?:.*\n){1,3}\s+needs: migrate-staging/);
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
