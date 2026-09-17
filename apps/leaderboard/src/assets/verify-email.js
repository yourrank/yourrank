/* Verify email landing page — the token itself is verified server-side; this
   module only powers the "Send again" recovery action. */
import { showPromptModal } from "./dashboard/utils.js";
const $ = (id) => document.getElementById(id);
const msg = $("msg");
const err = $("err");
const resendWrap = $("resendWrap");
const resendBtn = $("resendBtn");

function showError(text, showResend) {
  msg.textContent = text;
  msg.style.color = "var(--bad, #c00)";
  err.hidden = false;
  err.textContent = text;
  if (showResend) resendWrap.hidden = false;
}

function setResendPending(loading) {
  resendBtn.disabled = loading;
  if (loading) resendBtn.setAttribute("aria-busy", "true");
  else resendBtn.removeAttribute("aria-busy");
  resendBtn.textContent = loading ? "Sending…" : "Send again";
}

resendBtn?.addEventListener("click", async () => {
  const email = await showPromptModal("Resend verification link", "Enter your email address:", { confirmText: "Send", inputType: "email", placeholder: "you@example.com" });
  if (!email || !email.includes("@")) return;
  setResendPending(true);
  try {
    const r = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email })
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ok) {
      msg.textContent = "If that account needs verification, a new link is on its way.";
      msg.style.color = "";
      err.hidden = true;
    } else {
      showError(d.error || "Could not resend. Try again later.", true);
    }
  } catch {
    showError("Network error. Try again.", true);
  } finally {
    setResendPending(false);
  }
});
