// F-039 / F-044: backend database identity gate.
//
//   node scripts/verify-db-identity.mjs certify
//     Full behavioural matrix against a LOCAL, migrated test database reached as a
//     superuser through DB_IDENTITY_TEST_DATABASE_URL. Sets a throwaway password on
//     yourrank_worker, connects as it, exercises every launch-critical operation
//     through real RLS, proves anon/authenticated stay locked out, and proves the
//     previous Worker identity keeps working with the expanded schema.
//
//   node scripts/verify-db-identity.mjs readiness
//     Non-mutating readiness check run AS THE WORKER LOGIN (the credential Hyperdrive
//     uses) through WORKER_DATABASE_URL. Verifies identity, role flags, membership,
//     policies and read access to the RLS-protected tables. Safe for staging and
//     production; never writes.
//
//   node scripts/verify-db-identity.mjs health <staging|production>
//     Reads the deployed leaderboard /health JSON from HEALTH_BODY (or stdin) and
//     applies release/db-identity.json: with `enforce: true` the run fails unless the
//     effective Hyperdrive identity is the expected non-superuser, non-BYPASSRLS
//     member of yourrank_app; with `enforce: false` it reports PENDING as a warning.
//
// All modes exit 1 (NOT CERTIFIED) when the credential/input is missing. Connection
// strings and passwords are never printed.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postgres from "postgres";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDENTITY_CONFIG_PATH = path.join(ROOT, "release", "db-identity.json");

const EXPECTED_WORKER_ROLE = process.env.EXPECTED_DB_IDENTITY || "yourrank_worker";
const APP_GROUP_ROLE = "yourrank_app";
const FORBIDDEN_LOGIN_ROLES = new Set(["postgres", "supabase_admin", "service_role", "anon", "authenticated"]);
const PUBLIC_ROLES = ["anon", "authenticated"];

// Server-only tables: browser/public Supabase roles must never see or write a row.
const SENSITIVE_TABLES = [
  "users",
  "sessions",
  "sites",
  "site_members",
  "site_invites",
  "oauth_states",
  "password_resets",
  "admin_recovery_codes",
  "postback_keys",
  "audit_log",
];

// RLS-protected tables the Workers read on the launch path (readiness reads only).
const REQUIRED_READ_TABLES = [
  "users",
  "sessions",
  "sites",
  "players",
  "site_viewers",
  "site_members",
  "site_invites",
  "oauth_states",
  "clicks",
  "click_daily",
  "short_links",
  "consumer_heartbeat",
  "queue_dlq_events",
];

const mode = process.argv[2];
const failures = [];
let passed = 0;

function log(message) {
  console.log(`[F-039/F-044] ${message}`);
}

