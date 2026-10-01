// offers dashboard page panels
export function offersPanel(publicBaseUrl: string): string {
  return `
  <div class="lb-bento" data-page="offers">
    <div class="lb-widget lb-widget--full">
      <div class="tg-section-head"><div><h2>Offers</h2><p class="muted text-sm">Account-wide · shared across your bots</p><p id="offerPlanState" class="muted text-sm" aria-live="polite">Loading offer allowance…</p></div><button class="btn btn--accent" data-action="toggleOfferForm" id="offerFormToggle" type="button" aria-expanded="false" aria-controls="offerCreateForm">Create offer</button></div>

      <div class="d-flex flex-col gap-12 offer-create-form tg-inline-form" id="offerCreateForm" hidden>
        <h3>Create an offer</h3>
        <div class="d-flex gap-12 flex-wrap">
          <div class="flex-1 offer-form-field">
            <label class="text-sm font-600" for="oPartner">Brand or partner</label>
            <input class="v3-input w-full" id="oPartner" placeholder="e.g. Acme VPN">
          </div>
          <div class="flex-1 offer-form-field">
            <label class="text-sm font-600" for="oLabel">Offer name</label>
            <input class="v3-input w-full" id="oLabel" placeholder="e.g. 30% off your first month">
          </div>
        </div>

        <div class="offer-form-field">
          <label class="text-sm font-600" for="oUrl">Partner link</label>
          <input class="v3-input w-full" id="oUrl" type="url" inputmode="url" placeholder="https://…">
        </div>

        <div class="d-flex gap-12 flex-wrap">
          <div class="flex-1 offer-form-field">
            <label class="text-sm font-600" for="oCode">Promo code <span class="muted font-400">(optional)</span></label>
            <input class="v3-input w-full" id="oCode" placeholder="e.g. SAVE10">
          </div>
          <div class="flex-1 offer-form-field">
            <label class="text-sm font-600" for="oBonus">Extra message <span class="muted font-400">(optional)</span></label>
            <input class="v3-input w-full" id="oBonus" placeholder="Shown with the offer in your bot">
          </div>
        </div>

        <div class="mt-sm">
          <button class="btn btn--accent" data-action="createOffer" type="button">Save offer</button>
          <button class="btn btn--ghost" data-action="cancelOfferForm" type="button">Cancel</button>
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
      <p class="muted text-sm mt-md mb-md" id="postbackStatusOffers" aria-live="polite">Checking tracking status…</p>

      <div class="v3-table-scroll">
        <table class="v3-table">
          <thead><tr><th>Offer</th><th>Clicks</th><th>Reported conversions</th><th>Revenue</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody id="offers" aria-live="polite"><tr><td colspan="6" class="muted">Loading…</td></tr></tbody>
        </table>
      </div>
      <section id="offerDetails" class="tg-inline-form mt-lg" aria-live="polite" hidden><div class="tg-section-head"><h3 id="offerDetailsTitle">Offer details</h3><button class="btn btn--ghost btn--sm" data-action="closeOfferDetails" type="button">Close</button></div><div id="offerDetailsBody"></div><p class="muted text-sm mt-sm">Clicks are retained for 90 days. Conversions and revenue are partner-reported; revenue is not verified receipt. <a href="${publicBaseUrl}/dashboard/settings/connections">Manage tracking</a>.</p></section>
    </div>
  </div>`;
}
