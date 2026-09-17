import { resolveContactType } from "./contact-context.js";

function initContactPage() {
// Contact form handling
const form = document.getElementById("contactForm");
const err = document.getElementById("c_err");
const success = document.getElementById("c_success");
const submit = document.getElementById("c_submit");
const kind = document.getElementById("c_kind");
const context = document.getElementById("c_context");
const title = document.getElementById("contactTitle");
const intro = document.getElementById("contactIntro");
const nameInput = document.getElementById("c_name");
const emailInput = document.getElementById("c_email");
const subjectInput = document.getElementById("c_subject");
const messageInput = document.getElementById("c_message");
const backWrap = document.getElementById("c_back_wrap");
const back = document.getElementById("c_back");
const requestIdInput = document.getElementById("c_request_id");
const fields = [nameInput, emailInput, subjectInput, messageInput].filter(Boolean);

const params = new URLSearchParams(location.search);
const helpApp = document.getElementById("help-app");
const helpTab = helpApp?.dataset?.helpTab;
const requestedType = params.get("type");
const serverType = kind?.value;
const requestedArea = params.get("area");
const requestedReturn = params.get("return");
const allowedAreas = new Set(["dashboard", "leaderboard", "bot", "analytics", "attribution", "billing", "account", "credits", "help"]);

function safeReturnTarget(value) {
  if (!value) return "";
  try {
    const url = new URL(value, location.origin);
    if (url.origin !== location.origin || !url.pathname.startsWith("/")) return "";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "";
  }
}

function applyContext() {
  const type = resolveContactType({ helpTab, queryType: requestedType, serverType });
  if (kind) kind.value = type;
  if (context) context.value = allowedAreas.has(requestedArea) ? requestedArea : "";
  if (title) title.textContent = type === "feedback" ? "Give feedback" : "Contact support";
  if (intro) {
    intro.textContent = type === "feedback"
      ? "Tell us what would make YourRank better. Every message reaches the product team."
      : "Tell us what went wrong or what you need help with. We'll reply by email.";
  }
  if (subjectInput) {
    subjectInput.placeholder = type === "feedback" ? "What could be better?" : "What do you need help with?";
  }
  if (messageInput) {
    messageInput.placeholder = type === "feedback"
      ? "Share an idea, frustration, or feature request..."
      : "Describe the problem and what you expected to happen...";
  }
  const safeReturn = safeReturnTarget(requestedReturn);
  if (safeReturn && back && backWrap) {
    back.href = safeReturn;
    backWrap.hidden = false;
  }
}

applyContext();

// A creator session must not prefill a form opened from a viewer page.
if (params.get("audience") !== "viewer") fetch("/api/auth/me")
  .then((res) => res.ok ? res.json() : null)
  .then((body) => {
    if (!body?.user) return;
    if (nameInput && !nameInput.value && body.user.displayName) nameInput.value = body.user.displayName;
    if (emailInput && !emailInput.value) emailInput.value = body.user.email || "";
  })
  .catch(() => {});

function getCsrf() {
  const m = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

const REQUEST_TIMEOUT_MS = 15000;
const TIMEOUT_MESSAGE = "No reply from the server after 15 seconds, so we kept your draft. Sending again is safe: the same message is stored once even if the first attempt did arrive.";
const NETWORK_MESSAGE = "Could not reach the server, so nothing was sent. Check your connection and try again; your draft is still here.";
const FIELD_LABELS = { c_name: "Name", c_email: "Email", c_subject: "Subject", c_message: "Message" };

function fieldMessage(input) {
  const label = FIELD_LABELS[input.id] || "This field";
  const v = input.validity;
  if (v.valueMissing) return `${label} is required.`;
  if (v.typeMismatch) return "Enter an email address like name@example.com.";
  if (v.tooShort) return `${label} must be at least ${input.minLength} characters (currently ${input.value.trim().length}).`;
  if (v.tooLong) return `${label} must be ${input.maxLength} characters or fewer.`;
  return input.validationMessage || `${label} is not valid.`;
}

function setFieldError(input, text) {
  const el = document.getElementById(`${input.id}_err`);
  if (el) el.textContent = text || "";
  if (text) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

function clearFieldErrors() {
  fields.forEach((input) => setFieldError(input, ""));
}

// Native constraints stay the source of truth; the browser bubble is replaced
// by a durable inline error tied to the field through aria-describedby.
function showInvalidFields() {
  const invalid = fields.filter((input) => !input.checkValidity());
  invalid.forEach((input) => setFieldError(input, fieldMessage(input)));
  if (!invalid.length) return false;
  const count = invalid.length;
  err.textContent = count === 1
    ? `Fix the ${FIELD_LABELS[invalid[0].id] || "highlighted"} field to send your message.`
    : `Fix ${count} fields to send your message: ${invalid.map((input) => FIELD_LABELS[input.id]).join(", ")}.`;
  invalid[0].focus();
  return true;
}

fields.forEach((input) => {
  input.addEventListener("invalid", (e) => e.preventDefault());
  input.addEventListener("input", () => {
    if (input.getAttribute("aria-invalid") === "true" && input.checkValidity()) setFieldError(input, "");
  });
});

// Each draft owns one request id; a retry after a timeout reuses it so the
// server stores the message once. A successful send starts a fresh draft.
function ensureRequestId() {
  if (!requestIdInput) return "";
  if (!requestIdInput.value) {
    requestIdInput.value = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }
  return requestIdInput.value;
}

let pending = false;

function setLoading(loading) {
  pending = loading;
  submit.disabled = loading;
  submit.setAttribute("aria-busy", loading ? "true" : "false");
  submit.textContent = loading ? "Sending..." : "Send message";
}

function showSuccess(body) {
  const message = body.message || "Message received. We'll reply by email.";
  const receipt = body.receiptId ? `<p class="hint">Reference: <code>${String(body.receiptId).slice(0, 8)}</code></p>` : "";
  success.innerHTML = `<h3>Message sent</h3><p>${escapeHtml(message)}</p>${receipt}`;
  success.hidden = false;
  // Focus moves to the status region so the confirmation is read once, not
  // announced a second time as a live-region update.
  success.focus();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

if (form) {
  form.setAttribute("novalidate", "");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (pending) return;
    err.textContent = "";
    success.hidden = true;
    clearFieldErrors();
    if (showInvalidFields()) return;
    ensureRequestId();
    const data = Object.fromEntries(new FormData(form));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    setLoading(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": getCsrf(),
        },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        form.reset();
        if (requestIdInput) requestIdInput.value = "";
        applyContext();
        showSuccess(body);
      } else if (res.status === 429) {
        err.textContent = body.error || "Too many messages from this connection. Wait a few minutes, then send again; your draft is still here.";
      } else if (res.status >= 500) {
        err.textContent = "The server could not save your message right now. Nothing was sent; your draft is still here, so try again in a moment.";
      } else {
        err.textContent = body.error || "Something went wrong. Your draft is still here; try again.";
      }
    } catch (cause) {
      err.textContent = controller.signal.aborted || cause?.name === "AbortError" ? TIMEOUT_MESSAGE : NETWORK_MESSAGE;
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  });
}

function wireHelpDrawer() {
  const side = document.getElementById("helpSide");
  const menu = document.querySelector('[aria-controls="helpSide"]');
  const close = side?.querySelector('[data-close-side]');
  const backdrop = document.getElementById("helpBackdrop");
  if (!side) return;
  function openDrawer() {
    side.classList.add("is-open");
    // Only a dialog while it is open as a drawer (see dashboard/shell.js).
    side.setAttribute("role", "dialog");
    side.setAttribute("aria-modal", "true");
    menu?.setAttribute("aria-expanded", "true");
    if (backdrop) backdrop.classList.add("is-open");
  }
  function closeDrawer() {
    side.classList.remove("is-open");
    side.removeAttribute("role");
    side.removeAttribute("aria-modal");
    menu?.setAttribute("aria-expanded", "false");
    if (backdrop) backdrop.classList.remove("is-open");
  }
  menu?.addEventListener("click", openDrawer);
  close?.addEventListener("click", closeDrawer);
  backdrop?.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && side.classList.contains("is-open")) { e.preventDefault(); closeDrawer(); } });
}
wireHelpDrawer();

const yr = document.getElementById("yr");
if (yr) yr.textContent = new Date().getFullYear();
}
window.YRInitContactPage = initContactPage;
initContactPage();
