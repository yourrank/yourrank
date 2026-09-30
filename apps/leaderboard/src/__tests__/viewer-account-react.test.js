import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { viewerDashboardPage } from "../pages/viewer-dashboard.js";
import {
  actAndFlush,
  makeViewerAccountEnvironment,
  mountViewerAccount,
} from "./viewer-account-react-utils.js";

const shimSource = readFileSync(new URL("../assets/viewer-dashboard.js", import.meta.url), "utf8");

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

const SIGNED_IN_DOCUMENT = {
  state: "authenticated",
  viewer: {
    id: "v1",
    kick_username: "member",
    avatar_url: null,
    created_at: "2026-01-02T00:00:00.000Z",
  },
};

function evaluateShim(environment, { countMounts = false, bundleLoader } = {}) {
  const counts = { mounts: 0 };
  environment.window.__yrViewerAccountBundleLoader = bundleLoader || (async () => ({
    mountViewerAccount(container, props) {
      if (countMounts) counts.mounts += 1;
      return mountViewerAccount(container, props);
    },
  }));
  new Function("window", "document", shimSource)(environment.window, environment.document);
  return counts;
}

function observeLifecycleListeners(window, document) {
  const hashListeners = new Set();
  const unmountListeners = new Set();
  const addWindowListener = window.addEventListener.bind(window);
  const removeWindowListener = window.removeEventListener.bind(window);
  const addDocumentListener = document.addEventListener.bind(document);
  const removeDocumentListener = document.removeEventListener.bind(document);
  window.addEventListener = (type, listener, options) => {
    if (type === "hashchange") hashListeners.add(listener);
    return addWindowListener(type, listener, options);
  };
  window.removeEventListener = (type, listener, options) => {
    if (type === "hashchange") hashListeners.delete(listener);
    return removeWindowListener(type, listener, options);
  };
  document.addEventListener = (type, listener, options) => {
    if (type === "yr:viewer-unmount") unmountListeners.add(listener);
    return addDocumentListener(type, listener, options);
  };
  document.removeEventListener = (type, listener, options) => {
    if (type === "yr:viewer-unmount") unmountListeners.delete(listener);
    return removeDocumentListener(type, listener, options);
  };
  return { hashListeners, unmountListeners };
}

