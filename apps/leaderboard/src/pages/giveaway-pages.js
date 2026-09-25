// Markup for Giveaways (Chat Giveaways primary; Raffles, Predictions and
// Tournaments secondary). Code Drops are owned by Activities.

import { engageTabsHtml } from "./engage-tabs.jsx";

export const GIVEAWAY_TABS = [
  ["chat", "Chat giveaways"],
  ["raffles", "Raffles"],
  ["preds", "Predictions"],
  ["tournaments", "Tournaments"],
];

const giveawayPath = (tab) => `/dashboard/giveaways/${tab === "preds" ? "predictions" : tab}`;

export function renderGiveawayDrawersHtml() {
  return `
<!-- Create Prediction Drawer -->
<div class="gw-drawer-backdrop" id="pred-drawer" hidden>
  <div class="gw-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="pred-drawer-title">
    <div class="gw-drawer-head">
      <h2 id="pred-drawer-title">Create Live Prediction</h2>
      <button class="gw-modal-close-btn" id="pred-drawer-close" type="button" aria-label="Close">✕</button>
    </div>
    <form id="pred-form" class="gw-drawer-body">
      <div class="gw-drawer-fields">
      <div class="field">
        <label for="pred-title">Prediction Question *</label>
        <input type="text" id="pred-title" placeholder="e.g. Will I clutch this 1v3 round?" required />
        <span class="field-err" data-field-error="pred-title" role="alert" aria-live="polite"></span>
        <span class="hint">What are your viewers predicting?</span>
      </div>

      <div class="field">
        <label>Options</label>
        <div class="grid2">
          <div>
            <label for="pred-opt-1" class="font-12 font-muted">Option A (Yes)</label>
            <input type="text" id="pred-opt-1" value="Yes" required />
            <span class="field-err" data-field-error="pred-opt-1" role="alert" aria-live="polite"></span>
          </div>
          <div>
            <label for="pred-opt-2" class="font-12 font-muted">Option B (No)</label>
            <input type="text" id="pred-opt-2" value="No" required />
            <span class="field-err" data-field-error="pred-opt-2" role="alert" aria-live="polite"></span>
          </div>
        </div>
      </div>

      <div class="field">
        <label for="pred-min-bet">Minimum Bet (Credits)</label>
        <input type="number" id="pred-min-bet" min="1" value="10" placeholder="e.g. 10" required />
        <span class="field-err" data-field-error="pred-min-bet" role="alert" aria-live="polite"></span>
        <div class="gw-chip-presets">
          <button class="gw-chip" type="button" data-val="5" data-target="pred-min-bet">5 Credits</button>
          <button class="gw-chip" type="button" data-val="10" data-target="pred-min-bet">10 Credits</button>
          <button class="gw-chip" type="button" data-val="25" data-target="pred-min-bet">25 Credits</button>
          <button class="gw-chip" type="button" data-val="50" data-target="pred-min-bet">50 Credits</button>
        </div>
      </div>

      <div class="field">
        <label for="pred-max-bet">Maximum Bet (Credits)</label>
        <input type="number" id="pred-max-bet" min="1" value="500" placeholder="e.g. 500" required />
        <span class="field-err" data-field-error="pred-max-bet" role="alert" aria-live="polite"></span>
        <div class="gw-chip-presets">
          <button class="gw-chip" type="button" data-val="100" data-target="pred-max-bet">100 Credits</button>
          <button class="gw-chip" type="button" data-val="500" data-target="pred-max-bet">500 Credits</button>
          <button class="gw-chip" type="button" data-val="1000" data-target="pred-max-bet">1,000 Credits</button>
          <button class="gw-chip" type="button" data-val="5000" data-target="pred-max-bet">5,000 Credits</button>
        </div>
      </div>

      <div class="field">
        <label for="pred-lock-min">Betting Window</label>
        <select id="pred-lock-min" class="v3-select">
          <option value="2">2 minutes (Fast round)</option>
          <option value="5" selected>5 minutes (Standard match)</option>
          <option value="10">10 minutes</option>
          <option value="0">Manual lock only (until streamer clicks Lock)</option>
        </select>
      </div>
      </div>

      <div class="gw-drawer-footer">
        <p class="status gw-drawer-status" id="pred-status" role="status" aria-live="polite" hidden></p>
        <button class="btn btn--ghost" id="pred-cancel" type="button">Cancel</button>
        <button class="btn btn--accent" id="pred-submit" type="submit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg> Launch Prediction</button>
      </div>
    </form>
  </div>
</div>

<!-- Settle Prediction Modal -->
<div class="gw-drawer-backdrop" id="settle-drawer" hidden>
  <div class="gw-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="settle-title">
    <div class="gw-drawer-head">
        <h2 id="settle-title"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M5 7h14M7 7l-3 6h6L7 7Zm10 0-3 6h6l-3-6ZM3 21h18"/></svg> Settle Prediction Outcome</h2>
      <button class="gw-modal-close-btn" id="settle-drawer-close" type="button" aria-label="Close">✕</button>
    </div>
    <div class="gw-drawer-body">
      <div class="gw-drawer-fields">
      <p class="font-muted font-14" id="settle-pred-title">Select which option won to distribute the prize pool automatically.</p>
      <input type="hidden" id="settle-pred-id" value="" />

      <div class="field">
        <label>Which option won?</label>
        <div class="d-flex flex-column gap-8 mt-8" id="settle-options-container"></div>
      </div>
      </div>

      <div class="gw-drawer-footer">
        <p class="status gw-drawer-status" id="settle-status" role="status" aria-live="polite" hidden></p>
        <button class="btn btn--ghost font-danger" id="settle-btn-cancel-pred" type="button">Cancel &amp; Refund All</button>
        <button class="btn btn--accent" id="settle-btn-confirm" type="button">Confirm &amp; Payout Winners</button>
      </div>
    </div>
  </div>
</div>

<!-- Create Raffle Drawer -->
<div class="gw-drawer-backdrop" id="rf-drawer" hidden>
  <div class="gw-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="rf-drawer-title">
    <div class="gw-drawer-head">
        <h2 id="rf-drawer-title"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h5M8 16h8"/></svg> Create Ticket Raffle</h2>
      <button class="gw-modal-close-btn" id="rf-drawer-close" type="button" aria-label="Close">✕</button>
    </div>
    <form id="rf-form" class="gw-drawer-body">
      <div class="gw-drawer-fields">
      <div class="field">
        <label for="rf-title">Prize Title *</label>
        <input type="text" id="rf-title" placeholder="e.g. $100 Amazon Gift Card or VIP Role" required />
        <span class="field-err" data-field-error="rf-title" role="alert" aria-live="polite"></span>
        <span class="hint">What will the winner receive?</span>
      </div>

      <div class="field">
        <label for="rf-desc">Description (Optional)</label>
        <textarea id="rf-desc" rows="2" placeholder="Rules or details for claiming this prize…"></textarea>
        <span class="field-err" data-field-error="rf-desc" role="alert" aria-live="polite"></span>
      </div>

      <div class="field">
        <label for="rf-cost">Ticket Cost (in Credits)</label>
        <input type="number" id="rf-cost" min="0" value="30" placeholder="e.g. 30" required />
        <span class="field-err" data-field-error="rf-cost" role="alert" aria-live="polite"></span>
        <div class="gw-chip-presets">
          <button class="gw-chip" type="button" data-val="0" data-target="rf-cost">Free (0 Credits)</button>
          <button class="gw-chip" type="button" data-val="25" data-target="rf-cost">25 Credits</button>
          <button class="gw-chip" type="button" data-val="50" data-target="rf-cost">50 Credits</button>
          <button class="gw-chip" type="button" data-val="100" data-target="rf-cost">100 Credits</button>
        </div>
        <span class="hint">How many Credits a viewer pays per ticket. Set 0 for free community entries.</span>
      </div>

      <div class="field">
        <label for="rf-max">Max Tickets per Viewer</label>
        <input type="number" id="rf-max" min="1" value="10" placeholder="e.g. 5" required />
        <span class="field-err" data-field-error="rf-max" role="alert" aria-live="polite"></span>
        <div class="gw-chip-presets">
          <button class="gw-chip" type="button" data-val="1" data-target="rf-max">1 ticket</button>
          <button class="gw-chip" type="button" data-val="5" data-target="rf-max">5 tickets</button>
          <button class="gw-chip" type="button" data-val="10" data-target="rf-max">10 tickets</button>
          <button class="gw-chip" type="button" data-val="25" data-target="rf-max">25 tickets</button>
        </div>
        <span class="hint">Prevents one viewer from buying all tickets.</span>
      </div>
      </div>

      <div class="gw-drawer-footer">
        <p class="status gw-drawer-status" id="rf-status" role="status" aria-live="polite" hidden></p>
        <button class="btn btn--ghost" id="rf-cancel" type="button">Cancel</button>
        <button class="btn btn--accent" id="rf-submit" type="submit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M5 7h14M7 7l-3 6h6L7 7Zm10 0-3 6h6l-3-6ZM3 21h18"/></svg> Create Raffle</button>
      </div>
    </form>
  </div>
</div>
`;
}

