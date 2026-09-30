import { afterAll, afterEach, describe, expect, it } from "bun:test";
import {
  actAndFlush,
  clickReactTarget,
  document,
  mountRewardsPage,
  restoreRewardsDomGlobals,
  setReactInputValue,
  submitReactForm,
  unmountRewardsPage,
  window,
} from "./rewards-react-utils.js";

afterEach(unmountRewardsPage);
afterAll(restoreRewardsDomGlobals);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("React Rewards page", () => {
  it("shows the loader until status resolves, then reveals the page", async () => {
    const status = deferred();
    const { container } = await mountRewardsPage({
      tab: "overview",
      deps: { api: (path) => path === "/api/credits/status" ? status.promise : Promise.resolve({}) },
    });
    expect(container.hidden).toBe(true);
    expect(document.getElementById("cr-loading").hidden).toBe(false);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();

    await actAndFlush(() => status.resolve({}));
    expect(container.hidden).toBe(false);
    expect(document.getElementById("cr-loading").hidden).toBe(true);
    expect(container.querySelector("h1").textContent).toBe("Overview");
  });

  it("shows an actionable load error and retries the status request", async () => {
    let statusRequests = 0;
    const { container } = await mountRewardsPage({
      tab: "overview",
      deps: {
        api: async (path) => {
          if (path === "/api/credits/status" && statusRequests++ === 0) throw new Error("Temporary failure");
          return {};
        },
      },
    });
    expect(container.textContent).toContain("Couldn't load your credits dashboard");
    expect(container.textContent).toContain("Temporary failure");

    await clickReactTarget([...container.querySelectorAll("button")].find((button) => button.textContent === "Try again"));
    expect(statusRequests).toBe(2);
    expect(container.querySelector("h1").textContent).toBe("Overview");
  });

  it("uses the URL siteId and removes only OAuth query parameters", async () => {
    const calls = [];
    const { container } = await mountRewardsPage({
      tab: "channel",
      url: "http://localhost/dashboard/site/connections?siteId=site%20two&kick_connected=1&keep=1#credentials",
      deps: {
        api: async (path, options, siteId) => {
          calls.push({ path, options, siteId });
          return { channel: { connected: true, name: "sam", statusLabel: "Connected" } };
        },
      },
    });
    expect(calls[0].path).toBe("/api/credits/status");
    expect(calls[0].siteId).toBe("site two");
    expect(container.textContent).toContain("@sam on Kick");
    expect(container.textContent).toContain("Connected to @sam on Kick.");
    expect(window.location.search).toBe("?siteId=site+two&keep=1");
    expect(window.location.hash).toBe("#credentials");
  });

  it("saves daily check-in settings using the API payload shape", async () => {
    const calls = [];
    await mountRewardsPage({
      tab: "rules",
      deps: {
        api: async (path, options, siteId) => {
          calls.push({ path, options, siteId });
          return path === "/api/credits/earning-rules"
            ? { dailyCheckin: { active: false, amount: 125 } }
            : {};
        },
      },
    });
    const amount = document.getElementById("cr-checkin-amount");
    await setReactInputValue(amount, "125");
    await submitReactForm(document.querySelector("#cr-checkin form"));

    const save = calls.find((call) => call.path === "/api/credits/earning-rules" && call.options?.method === "PUT");
    expect(save.siteId).toBe("site-1");
    expect(JSON.parse(save.options.body)).toEqual({ dailyCheckin: { active: false, amount: 125 } });
  });

  it("keeps shop readiness feedback advisory and preserves the save payload", async () => {
    const calls = [];
    const { container } = await mountRewardsPage({
      tab: "shop",
      deps: {
        api: async (path, options, siteId) => {
          calls.push({ path, options, siteId });
          if (path === "/api/credits/status") {
            return {
              creatorContact: { ready: false },
              usage: { shopItems: 0 },
              limits: { shopItems: 10 },
              shopItems: [],
            };
          }
          return {};
        },
      },
    });
    await clickReactTarget(document.getElementById("cr-shop-new"));
    expect(document.body.textContent).toContain("Before this goes live");
    await setReactInputValue(document.getElementById("cr-shop-name"), "VIP role");
    await setReactInputValue(document.getElementById("cr-shop-cost"), "100");
    await submitReactForm(document.querySelector(".cr-react-shop-dialog form"));

    const save = calls.find((call) => call.path === "/api/credits/shop" && call.options?.method === "POST");
    expect(save.siteId).toBe("site-1");
    expect(JSON.parse(save.options.body)).toEqual({
      name: "VIP role",
      description: "",
      cost: 100,
      stock: null,
      cooldownSeconds: 0,
      active: true,
    });
    expect(container.textContent).not.toContain("You must add a contact method");
  });

  it("uses server-authorized claim actions and sends the transition contract", async () => {
    const calls = [];
    await mountRewardsPage({
      tab: "redemptions",
      deps: {
        api: async (path, options, siteId) => {
          calls.push({ path, options, siteId });
          if (path.startsWith("/api/claims?")) {
            return {
              claims: [{
                id: "redemption:claim-1",
                status: "submitted",
                statusLabel: "Needs review",
                allowedActions: ["complete"],
                subject: { displayName: "Member One" },
                reward: { name: "VIP role", cost: 100 },
                source: { id: "claim-1" },
              }],
              page: { hasMore: false, nextCursor: null },
              total: 1,
            };
          }
          return {};
        },
      },
    });
    expect(document.body.textContent).toContain("Needs review");
    expect([...document.querySelectorAll("button")].some((button) => button.textContent === "Cancel")).toBe(false);
    await clickReactTarget([...document.querySelectorAll("button")].find((button) => button.textContent === "Complete"));
    await clickReactTarget([...document.querySelectorAll("button")].find((button) => button.textContent === "Complete claim"));

    const transition = calls.find((call) => call.path === "/api/claims/redemption%3Aclaim-1/transition");
    expect(transition.siteId).toBe("site-1");
    expect(JSON.parse(transition.options.body)).toEqual({ action: "complete", expectedStatus: "submitted" });
  });
});
