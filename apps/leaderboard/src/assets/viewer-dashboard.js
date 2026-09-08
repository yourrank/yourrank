// Global Viewer Account (/me): one identity and its community memberships.
//
// Per-community Rewards, credits and Claims stay on the creator-branded
// /<slug>/me surface. This account page deliberately links there instead of
// rebuilding a second copy of the creator's product.

function $(id) { return document.getElementById(id); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
function fmtDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function fmtNum(value) { return Number(value || 0).toLocaleString("en-US"); }
function initial(value) { return Array.from(String(value || "").trim())[0]?.toUpperCase() || "Y"; }

function csrf() {
  const match = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/);
  return match ? match[1] : "";
}

async function api(method, path) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
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
    element.classList.add("btn--loading");
    element.textContent = text;
    return;
  }
  element.disabled = false;
  element.removeAttribute("aria-busy");
  element.classList.remove("btn--loading");
  element.textContent = element.dataset.origText || element.textContent;
  delete element.dataset.origText;
}

function setGlobalLoading(loading) {
  const element = $("vd-loading");
  if (element) element.hidden = !loading;
}

function renderLoggedOut() {
  $("viewer-account-link").setAttribute("href", "/me#vd-login-card");
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
  $("viewer-account-link").setAttribute("href", "/me#vd-profile");
  $("viewer-account-link").hidden = false;
  const name = viewer.displayName || "Member";
  $("vd-username").textContent = name;
  $("vd-avatar-fallback").textContent = initial(name);

  const avatar = $("vd-avatar");
  const fallback = $("vd-avatar-fallback");
  avatar.hidden = true;
  fallback.hidden = false;
  avatar.onload = () => { avatar.hidden = false; fallback.hidden = true; };
  avatar.onerror = () => { avatar.hidden = true; fallback.hidden = false; };
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
}

function membershipSummary(community) {
  const parts = [`${fmtNum(community.balance)} free credits`];
  if (community.pendingClaims > 0) {
    parts.push(`${fmtNum(community.pendingClaims)} ${community.pendingClaims === 1 ? "Claim needs" : "Claims need"} creator action`);
  }
  if (!community.claimingAvailable) parts.push("Claiming unavailable");
  return parts.join(" · ");
}

function renderCommunities(communities) {
  const list = $("vd-communities");
  $("vd-membership-count").textContent = `${communities.length}`;
  $("vd-communities-empty").hidden = communities.length > 0;
  list.innerHTML = communities.map((community) => {
    const name = community.name || community.slug;
    const href = `/${encodeURIComponent(community.slug)}/me`;
    return `
      <article class="vd-card-row vd-community-row">
        <span class="vd-site-mark" aria-hidden="true">${esc(initial(name))}</span>
        <div class="vd-card-main">
          <h3 class="vd-card-title"><a href="${href}">${esc(name)}</a></h3>
          <p class="vd-membership-summary">${esc(membershipSummary(community))}</p>
        </div>
        <div class="vd-card-side">
          <a class="btn btn--sm" href="${href}" aria-label="View my activity in ${esc(name)}">View my activity</a>
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
    if (error.message === "unauthorized") renderLoggedOut();
    else setStatus("vd-login-status", errorText(error.message, "We couldn't load your Viewer Account."), true, () => { load().catch(() => {}); });
  } finally {
    setGlobalLoading(false);
    if (window.location.hash === "#vd-profile" || window.location.hash === "#vd-login-card") {
      const destination = $("vd-profile").hidden ? $("vd-login-card") : $("vd-profile");
      destination.focus();
    }
  }
}

$("vd-open-community")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("vd-community-name");
  const slug = input.value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    input.setAttribute("aria-invalid", "true");
    setStatus("vd-community-entry-status", "Enter a community name using letters, numbers and hyphens, such as atlas-community.", true);
    input.focus();
    return;
  }
  input.removeAttribute("aria-invalid");
  setStatus("vd-community-entry-status", "");
  window.location.href = new URL(`/${encodeURIComponent(slug)}/me`, window.location.origin).href;
});

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
    $("vd-login-kick").focus();
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
