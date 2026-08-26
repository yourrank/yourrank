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
    // The offer surface keeps the presentation it already had.
    expect(page).toContain('<h2>Top offers</h2>');
    expect(page).not.toContain('class="tg-action-name">Offers<');
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

  it("no longer renders the retired bot-card mosaic for bot surfaces", () => {
    expect(src).not.toContain('class="bot-card"');
    // The only remaining legacy rows belong to the offer summary, which this
    // change deliberately leaves as it is.
    const offerSummaryStart = src.indexOf("const oo = $('ovOffers');");
    expect(offerSummaryStart).toBeGreaterThan(-1);
    for (const legacy of ['class="lrow"', 'class="nm"']) {
      const hits = [...src.matchAll(new RegExp(legacy, "g"))].map(m => m.index ?? -1);
      expect(hits.length).toBe(1);
      expect(hits[0]).toBeGreaterThan(offerSummaryStart);
    }
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
      "renderConnectionState",
      src.slice(start, end) + "\nreturn 'loaded';",
    );
    const outcome = guard(
      results.offers,
      results.daily,
      results.bots,
      () => calls.push("toast"),
      () => calls.push("showLoadError"),
      () => calls.push("showConnectionError"),
      () => calls.push("renderConnectionState"),
    );
    return { calls, outcome };
  }

  it("keeps an offers failure out of the connection summary", () => {
    const { calls } = runLoadGuard({ offers: { error: "offers down" }, daily: [], bots: [] });
    expect(calls).not.toContain("showConnectionError");
    expect(calls).toContain("renderConnectionState");
    expect(calls).toContain("showLoadError");
  });

  it("keeps a daily-stats failure out of the connection summary", () => {
    const { calls } = runLoadGuard({ offers: [], daily: { error: "stats down" }, bots: [] });
    expect(calls).not.toContain("showConnectionError");
    expect(calls).toContain("renderConnectionState");
    expect(calls).toContain("showLoadError");
  });

  it("marks the connection unavailable only when the bots request fails", () => {
    const { calls } = runLoadGuard({ offers: [], daily: [], bots: { error: "bots down" } });
    expect(calls).toContain("showConnectionError");
    expect(calls).not.toContain("renderConnectionState");
  });

  it("renders connection state from bot data when every request succeeds", () => {
    const { calls, outcome } = runLoadGuard({ offers: [], daily: [], bots: [] });
    expect(calls).toEqual(["renderConnectionState"]);
    expect(outcome).toBe("loaded");
  });

  it("says who a broadcast goes to and maps send status to plain words", () => {
    expect(src).toContain("'Goes to <b>'");
    expect(src).toContain("function broadcastStatusLabel(status)");
    expect(src).toContain("scheduled: 'Scheduled'");
  });
});
