// Board switcher, creation, duplication, deletion, and the board list page.
import { $, esc, getCsrf, guardAuth, logError, slugify, showConfirmModal } from "./utils.js";
import { state } from "./state.js";
import { requestDashboardRoute } from "./shell.js";
import { renderSiteSelector } from "./site-selector.js";
import { renderEmpty } from "./states.js";

export function renderBoardSwitcher() {
  const newBtn = $("newBoard");
  if (newBtn) {
    wireBoardLimitUpsell();
    const limit = state.ME?.limits?.boards || 1;
    const atLimit = state.BOARDS.length >= limit;
    newBtn.hidden = false;
    newBtn.classList.toggle("btn--ghost", atLimit);
    newBtn.title = atLimit ? "Plan limit reached — see upgrade options" : "";
    newBtn.setAttribute("aria-controls", atLimit ? "boardLimitUpsell" : "newBoardForm");
    if (!atLimit) hideBoardLimitUpsell();
    else newBtn.setAttribute("aria-expanded", $("boardLimitUpsell")?.hidden ? "false" : "true");
    newBtn.onclick = () => {
      if (atLimit) { showBoardLimitUpsell(); return; }
      hideBoardLimitUpsell();
      $("newBoardForm").hidden = false;
      newBtn.hidden = true;
      newBtn.setAttribute("aria-expanded", "true");
      $("nb_name").focus();
    };
  }
  const cancelBtn = $("nb_cancel");
  if (cancelBtn) cancelBtn.onclick = () => {
    $("newBoardForm").hidden = true;
    $("newBoard").hidden = false;
    $("newBoard").setAttribute("aria-expanded", "false");
    $("nb_err").textContent = "";
  };
  const createBtn = $("nb_create");
  if (createBtn) createBtn.onclick = async () => {
    const name = $("nb_name").value.trim();
    let slug = $("nb_slug").value.trim() || slugify(name);
    if (!slug) { $("nb_err").textContent = "Enter a site name or public link."; return; }
    const casino = $("nb_casino").value.trim();
    $("nb_err").textContent = "Creating…";
    createBtn.disabled = true;
    try {
      const code = $("nb_code").value.trim();
      const res = await fetch("/api/site/create", { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": getCsrf() }, body: JSON.stringify({ slug, name, casino, code }) });
      const d = await res.json();
      if (res.ok && d.ok) {
        requestDashboardRoute("board", "setup", { query: `board=${encodeURIComponent(d.id)}`, reload: true });
      } else if (d.code === "board_limit") {
        $("newBoardForm").hidden = true;
        newBtn.hidden = false;
        showBoardLimitUpsell();
        createBtn.disabled = false;
      } else {
        $("nb_err").textContent = d.error || "Creation failed.";
        createBtn.disabled = false;
      }
    } catch (err) { logError("new-board", err); $("nb_err").textContent = "Network error."; createBtn.disabled = false; }
  };
}

function boardLimitOffer() {
  const plan = state.ME?.plan || "free";
  const limit = state.ME?.limits?.boards || 1;
  if (plan === "agency") {
    return {
      title: `You've reached ${limit} sites`,
      text: "Need a higher limit? Contact support and tell us how many sites your team manages.",
      cta: "Contact support",
      href: "/help/support?area=billing&return=/dashboard",
    };
  }
  if (plan === "pro") {
    return {
      title: `You've reached ${limit} sites`,
      text: "Agency supports up to 99 independent sites.",
      cta: "View Agency plan",
      href: "/dashboard/settings",
    };
  }
  const planName = plan === "starter" ? "Starter" : "Free";
  return {
    title: "Need another site?",
    text: `${planName} includes ${limit} site. Pro unlocks up to 3 independent sites.`,
    cta: "Upgrade to Pro",
    href: "/dashboard/settings",
  };
}

function showBoardLimitUpsell() {
  const panel = $("boardLimitUpsell");
  if (!panel) return;
  wireBoardLimitUpsell();
  const offer = boardLimitOffer();
  $("boardLimitTitle").textContent = offer.title;
  $("boardLimitText").textContent = offer.text;
  $("boardLimitCta").textContent = offer.cta;
  $("boardLimitCta").href = offer.href;
  panel.hidden = false;
  $("newBoard")?.setAttribute("aria-expanded", "true");
  $("boardLimitCta")?.focus();
}

function hideBoardLimitUpsell(restoreFocus = true) {
  const panel = $("boardLimitUpsell");
  const wasOpen = !!panel && !panel.hidden;
  if (panel) panel.hidden = true;
  const newBtn = $("newBoard");
  newBtn?.setAttribute("aria-expanded", "false");
  if (wasOpen && restoreFocus) newBtn?.focus();
}

function wireBoardLimitUpsell() {
  const panel = $("boardLimitUpsell");
  const newBtn = $("newBoard");
  if (!panel || !newBtn || panel._wired) return;
  panel._wired = true;
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      event.preventDefault();
      hideBoardLimitUpsell();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!panel.hidden && !panel.contains(event.target) && event.target !== newBtn) {
      hideBoardLimitUpsell();
    }
  });
}

