// DOM-free page cache for a server-paginated list that exposes a numbered
// pager. /api/activities serves keyset pages (`page.nextCursor`), so pages can
// only be reached in order; this cache keeps every page fetched so far, knows
// which cursor fetches the next one, and reports how many pages are currently
// reachable (loaded pages plus one more while the server says `hasMore`).

import { DEFAULT_PAGE_SIZE, normalizePageSize } from "./pagination.js";

export class ServerPages {
  constructor(pageSize = DEFAULT_PAGE_SIZE) {
    this.reset(pageSize);
  }

  reset(pageSize = this.pageSize) {
    this.pageSize = normalizePageSize(pageSize);
    this.pages = [];
    this.nextCursor = null;
    this.hasMore = false;
    this.total = 0;
  }

  get loadedCount() { return this.pages.length; }
  get loadedRows() { return this.pages.reduce((sum, rows) => sum + rows.length, 0); }
  get isEmpty() { return this.loadedCount > 0 && this.loadedRows === 0; }

  /** Pages a viewer can currently navigate to. */
  reachableCount() {
    return Math.max(1, this.loadedCount + (this.hasMore ? 1 : 0));
  }

  isLoaded(pageNumber) {
    return Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= this.loadedCount;
  }

  /** The cursor that fetches `pageNumber`, or `undefined` when it is not the next page. */
  cursorFor(pageNumber) {
    if (pageNumber === 1 && this.loadedCount === 0) return null;
    if (pageNumber === this.loadedCount + 1 && this.hasMore) return this.nextCursor;
    return undefined;
  }

  /** Record a fetched page. Only the next sequential page is accepted. */
  store(pageNumber, items, page, total) {
    if (pageNumber !== this.loadedCount + 1) return false;
    this.pages.push(Array.isArray(items) ? items : []);
    this.nextCursor = page?.nextCursor || null;
    this.hasMore = Boolean(page?.hasMore && this.nextCursor);
    if (Number.isFinite(Number(total))) this.total = Number(total);
    return true;
  }

  rows(pageNumber) {
    return this.pages[pageNumber - 1] || [];
  }

  replace(item) {
    if (!item || item.id == null) return false;
    for (const rows of this.pages) {
      const index = rows.findIndex((row) => row.id === item.id);
      if (index !== -1) {
        rows[index] = item;
        return true;
      }
    }
    return false;
  }

  /** Clamp a requested page into the reachable range. */
  clamp(pageNumber) {
    const requested = Number(pageNumber);
    if (!Number.isFinite(requested)) return 1;
    return Math.min(Math.max(Math.floor(requested), 1), this.reachableCount());
  }
}
