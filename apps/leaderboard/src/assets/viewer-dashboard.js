// Global Viewer Account (/me): one identity and its community memberships.
//
// Per-community Rewards, credits and Claims stay on the creator-branded
// /<slug>/activity surface. This account page deliberately links there instead of
// rebuilding a second copy of the creator's product.

(function initViewerAccount() {
window.YRInitViewerAccount = initViewerAccount;
const lifetime = new AbortController();
document.addEventListener?.("yr:viewer-unmount", () => lifetime.abort(), { once: true });
function $(id) { return document.getElementById(id); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
function fmtDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function fmtNum(value) { return Number(value || 0).toLocaleString("en-US"); }
function initial(value) { return Array.from(String(value || "").trim())[0]?.toUpperCase() || "Y"; }
function accountPath() { return `${window.location.pathname}${window.location.search}`; }

function csrf() {
  const match = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/);
  return match ? match[1] : "";
}

async function api(method, path) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    signal: lifetime.signal,
    headers: { "x-csrf-token": csrf() },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

const ERROR_MESSAGES = Object.freeze({
  unauthorized: "Your session expired. Sign in again.",
  "invalid csrf": "Your session expired. Reload the page and try again.",
});

function errorText(message, fallback) {
  if (ERROR_MESSAGES[message]) return ERROR_MESSAGES[message];
  const sentence = /^[A-Z].*[.!?]$/.test(String(message || "")) && !/^HTTP /.test(message);
  return sentence ? message : fallback;
}

function setStatus(id, message, isError, retry) {
  const element = $(id);
  if (!element) return;
  element.textContent = message || "";
  element.className = message && isError ? "status error" : "status";
  if (message && typeof retry === "function") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn--sm vd-retry";
    button.textContent = "Try again";
    button.addEventListener("click", () => {
      setStatus(id, "");
      retry();
    });
    element.append(" ", button);
  }
}

function setLoading(element, loading, text = "Loading…") {
  if (!element) return;
  if (loading) {
    element.dataset.origText = element.textContent;
    element.disabled = true;
    element.setAttribute("aria-busy", "true");
    element.textContent = text;
    return;
  }
  element.disabled = false;
  element.removeAttribute("aria-busy");
  element.textContent = element.dataset.origText || element.textContent;
  delete element.dataset.origText;
}

function setGlobalLoading(loading) {
  const element = $("vd-loading");
  if (element) element.hidden = !loading;
}

let signedIn = false;
const accountViews = {
  "vd-profile": ["Profile", "Manage your basic YourRank identity."],
  "vd-connections": ["Connected Accounts", "View the accounts connected to your YourRank identity."],
  "vd-notifications": ["Notifications", "Notification settings for your viewer account."],
  "vd-security": ["Privacy & Security", "Review your sign-in and privacy information."],
  "vd-data": ["Data & Account", "Manage your account information and control your data."],
};
let exportId = "";
const DEFAULT_SUBTITLE = "Choose a community. Your rewards and claims stay with each community.";
const LOGIN_LINKS = ["vd-login-kick", "vd-login-discord"];

// A guest who follows an account-settings link lands on the sign-in card, which
// names the requested section and sends the provider back to it after login.
function applyGuestGate(requested) {
  const label = requested ? accountViews[requested][0] : "";
  $("vd-title").textContent = requested ? `Sign in to open ${label}` : "My communities";
  $("vd-subtitle").textContent = requested
    ? `${label} is part of your Viewer Account. Sign in and you'll come straight back to it.`
    : DEFAULT_SUBTITLE;
  for (const id of LOGIN_LINKS) {
    const link = $(id);
    if (!link) continue;
    const base = link.dataset.loginBase || link.href;
    if (!base) continue;
    link.dataset.loginBase = base;
    const target = new URL(base, window.location.href);
    if (requested) target.searchParams.set("returnTo", `${accountPath()}#${requested}`);
    link.setAttribute("href", `${target.pathname}${target.search}`);
  }
}

function selectAccountView() {
  const hash = window.location.hash.slice(1);
  const requested = Object.hasOwn(accountViews, hash) ? hash : "";
  const current = signedIn ? requested : "";
  Object.keys(accountViews).forEach(id => { $(id).hidden = id !== current; });
  $("vd-communities-card").hidden = !signedIn || !!current;
  $("vd-title").textContent = current ? accountViews[current][0] : "My communities";
  $("vd-subtitle").textContent = current ? accountViews[current][1] : DEFAULT_SUBTITLE;
  if (!signedIn) applyGuestGate(requested);
  $("vd-breadcrumb").hidden = !current;
  $("vd-breadcrumb-current").textContent = current ? accountViews[current][0] : "";
  const accountLink = $("viewer-account-link");
  const communitiesLink = $("viewer-communities-link");
  if (current) { communitiesLink.removeAttribute("aria-current"); }
  else { accountLink.removeAttribute("aria-current"); communitiesLink.setAttribute("aria-current", "page"); }
  document.querySelectorAll('.viewer-destinations a').forEach(link => {
    if (requested && new URL(link.href, window.location.href).hash === `#${requested}`) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  $("viewer-top-title").textContent = $("vd-title").textContent;
}
window.addEventListener("hashchange", () => {
  selectAccountView();
  if (signedIn) $("vd-title").focus();
  else if (Object.hasOwn(accountViews, window.location.hash.slice(1))) $("vd-login-card").focus();
}, { signal: lifetime.signal });

function renderLoggedOut() {
  signedIn = false;
  exportId = "";
  $("vd-export-download").hidden = true;
  $("vd-export-check").hidden = true;
  setStatus("vd-export-status", "");
  $("vd-rail-logout").hidden = true;
  $("viewer-top-name").textContent = "Sign in";
  $("viewer-top-mark").textContent = "";
  $("viewer-top-avatar").setAttribute("aria-label", "Sign in to your viewer account");
  selectAccountView();
  $("viewer-account-link").setAttribute("href", `${accountPath()}#vd-login-card`);
  if (window.YRViewerApp) document.querySelector('.viewer-overview')?.replaceChildren();
  $("viewer-account-link").hidden = true;
  $("vd-login-card").hidden = false;
  $("vd-profile").hidden = true;
  $("vd-communities-card").hidden = true;
  $("vd-username").textContent = "";
  $("vd-identity").textContent = "";
  $("vd-communities").innerHTML = "";
  $("vd-membership-count").textContent = "";
  $("vd-communities-empty").hidden = true;
}

function renderAccount(viewer) {
  signedIn = true;
  $("viewer-account-link").setAttribute("href", `${accountPath()}#vd-profile`);
  $("viewer-account-link").hidden = false;
  const name = viewer.displayName || "Member";
  $("viewer-top-name").textContent = name;
  $("viewer-top-mark").textContent = initial(name);
  $("vd-rail-logout").hidden = false;
  $("vd-created").textContent = fmtDate(viewer.createdAt) || "Not available";
  $("vd-data-name").textContent = name;
  const providers = (viewer.connections || []).map(connection => `<div class="vd-provider"><div><h3>${esc(connection.provider === "kick" ? "Kick" : connection.provider === "discord" ? "Discord" : connection.provider)}</h3><p>${connection.username ? `@${esc(connection.username)}` : 'Connected account'}${connection.linkedAt ? ` · Connected ${esc(fmtDate(connection.linkedAt))}` : ''}</p></div><span class="vd-connection-status">Connected</span></div>`).join("") || "<p>No connected providers were returned.</p>";
  $("vd-provider-list").innerHTML = providers;
  $("vd-security-providers").innerHTML = providers;
  $("viewer-top-avatar").setAttribute("aria-label", `Viewer account: ${name}`);
  $("viewer-top-avatar").setAttribute("title", `Open ${name}'s viewer account`);
  $("vd-username").textContent = name;
  $("vd-avatar-fallback").textContent = initial(name);

  const avatar = $("vd-avatar");
  const fallback = $("vd-avatar-fallback");
  avatar.hidden = true;
  fallback.hidden = false;
  avatar.onload = () => {
    if (lifetime.signal.aborted || !signedIn) return;
    avatar.hidden = false; fallback.hidden = true;
    $("viewer-top-mark").innerHTML = `<img src="${esc(viewer.avatarUrl)}" alt="" />`;
  };
  avatar.onerror = () => {
    if (lifetime.signal.aborted || !signedIn) return;
    avatar.hidden = true; fallback.hidden = false;
    $("viewer-top-mark").textContent = initial(name);
  };
  if (viewer.avatarUrl) {
    avatar.alt = `${name}'s profile picture`;
    avatar.src = viewer.avatarUrl;
  } else {
    avatar.removeAttribute("src");
  }

  const connections = (viewer.connections || []).map((connection) => {
    const provider = connection.provider === "kick" ? "Kick" : connection.provider === "discord" ? "Discord" : "Provider";
    const username = connection.username ? ` as @${connection.username}` : "";
    return `${provider}${username}`;
  });
  const accountAge = viewer.createdAt ? ` · Viewer Account since ${fmtDate(viewer.createdAt)}` : "";
  $("vd-identity").textContent = `${connections.length ? `Connected to ${connections.join(" and ")}` : "Signed in to YourRank"}${accountAge}`;
  $("vd-wrong-account").hidden = false;
  selectAccountView();
}

function membershipSummary(community) {
  const parts = [`${fmtNum(community.balance)} Credits`];
  if (community.pendingClaims > 0) {
    parts.push(`${fmtNum(community.pendingClaims)} ${community.pendingClaims === 1 ? "Claim needs" : "Claims need"} creator action`);
  }
  if (!community.claimingAvailable) parts.push("Claiming unavailable");
  return parts.join(" · ");
}

let memberships = [];
function renderCommunities(communities) {
  memberships = communities;
  const list = $("vd-communities");
  $("vd-membership-count").textContent = `${communities.length}`;
  $("vd-communities-empty").hidden = communities.length > 0;
  list.innerHTML = communities.map((community) => {
    const name = community.name || community.slug;
    const href = `/${encodeURIComponent(community.slug)}`;
    return `
      <article class="vd-card-row vd-community-row">
        <span class="vd-site-mark" aria-hidden="true">${esc(initial(name))}</span>
        <div class="vd-card-main">
          <h3 class="vd-card-title"><a href="${href}">${esc(name)}</a></h3>
          <p class="vd-membership-summary">${esc(membershipSummary(community))}</p>
        </div>
        <div class="vd-card-side">
          <a class="btn btn--sm" href="${href}" aria-label="Open ${esc(name)}">Open community</a>
        </div>
      </article>`;
  }).join("");
}

async function load() {
  setGlobalLoading(true);
  if (!loginError) setStatus("vd-login-status", "");
  setStatus("vd-communities-status", "");
  try {
    const data = await api("GET", "/api/viewer/me");
    if (lifetime.signal.aborted) return;
    if (!data.viewer) {
      renderLoggedOut();
      return;
    }
    $("vd-login-card").hidden = true;
    $("vd-profile").hidden = false;
    $("vd-communities-card").hidden = false;
    renderAccount(data.viewer);
    renderCommunities(data.communities || []);
  } catch (error) {
    if (error.name === "AbortError") return;
    if (error.message === "unauthorized") renderLoggedOut();
    else setStatus("vd-login-status", errorText(error.message, "We couldn't load your Viewer Account."), true, () => { load().catch(() => {}); });
  } finally {
    if (!lifetime.signal.aborted) setGlobalLoading(false);
    if (!lifetime.signal.aborted) {
      const hash = window.location.hash.slice(1);
      if (hash === "vd-login-card" || (!signedIn && Object.hasOwn(accountViews, hash))) $("vd-login-card").focus({ preventScroll: true });
      else if (hash === "vd-profile") $("vd-profile").focus({ preventScroll: true });
      else if (signedIn && Object.hasOwn(accountViews, hash)) $("vd-title").focus({ preventScroll: true });
    }
  }
}

$("vd-open-community")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("vd-community-name");
  const value = input.value.trim();
  const match = memberships.find(community => community.name.toLowerCase() === value.toLowerCase());
  let slug = match?.slug || value.toLowerCase();
  if (/^(?:https?:\/\/|yourrank\.site\/)/i.test(value)) {
    try {
      const communityUrl = new URL(/^https?:/i.test(value) ? value : `https://${value}`);
      if (communityUrl.hostname !== "yourrank.site" || communityUrl.username || communityUrl.password || communityUrl.port || !/^\/[a-z0-9][a-z0-9-]{0,62}(?:\/(?:me|shop|leaderboard))?\/?$/.test(communityUrl.pathname)) throw new Error("Invalid community link");
      slug = communityUrl.pathname.split("/")[1];
    } catch { slug = ""; }
  }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    input.setAttribute("aria-invalid", "true");
    setStatus("vd-community-entry-status", "Enter a community handle or paste its YourRank community link.", true);
    input.focus();
    return;
  }
  input.removeAttribute("aria-invalid");
  setStatus("vd-community-entry-status", "");
  const destination = new URL(`/${encodeURIComponent(slug)}`, window.location.origin).href;
  if (window.YRViewerApp) window.YRViewerApp.navigate(destination); else window.location.href = destination;
});

