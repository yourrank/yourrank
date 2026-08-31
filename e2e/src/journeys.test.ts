/// <reference types="bun-types" />

/**
 * Release-gate journeys.
 *
 * Each test name carries a `[scenario:<key>]` tag from `scenarios.ts`; the gate
 * script maps bun's verdicts back to those keys, so a scenario that does not run
 * is reported SKIPPED rather than folded into a green check. Every assertion here
 * goes through the public HTTP surface of a deployed environment: the point is to
 * catch the failure class where unit tests stayed green while production did not.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { SQL } from "bun";
import { Client, randomId } from "./client.js";
import { tag } from "./scenarios.js";

const rawBaseUrl = process.env.E2E_BASE_URL?.trim();
if (!rawBaseUrl) {
  throw new Error("E2E_BASE_URL is required and must point to an isolated non-production environment.");
}
const parsedBaseUrl = new URL(rawBaseUrl);
if (parsedBaseUrl.hostname === "yourrank.site" || parsedBaseUrl.hostname === "www.yourrank.site") {
  throw new Error("Refusing to run mutating E2E tests against production.");
}
if (process.env.E2E_ALLOW_MUTATIONS !== "1") {
  throw new Error("Set E2E_ALLOW_MUTATIONS=1 after confirming E2E_BASE_URL is isolated from production.");
}

const BASE_URL = parsedBaseUrl.origin;
const VIEWER_SESSION = process.env.E2E_VIEWER_SESSION?.trim() || "";

/**
 * A board only becomes publicly reachable once the OWNER'S EMAIL IS VERIFIED:
 * `getPublicSite` hides boards whose owner is unverified, and the public slug
 * serves `pendingVerificationPage` (403 "This leaderboard isn't live yet").
 * The raw verification token is only ever delivered by email, so an HTTP-only
 * suite cannot complete it. When E2E_DB_URL points at the target environment's
 * database we satisfy that precondition directly — the same state change the
 * emailed link performs. Without it, the scenarios that require public access
 * report SKIPPED rather than failing or pretending to pass.
 */
const DB_URL = process.env.E2E_DB_URL?.trim() || "";
const PUBLIC_ACCESS_AVAILABLE = Boolean(DB_URL);

const id = randomId();
const email = `e2e-journeys-${id}@yourrank.test`;
// The server password policy requires a symbol (apps/leaderboard/src/password-rules.js).
const password = "TestPass1234!";
const rotatedPassword = "TestPass5678!";
const slug = `e2e-j-${id}`;

let client: Client;
let siteId = "";
let currentPassword = password;
let accountCreated = false;

async function login(pw: string) {
  return client.post("/api/auth/login", { email, password: pw });
}

