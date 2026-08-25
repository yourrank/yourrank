import { describe, expect, it } from "bun:test";
import { appHtml, clientScriptSource } from "../dashboard-views.js";

const user = { display_name: "Creator", email: "creator@example.com", plan: "free" };

function html(page: string, context: Record<string, unknown> = {}) {
  return appHtml(user, "https://yourrank.site", "nonce", page, undefined, context);
}

describe("Telegram overview states", () => {
  it("shows one focused setup action before a bot is connected", () => {
    const page = html("overview", { botUsername: null, siteName: "Main site" });

    expect(page).toContain("Connect Telegram");
    expect(page).toContain('href="/dashboard/telegram/bots">Connect Telegram</a>');
    expect(page).toContain("Next step:");
    expect(page).not.toContain('id="totClicks"');
    expect(page).not.toContain('id="chart"');
    // One primary setup action, not a mosaic of setup cards.
    expect((page.match(/class="btn btn--accent"/g) || []).length).toBe(1);
  });

  it("leads with connection state and one useful action once a bot is connected", () => {
    const page = html("overview", { botUsername: "creator_bot", botStatus: "active", siteName: "Main site" });

    expect(page).toContain("@creator_bot");
    expect(page).toContain('id="tgConn"');
    expect(page).toContain('id="tgConnState"');
    expect(page).toContain('id="tgConnPrimary"');
    expect(page).toContain("Send update");
    expect(page).toContain("Edit commands");
    expect(page).toContain('id="deepLinkExample"');
    expect(page).toContain('id="totClicks"');
    expect(page).toContain('id="chart"');
  });

  it("puts the same connection summary on the connection page and nowhere twice", () => {
    for (const page of ["overview", "bots"]) {
      const markup = html(page, { botUsername: "creator_bot", botStatus: "active" });
      expect((markup.match(/id="tgConn"/g) || []).length).toBe(1);
    }
    expect(html("broadcasts")).not.toContain('id="tgConn"');
  });
});

describe("Telegram connection state runtime", () => {
  const src = clientScriptSource();

  it("derives every state from data the API actually returns", () => {
    expect(src).toContain("function botConnectionState(bot)");
    expect(src).toContain("'Connected'");
    expect(src).toContain("'Needs attention'");
    expect(src).toContain("'Setup incomplete'");
    expect(src).toContain("'Not connected'");
    // A stored "active" row alone must not keep claiming Connected once
    // Telegram has reported a delivery problem.
    expect(src).toContain("__botAttention[id]");
  });

  it("distinguishes an API failure from being disconnected", () => {
    expect(src).toContain("function showConnectionError()");
    expect(src).toContain("'Status unavailable'");
    expect(src).toContain("showConnectionError();");
    // The raw upstream error never becomes the creator-facing sentence.
    expect(src).toContain("Couldn't check your Telegram connection.");
  });

  it("keeps the masked connect code and raw provider detail out of the primary row", () => {
    const rowStart = src.indexOf('<li class="tg-row tg-bot-row">');
    const detailsStart = src.indexOf("Connection details");
    expect(rowStart).toBeGreaterThan(-1);
    expect(detailsStart).toBeGreaterThan(rowStart);
    expect(src.slice(rowStart, detailsStart)).not.toContain("token_hint");
  });

  it("no longer renders the retired bot-card mosaic or unstyled row classes", () => {
    expect(src).not.toContain('class="bot-card"');
    expect(src).not.toContain('class="lrow"');
    expect(src).not.toContain('class="nm"');
  });

  it("says who a broadcast goes to and maps send status to plain words", () => {
    expect(src).toContain("'Goes to <b>'");
    expect(src).toContain("function broadcastStatusLabel(status)");
    expect(src).toContain("scheduled: 'Scheduled'");
  });
});
