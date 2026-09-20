import { renderEmpty, renderError, setRowsLoading } from "./states.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Cursor-paginated list driven by the server: search, sort and filters are sent
// as query parameters and every page comes from the API, so the browser never
// searches or pages over a truncated subset. Emits the same `.list-controls`
// markup as ListController so existing toolbar/footer mounts keep working.
export class ServerListController {
  constructor(opts) {
    this.root = opts.root;
    this.tbody = typeof opts.tbody === "string" ? document.getElementById(opts.tbody) : opts.tbody;
    this.emptyEl = opts.emptyEl || null;
    this.emptySpec = opts.emptySpec || { kind: "empty", title: "Nothing here yet.", compact: true };
    this.noResultsSpec = opts.noResultsSpec || { kind: "search", title: "No matches", body: "Try a different search.", compact: true };
    this.errorSpec = opts.errorSpec || { title: "Couldn't load this list", body: "Try again to reload it." };
    this.fetchPage = opts.fetchPage;
    this.renderItem = opts.renderItem;
    this.onRender = opts.onRender || (() => {});
    this.sortOptions = opts.sortOptions || [];
    this.searchable = opts.searchable !== false;
    this.itemLabel = opts.itemLabel || "items";
    this.items = [];
    this.page = null;
    this.total = null;
    this.query = "";
    this.sortKey = this.sortOptions[0]?.key || "";
    this.request = 0;
    this.loading = false;
    this._buildControls();
  }

  _buildControls() {
    const wrap = document.createElement("div");
    wrap.className = "list-controls";
    const placeholder = this.root?.dataset?.searchPlaceholder || "Search…";
    let html = `<div class="list-controls-row">`;
    if (this.searchable) html += `<input type="search" class="list-search" placeholder="${esc(placeholder)}" aria-label="Search" />`;
    if (this.sortOptions.length) {
      html += `<select class="list-sort" aria-label="Sort">`;
      for (const opt of this.sortOptions) html += `<option value="${esc(opt.key)}"${opt.key === this.sortKey ? " selected" : ""}>${esc(opt.label)}</option>`;
      html += `</select>`;
    }
    html += `</div><div class="list-pagination" role="group" aria-label="Pagination"><span class="list-page-info"></span><button class="btn btn--sm" data-load-more type="button" hidden>Load more</button></div>`;
    wrap.innerHTML = html;
    this.root.insertBefore(wrap, this.root.firstChild);
    this.controls = wrap;
    this.searchInput = wrap.querySelector(".list-search");
    this.sortSelect = wrap.querySelector(".list-sort");
    this.moreBtn = wrap.querySelector("[data-load-more]");
    this.pageInfo = wrap.querySelector(".list-page-info");
    let timer = 0;
    this.searchInput?.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = this.searchInput.value.trim();
        if (next === this.query) return;
        this.query = next;
        this.reload();
      }, 250);
    });
    this.sortSelect?.addEventListener("change", () => { this.sortKey = this.sortSelect.value; this.reload(); });
    this.moreBtn.addEventListener("click", () => this.loadMore());
  }

  setLoading(loading) {
    if (!this.tbody) return;
    if (loading) {
      this.tbody.closest("table")?.setAttribute("aria-busy", "true");
      if (this.emptyEl) this.emptyEl.hidden = true;
      setRowsLoading(this.tbody, { cols: this.tbody.closest("table")?.querySelectorAll("thead th").length || 1, rows: 3 });
      if (this.pageInfo) this.pageInfo.textContent = "Loading…";
      this.moreBtn.hidden = true;
    } else {
      this.tbody.closest("table")?.removeAttribute("aria-busy");
      this.tbody.removeAttribute("aria-busy");
    }
  }

  params() {
    const params = new URLSearchParams();
    if (this.query) params.set("q", this.query);
    if (this.sortKey) params.set("sort", this.sortKey);
    return params;
  }

  async reload() {
    const request = ++this.request;
    this.loading = true;
    this.setLoading(true);
    try {
      const data = await this.fetchPage(this.params(), null);
      if (request !== this.request) return;
      this.items = data.items || [];
      this.page = data.page || { hasMore: false, nextCursor: null };
      this.total = data.total ?? null;
      this.setLoading(false);
      this.render();
    } catch (error) {
      if (request !== this.request) return;
      this.setLoading(false);
      this.renderErrorState(error);
    } finally {
      if (request === this.request) this.loading = false;
    }
  }

  async loadMore() {
    if (this.loading || !this.page?.hasMore || !this.page.nextCursor) return;
    const request = ++this.request;
    this.loading = true;
    this.moreBtn.disabled = true;
    this.moreBtn.textContent = "Loading…";
    try {
      const data = await this.fetchPage(this.params(), this.page.nextCursor);
      if (request !== this.request) return;
      this.items = this.items.concat(data.items || []);
      this.page = data.page || { hasMore: false, nextCursor: null };
      if (data.total != null) this.total = data.total;
      this.render();
    } catch (error) {
      if (request !== this.request) return;
      this.moreBtn.textContent = "Couldn't load more — retry";
    } finally {
      if (request === this.request) { this.loading = false; this.moreBtn.disabled = false; }
    }
  }

  renderErrorState() {
    this.tbody.innerHTML = "";
    this.moreBtn.hidden = true;
    if (this.pageInfo) this.pageInfo.textContent = "";
    if (this.emptyEl) renderError(this.emptyEl, { ...this.errorSpec, retry: () => this.reload() });
  }

  render() {
    const count = this.items.length;
    this.moreBtn.textContent = "Load more";
    if (!count) {
      this.tbody.innerHTML = "";
      this.moreBtn.hidden = true;
      if (this.pageInfo) this.pageInfo.textContent = "";
      if (this.emptyEl) {
        this.emptyEl.removeAttribute("role");
        renderEmpty(this.emptyEl, this.query ? this.noResultsSpec : this.emptySpec);
      }
      this.onRender();
      return;
    }
    if (this.emptyEl) this.emptyEl.hidden = true;
    this.tbody.innerHTML = this.items.map((item) => `<tr>${this.renderItem(item)}</tr>`).join("");
    const hasMore = Boolean(this.page?.hasMore);
    this.moreBtn.hidden = !hasMore;
    if (this.pageInfo) {
      const totalText = this.total != null ? ` of ${this.total}` : hasMore ? "" : ` of ${count}`;
      this.pageInfo.textContent = `Showing ${count}${totalText} ${this.itemLabel}${hasMore && this.total == null ? " · more available" : ""}`;
    }
    this.onRender();
  }

  updateItem(predicate, patch) {
    const item = this.items.find(predicate);
    if (item) Object.assign(item, patch);
    return item;
  }
}
