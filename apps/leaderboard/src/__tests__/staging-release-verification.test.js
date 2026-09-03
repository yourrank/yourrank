// F-012: staging must be a production-like, fully isolated release verification
// environment that fails closed on placeholder or production-shared infrastructure.
import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  PRODUCTION_RESOURCES,
  STAGING_ENVIRONMENT_CONTRACT,
  STAGING_HYPERDRIVE_PLACEHOLDER,
  STAGING_QUEUES,
  STAGING_WORKERS,
  checkStagingConfig,
  checkStagingConfigs,
  checkStagingEnvironment,
  checkWorkerSecrets,
  parseDisabledIntegrations,
  parseSecretNames,
  renderStagingHyperdrive,
} from "../../../../scripts/staging-preflight.mjs";
import {
  PRODUCTION_SUPABASE_PROJECT_REF,
  RELEASE_STAGES,
  RELEASE_WORKERS,
  STAGING_RELEASE_WORKERS,
  buildRecoveryPlan,
  buildReleaseManifest,
  releaseEnvironment,
} from "../../../../scripts/release-recovery-state.mjs";

const rootFile = (path) => readFile(new URL(`../../../../${path}`, import.meta.url), "utf8");

const STAGING_HYPERDRIVE = "0123456789abcdef0123456789abcdef";

const readRepoConfig = (path) => rootFile(path);
const readRendered = async (path) => {
  const source = await rootFile(path);
  return source.includes(STAGING_HYPERDRIVE_PLACEHOLDER) ? renderStagingHyperdrive(source, STAGING_HYPERDRIVE, path) : source;
};

const worker = (key) => STAGING_WORKERS.find((candidate) => candidate.key === key);

const validEnvironment = () => ({
  STAGING_HYPERDRIVE_ID: STAGING_HYPERDRIVE,
  STAGING_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
  STAGING_WEB_URL: "https://yourrank-web-staging.example.workers.dev",
  STAGING_MONITOR_URL: "https://yourrank-monitor-staging.example.workers.dev",
  CLOUDFLARE_API_TOKEN: "x",
  CLOUDFLARE_ACCOUNT_ID: "x",
  STAGING_SUPABASE_ACCESS_TOKEN: "x",
  STAGING_SUPABASE_DB_PASSWORD: "x",
  STAGING_RESEND_API_KEY: "x",
  STAGING_MAIL_FROM: "x",
  STAGING_TOKEN_ENC_KEY: "a".repeat(64),
  STAGING_IP_HASH_SALT: "x",
  STAGING_MONITOR_CHECK_SECRET: "x",
});

const stagingWorkflowPromise = rootFile(".github/workflows/staging.yml");
const deployWorkflowPromise = rootFile(".github/workflows/deploy.yml");
const rollbackWorkflowPromise = rootFile(".github/workflows/rollback.yml");
const contractWorkflowPromise = rootFile(".github/workflows/contract-migration.yml");
const webWorkflowPromise = rootFile(".github/workflows/deploy-web.yml");

const workerState = (scriptName, versionId, tag) => ({
  scriptName,
  versions: [{ versionId, percentage: 100, ...(tag ? { tag } : {}) }],
});
const stagingState = ({ migrations = ["20260907000000"], versions = {}, tag } = {}) => ({
  schemaVersion: 1,
  migrations: migrations.map((version) => ({ version, name: version })),
  workers: Object.fromEntries(STAGING_RELEASE_WORKERS.map((entry) => [
    entry.key,
    workerState(entry.scriptName, versions[entry.key] ?? `${entry.key}-old`, tag),
  ])),
});
const allStages = (overrides = {}) => ({ ...Object.fromEntries(RELEASE_STAGES.map((stage) => [stage, "success"])), ...overrides });

