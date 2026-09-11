import { describe, it, expect, mock } from "bun:test";
import {
  handleOverlayPredictionPage,
  handleOverlayAlertsPage,
  handleGetActiveEvents,
} from "../handlers/overlays.js";

function mockEnv() {
  return { DB: {} };
}

const SITE = { id: "site-456", user_id: "user-123", slug: "streamer", name: "Streamer Hub" };

describe("OBS Live Overlays Suite", () => {
  it("renders transparent Prediction HUD overlay page with site slug", async () => {
    const deps = {
      one: mock().mockResolvedValueOnce(SITE),
      rateLimit: mock().mockResolvedValue({ ok: true }),
      clientIp: mock().mockReturnValue("127.0.0.1"),
    };

    const req = new Request("http://localhost/overlay/prediction?site=streamer");
    const res = await handleOverlayPredictionPage(req, mockEnv(), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Live Prediction HUD");
    expect(html).toContain("hud-card");
    expect(html).toContain("streamer");
  });

  it("renders transparent Alerts overlay page with sound synthesizer", async () => {
    const deps = {
      one: mock().mockResolvedValueOnce(SITE),
      rateLimit: mock().mockResolvedValue({ ok: true }),
      clientIp: mock().mockReturnValue("127.0.0.1"),
    };

    const req = new Request("http://localhost/overlay/alerts?site=streamer");
    const res = await handleOverlayAlertsPage(req, mockEnv(), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Stream Alerts &amp; Sounds");
    expect(html).toContain("playAlertSound");
    expect(html).toContain("alert-container");
  });

  it("returns active prediction and latest alert data for overlay polling", async () => {
    const deps = {
      one: mock()
        .mockResolvedValueOnce(SITE) // find site
        .mockResolvedValueOnce({ id: "pred-1", title: "Win game?", status: "open", total_pool: 200 }) // active pred
        .mockResolvedValueOnce({ id: "red-1", kick_username: "alice", item_name: "VIP Badge", created_at: new Date().toISOString() }), // latest redemption
      query: mock(),
      rateLimit: mock().mockResolvedValue({ ok: true }),
      clientIp: mock().mockReturnValue("127.0.0.1"),
    };

    const req = new Request("http://localhost/api/overlays/active-events?site=streamer");
    const res = await handleGetActiveEvents(req, mockEnv(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.activePrediction.title).toBe("Win game?");
    expect(body.latestAlert.username).toBe("alice");
    expect(body.latestAlert.description).toBe("VIP Badge");
    const redemptionSql = deps.one.mock.calls[2][0];
    expect(redemptionSql).toContain("WHERE sv.site_id=$1");
    expect(redemptionSql).not.toContain("r.site_id");
    expect(redemptionSql).not.toContain("v.username");
    expect(redemptionSql).not.toContain("s.title");
  });

  it("rejects rate-limited overlay requests before running site queries", async () => {
    for (const handler of [
      handleOverlayPredictionPage,
      handleOverlayAlertsPage,
      handleGetActiveEvents,
    ]) {
      const one = mock();
      const rateLimit = mock().mockResolvedValue({ ok: false });
      const res = await handler(
        new Request("http://localhost/overlay?site=streamer"),
        mockEnv(),
        { one, rateLimit, clientIp: () => "127.0.0.1" }
      );

      expect(res.status).toBe(429);
      expect(one).not.toHaveBeenCalled();
    }
  });
});