function record(ok, label, detail = "") {
  if (ok) {
    passed += 1;
    log(`PASS ${label}`);
  } else {
    failures.push(label);
    console.error(`::error::F-039/F-044 ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function fail(message) {
  console.error(`::error::F-039/F-044 NOT CERTIFIED: ${message}`);
  process.exit(1);
}

function finish(label) {
  if (failures.length) {
    console.error(`::error::F-039/F-044 ${label} NOT CERTIFIED: ${failures.length} failure(s), ${passed} passed`);
    process.exit(1);
  }
  log(`${label} PASS: ${passed} checks`);
}

function connect(url) {
  return postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 15 });
}

// Runs `run` inside a savepoint so a denied statement does not abort the outer
// transaction; resolves to the rows or the thrown error.
async function attempt(tx, run) {
  try {
    return { rows: await tx.savepoint((sp) => run(sp)) };
  } catch (error) {
    return { error };
  }
}

async function expectDenied(tx, run, label) {
  const { error } = await attempt(tx, run);
  if (!error) {
    record(false, label, "operation succeeded but must be denied");
  } else {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    // 42501 insufficient_privilege covers both GRANT denial and RLS WITH CHECK denial.
    record(code === "42501", label, code ? `unexpected error code ${code}` : String(error));
  }
}

async function identityChecks(sql, label, { expectedRole, mustBeMemberOfApp }) {
  const [who] = await sql`
    SELECT current_user AS current_user, session_user AS session_user,
           r.rolcanlogin, r.rolsuper, r.rolbypassrls, r.rolinherit,
           pg_has_role(current_user, ${APP_GROUP_ROLE}, 'USAGE') AS member_of_app
      FROM pg_roles r WHERE r.rolname = current_user`;
  log(`${label}: current_user=${who.current_user} session_user=${who.session_user} login=${who.rolcanlogin} super=${who.rolsuper} bypassrls=${who.rolbypassrls} inherit=${who.rolinherit} member_of_${APP_GROUP_ROLE}=${who.member_of_app}`);
  record(who.current_user === expectedRole && who.session_user === expectedRole, `${label}: connects directly as ${expectedRole}`, `got ${who.current_user}/${who.session_user}`);
  record(!FORBIDDEN_LOGIN_ROLES.has(who.current_user), `${label}: is not a forbidden login (${[...FORBIDDEN_LOGIN_ROLES].join(", ")})`);
  record(who.rolsuper === false, `${label}: is not a superuser`);
  record(who.rolbypassrls === false, `${label}: does not BYPASSRLS (RLS is enforced)`);
  record(who.rolcanlogin === true, `${label}: LOGIN role`);
  if (mustBeMemberOfApp) {
    record(who.member_of_app === true && who.rolinherit === true, `${label}: inherits ${APP_GROUP_ROLE}`);
  }
  const [app] = await sql`SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ${APP_GROUP_ROLE}`;
  record(Boolean(app) && app.rolcanlogin === false && app.rolsuper === false && app.rolbypassrls === false, `${APP_GROUP_ROLE} stays a NOLOGIN, non-superuser, non-BYPASSRLS group role`);
  for (const role of PUBLIC_ROLES) {
    const [row] = await sql`SELECT rolsuper, rolbypassrls, pg_has_role(rolname, ${APP_GROUP_ROLE}, 'USAGE') AS member_of_app FROM pg_roles WHERE rolname = ${role}`;
    record(Boolean(row) && row.rolsuper === false && row.rolbypassrls === false && row.member_of_app === false, `${role} is not superuser/BYPASSRLS and is not a member of ${APP_GROUP_ROLE}`);
  }
}

async function policyChecks(sql) {
  const missing = await sql`
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
       AND NOT EXISTS (
         SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = c.relname AND ${APP_GROUP_ROLE} = ANY (p.roles))
     ORDER BY 1`;
  record(missing.length === 0, `every RLS-enabled public table has a ${APP_GROUP_ROLE} policy`, missing.map((row) => row.relname).join(", "));

  const exposed = await sql`
    SELECT tablename, policyname, roles
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = ANY (${SENSITIVE_TABLES})
       AND (roles && ARRAY['anon', 'authenticated', 'public']::name[])`;
  record(exposed.length === 0, "no anon/authenticated/PUBLIC policy exists on server-only tables", exposed.map((row) => `${row.tablename}.${row.policyname}`).join(", "));

  const forced = await sql`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relforcerowsecurity`;
  log(`FORCE ROW LEVEL SECURITY tables: ${forced.length ? forced.map((row) => row.relname).join(", ") : "none"}`);

  for (const table of SENSITIVE_TABLES) {
    const [row] = await sql`SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(${"public." + table})`;
    record(Boolean(row) && row.relrowsecurity === true, `${table} has ROW LEVEL SECURITY enabled`);
  }

  const [helper] = await sql`SELECT has_function_privilege(${APP_GROUP_ROLE}, 'app_private.ensure_clicks_partition(date)', 'EXECUTE') AS ok`;
  record(helper.ok === true, `${APP_GROUP_ROLE} can execute ensure_clicks_partition(date)`);
  for (const role of PUBLIC_ROLES) {
    const [usage] = await sql`SELECT has_schema_privilege(${role}, 'app_private', 'USAGE') AS ok`;
    record(usage.ok === false, `${role} has no USAGE on app_private`);
  }
}

async function backendReads(sql, label) {
  for (const table of REQUIRED_READ_TABLES) {
    try {
      await sql.unsafe(`SELECT count(*) FROM public.${table}`);
      record(true, `${label}: can read ${table} through RLS`);
    } catch (error) {
      record(false, `${label}: can read ${table} through RLS`, String(error));
    }
  }
  const [health] = await sql`SELECT 1 AS ok, now() AS at`;
  record(health.ok === 1, `${label}: Worker health/readiness query works`);
}

// Launch-critical write/read matrix executed as the given identity. Every row is
// tagged so the certify run can remove it afterwards.
async function backendOperations(sql, label, tag) {
  const email = `${tag}@db-identity.test`;
  const [user] = await sql`
    INSERT INTO users (email, status, email_verified, display_name)
    VALUES (${email}, 'active', true, ${tag}) RETURNING id`;
  const [lookedUp] = await sql`SELECT id, email::text AS email FROM users WHERE id = ${user.id}`;
  record(lookedUp?.email === email, `${label}: user lookup`);

  const token = `${tag}-session`;
  await sql`INSERT INTO sessions (token, user_id, expires_at) VALUES (${token}, ${user.id}, now() + interval '1 hour')`;
  const [session] = await sql`
    SELECT s.user_id, u.email::text AS email FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ${token} AND s.expires_at > now()`;
  record(session?.email === email, `${label}: session lookup joins users`);

  const [site] = await sql`
    INSERT INTO sites (user_id, slug, name, published) VALUES (${user.id}, ${tag}, ${tag}, true) RETURNING id`;
  await sql`INSERT INTO players (site_id, name, normalized_name, wagered) VALUES (${site.id}, ${tag}, ${tag}, 10)`;
  const [board] = await sql`
    SELECT s.id, count(p.id)::int AS players FROM sites s LEFT JOIN players p ON p.site_id = s.id
     WHERE s.slug = ${tag} AND s.published GROUP BY s.id`;
  record(board?.players === 1, `${label}: public board / dashboard site read`);

  const [member] = await sql`
    INSERT INTO users (email, status, email_verified) VALUES (${`${tag}-member@db-identity.test`}, 'active', true) RETURNING id`;
  const [membership] = await sql`
    INSERT INTO site_members (site_id, user_id, role, invited_by) VALUES (${site.id}, ${member.id}, 'moderator', ${user.id}) RETURNING id`;
  const [memberRow] = await sql`SELECT role FROM site_members WHERE id = ${membership.id}`;
  await sql`UPDATE site_members SET updated_at = now() WHERE id = ${membership.id}`;
  const removed = await sql`DELETE FROM site_members WHERE id = ${membership.id} RETURNING id`;
  record(memberRow?.role === "moderator" && removed.length === 1, `${label}: site_members insert/select/update/delete`);

  const [invite] = await sql`
    INSERT INTO site_invites (site_id, email, role, token_hash, invited_by, expires_at)
    VALUES (${site.id}, ${`${tag}-invite@db-identity.test`}, 'moderator', ${`${tag}-hash`}, ${user.id}, now() + interval '1 day') RETURNING id`;
  const accepted = await sql`UPDATE site_invites SET status = 'accepted' WHERE id = ${invite.id} AND status = 'pending' RETURNING id`;
  const [inviteRow] = await sql`SELECT status FROM site_invites WHERE id = ${invite.id}`;
  const revoked = await sql`DELETE FROM site_invites WHERE id = ${invite.id} RETURNING id`;
  record(accepted.length === 1 && inviteRow?.status === "accepted" && revoked.length === 1, `${label}: site_invites create/accept/select/delete`);

  const state = `${tag}-oauth`;
  await sql`INSERT INTO oauth_states (state, provider, payload, expires_at) VALUES (${state}, 'kick', ${sql.json({ tag })}, now() + interval '10 minutes')`;
  const consumed = await sql`DELETE FROM oauth_states WHERE state = ${state} AND expires_at > now() RETURNING payload`;
  const [stale] = await sql`SELECT count(*)::int AS n FROM oauth_states WHERE state = ${state}`;
  record(consumed.length === 1 && stale.n === 0, `${label}: oauth_states create/consume/delete`);

  await sql`
    INSERT INTO consumer_heartbeat (name, last_seen, processed_count, failed_count)
    VALUES (${tag}, now(), 1, 0)
    ON CONFLICT (name) DO UPDATE SET last_seen = EXCLUDED.last_seen,
      processed_count = consumer_heartbeat.processed_count + EXCLUDED.processed_count`;
  await sql`
    INSERT INTO queue_dlq_events (message_id, queue_name, event_type, body)
    VALUES (${`${tag}-msg`}, 'yourrank-events', 'db-identity-test', ${sql.json({ tag })})
    ON CONFLICT DO NOTHING`;
  const [heartbeat] = await sql`SELECT processed_count::int AS n FROM consumer_heartbeat WHERE name = ${tag}`;
  const [dlq] = await sql`SELECT count(*)::int AS n FROM queue_dlq_events WHERE message_id = ${`${tag}-msg`}`;
  record(heartbeat?.n === 1 && dlq.n === 1, `${label}: queue/consumer health writes`);

  const [partition] = await sql`SELECT app_private.ensure_clicks_partition(current_date) AS name`;
  record(/^clicks_\d{4}_\d{2}$/.test(partition.name), `${label}: ensure_clicks_partition(current_date) via SECURITY DEFINER`);
  await sql`
    SELECT inhrelid::regclass::text AS name FROM pg_inherits JOIN pg_class ON pg_class.oid = inhrelid
     WHERE inhparent = 'clicks'::regclass AND pg_has_role(current_user, pg_class.relowner, 'USAGE')`;
  record(true, `${label}: partition retention query works`);

  await backendReads(sql, label);
  return { userId: user.id, memberId: member.id, siteId: site.id, tag };
}

async function cleanup(admin, fixture) {
  await admin`DELETE FROM queue_dlq_events WHERE message_id = ${`${fixture.tag}-msg`}`;
  await admin`DELETE FROM consumer_heartbeat WHERE name = ${fixture.tag}`;
  await admin`DELETE FROM sites WHERE id = ${fixture.siteId}`;
  await admin`DELETE FROM users WHERE id IN (${fixture.userId}, ${fixture.memberId})`;
}

async function publicRoleIsolation(admin, role, fixture) {
  // SET ROLE inside a transaction so the superuser session's identity is restored.
  await admin.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE ${role}`);
    const [who] = await tx`SELECT current_user AS u`;
    record(who.u === role, `${role}: SET ROLE applied`);
    for (const table of SENSITIVE_TABLES) {
      const { rows, error } = await attempt(tx, (sp) => sp.unsafe(`SELECT count(*)::int AS n FROM public.${table}`));
      if (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        record(code === "42501", `${role}: cannot read ${table} (no GRANT)`, String(error));
      } else {
        record(rows[0].n === 0, `${role}: sees zero rows in ${table} (RLS)`, `saw ${rows[0].n}`);
      }
    }
    await expectDenied(tx, (sp) => sp`INSERT INTO sessions (token, user_id, expires_at) VALUES (${`${role}-${fixture.tag}`}, ${fixture.userId}, now())`, `${role}: cannot insert into sessions`);
    await expectDenied(tx, (sp) => sp`INSERT INTO oauth_states (state, provider, payload, expires_at) VALUES (${`${role}-${fixture.tag}`}, 'kick', '{}'::jsonb, now())`, `${role}: cannot insert into oauth_states`);
    await expectDenied(tx, (sp) => sp`INSERT INTO site_members (site_id, user_id, role) VALUES (${fixture.siteId}, ${fixture.memberId}, 'moderator')`, `${role}: cannot insert into site_members`);
    await expectDenied(tx, (sp) => sp`INSERT INTO site_invites (site_id, email, token_hash, invited_by) VALUES (${fixture.siteId}, 'x@y.test', 'h', ${fixture.userId})`, `${role}: cannot insert into site_invites`);
    for (const [table, run] of [
      ["users", (sp) => sp`UPDATE users SET display_name = 'pwned' WHERE id = ${fixture.userId} RETURNING id`],
      ["sessions", (sp) => sp`DELETE FROM sessions WHERE user_id = ${fixture.userId} RETURNING token`],
    ]) {
      const { rows, error } = await attempt(tx, run);
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      record(error ? code === "42501" : rows.length === 0, `${role}: cannot modify ${table} rows`, error ? String(error) : `modified ${rows.length}`);
    }
    await expectDenied(tx, (sp) => sp`SELECT app_private.ensure_clicks_partition(current_date)`, `${role}: cannot execute ensure_clicks_partition`);
    await tx.unsafe("RESET ROLE");
  });
}

