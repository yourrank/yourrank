// Server cursor pages and the React pager keep history bounded and reachable.

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
import { ServerPages } from "../react/pages/activities/server-pages.ts";

const client = readFileSync(new URL("../react/pages/activities/page.tsx", import.meta.url), "utf8");
const serverPages = readFileSync(new URL("../react/pages/activities/server-pages.ts", import.meta.url), "utf8");

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
    expect(client).toMatch(/const activityPaging = \{\s*pages: new ServerPages<Activity>\(DEFAULT_PAGE_SIZE\),\s*page: 1,\s*pageLoading: false,\s*\}/);
    expect(client).toContain('from "./server-pages"');
    expect(serverPages).toContain('from "../../../assets/pagination.js"');
    expect(client).not.toMatch(/activityPaging\.items/);
    expect(client).not.toContain("pageSlice(");
  });

  it("requests bounded server pages with limit and cursor", () => {
    // Live drops and history are separate server datasets, never one filtered list.
    expect(client).toMatch(/function activitiesQuery\(state: "open" \| "completed", limit: number, cursor: string \| null, siteId: string\)/);
    expect(client).toMatch(/if \(contextSiteId\) query\.set\("siteId", contextSiteId\);\s*query\.set\("state", state\);\s*query\.set\("limit", String\(limit\)\);\s*if \(cursor\) query\.set\("cursor", cursor\);/);
    expect(client).toContain('activitiesQuery("open", LIVE_LIMIT, null, requestSiteId)');
    expect(client).toContain('activitiesQuery("completed", activityPaging.pages.pageSize, null, requestSiteId)');
    expect(client).toContain('activitiesQuery("completed", pages.pageSize, cursor, activeSiteRef.current)');
    expect(client).toContain("request<ActivitiesResponse>");
    expect(client).toContain("activeSiteRef.current, token");
    expect(client).toContain('url.searchParams.has("siteId") ? "" : siteId');
    expect(client).not.toMatch(/state=all|activitiesQuery\("all"/);
  });

  it("resets the cache and page whenever the dataset is reloaded", () => {
    expect(client).toMatch(/activityPaging\.pages\.reset\(activityPaging\.pages\.pageSize\);\s*\n\s*activityPaging\.pages\.store\(1, rows, result\.page, result\.total \?\? rows\.length\);\s*\n\s*activityPaging\.page = 1;/);
  });

  it("re-fetches from page 1 at the new size when the page size changes", () => {
    expect(client).toMatch(/activityPaging\.pages\.reset\(size\);\s*\n\s*activityPaging\.page = 1;\s*\n\s*setPage\(1\);\s*\n\s*void loadHistory\(\);/);
  });

  it("fetches the next page on demand and reloads on a stale cursor", () => {
    expect(client).toContain("const goToPage = useCallback(async (target: number)");
    expect(client).toMatch(/const cursor = pages\.cursorFor\(next\);\s*\n\s*if \(cursor === undefined\) return;/);
    expect(client).toMatch(/if \(errorStatus\(error\) === 410\) \{\s*\n\s*await loadHistory\(token\);/);
    expect(client).toMatch(/const result = await request<ActivitiesResponse>[\s\S]{0,200}if \(!current\(token\)\) return;/);
  });

  it("disables Previous/Next at the ends of the reachable range and while loading", () => {
    expect(client).toContain("disabled={pageIsLoading || page <= 1}");
    expect(client).toContain("disabled={pageIsLoading || page >= totalPages}");
    expect(client).toContain("const totalPages = activityPaging.pages.reachableCount()");
  });

  it("renders the pager only for a loaded multi-page history dataset", () => {
    expect(client).toContain('id="act-pager"');
    expect(client).toMatch(/const pagerHidden = historyState !== "rows" \|\| activityPaging\.pages\.total === 0 \|\| \(totalPages <= 1 && activityPaging\.pages\.total <= activityPaging\.pages\.pageSize\)/);
    expect(client).toMatch(/id="act-pager"[^>]*hidden=\{pagerHidden\}/);
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

  it("offers End now only for open drops and confirms before the close endpoint", () => {
    const activityRow = client.slice(client.indexOf("function ActivityRow"), client.indexOf("function ActivitySection"));
    expect(activityRow).toMatch(/!history && <div[\s\S]*?activity\.actions\?\.canEnd && <Button[\s\S]*?data-activity-end=\{activity\.id\}/);
    expect(activityRow).not.toMatch(/(?<!!)history && <div[\s\S]*?data-activity-end/);
    expect(client).toMatch(/title: `End "\$\{activity\.title\}" now\?`/);
    expect(client).toContain('"/api/activities/close"');
    expect(client).toContain("const body: CloseActivityRequest = { siteId: activeSiteRef.current, activityId: id };");
    expect(client).toContain("body: JSON.stringify(body),");
    expect(client).toContain("if ([409, 404].includes(errorStatus(error))) await loadAll(token)");
  });

  it("does not page through a previous board's activities after leaving", () => {
    expect(client).toMatch(/return \(\) => \{[\s\S]{0,450}activityPaging\.pages\.reset\(activityPaging\.pages\.pageSize\)/);
  });

  it("renders a styled React pager with navigable page ranges", () => {
    expect(client).toContain('id="act-pager-prev"');
    expect(client).toContain('id="act-pager-next"');
    expect(client).toContain('id="act-pager-pages"');
    expect(client).toContain('id="act-pager-range"');
    expect(client).toContain('data-pager-step="-1"');
    expect(client).toContain('data-pager-step="1"');
    expect(client).toContain("rangeLabel(activityPaging.pages.total, page, activityPaging.pages.pageSize)");
    expect(client).toContain("act-pager__page h-8 min-w-8");
    expect(client).toContain("act-pager__gap px-1");
  });
});
