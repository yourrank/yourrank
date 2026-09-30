import { Window } from "happy-dom";

export const window = new Window({ url: "http://localhost/dashboard/rewards/overview?siteId=site-1" });
export const { document } = window;

const browserGlobals = [
  "DocumentFragment", "FocusEvent", "HTMLButtonElement", "HTMLFormElement",
  "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement",
  "MutationObserver", "NodeFilter", "PointerEvent", "ShadowRoot", "SVGElement",
  "requestAnimationFrame", "cancelAnimationFrame",
];
const installedGlobals = [
  "window", "document", "location", "history", "navigator", "HTMLElement",
  "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent",
  "DOMParser", "getComputedStyle", "matchMedia", "localStorage", "fetch", "ResizeObserver",
  ...browserGlobals,
];
const originalGlobals = Object.fromEntries(installedGlobals.map((key) => [key, globalThis[key]]));

export function installRewardsDomGlobals() {
  for (const key of installedGlobals.slice(0, 14)) {
    globalThis[key] = key === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[key];
  }
  for (const key of browserGlobals) {
    globalThis[key] = key.endsWith("AnimationFrame") ? window[key].bind(window) : window[key];
  }
  window.Element.prototype.scrollIntoView = function () {};
  window.Element.prototype.getClientRects = function () { return [{}]; };
  globalThis.localStorage = window.localStorage;
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

installRewardsDomGlobals();

const React = await import("react");
export const { act, createElement } = React;
export const { createRoot } = await import("react-dom/client");
const { RewardsPage } = await import("../react/pages/rewards/page.tsx");
let root = null;

export async function flushReactUpdates() {
  for (let index = 0; index < 12; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export async function actAndFlush(callback = () => {}) {
  installRewardsDomGlobals();
  await act(async () => {
    await callback();
    await flushReactUpdates();
  });
}

export async function mountRewardsPage({ tab = "overview", url, deps = {} } = {}) {
  installRewardsDomGlobals();
  await window.happyDOM.setURL(url || `http://localhost/dashboard/rewards/${tab}?siteId=site-1`);
  window.localStorage.clear();
  document.body.innerHTML = '<main><div id="cr-loading" role="status" hidden></div><div id="cr-empty" hidden></div><div id="cr-app" data-cr-tab="overview" hidden></div></main>';
  const container = document.getElementById("cr-app");
  container.dataset.crTab = tab;
  root = createRoot(container);
  const injected = {
    api: async (path) => {
      if (path === "/api/credits/status") return {};
      if (path === "/api/credits/earning-rules") return {};
      if (path.startsWith("/api/claims?")) return { claims: [], page: { hasMore: false, nextCursor: null }, total: 0 };
      if (path.startsWith("/api/credits/analytics?")) return {};
      return {};
    },
    loadBoardShell: async () => ({ activeSiteId: "site-1" }),
    optimizeRewardImage: async () => ({ data: "", bytes: 0 }),
    requestDashboardRoute() {},
    ...deps,
  };
  await actAndFlush(() => root.render(createElement(RewardsPage, { tab, dependencies: injected })));
  return { container, injected };
}

export async function unmountRewardsPage() {
  if (!root) return;
  await actAndFlush(() => root.unmount());
  root = null;
}

export function restoreRewardsDomGlobals() {
  for (const key of installedGlobals) globalThis[key] = originalGlobals[key];
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}

export function firePointerClick(element) {
  const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
  for (const type of events) {
    element.dispatchEvent(new window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type.includes("down") ? 1 : 0,
    }));
  }
}

export async function clickReactTarget(element) {
  await actAndFlush(() => firePointerClick(element));
}

export async function setReactInputValue(element, value) {
  await actAndFlush(() => {
    const prototype = element instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

export async function submitReactForm(form) {
  await actAndFlush(() => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
}
