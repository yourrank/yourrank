// offers dashboard page panels
export function offersPanel(publicBaseUrl: string): string {
  return `
  <div class="lb-bento" data-page="offers">
    <div class="lb-widget lb-widget--full">
      <div class="mb-md"><h2>Create an offer</h2></div>
      <p class="muted text-sm mb-md">Give your offer a name and paste the partner link. We’ll make a shareable link for your bot.</p>
      <div id="offerPlanState" class="v3-note mb-md" aria-live="polite">Loading offer allowance…</div>

      <div class="d-flex flex-col gap-12 offer-create-form" id="offerCreateForm">
        <div class="d-flex gap-12 flex-wrap">
          <div class="flex-1 offer-form-field">
            <label class="text-sm font-600" for="oCasino">Brand or casino <span class="muted font-400">(optional)</span></label>
            <input class="v3-input w-full" id="oCasino" placeholder="e.g. Stake">
          </div>
          <div class="flex-1 offer-form-field">
            <label class="text-sm font-600" for="oLabel">Offer name</label>
            <input class="v3-input w-full" id="oLabel" placeholder="e.g. 200% deposit bonus">
          </div>
        </div>

        <div class="offer-form-field">
          <label class="text-sm font-600" for="oUrl">Partner link</label>
          <input class="v3-input w-full" id="oUrl" type="url" inputmode="url" placeholder="https://…">
        </div>

        <div class="d-flex gap-12 flex-wrap">
          <div class="flex-1 offer-form-field">
            <label class="text-sm font-600" for="oCode">Promo code <span class="muted font-400">(optional)</span></label>
            <input class="v3-input w-full" id="oCode" placeholder="e.g. MORAD">
          </div>
          <div class="flex-1 offer-form-field">
            <label class="text-sm font-600" for="oBonus">Bonus message <span class="muted font-400">(optional)</span></label>
            <input class="v3-input w-full" id="oBonus" placeholder="Shown with the offer in your bot">
          </div>
        </div>

        <div class="mt-sm">
          <button class="btn btn--accent" data-action="createOffer" type="button">Create offer</button>
        </div>
      </div>

      <div id="offerPreview" class="bg-panel border radius-md p-16 mt-md offer-result" hidden aria-live="polite">
        <div class="mb-sm"><h3 id="offerPreviewTitle">Your share link is ready</h3></div>
        <a class="text-sm mb-xs font-mono tracked-link" id="offerPreviewUrl" aria-label="Offer share link">—</a>
        <p id="offerPreviewText" class="text-sm">—</p>
        <div id="offerCreatedActions" class="d-flex flex-wrap gap-8 mt-md" hidden>
          <button class="btn btn--accent" data-action="copyCreatedOffer" type="button">Copy link</button>
          <a class="btn btn--ghost" href="/dashboard/telegram/commands">Share in your bot</a>
        </div>
      </div>
    </div>

    <div class="lb-widget lb-widget--full">
      <div class="mb-md"><h2>Offer results</h2></div>
      <p class="muted text-sm mb-sm">See how your shared offers are doing.</p>
      <p class="muted text-sm font-600 mb-md" id="postbackStatusOffers" aria-live="polite">Checking extra results…</p>

      <div class="v3-table-scroll">
        <table class="v3-table">
          <thead><tr><th>Offer</th><th>Share link</th><th>Visits</th><th>People reached</th><th title="People reached divided by total visits">Visit rate</th><th title="People who signed up divided by people reached">Sign-up rate</th><th>Sign-ups</th><th>Revenue</th><th>Last activity</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody id="offers" aria-live="polite"><tr><td colspan="11" class="muted">Loading…</td></tr></tbody>
        </table>
      </div>

      <details class="metric-glossary mt-lg">
        <summary class="muted font-600 cursor-pointer">How tracking works</summary>
        <div class="mt-sm text-sm">
          <h3 class="text-sm mb-xs">Advanced tracking</h3>
          <p class="muted mb-sm">Visits and visit-derived rates use a rolling 90-day window. People reached counts each person once after they visit an offer link.</p>
          <p class="muted mb-sm">Need to connect extra results? <a href="${publicBaseUrl}/dashboard/settings/connections">Manage connections</a> in settings.</p>
          <dl class="d-flex flex-col gap-8">
            <div><dt class="font-600 d-inline">Visits:</dt> <dd class="d-inline muted m-0">Total visits to this offer’s tracked short link.</dd></div>
            <div><dt class="font-600 d-inline">People reached:</dt> <dd class="d-inline muted m-0">People who visited this offer at least once.</dd></div>
            <div><dt class="font-600 d-inline">Visit rate:</dt> <dd class="d-inline muted m-0">People reached divided by total visits.</dd></div>
            <div><dt class="font-600 d-inline">Sign-up rate:</dt> <dd class="d-inline muted m-0">People who signed up divided by people reached.</dd></div>
            <div><dt class="font-600 d-inline">Sign-ups:</dt> <dd class="d-inline muted m-0">People reported as signing up after visiting this offer.</dd></div>
            <div><dt class="font-600 d-inline">Revenue:</dt> <dd class="d-inline muted m-0">Amounts reported through deposit or partner conversion tracking, shown separately by currency. This is not verified receipt.</dd></div>
            <div><dt class="font-600 d-inline">Last activity:</dt> <dd class="d-inline muted m-0">Most recent retained click or reported conversion.</dd></div>
          </dl>
        </div>
      </details>
    </div>
  </div>`;
}
