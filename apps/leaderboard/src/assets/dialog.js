// The app's one dialog. Confirmations, prompts and the broadcast preview were
// three hand-written implementations of the same box — three focus traps, three
// sets of inline styles, three sets of ARIA attributes to get wrong. Loaded as a
// plain script by both Workers (like shell-nav.js) and exposed as window.YRDialog.
//
// window.YRDialog.confirm({ title, body, confirmText, danger }) → Promise<boolean>
// window.YRDialog.prompt({ title, body, value, type, placeholder }) → Promise<string|null>
// window.YRDialog.open({ ...,  render(card) }) → { close(value), el }  for custom content
// window.YRDialog.trap(element, onEscape) → release()   for dialogs already in the markup
(function () {
  var FOCUSABLE = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
  var openCount = 0;
  var INERT_SKIP = /^(HEAD|SCRIPT|STYLE|LINK|META|TEMPLATE|TITLE)$/;

  function uid(prefix) { return prefix + Math.random().toString(36).slice(2, 8); }

  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), function (el) {
      return !el.disabled && el.offsetParent !== null;
    });
  }

  /**
   * Take everything outside `el` out of the tab order and the accessibility
   * tree. The Tab handler below keeps keyboard focus in the dialog, but without
   * this the page behind it is still clickable and still readable by a screen
   * reader, which is what "modal" is supposed to rule out. Live regions stay
   * announceable so a toast raised by the dialog is not silenced.
   */
  function inertOutside(el) {
    var applied = [];
    var node = el;
    while (node && node.parentElement) {
      Array.prototype.forEach.call(node.parentElement.children, function (sibling) {
        if (sibling === node || sibling.inert) return;
        if (INERT_SKIP.test(sibling.tagName)) return;
        if (sibling.hasAttribute("aria-live") || sibling.getAttribute("role") === "status" || sibling.getAttribute("role") === "alert") return;
        sibling.inert = true;
        applied.push(sibling);
      });
      node = node.parentElement;
    }
    return function release() {
      applied.forEach(function (element) { element.inert = false; });
    };
  }

  /**
   * Keep Tab and Escape inside `el` until the returned function is called, and
   * put focus back where it was. Markup-rendered dialogs (the broadcast
   * preview) use this rather than owning another copy of the trap.
   */
  function trap(el, onEscape) {
    var trigger = document.activeElement;
    var releaseInert = inertOutside(el);
    function handler(e) {
      if (e.key === "Escape") { e.preventDefault(); onEscape(); return; }
      if (e.key !== "Tab") return;
      var f = focusables(el);
      if (!f.length) return;
      var first = f[0];
      var last = f[f.length - 1];
      if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", handler, true);
    var first = focusables(el)[0];
    if (first) first.focus();
    return function release() {
      document.removeEventListener("keydown", handler, true);
      releaseInert();
      if (trigger && trigger.focus) trigger.focus();
    };
  }

  function open(opts) {
    var titleId = uid("yrd-t");
    var descId = uid("yrd-d");

    var overlay = document.createElement("div");
    overlay.className = "modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", titleId);
    if (opts.body) overlay.setAttribute("aria-describedby", descId);

    var card = document.createElement("div");
    card.className = "modal-card";
    card.setAttribute("role", "document");

    var h = document.createElement("h3");
    h.id = titleId;
    h.textContent = opts.title || "";
    card.appendChild(h);

    if (opts.body) {
      var p = document.createElement("p");
      p.id = descId;
      p.textContent = opts.body;
      card.appendChild(p);
    }

    var actions = document.createElement("div");
    actions.className = "modal-actions";

    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn--sm btn--ghost ghost";
    cancel.textContent = opts.cancelText || "Cancel";

    var confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "btn btn--sm " + (opts.danger ? "btn--danger danger" : "btn--accent");
    confirm.textContent = opts.confirmText || "Confirm";

    var extra = typeof opts.render === "function" ? opts.render(card) : null;

    actions.appendChild(cancel);
    actions.appendChild(confirm);
    card.appendChild(actions);
    overlay.appendChild(card);

    var release;
    function close(value) {
      if (release) release();
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      openCount = Math.max(0, openCount - 1);
      // A dialog is modal: the page behind it must not scroll.
      if (!openCount) document.documentElement.classList.remove("yr-modal-open");
      if (opts.onClose) opts.onClose(value);
    }

    cancel.addEventListener("click", function () { close(opts.escapeValue); });
    confirm.addEventListener("click", function () { close(opts.confirmValue ? opts.confirmValue(extra) : true); });
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(opts.escapeValue); });

    document.body.appendChild(overlay);
    openCount += 1;
    document.documentElement.classList.add("yr-modal-open");
    release = trap(overlay, function () { close(opts.escapeValue); });
    // The trap focuses the first control; the useful one is the input, or the
    // action the dialog is asking about — except for a destructive one, where
    // Enter should not be able to delete something by reflex.
    (extra && extra.focus ? extra : (opts.danger ? cancel : confirm)).focus();

    return { el: overlay, card: card, close: close };
  }

  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      open({
        title: opts.title,
        body: opts.body,
        confirmText: opts.confirmText || "Confirm",
        danger: !!opts.danger,
        escapeValue: false,
        onClose: resolve,
      });
    });
  }

  function promptDialog(opts) {
    return new Promise(function (resolve) {
      var input;
      open({
        title: opts.title,
        body: opts.body,
        confirmText: opts.confirmText || "OK",
        escapeValue: null,
        confirmValue: function () { return input.value; },
        render: function (card) {
          input = document.createElement("input");
          input.className = "modal-input";
          input.type = opts.type || "text";
          input.value = opts.value || "";
          input.placeholder = opts.placeholder || "";
          if (opts.label) input.setAttribute("aria-label", opts.label);
          card.appendChild(input);
          return input;
        },
        onClose: resolve,
      }).card.querySelector(".modal-input").addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); e.target.closest(".modal").querySelector(".btn--accent").click(); }
      });
    });
  }

  window.YRDialog = { open: open, confirm: confirmDialog, prompt: promptDialog, trap: trap };
})();
