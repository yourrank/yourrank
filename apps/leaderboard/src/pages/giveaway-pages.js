// Markup for Giveaways & Community Events Hub (Chat Giveaways, Ticket Raffles, Flash Code Drops)

export const GIVEAWAY_TABS = [
  ["chat", "Giveaways"],
  ["raffles", "Raffles"],
  ["drops", "Drops"],
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

<!-- Launch Flash Code Drop Drawer -->
<div class="gw-drawer-backdrop" id="cd-drawer" hidden>
  <div class="gw-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="cd-drawer-title">
    <div class="gw-drawer-head">
        <h2 id="cd-drawer-title"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z"/></svg> Launch Flash Code Drop</h2>
      <button class="gw-modal-close-btn" id="cd-drawer-close" type="button" aria-label="Close">✕</button>
    </div>
    <form id="cd-form" class="gw-drawer-body">
      <div class="gw-drawer-fields">
      <div class="field">
        <label for="cd-code">Secret Drop Code *</label>
        <div class="d-flex gap-8">
          <input type="text" id="cd-code" class="gw-code-input" placeholder="e.g. KICKBOOST" required />
          <span class="field-err" data-field-error="cd-code" role="alert" aria-live="polite"></span>
          <button class="btn btn--sm btn--ghost" id="cd-btn-random" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></svg> Random</button>
        </div>
        <span class="hint">The keyword you shout out on stream for viewers to claim.</span>
      </div>

      <div class="field">
        <label for="cd-points">Credits Reward per Viewer</label>
        <input type="number" id="cd-points" min="1" value="100" placeholder="e.g. 30" required />
        <span class="field-err" data-field-error="cd-points" role="alert" aria-live="polite"></span>
        <div class="gw-chip-presets">
          <button class="gw-chip" type="button" data-val="25" data-target="cd-points">+25 Credits</button>
          <button class="gw-chip" type="button" data-val="50" data-target="cd-points">+50 Credits</button>
          <button class="gw-chip" type="button" data-val="100" data-target="cd-points">+100 Credits</button>
          <button class="gw-chip" type="button" data-val="250" data-target="cd-points">+250 Credits</button>
        </div>
        <span class="hint">How many Credits each viewer receives upon claiming.</span>
      </div>

      <div class="field">
        <label for="cd-max">Max Total Claims (First Come, First Served)</label>
        <input type="number" id="cd-max" min="1" value="50" placeholder="e.g. 20" required />
        <span class="field-err" data-field-error="cd-max" role="alert" aria-live="polite"></span>
        <div class="gw-chip-presets">
          <button class="gw-chip" type="button" data-val="10" data-target="cd-max">10 claims</button>
          <button class="gw-chip" type="button" data-val="25" data-target="cd-max">25 claims</button>
          <button class="gw-chip" type="button" data-val="50" data-target="cd-max">50 claims</button>
          <button class="gw-chip" type="button" data-val="100" data-target="cd-max">100 claims</button>
        </div>
        <span class="hint">Once this limit is reached, the drop code expires automatically.</span>
      </div>

      <div class="field">
        <label for="cd-expire">Time Limit (Optional)</label>
        <select id="cd-expire" class="v3-select">
          <option value="0">No time limit (until claims run out)</option>
          <option value="15">15 minutes</option>
          <option value="30">30 minutes</option>
          <option value="60">1 hour</option>
        </select>
      </div>
      </div>

      <div class="gw-drawer-footer">
        <p class="status gw-drawer-status" id="cd-status" role="status" aria-live="polite" hidden></p>
        <button class="btn btn--ghost" id="cd-cancel" type="button">Cancel</button>
        <button class="btn btn--accent" id="cd-submit" type="submit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z"/></svg> Launch Drop</button>
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
    drops: "Share limited claim codes with viewers and track remaining rewards.",
    preds: "Engage your viewers with live chat giveaways, Credit ticket raffles, and flash drop claim codes.",
    tournaments: "Open chat signups, review the entry list, and seed a tournament.",
  }[active] || "Engage viewers with live community events.";
  const tabs = GIVEAWAY_TABS.map(([tab, label]) => `
  <a class="gw-tab-btn v3-tab${tab === active ? " is-active is-on" : ""}" id="tab-btn-${tab}" href="${giveawayPath(tab)}" data-tab="${tab}" role="tab" aria-selected="${tab === active ? "true" : "false"}"${tab === active ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  const html = `
<div class="v3-head v3-head--row">
  <div class="v3-head-col">
    <h1>${activeLabel}</h1>
    <p class="v3-head-sub">${activeDescription}</p>
  </div>
  <div class="d-flex gap-8 items-center flex-wrap"${active === "preds" ? "" : " hidden"}>
    <button class="btn btn--sm btn--accent" id="btn-open-event-drawer" type="button">+ Create Event</button>
  </div>
</div>

<div class="gw-nav-tabs v3-tabs" role="tablist" aria-label="Engage pages">
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
            <p class="v3-head-sub">Choose your Kick channel and the word viewers should type.</p>
          </div>
          <div id="gw-status-badge" class="gw-status-pill gw-status--idle" aria-live="polite">
            <span class="gw-status-dot"></span>
            <span id="gw-status-text">Disconnected</span>
          </div>
        </div>

        <form id="gw-setup-form" class="gw-form">
          <div class="field">
            <label for="gw-channel-input">Kick channel</label>
            <div class="gw-input-row">
              <span class="gw-input-prefix">kick.com/</span>
              <input id="gw-channel-input" name="channel" type="text" placeholder="channelname" required autocomplete="off" />
            </div>
            <span class="hint">Enter any Kick streamer channel or broadcaster username.</span>
          </div>

          <div class="field">
            <label for="gw-keyword-input">Entry keyword</label>
            <input id="gw-keyword-input" name="keyword" type="text" value="!win" placeholder="e.g. !win, !enter, YOURRANK" required />
            <span class="hint">Viewers who type this in chat will be entered into the giveaway.</span>
          </div>

          <details class="cr-advanced gw-setup-advanced">
            <summary>
              <span>Fair play &amp; entry options</span>
              <span class="gw-advanced-summary-state">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span id="gw-shield-summary">Fair play active</span>
                <span class="gw-event-badge gw-event-badge--live" id="gw-shield-status" aria-live="polite">Active</span>
              </span>
            </summary>
            <div class="gw-setup-advanced-body">
              <div class="gw-options">
                <label class="cr-toggle-row">
                  <span>
                    <b>Unique entries only</b>
                    <small>1 entry per viewer username</small>
                  </span>
                  <input type="checkbox" class="v3-toggle" id="gw-opt-unique" checked />
                </label>

                <label class="cr-toggle-row">
                  <span>
                    <b>Case sensitive</b>
                    <small>Exact match on upper/lowercase</small>
                  </span>
                  <input type="checkbox" class="v3-toggle" id="gw-opt-case" />
                </label>

                <label class="cr-toggle-row">
                  <span>
                    <b>Full message match</b>
                    <small>Only count if message is strictly the keyword</small>
                  </span>
                  <input type="checkbox" class="v3-toggle" id="gw-opt-exact" />
                </label>
              </div>

              <div class="gw-security-box">
                <label class="cr-toggle-row">
                  <span>
                    <b>Block Fake / Duplicate Accounts</b>
                    <small>Filter out instant bot farms &amp; duplicate alt entries</small>
                  </span>
                  <input type="checkbox" class="v3-toggle" id="gw-opt-antialt" checked />
                </label>

                <div class="field gw-rule-field">
                  <label for="gw-trust-min">Who is eligible to win?</label>
                  <select id="gw-trust-min" class="v3-select">
                    <option value="0">Everyone (Open to all chatters)</option>
                    <option value="50" selected>Balanced — Filter obvious fake accounts (Recommended)</option>
                    <option value="75">Loyal Viewers Only — Active stream chatters</option>
                  </select>
                  <span class="hint">Choose who is eligible when you draw a winner.</span>
                </div>

                <div class="field gw-rule-field gw-rule-field--compact">
                  <label for="gw-opt-subs-perk">Subscriber &amp; VIP Perks</label>
                  <select id="gw-opt-subs-perk" class="v3-select">
                    <option value="all" selected>Equal Chance (1x for everyone)</option>
                    <option value="subs_2x">2x Double Chance for Subs &amp; VIPs</option>
                    <option value="subs_3x">3x Triple Chance for Subs &amp; VIPs</option>
                    <option value="subs_5x">5x Ultra Luck for Subs &amp; VIPs</option>
                    <option value="subs_only">Subscribers &amp; VIPs Only</option>
                  </select>
                  <span class="hint">Reward your subscribers with higher winning odds or exclusive draws.</span>
                </div>

                <div class="field gw-rule-field gw-rule-field--compact">
                  <label for="gw-opt-min-msgs">Minimum Stream Chat Messages</label>
                  <select id="gw-opt-min-msgs" class="v3-select">
                    <option value="0" selected>No minimum (Instant entry)</option>
                    <option value="3">At least 3 messages during stream</option>
                    <option value="5">At least 5 messages (Active chatter)</option>
                    <option value="10">At least 10 messages (Super active)</option>
                  </select>
                  <span class="hint">Ensure entrants are actually active in chat during your broadcast.</span>
                </div>

                <label class="cr-toggle-row">
                  <span>
                    <b>Skip Recent Winners</b>
                    <small>Give others a chance (skip anyone who won in the last 24 hours)</small>
                  </span>
                  <input type="checkbox" class="v3-toggle" id="gw-opt-skip-past" />
                </label>
              </div>

              <div class="gw-claim-options">
                <label class="cr-toggle-row">
                  <span>
                    <b>Require winner confirmation</b>
                    <small>The winner must reply in chat before the claim timer expires.</small>
                  </span>
                  <input type="checkbox" class="v3-toggle" id="gw-opt-claim-req" />
                </label>

                <div class="field gw-rule-field gw-rule-field--compact">
                  <label for="gw-opt-claim-duration">Winner response time</label>
                  <select id="gw-opt-claim-duration" class="v3-select">
                    <option value="30">30 seconds</option>
                    <option value="60" selected>60 seconds</option>
                    <option value="90">90 seconds</option>
                    <option value="120">2 minutes</option>
                  </select>
                  <span class="hint">How long the winner has to confirm in live chat.</span>
                </div>

                <div class="field gw-rule-field gw-rule-field--compact">
                  <label for="gw-custom-rule-text">Winner requirement (optional)</label>
                  <textarea id="gw-custom-rule-text" rows="2" placeholder="e.g. Say your in-game name in chat"></textarea>
                  <span class="hint">Add a short instruction that appears with the winner’s entry.</span>
                </div>
              </div>
            </div>
          </details>

          <div class="gw-actions">
            <button class="btn btn--accent" id="gw-btn-listen" type="submit">
              <span id="gw-listen-btn-text"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14a8 8 0 0 1 16 0"/><path d="M4 14v3a2 2 0 0 0 2 2h1v-5H4Z"/><path d="M20 14v3a2 2 0 0 1-2 2h-1v-5h3Z"/></svg> <span id="gw-listen-btn-label">Connect &amp; Start Listening</span></span>
            </button>
            <button class="btn btn--ghost" id="gw-btn-reset" type="button" hidden>
              Clear Entrants
            </button>
          </div>
        </form>
      </section>

      <!-- Real-Time Chat Stream Activity (Compact Log) -->
      <section class="v3-table-card gw-card" id="gw-feed-card">
        <div class="v3-section-head">
          <div>
            <h2>Chat activity</h2>
            <p class="v3-head-sub">Messages from your Kick channel appear here while listening.</p>
          </div>
          <span class="gw-event-badge" id="gw-feed-counter">0 messages</span>
        </div>
        <div class="gw-feed-container" id="gw-chat-feed" aria-live="polite">
          <div class="gw-feed-empty" id="gw-feed-empty">
            Connect your Kick channel to watch chat messages land here in real time.
          </div>
        </div>
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
              <span class="gw-stat-val" id="gw-stat-verified">0</span>
              <span class="gw-stat-lbl">Verified</span>
            </div>
            <div class="gw-stat-pill">
              <span class="gw-stat-val" id="gw-stat-time">00:00</span>
              <span class="gw-stat-lbl">Session time</span>
            </div>
            <div class="gw-stat-pill" id="gw-pill-flagged" hidden>
              <span class="gw-stat-val font-danger" id="gw-stat-flagged">0</span>
              <span class="gw-stat-lbl">Flagged Alts</span>
            </div>
          </div>
        </div>

        <div class="gw-stage-body">
          <!-- Active Winner Card (Hidden until drawn) -->
          <div class="gw-winner-stage" id="gw-winner-stage" role="status" aria-live="polite" hidden>
            <div class="gw-winner-podium">
              <div class="gw-winner-crown">👑</div>
              <img class="gw-winner-avatar" id="gw-winner-avatar" src="" alt="Winner avatar" />
              <div class="gw-winner-meta">
                <div class="gw-winner-badges-row">
                  <span class="gw-winner-badge">WINNER DRAWN</span>
                  <span class="gw-trust-badge gw-trust-badge--high" id="gw-winner-trust">Verified Viewer</span>
                </div>
                <h3 class="gw-winner-username" id="gw-winner-name">Username</h3>
                <p class="gw-winner-msg" id="gw-winner-message">"entry message"</p>
              </div>
            </div>

            <!-- Claim Timer Bar -->
            <div class="gw-claim-box" id="gw-claim-box">
              <div class="gw-claim-header">
                <span class="gw-claim-dot gw-claim-dot--waiting" id="gw-claim-dot"></span>
                <strong id="gw-claim-status">Waiting for winner to type in chat…</strong>
                <span class="gw-claim-countdown" id="gw-claim-countdown">60s</span>
              </div>
              <div class="gw-claim-bar-bg">
                <div class="gw-claim-bar-fill" id="gw-claim-fill"></div>
              </div>
            </div>

            <div class="gw-winner-actions">
              <button class="btn btn--accent" id="gw-btn-copy-winner" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/></svg> Copy Info</button>
              <button class="btn btn--ghost font-danger" id="gw-btn-reroll" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.2-6.5L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.2 6.5L3 16"/><path d="M3 21v-5h5"/></svg> Re-roll Winner</button>
            </div>
          </div>

          <!-- Pre-Draw Idle Stage -->
          <div class="gw-stage-idle gw-roller" id="gw-stage-idle">
            <div class="gw-idle-wheel">
              <div class="gw-idle-icon" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="14" x="3" y="7" rx="2"/><path d="M12 7v14M3 11h18M12 7H8.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7Zm0 0h3.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7Z"/></svg></div>
            </div>
            <div class="gw-roller-track" id="gw-roller-track" aria-hidden="true">Ready to draw</div>
            <p>Everyone who types your keyword lands here. Roll once chat is in.</p>
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
            <p class="v3-head-sub">Viewers who used your entry keyword during this session.</p>
          </div>
          <div class="gw-entrants-tools">
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
          <span class="v3-state-inline-copy"><b>No entrants yet</b><span>Connect Kick and start listening to chat to collect entries.</span></span>
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
     TAB 3: FLASH CODE DROPS
     ========================================================================= -->
<div class="gw-tab-pane${active === "drops" ? " is-active" : ""}" id="pane-drops"${active === "drops" ? "" : " hidden"}>
  <div class="gw-events-grid">
    <section class="v3-table-card gw-card">
      <div class="v3-section-head">
        <div>
          <h2>Active drops</h2>
          <p class="v3-head-sub">Copy a code into chat while claims are available.</p>
        </div>
        <button class="btn btn--sm btn--accent" id="btn-create-drop" type="button">Create drop</button>
      </div>

      <div class="gw-drops-container" id="cd-active-list">
        <div class="v3-empty" id="cd-empty-active">
          <h2>No active drops</h2>
          <p>Create a limited claim code to reward viewers in chat.</p>
        </div>
      </div>
    </section>

    <section class="v3-table-card gw-card gw-card--table">
      <div class="v3-section-head">
        <div>
          <h2>Drop history</h2>
          <p class="v3-head-sub">Expired and fully claimed codes.</p>
        </div>
      </div>

      <div class="v3-table-scroll">
        <table class="v3-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Reward</th>
              <th>Claims</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody id="cd-past-list">
            <tr><td colspan="5" class="ta-c font-muted gw-empty-cell">No drops yet. Create a limited claim code to reward viewers.</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</div>

<!-- =========================================================================
     TAB 4: LIVE PREDICTIONS & BETTING
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
     TAB 5: TOURNAMENT ENTRIES
     ========================================================================= -->
<div class="gw-tab-pane${active === "tournaments" ? " is-active" : ""}" id="pane-tournaments"${active === "tournaments" ? "" : " hidden"}>
  <div id="tournament-app" class="tournament-app">
    <section class="tournament-status-card" aria-labelledby="tournament-status-heading">
      <div class="tournament-status-head">
        <div class="tournament-status-ident">
          <h2 class="sr-only" id="tournament-status-heading">Current tournament</h2>
          <h2 class="tournament-title-display" id="tournament-title-display" hidden></h2>
          <p class="tournament-game-display" id="tournament-game-display" hidden></p>
          <div class="tournament-status-meta">
            <p class="tournament-step-label" id="tournament-step-label">Ready when you are</p>
            <p class="tournament-count" id="tournament-count" aria-live="polite">No tournament yet</p>
          </div>
          <p class="tournament-message" id="tournament-message" role="status" aria-live="polite" hidden></p>
        </div>
        <div class="tournament-primary-wrap">
          <label class="tournament-pick-count" id="tournament-pick-count-wrap" hidden>
            <span>Pick</span>
            <input id="tournament-pick-count" type="number" min="1" value="1" inputmode="numeric" />
          </label>
          <button class="btn btn--accent" id="tournament-primary" type="button">Set up a tournament</button>
          <button class="btn btn--ghost tournament-secondary-action" id="tournament-reopen" type="button" hidden>Reopen signups</button>
          <button class="btn btn--ghost tournament-secondary-action" id="tournament-new" type="button" hidden>Start new tournament</button>
        </div>
      </div>

      <div id="tournament-empty" hidden></div>

      <div class="tournament-status-foot">
        <label class="tournament-channel-field" for="tournament-chat-channel">
          <span>Kick channel for signups</span>
          <div class="gw-input-row">
            <span class="gw-input-prefix">kick.com/</span>
            <input id="tournament-chat-channel" type="text" placeholder="channelname" autocomplete="off" />
          </div>
        </label>
      </div>
    </section>

    <section class="tournament-list-card" id="tournament-list-card" aria-labelledby="tournament-list-heading">
      <div class="tournament-list-head">
        <div>
          <h2 id="tournament-list-heading">Viewer entries</h2>
          <p class="tournament-muted">Review names before closing signups and picking participants.</p>
        </div>
        <span class="tournament-live-dot" id="tournament-chat-status">Chat off</span>
      </div>
      <div class="tournament-entries" id="tournament-entries">
        <div id="tournament-entries-empty" hidden></div>
        <ul class="tournament-entry-list" id="tournament-entry-list" aria-label="Tournament entries"></ul>
      </div>
    </section>

    <details class="tournament-settings" id="tournament-settings">
      <summary>Tournament settings <span>Title, format, entry limit, chat command, and review flags</span></summary>
      <form id="tournament-settings-form" class="tournament-settings-grid">
        <div class="field">
          <label for="tournament-title">Tournament title</label>
          <input id="tournament-title" name="title" type="text" placeholder="Community tournament" maxlength="120" />
        </div>
        <div class="field">
          <label for="tournament-game">Game</label>
          <input id="tournament-game" name="gameName" type="text" placeholder="Game" maxlength="120" />
        </div>
        <div class="field">
          <label for="tournament-format">Format</label>
          <select id="tournament-format" name="format" class="v3-select">
            <option value="bracket">Bracket</option>
            <option value="1v1">1v1</option>
            <option value="2v2">2v2 teams</option>
          </select>
        </div>
        <div class="field">
          <label for="tournament-entry-cap">Entry cap</label>
          <input id="tournament-entry-cap" name="entryCap" type="number" min="1" placeholder="No limit" />
          <span class="hint">Extra viewers wait when the cap is full.</span>
        </div>
        <div class="field">
          <label for="tournament-keyword">Chat command</label>
          <input id="tournament-keyword" name="entryKeyword" type="text" value="!join" maxlength="40" />
        </div>
        <div class="field tournament-toggle-field">
          <label for="tournament-anti-alt">Flag likely duplicate accounts</label>
          <input id="tournament-anti-alt" name="antiAltEnabled" type="checkbox" class="v3-toggle" />
          <span class="hint">Flags are shown for you to review; they never reject someone automatically.</span>
        </div>
        <div class="tournament-settings-actions">
          <button class="btn btn--ghost" type="submit">Save settings</button>
        </div>
      </form>
    </details>

    <section class="tournament-list-card" id="tournament-bracket-card" aria-labelledby="tournament-bracket-heading" hidden>
      <div class="tournament-list-head">
        <div>
          <h2 id="tournament-bracket-heading">Bracket</h2>
          <p class="tournament-muted">Enter scores for each match to advance the winner.</p>
        </div>
      </div>
      <div id="tournament-bracket" class="tournament-bracket"></div>
      <p class="tournament-champion" id="tournament-champion" hidden></p>
    </section>
  </div>
</div>

<!-- Winner Celebration Pop-up Modal -->
<div class="gw-modal-backdrop" id="gw-winner-modal" hidden>
  <div class="gw-modal-content" role="dialog" aria-modal="true" aria-labelledby="gw-modal-name">
    <div class="gw-modal-hero">
      <button class="gw-modal-close-btn" id="gw-modal-close" type="button" aria-label="Close modal">✕</button>
      <div class="gw-modal-crown" aria-hidden="true">👑</div>
      <img class="gw-modal-avatar" id="gw-modal-avatar" src="" alt="Winner avatar" />
      <div class="gw-winner-badges-row gw-winner-badges-row--center">
        <span class="gw-winner-badge">WINNER DRAWN</span>
        <span class="gw-trust-badge gw-trust-badge--high" id="gw-modal-trust-badge">Verified Viewer</span>
      </div>
      <h2 class="gw-modal-name" id="gw-modal-name">Winner</h2>
      <p class="gw-winner-msg" id="gw-modal-msg">"!"</p>
    </div>

    <div class="gw-modal-body">
      <!-- Live Claim Countdown Bar -->
      <div class="gw-claim-box gw-claim-box--modal" id="gw-modal-claim-box">
        <div class="gw-claim-header">
          <span class="gw-claim-dot gw-claim-dot--waiting" id="gw-modal-claim-dot"></span>
          <strong id="gw-modal-claim-status" class="gw-claim-status">Waiting for winner to chat in live stream…</strong>
          <span class="gw-claim-countdown" id="gw-modal-claim-countdown">60s</span>
        </div>
        <div class="gw-claim-bar-bg">
          <div class="gw-claim-bar-fill" id="gw-modal-claim-fill"></div>
        </div>
        <p class="hint gw-claim-hint">
          Ask the winner to send a message in chat. Their live responses appear in the isolated box below.
        </p>
      </div>

      <!-- Dedicated Winner Live Chat Feed -->
      <div class="gw-winner-chat-card">
        <div class="gw-winner-chat-head">
          <span>Winner's Live Chat Log</span>
          <span class="gw-winner-chat-tag">Live Filtered</span>
        </div>
        <div class="gw-winner-chat-feed" id="gw-winner-chat-feed" aria-live="polite">
          <div class="gw-winner-chat-empty" id="gw-winner-chat-empty">
            Waiting for winner's messages in chat…
          </div>
        </div>
      </div>
    </div>

    <div class="gw-modal-footer">
      <button class="btn btn--sm btn--ghost" id="gw-modal-reroll" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.2-6.5L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.2 6.5L3 16"/><path d="M3 21v-5h5"/></svg> Re-roll</button>
      <button class="btn btn--sm btn--accent" id="gw-modal-copy" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/></svg> Copy Winner Info</button>
      <button class="btn btn--sm btn--ghost" id="gw-modal-done" type="button">Done &amp; Close</button>
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
