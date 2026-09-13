import { describe, it, expect } from "bun:test";
import { HTML, SECURE_HTML, KICK_CHAT_WS_ORIGINS } from "../middleware/headers.js";

describe("CSP header sets", () => {
  it("declares the Kick chat WebSocket origins in the dashboard set", () => {
    const csp = SECURE_HTML["Content-Security-Policy"];
    expect(csp).toContain("https://ws-us2.pusher.com");
    expect(csp).toContain("wss://ws-us2.pusher.com");
  });

  it("does not send a redundant X-Frame-Options alongside frame-ancestors", () => {
    expect(SECURE_HTML).not.toHaveProperty("X-Frame-Options");
    expect(SECURE_HTML["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
  });

  it("keeps the public set permissive for iframe embedding", () => {
    const csp = HTML["Content-Security-Policy"];
    expect(csp).toContain("frame-ancestors *");
    expect(HTML).not.toHaveProperty("X-Frame-Options");
  });

  it("does not leak the Pusher origin into the public page CSP", () => {
    const csp = HTML["Content-Security-Policy"];
    expect(csp).not.toContain("pusher.com");
  });

  it("keeps the shared origin constant stable", () => {
    expect(KICK_CHAT_WS_ORIGINS).toBe("https://ws-us2.pusher.com wss://ws-us2.pusher.com");
  });
});
