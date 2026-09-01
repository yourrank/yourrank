/* Shared logic for login / signup / forgot / reset pages.
 * Mode is derived from the URL path so no inline <script> is needed (the
 * auth pages run under a strict CSP with script-src 'self', which blocks
 * the previous inline window.__MODE__ assignment). */
/* Password show/hide toggle */
document.querySelectorAll("[data-pw-toggle]").forEach(btn => {
  btn.addEventListener("click", () => {
    const wrap = btn.closest(".pw-wrap");
    const input = wrap.querySelector("input");
    const eye = btn.querySelector("[data-eye]");
    const eyeOff = btn.querySelector("[data-eye-off]");
    if (input.type === "password") {
      input.type = "text";
      eye.hidden = true;
      eyeOff.hidden = false;
      btn.setAttribute("aria-label", "Hide password");
    } else {
      input.type = "password";
      eye.hidden = false;
      eyeOff.hidden = true;
      btn.setAttribute("aria-label", "Show password");
    }
  });
});

const mode = { "/signup": "signup", "/forgot": "forgot", "/reset": "reset" }[location.pathname] || "login";
const urlParams = new URLSearchParams(location.search);
const planParam = urlParams.get("plan") || "";
function safeNextPath(value) {
  if (!value) return "";
  try {
    const u = new URL(value, location.origin);
    if (u.origin !== location.origin) return "";
    const path = u.pathname;
    const allowedExact = new Set([
      "/dashboard",
      "/dashboard/settings",
      "/help/support",
      "/verify-email"
    ]);
    const allowedPrefixes = ["/dashboard/"];
    if (allowedExact.has(path) || allowedPrefixes.some(prefix => path.startsWith(prefix))) return path + u.search;
  } catch (_) {}
  return "";
}
const nextPath = safeNextPath(urlParams.get("next") || "");
const form = document.getElementById("form");
const errEl = document.getElementById("err");
function getCsrf() { const m = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/); return m ? m[1] : ""; }
const msgEl = document.getElementById("msg");
// BUG-003: If reset page has no token, show error instead of a form that will fail
if (mode === "reset" && !new URLSearchParams(location.search).get("token")) {
  if (form) form.hidden = true;
  if (errEl) { errEl.hidden = false; errEl.textContent = "This reset link is invalid or expired. Request a new one below."; }
  const backLink = document.createElement("a");
  backLink.href = "/forgot";
  backLink.textContent = "Request a new reset link";
  backLink.className = "back-link";
  if (errEl && errEl.parentNode) errEl.parentNode.appendChild(backLink);
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function fieldErrEl(id) { return document.querySelector('[data-field-err="' + id + '"]'); }
function setFieldError(id, msg) {
  const inp = document.getElementById(id);
  if (inp) inp.setAttribute("aria-invalid", "true");
  const box = fieldErrEl(id);
  if (box) box.textContent = msg;
}
function clearFieldError(id) {
  const inp = document.getElementById(id);
  if (inp) inp.removeAttribute("aria-invalid");
  const box = fieldErrEl(id);
  if (box) box.textContent = "";
}
function clearAllFieldErrors() {
  form.querySelectorAll("[data-field-err]").forEach(b => { b.textContent = ""; });
  form.querySelectorAll("input[aria-invalid]").forEach(i => i.removeAttribute("aria-invalid"));
}
form.querySelectorAll("input").forEach(inp => inp.addEventListener("input", () => {
  if (errEl && errEl.textContent) errEl.textContent = "";
  if (inp.id) clearFieldError(inp.id);
}));

/* Live password strength meter + requirement checklist */
function passwordScore(v) {
  if (v.length < 8) return 0;
  let s = 1;
  if (v.length >= 12) s++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
  if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) s++;
  return Math.min(s, 4);
}
function passwordRequirements(v) {
  return {
    len: v.length >= 8,
    case: /[a-z]/.test(v) && /[A-Z]/.test(v),
    num: /\d/.test(v),
    special: /[^A-Za-z0-9]/.test(v),
  };
}
function passwordRuleMessage(v) {
  const checks = passwordRequirements(v);
  if (!checks.len) return "Password must be at least 8 characters";
  if (!checks.case) return "Password must include upper and lower case letters";
  if (!checks.num) return "Password must include a number";
  if (!checks.special) return "Password must include a symbol";
  return "";
}
const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"];
const pwInput = document.getElementById("password");
const pwMeter = document.getElementById("pwMeter");
const pwReqs = document.getElementById("pwReqs");
function updatePasswordFeedback(v) {
  const { len: hasLen, case: hasCase, num: hasNum, special: hasSpecial } = passwordRequirements(v);
  if (pwReqs) {
    const set = (key, ok) => {
      const el = pwReqs.querySelector('[data-req="' + key + '"]');
      if (el) el.classList.toggle("met", ok);
    };
    set("len", hasLen);
    set("case", hasCase);
    set("num", hasNum);
    set("special", hasSpecial);
  }
  if (!pwMeter) return;
  if (!v) { pwMeter.hidden = true; return; }
  pwMeter.hidden = false;
  const score = hasLen ? passwordScore(v) : 1;
  const bar = pwMeter.querySelector(".pw-meter-bar");
  const label = pwMeter.querySelector("[data-pw-strength]");
  if (bar) bar.className = "pw-meter-bar s" + score;
  if (label) label.textContent = !hasLen ? "At least 8 characters" : STRENGTH_LABELS[score];
}
if ((mode === "signup" || mode === "reset") && pwInput) {
  pwInput.addEventListener("input", () => updatePasswordFeedback(pwInput.value));
}

