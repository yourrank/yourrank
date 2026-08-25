// Account page entry point: profile, plan, postbacks, danger zone.
import "./dashboard/help-drawer.js";
import { $, esc, getCsrf, logError, copyToClipboard, flashButton, showConfirmModal } from "./dashboard/utils.js";
import { state } from "./dashboard/state.js";
import { wireAccount } from "./dashboard/account.js";
import { wireDeleteAccountModal } from "./dashboard/account-delete-modal.js";
import { registerRouteRenderer, requestDashboardRoute, syncRouteChrome } from "./dashboard/shell.js";
import { renderReferrals } from "./dashboard/referrals.js";
import { checkout, renderPlan, loadHistory, loadPlanUsage, wireCancelSubscription } from "./dashboard/site.js";
import { getMe, handleAuthError } from "./dashboard/session.js";
import { parseDynamicPath } from "./dashboard/routes.js";

const statusEl = () => $("status");
let _accountPopstate = null;
let _unregisterRenderer = null;
let teamSiteId = "";
function setStatus(message, isError) {
  const el = statusEl();
  if (!el) return;
  el.textContent = message;
  el.className = isError ? "toast toast--error" : "toast toast--success";
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 4000);
}

async function jsonReq(method, path, body = null) {
  const headers = { "x-csrf-token": getCsrf() };
  if (body) headers["content-type"] = "application/json";
  const options = { method, credentials: "include", headers };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(path, options);
  let data = {};
  if (res.headers.get("content-type")?.includes("application/json")) {
    data = await res.json().catch(() => ({}));
  }
  return { ok: res.ok && data.ok, status: res.status, data };
}

