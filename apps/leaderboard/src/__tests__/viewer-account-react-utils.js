import { Window } from "happy-dom";
import { viewerDashboardPage } from "../pages/viewer-dashboard.js";

const installedGlobals = [
  "window", "document", "location", "history", "navigator", "HTMLElement",
  "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent",
  "DOMParser", "getComputedStyle", "matchMedia", "localStorage", "fetch",
  "ResizeObserver", "DocumentFragment", "FocusEvent", "HTMLAnchorElement",
  "HTMLButtonElement", "HTMLFormElement", "HTMLInputElement", "HTMLSelectElement",
  "HTMLTextAreaElement", "MutationObserver", "NodeFilter", "PointerEvent",
  "ShadowRoot", "SVGElement", "requestAnimationFrame", "cancelAnimationFrame",
];
const originalGlobals = Object.fromEntries(installedGlobals.map((key) => [key, globalThis[key]]));
const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;

export function installViewerAccountDomGlobals(window) {
  for (const key of installedGlobals) {
    globalThis[key] = key === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[key];
  }
  window.Element.prototype.scrollIntoView = function () {};
  window.Element.prototype.getClientRects = function () { return [{}]; };
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  globalThis.matchMedia = window.matchMedia;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}

export function restoreViewerAccountDomGlobals() {
  for (const key of installedGlobals) globalThis[key] = originalGlobals[key];
  if (originalActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  else globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
}

const bootstrapWindow = new Window({ url: "https://yourrank.site/me" });
installViewerAccountDomGlobals(bootstrapWindow);
const { act } = await import("react");
const { mountViewerAccount } = await import("../react/pages/viewer-account/entry.tsx");
export { mountViewerAccount };
restoreViewerAccountDomGlobals();
await bootstrapWindow.happyDOM.close();

function flushReactUpdates() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function actAndFlush(callback = () => {}) {
  await act(async () => {
    await callback();
    for (let index = 0; index < 4; index += 1) await flushReactUpdates();
  });
}

export async function makeViewerAccountEnvironment({
  response,
  url = "https://yourrank.site/me",
  auth = { state: "unauthenticated", viewer: null },
  providerAvailability = { kick: true, discord: true },
  community = null,
  viewerApp = true,
  mountReact = true,
} = {}) {
  const window = new Window({
    url,
    settings: {
      disableJavaScriptEvaluation: true,
      disableCSSFileLoading: true,
      disableErrorCapturing: true,
    },
  });
  installViewerAccountDomGlobals(window);
  const { document } = window;
  const page = viewerDashboardPage(community, providerAvailability, auth);
  document.documentElement.innerHTML = typeof page === "string" ? page : await page.text();
  document.cookie = "__csrf=token";

  const calls = [];
  window.fetch = async (path, options = {}) => {
    calls.push({
      path,
      method: options.method || "GET",
      credentials: options.credentials,
      headers: options.headers,
      signal: options.signal,
    });
    const result = await (typeof response === "function" ? response(path, options) : response);
    const status = result?.status || 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => result?.body || {},
    };
  };
  globalThis.fetch = window.fetch;

  if (viewerApp) {
    window.YRViewerApp = {
      navigate(href) {
        window.history.replaceState({}, "", href);
      },
    };
  }

  const mount = document.getElementById("vd-app");
  const controller = new AbortController();
  let resolveReady;
  const directReady = new Promise((resolve) => { resolveReady = resolve; });
  let root = null;
  if (mountReact) {
    await actAndFlush(() => {
      root = mountViewerAccount(mount, {
        signal: controller.signal,
        onFirstLoadCommitted: () => resolveReady(),
      });
    });
  }

  let closed = false;
  return {
    window,
    document,
    mount,
    root,
    controller,
    calls,
    ready: () => actAndFlush(() => window.__yrViewerReady || directReady),
    $: (id) => document.getElementById(id),
    authState: () => ["authenticated", "unauthenticated", "unresolved"]
      .find((state) => document.body.classList.contains(`viewer-auth-${state}`)),
    navigation: [...document.querySelectorAll(".viewer-destinations a")],
    activeElement: () => document.activeElement,
    async navigateHash(hash) {
      await actAndFlush(() => {
        const next = `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ""}`;
        window.history.replaceState({}, "", next);
        window.dispatchEvent(new window.Event("hashchange"));
      });
    },
    async click(element) {
      await actAndFlush(() => element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })));
    },
    async submit(element) {
      await actAndFlush(() => element.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    },
    async input(element, value) {
      await actAndFlush(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        setter?.call(element, value);
        element.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    },
    async fire(element, type) {
      await actAndFlush(() => element.dispatchEvent(new window.Event(type)));
    },
    async close() {
      if (closed) return;
      closed = true;
      await actAndFlush(() => {
        controller.abort();
        document.dispatchEvent(new window.Event("yr:viewer-unmount"));
        root?.unmount();
      });
      await window.happyDOM.close();
      restoreViewerAccountDomGlobals();
    },
  };
}