const submit = document.getElementById("submit");
const nameInput = document.getElementById("name");
const slugInput = document.getElementById("slug");
const slugPreview = document.getElementById("slugPreview");
function slugify(s){return String(s||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40);}
function updateSlugPreview(){ const s = slugify(slugInput ? slugInput.value : nameInput?.value); if (slugPreview) slugPreview.textContent = s ? "yourrank.site/" + s : "yourrank.site/…"; }
let userEditedSlug = false;
if (nameInput && slugInput) {
  nameInput.addEventListener("input", () => { if (!userEditedSlug) { slugInput.value = slugify(nameInput.value); updateSlugPreview(); } });
}
if (slugInput) {
  slugInput.addEventListener("input", () => { userEditedSlug = true; updateSlugPreview(); clearFieldError("slug"); });
}
const PLAN_NAMES = { free: "Free", pro: "Pro", team: "Team" };
if (mode === "signup" && PLAN_NAMES[planParam]) {
  const banner = document.getElementById("planBanner");
  if (banner) {
    banner.hidden = false;
    const isPaid = planParam !== "free";
    banner.innerHTML = `You selected <b>${PLAN_NAMES[planParam]}</b>.${isPaid ? " Recurring checkout is not available yet; creating an account does not activate or charge for this plan." : " You can review plan limits anytime from the dashboard."}`;
  }
}
if (mode === "login" || mode === "signup") {
  fetch("/api/auth/me").then(r => r.json()).then(d => { if (d && d.ok && d.user) location.href = nextPath || "/dashboard"; }).catch(() => {});
}
form.addEventListener("submit", async (e) => {
  e.preventDefault(); errEl.textContent = ""; submit.disabled = true;
  const orig = submit.textContent;
  submit.textContent = { signup: "Creating…", login: "Signing in…", forgot: "Sending…", reset: "Saving…" }[mode] || "Working…";
  let endpoint = "/api/auth/" + mode;
  let payload;
  if (mode === "forgot") {
    payload = { email: document.getElementById("email").value.trim() };
  } else if (mode === "reset") {
    const token = new URLSearchParams(location.search).get("token") || "";
    payload = { token, password: document.getElementById("password").value };
  } else {
    payload = { email: document.getElementById("email").value.trim(), password: document.getElementById("password").value };
    if (mode === "signup") {
      if (nameInput) payload.name = nameInput.value.trim();
      if (slugInput) payload.slug = slugify(slugInput.value) || slugify(nameInput?.value || "");
    }
    const ref = new URLSearchParams(location.search).get("ref");
    if (mode === "signup" && ref) payload.ref = ref;
  }
  if (mode === "login" || mode === "signup" || mode === "reset") {
    clearAllFieldErrors();
    let firstInvalid = null;
    if ((mode === "login" || mode === "signup") && !EMAIL_RE.test(payload.email || "")) { setFieldError("email", "Enter a valid email address"); firstInvalid = firstInvalid || "email"; }
    if ((mode === "signup" || mode === "reset")) {
      const passwordError = passwordRuleMessage(payload.password || "");
      if (passwordError) { setFieldError("password", passwordError); firstInvalid = firstInvalid || "password"; }
    }
    if (mode === "signup" && !(payload.name || "").trim()) { setFieldError("name", "Enter your name or handle"); firstInvalid = firstInvalid || "name"; }
    if (mode === "signup" && !(payload.slug || "").trim()) { setFieldError("slug", "Enter a page URL"); firstInvalid = firstInvalid || "slug"; }
    if (firstInvalid) {
      const el = document.getElementById(firstInvalid);
      if (el) el.focus();
      submit.disabled = false; submit.textContent = orig;
      return;
    }
  }
  try {
    const res = await fetch(endpoint, { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": getCsrf() }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      // Field-scoped failures (e.g. a taken page URL) belong next to the input,
      // not only in the form-level error line.
      if (data.field) {
        setFieldError(data.field, data.error || "Invalid value");
        document.getElementById(data.field)?.focus();
      }
      errEl.textContent = data.field ? "" : (data.error || "Something went wrong.");
      submit.disabled = false; submit.textContent = orig; return;
    }
    if (mode === "forgot") {
      if (msgEl) { msgEl.hidden = false; msgEl.textContent = "Done. If that account exists, a reset link is on its way. Check spam too."; }
      form.querySelector("input").disabled = true;
      submit.textContent = "Sent";
      return;
    }
    if (data.needsVerification) {
      const verifyParams = new URLSearchParams();
      if (nextPath) verifyParams.set("next", nextPath);
      if (data.verificationSent === false) verifyParams.set("delivery", "failed");
      location.href = `/verify-email${verifyParams.size ? `?${verifyParams}` : ""}`;
      return;
    }
    if (mode === "signup") {
      const p = (planParam || "").toLowerCase();
      if (["pro", "team"].includes(p)) location.href = `/dashboard/settings/billing?plan=${encodeURIComponent(p)}`;
      else location.href = nextPath || "/dashboard";
    } else {
      location.href = nextPath || "/dashboard";
    }
  } catch (_) { errEl.textContent = "Network error. Try again."; submit.disabled = false; submit.textContent = orig; }
});
