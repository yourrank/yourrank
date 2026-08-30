// Dynamic section loader: fetches content fragments for the dashboard areas
// that were formerly separate documents (Activities, Engagement, Rewards,
// Audience, Account) and manages their boot lifecycle within the persistent shell.
//
// Flow:
//   click → requestDashboardRoute (shell.js)
//         → loadDynamicSection (here)
//         → abort previous navigation
//         → run previous section's leave()
//         → show local loading state
//         → fetch /dashboard/_content?path=<route>
//         → ensure the stylesheets that fragment declares are usable
//         → inject HTML into the dynamic content region
//         → dynamically import the boot module
//         → call module.enter()
//         → update title / nav / topbar
//
// On the next navigation away, leave() is called to tear down timers,
// WebSockets, intervals and document-level listeners so nothing leaks.

import { $ } from "./utils.js";
import { renderError } from "./states.js";
import { DYNAMIC_SECTIONS, dynamicPath, dynamicTitle, parseDynamicPath } from "./routes.js";
import { clearSession } from "./session.js";
import { loginRedirectPath } from "./request.js";

// Statically-referenced lazy importers so the bundler can resolve them.
const BOOT_IMPORTERS = {
  activities: () => import("../activities.js"),
  credits: () => import("../credits.js"),
  giveaways: () => import("../giveaways.js"),
  account: () => import("../account.js"),
  people: () => import("../people.js"),
};

// Cached boot modules so we don't re-import on every visit.
const bootModuleCache = {};

// In-flight/settled stylesheet requests keyed by absolute URL, so repeated
// navigation reuses the one link element the first visit inserted.
const styleRequests = new Map();

// A stylesheet that never loads must not hang navigation forever.
const STYLE_TIMEOUT_MS = 10000;

/** Absolute form of a stylesheet URL, so equivalent spellings compare equal. */
function styleKey(href) {
  try { return new URL(href, location.href).href; } catch { return String(href); }
}

/** The stylesheet link already in the document for this URL, if any. */
function existingStyleLink(key) {
  return [...document.querySelectorAll('link[rel="stylesheet"][href]')]
    .find((link) => styleKey(link.getAttribute("href")) === key) || null;
}

/**
 * Resolve once `href` is usable in the document. An already-present sheet
 * resolves immediately (its load event may have fired long ago); a newly
 * inserted link resolves on load and rejects on error.
 *
 * @param {string} href
 * @returns {Promise<void>}
 */
function ensureStyle(href) {
  const key = styleKey(href);
  const pending = styleRequests.get(key);
  if (pending) return pending;

  const existing = existingStyleLink(key);
  // `link.sheet` is only non-null once the stylesheet has been parsed, which
  // covers the cached case where no event is coming.
  if (existing?.sheet) return Promise.resolve();

  let requested = null;
  const request = new Promise((resolve, reject) => {
    const link = existing || document.createElement("link");
    requested = link;
    let done = false;
    const settle = (fn, arg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      link.removeEventListener("load", onLoad);
      link.removeEventListener("error", onError);
      fn(arg);
    };
    const onLoad = () => settle(resolve);
    const onError = () => settle(reject, new Error(`Failed to load ${href}`));
    const timer = setTimeout(() => settle(reject, new Error(`Timed out loading ${href}`)), STYLE_TIMEOUT_MS);

    link.addEventListener("load", onLoad);
    link.addEventListener("error", onError);
    if (!existing) {
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    }
  });

  // A failed load is not cached: the retry path gets a fresh attempt. The link
  // is dropped too — a browser leaves a rule-less sheet attached to a link
  // whose load failed, so keeping it would make the next attempt resolve from
  // dead markup instead of issuing a request.
  styleRequests.set(key, request);
  request.catch(() => {
    styleRequests.delete(key);
    requested?.remove();
  });
  return request;
}

/**
 * Ensure every stylesheet a fragment declares is usable before its markup is
 * shown. Rejects if one fails, so the caller can use the section error path.
 *
 * @param {string[]} hrefs
 */
