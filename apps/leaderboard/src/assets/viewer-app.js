// One persistent viewer shell. Documents remain the canonical route/render owner;
// this enhancement swaps their content without retaining private page responses.
(function () {
  "use strict";
  if (window.YRViewerApp || !document.body.classList.contains("viewer-shell")) return;
  var pending;
  var sequence = 0;
  var currentUrl = location.href;
  var loaded = {};
  var notice = document.createElement("p");
  notice.className = "viewer-navigation-status";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  document.querySelector(".viewer-layout").appendChild(notice);

  function updateNavigation() {
    document.querySelectorAll('.viewer-rail a[aria-current]').forEach(function (link) { link.removeAttribute("aria-current"); });
    document.querySelectorAll('.viewer-rail a[href]').forEach(function (link) {
      var target = new URL(link.href, location.href);
      var active = target.origin === location.origin && target.pathname === location.pathname;
      if (active && target.pathname === "/me" && document.body.dataset.customDomain !== "true") {
        active = target.hash === location.hash;
      }
      if (active) link.setAttribute("aria-current", "page");
    });
    var heading = document.querySelector('.viewer-main h1');
    var active = document.querySelector('.viewer-rail a[aria-current]');
    document.getElementById("viewer-top-title").textContent = active ? active.textContent : heading ? heading.textContent : "Community";
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
    if (document.getElementById("vd-profile")) {
      await loadAsset("/assets/viewer-dashboard.js", "YRInitViewerAccount", true);
      await window.__yrViewerReady;
    }
    if (document.getElementById("contactForm")) await loadAsset("/assets/contact.js", "YRInitContactPage", true);
    updateNavigation();
  }
  function focusContent() {
    var target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    var anchor = target && !target.hidden;
    if (!anchor) target = document.querySelector('.viewer-main h1');
    if (target) { target.setAttribute("tabindex", "-1"); target.focus({ preventScroll: true }); }
    if (anchor) target.scrollIntoView({ block: "start" });
    else window.scrollTo(0, 0);
  }
  function syncTheme(source) {
    ["accent", "accent-ink", "display-font"].forEach(function (name) {
      var token = source.querySelector('meta[name="viewer-' + name + '"]');
      if (token) document.body.style.setProperty("--yr-" + name, token.content);
      else document.body.style.removeProperty("--yr-" + name);
    });
  }
  function hasPendingAction() {
    return Array.from(document.querySelectorAll('.viewer-main [aria-busy="true"], .viewer-main button:disabled[aria-busy], #c_submit:disabled')).some(function (element) {
      return !element.hidden && element.getClientRects().length > 0;
    });
  }
  function syncChrome(source) {
    [".viewer-topbar", ".viewer-rail"].forEach(function (selector) {
      var next = source.querySelector(selector);
      var existing = document.querySelector(selector);
      if (next && existing) existing.replaceChildren.apply(existing, Array.from(next.childNodes));
    });
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
      syncChrome(source);
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
      syncTheme(source);
      [".viewer-overview", ".viewer-home-banner"].forEach(function (selector) {
        var old = document.querySelector(selector);
        var replacement = source.querySelector(selector);
        if (old) old.remove();
        if (replacement) {
          var layout = document.querySelector('.viewer-layout');
          if (selector === ".viewer-home-banner") layout.insertBefore(replacement, existing);
          else layout.appendChild(replacement);
        }
      });
      ["#yr-feedback", ".viewer-site-footer"].forEach(function (selector) {
        var old = document.querySelector(selector); if (old) old.remove();
        var replacement = source.querySelector(selector); if (replacement) document.body.appendChild(replacement);
      });
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
  syncTheme(document);
  window.__yrViewerAppReady = mount().catch(function () {
    notice.textContent = "Page controls could not load. Reload to try again."; notice.hidden = false;
  });
})();