function renderConversions(rows) {
  const body = $("conversionsBody");
  const empty = $("conversionsEmpty");
  const table = $("conversionsTable");
  if (!body || !empty || !table) return;
  if (!rows || rows.length === 0) {
    table.hidden = true;
    empty.hidden = false;
    return;
  }
  table.hidden = false;
  empty.hidden = true;
  body.innerHTML = rows.map((r) => `
    <tr>
      <td>${esc(r.at || "—")}</td>
      <td>${esc(r.event || "—")}</td>
      <td>${esc(r.amount != null ? Number(r.amount).toFixed(2) : "—")}</td>
      <td>${esc(r.currency || "—")}</td>
      <td>${esc(r.offer || "—")}</td>
    </tr>
  `).join("");
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function renderPostback(pb, status, upgrade) {
  const statusCard = $("postbackStatusCard");
  const shareCard = $("postbackShareCard");
  const keyCard = $("postbackKeyCard");
  const advanced = $("postbackAdvanced");
  const upgradeEl = $("postbackUpgrade");
  if (!statusCard || !shareCard || !keyCard || !advanced || !upgradeEl) return;

  if (upgrade) {
    statusCard.hidden = true;
    shareCard.hidden = true;
    keyCard.hidden = true;
    advanced.hidden = true;
    upgradeEl.hidden = false;
    return;
  }
  upgradeEl.hidden = true;

  if (!pb) {
    statusCard.hidden = false;
    shareCard.hidden = true;
    keyCard.hidden = true;
    advanced.hidden = true;
    const dot = $("postbackStatusDot");
    const text = $("postbackStatusText");
    const hint = $("postbackStatusHint");
    if (dot) dot.className = "status-dot status-dot--off";
    if (text) text.textContent = "Not configured";
    if (hint) hint.textContent = "Create a deposit tracking key to start receiving sign-up updates.";
    return;
  }

  statusCard.hidden = false;
  shareCard.hidden = false;
  keyCard.hidden = false;
  advanced.hidden = false;

  const active = status === "active";
  const dot = $("postbackStatusDot");
  const text = $("postbackStatusText");
  const hint = $("postbackStatusHint");
  if (dot) dot.className = `status-dot ${active ? "status-dot--ok" : "status-dot--pending"}`;
  if (text) text.textContent = active ? "Active — receiving conversions" : "Pending — no conversion received yet";
  if (hint) hint.textContent = active
    ? `Last conversion received: ${fmtDateTime(pb.lastUsedAt)}`
    : `Key created: ${fmtDateTime(pb.createdAt)}. Send the setup block below to your affiliate manager.`;

  $("postbackSigned").textContent = pb.signedEndpoint;
  $("postbackKey").textContent = pb.key;
  $("postbackLegacy").textContent = pb.legacyUrl;
}

async function loadPostbacks() {
  try {
    const res = await fetch("/api/account/postbacks", { credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      setStatus(data.error || "Could not load deposit tracking.", true);
      return;
    }
    renderPostback(data.postback, data.status, data.upgrade);
    renderConversions(data.conversions);
  } catch (e) {
    logError("loadPostbacks", e);
    setStatus("Could not load deposit tracking. Try again.", true);
  }
}

function wireCopy(id, sourceId) {
  const btn = $(id);
  const source = $(sourceId);
  if (!btn || !source) return;
  btn.addEventListener("click", async () => {
    const ok = await copyToClipboard(source.textContent || "");
    flashButton(btn, ok ? "Copied!" : "Copy failed");
  });
}

function wirePostbacks() {
  wireCopy("postbackCopySigned", "postbackSigned");
  wireCopy("postbackCopyKey", "postbackKey");
  wireCopy("postbackCopyLegacy", "postbackLegacy");

  const manager = $("postbackCopyManager");
  if (manager) {
    manager.addEventListener("click", async () => {
      const signed = $("postbackSigned");
      if (!signed) return;
      const text = `Deposit tracking link: ${signed.textContent}\nMethod: POST\nSign the raw query string with HMAC-SHA256 using your deposit tracking key, then send the hex signature in the X-Postback-Signature header.\nAlso include X-Postback-Key with your key.\nLegacy unsigned link: ${$("postbackLegacy")?.textContent || "deprecated"} (sunset ${$("postbackLegacy")?.textContent ? "2026-10-01" : ""})`;
      const ok = await copyToClipboard(text);
      flashButton(manager, ok ? "Copied!" : "Copy failed");
    });
  }

  const rotate = $("postbackRotate");
  const revoke = $("postbackRevoke");

  if (rotate) {
    rotate.addEventListener("click", async () => {
      if (!await showConfirmModal("Rotate deposit tracking key", "This will revoke the existing key immediately. Any sign-up updates using the old key will fail.", "Rotate", true)) return;
      rotate.disabled = true;
      const result = await jsonReq("POST", "/api/account/postbacks/rotate");
      rotate.disabled = false;
      if (result.ok && result.data.postback) {
        renderPostback(result.data.postback, "pending", false);
        setStatus("Deposit tracking key rotated.", false);
      } else {
        setStatus(result.data?.error || "Could not rotate key.", true);
      }
    });
  }

  if (revoke) {
    revoke.addEventListener("click", async () => {
      if (!await showConfirmModal("Revoke deposit tracking key", "Score updates will stop until a new key is created.", "Revoke", true)) return;
      revoke.disabled = true;
      const result = await jsonReq("DELETE", "/api/account/postbacks");
      revoke.disabled = false;
      if (result.ok) {
        renderPostback(null, "not_configured", false);
        renderConversions([]);
        setStatus("Deposit tracking key revoked.", false);
      } else {
        setStatus(result.data?.error || "Could not revoke key.", true);
      }
    });
  }

  const testBtn = $("postbackTest");
  const testStatus = $("postbackTestStatus");
  if (testBtn) {
    testBtn.addEventListener("click", async () => {
      testBtn.disabled = true;
      if (testStatus) { testStatus.textContent = "Sending test conversion…"; testStatus.className = "hint"; }
      const result = await jsonReq("POST", "/api/account/postbacks/test");
      testBtn.disabled = false;
      if (result.ok) {
        if (testStatus) { testStatus.textContent = result.data.message; testStatus.className = "hint hint--success"; }
        await loadPostbacks();
      } else {
        if (testStatus) { testStatus.textContent = result.data?.error || "Test failed."; testStatus.className = "hint hint--error"; }
      }
    });
  }
}

function currentTab() {
  return document.getElementById("acc-app")?.dataset?.accTab || "";
}

function settingsTab() {
  return document.getElementById("acc-app")?.dataset?.settingsActive || "account";
}

function wireUnifiedSettingsTabs() {
  const root = document.getElementById("acc-app");
  if (!root || currentTab() !== "settings") return;
  const tabs = [...root.querySelectorAll("[data-settings-tab]")];
  const panels = [...root.querySelectorAll("[data-settings-panel]")];
  const select = (key) => {
    const active = tabs.some((tab) => tab.dataset.settingsTab === key) ? key : "account";
    const activeTab = tabs.find((tab) => tab.dataset.settingsTab === active);
    const description = root.querySelector("[data-settings-page-description]");
    tabs.forEach((tab) => {
      const on = tab.dataset.settingsTab === active;
      tab.classList.toggle("is-on", on);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.settingsPanel !== active; });
    if (description && activeTab?.dataset.settingsDescription) {
      description.textContent = activeTab.dataset.settingsDescription;
    }
  };
  // Tab clicks request the destination through the shell's navigation entry
  // point, which owns the URL, history and title; this section repaints its
  // panels through the registered renderer.
  _unregisterRenderer?.();
  _unregisterRenderer = registerRouteRenderer("settings", ({ tab }) => select(tab));
  tabs.forEach((tab) => tab.addEventListener("click", (event) => {
    event.preventDefault();
    requestDashboardRoute("settings", tab.dataset.settingsTab);
  }));
  tabs.forEach((tab, index) => tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[nextIndex].focus();
    requestDashboardRoute("settings", tabs[nextIndex].dataset.settingsTab);
  }));
  if (!window.__yrSpaShell) {
    // Standalone document: the persistent shell's popstate handling is not
    // installed, so Back/Forward is repainted here.
    _accountPopstate = () => {
      const tab = parseDynamicPath(location.pathname)?.tab || "account";
      select(tab);
      syncRouteChrome("settings", tab);
    };
    addEventListener("popstate", _accountPopstate);
  }
  select(settingsTab());
}

