// overview dashboard page panels
export function overviewPanel({ hasBot = true }: { hasBot?: boolean } = {}): string {
  if (!hasBot) {
    return `
  <div class="lb-bento" data-page="overview">
    <section class="lb-widget lb-widget--full" aria-labelledby="telegramSetupTitle">
      <div class="v3-empty">
        <div class="v3-empty-ic" aria-hidden="true">◎</div>
        <h2 id="telegramSetupTitle">Connect your Telegram bot</h2>
        <p>Connect one bot first. After that you can edit commands, send broadcasts, and share offers from this workspace.</p>
        <div class="v3-empty-actions">
          <a class="btn btn--accent" href="/dashboard/telegram/bots">Connect bot</a>
        </div>
      </div>
    </section>
  </div>`;
  }

  return `
  <div class="lb-bento" data-page="overview">
    <div class="lb-widget lb-widget--full" aria-label="Quick actions">
      <div class="d-flex flex-wrap gap-12">
        <a href="/dashboard/telegram/broadcasts" class="btn btn--ghost d-flex flex-col items-start gap-4 bot-quick-action"><span class="font-600 text-sm">Send a broadcast</span><span class="muted text-xs">Send broadcasts to your subscribers</span></a>
        <a href="/dashboard/telegram/commands" class="btn btn--ghost d-flex flex-col items-start gap-4 bot-quick-action"><span class="font-600 text-sm">Edit commands</span><span class="muted text-xs">Change what your bot says</span></a>
        <a href="/dashboard/telegram/offers" class="btn btn--ghost d-flex flex-col items-start gap-4 bot-quick-action"><span class="font-600 text-sm">Create an offer</span><span class="muted text-xs">Make a tracked link to share</span></a>
        <a href="/dashboard/telegram/bots" class="btn btn--ghost d-flex flex-col items-start gap-4 bot-quick-action"><span class="font-600 text-sm">Manage bots</span><span class="muted text-xs">Check Telegram connections</span></a>
      </div>
    </div>

    <div class="lb-widget lb-widget--full">
      <p class="muted text-xs mb-lg" id="ovScope">Recent activity across your connected bots · last 14 days · local time.</p>
      <div class="kpi-row">
        <div class="kpi-card" title="Total clicks on tracked offer links"><div class="kpi-lbl">Offer clicks · 14d</div><div class="kpi-val" id="totClicks">–</div><div class="kpi-sub" id="clicksSub"></div></div>
        <div class="kpi-card" title="People who clicked tracked offer links in the last 14 days"><div class="kpi-lbl">People who clicked</div><div class="kpi-val" id="totUnique">–</div><div class="kpi-sub" id="uniqueSub"></div></div>
        <div class="kpi-card" title="Users who started a conversation with any of your bots"><div class="kpi-lbl">Subscribers</div><div class="kpi-val" id="totSubs">–</div><div class="kpi-sub" id="subsNew"></div></div>
        <div class="kpi-card" title="Offers currently marked active"><div class="kpi-lbl">Active offers</div><div class="kpi-val" id="totOffers">–</div><div class="kpi-sub" id="offersSub"></div></div>
      </div>
    </div>

    <div class="lb-widget lb-widget--half">
      <div class="d-flex justify-between items-center mb-md"><h2>Daily clicks</h2><span class="muted text-xs">14 days</span></div>
      <svg id="chart" role="img" aria-label="Daily clicks chart" width="100%" height="120" preserveAspectRatio="none"></svg>
      <div id="chartLabels" class="muted d-flex justify-between text-xs mt-sm"></div>
    </div>

    <div class="lb-widget lb-widget--half">
      <div class="mb-md"><h2>Where subscribers came from</h2></div>
      <table class="v3-table"><thead><tr><th>Source</th><th class="num">Subscribers</th></tr></thead>
      <tbody id="subSources"><tr><td colspan="2" class="muted">Loading…</td></tr></tbody></table>
      <p class="muted hint mt-sm">Share <code id="deepLinkExample">t.me/&lt;yourbot&gt;?start=twitch</code> to tag a source. <b>Came on their own</b> means no tagged link was used.</p>
    </div>

    <div class="lb-widget lb-widget--half">
      <div class="d-flex justify-between items-center mb-md"><h2>Your bots</h2><a href="/dashboard/telegram/bots" class="text-xs">Manage</a></div>
      <div id="ovBots" class="muted">Loading…</div>
    </div>

    <div class="lb-widget lb-widget--half">
      <div class="d-flex justify-between items-center mb-md"><h2>Top offers</h2><a href="/dashboard/telegram/offers" class="text-xs">View offers</a></div>
      <div id="ovOffers" class="muted">Loading…</div>
    </div>
  </div>`;
}
