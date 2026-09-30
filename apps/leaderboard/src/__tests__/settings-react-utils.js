import { Window } from "happy-dom";

export const window = new Window({ url: "http://localhost/dashboard/settings/account?siteId=alpha" });
export const { document } = window;

const globals = [
  "window", "document", "location", "history", "navigator", "HTMLElement", "Element", "Node",
  "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "DOMParser", "DocumentFragment",
  "FocusEvent", "HTMLButtonElement", "HTMLFormElement", "HTMLInputElement", "HTMLSelectElement",
  "HTMLTextAreaElement", "MutationObserver", "ShadowRoot", "SVGElement", "getComputedStyle",
  "localStorage", "fetch", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame",
];
const originals = Object.fromEntries(globals.map((key) => [key, globalThis[key]]));

export function installSettingsDomGlobals() {
  for (const key of globals) {
    if (key === "getComputedStyle") globalThis[key] = window.getComputedStyle.bind(window);
    else if (key === "requestAnimationFrame" || key === "cancelAnimationFrame") globalThis[key] = window[key].bind(window);
    else globalThis[key] = window[key];
  }
  window.Element.prototype.scrollIntoView = function () {};
  window.Element.prototype.getClientRects = function () { return [{}]; };
  window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.matchMedia = window.matchMedia;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}

installSettingsDomGlobals();

const shell = await import("../assets/dashboard/shell.js");
export const { requestDashboardRoute } = shell;

const React = await import("react");
export const { act, createElement } = React;
export const { createRoot } = await import("react-dom/client");
const { SettingsPage } = await import("../react/pages/settings/page.tsx");

let root = null;
let mountKey = 0;

export async function flushSettingsUpdates() {
  for (let index = 0; index < 12; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

export async function actAndFlush(callback = () => {}) {
  installSettingsDomGlobals();
  await act(async () => {
    await callback();
    await flushSettingsUpdates();
  });
}

export async function mountSettingsPage({ user = { email: "owner@example.test", boards: [{ id: "alpha", name: "Atlas Community" }] }, tab = "team", url = `/dashboard/settings/${tab === "plan" ? "billing" : tab}?siteId=alpha`, deps = {} } = {}) {
  installSettingsDomGlobals();
  window.history.replaceState({}, "", url);
  document.body.innerHTML = `<main id="acc-app" data-acc-tab="settings" data-settings-active="${tab}"></main>`;
  root = createRoot(document.getElementById("acc-app"));
  const injected = {
    request: async (method, path) => {
      if (path === "/api/auth/me") return { ok: true, data: { ok: true, user } };
      if (path.startsWith("/api/site/team")) return { ok: true, data: { ok: true, siteId: "alpha", siteName: "Atlas Community", currentRole: "owner", canManageTeam: true, members: [], invites: [], seats: { plan: "team", used: 1, limit: 5 } } };
      return { ok: true, data: {} };
    },
    confirm: async () => false,
    copy: async () => true,
    deleteAccount: async () => ({ ok: false, status: 500, data: {} }),
    navigate: () => {},
    ...deps,
  };
  if (!deps.getCurrentUser) {
    injected.getCurrentUser = async () => {
      const result = await injected.request("GET", "/api/auth/me");
      if (result.ok && result.data?.user) return result.data.user;
      throw new Error("Could not load your account.");
    };
  }
  await actAndFlush(() => root.render(createElement(SettingsPage, { key: `settings-test-${++mountKey}`, deps: injected })));
}

export async function unmountSettingsPage() {
  if (!root) return;
  await actAndFlush(() => root.unmount());
  root = null;
}

export function restoreSettingsDomGlobals() {
  for (const key of globals) globalThis[key] = originals[key];
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