function setUserName() {
  const userName = $("accUserName");
  const email = state.ME?.email || "";
  const name = state.ME?.displayName || (email ? email.split("@")[0] : "Account");
  if (userName && state.ME) userName.textContent = state.ME.displayName || email || "Account";

  const sumName = $("accSummaryName");
  if (sumName && state.ME) sumName.textContent = name;
  const sumEmail = $("accSummaryEmail");
  if (sumEmail && email) sumEmail.textContent = email;
  const sumAvatar = $("accSummaryAvatar");
  if (sumAvatar && name) sumAvatar.textContent = name[0].toUpperCase();
  const sumPlan = $("accSummaryPlan");
  if (sumPlan && state.ME?.plan) sumPlan.textContent = (state.ME.plan.name || "Active").toUpperCase();
}

function renderConnectedAccounts(data) {
  const wrap = $("connectedAccounts");
  if (!wrap) return;
  if (!data || data.error) { wrap.innerHTML = `<p class="error">Could not load connected accounts.</p>`; return; }

  const kick = data.kick;
  const telegram = data.telegram;

  let html = "";
  if (kick || telegram) {
    html += `<div class="account-connection-list">`;
    if (kick) {
      const expiry = kick.tokenExpiresAt ? new Date(kick.tokenExpiresAt) : null;
      const needsAttention = !expiry || expiry <= new Date();
      html += `<div class="account-connection-row">
        <div><strong>Kick</strong><p>${kick.username ? `@${esc(kick.username)}` : "Creator account"}</p></div>
        <span class="account-connection-status${needsAttention ? " is-warning" : ""}">${needsAttention ? "Reconnect needed" : "Connected"}</span>
        <a class="btn btn--sm ${needsAttention ? "btn--accent" : "btn--ghost"}" href="/dashboard/site/connections">${needsAttention ? "Reconnect" : "Manage"}</a>
      </div>`;
    }
    if (telegram) {
      html += `<div class="account-connection-row">
        <div><strong>Telegram</strong><p>${telegram.username ? `@${esc(telegram.username)}` : "Creator account"}</p></div>
        <span class="account-connection-status">Connected</span>
        <button class="btn btn--sm btn--ghost" type="button" id="tgDisconnect">Disconnect</button>
      </div>`;
    }
    html += `</div>`;
  } else {
    html += `<div class="empty account-connection-empty"><strong>No accounts connected</strong><p>Connect a creator account when you are ready to use its YourRank features.</p><div class="d-flex gap-8 flex-wrap"><a class="btn btn--accent" href="/dashboard/site/connections">Connect Kick</a><a class="btn btn--ghost" href="/dashboard/telegram">Connect Telegram</a></div></div>`;
  }

  wrap.innerHTML = html;

  $("tgDisconnect")?.addEventListener("click", async (e) => {
    if (!await showConfirmModal("Disconnect Telegram", "Telegram login and bot management for this account stop until you connect again.", "Disconnect", true)) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    const r = await jsonReq("POST", "/api/auth/telegram/unlink", {});
    if (r.ok && r.data?.ok) { loadConnectedAccounts(); return; }
    btn.disabled = false;
    setStatus(r.data?.error || "Could not disconnect Telegram. Try again.", true);
  });
}

async function loadConnectedAccounts() {
  const r = await jsonReq("GET", "/api/account/connected-accounts");
  renderConnectedAccounts(r.ok ? r.data : { error: r.data?.error || "failed" });
}

