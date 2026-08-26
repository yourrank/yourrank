// bots dashboard page panels
import { connectionPanel } from "./connection.js";

export function botsPanel(): string {
  return `
  <div class="lb-bento" data-page="bots">
    ${connectionPanel()}

    <div class="lb-widget lb-widget--full">
      <div class="d-flex justify-between items-center mb-md"><h2>Your bots</h2></div>
      <div id="botList" class="muted">Loading…</div>
      <div id="botPlanState" class="v3-note mt-md" aria-live="polite">Loading bot allowance…</div>

      <div class="wizard mt-lg" id="connectWizard">
        <div class="wizard-step" data-step="1">
          <h3>Connect Telegram</h3>
          <p class="muted">Create a bot in Telegram with @BotFather, then paste the connect code it gives you. Keep that code private — only you and YourRank need it.</p>
          <div class="d-flex gap-8 mt-sm">
            <a href="https://t.me/BotFather" target="_blank" rel="noopener" class="btn btn--accent">Open Telegram</a>
            <button type="button" class="btn btn--ghost" data-action="wizardNext" data-step="1">I have a connect code</button>
          </div>
        </div>

        <div class="wizard-step" data-step="2" hidden>
          <h3>Paste your connect code</h3>
          <p class="muted">The code is stored encrypted. Only its last four characters are ever shown back to you.</p>
          <div class="d-flex flex-col gap-8 mt-sm bot-connect-fields">
            <label class="sr-only" for="botToken">Connect code</label>
            <div class="d-flex gap-8">
              <input class="v3-input bot-token-input" id="botToken" type="password" autocomplete="off" placeholder="Paste connect code">
              <button class="btn btn--ghost" data-action="toggleToken" type="button" aria-label="Show connect code">Show</button>
            </div>
            <label class="sr-only" for="botWelcome">Welcome message</label>
            <input class="v3-input" id="botWelcome" placeholder="Welcome message (optional)">
            <div class="d-flex gap-8 mt-sm">
              <button class="btn btn--accent" data-action="connectBot" type="button">Connect Telegram</button>
              <button type="button" class="btn btn--ghost" data-action="wizardPrev" data-step="2">Back</button>
            </div>
          </div>
        </div>

        <div class="wizard-step" data-step="3" hidden>
          <h3>Connecting…</h3>
          <p class="muted" id="connectStatus">Checking your bot with Telegram.</p>
        </div>
      </div>
    </div>

    <!-- Test message (bots) -->
    <div class="lb-widget lb-widget--full" id="testMsgPanel" hidden>
      <div class="mb-md"><h2>Send a test message</h2></div>
      <p class="muted mb-md">Send one message from <b id="tmBotName">your bot</b> to your own Telegram chat to confirm it works. Send <code>/start</code> to <a href="https://t.me/userinfobot" target="_blank" rel="noopener">@userinfobot</a> to get your chat ID — the number Telegram uses for your chat.</p>
      <div class="d-flex flex-wrap gap-12 mb-md">
        <label class="sr-only" for="tmChatId">Chat ID</label>
        <input class="v3-input" id="tmChatId" inputmode="numeric" placeholder="Your Telegram chat ID (e.g. 123456789)">
        <label class="sr-only" for="tmText">Message</label>
        <input class="v3-input grow test-message-input" id="tmText" placeholder="Message to send">
      </div>
      <div class="d-flex gap-8">
        <button class="btn btn--accent" data-action="sendTestMessage" type="button">Send test message</button>
        <button class="btn btn--ghost" data-action="cancelTestMessage" type="button">Cancel</button>
      </div>
    </div>
  </div>`;
}
