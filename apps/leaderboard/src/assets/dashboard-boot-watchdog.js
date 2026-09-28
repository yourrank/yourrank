(function () {
  "use strict";

  var done = false;
  var timer = setTimeout(function () {
    fail("The dashboard did not finish loading.");
  }, 8000);

  function surface() {
    return document.getElementById("loading") ||
      document.getElementById("cr-empty") ||
      document.getElementById("gw-app");
  }

  function sameOrigin(url) {
    if (!url) return false;
    try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; }
  }

  function failure(message) {
    var el = surface();
    if (!el || done) return;
    done = true;
    clearTimeout(timer);
    el.hidden = false;
    el.classList.add("yr-boot-failure");
    el.innerHTML = '<div class="error-state" role="alert"><span class="error-icon" aria-hidden="true">!</span><p>Couldn\'t load this dashboard.</p><p class="hint" data-yr-boot-hint></p><button class="btn btn--sm" type="button" data-yr-boot-retry>Retry</button></div>';
    var hint = el.querySelector("[data-yr-boot-hint]");
    if (hint) hint.textContent = String(message || "A dashboard script or asset failed before the app could start.");
    var retry = el.querySelector("[data-yr-boot-retry]");
    if (retry) retry.addEventListener("click", function () { location.reload(); });
  }

  function fail(message) {
    failure(message);
  }

  window.__yrBoot = {
    signal: function () {
      done = true;
      clearTimeout(timer);
    },
    fail: fail,
  };

  window.addEventListener("error", function (event) {
    var target = event.target;
    if (target && (target.tagName === "SCRIPT" || target.tagName === "LINK")) {
      if (sameOrigin(target.src || target.href)) {
        fail("A dashboard script or stylesheet could not be loaded.");
      }
    } else if ((event.filename && sameOrigin(event.filename)) || (!event.filename && event.error)) {
      fail("A dashboard script failed before the app could start.");
    }
  }, true);

  window.addEventListener("unhandledrejection", function () {
    fail("A dashboard request failed before the app could start.");
  });
}());