$("vd-rail-logout")?.addEventListener("click", () => $("vd-logout").click(), { signal: lifetime.signal });
$("vd-export")?.addEventListener("click", async () => {
  const button = $("vd-export");
  setLoading(button, true, "Requesting export…");
  $("vd-export-download").hidden = true;
  try {
    const data = await api("POST", "/api/viewer/export");
    exportId = data.exportId || "";
    if (!exportId) throw new Error("Could not start data export. Please try again.");
    $("vd-export-check").hidden = false;
    setStatus("vd-export-status", "Your export is being prepared. Check its status here.");
  } catch (error) {
    setStatus("vd-export-status", errorText(error.message, "Could not start data export. Please try again."), true);
  } finally { setLoading(button, false); }
}, { signal: lifetime.signal });
$("vd-export-check")?.addEventListener("click", async () => {
  if (!exportId) return;
  const button = $("vd-export-check");
  setLoading(button, true, "Checking…");
  try {
    const data = await api("GET", `/api/viewer/export/${encodeURIComponent(exportId)}/status`);
    const complete = data.status === "completed";
    $("vd-export-download").hidden = !complete;
    if (complete) $("vd-export-download").setAttribute("href", `/api/viewer/export/${encodeURIComponent(exportId)}/download`);
    setStatus("vd-export-status", complete ? `Your export is ready.${data.expiresAt ? ` Available until ${fmtDate(data.expiresAt)}.` : ""}` : data.status === "failed" || data.status === "expired" ? "This export is unavailable. Request a new export." : "Your export is still being prepared.", data.status === "failed" || data.status === "expired");
  } catch (error) {
    setStatus("vd-export-status", errorText(error.message, "Could not check export status. Try again."), true);
  } finally { setLoading(button, false); }
}, { signal: lifetime.signal });
$("vd-logout")?.addEventListener("click", async () => {
  const button = $("vd-logout");
  setLoading(button, true, "Signing out…");
  try {
    await api("POST", "/api/viewer/logout");
    setStatus("vd-account-status", "");
    renderLoggedOut();
    $("vd-login-card").focus();
  } catch (error) {
    setStatus("vd-account-status", errorText(error.message, "We couldn't sign you out. Try again."), true);
  } finally {
    setLoading(button, false);
  }
});

