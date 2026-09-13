// Regression tests for pagination on the "Live and past Activities" list.
//
// Bug history: the list rendered every activity in one long vertical run, so the
// panel grew without bound as a creator accumulated drops and there was no way
// to hold a position in a long list.
//
// Design notes worth keeping:
//  * Paging is entirely client-side. The API caps the result set at LIMIT 50
//    (handlers/activities.js), so a limit/offset round trip would buy nothing and
//    add latency to every page click. `activityPaging.items` holds the whole
//    dataset and slicing is pure arithmetic.
//  * The arithmetic lives in assets/pagination.js, deliberately free of DOM and
//    of any import, so it can be unit-tested here. The Activities client module is
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

describe("activities pagination wiring", () => {
  it("holds the whole dataset in client state and starts on page 1", () => {
    expect(client).toContain("const activityPaging = { items: [], page: 1, pageSize: DEFAULT_PAGE_SIZE }");
    expect(client).toContain('from "./pagination.js"');
  });

  it("resets to page 1 whenever the dataset changes", () => {
    // The reset must sit next to the dataset assignment inside renderActivities.
    expect(client).toMatch(/activityPaging\.items = next;\s*\n\s*activityPaging\.page = 1;/);
  });

  it("keeps pageSize across reloads but re-clamps the page to the new range", () => {
    // pageSize is not reset by renderActivities — only `page` is.
    expect(client).not.toMatch(/activityPaging\.pageSize = DEFAULT_PAGE_SIZE/);
    expect(client).toMatch(/activityPaging\.page = clampPage\(activityPaging\.page, total, activityPaging\.pageSize\)/);
  });

  it("slices rows through the shared helper rather than the raw array", () => {
    expect(client).toContain("pageSlice(activityPaging.items, activityPaging.page, activityPaging.pageSize)");
    expect(client).not.toMatch(/list\.innerHTML = activities\.map\(/);
  });

  it("disables Previous/Next at the ends of the range", () => {
    expect(client).toMatch(/previous\.disabled = activityPaging\.page <= 1/);
    expect(client).toMatch(/next\.disabled = activityPaging\.page >= totalPages/);
  });

  it("repaints only the rows and the pager on a page change", () => {
    // The delegated handler routes pagination to repaintActivities(), which
    // touches the list + pager only — never the whole workspace.
    expect(client).toContain("function repaintActivities()");
    expect(client).toMatch(/if \(goToPage\([\s\S]{0,80}\)\) repaintActivities\(\)/);
    expect(client).not.toMatch(/repaintActivities[\s\S]{0,200}renderAutomation\(/);
  });

  it("hides the pager while loading, empty, or errored", () => {
    expect(client).toMatch(/function showLoadError[\s\S]{0,400}\$\("act-pager"\)\?\.setAttribute\("hidden", ""\)/);
    expect(client).toMatch(/const pager = \$\("act-pager"\);[\s\S]{0,400}pager\.hidden = total === 0/);
  });

  it("does not page through a previous board's activities after leaving", () => {
    expect(client).toMatch(/function activitiesLeave\(\)[\s\S]{0,400}activityPaging\.items = \[\]/);
  });

  it("ships the pager control bar with Previous/Next, page numbers, and the range summary", () => {
    expect(page).toContain('id="act-pager"');
    expect(page).toContain('id="act-pager-prev"');
    expect(page).toContain('id="act-pager-next"');
    expect(page).toContain('id="act-pager-pages"');
    expect(page).toContain('id="act-pager-range"');
    expect(page).toContain('data-pager-step="-1"');
    expect(page).toContain('data-pager-step="1"');
    // Previous/Next start disabled — page 1 of 1 has nothing to step to.
    expect(page).toMatch(/id="act-pager-prev"[^>]*disabled/);
    expect(page).toMatch(/id="act-pager-next"[^>]*disabled/);
  });

  it("styles the pager bar and its current page", () => {
    expect(css).toContain(".act-pager {");
    expect(css).toContain(".act-pager__page.is-current");
    expect(css).toContain(".act-pager__gap");
  });
});