function renderTeam(data) {
  const membersEl = $("teamMembersList");
  const invitesEl = $("teamInvitesList");
  if (!membersEl || !invitesEl) return;

  if (data?.siteId) teamSiteId = data.siteId;

  if (!data || !data.ok) {
    membersEl.innerHTML = `<p class="hint">${esc(data?.error || "Could not load team members.")}</p>`;
    invitesEl.innerHTML = `<p class="hint">Unavailable</p>`;
    return;
  }

  const { members = [], invites = [], canManageTeam } = data;

  if (members.length === 0) {
    membersEl.innerHTML = `<div class="empty"><strong>No team members yet</strong><p>Invite someone when you are ready to share site management.</p></div>`;
  } else {
    membersEl.innerHTML = `
      <div class="account-team-list">
        ${members.map((member) => {
          const displayName = member.displayName || member.email.split("@")[0];
          return `
            <div class="account-team-row">
              <div class="account-team-person">
                <strong>${esc(displayName)}</strong>
                <span>${esc(member.email)} · Joined ${fmtDateTime(member.createdAt)}</span>
              </div>
              ${canManageTeam && member.role !== "owner" ? `
                <div class="account-team-actions">
                  <label class="sr-only" for="teamRole-${esc(member.userId)}">Role for ${esc(displayName)}</label>
                  <select class="field-select team-role-select" id="teamRole-${esc(member.userId)}" data-user-id="${esc(member.userId)}">
                    <option value="moderator" ${member.role === "moderator" ? "selected" : ""}>Moderator</option>
                    <option value="manager" ${member.role === "manager" ? "selected" : ""}>Manager</option>
                  </select>
                  <button class="btn btn--sm btn--ghost team-remove-btn" data-user-id="${esc(member.userId)}" type="button">Remove</button>
                </div>
              ` : `<span class="account-team-role">${member.role === "owner" ? "Owner" : esc(member.role)}</span>`}
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  if (invites.length === 0) {
    invitesEl.innerHTML = `<p class="hint">No pending invitations.</p>`;
  } else {
    invitesEl.innerHTML = `
      <div class="account-team-list">
        ${invites.map((invite) => `
          <div class="account-team-row">
            <div class="account-team-person">
              <strong>${esc(invite.email)}</strong>
              <span>${esc(invite.role)} · Expires ${fmtDateTime(invite.expiresAt)}</span>
            </div>
            <div class="account-team-actions">
              ${invite.inviteUrl
                ? `<button class="btn btn--sm btn--ghost team-copy-invite-btn" data-url="${esc(invite.inviteUrl)}" type="button">Copy link</button>`
                : '<span class="hint">Link shown when created</span>'}
              ${canManageTeam ? `<button class="btn btn--sm btn--ghost team-revoke-invite-btn" data-invite-id="${esc(invite.id)}" type="button">Revoke</button>` : ""}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  if (canManageTeam) {
    document.querySelectorAll(".team-role-select").forEach((sel) => {
      sel.addEventListener("change", async () => {
        const targetUserId = sel.getAttribute("data-user-id");
        const newRole = sel.value;
        sel.disabled = true;
        const res = await jsonReq("POST", "/api/site/team/role", { targetUserId, role: newRole, siteId: teamSiteId });
        if (res.ok) {
          setStatus("Role updated successfully");
          loadTeam();
        } else {
          setStatus(res.data?.error || "Failed to update role", true);
          loadTeam();
        }
      });
    });

    document.querySelectorAll(".team-remove-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!await showConfirmModal("Remove team member", "They will lose access to this site. You can invite them again later.", "Remove member", true)) return;
        const targetUserId = btn.getAttribute("data-user-id");
        btn.disabled = true;
        btn.textContent = "Removing…";
        const res = await jsonReq("POST", "/api/site/team/remove", { targetUserId, siteId: teamSiteId });
        if (res.ok) {
          setStatus("Member removed");
          loadTeam();
        } else {
          setStatus(res.data?.error || "Failed to remove member", true);
          btn.disabled = false;
          btn.textContent = "Remove";
        }
      });
    });

    document.querySelectorAll(".team-revoke-invite-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!await showConfirmModal("Revoke invitation", "This invite link will stop working. You can create a new one later.", "Revoke invite", true)) return;
        const inviteId = btn.getAttribute("data-invite-id");
        btn.disabled = true;
        btn.textContent = "Revoking…";
        const res = await jsonReq("POST", "/api/site/team/invite/revoke", { inviteId, siteId: teamSiteId });
        if (res.ok) {
          setStatus("Invitation revoked");
          loadTeam();
        } else {
          setStatus(res.data?.error || "Failed to revoke invite", true);
          btn.disabled = false;
          btn.textContent = "Revoke";
        }
      });
    });
  }

  document.querySelectorAll(".team-copy-invite-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.getAttribute("data-url");
      if (url) {
        copyToClipboard(url);
        flashButton(btn, "Copied!");
      }
    });
  });
}

