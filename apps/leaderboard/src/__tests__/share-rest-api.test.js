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

// Fake the board-scoped key-management endpoints the Share UI talks to.
const server = { keys: [], requests: [], created: 0 };
globalThis.fetch = async (url, init = {}) => {
  const path = String(url);
  const method = init.method || "GET";
  server.requests.push({ path, method });
  const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const boardKey = (id, key) => ({ id, scope: "board", label: "kick-cup", createdAt: "2026-01-01T00:00:00Z", lastUsedAt: null, expiresAt: null, key });
  if (path === "/api/sites/site-1/api-keys") {
    if (method === "POST") {
      server.created += 1;
      const key = boardKey(`key-board-${server.created}`, `pk_board_${server.created}`);
      server.keys = [...server.keys.filter((entry) => entry.scope !== "board"), key];
      return reply({ ok: true, key });
    }
    return reply({ ok: true, keys: server.keys });
  }
  const rotateMatch = path.match(/^\/api\/sites\/site-1\/api-keys\/([^/]+)\/rotate$/);
  if (rotateMatch && method === "POST") {
    server.created += 1;
    const key = boardKey(`key-board-rot-${server.created}`, `pk_rotated_${server.created}`);
    server.keys = server.keys.map((entry) => (entry.id === rotateMatch[1] ? key : entry));
    return reply({ ok: true, key });
  }
  const deleteMatch = path.match(/^\/api\/sites\/site-1\/api-keys\/([^/]+)$/);
  if (deleteMatch && method === "DELETE") {
    server.keys = server.keys.filter((entry) => entry.id !== deleteMatch[1]);
    return reply({ ok: true });
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
    expect((await handleAccountPostbacksRotate(rotateReq(), {}, free.deps)).status).toBe(403);
    expect(free.calls.create).toEqual([]);
  });

  it("/api/scores keeps authorizing Pro and Team with signed postback keys", () => {
    expect(scoresJs).toContain('assertFeature(plan, "signed_api")');
    expect(scoresJs).toContain('request.headers.get("x-postback-key")');
    expect(scoresJs).toContain('request.headers.get("x-postback-signature")');
    expect(scoresJs).toContain("verifyHmacSha256Hex(postbackKey, rawBody, signature)");
  });
});

const accountKey = (key = "pk_account") => ({ id: "key-account", scope: "account", label: "account", createdAt: "2026-01-01T00:00:00Z", lastUsedAt: null, expiresAt: null, key });
const boardKeyRow = (id = "key-board-1", key = "pk_board_1") => ({ id, scope: "board", label: "kick-cup", createdAt: "2026-01-01T00:00:00Z", lastUsedAt: null, expiresAt: null, key });
const keyRows = () => [...document.querySelectorAll("#apiKeyList .api-key-row")];
const rowButton = (row, text) => [...row.querySelectorAll("button")].find((b) => b.textContent === text);

