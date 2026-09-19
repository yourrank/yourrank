// Viewer notification bell. The topbar markup is server-rendered and swapped
// on every SPA navigation, so this controller keeps one shared state and
// re-binds to whatever #viewer-notify is currently in the document.
(function () {
  "use strict";
  if (window.YRViewerNotifications) return;
  var POLL_MS = 60000;
  var state = { items: [], unread: 0, loaded: false, error: "" };
  var binding = null;
  var pollTimer = 0;
  var inflight = null;

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.content) return meta.content;
    var match = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }
  function api(method, path) {
    return fetch(path, {
      method: method,
      credentials: "same-origin",
      cache: "no-store",
      keepalive: method !== "GET",
      signal: AbortSignal.timeout(10000),
      headers: method === "GET" ? { accept: "application/json" } : { "x-csrf-token": csrfToken() },
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
    });
  }
  function relativeTime(iso) {
    var then = new Date(iso).getTime();
    if (isNaN(then)) return "";
    var seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 45) return "Just now";
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + (minutes === 1 ? " minute ago" : " minutes ago");
    var hours = Math.round(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    var days = Math.round(hours / 24);
    if (days < 7) return days + (days === 1 ? " day ago" : " days ago");
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  // Notification hrefs are site-relative apex paths (/{slug}/activity…). On a
  // custom domain the same page lives at /activity…; anything else stays put.
  function resolveHref(href) {
    if (typeof href !== "string" || !/^\/[^/]/.test(href)) return "";
    var slug = document.body.dataset.slug || "";
    if (document.body.dataset.customDomain === "true" && slug) {
      var prefix = "/" + encodeURIComponent(slug);
      if (href === prefix) return "/";
      if (href.indexOf(prefix + "/") === 0) return href.slice(prefix.length);
      return "https://yourrank.site" + href;
    }
    return href;
  }

  function render() {
    if (!binding) return;
    var b = binding;
    b.root.hidden = false;
    var unread = state.unread;
    b.badge.hidden = unread <= 0;
    b.badge.textContent = unread > 99 ? "99+" : String(unread);
    b.bell.setAttribute("aria-label", unread > 0 ? "Notifications, " + unread + " unread" : "Notifications");
    b.readAll.hidden = unread <= 0;
    b.status.textContent = state.error ? state.error : !state.loaded ? "Loading…" : state.items.length ? "" : "You're all caught up.";
    b.list.innerHTML = "";
    state.items.forEach(function (item) {
      var li = document.createElement("li");
      var row = document.createElement("a");
      row.className = "viewer-notify-item";
      row.href = resolveHref(item.href) || "#";
      row.dataset.notificationId = item.id;
      row.dataset.read = item.readAt ? "true" : "false";
      var dot = document.createElement("span");
      dot.className = "viewer-notify-dot";
      dot.setAttribute("aria-hidden", "true");
      var text = document.createElement("span");
      var title = document.createElement("strong");
      title.textContent = item.title || "";
      text.appendChild(title);
      if (item.body) {
        var body = document.createElement("p");
        body.textContent = item.body;
        text.appendChild(body);
      }
      var when = document.createElement("time");
      when.dateTime = item.createdAt || "";
      when.textContent = relativeTime(item.createdAt) + (item.readAt ? "" : " · Unread");
      text.appendChild(when);
      row.appendChild(dot); row.appendChild(text);
      li.appendChild(row);
      b.list.appendChild(li);
    });
  }
  function load() {
    if (inflight) return inflight;
    inflight = api("GET", "/api/viewer/notifications").then(function (r) {
      if (r.ok && r.data && r.data.ok) {
        state.items = Array.isArray(r.data.notifications) ? r.data.notifications : [];
        state.unread = Number(r.data.unreadCount) || 0;
        state.error = "";
      } else if (!state.loaded) {
        state.error = "Notifications couldn't load.";
      }
      state.loaded = true;
      render();
    }).catch(function () {
      if (!state.loaded) { state.error = "Notifications couldn't load."; state.loaded = true; render(); }
    }).then(function () { inflight = null; });
    return inflight;
  }
  function applyRead(item) {
    state.items.forEach(function (it) {
      if (it.id === item.id && !it.readAt) { it.readAt = item.readAt || new Date().toISOString(); state.unread = Math.max(0, state.unread - 1); }
    });
    render();
  }
  function markRead(id) {
    return api("POST", "/api/viewer/notifications/" + encodeURIComponent(id) + "/read").then(function (r) {
      if (r.ok && r.data && r.data.ok && r.data.notification) {
        applyRead(r.data.notification);
        if (typeof r.data.unreadCount === "number") { state.unread = r.data.unreadCount; render(); }
      }
    }).catch(function () { /* The next refresh reconciles. */ });
  }
  function markAllRead() {
    return api("POST", "/api/viewer/notifications/read-all").then(function (r) {
      if (r.ok && r.data && r.data.ok) {
        var now = new Date().toISOString();
        state.items.forEach(function (it) { if (!it.readAt) it.readAt = now; });
        state.unread = 0;
        render();
      }
    }).catch(function () { /* The next refresh reconciles. */ });
  }

  function setOpen(open) {
    if (!binding) return;
    var b = binding;
    b.panel.hidden = !open;
    b.bell.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      load();
      window.setTimeout(function () {
        var first = b.panel.querySelector(".viewer-notify-item") || b.panel;
        first.focus();
      }, 0);
    }
  }
  function isOpen() { return !!binding && !binding.panel.hidden; }

  function bind() {
    var root = document.getElementById("viewer-notify");
    if (!root) { binding = null; stopPolling(); return; }
    if (binding && binding.root === root) return;
    if (binding) binding.controller.abort();
    var controller = new AbortController();
    var signal = controller.signal;
    binding = {
      root: root,
      controller: controller,
      bell: root.querySelector("#viewer-notify-bell"),
      badge: root.querySelector("#viewer-notify-badge"),
      panel: root.querySelector("#viewer-notify-panel"),
      list: root.querySelector("#viewer-notify-list"),
      status: root.querySelector("#viewer-notify-status"),
      readAll: root.querySelector("#viewer-notify-readall"),
    };
    binding.panel.tabIndex = -1;
    binding.bell.addEventListener("click", function () { setOpen(!isOpen()); }, { signal: signal });
    binding.readAll.addEventListener("click", function () { markAllRead(); }, { signal: signal });
    binding.list.addEventListener("click", function (event) {
      var row = event.target.closest(".viewer-notify-item");
      if (!row) return;
      var id = row.dataset.notificationId;
      if (row.dataset.read !== "true") markRead(id);
      setOpen(false);
      // The shell's link handler takes the navigation from here.
    }, { signal: signal });
    document.addEventListener("click", function (event) {
      if (isOpen() && binding && !binding.root.contains(event.target)) setOpen(false);
    }, { signal: signal });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && isOpen()) { setOpen(false); binding.bell.focus(); }
    }, { signal: signal });
    render();
    startPolling();
    load();
  }
  function onVisibility() {
    if (document.visibilityState === "visible" && binding) load();
  }
  function startPolling() {
    if (pollTimer) return;
    pollTimer = window.setInterval(function () {
      if (document.visibilityState === "visible" && binding) load();
    }, POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = 0;
    document.removeEventListener("visibilitychange", onVisibility);
  }

  window.YRViewerNotifications = { mount: bind, refresh: load, relativeTime: relativeTime, resolveHref: resolveHref };
  window.YRInitViewerNotifications = function () { bind(); return window.YRViewerNotifications; };
  bind();
})();
