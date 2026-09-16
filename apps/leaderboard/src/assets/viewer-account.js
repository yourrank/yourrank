// Viewer Account pages — the client for the /me surface family.
// Everything shown comes from /api/viewer/me and the viewer export endpoints;
// a page that cannot be answered by a real contract renders its honest state.
(function initViewerAccount() {
  "use strict";
  window.YRInitViewerAccount = initViewerAccount;

  var pageEl = document.querySelector("[data-va-page]");
  if (!pageEl) return;
  var page = pageEl.dataset.vaPage;
  var loading = document.querySelector("[data-va-loading]");
  var loginCard = document.getElementById("va-login-card");
  var loginStatus = document.getElementById("va-login-status");

  var esc = function (v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var fmt = function (n) { return Number(n || 0).toLocaleString("en-US"); };
  var date = function (v) {
    var d = new Date(v);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  var csrf = function () {
    var el = document.querySelector('meta[name="csrf-token"]');
    return (el && el.content) || "";
  };
  var svg = function (path) {
    return '<svg class="viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  };
  var PROVIDERS = {
    kick: { name: "Kick", icon: '<path d="M7 4v16"/><path d="M17 4l-6.5 8L17 20"/>', connect: "/api/viewer/auth/kick" },
    discord: { name: "Discord", icon: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16.5 4.7a3.5 3.5 0 0 1 0 6.6M18 14.6c2 .8 3.5 2.9 3.5 5.4"/>', connect: "/api/viewer/auth/discord" },
  };

  function showLoggedOut(message) {
    if (loading) loading.hidden = true;
    if (loginCard) {
      loginCard.hidden = false;
      if (loginStatus && message) loginStatus.textContent = message;
    }
  }
  function showCards() {
    pageEl.querySelectorAll("[data-va-card]").forEach(function (card) { card.hidden = false; });
    var stats = pageEl.querySelector("[data-va-stats]");
    if (stats) stats.hidden = false;
    if (loading) loading.hidden = true;
  }
  function hydrateChip(viewer) {
    var chipName = document.querySelector("[data-viewer-chip-name]");
    if (chipName) chipName.textContent = viewer.displayName || "Viewer";
    var mark = document.querySelector("[data-viewer-chip-mark]");
    if (mark && viewer.avatarUrl) {
      var img = document.createElement("img");
      img.className = "viewer-chip-mark";
      img.src = viewer.avatarUrl;
      img.alt = "";
      img.width = 34; img.height = 34;
      mark.replaceWith(img);
    } else if (mark && viewer.displayName) {
      mark.textContent = String(viewer.displayName).trim().charAt(0).toUpperCase() || "V";
    }
    var context = document.querySelector("[data-viewer-chip-context]");
    if (context) context.textContent = "Signed in as " + (viewer.displayName || "Viewer");
  }

  /* ── per-page renderers ─────────────────────────────────────────── */

  function renderCommunities(data) {
    var list = pageEl.querySelector('[data-va-list="communities"]');
    var count = pageEl.querySelector("[data-va-count]");
    var empty = pageEl.querySelector('[data-va-empty="communities"]');
    var communities = data.communities || [];
    var totals = { credits: 0, claims: 0 };
    communities.forEach(function (c) {
      totals.credits += Number(c.balance) || 0;
      totals.claims += Number(c.pendingClaims) || 0;
    });
    var statMap = { communities: communities.length, credits: totals.credits, claims: totals.claims };
    pageEl.querySelectorAll("[data-va-stat]").forEach(function (el) {
      el.textContent = fmt(statMap[el.dataset.vaStat] || 0);
    });
    if (count) count.textContent = communities.length ? communities.length + (communities.length === 1 ? " community" : " communities") : "";
    if (empty) empty.hidden = communities.length > 0;
    if (list) {
      list.innerHTML = communities.map(function (c) {
        var slug = String(c.slug || "");
        var name = String(c.name || slug);
        return '<div class="va-community">' +
          '<span class="va-community-mark">' + esc((name.trim().charAt(0) || "Y").toUpperCase()) + '</span>' +
          '<span class="va-community-main"><b>' + esc(name) + '</b><span class="va-community-sub">' + fmt(c.balance) + ' credits' + (c.pendingClaims ? ' · ' + fmt(c.pendingClaims) + ' claim' + (c.pendingClaims === 1 ? '' : 's') + ' pending' : '') + (c.claimingAvailable ? '' : ' · claiming paused') + '</span></span>' +
          '<a class="yr-btn yr-btn--sm" href="/' + encodeURIComponent(slug) + '">View site</a>' +
          '</div>';
      }).join("");
    }
  }

  function renderProfile(data) {
    var viewer = data.viewer || {};
    var connections = viewer.connections || [];
    var username = connections.map(function (c) { return c.username; }).find(Boolean);
    var fields = {
      displayName: viewer.displayName || "Viewer",
      username: username ? "@" + username : "—",
      memberSince: date(viewer.createdAt),
    };
    pageEl.querySelectorAll("[data-va-field]").forEach(function (el) {
      el.textContent = fields[el.dataset.vaField] || "—";
    });
    var avatar = pageEl.querySelector("[data-va-avatar]");
    if (avatar && viewer.avatarUrl) {
      var img = document.createElement("img");
      img.className = "va-avatar";
      img.src = viewer.avatarUrl;
      img.alt = "";
      img.width = 56; img.height = 56;
      avatar.replaceWith(img);
    } else if (avatar) {
      avatar.textContent = String(viewer.displayName || "V").trim().charAt(0).toUpperCase() || "V";
    }
  }

  var PROVIDER_DESC = {
    kick: "Verify your watch time and follows.",
    discord: "Join communities and unlock Discord rewards.",
  };

  function connectionRow(provider, connection, compact) {
    var meta = PROVIDERS[provider];
    var connected = !!connection;
    return '<div class="va-conn">' +
      '<span class="va-conn-ico va-conn-ico--' + provider + '">' + svg(meta.icon) + '</span>' +
      '<span class="va-conn-main"><b>' + meta.name + '</b>' +
      '<span class="va-conn-sub">' + (connected ? "Linked as " + esc(connection.username || "—") + " · since " + date(connection.linkedAt) : (PROVIDER_DESC[provider] || "Not connected")) + '</span></span>' +
      (connected
        ? '<span class="va-chip va-chip--ok">Connected</span>'
        : '<a class="yr-btn yr-btn--sm" href="' + meta.connect + '?returnTo=' + encodeURIComponent(location.pathname) + '">Connect</a>') +
      '</div>';
  }

  function providerMap(data) {
    var byProvider = {};
    ((data.viewer || {}).connections || []).forEach(function (c) { byProvider[c.provider] = c; });
    return byProvider;
  }

  function renderConnections(data) {
    var list = pageEl.querySelector('[data-va-list="connections"]');
    var byProvider = providerMap(data);
    if (list) {
      list.innerHTML = Object.keys(PROVIDERS).map(function (p) { return connectionRow(p, byProvider[p]); }).join("");
    }
    var panel = pageEl.querySelector('[data-va-card="connect"]');
    if (panel) {
      var next = Object.keys(PROVIDERS).filter(function (p) { return !byProvider[p]; })[0];
      if (next) {
        var meta = PROVIDERS[next];
        var title = panel.querySelector("[data-va-connect-title]");
        var sub = panel.querySelector("[data-va-connect-sub]");
        var btn = panel.querySelector("[data-va-connect-btn]");
        if (title) title.textContent = "Connect " + meta.name;
        if (sub) sub.textContent = "Link your " + meta.name + " account to verify your activity and earn rewards in communities.";
        if (btn) { btn.textContent = "Connect with " + meta.name; btn.href = meta.connect + "?returnTo=" + encodeURIComponent(location.pathname); }
        panel.hidden = false;
      } else {
        panel.hidden = true;
      }
    }
  }

  function renderPrivacy(data) {
    var byProvider = providerMap(data);
    var signin = pageEl.querySelector('[data-va-list="signin"]');
    if (signin) {
      signin.innerHTML = Object.keys(PROVIDERS).map(function (p) {
        var meta = PROVIDERS[p];
        var connected = !!byProvider[p];
        return '<div class="va-conn">' +
          '<span class="va-conn-ico va-conn-ico--' + p + '">' + svg(meta.icon) + '</span>' +
          '<span class="va-conn-main"><b>' + meta.name + '</b>' +
          '<span class="va-conn-sub">Sign in with your ' + meta.name + ' account.</span></span>' +
          (connected
            ? '<span class="va-chip va-chip--ok">Connected</span>'
            : '<a class="yr-btn yr-btn--ghost yr-btn--sm" href="' + meta.connect + '?returnTo=' + encodeURIComponent(location.pathname) + '">Add</a>') +
          '</div>';
      }).join("");
    }
    var sessionsEl = pageEl.querySelector('[data-va-list="sessions"]');
    var sessions = data.sessions || [];
    if (sessionsEl) {
      sessionsEl.innerHTML = sessions.length
        ? sessions.map(function (s) {
          var scope = s.authority === "site"
            ? (s.siteName ? "Community session · " + s.siteName : "Community session" + (s.hostname ? " · " + s.hostname : ""))
            : "Viewer Account session";
          return '<div class="va-session' + (s.current ? " is-current" : "") + '">' +
            '<span class="va-session-ico">' + svg('<path d="M4 6.5h16v9H4z"/><path d="M9 19.5h6"/>') + '</span>' +
            '<span class="va-session-main"><b>' + esc(scope) + '</b>' +
            '<span class="va-session-sub">Started ' + date(s.createdAt) + ' · expires ' + date(s.expiresAt) + '</span></span>' +
            (s.current ? '<span class="va-chip va-chip--ok">Current session</span>' : '<span class="va-session-sub">Last active ' + date(s.createdAt) + '</span>') +
            '</div>';
        }).join("")
        : '<p class="viewer-muted">This device’s session.</p>';
    }
  }

  function renderNotifications() {
    var slot = pageEl.querySelector("[data-va-push-toggle]");
    if (!slot) return;
    if (!("Notification" in window)) {
      slot.innerHTML = '<span class="va-chip va-chip--mute">Not supported</span>';
      return;
    }
    var draw = function () {
      var state = Notification.permission;
      if (state === "granted") {
        slot.innerHTML = '<button class="va-toggle is-on" type="button" role="switch" aria-checked="true" disabled aria-label="Browser notifications on"><span></span></button>';
      } else if (state === "denied") {
        slot.innerHTML = '<button class="va-toggle" type="button" role="switch" aria-checked="false" disabled aria-label="Browser notifications blocked"><span></span></button><small class="va-field-note">Blocked by your browser</small>';
      } else {
        slot.innerHTML = '<button class="va-toggle" type="button" role="switch" aria-checked="false" aria-label="Enable browser notifications"><span></span></button>';
        var btn = slot.querySelector("button");
        if (btn) btn.addEventListener("click", function () {
          Notification.requestPermission().then(draw);
        });
      }
    };
    draw();
  }

  function renderData(data) {
    var viewer = data.viewer || {};
    var info = pageEl.querySelector('[data-va-list="account-info"]');
    if (info) {
      var providers = (viewer.connections || []).map(function (c) { return (PROVIDERS[c.provider] || {}).name || c.provider; }).join(" + ") || "—";
      info.innerHTML =
        '<div class="va-info-row"><b>Viewer name</b><p>' + esc(viewer.displayName || "Viewer") + '</p></div>' +
        '<div class="va-info-row"><b>Connected sign-ins</b><p>' + esc(providers) + '</p></div>' +
        '<div class="va-info-row"><b>Communities joined</b><p>' + fmt((data.communities || []).length) + '</p></div>' +
        '<div class="va-info-row"><b>Account created</b><p>' + date(viewer.createdAt) + '</p></div>';
    }
    var exportBtn = pageEl.querySelector("[data-va-export]");
    var exportStatus = pageEl.querySelector("[data-va-export-status]");
    if (exportBtn) {
      exportBtn.addEventListener("click", function () {
        exportBtn.disabled = true;
        if (exportStatus) exportStatus.textContent = "Preparing your export…";
        fetch("/api/viewer/export", {
          method: "POST",
          credentials: "same-origin",
          headers: { "x-csrf-token": csrf() },
        })
          .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { return { ok: res.ok, data: d }; }); })
          .then(function (result) {
            if (!result.ok || result.data.ok === false || !result.data.exportId) {
              if (exportStatus) exportStatus.textContent = result.data.error || "Export is temporarily unavailable. Try again later.";
              exportBtn.disabled = false;
              return;
            }
            pollExport(result.data.exportId);
          })
          .catch(function () {
            if (exportStatus) exportStatus.textContent = "Network error. Your export was not confirmed; try again.";
            exportBtn.disabled = false;
          });
      });
    }
    function pollExport(id) {
      var attempts = 0;
      var tick = function () {
        attempts += 1;
        fetch("/api/viewer/export/" + encodeURIComponent(id) + "/status", { credentials: "same-origin", cache: "no-store" })
          .then(function (res) { return res.json().catch(function () { return {}; }); })
          .then(function (d) {
            if (d && d.status === "completed") {
              var link = document.createElement("a");
              link.href = "/api/viewer/export/" + encodeURIComponent(id) + "/download";
              link.className = "yr-btn yr-btn--sm";
              link.textContent = "Download export";
              link.setAttribute("download", "");
              if (exportStatus) { exportStatus.textContent = ""; exportStatus.appendChild(link); }
              exportBtn.disabled = false;
              exportBtn.textContent = "Export again";
              return;
            }
            if (d && (d.status === "expired" || d.status === "failed" || d.error)) {
              if (exportStatus) exportStatus.textContent = "That export could not complete. Try again.";
              exportBtn.disabled = false;
              return;
            }
            if (attempts > 60) {
              if (exportStatus) exportStatus.textContent = "Still preparing — come back to download.";
              exportBtn.disabled = false;
              return;
            }
            if (exportStatus) exportStatus.textContent = "Preparing your export…";
            window.setTimeout(tick, 2000);
          })
          .catch(function () {
            if (exportStatus) exportStatus.textContent = "Lost the connection while preparing. Try again.";
            exportBtn.disabled = false;
          });
      };
      tick();
    }
  }

  var mount = fetch("/api/viewer/me", { credentials: "same-origin", cache: "no-store" })
    .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { return { ok: res.ok, status: res.status, data: d }; }); })
    .then(function (result) {
      if (!result.ok || !result.data || !result.data.viewer) {
        showLoggedOut(result.status === 401 ? "Sign in to continue to your viewer account." : "Your account could not load. Try again.");
        return;
      }
      hydrateChip(result.data.viewer);
      showCards();
      if (page === "communities") renderCommunities(result.data);
      if (page === "profile") renderProfile(result.data);
      if (page === "connections") renderConnections(result.data);
      if (page === "notifications") renderNotifications();
      if (page === "privacy") renderPrivacy(result.data);
      if (page === "data") renderData(result.data);
    })
    .catch(function () {
      showLoggedOut("Network error. Your account could not load — check your connection.");
    });

  // "Open a community" resolves a handle/link to its real community page.
  var openForm = pageEl.querySelector("[data-va-open-community]");
  var openStatus = document.getElementById("va-community-status");
  if (openForm) {
    openForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var input = document.getElementById("va-community-name");
      var raw = (input && input.value || "").trim();
      var handle = raw.replace(/^https?:\/\//i, "").replace(/^yourrank\.site\//i, "").replace(/\/+$/, "").split("/")[0].toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(handle)) {
        if (openStatus) openStatus.textContent = "Enter a community name or a yourrank.site link.";
        return;
      }
      if (openStatus) openStatus.textContent = "Opening community…";
      location.assign("/" + encodeURIComponent(handle));
    });
  }

  window.__yrViewerReady = mount;
})();
