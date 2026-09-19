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
    if (document.body.classList.contains("viewer-account-page")) return;
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
  async function mount(ticket) {
    await loadAsset("/assets/site-shell.js", "YRInitSitePage", false);
    if (ticket !== sequence) return;
    if (document.getElementById("viewer-notify")) {
      await loadAsset("/assets/viewer-notifications.js", "YRInitViewerNotifications", false).catch(function () { /* The bell stays hidden. */ });
      if (ticket !== sequence) return;
    }
    if (document.getElementById("vd-profile")) {
      await loadAsset("/assets/viewer-dashboard.js", "YRInitViewerAccount", true);
      if (ticket !== sequence) return;
      await window.__yrViewerReady;
    }
    if (ticket !== sequence) return;
    if (document.getElementById("contactForm")) await loadAsset("/assets/contact.js", "YRInitContactPage", true);
    if (ticket !== sequence) return;
    updateNavigation();
  }
  function focusContent() {
    var hash = location.hash.slice(1);
    try { hash = decodeURIComponent(hash); } catch (_) { /* Use the literal anchor. */ }
    var target = hash && document.getElementById(hash);
    var anchor = target && !target.hidden;
    if (!anchor) target = document.querySelector('.viewer-main h1');
    if (target) { target.setAttribute("tabindex", "-1"); target.focus({ preventScroll: true }); }
    if (anchor) target.scrollIntoView({ block: "start" });
    else window.scrollTo(0, 0);
  }
  function syncTheme(source) {
    var fonts = source.querySelector("link[data-viewer-fonts]");
    var existing = document.querySelector("link[data-viewer-fonts]");
    if (fonts && (!existing || existing.href !== fonts.href)) {
      var replacement = fonts.cloneNode();
      replacement.media = "all";
      if (existing) existing.replaceWith(replacement);
      else document.head.appendChild(replacement);
    }
    ["accent", "accent-ink", "display-font"].forEach(function (name) {
      var token = source.querySelector('meta[name="viewer-' + name + '"]');
      if (token) document.body.style.setProperty("--yr-" + name, token.content);
      else document.body.style.removeProperty("--yr-" + name);
    });
  }
  // Viewer help links open the support/feedback modal; the /help pages remain
  // the no-JS fallback and deep link.
  function supportLinkMode(target) {
    if (target.searchParams.get("audience") !== "viewer") return null;
    return target.pathname === "/help/support" ? "support" : target.pathname === "/help/feedback" ? "feedback" : null;
  }
  function openSupport(mode, target, link) {
    return loadAsset("/assets/viewer-support.js", "YRInitViewerSupport", false).then(function () {
      window.YRViewerSupport.open({ mode: mode, returnTo: target.searchParams.get("return") || "", opener: link });
    }).catch(function () { location.assign(target.href); });
  }
  function hasPendingAction() {
    if (window.YRViewerSupport && window.YRViewerSupport.isPending()) return true;
    return Array.from(document.querySelectorAll('.viewer-main button[aria-busy="true"], #c_submit:disabled')).some(function (element) {
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
    var ticket = ++sequence;
    if (pending) pending.abort();
    if (!opts.refresh && target.pathname === location.pathname && target.search === location.search && target.hash !== location.hash) {
      if (!opts.pop) history.pushState({}, "", target.href);
      currentUrl = target.href;
      window.dispatchEvent(new Event("hashchange"));
      updateNavigation(); focusContent(); notice.hidden = true; return;
    }
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
      [".viewer-overview", ".viewer-home-strip", ".viewer-home-promo", ".viewer-home-note", ".viewer-home-banner"].forEach(function (selector) {
        var old = document.querySelector(selector);
        var replacement = source.querySelector(selector);
        if (old) old.remove();
        if (replacement) {
          var layout = document.querySelector('.viewer-layout');
          if (selector === ".viewer-home-banner") layout.insertBefore(replacement, existing);
          else layout.appendChild(replacement);
        }
      });
      var oldFooter = document.querySelector(".viewer-site-footer");
      var footer = source.querySelector(".viewer-site-footer");
      if (oldFooter) oldFooter.remove();
      if (footer) document.querySelector(".viewer-layout").appendChild(footer);
      var oldFeedback = document.querySelector("#yr-feedback");
      var feedback = source.querySelector("#yr-feedback");
      if (oldFeedback) oldFeedback.remove();
      if (feedback) document.body.appendChild(feedback);
      if (!opts.pop) history.pushState({}, "", target.href);
      currentUrl = target.href;
      await mount(ticket);
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
    if (link.getAttribute("href") === "#main-content") {
      var content = document.getElementById("main-content");
      if (content) {
        event.preventDefault();
        content.setAttribute("tabindex", "-1");
        content.focus({ preventScroll: true });
        content.scrollIntoView({ block: "start" });
      }
      return;
    }
    var target = new URL(link.href, location.href);
    if (target.origin !== location.origin || /^\/(?:api|dashboard|login|logout|auth)(?:\/|$)/.test(target.pathname)) return;
    if (!link.closest('.viewer-layout,.viewer-site-footer')) return;
    event.preventDefault();
    var supportMode = supportLinkMode(target);
    if (supportMode) { openSupport(supportMode, target, link); return; }
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
  window.__yrViewerAppReady = mount(sequence).catch(function () {
    notice.textContent = "Page controls could not load. Reload to try again."; notice.hidden = false;
  });
})();
