import { describe, it, expect, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { cooldownRemainingSeconds } from "../handlers/viewer-dashboard.js";
import { handleOverlayAlertsPage } from "../handlers/overlays.js";
import { formatWaitSeconds } from "@yourrank/shared/public-render-helpers";

// P4-3: reward cooldowns + configurable OBS sound alerts. Cooldowns are
// enforced server-side at redemption time and surfaced to members as a
// server-computed snapshot (cooldownRemaining) rendered by site-render.
// Alert sound presets/volume/quiet period ride in the overlay URL, validated
// server-side, with the dashboard composing the same URL.

const SITE = { id: "site-456", slug: "streamer", name: "Streamer Hub" };
const alertsDeps = () => ({
  one: mock().mockResolvedValueOnce(SITE),
  rateLimit: mock().mockResolvedValue({ ok: true }),
  clientIp: mock().mockReturnValue("127.0.0.1"),
});

describe("reward cooldown math", () => {
  it("returns 0 when no cooldown is configured or nothing was claimed", () => {
    expect(cooldownRemainingSeconds(null, 3600)).toBe(0);
    expect(cooldownRemainingSeconds(new Date().toISOString(), 0)).toBe(0);
    expect(cooldownRemainingSeconds(new Date().toISOString(), -5)).toBe(0);
    expect(cooldownRemainingSeconds("not-a-date", 3600)).toBe(0);
  });

  it("counts down a running cooldown and clamps at zero once it elapsed", () => {
    const now = Date.now();
    expect(cooldownRemainingSeconds(new Date(now - 600_000).toISOString(), 3600, now)).toBe(3000);
    expect(cooldownRemainingSeconds(new Date(now - 3_600_000).toISOString(), 3600, now)).toBe(0);
    expect(cooldownRemainingSeconds(new Date(now - 3_700_000).toISOString(), 3600, now)).toBe(0);
  });

  it("renders a human wait in words", () => {
    expect(formatWaitSeconds(45)).toBe("45s");
    expect(formatWaitSeconds(600)).toBe("10m");
    expect(formatWaitSeconds(7500)).toBe("2h 5m");
    expect(formatWaitSeconds(267_000)).toBe("3d 2h");
    expect(formatWaitSeconds(172_800)).toBe("2d");
    expect(formatWaitSeconds(Number.NaN)).toBe("0s");
  });
});

describe("alerts overlay sound configuration", () => {
  it("injects the chosen preset, volume, and quiet period into the page", async () => {
    const res = await handleOverlayAlertsPage(
      new Request("http://localhost/overlay/alerts?site=streamer&sound=fanfare&vol=60&gap=30"),
      { DB: {} },
      alertsDeps(),
    );
    const html = await res.text();
    expect(html).toContain('preset: "fanfare"');
    expect(html).toContain("volume: 60");
    expect(html).toContain("gapMs: 30000");
    expect(html).toContain("playAlertSound");
  });

  it("defaults to the chime at 30% with no quiet period", async () => {
    const res = await handleOverlayAlertsPage(
      new Request("http://localhost/overlay/alerts?site=streamer"),
      { DB: {} },
      alertsDeps(),
    );
    const html = await res.text();
    expect(html).toContain('preset: "chime"');
    expect(html).toContain("volume: 30");
    expect(html).toContain("gapMs: 0");
  });

  it("clamps hostile volume/gap values and rejects unknown presets", async () => {
    const res = await handleOverlayAlertsPage(
      new Request("http://localhost/overlay/alerts?site=streamer&sound=<script>&vol=9999&gap=-50"),
      { DB: {} },
      alertsDeps(),
    );
    const html = await res.text();
    expect(html).toContain('preset: "chime"');
    expect(html).toContain("volume: 100");
    expect(html).toContain("gapMs: 0");
    // The hostile preset must not survive into the injected config.
    expect(html).not.toContain('"<script>"');
    expect(html).not.toContain("preset: \"<script>\"");
  });
});

describe("cooldown surface wiring", () => {
  it("redeem flow checks the cooldown before charging the balance", () => {
    const src = readFileSync(new URL("../handlers/viewer-dashboard.js", import.meta.url), "utf8");
    const cooldownCheck = src.indexOf("cooldownRemainingSeconds(lastRow");
    const balanceUpdate = src.indexOf("SET balance = balance - $1");
    expect(cooldownCheck).toBeGreaterThan(-1);
    expect(balanceUpdate).toBeGreaterThan(cooldownCheck);
    // Cancelled claims are refunded, so they must never count toward a cooldown.
    expect(src).toContain("status != 'cancelled'");
  });

  it("the public shop snapshot carries per-item remaining seconds for members", () => {
    const src = readFileSync(new URL("../site-data.js", import.meta.url), "utf8");
    expect(src).toContain("cooldown_seconds");
    expect(src).toContain("cooldownRemaining");
  });

  it("the dashboard composes the alert URL from the sound controls", () => {
    const src = readFileSync(new URL("../assets/dashboard/site.js", import.meta.url), "utf8");
    expect(src).toContain("readAlertSoundConfig()");
    expect(src).toContain('new URLSearchParams({ site: slug, sound: cfg.sound, vol: String(cfg.vol), gap: String(cfg.gap) })');
    expect(src).toContain('$("ovAlertTest")');
    expect(src).toContain("playAlertPreset(cfg.sound, cfg.vol)");
  });

  it("the OBS tools card exposes sound, volume, and quiet-period controls", () => {
    const jsx = readFileSync(new URL("../pages/dashboard.jsx", import.meta.url), "utf8");
    for (const id of ['id="ovAlertSound"', 'id="ovAlertVol"', 'id="ovAlertGap"', 'id="ovAlertTest"']) {
      expect(jsx.includes(id), id).toBe(true);
    }
  });
});
