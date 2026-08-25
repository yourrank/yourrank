export function profileIdentity(user) {
  const displayName = String(user?.display_name || user?.displayName || "").trim();
  const email = String(user?.email || "").trim();
  const emailLocalPart = email.split("@")[0].trim();
  return displayName || emailLocalPart || email || "Account";
}

export function updateProfileMenu(user) {
  const identity = profileIdentity(user);
  const initial = identity.charAt(0).toUpperCase();
  document.querySelectorAll("[data-profile-name]").forEach((el) => {
    el.textContent = identity;
  });
  document.querySelectorAll(".gm-who-avatar").forEach((el) => {
    el.textContent = initial;
  });
}