export async function deleteBoard(siteId) {
  const board = state.BOARDS.find((b) => b.id === siteId);
  if (!board) return;
  if (!await showConfirmModal("Delete site", `Delete /${board.slug}? This cannot be undone.`, "Delete", true)) return;
  try {
    const res = await fetch("/api/site", {
      method: "DELETE",
      credentials: "include",
      headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
      body: JSON.stringify({ siteId })
    }).then(guardAuth);
    const d = await res.json();
    if (res.ok && d.ok) {
      const idx = state.BOARDS.findIndex((b) => b.id === siteId);
      if (idx >= 0) state.BOARDS.splice(idx, 1);
      if (siteId === state.ACTIVE_SITE_ID) { requestDashboardRoute("home", "", { query: "", reload: true }); return; }
      renderBoardSwitcher();
      renderBoardSelect();
      renderBoardsPage();
      $("status").textContent = "Site deleted.";
    } else {
      $("status").textContent = d.error || "Could not delete the site.";
    }
  } catch (err) { logError("delete-board", err); $("status").textContent = "Network error."; }
}

export async function setActiveBoard(siteId) {
  try {
    const res = await fetch("/api/site/active", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
      body: JSON.stringify({ siteId })
    }).then(guardAuth);
    const d = await res.json();
    if (res.ok && d.ok) {
      state.ACTIVE_SITE_ID = siteId;
      renderBoardSwitcher();
      renderBoardSelect();
      $("status").textContent = "Current site updated.";
    } else {
      $("status").textContent = d.error || "Could not change the current site.";
    }
  } catch (err) { logError("set-active-board", err); $("status").textContent = "Network error."; }
}

export function openNewBoardForm() {
  const newBtn = $("newBoard");
  if (newBtn && !newBtn.hidden) newBtn.click();
}

export async function duplicateBoard(siteId) {
  const board = state.BOARDS.find((b) => b.id === siteId);
  if (!board) return;
  if (!await showConfirmModal("Duplicate site", `Duplicate /${board.slug}? This creates an unpublished copy with the same design and players.`, "Duplicate", false)) return;
  try {
    const res = await fetch("/api/site/duplicate", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
      body: JSON.stringify({ siteId })
    }).then(guardAuth);
    const d = await res.json();
    if (res.ok && d.ok) {
      requestDashboardRoute("home", "", { query: `board=${encodeURIComponent(d.id)}`, reload: true });
    } else if (d.code === "board_limit") {
      showBoardLimitUpsell();
    } else {
      $("status").textContent = d.error || "Could not duplicate the site.";
    }
  } catch (err) { logError("duplicate-board", err); $("status").textContent = "Network error."; }
}

export function renderBoardSelect() {
  const sel = $("sidebarBoardSelect");
  renderSiteSelector({
    select: sel,
    sites: state.BOARDS,
    activeId: state.ACTIVE_SITE_ID,
    onSelect: (id) => requestDashboardRoute("home", "", { query: `board=${encodeURIComponent(id)}`, reload: true }),
  });
}

