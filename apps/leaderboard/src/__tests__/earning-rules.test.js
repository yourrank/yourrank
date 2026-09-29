import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  handleGetEarningRules,
  handleSaveEarningRules,
  handleViewerCheckin,
} from "../handlers/earning-rules.js";
import { ROUTES } from "../routes.js";

const USER = { id: "user-1", email: "creator@example.com" };
const SITE = { id: "site-1", slug: "community" };
const RULE = { id: "rule-1", amount: 25 };

function request(method, path, body) {
  return new Request(`https://example.test${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function setup() {
  const one = mock().mockResolvedValue(null);
  const txOne = mock();
  const txUnsafe = mock().mockResolvedValue({});
  const logAudit = mock().mockResolvedValue(undefined);
  const markActive = mock().mockResolvedValue(undefined);
  const deps = {
    requireUser: mock().mockResolvedValue({ user: USER, res: null }),
    getByUser: mock().mockResolvedValue(SITE),
    getBoardById: mock().mockResolvedValue(SITE),
    requireSiteCapability: mock().mockResolvedValue({ role: "owner", res: null }),
    one,
    rateLimit: mock().mockResolvedValue({ ok: true }),
    logAudit,
    requireViewer: mock().mockResolvedValue({ viewer: { id: "viewer-1" }, res: null }),
    resolveJoinableCommunity: mock().mockResolvedValue(SITE),
    withTransaction: mock(async (fn) => fn({ one: txOne, unsafe: txUnsafe })),
    markActive,
    now: () => new Date("2026-10-07T13:24:00.000Z"),
  };
  return { deps, one, txOne, txUnsafe, logAudit, markActive };
}

describe("daily check-in earning rules", () => {
  let env;

  beforeEach(() => {
    env = { DB: {} };
  });

  it("registers creator and viewer routes", () => {
    expect(ROUTES.some((route) => route.path === "/api/credits/earning-rules" && route.method === "GET")).toBe(true);
    expect(ROUTES.some((route) => route.path === "/api/credits/earning-rules" && route.method === "PUT")).toBe(true);
    expect(ROUTES.some((route) => route.path === "/api/viewer/checkin" && route.method === "POST")).toBe(true);
  });

  it("returns null when no daily check-in rule exists", async () => {
    const { deps } = setup();
    const response = await handleGetEarningRules(request("GET", "/api/credits/earning-rules?siteId=site-1"), env, deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, dailyCheckin: null });
  });

  it("returns the configured daily check-in rule", async () => {
    const { deps, one } = setup();
    one.mockResolvedValueOnce({ active: false, amount: 40 });
    const response = await handleGetEarningRules(request("GET", "/api/credits/earning-rules?siteId=site-1"), env, deps);

    expect(await response.json()).toEqual({ ok: true, dailyCheckin: { active: false, amount: 40 } });
  });

  it.each([0, 1001, 2.5, "10"])("rejects invalid amount %p without writing", async (amount) => {
    const { deps, one } = setup();
    const response = await handleSaveEarningRules(
      request("PUT", "/api/credits/earning-rules?siteId=site-1", { dailyCheckin: { active: true, amount } }),
      env,
      deps,
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Check-in credits must be a whole number from 1 to 1,000.");
    expect(one).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean active flag without writing", async () => {
    const { deps, one } = setup();
    const response = await handleSaveEarningRules(
      request("PUT", "/api/credits/earning-rules?siteId=site-1", { dailyCheckin: { active: "true", amount: 10 } }),
      env,
      deps,
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Check-in active must be a boolean.");
    expect(one).not.toHaveBeenCalled();
  });

  it("upserts valid settings and writes an audit record", async () => {
    const { deps, one, logAudit } = setup();
    one.mockResolvedValueOnce({ active: true, amount: 75 });
    const response = await handleSaveEarningRules(
      request("PUT", "/api/credits/earning-rules?siteId=site-1", { dailyCheckin: { active: true, amount: 75 } }),
      env,
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, dailyCheckin: { active: true, amount: 75 } });
    expect(one.mock.calls[0][0]).toContain("ON CONFLICT (site_id, rule_type)");
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "earning_rule_updated",
      details: {
        board_id: "site-1",
        board_slug: "community",
        rule_type: "daily_checkin",
        active: true,
        amount: 75,
      },
    }));
  });

  it("returns the capability denial response", async () => {
    const { deps } = setup();
    const denied = new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    deps.requireSiteCapability.mockResolvedValueOnce({ role: null, res: denied });
    const response = await handleGetEarningRules(request("GET", "/api/credits/earning-rules"), env, deps);

    expect(response).toBe(denied);
  });

  it("awards a successful check-in and records an earn ledger entry", async () => {
    const { deps, one, txOne, txUnsafe, markActive } = setup();
    one.mockResolvedValueOnce(RULE);
    txOne
      .mockResolvedValueOnce({ id: "membership-1", balance: 5, blocked: false })
      .mockResolvedValueOnce({ id: "claim-1" })
      .mockResolvedValueOnce({ id: "membership-1", balance: 30 });
    const response = await handleViewerCheckin(
      request("POST", "/api/viewer/checkin", { site: "community" }),
      env,
      deps,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      pointsAwarded: 25,
      newBalance: 30,
      nextAvailableAt: "2026-10-08T00:00:00.000Z",
    });
    expect(txUnsafe.mock.calls[0][0]).toContain("VALUES ($1, 'earn', $2, 'Daily check-in', $3)");
    expect(txUnsafe.mock.calls[0][1][2]).toEqual({ earning_rule_id: "rule-1", period: "2026-10-07" });
    expect(markActive).toHaveBeenCalledWith("site-1", "viewer-1", expect.any(Object));
  });

  it("returns 409 for a duplicate claim without changing balance", async () => {
    const { deps, one, txOne, txUnsafe, markActive } = setup();
    one.mockResolvedValueOnce(RULE);
    txOne
      .mockResolvedValueOnce({ id: "membership-1", balance: 5, blocked: false })
      .mockResolvedValueOnce(null);
    const response = await handleViewerCheckin(
      request("POST", "/api/viewer/checkin", { site: "community" }),
      env,
      deps,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "already_checked_in",
      nextAvailableAt: "2026-10-08T00:00:00.000Z",
    });
    expect(txUnsafe).not.toHaveBeenCalled();
    expect(markActive).not.toHaveBeenCalled();
  });

  it("returns 404 when no active rule exists", async () => {
    const { deps, one } = setup();
    one.mockResolvedValueOnce(null);
    const response = await handleViewerCheckin(
      request("POST", "/api/viewer/checkin", { site: "community" }),
      env,
      deps,
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Daily check-in isn't available in this community.");
  });

  it("returns 403 for blocked memberships", async () => {
    const { deps, one, txOne } = setup();
    one.mockResolvedValueOnce(RULE);
    txOne.mockResolvedValueOnce({ id: "membership-1", balance: 5, blocked: true });
    const response = await handleViewerCheckin(
      request("POST", "/api/viewer/checkin", { site: "community" }),
      env,
      deps,
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("Check-in is unavailable for this membership.");
  });

  it("returns the viewer authorization response", async () => {
    const { deps, one } = setup();
    const denied = new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    deps.requireViewer.mockResolvedValueOnce({ viewer: null, res: denied });
    const response = await handleViewerCheckin(
      request("POST", "/api/viewer/checkin", { site: "community" }),
      env,
      deps,
    );

    expect(response).toBe(denied);
    expect(one).not.toHaveBeenCalled();
  });

  it("rate limits viewer check-in attempts", async () => {
    const { deps, one } = setup();
    deps.rateLimit.mockResolvedValueOnce({ ok: false });
    const response = await handleViewerCheckin(
      request("POST", "/api/viewer/checkin", { site: "community" }),
      env,
      deps,
    );

    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe("Too many attempts. Please wait a minute.");
    expect(one).not.toHaveBeenCalled();
  });

  it("records abuse signals on a successful check-in, never on failure paths", async () => {
    // Success: recorder runs once after the commit with the checkin action.
    let { deps, one, txOne } = setup();
    deps.recordSignals = mock().mockResolvedValue(undefined);
    one.mockResolvedValueOnce(RULE);
    txOne
      .mockResolvedValueOnce({ id: "membership-1", balance: 5, blocked: false })
      .mockResolvedValueOnce({ id: "claim-1" })
      .mockResolvedValueOnce({ id: "membership-1", balance: 30 });
    const ok = await handleViewerCheckin(request("POST", "/api/viewer/checkin", { site: "community" }), env, deps);
    expect(ok.status).toBe(200);
    expect(deps.recordSignals).toHaveBeenCalledTimes(1);
    expect(deps.recordSignals.mock.calls[0][0]).toMatchObject({ action: "checkin", siteId: "site-1", viewerId: "viewer-1" });
    // Already checked in (a failure path): no recording.
    ({ deps, one, txOne } = setup());
    deps.recordSignals = mock().mockResolvedValue(undefined);
    one.mockResolvedValueOnce(RULE);
    txOne
      .mockResolvedValueOnce({ id: "membership-1", balance: 5, blocked: false })
      .mockResolvedValueOnce(null);
    const dup = await handleViewerCheckin(request("POST", "/api/viewer/checkin", { site: "community" }), env, deps);
    expect(dup.status).toBe(409);
    expect(deps.recordSignals).not.toHaveBeenCalled();
    // A rejecting recorder still leaves the success response intact.
    ({ deps, one, txOne } = setup());
    deps.recordSignals = mock().mockRejectedValue(new Error("recorder blew up"));
    one.mockResolvedValueOnce(RULE);
    txOne
      .mockResolvedValueOnce({ id: "membership-1", balance: 5, blocked: false })
      .mockResolvedValueOnce({ id: "claim-1" })
      .mockResolvedValueOnce({ id: "membership-1", balance: 30 });
    const origError = console.error;
    console.error = () => {};
    try {
      const res = await handleViewerCheckin(request("POST", "/api/viewer/checkin", { site: "community" }), env, deps);
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    } finally { console.error = origError; }
  });
});
