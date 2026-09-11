function getCsrf() {
  return document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] || "";
}

function showInviteError(msg) {
  // DEF-10: Accessible inline error instead of native alert().
  let el = document.getElementById("inviteError");
  if (!el) {
    el = document.createElement("p");
    el.id = "inviteError";
    el.setAttribute("role", "alert");
    el.className = "status error";
    const btn = document.getElementById("btnAcceptInvite");
    btn?.parentNode?.insertBefore(el, btn.nextSibling);
  }
  el.textContent = msg;
  el.hidden = false;
}

const btn = document.getElementById("btnAcceptInvite");
if (btn) {
  btn.addEventListener("click", async () => {
    const token = btn.getAttribute("data-token");
    btn.disabled = true;
    btn.textContent = "Accepting...";
    // Hide any previous inline error.
    const prev = document.getElementById("inviteError");
    if (prev) prev.hidden = true;
    try {
      const res = await fetch("/api/site/team/accept-invite", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": getCsrf(),
        },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.ok) {
        // DEF-03: Redirect to the invited community board, not bare /dashboard.
        const dest = data.siteId
          ? "/dashboard?board=" + encodeURIComponent(data.siteId)
          : "/dashboard";
        window.location.assign(dest);
        return;
      }
      showInviteError(data.error || "Failed to accept invitation");
    } catch {
      showInviteError("Network error. Please try again.");
    }
    btn.disabled = false;
    btn.textContent = "Accept Invitation & Open Dashboard";
  });
}
