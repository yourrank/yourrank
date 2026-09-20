// Dashboard shell: sidebar navigation, mobile drawer, and the one canonical
// client navigation entry point (requestDashboardRoute). Every dashboard
// module requests a destination through it; this module alone decides
// between in-place tab rendering, SPA section switches, dynamic fragment
// loads and full document (cross-worker) navigation, and it alone mutates
// history for dashboard routes.
import { state } from "./state.js";
import { logError, showToast } from "./utils.js";
import { renderOverviewSummary } from "./overview.js";
import { discardEditorChanges, fitDesignPreview, loadStats, refreshDesignPreview, saveEditorDraft } from "./site.js";
import { chromeStateFor, dashboardPath, dashboardTitle, defaultTab, navOwner, parseDashboardPath, resolveSection } from "./routes.js";
import { DYNAMIC_SECTIONS, dynamicPath, dynamicTitle, isDynamicSection, parseDynamicPath } from "./routes.js";
import { loadDynamicSection, leaveDynamicSection } from "./dynamic-section.js";

// Sections are all in one document now, so nothing below reinitializes the
// workspace. Section-specific data (games, analytics) loads on first visit
// through this hook, registered by the entry point to avoid a circular import.
let sectionMounter = null;
export function registerSectionMounter(fn) { sectionMounter = fn; }

let navigationPending = false;
const navigationGuards = new Map();
export function registerNavigationGuard(key, guard) { navigationGuards.set(key, guard); }
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
    const discard = modal.el.querySelector(".dirty-discard");
    // Put Discard on the actions row and move focus back to Save — the dialog
    // focuses the extra element by default, which left Enter one press away
    // from throwing the draft out.
    if (discard) {
      modal.el.querySelector(".modal-actions")?.prepend(discard);
      discard.addEventListener("click", () => modal.close("discard"));
      modal.el.querySelector(".modal-actions .btn--accent")?.focus();
    }
  });
}

async function allowNavigation() {
  for (const guard of navigationGuards.values()) { if (!await guard()) return false; }
  if (!state._dirty) return true;
  const action = await chooseDirtyAction().catch((error) => {
    logError("dirty-modal", error);
    return "cancel";
  });
  if (action === "discard") return "discard";
  // Validation and request failures settle the save immediately. Watching the
  // dirty flag instead left all navigation locked after a failed save.
  if (action === "save") {
    try {
      const saved = await saveEditorDraft();
      if (!saved) revealFirstInvalidField();
      return saved;
    } catch (error) {
      logError("dirty-save", error);
      showToast("Couldn't save your changes. They are still here — try again.", "error");
      return false;
    }
  }
  return false;
}

// A failed save can point at a field in a section that is not on screen; bring
// that section up so the validation message is visible instead of leaving the
// modal reopening with no explanation.
function revealFirstInvalidField() {
  const input = document.querySelector('.lb-page:not(.is-on) [data-touched="1"]');
  if (!input) return;
  const page = input.closest(".lb-page")?.dataset.page;
  if (!page) return;
  navTo(page, "");
  input.focus({ preventScroll: false });
}

/** Provider checkout leaves the workspace through the same unsaved-work guard. */
export async function requestBillingRedirect(url) {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password || !["polar.sh", "sandbox.polar.sh"].includes(target.host)) {
    throw new Error("Invalid billing destination.");
  }
  if (navigationPending) return false;
  navigationPending = true;
  try {
    const permission = await allowNavigation();
    if (!permission) return false;
    if (permission === "discard") discardEditorChanges({ reload: () => location.assign(target.href) });
    else location.assign(target.href);
    return true;
  } finally {
    navigationPending = false;
  }
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

export function syncRouteChrome(page, tab = "") {
  closeDashboardDrawer();
  const resolvedTab = tab || (isDynamicSection(page) ? DYNAMIC_SECTIONS[page].tabs[0] : defaultHash(page));
  const chrome = chromeStateFor(page, resolvedTab, { exact: true });
  setActiveSideNav(isDynamicSection(page) ? DYNAMIC_SECTIONS[page].navKey : page);
  routeCrumbs(page, resolvedTab);
  const heading = document.querySelector("[data-chrome-h1]");
  if (heading && chrome?.tabLabel) heading.textContent = chrome.tabLabel;
  document.title = routeTitle(page, resolvedTab);
}

