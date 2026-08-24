// Dashboard shell: sidebar navigation, mobile drawer, and the one canonical
// client navigation entry point (requestDashboardRoute). Every dashboard
// module requests a destination through it; this module alone decides
// between in-place tab rendering, SPA section switches, dynamic fragment
// loads and full document (cross-worker) navigation, and it alone mutates
// history for dashboard routes.
import { $ } from "./utils.js";
import { clearDirty, state, subscribe } from "./state.js";
import { renderOverviewSummary } from "./overview.js";
import { fitDesignPreview, loadStats, refreshDesignPreview } from "./site.js";
import { chromeStateFor, dashboardPath, dashboardTitle, defaultTab, navOwner, parseDashboardPath, resolveSection } from "./routes.js";
import { DYNAMIC_SECTIONS, dynamicPath, dynamicTitle, isDynamicSection, parseDynamicPath } from "./routes.js";
import { loadDynamicSection, leaveDynamicSection } from "./dynamic-section.js";

// Sections are all in one document now, so nothing below reinitializes the
// workspace. Section-specific data (games, analytics) loads on first visit
// through this hook, registered by the entry point to avoid a circular import.
let sectionMounter = null;
export function registerSectionMounter(fn) { sectionMounter = fn; }

let navigationPending = false;
let lastRouteUrl = location.pathname + location.search;

// Sections that render their own tab switches in place (analytics panels,
// settings panels) register a renderer here. The entry point still owns the
// URL, history behavior and chrome state; the renderer only paints content.
const routeRenderers = {};
export function registerRouteRenderer(page, render) {
  routeRenderers[page] = render;
  return () => { if (routeRenderers[page] === render) delete routeRenderers[page]; };
}

function ensureDialog() {
  if (window.YRDialog) return Promise.resolve(window.YRDialog);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/assets/dialog.js";
    script.onload = () => resolve(window.YRDialog);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function chooseDirtyAction() {
  const dialog = await ensureDialog();
  return new Promise((resolve) => {
    const modal = dialog.open({
      title: "Unsaved changes",
      body: "You have unsaved changes. Save them before leaving, discard them, or cancel navigation?",
      confirmText: "Save",
      cancelText: "Cancel",
      escapeValue: "cancel",
      confirmValue: () => "save",
      onClose: (value) => resolve(value || "cancel"),
      render: (card) => {
        const discard = document.createElement("button");
        discard.type = "button";
        discard.className = "btn btn--sm btn--danger danger dirty-discard";
        discard.textContent = "Discard";
        card.appendChild(discard);
        return discard;
      },
    });
    modal.el.querySelector(".dirty-discard")?.addEventListener("click", () => modal.close("discard"));
  });
}

function saveDraftBeforeNavigation() {
  return new Promise((resolve) => {
    if (!state._dirty) { resolve(true); return; }
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      unsubscribe?.();
      clearTimeout(timer);
      resolve(ok);
    };
    const unsubscribe = subscribe((keys) => {
      if (keys.includes("_dirty") && !state._dirty) finish(true);
    });
    const timer = setTimeout(() => finish(false), 15000);
    const save = $("save");
    if (!save || save.disabled) { finish(false); return; }
    save.click();
  });
}

async function allowNavigation() {
  if (!state._dirty) return true;
  const action = await chooseDirtyAction();
  if (action === "discard") { clearDirty(); return true; }
  if (action === "save") return saveDraftBeforeNavigation();
  return false;
}


const AREA_MAP = { home: "sites", sites: "sites", board: "sites", boards: "sites", games: "sites", site: "sites", performance: "sites" };

export function areaForPage(page) { return AREA_MAP[page] || "sites"; }

function defaultHash(page) { return defaultTab(page); }

/** The section this document was opened at, from the path the Worker served. */
export function currentRoute() {
  return parseDashboardPath(location.pathname) || parseDynamicPath(location.pathname) || { page: "home", tab: "" };
}

/** True when this document is the persistent shell with a dynamic region. */
function hasDynamicRegion() {
  return Boolean(window.__yrSpaShell && document.getElementById("lbDynamic"));
}

