// Granular cookie consent banner for GDPR/CCPA/ePrivacy compliance.
// Sets both localStorage and a first-party cookie so the backend can read it.
(function () {
  const stylesheetHref = "/assets/cookie-consent.css";
  if (!document.querySelector(`link[rel="stylesheet"][href="${stylesheetHref}"]`)) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = stylesheetHref;
    document.head.appendChild(stylesheet);
  }

  // Keep the shell footer year current even if the server-rendered year is stale.
  const footerCopy = document.querySelector(".gm-shell-footer-copy");
  if (footerCopy) footerCopy.textContent = "© " + new Date().getFullYear() + " YourRank";

  const KEY = "yr_consent";
  const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

  function setConsent(value) {
    localStorage.setItem(KEY, value);
    document.cookie = `${KEY}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; Secure`;
  }

  const existing = localStorage.getItem(KEY);
  if (existing) {
    // Make sure the cookie is in sync with localStorage.
    if (!document.cookie.includes(`${KEY}=`)) setConsent(existing);
    return;
  }

  const banner = document.createElement("div");
  banner.className = "yr-consent";
  banner.setAttribute("role", "region");
  banner.setAttribute("aria-label", "Cookie consent");
  banner.innerHTML = `
    <span class="yr-consent__text">We use essential cookies to keep you signed in and secure. With your consent, we also use analytics cookies to improve leaderboards. See our <a href="/cookies">cookie policy</a>.</span>
    <div class="yr-consent__actions">
      <button class="yr-consent__btn" id="cookieReject" type="button">Essential only</button>
      <button class="yr-consent__btn yr-consent__btn--primary" id="cookieAccept" type="button">Accept all</button>
    </div>
  `;
  document.body.appendChild(banner);

  // Removing the banner takes the focused button away with it, so focus moves to
  // the page content instead of falling to the document body.
  function dismiss(value) {
    setConsent(value);
    banner.remove();
    const main = document.getElementById("main-content") || document.querySelector("main");
    if (main && typeof main.focus === "function") {
      if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
      main.focus({ preventScroll: true });
    }
  }

  banner.querySelector("#cookieAccept").addEventListener("click", () => dismiss("all"));
  banner.querySelector("#cookieReject").addEventListener("click", () => dismiss("essential"));
})();
