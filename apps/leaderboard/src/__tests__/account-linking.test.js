import { describe, expect, it } from "bun:test";
import { scoreAccountLink, runAccountLinkDetection, LIKELY_LINKED_THRESHOLD } from "../account-link-detection.js";
import { handleLinkedAccounts, handleLinkedAccountsDecision } from "../handlers/linked-accounts.js";

describe("scoreAccountLink", () => {
  it("adds +50 for a shared device", () => {
    expect(scoreAccountLink({ sameDevice: true })).toEqual({ confidence: 50, reasons: ["same_device"] });
  });
  it("device + IP reaches the 60 threshold", () => {
    const { confidence, reasons } = scoreAccountLink({ sameDevice: true, sameIp: true });
    expect(confidence).toBe(70);
    expect(reasons).toEqual(["same_device", "same_ip_24h"]);
  });
  it("identity + IP is exactly 60 (the boundary)", () => {
    expect(scoreAccountLink({ sameIdentity: true, sameIp: true }).confidence).toBe(LIKELY_LINKED_THRESHOLD);
  });
  it("caps same-time claims at +30 and total at 100", () => {
    const claims = scoreAccountLink({ sameTimeClaims: 5 });
    expect(claims.confidence).toBe(30);
    const all = scoreAccountLink({ sameDevice: true, sameIdentity: true, sameIp: true, sameTimeClaims: 9 });
    expect(all.confidence).toBe(100);
    expect(all.reasons).toEqual(["same_device", "same_identity", "same_ip_24h", "same_time_claims"]);
  });
});

describe("runAccountLinkDetection", () => {
  const SITE = "site-1";
  const VA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const VB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  function stubRun({ pairs = [], upsertResult = [{ id: "link-1", inserted: true }] } = {}) {
    const calls = [];
    const run = async (sql, params = []) => {
      calls.push({ sql: String(sql), params });
      const text = String(sql);
      if (text.includes("FROM device_links\nUNION")) return [{ site_id: SITE }];
      if (text.includes("FROM pairs p")) return pairs;
      if (text.includes("INSERT INTO account_links")) return upsertResult;
      if (text.includes("INSERT INTO audit_log")) return [{ created_at: "x" }];
      return [];
    };
    return { run, calls };
  }

  it("inserts a ≥60 pair and writes the detection audit row", async () => {
    const { run, calls } = stubRun({ pairs: [{ viewer_a: VA, viewer_b: VB, same_device: true, same_identity: true, same_ip: false, same_time_claims: 0 }] });
    await runAccountLinkDetection({ run });
    const upsert = calls.find((c) => c.sql.includes("INSERT INTO account_links"));
    expect(upsert.params[0]).toBe(SITE);
    expect(upsert.params[3]).toBe(90);
    const audit = calls.find((c) => c.sql.includes("INSERT INTO audit_log"));
    expect(audit.sql).toContain("account_link_detected");
    expect(audit.params[0]).toBe("link-1");
  });

  it("skips pairs below the threshold (counted, not persisted)", async () => {
    const logs = [];
    const info = console.log;
    console.log = (m) => logs.push(m);
    try {
      const { run, calls } = stubRun({ pairs: [{ viewer_a: VA, viewer_b: VB, same_device: true, same_identity: false, same_ip: false, same_time_claims: 0 }] });
      await runAccountLinkDetection({ run });
      expect(calls.some((c) => c.sql.includes("INSERT INTO account_links"))).toBe(false);
      const log = JSON.parse(logs[0]);
      expect(log.belowThreshold).toBe(1);
      expect(log.likely).toBe(0);
    } finally {
      console.log = info;
    }
  });

  it("normalises viewer_a < viewer_b in the upsert params", async () => {
    const { run, calls } = stubRun({ pairs: [{ viewer_a: VB, viewer_b: VA, same_device: true, same_identity: true, same_ip: false, same_time_claims: 0 }] });
    await runAccountLinkDetection({ run });
    const upsert = calls.find((c) => c.sql.includes("INSERT INTO account_links"));
    expect(upsert.params[1]).toBe(VA);
    expect(upsert.params[2]).toBe(VB);
  });

  it("treats a no-return upsert as dismissed (no audit write)", async () => {
    const { run, calls } = stubRun({
      pairs: [{ viewer_a: VA, viewer_b: VB, same_device: true, same_identity: true, same_ip: true, same_time_claims: 0 }],
      upsertResult: [],
    });
    await runAccountLinkDetection({ run });
    expect(calls.some((c) => c.sql.includes("INSERT INTO audit_log"))).toBe(false);
  });

  it("continues past a failing site", async () => {
    const calls = [];
    let firstSiteDone = false;
    const errors = [];
    const error = console.error;
    console.error = (m) => errors.push(m);
    try {
      const run = async (sql) => {
        calls.push(String(sql));
        const text = String(sql);
        if (text.includes("FROM device_links\nUNION")) return [{ site_id: "site-a" }, { site_id: "site-b" }];
        if (text.includes("FROM pairs p")) {
          if (!firstSiteDone) { firstSiteDone = true; throw new Error("boom"); }
          return [];
        }
        return [];
      };
      await runAccountLinkDetection({ run });
      expect(JSON.parse(errors[0]).event).toBe("account_link_detection_failed");
      expect(calls.filter((s) => s.includes("FROM pairs p")).length).toBe(2);
    } finally {
      console.error = error;
    }
  });
});

