// Telegram connection summary — the one place a creator learns whether Telegram
// is connected, what it is connected to, and what to do next. Rendered on the
// Overview and Bots pages; the client runtime fills it from /bots (no new API).
export function connectionPanel(): string {
  return `
    <section class="lb-widget lb-widget--full tg-conn" id="tgConn" aria-labelledby="tgConnName">
      <div class="tg-conn-head">
        <div class="tg-conn-id">
          <h2 class="tg-conn-name" id="tgConnName">Telegram</h2>
          <p class="tg-conn-sub" id="tgConnSub">Checking your Telegram connection…</p>
        </div>
        <span class="tg-state" id="tgConnState" data-state="loading"><i aria-hidden="true"></i><span id="tgConnStateText">Checking…</span></span>
      </div>
      <div class="tg-conn-actions" id="tgConnActions" hidden>
        <a class="btn btn--accent" id="tgConnPrimary" href="/dashboard/telegram/bots">Connect Telegram</a>
        <a class="btn btn--ghost" id="tgConnSecondary" href="/dashboard/telegram/bots" hidden>Manage connection</a>
      </div>
      <p class="tg-conn-note" id="tgConnNote" hidden></p>
    </section>`;
}
