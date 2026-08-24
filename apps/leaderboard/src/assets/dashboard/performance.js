import { $, esc, logError, showLoadError, clearLoadError } from "./utils.js";
import { setState, state } from "./state.js";
import { renderEmpty, renderError, setMetricEmpty, setMetricLoading, setMetricValue, setRowsLoading } from "./states.js";
import { chromeStateFor } from "./routes.js";
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
    icon: "link",
    title: "No events yet",
    body: "Score updates and link shares will appear here after your site records its first event.",
    compact: true,
    actions: [{ label: "Set up score updates", href: "/dashboard/settings/connections", accent: true }],
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
  showTab((location.pathname.match(/\/analytics\/([^/]+)/) || [])[1] || "activity");
}

function showTab(tab) {
  const active = ["activity", "referrals", "events"].includes(tab) ? tab : "activity";
  document.querySelectorAll("[data-perf-tab]").forEach((node) => {
    const selected = node.dataset.perfTab === active;
    node.classList.toggle("is-on", selected);
    if (selected) node.setAttribute("aria-current", "page");
    else node.removeAttribute("aria-current");
  });
  const panels = { activity: ["perf-activity", "perf-heatmap"], referrals: ["perf-referrals", "perf-referrers"], events: ["perf-events"] };
  Object.entries(panels).forEach(([name, ids]) => ids.forEach((id) => { const node = $(id); if (node) node.hidden = name !== active; }));
  const crumb = document.querySelector('.v3-crumbs span[aria-current="page"]');
  if (crumb) crumb.textContent = chromeStateFor("performance", active).tabLabel;
}

export function renderPerformance(stats) {
  state.STATS = stats;
  if (!document.querySelector('section[data-page="performance"].is-on')) return;
  const range = state.PERF_RANGE || 14;
  const all = Array.isArray(stats.days) ? stats.days : [];
  const days = all.slice(-range);
  const hasData = days.some((day) => Number(day.views) || Number(day.clicks) || Number(day.copies));
  const hasAnyData = all.some((day) => Number(day.views) || Number(day.clicks) || Number(day.copies));
  if ($("perfRangeFilter")) $("perfRangeFilter").hidden = !hasAnyData;
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
    setKpi("perfKpiCtr", `${ctr.toFixed(1)}%`, previousTotals.views ? `${(ctr - priorCtr).toFixed(1)} pp` : "");
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
  return previous ? `${(((current - previous) / previous) * 100).toFixed(1)}%` : "";
}

function setKpi(id, value, change) {
  const valueNode = $(id);
  if (valueNode) valueNode.textContent = value >= 10000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k` : id === "perfKpiCtr" ? value : String(value);
  const deltaNode = $(`${id}Delta`);
  if (deltaNode) {
    deltaNode.textContent = change;
    deltaNode.classList.toggle("v3-delta--down", change.startsWith("-"));
  }
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
      title: hasAnyData ? "No visitor activity in this range" : "No visitor activity yet",
      body: hasAnyData ? "Try a wider date range to see your site's history." : "Share your site link to start recording visits.",
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
    return `<text x="${xFor(index)}" y="214">${day.day.slice(5)}</text>`;
  }).join("");
  const yAxis = `<g class="v3-chart-axis" aria-hidden="true"><text x="0" y="24">${max}</text><text x="0" y="190">0</text></g>`;
  const dots = days.map((day, index) => {
    const v = Number(day.views) || 0;
    return `<circle cx="${xFor(index)}" cy="${yFor(v)}" r="12" fill="transparent"><title>${day.day || ""}: ${v} views</title></circle>`;
  }).join("");
  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily views over time"><g class="v3-chart-grid">${[20, 75, 130, 185].map((y) => `<line x1="0" x2="${width}" y1="${y}" y2="${y}"/>`).join("")}</g>${yAxis}<polyline points="${points}" fill="none"/>${dots}${labels}</svg>`;
  if (total) setMetricValue(total, String(values.reduce((sum, value) => sum + value, 0)));
  if (values.some(Boolean)) {
    clearLoadError($("statsEmpty"), false);
  } else {
    clearLoadError(empty, false);
    renderEmpty(empty, {
      kind: "empty",
      title: "No visitor activity yet",
      body: state.PUBLISHED ? "Share your site link to start recording visits." : "Publish your site first. Visitors cannot reach it until it is live.",
      compact: true,
    });
  }
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
    return `<tr><td>${day.day || ""}</td><td class="num">${views}</td><td class="num">${clicks}</td><td class="num">${Number(day.copies) || 0}</td><td class="num">${views ? (clicks / views * 100).toFixed(1) : "0.0"}%</td></tr>`;
  }).join("");
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
  body.innerHTML = referrers.map((row) => `<tr><td>${esc(row.domain)}</td><td class="num">${Number(row.count) || 0}</td></tr>`).join("");
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
}