export function ensureStyles(hrefs) {
  const seen = new Set();
  const unique = (hrefs || []).filter((href) => {
    if (!href) return false;
    const key = styleKey(href);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return Promise.all(unique.map((href) => ensureStyle(href))).then(() => undefined);
}

let currentController = null;
let currentLeave = null;
let currentBootKey = null;
// Token that increments on every navigation; a late-finishing boot checks
// this before rendering to avoid stomping a newer section.
let navToken = 0;

/**
 * Load a dynamic section into the persistent shell.
 *
 * @param {string} page  Dynamic section key (rewards, giveaways, audience, settings)
 * @param {string} tab   Tab within the section
 * @param {object} opts  { replace, query }
 * @returns {Promise<boolean>} true if the section loaded successfully
 */
export async function loadDynamicSection(page, tab = "", { query = "" } = {}) {
  const section = DYNAMIC_SECTIONS[page];
  if (!section) return false;

  // Abort any in-flight fragment fetch and tear down the previous section.
  if (currentController) {
    currentController.abort();
    currentController = null;
  }
  if (currentLeave) {
    try { currentLeave(); } catch (e) { console.error("dynamic-section leave failed", e); }
    currentLeave = null;
  }

  const myToken = ++navToken;
  const controller = new AbortController();
  currentController = controller;

  const path = dynamicPath(page, tab);
  const fullUrl = path + (query || "");

  // Show local loading state inside the content region — the shell (rail,
  // topbar, site selector) stays visible and stable.
  const container = $("lbDynamic");
  if (!container) return false;
  showLocalLoading(container);

  // Hide all SPA sections; show the dynamic content region.
  hideSpaSections();
  container.hidden = false;

  // Toggle topbar controls to match this section's board context.
  setTopbarContext(section.boardContext);

  try {
    const params = new URLSearchParams({ path: fullUrl });
    const res = await fetch(`/dashboard/_content?${params}`, {
      signal: controller.signal,
      credentials: "same-origin",
      headers: { "accept": "application/json" },
    });
    if (!res.ok) {
      // A 401 means the session expired mid-navigation. A Retry button cannot
      // fix an expired session, so clear the cached identity and redirect to
      // login with a return URL — the same flow every other 401 uses.
      if (res.status === 401) {
        clearSession();
        if (myToken === navToken) location.href = loginRedirectPath(location);
        return false;
      }
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "You don't have permission to view this section.");
      }
      throw new Error(`Failed to load section (HTTP ${res.status})`);
    }
    const data = await res.json();

    // Stale-response guard: if the user navigated again while we were fetching,
    // discard this result entirely.
    if (myToken !== navToken) return false;

    // The fragment's markup is styled by the destination's own stylesheets,
    // so they have to be usable before it becomes visible — otherwise the
    // section paints unstyled until the CSS arrives.
    await ensureStyles(data.styles);
    if (myToken !== navToken) return false;

    // Inject the fragment HTML. Links inside the fragment (sub-tabs and
    // links to other dashboard sections) are routed through the shell by
    // the delegated click handler setupShell() installs on the document —
    // which also covers panels the boot module re-renders later on.
    container.innerHTML = data.html;

    // Update the document title.
    document.title = data.title || dynamicTitle(page, tab);

    // Boot the section's client module.
    const bootKey = section.boot;
    let mod = bootModuleCache[bootKey];
    if (!mod) {
      mod = await BOOT_IMPORTERS[bootKey]();
      bootModuleCache[bootKey] = mod;
    }
    // Stale guard after the async import.
    if (myToken !== navToken) {
      // We navigated away during the import; don't enter.
      return false;
    }

    if (mod.enter) {
      const enterResult = mod.enter({ tab, page, signal: controller.signal });
      if (enterResult && typeof enterResult.then === "function") {
        await enterResult;
      }
    }
    currentLeave = mod.leave || null;
    currentBootKey = bootKey;

    // Move focus to the new section so keyboard and screen-reader users
    // arrive with the content, not stranded on the sidebar link they
    // activated. The heading is given a temporary tabindex so it can receive
    // focus without being added to the normal Tab order.
    if (myToken === navToken) {
      const heading = container.querySelector("h1, h2, [data-focus-target]");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
    }

    // Signal boot completion for the watchdog.
    window.__yrBoot?.signal();

    return true;
  } catch (err) {
    if (err?.name === "AbortError" || controller.signal.aborted) {
      // Navigation was superseded — not an error.
      return false;
    }
    if (myToken !== navToken) return false;
    console.error("dynamic-section load failed", err);
    showLocalError(container, err);
    window.__yrBoot?.signal();
    return false;
  }
}