describe("REST API in Developer tools (dashboard)", () => {
  beforeEach(() => {
    server.keys = [];
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
    expect(server.requests).toEqual([{ method: "POST", path: "/api/billing/funnel" }]);
  });

  it("Pro lists the board's signing keys without auto-creating one", async () => {
    setPlan("pro");
    renderApiAccess();
    await settle();
    expect($("apiAccess").classList.contains("locked")).toBe(false);
    expect($("apiSetup").hidden).toBe(false);
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /api/sites/site-1/api-keys"]);
    expect($("apiKeyCreate").hidden).toBe(false);
  });

  it("Create board key posts a board-scoped key and renders it masked", async () => {
    setPlan("pro");
    renderApiAccess();
    await settle();
    $("apiKeyCreate").click();
    await settle();
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /api/sites/site-1/api-keys", "POST /api/sites/site-1/api-keys"]);
    const rows = keyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector(".api-key-scope").textContent).toBe("This board");
    const value = rows[0].querySelector(".api-key");
    expect(value.dataset.masked).toBe("1");
    expect(value.textContent).not.toContain("pk_board_1");
    expect($("apiKeyHint").textContent).toContain("Key created.");
    expect($("apiKeyCreate").hidden).toBe(true);
  });

  it("Team sees board and account keys with scope badges; account key links to Connections", async () => {
    server.keys = [boardKeyRow(), accountKey()];
    setPlan("team");
    renderApiAccess();
    await settle();
    expect(server.requests.map((r) => r.path)).toEqual(["/api/sites/site-1/api-keys"]);
    const rows = keyRows();
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".api-key-scope").textContent).toBe("This board");
    expect(rowButton(rows[0], "Rotate")).toBeTruthy();
    expect(rowButton(rows[0], "Revoke")).toBeTruthy();
    expect(rows[1].querySelector(".api-key-scope").textContent).toBe("Account · all boards");
    expect(rowButton(rows[1], "Rotate")).toBeFalsy();
    expect(rowButton(rows[1], "Revoke")).toBeFalsy();
    const manage = rows[1].querySelector("a");
    expect(manage.getAttribute("href")).toBe("/dashboard/settings/connections");
    expect(manage.textContent).toBe("Manage in Connections");
  });

  it("a board key stays masked until revealed and copies the raw key", async () => {
    server.keys = [boardKeyRow()];
    setPlan("team");
    renderApiAccess();
    await settle();
    const row = keyRows()[0];
    const value = row.querySelector(".api-key");
    expect(value.textContent).not.toContain("pk_board_1");
    rowButton(row, "Reveal").click();
    expect(value.textContent).toBe("pk_board_1");
    expect(rowButton(row, "Hide")).toBeTruthy();
    rowButton(row, "Copy").click();
    await settle();
    expect(clipboard).toEqual(["pk_board_1"]);
  });

  it("Rotate confirms, calls the rotate endpoint and re-masks the new key", async () => {
    server.keys = [boardKeyRow()];
    setPlan("team");
    renderApiAccess();
    await settle();
    let row = keyRows()[0];
    rowButton(row, "Reveal").click();
    expect(row.querySelector(".api-key").textContent).toBe("pk_board_1");
    window.YRDialog = { confirm: async () => true };
    rowButton(row, "Rotate").click();
    await settle();
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /api/sites/site-1/api-keys", "POST /api/sites/site-1/api-keys/key-board-1/rotate"]);
    row = keyRows()[0];
    expect(row.querySelector(".api-key").dataset.masked).toBe("1");
    rowButton(row, "Reveal").click();
    expect(row.querySelector(".api-key").textContent).toBe("pk_rotated_1");
  });

  it("Revoke confirms, deletes the key and brings back Create board key", async () => {
    server.keys = [boardKeyRow()];
    setPlan("team");
    renderApiAccess();
    await settle();
    window.YRDialog = { confirm: async () => true };
    rowButton(keyRows()[0], "Revoke").click();
    await settle();
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /api/sites/site-1/api-keys", "DELETE /api/sites/site-1/api-keys/key-board-1"]);
    expect(keyRows()).toHaveLength(0);
    expect($("apiKeyCreate").hidden).toBe(false);
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
  it("exposes both endpoints, the API signing key and the documentation link", () => {
    const start = jsx.indexOf('id="apiAccessDetails"');
    const block = jsx.slice(start, jsx.indexOf("</details>", start));
    expect(block).toContain('<b class="font-14">REST API</b>');
    expect(block).toContain("Use the API to update leaderboard scores from your own system.");
    expect(block).toContain("POST /api/scores");
    expect(block).toContain("PATCH /api/scores");
    expect(block).toContain("Replace player list");
    expect(block).toContain("Update players");
    expect(block).toContain("Use the bulk endpoint to replace a leaderboard or the incremental endpoint to update individual players.");
    expect(block).toContain("API signing key");
    for (const id of ["apiKeyList", "apiKeyCreate", "apiDocsLink"]) {
      expect(block).toContain(`id="${id}"`);
    }
    expect(block).toContain('href="/docs/api"');
    expect(block).not.toContain("Postback key");
    expect(block).not.toContain("X-Postback-Key");
    expect(block).not.toContain("X-Postback-Signature");
    expect(block).not.toContain("> Pro</span>");
  });
});
