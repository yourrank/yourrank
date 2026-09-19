// Share → Developer tools → REST API. The dashboard reuses the account
// postback-key infrastructure (postback_keys, getActivePostbackKey,
// createPostbackKey with revokeOthers) and unlocks it for both Pro and Team.
//
// Run: bun test src/__tests__/share-rest-api.test.js

import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { DashboardContent } from "../pages/dashboard.jsx";
import { handleAccountPostbacks, handleAccountPostbacksRotate } from "../handlers/account.js";

const window = new Window({ url: "http://localhost/dashboard/leaderboard/share" });
const { document } = window;
for (const key of ["window", "document", "location", "history", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "DOMParser", "getComputedStyle"]) {
  globalThis[key] = key === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[key];
}
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
window.Element.prototype.getClientRects = function () { return [{}]; };

// Fake the two postback endpoints the Share UI talks to.
const server = { activeKey: null, requests: [], created: 0 };
globalThis.fetch = async (url, init = {}) => {
  const path = String(url);
  server.requests.push({ path, method: init.method || "GET" });
  const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (path === "/api/account/postbacks") {
    return reply({ ok: true, postback: server.activeKey ? { key: server.activeKey } : null, canRotate: true });
  }
  if (path === "/api/account/postbacks/rotate") {
    server.created += 1;
    server.activeKey = `pk_rotated_${server.created}`;
    return reply({ ok: true, postback: { key: server.activeKey } });
  }
  return reply({ ok: true });
};
const clipboard = [];
Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (text) => { clipboard.push(text); } }, configurable: true });
Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });

document.body.innerHTML = DashboardContent({ user: { email: "creator@example.com", plan: "team" }, activePath: "/dashboard/leaderboard/share" }).toString();
document.getElementById("dash").hidden = false;
document.querySelector('section[data-page="board"]').classList.add("is-on");

const { state } = await import("../assets/dashboard/state.js");
const { canManageApiKey, isPro, renderApiAccess } = await import("../assets/dashboard/site.js");

const jsx = readFileSync(new URL("../pages/dashboard.jsx", import.meta.url), "utf8");
const scoresJs = readFileSync(new URL("../handlers/scores.js", import.meta.url), "utf8");
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const $ = (id) => document.getElementById(id);

function setPlan(plan, role = "owner") {
  Object.assign(state, {
    ACTIVE_SITE_ID: "site-1",
    SLUG: "kick-cup",
    BOARDS: [{ id: "site-1", name: "Kick Cup", published: true, userRole: role }],
    ME: { plan, emailVerified: true },
  });
}

const future = Date.now() + 86_400_000 * 30;
const userFor = (plan) => ({ id: "user-1", plan, plan_expires_at: plan === "free" ? null : future, status: "active" });

function handlerDeps(user, { activeKey = null } = {}) {
  const calls = { get: 0, create: [] };
  return {
    calls,
    deps: {
      requireUser: async () => ({ user, res: null }),
      rateLimit: async () => ({ ok: true }),
      getActivePostbackKey: async () => { calls.get += 1; return activeKey; },
      loadActivePostbackStatus: async () => ({ created_at: "2026-01-01T00:00:00Z", last_used_at: null }),
      loadConversions: async () => [],
      createPostbackKey: async (ownerId, opts) => { calls.create.push({ ownerId, opts }); return "pk_new_key"; },
    },
  };
}
const getReq = () => new Request("https://yourrank.site/api/account/postbacks");
const rotateReq = () => new Request("https://yourrank.site/api/account/postbacks/rotate", { method: "POST" });

describe("REST API entitlement (server)", () => {
  it("GET /api/account/postbacks returns the existing key for Pro and Team", async () => {
    for (const plan of ["pro", "team"]) {
      const { deps, calls } = handlerDeps(userFor(plan), { activeKey: "pk_existing" });
      const res = await handleAccountPostbacks(getReq(), {}, deps);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.postback.key).toBe("pk_existing");
      expect(body.canRotate).toBe(true);
      expect(calls.get).toBe(1);
    }
  });

  it("GET /api/account/postbacks stays locked for Free without touching keys", async () => {
    const { deps, calls } = handlerDeps(userFor("free"));
    const body = await (await handleAccountPostbacks(getReq(), {}, deps)).json();
    expect(body).toEqual({ ok: true, postback: null, upgrade: true, canRotate: false, conversions: [] });
    expect(calls.get).toBe(0);
  });

  it("rotation creates a new key that revokes the previous active one", async () => {
    for (const plan of ["pro", "team"]) {
      const { deps, calls } = handlerDeps(userFor(plan));
      const body = await (await handleAccountPostbacksRotate(rotateReq(), {}, deps)).json();
      expect(body.postback.key).toBe("pk_new_key");
      expect(calls.create).toEqual([{ ownerId: "user-1", opts: { label: "account", revokeOthers: true } }]);
    }
    const free = handlerDeps(userFor("free"));
    expect((await handleAccountPostbacksRotate(rotateReq(), {}, free.deps)).status).toBe(402);
    expect(free.calls.create).toEqual([]);
  });

  it("/api/scores keeps authorizing Pro and Team with signed postback keys", () => {
    expect(scoresJs).toContain('if (plan !== "pro" && plan !== "team") return bad("The signed score API requires Pro or Team.", 403);');
    expect(scoresJs).toContain('request.headers.get("x-postback-key")');
    expect(scoresJs).toContain('request.headers.get("x-postback-signature")');
    expect(scoresJs).toContain("verifyHmacSha256Hex(postbackKey, rawBody, signature)");
  });
});

