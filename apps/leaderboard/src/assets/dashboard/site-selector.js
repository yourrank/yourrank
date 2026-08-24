import { MANAGE_SITES_VALUE } from "./routes.js";
import { requestDashboardRoute } from "./shell.js";
import { esc } from "./utils.js";

export function renderSiteSelector({ select, sites = [], activeId = "", onSelect } = {}) {
  if (!select) return;
  const list = Array.isArray(sites) ? sites : [];
  select.innerHTML = list.length
    ? list.map((site) => {
      const id = site.id || site.siteId;
      const name = site.name || site.slug || "Site";
      return `<option value="${esc(id)}" ${String(id) === String(activeId) ? "selected" : ""}>${esc(name)}</option>`;
    }).join("")
    : `<option value="" disabled>No sites</option>`;
  const manage = document.createElement("option");
  manage.value = MANAGE_SITES_VALUE;
  manage.textContent = "Manage all sites…";
  select.appendChild(manage);
  select.disabled = false;
  select.onchange = () => {
    const id = select.value;
    if (id === MANAGE_SITES_VALUE) {
      // The entry point routes through the SPA inside the persistent shell
      // and falls back to a document load on standalone pages.
      requestDashboardRoute("boards", "", { query: "" });
      return;
    }
    if (id && id !== String(activeId)) onSelect?.(id);
  };
}
