import { describe, expect, it } from "bun:test";
import { checkAnonymousIp } from "../proxycheck.js";

const KEY = "test-key-123";
const env = { PROXYCHECK_API_KEY: KEY };
const IP = "203.0.113.9";
const resp = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const detections = (flags) => resp({ status: "ok", [IP]: { network: { type: "ISP" }, detections: { risk: 5, ...flags } } });

// Every ok:false path must also log — the sweep rules forbid silent failures.
async function withErrorSpy(fn) {
  const calls = [];
  const orig = console.error;
  console.error = (...a) => calls.push(a);
  try { return { result: await fn(), calls }; } finally { console.error = orig; }
}
const keyNeverLogged = (calls) => calls.every((args) => !args.join(" ").includes(KEY));

describe("checkAnonymousIp", () => {
  it("flags anonymous networks and lists the detection types", async () => {
    const cases = [
      [{ anonymous: true }, ["anonymous"]],
      [{ vpn: true }, ["vpn"]],
      [{ proxy: true, tor: true }, ["proxy", "tor"]],
      [{ hosting: true }, ["hosting"]],
      [{ vpn: true, hosting: true, anonymous: true }, ["anonymous", "vpn", "hosting"]],
    ];
    for (const [flags, types] of cases) {
      const result = await checkAnonymousIp(IP, env, async () => detections(flags));
      expect(result).toEqual({ ok: true, anonymous: true, types });
    }
  });
  it("passes clean networks", async () => {
    const result = await checkAnonymousIp(IP, env, async () => detections({ proxy: false, vpn: false, tor: false, hosting: false, anonymous: false }));
    expect(result).toEqual({ ok: true, anonymous: false, types: [] });
  });
  it("fails logged on non-2xx responses", async () => {
    const { result, calls } = await withErrorSpy(() => checkAnonymousIp(IP, env, async () => resp({}, 403)));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("403");
    expect(calls.length).toBe(1);
    expect(keyNeverLogged(calls)).toBe(true);
  });
  it("fails logged on non-ok API status, missing detections, and fetch errors", async () => {
    for (const impl of [
      async () => resp({ status: "denied", [IP]: { detections: {} } }),
      async () => resp({ status: "ok", [IP]: {} }),
      async () => resp({ status: "ok" }),
      async () => { throw new Error("socket hangup"); },
      async () => new Response("not json", { status: 200 }),
    ]) {
      const { result, calls } = await withErrorSpy(() => checkAnonymousIp(IP, env, impl));
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
      expect(calls.length).toBe(1);
      expect(keyNeverLogged(calls)).toBe(true);
    }
  });
  it("fails logged and fast when the key or the IP is missing, without calling fetch", async () => {
    let fetched = false;
    const spy = async () => { fetched = true; return detections({}); };
    for (const [e, ip] of [[{}, IP], [env, null], [env, ""]]) {
      const { result, calls } = await withErrorSpy(() => checkAnonymousIp(ip, e, spy));
      expect(result.ok).toBe(false);
      expect(calls.length).toBe(1);
    }
    expect(fetched).toBe(false);
  });
});
