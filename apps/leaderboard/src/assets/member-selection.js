// DOM-free selection model for the Members bulk toolbar. Selection survives
// pagination, search and re-renders, so the loaded page can no longer be
// treated as the set of selected rows: each selected member keeps the row
// summary captured when it was selected, and operations that need row data
// (CSV export) read from here rather than from whatever page is on screen.

export class MemberSelection {
  #rows = new Map();

  get size() { return this.#rows.size; }
  has(id) { return this.#rows.has(String(id)); }
  ids() { return [...this.#rows.keys()]; }
  rows() { return [...this.#rows.values()]; }

  add(row) {
    if (!row || row.id == null) return;
    this.#rows.set(String(row.id), row);
  }

  delete(id) { this.#rows.delete(String(id)); }
  clear() { this.#rows.clear(); }

  /** Replace snapshots with fresher rows of the same members (after a reload). */
  refresh(rows) {
    for (const row of rows || []) {
      if (row && this.#rows.has(String(row.id))) this.#rows.set(String(row.id), row);
    }
  }

  /** Keep only the given ids (used after a bulk award to retain retry targets). */
  retain(ids) {
    const keep = new Set(ids.map(String));
    for (const id of this.#rows.keys()) if (!keep.has(id)) this.#rows.delete(id);
  }
}

// Rows to export: the selection when there is one (every selected member,
// loaded or not), otherwise the rows currently loaded.
export function exportRows(selection, loadedRows) {
  return selection.size ? selection.rows() : [...(loadedRows || [])];
}
