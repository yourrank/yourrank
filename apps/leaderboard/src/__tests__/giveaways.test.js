import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { handleGiveawayChatroom } from "../handlers/giveaway.js";
import { giveawaysConfig } from "../pages/giveaways.jsx";
import { GIVEAWAY_TABS, giveawaysHtml, renderGiveawaysContentHtml, renderGiveawaysHtml } from "../pages/giveaway-pages.js";
import {
  actGiveaways,
  clickGiveaways,
  document,
  mountGiveawaysPage,
  restoreGiveawaysDomGlobals,
  unmountGiveawaysPage,
  window,
} from "./giveaways-react-utils.js";

const siteSource = readFileSync(new URL("../assets/dashboard/site.js", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../assets/dashboard.js", import.meta.url), "utf8");
const previewTabsSource = readFileSync(new URL("../assets/dashboard/preview-tabs.js", import.meta.url), "utf8");
const giveawaysPageSource = readFileSync(new URL("../react/pages/giveaways/page.tsx", import.meta.url), "utf8");
const giveawayPagesSource = readFileSync(new URL("../pages/giveaway-pages.js", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../react/lib/api.ts", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../assets/dashboard/shell.js", import.meta.url), "utf8");

const $id = (id) => document.getElementById(id);
const emptyChat = {
  connection: { connected: true, chatReady: true, channelName: "creator" },
  session: null,
  entries: [],
  winner: null,
  capabilities: { vpnDetection: false },
};

async function mountChat(chat = emptyChat) {
  const requests = [];
  await mountGiveawaysPage({
    tab: "chat",
    site: { id: "site-1", name: "Kick Cup", slug: "kick-cup" },
    deps: {
      api: async (path, init, siteId) => {
        requests.push({ path, init, siteId });
        if (path === "/api/giveaways/chat") return chat;
        return {};
      },
    },
  });
  return requests;
}

const verificationEntries = [
  {
    id: "entry-pending",
    giveaway_session_id: "verified-session",
    provider: "kick",
    provider_user_id: "kick:pending",
    username: "pending-viewer",
    avatar_url: null,
    message: "",
    badges: [],
    entered_at: "2026-09-28T00:00:00Z",
    eligibility_status: "pending_verification",
  },
  {
    id: "entry-eligible",
    giveaway_session_id: "verified-session",
    provider: "kick",
    provider_user_id: "kick:eligible",
    username: "eligible-viewer",
    avatar_url: null,
    message: "",
    badges: [],
    entered_at: "2026-09-28T00:01:00Z",
    eligibility_status: "eligible",
  },
];

function verificationChat({ status = "active", entryMode = "verified", vpnDetection = false } = {}) {
  return {
    ...emptyChat,
    capabilities: { vpnDetection },
    session: {
      id: "verified-session",
      status,
      provider: "kick",
      keyword: "!verify",
      started_at: "2026-09-28T00:00:00Z",
      rules: { entryMode, vpnDetection },
    },
    entries: verificationEntries,
  };
}

afterEach(async () => {
  await unmountGiveawaysPage();
});
afterAll(() => {
  restoreGiveawaysDomGlobals();
});

describe("Giveaway Chatroom Handler", () => {
  const allowRateLimit = async () => ({ ok: true, remaining: 59, limit: 60, retryAfter: 0 });

  it("returns numeric chatroom ID when provided directly", async () => {
    const req = new Request("http://localhost/api/giveaways/chatroom?channel=12345678");
    const res = await handleGiveawayChatroom(req, {}, { rateLimitImpl: allowRateLimit });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.chatroomId).toBe(12345678);
    expect(data.channel).toBe("12345678");
  });

  it("returns 400 when channel parameter is missing and user has no site", async () => {
    const req = new Request("http://localhost/api/giveaways/chatroom");
    const res = await handleGiveawayChatroom(req, {}, { rateLimitImpl: allowRateLimit });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Missing channel parameter");
  });

  it("rejects over-limit callers before contacting Kick", async () => {
    let fetchCalled = false;
    const req = new Request("http://localhost/api/giveaways/chatroom?channel=streamer");
    const res = await handleGiveawayChatroom(req, {}, {
      rateLimitImpl: async () => ({ ok: false, remaining: 0, limit: 60, retryAfter: 60 }),
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response("{}");
      },
    });
    expect(res.status).toBe(429);
    expect(fetchCalled).toBe(false);
  });
});