/**
 * Tear down the current dynamic section (if any) and hide the content region.
 * Called when navigating back to an SPA section.
 */
export function leaveDynamicSection() {
  if (currentController) {
    currentController.abort();
    currentController = null;
  }
  if (currentLeave) {
    try { currentLeave(); } catch (e) { console.error("dynamic-section leave failed", e); }
    currentLeave = null;
  }
  currentBootKey = null;
  const container = $("lbDynamic");
  if (container) {
    container.hidden = true;
    container.innerHTML = "";
  }
  // Restore the full topbar (site selector + publish controls).
  restoreTopbarContext();
}

/** Show a local loading skeleton inside the content region. */
function showLocalLoading(container) {
  container.innerHTML = `<div class="lb-dynamic-loading" role="status" aria-live="polite" aria-busy="true"><div class="ui-loading__spinner" aria-hidden="true"></div><span class="sr-only">Loading…</span></div>`;
}

/**
 * Toggle topbar controls to match the active section's board context.
 * - "full": site selector + publish controls (core SPA sections)
 * - "selector": site selector only (Rewards, Engagement, Audience)
 * - "none": account context, no site selector (Account settings)
 */
function setTopbarContext(context) {
  const availability = document.querySelector(".lb-availability");
  const siteCommand = document.querySelector(".lb-site-command");
  const accountHud = document.querySelector(".lb-account-hud");
  if (availability) {
    // Publish controls only show for "full" context (core SPA sections). The
    // publication state owns whether the live link and draft chip are visible
    // within that context, so this only ever hides them; #pubToggle is an
    // internal form input and stays hidden in every context.
    const showPublish = context === "full";
    const publishAction = availability.querySelector("#publishAction");
    if (publishAction) publishAction.hidden = !showPublish;
    if (!showPublish) {
      availability.querySelectorAll("#liveLink, #lbTopbarDraft").forEach((el) => {
        el.hidden = true;
      });
    }
    const pubToggle = document.getElementById("pubToggle");
    if (pubToggle) pubToggle.hidden = true;
  }
  if (siteCommand) siteCommand.hidden = context === "none";
  if (accountHud) accountHud.hidden = context !== "none";
}

/** Restore topbar to full context (when returning to core SPA sections). */
export function restoreTopbarContext() {
  setTopbarContext("full");
}

/** Show a local error state with a retry button inside the content region. */
function showLocalError(container, err) {
  const message = err?.message || "The section could not be loaded.";
  renderError(container, {
    title: "Couldn't load this section.",
    body: message,
    retry: () => { const route = parseDynamicPath(location.pathname); if (route) loadDynamicSection(route.page, route.tab); },
  });
}

/** Hide all SPA `.lb-page` sections. */
function hideSpaSections() {
  document.querySelectorAll(".lb-page[data-page]").forEach((s) => {
    if (s.dataset.page !== "dynamic") s.classList.remove("is-on");
  });
}

/** Show an SPA section and hide the dynamic content region. */
export function showSpaSection(page) {
  const container = $("lbDynamic");
  if (container) {
    container.hidden = true;
    container.innerHTML = "";
  }
  document.querySelectorAll(".lb-page[data-page]").forEach((s) => {
    s.classList.toggle("is-on", s.dataset.page === page);
  });
}

/** true if a dynamic section is currently active. */
export function isDynamicActive() {
  return currentLeave !== null || currentBootKey !== null;
}
