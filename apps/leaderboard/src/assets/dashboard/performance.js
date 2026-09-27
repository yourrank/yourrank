import { $, esc, logError, showLoadError, clearLoadError, paginate, wirePager } from "./utils.js";
import { setState, state } from "./state.js";
import { renderEmpty, renderError, setMetricEmpty, setMetricLoading, setMetricUnknown, setMetricValue, setRowsLoading } from "./states.js";
import { defaultTab, parseDashboardPath, SECTIONS } from "./routes.js";
import { registerRouteRenderer, requestDashboardRoute } from "./shell.js";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
let insightsRequestKey = "";

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
  loadInsights();
}

function wireRangeFilter() {
  const filter = $("perfRangeFilter");
  if (!filter || filter._wired) return;
  filter._wired = true;
  filter.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-range]");
    if (!btn) return;
    filter.querySelectorAll("button[data-range]").forEach((node) => {
      node.classList.toggle("is-active", node === btn);
      node.setAttribute("aria-pressed", String(node === btn));
    });
    state.PERF_RANGE = Number(btn.dataset.range);
    if (state.STATS) renderPerformance(state.STATS);
    loadInsights({ force: true });
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
  const panels = { activity: ["perf-activity"], referrals: ["perf-referrals"], events: ["perf-events"] };
  Object.entries(panels).forEach(([name, ids]) => ids.forEach((id) => { const node = $(id); if (node) node.hidden = name !== active; }));
  const summary = document.querySelector("[data-perf-summary]");
  if (summary) summary.hidden = active !== "events";
  if (active === "activity") loadInsights();
}

export function renderPerformance(stats) {
  state.STATS = stats;
  if (!document.querySelector('section[data-page="performance"].is-on')) return;
  const range = state.PERF_RANGE || 30;
  const all = Array.isArray(stats.days) ? stats.days : [];
  const days = all.slice(-range);
  const hasData = days.some((day) => Number(day.views) || Number(day.clicks) || Number(day.copies));
  const hasAnyData = all.some((day) => Number(day.views) || Number(day.clicks) || Number(day.copies));
  const rangeFilter = $("perfRangeFilter");
  if (rangeFilter) rangeFilter.dataset.hasData = hasAnyData ? "1" : "0";
  const previous = all.slice(Math.max(0, all.length - range * 2), Math.max(0, all.length - range));
  const currentTotals = totals(days);
  const previousTotals = totals(previous);
  if (hasData) {
    setMetricValue($("insightsSiteVisits"), currentTotals.views.toLocaleString("en-US"));
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
    setMetricEmpty($("insightsSiteVisits"));
    setMetricEmpty($("perfKpiCtr"), { value: "0.0%" });
    ["perfKpiViewsDelta", "perfKpiClicksDelta", "perfKpiCopiesDelta", "perfKpiCtrDelta"].forEach((id) => { const el = $(id); if (el) el.textContent = ""; });
  }
  const board = $("perfBoardName");
  if (board) board.textContent = state.SLUG || "Active site";
  renderChart(days, hasAnyData);
  renderActivity(days, hasAnyData);
  renderEvents(days, hasAnyData);
  loadHeatmap();
  if (activePerformanceTab() === "activity") loadInsights();
}

function setInsightValue(id, value, available = true) {
  const node = $(id);
  if (!node) return;
  if (!available) return setMetricUnknown(node);
  setMetricValue(node, Number(value || 0).toLocaleString("en-US"));
}

function setInsightSectionStatus(id, available) {
  const node = $(id);
  if (!node) return;
  node.hidden = available;
  node.textContent = available ? "" : "Some data in this section is unavailable.";
}

