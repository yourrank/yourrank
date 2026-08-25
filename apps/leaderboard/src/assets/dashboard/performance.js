import { $, esc, logError, showLoadError, clearLoadError } from "./utils.js";
import { setState, state } from "./state.js";
import { renderEmpty, renderError, setMetricEmpty, setMetricLoading, setMetricValue, setRowsLoading } from "./states.js";
import { chromeStateFor, defaultTab, parseDashboardPath, SECTIONS } from "./routes.js";
import { registerRouteRenderer, requestDashboardRoute } from "./shell.js";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function initPerformance() {
  if (initPerformance._done) return;
  initPerformance._done = true;
  // The shell's navigation entry point owns the URL and history for tab
  // switches; this section only repaints its panels for the routed tab.
  registerRouteRenderer("performance", ({ tab }) => showTab(tab));
  wireRangeFilter();
  wireTabs();
  renderEmpty($("eventsEmpty"), {
    icon: "chart",
    title: "No activity yet",
    body: "Visits, link clicks, and shares will appear here after people use your site.",
    compact: true,
  });
}

function wireRangeFilter() {
  const filter = $("perfRangeFilter");
  if (!filter || filter._wired) return;
  filter._wired = true;
  filter.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-range]");
    if (!btn) return;
    filter.querySelectorAll("button[data-range]").forEach((node) => node.classList.toggle("is-active", node === btn));
    state.PERF_RANGE = Number(btn.dataset.range);
    if (state.STATS) renderPerformance(state.STATS);
  });
}

function wireTabs() {
  const page = document.querySelector('section[data-page="performance"]');
  if (!page || page._tabsWired) return;
  page._tabsWired = true;
  page.querySelectorAll("[data-perf-tab]").forEach((tab) => tab.addEventListener("click", (event) => {
    event.preventDefault();
    requestDashboardRoute("performance", tab.dataset.perfTab);
  }));
  const route = parseDashboardPath(location.pathname);
  showTab(route?.page === "performance" ? route.tab || defaultTab("performance") : defaultTab("performance"));
}

function showTab(tab) {
  const active = SECTIONS.performance.tabs.includes(tab) ? tab : defaultTab("performance");
  document.querySelectorAll("[data-perf-tab]").forEach((node) => {
    const selected = node.dataset.perfTab === active;
    node.classList.toggle("is-on", selected);
    if (selected) node.setAttribute("aria-current", "page");
    else node.removeAttribute("aria-current");
  });
  const panels = { activity: ["perf-activity", "perf-heatmap"], referrals: ["perf-referrals", "perf-referrers"], events: ["perf-events"] };
  Object.entries(panels).forEach(([name, ids]) => ids.forEach((id) => { const node = $(id); if (node) node.hidden = name !== active; }));
  const summary = document.querySelector("[data-perf-summary]");
  if (summary) summary.hidden = active !== "activity";
  const selectedRange = $("perfSelectedRange");
  const sourcesRange = $("perfSourcesRange");
  if (selectedRange) selectedRange.hidden = active === "referrals";
  if (sourcesRange) sourcesRange.hidden = active !== "referrals";
  const rangeFilter = $("perfRangeFilter");
  if (rangeFilter) rangeFilter.hidden = active === "referrals" || rangeFilter.dataset.hasData === "0";
  const crumb = document.querySelector('.v3-crumbs span[aria-current="page"]');
  if (crumb) crumb.textContent = chromeStateFor("performance", active).tabLabel;
}

