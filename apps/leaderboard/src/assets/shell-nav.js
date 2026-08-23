// Shared authenticated-shell behaviour: account menu, persisted desktop rail,
// and the mobile drawer used by string-rendered Help pages.
(function () {
  var menus = document.querySelectorAll("details.gm-profile");
  var collapseKey = "yr-side-collapsed";

  function closeProfile(details) {
    details.removeAttribute("open");
    var summary = details.querySelector("summary");
    if (summary) summary.setAttribute("aria-expanded", "false");
  }

  menus.forEach(function (details) {
    var summary = details.querySelector("summary");
    if (summary) summary.setAttribute("aria-expanded", details.open ? "true" : "false");
    details.addEventListener("toggle", function () {
      if (summary) summary.setAttribute("aria-expanded", details.open ? "true" : "false");
    });
  });

  document.addEventListener("click", function (event) {
    menus.forEach(function (details) {
      if (details.open && !details.contains(event.target)) closeProfile(details);
    });
    document.querySelectorAll(".lb-ws-switcher").forEach(function (switcher) {
      var menu = switcher.querySelector(".lb-ws-menu");
      var card = switcher.querySelector(".lb-ws-card");
      if (menu && !menu.hidden && !switcher.contains(event.target)) {
        menu.hidden = true;
        if (card) card.setAttribute("aria-expanded", "false");
      }
    });
  });

  document.querySelectorAll(".lb-ws-card").forEach(function (card) {
    card.addEventListener("click", function (e) {
      e.stopPropagation();
      var menu = card.parentElement.querySelector(".lb-ws-menu");
      if (!menu) return;
      var nextHidden = !menu.hidden;
      menu.hidden = nextHidden;
      card.setAttribute("aria-expanded", nextHidden ? "false" : "true");
    });
  });

  document.querySelectorAll(".v3-dash[data-auth-workspace]").forEach(function (root) {
    var stickyPairs = [
      [".lb-page.is-on > .v3-head + .v3-tabs", ".lb-page.is-on > .v3-head"],
      [".lb-page.is-on > .design-grid > .design-controls > .v3-tabs", ".lb-page.is-on > .design-grid > .design-controls > .v3-section-title"],
      [".v3-analytics-page > .v3-tabs", ".v3-analytics-page > .v3-head"],
      ["#acc-app > .account-settings-tabs", "#acc-app > .account-settings-head"],
      ["#gw-app > .gw-nav-tabs", "#gw-app > .v3-head"],
    ];

    function syncStickyOffsets() {
      stickyPairs.forEach(function (pair) {
        var tabs = root.querySelector(pair[0]);
        var head = root.querySelector(pair[1]);
        if (!tabs || !head) return;
        tabs.style.setProperty("--v3-sticky-head-offset", head.getBoundingClientRect().height + "px");
      });
    }

    syncStickyOffsets();
    if (typeof ResizeObserver === "function") {
      var resizeObserver = new ResizeObserver(syncStickyOffsets);
      root.querySelectorAll(".v3-head, .v3-section-title, .account-settings-head").forEach(function (head) {
        resizeObserver.observe(head);
      });
    }
    if (typeof MutationObserver === "function") {
      var mutationObserver = new MutationObserver(syncStickyOffsets);
      mutationObserver.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "hidden"] });
    }
    window.addEventListener("resize", syncStickyOffsets);
  });


  document.querySelectorAll(".v3-dash").forEach(function (root) {
    var buttons = root.querySelectorAll("[data-collapse-side]");
    if (!buttons.length) return;
    var collapsed = false;
    try { collapsed = localStorage.getItem(collapseKey) === "true"; } catch (error) {}

    function applyCollapse(next) {
      collapsed = Boolean(next);
      if (collapsed) root.setAttribute("data-side-collapsed", "true");
      else root.removeAttribute("data-side-collapsed");
      buttons.forEach(function (button) {
        button.setAttribute("aria-pressed", collapsed ? "true" : "false");
        button.setAttribute("aria-label", collapsed ? "Expand navigation" : "Collapse navigation");
        button.title = collapsed ? "Expand navigation" : "Collapse navigation";
      });
    }

    applyCollapse(collapsed);
    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        applyCollapse(!collapsed);
        try { localStorage.setItem(collapseKey, collapsed ? "true" : "false"); } catch (error) {}
      });
    });
  });

  var sharedRoot = document.querySelector('.v3-dash[data-shell-drawer="shared"]');
  if (sharedRoot) {
    var side = sharedRoot.querySelector("#lbSide");
    var main = sharedRoot.querySelector(".lb-main");
    var menuButtons = sharedRoot.querySelectorAll(".lb-menu");
    var closeButtons = sharedRoot.querySelectorAll("[data-close-side]");
    var backdrop = document.querySelector(".lb-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = "lb-backdrop";
      document.body.appendChild(backdrop);
    }

    function trapDrawerFocus(event) {
      if (event.key !== "Tab" || !side || !side.classList.contains("is-open")) return;
      var focusable = Array.prototype.slice.call(side.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary'))
        .filter(function (element) { return element.offsetParent !== null; });
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function closeDrawer(returnFocus) {
      if (!side || !side.classList.contains("is-open")) return;
      side.classList.remove("is-open");
      side.removeAttribute("role");
      side.removeAttribute("aria-modal");
      backdrop.classList.remove("is-open");
      if (main) main.inert = false;
      menuButtons.forEach(function (button) { button.setAttribute("aria-expanded", "false"); });
      if (returnFocus !== false && menuButtons[0]) menuButtons[0].focus();
    }

    function openDrawer() {
      if (!side) return;
      side.classList.add("is-open");
      side.setAttribute("role", "dialog");
      side.setAttribute("aria-modal", "true");
      backdrop.classList.add("is-open");
      if (main) main.inert = true;
      menuButtons.forEach(function (button) { button.setAttribute("aria-expanded", "true"); });
      var first = side.querySelector(".lb-nav");
      if (first) first.focus();
    }

    menuButtons.forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        openDrawer();
      });
    });
    closeButtons.forEach(function (button) {
      button.addEventListener("click", function () { closeDrawer(true); });
    });
    backdrop.addEventListener("click", function () { closeDrawer(true); });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 980) closeDrawer(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeDrawer(true);
      else trapDrawerFocus(event);
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    menus.forEach(function (details) {
      if (!details.open) return;
      closeProfile(details);
      var summary = details.querySelector("summary");
      if (summary) summary.focus();
    });
  });

  var themeToggle = document.getElementById("yrThemeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", function () {
      var doc = document.documentElement;
      if (doc.getAttribute("data-theme") === "dark") {
        doc.removeAttribute("data-theme");
        try { localStorage.setItem("yr-theme", "light"); } catch (error) {}
      } else {
        doc.setAttribute("data-theme", "dark");
        try { localStorage.setItem("yr-theme", "dark"); } catch (error) {}
      }
    });
  }

  // AUDIT-B4: every page with the shared account menu (SPA shell, standalone
  // Rewards/Audience/Giveaways, and the Telegram bot dashboard) intercepts the
  // logout form so we can broadcast yr:logout only after the server confirms the
  // session was destroyed. The native form submit is a fallback if this script
  // fails to load. capture phase runs before page-specific submit listeners.
  document.addEventListener("submit", function (event) {
    var form = event.target.closest ? event.target.closest(".gm-logout-form") : null;
    if (!form) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    var btn = form.querySelector(".gm-logout");
    var original = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      if (btn.textContent) btn.textContent = "Signing out…";
    }
    fetch(form.action, { method: "POST", credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("logout failed: " + res.status);
        try { localStorage.setItem("yr:logout", String(Date.now())); } catch (error) {}
        location.href = res.url || form.action;
      })
      .catch(function (err) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = original || "Sign out";
          btn.title = "Couldn't sign out. Check your connection and try again.";
        }
      });
  }, true);
})();
