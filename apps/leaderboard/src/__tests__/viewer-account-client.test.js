// The global /me pages own the Viewer Account: Profile, Connected accounts,
// Notifications, Privacy & security, Data & account. Creator-branded My
// Community pages own per-membership rewards, credits and claims, so this
// client must not grow a second site detail or redemption flow.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { viewerAccountPage } from "../pages/viewer-account.js";

const clientSource = readFileSync(new URL("../assets/viewer-account.js", import.meta.url), "utf8");
const page = viewerAccountPage("communities");

function makeElement(document, id = "") {
  const listeners = {};
  const el = {
    id,
    hidden: false,
    disabled: false,
    textContent: "",
    innerHTML: "",
    className: "",
    src: "",
    alt: "",
    value: "",
    width: 0,
    height: 0,
    dataset: {},
    attributes: {},
    children: [],
    classList: { add() {}, remove() {} },
    setAttribute(name, value) { el.attributes[name] = value; },
    removeAttribute(name) { delete el.attributes[name]; },
    getAttribute(name) { return el.attributes[name]; },
    addEventListener(type, listener) { (listeners[type] ||= []).push(listener); },
    async click() { await Promise.all((listeners.click || []).map((listener) => listener())); },
    async submit() { await Promise.all((listeners.submit || []).map((listener) => listener({ preventDefault() {} }))); },
    appendChild(child) { el.children.push(child); el.textContent += child.textContent || ""; return child; },
    replaceWith(next) { el.replacedBy = next; },
    focus() { document.activeElement = el; },
    _listeners: listeners,
  };
  return el;
}

