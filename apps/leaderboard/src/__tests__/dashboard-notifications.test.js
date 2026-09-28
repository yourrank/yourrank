import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { serializeWebhookUrl } from "../assets/dashboard/notifications.js";

const siteJs = readFileSync(new URL("../assets/dashboard/site.js", import.meta.url), "utf8");
const dashboardJsx = readFileSync(new URL("../pages/dashboard.jsx", import.meta.url), "utf8");

describe("webhook notification settings", () => {
  it("clears a configured webhook when the operator disables it", () => {
    expect(serializeWebhookUrl("", false)).toBe("");
  });

  it("preserves a configured webhook across unrelated board saves", () => {
    expect(serializeWebhookUrl("", true)).toBe(undefined);
  });

  it("stores a replacement URL when re-enabled", () => {
    expect(serializeWebhookUrl(" https://discord.com/api/webhooks/1/token ", false))
      .toBe("https://discord.com/api/webhooks/1/token");
  });

  it("disables every notifications control on the Free plan, not just the Discord body", () => {
    // The Telegram fields and Send test sit outside #notifyBody, so hiding the
    // Discord body alone left them live on Free — the click reached the API
    // and only then learned notifications are a paid feature.
    expect(siteJs).toContain('"testTelegram", "f_tgChatId", "f_tgNotify", "settingsWebhookEnabled"');
    expect(siteJs).toMatch(/el\.disabled = !paid/);
  });

  it("shows one lock notice covering both services above the Discord row", () => {
    expect(dashboardJsx).toContain("Notifications are available on Pro and Team.");
    const lockAt = dashboardJsx.indexOf('id="notifyLock"');
    const discordAt = dashboardJsx.indexOf("<b>Discord</b>");
    const telegramAt = dashboardJsx.indexOf("<b>Telegram</b>");
    expect(lockAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(discordAt);
    expect(discordAt).toBeLessThan(telegramAt);
  });
});
