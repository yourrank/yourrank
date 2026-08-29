/* Operator panel: users, leads, payments, support, actions. */
import { showConfirmModal, showPromptModal, showToast } from "./dashboard/utils.js";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = (ms) => { if (!ms) return "–"; const d = new Date(Number(ms)); return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
function getCsrf() { const m = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/); return m ? m[1] : ""; }

async function api(path, opts) {
    const merged = { ...opts, credentials: "include" };
    if (merged.method && ["POST","PUT","DELETE","PATCH"].includes(merged.method.toUpperCase())) {
      merged.headers = { ...(merged.headers || {}), "x-csrf-token": getCsrf() };
    }
    const res = await fetch(path, merged);
  const d = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = "/login"; throw new Error("auth"); }
  if (res.status === 403) {
    const err = d.error || "forbidden";
    // C-10: Any missing/stale 2FA step-up should send the admin back to the 2FA gate.
    if (err === "2fa_required" || err === "2fa_setup_required" || err === "2fa_stale") {
      location.href = "/admin";
      throw new Error("2fa");
    }
    const el = document.getElementById("panel") || document.getElementById("loading") || document.querySelector(".wrap");
    if (el) { el.innerHTML = "<p style='padding:24px;font-family:system-ui'>Not an admin account. <a href='/dashboard'>Back to dashboard</a></p>"; el.hidden = false; }
    throw new Error("forbidden");
  }
  return d;
}

async function init() {
  const me = await api("/api/auth/me");
  if (!me.ok || !me.user) { location.href = "/login"; return; }
  $("userEmail").textContent = me.user.email;
  const [ov] = await Promise.all([api("/api/admin/overview")]); // 403s here for non-admins
  $("s_users").textContent = ov.users; $("s_pro").textContent = ov.pro;
  $("s_leads").textContent = ov.leads; $("s_rev").textContent = "$" + Number(ov.revenue || 0).toLocaleString();
  await Promise.all([loadUsers(), loadLeads(), loadPayments(), loadSupport(), loadIdentity(), loadFeatures(), loadAudit()]);
  $("loading").hidden = true; $("panel").hidden = false;
}

async function loadIdentity() {
  try {
    const d = await api("/api/admin/identity");
    if (!d.ok) return;
    const i = d.identity || {};
    $("i_company_name").value = i.company_name || "";
    $("i_company_country").value = i.company_country || "";
    $("i_company_number").value = i.company_number || "";
    $("i_support_email").value = i.support_email || "";
    $("i_affiliate_disclosure").value = i.affiliate_disclosure || "";
    const status = $("identityStatus");
    if (!i.complete) {
      status.hidden = false;
      status.textContent = "Company name and country are required before launch.";
      status.className = "status status--bad";
    } else {
      status.hidden = true;
    }
  } catch (e) {
    console.error("loadIdentity failed", e);
  }
}

$("identityForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  btn.disabled = true;
  const status = $("identityStatus");
  status.hidden = false;
  status.textContent = "Saving...";
  status.className = "status";
  try {
    const body = {
      company_name: $("i_company_name").value.trim(),
      company_country: $("i_company_country").value.trim(),
      company_number: $("i_company_number").value.trim(),
      support_email: $("i_support_email").value.trim(),
      affiliate_disclosure: $("i_affiliate_disclosure").value.trim(),
    };
    const d = await api("/api/admin/identity", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!d.ok) {
      status.textContent = d.error || "Failed to save.";
      status.className = "status status--bad";
      btn.disabled = false;
      return;
    }
    status.textContent = "Saved. Legal pages and footers now use these details.";
    status.className = "status status--good";
    if (!d.identity?.complete) {
      status.textContent += " Company name and country are still required before launch.";
      status.className = "status status--bad";
    }
  } catch {
    status.textContent = "Network error. Try again.";
    status.className = "status status--bad";
  }
  btn.disabled = false;
});

function pill(text, tone) {
  return `<span class="pill pill--${tone || "muted"}">${esc(text)}</span>`;
}

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => { const on = x === t; x.classList.toggle("is-on", on); x.setAttribute("aria-selected", String(on)); });
    document.querySelectorAll(".tabpane").forEach((p) => (p.hidden = p.id !== "tab-" + t.dataset.tab));
  }));

  // A11Y-003: Arrow-key navigation for tablist
  document.querySelector('[role="tablist"]')?.addEventListener('keydown', (e) => {
    const tabs = [...document.querySelectorAll('.tab')];
    const idx = tabs.indexOf(document.activeElement);
    if (idx === -1) return;
    let next;
    if (e.key === 'ArrowRight') next = tabs[(idx + 1) % tabs.length];
    else if (e.key === 'ArrowLeft') next = tabs[(idx - 1 + tabs.length) % tabs.length];
    else if (e.key === 'Home') next = tabs[0];
    else if (e.key === 'End') next = tabs[tabs.length - 1];
    if (next) { e.preventDefault(); next.click(); next.focus(); }
  });

