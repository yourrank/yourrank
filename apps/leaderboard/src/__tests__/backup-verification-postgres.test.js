// F-057 / F-058: the recovery signal (backup_verifications) can only be written
// through the canonical admin step-up path and only with trustworthy evidence.
// Runs against a real PostgreSQL with all migrations applied (Migration Dry-Run
// job). When BACKUP_SECURITY_GATE=required the suite FAILS if the database is
// absent instead of skipping — a skipped security gate is never a pass.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { hashToken } from "@yourrank/shared/crypto";
import {
  handleBackupHealth,
  handleListBackupVerifications,
  handleRecordBackupVerification,
} from "../handlers/backup.js";

const databaseUrl = process.env.BACKUP_TEST_DATABASE_URL || "";
const gateRequired = process.env.BACKUP_SECURITY_GATE === "required";
const dbIt = databaseUrl ? it : it.skip;

const ids = {
  admin: "7b1c5f2e-0d5a-4f0a-9b0e-3d1c2b3a4f01",
  adminNoTotp: "7b1c5f2e-0d5a-4f0a-9b0e-3d1c2b3a4f02",
  member: "7b1c5f2e-0d5a-4f0a-9b0e-3d1c2b3a4f03",
};
const tokens = {
  adminFresh: "backup-test-admin-fresh-token",
  adminStale: "backup-test-admin-stale-token",
  adminNo2fa: "backup-test-admin-no2fa-token",
  adminNoTotp: "backup-test-admin-nototp-token",
  member: "backup-test-member-token",
};
const env = { RL_FAIL_OPEN: "true", BACKUP_VERIFICATION_LIMIT_HOURS: "168" };

