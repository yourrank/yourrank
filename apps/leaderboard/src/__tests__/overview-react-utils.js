import { Window } from "happy-dom";

export const window = new Window({ url: "http://localhost/dashboard" });
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
  "IS_REACT_ACT_ENVIRONMENT", ...browserGlobals,
];
const originalGlobals = Object.fromEntries(installedGlobals.map((key) => [key, globalThis[key]]));

export function installOverviewDomGlobals() {
  for (const key of installedGlobals.slice(0, 14)) {
    globalThis[key] = key === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[key];
  }
  for (const key of browserGlobals) {
    globalThis[key] = key.endsWith("AnimationFrame") ? window[key].bind(window) : window[key];
  }
  window.Element.prototype.scrollIntoView = function () {};
  window.Element.prototype.getClientRects = function () { return [{}]; };
  window.matchMedia = () => ({
    matches: false,
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

installOverviewDomGlobals();

const React = await import("react");
export const { act, createElement } = React;
export const { renderHome, unmountHome } = await import("../react/pages/overview/entry.tsx");
export const builtOverview = await import("../assets/react/overview.js");
const { unmountHome: unmountBuiltHome } = builtOverview;

export async function flushReactUpdates() {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export async function actAndFlush(callback = () => {}) {
  installOverviewDomGlobals();
  await act(async () => {
    await callback();
    await flushReactUpdates();
  });
}

export async function mountHome(vm, actions = {}) {
  installOverviewDomGlobals();
  document.body.innerHTML = '<section data-page="home"><div id="ov-app" class="yr-react"></div></section>';
  const root = document.getElementById("ov-app");
  const injected = {
    retry() {},
    publish() {},
    async saveBrandName() { return { ok: true }; },
    ...actions,
  };
  await actAndFlush(() => renderHome(root, vm, injected));
  return { root, actions: injected };
}

export async function unmountHomePage(root = document.getElementById("ov-app")) {
  if (!root) return;
  await actAndFlush(() => {
    unmountHome(root);
    unmountBuiltHome(root);
  });
}

export async function clickHomeTarget(element) {
  await actAndFlush(() => element.click());
}

export async function setHomeInputValue(element, value) {
  await actAndFlush(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

export function restoreOverviewDomGlobals() {
  for (const key of installedGlobals) globalThis[key] = originalGlobals[key];
}