let userFilters = { q: "", status: "all", plan: "all" };

async function loadUsers(page) {
  page = page || 1;
  const qs = new URLSearchParams({ page: String(page), q: userFilters.q, status: userFilters.status, plan: userFilters.plan });
  const d = await api("/api/admin/users?" + qs.toString());
  const rows = d.users || [];
  $("usersEmpty").hidden = rows.length > 0;
  $("usersBody").innerHTML = rows.map((u) => {
    const plan = String(u.plan || "free").toLowerCase();
    const paid = ["pro", "team"].includes(plan) && u.plan_expires_at && Number(u.plan_expires_at) > Date.now();
    let planTxt = "free";
    if (paid) {
      planTxt = plan + " · until " + when(u.plan_expires_at);
    }
    const totp = u.totp_enabled ? (u.totp_locked_until ? "locked" : "on") : "off";
    const reasonAttr = u.suspension_reason ? ` title="Reason: ${esc(u.suspension_reason)}"` : "";
    return `<tr>
<td>${esc(u.email)}${u.is_admin ? " " + pill("admin", "info") : ""}</td>
<td>${u.slug ? `<a href="/${esc(u.slug)}" target="_blank">/${esc(u.slug)}</a>` : "–"}</td>
<td>${pill(planTxt, paid ? "good" : "muted")}</td>
<td${reasonAttr}>${pill(u.status, u.status === "active" ? "good" : "bad")}</td>
<td>${pill(totp, totp === "on" ? "good" : totp === "locked" ? "bad" : "muted")}</td>
<td class="ta-r">${u.player_count ?? 0}</td>
<td>${when(u.created_at)}</td>
<td class="actions">
<button class="btn btn--xs" data-act="pro" data-id="${u.id}" title="Activate/extend Pro 31 days">+31d Pro</button>
<button class="btn btn--xs" data-act="free" data-id="${u.id}" title="Downgrade to Free">Free</button>
${u.status === "suspended"
  ? `<button class="btn btn--xs" data-act="unsuspend" data-id="${u.id}">Unsuspend</button>`
  : `<button class="btn btn--xs btn--danger" data-act="suspend" data-id="${u.id}">Suspend</button>`}
<button class="btn btn--xs" data-act="reset-link" data-id="${u.id}" title="Generate a 24h password reset link">Reset link</button>
</td></tr>`;
  }).join("");
  $("usersBody").querySelectorAll("button[data-act]").forEach((b) => b.addEventListener("click", () => action(b)));
  const totalPages = Math.max(1, Math.ceil((d.total || 0) / (d.pageSize || 50)));
  const pagEl = $("usersPagination");
  if (pagEl) {
    if (totalPages <= 1) { pagEl.innerHTML = ""; return; }
    const prevDis = page <= 1 ? "disabled" : "";
    const nextDis = page >= totalPages ? "disabled" : "";
    pagEl.innerHTML = `<span class="hint" style="margin-right:auto">${d.total || 0} users · page ${page} of ${totalPages}</span>` +
      `<button class="btn btn--sm btn--ghost" id="usersPagPrev" ${prevDis}>← Previous</button>` +
      `<button class="btn btn--sm btn--ghost" id="usersPagNext" ${nextDis}>Next →</button>`;
    $("usersPagPrev")?.addEventListener("click", () => loadUsers(page - 1));
    $("usersPagNext")?.addEventListener("click", () => loadUsers(page + 1));
  }
}

