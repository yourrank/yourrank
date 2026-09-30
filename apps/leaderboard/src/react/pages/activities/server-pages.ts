import { DEFAULT_PAGE_SIZE, normalizePageSize } from "../../../assets/pagination.js";

export type ServerPageInfo = {
  nextCursor?: string | null;
  hasMore?: boolean;
};

export class ServerPages<T extends { id?: string | number | null }> {
  pageSize: number;
  pages: T[][];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;

  constructor(pageSize = DEFAULT_PAGE_SIZE) {
    this.pageSize = DEFAULT_PAGE_SIZE;
    this.pages = [];
    this.nextCursor = null;
    this.hasMore = false;
    this.total = 0;
    this.reset(pageSize);
  }

  reset(pageSize = this.pageSize) {
    this.pageSize = normalizePageSize(pageSize);
    this.pages = [];
    this.nextCursor = null;
    this.hasMore = false;
    this.total = 0;
  }

  get loadedCount() {
    return this.pages.length;
  }

  get loadedRows() {
    return this.pages.reduce((sum, rows) => sum + rows.length, 0);
  }

  get isEmpty() {
    return this.loadedCount > 0 && this.loadedRows === 0;
  }

  reachableCount() {
    return Math.max(1, this.loadedCount + (this.hasMore ? 1 : 0));
  }

  isLoaded(pageNumber: number) {
    return Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= this.loadedCount;
  }

  cursorFor(pageNumber: number) {
    if (pageNumber === 1 && this.loadedCount === 0) return null;
    if (pageNumber === this.loadedCount + 1 && this.hasMore) return this.nextCursor;
    return undefined;
  }

  store(pageNumber: number, items: T[], page: ServerPageInfo | undefined, total: number) {
    if (pageNumber !== this.loadedCount + 1) return false;
    this.pages.push(Array.isArray(items) ? items : []);
    this.nextCursor = page?.nextCursor || null;
    this.hasMore = Boolean(page?.hasMore && this.nextCursor);
    if (Number.isFinite(Number(total))) this.total = Number(total);
    return true;
  }

  rows(pageNumber: number) {
    return this.pages[pageNumber - 1] || [];
  }

  replace(item: T) {
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

  clamp(pageNumber: number) {
    const requested = Number(pageNumber);
    if (!Number.isFinite(requested)) return 1;
    return Math.min(Math.max(Math.floor(requested), 1), this.reachableCount());
  }
}