describe("Viewer Account React lifecycle", () => {
  it("re-initializes after unmount and DOM replacement without duplicate roots or listeners", async () => {
    const environment = await makeViewerAccountEnvironment({
      mountReact: false,
      response: { body: ACCOUNT },
    });
    const listeners = observeLifecycleListeners(environment.window, environment.document);
    const counts = evaluateShim(environment, { countMounts: true });
    const firstReady = environment.window.__yrViewerReady;
    expect(firstReady).toBeInstanceOf(Promise);
    await environment.ready();
    expect(counts.mounts).toBe(1);
    expect(listeners.hashListeners.size).toBe(1);
    expect(listeners.unmountListeners.size).toBe(1);

    expect(environment.window.YRInitViewerAccount()).toBe(firstReady);
    await actAndFlush();
    expect(counts.mounts).toBe(1);
    expect(listeners.hashListeners.size).toBe(1);
    expect(listeners.unmountListeners.size).toBe(1);

    await actAndFlush(() => environment.document.dispatchEvent(new environment.window.Event("yr:viewer-unmount")));
    expect(listeners.hashListeners.size).toBe(0);
    expect(listeners.unmountListeners.size).toBe(0);
    environment.document.documentElement.innerHTML = viewerDashboardPage();
    await actAndFlush(() => environment.window.YRInitViewerAccount());
    await environment.ready();
    expect(counts.mounts).toBe(2);
    expect(listeners.hashListeners.size).toBe(1);
    expect(listeners.unmountListeners.size).toBe(1);

    await actAndFlush(() => environment.window.YRInitViewerAccount());
    expect(counts.mounts).toBe(2);
    expect(listeners.hashListeners.size).toBe(1);
    await environment.close();
  });

  it("does nothing when the account mount is absent", async () => {
    const environment = await makeViewerAccountEnvironment({
      mountReact: false,
      response: { body: ACCOUNT },
    });
    environment.$("vd-app").remove();
    const counts = evaluateShim(environment, { countMounts: true });
    expect(counts.mounts).toBe(0);
    expect(environment.window.__yrViewerReady).toBeUndefined();
    expect(environment.window.YRInitViewerAccount()).toBeUndefined();
    expect(counts.mounts).toBe(0);
    await environment.close();
  });

  it("does not render an in-flight account response after unmount aborts it", async () => {
    let resolveResponse;
    const environment = await makeViewerAccountEnvironment({
      auth: SIGNED_IN_DOCUMENT,
      mountReact: false,
      response: () => new Promise((resolve) => { resolveResponse = resolve; }),
    });
    evaluateShim(environment);
    await actAndFlush();
    expect(environment.calls).toHaveLength(1);
    const requestSignal = environment.calls[0].signal;
    expect(requestSignal.aborted).toBe(false);

    await actAndFlush(() => environment.document.dispatchEvent(new environment.window.Event("yr:viewer-unmount")));
    expect(requestSignal.aborted).toBe(true);
    resolveResponse({ body: ACCOUNT });
    await actAndFlush();
    expect(environment.mount.innerHTML).toBe("");
    expect(environment.document.getElementById("vd-communities")).toBeNull();
    await environment.close();
  });

  it("resolves __yrViewerReady only after the account content is committed", async () => {
    let resolveResponse;
    const environment = await makeViewerAccountEnvironment({
      auth: SIGNED_IN_DOCUMENT,
      mountReact: false,
      response: () => new Promise((resolve) => { resolveResponse = resolve; }),
    });
    evaluateShim(environment);
    let resolved = false;
    environment.window.__yrViewerReady.then(() => { resolved = true; });
    await actAndFlush();
    expect(resolved).toBe(false);
    expect(environment.$("vd-loading").hidden).toBe(false);

    resolveResponse({ body: ACCOUNT });
    await environment.ready();
    expect(resolved).toBe(true);
    expect(environment.$("vd-communities").textContent).toContain("Alpha Community");
    expect(environment.$("vd-loading").hidden).toBe(true);
    await environment.close();
  });

  it("waits for a pending island bundle before resolving readiness", async () => {
    let resolveBundle;
    const environment = await makeViewerAccountEnvironment({
      auth: SIGNED_IN_DOCUMENT,
      mountReact: false,
      response: { body: ACCOUNT },
    });
    const counts = evaluateShim(environment, {
      countMounts: true,
      bundleLoader: () => new Promise((resolve) => { resolveBundle = resolve; }),
    });
    let resolved = false;
    environment.window.__yrViewerReady.then(() => { resolved = true; });
    await actAndFlush();
    expect(resolved).toBe(false);
    expect(counts.mounts).toBe(0);
    expect(environment.calls).toHaveLength(0);

    resolveBundle({
      mountViewerAccount(container, props) {
        counts.mounts += 1;
        return mountViewerAccount(container, props);
      },
    });
    await environment.ready();
    expect(counts.mounts).toBe(1);
    expect(environment.$("vd-communities").textContent).toContain("Alpha Community");
    expect(environment.$("vd-loading").hidden).toBe(true);
    await environment.close();
  });

  it("updates shared chrome when a signed-in viewer logs out", async () => {
    const environment = await makeViewerAccountEnvironment({
      auth: SIGNED_IN_DOCUMENT,
      mountReact: false,
      response: (_path, options) => options.method === "POST"
        ? { body: { ok: true } }
        : { body: ACCOUNT },
    });
    evaluateShim(environment);
    await environment.ready();
    const overview = environment.document.createElement("div");
    overview.className = "viewer-overview";
    overview.textContent = "Private overview";
    environment.document.querySelector(".viewer-main").append(overview);
    expect(environment.$("viewer-top-name").textContent).toBe("member");
    expect(environment.$("viewer-account-link").hidden).toBe(false);
    expect(environment.$("vd-rail-logout").hidden).toBe(false);

    await environment.click(environment.$("vd-logout"));
    expect(environment.authState()).toBe("unauthenticated");
    expect(environment.$("viewer-top-name").textContent).toBe("Sign in");
    expect(environment.$("viewer-top-mark").textContent).toBe("");
    expect(environment.$("viewer-top-avatar").getAttribute("aria-label")).toBe("Sign in to your viewer account");
    expect(environment.$("viewer-account-link").hidden).toBe(true);
    expect(environment.$("vd-rail-logout").hidden).toBe(true);
    expect(overview.childNodes).toHaveLength(0);
    await environment.close();
  });

  it("rewrites guest provider links to return to the requested account section", async () => {
    const environment = await makeViewerAccountEnvironment({
      community: { slug: "alpha", name: "Alpha", href: "/alpha" },
      mountReact: false,
      response: { status: 401, body: { error: "unauthorized" } },
      url: "https://yourrank.site/me?community=alpha#vd-data",
    });
    evaluateShim(environment);
    await environment.ready();
    expect(environment.$("vd-title").textContent).toBe("Sign in to open Data & Account");
    expect(environment.$("vd-login-kick").getAttribute("href"))
      .toBe("/api/viewer/auth/kick?returnTo=%2Fme%3Fcommunity%3Dalpha%23vd-data");
    expect(environment.$("vd-login-discord").getAttribute("href"))
      .toBe("/api/viewer/auth/discord?returnTo=%2Fme%3Fcommunity%3Dalpha%23vd-data");
    await environment.close();
  });

  it("renders a ready export with its download link and expiry", async () => {
    const environment = await makeViewerAccountEnvironment({
      mountReact: false,
      response: (path, options) => {
        if (path === "/api/viewer/export" && options.method === "POST") return { body: { exportId: "export-1" } };
        if (path === "/api/viewer/export/export-1/status") {
          return { body: { status: "completed", expiresAt: "2026-01-03T00:00:00.000Z" } };
        }
        return { body: ACCOUNT };
      },
    });
    evaluateShim(environment);
    await environment.ready();
    await environment.navigateHash("vd-data");
    await environment.click(environment.$("vd-export"));
    expect(environment.$("vd-export-status").textContent).toContain("Your export is being prepared.");
    expect(environment.$("vd-export-check").hidden).toBe(false);

    await environment.click(environment.$("vd-export-check"));
    expect(environment.$("vd-export-status").textContent).toContain("Your export is ready.");
    expect(environment.$("vd-export-status").textContent).toContain("Available until Jan 3, 2026.");
    expect(environment.$("vd-export-download").hidden).toBe(false);
    expect(environment.$("vd-export-download").getAttribute("href")).toBe("/api/viewer/export/export-1/download");
    expect(environment.calls.every((call) => call.credentials === "same-origin")).toBe(true);
    expect(environment.calls.every((call) => call.headers["x-csrf-token"] === "token")).toBe(true);
    await environment.close();
  });
});