async function certify() {
  const adminUrl = process.env.DB_IDENTITY_TEST_DATABASE_URL;
  if (!adminUrl) fail("DB_IDENTITY_TEST_DATABASE_URL is required for certify (local migrated test database, superuser)");
  const parsed = new URL(adminUrl);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
  if (!localHosts.has(parsed.hostname) || !/(test|n1|e2e)/i.test(parsed.pathname)) {
    fail(`certify refuses a non-local or non-test database (${parsed.hostname}${parsed.pathname})`);
  }

  const admin = connect(adminUrl);
  let worker = null;
  try {
    const [me] = await admin`SELECT current_user AS u, rolsuper FROM pg_roles WHERE rolname = current_user`;
    if (!me.rolsuper) fail("certify must connect as a superuser to set the throwaway worker password");

    const roles = await admin`SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN (${EXPECTED_WORKER_ROLE}, ${APP_GROUP_ROLE})`;
    record(roles.length === 2, `roles ${EXPECTED_WORKER_ROLE} and ${APP_GROUP_ROLE} exist (migration applied)`);
    if (roles.length !== 2) finish("certify");

    // Throwaway credential for the local fixture only; never logged.
    const password = randomBytes(24).toString("base64url");
    await admin.unsafe(`ALTER ROLE ${EXPECTED_WORKER_ROLE} WITH PASSWORD '${password}'`);
    const workerUrl = new URL(adminUrl);
    workerUrl.username = EXPECTED_WORKER_ROLE;
    workerUrl.password = password;
    worker = connect(workerUrl.toString());

    await identityChecks(worker, "NEW identity", { expectedRole: EXPECTED_WORKER_ROLE, mustBeMemberOfApp: true });
    await policyChecks(worker);
    const newFixture = await backendOperations(worker, "NEW identity + expanded DB", `f039-new-${Date.now()}`);

    // Rollout: the previous Worker identity (superuser/owner in this fixture, the
    // pre-switch Hyperdrive credential in production) keeps working on the expanded
    // schema with the new role and policies present — the rollback path.
    const oldFixture = await backendOperations(admin, "OLD identity + expanded DB (rollback)", `f039-old-${Date.now()}`);
    const [oldPrivs] = await admin`
      SELECT bool_and(has_table_privilege(${me.u}, c.oid, 'SELECT')) AS ok FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`;
    record(oldPrivs.ok === true, "OLD identity keeps SELECT on every public table (nothing revoked in expand)");
    const [appPrivs] = await admin`
      SELECT bool_and(has_table_privilege(${APP_GROUP_ROLE}, c.oid, 'SELECT')) AS ok FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`;
    record(appPrivs.ok === true, `${APP_GROUP_ROLE} keeps SELECT on every public table`);
    const [serviceRole] = await admin`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' AND 'service_role' = ANY (roles)`;
    record(serviceRole.n > 0, "service_role policies retained (no policy removed in expand)");

    for (const role of PUBLIC_ROLES) {
      await publicRoleIsolation(admin, role, newFixture);
    }

    // Cross-tenant: the backend policy is permissive by design; tenant scoping is
    // enforced in application SQL. Prove the worker can see both tenants so the
    // application-level authorization suites (team/site scope) remain meaningful.
    const [tenants] = await worker`SELECT count(*)::int AS n FROM sites WHERE id IN (${newFixture.siteId}, ${oldFixture.siteId})`;
    record(tenants.n === 2, "backend identity operates across tenants (authorization stays in application SQL)");

    await cleanup(admin, newFixture);
    await cleanup(admin, oldFixture);
  } finally {
    if (worker) await worker.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  }
  finish("certify");
}

