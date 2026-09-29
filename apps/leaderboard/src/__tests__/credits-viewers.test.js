import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import { ServerListController } from "../assets/dashboard/server-list.js";
import { kickDeliveryPresentation } from "../assets/kick-delivery-presentation.js";

const creditsJs = readFileSync(new URL("../assets/credits.js", import.meta.url), "utf8");
const creditsPagesJs = readFileSync(new URL("../pages/credits-pages.js", import.meta.url), "utf8");
const creditsHandlerJs = readFileSync(new URL("../handlers/credits.js", import.meta.url), "utf8");
const peopleHandlerJs = readFileSync(new URL("../handlers/people.js", import.meta.url), "utf8");
const routesJs = readFileSync(new URL("../routes.js", import.meta.url), "utf8");

describe("credit adjustment retry identity", () => {
  it("retains the same operation across a lost response and reload, then issues a fresh operation", async () => {
    const source = creditsJs.slice(creditsJs.indexOf("async function adjustMemberCredits("), creditsJs.indexOf("let state = {};"));
    const stored = new Map();
    const sessionStorage = { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) };
    const calls = [];
    let fail = true;
    const api = async (_method, _path, payload) => {
      calls.push(payload);
      if (fail) throw new Error("response lost");
      return { ok: true };
    };
    const load = () => new Function("sessionStorage", "api", "sitePath", "crypto", "activeSiteId", `${source}; return adjustMemberCredits;`)(sessionStorage, api, (path) => path, crypto, "site-1");
    await expect(load()("member-1", 25, "adjustment")).rejects.toThrow("response lost");
    fail = false;
    await load()("member-1", 25, "adjustment");
    await load()("member-1", 25, "adjustment");
    expect(calls[0].operationId).toBe(calls[1].operationId);
    expect(calls[2].operationId).not.toBe(calls[1].operationId);
  });
});

describe("viewer membership display", () => {
  it("shows site membership and authenticated connection state without raw IDs", () => {
    expect(creditsJs).toContain("v.lastSeenAt || v.lastCreditAt");
    expect(creditsJs).not.toContain("joinedAt");
    expect(creditsJs).not.toContain("Member since");
    expect(creditsJs).toContain("v.linkedIdentities");
    expect(creditsJs).toContain("v.avatarUrl");
    expect(creditsJs).toContain("function viewerIdentity(");
    expect(creditsJs).toContain('v.displayName || "Unnamed member"');
    expect(creditsJs).toContain("No signed-in account");
    expect(creditsJs).toContain("No leaderboard player or subscriber record is assumed");
    expect(creditsPagesJs).toContain("Members in the selected site");
    expect(peopleHandlerJs).toContain('${viewerIdentitiesSql("v")} AS identities');
    expect(peopleHandlerJs).not.toMatch(/v\.kick_user_id|v\.discord_user_id|v\.kick_username|v\.discord_username|fraud_score/);
  });

  it("clears previous-site members and ignores an in-flight list response", async () => {
    const window = new Window({ url: "http://localhost/dashboard/rewards" });
    const previousDocument = globalThis.document;
    globalThis.document = window.document;
    try {
      const root = document.createElement("div");
      root.innerHTML = '<table><tbody><tr><td>Old site member</td></tr></tbody></table>';
      document.body.append(root);
      const tbody = root.querySelector("tbody");
      let resolvePage;
      const controller = new ServerListController({
        root,
        tbody,
        fetchPage: () => new Promise((resolve) => { resolvePage = resolve; }),
        renderItem: () => "<td>Old site member</td>",
      });

      const reload = controller.reload();
      const request = controller.request;
      controller.clear();
      resolvePage({ items: [{ id: "old-member" }], page: { hasMore: false }, total: 1 });
      await reload;

      expect(controller.request).toBe(request + 1);
      expect(controller.items).toEqual([]);
      expect(tbody.innerHTML).toBe("");
    } finally {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
    }
  });

  it("clears cached members on site changes and guards late fetches by site id", () => {
    const fetchSource = creditsJs.slice(creditsJs.indexOf("function fetchMembersPage("), creditsJs.indexOf("function syncSelectAll("));
    expect(fetchSource).toContain("const requestSiteId = siteQuery() || dashboardState.ACTIVE_SITE_ID || activeSiteId;");
    expect(fetchSource).toContain("if (requestSiteId !== (siteQuery() || dashboardState.ACTIVE_SITE_ID || activeSiteId))");
    expect(fetchSource.indexOf("if (requestSiteId")).toBeLessThan(fetchSource.indexOf("state.members ="));
    expect(creditsJs).toContain("state.members = [];");
    expect(creditsJs).toContain("viewerCtrl?.clear();");
  });

  it("cannot manufacture a member by entering a matching username", () => {
    expect(creditsPagesJs).not.toContain('id="cr-tip-open-btn"');
    expect(creditsPagesJs).toContain('id="cr-tip-username" name="username" type="text" readonly');
    expect(creditsJs).not.toContain('sitePath("/api/credits/tip")');
    expect(routesJs).toContain('{ path: "/api/credits/tip"');
    expect(creditsHandlerJs).toContain("v.kick_linked_at IS NOT NULL");
    expect(creditsHandlerJs).toContain("JOIN viewers v ON v.id = sv.viewer_id");
    expect(creditsHandlerJs).not.toContain("INSERT INTO viewers (kick_username, kick_user_id)");
    expect(creditsHandlerJs).not.toContain("ON CONFLICT (site_id, viewer_id) DO UPDATE SET updated_at = now()");
  });
});

describe("Kick delivery presentation", () => {
  it("describes partial delivery and preserves terminal labels", () => {
    expect(kickDeliveryPresentation({
      connected: true,
      delivery: {
        verified: false,
        events: { rewardEvents: "unverified", chatEvents: "subscribed" },
        required: ["rewardEvents"],
        requiredLabels: ["reward redemption events"],
      },
    })).toEqual({
      label: "Receiving events",
      detail: "Waiting for the first reward redemption events",
    });
    expect(kickDeliveryPresentation({ connected: false }).label).toBe("—");
    expect(kickDeliveryPresentation({ connected: true, deliveryFailed: true }).label).toBe("Setup failed");
    expect(kickDeliveryPresentation({ connected: true, status: "needs_attention" }).label).toBe("Blocked by authorization");
    expect(kickDeliveryPresentation({
      connected: true,
      delivery: { verified: true, events: { chatEvents: "subscribed" }, required: [], requiredLabels: [] },
    }).label).toBe("Verified");
    expect(kickDeliveryPresentation({
      connected: true,
      delivery: { verified: false, events: { rewardEvents: "unverified", chatEvents: "unverified" }, required: ["rewardEvents"], requiredLabels: ["reward redemption events"] },
    }).label).toBe("Waiting for first event");
  });
});
