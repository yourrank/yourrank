import { Window } from "happy-dom";

export const window = new Window({ url: "http://localhost/admin" });
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
  "DOMParser", "getComputedStyle", "localStorage", "ResizeObserver", "matchMedia", "fetch",
  ...browserGlobals,
];
const originalGlobals = Object.fromEntries(installedGlobals.map((key) => [key, globalThis[key]]));

export function installAdminDomGlobals() {
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

installAdminDomGlobals();

const React = await import("react");
export const { act, createElement } = React;
export const { createRoot } = await import("react-dom/client");
const { AdminPage } = await import("../react/pages/admin/page.tsx");
const { AdminTwoFactorPage } = await import("../react/pages/admin-2fa/page.tsx");

let root = null;
let mountKey = 0;

export async function flushReactUpdates() {
  for (let index = 0; index < 12; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export async function actAndFlush(callback = () => {}) {
  installAdminDomGlobals();
  await act(async () => {
    await callback();
    await flushReactUpdates();
  });
}

function setShell(page) {
  document.body.innerHTML = page === "admin"
    ? '<header><div id="admin-topbar-controls"></div></header><main><div class="yr-react" id="admin-app"><div id="loading"></div></div></main>'
    : '<header><div id="admin-2fa-topbar-controls"></div></header><main><div class="yr-react" id="admin-2fa-app"><div id="tfaLoading"></div></div></main>';
  document.cookie = "__csrf=csrf-test-token; path=/";
}

async function mountPage(page, Component, dependencies = {}) {
  installAdminDomGlobals();
  setShell(page);
  const container = document.getElementById(page === "admin" ? "admin-app" : "admin-2fa-app");
  root = createRoot(container);
  const injected = {
    navigate: () => {},
    fetcher: (...args) => globalThis.fetch(...args),
    ...dependencies,
  };
  const key = `admin-test-${++mountKey}`;
  await actAndFlush(() => root.render(createElement(Component, { key, dependencies: injected })));
}

export async function mountAdminPage(dependencies = {}) {
  await mountPage("admin", AdminPage, dependencies);
}

export async function mountAdminTwoFactorPage(dependencies = {}) {
  await mountPage("admin-2fa", AdminTwoFactorPage, dependencies);
}

export async function unmountAdminPage() {
  if (root) {
    await actAndFlush(() => root.unmount());
    root = null;
  }
}

export function restoreAdminDomGlobals() {
  for (const key of installedGlobals) globalThis[key] = originalGlobals[key];
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const adminPayloads = {
  me: { ok: true, user: { email: "operator@example.com" } },
  overview: { users: 2, paid: 1, leads: 3, revenue: 72 },
  users: {
    users: [
      { id: "user-1", email: "ava@example.com", slug: "ava", plan: "pro", plan_expires_at: null, status: "active", totp_enabled: true, player_count: 8, created_at: 1700000000000 },
      { id: "user-2", email: "ben@example.com", status: "suspended", suspension_reason: "Chargeback", created_at: 1690000000000 },
    ],
    total: 120,
    pageSize: 50,
  },
  leads: {
    leads: [{ id: "lead-1", handle: "ava", brand: "Example Sponsor", contact: "ava@example.com", note: "Interested", created_at: 1700000000000 }],
    total: 1,
    pageSize: 50,
  },
  payments: {
    payments: [{ id: "payment-1", email: "ava@example.com", provider: "manual", amount_usd: 12, status: "finished", created_at: 1700000000000 }],
    total: 1,
    pageSize: 50,
  },
  support: {
    messages: [{ id: "support-1", name: "Ava", email: "ava@example.com", subject: "Need help", message: "Please help", created_at: 1700000000000 }],
    total: 1,
    pageSize: 50,
  },
  features: { flags: [{ key: "new_dashboard", name: "New dashboard", description: "Updated dashboard", defaultValue: false }] },
  audit: {
    events: [{ id: "audit-1", actor_email: "operator@example.com", action: "plan.updated", entity_id: "user-1", details: { plan: "pro" }, created_at: 1700000000000 }],
    total: 1,
    pageSize: 50,
  },
  identity: {
    ok: true,
    identity: {
      company_name: "YourRank Ltd",
      company_country: "United Kingdom",
      company_number: "12345678",
      support_email: "support@example.com",
      affiliate_disclosure: "Some links are affiliate links.",
      complete: true,
    },
  },
};

export function defaultAdminPayload(pathname) {
  if (pathname === "/api/auth/me") return adminPayloads.me;
  if (pathname === "/api/admin/overview") return adminPayloads.overview;
  if (pathname === "/api/admin/users") return adminPayloads.users;
  if (pathname === "/api/admin/leads") return adminPayloads.leads;
  if (pathname === "/api/admin/payments") return adminPayloads.payments;
  if (pathname === "/api/admin/support") return adminPayloads.support;
  if (pathname === "/api/admin/features") return adminPayloads.features;
  if (pathname === "/api/admin/audit") return adminPayloads.audit;
  if (pathname === "/api/admin/identity") return adminPayloads.identity;
  return { ok: true };
}

export function clickTarget(element) {
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
  element.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0 }));
  element.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
}

export async function clickReactTarget(element) {
  await actAndFlush(() => clickTarget(element));
}

export async function setReactValue(element, value, eventName = "input") {
  await actAndFlush(() => {
    const prototype = element instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : element instanceof window.HTMLSelectElement
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new window.Event(eventName, { bubbles: true }));
  });
}

export async function keyReactTarget(element, key) {
  await actAndFlush(() => element.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key })));
}
