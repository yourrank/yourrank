// The global viewer account page (/me) used to lose the creator the member had
// open the moment an order succeeded, render a new order as "Reward" because the
// success path and the renderer disagreed on the key name, and post every
// authenticated failure into the login card, which is hidden once you are logged
// in. It also had no history: Back left the page entirely.
//
// These run the shipped /assets/viewer-dashboard.js against a small DOM double,
// so they fail if any of that behaviour comes back. No module mocks: the client
// is evaluated with document/window/fetch/crypto injected as parameters.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { renderPasswordGate } from "../password-gate.js";
import { viewerDashboardPage } from "../pages/viewer-dashboard.js";

const clientSource = readFileSync(new URL("../assets/viewer-dashboard.js", import.meta.url), "utf8");

/* ── DOM double ──────────────────────────────────────────────────── */

const BUTTON_RE = /<button\b[^>]*>/g;
const ATTR_RE = /([a-zA-Z-]+)(?:="([^"]*)")?/g;

function parseButtons(html, doc) {
  const out = [];
  for (const tag of html.match(BUTTON_RE) || []) {
    const attrs = {};
    let m;
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(tag))) attrs[m[1]] = m[2] === undefined ? "" : m[2];
    const el = makeEl(doc, "BUTTON");
    if ("data-view-site" in attrs) el.dataset.viewSite = attrs["data-view-site"];
    if ("data-redeem" in attrs) el.dataset.redeem = attrs["data-redeem"];
    el.disabled = "disabled" in attrs;
    el.attributes["aria-label"] = attrs["aria-label"] || "";
    out.push(el);
  }
  return out;
}