async function readiness() {
  const url = process.env.WORKER_DATABASE_URL;
  if (!url) fail("WORKER_DATABASE_URL is required for readiness (the Worker/Hyperdrive login) — database identity not certified");
  const parsed = new URL(url);
  if (FORBIDDEN_LOGIN_ROLES.has(decodeURIComponent(parsed.username).split(".")[0])) {
    fail(`WORKER_DATABASE_URL authenticates as forbidden login ${decodeURIComponent(parsed.username).split(".")[0]}`);
  }
  const sql = connect(url);
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("SET TRANSACTION READ ONLY");
      await identityChecks(tx, "Worker login", { expectedRole: EXPECTED_WORKER_ROLE, mustBeMemberOfApp: true });
      await policyChecks(tx);
      await backendReads(tx, "Worker login");
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
  finish("readiness");
}

function readHealthBody() {
  const raw = process.env.HEALTH_BODY ?? readFileSync(0, "utf8");
  if (!raw || !raw.trim()) fail("health: empty /health body (HEALTH_BODY or stdin) — database identity not certified");
  try {
    return JSON.parse(raw);
  } catch {
    fail("health: /health body is not JSON — database identity not certified");
  }
}

function health(environment) {
  const config = JSON.parse(readFileSync(IDENTITY_CONFIG_PATH, "utf8"));
  const envConfig = config.environments?.[environment];
  if (!envConfig || typeof envConfig.enforce !== "boolean") {
    fail(`health: release/db-identity.json has no boolean enforce entry for ${environment}`);
  }
  if (envConfig.enforce === false && !(typeof envConfig.reason === "string" && envConfig.reason.trim())) {
    fail(`health: ${environment} enforcement is disabled without a documented reason`);
  }
  const body = readHealthBody();
  const identity = body.db_identity;
  const certified =
    Boolean(identity) &&
    identity.expected === true &&
    identity.superuser === false &&
    identity.bypassrls === false &&
    identity.app_member === true;
  const observed = identity ? JSON.stringify(identity) : "absent (Worker predates F-039 or db probe failed)";
  if (certified) {
    log(`health: ${environment} Hyperdrive identity certified — ${observed}`);
    return;
  }
  if (envConfig.enforce) {
    fail(`health: ${environment} Hyperdrive identity is not the expected backend login — db_identity=${observed}`);
  }
  console.log(`::warning::F-039/F-044 ${environment} database identity PENDING (not certified): db_identity=${observed}. ${envConfig.reason}`);
}

if (mode === "certify") {
  await certify();
} else if (mode === "readiness") {
  await readiness();
} else if (mode === "health" && (process.argv[3] === "staging" || process.argv[3] === "production")) {
  health(process.argv[3]);
} else {
  fail("usage: verify-db-identity.mjs <certify|readiness|health <staging|production>>");
}
