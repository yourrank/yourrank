import { showConfirmModal } from "./dashboard/utils.js";
import { loadBoardShell, preserveSiteContextLinks, sitePath } from "./dashboard/board-shell.js";
import { fetchDashboardJson, loginRedirectPath } from "./dashboard/request.js";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));
const csrf = () => document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] || "";
const fmtDate = (value) => value ? new Date(value).toLocaleString() : "—";
const relative = (value) => {
  if (!value) return "—";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
};

let memberModule;
let activeSiteId = "";
let activeFilter = "pending";
let selectedReview;
let reviewRelease;
let reviewTrigger;
let listeners;
let decisionPending = false;

async function request(path, init = {}) {
  try {
    const { body } = await fetchDashboardJson(sitePath(path, activeSiteId), {
      credentials: "same-origin",
      ...init,
    });
    return body;
  } catch (error) {
    if (error?.code === "AUTH") location.href = loginRedirectPath(location);
    throw error;
  }
}

function setStatus(message, error = false) {
  const status = $("people-reviews-status");
  if (!status) return;
  status.textContent = message;
  status.className = error ? "status error" : "status";
  const retry = $("people-reviews-retry");
  if (retry) retry.hidden = !error;
}

function setLoading(loading) {
  const region = $("people-reviews-loading");
  const queue = document.querySelector(".people-review-queue");
  if (region) region.hidden = !loading;
  if (queue) {
    queue.toggleAttribute("aria-busy", loading);
    queue.classList.toggle("is-loading", loading);
  }
}

function statusChip(review) {
  return review.status === "pending"
    ? '<span class="v3-chip v3-chip--pending">Needs review</span>'
    : `<span class="v3-chip v3-chip--refunded">${review.decision === "allow" ? "Allowed" : "Excluded"}</span>`;
}

function renderReviews(data) {
  const list = $("people-reviews-list");
  const empty = $("people-reviews-empty");
  const table = $("people-reviews-table-wrap");
  const reviews = data.reviews || [];
  if ($("people-reviews-pending-count")) $("people-reviews-pending-count").textContent = data.counts?.pending ?? 0;
  if (!list || !empty || !table) return;
  list.innerHTML = reviews.map((review) => `<tr>
    <td data-label="Participant"><strong>${esc(review.subject.displayName)}</strong>${review.subject.memberDisplayName ? `<span class="people-review-secondary">${esc(review.subject.memberDisplayName)}</span>` : ""}</td>
    <td data-label="Review reason"><strong>${esc(review.reason.label)}</strong><span class="people-review-secondary">${esc(review.typeLabel)}</span></td>
    <td data-label="Signup"><strong>${esc(review.source.title)}</strong><time datetime="${esc(review.createdAt)}" title="${esc(fmtDate(review.createdAt))}">${esc(relative(review.createdAt))}</time></td>
    <td data-label="Status">${statusChip(review)}</td>
    <td data-label="Actions" class="ta-r"><button class="btn btn--sm" type="button" data-open-review="${esc(review.id)}" aria-controls="people-review-drawer" aria-expanded="false">View review</button></td>
  </tr>`).join("");
  table.hidden = reviews.length === 0;
  empty.hidden = reviews.length > 0;
  const title = empty.querySelector("h3");
  const body = empty.querySelector("p");
  if (title) title.textContent = activeFilter === "pending" ? "No reviews need your attention." : "No resolved reviews yet.";
  if (body) body.textContent = activeFilter === "pending"
    ? "New eligibility exceptions for this site will appear here."
    : "Decisions made for this site will appear here.";
}

async function loadReviews() {
  setLoading(true);
  setStatus("");
  try {
    const data = await request(`/api/people/reviews?status=${encodeURIComponent(activeFilter)}`);
    renderReviews(data);
    preserveSiteContextLinks(activeSiteId);
  } catch (error) {
    setStatus(error?.message || "Reviews could not be loaded. Try again.", true);
    const table = $("people-reviews-table-wrap");
    if (table) table.hidden = true;
  } finally {
    setLoading(false);
    window.__yrBoot?.signal();
  }
}