describe("REST API in Developer tools (dashboard)", () => {
  beforeEach(() => {
    server.activeKey = null;
    server.requests.length = 0;
    server.created = 0;
    clipboard.length = 0;
    $("apiAccessDetails").open = true;
  });

  it("isPro() unlocks Pro and Team and locks Free", () => {
    for (const [plan, expected] of [["pro", true], ["team", true], ["free", false]]) {
      setPlan(plan);
      expect(isPro()).toBe(expected);
    }
  });

  it("Free stays locked with the Pro & Team copy and no key controls", () => {
    setPlan("free");
    renderApiAccess();
    expect($("apiAccess").classList.contains("locked")).toBe(true);
    expect($("apiLockedNote").hidden).toBe(false);
    expect($("apiLockedNote").textContent).toContain("Available on Pro and Team.");
    expect($("apiLockBadge").textContent.trim()).toBe("Pro & Team");
    expect($("apiSetup").hidden).toBe(true);
    expect(server.requests).toEqual([]);
  });

  it("Pro creates a key through the rotate endpoint when none exists yet", async () => {
    setPlan("pro");
    renderApiAccess();
    await settle();
    expect($("apiAccess").classList.contains("locked")).toBe(false);
    expect($("apiSetup").hidden).toBe(false);
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /api/account/postbacks", "POST /api/account/postbacks/rotate"]);
    expect($("apiKeyValue").dataset.masked).toBe("1");
    expect($("apiKeyHint").textContent).toContain("Key created.");
  });

  it("Team reuses the existing postback key, masked until revealed, and copies the raw key", async () => {
    server.activeKey = "pk_existing_team";
    setPlan("team");
    renderApiAccess();
    await settle();
    expect($("apiAccess").classList.contains("locked")).toBe(false);
    expect($("apiSetup").hidden).toBe(false);
    expect($("apiLockedNote").hidden).toBe(true);
    expect(server.requests.map((r) => r.path)).toEqual(["/api/account/postbacks"]);
    expect($("apiKeyValue").textContent).not.toContain("pk_existing_team");
    expect($("apiKeyValue").dataset.masked).toBe("1");
    $("apiKeyReveal").click();
    expect($("apiKeyValue").textContent).toBe("pk_existing_team");
    expect($("apiKeyReveal").textContent).toBe("Hide");
    $("apiKeyCopy").click();
    await settle();
    expect(clipboard).toEqual(["pk_existing_team"]);
  });

  it("Rotate key confirms, calls the rotate endpoint and re-masks the new key", async () => {
    server.activeKey = "pk_before";
    setPlan("team");
    renderApiAccess();
    await settle();
    $("apiKeyReveal").click();
    expect($("apiKeyValue").textContent).toBe("pk_before");
    window.YRDialog = { confirm: async () => true };
    $("apiKeyRotate").click();
    await settle();
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /api/account/postbacks", "POST /api/account/postbacks/rotate"]);
    expect($("apiKeyValue").dataset.masked).toBe("1");
    $("apiKeyReveal").click();
    expect($("apiKeyValue").textContent).toBe("pk_rotated_1");
  });

  it("a moderator on a Team board never sees the raw key", () => {
    setPlan("team", "moderator");
    expect(canManageApiKey()).toBe(false);
    renderApiAccess();
    expect($("apiAccess").classList.contains("locked")).toBe(false);
    expect($("apiSetup").hidden).toBe(true);
    expect($("apiRoleNote").hidden).toBe(false);
    setPlan("team", "owner");
    expect(canManageApiKey()).toBe(true);
  });
});

describe("Developer tools markup", () => {
  it("exposes the compact REST API setup and the documentation link", () => {
    const start = jsx.indexOf('id="apiAccessDetails"');
    const block = jsx.slice(start, jsx.indexOf("</details>", start));
    expect(block).toContain('<b class="font-14">REST API</b>');
    expect(block).toContain("Use the API to update leaderboard scores from your own system.");
    expect(block).toContain("POST /api/scores");
    for (const id of ["apiKeyValue", "apiKeyReveal", "apiKeyCopy", "apiKeyRotate", "apiDocsLink"]) {
      expect(block).toContain(`id="${id}"`);
    }
    expect(block).toContain('href="/api/docs"');
    expect(block).toContain("X-Postback-Key");
    expect(block).toContain("X-Postback-Signature");
    expect(block).toContain("HMAC-SHA256");
    expect(block).not.toContain("> Pro</span>");
  });
});