export function renderGiveawaysContentHtml(activeTab = "chat") {
  const active = GIVEAWAY_TABS.some(([tab]) => tab === activeTab) ? activeTab : "chat";
  const activeLabel = GIVEAWAY_TABS.find(([tab]) => tab === active)?.[1] || "Giveaways";
  const activeDescription = {
    chat: "Collect chat entries, draw a winner, and confirm the result live.",
    raffles: "Sell Credit tickets, draw a winner, and keep completed raffles together.",
    preds: "Run live prediction pools and settle them when the outcome is known.",
    tournaments: "Open chat signups, review the entry list, and seed a tournament.",
  }[active] || "Engage viewers with live community events.";
  // Chat giveaways is the primary mechanic; secondary/legacy surfaces (ticket
  // raffles, predictions, tournaments) still route but sit behind the More
  // toggle.
  const LEGACY_TABS = new Set(["raffles", "preds", "tournaments"]);
  const legacyActive = LEGACY_TABS.has(active);
  const tabLink = ([tab, label]) => `
  <a class="gw-tab-btn v3-tab${tab === active ? " is-active is-on" : ""}" id="tab-btn-${tab}" href="${giveawayPath(tab)}" data-tab="${tab}" role="tab" aria-selected="${tab === active ? "true" : "false"}"${tab === active ? ' aria-current="page"' : ""}${LEGACY_TABS.has(tab) ? ` data-tabs-legacy${legacyActive ? "" : " hidden"}` : ""}>${label}</a>`;
  const tabs = GIVEAWAY_TABS.filter(([tab]) => !LEGACY_TABS.has(tab)).map(tabLink).join("")
    + `<button class="v3-tab" id="tab-btn-gw-more" type="button" data-tabs-more aria-expanded="${legacyActive ? "true" : "false"}">More</button>`
    + GIVEAWAY_TABS.filter(([tab]) => LEGACY_TABS.has(tab)).map(tabLink).join("");
  const html = `
${engageTabsHtml("giveaways")}
<div class="v3-head v3-head--row">
  <div class="v3-head-col">
    <h1>${activeLabel}</h1>
    <p class="v3-head-sub">${activeDescription}</p>
  </div>
  <div class="d-flex gap-8 items-center flex-wrap"${active === "preds" ? "" : " hidden"}>
    <button class="btn btn--sm btn--accent" id="btn-open-event-drawer" type="button">+ Create Event</button>
  </div>
</div>

<div class="gw-nav-tabs v3-tabs" role="tablist" aria-label="Giveaway types">
${tabs}
</div>

<!-- The one place an Engage action reports a refusal. It lives outside the tab
     panes so a refusal on any tab is actually painted: the previous target was
     the Kick connection badge inside the hidden chat pane, which made server
     refusals (e.g. drawing a raffle with zero tickets) look like a no-op. -->
<p class="gw-page-alert" id="gw-page-alert" role="alert" aria-live="assertive" hidden></p>

<!-- =========================================================================
     TAB 1: LIVE CHAT GIVEAWAYS
     ========================================================================= -->
<div class="gw-tab-pane${active === "chat" ? " is-active" : ""}" id="pane-chat"${active === "chat" ? "" : " hidden"}>
  <div class="gw-layout">
    <!-- Left Column: Setup, Anti-Alt Shield & Live Feed -->
    <div class="gw-sidebar">
      <!-- Setup Card -->
      <section class="v3-table-card gw-card" id="gw-setup-card">
        <div class="v3-section-head">
          <div>
            <h2>Start collecting entries</h2>
            <p class="v3-head-sub">Viewers who type your keyword in your connected Kick chat are entered automatically.</p>
          </div>
          <div id="gw-status-badge" class="gw-status-pill gw-status--idle" aria-live="polite">
            <span class="gw-status-dot"></span>
            <span id="gw-status-text">Checking…</span>
          </div>
        </div>

        <form id="gw-setup-form" class="gw-form">
          <div class="field" id="gw-channel-connected" hidden>
            <span class="field-label">Kick channel</span>
            <div class="gw-channel-row">
              <span class="gw-channel-name" id="gw-channel-name"></span>
              <span class="gw-event-badge gw-event-badge--live">✓ Connected</span>
            </div>
            <span class="hint" id="gw-chat-events-notice" hidden>Kick did not confirm chat events for this channel yet. Reconnect Kick in Connections to enable Chat giveaways.</span>
          </div>

          <div class="gw-connect-required" id="gw-channel-disconnected" hidden>
            <p>Chat giveaways require a connected Kick channel.</p>
            <a class="btn btn--accent" id="gw-btn-connect-kick" href="/dashboard/settings/connections">Connect Kick</a>
          </div>

          <div class="field">
            <label for="gw-keyword-input">Keyword</label>
            <input id="gw-keyword-input" name="keyword" type="text" value="!win" placeholder="e.g. !win, !enter, YOURRANK" maxlength="64" required />
            <span class="hint">Viewers who type this word in chat are entered once each. Matching ignores upper/lowercase.</span>
          </div>

          <fieldset class="gw-settings" id="gw-settings">
            <legend>Entry Mode</legend>
            <div class="gw-entry-modes">
              <label><input type="radio" name="gw-entry-mode" value="chat" checked><span><b>Anyone in Kick Chat</b><small>Anyone who types the keyword can participate.</small></span></label>
              <label><input type="radio" name="gw-entry-mode" value="members"><span><b>YourRank Members Only</b><small>Requires a YourRank account linked to the Kick account used in chat.</small></span></label>
              <label><input type="radio" name="gw-entry-mode" value="verified"><span><b>Verified Entry</b><small>Viewers type the keyword, then verify through YourRank before entering the draw.</small></span></label>
            </div>
            <section class="gw-settings-section" aria-labelledby="gw-eligibility-title">
              <h3 id="gw-eligibility-title">Eligibility</h3>
              <label class="cr-toggle-row"><span><b>One entry per Kick account</b><small>Always enforced by Kick account ID.</small></span><input type="checkbox" checked disabled></label>
            </section>
            <section class="gw-settings-section" aria-labelledby="gw-winner-repeat-title">
              <h3 id="gw-winner-repeat-title">Winner repeat</h3>
              <div class="gw-entry-modes">
                <label><input type="radio" name="gw-winner-repeat" id="gw-winner-repeat-once" value="once" checked><span><b>Win once per giveaway</b><small>Winners are excluded from later draws and re-rolls in this giveaway.</small></span></label>
                <label><input type="radio" name="gw-winner-repeat" id="gw-winner-repeat-again" value="again"><span><b>Can win again</b><small>A re-roll may pick the same participant again.</small></span></label>
              </div>
            </section>
            <section class="gw-settings-section" aria-labelledby="gw-winner-verification-title">
              <h3 id="gw-winner-verification-title">Winner verification</h3>
              <label class="cr-toggle-row"><span>Winner must respond in chat</span><input type="checkbox" class="v3-toggle" id="gw-opt-claim-req"></label>
              <div id="gw-claim-duration-wrap" hidden>
                <div class="field"><label for="gw-opt-claim-duration">Response timeout</label><select id="gw-opt-claim-duration" disabled>
                  <option value="30">30 seconds</option><option value="60" selected>60 seconds</option><option value="90">90 seconds</option><option value="120">2 minutes</option>
                </select></div>
              </div>
              <div id="gw-auto-reroll-wrap" hidden>
                <label class="cr-toggle-row"><span><b>Auto re-roll on timeout</b><small>Runs at expiry while this page is open, or on the next server check within five minutes.</small></span><input id="gw-opt-auto-reroll" type="checkbox" class="v3-toggle" disabled></label>
              </div>
            </section>
            <details class="gw-setup-advanced" id="gw-advanced-options"><summary>Advanced options<span class="gw-advanced-summary-state" aria-hidden="true">▾</span></summary><div class="gw-setup-advanced-body">
              <section class="gw-settings-section" aria-labelledby="gw-advanced-eligibility-title">
                <h3 id="gw-advanced-eligibility-title">Eligibility</h3>
                <label class="cr-toggle-row"><span>Subscriber only</span><input id="gw-opt-subscriber" type="checkbox" class="v3-toggle"></label>
                <label class="cr-toggle-row"><span>VIP only</span><input id="gw-opt-vip" type="checkbox" class="v3-toggle"></label>
                <label class="cr-toggle-row"><span><b>Exclude past giveaway winners</b><small>Winners recorded in this community’s earlier giveaways. Winner repeat above covers this giveaway.</small></span><input id="gw-opt-skip-past" type="checkbox" class="v3-toggle"></label>
                <p class="hint">Subscriber and VIP checks use the badges on the entry message. Selecting both requires both badges.</p>
                <p class="hint">Account age and follow duration are unavailable: reliable Kick data is not connected.</p>
              </section>
              <section class="gw-settings-section" aria-labelledby="gw-abuse-title">
                <h3 id="gw-abuse-title">Anti-abuse</h3>
                <label class="cr-toggle-row"><span><b>One account per IP</b><small id="gw-ip-requirement">Locked — Requires Verified Entry</small></span><input id="gw-opt-ip" type="checkbox" class="v3-toggle" disabled aria-describedby="gw-ip-requirement"></label>
                <label class="cr-toggle-row"><span><b>VPN / Proxy detection</b><small id="gw-vpn-requirement">Locked — Requires Verified Entry and a detection provider</small></span><input type="checkbox" disabled aria-describedby="gw-vpn-requirement"></label>
                <label class="cr-toggle-row"><span><b>Duplicate device detection</b><small id="gw-device-requirement">Locked — Requires Verified Entry and a supported device check</small></span><input type="checkbox" disabled aria-describedby="gw-device-requirement"></label>
                <p class="hint">Participants must verify through YourRank because Kick chat does not expose IP or device information.</p>
                <button class="btn btn--ghost" id="gw-enable-verified" type="button">Enable Verified Entry</button>
              </section>
              <section class="gw-settings-section" aria-labelledby="gw-winner-instruction-title">
                <h3 id="gw-winner-instruction-title">Winner instruction</h3>
                <div class="field"><label for="gw-custom-rule-text">Winner instruction (optional)</label><textarea id="gw-custom-rule-text" rows="2" placeholder="e.g. Say your in-game name in chat"></textarea><span class="hint">A display instruction on this page; not an eligibility check.</span></div>
              </section>
            </div></details>
          </fieldset>
          <p class="hint" id="gw-settings-note">Settings are saved when you start a giveaway. Changes apply to the next giveaway.</p>
          <p id="gw-verification-link-wrap" hidden><a id="gw-verification-link" target="_blank" rel="noopener">Open viewer verification page</a><span class="hint"> Share this link in Kick chat so pending viewers can verify.</span></p>

          <div class="gw-actions">
            <button class="btn btn--accent" id="gw-btn-listen" type="submit" disabled>
              <span id="gw-listen-btn-text"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14a8 8 0 0 1 16 0"/><path d="M4 14v3a2 2 0 0 0 2 2h1v-5H4Z"/><path d="M20 14v3a2 2 0 0 1-2 2h-1v-5h3Z"/></svg> <span id="gw-listen-btn-label">Start giveaway</span></span>
            </button>
          </div>
          <p class="hint">Entries keep collecting on our servers even if you close or refresh this page.</p>
        </form>
      </section>
    </div>

    <!-- Right Column: Winner Stage & Entrants Table -->
    <div class="gw-main">
      <!-- Winner Stage Card -->
      <section class="v3-table-card gw-card" id="gw-stage-card">
        <div class="gw-stage-head">
          <div>
            <h2>Giveaway draw</h2>
            <p class="v3-head-sub">See who is eligible, then draw when you are ready.</p>
          </div>
          <div class="gw-metrics-row">
            <div class="gw-stat-pill">
              <span class="gw-stat-val" id="gw-stat-entrants">0</span>
              <span class="gw-stat-lbl">Entrants</span>
            </div>
            <div class="gw-stat-pill">
              <span class="gw-stat-val" id="gw-stat-keyword">—</span>
              <span class="gw-stat-lbl">Keyword</span>
            </div>
            <div class="gw-stat-pill">
              <span class="gw-stat-val" id="gw-stat-time">00:00</span>
              <span class="gw-stat-lbl">Time</span>
            </div>
          </div>
        </div>

        <div class="gw-stage-body">
          <!-- Active Winner Card (Hidden until drawn) -->
          <div class="gw-winner-stage" id="gw-winner-stage" role="status" aria-live="polite" hidden>
            <div class="gw-confetti" id="gw-confetti" aria-hidden="true"></div>
            <div class="gw-winner-podium">
              <div class="gw-winner-crown" aria-hidden="true">👑</div>
              <img class="gw-winner-avatar" id="gw-winner-avatar" src="" alt="Winner avatar" />
              <div class="gw-winner-meta">
                <div class="gw-winner-badges-row">
                  <span class="gw-winner-badge">Winner drawn</span>
                  <span class="gw-trust-badge gw-trust-badge--high" id="gw-winner-trust">Viewer</span>
                </div>
                <h3 class="gw-winner-username" id="gw-winner-name">Username</h3>
              </div>
            </div>

            <!-- Claim Timer Bar -->
            <div class="gw-claim-box" id="gw-claim-box">
              <div class="gw-claim-header">
                <span class="gw-claim-dot gw-claim-dot--waiting" id="gw-claim-dot"></span>
                <strong id="gw-claim-status">Waiting for winner response…</strong>
                <span class="gw-claim-countdown" id="gw-claim-countdown">60s</span>
              </div>
              <div class="gw-claim-bar-bg">
                <div class="gw-claim-bar-fill" id="gw-claim-fill"></div>
              </div>
            </div>

            <div class="gw-winner-actions">
              <button class="btn btn--ghost btn--sm" id="gw-btn-copy-winner" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/></svg> Copy Info</button>
              <button class="btn btn--ghost btn--sm" id="gw-btn-reroll" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.2-6.5L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.2 6.5L3 16"/><path d="M3 21v-5h5"/></svg> Re-roll Winner</button>
              <button class="btn btn--accent" id="gw-btn-confirm" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Confirm Winner</button>
            </div>
          </div>

          <!-- Roulette Draw Stage (hidden until drawing) -->
          <div class="gw-roulette" id="gw-roulette" hidden>
            <div class="gw-roulette-window">
              <div class="gw-roulette-track" id="gw-roller-track" aria-hidden="true"></div>
              <div class="gw-roulette-centerline" aria-hidden="true"></div>
            </div>
          </div>

          <!-- Pre-Draw Idle Stage -->
          <div class="gw-stage-idle" id="gw-stage-idle">
            <div class="gw-idle-wheel">
              <div class="gw-idle-icon" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="14" x="3" y="7" rx="2"/><path d="M12 7v14M3 11h18M12 7H8.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7Zm0 0h3.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7Z"/></svg></div>
            </div>
            <h3 class="gw-idle-title">Ready to draw</h3>
            <p class="gw-idle-sub"><span id="gw-idle-entrant-count">0</span> entrants waiting. Everyone who types your keyword lands here.</p>
            <button class="btn btn--accent btn--lg" id="gw-btn-roll" type="button" disabled>
              Draw Random Winner
            </button>
          </div>
        </div>
      </section>

      <!-- Entrants Live Roster -->
      <section class="v3-table-card gw-card gw-card--table" id="gw-entrants-card">
        <div class="v3-section-head">
          <div>
            <h2>Entrants (<span id="gw-count-header">0</span>)</h2>
            <p class="v3-head-sub">Viewers who typed the keyword in your Kick chat during this giveaway.</p>
          </div>
          <div class="gw-entrants-tools">
            <label class="sr-only" for="gw-search-entrants">Search entrants</label>
            <input type="text" class="v3-search-input" id="gw-search-entrants" placeholder="Search entrant…" />
            <button class="btn btn--sm btn--ghost" id="gw-btn-export" type="button">Export CSV</button>
          </div>
        </div>

        <div class="v3-table-scroll">
          <table class="v3-table">
            <thead>
              <tr>
                <th class="gw-number-col">#</th>
                <th>Viewer</th>
                <th>Status</th>
                <th>Chat Message</th>
                <th>Entered At</th>
                <th class="ta-r">Action</th>
              </tr>
            </thead>
            <tbody id="gw-entrants-list"></tbody>
          </table>
        </div>

        <div class="v3-state-inline" id="gw-entrants-empty" role="status">
          <span class="v3-state-inline-copy"><b>No entrants yet</b><span>Start a giveaway and viewers who type the keyword in your Kick chat will appear here.</span></span>
        </div>
      </section>
    </div>
  </div>
</div>

<!-- =========================================================================
     TAB 2: TICKET RAFFLES
     ========================================================================= -->
<div class="gw-tab-pane${active === "raffles" ? " is-active" : ""}" id="pane-raffles"${active === "raffles" ? "" : " hidden"}>
  <div class="gw-events-grid">
    <section class="v3-table-card gw-card">
      <div class="v3-section-head">
        <div>
          <h2>Active raffles</h2>
          <p class="v3-head-sub">Draw these when ticket sales are finished.</p>
        </div>
        <button class="btn btn--sm btn--accent" id="btn-create-raffle" type="button">Create raffle</button>
      </div>

      <div class="gw-raffles-container" id="rf-active-list">
        <div class="v3-empty" id="rf-empty-active">
          <h2>No active raffles</h2>
          <p>Create a raffle so viewers can buy tickets with Credits.</p>
        </div>
      </div>
    </section>

    <section class="v3-table-card gw-card gw-card--table">
      <div class="v3-section-head">
        <div>
          <h2>Raffle history</h2>
          <p class="v3-head-sub">Completed raffles and winners.</p>
        </div>
      </div>

      <div class="v3-table-scroll">
        <table class="v3-table">
          <thead>
            <tr>
              <th>Prize Title</th>
              <th>Ticket Cost</th>
              <th>Total Tickets</th>
              <th>Winner</th>
              <th>Drawn At</th>
            </tr>
          </thead>
          <tbody id="rf-past-list">
            <tr><td colspan="5" class="ta-c font-muted gw-empty-cell">No past raffles yet.</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</div>

<!-- =========================================================================
     TAB 3: LIVE PREDICTIONS & BETTING
     ========================================================================= -->
<div class="gw-tab-pane${active === "preds" ? " is-active" : ""}" id="pane-preds"${active === "preds" ? "" : " hidden"}>
  <div class="gw-events-grid">
    <section class="v3-table-card gw-card">
      <div class="v3-section-head">
        <div>
          <h2>Active Stream Predictions</h2>
          <p class="v3-head-sub">Run live betting pools on in-game events with dynamic proportional payouts.</p>
        </div>
        <button class="btn btn--sm btn--accent" id="btn-create-pred" type="button">+ New Prediction</button>
      </div>

      <div class="gw-preds-container" id="pred-active-list">
        <div class="v3-empty" id="pred-empty-active">
          <div class="v3-empty-ic">🔮</div>
          <h2>No active predictions</h2>
          <p>Launch a live prediction to let viewers wager their Credits on your stream match outcomes.</p>
        </div>
      </div>
    </section>

    <section class="v3-table-card gw-card gw-card--table">
      <div class="v3-section-head">
        <div>
          <h2>Prediction History &amp; Settlements</h2>
          <p class="v3-head-sub">Past settled predictions and payout logs.</p>
        </div>
      </div>

      <div class="v3-table-scroll">
        <table class="v3-table">
          <thead>
            <tr>
              <th>Prediction Title</th>
              <th>Total Pool</th>
              <th>Participants</th>
              <th>Outcome</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody id="pred-past-list">
            <tr><td colspan="6" class="ta-c font-muted gw-empty-cell">No predictions created yet.</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</div>

<!-- =========================================================================
     TAB 4: TOURNAMENT ENTRIES
     ========================================================================= -->
<div class="gw-tab-pane${active === "tournaments" ? " is-active" : ""}" id="pane-tournaments"${active === "tournaments" ? "" : " hidden"}>
  <div id="tournament-app" class="tournament-app">
    <p class="tournament-message" id="tournament-message" role="status" aria-live="polite" hidden></p>

    <!-- No tournament yet: one focused card. Nothing else renders until one exists. -->
    <section class="tournament-empty-card" id="tournament-empty" aria-labelledby="tournament-empty-heading" hidden>
      <h2 id="tournament-empty-heading">Tournaments</h2>
      <p>Run a tournament for your community. Collect entries from your audience, select participants, then manage the bracket here.</p>
      <button class="btn btn--accent" id="tournament-create" type="button">Create tournament</button>
    </section>

    <div id="tournament-workspace" hidden>
      <section class="tournament-summary-card" aria-labelledby="tournament-title-display">
        <div class="tournament-summary-head">
          <div class="tournament-summary-ident">
            <div class="tournament-summary-title-row">
              <h2 class="tournament-title-display" id="tournament-title-display"></h2>
              <span class="tournament-status-chip" id="tournament-status" data-lifecycle=""></span>
            </div>
            <p class="tournament-game-display" id="tournament-meta"></p>
            <p class="tournament-step-label" id="tournament-step-label"></p>
          </div>
          <div class="tournament-primary-wrap">
            <label class="tournament-pick-count" id="tournament-pick-count-wrap" hidden>
              <span>Pick</span>
              <select id="tournament-pick-count" class="v3-select" aria-label="Participants to pick"></select>
            </label>
            <button class="btn btn--accent" id="tournament-primary" type="button" hidden></button>
            <button class="btn btn--ghost tournament-secondary-action" id="tournament-reopen" type="button" hidden>Reopen signups</button>
            <button class="btn btn--ghost tournament-secondary-action" id="tournament-new" type="button" hidden>New tournament</button>
          </div>
        </div>
        <dl class="tournament-facts">
          <div><dt>Kick channel</dt><dd id="tournament-fact-channel">—</dd></div>
          <div><dt>Join command</dt><dd id="tournament-fact-keyword">!join</dd></div>
          <div><dt>Signup limit</dt><dd id="tournament-fact-cap">Unlimited</dd></div>
          <div><dt>Bracket spots</dt><dd id="tournament-fact-spots">8</dd></div>
          <div><dt>Entries</dt><dd id="tournament-count" aria-live="polite">0</dd></div>
          <div><dt>Chat</dt><dd><span class="tournament-live-dot" id="tournament-chat-status">Chat off</span></dd></div>
        </dl>
      </section>

      <div class="tournament-tabs" role="tablist" aria-label="Tournament sections">
        <button class="tournament-tab is-active" id="tournament-tab-entries" type="button" role="tab" aria-selected="true" aria-controls="tournament-panel-entries" data-tournament-tab="entries">Entries</button>
        <button class="tournament-tab" id="tournament-tab-bracket" type="button" role="tab" aria-selected="false" aria-controls="tournament-panel-bracket" data-tournament-tab="bracket">Bracket</button>
        <button class="tournament-tab" id="tournament-tab-settings" type="button" role="tab" aria-selected="false" aria-controls="tournament-panel-settings" data-tournament-tab="settings">Settings</button>
      </div>

      <section class="tournament-list-card" id="tournament-panel-entries" role="tabpanel" aria-labelledby="tournament-tab-entries">
        <div class="tournament-list-head">
          <div>
            <h2 id="tournament-list-heading">Entries</h2>
            <p class="tournament-muted" id="tournament-list-sub">Review names before locking signups and picking participants.</p>
          </div>
        </div>
        <div class="tournament-entries" id="tournament-entries">
          <div class="tournament-panel-empty" id="tournament-entries-empty" hidden></div>
          <ul class="tournament-entry-list" id="tournament-entry-list" aria-label="Tournament entries"></ul>
        </div>
      </section>

      <section class="tournament-list-card" id="tournament-panel-bracket" role="tabpanel" aria-labelledby="tournament-tab-bracket" hidden>
        <div class="tournament-list-head">
          <div>
            <h2 id="tournament-bracket-heading">Bracket</h2>
            <p class="tournament-muted">Enter scores for each match to advance the winner.</p>
          </div>
        </div>
        <div class="tournament-panel-empty" id="tournament-bracket-empty" hidden>
          <b>Bracket not created yet.</b>
          <span>Lock signups and select participants to generate the bracket.</span>
        </div>
        <div id="tournament-bracket" class="tournament-bracket"></div>
        <p class="tournament-champion" id="tournament-champion" hidden></p>
      </section>

      <section class="tournament-list-card" id="tournament-panel-settings" role="tabpanel" aria-labelledby="tournament-tab-settings" hidden>
        <div class="tournament-list-head">
          <div>
            <h2 id="tournament-settings-heading">Settings</h2>
            <p class="tournament-muted">Basic details can change any time. Format and bracket size lock once they would invalidate entries or the bracket.</p>
          </div>
        </div>
        <form id="tournament-settings-form" class="tournament-settings-grid">
          <div class="field">
            <label for="tournament-title">Tournament name</label>
            <input id="tournament-title" name="title" type="text" placeholder="Community Tournament" maxlength="120" />
          </div>
          <div class="field">
            <label for="tournament-game">Game</label>
            <input id="tournament-game" name="gameName" type="text" placeholder="Game" maxlength="120" />
          </div>
          <div class="field">
            <label for="tournament-keyword">Chat command</label>
            <input id="tournament-keyword" name="entryKeyword" type="text" value="!join" maxlength="40" />
          </div>
          <div class="field">
            <label for="tournament-entry-cap">Signup limit</label>
            <input id="tournament-entry-cap" name="entryCap" type="number" min="1" placeholder="Unlimited" inputmode="numeric" />
            <span class="hint">How many viewers may register. Leave empty for unlimited. Separate from bracket size.</span>
          </div>
          <div class="field">
            <label for="tournament-chat-channel">Kick channel</label>
            <div class="gw-input-row">
              <span class="gw-input-prefix">kick.com/</span>
              <input id="tournament-chat-channel" name="chatChannel" type="text" placeholder="channelname" autocomplete="off" />
            </div>
          </div>
          <div class="field">
            <label for="tournament-format">Format</label>
            <select id="tournament-format" name="format" class="v3-select">
              <option value="bracket">Bracket</option>
              <option value="1v1">1v1</option>
              <option value="2v2">2v2 teams</option>
            </select>
            <span class="hint" id="tournament-format-hint" hidden></span>
          </div>
          <div class="field">
            <label for="tournament-bracket-size">Bracket size</label>
            <select id="tournament-bracket-size" name="bracketSize" class="v3-select">
              <option value="4">4 players</option>
              <option value="8">8 players</option>
              <option value="16">16 players</option>
              <option value="32">32 players</option>
            </select>
            <span class="hint" id="tournament-bracket-size-hint" hidden></span>
          </div>
          <details class="tournament-advanced" id="tournament-advanced">
            <summary>Advanced settings</summary>
            <div class="field tournament-toggle-field">
              <label for="tournament-anti-alt">Flag likely duplicate accounts</label>
              <input id="tournament-anti-alt" name="antiAltEnabled" type="checkbox" class="v3-toggle" />
              <span class="hint">Flags are shown for you to review; they never reject someone automatically.</span>
            </div>
          </details>
          <div class="tournament-settings-actions">
            <button class="btn btn--accent" type="submit">Save settings</button>
          </div>
        </form>
      </section>
    </div>

    <div class="modal tournament-create-modal" id="tournament-create-modal" role="dialog" aria-modal="true" aria-labelledby="tournament-create-heading" hidden>
      <form class="modal-card tournament-create-card" id="tournament-create-form" novalidate>
        <h3 id="tournament-create-heading">Create tournament</h3>
        <div class="tournament-create-grid">
          <div class="field">
            <label for="tc-title">Tournament name</label>
            <input id="tc-title" name="title" type="text" value="Community Tournament" maxlength="120" required />
          </div>
          <div class="field">
            <label for="tc-game">Game</label>
            <input id="tc-game" name="gameName" type="text" placeholder="e.g. Fortnite" maxlength="120" />
          </div>
          <div class="field">
            <label for="tc-format">Format</label>
            <select id="tc-format" name="format" class="v3-select">
              <option value="bracket">Bracket</option>
              <option value="1v1">1v1</option>
              <option value="2v2">2v2 teams</option>
            </select>
          </div>
          <div class="field">
            <label for="tc-bracket-size">Bracket size</label>
            <select id="tc-bracket-size" name="bracketSize" class="v3-select">
              <option value="4">4 players</option>
              <option value="8" selected>8 players</option>
              <option value="16">16 players</option>
              <option value="32">32 players</option>
            </select>
            <span class="hint">How many participants play in the bracket.</span>
          </div>
          <div class="field">
            <label for="tc-entry-cap">Signup limit</label>
            <select id="tc-entry-cap" name="entryCapMode" class="v3-select">
              <option value="" selected>Unlimited</option>
              <option value="custom">Custom limit…</option>
            </select>
            <input id="tc-entry-cap-custom" name="entryCap" type="number" min="1" placeholder="e.g. 40" inputmode="numeric" aria-label="Custom signup limit" hidden />
            <span class="hint">How many viewers may register. Participants are picked from the entries later.</span>
          </div>
          <div class="field">
            <label for="tc-chat-channel">Kick channel</label>
            <div class="gw-input-row">
              <span class="gw-input-prefix">kick.com/</span>
              <input id="tc-chat-channel" name="chatChannel" type="text" placeholder="channelname" autocomplete="off" />
            </div>
          </div>
          <div class="field">
            <label for="tc-keyword">Chat command</label>
            <input id="tc-keyword" name="entryKeyword" type="text" value="!join" maxlength="40" />
          </div>
        </div>
        <p class="tournament-message is-error" id="tournament-create-error" role="alert" hidden></p>
        <div class="modal-actions">
          <button class="btn btn--sm btn--ghost ghost" type="button" id="tournament-create-cancel">Cancel</button>
          <button class="btn btn--sm btn--accent" type="submit" id="tournament-create-submit">Create tournament</button>
        </div>
      </form>
    </div>
  </div>
</div>

<!-- Winner Verification Modal -->
<div class="gw-modal-backdrop" id="gw-winner-modal" hidden>
  <div class="gw-modal-content" role="dialog" aria-modal="true" aria-labelledby="gw-modal-title">
    <div class="gw-modal-head">
      <div class="gw-modal-title-row">
        <span class="gw-modal-crown" aria-hidden="true">👑</span>
        <div class="gw-modal-title-text">
          <h2 class="gw-modal-title" id="gw-modal-title">Winner Drawn</h2>
          <p class="gw-modal-sub">The giveaway has finished. Verify the winner below.</p>
        </div>
      </div>
      <button class="gw-modal-close-btn" id="gw-modal-close" type="button" aria-label="Close modal">✕</button>
    </div>

    <div class="gw-modal-hero">
      <img class="gw-modal-avatar" id="gw-modal-avatar" src="" alt="Winner avatar" />
      <h3 class="gw-modal-name" id="gw-modal-name">Winner</h3>
      <p class="gw-winner-msg" id="gw-modal-msg">"!"</p>
      <div class="gw-winner-badges-row gw-winner-badges-row--center">
        <span class="gw-trust-badge gw-trust-badge--high" id="gw-modal-trust-badge">Viewer</span>
        <span class="gw-verify-chip" id="gw-modal-verify-chip" hidden>Confirmed active</span>
      </div>
    </div>

    <div class="gw-modal-body">
      <!-- Live Claim Countdown Bar -->
      <div class="gw-claim-box gw-claim-box--modal" id="gw-modal-claim-box">
        <div class="gw-claim-header">
          <span class="gw-claim-dot gw-claim-dot--waiting" id="gw-modal-claim-dot"></span>
          <strong id="gw-modal-claim-status" class="gw-claim-status">Waiting for winner response…</strong>
          <span class="gw-claim-countdown" id="gw-modal-claim-countdown">60s</span>
        </div>
        <div class="gw-claim-bar-bg">
          <div class="gw-claim-bar-fill" id="gw-modal-claim-fill"></div>
        </div>
        <p class="hint gw-claim-hint" id="gw-modal-claim-hint">
          Ask the winner to send a message in chat. Their live responses appear in the log below.
        </p>
      </div>

      <!-- Dedicated Winner Live Chat Feed -->
      <div class="gw-winner-chat-card">
        <div class="gw-winner-chat-head">
          <span>Winner's Live Chat Log</span>
          <span class="gw-winner-chat-tag"><span class="gw-live-dot" aria-hidden="true"></span>Live</span>
        </div>
        <div class="gw-winner-chat-feed" id="gw-winner-chat-feed" aria-live="polite">
          <div class="gw-winner-chat-empty" id="gw-winner-chat-empty">
            Waiting for winner's messages in chat…
          </div>
        </div>
      </div>
    </div>

    <div class="gw-modal-footer">
      <button class="btn btn--sm btn--ghost" id="gw-modal-reroll" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.2-6.5L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.2 6.5L3 16"/><path d="M3 21v-5h5"/></svg> Re-roll Winner</button>
      <button class="btn btn--sm btn--ghost" id="gw-modal-copy" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/></svg> Copy Winner Info</button>
      <button class="btn btn--sm btn--accent" id="gw-modal-confirm" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Confirm Winner</button>
    </div>
  </div>
</div>
`;
  return html;
}

export function renderGiveawaysHtml(activeTab = "chat") {
  return `${renderGiveawaysContentHtml(activeTab)}${renderGiveawayDrawersHtml()}`;
}

export const giveawaysHtml = renderGiveawaysHtml();
