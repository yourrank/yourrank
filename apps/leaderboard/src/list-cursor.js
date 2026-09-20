// Opaque keyset cursors for dashboard list endpoints. A cursor is the id of the
// last row on the previous page; the handler re-derives that row's sort keys
// server-side so a stale or forged cursor can only ever land on a row the
// caller is already authorized to see.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readListCursor(url) {
  const raw = String(url.searchParams.get("cursor") || "").trim();
  if (!raw) return { cursor: null, valid: true };
  return { cursor: UUID.test(raw) ? raw : null, valid: UUID.test(raw) };
}

export function readListLimit(url, { fallback, max }) {
  const raw = url.searchParams.get("limit");
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, max);
}

export function readListSearch(url, maxLength = 80) {
  return String(url.searchParams.get("q") || "").trim().slice(0, maxLength);
}

export function likePattern(term) {
  return String(term || "").replace(/[\\%_]/g, "\\$&");
}

export function pageMeta(rows, limit, idOf) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    page: { limit, hasMore, nextCursor: hasMore ? idOf(items[items.length - 1]) : null },
  };
}