describe("release-gate journeys", () => {
  beforeAll(async () => {
    client = new Client(BASE_URL);
    // Seeds the __csrf cookie. "/" is proxied to the MARKETING worker binding,
    // which is absent in local dev (503), so use a first-party page instead.
    await client.get("/login");

    const signup = await client.post("/api/auth/signup", { email, password, name: "E2E Journeys", slug });
    if (!signup.json?.ok) throw new Error(`signup failed: ${signup.status} ${signup.body}`);
    accountCreated = true;

    if (PUBLIC_ACCESS_AVAILABLE) {
      const sql = new SQL(DB_URL);
      try {
        await sql`update users set email_verified = true where email = ${email}`;
      } finally {
        await sql.end();
      }
    }

    const first = await login(password);
    if (!first.json?.ok) throw new Error(`login failed: ${first.status} ${first.body}`);

    const trial = await client.post("/api/billing/trial", {});
    if (!trial.json?.ok) throw new Error(`trial failed: ${trial.status} ${trial.body}`);

    const site = await client.get("/api/site");
    if (!site.json?.ok || !site.json?.siteId) throw new Error(`site lookup failed: ${site.status} ${site.body}`);
    siteId = site.json.siteId;

    const publish = await client.post("/api/site/finish", { siteId });
    if (!publish.json?.ok) throw new Error(`publish failed: ${publish.status} ${publish.body}`);
  });

  afterAll(async () => {
    if (!accountCreated) return;
    const relogin = await login(currentPassword);
    if (!relogin.json?.ok) throw new Error(`cleanup login failed: ${relogin.status} ${relogin.body}`);
    const cleanup = await client.post("/api/account/delete", { password: currentPassword });
    if (!cleanup.json?.ok) throw new Error(`account cleanup failed: ${cleanup.status} ${cleanup.body}`);
  });

  it(`${tag("auth-login-logout-relogin")} logout ends the session and re-login restores it`, async () => {
    const me = await client.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.json?.ok).toBe(true);

    const logout = await client.post("/api/auth/logout", {});
    expect(logout.status).toBe(200);
    // The reported failure class: a successful logout surfacing as an error.
    expect(logout.json?.ok).toBe(true);

    const afterLogout = await client.get("/api/auth/me");
    expect(afterLogout.status).toBe(401);

    const again = await login(currentPassword);
    expect(again.status).toBe(200);
    expect(again.json?.ok).toBe(true);

    const meAgain = await client.get("/api/auth/me");
    expect(meAgain.status).toBe(200);
    expect(meAgain.json?.user?.email).toBe(email);
  });

  it(`${tag("auth-password-reset")} reset request is accepted, a bogus token is refused, and change-password rotates the credential`, async () => {
    const forgot = await client.post("/api/auth/forgot", { email });
    expect(forgot.status).toBe(200);
    expect(forgot.json?.ok).toBe(true);

    const bogus = await client.post("/api/auth/reset", { token: `bogus-${id}`, password: rotatedPassword });
    expect(bogus.status).toBe(400);
    expect(bogus.json?.ok).not.toBe(true);

    const wrongCurrent = await client.post("/api/auth/change-password", {
      currentPassword: "WrongPass1234!",
      password: rotatedPassword,
    });
    expect(wrongCurrent.status).toBe(401);

    const rotate = await client.post("/api/auth/change-password", {
      currentPassword,
      password: rotatedPassword,
    });
    expect(rotate.status).toBe(200);
    expect(rotate.json?.ok).toBe(true);
    currentPassword = rotatedPassword;

    const stale = await login(password);
    expect(stale.json?.ok).not.toBe(true);

    const fresh = await login(rotatedPassword);
    expect(fresh.json?.ok).toBe(true);
  });

  it.skipIf(!PUBLIC_ACCESS_AVAILABLE)(`${tag("player-validation")} the server refuses invalid and duplicate players instead of storing them`, async () => {
    const before = await client.get(`/api/public/${slug}/players`);
    const beforeCount = Array.isArray(before.json?.players) ? before.json.players.length : 0;

    const negative = await client.put("/api/site", {
      siteId,
      players: [{ name: "Valid Player", wagered: -5 }],
    });
    // PUT /api/site validates the payload through its schema layer, which answers
    // with a field-scoped message (`players.<i>.<field>: ...`) and no `code`.
    expect(negative.status).toBe(400);
    expect(negative.json?.ok).toBe(false);
    expect(negative.json?.error).toContain("players.0.wagered");

    const notFinite = await client.put("/api/site", {
      siteId,
      players: [{ name: "Valid Player", wagered: "not-a-number" }],
    });
    expect(notFinite.status).toBe(400);
    expect(notFinite.json?.ok).toBe(false);
    expect(notFinite.json?.error).toContain("players.0.wagered");

    const duplicate = await client.put("/api/site", {
      siteId,
      players: [{ name: "Same Name", wagered: 10 }, { name: "same name", wagered: 20 }],
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.json?.ok).toBe(false);
    expect(duplicate.json?.error).toContain("Duplicate player name");

    const nameless = await client.put("/api/site", { siteId, players: [{ name: "   ", wagered: 10 }] });
    expect(nameless.status).toBe(400);
    expect(nameless.json?.ok).toBe(false);
    expect(nameless.json?.error).toContain("players.0.name");

    // None of the refusals may have persisted anything.
    const unchanged = await client.get(`/api/public/${slug}/players`);
    const unchangedCount = Array.isArray(unchanged.json?.players) ? unchanged.json.players.length : 0;
    expect(unchangedCount).toBe(beforeCount);

    const valid = await client.put("/api/site", {
      siteId,
      players: [{ name: "Gate Player One", wagered: 120 }, { name: "Gate Player Two", wagered: 60 }],
    });
    expect(valid.status).toBe(200);
    expect(valid.json?.ok).toBe(true);

    const readback = await client.get(`/api/public/${slug}/players`);
    expect(readback.status).toBe(200);
    const names = (readback.json?.players || []).map((p: any) => String(p.name));
    expect(names).toContain("Gate Player One");
    expect(names).toContain("Gate Player Two");
  });

  it.skipIf(!PUBLIC_ACCESS_AVAILABLE)(`${tag("games-config")} the public games config serves exactly what the owner saved`, async () => {
    const enable = await client.post("/api/site/sections", { siteId, siteSections: { games: true } });
    expect(enable.status).toBe(200);
    expect(enable.json?.ok).toBe(true);

    const settings = { siteId, game: "dice", enabled: true, minBet: 5, maxBet: 500, houseEdgeBps: 250, dailyLossCap: 1000 };
    const saved = await client.post("/api/site/games/settings", settings);
    expect(saved.status).toBe(200);
    expect(saved.json?.ok).toBe(true);

    const owner = await client.get(`/api/site/games/settings?siteId=${encodeURIComponent(siteId)}`);
    expect(owner.status).toBe(200);
    const ownerDice = (owner.json?.settings || []).find((g: any) => g.game === "dice");
    expect(ownerDice).toBeDefined();
    expect(ownerDice.minBet).toBe(5);
    expect(ownerDice.maxBet).toBe(500);
    expect(ownerDice.houseEdgeBps).toBe(250);

    const config = await client.get(`/api/games/config?slug=${encodeURIComponent(slug)}`);
    expect(config.status).toBe(200);
    expect(config.json?.ok).toBe(true);
    expect(config.json?.gamesEnabled).toBe(true);
    const publicDice = (config.json?.games || []).find((g: any) => g.game === "dice");
    expect(publicDice).toBeDefined();
    expect(publicDice.minBet).toBe(5);
    expect(publicDice.maxBet).toBe(500);
    expect(publicDice.houseEdgeBps).toBe(250);

    // A disabled game must disappear from the public surface, not linger.
    const disabled = await client.post("/api/site/games/settings", { ...settings, enabled: false });
    expect(disabled.json?.ok).toBe(true);
    const configAfter = await client.get(`/api/games/config?slug=${encodeURIComponent(slug)}`);
    expect((configAfter.json?.games || []).some((g: any) => g.game === "dice")).toBe(false);

    const restored = await client.post("/api/site/games/settings", settings);
    expect(restored.json?.ok).toBe(true);
  });

  it(`${tag("raffle-zero-ticket-refusal")} drawing a raffle with zero tickets is refused and the raffle stays undrawn`, async () => {
    const created = await client.post("/api/events/raffles", {
      siteId,
      title: `Gate Raffle ${id}`,
      ticketCost: 25,
      maxTickets: 3,
    });
    expect(created.status).toBe(200);
    expect(created.json?.ok).toBe(true);
    const raffleId = created.json?.raffle?.id || created.json?.id;
    expect(raffleId).toBeDefined();

    const draw = await client.post("/api/events/raffles/draw", { raffleId });
    expect(draw.status).toBe(400);
    expect(draw.json?.ok).not.toBe(true);
    expect(String(draw.json?.error || "")).toMatch(/no tickets/i);

    // Persistence check: the refusal must not have left a fabricated winner.
    const list = await client.get(`/api/events/raffles?siteId=${encodeURIComponent(siteId)}`);
    expect(list.status).toBe(200);
    const raffle = (list.json?.raffles || []).find((r: any) => r.id === raffleId);
    expect(raffle).toBeDefined();
    expect(raffle.status).toBe("active");
    expect(raffle.winner_name ?? null).toBeNull();
    expect(raffle.drawn_at ?? null).toBeNull();
    expect(Number(raffle.total_tickets || 0)).toBe(0);
  });

  it(`${tag("tournament-kick-channel")} the tournament Kick channel persists across a refetch`, async () => {
    const created = await client.post("/api/tournaments", {
      siteId,
      title: `Gate Tournament ${id}`,
      gameName: "Test Game",
      bracketSize: 4,
      format: "bracket",
    });
    expect(created.status).toBe(200);
    expect(created.json?.ok).toBe(true);
    const tournamentId = created.json?.tournament?.id || created.json?.id;
    expect(tournamentId).toBeDefined();

    const channel = `gate_channel_${id}`.toLowerCase();
    const settings = await client.post(`/api/tournaments/${tournamentId}/settings`, {
      siteId,
      chatChannel: channel,
      entryKeyword: "!gate",
      minCredits: 5,
      requireLogin: true,
    });
    expect(settings.status).toBe(200);
    expect(settings.json?.ok).toBe(true);

    const refetched = await client.get(`/api/tournaments?siteId=${encodeURIComponent(siteId)}`);
    expect(refetched.status).toBe(200);
    const tournament = (refetched.json?.tournaments || []).find((t: any) => t.id === tournamentId);
    expect(tournament).toBeDefined();
    expect(String(tournament.chat_channel || "")).toContain(channel.replace(/[^a-z0-9_]/g, ""));
    expect(String(tournament.entry_keyword || "")).toBe("!gate");
    expect(Number(tournament.min_credits || 0)).toBe(5);
    expect(tournament.require_login).toBe(true);
  });

  it(`${tag("account-export-state")} account export reports a real job or an explicit unavailable state`, async () => {
    const res = await client.post("/api/account/export", {});
    expect([200, 503]).toContain(res.status);

    if (res.status === 503) {
      // Truthful unavailable state: never a success shape.
      expect(res.json?.ok).toBe(false);
      expect(String(res.json?.code || "")).toBe("export_not_configured");
      expect(String(res.json?.error || "").length).toBeGreaterThan(0);
      return;
    }

    expect(res.json?.ok).toBe(true);
    const exportId = res.json?.exportId;
    expect(exportId).toBeDefined();
    expect(["pending", "processing", "completed"]).toContain(String(res.json?.status));

    const status = await client.get(`/api/account/export/${exportId}/status`);
    expect(status.status).toBe(200);
    expect(status.json?.ok).toBe(true);
    expect(["pending", "processing", "completed", "failed"]).toContain(String(status.json?.status));
    // A job that is not finished must not advertise a downloadable artifact.
    if (String(status.json?.status) !== "completed") {
      expect(status.json?.downloadUrl ?? null).toBeNull();
    }
  });

  it(`${tag("analytics-empty-vs-error")} analytics reports an empty dataset distinguishably from a failure`, async () => {
    const res = await client.get(`/api/credits/analytics?siteId=${encodeURIComponent(siteId)}&days=30`);
    expect(res.status).toBe(200);
    expect(res.json?.ok).toBe(true);
    expect(res.json?.days).toBe(30);
    expect(res.json?.summary).toBeDefined();
    expect(res.json?.summary?.allTimeEarned).toBe(0);
    expect(res.json?.summary?.viewerBalance).toBe(0);
    expect(Array.isArray(res.json?.topEarners)).toBe(true);
    expect(res.json?.topEarners.length).toBe(0);
    expect(Array.isArray(res.json?.creditsByDay)).toBe(true);
    expect(res.json?.creditsByDay.length).toBe(0);

    // The error path must be a different, non-ok shape rather than the same empty payload.
    const missing = await client.get(`/api/credits/analytics?siteId=${crypto.randomUUID()}&days=30`);
    expect(missing.status).toBe(404);
    expect(missing.json?.ok).not.toBe(true);
  });

  it(`${tag("wave-i-owner-insights-connections")} owner loads selected-site Insights and the scoped connection inventory`, async () => {
    const page = await client.get("/dashboard/analytics");
    expect(page.status).toBe(200);
    expect(page.body).toContain("Insights");
    expect(page.body).toContain("Is the community returning?");
    expect(page.body).toContain("How are code drops being used?");
    expect(page.body).toContain("Claims completed");

    const primary = await client.get(`/api/insights?siteId=${encodeURIComponent(siteId)}&days=30`);
    expect(primary.status).toBe(200);
    expect(primary.headers.get("cache-control")).toContain("no-store");
    expect(primary.json?.ok).toBe(true);
    expect(primary.json?.site?.id).toBe(siteId);
    expect(primary.json?.window).toEqual(expect.objectContaining({
      requestedDays: 30,
      effectiveDays: 30,
      timeZone: "UTC",
      startsAt: expect.any(String),
      endsAt: expect.any(String),
    }));
    expect(primary.json?.community).toBeDefined();
    expect(primary.json?.participation).toBeDefined();
    expect(primary.json?.rewards).toBeDefined();
    expect(primary.json?.rewards?.claimsCompleted).toBeDefined();
    expect(primary.json?.operations).toBeDefined();
    expect(primary.json?.availability).toEqual(expect.objectContaining({
      community: true,
      participation: true,
      rewards: true,
      pendingReviews: true,
      pendingClaims: true,
    }));

    const second = await client.post("/api/site/create", { slug: `${slug}-insights-2`, name: "E2E Insights Second Site" });
    expect(second.status).toBe(200);
    expect(second.json?.ok).toBe(true);
    expect(second.json?.id).not.toBe(siteId);
    const secondInsights = await client.get(`/api/insights?siteId=${encodeURIComponent(second.json.id)}&days=7`);
    expect(secondInsights.status).toBe(200);
    expect(secondInsights.json?.site?.id).toBe(second.json.id);
    expect(secondInsights.json?.site?.id).not.toBe(primary.json?.site?.id);

    const substituted = await client.get(`/api/insights?siteId=${crypto.randomUUID()}&days=30`);
    expect(substituted.status).toBe(404);
    const unsupportedWindow = await client.get(`/api/insights?siteId=${encodeURIComponent(siteId)}&days=365`);
    expect(unsupportedWindow.status).toBe(400);

    const connections = await client.get(`/api/account/connected-accounts?board=${encodeURIComponent(second.json.id)}`);
    expect(connections.status).toBe(200);
    expect(connections.headers.get("cache-control")).toContain("no-store");
    expect(Array.isArray(connections.json?.connections)).toBe(true);
    expect(connections.json?.selectedSiteId).toBe(second.json.id);
    expect(connections.json?.connections.some((row) => row.scope === "Creator account")).toBe(true);
    expect(connections.json?.connections.some((row) => row.scope === "E2E Insights Second Site")).toBe(true);
    const selectedSiteRows = connections.json?.connections.filter((row) => row.selectedSite === true) || [];
    expect(selectedSiteRows.length).toBe(3);
    expect(selectedSiteRows.every((row) => row.scope === "E2E Insights Second Site")).toBe(true);
    const selectedAccountAction = connections.json?.connections.find((row) => row.id === "kick-account")?.action?.href;
    expect(selectedAccountAction).toBe(`/dashboard/site/connections?siteId=${encodeURIComponent(second.json.id)}`);
    const secondNotificationActions = selectedSiteRows
      .filter((row) => row.provider === "Discord delivery" || row.provider === "Telegram delivery")
      .map((row) => row.action?.href);
    expect(secondNotificationActions).toEqual([
      `/dashboard/site?board=${encodeURIComponent(second.json.id)}&tab=notifications`,
      `/dashboard/site?board=${encodeURIComponent(second.json.id)}&tab=notifications`,
    ]);
    expect(JSON.stringify(connections.json)).not.toMatch(/access_token|refresh_token|webhook_url|telegram_chat_id|kick_user_id|telegram_user_id/i);

    const home = await client.get(`/dashboard?board=${encodeURIComponent(siteId)}`);
    expect(home.status).toBe(200);
    expect(home.body).toContain('id="ovConnectionAlert"');
    expect(home.body).toContain('id="ovConnectionAlertAction"');
  });

  it.skipIf(!PUBLIC_ACCESS_AVAILABLE)(`${tag("wave-i-moderator-insights-readonly")} Moderator views Insights but provider management remains owner-only`, async () => {
    const moderatorClient = new Client(BASE_URL);
    const moderatorEmail = `e2e-wave-i-moderator-${id}@yourrank.test`;
    const moderatorSlug = `e2e-wave-i-mod-${id}`;
    let moderatorCreated = false;
    const sql = new SQL(DB_URL);
    try {
      await moderatorClient.get("/login");
      const signup = await moderatorClient.post("/api/auth/signup", {
        email: moderatorEmail,
        password,
        name: "E2E Wave I Moderator",
        slug: moderatorSlug,
      });
      expect(signup.status).toBe(200);
      expect(signup.json?.ok).toBe(true);
      moderatorCreated = true;
      const login = await moderatorClient.post("/api/auth/login", { email: moderatorEmail, password });
      expect(login.status).toBe(200);
      expect(login.json?.ok).toBe(true);

      const ownerRows = await sql`select id from users where email = ${email} limit 1`;
      const moderatorRows = await sql`select id from users where email = ${moderatorEmail} limit 1`;
      const ownerId = ownerRows[0]?.id;
      const moderatorId = moderatorRows[0]?.id;
      expect(ownerId).toBeDefined();
      expect(moderatorId).toBeDefined();
      await sql`update users set plan='team', plan_expires_at=now() + interval '30 days', status='active' where id=${ownerId}`;
      await sql`
        insert into site_members (site_id, user_id, role, invited_by)
        values (${siteId}, ${moderatorId}, 'moderator', ${ownerId})
        on conflict (site_id, user_id) do update set role='moderator', invited_by=${ownerId}, updated_at=now()
      `;

      const insights = await moderatorClient.get(`/api/insights?siteId=${encodeURIComponent(siteId)}&days=30`);
      expect(insights.status).toBe(200);
      expect(insights.json?.ok).toBe(true);
      expect(insights.json?.site?.id).toBe(siteId);
      expect(JSON.stringify(insights.json)).not.toMatch(/access_token|refresh_token|provider|email|telegram_user|kick_user/i);

      const health = await moderatorClient.get(`/api/credits/status?siteId=${encodeURIComponent(siteId)}`);
      expect(health.status).toBe(200);
      expect(health.json?.channel?.canManage).toBe(false);
      expect(health.json?.capabilities?.manageConnections).toBe(false);
      expect(JSON.stringify(health.json?.channel)).not.toMatch(/access_token|refresh_token|externalId|webhook_url|telegram_chat_id/i);

      const disconnect = await moderatorClient.post(`/api/kick/disconnect?siteId=${encodeURIComponent(siteId)}`, {});
      expect(disconnect.status).toBe(403);
      expect(disconnect.json?.ok).not.toBe(true);
    } finally {
      await sql.end();
      if (moderatorCreated) {
        const cleanup = await moderatorClient.post("/api/account/delete", { password });
        if (!cleanup.json?.ok) throw new Error(`moderator cleanup failed: ${cleanup.status} ${cleanup.body}`);
      }
    }
  });

  it.skipIf(!PUBLIC_ACCESS_AVAILABLE || !VIEWER_SESSION)(`${tag("wave-k-safe-activity-automation")} scheduled safe Activity executes once and records normal viewer participation`, async () => {
    const template = await client.post("/api/activities/templates", {
      siteId,
      kind: "safe_code_drop",
      name: "E2E scheduled drop",
      config: { pointsReward: 25, maxClaims: 10, expireMinutes: 30 },
    });
    expect(template.status).toBe(201);
    expect(template.json?.ok).toBe(true);
    const templateId = template.json?.template?.id;
    expect(templateId).toBeDefined();

    const schedule = await client.post("/api/activities/schedules", {
      siteId,
      templateId,
      recurrence: "once",
      runAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    expect(schedule.status).toBe(201);
    expect(schedule.json?.ok).toBe(true);
    const scheduleId = schedule.json?.schedule?.id;
    expect(scheduleId).toBeDefined();

    const sql = new SQL(DB_URL);
    let generatedCode = "";
    try {
      await sql`
        update activity_schedules
           set next_run_at=now() - interval '1 minute'
         where id=${scheduleId} and site_id=${siteId} and status='scheduled'`;

      const scheduledPath = `/__scheduled?cron=${encodeURIComponent("*/5 * * * *")}`;
      const firstRun = await client.get(scheduledPath);
      expect(firstRun.status).toBe(200);
      const replay = await client.get(scheduledPath);
      expect(replay.status).toBe(200);

      let persisted: any = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const rows = await sql`
          select
            count(distinct o.id)::int as occurrences,
            count(distinct d.id)::int as activities,
            max(d.code) as code
          from activity_schedule_occurrences o
          left join code_drops d on d.automation_occurrence_id=o.id
          where o.schedule_id=${scheduleId} and o.status='succeeded'`;
        persisted = rows[0];
        if (persisted?.activities === 1) break;
        await Bun.sleep(100);
      }
      expect(persisted).toEqual(expect.objectContaining({ occurrences: 1, activities: 1 }));
      generatedCode = String(persisted?.code || "");
      expect(generatedCode).toMatch(/^YR-[A-F0-9]{16}$/);

      const activityRows = await sql`
        select count(*)::int as count
          from code_drops
         where automation_occurrence_id in (
           select id from activity_schedule_occurrences where schedule_id=${scheduleId}
         )`;
      expect(activityRows[0]?.count).toBe(1);
    } finally {
      await sql.end();
    }

    const viewer = new Client(BASE_URL);
    await viewer.get("/login");
    viewer.setViewerSession(VIEWER_SESSION);
    const claim = await viewer.post("/api/events/drops/claim", { site: slug, code: generatedCode });
    expect(claim.status).toBe(200);
    expect(claim.json?.ok).toBe(true);
    expect(claim.json?.pointsAwarded).toBe(25);

    const history = await viewer.get(`/${slug}/me`);
    expect(history.status).toBe(200);
    expect(history.body).toContain("Claimed a code drop");
    expect(history.body).toContain(">Claimed</span>");
  });

  it.skipIf(!PUBLIC_ACCESS_AVAILABLE)(`${tag("publish-draft-navigation")} returning a board to draft removes public access and republishing restores it`, async () => {
    const published = await client.get(`/${slug}`);
    expect(published.status).toBe(200);

    // GET /api/public/:slug returns the raw public board shape (site.js publicShape),
    // not an { ok: true } envelope, so assert on the real payload instead.
    const publicApi = await client.get(`/api/public/${slug}`);
    expect(publicApi.status).toBe(200);
    expect(typeof publicApi.json?.brand?.name).toBe("string");
    expect(String(publicApi.json?.brand?.name).length).toBeGreaterThan(0);
    expect(Array.isArray(publicApi.json?.players)).toBe(true);

    const draft = await client.put("/api/site", { siteId, published: false, isDraft: true });
    expect(draft.status).toBe(200);
    expect(draft.json?.ok).toBe(true);

    const hidden = await client.get(`/${slug}`);
    expect(hidden.status).toBe(404);
    const hiddenApi = await client.get(`/api/public/${slug}`);
    expect(hiddenApi.status).toBe(404);

    // The owner still sees the board, now flagged as a draft.
    const owner = await client.get(`/api/site?siteId=${encodeURIComponent(siteId)}`);
    expect(owner.status).toBe(200);
    expect(owner.json?.ok).toBe(true);

    const republished = await client.put("/api/site", { siteId, published: true });
    expect(republished.json?.ok).toBe(true);
    const visibleAgain = await client.get(`/${slug}`);
    expect(visibleAgain.status).toBe(200);
  });
});

/**
 * Wagering needs a viewer session, which only Kick/Telegram OAuth can mint. When
 * `E2E_VIEWER_SESSION` carries a captured `yr_viewer` token these run for real;
 * otherwise they are reported SKIPPED, never PASSED.
 */
/**
 * A minted viewer session alone is not enough to wager: the viewer first uses
 * the real explicit Join mutation, then needs a funded membership on the board
 * under test. In production that balance comes
 * from Kick channel-point claims (OAuth + webhooks, not runnable headless), so
 * the gate grants it through the owner-facing credit-adjust API instead — a real
 * product path, not a database write. E2E_VIEWER_USERNAME is the minted viewer's
 * Kick username, which that API resolves.
 */
const VIEWER_USERNAME = process.env.E2E_VIEWER_USERNAME?.trim() || "";
const describeViewer = VIEWER_SESSION && VIEWER_USERNAME ? describe : describe.skip;

describeViewer("viewer wagering journeys", () => {
  let viewer: Client;
  let roundId = "";
  let openMinesRound: any = null;

  // This suite owns its own board. The creator suite above deletes its account in
  // afterAll, so reusing that owner/site here 401s. viewer_sessions is keyed only
  // by viewer_id (no site column), so the minted token is valid on any board.
  // `slug` deliberately shadows the creator suite's slug for the tests below.
  const vId = randomId();
  const vEmail = `e2e-viewer-owner-${vId}@yourrank.test`;
  const slug = `e2e-v-${vId}`;
  let ownerClient: Client;
  let vSiteId = "";
  let vAccountCreated = false;

  beforeAll(async () => {
    ownerClient = new Client(BASE_URL);
    await ownerClient.get("/login");

    const signup = await ownerClient.post("/api/auth/signup", { email: vEmail, password, name: "E2E Viewer Owner", slug });
    if (!signup.json?.ok) throw new Error(`viewer-owner signup failed: ${signup.status} ${signup.body}`);
    vAccountCreated = true;

    const sql = new SQL(DB_URL);
    try {
      await sql`update users set email_verified = true where email = ${vEmail}`;
    } finally {
      await sql.end();
    }

    const loginRes = await ownerClient.post("/api/auth/login", { email: vEmail, password });
    if (!loginRes.json?.ok) throw new Error(`viewer-owner login failed: ${loginRes.status} ${loginRes.body}`);

    const trial = await ownerClient.post("/api/billing/trial", {});
    if (!trial.json?.ok) throw new Error(`viewer-owner trial failed: ${trial.status} ${trial.body}`);

    const site = await ownerClient.get("/api/site");
    if (!site.json?.siteId) throw new Error(`viewer-owner site lookup failed: ${site.status} ${site.body}`);
    vSiteId = site.json.siteId;

    const publish = await ownerClient.post("/api/site/finish", { siteId: vSiteId });
    if (!publish.json?.ok) throw new Error(`viewer-owner publish failed: ${publish.status} ${publish.body}`);

    const sections = await ownerClient.post("/api/site/sections", { siteId: vSiteId, siteSections: { games: true } });
    if (!sections.json?.ok) throw new Error(`games section enable failed: ${sections.status} ${sections.body}`);

    for (const game of ["dice", "mines"]) {
      const saved = await ownerClient.post("/api/site/games/settings", {
        siteId: vSiteId, game, enabled: true, minBet: 1, maxBet: 500, houseEdgeBps: 250, dailyLossCap: 100000,
      });
      if (!saved.json?.ok) throw new Error(`${game} settings failed: ${saved.status} ${saved.body}`);
    }

    viewer = new Client(BASE_URL);
    viewer.setViewerSession(VIEWER_SESSION);
    const viewerLanding = await viewer.get(`/${slug}`);
    if (viewerLanding.status !== 200) throw new Error(`viewer landing failed: ${viewerLanding.status} ${viewerLanding.body}`);

    const beforeJoin = await viewer.get("/api/viewer/me");
    if (beforeJoin.status !== 200) throw new Error(`viewer account lookup failed: ${beforeJoin.status} ${beforeJoin.body}`);
    if ((beforeJoin.json?.communities || []).some((community: any) => community.slug === slug)) {
      throw new Error("passive viewer landing unexpectedly created Membership");
    }

    const joined = await viewer.post("/api/viewer/membership/join", { slug });
    if (!joined.json?.ok) throw new Error(`explicit viewer Join failed: ${joined.status} ${joined.body}`);
    const replayedJoin = await viewer.post("/api/viewer/membership/join", { slug });
    if (!replayedJoin.json?.ok) throw new Error(`idempotent viewer Join failed: ${replayedJoin.status} ${replayedJoin.body}`);

    const afterJoin = await viewer.get("/api/viewer/me");
    const joinedRows = (afterJoin.json?.communities || []).filter((community: any) => community.slug === slug);
    if (joinedRows.length !== 1) throw new Error(`explicit Join should create exactly one Membership, found ${joinedRows.length}`);

    // Owner funds the viewer on this board through the dashboard's own API.
    const grant = await ownerClient.post("/api/credits/tip", {
      siteId: vSiteId,
      username: VIEWER_USERNAME,
      delta: 5000,
      reason: "release gate funding",
    });
    if (!grant.json?.ok) throw new Error(`viewer funding failed: ${grant.status} ${grant.body}`);
  });

  afterAll(async () => {
    if (!vAccountCreated) return;
    const relogin = await ownerClient.post("/api/auth/login", { email: vEmail, password });
    if (!relogin.json?.ok) return;
    await ownerClient.post("/api/account/delete", { password });
  });

  it(`${tag("games-bet-placement")} a dice bet debits the balance and returns a settled round`, async () => {
    const before = await viewer.get(`/api/games/history?slug=${encodeURIComponent(slug)}`);
    expect(before.status).toBe(200);

    const bet = await viewer.post("/api/games/bet", {
      slug,
      game: "dice",
      bet: 5,
      params: { target: 50, direction: "over" },
      idempotencyKey: `gate-dice-${randomId()}`,
    });
    expect(bet.status).toBe(200);
    expect(bet.json?.ok).toBe(true);
    expect(typeof bet.json?.balance).toBe("number");
    roundId = bet.json?.round?.id;
    expect(roundId).toBeDefined();
    expect(bet.json?.round?.bet).toBe(5);
  });

  it(`${tag("games-round-readback")} round params and outcome read back unchanged from the server`, async () => {
    expect(roundId).toBeTruthy();
    const history = await viewer.get(`/api/games/history?slug=${encodeURIComponent(slug)}`);
    expect(history.status).toBe(200);
    const round = (history.json?.rounds || []).find((r: any) => r.id === roundId);
    expect(round).toBeDefined();
    expect(round.game).toBe("dice");
    // Params and outcome must be structured JSON, not a re-encoded string.
    expect(typeof round.params).toBe("object");
    expect(round.params?.target).toBe(50);
    expect(round.params?.direction).toBe("over");
    expect(round.outcome === null || typeof round.outcome === "object").toBe(true);
  });

  it(`${tag("games-mines-reveal-cashout")} mines reveal and cashout settle server-side`, async () => {
    const bet = await viewer.post("/api/games/bet", {
      slug,
      game: "mines",
      bet: 5,
      params: { mines: 3 },
      idempotencyKey: `gate-mines-${randomId()}`,
    });
    expect(bet.status).toBe(200);
    expect(bet.json?.ok).toBe(true);
    openMinesRound = bet.json?.round;
    expect(openMinesRound?.state).toBe("open");
    // The layout must stay secret while the round is open.
    expect(openMinesRound?.outcome ?? null).toBeNull();

    const reveal = await viewer.post("/api/games/mines/reveal", {
      slug,
      roundId: openMinesRound.id,
      tile: 0,
    });
    expect(reveal.status).toBe(200);
    expect(reveal.json?.ok).toBe(true);

    const cashout = await viewer.post("/api/games/mines/cashout", { slug, roundId: openMinesRound.id });
    expect([200, 400]).toContain(cashout.status);
    if (cashout.status === 200) {
      expect(cashout.json?.ok).toBe(true);
      expect(typeof cashout.json?.balance).toBe("number");
    } else {
      // Losing the round before cashout is a legitimate settled outcome.
      expect(String(cashout.json?.error || "").length).toBeGreaterThan(0);
    }
  });
});