function renderInsights(data) {
  const host = $("insightsQuestions");
  if (!host) return;
  host.removeAttribute("aria-busy");
  clearLoadError($("insightsStatus"), false);
  const availability = data.availability || {};
  setInsightSectionStatus("insightsCommunityStatus", availability.community !== false);
  setInsightSectionStatus("insightsParticipationStatus", availability.participation !== false && availability.rewards !== false);
  setInsightValue("insightsNewMembers", data.community?.newMembers, availability.community !== false);
  setInsightValue("insightsReturningMembers", data.community?.returningMembers, availability.community !== false);
  setInsightValue("insightsParticipants", data.participation?.participants, availability.participation !== false);
  setInsightValue("insightsClaimsSubmitted", data.rewards?.claimsSubmitted, availability.rewards !== false);
  setInsightValue("insightsRepeatParticipants", data.participation?.repeatParticipants, availability.participation !== false);
  setInsightValue("insightsActiveDrops", data.participation?.activeCodeDrops, availability.participation !== false);
  setInsightValue("insightsClaimsCompleted", data.rewards?.claimsCompleted, availability.rewards !== false);
  setInsightValue("insightsPendingReviews", data.operations?.pendingReviews, availability.pendingReviews !== false);
  setInsightValue("insightsPendingClaims", data.operations?.pendingClaims, availability.pendingClaims !== false);
  const communityChart = $("insightsCommunityChart");
  if (communityChart) {
    const joined = Number(data.community?.newMembers) || 0;
    const returned = Number(data.community?.returningMembers) || 0;
    const total = joined + returned;
    communityChart.setAttribute("aria-label", availability.community === false ? "Community activity unavailable" : `${joined} new members and ${returned} returning members`);
    communityChart.innerHTML = availability.community === false ? '<p>Community activity unavailable</p>' : !total
      ? '<p>No member activity in this period</p>'
      : `<div class="insights-community-track"><span style="width:${joined / total * 100}%"></span><span style="width:${returned / total * 100}%"></span></div><div class="insights-community-legend"><span><i></i>New · ${joined.toLocaleString("en-US")}</span><span><i></i>Returning · ${returned.toLocaleString("en-US")}</span></div>`;
  }
  const participationEmpty = $("insightsParticipationEmpty");
  const participationMetrics = $("insightsParticipationMetrics");
  const noParticipation = availability.participation !== false && availability.rewards !== false &&
    ![data.participation?.participants, data.participation?.repeatParticipants, data.participation?.activeCodeDrops, data.rewards?.claimsSubmitted, data.rewards?.claimsCompleted].some(Number);
  if (participationEmpty) participationEmpty.hidden = !noParticipation;
  if (participationMetrics) participationMetrics.hidden = noParticipation;
  const reviews = Number(data.operations?.pendingReviews) || 0;
  const claims = Number(data.operations?.pendingClaims) || 0;
  const attentionKnown = availability.pendingReviews !== false && availability.pendingClaims !== false;
  const operationsEmpty = $("insightsOperationsEmpty");
  const operationsMetrics = $("insightsOperationsMetrics");
  if (operationsEmpty) {
    operationsEmpty.hidden = reviews + claims > 0;
    operationsEmpty.textContent = attentionKnown ? "Nothing needs attention." : "Pending work could not be checked right now.";
  }
  if (operationsMetrics) operationsMetrics.hidden = reviews + claims === 0;
  if ($("insightsReviewAction")) $("insightsReviewAction").hidden = !reviews;
  if ($("insightsClaimAction")) $("insightsClaimAction").hidden = !claims;
  if ($("insightsOperations")) $("insightsOperations").classList.toggle("has-pending", reviews + claims > 0);
  const board = $("perfBoardName");
  if (board && data.site?.name) board.textContent = data.site.name;
}

