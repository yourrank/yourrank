// Regression tests for pagination on the "Live and past Activities" list.
//
// Bug history: the list rendered every activity in one long vertical run, so the
// panel grew without bound as a creator accumulated drops and there was no way
// to hold a position in a long list.
//
// Design notes worth keeping:
//  * Paging is server-side. /api/activities serves keyset pages (`limit` +
//    `cursor`, handlers/activities.js) and the client caches only the pages it
//    has fetched (assets/activity-pages.js), so the browser never holds an
//    unbounded history and older records stay reachable page by page.
//  * The pure arithmetic lives in assets/pagination.js, deliberately free of
//    DOM, so it can be unit-tested here alongside the ServerPages cache. The Activities client module is
//    served as a standalone ES module (it has no bare imports, so build-assets.js
//    inlines it verbatim rather than bundling it) — its internals are therefore
//    only reachable by reading its source, which is what the wiring guards below
//    do.
//
// Run: bun test src/__tests__/activities-pagination.test.js

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  clampPage,
  normalizePageSize,
  pageCount,
  pageRange,
  pageSlice,
  pageWindow,
  rangeLabel,
} from "../assets/pagination.js";
import { ServerPages } from "../assets/activity-pages.js";

const client = readFileSync(new URL("../assets/activities.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../pages/activities.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../assets/activities.css", import.meta.url), "utf8");

const rows = (n) => Array.from({ length: n }, (_, index) => ({ id: `drop-${index + 1}` }));

describe("activities pagination math", () => {
  it("defaults to a small page size that keeps the list scannable", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(5);
    expect(PAGE_SIZE_OPTIONS).toContain(DEFAULT_PAGE_SIZE);
  });

  it("counts pages with a partial final page", () => {
    expect(pageCount(12, 5)).toBe(3);
    expect(pageCount(10, 5)).toBe(2);
    expect(pageCount(11, 5)).toBe(3);
    expect(pageCount(1, 5)).toBe(1);
  });

  it("reports one page for an empty list so 'Page 1 of 1' is well defined", () => {
    expect(pageCount(0, 5)).toBe(1);
    expect(pageCount(-4, 5)).toBe(1);
    expect(pageCount(NaN, 5)).toBe(1);
  });

  it("falls back to the default page size for unusable values", () => {
    expect(normalizePageSize(0)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize(-3)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize(NaN)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize(2.5)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize("8")).toBe(8);
  });

  it("clamps a requested page into range instead of yielding NaN or an empty view", () => {
    expect(clampPage(2, 12, 5)).toBe(2);
    expect(clampPage(99, 12, 5)).toBe(3);
    expect(clampPage(0, 12, 5)).toBe(1);
    expect(clampPage(-1, 12, 5)).toBe(1);
    // A "" from a missing dataset attribute must not reach a slice index.
    expect(clampPage("", 12, 5)).toBe(1);
    expect(clampPage(NaN, 12, 5)).toBe(1);
    expect(clampPage(7, 0, 5)).toBe(1);
  });

  it("slices exactly one page and never throws on bad input", () => {
    const items = rows(12);
    expect(pageSlice(items, 1, 5).map((row) => row.id)).toEqual([
      "drop-1", "drop-2", "drop-3", "drop-4", "drop-5",
    ]);
    expect(pageSlice(items, 3, 5).map((row) => row.id)).toEqual(["drop-11", "drop-12"]);
    // Out-of-range pages clamp rather than returning an empty view.
    expect(pageSlice(items, 99, 5)).toHaveLength(2);
    expect(pageSlice(items, 0, 5)).toHaveLength(5);
    expect(pageSlice(null, 1, 5)).toEqual([]);
    expect(pageSlice(undefined, 1, 5)).toEqual([]);
  });

  it("describes the visible row range for the summary line", () => {
    expect(pageRange(12, 1, 5)).toEqual([1, 5]);
    expect(pageRange(12, 2, 5)).toEqual([6, 10]);
    expect(pageRange(12, 3, 5)).toEqual([11, 12]);
    expect(pageRange(0, 1, 5)).toEqual([0, 0]);
  });

  it("renders the item range summary the spec asks for", () => {
    expect(rangeLabel(12, 1, 5)).toBe("Showing 1–5 of 12 activities");
    expect(rangeLabel(12, 2, 5)).toBe("Showing 6–10 of 12 activities");
    expect(rangeLabel(12, 3, 5)).toBe("Showing 11–12 of 12 activities");
    expect(rangeLabel(0, 1, 5)).toBe("Showing 0 of 0 activities");
  });

  it("builds a page window that elides a gap only when pages are actually skipped", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(2, 10)).toEqual([1, 2, 3, "gap", 10]);
    expect(pageWindow(5, 10)).toEqual([1, "gap", 4, 5, 6, "gap", 10]);
    expect(pageWindow(10, 10)).toEqual([1, "gap", 9, 10]);
    // No gap marker when the neighbours are adjacent...
    expect(pageWindow(1, 4)).toEqual([1, 2, 3, 4]);
    // ...and never a gap that hides exactly one page: an elision is the same
    // width as the page it replaces, so it would cost a click and save nothing.
    // Regression: page 1 of 5 used to render [1, 2, gap, 5], skipping page 3.
    expect(pageWindow(1, 5)).toEqual([1, 2, "gap", 5]);
    expect(pageWindow(1, 4)).not.toContain("gap");
    expect(pageWindow(2, 4)).not.toContain("gap");
    expect(pageWindow(3, 4)).not.toContain("gap");
    expect(pageWindow(99, 3)).toEqual([1, 2, 3]);
  });
});