function routeDestination(page, tab = "", query = location.search) {
  const suffix = query ? (String(query).startsWith("?") ? String(query) : `?${query}`) : "";
  let base;
  if (isDynamicSection(page)) base = dynamicPath(page, tab);
  else if (resolveSection(page)) base = dashboardPath(page, tab || defaultHash(page));
  // Cross-worker destinations (Telegram) are manifest routes outside this
  // document's section vocabulary; they resolve through the canonical chrome
  // state and end in a full document navigation below.
  else base = chromeStateFor(page, tab)?.canonicalPath || dashboardPath(page, tab || defaultHash(page));
  return base + suffix;
}

function routeTitle(page, tab) {
  return isDynamicSection(page) ? dynamicTitle(page, tab) : dashboardTitle({ page, tab: tab || defaultHash(page) });
}

function routeCrumbs(page, tab) {
  renderCrumbs(page, tab || (isDynamicSection(page) ? DYNAMIC_SECTIONS[page].tabs[0] : defaultHash(page)));
}

export async function requestDashboardRoute(page, tab = "", { replace = false, query = location.search, reload = false, force = false } = {}) {
  if (navigationPending) return false;
  const destination = routeDestination(page, tab, query);
  const sameUrl = destination === location.pathname + location.search;
  // Same URL is a no-op unless the caller explicitly asks to re-run it (e.g.
  // re-opening the reward edit form for another id via ?edit=).
  if (sameUrl && !force) return true;
  navigationPending = true;
  try {
    if (!await allowNavigation()) return false;

    // In-place tab switch: the destination section is already rendered and
    // owns a registered renderer (analytics tabs, settings panels). The
    // entry point updates history, rail, crumbs and title; the renderer
    // repaints the section's panels without a fetch or reload.
    const renderer = routeRenderers[page];
    if (!reload && renderer && currentRoute().page === page) {
      if (sameUrl || replace) history.replaceState(history.state || {}, "", destination);
      else history.pushState({}, "", destination);
      lastRouteUrl = destination;
      setActiveSideNav(isDynamicSection(page) ? DYNAMIC_SECTIONS[page].navKey : page);
      routeCrumbs(page, tab);
      document.title = routeTitle(page, tab);
      renderer({ page, tab, query });
      return true;
    }

    // Dynamic sections (Rewards, Engagement, Audience, Account) load as
    // content fragments inside the persistent shell — no document reload.
    // Only when this document IS the shell: the command palette and other
    // modules import this router from standalone document pages too, where
    // the only correct move is a full navigation.
    if (isDynamicSection(page) && hasDynamicRegion()) {
      if (sameUrl || replace) history.replaceState(history.state || {}, "", destination);
      else history.pushState({}, "", destination);
      lastRouteUrl = destination;
      setActiveSideNav(DYNAMIC_SECTIONS[page].navKey);
      routeCrumbs(page, tab);
      await loadDynamicSection(page, tab || DYNAMIC_SECTIONS[page].tabs[0], { query });
      return true;
    }

    // Navigating from a dynamic section back to a core SPA section: tear
    // down the dynamic content first, then show the SPA section.
    if (!reload && document.querySelector(`section[data-page="${page}"]`)) {
      leaveDynamicSection();
      if (sameUrl || replace) history.replaceState(history.state || {}, "", destination);
      else history.pushState({}, "", destination);
      lastRouteUrl = destination;
      navTo(page, tab);
      return true;
    }

    // Telegram and other cross-worker destinations remain document loads.
    if (reload || !document.querySelector(`section[data-page="${page}"]`)) {
      location.href = destination;
      return true;
    }
    if (sameUrl || replace) history.replaceState(history.state || {}, "", destination);
    else history.pushState({}, "", destination);
    lastRouteUrl = destination;
    navTo(page, tab);
    return true;
  } finally {
    navigationPending = false;
  }
}
function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function setActiveSideNav(page) {
  // `page` may be a SPA section key, a dynamic section key (rewards, giveaways,
  // …), or a rail nav key (redemptions, engage, …). navOwner() normalises all
  // of them to the rail item that should be active.
  const navPage = navOwner(page);
  const area = areaForPage(navPage);
  // Dynamic sections may belong to a different product area than the SPA
  // default; map their rail key to the right area for side-group visibility.
  const DYN_AREA = { redemptions: "credits", engage: "sites", audience: "sites", settings: "sites" };
  const resolvedArea = DYN_AREA[navPage] || area;
  document.querySelectorAll(".lb-side-group").forEach((g) => { g.hidden = (g.dataset.area !== resolvedArea && g.dataset.area !== "all"); });
  document.querySelectorAll(".lb-nav").forEach((n) => {
    const active = n.dataset.nav === navPage;
    n.classList.toggle("is-on", active);
    if (active) n.setAttribute("aria-current", "page");
    else n.removeAttribute("aria-current");
  });
}

