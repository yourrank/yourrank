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

// Auth is resolved by the document: `viewer-auth-authenticated` or
// `viewer-auth-unauthenticated` from the Worker's session lookup, otherwise
// unresolved. Sign-in UI is only shown once the state is definitively signed out.
function documentAuthState() {
  if (document.body.classList.contains("viewer-auth-authenticated")) return "authenticated";
  if (document.body.classList.contains("viewer-auth-unauthenticated")) return "unauthenticated";
  return "unresolved";
}

function setDocumentAuthState(state) {
  document.body.classList.remove("viewer-auth-authenticated", "viewer-auth-unauthenticated", "viewer-auth-unresolved");
  document.body.classList.add(`viewer-auth-${state}`);
}

// The skeleton stands in for account content only while nothing definitive is on screen.
function setGlobalLoading(loading) {
  const element = $("vd-loading");
  if (element) element.hidden = !loading || documentAuthState() === "unauthenticated";
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
const DEFAULT_SUBTITLE = "Manage the communities connected to your account. Your rewards and claims stay with each community.";
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
  if (!signedIn && documentAuthState() === "unauthenticated") applyGuestGate(requested);
  $("vd-breadcrumb").hidden = !signedIn;
  $("vd-breadcrumb-current").textContent = current ? accountViews[current][0] : "My communities";
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
  else if (documentAuthState() === "unauthenticated" && Object.hasOwn(accountViews, window.location.hash.slice(1))) $("vd-login-card").focus();
}, { signal: lifetime.signal });

function renderLoggedOut() {
  signedIn = false;
  setDocumentAuthState("unauthenticated");
  setGlobalLoading(false);
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

// Official brand marks (Kick press kit, Discord "Clyde"); rows must begin with
// provider branding rather than a generic link/account icon.
const PROVIDER_LOGOS = {
  kick: '<svg class="vd-provider-logo" data-provider="kick" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z"/></svg>',
  discord: '<svg class="vd-provider-logo" data-provider="discord" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>',
};
const PROVIDER_LABELS = { kick: "Kick", discord: "Discord" };

function providerRow(account) {
  const provider = String(account.provider || "");
  const label = account.label || PROVIDER_LABELS[provider] || provider;
  const state = account.state || "connected";
  const detail = state === "connected"
    ? `${account.username ? `@${esc(account.username)}` : "Connected account"}${account.linkedAt ? ` · Connected ${esc(fmtDate(account.linkedAt))}` : ""}`
    : state === "available" ? "Not connected" : "Not available on this deployment";
  const action = state === "connected"
    ? '<span class="vd-connection-status">Connected</span>'
    : account.connectUrl ? `<a class="btn" href="${esc(account.connectUrl)}">Connect ${esc(label)}</a>` : '<span class="vd-connection-status vd-connection-status--muted">Unavailable</span>';
  const logo = PROVIDER_LOGOS[provider] || `<span class="vd-provider-logo vd-provider-logo--fallback" aria-hidden="true">${esc(label.charAt(0).toUpperCase())}</span>`;
  return `<div class="vd-provider" data-state="${esc(state)}">${logo}<div class="vd-provider-copy"><h3>${esc(label)}</h3><p>${detail}</p></div>${action}</div>`;
}

function renderConnectedAccounts(accounts) {
  if (!Array.isArray(accounts) || !accounts.length) return;
  $("vd-provider-list").innerHTML = accounts.map(providerRow).join("");
}

function renderAccount(viewer) {
  signedIn = true;
  setDocumentAuthState("authenticated");
  $("viewer-account-link").setAttribute("href", `${accountPath()}#vd-profile`);
  $("viewer-account-link").hidden = false;
  const name = viewer.displayName || "Member";
  $("viewer-top-name").textContent = name;
  $("viewer-top-mark").textContent = initial(name);
  $("vd-rail-logout").hidden = false;
  $("vd-created").textContent = fmtDate(viewer.createdAt) || "Not available";
  $("vd-data-name").textContent = name;
  $("vd-profile-name").textContent = name;
  const providers = (viewer.connections || []).map((connection) => providerRow({ ...connection, state: "connected" })).join("") || "<p>No connected providers were returned.</p>";
  $("vd-provider-list").innerHTML = providers;
  $("vd-profile-providers").innerHTML = providers;
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
  $("vd-identity").textContent = connections.length ? `Connected to ${connections.join(" and ")}` : "Signed in to YourRank";
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
  $("vd-membership-count").textContent = `${communities.length} ${communities.length === 1 ? "community" : "communities"}`;
  $("vd-communities-empty").hidden = communities.length > 0;
  list.innerHTML = communities.map((community) => {
    const name = community.name || community.slug;
    const href = `/${encodeURIComponent(community.slug)}`;
    const summary = membershipSummary(community).split(" · ").map((part, index) => `<span class="${index === 0 ? "vd-membership-balance" : "vd-membership-state"}">${esc(part)}</span>`).join('<span class="vd-membership-dot" aria-hidden="true">·</span>');
    return `
      <article class="vd-card-row vd-community-row">
        <span class="vd-site-mark" aria-hidden="true">${esc(initial(name))}</span>
        <div class="vd-card-main">
          <h3 class="vd-card-title"><a href="${href}">${esc(name)}</a></h3>
          <p class="vd-membership-summary">${summary}</p>
        </div>
        <div class="vd-card-side">
          <a class="btn btn--accent btn--sm" href="${href}" aria-label="Open ${esc(name)}">Open</a>
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
    renderConnectedAccounts(data.connectedAccounts);
    renderCommunities(data.communities || []);
  } catch (error) {
    if (error.name === "AbortError") return;
    if (error.message === "unauthorized") renderLoggedOut();
    else setStatus(documentAuthState() === "unauthenticated" ? "vd-login-status" : "vd-account-status", errorText(error.message, "We couldn't load your Viewer Account."), true, () => { load().catch(() => {}); });
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

const LINK_RESULT_MESSAGES = Object.freeze({
  link_requires_signin: "Sign in first, then connect another provider from Connected Accounts.",
  link_session_mismatch: "Connecting a provider must finish in the same signed-in browser session where it started. Try again.",
  link_identity_in_use: "That provider account is already connected to a different YourRank account. Both accounts were left unchanged.",
  link_provider_already_connected: "Your account already has a different account connected for that provider.",
});

const url = new URL(window.location.href);
const loginError = url.searchParams.get("error");
const connectedProvider = url.searchParams.get("connected");
if (loginError && LINK_RESULT_MESSAGES[loginError]) {
  setStatus("vd-account-status", LINK_RESULT_MESSAGES[loginError], true);
  url.searchParams.delete("error");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
} else if (loginError) {
  setStatus("vd-login-status", LOGIN_ERROR_MESSAGES[loginError] || "We couldn't complete sign-in. Try again.", true);
  url.searchParams.delete("error");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}
if (connectedProvider) {
  setStatus("vd-account-status", "Provider connected to your account.", false);
  url.searchParams.delete("connected");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

// Exposed so tests and runtime checks can await the first render.
window.__yrViewerReady = load().catch((error) => {
  setStatus(documentAuthState() === "unauthenticated" ? "vd-login-status" : "vd-account-status", errorText(error.message, "We couldn't load your Viewer Account. Try again."), true);
});
return window.__yrViewerReady;
})();
