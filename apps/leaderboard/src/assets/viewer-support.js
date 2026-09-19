// Viewer support and feedback modal. Replaces the full-page /help/support and
// /help/feedback visit for viewers; the pages stay as the no-JS fallback and
// deep link. Messages travel the existing path: POST /api/contact →
// support_messages → SUPPORT_EMAIL, with the same request-id retry contract
// as the page form (see contact.js).
(function () {
  "use strict";
  if (window.YRViewerSupport) return;

  var MODES = {
    support: {
      title: "Contact YourRank support",
      intro: "For YourRank account and website issues. Reward fulfillment is handled by community creators.",
      question: "What do you need help with?",
      categories: [
        { id: "account", label: "Account" },
        { id: "signin", label: "Sign in / connected accounts" },
        { id: "technical", label: "Technical issue" },
        { id: "privacy", label: "Data & privacy" },
        { id: "other", label: "Other" },
      ],
      messageLabel: "Describe the problem",
      placeholder: "What happened, and what did you expect?",
      submit: "Send message",
      kind: "support",
      rewardNote: true,
    },
    feedback: {
      title: "Share feedback",
      intro: "Product feedback about YourRank goes to the YourRank team, not to any creator.",
      question: "What kind of feedback?",
      categories: [
        { id: "bug", label: "Bug" },
        { id: "feature", label: "Feature request" },
        { id: "other", label: "Other" },
      ],
      messageLabel: "Your feedback",
      placeholder: "Share an idea, frustration, or feature request…",
      submit: "Send feedback",
      kind: "feedback",
      rewardNote: false,
    },
  };
  var MIN_MESSAGE = 10;
  var MAX_MESSAGE = 4000;
  var REQUEST_TIMEOUT_MS = 15000;
  var TIMEOUT_MESSAGE = "No reply from the server after 15 seconds, so we kept your draft. Sending again is safe: the same message is stored once.";
  var NETWORK_MESSAGE = "Could not reach the server, so nothing was sent. Check your connection and try again; your draft is still here.";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function icon(path) {
    return '<svg class="viewer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + "</svg>";
  }
  var ICON_CLOSE = icon('<path d="M6 6l12 12M18 6L6 18"/>');
  var ICON_INFO = icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>');
  var ICON_ARROW = icon('<path d="M5 12h14m-6-6 6 6-6 6"/>');
  var ICON_CHECK = icon('<path d="M5 12.5l4.5 4.5L19 7.5"/>');

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.content) return meta.content;
    var match = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }
  function requestId() {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
  }
  // The signed-in viewer's display name is the only account detail the shell
  // knows; viewer identities carry no email, so the email stays a real field.
  function viewerName() {
    var el = document.getElementById("viewer-top-name");
    var text = el ? el.textContent.trim() : "";
    return text && text !== "Sign in" && text !== "Account" ? text : "YourRank viewer";
  }
  function diagnostics() {
    return "\n\n— Diagnostics —\nPage: " + location.href + "\nBrowser: " + navigator.userAgent + "\nViewport: " + window.innerWidth + "×" + window.innerHeight;
  }

  /**
   * Resolve the community whose creator fulfils rewards for the page the
   * viewer is on. Account pages carry it through the help link's `return`
   * target (`/<slug>/...`); community pages carry it on the body.
   */
  function communityContact(returnTo) {
    var body = document.body;
    var known = body.dataset.creatorContact;
    var available = known === "true" ? true : known === "false" ? false : null;
    if (body.dataset.customDomain === "true" && body.dataset.slug) return { slug: body.dataset.slug, href: "/contact", available: available };
    var slug = body.dataset.slug || "";
    if (!slug && returnTo) {
      var target;
      try { target = new URL(returnTo, location.origin); } catch (_) { target = null; }
      var match = target && /^\/([a-z0-9][a-z0-9_-]{0,62})(?:\/|$)/.exec(target.pathname);
      if (match && match[1] === "me") slug = target.searchParams.get("community") || "";
      else if (match && match[1] !== "help") slug = match[1];
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(slug)) return null;
    return { slug: slug, href: "/" + slug + "/contact", available: body.dataset.slug ? available : null };
  }

  /**
   * The creator link is only offered when the community has a real contact
   * method. Community pages state that on the body; account pages only know
   * the slug, so the note asks the public site record and fills in after.
   */
  function rewardNoteHtml(contact) {
    var head = "<b>Reward or claim issue?</b>";
    if (!contact) return '<aside class="yr-support-note" data-support-reward-note="none">' + ICON_INFO + "<div>" + head + "<p>Rewards are managed by the community creator, not YourRank.</p></div></aside>";
    if (contact.available === true) {
      return '<aside class="yr-support-note" data-support-reward-note="available">' + ICON_INFO + "<div>" + head + "<p>Rewards are managed by the community creator.</p>" +
        '<a href="' + esc(contact.href) + '" data-support-creator>Contact creator ' + ICON_ARROW + "</a></div></aside>";
    }
    if (contact.available === false) {
      return '<aside class="yr-support-note" data-support-reward-note="unavailable">' + ICON_INFO + "<div>" + head + "<p>This creator hasn't provided a contact method yet.</p></div></aside>";
    }
    return '<aside class="yr-support-note" data-support-reward-note="pending" data-support-contact-slug="' + esc(contact.slug) + '">' + ICON_INFO + "<div>" + head + "<p>Rewards are managed by the community creator, not YourRank.</p></div></aside>";
  }

  function resolveRewardNote(root, contact) {
    var note = root.querySelector('[data-support-reward-note="pending"]');
    if (!note || !contact) return;
    fetch("/api/public/" + encodeURIComponent(contact.slug), { credentials: "same-origin", headers: { accept: "application/json" } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!note.isConnected) return;
        var known = data && typeof data.contactAvailable === "boolean" ? data.contactAvailable : null;
        var resolved = { slug: contact.slug, href: contact.href, available: known };
        if (resolved.available === null) { note.setAttribute("data-support-reward-note", "unknown"); return; }
        note.outerHTML = rewardNoteHtml(resolved);
      })
      .catch(function () { if (note.isConnected) note.setAttribute("data-support-reward-note", "unknown"); });
  }

  function formHtml(mode, options) {
    var contact = mode.rewardNote ? communityContact(options.returnTo) : null;
    var chips = mode.categories.map(function (category, index) {
      return '<label class="yr-support-chip"><input type="radio" name="category" value="' + esc(category.id) + '"' + (index === 0 ? " checked" : "") + '><span>' + esc(category.label) + "</span></label>";
    }).join("");
    return '<form class="yr-support-form" novalidate>' +
      '<div class="yr-support-head"><h2 id="yr-support-title">' + esc(mode.title) + '</h2>' +
      '<button type="button" class="yr-support-close" data-support-close aria-label="Close">' + ICON_CLOSE + "</button></div>" +
      '<p class="yr-support-intro" id="yr-support-intro">' + esc(mode.intro) + "</p>" +
      '<fieldset class="yr-support-categories"><legend>' + esc(mode.question) + "</legend><div>" + chips + "</div></fieldset>" +
      '<div class="yr-support-field"><label for="yr-support-email">Email</label>' +
      '<input id="yr-support-email" name="email" type="email" autocomplete="email" required maxlength="254" inputmode="email" aria-describedby="yr-support-email-err">' +
      '<p class="yr-support-err" id="yr-support-email-err"></p></div>' +
      '<div class="yr-support-field"><label for="yr-support-message">' + esc(mode.messageLabel) + "</label>" +
      '<textarea id="yr-support-message" name="message" rows="4" required minlength="' + MIN_MESSAGE + '" maxlength="' + MAX_MESSAGE + '" placeholder="' + esc(mode.placeholder) + '" aria-describedby="yr-support-message-err"></textarea>' +
      '<p class="yr-support-err" id="yr-support-message-err"></p></div>' +
      (mode.kind === "support"
        ? '<label class="yr-support-toggle" data-support-diagnostics hidden><span><b>Include diagnostics</b><small>Page address, browser and screen size. Helps us reproduce the issue.</small></span>' +
          '<input type="checkbox" name="diagnostics" role="switch"><i aria-hidden="true"></i></label>'
        : "") +
      '<p class="yr-support-status" role="alert" aria-live="assertive"></p>' +
      (mode.rewardNote ? rewardNoteHtml(contact) : "") +
      '<div class="yr-support-actions"><button type="button" class="btn btn--ghost" data-support-close>Cancel</button>' +
      '<button type="submit" class="btn btn--accent" data-support-submit>' + esc(mode.submit) + "</button></div></form>";
  }

  function successHtml(mode) {
    return '<div class="yr-support-success" role="status" tabindex="-1"><span class="yr-support-success-mark">' + ICON_CHECK + "</span>" +
      '<h2 id="yr-support-title">Message sent</h2>' +
      "<p>YourRank received your " + (mode.kind === "feedback" ? "feedback" : "message") + ".<br>We'll reply to the email you provided if a response is needed.</p>" +
      '<button type="button" class="btn btn--accent" data-support-close>Close</button></div>';
  }

  var dialog = null;
  var opener = null;
  var pending = false;
  var currentMode = null;
  var abortPending = null;

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "yr-modal yr-support-modal";
    dialog.setAttribute("aria-labelledby", "yr-support-title");
    document.body.appendChild(dialog);
    // Escape: the browser fires `cancel` before closing; a submit in flight keeps the draft.
    dialog.addEventListener("cancel", function (event) { if (pending) event.preventDefault(); });
    // Click on the backdrop lands on the dialog itself, not on its content.
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog && !pending) close();
      var closer = event.target.closest && event.target.closest("[data-support-close]");
      if (closer && !pending) close();
    });
    dialog.addEventListener("close", function () {
      document.body.classList.remove("yr-support-open");
      dialog.innerHTML = "";
      var previous = opener;
      opener = null;
      if (previous && typeof previous.focus === "function" && previous.isConnected) previous.focus();
    });
    dialog.addEventListener("change", function (event) {
      if (event.target.name !== "category") return;
      var toggle = dialog.querySelector("[data-support-diagnostics]");
      if (toggle) toggle.hidden = event.target.value !== "technical";
    });
    dialog.addEventListener("submit", submit);
    return dialog;
  }

  function fieldError(input, text) {
    var el = document.getElementById(input.id + "-err");
    if (el) el.textContent = text || "";
    if (text) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  function validate(form) {
    var email = form.elements.email;
    var message = form.elements.message;
    var problems = [];
    var emailValue = email.value.trim();
    var messageValue = message.value.trim();
    fieldError(email, ""); fieldError(message, "");
    if (!emailValue) problems.push([email, "Email is required so we can reply."]);
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue) || emailValue.length > 254) problems.push([email, "Enter an email address like name@example.com."]);
    if (messageValue.length < MIN_MESSAGE) problems.push([message, "Write at least " + MIN_MESSAGE + " characters (currently " + messageValue.length + ")."]);
    else if (messageValue.length > MAX_MESSAGE) problems.push([message, "Keep the message to " + MAX_MESSAGE + " characters or fewer."]);
    problems.forEach(function (problem) { fieldError(problem[0], problem[1]); });
    if (problems.length) problems[0][0].focus();
    return !problems.length;
  }

  function setPending(form, value) {
    pending = value;
    var button = form.querySelector("[data-support-submit]");
    button.disabled = value;
    if (value) button.setAttribute("aria-busy", "true"); else button.removeAttribute("aria-busy");
    button.textContent = value ? "Sending…" : currentMode.submit;
    form.querySelectorAll("[data-support-close]").forEach(function (el) { el.disabled = value; });
  }

  async function submit(event) {
    event.preventDefault();
    var form = event.target;
    if (pending || !form.classList.contains("yr-support-form")) return;
    var status = form.querySelector(".yr-support-status");
    status.textContent = "";
    if (!validate(form)) return;
    if (!form.dataset.requestId) form.dataset.requestId = requestId();
    var category = form.querySelector('input[name="category"]:checked');
    var categoryLabel = "";
    currentMode.categories.forEach(function (item) { if (category && item.id === category.value) categoryLabel = item.label; });
    var message = form.elements.message.value.trim();
    var includeDiagnostics = form.elements.diagnostics && form.elements.diagnostics.checked && category && category.value === "technical";
    if (includeDiagnostics) message = (message + diagnostics()).slice(0, MAX_MESSAGE);
    var payload = {
      name: viewerName(),
      email: form.elements.email.value.trim(),
      subject: categoryLabel,
      message: message,
      kind: currentMode.kind,
      context: "",
      requestId: form.dataset.requestId,
    };
    abortPending = new AbortController();
    var timer = setTimeout(function () { abortPending.abort(); }, REQUEST_TIMEOUT_MS);
    setPending(form, true);
    try {
      var response = await fetch("/api/contact", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken() },
        body: JSON.stringify(payload),
        signal: abortPending.signal,
      });
      var body = await response.json().catch(function () { return {}; });
      if (response.ok) {
        pending = false;
        dialog.innerHTML = successHtml(currentMode);
        dialog.querySelector(".yr-support-success").focus();
        return;
      }
      if (response.status === 429) status.textContent = body.error || "Too many messages from this connection. Wait a few minutes, then send again; your draft is still here.";
      else if (response.status >= 500) status.textContent = "The server could not save your message right now. Nothing was sent; your draft is still here, so try again in a moment.";
      else status.textContent = body.error || "Something went wrong. Your draft is still here; try again.";
    } catch (cause) {
      status.textContent = abortPending.signal.aborted || (cause && cause.name === "AbortError") ? TIMEOUT_MESSAGE : NETWORK_MESSAGE;
    } finally {
      clearTimeout(timer);
      if (form.isConnected) setPending(form, false);
      pending = false;
    }
  }

  function open(options) {
    var opts = options || {};
    var mode = MODES[opts.mode] || MODES.support;
    if (pending) return false;
    var el = ensureDialog();
    if (el.open) el.close();
    currentMode = mode;
    opener = opts.opener || document.activeElement;
    el.innerHTML = formHtml(mode, opts);
    if (mode.rewardNote) resolveRewardNote(el, communityContact(opts.returnTo));
    document.body.classList.add("yr-support-open");
    if (typeof el.showModal === "function") el.showModal(); else el.setAttribute("open", "");
    var first = el.querySelector('input[name="category"]:checked') || el.querySelector("[data-support-close]");
    if (first) first.focus();
    return true;
  }

  function close() {
    if (!dialog || pending) return false;
    if (dialog.open) dialog.close();
    else { dialog.removeAttribute("open"); dialog.dispatchEvent(new Event("close")); }
    return true;
  }

  /** `/help/support?audience=viewer&return=…` and `/help/feedback?…` links open the modal. */
  function modeForLink(link) {
    var target;
    try { target = new URL(link.href, location.href); } catch (_) { return null; }
    if (target.origin !== location.origin) return null;
    var mode = target.pathname === "/help/support" ? "support" : target.pathname === "/help/feedback" ? "feedback" : null;
    if (!mode || target.searchParams.get("audience") !== "viewer") return null;
    return { mode: mode, returnTo: target.searchParams.get("return") || "" };
  }

  window.YRViewerSupport = { open: open, close: close, modeForLink: modeForLink, isOpen: function () { return !!(dialog && dialog.open); }, isPending: function () { return pending; } };
  window.YRInitViewerSupport = function () { return window.YRViewerSupport; };
})();