$("vd-switch")?.addEventListener("click", async () => {
  const button = $("vd-switch");
  setLoading(button, true, "Signing out…");
  try {
    await api("POST", "/api/viewer/logout");
    renderLoggedOut();
    ($("vd-login-kick") || $("vd-login-discord"))?.focus();
  } catch (error) {
    setStatus("vd-account-status", errorText(error.message, "We couldn't switch your login. Try again."), true);
  } finally {
    setLoading(button, false);
  }
});

const LOGIN_ERROR_MESSAGES = Object.freeze({
  rate_limited: "Too many sign-in attempts. Try again shortly.",
  missing_oauth_params: "The provider did not return the information needed. Try again.",
  oauth_state_expired: "That sign-in took too long. Try again.",
  access_denied: "Sign-in was cancelled.",
  kick_auth_failed: "We couldn't complete Kick sign-in. Try again.",
  discord_auth_failed: "We couldn't complete Discord sign-in. Try again.",
  kick_signin_unavailable: "Kick sign-in isn't available right now. Try again later.",
  discord_signin_unavailable: "Discord sign-in isn't available right now. Try again later.",
  kick_oauth_callback_mismatch: "Kick returned to an unexpected callback. Try again.",
  discord_oauth_callback_mismatch: "Discord returned to an unexpected callback. Try again.",
  kick_oauth_browser_mismatch: "Kick sign-in must finish in the browser where it started.",
  discord_oauth_browser_mismatch: "Discord sign-in must finish in the browser where it started.",
});

const url = new URL(window.location.href);
const loginError = url.searchParams.get("error");
if (loginError) {
  setStatus("vd-login-status", LOGIN_ERROR_MESSAGES[loginError] || "We couldn't complete sign-in. Try again.", true);
  url.searchParams.delete("error");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

// Exposed so tests and runtime checks can await the first render.
window.__yrViewerReady = load().catch((error) => {
  setStatus("vd-login-status", errorText(error.message, "We couldn't load your Viewer Account. Try again."), true);
});
return window.__yrViewerReady;
})();
