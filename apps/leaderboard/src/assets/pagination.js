// Pure pagination math for the Activities list.
//
// Kept free of DOM access and of any import so it can be unit-tested directly
// (the Activities client module is served as a standalone ES module and is not
// bundled, so its internals are only reachable by reading its source). Everything
// here is a deterministic function of its arguments — no module-level state — so
// the caller owns `currentPage` and these helpers never mutate it.

/**
 * Default rows per page for the Activities list.
 * @type {number}
 */
export const DEFAULT_PAGE_SIZE = 5;

/**
 * Page-size choices offered in the control bar. Kept small and explicit so the
 * list stays scannable and the selector can be rendered from one source.
 * @type {readonly number[]}
 */
export const PAGE_SIZE_OPTIONS = [5, 8, 12];

/**
 * Coerce an arbitrary value into a usable page size.
 *
 * Anything that is not a positive integer falls back to DEFAULT_PAGE_SIZE, so a
 * stale/absent `pageSize` (or a `0` read from a cleared `<select>`) can never
 * produce a division by zero or an empty page.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function normalizePageSize(value) {
  const size = Number(value);
  return Number.isInteger(size) && size > 0 ? size : DEFAULT_PAGE_SIZE;
}

/**
 * Number of pages needed to hold `total` rows at `pageSize` per page.
 *
 * An empty list still reports one page so "Page 1 of 1" is well defined and the
 * clamp below has a valid range to land in.
 *
 * @param {number} total
 * @param {number} [pageSize]
 * @returns {number}
 */
export function pageCount(total, pageSize = DEFAULT_PAGE_SIZE) {
  const size = normalizePageSize(pageSize);
  const count = Number(total);
  if (!Number.isFinite(count) || count <= 0) return 1;
  return Math.max(1, Math.ceil(count / size));
}

/**
 * Clamp a requested page into `[1, pageCount]`.
 *
 * Non-numeric input (a `""` from a missing dataset attribute, `NaN`) is treated
 * as page 1 rather than propagating `NaN` into a slice index.
 *
 * @param {unknown} page
 * @param {number} total
 * @param {number} [pageSize]
 * @returns {number}
 */
export function clampPage(page, total, pageSize = DEFAULT_PAGE_SIZE) {
  const last = pageCount(total, pageSize);
  const requested = Number(page);
  if (!Number.isFinite(requested)) return 1;
  return Math.min(Math.max(Math.floor(requested), 1), last);
}

/**
 * The rows belonging to `page`, after clamping.
 *
 * Never throws and never returns `undefined`: an out-of-range page is clamped,
 * and a non-array input yields an empty page.
 *
 * @template T
 * @param {T[]} items
 * @param {unknown} page
 * @param {number} [pageSize]
 * @returns {T[]}
 */
export function pageSlice(items, page, pageSize = DEFAULT_PAGE_SIZE) {
  const all = Array.isArray(items) ? items : [];
  const size = normalizePageSize(pageSize);
  const current = clampPage(page, all.length, size);
  const start = (current - 1) * size;
  return all.slice(start, start + size);
}

/**
 * 1-based index range for the current page, as `[first, last]`.
 *
 * For an empty list both ends are 0 so callers can distinguish "nothing to
 * report" from "showing row 1" without a separate length check.
 *
 * @param {number} total
 * @param {unknown} page
 * @param {number} [pageSize]
 * @returns {[number, number]}
 */
export function pageRange(total, page, pageSize = DEFAULT_PAGE_SIZE) {
  const count = Number(total);
  const size = normalizePageSize(pageSize);
  if (!Number.isFinite(count) || count <= 0) return [0, 0];
  const current = clampPage(page, count, size);
  const first = (current - 1) * size + 1;
  return [first, Math.min(first + size - 1, count)];
}

/**
 * Human-readable item range summary, e.g. "Showing 1–5 of 12 activities".
 *
 * Uses an en dash between the bounds. Falls back to a zero-count sentence for an
 * empty list so the bar is never blank.
 *
 * @param {number} total
 * @param {unknown} page
 * @param {number} [pageSize]
 * @param {string} [noun]
 * @returns {string}
 */
export function rangeLabel(total, page, pageSize = DEFAULT_PAGE_SIZE, noun = "activities") {
  const count = Number(total);
  if (!Number.isFinite(count) || count <= 0) return `Showing 0 of 0 ${noun}`;
  const [first, last] = pageRange(count, page, pageSize);
  return `Showing ${first}–${last} of ${count} ${noun}`;
}

/**
 * The window of page numbers to render, with ellipsis markers.
 *
 * Returns an array of numbers and the string `"gap"`. A gap only appears when
 * more than one page is skipped, so `1 … 3` never renders when the elision would
 * hide exactly one page — an elision marker is the same width as the page number
 * it replaces, so hiding a single page costs a click and saves no space. Always
 * includes page 1 and the last page so the ends of the list stay one click away.
 *
 * @param {number} current
 * @param {number} totalPages
 * @param {number} [window]
 * @returns {Array<number | "gap">}
 */
export function pageWindow(current, totalPages, window = 1) {
  const last = Math.max(1, Math.floor(Number(totalPages)) || 1);
  const active = Math.min(Math.max(Math.floor(Number(current)) || 1, 1), last);
  const reach = Math.max(0, Math.floor(Number(window)) || 0);
  const numbers = new Set([1, last]);
  for (let page = active - reach; page <= active + reach; page += 1) {
    if (page >= 1 && page <= last) numbers.add(page);
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  // Close single-page gaps: an elision that hides exactly one page is replaced by
  // that page, which keeps the row the same width while staying fully navigable.
  for (let index = 0; index < sorted.length - 1; index += 1) {
    if (sorted[index + 1] - sorted[index] === 2) sorted.splice(index + 1, 0, sorted[index] + 1);
  }
  const output = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) output.push("gap");
    output.push(page);
    previous = page;
  }
  return output;
}