async function action(btn) {
  const act = btn.dataset.act, userId = btn.dataset.id;
  if (act === "suspend") {
    if (!await showConfirmModal("Suspend account", "Their page goes offline and they can't sign in. Existing viewers can still spend credits, but new earnings stop.", "Suspend", true)) return;
    const reason = await showPromptModal("Suspension reason", "Why is this account being suspended?", { confirmText: "Confirm suspend", placeholder: "e.g. ToS violation / chargeback" });
    if (!reason) return;
    btn.dataset.reason = reason;
  }
  if (act === "free" && !await showConfirmModal("Downgrade to Free", "Their paid features stop immediately. Existing data stays, but rewards, broadcasts and shop items may exceed Free limits.", "Downgrade", true)) return;
  btn.disabled = true;
  try {
    const body = { userId, action: act };
    if (act === "pro") {
      const amt = await showPromptModal("Activate Pro plan", "Amount they paid you in USD (for the revenue ledger — 0 if comped):", { confirmText: "Activate", inputType: "number", defaultValue: "29" });
      if (amt === null) { btn.disabled = false; return; }
      body.amountUsd = Number(amt) || 0;
    }
    if (act === "suspend" && btn.dataset.reason) { body.reason = btn.dataset.reason; delete btn.dataset.reason; }
    const d = await api("/api/admin/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!d.ok) { showToast(d.error || "Failed"); btn.disabled = false; return; }
    if (act === "reset-link") {
      showToast(d.message || "Reset link generated. Deliver it via email.", "success");
      btn.disabled = false;
      return;
    }
    await loadUsers();
    const ov = await api("/api/admin/overview");
    $("s_pro").textContent = ov.pro; $("s_rev").textContent = "$" + Number(ov.revenue || 0).toLocaleString();
  } catch { btn.disabled = false; }
}

async function loadLeads(page) {
  page = page || 1;
  const d = await api("/api/admin/leads?page=" + page);
  const rows = d.leads || [];
  $("leadsEmpty").hidden = rows.length > 0;
  $("leadsBody").innerHTML = rows.map((l) =>
    `<tr><td>${esc(l.handle)}</td><td>${esc(l.casino)}</td><td>${esc(l.contact)}</td><td class="note">${esc(l.note)}</td><td>${when(l.created_at)}</td></tr>`
  ).join("");
  renderPag("leadsPagination", d, page, loadLeads);
}

async function loadPayments(page) {
  page = page || 1;
  const d = await api("/api/admin/payments?page=" + page);
  const rows = d.payments || [];
  $("payEmpty").hidden = rows.length > 0;
  $("payBody").innerHTML = rows.map((p) => {
    const tone = ["finished", "manual"].includes(p.status) ? "good" : ["failed", "expired", "refunded"].includes(p.status) ? "bad" : "muted";
    return `<tr><td>${esc(p.email || p.user_id)}</td><td>${esc(p.provider)}</td><td class="ta-r">$${Number(p.amount_usd).toFixed(2)}</td><td>${pill(p.status, tone)}</td><td>${when(p.created_at)}</td></tr>`;
  }).join("");
  renderPag("payPagination", d, page, loadPayments);
}

let supportMessages = {};
let supportPage = 1;

async function loadSupport(page, status) {
  page = page || 1;
  supportPage = page;
  const statusFilter = status || $("supportFilter").value || "all";
  const d = await api(`/api/admin/support?status=${encodeURIComponent(statusFilter)}&page=${page}`);
  const rows = d.messages || [];
  supportMessages = Object.fromEntries(rows.map((m) => [m.id, m]));
  $("supportEmpty").hidden = rows.length > 0;
  $("supportBody").innerHTML = rows.map((m) =>
    `<tr>
      <td>${when(m.created_at)}</td>
      <td>${esc(m.name)}<br><small class="muted">${esc(m.email)}</small></td>
      <td>${esc(m.subject)}</td>
      <td>${pill(m.replied_at ? "replied" : "pending", m.replied_at ? "good" : "muted")}</td>
      <td><button class="btn btn--xs" data-reply="${m.id}">${m.replied_at ? "View" : "Reply"}</button></td>
    </tr>`
  ).join("");
  $("supportBody").querySelectorAll("button[data-reply]").forEach((b) => b.addEventListener("click", () => openReply(b.dataset.reply)));
  renderPag("supportPagination", d, page, loadSupport);
}

function openReply(id) {
  const m = supportMessages[id];
  if (!m) return;
  $("replyId").value = m.id;
  $("replyToEmail").textContent = m.email;
  $("replySubject").textContent = m.subject;
  $("replyMessage").textContent = m.message;
  $("replyText").value = m.reply || "";
  $("replyStatus").textContent = "";
  $("replyCancel").hidden = false;
  $("supportReplyCard").hidden = false;
  $("supportReplyCard").scrollIntoView({ behavior: "smooth" });
}

async function submitReply(e) {
  e.preventDefault();
  const id = $("replyId").value;
  const reply = $("replyText").value.trim();
  if (!reply) return;
  const btn = e.submitter;
  btn.disabled = true;
  $("replyStatus").textContent = "Sending...";
  try {
    const d = await api("/api/admin/support/reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, reply }) });
    if (!d.ok) {
      $("replyStatus").textContent = d.error || "Failed to send reply.";
      btn.disabled = false;
      return;
    }
    $("replyStatus").textContent = "Reply sent" + (d.emailSent ? " by email" : " (email not configured)") + ".";
    await loadSupport(supportPage);
    setTimeout(() => { $("supportReplyCard").hidden = true; $("replyText").value = ""; }, 1500);
  } catch {
    $("replyStatus").textContent = "Network error. Try again.";
    btn.disabled = false;
  }
}

$("replyForm")?.addEventListener("submit", submitReply);
$("replyCancel")?.addEventListener("click", () => { $("supportReplyCard").hidden = true; });
$("supportFilter")?.addEventListener("change", () => loadSupport(1, $("supportFilter").value));

$("usersFilterApply")?.addEventListener("click", () => {
  userFilters.q = $("usersSearch").value.trim();
  userFilters.status = $("usersStatusFilter").value;
  userFilters.plan = $("usersPlanFilter").value;
  loadUsers(1);
});
$("usersSearch")?.addEventListener("keydown", (e) => { if (e.key === "Enter") $("usersFilterApply").click(); });

async function loadFeatures() {
  const d = await api("/api/admin/features");
  const rows = d.flags || [];
  $("featuresEmpty").hidden = rows.length > 0;
  $("featuresBody").innerHTML = rows.map((f) =>
    `<tr>
      <td>${esc(f.key)}</td>
      <td>${esc(f.name || f.key)}<br><small class="muted">${esc(f.description || "")}</small></td>
      <td>${pill(f.defaultValue ? "on" : "off", f.defaultValue ? "good" : "muted")}</td>
      <td><input class="input" type="text" data-feature-override-user="${esc(f.key)}" placeholder="user ID" style="min-width:140px" /></td>
      <td><button class="btn btn--xs" data-feature-override="${esc(f.key)}">Set override</button></td>
    </tr>`
  ).join("");
  $("featuresBody").querySelectorAll("[data-feature-override]").forEach((b) => b.addEventListener("click", () => setFeatureOverride(b)));
}

async function setFeatureOverride(btn) {
  const key = btn.dataset.featureOverride;
  const input = $("featuresBody").querySelector(`[data-feature-override-user="${key}"]`);
  const userId = input?.value.trim();
  if (!userId) { showToast("Enter a user ID"); return; }
  const enabled = await showConfirmModal("Override feature flag", `Enable "${key}" for user ${userId}? Click Cancel to disable it.`, "Enable", false);
  const d = await api("/api/admin/features/override", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, featureKey: key, enabled }) });
  if (!d.ok) { showToast(d.error || "Failed"); return; }
  showToast(`Override ${enabled ? "enabled" : "disabled"} for ${userId}.`, "success");
}

