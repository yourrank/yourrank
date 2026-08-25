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

    <div class="lb-widget lb-widget--full">
      <div class="mb-md"><h2>What you can do</h2></div>
      <ul class="tg-action-list">
        <li class="tg-action-row"><div class="tg-action-copy"><span class="tg-action-name">Send update</span><span class="tg-action-purpose">Message everyone subscribed to your bot</span></div><a class="btn btn--ghost" href="/dashboard/telegram/broadcasts">Send update</a></li>
        <li class="tg-action-row"><div class="tg-action-copy"><span class="tg-action-name">Commands</span><span class="tg-action-purpose">Choose what your bot replies to subscribers</span></div><a class="btn btn--ghost" href="/dashboard/telegram/commands">Edit commands</a></li>
        <li class="tg-action-row"><div class="tg-action-copy"><span class="tg-action-name">Offers</span><span class="tg-action-purpose">Make a tracked link to share with subscribers</span></div><a class="btn btn--ghost" href="/dashboard/telegram/offers">View offers</a></li>
      </ul>
    </div>

    <div class="lb-widget lb-widget--full">
      <div class="mb-md"><h2>Activity</h2></div>
      <p class="muted text-xs mb-lg" id="ovScope">Last 14 days, in your local time.</p>
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