export async function requestDashboardRoute(page, tab = "", { replace = false, query = location.search, reload = false, force = false } = {}) {
  if (navigationPending) return false;
  const destination = routeDestination(page, tab, query);
  const sameUrl = destination === location.pathname + location.search;
  // Same URL is a no-op unless the caller explicitly asks to re-run it (e.g.
  // re-opening the reward edit form for another id via ?edit=).
  if (sameUrl && !force) { closeDashboardDrawer(); return true; }
  navigationPending = true;
  try {
    const permission = await allowNavigation();
    if (!permission) return false;
    if (permission === "discard") {
      // Discard resets every field, including fields mounted in hidden sections.
      // Re-enter the requested document from saved data, just like editor Discard.
      discardEditorChanges({ reload: () => { location.href = destination; } });
      return true;
    }

    // In-place tab switch: the destination section is already rendered and
    // owns a registered renderer (analytics tabs, settings panels). The
    // entry point updates history, rail, crumbs and title; the renderer
    // repaints the section's panels without a fetch or reload.
    const renderer = routeRenderers[page];
    if (!reload && renderer && currentRoute().page === page) {
      if (sameUrl || replace) history.replaceState(history.state || {}, "", destination);
      else history.pushState({}, "", destination);
      lastRouteUrl = destination;
      syncRouteChrome(page, tab);
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
      syncRouteChrome(page, tab);
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
function closeDashboardDrawer() {
  document.dispatchEvent(new CustomEvent("yr:dashboard-drawer-close", { detail: { returnFocus: false } }));
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
  const DYN_AREA = { redemptions: "credits", engage: "sites", rewards: "sites", audience: "sites", settings: "sites" };
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
  const nav = existing || document.createElement("nav");
  nav.className = "v3-crumbs";
  nav.setAttribute("aria-label", "Breadcrumb");
  nav.innerHTML = crumbs.map((crumb, index) => crumb.href
    ? `<a href="${crumb.href}">${crumb.label}</a>`
    : `<span${index === crumbs.length - 1 ? ' aria-current="page"' : ""}>${crumb.label}</span>`
  ).join('<span class="v3-crumb-sep" aria-hidden="true">/</span>');
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
  // shell-nav.js owns drawer state. This request lets navigation close it
  // without duplicating drawer behavior in the SPA runtime.
  closeDashboardDrawer();
  renderCrumbs(page, scrollHash);
  if (page === "home") renderOverviewSummary();
  if (page === "home" || page === "performance") loadStats();
  // Re-render and re-fit the live preview whenever the Editor becomes visible
  // (updateDesignPreview() no-ops while the section is hidden, so navigating in
  // has to ask for it again).
  if (page === "board" || page === "site") setTimeout(refreshDesignPreview, 0);
  document.title = dashboardTitle({ page, tab: scrollHash });

  // Sync editor sub-tabs when navigating directly to a sub-group.
  if (page === "board") {
    const tabs = document.getElementById("editorTabs");
    if (tabs && tabs._show) tabs._show(scrollHash);
  }

  // A settings tab is a route, not an anchor: keep its heading and tabs visible.
  scrollToHash(page === "site" ? location.hash.slice(1) : scrollHash);
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

// Editor sub-navigation: group the endless controls column into tabs
// (Setup / Players / Design / Share / History) so the form isn't one long scroll.
export function setupEditorTabs() {
    const tabs = document.getElementById("editorTabs");
    if (!tabs || tabs._wired) return;
    tabs._wired = true;
    const controls = document.querySelector(".design-controls");
    const buttons = [...tabs.querySelectorAll(".editor-step")];
    function show(group) {
      const chosen = buttons.find((b) => b.dataset.egroup === group);
      if (chosen?.hasAttribute("data-tabs-legacy") && chosen.hidden) expandTabsLegacy(tabs);
      buttons.forEach((b) => {
        const on = b.dataset.egroup === group;
        b.classList.toggle("is-active", on);
        // The server marks the initially active step with is-on, which carries
        // the same selected weight, so it has to follow the client route too.
        b.classList.toggle("is-on", on);
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
    const initialGroup = currentRoute().tab || location.hash.replace("#", "") || defaultTab("board");
    show(buttons.find((b) => b.dataset.egroup === initialGroup)?.dataset.egroup || defaultTab("board"));
  }

// "More" keeps long-tail tabs out of the default strip: the legacy items are
// plain `[data-tabs-legacy]` siblings of a `[data-tabs-more]` toggle inside the
// same .v3-tabs nav, revealed in place (no dropdown — the strips scroll
// horizontally, which would clip an absolutely-positioned menu).
export function setTabsMore(more, expanded) {
  const strip = more.closest(".v3-tabs");
  if (!strip) return;
  more.setAttribute("aria-expanded", String(expanded));
  more.textContent = expanded ? "Less" : "More";
  strip.querySelectorAll("[data-tabs-legacy]").forEach((el) => { el.hidden = !expanded; });
}

export function expandTabsLegacy(node) {
  const more = node.closest(".v3-tabs")?.querySelector("[data-tabs-more]");
  if (more) setTabsMore(more, true);
}

export function setupShell() {
  if (setupShell._done) return;
  setupShell._done = true;
  setupEditorTabs();

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
    if (state._dirty || navigationGuards.size) {
      navigationPending = true;
      try {
        const permission = await allowNavigation();
        if (!permission) {
          history.pushState(history.state || {}, "", lastRouteUrl);
          return;
        }
        if (permission === "discard") {
          discardEditorChanges();
          return;
        }
      } finally {
        navigationPending = false;
      }
    }
    lastRouteUrl = destination;
    if (isDynamicSection(route.page)) {
      syncRouteChrome(route.page, route.tab);
      // The section is still mounted and renders its own tabs in place: no
      // refetch, just repaint the panels for the restored URL.
      const renderer = routeRenderers[route.page];
      if (renderer) {
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
