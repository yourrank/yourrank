// Public streamer site — shell behaviour.
// Progressive enhancement only: every section renders and is navigable with
// this file blocked. Handles the narrow-width menu drawer, the standings tabs and
// filter, the shop redeem call, the reset countdown and the feedback dialog.
(function () {
  "use strict";

  var side = document.getElementById("yr-side");
  var scrim = document.getElementById("yr-scrim");
  var menu = document.getElementById("yr-menu");
  var sideClose = document.getElementById("yr-side-close");
  var sideOpener = null;
  var bodyOverflow = "";
  var inertBackground = [];
  var drawerFocusables = function () {
    if (!side) return [];
    return Array.prototype.slice.call(side.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
  };

  function closeSide() {
    if (!side || !side.hasAttribute("data-open")) return;
    side.removeAttribute("data-open");
    side.removeAttribute("role");
    side.removeAttribute("aria-modal");
    if (scrim) scrim.hidden = true;
    if (menu) {
      menu.setAttribute("aria-expanded", "false");
      menu.setAttribute("aria-label", "Open sections");
    }
    inertBackground.forEach(function (el) { el.inert = false; });
    inertBackground = [];
    document.body.style.overflow = bodyOverflow;
    var opener = sideOpener || menu;
    sideOpener = null;
    if (opener && typeof opener.focus === "function") opener.focus();
  }

  function openSide() {
    if (!side) return;
    sideOpener = document.activeElement && document.activeElement !== document.body ? document.activeElement : menu;
    bodyOverflow = document.body.style.overflow;
    side.setAttribute("data-open", "");
    side.setAttribute("role", "dialog");
    side.setAttribute("aria-modal", "true");
    if (scrim) scrim.hidden = false;
    if (menu) {
      menu.setAttribute("aria-expanded", "true");
      menu.setAttribute("aria-label", "Close sections");
    }
    inertBackground = Array.prototype.slice.call(document.body.children).filter(function (el) { return el !== side && el !== scrim; });
    inertBackground.forEach(function (el) { el.inert = true; });
    document.body.style.overflow = "hidden";
    var first = drawerFocusables()[0] || side;
    window.setTimeout(function () { first.focus(); }, 0);
  }

  if (menu) menu.addEventListener("click", function () { (side && side.hasAttribute("data-open")) ? closeSide() : openSide(); });
  if (sideClose) sideClose.addEventListener("click", closeSide);
  if (scrim) scrim.addEventListener("click", closeSide);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && dialog && dialog.open) {
      return;
    }
    if (!side || !side.hasAttribute("data-open")) return;
    if (e.key === "Escape") { e.preventDefault(); closeSide(); return; }
    if (e.key !== "Tab") return;
    var focusables = drawerFocusables();
    if (!focusables.length) { e.preventDefault(); side.focus(); return; }
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === side)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // ── Standings: board tabs ───────────────────────────────────────────
  var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-tab]"));
  if (tabs.length) {
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var name = tab.dataset.tab;
        tabs.forEach(function (t) {
          var on = t === tab;
          t.classList.toggle("is-on", on);
          t.setAttribute("aria-selected", on ? "true" : "false");
        });
        document.querySelectorAll("[data-tabpanel]").forEach(function (p) {
          p.hidden = p.dataset.tabpanel !== name;
        });
      });
    });
  }

  // ── Standings: local filter with server fallback and real pagination ──
  var search = document.getElementById("yr-search");
  var playerBoard = document.querySelector("[data-player-board]");
  var countBadge = playerBoard && playerBoard.querySelector("[data-player-count-badge]");
  var rowsRoot = playerBoard && playerBoard.querySelector("[data-rows]");
  var loadMore = document.querySelector("[data-load-more]");
  var loadMoreStatus = document.querySelector("[data-load-more-status]");
  var slug = document.body.dataset.slug || "";
  var isCustomDomain = document.body.dataset.customDomain === "true";
  var loadedCount = rowsRoot ? rowsRoot.querySelectorAll("tr[data-player-name]").length : 0;
  var totalCount = Number((countBadge || {}).textContent?.replace(/[^\d]/g, "")) || loadedCount;
  var activeSearch = "";
  var searchOffset = 0;
  var savedRowsHtml = rowsRoot ? rowsRoot.innerHTML : "";
  var searchStatus = document.getElementById("yr-search-status");
  var empty = document.getElementById("yr-no-match");
  var searchTimer = null;
  var searchRequest = 0;
  var searchController = null;
  var currency = document.body.dataset.currency || "$";
  var rankBy = document.body.dataset.rankBy === "score" ? "score" : "wagered";
  var money = function (v) { return currency + Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 0 }); };
  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]); }); };
  var representations = function () {
    return playerBoard ? Array.prototype.slice.call(playerBoard.querySelectorAll("[data-player-name]")) : [];
  };
  var visiblePlayerCount = function () {
    var names = {};
    representations().forEach(function (representation) {
      if (!representation.hidden) names[representation.dataset.playerName] = true;
    });
    return Object.keys(names).length;
  };
  var updatePlayerCount = function (count) {
    if (!countBadge) return;
    countBadge.textContent = String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (count === 1 ? " player" : " players");
  };
  var rowHtml = function (p) {
    var rank = Number(p.rank) || 0;
    var name = esc(String(p.name || "").toLowerCase());
    return '<tr data-player-name="' + name + '" data-position="' + rank + '">' +
      '<td class="yr-idx">' + String(rank).padStart(2, "0") + '</td>' +
      '<td><a href="' + (isCustomDomain ? "/player/" : "/" + encodeURIComponent(slug) + "/player/") + encodeURIComponent(p.name || "") + '">' + esc(p.name) + '</a></td>' +
      '<td class="yr-mono yr-r">' + esc(rankBy === "score" ? Number(p.score || 0).toLocaleString("en-US") + " pts" : money(p.wagered)) + '</td>' +
      '<td class="yr-mono yr-r">' + (p.prize ? esc(money(p.prize)) : "—") + '</td></tr>';
  };
  var fetchPage = function (offset, q, signal) {
    var params = new URLSearchParams({ limit: "100", offset: String(offset) });
    if (q) params.set("search", q);
    return fetch("/api/public/" + encodeURIComponent(slug) + "/players?" + params.toString(), signal ? { signal: signal } : undefined).then(function (res) {
      if (!res.ok) throw new Error("Could not load players.");
      return res.json();
    });
  };
  var setSearchStatus = function (message, isError) {
    if (!searchStatus) return;
    searchStatus.textContent = message || "";
    searchStatus.classList.toggle("is-error", !!isError);
  };
  var appendPage = function (page, replace) {
    if (!rowsRoot) return;
    var html = (page.players || []).map(rowHtml).join("");
    if (replace) rowsRoot.innerHTML = html;
    else rowsRoot.insertAdjacentHTML("beforeend", html);
    loadedCount = replace ? (page.players || []).length : loadedCount + (page.players || []).length;
    totalCount = Number(page.total) || totalCount;
    if (loadMore) loadMore.hidden = !page.hasMore;
  };
  if (search && rowsRoot && playerBoard) {
    search.addEventListener("input", function () {
      var q = search.value.trim().toLowerCase();
      activeSearch = q;
      searchOffset = 0;
      searchRequest += 1;
      var requestId = searchRequest;
      if (searchController) searchController.abort();
      searchController = null;
      clearTimeout(searchTimer);
      var shown = 0;
      representations().forEach(function (representation) {
        var hit = !q || representation.dataset.playerName.indexOf(q) !== -1;
        representation.hidden = !hit;
        if (hit) shown += 1;
      });
      if (q) updatePlayerCount(visiblePlayerCount());
      if (!q) {
        if (rowsRoot && savedRowsHtml) rowsRoot.innerHTML = savedRowsHtml;
        representations().forEach(function (representation) { representation.hidden = false; });
        loadedCount = rowsRoot.querySelectorAll("tr[data-player-name]").length;
        updatePlayerCount(totalCount);
        if (loadMore) loadMore.hidden = loadedCount >= totalCount;
        if (empty) empty.hidden = true;
        setSearchStatus("");
        return;
      }
      if (shown > 0) {
        updatePlayerCount(visiblePlayerCount());
        if (empty) empty.hidden = true;
        setSearchStatus("");
        return;
      }
      setSearchStatus("Searching…");
      searchTimer = window.setTimeout(function () {
        searchController = typeof AbortController === "function" ? new AbortController() : null;
        fetchPage(0, q, searchController && searchController.signal).then(function (page) {
          if (requestId !== searchRequest || activeSearch !== q) return;
          appendPage(page, true);
          searchOffset = (page.players || []).length;
          var found = (page.players || []).length !== 0;
          representations().forEach(function (representation) {
            representation.hidden = representation.dataset.playerName.indexOf(q) === -1;
          });
          updatePlayerCount(visiblePlayerCount());
          if (empty) empty.hidden = found;
          setSearchStatus(found ? "" : "No matches.");
        }).catch(function (err) {
          if (requestId !== searchRequest || activeSearch !== q || (err && err.name === "AbortError")) return;
          if (empty) empty.hidden = true;
          setSearchStatus("Couldn't load results.", true);
          if (searchStatus && !searchStatus.querySelector("button")) {
            var retry = document.createElement("button");
            retry.type = "button";
            retry.className = "yr-search-retry";
            retry.textContent = "Retry";
            retry.addEventListener("click", function () { search.dispatchEvent(new Event("input", { bubbles: true })); });
            searchStatus.appendChild(retry);
          }
        });
      }, 250);
    });
  }

  if (loadMore) {
    loadMore.addEventListener("click", function () {
      loadMore.disabled = true;
      if (loadMoreStatus) loadMoreStatus.textContent = "Loading…";
      var offset = activeSearch ? searchOffset : loadedCount;
      fetchPage(offset, activeSearch).then(function (page) {
        appendPage(page, !!activeSearch && searchOffset === 0);
        if (activeSearch) searchOffset += (page.players || []).length;
        loadMore.disabled = false;
        if (loadMoreStatus) loadMoreStatus.textContent = "";
      }).catch(function (err) {
        loadMore.disabled = false;
        if (loadMoreStatus) loadMoreStatus.textContent = err.message;
      });
    });
  }

  // ── Authenticated public actions ────────────────────────────────────
  var readCsrfToken = function () {
    var csrfEl = document.querySelector('meta[name="csrf-token"]');
    return (csrfEl && csrfEl.content) || "";
  };

  // ── Shop: redeem ────────────────────────────────────────────────────
  var redeemStatus = document.getElementById("yr-redeem-status");
  var setRedeemStatus = function (message, isError) {
    if (!redeemStatus) return;
    redeemStatus.textContent = message || "";
    redeemStatus.classList.toggle("is-error", !!isError);
  };
  document.querySelectorAll("[data-redeem]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var label = btn.textContent;
      var name = btn.dataset.rewardName || "this reward";
      var cost = btn.dataset.rewardCost || "0";
      if (!window.confirm("Order “" + name + "” for " + cost + " credits?")) return;
      var focusTarget = btn;
      btn.disabled = true;
      btn.textContent = "Placing order…";
      setRedeemStatus("Ordering “" + name + "”…");
      var idempotencyKey = btn.dataset.redeemKey;
      if (!idempotencyKey) {
        idempotencyKey = (typeof crypto !== "undefined" && crypto.randomUUID)
          ? crypto.randomUUID()
          : Date.now() + "-" + Math.random().toString(36).slice(2);
        btn.dataset.redeemKey = idempotencyKey;
      }
      fetch("/api/viewer/redeem", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": readCsrfToken() },
        body: JSON.stringify({ slug: slug, shopItemId: btn.dataset.redeem, idempotencyKey: idempotencyKey }),
      })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (r) {
          if (r.ok && r.data.ok) {
            delete btn.dataset.redeemKey;
            btn.textContent = "Requested";
            btn.classList.add("is-success");
            setRedeemStatus("Order placed: “" + name + "”. " + cost + " credits deducted.");
            focusTarget.focus();
          } else {
            btn.textContent = label;
            btn.disabled = false;
            setRedeemStatus(r.data.error || "Couldn’t place that order. Please try again.", true);
            focusTarget.focus();
          }
        })
        .catch(function () {
          btn.textContent = label;
          btn.disabled = false;
          setRedeemStatus("Network error. Your credits were not confirmed as deducted; please try again.", true);
          focusTarget.focus();
        });
    });
  });

  // ── Table overflow affordance ───────────────────────────────────────
  document.querySelectorAll("[data-table-wrap]").forEach(function (wrap) {
    var syncOverflow = function () {
      wrap.dataset.overflow = wrap.scrollWidth > wrap.clientWidth && wrap.scrollLeft < wrap.scrollWidth - wrap.clientWidth - 1 ? "true" : "false";
    };
    syncOverflow();
    wrap.addEventListener("scroll", syncOverflow, { passive: true });
    window.addEventListener("resize", syncOverflow);
  });

  // ── Countdown ───────────────────────────────────────────────────────
  var cd = document.querySelector("[data-ends-at]");
  if (cd) {
    var end = Number(cd.dataset.endsAt);
    var tick = function () {
      var left = Math.max(0, end - Date.now());
      var d = Math.floor(left / 86400000);
      var h = Math.floor((left % 86400000) / 3600000);
      var m = Math.floor((left % 3600000) / 60000);
      cd.textContent = d > 0 ? d + "d " + h + "h" : h + "h " + m + "m";
    };
    if (end) { tick(); setInterval(tick, 30000); }
  }

  // ── Feedback dialog ─────────────────────────────────────────────────
  var dialog = document.getElementById("yr-feedback");
  var statusEl = document.getElementById("yr-feedback-status");
  var feedbackOpener = null;
  var feedbackMessage = dialog && dialog.querySelector('textarea[name="message"]');
  var restoreFeedbackFocus = function () {
    var opener = feedbackOpener;
    feedbackOpener = null;
    if (opener && typeof opener.focus === "function") opener.focus();
  };
  document.querySelectorAll("[data-feedback-open]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (!dialog || !dialog.showModal) return;
      feedbackOpener = b;
      closeSide();
      if (statusEl) statusEl.textContent = "";
      dialog.showModal();
      window.setTimeout(function () { if (feedbackMessage) feedbackMessage.focus(); }, 0);
    });
  });
  var closeBtn = document.getElementById("yr-feedback-close");
  if (closeBtn && dialog) closeBtn.addEventListener("click", function () { dialog.close(); });
  if (dialog) dialog.addEventListener("close", restoreFeedbackFocus);

  var form = dialog && dialog.querySelector("form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      var message = form.message.value.trim();
      if (message.length < 10) {
        if (statusEl) statusEl.textContent = "Please write at least 10 characters.";
        return;
      }
      btn.disabled = true;
      btn.textContent = "Sending…";
      fetch("/api/feedback", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": readCsrfToken() },
        body: JSON.stringify({ slug: form.slug.value, message: message }),
      })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (r) {
          if (r.ok && r.data.ok) {
            if (statusEl) statusEl.textContent = "Thanks — your feedback was sent.";
            form.message.value = "";
            setTimeout(function () { dialog.close(); }, 1200);
          } else {
            if (statusEl) statusEl.textContent = r.data.error || "Could not send feedback. Try again.";
          }
          btn.disabled = false;
          btn.textContent = "Send";
        })
        .catch(function () {
          if (statusEl) statusEl.textContent = "Network error. Please try again.";
          btn.disabled = false;
          btn.textContent = "Send";
        });
    });
  }
})();
