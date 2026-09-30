import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import { ServerListController } from "../assets/dashboard/server-list.js";
import { kickDeliveryPresentation } from "../assets/kick-delivery-presentation.js";
import { adjustMemberCredits } from "../react/pages/audience/page.tsx";

const audiencePageTsx = readFileSync(new URL("../react/pages/audience/page.tsx", import.meta.url), "utf8");
const audiencePageHtml = readFileSync(new URL("../pages/audience.jsx", import.meta.url), "utf8");
const creditsHandlerJs = readFileSync(new URL("../handlers/credits.js", import.meta.url), "utf8");
const peopleHandlerJs = readFileSync(new URL("../handlers/people.js", import.meta.url), "utf8");
const routesJs = readFileSync(new URL("../routes.js", import.meta.url), "utf8");

describe("credit adjustment retry identity", () => {
  it("retains the same operation across a lost response and reload, then issues a fresh operation", async () => {
    const stored = new Map();
    const sessionStorage = {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    };
    const calls = [];
    let fail = true;
    let uuid = 0;
    const deps = {
      api: async (path, options, siteId) => {
        calls.push({ path, options, siteId });
        if (fail) throw new Error("response lost");
        return { ok: true };
      },
      getSessionStorage: () => sessionStorage,
      randomUUID: () => `operation-${++uuid}`,
    };
    const adjust = () => adjustMemberCredits(deps, "site-1", "member-1", 25, "adjustment");
    await expect(adjust()).rejects.toThrow("response lost");
    fail = false;
    await adjust();
    await adjust();

    const storageKey = 'yr:credit-adjustment:["site-1","member-1",25,"adjustment"]';
    expect(calls.map((call) => call.path)).toEqual([
      "/api/credits/viewers/member-1/balance",
      "/api/credits/viewers/member-1/balance",
      "/api/credits/viewers/member-1/balance",
    ]);
    expect(calls.map((call) => JSON.parse(call.options.body).operationId)).toEqual([
      "operation-1",
      "operation-1",
      "operation-2",
    ]);
    expect(calls.every((call) => call.siteId === "site-1")).toBe(true);
    expect(stored.has(storageKey)).toBe(false);
  });
});

describe("viewer membership display", () => {
  it("shows site membership and authenticated connection state without raw IDs", () => {
    expect(audiencePageTsx).toContain("memberDetail.lastSeenAt || memberDetail.lastCreditAt");
    expect(audiencePageTsx).toContain("member.linkedIdentities");
    expect(audiencePageTsx).toContain("member.avatarUrl");
    expect(audiencePageTsx).toContain("function memberIdentity(member: Member)");
    expect(audiencePageTsx).toContain('member.displayName || "Unnamed member"');
    expect(audiencePageTsx).toContain("No signed-in account");
    expect(audiencePageTsx).toContain("No leaderboard player or subscriber record is assumed");
    expect(audiencePageHtml).toContain('id="audience-app" data-audience-tab={tab}');
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
    const guard = audiencePageTsx.match(/function requestIsCurrent\([\s\S]*?\n\}/)?.[0] || "";
    expect(guard).toContain("ticket === currentTicket");
    expect(guard).toContain("siteId === activeSiteId");
    expect(guard).toContain("!querySiteId || querySiteId === siteId");
    expect(audiencePageTsx).toContain("memberSelectionRef.current.clear();");
    expect(audiencePageTsx).toContain("setMembers([]);");
  });

  it("cannot manufacture a member by entering a matching username", () => {
    expect(audiencePageTsx).not.toContain('id="cr-tip-open-btn"');
    expect(audiencePageTsx).toContain('id="cr-tip-username" name="username" type="text" readOnly');
    expect(audiencePageTsx).toContain('`/api/credits/viewers/${encodeURIComponent(id)}/balance`');
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
