import { describe, expect, it } from "bun:test";
import { buildHonoApp } from "../hono-app.js";

async function sign(key: string, payload: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("legacy bot postback sunset", () => {
  it("returns 410 with deprecation headers when unsigned intake is disabled", async () => {
    const response = await buildHonoApp().request(
      "https://bot.yourrank.site/pb/legacy",
      { method: "POST" },
      {
        POSTBACK_UNSIGNED_ENABLED: "false",
        RL_FAIL_OPEN: "true",
      }
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("deprecation")).toBe("true");
    expect(response.headers.get("sunset")).toBe("2026-10-01");
    expect(response.headers.get("link")).toContain("successor-version");
  });
});

describe("postback conversion durability", () => {
  function failingApp() {
    const claimed = new Set<string>();
    return {
      claimed,
      app: buildHonoApp({
        postbackDeps: {
          findPostbackOwner: async () => ({ id: "key-1", userId: "user-1" }),
          computeReplayHash: async () => "replay-1",
          recordReplayHash: async (_userId, replayHash) => {
            if (claimed.has(replayHash)) return false;
            claimed.add(replayHash);
            return true;
          },
          releaseReplayHash: async (_userId, replayHash) => claimed.delete(replayHash),
          createQueueProducer: () => ({
            send: async () => { throw new Error("queue unavailable"); },
            sendBatch: async () => [],
          }),
        },
      }),
    };
  }

  it("returns 503 and releases the claim when signed conversion delivery fails", async () => {
    const { app } = failingApp();
    const signature = await sign("postback-key", "event=deposit&amount=50&click_ref=click-1");
    const request = () => app.request(
      "https://bot.example/pb?event=deposit&amount=50&click_ref=click-1",
      {
        method: "POST",
        headers: {
          "x-postback-key": "postback-key",
          "x-postback-signature": signature,
        },
      },
      { RL_FAIL_OPEN: "true" },
    );
    const first = await request();
    const second = await request();

    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(second.status).not.toBe(409);
  });

  it("returns 503 and releases the claim when legacy conversion delivery fails", async () => {
    const { app } = failingApp();
    const request = () => app.request(
      "https://bot.example/pb/postback-key?event=deposit&amount=50&click_ref=click-1",
      { method: "POST" },
      { RL_FAIL_OPEN: "true" },
    );
    const first = await request();
    const second = await request();

    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(second.status).not.toBe(409);
  });
});