const request = (token, method = "GET", body) =>
  new Request("https://yourrank.site/api/admin/backup-verifications", {
    method,
    headers: {
      cookie: token ? `yr_session=${encodeURIComponent(token)}` : "",
      "content-type": "application/json",
      "user-agent": "backup-postgres-test",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

const validBody = (overrides = {}) => ({
  provider: "supabase",
  target: "restore-drill:scratch-test",
  startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
  completedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  rtoSeconds: 900,
  rpoSeconds: 3600,
  releaseSha: "0123456789abcdef0123456789abcdef01234567",
  evidence: { workflowRunId: "424242", sourceBackupId: "backup-1", restoreTargetId: "scratch-test", restoreTargetRetired: true },
  ...overrides,
});

describe("F-057/F-058 backup verification against real PostgreSQL", () => {
  let sql;
  let previousDatabaseUrl;

  if (gateRequired && !databaseUrl) {
    it("security gate is required but BACKUP_TEST_DATABASE_URL is missing", () => {
      throw new Error("BACKUP_SECURITY_GATE=required but BACKUP_TEST_DATABASE_URL is not set; refusing to certify");
    });
    return;
  }

  beforeAll(async () => {
    if (!databaseUrl) return;
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    sql = postgres(databaseUrl, { max: 2, prepare: false });
    await sql.unsafe("DELETE FROM users WHERE id = ANY($1::uuid[])", [Object.values(ids)]);
    await sql.unsafe("DELETE FROM backup_verifications WHERE target = 'restore-drill:scratch-test'");
    await sql.unsafe(
      `INSERT INTO users (id, email, is_admin, totp_secret, status) VALUES
         ($1, 'backup-admin@yourrank.test', true, 'enc:test-secret', 'active'),
         ($2, 'backup-admin-nototp@yourrank.test', true, NULL, 'active'),
         ($3, 'backup-member@yourrank.test', false, 'enc:test-secret', 'active')`,
      [ids.admin, ids.adminNoTotp, ids.member],
    );
    const sessions = [
      [tokens.adminFresh, ids.admin, "now()"],
      [tokens.adminStale, ids.admin, "now() - interval '30 minutes'"],
      [tokens.adminNo2fa, ids.admin, "NULL"],
      [tokens.adminNoTotp, ids.adminNoTotp, "now()"],
      [tokens.member, ids.member, "now()"],
    ];
    for (const [token, userId, verifiedAt] of sessions) {
      await sql.unsafe(
        `INSERT INTO sessions (token, user_id, expires_at, twofa_verified, twofa_verified_at)
         VALUES ($1, $2, now() + interval '1 hour', ${verifiedAt !== "NULL"}, ${verifiedAt})`,
        [await hashToken(token), userId],
      );
    }
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await sql.unsafe("DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])", [Object.values(ids)]);
    await sql.unsafe("DELETE FROM backup_verifications WHERE target = 'restore-drill:scratch-test'");
    await sql.unsafe("DELETE FROM users WHERE id = ANY($1::uuid[])", [Object.values(ids)]);
    await sql.end({ timeout: 0 });
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  dbIt("denies non-admin, admin without TOTP, admin without completed 2FA, and anonymous callers", async () => {
    expect((await handleRecordBackupVerification(request(null, "POST", validBody()), env)).status).toBe(401);
    expect((await handleRecordBackupVerification(request(tokens.member, "POST", validBody()), env)).status).toBe(403);
    expect((await handleRecordBackupVerification(request(tokens.adminNoTotp, "POST", validBody()), env)).status).toBe(403);
    expect((await handleRecordBackupVerification(request(tokens.adminNo2fa, "POST", validBody()), env)).status).toBe(403);
    expect((await handleListBackupVerifications(request(tokens.member), env)).status).toBe(403);
    expect((await handleListBackupVerifications(request(tokens.adminNo2fa), env)).status).toBe(403);
    const rows = await sql.unsafe("SELECT count(*)::int AS n FROM backup_verifications WHERE target = 'restore-drill:scratch-test'");
    expect(rows[0].n).toBe(0);
  });

  dbIt("stale 2FA can list history but cannot record", async () => {
    expect((await handleListBackupVerifications(request(tokens.adminStale), env)).status).toBe(200);
    const res = await handleRecordBackupVerification(request(tokens.adminStale, "POST", validBody()), env);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/2FA session has expired/);
  });

  dbIt("rejects untrustworthy evidence at the API and at the database trigger", async () => {
    const future = validBody({ completedAt: new Date(Date.now() + 10 * 60_000).toISOString() });
    expect((await handleRecordBackupVerification(request(tokens.adminFresh, "POST", future), env)).status).toBe(400);
    const reversed = validBody({ startedAt: new Date(Date.now() - 60_000).toISOString() });
    expect((await handleRecordBackupVerification(request(tokens.adminFresh, "POST", reversed), env)).status).toBe(400);
    expect((await handleRecordBackupVerification(request(tokens.adminFresh, "POST", validBody({ rtoSeconds: -1 })), env)).status).toBe(400);
    expect((await handleRecordBackupVerification(request(tokens.adminFresh, "POST", validBody({ rpoSeconds: -1 })), env)).status).toBe(400);
    const leaking = validBody({ notes: "restored with postgres://postgres:hunter2@db.example/postgres" });
    expect((await handleRecordBackupVerification(request(tokens.adminFresh, "POST", leaking), env)).status).toBe(400);

    const direct = async (startedAt, completedAt, rto, rpo) => {
      await sql.unsafe(
        `INSERT INTO backup_verifications (provider, target, started_at, completed_at, rto_seconds, rpo_seconds, success)
         VALUES ('supabase', 'restore-drill:scratch-test', ${startedAt}, ${completedAt}, ${rto}, ${rpo}, true)`,
      );
    };
    await expect(direct("now() - interval '1 minute'", "now() + interval '10 minutes'", 1, 1)).rejects.toThrow(/future/);
    await expect(direct("now()", "now() - interval '1 minute'", 1, 1)).rejects.toThrow(/after completed_at/);
    await expect(direct("now() - interval '1 minute'", "now()", -1, 1)).rejects.toThrow(/rto_seconds/);
    await expect(direct("now() - interval '1 minute'", "now()", 1, -1)).rejects.toThrow(/rpo_seconds/);
    const rows = await sql.unsafe("SELECT count(*)::int AS n FROM backup_verifications WHERE target = 'restore-drill:scratch-test'");
    expect(rows[0].n).toBe(0);
  });

  dbIt("fresh 2FA records a verification, stamps verified_at server-side, audits it, and turns health green", async () => {
    const before = await handleBackupHealth(new Request("https://yourrank.site/api/health/backup"), env);
    expect(before.status).toBe(503);

    const res = await handleRecordBackupVerification(request(tokens.adminFresh, "POST", validBody()), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const [row] = await sql.unsafe("SELECT * FROM backup_verifications WHERE id = $1", [body.id]);
    expect(row.success).toBe(true);
    expect(row.recorded_by).toBe(ids.admin);
    expect(row.source).toBe("admin-api");
    expect(Math.abs(new Date(row.verified_at).getTime() - Date.now())).toBeLessThan(60_000);
    expect(JSON.stringify(row)).not.toMatch(/postgres:\/\//);

    const [audit] = await sql.unsafe(
      "SELECT * FROM audit_log WHERE actor_id = $1 AND action = 'backup_verification_recorded' ORDER BY created_at DESC LIMIT 1",
      [ids.admin],
    );
    expect(audit).toBeDefined();
    expect(audit.details.verification_id).toBe(body.id);
    expect(audit.details.provider).toBe("supabase");
    expect(audit.details.target).toBe("restore-drill:scratch-test");
    expect(audit.user_agent).toBe("backup-postgres-test");

    const after = await handleBackupHealth(new Request("https://yourrank.site/api/health/backup"), env);
    expect(after.status).toBe(200);
    const list = await handleListBackupVerifications(request(tokens.adminFresh), env);
    expect(list.status).toBe(200);
    expect((await list.json()).verifications.some((v) => v.id === body.id)).toBe(true);
  });

  dbIt("a future-dated stored row makes health unhealthy instead of computing a negative age", async () => {
    await sql.unsafe("ALTER TABLE backup_verifications DISABLE TRIGGER backup_verifications_validate");
    try {
      await sql.unsafe(
        `INSERT INTO backup_verifications (provider, target, started_at, completed_at, verified_at, success)
         VALUES ('supabase', 'restore-drill:scratch-test', now(), now() + interval '2 days', now() + interval '2 days', true)`,
      );
    } finally {
      await sql.unsafe("ALTER TABLE backup_verifications ENABLE TRIGGER backup_verifications_validate");
    }
    const res = await handleBackupHealth(new Request("https://yourrank.site/api/health/backup"), env);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/future/);
  });
});
