import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  BACKEND_WORKERS,
  RELEASE_STAGES,
  RELEASE_WORKERS,
  buildRecoveryPlan,
  buildReleaseManifest,
  shouldRunRecovery,
  versionSourceSha,
  versionTag,
} from "../../../../scripts/release-recovery-state.mjs";

const rootFile = (path) => readFile(new URL(`../../../../${path}`, import.meta.url), "utf8");

const OLD_SHA = "d36b6253230e6dad3a535feacc02845e0463f52b";
const NEW_SHA = "5fdcc1d005db05105b7ec645972eb6799af97d69";

const worker = (scriptName, versionId, tag) => ({ scriptName, versions: [{ versionId, percentage: 100, tag }] });

const releaseState = ({
  migrations = ["20260907000000"],
  leaderboard = ["lb-old", OLD_SHA],
  bot = ["bot-old", OLD_SHA],
  consumer = ["consumer-old", OLD_SHA],
  monitor = ["monitor-old", OLD_SHA],
  web = ["web-old", OLD_SHA],
} = {}) => ({
  schemaVersion: 1,
  migrations: migrations.map((version) => ({ version, name: version })),
  workers: {
    leaderboard: worker("yourrank-site", ...leaderboard),
    bot: worker("yourrank-bot", ...bot),
    consumer: worker("yourrank-consumer", ...consumer),
    monitor: worker("yourrank-monitor", ...monitor),
    web: worker("yourrank-web", ...web),
  },
});

const fullyPromoted = releaseState({
  migrations: ["20260907000000", "20260908000000"],
  leaderboard: ["lb-new", NEW_SHA],
  bot: ["bot-new", NEW_SHA],
  consumer: ["consumer-new", NEW_SHA],
  monitor: ["monitor-new", NEW_SHA],
  web: ["web-new", NEW_SHA],
});

const backendPromoted = releaseState({
  migrations: ["20260907000000", "20260908000000"],
  leaderboard: ["lb-new", NEW_SHA],
  bot: ["bot-new", NEW_SHA],
  consumer: ["consumer-new", NEW_SHA],
  monitor: ["monitor-new", NEW_SHA],
});

// Stage results as GitHub Actions reports them: `failure`/`cancelled` for the
// stage that broke, `skipped` for every downstream job whose `needs` did not succeed.
const stagesAfter = (failedStage, result = "failure") => {
  const index = RELEASE_STAGES.indexOf(failedStage);
  return Object.fromEntries(RELEASE_STAGES.map((stage, position) => [
    stage,
    position < index ? "success" : position === index ? result : "skipped",
  ]));
};
const allSuccess = Object.fromEntries(RELEASE_STAGES.map((stage) => [stage, "success"]));

const workflow = await rootFile(".github/workflows/deploy.yml");
const webWorkflow = await rootFile(".github/workflows/deploy-web.yml");
const rollbackWorkflow = await rootFile(".github/workflows/rollback.yml");
const jobBlock = (source, job) => {
  const start = source.indexOf(`\n  ${job}:\n`);
  const rest = source.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
};
const needsOf = (job) => {
  const block = jobBlock(workflow, job);
  const inline = block.match(/\n {4}needs: (\[[^\]]*\]|[a-z-]+)\n/);
  if (inline) return inline[1].startsWith("[") ? inline[1].slice(1, -1).split(",").map((s) => s.trim()) : [inline[1]];
  const list = block.match(/\n {4}needs:\n((?: {6}- [a-z-]+\n)+)/);
  return list ? list[1].trim().split("\n").map((line) => line.replace(/^\s*- /, "")) : [];
};
const transitiveNeeds = (job, seen = new Set()) => {
  for (const dependency of needsOf(job)) {
    if (!seen.has(dependency)) {
      seen.add(dependency);
      transitiveNeeds(dependency, seen);
    }
  }
  return seen;
};

