// overview dashboard page panels
import { connectionPanel } from "./connection.js";

export function overviewPanel({ hasBot = true }: { hasBot?: boolean } = {}): string {
  if (!hasBot) {
    return `
  <div class="lb-bento" data-page="overview">
    <section class="lb-widget lb-widget--full tg-setup-intro" aria-labelledby="telegramSetupTitle">
      <h2 id="telegramSetupTitle">Connect Telegram</h2>
      <p class="tg-setup-lead">Connect a Telegram bot once. After that you can send updates to your subscribers, choose what your bot replies, and share tracked links — all from here.</p>
      <div class="tg-setup-actions">
        <a class="btn btn--accent" href="/dashboard/telegram/bots">Connect Telegram</a>
      </div>
      <p class="tg-setup-next">Next step: create a bot in Telegram and paste its connect code. It takes about a minute.</p>
    </section>
  </div>`;
  }

  return `
  <div class="lb-bento" data-page="overview">
    ${connectionPanel()}

    <section class="lb-widget lb-widget--full tg-overview-performance" aria-labelledby="tgPerformanceTitle">
      <div class="tg-overview-section-head"><div><h2 id="tgPerformanceTitle">Performance</h2><p id="ovScope">Clicks in the last 14 days · current subscribers and offers · all bots</p></div></div>
      <div class="kpi-row">
        <div class="kpi-card"><div class="kpi-lbl">Offer clicks</div><div class="kpi-val" id="totClicks">–</div></div>
        <div class="kpi-card" title="Unique clicks are counted per tracked link within a 24-hour window"><div class="kpi-lbl">Unique clicks</div><div class="kpi-val" id="totUnique">–</div></div>
        <div class="kpi-card" title="Active subscribers across all your bots"><div class="kpi-lbl">Subscribers</div><div class="kpi-val" id="totSubs">–</div></div>
        <div class="kpi-card"><div class="kpi-lbl">Active offers</div><div class="kpi-val" id="totOffers">–</div></div>
      </div>
    </section>

    <section class="lb-widget lb-widget--half tg-overview-trend" aria-labelledby="tgTrendTitle">
      <div class="tg-overview-section-head"><h2 id="tgTrendTitle">Daily clicks</h2><span>Last 14 days</span></div>
      <div id="chartVisual" hidden>
        <svg id="chart" role="img" aria-label="Daily clicks chart" width="100%" height="120" preserveAspectRatio="none"></svg>
        <div id="chartLabels" class="muted d-flex justify-between text-xs mt-sm"></div>
      </div>
      <p id="chartEmpty" class="tg-overview-empty" role="status">Loading clicks…</p>
    </section>

    <section class="lb-widget lb-widget--half tg-overview-sources" aria-labelledby="tgSourcesTitle">
      <div class="tg-overview-section-head"><h2 id="tgSourcesTitle">Subscriber sources</h2><span>All subscribers · all bots</span></div>
      <div id="subSources" aria-live="polite"><p class="tg-overview-empty">Loading…</p></div>
    </section>

    <section class="lb-widget lb-widget--full tg-overview-offers" aria-labelledby="tgOffersTitle">
      <div class="tg-overview-section-head"><div><h2 id="tgOffersTitle">Top offers</h2><p>Ranked by tracked clicks</p></div><a href="/dashboard/telegram/offers">View all offers</a></div>
      <div class="v3-table-scroll"><table class="v3-table"><thead><tr><th scope="col">Offer</th><th scope="col" class="num">Clicks</th><th scope="col" class="num">Conversions</th><th scope="col">Status</th></tr></thead><tbody id="ovOffers"><tr><td colspan="4" class="muted">Loading…</td></tr></tbody></table></div>
    </section>
  </div>`;
}