function matches(el, selector) {
  if (/^[a-zA-Z]+$/.test(selector)) return el.tagName === selector.toUpperCase();
  const attr = /^\[([a-zA-Z-]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (!attr) return false;
  const key = attr[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()).replace(/^data/, "");
  const prop = key.charAt(0).toLowerCase() + key.slice(1);
  const value = el.dataset[prop];
  if (value === undefined) return false;
  return attr[2] === undefined || value === attr[2];
}

function makeEl(doc, tagName = "DIV", id = "") {
  const listeners = {};
  let html = "";
  let kids = [];
  const el = {
    id,
    tagName,
    hidden: false,
    disabled: false,
    className: "",
    textContent: "",
    value: "",
    src: "",
    alt: "",
    dataset: {},
    attributes: {},
    listeners,
    get innerHTML() { return html; },
    set innerHTML(next) { html = String(next); kids = parseButtons(html, doc); },
    setAttribute(name, value) { el.attributes[name] = value; },
    removeAttribute(name) { delete el.attributes[name]; },
    getAttribute(name) { return name in el.attributes ? el.attributes[name] : null; },
    classList: { add() {}, remove() {} },
    focus() { doc.activeElement = el; },
    querySelectorAll(selector) { return kids.filter((k) => matches(k, selector)); },
    querySelector(selector) { return el.querySelectorAll(selector)[0] || null; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    append(...parts) {
      for (const part of parts) {
        if (typeof part === "string") el.textContent += part;
        else { kids.push(part); el.textContent += part.textContent; }
      }
    },
    hasAttribute(name) { return name in el.attributes; },
    click() { return Promise.all((listeners.click || []).map((fn) => fn())); },
  };
  return el;
}

function makeEnv({ url = "https://yourrank.site/me", routes = {}, confirm = true } = {}) {
  const doc = { activeElement: null, cookie: "__csrf=tok" };
  const nodes = new Map();
  doc.createElement = (tag) => makeEl(doc, String(tag).toUpperCase());
  doc.getElementById = (id) => {
    if (!nodes.has(id)) nodes.set(id, makeEl(doc, "DIV", id));
    return nodes.get(id);
  };

  const entries = [url];
  let index = 0;
  const location = {};
  const syncLocation = () => {
    const u = new URL(entries[index]);
    location.href = u.href;
    location.pathname = u.pathname;
    location.search = u.search;
    location.hash = u.hash;
  };
  syncLocation();

  const popHandlers = [];
  const window = {
    location,
    history: {
      pushState(_state, _title, next) {
        entries.splice(index + 1);
        entries.push(new URL(next, location.href).href);
        index = entries.length - 1;
        syncLocation();
      },
      replaceState(_state, _title, next) {
        entries[index] = new URL(next, location.href).href;
        syncLocation();
      },
    },
    addEventListener(type, fn) { if (type === "popstate") popHandlers.push(fn); },
    YRDialog: { confirm: () => Promise.resolve(confirm), calls: 0 },
  };
  const dialogConfirms = [];
  window.YRDialog.confirm = (opts) => { dialogConfirms.push(opts); return Promise.resolve(confirm); };

  const calls = [];
  const fetchStub = async (path, opts) => {
    calls.push({ path, method: opts?.method || "GET" });
    const key = `${opts?.method || "GET"} ${path.split("?")[0]}`;
    const route = routes[key];
    if (!route) throw new Error(`unrouted ${key}`);
    const result = typeof route === "function" ? route(path, opts) : route;
    return {
      ok: result.status ? result.status < 400 : true,
      status: result.status || 200,
      json: async () => result.body,
    };
  };

  const run = new Function("window", "document", "fetch", "crypto", "location", clientSource);
  run(window, doc, fetchStub, { randomUUID: () => "key-1" }, location);

  return {
    doc,
    window,
    calls,
    dialogConfirms,
    $: (id) => doc.getElementById(id),
    url: () => location.href.replace("https://yourrank.site", ""),
    ready: () => window.__yrViewerReady,
    async back() { index = Math.max(0, index - 1); syncLocation(); await Promise.all(popHandlers.map((fn) => fn())); await settle(); },
    async forward() { index = Math.min(entries.length - 1, index + 1); syncLocation(); await Promise.all(popHandlers.map((fn) => fn())); await settle(); },
  };
}

// The client's handlers are async and chain a few awaits; drain the queue.
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

const VIEWER = {
  viewer: { provider: "kick", kickUsername: "member", avatarUrl: null },
  boards: [{ slug: "alpha", name: "Alpha Board", balance: 500, blocked: false }],
  redemptions: [],
};

const SITE = {
  site: { slug: "alpha", name: "Alpha Board", kickChannelName: "alpha" },
  viewer: { balance: 500, blocked: false },
  shopItems: [{ id: "item-1", name: "Shoutout", description: "", cost: 100, stock: null }],
  redemptions: [{ id: "r0", cost: 50, status: "fulfilled", createdAt: "2024-01-01T00:00:00Z", itemName: "Old order" }],
  activeDropCount: 0,
};

function baseRoutes(extra = {}) {
  return {
    "GET /api/viewer/me": { body: VIEWER },
    "GET /api/viewer/site": { body: SITE },
    "POST /api/viewer/logout": { body: {} },
    ...extra,
  };
}

/* ── history and deep links ──────────────────────────────────────── */

describe("the viewer account page's creator history", () => {
  it("opens a creator into the URL, and Back/Forward follow it", async () => {
    const env = makeEnv({ routes: baseRoutes() });
    await env.ready();
    expect(env.$("vd-boards-card").hidden).toBe(false);
    expect(env.url()).toBe("/me");

    const open = env.$("vd-boards").querySelector('[data-view-site="alpha"]');
    await open.click();
    await settle();
    expect(env.url()).toBe("/me?site=alpha");
    expect(env.$("vd-site-card").hidden).toBe(false);
    expect(env.$("vd-boards-card").hidden).toBe(true);
    expect(env.$("vd-site-name").textContent).toBe("Alpha Board");

    await env.back();
    expect(env.url()).toBe("/me");
    expect(env.$("vd-boards-card").hidden).toBe(false);
    expect(env.$("vd-site-card").hidden).toBe(true);

    await env.forward();
    expect(env.url()).toBe("/me?site=alpha");
    expect(env.$("vd-site-card").hidden).toBe(false);
  });

  it("restores the creator from a direct /me?site=<slug> load", async () => {
    const env = makeEnv({ url: "https://yourrank.site/me?site=alpha", routes: baseRoutes() });
    await env.ready();
    expect(env.$("vd-site-card").hidden).toBe(false);
    expect(env.$("vd-site-name").textContent).toBe("Alpha Board");
    expect(env.url()).toBe("/me?site=alpha");
  });

  it("fails gracefully on an unknown site query", async () => {
    const env = makeEnv({
      url: "https://yourrank.site/me?site=ghost",
      routes: baseRoutes({ "GET /api/viewer/site": { status: 404, body: { error: "site not found" } } }),
    });
    await env.ready();
    expect(env.$("vd-site-card").hidden).toBe(true);
    expect(env.$("vd-boards-card").hidden).toBe(false);
    expect(env.$("vd-boards-status").textContent).toBe("That site isn't available any more.");
    expect(env.$("vd-boards-status").className).toContain("error");
    expect(env.url()).toBe("/me");
  });

  it("drops ?site= for a logged-out member instead of guessing", async () => {
    const env = makeEnv({
      url: "https://yourrank.site/me?site=alpha",
      routes: baseRoutes({ "GET /api/viewer/me": { status: 401, body: { error: "unauthorized" } } }),
    });
    await env.ready();
    expect(env.$("vd-login-card").hidden).toBe(false);
    expect(env.url()).toBe("/me");
    expect(env.calls.some((c) => c.path.startsWith("/api/viewer/site"))).toBe(false);
  });

  it("clears the open creator on sign out", async () => {
    const env = makeEnv({ url: "https://yourrank.site/me?site=alpha", routes: baseRoutes() });
    await env.ready();
    await env.$("vd-logout").click();
    await settle();
    expect(env.$("vd-login-card").hidden).toBe(false);
    expect(env.$("vd-site-card").hidden).toBe(true);
    expect(env.url()).toBe("/me");
  });
});

/* ── orders ──────────────────────────────────────────────────────── */

describe("placing an order from the viewer account page", () => {
  const redeemOk = {
    "POST /api/viewer/redeem": { body: { redemptionId: "r1", balance: 400, itemName: "Shoutout", itemCost: 100 } },
  };

  it("keeps the member in the creator's detail and shows the new order by name", async () => {
    const env = makeEnv({ url: "https://yourrank.site/me?site=alpha", routes: baseRoutes(redeemOk) });
    await env.ready();
    await env.$("vd-shop-list").querySelector('[data-redeem="item-1"]').click();
    await settle();

    expect(env.$("vd-site-card").hidden).toBe(false);
    expect(env.$("vd-boards-card").hidden).toBe(true);
    expect(env.$("vd-site-balance").textContent).toBe("400");
    expect(env.$("vd-redemptions-list").innerHTML).toContain("Shoutout");
    expect(env.$("vd-redemptions-list").innerHTML).not.toContain("undefined");
    expect(env.$("vd-site-status").textContent).toContain("Order placed for Shoutout.");
    expect(env.$("vd-site-status").className).not.toContain("error");
    // The cross-site list balance follows the server without a reload that
    // would throw the member back to the list.
    expect(env.$("vd-boards").innerHTML).toContain("400");
    expect(env.calls.filter((c) => c.path === "/api/viewer/me").length).toBe(1);
  });

  it("shows an order failure where the member is looking, and re-enables Order", async () => {
    const env = makeEnv({
      url: "https://yourrank.site/me?site=alpha",
      routes: baseRoutes({ "POST /api/viewer/redeem": { status: 400, body: { error: "insufficient balance" } } }),
    });
    await env.ready();
    await env.$("vd-shop-list").querySelector('[data-redeem="item-1"]').click();
    await settle();

    expect(env.$("vd-site-card").hidden).toBe(false);
    expect(env.$("vd-site-status").textContent).toBe("You don't have enough credits for that yet.");
    expect(env.$("vd-site-status").className).toContain("error");
    expect(env.$("vd-login-status").textContent).toBe("");
    expect(env.$("vd-shop-list").querySelector('[data-redeem="item-1"]').disabled).toBe(false);
  });

  it("does not order when the confirmation is cancelled", async () => {
    const env = makeEnv({ url: "https://yourrank.site/me?site=alpha", routes: baseRoutes(redeemOk), confirm: false });
    await env.ready();
    await env.$("vd-shop-list").querySelector('[data-redeem="item-1"]').click();
    await settle();
    expect(env.dialogConfirms.length).toBe(1);
    expect(env.dialogConfirms[0].confirmText).toBe("Place order");
    expect(env.calls.some((c) => c.path === "/api/viewer/redeem")).toBe(false);
  });

  it("reuses one idempotency key across a retry of the same item", async () => {
    let attempt = 0;
    const env = makeEnv({
      url: "https://yourrank.site/me?site=alpha",
      routes: baseRoutes({
        "POST /api/viewer/redeem": (_path, opts) => {
          attempt += 1;
          const sent = JSON.parse(opts.body);
          expect(sent.idempotencyKey).toBe("key-1");
          return attempt === 1 ? { status: 500, body: { error: "boom" } } : { body: { redemptionId: "r1", balance: 400, itemName: "Shoutout", itemCost: 100 } };
        },
      }),
    });
    await env.ready();
    await env.$("vd-shop-list").querySelector('[data-redeem="item-1"]').click();
    await settle();
    await env.$("vd-shop-list").querySelector('[data-redeem="item-1"]').click();
    await settle();
    expect(attempt).toBe(2);
    expect(env.$("vd-redemptions-list").innerHTML).toContain("Shoutout");
  });

  it("keeps a detail-load failure out of the hidden login card", async () => {
    const env = makeEnv({
      routes: baseRoutes({ "GET /api/viewer/site": { status: 500, body: {} } }),
    });
    await env.ready();
    await env.$("vd-boards").querySelector('[data-view-site="alpha"]').click();
    await settle();
    expect(env.$("vd-boards-status").textContent).toContain("We couldn't open that creator.");
    expect(env.$("vd-login-status").textContent).toBe("");
    expect(env.$("vd-boards-card").hidden).toBe(false);
  });
});

/* ── failure recovery ────────────────────────────────────────────── */

describe("recovering from a viewer account failure", () => {
  it("offers a real retry control when the account itself fails to load", async () => {
    let fail = true;
    const env = makeEnv({
      routes: baseRoutes({
        "GET /api/viewer/me": () => (fail ? { status: 500, body: { error: "boom" } } : { body: VIEWER }),
      }),
    });
    await env.ready();
    const status = env.$("vd-login-status");
    expect(status.textContent).toContain("We couldn't load your account.");
    expect(status.textContent).not.toContain("boom");
    expect(status.textContent).not.toContain("500");
    const retry = status.querySelector("button");
    expect(retry).not.toBeNull();
    expect(retry.textContent).toBe("Try again");
    fail = false;
    await retry.click();
    await settle();
    expect(env.$("vd-login-status").textContent).toBe("");
    expect(env.$("vd-profile").hidden).toBe(false);
  });

  it("offers no retry for a creator that is gone", async () => {
    const env = makeEnv({
      url: "https://yourrank.site/me?site=ghost",
      routes: baseRoutes({ "GET /api/viewer/site": { status: 404, body: { error: "site not found" } } }),
    });
    await env.ready();
    const status = env.$("vd-boards-status");
    expect(status.textContent).toBe("That site isn't available any more.");
    expect(status.querySelector("button")).toBeNull();
  });

  it("retries the creator that failed, not the whole page", async () => {
    let fail = true;
    const env = makeEnv({
      routes: baseRoutes({
        "GET /api/viewer/site": () => (fail ? { status: 500, body: { error: "boom" } } : { body: SITE }),
      }),
    });
    await env.ready();
    await env.$("vd-boards").querySelector('[data-view-site="alpha"]').click();
    await settle();
    const retry = env.$("vd-boards-status").querySelector("button");
    expect(retry).not.toBeNull();
    fail = false;
    await retry.click();
    await settle();
    expect(env.$("vd-site-card").hidden).toBe(false);
    expect(env.$("vd-boards-status").textContent).toBe("");
    expect(env.url()).toBe("/me?site=alpha");
  });
});

/* ── ownership and markup ────────────────────────────────────────── */

describe("the viewer account page's ownership", () => {
  it("owns its confirmation instead of importing dashboard UI", () => {
    expect(clientSource).not.toContain("./dashboard/");
    expect(clientSource).not.toContain("showConfirmModal");
    expect(clientSource).not.toContain("window.confirm");
    expect(clientSource).toContain("window.YRDialog");
    const page = String(viewerDashboardPage);
    const dialogAt = page.indexOf('src="/assets/dialog.js"');
    expect(dialogAt).toBeGreaterThan(-1);
    expect(dialogAt).toBeLessThan(page.indexOf("viewer-dashboard.js"));
  });

  it("gives every authenticated failure a visible region of its own", () => {
    const page = String(viewerDashboardPage);
    for (const id of ["vd-account-status", "vd-boards-status", "vd-site-status"]) {
      expect(page).toContain(`id="${id}" role="status" aria-live="polite"`);
    }
  });

  it("leaves the main landmark and the CSP to the shell", () => {
    const page = String(viewerDashboardPage);
    expect((page.match(/<main\b/g) || []).length).toBe(1);
    expect((page.match(/id="main-content"/g) || []).length).toBe(1);
    expect(page).not.toContain(' style="');
  });

  it("names the global surface apart from a creator's own credits page", () => {
    const page = String(viewerDashboardPage);
    expect(page).toContain("Your sites &amp; account");
    expect(page).not.toContain(">My credits<");
  });
});

describe("the private board password gate", () => {
  it("styles the field with tokens the public shell actually defines", () => {
    const html = renderPasswordGate({ name: "Private Board", slug: "private-board" }, { nonce: "n" }, "");
    expect(html).not.toContain("--yr-panel-2");
    expect(html).toContain("background:var(--yr-surface);color:var(--yr-fog)");
    expect(html).toContain(".yr-gate-form input::placeholder{color:var(--yr-faint)}");
    // --yr-ink is the page background: it can never be the field's text colour.
    expect(html).not.toMatch(/\.yr-gate-form input\{[^}]*color:var\(--yr-ink\)/);
  });

  it("lets a password manager fill it and flags errors beyond colour", () => {
    const html = renderPasswordGate({ name: "Private Board", slug: "private-board" }, { nonce: "n" }, "Incorrect password.");
    expect(html).toContain('autocomplete="current-password"');
    expect(html).not.toContain('autocomplete="off"');
    expect(html).toContain('<p class="yr-gate-error" role="alert"><span aria-hidden="true">⚠</span> Incorrect password.</p>');
  });

  it("keeps a private board out of search results and out of its own metadata", () => {
    const html = renderPasswordGate(
      { name: "Private Board", slug: "private-board", players: [{ name: "Alice", wagered: 5000 }] },
      { nonce: "n" },
      "",
    );
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).toContain("<title>Private Board · Password required</title>");
    expect(html).not.toContain("og:");
    expect(html).not.toContain('name="description"');
    expect(html).not.toContain("Alice");
    expect(html).not.toContain("5000");
    // The gate is one page with one heading, one main and a real POST target.
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    expect((html.match(/<main\b/g) || []).length).toBe(1);
    expect(html).toContain('method="POST" action="/private-board/password"');
  });

  it("keeps the custom-domain gate posting to its own host", () => {
    const html = renderPasswordGate({ name: "Private Board", slug: "private-board" }, { nonce: "n", isCustomDomain: true }, "");
    expect(html).toContain('action="/password"');
  });
});
