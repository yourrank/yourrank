// Public streamer site — shell behaviour.
// Progressive enhancement only: every section renders and is navigable with
// this file blocked. Handles the narrow-width menu drawer, the standings tabs and
// filter, the shop redeem call, the reset countdown and the feedback dialog.
(function initSitePage() {
  "use strict";
  window.YRInitSitePage = initSitePage;
  var pageLifetime = new AbortController();
  var streamState = document.querySelector('[data-kick-channel]');
  if (streamState) {
    fetch('/api/giveaways/chatroom?channel=' + encodeURIComponent(streamState.dataset.kickChannel), { signal: pageLifetime.signal })
      .then(function (response) { if (!response.ok) throw new Error('Unavailable'); return response.json(); })
      .then(function (data) {
        if (typeof data.isLive !== 'boolean' || data.error || pageLifetime.signal.aborted) return;
        streamState.textContent = data.isLive ? 'Live now on Kick' : 'Offline on Kick';
        document.querySelectorAll('[data-live-badge]').forEach(function (badge) { badge.hidden = !data.isLive; });
        document.querySelectorAll('[data-stream-status-plain]').forEach(function (el) {
          el.textContent = data.isLive ? 'Live now — watch on Kick' : 'Offline right now';
        });
      }).catch(function () { /* Keep the explicit unavailable state. */ });
  }
  document.addEventListener("yr:viewer-unmount", function () {
    pageLifetime.abort();
    clearTimeout(searchTimer);
    if (searchController) searchController.abort();
    clearInterval(countdownTimer);
    searchRequest++;
    pageRequest++;
  }, { once: true });

  // OAuth errors are one-time context. The server renders a controlled message
  // on My Community; remove only the known query key so refresh does not replay
  // stale failure feedback and unrelated navigation state remains intact.
  if (document.body && document.body.dataset.section === "me") {
    var authUrl = new URL(window.location.href);
    if (authUrl.searchParams.has("error")) {
      authUrl.searchParams.delete("error");
      window.history.replaceState({}, "", authUrl.pathname + authUrl.search + authUrl.hash);
    }
  }

  var side = document.getElementById("yr-side");
  var scrim = document.getElementById("yr-scrim");
  var menu = document.getElementById("yr-menu");
  var sideClose = document.getElementById("yr-side-close");
  // The drawer trigger is the one control on the page that cannot work without
  // this file, so the server ships it hidden and it is disclosed here. With the
  // script blocked the top bar has no dead control and the footer keeps every
  // section link; with the script running the drawer behaves exactly as before.
  if (menu && side) menu.hidden = false;
  // Same contract for the footer's section map: it is server-rendered so a
  // viewer whose browser never ran this file can still reach every section,
  // and it is hidden by the stylesheet only once this flag says the bar and
  // the drawer are live. Blocked or failed script keeps the fallback visible.
  document.documentElement.setAttribute("data-yr-shell", "ready");
  var sideOpener = null;
  var bodyOverflow = "";
  var inertBackground = [];
  var drawerFocusables = function () {
    if (!side) return [];
    return Array.prototype.slice.call(side.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter(function (el) { return el.getClientRects().length && !el.closest("[hidden], [inert]"); });
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
    inertBackground.forEach(function (entry) { entry.el.inert = entry.inert; });
    inertBackground = [];
    document.body.style.overflow = bodyOverflow;
    var opener = sideOpener || menu;
    sideOpener = null;
    if (opener && typeof opener.focus === "function") opener.focus();
  }

  function openSide() {
    if (!side || side.hasAttribute("data-open")) return;
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
    var branch = side;
    while (branch && branch !== document.body) {
      Array.prototype.forEach.call(branch.parentElement.children, function (el) {
        if (el === branch || el === scrim || /^(SCRIPT|STYLE|LINK)$/.test(el.tagName)) return;
        inertBackground.push({ el: el, inert: el.inert });
        el.inert = true;
      });
      branch = branch.parentElement;
    }
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
    if (!side.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && (document.activeElement === first || document.activeElement === side)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, { signal: pageLifetime.signal });

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
  var rankBy = document.body.dataset.rankBy === "wagered" ? "wagered" : "score";
  var valueLabel = (rowsRoot && rowsRoot.dataset.valueLabel) || "Amount";
  var prizeLabel = (rowsRoot && rowsRoot.dataset.prizeLabel) || "Prize";
  var hidePrizes = !!rowsRoot && rowsRoot.dataset.hidePrizes === "true";
  var podium = document.querySelector("[data-podium]");
  var eventId = document.body.dataset.eventId || "";
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
    var identity = '<span class="yr-player-mark" aria-hidden="true">' + esc(Array.from(String(p.name || "?")).slice(0, 2).join("").toUpperCase()) + '</span><span class="yr-player-name">' + esc(p.name) + '</span>';
    var labelClass = "yr-sr";
    return '<li class="yr-srow' + (rank === 1 ? " yr-srow--first" : rank <= 3 ? " yr-srow--top" : "") +
      '" data-player-name="' + name + '" data-position="' + rank + '">' +
      '<span class="yr-srow-rank"><span class="yr-sr">Rank </span>' + rank + "</span>" +
      (eventId ? '<span class="yr-srow-name">' + identity + '</span>' : '<a class="yr-srow-name" href="' + (isCustomDomain ? "/player/" : "/" + encodeURIComponent(slug) + "/player/") + encodeURIComponent(p.name || "") + '">' + identity + "</a>") +
      '<span class="yr-srow-val"><span class="' + labelClass + '">' + esc(valueLabel) + ': </span>' + value + "</span>" +
      (prize ? '<span class="yr-srow-prize"><span class="' + labelClass + '">' + esc(prizeLabel) + ': </span>' + prize + "</span>" : "") +
      "</li>";
  };
  var fetchPage = function (offset, q, signal) {
    var params = new URLSearchParams({ limit: "100", offset: String(offset) });
    if (eventId) params.set("event", eventId);
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
    if (!activeSearch) savedRowsHtml = rowsRoot.innerHTML;
    if (loadMore) loadMore.hidden = !page.hasMore;
    return added;
  };
  if (search && rowsRoot && playerBoard) {
    search.addEventListener("input", function () {
      var q = search.value.trim().toLowerCase();
      if (podium) podium.hidden = !!q;
      activeSearch = q;
      searchOffset = 0;
      searchRequest += 1;
      pageRequest += 1;
      var requestId = searchRequest;
      if (searchController) searchController.abort();
      searchController = null;
      clearTimeout(searchTimer);
      if (loadMore) {
        loadMore.disabled = false;
        loadMore.textContent = loadMoreLabel;
      }
      if (loadMoreStatus) loadMoreStatus.textContent = "";
      rowsRoot.innerHTML = savedRowsHtml;
      loadedCount = rowsRoot.querySelectorAll("[data-player-name]").length;
      if (loadMore) loadMore.hidden = loadedCount >= totalCount;
      var shown = 0;
      representations().forEach(function (representation) {
        var hit = !q || representation.dataset.playerName.indexOf(q) !== -1;
        representation.hidden = !hit;
        if (hit) shown += 1;
      });
      if (!q) {
        // Restore all unfiltered pages already loaded, including podium slots.
        rowsRoot.innerHTML = savedRowsHtml;
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
      if (loadMore) loadMore.hidden = true;
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

  // ── My Community: explicit Membership Join ───────────────────────
  var joinButton = document.querySelector("[data-membership-join]");
  var joinStatus = document.getElementById("yr-membership-join-status");
  var setJoinStatus = function (message, isError) {
    if (!joinStatus) return;
    joinStatus.textContent = message || "";
    joinStatus.classList.toggle("is-error", !!isError);
  };
  if (joinButton) {
    joinButton.addEventListener("click", function () {
      var label = joinButton.textContent;
      joinButton.disabled = true;
      joinButton.setAttribute("aria-busy", "true");
      joinButton.textContent = "Joining…";
      setJoinStatus("Joining this community…");
      fetch("/api/viewer/membership/join", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": readCsrfToken() },
        body: JSON.stringify({ slug: joinButton.dataset.siteSlug || slug }),
      })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          if (result.ok && result.data.ok) {
            joinButton.textContent = "Joined";
            joinButton.removeAttribute("aria-busy");
            setJoinStatus("Community joined. Loading your membership…");
            if (window.YRViewerApp) window.YRViewerApp.refresh(); else window.location.reload();
            return;
          }
          joinButton.disabled = false;
          joinButton.removeAttribute("aria-busy");
          joinButton.textContent = label;
          var known = result.data.error === "Too many join attempts. Try again shortly."
            ? result.data.error
            : result.data.error === "Community is not available."
              ? result.data.error
              : result.data.error === "invalid csrf"
                ? "Your session expired. Reload the page and try again."
                : "We couldn't join this community. Try again.";
          setJoinStatus(known, true);
          focusWithoutScroll(joinStatus || joinButton);
        })
        .catch(function () {
          joinButton.disabled = false;
          joinButton.removeAttribute("aria-busy");
          joinButton.textContent = label;
          setJoinStatus("Network error. This community was not joined. Try again.", true);
          focusWithoutScroll(joinStatus || joinButton);
        });
    });
  }

  // ── My Community: safe free code-drop claim ─────────────────────
  var codeDropForm = document.querySelector("[data-code-drop-claim]");
  var codeDropInput = document.getElementById("yr-code-drop-code");
  var codeDropStatus = document.getElementById("yr-code-drop-status");
  var codeDropButton = codeDropForm && codeDropForm.querySelector("[data-code-drop-submit]");
  var setCodeDropStatus = function (message, isError) {
    if (!codeDropStatus) return;
    codeDropStatus.textContent = message || "";
    codeDropStatus.classList.toggle("is-error", !!isError);
  };
  var CODE_DROP_ERRORS = {
    "Invalid or expired drop code.": "That code is invalid or no longer active.",
    "This drop code has expired.": "That code has expired.",
    "All claims for this drop have been taken!": "That code has no claims remaining.",
    "You have already claimed this drop code!": "You already claimed that code.",
    "Too many attempts. Please wait a minute.": "Too many attempts. Wait a minute, then try again.",
    "Claiming is unavailable for this membership.": "Claiming is unavailable for this membership.",
    "invalid csrf": "Your session expired. Reload the page and try again.",
    unauthorized: "Sign in again to claim this code.",
  };
  var codeDropErrorText = function (message) {
    return CODE_DROP_ERRORS[message] || "Couldn’t claim that code. Check it and try again.";
  };
  if (codeDropForm && codeDropInput && codeDropButton) {
    codeDropForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var code = codeDropInput.value.trim().toUpperCase();
      if (!code) {
        setCodeDropStatus("Enter the community code shared by the creator.", true);
        focusWithoutScroll(codeDropInput);
        return;
      }
      var label = codeDropButton.textContent;
      codeDropButton.disabled = true;
      codeDropButton.setAttribute("aria-busy", "true");
      codeDropButton.textContent = "Claiming…";
      setCodeDropStatus("Checking that code…");
      fetch("/api/events/drops/claim", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": readCsrfToken() },
        body: JSON.stringify({ site: codeDropForm.dataset.siteSlug || slug, code: code }),
      })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          if (result.ok && result.data.ok) {
            codeDropButton.textContent = "Claimed";
            codeDropButton.removeAttribute("aria-busy");
            codeDropButton.classList.add("is-success");
            var points = Number(result.data.pointsAwarded || 0);
            setCodeDropStatus("Code redeemed. " + points.toLocaleString("en-US") + " credits added. Loading your participation…");
            if (typeof result.data.newBalance === "number") updateBalance(result.data.newBalance);
            focusWithoutScroll(codeDropStatus || codeDropButton);
            if (window.YRViewerApp) window.YRViewerApp.refresh(); else window.location.reload();
            return;
          }
          codeDropButton.disabled = false;
          codeDropButton.removeAttribute("aria-busy");
          codeDropButton.textContent = label;
          setCodeDropStatus(codeDropErrorText(result.data.error), true);
          focusWithoutScroll(codeDropStatus || codeDropButton);
        })
        .catch(function () {
          codeDropButton.disabled = false;
          codeDropButton.removeAttribute("aria-busy");
          codeDropButton.textContent = label;
          setCodeDropStatus("Network error. The code was not confirmed as claimed; try again.", true);
          focusWithoutScroll(codeDropStatus || codeDropButton);
        });
    });
  }

  // ── Shop: redeem ────────────────────────────────────────────────────
  var redeemStatus = document.getElementById("yr-redeem-status");
  var setRedeemStatus = function (message, isError) {
    if (!redeemStatus) return;
    redeemStatus.textContent = message || "";
    redeemStatus.classList.toggle("is-error", !!isError);
  };

  // Backend redemption failures arrive as terse codes. The viewer reads a sentence
  // about their own claim instead; anything unrecognised that is not already a
  // member-facing sentence falls back rather than leaking wording from the API.
  var ORDER_ERRORS = {
    "insufficient balance": "You don’t have enough credits for that yet.",
    "item not found": "That reward is no longer available.",
    "out of stock": "That reward just went out of stock.",
    "viewer blocked": "You can’t claim rewards on this site right now. Ask the streamer.",
    "rate limited": "Too many attempts. Wait a moment and try again.",
    "invalid csrf": "Your session expired. Reload the page and try again.",
    unauthorized: "Sign in again to submit this claim.",
  };
  var orderErrorText = function (message) {
    var fallback = "Couldn’t submit that claim. Please try again.";
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
      setRedeemStatus("Claiming is unavailable right now. Reload the page and try again.", true);
      return Promise.resolve(false);
    }
    var balance = creditBalance();
    var detail = "Claim “" + name + "” for " + Number(cost).toLocaleString("en-US") + " free credits.";
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
    btn.textContent = "Claiming…";
    setRedeemStatus("Claiming “" + name + "”…");
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
          btn.textContent = "Claimed";
          btn.removeAttribute("aria-busy");
          btn.classList.add("is-success");
          setRedeemStatus("Claim submitted: “" + name + "”. " + cost + " free credits used. The creator will complete it.");
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
    window.addEventListener("resize", syncOverflow, { signal: pageLifetime.signal });
  });

  // ── Countdown ───────────────────────────────────────────────────────
  var cd = document.querySelector("[data-countdown-mode=\"relative\"] [data-ends-at]");
  if (cd) {
    var end = Date.parse(cd.dataset.endsAt || "");
    var countdown = cd.closest("[data-countdown-mode]");
    var tick = function () {
      var left = end - Date.now();
      if (left <= 0) {
        if (countdown) countdown.textContent = countdown.dataset.countdownComplete || "Ended";
        return false;
      }
      var d = Math.floor(left / 86400000);
      var h = Math.floor((left % 86400000) / 3600000);
      var m = Math.floor((left % 3600000) / 60000);
      var s = Math.floor((left % 60000) / 1000);
      if (countdown && countdown.querySelector("[data-cd-days]")) {
        var units = { days: d, hours: h, minutes: m, seconds: s };
        Object.keys(units).forEach(function (key) {
          var el = countdown.querySelector("[data-cd-" + key + "]");
          if (el) el.textContent = String(units[key]).padStart(2, "0");
        });
      } else {
        cd.textContent = d > 0 ? d + "d " + h + "h" : h > 0 ? h + "h " + m + "m" : m > 0 ? m + "m" : "Less than 1m";
      }
      return true;
    };
    if (Number.isFinite(end) && tick()) {
      var cdMs = countdown && countdown.querySelector("[data-cd-days]") ? 1000 : 30000;
      var countdownTimer = setInterval(function () { if (!tick()) clearInterval(countdownTimer); }, cdMs);
    }
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
      if (btn.disabled) return;
      var message = form.message.value.trim();
      if (message.length < 10) {
        if (statusEl) statusEl.textContent = "Please write at least 10 characters.";
        return;
      }
      btn.disabled = true;
      btn.textContent = "Sending…";
      fetch("/api/feedback", {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": readCsrfToken() },
        body: JSON.stringify({ slug: form.slug.value, message: message }),
      })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (r) {
          if (r.ok && r.data.ok) {
            if (statusEl) statusEl.textContent = "Your feedback was sent to the site owner.";
            if (form.message.value.trim() === message) form.message.value = "";
          } else {
            if (statusEl) statusEl.textContent = r.data.error || "Could not send feedback. Try again.";
          }
          btn.disabled = false;
          btn.textContent = "Send";
        })
        .catch(function () {
          if (statusEl) statusEl.textContent = "Could not confirm delivery. Your message is still here; check your connection before trying again.";
          btn.disabled = false;
          btn.textContent = "Send";
        });
    });
  }

  // ── Rewards: search filter ──────────────────────────────────────────
  var rewardSearch = document.querySelector("[data-reward-search]");
  if (rewardSearch) {
    var rewardTargets = function () {
      return Array.prototype.slice.call(document.querySelectorAll(".viewer-reward-card, .yr-rwd"));
    };
    var rewardNoMatch = document.getElementById("yr-reward-nomatch");
    rewardSearch.addEventListener("input", function () {
      var q = rewardSearch.value.trim().toLowerCase();
      var shown = 0;
      rewardTargets().forEach(function (el) {
        var hit = !q || el.textContent.toLowerCase().indexOf(q) !== -1;
        el.hidden = !hit;
        if (hit) shown += 1;
      });
      if (rewardNoMatch) rewardNoMatch.hidden = shown > 0;
    });
  }

  // ── My Activity: tabbed history ──────────────────────────────────────
  document.addEventListener("click", function (event) {
    var tab = event.target.closest("[data-me-tab]");
    if (!tab) return;
    var card = tab.closest(".viewer-activity-card");
    if (!card) return;
    card.querySelectorAll("[data-me-tab]").forEach(function (t) {
      t.classList.toggle("is-on", t === tab);
      t.setAttribute("aria-selected", t === tab ? "true" : "false");
    });
    card.querySelectorAll("[data-me-pane]").forEach(function (pane) {
      pane.hidden = pane.dataset.mePane !== tab.dataset.meTab;
    });
  });

  // ── Activities: daily quests ─────────────────────────────────────────
  // The quests payload is the canonical API contract: the GET lazily creates
  // today's rows server-side, so the page never invents a quest.
  var questsRoot = document.querySelector("[data-quests-root]");
  if (questsRoot) {
    var questsLoading = questsRoot.querySelector("[data-quests-loading]");
    var fmt = function (n) { return Number(n || 0).toLocaleString("en-US"); };
    var questIcon = function (key) {
      var paths = {
        watch_30m: '<path d="M7 4.5v15l13-7.5z"/>',
        chat_5_msgs: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
        event_participate: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
      };
      return '<svg class="viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[key] || paths.event_participate) + '</svg>';
    };
    var kickWatchHref = streamState && streamState.dataset.kickChannel ? 'https://kick.com/' + encodeURIComponent(streamState.dataset.kickChannel) : '';
    var questCta = function (quest, signedIn, member) {
      if (!signedIn) return '<a class="yr-btn yr-btn--sm" href="/me">Sign in to track</a>';
      if (!member) return '<span class="yr-act yr-act--off" role="note">Join to track</span>';
      if (quest.claimed) return '<span class="viewer-chip viewer-chip--done">Completed</span>';
      if (quest.completed) return '<button class="yr-btn yr-btn--sm" type="button" data-quest-claim="' + esc(quest.id) + '">Claim +' + fmt(quest.rewardPoints) + '</button>';
      return kickWatchHref ? '<a class="yr-btn yr-btn--sm" href="' + esc(kickWatchHref) + '" target="_blank" rel="noopener noreferrer">Continue →</a>' : '<span class="yr-act yr-act--off" role="note">In progress</span>';
    };
    var questRow = function (quest, signedIn, member) {
      var pct = Math.min(100, Math.max(0, Math.round((Number(quest.progress) || 0) / Math.max(1, Number(quest.targetCount) || 1) * 100)));
      return '<li class="viewer-quest' + (quest.claimed ? " is-claimed" : quest.completed ? " is-complete" : "") + '" data-quest-row="' + esc(quest.id) + '" data-quest-state="' + (quest.claimed ? "done" : "active") + '">' +
        '<span class="viewer-quest-ico">' + questIcon(quest.questKey) + '</span>' +
        '<span class="viewer-quest-main"><b class="viewer-quest-name">' + esc(quest.title) + '</b>' +
        '<span class="viewer-quest-meta">' + fmt(quest.progress) + ' / ' + fmt(quest.targetCount) + ' · +' + fmt(quest.rewardXp) + ' XP</span>' +
        '<span class="viewer-quest-bar"><span style="width:' + pct + '%"></span></span></span>' +
        '<span class="viewer-quest-reward">+' + fmt(quest.rewardPoints) + ' credits</span>' +
        '<span class="viewer-quest-cta">' + questCta(quest, signedIn, member) + '</span></li>';
    };
    var renderQuests = function (payload) {
      var signedIn = questsRoot.dataset.signedIn === "true";
      var member = questsRoot.dataset.member === "true";
      var quests = payload && payload.quests ? payload.quests : [];
      var streak = payload && payload.streak ? payload.streak : null;
      var activeChip = document.querySelector("[data-quest-active]");
      var streakChip = document.querySelector("[data-quest-streak]");
      var doneChip = document.querySelector("[data-quest-done]");
      var open = quests.filter(function (q) { return !q.claimed; });
      var done = quests.filter(function (q) { return q.claimed; });
      if (activeChip) { activeChip.hidden = !open.length; activeChip.querySelector("[data-quest-active-num]").textContent = fmt(open.length); }
      if (doneChip) { doneChip.hidden = !done.length; doneChip.querySelector("[data-quest-done-num]").textContent = fmt(done.length); }
      if (streakChip) {
        var days = streak ? Number(streak.currentStreak) || 0 : 0;
        streakChip.hidden = days < 1;
        streakChip.querySelector("[data-quest-streak-num]").textContent = fmt(days);
      }
      var featured = open.filter(function (q) { return q.completed; })[0] || open[0];
      var rest = open.filter(function (q) { return q !== featured; });
      var featuredPct = featured ? Math.min(100, Math.max(0, Math.round((Number(featured.progress) || 0) / Math.max(1, Number(featured.targetCount) || 1) * 100))) : 0;
      questsRoot.innerHTML =
        '<div class="viewer-tabs" role="tablist" aria-label="Quest filter">' +
          '<button class="viewer-tab is-on" type="button" role="tab" aria-selected="true" data-quest-tab="active">Active ' + fmt(open.length) + '</button>' +
          '<button class="viewer-tab" type="button" role="tab" aria-selected="false" data-quest-tab="all">All ' + fmt(quests.length) + '</button>' +
          '<button class="viewer-tab" type="button" role="tab" aria-selected="false" data-quest-tab="done">Completed ' + fmt(done.length) + '</button>' +
        '</div>' +
        (featured ? '<div class="viewer-quest-hero" data-quest-state="active">' +
          '<div class="viewer-quest-hero-art" aria-hidden="true">' + questIcon(featured.questKey) + '</div>' +
          '<div class="viewer-quest-hero-copy"><p class="viewer-quest-hero-tag">Featured challenge</p><h2 class="viewer-quest-hero-name">' + esc(featured.title) + '</h2>' +
          '<p class="viewer-quest-hero-meta">' + fmt(featured.progress) + ' / ' + fmt(featured.targetCount) + ' · +' + fmt(featured.rewardXp) + ' XP · ends today</p>' +
          '<div class="viewer-quest-hero-bar"><span style="width:' + featuredPct + '%"></span></div></div>' +
          '<div class="viewer-quest-hero-cta"><span class="viewer-quest-reward">+' + fmt(featured.rewardPoints) + ' credits</span>' + questCta(featured, signedIn, member) + '</div></div>' : "") +
        (rest.length ? '<h3 class="viewer-quest-section">Active now</h3><ul class="viewer-quest-list" role="list">' + rest.map(function (q) { return questRow(q, signedIn, member); }).join("") + '</ul>' : "") +
        (!featured && !rest.length ? '<p class="viewer-muted">No quests today yet — check back after midnight.</p>' : "") +
        (done.length ? '<h3 class="viewer-quest-section">Recently completed</h3><ul class="viewer-quest-list" role="list">' + done.map(function (q) { return questRow(q, signedIn, member); }).join("") + '</ul>' : "") +
        '<p class="yr-fine">Quests reset daily. Claimed credits land in your community balance.</p>';
      var tabs = questsRoot.querySelectorAll("[data-quest-tab]");
      tabs.forEach(function (tab) {
        tab.addEventListener("click", function () {
          tabs.forEach(function (t) { t.classList.toggle("is-on", t === tab); t.setAttribute("aria-selected", t === tab ? "true" : "false"); });
          var mode = tab.dataset.questTab;
          questsRoot.querySelectorAll("[data-quest-state]").forEach(function (row) {
            row.hidden = mode !== "all" && row.dataset.questState !== mode;
          });
          questsRoot.querySelectorAll(".viewer-quest-section").forEach(function (h) { h.hidden = mode === "all"; });
        });
      });
    };
    fetch("/api/quests/daily?site=" + encodeURIComponent(questsRoot.dataset.siteSlug || slug), { credentials: "same-origin", cache: "no-store", signal: pageLifetime.signal })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok || !result.data || result.data.ok === false) throw new Error(result.data && result.data.error || "load failed");
        if (pageLifetime.signal.aborted) return;
        renderQuests(result.data);
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") return;
        if (questsLoading) {
          questsLoading.innerHTML = '<p class="viewer-muted">Today’s quests could not load. Reload to try again.</p>';
        } else {
          questsRoot.innerHTML = '<p class="viewer-muted">Today’s quests could not load. Reload to try again.</p>';
        }
      });
    questsRoot.addEventListener("click", function (event) {
      var claimBtn = event.target.closest("[data-quest-claim]");
      if (!claimBtn) return;
      var label = claimBtn.textContent;
      claimBtn.disabled = true;
      claimBtn.textContent = "Claiming…";
      fetch("/api/quests/claim", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": readCsrfToken() },
        body: JSON.stringify({ questId: claimBtn.dataset.questClaim }),
      })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          if (result.ok && result.data.ok !== false) {
            if (typeof result.data.newBalance === "number") updateBalance(result.data.newBalance);
            var row = questsRoot.querySelector('[data-quest-row="' + claimBtn.dataset.questClaim + '"]');
            claimBtn.textContent = "Claimed";
            claimBtn.className = "viewer-chip viewer-chip--done";
            claimBtn.disabled = true;
            if (row) row.className = "viewer-quest is-claimed";
            return;
          }
          claimBtn.disabled = false;
          claimBtn.textContent = label;
        })
        .catch(function () {
          claimBtn.disabled = false;
          claimBtn.textContent = label;
        });
    });
  }
})();
