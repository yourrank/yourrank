import { describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { runNotificationTest, serializeWebhookUrl } from "../assets/dashboard/notifications.js";

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

  it("keeps locked test buttons clickable and delegates their feedback", () => {
    expect(siteJs).toContain('for (const id of ["testDiscord", "testTelegram"])');
    expect(siteJs).toContain('el.setAttribute("aria-disabled", String(!paid))');
    expect(siteJs).toContain('el.classList.toggle("is-disabled", !paid)');
    expect(siteJs).toMatch(/for \(const id of \["f_tgChatId", "f_tgNotify", "settingsWebhookEnabled"\]\)/);
    expect(siteJs).toMatch(/document\.addEventListener\("click"/);
    expect(siteJs).toMatch(/e\.target\.closest\?\.\("#testTelegram, #testDiscord"\)/);
    expect(siteJs).toContain('if (typeof window !== "undefined" && !window.__yrNotifyTestWired)');
    expect(siteJs).toContain("window.__yrNotifyTestWired = true;");
    expect(siteJs).not.toContain('$("testDiscord")?.addEventListener');
    expect(siteJs).not.toContain('$("testTelegram")?.addEventListener');
  });

  it("shows the locked-plan message in the status and error toast without a request", async () => {
    const button = { getAttribute: () => "true" };
    const status = { textContent: "" };
    const toast = mock();
    const request = mock();

    await runNotificationTest({ button, status, request, toast });

    expect(status.textContent).toBe("Notifications are a Pro feature. Upgrade to unlock.");
    expect(toast).toHaveBeenCalledWith("Notifications are a Pro feature. Upgrade to unlock.", "error");
    expect(request).not.toHaveBeenCalled();
  });

  it("reports non-JSON and server errors in both status and toast", async () => {
    const button = { getAttribute: () => "false" };
    const status = { textContent: "" };
    const toast = mock();

    await runNotificationTest({
      button,
      status,
      toast,
      request: async () => ({ ok: false, status: 502, json: async () => { throw new Error("not JSON"); } }),
    });
    expect(status.textContent).toBe("Server error (HTTP 502)");
    expect(toast).toHaveBeenLastCalledWith("Server error (HTTP 502)", "error");

    await runNotificationTest({
      button,
      status,
      toast,
      request: async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: "Webhook URL is invalid." }) }),
    });
    expect(status.textContent).toBe("Webhook URL is invalid.");
    expect(toast).toHaveBeenLastCalledWith("Webhook URL is invalid.", "error");
  });

  it("shows visible success feedback", async () => {
    const status = { textContent: "" };
    const toast = mock();
    await runNotificationTest({
      button: { getAttribute: () => "false" },
      status,
      toast,
      request: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    });
    expect(status.textContent).toBe("✅ Sent!");
    expect(toast).toHaveBeenCalledWith("Test notification sent.", "success");
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