async function ensureDialog() {
  if (!window.YRDialog) await import("./dialog.js");
  return window.YRDialog;
}

function closeReview() {
  const drawer = $("people-review-drawer");
  const backdrop = $("people-review-backdrop");
  if (!drawer || drawer.hidden) return;
  reviewRelease?.();
  reviewRelease = undefined;
  drawer.hidden = true;
  backdrop.hidden = true;
  document.documentElement.classList.remove("yr-modal-open");
  reviewTrigger?.setAttribute("aria-expanded", "false");
  selectedReview = undefined;
}

function historyHtml(events) {
  return (events || []).map((event) => `<li><span class="people-review-history-dot" aria-hidden="true"></span><div><strong>${esc(event.label)}</strong><p>${event.actor ? `By ${esc(event.actor.name)}` : "System event"}</p><time datetime="${esc(event.createdAt)}">${esc(fmtDate(event.createdAt))}</time></div></li>`).join("");
}

function renderReviewDetail(review) {
  selectedReview = review;
  $("people-review-title").textContent = review.subject.displayName;
  $("people-review-description").textContent = `${review.source.title} · ${fmtDate(review.createdAt)}`;
  const membership = review.context.membership;
  const memberLink = membership
    ? `<a class="btn btn--sm" href="/dashboard/audience/members?siteId=${encodeURIComponent(activeSiteId)}&member=${encodeURIComponent(membership.id)}">View member</a>`
    : '<span class="people-review-muted">No signed-in site membership is linked to this signup.</span>';
  const identities = membership?.linkedIdentities?.length
    ? membership.linkedIdentities.map((identity) => `<li>${esc(identity.provider)}${identity.displayName ? ` · ${esc(identity.displayName)}` : ""}</li>`).join("")
    : "<li>No linked sign-in providers</li>";
  $("people-review-detail").innerHTML = `
    <section class="people-review-section"><div class="people-review-reason"><span aria-hidden="true">!</span><div><h3>${esc(review.reason.label)}</h3><p>${esc(review.reason.explanation)}</p></div></div></section>
    <section class="people-review-section"><h3>Signup context</h3><dl class="people-review-facts"><div><dt>Workflow</dt><dd>${esc(review.source.workflow)}</dd></div><div><dt>Tournament</dt><dd>${esc(review.source.title)}</dd></div><div><dt>Entry</dt><dd>Zero cost</dd></div><div><dt>Submitted</dt><dd>${esc(fmtDate(review.createdAt))}</dd></div></dl></section>
    <section class="people-review-section"><div class="people-review-section__head"><h3>Site membership</h3>${memberLink}</div>${membership ? `<p>Member since ${esc(fmtDate(membership.memberSince))}</p><ul class="people-review-identities">${identities}</ul>` : ""}</section>
    <aside class="people-review-guidance"><strong>Use context, not assumptions.</strong><p>${esc(review.context.guidance)}</p></aside>
    <section class="people-review-section"><h3>History</h3><ol class="people-review-history">${historyHtml(review.history)}</ol></section>`;
  const actions = $("people-review-actions");
  const allowedDecisions = Array.isArray(review.allowedDecisions)
    ? review.allowedDecisions
    : ["allow", "exclude"];
  const allowButton = $("people-review-allow");
  const excludeButton = $("people-review-exclude");
  if (allowButton) allowButton.hidden = !allowedDecisions.includes("allow");
  if (excludeButton) excludeButton.hidden = !allowedDecisions.includes("exclude");
  if (actions) actions.hidden = review.status !== "pending" || allowedDecisions.length === 0;
}