const jobBlock = (workflow, job) => {
  const match = workflow.match(new RegExp(`\\n  ${job}:\\n([\\s\\S]*?)(?=\\n  [a-z0-9-]+:\\n|$)`));
  if (!match) throw new Error(`job ${job} missing`);
  return match[1];
};

describe("F-012 staging release verification", () => {
  it("fails closed while the checked-in configs still carry the Hyperdrive placeholder", async () => {
    const problems = await checkStagingConfigs(readRepoConfig);
    const placeholderProblems = problems.filter((problem) => problem.includes(STAGING_HYPERDRIVE_PLACEHOLDER));
    expect(placeholderProblems.map((problem) => problem.split(":")[0]).sort()).toEqual([
      "apps/bot/wrangler.toml",
      "apps/consumer/wrangler.toml",
      "apps/leaderboard/wrangler.toml",
      "apps/web/wrangler.toml",
    ]);
    // The placeholder is the ONLY thing standing between the configs and a deploy.
    expect(problems).toEqual(placeholderProblems);
  });

  it("renders a real staging Hyperdrive id so no placeholder remains in deployable config", async () => {
    expect(await checkStagingConfigs(readRendered)).toEqual([]);
    for (const { config } of STAGING_WORKERS.filter((candidate) => candidate.hyperdrive)) {
      const rendered = await readRendered(config);
      expect(rendered).not.toContain(STAGING_HYPERDRIVE_PLACEHOLDER);
      expect(rendered.slice(rendered.indexOf("[env.staging]"))).not.toContain(PRODUCTION_RESOURCES.hyperdriveId);
    }
    const source = await rootFile("apps/leaderboard/wrangler.toml");
    expect(() => renderStagingHyperdrive(source, PRODUCTION_RESOURCES.hyperdriveId)).toThrow("PRODUCTION Hyperdrive");
    expect(() => renderStagingHyperdrive(source, STAGING_HYPERDRIVE_PLACEHOLDER)).toThrow("32-character hex");
    expect(() => renderStagingHyperdrive(source, "")).toThrow("32-character hex");
    const rendered = renderStagingHyperdrive(source, STAGING_HYPERDRIVE);
    expect(() => renderStagingHyperdrive(rendered, STAGING_HYPERDRIVE)).toThrow("expected exactly one");
  });

  it("rejects staging configs that reference known production resource ids", async () => {
    const source = await readRendered("apps/leaderboard/wrangler.toml");
    const staging = source.indexOf("[env.staging]");
    const swap = (from, to) => source.slice(0, staging) + source.slice(staging).replaceAll(from, to);
    expect(checkStagingConfig(worker("leaderboard"), swap(STAGING_HYPERDRIVE, PRODUCTION_RESOURCES.hyperdriveId)).join("\n")).toContain("PRODUCTION Hyperdrive");
    expect(checkStagingConfig(worker("leaderboard"), swap(STAGING_QUEUES.events, "yourrank-events")).join("\n")).toContain("PRODUCTION queue yourrank-events");
    expect(checkStagingConfig(worker("leaderboard"), swap('name = "yourrank-site-staging"', 'name = "yourrank-site"')).join("\n")).toContain("production Worker");
    expect(checkStagingConfig(worker("leaderboard"), swap("yourrank-web-staging", "yourrank-web")).join("\n")).toContain("PRODUCTION Worker yourrank-web");
    expect(checkStagingConfig(worker("leaderboard"), swap("staging.yourrank.site/*", "yourrank.site/*")).join("\n")).toContain("not on staging.yourrank.site");

    const consumer = await readRendered("apps/consumer/wrangler.toml");
    const consumerStaging = consumer.indexOf("[env.staging]");
    const consumerSwap = consumer.slice(0, consumerStaging) + consumer.slice(consumerStaging).replaceAll(STAGING_QUEUES.dlq, "yourrank-events-dlq");
    expect(checkStagingConfig(worker("consumer"), consumerSwap).join("\n")).toContain("PRODUCTION queue yourrank-events-dlq");
  });

  it("fails preflight when a required staging binding is missing or drifts", async () => {
    const leaderboard = await readRendered("apps/leaderboard/wrangler.toml");
    const withoutHyperdrive = leaderboard.replace(/\[\[env\.staging\.hyperdrive\]\]\n(?:.*\n)*?id = "[0-9a-f]{32}"\n/, "");
    expect(checkStagingConfig(worker("leaderboard"), withoutHyperdrive).join("\n")).toContain("expected exactly one [[env.staging.hyperdrive]]");
    const withDirectDb = leaderboard.replace("[env.staging.vars]", '[env.staging.vars]\nlocalConnectionString = "postgres://x"');
    expect(checkStagingConfig(worker("leaderboard"), withDirectDb).join("\n")).toContain("direct database connection string");
    const withoutLiveBoard = leaderboard.replace(/\[\[env\.staging\.durable_objects\.bindings\]\]\nname = "LIVE_BOARD_DO"\nclass_name = "LiveBoard"\n/, "");
    expect(withoutLiveBoard).not.toBe(leaderboard);
    expect(checkStagingConfig(worker("leaderboard"), withoutLiveBoard).join("\n")).toContain("missing staging Durable Object binding LIVE_BOARD_DO");
    const withoutTag = leaderboard.replace('[[env.staging.migrations]]\ntag = "v1"\n', "[[env.staging.migrations]]\n");
    expect(checkStagingConfig(worker("leaderboard"), withoutTag).join("\n")).toContain("must declare a tag for every entry");
    const withoutMarketing = leaderboard.replace(/\[\[env\.staging\.services\]\]\nbinding = "MARKETING"\nservice = "yourrank-web-staging"\n/, "");
    expect(checkStagingConfig(worker("leaderboard"), withoutMarketing).join("\n")).toContain("missing staging service binding MARKETING");
    const withCron = leaderboard.replace(/(\[env\.staging\.triggers\]\ncrons = )\[\]/, '$1["*/5 * * * *"]');
    expect(checkStagingConfig(worker("leaderboard"), withCron).join("\n")).toContain("staging crons must be disabled");
    const withoutTriggers = leaderboard.replace(/\[env\.staging\.triggers\]\ncrons = \[\]\n/, "");
    expect(checkStagingConfig(worker("leaderboard"), withoutTriggers).join("\n")).toContain("[env.staging.triggers] must declare crons explicitly");

    const consumer = await readRendered("apps/consumer/wrangler.toml");
    const withoutDlq = consumer.replace(/\[\[env\.staging\.queues\.consumers\]\]\nqueue = "yourrank-events-staging-dlq"\n(?:.*\n)*?max_retries = 3\n/, "");
    expect(checkStagingConfig(worker("consumer"), withoutDlq).join("\n")).toContain("missing staging DLQ consumer");
    const loopingDlq = consumer.replace(/(queue = "yourrank-events-staging-dlq"\n(?:.*\n)*?max_retries = 3\n)/, '$1dead_letter_queue = "yourrank-events-staging-dlq"\n');
    expect(checkStagingConfig(worker("consumer"), loopingDlq).join("\n")).toContain("DLQ-to-DLQ loop");
  });

  it("fails preflight when a required staging variable or secret is missing and never accepts production names", () => {
    expect(checkStagingEnvironment(validEnvironment())).toEqual([]);
    for (const name of STAGING_ENVIRONMENT_CONTRACT.requiredSecrets) {
      const env = validEnvironment();
      delete env[name];
      expect(checkStagingEnvironment(env)).toEqual([`Required staging secret ${name} is not set in the GitHub staging environment.`]);
    }
    for (const name of STAGING_ENVIRONMENT_CONTRACT.requiredVars) {
      const env = validEnvironment();
      env[name] = "";
      expect(checkStagingEnvironment(env)).toEqual([`Required staging variable ${name} is not set in the GitHub staging environment.`]);
    }
    expect(checkStagingEnvironment({ ...validEnvironment(), SUPABASE_PROJECT_REF: PRODUCTION_SUPABASE_PROJECT_REF })).toEqual([
      "Production-only SUPABASE_PROJECT_REF must not be exposed to the staging release.",
    ]);
    expect(checkStagingEnvironment({ ...validEnvironment(), DATABASE_URL: "postgres://prod" })).toEqual([
      "Production-only DATABASE_URL must not be exposed to the staging release.",
    ]);
    expect(checkStagingEnvironment({ ...validEnvironment(), STAGING_SUPABASE_PROJECT_REF: PRODUCTION_SUPABASE_PROJECT_REF })).toEqual([
      "STAGING_SUPABASE_PROJECT_REF is the PRODUCTION Supabase project.",
    ]);
    expect(checkStagingEnvironment({ ...validEnvironment(), STAGING_HYPERDRIVE_ID: PRODUCTION_RESOURCES.hyperdriveId })).toEqual([
      "STAGING_HYPERDRIVE_ID is the PRODUCTION Hyperdrive id.",
    ]);
    expect(checkStagingEnvironment({ ...validEnvironment(), STAGING_WEB_URL: "https://app.yourrank.site" })).toEqual([
      "STAGING_WEB_URL points at production host app.yourrank.site.",
    ]);
  });

  it("accepts an intentionally disabled integration only when it is explicitly declared", () => {
    const bot = worker("bot");
    const configured = ["TOKEN_ENC_KEY", "IP_HASH_SALT"];
    const undeclared = checkWorkerSecrets(bot, configured, parseDisabledIntegrations(""));
    expect(undeclared.problems.join("\n")).toContain("integration telegram is missing LOGIN_BOT_TOKEN, LOGIN_BOT_USERNAME and is not declared in STAGING_DISABLED_INTEGRATIONS");
    const optional = "discord-monitoring,sentry";
    const declared = checkWorkerSecrets(bot, configured, parseDisabledIntegrations(`telegram,${optional}`));
    expect(declared.problems).toEqual([]);
    expect(declared.report).toContain("telegram: INTENTIONALLY DISABLED");
    const real = checkWorkerSecrets(bot, [...configured, "LOGIN_BOT_TOKEN", "LOGIN_BOT_USERNAME"], parseDisabledIntegrations(optional));
    expect(real.problems).toEqual([]);
    expect(real.report).toContain("telegram: REAL AND ISOLATED (configured)");
    expect(() => parseDisabledIntegrations("telegram,mystery")).toThrow("unknown integrations: mystery");

    // Missing required secret and forbidden direct-DB secret both fail regardless of declarations.
    const missing = checkWorkerSecrets(bot, ["IP_HASH_SALT"], parseDisabledIntegrations(`telegram,${optional}`));
    expect(missing.problems).toEqual(["yourrank-bot-staging: required secret TOKEN_ENC_KEY is not set."]);
    const direct = checkWorkerSecrets(worker("consumer"), ["DATABASE_URL"], parseDisabledIntegrations(""));
    expect(direct.problems.join("\n")).toContain("forbidden secret DATABASE_URL is set");
    expect(parseSecretNames('⛅️ wrangler\n[{"name":"A","type":"secret_text"},{"name":"B","type":"secret_text"}]')).toEqual(["A", "B"]);
  });

  it("keeps staging queues, DLQ, database and Hyperdrive distinct from production", async () => {
    expect(PRODUCTION_RESOURCES.queues).not.toContain(STAGING_QUEUES.events);
    expect(PRODUCTION_RESOURCES.queues).not.toContain(STAGING_QUEUES.dlq);
    expect(STAGING_QUEUES.events).not.toBe(STAGING_QUEUES.dlq);
    expect(STAGING_HYPERDRIVE).not.toBe(PRODUCTION_RESOURCES.hyperdriveId);
    for (const { config } of STAGING_WORKERS) {
      const source = await rootFile(config);
      const staging = source.slice(source.indexOf("[env.staging]"));
      expect(staging).not.toContain(PRODUCTION_RESOURCES.hyperdriveId);
      expect(staging).not.toContain(PRODUCTION_SUPABASE_PROJECT_REF);
      expect(staging).not.toMatch(/queue = "yourrank-events"/);
      expect(staging).not.toMatch(/queue = "yourrank-events-dlq"/);
      expect(staging).not.toContain("localConnectionString");
    }
    const staging = await stagingWorkflowPromise;
    expect(staging).not.toContain(`SUPABASE_PROJECT_REF: ${PRODUCTION_SUPABASE_PROJECT_REF}`);
    expect(staging).toContain("SUPABASE_PROJECT_REF: ${{ vars.STAGING_SUPABASE_PROJECT_REF }}");
    expect(staging).not.toContain("secrets.SUPABASE_ACCESS_TOKEN");
    expect(staging).not.toContain("secrets.SUPABASE_DB_PASSWORD");
    expect(staging).toContain(`"${PRODUCTION_SUPABASE_PROJECT_REF}" ]; then`); // explicit refusal guard only
  });

  it("uses staging Worker names for capture/recovery and refuses the production Supabase project", () => {
    expect(STAGING_RELEASE_WORKERS.map((entry) => entry.scriptName)).toEqual([
      "yourrank-site-staging",
      "yourrank-bot-staging",
      "yourrank-consumer-staging",
      "yourrank-monitor-staging",
      "yourrank-web-staging",
    ]);
    expect(STAGING_RELEASE_WORKERS.map((entry) => entry.key)).toEqual(RELEASE_WORKERS.map((entry) => entry.key));
    expect(releaseEnvironment("staging").workers).toBe(STAGING_RELEASE_WORKERS);
    expect(releaseEnvironment("production").workers).toBe(RELEASE_WORKERS);
    expect(() => releaseEnvironment("prod-ish")).toThrow("RELEASE_ENVIRONMENT must be one of production, staging");
    const sha = "b".repeat(40);
    const manifest = buildReleaseManifest({
      intendedReleaseSha: sha,
      state: stagingState({ tag: sha }),
      stages: allStages(),
      releaseWorkers: STAGING_RELEASE_WORKERS,
      environment: "staging",
    });
    expect(manifest.environment).toBe("staging");
    expect(manifest.promotion).toBe("promoted");
    expect(manifest.workers.leaderboard.scriptName).toBe("yourrank-site-staging");
    expect(() => buildReleaseManifest({ intendedReleaseSha: sha, state: stagingState({ tag: sha }), stages: allStages(), environment: "qa" })).toThrow("RELEASE_ENVIRONMENT");
  });

  it("recovery detects changed staging Workers from observed state and retains migrations", () => {
    const baseline = stagingState();
    const current = stagingState({
      migrations: ["20260907000000", "20260908000000"],
      versions: { leaderboard: "lb-new", bot: "bot-new", consumer: "consumer-new" },
    });
    const stages = allStages({
      "backend-readiness": "failure",
      "deploy-monitor": "skipped",
      "deploy-web": "skipped",
      "web-readiness": "skipped",
      "release-smoke": "skipped",
    });
    const plan = buildRecoveryPlan({ baseline, current, stages, releaseWorkers: STAGING_RELEASE_WORKERS });
    expect(plan.releaseFailed).toBe(true);
    expect(plan.mutationObserved).toBe(true);
    expect(plan.restoreTargets).toEqual(["leaderboard", "bot", "consumer"]);
    expect(plan.unchangedWorkers).toEqual(["monitor", "web"]);
    expect(plan.migrationsAdded.map(({ version }) => version)).toEqual(["20260908000000"]);
    expect(plan.migrationsMissing).toEqual([]);
    expect(plan.workers.leaderboard.before.scriptName).toBe("yourrank-site-staging");
    expect(plan.workers.leaderboard.restoreSpecs).toBe("leaderboard-old@100%");
  });

  it("staging workflow deploys all five components in production order behind its own lock and never promotes production", async () => {
    const staging = await stagingWorkflowPromise;
    const deploy = await deployWorkflowPromise;
    const rollback = await rollbackWorkflowPromise;
    const contract = await contractWorkflowPromise;
    const web = await webWorkflowPromise;

    expect(staging).toMatch(/concurrency:\n\s+group: staging-mutation\n\s+cancel-in-progress: false/);
    expect(web).toMatch(/concurrency:\n\s+group: staging-mutation\n/);
    for (const production of [deploy, rollback, contract]) {
      expect(production).toMatch(/group: production-mutation/);
      expect(production).not.toContain("staging-mutation");
    }
    expect(staging).not.toMatch(/^\s+group: production-mutation/m);
    expect(staging).not.toContain("environment: production");
    expect(staging).toMatch(/^on:\n {2}workflow_dispatch:/m);
    expect(staging).not.toMatch(/^\s+push:/m);
    expect(staging).toContain("RELEASE_ENVIRONMENT: staging");

    const order = [
      "staging-preflight",
      "capture-staging-state",
      "n1-compatibility",
      "migrate-staging",
      "deploy-leaderboard-staging",
      "deploy-bot-staging",
      "deploy-consumer-staging",
      "backend-readiness-staging",
      "deploy-monitor-staging",
      "deploy-web-staging",
      "web-readiness-staging",
      "release-smoke-staging",
      "staging-finalizer",
    ];
    const positions = order.map((job) => staging.indexOf(`\n  ${job}:\n`));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    expect(jobBlock(staging, "migrate-staging")).toContain("needs: [capture-staging-state, n1-compatibility]");
    expect(jobBlock(staging, "deploy-leaderboard-staging")).toContain("needs: migrate-staging");
    expect(jobBlock(staging, "deploy-bot-staging")).toContain("needs: [migrate-staging, deploy-leaderboard-staging]");
    expect(jobBlock(staging, "deploy-consumer-staging")).toContain("needs: [migrate-staging, deploy-bot-staging]");
    expect(jobBlock(staging, "backend-readiness-staging")).toContain("needs: [deploy-leaderboard-staging, deploy-bot-staging, deploy-consumer-staging]");
    expect(jobBlock(staging, "deploy-monitor-staging")).toContain("needs: [backend-readiness-staging]");
    expect(jobBlock(staging, "deploy-web-staging")).toContain("needs: [backend-readiness-staging, deploy-monitor-staging]");
    expect(jobBlock(staging, "web-readiness-staging")).toContain("needs: [deploy-web-staging]");
    expect(jobBlock(staging, "release-smoke-staging")).toContain("needs: [backend-readiness-staging, web-readiness-staging]");

    // Every Wrangler mutation targets the staging environment; no production script names appear.
    const deployCommands = staging.match(/command: deploy[^\n]*/g) ?? [];
    expect(deployCommands).toHaveLength(4);
    for (const command of deployCommands) expect(command).toContain("--env staging");
    expect(staging).toContain('deploy:ci -- --env staging --tag "${{ github.sha }}"');
    expect(staging.match(/versions deploy "\$\{SPECS\[@\]\}" --env staging/g)).toHaveLength(5);
    for (const production of RELEASE_WORKERS) {
      expect(staging).not.toMatch(new RegExp(`${production.scriptName}(?!-staging)`));
    }
    expect(staging).not.toContain("https://yourrank.site");
    expect(staging).not.toContain("app.yourrank.site");
  });

  it("staging finalizer mirrors the production stage contract and stays red on smoke failure or failed recovery", async () => {
    const staging = await stagingWorkflowPromise;
    const finalizer = jobBlock(staging, "staging-finalizer");
    expect(finalizer).toContain("if: ${{ always() && needs.capture-staging-state.result == 'success' }}");
    const stageResults = finalizer.match(/RELEASE_STAGE_RESULTS: >-\n\s+(\{.*\})/)[1];
    const stageKeys = [...stageResults.matchAll(/"([a-z-]+)":"\$\{\{ needs\.([a-z-]+)\.result \}\}"/g)];
    expect(stageKeys.map((match) => match[1])).toEqual([...RELEASE_STAGES]);
    for (const [, stage, job] of stageKeys) expect(job).toBe(stage === "migrate" ? "migrate-staging" : `${stage}-staging`);
    expect(finalizer).toContain("node scripts/release-recovery-state.mjs plan");
    expect(finalizer).toContain("node scripts/release-recovery-state.mjs promote");
    expect(finalizer).toContain("node scripts/release-recovery-state.mjs verify");
    expect(finalizer).toContain("if: ${{ steps.plan.outputs.release_failed == 'false' }}");
    expect(finalizer).toContain("staging-release-manifest-${{ github.sha }}");
    expect(finalizer).toMatch(/Emit recovery incident summary\n\s+if: \$\{\{ always\(\) && \(steps\.plan\.outcome != 'success' \|\| steps\.plan\.outputs\.release_failed == 'true'\) \}\}\n[\s\S]*?exit 1/);
    // A smoke failure surfaces as release-smoke != success -> releaseFailed -> summary exits 1.
    const state = stagingState();
    const plan = buildRecoveryPlan({ baseline: state, current: state, stages: allStages({ "release-smoke": "failure" }), releaseWorkers: STAGING_RELEASE_WORKERS });
    expect(plan.releaseFailed).toBe(true);
    expect(plan.mutationObserved).toBe(false);
  });

  it("failure injection is staging-only and cannot run from any production workflow", async () => {
    const staging = await stagingWorkflowPromise;
    const deploy = await deployWorkflowPromise;
    const rollback = await rollbackWorkflowPromise;
    const contract = await contractWorkflowPromise;

    expect(staging).toMatch(/inject_failure:\n\s+description:[^\n]*\n\s+type: choice\n\s+default: none/);
    expect(staging).toContain("- after-backend-mutation");
    expect(staging).toContain("- after-web-mutation");
    expect(staging).toContain("- recovery-command");
    expect(jobBlock(staging, "backend-readiness-staging")).toContain("if: ${{ inputs.inject_failure == 'after-backend-mutation' && env.RELEASE_ENVIRONMENT == 'staging' }}");
    expect(jobBlock(staging, "release-smoke-staging")).toContain("if: ${{ inputs.inject_failure == 'after-web-mutation' && env.RELEASE_ENVIRONMENT == 'staging' }}");
    const finalizer = jobBlock(staging, "staging-finalizer");
    expect(finalizer).toContain("inputs.inject_failure == 'recovery-command' && env.RELEASE_ENVIRONMENT == 'staging'");
    expect(finalizer.match(/inputs\.inject_failure != 'recovery-command'/g)).toHaveLength(5);
    for (const production of [deploy, rollback, contract]) {
      expect(production).not.toContain("inject_failure");
      expect(production).not.toContain("RELEASE_ENVIRONMENT");
    }
  });

  it("staging apex proxies marketing routes only when the Worker runs as the staging environment", async () => {
    const index = await rootFile("apps/leaderboard/src/index.js");
    expect(index).toContain('env.ENVIRONMENT === "staging" && host === `staging.${PLATFORM_HOST}`');
    const leaderboard = await rootFile("apps/leaderboard/wrangler.toml");
    const productionSection = leaderboard.slice(0, leaderboard.indexOf("[env.staging]"));
    expect(productionSection).not.toMatch(/ENVIRONMENT = "staging"/);
  });
});
