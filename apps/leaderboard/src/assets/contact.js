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

function setLoading(loading) {
  submit.disabled = loading;
  submit.textContent = loading ? "Sending..." : "Send message";
}

if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    success.hidden = true;
    const data = Object.fromEntries(new FormData(form));
    setLoading(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": getCsrf(),
        },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        success.hidden = false;
        success.textContent = body.message || "Message received. We'll reply by email.";
        form.reset();
        applyContext();
      } else {
        err.textContent = body.error || "Something went wrong. Try again.";
      }
    } catch {
      err.textContent = "Network error. Please try again.";
    } finally {
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
