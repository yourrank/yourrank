// Public streamer site — shell behaviour.
// Progressive enhancement only: every section renders and is navigable with
// this file blocked. Handles the narrow-width menu drawer, the standings tabs and
// filter, the shop redeem call, the reset countdown and the feedback dialog.

(function initSitePage() {
  "use strict";
  // My Activity tabs. The URL hash is the single selection state: each tab is a
  // hash anchor to its panel, clicks and Back/Forward change the hash, and the
  // controller mirrors the current hash onto exactly one tab/panel. It reads the
  // tablist from the DOM at mount time and every listener is tied to the page
  // lifetime, so an SPA remount (new .viewer-main) always mounts a fresh
  // controller and the previous one is fully detached.
  function mountActivityTabs(signal) {
    var tablist = document.querySelector('.viewer-tabs[role="tablist"]');
    if (!tablist) return;
    var tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    if (!tabs.length) return;
    var panelOf = function (tab) { return document.getElementById(tab.getAttribute("aria-controls")); };
    var tabForHash = function () {
      var id = window.location.hash.slice(1);
      try { id = decodeURIComponent(id); } catch (_) { /* Use the literal anchor. */ }
      return tabs.find(function (tab) { return tab.getAttribute("aria-controls") === id; }) || tabs[0];
    };
    var sync = function () {
      var selected = tabForHash();
      tabs.forEach(function (tab) {
        var on = tab === selected;
        tab.setAttribute("aria-selected", on ? "true" : "false");
        tab.tabIndex = on ? 0 : -1;
        var panel = panelOf(tab);
        if (panel) panel.hidden = !on;
      });
    };
    sync();
    window.addEventListener("hashchange", sync, { signal: signal });
    tablist.addEventListener("keydown", function (event) {
      var index = tabs.indexOf(document.activeElement);
      if (index < 0) return;
      var next = null;
      if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
      else if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
      else if (event.key === "Home") next = tabs[0];
      else if (event.key === "End") next = tabs[tabs.length - 1];
      if (!next) return;
      event.preventDefault();
      next.focus();
      next.click();
    }, { signal: signal });
  }
  window.YRInitSitePage = initSitePage;
  var pageLifetime = new AbortController();
  var streamState = document.querySelector('[data-kick-channel]');
  if (streamState) {
    fetch('/api/giveaways/chatroom?channel=' + encodeURIComponent(streamState.dataset.kickChannel), { signal: pageLifetime.signal })
      .then(function (response) { if (!response.ok) throw new Error('Unavailable'); return response.json(); })
      .then(function (data) {
        if (typeof data.isLive !== 'boolean' || data.error || pageLifetime.signal.aborted) return;
        streamState.textContent = data.isLive ? 'Live now' : 'Offline';
        streamState.dataset.live = String(data.isLive);
        streamState.hidden = false;
      }).catch(function () { /* Keep the explicit unavailable state. */ });
  }
  document.addEventListener("yr:viewer-unmount", function () {
    pageLifetime.abort();
    clearTimeout(searchTimer);
    if (searchController) searchController.abort();
    clearInterval(countdownTimer);
    searchRequest++;
    pageRequest++;
    closeSide();
  }, { once: true });

  var rewardList = document.getElementById("viewer-rewards");
  if (rewardList) {
    var rewardSearch = document.getElementById("viewer-reward-search");
    var rewardSort = document.getElementById("viewer-reward-sort");
    var rewardRows = Array.from(rewardList.children);
    var rewardStatus = document.getElementById("viewer-reward-status");
    var rewardEmpty = document.getElementById("viewer-reward-empty");
    var rewardStatusTimer = null;
    var lastRewardStatus = "";
    document.querySelectorAll(".viewer-reward-tools").forEach(function (tools) { tools.hidden = false; });
    var rewardCount = function (count) {
      return count === 1 ? "1 reward" : count.toLocaleString("en-US") + " rewards";
    };
    // Only settled results reach the live region: typing waits for a pause,
    // and the same message is not re-announced. The no-results note is plain
    // text, so an empty query never produces two announcements.
    var announceRewards = function (message) {
      clearTimeout(rewardStatusTimer);
      rewardStatusTimer = window.setTimeout(function () {
        if (!rewardStatus || message === lastRewardStatus) return;
        lastRewardStatus = message;
        rewardStatus.textContent = message;
      }, 250);
    };
    var filterRewards = function () {
      var query = rewardSearch.value.trim().toLowerCase();
      var shown = 0;
      rewardRows.forEach(function (row) {
        row.hidden = !row.dataset.rewardFilter.includes(query);
        if (!row.hidden) shown += 1;
      });
      rewardEmpty.hidden = shown > 0;
      announceRewards(!query ? "" : shown ? rewardCount(shown) + " match \u201c" + query + "\u201d." : "No rewards match \u201c" + query + "\u201d.");
    };
    pageLifetime.signal.addEventListener("abort", function () { clearTimeout(rewardStatusTimer); }, { once: true });
    rewardSearch.addEventListener("input", filterRewards, { signal: pageLifetime.signal });
    rewardSort.addEventListener("change", function () {
      rewardRows.sort(function (a, b) {
        return rewardSort.value === "name" ? a.dataset.rewardFilter.localeCompare(b.dataset.rewardFilter) : Number(a.dataset.rewardSortCost) - Number(b.dataset.rewardSortCost);
      }).forEach(function (row) { rewardList.appendChild(row); });
      var visible = rewardRows.filter(function (row) { return !row.hidden; }).length;
      var sortLabel = rewardSort.options[rewardSort.selectedIndex].textContent.toLowerCase();
      announceRewards(rewardCount(visible) + " sorted by " + sortLabel + ".");
    }, { signal: pageLifetime.signal });
  }

  var communitySwitch = document.querySelector(".viewer-switch");
  if (communitySwitch) {
    document.addEventListener("click", function (event) {
      if (!communitySwitch.contains(event.target)) communitySwitch.open = false;
    }, { signal: pageLifetime.signal });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && communitySwitch.open) {
        communitySwitch.open = false;
        communitySwitch.querySelector("summary").focus();
      }
    }, { signal: pageLifetime.signal });
  }

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

  mountActivityTabs(pageLifetime.signal);

  // The classic site drawer and the viewer rail share one drawer contract.
  var side = document.getElementById("yr-side") || document.getElementById("viewer-rail");
  var scrim = document.getElementById("yr-scrim") || document.getElementById("viewer-scrim");
  var menu = document.getElementById("yr-menu") || document.getElementById("viewer-menu");
  var sideClose = document.getElementById("yr-side-close") || document.getElementById("viewer-rail-close");
  var menuLabels = side && side.classList.contains("viewer-rail") ? { open: "Open menu", close: "Close menu" } : { open: "Open sections", close: "Close sections" };
  // The drawer trigger is the one control on the page that cannot work without
  // this file, so the server ships it hidden and it is disclosed here. With the
  // script blocked the top bar has no dead control and the footer keeps every
  // section link; with the script running the drawer behaves exactly as before.
  if (menu && side) menu.hidden = false;
  if (sideClose && side) sideClose.hidden = false;
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
      menu.setAttribute("aria-label", menuLabels.open);
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
      menu.setAttribute("aria-label", menuLabels.close);
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
  var spotlight = document.body.classList.contains("viewer-shell");
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
    var identity = spotlight
      ? '<span class="yr-player-mark" aria-hidden="true">' + esc(Array.from(String(p.name || "?")).slice(0, 2).join("").toUpperCase()) + '</span><span class="yr-player-name">' + esc(p.name) + '</span>'
      : esc(p.name);
    return '<li class="yr-srow' + (rank === 1 ? " yr-srow--first" : rank <= 3 ? " yr-srow--top" : "") +
      '" data-player-name="' + name + '" data-position="' + rank + '">' +
      '<span class="yr-srow-rank"><span class="yr-sr">Rank </span>' + rank + "</span>" +
      (eventId ? '<span class="yr-srow-name">' + identity + '</span>' : '<a class="yr-srow-name" href="' + (isCustomDomain ? "/player/" : "/" + encodeURIComponent(slug) + "/player/") + encodeURIComponent(p.name || "") + '">' + identity + "</a>") +
      '<span class="yr-srow-val"><span class="yr-sr">' + esc(valueLabel) + ': </span>' + value + "</span>" +
      (prize ? '<span class="yr-srow-prize"><span class="yr-sr">' + esc(prizeLabel) + ': </span>' + prize + "</span>" : "") +
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
      if (playerBoard.hasAttribute("data-podium")) playerBoard.classList.toggle("is-searching", !!q);
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
      .then(async function (r) {
        if (r.ok && r.data.ok) {
          delete btn.dataset.redeemKey;
          btn.textContent = "Claimed";
          btn.removeAttribute("aria-busy");
          btn.classList.add("is-success");
          var message = "Claim submitted: “" + name + "”. " + cost + " free credits used. The creator will complete it.";
          setRedeemStatus(message);
          if (typeof r.data.balance === "number") updateBalance(r.data.balance);
          var overviewStatus = document.querySelector("[data-viewer-claim-summary]");
          if (overviewStatus) overviewStatus.textContent = "Claim submitted";
          // The button is spent, so the status region keeps focus on the page.
          focusWithoutScroll(redeemStatus || btn);
          if (window.YRViewerApp) {
            await window.YRViewerApp.refresh();
            if (document.body.dataset.slug !== slug) return;
            redeemStatus = document.getElementById("yr-redeem-status");
            setRedeemStatus(message);
            focusWithoutScroll(redeemStatus);
          }
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
      cd.textContent = d > 0 ? d + "d " + h + "h" : h > 0 ? h + "h " + m + "m" : m > 0 ? m + "m" : "Less than 1m";
      return true;
    };
    if (Number.isFinite(end) && tick()) {
      var countdownTimer = setInterval(function () { if (!tick()) clearInterval(countdownTimer); }, 30000);
    }
  }

  // ── Share block: native share sheet when available, else copy the URL ──
  document.querySelectorAll("[data-share-copy]").forEach(function (b) {
    var status = b.parentNode && b.parentNode.querySelector("[data-share-status]");
    var say = function (text) { if (status) status.textContent = text; };
    b.addEventListener("click", function () {
      var url = b.dataset.shareUrl || window.location.href;
      var title = b.dataset.shareTitle || document.title;
      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function () {});
        return;
      }
      if (!navigator.clipboard || !navigator.clipboard.writeText) { say("Copy this link: " + url); return; }
      navigator.clipboard.writeText(url).then(function () { say("Link copied"); }, function () { say("Copy this link: " + url); });
    });
  });

  // ── Claim support dialog ────────────────────────────────────────────
  // The viewer <-> creator thread for one claim. Messages load when the dialog
  // opens, after each send, when the tab becomes visible again and on a light
  // poll while it is open; everything is tied to the dialog and page lifetime.
  var supportDialog = document.getElementById("yr-claim-support");
  if (supportDialog && supportDialog.showModal) {
    var SUPPORT_POLL_MS = 15000;
    var supportClaimId = "";
    var supportOpener = null;
    var supportTimer = 0;
    var supportBusy = false;
    var supportNewForm = supportDialog.querySelector("[data-claim-support-new]");
    var supportThreadWrap = supportDialog.querySelector("[data-claim-support-thread-wrap]");
    var supportThread = supportDialog.querySelector("[data-claim-support-thread]");
    var supportReplyForm = supportDialog.querySelector("[data-claim-support-reply]");
    var supportResolvedNote = supportDialog.querySelector("[data-claim-support-resolved]");
    var supportResolvedActs = supportDialog.querySelector("[data-claim-support-resolved-acts]");
    var supportRewardEl = supportDialog.querySelector("[data-claim-support-reward]");
    var supportClaimStatusEl = supportDialog.querySelector("[data-claim-support-claim-status]");
    var supportStateEl = supportDialog.querySelector("[data-claim-support-state]");
    var setSupportStatus = function (message, isError) {
      supportDialog.querySelectorAll("[data-claim-support-status]").forEach(function (el) {
        el.textContent = message || "";
        el.classList.toggle("is-error", !!isError);
      });
    };
    var supportApi = function (method, path, body) {
      return fetch(path, {
        method: method,
        credentials: "same-origin",
        signal: AbortSignal.timeout(10000),
        headers: body ? { "content-type": "application/json", "x-csrf-token": readCsrfToken() } : { "x-csrf-token": readCsrfToken() },
        body: body ? JSON.stringify(body) : undefined,
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
      });
    };
    var supportPath = function (suffix) {
      return "/api/viewer/claims/" + encodeURIComponent(supportClaimId) + "/support" + (suffix || "");
    };
    var formatWhen = function (iso) {
      var d = new Date(iso);
      return isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    };
    var renderSupport = function (support) {
      var hasThread = !!support;
      if (supportNewForm) supportNewForm.hidden = hasThread;
      if (supportThreadWrap) supportThreadWrap.hidden = !hasThread;
      if (!hasThread) {
        if (supportStateEl) supportStateEl.textContent = "";
        return;
      }
      var open = support.status === "open";
      if (supportStateEl) supportStateEl.textContent = "Support: " + (open ? "Open" : "Resolved") + " · " + (support.issueLabel || "Other");
      if (supportThread) {
        supportThread.innerHTML = "";
        (support.messages || []).forEach(function (m) {
          var li = document.createElement("li");
          li.className = m.senderType === "viewer" ? "is-viewer" : "is-creator";
          var who = document.createElement("strong");
          who.textContent = m.senderType === "viewer" ? "You" : (m.senderName || "Creator");
          var text = document.createElement("p");
          text.textContent = m.message || "";
          var when = document.createElement("time");
          when.dateTime = m.createdAt || "";
          when.textContent = formatWhen(m.createdAt);
          li.appendChild(who); li.appendChild(text); li.appendChild(when);
          supportThread.appendChild(li);
        });
        supportThread.scrollTop = supportThread.scrollHeight;
      }
      if (supportReplyForm) supportReplyForm.hidden = !open;
      if (supportResolvedNote) supportResolvedNote.hidden = open;
      if (supportResolvedActs) supportResolvedActs.hidden = open;
      document.querySelectorAll('[data-claim-id="' + supportClaimId.replace(/"/g, "") + '"]').forEach(function (row) {
        var trigger = row.querySelector("[data-claim-support]");
        if (trigger) trigger.textContent = "View support conversation";
        var tags = row.querySelector(".yr-ord-tags");
        if (tags) {
          var tag = tags.querySelector("[data-support-tag]");
          if (!tag) { tag = document.createElement("span"); tag.setAttribute("data-support-tag", ""); tags.appendChild(tag); }
          tag.className = "yr-tag" + (open ? " yr-tag--pending" : "");
          tag.textContent = open ? "Support open" : "Support resolved";
        }
      });
      if (open) startSupportPolling(); else stopSupportPolling();
    };
    var loadSupport = function (silent) {
      if (!supportClaimId || !supportDialog.open) return Promise.resolve();
      var id = supportClaimId;
      return supportApi("GET", supportPath()).then(function (r) {
        if (id !== supportClaimId || !supportDialog.open) return;
        if (r.ok && r.data.ok) {
          if (r.data.claim && supportClaimStatusEl) supportClaimStatusEl.textContent = "Claim status: " + (r.data.claim.statusLabel || "");
          renderSupport(r.data.support);
        } else if (!silent) {
          setSupportStatus(r.data.error || "Couldn't load this conversation.", true);
        }
      }).catch(function () {
        if (!silent && id === supportClaimId) setSupportStatus("Couldn't load this conversation. Check your connection.", true);
      });
    };
    var onSupportVisibility = function () {
      if (document.visibilityState === "visible") loadSupport(true);
    };
    var stopSupportPolling = function () {
      if (supportTimer) clearInterval(supportTimer);
      supportTimer = 0;
      document.removeEventListener("visibilitychange", onSupportVisibility);
    };
    var startSupportPolling = function () {
      if (supportTimer) return;
      supportTimer = window.setInterval(function () {
        if (document.visibilityState === "visible" && !supportBusy) loadSupport(true);
      }, SUPPORT_POLL_MS);
      document.addEventListener("visibilitychange", onSupportVisibility);
    };
    pageLifetime.signal.addEventListener("abort", function () {
      stopSupportPolling();
      if (supportDialog.open) supportDialog.close();
    }, { once: true });

    document.querySelectorAll("[data-claim-support]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        supportOpener = btn;
        supportClaimId = btn.dataset.claimSupport || "";
        if (supportRewardEl) supportRewardEl.textContent = btn.dataset.claimName || "Reward claim";
        if (supportClaimStatusEl) supportClaimStatusEl.textContent = "Claim status: " + (btn.dataset.claimStatus || "");
        if (supportStateEl) supportStateEl.textContent = "";
        setSupportStatus("Loading…");
        if (supportNewForm) supportNewForm.hidden = true;
        if (supportThreadWrap) supportThreadWrap.hidden = true;
        closeSide();
        supportDialog.showModal();
        loadSupport(false).then(function () {
          if (!supportDialog.open) return;
          setSupportStatus("");
          var focusTarget = supportNewForm && !supportNewForm.hidden
            ? supportNewForm.querySelector('input[name="issueType"]')
            : supportReplyForm && !supportReplyForm.hidden ? supportReplyForm.querySelector("textarea") : supportDialog.querySelector("[data-claim-support-close]");
          if (focusTarget) window.setTimeout(function () { focusTarget.focus(); }, 0);
        });
      }, { signal: pageLifetime.signal });
    });
    supportDialog.querySelectorAll("[data-claim-support-close]").forEach(function (b) {
      b.addEventListener("click", function () { supportDialog.close(); });
    });
    supportDialog.addEventListener("close", function () {
      stopSupportPolling();
      supportClaimId = "";
      var opener = supportOpener;
      supportOpener = null;
      if (opener && typeof opener.focus === "function") opener.focus();
    });
    var sendSupport = function (form, path, body, sentLabel) {
      var btn = form.querySelector('button[type="submit"]');
      if (supportBusy || !btn) return;
      var textarea = form.querySelector("textarea");
      var label = btn.textContent;
      supportBusy = true;
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      btn.textContent = "Sending…";
      var id = supportClaimId;
      supportApi("POST", path, body).then(function (r) {
        if (id !== supportClaimId) return;
        if ((r.ok || r.status === 409) && r.data.support) {
          if (textarea && r.ok) textarea.value = "";
          renderSupport(r.data.support);
          setSupportStatus(r.ok ? sentLabel : (r.data.error || "This request already has an open conversation."), !r.ok);
          var replyBox = supportReplyForm && !supportReplyForm.hidden ? supportReplyForm.querySelector("textarea") : null;
          if (replyBox) replyBox.focus();
        } else {
          setSupportStatus(r.data.error || "Couldn't send your message. Try again.", true);
          if (r.status === 409) loadSupport(true);
        }
      }).catch(function () {
        setSupportStatus("Couldn't confirm delivery. Your message is still here; check your connection and try again.", true);
      }).then(function () {
        supportBusy = false;
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
        btn.textContent = label;
      });
    };
    if (supportNewForm) {
      supportNewForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var issue = supportNewForm.querySelector('input[name="issueType"]:checked');
        var message = supportNewForm.message.value.trim();
        if (!issue) { setSupportStatus("Choose what the issue is.", true); return; }
        if (!message) { setSupportStatus("Tell the creator what happened.", true); supportNewForm.message.focus(); return; }
        sendSupport(supportNewForm, supportPath(), { issueType: issue.value, message: message }, "Sent to the creator. Replies will show up here.");
      });
    }
    if (supportReplyForm) {
      supportReplyForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var message = supportReplyForm.message.value.trim();
        if (!message) { setSupportStatus("Write a reply first.", true); supportReplyForm.message.focus(); return; }
        sendSupport(supportReplyForm, supportPath("/messages"), { message: message }, "Reply sent.");
      });
    }
  }

  // ── Feedback dialog ─────────────────────────────────────────────────
  var dialog = document.getElementById("yr-feedback");
  var statusEl = document.getElementById("yr-feedback-status");
  var feedbackOpener = null;
  var feedbackMessage = dialog && dialog.querySelector('textarea[name="message"]');
  var feedbackCount = document.getElementById("yr-feedback-count");
  var updateFeedbackCount = function () {
    if (!feedbackCount || !feedbackMessage) return;
    var max = Number(feedbackMessage.getAttribute("maxlength")) || 2000;
    feedbackCount.textContent = feedbackMessage.value.trim().length + " / " + max;
  };
  if (feedbackMessage) { feedbackMessage.addEventListener("input", updateFeedbackCount); updateFeedbackCount(); }
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
        if (statusEl) statusEl.textContent = "Please write at least 10 characters (spaces at the start or end do not count).";
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
            if (statusEl) statusEl.textContent = "Your feedback was sent to this community's creator.";
            if (form.message.value.trim() === message) { form.message.value = ""; updateFeedbackCount(); }
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
})();
