import { describe, expect, it, mock } from "bun:test";
import { handleLog } from "../handlers/log.js";
import { attachRouteContext } from "../middleware/handler.js";

function post(body, headers = {}) {
  return new Request("http://localhost/api/log", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function callLog(request, { log = mock(() => {}), rateLimit = async () => ({ ok: true }) } = {}) {
  return handleLog(
    attachRouteContext(request, null, { log: { error: log, warn: log, info: log } }),
    {},
    { rateLimit, clientIp: () => "test-ip" },
  );
}

describe("handleLog", () => {
  it("rejects oversized bodies without logging", async () => {
    const log = mock(() => {});
    const response = await callLog(post("x".repeat(16 * 1024 + 1)), { log });
    expect(response.status).toBe(413);
    expect(log).not.toHaveBeenCalled();
  });

  it("truncates each client field before logging", async () => {
    const log = mock(() => {});
    const response = await callLog(post({
      message: "m".repeat(1200),
      stack: "s".repeat(4200),
      context: "c".repeat(100),
      req_id: "r".repeat(200),
      extra: { url: "u".repeat(600) },
    }), { log });
    expect(response.status).toBe(200);
    const payload = log.mock.calls[0][1];
    expect(payload.message).toHaveLength(1000);
    expect(payload.stack).toHaveLength(4000);
    expect(payload.client_context).toHaveLength(64);
    expect(payload.client_req_id).toHaveLength(128);
    expect(payload.url).toHaveLength(500);
    expect(payload.user_agent).toBeUndefined();
  });

  it("limits extra to 20 string values of 256 characters", async () => {
    const log = mock(() => {});
    const extra = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`key${i}`, { nested: "x".repeat(300) }]));
    const response = await callLog(post({ message: "boom", extra }), { log });
    expect(response.status).toBe(200);
    const payload = log.mock.calls[0][1];
    const extraKeys = Object.keys(payload).filter((key) => key.startsWith("key"));
    expect(extraKeys).toHaveLength(20);
    expect(payload.key0).toBe("[object Object]");
    expect(payload.key0).toHaveLength(15);
  });

  it("preserves the rate-limit response", async () => {
    const log = mock(() => {});
    const response = await callLog(post({ message: "boom" }), {
      log,
      rateLimit: async () => ({ ok: false }),
    });
    expect(response.status).toBe(429);
    expect(log).not.toHaveBeenCalled();
  });
});
