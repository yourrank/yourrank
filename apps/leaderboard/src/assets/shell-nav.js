// Shared authenticated-shell behaviour: account menu, persisted desktop rail,
// and the mobile drawer used by string-rendered Help pages.
(function () {
  // Workspace theme: honor the saved toggle choice, otherwise the OS
  // preference (prefers-color-scheme parity). html[data-ws-theme] drives the
  // dark token contract in dashboard-v4.css.
  var themeKey = "yr-ws-theme";
  var themeQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function resolveTheme() {
    var stored = null;
    try { stored = localStorage.getItem(themeKey); } catch (error) {}
    if (stored === "light" || stored === "dark") return stored;
    return themeQuery && themeQuery.matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-ws-theme", theme);
    document.querySelectorAll("[data-toggle-theme]").forEach(function (button) {
      var dark = theme === "dark";
      button.setAttribute("aria-pressed", dark ? "true" : "false");
      button.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
      button.title = dark ? "Switch to light theme" : "Switch to dark theme";
    });
  }

  applyTheme(resolveTheme());
  if (themeQuery && typeof themeQuery.addEventListener === "function") {
    themeQuery.addEventListener("change", function () {
      var stored = null;
      try { stored = localStorage.getItem(themeKey); } catch (error) {}
      if (stored !== "light" && stored !== "dark") applyTheme(resolveTheme());
    });
  }
  document.querySelectorAll("[data-toggle-theme]").forEach(function (button) {
    button.addEventListener("click", function () {
      var next = resolveTheme() === "dark" ? "light" : "dark";
      try { localStorage.setItem(themeKey, next); } catch (error) {}
      applyTheme(next);
    });
  });

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
    // More/Less overflow toggle on .v3-tabs strips (giveaways, stats, site
    // sections). Classic script so it binds on every document — the SPA
    // equivalent lives in setTabsMore (dashboard/shell.js); both write the
    // same aria-expanded/hidden state the server renders.
    var more = event.target && event.target.closest ? event.target.closest("[data-tabs-more]") : null;
    if (more) {
      event.preventDefault();
      var strip = more.closest(".v3-tabs");
      if (strip) {
        var expanded = more.getAttribute("aria-expanded") !== "true";
        more.setAttribute("aria-expanded", String(expanded));
        more.textContent = expanded ? "Less" : "More";
        strip.querySelectorAll("[data-tabs-legacy]").forEach(function (el) { el.hidden = !expanded; });
      }
    }
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
      [".v3-analytics-page > .v3-tabs", ".v3-analytics-page > .v3-head"],
      ["#acc-app > .v3-head + .v3-tabs", "#acc-app > .v3-head"],
      ["#gw-app > .v3-tabs", "#gw-app > .v3-head"],
    ];

    function syncStickyOffsets() {
      stickyPairs.forEach(function (pair) {
        var tabs = root.querySelector(pair[0]);
        var head = root.querySelector(pair[1]);
        if (!tabs || !head) return;
        tabs.style.setProperty("--sticky-head-offset", head.getBoundingClientRect().height + "px");
      });
    }

    syncStickyOffsets();
    if (typeof ResizeObserver === "function") {
      var resizeObserver = new ResizeObserver(syncStickyOffsets);
      root.querySelectorAll(".v3-head, .v3-section-title").forEach(function (head) {
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
    var menuButtons = sharedRoot.querySelectorAll(".lb-menu");
    var closeButtons = sharedRoot.querySelectorAll("[data-close-side]");
    var isolated = [];
    var drawerTrigger = null;
    var previousOverflow = "";
    var backdrop = document.querySelector(".lb-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = "lb-backdrop";
      document.body.appendChild(backdrop);
    }

    function trapDrawerFocus(event) {
      if (event.key !== "Tab" || !side || !side.classList.contains("is-open")) return;
      var focusable = Array.prototype.slice.call(side.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary'))
        .filter(function (element) {
          var details = element.closest("details:not([open])");
          return element.getClientRects().length > 0 && !element.closest("[hidden], [inert]") &&
            (!details || element === details.querySelector("summary"));
        });
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (!side.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
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
      isolated.forEach(function (entry) { entry.element.inert = entry.inert; });
      isolated = [];
      document.body.style.overflow = previousOverflow;
      menuButtons.forEach(function (button) { button.setAttribute("aria-expanded", "false"); });
      if (returnFocus !== false && drawerTrigger) drawerTrigger.focus();
    }

    // Dashboard navigation requests this event when an in-document route
    // changes. shell-nav.js remains the sole owner of drawer state while
    // callers can close the drawer without importing its implementation.
    document.addEventListener("yr:dashboard-drawer-close", function (event) {
      closeDrawer(event.detail && event.detail.returnFocus);
    });

    function openDrawer() {
      if (!side || side.classList.contains("is-open")) return;
      drawerTrigger = document.activeElement;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      side.classList.add("is-open");
      side.setAttribute("role", "dialog");
      side.setAttribute("aria-modal", "true");
      backdrop.classList.add("is-open");
      // Isolate every sibling up to body, including the outer skip link and
      // document footer, not just the content inside this shell.
      var branch = side;
      while (branch && branch !== document.body) {
        Array.prototype.forEach.call(branch.parentElement.children, function (sibling) {
          if (sibling === branch || sibling === backdrop || /^(SCRIPT|STYLE|LINK)$/.test(sibling.tagName)) return;
          isolated.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        });
        branch = branch.parentElement;
      }
      menuButtons.forEach(function (button) { button.setAttribute("aria-expanded", "true"); });
      // The trigger lives in .lb-main, which just became inert, so focus has to
      // move into the drawer or it is lost behind the backdrop: a container
      // element is not focusable, only a real control is.
      var first = side.querySelector("[data-close-side], .lb-nav a[href], .lb-nav button:not([disabled])");
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
    document.addEventListener("focusin", function (event) {
      if (side && side.classList.contains("is-open") && !side.contains(event.target)) {
        var close = side.querySelector("[data-close-side]");
        if (close) close.focus();
      }
    });
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
        location.href = res.url || "/login";
      })
      .catch(function () {
        // The fetch never proves the session survived, so guessing "sign out
        // failed" would be a lie. Fall back to the native form POST: the server
        // clears the cookie and redirects, and /login bounces back to the
        // dashboard if the session is somehow still alive.
        if (btn) btn.textContent = original || "Sign out";
        form.submit();
      });
  }, true);
})();