describe("F-005 coherent Web/backend production promotion", () => {
  it("1. preflight fails → no production mutation and no recovery entry", () => {
    const stages = Object.fromEntries(RELEASE_STAGES.map((stage) => [stage, "skipped"]));
    expect(needsOf("capture-release-state")).toEqual(["release-preflight"]);
    expect(needsOf("n1-compatibility")).toEqual(["release-preflight"]);
    expect(transitiveNeeds("migrate")).toContain("release-preflight");
    expect(transitiveNeeds("deploy-web")).toContain("release-preflight");
    expect(shouldRunRecovery({ captureResult: "skipped", stages })).toBe(false);
    expect(jobBlock(workflow, "release-finalizer")).toContain("if: ${{ always() && needs.capture-release-state.result == 'success' }}");
  });

  it("2. migration fails → Web does not deploy", () => {
    expect(transitiveNeeds("deploy-web")).toContain("migrate");
    const plan = buildRecoveryPlan({ baseline: releaseState(), current: releaseState(), stages: stagesAfter("migrate") });
    expect(plan.releaseFailed).toBe(true);
    expect(plan.workers.web.changed).toBe(false);
    expect(plan.restoreTargets).toEqual([]);
  });

  for (const [number, stage] of [[3, "deploy-leaderboard"], [4, "deploy-bot"], [5, "deploy-consumer"]]) {
    it(`${number}. ${stage} fails → Web does not deploy and is not restored`, () => {
      expect(transitiveNeeds("deploy-web")).toContain(stage);
      const stages = stagesAfter(stage);
      expect(stages["deploy-web"]).toBe("skipped");
      const plan = buildRecoveryPlan({
        baseline: releaseState(),
        current: releaseState({ migrations: ["20260907000000", "20260908000000"], leaderboard: ["lb-new", NEW_SHA] }),
        stages,
      });
      expect(plan.releaseFailed).toBe(true);
      expect(plan.restoreTargets).toEqual(["leaderboard"]);
      expect(plan.workers.web.changed).toBe(false);
      expect(plan.migrationsAdded.map(({ version }) => version)).toEqual(["20260908000000"]);
    });
  }

  it("6. backend readiness fails → Web does not deploy; readiness never consults Web", () => {
    expect(needsOf("deploy-web")).toEqual(["backend-readiness", "deploy-monitor"]);
    expect(needsOf("deploy-monitor")).toEqual(["backend-readiness"]);
    const readiness = jobBlock(workflow, "backend-readiness");
    expect(readiness).not.toContain("/pricing");
    expect(readiness).not.toContain("app.yourrank.site");
    expect(readiness).not.toContain("x-yr-marketing");
    const plan = buildRecoveryPlan({ baseline: releaseState(), current: backendPromoted, stages: stagesAfter("backend-readiness") });
    expect(plan.restoreTargets).toEqual(["leaderboard", "bot", "consumer", "monitor"]);
    expect(plan.workers.web.changed).toBe(false);
  });

  it("7. backend succeeds → Web fails before mutation: backend restored, Web untouched", () => {
    const stages = stagesAfter("deploy-web");
    expect(shouldRunRecovery({ captureResult: "success", stages })).toBe(true);
    const plan = buildRecoveryPlan({ baseline: releaseState(), current: backendPromoted, stages });
    expect(plan.restoreTargets).toEqual(["leaderboard", "bot", "consumer", "monitor"]);
    expect(plan.workers.web.changed).toBe(false);
    expect(plan.migrationsMissing).toEqual([]);
  });

  it("8. Web mutates then its deployment command fails: observed Web change is restored exactly", () => {
    const current = {
      ...fullyPromoted,
      workers: {
        ...fullyPromoted.workers,
        web: { scriptName: "yourrank-web", versions: [
          { versionId: "web-new", percentage: 50, tag: NEW_SHA },
          { versionId: "web-old", percentage: 50, tag: OLD_SHA },
        ] },
      },
    };
    const plan = buildRecoveryPlan({ baseline: releaseState(), current, stages: stagesAfter("deploy-web") });
    expect(plan.restoreTargets).toContain("web");
    expect(plan.workers.web.restoreSpecs).toBe("web-old@100%");
    const finalizer = jobBlock(workflow, "release-finalizer");
    expect(finalizer).toContain("if: ${{ always() && steps.plan.outputs.release_failed == 'true' && steps.plan.outputs.web_changed == 'true' }}");
    expect(finalizer).toMatch(/working-directory: apps\/web\n\s+env:\n\s+VERSION_SPECS: \$\{\{ steps\.plan\.outputs\.web_restore_specs \}\}/);
    expect(finalizer).toContain("steps.plan.outputs.web_health_required == 'true'");
  });

  it("9. Web succeeds → final integration smoke fails: every Worker including Web is restored", () => {
    expect(needsOf("release-smoke")).toEqual(["backend-readiness", "web-readiness"]);
    const stages = stagesAfter("release-smoke");
    const plan = buildRecoveryPlan({ baseline: releaseState(), current: fullyPromoted, stages });
    expect(plan.restoreTargets).toEqual(["leaderboard", "bot", "consumer", "monitor", "web"]);
    expect(plan.migrationsAdded.map(({ version }) => version)).toEqual(["20260908000000"]);
    const manifest = buildReleaseManifest({ intendedReleaseSha: NEW_SHA, state: fullyPromoted, stages });
    expect(manifest.promotion).toBe("refused");
    expect(manifest.promotedReleaseSha).toBeNull();
    expect(manifest.stagesFailed).toEqual(["release-smoke"]);
  });

  it("10. successful coherent release promotes exactly the intended SHA with full provenance", () => {
    const plan = buildRecoveryPlan({ baseline: releaseState(), current: fullyPromoted, stages: allSuccess });
    expect(plan.releaseFailed).toBe(false);
    const manifest = buildReleaseManifest({ intendedReleaseSha: NEW_SHA, state: fullyPromoted, stages: allSuccess });
    expect(manifest.promotion).toBe("promoted");
    expect(manifest.promotedReleaseSha).toBe(NEW_SHA);
    expect(manifest.incoherentWorkers).toEqual([]);
    for (const { key } of RELEASE_WORKERS) expect(manifest.workers[key].sourceSha).toBe(NEW_SHA);
    expect(manifest.database).toEqual({ migrationVersion: "20260908000000", migrationName: "20260908000000", appliedMigrations: 2 });
    const finalizer = jobBlock(workflow, "release-finalizer");
    expect(finalizer).toContain("node scripts/release-recovery-state.mjs promote");
    expect(finalizer).toContain("RELEASE_MANIFEST_PATH:");
    expect(finalizer).toContain("actions/upload-artifact");
  });

  it("11. cancellation before mutation: recovery runs and finds nothing to restore", () => {
    const stages = stagesAfter("migrate", "cancelled");
    expect(shouldRunRecovery({ captureResult: "success", stages })).toBe(true);
    const plan = buildRecoveryPlan({ baseline: releaseState(), current: releaseState(), stages });
    expect(plan.mutationObserved).toBe(false);
    expect(plan.restoreTargets).toEqual([]);
  });

  it("12. cancellation after backend mutation restores observed backend changes only", () => {
    const plan = buildRecoveryPlan({
      baseline: releaseState(),
      current: releaseState({ migrations: ["20260907000000", "20260908000000"], leaderboard: ["lb-new", NEW_SHA], bot: ["bot-new", NEW_SHA] }),
      stages: stagesAfter("deploy-consumer", "cancelled"),
    });
    expect(plan.restoreTargets).toEqual(["leaderboard", "bot"]);
    expect(plan.workers.web.changed).toBe(false);
    expect(plan.migrationsAdded).toHaveLength(1);
  });

  it("13. cancellation after Web mutation restores Web with the backend", () => {
    const plan = buildRecoveryPlan({ baseline: releaseState(), current: fullyPromoted, stages: stagesAfter("web-readiness", "cancelled") });
    expect(plan.releaseFailed).toBe(true);
    expect(plan.restoreTargets).toEqual(["leaderboard", "bot", "consumer", "monitor", "web"]);
  });

  it("14. recovery command failure leaves the release red", () => {
    const finalizer = jobBlock(workflow, "release-finalizer");
    expect(finalizer).not.toContain("continue-on-error");
    expect(finalizer.match(/wrangler versions deploy "\$\{SPECS\[@\]\}" -y/g)).toHaveLength(RELEASE_WORKERS.length);
    expect(finalizer).toContain("node scripts/release-recovery-state.mjs verify");
    expect(finalizer).toContain("Recovered Web version did not return to a healthy state after bounded retries");
    expect(finalizer).toContain("exit 1");
    expect(finalizer).not.toMatch(/supabase\s+(?:db reset|migration down)/);
  });

  it("15. packages/shared (or any) change cannot independently promote Web to production", () => {
    expect(webWorkflow).not.toMatch(/\n\s+push:/);
    expect(webWorkflow).not.toContain("packages/shared/**");
    expect(webWorkflow).not.toContain("- production");
    expect(webWorkflow).toContain("environment: staging");
    expect(webWorkflow).toContain("--env staging");
    expect(webWorkflow).not.toMatch(/deploy:ci(?![^\n]*--env staging)/);
    expect(workflow).toMatch(/on:\n\s+push:\n\s+branches: \[main\]\n\s+workflow_dispatch/);
    expect(jobBlock(workflow, "deploy-web")).toContain("environment: production");
  });

  it("16. the same commit SHA tags every release component and promotion refuses skew", () => {
    const taggedDeploys = workflow.match(/--tag \$\{\{ github\.sha \}\}|--tag "\$\{\{ github\.sha \}\}"/g);
    expect(taggedDeploys).toHaveLength(RELEASE_WORKERS.length);
    expect(jobBlock(workflow, "deploy-web")).toContain("uses: actions/checkout@v7");
    expect(jobBlock(workflow, "deploy-web")).not.toContain("ref:");

    expect(versionTag({ annotations: { "workers/tag": NEW_SHA } })).toBe(NEW_SHA);
    expect(versionTag({ annotations: {} })).toBeNull();
    expect(versionSourceSha(worker("yourrank-web", "web-new", NEW_SHA))).toBe(NEW_SHA);
    expect(versionSourceSha({ versions: [{ versionId: "a", percentage: 50, tag: NEW_SHA }, { versionId: "b", percentage: 50, tag: OLD_SHA }] })).toBeNull();

    const skewed = { ...fullyPromoted, workers: { ...fullyPromoted.workers, web: worker("yourrank-web", "web-stale", OLD_SHA) } };
    const manifest = buildReleaseManifest({ intendedReleaseSha: NEW_SHA, state: skewed, stages: allSuccess });
    expect(manifest.promotion).toBe("refused");
    expect(manifest.promotedReleaseSha).toBeNull();
    expect(manifest.incoherentWorkers).toEqual(["web"]);
    expect(buildReleaseManifest({ intendedReleaseSha: NEW_SHA, state: fullyPromoted, stages: { ...allSuccess, "deploy-monitor": "skipped" } }).stagesIncomplete).toEqual(["deploy-monitor"]);
    expect(() => buildReleaseManifest({ intendedReleaseSha: "abc", state: fullyPromoted, stages: allSuccess })).toThrow("40-character");
  });

  it("validates GitHub Actions needs/always/skip/cancel/concurrency semantics", () => {
    // Sequential mutation chain: migrate → leaderboard → bot → consumer → readiness → monitor → web → web readiness → smoke.
    expect(needsOf("deploy-leaderboard")).toEqual(["migrate"]);
    expect(needsOf("deploy-bot")).toEqual(["migrate", "deploy-leaderboard"]);
    expect(needsOf("deploy-consumer")).toEqual(["migrate", "deploy-bot"]);
    expect(needsOf("backend-readiness")).toEqual(["deploy-leaderboard", "deploy-bot", "deploy-consumer"]);
    expect(needsOf("web-readiness")).toEqual(["deploy-web"]);
    // No mutation job uses always()/failure(), so a failed or cancelled dependency skips every downstream mutation.
    for (const job of ["migrate", "deploy-leaderboard", "deploy-bot", "deploy-consumer", "deploy-monitor", "deploy-web"]) {
      expect(jobBlock(workflow, job)).not.toContain("always()");
      expect(jobBlock(workflow, job)).not.toContain("failure()");
    }
    // The finalizer is the only always() job and needs every stage so skipped/cancelled results are visible to it.
    expect(needsOf("release-finalizer")).toEqual(["capture-release-state", ...RELEASE_STAGES]);
    expect(workflow.match(/always\(\) && needs\.capture-release-state\.result == 'success'/g)).toHaveLength(1);
    expect(BACKEND_WORKERS).toEqual(["leaderboard", "bot", "consumer", "monitor"]);
    // One shared production mutation lock across release and manual rollback; no cancel-in-progress.
    expect(workflow).toMatch(/concurrency:\n\s+group: production-mutation\n\s+cancel-in-progress: false/);
    expect(rollbackWorkflow).toMatch(/concurrency:\n\s+group: production-mutation\n\s+cancel-in-progress: false/);
    expect(rollbackWorkflow).toContain("- web");
    expect(webWorkflow).not.toContain("group: deploy-web\n");
    expect(webWorkflow).toContain("group: deploy-web-staging");
  });
});
