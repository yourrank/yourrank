import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { handleGiveawayChatroom } from "../handlers/giveaway.js";
import { giveawaysConfig } from "../pages/giveaways.jsx";
import { GIVEAWAY_TABS, giveawaysHtml, renderGiveawaysContentHtml, renderGiveawaysHtml } from "../pages/giveaway-pages.js";
import { apiPath } from "../react/lib/api.ts";
import {
  actGiveaways,
  clickGiveaways,
  document,
  mountGiveawaysPage,
  restoreGiveawaysDomGlobals,
  setGiveawaysInputValue,
  unmountGiveawaysPage,
  window,
} from "./giveaways-react-utils.js";

const gamesSource = readFileSync(new URL("../assets/dashboard/games.js", import.meta.url), "utf8");
const siteSource = readFileSync(new URL("../assets/dashboard/site.js", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../assets/dashboard.js", import.meta.url), "utf8");
const previewTabsSource = readFileSync(new URL("../assets/dashboard/preview-tabs.js", import.meta.url), "utf8");
const giveawaysPageSource = readFileSync(new URL("../react/pages/giveaways/page.tsx", import.meta.url), "utf8");
const giveawayPagesSource = readFileSync(new URL("../pages/giveaway-pages.js", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../react/lib/api.ts", import.meta.url), "utf8");
const sheetSource = readFileSync(new URL("../react/components/ui/sheet.tsx", import.meta.url), "utf8");
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

async function withSiteQuery(siteId, run) {
  const originalUrl = window.location.href;
  const originalState = window.history.state;
  const url = new URL(originalUrl);
  url.searchParams.set("siteId", siteId);
  window.history.replaceState({}, "", url.href);
  try {
    await run();
  } finally {
    window.history.replaceState(originalState, "", originalUrl);
  }
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
    expect(GIVEAWAY_TABS.map(([tab]) => tab)).toEqual(["chat", "raffles", "preds"]);
    expect(giveawayPagesSource).not.toContain("chat-entry.js");
    expect(giveawayPagesSource).toContain('id="tournament-dialogs"');
    for (const tab of ["chat", "raffles", "preds", "hub"]) {
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
    expect($id("gw-rules-summary")).toBeTruthy();
    expect($id("gw-stage-card")).toBeTruthy();
    expect($id("gw-entrants-empty").textContent).toContain("No entrants yet");
    expect(requests.some((request) => request.path === "/api/giveaways/chat" && request.siteId === "site-1")).toBe(true);
  });

  it("renders the verification share box above entrants with the pending count", async () => {
    await mountChat(verificationChat());

    const verificationPath = `/giveaways/verify?sessionId=${encodeURIComponent("verified-session")}`;
    const verificationUrl = new URL(verificationPath, window.location.origin).href;
    const share = $id("gw-verification-share");
    expect(share).toBeTruthy();
    expect(share.hidden).toBe(false);
    expect(share.parentElement.firstElementChild).toBe(share);
    expect($id("gw-verification-url").value).toBe(verificationUrl);
    expect($id("gw-verification-link").getAttribute("href")).toBe(verificationPath);
    expect($id("gw-verification-link").getAttribute("target")).toBe("_blank");
    expect($id("gw-verification-pending").textContent.trim()).toBe("1 entry is waiting for verification.");
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

  it("shows plain-language VPN detection availability copy", async () => {
    await mountChat(verificationChat({ vpnDetection: true }));
    expect($id("gw-vpn-requirement").textContent.trim()).toBe("Blocks VPN, proxy, Tor and hosting networks.");
  });

  it("shows plain-language unavailability copy when VPN detection is unavailable", async () => {
    await mountChat(verificationChat());
    expect($id("gw-vpn-requirement").textContent.trim()).toBe("Unavailable right now.");
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
      "gw-rules-summary",
      "gw-advanced-card",
      "gw-advanced-options",
      "gw-settings-note",
      "gw-manual-rules-note",
      "gw-entrants-card",
      "gw-entrants-list",
    ]) {
      expect(giveawaysPageSource).toContain(`id="${id}"`);
    }
    expect(giveawaysPageSource.indexOf('id="gw-keyword-field"')).toBeLessThan(giveawaysPageSource.indexOf('id="gw-btn-listen"'));
    expect(giveawaysPageSource.indexOf('id="gw-settings-note"')).toBeLessThan(giveawaysPageSource.indexOf('id="gw-advanced-options"'));
    expect(giveawaysPageSource).toContain("grid gap-6 min-[961px]:grid-cols-2 min-[1280px]:grid-cols-[minmax(18rem,1fr)_minmax(0,1.35fr)_minmax(17rem,0.95fr)]");
    expect(giveawaysPageSource).toContain("min-[961px]:max-[1279px]:row-span-2");
    expect(giveawaysPageSource).toContain("max-[960px]:order-1");
    expect(giveawaysPageSource).toContain("max-[960px]:order-2");
    expect(giveawaysPageSource).toContain("max-[960px]:order-3");
    expect(giveawaysPageSource).toContain("max-[960px]:order-4");
    expect(giveawaysPageSource).not.toContain("min-[961px]:sticky");
    expect(giveawaysPageSource).toContain("overflow-x-auto rounded-lg border min-[1280px]:max-h-[70vh] min-[1280px]:overflow-y-auto");
    expect(giveawaysPageSource).toContain("w-full min-w-[560px] min-[1280px]:min-w-0 text-left text-sm");
    expect(giveawaysPageSource).toContain("gw-entrant-msg-inline hidden truncate text-xs text-muted-foreground min-[1280px]:block");
    expect(giveawaysPageSource).toContain("min-[1280px]:hidden");
    expect(giveawaysPageSource).not.toContain("min-w-[680px]");
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
    expect(settingsColumn.querySelector("#gw-rules-card")).toBe($id("gw-rules-card"));
    expect($id("gw-rules-card").contains($id("gw-settings-note"))).toBe(true);
    expect($id("gw-rules-card").contains($id("gw-manual-rules-note"))).toBe(true);
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
    expect(advancedCard.querySelector("#gw-advanced-settings")).toBeTruthy();
    expect(advancedCard.querySelector("#gw-advanced-options")).toBeTruthy();
    expect($id("gw-rules-card").querySelector("#gw-advanced-options")).toBeNull();
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
    expect(viewerCell.className).toContain("min-[1280px]:w-full min-[1280px]:max-w-0");
    expect(row.querySelector("img").className).toContain("shrink-0");
    expect(viewerName.parentElement.className).toBe("min-w-0 flex-1");
    expect(viewerName.className).toContain("min-[1280px]:block min-[1280px]:truncate");
    expect(row.querySelector('[data-label="Status"]').className).toContain("whitespace-nowrap");
    expect(row.querySelector('[data-label="Action"]').className).toContain("whitespace-nowrap min-[1280px]:px-2");
    expect(row.querySelector(".gw-entrant-name img")).toBeNull();
    expect(row.querySelector(".gw-entrant-msg").textContent).toBe(message);
    const inlineMessage = row.querySelector(".gw-entrant-msg-inline");
    expect(inlineMessage).toBeTruthy();
    expect(inlineMessage.textContent).toBe(message);
    expect(inlineMessage.className).toContain("min-[1280px]:block");
    const chatMessageHeader = [...$id("gw-entrants-card").querySelectorAll("th")].find((header) => header.textContent === "Chat Message");
    expect(chatMessageHeader).toBeTruthy();
    expect(chatMessageHeader.className).toContain("min-[1280px]:hidden");
    expect(row.querySelector("img").getAttribute("src")).not.toContain("javascript:");
    expect(giveawaysPageSource).not.toContain("dangerouslySetInnerHTML");
  });

  it("keeps winner rules server-backed and scopes predictions to the selected site", async () => {
    expect(giveawaysPageSource).toContain('id="gw-opt-claim-req"');
    expect(giveawaysPageSource).toContain('id="gw-opt-claim-duration"');
    expect(giveawaysPageSource).toContain('id={`gw-winner-repeat-${value}`}');
    expect(giveawaysPageSource).toContain('apiClient<PredictionsPayload>("/api/predictions", {}, siteId)');
    expect(giveawaysPageSource).toContain('apiClient<PredictionsPayload>("/api/predictions", post({');
    expect(apiPath("/api/predictions", "site 1")).toBe("/api/predictions?siteId=site%201");
    expect(apiPath("/api/events/raffles?state=open", "site-1")).toBe("/api/events/raffles?state=open&siteId=site-1");
    await mountChat();
    expect($id("gw-winner-repeat-once")).toBeTruthy();
  });

  it("sends CSRF with API mutations and uses accessible Radix sheets for drawers", () => {
    expect(apiSource).toContain('"x-csrf-token"');
    expect(apiSource).toContain("response.status");
    expect(apiSource).toContain('credentials: "same-origin"');
    expect(giveawaysPageSource).toContain('<SheetContent id="pred-drawer"');
    expect(giveawaysPageSource).toContain('<SheetTitle id="pred-drawer-title">');
    expect(giveawaysPageSource).toContain('className="max-h-dvh overflow-hidden"');
    expect(giveawaysPageSource).toContain("min-h-0 flex-1 space-y-5 overflow-y-auto");
    expect(giveawaysPageSource).toContain('<SheetFooter className="shrink-0">');
    expect(sheetSource).toContain("DialogPrimitive.Content");
    expect(sheetSource).toContain("DialogPrimitive.Portal");
    expect(sheetSource).toContain("DialogPrimitive.Title");
  });

  it("restores, saves, and discards raffle drawer drafts for the selected site", async () => {
    await withSiteQuery("site-1", async () => {
      const key = "yr-engage-draft:site-1:rf-drawer";
      window.sessionStorage.setItem(key, JSON.stringify({
        "rf-title": "Community headset",
        "rf-desc": "For the winner",
        "rf-cost": "25",
        "rf-max": "5",
      }));
      await mountGiveawaysPage({
        tab: "raffles",
        site: { id: "site-1", name: "Kick Cup" },
        deps: { api: async () => ({ raffles: [] }) },
      });

      clickGiveaways($id("btn-create-raffle"));
      await actGiveaways();
      expect($id("rf-title").value).toBe("Community headset");
      expect($id("rf-desc").value).toBe("For the winner");
      expect($id("rf-cost").value).toBe("25");
      expect($id("rf-max").value).toBe("5");

      setGiveawaysInputValue($id("rf-title"), "Updated headset");
      await actGiveaways();
      expect(JSON.parse(window.sessionStorage.getItem(key))).toMatchObject({ "rf-title": "Updated headset" });
      await actGiveaways(() => $id("rf-title").dispatchEvent(new window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })));
      expect(JSON.parse(window.sessionStorage.getItem(key))).toMatchObject({ "rf-title": "Updated headset" });
      clickGiveaways($id("btn-create-raffle"));
      await actGiveaways();
      expect($id("rf-title").value).toBe("Updated headset");
      clickGiveaways($id("rf-cancel"));
      await actGiveaways();
      expect(window.sessionStorage.getItem(key)).toBeNull();
    });
  });

  it("keeps the raffle drawer defaults and field guidance", async () => {
    await withSiteQuery("site-1", async () => {
      window.sessionStorage.removeItem("yr-engage-draft:site-1:rf-drawer");
      await mountGiveawaysPage({
        tab: "raffles",
        site: { id: "site-1", name: "Kick Cup" },
        deps: { api: async () => ({ raffles: [] }) },
      });

      clickGiveaways($id("btn-create-raffle"));
      await actGiveaways();

      expect($id("rf-cost").value).toBe("30");
      expect($id("rf-title").placeholder).toBe("e.g. $100 Amazon Gift Card or VIP Role");
      expect($id("rf-desc").placeholder).toBe("Rules or details for claiming this prize…");
      expect($id("rf-cost").placeholder).toBe("e.g. 30");
      expect($id("rf-max").placeholder).toBe("e.g. 5");
      expect(document.querySelector('label[for="rf-title"]').textContent).toBe("Prize Title *");
      expect(document.querySelector('label[for="rf-cost"]').textContent).toBe("Ticket Cost (in Credits)");
      expect(document.querySelector('label[for="rf-title"]').parentElement.textContent).toContain("What will the winner receive?");
    });
  });

  it("creates raffles with the existing endpoint, request body, and site scope", async () => {
    await withSiteQuery("site-1", async () => {
      const requests = [];
      await mountGiveawaysPage({
        tab: "raffles",
        site: { id: "site-1", name: "Kick Cup" },
        deps: {
          api: async (path, init, siteId) => {
            requests.push({ path, init, siteId });
            return { raffles: [] };
          },
        },
      });

      clickGiveaways($id("btn-create-raffle"));
      await actGiveaways();
      setGiveawaysInputValue($id("rf-title"), "Community headset");
      setGiveawaysInputValue($id("rf-desc"), "For the winner");
      setGiveawaysInputValue($id("rf-cost"), "25");
      setGiveawaysInputValue($id("rf-max"), "5");
      await actGiveaways();
      clickGiveaways($id("rf-submit"));
      await actGiveaways();

      const createRequest = requests.find((request) => request.init?.method === "POST");
      expect(createRequest.path).toBe("/api/events/raffles");
      expect(createRequest.siteId).toBe("site-1");
      expect(JSON.parse(createRequest.init.body)).toEqual({
        title: "Community headset",
        description: "For the winner",
        ticketCost: 25,
        maxTickets: 5,
      });
      expect(window.sessionStorage.getItem("yr-engage-draft:site-1:rf-drawer")).toBeNull();
    });
  });

  it("restores prediction drawer fields from the selected site's saved draft", async () => {
    await withSiteQuery("site-1", async () => {
      const key = "yr-engage-draft:site-1:pred-drawer";
      window.sessionStorage.setItem(key, JSON.stringify({
        "pred-title": "Who scores next?",
        "pred-opt-1": "Blue",
        "pred-opt-2": "Red",
        "pred-min-bet": "20",
        "pred-max-bet": "800",
        "pred-lock-min": "12",
      }));
      await mountGiveawaysPage({
        tab: "preds",
        site: { id: "site-1", name: "Kick Cup" },
        deps: { api: async () => ({ predictions: [], entitlement: { enabled: true } }) },
      });

      clickGiveaways($id("btn-open-event-drawer"));
      await actGiveaways();
      expect($id("pred-title").value).toBe("Who scores next?");
      expect($id("pred-opt-1").value).toBe("Blue");
      expect($id("pred-opt-2").value).toBe("Red");
      expect($id("pred-min-bet").value).toBe("20");
      expect($id("pred-max-bet").value).toBe("800");
      expect($id("pred-lock-min").value).toBe("12");

      clickGiveaways($id("pred-cancel"));
      await actGiveaways();
      expect(window.sessionStorage.getItem(key)).toBeNull();
    });
  });

  it("creates predictions with the existing endpoint, request body, and site scope", async () => {
    await withSiteQuery("site-1", async () => {
      const requests = [];
      await mountGiveawaysPage({
        tab: "preds",
        site: { id: "site-1", name: "Kick Cup" },
        deps: {
          api: async (path, init, siteId) => {
            requests.push({ path, init, siteId });
            return { predictions: [], entitlement: { enabled: true } };
          },
        },
      });

      clickGiveaways($id("btn-open-event-drawer"));
      await actGiveaways();
      setGiveawaysInputValue($id("pred-title"), "Will blue win?");
      setGiveawaysInputValue($id("pred-opt-1"), "Blue");
      setGiveawaysInputValue($id("pred-opt-2"), "Red");
      setGiveawaysInputValue($id("pred-min-bet"), "20");
      setGiveawaysInputValue($id("pred-max-bet"), "400");
      setGiveawaysInputValue($id("pred-lock-min"), "12");
      await actGiveaways();
      clickGiveaways($id("pred-submit"));
      await actGiveaways();

      const createRequest = requests.find((request) => request.init?.method === "POST");
      expect(createRequest.path).toBe("/api/predictions");
      expect(createRequest.siteId).toBe("site-1");
      expect(JSON.parse(createRequest.init.body)).toEqual({
        title: "Will blue win?",
        options: [{ id: "yes", label: "Blue" }, { id: "no", label: "Red" }],
        minBet: 20,
        maxBet: 400,
        lockMinutes: 12,
      });
      expect(window.sessionStorage.getItem("yr-engage-draft:site-1:pred-drawer")).toBeNull();
    });
  });

  it("renders active and historical raffle rows as a responsive table", async () => {
    const active = {
      id: "raffle-live",
      title: "Live prize",
      ticket_cost: 25,
      max_tickets_per_viewer: 5,
      status: "active",
      total_tickets: 8,
      participant_count: 4,
      created_at: "2026-09-28T00:00:00Z",
    };
    const past = {
      ...active,
      id: "raffle-past",
      title: "Past prize",
      status: "completed",
      winner_name: "Casey",
      winner_ticket_number: 4,
      drawn_at: "2026-09-29T00:00:00Z",
    };
    await mountGiveawaysPage({
      tab: "raffles",
      site: { id: "site-1", name: "Kick Cup" },
      deps: { api: async () => ({ raffles: [active, past] }) },
    });

    expect($id("rf-active-list").querySelector('[data-raffle-id="raffle-live"] h3').textContent).toBe("Live prize");
    expect($id("rf-past-list").querySelector("table")).toBeTruthy();
    expect($id("rf-past-list").textContent).toContain("Casey");
    expect($id("rf-past-list").textContent).toContain("Ticket #4");
    expect($id("rf-past-list").querySelector(".gw-table")).toBeNull();
  });

  it("renders settled prediction history using the React table", async () => {
    await mountGiveawaysPage({
      tab: "preds",
      site: { id: "site-1", name: "Kick Cup" },
      deps: {
        api: async () => ({
          predictions: [{
            id: "prediction-past",
            title: "Who scored?",
            options: [{ id: "yes", label: "Blue" }, { id: "no", label: "Red" }],
            status: "settled",
            winning_option_id: "yes",
            total_pool: 120,
            min_bet: 10,
            max_bet: 50,
            created_at: "2026-09-28T00:00:00Z",
          }],
          entitlement: { enabled: true },
        }),
      },
    });

    expect($id("pred-past-list").querySelector("table")).toBeTruthy();
    expect($id("pred-past-list").textContent).toContain("Who scored?");
    expect($id("pred-past-list").textContent).toContain("settled");
    expect($id("pred-past-list").querySelector(".gw-table")).toBeNull();
  });

  it("keeps Engage refusals in an accessible page-level alert", () => {
    const alertIndex = giveawaysPageSource.indexOf('id="gw-page-alert"');
    const tabContentIndex = giveawaysPageSource.indexOf('{tab === "chat" &&');
    expect(alertIndex).toBeGreaterThan(-1);
    expect(alertIndex).toBeLessThan(tabContentIndex);
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

  it("keeps the prediction entitlement lock and upgrade recovery controls", () => {
    expect(giveawaysPageSource).toContain('id="pred-plan-lock"');
    expect(giveawaysPageSource).toContain('aria-describedby={!enabled ? "pred-plan-lock" : undefined}');
    expect(giveawaysPageSource).toContain('href="/dashboard/settings/billing?from=predictions"');
    expect(giveawaysPageSource).toContain("if (!enabled) return;");
  });

  it("keeps preview frame navigations out of browser history", () => {
    expect(gamesSource).toContain("loadSimulatorFrame(iframe, embedUrl);");
    expect(gamesSource).toContain('loadSimulatorFrame(iframe, iframe.dataset.currentSrc + "&_t=" + Date.now());');
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