export function renderPerformance(stats) {
  state.STATS = stats;
  if (!document.querySelector('section[data-page="performance"].is-on')) return;
  const range = state.PERF_RANGE || 14;
  const all = Array.isArray(stats.days) ? stats.days : [];
  const days = all.slice(-range);
  const hasData = days.some((day) => Number(day.views));
  const hasAnyData = all.some((day) => Number(day.views) || Number(day.clicks) || Number(day.copies));
  const rangeFilter = $("perfRangeFilter");
  if (rangeFilter) {
    rangeFilter.dataset.hasData = hasAnyData ? "1" : "0";
    rangeFilter.hidden = !hasAnyData || activePerformanceTab() === "referrals";
  }
  if ($("perfExport")) $("perfExport").hidden = !hasAnyData;
  const previous = all.slice(Math.max(0, all.length - range * 2), Math.max(0, all.length - range));
  const currentTotals = totals(days);
  const previousTotals = totals(previous);
  if (hasData) {
    setKpi("perfKpiViews", currentTotals.views, percentDelta(currentTotals.views, previousTotals.views));
    setKpi("perfKpiClicks", currentTotals.clicks, percentDelta(currentTotals.clicks, previousTotals.clicks));
    setKpi("perfKpiCopies", currentTotals.copies, percentDelta(currentTotals.copies, previousTotals.copies));
    const ctr = currentTotals.views ? currentTotals.clicks / currentTotals.views * 100 : 0;
    const priorCtr = previousTotals.views ? previousTotals.clicks / previousTotals.views * 100 : 0;
    setKpi("perfKpiCtr", `${ctr.toFixed(1)}%`, previousTotals.views ? `${(ctr - priorCtr).toFixed(1)} pp vs previous` : "");
  } else {
    // The stats request succeeded and the period genuinely has no traffic:
    // show the real zeros instead of an "unavailable" placeholder.
    ["perfKpiViews", "perfKpiClicks", "perfKpiCopies", "perfTotalViews"].forEach((id) => setMetricEmpty($(id)));
    setMetricEmpty($("perfKpiCtr"), { value: "0.0%" });
    ["perfKpiViewsDelta", "perfKpiClicksDelta", "perfKpiCopiesDelta", "perfKpiCtrDelta"].forEach((id) => { const el = $(id); if (el) el.textContent = ""; });
  }
  const rangeLabel = $("perfRangeLabel");
  if (rangeLabel) rangeLabel.textContent = String(range);
  const board = $("perfBoardName");
  if (board) board.textContent = state.SLUG || "Active site";
  renderChart(days, hasAnyData);
  renderActivity(days, hasAnyData);
  renderEvents(days, hasAnyData);
  loadHeatmap();
}

function totals(days) {
  return days.reduce((acc, day) => {
    acc.views += Number(day.views) || 0;
    acc.clicks += Number(day.clicks) || 0;
    acc.copies += Number(day.copies) || 0;
    return acc;
  }, { views: 0, clicks: 0, copies: 0 });
}

function percentDelta(current, previous) {
  return previous ? `${(((current - previous) / previous) * 100).toFixed(1)}% vs previous` : "";
}