function renderInsightsLoading() {
  const host = $("insightsQuestions");
  if (host) host.setAttribute("aria-busy", "true");
  const communityChart = $("insightsCommunityChart");
  if (communityChart) communityChart.innerHTML = '<span class="skeleton v3-skel-line" aria-hidden="true"></span>';
  if ($("insightsParticipationEmpty")) $("insightsParticipationEmpty").hidden = true;
  if ($("insightsParticipationMetrics")) $("insightsParticipationMetrics").hidden = false;
  if ($("insightsOperationsEmpty")) $("insightsOperationsEmpty").hidden = true;
  if ($("insightsOperationsMetrics")) $("insightsOperationsMetrics").hidden = false;
  if ($("insightsReviewAction")) $("insightsReviewAction").hidden = false;
  if ($("insightsClaimAction")) $("insightsClaimAction").hidden = false;
  ["insightsNewMembers", "insightsReturningMembers", "insightsParticipants", "insightsRepeatParticipants", "insightsActiveDrops", "insightsClaimsSubmitted", "insightsClaimsCompleted", "insightsPendingReviews", "insightsPendingClaims"].forEach((id) => setMetricLoading($(id)));
  ["insightsCommunityStatus", "insightsParticipationStatus"].forEach((id) => { const node = $(id); if (node) node.hidden = true; });
}

export async function loadInsights({ force = false } = {}) {
  const siteId = state.ACTIVE_SITE_ID || "";
  const days = state.PERF_RANGE || 30;
  const key = `${siteId}:${days}`;
  if (!force && insightsRequestKey === key && state.INSIGHTS) {
    renderInsights(state.INSIGHTS);
    return state.INSIGHTS;
  }
  insightsRequestKey = key;
  renderInsightsLoading();
  const params = new URLSearchParams({ days: String(days) });
  if (siteId) params.set("siteId", siteId);
  try {
    const response = await fetch(`/api/insights?${params.toString()}`, { credentials: "same-origin" });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Insights failed to load.");
    if (insightsRequestKey !== key) return null;
    setState({ INSIGHTS: body });
    renderInsights(body);
    return body;
  } catch (error) {
    if (insightsRequestKey === key) insightsRequestKey = "";
    logError("load-insights", error);
    showLoadError($("insightsStatus"), "Insights", () => loadInsights({ force: true }));
    return null;
  }
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
  const hasData = days.some((day) => Number(day.views));
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
  const height = 150;
  const values = days.map((day) => Number(day.views) || 0);
  const max = Math.max(5, ...values);
  // 10% headroom: without it the peak (or a flat non-zero run) pins to the
  // top edge and reads as a spike.
  const scaleMax = max * 1.1;
  const xFor = (index) => (index / Math.max(1, values.length - 1)) * width;
  const yFor = (value) => height - 25 - (value / scaleMax) * 100;
  const points = values.map((value, index) => `${xFor(index)},${yFor(value)}`).join(" ");
  const labels = days.map((day, index) => {
    if (!day.day || index % Math.max(1, Math.ceil(days.length / 7))) return "";
    return `<text x="${xFor(index)}" y="146" text-anchor="${index === 0 ? "start" : "middle"}">${esc(formatDay(day.day))}</text>`;
  }).join("");
  const yAxis = `<g class="v3-chart-axis" aria-hidden="true"><text x="0" y="18">${max}</text><text x="0" y="123">0</text></g>`;
  const dots = days.map((day, index) => {
    const v = Number(day.views) || 0;
    return `<circle cx="${xFor(index)}" cy="${yFor(v)}" r="12" fill="transparent"><title>${day.day || ""}: ${v} views</title></circle>`;
  }).join("");
  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily site visits over time"><g class="v3-chart-grid">${[15, 50, 85, 120].map((y) => `<line x1="0" x2="${width}" y1="${y}" y2="${y}"/>`).join("")}</g>${yAxis}<polyline points="${points}" fill="none"/>${dots}${labels}</svg>`;
  if (total) setMetricValue(total, String(values.reduce((sum, value) => sum + value, 0)));
  clearLoadError($("statsEmpty"), false);
}

// The day rows grow forever inside a collapsed card; keep the last fetch here
// so the numbered pager can re-render a slice without refetching.
const activityView = { days: [], hasAnyData: false, page: 1 };
const ACTIVITY_PER_PAGE = 10;

function renderActivity(days, hasAnyData = false) {
  activityView.days = days || [];
  activityView.hasAnyData = hasAnyData;
  renderActivityPage();
}

