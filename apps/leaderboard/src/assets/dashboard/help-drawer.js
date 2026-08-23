// ============================================================================
//  YourRank — Unified Help & Support Drawer + Quick Feedback Modal
// ============================================================================

(function () {
  function getCsrf() {
    const m = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  let drawerEl = null;
  let backdropEl = null;
  let activeTab = "guides";
  let userCache = null;

  function ensureUser() {
    if (userCache) return Promise.resolve(userCache);
    return fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        userCache = data?.user || { email: "", displayName: "" };
        return userCache;
      })
      .catch(() => ({ email: "", displayName: "" }));
  }

  function createDrawer() {
    if (drawerEl) return;

    backdropEl = document.createElement("div");
    backdropEl.id = "yrHelpBackdrop";
    backdropEl.className = "yr-help-backdrop";
    backdropEl.hidden = true;
    document.body.appendChild(backdropEl);

    drawerEl = document.createElement("div");
    drawerEl.id = "yrHelpDrawer";
    drawerEl.className = "yr-help-drawer";
    drawerEl.setAttribute("role", "dialog");
    drawerEl.setAttribute("aria-modal", "true");
    drawerEl.setAttribute("aria-labelledby", "yrHelpTitle");
    drawerEl.hidden = true;

    drawerEl.innerHTML = `
      <div class="yr-help-header">
        <div class="yr-help-title-row">
          <div class="yr-help-title" id="yrHelpTitle">
            <span class="yr-help-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </span>
            <strong>Help &amp; Feedback</strong>
          </div>
          <button type="button" class="yr-help-close" id="yrHelpClose" aria-label="Close drawer">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="yr-help-tabs" role="tablist">
          <button type="button" class="yr-help-tab is-active" data-tab="guides" role="tab" aria-selected="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            <span>Guides</span>
          </button>
          <button type="button" class="yr-help-tab" data-tab="support" role="tab" aria-selected="false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>Support</span>
          </button>
          <button type="button" class="yr-help-tab" data-tab="feedback" role="tab" aria-selected="false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
            <span>Feedback</span>
          </button>
        </div>
      </div>

      <div class="yr-help-body">
        <!-- Panel 1: Quick Guides -->
        <div class="yr-help-panel is-active" id="yrPanelGuides" role="tabpanel">
          <div class="yr-help-search-wrap">
            <svg class="yr-help-search-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input type="search" id="yrHelpSearch" class="yr-help-search" placeholder="Search guides, setup tips..." aria-label="Search guides" />
          </div>

          <div class="yr-help-guides-list" id="yrHelpGuidesList">
            <div class="yr-guide-card" data-keywords="what is leaderboard setup create players rank points share publish">
              <div class="yr-guide-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-2.34"/><path d="M14 14.66V17c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-2.34"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
              </div>
              <div class="yr-guide-info">
                <strong>What is a leaderboard?</strong>
                <p>It is a public page that ranks your players by points or amount. Add players, publish, then share the live link.</p>
                <a href="/dashboard/leaderboard/setup" class="yr-guide-link">Set up a leaderboard →</a>
              </div>
            </div>

            <div class="yr-guide-card" data-keywords="players scores points add import csv spreadsheet wagers">
              <div class="yr-guide-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div class="yr-guide-info">
                <strong>Managing Players &amp; Scores</strong>
                <p>Inline spreadsheet editing, bulk score additions, and CSV imports.</p>
                <a href="/dashboard/leaderboard/players" class="yr-guide-link">Go to Players Editor →</a>
              </div>
            </div>

            <div class="yr-guide-card" data-keywords="obs stream overlay browser source twitch kick">
              <div class="yr-guide-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="15" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="18" y2="21"/></svg>
              </div>
              <div class="yr-guide-info">
                <strong>Adding to OBS Browser Source</strong>
                <p>Open the Share tab, copy your OBS link, then add it in OBS as a browser source set to 1100px.</p>
                <a href="/dashboard/leaderboard/share" class="yr-guide-link">Get OBS URL &amp; Embed →</a>
              </div>
            </div>

            <div class="yr-guide-card" data-keywords="kick channel points rewards shop credits redemptions">
              <div class="yr-guide-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>
              </div>
              <div class="yr-guide-info">
                <strong>Kick channel points &amp; Rewards</strong>
                <p>Link Kick channel, create ways to earn, and manage orders.</p>
                <a href="/dashboard/site/connections" class="yr-guide-link">Connect Kick Channel →</a>
              </div>
            </div>

            <div class="yr-guide-card" data-keywords="telegram bot token broadcasts commands subscribers">
              <div class="yr-guide-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 10l-4 4l6 6l4-16l-18 7l4 2l2 6l3-4"/></svg>
              </div>
              <div class="yr-guide-info">
                <strong>Telegram Community Bot</strong>
                <p>Connect your bot with a connect code, customize /commands, and send broadcasts.</p>
                <a href="/dashboard/telegram" class="yr-guide-link">Open Telegram Bot →</a>
              </div>
            </div>

            <div class="yr-guide-card" data-keywords="billing subscription plan pro starter crypto payment">
              <div class="yr-guide-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
              </div>
              <div class="yr-guide-info">
                <strong>Plans &amp; Upgrades</strong>
                <p>Upgrade to Pro for unlimited sites, players, and custom domains.</p>
                <a href="/dashboard/settings" class="yr-guide-link">Manage Account &amp; Billing →</a>
              </div>
            </div>
          </div>

          <div class="yr-help-community-card">
            <div class="yr-community-copy">
              <strong>Need immediate chat help?</strong>
              <p>Join the official creator community on Telegram for quick answers.</p>
            </div>
            <a href="https://t.me/yourrank" target="_blank" rel="noopener" class="btn btn--sm btn--accent">Join Telegram Community ↗</a>
          </div>
        </div>

        <!-- Panel 2: Contact Support -->
        <div class="yr-help-panel" id="yrPanelSupport" role="tabpanel" hidden>
          <form id="yrSupportForm" class="yr-help-form">
            <div class="yr-context-badge">
              <span class="yr-context-dot">●</span>
              <span id="yrSupportContext">Diagnostics &amp; site context auto-attached</span>
            </div>
            <div class="field">
              <label for="yr_support_subject">Subject <span class="text-danger">*</span></label>
              <input id="yr_support_subject" name="subject" type="text" placeholder="What do you need help with?" required maxlength="120" />
            </div>
            <div class="field">
              <div class="d-flex justify-between items-center mb-4">
                <label for="yr_support_message">Message <span class="text-danger">*</span></label>
                <span class="yr-char-count text-xs muted" id="yrSupportCount">0 / 4000</span>
              </div>
              <textarea id="yr_support_message" name="message" rows="5" placeholder="Describe the issue, what happened, and what you expected..." required minlength="10" maxlength="4000"></textarea>
            </div>
            <div class="err" id="yr_support_err" role="alert" aria-live="assertive"></div>
            <div class="yr-form-success" id="yr_support_success" hidden>
              <div class="yr-success-check">✓</div>
              <strong>Support ticket sent!</strong>
              <p>We'll reply to your account email shortly.</p>
            </div>
            <div class="d-flex gap-8 items-center mt-sm">
              <button type="submit" class="btn btn--accent grow" id="yr_support_submit">Send Support Ticket 🚀</button>
              <button type="button" class="btn btn--ghost" data-action="closeDrawer">Cancel</button>
            </div>
            <p class="hint ta-c mt-8">⚡ Average response time: <strong>&lt; 2 hours</strong></p>
          </form>
        </div>

        <!-- Panel 3: Give Feedback -->
        <div class="yr-help-panel" id="yrPanelFeedback" role="tabpanel" hidden>
          <form id="yrFeedbackForm" class="yr-help-form">
            <div class="field">
              <label class="mb-6 d-block">Feedback Category</label>
              <div class="yr-feedback-categories">
                <label class="yr-category-chip is-selected">
                  <input type="radio" name="kind_cat" value="idea" checked />
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                  <span>Feature Idea</span>
                </label>
                <label class="yr-category-chip">
                  <input type="radio" name="kind_cat" value="bug" />
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>
                  <span>Bug Report</span>
                </label>
                <label class="yr-category-chip">
                  <input type="radio" name="kind_cat" value="general" />
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  <span>General</span>
                </label>
              </div>
            </div>

            <div class="field">
              <label class="mb-4 d-block">Quick topic tags</label>
              <div class="yr-feedback-tags">
                <button type="button" class="yr-tag-prompt" data-insert="[Games] ">⚡ Games</button>
                <button type="button" class="yr-tag-prompt" data-insert="[Design] ">🎨 Custom Styling</button>
                <button type="button" class="yr-tag-prompt" data-insert="[Telegram] ">🤖 Telegram Bot</button>
                <button type="button" class="yr-tag-prompt" data-insert="[Rewards] ">🎁 Loyalty &amp; Shop</button>
                <button type="button" class="yr-tag-prompt" data-insert="[Overlay] ">📺 Stream Overlay</button>
              </div>
            </div>

            <div class="field">
              <div class="d-flex justify-between items-center mb-4">
                <label for="yr_feedback_message">Your Feedback <span class="text-danger">*</span></label>
                <span class="yr-char-count text-xs muted" id="yrFeedbackCount">0 / 4000</span>
              </div>
              <textarea id="yr_feedback_message" name="message" rows="5" placeholder="Share an idea, feedback, or feature request..." required minlength="5" maxlength="4000"></textarea>
            </div>

            <div class="err" id="yr_feedback_err" role="alert" aria-live="assertive"></div>
            <div class="yr-form-success" id="yr_feedback_success" hidden>
              <div class="yr-success-check">🎉</div>
              <strong>Thanks for your feedback!</strong>
              <p>Every suggestion directly shapes future YourRank updates.</p>
            </div>
            
            <div class="d-flex gap-8 items-center mt-sm">
              <button type="submit" class="btn btn--accent grow" id="yr_feedback_submit">Send Feedback ✨</button>
              <button type="button" class="btn btn--ghost" data-action="closeDrawer">Cancel</button>
            </div>

            <div class="yr-context-badge mt-8">
              <span class="yr-context-dot">●</span>
              <span id="yrFeedbackContext">Submitting as creator account</span>
            </div>
          </form>
        </div>
      </div>
    `;

    document.body.appendChild(drawerEl);
    bindDrawerEvents();
  }

  function bindDrawerEvents() {
    const closeBtn = drawerEl.querySelector("#yrHelpClose");
    closeBtn?.addEventListener("click", () => close());
    backdropEl?.addEventListener("click", () => close());

    drawerEl.querySelectorAll('[data-action="closeDrawer"]').forEach((btn) => {
      btn.addEventListener("click", () => close());
    });

    const tabs = drawerEl.querySelectorAll(".yr-help-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        switchTab(tab.dataset.tab);
      });
    });

    // Category chips selection
    const catChips = drawerEl.querySelectorAll(".yr-category-chip");
    catChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        catChips.forEach((c) => c.classList.remove("is-selected"));
        chip.classList.add("is-selected");
      });
    });

    // Quick tag insertion
    drawerEl.querySelectorAll(".yr-tag-prompt").forEach((tagBtn) => {
      tagBtn.addEventListener("click", () => {
        const txt = tagBtn.getAttribute("data-insert") || "";
        const textarea = drawerEl.querySelector("#yr_feedback_message");
        if (!textarea) return;
        if (!textarea.value.startsWith(txt)) {
          textarea.value = txt + textarea.value;
        }
        textarea.focus();
        updateFeedbackCount();
      });
    });

    // Character counters
    const feedbackMsg = drawerEl.querySelector("#yr_feedback_message");
    const feedbackCountEl = drawerEl.querySelector("#yrFeedbackCount");
    function updateFeedbackCount() {
      if (feedbackCountEl && feedbackMsg) {
        feedbackCountEl.textContent = `${feedbackMsg.value.length} / 4000`;
      }
    }
    feedbackMsg?.addEventListener("input", updateFeedbackCount);

    const supportMsg = drawerEl.querySelector("#yr_support_message");
    const supportCountEl = drawerEl.querySelector("#yrSupportCount");
    supportMsg?.addEventListener("input", () => {
      if (supportCountEl && supportMsg) {
        supportCountEl.textContent = `${supportMsg.value.length} / 4000`;
      }
    });

    // Live search in guides
    const searchInput = drawerEl.querySelector("#yrHelpSearch");
    searchInput?.addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      const cards = drawerEl.querySelectorAll(".yr-guide-card");
      cards.forEach((card) => {
        const text = (card.textContent + " " + (card.dataset.keywords || "")).toLowerCase();
        card.hidden = q && !text.includes(q);
      });
    });

    // Guide links click (close drawer so they can navigate smoothly)
    drawerEl.querySelectorAll(".yr-guide-link").forEach((link) => {
      link.addEventListener("click", () => close());
    });

    // Support Form submit
    const supportForm = drawerEl.querySelector("#yrSupportForm");
    supportForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = drawerEl.querySelector("#yr_support_err");
      const success = drawerEl.querySelector("#yr_support_success");
      const submitBtn = drawerEl.querySelector("#yr_support_submit");
      if (err) err.textContent = "";
      if (success) success.hidden = true;

      const user = await ensureUser();
      const subject = drawerEl.querySelector("#yr_support_subject")?.value || "";
      const message = drawerEl.querySelector("#yr_support_message")?.value || "";

      submitBtn.disabled = true;
      submitBtn.textContent = "Sending ticket...";

      try {
        const res = await fetch("/api/contact", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": getCsrf(),
          },
          body: JSON.stringify({
            name: user.displayName || user.email || "Creator",
            email: user.email || "support-request@yourrank.site",
            kind: "support",
            subject,
            message,
            context: location.pathname + location.search,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          if (success) success.hidden = false;
          supportForm.reset();
          if (supportCountEl) supportCountEl.textContent = "0 / 4000";
          setTimeout(() => close(), 2500);
        } else {
          if (err) err.textContent = body.error || "Failed to send ticket. Please try again.";
        }
      } catch (e) {
        if (err) err.textContent = "Network error. Please check your connection.";
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Send Support Ticket 🚀";
      }
    });

    // Feedback Form submit
    const feedbackForm = drawerEl.querySelector("#yrFeedbackForm");
    feedbackForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = drawerEl.querySelector("#yr_feedback_err");
      const success = drawerEl.querySelector("#yr_feedback_success");
      const submitBtn = drawerEl.querySelector("#yr_feedback_submit");
      if (err) err.textContent = "";
      if (success) success.hidden = true;

      const user = await ensureUser();
      const selectedCat = drawerEl.querySelector('input[name="kind_cat"]:checked')?.value || "idea";
      const message = drawerEl.querySelector("#yr_feedback_message")?.value || "";

      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting feedback...";

      try {
        const res = await fetch("/api/contact", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": getCsrf(),
          },
          body: JSON.stringify({
            name: user.displayName || user.email || "Creator",
            email: user.email || "feedback@yourrank.site",
            kind: "feedback",
            subject: `[${selectedCat.toUpperCase()}] Creator Feedback`,
            message,
            context: location.pathname + location.search,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          if (success) success.hidden = false;
          feedbackForm.reset();
          if (feedbackCountEl) feedbackCountEl.textContent = "0 / 4000";
          setTimeout(() => close(), 2500);
        } else {
          if (err) err.textContent = body.error || "Failed to submit feedback. Please try again.";
        }
      } catch (e) {
        if (err) err.textContent = "Network error. Please check your connection.";
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Send Feedback ✨";
      }
    });

    // Keydown escape listener
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && drawerEl && !drawerEl.hidden) {
        close();
      }
    });
  }

  function switchTab(tabName) {
    activeTab = tabName || "guides";
    if (!drawerEl) return;

    drawerEl.querySelectorAll(".yr-help-tab").forEach((tab) => {
      const on = tab.dataset.tab === activeTab;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });

    const panels = {
      guides: drawerEl.querySelector("#yrPanelGuides"),
      support: drawerEl.querySelector("#yrPanelSupport"),
      feedback: drawerEl.querySelector("#yrPanelFeedback"),
    };

    Object.keys(panels).forEach((k) => {
      const p = panels[k];
      if (!p) return;
      if (k === activeTab) {
        p.hidden = false;
        p.classList.add("is-active");
      } else {
        p.hidden = true;
        p.classList.remove("is-active");
      }
    });
  }

  function open(tab) {
    createDrawer();
    ensureUser().then((u) => {
      const email = u?.email || "creator";
      const fbCtx = drawerEl?.querySelector("#yrFeedbackContext");
      if (fbCtx) fbCtx.textContent = `Submitting as: ${email}`;
      const spCtx = drawerEl?.querySelector("#yrSupportContext");
      if (spCtx) spCtx.textContent = `Account: ${email} • Diagnostics auto-attached`;
    });
    switchTab(tab || "guides");
    backdropEl.hidden = false;
    drawerEl.hidden = false;
    setTimeout(() => {
      backdropEl.classList.add("is-open");
      drawerEl.classList.add("is-open");
    }, 10);
  }

  function close() {
    if (!drawerEl || drawerEl.hidden) return;
    backdropEl.classList.remove("is-open");
    drawerEl.classList.remove("is-open");
    setTimeout(() => {
      backdropEl.hidden = true;
      drawerEl.hidden = true;
    }, 200);
  }

  // Global listeners for buttons linking to help or feedback
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-open-help], [data-open-feedback], [data-open-support], .lb-nav[data-nav='help'], a[href^='/help/support'], a[href^='/help/feedback'], a[href^='/help']");
    if (!trigger) return;

    // If it's a direct navigation with modifier keys, let default happen
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;

    const href = trigger.getAttribute("href") || "";
    const isFeedback = trigger.hasAttribute("data-open-feedback") || href.includes("/help/feedback");
    const isSupport = trigger.hasAttribute("data-open-support") || href.includes("/help/support");

    e.preventDefault();
    open(isFeedback ? "feedback" : isSupport ? "support" : "guides");
  });

  window.YRHelpDrawer = { open, close, switchTab };
})();
