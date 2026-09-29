// Anti-abuse signal collection: HMAC hashing, IP/device recording, and the
// never-fail guarantee. No module mocks — the db executor is injected as `run`.
import { describe, expect, it } from "bun:test";
import { abuseSignalHash, clientNetworkKey, normalizeClientIp, recordAbuseSignals } from "../abuse-signals.js";

const env = { ABUSE_SIGNAL_HMAC_KEY: "test-hmac-key" };
const VIEWER = "b3f1c2d4-0000-4000-8000-000000000001";
const SITE = "b3f1c2d4-0000-4000-8000-000000000002";
const request = (headers = {}) => new Request("https://site.test/api/x", { headers });

const quiet = () => {
  const errors = [];
  const warns = [];
  const origError = console.error;
  const origWarn = console.warn;
  console.error = (...a) => errors.push(a.join(" "));
  console.warn = (...a) => warns.push(a.join(" "));
  return { errors, warns, restore: () => { console.error = origError; console.warn = origWarn; } };
};

describe("normalizeClientIp", () => {
  it("canonicalizes equivalent IPv6 spellings and rejects non-IPs", () => {
    expect(normalizeClientIp("2001:DB8::1")).toBe(normalizeClientIp("2001:0db8:0:0:0:0:0:1"));
    expect(normalizeClientIp("192.0.2.9")).toBe("192.0.2.9");
    expect(normalizeClientIp("not-an-ip")).toBeNull();
    expect(normalizeClientIp(null)).toBeNull();
  });
});