export function renderBoardsPage() {
  const body = $("boardsBody");
  const empty = $("boardsEmpty");
  if (!body) return;
  body.innerHTML = "";
  const controls = $("boardsSearch")?.closest(".list-controls");
  if (controls) controls.hidden = state.BOARDS.length === 0;
  if (!state.BOARDS.length) {
    renderEmpty(empty, { icon: "archive", title: "No sites yet", body: "A site is the public page where your viewers follow the standings. Create one, add players, then publish its link.", actions: [{ label: "Create site", id: "boardsCreateEmpty", accent: true }] });
    $("boardsCreateEmpty")?.addEventListener("click", openNewBoardForm);
  } else {
    if (empty) empty.hidden = true;
    state.BOARDS.forEach((b) => {
      const tr = document.createElement("tr");
      const isActive = b.id === state.ACTIVE_SITE_ID;
      const statusText = b.published ? "Published" : "Draft";
      // Sponsor and promo code stay searchable even though the row keeps them
      // out of the way.
      tr.dataset.search = [b.name, b.slug, b.casino, b.code].filter(Boolean).join(" ").toLowerCase();
      tr.innerHTML = `<td data-label="Site"><a class="site-name" href="/dashboard?board=${encodeURIComponent(b.id)}">${esc(b.name)}</a>${isActive ? '<span class="site-current">Editing now</span>' : ''}<span class="site-meta"><a class="site-slug mono" href="/${esc(b.slug)}" target="_blank" rel="noopener">/${esc(b.slug)}</a>${b.casino ? ` · ${esc(b.casino)}` : ""}</span></td><td data-label="Status"><span class="site-state" data-state="${b.published ? "published" : "draft"}">${statusText}</span></td><td data-label="Players">${b.players || 0}</td><td class="ta-r"><div class="site-row-actions"><button class="btn btn--xs btn--ghost" data-action="edit" type="button">Manage</button><details class="site-row-menu"><summary class="btn btn--xs btn--ghost" title="More actions" aria-label="More actions for ${esc(b.name)}">⋯</summary><div class="site-row-menu-body"><button data-action="dup" type="button">Duplicate</button><button data-action="del" type="button">Delete</button></div></details></div></td>`;
      tr.querySelector(".site-name")?.addEventListener("click", (e) => {
        e.preventDefault();
        requestDashboardRoute("home", "", { query: `board=${encodeURIComponent(b.id)}`, reload: true });
      });
      // "Edit" now has an address to go to, so it opens the editor rather than
      // whichever section the smart landing picks.
      tr.querySelector('[data-action="edit"]')?.addEventListener("click", () => { requestDashboardRoute("board", "", { query: `board=${encodeURIComponent(b.id)}`, reload: true }); });
      tr.querySelector('[data-action="dup"]')?.addEventListener("click", () => { duplicateBoard(b.id); });
      tr.querySelector('[data-action="del"]')?.addEventListener("click", () => { deleteBoard(b.id); });
      // Only one row menu stays open at a time.
      tr.querySelector(".site-row-menu")?.addEventListener("toggle", (e) => {
        if (!e.currentTarget.open) return;
        body.querySelectorAll(".site-row-menu[open]").forEach((menu) => { if (menu !== e.currentTarget) menu.open = false; });
      });
      body.appendChild(tr);
    });
    filterBoards();
  }
}

function filterBoards() {
  const input = $("boardsSearch");
  const body = $("boardsBody");
  const empty = $("boardsEmpty");
  if (!input || !body) return;
  const q = input.value.trim().toLowerCase();
  let visible = 0;
  for (const row of body.children) {
    const hide = q && !(row.dataset.search || row.textContent.toLowerCase()).includes(q);
    row.hidden = hide;
    if (!hide) visible++;
  }
  if (empty) {
    if (visible > 0) {
      empty.hidden = true;
    } else {
      renderEmpty(empty, q
        ? { icon: "archive", title: "No sites match your search", body: "Try a different name or link." }
        : { icon: "archive", title: "No sites yet", body: "A site is the public page where your viewers follow the standings.", actions: [{ label: "Create site", id: "boardsCreateEmpty", accent: true }] });
      if (!q) $("boardsCreateEmpty")?.addEventListener("click", openNewBoardForm);
    }
  }
}

$("boardsSearch")?.addEventListener("input", filterBoards);
