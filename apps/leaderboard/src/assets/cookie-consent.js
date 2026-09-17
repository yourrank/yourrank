// Granular cookie consent for GDPR/CCPA/ePrivacy compliance.
// The choice is mirrored into localStorage and a first-party cookie so the
// backend can read it; anything the browser blocks is treated as "no choice".
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
  const VISITOR_KEY = "yr_vid";
  const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
  const VALUES = new Set(["all", "essential"]);
  const SECURE = location.protocol === "https:" ? "; Secure" : "";

  function readCookie(name) {
    try {
      for (const part of document.cookie.split(";")) {
        const [k, v] = part.trim().split("=");
        if (k === name) return decodeURIComponent(v || "");
      }
    } catch { /* cookies disabled */ }
    return "";
  }

  function readStorage() {
    try {
      return localStorage.getItem(KEY) || "";
    } catch {
      return "";
    }
  }

  function normalize(value) {
    return VALUES.has(value) ? value : "";
  }

  // In-memory copy of the last choice so the page stays consistent even when
  // nothing can be persisted.
  let current = normalize(readStorage()) || normalize(readCookie(KEY));

  // Returns whether the choice will survive a reload. localStorage is
  // best-effort; the cookie is what the server actually reads.
  function persist(value) {
    let stored = false;
    try {
      localStorage.setItem(KEY, value);
      stored = true;
    } catch { /* storage blocked or full */ }
    try {
      document.cookie = `${KEY}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${SECURE}`;
      if (value !== "all") {
        document.cookie = `${VISITOR_KEY}=; Path=/; Max-Age=0; SameSite=Lax${SECURE}`;
      }
      stored = readCookie(KEY) === value || stored;
    } catch { /* cookies disabled */ }
    return stored;
  }

  function setConsent(value) {
    current = normalize(value);
    if (!current) return false;
    return persist(current);
  }

  function getConsent() {
    return current;
  }

  function analyticsAllowed() {
    return current === "all";
  }

  function focusMain() {
    const main = document.getElementById("main-content") || document.querySelector("main");
    if (main && typeof main.focus === "function") {
      if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
      main.focus({ preventScroll: true });
    }
  }

  /* ── Preferences dialog ─────────────────────────────────────────────── */

  let dialog = null;
  let opener = null;

  function buildDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "yr-consent-dialog";
    dialog.setAttribute("aria-labelledby", "yrConsentTitle");
    dialog.setAttribute("aria-describedby", "yrConsentIntro");
    dialog.innerHTML = `
      <form method="dialog" class="yr-consent-dialog__form">
        <h2 id="yrConsentTitle" class="yr-consent-dialog__title">Cookie preferences</h2>
        <p id="yrConsentIntro" class="yr-consent-dialog__intro">Choose which cookies this site may use. Essential cookies keep you signed in and secure, so they cannot be turned off. See our <a href="/cookies">cookie policy</a>.</p>
        <fieldset class="yr-consent-dialog__group">
          <legend class="yr-sr">Cookie categories</legend>
          <label class="yr-consent-dialog__option">
            <input type="checkbox" name="essential" checked disabled>
            <span><b>Essential</b><small>Sign-in, security and your saved preferences. Always on.</small></span>
          </label>
          <label class="yr-consent-dialog__option">
            <input type="checkbox" name="analytics" id="yrConsentAnalytics">
            <span><b>Analytics</b><small>Anonymous view counts that help creators see how their leaderboard is doing.</small></span>
          </label>
        </fieldset>
        <p class="yr-consent-dialog__note" id="yrConsentNote" hidden></p>
        <p class="yr-consent-dialog__status" id="yrConsentStatus" role="status" aria-live="polite"></p>
        <div class="yr-consent__actions">
          <button class="yr-consent__btn" type="button" value="cancel" id="yrConsentCancel">Cancel</button>
          <button class="yr-consent__btn yr-consent__btn--primary" type="submit" id="yrConsentSave">Save preferences</button>
        </div>
      </form>
    `;
    document.body.appendChild(dialog);

    const form = dialog.querySelector("form");
    const analytics = dialog.querySelector("#yrConsentAnalytics");
    const status = dialog.querySelector("#yrConsentStatus");
    const note = dialog.querySelector("#yrConsentNote");

    const cancel = dialog.querySelector("#yrConsentCancel");
    cancel.addEventListener("click", () => dialog.close("cancel"));

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const value = analytics.checked ? "all" : "essential";
      const stored = setConsent(value);
      removeBanner();
      if (stored) {
        status.textContent = value === "all"
          ? "Saved. Analytics cookies are allowed."
          : "Saved. Only essential cookies will be used from now on.";
      } else {
        status.textContent = value === "all"
          ? "Applied for this visit only. Your browser blocks cookies and storage, so this choice cannot be saved."
          : "Applied for this visit. Your browser blocks cookies and storage, so nothing optional can be set anyway.";
      }
      note.hidden = true;
      cancel.textContent = "Close";
    });

    dialog.addEventListener("close", () => {
      status.textContent = "";
      cancel.textContent = "Cancel";
      if (opener && typeof opener.focus === "function" && document.contains(opener)) {
        opener.focus();
      } else {
        focusMain();
      }
      opener = null;
    });

    return dialog;
  }

  function openPreferences(from) {
    const d = buildDialog();
    opener = from || document.activeElement;
    const analytics = d.querySelector("#yrConsentAnalytics");
    const note = d.querySelector("#yrConsentNote");
    analytics.checked = analyticsAllowed();
    const persisted = normalize(readStorage()) || normalize(readCookie(KEY));
    if (current && !persisted) {
      note.textContent = "Your browser is blocking cookies and site storage, so your choice only lasts for this visit.";
      note.hidden = false;
    } else if (!current) {
      note.textContent = "You have not made a choice yet. Until you do, only essential cookies are used.";
      note.hidden = false;
    } else {
      note.hidden = true;
    }
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
    analytics.focus();
  }

  document.addEventListener("click", (e) => {
    const trigger = e.target && e.target.closest && e.target.closest("[data-cookie-preferences]");
    if (!trigger) return;
    e.preventDefault();
    openPreferences(trigger);
  });

  window.yrConsent = { get: getConsent, set: setConsent, open: openPreferences, analyticsAllowed };

  /* ── First-visit banner ─────────────────────────────────────────────── */

  let banner = null;

  function removeBanner() {
    if (banner) { banner.remove(); banner = null; }
  }

  if (current) {
    // Make sure the cookie is in sync with localStorage.
    if (readCookie(KEY) !== current) persist(current);
    return;
  }

  banner = document.createElement("div");
  banner.className = "yr-consent";
  banner.setAttribute("role", "region");
  banner.setAttribute("aria-label", "Cookie consent");
  banner.innerHTML = `
    <span class="yr-consent__text">We use essential cookies to keep you signed in and secure. With your consent, we also use analytics cookies to improve leaderboards. See our <a href="/cookies">cookie policy</a>.</span>
    <div class="yr-consent__actions">
      <button class="yr-consent__btn" id="cookieReject" type="button">Essential only</button>
      <button class="yr-consent__btn" id="cookiePrefs" type="button" data-cookie-preferences>Preferences</button>
      <button class="yr-consent__btn yr-consent__btn--primary" id="cookieAccept" type="button">Accept all</button>
    </div>
  `;
  document.body.appendChild(banner);

  // Removing the banner takes the focused button away with it, so focus moves to
  // the page content instead of falling to the document body.
  function dismiss(value) {
    setConsent(value);
    removeBanner();
    focusMain();
  }

  banner.querySelector("#cookieAccept").addEventListener("click", () => dismiss("all"));
  banner.querySelector("#cookieReject").addEventListener("click", () => dismiss("essential"));
})();
