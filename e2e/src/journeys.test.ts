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
// Deployed-target mode (staging release): /__scheduled only exists under
// `wrangler dev --test-scheduled`, so local-only scenarios are skipped.
const DEPLOYED_TARGET = process.env.E2E_DEPLOYED_TARGET === "1";

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

// Deployed Workers keep a per-isolate L1 site cache (site.js L1_TTL = 25s);
// invalidation clears only the isolate that served the write, so a public page
// can stay stale on other isolates until the TTL lapses.
async function waitForStatus(path: string, expected: number, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  let res = await client.get(path);
  while (DEPLOYED_TARGET && res.status !== expected && Date.now() < deadline) {
    await Bun.sleep(2_000);
    res = await client.get(path);
  }
  return res;
}

describe("giveaway verification E2E", () => {
  it(`${tag("giveaway-verification-boundary")} verification page cannot switch to a different giveaway from the posted body`, async () => {
    const guest = new Client(BASE_URL);
    await guest.get("/login");
    const giveawayId = crypto.randomUUID();
    const otherGiveawayId = crypto.randomUUID();
    const page = await guest.get(`/giveaways/verify?sessionId=${giveawayId}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain("Verify giveaway entry");
    const switched = await guest.post(`/api/viewer/giveaway?sessionId=${giveawayId}`, { sessionId: otherGiveawayId });
    expect(switched.status).toBe(400);
    expect(switched.json?.error).toContain("Giveaway link mismatch");
  });
 });

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


  it(tag("community-competitions", "competition lifecycle preserves Main standings and draft privacy"), async () => {
    const mainBefore = await client.get(`/api/site?siteId=${siteId}`);
    const endpoint = `/api/site/events?siteId=${siteId}`;
    const create = await client.post(endpoint, { name: "Community IA challenge", players: [{ name: "Competition player", score: 42 }], published: false });
    expect(create.status).toBe(200);
    expect(create.json?.id).toBeTruthy();
    const eventId = create.json.id;
    try {
      const list = await client.get(endpoint);
      const event = list.json.events.find((item: any) => item.id === eventId);
      expect(event.name).toBe("Community IA challenge");
      expect(event.published).toBe(false);
      expect(event.players).toEqual([{ name: "Competition player", score: 42 }]);
      expect(event.updated_at).toBeTruthy();
      expect(list.json.playerLimit).toBeGreaterThan(0);
      for (const players of [[{ name: 'Alex', score: 1 }, { name: 'alex', score: 2 }], [{ name: 'Invalid', score: -1 }], [{ name: 'Too high', score: 1e13 }], Array.from({ length: list.json.playerLimit + 1 }, (_, i) => ({ name: 'Player ' + i, score: i }))]) {
        const invalid = await client.post(endpoint, { id: eventId, updatedAt: event.updated_at, name: event.name, players, published: false });
        expect(invalid.status).toBe(400);
      }
      for (const tab of ["setup", "players", "history", "competitions"]) {
        const page = await client.get(`/dashboard/leaderboard/${tab}?board=${siteId}`);
        expect(page.status).toBe(200);
        expect(page.body).toContain('aria-label="Community sections"');
      }
      const guest = new Client(BASE_URL);
      const draftPage = await guest.get(`/${slug}/leaderboard?event=${eventId}`);
      expect(draftPage.body).not.toContain('data-event-id="' + eventId + '"');
      const preview = await client.post(`/dashboard/preview?board=${siteId}&section=leaderboard&edit=0`, {
        eventId, eventName: event.name, players: [{ name: "Competition player", score: 42, rank: 1 }], rankBy: "score",
      });
      expect(preview.status).toBe(200);
      expect(preview.body).toContain('data-event-id="' + eventId + '"');
      expect(preview.body).toContain("Competition player");
      const published = await client.post(endpoint, { id: eventId, updatedAt: event.updated_at, name: event.name, players: event.players, published: true });
      expect(published.status).toBe(200);
      if (PUBLIC_ACCESS_AVAILABLE) {
        const publicPage = await guest.get(`/${slug}/leaderboard?event=${eventId}`);
        expect(publicPage.status).toBe(200);
        expect(publicPage.body).toContain('data-event-id="' + eventId + '"');
        expect(publicPage.body).toContain("Competition player");
      }
      const stale = await client.post(endpoint, { id: eventId, updatedAt: event.updated_at, name: 'Stale overwrite', players: [], published: false });
      expect(stale.status).toBe(409);
      const latest = (await client.get(endpoint)).json.events.find((item: any) => item.id === eventId);
      const replacement = [{ name: 'Alex', score: 250 }, { name: 'Sam', score: 250 }, { name: 'Chris', score: 145 }];
      const renamed = await client.post(endpoint, { id: eventId, updatedAt: latest.updated_at, name: 'Managed challenge', players: replacement, published: false });
      expect(renamed.status).toBe(200);
      const managed = (await client.get(endpoint)).json.events.find((item: any) => item.id === eventId);
      expect(managed.name).toBe('Managed challenge');
      expect(managed.published).toBe(false);
      expect(managed.players).toEqual(replacement);
      const mainAfter = await client.get(`/api/site?siteId=${siteId}`);
      expect(mainAfter.json.data).toEqual(mainBefore.json.data);
    } finally {
      const list = await client.get(endpoint);
      const current = list.json.events.find((item: any) => item.id === eventId);
      if (current) {
        const deleted = await client.req("DELETE", endpoint, { body: { id: eventId, updatedAt: current.updated_at } });
        expect(deleted.status).toBe(200);
        expect((await client.get(endpoint)).json.events.some((item: any) => item.id === eventId)).toBe(false);
      }
    }
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
    expect(page.body).toContain("Returning members");
    expect(page.body).toContain('id="insightsParticipationTitle">Participation</h2>');
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
    expect(home.body).toContain('id="ovAttention"');
    expect(home.body).toContain('id="ovAttentionList"');
    expect(home.body).not.toContain('id="ovConnectionAlert"');
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

  it.skipIf(!PUBLIC_ACCESS_AVAILABLE || !VIEWER_SESSION || DEPLOYED_TARGET)(`${tag("wave-k-safe-activity-automation")} scheduled safe Activity executes once and records normal viewer participation`, async () => {
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

    const history = await viewer.get(`/${slug}/activity`);
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

    const hidden = await waitForStatus(`/${slug}`, 404);
    expect(hidden.status).toBe(404);
    const hiddenApi = await waitForStatus(`/api/public/${slug}`, 404);
    expect(hiddenApi.status).toBe(404);

    // The owner still sees the board, now flagged as a draft.
    const owner = await client.get(`/api/site?siteId=${encodeURIComponent(siteId)}`);
    expect(owner.status).toBe(200);
    expect(owner.json?.ok).toBe(true);

    const republished = await client.put("/api/site", { siteId, published: true });
    expect(republished.json?.ok).toBe(true);
    const visibleAgain = await waitForStatus(`/${slug}`, 200);
    expect(visibleAgain.status).toBe(200);
  }, 120_000);
});