// A tiny DOM stand-in: the account page element answers the selectors the
// client uses, backed by maps the test seeds per page.
function makeEnvironment({ response, url = "https://yourrank.site/me", page: pageName = "communities" }) {
  const document = {
    activeElement: null,
    createElement: () => makeElement(document),
    _byId: new Map(),
    getElementById(id) {
      if (!document._byId.has(id)) document._byId.set(id, makeElement(document, id));
      return document._byId.get(id);
    },
    _bySel: new Map(),
    querySelector(sel) {
      if (document._bySel.has(sel)) return document._bySel.get(sel);
      if (sel === 'meta[name="csrf-token"]') return { content: "token" };
      return null;
    },
  };

  // Seed the per-page DOM surface the client expects.
  const pageEl = makeElement(document);
  pageEl.dataset.vaPage = pageName;
  const scoped = new Map();
  const seed = (sel, value) => scoped.set(sel, value);
  if (pageName === "communities") {
    seed('[data-va-list="communities"]', makeElement(document));
    seed('[data-va-empty="communities"]', (() => { const e = makeElement(document); e.hidden = true; return e; })());
    seed("[data-va-count]", makeElement(document));
    seed("[data-va-stats]", (() => { const e = makeElement(document); e.hidden = true; return e; })());
    const statEls = ["communities", "credits", "claims"].map((n) => { const e = makeElement(document); e.dataset.vaStat = n; return e; });
    seed("[data-va-stat]", statEls);
    const cards = ["communities", "find"].map(() => { const e = makeElement(document); e.hidden = true; return e; });
    seed("[data-va-card]", cards);
    seed("[data-va-open-community]", makeElement(document));
  }
  if (pageName === "profile") {
    const fields = ["displayName", "username", "memberSince"].map((n) => { const e = makeElement(document); e.dataset.vaField = n; return e; });
    seed("[data-va-field]", fields);
    seed("[data-va-avatar]", makeElement(document));
    seed("[data-va-card]", ["profile", "identity"].map(() => { const e = makeElement(document); e.hidden = true; return e; }));
  }
  if (pageName === "connections") {
    seed('[data-va-list="connections"]', makeElement(document));
    seed("[data-va-card]", [makeElement(document)]);
  }
  if (pageName === "privacy") {
    seed('[data-va-list="signin"]', makeElement(document));
    seed('[data-va-list="sessions"]', makeElement(document));
    seed('[data-va-list="connections"]', makeElement(document));
    seed("[data-va-card]", [makeElement(document), makeElement(document), makeElement(document)]);
  }
  if (pageName === "data") {
    seed('[data-va-list="account-info"]', makeElement(document));
    seed("[data-va-export]", makeElement(document));
    seed("[data-va-export-status]", makeElement(document));
    seed("[data-va-card]", [makeElement(document), makeElement(document), makeElement(document)]);
  }
  pageEl.querySelector = (sel) => scoped.get(sel) || null;
  pageEl.querySelectorAll = (sel) => {
    const v = scoped.get(sel);
    if (!v) return [];
    return Array.isArray(v) ? v : [v];
  };
  document._bySel.set("[data-va-page]", pageEl);
  const loading = (() => { const e = makeElement(document); e.hidden = false; return e; })();
  document._bySel.set("[data-va-loading]", loading);
  const chipName = makeElement(document), chipMark = makeElement(document), chipCtx = makeElement(document);
  document._bySel.set("[data-viewer-chip-name]", chipName);
  document._bySel.set("[data-viewer-chip-mark]", chipMark);
  document._bySel.set("[data-viewer-chip-context]", chipCtx);
  const loginCard = document.getElementById("va-login-card");
  loginCard.hidden = true;
  const loginStatus = document.getElementById("va-login-status");

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
  location.assign = (next) => { location.href = new URL(next, location.href).href; };
  const window = {
    addEventListener() {},
    location,
    setTimeout: (fn) => { fn(); return 0; },
    history: { replaceState(_state, _title, next) { location.href = new URL(next, location.href).href; } },
  };
  const run = new Function("window", "document", "fetch", "location", clientSource);
  run(window, document, fetch, location);
  const at = (sel) => pageEl.querySelector(sel);
  const atAll = (sel) => pageEl.querySelectorAll(sel);
  return {
    $: (id) => document.getElementById(id),
    at, atAll, pageEl, loading, chipName, chipMark, chipCtx, loginCard, loginStatus,
    activeElement: () => document.activeElement,
    calls,
    location,
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
  sessions: [
    { authority: "global", createdAt: "2026-01-02T00:00:00.000Z", expiresAt: "2026-02-02T00:00:00.000Z", current: true },
    { authority: "site", siteName: "Alpha Community", createdAt: "2026-01-05T00:00:00.000Z", expiresAt: "2026-02-05T00:00:00.000Z", current: false },
  ],
};

describe("global Viewer Account client", () => {
  it("renders one account and links each membership to its creator-branded owner", async () => {
    const env = makeEnvironment({ response: { body: ACCOUNT } });
    await env.ready();

    expect(env.loginCard.hidden).toBe(true);
    expect(env.loading.hidden).toBe(true);
    for (const card of env.atAll("[data-va-card]")) expect(card.hidden).toBe(false);
    expect(env.chipName.textContent).toBe("member");
    expect(env.chipCtx.textContent).toContain("member");
    const list = env.at('[data-va-list="communities"]');
    expect(list.innerHTML).toContain("Alpha Community");
    expect(list.innerHTML).toContain("1,234 credits");
    expect(list.innerHTML).toContain("1 claim pending");
    expect(list.innerHTML).toContain('href="/alpha"');
    expect(list.innerHTML).not.toContain("Member since");
    expect(env.at("[data-va-count]").textContent).toBe("1 community");
    const stats = Object.fromEntries(env.atAll("[data-va-stat]").map((el) => [el.dataset.vaStat, el.textContent]));
    expect(stats.communities).toBe("1");
    expect(stats.credits).toBe("1,234");
    expect(stats.claims).toBe("1");
    expect(env.calls).toEqual([{ path: "/api/viewer/me", method: "GET" }]);
  });

  it("shows the truthful empty membership state", async () => {
    const env = makeEnvironment({ response: { body: { ...ACCOUNT, communities: [] } } });
    await env.ready();
    expect(env.at('[data-va-empty="communities"]').hidden).toBe(false);
    expect(env.at('[data-va-list="communities"]').innerHTML).toBe("");
    expect(env.at("[data-va-count]").textContent).toBe("");
  });

  it("hydrates profile fields and falls back to an initial without an avatar", async () => {
    const env = makeEnvironment({ page: "profile", response: { body: ACCOUNT } });
    await env.ready();
    const fields = Object.fromEntries(env.atAll("[data-va-field]").map((el) => [el.dataset.vaField, el.textContent]));
    expect(fields.displayName).toBe("member");
    expect(fields.username).toBe("@member");
    expect(fields.memberSince).toContain("2026");
    expect(env.at("[data-va-avatar]").textContent).toBe("M");
  });

  it("swaps the initial for the real avatar when one is connected", async () => {
    const env = makeEnvironment({ page: "profile", response: { body: { ...ACCOUNT, viewer: { ...ACCOUNT.viewer, avatarUrl: "https://cdn.example/a.png" } } } });
    await env.ready();
    const avatar = env.at("[data-va-avatar]");
    expect(avatar.replacedBy.tagName || avatar.replacedBy.className).toBeTruthy();
    expect(avatar.replacedBy.src).toBe("https://cdn.example/a.png");
    expect(env.chipMark.replacedBy.src).toBe("https://cdn.example/a.png");
  });

  it("lists every provider with a real connected-or-connect state", async () => {
    const env = makeEnvironment({ page: "connections", response: { body: ACCOUNT } });
    await env.ready();
    const list = env.at('[data-va-list="connections"]');
    expect(list.innerHTML).toContain("Linked as member");
    expect(list.innerHTML).toContain("Connected");
    expect(list.innerHTML).toContain("Join communities and unlock Discord rewards.");
    expect(list.innerHTML).toContain("/api/viewer/auth/discord?returnTo=");
  });

  it("renders real sessions and sign-in methods on Privacy & security", async () => {
    const env = makeEnvironment({ page: "privacy", response: { body: ACCOUNT } });
    await env.ready();
    const sessions = env.at('[data-va-list="sessions"]');
    expect(sessions.innerHTML).toContain("Viewer Account session");
    expect(sessions.innerHTML).toContain("Community session · Alpha Community");
    expect(sessions.innerHTML).toContain("Current session");
    const signin = env.at('[data-va-list="signin"]');
    expect(signin.innerHTML).toContain("Sign in with your Kick account.");
    expect(signin.innerHTML).toContain("Connected");
    expect(signin.innerHTML).toContain("Add</a>");
  });

  it("shows account facts and runs the export from request to download", async () => {
    const env = makeEnvironment({
      page: "data",
      response: (path, opts) => {
        if (path === "/api/viewer/export" && opts.method === "POST") return { body: { ok: true, exportId: "exp-1" } };
        if (path === "/api/viewer/export/exp-1/status") return { body: { status: "completed" } };
        return { body: ACCOUNT };
      },
    });
    await env.ready();
    const info = env.at('[data-va-list="account-info"]');
    expect(info.innerHTML).toContain("member");
    expect(info.innerHTML).toContain("Kick");
    expect(info.innerHTML).toContain("Communities joined");
    const exportBtn = env.at("[data-va-export]");
    const exportStatus = env.at("[data-va-export-status]");
    await exportBtn.click();
    await new Promise((resolve) => setImmediate(resolve));
    expect(env.calls).toContainEqual({ path: "/api/viewer/export", method: "POST" });
    expect(env.calls).toContainEqual({ path: "/api/viewer/export/exp-1/status", method: "GET" });
    expect(exportStatus.textContent).toContain("Download export");
    expect(exportBtn.disabled).toBe(false);
  });

  it("reports a failed export without claiming it started", async () => {
    const env = makeEnvironment({
      page: "data",
      response: (path, opts) => opts.method === "POST" ? { status: 500, body: { error: "nope" } } : { body: ACCOUNT },
    });
    await env.ready();
    await env.at("[data-va-export]").click();
    await new Promise((resolve) => setImmediate(resolve));
    expect(env.at("[data-va-export-status]").textContent).toContain("nope");
  });

  it("shows sign-in when the Viewer Account session is absent", async () => {
    const env = makeEnvironment({ response: { status: 401, body: { error: "unauthorized" } } });
    await env.ready();
    expect(env.loginCard.hidden).toBe(false);
    expect(env.loginStatus.textContent).toContain("Sign in to continue");
    for (const card of env.atAll("[data-va-card]")) expect(card.hidden).toBe(true);
  });

  it("keeps an account failure visible and honest", async () => {
    const env = makeEnvironment({ response: { status: 500, body: { error: "boom" } } });
    await env.ready();
    expect(env.loginCard.hidden).toBe(false);
    expect(env.loginStatus.textContent).toContain("could not load");
    expect(clientSource).toContain('fetch("/api/viewer/me"');
  });
});

describe("global Viewer Account ownership", () => {
  it("names the real account-to-membership hierarchy", () => {
    for (const copy of ["My communities", "Your memberships", "Open a community", "You haven't joined any communities yet.",
      "rewards and credits stay with each one", "Your membership will be waiting here."]) {
      expect(page).toContain(copy);
    }
    expect(page).not.toContain("appear here automatically");
    expect(page).not.toContain("Your sites");
    expect(page).not.toContain(">My credits<");
  });

  it("renders the five account sections with truthful unavailable surfaces", () => {
    for (const [name, marker] of [["profile", 'data-va-page="profile"'], ["connections", 'data-va-page="connections"'],
      ["notifications", 'data-va-page="notifications"'], ["privacy", 'data-va-page="privacy"'], ["data", 'data-va-page="data"']]) {
      expect(viewerAccountPage(name)).toContain(marker);
    }
    const notifications = viewerAccountPage("notifications");
    expect(notifications).toContain("Coming soon");
    expect(notifications).not.toContain("<input");
    const data = viewerAccountPage("data");
    expect(data).toContain("data-va-export");
    expect(data).toContain("Contact support");
    expect(data).not.toContain('id="va-delete"');
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

  it("leaves the main landmark and CSP to the shared viewer shell", () => {
    for (const name of ["communities", "profile", "connections", "notifications", "privacy", "data"]) {
      const doc = viewerAccountPage(name);
      expect(doc).toContain('data-viewer-shell="account"');
      expect((doc.match(/<main\b/g) || []).length).toBe(1);
      expect((doc.match(/id="main-content"/g) || []).length).toBe(1);
      expect(doc).not.toContain(' style="');
      expect(doc).not.toContain('/assets/devin-system.css');
      expect(doc).not.toContain('/assets/dashboard-v4.css');
      expect(doc).not.toContain('href="/dashboard"');
      // Viewer account rail carries the five global sections.
      for (const dest of ["/me/profile", "/me/connections", "/me/notifications", "/me/privacy", "/me/data"]) {
        expect(doc).toContain(`href="${dest}"`);
      }
    }
  });

  it("gives every account failure a visible status owner", () => {
    expect(page).toContain('id="va-login-status" role="status" aria-live="polite"');
    expect(page).toContain('id="va-community-status" role="status" aria-live="polite"');
    expect(viewerAccountPage("data")).toContain('data-va-export-status role="status" aria-live="polite"');
    expect(page).toContain('data-va-loading role="status" aria-live="polite"');
  });
});

describe("viewer login recovery", () => {
  it("opens a named or pasted YourRank community from the directory without creating a membership", async () => {
    const env = makeEnvironment({ response: { body: { ...ACCOUNT, communities: [] } } });
    await env.ready();
    expect(env.at('[data-va-empty="communities"]').hidden).toBe(false);
    const input = env.$("va-community-name");
    input.value = " Atlas-Community ";
    await env.at("[data-va-open-community]").submit();
    expect(env.location.pathname).toBe("/atlas-community");
    // Existing slugify truncates after trimming, so a stored slug can end in '-'.
    const truncatedSlug = "a".repeat(39) + "-";
    input.value = truncatedSlug;
    await env.at("[data-va-open-community]").submit();
    expect(env.location.pathname).toBe(`/${truncatedSlug}`);
    input.value = "https://yourrank.site/atlas-community/shop";
    await env.at("[data-va-open-community]").submit();
    expect(env.location.pathname).toBe("/atlas-community");
    expect(env.calls.every(call => call.method === "GET")).toBe(true);
  });

  it("rejects an input that cannot name a community", async () => {
    const env = makeEnvironment({ response: { body: { ...ACCOUNT, communities: [] } } });
    await env.ready();
    const input = env.$("va-community-name");
    for (const invalid of ["https://other.example", "../dashboard", "", "not a slug!"]) {
      input.value = invalid;
      await env.at("[data-va-open-community]").submit();
      expect(env.location.pathname).toBe("/me");
      expect(env.$("va-community-status").textContent).toContain("Enter a community name");
    }
  });

  it("keeps the sign-in panel reachable for signed-out deep links", async () => {
    const env = makeEnvironment({ url: "https://yourrank.site/me/profile", page: "profile", response: { status: 401, body: { error: "unauthorized" } } });
    await env.ready();
    expect(env.loginCard.hidden).toBe(false);
    expect(env.loginStatus.textContent).toContain("Sign in to continue");
  });

  it("only speaks about real OAuth entry points", () => {
    const doc = viewerAccountPage("communities");
    expect(doc).toContain('href="/api/viewer/auth/kick?returnTo=%2Fme"');
    expect(doc).toContain('href="/api/viewer/auth/discord?returnTo=%2Fme"');
    expect(clientSource).toContain('connect: "/api/viewer/auth/kick"');
    expect(clientSource).toContain('connect: "/api/viewer/auth/discord"');
  });
});
