import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { renderSite } from "@yourrank/shared/site-render";

const siteShell = readFileSync(new URL("../assets/site-shell.js", import.meta.url), "utf8");
const raffle = {
  id: "raffle-1",
  title: "Community prize",
  description: "A limited ticket draw.",
  ticket_cost: 25,
  max_tickets_per_viewer: 5,
  total_tickets: 8,
  my_tickets: 1,
  ends_at: "2030-01-01T00:00:00Z",
};

describe("public raffle purchase behavior", () => {
  let window;

  afterEach(async () => {
    if (window) {
      window.document.dispatchEvent(new window.Event("yr:viewer-unmount"));
      await window.happyDOM.close();
      window = null;
    }
  });

  it("clamps ticket quantity, confirms purchase, reuses the retry key, and updates the card", async () => {
    window = new Window({
      url: "https://example.test/creator/shop",
      settings: {
        disableJavaScriptEvaluation: true,
        disableCSSFileLoading: true,
        disableErrorCapturing: true,
        handleDisabledFileLoadingAsSuccess: true,
      },
    });
    const html = await renderSite({
      r: {
        slug: "creator",
        plan: "pro",
        data: {
          brand: { name: "Creator Name", tagline: "Community prizes" },
          branding: { template: "cyber_arcade", options: {} },
          players: [],
          prizes: {},
          shopItems: [],
          siteSections: { home: true, leaderboard: true, shop: true, games: false, me: true },
        },
      },
      section: "shop",
      viewer: { id: "viewer-1", kick_username: "viewer_one" },
      viewerData: {
        membershipStatus: "member",
        viewerOnSite: { id: "membership-1", balance: 100, blocked: false },
        shopItems: [],
        raffles: [raffle],
      },
      opts: { slug: "creator", homeUrl: "https://example.test", nonce: "n", csrfToken: "csrf-test" },
    });
    window.document.documentElement.innerHTML = html;

    const calls = [];
    window.fetch = async (path, init) => {
      calls.push({ path: String(path), init });
      if (calls.length === 1) {
        return { ok: false, json: async () => ({ ok: false, error: "insufficient balance" }) };
      }
      return {
        ok: true,
        json: async () => ({ ok: true, purchaseId: "purchase-1", quantity: 3, balance: 25, myTickets: 4, totalTickets: 11 }),
      };
    };
    const globals = ["window", "document", "location", "history", "fetch", "DOMParser", "Event", "URL", "AbortController", "navigator", "crypto"];
    const run = new Function(...globals, siteShell);
    run(window, window.document, window.location, window.history, window.fetch, window.DOMParser, window.Event, window.URL, window.AbortController, window.navigator, window.crypto);

    const dialog = window.document.getElementById("yr-raffle-confirm");
    dialog.showModal = function () { this.setAttribute("open", ""); };
    dialog.close = function (returnValue = "") {
      this.returnValue = returnValue;
      this.removeAttribute("open");
      this.dispatchEvent(new window.Event("close"));
    };
    const card = window.document.querySelector("[data-raffle-card]");
    const quantity = card.querySelector("[data-raffle-quantity]");
    const plus = card.querySelector('[data-raffle-step="1"]');
    const buy = card.querySelector("[data-raffle-buy]");
    const click = (element) => element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    const settle = async () => {
      for (let index = 0; index < 8; index++) await new Promise((resolve) => setTimeout(resolve, 0));
    };

    expect(quantity.max).toBe("4");
    click(plus);
    click(plus);
    expect(quantity.value).toBe("3");
    click(buy);
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("[data-raffle-detail]").textContent).toContain("Buy 3 tickets for “Community prize” for 75 free credits.");
    expect(dialog.querySelector("[data-raffle-detail]").textContent).toContain("You’d have 25 credits left.");
    click(dialog.querySelector("[data-raffle-confirm]"));
    await settle();

    const retryKey = buy.dataset.raffleKey;
    expect(retryKey).toBeTruthy();
    expect(window.document.getElementById("yr-raffle-status").textContent).toBe("You don’t have enough credits for that yet.");
    click(buy);
    expect(dialog.open).toBe(true);
    click(dialog.querySelector("[data-raffle-confirm]"));
    await settle();

    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.path)).toEqual(["/api/viewer/raffles/buy", "/api/viewer/raffles/buy"]);
    const firstBody = JSON.parse(calls[0].init.body);
    const secondBody = JSON.parse(calls[1].init.body);
    expect(firstBody).toMatchObject({ slug: "creator", raffleId: "raffle-1", quantity: 3 });
    expect(firstBody.idempotencyKey).toBe(retryKey);
    expect(secondBody.idempotencyKey).toBe(retryKey);
    expect(calls[0].init.headers["x-csrf-token"]).toBe("csrf-test");
    expect(quantity.max).toBe("1");
    expect(quantity.value).toBe("1");
    expect(card.querySelector("[data-raffle-owned]").textContent).toBe("You have 4 of 5");
    expect(card.querySelector("[data-raffle-sold]").textContent).toBe("11 tickets sold");
    expect(buy.dataset.raffleRemaining).toBe("1");
    expect(window.document.querySelector('[data-credit-balance="25"]')).toBeTruthy();
    expect(window.document.getElementById("yr-raffle-status").textContent).toContain("Bought 3 tickets");
    expect(buy.dataset.raffleKey).toBeUndefined();
  });
});
