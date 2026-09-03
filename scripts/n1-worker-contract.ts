import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
const sourceRoot = resolve(process.env.N1_SOURCE_ROOT || ".");
const phase = process.env.N1_PHASE || "unknown";
const components = new Set((process.env.N1_COMPONENTS || "").split(",").filter(Boolean));
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = postgres(databaseUrl, { max: 1, prepare: false });
const fixture = {
  userId: "10000000-0000-4000-8000-000000000004",
  siteId: "20000000-0000-4000-8000-000000000004",
  playerId: "30000000-0000-4000-8000-000000000004",
  botId: "40000000-0000-4000-8000-000000000004",
  dropId: "50000000-0000-4000-8000-000000000004",
  rawSessionToken: "f004".repeat(16),
  email: "f004-n1@yourrank.invalid",
  slug: "f004-n1-board",
  botSecret: "f004-n1-bot-secret",
};

const moduleUrl = (relativePath: string) => pathToFileURL(resolve(sourceRoot, relativePath)).href;
const uuidForPhase = (prefix: string) => {
  let hash = 0;
  for (const char of `${prefix}:${phase}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `90000000-0000-4000-8000-${hash.toString(16).padStart(12, "0")}`;
};

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Buffer.from(digest).toString("hex");
}

async function seedBaselineFixture() {
  const tokenHash = await hashToken(fixture.rawSessionToken);
  await sql.begin(async (tx) => {
    await tx.unsafe("DELETE FROM public.telegram_webhook_updates WHERE bot_id = $1", [fixture.botId]);
    await tx.unsafe("DELETE FROM public.code_drops WHERE id = $1", [fixture.dropId]);
    await tx.unsafe("DELETE FROM public.sessions WHERE user_id = $1", [fixture.userId]);
    await tx.unsafe("DELETE FROM public.players WHERE site_id = $1", [fixture.siteId]);
    await tx.unsafe("DELETE FROM public.bots WHERE id = $1", [fixture.botId]);
    await tx.unsafe("UPDATE public.users SET active_site_id = NULL WHERE id = $1", [fixture.userId]);
    await tx.unsafe("DELETE FROM public.sites WHERE id = $1", [fixture.siteId]);
    await tx.unsafe("DELETE FROM public.users WHERE id = $1 OR email = $2", [fixture.userId, fixture.email]);
    await tx.unsafe(
      `INSERT INTO public.users
         (id, email, display_name, plan, plan_expires_at, status, is_admin, email_verified)
       VALUES ($1, $2, 'F-004 Owner', 'team', now() + interval '30 days', 'active', false, true)`,
      [fixture.userId, fixture.email],
    );
    await tx.unsafe(
      `INSERT INTO public.sites
         (id, user_id, slug, name, published, is_draft, extra_json, theme_json, rank_by, board_order)
       VALUES ($1, $2, $3, 'F-004 Board', true, false, '{}'::jsonb, '{}'::jsonb, 'wagered', 0)`,
      [fixture.siteId, fixture.userId, fixture.slug],
    );
    await tx.unsafe("UPDATE public.users SET active_site_id = $1 WHERE id = $2", [fixture.siteId, fixture.userId]);
    await tx.unsafe(
      `INSERT INTO public.players (id, site_id, name, normalized_name, wagered, prize, sort)
       VALUES ($1, $2, 'Existing Player', 'existing player', 125.50, 25.00, 1)`,
      [fixture.playerId, fixture.siteId],
    );
    await tx.unsafe(
      `INSERT INTO public.sessions (token, user_id, created_at, expires_at)
       VALUES ($1, $2, now(), now() + interval '30 days')`,
      [tokenHash, fixture.userId],
    );
    await tx.unsafe(
      `INSERT INTO public.bots
         (id, owner_id, tg_bot_id, username, token_encrypted, webhook_secret, status, welcome_message)
       VALUES ($1, $2, 4000000004, 'f004_n1_bot', $3, $4, 'active', 'hello')`,
      [fixture.botId, fixture.userId, Buffer.from("fixture-token"), fixture.botSecret],
    );
    await tx.unsafe(
      `INSERT INTO public.code_drops (id, site_id, code, points_reward, max_claims)
       VALUES ($1, $2, 'F004-EXISTING', 100, 5)`,
      [fixture.dropId, fixture.siteId],
    );
  });
}

async function verifyFixtureSurvival() {
  const [row] = await sql.unsafe(
    `SELECT u.email, u.plan::text AS plan, s.slug, s.rank_by, p.name, p.wagered::text AS wagered
       FROM public.users u
       JOIN public.sites s ON s.user_id = u.id
       JOIN public.players p ON p.site_id = s.id
      WHERE u.id = $1 AND s.id = $2 AND p.id = $3`,
    [fixture.userId, fixture.siteId, fixture.playerId],
  );
  assert.equal(row?.email, fixture.email);
  assert.equal(row?.plan, "team");
  assert.equal(row?.slug, fixture.slug);
  assert.equal(row?.rank_by, "wagered");
  assert.equal(row?.name, "Existing Player");
  assert.equal(row?.wagered, "125.50");
}

async function verifyExpandedEdges() {
  const [column] = await sql.unsafe(
    `SELECT is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'code_drops'
        AND column_name = 'automation_occurrence_id'`,
  );
  assert.equal(column?.is_nullable, "YES", "old code_drops writes require a nullable expansion column");
  const [existingDrop] = await sql.unsafe("SELECT automation_occurrence_id FROM public.code_drops WHERE id = $1", [fixture.dropId]);
  assert.equal(existingDrop?.automation_occurrence_id, null, "pre-existing rows retain the NULL compatibility edge");

  const templateId = uuidForPhase("template");
  const scheduleId = uuidForPhase("schedule");
  await sql.unsafe(
    `INSERT INTO public.activity_templates (id, site_id, kind, name, config, created_by)
     VALUES ($1, $2, 'safe_code_drop', 'N-1 edge', '{}'::jsonb, $3)`,
    [templateId, fixture.siteId, fixture.userId],
  );
  const [schedule] = await sql.unsafe(
    `INSERT INTO public.activity_schedules
       (id, site_id, template_id, kind, template_name_snapshot, config_snapshot, next_run_at, created_by)
     VALUES ($1, $2, $3, 'safe_code_drop', 'N-1 edge', '{}'::jsonb, now() + interval '1 hour', $4)
     RETURNING recurrence, status, attempt_count`,
    [scheduleId, fixture.siteId, templateId, fixture.userId],
  );
  assert.deepEqual(
    { recurrence: schedule.recurrence, status: schedule.status, attempt: schedule.attempt_count },
    { recurrence: "once", status: "scheduled", attempt: 0 },
  );

  let rejected = false;
  try {
    await sql.unsafe(
      `INSERT INTO public.activity_templates (id, site_id, kind, name, config)
       VALUES ($1, $2, 'unsupported', 'invalid', '{}'::jsonb)`,
      [uuidForPhase("invalid"), fixture.siteId],
    );
  } catch (error: any) {
    rejected = error?.code === "23514";
  }
  assert.equal(rejected, true, "new kind constraint must reject invalid values");

  const [oldStyleDrop] = await sql.unsafe(
    `INSERT INTO public.code_drops (site_id, code, points_reward, max_claims)
     VALUES ($1, $2, 10, 1) RETURNING automation_occurrence_id`,
    [fixture.siteId, `F004-${phase}`],
  );
  assert.equal(oldStyleDrop.automation_occurrence_id, null, "old INSERT column list must still work");
}

async function verifySessionAndAccount() {
  const session = await import(moduleUrl("packages/shared/dist/session.js"));
  const request = new Request("https://yourrank.site/dashboard", {
    headers: { cookie: `yr_session=${fixture.rawSessionToken}` },
  });
  const resolved = await session.resolveSession(request, { ENVIRONMENT: "test" });
  assert.equal(resolved.userId, fixture.userId);
  const user = await session.loadUser({}, fixture.userId);
  assert.equal(user?.email, fixture.email);
  assert.equal(user?.slug, fixture.slug);
  await Bun.sleep(25);
}

async function verifyLeaderboard() {
  const site = await import(moduleUrl("apps/leaderboard/src/site.js"));
  const env = { DATABASE_URL: databaseUrl };
  const dashboard = await site.getUserSite(env, fixture.userId, "team");
  assert.equal(dashboard?.slug, fixture.slug);
  const boards = await site.getUserBoardsList(env, fixture.userId);
  assert.ok(boards.some((board: any) => board.id === fixture.siteId && board.players === 1));
  const publicBoard = await site.getPublicSite(env, fixture.slug, null, { fresh: true, limit: 25 });
  assert.equal(publicBoard?.data?.players?.[0]?.name, "Existing Player");

  const writeSlug = `f004-${phase}`.replace(/[^a-z0-9-]/g, "-").slice(0, 60);
  const created = await site.createBoard(env, fixture.userId, {
    slug: writeSlug,
    name: `F-004 ${phase}`,
    published: false,
    is_draft: true,
  });
  assert.equal(created.ok, true, `N-1 board write failed: ${JSON.stringify(created)}`);

  const worker = (await import(moduleUrl("apps/leaderboard/src/index.js"))).default;
  const response = await worker.fetch(
    new Request("https://yourrank.site/health"),
    {
      DATABASE_URL: databaseUrl,
      HYPERDRIVE: { connectionString: databaseUrl },
      ENVIRONMENT: "test",
      EMAIL_VERIFICATION_REQUIRED: "false",
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
  const health = await response.json();
  assert.equal(health.db, true, `Leaderboard health DB probe failed (${response.status})`);
}

async function verifyBot() {
  const botEngine = await import(moduleUrl("apps/bot/src/botEngine.ts"));
  const webhook = await import(moduleUrl("apps/bot/src/telegram-webhook.ts"));
  const bot = await botEngine.getBotBySecret(fixture.botSecret);
  assert.equal(bot?.id, fixture.botId);

  const updateId = 4_000_000_000 + Number.parseInt(uuidForPhase("update").slice(-6), 16);
  assert.equal(await webhook.claimTelegramUpdate(fixture.botId, updateId, { update_id: updateId }), true);
  assert.equal(await webhook.claimTelegramUpdate(fixture.botId, updateId, { update_id: updateId }), false);
  await webhook.completeTelegramUpdate(fixture.botId, updateId);
  const [update] = await sql.unsafe(
    "SELECT status, completed_at IS NOT NULL AS completed FROM public.telegram_webhook_updates WHERE bot_id = $1 AND update_id = $2",
    [fixture.botId, updateId],
  );
  assert.deepEqual({ status: update.status, completed: update.completed }, { status: "completed", completed: true });

  const { buildHonoApp } = await import(moduleUrl("apps/bot/src/hono-app.ts"));
  const app = buildHonoApp();
  const response = await app.fetch(
    new Request("https://yourrank.site/bot/health"),
    {
      DATABASE_URL: databaseUrl,
      HYPERDRIVE: { connectionString: databaseUrl },
      ENVIRONMENT: "test",
      TOKEN_ENC_KEY: process.env.TOKEN_ENC_KEY,
      IP_HASH_SALT: process.env.IP_HASH_SALT,
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, db: true });
}

async function verifyConsumer() {
  const consumer = await import(moduleUrl("apps/consumer/src/worker.js"));
  await consumer.refreshConsumerHeartbeat();
  const env = {
    DATABASE_URL: databaseUrl,
    HYPERDRIVE: { connectionString: databaseUrl },
    EVENTS_QUEUE: { async send() {}, async sendBatch() {} },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const before = await sql.unsafe(
    "SELECT name, last_seen FROM public.consumer_heartbeat WHERE name IN ('consumer', 'consumer_scheduled') ORDER BY name",
  );
  // Readiness (current Workers) or the legacy health route (N-1 Workers that
  // predate the liveness/readiness split and answer unknown paths with a plain
  // "consumer ok") must answer 200 against this schema.
  let response = await consumer.default.fetch(new Request("https://yourrank.site/consumer/ready"), env, ctx);
  const readinessIsJson = (response.headers.get("content-type") || "").includes("application/json");
  if (response.status === 404 || !readinessIsJson) {
    response = await consumer.default.fetch(new Request("https://yourrank.site/consumer/health"), env, ctx);
  } else {
    const after = await sql.unsafe(
      "SELECT name, last_seen FROM public.consumer_heartbeat WHERE name IN ('consumer', 'consumer_scheduled') ORDER BY name",
    );
    assert.deepEqual(after, before, "readiness probe must not refresh the heartbeat it verifies");
  }
  assert.equal(response.status, 200);
  const [heartbeat] = await sql.unsafe(
    "SELECT count(*)::int AS count FROM public.consumer_heartbeat WHERE name IN ('consumer', 'consumer_probe', 'consumer_scheduled')",
  );
  assert.ok(heartbeat.count >= 2);
}

async function verifyMonitorContract() {
  const source = await readFile(resolve(sourceRoot, "apps/monitor/src/worker.ts"), "utf8");
  assert.doesNotMatch(source, /@yourrank\/shared\/db|\bDATABASE_URL\b|\bpostgres\s*\(/);
  assert.match(source, /\/health/);
  assert.match(source, /\/bot\/health/);
  assert.match(source, /\/consumer\/(ready|health)/);
}

try {
  if (phase === "baseline") await seedBaselineFixture();
  await verifyFixtureSurvival();
  await verifySessionAndAccount();
  if (phase !== "baseline") await verifyExpandedEdges();
  if (components.has("leaderboard")) await verifyLeaderboard();
  if (components.has("bot")) await verifyBot();
  if (components.has("consumer")) await verifyConsumer();
  if (components.has("monitor")) await verifyMonitorContract();
  console.log(`[F-004] PASS ${phase}: ${[...components].join(", ")}`);
} finally {
  await sql.end({ timeout: 0 });
}
