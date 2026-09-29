import { describe, expect, it, mock } from "bun:test";
import { giveawayIpHash, handleGiveawayVerification } from "../handlers/giveaway-verification.js";
import { drawGiveaway } from "../chat-giveaway-service.js";
const id = "11111111-1111-4111-8111-111111111111";
const viewer = { id: "viewer", identities: [{ provider: "kick", externalUserId: "42", username: "alice", linkedAt: "2026-01-01" }] };
const session = { id, site_id: "site", status: "active", keyword: "!win", community: "Test", rules: { entryMode: "verified", onePerIp: true }, verification_salt: "session-secret" };
const request = (post = true) => new Request(`https://yourrank.site/api/viewer/giveaway?sessionId=${id}`, {
  method: post ? "POST" : "GET", headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.1" },
  ...(post ? { body: JSON.stringify({ sessionId: id }) } : {}),
});
function setup({ actor = viewer, entry = { id: "entry", badges: [], eligibility_status: "pending_verification" }, duplicate = false, status = "active", owner = "viewer", sessionRules = null } = {}) {
  const writes = [];
  const sess = sessionRules ? { ...session, rules: { ...session.rules, ...sessionRules } } : session;
  return { writes, one: async () => sess, resolveViewer: async () => ({ viewer: actor }), rateLimit: async () => ({ ok: true }),
    transaction: (fn) => fn(async (sql, params) => {
      if (sql.startsWith("SELECT id, site_id")) return [{ ...sess, status }];
      if (sql.includes("SELECT id, badges")) return entry ? [entry] : [];
      if (sql.includes("AS viewer_id")) return [{ viewer_id: owner, previous_winner: false }];
      if (sql.includes("AND ip_hash")) return duplicate ? [{ id: "other" }] : [];
      if (sql.startsWith("UPDATE")) { writes.push(params); return []; }
      throw new Error(sql);
    }),
  };
}
describe("giveaway verification boundary", () => {
  it("keeps unregistered and unlinked viewers pending without writing", async () => {
    for (const [actor, reason] of [[null, "not_yourrank_member"], [{ id: "viewer", identities: [] }, "kick_not_linked"]]) {
      const d = setup({ actor });
      expect(await (await handleGiveawayVerification(request(), {}, d)).json()).toMatchObject({ reason, status: "pending_verification" });
      expect(d.writes).toHaveLength(0);
    }
  });
  it("verifies the linked account, hashes IP, and exposes no identifiers", async () => {
    const d = setup();
    const response = await handleGiveawayVerification(request(), {}, d);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ status: "eligible", kickUsername: "alice" });
    expect(JSON.stringify(body)).not.toMatch(/ip_hash|verification_salt|viewer_id/);
    expect(d.writes[0]).toEqual(["entry", "eligible", null, "viewer", await giveawayIpHash("192.0.2.1", "session-secret")]);
  });
  it("rejects duplicate IP, stale identity, closed giveaway, and absent chat entry", async () => {
    for (const [options, reason] of [[{ duplicate: true }, "duplicate_ip"], [{ owner: "other" }, "kick_not_linked"], [{ status: "completed" }, "giveaway_closed"], [{ entry: null }, "entry_required"]]) {
      expect(await (await handleGiveawayVerification(request(), {}, setup(options))).json()).toMatchObject({ reason });
    }
  });
  it("normalizes IPv6, scopes hashes by giveaway, and rejects missing addresses", async () => {
    expect(await giveawayIpHash("2001:db8::1", "a")).toBe(await giveawayIpHash("2001:0db8:0:0:0:0:0:1", "a"));
    expect(await giveawayIpHash("192.0.2.1", "a")).not.toBe(await giveawayIpHash("192.0.2.1", "b"));
    expect(await giveawayIpHash(null, "a")).toBeNull();
  });
  it("refuses custom-host and cross-origin requests", async () => {
    expect((await handleGiveawayVerification(new Request(`https://other.example/api/viewer/giveaway?sessionId=${id}`), {}, setup())).status).toBe(404);
    const req = request(); req.headers.set("origin", "https://other.example");
    expect((await handleGiveawayVerification(req, {}, setup())).status).toBe(403);
  });
  it("accepts the staging host only when ENVIRONMENT is staging", async () => {
    const stagingUrl = `https://staging.yourrank.site/api/viewer/giveaway?sessionId=${id}`;
    // staging host + staging env reaches past the host check (400 = bad id, not 404)
    const stagingEnv = { ENVIRONMENT: "staging" };
    expect((await handleGiveawayVerification(new Request(stagingUrl), stagingEnv, setup())).status).not.toBe(404);
    // same host with production env still 404s
    expect((await handleGiveawayVerification(new Request(stagingUrl), { ENVIRONMENT: "production" }, setup())).status).toBe(404);
    // production env + platform host unchanged: reaches past the host check
    expect((await handleGiveawayVerification(new Request(`https://yourrank.site/api/viewer/giveaway?sessionId=${id}`), { ENVIRONMENT: "production" }, setup())).status).not.toBe(404);
  });
  it("runs the VPN/proxy check outside the transaction and maps results to reasons", async () => {
    const calls = [];
    const checkIp = (impl) => async (ip) => { calls.push(ip); return impl(); };
    const rules = { vpnDetection: true };
    // Detected network -> stored as a rejection with reason vpn_detected.
    const detected = setup({ sessionRules: rules });
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...a) => warns.push(a.join(" "));
    let body;
    try {
      body = await (await handleGiveawayVerification(request(), {}, { ...detected, checkIp: checkIp(() => ({ ok: true, anonymous: true, types: ["vpn", "proxy"] })) })).json();
    } finally { console.warn = origWarn; }
    expect(body).toMatchObject({ status: "rejected", reason: "vpn_detected", vpnCheck: true });
    expect(detected.writes[0]).toMatchObject({ 0: "entry", 1: "rejected", 2: "vpn_detected" });
    expect(warns.join("\n")).toContain("vpn_detected");
    expect(warns.join("\n")).toContain("vpn,proxy");
    expect(warns.join("\n")).not.toContain("192.0.2.1");
    // Unavailable check -> vpn_check_unavailable, still recorded as a rejection.
    const down = setup({ sessionRules: rules });
    expect(await (await handleGiveawayVerification(request(), {}, { ...down, checkIp: checkIp(() => ({ ok: false, error: "proxycheck_timeout" })) })).json()).toMatchObject({ status: "rejected", reason: "vpn_check_unavailable" });
    // Clean network -> eligible.
    const clean = setup({ sessionRules: rules });
    expect(await (await handleGiveawayVerification(request(), {}, { ...clean, checkIp: checkIp(() => ({ ok: true, anonymous: false, types: [] })) })).json()).toMatchObject({ status: "eligible" });
    expect(calls).toHaveLength(3);
  });
  it("never calls the IP check on GET or when the rule is off", async () => {
    const calls = [];
    const checkIp = async () => { calls.push(1); return { ok: true, anonymous: false, types: [] };
    };
    // GET path returns before the check regardless of rules.
    expect(await (await handleGiveawayVerification(request(false), {}, { ...setup({ sessionRules: { vpnDetection: true } }), checkIp })).json()).toMatchObject({ vpnCheck: true });
    // POST without the rule skips the call entirely.
    expect(await (await handleGiveawayVerification(request(), {}, { ...setup(), checkIp })).json()).toMatchObject({ status: "eligible", vpnCheck: false });
    expect(calls).toHaveLength(0);
  });
  it("records abuse signals on every resolved POST outcome, never on early exits", async () => {
    const record = () => ({ recordSignals: mock().mockResolvedValue(undefined) });
    // Eligible and rejected outcomes both record — the attempt is the signal.
    let d = { ...setup(), ...record() };
    expect(await (await handleGiveawayVerification(request(), {}, d)).json()).toMatchObject({ status: "eligible" });
    expect(d.recordSignals).toHaveBeenCalledTimes(1);
    expect(d.recordSignals.mock.calls[0][0]).toMatchObject({ action: "giveaway_verify", siteId: "site", viewerId: "viewer" });
    d = { ...setup({ duplicate: true }), ...record() };
    expect(await (await handleGiveawayVerification(request(), {}, d)).json()).toMatchObject({ status: "rejected" });
    expect(d.recordSignals).toHaveBeenCalledTimes(1);
    // Early exits (GET, unlinked viewer) never reach the recorder.
    for (const [req, deps] of [[request(false), { ...setup(), ...record() }], [request(), { ...setup({ actor: null }), ...record() }]]) {
      await handleGiveawayVerification(req, {}, deps);
      expect(deps.recordSignals).not.toHaveBeenCalled();
    }
    // A rejecting recorder still leaves the normal success response.
    d = { ...setup(), recordSignals: mock().mockRejectedValue(new Error("recorder blew up")) };
    const origError = console.error;
    console.error = () => {};
    try {
      const res = await handleGiveawayVerification(request(), {}, d);
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe("eligible");
    } finally { console.error = origError; }
  });
  it("rejects a body giveaway ID that differs from the signed link ID", async () => {
    const mismatched = new Request(`https://yourrank.site/api/viewer/giveaway?sessionId=${id}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "22222222-2222-4222-8222-222222222222" }),
    });
    expect((await handleGiveawayVerification(mismatched, {}, setup())).status).toBe(400);
  });
});

describe("giveaway draw and timeout", () => {
  const eligible = { id: "e1", provider_user_id: "42", eligibility_status: "eligible", badges: [] };
  it("never draws pending, rejected, already drawn, or currently unlinked entries", async () => {
    const entries = [{ ...eligible, eligibility_status: "pending_verification" }, { ...eligible, eligibility_status: "rejected" }, { ...eligible, already_drawn: true }];
    const run = async () => entries;
    expect(await drawGiveaway(run, { ...session, rules: {} })).toHaveProperty("error");
    expect(await drawGiveaway(async () => [eligible], { ...session, rules: { entryMode: "members" } })).toHaveProperty("error");
  });
  it("excludes this giveaway's winners when winnerRepeat is once and reports no alternatives", async () => {
    const run = async () => [{ ...eligible, already_drawn: true }];
    expect(await drawGiveaway(run, { ...session, rules: {} })).toEqual({ error: "No other eligible entrants remain." });
    const writes = [];
    const mixed = async (sql, params) => {
      if (sql.startsWith("SELECT")) return [{ ...eligible, already_drawn: true }, { ...eligible, id: "e2", provider_user_id: "43" }];
      writes.push({ sql, params });
      return sql.includes("UPDATE chat_giveaway_sessions") ? [{ id }] : [];
    };
    expect(await drawGiveaway(mixed, { ...session, rules: {} })).toMatchObject({ winnerId: "e2" });
  });
  it("lets a previous winner of this giveaway be drawn again when winnerRepeat is again", async () => {
    const writes = [];
    const run = async (sql, params) => {
      if (sql.startsWith("SELECT")) return [{ ...eligible, already_drawn: true }];
      writes.push({ sql, params });
      return sql.includes("UPDATE chat_giveaway_sessions") ? [{ id }] : [];
    };
    expect(await drawGiveaway(run, { ...session, rules: { winnerRepeat: "again" } })).toMatchObject({ winnerId: "e1" });
    expect(writes[1].sql).toContain("chat_giveaway_draws");
  });
  it("records history and deadline for eligible draws", async () => {
    const writes = [];
    const run = async (sql, params) => {
      if (sql.startsWith("SELECT")) return [eligible];
      writes.push({ sql, params });
      return sql.includes("UPDATE chat_giveaway_sessions") ? [{ id }] : [];
    };
    expect(await drawGiveaway(run, { ...session, rules: { winnerMustRespond: true, responseTimeout: 30 } })).toMatchObject({ winnerId: "e1" });
    // The history row lands only after the CAS update commits the draw.
    expect(writes[0].sql).toContain("WITH stamp AS");
    expect(writes[0].params).toEqual([id, "e1", "site", true, 30]);
    expect(writes[1].sql).toContain("chat_giveaway_draws");
  });
  it("does not automatically reroll early, confirmed, disabled, or stale draws", async () => {
    for (const overrides of [{ winner_response_deadline: new Date(Date.now()+60000).toISOString() }, { winner_confirmed_at: new Date().toISOString() }, { rules: {} }]) {
      const current = { ...session, status: "completed", rules: { winnerMustRespond: true, autoReroll: true }, winner_response_deadline: "2020-01-01", ...overrides };
      expect(await drawGiveaway(() => { throw new Error("must not query"); }, current, { automatic: true })).toEqual({ unchanged: true });
    }
  });
});