describe("ServerPages cache", () => {
  it("accepts only the next sequential page and exposes the cursor that fetches it", () => {
    const pages = new ServerPages(5);
    expect(pages.cursorFor(1)).toBeNull();
    expect(pages.cursorFor(2)).toBeUndefined();
    expect(pages.store(2, rows(5), { hasMore: true, nextCursor: "x" }, 12)).toBe(false);

    expect(pages.store(1, rows(5), { hasMore: true, nextCursor: "drop-5" }, 12)).toBe(true);
    expect(pages.total).toBe(12);
    expect(pages.reachableCount()).toBe(2);
    expect(pages.cursorFor(2)).toBe("drop-5");
    expect(pages.cursorFor(3)).toBeUndefined();
    expect(pages.isLoaded(1)).toBe(true);
    expect(pages.isLoaded(2)).toBe(false);

    pages.store(2, rows(5), { hasMore: true, nextCursor: "drop-10" }, 12);
    pages.store(3, rows(2), { hasMore: false, nextCursor: null }, 12);
    expect(pages.reachableCount()).toBe(3);
    expect(pages.cursorFor(4)).toBeUndefined();
    expect(pages.rows(3)).toHaveLength(2);
    expect(pages.loadedRows).toBe(12);
  });

  it("clamps into the reachable range and resets fully (keeping the page size)", () => {
    const pages = new ServerPages(8);
    pages.store(1, rows(8), { hasMore: true, nextCursor: "c" }, 20);
    expect(pages.clamp(0)).toBe(1);
    expect(pages.clamp(99)).toBe(2);
    expect(pages.clamp("nope")).toBe(1);
    pages.reset();
    expect(pages.pageSize).toBe(8);
    expect(pages.loadedCount).toBe(0);
    expect(pages.hasMore).toBe(false);
    expect(pages.total).toBe(0);
    pages.reset(12);
    expect(pages.pageSize).toBe(12);
  });

  it("treats a loaded first page with no rows as empty", () => {
    const pages = new ServerPages(5);
    expect(pages.isEmpty).toBe(false);
    pages.store(1, [], { hasMore: false, nextCursor: null }, 0);
    expect(pages.isEmpty).toBe(true);
    expect(pages.reachableCount()).toBe(1);
  });
});