// The crumbs are server-rendered for the URL the document was opened at; when
// navigation stays client-side they have to follow along or they keep naming
// the section you came from.
function renderCrumbs(page, tab) {
  const bento = document.querySelector(".lb-bento");
  if (!bento) return;
  const existing = bento.querySelector(":scope > .v3-crumbs");
  const crumbs = chromeStateFor(page, tab || defaultTab(page), { exact: true })?.crumbs || [];
  // Top-level pages intentionally ship no breadcrumb trail.
  if (crumbs.length < 2) {
    existing?.remove();
    return;
  }
  const head = crumbs[0];
  const leaf = crumbs[crumbs.length - 1];
  const nav = existing || document.createElement("nav");
  nav.className = "v3-crumbs";
  nav.setAttribute("aria-label", "Breadcrumb");
  nav.innerHTML = `<a href="${head.href}">${head.label}</a><span class="v3-crumb-sep" aria-hidden="true">/</span><span aria-current="page">${leaf.label}</span>`;
  if (!existing) bento.prepend(nav);
}

export function navTo(page, hash = "") {
  const scrollHash = hash || defaultHash(page);
  const navHash = page === "board" ? hash : scrollHash;

  // Keep the URL on the section actually being shown, without adding an entry:
  // navTo() is also how popstate and boot render, and those must not push.
  const canonical = dashboardPath(page, scrollHash);
  if (canonical !== location.pathname && typeof history.replaceState === "function") {
    history.replaceState(history.state || {}, "", canonical + location.search);
  }

  sectionMounter?.(page);
  routeRenderers[page]?.({ page, tab: scrollHash, query: location.search });
  setActiveSideNav(page, navHash);
  document.querySelectorAll(".lb-page").forEach((p) => p.classList.toggle("is-on", p.dataset.page === page));
  closeDrawer();
  renderCrumbs(page, scrollHash);
  if (page === "home") renderOverviewSummary();
  if (page === "home" || page === "performance") loadStats();
  // Re-render and re-fit the live preview whenever the Editor becomes visible
  // (updateDesignPreview() no-ops while the section is hidden, so navigating in
  // has to ask for it again).
  if (page === "board") setTimeout(refreshDesignPreview, 0);
  document.title = dashboardTitle({ page, tab: scrollHash });

  // Sync editor sub-tabs when navigating directly to a sub-group.
  if (page === "board") {
    const tabs = document.getElementById("editorTabs");
    if (tabs && tabs._show) tabs._show(scrollHash);
  }

  scrollToHash(scrollHash);
}

export function scrollToHash(hash) {
  if (!hash) {
    const main = document.querySelector(".lb-main");
    if (main) main.scrollIntoView({ block: "start" });
    return;
  }
  const target =
    document.getElementById(hash) ||
    document.querySelector(`[data-egroup="${hash}"]`) ||
    document.getElementById(`perf-${hash}`) ||
    document.getElementById(`cr-${hash}`);
  if (target) {
    // If the target is inside a collapsed <details>, open it before scrolling.
    const details = target.closest("details");
    if (details) details.open = true;
    target.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    target.classList.add("is-highlighted");
    setTimeout(() => target.classList.remove("is-highlighted"), 1200);
  }
}

export function openDrawer() {
  const side = $("lbSide");
  const inertSiblings = (container) => {
    for (const child of container.children) {
      if (child === side) continue;
      if (child.contains(side)) inertSiblings(child);
      else child.inert = true;
    }
  };
  if (side) {
    side.classList.add("is-open");
    // The sidebar is a permanent navigation landmark on desktop and only becomes
    // a dialog while it is open as a drawer, so the role goes on here and comes
    // off on close — a static `role="dialog"` hides the nav from assistive tech.
    side.setAttribute("role", "dialog");
    side.setAttribute("aria-modal", "true");
  }
  document.querySelector(".lb-backdrop")?.classList.add("is-open");
  document.querySelectorAll(".lb-menu").forEach((b) => b.setAttribute("aria-expanded", "true"));
  // Inert the background so Tab can't reach content behind the drawer.
  document.querySelectorAll("main:not(.lb-side), header, footer").forEach((el) => {
    if (el === side) return;
    if (!el.contains(side)) {
      el.inert = true;
      return;
    }
    // Some shells wrap both the drawer and page content in the same main.
    // Inert only that wrapper's non-drawer children so the drawer remains
    // interactive while the content behind it is unavailable to AT and input.
    inertSiblings(el);
  });
  const firstNav = side?.querySelector(".lb-nav");
  if (firstNav) setTimeout(() => firstNav.focus(), 0);
  // Focus trap: cycle Tab within the drawer.
  document.addEventListener("keydown", _drawerFocusTrap);
}

