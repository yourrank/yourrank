import { describe, expect, it } from "bun:test";
import { appHtml } from "../dashboard-views.js";

const user = { display_name: "Creator", email: "creator@example.com", plan: "free" };

describe("Telegram overview states", () => {
  it("shows one focused setup action before a bot is connected", () => {
    const html = appHtml(user, "https://yourrank.site", "nonce", "overview", undefined, "/dashboard/telegram", {
      botUsername: null,
      siteName: "Main site",
    });

    expect(html).toContain("Connect your Telegram bot");
    expect(html).toContain('href="/dashboard/telegram/bots">Connect bot</a>');
    expect(html).not.toContain('id="totClicks"');
    expect(html).not.toContain('id="chart"');
  });

  it("shows activity and creator actions after a bot is connected", () => {
    const html = appHtml(user, "https://yourrank.site", "nonce", "overview", undefined, "/dashboard/telegram", {
      botUsername: "creator_bot",
      botStatus: "active",
      siteName: "Main site",
    });

    expect(html).toContain("@creator_bot");
    expect(html).toContain("Send a broadcast");
    expect(html).toContain("Edit commands");
    expect(html).toContain('id="deepLinkExample"');
    expect(html).toContain('id="totClicks"');
    expect(html).toContain('id="chart"');
  });
});