async function loadTeam() {
  const selectedSiteId = state.ACTIVE_SITE_ID
    || new URLSearchParams(location.search).get("siteId")
    || teamSiteId
    || "";
  const teamUrl = selectedSiteId
    ? `/api/site/team?siteId=${encodeURIComponent(selectedSiteId)}`
    : "/api/site/team";
  const r = await jsonReq("GET", teamUrl);
  renderTeam(r.ok ? r.data : { ok: false, error: r.data?.error || "Failed to load team" });
}

function wireTeam() {
  const openBtn = $("btnOpenInviteModal");
  const modal = $("inviteMemberModal");
  const closeBtn = $("btnCloseInviteModal");
  const sendBtn = $("btnSendInvite");
  const emailInput = $("inviteEmail");
  const roleSelect = $("inviteRole");
  const statusEl = $("inviteModalStatus");
  const resultWrap = $("inviteResultWrap");
  const linkInput = $("inviteLinkInput");
  const copyBtn = $("btnCopyInviteLink");

  if (!openBtn || !modal) return;
  let returnFocus = null;
  const closeModal = () => {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    loadTeam();
    returnFocus?.focus();
  };

  openBtn.addEventListener("click", () => {
    returnFocus = document.activeElement;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    if (emailInput) emailInput.value = "";
    if (statusEl) statusEl.textContent = "";
    if (resultWrap) resultWrap.hidden = true;
    if (sendBtn) sendBtn.disabled = false;
    emailInput?.focus();
  });

  closeBtn?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...modal.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]")].filter((el) => !el.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  sendBtn?.addEventListener("click", async () => {
    const email = emailInput?.value?.trim();
    const role = roleSelect?.value || "moderator";
    if (!email || !email.includes("@")) {
      if (statusEl) statusEl.textContent = "Please enter a valid email.";
      emailInput?.focus();
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = "Creating…";

    const res = await jsonReq("POST", "/api/site/team/invite", { email, role, siteId: teamSiteId });
    sendBtn.disabled = false;
    sendBtn.textContent = "Create invite";

    if (res.ok) {
      if (statusEl) statusEl.textContent = "Invitation ready!";
      if (resultWrap && linkInput) {
        linkInput.value = res.data?.inviteUrl || "";
        resultWrap.hidden = false;
      }
      loadTeam();
    } else {
      if (statusEl) statusEl.textContent = res.data?.error || "Failed to create invitation.";
    }
  });

  copyBtn?.addEventListener("click", () => {
    if (linkInput?.value) {
      copyToClipboard(linkInput.value);
      flashButton(copyBtn, "Copied!");
    }
  });
}

async function init() {
  let me;
  try {
    me = await getMe();
  } catch (err) {
    handleAuthError(err);
    logError("auth/me", err);
    return;
  }
  if (!me) { location.href = "/login"; return; }
  state.ME = me;
  setUserName();
  // One settings document holds every panel, so everything is wired once.
  wireUnifiedSettingsTabs();
  wireAccount();
  wireTeam();
  await loadTeam();
  renderPlan();
  const plan = new URLSearchParams(location.search).get("plan")?.toLowerCase();
  if (["starter", "pro", "lifetime"].includes(plan)) checkout(plan);
  loadPlanUsage();
  renderReferrals();
  loadHistory();
  wireCancelSubscription();
  await loadPostbacks();
  wirePostbacks();
  await loadConnectedAccounts();
  wireDeleteAccountModal();
}

// Auto-init only on a standalone document load (direct URL / refresh).
// When the persistent SPA shell is active, enter() is called explicitly.
if (document.getElementById("acc-app") && !window.__yrSpaShell) init();

// ---- Persistent-shell lifecycle ----
export function enter() {
  // Re-initialize against the freshly injected fragment DOM.
  init();
}
export function leave() {
  // Remove the document-level popstate listener that wireUnifiedSettingsTabs
  // installed, so repeated enter/leave cycles do not stack duplicate handlers.
  if (_accountPopstate) {
    removeEventListener("popstate", _accountPopstate);
    _accountPopstate = null;
  }
  // Release the route renderer so the shell fetches the fragment fresh on the
  // next entry instead of painting into a torn-down DOM.
  _unregisterRenderer?.();
  _unregisterRenderer = null;
}
