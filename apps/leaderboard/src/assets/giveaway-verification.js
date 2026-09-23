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
};
async function load(verify = false) {
  const button = $("giveaway-verify");
  button.disabled = true;
  $("giveaway-state").textContent = verify ? "Verifying your entry…" : "Loading your entry…";
  try {
    const csrf = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] || "";
    const response = await fetch(`/api/viewer/giveaway?sessionId=${encodeURIComponent(sessionId || "")}`, verify ? {
      method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ sessionId }),
    } : {});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load your entry.");
    $("giveaway-community").textContent = `${data.giveaway.community} · ${data.giveaway.keyword}`;
    $("giveaway-identity").textContent = data.kickUsername ? `Linked Kick account: @${data.kickUsername}` : "";
    $("giveaway-ip-notice").hidden = !data.ipCheck;
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
