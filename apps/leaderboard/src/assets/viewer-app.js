// One persistent viewer shell. Documents remain the canonical route/render
// owner; this enhancement swaps their content without retaining private page
// responses, and it owns the rail's narrow-width disclosure and the account
// logout control — both chrome-level, so they survive page-to-page navigation.
(function () {
  "use strict";
  if (window.YRViewerApp || !document.body.classList.contains("viewer-shell")) return;
  var pending;
  var sequence = 0;
  var currentUrl = location.href;
  var selectedSlug = document.body.dataset.slug || "";
  var loaded = {};
  var notice = document.createElement("p");
  notice.className = "viewer-navigation-status";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  document.querySelector(".viewer-layout").appendChild(notice);

  function rememberCommunity() {
    var slug = document.body.dataset.slug;
    if (slug) selectedSlug = slug;
    document.querySelectorAll('a[href]').forEach(function (link) {
      var raw = link.getAttribute("href") || "";
      if (raw.charAt(0) === "#") return; // fragment links are never destinations
      var url = new URL(link.href, location.href);
      if (selectedSlug && /^\/me(?:\/|$)/.test(url.pathname) && (url.origin !== location.origin || document.body.dataset.customDomain !== "true")) {
        url.searchParams.set("community", selectedSlug);
        link.href = url.href;
      }
    });
  }

  // The rail's narrow-width disclosure: menu opens it as a modal drawer,
  // scrim/Escape/a chosen destination close it, focus returns to the trigger.
  var rail = document.querySelector(".viewer-rail");
  var railMenu = document.querySelector("[data-nav-menu]");
  var railScrim = document.querySelector("[data-nav-scrim]");
  var railClose = document.querySelector("[data-nav-close]");
  var railOpener = null;
  function setRailOpen(open) {
    if (!rail) return;
    rail.dataset.open = open ? "true" : "";
    if (railScrim) railScrim.hidden = !open;
    if (railMenu) railMenu.setAttribute("aria-expanded", open ? "true" : "false");
    document.body.classList.toggle("viewer-nav-open", open);
    if (open) {
      railOpener = document.activeElement;
      window.setTimeout(function () { (railClose || rail).focus(); }, 0);
    } else if (railOpener) {
      railOpener.focus();
      railOpener = null;
    }
  }
  if (railMenu) { railMenu.dataset.bound = "1"; railMenu.addEventListener("click", function () { setRailOpen(rail && rail.dataset.open !== "true"); }); }
  if (railClose) { railClose.dataset.bound = "1"; railClose.addEventListener("click", function () { setRailOpen(false); }); }
  if (railScrim) { railScrim.dataset.bound = "1"; railScrim.addEventListener("click", function () { setRailOpen(false); }); }
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && rail && rail.dataset.open === "true") setRailOpen(false);
  });

  // Account chrome logout — POST /api/viewer/logout, then land back on /me.
  document.addEventListener("click", function (event) {
    var logout = event.target.closest("[data-viewer-logout]");
    if (!logout) return;
    event.preventDefault();
    if (logout.disabled) return;
    logout.disabled = true;
    fetch("/api/viewer/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-csrf-token": (document.querySelector('meta[name="csrf-token"]') || {}).content || "" },
    }).then(function () { location.assign("/me"); })
      .catch(function () { location.assign("/me"); });
  });

  function updateNavigation() {
    document.querySelectorAll('.viewer-rail a[aria-current]').forEach(function (link) {
      link.removeAttribute("aria-current");
      link.classList.remove("is-on");
    });
    document.querySelectorAll('.viewer-rail .viewer-nav-link[href]').forEach(function (link) {
      var target = new URL(link.href, location.href);
      var active = target.origin === location.origin && target.pathname === location.pathname;
      if (active) {
        link.setAttribute("aria-current", "page");
        link.classList.add("is-on");
      }
    });
    rememberCommunity();
  }
  function loadAsset(src, initName, module) {
    if (window[initName]) return Promise.resolve(window[initName]());
    if (!loaded[src]) loaded[src] = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      if (module) script.type = "module";
      script.onload = resolve;
      script.onerror = function () { delete loaded[src]; script.remove(); reject(new Error("Page controls could not load.")); };
      document.body.appendChild(script);
    });
    return loaded[src];
  }
  async function mount() {
    await loadAsset("/assets/site-shell.js", "YRInitSitePage", false);
    if (document.querySelector("[data-va-page]")) {
      await loadAsset("/assets/viewer-account.js", "YRInitViewerAccount", true);
      await window.__yrViewerReady;
    }
    if (document.getElementById("contactForm")) await loadAsset("/assets/contact.js", "YRInitContactPage", true);
    updateNavigation();
  }
  function focusContent() {
    var target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!target || target.hidden) target = document.querySelector('.viewer-main h1');
    if (target) { target.setAttribute("tabindex", "-1"); target.focus({ preventScroll: true }); target.scrollIntoView({ block: "start" }); }
  }
  function hasPendingAction() {
    return Array.from(document.querySelectorAll('.viewer-main [aria-busy="true"], .viewer-main button:disabled[aria-busy], #c_submit:disabled')).some(function (element) {
      return !element.hidden && element.getClientRects().length > 0;
    });
  }
  function syncChrome(source) {
    [".viewer-rail", ".viewer-topbar"].forEach(function (selector) {
      var next = source.querySelector(selector);
      var existing = document.querySelector(selector);
      // Whole-element swap: the rail's own class carries the shell variant
      // (community vs viewer-rail--account), so children alone won't do.
      if (next && existing) existing.replaceWith(next);
    });
    var layout = document.querySelector(".viewer-layout");
    if (layout) layout.dataset.viewerShell = source.body.dataset.viewerShell || "";
    rail = document.querySelector(".viewer-rail");
    railMenu = document.querySelector("[data-nav-menu]");
    railScrim = document.querySelector("[data-nav-scrim]");
    railClose = document.querySelector("[data-nav-close]");
    if (railMenu && !railMenu.dataset.bound) { railMenu.dataset.bound = "1"; railMenu.addEventListener("click", function () { setRailOpen(rail && rail.dataset.open !== "true"); }); }
    if (railClose && !railClose.dataset.bound) { railClose.dataset.bound = "1"; railClose.addEventListener("click", function () { setRailOpen(false); }); }
    if (railScrim && !railScrim.dataset.bound) { railScrim.dataset.bound = "1"; railScrim.addEventListener("click", function () { setRailOpen(false); }); }
  }
  async function navigate(value, options) {
    var opts = options || {};
    var target = new URL(value, location.href);
    if (target.origin !== location.origin) { location.assign(target.href); return; }
    if (!opts.refresh && target.pathname === location.pathname && target.search === location.search) {
      if (!opts.pop) history.pushState({}, "", target.href);
      currentUrl = target.href;
      window.dispatchEvent(new Event("hashchange"));
      updateNavigation(); focusContent(); return;
    }
    var ticket = ++sequence;
    if (pending) pending.abort();
    pending = new AbortController();
    notice.textContent = "Loading page…"; notice.hidden = false;
    setRailOpen(false);
    try {
      var response = await fetch(target.href, { credentials: "same-origin", cache: "no-store", signal: pending.signal });
      if (response.redirected && new URL(response.url).origin !== location.origin) { location.assign(response.url); return; }
      var source = new DOMParser().parseFromString(await response.text(), "text/html");
      if (ticket !== sequence) return;
      var next = source.querySelector(".viewer-main");
      if (!response.ok) throw new Error("This page could not load. Try the link again.");
      if (!next || !source.body.classList.contains("viewer-shell")) { location.assign(response.url || target.href); return; }
      // Only supported page controllers run. Arbitrary document scripts are never evaluated.
      if (next.querySelector("script")) { location.assign(target.href); return; }
      document.dispatchEvent(new Event("yr:viewer-unmount"));
      var sourceShell = source.body.dataset.viewerShell || "";
      var currentShell = document.body.dataset.viewerShell || "";
      var communityPage = !!source.body.dataset.slug;
      // Chrome follows the surface: a different shell kind or a different
      // community swaps the rail and bar, never the document.
      if (sourceShell !== currentShell || (communityPage && source.body.dataset.slug !== selectedSlug)) syncChrome(source);
      var existing = document.querySelector(".viewer-main");
      existing.className = next.className;
      existing.replaceChildren.apply(existing, Array.from(next.childNodes));
      document.body.className = source.body.className;
      Object.keys(document.body.dataset).forEach(function (key) { delete document.body.dataset[key]; });
      Object.assign(document.body.dataset, source.body.dataset);
      document.title = source.title;
      var token = source.querySelector('meta[name="csrf-token"]');
      var oldToken = document.querySelector('meta[name="csrf-token"]');
      if (oldToken) oldToken.remove();
      if (token) document.head.appendChild(token);
      var theme = source.querySelector('[data-theme-tokens]');
      var currentTheme = document.querySelector('[data-theme-tokens]');
      if (theme && currentTheme) currentTheme.textContent = theme.textContent;
      ["#yr-feedback"].forEach(function (selector) {
        var old = document.querySelector(selector); if (old) old.remove();
        var replacement = source.querySelector(selector); if (replacement) document.body.appendChild(replacement);
      });
      var oldFooter = document.querySelector(".viewer-site-footer");
      var newFooter = source.querySelector(".viewer-site-footer");
      if (oldFooter && newFooter) oldFooter.replaceWith(newFooter);
      else if (oldFooter) oldFooter.remove();
      else if (newFooter) document.querySelector(".viewer-body").appendChild(newFooter);
      if (!opts.pop) history.pushState({}, "", target.href);
      currentUrl = target.href;
      await mount();
      if (ticket !== sequence) return;
      focusContent();
      notice.hidden = true;
    } catch (error) {
      if (ticket !== sequence || error.name === "AbortError") return;
      notice.textContent = error.message || "This page could not load. Try again.";
      notice.hidden = false;
      if (opts.pop) history.replaceState({}, "", currentUrl);
    }
  }
  document.addEventListener("click", function (event) {
    var link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute("download")) return;
    var target = new URL(link.href, location.href);
    if (target.origin !== location.origin || /^\/(?:api|dashboard|login|logout|auth)(?:\/|$)/.test(target.pathname)) return;
    if (!link.closest('.viewer-layout,.viewer-site-footer')) return;
    event.preventDefault();
    if (hasPendingAction()) {
      notice.textContent = "Wait for the current action to finish."; notice.hidden = false; return;
    }
    var form = document.querySelector('#contactForm');
    if (form && Array.from(form.querySelectorAll('input:not([type="hidden"]),textarea')).some(function (field) { return field.value !== field.defaultValue; }) && !window.confirm("Leave this page and discard your unsent message?")) return;
    navigate(target.href);
  });
  window.addEventListener("popstate", function () { navigate(location.href, { pop: true, refresh: true }); });
  window.YRViewerApp = { navigate: navigate, refresh: function () { return navigate(location.href, { refresh: true }); } };
  window.__yrViewerAppReady = mount().catch(function () {
    notice.textContent = "Page controls could not load. Reload to try again."; notice.hidden = false;
  });
})();