describe("activities pagination wiring", () => {
  it("caches server pages in client state and starts on page 1", () => {
    expect(client).toContain("const activityPaging = { pages: new ServerPages(DEFAULT_PAGE_SIZE), page: 1, pageLoading: false }");
    expect(client).toContain('from "./activity-pages.js"');
    expect(client).not.toMatch(/activityPaging\.items/);
    expect(client).not.toContain("pageSlice(");
  });

  it("requests bounded server pages with limit and cursor", () => {
    expect(client).toMatch(/new URLSearchParams\(\{ limit: String\(activityPaging\.pages\.pageSize\) \}\)/);
    expect(client).toMatch(/if \(cursor\) query\.set\("cursor", cursor\)/);
    expect(client).toContain("const data = await api(activitiesQuery(null));");
    expect(client).toContain("const data = await api(activitiesQuery(cursor));");
  });

  it("resets the cache and page whenever the dataset is reloaded", () => {
    expect(client).toMatch(/activityPaging\.pages\.reset\(\);\s*\n\s*activityPaging\.pages\.store\(1, next, data\?\.page, data\?\.total \?\? next\.length\);\s*\n\s*activityPaging\.page = 1;/);
  });

  it("re-fetches from page 1 at the new size when the page size changes", () => {
    expect(client).toMatch(/activityPaging\.pages\.reset\(normalizePageSize\(event\.target\?\.value\)\);\s*\n\s*activityPaging\.page = 1;\s*\n\s*loadActivities\(\);/);
  });

  it("fetches the next page on demand and reloads on a stale cursor", () => {
    expect(client).toContain("async function goToPage(target, token = lifecycleToken)");
    expect(client).toMatch(/const cursor = pages\.cursorFor\(next\);\s*\n\s*if \(cursor === undefined\) return false;/);
    expect(client).toMatch(/if \(error\?\.status === 410\) \{ await loadActivities\(token\); return false; \}/);
    // A response for a board the viewer already left is discarded.
    expect(client).toMatch(/const data = await api\(activitiesQuery\(cursor\)\);\s*\n\s*if \(token !== lifecycleToken\) return false;/);
  });

  it("disables Previous/Next at the ends of the reachable range and while loading", () => {
    expect(client).toMatch(/previous\.disabled = activityPaging\.pageLoading \|\| activityPaging\.page <= 1/);
    expect(client).toMatch(/next\.disabled = activityPaging\.pageLoading \|\| activityPaging\.page >= totalPages/);
    expect(client).toContain("const totalPages = pages.reachableCount();");
  });

  it("repaints only the rows and the pager on a page change", () => {
    expect(client).toContain("function repaintActivities()");
    expect(client).toMatch(/goToPage\([\s\S]{0,80}\)\.then\(\(moved\) => \{ if \(moved\) repaintActivities\(\); \}\)/);
    expect(client).not.toMatch(/repaintActivities[\s\S]{0,200}renderAutomation\(/);
  });

  it("hides the pager while loading, empty, or errored", () => {
    expect(client).toMatch(/function showLoadError[\s\S]{0,400}\$\("act-pager"\)\?\.setAttribute\("hidden", ""\)/);
    expect(client).toMatch(/const pager = \$\("act-pager"\);[\s\S]{0,500}pager\.hidden = total === 0/);
  });

  it("replaces a cached row in place with the server's authoritative activity", () => {
    const pages = new ServerPages(2);
    pages.store(1, [{ id: "drop:a", state: "open" }, { id: "drop:b", state: "open" }], { hasMore: true, nextCursor: "b" }, 3);
    pages.store(2, [{ id: "drop:c", state: "open" }], { hasMore: false, nextCursor: null }, 3);
    expect(pages.replace({ id: "drop:c", state: "completed" })).toBe(true);
    expect(pages.rows(2)).toEqual([{ id: "drop:c", state: "completed" }]);
    expect(pages.rows(1).map((row) => row.state)).toEqual(["open", "open"]);
    expect(pages.replace({ id: "drop:zzz", state: "completed" })).toBe(false);
    expect(pages.replace(null)).toBe(false);
  });

  it("offers End now only for open drops and ends them through the close endpoint", () => {
    expect(client).toMatch(/activity\.actions\?\.canEnd \? `<div class="act-row-actions"><button[^`]*data-activity-end="\$\{esc\(activity\.id\)\}">End now<\/button><\/div>` : ""/);
    expect(client).toContain("if (button.dataset.activityEnd) return void endActivity(button.dataset.activityEnd);");
    expect(client).toContain("async function endActivity(id, token = lifecycleToken)");
    expect(client).toMatch(/window\.YRDialog\?\.confirm[\s\S]{0,300}confirmText: "End now",\s*\n\s*danger: true/);
    expect(client).toMatch(/api\(sitePath\("\/api\/activities\/close", activeSiteId\), \{\s*\n\s*method: "POST"[\s\S]{0,120}body: JSON\.stringify\(\{ siteId: activeSiteId, activityId: id \}\)/);
    // The returned row replaces the cached one; a stale board response is dropped.
    expect(client).toMatch(/if \(token !== lifecycleToken\) return false;\s*\n\s*activityPaging\.pages\.replace\(body\.activity\);\s*\n[\s\S]{0,160}renderActivityRows\(\);/);
    // A drop that ended on its own (409) or vanished (404) refreshes the list instead of guessing.
    expect(client).toMatch(/if \(error\?\.status === 409 \|\| error\?\.status === 404\) await loadActivities\(\);/);
    expect(client).toMatch(/if \(button\) button\.disabled = false;/);
  });

  it("does not page through a previous board's activities after leaving", () => {
    expect(client).toMatch(/function activitiesLeave\(\)[\s\S]{0,400}activityPaging\.pages\.reset\(\)/);
  });

  it("ships the pager control bar with Previous/Next, page numbers, and the range summary", () => {
    expect(page).toContain('id="act-pager"');
    expect(page).toContain('id="act-pager-prev"');
    expect(page).toContain('id="act-pager-next"');
    expect(page).toContain('id="act-pager-pages"');
    expect(page).toContain('id="act-pager-range"');
    expect(page).toContain('data-pager-step="-1"');
    expect(page).toContain('data-pager-step="1"');
    expect(page).toMatch(/id="act-pager-prev"[^>]*disabled/);
    expect(page).toMatch(/id="act-pager-next"[^>]*disabled/);
  });

  it("styles the pager bar and its current page", () => {
    expect(css).toContain(".act-pager {");
    expect(css).toContain(".act-pager__page.is-current");
    expect(css).toContain(".act-pager__gap");
  });
});
