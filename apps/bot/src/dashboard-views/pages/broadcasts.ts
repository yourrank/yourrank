// broadcasts dashboard page panels
export function broadcastsPanel(): string {
  return `
  <div class="lb-bento" data-page="broadcasts">
    <div class="lb-widget lb-widget--full">
      <div class="mb-md"><h2>Compose update</h2></div>
      <p class="muted" id="bcDraftStatus" hidden>Draft loaded from your last visit.</p>
      <div id="bcPlanState" class="v3-note mt-md" aria-live="polite">Checking broadcast access…</div>
      <div id="bcUsageState" class="muted text-sm mt-sm" aria-live="polite"></div>

      <div id="bcSetupState" class="empty bg-panel border radius-md p-24 text-center mt-md" hidden>
        <h3>Connect Telegram to send updates</h3>
        <p class="muted mt-sm mb-md">Your subscribers appear here once a Telegram bot is connected.</p>
        <a class="btn btn--accent" href="/dashboard/telegram/bots">Connect Telegram</a>
      </div>

      <div id="bcComposer" class="tg-compose mt-md" hidden>
        <section class="tg-compose-step" data-step="1" aria-labelledby="bcMessageTitle">
          <h3 id="bcMessageTitle">Message</h3>
          <div class="d-flex flex-col gap-8 broadcast-message-fields">
            <label class="sr-only" for="bcBody">Message</label>
            <textarea class="v3-input" id="bcBody" rows="4" aria-errormessage="bcBody-error" placeholder="What do you want to tell your subscribers? Use {name} to greet them by first name."></textarea>
            <span id="bcBody-error" class="field-err" role="alert"></span>
            <label class="muted text-xs" for="bcImage">Image URL (optional)</label>
            <input class="v3-input" id="bcImage" type="url" placeholder="Image link (optional) — shown above the message" />
          </div>
        </section>

        <section class="tg-compose-step" data-step="2" aria-labelledby="bcAudienceTitle">
          <h3 id="bcAudienceTitle">Audience</h3>
          <p class="muted text-sm mb-sm">All subscribers</p>
          <div id="bcAudience" class="tg-audience" aria-live="polite">This will send to <b>–</b> subscribers.</div>

          <details class="tg-disclosure mt-md">
            <summary>Choose a smaller audience</summary>
            <div class="tg-disclosure-body d-flex flex-wrap gap-16 broadcast-filter-grid">
              <div class="d-flex flex-col gap-4 flex-1 broadcast-filter-field">
                <label class="muted text-xs" for="bcLang">Language</label>
                <select class="v3-input" id="bcLang"><option value="">Any</option><option value="en">English</option><option value="ru">Russian</option><option value="es">Spanish</option><option value="pt">Portuguese</option><option value="ar">Arabic</option><option value="de">German</option><option value="fr">French</option></select>
              </div>
              <div class="d-flex flex-col gap-4 flex-1 broadcast-filter-field">
                <label class="muted text-xs" for="bcMinLastSeen">Active in last N days</label>
                <input class="v3-input" id="bcMinLastSeen" type="number" min="0" max="3650" placeholder="e.g. 7" />
              </div>
              <div class="d-flex flex-col gap-4 flex-1 broadcast-filter-field">
                <label class="muted text-xs" for="bcFirstSeen">Joined in last N days</label>
                <input class="v3-input" id="bcFirstSeen" type="number" min="0" max="3650" placeholder="e.g. 30" />
              </div>
              <div class="d-flex flex-col gap-4 flex-1 broadcast-filter-field">
                <label class="muted text-xs" for="bcUsername">Username contains</label>
                <input class="v3-input" id="bcUsername" type="text" maxLength="100" placeholder="optional" />
              </div>
            </div>
          </details>
        </section>

        <section class="tg-compose-step" data-step="3" aria-labelledby="bcWhenTitle">
          <h3 id="bcWhenTitle">When</h3>
          <div class="d-flex gap-16 mb-md">
            <label class="d-flex items-center gap-4 cursor-pointer"><input type="radio" name="bcWhen" value="now" checked /> Send now</label>
            <label class="d-flex items-center gap-4 cursor-pointer"><input type="radio" name="bcWhen" value="schedule" /> Send later</label>
          </div>
          <div class="d-flex flex-col gap-4 broadcast-schedule-field" id="bcScheduleField" hidden>
            <label class="muted text-xs" for="bcSchedule">Send at</label>
            <input class="v3-input" id="bcSchedule" type="datetime-local" disabled />
          </div>
          <p class="muted text-sm mt-sm" id="bcTimezone">Times use your local time.</p>
          <p class="muted text-sm" id="bcUtcHint" hidden>Time shown for reference: <b></b></p>
        </section>

        <div class="tg-compose-send">
          <button class="btn btn--accent" data-action="sendBroadcast" type="button" id="bcReviewBtn">Review &amp; send</button>
          <div class="tg-compose-rehearsal">
            <label class="muted text-xs" for="bcTestChat">Test chat ID</label>
            <input class="v3-input" id="bcTestChat" inputmode="numeric" aria-errormessage="bcTestChat-error" placeholder="Telegram chat ID">
            <button class="btn btn--ghost bc-test-action" data-action="testBroadcast" type="button">Send test</button>
          </div>
        </div>
        <span id="bcTestChat-error" class="field-err mt-sm" role="alert"></span>
        <p id="bcFormStatus" class="form-status mt-sm" role="alert" aria-live="polite"></p>

        <div id="bcPreview" class="bc-preview" role="dialog" aria-modal="true" aria-labelledby="bcPreviewTitle" aria-describedby="bcPreviewDesc" hidden>
          <div class="bc-preview-card">
            <h3 id="bcPreviewTitle">Check before sending</h3>
            <p id="bcPreviewDesc" class="bc-preview-audience"><b id="bcPreviewCount">–</b> subscribers</p>
            <p id="bcPreviewTiming" class="bc-preview-when"></p>
            <div id="bcSummary" class="tg-compose-summary" hidden>
              <ul id="bcSummaryList" class="muted text-sm m-0 pl-16"></ul>
            </div>
            <div class="bc-preview-msg" id="bcPreviewBody" role="document"></div>
            <div class="bc-preview-img" id="bcPreviewImg" hidden></div>
            <div class="bc-preview-actions">
              <button class="btn btn--ghost" data-action="closeBroadcastPreview" type="button">Cancel</button>
              <button class="btn btn--accent" data-action="confirmBroadcast" type="button" id="bcConfirmBtn">Send now</button>
            </div>
          </div>
        </div>
      </div>

      <p class="muted hint text-xs mt-lg">Use <code>{name}</code> to greet each subscriber. To find your test chat ID, send <code>/start</code> to <a href="https://t.me/userinfobot" target="_blank" rel="noopener">@userinfobot</a>. Updates scheduled for later can be cancelled until sending starts.</p>
    </div>

    <div class="lb-widget lb-widget--full">
      <div class="mb-md"><h2>Broadcast history</h2></div>
      <div id="bcDetail" class="bc-detail" role="dialog" aria-modal="true" aria-labelledby="bcDetailTitle" hidden>
        <div class="bc-detail-card">
          <div class="bc-detail-head"><h3 id="bcDetailTitle">Update details</h3><button class="btn btn--ghost" data-action="closeBroadcastDetail" type="button">Close</button></div>
          <div id="bcDetailBody"></div>
        </div>
      </div>
      <div class="v3-table-scroll">
        <table class="v3-table">
          <thead><tr><th>Status</th><th>Message</th><th>Audience</th><th>Sent</th><th>Failed</th><th>Date</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody id="bcList"></tbody>
        </table>
      </div>
    </div>
  </div>`;
}