async function loadAudit(page) {
  page = page || 1;
  const d = await api("/api/admin/audit?page=" + page);
  const rows = d.events || [];
  $("auditEmpty").hidden = rows.length > 0;
  $("auditBody").innerHTML = rows.map((e) => {
    const details = e.details && typeof e.details === "object" ? Object.entries(e.details).map(([k, v]) => `${esc(k)}: ${esc(String(v))}`).join("; ") : "";
    return `<tr>
      <td>${when(e.created_at)}</td>
      <td>${esc(e.actor_email || "system")}</td>
      <td>${esc(e.action)}</td>
      <td>${esc(e.entity_id || "—")}</td>
      <td><small class="muted">${esc(details)}</small></td>
    </tr>`;
  }).join("");
  renderPag("auditPagination", d, page, loadAudit);
}

function renderPag(containerId, data, page, loadFn) {
  const el = $(containerId);
  if (!el) return;
  const totalPages = Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || 50)));
  if (totalPages <= 1) { el.innerHTML = ""; return; }
  const prevDis = page <= 1 ? "disabled" : "";
  const nextDis = page >= totalPages ? "disabled" : "";
  el.innerHTML = `<span class="hint" style="margin-right:auto">${data.total || 0} items · page ${page} of ${totalPages}</span>` +
    `<button class="btn btn--sm btn--ghost" ${prevDis} data-pag="-1">← Previous</button>` +
    `<button class="btn btn--sm btn--ghost" ${nextDis} data-pag="1">Next →</button>`;
  el.querySelectorAll("[data-pag]").forEach(b => b.addEventListener("click", () => loadFn(page + Number(b.dataset.pag))));
}

$("logout").addEventListener("click", async (e) => { e.preventDefault(); await fetch("/api/auth/logout", { method: "POST", credentials: "include", headers: { "x-csrf-token": getCsrf() } }); location.href = "/login"; });
init();