describe("linked accounts handlers", () => {
  const USER = { id: "creator-1" };
  const SITE = { id: "site-1", user_id: "creator-1", name: "Site One", slug: "one" };
  const VA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const VB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const VC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  const linkRow = (overrides = {}) => ({
    id: overrides.id || crypto.randomUUID(),
    viewer_a: VA, viewer_b: VB,
    confidence: 85, reasons: ["same_device", "same_ip_24h"], same_time_claims: 0,
    status: "pending", created_at: "2026-10-01T00:00:00Z", last_detected_at: "2026-10-01T01:00:00Z",
    a_identities: [{ provider: "kick", externalUserId: "k1", username: "alice", avatarUrl: null, linkedAt: "2026-01-01" }],
    b_identities: [{ provider: "kick", externalUserId: "k2", username: "bob", avatarUrl: null, linkedAt: "2026-01-01" }],
    ...overrides,
  });

  function deps(overrides = {}) {
    const calls = { query: [], unsafe: [], txQuery: [] };
    const depsObj = {
      requireUser: async () => ({ user: USER, res: null }),
      getByUser: async () => SITE,
      getBoardById: async () => SITE,
      requireSiteCapability: async () => ({ role: "owner", res: null }),
      rateLimit: async () => ({ ok: true }),
      query: async (sql) => {
        calls.query.push(String(sql));
        return overrides.rows ?? [linkRow()];
      },
      one: async () => ({ pending: 1, watching: 0, restricted: 0, dismissed: 0 }),
      withTransaction: async (fn) => fn({
        query: async (sql, params) => {
          calls.txQuery.push({ sql: String(sql), params });
          if (String(sql).includes("FOR UPDATE")) return overrides.locked ?? [linkRow()];
          return [];
        },
        unsafe: async (sql, params) => { calls.unsafe.push({ sql: String(sql), params }); return []; },
        one: async () => null,
      }),
    };
    return { calls, deps: depsObj };
  }

  const req = (path, init) => new Request(`https://yourrank.site${path}`, init);

  it("GET groups connected pairs into one component", async () => {
    const rows = [linkRow({ viewer_a: VA, viewer_b: VB }), linkRow({ viewer_a: VB, viewer_b: VC, id: crypto.randomUUID() })];
    const { deps: d } = deps({ rows });
    const res = await handleLinkedAccounts(req("/api/people/linked-accounts?siteId=site-1"), {}, d);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].accounts.map((a) => a.viewerId).sort()).toEqual([VA, VB, VC].sort());
    expect(body.groups[0].linkIds).toHaveLength(2);
  });

  it("GET returns display names, no ids/hashes for viewers without identities", async () => {
    const rows = [linkRow({ a_identities: null, b_identities: null })];
    const { deps: d } = deps({ rows });
    const res = await handleLinkedAccounts(req("/api/people/linked-accounts"), {}, d);
    const body = await res.json();
    expect(body.groups[0].accounts[0].displayName).toBe(`Viewer ${VA.slice(0, 8)}`);
    const text = JSON.stringify(body);
    expect(text).not.toContain("device_hash");
    expect(text).not.toContain("ip_hash");
  });

  it("POST decision 404s when a link id doesn't exist", async () => {
    const { deps: d } = deps({ locked: [] });
    const res = await handleLinkedAccountsDecision(
      req("/api/people/linked-accounts/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ linkIds: [VA, VB], action: "restrict" }),
      }), {}, d);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Linked accounts not found.");
  });

  it("POST decision writes one audit row per link and maps unrestrict→watching", async () => {
    const rows = [linkRow({ id: VA, status: "restricted" }), linkRow({ id: VB, status: "restricted" })];
    const { calls, deps: d } = deps({ locked: rows, rows });
    const res = await handleLinkedAccountsDecision(
      req("/api/people/linked-accounts/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ linkIds: [VA, VB], action: "unrestrict" }),
      }), {}, d);
    expect(res.status).toBe(200);
    const updates = calls.txQuery.filter((c) => c.sql.includes("UPDATE account_links"));
    expect(updates).toHaveLength(2);
    expect(updates[0].params[0]).toBe("watching");
    const audits = calls.unsafe.filter((c) => c.sql.includes("audit_log"));
    expect(audits).toHaveLength(2);
    expect(audits[0].params[1]).toBe("account_link_unrestricted");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.groups)).toBe(true);
  });

  it("POST rejects an invalid action", async () => {
    const { deps: d } = deps();
    const res = await handleLinkedAccountsDecision(
      req("/api/people/linked-accounts/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ linkIds: [VA], action: "ban" }),
      }), {}, d);
    expect(res.status).toBe(400);
  });
});
