import { beforeEach, describe, expect, it } from "bun:test";
import { DashboardRequestError } from "../assets/dashboard/request.js";

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  toggle(value, force) {
    const next = force === undefined ? !this.values.has(value) : force;
    if (next) this.add(value); else this.remove(value);
    return next;
  }
}

class FakeElement {
  constructor() {
    this.attributes = {};
    this.classList = new FakeClassList();
    this.dataset = {};
    this.hidden = false;
    this.listeners = {};
    this.textContent = "";
    this.value = "";
    this.disabled = false;
  }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  contains(node) { return node === this; }
}

const elements = new Map();
const fakeDocument = {
  cookie: "",
  body: new FakeElement(),
  head: new FakeElement(),
  activeElement: null,
  getElementById(id) { return elements.get(id) || null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement() { return new FakeElement(); },
};

function register(id) {
  const element = new FakeElement();
  element.id = id;
  elements.set(id, element);
  return element;
}

function installBrowserGlobals() {
  globalThis.document = fakeDocument;
  globalThis.window = {
    innerHeight: 900,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {},
    removeEventListener() {},
    open() {},
  };
  globalThis.navigator = {};
  globalThis.location = {
    href: "http://localhost/dashboard/leaderboard/players",
    origin: "http://localhost",
    pathname: "/dashboard/leaderboard/players",
    search: "",
  };
  globalThis.history = { pushState() {} };
  globalThis.requestAnimationFrame = (callback) => callback();
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
}

installBrowserGlobals();
const site = await import("../assets/dashboard/site.js");
const { state } = await import("../assets/dashboard/state.js");

describe("dashboard save handler", () => {
  beforeEach(() => {
    elements.clear();
    state._dirty = true;
    state.SAVED_PLAYERS = [];
    state.SAMPLE_PLAYERS = false;
    state.PUBLISHED = false;
    state.SITE_UPDATED_AT = null;
    state.ACTIVE_SITE_ID = null;
    state.BOARDS = [];
    globalThis.location.href = "";
  });

  it("completes a successful save and sends only the editor payload", async () => {
    elements.clear();
    const save = register("save");
    const status = register("status");
    const publishAction = register("publishAction");
    state.ACTIVE_SITE_ID = "site-test";
    state.SITE_UPDATED_AT = "before";
    state.BOARDS = [];
    state.PUBLISHED = false;
    state.SAVED_PLAYERS = [];
    state._dirty = true;

    const requests = [];
    await site.saveEditorDraft({
      collectImpl: () => ({
        payload: { siteId: "site-test", players: [{ name: "Alice", wagered: 123, prize: 4 }] },
        invalid: [],
      }),
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return new Response(JSON.stringify({ ok: true, updatedAt: "after" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/site");
    expect(JSON.parse(requests[0].options.body)).toEqual({
      siteId: "site-test",
      players: [{ name: "Alice", wagered: 123, prize: 4 }],
    });
    expect(save.disabled).toBe(false);
    expect(save.textContent).toBe("Save changes");
    expect(publishAction.disabled).toBe(false);
    expect(status.textContent).toBe("Saved");
    expect(state.SAVED_PLAYERS).toEqual([{ name: "Alice", wagered: 123, prize: 4 }]);
    expect(state.SITE_UPDATED_AT).toBe("after");
  });

  it("discards the whole editor draft before reloading the saved version", () => {
    state.ACTIVE_SITE_ID = "site-test";
    state._dirty = true;
    let reloaded = false;
    site.discardEditorChanges({ reload: () => { reloaded = true; } });
    expect(reloaded).toBe(true);
    expect(state._dirty).toBe(false);
  });

  const editorBasePayload = { siteId: "site-test", players: [{ name: "Alice", wagered: 123, prize: 4 }] };
  const collectImpl = () => ({ payload: editorBasePayload, invalid: [] });

  function saveResponse(status, body, code) {
    return new Response(JSON.stringify({ ok: false, code, ...body }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("401 editor save shows the session-ended message and keeps the draft dirty", async () => {
    register("publishAction");
    const save = register("save");
    const status = register("status");
    state.ACTIVE_SITE_ID = "site-test";

    await site.saveEditorDraft({
      collectImpl,
      fetchImpl: async () => saveResponse(401, { error: "unauthorized" }),
    });

    expect(status.textContent).toBe("Your session ended — your changes are still here. Sign in again in a new tab, then retry.");
    expect(state._dirty).toBe(true);
    expect(save.disabled).toBe(false);
    expect(save.textContent).toBe("Save changes");
    expect(globalThis.location.href).not.toContain("/login");
  });

  it("403 editor save shows the server's permission message and keeps the draft dirty", async () => {
    register("publishAction");
    const save = register("save");
    const status = register("status");
    state.ACTIVE_SITE_ID = "site-test";

    await site.saveEditorDraft({
      collectImpl,
      fetchImpl: async () => saveResponse(403, { error: "Your account role is not permitted to perform this action." }),
    });

    expect(status.textContent).toBe("Your account role is not permitted to perform this action.");
    expect(state._dirty).toBe(true);
    expect(save.disabled).toBe(false);
    expect(globalThis.location.href).not.toContain("/login");
  });

  it("editor save 401 and 403 use distinct messages and branches", async () => {
    register("publishAction");
    register("save");
    const status401 = register("status");
    state.ACTIVE_SITE_ID = "site-test";
    await site.saveEditorDraft({
      collectImpl,
      fetchImpl: async () => saveResponse(401, { error: "unauthorized" }),
    });
    const msg401 = status401.textContent;

    elements.clear();
    register("publishAction");
    register("save");
    const status403 = register("status");
    state.ACTIVE_SITE_ID = "site-test";
    await site.saveEditorDraft({
      collectImpl,
      fetchImpl: async () => saveResponse(403, { error: "Forbidden." }),
    });

    expect(msg401).toContain("session ended");
    expect(status403.textContent).toBe("Forbidden.");
    expect(msg401).not.toBe(status403.textContent);
  });

  it("409 concurrency conflict shows the reconciliation message and keeps the draft dirty", async () => {
    register("publishAction");
    const save = register("save");
    const status = register("status");
    state.ACTIVE_SITE_ID = "site-test";

    await site.saveEditorDraft({
      collectImpl,
      fetchImpl: async () => new Response(JSON.stringify({ ok: false, code: "concurrency_conflict", error: "Conflict" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    });

    expect(status.textContent).toBe("Another session saved this leaderboard. Your draft is still here — reload to review their version, or save again after reconciling.");
    expect(state._dirty).toBe(true);
    expect(save.disabled).toBe(false);
  });

  it("500 server failure shows the server message and keeps the draft dirty", async () => {
    register("publishAction");
    register("save");
    const status = register("status");
    state.ACTIVE_SITE_ID = "site-test";

    await site.saveEditorDraft({
      collectImpl,
      fetchImpl: async () => saveResponse(500, { error: "Database unavailable" }),
    });

    expect(status.textContent).toBe("Database unavailable");
    expect(state._dirty).toBe(true);
  });

  it("network failure keeps the draft dirty and does not redirect", async () => {
    register("publishAction");
    register("save");
    const status = register("status");
    state.ACTIVE_SITE_ID = "site-test";
    const originalHref = globalThis.location.href;

    await site.saveEditorDraft({
      collectImpl,
      fetchImpl: async () => { throw new Error("Network connection lost"); },
    });

    expect(state._dirty).toBe(true);
    expect(globalThis.location.href).toBe(originalHref);
    expect(status.textContent).toBe("Couldn't save. Your changes are still here — try again.");
  });

  it("timeout failure shows a timeout message and keeps the draft dirty", async () => {
    register("publishAction");
    register("save");
    const status = register("status");
    state.ACTIVE_SITE_ID = "site-test";

    await site.saveEditorDraft({
      collectImpl,
      fetchImpl: async () => { throw new DashboardRequestError("The request timed out.", { code: "TIMEOUT" }); },
    });

    expect(status.textContent).toBe("Saving timed out. Your changes are still here — try again.");
    expect(state._dirty).toBe(true);
  });

  function makeCloseOutScenario({ preSaveError, archiveError, refetchError }) {
    return async (input, init) => {
      if (input === "/api/site" && init?.method === "PUT") {
        if (preSaveError) throw preSaveError;
        return { body: { ok: true } };
      }
      if (input === "/api/site/archive" && init?.method === "POST") {
        if (archiveError) throw archiveError;
        return { body: { ok: true, label: "Week 1" } };
      }
      if (input.startsWith("/api/site")) {
        if (refetchError) throw refetchError;
        return { body: { ok: true, data: { players: [] }, archives: [] } };
      }
      throw new Error(`unexpected request ${input}`);
    };
  }

  function setupCloseOut() {
    const rows = register("rows");
    rows.children = [new FakeElement()];
    register("a_go");
    register("a_clear").value = "wagers";
    register("a_label");
    return register("status");
  }

  it("close-out pre-save 401 shows the session-ended message", async () => {
    const status = setupCloseOut();
    const err = new DashboardRequestError("Your session has ended.", { code: "AUTH" });
    await site.closeOutPeriod({
      collectImpl: () => ({ payload: { siteId: "site-test" }, invalid: [] }),
      confirmImpl: () => true,
      fetchJsonImpl: makeCloseOutScenario({ preSaveError: err }),
    });
    expect(status.textContent).toBe("Your session ended — your changes are still here. Sign in again in a new tab, then retry.");
  });

  it("close-out pre-save 403 shows the server's permission message", async () => {
    const status = setupCloseOut();
    const err = new DashboardRequestError("Your account role is not permitted to perform this action.", { code: "FORBIDDEN" });
    await site.closeOutPeriod({
      collectImpl: () => ({ payload: { siteId: "site-test" }, invalid: [] }),
      confirmImpl: () => true,
      fetchJsonImpl: makeCloseOutScenario({ preSaveError: err }),
    });
    expect(status.textContent).toBe("Your account role is not permitted to perform this action.");
  });

  it("close-out archive 401 shows the session-ended message", async () => {
    const status = setupCloseOut();
    const err = new DashboardRequestError("Your session has ended.", { code: "AUTH" });
    await site.closeOutPeriod({
      collectImpl: () => ({ payload: { siteId: "site-test" }, invalid: [] }),
      confirmImpl: () => true,
      fetchJsonImpl: makeCloseOutScenario({ archiveError: err }),
    });
    expect(status.textContent).toBe("Your session ended — your changes are still here. Sign in again in a new tab, then retry.");
  });

  it("close-out archive 403 shows the server's permission message", async () => {
    const status = setupCloseOut();
    const err = new DashboardRequestError("You don't have access to do that.", { code: "FORBIDDEN" });
    await site.closeOutPeriod({
      collectImpl: () => ({ payload: { siteId: "site-test" }, invalid: [] }),
      confirmImpl: () => true,
      fetchJsonImpl: makeCloseOutScenario({ archiveError: err }),
    });
    expect(status.textContent).toBe("You don't have access to do that.");
  });

  it("close-out re-fetch 403 shows the server's permission message", async () => {
    const status = setupCloseOut();
    const err = new DashboardRequestError("Permission denied.", { code: "FORBIDDEN" });
    await site.closeOutPeriod({
      collectImpl: () => ({ payload: { siteId: "site-test" }, invalid: [] }),
      confirmImpl: () => true,
      fetchJsonImpl: makeCloseOutScenario({ refetchError: err }),
    });
    expect(status.textContent).toBe("Permission denied.");
  });
});