function renderActivityPage() {
  const body = $("perfActivityBody");
  if (!body) return;
  const { days, hasAnyData } = activityView;
  const hasData = days.some((day) => Number(day.views) || Number(day.clicks) || Number(day.copies));
  const table = body.closest("table");
  const empty = $("perfActivityEmpty");
  const pagerHost = $("perfActivityPager");
  if (!hasData) {
    body.innerHTML = "";
    if (table) table.hidden = true;
    if (pagerHost) { pagerHost.innerHTML = ""; pagerHost.hidden = true; }
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
  const newest = [...days].reverse();
  const { items, page, totalPages } = paginate(newest, activityView.page, ACTIVITY_PER_PAGE);
  activityView.page = page;
  body.innerHTML = items.map((day) => {
    const views = Number(day.views) || 0;
    const clicks = Number(day.clicks) || 0;
    return `<tr><td data-label="Date" title="${esc(day.day || "")}">${esc(formatDay(day.day))}</td><td data-label="Visits" class="num">${views}</td><td data-label="Link clicks" class="num">${clicks}</td><td data-label="Link shares" class="num">${Number(day.copies) || 0}</td><td data-label="Click rate" class="num">${views ? (clicks / views * 100).toFixed(1) : "0.0"}%</td></tr>`;
  }).join("");
  wirePager(pagerHost, { page, totalPages, onPage: (n) => { activityView.page = n; renderActivityPage(); } });
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
  if (!wrap) return;
  const siteId = state.ACTIVE_SITE_ID || "";
  const days = state.PERF_RANGE || 30;
  const key = `${siteId}:${days}`;
  if (wrap._loadingKey === key) return;
  wrap._loadingKey = key;
  setState({ HEATMAP_STATUS: "loading" });
  const grid = $("perfHeatmapGrid");
  if (grid) {
    grid.setAttribute("aria-busy", "true");
    grid.innerHTML = '<span class="skeleton v3-skel-heatmap" aria-hidden="true"></span>';
  }
  try {
    const params = new URLSearchParams({ days: String(days) });
    if (siteId) params.set("siteId", siteId);
    const response = await fetch(`/api/site/stats/heatmap?${params.toString()}`);
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "heatmap failed");
    if (wrap._loadingKey !== key) return;
    renderHeatmap(body.heatmap || []);
    renderReferrers(body.referrers || []);
    setState({ HEATMAP_STATUS: "ready" });
  } catch (error) {
    if (wrap._loadingKey !== key) return;
    setState({ HEATMAP_STATUS: "error" });
    logError("load-heatmap", error);
    const grid = $("perfHeatmapGrid");
    if (grid) {
      grid.removeAttribute("aria-busy");
      renderError(grid, { title: "Couldn't load your activity map.", retry: loadHeatmap });
    }
    showLoadError($("perfReferrersEmpty"), "your traffic sources", loadHeatmap);
  } finally {
    if (wrap._loadingKey === key) wrap._loadingKey = "";
  }
}

function renderHeatmap(matrix) {
  const grid = $("perfHeatmapGrid");
  if (!grid) return;
  const values = matrix.flat().map((value) => Number(value) || 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total < 10 || values.filter(Boolean).length < 2) {
    renderEmpty(grid, { kind: "empty", title: "Not enough activity yet", body: "Visitor timing will appear after more visits are recorded.", compact: true });
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
  ["perfKpiViews", "perfKpiClicks", "perfKpiCopies", "perfKpiCtr", "perfTotalViews", "insightsSiteVisits"].forEach((id) => setMetricLoading($(id)));
  activityView.page = 1;
  const activityPager = $("perfActivityPager");
  if (activityPager) { activityPager.innerHTML = ""; activityPager.hidden = true; }
  setRowsLoading($("perfActivityBody"), { cols: 5, rows: 4 });
  const events = $("eventsList");
  if (events) {
    events.hidden = false;
    events.setAttribute("aria-busy", "true");
    events.innerHTML = Array.from({ length: 3 }, () => '<li><span class="skeleton v3-skel-line" aria-hidden="true"></span></li>').join("");
  }
}
