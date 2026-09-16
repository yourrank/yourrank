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
    get href() { return this.attributes.href; },
    classList: { add() {}, remove() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(type, listener) { (listeners[type] ||= []).push(listener); },
    append(...parts) {
      for (const part of parts) this.textContent += typeof part === "string" ? part : part.textContent;
    },
    async click() { await Promise.all((listeners.click || []).map((listener) => listener())); },
    async submit() { await Promise.all((listeners.submit || []).map((listener) => listener({ preventDefault() {} }))); },
    focus() { document.activeElement = this; },
  };
}

function makeEnvironment({ response, url = "https://yourrank.site/me" }) {
  const elements = new Map();
  const navigation = [];
  const document = {
    activeElement: null,
    cookie: "__csrf=token",
    createElement: () => makeElement(document),
    querySelectorAll(selector) {
      if (selector === ".viewer-destinations a") return navigation;
      throw new Error(`Unhandled selector: ${selector}`);
    },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(document, id));
      return elements.get(id);
    },
  };
  for (const [id, hash] of [
    ["viewer-account-link", "vd-profile"],
    ["connections-link", "vd-connections"],
    ["notifications-link", "vd-notifications"],
    ["security-link", "vd-security"],
    ["data-link", "vd-data"],
  ]) {
    const link = document.getElementById(id);
    link.setAttribute("href", `/me#${hash}`);
    navigation.push(link);
  }
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
  const listeners = {};
  const window = {
    addEventListener(type, listener) { (listeners[type] ||= []).push(listener); },
    location,
    history: { replaceState(_state, _title, next) { location.href = new URL(next, location.href).href; } },
  };
  const run = new Function("window", "document", "fetch", "location", clientSource);
  run(window, document, fetch, location);
  return {
    $: (id) => document.getElementById(id),
    activeElement: () => document.activeElement,
    calls,
    location,
    navigation,
    navigateHash(hash) {
      location.hash = hash;
      for (const listener of listeners.hashchange || []) listener();
    },
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
    expect(env.$("vd-profile").hidden).toBe(true);
    expect(env.$("viewer-account-link").hidden).toBe(false);
    expect(env.$("vd-communities-card").hidden).toBe(false);
    expect(env.$("vd-username").textContent).toBe("member");
    expect(env.$("vd-identity").textContent).toContain("Connected to Kick as @member");
    expect(env.$("vd-communities").innerHTML).toContain("Alpha Community");
    expect(env.$("vd-communities").innerHTML).toContain("1,234 Credits");
    expect(env.$("vd-communities").innerHTML).toContain("1 Claim needs creator action");
    expect(env.$("vd-communities").innerHTML).toContain('href="/alpha"');
    expect(env.$("vd-communities").innerHTML).not.toContain("Member since");
    expect(env.calls).toEqual([{ path: "/api/viewer/me", method: "GET" }]);
  });

  it("shows the truthful empty membership state", async () => {
    const env = makeEnvironment({ response: { body: { ...ACCOUNT, communities: [] } } });
    await env.ready();
    expect(env.$("vd-communities-empty").hidden).toBe(false);
    expect(env.$("vd-communities").innerHTML).toBe("");
  });

  it("keeps the initial until an avatar loads and restores it after an image failure", async () => {
    const env = makeEnvironment({ response: { body: { ...ACCOUNT, viewer: { ...ACCOUNT.viewer, avatarUrl: "https://example.invalid/avatar.png" } } } });
    await env.ready();
    expect(env.$("vd-avatar").hidden).toBe(true);
    expect(env.$("vd-avatar-fallback").hidden).toBe(false);
    env.$("vd-avatar").onload();
    expect(env.$("vd-avatar").hidden).toBe(false);
    expect(env.$("vd-avatar-fallback").hidden).toBe(true);
    env.$("vd-avatar").onerror();
    expect(env.$("vd-avatar").hidden).toBe(true);
    expect(env.$("vd-avatar-fallback").hidden).toBe(false);
  });

  it("shows sign-in when the Viewer Account session is absent", async () => {
    const env = makeEnvironment({ response: { status: 401, body: { error: "unauthorized" } } });
    await env.ready();
    expect(env.$("vd-login-card").hidden).toBe(false);
    expect(env.$("viewer-account-link").hidden).toBe(true);
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
    expect(env.$("viewer-account-link").hidden).toBe(true);

    expect(env.activeElement()).toBe(env.$("vd-login-card"));
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

  it("selects each account section without showing another section or community balance", async () => {
    const env = makeEnvironment({ response: { body: ACCOUNT } });
    await env.ready();
    const sections = ["vd-profile", "vd-connections", "vd-notifications", "vd-security", "vd-data"];
    for (const section of sections) {
      env.navigateHash(section);
      expect(sections.filter(id => !env.$(id).hidden)).toEqual([section]);
      expect(env.$("vd-communities-card").hidden).toBe(true);
      const active = env.navigation.filter(link => link.attributes["aria-current"] === "page");
      expect(active.map(link => link.href)).toEqual([`/me#${section}`]);
      expect(env.activeElement()).toBe(env.$("vd-title"));
    }
    env.navigateHash("");
    expect(sections.every(id => env.$(id).hidden)).toBe(true);
    expect(env.$("vd-communities-card").hidden).toBe(false);
    expect(env.navigation.every(link => !link.attributes["aria-current"])).toBe(true);
    expect(env.$("viewer-communities-link").attributes["aria-current"]).toBe("page");
  });
});

