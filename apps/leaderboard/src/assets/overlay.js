/* OBS Overlay: live polling + smooth rank transitions for stream overlays. */
(function () {
  "use strict";

  // Read config from data attributes (CSP-safe) or window globals (legacy).
  const _cfg = document.getElementById("ov-config");
  const SLUG = _cfg?.dataset?.slug ?? window.__OVERLAY_SLUG__;
  const TOP_N = 5;
  const TRANSITION_MS = 600;

  // Theme support (Phase 7.3)
  const THEME = _cfg?.dataset?.theme ?? "default";
  const SPONSOR_TEXT = _cfg?.dataset?.sponsor ?? "";
  const SPONSOR_URL = _cfg?.dataset?.sponsorUrl ?? "";
  let rankBy = "score";

  // --- Format helpers ---
  function fmtMoney(n) {
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(2).replace(/\.0+$/, "") + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    return "$" + (n || 0).toLocaleString("en-US");
  }

  function fmtCountdown(iso) {
    if (!iso) return null;
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return { d: 0, h: 0, m: 0, s: 0, over: true };
    const d = Math.floor(diff / 864e5);
    const h = Math.floor((diff % 864e5) / 36e5);
    const m = Math.floor((diff % 36e5) / 6e4);
    const s = Math.floor((diff % 6e4) / 1e3);
    return { d, h, m, s, over: false };
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  // --- Timer tick ---
  let endsAt = null;
  function tickTimer() {
    const grid = document.querySelector("[data-ov-timer]");
    if (!grid || !endsAt) return;
    const t = fmtCountdown(endsAt);
    if (!t || t.over) {
      grid.innerHTML = '<span class="ov-timer-over">Period ended</span>';
      return;
    }
    const cells = grid.querySelectorAll("[data-ot]");
    if (cells.length >= 4) {
      cells[0].textContent = pad(t.d);
      cells[1].textContent = pad(t.h);
      cells[2].textContent = pad(t.m);
      cells[3].textContent = pad(t.s);
    }
  }

  // Sponsor banner (Phase 7.3)
  function renderSponsor() {
    const el = document.querySelector("[data-ov-sponsor]");
    if (!el) return;
    if (!SPONSOR_TEXT) { el.classList.remove("is-visible"); return; }
    el.classList.add("is-visible");
    if (SPONSOR_URL) {
      el.innerHTML = `<a href="${SPONSOR_URL}" target="_blank" rel="noopener">${SPONSOR_TEXT}</a>`;
    } else {
      el.textContent = SPONSOR_TEXT;
    }
  }

  // --- Render top N players with FLIP animation ---
  let prevRanks = {};
  let prevWagers = {};

  function renderPlayers(players) {
    const sorted = players.slice().sort((a, b) => Number(b[rankBy] || 0) - Number(a[rankBy] || 0)).slice(0, TOP_N);
    const container = document.getElementById("ov-players");
    if (!container) return;

    // Record old positions (FLIP: First)
    const oldPositions = {};
    container.querySelectorAll(".ov-row").forEach((el) => {
      const name = el.dataset.name;
      const rect = el.getBoundingClientRect();
      oldPositions[name] = rect.top;
    });

    // Build new HTML
    const html = sorted.map((p, i) => {
      const rank = i + 1;
      const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "#" + rank;
      const isNew = !prevRanks[p.name];
      const metricValue = Number(p[rankBy] || 0);
      const scoreChanged = prevWagers[p.name] !== undefined && prevWagers[p.name] !== metricValue;
      const movedUp = prevRanks[p.name] && prevRanks[p.name] > rank;
      const movedDown = prevRanks[p.name] && prevRanks[p.name] < rank;
      const dirClass = movedUp ? "ov-moved-up" : movedDown ? "ov-moved-down" : "";
      const flashClass = scoreChanged ? "ov-score-flash" : "";
      const entryClass = isNew ? "ov-enter" : "";
      return `<div class="ov-row ${dirClass} ${flashClass} ${entryClass}" data-name="${esc(p.name)}">
        <span class="ov-medal">${medal}</span>
        <span class="ov-name">${esc(p.name)}</span>
        <span class="ov-wager">${rankBy === "score" ? metricValue.toLocaleString("en-US") + " pts" : fmtMoney(metricValue)}</span>
      </div>`;
    }).join("");

    // Fill empty slots if fewer than TOP_N
    const empty = TOP_N - sorted.length;
    const emptyHtml = empty > 0
      ? Array.from({ length: empty }, (_, i) =>
        `<div class="ov-row ov-empty"><span class="ov-medal">#${sorted.length + i + 1}</span><span class="ov-name">—</span><span class="ov-wager">—</span></div>`
      ).join("")
      : "";

    container.innerHTML = html + emptyHtml;

    // FLIP: Last + Invert + Play
    container.querySelectorAll(".ov-row").forEach((el) => {
      const name = el.dataset.name;
      if (oldPositions[name] !== undefined) {
        const newRect = el.getBoundingClientRect();
        const dy = oldPositions[name] - newRect.top;
        if (Math.abs(dy) > 1) {
          el.style.transition = "none";
          el.style.transform = `translateY(${dy}px)`;
          requestAnimationFrame(() => {
            el.style.transition = `transform ${TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${TRANSITION_MS}ms ease`;
            el.style.transform = "translateY(0)";
          });
        }
      }
    });

    // Track previous ranks and the active score/legacy metric.
    prevRanks = {};
    prevWagers = {};
    sorted.forEach((p, i) => {
      prevRanks[p.name] = i + 1;
      prevWagers[p.name] = Number(p[rankBy] || 0);
    });

    // Update count
    const countEl = document.getElementById("ov-count");
    if (countEl) countEl.textContent = players.length;
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // --- SSE live updates ---
  let streamFailures = 0;
  let streamTimer = null;
  const STREAM_RECONNECT_BASE_MS = 1000;
  const STREAM_RECONNECT_MAX_MS = 30000;

  let streamEs = null;
  function onStreamFail() {
    streamFailures++;
    if (document.hidden) return;
    const backoff = Math.min(
      STREAM_RECONNECT_MAX_MS,
      STREAM_RECONNECT_BASE_MS * (2 ** (streamFailures - 1))
    );
    const delay = backoff * (0.8 + Math.random() * 0.4);
    if (streamTimer) clearTimeout(streamTimer);
    streamTimer = setTimeout(() => {
      streamTimer = null;
      connectStream();
    }, delay);
  }

  function connectStream() {
    if (!SLUG || typeof EventSource === "undefined") return;
    if (streamTimer) { clearTimeout(streamTimer); streamTimer = null; }
    if (streamEs) { streamEs.close(); streamEs = null; }
    streamEs = new EventSource("/api/public/" + encodeURIComponent(SLUG) + "/stream");
    streamEs.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.players) { streamFailures = 0; renderPlayers(data.players); }
      } catch {
        if (streamEs) { streamEs.close(); streamEs = null; }
        onStreamFail();
      }
    };
    streamEs.onerror = () => {
      if (streamEs) { streamEs.close(); streamEs = null; }
      onStreamFail();
    };
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (streamTimer) { clearTimeout(streamTimer); streamTimer = null; }
      if (streamEs) { streamEs.close(); streamEs = null; }
    } else {
      streamFailures = 0;
      connectStream();
    }
  });

  // --- Init ---
  function init() {
    // Apply theme class
    if (THEME && THEME !== "default") {
      document.body.classList.add("ov-theme-" + THEME);
    }
    renderSponsor();
    // Initial render from SSR data
    let ssr = window.__OVERLAY_DATA__;
    if (!ssr && _cfg?.dataset?.json) { try { ssr = JSON.parse(_cfg.dataset.json); } catch { /* JSON parse */ } }
    if (ssr) {
      endsAt = ssr.endsAt || null;
      rankBy = ssr.rankBy === "wagered" ? "wagered" : "score";
      renderPlayers(ssr.players || []);
    }

    // Timer tick every second
    tickTimer();
    setInterval(tickTimer, 1000);

    // Connect to SSE for live updates
    connectStream();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