export function closeDrawer(focusMenu = true) {
  const side = $("lbSide");
  if (side) {
    side.classList.remove("is-open");
    side.removeAttribute("role");
    side.removeAttribute("aria-modal");
  }
  document.querySelector(".lb-backdrop")?.classList.remove("is-open");
  document.querySelectorAll(".lb-menu").forEach((b) => b.setAttribute("aria-expanded", "false"));
  // Remove inert from background.
  document.querySelectorAll("[inert]").forEach((el) => { el.inert = false; });
  document.removeEventListener("keydown", _drawerFocusTrap);
  if (focusMenu) {
    const menu = document.querySelector(".lb-page.is-on .lb-menu") || document.querySelector(".lb-menu");
    if (menu) setTimeout(() => menu.focus(), 0);
  }
}

// Focus trap handler — keeps Tab within the drawer while it's open.
function _drawerFocusTrap(e) {
  if (e.key !== "Tab") return;
  const side = $("lbSide");
  if (!side || !side.classList.contains("is-open")) return;
  const focusable = side.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// Editor sub-navigation: group the endless controls column into tabs
// (Setup / Players / Design / Share / History) so the form isn't one long scroll.
export function setupEditorTabs() {
    const tabs = document.getElementById("editorTabs");
    if (!tabs || tabs._wired) return;
    tabs._wired = true;
    const controls = document.querySelector(".design-controls");
    const buttons = [...tabs.querySelectorAll(".editor-step")];
    function show(group) {
      buttons.forEach((b) => {
        const on = b.dataset.egroup === group;
        b.classList.toggle("is-active", on);
        // The steps are links to their own URLs, not `role="tab"` controls, so
        // the current one is marked with aria-current; aria-selected is not
        // allowed on a plain link and screen readers ignore it there.
        if (on) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
      });
      if (controls) {
        controls.querySelectorAll("[data-egroup]:not(.editor-step)").forEach((el) => {
          el.hidden = el.dataset.egroup !== group;
        });
      }
      const crumbCurrent = document.querySelector(".v3-crumbs span[aria-current='page']");
      if (crumbCurrent) {
        crumbCurrent.textContent = chromeStateFor("board", group, { exact: true })?.tabLabel || buttons.find((b) => b.dataset.egroup === group)?.textContent.trim() || group;
      }
      // The preview measures off the visible column height; re-fit after toggling.
      setTimeout(fitDesignPreview, 0);
    }
    // Each step is its own URL, so a step can be linked to and Back returns to
    // the previous one instead of leaving the editor entirely.
    buttons.forEach((b) => b.addEventListener("click", (e) => {
      if (b.dataset.egroup === "games") return;
      e.preventDefault();
      requestDashboardRoute("board", b.dataset.egroup);
    }));
    tabs.addEventListener("keydown", (e) => {
      const i = buttons.indexOf(document.activeElement);
      if (i === -1) return;
      let next;
      if (e.key === "ArrowRight") next = buttons[(i + 1) % buttons.length];
      else if (e.key === "ArrowLeft") next = buttons[(i - 1 + buttons.length) % buttons.length];
      if (next) { e.preventDefault(); next.click(); next.focus(); }
    });
    tabs._show = show;
    const initialGroup = currentRoute().tab || location.hash.replace("#", "") || "setup";
    show(buttons.find((b) => b.dataset.egroup === initialGroup)?.dataset.egroup || "setup");
  }

export function setupShell() {
  if (setupShell._done) return;
  setupShell._done = true;
  setupEditorTabs();
  let backdrop = document.querySelector(".lb-backdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.className = "lb-backdrop";
    document.body.appendChild(backdrop);
  }
  backdrop.addEventListener("click", () => closeDrawer());

  // Sidebar links are plain links to other documents; they only need
  // interception when they move within this one (and to guard unsaved work).
  document.querySelectorAll(".lb-nav[data-nav]").forEach((link) => link.addEventListener("click", (e) => {
    const href = link.getAttribute("href") || "";
    const path = new URL(href, location.origin).pathname;
    const route = parseDashboardPath(path);
    if (route) {
      e.preventDefault();
      // Navigate by the section the href resolves to, not the rail key. The "Sites"
      // item is keyed `sites` (its nav-owner name) but addresses the `boards`
      // section; passing dataset.nav here ran resolveSection("sites") → "" and
      // fell back to /dashboard, so clicking Sites rebooted to Home.
      requestDashboardRoute(route.page, route.tab || link.dataset.hash || defaultHash(route.page));
      return;
    }
    // Dynamic sections (Rewards, Engagement, Audience, Account) are also
    // intercepted so they load as fragments inside the persistent shell.
    // The query comes from the link's own href (preserveSiteContextLinks
    // stamps ?siteId= there), so one-shot params like ?edit= don't leak.
    const dynRoute = parseDynamicPath(path);
    if (dynRoute) {
      e.preventDefault();
      requestDashboardRoute(dynRoute.page, dynRoute.tab, { query: new URL(href, location.origin).search });
    }
  }));
  document.querySelectorAll("[data-jump]").forEach((el) => el.addEventListener("click", (e) => {
    e.preventDefault();
    requestDashboardRoute(el.dataset.jump, defaultHash(el.dataset.jump));
  }));
  document.querySelectorAll(".lb-menu").forEach((btn) => btn.addEventListener("click", (e) => { e.stopPropagation(); openDrawer(); }));
  document.querySelectorAll("[data-close-side]").forEach((btn) => btn.addEventListener("click", () => closeDrawer()));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("lbSide")?.classList.contains("is-open")) { e.preventDefault(); closeDrawer(); } });

  // The signed-in dashboard renders no second product navigation: the rail is
  // canonical, and dashboard documents are built with `nav: false`, so the old
  // `.gm-tab` top switcher never appears here. (The public Help header still
  // ships its own tabs via /assets/shell-nav.js, untouched by this shell.)

  // The profile dropdown's open/close behaviour ships with the header itself
  // (/assets/shell-nav.js) so it is identical on every Worker.

  // Handle browser back/forward inside the SPA. The browser has already moved
  // the URL when popstate fires, so canceling restores the last rendered URL.
  window.addEventListener("popstate", async () => {
    if (navigationPending) return;
    const destination = location.pathname + location.search;
    const route = currentRoute();
    if (state._dirty) {
      navigationPending = true;
      try {
        if (!await allowNavigation()) {
          history.pushState(history.state || {}, "", lastRouteUrl);
          return;
        }
      } finally {
        navigationPending = false;
      }
    }
    lastRouteUrl = destination;
    if (isDynamicSection(route.page)) {
      setActiveSideNav(DYNAMIC_SECTIONS[route.page].navKey);
      // The section is still mounted and renders its own tabs in place: no
      // refetch, just repaint the panels for the restored URL.
      routeCrumbs(route.page, route.tab);
      const renderer = routeRenderers[route.page];
      if (renderer) {
        document.title = routeTitle(route.page, route.tab);
        renderer({ page: route.page, tab: route.tab, query: location.search });
        return;
      }
      // Back/forward into a dynamic section: load it as a fragment, preserving
      // the query string (?edit=, ?siteId=) so deep-linked state survives.
      await loadDynamicSection(route.page, route.tab, { query: location.search });
    } else {
      // Back/forward into a core SPA section: tear down any dynamic
      // content, then show the SPA section.
      leaveDynamicSection();
      navTo(route.page, route.tab);
    }
  });

  // Catch-all for internal dashboard links rendered or re-rendered after
  // boot (dynamic-section fragments re-render panels as data loads, long
  // after any per-element wiring ran): route them through the shell instead
  // of a document reload. Links with dedicated handlers above preventDefault
  // first and are skipped here; cross-worker destinations (Telegram) and
  // external/anchor links parse to no route and load normally.
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target?.closest?.("a[href]");
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
    const href = link.getAttribute("href") || "";
    if (!href.startsWith("/") || href.startsWith("//")) return;
    const url = new URL(href, location.origin);
    if (url.origin !== location.origin) return;
    const route = parseDynamicPath(url.pathname) || parseDashboardPath(url.pathname);
    if (!route) return;
    e.preventDefault();
    requestDashboardRoute(route.page, route.tab || defaultHash(route.page), { query: url.search });
  });
}