describe("Giveaways React migration", () => {
  it("renders the route mount points and keeps Tournaments on its separate roots", () => {
    expect(giveawaysHtml).toBe('<div id="giveaway-root" class="yr-react" data-tab="chat"></div>');
    expect(GIVEAWAY_TABS.map(([tab]) => tab)).toEqual(["chat"]);
    expect(giveawayPagesSource).not.toContain("chat-entry.js");
    expect(giveawayPagesSource).toContain('id="tournament-dialogs"');
    for (const tab of ["chat", "hub"]) {
      expect(renderGiveawaysHtml(tab)).toContain(`data-tab="${tab}"`);
    }
    expect(renderGiveawaysHtml("drops")).toContain('data-tab="chat"');

    const tournaments = renderGiveawaysContentHtml("tournaments");
    expect(tournaments).toContain('id="tournament-app"');
    expect(tournaments).toContain('id="tournament-root"');
    expect(tournaments).toContain('id="tournament-dialogs"');
    expect(tournaments).not.toContain("giveaway-root");
    expect(giveawaysConfig.styles).toContain("/assets/react/react.css");
    expect(giveawaysConfig.scripts).toContain('<script src="/assets/tournaments.js?v=2" type="module"></script>');
  });

  it("mounts the current connected-channel surface and selected-site context", async () => {
    const requests = await mountChat();
    expect(document.querySelector("h1")?.textContent).toBe("Giveaways");
    expect(document.querySelector("#engage-scope")?.getAttribute("data-scope")).toBe("site");
    expect($id("gw-channel-name").textContent).toContain("creator");
    expect($id("gw-btn-listen").textContent).toContain("Start giveaway");
    expect($id("gw-setup-card").textContent).toContain("Settings");
    expect($id("gw-stage-card")).toBeTruthy();
    expect($id("gw-entrants-empty").textContent).toContain("No entrants yet");
    expect($id("gw-entrants-empty").parentElement.className).toContain("h-[28rem] overflow-y-auto rounded-lg border");
    expect($id("gw-entrants-empty").parentElement.contains($id("gw-entrants-empty"))).toBe(true);
    expect($id("gw-entrants-card").contains($id("gw-btn-roll"))).toBe(true);
    expect($id("gw-stage-idle").parentElement.parentElement.className).toContain("h-[28rem] overflow-y-auto rounded-lg border");
    expect($id("gw-btn-roll").hidden).toBe(false);
    expect($id("gw-btn-roll").textContent.trim()).toBe("Draw winner");
    expect($id("gw-search-entrants").placeholder).toBe("Search participant…");
    expect($id("gw-btn-export").getAttribute("aria-label")).toBe("Export CSV");
    expect($id("gw-btn-export").getAttribute("title")).toBe("Export CSV");
    expect($id("gw-settings-note")).toBeNull();
    expect(requests.some((request) => request.path === "/api/giveaways/chat" && request.siteId === "site-1")).toBe(true);
  });

  it("renders the verification share box in Settings and the pending count in Participants", async () => {
    await mountChat(verificationChat());

    const verificationPath = `/giveaways/verify?sessionId=${encodeURIComponent("verified-session")}`;
    const verificationUrl = new URL(verificationPath, window.location.origin).href;
    const share = $id("gw-verification-share");
    expect(share).toBeTruthy();
    expect(share.hidden).toBe(false);
    expect($id("gw-setup-card").contains(share)).toBe(true);
    expect($id("gw-entrants-card").contains(share)).toBe(false);
    expect($id("gw-verification-url").value).toBe(verificationUrl);
    expect($id("gw-verification-link")).toBeNull();
    expect($id("gw-btn-copy-verification").getAttribute("aria-label")).toBe("Copy verification link");
    expect($id("gw-btn-copy-verification").getAttribute("title")).toBe("Copy link");
    expect($id("gw-verification-pending").textContent.trim()).toBe("1 waiting for verification");
    expect($id("gw-verification-pending").getAttribute("role")).toBe("status");
    expect($id("gw-verification-link-wrap")).toBeNull();
  });

  it("copies the absolute verification URL and announces success", async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "clipboard");
    const copied = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => { copied.push(text); } },
    });

    try {
      await mountChat(verificationChat());
      clickGiveaways($id("gw-btn-copy-verification"));
      await actGiveaways();

      expect(copied).toEqual([new URL("/giveaways/verify?sessionId=verified-session", window.location.origin).href]);
      expect($id("gw-page-alert").textContent).toContain("Verification link copied.");
    } finally {
      if (clipboardDescriptor) Object.defineProperty(window.navigator, "clipboard", clipboardDescriptor);
      else delete window.navigator.clipboard;
    }
  });

  it("announces when copying the verification URL fails", async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "clipboard");
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("Clipboard unavailable"); } },
    });

    try {
      await mountChat(verificationChat());
      clickGiveaways($id("gw-btn-copy-verification"));
      await actGiveaways();

      expect($id("gw-page-alert").textContent).toContain("Could not copy the verification link.");
    } finally {
      if (clipboardDescriptor) Object.defineProperty(window.navigator, "clipboard", clipboardDescriptor);
      else delete window.navigator.clipboard;
    }
  });

  it("hides the verification share box for chat-mode sessions", async () => {
    await mountChat(verificationChat({ entryMode: "chat" }));
    expect($id("gw-verification-share")).toBeNull();
  });

  it("hides the verification share box for completed sessions", async () => {
    await mountChat(verificationChat({ status: "completed" }));
    expect($id("gw-verification-share")).toBeNull();
  });

  it("shows the Verified Entry upsell instead of anti-abuse controls in chat mode", async () => {
    await mountChat(verificationChat({ status: "stopped", entryMode: "chat" }));
    const section = $id("gw-anti-abuse-section");

    expect(section.hidden).toBe(false);
    expect($id("gw-opt-ip")).toBeNull();
    expect($id("gw-opt-vpn")).toBeNull();
    expect($id("gw-device-requirement")).toBeNull();
    expect(section.textContent).not.toContain("Duplicate device detection");
    expect(section.textContent).not.toContain("Locked —");
    expect([...section.querySelectorAll("p")].map((paragraph) => paragraph.textContent.trim()))
      .toContain("Chat entries: one entry per Kick account.");
    expect($id("gw-verified-upsell").textContent.trim()).toBe("Turn on Verified Entry to add IP and VPN checks.");
  });

  it("shows enabled IP protection and omits unsupported VPN detection in verified mode", async () => {
    await mountChat(verificationChat({ status: "stopped", vpnDetection: false }));

    expect($id("gw-opt-ip")).toBeTruthy();
    expect($id("gw-opt-ip").disabled).toBe(false);
    expect($id("gw-ip-requirement").textContent.trim()).toBe("Shared connections may exclude people living together.");
    expect($id("gw-opt-vpn")).toBeNull();
    expect($id("gw-vpn-requirement")).toBeNull();
    expect($id("gw-anti-abuse-section").textContent).not.toContain("Unavailable right now.");
  });

  it("shows enabled IP and VPN detection when supported in verified mode", async () => {
    await mountChat(verificationChat({ status: "stopped", vpnDetection: true }));

    expect($id("gw-opt-ip")).toBeTruthy();
    expect($id("gw-opt-ip").disabled).toBe(false);
    expect($id("gw-ip-requirement").textContent.trim()).toBe("Shared connections may exclude people living together.");
    expect($id("gw-opt-vpn")).toBeTruthy();
    expect($id("gw-opt-vpn").disabled).toBe(false);
    expect($id("gw-vpn-requirement").textContent.trim()).toBe("Blocks VPN, proxy, Tor and hosting networks.");
  });

  it("uses the connected-channel API without the legacy chatroom listener", () => {
    for (const legacy of ["connectKickChat", "chat-entry.js", "/api/giveaways/chatroom", "chatroomId", "Resolving Kick chatroom", "Start Listening", "Refreshing will clear"]) {
      expect(giveawaysPageSource).not.toContain(legacy);
    }
    expect(giveawaysPageSource).toContain('const CHAT_POLL_MS = 4_000');
    expect(giveawaysPageSource).toContain('apiClient<ChatGiveawayPayload>("/api/giveaways/chat", {}, siteId)');
    expect(giveawaysPageSource).toContain('apiClient<ChatGiveawayPayload>(`/api/giveaways/chat${path}`');
    expect(giveawaysPageSource).toContain('chatApi("/start", body)');
    expect(giveawaysPageSource).toContain('chatApi("/stop"');
    expect(giveawaysPageSource).toContain('chatApi("/draw"');
    expect(giveawaysPageSource).toContain('id="gw-channel-name"');
    expect(giveawaysPageSource).toContain('id="gw-btn-connect-kick" href="/dashboard/settings/connections"');
    expect(giveawaysPageSource).toContain("Start manual giveaway");
  });

  it("keeps manual entry controls and the responsive chat layout in the React page", () => {
    for (const id of [
      "gw-manual-start-hint",
      "gw-add-entrant-form",
      "gw-add-entrant-name",
      "gw-setup-card",
      "gw-advanced-card",
      "gw-advanced-options",
      "gw-kick-identity-rule",
      "gw-settings-note",
      "gw-manual-rules-note",
      "gw-entrants-card",
      "gw-entrants-list",
      "gw-btn-clear",
      "gw-btn-roll",
      "gw-draw-history-list",
    ]) {
      expect(giveawaysPageSource).toContain(`id="${id}"`);
    }
    expect(giveawaysPageSource.indexOf('id="gw-keyword-field"')).toBeLessThan(giveawaysPageSource.indexOf('id="gw-btn-listen"'));
    expect(giveawaysPageSource.indexOf('id="gw-settings-note"')).toBeLessThan(giveawaysPageSource.indexOf('id="gw-advanced-options"'));
    expect(giveawaysPageSource).toContain("grid gap-6 min-[961px]:grid-cols-2 min-[1280px]:grid-cols-[minmax(17rem,0.9fr)_minmax(0,1.4fr)_minmax(17rem,1fr)]");
    expect(giveawaysPageSource).toContain("min-[961px]:max-[1279px]:row-span-2");
    expect(giveawaysPageSource).toContain("max-[960px]:order-1");
    expect(giveawaysPageSource).toContain("max-[960px]:order-2");
    expect(giveawaysPageSource).toContain("max-[960px]:order-3");
    expect(giveawaysPageSource).toContain("max-[960px]:order-4");
    expect(giveawaysPageSource).not.toContain("min-[961px]:sticky");
    expect(giveawaysPageSource).toContain("h-[28rem] overflow-y-auto rounded-lg border");
    expect(giveawaysPageSource).toContain('aria-label="Clear list" title="Clear list"');
    expect(giveawaysPageSource).toContain('className="w-full text-left text-sm"');
    expect(giveawaysPageSource).toContain("gw-entrant-msg truncate text-xs text-muted-foreground");
    expect(giveawaysPageSource).not.toContain("gw-entrant-msg-inline");
    expect(giveawaysPageSource).not.toContain("min-[1280px]:hidden");
    expect(giveawaysPageSource).not.toContain("min-w-[560px]");
    expect(giveawaysPageSource).not.toContain('id="gw-rules-card"');
    expect(giveawaysPageSource).not.toContain('id="gw-rules-summary"');
    expect(giveawaysPageSource).not.toContain("gw-stat-");
    expect(giveawaysPageSource).toContain("mt-4 grid gap-6 md:grid-cols-3");
    expect(giveawaysPageSource).toContain("sticky top-0 z-10");
    expect(giveawaysPageSource).toContain('className="rounded-lg"');
    expect(giveawaysPageSource).toContain("text-base font-semibold");
    expect(giveawaysConfig.styles).not.toContain("/assets/giveaways.css");
  });

  it("orders Settings, Participants, Winners, and Advanced as outer-grid children", async () => {
    const manualChat = verificationChat();
    manualChat.session.provider = "manual";
    await mountChat(manualChat);

    const setupCard = $id("gw-setup-card");
    const settingsColumn = setupCard.parentElement;
    const entrantsCard = $id("gw-entrants-card");
    const participantsColumn = entrantsCard.parentElement;
    const winnersColumn = $id("gw-layout");
    const advancedCard = $id("gw-advanced-card");
    const outerGrid = settingsColumn.parentElement;

    expect(outerGrid.children).toHaveLength(4);
    expect(outerGrid.children[0]).toBe(settingsColumn);
    expect(outerGrid.children[1]).toBe(participantsColumn);
    expect(outerGrid.children[2]).toBe(winnersColumn);
    expect(outerGrid.children[3]).toBe(advancedCard);
    expect(settingsColumn.querySelector("#gw-rules-card")).toBeNull();
    expect($id("gw-rules-card")).toBeNull();
    expect($id("gw-setup-card").contains($id("gw-settings-note"))).toBe(true);
    expect($id("gw-setup-card").contains($id("gw-manual-rules-note"))).toBe(true);
    expect(participantsColumn.querySelector("#gw-entrants-card")).toBe(entrantsCard);
    for (const id of [
      "gw-settings",
      "gw-entry-modes",
      "gw-kick-eligibility-section",
      "gw-winner-repeat-modes",
      "gw-response-settings",
      "gw-advanced-settings",
      "gw-advanced-eligibility-section",
      "gw-anti-abuse-section",
    ]) {
      expect($id(id).className).toContain("mx-0 min-w-0 border-0 p-0");
    }
    expect($id("gw-advanced-options").className).toBe("rounded-lg");
    expect($id("gw-advanced-options").querySelector("summary").className).toContain("text-base font-semibold");
    expect(settingsColumn.className).toContain("max-[960px]:order-3");
    expect(participantsColumn.className).toContain("max-[960px]:order-2");
    expect(winnersColumn.className).toContain("max-[960px]:order-1");
    expect(advancedCard.className).toContain("max-[960px]:order-4");
    expect(winnersColumn.children).toHaveLength(1);
    expect(winnersColumn.firstElementChild).toBe($id("gw-stage-card"));
    expect($id("gw-entrants-card").contains($id("gw-btn-roll"))).toBe(true);
    expect($id("gw-btn-clear").getAttribute("aria-label")).toBe("Clear list");
    expect($id("gw-btn-clear").getAttribute("title")).toBe("Clear list");
    expect($id("gw-setup-card").contains($id("gw-verification-share"))).toBe(true);
    expect($id("gw-entrants-card").contains($id("gw-verification-share"))).toBe(false);
    expect(advancedCard.querySelector("#gw-advanced-settings")).toBeTruthy();
    expect(advancedCard.querySelector("#gw-advanced-options")).toBeTruthy();
    expect(advancedCard.contains($id("gw-kick-identity-rule"))).toBe(true);
    expect($id("gw-setup-card").querySelector("#gw-advanced-options")).toBeNull();
  });

  it("keeps inactive mobile cards in Settings, Participants, Winners, Advanced order", async () => {
    await mountChat();

    expect($id("gw-setup-card").parentElement.className).toContain("max-[960px]:order-1");
    expect($id("gw-entrants-card").parentElement.className).toContain("max-[960px]:order-2");
    expect($id("gw-layout").className).toContain("max-[960px]:order-3");
    expect($id("gw-advanced-card").className).toContain("max-[960px]:order-4");
  });

  it("renders entrant values as text and rejects unsafe avatar URLs", async () => {
    const username = '<img src=x onerror="alert(1)">';
    const message = "<script>steal()</script>";
    await mountChat({
      ...emptyChat,
      entries: [{
        id: "unsafe-1",
        giveaway_session_id: "session-1",
        provider: "kick",
        provider_user_id: "kick:unsafe",
        username,
        avatar_url: "javascript:alert(1)",
        message,
        badges: [],
        entered_at: "2026-09-28T00:00:00Z",
        eligibility_status: "eligible",
      }],
    });
    const row = $id("gw-entrants-list").querySelector("tr");
    const viewerCell = row.querySelector('[data-label="Viewer"]');
    const viewerName = row.querySelector(".gw-entrant-name");
    expect(row.querySelector(".gw-entrant-name").textContent).toBe(username);
    expect(viewerCell.className).toContain("w-full max-w-0");
    expect(row.querySelector("img").className).toContain("size-8 shrink-0");
    expect(viewerName.parentElement.className).toBe("min-w-0 flex-1");
    expect(viewerName.className).toContain("block truncate");
    expect(row.querySelector('[data-label="Status"]').className).toContain("whitespace-nowrap");
    expect(row.querySelector('[data-label="Action"]').className).toContain("whitespace-nowrap");
    expect(row.querySelector(".gw-entrant-name img")).toBeNull();
    expect(row.querySelector(".gw-entrant-msg").textContent).toBe(message);
    expect(row.querySelector(".gw-entrant-msg-inline")).toBeNull();
    expect([...$id("gw-entrants-card").querySelectorAll("th")].map((header) => header.textContent.trim())).toEqual(["Viewer", "Status", "Action"]);
    expect(row.querySelector("img").getAttribute("src")).not.toContain("javascript:");
    expect(giveawaysPageSource).not.toContain("dangerouslySetInnerHTML");
  });

  it("shows verification status with the pending explanation and verified-mode label", async () => {
    await mountChat(verificationChat());

    const pendingStatus = $id("entrant-entry-pending").querySelector('[data-label="Status"]');
    const eligibleStatus = $id("entrant-entry-eligible").querySelector('[data-label="Status"]');
    expect(pendingStatus.textContent.trim()).toBe("Pending");
    expect(pendingStatus.querySelector("span").title).toBe("Waiting for verification — can't win yet");
    expect(pendingStatus.querySelector("span").className).toContain("border-amber-700/20 bg-amber-500/10 text-amber-800");
    expect(eligibleStatus.textContent.trim()).toBe("Verified");
    expect(eligibleStatus.querySelector("span").className).toContain("border-emerald-700/20 bg-emerald-600/10 text-emerald-800");
  });

  it("lists earlier draws newest-first with compact replacement labels", async () => {
    const chat = verificationChat();
    chat.winner = { ...verificationEntries[1], username: "current-winner" };
    chat.draws = [
      { id: "draw-first", username: "first-winner", reason: "draw", drawn_at: "2026-09-28T00:00:00Z", confirmed_at: "2026-09-28T00:00:30Z" },
      { id: "draw-second", username: "second-winner", reason: "draw", drawn_at: "2026-09-28T00:01:00Z" },
      { id: "draw-current", username: "current-winner", reason: "auto_reroll", drawn_at: "2026-09-28T00:02:00Z" },
    ];
    await mountChat(chat);

    const historyItems = [...$id("gw-draw-history-list").querySelectorAll("li")].map((item) => item.textContent);
    expect($id("gw-stage-card").textContent).toContain("Winners (2)");
    expect($id("gw-stage-card").textContent).toContain("Newest first");
    expect($id("gw-stage-card").querySelector('[id^="gw-stat-"]')).toBeNull();
    expect($id("gw-draw-history").tagName).toBe("DIV");
    expect(historyItems).toHaveLength(2);
    expect(historyItems[0]).toContain("second-winner");
    expect(historyItems[0]).toContain("Didn't respond");
    expect(historyItems[1]).toContain("first-winner");
    expect(historyItems[1]).toContain("Confirmed");
    expect($id("gw-draw-history-list").querySelectorAll(".text-emerald-700")).toHaveLength(1);
    expect(historyItems.join(" ")).not.toContain("current-winner");
  });

  it("keeps winner rules server-backed", async () => {
    expect(giveawaysPageSource).toContain('id="gw-opt-claim-req"');
    expect(giveawaysPageSource).toContain('id="gw-opt-claim-duration"');
    expect(giveawaysPageSource).toContain('id="gw-opt-winner-repeat"');
    expect(giveawaysPageSource).toContain('onChange={(value) => setRule("winnerRepeat", value ? "again" : "once")}');
    await mountChat();
    expect($id("gw-opt-winner-repeat")).toBeTruthy();
  });

  it("sends CSRF with API mutations", () => {
    expect(apiSource).toContain('"x-csrf-token"');
    expect(apiSource).toContain("response.status");
    expect(apiSource).toContain('credentials: "same-origin"');
  });

  it("keeps Engage refusals in an accessible page-level alert", () => {
    const alertIndex = giveawaysPageSource.lastIndexOf('id="gw-page-alert"');
    const chatContentIndex = giveawaysPageSource.indexOf("<ChatGiveaway apiClient=");
    expect(alertIndex).toBeGreaterThan(-1);
    expect(alertIndex).toBeLessThan(chatContentIndex);
    expect(giveawaysPageSource).toContain('role="alert">{pageAlert}</StatusMessage>');
    expect(giveawaysPageSource).toContain('onAlert(errorMessage(error, "Network error starting the giveaway."))');
    expect(giveawaysPageSource).not.toContain("fallbackId");
  });

  it("announces a rejected manual giveaway start above the active page", async () => {
    await mountGiveawaysPage({
      tab: "chat",
      site: { id: "site-1", name: "Kick Cup" },
      deps: {
        api: async (path) => {
          if (path === "/api/giveaways/chat") {
            return { ...emptyChat, connection: { connected: false, chatReady: false, channelName: null } };
          }
          if (path === "/api/giveaways/chat/start") throw new Error("The server declined this giveaway.");
          return {};
        },
      },
    });

    clickGiveaways($id("gw-btn-listen"));
    await actGiveaways();
    expect($id("gw-page-alert").textContent).toContain("The server declined this giveaway.");
    expect($id("gw-page-alert").getAttribute("role")).toBe("alert");
  });

  it("keeps linked-account labels and bulk exclusion in the React entrant list", async () => {
    const chat = {
      ...emptyChat,
      session: {
        id: "session-1",
        status: "active",
        provider: "manual",
        rules: {
          entryMode: "chat",
          subscriberOnly: false,
          vipOnly: false,
          excludePreviousWinners: false,
          winnerRepeat: "once",
          onePerIp: false,
          vpnDetection: false,
          winnerMustRespond: false,
          responseTimeout: 60,
          autoReroll: false,
        },
        draws: [],
        winner_entry_id: null,
        drawn_at: null,
      },
      entries: [
        {
          id: "entry-first",
          giveaway_session_id: "session-1",
          provider: "manual",
          provider_user_id: "manual:first",
          username: "first",
          avatar_url: null,
          message: "",
          badges: [],
          entered_at: "2026-09-28T00:00:00Z",
          eligibility_status: "eligible",
          eligibility_reason: null,
          linked: [{ username: "later", reasons: ["same_device"] }],
        },
        {
          id: "entry-later",
          giveaway_session_id: "session-1",
          provider: "manual",
          provider_user_id: "manual:later",
          username: "later",
          avatar_url: null,
          message: "",
          badges: [],
          entered_at: "2026-09-28T00:01:00Z",
          eligibility_status: "eligible",
          eligibility_reason: null,
          linked: [{ username: "first", reasons: ["same_identity"] }],
        },
        {
          id: "entry-excluded",
          giveaway_session_id: "session-1",
          provider: "manual",
          provider_user_id: "manual:excluded",
          username: "excluded",
          avatar_url: null,
          message: "",
          badges: [],
          entered_at: "2026-09-28T00:02:00Z",
          eligibility_status: "rejected",
          eligibility_reason: "excluded_linked_account",
          linked: [],
        },
      ],
    };
    const requests = [];
    await mountGiveawaysPage({
      tab: "chat",
      site: { id: "site-1", name: "Kick Cup" },
      deps: {
        api: async (path, init, siteId) => {
          requests.push({ path, init, siteId });
          if (path === "/api/giveaways/chat") return chat;
          if (path.endsWith("/entries/exclude")) return { ...chat, excluded: ["entry-later"] };
          return { ...chat, included: ["entry-excluded"] };
        },
      },
    });

    expect($id("gw-linked-banner-text").textContent).toContain("3 entrants are linked");
    expect($id("entrant-entry-first").querySelector(".gw-linked-badge").textContent).toContain("Linked · later");
    expect($id("entrant-entry-first").querySelector(".gw-linked-badge").title).toBe("later: Same device");
    expect($id("gw-linked-exclude-all").textContent).toContain("Exclude linked duplicates (1)");
    expect($id("entrant-entry-excluded").textContent).toContain("Include again");

    clickGiveaways($id("gw-linked-exclude-all"));
    await actGiveaways();
    expect($id("gw-page-alert").textContent).toContain("Excluded 1 linked entrant");
    clickGiveaways([...$id("entrant-entry-excluded").querySelectorAll("button")].find((button) => button.textContent.includes("Include again")));
    await actGiveaways();

    const excludeRequest = requests.find((request) => request.path.endsWith("/entries/exclude"));
    expect(excludeRequest.siteId).toBe("site-1");
    expect(JSON.parse(excludeRequest.init.body)).toEqual({
      entryIds: ["entry-later"],
      sessionId: "session-1",
      siteId: "site-1",
    });
    const includeRequest = requests.find((request) => request.path.endsWith("/entries/include"));
    expect(includeRequest.siteId).toBe("site-1");
    expect(JSON.parse(includeRequest.init.body)).toEqual({
      entryId: "entry-excluded",
      sessionId: "session-1",
      siteId: "site-1",
    });
  });

  it("resets the public-site preview before form submission", () => {
    const resetIndex = siteSource.indexOf("if (!resetPreviewFrame(mount)) return;");
    const submitIndex = siteSource.indexOf("local.form.submit()");
    expect(resetIndex).toBeGreaterThanOrEqual(0);
    expect(submitIndex).toBeGreaterThan(resetIndex);
  });

  it("keeps preview device tabs under a single controller", () => {
    expect(dashboardSource).not.toContain('querySelectorAll(".preview-tab")');
    expect(previewTabsSource).not.toContain("stopImmediatePropagation");
  });

  it("keeps the single OBS copy action in the overlay designer, not the shell", () => {
    const designerSource = readFileSync(new URL("../assets/dashboard/overlay-designer.js", import.meta.url), "utf8");
    expect(designerSource).toContain('$("odCopy")');
    for (const id of ["odCopy", "ov-btn-copy-pred-hud", "ov-btn-copy-alerts", "ov-btn-copy-ticker"]) {
      expect(shellSource).not.toContain(id);
    }
    for (const id of ["ov-btn-copy-pred-hud", "ov-btn-copy-alerts", "ov-btn-copy-ticker"]) {
      expect(siteSource).not.toContain(id);
    }
  });

  it("keeps truthful unverified and resend controls", () => {
    const dashboardPage = readFileSync(new URL("../pages/dashboard.jsx", import.meta.url), "utf8");
    expect(dashboardPage).toContain('id="verifyBannerEmail"');
    expect(dashboardPage).toContain('id="verifyResend"');
    expect(dashboardPage).toContain('id="verifyDismiss"');
    expect(siteSource).toContain("/api/auth/resend-verification");
    expect(dashboardPage).toContain("Visitors cannot open your published leaderboard");
  });
});