describe("global Viewer Account ownership", () => {
  const page = viewerDashboardPage();

  it("offers a way back to the originating community without inventing a membership", () => {
    const html = viewerDashboardPage({ slug: "creator", name: "Creator <One>", href: "/creator" });
    expect(html).toContain('<a class="viewer-return" href="/creator">');
    expect(html).toContain('<a class="yr-sec-link vd-return" href="/creator">');
    expect(html).toContain("Creator &lt;One&gt;");
    expect(html).toContain('id="viewer-communities-link" href="/me?community=creator" aria-current="page"');
    expect(html).toContain('href="/me?community=creator#vd-profile"');
    expect(html).toContain('href="/api/viewer/auth/kick?returnTo=%2Fme%3Fcommunity%3Dcreator"');
    expect(html).toContain('href="/help/support?audience=viewer&amp;return=%2Fme%3Fcommunity%3Dcreator"');
    expect(html).toContain('<div id="vd-communities" class="vd-community-list"></div>');
    expect(html).toContain('id="vd-communities-card" hidden');
    expect(page).not.toContain("viewer-return");
    expect(page).toContain('href="/api/viewer/auth/kick"');
    expect(page).toContain('id="viewer-communities-link" href="/me" aria-current="page"');
  });

  it("names the real account-to-membership hierarchy", () => {
    expect(page).toContain('<h1 class="vd-h1" id="vd-title" tabindex="-1">My communities</h1>');
    expect(page).toContain("Your rewards and claims stay with each community.");
    expect(page).toContain(">Your memberships<");
    expect(page).toContain("Separate memberships, rewards and credit balances.");
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

  it("keeps the skip target on one content landmark outside the navigation", () => {
    expect((page.match(/<main\b/g) || []).length).toBe(1);
    expect((page.match(/id="main-content"/g) || []).length).toBe(1);
    expect(page).not.toContain(' style="');
    expect(page).toContain('<main class="viewer-main" id="main-content" tabindex="-1">');
    expect(page.indexOf('class="viewer-rail"')).toBeLessThan(page.indexOf('<main '));
  });

  it("gives every account failure a visible status owner", () => {
    for (const id of ["vd-login-status", "vd-account-status", "vd-communities-status"]) {
      expect(page).toContain(`id="${id}" role="status" aria-live="polite"`);
    }
  });

  it("uses one replacement material owner and puts memberships before account maintenance", () => {
    expect(page).not.toContain('/assets/devin-system.css');
    expect(page).toContain('Owner-supplied September 16 mockups');
    expect(page.indexOf('id="vd-communities-card"')).toBeLessThan(page.indexOf('id="vd-profile"'));
    expect(page).toContain('<summary>Manage your login</summary>');
    expect(page).not.toContain('href="/dashboard"');
    expect(page).not.toContain('class="viewer-context"');
  });
});

describe("viewer login recovery", () => {
  it("opens a named or pasted YourRank community from the directory without creating a membership", async () => {
    const env = makeEnvironment({ response: { body: { ...ACCOUNT, communities: [] } } });
    await env.ready();
    expect(env.$("vd-communities-empty").hidden).toBe(false);
    env.$("vd-community-name").value = " Atlas-Community ";
    await env.$("vd-open-community").submit();
    expect(env.location.pathname).toBe("/atlas-community");
    // Existing slugify truncates after trimming, so a stored slug can end in '-'.
    const truncatedSlug = "a".repeat(39) + "-";
    env.$("vd-community-name").value = truncatedSlug;
    await env.$("vd-open-community").submit();
    expect(env.location.pathname).toBe(`/${truncatedSlug}`);
    env.$("vd-community-name").value = "https://yourrank.site/atlas-community/shop";
    await env.$("vd-open-community").submit();
    expect(env.location.pathname).toBe("/atlas-community");
    expect(env.calls.every(call => call.method === "GET")).toBe(true);
  });

  it("rejects a URL or path entered as a community name", async () => {
    const env = makeEnvironment({ response: { body: { ...ACCOUNT, communities: [] } } });
    await env.ready();
    for (const invalid of ["https://other.example", "../dashboard", "alpha/me", ""]) {
      env.$("vd-community-name").value = invalid;
      await env.$("vd-open-community").submit();
      expect(env.location.pathname).toBe("/me");
      expect(env.$("vd-community-name").attributes["aria-invalid"]).toBe("true");
      expect(env.activeElement()).toBe(env.$("vd-community-name"));
    }
  });

  it("keeps a signed-out account deep link on a visible sign-in panel", async () => {
    const env = makeEnvironment({ url: "https://yourrank.site/me#vd-profile", response: { status: 401, body: { error: "unauthorized" } } });
    await env.ready();
    expect(env.$("vd-login-card").hidden).toBe(false);
    expect(env.$("viewer-account-link").attributes.href).toBe("/me#vd-login-card");
    expect(env.activeElement()).toBe(env.$("vd-login-card"));
  });

  it("keeps signed-in account navigation inside the viewer experience", async () => {
    const env = makeEnvironment({ url: "https://yourrank.site/me#vd-profile", response: { body: ACCOUNT } });
    await env.ready();
    expect(env.$("vd-profile").hidden).toBe(false);
    expect(env.$("viewer-account-link").attributes.href).toBe("/me#vd-profile");
    expect(env.activeElement()).toBe(env.$("vd-profile"));
  });

  it("keeps a provider cancellation visible after the account request finishes", async () => {
    const env = makeEnvironment({ url: "https://yourrank.site/me?error=access_denied", response: { status: 401, body: { error: "unauthorized" } } });
    await env.ready();
    expect(env.$("vd-login-status").textContent).toBe("Sign-in was cancelled.");
  });

  it("does not claim a login switch succeeded when sign-out fails", async () => {
    const env = makeEnvironment({ url: "https://yourrank.site/me#vd-profile", response: (_path, opts) => opts.method === "POST" ? { status: 500, body: { error: "failed" } } : { body: ACCOUNT } });
    await env.ready();
    await env.$("vd-switch").click();
    expect(env.$("vd-profile").hidden).toBe(false);
    expect(env.$("vd-account-status").textContent).toContain("We couldn't switch your login.");
    expect(env.$("vd-switch").disabled).toBe(false);
  });
});
