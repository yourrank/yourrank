import { Window } from "happy-dom";

export const window = new Window({ url: "http://localhost/dashboard/activities?siteId=site-1" });
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

export function installActivitiesDomGlobals() {
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
  window.__yrSpaShell = true;
  window.__yrBoot = { signal() {}, fail() {} };
}

installActivitiesDomGlobals();

const React = await import("react");
export const { act, createElement } = React;
export const { createRoot } = await import("react-dom/client");
const { ActivitiesPage } = await import("../react/pages/activities/page.tsx");
const { api } = await import("../react/lib/api.ts");

let root = null;
let mountKey = 0;

export async function flushActivitiesUpdates() {
  for (let index = 0; index < 12; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export async function activitiesAct(callback = () => {}) {
  installActivitiesDomGlobals();
  await act(async () => {
    await callback();
    await flushActivitiesUpdates();
  });
}

export async function mountActivitiesPage({ site = {}, deps = {}, hash = "" } = {}) {
  installActivitiesDomGlobals();
  if (root) await unmountActivitiesPage();
  window.history.replaceState(null, "", `/dashboard/activities?siteId=${site.id || "site-1"}${hash}`);
  document.body.innerHTML = '<main id="act-dash"><div id="activities-root" class="yr-react"></div></main>';
  root = createRoot(document.getElementById("activities-root"));
  const injected = {
    api,
    loadBoardShell: async () => ({ activeSiteId: site.id || "site-1", board: site }),
    preserveSiteContextLinks() {},
    showToast() {},
    wirePlanLock() {},
    loginRedirectPath: (locationLike) => `/login?next=${encodeURIComponent(`${locationLike.pathname}${locationLike.search}`)}`,
    ...deps,
  };
  await activitiesAct(() => {
    root.render(createElement(ActivitiesPage, { key: `activities-test-${++mountKey}`, deps: injected }));
  });
}

export async function unmountActivitiesPage() {
  if (!root) return;
  const current = root;
  root = null;
  await activitiesAct(() => current.unmount());
}

export function restoreActivitiesDomGlobals() {
  for (const key of installedGlobals) globalThis[key] = originalGlobals[key];
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}

export function fireActivityClick(element) {
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
}

export async function clickActivity(element) {
  await activitiesAct(() => fireActivityClick(element));
}

export async function setActivityInput(element, value) {
  await activitiesAct(() => {
    const prototype = element instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

export async function setActivitySelect(element, value) {
  await activitiesAct(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

export async function submitActivityForm(form) {
  await activitiesAct(() => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
}
