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
  // The drawer trigger is the one control on the page that cannot work without
  // this file, so the server ships it hidden and it is disclosed here. With the
  // script blocked the top bar has no dead control and the footer keeps every
  // section link; with the script running the drawer behaves exactly as before.
  if (menu && side) menu.hidden = false;
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
  var loadedCount = rowsRoot ? rowsRoot.querySelectorAll("[data-player-name]").length : 0;
  var totalCount = Number((countBadge || {}).textContent?.replace(/[^\d]/g, "")) || loadedCount;
  var activeSearch = "";
  var searchOffset = 0;
  var savedRowsHtml = rowsRoot ? rowsRoot.innerHTML : "";
  var searchStatus = document.getElementById("yr-search-status");
  var empty = document.getElementById("yr-no-match");
  var searchTimer = null;
  var searchRequest = 0;
  var searchController = null;
  var pageRequest = 0;
  var currency = document.body.dataset.currency || "$";
  var rankBy = document.body.dataset.rankBy === "score" ? "score" : "wagered";
  var valueLabel = (rowsRoot && rowsRoot.dataset.valueLabel) || "Amount";
  var prizeLabel = (rowsRoot && rowsRoot.dataset.prizeLabel) || "Prize";
  var hidePrizes = !!rowsRoot && rowsRoot.dataset.hidePrizes === "true";
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
  var plural = function (count) {
    return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (count === 1 ? " player" : " players");
  };
  // The badge always states the size of the board. Match counts belong to the
  // search status, so a filtered view never rewrites the board's own total.
  var updatePlayerCount = function (count) {
    if (countBadge) countBadge.textContent = plural(count);
  };
  var rowHtml = function (p, rank) {
    var name = esc(String(p.name || "").toLowerCase());
    var value = esc(rankBy === "score" ? Number(p.score || 0).toLocaleString("en-US") + " pts" : money(p.wagered));
    var prize = !hidePrizes && p.prize ? esc(money(p.prize)) : "";
    return '<li class="yr-srow' + (rank === 1 ? " yr-srow--first" : rank <= 3 ? " yr-srow--top" : "") +
      '" data-player-name="' + name + '" data-position="' + rank + '">' +
      '<span class="yr-srow-rank"><span class="yr-sr">Rank </span>' + rank + "</span>" +
      '<a class="yr-srow-name" href="' + (isCustomDomain ? "/player/" : "/" + encodeURIComponent(slug) + "/player/") + encodeURIComponent(p.name || "") + '">' + esc(p.name) + "</a>" +
      '<span class="yr-srow-val"><span class="yr-sr">' + esc(valueLabel) + ': </span>' + value + "</span>" +
      (prize ? '<span class="yr-srow-prize"><span class="yr-sr">' + esc(prizeLabel) + ': </span>' + prize + "</span>" : "") +
      "</li>";
  };
  var fetchPage = function (offset, q, signal) {
    var params = new URLSearchParams({ limit: "100", offset: String(offset) });
    if (q) params.set("search", q);
    return fetch("/api/public/" + encodeURIComponent(slug) + "/players?" + params.toString(), signal ? { signal: signal } : undefined).then(function (res) {
      if (!res.ok) throw new Error("request failed");
      return res.json();
    });
  };
  var setSearchStatus = function (message, isError) {
    if (!searchStatus) return;
    searchStatus.textContent = message || "";
    searchStatus.classList.toggle("is-error", !!isError);
  };
  var addRetry = function (host, run) {
    if (!host || host.querySelector("button")) return;
    var retry = document.createElement("button");
    retry.type = "button";
    retry.className = "yr-search-retry";
    retry.textContent = "Try again";
    retry.addEventListener("click", run);
    host.appendChild(retry);
  };
  // One row per player: a name already on the board is never appended twice,
  // however often the button is pressed or a page is replayed.
  var appendPage = function (page, replace) {
    if (!rowsRoot) return 0;
    if (replace) rowsRoot.innerHTML = "";
    var known = {};
    rowsRoot.querySelectorAll("[data-player-name]").forEach(function (row) { known[row.dataset.playerName] = true; });
    var html = "";
    var added = 0;
    (page.players || []).forEach(function (p, i) {
      var key = String(p.name || "").toLowerCase();
      if (known[key]) return;
      known[key] = true;
      added += 1;
      html += rowHtml(p, Number(p.rank) || i + 1);
    });
    if (html) rowsRoot.insertAdjacentHTML("beforeend", html);
    loadedCount = rowsRoot.querySelectorAll("[data-player-name]").length;
    if (!activeSearch && Number(page.total)) totalCount = Number(page.total);
    if (loadMore) loadMore.hidden = !page.hasMore;
    return added;
  };
  if (search && rowsRoot && playerBoard) {
    search.addEventListener("input", function () {
      var q = search.value.trim().toLowerCase();
      activeSearch = q;
      searchOffset = 0;
      searchRequest += 1;
      pageRequest += 1;
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
      if (!q) {
        // Clearing the field restores exactly the standings the server sent.
        if (rowsRoot && savedRowsHtml) rowsRoot.innerHTML = savedRowsHtml;
        representations().forEach(function (representation) { representation.hidden = false; });
        loadedCount = rowsRoot.querySelectorAll("[data-player-name]").length;
        updatePlayerCount(totalCount);
        if (loadMore) loadMore.hidden = loadedCount >= totalCount;
        if (empty) empty.hidden = true;
        setSearchStatus("");
        return;
      }
      if (shown > 0) {
        if (empty) empty.hidden = true;
        setSearchStatus(plural(visiblePlayerCount()) + " match “" + q + "”.");
        return;
      }
      searchTimer = window.setTimeout(function () {
        setSearchStatus("Searching…");
        searchController = typeof AbortController === "function" ? new AbortController() : null;
        fetchPage(0, q, searchController && searchController.signal).then(function (page) {
          if (requestId !== searchRequest || activeSearch !== q) return;
          appendPage(page, true);
          searchOffset = (page.players || []).length;
          var found = (page.players || []).length !== 0;
          representations().forEach(function (representation) {
            representation.hidden = representation.dataset.playerName.indexOf(q) === -1;
          });
          if (empty) empty.hidden = found;
          setSearchStatus(found ? plural(visiblePlayerCount()) + " match “" + q + "”." : "");
        }).catch(function (err) {
          if (requestId !== searchRequest || activeSearch !== q || (err && err.name === "AbortError")) return;
          if (empty) empty.hidden = true;
          setSearchStatus("Couldn’t search players.", true);
          addRetry(searchStatus, function () { search.dispatchEvent(new Event("input", { bubbles: true })); });
        });
      }, 250);
    });
  }

  if (loadMore) {
    var loadMoreLabel = loadMore.textContent;
    var setPageStatus = function (message, isError) {
      if (!loadMoreStatus) return;
      loadMoreStatus.textContent = message || "";
      loadMoreStatus.classList.toggle("is-error", !!isError);
    };
    var loadNextPage = function () {
      pageRequest += 1;
      var requestId = pageRequest;
      var query = activeSearch;
      loadMore.disabled = true;
      loadMore.textContent = "Loading…";
      setPageStatus("Loading more players…");
      fetchPage(query ? searchOffset : loadedCount, query).then(function (page) {
        if (requestId !== pageRequest || query !== activeSearch) return;
        var added = appendPage(page, false);
        if (query) {
          searchOffset += (page.players || []).length;
          representations().forEach(function (representation) {
            representation.hidden = representation.dataset.playerName.indexOf(query) === -1;
          });
        }
        loadMore.disabled = false;
        loadMore.textContent = loadMoreLabel;
        setPageStatus(added ? plural(query ? visiblePlayerCount() : loadedCount) + " shown." : "No more players to load.");
        // The button disappears with the last page, so the status it leaves
        // behind takes the focus instead of dropping it back to the document —
        // without scrolling the viewer away from the rows they just loaded.
        if (loadMore.hidden && loadMoreStatus) focusWithoutScroll(loadMoreStatus);
      }).catch(function () {
        if (requestId !== pageRequest || query !== activeSearch) return;
        loadMore.disabled = false;
        loadMore.textContent = loadMoreLabel;
        setPageStatus("Couldn’t load more players.", true);
        addRetry(loadMoreStatus, loadNextPage);
      });
    };
    loadMore.addEventListener("click", loadNextPage);
  }

  // Focus continuity without a viewport jump: the replacement element takes
  // focus, and browsers that ignore preventScroll get the viewport put back.
  function focusWithoutScroll(el) {
    if (!el || typeof el.focus !== "function") return;
    var restoreX = window.scrollX;
    var restoreY = window.scrollY;
    el.focus({ preventScroll: true });
    if (window.scrollX !== restoreX || window.scrollY !== restoreY) window.scrollTo(restoreX, restoreY);
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

  // Backend order failures arrive as terse codes. The viewer reads a sentence
  // about their own order instead; anything unrecognised that is not already a
  // member-facing sentence falls back rather than leaking wording from the API.
  var ORDER_ERRORS = {
    "insufficient balance": "You don’t have enough credits for that yet.",
    "item not found": "That reward is no longer available.",
    "out of stock": "That reward just went out of stock.",
    "viewer blocked": "You can’t order on this site right now. Ask the streamer.",
    "rate limited": "Too many attempts. Wait a moment and try again.",
    "invalid csrf": "Your session expired. Reload the page and try again.",
    unauthorized: "Sign in again to place this order.",
  };
  var orderErrorText = function (message) {
    var fallback = "Couldn’t place that order. Please try again.";
    if (!message) return fallback;
    var known = ORDER_ERRORS[String(message).toLowerCase()];
    if (known) return known;
    var sentence = /^[A-Z].*[.!?]$/.test(message) && !/^HTTP /.test(message);
    return sentence ? message : fallback;
  };

  // The confirmation is the viewer's own dialog, not the browser's: it can name
  // the reward, its cost in free credits and what is left afterwards. A native
  // <dialog> owns the focus trap, Escape and background inertness; cancelling
  // or pressing Escape sends nothing and returns focus to the button used.
  var confirmDialog = document.getElementById("yr-order-confirm");
  var confirmDetail = confirmDialog && confirmDialog.querySelector("[data-order-detail]");
  var confirmOk = confirmDialog && confirmDialog.querySelector("[data-order-confirm]");
  var confirmCancel = confirmDialog && confirmDialog.querySelector("[data-order-cancel]");
  var pendingConfirm = null;
  var creditBalance = function () {
    var el = document.querySelector("[data-credit-balance]");
    var value = el ? Number(el.dataset.creditBalance) : NaN;
    return Number.isFinite(value) ? value : null;
  };
  if (confirmDialog) {
    confirmDialog.addEventListener("close", function () {
      var resolve = pendingConfirm;
      pendingConfirm = null;
      if (resolve) resolve(confirmDialog.returnValue === "order");
    });
    if (confirmCancel) confirmCancel.addEventListener("click", function () { confirmDialog.close("cancel"); });
    if (confirmOk) confirmOk.addEventListener("click", function () { confirmDialog.close("order"); });
  }
  var askToOrder = function (name, cost) {
    if (!confirmDialog || !confirmDialog.showModal) {
      setRedeemStatus("Ordering is unavailable right now. Reload the page and try again.", true);
      return Promise.resolve(false);
    }
    var balance = creditBalance();
    var detail = "Order “" + name + "” for " + Number(cost).toLocaleString("en-US") + " free credits.";
    if (balance !== null && balance >= Number(cost)) {
      detail += " You'd have " + (balance - Number(cost)).toLocaleString("en-US") + " credits left.";
    }
    if (confirmDetail) confirmDetail.textContent = detail;
    return new Promise(function (resolve) {
      pendingConfirm = resolve;
      confirmDialog.returnValue = "";
      confirmDialog.showModal();
      // Cancel takes the initial focus so a second Enter keypress on the reward
      // button cannot spend credits by accident.
      if (confirmCancel) confirmCancel.focus();
      else if (confirmOk) confirmOk.focus();
    });
  };

  document.querySelectorAll("[data-redeem]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var label = btn.textContent;
      var name = btn.dataset.rewardName || "this reward";
      var cost = btn.dataset.rewardCost || "0";
      askToOrder(name, cost).then(function (confirmed) {
        if (confirmed) placeOrder(btn, label, name, cost);
      });
    });
  });

  function placeOrder(btn, label, name, cost) {
    var recover = function (message) {
      btn.textContent = label;
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      setRedeemStatus(message, true);
      focusWithoutScroll(btn);
    };
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
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
          btn.textContent = "Ordered";
          btn.removeAttribute("aria-busy");
          btn.classList.add("is-success");
          setRedeemStatus("Order placed: “" + name + "”. " + cost + " free credits used. The streamer fulfils it by hand.");
          if (typeof r.data.balance === "number") updateBalance(r.data.balance);
          // The button is spent, so the status region keeps focus on the page.
          focusWithoutScroll(redeemStatus || btn);
        } else {
          recover(orderErrorText(r.data.error));
        }
      })
      .catch(function () {
        recover("Network error. Your credits were not confirmed as deducted; please try again.");
      });
  }

  function updateBalance(balance) {
    document.querySelectorAll("[data-credit-balance]").forEach(function (el) {
      el.dataset.creditBalance = String(balance);
      var text = Number(balance).toLocaleString("en-US");
      var num = el.querySelector("[data-credit-balance-num]") || el;
      num.textContent = text;
      if (el.dataset.creditBalanceLabel) el.setAttribute("aria-label", el.dataset.creditBalanceLabel + ": " + text);
    });
  }

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
