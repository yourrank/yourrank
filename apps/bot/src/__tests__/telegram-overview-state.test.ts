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

    expect(page).toContain("<h1>Telegram</h1>");
    expect(page).not.toContain("@creator_bot");
    expect(page).toContain('id="tgConn"');
    expect(page).toContain('id="tgConnState"');
    expect(page).toContain('id="tgConnPrimary"');
    expect(page).toContain("Manage bot");
    expect(page).not.toContain("What you can do");
    expect(page).not.toContain("Your bots");
    expect(page).not.toContain('id="ovBots"');
    expect(page).toContain('id="totClicks"');
    expect(page).toContain('id="chart"');
    expect(page).toContain('id="chartEmpty"');
    expect(page).toContain('id="subSources"');
    expect(page).toContain('id="ovOffers"');
    expect(page).toContain('id="tgOffersTitle">Top offers</h2>');
    expect(page).toContain("View all offers");
  });

  it("keeps the summary on Overview and a compact context on other tabs", () => {
    expect((html("overview", { botUsername: "creator_bot", botStatus: "active" }).match(/id="tgConn"/g) || []).length).toBe(1);
    expect(html("bots")).toContain('id="tgPageContext"');
    expect(html("bots")).not.toContain('id="tgConn"');
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
    const detailsStart = src.indexOf("<summary>Manage</summary>");
    expect(rowStart).toBeGreaterThan(-1);
    expect(detailsStart).toBeGreaterThan(rowStart);
    expect(src.slice(rowStart, detailsStart)).not.toContain("token_hint");
  });

  it("renders one bot summary and structured offer rows", () => {
    expect(src).not.toContain('class="bot-card"');
    expect(src).not.toContain("$('ovBots')");
    const offerSummaryStart = src.indexOf("const oo = $('ovOffers');");
    expect(offerSummaryStart).toBeGreaterThan(-1);
    expect(src.slice(offerSummaryStart, src.indexOf("// ---- connection truth", offerSummaryStart)))
      .toContain("<tr><td><strong>");
  });

  // Runs the real guard from the shipped script against stubbed responses, so
  // the connection panel can only speak for the request that owns it.
  function runLoadGuard(results: { offers: unknown; daily: unknown; bots: unknown }) {
    const start = src.indexOf("  // Only /bots speaks for the connection");
    const end = src.indexOf("showPage(page);", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const calls: string[] = [];
    const guard = new Function(
      "offers",
      "daily",
      "bots",
      "toast",
      "showLoadError",
      "showConnectionError",
      "renderBots",
      src.slice(start, end) + "\nreturn 'loaded';",
    );
    const outcome = guard(
      results.offers,
      results.daily,
      results.bots,
      () => calls.push("toast"),
      () => calls.push("showLoadError"),
      () => calls.push("showConnectionError"),
      () => calls.push("renderBots"),
    );
    return { calls, outcome };
  }

  it("keeps an offers failure out of the connection summary", () => {
    const { calls } = runLoadGuard({ offers: { error: "offers down" }, daily: [], bots: [] });
    expect(calls).not.toContain("showConnectionError");
    expect(calls).toContain("renderBots");
    expect(calls).toContain("showLoadError");
  });

  it("keeps a daily-stats failure out of the connection summary", () => {
    const { calls } = runLoadGuard({ offers: [], daily: { error: "stats down" }, bots: [] });
    expect(calls).not.toContain("showConnectionError");
    expect(calls).toContain("renderBots");
    expect(calls).toContain("showLoadError");
  });

  it("marks the connection unavailable only when the bots request fails", () => {
    const { calls } = runLoadGuard({ offers: [], daily: [], bots: { error: "bots down" } });
    expect(calls).toContain("showConnectionError");
    expect(calls).not.toContain("renderBots");
  });

  it("renders connection state from bot data when every request succeeds", () => {
    const { calls, outcome } = runLoadGuard({ offers: [], daily: [], bots: [] });
    expect(calls).toEqual(["renderBots"]);
    expect(outcome).toBe("loaded");
  });

  it("says who a broadcast goes to and maps send status to plain words", () => {
    expect(src).toContain("'Goes to <b>'");
    expect(src).toContain("function broadcastStatusLabel(status, sentCount, failCount)");
    expect(src).toContain("scheduled: 'Scheduled'");
    const start = src.indexOf("const BROADCAST_STATUS_WORDS");
    const end = src.indexOf("function broadcastRow", start);
    const status = new Function(`${src.slice(start, end)}; return broadcastStatusLabel;`)() as (state: string, sent: number, failed: number) => string;
    expect(status("sent", 0, 3)).toBe("Failed");
    expect(status("sent", 2, 1)).toBe("Partially failed");
    expect(status("sent", 3, 0)).toBe("Sent");
    expect(status("scheduled", 0, 0)).toBe("Scheduled");
  });
});