function setKpi(id, value, change) {
  const valueNode = $(id);
  if (valueNode) valueNode.textContent = value >= 10000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k` : id === "perfKpiCtr" ? value : String(value);
  const deltaNode = $(`${id}Delta`);
  if (deltaNode) {
    deltaNode.textContent = change;
    deltaNode.classList.toggle("is-down", change.startsWith("-"));
  }
}

function activePerformanceTab() {
  return document.querySelector("[data-perf-tab].is-on")?.dataset.perfTab || defaultTab("performance");
}

function formatDay(value) {
  if (!value) return "";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function renderChart(days, hasAnyData = false) {
  const host = $("statBars");
  if (!host) return;
  const total = $("perfTotalViews");
  const hasData = days.some((day) => Number(day.views) || Number(day.clicks) || Number(day.copies));
  const empty = $("statsEmpty");
  if (!hasData) {
    host.innerHTML = "";
    host.hidden = true;
    renderEmpty(empty, {
      kind: "empty",
      title: hasAnyData ? "No visits in this range" : "No visits yet",
      body: hasAnyData ? "Try a wider date range to see earlier visits." : "Share your site link to start recording visits.",
      compact: true,
    });
    return;
  }
  host.hidden = false;
  const width = 720;
  const height = 220;
  const values = days.map((day) => Number(day.views) || 0);
  const max = Math.max(1, ...values);
  // 10% headroom: without it the peak (or a flat non-zero run) pins to the
  // top edge and reads as a spike.
  const scaleMax = max * 1.1;
  const xFor = (index) => (index / Math.max(1, values.length - 1)) * width;
  const yFor = (value) => height - 25 - (value / scaleMax) * 170;
  const points = values.map((value, index) => `${xFor(index)},${yFor(value)}`).join(" ");
  const labels = days.map((day, index) => {
    if (!day.day || index % Math.max(1, Math.ceil(days.length / 7))) return "";
    return `<text x="${xFor(index)}" y="214" text-anchor="${index === 0 ? "start" : "middle"}">${esc(formatDay(day.day))}</text>`;
  }).join("");
  const yAxis = `<g class="v3-chart-axis" aria-hidden="true"><text x="0" y="24">${max}</text><text x="0" y="190">0</text></g>`;
  const dots = days.map((day, index) => {
    const v = Number(day.views) || 0;
    return `<circle cx="${xFor(index)}" cy="${yFor(v)}" r="12" fill="transparent"><title>${day.day || ""}: ${v} views</title></circle>`;
  }).join("");
  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily site visits over time"><g class="v3-chart-grid">${[20, 75, 130, 185].map((y) => `<line x1="0" x2="${width}" y1="${y}" y2="${y}"/>`).join("")}</g>${yAxis}<polyline points="${points}" fill="none"/>${dots}${labels}</svg>`;
  if (total) setMetricValue(total, String(values.reduce((sum, value) => sum + value, 0)));
  clearLoadError($("statsEmpty"), false);
}

function renderActivity(days, hasAnyData = false) {
  const body = $("perfActivityBody");
  if (!body) return;
  const hasData = days.some((day) => Number(day.views) || Number(day.clicks) || Number(day.copies));
  const table = body.closest("table");
  const empty = $("perfActivityEmpty");
  if (!hasData) {
    body.innerHTML = "";
    if (table) table.hidden = true;
    renderEmpty(empty, {
      kind: "empty",
      title: hasAnyData ? "No daily visits in this range" : "No daily visits yet",
      body: hasAnyData ? "Try a wider date range to see your site's history." : "This table will fill in after people visit your site.",
      compact: true,
    });
    return;
  }
  if (table) table.hidden = false;
  clearLoadError(empty, false);
  body.removeAttribute("aria-busy");
  body.innerHTML = [...days].reverse().map((day) => {
    const views = Number(day.views) || 0;
    const clicks = Number(day.clicks) || 0;
    return `<tr><td data-label="Date" title="${esc(day.day || "")}">${esc(formatDay(day.day))}</td><td data-label="Visits" class="num">${views}</td><td data-label="Link clicks" class="num">${clicks}</td><td data-label="Link shares" class="num">${Number(day.copies) || 0}</td><td data-label="Click rate" class="num">${views ? (clicks / views * 100).toFixed(1) : "0.0"}%</td></tr>`;
  }).join("");
}

function renderEvents(days, hasAnyData = false) {
  const list = $("eventsList");
  const empty = $("eventsEmpty");
  if (!list || !empty) return;
  const counts = totals(days);
  const events = [
    { label: "Viewed your site", detail: "Opened your public YourRank site", count: counts.views },
    { label: "Clicked a link", detail: "Clicked a sponsor or share link", count: counts.clicks },
    { label: "Shared your site", detail: "Copied your site link to share it", count: counts.copies },
  ].filter((event) => event.count > 0);
  list.removeAttribute("aria-busy");
  if (!events.length) {
    list.innerHTML = "";
    list.hidden = true;
    clearLoadError(empty, false);
    renderEmpty(empty, {
      kind: "empty",
      title: hasAnyData ? "No actions in this range" : "No activity yet",
      body: hasAnyData ? "Try a wider date range to see earlier activity." : "Visits, link clicks, and shares will appear here after people use your site.",
      compact: true,
    });
    return;
  }
  list.hidden = false;
  clearLoadError(empty, false);
  list.innerHTML = events.map((event) => `<li><div><strong>${event.label}</strong><span>${event.detail}</span></div><b>${event.count}</b></li>`).join("");
}

