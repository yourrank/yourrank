// Topbar quick actions: "Copy link" for the live site and the "+ New" menu —
// create flows reachable from anywhere without a navigation first.
import { $, copyToClipboard, getCsrf, logError, showToast, slugify, guardAuth } from "./utils.js";
import { state } from "./state.js";
import { requestDashboardRoute } from "./shell.js";
import "../dialog.js";

let activeSite = { id: "", slug: "", live: false };

export function setQuickActionsSite(board) {
  activeSite = {
    id: String(board?.id || board?.siteId || ""),
    slug: board?.slug || "",
    live: !!board?.published,
  };
  const copy = $("copySiteLink");
  if (copy) copy.hidden = !(activeSite.slug && activeSite.live);
}

function siteId() {
  const params = new URLSearchParams(location.search);
  return params.get("siteId") || params.get("board") || state.ACTIVE_SITE_ID || activeSite.id || "";
}

export function initQuickActions() {
  const menuBtn = $("newActionBtn");
  const menu = $("newActionMenu");
  if (!menuBtn || !menu || menuBtn._wired) return;
  menuBtn._wired = true;

  const closeMenu = () => { menu.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); };
  const syncLinks = () => {
    const sid = siteId();
    const dest = {
      player: `/dashboard/leaderboard/players${sid ? `?board=${encodeURIComponent(sid)}` : ""}`,
      drop: `/dashboard/activities${sid ? `?siteId=${encodeURIComponent(sid)}` : ""}`,
      reward: `/dashboard/rewards/shop?new=1${sid ? `&siteId=${encodeURIComponent(sid)}` : ""}`,
      invite: `/dashboard/settings/team?invite=1${sid ? `&siteId=${encodeURIComponent(sid)}` : ""}`,
    };
    menu.querySelectorAll("a[data-new]").forEach((a) => { a.href = dest[a.dataset.new] || "#"; });
  };
  menuBtn.addEventListener("click", () => {
    if (menu.hidden) { syncLinks(); menu.hidden = false; menuBtn.setAttribute("aria-expanded", "true"); }
    else closeMenu();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== menuBtn) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) { e.preventDefault(); closeMenu(); menuBtn.focus(); }
  });
  menu.addEventListener("click", closeMenu);
  menu.querySelector('[data-new="site"]')?.addEventListener("click", openNewSite);

  const copy = $("copySiteLink");
  if (copy && !copy._wired) {
    copy._wired = true;
    copy.addEventListener("click", async () => {
      const slug = activeSite.slug || state.SLUG;
      if (!slug) return;
      const ok = await copyToClipboard(`${location.origin}/${slug}`);
      showToast(ok ? "Link copied — share it with your viewers." : "Copy failed — open View site and copy the URL.", ok ? "success" : "error");
    });
  }
}

function openNewSite() {
  const overlay = document.createElement("div");
  overlay.className = "modal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "ns-title");
  overlay.innerHTML = `<div class="modal-card" role="document">
    <h3 id="ns-title">New site</h3>
    <p>A site is the public page your viewers open.</p>
    <div class="field"><label for="ns_name">Site name</label><input id="ns_name" placeholder="Summer Race 2026" autocomplete="off" /></div>
    <div class="field"><label for="ns_slug">Public link</label><input id="ns_slug" placeholder="summer-race-2026" autocomplete="off" /><span class="hint">We’ll create yourrank.site/this-link.</span></div>
    <div class="modal-actions"><button class="btn btn--sm btn--ghost" data-ns="cancel" type="button">Cancel</button><button class="btn btn--sm btn--accent" data-ns="create" type="button">Create site</button></div>
    <p class="status" id="ns_err" role="alert" aria-live="assertive"></p>
  </div>`;
  document.body.appendChild(overlay);
  document.documentElement.classList.add("yr-modal-open");

  const release = window.YRDialog ? window.YRDialog.trap(overlay, close) : null;
  const name = overlay.querySelector("#ns_name");
  const link = overlay.querySelector("#ns_slug");
  const err = overlay.querySelector("#ns_err");
  const create = overlay.querySelector('[data-ns="create"]');
  let slugTouched = false;
  link.addEventListener("input", () => { slugTouched = true; });
  name.addEventListener("input", () => { if (!slugTouched) link.value = slugify(name.value); });
  function close() {
    release?.();
    overlay.remove();
    document.documentElement.classList.remove("yr-modal-open");
  }
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-ns="cancel"]').addEventListener("click", close);
  create.addEventListener("click", async () => {
    const siteName = name.value.trim();
    const slug = link.value.trim() || slugify(siteName);
    if (!siteName) { err.textContent = "Enter a site name."; name.focus(); return; }
    if (!slug) { err.textContent = "Enter a public link."; link.focus(); return; }
    err.textContent = "Creating…";
    create.disabled = true;
    try {
      const res = await fetch("/api/site/create", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
        body: JSON.stringify({ slug, name: siteName, casino: "", code: "" }),
      }).then(guardAuth);
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) {
        close();
        requestDashboardRoute("board", "setup", { query: `board=${encodeURIComponent(d.id)}`, reload: true });
      } else {
        err.textContent = d.error || "Creation failed.";
        create.disabled = false;
      }
    } catch (e2) {
      logError("quick-new-site", e2);
      err.textContent = "Network error.";
      create.disabled = false;
    }
  });
}
