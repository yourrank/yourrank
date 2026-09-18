import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

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
