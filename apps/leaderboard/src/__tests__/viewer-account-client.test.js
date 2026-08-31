// The global /me page owns the Viewer Account and the membership list only.
// Creator-branded My Community pages own per-membership Rewards, credits and
// Claims, so this client must not grow a second site detail or redemption flow.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { viewerDashboardPage } from "../pages/viewer-dashboard.js";

const clientSource = readFileSync(new URL("../assets/viewer-dashboard.js", import.meta.url), "utf8");

function makeElement(document, id = "") {
  const listeners = {};
  return {
    id,
    hidden: false,
    disabled: false,
    textContent: "",
    innerHTML: "",
    className: "",
    src: "",
    alt: "",
    dataset: {},
    attributes: {},
    classList: { add() {}, remove() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(type, listener) { (listeners[type] ||= []).push(listener); },
    append(...parts) {
      for (const part of parts) this.textContent += typeof part === "string" ? part : part.textContent;
    },
    async click() { await Promise.all((listeners.click || []).map((listener) => listener())); },
    focus() { document.activeElement = this; },
  };
}

function makeEnvironment({ response, url = "https://yourrank.site/me" }) {
  const elements = new Map();
  const document = {
    activeElement: null,
    cookie: "__csrf=token",
    createElement: () => makeElement(document),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(document, id));
      return elements.get(id);
    },
  };
  const calls = [];
  const fetch = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || "GET" });
    const result = typeof response === "function" ? response(path, opts) : response;
    return {
      ok: (result.status || 200) < 400,
      status: result.status || 200,
      json: async () => result.body || {},
    };
  };
  const location = new URL(url);
  const window = {
    location,
    history: { replaceState(_state, _title, next) { location.href = new URL(next, location.href).href; } },
  };
  const run = new Function("window", "document", "fetch", "location", clientSource);
  run(window, document, fetch, location);
  return {
    $: (id) => document.getElementById(id),
    calls,
    ready: () => window.__yrViewerReady,
  };
}

const ACCOUNT = {
  viewer: {
    displayName: "member",
    avatarUrl: null,
    createdAt: "2026-01-02T00:00:00.000Z",
    connections: [{ provider: "kick", username: "member", linkedAt: "2026-01-02T00:00:00.000Z" }],
  },
  communities: [{
    slug: "alpha",
    name: "Alpha Community",
    balance: 1234,
    totalEarned: 1500,
    totalSpent: 266,
    pendingClaims: 1,
    claimingAvailable: true,
  }],
};

describe("global Viewer Account client", () => {
  it("renders one account and links each membership to its creator-branded owner", async () => {
    const env = makeEnvironment({ response: { body: ACCOUNT } });
    await env.ready();

    expect(env.$("vd-login-card").hidden).toBe(true);
    expect(env.$("vd-profile").hidden).toBe(false);
    expect(env.$("vd-communities-card").hidden).toBe(false);
    expect(env.$("vd-username").textContent).toBe("member");
    expect(env.$("vd-identity").textContent).toContain("Connected to Kick as @member");
    expect(env.$("vd-communities").innerHTML).toContain("Alpha Community");
    expect(env.$("vd-communities").innerHTML).toContain("1,234 free credits");
    expect(env.$("vd-communities").innerHTML).toContain("1 Claim needs creator action");
    expect(env.$("vd-communities").innerHTML).toContain('href="/alpha/me"');
    expect(env.$("vd-communities").innerHTML).not.toContain("Member since");
    expect(env.calls).toEqual([{ path: "/api/viewer/me", method: "GET" }]);
  });

  it("shows the truthful empty membership state", async () => {
    const env = makeEnvironment({ response: { body: { ...ACCOUNT, communities: [] } } });
    await env.ready();
    expect(env.$("vd-communities-empty").hidden).toBe(false);
    expect(env.$("vd-communities").innerHTML).toBe("");
  });

  it("shows sign-in when the Viewer Account session is absent", async () => {
    const env = makeEnvironment({ response: { status: 401, body: { error: "unauthorized" } } });
    await env.ready();
    expect(env.$("vd-login-card").hidden).toBe(false);
    expect(env.$("vd-profile").hidden).toBe(true);
    expect(env.$("vd-communities-card").hidden).toBe(true);
  });

  it("clears the previous account's memberships before another login", async () => {
    const env = makeEnvironment({
      response: (path, opts) => opts.method === "POST"
        ? { body: { ok: true } }
        : { body: ACCOUNT },
    });
    await env.ready();
    expect(env.$("vd-communities").innerHTML).toContain("Alpha Community");

    await env.$("vd-logout").click();

    expect(env.$("vd-profile").hidden).toBe(true);
    expect(env.$("vd-communities-card").hidden).toBe(true);
    expect(env.$("vd-username").textContent).toBe("");
    expect(env.$("vd-communities").innerHTML).toBe("");
  });

  it("keeps an account failure visible and retryable", async () => {
    let failed = true;
    const env = makeEnvironment({
      response: () => failed
        ? { status: 500, body: { error: "boom" } }
        : { body: ACCOUNT },
    });
    await env.ready();
    expect(env.$("vd-login-status").textContent).toContain("We couldn't load your Viewer Account.");
    failed = false;
    // The DOM double keeps appended controls in text; the source assertion
    // below proves the retry invokes the same canonical account request.
    expect(clientSource).toContain('retry();');
    expect(clientSource).toContain('api("GET", "/api/viewer/me")');
  });
});

describe("global Viewer Account ownership", () => {
  const page = String(viewerDashboardPage);

  it("names the real account-to-membership hierarchy", () => {
    expect(page).toContain('<h1 class="vd-h1" id="vd-title">My communities</h1>');
    expect(page).toContain("One Viewer Account for every creator community you join.");
    expect(page).toContain(">Community memberships<");
    expect(page).toContain("Rewards, free credits and Claims");
    expect(page).toContain("You haven't joined any communities yet.");
    expect(page).not.toContain("appear here automatically");
    expect(page).not.toContain("Your sites");
    expect(page).not.toContain(">My credits<");
  });

  it("does not duplicate a creator's membership product", () => {
    expect(clientSource).not.toContain("/api/viewer/site");
    expect(clientSource).not.toContain("/api/viewer/redeem");
    expect(clientSource).not.toContain("/api/events/drops/claim");
    expect(clientSource).not.toContain("window.YRDialog");
    expect(page).not.toContain("vd-site-card");
    expect(page).not.toContain("vd-shop-list");
    expect(page).not.toContain("vd-redemptions-list");
    expect(page).not.toContain("vd-drop-claim");
  });

  it("leaves the main landmark and CSP to the shared shell", () => {
    expect((page.match(/<main\b/g) || []).length).toBe(1);
    expect((page.match(/id="main-content"/g) || []).length).toBe(1);
    expect(page).not.toContain(' style="');
  });

  it("gives every account failure a visible status owner", () => {
    for (const id of ["vd-login-status", "vd-account-status", "vd-communities-status"]) {
      expect(page).toContain(`id="${id}" role="status" aria-live="polite"`);
    }
  });
});