async function openReview(id, trigger) {
  const drawer = $("people-review-drawer");
  const backdrop = $("people-review-backdrop");
  if (!drawer || !backdrop) return;
  reviewTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");
  drawer.hidden = false;
  backdrop.hidden = false;
  document.documentElement.classList.add("yr-modal-open");
  $("people-review-detail").innerHTML = '<div class="people-review-detail-loading"><div class="ui-loading__spinner" aria-hidden="true"></div><span>Loading review…</span></div>';
  $("people-review-actions").hidden = true;
  if ($("people-review-decision-status")) $("people-review-decision-status").textContent = "";
  const dialog = await ensureDialog();
  reviewRelease = dialog.trap(drawer, closeReview);
  try {
    const data = await request(`/api/people/reviews/${encodeURIComponent(id)}`);
    renderReviewDetail(data.review);
  } catch (error) {
    $("people-review-detail").innerHTML = `<div class="v3-empty"><h3>Couldn't load this review</h3><p>${esc(error?.message || "Try again.")}</p></div>`;
  }
}

async function decide(decision) {
  if (decisionPending || !selectedReview || selectedReview.status !== "pending") return;
  decisionPending = true;
  const allow = decision === "allow";
  const allowButton = $("people-review-allow");
  const excludeButton = $("people-review-exclude");
  const button = allow ? allowButton : excludeButton;
  const original = button?.textContent || "";
  try {
    const confirmed = await showConfirmModal(
      allow ? "Allow this signup?" : "Exclude this signup?",
      allow
        ? "This allows only this participant signup in the named tournament."
        : "This excludes only this participant signup from the named tournament.",
      allow ? "Allow signup" : "Exclude signup",
      !allow,
    );
    if (!confirmed) return;
    const actions = $("people-review-actions");
    actions?.setAttribute("aria-busy", "true");
    if (allowButton) allowButton.disabled = true;
    if (excludeButton) excludeButton.disabled = true;
    if (button) button.textContent = "Saving…";
    await request(`/api/people/reviews/${encodeURIComponent(selectedReview.id)}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify(allow ? { decision: "allow" } : { decision: "exclude" }),
    });
    closeReview();
    await loadReviews();
    setStatus(allow ? "Signup allowed for this tournament." : "Signup excluded from this tournament.");
  } catch (error) {
    const message = error?.message || "The decision could not be saved.";
    setStatus(message, true);
    if ($("people-review-decision-status")) {
      $("people-review-decision-status").textContent = message;
      $("people-review-decision-status").className = "status error";
    }
  } finally {
    decisionPending = false;
    $("people-review-actions")?.removeAttribute("aria-busy");
    if (allowButton) allowButton.disabled = false;
    if (excludeButton) excludeButton.disabled = false;
    if (button) button.textContent = original;
  }
}

function wireReviews() {
  listeners?.abort();
  listeners = new AbortController();
  const signal = listeners.signal;
  document.querySelectorAll("[data-review-filter]").forEach((button) => button.addEventListener("click", async () => {
    activeFilter = button.dataset.reviewFilter;
    document.querySelectorAll("[data-review-filter]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    await loadReviews();
  }, { signal }));
  $("people-reviews-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-review]");
    if (button) openReview(button.dataset.openReview, button);
  }, { signal });
  $("people-reviews-retry")?.addEventListener("click", () => loadReviews(), { signal });
  $("people-review-close")?.addEventListener("click", closeReview, { signal });
  $("people-review-backdrop")?.addEventListener("click", closeReview, { signal });
  $("people-review-allow")?.addEventListener("click", () => decide("allow"), { signal });
  $("people-review-exclude")?.addEventListener("click", () => decide("exclude"), { signal });
}

async function enterMembers() {
  memberModule = await import("./credits.js");
  if (window.__yrSpaShell) return memberModule.enter?.();
}

async function enterReviews() {
  activeFilter = "pending";
  selectedReview = undefined;
  decisionPending = false;
  wireReviews();
  const shell = await loadBoardShell();
  activeSiteId = shell.activeSiteId;
  preserveSiteContextLinks(activeSiteId);
  await loadReviews();
}

export async function enter() {
  if ($("cr-app")?.dataset.crTab === "viewers") return enterMembers();
  if ($("people-reviews-app")) return enterReviews();
}

export function leave() {
  closeReview();
  decisionPending = false;
  listeners?.abort();
  listeners = undefined;
  memberModule?.leave?.();
}

if (!window.__yrSpaShell) enter().catch((error) => {
  setStatus(error?.message || "People could not be loaded.", true);
  window.__yrBoot?.signal();
});
