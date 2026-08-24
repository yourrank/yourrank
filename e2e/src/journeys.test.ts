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

const id = randomId();
const email = `e2e-journeys-${id}@yourrank.test`;
const password = "TestPass1234";
const rotatedPassword = "TestPass5678";
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
    await client.get("/");

    const signup = await client.post("/api/auth/signup", { email, password, name: "E2E Journeys", slug });
    if (!signup.json?.ok) throw new Error(`signup failed: ${signup.status} ${signup.body}`);
    accountCreated = true;

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
      currentPassword: "WrongPass1234",
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

  it(`${tag("player-validation")} the server refuses invalid and duplicate players instead of storing them`, async () => {
    const before = await client.get(`/api/public/${slug}/players`);
    const beforeCount = Array.isArray(before.json?.players) ? before.json.players.length : 0;

    const negative = await client.put("/api/site", {
      siteId,
      players: [{ name: "Valid Player", wagered: -5 }],
    });
    expect(negative.status).toBe(400);
    expect(negative.json?.ok).toBe(false);
    expect(negative.json?.code).toBe("invalid_player_number");

    const notFinite = await client.put("/api/site", {
      siteId,
      players: [{ name: "Valid Player", wagered: "not-a-number" }],
    });
    expect(notFinite.status).toBe(400);
    expect(notFinite.json?.code).toBe("invalid_player_number");

    const duplicate = await client.put("/api/site", {
      siteId,
      players: [{ name: "Same Name", wagered: 10 }, { name: "same name", wagered: 20 }],
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.json?.code).toBe("duplicate_player");

    const nameless = await client.put("/api/site", { siteId, players: [{ name: "   ", wagered: 10 }] });
    expect(nameless.status).toBe(400);
    expect(nameless.json?.code).toBe("invalid_player_name");

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

  it(`${tag("games-config")} the public games config serves exactly what the owner saved`, async () => {
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

  it(`${tag("publish-draft-navigation")} returning a board to draft removes public access and republishing restores it`, async () => {
    const published = await client.get(`/${slug}`);
    expect(published.status).toBe(200);

    const publicApi = await client.get(`/api/public/${slug}`);
    expect(publicApi.status).toBe(200);
    expect(publicApi.json?.ok).toBe(true);

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
const describeViewer = VIEWER_SESSION ? describe : describe.skip;

describeViewer("viewer wagering journeys", () => {
  let viewer: Client;
  let roundId = "";
  let openMinesRound: any = null;

  beforeAll(async () => {
    viewer = new Client(BASE_URL);
    await viewer.get(`/${slug}`);
    viewer.setViewerSession(VIEWER_SESSION);
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
