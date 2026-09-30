import { Window } from "happy-dom";

export const window = new Window({
  url: "http://localhost/dashboard/giveaways/tournaments?siteId=site-1",
});
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

export function installTournamentDomGlobals() {
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

installTournamentDomGlobals();

const React = await import("react");
export const { act, createElement } = React;
export const { createRoot } = await import("react-dom/client");
const { TournamentsPage } = await import("../react/pages/tournaments/page.tsx");
const { api } = await import("../react/lib/api.ts");

let root = null;
let mountKey = 0;

export async function flushReactUpdates() {
  for (let index = 0; index < 12; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export async function actAndFlush(callback = () => {}) {
  installTournamentDomGlobals();
  await act(async () => {
    await callback();
    await flushReactUpdates();
  });
}

export async function mountTournamentPage({ site = {}, deps = {} } = {}) {
  installTournamentDomGlobals();
  if (!document.getElementById("tournament-root")) {
    document.body.innerHTML = '<main id="tournament-app"><div id="tournament-root" class="yr-react"></div></main>';
  }
  const container = document.getElementById("tournament-root");
  if (!root) root = createRoot(container);

  const injected = {
    api,
    loadBoardShell: async () => ({ activeSiteId: site.id || "site-1", board: site }),
    connectKickChat: () => ({ close() {} }),
    fetch: (...args) => globalThis.fetch(...args),
    ...deps,
  };
  const key = `tournament-test-${++mountKey}`;
  await actAndFlush(() => {
    root.render(createElement(TournamentsPage, { key, deps: injected }));
  });
}

export async function unmountTournamentPage() {
  if (!root) return;
  await actAndFlush(() => root.unmount());
  root = null;
}

export function restoreTournamentDomGlobals() {
  for (const key of installedGlobals) globalThis[key] = originalGlobals[key];
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}

export function firePointerClick(element) {
  const pointerDown = new window.MouseEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
  });
  element.dispatchEvent(pointerDown);
  element.dispatchEvent(new window.MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
  }));
  element.dispatchEvent(new window.MouseEvent("pointerup", {
    bubbles: true,
    cancelable: true,
    button: 0,
  }));
  element.dispatchEvent(new window.MouseEvent("mouseup", {
    bubbles: true,
    cancelable: true,
    button: 0,
  }));
  element.dispatchEvent(new window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
  }));
}

export async function clickReactTarget(element) {
  await actAndFlush(() => firePointerClick(element));
}

export async function setReactInputValue(element, value, eventName = "input") {
  await actAndFlush(() => {
    const prototype = element instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new window.Event(eventName, { bubbles: true }));
  });
}
