const $ = (id) => document.getElementById(id);
const sessionId = new URLSearchParams(location.search).get("sessionId");
const messages = {
  verification_required: "Your entry is pending. Verify your linked Kick account to join the draw.",
  entry_required: "Type the giveaway keyword in Kick chat first, then select Verify Entry.",
  not_yourrank_member: "Sign in with Kick to verify your entry. No profile setup is required.",
  kick_not_linked: "Connect the Kick account you used in chat to your YourRank account.",
  subscriber_required: "This giveaway requires the subscriber badge on your chat entry.",
  vip_required: "This giveaway requires the VIP badge on your chat entry.",
  previous_winner: "Previous winners in this community are excluded from this giveaway.",
  duplicate_ip: "Another account has already verified from this connection.",
  ip_unavailable: "Your connection could not be verified. Please try again.",
  giveaway_closed: "This giveaway is closed. Entries can no longer be verified.",
  linked_account_restricted: "This entry isn't eligible for this giveaway.",
  vpn_detected: "VPN or proxy detected. Turn it off, then select Verify Entry again.",
  vpn_check_unavailable: "The VPN check is temporarily unavailable. Please try again in a minute.",
};
// Anti-abuse device signal: the one-way hash rides along on the verify POST.
// A missing script or a slow fingerprint just means no header.
async function deviceHeaders() {
  if (typeof window.YRDeviceSignal?.hash !== "function") return {};
  try {
    const hash = await Promise.race([
      window.YRDeviceSignal.hash(),
      new Promise((resolve) => setTimeout(() => resolve(null), 500)),
    ]);
    return hash ? { "x-yr-device": hash } : {};
  } catch (err) {
    console.warn("[device-signal] hash failed", err);
    return {};
  }
}
async function load(verify = false) {
  const button = $("giveaway-verify");
  button.disabled = true;
  $("giveaway-state").textContent = verify ? "Verifying your entry…" : "Loading your entry…";
  try {
    const csrf = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] || "";
    const device = verify ? await deviceHeaders() : {};
    const response = await fetch(`/api/viewer/giveaway?sessionId=${encodeURIComponent(sessionId || "")}`, verify ? {
      method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf, ...device }, body: JSON.stringify({ sessionId }),
    } : {});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load your entry.");
    $("giveaway-community").textContent = `${data.giveaway.community} · ${data.giveaway.keyword}`;
    $("giveaway-identity").textContent = data.kickUsername ? `Linked Kick account: @${data.kickUsername}` : "";
    $("giveaway-ip-notice").hidden = !data.ipCheck;
    $("giveaway-vpn-notice").hidden = !data.vpnCheck;
    $("giveaway-state").textContent = data.status === "eligible" ? "Entry verified" : messages[data.reason] || "Your entry is pending verification.";
    const link = $("giveaway-signin");
    link.hidden = data.signedIn && !!data.kickUsername;
    link.textContent = data.signedIn ? "Connect Kick account" : "Sign in with Kick";
    link.href = `/api/viewer/auth/kick?${new URLSearchParams({ returnTo: location.pathname + location.search, ...(data.signedIn ? { intent: "link" } : {}) })}`;
    button.disabled = !link.hidden || data.status === "eligible" || !["active", "stopped"].includes(data.giveaway.status);
  } catch (error) {
    $("giveaway-state").textContent = error.message;
    button.disabled = false;
  }
}
$("giveaway-verify").addEventListener("click", () => load(true));
load();