async function loadHeatmap() {
  const wrap = $("perf-heatmap");
  if (!wrap || wrap._loading) return;
  wrap._loading = true;
  setState({ HEATMAP_STATUS: "loading" });
  const grid = $("perfHeatmapGrid");
  if (grid) {
    grid.setAttribute("aria-busy", "true");
    grid.innerHTML = '<span class="skeleton v3-skel-heatmap" aria-hidden="true"></span>';
  }
  try {
    const query = state.ACTIVE_SITE_ID ? `?siteId=${encodeURIComponent(state.ACTIVE_SITE_ID)}` : "";
    const response = await fetch(`/api/site/stats/heatmap${query}`);
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "heatmap failed");
    renderHeatmap(body.heatmap || []);
    renderReferrers(body.referrers || []);
    setState({ HEATMAP_STATUS: "ready" });
  } catch (error) {
    setState({ HEATMAP_STATUS: "error" });
    logError("load-heatmap", error);
    const grid = $("perfHeatmapGrid");
    if (grid) {
      grid.removeAttribute("aria-busy");
      renderError(grid, { title: "Couldn't load your activity map.", retry: loadHeatmap });
    }
    showLoadError($("perfReferrersEmpty"), "your traffic sources", loadHeatmap);
  } finally {
    wrap._loading = false;
  }
}

function renderHeatmap(matrix) {
  const grid = $("perfHeatmapGrid");
  if (!grid) return;
  const values = matrix.flat().map((value) => Number(value) || 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    renderEmpty(grid, { kind: "empty", title: "No hourly activity yet", body: "Views by day and hour will appear after your site gets traffic.", compact: true });
    return;
  }
  let html = `<div class="heatmap-corner"></div>`;
  for (let hour = 0; hour < 24; hour++) html += hour % 3 === 0 ? `<div class="heatmap-hlabel">${hour}</div>` : "<div></div>";
  for (let day = 0; day < 7; day++) {
    html += `<div class="heatmap-dlabel">${DOW[day]}</div>`;
    for (let hour = 0; hour < 24; hour++) html += `<div class="heatmap-cell" title="${DOW[day]} ${hour}:00 UTC — ${Number(matrix[day]?.[hour]) || 0} views"></div>`;
  }
  grid.innerHTML = html;
  grid.removeAttribute("aria-busy");
}

function renderReferrers(referrers) {
  const body = $("perfReferrersBody");
  if (!body) return;
  const table = body.closest("table");
  body.removeAttribute("aria-busy");
  body.innerHTML = referrers.map((row) => {
    const source = row.domain || "Direct";
    return `<tr><td data-label="Source"><span class="v3-source-name" title="${esc(source)}">${esc(source)}</span></td><td data-label="Visits" class="num">${Number(row.count) || 0}</td></tr>`;
  }).join("");
  if (referrers.length) {
    clearLoadError($("perfReferrersEmpty"), false);
    if (table) table.hidden = false;
  } else {
    const empty = $("perfReferrersEmpty");
    clearLoadError(empty, false);
    if (table) table.hidden = true;
    renderEmpty(empty, { kind: "empty", title: "No traffic sources yet", body: "Sources will appear after visitors arrive from a shared link.", compact: true });
  }
}

export function renderPerformanceLoading() {
  ["perfKpiViews", "perfKpiClicks", "perfKpiCopies", "perfKpiCtr", "perfTotalViews"].forEach((id) => setMetricLoading($(id)));
  setRowsLoading($("perfActivityBody"), { cols: 5, rows: 4 });
  const events = $("eventsList");
  if (events) {
    events.hidden = false;
    events.setAttribute("aria-busy", "true");
    events.innerHTML = Array.from({ length: 3 }, () => '<li><span class="skeleton v3-skel-line" aria-hidden="true"></span></li>').join("");
  }
}
