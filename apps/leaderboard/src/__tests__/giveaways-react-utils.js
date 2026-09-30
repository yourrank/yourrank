import { Window } from "happy-dom";

export const window = new Window({ url: "http://localhost/dashboard/giveaways/chat?siteId=site-1" });
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
  "DOMParser", "getComputedStyle", "matchMedia", "localStorage", "fetch",
  "ResizeObserver", ...browserGlobals,
];
const originalGlobals = Object.fromEntries(installedGlobals.map((key) => [key, globalThis[key]]));
const realSetTimeout = globalThis.setTimeout;

export function installGiveawaysDomGlobals() {
  for (const key of installedGlobals.slice(0, 14)) {
    globalThis[key] = key === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[key];
  }
  for (const key of browserGlobals) {
    globalThis[key] = key.endsWith("AnimationFrame") ? window[key].bind(window) : window[key];
  }
  window.Element.prototype.scrollIntoView = function () {};
  window.Element.prototype.getClientRects = function () { return [{}]; };
  if (!window.Element.prototype.scrollTo) window.Element.prototype.scrollTo = function () {};
  window.matchMedia ||= (query) => ({
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
  globalThis.localStorage = window.localStorage;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}

installGiveawaysDomGlobals();

const React = await import("react");
export const { act, createElement } = React;
export const { createRoot } = await import("react-dom/client");
const { GiveawaysPage } = await import("../react/pages/giveaways/page.tsx");
const { api } = await import("../react/lib/api.ts");

let root = null;
let mountKey = 0;

export async function flushGiveawaysReactUpdates() {
  await new Promise((resolve) => realSetTimeout(resolve, 0));
}

export async function actGiveaways(callback = () => {}) {
  installGiveawaysDomGlobals();
  await act(async () => {
    await callback();
    await flushGiveawaysReactUpdates();
  });
}

export function clickGiveaways(target) {
  let result;
  act(() => { result = target?.click(); });
  return result;
}

export function dispatchGiveaways(target, event) {
  let result = false;
  act(() => { result = target.dispatchEvent(event); });
  return result;
}

export function setGiveawaysInputValue(target, value, eventName = "input") {
  act(() => {
    const prototype = target instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(target, value);
    target.dispatchEvent(new window.Event(eventName, { bubbles: true }));
  });
}

export async function mountGiveawaysPage({ tab = "chat", site = {}, deps = {} } = {}) {
  installGiveawaysDomGlobals();
  let container = document.getElementById("giveaway-root");
  if (!container) {
    document.body.innerHTML = `<main id="giveaway-app"><div id="giveaway-root" class="yr-react"></div></main>`;
    container = document.getElementById("giveaway-root");
  }
  container.setAttribute("data-tab", tab);
  if (!root) root = createRoot(container);

  const injected = {
    api,
    loadBoardShell: async () => ({ activeSiteId: site.id || "site-1", board: site }),
    ...deps,
  };
  const key = `giveaways-test-${++mountKey}`;
  await actGiveaways(() => {
    root.render(createElement(GiveawaysPage, { key, initialTab: tab, dependencies: injected }));
  });
}

export async function unmountGiveawaysPage() {
  if (!root) return;
  await actGiveaways(() => root.unmount());
  root = null;
}

export function restoreGiveawaysDomGlobals() {
  for (const key of installedGlobals) {
    if (originalGlobals[key] === undefined) delete globalThis[key];
    else globalThis[key] = originalGlobals[key];
  }
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