describe("clientNetworkKey", () => {
  it("returns IPv4 unchanged, collapses IPv6 to its /64, and rejects non-IPs", () => {
    expect(clientNetworkKey("192.0.2.9")).toBe("192.0.2.9");
    // Two devices on the same connection share the /64, not the address.
    expect(clientNetworkKey("2001:db8:abcd:12:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:abcd:12::/64");
    expect(clientNetworkKey("2001:db8:abcd:12:1111:2222:3333:4444")).toBe(clientNetworkKey("2001:db8:abcd:12:aaaa:bbbb:cccc:dddd"));
    expect(clientNetworkKey("2001:db8:abcd:99:aaaa:bbbb:cccc:dddd")).not.toBe(clientNetworkKey("2001:db8:abcd:12:aaaa:bbbb:cccc:dddd"));
    // Compressed :: forms and uppercase/leading-zero spellings normalize.
    expect(clientNetworkKey("2001:0DB8::1")).toBe("2001:db8:0:0::/64");
    expect(clientNetworkKey("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(clientNetworkKey("2001:0DB8::1"));
    expect(clientNetworkKey("2001:db8:abcd:12::dddd")).toBe("2001:db8:abcd:12::/64");
    // IPv4-mapped IPv6 in either spelling collapses to the dotted IPv4.
    expect(clientNetworkKey("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(clientNetworkKey("::ffff:102:304")).toBe("1.2.3.4");
    expect(clientNetworkKey("not-an-ip")).toBeNull();
    expect(clientNetworkKey("")).toBeNull();
    expect(clientNetworkKey(null)).toBeNull();
  });
});

describe("abuseSignalHash", () => {
  it("hashes equivalent IPs identically and keys the output", async () => {
    expect(await abuseSignalHash("2001:db8::1", env)).not.toBe(await abuseSignalHash("2001:db8::2", env));
    expect(await abuseSignalHash("192.0.2.9", env)).not.toBe(await abuseSignalHash("192.0.2.9", { ABUSE_SIGNAL_HMAC_KEY: "other" }));
    expect(await abuseSignalHash("192.0.2.9", env)).toMatch(/^[a-f0-9]{64}$/);
    expect(await abuseSignalHash(null, env)).toBeNull();
    expect(await abuseSignalHash("192.0.2.9", {})).toBeNull();
  });
});

describe("recordAbuseSignals", () => {
  it("records IP and device signals as server-side HMACs", async () => {
    const statements = [];
    const run = async (sql, params) => { statements.push({ sql, params }); return []; };
    const device = "a".repeat(64);
    await recordAbuseSignals({
      run, env, viewerId: VIEWER, siteId: SITE, action: "drop_claim",
      request: request({ "cf-connecting-ip": "192.0.2.9", "x-yr-device": device }),
    });
    const ip = statements.find((s) => s.sql.includes("ip_observations"));
    const link = statements.find((s) => s.sql.includes("device_links"));
    expect(ip.params).toEqual([await abuseSignalHash("192.0.2.9", env), VIEWER, SITE, "drop_claim"]);
    expect(ip.sql).not.toContain("192.0.2.9");
    expect(link.params[0]).toBe(await abuseSignalHash(device, env));
    expect(link.params[0]).not.toBe(device);
    expect(link.sql).toContain("seen_count = device_links.seen_count + 1");
  });

  it("hashes two IPv6 devices on the same /64 to the same ip_hash", async () => {
    const statements = [];
    const run = async (sql, params) => { statements.push({ sql, params }); return []; };
    await recordAbuseSignals({
      run, env, viewerId: VIEWER, siteId: SITE, action: "drop_claim",
      request: request({ "cf-connecting-ip": "2001:db8:abcd:12:aaaa:bbbb:cccc:dddd" }),
    });
    await recordAbuseSignals({
      run, env, viewerId: VIEWER, siteId: SITE, action: "drop_claim",
      request: request({ "cf-connecting-ip": "2001:db8:abcd:12:9999:8888:7777:6666" }),
    });
    const hashes = statements.filter((s) => s.sql.includes("ip_observations")).map((s) => s.params[0]);
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[0]).toBe(await abuseSignalHash("2001:db8:abcd:12::/64", env));
  });

  it("logs an error and runs no queries when the key is missing", async () => {
    const spy = quiet();
    let ran = false;
    try {
      await recordAbuseSignals({ run: async () => { ran = true; }, env: {}, request: request({ "cf-connecting-ip": "192.0.2.9" }), viewerId: VIEWER, siteId: SITE, action: "checkin" });
    } finally { spy.restore(); }
    expect(ran).toBe(false);
    expect(spy.errors.join("\n")).toContain("ABUSE_SIGNAL_HMAC_KEY not configured");
  });

  it("warns on an invalid device hash but still records the IP", async () => {
    const spy = quiet();
    const statements = [];
    try {
      await recordAbuseSignals({
        run: async (sql, params) => { statements.push({ sql, params }); return []; },
        env, viewerId: VIEWER, siteId: SITE, action: "giveaway_verify",
        request: request({ "cf-connecting-ip": "192.0.2.9", "x-yr-device": "not-hex" }),
      });
    } finally { spy.restore(); }
    expect(spy.warns.join("\n")).toContain("invalid device hash");
    expect(statements.filter((s) => s.sql.includes("device_links"))).toHaveLength(0);
    expect(statements.filter((s) => s.sql.includes("ip_observations"))).toHaveLength(1);
  });

  it("warns on a missing/invalid IP, skips the IP row, and stays silent without a device header", async () => {
    const spy = quiet();
    const statements = [];
    try {
      await recordAbuseSignals({
        run: async (sql, params) => { statements.push({ sql, params }); return []; },
        env, viewerId: VIEWER, siteId: SITE, action: "checkin",
        request: request({ "cf-connecting-ip": "bogus" }),
      });
    } finally { spy.restore(); }
    expect(statements).toHaveLength(0);
    expect(spy.warns.filter((w) => w.includes("checkin")).length).toBe(1);
    expect(spy.warns.join("\n")).not.toContain("device");
  });

  it("logs the failure and resolves when the DB write throws", async () => {
    const spy = quiet();
    try {
      await recordAbuseSignals({
        run: async () => { throw new Error("connection reset"); },
        env, viewerId: VIEWER, siteId: SITE, action: "drop_claim",
        request: request({ "cf-connecting-ip": "192.0.2.9" }),
      });
    } finally { spy.restore(); }
    expect(spy.errors.join("\n")).toContain("[abuse-signals] record failed: drop_claim connection reset");
  });
});
